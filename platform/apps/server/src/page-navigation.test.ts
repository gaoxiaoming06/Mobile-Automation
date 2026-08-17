import { describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { ActionStep } from "@mobile-automation/shared";
import {
  derivePageNavigationSegments,
  findPageNavigationPath,
  type PageNavigationEdge
} from "./page-navigation.js";

describe("findPageNavigationPath", () => {
  it("returns no actions when the device is already on the target page", () => {
    expect(findPageNavigationPath([], "home", "home")).toEqual([]);
  });

  it("chooses the shortest safe path without assuming back or restart", () => {
    const edges = [
      edge("search", "home", "search-to-home"),
      edge("search", "menu", "search-to-menu"),
      edge("menu", "detail", "menu-to-detail"),
      edge("detail", "home", "detail-to-home")
    ];

    expect(findPageNavigationPath(edges, "search", "home")?.map((item) => item.segmentId)).toEqual(["search-to-home"]);
    expect(findPageNavigationPath(edges, "unknown", "home")).toBeUndefined();
  });

  it("prefers fewer device actions when navigation segments have different lengths", () => {
    const direct = edge("home", "detail", "direct");
    direct.actions = [direct.actions[0]!, direct.actions[0]!, direct.actions[0]!, direct.actions[0]!];
    const throughMenu = [edge("home", "menu", "open-menu"), edge("menu", "detail", "open-detail")];

    expect(findPageNavigationPath([direct, ...throughMenu], "home", "detail")?.map((item) => item.segmentId)).toEqual([
      "open-menu",
      "open-detail"
    ]);
  });
});

describe("derivePageNavigationSegments", () => {
  it("turns several safe actions between known pages into one navigation segment", () => {
    const flow = navigationFlow([
      {
        id: "open-more-menu",
        before: { screenRef: "classin.home" },
        tap: { target: { icon: "add", area: "topBar", position: "trailing" } }
      },
      {
        id: "open-add-friend",
        tap: { target: { text: "添加好友" } },
        after: { screenRef: "classin.add_friend" }
      }
    ]);

    expect(derivePageNavigationSegments({
      flowId: "flow-add-friend",
      flowVersion: 3,
      document: flow
    })).toEqual([
      expect.objectContaining({
        fromPage: "classin.home",
        toPage: "classin.add_friend",
        flowId: "flow-add-friend",
        flowVersion: 3,
        stepIds: ["open-more-menu", "open-add-friend"],
        steps: flow.steps
      })
    ]);
  });

  it("indexes explicitly scripted navigation without interpreting business text", () => {
    const flow = navigationFlow([
      {
        id: "open-settings",
        before: { screenRef: "classin.home" },
        tap: { target: { text: "设置" } }
      },
      {
        id: "delete-account",
        tap: { target: { text: "注销账号" } },
        after: { screenRef: "classin.goodbye" }
      }
    ]);

    expect(derivePageNavigationSegments({
      flowId: "flow-delete-account",
      flowVersion: 1,
      document: flow
    })).toEqual([expect.objectContaining({
      fromPage: "classin.home",
      toPage: "classin.goodbye",
      stepIds: ["open-settings", "delete-account"]
    })]);
  });

  it("does not infer risk from ordinary target text", () => {
    const flow = navigationFlow([{
      id: "submit-login",
      before: { screenRef: "classin.login" },
      after: { screenRef: "classin.home" },
      tap: { target: { text: "登录", area: "content", match: "exact" } }
    }]);

    expect(derivePageNavigationSegments({
      flowId: "flow-login",
      flowVersion: 1,
      document: flow
    })).toEqual([expect.objectContaining({
      fromPage: "classin.login",
      toPage: "classin.home"
    })]);
  });
});

function navigationFlow(steps: ScriptFlowDocument["steps"]): ScriptFlowDocument {
  return {
    version: 1,
    kind: "case",
    name: "打开添加好友",
    app: { id: "cn.eeo.classin" },
    start: { strategy: "keepCurrent" },
    parameters: {},
    steps,
    tags: []
  };
}

function edge(fromPageId: string, toPageId: string, stepId: string): PageNavigationEdge {
  const action: ActionStep = {
    id: stepId,
    order: 1,
    type: "tap_on_text",
    enabled: true,
    params: { text: "主页" },
    createdAt: "2026-07-29T00:00:00.000Z"
  };
  return {
    fromPageId,
    toPageId,
    flowId: "flow-navigation",
    flowName: "导航",
    segmentId: stepId,
    stepIds: [stepId],
    actions: [action]
  };
}
