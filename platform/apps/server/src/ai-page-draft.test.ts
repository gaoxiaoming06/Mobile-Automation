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

  it("drops elements with illegal locator or abilityType", () => {
    const payload = {
      ...validPayload,
      elements: [
        { elementLabel: "坏定位", abilityType: "fixed_tap", actionKind: "tap", locator: "xpath://Button", riskNotes: [] },
        { elementLabel: "坏类型", abilityType: "magic_tap", actionKind: "tap", locator: "image-region:1,1,10,10", riskNotes: [] }
      ]
    };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.elements).toEqual([]);
    expect(warnings).toHaveLength(2);
  });

  it("falls back assetKind to page with warning", () => {
    const payload = { ...validPayload, page: { ...validPayload.page, assetKind: "modal" } };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.page.assetKind).toBe("page");
    expect(warnings.some((w) => w.includes("assetKind"))).toBe(true);
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
    expect(prompt).toContain("image-region:");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("只返回一个 JSON");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("状态栏");
  });
});
