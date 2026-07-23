import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphAssetGovernanceView, GraphCandidatesPanel, GraphRegisteredListView, GraphRoutePreview, GraphTargetQuality, graphRunRequestBody } from "./GraphCandidatesPanel.js";

describe("GraphCandidatesPanel", () => {
  it("renders source scan controls and explains candidate graph import", () => {
    const markup = renderToStaticMarkup(React.createElement(GraphCandidatesPanel, { setMessage: () => undefined, selectedSerial: "device-1" }));

    expect(markup).toContain("业务图谱模块");
    expect(markup).toContain("目标节点测试");
    expect(markup).toContain("图谱信息");
    expect(markup).toContain("候选资产");
    expect(markup).not.toContain("输入目标节点，自动规划并执行");
    expect(markup).toContain("目标节点");
    expect(markup).toContain("输入目标后每次运行都会重新识别当前位置、规划路径并执行");
    expect(markup).toContain("确认并规划");
    expect(markup).toContain("规划并执行");
    expect(markup).toContain("执行会复用设备锁、视频、截图、异常采集和 HTML 报告");
  });

  it("labels route preview planning as current-device aware", () => {
    const markup = renderToStaticMarkup(React.createElement(GraphCandidatesPanel, { setMessage: () => undefined, selectedSerial: "ERLDU20115007395" }));

    expect(markup).toContain("输入目标后每次运行都会重新识别当前位置、规划路径并执行");
    expect(markup).toContain("当前设备：ERLDU20115007395");
  });

  it("includes android app monitor config when building graph run requests", () => {
    const androidAppMonitor = {
      enabled: true,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true
    };

    expect(graphRunRequestBody({
      selectedSerial: "device-1",
      graphId: "graph-1",
      targetNodeId: "node-1",
      androidAppMonitor
    })).toEqual({
      deviceSerial: "device-1",
      graphId: "graph-1",
      targetNodeId: "node-1",
      startStrategy: "keep_current",
      androidAppMonitor
    });
  });

  it("marks the route preview step list as the internal scroll region", () => {
    const response = {
      executionPlan: {
        unresolvedIssues: [],
        steps: Array.from({ length: 6 }, (_, index) => ({
          id: `step-${index + 1}`,
          order: index + 1,
          name: `步骤 ${index + 1}`,
          fromNode: { name: "起点", key: "start" },
          toNode: { name: "目标", key: "target" },
          action: { type: "tap_on_text" },
          preconditions: [],
          expectations: [],
          issues: []
        }))
      }
    };

    const markup = renderToStaticMarkup(React.createElement(GraphRoutePreview, { response }));

    expect(markup).toContain("graph-route-scroll-region");
    expect(markup).toContain("6 步");
  });

  it("renders runtime graph asset governance summaries", () => {
    const graph = {
      id: "graph-1",
      appId: "classin-android",
      name: "ClassIn",
      status: "active",
      activeVersionId: "version-1",
      activeVersion: {
        id: "version-1",
        version: 1,
        nodes: [],
        edges: []
      }
    };
    const markup = renderToStaticMarkup(
      React.createElement(GraphAssetGovernanceView, {
        graphs: [graph],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            runtimeDraftNodes: [
              {
                id: "node-runtime",
                key: "runtime.unknown.home",
                name: "运行期未知节点：首页",
                status: "draft",
                tags: ["runtime-discovered"],
                observationCount: 2,
                visibleTexts: ["我是教师"],
                resourceIds: ["cn.eeo.classin:id/teacher"],
                accessibilityIds: [],
                artifactIds: ["artifact-runtime"]
              }
            ],
            explorationDraftEdges: [
              {
                id: "edge-explore",
                key: "exploration.home.to.target",
                name: "探索候选：首页 -> 新建课堂页",
                status: "draft",
                source: "exploration",
                fromNodeId: "home",
                fromNodeName: "首页",
                toNodeId: "target",
                toNodeName: "新建课堂页",
                suggestedAction: "tap_on_text: 课堂",
                reliabilityScore: 0.72,
                artifactIds: ["artifact-gap"]
              }
            ],
            routeGapArtifacts: [
              {
                id: "artifact-gap",
                runId: "run-1",
                graphVersionId: "version-1",
                name: "route-gap-exploration-1780000000000.json",
                url: "/artifacts/runs/run-1/logs/route-gap-exploration.json",
                createdAt: "2026-06-14T10:00:00.000Z"
              }
            ]
          }
        },
        onRefresh: () => undefined,
        onPromoteNode: () => undefined,
        onPromoteEdge: () => undefined,
        onAutoPromote: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        currentPageByVersionId: {
          "version-1": {
            status: "draft_created",
            match: { status: "unknown", score: 0.2 },
            node: { id: "node-runtime", key: "runtime.unknown.home", name: "运行期未知节点：首页", status: "draft" },
            observation: { packageName: "cn.eeo.classin", activityName: ".MainActivity" }
          }
        }
      })
    );

    expect(markup).toContain("运行期候选资产治理");
    expect(markup).toContain("运行期未知节点：首页");
    expect(markup).toContain("探索候选：首页 -&gt; 新建课堂页");
    expect(markup).toContain("route-gap-exploration-1780000000000.json");
    expect(markup).toContain("晋级节点");
    expect(markup).toContain("晋级边");
    expect(markup).toContain("按策略自动晋级");
    expect(markup).toContain("识别当前页面");
    expect(markup).toContain("已创建草稿节点：运行期未知节点：首页");
  });

  it("renders target quality states for graph nodes", () => {
    const graph = {
      id: "graph-1",
      appId: "classin-android",
      name: "ClassIn",
      status: "active",
      activeVersionId: "version-1",
      activeVersion: {
        id: "version-1",
        version: 1,
        nodes: [{ id: "node-target", key: "target", name: "目标页", nodeType: "page" }],
        edges: []
      }
    };

    const emptyMarkup = renderToStaticMarkup(React.createElement(GraphTargetQuality, { graph, targetNodeId: "node-target" }));
    expect(emptyMarkup).toContain("该目标暂无历史执行数据");
    expect(emptyMarkup).toContain("首次执行后会沉淀节点和路径稳定性");

    const qualityMarkup = renderToStaticMarkup(
      React.createElement(GraphTargetQuality, {
        graph,
        targetNodeId: "node-target",
        quality: {
          graphVersionId: "version-1",
          analyzedRunCount: 2,
          nodes: [
            {
              nodeId: "node-target",
              nodeName: "目标页",
              runCount: 2,
              passedCount: 1,
              failedCount: 1,
              passRate: 0.5,
              latestRunId: "run-2",
              latestStatus: "failed",
              latestReportUrl: "/artifacts/runs/run-2/reports/report.html",
              recoveryAttemptCount: 2,
              recoveredRunCount: 1
            }
          ],
          edges: [
            {
              edgeId: "edge-1",
              toNodeId: "node-target",
              toNodeName: "目标页",
              runCount: 2,
              passedCount: 1,
              failedCount: 1,
              passRate: 0.5,
              latestFailureMessage: "目标状态未到达"
            }
          ]
        }
      })
    );

    expect(qualityMarkup).toContain("50%");
    expect(qualityMarkup).toContain("最近 2 次");
    expect(qualityMarkup).toContain("恢复成功 1/2");
    expect(qualityMarkup).toContain("目标状态未到达");
    expect(qualityMarkup).toContain("查看最近报告");
  });

  it("hides deprecated and empty draft graphs from the governance view", () => {
    const activeGraph = {
      id: "graph-active",
      appId: "classin-android",
      name: "ClassIn Android 业务图谱",
      status: "active",
      activeVersionId: "version-1",
      activeVersion: {
        id: "version-1",
        version: 1,
        nodes: [],
        edges: []
      }
    };
    const deprecatedGraph = {
      id: "graph-deprecated",
      appId: "classin-android-teacher-create-lesson",
      name: "ClassIn 教师新建课堂业务图谱",
      status: "deprecated",
      activeVersionId: "version-old",
      activeVersion: {
        id: "version-old",
        version: 1,
        nodes: [],
        edges: []
      }
    };
    const emptyDraftGraph = {
      id: "graph-draft",
      appId: "classin-android",
      name: "classin-android 业务图谱",
      status: "draft",
      activeVersionId: undefined,
      activeVersion: undefined
    };

    const markup = renderToStaticMarkup(
      React.createElement(GraphAssetGovernanceView, {
        graphs: [deprecatedGraph, emptyDraftGraph, activeGraph],
        assetsByVersionId: {
          "version-1": {
            graphVersionId: "version-1",
            runtimeDraftNodes: [],
            explorationDraftEdges: [],
            routeGapArtifacts: []
          }
        },
        onRefresh: () => undefined,
        onPromoteNode: () => undefined,
        onPromoteEdge: () => undefined,
        onAutoPromote: () => undefined,
        onIdentifyCurrentPage: () => undefined,
        currentPageByVersionId: {}
      })
    );

    expect(markup).toContain("ClassIn Android 业务图谱");
    expect(markup).not.toContain("ClassIn 教师新建课堂业务图谱");
    expect(markup).not.toContain("classin-android 业务图谱");
  });

  it("renders graph nodes and edges as an app-level graph structure", () => {
    const graph = {
      id: "graph-active",
      appId: "classin-android",
      name: "ClassIn Android 业务图谱",
      status: "active",
      activeVersionId: "version-1",
      activeVersion: {
        id: "version-1",
        version: 1,
        nodes: [
          { id: "node-root", key: "classin.app.root", name: "App 根节点", nodeType: "root" },
          { id: "node-teacher", key: "classin.teacher.classes", name: "我是教师班级列表", nodeType: "page" },
          { id: "node-lesson", key: "classin.teacher.lesson.create", name: "新建课堂页", nodeType: "page" }
        ],
        edges: [
          { id: "edge-root-teacher", key: "classin.launch.to.teacher.classes", name: "启动到教师列表", fromNodeId: "node-root", toNodeId: "node-teacher" },
          { id: "edge-teacher-lesson", key: "classin.teacher.to.lesson", name: "进入新建课堂", fromNodeId: "node-teacher", toNodeId: "node-lesson" }
        ]
      }
    };

    const markup = renderToStaticMarkup(
      React.createElement(GraphRegisteredListView, {
        graphs: [graph],
        selectedTargetNodeId: () => "node-lesson",
        updateSelectedTarget: () => undefined,
        qualityByVersionId: {}
      })
    );

    expect(markup).toContain("图谱节点");
    expect(markup).toContain("classin.teacher.classes");
    expect(markup).toContain("图谱边");
    expect(markup).toContain("我是教师班级列表");
    expect(markup).toContain("新建课堂页");
    expect(markup).toContain("classin.teacher.to.lesson");
  });
});
