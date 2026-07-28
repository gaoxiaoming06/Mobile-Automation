import type { BusinessNode, PlatformScope } from "@mobile-automation/graph-core";
import { nowIso } from "@mobile-automation/shared";
import type { PageElementQualityResult } from "./page-element-quality.js";

export type PageElementLocatorKind =
  | "text_locator"
  | "visual_locator"
  | "structural_locator"
  | "collection_item_locator"
  | "top_bar_icon_locator"
  | "ocr_anchor_offset";

export type PageElementDynamicMask = {
  kind: "avatar" | "text" | "image" | "number" | "custom";
  label?: string;
  region: PercentRect;
  reason?: string;
};

export type PageElementDynamicRegion = {
  id: string;
  label: string;
  kind: "list" | "grid" | "feed" | "form_group";
  region: PercentRect;
  itemTemplateId?: string;
  dynamicFieldRules?: Record<string, unknown>[];
};

export type PageElementItemTemplate = {
  id: string;
  label: string;
  region?: PercentRect;
  actionArea?: PercentRect;
  stableStructure?: Record<string, unknown>;
  stableAnchors?: Record<string, unknown>[];
  dynamicFields?: Record<string, unknown>[];
};

export type PageElementScrollProfile = {
  containerKind: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
  direction: "vertical" | "horizontal";
  columns?: number;
  targetKind: "item_text" | "ocr_text" | "semantic_label" | "nth_item" | "image_region";
  targetQuery?: string;
  candidateItemHeightPercent?: number;
  clickSafePoint?: { xPercent: number; yPercent: number };
  scrollStepPercent?: number;
  failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
};

type PercentRect = { x: number; y: number; width: number; height: number };

export type PageElementAssetStorage = {
  findBusinessNodeById(graphVersionId: string, nodeId: string): BusinessNode | undefined;
  updateBusinessNodeDetails(nodeId: string, input: { metadata?: Record<string, unknown> }): BusinessNode | undefined;
};

export type PersistPageElementAssetInput = {
  graphVersionId: string;
  storage: PageElementAssetStorage;
  elementId?: string;
  sourceNodeId: string;
  label: string;
  locator: string;
  locatorKind?: PageElementLocatorKind;
  targetText?: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  platformScope?: PlatformScope;
  tapPointPercent?: { x: number; y: number };
  anchorOffsetPercent?: { x: number; y: number };
  scrollProfile?: PageElementScrollProfile;
  quality?: PageElementQualityResult;
  visualLocator?: Record<string, unknown>;
  structuralLocator?: Record<string, unknown>;
  dynamicMasks?: PageElementDynamicMask[];
  dynamicRegion?: PageElementDynamicRegion;
  itemTemplate?: PageElementItemTemplate;
};

export type PageElementAssetMutationResult = {
  status: "saved" | "deleted" | "skipped";
  element?: Record<string, unknown>;
  reason?: string;
};

export function persistPageElementAsset(input: PersistPageElementAssetInput): PageElementAssetMutationResult {
  const page = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPage(page)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  const element = pageElementRecord(input);
  const elements = upsertById(readRecords(page.metadata?.assetRecordingManualElements), element);
  input.storage.updateBusinessNodeDetails(page.id, {
    metadata: {
      ...(page.metadata ?? {}),
      assetRecordingManualElements: elements,
      ...(input.dynamicRegion
        ? { assetRecordingDynamicRegions: upsertById(readRecords(page.metadata?.assetRecordingDynamicRegions), input.dynamicRegion) }
        : {}),
      ...(input.itemTemplate
        ? { assetRecordingItemTemplates: upsertById(readRecords(page.metadata?.assetRecordingItemTemplates), input.itemTemplate) }
        : {}),
      updatedAt: nowIso()
    }
  });
  return { status: "saved", element };
}

export function deletePageElementAsset(input: {
  graphVersionId: string;
  storage: PageElementAssetStorage;
  sourceNodeId: string;
  elementId: string;
}): PageElementAssetMutationResult {
  const page = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPage(page)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  const manualElements = readRecords(page.metadata?.assetRecordingManualElements);
  if (!manualElements.some((element) => element.id === input.elementId)) {
    return { status: "skipped", reason: "element_not_found" };
  }
  input.storage.updateBusinessNodeDetails(page.id, {
    metadata: {
      ...(page.metadata ?? {}),
      assetRecordingManualElements: manualElements.filter((element) => element.id !== input.elementId),
      updatedAt: nowIso()
    }
  });
  return { status: "deleted" };
}

function pageElementRecord(input: PersistPageElementAssetInput): Record<string, unknown> {
  const id = input.elementId?.trim() || `page_element_${slug(`${input.label}.${input.locator}`).slice(0, 72)}`;
  return {
    id,
    label: input.label,
    locator: input.locator,
    ...(input.locatorKind ? { locatorKind: input.locatorKind } : {}),
    ...(input.targetText ? { targetText: input.targetText } : {}),
    ...(input.semanticArea ? { semanticArea: input.semanticArea } : {}),
    ...(input.coordinateSpace ? { coordinateSpace: input.coordinateSpace } : {}),
    ...(input.platformScope ? { platformScope: input.platformScope } : {}),
    ...(input.tapPointPercent ? { tapPointPercent: input.tapPointPercent } : {}),
    ...(input.anchorOffsetPercent ? { anchorOffsetPercent: input.anchorOffsetPercent } : {}),
    ...(input.scrollProfile ? { scrollProfile: input.scrollProfile } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.visualLocator ? { visualLocator: input.visualLocator } : {}),
    ...(input.structuralLocator ? { structuralLocator: input.structuralLocator } : {}),
    ...(input.dynamicMasks?.length ? { dynamicMasks: input.dynamicMasks } : {}),
    ...(input.dynamicRegion ? { dynamicRegionId: input.dynamicRegion.id } : {}),
    ...(input.itemTemplate?.id
      ? { itemTemplateId: input.itemTemplate.id }
      : input.dynamicRegion?.itemTemplateId
        ? { itemTemplateId: input.dynamicRegion.itemTemplateId }
        : {}),
    updatedAt: nowIso()
  };
}

function isConfirmedPage(page: BusinessNode | undefined): page is BusinessNode {
  return Boolean(page && page.status !== "deprecated" && page.metadata?.assetRecordingConfirmed === true);
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function upsertById(existing: Record<string, unknown>[], next: Record<string, unknown> & { id?: string }): Record<string, unknown>[] {
  return [...existing.filter((item) => item.id !== next.id), next];
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, ".").replace(/^\.+|\.+$/g, "") || "unknown";
}
