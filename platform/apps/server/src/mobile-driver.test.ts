import { describe, expect, it, vi } from "vitest";
import { type AndroidDriver } from "@mobile-automation/android-driver";
import { type IosDriver } from "@mobile-automation/ios-driver";
import { type AndroidAppMonitorConfig } from "@mobile-automation/shared";
import { MobileDriver } from "./mobile-driver.js";

const monitorConfig: AndroidAppMonitorConfig = {
  enabled: true,
  packageName: "cn.eeo.classin"
};

describe("MobileDriver app monitor", () => {
  it("passes Android app monitor sessions through to the Android driver", async () => {
    const session = {
      start: vi.fn(),
      stop: vi.fn(),
      getSummary: vi.fn()
    };
    const startAppMonitor = vi.fn(async () => session);
    const driver = new MobileDriver(
      {
        listDevices: vi.fn(async () => [androidDevice()]),
        startAppMonitor
      } as unknown as AndroidDriver,
      { listDevices: vi.fn(async () => []) } as unknown as IosDriver
    );
    const writeTextArtifact = vi.fn(async () => ({ id: "artifact-1" }));
    const callbacks = { onIncident: vi.fn() };

    await expect(driver.startAppMonitor("android-1", "run-1", monitorConfig, writeTextArtifact, callbacks)).resolves.toBe(session);
    expect(startAppMonitor).toHaveBeenCalledWith("android-1", "run-1", monitorConfig, writeTextArtifact, callbacks);
  });

  it("returns a no-op disabled monitor session for iOS devices", async () => {
    const driver = new MobileDriver(
      { listDevices: vi.fn(async () => []) } as unknown as AndroidDriver,
      { listDevices: vi.fn(async () => [iosDevice()]) } as unknown as IosDriver
    );

    const session = await driver.startAppMonitor("ios-1", "run-1", monitorConfig, vi.fn());
    const summary = await session.stop();

    expect(summary).toEqual(
      expect.objectContaining({
        packageName: "cn.eeo.classin",
        processes: [],
        sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 },
        incidents: [],
        endedAt: expect.any(String)
      })
    );
  });
});

function androidDevice() {
  return {
    id: "android-1",
    serial: "android-1",
    platform: "android" as const,
    status: "online" as const,
    capabilities: emptyCapabilities(),
    lastSeenAt: "2026-07-22T00:00:00.000Z"
  };
}

function iosDevice() {
  return {
    id: "ios-1",
    serial: "ios-1",
    platform: "ios" as const,
    status: "online" as const,
    capabilities: emptyCapabilities(),
    lastSeenAt: "2026-07-22T00:00:00.000Z"
  };
}

function emptyCapabilities() {
  return {
    preview: false,
    tap: false,
    longPress: false,
    swipe: false,
    back: false,
    home: false,
    recentApps: false,
    textInput: false,
    screenshot: false,
    launchApp: false,
    closeApp: false,
    recordVideo: false,
    metrics: {
      cpu: false,
      memory: false,
      fps: false,
      network: false,
      battery: false,
      temperature: false
    },
    events: {
      crash: false,
      anr: false,
      logs: false
    }
  };
}
