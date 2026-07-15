import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import { AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS, buildPageDraftEvidence, buildPageDraftPrompt, generateAiPageDraft, parseAiPageDraftResponse } from "./ai-page-draft.js";

function observationFixture(overrides: Partial<Observation> = {}): Observation {
  return {
    platform: "android",
    capturedAt: "2026-07-15T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.MainActivity",
    resolution: { width: 1000, height: 2000 },
    uiElements: [],
    ocrTexts: [],
    ...overrides
  };
}

describe("buildPageDraftEvidence", () => {
  it("converts OCR pixel regions to percent with two decimals", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      ocrTexts: [{ text: "首页", confidence: 0.98, region: { x: 100, y: 500, width: 333, height: 100 } }]
    }));
    expect(evidence.ocrTexts).toEqual([
      { text: "首页", confidence: 0.98, region: { x: 10, y: 25, width: 33.3, height: 5 } }
    ]);
  });

  it("keeps only clickable or labelled ui elements and caps the list", () => {
    const clickable = { className: "android.widget.Button", clickable: true, bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const noise = { className: "android.widget.FrameLayout", clickable: false };
    const labelled = { className: "android.view.View", clickable: false, text: "提交" };
    const evidence = buildPageDraftEvidence(observationFixture({
      uiElements: [noise, clickable, labelled, ...Array.from({ length: 200 }, () => clickable)]
    }));
    expect(evidence.uiElements.length).toBeLessThanOrEqual(80);
    expect(evidence.uiElements[0]).toMatchObject({ clickable: true, bounds: { x: 0, y: 0, width: 10, height: 5 } });
    expect(evidence.uiElements.some((item) => item.text === "提交")).toBe(true);
  });

  it("caps ocr texts at 120 and drops blank texts", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      ocrTexts: [{ text: "  " }, ...Array.from({ length: 300 }, (_, index) => ({ text: `文案${index}` }))]
    }));
    expect(evidence.ocrTexts).toHaveLength(120);
    expect(evidence.ocrTexts[0]!.text).toBe("文案0");
  });

  it("omits regions when resolution is unknown", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      resolution: undefined,
      ocrTexts: [{ text: "首页", region: { x: 100, y: 500, width: 333, height: 100 } }]
    }));
    expect(evidence.ocrTexts).toEqual([{ text: "首页", confidence: undefined, region: undefined }]);
  });
});

const validPayload = {
  page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", confidence: 0.9, riskNotes: [] },
  identityOcrTexts: [{ text: "鲸放肿瘤百科", confidence: 0.95 }],
  identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }],
  elements: [{ elementLabel: "搜索入口", abilityType: "fixed_tap", actionKind: "tap", locator: "image-region:4,18,92,6", semanticArea: "top", confidence: 0.8, riskNotes: [] }]
};
const parseObservation = observationFixture({ ocrTexts: [{ text: "鲸放肿瘤百科" }, { text: "10:57" }] });

describe("parseAiPageDraftResponse", () => {
  it("accepts a valid payload", () => {
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(validPayload), parseObservation);
    expect(suggestion.page.key).toBe("encyclopedia");
    expect(suggestion.identityOcrTexts).toHaveLength(1);
    expect(suggestion.elements).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("extracts json from surrounding prose", () => {
    const raw = "以下是建议：\n" + JSON.stringify(validPayload) + "\n请确认。";
    expect(parseAiPageDraftResponse(raw, parseObservation).suggestion.page.name).toBe("肿瘤百科");
  });

  it("throws on unparseable output", () => {
    expect(() => parseAiPageDraftResponse("完全不是 JSON", parseObservation)).toThrow(/JSON/);
  });

  it("drops hallucinated identity ocr texts", () => {
    const payload = { ...validPayload, identityOcrTexts: [{ text: "证据里不存在的文案" }] };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityOcrTexts).toEqual([]);
    expect(warnings.some((w) => w.includes("证据里不存在的文案"))).toBe(true);
  });

  it("drops dynamic texts like clock even when present in evidence", () => {
    const payload = { ...validPayload, identityOcrTexts: [{ text: "10:57" }] };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityOcrTexts).toEqual([]);
    expect(warnings.length).toBe(1);
  });

  it("clamps out-of-range regions and drops degenerate ones", () => {
    const payload = {
      ...validPayload,
      identityRegions: [
        { id: "a", label: "越界", x: -5, y: 95, width: 120, height: 20, semanticArea: "top" },
        { id: "b", label: "零面积", x: 10, y: 10, width: 0, height: 5, semanticArea: "content" }
      ]
    };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityRegions).toEqual([
      { id: "a", label: "越界", x: 0, y: 95, width: 100, height: 5, semanticArea: "top", confidence: undefined, reason: undefined }
    ]);
    expect(warnings.some((w) => w.includes("零面积"))).toBe(true);
  });

  it("keeps strategy-less elements as manual-completion drafts and drops illegal ability types", () => {
    const payload = {
      ...validPayload,
      elements: [
        { elementLabel: "坏定位", abilityType: "fixed_tap", actionKind: "tap", locator: "xpath://Button", riskNotes: [] },
        { elementLabel: "坏类型", abilityType: "magic_tap", actionKind: "tap", locator: "image-region:1,1,10,10", riskNotes: [] }
      ]
    };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.elements).toHaveLength(1);
    expect(suggestion.elements[0]).toMatchObject({
      elementLabel: "坏定位",
      locator: "",
      needsManualCompletion: true
    });
    expect(warnings).toHaveLength(2);
  });

  it("falls back assetKind to page with warning", () => {
    const payload = { ...validPayload, page: { ...validPayload.page, assetKind: "modal" } };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.page.assetKind).toBe("page");
    expect(warnings.some((w) => w.includes("assetKind"))).toBe(true);
  });
});

describe("parseAiPageDraftResponse locator strategies", () => {
  const strategyObservation = observationFixture({
    ocrTexts: [
      { text: "鲸放肿瘤百科" },
      { text: "免费咨询" },
      { text: "消息免打扰" },
      { text: "会员中心" },
      { text: "确认" },
      { text: "确认" }
    ]
  });

  function parseElements(elements: unknown[]): { elements: ReturnType<typeof parseAiPageDraftResponse>["suggestion"]["elements"]; warnings: string[] } {
    const payload = { ...validPayload, elements };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), strategyObservation);
    return { elements: suggestion.elements, warnings };
  }

  it("emits a text locator without requiring a marked region", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "免费咨询", locatorKind: "text_locator", targetText: "免费咨询", abilityType: "fixed_tap", actionKind: "tap", semanticArea: "content", riskNotes: [] }
    ]);
    expect(warnings).toEqual([]);
    expect(elements[0]).toMatchObject({
      locatorKind: "text_locator",
      locator: "text:免费咨询",
      coordinateSpace: "runtime",
      targetText: "免费咨询",
      structuralLocator: expect.objectContaining({ kind: "ocr_text", text: "免费咨询" })
    });
    expect(elements[0]!.region).toBeUndefined();
  });

  it("flags exact duplicate text candidates as review risk instead of degrading", () => {
    const { elements } = parseElements([
      { elementLabel: "确认按钮", locatorKind: "text_locator", targetText: "确认", abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]!.locatorKind).toBe("text_locator");
    expect(elements[0]!.riskNotes.some((note) => note.includes("2 处完全相同"))).toBe(true);
  });

  it("degrades a text locator whose target is missing from OCR when a region exists", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "臆造入口", locatorKind: "text_locator", targetText: "不存在的文字", region: { x: 10, y: 40, width: 60, height: 8 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({
      locatorKind: "visual_locator",
      degradedFrom: "text_locator",
      locator: "image-region:10,40,60,8"
    });
    expect(warnings.some((w) => w.includes("降级"))).toBe(true);
  });

  it("marks a text locator for manual completion when target is missing and there is no region", () => {
    const { elements } = parseElements([
      { elementLabel: "臆造入口", locatorKind: "text_locator", targetText: "不存在的文字", abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({ needsManualCompletion: true, locator: "" });
    expect(elements[0]!.completionReason).toContain("不存在的文字");
  });

  it("builds runtime-consumable top bar icon assets with visual candidates", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "搜索图标", locatorKind: "top_bar_icon_locator", role: "Search", slot: "right", orderFromRight: 1, region: { x: 86, y: 4.5, width: 8, height: 4 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(warnings).toEqual([]);
    expect(elements[0]).toMatchObject({
      locatorKind: "top_bar_icon_locator",
      locator: "top-bar-icon:search",
      coordinateSpace: "runtime",
      semanticArea: "top",
      structuralLocator: expect.objectContaining({ kind: "top_bar_icon", role: "search", slot: "trailing", orderFromRight: 1 }),
      visualLocator: expect.objectContaining({
        strategy: "top_bar_icon_shape",
        searchRegion: { x: 86, y: 4.5, width: 8, height: 4 },
        candidates: [
          expect.objectContaining({ source: "ai_draft", role: "search", semanticArea: "top", region: { x: 86, y: 4.5, width: 8, height: 4 } })
        ]
      })
    });
  });

  it("requests manual completion for a top bar icon without a reference region", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "搜索图标", locatorKind: "top_bar_icon_locator", role: "search", abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({ needsManualCompletion: true, locatorKind: "top_bar_icon_locator", locator: "" });
    expect(warnings.some((w) => w.includes("参考区域"))).toBe(true);
  });

  it("degrades a top bar icon whose region is not in the top area", () => {
    const { elements } = parseElements([
      { elementLabel: "搜索图标", locatorKind: "top_bar_icon_locator", role: "search", region: { x: 40, y: 50, width: 10, height: 6 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({ locatorKind: "visual_locator", degradedFrom: "top_bar_icon_locator" });
  });

  it("builds collection assets with container region and parameterized target query only", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "医生列表", locatorKind: "collection_item_locator", region: { x: 2, y: 30, width: 96, height: 55 }, scroll: { direction: "vertical", containerKind: "list", candidateIndex: 2 }, candidateIndex: 2, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({
      locatorKind: "collection_item_locator",
      abilityType: "grid_candidate",
      locator: "image-region:2,30,96,55",
      scrollProfile: {
        containerKind: "list",
        direction: "vertical",
        targetKind: "ocr_text",
        targetQuery: "{{itemText}}",
        afterFoundAction: "tap_item"
      },
      transitionKind: "parameterized",
      parameterMapping: { itemText: "dynamicRegion.item.titleText" }
    });
    expect(elements[0]!.scrollProfile).not.toHaveProperty("columns");
    expect(elements[0]).not.toHaveProperty("candidateIndex");
    expect(elements[0]!.dynamicRegion).toMatchObject({ kind: "grid", region: { x: 2, y: 30, width: 96, height: 55 } });
    expect(elements[0]!.itemTemplate).toMatchObject({ dynamicFields: [{ name: "itemText", role: "title" }] });
    expect(warnings.some((w) => w.includes("candidateIndex"))).toBe(true);
    expect(warnings.some((w) => w.includes("grid_candidate"))).toBe(true);
  });

  it("builds whitelisted structural locators with verified anchor text", () => {
    const { elements } = parseElements([
      { elementLabel: "消息免打扰开关", locatorKind: "structural_locator", structuralStrategy: "ocr_trailing_switch", anchorText: "消息免打扰", region: { x: 4, y: 42, width: 92, height: 6 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] },
      { elementLabel: "同意协议", locatorKind: "structural_locator", structuralStrategy: "near_text_checkbox", anchorText: "消息免打扰", region: { x: 4, y: 80, width: 92, height: 5 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({
      locatorKind: "structural_locator",
      targetText: "消息免打扰",
      structuralLocator: { strategy: "ocr_trailing_switch", anchorText: "消息免打扰" }
    });
    expect(elements[1]!.structuralLocator).toEqual({
      strategy: "near_text",
      role: "checkbox",
      clickTarget: "leading_checkbox",
      anchorText: "消息免打扰"
    });
  });

  it("rejects invented structural strategies", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "魔法开关", locatorKind: "structural_locator", structuralStrategy: "magic_switch", anchorText: "消息免打扰", region: { x: 4, y: 42, width: 92, height: 6 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({ locatorKind: "visual_locator", degradedFrom: "structural_locator" });
    expect(warnings.some((w) => w.includes("白名单"))).toBe(true);
  });

  it("emits ocr anchor offset assets with the runtime field name", () => {
    const { elements } = parseElements([
      { elementLabel: "会员中心右侧箭头", locatorKind: "ocr_anchor_offset", anchorText: "会员中心", anchorOffsetPercent: { x: 80, y: -3 }, region: { x: 88, y: 20, width: 8, height: 5 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({
      locatorKind: "ocr_anchor_offset",
      targetText: "会员中心",
      anchorText: "会员中心",
      anchorOffsetPercent: { x: 50, y: -3 },
      structuralLocator: expect.objectContaining({ kind: "ocr_anchor_offset", anchorText: "会员中心" })
    });
    expect(elements[0]).not.toHaveProperty("offsetPercent");
  });

  it("warns when an anchor offset is omitted but keeps the element", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "会员中心右侧箭头", locatorKind: "ocr_anchor_offset", anchorText: "会员中心", region: { x: 88, y: 20, width: 8, height: 5 }, abilityType: "fixed_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]!.locatorKind).toBe("ocr_anchor_offset");
    expect(elements[0]!.anchorOffsetPercent).toBeUndefined();
    expect(warnings.some((w) => w.includes("anchorOffsetPercent"))).toBe(true);
  });

  it("keeps visual locators with masks and strips unverifiable target text", () => {
    const { elements, warnings } = parseElements([
      { elementLabel: "活动横幅", locatorKind: "visual_locator", targetText: "不存在的文字", region: { x: 4, y: 12, width: 92, height: 12 }, dynamicMasks: [{ kind: "image", region: { x: 4, y: 12, width: 30, height: 12 }, reason: "活动图轮换" }], abilityType: "conditional_tap", actionKind: "tap", riskNotes: [] }
    ]);
    expect(elements[0]).toMatchObject({
      locatorKind: "visual_locator",
      locator: "image-region:4,12,92,12",
      dynamicMasks: [expect.objectContaining({ kind: "image", reason: "活动图轮换" })]
    });
    expect(elements[0]!.targetText).toBeUndefined();
    expect(warnings.some((w) => w.includes("已移除"))).toBe(true);
  });
});

const enabledConfig = { enabled: true as const, baseURL: "https://llm.example.com/v1", apiKey: "sk", model: "m", timeoutMs: 5000 };

function llmResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("generateAiPageDraft", () => {
  it("throws not_configured when AI is disabled", async () => {
    await expect(
      generateAiPageDraft({ config: { enabled: false, reason: "disabled" }, observation: parseObservation })
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("returns sanitized suggestion via openai-compatible channel", async () => {
    const fetchImpl = async (_url: string, _init?: RequestInit) => llmResponse(JSON.stringify(validPayload));
    const result = await generateAiPageDraft({ config: enabledConfig, observation: parseObservation, fetchImpl });
    expect(result.channel).toBe("openai-compatible");
    expect(result.suggestion.page.key).toBe("encyclopedia");
    expect(result.visionUsed).toBe(false);
  });

  it("attaches screenshot from raw evidence as image", async () => {
    let sawImage = false;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      sawImage = JSON.stringify(JSON.parse(init!.body as string).messages).includes("data:image/png;base64");
      return llmResponse(JSON.stringify(validPayload));
    };
    const observationWithShot = { ...parseObservation, raw: { screenshotBase64: "aGk=" } };
    const result = await generateAiPageDraft({ config: enabledConfig, observation: observationWithShot, fetchImpl });
    expect(sawImage).toBe(true);
    expect(result.visionUsed).toBe(true);
  });

  it("wraps unparseable llm output as invalid_response", async () => {
    const fetchImpl = async (_url: string, _init?: RequestInit) => llmResponse("不是 JSON");
    await expect(generateAiPageDraft({ config: enabledConfig, observation: parseObservation, fetchImpl }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("buildPageDraftPrompt", () => {
  it("embeds rules, schema and evidence json", () => {
    const prompt = buildPageDraftPrompt(buildPageDraftEvidence(observationFixture({ ocrTexts: [{ text: "肿瘤百科" }] })));
    expect(prompt).toContain("肿瘤百科");
    expect(prompt).toContain("identityOcrTexts");
    expect(prompt).toContain("locatorKind");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("只返回一个 JSON");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("状态栏");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("top_bar_icon_locator");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("anchorOffsetPercent");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("禁止输出 candidateIndex");
  });
});
