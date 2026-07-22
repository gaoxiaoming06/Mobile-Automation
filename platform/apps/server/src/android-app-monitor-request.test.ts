import { describe, expect, it } from "vitest";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";

describe("readAndroidAppMonitorConfig", () => {
  it("cleans valid android app monitor config", () => {
    expect(
      readAndroidAppMonitorConfig({
        enabled: true,
        packageName: " com.example.app ",
        includeSubprocesses: false,
        processFilters: [":push", "", 12],
        cpuIntervalMs: 1000,
        memoryIntervalMs: -1,
        lifecycleIntervalMs: Number.NaN,
        enableHeapDump: true,
        thresholds: {
          cpuPercent: { enabled: true, value: 80, sustainMs: 5000, cooldownMs: 30000 },
          pssMb: { enabled: true, value: "512", sustainMs: 0, cooldownMs: -1 },
          ignored: { enabled: true, value: 1 }
        },
        extra: "drop me"
      })
    ).toEqual({
      enabled: true,
      packageName: "com.example.app",
      includeSubprocesses: false,
      processFilters: [":push"],
      cpuIntervalMs: 1000,
      enableHeapDump: true,
      thresholds: {
        cpuPercent: { enabled: true, value: 80, sustainMs: 5000, cooldownMs: 30000 },
        pssMb: { enabled: true, value: 512, sustainMs: 5000, cooldownMs: 30000 }
      }
    });
  });

  it("requires packageName only when enabled", () => {
    expect(readAndroidAppMonitorConfig({ enabled: false })).toEqual({ enabled: false, packageName: "", includeSubprocesses: true });
    expect(() => readAndroidAppMonitorConfig({ enabled: true, packageName: " " })).toThrow("androidAppMonitor.packageName is required when enabled");
  });
});
