import type { LearningCandidate, TestRun } from "@mobile-automation/shared";
import type { ScriptStep, ScriptTarget } from "@mobile-automation/script-flow";
import { canLearnFromSuccessfulRun } from "./learning-run-eligibility.js";

export type LearnedInteractionCandidate = Omit<
  LearningCandidate,
  "id" | "sessionId" | "createdAt" | "updatedAt"
>;

const ACTION_KEYS = ["tap", "inputText", "clearText", "selectText"] as const;
type SupportedAction = typeof ACTION_KEYS[number];

export function interactionCandidatesFromTrial(run: TestRun): LearnedInteractionCandidate[] {
  if (!canLearnFromSuccessfulRun(run)) return [];
  const sourceSnapshot = run.sourceSnapshot!;
  const steps = parsedSteps(sourceSnapshot.parsed);
  const artifactsByResult = new Map<string, string[]>();
  for (const artifact of run.artifacts) {
    if (!artifact.stepResultId) continue;
    artifactsByResult.set(artifact.stepResultId, [
      ...(artifactsByResult.get(artifact.stepResultId) ?? []),
      artifact.id
    ]);
  }

  return run.stepResults.flatMap((result) => {
    if (result.status !== "passed") return [];
    const step = steps.get(result.stepId);
    const action = step ? actionTarget(step) : undefined;
    const ownerPage = nonEmptyString(step?.onPage) ?? nonEmptyString(result.metadata?.onPage);
    const semanticMetadata = record(result.metadata?.semantic);
    if (!step || !action || !ownerPage || !semanticMetadata) return [];

    const contract = semanticContract(action.target);
    const identity = targetIdentity(contract);
    if (!identity) return [];
    const confidence = targetConfidence(contract);
    const selectedLocator = record(semanticMetadata.selectedLocator);
    const locator = record(semanticMetadata.locator);
    const selectedText = nonEmptyString(selectedLocator?.text)
      ?? nonEmptyString(semanticMetadata.actual)
      ?? nonEmptyString(locator?.text);
    const evidenceArtifactIds = unique([
      ...(result.afterScreenshotId ? [result.afterScreenshotId] : []),
      ...(artifactsByResult.get(result.id) ?? [])
    ]);

    return [{
      kind: "interaction" as const,
      stableKey: `${ownerPage}.${action.kind}.${identity}`,
      sourceStepId: result.stepId,
      confidence,
      status: confidence >= 0.9 ? "validated" as const : "needs_review" as const,
      payload: {
        owner: { kind: "page", key: ownerPage },
        name: interactionName(contract),
        supportedAction: action.kind,
        semanticContract: contract,
        locatorEvidence: {
          strategy: locatorStrategy(semanticMetadata),
          ...(selectedText ? { selectedText } : {})
        }
      },
      evidenceArtifactIds,
      validationIssues: confidence >= 0.9 ? [] : ["语义目标需要人工确认后才能启用"]
    }];
  });
}

function parsedSteps(parsed: Record<string, unknown>): Map<string, ScriptStep> {
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  return new Map(steps.flatMap((value) => {
    const step = record(value);
    return step && nonEmptyString(step.id) ? [[String(step.id), step as unknown as ScriptStep]] : [];
  }));
}

function actionTarget(step: ScriptStep): { kind: SupportedAction; target: ScriptTarget } | undefined {
  for (const kind of ACTION_KEYS) {
    if (!(kind in step)) continue;
    const action = record((step as unknown as Record<string, unknown>)[kind]);
    const target = record(action?.target);
    if (target) return { kind, target: target as ScriptTarget };
  }
  return undefined;
}

function semanticContract(target: ScriptTarget): Record<string, string> {
  const allowed = ["text", "semantic", "icon", "control", "area", "position", "nearText", "match"] as const;
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = nonEmptyString(target[key]);
    return value ? [[key, value]] : [];
  }));
}

function targetIdentity(contract: Record<string, string>): string | undefined {
  const keys = ["text", "semantic", "icon", "control", "area", "position", "nearText", "match"] as const;
  const segments = keys.flatMap((key) => contract[key] ? [`${key}.${stableSegment(contract[key])}`] : []);
  return segments.length ? segments.join(".") : undefined;
}

function targetConfidence(contract: Record<string, string>): number {
  if (contract.text) return 0.95;
  if (contract.control) return 0.9;
  if (contract.icon) return 0.82;
  return 0.75;
}

function interactionName(contract: Record<string, string>): string {
  return contract.text ?? contract.semantic ?? contract.icon ?? contract.control ?? "未命名交互";
}

function locatorStrategy(metadata: Record<string, unknown>): string {
  const type = nonEmptyString(metadata.type);
  if (type === "ocr_text" || type === "text_locator") return "ocr_text";
  if (type === "semantic_icon_locator" || type === "top_bar_icon_locator") return "visual_icon";
  return type ?? "semantic_runtime";
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
