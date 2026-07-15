import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import { AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS, buildPageDraftEvidence, buildPageDraftPrompt } from "./ai-page-draft.js";

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
