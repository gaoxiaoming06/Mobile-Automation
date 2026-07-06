import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PageAssetsPanel,
  assetIdentitySummary,
  buildTargetPageGraphRunRequest,
  buildTargetPageRuntimeOverlay,
  displayRegionEvidenceSummary,
  loadPageAssetsSnapshot,
  parseRuntimeParams,
  selectPageAssetTarget,
  targetPageRouteBlockingMessage
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

  it("renders target testing as a task form instead of an asset list", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
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

    expect(markup).toContain("目标页面测试");
    expect(markup).toContain("已保存页面资产");
    expect(markup).toContain("目标页面");
    expect(markup).toContain("目标动作");
    expect(markup).toContain("目标验证");
    expect(markup).toContain("目标参数");
    expect(markup).toContain("页面到达后不执行动作");
    expect(markup).toContain("仅验证已到达目标页面");
    expect(markup).not.toContain("PageStateFlow");
    expect(markup).not.toContain("配置一个页面级测试任务");
    expect(markup).not.toContain("删除页面资产：主页");
    expect(markup).not.toContain("matcher 3");
  });

  it("renders delete controls for saved page assets", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        initialTab: "library",
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
    expect(markup).not.toContain("<code>classin.home</code>");
    expect(markup).not.toContain("<span>active</span>");
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
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        initialTab: "library",
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
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        initialTab: "library",
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

  it("selects the matching saved page asset as the graph run target", () => {
    const target = selectPageAssetTarget(
      [
        {
          id: "node-home",
          key: "classin.teacher.classes",
          name: "主页",
          status: "active",
          tags: ["page-asset"],
          matcherCount: 7,
          criticalMatcherCount: 3,
          elementCount: 7,
          visibleTexts: ["主页", "创建公开课"],
          resourceIds: [],
          accessibilityIds: [],
          graphVersionId: "version-1"
        },
        {
          id: "node-create-public-course",
          key: "runtime.unknown.1u41ebp",
          name: "新建公开课",
          status: "active",
          tags: ["page-asset"],
          matcherCount: 12,
          criticalMatcherCount: 6,
          elementCount: 5,
          visibleTexts: ["新建公开课", "课堂信息"],
          resourceIds: [],
          accessibilityIds: [],
          graphVersionId: "version-1"
        }
      ],
      "新建公开课"
    );

    expect(target).toEqual(expect.objectContaining({ id: "node-create-public-course", graphVersionId: "version-1" }));
  });

  it("does not select a graph run target before the user enters a query", () => {
    const target = selectPageAssetTarget(
      [
        {
          id: "node-home",
          key: "classin.teacher.classes",
          name: "主页",
          status: "active",
          tags: ["page-asset"],
          matcherCount: 7,
          criticalMatcherCount: 3,
          elementCount: 7,
          visibleTexts: ["主页"],
          resourceIds: [],
          accessibilityIds: [],
          graphVersionId: "version-1"
        }
      ],
      ""
    );

    expect(target).toBeUndefined();
  });

  it("explains route gaps before starting target page execution", () => {
    expect(
      targetPageRouteBlockingMessage(
        {
          executionPlan: {
            unresolvedIssues: [
              {
                code: "TARGET_NODE_UNREACHABLE",
                severity: "error",
                message: "Target node node-create is unreachable from node-home."
              }
            ]
          },
          startDetection: {
            nodeMatch: {
              node: {
                name: "主页"
              }
            }
          }
        },
        "新建公开课"
      )
    ).toBe("已找到目标页面：新建公开课，但当前识别到的页面“主页”还没有到该目标的已保存连接边。请先在资产录制里把当前页的可操作元素连接到目标页面。");
  });

  it("does not block target execution when the route preview recovered from a transient page", () => {
    expect(
      targetPageRouteBlockingMessage(
        {
          executionPlan: {
            unresolvedIssues: []
          },
          startRecovery: {
            status: "recovered",
            fromNodeName: "搜索",
            recoveredNodeName: "主页"
          }
        },
        "新建课堂"
      )
    ).toBeUndefined();
  });

  it("starts target page execution against the asset graph version instead of resolving by graph id", () => {
    expect(
      buildTargetPageGraphRunRequest({
        selectedSerial: "device-1",
        graphVersionId: "version-asset",
        targetNodeId: "node-create",
        startNodeId: "node-home"
      })
    ).toEqual({
      deviceSerial: "device-1",
      graphVersionId: "version-asset",
      targetNodeId: "node-create",
      startStrategy: "keep_current",
      startNodeId: "node-home",
      startAppScope: "current_device",
      overlay: undefined,
      executionProfile: "fast_visual"
    });
  });

  it("builds runtime overlay for target text verification without saving it to page assets", () => {
    expect(
      buildTargetPageRuntimeOverlay({
        targetNodeId: "node-create",
        targetName: "新建公开课",
        actionMode: "none",
        verificationMode: "text_contains",
        verificationText: "发布成功"
      })
    ).toEqual({
      id: "target-task-node-create",
      targetNodeId: "node-create",
      note: "目标页面测试：新建公开课",
      nodeExpectationOverrides: [
        {
          nodeId: "node-create",
          expectations: [
            expect.objectContaining({
              id: "target-text-node-create",
              type: "text",
              enabled: true,
              title: "目标验证",
              params: {
                expected: "发布成功",
                mode: "contains",
                lang: "eng+chi_sim"
              }
            })
          ]
        }
      ]
    });
  });

  it("builds runtime params overlay for parameterized target execution", () => {
    expect(parseRuntimeParams("className=班级四十一号, lessonName=数学课")).toEqual({
      className: "班级四十一号",
      lessonName: "数学课"
    });
    expect(parseRuntimeParams("班级四十二号")).toEqual({
      className: "班级四十二号"
    });

    expect(
      buildTargetPageRuntimeOverlay({
        targetNodeId: "node-create",
        targetName: "新建课堂",
        actionMode: "page_task",
        targetTaskId: "task-create-lesson",
        verificationMode: "arrived",
        runtimeParamsText: "lessonName=数学课"
      })
    ).toEqual({
      id: "target-task-node-create",
      targetNodeId: "node-create",
      targetTaskId: "task-create-lesson",
      note: "目标页面测试：新建课堂",
      runtimeParams: {
        lessonName: "数学课"
      }
    });
  });

  it("renders selected page task parameters as dedicated runtime inputs", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PageAssetsPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        initialTargetText: "新建课堂",
        initialTargetTaskId: "task-fill-lesson-form",
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

    expect(markup).toContain("运行参数（可选）");
    expect(markup).toContain("name=\"runtime-param-lessonName\"");
    expect(markup).toContain("name=\"runtime-param-duration\"");
    expect(markup).toContain("name=\"runtime-param-recordClassroom\"");
    expect(markup).toContain("name=\"runtime-param-recordLive\"");
    expect(markup).toContain("例如：自动化课堂测试");
    expect(markup).toContain("例如：45分钟");
    expect(markup).not.toContain("目标项 / 班级名");
  });

  it("keeps page task runtime params optional and only sends filled overrides", () => {
    expect(
      buildTargetPageRuntimeOverlay({
        targetNodeId: "node-create",
        targetName: "新建课堂",
        actionMode: "page_task",
        targetTaskId: "task-fill-lesson-form",
        verificationMode: "arrived",
        runtimeParams: {
          lessonName: "自动化课堂",
          duration: "",
          recordClassroom: " "
        }
      })
    ).toEqual({
      id: "target-task-node-create",
      targetNodeId: "node-create",
      targetTaskId: "task-fill-lesson-form",
      note: "目标页面测试：新建课堂",
      runtimeParams: {
        lessonName: "自动化课堂"
      }
    });
  });

  it("merges route runtime params into page task runtime params", () => {
    expect(
      buildTargetPageRuntimeOverlay({
        targetNodeId: "node-create",
        targetName: "新建课堂",
        actionMode: "page_task",
        targetTaskId: "task-fill-lesson-form",
        verificationMode: "arrived",
        runtimeParams: {
          lessonName: "自动化课堂"
        },
        runtimeParamsText: "className=班级四十二号"
      })
    ).toEqual({
      id: "target-task-node-create",
      targetNodeId: "node-create",
      targetTaskId: "task-fill-lesson-form",
      note: "目标页面测试：新建课堂",
      runtimeParams: {
        lessonName: "自动化课堂",
        className: "班级四十二号"
      }
    });
  });
});
