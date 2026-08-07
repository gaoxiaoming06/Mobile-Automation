#include "screen_streamer.h"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <hilog/log.h>
#include <multimedia/player_framework/native_avbuffer.h>
#include <multimedia/player_framework/native_avbuffer_info.h>
#include <multimedia/player_framework/native_avcodec_videoencoder.h>
#include <multimedia/player_framework/native_averrors.h>
#include <multimedia/player_framework/native_avformat.h>
#include <multimedia/player_framework/native_avscreen_capture_base.h>
#include <multimedia/player_framework/native_avscreen_capture_errors.h>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

#undef LOG_DOMAIN
#undef LOG_TAG
#define LOG_DOMAIN 0x4153
#define LOG_TAG "ScreenStreamer"

namespace {
constexpr uint32_t kProtocolVersion = 1;
constexpr size_t kPacketHeaderSize = 18;
constexpr uint8_t kPacketConfig = 1;
constexpr uint8_t kPacketFrame = 2;
constexpr uint32_t kCodecH264 = 0x68323634;

int32_t Clamp(int32_t value, int32_t min, int32_t max)
{
    return std::min(std::max(value, min), max);
}

void WriteUint32Be(uint8_t* target, uint32_t value)
{
    target[0] = static_cast<uint8_t>((value >> 24) & 0xff);
    target[1] = static_cast<uint8_t>((value >> 16) & 0xff);
    target[2] = static_cast<uint8_t>((value >> 8) & 0xff);
    target[3] = static_cast<uint8_t>(value & 0xff);
}

void WriteInt64Be(uint8_t* target, int64_t value)
{
    uint64_t unsignedValue = static_cast<uint64_t>(value);
    for (int index = 7; index >= 0; --index) {
        target[7 - index] = static_cast<uint8_t>((unsignedValue >> (index * 8)) & 0xff);
    }
}

void CloseFd(int& fd)
{
    if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
        close(fd);
        fd = -1;
    }
}

}

ScreenStreamer::~ScreenStreamer()
{
    Stop();
}

ScreenStreamer& ScreenStreamer::Instance()
{
    static ScreenStreamer streamer;
    return streamer;
}

bool ScreenStreamer::Start(int32_t port, int32_t width, int32_t height, int32_t fps, int32_t bitrate)
{
    std::lock_guard<std::mutex> lock(lifecycleMutex_);
    if (running_.load()) {
        return true;
    }

    port_ = Clamp(port, 1024, 65535);
    width_ = Clamp(width, 320, 3840);
    height_ = Clamp(height, 320, 3840);
    fps_ = Clamp(fps, 5, 60);
    bitrate_ = Clamp(bitrate, 250000, 12000000);
    running_.store(true);
    serverThread_ = std::thread(&ScreenStreamer::RunServer, this);
    OH_LOG_INFO(LOG_APP, "streamer server starting on port %{public}d", port_);
    return true;
}

bool ScreenStreamer::Stop()
{
    {
        std::lock_guard<std::mutex> lock(lifecycleMutex_);
        if (!running_.exchange(false)) {
            return true;
        }
        CloseClientSocket();
        CloseServerSocket();
    }

    if (serverThread_.joinable() && serverThread_.get_id() != std::this_thread::get_id()) {
        serverThread_.join();
    }
    TeardownMediaPipeline();
    OH_LOG_INFO(LOG_APP, "streamer stopped");
    return true;
}

bool ScreenStreamer::IsRunning() const
{
    return running_.load();
}

void ScreenStreamer::RunServer()
{
    int serverFd = socket(AF_INET, SOCK_STREAM, 0);
    if (serverFd < 0) {
        OH_LOG_ERROR(LOG_APP, "socket failed: %{public}d", errno);
        running_.store(false);
        return;
    }

    int reuse = 1;
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons(static_cast<uint16_t>(port_));

    if (bind(serverFd, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0) {
        OH_LOG_ERROR(LOG_APP, "bind failed: %{public}d", errno);
        close(serverFd);
        running_.store(false);
        return;
    }

    if (listen(serverFd, 1) < 0) {
        OH_LOG_ERROR(LOG_APP, "listen failed: %{public}d", errno);
        close(serverFd);
        running_.store(false);
        return;
    }

    {
        std::lock_guard<std::mutex> lock(serverMutex_);
        serverFd_ = serverFd;
    }

    while (running_.load()) {
        sockaddr_in clientAddress {};
        socklen_t clientLength = sizeof(clientAddress);
        int clientFd = accept(serverFd, reinterpret_cast<sockaddr*>(&clientAddress), &clientLength);
        if (clientFd < 0) {
            if (!running_.load()) {
                break;
            }
            if (errno == EINTR) {
                continue;
            }
            OH_LOG_ERROR(LOG_APP, "accept failed: %{public}d", errno);
            break;
        }

        struct timeval sendTimeout { 2, 0 };
        setsockopt(clientFd, SOL_SOCKET, SO_SNDTIMEO, &sendTimeout, sizeof(sendTimeout));
        {
            std::lock_guard<std::mutex> lock(clientMutex_);
            clientFd_ = clientFd;
        }

        OH_LOG_INFO(LOG_APP, "agent connected");
        if (SendMetadata() && StartMediaPipeline() && SendCachedDecoderState()) {
            while (running_.load()) {
                char scratch = 0;
                ssize_t readResult = recv(clientFd, &scratch, sizeof(scratch), MSG_DONTWAIT);
                if (readResult == 0) {
                    OH_LOG_INFO(LOG_APP, "agent disconnected");
                    break;
                }
                if (readResult < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
                    OH_LOG_WARN(LOG_APP, "client recv probe failed: %{public}d", errno);
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }

        OH_LOG_INFO(LOG_APP, "media pipeline kept alive after client disconnect");
        CloseClientSocket();
    }

    CloseServerSocket();
    running_.store(false);
}

bool ScreenStreamer::StartMediaPipeline()
{
    std::lock_guard<std::mutex> lock(mediaMutex_);
    if (mediaPipelineActive_.load() && encoder_ != nullptr && capture_ != nullptr) {
        return true;
    }

    TeardownMediaPipelineLocked();

    encoder_ = OH_VideoEncoder_CreateByMime(OH_AVCODEC_MIMETYPE_VIDEO_AVC);
    if (encoder_ == nullptr) {
        OH_LOG_ERROR(LOG_APP, "create H264 encoder failed");
        return false;
    }

    OH_AVFormat* format = OH_AVFormat_CreateVideoFormat(OH_AVCODEC_MIMETYPE_VIDEO_AVC, width_, height_);
    if (format == nullptr) {
        OH_LOG_ERROR(LOG_APP, "create video format failed");
        return false;
    }

    OH_AVFormat_SetLongValue(format, OH_MD_KEY_BITRATE, bitrate_);
    OH_AVFormat_SetDoubleValue(format, OH_MD_KEY_FRAME_RATE, static_cast<double>(fps_));
    OH_AVFormat_SetIntValue(format, OH_MD_KEY_PIXEL_FORMAT, AV_PIXEL_FORMAT_SURFACE_FORMAT);
    OH_AVFormat_SetIntValue(format, OH_MD_KEY_VIDEO_ENCODE_BITRATE_MODE, BITRATE_MODE_CBR);
    OH_AVFormat_SetIntValue(format, OH_MD_KEY_I_FRAME_INTERVAL, 1000);
    OH_AVFormat_SetIntValue(format, OH_MD_KEY_VIDEO_ENABLE_LOW_LATENCY, 1);

    OH_AVErrCode configureResult = OH_VideoEncoder_Configure(encoder_, format);
    OH_AVFormat_Destroy(format);
    if (configureResult != AV_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "encoder configure failed: %{public}d", configureResult);
        return false;
    }

    if (OH_VideoEncoder_GetSurface(encoder_, &encoderWindow_) != AV_ERR_OK || encoderWindow_ == nullptr) {
        OH_LOG_ERROR(LOG_APP, "encoder surface failed");
        return false;
    }

    OH_AVCodecCallback callback {
        .onError = ScreenStreamer::OnEncoderError,
        .onStreamChanged = ScreenStreamer::OnEncoderStreamChanged,
        .onNeedInputBuffer = ScreenStreamer::OnEncoderNeedInputBuffer,
        .onNewOutputBuffer = ScreenStreamer::OnEncoderOutputBuffer
    };
    if (OH_VideoEncoder_RegisterCallback(encoder_, callback, this) != AV_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "register encoder callback failed");
        return false;
    }

    if (OH_VideoEncoder_Prepare(encoder_) != AV_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "encoder prepare failed");
        return false;
    }

    if (OH_VideoEncoder_Start(encoder_) != AV_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "encoder start failed");
        return false;
    }

    capture_ = OH_AVScreenCapture_Create();
    if (capture_ == nullptr) {
        OH_LOG_ERROR(LOG_APP, "screen capture create failed");
        return false;
    }

    OH_AVScreenCapture_CaptureStrategy* strategy = OH_AVScreenCapture_CreateCaptureStrategy();
    if (strategy != nullptr) {
        OH_AVScreenCapture_StrategyForPickerPopUp(strategy, true);
        OH_AVScreenCapture_SetCaptureStrategy(capture_, strategy);
        OH_AVScreenCapture_ReleaseCaptureStrategy(strategy);
    }

    OH_AudioCaptureInfo micCapInfo {};
    micCapInfo.audioSampleRate = 48000;
    micCapInfo.audioChannels = 2;
    micCapInfo.audioSource = OH_MIC;

    OH_AudioCaptureInfo innerCapInfo {};
    innerCapInfo.audioSampleRate = 48000;
    innerCapInfo.audioChannels = 2;
    innerCapInfo.audioSource = OH_ALL_PLAYBACK;

    OH_AudioEncInfo audioEncInfo {};
    audioEncInfo.audioBitrate = 48000;
    audioEncInfo.audioCodecformat = OH_AAC_LC;

    OH_AudioInfo audioInfo {};
    audioInfo.micCapInfo = micCapInfo;
    audioInfo.innerCapInfo = innerCapInfo;
    audioInfo.audioEncInfo = audioEncInfo;

    OH_VideoCaptureInfo videoCapInfo {};
    videoCapInfo.videoFrameWidth = width_;
    videoCapInfo.videoFrameHeight = height_;
    videoCapInfo.videoSource = OH_VIDEO_SOURCE_SURFACE_RGBA;

    OH_VideoEncInfo videoEncInfo {};
    videoEncInfo.videoCodec = OH_H264;
    videoEncInfo.videoBitrate = bitrate_;
    videoEncInfo.videoFrameRate = fps_;

    OH_VideoInfo videoInfo {};
    videoInfo.videoCapInfo = videoCapInfo;
    videoInfo.videoEncInfo = videoEncInfo;

    OH_AVScreenCaptureConfig config {};
    config.captureMode = OH_CAPTURE_HOME_SCREEN;
    config.dataType = OH_ORIGINAL_STREAM;
    config.audioInfo = audioInfo;
    config.videoInfo = videoInfo;

    if (OH_AVScreenCapture_Init(capture_, config) != AV_SCREEN_CAPTURE_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "screen capture init failed");
        return false;
    }

    OH_AVScreenCapture_SetMicrophoneEnabled(capture_, false);
    OH_AVScreenCapture_SetErrorCallback(capture_, ScreenStreamer::OnCaptureError, this);
    OH_AVScreenCapture_SetStateCallback(capture_, ScreenStreamer::OnCaptureState, this);
    OH_AVScreenCapture_SetMaxVideoFrameRate(capture_, fps_);
    OH_AVScreenCapture_SetCanvasRotation(capture_, true);

    OH_AVSCREEN_CAPTURE_ErrCode startResult =
        OH_AVScreenCapture_StartScreenCaptureWithSurface(capture_, encoderWindow_);
    if (startResult != AV_SCREEN_CAPTURE_ERR_OK) {
        OH_LOG_ERROR(LOG_APP, "screen capture surface start failed: %{public}d", startResult);
        return false;
    }

    OH_LOG_INFO(LOG_APP, "media pipeline started");
    mediaPipelineActive_.store(true);
    return true;
}

void ScreenStreamer::TeardownMediaPipeline()
{
    std::lock_guard<std::mutex> lock(mediaMutex_);
    TeardownMediaPipelineLocked();
}

void ScreenStreamer::TeardownMediaPipelineLocked()
{
    mediaPipelineActive_.store(false);
    if (capture_ != nullptr) {
        OH_AVScreenCapture_StopScreenCapture(capture_);
        OH_AVScreenCapture_Release(capture_);
        capture_ = nullptr;
    }
    if (encoder_ != nullptr) {
        OH_VideoEncoder_Stop(encoder_);
        OH_VideoEncoder_Destroy(encoder_);
        encoder_ = nullptr;
    }
    if (encoderWindow_ != nullptr) {
        OH_NativeWindow_DestroyNativeWindow(encoderWindow_);
        encoderWindow_ = nullptr;
    }
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        lastConfigPacket_.clear();
        lastKeyframePacket_.clear();
    }
}

bool ScreenStreamer::SendMetadata()
{
    std::array<char, 256> metadata {};
    int length = snprintf(metadata.data(), metadata.size(),
        "{\"type\":\"metadata\",\"protocolVersion\":%u,\"codec\":%u,\"codecName\":\"h264\","
        "\"width\":%d,\"height\":%d,\"fps\":%d}\n",
        kProtocolVersion, kCodecH264, width_, height_, fps_);
    if (length <= 0 || static_cast<size_t>(length) >= metadata.size()) {
        return false;
    }
    return SendAll(reinterpret_cast<const uint8_t*>(metadata.data()), static_cast<size_t>(length));
}

bool ScreenStreamer::SendPacket(uint8_t packetType, bool keyframe, int64_t pts, const uint8_t* payload, size_t payloadSize)
{
    if (payload == nullptr || payloadSize == 0 || payloadSize > UINT32_MAX) {
        return false;
    }
    std::vector<uint8_t> packet(kPacketHeaderSize + payloadSize);
    packet[0] = packetType;
    packet[1] = keyframe ? 1 : 0;
    WriteInt64Be(packet.data() + 2, pts);
    WriteUint32Be(packet.data() + 10, static_cast<uint32_t>(payloadSize));
    WriteUint32Be(packet.data() + 14, kProtocolVersion);
    std::memcpy(packet.data() + kPacketHeaderSize, payload, payloadSize);
    CacheDecoderPacket(packetType, keyframe, packet);
    return SendPacketBytes(packet);
}

bool ScreenStreamer::SendPacketBytes(const std::vector<uint8_t>& packet)
{
    if (packet.empty()) {
        return true;
    }
    return SendAll(packet.data(), packet.size());
}

bool ScreenStreamer::SendCachedDecoderState()
{
    std::vector<uint8_t> configPacket;
    std::vector<uint8_t> keyframePacket;
    {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        configPacket = lastConfigPacket_;
        keyframePacket = lastKeyframePacket_;
    }

    if (!configPacket.empty() && !SendPacketBytes(configPacket)) {
        return false;
    }
    if (!keyframePacket.empty() && !SendPacketBytes(keyframePacket)) {
        return false;
    }
    return true;
}

void ScreenStreamer::CacheDecoderPacket(uint8_t packetType, bool keyframe, const std::vector<uint8_t>& packet)
{
    if (packetType != kPacketConfig && !(packetType == kPacketFrame && keyframe)) {
        return;
    }
    std::lock_guard<std::mutex> lock(cacheMutex_);
    if (packetType == kPacketConfig) {
        lastConfigPacket_ = packet;
        return;
    }
    lastKeyframePacket_ = packet;
}

bool ScreenStreamer::SendAll(const uint8_t* data, size_t size)
{
    bool failed = false;
    {
        std::lock_guard<std::mutex> lock(clientMutex_);
        if (clientFd_ < 0) {
            return false;
        }
        size_t sent = 0;
        while (sent < size) {
            ssize_t result = send(clientFd_, data + sent, size - sent, MSG_NOSIGNAL);
            if (result < 0) {
                if (errno == EINTR) {
                    continue;
                }
                failed = true;
                break;
            }
            if (result == 0) {
                failed = true;
                break;
            }
            sent += static_cast<size_t>(result);
        }
    }
    if (failed) {
        OH_LOG_WARN(LOG_APP, "client send failed; closing client only: %{public}d", errno);
        CloseClientSocket();
    }
    return !failed;
}

void ScreenStreamer::CloseServerSocket()
{
    std::lock_guard<std::mutex> lock(serverMutex_);
    CloseFd(serverFd_);
}

void ScreenStreamer::CloseClientSocket()
{
    std::lock_guard<std::mutex> lock(clientMutex_);
    CloseFd(clientFd_);
}

void ScreenStreamer::HandleOutputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer)
{
    if (buffer != nullptr && running_.load() && mediaPipelineActive_.load()) {
        OH_AVCodecBufferAttr attr {};
        if (OH_AVBuffer_GetBufferAttr(buffer, &attr) == AV_ERR_OK && attr.size > 0 && attr.offset >= 0) {
            int32_t capacity = OH_AVBuffer_GetCapacity(buffer);
            uint8_t* data = OH_AVBuffer_GetAddr(buffer);
            if (data != nullptr && capacity >= 0 && attr.offset <= capacity && attr.size <= capacity - attr.offset) {
                bool codecConfig = (attr.flags & AVCODEC_BUFFER_FLAGS_CODEC_DATA) != 0;
                bool keyframe = (attr.flags & AVCODEC_BUFFER_FLAGS_SYNC_FRAME) != 0;
                uint8_t packetType = codecConfig ? kPacketConfig : kPacketFrame;
                SendPacket(packetType, keyframe, attr.pts, data + attr.offset, static_cast<size_t>(attr.size));
            }
        }
    }
    OH_VideoEncoder_FreeOutputBuffer(codec, index);
}

void ScreenStreamer::HandleEncoderError(int32_t errorCode)
{
    OH_LOG_ERROR(LOG_APP, "encoder error: %{public}d", errorCode);
    mediaPipelineActive_.store(false);
    CloseClientSocket();
}

void ScreenStreamer::HandleCaptureError(int32_t errorCode)
{
    OH_LOG_ERROR(LOG_APP, "screen capture error: %{public}d", errorCode);
    mediaPipelineActive_.store(false);
    CloseClientSocket();
}

void ScreenStreamer::HandleCaptureState(OH_AVScreenCaptureStateCode stateCode)
{
    OH_LOG_INFO(LOG_APP, "screen capture state: %{public}d", stateCode);
    if (stateCode == OH_SCREEN_CAPTURE_STATE_CANCELED ||
        stateCode == OH_SCREEN_CAPTURE_STATE_STOPPED_BY_USER ||
        stateCode == OH_SCREEN_CAPTURE_STATE_INTERRUPTED_BY_OTHER) {
        mediaPipelineActive_.store(false);
        CloseClientSocket();
    }
}

void ScreenStreamer::OnEncoderError(OH_AVCodec* codec, int32_t errorCode, void* userData)
{
    (void)codec;
    if (userData != nullptr) {
        static_cast<ScreenStreamer*>(userData)->HandleEncoderError(errorCode);
    }
}

void ScreenStreamer::OnEncoderStreamChanged(OH_AVCodec* codec, OH_AVFormat* format, void* userData)
{
    (void)codec;
    (void)format;
    (void)userData;
}

void ScreenStreamer::OnEncoderNeedInputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer, void* userData)
{
    (void)codec;
    (void)index;
    (void)buffer;
    (void)userData;
}

void ScreenStreamer::OnEncoderOutputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer, void* userData)
{
    if (userData != nullptr) {
        static_cast<ScreenStreamer*>(userData)->HandleOutputBuffer(codec, index, buffer);
        return;
    }
    OH_VideoEncoder_FreeOutputBuffer(codec, index);
}

void ScreenStreamer::OnCaptureError(OH_AVScreenCapture* capture, int32_t errorCode, void* userData)
{
    (void)capture;
    if (userData != nullptr) {
        static_cast<ScreenStreamer*>(userData)->HandleCaptureError(errorCode);
    }
}

void ScreenStreamer::OnCaptureState(OH_AVScreenCapture* capture, OH_AVScreenCaptureStateCode stateCode, void* userData)
{
    (void)capture;
    if (userData != nullptr) {
        static_cast<ScreenStreamer*>(userData)->HandleCaptureState(stateCode);
    }
}
