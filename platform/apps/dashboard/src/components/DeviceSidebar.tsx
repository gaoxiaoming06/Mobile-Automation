import type { DeviceInfo, TestRun } from "@mobile-automation/shared";
import { controllableDevices } from "../device-availability";

type DeviceSidebarProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  runs: TestRun[];
  onSelectDevice: (device: DeviceInfo) => void;
};

export function DeviceSidebar({
  devices,
  selectedSerial,
  runs,
  onSelectDevice
}: DeviceSidebarProps) {
  const selectableDevices = controllableDevices(devices);
  const hiddenUnavailableCount = devices.length - selectableDevices.length;

  return (
    <aside className="sidebar">
      <div className="panel">
        <h2>设备</h2>
        <div className="device-list">
          {selectableDevices.map((device) => {
            const activeRun = runs.find((run) => run.deviceSerial === device.serial && isActiveRun(run));
            return (
              <button
                key={device.serial}
                className={[device.serial === selectedSerial ? "device-item active" : "device-item", activeRun ? "device-busy" : ""].filter(Boolean).join(" ")}
                onClick={() => onSelectDevice(device)}
              >
                <strong>{device.name || device.serial}</strong>
                <span>{device.serial}</span>
                <span>
                  {device.platform === "ios" ? "iOS" : "Android"}
                  {device.osVersion ? ` ${device.osVersion}` : ""} · {device.status}
                  {device.capabilities.tap ? " · 可控制" : device.capabilities.preview ? " · 只预览" : " · 不可用"}
                </span>
                {activeRun && <span className="busy-badge">执行中：{activeRun.caseName}</span>}
              </button>
            );
          })}
          {!selectableDevices.length && <div className="empty">未发现可控制设备</div>}
          {hiddenUnavailableCount > 0 && <div className="device-hidden-note">已隐藏 {hiddenUnavailableCount} 台不可控制设备</div>}
        </div>
      </div>
    </aside>
  );
}

function isActiveRun(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}
