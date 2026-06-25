import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  actionStrategyForWorkspace,
  assetConnectionEdgeMessage,
  assetPageElementRequestBody,
  assetPageTaskRequestBody,
  assetRecordingIdentificationStateAfter,
  assetOperationTransitionRequestBody,
  currentPageAssetErrorMessage,
  mapCurrentPageAssetResponse,
  pageAssetMessage,
  previewWorkspaceKey,
  validateAssetPageElementDraftForSave,
  workspaceStyleForNav
} from "./App.js";

describe("App shell", () => {
  it("includes the asset recording navigation entry and keeps existing recording modules", () => {
    const markup = renderToStaticMarkup(React.createElement(App));

    expect(markup).toContain("用例录制");
    expect(markup).toContain("用例库");
    expect(markup).toContain("资产录制");
    expect(markup).toContain("页面资产库");
  });

  it("uses different preview workspaces for case recording and asset recording", () => {
    expect(previewWorkspaceKey("recording")).toBe("recording");
    expect(previewWorkspaceKey("assetRecording")).toBe("assetRecording");
    expect(previewWorkspaceKey("caseLibrary")).toBe("inactive");
  });

  it("exposes independent resizable preview width variables for recording and asset recording", () => {
    expect(workspaceStyleForNav("recording", 560, 520)).toEqual({
      "--recording-preview-width": "560px"
    });
    expect(workspaceStyleForNav("assetRecording", 560, 520)).toEqual({
      "--asset-recording-preview-width": "520px"
    });
    expect(workspaceStyleForNav("caseLibrary", 560, 520)).toEqual({});
  });

  it("keeps asset recording device actions immediate and blocks only while identifying", () => {
    expect(actionStrategyForWorkspace("assetRecording", { identifying: false, recording: false })).toEqual({
      useCachedSemanticTarget: true,
      resolveLiveLocatorBeforeAction: false,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: false
    });
    expect(actionStrategyForWorkspace("assetRecording", { identifying: true, recording: false })).toEqual({
      useCachedSemanticTarget: false,
      resolveLiveLocatorBeforeAction: false,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: true
    });
    expect(actionStrategyForWorkspace("recording", { identifying: false, recording: true })).toEqual({
      useCachedSemanticTarget: true,
      resolveLiveLocatorBeforeAction: true,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: false
    });
  });

  it("keeps asset recording recognition blocked until overlapping recognition tasks finish", () => {
    const first = assetRecordingIdentificationStateAfter(0, "begin");
    const second = assetRecordingIdentificationStateAfter(first.inFlightCount, "begin");
    const afterOneFinished = assetRecordingIdentificationStateAfter(second.inFlightCount, "end");
    const afterBothFinished = assetRecordingIdentificationStateAfter(afterOneFinished.inFlightCount, "end");
    const afterExtraEnd = assetRecordingIdentificationStateAfter(afterBothFinished.inFlightCount, "end");

    expect(first).toEqual({ inFlightCount: 1, identifying: true });
    expect(second).toEqual({ inFlightCount: 2, identifying: true });
    expect(afterOneFinished).toEqual({ inFlightCount: 1, identifying: true });
    expect(afterBothFinished).toEqual({ inFlightCount: 0, identifying: false });
    expect(afterExtraEnd).toEqual({ inFlightCount: 0, identifying: false });
  });

  it("uses connection-edge wording for asset recording transition messages", () => {
    expect(assetConnectionEdgeMessage("missing_source")).toBe("当前页面还没有保存为页面资产，请先保存页面后再确认连接边");
    expect(assetConnectionEdgeMessage("confirm_failed")).toBe("连接边确认失败");
    expect(assetConnectionEdgeMessage("confirmed", "主页 -> 班级详情")).toBe("已确认连接边：主页 -> 班级详情");
    expect(assetConnectionEdgeMessage("delete_failed")).toBe("删除连接边失败");
    expect(assetConnectionEdgeMessage("deleted", "主页 -> 班级详情")).toBe("已删除连接边：主页 -> 班级详情");
  });

  it("sends runtime OCR target text when saving page abilities and connection edges", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-class-detail",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:6,47.8,88,8.8",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          outcomeType: "navigate",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        },
        { sourceNodeId: "node-class-detail", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );

    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-class-detail",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          locator: "image-region:6,47.8,88,8.8",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        },
        { sourceNodeId: "node-class-detail", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );
  });

  it("turns empty current-page API responses into a readable service error", async () => {
    const message = await currentPageAssetErrorMessage(
      new Response("", {
        status: 500,
        statusText: "Internal Server Error"
      })
    );

    expect(message).toBe("Internal Server Error");
  });

  it("uses the saved page asset name before visual title candidates when mapping current page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "我改过的主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "主页", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.pageName).toBe("我改过的主页");
    expect(page.visualPageName).toBe("主页");
    expect(page.matchedAssetName).toBeUndefined();
  });

  it("preserves screenshot focus ignore regions when mapping page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: {
                assetRecordingConfirmed: true,
                screenshotRegions: [
                  {
                    id: "region-main",
                    label: "主页稳定区域",
                    x: 8,
                    y: 12,
                    width: 84,
                    height: 58,
                    ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "主页", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.screenshotRegions).toEqual([
      {
        id: "region-main",
        label: "主页稳定区域",
        x: 8,
        y: 12,
        width: 84,
        height: 58,
        ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
      }
    ]);
  });

  it("uses the observation screenshot frame for asset recording region editing", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.3,
            candidates: []
          },
          observation: {
            id: "obs-1",
            deviceSerial: "device-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [],
            ocrTexts: [],
            raw: {
              screenshotBase64: "frame-from-current-page-observation"
            }
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.screenshotUrl).toBe("data:image/png;base64,frame-from-current-page-observation");
  });

  it("maps OCR text candidates with their relative screen region", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.3,
            candidates: []
          },
          observation: {
            id: "obs-todo",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [],
            ocrTexts: [
              {
                text: "待办",
                confidence: 0.96,
                region: { x: 164, y: 173, width: 198, height: 138 },
                source: "ocr"
              }
            ]
          },
          visualPageName: "待办"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.ocrTexts).toEqual(["ocr_text:待办@region(15.19,7.39,18.33,5.9)"]);
  });

  it("keeps popup menus as page-local transition context instead of page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.38,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, pageName: "主页" }
                },
                score: 0.82,
                matcherResults: [
                  { type: "text", expected: "主页", actual: "主页", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-menu",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "主页", visible: true, enabled: true, bounds: { x: 220, y: 250, width: 140, height: 48 } },
              { text: "添加好友", visible: true, enabled: true, bounds: { x: 690, y: 520, width: 160, height: 48 } },
              { text: "加入班级", visible: true, enabled: true, bounds: { x: 690, y: 610, width: 160, height: 48 } },
              { text: "加入公开课", visible: true, enabled: true, bounds: { x: 690, y: 700, width: 180, height: 48 } },
              { text: "扫一扫", visible: true, enabled: true, bounds: { x: 690, y: 790, width: 130, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "添加好友"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("添加好友");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps a high-scoring draft candidate unsaved when backend did not accept the page match", () => {
    const response = {
      result: {
        status: "draft_candidate" as const,
        match: {
          status: "unknown",
          score: 0.58,
          candidates: [
            {
              node: {
                id: "node-create-public-course",
                key: "classin.course.public.create",
                name: "新建公开课",
                nodeType: "page",
                tags: ["page-asset", "asset-recording"],
                metadata: {
                  assetRecordingConfirmed: true,
                  assetKind: "page",
                  pageName: "新建公开课"
                }
              },
              score: 0.82,
              matcherResults: [
                { type: "text", expected: "新建公开课", actual: "新建公开课", matched: true }
              ]
            }
          ]
        },
        node: {
          id: "runtime-unknown-create-public-course",
          key: "runtime.unknown.create_public_course",
          name: "运行期未知节点：新建公开课",
          metadata: {}
        },
        observation: {
          id: "obs-create-public-course",
          platform: "android" as const,
          capturedAt: "2026-06-18T10:00:00.000Z",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          resolution: { width: 1080, height: 2340 },
          uiElements: [
            { text: "新建公开课", visible: true, enabled: true, bounds: { x: 160, y: 140, width: 220, height: 52 } },
            { text: "封面", visible: true, enabled: true, bounds: { x: 90, y: 480, width: 120, height: 48 } },
            { text: "开始时间", visible: true, enabled: true, bounds: { x: 90, y: 680, width: 160, height: 48 } },
            { text: "课堂时长", visible: true, enabled: true, bounds: { x: 90, y: 850, width: 160, height: 48 } },
            { text: "课堂信息", visible: true, enabled: true, bounds: { x: 90, y: 1030, width: 180, height: 48 } },
            { text: "发布", visible: true, enabled: true, bounds: { x: 450, y: 2190, width: 160, height: 56 } }
          ],
          ocrTexts: []
        },
        visualPageName: "新建公开课"
      },
      assets: { pageAssets: [] }
    };

    const page = mapCurrentPageAssetResponse(response, "version-1");

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("新建公开课");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
    expect(pageAssetMessage(response, page)).toBe("已识别待保存页面：新建公开课");
  });

  it("maps PageMatcher diagnostics before legacy candidate matcher results", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          matcherDiagnostics: {
            status: "unknown",
            topCandidate: {
              nodeId: "node-home",
              key: "classin.home",
              name: "主页",
              score: 0.42
            },
            matchedEvidence: [{ type: "package", expected: "cn.eeo.classin", matched: true }],
            missingEvidence: [
              { type: "text", expected: "主页", matched: false },
              { type: "ocr_text", expected: "我是教师", matched: false }
            ]
          },
          match: {
            status: "unknown",
            score: 0.42,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页"
                },
                score: 0.82,
                matcherResults: [{ type: "text", expected: "错误旧候选", actual: "错误旧候选", matched: true }]
              }
            ]
          },
          node: {
            id: "runtime-unknown-home",
            key: "runtime.unknown.home",
            name: "主页",
            metadata: {}
          },
          observation: {
            id: "obs-home",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [{ text: "消息", visible: true, enabled: true }],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.matchedMatchers).toEqual(["package:cn.eeo.classin"]);
    expect(page.missedMatchers).toEqual(["text:主页", "ocr_text:我是教师"]);
    expect(page.matchedMatchers).not.toContain("text:错误旧候选");
  });

  it("keeps bottom sheets as page-local transition context instead of page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.44,
            candidates: [
              {
                node: {
                  id: "node-create-public-course",
                  key: "classin.course.public.create",
                  name: "新建公开课",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, assetKind: "page", pageName: "新建公开课" }
                },
                score: 0.78,
                matcherResults: [
                  { type: "text", expected: "新建公开课", actual: "新建公开课", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-choose-org",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "新建公开课", visible: true, enabled: true, bounds: { x: 160, y: 140, width: 220, height: 52 } },
              { text: "课堂信息", visible: true, enabled: true, bounds: { x: 90, y: 1030, width: 180, height: 48 } },
              { text: "选择组织", visible: true, enabled: true, bounds: { x: 90, y: 1220, width: 180, height: 56 } },
              { text: "EEO-TEST-霍昌峰", visible: true, enabled: true, bounds: { x: 300, y: 1540, width: 480, height: 56 } },
              { text: "取消", visible: true, enabled: true, bounds: { x: 820, y: 2220, width: 90, height: 48 } },
              { text: "确定", visible: true, enabled: true, bounds: { x: 950, y: 2220, width: 90, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "选择组织"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("选择组织");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps dynamic home banners as the parent page instead of creating an overlay", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.5,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, assetKind: "page", pageName: "主页" }
                },
                score: 0.8,
                matcherResults: [
                  { type: "text", expected: "主页", actual: "主页", matched: true },
                  { type: "text", expected: "我是教师", actual: "我是教师", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-home-with-active-class",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "主页", visible: true, enabled: true, bounds: { x: 450, y: 160, width: 180, height: 54 } },
              { text: "我是教师", visible: true, enabled: true, bounds: { x: 80, y: 360, width: 180, height: 52 } },
              { text: "班级四十一号", visible: true, enabled: true, bounds: { x: 120, y: 1560, width: 360, height: 54 } },
              { text: "进入课堂", visible: true, enabled: true, bounds: { x: 760, y: 1560, width: 180, height: 54 } },
              { text: "消息", visible: true, enabled: true, bounds: { x: 260, y: 2200, width: 100, height: 48 } },
              { text: "我的", visible: true, enabled: true, bounds: { x: 820, y: 2200, width: 100, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("主页");
    expect(page.assetKind).toBe("page");
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps an unknown draft as a page when the nearest candidate is not a confirmed page asset", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.2,
            candidates: [
              {
                node: {
                  id: "node-runtime",
                  key: "runtime.unknown.1",
                  name: "未知页面",
                  metadata: {}
                },
                score: 0.86,
                matcherResults: []
              }
            ]
          },
          observation: {
            id: "obs-new-page",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "新页面标题", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "新页面标题"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("removes internal runtime unknown prefixes from draft page names", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0,
            candidates: []
          },
          node: {
            id: "runtime-message",
            key: "runtime.unknown.message",
            name: "运行期未知节点：消息",
            metadata: {}
          },
          observation: {
            id: "obs-message",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "消息", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "消息"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.pageName).toBe("消息");
    expect(page.matchedAssetName).toBeUndefined();
    expect(pageAssetMessage({ result: { status: "draft_candidate", match: { status: "unknown", score: 0, candidates: [] } } }, page)).toBe("已识别待保存页面：消息");
  });

  it("keeps page ability type and candidate layout in the page element request", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-home",
          abilityType: "grid_candidate",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:3,32,91,56",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "打开班级详情",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "nth_item",
            afterFoundAction: "tap_item",
            candidateItemHeightPercent: 24.5,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            scrollStepPercent: 65,
            failureStrategy: "try_next_candidate"
          }
        },
        { sourceNodeId: "node-home", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        semanticArea: "content",
        coordinateSpace: "screen",
        scrollProfile: expect.objectContaining({
          containerKind: "grid_list",
          candidateItemHeightPercent: 24.5,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          failureStrategy: "try_next_candidate"
        })
      })
    );
  });

  it("keeps page task drafts in a stable asset request body", () => {
    expect(
      assetPageTaskRequestBody(
        {
          sourceNodeId: "node-create-lesson",
          taskId: "task-create-lesson",
          name: "创建课堂",
          status: "active",
          steps: [
            {
              id: "step-title",
              order: 1,
              elementId: "manual-title",
              fieldType: "text_input",
              label: "课堂标题",
              valueParamKey: "lessonName"
            },
            {
              order: 2,
              elementId: "manual-submit",
              fieldType: "submit",
              label: "发布"
            }
          ]
        },
        { sourceNodeId: "node-create-lesson" }
      )
    ).toEqual({
      sourceNodeId: "node-create-lesson",
      taskId: "task-create-lesson",
      name: "创建课堂",
      status: "active",
      steps: [
        {
          id: "step-title",
          order: 1,
          elementId: "manual-title",
          fieldType: "text_input",
          label: "课堂标题",
          valueParamKey: "lessonName"
        },
        {
          order: 2,
          elementId: "manual-submit",
          fieldType: "submit",
          label: "发布"
        }
      ]
    });
  });

  it("maps observation UI elements into page operation candidate categories", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-actions",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              {
                text: "发布活动",
                resourceId: "cn.eeo.classin:id/publish_activity",
                visible: true,
                enabled: true,
                clickable: true,
                bounds: { x: 810, y: 1890, width: 180, height: 120 }
              },
              {
                resourceId: "cn.eeo.classin:id/class_list",
                className: "androidx.recyclerview.widget.RecyclerView",
                visible: true,
                enabled: true,
                scrollable: true
              },
              {
                text: "更多班级",
                visible: true,
                enabled: true,
                clickable: false
              }
            ],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        label: "发布活动",
        locator: "resource-id: cn.eeo.classin:id/publish_activity",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        region: { x: 75, y: 87.5, width: 16.67, height: 5.56 },
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 }
      },
      {
        label: "cn.eeo.classin:id/class_list",
        locator: "resource-id: cn.eeo.classin:id/class_list",
        action: "scroll",
        actionKind: "scroll",
        availability: "visible",
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 },
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          afterFoundAction: "tap_item"
        }
      },
      {
        label: "更多班级",
        locator: "text: 更多班级",
        action: "tap",
        actionKind: "tap",
        availability: "conditional",
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 }
      }
    ]);
  });

  it("infers a scrollable grid region from repeated card-like elements even without native scrollable flag", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-inferred-scroll",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              { text: "班级四十一号!", visible: true, enabled: true, clickable: false, bounds: { x: 95, y: 1014, width: 386, height: 58 } },
              { text: "班级四十二号", visible: true, enabled: true, clickable: false, bounds: { x: 565, y: 1014, width: 386, height: 58 } },
              { text: "开放加入2", visible: true, enabled: true, clickable: false, bounds: { x: 95, y: 1420, width: 386, height: 58 } }
            ],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "推断滚动区域：班级列表",
          locator: "inferred-scroll-region: class-card-grid",
          action: "scroll",
          actionKind: "scroll",
          availability: "visible",
          region: { x: 8.8, y: 46.94, width: 79.26, height: 21.48 },
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            afterFoundAction: "tap_item"
          }
        })
      ])
    );
  });

  it("does not expose class-only clickable views as stable operation candidates", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-class-only",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              {
                className: "android.view.View",
                visible: true,
                enabled: true,
                clickable: true
              },
              {
                text: "创建公开课",
                className: "android.widget.TextView",
                visible: true,
                enabled: true,
                clickable: true
              }
            ],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        label: "创建公开课",
        locator: "text: 创建公开课",
        action: "tap",
        actionKind: "tap",
        availability: "visible"
      }
    ]);
  });

  it("maps persisted manual page elements back into operation candidates", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "manual_element_search",
                    label: "搜索按钮",
                    locator: "image-region:12.5,8.25,20,6",
                    semanticArea: "top",
                    coordinateSpace: "screen",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 12.5, y: 8.25, width: 20, height: 6 },
                    targetNodeId: "node-search",
                    targetLabel: "搜索页",
                    outcomeType: "navigate",
                    platformScope: "android"
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-home",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        id: "manual_element_search",
        label: "搜索按钮",
        locator: "image-region:12.5,8.25,20,6",
        semanticArea: "top",
        coordinateSpace: "screen",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        source: "manual",
        region: { x: 12.5, y: 8.25, width: 20, height: 6 },
        viewport: { width: 1080, height: 2160 },
        outcomeType: "navigate",
        outcomeLabel: "搜索页",
        targetNodeId: "node-search",
        targetLabel: "搜索页"
      }
    ]);
  });

  it("maps persisted page tasks from page metadata into current page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-create-lesson",
              key: "classin.lesson.create",
              name: "新建课堂",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "manual-title",
                    label: "课堂标题输入框",
                    locator: "image-region:8,24,84,8",
                    actionKind: "input",
                    availability: "visible",
                    region: { x: 8, y: 24, width: 84, height: 8 }
                  },
                  {
                    id: "manual-submit",
                    label: "发布按钮",
                    locator: "image-region:78,91,16,6",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 78, y: 91, width: 16, height: 6 }
                  }
                ],
                assetRecordingPageTasks: [
                  {
                    id: "task-create-lesson",
                    name: "创建课堂",
                    status: "active",
                    steps: [
                      {
                        id: "step-title",
                        order: 2,
                        elementId: "manual-title",
                        fieldType: "text_input",
                        label: "课堂标题",
                        valueParamKey: "lessonName"
                      },
                      {
                        id: "step-submit",
                        order: 3,
                        elementId: "manual-submit",
                        fieldType: "submit",
                        label: "发布"
                      },
                      {
                        id: "step-wait",
                        order: 1,
                        fieldType: "wait",
                        label: "等待表单就绪",
                        text: "新建课堂"
                      }
                    ]
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-create-lesson",
            platform: "android",
            capturedAt: "2026-06-23T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2160 },
            uiElements: [],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.tasks).toEqual([
      {
        id: "task-create-lesson",
        name: "创建课堂",
        status: "active",
        steps: [
          {
            id: "step-wait",
            order: 1,
            fieldType: "wait",
            label: "等待表单就绪",
            text: "新建课堂"
          },
          {
            id: "step-title",
            order: 2,
            elementId: "manual-title",
            fieldType: "text_input",
            label: "课堂标题",
            valueParamKey: "lessonName"
          },
          {
            id: "step-submit",
            order: 3,
            elementId: "manual-submit",
            fieldType: "submit",
            label: "发布"
          }
        ]
      }
    ]);
  });

  it("includes outcome drafts when building manual page element requests", () => {
    expect(
      assetPageElementRequestBody(
        {
          elementId: "manual_element_plus",
          sourceNodeId: "node-home",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:12.5,8.25,20,6",
          semanticArea: "top",
          coordinateSpace: "screen",
          elementLabel: "右上加号",
          outcomeType: "compound_navigation",
          targetNodeId: "node-add-friend",
          targetLabel: "添加好友页",
          outcomeLabel: "弹出更多菜单后可继续点添加好友",
          compoundSteps: [
            { type: "wait_until_state", text: "添加好友", label: "等待更多菜单出现", timeoutMs: 1200 },
            { type: "tap_on_text", text: "添加好友", label: "点击添加好友" }
          ]
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      elementId: "manual_element_plus",
      sourceNodeId: "node-home",
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "右上加号",
      availability: "visible",
      platformScope: "android",
      outcomeType: "compound_navigation",
      targetNodeId: "node-add-friend",
      targetLabel: "添加好友页",
      outcomeLabel: "弹出更多菜单后可继续点添加好友",
      compoundSteps: [
        { type: "wait_until_state", text: "添加好友", label: "等待更多菜单出现", timeoutMs: 1200 },
        { type: "tap_on_text", text: "添加好友", label: "点击添加好友" }
      ]
    });
  });

  it("requires a target page for navigable page ability requests", () => {
    expect(
      validateAssetPageElementDraftForSave({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        actionKind: "tap",
        availability: "visible",
        locator: "image-region:3,30,94,59",
        elementLabel: "班级列表",
        outcomeType: "navigate",
        targetLabel: "班级详情"
      })
    ).toBe("跳转页面类型必须选择已保存的目标页面，否则不会进入路径规划");

    expect(
      validateAssetPageElementDraftForSave({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        actionKind: "tap",
        availability: "visible",
        locator: "image-region:3,30,94,59",
        elementLabel: "班级列表",
        outcomeType: "navigate",
        targetNodeId: "node-class-detail",
        targetLabel: "班级详情"
      })
    ).toBeUndefined();
  });

  it("maps legacy overlay assets as page-local context instead of surfacing overlay controls", () => {
    const response = {
      result: {
        status: "draft_candidate" as const,
        match: {
          status: "unknown",
          score: 0.52,
          candidates: [
            {
              node: {
                id: "node-home-more",
                key: "classin.home.more",
                name: "主页-更多操作",
                nodeType: "business_state",
                tags: ["page-overlay", "page-state", "asset-recording"],
                metadata: {
                  assetRecordingConfirmed: true,
                  assetKind: "overlay",
                  pageName: "主页-更多操作",
                  parentPageId: "node-home",
                  parentPageName: "主页",
                  overlayType: "popup_menu",
                  closeAction: "back"
                }
              },
              score: 0.82,
              matcherResults: [
                { type: "text", expected: "添加好友", actual: "添加好友", matched: true }
              ]
            }
          ]
        },
        node: {
          id: "runtime-unknown-add-friend",
          key: "runtime.unknown.add_friend",
          name: "运行期未知节点：添加好友",
          metadata: {}
        },
        observation: {
          id: "obs-menu",
          platform: "android" as const,
          capturedAt: "2026-06-18T10:00:00.000Z",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          uiElements: [
            { text: "添加好友", visible: true, enabled: true },
            { text: "加入班级", visible: true, enabled: true },
            { text: "加入公开课", visible: true, enabled: true },
            { text: "扫一扫", visible: true, enabled: true }
          ],
          ocrTexts: []
        },
        visualPageName: "添加好友"
      },
      assets: {
        pageAssets: [
          {
            id: "node-home-more",
            key: "classin.home.more",
            name: "主页-更多操作",
            status: "active",
            platformScope: "android",
            matcherCount: 4,
            elementCount: 0,
            updatedAt: "2026-06-18T10:00:00.000Z"
          }
        ]
      }
    };

    const page = mapCurrentPageAssetResponse(response, "version-1");

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("添加好友");
    expect(page.targetRef).toBe("runtime.unknown.add_friend");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.parentPageName).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.overlayBehavior).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
    expect(page.savedAssets?.some((asset) => asset.id === "node-home-more")).toBe(true);
    expect(pageAssetMessage(response, page)).toBe("已识别待保存页面：添加好友");
  });

  it("includes scroll container profile when building manual operation transition requests", () => {
    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-home",
          targetNodeId: "node-class-detail",
          abilityType: "grid_candidate",
          actionKind: "scroll",
          availability: "visible",
          outcomeType: "navigate",
          locator: "resource-id: cn.eeo.classin:id/class_list",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "班级列表",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            targetQuery: "班级四十一号",
            afterFoundAction: "tap_item"
          }
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      sourceNodeId: "node-home",
      targetNodeId: "node-class-detail",
      abilityType: "grid_candidate",
      actionKind: "scroll",
      locator: "resource-id: cn.eeo.classin:id/class_list",
      semanticArea: "content",
      coordinateSpace: "screen",
      elementLabel: "班级列表",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      platformScope: "android",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "item_text",
        targetQuery: "班级四十一号",
        afterFoundAction: "tap_item"
      }
    });
  });

  it("keeps scrollable image targets in page ability requests", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-list",
          abilityType: "scroll_candidate",
          actionKind: "scroll",
          availability: "after_scroll",
          locator: "image-region:72,38,6,5",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "删除图标",
          outcomeType: "show_inline_state",
          outcomeLabel: "找到删除图标后显示确认弹窗",
          scrollProfile: {
            containerKind: "list",
            direction: "vertical",
            targetKind: "image_region",
            targetQuery: "image-region:72,38,6,5",
            afterFoundAction: "tap_child",
            scrollStepPercent: 62,
            failureStrategy: "try_next_candidate"
          }
        },
        { sourceNodeId: "node-list", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-list",
        abilityType: "scroll_candidate",
        actionKind: "scroll",
        locator: "image-region:72,38,6,5",
        semanticArea: "content",
        coordinateSpace: "screen",
        scrollProfile: expect.objectContaining({
          targetKind: "image_region",
          targetQuery: "image-region:72,38,6,5",
          afterFoundAction: "tap_child"
        })
      })
    );
  });

  it("includes screenshot marked image-region locators when building manual operation transition requests", () => {
    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-home",
          targetNodeId: "node-search",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          locator: "image-region:12.5,8.25,20,6",
          elementLabel: "搜索按钮",
          targetLabel: "搜索页"
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      sourceNodeId: "node-home",
      targetNodeId: "node-search",
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页",
      platformScope: "android"
    });
  });
});
