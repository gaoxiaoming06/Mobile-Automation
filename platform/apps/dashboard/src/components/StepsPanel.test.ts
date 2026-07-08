import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TestRun } from "@mobile-automation/shared";
import { describe, expect, it, vi } from "vitest";
import type { GraphRunSummary } from "./GraphRunDetail.js";
import { StepsPanel } from "./StepsPanel.js";

const noop = vi.fn();
const asyncNoop = async () => undefined;

describe("StepsPanel", () => {
  it("keeps the recording module focused on the active editor", () => {
    const idleMarkup = renderStepsPanel(false);
    const recordingMarkup = renderStepsPanel(true);

    expect(idleMarkup).toContain("录制步骤");
    expect(idleMarkup).toContain("录制用例");
    expect(idleMarkup).not.toContain("用例库");
    expect(idleMarkup).not.toContain("登录冒烟");
    expect(recordingMarkup).not.toContain("用例库");
    expect(recordingMarkup).not.toContain("登录冒烟");
    expect(recordingMarkup).toContain("录制中");
  });

  it("renders graph run details from graph step metadata", () => {
    const graphRun = createGraphRun();
    const markup = renderStepsPanel(false, {
      activeTab: "runs",
      currentRun: graphRun,
      currentGraphRun: createGraphRunSummary(),
      runs: [graphRun]
    });

    expect(markup).toContain("业务图谱执行");
    expect(markup).toContain("新建课堂页面");
    expect(markup).toContain("发布活动页面");
    expect(markup).toContain("classin.teacher.publish.open_create_lesson");
    expect(markup).toContain("动态预期");
    expect(markup).toContain("运行时清障");
    expect(markup).toContain("确认提示");
    expect(markup).toContain("命中 6 / 7");
    expect(markup).toContain("质量 low_confidence");
    expect(markup).toContain("strong_state_anchor_missing");
    expect(markup).toContain("缺失 m-missing");
    expect(markup).toContain("m-missing");
    expect(markup).toContain("执行 点击班级列表 · tap_on_image · grid_candidate · 候选 #1");
    expect(markup).toContain("定位证据");
    expect(markup).toContain("visual_candidate");
    expect(markup).toContain("更多按钮");
    expect(markup).toContain("template");
    expect(markup).toContain("crop-hash");
    expect(markup).toContain("candidate_selected");
    expect(markup).toContain("fallback=region_center_disabled");
    expect(markup).toContain("复合 2 · wait_until_state · 等待添加好友菜单出现 · 完成");
    expect(markup).toContain("grid_candidate_downstream_failed");
    expect(markup).toContain("cn.eeo.classin:id/create_lesson");
    expect(markup).toContain("图谱 HTML 报告");
    expect(markup).toContain("执行视频");
    expect(markup).toContain("失败证据");
    expect(markup).toContain("启动归位");
    expect(markup).toContain("状态等待");
    expect(markup).toContain("路径恢复");
    expect(markup).toContain("Graph run bootstrapped target app before route planning");
  });

  it("renders asset patrol semantic step labels instead of internal wait actions", () => {
    const assetPatrolRun = createAssetPatrolRun();
    const markup = renderStepsPanel(false, {
      activeTab: "runs",
      currentRun: assetPatrolRun,
      runs: [assetPatrolRun]
    });

    expect(markup).toContain("页面匹配：登录");
    expect(markup).toContain("元素可重定位：登录按钮");
    expect(markup).toContain("任务编排体检：账号密码登录");
    expect(markup).toContain("task_dry_run · business_submit_disabled");
    expect(markup).not.toContain("<strong>wait</strong>");
  });

  it("keeps execution results focused on run status without replay configuration", () => {
    const markup = renderStepsPanel(false, {
      activeTab: "runs",
      runs: [createAssetPatrolRun()]
    });

    expect(markup).toContain("执行结果");
    expect(markup).toContain("当前设备执行记录");
    expect(markup).not.toContain("执行配置");
  });
});

function renderStepsPanel(recording: boolean, overrides: Partial<React.ComponentProps<typeof StepsPanel>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(StepsPanel, {
      activeTab: "steps",
      steps: [],
      selectedCaseId: "",
      recording,
      caseName: "录制用例",
      repeatCount: 1,
      stepIntervalMs: 400,
      loopUntilStopped: false,
      pauseAfterEachStep: false,
      startStrategy: "keep_current",
      startAppPackageName: "",
      startSetupScope: "before_run",
      currentRun: null,
      currentGraphRun: null,
      runs: [],
      runsLimit: 30,
      selectedSerial: "android-serial",
      setRecording: noop,
      setCaseName: noop,
      setRepeatCount: noop,
      setStepIntervalMs: noop,
      setLoopUntilStopped: noop,
      setPauseAfterEachStep: noop,
      setStartStrategy: noop,
      setStartAppPackageName: noop,
      setStartSetupScope: noop,
      moveStep: noop,
      removeStep: noop,
      insertWaitStep: noop,
      insertConditionalTapStep: noop,
      copyStep: noop,
      toggleStepEnabled: noop,
      updateStep: noop,
      addStepExpectation: noop,
      updateStepExpectation: noop,
      removeStepExpectation: noop,
      resetEditor: noop,
      saveCase: asyncNoop,
      stopCurrentRun: asyncNoop,
      pauseCurrentRun: asyncNoop,
      resumeCurrentRun: asyncNoop,
      stepCurrentRun: asyncNoop,
      setCurrentRunId: noop,
      loadMoreRuns: noop,
      ...overrides
    })
  );
}

function createGraphRunSummary(): GraphRunSummary {
  return {
    id: "run-graph",
    isGraphRun: true,
    active: false,
    status: "failed",
    caseName: "业务图谱目标节点执行",
    deviceSerial: "android-serial",
    startedAt: "2026-06-12T00:00:00.000Z",
    endedAt: "2026-06-12T00:00:03.000Z",
    graphVersionId: "graph-version-1",
    targetNodeId: "node-create",
    targetNodeName: "新建课堂页面",
    route: [
      {
        edgeId: "edge-1",
        edgeKey: "classin.teacher.publish.open_create_lesson",
        fromNodeId: "node-publish",
        fromNodeName: "发布活动页面",
        toNodeId: "node-create",
        toNodeName: "新建课堂页面"
      }
    ],
    failedAt: {
      stepId: "step-graph",
      edgeId: "edge-1",
      edgeKey: "classin.teacher.publish.open_create_lesson",
      nodeId: "node-create",
      nodeName: "新建课堂页面",
      phase: "expectation",
      code: "EXPECTATION_FAILED",
      message: "missing text",
      expectation: {
        id: "overlay-title",
        type: "text",
        expected: "OCR text contains 新标题.",
        actual: "旧标题",
        reason: "missing text"
      }
    },
    reportUrl: "/artifacts/runs/run-graph/reports/report.html",
    reportPath: "runs/run-graph/reports/report.html",
    screenshots: [
      {
        id: "shot-1",
        runId: "run-graph",
        stepResultId: "result-graph",
        type: "screenshot",
        name: "failed.png",
        path: "runs/run-graph/screenshots/failed.png",
        url: "/artifacts/runs/run-graph/screenshots/failed.png",
        createdAt: "2026-06-12T00:00:02.000Z"
      }
    ],
    videos: [
      {
        id: "video-1",
        runId: "run-graph",
        type: "video",
        name: "run.mp4",
        path: "runs/run-graph/videos/run.mp4",
        url: "/artifacts/runs/run-graph/videos/run.mp4",
        createdAt: "2026-06-12T00:00:02.000Z"
      }
    ],
    logs: [],
    failureEvidence: [
      {
        id: "shot-1",
        runId: "run-graph",
        stepResultId: "result-graph",
        type: "screenshot",
        name: "failed.png",
        path: "runs/run-graph/screenshots/failed.png",
        url: "/artifacts/runs/run-graph/screenshots/failed.png",
        createdAt: "2026-06-12T00:00:02.000Z"
      }
    ],
    diagnostics: {
      bootstrapCount: 1,
      transitionWaitCount: 1,
      recoveryCount: 1,
      bootstrapEvents: [
        {
          summary: "Graph run bootstrapped target app before route planning",
          detail: "Initial state was not a recognized graph node."
        }
      ]
    },
    steps: [
      {
        id: "result-graph",
        order: 1,
        status: "failed",
        type: "tap_on_element",
        phase: "expectation",
        edgeId: "edge-1",
        edgeKey: "classin.teacher.publish.open_create_lesson",
        fromNodeId: "node-publish",
        fromNodeName: "发布活动页面",
        toNodeId: "node-create",
        toNodeName: "新建课堂页面",
        runtimeOverlay: {
          targetExpectationIds: ["overlay-title"],
          edgeExpectationIds: []
        },
        beforeMatch: {
          status: "matched",
          nodeId: "node-publish",
          nodeName: "发布活动页面",
          score: 0.96,
          candidates: [
            {
              nodeId: "node-publish",
              nodeName: "发布活动页面",
              score: 0.96,
              matchedWeight: 6,
              totalWeight: 7,
              quality: {
                status: "low_confidence",
                reasons: ["strong_state_anchor_missing"],
                matchedContextSignals: 1,
                matchedStrongSignals: 0,
                matchedWeakSignals: 1,
                missingStrongMatcherIds: ["m-missing"]
              },
              matcherResults: [
                { matcherId: "m-package", type: "package", expected: "cn.eeo.classin", actual: "cn.eeo.classin", weight: 2, matched: true, score: 2 },
                { matcherId: "m-missing", type: "resource_id", expected: "cn.eeo.classin:id/missing", weight: 2, matched: false, score: 0, reason: "not_found" }
              ]
            }
          ]
        },
        afterMatch: {
          status: "matched",
          nodeId: "node-create",
          nodeName: "新建课堂页面",
          score: 0.91,
          candidates: [
            {
              nodeId: "node-create",
              nodeName: "新建课堂页面",
              score: 0.91,
              matchedWeight: 10,
              totalWeight: 11,
              quality: {
                status: "sufficient",
                reasons: [],
                matchedContextSignals: 0,
                matchedStrongSignals: 1,
                matchedWeakSignals: 1,
                missingStrongMatcherIds: []
              },
              matcherResults: [
                { matcherId: "m-title", type: "text", expected: "新建课堂", actual: "新建课堂", weight: 4, matched: true, score: 4 },
                { matcherId: "m-input", type: "resource_id", expected: "cn.eeo.classin:id/et_course_name", actual: "cn.eeo.classin:id/et_course_name", weight: 6, matched: true, score: 6 }
              ]
            }
          ]
        },
        actionPolicy: {
          id: "policy-tap-classroom",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          action: {
            type: "tap_on_element",
            params: {
              locator: { resourceId: "cn.eeo.classin:id/create_lesson" },
              timeoutMs: 3000
            }
          }
        },
        action: {
          label: "点击班级列表",
          type: "tap_on_image",
          elementLabel: "班级列表",
          abilityType: "grid_candidate",
          candidateIndex: 1
        },
        semantic: {
          type: "image_region",
          action: "tap",
          relocatedBy: "visual_candidate",
          fallback: "region_center_disabled",
          visualCandidate: {
            label: "更多按钮",
            role: "button",
            score: 0.91,
            semanticArea: "top"
          },
          visualTemplate: {
            hash: "crop-hash",
            similarity: 0.94
          },
          visualRelocation: {
            reason: "candidate_selected",
            minScore: 0.72,
            candidateCount: 2
          }
        },
        retry: {
          attempt: 1,
          reason: "grid_candidate_downstream_failed",
          reasonDeviationId: "deviation-1"
        },
        compound: {
          total: 3,
          steps: [
            { order: 1, type: "tap_on_image", label: "右上角更多", resolved: true },
            { order: 2, type: "wait_until_state", label: "等待添加好友菜单出现", resolved: true },
            { order: 3, type: "tap_on_text", label: "添加好友", resolved: true }
          ]
        },
        interceptors: [
          {
            id: "interceptor-1",
            phase: "precondition",
            ruleId: "common-known",
            ruleName: "确认提示",
            matchedText: "知道了",
            action: { type: "tap", x: 540, y: 620 }
          }
        ],
        recoveryAttempt: 1,
        deviations: [
          {
            id: "deviation-1",
            phase: "state_transition",
            actualNodeId: "node-publish",
            attempt: 1,
            action: "retry_observe",
            message: "Expected next node node-create, got node-publish; polling transition until the target state appears or the wait window expires."
          }
        ],
        errorCode: "EXPECTATION_FAILED",
        errorMessage: "missing text",
        expectationResults: [
          {
            id: "expectation-result-1",
            expectationId: "overlay-title",
            type: "text",
            status: "failed",
            blocking: true,
            expected: "OCR text contains 新标题.",
            actual: "旧标题",
            reason: "missing text",
            evidenceArtifactIds: ["shot-1"],
            checkedAt: "2026-06-12T00:00:02.000Z"
          }
        ],
        artifactIds: ["shot-1"]
      }
    ]
  };
}

function createAssetPatrolRun(): TestRun {
  return {
    id: "run-asset-patrol",
    caseName: "资产驱动巡检：cn.eeo.classin",
    deviceSerial: "android-serial",
    status: "passed",
    config: {
      deviceSerial: "android-serial",
      runKind: "asset_patrol",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false,
      assetPatrol: {
        packageName: "cn.eeo.classin",
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMs: 120_000,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatterns: [],
        runtimeParams: {}
      }
    },
    steps: [],
    stepResults: [
      assetPatrolStep(1, "passed", {
        kind: "page_match",
        label: "页面匹配：登录",
        status: "ready",
        executionMode: "diagnostic",
        pageModelName: "登录"
      }),
      assetPatrolStep(2, "passed", {
        kind: "element_relocation",
        label: "元素可重定位：登录按钮",
        status: "ready",
        executionMode: "diagnostic",
        pageModelName: "登录"
      }),
      assetPatrolStep(3, "skipped", {
        kind: "task_dry_run",
        label: "任务编排体检：账号密码登录",
        status: "skipped",
        executionMode: "diagnostic",
        pageModelName: "登录",
        skipReason: "business_submit_disabled"
      })
    ],
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: "2026-06-30T00:00:00.000Z",
    endedAt: "2026-06-30T00:00:06.000Z"
  };
}

function assetPatrolStep(
  order: number,
  status: TestRun["stepResults"][number]["status"],
  assetPatrol: Record<string, unknown>
): TestRun["stepResults"][number] {
  return {
    id: `asset-step-${order}`,
    runId: "run-asset-patrol",
    iterationIndex: 0,
    stepId: `asset-step-${order}`,
    stepOrder: order,
    type: "wait",
    status,
    startedAt: "2026-06-30T00:00:00.000Z",
    durationMs: 0,
    artifacts: [],
    metadata: { assetPatrol }
  };
}

function createGraphRun(): TestRun {
  return {
    id: "run-graph",
    caseName: "业务图谱目标节点执行",
    deviceSerial: "android-serial",
    status: "failed",
    config: {
      deviceSerial: "android-serial",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: true
    },
    steps: [
      {
        id: "step-graph",
        order: 1,
        type: "tap_on_element",
        enabled: true,
        note: "graph-run",
        params: { graphRun: true },
        createdAt: "2026-06-12T00:00:00.000Z"
      }
    ],
    stepResults: [
      {
        id: "result-graph",
        runId: "run-graph",
        iterationIndex: 1,
        stepId: "step-graph",
        stepOrder: 1,
        type: "tap_on_element",
        status: "failed",
        startedAt: "2026-06-12T00:00:01.000Z",
        endedAt: "2026-06-12T00:00:02.000Z",
        durationMs: 1000,
        errorCode: "EXPECTATION_FAILED",
        errorMessage: "missing text",
        afterScreenshotId: "shot-1",
        artifacts: [],
        expectationResults: [
          {
            id: "expectation-result-1",
            expectationId: "overlay-title",
            type: "text",
            status: "failed",
            blocking: true,
            expected: "OCR text contains 新标题.",
            actual: "旧标题",
            reason: "missing text",
            evidenceArtifactIds: ["shot-1"],
            checkedAt: "2026-06-12T00:00:02.000Z"
          }
        ],
        metadata: {
          graph: {
            versionId: "graph-version-1",
            edgeId: "edge-1",
            edgeKey: "classin.teacher.publish.open_create_lesson",
            fromNodeId: "node-publish",
            fromNodeName: "发布活动页面",
            toNodeId: "node-create",
            toNodeName: "新建课堂页面",
            phase: "expectation",
            runtimeOverlay: {
              targetExpectationIds: ["overlay-title"],
              edgeExpectationIds: []
            },
            beforeMatch: {
              status: "matched",
              nodeId: "node-publish",
              nodeName: "发布活动页面",
              score: 0.96,
              candidates: [
                {
                  nodeId: "node-publish",
                  nodeName: "发布活动页面",
                  score: 0.96,
                    matchedWeight: 6,
                    totalWeight: 7,
                    quality: {
                      status: "low_confidence",
                      reasons: ["strong_state_anchor_missing"],
                      matchedContextSignals: 1,
                      matchedStrongSignals: 0,
                      matchedWeakSignals: 1,
                      missingStrongMatcherIds: ["m-missing"]
                    },
                    matcherResults: [
                      { matcherId: "m-package", type: "package", expected: "cn.eeo.classin", actual: "cn.eeo.classin", weight: 2, matched: true, score: 2 },
                      { matcherId: "m-missing", type: "resource_id", expected: "cn.eeo.classin:id/missing", weight: 2, matched: false, score: 0, reason: "not_found" }
                  ]
                }
              ]
            },
            afterMatch: {
              status: "matched",
              nodeId: "node-create",
              nodeName: "新建课堂页面",
              score: 0.91,
              candidates: [
                {
                  nodeId: "node-create",
                  nodeName: "新建课堂页面",
                  score: 0.91,
                    matchedWeight: 10,
                    totalWeight: 11,
                    quality: {
                      status: "sufficient",
                      reasons: [],
                      matchedContextSignals: 0,
                      matchedStrongSignals: 1,
                      matchedWeakSignals: 1,
                      missingStrongMatcherIds: []
                    },
                    matcherResults: [
                      { matcherId: "m-title", type: "text", expected: "新建课堂", actual: "新建课堂", weight: 4, matched: true, score: 4 },
                      { matcherId: "m-input", type: "resource_id", expected: "cn.eeo.classin:id/et_course_name", actual: "cn.eeo.classin:id/et_course_name", weight: 6, matched: true, score: 6 }
                    ]
                  }
                ]
              },
            actionPolicy: {
              id: "policy-tap-classroom",
              priority: 1,
              fallback: false,
              reliabilityHint: "high",
              action: {
                type: "tap_on_element",
                params: {
                  locator: { resourceId: "cn.eeo.classin:id/create_lesson" },
                  timeoutMs: 3000
                }
              }
            },
            interceptors: [
              {
                id: "interceptor-1",
                phase: "precondition",
                ruleId: "common-known",
                ruleName: "确认提示",
                matchedText: "知道了",
                action: { type: "tap", x: 540, y: 620 }
              }
            ],
            recoveryAttempt: 1,
            deviations: [
              {
                id: "deviation-1",
                phase: "state_transition",
                actualNodeId: "node-publish",
                attempt: 1,
                action: "retry_observe",
                message: "Expected next node node-create, got node-publish; polling transition until the target state appears or the wait window expires."
              }
            ]
          }
        }
      }
    ],
    metrics: [],
    events: [
      {
        id: "event-1",
        runId: "run-graph",
        deviceSerial: "android-serial",
        type: "start_state_failed",
        severity: "info",
        summary: "Graph run bootstrapped target app before route planning",
        detail: "Initial state was not a recognized graph node.",
        occurredAt: "2026-06-12T00:00:00.500Z",
        artifactIds: []
      }
    ],
    artifacts: [
      {
        id: "shot-1",
        runId: "run-graph",
        stepResultId: "result-graph",
        type: "screenshot",
        name: "failed.png",
        path: "runs/run-graph/screenshots/failed.png",
        url: "/artifacts/runs/run-graph/screenshots/failed.png",
        createdAt: "2026-06-12T00:00:02.000Z"
      },
      {
        id: "video-1",
        runId: "run-graph",
        type: "video",
        name: "run.mp4",
        path: "runs/run-graph/videos/run.mp4",
        url: "/artifacts/runs/run-graph/videos/run.mp4",
        createdAt: "2026-06-12T00:00:02.000Z"
      }
    ],
    startedAt: "2026-06-12T00:00:00.000Z",
    endedAt: "2026-06-12T00:00:03.000Z",
    reportHtmlPath: "runs/run-graph/reports/report.html"
  };
}
