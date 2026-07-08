import { describe, expect, it } from "vitest";
import type { BusinessGraph, BusinessGraphVersion, BusinessNode, OperationEdge, StateMatcher, Observation } from "@mobile-automation/graph-core";
import {
  createId,
  defaultAndroidCapabilities,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceEvent,
  type DeviceInfo,
  type MetricSample,
  type StepResult,
  type TestRun
} from "@mobile-automation/shared";
import {
  AssetPatrol,
  assetPatrolStartActions,
  buildAssetPatrolPlan,
  collectAssetRuntimeParamDefinitions,
  normalizeAssetPatrolConfig,
  selectAssetDrivenRecoveryTarget,
  selectAssetDrivenExecutionTarget,
  selectAssetDrivenExecutionTargets,
  shouldAvoidBackRecovery,
  type AssetPatrolStorage
} from "./asset-patrol.js";
import type { AutomationDeviceDriver, DeviceEventWatcher, MobileVideoRecording, ObservedDeviceEvent } from "./mobile-driver.js";
import type { OcrLayoutResult, OcrService } from "./ocr.js";

describe("AssetPatrol", () => {
  it("normalizes current-state patrol defaults without enabling risky actions", () => {
    expect(normalizeAssetPatrolConfig({ packageName: " com.demo " })).toEqual(
      expect.objectContaining({
        packageName: "com.demo",
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMs: 120_000,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatterns: expect.arrayContaining(["删除", "退出登录", "支付", "发布", "提交", "确认"])
      })
    );
  });

  it("diagnoses an unmatched current page and creates no executable checks", () => {
    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "未知页面", region: { x: 100, y: 100, width: 200, height: 80 } }] }),
      graphVersion: graphVersionWithNodes([
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("package", "com.demo", 2), matcher("ocr_text", "主页", 4)]
        })
      ]),
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.status).toBe("diagnostic");
    expect(plan.steps).toEqual([]);
    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "CURRENT_PAGE_NOT_MATCHED",
        severity: "error"
      })
    ]);
  });

  it("explains startup placeholder matches when previewing a non-confirmed root node", () => {
    const plan = buildAssetPatrolPlan({
      observation: observation({
        packageName: "launcher",
        ocrTexts: [{ text: "桌面", region: { x: 100, y: 100, width: 200, height: 80 } }],
        raw: { foreground_package_not: "cn.eeo.classin" }
      }),
      graphVersion: graphVersionWithNodes([
        pageNode({
          id: "node-root",
          key: "classin.app.root",
          name: "ClassIn App 启动前准备态",
          matchers: [matcher("custom", "foreground_package_not=cn.eeo.classin", 8)],
          tags: ["classin", "root"],
          metadata: {
            assetRecordingConfirmed: false
          }
        })
      ]),
      config: normalizeAssetPatrolConfig({ packageName: "cn.eeo.classin", startMode: "restart_app" })
    });

    expect(plan.status).toBe("diagnostic");
    expect(plan.issues[0]?.code).toBe("CURRENT_PAGE_NOT_CONFIRMED");
    expect(plan.issues[0]?.message).toContain("预览计划不会执行启动或重启");
  });

  it("previews a matched page when identity depends on screenshot region enrichment", async () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [
          {
            ...matcher("image_region", "screenshot-region:home-title:%E4%B8%BB%E9%A1%B5", 3),
            threshold: 0.9,
            region: { x: 10, y: 5, width: 40, height: 10 }
          }
        ]
      })
    ]);
    const patrol = new AssetPatrol(
      new MemoryAssetPatrolStorage({ graphVersion }),
      new ScriptedAssetPatrolDriver("com.demo"),
      scriptedOcr([[{ text: "主页", x: 150, y: 160, width: 120, height: 80 }]])
    );

    const plan = await patrol.preview({ deviceSerial: "device-1", packageName: "com.demo" });

    expect(plan.status).toBe("ready");
    expect(plan.startPage).toEqual(expect.objectContaining({ id: "node-home", name: "主页" }));
    expect(plan.steps[0]).toEqual(expect.objectContaining({ kind: "page_match", label: "页面匹配：主页" }));
  });

  it("builds device start actions for launch and restart modes", () => {
    expect(assetPatrolStartActions(normalizeAssetPatrolConfig({ packageName: "cn.eeo.classin", startMode: "current_state" }))).toEqual([]);
    expect(assetPatrolStartActions(normalizeAssetPatrolConfig({ packageName: "cn.eeo.classin", startMode: "launch_app" }))).toEqual([
      { type: "launch_app", packageName: "cn.eeo.classin" }
    ]);
    expect(assetPatrolStartActions(normalizeAssetPatrolConfig({ packageName: "cn.eeo.classin", startMode: "restart_app" }))).toEqual([
      { type: "close_app", packageName: "cn.eeo.classin" },
      { type: "launch_app", packageName: "cn.eeo.classin" }
    ]);
  });

  it("plans page, element, and transition checks from confirmed page assets", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("package", "com.demo", 2), matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-settings",
                label: "设置",
                elementKind: "button",
                locator: "text:设置",
                locatorKind: "text_locator",
                targetText: "设置",
                semanticArea: "bottom",
                coordinateSpace: "runtime",
                actions: ["tap"]
              },
              {
                id: "home-region-only",
                label: "旧坐标区域",
                elementKind: "button",
                locator: "image-region:50,50,10,10",
                locatorKind: "visual_locator",
                semanticArea: "content",
                coordinateSpace: "screen",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-settings",
                elementId: "home-settings",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-settings",
                targetLabel: "设置",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({
          id: "node-settings",
          key: "settings",
          name: "设置",
          matchers: [matcher("ocr_text", "设置", 4)]
        })
      ],
      [
        edge({
          id: "edge-settings",
          fromNodeId: "node-home",
          toNodeId: "node-settings",
          name: "主页 -> 设置",
          actionTitle: "设置",
          action: { type: "tap", x: 900, y: 2100 }
        })
      ]
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "主页", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.status).toBe("ready");
    expect(plan.startPage).toEqual(expect.objectContaining({ id: "node-home", name: "主页" }));
    expect(plan.steps.map((step) => [step.kind, step.label, step.status, step.skipReason])).toEqual(
      expect.arrayContaining([
        ["page_match", "页面匹配：主页", "ready", undefined],
        ["element_relocation", "元素可重定位：设置", "ready", undefined],
        ["element_relocation", "元素可重定位：旧坐标区域", "needs_repair", "runtime_relocation_required"],
        ["transition_validation", "边巡检：主页 -> 设置", "ready", undefined]
      ])
    );
    expect(plan.summary.needsRepair).toBe(1);
  });

  it("keeps legacy page elements and operation edges available alongside V2 assets", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-search",
                label: "搜索",
                elementKind: "icon_button",
                locator: "top-bar-icon:search",
                locatorKind: "top_bar_icon_locator",
                semanticArea: "top",
                coordinateSpace: "runtime",
                actions: ["tap"],
                role: "search",
                slot: "trailing",
                orderFromRight: 2
              },
              {
                id: "home-class-grid",
                label: "班级列表",
                elementKind: "collection",
                locator: "runtime-locator:home_class_grid",
                locatorKind: "collection_item_locator",
                semanticArea: "content",
                coordinateSpace: "runtime",
                actions: ["tap_item"],
                collection: {
                  kind: "vertical_grid",
                  columns: 2,
                  itemIdentity: { type: "ocr_title", param: "className" },
                  candidateItemHeightPercent: 24.5,
                  clickSafePoint: { xPercent: 50, yPercent: 28 },
                  scrollStepPercent: 65,
                  failureStrategy: "try_next_candidate"
                }
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-search",
                elementId: "home-search",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-search",
                targetLabel: "搜索",
                availability: "visible"
              },
              {
                id: "home-open-class-detail",
                elementId: "home-class-grid",
                action: "tap_item",
                outcomeType: "navigate",
                targetNodeId: "node-detail",
                targetLabel: "班级详情",
                availability: "visible",
                params: { itemText: "{{className}}" }
              }
            ],
            assetRecordingManualElements: [
              {
                id: "legacy-settings",
                label: "设置",
                locator: "text:设置",
                locatorKind: "text_locator",
                targetText: "设置",
                actionKind: "tap",
                semanticArea: "bottom",
                outcomeType: "navigate"
              }
            ]
          }
        }),
        pageNode({ id: "node-search", key: "search", name: "搜索", matchers: [matcher("ocr_text", "搜索", 4)] }),
        pageNode({ id: "node-detail", key: "detail", name: "班级详情", matchers: [matcher("ocr_text", "班级详情", 4)] }),
        pageNode({ id: "node-settings", key: "settings", name: "设置", matchers: [matcher("ocr_text", "设置", 4)] })
      ],
      [
        edge({
          id: "legacy-edge-settings",
          fromNodeId: "node-home",
          toNodeId: "node-settings",
          name: "主页 -> 设置",
          actionTitle: "设置",
          action: { type: "tap", x: 100, y: 100 }
        })
      ]
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "主页", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({
        packageName: "com.demo",
        runtimeParams: { className: "班级四十二号" }
      })
    });

    expect(plan.status).toBe("ready");
    expect(plan.steps.map((step) => step.pageElementId).filter(Boolean)).toEqual(["home-search", "home-class-grid", "legacy-settings"]);
    expect(plan.steps.map((step) => step.pageTransitionId).filter(Boolean)).toEqual([
      "edge_pagetransition.home.search.home.open.search",
      "edge_pagetransition.home.detail.home.open.class.detail",
      "legacy-edge-settings"
    ]);
    expect(plan.steps.find((step) => step.pageElementId === "legacy-settings")?.evidence).toEqual(expect.objectContaining({ assetFormat: "legacy" }));
    expect(plan.steps.find((step) => step.pageTransitionId === "legacy-edge-settings")?.evidence).toEqual(expect.objectContaining({ assetFormat: "legacy" }));
    expect(plan.steps.find((step) => step.pageElementId === "home-search")?.evidence).toEqual(expect.objectContaining({ assetFormat: "v2" }));
    expect(plan.steps.find((step) => step.pageTransitionId === "edge_pagetransition.home.search.home.open.search")?.evidence).toEqual(expect.objectContaining({ assetFormat: "v2" }));
    expect(plan.summary).toEqual(
      expect.objectContaining({
        pageChecks: 1,
        elementChecks: 3,
        transitionChecks: 3,
        needsRepair: 0
      })
    );
  });

  it("does not report NO_PAGE_ASSETS when only legacy assets are available", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingManualElements: [
              {
                id: "legacy-settings",
                label: "设置",
                locator: "text:设置",
                locatorKind: "text_locator",
                targetText: "设置",
                actionKind: "tap",
                semanticArea: "bottom",
                outcomeType: "navigate"
              }
            ]
          }
        }),
        pageNode({ id: "node-settings", key: "settings", name: "设置", matchers: [matcher("ocr_text", "设置", 4)] })
      ],
      [
        edge({
          id: "legacy-edge-settings",
          fromNodeId: "node-home",
          toNodeId: "node-settings",
          name: "主页 -> 设置",
          actionTitle: "设置",
          action: { type: "tap", x: 100, y: 100 }
        })
      ]
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "主页", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.status).toBe("ready");
    expect(plan.issues.some((issue) => issue.code === "NO_PAGE_ASSETS")).toBe(false);
    expect(plan.steps.find((step) => step.pageElementId === "legacy-settings")).toEqual(
      expect.objectContaining({
        kind: "element_relocation",
        status: "ready"
      })
    );
    expect(plan.steps.find((step) => step.pageTransitionId === "legacy-edge-settings")).toEqual(
      expect.objectContaining({
        kind: "transition_validation",
        status: "ready"
      })
    );
  });

  it("accepts V2 image-region elements when their visible label is present on the current page", () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [matcher("ocr_text", "主页", 4)],
        metadata: {
          assetRecordingPageElements: [
            {
              id: "home-public-lesson",
              label: "创建公开课",
              targetText: "创建公开课",
              elementKind: "button",
              locator: "image-region:53.85,15.84,38.63,7.33",
              locatorKind: "visual_locator",
              semanticArea: "content",
              coordinateSpace: "screen",
              actions: ["tap"]
            }
          ]
        }
      })
    ]);

    const plan = buildAssetPatrolPlan({
      observation: observation({
        ocrTexts: [
          { text: "主页", region: { x: 100, y: 100, width: 100, height: 60 } },
          { text: "创建公开课", region: { x: 580, y: 380, width: 260, height: 80 } }
        ]
      }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.steps.find((step) => step.pageElementId === "home-public-lesson")).toEqual(
      expect.objectContaining({
        kind: "element_relocation",
        status: "ready",
        skipReason: undefined,
        evidence: expect.objectContaining({
          targetText: "创建公开课"
        })
      })
    );
    expect(plan.summary.needsRepair).toBe(0);
  });

  it("does not accept broad element labels when only a short OCR substring is present", () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [matcher("ocr_text", "主页", 4)],
        metadata: {
          assetRecordingPageElements: [
            {
              id: "home-tab-strip",
              label: "主页列表分类tab",
              elementKind: "button",
              locator: "image-region:2.07,25.44,95.53,4.97",
              locatorKind: "visual_locator",
              semanticArea: "content",
              coordinateSpace: "screen",
              actions: ["scroll"]
            }
          ]
        }
      })
    ]);

    const plan = buildAssetPatrolPlan({
      observation: observation({
        ocrTexts: [
          { text: "主页", region: { x: 100, y: 100, width: 100, height: 60 } },
          { text: "全部班级", region: { x: 100, y: 700, width: 160, height: 60 } }
        ]
      }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.steps.find((step) => step.pageElementId === "home-tab-strip")).toEqual(
      expect.objectContaining({
        kind: "element_relocation",
        status: "needs_repair",
        skipReason: "runtime_relocation_required",
        evidence: expect.not.objectContaining({
          targetText: "主页列表分类tab"
        })
      })
    );
    expect(plan.summary.needsRepair).toBe(1);
  });

  it("accepts grid candidate elements when className runtime parameter can drive OCR search", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-class-grid",
                label: "班级列表",
                elementKind: "collection",
                locator: "runtime-locator:home_class_grid",
                locatorKind: "collection_item_locator",
                semanticArea: "content",
                coordinateSpace: "runtime",
                actions: ["tap_item"],
                collection: {
                  kind: "vertical_grid",
                  columns: 2,
                  itemIdentity: { type: "ocr_title", param: "className" },
                  candidateItemHeightPercent: 24.5,
                  clickSafePoint: { xPercent: 50, yPercent: 28 },
                  scrollStepPercent: 65
                }
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-class-detail",
                elementId: "home-class-grid",
                action: "tap_item",
                outcomeType: "navigate",
                targetNodeId: "node-detail",
                targetLabel: "班级详情",
                availability: "visible",
                params: { itemText: "{{className}}" }
              }
            ]
          }
        }),
        pageNode({
          id: "node-detail",
          key: "detail",
          name: "班级详情",
          matchers: [matcher("ocr_text", "班级详情", 4)]
        })
      ],
      []
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({
        ocrTexts: [{ text: "主页", region: { x: 100, y: 100, width: 100, height: 60 } }]
      }),
      graphVersion,
      config: normalizeAssetPatrolConfig({
        packageName: "com.demo",
        runtimeParams: {
          className: "班级四十二号"
        }
      })
    });

    expect(plan.summary.needsRepair).toBe(0);
    expect(plan.steps.find((step) => step.pageElementId === "home-class-grid")).toEqual(
      expect.objectContaining({
        status: "ready",
        evidence: expect.objectContaining({
          parameterizedBy: "className"
        })
      })
    );
    expect(plan.steps.find((step) => step.pageTransitionId === "edge_pagetransition.home.detail.home.open.class.detail")).toEqual(
      expect.objectContaining({
        status: "ready",
        evidence: expect.objectContaining({
          parameterizedBy: "className"
        })
      })
    );
  });

  it("accepts OCR anchor offset elements and transitions when the anchor text is visible", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-profile-entry",
                label: "个人入口",
                elementKind: "icon_button",
                locator: "ocr-anchor:主页@offset(-11.5,0)",
                locatorKind: "ocr_anchor_offset",
                anchorText: "主页",
                targetText: "主页",
                anchorOffsetPercent: { x: -11.5, y: 0 },
                semanticArea: "top",
                coordinateSpace: "runtime",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-settings",
                elementId: "home-profile-entry",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-settings",
                targetLabel: "设置",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({
          id: "node-settings",
          key: "settings",
          name: "设置",
          matchers: [matcher("ocr_text", "设置", 4)]
        })
      ],
      []
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "主页", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.summary.needsRepair).toBe(0);
    expect(plan.steps.find((step) => step.pageElementId === "home-profile-entry")).toEqual(
      expect.objectContaining({
        status: "ready",
        evidence: expect.objectContaining({
          locatorKind: "ocr_anchor_offset",
          targetText: "主页"
        })
      })
    );
    expect(plan.steps.find((step) => step.pageTransitionId === "edge_pagetransition.home.settings.home.open.settings")).toEqual(
      expect.objectContaining({
        status: "ready",
        evidence: expect.objectContaining({
          targetText: "主页"
        })
      })
    );
  });

  it("marks OCR anchor offset elements as needing repair when the anchor text is missing", () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [matcher("package", "com.demo", 2)],
        metadata: {
          assetRecordingPageElements: [
            {
              id: "home-profile-entry",
              label: "个人入口",
              elementKind: "icon_button",
              locator: "ocr-anchor:主页@offset(-11.5,0)",
              locatorKind: "ocr_anchor_offset",
              anchorText: "主页",
              targetText: "主页",
              anchorOffsetPercent: { x: -11.5, y: 0 },
              semanticArea: "top",
              coordinateSpace: "runtime",
              actions: ["tap"]
            }
          ]
        }
      })
    ]);

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "消息", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.steps.find((step) => step.pageElementId === "home-profile-entry")).toEqual(
      expect.objectContaining({
        status: "needs_repair",
        skipReason: "runtime_relocation_required"
      })
    );
  });

  it("skips dangerous transitions by default", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-settings",
          key: "settings",
          name: "设置",
          matchers: [matcher("ocr_text", "设置", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "settings-logout",
                label: "退出登录",
                targetText: "退出登录",
                elementKind: "button",
                locator: "text:退出登录",
                locatorKind: "text_locator",
                semanticArea: "content",
                coordinateSpace: "runtime",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "settings-logout-to-login",
                elementId: "settings-logout",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-login",
                targetLabel: "登录",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({ id: "node-login", key: "login", name: "登录", matchers: [matcher("ocr_text", "登录", 4)] })
      ],
      []
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "设置", region: { x: 120, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.steps.find((step) => step.pageTransitionId === "edge_pagetransition.settings.login.settings.logout.to.login")).toEqual(
      expect.objectContaining({
        kind: "transition_validation",
        status: "skipped",
        skipReason: "dangerous_action"
      })
    );
  });

  it("marks image-region transitions without visible text or visual template as needing repair", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("package", "com.demo", 2), matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-add-friend",
                label: "打开更多菜单并选择添加好友",
                elementKind: "icon_button",
                locator: "image-region:84.78,8.14,7.73,3.69",
                locatorKind: "visual_locator",
                semanticArea: "top",
                coordinateSpace: "screen",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-add-friend",
                elementId: "home-add-friend",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-add-friend",
                targetLabel: "添加好友",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({
          id: "node-add-friend",
          key: "add-friend",
          name: "添加好友",
          matchers: [matcher("ocr_text", "添加好友", 4)]
        })
      ],
      []
    );

    const plan = buildAssetPatrolPlan({
      observation: observation({
        ocrTexts: [
          { text: "主页", region: { x: 180, y: 180, width: 120, height: 80 } },
          { text: "创建班级", region: { x: 80, y: 360, width: 180, height: 90 } }
        ]
      }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(plan.steps.find((step) => step.pageTransitionId === "edge_pagetransition.home.add.friend.home.open.add.friend")).toEqual(
      expect.objectContaining({
        kind: "transition_validation",
        status: "needs_repair",
        skipReason: "runtime_relocation_required",
        evidence: expect.objectContaining({
          targetText: "打开更多菜单并选择添加好友",
          visualLocator: false
        })
      })
    );
  });

  it("selects a ready transition as a real asset-driven execution target", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-login",
          key: "login",
          name: "登录",
          matchers: [matcher("ocr_text", "登录", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "login-submit",
                label: "登录",
                targetText: "登录",
                elementKind: "button",
                locator: "text:登录",
                locatorKind: "text_locator",
                semanticArea: "content",
                coordinateSpace: "runtime",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "login-submit-home",
                elementId: "login-submit",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-home",
                targetLabel: "主页",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({ id: "node-home", key: "home", name: "主页", matchers: [matcher("ocr_text", "主页", 4)] })
      ]
    );
    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "登录", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo", allowBusinessSubmit: true })
    });

    const target = selectAssetDrivenExecutionTarget({
      plan,
      graphVersion,
      config: normalizeAssetPatrolConfig({
        packageName: "com.demo",
        allowBusinessSubmit: true,
        runtimeParams: { phone: "18743085313", password: "secret" }
      })
    });

    expect(target).toEqual(
      expect.objectContaining({
        status: "ready",
        graphVersionId: graphVersion.id,
        startNodeId: "node-login",
        targetNodeId: "node-home",
        transitionId: "edge_pagetransition.login.home.login.submit.home"
      })
    );
    if (target.status === "ready") {
      expect(target.overlay).toEqual(
        expect.objectContaining({
          targetNodeId: "node-home",
          runtimeParams: {
            phone: "18743085313",
            password: "secret"
          }
        })
      );
    }
  });

  it("blocks source page navigation task execution until business submit is explicitly allowed", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-login",
          key: "login",
          name: "登录",
          matchers: [matcher("ocr_text", "登录", 4)],
          metadata: {
            assetRecordingPageTasks: [
              {
                id: "task-account-password-login",
                name: "账号密码登录",
                status: "active",
                steps: [{ id: "task-step-submit", order: 1, elementId: "login-submit", fieldType: "button", label: "登录" }]
              }
            ]
          }
        }),
        pageNode({ id: "node-home", key: "home", name: "主页", matchers: [matcher("ocr_text", "主页", 4)] })
      ]
    );
    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "登录", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(selectAssetDrivenExecutionTarget({ plan, graphVersion, config: normalizeAssetPatrolConfig({ packageName: "com.demo" }) })).toEqual(
      expect.objectContaining({
        status: "blocked",
        code: "BUSINESS_SUBMIT_DISABLED"
      })
    );
  });

  it("selects V2 page transitions before page task dry-runs when executing assets", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-login",
          key: "login",
          name: "登录",
          matchers: [matcher("ocr_text", "登录", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "login-register",
                label: "立即注册",
                targetText: "立即注册",
                elementKind: "button",
                locator: "text:立即注册",
                locatorKind: "text_locator",
                semanticArea: "top",
                coordinateSpace: "runtime",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "login-open-register",
                elementId: "login-register",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-register",
                targetLabel: "注册",
                availability: "visible"
              }
            ],
            assetRecordingPageTasks: [
              {
                id: "task-account-password-login",
                name: "账号密码登录",
                status: "active",
                steps: [{ id: "task-step-submit", order: 1, elementId: "login-submit", fieldType: "button", label: "登录" }]
              }
            ]
          }
        }),
        pageNode({ id: "node-register", key: "register", name: "注册", matchers: [matcher("ocr_text", "注册", 4)] }),
        pageNode({ id: "node-home", key: "home", name: "主页", matchers: [matcher("ocr_text", "主页", 4)] })
      ]
    );
    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "登录", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo", allowBusinessSubmit: true })
    });

    expect(selectAssetDrivenExecutionTarget({ plan, graphVersion, config: normalizeAssetPatrolConfig({ packageName: "com.demo", allowBusinessSubmit: true }) })).toEqual(
      expect.objectContaining({
        status: "ready",
        transitionId: "edge_pagetransition.login.register.login.open.register",
        targetNodeId: "node-register"
      })
    );
  });

  it("selects all ready current-page transitions for asset-driven execution", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-settings",
                label: "设置",
                targetText: "设置",
                elementKind: "button",
                locator: "text:设置",
                locatorKind: "text_locator",
                semanticArea: "bottom",
                coordinateSpace: "runtime",
                actions: ["tap"]
              },
              {
                id: "home-add-friend",
                label: "添加好友",
                targetText: "添加好友",
                elementKind: "button",
                locator: "text:添加好友",
                locatorKind: "text_locator",
                semanticArea: "top",
                coordinateSpace: "runtime",
                actions: ["tap"]
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-settings",
                elementId: "home-settings",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-settings",
                targetLabel: "设置",
                availability: "visible"
              },
              {
                id: "home-open-add-friend",
                elementId: "home-add-friend",
                action: "tap",
                outcomeType: "navigate",
                targetNodeId: "node-add-friend",
                targetLabel: "添加好友",
                availability: "visible"
              }
            ]
          }
        }),
        pageNode({ id: "node-settings", key: "settings", name: "设置", matchers: [matcher("ocr_text", "设置", 4)] }),
        pageNode({ id: "node-add-friend", key: "add-friend", name: "添加好友", matchers: [matcher("ocr_text", "添加好友", 4)] })
      ]
    );
    const plan = buildAssetPatrolPlan({
      observation: observation({ ocrTexts: [{ text: "主页", region: { x: 150, y: 200, width: 120, height: 80 } }] }),
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    const targets = selectAssetDrivenExecutionTargets({
      plan,
      graphVersion,
      config: normalizeAssetPatrolConfig({ packageName: "com.demo" })
    });

    expect(targets).toEqual(
      expect.objectContaining({
        status: "ready",
        startNodeId: "node-home",
        targets: [
          expect.objectContaining({ transitionId: "edge_pagetransition.home.settings.home.open.settings", targetNodeId: "node-settings" }),
          expect.objectContaining({ transitionId: "edge_pagetransition.home.add.friend.home.open.add.friend", targetNodeId: "node-add-friend" })
        ]
      })
    );
  });

  it("selects a direct page recovery edge before falling back to device back", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({ id: "node-home", key: "home", name: "主页", matchers: [matcher("ocr_text", "主页", 4)] }),
        pageNode({ id: "node-growth", key: "growth", name: "成长", matchers: [matcher("ocr_text", "成长", 4)] })
      ],
      [
        edge({
          id: "edge-growth-home",
          fromNodeId: "node-growth",
          toNodeId: "node-home",
          name: "成长 -> 主页",
          action: { type: "tap", x: 90, y: 2200 }
        })
      ]
    );

    const target = selectAssetDrivenRecoveryTarget({
      graphVersion,
      currentNodeId: "node-growth",
      startNodeId: "node-home",
      runtimeParams: { className: "班级四十二号" }
    });

    expect(target).toEqual(
      expect.objectContaining({
        status: "ready",
        graphVersionId: "graph-version-1",
        startNodeId: "node-growth",
        startNodeName: "成长",
        targetNodeId: "node-home",
        targetNodeName: "主页",
        transitionId: "edge-growth-home",
        transitionName: "成长 -> 主页",
        overlay: expect.objectContaining({
          targetNodeId: "node-home",
          runtimeParams: { className: "班级四十二号" }
        })
      })
    );
  });

  it("does not select a page recovery edge when the current page is already the start page", () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({ id: "node-home", key: "home", name: "主页", matchers: [matcher("ocr_text", "主页", 4)] })
    ]);

    expect(selectAssetDrivenRecoveryTarget({ graphVersion, currentNodeId: "node-home", startNodeId: "node-home" })).toBeUndefined();
  });

  it("does not allow device back as recovery between bottom tab pages", () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [matcher("ocr_text", "主页", 4)],
        metadata: {
          screenshotRegions: [{ id: "home-tab", semanticArea: "bottom", label: "首页底部选中态" }]
        }
      }),
      pageNode({
        id: "node-growth",
        key: "growth",
        name: "成长",
        matchers: [matcher("ocr_text", "成长", 4)],
        metadata: {
          intentTags: ["bottom-tab", "growth"]
        }
      })
    ]);

    expect(shouldAvoidBackRecovery({ graphVersion, currentNodeId: "node-growth", startNodeId: "node-home" })).toBe(true);
  });

  it("collects runtime parameter definitions from all active page tasks in the graph", () => {
    const graphVersion = graphVersionWithNodes(
      [
        pageNode({
          id: "node-login",
          key: "login",
          name: "登录",
          matchers: [matcher("ocr_text", "登录", 4)],
          metadata: {
            assetRecordingPageTasks: [
              {
                id: "task-login",
                name: "账号密码登录",
                status: "active",
                steps: [
                  { id: "task-step-phone", order: 1, elementId: "phone", fieldType: "text_input", label: "手机号输入框", valueParamKey: "phone" },
                  { id: "task-step-password", order: 2, elementId: "password", fieldType: "text_input", label: "密码输入框", valueParamKey: "password" }
                ]
              }
            ]
          }
        }),
        pageNode({
          id: "node-home",
          key: "home",
          name: "主页",
          matchers: [matcher("ocr_text", "主页", 4)],
          metadata: {
            assetRecordingPageElements: [
              {
                id: "home-class-grid",
                label: "班级列表",
                elementKind: "collection",
                locator: "runtime-locator:home_class_grid",
                locatorKind: "collection_item_locator",
                semanticArea: "content",
                coordinateSpace: "runtime",
                actions: ["tap_item"],
                collection: {
                  kind: "vertical_grid",
                  columns: 2,
                  itemIdentity: { type: "ocr_title", param: "className" },
                  candidateItemHeightPercent: 24.5,
                  clickSafePoint: { xPercent: 50, yPercent: 28 },
                  scrollStepPercent: 65
                }
              }
            ],
            assetRecordingPageTransitions: [
              {
                id: "home-open-class-detail",
                elementId: "home-class-grid",
                action: "tap_item",
                outcomeType: "navigate",
                targetNodeId: "node-detail",
                targetLabel: "班级详情",
                availability: "visible",
                params: { itemText: "{{className}}" }
              }
            ]
          }
        }),
        pageNode({
          id: "node-detail",
          key: "class_detail",
          name: "班级详情",
          matchers: [matcher("ocr_text", "班级详情", 4)]
        }),
        pageNode({
          id: "node-create",
          key: "create_lesson",
          name: "新建公开课",
          matchers: [matcher("ocr_text", "新建公开课", 4)],
          metadata: {
            assetRecordingPageTasks: [
              {
                id: "task-create-lesson",
                name: "创建课堂",
                status: "active",
                steps: [
                  { id: "task-step-title", order: 1, elementId: "title", fieldType: "text_input", label: "课堂标题", valueParamKey: "lessonName" },
                  { id: "task-step-record", order: 2, elementId: "record", fieldType: "toggle_set", label: "录制ClassIn教室", desiredStateParamKey: "recordClassroom" }
                ]
              },
              {
                id: "task-old",
                name: "旧任务",
                status: "deprecated",
                steps: [{ id: "task-step-old", order: 1, elementId: "old", fieldType: "text_input", valueParamKey: "oldValue" }]
              }
            ]
          }
        })
      ]
    );

    const definitions = collectAssetRuntimeParamDefinitions(graphVersion);

    expect(definitions.map((item) => item.key)).toEqual(["phone", "password", "lessonName", "recordClassroom", "className"]);
    expect(definitions.find((item) => item.key === "password")?.usages).toEqual([
      expect.objectContaining({
        pageModelName: "登录",
        taskName: "账号密码登录",
        stepLabel: "密码输入框",
        fieldType: "text_input",
        binding: "value"
      })
    ]);
    expect(definitions.find((item) => item.key === "className")?.usages).toEqual([
      expect.objectContaining({
        pageModelName: "主页",
        taskName: "主页 -> 班级详情",
        fieldType: "grid_candidate",
        binding: "value"
      })
    ]);
    expect(definitions.some((item) => item.key === "oldValue")).toBe(false);
  });

  it("creates a run with dry-run patrol results and report artifacts", async () => {
    const graphVersion = graphVersionWithNodes([
      pageNode({
        id: "node-home",
        key: "home",
        name: "主页",
        matchers: [matcher("package", "com.demo", 2), matcher("ocr_text", "主页", 4)],
        metadata: {
          assetRecordingPageElements: [
            {
              id: "home-settings",
              label: "设置",
              elementKind: "button",
              locator: "text:设置",
              locatorKind: "text_locator",
              targetText: "设置",
              semanticArea: "bottom",
              coordinateSpace: "runtime",
              actions: ["tap"]
            },
            {
              id: "home-region-only",
              label: "旧坐标区域",
              elementKind: "button",
              locator: "image-region:50,50,10,10",
              locatorKind: "visual_locator",
              semanticArea: "content",
              coordinateSpace: "screen",
              actions: ["tap"]
            }
          ]
        }
      })
    ]);
    const storage = new MemoryAssetPatrolStorage({ graphVersion });
    const driver = new ScriptedAssetPatrolDriver("com.demo");
    const patrol = new AssetPatrol(storage, driver, scriptedOcr([[{ text: "主页", x: 150, y: 200, width: 120, height: 80 }]]));

    const run = patrol.start({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxTransitions: 2
    });
    await patrol.waitForRun(run.id);

    const completed = storage.getRun(run.id)!;
    expect(driver.actions).toEqual([]);
    expect(completed.status).toBe("failed");
    expect(completed.config.runKind).toBe("asset_patrol");
    expect(completed.config.assetPatrol).toEqual(expect.objectContaining({ packageName: "com.demo", startMode: "current_state" }));
    expect(completed.stepResults.map((step) => step.status)).toEqual(["passed", "passed", "failed"]);
    expect(completed.stepResults[0]?.metadata?.assetPatrol).toEqual(
      expect.objectContaining({
        kind: "page_match",
        pageModelId: "node-home",
        executionMode: "diagnostic"
      })
    );
    expect(completed.stepResults.at(-1)?.metadata?.assetPatrol).toEqual(
      expect.objectContaining({
        skipReason: "runtime_relocation_required",
        pageElementId: "home-region-only"
      })
    );
    expect(completed.artifacts.some((artifact) => artifact.type === "report_json" && artifact.name === "asset-patrol-summary.json")).toBe(true);
    expect(completed.reportHtmlPath).toBe("runs/asset-patrol-run/reports/report.html");
  });
});

function observation(input: {
  packageName?: string;
  ocrTexts?: Array<{ text: string; region?: { x: number; y: number; width: number; height: number } }>;
  raw?: Record<string, unknown>;
} = {}): Observation {
  return {
    platform: "android",
    capturedAt: nowIso(),
    packageName: input.packageName ?? "com.demo",
    resolution: { width: 1080, height: 2400 },
    uiElements: [],
    ocrTexts: (input.ocrTexts ?? []).map((item) => ({
      text: item.text,
      source: "ocr",
      confidence: 0.9,
      region: item.region
    })),
    raw: input.raw
  };
}

function scriptedOcr(script: Array<Array<{ text: string; x: number; y: number; width: number; height: number }>>): OcrService {
  let index = 0;
  return {
    async recognize() {
      const boxes = script[Math.min(index, script.length - 1)] ?? [];
      return { text: boxes.map((box) => box.text).join("\n"), engine: "mock", lang: "zh" };
    },
    async locateText(): Promise<OcrLayoutResult> {
      const boxes = script[Math.min(index, script.length - 1)] ?? [];
      index += 1;
      return {
        text: boxes.map((box) => box.text).join("\n"),
        engine: "mock",
        lang: "zh",
        width: 1080,
        height: 2400,
        boxes: boxes.map((box) => ({ ...box, confidence: 0.92 }))
      };
    }
  };
}

class ScriptedAssetPatrolDriver implements AutomationDeviceDriver {
  readonly actions: DeviceActionRequest[] = [];
  private readonly device: DeviceInfo = {
    id: "device-1",
    serial: "device-1",
    platform: "android",
    name: "巡检设备",
    status: "online",
    resolution: { width: 1080, height: 2400 },
    orientation: "portrait",
    capabilities: { ...defaultAndroidCapabilities(), recordVideo: false },
    lastSeenAt: nowIso()
  };

  constructor(private foregroundPackage = "launcher") {}

  async getToolStatus() {
    return [];
  }

  async listDevices() {
    return [this.device];
  }

  async getDeviceInfo(serial: string) {
    this.assertDevice(serial);
    return this.device;
  }

  async screenshot(serial: string) {
    this.assertDevice(serial);
    return Buffer.from("screenshot");
  }

  async getForegroundApp(serial: string) {
    this.assertDevice(serial);
    return { packageName: this.foregroundPackage, activityName: `${this.foregroundPackage}.MainActivity` };
  }

  async dumpUiHierarchy() {
    return "<hierarchy/>";
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    this.assertDevice(serial);
    this.actions.push(action);
    if (action.type === "launch_app") {
      this.foregroundPackage = action.packageName;
    }
    return { driverChannel: "mock" };
  }

  async clearAppData() {}

  async collectLogs() {
    return "";
  }

  async watchDeviceEvents(_serial: string, _onEvent: (event: ObservedDeviceEvent) => void): Promise<DeviceEventWatcher> {
    return { stop: async () => undefined };
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    this.assertDevice(serial);
    return {
      id: createId("metric"),
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      cpuPercent: 1,
      memoryUsedKb: 64 * 1024,
      memoryTotalKb: 512 * 1024,
      batteryLevel: 80
    };
  }

  async startVideoRecording(_serial: string, runId: string, localDir: string): Promise<MobileVideoRecording> {
    return { id: runId, serial: "device-1", localPath: `${localDir}/${runId}.mp4`, startedAt: nowIso(), kind: "screenrecord", process: {} as never };
  }

  async stopVideoRecording() {
    return undefined;
  }

  private assertDevice(serial: string): void {
    if (serial !== "device-1") {
      throw new Error(`unknown device ${serial}`);
    }
  }
}

class MemoryAssetPatrolStorage implements AssetPatrolStorage {
  private readonly runs = new Map<string, TestRun>();
  private readonly graph?: BusinessGraph;
  private readonly graphVersion?: BusinessGraphVersion;

  constructor(input: { graphVersion?: BusinessGraphVersion } = {}) {
    this.graphVersion = input.graphVersion;
    this.graph = input.graphVersion
      ? {
          id: input.graphVersion.graphId,
          appId: "com.demo",
          targetApp: { androidPackageName: "com.demo" },
          platformScope: "android",
          name: "Demo 图谱",
          status: "active",
          activeVersionId: input.graphVersion.id,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      : undefined;
  }

  createRun(input: { caseId?: string; caseName: string; deviceSerial: string; configJson: string; caseSnapshotJson: string; steps: ActionStep[] }): TestRun {
    const run: TestRun = {
      id: "asset-patrol-run",
      caseId: input.caseId,
      caseName: input.caseName,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: JSON.parse(input.configJson),
      steps: input.steps,
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: nowIso()
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): TestRun | undefined {
    return this.runs.get(id);
  }

  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.status = status;
      if (!["pending", "running", "paused"].includes(status)) {
        run.endedAt = endedAt ?? nowIso();
      }
    }
  }

  addStepResult(result: StepResult): void {
    this.runs.get(result.runId)?.stepResults.push(result);
  }

  addMetricSample(sample: MetricSample): void {
    this.runs.get(sample.runId)?.metrics.push(sample);
  }

  addDeviceEvent(event: DeviceEvent): void {
    this.runs.get(event.runId)?.events.push(event);
  }

  async writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }> {
    return { absolutePath: relativePath, sizeBytes: Buffer.byteLength(bytes) };
  }

  addArtifact(artifact: ArtifactRef): void {
    this.runs.get(artifact.runId ?? "")?.artifacts.push(artifact);
  }

  updateRunReport(runId: string, relativePath: string): void {
    const run = this.runs.get(runId);
    if (run) {
      run.reportHtmlPath = relativePath;
    }
  }

  listRunIdsByStatus(status: TestRun["status"]): string[] {
    return Array.from(this.runs.values()).filter((run) => run.status === status).map((run) => run.id);
  }

  listBusinessGraphs(): BusinessGraph[] {
    return this.graph ? [this.graph] : [];
  }

  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined {
    return id === this.graphVersion?.id ? this.graphVersion : undefined;
  }
}

function graphVersionWithNodes(nodes: BusinessNode[], edges: OperationEdge[] = []): BusinessGraphVersion {
  return {
    id: "graph-version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges,
    createdAt: nowIso()
  };
}

function pageNode(input: {
  id: string;
  key: string;
  name: string;
  matchers: StateMatcher[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}): BusinessNode {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    key: input.key,
    name: input.name,
    nodeType: "page",
    tags: input.tags ?? ["page-asset", "asset-recording"],
    status: "active",
    matchers: input.matchers,
    defaultExpectations: [],
    platformScope: "android",
    metadata: {
      assetRecordingConfirmed: true,
      ...input.metadata
    }
  };
}

function matcher(type: StateMatcher["type"], value: string, weight: number): StateMatcher {
  return {
    id: `matcher-${type}-${value}`,
    type,
    value,
    weight,
    critical: type !== "package",
    platformScope: "android"
  };
}

function edge(input: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
  intent?: string;
  actionTitle?: string;
  action: DeviceActionRequest;
}): OperationEdge {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.id,
    name: input.name,
    intent: input.intent ?? input.name,
    status: "active",
    source: "manual_recording",
    preconditions: [],
    actionPolicies: [
      {
        id: `${input.id}-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "high",
        action: actionStepFromDeviceAction(input.id, input.action, input.actionTitle ?? input.name)
      }
    ],
    expectations: [],
    reliabilityScore: 0.9,
    platformScope: "android"
  };
}

function ocrAnchorTransitionEdge(input: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
}): OperationEdge {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.id,
    name: input.name,
    intent: input.name,
    status: "active",
    source: "manual_recording",
    preconditions: [],
    actionPolicies: [
      {
        id: `${input.id}-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "high",
        action: {
          id: `${input.id}-action`,
          order: 1,
          type: "tap_on_image",
          title: "个人入口",
          enabled: true,
          params: {
            locator: "ocr-anchor:主页@offset(-11.5,0)",
            locatorKind: "ocr_anchor_offset",
            anchorText: "主页",
            targetText: "主页",
            anchorOffsetPercent: { x: -11.5, y: 0 },
            semanticArea: "top"
          },
          createdAt: nowIso()
        }
      }
    ],
    expectations: [],
    reliabilityScore: 0.9,
    platformScope: "android"
  };
}

function imageRegionTransitionEdge(input: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
  region: { x: number; y: number; width: number; height: number };
  elementLabel: string;
  targetText?: string;
  visualLocator?: Record<string, unknown>;
}): OperationEdge {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.id,
    name: input.name,
    intent: input.name,
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: [
      {
        id: `${input.id}-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "medium",
        action: {
          id: `${input.id}-action`,
          order: 1,
          type: "tap_on_image",
          title: input.elementLabel,
          enabled: true,
          params: {
            region: input.region,
            targetMode: "image_region",
            locator: `image-region:${input.region.x},${input.region.y},${input.region.width},${input.region.height}`,
            semanticArea: "top",
            elementLabel: input.elementLabel,
            ...(input.targetText ? { targetText: input.targetText } : {}),
            ...(input.visualLocator ? { visualLocator: input.visualLocator } : {})
          },
          createdAt: nowIso()
        }
      }
    ],
    expectations: [],
    reliabilityScore: 0.82,
    platformScope: "android"
  };
}

function gridCandidateEdge(input: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
}): OperationEdge {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.id,
    name: input.name,
    intent: input.name,
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: [
      {
        id: `${input.id}-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "medium",
        action: {
          id: `${input.id}-action`,
          order: 1,
          type: "tap_on_image",
          title: "点击：班级列表",
          enabled: true,
          params: {
            region: { x: 3, y: 30, width: 94, height: 59 },
            targetMode: "image_region",
            locator: "image-region:3,30,94,59",
            elementLabel: "班级列表",
            availability: "visible",
            abilityType: "grid_candidate",
            scrollProfile: {
              containerKind: "grid_list",
              direction: "vertical",
              columns: 2,
              targetKind: "nth_item",
              afterFoundAction: "tap_item",
              candidateItemHeightPercent: 24.5,
              clickSafePoint: { xPercent: 50, yPercent: 28 },
              scrollStepPercent: 65
            }
          },
          createdAt: nowIso()
        }
      }
    ],
    expectations: [],
    reliabilityScore: 0.82,
    platformScope: "android"
  };
}

function taskNavigationEdge(input: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  name: string;
  taskId: string;
  taskName: string;
}): OperationEdge {
  return {
    id: input.id,
    graphVersionId: "graph-version-1",
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    key: input.id,
    name: input.name,
    intent: input.name,
    status: "active",
    source: "manual_recording",
    preconditions: [],
    actionPolicies: [
      {
        id: `${input.id}-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "high",
        action: {
          id: `${input.id}-action`,
          order: 1,
          type: "wait",
          title: input.taskName,
          enabled: true,
          params: {
            taskId: input.taskId,
            taskMode: "source_page_navigation",
            pageTaskName: input.taskName
          },
          createdAt: nowIso()
        }
      }
    ],
    expectations: [],
    reliabilityScore: 0.9,
    platformScope: "android"
  };
}

function actionStepFromDeviceAction(id: string, action: DeviceActionRequest, title: string): ActionStep {
  const now = nowIso();
  if (action.type === "tap") {
    return {
      id: `${id}-action`,
      order: 1,
      type: "tap",
      title,
      enabled: true,
      params: {},
      coordinate: { x: action.x, y: action.y },
      createdAt: now
    };
  }
  return {
    id: `${id}-action`,
    order: 1,
    type: "wait",
    title,
    enabled: true,
    params: {},
    createdAt: now
  };
}
