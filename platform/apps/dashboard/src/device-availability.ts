import type { DeviceInfo, DeviceLease } from "@mobile-automation/shared";

type DeviceInfoWithAgentMeta = DeviceInfo & {
  agent?: unknown;
  currentLease?: DeviceLease;
};

export function isControllableDevice(device: Pick<DeviceInfo, "status" | "capabilities">): boolean {
  return device.status === "online" && (device.capabilities.tap || device.capabilities.swipe);
}

export function controllableDevices<T extends Pick<DeviceInfo, "status" | "capabilities">>(devices: T[]): T[] {
  return devices.filter(isControllableDevice);
}

export function isDeviceSelectableByOwner(device: DeviceInfo, ownerId = ""): boolean {
  return isControllableDevice(device) && !isDeviceLockedByOtherOwner(device, ownerId);
}

export function selectableDevicesForOwner<T extends DeviceInfo>(devices: T[], ownerId = ""): T[] {
  return devices.filter((device) => isDeviceSelectableByOwner(device, ownerId));
}

export function isAgentDevice(device?: DeviceInfo): boolean {
  return Boolean((device as DeviceInfoWithAgentMeta | undefined)?.agent);
}

export function currentDeviceLease(device?: DeviceInfo): DeviceLease | undefined {
  return (device as DeviceInfoWithAgentMeta | undefined)?.currentLease;
}

export function isDeviceLockedByOtherOwner(device: DeviceInfo | undefined, ownerId: string): boolean {
  const lease = currentDeviceLease(device);
  return Boolean(lease && lease.ownerId !== ownerId);
}
