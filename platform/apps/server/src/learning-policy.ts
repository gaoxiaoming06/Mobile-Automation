import type { LearningCandidate } from "@mobile-automation/shared";

export type AutomaticLearningDecision =
  | { accept: true; reason: "eligible" }
  | {
      accept: false;
      reason:
        | "unvalidated"
        | "low_confidence"
        | "missing_evidence"
        | "validation_issues"
        | "unsupported_kind"
        | "coordinate_dependent"
        | "dynamic_or_sensitive_literal";
    };

const MINIMUM_CONFIDENCE = 0.95;
const FORBIDDEN_LOCATOR_KEY = /^(?:x|y|centerX|centerY|coordinate|coordinates|bounds|region|region_center|tapPointPercent)$/i;
const SENSITIVE_FIELD_KEY = /(?:password|passwd|secret|token|account|phone|mobile|email)/i;
const PARAMETER_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

export function automaticLearningDecision(candidate: LearningCandidate): AutomaticLearningDecision {
  if (candidate.kind !== "interaction" && candidate.kind !== "navigation") {
    return { accept: false, reason: "unsupported_kind" };
  }
  if (candidate.status !== "validated") return { accept: false, reason: "unvalidated" };
  if (candidate.confidence < MINIMUM_CONFIDENCE) return { accept: false, reason: "low_confidence" };
  if (candidate.validationIssues.length > 0) return { accept: false, reason: "validation_issues" };
  if (candidate.evidenceArtifactIds.length === 0) return { accept: false, reason: "missing_evidence" };
  if (containsCoordinateDependency(candidate.payload)) return { accept: false, reason: "coordinate_dependent" };
  if (containsDynamicOrSensitiveLiteral(candidate.payload)) {
    return { accept: false, reason: "dynamic_or_sensitive_literal" };
  }
  return { accept: true, reason: "eligible" };
}

function containsCoordinateDependency(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCoordinateDependency);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_LOCATOR_KEY.test(key) || containsCoordinateDependency(child)
  );
}

function containsDynamicOrSensitiveLiteral(value: unknown, field = ""): boolean {
  if (typeof value === "string") {
    if (PARAMETER_PLACEHOLDER.test(value.trim())) return false;
    if (SENSITIVE_FIELD_KEY.test(field) && value.trim()) return true;
    if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)) return true;
    if (/(?:^|\D)\d{7,}(?:\D|$)/.test(value)) return true;
    if (/(?:password|passwd|secret|token)[-_:= ]*[A-Za-z0-9]{6,}/i.test(value)) return true;
    return false;
  }
  if (Array.isArray(value)) return value.some((item) => containsDynamicOrSensitiveLiteral(item, field));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => containsDynamicOrSensitiveLiteral(child, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
