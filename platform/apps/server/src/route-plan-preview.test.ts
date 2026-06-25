import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode, Observation, StateMatcher } from "@mobile-automation/graph-core";
import { routePreviewBlockingIssue, resolveRoutePlanStart } from "./route-plan-preview.js";

describe("route plan preview start detection", () => {
  it("uses the currently matched device node as route preview start", async () => {
    const root = node("node-root", "root", "Root", [matcher("package", "com.demo")]);
    const home = node("node-home", "home", "首页", [matcher("package", "com.demo"), matcher("text", "首页"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const target = node("node-target", "target", "目标页", [matcher("package", "com.demo"), matcher("text", "目标页"), matcher("resource_id", "com.demo:id/target_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [root, home, target],
      edges: [],
      createdAt: "2026-06-14T00:00:00.000Z"
    };

    const detection = await resolveRoutePlanStart({
      graphVersion,
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      observation: observation("首页", "com.demo:id/home_title")
    });

    expect(detection).toEqual(
      expect.objectContaining({
        source: "device_observation",
        startNodeId: "node-home",
        inTargetApp: true,
        nodeMatch: expect.objectContaining({
          status: "matched",
          node: expect.objectContaining({ key: "home" })
        })
      })
    );
  });

  it("does not use a matched node when the observation is outside the target app", async () => {
    const home = node("node-home", "home", "首页", [matcher("package", "com.demo"), matcher("text", "首页"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home],
      edges: [],
      createdAt: "2026-06-14T00:00:00.000Z"
    };

    const detection = await resolveRoutePlanStart({
      graphVersion,
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      observation: {
        ...observation("首页", "com.demo:id/home_title"),
        packageName: "com.android.launcher"
      }
    });

    expect(detection.source).toBe("device_observation");
    expect(detection.inTargetApp).toBe(false);
    expect(detection.startNodeId).toBeUndefined();
  });

  it("prefers a confirmed page asset over a legacy recording node for the device start", async () => {
    const legacyRecordingNode = node("node-recording-home", "recording.home", "录制节点：主页", [
      matcher("package", "com.demo"),
      matcher("activity", "com.demo.HomeActivity", 3),
      matcher("resource_id", "com.demo:id/home_title", 3)
    ]);
    const pageAsset = {
      ...node("node-page-home", "classin.teacher.classes", "主页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]),
      tags: ["page-asset"],
      metadata: {
        assetRecordingConfirmed: true
      }
    };
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [legacyRecordingNode, pageAsset],
      edges: [],
      createdAt: "2026-06-14T00:00:00.000Z"
    };

    const detection = await resolveRoutePlanStart({
      graphVersion,
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      observation: observation("首页", "com.demo:id/home_title")
    });

    expect(detection).toEqual(
      expect.objectContaining({
        source: "device_observation",
        startNodeId: "node-page-home",
        inTargetApp: true,
        nodeMatch: expect.objectContaining({
          status: "matched",
          node: expect.objectContaining({ id: "node-page-home", key: "classin.teacher.classes" })
        })
      })
    );
  });

  it("blocks preview fallback when the device is inside the target app but no active node is recognized", async () => {
    const home = node("node-home", "home", "首页", [matcher("package", "com.demo"), matcher("resource_id", "com.demo:id/home_title", 3)]);
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home],
      edges: [],
      createdAt: "2026-06-14T00:00:00.000Z"
    };

    const detection = await resolveRoutePlanStart({
      graphVersion,
      targetApp: { androidPackageName: "com.demo" },
      platform: "android",
      observation: observation("未知页", "com.demo:id/unknown")
    });

    expect(detection.inTargetApp).toBe(true);
    expect(detection.startNodeId).toBeUndefined();
    expect(routePreviewBlockingIssue(detection)).toEqual(
      expect.objectContaining({
        code: "CURRENT_NODE_UNKNOWN",
        severity: "error"
      })
    );
  });
});

function node(id: string, key: string, name: string, matchers: StateMatcher[]): BusinessNode {
  return {
    id,
    graphVersionId: "version-1",
    key,
    name,
    nodeType: key === "root" ? "root" : "page",
    tags: [],
    status: "active",
    matchers,
    defaultExpectations: [],
    platformScope: "android"
  };
}

function matcher(type: StateMatcher["type"], value: string, weight = 2): StateMatcher {
  return {
    id: `${type}-${value}`,
    type,
    value,
    weight,
    platformScope: "android"
  };
}

function observation(text: string, resourceId: string): Observation {
  return {
    id: "observation-1",
    platform: "android",
    capturedAt: "2026-06-14T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.HomeActivity",
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
