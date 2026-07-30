import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";

export type PageAssetLibrarySummary = {
  graphVersionId: string;
  pageAssets: PageAssetSummary[];
};

export type PageAssetSummary = {
  id: string;
  key: string;
  name: string;
  status: BusinessNode["status"];
  platformScope?: BusinessNode["platformScope"];
  tags: string[];
  matcherCount: number;
  criticalMatcherCount: number;
  identityTexts: string[];
  confirmedMatchers: string[];
  confirmedUiTexts: string[];
  confirmedOcrTexts: string[];
  screenshotRegions: PageAssetScreenshotRegionSummary[];
  visibleTexts: string[];
  resourceIds: string[];
  accessibilityIds: string[];
  updatedAt?: string;
};

export type PageAssetScreenshotRegionSummary = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  semanticArea?: string;
  coordinateSpace?: string;
  evidenceTexts: string[];
  baselineUrl?: string;
};

export function buildPageAssetLibrarySummary(graphVersion: BusinessGraphVersion): PageAssetLibrarySummary {
  return {
    graphVersionId: graphVersion.id,
    pageAssets: graphVersion.nodes.filter(isPageAsset).map(summarizePageAsset)
  };
}

function isPageAsset(node: BusinessNode): boolean {
  return node.status !== "deprecated" && node.metadata?.assetRecordingConfirmed === true;
}

function summarizePageAsset(node: BusinessNode): PageAssetSummary {
  const confirmedMatchers = stringArray(node.metadata, "confirmedMatchers");
  const confirmedUiTexts = stringArray(node.metadata, "confirmedUiTexts");
  const confirmedOcrTexts = stringArray(node.metadata, "confirmedOcrTexts");
  const screenshotRegions = summarizeScreenshotRegions(node.metadata);
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    status: node.status,
    platformScope: node.platformScope,
    tags: node.tags,
    matcherCount: node.matchers.length,
    criticalMatcherCount: node.matchers.filter((matcher) => matcher.critical).length,
    identityTexts: identityTexts(node, confirmedMatchers, confirmedOcrTexts, screenshotRegions),
    confirmedMatchers,
    confirmedUiTexts,
    confirmedOcrTexts,
    screenshotRegions,
    visibleTexts: stringArray(node.metadata, "visibleTexts"),
    resourceIds: stringArray(node.metadata, "resourceIds"),
    accessibilityIds: stringArray(node.metadata, "accessibilityIds"),
    updatedAt: stringField(node.metadata, "lastObservedAt") ?? stringField(node.metadata, "updatedAt")
  };
}

function identityTexts(
  node: BusinessNode,
  confirmedMatchers: string[],
  confirmedOcrTexts: string[],
  screenshotRegions: PageAssetScreenshotRegionSummary[]
): string[] {
  return uniqueStrings([
    ...confirmedMatchers.map(displayText),
    ...confirmedOcrTexts.map(displayText),
    ...screenshotRegions.flatMap((region) => [...region.evidenceTexts.map(displayText), region.label]),
    ...node.matchers
      .filter((matcher) => matcher.critical && ["text", "ocr_text", "custom"].includes(matcher.type))
      .map((matcher) => displayText(matcher.value))
  ].filter(isUsefulIdentityText));
}

function displayText(value: string): string {
  return value.replace(/^(?:text|ocr_text|ocr|matcher):/i, "").replace(/@region\([^)]+\)$/i, "").trim();
}

function isUsefulIdentityText(value: string): boolean {
  if (!value || !/[\p{L}\p{N}]/u.test(value)) {
    return false;
  }
  return !(
    /^[a-z][\w.]+:id\/[\w.]+$/i.test(value) ||
    /^android(?:x)?\.[\w.$]+$/i.test(value) ||
    /^ios\.[\w.$]+$/i.test(value) ||
    /^XCUIElementType\w+$/i.test(value) ||
    /^(?:resource-id|accessibility-id|content-desc|class)\s*:/i.test(value)
  );
}

function summarizeScreenshotRegions(metadata: Record<string, unknown> | undefined): PageAssetScreenshotRegionSummary[] {
  const regions = metadata?.screenshotRegions;
  if (!Array.isArray(regions)) {
    return [];
  }
  return regions
    .map((item, index): PageAssetScreenshotRegionSummary | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const region = item as Record<string, unknown>;
      const x = numberField(region, "x");
      const y = numberField(region, "y");
      const width = numberField(region, "width");
      const height = numberField(region, "height");
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        return undefined;
      }
      return {
        id: stringField(region, "id") ?? `region-${index + 1}`,
        label: stringField(region, "label") ?? `重点区域 ${index + 1}`,
        x,
        y,
        width,
        height,
        ...(stringField(region, "semanticArea") ? { semanticArea: stringField(region, "semanticArea") } : {}),
        ...(stringField(region, "coordinateSpace") ? { coordinateSpace: stringField(region, "coordinateSpace") } : {}),
        evidenceTexts: stringArray(region, "evidenceTexts"),
        ...(stringField(region, "baselineUrl") ? { baselineUrl: stringField(region, "baselineUrl") } : {})
      };
    })
    .filter((item): item is PageAssetScreenshotRegionSummary => Boolean(item));
}

function stringArray(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
