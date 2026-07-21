import type { DeviceInfo } from "@mobile-automation/shared";

export function isControllableDevice(device: Pick<DeviceInfo, "status" | "capabilities">): boolean {
  return device.status === "online" && (device.capabilities.tap || device.capabilities.swipe);
}

export function controllableDevices<T extends Pick<DeviceInfo, "status" | "capabilities">>(devices: T[]): T[] {
  return devices.filter(isControllableDevice);
}
