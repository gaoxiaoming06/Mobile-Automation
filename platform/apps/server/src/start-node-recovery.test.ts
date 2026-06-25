import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode, Observation, OperationEdge, StateMatcher } from "@mobile-automation/graph-core";
import { resolveReachableStartNode } from "./start-node-recovery.js";

describe("start node recovery", () => {
  it("backs out of a recognized but unreachable transient page and returns a reachable start node", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const search = node("node-search", "search", "搜索", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/search_title", 3)], ["start:back_recoverable"]);
    const target = node("node-target", "target", "新建课堂", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/target_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, search, target],
      edges: [edge("edge-home-target", home.id, target.id)],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [observation("搜索", "com.demo:id/search_title"), observation("主页", "com.demo:id/home_title")];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("主页", "com.demo:id/home_title"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(home.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "recovered",
        fromNodeName: "搜索",
        recoveredNodeName: "主页"
      })
    );
  });

  it("backs out of a recognized stable page once and replans from a reachable parent page", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const addFriend = node("node-add-friend", "add-friend", "添加好友", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/add_friend_title", 3)], ["page-asset"]);
    const target = node("node-target", "target", "发布活动", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/activity_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, addFriend, target],
      edges: [edge("edge-home-target", home.id, target.id)],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [observation("添加好友", "com.demo:id/add_friend_title"), observation("主页", "com.demo:id/home_title")];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("主页", "com.demo:id/home_title"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(home.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "recovered",
        fromNodeName: "添加好友",
        recoveredNodeName: "主页"
      })
    );
  });

  it("stops back recovery when the first back leaves the target app", async () => {
    const addFriend = node("node-add-friend", "add-friend", "添加好友", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/add_friend_title", 3)], ["page-asset"]);
    const target = node("node-target", "target", "发布活动", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/activity_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [addFriend, target],
      edges: [],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [observation("添加好友", "com.demo:id/add_friend_title"), observation("桌面", "launcher:id/title", "com.android.launcher")];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("桌面", "launcher:id/title", "com.android.launcher"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(addFriend.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "failed",
        fromNodeName: "添加好友",
        attempts: [
          expect.objectContaining({
            attempt: 1,
            inTargetApp: false,
            reason: "outside_target_app"
          })
        ]
      })
    );
  });

  it("does not back out of home when home cannot reach the target", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const target = node("node-target", "target", "发布活动", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/activity_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, target],
      edges: [],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observation("主页", "com.demo:id/home_title"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual([]);
    expect(result.startNodeId).toBe(home.id);
    expect(result.recovery).toBeUndefined();
  });

  it("does not back out of a bottom tab root page when the target is unreachable", async () => {
    const message = node("node-message", "classin.teacher.message", "消息", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/message_title", 3)], [
      "page-asset",
      "asset-recording"
    ]);
    const target = node("node-target", "target", "加入班级", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/join_class_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [message, target],
      edges: [],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observation("消息", "com.demo:id/message_title"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual([]);
    expect(result.startNodeId).toBe(message.id);
    expect(result.recovery).toBeUndefined();
  });

  it("stops at home after one back even when home still cannot reach the target", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const addFriend = node("node-add-friend", "add-friend", "添加好友", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/add_friend_title", 3)], ["page-asset"]);
    const target = node("node-target", "target", "加入班级", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/join_class_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, addFriend, target],
      edges: [],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [observation("添加好友", "com.demo:id/add_friend_title"), observation("主页", "com.demo:id/home_title"), observation("桌面", "launcher:id/title", "com.android.launcher")];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("桌面", "launcher:id/title", "com.android.launcher"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(home.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "failed",
        fromNodeName: "添加好友",
        attempts: [
          expect.objectContaining({
            attempt: 1,
            nodeName: "主页",
            inTargetApp: true
          })
        ]
      })
    );
  });

  it("waits for a recognizable parent page after back instead of immediately backing again", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const addFriend = node("node-add-friend", "add-friend", "添加好友", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/add_friend_title", 3)], ["page-asset"]);
    const target = node("node-target", "target", "加入班级", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/join_class_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, addFriend, target],
      edges: [edge("edge-home-target", home.id, target.id)],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [
      observation("添加好友", "com.demo:id/add_friend_title"),
      observation("过渡中", "com.demo:id/transition"),
      observation("主页", "com.demo:id/home_title"),
      observation("桌面", "launcher:id/title", "com.android.launcher")
    ];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("桌面", "launcher:id/title", "com.android.launcher"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(home.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "recovered",
        fromNodeName: "添加好友",
        recoveredNodeName: "主页"
      })
    );
  });

  it("does not issue a second back when the post-back app state is still unknown", async () => {
    const home = node("node-home", "home", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const addFriend = node("node-add-friend", "add-friend", "添加好友", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/add_friend_title", 3)], ["page-asset"]);
    const target = node("node-target", "target", "加入班级", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/join_class_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, addFriend, target],
      edges: [edge("edge-home-target", home.id, target.id)],
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const observations = [
      observation("添加好友", "com.demo:id/add_friend_title"),
      observation("过渡中", "com.demo:id/transition"),
      observation("仍在过渡", "com.demo:id/transition"),
      observation("仍在过渡", "com.demo:id/transition"),
      observation("仍在过渡", "com.demo:id/transition"),
      observation("仍在过渡", "com.demo:id/transition"),
      observation("桌面", "launcher:id/title", "com.android.launcher")
    ];
    const actions: string[] = [];

    const result = await resolveReachableStartNode({
      graphVersion,
      appId: "demo",
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      targetNodeId: target.id,
      collectObservation: async () => observations.shift() ?? observation("桌面", "launcher:id/title", "com.android.launcher"),
      performAction: async (action) => {
        actions.push(action.type);
      }
    });

    expect(actions).toEqual(["back"]);
    expect(result.startNodeId).toBe(addFriend.id);
    expect(result.recovery).toEqual(
      expect.objectContaining({
        status: "failed",
        fromNodeName: "添加好友",
        recoveredNodeName: "添加好友",
        attempts: [
          expect.objectContaining({
            attempt: 1,
            nodeId: undefined,
            inTargetApp: true
          })
        ]
      })
    );
  });
});

function node(id: string, key: string, name: string, matchers: StateMatcher[], tags: string[] = []): BusinessNode {
  return {
    id,
    graphVersionId: "version-1",
    key,
    name,
    nodeType: "page",
    tags,
    status: "active",
    matchers,
    defaultExpectations: [],
    platformScope: "android"
  };
}

function edge(id: string, fromNodeId: string, toNodeId: string): OperationEdge {
  return {
    id,
    graphVersionId: "version-1",
    fromNodeId,
    toNodeId,
    key: id,
    name: id,
    intent: id,
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      {
        id: `${id}-action-policy`,
        priority: 1,
        fallback: false,
        reliabilityHint: "high",
        action: {
          id: `${id}-action`,
          order: 1,
          enabled: true,
          type: "tap_on_image",
          params: {
            region: { x: 10, y: 10, width: 10, height: 10 }
          },
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      }
    ],
    preconditions: [],
    expectations: [],
    platformScope: "android",
    reliabilityScore: 0.8
  };
}

function matcher(type: StateMatcher["type"], value: string, weight = 2): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight,
    critical: true,
    platformScope: "android"
  };
}

function observation(text: string, resourceId: string, packageName = "com.demo"): Observation {
  return {
    id: `observation-${resourceId}`,
    platform: "android",
    capturedAt: "2026-06-20T00:00:00.000Z",
    packageName,
    activityName: `${packageName}.Activity`,
    uiElements: [
      {
        text,
        resourceId,
        visible: true,
        enabled: true
      }
    ],
    ocrTexts: [{ text, source: "ocr" }]
  };
}
