import { Home, Keyboard, ListRestart, LockOpen, RotateCcw, Square } from "lucide-react";
import type { Dispatch, PointerEvent, RefObject, SetStateAction } from "react";
import type { DeviceActionRequest, DeviceInfo } from "@mobile-automation/shared";

type PreviewMode = "scrcpy" | "scrcpy_connecting" | "screenshot";
type PreviewRenderer = "canvas" | "video";

type PreviewPanelProps = {
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  previewRef: RefObject<HTMLDivElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  previewUrl: string;
  screenshotError: string;
  previewMode: PreviewMode;
  previewRenderer: PreviewRenderer;
  scrcpyStreamStatus: string;
  isScrcpyPreviewActive: boolean;
  busy: boolean;
  controlLocked?: boolean;
  controlLockedReason?: string;
  inputText: string;
  setInputText: Dispatch<SetStateAction<string>>;
  setMessage: (message: string) => void;
  runAction: (action: DeviceActionRequest) => Promise<void>;
  handleScreenshotLoaded: (image: HTMLImageElement) => void;
  onPreviewPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPreviewPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPreviewPointerCancel: () => void;
  compact?: boolean;
};

export function PreviewPanel({
  selectedSerial,
  selectedDevice,
  previewRef,
  imageRef,
  canvasRef,
  videoRef,
  previewUrl,
  screenshotError,
  previewMode,
  previewRenderer,
  scrcpyStreamStatus,
  isScrcpyPreviewActive,
  busy,
  controlLocked = false,
  controlLockedReason,
  inputText,
  setInputText,
  setMessage,
  runAction,
  handleScreenshotLoaded,
  onPreviewPointerDown,
  onPreviewPointerUp,
  onPreviewPointerCancel,
  compact = false
}: PreviewPanelProps) {
  const previewStatus = formatPreviewStatus(previewMode, scrcpyStreamStatus, selectedDevice);
  const controlDisabled = busy || controlLocked;
  const selectedDeviceMeta = selectedDevice
    ? `${devicePlatformLabel(selectedDevice.platform)}${selectedDevice.osVersion ? ` ${selectedDevice.osVersion}` : ""}${
        selectedDevice.resolution ? ` · ${selectedDevice.resolution.width} x ${selectedDevice.resolution.height}` : ""
      }`
    : "请选择设备";

  return (
    <section className="preview-column">
      <div className="preview-toolbar">
        <div className="preview-device-head">
          <span>{selectedDeviceMeta} · {previewStatus}{controlLockedReason ? ` · ${controlLockedReason}` : ""}</span>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            disabled={!selectedSerial || controlDisabled || !selectedDevice?.capabilities.back}
            onClick={() => void runAction({ type: "back" })}
            title={controlLockedReason ?? "返回"}
          >
            <RotateCcw size={18} />
            返回
          </button>
          <button
            className="icon-button"
            disabled={!selectedSerial || controlDisabled || !selectedDevice?.capabilities.home}
            onClick={() => void runAction({ type: "home" })}
            title={controlLockedReason ?? "Home"}
          >
            <Home size={18} />
            Home
          </button>
          <button
            className="icon-button"
            disabled={!selectedSerial || controlDisabled || selectedDevice?.capabilities.unlock !== true}
            onClick={() => void runAction({ type: "unlock" })}
            title={controlLockedReason ?? "唤醒并解锁设备"}
          >
            <LockOpen size={18} />
            解锁
          </button>
          <button
            className="icon-button"
            disabled={!selectedSerial || controlDisabled || !selectedDevice?.capabilities.recentApps}
            onClick={() => void runAction({ type: "recent_apps" })}
            title={controlLockedReason ?? (selectedDevice?.platform === "ios" ? "iOS 暂不支持最近任务" : "最近任务")}
          >
            <ListRestart size={18} />
            最近任务
          </button>
        </div>
      </div>

      <div className="preview-frame" ref={previewRef}>
        {selectedSerial ? (
          <>
            <canvas ref={canvasRef} className={isScrcpyPreviewActive && previewRenderer === "canvas" ? "preview-canvas" : "preview-canvas hidden"} />
            <video
              ref={videoRef}
              className={isScrcpyPreviewActive && previewRenderer === "video" ? "preview-video" : "preview-video hidden"}
              muted
              playsInline
              disablePictureInPicture
            />
            {previewMode === "scrcpy_connecting" && <div className="preview-overlay">正在连接实时预览</div>}
            {previewMode === "screenshot" && selectedDevice?.capabilities.screenshot && screenshotError && <div className="preview-empty">{screenshotError}</div>}
            {previewMode === "screenshot" && selectedDevice?.capabilities.screenshot && !screenshotError && previewUrl && (
              <img
                ref={imageRef}
                src={previewUrl}
                alt="Device preview"
                draggable={false}
                onError={() => setMessage("截图渲染失败")}
                onLoad={(event) => handleScreenshotLoaded(event.currentTarget)}
              />
            )}
            {previewMode === "screenshot" && selectedDevice?.capabilities.screenshot && !screenshotError && !previewUrl && <div className="preview-empty">正在获取截图预览</div>}
            {previewMode === "screenshot" && !selectedDevice?.capabilities.screenshot && (
              <div className="preview-empty">{selectedDevice?.platform === "ios" ? "iOS 设备离线或未授权，无法截图预览" : "当前设备无法截图预览"}</div>
            )}
            {previewMode !== "scrcpy_connecting" && !controlLocked && (selectedDevice?.capabilities.tap || selectedDevice?.capabilities.swipe) && (
              <div
                className="preview-hit-layer"
                aria-label="设备预览控制区"
                onPointerDown={onPreviewPointerDown}
                onPointerUp={onPreviewPointerUp}
                onPointerCancel={onPreviewPointerCancel}
              />
            )}
          </>
        ) : (
          <div className="preview-empty">选择设备后开始预览</div>
        )}
      </div>

      {!compact && (
        <div className="control-strip">
          <input value={inputText} onChange={(event) => setInputText(event.target.value)} placeholder="要发送到设备的文本" />
          <button
            className="icon-button"
            disabled={!inputText || !selectedSerial || controlDisabled || !selectedDevice?.capabilities.textInput}
            onClick={() => void runAction({ type: "input_text", text: inputText })}
            title={controlLockedReason ?? "发送到设备当前焦点"}
          >
            <Keyboard size={18} />
            发送
          </button>
          <button className="icon-button" disabled={!selectedSerial || busy} onClick={() => void runAction({ type: "wait", durationMs: 1000 })} title="等待 1 秒">
            <Square size={16} />
            等待
          </button>
        </div>
      )}
    </section>
  );
}

export function formatPreviewStatus(previewMode: PreviewMode, rawStatus: string, selectedDevice?: DeviceInfo): string {
  if (!selectedDevice) {
    return "等待预览";
  }
  if (previewMode === "scrcpy") {
    return "实时预览已连接";
  }
  if (previewMode === "scrcpy_connecting") {
    return "正在连接预览";
  }
  if (selectedDevice.platform === "ios") {
    return selectedDevice.status === "online" ? "截图预览" : "设备离线";
  }
  if (selectedDevice.platform === "harmony") {
    return "截图预览";
  }
  if (isRealtimePreviewStatus(rawStatus)) {
    return rawStatus;
  }
  return "截图预览";
}

function isRealtimePreviewStatus(status: string): boolean {
  return status.includes("实时预览") || status.includes("WebCodecs");
}

export function devicePlatformLabel(platform: DeviceInfo["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "harmony") return "HarmonyOS";
  return "Android";
}
