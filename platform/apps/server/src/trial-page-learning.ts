import type { LearningCandidate, TestRun } from "@mobile-automation/shared";
import { canLearnFromSuccessfulRun } from "./learning-run-eligibility.js";

export type LearnedPageCandidate = Omit<
  LearningCandidate,
  "id" | "sessionId" | "createdAt" | "updatedAt"
>;

export function pageCandidatesFromTrial(run: TestRun): LearnedPageCandidate[] {
  if (!canLearnFromSuccessfulRun(run)) return [];
  const sourceSnapshot = run.sourceSnapshot!;
  const steps = Array.isArray(sourceSnapshot.parsed.steps)
    ? sourceSnapshot.parsed.steps.flatMap((value) => record(value) ? [record(value)!] : [])
    : [];
  const finalStep = steps.at(-1);
  const finalStepId = nonEmptyString(finalStep?.id);
  const assertion = record(finalStep?.assertText);
  const assertedText = nonEmptyString(assertion?.text);
  if (!finalStep || !finalStepId || !assertedText) return [];

  const result = [...run.stepResults]
    .reverse()
    .find((item) => item.stepId === finalStepId && item.status === "passed");
  if (!result || !textOutcomePassed(result, assertedText)) return [];

  const artifactIds = unique([
    ...(result.afterScreenshotId ? [result.afterScreenshotId] : []),
    ...(result.expectationResults ?? []).flatMap((item) => item.evidenceArtifactIds),
    ...run.artifacts.flatMap((artifact) => artifact.stepResultId === result.id ? [artifact.id] : [])
  ]);
  if (artifactIds.length === 0) return [];

  return [{
    kind: "page",
    stableKey: `assert-text.${stableSegment(assertedText)}`,
    sourceStepId: finalStepId,
    confidence: 0.8,
    status: "needs_review",
    payload: {
      suggestedName: nonEmptyString(finalStep.name) ?? `${assertedText}页面`,
      assertedText,
      sourceFlowName: run.caseName
    },
    evidenceArtifactIds: artifactIds,
    validationIssues: []
  }];
}

function textOutcomePassed(result: TestRun["stepResults"][number], assertedText: string): boolean {
  return (result.expectationResults ?? []).some((expectation) =>
    expectation.type === "text"
    && expectation.status === "passed"
    && normalize(expectation.expected).includes(normalize(assertedText))
  );
}

function stableSegment(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[./\\]/g, "-");
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
