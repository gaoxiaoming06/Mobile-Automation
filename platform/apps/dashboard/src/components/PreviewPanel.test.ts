import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, defaultHarmonyCapabilities, type DeviceInfo } from "@mobile-automation/shared";
import { devicePlatformLabel, formatPreviewStatus } from "./PreviewPanel.js";

describe("devicePlatformLabel", () => {
  it("labels HarmonyOS devices explicitly", () => {
    expect(devicePlatformLabel("harmony")).toBe("HarmonyOS");
    expect(devicePlatformLabel("android")).toBe("Android");
    expect(devicePlatformLabel("ios")).toBe("iOS");
  });
});

describe("formatPreviewStatus", () => {
  it("keeps Harmony on screenshot preview while the experimental realtime entry is disabled", () => {
    const harmonyDevice = device("harmony");
    expect(formatPreviewStatus("screenshot", "实时预览已断开，1 秒后自动重连", harmonyDevice)).toBe("截图预览");
    expect(formatPreviewStatus("screenshot", "当前浏览器不支持 WebCodecs，使用截图预览", harmonyDevice)).toBe("截图预览");
  });

  it("keeps plain screenshot status when no realtime detail exists", () => {
    expect(formatPreviewStatus("screenshot", "HarmonyOS 截图预览", device("harmony"))).toBe("截图预览");
  });
});

function device(platform: DeviceInfo["platform"]): DeviceInfo {
  return {
    id: `${platform}-1`,
    serial: `${platform}-1`,
    platform,
    status: "online",
    resolution: { width: 1080, height: 2400 },
    capabilities: platform === "harmony" ? defaultHarmonyCapabilities() : defaultAndroidCapabilities(),
    lastSeenAt: "2026-08-07T00:00:00.000Z"
  };
}
