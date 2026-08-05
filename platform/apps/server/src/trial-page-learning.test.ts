import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { pageCandidatesFromTrial } from "./trial-page-learning.js";

describe("trial page learning", () => {
  it("creates an AI-only page candidate from a passed final text outcome", () => {
    const candidates = pageCandidatesFromTrial(trialRun());

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "page",
        stableKey: "assert-text.教学方案列表",
        sourceStepId: "verify-teaching-plan",
        status: "needs_review",
        payload: {
          suggestedName: "确认进入教学方案页",
          assertedText: "教学方案列表",
          sourceFlowName: "进入教学方案"
        },
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
  });

  it("does not learn a page from a failed assertion or a non-trial execution", () => {
    const failed = trialRun();
    failed.stepResults[0]!.status = "failed";
    expect(pageCandidatesFromTrial(failed)).toEqual([]);

    const normal = trialRun();
    normal.sourceSnapshot!.executionPurpose = "normal";
    expect(pageCandidatesFromTrial(normal)).toEqual([]);
  });

  it("does not treat arbitrary successful taps as page identity evidence", () => {
    const run = trialRun();
    run.sourceSnapshot!.parsed.steps = [{ id: "tap-entry", tap: { target: { text: "教学方案" } } }];
    run.stepResults[0]!.stepId = "tap-entry";
    run.stepResults[0]!.type = "tap";
    run.stepResults[0]!.expectationResults = [];

    expect(pageCandidatesFromTrial(run)).toEqual([]);
  });
});

function trialRun(): TestRun {
  return {
    id: "run-page",
    caseName: "进入教学方案",
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
      id: "result-page",
      runId: "run-page",
      iterationIndex: 0,
      stepId: "verify-teaching-plan",
      stepOrder: 1,
      type: "wait",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-after",
      artifacts: [],
      expectationResults: [{
        id: "expectation-page",
        expectationId: "after:verify-teaching-plan",
        type: "text",
        status: "passed",
        expected: "教学方案列表",
        actual: "教学方案列表",
        evidenceArtifactIds: ["artifact-after"],
        checkedAt: "2026-07-30T00:00:01.000Z"
      }]
    }],
    metrics: [],
    events: [],
    artifacts: [],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "temporary:page",
      version: 1,
      planDigest: "a".repeat(64),
      executionPurpose: "trial",
      sourceHash: "b".repeat(64),
      verificationAssessment: {
        status: "needs_trial",
        sourceHash: "b".repeat(64),
        reasons: [],
        unresolvedStepIds: ["verify-teaching-plan"],
        unresolvedOutcome: false
      },
      dependencies: [],
      parsed: {
        app: { id: "cn.eeo.classin" },
        steps: [{
          id: "verify-teaching-plan",
          name: "确认进入教学方案页",
          assertText: { text: "教学方案列表", match: "contains" }
        }]
      }
    },
    startedAt: "2026-07-30T00:00:00.000Z",
    endedAt: "2026-07-30T00:00:01.000Z"
  };
}
