import { createHash } from "node:crypto";
import type { ScriptFlowDocument, ScriptStep } from "@mobile-automation/script-flow";
import type { ScriptFlowVerificationAssessment } from "@mobile-automation/shared";

export type ScriptFlowVerificationAssessmentInput = {
  document: ScriptFlowDocument;
  sourceYaml: string;
  verifiedSourceHashes?: Iterable<string>;
  blockedReasons?: string[];
};

export function scriptFlowSourceHash(sourceYaml: string): string {
  return createHash("sha256").update(sourceYaml).digest("hex");
}

export function assessScriptFlowVerification(
  input: ScriptFlowVerificationAssessmentInput
): ScriptFlowVerificationAssessment {
  const sourceHash = scriptFlowSourceHash(input.sourceYaml);
  const blockedReasons = uniqueNonEmpty(input.blockedReasons ?? []);
  const verified = new Set(input.verifiedSourceHashes ?? []).has(sourceHash);

  if (verified && blockedReasons.length === 0) {
    return {
      status: "verified",
      sourceHash,
      reasons: [],
      unresolvedStepIds: [],
      unresolvedOutcome: false
    };
  }

  return {
    status: blockedReasons.length ? "blocked" : "needs_trial",
    sourceHash,
    reasons: blockedReasons.length ? blockedReasons : ["当前脚本版本尚未通过试运行"],
    unresolvedStepIds: flattenSteps(input.document.steps)
      .filter(isTrialAction)
      .map((step) => step.id),
    unresolvedOutcome: !hasResultOracle(input.document)
  };
}

function hasResultOracle(document: ScriptFlowDocument): boolean {
  if (document.outcome?.page) return true;
  const finalStep = document.steps.at(-1);
  if (!finalStep || "repeat" in finalStep || "when" in finalStep || "runFlow" in finalStep) return false;
  return Boolean(finalStep.expectPage)
    || "assertPage" in finalStep
    || "assertText" in finalStep
    || "waitForPage" in finalStep
    || "reachPage" in finalStep;
}

function isTrialAction(step: ScriptStep): boolean {
  return "launchApp" in step
    || "tap" in step
    || "inputText" in step
    || "clearText" in step
    || "selectText" in step
    || "swipe" in step
    || "scrollUntilVisible" in step
    || "reachPage" in step
    || "runFlow" in step;
}

function flattenSteps(steps: ScriptStep[]): ScriptStep[] {
  return steps.flatMap((step) => {
    if ("repeat" in step) return [step, ...flattenSteps(step.repeat.steps)];
    if ("when" in step) return [step, ...flattenSteps(step.when.steps)];
    return [step];
  });
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
