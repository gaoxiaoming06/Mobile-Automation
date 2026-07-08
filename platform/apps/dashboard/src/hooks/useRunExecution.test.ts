import type { TestRun } from "@mobile-automation/shared";
import { describe, expect, it } from "vitest";
import { runListRefreshIntervalMs } from "./useRunExecution.js";

describe("useRunExecution helpers", () => {
  it("polls execution records slowly when idle and quickly while a run is active", () => {
    expect(runListRefreshIntervalMs([])).toBe(5000);
    expect(runListRefreshIntervalMs([testRun("passed")])).toBe(5000);
    expect(runListRefreshIntervalMs([testRun("running")])).toBe(1000);
    expect(runListRefreshIntervalMs([testRun("paused")])).toBe(1000);
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
