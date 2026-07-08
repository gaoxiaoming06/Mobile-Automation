import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import {
  createAssetDrivenExecutionSession,
  markAssetDrivenExecutionItemStarted,
  stopAssetDrivenExecutionSession,
  updateAssetDrivenExecutionItemFromRun
} from "./asset-driven-execution-session.js";
import type { AssetDrivenReadyExecutionTarget } from "./asset-patrol.js";

describe("asset-driven execution session", () => {
  it("keeps the batch running after the first edge passes and the next edge starts", () => {
    const session = createAssetDrivenExecutionSession({
      id: "asset-session-1",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      graphVersionId: "graph-1",
      startNodeId: "node-home",
      startNodeName: "主页",
      targets: [
        target({ transitionName: "主页 -> 搜索", targetNodeId: "node-search", targetNodeName: "搜索" }),
        target({ transitionName: "主页 -> 添加好友", targetNodeId: "node-add-friend", targetNodeName: "添加好友" })
      ],
      now: "2026-07-07T10:00:00.000Z"
    });

    markAssetDrivenExecutionItemStarted(session, 0, run({ id: "run-search", status: "running", caseName: "搜索" }), "2026-07-07T10:00:01.000Z");
    updateAssetDrivenExecutionItemFromRun(session, run({ id: "run-search", status: "passed", caseName: "搜索" }), "2026-07-07T10:00:02.000Z");
    markAssetDrivenExecutionItemStarted(session, 1, run({ id: "run-add", status: "running", caseName: "添加好友" }), "2026-07-07T10:00:03.000Z");

    expect(session.status).toBe("running");
    expect(session.completedEdges).toBe(1);
    expect(session.runningEdges).toBe(1);
    expect(session.pendingEdges).toBe(0);
    expect(session.failedEdges).toBe(0);
    expect(session.runningItem?.label).toBe("主页 -> 添加好友");
    expect(session.items.map((item) => [item.label, item.status, item.runId])).toEqual([
      ["主页 -> 搜索", "passed", "run-search"],
      ["主页 -> 添加好友", "running", "run-add"]
    ]);
  });

  it("stops the whole batch by marking running and pending edges as stopped", () => {
    const session = createAssetDrivenExecutionSession({
      id: "asset-session-1",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      graphVersionId: "graph-1",
      startNodeId: "node-home",
      startNodeName: "主页",
      targets: [
        target({ transitionName: "主页 -> 搜索", targetNodeId: "node-search", targetNodeName: "搜索" }),
        target({ transitionName: "主页 -> 添加好友", targetNodeId: "node-add-friend", targetNodeName: "添加好友" }),
        target({ transitionName: "主页 -> 设置", targetNodeId: "node-settings", targetNodeName: "设置" })
      ],
      now: "2026-07-07T10:00:00.000Z"
    });
    markAssetDrivenExecutionItemStarted(session, 0, run({ id: "run-search", status: "running", caseName: "搜索" }), "2026-07-07T10:00:01.000Z");
    updateAssetDrivenExecutionItemFromRun(session, run({ id: "run-search", status: "passed", caseName: "搜索" }), "2026-07-07T10:00:02.000Z");
    markAssetDrivenExecutionItemStarted(session, 1, run({ id: "run-add", status: "running", caseName: "添加好友" }), "2026-07-07T10:00:03.000Z");

    stopAssetDrivenExecutionSession(session, "用户停止本轮资产测试。", "2026-07-07T10:00:04.000Z");

    expect(session.status).toBe("stopped");
    expect(session.completedEdges).toBe(1);
    expect(session.runningEdges).toBe(0);
    expect(session.pendingEdges).toBe(0);
    expect(session.failedEdges).toBe(2);
    expect(session.endedAt).toBe("2026-07-07T10:00:04.000Z");
    expect(session.items.map((item) => [item.label, item.status, item.errorMessage])).toEqual([
      ["主页 -> 搜索", "passed", undefined],
      ["主页 -> 添加好友", "stopped", "用户停止本轮资产测试。"],
      ["主页 -> 设置", "stopped", "用户停止本轮资产测试。"]
    ]);
  });
});

function target(patch: Partial<AssetDrivenReadyExecutionTarget>): AssetDrivenReadyExecutionTarget {
  return {
    status: "ready",
    graphVersionId: "graph-1",
    startNodeId: "node-home",
    startNodeName: "主页",
    targetNodeId: patch.targetNodeId ?? "node-target",
    targetNodeName: patch.targetNodeName ?? "目标页",
    transitionId: patch.transitionId ?? `transition-${patch.targetNodeId ?? "target"}`,
    transitionName: patch.transitionName,
    pageTaskId: patch.pageTaskId,
    overlay: {
      id: "overlay-1",
      targetNodeId: patch.targetNodeId ?? "node-target"
    }
  };
}

function run(patch: Partial<TestRun>): TestRun {
  return {
    id: patch.id ?? "run-1",
    caseName: patch.caseName ?? "ClassIn Android 业务图谱 目标节点执行",
    deviceSerial: "device-1",
    status: patch.status ?? "running",
    config: {
      runKind: "business_graph",
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 400,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: true
    },
    steps: [],
    stepResults: [
      {
        id: "step-result-1",
        runId: patch.id ?? "run-1",
        iterationIndex: 0,
        stepId: "step-1",
        stepOrder: 1,
        type: "tap_on_image",
        status: patch.status === "failed" ? "failed" : "passed",
        startedAt: "2026-07-07T10:00:00.000Z",
        artifacts: [],
        metadata: {
          graph: {
            label: patch.caseName ?? "目标节点执行"
          }
        }
      }
    ],
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: "2026-07-07T10:00:00.000Z",
    endedAt: patch.status && patch.status !== "running" ? "2026-07-07T10:00:02.000Z" : undefined,
    reportHtmlPath: patch.reportHtmlPath
  };
}
