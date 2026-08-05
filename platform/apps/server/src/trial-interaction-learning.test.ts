import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { interactionCandidatesFromTrial } from "./trial-interaction-learning.js";

describe("trial interaction learning", () => {
  it("extracts a page-owned semantic target only from a successfully resolved action", () => {
    const candidates = interactionCandidatesFromTrial(trialRun());

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "interaction",
        stableKey: "classin.home.tap.text.添加好友",
        sourceStepId: "open-add-friend",
        confidence: 0.95,
        status: "validated",
        payload: expect.objectContaining({
          owner: { kind: "page", key: "classin.home" },
          supportedAction: "tap",
          semanticContract: { text: "添加好友" },
          locatorEvidence: { strategy: "ocr_text", selectedText: "添加好友" }
        }),
        evidenceArtifactIds: ["artifact-after", "artifact-locator"]
      })
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(/"x"|"y"|coordinate|region/i);
  });

  it("also learns from later normal executions only when the script version is verified", () => {
    const verified = trialRun();
    verified.sourceSnapshot!.executionPurpose = "normal";
    verified.sourceSnapshot!.verificationAssessment!.status = "verified";
    verified.sourceSnapshot!.verificationAssessment!.unresolvedStepIds = [];

    expect(interactionCandidatesFromTrial(verified)).toHaveLength(1);

    verified.sourceSnapshot!.verificationAssessment!.status = "needs_trial";
    expect(interactionCandidatesFromTrial(verified)).toEqual([]);
  });

  it("does not learn from failures, raw driver taps, or targets without an owner page", () => {
    const run = trialRun();
    run.stepResults = [
      { ...run.stepResults[0]!, status: "failed" },
      { ...run.stepResults[0]!, id: "raw", stepId: "raw", metadata: { onPage: "classin.home" } },
      { ...run.stepResults[0]!, id: "ownerless", stepId: "ownerless", metadata: { semantic: { type: "ocr_text", action: "tap" } } }
    ];
    (run.sourceSnapshot!.parsed.steps as Array<Record<string, unknown>>).push(
      { id: "raw", onPage: "classin.home", tap: { target: { text: "设置" } } },
      { id: "ownerless", tap: { target: { text: "消息" } } }
    );

    expect(interactionCandidatesFromTrial(run)).toEqual([]);
  });

  it("keeps targets with different semantic qualifiers as distinct interaction identities", () => {
    const run = trialRun();
    const parsedSteps = run.sourceSnapshot!.parsed.steps as Array<Record<string, unknown>>;
    parsedSteps[0] = {
      id: "toggle-student-report",
      onPage: "classin.settings",
      tap: { target: { control: "开关", nearText: "允许学生查看报告" } }
    };
    parsedSteps.push({
      id: "toggle-recording",
      onPage: "classin.settings",
      tap: { target: { control: "开关", nearText: "录制课堂" } }
    });
    run.stepResults[0] = {
      ...run.stepResults[0]!,
      stepId: "toggle-student-report",
      metadata: { onPage: "classin.settings", semantic: { type: "control", action: "tap" } }
    };
    run.stepResults.push({
      ...run.stepResults[0]!,
      id: "result-2",
      stepId: "toggle-recording"
    });

    const candidates = interactionCandidatesFromTrial(run);

    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.stableKey)).size).toBe(2);
  });
});

function trialRun(): TestRun {
  return {
    id: "run-1",
    caseName: "打开添加好友",
    deviceSerial: "device-1",
    status: "passed",
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
      runId: "run-1",
      iterationIndex: 0,
      stepId: "open-add-friend",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-after",
      artifacts: [],
      metadata: {
        onPage: "classin.home",
        semantic: {
          type: "ocr_text",
          action: "tap",
          actual: "添加好友",
          locator: { text: "添加好友", centerX: 422, centerY: 128, region: { x: 1, y: 2 } }
        }
      }
    }],
    metrics: [],
    events: [],
    artifacts: [{
      id: "artifact-locator",
      runId: "run-1",
      stepResultId: "result-1",
      type: "screenshot",
      name: "locator.png",
      path: "runs/run-1/locator.png",
      url: "/artifacts/runs/run-1/locator.png",
      createdAt: "2026-07-30T00:00:00.000Z"
    }],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "temporary:1",
      version: 1,
      planDigest: "a".repeat(64),
      executionPurpose: "trial",
      sourceHash: "b".repeat(64),
      verificationAssessment: {
        status: "needs_trial",
        sourceHash: "b".repeat(64),
        reasons: [],
        unresolvedStepIds: ["open-add-friend"],
        unresolvedOutcome: false
      },
      dependencies: [],
      parsed: {
        app: { id: "cn.eeo.classin" },
        steps: [{ id: "open-add-friend", onPage: "classin.home", tap: { target: { text: "添加好友" } } }]
      }
    },
    startedAt: "2026-07-30T00:00:00.000Z",
    endedAt: "2026-07-30T00:00:01.000Z"
  };
}
