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

  it("classifies ambiguous icon candidates as an ambiguous target", () => {
    expect(publicExecutionFailureFromRun(failedRun({
      errorCode: "SEMANTIC_TARGET_NOT_FOUND",
      metadata: { semantic: { reason: "ambiguous_icon_candidates", candidateCount: 3 } }
    }))).toEqual({
      kind: "target_ambiguous",
      message: "当前操作匹配到多个目标，请补充位置、附近文字或更明确的操作描述。",
      nextAction: "supplement_process"
    });
  });

  it("explains the expected text, OCR result, attempts, and nearest visible text", () => {
    const failure = publicExecutionFailureFromRun(failedRun({
      stepId: "tap-confirm",
      errorCode: "SEMANTIC_TARGET_NOT_FOUND",
      metadata: {
        semantic: {
          type: "text",
          expected: ["确认"],
          actual: "选择联席教师 搜索 海外55 确定 1/6",
          reason: "target_not_found",
          attempts: 3,
          candidateCount: 14,
          search: { mode: "visibleOnly", scanSwipes: 0 }
        }
      }
    }, [{
      id: "tap-confirm",
      order: 7,
      type: "tap_on_text",
      enabled: true,
      title: "确认联席教师",
      params: { text: "确认" },
      createdAt: "2026-07-31T00:00:00.000Z"
    }]));

    expect(failure).toEqual({
      kind: "target_not_found",
      message: "步骤“确认联席教师”需要点击文字“确认”，但在当前屏幕连续查找 3 次仍未找到。",
      details: [
        { label: "预期目标", value: "文字“确认”" },
        { label: "实际结果", value: "OCR 识别到 14 个文字候选，但没有匹配到“确认”。" },
        { label: "相近文字", value: "现场识别到“确定”，目标文字可能填写有误。" }
      ],
      nextAction: "supplement_process"
    });
  });

  it("replaces a compiler action title with a readable failed-step name", () => {
    const failure = publicExecutionFailureFromRun(failedRun({
      stepId: "tap-confirm",
      stepOrder: 7,
      errorCode: "SEMANTIC_TARGET_NOT_FOUND",
      metadata: {
        semantic: {
          type: "text",
          expected: ["确认"],
          actual: "确定 1/6",
          reason: "target_not_found",
          attempts: 2,
          candidateCount: 2,
          search: { mode: "visibleOnly" }
        }
      }
    }, [{
      id: "tap-confirm",
      order: 7,
      type: "tap_on_text",
      enabled: true,
      title: "tap",
      params: { text: "确认" },
      createdAt: "2026-07-31T00:00:00.000Z"
    }]));

    expect(failure?.message).toBe("步骤“点击确认”需要点击文字“确认”，但在当前屏幕连续查找 2 次仍未找到。");
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

  it("classifies missing navigation paths as route mismatches", () => {
    expect(publicExecutionFailureFromRun(failedRun({
      errorCode: "PAGE_NAVIGATION_FAILED",
      metadata: {
        pageNavigation: {
          status: "no_reliable_path",
          currentPageId: "classin.teacher.space",
          targetPageName: "打卡记录"
        }
      }
    }))).toEqual({
      kind: "route_mismatch",
      message: "当前页面已偏离目标业务路径，请补充真实入口、测试数据或可复用导航流程后重试。",
      nextAction: "supplement_process"
    });
  });

  it("classifies a failed result oracle separately from target lookup", () => {
    expect(publicExecutionFailureFromRun(failedRun({ errorCode: "EXPECTATION_FAILED" }))).toEqual({
      kind: "result_not_verified",
      message: "操作已经执行，但未能确认结果符合预期。",
      nextAction: "view_report"
    });
  });
});

function failedRun(
  step: Partial<TestRun["stepResults"][number]>,
  steps: TestRun["steps"] = []
): TestRun {
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
    steps,
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
