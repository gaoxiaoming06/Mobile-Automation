import type { LearningCandidate } from "@mobile-automation/shared";
import { automaticLearningDecision } from "./learning-policy.js";

export type LearningAggregateStatus =
  | "collecting"
  | "awaiting_ai"
  | "ready"
  | "active"
  | "rejected"
  | "analysis_failed"
  | "degraded";

export type LearningAggregateReadiness = {
  status: Extract<LearningAggregateStatus, "collecting" | "awaiting_ai" | "ready" | "rejected">;
  reason:
    | "insufficient_runs"
    | "insufficient_evidence_variation"
    | "candidate_ineligible"
    | "ai_analysis_required"
    | "deterministic_evidence";
};

export const MINIMUM_LEARNING_RUNS = 3;
export const MINIMUM_DISTINCT_EVIDENCE = 2;

export function learningAggregateReadiness(input: {
  candidate: LearningCandidate;
  successfulRunCount: number;
  distinctEvidenceCount: number;
}): LearningAggregateReadiness {
  if (input.successfulRunCount < MINIMUM_LEARNING_RUNS) {
    return { status: "collecting", reason: "insufficient_runs" };
  }
  if (input.distinctEvidenceCount < MINIMUM_DISTINCT_EVIDENCE) {
    return { status: "collecting", reason: "insufficient_evidence_variation" };
  }
  if (requiresAiLearningAnalysis(input.candidate)) {
    return { status: "awaiting_ai", reason: "ai_analysis_required" };
  }
  if (!automaticLearningDecision(input.candidate).accept) {
    return { status: "rejected", reason: "candidate_ineligible" };
  }
  return { status: "ready", reason: "deterministic_evidence" };
}

export function requiresAiLearningAnalysis(candidate: LearningCandidate): boolean {
  if (candidate.kind === "page") return true;
  const contract = record(candidate.payload.semanticContract)
    ?? record(record(candidate.payload.action)?.target);
  if (!contract) return true;
  return !nonEmptyString(contract.text);
}

export function nextAggregateStatusAfterAi(decision: "approve" | "observe" | "reject"): {
  status: Extract<LearningAggregateStatus, "ready" | "collecting" | "rejected">;
  reason: "ai_proposal_verified" | "more_samples_required" | "ai_rejected";
} {
  if (decision === "approve") return { status: "ready", reason: "ai_proposal_verified" };
  if (decision === "reject") return { status: "rejected", reason: "ai_rejected" };
  return { status: "collecting", reason: "more_samples_required" };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
