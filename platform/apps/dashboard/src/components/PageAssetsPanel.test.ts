import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as PageAssetsModule from "./PageAssetsPanel.js";
import {
  PageAssetsPanel,
  assetIdentitySummary,
  displayRegionEvidenceSummary,
  loadPageAssetsSnapshot
} from "./PageAssetsPanel.js";

describe("PageAssetsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ graphs: [] })
      }))
    );
  });

  it("does not expose target-page execution helpers from the page asset library module", () => {
    expect(Object.keys(PageAssetsModule)).not.toEqual(
      expect.arrayContaining([
        "buildTargetPageGraphRunRequest",
        "buildTargetPageRuntimeOverlay",
        "selectPageAssetTarget",
        "parseRuntimeParams",
        "targetPageRouteBlockingMessage"
      ])
    );
  });

  it("renders the saved page asset library as the only page assets view", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [
              {
                id: "node-home",
                key: "classin.home",
                name: "主页",
                status: "active",
                tags: ["page-asset"],
                matcherCount: 3,
                criticalMatcherCount: 1,
                elementCount: 2,
                tasks: [
                  {
                    id: "task-create-lesson",
                    name: "创建课堂",
                    status: "active",
                    stepCount: 2,
                    parameterKeys: ["lessonName"]
                  }
                ],
                visibleTexts: ["主页"],
                resourceIds: [],
                accessibilityIds: []
              }
            ]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(markup).toContain("已保存页面资产");
    expect(markup).toContain("页面资产概览");
    expect(markup).toContain("主页");
    expect(markup).toContain("页面资产详情：主页");
    expect(markup).not.toContain("目标页面测试");
    expect(markup).not.toContain("目标动作");
    expect(markup).not.toContain("目标验证");
    expect(markup).not.toContain("执行组合（按需）");
    expect(markup).not.toContain("规划并执行");
    expect(markup).not.toContain("PageStateFlow");
    expect(markup).not.toContain("配置一个页面级测试任务");
    expect(markup).not.toContain("matcher 3");
  });

  it("renders matching saved assets without restoring target-page test controls", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [
              {
                id: "node-create-lesson",
                key: "classin.teacher.lesson.create",
                name: "新建课堂",
                status: "active",
                tags: ["page-asset"],
                matcherCount: 3,
                criticalMatcherCount: 1,
                elementCount: 4,
                visibleTexts: ["新建课堂"],
                resourceIds: [],
                accessibilityIds: []
              }
            ]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(markup).toContain("已保存页面资产");
    expect(markup).toContain("新建课堂");
    expect(markup).not.toContain("目标页面测试");
    expect(markup).not.toContain("规划并执行");
  });

  it("renders delete controls and expanded details for saved page assets", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [
              {
                id: "node-home",
                key: "classin.home",
                name: "主页",
                status: "active",
                tags: ["page-asset"],
                matcherCount: 3,
                criticalMatcherCount: 1,
                elementCount: 2,
                screenshotRegions: [
                  {
                    id: "region-title",
                    label: "标题栏",
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 12,
                    semanticArea: "top",
                    evidenceTexts: ["主页"]
                  }
                ],
                transitions: [
                  {
                    id: "edge-create",
                    key: "edge.create",
                    name: "主页 -> 新建课堂",
                    status: "ready",
                    source: "manual",
                    actionSummary: "点击 创建班级",
                    targetNodeId: "node-create",
                    targetName: "新建课堂",
                    reliabilityScore: 0.92
                  }
                ],
                tasks: [
                  {
                    id: "task-create-lesson",
                    name: "创建课堂",
                    status: "active",
                    stepCount: 2,
                    parameterKeys: ["lessonName"]
                  }
                ],
                identityTexts: ["主页"],
                visibleTexts: ["主页"],
                resourceIds: [],
                accessibilityIds: []
              }
            ]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(markup).toContain("主页");
    expect(markup).toContain("删除");
    expect(markup).toContain("详情");
    expect(markup).toContain("页面资产详情：主页");
    expect(markup).toContain("ClassIn Android 页面资产 · v1");
    expect(markup).toContain("标题栏");
    expect(markup).toContain("新建课堂");
    expect(markup).toContain("点击 创建班级");
    expect(markup).toContain("创建课堂");
    expect(markup).toContain("参数：lessonName");
    expect(markup).toContain("匹配依据");
    expect(markup).toContain("可操作");
    expect(markup).toContain("出口");
    expect(markup).toContain("任务");
    expect(markup).toContain("aria-label=\"删除页面资产：主页\"");
    expect(markup).not.toContain("PageStateLibrary");
    expect(markup).not.toContain("这里只展示经过资产录制确认保存");
    expect(markup).not.toContain("matcher 3");
    expect(markup).not.toContain("element 2");
    expect(markup).not.toContain("调试信息");
  });

  it("uses confirmed identity evidence instead of raw business visible texts in the library summary", () => {
    const asset = {
      id: "node-create-public-course",
      key: "runtime.unknown.1u41ebp",
      name: "新建公开课",
      status: "active",
      tags: ["page-asset"],
      matcherCount: 8,
      criticalMatcherCount: 4,
      elementCount: 2,
      identityTexts: ["新建公开课", "封面", "开始时间", "发布"],
      confirmedOcrTexts: ["ocr_text:新建公开课@region(28,7,18,5)", "发布"],
      visibleTexts: ["组织", "EEO-TEST-霍昌峰 EEO-TEST-霍昌峰", "嚯嚯嚯666的公开课"],
      resourceIds: [],
      accessibilityIds: []
    };
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [asset]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(assetIdentitySummary(asset)).toBe("新建公开课 · 封面 · 开始时间 · 发布");
    expect(markup).toContain("新建公开课 · 封面 · 开始时间 · 发布");
    expect(markup).not.toContain("EEO-TEST-霍昌峰");
    expect(markup).not.toContain("嚯嚯嚯666的公开课");
  });

  it("hides platform-specific screenshot evidence from normal page asset identity", () => {
    const asset = {
      id: "node-home",
      key: "classin.teacher.classes",
      name: "主页",
      status: "active",
      tags: ["page-asset"],
      matcherCount: 4,
      criticalMatcherCount: 2,
      elementCount: 3,
      confirmedUiTexts: ["我是教师"],
      confirmedOcrTexts: ["ocr_text:主页@region(5,7,12,5)"],
      screenshotRegions: [
        {
          id: "region-title",
          label: "标题栏",
          x: 0,
          y: 0,
          width: 100,
          height: 12,
          semanticArea: "top",
          evidenceTexts: ["主页", "user avatar", "contact", "search", "cn.eeo.classin:id/create_title", "icon"]
        },
        {
          id: "region-bottom",
          label: "底部导航",
          x: 0,
          y: 88,
          width: 100,
          height: 12,
          semanticArea: "bottom",
          evidenceTexts: ["cn.eeo.classin:id/fixed_bottom_navigation_container"]
        }
      ],
      visibleTexts: ["主页"],
      resourceIds: ["cn.eeo.classin:id/create_title"],
      accessibilityIds: ["user avatar"]
    };
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [asset]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(assetIdentitySummary(asset)).toBe("主页 · 标题栏 · 底部导航");
    expect(markup).toContain("主页 · 标题栏 · 底部导航");
    expect(markup).not.toContain("我是教师 ·");
    expect(markup).not.toContain("user avatar");
    expect(markup).not.toContain("contact");
    expect(markup).not.toContain("search");
    expect(markup).not.toContain("cn.eeo.classin:id/create_title");
    expect(markup).not.toContain("cn.eeo.classin:id/fixed_bottom_navigation_container");
  });

  it("summarizes screenshot region evidence without leaking platform internals", () => {
    expect(displayRegionEvidenceSummary(["新建公开课", "cn.eeo.classin:id/create_title", "close", "user avatar", "icon"])).toBe("新建公开课");
    expect(displayRegionEvidenceSummary(["cn.eeo.classin:id/scrollView", "icon"])).toBeUndefined();
  });

  it("loads saved assets from the latest active graph version instead of keeping stale versions", async () => {
    const requestedUrls: string[] = [];
    const snapshot = await loadPageAssetsSnapshot(async <T,>(url: RequestInfo | URL): Promise<T> => {
      const requestUrl = String(url);
      requestedUrls.push(requestUrl);
      if (requestUrl === "/api/graphs") {
        return {
          graphs: [
            {
              id: "graph-1",
              appId: "classin-android",
              name: "ClassIn Android 页面资产",
              status: "active",
              activeVersion: { id: "version-new", version: 4 }
            }
          ]
        } as T;
      }
      if (requestUrl === "/api/graphs/version-new/assets?limit=120") {
        return {
          assets: {
            graphVersionId: "version-new",
            pageAssets: [
              {
                id: "node-home",
                key: "classin.teacher.classes",
                name: "主页",
                status: "active",
                tags: ["page-asset"],
                matcherCount: 4,
                criticalMatcherCount: 2,
                elementCount: 3,
                visibleTexts: ["主页"],
                resourceIds: [],
                accessibilityIds: []
              }
            ]
          }
        } as T;
      }
      throw new Error(`unexpected url ${requestUrl}`);
    });

    expect(requestedUrls).toEqual(["/api/graphs", "/api/graphs/version-new/assets?limit=120"]);
    expect(snapshot.graphs.map((graph) => graph.activeVersion?.id)).toEqual(["version-new"]);
    expect(Object.keys(snapshot.assetsByVersionId)).toEqual(["version-new"]);
    expect(snapshot.assetsByVersionId["version-new"]?.pageAssets.map((asset) => asset.name)).toEqual(["主页"]);
  });

  it("shows page task parameters in saved asset details instead of exposing target execution inputs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        graphs: [
          {
            id: "graph-1",
            appId: "classin-android",
            name: "ClassIn Android 页面资产",
            status: "active",
            activeVersion: { id: "version-1", version: 1 }
          }
        ],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            pageAssets: [
              {
                id: "node-create-lesson",
                key: "classin.teacher.lesson.create",
                name: "新建课堂",
                status: "active",
                tags: ["page-asset"],
                matcherCount: 3,
                criticalMatcherCount: 1,
                elementCount: 4,
                tasks: [
                  {
                    id: "task-fill-lesson-form",
                    name: "填写课堂表单",
                    status: "active",
                    stepCount: 4,
                    parameterKeys: ["lessonName", "duration", "recordClassroom", "recordLive"]
                  }
                ],
                visibleTexts: ["新建课堂"],
                resourceIds: [],
                accessibilityIds: []
              }
            ]
          }
        },
        onOpenAssetRecording: () => undefined,
        setMessage: () => undefined
      })
    );

    expect(markup).toContain("页面任务");
    expect(markup).toContain("填写课堂表单");
    expect(markup).toContain("参数：lessonName、duration、recordClassroom、recordLive");
    expect(markup).not.toContain("执行组合（按需）");
    expect(markup).not.toContain("目标页面测试");
    expect(markup).not.toContain("name=\"runtime-param-lessonName\"");
    expect(markup).not.toContain("目标项 / 班级名");
  });

});
