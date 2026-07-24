import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectNode,
  type BusinessGraphVersion,
  type BusinessNode,
  type MatcherResult,
  type NodeMatchResult,
  type Observation,
  type ObservationImageRegion,
  type Rect,
  type StateMatcher
} from "@mobile-automation/graph-core";

export type PageMatcherBaselineReader = (artifactId: string) => Promise<Buffer | undefined>;

type VisualMatchCache = {
  baselineByArtifactId: Map<string, Promise<Buffer | undefined>>;
  sampleByBuffer: WeakMap<Buffer, Promise<ImageSample | undefined>>;
};

export type VisualLocatorTemplate = {
  version: 1;
  source: "recorded_crop";
  width: number;
  height: number;
  pixels: number[];
  hash: string;
  region: Rect;
};

export type VisualTemplateSearchResult = {
  selected?: {
    region: Rect;
    pointPercent: { x: number; y: number };
    similarity: number;
  };
  diagnostic: {
    reason: "template_selected" | "template_below_threshold" | "missing_template" | "missing_screenshot" | "missing_region";
    minSimilarity: number;
    candidateCount: number;
    bestSimilarity?: number;
    templateHash?: string;
  };
};

export type PageMatcherEvidenceDiagnostic = {
  matcherId: string;
  type: StateMatcher["type"];
  expected: string;
  actual?: string;
  weight: number;
  critical?: boolean;
  matched: boolean;
  score: number;
  reason?: string;
};

export type PageMatcherPollutionDiagnostic = {
  code: "SCREENSHOT_POLLUTION";
  message: string;
  pollutionTexts: Array<{
    text: string;
    region?: Rect;
  }>;
  affectedMatchers: Array<{
    nodeId: string;
    nodeName: string;
    matcherId: string;
    type: StateMatcher["type"];
    expected: string;
    region?: Rect;
  }>;
};

export type PageMatcherDiagnostics = {
  status: NodeMatchResult["status"];
  score: number;
  threshold: number;
  matchedNode?: {
    id: string;
    key: string;
    name: string;
  };
  topCandidate?: {
    nodeId: string;
    key: string;
    name: string;
    score: number;
    quality: NodeMatchResult["candidates"][number]["quality"];
  };
  matchedEvidence: PageMatcherEvidenceDiagnostic[];
  missingEvidence: PageMatcherEvidenceDiagnostic[];
  pollution?: PageMatcherPollutionDiagnostic;
  candidates: Array<{
    nodeId: string;
    key: string;
    name: string;
    score: number;
    quality: NodeMatchResult["candidates"][number]["quality"];
    matchedEvidence: PageMatcherEvidenceDiagnostic[];
    missingEvidence: PageMatcherEvidenceDiagnostic[];
  }>;
};

export type PageMatcherResult = {
  match: NodeMatchResult;
  observation: Observation;
  diagnostics: PageMatcherDiagnostics;
};

export async function matchCurrentPage(input: {
  graphVersion: BusinessGraphVersion;
  observation: Observation;
  baselineReader?: PageMatcherBaselineReader;
  candidateNodeIds?: string[];
  prefilterByForegroundTitle?: boolean;
}): Promise<PageMatcherResult> {
  const pageAssetGraphVersion = pageAssetOnlyGraphVersion(input.graphVersion);
  const candidateNodeIds = input.candidateNodeIds ?? (input.prefilterByForegroundTitle ? foregroundTitleCandidateNodeIds(pageAssetGraphVersion, input.observation) : undefined);
  if (input.candidateNodeIds && input.candidateNodeIds.length === 0) {
    const match = forceUnknownMatch(detectNode(input.observation, pageAssetGraphVersion, input.observation.platform));
    return {
      match,
      observation: input.observation,
      diagnostics: buildPageMatcherDiagnostics(match, input.observation)
    };
  }
  if (candidateNodeIds && candidateNodeIds.length > 0) {
    const narrowedResult = await runPageMatcher({
      graphVersion: candidateOnlyGraphVersion(pageAssetGraphVersion, candidateNodeIds),
      observation: input.observation,
      baselineReader: input.baselineReader
    });
    if (narrowedResult.match.status === "matched" || input.candidateNodeIds) {
      return narrowedResult;
    }
  }
  return runPageMatcher({
    graphVersion: pageAssetGraphVersion,
    observation: input.observation,
    baselineReader: input.baselineReader
  });
}

async function runPageMatcher(input: {
  graphVersion: BusinessGraphVersion;
  observation: Observation;
  baselineReader?: PageMatcherBaselineReader;
}): Promise<PageMatcherResult> {
  const observation = await enrichObservationImageRegions(input.observation, input.graphVersion, input.baselineReader, createVisualMatchCache());
  const rawMatch = detectNode(observation, input.graphVersion, observation.platform);
  const match = promoteParentPageLocalStateMatch(rawMatch, observation);
  return {
    match,
    observation,
    diagnostics: buildPageMatcherDiagnostics(match, observation)
  };
}

function candidateOnlyGraphVersion(graphVersion: BusinessGraphVersion, candidateNodeIds: string[] | undefined): BusinessGraphVersion {
  if (candidateNodeIds === undefined) {
    return graphVersion;
  }
  const ids = new Set((candidateNodeIds ?? []).map((id) => id.trim()).filter(Boolean));
  return {
    ...graphVersion,
    nodes: graphVersion.nodes.filter((node) => ids.has(node.id))
  };
}

function forceUnknownMatch(match: NodeMatchResult): NodeMatchResult {
  return {
    ...match,
    status: "unknown",
    node: undefined
  };
}

function foregroundTitleCandidateNodeIds(graphVersion: BusinessGraphVersion, observation: Observation): string[] | undefined {
  const foregroundTitle = foregroundPageTitleText(observation);
  if (!foregroundTitle) {
    return undefined;
  }
  return graphVersion.nodes
    .filter((node) => node.nodeType === "page" && node.status === "active")
    .filter((node) => nodeMatchesForegroundTitle(node, foregroundTitle))
    .map((node) => node.id);
}

function nodeMatchesForegroundTitle(node: BusinessNode, foregroundTitle: string): boolean {
  const normalizedTitle = normalizeSignatureText(foregroundTitle);
  if (!normalizedTitle) {
    return false;
  }
  if (titleMatchesText(normalizedTitle, node.name)) {
    return true;
  }
  return node.matchers.some((matcher) =>
    isForegroundTitleCandidateMatcher(matcher) &&
    matcherTextMatchesForegroundTitle(normalizedTitle, safeDecodeURIComponent(matcher.value))
  );
}

function isForegroundTitleCandidateMatcher(matcher: StateMatcher): boolean {
  if (!(matcher.type === "text" || matcher.type === "ocr_text" || matcher.type === "image_region" || matcher.type === "semantic_image_region")) {
    return false;
  }
  if (!matcher.region || isCommonNavigationRegion(matcher.region)) {
    return false;
  }
  return matcher.region.y <= 25 && matcher.region.height <= 25;
}

function titleMatchesText(normalizedTitle: string, value: string): boolean {
  const normalizedValue = normalizeSignatureText(value);
  if (!normalizedValue) {
    return false;
  }
  return normalizedValue === normalizedTitle ||
    normalizedValue.includes(normalizedTitle) ||
    (normalizedTitle.includes(normalizedValue) && normalizedValue.length >= 2);
}

function matcherTextMatchesForegroundTitle(normalizedTitle: string, value: string): boolean {
  const normalizedValue = normalizeSignatureText(value);
  if (!normalizedValue) {
    return false;
  }
  return normalizedValue === normalizedTitle ||
    normalizedValue.includes(normalizedTitle) ||
    (normalizedTitle.includes(normalizedValue) && normalizedValue.length >= 4);
}

function foregroundPageTitleText(observation: Observation): string | undefined {
  return prominentObservationTextCandidates(observation)
    .filter((candidate) => isLikelyForegroundPageTitle(candidate.text))
    .sort((left, right) => left.centerY - right.centerY || left.order - right.order)[0]?.text;
}

function prominentObservationTextCandidates(observation: Observation): Array<{ text: string; centerY: number; order: number }> {
  const height = observation.resolution?.height;
  const candidates: Array<{ text: string; centerY: number; order: number }> = [];
  let order = 0;
  const push = (text: string | undefined, bounds: { y: number; height: number } | undefined): void => {
    const normalized = text?.trim();
    order += 1;
    if (!normalized || !isProminent(bounds, height)) {
      return;
    }
    candidates.push({
      text: normalized,
      centerY: bounds ? bounds.y + bounds.height / 2 : 0,
      order
    });
  };
  for (const element of observation.uiElements) {
    if (element.visible === false) {
      continue;
    }
    push(element.text, element.bounds);
  }
  for (const text of observation.ocrTexts) {
    push(text.text, text.region);
  }
  return candidates;
}

function isProminent(bounds: { y: number; height: number } | undefined, screenHeight?: number): boolean {
  return !screenHeight || !bounds || bounds.y + bounds.height / 2 <= screenHeight * 0.45;
}

function isLikelyForegroundPageTitle(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 16 || !/[\u4e00-\u9fa5]/.test(normalized)) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (/\d/.test(normalized) && /小时|分钟|今天|明天|昨天|开始|出勤|上课/.test(normalized)) {
    return false;
  }
  return true;
}

export async function enrichObservationImageRegions(
  observation: Observation,
  graphVersion: BusinessGraphVersion,
  baselineReader?: PageMatcherBaselineReader,
  visualCache: VisualMatchCache = createVisualMatchCache()
): Promise<Observation> {
  const matchers = graphVersion.nodes.flatMap((node) => node.matchers.filter((matcher) => isImageRegionMatcherType(matcher.type) && matcher.region));
  if (!matchers.length) {
    return observation;
  }
  const existing = observation.imageRegions ?? [];
  const knownValues = new Set(existing.map((region) => region.value));
  const uniqueMatchers: StateMatcher[] = [];
  for (const matcher of matchers) {
    if (!matcher.region || knownValues.has(matcher.value)) {
      continue;
    }
    knownValues.add(matcher.value);
    uniqueMatchers.push(matcher);
  }
  const generated = await mapWithConcurrency(uniqueMatchers, 4, async (matcher) => {
    const similarity = await imageRegionSimilarity(observation, matcher, baselineReader, visualCache);
    return {
      value: matcher.value,
      region: matcher.region,
      similarity
    };
  });
  if (!generated.length) {
    return observation;
  }
  return {
    ...observation,
    imageRegions: [...existing, ...generated]
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }));
  return results;
}

export async function createVisualLocatorTemplate(input: {
  screenshot: Buffer;
  percentRegion: Rect;
  resolution?: Observation["resolution"];
  sampleSize?: number;
}): Promise<VisualLocatorTemplate | undefined> {
  const screenshotSample = await imageSampleNativeBestEffort(input.screenshot);
  if (!screenshotSample) {
    return undefined;
  }
  const pixelRegion = percentRectToPixels(input.percentRegion, input.resolution ?? { width: screenshotSample.width, height: screenshotSample.height });
  if (!pixelRegion) {
    return undefined;
  }
  const crop = cropSample(screenshotSample, pixelRegion);
  if (!crop) {
    return undefined;
  }
  const sampleSize = Math.max(4, Math.min(32, Math.floor(input.sampleSize ?? 16)));
  const sample = resizeSample(crop, sampleSize, sampleSize);
  return {
    version: 1,
    source: "recorded_crop",
    width: sample.width,
    height: sample.height,
    pixels: sample.pixels,
    hash: sampleHash(sample.pixels),
    region: input.percentRegion
  };
}

export async function locateVisualTemplateInScreenshot(input: {
  screenshot: Buffer;
  template: unknown;
  percentRegion: Rect;
  resolution?: Observation["resolution"];
  minSimilarity?: number;
}): Promise<VisualTemplateSearchResult> {
  const minSimilarity = Math.max(0, Math.min(1, input.minSimilarity ?? 0.82));
  const template = readVisualLocatorTemplate(input.template);
  if (!template) {
    return {
      diagnostic: {
        reason: "missing_template",
        minSimilarity,
        candidateCount: 0
      }
    };
  }
  const screenshotSample = await imageSampleNativeBestEffort(input.screenshot);
  if (!screenshotSample) {
    return {
      diagnostic: {
        reason: "missing_screenshot",
        minSimilarity,
        candidateCount: 0,
        templateHash: template.hash
      }
    };
  }
  const pixelRegion = percentRectToPixels(input.percentRegion, input.resolution ?? { width: screenshotSample.width, height: screenshotSample.height });
  if (!pixelRegion) {
    return {
      diagnostic: {
        reason: "missing_region",
        minSimilarity,
        candidateCount: 0,
        templateHash: template.hash
      }
    };
  }
  const candidates = candidateSearchRects(pixelRegion, screenshotSample);
  let best: { region: Rect; similarity: number } | undefined;
  const templateSample: ImageSample = {
    width: template.width,
    height: template.height,
    pixels: template.pixels
  };
  for (const candidate of candidates) {
    const crop = cropSample(screenshotSample, candidate);
    if (!crop) {
      continue;
    }
    const sample = resizeSample(crop, template.width, template.height);
    const similarity = combinedVisualSimilarity(sample.pixels, templateSample.pixels);
    if (!best || similarity > best.similarity) {
      best = { region: candidate, similarity };
    }
  }
  const bestSimilarity = best ? roundSimilarity(best.similarity) : undefined;
  const diagnostic = {
    reason: bestSimilarity !== undefined && bestSimilarity >= minSimilarity ? "template_selected" as const : "template_below_threshold" as const,
    minSimilarity,
    candidateCount: candidates.length,
    bestSimilarity,
    templateHash: template.hash
  };
  if (!best || bestSimilarity === undefined || bestSimilarity < minSimilarity) {
    return { diagnostic };
  }
  const region = pixelRectToPercent(best.region, { width: screenshotSample.width, height: screenshotSample.height });
  return {
    selected: {
      region,
      pointPercent: {
        x: roundPercentValue(region.x + region.width / 2),
        y: roundPercentValue(region.y + region.height / 2)
      },
      similarity: bestSimilarity
    },
    diagnostic
  };
}

export function pageAssetOnlyGraphVersion(graphVersion: BusinessGraphVersion): BusinessGraphVersion {
  const nodes = graphVersion.nodes.filter(isConfirmedPageAssetNode).map(withRuntimeScreenshotRegionMatchers);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    ...graphVersion,
    nodes,
    edges: graphVersion.edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
  };
}

export function buildPageMatcherDiagnostics(match: NodeMatchResult, observation?: Observation): PageMatcherDiagnostics {
  const topCandidate = match.candidates[0];
  const evidenceSource = match.status === "matched" ? match.candidates.find((candidate) => candidate.node.id === match.node?.id) ?? topCandidate : topCandidate;
  const matchedEvidence = summarizeEvidence(evidenceSource?.matcherResults ?? [], true);
  const missingEvidence = summarizeEvidence(evidenceSource?.matcherResults ?? [], false);
  const pollution = observation && match.status !== "matched" ? detectScreenshotPollution(match, observation) : undefined;
  return {
    status: match.status,
    score: match.score,
    threshold: match.threshold,
    matchedNode: match.node ? summarizeNode(match.node) : undefined,
    topCandidate: topCandidate ? summarizeCandidate(topCandidate) : undefined,
    matchedEvidence,
    missingEvidence,
    pollution,
    candidates: match.candidates.map((candidate) => ({
      ...summarizeCandidate(candidate),
      matchedEvidence: summarizeEvidence(candidate.matcherResults, true),
      missingEvidence: summarizeEvidence(candidate.matcherResults, false)
    }))
  };
}

export function promoteParentPageLocalStateMatch(match: NodeMatchResult, observation: Observation): NodeMatchResult {
  if (match.status === "matched") {
    return match;
  }
  const candidate = match.candidates.find((item) => isHighQualityPageAssetCandidate(item, match.threshold) || isParentPageLocalStateCandidate(item, observation));
  if (!candidate) {
    return match;
  }
  return {
    status: "matched",
    observationId: match.observationId,
    capturedAt: match.capturedAt,
    node: candidate.node,
    score: candidate.score,
    candidates: [candidate, ...match.candidates.filter((item) => item.node.id !== candidate.node.id)],
    threshold: match.threshold
  };
}

function detectScreenshotPollution(match: NodeMatchResult, observation: Observation): PageMatcherPollutionDiagnostic | undefined {
  const pollutionTexts = (observation.ocrTexts ?? [])
    .filter((text) => isDebugOverlayText(text.text))
    .map((text) => ({
      text: text.text,
      region: text.region
    }));
  if (!pollutionTexts.length) {
    return undefined;
  }
  const affectedMatchers = [];
  for (const candidate of match.candidates) {
    for (const result of candidate.matcherResults) {
      if (!isPollutionSensitiveMissingCritical(result)) {
        continue;
      }
      const isCovered = pollutionTexts.some((pollution) => pollution.region && result.region && percentRectOverlaps(pollution.region, result.region, observation.resolution));
      if (!isCovered) {
        continue;
      }
      affectedMatchers.push({
        nodeId: candidate.node.id,
        nodeName: candidate.node.name,
        matcherId: result.matcherId,
        type: result.type,
        expected: result.expected,
        region: result.region
      });
    }
  }
  if (!affectedMatchers.length) {
    return undefined;
  }
  return {
    code: "SCREENSHOT_POLLUTION",
    message: "当前截图疑似被调试浮层遮挡，无法确认页面资产。请关闭 MEM/FPS/Toolbox 等浮层后重试。",
    pollutionTexts,
    affectedMatchers
  };
}

function isPollutionSensitiveMissingCritical(result: MatcherResult): boolean {
  return (
    Boolean(result.critical) &&
    !result.matched &&
    Boolean(result.region) &&
    (result.type === "ocr_text" || result.type === "image_region" || result.type === "semantic_image_region")
  );
}

function isDebugOverlayText(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return [
    /\bMEM\s*:/i,
    /\bFPS\s*:/i,
    /\bCPU\s*:/i,
    /Toolbox/i,
    /SFRIDA/i,
    /LET'?S\s*ROCK/i
  ].some((pattern) => pattern.test(text));
}

function isHighQualityPageAssetCandidate(candidate: NodeMatchResult["candidates"][number], threshold: number): boolean {
  if (!isPageAssetNode(candidate.node) || candidate.score < threshold - 0.05) {
    return false;
  }
  if (candidate.quality.status !== "sufficient" || candidate.quality.missingCriticalMatcherIds.length > 0) {
    return false;
  }
  const effectiveResults = effectiveDiagnosticMatcherResults(candidate.matcherResults);
  return effectiveResults.some((result) => result.matched && isPageIdentityMatcher(result));
}

function isParentPageLocalStateCandidate(candidate: NodeMatchResult["candidates"][number], observation: Observation): boolean {
  if (candidate.score < 0.45 || !isPageAssetNode(candidate.node)) {
    return false;
  }
  const effectiveResults = effectiveDiagnosticMatcherResults(candidate.matcherResults);
  const matchedIdentitySignals = effectiveResults.filter((result) => result.matched && isPageIdentityMatcher(result));
  const missingCriticalSignals = effectiveResults.filter((result) => result.critical && !result.matched);
  if (!matchedIdentitySignals.length || !missingCriticalSignals.length) {
    return false;
  }
  if (!localStateTextCount(observation)) {
    return false;
  }
  return true;
}

function isPageAssetNode(node: BusinessNode): boolean {
  return node.nodeType === "page" && node.status === "active" && (Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset") || node.tags.includes("asset-recording"));
}

function isPageIdentityMatcher(result: MatcherResult): boolean {
  if (result.type === "image_region" || result.type === "semantic_image_region") {
    return !isCommonNavigationMatcher(result);
  }
  if (result.type === "text" || result.type === "ocr_text") {
    return Boolean(result.region && !isCommonNavigationMatcher(result));
  }
  return result.type === "resource_id" || result.type === "accessibility_id" || result.type === "route" || result.type === "fragment" || result.type === "custom";
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
  const normalized = normalizeSignatureText(decoded);
  const tabTokenCount = ["主页", "消息", "待办", "课程表", "空间", "成长"].filter((token) => normalized.includes(normalizeSignatureText(token))).length;
  return /tab|navigation|fixed_bottom_navigation/i.test(decoded) || tabTokenCount >= 3;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSignatureText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function localStateTextCount(observation: Observation): number {
  const texts = uniqueStrings([
    ...observation.uiElements.map((element) => element.text),
    ...observation.uiElements.map((element) => element.contentDesc),
    ...observation.ocrTexts.map((text) => text.text)
  ]);
  return texts.filter(isLikelyLocalMenuActionText).length;
}

function isLikelyLocalMenuActionText(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 8 || /^\d+$/.test(normalized)) {
    return false;
  }
  if (/添加|加入|扫一扫|搜索|设置|更多|创建|新建|删除|编辑|分享|取消|确定|关闭|完成|选择|上传|下载|复制|粘贴/.test(normalized)) {
    return true;
  }
  return false;
}

function summarizeNode(node: BusinessNode): { id: string; key: string; name: string } {
  return {
    id: node.id,
    key: node.key,
    name: node.name
  };
}

function summarizeCandidate(candidate: NodeMatchResult["candidates"][number]): {
  nodeId: string;
  key: string;
  name: string;
  score: number;
  quality: NodeMatchResult["candidates"][number]["quality"];
} {
  return {
    nodeId: candidate.node.id,
    key: candidate.node.key,
    name: candidate.node.name,
    score: candidate.score,
    quality: candidate.quality
  };
}

function summarizeEvidence(results: MatcherResult[], matched: boolean): PageMatcherEvidenceDiagnostic[] {
  return effectiveDiagnosticMatcherResults(results)
    .filter((result) => result.matched === matched)
    .map((result) => ({
      matcherId: result.matcherId,
      type: result.type,
      expected: result.expected,
      actual: result.actual,
      weight: result.weight,
      critical: result.critical,
      matched: result.matched,
      score: result.score,
      reason: result.reason
    }));
}

function effectiveDiagnosticMatcherResults(results: MatcherResult[]): MatcherResult[] {
  const matchedImageRegions = results.filter((result) => isImageRegionMatcherType(result.type) && result.matched && result.region);
  const matchedStrongSignals = results.filter((result) => result.matched && isStrongStateMatcher(result)).length;
  const matchedWeakSignals = results.filter((result) => result.matched && isWeakStateMatcher(result)).length;
  return results.filter(
    (result) =>
      !isDerivedRegionTextCoveredByMatchedImageRegion(result, matchedImageRegions) &&
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

function isChangedImageRegionCoveredByOtherPageAnchors(result: MatcherResult, matchedImageRegions: MatcherResult[], matchedStrongSignals: number, matchedWeakSignals: number): boolean {
  return isImageRegionMatcherType(result.type) && !result.matched && matchedImageRegions.length >= 1 && matchedStrongSignals >= 2 && matchedWeakSignals >= 2;
}

function isStrongStateMatcher(result: MatcherResult): boolean {
  if (result.type === "activity" || result.type === "route" || result.type === "fragment" || result.type === "resource_id" || result.type === "accessibility_id" || result.type === "image_region" || result.type === "semantic_image_region" || result.type === "custom") {
    return true;
  }
  return Boolean(result.region && (result.type === "text" || result.type === "ocr_text"));
}

function isWeakStateMatcher(result: MatcherResult): boolean {
  return (result.type === "text" || result.type === "ocr_text") && !result.region;
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

function withRuntimeScreenshotRegionMatchers(node: BusinessNode): BusinessNode {
  const regions = readScreenshotRegionMatchers(node.metadata?.screenshotRegions).filter(hasVisualBaseline);
  const existingValues = new Set(node.matchers.filter((matcher) => isImageRegionMatcherType(matcher.type)).map((matcher) => `${matcher.type}:${matcher.value}`));
  const missingMatchers = regions
    .flatMap((region) => [imageRegionMatcher(region), semanticImageRegionMatcher(region)])
    .filter((matcher) => !existingValues.has(`${matcher.type}:${matcher.value}`));
  if (!missingMatchers.length) {
    return node;
  }
  return {
    ...node,
    matchers: [...node.matchers, ...missingMatchers]
  };
}

function isConfirmedPageAssetNode(node: BusinessNode): boolean {
  if (node.status !== "active") {
    return false;
  }
  return node.nodeType === "page" && (Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset"));
}

function imageRegionMatcher(region: ScreenshotRegionMatcher): StateMatcher {
  const matcher: StateMatcher = {
    id: `image_region-${region.signature}`,
    type: "image_region",
    value: region.signature,
    weight: 3,
    critical: true,
    platformScope: "mobile-both",
    threshold: 0.9,
    region: region.rect,
    ignoreRegions: region.ignoreRegions,
    source: {
      sourceType: "manual_edit",
      confidence: 0.95
    }
  };
  if (region.baselineArtifactId) {
    matcher.source = {
      sourceType: matcher.source?.sourceType ?? "manual_edit",
      confidence: matcher.source?.confidence,
      artifactId: region.baselineArtifactId
    };
  }
  return matcher;
}

function semanticImageRegionMatcher(region: ScreenshotRegionMatcher): StateMatcher {
  return {
    id: `semantic_image_region-${semanticImageRegionSignature(region)}`,
    type: "semantic_image_region",
    value: semanticImageRegionSignature(region),
    weight: 2.2,
    critical: false,
    platformScope: "mobile-both",
    threshold: 0.68,
    region: region.rect,
    ignoreRegions: region.ignoreRegions,
    source: {
      sourceType: "manual_edit",
      confidence: 0.8,
      artifactId: region.baselineArtifactId
    }
  };
}

async function imageRegionSimilarity(
  observation: Observation,
  matcher: StateMatcher,
  baselineReader: PageMatcherBaselineReader | undefined,
  visualCache: VisualMatchCache
): Promise<number> {
  if (matcher.type === "semantic_image_region") {
    return semanticImageRegionSimilarity(observation, matcher, baselineReader, visualCache);
  }
  const baselineArtifactId = matcher.source?.artifactId;
  const screenshot = readObservationScreenshotBytes(observation);
  if (baselineReader && baselineArtifactId && matcher.region && screenshot) {
    const baseline = await readBaselineArtifact(baselineReader, baselineArtifactId, visualCache);
    if (baseline) {
      return imageRegionVisualSimilarity(screenshot, baseline, matcher.region, observation.resolution, matcher.ignoreRegions, visualCache);
    }
  }
  const expectedSignature = parseImageRegionSignature(matcher.value);
  const actualSignature = matcher.region ? regionTextSignature(observation, matcher.region) : "";
  return expectedSignature.evidence ? textSignatureSimilarity(expectedSignature.evidence, actualSignature) : 0;
}

async function semanticImageRegionSimilarity(
  observation: Observation,
  matcher: StateMatcher,
  baselineReader: PageMatcherBaselineReader | undefined,
  visualCache: VisualMatchCache
): Promise<number> {
  const expectedSignature = parseImageRegionSignature(matcher.value);
  const actualSignature = matcher.region ? regionTextSignature(observation, matcher.region) : "";
  const textScore = expectedSignature.evidence ? textSignatureSimilarity(expectedSignature.evidence, actualSignature) : 0;
  const visualScore = await visualRegionSimilarity(observation, matcher, baselineReader, visualCache);
  return roundSimilarity(Math.max(textScore, visualScore * 0.75));
}

async function visualRegionSimilarity(
  observation: Observation,
  matcher: StateMatcher,
  baselineReader: PageMatcherBaselineReader | undefined,
  visualCache: VisualMatchCache
): Promise<number> {
  const baselineArtifactId = matcher.source?.artifactId;
  const screenshot = readObservationScreenshotBytes(observation);
  if (!baselineReader || !baselineArtifactId || !matcher.region || !screenshot) {
    return 0;
  }
  const baseline = await readBaselineArtifact(baselineReader, baselineArtifactId, visualCache);
  if (!baseline) {
    return 0;
  }
  return imageRegionVisualSimilarity(screenshot, baseline, matcher.region, observation.resolution, matcher.ignoreRegions, visualCache);
}

function isImageRegionMatcherType(type: StateMatcher["type"]): boolean {
  return type === "image_region" || type === "semantic_image_region";
}

type ScreenshotRegionMatcher = {
  id: string;
  label: string;
  rect: Rect;
  signature: string;
  baselineArtifactId?: string;
  baselinePath?: string;
  baselineUrl?: string;
  ignoreRegions?: Rect[];
};

function readScreenshotRegionMatchers(value: unknown): ScreenshotRegionMatcher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const input = item as Record<string, unknown>;
      const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : `region-${index + 1}`;
      const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : `重点区域 ${index + 1}`;
      const rect = readPercentRect(input);
      if (!rect) {
        return undefined;
      }
      const existingSignature = typeof input.signature === "string" && input.signature.trim() ? input.signature.trim() : undefined;
      const evidenceText = readStringArray(input.evidenceTexts);
      const baselineArtifactId = typeof input.baselineArtifactId === "string" && input.baselineArtifactId.trim() ? input.baselineArtifactId.trim() : undefined;
      const region: ScreenshotRegionMatcher = {
        id,
        label,
        rect,
        signature: existingSignature ?? imageRegionSignature(id, evidenceText.join("|") || label)
      };
      if (baselineArtifactId) {
        region.baselineArtifactId = baselineArtifactId;
      }
      if (typeof input.baselinePath === "string" && input.baselinePath.trim()) {
        region.baselinePath = input.baselinePath.trim();
      }
      if (typeof input.baselineUrl === "string" && input.baselineUrl.trim()) {
        region.baselineUrl = input.baselineUrl.trim();
      }
      const ignoreRegions = readPercentRects(input.ignoreRegions);
      if (ignoreRegions.length) {
        region.ignoreRegions = ignoreRegions;
      }
      return region;
    })
    .filter((item): item is ScreenshotRegionMatcher => Boolean(item));
}

function hasVisualBaseline(region: ScreenshotRegionMatcher): boolean {
  return Boolean(region.baselineArtifactId);
}

function readPercentRect(input: Record<string, unknown>): Rect | undefined {
  const x = readNumber(input.x);
  const y = readNumber(input.y);
  const width = readNumber(input.width);
  const height = readNumber(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function readPercentRects(value: unknown): Rect[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      return readPercentRect(item as Record<string, unknown>);
    })
    .filter((item): item is Rect => Boolean(item));
}

function regionTextSignature(observation: Observation, region: Rect): string {
  const texts = [
    ...observation.ocrTexts
      .filter((text) => !text.region || percentRectOverlaps(text.region, region, observation.resolution))
      .map((text) => text.text),
    ...observation.uiElements
      .filter((element) => !element.bounds || percentRectOverlaps(element.bounds, region, observation.resolution))
      .flatMap((element) => [element.text, element.contentDesc])
      .filter(isPortableRegionEvidenceText)
  ];
  return normalizeSignatureParts(texts);
}

function isPortableRegionEvidenceText(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  if (!normalized || isPlatformSpecificEvidence(normalized)) {
    return false;
  }
  return !new Set([
    "avatar",
    "back",
    "close",
    "contact",
    "down",
    "icon",
    "search",
    "user avatar"
  ]).has(normalized.toLowerCase());
}

function isPlatformSpecificEvidence(value: string): boolean {
  return (
    /^[a-z][\w.]+:id\/[\w.]+$/i.test(value) ||
    /^android(?:x)?\.[\w.$]+$/i.test(value) ||
    /^ios\.[\w.$]+$/i.test(value) ||
    /^XCUIElementType\w+$/i.test(value) ||
    /^(?:resource-id|accessibility-id|content-desc|class|package|activity)\s*:/i.test(value)
  );
}

function percentRectOverlaps(actualRect: Rect, percentRegion: Rect, resolution: Observation["resolution"]): boolean {
  const region = percentRectToPixels(percentRegion, resolution);
  const actual = normalizeRectScale(actualRect, resolution);
  if (!region || !actual) {
    return false;
  }
  const overlapWidth = Math.max(0, Math.min(actual.x + actual.width, region.x + region.width) - Math.max(actual.x, region.x));
  const overlapHeight = Math.max(0, Math.min(actual.y + actual.height, region.y + region.height) - Math.max(actual.y, region.y));
  const overlapArea = overlapWidth * overlapHeight;
  const actualArea = actual.width * actual.height;
  if (actualArea <= 0) {
    return false;
  }
  return overlapArea / actualArea >= 0.35 || overlapArea > 0;
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

function pixelRectToPercent(region: Rect, resolution: NonNullable<Observation["resolution"]>): Rect {
  return {
    x: roundPercentValue((region.x / resolution.width) * 100),
    y: roundPercentValue((region.y / resolution.height) * 100),
    width: roundPercentValue((region.width / resolution.width) * 100),
    height: roundPercentValue((region.height / resolution.height) * 100)
  };
}

function normalizeRectScale(rect: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height || rect.x > 100 || rect.y > 100 || rect.width > 100 || rect.height > 100) {
    return rect;
  }
  return percentRectToPixels(rect, resolution);
}

function imageRegionSignature(regionId: string, evidence: string): string {
  return `screenshot-region:${encodeURIComponent(regionId)}:${encodeURIComponent(normalizeSignatureParts([evidence]))}`;
}

function semanticImageRegionSignature(region: ScreenshotRegionMatcher): string {
  const parsed = parseImageRegionSignature(region.signature);
  return `semantic-image-region:${encodeURIComponent(parsed.id ?? region.id)}:${encodeURIComponent(normalizeSignatureParts([parsed.evidence ?? region.label]))}`;
}

function parseImageRegionSignature(value: string): { id?: string; evidence?: string } {
  const [, rawId, rawEvidence] = value.match(/^(?:screenshot-region|semantic-image-region):([^:]+):?(.*)$/) ?? [];
  return {
    id: rawId ? decodeComponent(rawId) : undefined,
    evidence: rawEvidence ? decodeComponent(rawEvidence) : undefined
  };
}

function textSignatureSimilarity(expected: string, actual: string): number {
  const expectedParts = new Set(splitSignature(expected));
  const actualParts = new Set(splitSignature(actual));
  if (!expectedParts.size && !actualParts.size) {
    return 1;
  }
  if (!expectedParts.size || !actualParts.size) {
    return 0;
  }
  let matched = 0;
  for (const part of expectedParts) {
    if (actualParts.has(part)) {
      matched += 1;
      continue;
    }
    if ([...actualParts].some((actualPart) => actualPart.includes(part) || part.includes(actualPart))) {
      matched += 1;
    }
  }
  return matched / expectedParts.size;
}

async function imageRegionVisualSimilarity(
  screenshot: Buffer,
  baseline: Buffer,
  percentRegion: Rect,
  resolution: Observation["resolution"],
  ignoreRegions: Rect[] | undefined,
  visualCache?: VisualMatchCache
): Promise<number> {
  const actualSample = visualCache ? await imageSampleNativeBestEffortCached(screenshot, visualCache) : await imageSampleNativeBestEffort(screenshot);
  const baselineSample = visualCache ? await imageSampleNativeBestEffortCached(baseline, visualCache) : await imageSampleNativeBestEffort(baseline);
  if (!actualSample || !baselineSample) {
    const actual = await cropRegionBestEffort(screenshot, percentRegion, resolution);
    return imageBufferSimilarity(actual, baseline);
  }
  const pixelRegion = percentRectToPixels(percentRegion, { width: actualSample.width, height: actualSample.height });
  if (!pixelRegion) {
    return imageBufferSimilarity(screenshot, baseline);
  }
  const baselinePrepared = resizeSample(baselineSample, 32, 32);
  const candidates = candidateSearchRects(pixelRegion, actualSample);
  let best = 0;
  for (const candidate of candidates) {
    const candidateSample = cropSample(actualSample, candidate);
    if (!candidateSample) {
      continue;
    }
    const normalizedCandidate = resizeSample(candidateSample, 32, 32);
    const localIgnoreRegions = [...(ignoreRegions ?? []), ...systemBarIgnoreRegionsForCrop(candidate, actualSample)];
    const candidateWithMask = applyIgnoreRegions(normalizedCandidate, localIgnoreRegions);
    const baselineWithMask = applyIgnoreRegions(baselinePrepared, localIgnoreRegions);
    if (!candidateWithMask || !baselineWithMask) {
      continue;
    }
    best = Math.max(best, combinedVisualSimilarity(candidateWithMask.pixels, baselineWithMask.pixels));
  }
  return roundSimilarity(best);
}

async function imageVisualSimilarity(actual: Buffer, baseline: Buffer, ignoreRegions: Rect[] | undefined): Promise<number> {
  const actualSample = await imageSampleNativeBestEffort(actual);
  const baselineSample = await imageSampleNativeBestEffort(baseline);
  if (!actualSample || !baselineSample) {
    return imageBufferSimilarity(actual, baseline);
  }
  const actualPrepared = applyIgnoreRegions(resizeSample(actualSample, 32, 32), ignoreRegions);
  const baselinePrepared = applyIgnoreRegions(resizeSample(baselineSample, 32, 32), ignoreRegions);
  if (!actualPrepared || !baselinePrepared) {
    return imageBufferSimilarity(actual, baseline);
  }
  return combinedVisualSimilarity(actualPrepared.pixels, baselinePrepared.pixels);
}

function combinedVisualSimilarity(actual: number[], baseline: number[]): number {
  const ssim = grayscaleStructuralSimilarity(actual, baseline);
  const hashSimilarity = perceptualHashSimilarity(actual, baseline);
  return Math.max(0, Math.min(1, ssim * 0.65 + hashSimilarity * 0.35));
}

function grayscaleStructuralSimilarity(actual: number[], baseline: number[]): number {
  const length = Math.min(actual.length, baseline.length);
  if (length === 0) {
    return 1;
  }
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < length; index += 1) {
    const actualValue = actual[index];
    const baselineValue = baseline[index];
    if (actualValue < 0 || baselineValue < 0) {
      continue;
    }
    pairs.push([actualValue, baselineValue]);
  }
  if (!pairs.length) {
    return 1;
  }
  const actualMean = pairs.reduce((sum, [value]) => sum + value, 0) / pairs.length;
  const baselineMean = pairs.reduce((sum, [, value]) => sum + value, 0) / pairs.length;
  let actualVariance = 0;
  let baselineVariance = 0;
  let covariance = 0;
  for (const [actualValue, baselineValue] of pairs) {
    const actualDelta = actualValue - actualMean;
    const baselineDelta = baselineValue - baselineMean;
    actualVariance += actualDelta * actualDelta;
    baselineVariance += baselineDelta * baselineDelta;
    covariance += actualDelta * baselineDelta;
  }
  actualVariance /= pairs.length;
  baselineVariance /= pairs.length;
  covariance /= pairs.length;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const numerator = (2 * actualMean * baselineMean + c1) * (2 * covariance + c2);
  const denominator = (actualMean ** 2 + baselineMean ** 2 + c1) * (actualVariance + baselineVariance + c2);
  if (denominator === 0) {
    return 1;
  }
  return Math.max(0, Math.min(1, numerator / denominator));
}

function perceptualHashSimilarity(actual: number[], baseline: number[]): number {
  const actualHash = averageHash(actual);
  const baselineHash = averageHash(baseline);
  const actualDHash = differenceHash(actual);
  const baselineDHash = differenceHash(baseline);
  return (booleanHashSimilarity(actualHash, baselineHash) + booleanHashSimilarity(actualDHash, baselineDHash)) / 2;
}

function booleanHashSimilarity(actualHash: boolean[], baselineHash: boolean[]): number {
  const length = Math.min(actualHash.length, baselineHash.length);
  if (length === 0) {
    return 1;
  }
  let same = 0;
  for (let index = 0; index < length; index += 1) {
    if (actualHash[index] === baselineHash[index]) {
      same += 1;
    }
  }
  return same / length;
}

function averageHash(pixels: number[]): boolean[] {
  const visible = pixels.filter((value) => value >= 0);
  const average = visible.length ? visible.reduce((sum, value) => sum + value, 0) / visible.length : 0;
  return pixels.map((value) => value >= 0 && value >= average);
}

function differenceHash(pixels: number[]): boolean[] {
  const side = Math.round(Math.sqrt(pixels.length));
  if (side <= 1 || side * side !== pixels.length) {
    return averageHash(pixels);
  }
  const result: boolean[] = [];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side - 1; x += 1) {
      const left = pixels[y * side + x];
      const right = pixels[y * side + x + 1];
      result.push(left >= 0 && right >= 0 && left > right);
    }
  }
  return result;
}

export type ImageSample = {
  width: number;
  height: number;
  pixels: number[];
};

function createVisualMatchCache(): VisualMatchCache {
  return {
    baselineByArtifactId: new Map(),
    sampleByBuffer: new WeakMap()
  };
}

function readBaselineArtifact(
  baselineReader: PageMatcherBaselineReader,
  artifactId: string,
  visualCache: VisualMatchCache
): Promise<Buffer | undefined> {
  const cached = visualCache.baselineByArtifactId.get(artifactId);
  if (cached) {
    return cached;
  }
  const loaded = baselineReader(artifactId).catch(() => undefined);
  visualCache.baselineByArtifactId.set(artifactId, loaded);
  return loaded;
}

function imageSampleNativeBestEffortCached(image: Buffer, visualCache: VisualMatchCache): Promise<ImageSample | undefined> {
  const cached = visualCache.sampleByBuffer.get(image);
  if (cached) {
    return cached;
  }
  const sampled = imageSampleNativeBestEffort(image);
  visualCache.sampleByBuffer.set(image, sampled);
  return sampled;
}

export async function imageSampleNativeBestEffort(image: Buffer): Promise<ImageSample | undefined> {
  const pgmSample = parsePgm(image);
  if (pgmSample) {
    return pgmSample;
  }
  if (!isLikelyPng(image)) {
    return undefined;
  }
  return decodeImageSampleWithFfmpeg(image);
}

function parsePgm(image: Buffer): ImageSample | undefined {
  const header = image.toString("ascii", 0, Math.min(image.length, 128));
  const match = header.match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!match) {
    return undefined;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxValue = Number(match[3]);
  const headerLength = match[0].length;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return undefined;
  }
  const pixelBytes = image.subarray(headerLength, headerLength + width * height);
  if (pixelBytes.length < width * height) {
    return undefined;
  }
  return {
    width,
    height,
    pixels: Array.from(pixelBytes, (value) => Math.round((value / maxValue) * 255))
  };
}

function applyIgnoreRegions(sample: ImageSample | undefined, ignoreRegions: Rect[] | undefined): ImageSample | undefined {
  if (!sample || !ignoreRegions?.length) {
    return sample;
  }
  const pixels = [...sample.pixels];
  for (const region of ignoreRegions) {
    const rect = percentRectToPixels(region, { width: sample.width, height: sample.height });
    if (!rect) {
      continue;
    }
    const startX = Math.max(0, Math.floor(rect.x));
    const startY = Math.max(0, Math.floor(rect.y));
    const endX = Math.min(sample.width, Math.ceil(rect.x + rect.width));
    const endY = Math.min(sample.height, Math.ceil(rect.y + rect.height));
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        pixels[y * sample.width + x] = -1;
      }
    }
  }
  return {
    ...sample,
    pixels
  };
}

async function decodeImageSampleWithFfmpeg(image: Buffer): Promise<ImageSample | undefined> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-page-sample-"));
  const inputPath = path.join(tempDir, "input.png");
  const outputPath = path.join(tempDir, "sample.pgm");
  try {
    await writeFile(inputPath, image);
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vf",
      "format=gray",
      outputPath
    ]);
    return parsePgm(await readFile(outputPath));
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function candidateSearchRects(pixelRegion: Rect, sample: ImageSample): Rect[] {
  const width = Math.max(1, Math.round(pixelRegion.width));
  const height = Math.max(1, Math.round(pixelRegion.height));
  const x = Math.round(pixelRegion.x);
  const y = Math.round(pixelRegion.y);
  const radiusX = Math.max(1, Math.round(width * 0.18));
  const radiusY = Math.max(1, Math.round(height * 0.18));
  const stepX = Math.max(1, Math.round(radiusX / 2));
  const stepY = Math.max(1, Math.round(radiusY / 2));
  const offsetsX = uniqueNumbers([-radiusX, -stepX, 0, stepX, radiusX]);
  const offsetsY = uniqueNumbers([-radiusY, -stepY, 0, stepY, radiusY]);
  const rects: Rect[] = [];
  for (const offsetY of offsetsY) {
    for (const offsetX of offsetsX) {
      const candidate = {
        x: Math.max(0, Math.min(sample.width - width, x + offsetX)),
        y: Math.max(0, Math.min(sample.height - height, y + offsetY)),
        width,
        height
      };
      if (!rects.some((item) => rectsNearlyEqualPixels(item, candidate))) {
        rects.push(candidate);
      }
    }
  }
  return rects.sort((left, right) => rectDistance(left, pixelRegion) - rectDistance(right, pixelRegion));
}

function cropSample(sample: ImageSample, rect: Rect): ImageSample | undefined {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(sample.width - startX, Math.round(rect.width)));
  const height = Math.max(1, Math.min(sample.height - startY, Math.round(rect.height)));
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = (startY + y) * sample.width + startX;
    pixels.push(...sample.pixels.slice(sourceOffset, sourceOffset + width));
  }
  return { width, height, pixels };
}

function resizeSample(sample: ImageSample, width: number, height: number): ImageSample {
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sample.height - 1, Math.floor(((y + 0.5) / height) * sample.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sample.width - 1, Math.floor(((x + 0.5) / width) * sample.width));
      pixels.push(sample.pixels[sourceY * sample.width + sourceX] ?? 0);
    }
  }
  return { width, height, pixels };
}

function systemBarIgnoreRegionsForCrop(crop: Rect, sample: ImageSample): Rect[] {
  const topBarHeight = Math.max(1, Math.round(sample.height * 0.04));
  const bottomBarHeight = Math.max(1, Math.round(sample.height * 0.03));
  return [
    localIntersectionPercent(crop, { x: 0, y: 0, width: sample.width, height: topBarHeight }),
    localIntersectionPercent(crop, { x: 0, y: sample.height - bottomBarHeight, width: sample.width, height: bottomBarHeight })
  ].filter((item): item is Rect => Boolean(item));
}

function localIntersectionPercent(crop: Rect, mask: Rect): Rect | undefined {
  const left = Math.max(crop.x, mask.x);
  const top = Math.max(crop.y, mask.y);
  const right = Math.min(crop.x + crop.width, mask.x + mask.width);
  const bottom = Math.min(crop.y + crop.height, mask.y + mask.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0 || crop.width <= 0 || crop.height <= 0) {
    return undefined;
  }
  return {
    x: ((left - crop.x) / crop.width) * 100,
    y: ((top - crop.y) / crop.height) * 100,
    width: (width / crop.width) * 100,
    height: (height / crop.height) * 100
  };
}

function rectsNearlyEqualPixels(left: Rect, right: Rect): boolean {
  return Math.round(left.x) === Math.round(right.x) &&
    Math.round(left.y) === Math.round(right.y) &&
    Math.round(left.width) === Math.round(right.width) &&
    Math.round(left.height) === Math.round(right.height);
}

function rectDistance(left: Rect, right: Rect): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function imageBufferSimilarity(actual: Buffer, baseline: Buffer): number {
  const maxLength = Math.max(actual.length, baseline.length);
  if (maxLength === 0) {
    return 1;
  }
  let matched = 0;
  const minLength = Math.min(actual.length, baseline.length);
  for (let index = 0; index < minLength; index += 1) {
    if (actual[index] === baseline[index]) {
      matched += 1;
    }
  }
  return matched / maxLength;
}

function splitSignature(value: string): string[] {
  return normalizeSignatureParts([value]).split("|").filter(Boolean);
}

function normalizeSignatureParts(values: Array<string | undefined>): string {
  return uniqueStrings(
    values.flatMap((value) =>
      value
        ?.split(/[|,，\n]/)
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ).join("|");
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function roundSimilarity(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
}

function roundPercentValue(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readVisualLocatorTemplate(value: unknown): VisualLocatorTemplate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const width = typeof input.width === "number" && Number.isFinite(input.width) ? Math.floor(input.width) : undefined;
  const height = typeof input.height === "number" && Number.isFinite(input.height) ? Math.floor(input.height) : undefined;
  const pixels = Array.isArray(input.pixels)
    ? input.pixels.map((item) => (typeof item === "number" && Number.isFinite(item) ? Math.max(0, Math.min(255, Math.round(item))) : undefined))
    : [];
  const region = readVisualTemplateRect(input.region);
  if (!width || !height || pixels.length !== width * height || pixels.some((item) => item === undefined) || !region) {
    return undefined;
  }
  return {
    version: 1,
    source: "recorded_crop",
    width,
    height,
    pixels: pixels as number[],
    hash: typeof input.hash === "string" && input.hash.trim() ? input.hash : sampleHash(pixels as number[]),
    region
  };
}

function readVisualTemplateRect(value: unknown): Rect | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = typeof input.x === "number" && Number.isFinite(input.x) ? input.x : undefined;
  const y = typeof input.y === "number" && Number.isFinite(input.y) ? input.y : undefined;
  const width = typeof input.width === "number" && Number.isFinite(input.width) ? input.width : undefined;
  const height = typeof input.height === "number" && Number.isFinite(input.height) ? input.height : undefined;
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function sampleHash(pixels: number[]): string {
  const bits = [...averageHash(pixels), ...differenceHash(pixels)].map((bit) => bit ? "1" : "0").join("");
  let hash = 2166136261;
  for (let index = 0; index < bits.length; index += 1) {
    hash ^= bits.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function readObservationScreenshotBytes(observation: Observation): Buffer | undefined {
  const value = observation.raw?.screenshotBase64;
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return Buffer.from(value, "base64");
  } catch {
    return undefined;
  }
}

async function cropRegionBestEffort(image: Buffer, percentRegion: Rect, resolution: Observation["resolution"]): Promise<Buffer> {
  if (!isLikelyPng(image)) {
    return image;
  }
  const imageSize = await pngDimensionsBestEffort(image);
  const pixelRegion = percentRectToPixels(percentRegion, imageSize ?? resolution);
  if (!pixelRegion) {
    return image;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-page-region-"));
  const inputPath = path.join(tempDir, "input.png");
  const outputPath = path.join(tempDir, "region.png");
  try {
    await writeFile(inputPath, image);
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vf",
      `crop=${Math.max(1, Math.round(pixelRegion.width))}:${Math.max(1, Math.round(pixelRegion.height))}:${Math.max(0, Math.round(pixelRegion.x))}:${Math.max(0, Math.round(pixelRegion.y))}`,
      outputPath
    ]);
    return await readFile(outputPath);
  } catch {
    return image;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isLikelyPng(value: Buffer): boolean {
  return value.length > 8 && value[0] === 0x89 && value[1] === 0x50 && value[2] === 0x4e && value[3] === 0x47;
}

async function pngDimensionsBestEffort(image: Buffer): Promise<{ width: number; height: number } | undefined> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-png-size-"));
  const inputPath = path.join(tempDir, "input.png");
  try {
    await writeFile(inputPath, image);
    const output = await execFileTextAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      inputPath
    ]);
    const [width, height] = output.trim().split("x").map(Number);
    return width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve();
    });
  });
}

function execFileTextAsync(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}
