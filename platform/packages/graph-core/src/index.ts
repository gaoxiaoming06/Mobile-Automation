import type { DeviceEvent, Platform, StepExpectation } from "@mobile-automation/shared";

export type PlatformScope = Platform | "mobile-both";

export type VisualSemanticArea = "top" | "content" | "bottom" | "unknown";

export type GraphLifecycleStatus = "draft" | "active" | "deprecated" | "rejected";

export type GraphTargetProfilePlatform = Platform | "harmony" | "flutter";

export type GraphTargetProfile = {
  id: string;
  platform: GraphTargetProfilePlatform;
  displayName?: string;
  androidPackageName?: string;
  iosBundleId?: string;
  harmonyBundleName?: string;
  flutterAppId?: string;
  isPrimary?: boolean;
  launchConfig?: Record<string, unknown>;
  systemGuardPolicy?: Record<string, unknown>;
};

export type GraphTargetApp = {
  productId?: string;
  productName?: string;
  profiles?: GraphTargetProfile[];
};

export type BusinessGraph = {
  id: string;
  appId: string;
  targetApp?: GraphTargetApp;
  platformScope: PlatformScope;
  name: string;
  status: "draft" | "active" | "deprecated";
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessGraphVersion = {
  id: string;
  graphId: string;
  version: number;
  sourceSummary: string[];
  status: "draft" | "active" | "archived";
  nodes: BusinessNode[];
  createdAt: string;
};

export type BusinessNode = {
  id: string;
  graphVersionId: string;
  key: string;
  name: string;
  nodeType: "root" | "page" | "business_state" | "terminal";
  tags: string[];
  status: GraphLifecycleStatus;
  matchers: StateMatcher[];
  defaultExpectations: StepExpectation[];
  platformScope?: PlatformScope;
  metadata?: Record<string, unknown>;
};

export type StateMatcher = {
  id: string;
  type:
    | "activity"
    | "route"
    | "fragment"
    | "resource_id"
    | "accessibility_id"
    | "text"
    | "ocr_text"
    | "image_region"
    | "semantic_image_region"
    | "package"
    | "bundle_id"
    | "custom";
  value: string;
  weight: number;
  critical?: boolean;
  threshold?: number;
  region?: Rect;
  ignoreRegions?: Rect[];
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  platformScope?: PlatformScope;
  source?: GraphAssetSource;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphAssetSource = {
  sourceType: "source_scan" | "exploration" | "manual_recording" | "manual_edit" | "imported" | "ai_draft";
  filePath?: string;
  line?: number;
  stepId?: string;
  artifactId?: string;
  artifactPath?: string;
  confidence?: number;
};

export type Observation = {
  id?: string;
  deviceSerial?: string;
  platform: Platform;
  capturedAt: string;
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  componentName?: string;
  routeName?: string;
  fragments?: string[];
  resolution?: {
    width: number;
    height: number;
  };
  orientation?: "portrait" | "landscape";
  screenshot?: ObservationScreenshot;
  uiElements: ObservationUiElement[];
  ocrTexts: ObservationText[];
  imageRegions?: ObservationImageRegion[];
  events?: ObservationEventSummary[];
  raw?: Record<string, unknown>;
};

export type ObservationScreenshot = {
  artifactId?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

export type ObservationUiElement = {
  resourceId?: string;
  accessibilityId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  bounds?: Rect;
  enabled?: boolean;
  visible?: boolean;
  clickable?: boolean;
  longClickable?: boolean;
  focusable?: boolean;
  scrollable?: boolean;
};

export type ObservationText = {
  text: string;
  confidence?: number;
  region?: Rect;
  semanticArea?: VisualSemanticArea;
  source?: "ocr" | "ui_tree" | "accessibility";
};

export type ObservationImageRegion = {
  id?: string;
  value: string;
  region?: Rect;
  semanticArea?: VisualSemanticArea;
  similarity?: number;
  artifactId?: string;
};

export type ObservationEventSummary = {
  type: DeviceEvent["type"];
  severity: DeviceEvent["severity"];
  summary: string;
  occurredAt?: string;
};

export type NodeMatchStatus = "matched" | "multiple_candidates" | "unknown";

export type MatcherResult = {
  matcherId: string;
  type: StateMatcher["type"];
  expected: string;
  actual?: string;
  weight: number;
  critical?: boolean;
  region?: Rect;
  source?: GraphAssetSource;
  matched: boolean;
  score: number;
  reason?: string;
};

export type NodeMatchQuality = {
  status: "sufficient" | "low_confidence";
  reasons: string[];
  matchedContextSignals: number;
  matchedStrongSignals: number;
  matchedWeakSignals: number;
  missingStrongMatcherIds: string[];
  missingCriticalMatcherIds: string[];
};

export type NodeMatchCandidate = {
  node: BusinessNode;
  score: number;
  matchedWeight: number;
  totalWeight: number;
  matcherResults: MatcherResult[];
  quality: NodeMatchQuality;
};

export type NodeMatchResult = {
  status: NodeMatchStatus;
  observationId?: string;
  capturedAt: string;
  node?: BusinessNode;
  score: number;
  candidates: NodeMatchCandidate[];
  threshold: number;
};

export type DetectNodeOptions = {
  minScore?: number;
  tieTolerance?: number;
  evidenceTieTolerance?: number;
  maxCandidates?: number;
};

export function detectNode(
  observation: Observation,
  graphVersion: BusinessGraphVersion,
  platform: Platform = observation.platform,
  options: DetectNodeOptions = {}
): NodeMatchResult {
  const minScore = options.minScore ?? 0.6;
  const tieTolerance = options.tieTolerance ?? 0.05;
  const evidenceTieTolerance = options.evidenceTieTolerance ?? 0.1;
  const maxCandidates = options.maxCandidates ?? 5;
  const candidates = graphVersion.nodes
    .filter((node) => node.status === "active" && supportsPlatform(node.platformScope, platform))
    .map((node) => scoreNode(node, observation, platform))
    .filter((candidate) => candidate.totalWeight > 0)
    .sort((left, right) => right.score - left.score || right.matchedWeight - left.matchedWeight || left.node.name.localeCompare(right.node.name));

  const topCandidate = candidates[0];
  if (!topCandidate || topCandidate.score < minScore) {
    return {
      status: "unknown",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: topCandidate?.score ?? 0,
      candidates: candidates.slice(0, maxCandidates),
      threshold: minScore
    };
  }

  const qualityCandidates = candidates.filter((candidate) => candidate.score >= minScore && candidate.quality.status === "sufficient");
  const top = qualityCandidates[0];
  if (!top) {
    const tiedLowConfidence = candidates
      .filter(
        (candidate) =>
          candidate.score >= minScore &&
          topCandidate.score - candidate.score <= tieTolerance &&
          topCandidate.matchedWeight - candidate.matchedWeight <= evidenceTieTolerance
      )
      .slice(0, maxCandidates);
    return {
      status: tiedLowConfidence.length > 1 ? "multiple_candidates" : "unknown",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: topCandidate.score,
      candidates: candidates.slice(0, maxCandidates),
      threshold: minScore
    };
  }

  const tied = qualityCandidates
    .filter(
      (candidate) =>
        candidate.score >= minScore &&
        top.score - candidate.score <= tieTolerance &&
        top.matchedWeight - candidate.matchedWeight <= evidenceTieTolerance
    )
    .slice(0, maxCandidates);
  if (tied.length > 1) {
    return {
      status: "multiple_candidates",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: top.score,
      candidates: tied,
      threshold: minScore
    };
  }

  return {
    status: "matched",
    observationId: observation.id,
    capturedAt: observation.capturedAt,
    node: top.node,
    score: top.score,
    candidates: [top, ...candidates.slice(1, maxCandidates)],
    threshold: minScore
  };
}

function supportsPlatform(scope: PlatformScope | undefined, platform: Platform): boolean {
  return !scope || scope === "mobile-both" || scope === platform;
}

function scoreNode(node: BusinessNode, observation: Observation, platform: Platform): NodeMatchCandidate {
  const matcherResults = node.matchers
    .filter((matcher) => supportsPlatform(matcher.platformScope, platform))
    .map((matcher) => evaluateMatcher(matcher, observation));
  const effectiveMatcherResults = effectiveNodeMatcherResults(matcherResults);
  const totalWeight = effectiveMatcherResults.reduce((sum, result) => sum + result.weight, 0);
  const matchedWeight = effectiveMatcherResults.reduce((sum, result) => sum + result.score, 0);
  return {
    node,
    score: totalWeight > 0 ? roundScore(matchedWeight / totalWeight) : 0,
    matchedWeight: roundScore(matchedWeight),
    totalWeight: roundScore(totalWeight),
    matcherResults,
    quality: evaluateNodeMatchQuality(effectiveMatcherResults)
  };
}

function evaluateNodeMatchQuality(matcherResults: MatcherResult[]): NodeMatchQuality {
  const matchedContextSignals = matcherResults.filter((result) => result.matched && isContextMatcherType(result.type)).length;
  const strongStateResults = matcherResults.filter((result) => isStrongStateMatcher(result));
  const matchedStrongSignals = strongStateResults.filter((result) => result.matched).length;
  const matchedWeakSignals = matcherResults.filter((result) => result.matched && isWeakStateMatcher(result)).length;
  const matchedCommonNavigationSignals = matcherResults.filter((result) => result.matched && isCommonNavigationMatcher(result)).length;
  const matchedPageSpecificSignals = matcherResults.filter((result) => result.matched && isPageSpecificMatcher(result)).length;
  const missingStrongMatcherIds = strongStateResults.filter((result) => !result.matched).map((result) => result.matcherId);
  const missingCriticalMatcherIds = matcherResults.filter((result) => result.critical && !result.matched).map((result) => result.matcherId);
  const reasons: string[] = [];

  if (missingCriticalMatcherIds.length > 0) {
    reasons.push("critical_matcher_missing");
  }
  if (strongStateResults.length > 0 && matchedStrongSignals === 0) {
    reasons.push("strong_state_anchor_missing");
  }
  if (strongStateResults.length === 0 && matchedWeakSignals < 2) {
    reasons.push(matchedWeakSignals === 0 ? "state_evidence_missing" : "single_weak_state_signal");
  }
  if (matchedContextSignals > 0 && matchedStrongSignals === 0 && matchedWeakSignals === 0) {
    reasons.push("context_only_match");
  }
  if (matchedCommonNavigationSignals > 0 && matchedPageSpecificSignals === 0) {
    reasons.push("page_specific_evidence_missing");
  }

  return {
    status: reasons.length === 0 ? "sufficient" : "low_confidence",
    reasons,
    matchedContextSignals,
    matchedStrongSignals,
    matchedWeakSignals,
    missingStrongMatcherIds,
    missingCriticalMatcherIds
  };
}

function effectiveNodeMatcherResults(matcherResults: MatcherResult[]): MatcherResult[] {
  const matchedImageRegions = matcherResults.filter((result) => isImageRegionMatcherType(result.type) && result.matched && result.region);
  const matchedSemanticImageRegions = matcherResults.filter((result) => result.type === "semantic_image_region" && result.matched && result.region);
  const matchedTextResults = matcherResults.filter((result) => isTextMatcherResult(result) && result.matched);
  const matchedStrongSignals = matcherResults.filter((result) => result.matched && isStrongStateMatcher(result)).length;
  const matchedWeakSignals = matcherResults.filter((result) => result.matched && isWeakStateMatcher(result)).length;
  return matcherResults.filter(
    (result) =>
      !isDerivedRegionTextCoveredByMatchedImageRegion(result, matchedImageRegions) &&
      !isMissingTextCoveredByEquivalentMatchedText(result, matchedTextResults) &&
      !isImageRegionCoveredByMatchedSemanticRegion(result, matchedSemanticImageRegions) &&
      !isChangedImageRegionCoveredByOtherPageAnchors(result, matchedImageRegions, matchedStrongSignals, matchedWeakSignals)
  );
}

function isDerivedRegionTextCoveredByMatchedImageRegion(result: MatcherResult, matchedImageRegions: MatcherResult[]): boolean {
  if (!(result.type === "text" || result.type === "ocr_text") || !result.region || result.matched) {
    return false;
  }
  if (result.source?.sourceType !== "manual_edit" || result.source.confidence !== 0.9) {
    return false;
  }
  return matchedImageRegions.some((imageRegion) => imageRegion.region && rectsNearlyEqual(result.region!, imageRegion.region));
}

function isMissingTextCoveredByEquivalentMatchedText(result: MatcherResult, matchedTextResults: MatcherResult[]): boolean {
  if (result.type !== "text" || result.matched) {
    return false;
  }
  const expected = normalizeMatcherText(result.expected);
  if (!expected) {
    return false;
  }
  return matchedTextResults.some((matched) => matched.type === "ocr_text" && normalizeMatcherText(matched.expected) === expected);
}

function isTextMatcherResult(result: MatcherResult): boolean {
  return result.type === "text" || result.type === "ocr_text";
}

function isChangedImageRegionCoveredByOtherPageAnchors(result: MatcherResult, matchedImageRegions: MatcherResult[], matchedStrongSignals: number, matchedWeakSignals: number): boolean {
  return isImageRegionMatcherType(result.type) && !result.matched && matchedImageRegions.length >= 1 && matchedStrongSignals >= 2 && matchedWeakSignals >= 2;
}

function isImageRegionCoveredByMatchedSemanticRegion(result: MatcherResult, matchedSemanticImageRegions: MatcherResult[]): boolean {
  return result.type === "image_region" && !result.matched && Boolean(result.region) && matchedSemanticImageRegions.some((semanticRegion) => semanticRegion.region && rectsNearlyEqual(result.region!, semanticRegion.region));
}

function isImageRegionMatcherType(type: StateMatcher["type"]): boolean {
  return type === "image_region" || type === "semantic_image_region";
}

function rectsNearlyEqual(left: Rect, right: Rect): boolean {
  const tolerance = 0.01;
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

function isContextMatcherType(type: StateMatcher["type"]): boolean {
  return type === "package" || type === "bundle_id";
}

function isStrongStateMatcherType(type: StateMatcher["type"]): boolean {
  return type === "activity" || type === "route" || type === "fragment" || type === "resource_id" || type === "accessibility_id" || type === "image_region" || type === "semantic_image_region" || type === "custom";
}

function isStrongStateMatcher(result: MatcherResult): boolean {
  if (isStrongStateMatcherType(result.type)) {
    return true;
  }
  return Boolean(result.region && (result.type === "text" || result.type === "ocr_text"));
}

function isWeakStateMatcherType(type: StateMatcher["type"]): boolean {
  return type === "text" || type === "ocr_text";
}

function isWeakStateMatcher(result: MatcherResult): boolean {
  return isWeakStateMatcherType(result.type) && !result.region;
}

function isPageSpecificMatcher(result: MatcherResult): boolean {
  if (!result.matched) {
    return false;
  }
  if (result.type === "image_region") {
    return !isCommonNavigationMatcher(result);
  }
  if (result.type === "semantic_image_region") {
    return !isCommonNavigationMatcher(result);
  }
  if (result.type === "text" || result.type === "ocr_text") {
    return Boolean(result.region && !isCommonNavigationMatcher(result));
  }
  if (result.type === "resource_id" || result.type === "accessibility_id" || result.type === "route" || result.type === "fragment" || result.type === "custom") {
    return true;
  }
  return false;
}

function isCommonNavigationMatcher(result: MatcherResult): boolean {
  if (!result.matched || !result.region) {
    return false;
  }
  return isCommonNavigationRegion(result.region) && isCommonNavigationSignature(result.expected);
}

function isCommonNavigationRegion(region: Rect): boolean {
  return region.y >= 82 && region.height <= 18;
}

function isCommonNavigationSignature(value: string): boolean {
  const decoded = safeDecodeURIComponent(value);
  const normalized = normalizeText(decoded);
  const tabTokenCount = ["主页", "消息", "待办", "课程表", "空间", "成长"].filter((token) => normalized.includes(normalizeText(token))).length;
  if (tabTokenCount <= 1 && /selected|active|current|选中/i.test(decoded)) {
    return false;
  }
  return /tab|navigation|fixed_bottom_navigation/i.test(decoded) || tabTokenCount >= 3;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function evaluateMatcher(matcher: StateMatcher, observation: Observation): MatcherResult {
  const weight = positiveWeight(matcher.weight);
  const base = {
    matcherId: matcher.id,
    type: matcher.type,
    expected: matcher.value,
    weight,
    critical: Boolean(matcher.critical),
    region: matcher.region,
    source: matcher.source
  };

  switch (matcher.type) {
    case "package": {
      const actual = observation.packageName ?? componentPackage(observation.componentName);
      return result(base, equalsNormalized(actual, matcher.value), actual);
    }
    case "bundle_id": {
      return result(base, equalsNormalized(observation.bundleId ?? observation.packageName, matcher.value), observation.bundleId ?? observation.packageName);
    }
    case "activity": {
      const actual = observation.activityName ?? componentActivity(observation.componentName);
      return result(base, activityMatches(actual, observation.componentName, matcher.value), actual ?? observation.componentName);
    }
    case "route": {
      return result(base, equalsNormalized(observation.routeName, matcher.value), observation.routeName);
    }
    case "fragment": {
      const actual = observation.fragments?.find((fragment) => textMatches(fragment, matcher.value));
      return result(base, Boolean(actual), actual);
    }
    case "resource_id": {
      const actual = observation.uiElements.find((element) => equalsNormalized(element.resourceId, matcher.value))?.resourceId;
      return result(base, Boolean(actual), actual);
    }
    case "accessibility_id": {
      const actual = observation.uiElements.find((element) => equalsNormalized(element.accessibilityId ?? element.contentDesc, matcher.value))?.accessibilityId;
      const fallback = actual ?? observation.uiElements.find((element) => equalsNormalized(element.contentDesc, matcher.value))?.contentDesc;
      return result(base, Boolean(fallback), fallback);
    }
    case "text": {
      const actual = observation.uiElements.find((element) => textRectMatchesMatcherRegion(element.bounds, matcher, observation.resolution) && (textMatches(element.text, matcher.value) || textMatches(element.contentDesc, matcher.value)));
      return result(base, Boolean(actual), actual?.text ?? actual?.contentDesc);
    }
    case "ocr_text": {
      const actual = observation.ocrTexts.find((text) => textRectMatchesMatcherRegion(text.region, matcher, observation.resolution, text.semanticArea) && textMatches(text.text, matcher.value));
      return result(base, Boolean(actual), actual?.text);
    }
    case "image_region": {
      const threshold = matcher.threshold ?? 0.9;
      const actual = observation.imageRegions?.find((region) => equalsNormalized(region.value, matcher.value) && (region.similarity ?? 1) >= threshold);
      return result(base, Boolean(actual), actual ? `${actual.value}:${actual.similarity ?? 1}` : undefined);
    }
    case "semantic_image_region": {
      const threshold = matcher.threshold ?? 0.68;
      const actual = observation.imageRegions?.find((region) => equalsNormalized(region.value, matcher.value) && (region.similarity ?? 1) >= threshold);
      return result(base, Boolean(actual), actual ? `${actual.value}:${actual.similarity ?? 1}` : undefined);
    }
    case "custom":
      return result(base, customSignalMatches(observation.raw, matcher.value), matcher.value);
    default:
      return {
        ...base,
        matched: false,
        score: 0,
        reason: "unsupported_matcher"
      };
  }
}

function result(
  base: Omit<MatcherResult, "matched" | "score">,
  matched: boolean,
  actual: string | undefined,
  reason?: string
): MatcherResult {
  return {
    ...base,
    actual,
    matched,
    score: matched ? base.weight : 0,
    reason: matched ? undefined : reason ?? "not_found"
  };
}

function positiveWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function equalsNormalized(actual: string | undefined, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

function textMatches(actual: string | undefined, expected: string): boolean {
  const normalizedActual = normalizeMatcherText(actual);
  const normalizedExpected = normalizeMatcherText(expected);
  return Boolean(normalizedActual && normalizedExpected && normalizedActual.includes(normalizedExpected));
}

function textRectMatchesMatcherRegion(
  actualRect: Rect | undefined,
  matcher: StateMatcher,
  resolution: Observation["resolution"],
  actualSemanticArea?: VisualSemanticArea
): boolean {
  if (!matcher.region) {
    return true;
  }
  if (rectOverlapsMatcherRegion(actualRect, matcher.region, resolution)) {
    return true;
  }
  if (!actualRect) {
    return false;
  }
  const matcherArea = matcher.semanticArea ?? semanticAreaForRect(matcher.region, resolution);
  const actualArea = actualSemanticArea ?? semanticAreaForRect(actualRect, resolution);
  if (matcherArea === "unknown" || actualArea === "unknown" || matcherArea !== actualArea) {
    return false;
  }
  const matcherCenter = rectCenterPercent(matcher.region, resolution);
  const actualCenter = rectCenterPercent(actualRect, resolution);
  if (!matcherCenter || !actualCenter) {
    return false;
  }
  if (matcherArea === "top" || matcherArea === "bottom") {
    return Math.abs(matcherCenter.y - actualCenter.y) <= 8 && Math.abs(matcherCenter.x - actualCenter.x) <= 18;
  }
  if (matcherArea === "content") {
    return Math.abs(matcherCenter.y - actualCenter.y) <= 10 && Math.abs(matcherCenter.x - actualCenter.x) <= 24;
  }
  return Math.abs(matcherCenter.y - actualCenter.y) <= 8 && Math.abs(matcherCenter.x - actualCenter.x) <= 20;
}

function rectOverlapsMatcherRegion(actualRect: Rect | undefined, matcherRegion: Rect, resolution: Observation["resolution"]): boolean {
  if (!actualRect) {
    return false;
  }
  const expected = percentRectToPixels(matcherRegion, resolution);
  const actual = normalizeObservationRect(actualRect, resolution);
  if (!expected || !actual) {
    return false;
  }
  const overlapWidth = Math.max(0, Math.min(actual.x + actual.width, expected.x + expected.width) - Math.max(actual.x, expected.x));
  const overlapHeight = Math.max(0, Math.min(actual.y + actual.height, expected.y + expected.height) - Math.max(actual.y, expected.y));
  const overlapArea = overlapWidth * overlapHeight;
  const actualArea = actual.width * actual.height;
  if (actualArea <= 0) {
    return false;
  }
  return overlapArea / actualArea >= 0.35 || overlapArea > 0;
}

function rectCenterPercent(rect: Rect, resolution: Observation["resolution"]): { x: number; y: number } | undefined {
  const normalized = rectToPercent(rect, resolution);
  if (!normalized) {
    return undefined;
  }
  return {
    x: normalized.x + normalized.width / 2,
    y: normalized.y + normalized.height / 2
  };
}

function rectToPercent(rect: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    if (rect.x <= 100 && rect.y <= 100 && rect.width <= 100 && rect.height <= 100) {
      return rect;
    }
    return undefined;
  }
  if (rect.x <= 100 && rect.y <= 100 && rect.width <= 100 && rect.height <= 100) {
    return rect;
  }
  return {
    x: (rect.x / resolution.width) * 100,
    y: (rect.y / resolution.height) * 100,
    width: (rect.width / resolution.width) * 100,
    height: (rect.height / resolution.height) * 100
  };
}

function semanticAreaForRect(rect: Rect, resolution: Observation["resolution"]): VisualSemanticArea {
  const normalized = rectToPercent(rect, resolution);
  if (!normalized) {
    return "unknown";
  }
  const centerY = normalized.y + normalized.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function percentRectToPixels(region: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    return region.x <= 100 && region.y <= 100 && region.width <= 100 && region.height <= 100
      ? { x: region.x, y: region.y, width: region.width, height: region.height }
      : undefined;
  }
  return {
    x: (region.x / 100) * resolution.width,
    y: (region.y / 100) * resolution.height,
    width: (region.width / 100) * resolution.width,
    height: (region.height / 100) * resolution.height
  };
}

function normalizeObservationRect(rect: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height || rect.x > 100 || rect.y > 100 || rect.width > 100 || rect.height > 100) {
    return rect;
  }
  return percentRectToPixels(rect, resolution);
}

function activityMatches(activityName: string | undefined, componentName: string | undefined, expected: string): boolean {
  const normalizedExpected = normalize(expected);
  const normalizedActivity = normalize(activityName);
  const normalizedComponent = normalize(componentName);
  if (!normalizedExpected) {
    return false;
  }
  return (
    normalizedActivity === normalizedExpected ||
    normalizedActivity.endsWith(normalizedExpected.replace(/^\./, "")) ||
    normalizedComponent === normalizedExpected ||
    normalizedComponent.endsWith(`/${normalizedExpected}`) ||
    normalizedComponent.endsWith(normalizedExpected.replace(/^\./, ""))
  );
}

function componentPackage(componentName: string | undefined): string | undefined {
  return componentName?.split("/")[0];
}

function componentActivity(componentName: string | undefined): string | undefined {
  if (!componentName?.includes("/")) {
    return undefined;
  }
  const [packageName, activity] = componentName.split("/");
  if (!activity) {
    return undefined;
  }
  return activity.startsWith(".") ? `${packageName}${activity}` : activity;
}

function customSignalMatches(raw: Record<string, unknown> | undefined, expected: string): boolean {
  if (!raw) {
    return false;
  }
  const [key, value] = expected.split("=");
  if (!key || value === undefined) {
    return Object.values(raw).some((item) => normalize(String(item)) === normalize(expected));
  }
  return normalize(String(raw[key])) === normalize(value);
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeText(value: string | undefined): string {
  return normalize(value).replace(/\s+/g, "");
}

function normalizeMatcherText(value: string | undefined): string {
  return normalizeText(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
