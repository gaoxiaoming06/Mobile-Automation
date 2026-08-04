import type { LearningCandidate, TestRun } from "@mobile-automation/shared";
import type { ScriptStep, ScriptTarget } from "@mobile-automation/script-flow";
import { canLearnFromSuccessfulRun } from "./learning-run-eligibility.js";

export type LearnedNavigationCandidate = Omit<
  LearningCandidate,
  "id" | "sessionId" | "createdAt" | "updatedAt"
>;

export function navigationCandidatesFromTrial(run: TestRun): LearnedNavigationCandidate[] {
  if (!canLearnFromSuccessfulRun(run)) return [];
  const sourceSnapshot = run.sourceSnapshot!;
  const steps = parsedSteps(sourceSnapshot.parsed);
  const candidates = run.stepResults.flatMap((result) => {
    if (result.status !== "passed") return [];
    const step = steps.get(result.stepId);
    if (!step || !("tap" in step)) return [];
    const fromPage = nonEmptyString(step.onPage) ?? nonEmptyString(result.metadata?.onPage);
    const toPage = nonEmptyString(step.expectPage) ?? nonEmptyString(result.metadata?.expectPage);
    if (!fromPage || !toPage || fromPage === toPage || !targetPageWasVerified(result, toPage)) return [];
    if (!record(result.metadata?.semantic)) return [];

    const target = semanticContract(step.tap.target);
    const identity = targetIdentity(target);
    if (!identity) return [];
    const confidence = navigationConfidence(target);
    const expectationResults = result.expectationResults ?? [];
    const evidenceArtifactIds = unique([
      ...(result.afterScreenshotId ? [result.afterScreenshotId] : []),
      ...expectationResults.flatMap((expectation) => expectation.evidenceArtifactIds)
    ]);
    return [{
      kind: "navigation" as const,
      stableKey: `${fromPage}.tap.${identity}.to.${toPage}`,
      sourceStepId: result.stepId,
      confidence,
      status: confidence >= 0.9 ? "validated" as const : "needs_review" as const,
      payload: {
        name: `${fromPage} -> ${toPage}`,
        from: { kind: "page", key: fromPage },
        toPage,
        action: {
          kind: "tap",
          target,
          ...(safeSearch(step.tap.search) ? { search: safeSearch(step.tap.search) } : {})
        }
      },
      evidenceArtifactIds,
      validationIssues: confidence >= 0.9 ? [] : ["导航入口语义需要人工确认后才能启用"]
    }];
  });

  return [...new Map(candidates.map((candidate) => [candidate.stableKey, candidate])).values()];
}

function parsedSteps(parsed: Record<string, unknown>): Map<string, ScriptStep> {
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  return new Map(steps.flatMap((value) => {
    const step = record(value);
    return step && nonEmptyString(step.id) ? [[String(step.id), step as unknown as ScriptStep]] : [];
  }));
}

function targetPageWasVerified(result: TestRun["stepResults"][number], toPage: string): boolean {
  return (result.expectationResults ?? []).some((expectation) =>
    expectation.type === "state_is"
    && expectation.status === "passed"
    && expectation.expected === `Page ${toPage}`
  );
}

function semanticContract(target: ScriptTarget): Record<string, string> {
  const allowed = ["text", "icon", "control", "area", "position", "nearText", "match"] as const;
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = nonEmptyString(target[key]);
    return value ? [[key, value]] : [];
  }));
}

function targetIdentity(contract: Record<string, string>): string | undefined {
  const keys = ["text", "icon", "control", "area", "position", "nearText", "match"] as const;
  const segments = keys.flatMap((key) => contract[key] ? [`${key}.${stableSegment(contract[key])}`] : []);
  return segments.length ? segments.join(".") : undefined;
}

function navigationConfidence(contract: Record<string, string>): number {
  if (contract.text) return 0.98;
  if (contract.control) return 0.95;
  if (contract.icon) return 0.92;
  return 0.88;
}

function safeSearch(value: unknown): Record<string, unknown> | undefined {
  const search = record(value);
  if (!search) return undefined;
  const mode = search.mode === "auto" || search.mode === "visibleOnly" || search.mode === "scroll" ? search.mode : undefined;
  const direction = search.direction === "up" || search.direction === "down" ? search.direction : undefined;
  const maxSwipes = typeof search.maxSwipes === "number" && Number.isInteger(search.maxSwipes)
    ? Math.max(1, Math.min(20, search.maxSwipes))
    : undefined;
  const sanitized = { ...(mode ? { mode } : {}), ...(direction ? { direction } : {}), ...(maxSwipes ? { maxSwipes } : {}) };
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function stableSegment(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[./\\]/g, "-");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
