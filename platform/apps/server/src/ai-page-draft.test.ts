import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import {
  AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS,
  buildPageDraftEvidence,
  buildPageDraftPrompt,
  generateAiPageDraft,
  parseAiPageDraftResponse
} from "./ai-page-draft.js";

function observationFixture(overrides: Partial<Observation> = {}): Observation {
  return {
    platform: "android",
    capturedAt: "2026-07-29T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.MainActivity",
    resolution: { width: 1000, height: 2000 },
    uiElements: [],
    ocrTexts: [],
    ...overrides
  };
}

const observation = observationFixture({
  ocrTexts: [
    { text: "鲸放肿瘤百科", confidence: 0.98, region: { x: 100, y: 500, width: 333, height: 100 } },
    { text: "10:57" }
  ]
});

const validPayload = {
  page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", confidence: 0.9, riskNotes: [] },
  identityOcrTexts: [{ text: "鲸放肿瘤百科", confidence: 0.95 }],
  identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }]
};

describe("page identity AI draft", () => {
  it("only asks AI for page identity", () => {
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("只根据当前页面证据生成页面名称");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("禁止输出 elements");
    const prompt = buildPageDraftPrompt(buildPageDraftEvidence(observation));
    expect(prompt).toContain("identityOcrTexts");
    expect(prompt).not.toContain("locatorKind");
  });

  it("converts pixel evidence to percentages and caps noisy evidence", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      ocrTexts: [
        { text: "  " },
        { text: "首页", confidence: 0.98, region: { x: 100, y: 500, width: 333, height: 100 } },
        ...Array.from({ length: 200 }, (_, index) => ({ text: `文案${index}` }))
      ]
    }));
    expect(evidence.ocrTexts).toHaveLength(120);
    expect(evidence.ocrTexts[0]).toEqual({
      text: "首页",
      confidence: 0.98,
      region: { x: 10, y: 25, width: 33.3, height: 5 }
    });
  });

  it("accepts a strict page identity response", () => {
    expect(parseAiPageDraftResponse(JSON.stringify(validPayload), observation)).toEqual({
      suggestion: {
        page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", confidence: 0.9, riskNotes: [] },
        identityOcrTexts: [{ text: "鲸放肿瘤百科", confidence: 0.95 }],
        identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }]
      },
      warnings: []
    });
  });

  it("rejects legacy element suggestions as unknown fields", () => {
    expect(() => parseAiPageDraftResponse(JSON.stringify({ ...validPayload, elements: [] }), observation))
      .toThrow(/elements.*未知字段/);
  });

  it("drops hallucinated and dynamic OCR identity text", () => {
    const payload = {
      ...validPayload,
      identityOcrTexts: [{ text: "不存在" }, { text: "10:57" }]
    };
    const result = parseAiPageDraftResponse(JSON.stringify(payload), observation);
    expect(result.suggestion.identityOcrTexts).toEqual([]);
    expect(result.warnings).toHaveLength(2);
  });

  it("rejects unknown nested fields instead of silently normalizing them", () => {
    const payload = {
      ...validPayload,
      page: { ...validPayload.page, locator: "legacy" }
    };
    expect(() => parseAiPageDraftResponse(JSON.stringify(payload), observation)).toThrow(/page\.locator.*未知字段/);
  });

  it("uses the configured AI provider and parses its identity response", async () => {
    const result = await generateAiPageDraft({
      config: { enabled: true, baseURL: "https://ai.example/v1", apiKey: "sk", model: "planner", timeoutMs: 5000 },
      observation,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validPayload) } }]
      }), { status: 200 })
    });
    expect(result.suggestion.page.name).toBe("肿瘤百科");
    expect(result.channel).toBe("openai-compatible");
  });

  it("reports disabled AI configuration", async () => {
    await expect(generateAiPageDraft({
      config: { enabled: false, reason: "disabled" },
      observation
    })).rejects.toMatchObject({ code: "not_configured" });
  });
});
