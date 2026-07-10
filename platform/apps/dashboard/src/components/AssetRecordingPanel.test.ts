import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssetRecordingPanel, applyEditedEvidenceValue, applySemanticAreaOverrideToRegion, clientPointToImagePercent, manualOperationDraftFromForm, operationOutcomeFields, operationPreviewFrame, operationTransitionDraftFromForm, pageNameDraftPatch, pageTaskDraftFromForm, updateEditableScreenshotRegion } from "./AssetRecordingPanel.js";

describe("AssetRecordingPanel", () => {
  it("maps screenshot selection points to the displayed image instead of the outer frame", () => {
    expect(clientPointToImagePercent({ clientX: 400, clientY: 500 }, { left: 250, top: 100, width: 300, height: 600 })).toEqual({ x: 50, y: 66.67 });

    expect(clientPointToImagePercent({ clientX: 125, clientY: 160 }, { left: 250, top: 100, width: 300, height: 600 })).toEqual({ x: 0, y: 10 });
  });

  it("updates screenshot regions by drawing, moving, and resizing handles", () => {
    expect(
      updateEditableScreenshotRegion({
        type: "draw",
        start: { x: 60, y: 40 },
        region: { id: "region", label: "动作区域", x: 60, y: 40, width: 0, height: 0 }
      }, { x: 50, y: 55 })
    ).toEqual({ id: "region", label: "动作区域", x: 50, y: 40, width: 10, height: 15, semanticArea: "content", coordinateSpace: "screen" });

    expect(
      updateEditableScreenshotRegion({
        type: "move",
        start: { x: 15, y: 25 },
        region: { id: "region", label: "动作区域", x: 10, y: 20, width: 30, height: 15 }
      }, { x: 95, y: 90 })
    ).toEqual({ id: "region", label: "动作区域", x: 70, y: 85, width: 30, height: 15, semanticArea: "bottom", coordinateSpace: "screen" });

    expect(
      updateEditableScreenshotRegion({
        type: "resize",
        handle: "se",
        start: { x: 30, y: 40 },
        region: { id: "region", label: "动作区域", x: 10, y: 20, width: 20, height: 20 }
      }, { x: 45, y: 55 })
    ).toEqual({ id: "region", label: "动作区域", x: 10, y: 20, width: 35, height: 35, semanticArea: "content", coordinateSpace: "screen" });
  });

  it("opens the candidate-driven v2 workbench by default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          ocrTexts: ["ocr_text:搜索@region(76,7,12,5)", "创建班级"],
          elements: [],
          transitions: [],
          tasks: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("v2 候选录入");
    expect(markup).toContain("候选池");
    expect(markup).toContain("先选候选，再确认语义");
    expect(markup).toContain("直接录为页面身份");
    expect(markup).toContain("录为可操作元素");
    expect(markup).not.toContain("<h2>页面身份依据</h2>");
    expect(markup).not.toContain("截图重点区域");
  });

  it("renders the manual page asset recording workflow", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        selectedDeviceName: "Pixel 8",
        busy: false,
        initialDetailTab: "match",
        previewSlot: React.createElement("div", { className: "mock-preview" }, "设备实时画面"),
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "首页",
          visualPageName: "主页",
          matchedAssetName: "我是教师班级列表",
          matchedAssetKey: "classin.teacher.classes",
          targetRef: "page.home",
          matchScore: 0.86,
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=1",
          screenshotRegions: [
            {
              id: "region-1",
              label: "主内容",
              x: 12,
              y: 18,
              width: 70,
              height: 40
            }
          ],
          confirmedMatchers: ["text:我是教师"],
          confirmedUiTexts: ["主页"],
          confirmedOcrTexts: ["主页"],
          matchedMatchers: ["activity:.MainActivity", "text:我是教师"],
          missedMatchers: ["resource-id:teacher_tab"],
          uiTexts: ["我是教师", "全部班级", "创建班级"],
          ocrTexts: ["主页", "消息"],
          elements: [
            {
              label: "我是教师",
              locator: "resource-id: cn.eeo.classin:id/teacher_tab",
              action: "tap"
            }
          ],
          transitions: [
            {
              id: "edge-home-class",
              name: "首页 -> 班级详情",
              status: "draft",
              source: "manual_recording",
              actionSummary: "tap_on_element: cn.eeo.classin:id/class_item_root",
              targetName: "班级详情",
              targetKey: "page.class.detail",
              expectationSummary: "预期状态：班级详情",
              reliabilityScore: 0.9
            }
          ],
          aiDescription: "ClassIn 首页，可切换我是教师和我是学生",
          savedAssets: [
            {
              id: "node-home",
              key: "page.home",
              name: "首页",
              status: "active",
              platformScope: "android",
              matcherCount: 2,
              elementCount: 1
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: () => undefined
      })
    );

    expect(markup).toContain("设备实时画面");
    expect(markup).toContain("asset-recording-resizer");
    expect(markup).toContain("aria-label=\"调整预览和页面信息区域宽度\"");
    expect(markup).not.toContain("设备预览与操作");
    expect(markup).not.toContain("页面识别与确认");
    expect(markup).not.toContain("开始录入");
    expect(markup).not.toContain("asset-status-row");
    expect(markup.indexOf("asset-page-title")).toBeLessThan(markup.indexOf("asset-status matched"));
    expect(markup).not.toContain("资产录制</span>");
    expect(markup).not.toContain("<h2>当前页面信息</h2>");
    expect(markup).toContain("修改名称");
    expect(markup).not.toContain("aria-label=\"页面名称\"");
    expect(markup).toContain("页面截图");
    expect(markup).not.toContain("自动忽略系统状态栏");
    expect(markup).not.toContain("允许小幅位置漂移");
    expect(markup).not.toContain("asset-match-policy");
    expect(markup).not.toContain("视觉匹配策略");
    expect(markup).not.toContain("系统栏 mask");
    expect(markup).not.toContain("邻域漂移搜索");
    expect(markup).not.toContain("局部 SSIM");
    expect(markup).not.toContain("aHash/dHash");
    expect(markup).toContain("截图重点区域");
    expect(markup).toContain("主页");
    expect(markup).toContain("匹配资产/状态");
    expect(markup).toContain("我是教师班级列表");
    expect(markup).not.toContain("classin.teacher.classes");
    expect(markup).toContain("主内容");
    expect(markup).toContain("force=true");
    expect(markup).not.toContain("page.home");
    expect(markup).toContain("cn.eeo.classin");
    expect(markup).toContain(".MainActivity");
    expect(markup).toContain("role=\"tablist\"");
    expect(markup.indexOf("role=\"tablist\"")).toBeLessThan(markup.indexOf("页面身份依据"));
    expect(markup.indexOf("role=\"tablist\"")).toBeLessThan(markup.indexOf("资产 ID"));
    expect(markup).not.toContain("用于判断");
    expect(markup).not.toContain("拖拽截图可圈选重点区域");
    expect(markup).toContain("asset-title-status");
    expect(markup.indexOf("asset-title-status")).toBeLessThan(markup.indexOf("asset-status matched"));
    expect(markup.indexOf("asset-title-status")).toBeLessThan(markup.indexOf("匹配度 86%"));
    expect(markup).not.toContain("页面 key<input");
    expect(markup).not.toContain("业务描述<textarea");
    expect(markup).toContain("页面匹配");
    expect(markup).toContain("页面能力");
    expect(markup).not.toContain("AI 说明");
    expect(markup).toContain("页面身份依据");
    expect(markup).not.toContain("操作转移");
    expect(markup).toContain("asset-detail-section asset-identity-card");
    expect(markup).not.toContain("panel asset-identity-card");
    expect(markup).not.toContain("panel asset-elements-card");
    expect(markup).toContain("已确认匹配依据");
    expect(markup).toContain("候选信息");
    expect(markup).not.toContain("命中 matcher");
    expect(markup).not.toContain("未命中 matcher");
    expect(markup).toContain("asset-matcher-action");
    expect(markup).toContain("设为依据");
    expect(markup).toContain("移除");
    expect(markup).toContain("页面文字");
    expect(markup).toContain("OCR 文字");
    expect(markup).toContain("创建班级");
    expect(markup).toContain("消息");
    expect(markup).not.toContain("页面操作与转移");
    expect(markup).not.toContain("已知操作转移");
    expect(markup).not.toContain("首页 -&gt; 班级详情");
    expect(markup).not.toContain("可用于路径规划");
    expect(markup).not.toContain("AI 可读信息");
    expect(markup).not.toContain("已保存页面资产");
    expect(markup).toContain("更新页面");
    expect(markup).not.toContain(">保存页面</button>");
  });

  it("does not treat a matched graph state as a saved page asset until it is confirmed", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          nodeId: "recording-node",
          pageName: "新建公开课",
          targetRef: "recording.1u41ebp",
          matchedAssetName: "录制节点：新建公开课",
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("录制节点：新建公开课");
    expect(markup).toContain("库中暂无对应页面资产");
    expect(markup).toContain("保存页面");
    expect(markup).not.toContain("更新页面");
  });

  it("keeps the scrollable details separate from the save/update bar", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          targetRef: "page.home"
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("asset-page-card-shell");
    expect(markup).toContain("asset-detail-scroll");
    expect(markup.indexOf("asset-page-card-shell")).toBeLessThan(markup.indexOf("asset-detail-scroll"));
    expect(markup.indexOf("asset-detail-scroll")).toBeLessThan(markup.indexOf("asset-floating-actions"));
  });

  it("renders the auto explorer tab with candidates, plans, and results", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "explorer",
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          graphVersionId: "version-1"
        },
        autoExploreReport: {
          status: "ready",
          version: "v2",
          sourceNodeName: "主页",
          candidates: [
            {
              id: "candidate-search",
              label: "搜索入口",
              actionKind: "tap",
              locator: "image-region:88,7,8,5",
              semanticArea: "top",
              source: "manual_element",
              riskLevel: "safe",
              status: "ready",
              targetNodeName: "搜索页"
            },
            {
              id: "candidate-logout",
              label: "退出登录",
              actionKind: "tap",
              locator: "image-region:20,70,30,6",
              semanticArea: "content",
              source: "ocr_text",
              riskLevel: "dangerous",
              status: "skipped"
            }
          ],
          plan: {
            version: "v2",
            maxDepth: 2,
            maxActions: 8,
            steps: [
              {
                id: "step-1",
                depth: 1,
                sourceNodeName: "主页",
                candidateLabel: "搜索入口",
                targetNodeName: "搜索页"
              }
            ]
          },
          results: [
            {
              candidateId: "candidate-search",
              candidateLabel: "搜索入口",
              status: "passed",
              resultType: "existing_page",
              targetNodeName: "搜索页",
              message: "到达已保存页面：搜索页"
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: () => undefined,
        onPreviewAutoExplore: vi.fn(),
        onRunAutoExplore: vi.fn()
      })
    );

    expect(markup).toContain("自动探索");
    expect(markup).toContain("V2 两层探索");
    expect(markup).toContain("搜索入口");
    expect(markup).toContain("退出登录");
    expect(markup).toContain("已跳过");
    expect(markup).toContain("到达已保存页面");
    expect(markup).toContain("开始探索");
    expect(markup).not.toContain("AI 说明");
  });

  it("renders a candidate-driven v2 asset workbench instead of the old manual region workflow", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "workbench",
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          graphVersionId: "version-1",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=1",
          confirmedOcrTexts: ["ocr_text:主页@region(6,7,12,5)"],
          ocrTexts: ["ocr_text:搜索@region(76,7,12,5)", "创建班级"],
          elements: [
            {
              id: "search-entry",
              label: "搜索入口",
              locator: "runtime-locator:top-bar-icon:search",
              locatorKind: "visual_locator",
              coordinateSpace: "runtime",
              action: "tap",
              actionKind: "tap",
              source: "manual",
              quality: {
                status: "pass",
                score: 0.96,
                warnings: [],
                candidates: [],
                evidence: {}
              }
            }
          ],
          transitions: [
            {
              id: "edge-search",
              name: "主页 -> 搜索",
              status: "ready",
              actionKind: "tap",
              actionLocator: "runtime-locator:top-bar-icon:search",
              targetName: "搜索"
            }
          ],
          tasks: [
            {
              id: "task-check-home",
              name: "主页轻量巡检",
              status: "active",
              steps: [{ order: 1, fieldType: "wait", text: "主页" }]
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("v2 候选录入");
    expect(markup).toContain("先选候选，再确认语义");
    expect(markup).toContain("候选池");
    expect(markup).toContain("搜索");
    expect(markup).toContain("创建班级");
    expect(markup).toContain("直接录为页面身份");
    expect(markup).toContain("录为可操作元素");
    expect(markup).toContain("缺少区域，先刷新候选");
    expect(markup).not.toContain("ocr_text:搜索@region");
    expect(markup).toContain("region_center 不直接执行");
    expect(markup).toContain("OCR / 视觉 / 结构重定位成功才允许点击");
    expect(markup).toContain("PageElement");
    expect(markup).toContain("PageTransition");
    expect(markup).toContain("DynamicRegion / ListTemplate");
    expect(markup).toContain("当前页录入状态");
    expect(markup).toContain("1 个可操作元素");
    expect(markup).toContain("1 条连接边");
    expect(markup).toContain("1 个页面任务");
    expect(markup).toContain("搜索入口");
    expect(markup).toContain("主页 -&gt; 搜索");
    expect(markup).toContain("从已录入元素补连接边");
    expect(markup).toContain("把元素编入页面任务");
    expect(markup).toContain("打开详情编辑");
    expect(markup).not.toContain("AI 说明");
  });

  it("renders saved page element quality status in the actions tab", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "登录",
          nodeId: "node-login",
          graphVersionId: "version-1",
          elements: [
            {
              id: "password-input",
              label: "密码输入框",
              locator: "image-region:6,31,88,6",
              action: "input",
              actionKind: "input",
              source: "manual",
              quality: {
                status: "needs_review",
                score: 0.68,
                warnings: [
                  {
                    code: "ambiguous_target_text",
                    severity: "warning",
                    message: "同一区域内存在多个相似文字候选"
                  }
                ],
                candidates: [],
                evidence: {
                  uniqueCandidate: false,
                  candidateCount: 2
                }
              }
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("定位质量");
    expect(markup).toContain("建议复核");
    expect(markup).toContain("68%");
    expect(markup).toContain("同一区域内存在多个相似文字候选");
  });

  it("presents saved page elements as locator strategies instead of marked regions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          graphVersionId: "version-1",
          elements: [
            {
              id: "home-search",
              label: "搜索",
              locator: "top-bar-icon:search",
              locatorKind: "top_bar_icon_locator",
              action: "tap",
              actionKind: "tap",
              source: "manual",
              coordinateSpace: "runtime",
              semanticArea: "top",
              structuralLocator: {
                kind: "top_bar_icon",
                role: "search",
                slot: "right",
                orderFromRight: 2
              },
              quality: {
                status: "pass",
                score: 0.96,
                warnings: [],
                candidates: [{ x: 88, y: 6, width: 4, height: 4 }],
                evidence: { source: "top_bar_icon_shape" }
              }
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("定位策略工作台");
    expect(markup).toContain("保存的是定位策略，不是固定坐标");
    expect(markup).toContain("策略：顶部栏图标");
    expect(markup).toContain("语义目标");
    expect(markup).toContain("找顶部栏右侧第 2 个 search 图标");
    expect(markup).toContain("当前截图可定位");
    expect(markup).toContain("点击点：运行时计算");
    expect(markup).toContain("原始资产 / 高级调试");
  });

  it("shows an identifying state while the next page is being recognized", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: true,
        identifying: true,
        currentPage: {
          status: "matched",
          pageName: "主页",
          nodeId: "node-home",
          targetRef: "page.home"
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("asset-identifying-banner");
    expect(markup).toContain("识别中");
    expect(markup).toContain("正在识别当前页面");
  });

  it("shows the confirmed page name as text and edits it through a confirmation control", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          pageName: "我确认的主页",
          visualPageName: "主页",
          nodeId: "node-home",
          targetRef: "page.home"
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("<strong>我确认的主页</strong>");
    expect(markup).toContain("修改名称");
    expect(markup).not.toContain("asset-page-name-input");
    expect(markup).not.toContain("value=\"主页\"");
  });

  it("keeps page rename as a draft change until the page asset is explicitly saved", () => {
    expect(pageNameDraftPatch(" 班级详情 ")).toEqual({ pageName: "班级详情" });
    expect(pageNameDraftPatch("   ")).toBeUndefined();
  });

  it("builds a grid candidate page ability draft from the manual element form", () => {
    expect(
      manualOperationDraftFromForm(
        {
          abilityType: "grid_candidate",
          actionKind: "tap",
          semanticArea: "content",
          elementLabel: "打开班级详情",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          containerKind: "grid_list",
          scrollDirection: "vertical",
          layoutColumns: "2",
          candidateItemHeightPercent: "24.5",
          clickSafeXPercent: "50",
          clickSafeYPercent: "28",
          scrollStepPercent: "65",
          candidateFailureStrategy: "try_next_candidate"
        },
        { sourceNodeId: "node-home", region: { x: 3, y: 32, width: 91, height: 56 } }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        actionKind: "tap",
        locator: "image-region:3,32,91,56",
        semanticArea: "content",
        coordinateSpace: "screen",
        elementLabel: "打开班级详情",
        targetNodeId: "node-class-detail",
        targetLabel: "班级详情",
        scrollProfile: expect.objectContaining({
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          candidateItemHeightPercent: 24.5,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          scrollStepPercent: 65,
          failureStrategy: "try_next_candidate"
        })
      })
    );
  });

  it("keeps runtime OCR target text separate from the page ability display name", () => {
    expect(
      manualOperationDraftFromForm(
        {
          abilityType: "conditional_tap",
          actionKind: "tap",
          semanticArea: "content",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        },
        { sourceNodeId: "node-class-detail", region: { x: 6, y: 47.8, width: 88, height: 8.8 } }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案",
        targetNodeId: "node-learning-plan",
        targetLabel: "学习方案"
      })
    );

    expect(
      operationTransitionDraftFromForm(
        {
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案",
          targetText: "学习方案"
        },
        {
          sourceNodeId: "node-class-detail",
          locator: "image-region:6,47.8,88,8.8",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          semanticArea: "content",
          coordinateSpace: "screen"
        }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );
  });

  it("builds a scrollable image target page ability draft from a marked icon region", () => {
    expect(
      manualOperationDraftFromForm(
        {
          abilityType: "scroll_candidate",
          actionKind: "scroll",
          semanticArea: "content",
          elementLabel: "删除图标",
          availability: "after_scroll",
          outcomeType: "show_inline_state",
          outcomeLabel: "找到删除图标后显示确认弹窗",
          containerKind: "list",
          scrollDirection: "vertical",
          targetKind: "image_region",
          targetQuery: "image-region:72,38,6,5",
          afterFoundAction: "tap_child",
          scrollStepPercent: "62",
          candidateFailureStrategy: "try_next_candidate"
        },
        { sourceNodeId: "node-list", region: { x: 72, y: 38, width: 6, height: 5 } }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-list",
        abilityType: "scroll_candidate",
        actionKind: "scroll",
        locator: "image-region:72,38,6,5",
        semanticArea: "content",
        elementLabel: "删除图标",
        availability: "after_scroll",
        outcomeType: "show_inline_state",
        outcomeLabel: "找到删除图标后显示确认弹窗",
        scrollProfile: expect.objectContaining({
          containerKind: "list",
          direction: "vertical",
          targetKind: "image_region",
          targetQuery: "image-region:72,38,6,5",
          afterFoundAction: "tap_child",
          scrollStepPercent: 62,
          failureStrategy: "try_next_candidate"
        })
      })
    );
  });

  it("separates confirmed page evidence from unconfirmed candidates", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          confirmedMatchers: ["activity:.MainActivity"],
          confirmedUiTexts: ["我是教师"],
          confirmedOcrTexts: ["主页"],
          matchedMatchers: ["activity:.MainActivity", "text:我是教师"],
          uiTexts: ["我是教师", "创建班级"],
          ocrTexts: ["主页", "消息"],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("已确认匹配依据");
    expect(markup).toContain("候选信息");
    expect(markup).toContain("activity:.MainActivity");
    expect(markup).toContain("页面文字");
    expect(markup).toContain("OCR 文字");
    expect(markup).toContain("创建班级");
    expect(markup).toContain("消息");
    expect(markup).toContain("移除");
    expect(markup).toContain("设为依据");
    expect(markup).not.toContain("已忽略");
    expect(markup).not.toContain("使用</button>");
    expect(markup).not.toContain(">忽略</button>");
  });

  it("shows edit controls for confirmed OCR and UI text evidence", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          pageName: "主页",
          confirmedMatchers: ["activity:.MainActivity"],
          confirmedUiTexts: ["我是教师"],
          confirmedOcrTexts: ["2+ 添加好友"],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("2+ 添加好友");
    expect(markup).toContain("aria-label=\"编辑 OCR 文字：2+ 添加好友\"");
    expect(markup).toContain("aria-label=\"编辑页面文字：我是教师\"");
    expect(markup).not.toContain("aria-label=\"编辑 matcher：activity:.MainActivity\"");
  });

  it("applies corrected OCR text to confirmed evidence values", () => {
    const patch = applyEditedEvidenceValue({
      item: { kind: "OCR 文字", value: "2+ 添加好友" },
      nextValue: "添加好友",
      confirmedMatchers: ["activity:.MainActivity"],
      confirmedUiTexts: ["我是教师"],
      confirmedOcrTexts: ["2+ 添加好友"]
    });

    expect(patch).toEqual({ confirmedOcrTexts: ["添加好友"] });
  });

  it("keeps OCR evidence region when correcting recognized text", () => {
    const patch = applyEditedEvidenceValue({
      item: { kind: "OCR 文字", value: "ocr_text:2+ 添加好友@region(68,21,18,6)" },
      nextValue: "添加好友",
      confirmedMatchers: [],
      confirmedUiTexts: [],
      confirmedOcrTexts: ["ocr_text:2+ 添加好友@region(68,21,18,6)"]
    });

    expect(patch).toEqual({ confirmedOcrTexts: ["ocr_text:添加好友@region(68,21,18,6)"] });
  });

  it("shows region-bound OCR evidence as readable text instead of raw matcher syntax", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          pageName: "待办",
          confirmedOcrTexts: ["ocr_text:待办@region(15,7,18,6)"],
          ocrTexts: ["ocr_text:搜索@region(76,7,12,5)"],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("待办");
    expect(markup).toContain("搜索");
    expect(markup).not.toContain("ocr_text:待办@region");
    expect(markup).not.toContain("ocr_text:搜索@region");
    expect(markup).toContain("aria-label=\"编辑 OCR 文字：待办\"");
  });

  it("keeps OCR evidence when an edit is confirmed without changing text", () => {
    const patch = applyEditedEvidenceValue({
      item: { kind: "OCR 文字", value: "添加好友" },
      nextValue: "添加好友",
      confirmedMatchers: [],
      confirmedUiTexts: [],
      confirmedOcrTexts: ["添加好友"]
    });

    expect(patch).toEqual({ confirmedOcrTexts: ["添加好友"] });
  });

  it("groups OCR as reusable evidence before UI-tree and platform-specific evidence", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          pageName: "主页",
          matchedMatchers: ["package:cn.eeo.classin", "resource-id:cn.eeo.classin:id/course_photo"],
          uiTexts: ["我是教师", "全部班级"],
          ocrTexts: ["主页", "消息"],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("通用候选");
    expect(markup).toContain("平台候选");
    expect(markup.indexOf("通用候选")).toBeLessThan(markup.indexOf("平台候选"));
    expect(markup.indexOf("通用候选")).toBeLessThan(markup.indexOf("OCR 文字"));
    expect(markup.indexOf("平台候选")).toBeLessThan(markup.indexOf("页面文字"));
    expect(markup.indexOf("平台候选")).toBeLessThan(markup.indexOf("package:cn.eeo.classin"));
    expect(markup.indexOf("平台候选")).toBeLessThan(markup.indexOf("resource-id:cn.eeo.classin:id/course_photo"));
  });

  it("records page assets only and hides overlay asset controls", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          pageName: "主页",
          matchedAssetName: "主页",
          matchedAssetKey: "classin.home",
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("保存页面");
    expect(markup).not.toContain("保存类型");
    expect(markup).not.toContain("浮层类型");
    expect(markup).not.toContain("行为类型");
    expect(markup).not.toContain("关闭方式");
    expect(markup).not.toContain("保存浮层");
  });

  it("shows page update mode even when legacy overlay metadata is present", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "matched",
          nodeId: "node-home-more",
          targetRef: "classin.home.more",
          pageName: "主页",
          assetKind: "overlay",
          parentPageId: "node-home",
          parentPageName: "主页",
          overlayType: "popup_menu",
          closeAction: "back",
          savedAssets: [
            {
              id: "node-home-more",
              key: "classin.home.more",
              name: "主页-更多操作",
              status: "active"
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("主页");
    expect(markup).toContain("库中已有对应页面资产");
    expect(markup).toContain("更新页面");
    expect(markup).not.toContain("更新浮层");
    expect(markup).not.toContain("保存浮层");
  });


  it("shows the persisted asset ids before confirmation", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "draft_created",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "首页",
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("资产 ID");
    expect(markup).toContain("node-home");
    expect(markup).toContain("version-1");
    expect(markup).toContain("保存页面");
    expect(markup).not.toContain("更新页面");
  });

  it("shows an unsaved candidate without pretending it already has a persisted asset id", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "draft_candidate",
          graphVersionId: "version-1",
          pageName: "主页",
          targetRef: "classin.home",
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("待保存");
    expect(markup).toContain("资产 ID");
    expect(markup).toContain("待确认");
    expect(markup).toContain("库中暂无对应页面资产");
    expect(markup).toContain("保存页面");
    expect(markup).not.toContain("更新页面");
  });

  it("hides runtime generated candidate keys from the main asset recording view", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        currentPage: {
          status: "draft_candidate",
          graphVersionId: "version-1",
          pageName: "新建公开课",
          targetRef: "runtime.unknown.1u41ebp",
          matchScore: 0.17,
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("新建公开课");
    expect(markup).toContain("待保存");
    expect(markup).not.toContain("asset-status-row");
    expect(markup).toContain("待建立基准");
    expect(markup).not.toContain("匹配度 17%");
    expect(markup).not.toContain("runtime.unknown.1u41ebp");
  });

  it("shows matcher candidates as unconfirmed evidence until the user promotes them", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          matchedMatchers: ["text:我是教师", "package:cn.eeo.classin"],
          confirmedMatchers: ["package:cn.eeo.classin"],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("text:我是教师");
    expect(markup).toContain("候选信息");
    expect(markup).toContain("设为依据");
    expect(markup).toContain("package:cn.eeo.classin");
    expect(markup).toContain("已确认匹配依据");
    expect(markup).toContain("移除");
    expect(markup).not.toContain("命中 matcher");
    expect(markup).not.toContain("未命中 matcher");
  });

  it("hides auto operation candidates and keeps an empty editable element list until add is clicked", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          elements: [
            {
              label: "创建公开课",
              locator: "text: 创建公开课",
              action: "tap",
              actionKind: "tap",
              availability: "visible"
            },
            {
              label: "班级列表",
              locator: "resource-id: cn.eeo.classin:id/recycler",
              action: "swipe",
              actionKind: "scroll",
              availability: "visible"
            },
            {
              label: "更多班级",
              locator: "text: 更多班级",
              action: "tap",
              actionKind: "tap",
              availability: "after_scroll"
            }
          ],
          transitions: [
            {
              id: "transition-create-public",
              name: "主页 -> 新建公开课",
              status: "active",
              actionSummary: "点击：创建公开课",
              targetName: "新建公开课",
              expectationSummary: "等待页面：新建公开课",
              reliabilityScore: 0.82
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("添加可操作元素");
    expect(markup).toContain("0 个元素");
    expect(markup).toContain("暂无可操作元素");
    expect(markup).not.toContain("动作方式");
    expect(markup).not.toContain("保存可操作元素");
    expect(markup).not.toContain("动作名称");
    expect(markup).not.toContain("先在截图上圈选操作区域，再在右侧选择动作方式");
    expect(markup).not.toContain("目标 / 变化说明");
    expect(markup).not.toContain("标注点击");
    expect(markup).not.toContain("辅助候选");
    expect(markup).not.toContain("点击候选");
    expect(markup).not.toContain("滑动候选");
    expect(markup).not.toContain("条件候选");
    expect(markup).not.toContain("创建公开课");
    expect(markup).not.toContain("班级列表");
    expect(markup).not.toContain("更多班级");
    expect(markup).not.toContain("确认目标");
    expect(markup).not.toContain("需滑动后确认");
    expect(markup).not.toContain("已沉淀转移");
    expect(markup).not.toContain("主页 -&gt; 新建公开课");
    expect(markup).not.toContain("可用于路径规划");
    expect(markup).not.toContain("这里展示当前页可操作元素");
    expect(markup).not.toContain("可操作元素</h3>");
  });

  it("shows an editable draft row only after the user starts adding a page element", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          pageName: "主页",
          elements: [],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageElement: vi.fn()
      })
    );

    expect(markup).toContain("0 个元素");
    expect(markup).toContain("+ 添加可操作元素");
    expect(markup).not.toContain("添加可操作元素</strong>");
    expect(markup).not.toContain("动作方式");
  });

  it("shows saved manual page elements as the primary editable operation list", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          elements: [
            {
              label: "搜索按钮",
              locator: "image-region:12.5,8.25,20,6",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              region: { x: 12.5, y: 8.25, width: 20, height: 6 }
            },
            {
              label: "创建公开课",
              locator: "text: 创建公开课",
              action: "tap",
              actionKind: "tap",
              availability: "visible"
            }
          ],
          transitions: [
            {
              id: "transition-search",
              name: "主页 -> 搜索页",
              status: "active",
              actionSummary: "tap_on_image",
              actionLocator: "image-region:12.5,8.25,20,6",
              actionKind: "tap",
              targetName: "搜索页"
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onDeletePageElement: vi.fn()
      })
    );

    expect(markup).toContain("已录入可操作元素");
    expect(markup).toContain("搜索按钮");
    expect(markup).toContain("点击");
    expect(markup).toContain("编辑");
    expect(markup).toContain("删除");
    expect(markup).toContain("+ 添加可操作元素");
    expect(markup).not.toContain("辅助候选");
    expect(markup).not.toContain("创建公开课");
    expect(markup).not.toContain("目标待确认");
  });

  it("keeps page transitions out of the page element recording tab", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          transitions: [
            {
              id: "transition-search",
              name: "主页 -> 搜索页",
              status: "active",
              actionSummary: "点击：搜索",
              targetName: "搜索页"
            },
            {
              id: "transition-more",
              name: "主页 -> 更多操作菜单",
              status: "draft",
              actionSummary: "点击：更多",
              targetName: "页面内状态"
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).not.toContain("可用于路径规划");
    expect(markup).not.toContain("待完善");
    expect(markup).not.toContain("主页 -&gt; 搜索页");
    expect(markup).not.toContain("主页 -&gt; 更多操作菜单");
    expect(markup).not.toContain("<code>active</code>");
    expect(markup).not.toContain("<code>draft</code>");
  });

  it("keeps target page draft controls hidden until a page element is being edited", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "主页",
          elements: [
            {
              label: "创建公开课",
              locator: "text: 创建公开课",
              action: "tap",
              actionKind: "tap",
              availability: "visible"
            }
          ],
          savedAssets: [
            {
              id: "node-search",
              key: "classin.search",
              name: "搜索页",
              status: "active"
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("0 个元素");
    expect(markup).toContain("暂无可操作元素");
    expect(markup).not.toContain("动作方式");
    expect(markup).not.toContain("出现条件");
    expect(markup).not.toContain("结果类型");
    expect(markup).not.toContain("placeholder=\"搜索已保存页面\"");
    expect(markup).not.toContain("<option value=\"node-search\">搜索页</option>");
    expect(markup).not.toContain("标注点击");
    expect(markup).not.toContain("标注滑动");
  });

  it("shows a screenshot region preview for saved manual page elements with captured bounds", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          elements: [
            {
              label: "发布活动",
              locator: "resource-id: cn.eeo.classin:id/publish_activity",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              region: { x: 72.5, y: 82.25, width: 12.5, height: 6 },
              previewCrop: { x: 0, y: 4, width: 100, height: 96 },
              viewport: { width: 1080, height: 2340 }
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("asset-operation-preview");
    expect(markup).toContain("asset-operation-preview-stage");
    expect(markup).toContain("asset-operation-preview-image");
    expect(markup).toContain("asset-operation-preview-info");
    expect(markup).toContain("当前操作区域");
    expect(markup).toContain("force=true");
    expect(markup).toContain("aspect-ratio:1080 / 2246.4");
    expect(markup).toContain("top:-4.17%");
    expect(markup).toContain("height:104.17%");
    expect(markup).toContain("left:72.5%");
    expect(markup).toContain("top:81.51%");
    expect(markup).toContain("width:12.5%");
    expect(markup).toContain("height:6.25%");
  });

  it("builds manual operation drafts from screenshot-marked regions", () => {
    const draft = manualOperationDraftFromForm(
      {
        elementId: "manual_element_old",
        actionKind: "tap",
        availability: "visible",
        elementLabel: "搜索按钮",
        outcomeType: "navigate",
        targetNodeId: "node-search",
        targetLabel: "搜索页",
        outcomeLabel: "进入搜索页"
      },
      {
        sourceNodeId: "node-home",
        region: { x: 12.5, y: 8.25, width: 20, height: 6 }
      }
    );

    expect(draft).toEqual({
      elementId: "manual_element_old",
      sourceNodeId: "node-home",
      actionKind: "tap",
      availability: "visible",
      locator: "image-region:12.5,8.25,20,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "搜索按钮",
      locatorKind: "visual_locator",
      outcomeType: "navigate",
      targetNodeId: "node-search",
      targetLabel: "搜索页",
      outcomeLabel: "进入搜索页"
    });
  });

  it("builds text locator page abilities without requiring a marked screenshot region", () => {
    const draft = manualOperationDraftFromForm(
      {
        locatorKind: "text_locator",
        actionKind: "tap",
        availability: "visible",
        elementLabel: "作业",
        targetText: "作业",
        semanticArea: "content",
        outcomeType: "navigate",
        targetNodeId: "node-homework-create",
        targetLabel: "新建作业"
      },
      {
        sourceNodeId: "node-publish-activity"
      }
    );

    expect(draft).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-publish-activity",
        actionKind: "tap",
        availability: "visible",
        locator: "text:作业",
        locatorKind: "text_locator",
        coordinateSpace: "runtime",
        semanticArea: "content",
        elementLabel: "作业",
        targetText: "作业",
        targetNodeId: "node-homework-create",
        targetLabel: "新建作业"
      })
    );
    expect(draft.locator).not.toContain("image-region");
    expect(draft.tapPointPercent).toBeUndefined();
  });

  it("builds structural locator page abilities with dynamic masks", () => {
    const draft = manualOperationDraftFromForm(
      {
        locatorKind: "structural_locator",
        dynamicMaskPreset: "avatar_text",
        actionKind: "tap",
        availability: "visible",
        semanticArea: "content",
        elementLabel: "个人信息",
        outcomeType: "navigate",
        targetNodeId: "node-profile",
        targetLabel: "个人信息"
      },
      {
        sourceNodeId: "node-settings",
        region: { x: 6, y: 15, width: 88.77, height: 8.78, semanticArea: "content" }
      }
    );

    expect(draft).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-settings",
        locator: "image-region:6,15,88.77,8.78",
        locatorKind: "structural_locator",
        elementLabel: "个人信息",
        structuralLocator: expect.objectContaining({
          kind: "marked_row",
          role: "list_item",
          label: "个人信息"
        }),
        dynamicMasks: [
          expect.objectContaining({ kind: "avatar", reason: "personalized_visual" }),
          expect.objectContaining({ kind: "text", reason: "personalized_text" })
        ]
      })
    );
  });

  it("builds collection item page abilities with dynamic region and item template metadata", () => {
    const draft = manualOperationDraftFromForm(
      {
        abilityType: "grid_candidate",
        locatorKind: "collection_item_locator",
        actionKind: "tap",
        availability: "visible",
        semanticArea: "content",
        elementLabel: "打开班级详情",
        outcomeType: "navigate",
        targetNodeId: "node-class-detail",
        targetLabel: "班级详情",
        dynamicRegionLabel: "班级列表",
        itemTemplateLabel: "班级卡片",
        parameterName: "className"
      },
      {
        sourceNodeId: "node-home",
        region: { x: 3, y: 32, width: 91, height: 56, semanticArea: "content" }
      }
    );

    expect(draft).toEqual(
      expect.objectContaining({
        abilityType: "grid_candidate",
        locatorKind: "collection_item_locator",
        transitionKind: "parameterized",
        parameterMapping: { className: "dynamicRegion.item.titleText" },
        dynamicRegion: expect.objectContaining({
          id: "dynamic_region_node_home_班级列表",
          label: "班级列表",
          itemTemplateId: "item_template_node_home_班级列表"
        }),
        itemTemplate: expect.objectContaining({
          id: "item_template_node_home_班级列表",
          label: "班级卡片"
        })
      })
    );
  });

  it("maps full-screen element bounds into the cropped app preview coordinate space", () => {
    expect(
      operationPreviewFrame(
        { x: 72.5, y: 82.25, width: 12.5, height: 6 },
        { x: 0, y: 4, width: 100, height: 96 },
        { width: 1080, height: 2340 }
      )
    ).toEqual({
      aspectRatio: "1080 / 2246.4",
      imageStyle: {
        left: "0%",
        top: "-4.17%",
        width: "100%",
        height: "104.17%"
      },
      regionStyle: {
        left: "72.5%",
        top: "81.51%",
        width: "12.5%",
        height: "6.25%"
      }
    });
  });

  it("auto-crops saved operation previews around manually marked regions", () => {
    expect(
      operationPreviewFrame(
        { x: 83.2, y: 6.67, width: 12.31, height: 5.67 },
        undefined,
        { width: 1080, height: 2340 }
      )
    ).toEqual({
      aspectRatio: "410.4 / 398.03",
      imageStyle: {
        left: "-163.16%",
        top: "-5.88%",
        width: "263.16%",
        height: "587.89%"
      },
      regionStyle: {
        left: "55.79%",
        top: "33.33%",
        width: "32.39%",
        height: "33.33%"
      }
    });
  });

  it("shows a missing visual hint when saved manual page element bounds were not captured", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          elements: [
            {
              label: "发布活动",
              locator: "resource-id: cn.eeo.classin:id/publish_activity",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual"
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("未采集到控件位置");
  });

  it("shows runtime location instead of missing coordinates for runtime structural elements", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "登录",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=8",
          elements: [
            {
              label: "登录按钮",
              locator: "runtime-locator:primary_login_button",
              locatorKind: "structural_locator",
              coordinateSpace: "runtime",
              targetText: "登录",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              structuralLocator: { role: "primary_button" }
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("运行时定位");
    expect(markup).toContain("登录 · primary_button");
    expect(markup).not.toContain("未采集到控件位置");
  });

  it("explains top bar icon elements with operator-friendly locator instructions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=9",
          elements: [
            {
              label: "搜索",
              locator: "top-bar-icon:search",
              locatorKind: "top_bar_icon_locator",
              coordinateSpace: "runtime",
              semanticArea: "top",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              structuralLocator: { kind: "top_bar_icon", role: "search", slot: "right", orderFromRight: 2 },
              quality: {
                status: "pass",
                score: 0.92,
                warnings: [],
                candidates: [{ region: { x: 88, y: 4, width: 5, height: 4 }, source: "icon_shape" }],
                evidence: { source: "top_bar_icon_shape" }
              }
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("语义定位");
    expect(markup).toContain("语义目标");
    expect(markup).toContain("找顶部栏右侧第 2 个 search 图标");
    expect(markup).toContain("当前截图");
    expect(markup).toContain("可定位");
    expect(markup).toContain("执行动作");
    expect(markup).toContain("运行时重新找到目标后再点击");
    expect(markup).toContain("点击点：运行时计算");
    expect(markup).toContain("定位预览");
    expect(markup).toContain("高级调试");
    expect(markup).toContain("&quot;locatorKind&quot;: &quot;top_bar_icon_locator&quot;");
    expect(markup).not.toContain("搜索策略：");
    expect(markup).not.toContain("定位源：");
    expect(markup).not.toContain("未采集到控件位置");
  });

  it("builds top bar icon page abilities as runtime semantic locators", () => {
    const draft = manualOperationDraftFromForm(
      {
        locatorKind: "top_bar_icon_locator",
        topBarIconRole: "search",
        topBarIconSlot: "right",
        topBarIconOrderFromRight: "2",
        actionKind: "tap",
        availability: "visible",
        semanticArea: "top",
        elementLabel: "搜索",
        outcomeType: "navigate",
        targetNodeId: "node-search",
        targetLabel: "搜索"
      },
      {
        sourceNodeId: "node-home",
        region: { x: 86, y: 3, width: 8, height: 5, semanticArea: "top" }
      }
    );

    expect(draft).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-home",
        locator: "top-bar-icon:search",
        locatorKind: "top_bar_icon_locator",
        coordinateSpace: "runtime",
        semanticArea: "top",
        elementLabel: "搜索",
        structuralLocator: expect.objectContaining({
          kind: "top_bar_icon",
          role: "search",
          slot: "right",
          orderFromRight: 2
        }),
        visualLocator: expect.objectContaining({
          strategy: "top_bar_icon_shape",
          role: "search"
        })
      })
    );
    expect(draft.locator).not.toContain("image-region");
  });

  it("uses a change description instead of target page selection for local outcomes", () => {
    expect(operationOutcomeFields("navigate")).toEqual({
      requiresTargetPage: true,
      targetLabel: "目标页面",
      targetPlaceholder: "搜索已保存页面",
      resultLabel: "目标页面补充说明",
      resultPlaceholder: "例如：进入新建公开课页面"
    });
    expect(operationOutcomeFields("local_state_change")).toEqual({
      requiresTargetPage: false,
      targetLabel: "变化描述",
      targetPlaceholder: "例如：出现添加好友/加入班级菜单",
      resultLabel: "变化描述",
      resultPlaceholder: "例如：右上角展开更多操作菜单"
    });
    expect(operationOutcomeFields("show_inline_state").requiresTargetPage).toBe(false);
    expect(operationOutcomeFields("no_visible_change").requiresTargetPage).toBe(false);
  });

  it("keeps target page outcome controls out of the empty operation list", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          targetRef: "classin.home",
          pageName: "主页",
          elements: [
            {
              label: "创建公开课",
              locator: "text: 创建公开课",
              action: "tap",
              actionKind: "tap",
              availability: "visible"
            }
          ],
          savedAssets: [
            {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              status: "active"
            },
            {
              id: "node-public-create",
              key: "classin.public.create",
              name: "新建公开课",
              status: "active"
            }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageElement: vi.fn()
      })
    );

    expect(markup).toContain("0 个元素");
    expect(markup).not.toContain("结果类型");
    expect(markup).not.toContain("跳转页面");
    expect(markup).not.toContain("页面局部变化");
    expect(markup).not.toContain("复合跳转");
    expect(markup).not.toContain("placeholder=\"搜索已保存页面\"");
    expect(markup).not.toContain("asset-operation-target-options");
    expect(markup).not.toContain("<option value=\"node-public-create\">新建公开课</option>");
    expect(markup).not.toContain("type=\"submit\">确认目标</button>");
    expect(markup).not.toContain("保存可操作元素");
  });

  it("does not render the side-by-side manual operation editor before add or edit", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          elements: [],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageElement: vi.fn()
      })
    );

    expect(markup).toContain("0 个元素");
    expect(markup).not.toContain("asset-manual-action-layout");
    expect(markup).not.toContain("asset-manual-action-region-pane");
    expect(markup).not.toContain("asset-manual-action-fields-pane");
    expect(markup).not.toContain("asset-manual-action-form");
  });

  it("shows saved manual scroll elements without auto candidate sections", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          pageName: "主页",
          elements: [
            {
              label: "班级列表",
              locator: "resource-id: cn.eeo.classin:id/class_list",
              action: "scroll",
              actionKind: "scroll",
              availability: "visible",
              source: "manual",
              scrollProfile: {
                containerKind: "grid_list",
                direction: "vertical",
                columns: 2,
                targetKind: "item_text",
                afterFoundAction: "tap_item"
              }
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("已录入可操作元素");
    expect(markup).toContain("班级列表");
    expect(markup).toContain("滑动");
    expect(markup).toContain("当前可见");
    expect(markup).not.toContain("滑动候选");
    expect(markup).not.toContain("辅助候选");
  });

  it("keeps the edit form embedded in the current saved element row when editing", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "actions",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          elements: [
            {
              id: "manual_element_search",
              label: "搜索按钮",
              locator: "image-region:83.2,6.67,12.31,5.67",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              region: { x: 83.2, y: 6.67, width: 12.31, height: 5.67 }
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageElement: vi.fn()
      })
    );

    expect(markup).toContain("asset-saved-action-item");
    expect(markup).toContain("asset-saved-action-main");
    expect(markup).toContain("asset-action-button edit");
    expect(markup).toContain("asset-action-button delete");
    expect(markup).not.toContain("asset-manual-action-card");
  });

  it("includes scroll container profile when confirming a scroll transition", () => {
    const draft = operationTransitionDraftFromForm(
      {
        actionKind: "scroll",
        abilityType: "grid_candidate",
        availability: "visible",
        outcomeType: "navigate",
        targetNodeId: "node-class-detail",
        targetLabel: "班级详情",
        semanticArea: "content",
        containerKind: "grid_list",
        scrollDirection: "vertical",
        layoutColumns: "2",
        targetKind: "item_text",
        targetQuery: "班级四十一号",
        afterFoundAction: "tap_item"
      },
      {
        sourceNodeId: "node-home",
        locator: "resource-id: cn.eeo.classin:id/class_list",
        elementLabel: "班级列表",
        abilityType: "grid_candidate",
        semanticArea: "content",
        coordinateSpace: "screen"
      }
    );

    expect(draft).toEqual({
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
        afterFoundAction: "tap_item",
        candidateItemHeightPercent: undefined,
        clickSafePoint: { xPercent: 50, yPercent: 28 },
        scrollStepPercent: 65,
        failureStrategy: "try_next_candidate"
      }
    });
  });

  it("lets the panel render semantic area selectors for screenshot regions and manual actions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "match",
        currentPage: {
          status: "matched",
          nodeId: "node-home",
          pageName: "主页",
          screenshotUrl: "/api/devices/device-1/screenshot?force=true&t=7",
          screenshotRegions: [
            {
              id: "region-tabs",
              label: "底部导航",
              x: 2,
              y: 88,
              width: 96,
              height: 8,
              semanticArea: "bottom"
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageElement: vi.fn()
      })
    );

    expect(markup).toContain("aria-label=\"底部导航语义区域\"");
    expect(markup).toContain("<option value=\"bottom\" selected=\"\">底部固定区域</option>");
    expect(markup).toContain("<option value=\"content\">中间内容区域</option>");
    expect(markup).not.toContain("顶部操作区");
    expect(markup).not.toContain("列表/内容容器");
  });

  it("keeps a manual semantic area override on screenshot regions", () => {
    expect(
      applySemanticAreaOverrideToRegion(
        { id: "region-tabs", label: "底部导航", x: 2, y: 72, width: 96, height: 9 },
        "bottom"
      )
    ).toEqual({
      id: "region-tabs",
      label: "底部导航",
      x: 2,
      y: 72,
      width: 96,
      height: 9,
      semanticArea: "bottom",
      coordinateSpace: "screen"
    });
  });

  it("renders a dedicated connection tab for saved page elements and persisted transitions", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "transitions",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-home",
          pageName: "主页",
          elements: [
            {
              id: "manual_grid",
              label: "班级列表",
              locator: "image-region:3,32,91,56",
              action: "tap",
              actionKind: "tap",
              abilityType: "grid_candidate",
              availability: "visible",
              source: "manual",
              semanticArea: "content",
              region: { x: 3, y: 32, width: 91, height: 56 }
            }
          ],
          transitions: [
            {
              id: "edge-home-class",
              name: "主页 -> 班级详情",
              status: "active",
              source: "manual_edit",
              actionSummary: "点击：班级列表",
              actionLocator: "image-region:3,32,91,56",
              actionKind: "tap",
              targetName: "班级详情",
              reliabilityScore: 0.82
            }
          ],
          savedAssets: [
            { id: "node-class-detail", key: "class.detail", name: "班级详情", status: "active" }
          ]
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn()
      })
    );

    expect(markup).toContain("连接边");
    expect(markup).toContain("已录入连接边");
    expect(markup).toContain("可用于路径规划");
    expect(markup).toContain("主页 -&gt; 班级详情");
    expect(markup).toContain("班级列表");
    expect(markup).toContain("由页面能力生成");
    expect(markup).not.toContain("连接边编辑");
    expect(markup).not.toContain("通过页面任务连接");
    expect(markup).not.toContain("确认连接");
    expect(markup).not.toContain("<option value=\"node-class-detail\">班级详情</option>");
  });

  it("renders saved page tasks as editable page-internal tasks", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetRecordingPanel, {
        selectedSerial: "device-1",
        busy: false,
        initialDetailTab: "tasks",
        currentPage: {
          status: "matched",
          graphVersionId: "version-1",
          nodeId: "node-create-lesson",
          pageName: "新建课堂",
          elements: [
            {
              id: "manual-title",
              label: "课堂标题输入框",
              locator: "image-region:8,24,84,8",
              action: "input",
              actionKind: "input",
              availability: "visible",
              source: "manual",
              region: { x: 8, y: 24, width: 84, height: 8 }
            },
            {
              id: "manual-submit",
              label: "发布按钮",
              locator: "image-region:78,91,16,6",
              action: "tap",
              actionKind: "tap",
              availability: "visible",
              source: "manual",
              region: { x: 78, y: 91, width: 16, height: 6 }
            }
          ],
          tasks: [
            {
              id: "task-create-lesson",
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
                  id: "step-submit",
                  order: 2,
                  elementId: "manual-submit",
                  fieldType: "submit",
                  label: "发布"
                }
              ]
            }
          ],
          savedAssets: []
        },
        onPageDraftChange: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        onSaveCurrentPageAsset: vi.fn(),
        onSavePageTask: vi.fn(),
        onDeletePageTask: vi.fn()
      })
    );

    expect(markup).toContain("页面任务");
    expect(markup).toContain("1 个任务");
    expect(markup).toContain("创建课堂");
    expect(markup).toContain("课堂标题(lessonName) → 发布");
    expect(markup).toContain("编辑");
    expect(markup).toContain("删除");
    expect(markup).toContain("+ 添加页面任务");
    expect(markup).toContain("一期可执行：输入文本、点击、选择器、开关、进入子页面、提交、等待文字");
  });

  it("builds page task drafts from selected manual elements", () => {
    const draft = pageTaskDraftFromForm(
      {
        taskId: "task-create-lesson",
        taskName: "创建课堂",
        taskStatus: "active",
        step_0_id: "step-title",
        step_0_elementId: "manual-title",
        step_0_fieldType: "text_input",
        step_0_label: "课堂标题",
        step_0_valueParamKey: "lessonName",
        step_1_elementId: "manual-submit",
        step_1_fieldType: "submit",
        step_1_label: "发布",
        step_2_elementId: "manual-record",
        step_2_fieldType: "toggle_set",
        step_2_label: "录制ClassIn教室",
        step_2_desiredStateParamKey: "recordClassroom",
        step_3_fieldType: "wait",
        step_3_label: "等待发布成功",
        step_3_text: "发布成功"
      },
      {
        sourceNodeId: "node-create-lesson",
        elements: [
          {
            id: "manual-title",
            label: "课堂标题输入框",
            locator: "image-region:8,24,84,8",
            action: "input"
          },
          {
            id: "manual-submit",
            label: "发布按钮",
            locator: "image-region:78,91,16,6",
            action: "tap"
          },
          {
            id: "manual-record",
            label: "录制ClassIn教室",
            locator: "image-region:78,45,16,6",
            action: "tap"
          }
        ]
      }
    );

    expect(draft).toEqual({
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
          valueParamKey: "lessonName",
          text: undefined
        },
        {
          id: undefined,
          order: 2,
          elementId: "manual-submit",
          fieldType: "submit",
          label: "发布",
          valueParamKey: undefined,
          desiredStateParamKey: undefined,
          text: undefined
        },
        {
          id: undefined,
          order: 3,
          elementId: "manual-record",
          fieldType: "toggle_set",
          label: "录制ClassIn教室",
          valueParamKey: undefined,
          desiredStateParamKey: "recordClassroom",
          text: undefined
        },
        {
          id: undefined,
          order: 4,
          elementId: undefined,
          fieldType: "wait",
          label: "等待发布成功",
          valueParamKey: undefined,
          desiredStateParamKey: undefined,
          text: "发布成功"
        }
      ]
    });
  });
});
