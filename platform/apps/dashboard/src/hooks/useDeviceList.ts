import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceInfo, ToolStatus } from "@mobile-automation/shared";
import { apiFetchJson } from "../api";
import { controllableDevices, isControllableDevice, isDeviceLockedByOtherOwner, isDeviceSelectableByOwner, selectableDevicesForOwner } from "../device-availability";

type UseDeviceListOptions = {
  setMessage: (message: string) => void;
  controlOwnerId?: string;
};

type DeviceSelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const selectedDeviceSerialStorageKey = "mobile-automation.selected-device-serial";

export function defaultSelectedDeviceSerial(devices: DeviceInfo[], currentSerial: string, ownerId = ""): string {
  const selectableDevices = selectableDevicesForOwner(devices, ownerId);
  if (selectableDevices.some((device) => device.serial === currentSerial)) {
    return currentSerial;
  }
  return selectableDevices[0]?.serial ?? "";
}

export function loadSelectedDeviceSerial(storage: DeviceSelectionStorage | undefined = browserDeviceSelectionStorage()): string {
  try {
    return storage?.getItem(selectedDeviceSerialStorageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveSelectedDeviceSerial(serial: string, storage: DeviceSelectionStorage | undefined = browserDeviceSelectionStorage()): void {
  try {
    const trimmed = serial.trim();
    if (!storage) {
      return;
    }
    if (trimmed) {
      storage.setItem(selectedDeviceSerialStorageKey, trimmed);
    } else {
      storage.removeItem(selectedDeviceSerialStorageKey);
    }
  } catch {
    // Ignore storage failures; device selection can still work in memory.
  }
}

export function useDeviceList({ setMessage, controlOwnerId = "" }: UseDeviceListOptions) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedSerial, setSelectedSerial] = useState(() => loadSelectedDeviceSerial());
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [scrcpyRunning, setScrcpyRunning] = useState(false);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedSerial),
    [devices, selectedSerial]
  );

  const scrcpyAvailable = tools.some((tool) => tool.name === "scrcpy" && tool.available);

  const refreshDevices = useCallback(async (options: { silent?: boolean } = {}) => {
    const query = controlOwnerId ? `?sessionId=${encodeURIComponent(controlOwnerId)}` : "";
    const json = await apiFetchJson<{ devices: DeviceInfo[]; error?: string }>(`/api/devices${query}`);
    setDevices(json.devices);
    setSelectedSerial((current) => {
      const next = defaultSelectedDeviceSerial(json.devices, current, controlOwnerId);
      saveSelectedDeviceSerial(next);
      return next;
    });
    if (!options.silent) {
      const controllableCount = json.devices.filter(isControllableDevice).length;
      const selectableCount = json.devices.filter((device) => isDeviceSelectableByOwner(device, controlOwnerId)).length;
      const occupiedCount = controllableCount - selectableCount;
      const unavailableCount = json.devices.length - controllableCount;
      setMessage(
        selectableCount
          ? `发现 ${selectableCount} 台可选择设备${occupiedCount ? `（${occupiedCount} 台被占用）` : ""}${unavailableCount ? `（已隐藏 ${unavailableCount} 台不可控制设备）` : ""}`
          : controllableCount
            ? `可控制设备均被占用（${controllableCount} 台）`
            : unavailableCount
            ? `没有发现可控制设备（已隐藏 ${unavailableCount} 台不可控制设备）`
            : "没有发现可管理设备"
      );
    }
  }, [controlOwnerId, setMessage]);

  const refreshTools = useCallback(async () => {
    const json = await apiFetchJson<{ tools: ToolStatus[] }>("/api/system/tools");
    setTools(json.tools);
  }, []);

  const refreshScrcpySessions = useCallback(async () => {
    const json = await apiFetchJson<{ sessions: Array<{ serial: string; status: string }> }>("/api/scrcpy/sessions");
    setScrcpyRunning(Boolean(selectedSerial && json.sessions.some((session) => session.serial === selectedSerial && session.status === "running")));
  }, [selectedSerial]);

  const selectDevice = useCallback((device: DeviceInfo, beforeSelect?: () => void) => {
    if (!isDeviceSelectableByOwner(device, controlOwnerId)) {
      const message = isDeviceLockedByOtherOwner(device, controlOwnerId) ? "设备正在被其他客户端占用" : "当前设备不可控制";
      setMessage(message);
      return;
    }
    beforeSelect?.();
    saveSelectedDeviceSerial(device.serial);
    setSelectedSerial(device.serial);
    setScrcpyRunning(false);
  }, [controlOwnerId, setMessage]);

  useEffect(() => {
    refreshDevices().catch((error) => setMessage(error.message));
    refreshTools().catch(() => undefined);
  }, [refreshDevices, refreshTools, setMessage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshDevices({ silent: true }).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshDevices]);

  useEffect(() => {
    refreshScrcpySessions().catch(() => undefined);
  }, [refreshScrcpySessions]);

  return {
    devices,
    selectedSerial,
    selectedDevice,
    tools,
    scrcpyAvailable,
    scrcpyRunning,
    setScrcpyRunning,
    refreshDevices,
    selectDevice
  };
}

function browserDeviceSelectionStorage(): DeviceSelectionStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}
