import { describe, expect, it } from "vitest";
import { planRoute, type BusinessGraphVersion, type BusinessNode, type StateMatcher } from "@mobile-automation/graph-core";
import { pageAbilityRouteGapIssues, withPageAbilityEdges } from "./page-ability-edges.js";

describe("page ability route edges", () => {
  it("builds route edges from separated page elements and page transitions", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-class-grid",
          label: "班级列表",
          elementKind: "collection",
          locator: "runtime-locator:home_class_grid",
          locatorKind: "collection_item_locator",
          semanticArea: "content",
          coordinateSpace: "runtime",
          platformScope: "mobile-both",
          actions: ["tap_item"],
          structuralLocator: {
            strategy: "collection_grid",
            role: "class_grid",
            searchHintRegion: { x: 3.06, y: 30.44, width: 93.99, height: 59.13 }
          },
          collection: {
            kind: "vertical_grid",
            columns: 2,
            itemIdentity: { type: "ocr_title" },
            candidateItemHeightPercent: 24.5,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            scrollStepPercent: 65,
            failureStrategy: "try_next_candidate"
          }
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "home-open-class-detail",
          elementId: "home-class-grid",
          action: "tap_item",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          params: {
            itemText: "{{className}}"
          }
        }
      ]
    });
    const classDetail = pageNode("node-class-detail", "classin.class.detail", "班级详情");

    const nextGraphVersion = withPageAbilityEdges(graph([home, classDetail]), "android");
    const routePlan = planRoute({
      graphVersion: nextGraphVersion,
      appId: "classin",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      platform: "android",
      startNodeId: home.id,
      targetNodeId: classDetail.id
    });

    expect(routePlan.unresolvedIssues).toEqual([]);
    expect(routePlan.edges.map((item) => item.edge.name)).toEqual(["主页 -> 班级详情"]);
    expect(routePlan.edges[0]?.edge.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          elementId: "home-class-grid",
          elementKind: "collection",
          abilityType: "grid_candidate",
          locator: "runtime-locator:home_class_grid",
          structuralLocator: expect.objectContaining({
            strategy: "collection_grid",
            searchHintRegion: { x: 3.06, y: 30.44, width: 93.99, height: 59.13 }
          }),
          scrollProfile: expect.objectContaining({
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            targetQuery: "{{className}}",
            afterFoundAction: "tap_item",
            failureStrategy: "try_next_candidate"
          })
        })
      })
    );
    expect(home.metadata?.assetRecordingPageElements).toEqual([
      expect.not.objectContaining({
        targetNodeId: expect.any(String),
        outcomeType: expect.any(String)
      })
    ]);
  });

  it("ignores legacy mixed page ability elements when separated v2 assets exist", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-search-button",
          label: "搜索按钮",
          elementKind: "icon_button",
          locator: "top-bar-icon:search",
          locatorKind: "top_bar_icon_locator",
          semanticArea: "top",
          coordinateSpace: "runtime",
          role: "search",
          slot: "trailing",
          orderFromRight: 2,
          actions: ["tap"]
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "home-search",
          elementId: "home-search-button",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-search",
          targetLabel: "搜索"
        }
      ],
      assetRecordingManualElements: [
        {
          id: "legacy-add",
          label: "旧添加好友",
          locator: "top-bar-icon:add",
          actionKind: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-add-friend",
          targetLabel: "添加好友"
        }
      ]
    });
    const search = pageNode("node-search", "classin.search", "搜索");
    const addFriend = pageNode("node-add-friend", "classin.add-friend", "添加好友");

    const nextGraphVersion = withPageAbilityEdges(graph([home, search, addFriend]), "android");

    expect(nextGraphVersion.edges.map((edge) => edge.name)).toEqual(["主页 -> 搜索"]);
    expect(nextGraphVersion.edges[0]?.actionPolicies[0]?.action.params).toEqual(
      expect.objectContaining({
        elementId: "home-search-button",
        locator: "top-bar-icon:search",
        targetLabel: "搜索"
      })
    );
  });

  it("reports separated asset rule issues for missing transition bindings and mixed element fields", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-add-button",
          label: "加号",
          elementKind: "icon_button",
          locator: "top-bar-icon:add",
          actions: ["tap"],
          targetNodeId: "node-should-not-live-here",
          outcomeType: "navigate"
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "missing-element",
          elementId: "missing-button",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-add-friend"
        },
        {
          id: "missing-target",
          elementId: "home-add-button",
          action: "tap",
          outcomeType: "navigate"
        }
      ]
    });
    const graphVersion = graph([home]);

    expect(pageAbilityRouteGapIssues(graphVersion, "android", { startNodeId: home.id })).toEqual([
      expect.objectContaining({
        code: "PAGE_ELEMENT_MIXED_TRANSITION_FIELD",
        severity: "error",
        nodeId: home.id,
        message: expect.stringContaining("home-add-button")
      }),
      expect.objectContaining({
        code: "PAGE_TRANSITION_ELEMENT_MISSING",
        severity: "error",
        nodeId: home.id,
        message: expect.stringContaining("missing-button")
      }),
      expect.objectContaining({
        code: "PAGE_TRANSITION_TARGET_MISSING",
        severity: "error",
        nodeId: home.id,
        message: expect.stringContaining("missing-target")
      })
    ]);
  });

  it("reports separated asset rule issues when transitions carry element locator fields", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-search-button",
          label: "搜索按钮",
          elementKind: "icon_button",
          locator: "top-bar-icon:search",
          actions: ["tap"]
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "home-search",
          elementId: "home-search-button",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-search",
          locator: "top-bar-icon:search",
          semanticArea: "top",
          visualLocator: {
            role: "search"
          }
        }
      ]
    });
    const search = pageNode("node-search", "classin.search", "搜索");
    const graphVersion = graph([home, search]);

    expect(pageAbilityRouteGapIssues(graphVersion, "android", { startNodeId: home.id })).toEqual([
      expect.objectContaining({
        code: "PAGE_TRANSITION_MIXED_ELEMENT_FIELD",
        severity: "error",
        nodeId: home.id,
        message: expect.stringContaining("locator, semanticArea, visualLocator")
      })
    ]);
  });

  it("does not build route edges from separated assets that violate page asset boundaries", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingPageElements: [
        {
          id: "home-search-button",
          label: "搜索按钮",
          elementKind: "icon_button",
          locator: "top-bar-icon:search",
          actions: ["tap"],
          outcomeType: "navigate"
        }
      ],
      assetRecordingPageTransitions: [
        {
          id: "home-search",
          elementId: "home-search-button",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-search",
          locator: "top-bar-icon:search"
        }
      ]
    });
    const search = pageNode("node-search", "classin.search", "搜索");

    expect(withPageAbilityEdges(graph([home, search]), "android").edges).toEqual([]);
  });

  it("turns semantic grid candidate and conditional page abilities into plannable edges", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_grid",
          label: "打开班级详情",
          locator: "image-region:3.06,30.44,93.99,59.13",
          actionKind: "tap",
          abilityType: "grid_candidate",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            targetQuery: "{{className}}",
            afterFoundAction: "tap_item",
            candidateItemHeightPercent: 24.5,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            scrollStepPercent: 65,
            failureStrategy: "try_next_candidate"
          }
        }
      ]
    });
    const classDetail = pageNode("node-class-detail", "classin.class.detail", "班级详情", {
      assetRecordingManualElements: [
        {
          id: "manual_add",
          label: "创建课堂入口",
          locator: "image-region:80.38,79.55,14.2,6.28",
          actionKind: "tap",
          abilityType: "conditional_tap",
          availability: "conditional",
          outcomeType: "navigate",
          targetNodeId: "node-create-lesson",
          targetLabel: "新建课堂"
        }
      ]
    });
    const target = pageNode("node-create-lesson", "classin.lesson.create", "新建课堂");
    const graphVersion = graph([home, classDetail, target]);

    const nextGraphVersion = withPageAbilityEdges(graphVersion, "android");
    const routePlan = planRoute({
      graphVersion: nextGraphVersion,
      appId: "classin",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      platform: "android",
      startNodeId: home.id,
      targetNodeId: target.id
    });

    expect(routePlan.unresolvedIssues).toEqual([]);
    expect(routePlan.edges.map((item) => item.edge.name)).toEqual(["主页 -> 班级详情", "班级详情 -> 新建课堂"]);
    expect(routePlan.edges[0]?.edge.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          abilityType: "grid_candidate",
          scrollProfile: expect.objectContaining({
            targetKind: "item_text",
            targetQuery: "{{className}}",
            failureStrategy: "try_next_candidate"
          })
        })
      })
    );
    expect(routePlan.edges[0]?.edge.actionPolicies[0]?.action.params).not.toEqual(expect.objectContaining({
      candidateIndex: expect.any(Number),
      tapPointPercent: expect.any(Object)
    }));
  });

  it("keeps top bar icon locator metadata on generated page ability edges", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_add",
          label: "打开更多菜单并选择添加好友",
          locator: "top-bar-icon:add",
          locatorKind: "top_bar_icon_locator",
          actionKind: "tap",
          semanticArea: "top",
          coordinateSpace: "runtime",
          role: "add",
          slot: "trailing",
          orderFromRight: 1,
          anchorText: "主页",
          visualLocator: {
            candidates: [
              { role: "search", label: "搜索", score: 0.94, semanticArea: "top", region: { x: 84, y: 6.6, width: 4, height: 3.8 } },
              { role: "add", label: "加号", score: 0.95, semanticArea: "top", region: { x: 91.2, y: 6.5, width: 4.2, height: 4 } }
            ]
          },
          outcomeType: "navigate",
          targetNodeId: "node-add-friend",
          targetLabel: "添加好友"
        }
      ]
    });
    const addFriend = pageNode("node-add-friend", "classin.add-friend", "添加好友");
    const graphVersion = graph([home, addFriend]);

    const nextGraphVersion = withPageAbilityEdges(graphVersion, "android");
    const action = nextGraphVersion.edges[0]?.actionPolicies[0]?.action;

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          locator: "top-bar-icon:add",
          locatorKind: "top_bar_icon_locator",
          semanticArea: "top",
          coordinateSpace: "runtime",
          role: "add",
          slot: "trailing",
          orderFromRight: 1,
          anchorText: "主页",
          visualLocator: expect.objectContaining({
            candidates: expect.arrayContaining([
              expect.objectContaining({ role: "add" })
            ])
          })
        })
      })
    );
  });

  it("passes anchorOffsetPercent from ocr anchor offset elements to runtime step params", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_vip_icon",
          label: "会员中心右侧图标",
          locator: "image-region:60,20,36,6",
          locatorKind: "ocr_anchor_offset",
          actionKind: "tap",
          semanticArea: "content",
          coordinateSpace: "screen",
          targetText: "会员中心",
          anchorText: "会员中心",
          anchorOffsetPercent: { x: 30, y: 0 },
          outcomeType: "navigate",
          targetNodeId: "node-vip",
          targetLabel: "会员中心"
        }
      ]
    });
    const vip = pageNode("node-vip", "classin.vip", "会员中心");
    const graphVersion = graph([home, vip]);

    const nextGraphVersion = withPageAbilityEdges(graphVersion, "android");
    const action = nextGraphVersion.edges[0]?.actionPolicies[0]?.action;

    expect(action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          locatorKind: "ocr_anchor_offset",
          anchorText: "会员中心",
          anchorOffsetPercent: { x: 30, y: 0 }
        })
      })
    );
  });

  it("reports navigable page abilities that cannot become route edges yet", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_settings",
          label: "设置",
          locator: "text:设置",
          locatorKind: "text_locator",
          targetText: "设置",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          targetLabel: "设置"
        }
      ]
    });
    const target = pageNode("node-create-lesson", "classin.lesson.create", "新建课堂");
    const graphVersion = graph([home, target]);

    expect(pageAbilityRouteGapIssues(graphVersion, "android", { startNodeId: home.id })).toEqual([
      expect.objectContaining({
        code: "PAGE_ABILITY_TARGET_MISSING",
        severity: "error",
        nodeId: home.id,
        message: expect.stringContaining("设置")
      })
    ]);
  });

  it("ignores legacy grid candidate abilities without a semantic target", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_grid",
          label: "班级列表",
          locator: "image-region:3.06,30.44,93.99,59.13",
          actionKind: "scroll",
          abilityType: "grid_candidate",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            candidateItemHeightPercent: 24.5,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            failureStrategy: "try_next_candidate"
          }
        }
      ]
    });
    const target = pageNode("node-class-detail", "classin.class.detail", "班级详情");
    const nextGraphVersion = withPageAbilityEdges(graph([home, target]), "android");

    expect(nextGraphVersion.edges).toEqual([]);
  });

  it("passes semantic area and target text to visual tap actions for runtime relocation", () => {
    const classDetail = pageNode("node-class-detail", "classin.class.detail", "班级详情", {
      assetRecordingManualElements: [
        {
          id: "manual_publish",
          label: "发布",
          locator: "image-region:45.91,98.91,8.18,1.09",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-published",
          targetLabel: "发布成功"
        }
      ]
    });
    const target = pageNode("node-published", "classin.publish.success", "发布成功");

    const nextGraphVersion = withPageAbilityEdges(graph([classDetail, target]), "android");

    expect(nextGraphVersion.edges[0]?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          region: { x: 45.91, y: 98.91, width: 8.18, height: 1.09 },
          targetText: "发布",
          semanticArea: "bottom",
          coordinateSpace: "screen"
        })
      })
    );
  });

  it("plans runtime structural tap abilities through the visual semantic resolver", () => {
    const login = pageNode("node-login", "classin.login", "登录", {
      assetRecordingManualElements: [
        {
          id: "manual-login-submit",
          label: "登录按钮",
          targetText: "登录",
          locator: "runtime-locator:primary_login_button",
          locatorKind: "structural_locator",
          actionKind: "tap",
          semanticArea: "content",
          coordinateSpace: "runtime",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-home",
          targetLabel: "主页",
          structuralLocator: {
            strategy: "ocr_text",
            role: "primary_button",
            text: "登录"
          }
        }
      ]
    });
    const home = pageNode("node-home", "classin.home", "主页");

    const nextGraphVersion = withPageAbilityEdges(graph([login, home]), "android");

    expect(nextGraphVersion.edges[0]?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          locator: "runtime-locator:primary_login_button",
          locatorKind: "structural_locator",
          targetText: "登录",
          structuralLocator: expect.objectContaining({
            role: "primary_button"
          })
        })
      })
    );
  });

  it("enables reveal-on-missing for navigable content image regions", () => {
    const classDetail = pageNode("node-class-detail", "classin.class.detail", "班级详情", {
      assetRecordingManualElements: [
        {
          id: "manual-learning-plan",
          label: "创建学习方案",
          targetText: "学习方案",
          locator: "image-region:6,47.8,88,8.8",
          actionKind: "tap",
          semanticArea: "content",
          availability: "visible",
          outcomeType: "navigate",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        }
      ]
    });
    const target = pageNode("node-learning-plan", "classin.learning.plan", "学习方案");

    const nextGraphVersion = withPageAbilityEdges(graph([classDetail, target]), "android");

    expect(nextGraphVersion.edges[0]?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          targetText: "学习方案",
          semanticArea: "content",
          revealOnMissing: true,
          revealDirection: "up",
          revealMaxSwipes: 2
        })
      })
    );
  });

  it("auto-connects home tab root pages through bottom navigation regions", () => {
    const home = pageNode("node-home", "classin.teacher.classes", "主页");
    const message = pageNode("node-message", "classin.teacher.message", "消息");
    const todo = pageNode("node-todo", "classin.teacher.todo", "待办");
    const schedule = pageNode("node-schedule", "classin.teacher.schedule", "课程表");
    const space = pageNode("node-space", "classin.teacher.space", "空间");
    const growth = pageNode("node-growth", "classin.teacher.growth", "成长");
    const joinClass = pageNode("node-join-class", "classin.teacher.join-class", "加入班级");
    const graphVersion = graph([home, message, todo, schedule, space, growth, joinClass]);
    graphVersion.edges.push({
      id: "edge-home-join-class",
      graphVersionId: graphVersion.id,
      fromNodeId: home.id,
      toNodeId: joinClass.id,
      key: "manual.home.join-class",
      name: "主页 -> 加入班级",
      intent: "打开更多菜单并选择加入班级",
      status: "active",
      source: "manual_edit",
      preconditions: [],
      actionPolicies: [
        {
          id: "policy-home-join-class",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          action: {
            id: "step-home-join-class",
            order: 1,
            enabled: true,
            type: "tap_on_text",
            params: { text: "加入班级" },
            createdAt: "2026-06-20T00:00:00.000Z"
          }
        }
      ],
      expectations: [],
      platformScope: "android",
      reliabilityScore: 0.9
    });

    const nextGraphVersion = withPageAbilityEdges(graphVersion, "android");
    const routePlan = planRoute({
      graphVersion: nextGraphVersion,
      appId: "classin",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      platform: "android",
      startNodeId: message.id,
      targetNodeId: joinClass.id
    });

    expect(routePlan.unresolvedIssues).toEqual([]);
    expect(routePlan.edges.map((item) => item.edge.name)).toEqual(["消息 -> 主页", "主页 -> 加入班级"]);
    expect(routePlan.edges[0]?.edge.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          region: { x: 0, y: 91, width: 16.67, height: 8 },
          semanticArea: "bottom",
          coordinateSpace: "screen",
          targetText: "主页"
        })
      })
    );
  });

  it("prefers the recorded home tab page over a generic home shell node", () => {
    const shell = pageNode("node-shell", "classin.home", "ClassIn 首页壳", {}, ["classin", "home"]);
    const home = pageNode("node-home", "classin.teacher.classes", "主页", {}, ["page-asset", "asset-recording"]);
    const message = pageNode("node-message", "classin.teacher.message", "消息", {}, ["page-asset", "asset-recording"]);
    const joinClass = pageNode("node-join-class", "classin.teacher.join-class", "加入班级");
    const graphVersion = graph([shell, home, message, joinClass]);
    graphVersion.edges.push({
      id: "edge-shell-home",
      graphVersionId: graphVersion.id,
      fromNodeId: shell.id,
      toNodeId: home.id,
      key: "manual.shell.home",
      name: "ClassIn 首页壳 -> 主页",
      intent: "切换到我是教师",
      status: "active",
      source: "manual_edit",
      preconditions: [],
      actionPolicies: [
        {
          id: "policy-shell-home",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          action: {
            id: "step-shell-home",
            order: 1,
            enabled: true,
            type: "tap_on_text",
            params: { text: "我是教师" },
            createdAt: "2026-06-20T00:00:00.000Z"
          }
        }
      ],
      expectations: [],
      platformScope: "android",
      reliabilityScore: 0.85
    });
    graphVersion.edges.push({
      id: "edge-home-join-class",
      graphVersionId: graphVersion.id,
      fromNodeId: home.id,
      toNodeId: joinClass.id,
      key: "manual.home.join-class",
      name: "主页 -> 加入班级",
      intent: "打开更多菜单并选择加入班级",
      status: "active",
      source: "manual_edit",
      preconditions: [],
      actionPolicies: [
        {
          id: "policy-home-join-class",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          action: {
            id: "step-home-join-class",
            order: 1,
            enabled: true,
            type: "tap_on_text",
            params: { text: "加入班级" },
            createdAt: "2026-06-20T00:00:00.000Z"
          }
        }
      ],
      expectations: [],
      platformScope: "android",
      reliabilityScore: 0.9
    });

    const nextGraphVersion = withPageAbilityEdges(graphVersion, "android");
    const routePlan = planRoute({
      graphVersion: nextGraphVersion,
      appId: "classin",
      targetApp: { androidPackageName: "cn.eeo.classin" },
      platform: "android",
      startNodeId: message.id,
      targetNodeId: joinClass.id
    });

    expect(routePlan.unresolvedIssues).toEqual([]);
    expect(routePlan.edges.map((item) => item.edge.name)).toEqual(["消息 -> 主页", "主页 -> 加入班级"]);
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
    edges: [],
    createdAt: "2026-06-20T00:00:00.000Z"
  };
}

function pageNode(id: string, key: string, name: string, metadata: Record<string, unknown> = {}, tags: string[] = ["page-asset", "asset-recording"]): BusinessNode {
  return {
    id,
    graphVersionId: "version-1",
    key,
    name,
    nodeType: "page",
    tags,
    status: "active",
    matchers: [matcher("text", name)],
    defaultExpectations: [],
    platformScope: "android",
    metadata: {
      assetRecordingConfirmed: true,
      ...metadata
    }
  };
}

function matcher(type: StateMatcher["type"], value: string): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight: 2,
    platformScope: "android"
  };
}
