import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode, Observation, OperationEdge } from "@mobile-automation/graph-core";
import type { ActionStep } from "@mobile-automation/shared";
import { persistAssetTransitionCandidate } from "./asset-transition-candidates.js";

describe("persistAssetTransitionCandidate", () => {
  it("turns a semantic asset action into active graph nodes, edge action, and destination expectation", () => {
    const storage = new MemoryAssetCandidateStorage();
    const graphVersion = graph();
    const step = actionStep({
      id: "step-open-class",
      type: "tap_on_element",
      title: "点击第一个班级",
      params: {
        resourceId: "cn.eeo.classin:id/class_item_root",
        selector: "id=cn.eeo.classin:id/class_item_root"
      }
    });

    const result = persistAssetTransitionCandidate({
      graphVersion,
      storage,
      beforeObservation: observation({
        id: "before-1",
        text: "我是教师",
        resourceId: "cn.eeo.classin:id/teacher_tab",
        activityName: ".MainActivity"
      }),
      afterObservation: observation({
        id: "after-1",
        text: "课节",
        resourceId: "cn.eeo.classin:id/course_list",
        activityName: ".ClassDetailActivity"
      }),
      step,
      confirm: true
    });

    expect(result.from.status).toBe("created");
    expect(result.to.status).toBe("created");
    expect(result.edge.status).toBe("created");
    expect(result.from.node).toBeDefined();
    expect(result.to.node).toBeDefined();
    expect(result.edge.edge).toBeDefined();
    const fromNode = result.from.node!;
    const toNode = result.to.node!;
    const edge = result.edge.edge!;
    expect(fromNode.status).toBe("active");
    expect(toNode.status).toBe("active");
    expect(edge.status).toBe("active");
    expect(edge.source).toBe("manual_recording");
    expect(edge.actionPolicies[0]?.action).toEqual(step);
    expect(edge.intent).toBe("点击第一个班级");
    expect(edge.reliabilityScore).toBe(0.9);
    expect(edge.actionPolicies[0]?.reliabilityHint).toBe("high");
    expect(edge.preconditions[0]).toEqual(
      expect.objectContaining({
        type: "state_is",
        title: expect.stringContaining(fromNode.name),
        params: expect.objectContaining({ nodeKey: fromNode.key })
      })
    );
    expect(edge.expectations[0]).toEqual(
      expect.objectContaining({
        type: "state_is",
        title: expect.stringContaining(toNode.name),
        params: expect.objectContaining({ nodeKey: toNode.key })
      })
    );
    expect(result.warnings).toEqual([]);
    expect(storage.nodes).toHaveLength(2);
    expect(storage.edges).toHaveLength(1);
  });

  it("keeps coordinate-only asset actions as draft graph edges even when confirmed", () => {
    const storage = new MemoryAssetCandidateStorage();
    const result = persistAssetTransitionCandidate({
      graphVersion: graph(),
      storage,
      beforeObservation: observation({
        id: "before-1",
        text: "首页",
        resourceId: "cn.eeo.classin:id/home_title",
        activityName: ".MainActivity"
      }),
      afterObservation: observation({
        id: "after-1",
        text: "详情",
        resourceId: "cn.eeo.classin:id/detail_title",
        activityName: ".DetailActivity"
      }),
      step: actionStep({
        type: "tap",
        coordinate: { x: 120, y: 240, deviceWidth: 1080, deviceHeight: 2400 }
      }),
      confirm: true
    });

    expect(result.edge.edge).toBeDefined();
    expect(result.edge.edge!.status).toBe("draft");
    expect(result.edge.edge!.reliabilityScore).toBeLessThan(0.7);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COORDINATE_ONLY_ACTION"
        })
      ])
    );
  });

  it("rejects asset observations that are outside the graph target Android package", () => {
    const storage = new MemoryAssetCandidateStorage();

    const result = persistAssetTransitionCandidate({
      graphVersion: graph(),
      storage,
      beforeObservation: observation({
        id: "before-launcher",
        packageName: "com.huawei.android.launcher",
        text: "ClassIn",
        resourceId: "com.huawei.android.launcher:id/icon",
        activityName: ".Launcher"
      }),
      afterObservation: observation({
        id: "after-classin",
        packageName: "cn.eeo.classin",
        text: "我是教师",
        resourceId: "cn.eeo.classin:id/teacher_tab",
        activityName: ".MainActivity"
      }),
      step: actionStep({ type: "tap_on_text", params: { text: "ClassIn" } }),
      targetApp: { androidPackageName: "cn.eeo.classin" },
      confirm: true
    });

    expect(result.edge.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OUTSIDE_TARGET_APP"
        })
      ])
    );
    expect(storage.nodes).toHaveLength(0);
    expect(storage.edges).toHaveLength(0);
  });

  it("does not create unknown-unknown nodes when observation has no meaningful app state", () => {
    const storage = new MemoryAssetCandidateStorage();

    const result = persistAssetTransitionCandidate({
      graphVersion: graph(),
      storage,
      beforeObservation: {
        id: "before-empty",
        platform: "android",
        capturedAt: "2026-06-14T00:00:00.000Z",
        uiElements: [],
        ocrTexts: []
      },
      afterObservation: observation({
        id: "after-classin",
        packageName: "cn.eeo.classin",
        text: "我是教师",
        resourceId: "cn.eeo.classin:id/teacher_tab",
        activityName: ".MainActivity"
      }),
      step: actionStep({ type: "tap_on_text", params: { text: "ClassIn" } }),
      targetApp: { androidPackageName: "cn.eeo.classin" },
      confirm: true
    });

    expect(result.from.status).toBe("skipped");
    expect(result.edge.status).toBe("skipped");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INSUFFICIENT_OBSERVATION"
        })
      ])
    );
    expect(storage.nodes).toHaveLength(0);
    expect(storage.edges).toHaveLength(0);
  });

  it("treats popup menus as local page state instead of creating a destination page edge", () => {
    const home = businessNode({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-title", type: "ocr_text", value: "主页", weight: 2, critical: true, region: { x: 8, y: 8, width: 18, height: 8 }, platformScope: "mobile-both" },
        { id: "matcher-create-class", type: "text", value: "创建班级", weight: 2, critical: true }
      ],
      metadata: { assetRecordingConfirmed: true, pageName: "主页" }
    });
    const storage = new MemoryAssetCandidateStorage();

    const result = persistAssetTransitionCandidate({
      graphVersion: graph({ nodes: [home] }),
      storage,
      beforeObservation: observation({
        id: "before-home",
        text: "主页",
        extraTexts: ["创建班级"],
        resourceId: "cn.eeo.classin:id/home",
        activityName: ".MainActivity"
      }),
      afterObservation: observation({
        id: "after-home-menu",
        text: "主页",
        extraTexts: ["添加好友", "加入班级", "加入公开课", "扫一扫"],
        resourceId: "cn.eeo.classin:id/home",
        activityName: ".MainActivity"
      }),
      step: actionStep({ type: "tap_on_image", title: "点击更多", params: { baselineArtifactId: "artifact-more" } }),
      confirm: true
    });

    expect(result.from.status).toBe("matched");
    expect(result.to.status).toBe("matched");
    expect(result.from.node?.id).toBe(home.id);
    expect(result.to.node?.id).toBe(home.id);
    expect(result.edge.status).toBe("skipped");
    expect(result.edge.reason).toContain("页面内状态");
    expect(storage.nodes).toHaveLength(0);
    expect(storage.edges).toHaveLength(0);
  });

  it("does not turn legacy recording popup nodes into PageTransition destinations", () => {
    const home = businessNode({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-title", type: "ocr_text", value: "主页", weight: 2, critical: true, region: { x: 8, y: 8, width: 18, height: 8 }, platformScope: "mobile-both" },
        { id: "matcher-create-class", type: "text", value: "创建班级", weight: 2, critical: true }
      ],
      metadata: { assetRecordingConfirmed: true, pageName: "主页" }
    });
    const legacyPopupNode = businessNode({
      id: "node-legacy-add-friend",
      key: "recording.legacy-add-friend",
      name: "录制节点：添加好友",
      tags: ["manual-recording", "recording-confirmed", "needs-review"],
      matchers: [
        { id: "matcher-package-legacy", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-add-friend", type: "ocr_text", value: "添加好友", weight: 3, critical: true, platformScope: "mobile-both" }
      ],
      metadata: { source: "manual_recording" }
    });
    const storage = new MemoryAssetCandidateStorage();

    const result = persistAssetTransitionCandidate({
      graphVersion: graph({ nodes: [home, legacyPopupNode] }),
      storage,
      beforeObservation: observation({
        id: "before-home",
        text: "主页",
        extraTexts: ["创建班级"],
        resourceId: "cn.eeo.classin:id/home",
        activityName: ".MainActivity"
      }),
      afterObservation: observation({
        id: "after-home-menu",
        text: "主页",
        extraTexts: ["添加好友", "加入班级", "加入公开课", "扫一扫"],
        resourceId: "cn.eeo.classin:id/home",
        activityName: ".MainActivity"
      }),
      step: actionStep({ type: "tap_on_image", title: "点击更多", params: { baselineArtifactId: "artifact-more" } }),
      confirm: true
    });

    expect(result.from.status).toBe("matched");
    expect(result.to.status).toBe("matched");
    expect(result.to.node?.id).toBe(home.id);
    expect(result.to.node?.id).not.toBe(legacyPopupNode.id);
    expect(result.edge.status).toBe("skipped");
    expect(result.edge.reason).toContain("页面内状态");
    expect(storage.nodes).toHaveLength(0);
    expect(storage.edges).toHaveLength(0);
  });

  it("skips popup-only observations instead of reusing legacy recording nodes", () => {
    const home = businessNode({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset", "asset-recording"],
      matchers: [
        { id: "matcher-package", type: "package", value: "cn.eeo.classin", weight: 1 },
        { id: "matcher-title", type: "ocr_text", value: "主页", weight: 2, critical: true, region: { x: 8, y: 8, width: 18, height: 8 }, platformScope: "mobile-both" },
        { id: "matcher-create-class", type: "text", value: "创建班级", weight: 2, critical: true }
      ],
      metadata: { assetRecordingConfirmed: true, pageName: "主页" }
    });
    const legacyPopupNode = businessNode({
      id: "node-legacy-add-friend",
      key: "recording.pd4vzx",
      name: "录制节点：添加好友",
      tags: ["manual-recording", "recording-confirmed", "needs-review"],
      matchers: [{ id: "matcher-add-friend", type: "text", value: "添加好友", weight: 3, critical: true, platformScope: "android" }],
      metadata: { source: "manual_recording" }
    });
    const storage = new MemoryAssetCandidateStorage([legacyPopupNode]);

    const result = persistAssetTransitionCandidate({
      graphVersion: graph({ nodes: [home, legacyPopupNode] }),
      storage,
      beforeObservation: observation({
        id: "before-home",
        text: "主页",
        extraTexts: ["创建班级"],
        resourceId: "cn.eeo.classin:id/home",
        activityName: ".MainActivity"
      }),
      afterObservation: observation({
        id: "after-popup-only",
        text: "添加好友",
        extraTexts: ["加入班级", "加入公开课", "扫一扫"],
        resourceId: "cn.eeo.classin:id/group_item",
        activityName: ".MainActivity"
      }),
      step: actionStep({ type: "tap", title: "点击更多", coordinate: { x: 969, y: 232, deviceWidth: 1080, deviceHeight: 2340 } }),
      confirm: false
    });

    expect(result.from.status).toBe("matched");
    expect(result.to.status).toBe("skipped");
    expect(result.to.node?.id).not.toBe(legacyPopupNode.id);
    expect(result.edge.status).toBe("skipped");
    expect(result.edge.reason).toContain("页面内状态");
    expect(storage.nodes).toEqual([legacyPopupNode]);
    expect(storage.edges).toHaveLength(0);
  });
});

class MemoryAssetCandidateStorage {
  nodes: BusinessNode[];
  edges: OperationEdge[] = [];

  constructor(nodes: BusinessNode[] = []) {
    this.nodes = [...nodes];
  }

  findBusinessNodeByKey(_graphVersionId: string, key: string): BusinessNode | undefined {
    return this.nodes.find((node) => node.key === key);
  }

  createBusinessNode(input: Omit<BusinessNode, "id"> & { id?: string }): BusinessNode {
    const node: BusinessNode = {
      ...input,
      id: input.id ?? `node-${this.nodes.length + 1}`
    };
    this.nodes.push(node);
    return node;
  }

  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined {
    const node = this.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    node.metadata = metadata;
    return node;
  }

  updateBusinessNodeStatus(nodeId: string, status: BusinessNode["status"]): BusinessNode | undefined {
    const node = this.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return undefined;
    }
    node.status = status;
    return node;
  }

  findOperationEdgeByKey(_graphVersionId: string, key: string): OperationEdge | undefined {
    return this.edges.find((edge) => edge.key === key);
  }

  createOperationEdge(input: Omit<OperationEdge, "id"> & { id?: string }): OperationEdge {
    const edge: OperationEdge = {
      ...input,
      id: input.id ?? `edge-${this.edges.length + 1}`
    };
    this.edges.push(edge);
    return edge;
  }

  updateOperationEdgeStatus(edgeId: string, status: OperationEdge["status"]): OperationEdge | undefined {
    const edge = this.edges.find((item) => item.id === edgeId);
    if (!edge) {
      return undefined;
    }
    edge.status = status;
    return edge;
  }
}

function graph(overrides: Partial<BusinessGraphVersion> = {}): BusinessGraphVersion {
  return {
    id: "graph-version-1",
    graphId: "graph-1",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes: [],
    edges: [],
    createdAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}

function businessNode(input: Partial<BusinessNode> & { id: string; key: string; name: string }): BusinessNode {
  return {
    graphVersionId: "graph-version-1",
    nodeType: "page",
    tags: [],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    ...input
  };
}

function observation(input: { id: string; text: string; resourceId: string; activityName: string; packageName?: string; extraTexts?: string[] }): Observation {
  const texts = [input.text, ...(input.extraTexts ?? [])];
  return {
    id: input.id,
    platform: "android",
    capturedAt: "2026-06-14T00:00:00.000Z",
    packageName: input.packageName ?? "cn.eeo.classin",
    activityName: input.activityName,
    componentName: `${input.packageName ?? "cn.eeo.classin"}/${input.activityName}`,
    resolution: { width: 1080, height: 2340 },
    uiElements: texts.map((text, index) => ({
        resourceId: input.resourceId,
        text,
        className: "android.widget.TextView",
        visible: true,
        enabled: true,
        bounds: {
          x: index === 0 ? 226 : 770,
          y: index === 0 ? 280 : 565 + index * 80,
          width: index === 0 ? 118 : 180,
          height: 50
        }
      })),
    ocrTexts: texts.map((text, index) => ({
      text,
      source: "ocr",
      region: {
        x: index === 0 ? 226 : 770,
        y: index === 0 ? 280 : 565 + index * 80,
        width: index === 0 ? 118 : 180,
        height: 50
      }
    }))
  };
}

function actionStep(overrides: Partial<ActionStep> = {}): ActionStep {
  return {
    id: "step-1",
    order: 1,
    type: "tap_on_text",
    enabled: true,
    title: "点击",
    params: { text: "我是教师" },
    createdAt: "2026-06-14T00:00:00.000Z",
    ...overrides
  };
}
