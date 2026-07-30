import type {
  AssetRecordingCurrentPage,
  AssetRecordingScreenshotRegion
} from "./components/AssetRecordingPanel";

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
    pageKey: page.pageKey?.trim() ? page.pageKey : suggestion.page.key,
    confirmedOcrTexts: mergedOcrTexts,
    screenshotRegions: [...existingRegions, ...aiRegions],
    aiWarnings: response.warnings
  };
}
