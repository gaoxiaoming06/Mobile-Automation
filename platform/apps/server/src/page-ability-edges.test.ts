import { describe, expect, it } from "vitest";
import { planRoute, type BusinessGraphVersion, type BusinessNode, type StateMatcher } from "@mobile-automation/graph-core";
import { pageAbilityRouteGapIssues, withPageAbilityEdges } from "./page-ability-edges.js";

describe("page ability route edges", () => {
  it("turns saved grid candidate and conditional page abilities into plannable edges", () => {
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
            targetKind: "nth_item",
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
          tapPointPercent: { x: 25, y: 6.86 },
          candidateIndex: 0,
          maxCandidateAttempts: 8,
          scrollProfile: expect.objectContaining({
            failureStrategy: "try_next_candidate"
          })
        })
      })
    );
  });

  it("reports navigable page abilities that cannot become route edges yet", () => {
    const home = pageNode("node-home", "classin.home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual_grid",
          label: "班级列表",
          locator: "image-region:3.06,30.44,93.99,59.13",
          actionKind: "tap",
          abilityType: "grid_candidate",
          availability: "visible",
          outcomeType: "navigate",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2
          }
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
        message: expect.stringContaining("班级列表")
      })
    ]);
  });

  it("executes grid candidate abilities as visual candidate taps even when the recorded action kind is scroll", () => {
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

    expect(nextGraphVersion.edges[0]?.actionPolicies[0]?.action).toEqual(
      expect.objectContaining({
        type: "tap_on_image",
        params: expect.objectContaining({
          abilityType: "grid_candidate",
          tapPointPercent: { x: 25, y: 6.86 },
          candidateIndex: 0,
          maxCandidateAttempts: 8
        })
      })
    );
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
