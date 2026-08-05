import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { navigationCandidatesFromTrial } from "./trial-navigation-learning.js";

describe("trial navigation learning", () => {
  it("learns a semantic navigation entry only after the target page is verified", () => {
    const candidates = navigationCandidatesFromTrial(trialRun());

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: "navigation",
        stableKey: "classin.home.tap.text.成长.area.bottomBar.to.classin.growth",
        sourceStepId: "open-growth",
        status: "validated",
        payload: {
          name: "classin.home -> classin.growth",
          from: { kind: "page", key: "classin.home" },
          toPage: "classin.growth",
          action: {
            kind: "tap",
            target: { text: "成长", area: "bottomBar" },
            search: { mode: "visibleOnly" }
          }
        },
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
    expect(JSON.stringify(candidates)).not.toMatch(/coordinate|bounds|region|centerX|centerY/i);
  });

  it("does not learn navigation without a passed page expectation", () => {
    const run = trialRun();
    run.stepResults[0]!.expectationResults = [];

    expect(navigationCandidatesFromTrial(run)).toEqual([]);
  });

  it("does not learn failed navigation and ignores legacy risk metadata", () => {
    const failed = trialRun();
    failed.stepResults[0]!.status = "failed";
    expect(navigationCandidatesFromTrial(failed)).toEqual([]);

    const destructive = trialRun();
    const steps = destructive.sourceSnapshot!.parsed.steps as Array<Record<string, unknown>>;
    steps[0] = { ...steps[0], risk: "delete" };
    expect(navigationCandidatesFromTrial(destructive)).toHaveLength(1);
  });
});

function trialRun(): TestRun {
  return {
    id: "run-navigation",
    caseName: "进入成长页",
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
      id: "result-growth",
      runId: "run-navigation",
      iterationIndex: 0,
      stepId: "open-growth",
      stepOrder: 1,
      type: "tap",
      status: "passed",
      startedAt: "2026-07-30T00:00:00.000Z",
      endedAt: "2026-07-30T00:00:01.000Z",
      afterScreenshotId: "artifact-after",
      artifacts: [],
      expectationResults: [{
        id: "expectation-result-growth",
        expectationId: "after:open-growth",
        type: "state_is",
        status: "passed",
        expected: "Page classin.growth",
        actual: "成长页",
        evidenceArtifactIds: ["artifact-after"],
        checkedAt: "2026-07-30T00:00:01.000Z"
      }],
      metadata: {
        onPage: "classin.home",
        expectPage: "classin.growth",
        semantic: {
          type: "ocr_text",
          action: "tap",
          selectedLocator: { text: "成长", centerX: 900, centerY: 2200 }
        }
      }
    }],
    metrics: [],
    events: [],
    artifacts: [],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "temporary:navigation",
      version: 1,
      planDigest: "a".repeat(64),
      executionPurpose: "trial",
      sourceHash: "b".repeat(64),
      verificationAssessment: {
        status: "needs_trial",
        sourceHash: "b".repeat(64),
        reasons: [],
        unresolvedStepIds: ["open-growth"],
        unresolvedOutcome: false
      },
      dependencies: [],
      parsed: {
        app: { id: "cn.eeo.classin" },
        steps: [{
          id: "open-growth",
          onPage: "classin.home",
          expectPage: "classin.growth",
          risk: "interaction",
          tap: {
            target: { text: "成长", area: "bottomBar" },
            search: { mode: "visibleOnly" }
          }
        }]
      }
    },
    startedAt: "2026-07-30T00:00:00.000Z",
    endedAt: "2026-07-30T00:00:01.000Z"
  };
}
