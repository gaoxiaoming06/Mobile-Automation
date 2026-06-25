import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode, Observation } from "@mobile-automation/graph-core";
import {
  candidateActionForObservation,
  classifyExplorationResult,
  createAutoExploreReport,
  generateExplorationCandidates,
  planExploration
} from "./auto-explorer.js";

describe("Auto Explorer", () => {
  it("builds V1 candidates from saved page abilities and OCR while skipping dangerous actions", () => {
    const source = pageNode("node-home", "主页", {
      assetRecordingManualElements: [
        {
          id: "manual-search",
          label: "搜索入口",
          locator: "image-region:88,7,8,5",
          actionKind: "tap",
          semanticArea: "top",
          availability: "visible",
          outcomeType: "navigate"
        },
        {
          id: "manual-logout",
          label: "退出登录",
          locator: "image-region:20,70,30,6",
          actionKind: "tap",
          semanticArea: "content",
          availability: "visible",
          outcomeType: "local_state_change"
        }
      ]
    });

    const report = createAutoExploreReport({
      graphVersion: graph([source]),
      sourceNodeId: source.id,
      observation: observation([
        { text: "添加好友", region: { x: 740, y: 180, width: 210, height: 72 } },
        { text: "确定退出登录", region: { x: 360, y: 1600, width: 360, height: 80 } }
      ]),
      maxDepth: 1,
      maxCandidates: 8
    });

    expect(report.status).toBe("ready");
    expect(report.version).toBe("v1");
    expect(report.candidates.map((candidate) => candidate.label)).toEqual(["搜索入口", "退出登录", "添加好友", "确定退出登录"]);
    expect(report.candidates.find((candidate) => candidate.label === "搜索入口")).toEqual(
      expect.objectContaining({
        status: "ready",
        riskLevel: "safe",
        source: "manual_element",
        semanticArea: "top"
      })
    );
    expect(report.candidates.find((candidate) => candidate.label === "添加好友")).toEqual(
      expect.objectContaining({
        status: "ready",
        riskLevel: "safe",
        source: "ocr_text",
        locator: "image-region:68.52,7.5,19.44,3"
      })
    );
    expect(report.candidates.filter((candidate) => candidate.status === "skipped").map((candidate) => candidate.label)).toEqual(["退出登录", "确定退出登录"]);
    expect(report.plan.steps).toHaveLength(2);
    expect(report.plan.steps.every((step) => step.depth === 1)).toBe(true);
  });

  it("builds V2 bounded exploration plans without exceeding depth or action limits", () => {
    const home = pageNode("node-home", "主页", {
      assetRecordingManualElements: [
        {
          id: "open-detail",
          label: "打开详情",
          locator: "image-region:10,30,80,18",
          actionKind: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-detail"
        }
      ]
    });
    const detail = pageNode("node-detail", "详情页", {
      assetRecordingManualElements: [
        {
          id: "open-create",
          label: "创建入口",
          locator: "image-region:82,80,10,8",
          actionKind: "tap",
          outcomeType: "navigate",
          targetNodeId: "node-create"
        }
      ]
    });
    const create = pageNode("node-create", "创建页");
    const graphVersion = graph([home, detail, create]);
    const candidatesByNode = new Map(graphVersion.nodes.map((node) => [node.id, generateExplorationCandidates({ node, observation: observation([]) })]));

    const plan = planExploration({
      graphVersion,
      startNodeId: home.id,
      candidatesByNode,
      maxDepth: 2,
      maxActions: 4
    });

    expect(plan.version).toBe("v2");
    expect(plan.steps.map((step) => `${step.sourceNodeName}:${step.candidateLabel}:d${step.depth}`)).toEqual(["主页:打开详情:d1", "详情页:创建入口:d2"]);
    expect(plan.steps.every((step) => step.depth <= 2)).toBe(true);
  });

  it("classifies observed results without creating official assets", () => {
    const before = observation([{ text: "主页" }]);
    const changed = observation([{ text: "主页" }, { text: "更多菜单" }]);

    expect(
      classifyExplorationResult({
        sourceNodeId: "node-home",
        beforeObservation: before,
        afterObservation: observation([{ text: "添加好友" }]),
        afterMatch: { status: "matched", node: pageNode("node-friend", "添加好友") }
      })
    ).toEqual(
      expect.objectContaining({
        resultType: "existing_page",
        targetNodeId: "node-friend",
        targetNodeName: "添加好友"
      })
    );

    expect(
      classifyExplorationResult({
        sourceNodeId: "node-home",
        beforeObservation: before,
        afterObservation: changed,
        afterMatch: { status: "matched", node: pageNode("node-home", "主页") }
      })
    ).toEqual(expect.objectContaining({ resultType: "local_state_change" }));

    expect(
      classifyExplorationResult({
        sourceNodeId: "node-home",
        beforeObservation: before,
        afterObservation: observation([{ text: "完全新的页面" }]),
        afterMatch: { status: "unknown" }
      })
    ).toEqual(expect.objectContaining({ resultType: "new_page_candidate" }));
  });

  it("converts visual candidates into device actions using the current screenshot size", () => {
    const source = pageNode("node-home", "主页");
    const candidate = generateExplorationCandidates({
      node: source,
      observation: observation([{ text: "添加好友", region: { x: 740, y: 180, width: 210, height: 72 } }])
    })[0]!;

    expect(candidateActionForObservation(candidate, observation([]))).toEqual({
      type: "tap",
      x: 845,
      y: 216
    });

    expect(
      candidateActionForObservation(
        {
          ...candidate,
          actionKind: "scroll",
          region: { x: 5, y: 30, width: 90, height: 50 }
        },
        observation([])
      )
    ).toEqual({
      type: "swipe",
      startX: 540,
      startY: 1800,
      endX: 540,
      endY: 960,
      durationMs: 360
    });
  });
});

function graph(nodes: BusinessNode[]): BusinessGraphVersion {
  return {
    id: "version-page-assets",
    graphId: "graph-classin",
    version: 1,
    sourceSummary: [],
    status: "active",
    nodes,
    edges: [],
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function pageNode(id: string, name: string, metadata: Record<string, unknown> = {}): BusinessNode {
  return {
    id,
    graphVersionId: "version-page-assets",
    key: `classin.${id}`,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    metadata: {
      assetRecordingConfirmed: true,
      ...metadata
    }
  };
}

function observation(texts: Array<{ text: string; region?: { x: number; y: number; width: number; height: number } }>): Observation {
  return {
    platform: "android",
    capturedAt: "2026-01-01T00:00:00.000Z",
    packageName: "cn.eeo.classin",
    resolution: { width: 1080, height: 2400 },
    uiElements: [],
    ocrTexts: texts.map((item) => ({
      text: item.text,
      source: "ocr",
      confidence: 0.92,
      ...(item.region ? { region: item.region } : {})
    }))
  };
}
