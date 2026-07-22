import type { TestRun } from "@mobile-automation/shared";
import { describe, expect, it } from "vitest";
import { buildAndroidAppMonitorRequest, runListRefreshIntervalMs } from "./useRunExecution.js";

describe("useRunExecution helpers", () => {
  it("polls execution records slowly when idle and quickly while a run is active", () => {
    expect(runListRefreshIntervalMs([])).toBe(5000);
    expect(runListRefreshIntervalMs([testRun("passed")])).toBe(5000);
    expect(runListRefreshIntervalMs([testRun("running")])).toBe(1000);
    expect(runListRefreshIntervalMs([testRun("paused")])).toBe(1000);
  });

  it("builds android app monitor request config with start package fallback", () => {
    expect(
      buildAndroidAppMonitorRequest({
        enabled: true,
        packageName: "",
        startAppPackageName: "com.example.app",
        includeSubprocesses: true,
        cpuThresholdEnabled: true,
        cpuThresholdPercent: 75,
        memoryThresholdEnabled: true,
        memoryThresholdMb: 640,
        enableHeapDump: true
      })
    ).toEqual({
      enabled: true,
      packageName: "com.example.app",
      includeSubprocesses: true,
      enableHeapDump: true,
      thresholds: {
        cpuPercent: { enabled: true, value: 75, sustainMs: 5000, cooldownMs: 30000 },
        pssMb: { enabled: true, value: 640, sustainMs: 5000, cooldownMs: 30000 }
      }
    });
  });

  it("omits android app monitor request config when disabled", () => {
    expect(
      buildAndroidAppMonitorRequest({
        enabled: false,
        packageName: "com.example.app",
        startAppPackageName: "",
        includeSubprocesses: true,
        cpuThresholdEnabled: false,
        cpuThresholdPercent: 75,
        memoryThresholdEnabled: false,
        memoryThresholdMb: 640,
        enableHeapDump: false
      })
    ).toBeUndefined();
  });
});

function testRun(status: TestRun["status"]): TestRun {
  return {
    id: `run-${status}`,
    caseName: `run ${status}`,
    deviceSerial: "device-1",
    status,
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 400,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false
    },
    steps: [],
    stepResults: [],
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: "2026-07-07T10:00:00.000Z"
  };
}
