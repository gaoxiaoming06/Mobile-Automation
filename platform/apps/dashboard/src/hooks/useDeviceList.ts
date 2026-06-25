import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceInfo, ToolStatus } from "@mobile-automation/shared";
import { apiFetchJson } from "../api";

type UseDeviceListOptions = {
  setMessage: (message: string) => void;
};

export function useDeviceList({ setMessage }: UseDeviceListOptions) {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedSerial, setSelectedSerial] = useState("");
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [scrcpyRunning, setScrcpyRunning] = useState(false);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.serial === selectedSerial),
    [devices, selectedSerial]
  );

  const scrcpyAvailable = tools.some((tool) => tool.name === "scrcpy" && tool.available);

  const refreshDevices = useCallback(async (options: { silent?: boolean } = {}) => {
    const json = await apiFetchJson<{ devices: DeviceInfo[]; error?: string }>("/api/devices");
    setDevices(json.devices);
    setSelectedSerial((current) => (json.devices.some((device) => device.serial === current) ? current : json.devices[0]?.serial || ""));
    if (!options.silent) {
      const androidCount = json.devices.filter((device) => device.platform === "android").length;
      const iosCount = json.devices.filter((device) => device.platform === "ios").length;
      setMessage(json.devices.length ? `发现 ${json.devices.length} 台设备（Android ${androidCount} / iOS ${iosCount}）` : "没有发现可管理设备");
    }
  }, [setMessage]);

  const refreshTools = useCallback(async () => {
    const json = await apiFetchJson<{ tools: ToolStatus[] }>("/api/system/tools");
    setTools(json.tools);
  }, []);

  const refreshScrcpySessions = useCallback(async () => {
    const json = await apiFetchJson<{ sessions: Array<{ serial: string; status: string }> }>("/api/scrcpy/sessions");
    setScrcpyRunning(Boolean(selectedSerial && json.sessions.some((session) => session.serial === selectedSerial && session.status === "running")));
  }, [selectedSerial]);

  const selectDevice = useCallback((device: DeviceInfo, beforeSelect?: () => void) => {
    beforeSelect?.();
    setSelectedSerial(device.serial);
    setScrcpyRunning(false);
  }, []);

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
