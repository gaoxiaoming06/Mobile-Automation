import { describe, expect, it } from "vitest";
import { publicExecutionFailureFromRun, type TestRun } from "./index.js";

describe("publicExecutionFailureFromRun", () => {
  it("classifies an ambiguous semantic target without exposing locator details", () => {
    const failure = publicExecutionFailureFromRun(failedRun({
      errorCode: "SEMANTIC_TARGET_NOT_FOUND",
      errorMessage: "Found duplicate OCR candidates at [12,34] and [56,78]",
      metadata: { semantic: { reason: "ambiguous_target", candidates: [{ x: 12, y: 34 }] } }
    }));

    expect(failure).toEqual({
      kind: "target_ambiguous",
      message: "当前操作匹配到多个目标，请补充位置、附近文字或更明确的操作描述。",
      nextAction: "supplement_process"
    });
    expect(JSON.stringify(failure)).not.toContain("12,34");
  });

  it("distinguishes leaving the target app from an unrecognized page", () => {
    expect(publicExecutionFailureFromRun(failedRun({
      errorCode: "PAGE_NAVIGATION_FAILED",
      metadata: { pageNavigation: { status: "recovery_left_app" } }
    }))?.kind).toBe("left_target_app");

    expect(publicExecutionFailureFromRun(failedRun({
      errorCode: "PAGE_NAVIGATION_FAILED",
      metadata: { pageNavigation: { status: "current_page_unknown" } }
    }))?.kind).toBe("page_not_recognized");
  });

  it("classifies a failed result oracle separately from target lookup", () => {
    expect(publicExecutionFailureFromRun(failedRun({ errorCode: "EXPECTATION_FAILED" }))).toEqual({
      kind: "result_not_verified",
      message: "操作已经执行，但未能确认结果符合预期。",
      nextAction: "view_report"
    });
  });
});

function failedRun(step: Partial<TestRun["stepResults"][number]>): TestRun {
  return {
    id: "run-failed",
    caseName: "失败用例",
    deviceSerial: "device-1",
    status: "failed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false
    },
    steps: [],
    stepResults: [{
      id: "result-1",
      runId: "run-failed",
      iterationIndex: 0,
      stepId: "internal-step-id",
      stepOrder: 1,
      type: "tap_on_text",
      status: "failed",
      startedAt: "2026-07-31T00:00:00.000Z",
      artifacts: [],
      ...step
    }],
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: "2026-07-31T00:00:00.000Z"
  };
}
