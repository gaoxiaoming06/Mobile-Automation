import type {
  AssetRecordingCurrentPage,
  AssetRecordingPageElementDraft,
  AssetRecordingScreenshotRegion
} from "./components/AssetRecordingPanel";

export type AiElementSuggestion = {
  elementLabel: string;
  targetText?: string;
  abilityType: "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap";
  actionKind: "tap" | "scroll" | "long_press" | "input";
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  confidence?: number;
  riskNotes: string[];
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
    coordinateSpace: "screen",
    elementLabel: suggestion.elementLabel,
    targetText: suggestion.targetText
  };
}
