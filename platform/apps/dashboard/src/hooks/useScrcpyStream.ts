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

export function useScrcpyStream({ selectedSerial, selectedDevice, enabled = true, previewSessionKey = "default", setMessage }: UseScrcpyStreamOptions) {
  const [previewTick, setPreviewTick] = useState(Date.now());
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("screenshot");
  const [previewRenderer, setPreviewRenderer] = useState<PreviewRenderer>("canvas");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [screenshotError, setScreenshotError] = useState("");
  const [scrcpyStreamStatus, setScrcpyStreamStatus] = useState("等待实时预览");

  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scrcpySocketRef = useRef<WebSocket | null>(null);
  const screenshotObjectUrlRef = useRef<string | null>(null);
  const decoderWriterRef = useRef<WritableStreamDefaultWriter<ScrcpyMediaStreamPacket> | null>(null);
  const pendingDecodeWritesRef = useRef(0);
  const dropDecodeUntilKeyframeRef = useRef(false);

  const screenshotRequestUrl =
    enabled && selectedSerial && selectedDevice?.capabilities.screenshot ? `/api/devices/${encodeURIComponent(selectedSerial)}/screenshot?t=${previewTick}` : "";
  const previewUrl = screenshotUrl;
  const canUseEmbeddedScrcpy = enabled && selectedDevice?.platform === "android" && browserCanUseEmbeddedScrcpy();
  const isScrcpyPreviewActive = previewMode === "scrcpy" || previewMode === "scrcpy_connecting";

  useEffect(() => {
    if (!enabled) {
      return;
    }
    revokeScreenshotUrl(screenshotObjectUrlRef);
    setScreenshotUrl("");
    setScreenshotError("");
    setPreviewSize(selectedDevice?.resolution ?? null);
    setPreviewTick(Date.now());
  }, [enabled, previewSessionKey, selectedDevice?.resolution?.height, selectedDevice?.resolution?.width]);

  useEffect(() => {
    if (!enabled || !selectedSerial || isScrcpyPreviewActive || previewMode !== "screenshot" || !selectedDevice?.capabilities.screenshot) {
      return;
    }
    if (selectedDevice?.platform === "android" && canUseEmbeddedScrcpy) {
      return;
    }
    const timer = window.setInterval(() => {
      setPreviewTick(Date.now());
    }, 2500);
    return () => window.clearInterval(timer);
  }, [canUseEmbeddedScrcpy, enabled, isScrcpyPreviewActive, previewMode, selectedDevice?.capabilities.screenshot, selectedDevice?.platform, selectedSerial]);

  useEffect(() => {
    if (!screenshotRequestUrl || previewMode !== "screenshot") {
      revokeScreenshotUrl(screenshotObjectUrlRef);
      setScreenshotUrl("");
      setScreenshotError("");
      return;
    }

    let disposed = false;
    setScreenshotError("");
    fetch(screenshotRequestUrl)
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
        revokeScreenshotUrl(screenshotObjectUrlRef);
        screenshotObjectUrlRef.current = nextUrl;
        setScreenshotUrl(nextUrl);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setScreenshotUrl("");
        setScreenshotError(message);
        setMessage(message);
      });

    return () => {
      disposed = true;
    };
  }, [previewMode, screenshotRequestUrl, setMessage]);

  useEffect(() => {
    return () => revokeScreenshotUrl(screenshotObjectUrlRef);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPreviewMode("screenshot");
      setScrcpyStreamStatus("预览未打开");
      return;
    }
    if (!selectedSerial || !canUseEmbeddedScrcpy) {
      setPreviewMode("screenshot");
      if (selectedDevice?.platform === "ios") {
        setScrcpyStreamStatus(selectedDevice.status === "online" ? "iOS 截图预览" : "iOS 设备离线");
      } else {
        setScrcpyStreamStatus(canUseEmbeddedScrcpy ? "请选择设备" : "当前浏览器不支持 WebCodecs，使用截图预览");
      }
      return;
    }

    let disposed = false;
    let decoder: WebCodecsVideoDecoder | undefined;
    let writeChain = Promise.resolve();
    const socketUrl = `${getWebSocketOrigin()}/api/devices/${encodeURIComponent(selectedSerial)}/scrcpy/ws`;
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    scrcpySocketRef.current = socket;
    setPreviewMode("scrcpy_connecting");
    setPreviewRenderer(preferVideoElementRenderer() ? "video" : "canvas");
    setPreviewSize(selectedDevice?.resolution ?? null);
    setScrcpyStreamStatus("正在连接实时预览");

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
          setPreviewMode(selectedDevice?.platform === "android" ? "scrcpy_connecting" : "screenshot");
          setScrcpyStreamStatus(`实时预览失败：${message.message}`);
          setMessage(`实时预览失败：${message.message}`);
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
          return;
        }
        decoder = new WebCodecsVideoDecoder({
          codec: message.codec as ScrcpyVideoCodecId,
          renderer,
          hardwareAcceleration: "prefer-hardware"
        });
        decoderWriterRef.current = decoder.writable.getWriter();
        pendingDecodeWritesRef.current = 0;
        dropDecodeUntilKeyframeRef.current = false;
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
      const packet = decodePacket(event.data);
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
            setMessage(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          pendingDecodeWritesRef.current = Math.max(0, pendingDecodeWritesRef.current - 1);
        });
    };

    socket.onerror = () => {
      if (scrcpySocketRef.current === socket) {
        scrcpySocketRef.current = null;
      }
      setPreviewMode(selectedDevice?.platform === "android" ? "scrcpy_connecting" : "screenshot");
      setScrcpyStreamStatus("实时预览连接异常，请刷新页面或切换设备重连");
    };

    socket.onclose = () => {
      if (scrcpySocketRef.current === socket) {
        scrcpySocketRef.current = null;
      }
      if (!disposed) {
        setPreviewMode(selectedDevice?.platform === "android" ? "scrcpy_connecting" : "screenshot");
        setScrcpyStreamStatus("实时预览已断开，请刷新页面或切换设备重连");
      }
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
    selectedDevice?.platform,
    selectedDevice?.resolution?.height,
    selectedDevice?.resolution?.width,
    selectedDevice?.status,
    selectedSerial,
    setMessage
  ]);

  const previewMediaSize = previewSize ?? selectedDevice?.resolution ?? {
    width: imageRef.current?.naturalWidth || 1,
    height: imageRef.current?.naturalHeight || 1
  };
  const selectedDeviceSize = getActionDeviceSize(previewMode, previewMediaSize, selectedDevice?.resolution);

  const closeScrcpyStream = useCallback((reason = "preview changed") => {
    scrcpySocketRef.current?.close(1000, reason);
  }, []);

  const refreshScreenshot = useCallback(() => {
    setPreviewTick(Date.now());
  }, []);

  const sendScrcpyDirectAction = useCallback(
    (action: DeviceActionRequest): boolean => {
      const socket = scrcpySocketRef.current;
      const videoSize = previewMode === "scrcpy" ? previewMediaSize : selectedDeviceSize;
      const message = buildScrcpyControlMessage({
        action,
        platform: selectedDevice?.platform,
        previewMode,
        socketOpen: socket?.readyState === WebSocket.OPEN,
        videoSize
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
    sendScrcpyDirectAction,
    handleScreenshotLoaded
  };
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
  const apiOrigin = configured || defaultApiOrigin();
  return apiOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function defaultApiOrigin(): string {
  if (typeof window === "undefined") {
    return "http://localhost:4010";
  }
  if (window.location.port === "5173") {
    return `${window.location.protocol}//${window.location.hostname}:4010`;
  }
  return window.location.origin;
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
