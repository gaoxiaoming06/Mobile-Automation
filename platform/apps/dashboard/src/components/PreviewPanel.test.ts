import { describe, expect, it } from "vitest";
import { devicePlatformLabel } from "./PreviewPanel.js";

describe("devicePlatformLabel", () => {
  it("labels HarmonyOS devices explicitly", () => {
    expect(devicePlatformLabel("harmony")).toBe("HarmonyOS");
    expect(devicePlatformLabel("android")).toBe("Android");
    expect(devicePlatformLabel("ios")).toBe("iOS");
  });
});
