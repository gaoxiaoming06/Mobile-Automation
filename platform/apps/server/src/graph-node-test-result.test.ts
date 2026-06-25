import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { buildNodeTestResult, isGraphRun } from "./graph-node-test-result.js";

describe("graph node test result", () => {
  it("builds a structured node test result from graph step metadata", () => {
    const run = createGraphRun();

    expect(isGraphRun(run)).toBe(true);
    expect(buildNodeTestResult(run, false)).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "failed",
        active: false,
        targetNodeId: "node-target",
        targetNodeName: "目标页",
        reason: "missing title",
        reportUrl: "/artifacts/runs/run-1/reports/report.html",
        route: [
          expect.objectContaining({
            edgeKey: "home.target",
            status: "failed",
            phase: "expectation",
            actionLabel: "点击创建课堂",
            beforeNodeName: "首页",
            afterNodeName: "目标页",
            failureReason: "missing title"
          })
        ],
        steps: [
          expect.objectContaining({
            action: expect.objectContaining({
              label: "点击创建课堂",
              type: "tap_on_image",
              elementLabel: "创建课堂",
              candidateIndex: 1
            }),
            matches: expect.objectContaining({
              before: expect.objectContaining({ nodeName: "首页", score: 0.98 }),
              after: expect.objectContaining({ nodeName: "目标页", score: 0.93 })
            }),
            retry: expect.objectContaining({
              attempt: 1,
              reason: "下游目标失败，返回主页尝试下一个班级候选"
            })
          })
        ],
        failedAt: expect.objectContaining({
          edgeKey: "home.target",
          nodeName: "目标页",
          phase: "expectation",
          code: "EXPECTATION_FAILED",
          expectation: expect.objectContaining({
            expected: "OCR text contains 新标题.",
            actual: "旧标题"
          })
        }),
        evidence: {
          screenshots: ["/artifacts/runs/run-1/screenshots/failed.png"],
          videos: ["/artifacts/runs/run-1/videos/run.mp4"],
          logs: ["/artifacts/runs/run-1/logs/graph.log"],
          failureArtifacts: ["/artifacts/runs/run-1/screenshots/failed.png"]
        },
        actual: expect.objectContaining({
          stepCount: 1,
          passedStepCount: 0,
          failedStepCount: 1,
          latestNodeName: "目标页",
          failedExpectationCount: 1
        }),
        diagnostics: expect.objectContaining({
          bootstrapCount: 1,
          transitionWaitCount: 1,
          recoveryCount: 1,
          bootstrapEvents: [
            expect.objectContaining({
              summary: "Graph run bootstrapped target app before route planning"
            })
          ]
        })
      })
    );
  });

  it("recognizes graph runs even before graph step results are written", () => {
    const run = createGraphRun();
    run.stepResults = [];

    expect(isGraphRun(run)).toBe(true);
    expect(buildNodeTestResult(run, true)).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "failed",
        active: true,
        route: [],
        actual: expect.objectContaining({
          stepCount: 0
        })
      })
    );
  });
});

function createGraphRun(): TestRun {
  return {
    id: "run-1",
    caseName: "目标节点验证",
    deviceSerial: "device-1",
    status: "failed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: true
    },
    steps: [
      {
        id: "step-1",
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
        id: "result-1",
        runId: "run-1",
        iterationIndex: 0,
        stepId: "step-1",
        stepOrder: 1,
        type: "tap_on_element",
        status: "failed",
        startedAt: "2026-06-12T00:00:01.000Z",
        endedAt: "2026-06-12T00:00:02.000Z",
        durationMs: 1000,
        errorCode: "EXPECTATION_FAILED",
        errorMessage: "missing title",
        afterScreenshotId: "shot-1",
        artifacts: [],
        expectationResults: [
          {
            id: "expectation-result-1",
            expectationId: "expectation-title",
            type: "text",
            status: "failed",
            blocking: true,
            expected: "OCR text contains 新标题.",
            actual: "旧标题",
            reason: "missing title",
            evidenceArtifactIds: ["shot-1"],
            checkedAt: "2026-06-12T00:00:02.000Z"
          }
        ],
        metadata: {
          graph: {
            versionId: "version-1",
            edgeId: "edge-1",
            edgeKey: "home.target",
            fromNodeId: "node-home",
            fromNodeName: "首页",
            toNodeId: "node-target",
            toNodeName: "目标页",
            phase: "expectation",
            recoveryAttempt: 1,
            recoveryReason: "下游目标失败，返回主页尝试下一个班级候选",
            actionPolicy: {
              action: {
                type: "tap_on_image",
                title: "点击创建课堂",
                params: {
                  elementLabel: "创建课堂",
                  abilityType: "grid_candidate",
                  candidateIndex: 1
                }
              }
            },
            beforeMatch: {
              status: "matched",
              nodeId: "node-home",
              nodeName: "首页",
              score: 0.98,
              candidates: []
            },
            afterMatch: {
              status: "matched",
              nodeId: "node-target",
              nodeName: "目标页",
              score: 0.93,
              candidates: []
            },
            deviations: [
              {
                id: "deviation-1",
                phase: "state_transition",
                expectedNodeId: "node-target",
                actualNodeId: "node-home",
                actualStatus: "matched",
                attempt: 1,
                action: "retry_observe",
                message: "Expected next node node-target, got node-home; polling transition until the target state appears or the wait window expires.",
                recordedAt: "2026-06-12T00:00:01.500Z"
              }
            ]
          }
        }
      }
    ],
    metrics: [],
    events: [
      {
        id: "event-bootstrap",
        runId: "run-1",
        deviceSerial: "device-1",
        type: "start_state_failed",
        severity: "info",
        occurredAt: "2026-06-12T00:00:00.500Z",
        summary: "Graph run bootstrapped target app before route planning",
        detail: "Initial state was not a recognized graph node.",
        artifactIds: []
      }
    ],
    artifacts: [
      {
        id: "shot-1",
        runId: "run-1",
        stepResultId: "result-1",
        type: "screenshot",
        name: "failed.png",
        path: "runs/run-1/screenshots/failed.png",
        url: "/artifacts/runs/run-1/screenshots/failed.png",
        createdAt: "2026-06-12T00:00:02.000Z"
      },
      {
        id: "video-1",
        runId: "run-1",
        type: "video",
        name: "run.mp4",
        path: "runs/run-1/videos/run.mp4",
        url: "/artifacts/runs/run-1/videos/run.mp4",
        createdAt: "2026-06-12T00:00:00.000Z"
      },
      {
        id: "log-1",
        runId: "run-1",
        type: "log",
        name: "graph.log",
        path: "runs/run-1/logs/graph.log",
        url: "/artifacts/runs/run-1/logs/graph.log",
        createdAt: "2026-06-12T00:00:02.000Z"
      }
    ],
    startedAt: "2026-06-12T00:00:00.000Z",
    endedAt: "2026-06-12T00:00:03.000Z",
    reportHtmlPath: "runs/run-1/reports/report.html"
  };
}
