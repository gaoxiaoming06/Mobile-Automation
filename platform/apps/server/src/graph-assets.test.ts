import { describe, expect, it } from "vitest";
import type { ArtifactRef, TestRun } from "@mobile-automation/shared";
import type { BusinessGraphVersion, BusinessNode, OperationEdge } from "@mobile-automation/graph-core";
import { buildGraphAssetGovernanceSummary, selectAutoPromotableGraphAssets } from "./graph-assets.js";

describe("buildGraphAssetGovernanceSummary", () => {
  it("summarizes runtime draft nodes, exploration draft edges, and route-gap artifacts", () => {
    const runtimeNode = node({
      id: "node-runtime",
      key: "runtime.unknown.home",
      name: "运行期未知节点：首页",
      tags: ["runtime-discovered", "needs-review"],
      status: "draft",
      metadata: {
        observationCount: 2,
        lastObservedAt: "2026-06-14T10:00:00.000Z",
        visibleTexts: ["我是教师", "进入课堂"],
        resourceIds: ["cn.eeo.classin:id/teacher"]
      }
    });
    const activeNode = node({ id: "node-home", key: "home", name: "首页", tags: [], status: "active" });
    const targetNode = node({
      id: "node-target",
      key: "lesson.create",
      name: "新建课堂页",
      tags: ["page-asset"],
      status: "active",
      metadata: {
        assetRecordingConfirmed: true,
        updatedAt: "2026-06-14T10:10:00.000Z"
      }
    });
    const explorationEdge = edge({
      id: "edge-explore",
      key: "exploration.home.to.lesson",
      name: "探索候选：首页 -> 新建课堂页",
      fromNodeId: activeNode.id,
      toNodeId: targetNode.id,
      status: "draft",
      source: "exploration",
      reliabilityScore: 0.72,
      actionPolicies: [
        {
          id: "policy-1",
          priority: 1,
          fallback: false,
          reliabilityHint: "medium",
          action: {
            id: "step-1",
            order: 1,
            type: "tap_on_text",
            enabled: true,
            title: "点击课堂",
            params: { text: "课堂" },
            createdAt: "2026-06-14T10:00:00.000Z"
          },
          source: { sourceType: "exploration", artifactId: "artifact-gap", confidence: 0.72 }
        }
      ]
    });
    const manualTransition = edge({
      id: "edge-manual",
      key: "manual.home.to.lesson",
      name: "首页 -> 新建课堂页",
      fromNodeId: targetNode.id,
      toNodeId: activeNode.id,
      status: "draft",
      source: "manual_recording",
      reliabilityScore: 0.9,
      actionPolicies: [
        {
          id: "policy-manual",
          priority: 1,
          fallback: false,
          reliabilityHint: "high",
          action: {
            id: "step-manual",
            order: 1,
            type: "tap_on_element",
            enabled: true,
            title: "点击返回首页",
            params: { resourceId: "demo:id/back_home" },
            createdAt: "2026-06-14T10:00:00.000Z"
          },
          source: { sourceType: "manual_recording", confidence: 0.9 }
        }
      ],
      expectations: [
        {
          id: "expect-home",
          type: "state_is",
          enabled: true,
          title: "预期状态：首页",
          params: { nodeId: activeNode.id },
          createdAt: "2026-06-14T10:00:00.000Z"
        }
      ]
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [runtimeNode, activeNode, targetNode],
      edges: [explorationEdge, manualTransition],
      createdAt: "2026-06-14T09:00:00.000Z"
    };
    const routeGapArtifact = artifact({
      id: "artifact-gap",
      name: "route-gap-exploration-1780000000000.json",
      url: "/artifacts/runs/run-1/logs/route-gap-exploration.json"
    });
    const run = graphRun({
      id: "run-1",
      graphVersionId: graphVersion.id,
      artifacts: [routeGapArtifact]
    });

    const summary = buildGraphAssetGovernanceSummary(graphVersion, [run]);

    expect(summary.runtimeDraftNodes).toEqual([
      expect.objectContaining({
        id: runtimeNode.id,
        key: runtimeNode.key,
        status: "draft",
        observationCount: 2,
        visibleTexts: ["我是教师", "进入课堂"],
        resourceIds: ["cn.eeo.classin:id/teacher"]
      })
    ]);
    expect(summary.pageAssets).toEqual([
      expect.objectContaining({
        id: targetNode.id,
        key: targetNode.key,
        name: targetNode.name,
        status: "active",
        matcherCount: 0,
        elementCount: 0,
        transitions: [
          expect.objectContaining({
            id: manualTransition.id,
            status: "draft",
            source: "manual_recording",
            actionSummary: "tap_on_element: demo:id/back_home",
            actionLocator: "resource-id: demo:id/back_home",
            actionKind: "tap",
            targetName: "首页",
            targetKey: "home",
            expectationSummary: "预期状态：首页",
            reliabilityScore: 0.9
          })
        ],
        updatedAt: "2026-06-14T10:10:00.000Z"
      })
    ]);
    expect(summary.explorationDraftEdges).toEqual([
      expect.objectContaining({
        id: explorationEdge.id,
        fromNodeName: "首页",
        toNodeName: "新建课堂页",
        status: "draft",
        suggestedAction: "tap_on_text: 课堂",
        reliabilityScore: 0.72,
        artifactIds: ["artifact-gap"]
      })
    ]);
    expect(summary.routeGapArtifacts).toEqual([
      expect.objectContaining({
        id: routeGapArtifact.id,
        runId: "run-1",
        graphVersionId: graphVersion.id,
        name: routeGapArtifact.name,
        url: routeGapArtifact.url
      })
    ]);
  });

  it("selects only high-confidence draft assets for automatic promotion", () => {
    const home = node({ id: "node-home", key: "home", name: "首页", status: "active" });
    const target = node({ id: "node-target", key: "target", name: "目标页", status: "active" });
    const reliableRuntimeNode = node({
      id: "node-runtime-reliable",
      key: "runtime.reliable",
      name: "稳定未知页",
      status: "draft",
      tags: ["runtime-discovered"],
      metadata: { observationCount: 3 },
      matchers: [{ id: "matcher-critical", type: "resource_id", value: "demo:id/title", weight: 3, critical: true }]
    });
    const weakRuntimeNode = node({
      id: "node-runtime-weak",
      key: "runtime.weak",
      name: "低置信未知页",
      status: "draft",
      tags: ["runtime-discovered"],
      metadata: { observationCount: 1 },
      matchers: [{ id: "matcher-text", type: "text", value: "标题", weight: 1 }]
    });
    const reliableEdge = edge({
      id: "edge-reliable",
      key: "exploration.home.target",
      name: "可靠探索边",
      fromNodeId: home.id,
      toNodeId: target.id,
      status: "draft",
      source: "exploration",
      reliabilityScore: 0.82,
      actionPolicies: [
        {
          id: "policy-1",
          priority: 1,
          fallback: false,
          action: {
            id: "step-1",
            order: 1,
            type: "tap_on_text",
            enabled: true,
            params: { text: "进入" },
            createdAt: "2026-06-14T10:00:00.000Z"
          },
          source: { sourceType: "exploration", artifactId: "artifact-gap", confidence: 0.82 }
        }
      ]
    });
    const blockedEdge = edge({
      id: "edge-blocked",
      key: "exploration.home.runtime",
      name: "终点还是草稿的探索边",
      fromNodeId: home.id,
      toNodeId: weakRuntimeNode.id,
      status: "draft",
      source: "exploration",
      reliabilityScore: 0.9,
      actionPolicies: reliableEdge.actionPolicies
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, target, reliableRuntimeNode, weakRuntimeNode],
      edges: [reliableEdge, blockedEdge],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const result = selectAutoPromotableGraphAssets(graphVersion, {
      minRuntimeObservationCount: 2,
      minExplorationReliabilityScore: 0.75
    });

    expect(result.nodeIds).toEqual([reliableRuntimeNode.id]);
    expect(result.edgeIds).toEqual([reliableEdge.id]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: weakRuntimeNode.id, reason: "runtime_node_below_threshold" }),
        expect.objectContaining({ id: blockedEdge.id, reason: "edge_endpoint_not_active" })
      ])
    );
  });

  it("excludes deprecated page assets from the saved page asset list", () => {
    const activePage = node({
      id: "node-active",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset"],
      status: "active",
      metadata: { assetRecordingConfirmed: true }
    });
    const deprecatedPage = node({
      id: "node-deprecated",
      key: "classin.old",
      name: "旧页面",
      tags: ["page-asset"],
      status: "deprecated",
      metadata: { assetRecordingConfirmed: true }
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [activePage, deprecatedPage],
      edges: [],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets.map((asset) => asset.id)).toEqual([activePage.id]);
  });

  it("excludes deprecated outgoing transitions from saved page assets", () => {
    const home = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset"],
      status: "active",
      metadata: { assetRecordingConfirmed: true }
    });
    const target = node({
      id: "node-target",
      key: "classin.message",
      name: "消息",
      tags: ["page-asset"],
      status: "active",
      metadata: { assetRecordingConfirmed: true }
    });
    const activeTransition = edge({
      id: "edge-active",
      key: "manual.home.message",
      name: "主页 -> 消息",
      fromNodeId: home.id,
      toNodeId: target.id,
      status: "active",
      source: "manual_edit"
    });
    const deprecatedTransition = edge({
      id: "edge-deprecated",
      key: "recording.home.old-message",
      name: "主页 -> 录制节点：消息",
      fromNodeId: home.id,
      toNodeId: target.id,
      status: "deprecated",
      source: "manual_recording"
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [home, target],
      edges: [activeTransition, deprecatedTransition],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets.find((asset) => asset.id === home.id)?.transitions.map((transition) => transition.id)).toEqual([activeTransition.id]);
  });

  it("counts manually marked image-region elements in saved page assets", () => {
    const page = node({
      id: "node-home",
      key: "classin.home",
      name: "主页",
      tags: ["page-asset"],
      status: "active",
      metadata: {
        assetRecordingConfirmed: true,
        assetRecordingManualElements: [
          {
            label: "搜索按钮",
            locator: "image-region:12.5,8.25,20,6",
            actionKind: "tap"
          },
          {
            label: "班级列表",
            locator: "image-region:0,30,100,50",
            actionKind: "scroll"
          }
        ]
      }
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [page],
      edges: [],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets[0]?.elementCount).toBe(2);
  });

  it("summarizes saved page tasks from page asset metadata", () => {
    const page = node({
      id: "node-create-lesson",
      key: "classin.lesson.create",
      name: "新建课堂",
      tags: ["page-asset"],
      status: "active",
      metadata: {
        assetRecordingConfirmed: true,
        assetRecordingManualElements: [
          {
            id: "manual-title",
            label: "课堂标题",
            locator: "image-region:10,20,80,8",
            actionKind: "input"
          },
          {
            id: "manual-publish",
            label: "发布",
            locator: "image-region:70,90,25,8",
            actionKind: "tap"
          }
        ],
        assetRecordingPageTasks: [
          {
            id: "task-create-lesson",
            name: "创建课堂",
            status: "active",
            steps: [
              { id: "task-step-title", order: 1, elementId: "manual-title", fieldType: "text_input", valueParamKey: "lessonName" },
              { id: "task-step-submit", order: 2, elementId: "manual-publish", fieldType: "submit" }
            ]
          }
        ]
      }
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [page],
      edges: [],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets[0]?.tasks).toEqual([
      {
        id: "task-create-lesson",
        name: "创建课堂",
        status: "active",
        stepCount: 2,
        parameterKeys: ["lessonName"],
        updatedAt: undefined
      }
    ]);
  });

  it("separates confirmed identity evidence from raw visible business texts", () => {
    const page = node({
      id: "node-create-public-course",
      key: "runtime.unknown.1u41ebp",
      name: "新建公开课",
      tags: ["page-asset"],
      status: "active",
      metadata: {
        assetRecordingConfirmed: true,
        visibleTexts: ["组织", "EEO-TEST-霍昌峰 EEO-TEST-霍昌峰", "嚯嚯嚯666的公开课"],
        confirmedOcrTexts: ["ocr_text:新建公开课@region(28,7,18,5)", "封面", "发布"],
        screenshotRegions: [
          {
            id: "region-title",
            label: "标题栏",
            x: 24,
            y: 6,
            width: 22,
            height: 7,
            semanticArea: "top",
            baselineArtifactId: "artifact-title",
            evidenceTexts: ["新建公开课"]
          }
        ]
      }
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [page],
      edges: [],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets[0]).toEqual(
      expect.objectContaining({
        visibleTexts: ["组织", "EEO-TEST-霍昌峰 EEO-TEST-霍昌峰", "嚯嚯嚯666的公开课"],
        identityTexts: ["新建公开课", "封面", "发布", "标题栏"],
        confirmedOcrTexts: ["ocr_text:新建公开课@region(28,7,18,5)", "封面", "发布"],
        screenshotRegions: [
          expect.objectContaining({
            id: "region-title",
            label: "标题栏",
            semanticArea: "top",
            evidenceTexts: ["新建公开课"]
          })
        ]
      })
    );
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("EEO-TEST-霍昌峰 EEO-TEST-霍昌峰");
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("嚯嚯嚯666的公开课");
  });

  it("keeps platform-specific screenshot evidence out of user-facing identity texts", () => {
    const page = node({
      id: "node-home",
      key: "classin.teacher.classes",
      name: "主页",
      tags: ["page-asset"],
      status: "active",
      metadata: {
        assetRecordingConfirmed: true,
        confirmedOcrTexts: ["ocr_text:主页@region(5,7,12,5)"],
        screenshotRegions: [
          {
            id: "region-title",
            label: "标题栏",
            x: 0,
            y: 0,
            width: 100,
            height: 12,
            semanticArea: "top",
            evidenceTexts: ["主页", "user avatar", "contact", "search", "cn.eeo.classin:id/create_title", "icon"]
          },
          {
            id: "region-bottom",
            label: "底部导航",
            x: 0,
            y: 88,
            width: 100,
            height: 12,
            semanticArea: "bottom",
            evidenceTexts: ["cn.eeo.classin:id/fixed_bottom_navigation_container", "cn.eeo.classin:id/fixed_bottom_navigation_icon"]
          }
        ]
      }
    });
    const graphVersion: BusinessGraphVersion = {
      id: "version-1",
      graphId: "graph-1",
      version: 1,
      sourceSummary: [],
      status: "active",
      nodes: [page],
      edges: [],
      createdAt: "2026-06-14T09:00:00.000Z"
    };

    const summary = buildGraphAssetGovernanceSummary(graphVersion, []);

    expect(summary.pageAssets[0]?.identityTexts).toEqual(["主页", "标题栏", "底部导航"]);
    expect(summary.pageAssets[0]?.screenshotRegions[0]?.evidenceTexts).toEqual(["主页", "user avatar", "contact", "search", "cn.eeo.classin:id/create_title", "icon"]);
    expect(summary.pageAssets[0]?.identityTexts.join(" ")).not.toContain("cn.eeo.classin:id");
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("user avatar");
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("contact");
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("search");
    expect(summary.pageAssets[0]?.identityTexts).not.toContain("icon");
  });
});

function node(input: Partial<BusinessNode> & { id: string; key: string; name: string }): BusinessNode {
  return {
    graphVersionId: "version-1",
    nodeType: "page",
    tags: [],
    status: "draft",
    matchers: [],
    defaultExpectations: [],
    ...input
  };
}

function edge(input: Partial<OperationEdge> & { id: string; key: string; name: string; fromNodeId: string; toNodeId: string }): OperationEdge {
  return {
    graphVersionId: "version-1",
    intent: input.name,
    status: "draft",
    source: "exploration",
    preconditions: [],
    actionPolicies: [],
    expectations: [],
    ...input
  };
}

function artifact(input: Partial<ArtifactRef> & { id: string; name: string; url: string }): ArtifactRef {
  return {
    runId: "run-1",
    type: "log",
    path: "runs/run-1/logs/route-gap-exploration.json",
    createdAt: "2026-06-14T10:00:00.000Z",
    ...input
  };
}

function graphRun(input: { id: string; graphVersionId: string; artifacts: ArtifactRef[] }): TestRun {
  return {
    id: input.id,
    caseName: "Graph Run",
    deviceSerial: "device-1",
    status: "failed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: true
    },
    steps: [
      {
        id: "step-graph",
        order: 1,
        type: "wait",
        enabled: true,
        params: { graphRun: true },
        note: "graph-run",
        createdAt: "2026-06-14T10:00:00.000Z"
      }
    ],
    stepResults: [
      {
        id: "step-result-1",
        runId: input.id,
        iterationIndex: 0,
        stepId: "step-graph",
        stepOrder: 1,
        type: "wait",
        status: "failed",
        startedAt: "2026-06-14T10:00:00.000Z",
        metadata: {
          graph: {
            versionId: input.graphVersionId
          }
        },
        artifacts: []
      }
    ],
    metrics: [],
    events: [],
    artifacts: input.artifacts,
    startedAt: "2026-06-14T10:00:00.000Z",
    endedAt: "2026-06-14T10:01:00.000Z"
  };
}
