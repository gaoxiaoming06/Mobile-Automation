import type {
  AssetRecordingCurrentPage,
  AssetRecordingPageElementDraft,
  AssetRecordingScreenshotRegion
} from "./components/AssetRecordingPanel";

export type AiLocatorKind =
  | "text_locator"
  | "visual_locator"
  | "structural_locator"
  | "collection_item_locator"
  | "top_bar_icon_locator"
  | "ocr_anchor_offset";

export type AiSuggestionRect = { x: number; y: number; width: number; height: number };

export type AiElementSuggestion = {
  elementLabel: string;
  targetText?: string;
  abilityType: "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap";
  actionKind: "tap" | "scroll" | "long_press" | "input";
  locatorKind: AiLocatorKind;
  locator: string;
  coordinateSpace: "screen" | "runtime";
  region?: AiSuggestionRect;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  confidence?: number;
  riskNotes: string[];
  structuralLocator?: Record<string, unknown>;
  visualLocator?: Record<string, unknown>;
  anchorText?: string;
  anchorOffsetPercent?: { x: number; y: number };
  scrollProfile?: {
    containerKind: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
    direction: "vertical" | "horizontal";
    targetKind: "ocr_text";
    targetQuery: string;
    afterFoundAction: "tap_item";
  };
  dynamicRegion?: Record<string, unknown>;
  itemTemplate?: Record<string, unknown>;
  transitionKind?: "parameterized";
  parameterMapping?: Record<string, string>;
  dynamicMasks?: Array<{ kind: "avatar" | "text" | "image" | "number" | "custom"; label?: string; region: AiSuggestionRect; reason?: string }>;
  needsManualCompletion?: boolean;
  completionReason?: string;
  degradedFrom?: AiLocatorKind;
};

export type AiPageDraftApiResponse = {
  suggestion: {
    page: { name: string; key: string; assetKind: "page" | "overlay"; confidence?: number; riskNotes: string[] };
    identityOcrTexts: Array<{ text: string; confidence?: number; reason?: string }>;
    identityRegions: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
      semanticArea: "top" | "content" | "bottom" | "unknown";
      confidence?: number;
      reason?: string;
    }>;
    elements: AiElementSuggestion[];
  };
  warnings: string[];
  channel: string;
  visionUsed: boolean;
};

export const AI_LOCATOR_KIND_LABELS: Record<AiLocatorKind, string> = {
  text_locator: "文字定位",
  visual_locator: "视觉定位",
  structural_locator: "结构定位",
  collection_item_locator: "列表项定位",
  top_bar_icon_locator: "顶部栏图标",
  ocr_anchor_offset: "文字锚点偏移"
};

export function mergeAiPageDraftIntoPage(page: AssetRecordingCurrentPage, response: AiPageDraftApiResponse): AssetRecordingCurrentPage {
  const suggestion = response.suggestion;
  const existingOcrTexts = page.confirmedOcrTexts ?? [];
  const mergedOcrTexts = [
    ...existingOcrTexts,
    ...suggestion.identityOcrTexts.map((item) => item.text).filter((text) => !existingOcrTexts.includes(text))
  ];
  const existingRegions = page.screenshotRegions ?? [];
  const existingRegionIds = new Set(existingRegions.map((region) => region.id));
  const aiRegions: AssetRecordingScreenshotRegion[] = suggestion.identityRegions
    .filter((region) => !existingRegionIds.has(`ai-${region.id}`))
    .map((region) => ({
      id: `ai-${region.id}`,
      label: region.label,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      semanticArea: region.semanticArea,
      coordinateSpace: "screen"
    }));
  return {
    ...page,
    pageName: page.pageName?.trim() ? page.pageName : suggestion.page.name,
    targetRef: page.targetRef?.trim() ? page.targetRef : suggestion.page.key,
    confirmedOcrTexts: mergedOcrTexts,
    screenshotRegions: [...existingRegions, ...aiRegions],
    aiElementSuggestions: suggestion.elements,
    aiWarnings: response.warnings
  };
}

export function aiElementSuggestionToDraft(suggestion: AiElementSuggestion, sourceNodeId: string | undefined): AssetRecordingPageElementDraft {
  return {
    sourceNodeId,
    abilityType: suggestion.abilityType,
    actionKind: suggestion.actionKind,
    availability: "visible",
    locator: suggestion.locator,
    semanticArea: suggestion.semanticArea,
    coordinateSpace: suggestion.coordinateSpace,
    elementLabel: suggestion.elementLabel,
    targetText: suggestion.targetText,
    locatorKind: suggestion.locatorKind,
    ...(suggestion.structuralLocator ? { structuralLocator: suggestion.structuralLocator } : {}),
    ...(suggestion.visualLocator ? { visualLocator: suggestion.visualLocator } : {}),
    ...(suggestion.anchorOffsetPercent ? { anchorOffsetPercent: suggestion.anchorOffsetPercent } : {}),
    ...(suggestion.scrollProfile ? { scrollProfile: suggestion.scrollProfile } : {}),
    ...(suggestion.dynamicRegion ? { dynamicRegion: suggestion.dynamicRegion } : {}),
    ...(suggestion.itemTemplate ? { itemTemplate: suggestion.itemTemplate } : {}),
    ...(suggestion.transitionKind ? { transitionKind: suggestion.transitionKind } : {}),
    ...(suggestion.parameterMapping ? { parameterMapping: suggestion.parameterMapping } : {}),
    ...(suggestion.dynamicMasks?.length ? { dynamicMasks: suggestion.dynamicMasks } : {})
  };
}
