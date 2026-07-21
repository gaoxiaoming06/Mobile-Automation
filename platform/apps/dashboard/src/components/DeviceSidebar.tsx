import { FolderOpen, Play, Trash2 } from "lucide-react";
import type { DeviceInfo, TestCase, TestRun } from "@mobile-automation/shared";
import { controllableDevices } from "../device-availability";

type DeviceSidebarProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  cases: TestCase[];
  runs: TestRun[];
  selectedDeviceBusy: boolean;
  showCases?: boolean;
  onSelectDevice: (device: DeviceInfo) => void;
  onLoadCase: (caseId: string) => Promise<void>;
  onStartRun: (caseId: string) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
};

export function DeviceSidebar({
  devices,
  selectedSerial,
  cases,
  runs,
  selectedDeviceBusy,
  showCases = true,
  onSelectDevice,
  onLoadCase,
  onStartRun,
  onDeleteCase
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

      {showCases && (
        <div className="panel">
          <h2>已保存用例</h2>
          <div className="case-list">
            {cases.map((item) => (
              <div className="case-item" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.updatedAt}</span>
                </div>
                <div className="case-actions">
                  <button className="icon-button compact" onClick={() => void onLoadCase(item.id)} title="加载编辑">
                    <FolderOpen size={16} />
                  </button>
                  <button className="icon-button compact" onClick={() => void onStartRun(item.id)} disabled={selectedDeviceBusy} title={selectedDeviceBusy ? "当前设备正在执行用例" : "执行用例"}>
                    <Play size={16} />
                  </button>
                  <button className="icon-button compact danger" onClick={() => void onDeleteCase(item.id)} title="删除用例">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {!cases.length && <div className="empty">暂无保存用例</div>}
          </div>
        </div>
      )}
    </aside>
  );
}

function isActiveRun(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}
