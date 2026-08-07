import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { DeviceActionRequest, DeviceInfo } from "@mobile-automation/shared";
import { ScrcpyVideoCodecId, type ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import {
  InsertableStreamVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer,
  type VideoFrameRenderer
} from "@yume-chan/scrcpy-decoder-webcodecs";
import { buildScrcpyControlMessage, type ScrcpyPreviewMode } from "../scrcpy-control";

export type PreviewMode = ScrcpyPreviewMode;
export type PreviewRenderer = "canvas" | "video";

type UseScrcpyStreamOptions = {
  selectedSerial: string;
  selectedDevice: DeviceInfo | undefined;
  enabled?: boolean;
  previewSessionKey?: string;
  setMessage: (message: string) => void;
};

type ScrcpyMetadataMessage = {
  type: "metadata";
  protocolVersion: number;
  serial: string;
  codec: number;
  codecName: string;
  width?: number;
  height?: number;
  deviceName?: string;
};

type ScrcpyErrorMessage = {
  type: "error" | "control_error";
  message: string;
};

const packetHeaderSize = 18;
const lowLatencyMaxBufferedFrames = 2;
const realtimePreviewRetryDelaysMs = [800, 1500, 3000, 5000] as const;
const screenshotActionRefreshDelaysMs = [0, 300, 900, 1800] as const;
const screenshotActionPauseMs = 4000;

export function useScrcpyStream({ selectedSerial, selectedDevice, enabled = true, previewSessionKey = "default", setMessage }: UseScrcpyStreamOptions) {
  const [previewTick, setPreviewTick] = useState(Date.now());
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("screenshot");
  const [previewRenderer, setPreviewRenderer] = useState<PreviewRenderer>("canvas");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotError, setScreenshotError] = useState("");
  const [screenshotPollingPaused, setScreenshotPollingPaused] = useState(false);
  const [scrcpyStreamStatus, setScrcpyStreamStatus] = useState("等待实时预览");
  const [streamReconnectToken, setStreamReconnectToken] = useState(0);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrcpySocketRef = useRef<WebSocket | null>(null);
  const screenshotObjectUrlRef = useRef<string | null>(null);
  const screenshotUrlRef = useRef("");
  const screenshotUrlsPendingRevokeRef = useRef<string[]>([]);
  const screenshotRefreshTimersRef = useRef<number[]>([]);
  const screenshotPauseTimerRef = useRef<number | undefined>(undefined);
  const streamReconnectTimerRef = useRef<number | undefined>(undefined);
  const streamReconnectAttemptRef = useRef(0);
  const suppressStreamReconnectRef = useRef(false);
  const decoderWriterRef = useRef<WritableStreamDefaultWriter<ScrcpyMediaStreamPacket> | null>(null);
  const pendingDecodeWritesRef = useRef(0);
  const dropDecodeUntilKeyframeRef = useRef(false);

  const screenshotRequestUrl =
    enabled && !screenshotPollingPaused && selectedSerial && selectedDevice?.capabilities.screenshot
      ? `/api/devices/${encodeURIComponent(selectedSerial)}/screenshot?t=${previewTick}`
      : "";
  const previewUrl = screenshotUrl;
  const realtimeStreamPath = previewStreamPathForDevice(selectedSerial, selectedDevice);
  const canUseEmbeddedScrcpy = enabled && Boolean(realtimeStreamPath) && browserCanUseEmbeddedScrcpy();
  const isScrcpyPreviewActive = previewMode === "scrcpy" || previewMode === "scrcpy_connecting";

  useEffect(() => {
    if (!enabled) {
      return;
    }
    revokeScreenshotUrl(screenshotObjectUrlRef);
    revokePendingScreenshotUrls(screenshotUrlsPendingRevokeRef);
    const cachedUrl = selectedSerial ? readCachedScreenshotPreview(selectedSerial) : "";
    screenshotUrlRef.current = cachedUrl;
    setScreenshotUrl(cachedUrl);
    setScreenshotError("");
    setPreviewSize(selectedDevice?.resolution ?? null);
    setPreviewTick(Date.now());
    clearRealtimeReconnectTimer(streamReconnectTimerRef);
    streamReconnectAttemptRef.current = 0;
    suppressStreamReconnectRef.current = false;
    setStreamReconnectToken(0);
  }, [enabled, previewSessionKey, selectedDevice?.resolution?.height, selectedDevice?.resolution?.width, selectedSerial]);

  useEffect(() => {
    if (!enabled || screenshotPollingPaused || !selectedSerial || isScrcpyPreviewActive || previewMode !== "screenshot" || !selectedDevice?.capabilities.screenshot) {
      return;
    }
    if (canUseEmbeddedScrcpy) {
      return;
    }
    const timer = window.setInterval(() => {
      setPreviewTick(Date.now());
    }, 2500);
    return () => window.clearInterval(timer);
  }, [canUseEmbeddedScrcpy, enabled, isScrcpyPreviewActive, previewMode, screenshotPollingPaused, selectedDevice?.capabilities.screenshot, selectedDevice?.platform, selectedSerial]);

  useEffect(() => {
    if (!screenshotRequestUrl || previewMode !== "screenshot") {
      setScreenshotError("");
      return;
    }

    let disposed = false;
    const controller = new AbortController();
    setScreenshotError("");
    fetch(screenshotRequestUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readScreenshotError(response));
        }
        return response.blob();
      })
      .then((blob) => {
        if (disposed) {
          return;
        }
        const nextUrl = URL.createObjectURL(blob);
        const nextState = nextScreenshotPreviewOnRefreshSuccess({
          currentUrl: screenshotObjectUrlRef.current,
          nextUrl
        });
        screenshotUrlsPendingRevokeRef.current.push(...nextState.revokeAfterLoad);
        screenshotObjectUrlRef.current = nextUrl;
        screenshotUrlRef.current = nextState.url;
        setScreenshotUrl(nextState.url);
        storeCachedScreenshotPreview(selectedSerial, blob);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        const nextState = nextScreenshotPreviewOnRefreshFailure({
          currentUrl: screenshotUrlRef.current,
          message
        });
        screenshotUrlRef.current = nextState.url;
        setScreenshotUrl(nextState.url);
        setScreenshotError(nextState.error);
        setMessage(message);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [previewMode, screenshotRequestUrl, setMessage]);

  useEffect(() => {
    return () => {
      clearScreenshotRefreshTimers(screenshotRefreshTimersRef);
      clearScreenshotPauseTimer(screenshotPauseTimerRef);
      clearRealtimeReconnectTimer(streamReconnectTimerRef);
      revokeScreenshotUrl(screenshotObjectUrlRef);
      revokePendingScreenshotUrls(screenshotUrlsPendingRevokeRef);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPreviewMode("screenshot");
      setScrcpyStreamStatus("预览未打开");
      clearRealtimeReconnectTimer(streamReconnectTimerRef);
      return;
    }
    if (!selectedSerial || !canUseEmbeddedScrcpy) {
      setPreviewMode("screenshot");
      clearRealtimeReconnectTimer(streamReconnectTimerRef);
      if (selectedDevice?.platform === "ios") {
        setScrcpyStreamStatus(selectedDevice.status === "online" ? "iOS 截图预览" : "iOS 设备离线");
      } else if (selectedDevice?.platform === "harmony") {
        setScrcpyStreamStatus("HarmonyOS 截图预览");
      } else {
        setScrcpyStreamStatus(canUseEmbeddedScrcpy ? "请选择设备" : "当前浏览器不支持 WebCodecs，使用截图预览");
      }
      return;
    }

    let disposed = false;
    let terminalHandled = false;
    let decoder: WebCodecsVideoDecoder | undefined;
    let writeChain = Promise.resolve();
    if (!realtimeStreamPath) {
      return;
    }
    clearRealtimeReconnectTimer(streamReconnectTimerRef);
    const socketUrl = `${getWebSocketOrigin()}${realtimeStreamPath}`;
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    scrcpySocketRef.current = socket;
    setPreviewMode("scrcpy_connecting");
    setPreviewRenderer(preferVideoElementRenderer() ? "video" : "canvas");
    setPreviewSize(selectedDevice?.resolution ?? null);
    setScrcpyStreamStatus("正在连接实时预览");

    const handleRealtimeTerminal = (status: string) => {
      if (disposed || terminalHandled) {
        return;
      }
      terminalHandled = true;
      if (scrcpySocketRef.current === socket) {
        scrcpySocketRef.current = null;
      }
      if (suppressStreamReconnectRef.current) {
        suppressStreamReconnectRef.current = false;
        setPreviewMode("screenshot");
        setScrcpyStreamStatus(status);
        return;
      }
      if (
        shouldRetryRealtimePreview({
          canUseEmbeddedScrcpy,
          enabled,
          platform: selectedDevice?.platform,
          selectedSerial,
          status: selectedDevice?.status
        })
      ) {
        const retryDelayMs = realtimePreviewRetryDelayMs(streamReconnectAttemptRef.current);
        streamReconnectAttemptRef.current += 1;
        setPreviewMode("scrcpy_connecting");
        setScrcpyStreamStatus(`${status}，${formatRetryDelay(retryDelayMs)}后自动重连`);
        clearRealtimeReconnectTimer(streamReconnectTimerRef);
        streamReconnectTimerRef.current = window.setTimeout(() => {
          streamReconnectTimerRef.current = undefined;
          setStreamReconnectToken((value) => value + 1);
        }, retryDelayMs);
        return;
      }
      setPreviewMode(selectedDevice?.platform === "android" ? "scrcpy_connecting" : "screenshot");
      setScrcpyStreamStatus(`${status}，使用截图预览`);
    };

    socket.onmessage = async (event) => {
      if (disposed) {
        return;
      }
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data) as ScrcpyMetadataMessage | ScrcpyErrorMessage;
        if (message.type === "control_error") {
          setMessage(`scrcpy 控制失败：${message.message}`);
          return;
        }
        if (message.type === "error") {
          setMessage(`实时预览失败：${message.message}`);
          handleRealtimeTerminal(`实时预览失败：${message.message}`);
          socket.close(1011, "stream error");
          return;
        }
        if (message.type !== "metadata") {
          return;
        }
        const videoElement = videoRef.current;
        const canvas = canvasRef.current;
        let renderer: VideoFrameRenderer | undefined;
        if (preferVideoElementRenderer() && videoElement) {
          setPreviewRenderer("video");
          renderer = new InsertableStreamVideoFrameRenderer(videoElement);
        } else if (canvas) {
          setPreviewRenderer("canvas");
          renderer = new WebGLVideoFrameRenderer(canvas, false);
        }
        if (!renderer) {
          handleRealtimeTerminal("实时预览画布未就绪");
          socket.close(1011, "renderer unavailable");
          return;
        }
        try {
          decoder = new WebCodecsVideoDecoder({
            codec: message.codec as ScrcpyVideoCodecId,
            renderer,
            hardwareAcceleration: "prefer-hardware"
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          setMessage(errorMessage);
          handleRealtimeTerminal(`实时预览解码器启动失败：${errorMessage}`);
          socket.close(1011, "decoder unavailable");
          return;
        }
        decoderWriterRef.current = decoder.writable.getWriter();
        pendingDecodeWritesRef.current = 0;
        dropDecodeUntilKeyframeRef.current = false;
        streamReconnectAttemptRef.current = 0;
        suppressStreamReconnectRef.current = false;
        decoder.sizeChanged(({ width, height }) => {
          setPreviewSize({ width, height });
        });
        setPreviewSize({
          width: message.width || selectedDevice?.resolution?.width || 1,
          height: message.height || selectedDevice?.resolution?.height || 1
        });
        setPreviewMode("scrcpy");
        setScrcpyStreamStatus(`实时预览已连接 · ${message.codecName}`);
        return;
      }

      if (!decoder) {
        return;
      }
      let packet: ScrcpyMediaStreamPacket;
      try {
        packet = decodePacket(event.data);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setMessage(errorMessage);
        handleRealtimeTerminal(`实时预览数据包异常：${errorMessage}`);
        socket.close(1011, "invalid media packet");
        return;
      }
      if (shouldDropDecodePacket(packet, pendingDecodeWritesRef.current, dropDecodeUntilKeyframeRef.current)) {
        dropDecodeUntilKeyframeRef.current = true;
        return;
      }
      if (dropDecodeUntilKeyframeRef.current && packet.type === "data" && packet.keyframe) {
        dropDecodeUntilKeyframeRef.current = false;
      }
      const writer = decoderWriterRef.current;
      if (!writer) {
        return;
      }
      pendingDecodeWritesRef.current += 1;
      writeChain = writeChain
        .then(() => writer.write(packet))
        .catch((error: unknown) => {
          if (!disposed) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            setMessage(errorMessage);
            handleRealtimeTerminal(`实时预览解码失败：${errorMessage}`);
            socket.close(1011, "decode failed");
          }
        })
        .finally(() => {
          pendingDecodeWritesRef.current = Math.max(0, pendingDecodeWritesRef.current - 1);
        });
    };

    socket.onerror = () => {
      handleRealtimeTerminal("实时预览连接异常");
    };

    socket.onclose = () => {
      handleRealtimeTerminal("实时预览已断开");
    };

    return () => {
      disposed = true;
      if (scrcpySocketRef.current === socket) {
        scrcpySocketRef.current = null;
      }
      decoderWriterRef.current?.releaseLock();
      decoderWriterRef.current = null;
      pendingDecodeWritesRef.current = 0;
      dropDecodeUntilKeyframeRef.current = false;
      decoder?.dispose();
      clearVideoElement(videoRef.current);
      socket.close(1000, "preview changed");
    };
  }, [
    canUseEmbeddedScrcpy,
    enabled,
    previewSessionKey,
    realtimeStreamPath,
    selectedDevice?.platform,
    selectedDevice?.resolution?.height,
    selectedDevice?.resolution?.width,
    selectedDevice?.status,
    selectedSerial,
    streamReconnectToken,
    setMessage
  ]);

  const previewMediaSize = previewSize ?? selectedDevice?.resolution ?? {
    width: imageRef.current?.naturalWidth || 1,
    height: imageRef.current?.naturalHeight || 1
  };
  const selectedDeviceSize = getActionDeviceSize(previewMode, previewMediaSize, selectedDevice?.resolution);

  const closeScrcpyStream = useCallback((reason = "preview changed") => {
    clearRealtimeReconnectTimer(streamReconnectTimerRef);
    suppressStreamReconnectRef.current = true;
    scrcpySocketRef.current?.close(1000, reason);
  }, []);

  const refreshScreenshot = useCallback(() => {
    setPreviewTick(Date.now());
  }, []);

  const resumeScreenshotPolling = useCallback(() => {
    clearScreenshotPauseTimer(screenshotPauseTimerRef);
    setScreenshotPollingPaused(false);
  }, []);

  const pauseScreenshotPollingForAction = useCallback(() => {
    const pauseMs = screenshotPollingPauseMsForAction({
      previewMode,
      screenshotCapable: Boolean(selectedDevice?.capabilities.screenshot)
    });
    if (!pauseMs) {
      return;
    }
    clearScreenshotRefreshTimers(screenshotRefreshTimersRef);
    clearScreenshotPauseTimer(screenshotPauseTimerRef);
    setScreenshotPollingPaused(true);
    screenshotPauseTimerRef.current = window.setTimeout(() => {
      screenshotPauseTimerRef.current = undefined;
      setScreenshotPollingPaused(false);
      setPreviewTick(Date.now());
    }, pauseMs);
  }, [previewMode, selectedDevice?.capabilities.screenshot]);

  const refreshScreenshotAfterAction = useCallback(() => {
    resumeScreenshotPolling();
    clearScreenshotRefreshTimers(screenshotRefreshTimersRef);
    const delays = screenshotRefreshDelaysAfterAction({
      previewMode,
      screenshotCapable: Boolean(selectedDevice?.capabilities.screenshot)
    });
    for (const delay of delays) {
      const timer = window.setTimeout(() => {
        setPreviewTick(Date.now());
      }, delay);
      screenshotRefreshTimersRef.current.push(timer);
    }
  }, [previewMode, resumeScreenshotPolling, selectedDevice?.capabilities.screenshot]);

  const sendScrcpyDirectAction = useCallback(
    (action: DeviceActionRequest, controlLease?: { id: string; ownerId: string }): boolean => {
      const socket = scrcpySocketRef.current;
      const videoSize = previewMode === "scrcpy" ? previewMediaSize : selectedDeviceSize;
      const message = buildScrcpyControlMessage({
        action,
        platform: selectedDevice?.platform,
        previewMode,
        socketOpen: socket?.readyState === WebSocket.OPEN,
        videoSize,
        ...(controlLease ? { controlLease } : {})
      });
      if (!message || !socket) {
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    },
    [previewMediaSize, previewMode, selectedDevice?.platform, selectedDeviceSize]
  );

  const handleScreenshotLoaded = useCallback((image: HTMLImageElement) => {
    revokePendingScreenshotUrls(screenshotUrlsPendingRevokeRef);
    setPreviewSize({
      width: image.naturalWidth,
      height: image.naturalHeight
    });
  }, []);

  return {
    imageRef,
    canvasRef,
    videoRef,
    previewUrl,
    screenshotError,
    previewSize,
    previewMode,
    previewRenderer,
    previewMediaSize,
    selectedDeviceSize,
    scrcpyStreamStatus,
    isScrcpyPreviewActive,
    closeScrcpyStream,
    refreshScreenshot,
    pauseScreenshotPollingForAction,
    refreshScreenshotAfterAction,
    sendScrcpyDirectAction,
    handleScreenshotLoaded
  };
}

export function screenshotRefreshDelaysAfterAction(options: { previewMode: PreviewMode; screenshotCapable: boolean }): number[] {
  if (options.previewMode !== "screenshot" || !options.screenshotCapable) {
    return [];
  }
  return [...screenshotActionRefreshDelaysMs];
}

export function screenshotPollingPauseMsForAction(options: { previewMode: PreviewMode; screenshotCapable: boolean }): number {
  if (options.previewMode !== "screenshot" || !options.screenshotCapable) {
    return 0;
  }
  return screenshotActionPauseMs;
}

export function shouldRetryRealtimePreview(options: {
  enabled: boolean;
  canUseEmbeddedScrcpy: boolean;
  selectedSerial: string;
  platform?: DeviceInfo["platform"];
  status?: DeviceInfo["status"];
}): boolean {
  return (
    options.enabled &&
    options.canUseEmbeddedScrcpy &&
    Boolean(options.selectedSerial) &&
    options.status === "online" &&
    options.platform === "android"
  );
}

export function realtimePreviewRetryDelayMs(attempt: number): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return realtimePreviewRetryDelaysMs[Math.min(safeAttempt, realtimePreviewRetryDelaysMs.length - 1)];
}

export function previewStreamPathForDevice(selectedSerial: string, selectedDevice: DeviceInfo | undefined): string | null {
  if (!selectedSerial || !selectedDevice) {
    return null;
  }
  if (selectedDevice.platform === "android") {
    return `/api/devices/${encodeURIComponent(selectedSerial)}/scrcpy/ws`;
  }
  return null;
}

export function nextScreenshotPreviewOnRefreshFailure(input: { currentUrl: string; message: string }): { url: string; error: string } {
  if (input.currentUrl) {
    return {
      url: input.currentUrl,
      error: ""
    };
  }
  return {
    url: "",
    error: input.message
  };
}

export function nextScreenshotPreviewOnRefreshSuccess(input: { currentUrl: string | null; nextUrl: string }): { url: string; revokeAfterLoad: string[] } {
  return {
    url: input.nextUrl,
    revokeAfterLoad: input.currentUrl && input.currentUrl !== input.nextUrl ? [input.currentUrl] : []
  };
}

export function screenshotPreviewCacheKey(serial: string): string {
  return `mobile-automation:last-screenshot:${encodeURIComponent(serial)}`;
}

function clearScreenshotRefreshTimers(ref: MutableRefObject<number[]>): void {
  for (const timer of ref.current) {
    window.clearTimeout(timer);
  }
  ref.current = [];
}

function clearScreenshotPauseTimer(ref: MutableRefObject<number | undefined>): void {
  if (ref.current === undefined) {
    return;
  }
  window.clearTimeout(ref.current);
  ref.current = undefined;
}

function clearRealtimeReconnectTimer(ref: MutableRefObject<number | undefined>): void {
  if (ref.current === undefined) {
    return;
  }
  window.clearTimeout(ref.current);
  ref.current = undefined;
}

function formatRetryDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs}ms`;
  }
  return `${Math.round(delayMs / 1000)} 秒`;
}

function getActionDeviceSize(
  previewMode: PreviewMode,
  mediaSize: { width: number; height: number },
  deviceResolution?: { width: number; height: number }
): { width: number; height: number } {
  if (previewMode !== "scrcpy" || !deviceResolution) {
    return mediaSize;
  }

  const mediaLandscape = mediaSize.width >= mediaSize.height;
  const deviceLandscape = deviceResolution.width >= deviceResolution.height;
  if (mediaLandscape !== deviceLandscape) {
    return {
      width: deviceResolution.height,
      height: deviceResolution.width
    };
  }
  return deviceResolution;
}

function getWebSocketOrigin(): string {
  const configured = readViteEnv("VITE_API_ORIGIN");
  return webSocketOriginForRealtimePreview(configured, typeof window === "undefined" ? undefined : window.location);
}

export function webSocketOriginForRealtimePreview(
  configuredApiOrigin: string | undefined,
  location: Pick<Location, "protocol" | "hostname" | "port" | "origin"> | undefined
): string {
  const apiOrigin = configuredApiOrigin || defaultApiOrigin(location);
  return apiOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function defaultApiOrigin(location: Pick<Location, "protocol" | "hostname" | "port" | "origin"> | undefined): string {
  if (!location) {
    return "http://localhost:4010";
  }
  if (location.port === "5173") {
    if (location.protocol === "https:") {
      return location.origin;
    }
    return `${location.protocol}//${location.hostname}:4010`;
  }
  return location.origin;
}

function readViteEnv(key: string): string | undefined {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> };
  return meta.env?.[key];
}

function browserCanUseEmbeddedScrcpy(): boolean {
  return (
    typeof window !== "undefined" &&
    WebCodecsVideoDecoder.isSupported &&
    (preferVideoElementRenderer() || WebGLVideoFrameRenderer.isSupported)
  );
}

function preferVideoElementRenderer(): boolean {
  return typeof window !== "undefined" && InsertableStreamVideoFrameRenderer.isSupported;
}

function clearVideoElement(video: HTMLVideoElement | null): void {
  if (!video) {
    return;
  }
  video.pause();
  video.srcObject = null;
}

function revokeScreenshotUrl(screenshotUrlRef: MutableRefObject<string | null>): void {
  if (!screenshotUrlRef.current) {
    return;
  }
  URL.revokeObjectURL(screenshotUrlRef.current);
  screenshotUrlRef.current = null;
}

function revokePendingScreenshotUrls(ref: MutableRefObject<string[]>): void {
  for (const url of ref.current) {
    URL.revokeObjectURL(url);
  }
  ref.current = [];
}

function readCachedScreenshotPreview(serial: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem(screenshotPreviewCacheKey(serial)) ?? "";
  } catch {
    return "";
  }
}

function storeCachedScreenshotPreview(serial: string, blob: Blob): void {
  if (typeof window === "undefined" || typeof FileReader === "undefined") {
    return;
  }
  try {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }
      try {
        window.sessionStorage.setItem(screenshotPreviewCacheKey(serial), reader.result);
      } catch {
        // Storage can be unavailable or quota-limited; the live preview should continue either way.
      }
    };
    reader.readAsDataURL(blob);
  } catch {
    // Best-effort cache only.
  }
}

async function readScreenshotError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText || "截图获取失败";
  }
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error || text;
  } catch {
    return text;
  }
}

function shouldDropDecodePacket(packet: ScrcpyMediaStreamPacket, pendingWrites: number, droppingUntilKeyframe: boolean): boolean {
  if (packet.type !== "data") {
    return false;
  }
  if (droppingUntilKeyframe) {
    return !packet.keyframe;
  }
  return pendingWrites > lowLatencyMaxBufferedFrames && !packet.keyframe;
}

function decodePacket(data: unknown): ScrcpyMediaStreamPacket {
  if (!(data instanceof ArrayBuffer) || data.byteLength < packetHeaderSize) {
    throw new Error("Invalid scrcpy packet");
  }
  const view = new DataView(data);
  const type = view.getUint8(0);
  const keyframe = view.getUint8(1) === 1;
  const pts = view.getBigInt64(2);
  const length = view.getUint32(10);
  const payload = new Uint8Array(data, packetHeaderSize, length);
  const packetData = new Uint8Array(payload.byteLength);
  packetData.set(payload);

  if (type === 1) {
    return {
      type: "configuration",
      data: packetData
    };
  }

  return {
    type: "data",
    keyframe,
    pts: pts >= 0n ? pts : undefined,
    data: packetData
  };
}
