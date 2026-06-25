import { Check, ChevronDown, Home, Keyboard, ListRestart, RotateCcw, Smartphone, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, PointerEvent, RefObject, SetStateAction } from "react";
import type { DeviceActionRequest, DeviceInfo } from "@mobile-automation/shared";

type PreviewMode = "scrcpy" | "scrcpy_connecting" | "screenshot";
type PreviewRenderer = "canvas" | "video";

type PreviewPanelProps = {
  devices: DeviceInfo[];
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
  scrcpyAvailable: boolean;
  scrcpyRunning: boolean;
  busy: boolean;
  inputText: string;
  setInputText: Dispatch<SetStateAction<string>>;
  setMessage: (message: string) => void;
  startScrcpy: () => Promise<void>;
  stopScrcpy: () => Promise<void>;
  runAction: (action: DeviceActionRequest) => Promise<void>;
  onSelectDevice: (device: DeviceInfo) => void;
  handleScreenshotLoaded: (image: HTMLImageElement) => void;
  onPreviewPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPreviewPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPreviewPointerCancel: () => void;
  compact?: boolean;
};

export function PreviewPanel({
  devices,
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
  scrcpyAvailable,
  scrcpyRunning,
  busy,
  inputText,
  setInputText,
  setMessage,
  startScrcpy,
  stopScrcpy,
  runAction,
  onSelectDevice,
  handleScreenshotLoaded,
  onPreviewPointerDown,
  onPreviewPointerUp,
  onPreviewPointerCancel,
  compact = false
}: PreviewPanelProps) {
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!deviceMenuOpen) {
      return undefined;
    }
    function closeOnOutsideClick(event: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setDeviceMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => window.removeEventListener("mousedown", closeOnOutsideClick);
  }, [deviceMenuOpen]);

  const previewStatus = formatPreviewStatus(previewMode, scrcpyStreamStatus, selectedDevice);
  const selectedDeviceMeta = selectedDevice
    ? `${selectedDevice.platform === "ios" ? "iOS" : "Android"}${selectedDevice.osVersion ? ` ${selectedDevice.osVersion}` : ""}${
        selectedDevice.resolution ? ` · ${selectedDevice.resolution.width} x ${selectedDevice.resolution.height}` : ""
      }`
    : "请选择设备";

  return (
    <section className="preview-column">
      <div className="preview-toolbar">
        <div className="preview-device-head">
          <div className="device-switcher" ref={switcherRef}>
            <button
              className="device-switch-button"
              type="button"
              onClick={() => setDeviceMenuOpen((value) => !value)}
              disabled={!devices.length}
              title="切换设备"
            >
              <Smartphone size={17} />
              <span>{selectedDevice?.name || "未选择设备"}</span>
              <ChevronDown size={16} />
            </button>
            {deviceMenuOpen && (
              <div className="device-switch-menu" role="menu">
                {devices.map((device) => (
                  <button
                    className={device.serial === selectedSerial ? "device-switch-item active" : "device-switch-item"}
                    key={device.serial}
                    type="button"
                    onClick={() => {
                      onSelectDevice(device);
                      setDeviceMenuOpen(false);
                    }}
                    role="menuitem"
                  >
                    <div>
                      <strong>{device.name || device.serial}</strong>
                      <span>{formatDeviceSwitchMeta(device)}</span>
                    </div>
                    {device.serial === selectedSerial && <Check size={16} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span>{selectedDeviceMeta} · {previewStatus}</span>
        </div>
        <div className="toolbar-actions">
          <button
            className="icon-button"
            disabled={!selectedSerial || busy || !selectedDevice?.capabilities.back}
            onClick={() => void runAction({ type: "back" })}
            title="返回"
          >
            <RotateCcw size={18} />
            返回
          </button>
          <button
            className="icon-button"
            disabled={!selectedSerial || busy || !selectedDevice?.capabilities.home}
            onClick={() => void runAction({ type: "home" })}
            title="Home"
          >
            <Home size={18} />
            Home
          </button>
          <button
            className="icon-button"
            disabled={!selectedSerial || busy || !selectedDevice?.capabilities.recentApps}
            onClick={() => void runAction({ type: "recent_apps" })}
            title={selectedDevice?.platform === "ios" ? "iOS 暂不支持最近任务" : "最近任务"}
          >
            <ListRestart size={18} />
            最近任务
          </button>
          {!compact && (
            <button
              className="icon-button debug-action"
              disabled={!selectedSerial || !scrcpyAvailable || selectedDevice?.platform !== "android"}
              onClick={() => (scrcpyRunning ? void stopScrcpy() : void startScrcpy())}
              title={scrcpyRunning ? "关闭原生 scrcpy 调试窗口" : "打开原生 scrcpy 调试窗口"}
            >
              <Square size={16} />
              {scrcpyRunning ? "关闭调试" : "调试窗口"}
            </button>
          )}
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
            {previewMode !== "scrcpy_connecting" && (selectedDevice?.capabilities.tap || selectedDevice?.capabilities.swipe) && (
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
            disabled={!inputText || !selectedSerial || busy || !selectedDevice?.capabilities.textInput}
            onClick={() => void runAction({ type: "input_text", text: inputText })}
            title="发送到设备当前焦点"
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

function formatPreviewStatus(previewMode: PreviewMode, rawStatus: string, selectedDevice?: DeviceInfo): string {
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
  if (rawStatus.includes("WebCodecs")) {
    return "截图预览";
  }
  return "截图预览";
}

function formatDeviceSwitchMeta(device: DeviceInfo): string {
  const platform = device.platform === "ios" ? "iOS" : "Android";
  const version = device.osVersion ? ` ${device.osVersion}` : "";
  const status = device.status === "online" ? "在线" : device.status;
  return `${platform}${version} · ${status} · ${device.serial}`;
}
