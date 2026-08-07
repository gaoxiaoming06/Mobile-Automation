import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, type DeviceInfo } from "@mobile-automation/shared";
import { currentDeviceLease, isAgentDevice, isDeviceLockedByOtherOwner } from "./device-availability";

describe("device availability", () => {
  it("detects server-agent devices by agent metadata", () => {
    expect(isAgentDevice(device("local-android"))).toBe(false);
    expect(isAgentDevice(agentDevice("agent-a:android:local-android"))).toBe(true);
  });

  it("detects device leases owned by another browser", () => {
    const leased = {
      ...agentDevice("agent-a:android:local-android"),
      currentLease: {
        id: "lease-1",
        type: "manual_control",
        ownerId: "browser-a",
        acquiredAt: "2026-08-07T08:00:00.000Z",
        renewedAt: "2026-08-07T08:00:00.000Z",
        expiresAt: "2026-08-07T08:01:00.000Z"
      }
    } as DeviceInfo;

    expect(currentDeviceLease(leased)?.id).toBe("lease-1");
    expect(isDeviceLockedByOtherOwner(leased, "browser-b")).toBe(true);
    expect(isDeviceLockedByOtherOwner(leased, "browser-a")).toBe(false);
  });
});

function device(serial: string): DeviceInfo {
  return {
    id: serial,
    serial,
    platform: "android",
    name: serial,
    status: "online",
    resolution: { width: 1080, height: 2400 },
    orientation: "portrait",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: "2026-07-01T00:00:00.000Z"
  };
}

function agentDevice(serial: string): DeviceInfo {
  return {
    ...device(serial),
    agent: {
      agentId: "agent-a",
      deviceKey: serial,
      serial: "local-android",
      visibility: "public"
    }
  } as DeviceInfo;
}
