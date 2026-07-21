import { describe, expect, it } from "vitest";
import { defaultSelectedDeviceSerial, loadSelectedDeviceSerial, saveSelectedDeviceSerial } from "./useDeviceList";
import { defaultAndroidCapabilities, type DeviceInfo } from "@mobile-automation/shared";

describe("useDeviceList defaults", () => {
  it("keeps the current device selected when it is still connected", () => {
    expect(defaultSelectedDeviceSerial([device("ios-1", "ios"), device("android-1", "android")], "ios-1")).toBe("ios-1");
  });

  it("moves selection away from an unavailable current device", () => {
    expect(defaultSelectedDeviceSerial([unavailableDevice("ios-1", "ios"), device("android-1", "android")], "ios-1")).toBe("android-1");
  });

  it("does not select a discovered device when none can be controlled", () => {
    expect(defaultSelectedDeviceSerial([unavailableDevice("ios-1", "ios")], "")).toBe("");
  });

  it("selects an online Android device by default when there is no current selection", () => {
    expect(defaultSelectedDeviceSerial([device("ios-1", "ios"), device("android-1", "android")], "")).toBe("android-1");
  });

  it("stores and restores the selected device serial across refreshes", () => {
    const storage = new MemoryStorage();

    saveSelectedDeviceSerial(" YAL-AL10 ", storage);

    expect(loadSelectedDeviceSerial(storage)).toBe("YAL-AL10");
    expect(defaultSelectedDeviceSerial([device("BAH3-W59", "android"), device("YAL-AL10", "android")], loadSelectedDeviceSerial(storage))).toBe(
      "YAL-AL10"
    );
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function device(serial: string, platform: DeviceInfo["platform"]): DeviceInfo {
  return {
    id: serial,
    serial,
    platform,
    name: serial,
    status: "online",
    resolution: { width: 1080, height: 2400 },
    orientation: "portrait",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: "2026-07-01T00:00:00.000Z"
  };
}

function unavailableDevice(serial: string, platform: DeviceInfo["platform"]): DeviceInfo {
  return {
    ...device(serial, platform),
    status: "offline",
    capabilities: {
      ...defaultAndroidCapabilities(),
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
      closeApp: false
    }
  };
}
