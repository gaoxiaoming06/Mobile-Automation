import type { Observation } from "@mobile-automation/graph-core";
import type {
  ScreenControlCandidate,
  ScreenUnderstandingCandidate,
  ScreenUnderstandingContext
} from "@mobile-automation/shared";

type ScreenPromptEvidence = {
  observationId?: string;
  deviceSerial?: string;
  platform: Observation["platform"];
  capturedAt: string;
  resolution?: Observation["resolution"];
  screenshot?: {
    width?: number;
    height?: number;
    sizeBytes?: number;
  };
  ocrTexts: string[];
  uiTexts: Array<{
    text: string;
    control: ScreenControlCandidate["control"];
    enabled?: boolean;
    visible?: boolean;
  }>;
};

export type ScreenEvidence = {
  imagePngBase64?: string;
  promptEvidence: ScreenPromptEvidence;
};

const MAX_PROMPT_TEXTS = 40;
const MAX_VISIBLE_STABLE_TEXTS = 40;
const MAX_CONTROL_CANDIDATES = 30;
const FORBIDDEN_CANDIDATE_FIELDS = [
  "bounds",
  "region",
  "resourceId",
  "accessibilityId",
  "screenshotBase64",
  "coordinate",
  "coordinates",
  "x",
  "y"
] as const;
const CONTROL_VALUES = new Set<ScreenControlCandidate["control"]>(["button", "textField", "checkbox", "switch", "select", "text"]);

export function buildScreenEvidence(observation: Observation): ScreenEvidence {
  return {
    imagePngBase64: typeof observation.raw?.screenshotBase64 === "string" ? observation.raw.screenshotBase64 : undefined,
    promptEvidence: {
      observationId: observation.id,
      deviceSerial: observation.deviceSerial,
      platform: observation.platform,
      capturedAt: observation.capturedAt,
      resolution: observation.resolution,
      screenshot: observation.screenshot
        ? {
            width: observation.screenshot.width,
            height: observation.screenshot.height,
            sizeBytes: observation.screenshot.sizeBytes
          }
        : undefined,
      ocrTexts: uniqueStableStrings(observation.ocrTexts.map((text) => text.text)).slice(0, MAX_PROMPT_TEXTS),
      uiTexts: observation.uiElements
        .map((element) => {
          const text = sanitizeStableText(element.text);
          if (!text) {
            return undefined;
          }
          return {
            text,
            control: inferControl(element),
            enabled: element.enabled,
            visible: element.visible
          };
        })
        .filter((element): element is NonNullable<typeof element> => Boolean(element))
        .slice(0, MAX_PROMPT_TEXTS)
    }
  };
}

export function sanitizeScreenUnderstandingCandidate(input: {
  observationId: string;
  visionUsed: boolean;
  candidate: ScreenUnderstandingCandidate;
}): ScreenUnderstandingContext {
  const rejectedReasons: string[] = [];
  const controls: ScreenUnderstandingContext["controlCandidates"] = [];

  for (const [index, raw] of input.candidate.controlCandidates.entries()) {
    const forbiddenFields = forbiddenCandidateFields(raw);
    if (forbiddenFields.length) {
      for (const field of forbiddenFields) {
        rejectedReasons.push(`controlCandidates[${index}] rejected because it contains ${field}`);
      }
      continue;
    }

    const control = CONTROL_VALUES.has(raw.control) ? raw.control : undefined;
    if (!control) {
      rejectedReasons.push(`controlCandidates[${index}] rejected because control is unsupported`);
      continue;
    }

    const rawValueKind = normalizeValueKind(raw.valueKind);
    const valueKind = rawValueKind === "sensitiveValue" ? "dynamicValue" : rawValueKind;
    const hasDynamicValue = Boolean(raw.currentValue && (rawValueKind === "dynamicValue" || rawValueKind === "sensitiveValue" || isSensitiveOrDynamicText(raw.currentValue)));
    const candidate = compactControlCandidate({
      candidateId: sanitizeIdentifier(raw.candidateId) ?? `screen-control-${index + 1}`,
      control,
      semanticName: sanitizeIdentifier(raw.semanticName),
      text: sanitizeStableText(raw.text),
      scopeText: sanitizeStableText(raw.scopeText),
      nearText: sanitizeStableText(raw.nearText),
      ordinal: normalizeOrdinal(raw.ordinal),
      valueKind,
      confidence: normalizeConfidence(raw.confidence),
      assetEligible: raw.assetEligible === true && !hasDynamicValue && valueKind !== "dynamicValue"
    });

    if (hasDynamicValue) {
      rejectedReasons.push(`controlCandidates[${index}].currentValue removed because valueKind is ${rawValueKind ?? "unknown"}`);
    }
    controls.push(candidate);
    if (controls.length >= MAX_CONTROL_CANDIDATES) {
      break;
    }
  }

  return {
    used: true,
    observationId: input.observationId,
    visionUsed: input.visionUsed,
    page: {
      key: sanitizeIdentifier(input.candidate.page.key),
      name: sanitizeStableText(input.candidate.page.name),
      confidence: normalizeConfidence(input.candidate.page.confidence)
    },
    visibleStableTexts: uniqueStableStrings(input.candidate.visibleStableTexts).slice(0, MAX_VISIBLE_STABLE_TEXTS),
    controlCandidates: controls,
    rejectedReasons
  };
}

function compactControlCandidate(candidate: ScreenUnderstandingContext["controlCandidates"][number]): ScreenUnderstandingContext["controlCandidates"][number] {
  return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)) as ScreenUnderstandingContext["controlCandidates"][number];
}

function forbiddenCandidateFields(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }
  const record = candidate as Record<string, unknown>;
  return FORBIDDEN_CANDIDATE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function uniqueStableStrings(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const sanitized = sanitizeStableText(value);
    if (!sanitized || seen.has(sanitized)) {
      continue;
    }
    seen.add(sanitized);
    result.push(sanitized);
  }
  return result;
}

function sanitizeStableText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  const redacted = normalized
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted-email]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g, "[redacted-phone]")
    .replace(/\b\d{6,}\b/g, "[redacted-number]");
  if (isOnlyRedaction(redacted) || isSensitiveOrDynamicText(normalized)) {
    return undefined;
  }
  return redacted;
}

function isOnlyRedaction(value: string): boolean {
  return value.replace(/\[(?:redacted-email|redacted-phone|redacted-number)\]/g, "").trim() === "";
}

function isSensitiveOrDynamicText(value: string): boolean {
  const normalized = value.trim();
  return (
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(normalized) ||
    /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/.test(normalized) ||
    /\b\d{6,}\b/.test(normalized) ||
    /\b\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(normalized) ||
    /\b\d{1,2}:\d{2}\b/.test(normalized)
  );
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || isSensitiveOrDynamicText(normalized)) {
    return undefined;
  }
  return normalized.slice(0, 120);
}

function normalizeValueKind(value: ScreenControlCandidate["valueKind"] | undefined): ScreenControlCandidate["valueKind"] | undefined {
  return value === "stableLabel" || value === "dynamicValue" || value === "sensitiveValue" || value === "unknown" ? value : undefined;
}

function normalizeOrdinal(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function inferControl(element: Observation["uiElements"][number]): ScreenControlCandidate["control"] {
  const className = element.className?.toLowerCase() ?? "";
  if (className.includes("edittext") || className.includes("textfield")) {
    return "textField";
  }
  if (className.includes("checkbox")) {
    return "checkbox";
  }
  if (className.includes("switch")) {
    return "switch";
  }
  if (className.includes("spinner") || className.includes("select")) {
    return "select";
  }
  if (element.clickable) {
    return "button";
  }
  return "text";
}
