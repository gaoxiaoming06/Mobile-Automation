import { describe, expect, it, vi } from "vitest";
import { type AndroidDriver } from "@mobile-automation/android-driver";
import { type HarmonyDriver } from "@mobile-automation/harmony-driver";
import { type IosDriver } from "@mobile-automation/ios-driver";
import {
  defaultAndroidCapabilities,
  defaultHarmonyCapabilities,
  nowIso,
  type AndroidAppMonitorConfig,
  type DeviceActionRequest,
  type DeviceInfo
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver } from "./device-driver.js";
import { MobileDriver } from "./mobile-driver.js";

const monitorConfig: AndroidAppMonitorConfig = {
  enabled: true,
  packageName: "cn.eeo.classin"
};

describe("MobileDriver app monitor", () => {
  it("routes HarmonyOS device actions to harmony driver", async () => {
    const android = fakeDriver("android");
    const ios = fakeDriver("ios");
    const harmony = fakeDriver("harmony");
    harmony.listDevices = async () => [
      {
        id: "HARMONY",
        serial: "HARMONY",
        platform: "harmony",
        status: "online",
        capabilities: defaultHarmonyCapabilities(),
        lastSeenAt: nowIso()
      }
    ];

    const driver = new MobileDriver(
      android as unknown as AndroidDriver,
      ios as unknown as IosDriver,
      harmony as unknown as HarmonyDriver
    );
    await driver.listDevices();
    await driver.performAction("HARMONY", { type: "tap", x: 1, y: 2 });

    expect(harmony.performedActions).toEqual([{ type: "tap", x: 1, y: 2 }]);
    expect(android.performedActions).toEqual([]);
    expect(ios.performedActions).toEqual([]);
  });

  it("routes HarmonyOS UI hierarchy dumps to the harmony driver", async () => {
    const android = fakeDriver("android");
    const ios = fakeDriver("ios");
    const harmony = fakeDriver("harmony");
    harmony.listDevices = async () => [
      {
        id: "HARMONY",
        serial: "HARMONY",
        platform: "harmony",
        status: "online",
        capabilities: defaultHarmonyCapabilities(),
        lastSeenAt: nowIso()
      }
    ];
    harmony.dumpUiHierarchy = vi.fn(async () => "<hierarchy><node bounds=\"[0,0][1,1]\" /></hierarchy>");
    const driver = new MobileDriver(
      android as unknown as AndroidDriver,
      ios as unknown as IosDriver,
      harmony as unknown as HarmonyDriver
    );

    await driver.listDevices();
    await expect(driver.dumpUiHierarchy("HARMONY")).resolves.toContain("<hierarchy>");

    expect(harmony.dumpUiHierarchy).toHaveBeenCalledWith("HARMONY");
  });

  it("keeps Android and iOS devices visible when HarmonyOS discovery is unavailable", async () => {
    const android = fakeDriver("android");
    android.listDevices = async () => [androidDevice()];
    const ios = fakeDriver("ios");
    ios.listDevices = async () => [iosDevice()];
    const harmony = fakeDriver("harmony");
    harmony.listDevices = async () => {
      throw new Error("hdc not found");
    };
    const driver = new MobileDriver(
      android as unknown as AndroidDriver,
      ios as unknown as IosDriver,
      harmony as unknown as HarmonyDriver
    );

    await expect(driver.listDevices()).resolves.toMatchObject([
      { serial: "android-1", platform: "android" },
      { serial: "ios-1", platform: "ios" }
    ]);
  });

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

function fakeDriver(platform: DeviceInfo["platform"]): AutomationDeviceDriver & { performedActions: DeviceActionRequest[] } {
  return {
    performedActions: [],
    async getToolStatus() {
      return [];
    },
    async listDevices() {
      return [];
    },
    async getDeviceInfo(serial: string) {
      return {
        id: serial,
        serial,
        platform,
        status: "online",
        capabilities: platform === "harmony" ? defaultHarmonyCapabilities() : defaultAndroidCapabilities(),
        lastSeenAt: nowIso()
      };
    },
    async screenshot() {
      return Buffer.from([]);
    },
    async performAction(_serial: string, action: DeviceActionRequest) {
      this.performedActions.push(action);
      return { driverChannel: platform === "harmony" ? "hdc_input" : "mock" };
    },
    async clearAppData() {
      return undefined;
    },
    async collectLogs() {
      return "";
    },
    async samplePerformance(serial: string, runId: string) {
      return { id: "metric", runId, deviceSerial: serial, sampledAt: nowIso() };
    },
    async startVideoRecording() {
      throw new Error("recording unsupported in fake driver");
    },
    async stopVideoRecording() {
      return undefined;
    }
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
