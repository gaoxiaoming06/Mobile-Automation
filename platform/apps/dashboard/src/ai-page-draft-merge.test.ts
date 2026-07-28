import { describe, expect, it } from "vitest";
import { aiElementSuggestionToDraft, mergeAiPageDraftIntoPage, type AiElementSuggestion, type AiPageDraftApiResponse } from "./ai-page-draft-merge.js";

const response: AiPageDraftApiResponse = {
  suggestion: {
    page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", riskNotes: [] },
    identityOcrTexts: [{ text: "鲸放肿瘤百科" }],
    identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }],
    elements: [
      { elementLabel: "搜索入口", locatorKind: "visual_locator", locator: "image-region:4,18,92,6", coordinateSpace: "screen", semanticArea: "top", riskNotes: [] }
    ]
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
  it("maps a visual suggestion to element draft with defaults", () => {
    expect(aiElementSuggestionToDraft(response.suggestion.elements[0]!, "node-1")).toEqual({
      sourceNodeId: "node-1",
      locator: "image-region:4,18,92,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "搜索入口",
      targetText: undefined,
      locatorKind: "visual_locator"
    });
  });

  it("keeps every structured locator field when mapping to a draft", () => {
    const suggestion: AiElementSuggestion = {
      elementLabel: "医生列表",
      locatorKind: "collection_item_locator",
      locator: "image-region:2,30,96,55",
      coordinateSpace: "screen",
      region: { x: 2, y: 30, width: 96, height: 55 },
      semanticArea: "content",
      riskNotes: [],
      scrollProfile: { containerKind: "list", direction: "vertical", targetKind: "ocr_text", targetQuery: "{{itemText}}" },
      dynamicRegion: { id: "dynamic_region_ai_x", kind: "grid" },
      itemTemplate: { id: "item_template_ai_x" },
      dynamicMasks: [{ kind: "avatar", region: { x: 4, y: 32, width: 8, height: 5 }, reason: "医生头像" }]
    };
    expect(aiElementSuggestionToDraft(suggestion, "node-1")).toMatchObject({
      locatorKind: "collection_item_locator",
      scrollProfile: expect.objectContaining({ targetQuery: "{{itemText}}" }),
      dynamicRegion: { id: "dynamic_region_ai_x", kind: "grid" },
      itemTemplate: { id: "item_template_ai_x" },
      dynamicMasks: [expect.objectContaining({ kind: "avatar" })]
    });
  });

  it("maps top bar and anchor offset suggestions with runtime payloads", () => {
    const topBar: AiElementSuggestion = {
      elementLabel: "搜索图标",
      locatorKind: "top_bar_icon_locator",
      locator: "top-bar-icon:search",
      coordinateSpace: "runtime",
      semanticArea: "top",
      riskNotes: [],
      structuralLocator: { kind: "top_bar_icon", role: "search", slot: "trailing" },
      visualLocator: { strategy: "top_bar_icon_shape", candidates: [{ role: "search", label: "搜索", score: 0.8, region: { x: 86, y: 4.5, width: 8, height: 4 }, semanticArea: "top" }] }
    };
    expect(aiElementSuggestionToDraft(topBar, "node-1")).toMatchObject({
      locator: "top-bar-icon:search",
      coordinateSpace: "runtime",
      structuralLocator: expect.objectContaining({ kind: "top_bar_icon" }),
      visualLocator: expect.objectContaining({ candidates: [expect.objectContaining({ role: "search" })] })
    });

    const anchor: AiElementSuggestion = {
      elementLabel: "会员中心右侧箭头",
      locatorKind: "ocr_anchor_offset",
      locator: "image-region:88,20,8,5",
      coordinateSpace: "screen",
      targetText: "会员中心",
      anchorText: "会员中心",
      anchorOffsetPercent: { x: 38, y: 0 },
      riskNotes: [],
      structuralLocator: { kind: "ocr_anchor_offset", anchorText: "会员中心", anchorOffsetPercent: { x: 38, y: 0 } }
    };
    expect(aiElementSuggestionToDraft(anchor, "node-1")).toMatchObject({
      locatorKind: "ocr_anchor_offset",
      targetText: "会员中心",
      anchorOffsetPercent: { x: 38, y: 0 }
    });
  });
});
