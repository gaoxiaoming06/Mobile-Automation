import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectNode,
  type BusinessGraphVersion,
  type BusinessNode,
  type NodeMatchResult,
  type Observation,
  type ObservationImageRegion,
  type Rect,
  type StateMatcher
} from "@mobile-automation/graph-core";
import { createId, nowIso, type ArtifactRef } from "@mobile-automation/shared";
import {
  enrichObservationImageRegions as enrichPageMatcherObservationImageRegions,
  matchCurrentPage,
  type PageMatcherPollutionDiagnostic,
  type PageMatcherBaselineReader,
  type PageMatcherDiagnostics
} from "./page-matcher.js";
import { buildRuntimeUnknownNodeCandidate, mergeRuntimeUnknownNodeMetadata } from "./runtime-graph-candidate.js";

export type CurrentPageAssetStorage = {
  findBusinessNodeByKey(graphVersionId: string, key: string): BusinessNode | undefined;
  createBusinessNode(input: Omit<BusinessNode, "id"> & { id?: string }): BusinessNode;
  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined;
};

type ConfirmedPageAssetStorage = CurrentPageAssetStorage & {
  updateBusinessNodeDetails(
    nodeId: string,
      input: {
        key?: string;
        name?: string;
        nodeType?: BusinessNode["nodeType"];
        tags?: string[];
        matchers?: StateMatcher[];
        metadata?: Record<string, unknown>;
        status?: BusinessNode["status"];
        platformScope?: BusinessNode["platformScope"];
      }
  ): BusinessNode | undefined;
};

export type PageAssetBaselineWriter = (relativePath: string, bytes: Buffer) => Promise<ArtifactRef>;
export type PageAssetBaselineReader = PageMatcherBaselineReader;

export type CurrentPageCollectionOptionsInput = {
  includeOcr?: boolean;
  includeUiTree?: boolean;
};

export function readCurrentPageCollectionOptions(input: CurrentPageCollectionOptionsInput): {
  includeOcr: boolean;
  includeUiTree: boolean;
  includeScreenshot: true;
} {
  return {
    includeOcr: input.includeOcr ?? true,
    includeUiTree: input.includeUiTree === true,
    includeScreenshot: true
  };
}

export type CurrentPageArtifactWriter = {
  writeLog(runId: string, name: string, content: string): Promise<ArtifactRef>;
};

export type CurrentPageAssetResult =
  | {
      status: "matched";
      match: NodeMatchResult;
      observation: Observation;
      matcherDiagnostics?: PageMatcherDiagnostics;
      visualPageName?: string;
    }
  | {
      status: "draft_created" | "draft_reused" | "draft_candidate";
      match: NodeMatchResult;
      observation: Observation;
      matcherDiagnostics?: PageMatcherDiagnostics;
      node: BusinessNode;
      artifact?: ArtifactRef;
      visualPageName?: string;
    }
  | {
      status: "blocked";
      match: NodeMatchResult;
      observation: Observation;
      matcherDiagnostics?: PageMatcherDiagnostics;
      blocker: PageMatcherPollutionDiagnostic;
      message: string;
      visualPageName?: string;
    };

export async function identifyOrCreateCurrentPageDraft(input: {
  graphVersion: BusinessGraphVersion;
  observation: Observation;
  storage: CurrentPageAssetStorage;
  artifactWriter?: CurrentPageArtifactWriter;
  assetOnly?: boolean;
  baselineReader?: PageAssetBaselineReader;
}): Promise<CurrentPageAssetResult> {
  const pageMatch = input.assetOnly
      ? await matchCurrentPage({
        graphVersion: input.graphVersion,
        observation: input.observation,
        baselineReader: input.baselineReader,
        prefilterByForegroundTitle: true
      })
    : undefined;
  const graphVersion = input.assetOnly ? undefined : input.graphVersion;
  const observation = pageMatch?.observation ?? (graphVersion ? await enrichPageMatcherObservationImageRegions(input.observation, graphVersion, input.baselineReader) : input.observation);
  const match = pageMatch?.match ?? (graphVersion ? detectNode(observation, graphVersion, observation.platform) : pageMatch!.match);
  if (match.status === "matched") {
    return {
      status: "matched",
      match,
      observation,
      matcherDiagnostics: pageMatch?.diagnostics,
      visualPageName: inferVisualPageName(observation, match.node?.name)
    };
  }
  if (input.assetOnly && pageMatch?.diagnostics.pollution) {
    return {
      status: "blocked",
      match,
      observation,
      matcherDiagnostics: pageMatch.diagnostics,
      blocker: pageMatch.diagnostics.pollution,
      message: pageMatch.diagnostics.pollution.message,
      visualPageName: inferVisualPageName(observation, pageMatch.diagnostics.topCandidate?.name)
    };
  }

  const candidate = buildRuntimeUnknownNodeCandidate(input.graphVersion.id, observation, match);
  if (input.assetOnly) {
    return {
      status: "draft_candidate",
      match,
      observation,
      matcherDiagnostics: pageMatch?.diagnostics,
      node: candidateNode(candidate),
      visualPageName: inferVisualPageName(observation, candidate.name)
    };
  }
  const artifact = input.artifactWriter
    ? await input.artifactWriter.writeLog(createId("current_page_asset"), `current-page-candidate-${Date.now()}.json`, JSON.stringify(candidate, null, 2))
    : undefined;
  const existing = input.storage.findBusinessNodeByKey(input.graphVersion.id, candidate.key);
  if (existing) {
    const metadata = mergeRuntimeUnknownNodeMetadata(existing.metadata, candidate.metadata, artifact?.id ?? createId("artifact_ref"));
    const node = input.storage.updateBusinessNodeMetadata(existing.id, metadata) ?? {
      ...existing,
      metadata
    };
    return {
      status: "draft_reused",
      match,
      observation,
      node,
      artifact,
      visualPageName: inferVisualPageName(observation, node.name)
    };
  }

  const node = input.storage.createBusinessNode({
    ...candidate,
    graphVersionId: input.graphVersion.id,
    metadata: {
      ...(candidate.metadata ?? {}),
      artifactId: artifact?.id,
      artifactIds: artifact ? [artifact.id] : [],
      observationCount: 1,
      firstObservedAt: nowIso(),
      lastObservedAt: nowIso()
    }
  });
  return {
    status: "draft_created",
    match,
    observation,
    node,
    artifact,
    visualPageName: inferVisualPageName(observation, node.name)
  };
}

export function createConfirmedPageAssetFromCandidate(input: {
  graphVersionId: string;
  observation: Observation;
  match?: NodeMatchResult;
  draft: {
    key?: string;
    name?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
  storage: ConfirmedPageAssetStorage;
}): BusinessNode {
  const nodeInput = buildConfirmedPageAssetInput(input);
  if (isPromise(nodeInput)) {
    throw new Error("createConfirmedPageAssetFromCandidate cannot write async baseline artifacts; use buildConfirmedPageAssetInput with assetWriter first.");
  }
  const previous = input.storage.findBusinessNodeByKey(input.graphVersionId, input.draft.key ?? nodeInput.key);
  if (previous) {
    return (
      input.storage.updateBusinessNodeDetails(previous.id, {
        key: nodeInput.key,
        name: nodeInput.name,
        nodeType: nodeInput.nodeType,
        tags: nodeInput.tags,
        status: nodeInput.status,
        matchers: nodeInput.matchers,
        platformScope: nodeInput.platformScope,
        metadata: nodeInput.metadata
      }) ?? previous
    );
  }
  return input.storage.createBusinessNode(nodeInput);
}

export function buildConfirmedPageAssetInput(input: {
  graphVersionId: string;
  observation: Observation;
  match?: NodeMatchResult;
  draft: {
    key?: string;
    name?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
  assetWriter?: PageAssetBaselineWriter;
}): Omit<BusinessNode, "id"> | Promise<Omit<BusinessNode, "id">> {
  if (input.assetWriter) {
    return buildConfirmedPageAssetInputAsync(input as Parameters<typeof buildConfirmedPageAssetInputAsync>[0]);
  }
  return buildConfirmedPageAssetInputSync(input);
}

async function buildConfirmedPageAssetInputAsync(input: {
  graphVersionId: string;
  observation: Observation;
  match?: NodeMatchResult;
  draft: {
    key?: string;
    name?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
  assetWriter: PageAssetBaselineWriter;
}): Promise<Omit<BusinessNode, "id">> {
  const initialMetadata = enrichScreenshotRegionMetadata(input.draft.metadata, input.observation);
  const metadata = await writeScreenshotRegionBaselines(initialMetadata, input.observation, input.draft.key, input.assetWriter);
  return buildConfirmedPageAssetInputSync({
    ...input,
    draft: {
      ...input.draft,
      metadata
    }
  });
}

function buildConfirmedPageAssetInputSync(input: {
  graphVersionId: string;
  observation: Observation;
  match?: NodeMatchResult;
  draft: {
    key?: string;
    name?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
}): Omit<BusinessNode, "id"> {
  const candidate = buildRuntimeUnknownNodeCandidate(input.graphVersionId, input.observation, input.match);
  const metadata = enrichVisualSampleMetadata(enrichScreenshotRegionMetadata(input.draft.metadata, input.observation), input.observation);
  const explicitMatchers = confirmedMatchersFromMetadata(metadata, input.observation.platform);
  if (!explicitMatchers?.length) {
    throw new Error("Page asset requires confirmed matching evidence before it can be saved.");
  }
  const platformScope = explicitMatchers ? assetPlatformScope(explicitMatchers, input.observation.platform) : candidate.platformScope;
  const assetKind = readAssetKind(metadata);
  return {
    ...candidate,
    key: input.draft.key ?? candidate.key,
    name: input.draft.name ?? candidate.name,
    nodeType: assetKind === "overlay" ? "business_state" as const : candidate.nodeType,
    tags: assetKind === "overlay" ? mergeOverlayTags(input.draft.tags ?? candidate.tags) : input.draft.tags ?? candidate.tags,
    status: "active" as const,
    matchers: explicitMatchers ?? [],
    platformScope,
    metadata: {
      ...(candidate.metadata ?? {}),
      ...(metadata ?? {})
    }
  };
}

function readAssetKind(metadata: Record<string, unknown> | undefined): "page" | "overlay" {
  return metadata?.assetKind === "overlay" ? "overlay" : "page";
}

function enrichVisualSampleMetadata(metadata: Record<string, unknown> | undefined, observation: Observation): Record<string, unknown> {
  const sample = visualSampleFromObservation(observation);
  const existing = readVisualSamples(metadata?.visualSamples);
  return {
    ...(metadata ?? {}),
    visualSamples: mergeVisualSamples(existing, sample)
  };
}

function visualSampleFromObservation(observation: Observation): Record<string, unknown> {
  return stripUndefinedRecord({
    id: observation.id ? `sample-${observation.id}` : undefined,
    platform: observation.platform,
    appPackageName: observation.platform === "android" ? observation.packageName : undefined,
    iosBundleId: observation.platform === "ios" ? observation.bundleId : undefined,
    capturedAt: observation.capturedAt,
    resolution: observation.resolution,
    orientation: observation.orientation,
    screenshotArtifactId: observation.screenshot?.artifactId,
    ocrSummary: uniqueStrings(observation.ocrTexts.map((item) => item.text)).slice(0, 12),
    source: "asset-recording"
  });
}

function readVisualSamples(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
}

function mergeVisualSamples(existing: Record<string, unknown>[], sample: Record<string, unknown>): Record<string, unknown>[] {
  const sampleKey = visualSampleKey(sample);
  return [...existing.filter((item) => visualSampleKey(item) !== sampleKey), sample];
}

function visualSampleKey(sample: Record<string, unknown>): string {
  return [sample.platform, sample.appPackageName, sample.iosBundleId, sample.capturedAt].map((item) => String(item ?? "")).join("|");
}

function stripUndefinedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function mergeOverlayTags(tags: string[]): string[] {
  return Array.from(new Set([...tags.filter((tag) => tag !== "page-asset"), "page-state", "page-overlay", "asset-recording"]));
}

function confirmedMatchersFromMetadata(metadata: Record<string, unknown> | undefined, platformScope: StateMatcher["platformScope"]): StateMatcher[] | undefined {
  const confirmedMatchers = readStringArray(metadata?.confirmedMatchers);
  const confirmedOcrTexts = readStringArray(metadata?.confirmedOcrTexts);
  const screenshotRegions = readScreenshotRegionMatchers(metadata?.screenshotRegions).filter(hasVisualBaseline);
  const portableConfirmedMatchers = confirmedMatchers
    .map((value) => matcherFromEvidence(value, platformScope))
    .filter(isPortablePageIdentityMatcher);
  const portableConfirmedOcrTextMatchers = confirmedOcrTexts
    .map((value) => textMatcherFromConfirmedEvidence("ocr_text", value, 1.8, true, "mobile-both"))
    .filter(isPortablePageIdentityMatcher);
  if (!portableConfirmedMatchers.length && !portableConfirmedOcrTextMatchers.length && !screenshotRegions.length) {
    return undefined;
  }
  return [
    ...portableConfirmedMatchers,
    ...portableConfirmedOcrTextMatchers,
    ...screenshotRegions.flatMap((region) => [imageRegionMatcher(region), semanticImageRegionMatcher(region)])
  ];
}

function isPortablePageIdentityMatcher(matcher: StateMatcher): boolean {
  return matcher.type === "ocr_text" && isPortablePageIdentityText(matcher.value);
}

function isPortablePageIdentityText(value: string): boolean {
  return isPortableRegionEvidenceText(value);
}

function enrichScreenshotRegionMetadata(metadata: Record<string, unknown> | undefined, observation: Observation): Record<string, unknown> | undefined {
  const regions = readScreenshotRegionMatchers(metadata?.screenshotRegions);
  if (!metadata || !regions.length) {
    return metadata;
  }
  return {
    ...metadata,
    screenshotRegions: regions.map((region) => {
      const evidenceTexts = splitSignature(regionTextSignature(observation, region.rect));
      const signature = imageRegionSignature(region.id, evidenceTexts.join("|") || region.label);
      return {
        id: region.id,
        label: region.label,
        ...region.rect,
        semanticArea: region.semanticArea ?? semanticAreaForRect(region.rect),
        coordinateSpace: region.coordinateSpace ?? "screen",
        signature,
        evidenceTexts,
        ...(region.ignoreRegions?.length ? { ignoreRegions: region.ignoreRegions } : {}),
        ...(region.baselineArtifactId ? { baselineArtifactId: region.baselineArtifactId } : {}),
        ...(region.baselinePath ? { baselinePath: region.baselinePath } : {}),
        ...(region.baselineUrl ? { baselineUrl: region.baselineUrl } : {})
      };
    })
  };
}

async function writeScreenshotRegionBaselines(
  metadata: Record<string, unknown> | undefined,
  observation: Observation,
  nodeKey: string | undefined,
  assetWriter: PageAssetBaselineWriter
): Promise<Record<string, unknown> | undefined> {
  const regions = readScreenshotRegionMatchers(metadata?.screenshotRegions);
  const screenshot = readObservationScreenshotBytes(observation);
  if (!metadata || !regions.length || !screenshot) {
    return metadata;
  }
  const safeNodeKey = safePathPart(nodeKey ?? "page-asset");
  const screenshotRegions = [];
  for (const region of regions) {
    const baseline = await cropRegionBestEffort(screenshot, region.rect, observation.resolution);
    const relativePath = path.join("assets", "page-regions", `${safeNodeKey}-${safePathPart(region.id)}-${Date.now()}.png`);
    const artifact = await assetWriter(relativePath, baseline);
    screenshotRegions.push({
      id: region.id,
      label: region.label,
      ...region.rect,
      semanticArea: region.semanticArea ?? semanticAreaForRect(region.rect),
      coordinateSpace: region.coordinateSpace ?? "screen",
      signature: region.signature,
      evidenceTexts: splitSignature(parseImageRegionSignature(region.signature).evidence ?? ""),
      ...(region.ignoreRegions?.length ? { ignoreRegions: region.ignoreRegions } : {}),
      baselineArtifactId: artifact.id,
      baselinePath: artifact.path,
      baselineUrl: artifact.url
    });
  }
  return {
    ...metadata,
    screenshotRegions
  };
}

function imageRegionMatcher(region: ScreenshotRegionMatcher): StateMatcher {
  const matcher = {
    ...confirmedMatcher("image_region", region.signature, 3, true, "mobile-both"),
    threshold: 0.9,
    region: region.rect,
    semanticArea: region.semanticArea ?? semanticAreaForRect(region.rect),
    coordinateSpace: region.coordinateSpace ?? "screen",
    ignoreRegions: region.ignoreRegions
  };
  if (region.baselineArtifactId) {
    matcher.source = {
      ...(matcher.source ?? { sourceType: "manual_edit" as const }),
      artifactId: region.baselineArtifactId
    };
  }
  return matcher;
}

function semanticImageRegionMatcher(region: ScreenshotRegionMatcher): StateMatcher {
  const matcher: StateMatcher = {
    ...confirmedMatcher("semantic_image_region", semanticImageRegionSignature(region), 2.2, false, "mobile-both"),
    threshold: 0.68,
    region: region.rect,
    semanticArea: region.semanticArea ?? semanticAreaForRect(region.rect),
    coordinateSpace: region.coordinateSpace ?? "screen",
    ignoreRegions: region.ignoreRegions
  };
  if (region.baselineArtifactId) {
    matcher.source = {
      ...(matcher.source ?? { sourceType: "manual_edit" as const }),
      artifactId: region.baselineArtifactId
    };
  }
  return matcher;
}

function hasVisualBaseline(region: ScreenshotRegionMatcher): boolean {
  return Boolean(region.baselineArtifactId);
}

type ScreenshotRegionMatcher = {
  id: string;
  label: string;
  rect: Rect;
  semanticArea?: StateMatcher["semanticArea"];
  coordinateSpace?: StateMatcher["coordinateSpace"];
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
        semanticArea: readSemanticArea(input.semanticArea) ?? semanticAreaForRect(rect),
        coordinateSpace: readCoordinateSpace(input.coordinateSpace) ?? "screen",
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function matcherFromEvidence(value: string, platformScope: StateMatcher["platformScope"]): StateMatcher {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return confirmedMatcher("custom", value, 1, true, platformScope);
  }
  const rawType = value.slice(0, separatorIndex).trim();
  const matcherValue = value.slice(separatorIndex + 1).trim();
  const matcherType = normalizeEvidenceMatcherType(rawType);
  if (matcherType === "text" || matcherType === "ocr_text") {
    return textMatcherFromConfirmedEvidence(matcherType, matcherValue || value, matcherWeight(rawType), true, matcherPlatformScope(matcherType, platformScope));
  }
  return confirmedMatcher(matcherType, matcherValue || value, matcherWeight(rawType), true, matcherPlatformScope(matcherType, platformScope));
}

function textMatcherFromConfirmedEvidence(
  type: "text" | "ocr_text",
  value: string,
  weight: number,
  critical: boolean,
  platformScope: StateMatcher["platformScope"]
): StateMatcher {
  const parsed = parseRegionBoundTextEvidence(value);
  const matcher = confirmedMatcher(type, parsed.value, weight, critical, platformScope);
  if (parsed.region) {
    matcher.region = parsed.region;
    matcher.semanticArea = parsed.semanticArea ?? semanticAreaForRect(parsed.region);
    matcher.coordinateSpace = parsed.coordinateSpace ?? "screen";
  }
  return matcher;
}

function parseRegionBoundTextEvidence(value: string): {
  value: string;
  region?: Rect;
  semanticArea?: StateMatcher["semanticArea"];
  coordinateSpace?: StateMatcher["coordinateSpace"];
} {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:(?:text|ocr_text|ocr):)?(.+?)@region\(([^)]+)\)$/);
  if (!match) {
    return { value: trimmed };
  }
  const region = parseRegionNumbers(match[2]);
  return {
    value: match[1].trim(),
    ...(region ? { region, semanticArea: semanticAreaForRect(region), coordinateSpace: "screen" as const } : {})
  };
}

function readSemanticArea(value: unknown): StateMatcher["semanticArea"] | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function readCoordinateSpace(value: unknown): StateMatcher["coordinateSpace"] | undefined {
  return value === "screen" || value === "app_viewport" || value === "region" ? value : undefined;
}

function semanticAreaForRect(region: Rect): StateMatcher["semanticArea"] {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function parseRegionNumbers(value: string): Rect | undefined {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function normalizeEvidenceMatcherType(type: string): StateMatcher["type"] {
  if (type === "resource-id" || type === "resource_id") {
    return "resource_id";
  }
  if (type === "accessibility-id" || type === "accessibility_id") {
    return "accessibility_id";
  }
  if (type === "ocr" || type === "ocr_text") {
    return "ocr_text";
  }
  if (type === "semantic-image-region" || type === "semantic_image_region") {
    return "semantic_image_region";
  }
  if (type === "image-region" || type === "image_region") {
    return "image_region";
  }
  if (type === "activity" || type === "package" || type === "text" || type === "fragment" || type === "route" || type === "bundle_id") {
    return type;
  }
  return "custom";
}

function matcherWeight(type: string): number {
  if (type === "activity") {
    return 3;
  }
  if (type === "package") {
    return 2;
  }
  if (type === "resource-id" || type === "resource_id") {
    return 2.5;
  }
  return 2;
}

function confirmedMatcher(type: StateMatcher["type"], value: string, weight: number, critical: boolean, platformScope: StateMatcher["platformScope"]): StateMatcher {
  return {
    id: createId("matcher"),
    type,
    value,
    weight,
    critical,
    platformScope,
    source: {
      sourceType: "manual_edit",
      confidence: 0.95
    }
  };
}

function matcherPlatformScope(type: StateMatcher["type"], currentPlatform: StateMatcher["platformScope"]): StateMatcher["platformScope"] {
  if (type === "text" || type === "ocr_text" || type === "image_region" || type === "semantic_image_region") {
    return "mobile-both";
  }
  return currentPlatform;
}

export async function enrichObservationImageRegions(
  observation: Observation,
  graphVersion: BusinessGraphVersion,
  baselineReader?: PageAssetBaselineReader
): Promise<Observation> {
  const matchers = graphVersion.nodes.flatMap((node) => node.matchers.filter((matcher) => isImageRegionMatcherType(matcher.type) && matcher.region));
  if (!matchers.length) {
    return observation;
  }
  const existing = observation.imageRegions ?? [];
  const generated: ObservationImageRegion[] = [];
  for (const matcher of matchers) {
    if (!matcher.region || [...existing, ...generated].some((region) => region.value === matcher.value)) {
      continue;
    }
    const similarity = await imageRegionSimilarity(observation, matcher, baselineReader);
    generated.push({
      value: matcher.value,
      region: matcher.region,
      similarity
    });
  }
  if (!generated.length) {
    return observation;
  }
  return {
    ...observation,
    imageRegions: [...existing, ...generated]
  };
}

async function imageRegionSimilarity(observation: Observation, matcher: StateMatcher, baselineReader: PageAssetBaselineReader | undefined): Promise<number> {
  if (matcher.type === "semantic_image_region") {
    return semanticImageRegionSimilarity(observation, matcher, baselineReader);
  }
  const baselineArtifactId = matcher.source?.artifactId;
  const screenshot = readObservationScreenshotBytes(observation);
  if (baselineReader && baselineArtifactId && matcher.region && screenshot) {
    const baseline = await baselineReader(baselineArtifactId).catch(() => undefined);
    if (baseline) {
      const actual = await cropRegionBestEffort(screenshot, matcher.region, observation.resolution);
      return imageBufferSimilarity(actual, baseline);
    }
  }
  const expectedSignature = parseImageRegionSignature(matcher.value);
  const actualSignature = matcher.region ? regionTextSignature(observation, matcher.region) : "";
  return expectedSignature.evidence ? textSignatureSimilarity(expectedSignature.evidence, actualSignature) : 0;
}

async function semanticImageRegionSimilarity(observation: Observation, matcher: StateMatcher, baselineReader: PageAssetBaselineReader | undefined): Promise<number> {
  const expectedSignature = parseImageRegionSignature(matcher.value);
  const actualSignature = matcher.region ? regionTextSignature(observation, matcher.region) : "";
  const textScore = expectedSignature.evidence ? textSignatureSimilarity(expectedSignature.evidence, actualSignature) : 0;
  const visualScore = await visualRegionSimilarity(observation, matcher, baselineReader);
  return roundSimilarity(Math.max(textScore, visualScore * 0.75));
}

async function visualRegionSimilarity(observation: Observation, matcher: StateMatcher, baselineReader: PageAssetBaselineReader | undefined): Promise<number> {
  const baselineArtifactId = matcher.source?.artifactId;
  const screenshot = readObservationScreenshotBytes(observation);
  if (!baselineReader || !baselineArtifactId || !matcher.region || !screenshot) {
    return 0;
  }
  const baseline = await baselineReader(baselineArtifactId).catch(() => undefined);
  if (!baseline) {
    return 0;
  }
  const actual = await cropRegionBestEffort(screenshot, matcher.region, observation.resolution);
  return imageBufferSimilarity(actual, baseline);
}

function assetPlatformScope(matchers: StateMatcher[], currentPlatform: BusinessNode["platformScope"]): BusinessNode["platformScope"] {
  return matchers.some((matcher) => matcher.platformScope === "mobile-both") ? "mobile-both" : currentPlatform;
}

function pageAssetOnlyGraphVersion(graphVersion: BusinessGraphVersion): BusinessGraphVersion {
  const nodes = graphVersion.nodes.filter(isConfirmedPageAssetNode).map(withRuntimeScreenshotRegionMatchers);
  return {
    ...graphVersion,
    nodes,
    edges: graphVersion.edges.filter((edge) =>
      nodes.some((node) => node.id === edge.fromNodeId) &&
      nodes.some((node) => node.id === edge.toNodeId)
    )
  };
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

function isImageRegionMatcherType(type: StateMatcher["type"]): boolean {
  return type === "image_region" || type === "semantic_image_region";
}

function isConfirmedPageAssetNode(node: BusinessNode): boolean {
  return node.status === "active" && node.nodeType === "page" && (Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset"));
}

function candidateNode(candidate: Omit<BusinessNode, "id">): BusinessNode {
  return {
    ...candidate,
    id: createId("page_asset_candidate")
  };
}

function inferVisualPageName(observation: Observation, fallback?: string): string | undefined {
  const texts = uniqueStrings([
    ...observation.uiElements.map((element) => element.text),
    ...observation.ocrTexts.map((text) => text.text)
  ]);
  const titleLike = texts.find((text) => isLikelyPageTitle(text));
  return titleLike ?? fallback;
}

function isLikelyPageTitle(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length > 12) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  return /[\u4e00-\u9fa5]/.test(normalized);
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

function roundSimilarity(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
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

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}
