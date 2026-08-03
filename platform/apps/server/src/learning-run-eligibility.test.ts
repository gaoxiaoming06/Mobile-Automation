import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { canLearnFromSuccessfulRun } from "./learning-run-eligibility.js";

describe("learning run eligibility", () => {
  it("does not learn from a successful isolated step trial", () => {
    expect(canLearnFromSuccessfulRun(runWithPurpose("step_trial"))).toBe(false);
  });

  it("still learns from a full trial and a verified normal run", () => {
    expect(canLearnFromSuccessfulRun(runWithPurpose("trial"))).toBe(true);
    const normal = runWithPurpose("normal");
    normal.sourceSnapshot!.verificationAssessment = {
      status: "verified",
      sourceHash: "a".repeat(64),
      reasons: [],
      unresolvedStepIds: [],
      unresolvedOutcome: false
    };
    expect(canLearnFromSuccessfulRun(normal)).toBe(true);
  });
});

function runWithPurpose(
  executionPurpose: NonNullable<TestRun["sourceSnapshot"]>["executionPurpose"]
): TestRun {
  return {
    id: "run-1",
    caseName: "步骤试跑",
    deviceSerial: "device-1",
    status: "passed",
    config: {} as TestRun["config"],
    steps: [],
    stepResults: [],
    metrics: [],
    events: [],
    artifacts: [],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "flow-1",
      version: 1,
      planDigest: "a".repeat(64),
      executionPurpose,
      dependencies: [],
      parsed: {}
    },
    startedAt: "2026-08-03T00:00:00.000Z"
  };
}
