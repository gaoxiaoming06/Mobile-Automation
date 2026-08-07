import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, defaultHarmonyCapabilities, type DeviceInfo } from "@mobile-automation/shared";
import {
  nextScreenshotPreviewOnRefreshSuccess,
  nextScreenshotPreviewOnRefreshFailure,
  previewStreamPathForDevice,
  realtimePreviewRetryDelayMs,
  screenshotPollingPauseMsForAction,
  screenshotPreviewCacheKey,
  screenshotRefreshDelaysAfterAction,
  shouldRetryRealtimePreview,
  webSocketOriginForRealtimePreview
} from "./useScrcpyStream";

describe("screenshotRefreshDelaysAfterAction", () => {
  it("bursts refreshes after actions for screenshot preview devices", () => {
    expect(screenshotRefreshDelaysAfterAction({ previewMode: "screenshot", screenshotCapable: true })).toEqual([0, 300, 900, 1800]);
  });

  it("does not schedule screenshot refreshes while scrcpy realtime preview is active", () => {
    expect(screenshotRefreshDelaysAfterAction({ previewMode: "scrcpy", screenshotCapable: true })).toEqual([]);
    expect(screenshotRefreshDelaysAfterAction({ previewMode: "scrcpy_connecting", screenshotCapable: true })).toEqual([]);
  });

  it("pauses screenshot polling while screenshot-preview actions are in flight", () => {
    expect(screenshotPollingPauseMsForAction({ previewMode: "screenshot", screenshotCapable: true })).toBe(4000);
    expect(screenshotPollingPauseMsForAction({ previewMode: "scrcpy", screenshotCapable: true })).toBe(0);
    expect(screenshotPollingPauseMsForAction({ previewMode: "screenshot", screenshotCapable: false })).toBe(0);
  });
});

describe("previewStreamPathForDevice", () => {
  it("uses Android scrcpy WebSocket path for Android devices", () => {
    expect(previewStreamPathForDevice("agent-a:android:pixel-1", device("android"))).toBe(
      "/api/devices/agent-a%3Aandroid%3Apixel-1/scrcpy/ws"
    );
  });

  it("keeps Harmony devices on screenshot preview even when the agent still advertises experimental stream capability", () => {
    expect(previewStreamPathForDevice("agent-a:harmony:harmony-1", {
      ...device("harmony"),
      capabilities: {
        ...defaultHarmonyCapabilities(),
        harmonyScreenStream: true
      }
    })).toBeNull();
    expect(previewStreamPathForDevice("agent-a:harmony:harmony-1", {
      ...device("harmony"),
      capabilities: defaultHarmonyCapabilities()
    })).toBeNull();
  });
});

describe("realtime preview reconnect policy", () => {
  it("does not retry Harmony realtime preview while the experimental entry is disabled", () => {
    expect(
      shouldRetryRealtimePreview({
        canUseEmbeddedScrcpy: true,
        enabled: true,
        platform: "harmony",
        selectedSerial: "agent-a:harmony:harmony-1",
        status: "online"
      })
    ).toBe(false);
  });

  it("does not retry when realtime preview cannot run", () => {
    expect(
      shouldRetryRealtimePreview({
        canUseEmbeddedScrcpy: false,
        enabled: true,
        platform: "harmony",
        selectedSerial: "agent-a:harmony:harmony-1",
        status: "online"
      })
    ).toBe(false);
    expect(
      shouldRetryRealtimePreview({
        canUseEmbeddedScrcpy: true,
        enabled: true,
        platform: "ios",
        selectedSerial: "agent-a:ios:iphone-1",
        status: "online"
      })
    ).toBe(false);
  });

  it("backs off reconnects and caps the delay", () => {
    expect(realtimePreviewRetryDelayMs(0)).toBe(800);
    expect(realtimePreviewRetryDelayMs(1)).toBe(1500);
    expect(realtimePreviewRetryDelayMs(99)).toBe(5000);
  });
});

describe("screenshot preview cache", () => {
  it("builds a per-device cache key for the last screenshot", () => {
    expect(screenshotPreviewCacheKey("agent-a:harmony:harmony-1")).toBe("mobile-automation:last-screenshot:agent-a%3Aharmony%3Aharmony-1");
  });

  it("keeps the previous object URL alive until the refreshed screenshot is loaded", () => {
    expect(nextScreenshotPreviewOnRefreshSuccess({
      currentUrl: "blob:old-frame",
      nextUrl: "blob:new-frame"
    })).toEqual({
      url: "blob:new-frame",
      revokeAfterLoad: ["blob:old-frame"]
    });
  });

  it("keeps the last screenshot visible when a refresh fails", () => {
    expect(nextScreenshotPreviewOnRefreshFailure({
      currentUrl: "blob:last-frame",
      message: "截图获取失败"
    })).toEqual({
      url: "blob:last-frame",
      error: ""
    });
  });

  it("shows an error when there is no cached screenshot", () => {
    expect(nextScreenshotPreviewOnRefreshFailure({
      currentUrl: "",
      message: "截图获取失败"
    })).toEqual({
      url: "",
      error: "截图获取失败"
    });
  });
});

describe("realtime preview WebSocket origin", () => {
  it("uses the dashboard HTTPS origin in Vite dev so the browser trusts one certificate", () => {
    expect(webSocketOriginForRealtimePreview(undefined, {
      protocol: "https:",
      hostname: "10.254.32.11",
      port: "5173",
      origin: "https://10.254.32.11:5173"
    })).toBe("wss://10.254.32.11:5173");
  });

  it("keeps the direct API port for plain HTTP Vite dev", () => {
    expect(webSocketOriginForRealtimePreview(undefined, {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "5173",
      origin: "http://127.0.0.1:5173"
    })).toBe("ws://127.0.0.1:4010");
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
