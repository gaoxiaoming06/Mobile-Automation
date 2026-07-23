import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, type DeviceInfo } from "@mobile-automation/shared";
import { DeviceSidebar } from "./DeviceSidebar";

describe("DeviceSidebar", () => {
  it("shows only online controllable devices in the selectable list", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DeviceSidebar, {
        devices: [device("android-1", "android"), unavailableDevice("ios-1", "ios")],
        selectedSerial: "android-1",
        runs: [],
        onSelectDevice: () => undefined
      })
    );

    expect(markup).toContain("android-1");
    expect(markup).not.toContain("ios-1");
    expect(markup).toContain("已隐藏 1 台不可控制设备");
  });
});

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
