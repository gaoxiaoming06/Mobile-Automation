import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, NodeMatchResult, Observation, StateMatcher } from "@mobile-automation/graph-core";
import { freeCompositionCurrentPageFromMatch, resolveFreeCompositionCurrentPage } from "./free-composition-current-page.js";

describe("freeCompositionCurrentPageFromMatch", () => {
  it("uses PageMatcher visual baseline enrichment like asset recording", async () => {
    const baseline = Buffer.from("same-region");
    const result = await resolveFreeCompositionCurrentPage(
      graph([
        pageNodeWithMatchers("page-home", "主页", [
          {
            ...matcher("image_region", "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5", 3, true, { x: 10, y: 5, width: 25, height: 8 }),
            threshold: 0.9,
            source: { sourceType: "manual_edit", artifactId: "artifact-home-title" }
          }
        ])
      ]),
      "cn.eeo.classin",
      "android",
      {
        ...observation({ uiElements: [], ocrTexts: [] }),
        raw: { screenshotBase64: baseline.toString("base64") }
      },
      async (artifactId) => artifactId === "artifact-home-title" ? baseline : undefined
    );

    expect(result).toEqual({
      pageModelId: "page-home",
      pageModelName: "主页"
    });
  });

  it("falls back to the visible page title when OCR title evidence is missing", async () => {
    const result = await resolveFreeCompositionCurrentPage(
      graph([pageNodeWithMatchers("page-home", "主页", [matcher("ocr_text", "主页", 3, true, { x: 10, y: 5, width: 25, height: 8 })])]),
      "cn.eeo.classin",
      "android",
      observation({
        uiElements: [{ text: "主页", bounds: { x: 198, y: 180, width: 120, height: 96 }, visible: true }],
        ocrTexts: []
      })
    );

    expect(result).toEqual({
      pageModelId: "page-home",
      pageModelName: "主页"
    });
  });

  it("does not fall back to a background page title when a foreground page is visible", async () => {
    const result = await resolveFreeCompositionCurrentPage(
      graph([pageNodeWithMatchers("page-home", "主页", [matcher("ocr_text", "主页", 3, true, { x: 10, y: 5, width: 25, height: 8 })])]),
      "cn.eeo.classin",
      "android",
      observation({
        uiElements: [
          { text: "全部课堂活动", bounds: { x: 60, y: 153, width: 846, height: 71 }, visible: true },
          { contentDesc: "close", bounds: { x: 918, y: 122, width: 144, height: 138 }, visible: true },
          { text: "24 小时内", bounds: { x: 60, y: 245, width: 185, height: 49 }, visible: true },
          { text: "主页", bounds: { x: 198, y: 180, width: 120, height: 96 }, visible: true },
          { text: "创建班级", bounds: { x: 90, y: 471, width: 168, height: 49 }, visible: true },
          { text: "创建公开课", bounds: { x: 594, y: 471, width: 210, height: 49 }, visible: true },
          { text: "全部班级", bounds: { x: 60, y: 636, width: 168, height: 49 }, visible: true },
          { text: "我是教师", bounds: { x: 336, y: 636, width: 168, height: 49 }, visible: true }
        ],
        ocrTexts: []
      })
    );

    expect(result).toBeUndefined();
  });

  it("does not report a matched non-page overlay node as the current page", async () => {
    const result = await resolveFreeCompositionCurrentPage(
      graph([
        pageNodeWithMatchers("page-home", "主页", [matcher("ocr_text", "主页", 3, true, { x: 10, y: 5, width: 25, height: 8 })]),
        {
          ...pageNodeWithMatchers("overlay-activity-list", "全部课堂活动", [matcher("text", "全部课堂活动", 9, true)]),
          nodeType: "business_state",
          tags: ["page-overlay", "page-state", "asset-recording"]
        }
      ]),
      "cn.eeo.classin",
      "android",
      observation({
        uiElements: [
          { text: "全部课堂活动", bounds: { x: 60, y: 153, width: 846, height: 71 }, visible: true },
          { text: "主页", bounds: { x: 198, y: 180, width: 120, height: 96 }, visible: true }
        ],
        ocrTexts: []
      })
    );

    expect(result).toBeUndefined();
  });

  it("falls back to the page title when bottom-tab labels make strict matching unknown", () => {
    const observation: Observation = {
      id: "observation-todo",
      platform: "android",
      capturedAt: "2026-07-24T07:40:00.000Z",
      packageName: "cn.eeo.classin",
      resolution: { width: 1080, height: 2340 },
      uiElements: [
        { text: "待办", bounds: { x: 40, y: 160, width: 120, height: 48 }, visible: true },
        { text: "主页", bounds: { x: 20, y: 2140, width: 100, height: 60 }, visible: true },
        { text: "课程表", bounds: { x: 540, y: 2140, width: 120, height: 60 }, visible: true }
      ],
      ocrTexts: [
        { text: "待办", region: { x: 40, y: 160, width: 120, height: 48 } },
        { text: "主页", region: { x: 20, y: 2140, width: 100, height: 60 } },
        { text: "课程表", region: { x: 540, y: 2140, width: 120, height: 60 } }
      ]
    };
    const match: NodeMatchResult = {
      status: "unknown",
      observationId: "observation-todo",
      capturedAt: observation.capturedAt,
      score: 0.6,
      threshold: 0.6,
      candidates: [
        {
          node: pageNode("page-home", "主页"),
          score: 0.6,
          matchedWeight: 4.5,
          totalWeight: 7.5,
          matcherResults: [],
          quality: {
            status: "low_confidence",
            reasons: ["critical_matcher_missing", "strong_state_anchor_missing"],
            matchedContextSignals: 0,
            matchedStrongSignals: 0,
            matchedWeakSignals: 5,
            missingStrongMatcherIds: ["home-title"],
            missingCriticalMatcherIds: ["home-title"]
          }
        },
        {
          node: pageNode("page-todo", "待办"),
          score: 0.2571,
          matchedWeight: 1.8,
          totalWeight: 7,
          matcherResults: [],
          quality: {
            status: "low_confidence",
            reasons: ["critical_matcher_missing"],
            matchedContextSignals: 0,
            matchedStrongSignals: 1,
            matchedWeakSignals: 0,
            missingStrongMatcherIds: ["todo-region"],
            missingCriticalMatcherIds: ["todo-region"]
          }
        },
        {
          node: pageNode("page-schedule", "课程表"),
          score: 0.2444,
          matchedWeight: 2.2,
          totalWeight: 9,
          matcherResults: [],
          quality: {
            status: "low_confidence",
            reasons: ["critical_matcher_missing"],
            matchedContextSignals: 0,
            matchedStrongSignals: 1,
            matchedWeakSignals: 0,
            missingStrongMatcherIds: ["schedule-region"],
            missingCriticalMatcherIds: ["schedule-region"]
          }
        }
      ]
    };

    expect(freeCompositionCurrentPageFromMatch(match, observation)).toEqual({
      pageModelId: "page-todo",
      pageModelName: "待办"
    });
  });

  it("does not fall back to an unrelated strong candidate when the foreground title differs", () => {
    const observation = {
      id: "observation-activity-list",
      platform: "android" as const,
      capturedAt: "2026-07-24T07:40:00.000Z",
      packageName: "cn.eeo.classin",
      resolution: { width: 1080, height: 2340 },
      uiElements: [
        { text: "全部课堂活动", bounds: { x: 60, y: 153, width: 846, height: 71 }, visible: true },
        { text: "主页", bounds: { x: 198, y: 180, width: 120, height: 96 }, visible: true }
      ],
      ocrTexts: []
    };
    const match: NodeMatchResult = {
      status: "unknown",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: 0.2955,
      threshold: 0.6,
      candidates: [
        {
          node: pageNode("page-qr", "二维码"),
          score: 0.2955,
          matchedWeight: 5.2,
          totalWeight: 17.6,
          matcherResults: [],
          quality: {
            status: "low_confidence",
            reasons: ["critical_matcher_missing"],
            matchedContextSignals: 0,
            matchedStrongSignals: 2,
            matchedWeakSignals: 0,
            missingStrongMatcherIds: ["qr-title"],
            missingCriticalMatcherIds: ["qr-title"]
          }
        }
      ]
    };

    expect(freeCompositionCurrentPageFromMatch(match, observation)).toBeUndefined();
  });
});

function pageNode(id: string, name: string): NodeMatchResult["candidates"][number]["node"] {
  return pageNodeWithMatchers(id, name, []);
}

function pageNodeWithMatchers(id: string, name: string, matchers: StateMatcher[]): NodeMatchResult["candidates"][number]["node"] {
  return {
    id,
    graphVersionId: "graph-version",
    key: id,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers,
    defaultExpectations: []
  };
}

function matcher(type: StateMatcher["type"], value: string, weight: number, critical: boolean, region?: StateMatcher["region"]): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight,
    critical,
    region,
    platformScope: "mobile-both"
  };
}

function graph(nodes: BusinessGraphVersion["nodes"]): BusinessGraphVersion {
  return {
    id: "graph-version",
    graphId: "graph",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges: [],
    createdAt: "2026-07-24T07:40:00.000Z"
  };
}

function observation(input: Pick<Observation, "uiElements" | "ocrTexts">): Observation {
  return {
    id: "observation-current",
    platform: "android",
    capturedAt: "2026-07-24T07:40:00.000Z",
    packageName: "cn.eeo.classin",
    resolution: { width: 1080, height: 2340 },
    uiElements: input.uiElements,
    ocrTexts: input.ocrTexts
  };
}
