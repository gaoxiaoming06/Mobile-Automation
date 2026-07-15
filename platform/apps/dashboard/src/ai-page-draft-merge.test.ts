import { describe, expect, it } from "vitest";
import { aiElementSuggestionToDraft, mergeAiPageDraftIntoPage, type AiPageDraftApiResponse } from "./ai-page-draft-merge.js";

const response: AiPageDraftApiResponse = {
  suggestion: {
    page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", riskNotes: [] },
    identityOcrTexts: [{ text: "鲸放肿瘤百科" }],
    identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }],
    elements: [{ elementLabel: "搜索入口", abilityType: "fixed_tap", actionKind: "tap", locator: "image-region:4,18,92,6", semanticArea: "top", riskNotes: [] }]
  },
  warnings: ["状态栏文案已剔除"],
  channel: "codex",
  visionUsed: true
};

describe("mergeAiPageDraftIntoPage", () => {
  it("fills empty name/key, unions ocr texts, appends ai regions", () => {
    const merged = mergeAiPageDraftIntoPage({ status: "draft_created", confirmedOcrTexts: ["已有文案"], screenshotRegions: [] }, response);
    expect(merged.pageName).toBe("肿瘤百科");
    expect(merged.targetRef).toBe("encyclopedia");
    expect(merged.confirmedOcrTexts).toEqual(["已有文案", "鲸放肿瘤百科"]);
    expect(merged.screenshotRegions).toEqual([
      { id: "ai-title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top", coordinateSpace: "screen" }
    ]);
    expect(merged.aiElementSuggestions).toHaveLength(1);
    expect(merged.aiWarnings).toEqual(["状态栏文案已剔除"]);
  });

  it("does not overwrite user-entered name/key and dedupes", () => {
    const merged = mergeAiPageDraftIntoPage({
      status: "draft_created",
      pageName: "用户已填",
      targetRef: "user.key",
      confirmedOcrTexts: ["鲸放肿瘤百科"],
      screenshotRegions: [{ id: "ai-title", label: "旧", x: 1, y: 1, width: 2, height: 2 }]
    }, response);
    expect(merged.pageName).toBe("用户已填");
    expect(merged.targetRef).toBe("user.key");
    expect(merged.confirmedOcrTexts).toEqual(["鲸放肿瘤百科"]);
    expect(merged.screenshotRegions).toHaveLength(1);
    expect(merged.screenshotRegions![0]!.label).toBe("旧");
  });
});

describe("aiElementSuggestionToDraft", () => {
  it("maps suggestion to element draft with defaults", () => {
    expect(aiElementSuggestionToDraft(response.suggestion.elements[0]!, "node-1")).toEqual({
      sourceNodeId: "node-1",
      abilityType: "fixed_tap",
      actionKind: "tap",
      availability: "visible",
      locator: "image-region:4,18,92,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "搜索入口",
      targetText: undefined
    });
  });
});
