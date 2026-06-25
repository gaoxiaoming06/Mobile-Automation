import { describe, expect, it } from "vitest";
import type { StepResult, TestRun } from "@mobile-automation/shared";
import { buildGraphQualitySummary } from "./graph-quality.js";

describe("buildGraphQualitySummary", () => {
  it("summarizes recent graph node and edge execution quality", () => {
    const runs: TestRun[] = [
      graphRun({
        id: "run-failed",
        status: "failed",
        startedAt: "2026-06-12T10:10:00.000Z",
        reportHtmlPath: "runs/run-failed/reports/report.html",
        stepResults: [
          graphStep({
            id: "step-failed",
            status: "failed",
            startedAt: "2026-06-12T10:10:01.000Z",
            endedAt: "2026-06-12T10:10:02.000Z",
            errorMessage: "Expected next node node-target, got unknown."
          })
        ]
      }),
      graphRun({
        id: "run-passed",
        status: "passed",
        startedAt: "2026-06-12T10:00:00.000Z",
        reportHtmlPath: "runs/run-passed/reports/report.html",
        stepResults: [
          graphStep({
            id: "step-passed",
            status: "passed",
            startedAt: "2026-06-12T10:00:01.000Z",
            endedAt: "2026-06-12T10:00:02.000Z"
          }),
          graphStep({
            id: "step-recovery",
            status: "passed",
            startedAt: "2026-06-12T10:00:03.000Z",
            endedAt: "2026-06-12T10:00:04.000Z",
            metadata: {
              graph: {
                versionId: "graph-version-1",
                edgeId: "edge-detour-target",
                edgeKey: "detour.to.target",
                fromNodeId: "node-detour",
                fromNodeName: "中间页",
                toNodeId: "node-target",
                toNodeName: "目标页",
                recoveryAttempt: 1,
                recoveryReasonDeviationId: "deviation-1"
              }
            }
          })
        ]
      }),
      graphRun({
        id: "legacy-run",
        status: "passed",
        startedAt: "2026-06-12T09:00:00.000Z",
        stepResults: [
          {
            ...graphStep({ id: "legacy-step", status: "passed" }),
            metadata: {}
          }
        ]
      })
    ];

    const summary = buildGraphQualitySummary(
      {
        listRuns: () => runs
      },
      "graph-version-1",
      { now: "2026-06-12T11:00:00.000Z" }
    );

    expect(summary).toEqual(
      expect.objectContaining({
        graphVersionId: "graph-version-1",
        analyzedRunCount: 2,
        generatedAt: "2026-06-12T11:00:00.000Z"
      })
    );
    expect(summary.edges).toEqual([
      expect.objectContaining({
        edgeId: "edge-home-target",
        edgeKey: "home.to.target",
        runCount: 2,
        passedCount: 1,
        failedCount: 1,
        passRate: 0.5,
        latestRunId: "run-failed",
        latestStatus: "failed",
        latestReportUrl: "/artifacts/runs/run-failed/reports/report.html",
        latestFailureMessage: "Expected next node node-target, got unknown.",
        recoveryAttemptCount: 0,
        recoveredRunCount: 0
      })
    ,
      expect.objectContaining({
        edgeId: "edge-detour-target",
        edgeKey: "detour.to.target",
        runCount: 1,
        passedCount: 1,
        failedCount: 0,
        passRate: 1,
        recoveryAttemptCount: 1,
        recoveredRunCount: 1
      })
    ]);
    expect(summary.nodes).toEqual([
      expect.objectContaining({
        nodeId: "node-target",
        nodeName: "目标页",
        runCount: 3,
        passedCount: 2,
        failedCount: 1,
        passRate: 0.6667,
        recoveryAttemptCount: 1,
        recoveredRunCount: 1,
        latestRunId: "run-failed"
      })
    ]);
  });

  it("clamps requested run limit before reading storage", () => {
    let requestedLimit = 0;
    buildGraphQualitySummary(
      {
        listRuns: (limit) => {
          requestedLimit = limit ?? 0;
          return [];
        }
      },
      "graph-version-1",
      { limit: 9999 }
    );

    expect(requestedLimit).toBe(500);
  });
});

function graphRun(input: Partial<TestRun> & { id: string; stepResults: StepResult[] }): TestRun {
  return {
    id: input.id,
    caseName: "Graph Run",
    deviceSerial: "device-1",
    status: input.status ?? "passed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 300,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: true
    },
    steps: [],
    stepResults: input.stepResults,
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: input.startedAt ?? "2026-06-12T10:00:00.000Z",
    endedAt: input.endedAt,
    reportHtmlPath: input.reportHtmlPath
  };
}

function graphStep(input: Partial<StepResult> & { id: string; status: StepResult["status"] }): StepResult {
  return {
    id: input.id,
    runId: input.runId ?? "run-1",
    iterationIndex: 0,
    stepId: input.stepId ?? "execution-step-1",
    stepOrder: input.stepOrder ?? 1,
    type: input.type ?? "tap_on_element",
    status: input.status,
    startedAt: input.startedAt ?? "2026-06-12T10:00:01.000Z",
    endedAt: input.endedAt,
    errorMessage: input.errorMessage,
    artifacts: [],
    expectationResults: input.expectationResults ?? [],
    metadata: input.metadata ?? {
      graph: {
        versionId: "graph-version-1",
        edgeId: "edge-home-target",
        edgeKey: "home.to.target",
        fromNodeId: "node-home",
        fromNodeName: "首页",
        toNodeId: "node-target",
        toNodeName: "目标页"
      }
    }
  };
}
