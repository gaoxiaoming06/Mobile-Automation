import type { Observation, Rect, VisualSemanticArea } from "@mobile-automation/graph-core";
import { normalizeOcrText } from "./step-expectations.js";

export type PageElementQualityStatus = "pass" | "needs_review" | "fail";
export type PageElementQualityWarning = {
  code:
    | "region_missing"
    | "region_too_small"
    | "semantic_area_missing"
    | "target_text_missing"
    | "target_text_not_found"
    | "target_outside_marked_region"
    | "ambiguous_target_text"
    | "duplicate_element_locator"
    | "structural_locator_missing"
    | "dynamic_content_unmasked";
  severity: "info" | "warning" | "error";
  message: string;
};

export type PageElementQualityCandidate = {
  source: "ocr_text" | "ui_element";
  text?: string;
  label: string;
  confidence?: number;
  score: number;
  region?: Rect;
  semanticArea: VisualSemanticArea;
  insideMarkedRegion?: boolean;
};

export type PageElementQualityResult = {
  status: PageElementQualityStatus;
  score: number;
  warnings: PageElementQualityWarning[];
  candidates: PageElementQualityCandidate[];
  evidence: {
    targetText?: string;
    locatorKind?: string;
    dynamicMaskCount?: number;
    semanticArea?: VisualSemanticArea;
    uniqueCandidate: boolean;
    candidateCount: number;
  };
};

export type PageElementQualityInput = {
  element: {
    elementId?: string;
    id?: string;
    locator: string;
    actionKind?: string;
    elementLabel?: string;
    label?: string;
    targetText?: string;
    semanticArea?: VisualSemanticArea;
    region?: Rect;
    locatorKind?: "text_locator" | "visual_locator" | "structural_locator" | "collection_item_locator";
    dynamicMasks?: Array<{ kind?: string; label?: string; region?: Rect }>;
    structuralLocator?: Record<string, unknown>;
  };
  observation?: Observation;
  existingElements?: Array<{
    id?: string;
    label?: string;
    locator?: string;
    actionKind?: string;
  }>;
};

export function validatePageElementAssetQuality(input: PageElementQualityInput): PageElementQualityResult {
  const region = input.element.region ?? parseImageRegionLocator(input.element.locator);
  const semanticArea = readSemanticArea(input.element.semanticArea) ?? (region ? semanticAreaForRegion(region) : "unknown");
  const targetText = textValue(input.element.targetText);
  const locatorKind = readLocatorKind(input.element.locatorKind);
  const dynamicMaskCount = Array.isArray(input.element.dynamicMasks) ? input.element.dynamicMasks.length : 0;
  const warnings: PageElementQualityWarning[] = [];

  if (!region) {
    warnings.push(warning("region_missing", "error", "缺少截图圈选区域，无法建立稳定的视觉定位资产。"));
  } else if (isRegionTooSmall(region)) {
    warnings.push(warning("region_too_small", "error", "圈选区域过小，执行时很容易点偏或无法重定位。"));
  }
  if (!input.element.semanticArea || semanticArea === "unknown") {
    warnings.push(warning("semantic_area_missing", "warning", "缺少明确的区域语义，执行时只能扩大搜索范围。"));
  }
  if (hasDuplicateElement(input)) {
    warnings.push(warning("duplicate_element_locator", "info", "同页已有相同 locator 和动作类型的元素，保存时会更新旧记录。"));
  }
  if (locatorKind === "structural_locator" && !hasStructuralLocatorEvidence(input.element.structuralLocator)) {
    warnings.push(warning("structural_locator_missing", "warning", "结构型元素缺少稳定结构证据，请补充行结构、箭头、相对顺序或稳定锚点。"));
  }
  if (
    locatorKind === "visual_locator" &&
    !targetText &&
    dynamicMaskCount === 0 &&
    region &&
    input.observation &&
    dynamicTextInsideMarkedRegion(input.observation, region) > 0
  ) {
    warnings.push(warning("dynamic_content_unmasked", "warning", "圈选区域包含动态文字或个人内容，但没有动态区域 mask；建议改为结构型定位或排除动态内容。"));
  }

  const candidates = targetText && input.observation
    ? matchingCandidates(input.observation, targetText, semanticArea, region)
    : [];
  if (targetText && input.observation && candidates.length === 0) {
    warnings.push(warning("target_text_not_found", "warning", "当前页面 OCR/UI 树没有找到执行识别文字，请确认圈选区域或识别文字。"));
  }
  if (targetText && input.observation && region && candidates.length > 0 && !candidates.some((candidate) => candidate.insideMarkedRegion)) {
    warnings.push(warning("target_outside_marked_region", "warning", "识别文字没有落在当前圈选区域内，请重新圈住完整可点击行或控件。"));
  }
  if (candidates.length > 1) {
    warnings.push(warning("ambiguous_target_text", "warning", "同一区域内存在多个相似文字候选，执行时可能点到错误元素。"));
  }

  const errorCount = warnings.filter((item) => item.severity === "error").length;
  const warningCount = warnings.filter((item) => item.severity === "warning").length;
  const score = qualityScore({
    hasRegion: Boolean(region),
    regionTooSmall: Boolean(region && isRegionTooSmall(region)),
    hasSemanticArea: semanticArea !== "unknown",
    hasTargetText: Boolean(targetText),
    candidateCount: candidates.length,
    warningCount
  });
  const status: PageElementQualityStatus = errorCount > 0 ? "fail" : warningCount > 0 ? "needs_review" : "pass";

  return {
    status,
    score,
    warnings,
    candidates,
    evidence: {
      ...(targetText ? { targetText } : {}),
      ...(locatorKind ? { locatorKind } : {}),
      ...(dynamicMaskCount ? { dynamicMaskCount } : {}),
      semanticArea,
      uniqueCandidate: candidates.length === 1,
      candidateCount: candidates.length
    }
  };
}

function readLocatorKind(value: unknown): PageElementQualityInput["element"]["locatorKind"] {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator"
    ? value
    : undefined;
}

function hasStructuralLocatorEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Boolean(record.kind || record.role || (Array.isArray(record.stableAnchors) && record.stableAnchors.length > 0) || record.indexHint);
}

function dynamicTextInsideMarkedRegion(observation: Observation, markedRegion: Rect): number {
  const ocrResolution = screenshotResolution(observation) ?? observation.resolution;
  if (!ocrResolution?.width || !ocrResolution.height) {
    return 0;
  }
  return observation.ocrTexts.filter((item) => {
    const text = textValue(item.text);
    if (!text || !item.region) {
      return false;
    }
    const percentRegion = pixelRectToPercent(item.region, ocrResolution);
    return rectCenterInside(percentRegion, markedRegion);
  }).length;
}

function matchingCandidates(
  observation: Observation,
  targetText: string,
  semanticArea: VisualSemanticArea,
  markedRegion: Rect | undefined
): PageElementQualityCandidate[] {
  const ocrResolution = screenshotResolution(observation) ?? observation.resolution;
  const uiResolution = observation.resolution ?? ocrResolution;
  const ocrCandidates = observation.ocrTexts
    .filter((item) => textMatches(item.text, targetText))
    .map((item): PageElementQualityCandidate => {
      const percentRegion = item.region && ocrResolution?.width && ocrResolution.height
        ? pixelRectToPercent(item.region, { width: ocrResolution.width, height: ocrResolution.height })
        : item.region;
      const area = readSemanticArea(item.semanticArea) ?? (percentRegion ? semanticAreaForRegion(percentRegion) : "unknown");
      const insideMarkedRegion = Boolean(markedRegion && percentRegion && rectCenterInside(percentRegion, markedRegion));
      return {
        source: "ocr_text",
        text: item.text,
        label: item.text,
        confidence: item.confidence,
        score: candidateScore(item.confidence, insideMarkedRegion),
        ...(percentRegion ? { region: percentRegion } : {}),
        semanticArea: area,
        insideMarkedRegion
      };
    });
  const uiCandidates = observation.uiElements
    .filter((item) => textMatches([item.text, item.contentDesc, item.accessibilityId].filter(Boolean).join(" "), targetText))
    .map((item): PageElementQualityCandidate => {
      const percentRegion = item.bounds && uiResolution?.width && uiResolution.height
        ? pixelRectToPercent(item.bounds, { width: uiResolution.width, height: uiResolution.height })
        : item.bounds;
      const area = percentRegion ? semanticAreaForRegion(percentRegion) : "unknown";
      const label = item.text || item.contentDesc || item.accessibilityId || item.resourceId || "ui_element";
      const insideMarkedRegion = Boolean(markedRegion && percentRegion && rectCenterInside(percentRegion, markedRegion));
      return {
        source: "ui_element",
        text: item.text || item.contentDesc || item.accessibilityId,
        label,
        score: candidateScore(undefined, insideMarkedRegion),
        ...(percentRegion ? { region: percentRegion } : {}),
        semanticArea: area,
        insideMarkedRegion
      };
    });
  return dedupeCandidates([...ocrCandidates, ...uiCandidates])
    .filter((candidate) => semanticArea === "unknown" || candidate.semanticArea === "unknown" || candidate.semanticArea === semanticArea)
    .sort((left, right) => right.score - left.score);
}

function screenshotResolution(observation: Observation): { width: number; height: number } | undefined {
  return observation.screenshot?.width && observation.screenshot.height
    ? { width: observation.screenshot.width, height: observation.screenshot.height }
    : undefined;
}

function dedupeCandidates(candidates: PageElementQualityCandidate[]): PageElementQualityCandidate[] {
  const result: PageElementQualityCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = result.findIndex((item) => sameCandidateTarget(item, candidate));
    if (duplicateIndex < 0) {
      result.push(candidate);
      continue;
    }
    const existing = result[duplicateIndex]!;
    result[duplicateIndex] = {
      ...existing,
      source: existing.source === "ocr_text" ? existing.source : candidate.source,
      confidence: existing.confidence ?? candidate.confidence,
      score: Math.max(existing.score, candidate.score),
      insideMarkedRegion: Boolean(existing.insideMarkedRegion || candidate.insideMarkedRegion)
    };
  }
  return result;
}

function sameCandidateTarget(left: PageElementQualityCandidate, right: PageElementQualityCandidate): boolean {
  const leftText = normalizeOcrText(left.text || left.label).toLowerCase();
  const rightText = normalizeOcrText(right.text || right.label).toLowerCase();
  if (!leftText || leftText !== rightText || !left.region || !right.region) {
    return false;
  }
  const leftCenter = rectCenter(left.region);
  const rightCenter = rectCenter(right.region);
  return Math.abs(leftCenter.x - rightCenter.x) <= 2 && Math.abs(leftCenter.y - rightCenter.y) <= 2;
}

function qualityScore(input: {
  hasRegion: boolean;
  regionTooSmall: boolean;
  hasSemanticArea: boolean;
  hasTargetText: boolean;
  candidateCount: number;
  warningCount: number;
}): number {
  let score = 0.45;
  if (input.hasRegion) {
    score += 0.18;
  }
  if (input.hasSemanticArea) {
    score += 0.12;
  }
  if (input.hasTargetText) {
    score += 0.12;
  }
  if (input.candidateCount === 1) {
    score += 0.18;
  } else if (input.candidateCount > 1) {
    score -= 0.12;
  }
  if (input.regionTooSmall) {
    score -= 0.38;
  }
  score -= Math.max(0, input.warningCount - 1) * 0.04;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

function hasDuplicateElement(input: PageElementQualityInput): boolean {
  const elementId = textValue(input.element.elementId) || textValue(input.element.id);
  const actionKind = textValue(input.element.actionKind);
  return (input.existingElements ?? []).some((item) => {
    if (elementId && item.id === elementId) {
      return false;
    }
    return item.locator === input.element.locator && (!actionKind || !item.actionKind || item.actionKind === actionKind);
  });
}

function textMatches(actual: string | undefined, expected: string): boolean {
  const actualText = normalizeOcrText(actual ?? "").toLowerCase();
  const expectedText = normalizeOcrText(expected).toLowerCase();
  return Boolean(actualText && expectedText && (actualText.includes(expectedText) || expectedText.includes(actualText)));
}

function candidateScore(confidence: number | undefined, insideMarkedRegion: boolean): number {
  return Math.max(0, Math.min(1, Math.round(((confidence ?? 0.72) + (insideMarkedRegion ? 0.16 : 0)) * 100) / 100));
}

function pixelRectToPercent(rect: Rect, size: { width: number; height: number }): Rect {
  return {
    x: roundPercent((rect.x / size.width) * 100),
    y: roundPercent((rect.y / size.height) * 100),
    width: roundPercent((rect.width / size.width) * 100),
    height: roundPercent((rect.height / size.height) * 100)
  };
}

function rectCenterInside(candidate: Rect, marked: Rect): boolean {
  const { x: centerX, y: centerY } = rectCenter(candidate);
  return centerX >= marked.x && centerX <= marked.x + marked.width && centerY >= marked.y && centerY <= marked.y + marked.height;
}

function rectCenter(rect: Rect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function isRegionTooSmall(region: Rect): boolean {
  return region.width < 2 || region.height < 1.5 || region.width * region.height < 8;
}

function parseImageRegionLocator(locator: string | undefined): Rect | undefined {
  if (!locator?.startsWith("image-region:")) {
    return undefined;
  }
  const [x, y, width, height] = locator
    .replace("image-region:", "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function semanticAreaForRegion(region: Rect): VisualSemanticArea {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function readSemanticArea(value: unknown): VisualSemanticArea | undefined {
  return value === "top" || value === "content" || value === "bottom" || value === "unknown" ? value : undefined;
}

function warning(code: PageElementQualityWarning["code"], severity: PageElementQualityWarning["severity"], message: string): PageElementQualityWarning {
  return { code, severity, message };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}
