import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  PageAssetsPanel,
  assetIdentitySummary,
  displayRegionEvidenceSummary,
  loadPageAssetsSnapshot,
  platformLabel
} from "./PageAssetsPanel.js";

const library = {
  id: "graph-1",
  appId: "cn.eeo.classin",
  name: "ClassIn",
  status: "active",
  activeVersion: { id: "version-1", version: 1 }
};

const asset = {
  id: "page-home",
  key: "classin.home",
  name: "主页",
  status: "active",
  tags: [],
  matcherCount: 3,
  criticalMatcherCount: 1,
  visibleTexts: ["主页", "消息"],
  resourceIds: [],
  accessibilityIds: [],
  confirmedOcrTexts: ["主页"],
  screenshotRegions: [{
    id: "title",
    label: "标题",
    x: 10,
    y: 2,
    width: 30,
    height: 8,
    semanticArea: "top",
    evidenceTexts: ["主页"]
  }]
};

describe("PageAssetsPanel", () => {
  it("renders page identity information only", () => {
    const markup = renderToStaticMarkup(React.createElement(PageAssetsPanel, {
      libraries: [library],
      assetsByVersionId: {
        "version-1": { graphVersionId: "version-1", pageAssets: [asset] }
      },
      onOpenAssetRecording: vi.fn(),
      setMessage: vi.fn()
    }));

    expect(markup).toContain("已保存页面资产");
    expect(markup).toContain("页面身份");
    expect(markup).not.toContain("公共定位器");
    expect(markup).not.toContain("页面任务");
    expect(markup).not.toContain("连接边");
  });

  it("summarizes confirmed identity evidence", () => {
    expect(assetIdentitySummary(asset)).toContain("主页");
  });

  it("removes region encoding from evidence text", () => {
    expect(displayRegionEvidenceSummary(["ocr_text:主页@region(10,2,30,8)"])).toBe("主页");
  });

  it("labels HarmonyOS page asset scopes", () => {
    expect(platformLabel("harmony")).toBe("HarmonyOS");
    expect(platformLabel("mobile-both")).toBe("Android / iOS / HarmonyOS");
  });

  it("loads assets from the active page asset library", async () => {
    const fetchJson = vi.fn(async (url: string) => {
      if (url === "/api/page-assets") {
        return { libraries: [library, { ...library, id: "old", status: "deprecated" }] };
      }
      return { assets: { graphVersionId: "version-1", pageAssets: [asset] } };
    });

    const snapshot = await loadPageAssetsSnapshot(fetchJson as never);
    expect(snapshot.libraries).toHaveLength(1);
    expect(snapshot.assetsByVersionId["version-1"]?.pageAssets).toHaveLength(1);
  });
});
