import type { TestRun } from "@mobile-automation/shared";

export function canLearnFromSuccessfulRun(run: TestRun): boolean {
  if (run.status !== "passed" || run.sourceSnapshot?.kind !== "script_flow") return false;
  if (run.sourceSnapshot.executionPurpose === "trial") return true;
  return run.sourceSnapshot.executionPurpose === "normal"
    && run.sourceSnapshot.verificationAssessment?.status === "verified";
}
