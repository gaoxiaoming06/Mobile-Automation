#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <thread>
#include <vector>

#include <multimedia/player_framework/native_avcodec_base.h>
#include <multimedia/player_framework/native_avscreen_capture.h>
#include <native_window/external_window.h>

class ScreenStreamer {
public:
    static ScreenStreamer& Instance();

    bool Start(int32_t port, int32_t width, int32_t height, int32_t fps, int32_t bitrate);
    bool Stop();
    bool IsRunning() const;

private:
    ScreenStreamer() = default;
    ~ScreenStreamer();

    ScreenStreamer(const ScreenStreamer&) = delete;
    ScreenStreamer& operator=(const ScreenStreamer&) = delete;

    void RunServer();
    bool StartMediaPipeline();
    void TeardownMediaPipeline();
    void TeardownMediaPipelineLocked();
    bool SendMetadata();
    bool SendPacket(uint8_t packetType, bool keyframe, int64_t pts, const uint8_t* payload, size_t payloadSize);
    bool SendPacketBytes(const std::vector<uint8_t>& packet);
    bool SendCachedDecoderState();
    void CacheDecoderPacket(uint8_t packetType, bool keyframe, const std::vector<uint8_t>& packet);
    bool SendAll(const uint8_t* data, size_t size);
    void CloseServerSocket();
    void CloseClientSocket();

    void HandleOutputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer);
    void HandleEncoderError(int32_t errorCode);
    void HandleCaptureError(int32_t errorCode);
    void HandleCaptureState(OH_AVScreenCaptureStateCode stateCode);

    static void OnEncoderError(OH_AVCodec* codec, int32_t errorCode, void* userData);
    static void OnEncoderStreamChanged(OH_AVCodec* codec, OH_AVFormat* format, void* userData);
    static void OnEncoderNeedInputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer, void* userData);
    static void OnEncoderOutputBuffer(OH_AVCodec* codec, uint32_t index, OH_AVBuffer* buffer, void* userData);
    static void OnCaptureError(OH_AVScreenCapture* capture, int32_t errorCode, void* userData);
    static void OnCaptureState(OH_AVScreenCapture* capture, OH_AVScreenCaptureStateCode stateCode, void* userData);

    std::atomic<bool> running_ { false };
    std::mutex lifecycleMutex_;
    std::mutex mediaMutex_;
    std::mutex serverMutex_;
    std::mutex clientMutex_;
    std::mutex cacheMutex_;
    std::thread serverThread_;
    std::atomic<bool> mediaPipelineActive_ { false };

    int32_t port_ = 28282;
    int32_t width_ = 720;
    int32_t height_ = 1280;
    int32_t fps_ = 15;
    int32_t bitrate_ = 1200000;

    int serverFd_ = -1;
    int clientFd_ = -1;
    OH_AVCodec* encoder_ = nullptr;
    OH_AVScreenCapture* capture_ = nullptr;
    OHNativeWindow* encoderWindow_ = nullptr;
    std::vector<uint8_t> lastConfigPacket_;
    std::vector<uint8_t> lastKeyframePacket_;
};
