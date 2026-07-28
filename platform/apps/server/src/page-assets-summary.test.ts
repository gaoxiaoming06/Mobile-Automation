import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import { buildPageAssetLibrarySummary } from "./page-assets-summary.js";

describe("buildPageAssetLibrarySummary", () => {
  it("returns only confirmed page identity and locator counts", () => {
    const summary = buildPageAssetLibrarySummary(graph([
      page("home", "主页", {
        assetRecordingConfirmed: true,
        confirmedOcrTexts: ["全部班级"],
        assetRecordingManualElements: [{ id: "search" }]
      }),
      page("draft", "草稿页", {})
    ]));

    expect(summary).toEqual({
      graphVersionId: "version-1",
      pageAssets: [expect.objectContaining({
        id: "home",
        name: "主页",
        elementCount: 1,
        identityTexts: expect.arrayContaining(["全部班级"])
      })]
    });
    expect(summary).not.toHaveProperty("runtimeDraftNodes");
    expect(summary).not.toHaveProperty("explorationDraftEdges");
  });
});

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    createdAt: "2026-07-28T00:00:00.000Z"
  };
}

function page(id: string, name: string, metadata: Record<string, unknown>): BusinessNode {
  return {
    id,
    graphVersionId: "version-1",
    key: `classin.${id}`,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [{
      id: `${id}-text`,
      type: "ocr_text",
      value: name,
      weight: 3,
      critical: true,
      platformScope: "mobile-both"
    }],
    defaultExpectations: [],
    platformScope: "mobile-both",
    metadata
  };
}
