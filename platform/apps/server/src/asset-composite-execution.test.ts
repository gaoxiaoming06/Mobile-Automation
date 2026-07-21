import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { AssetCompositeExecutionManager, renderAssetCompositeExecutionReportHtml } from "./asset-composite-execution.js";
import type { AssetCompositeExecutionPlan } from "./asset-composition.js";

describe("AssetCompositeExecutionManager", () => {
  it("executes compiled asset steps in order and preserves source-page and PageTask semantics", async () => {
    const runs = new Map<string, TestRun>();
    const requests: Array<Record<string, unknown>> = [];
    let runIndex = 0;
    const manager = new AssetCompositeExecutionManager({
      startGraphRun: async (request) => {
        requests.push(request as unknown as Record<string, unknown>);
        const id = `run-${++runIndex}`;
        runs.set(id, testRun(id, "passed"));
        return { runId: id };
      },
      waitForRun: async () => undefined,
      getRun: (id) => runs.get(id),
      stopRun: async () => true,
      performAction: async () => undefined
    });

    const execution = manager.start({
      deviceSerial: "device-1",
      compositeCaseId: "case-1",
      compositeCaseName: "指定班级创建课堂",
      stopOnFailure: true,
      runMode: "once",
      repeatCount: 1,
      plan: executionPlan()
    });
    await manager.waitForExecution(execution.id);

    const completed = manager.getExecution(execution.id)!;
    expect(completed.status).toBe("passed");
    expect(completed.items.map((item) => [item.metaFunctionName, item.kind, item.status])).toEqual([
      ["进入指定班级", "reach_page", "passed"],
      ["进入指定班级", "invoke_capability", "passed"],
      ["创建课堂但不发布", "run_page_task", "passed"],
      ["创建课堂但不发布", "verify_page", "passed"]
    ]);
    expect(requests[1]).toEqual(expect.objectContaining({ startNodeId: "page-home", targetNodeId: "page-detail" }));
    expect(requests[2]).toEqual(expect.objectContaining({
      startNodeId: "page-create",
      targetNodeId: "page-create",
      overlay: expect.objectContaining({ targetTaskId: "task-fill-lesson", runtimeParams: { className: "班级四十二号", lessonName: "自动化课堂" } })
    }));
    expect(renderAssetCompositeExecutionReportHtml(completed)).toContain("创建课堂但不发布");
    expect(renderAssetCompositeExecutionReportHtml(completed)).toContain("task-fill-lesson");
  });

  it("stops remaining steps after a failed graph run when stopOnFailure is enabled", async () => {
    const runs = new Map<string, TestRun>();
    let runIndex = 0;
    const manager = new AssetCompositeExecutionManager({
      startGraphRun: async () => {
        const id = `run-${++runIndex}`;
        runs.set(id, testRun(id, runIndex === 2 ? "failed" : "passed"));
        return { runId: id };
      },
      waitForRun: async () => undefined,
      getRun: (id) => runs.get(id),
      stopRun: async () => true,
      performAction: async () => undefined
    });

    const execution = manager.start({
      deviceSerial: "device-1",
      compositeCaseId: "case-1",
      compositeCaseName: "失败用例",
      stopOnFailure: true,
      runMode: "once",
      repeatCount: 1,
      plan: executionPlan()
    });
    await manager.waitForExecution(execution.id);

    const completed = manager.getExecution(execution.id)!;
    expect(completed.status).toBe("failed");
    expect(completed.items.map((item) => item.status)).toEqual(["passed", "failed", "skipped", "skipped"]);
  });

  it("continues loop mode until stopped and keeps the active item stopped", async () => {
    const runs = new Map<string, TestRun>();
    let runIndex = 0;
    let releaseActiveRun: (() => void) | undefined;
    const activeRun = new Promise<void>((resolve) => {
      releaseActiveRun = resolve;
    });
    const manager = new AssetCompositeExecutionManager({
      startGraphRun: async () => {
        const id = `run-${++runIndex}`;
        runs.set(id, testRun(id, "passed"));
        return { runId: id };
      },
      waitForRun: async (id) => {
        if (id === "run-5") {
          await activeRun;
        }
      },
      getRun: (id) => runs.get(id),
      stopRun: async () => {
        releaseActiveRun?.();
        return true;
      },
      performAction: async () => undefined
    });

    const execution = manager.start({
      deviceSerial: "device-1",
      compositeCaseId: "case-1",
      compositeCaseName: "循环用例",
      stopOnFailure: true,
      runMode: "loop_until_stop",
      repeatCount: 1,
      plan: executionPlan()
    });
    while (runIndex < 5) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await manager.stop(execution.id);
    await manager.waitForExecution(execution.id);

    const completed = manager.getExecution(execution.id)!;
    expect(completed.status).toBe("stopped");
    expect(completed.items.slice(0, 4).every((item) => item.status === "passed")).toBe(true);
    expect(completed.items[4]).toEqual(expect.objectContaining({ iteration: 2, status: "stopped" }));
  });

  it("executes a launch-app system action without starting a graph run", async () => {
    const actions: Array<{ serial: string; packageName: string }> = [];
    const manager = new AssetCompositeExecutionManager({
      startGraphRun: async () => {
        throw new Error("system action should not start graph run");
      },
      waitForRun: async () => undefined,
      getRun: () => undefined,
      stopRun: async () => true,
      performAction: async (serial, action) => {
        if (action.type === "launch_app") {
          actions.push({ serial, packageName: action.packageName });
        }
      }
    });

    const execution = manager.start({
      deviceSerial: "device-1",
      compositeCaseId: "case-1",
      compositeCaseName: "启动 App",
      stopOnFailure: true,
      runMode: "once",
      repeatCount: 1,
      plan: launchAppPlan()
    });
    await manager.waitForExecution(execution.id);

    const completed = manager.getExecution(execution.id)!;
    expect(completed.status).toBe("passed");
    expect(completed.items[0]).toEqual(expect.objectContaining({
      kind: "system_action",
      status: "passed"
    }));
    expect(completed.items[0]).not.toHaveProperty("runId");
    expect(actions).toEqual([{ serial: "device-1", packageName: "cn.eeo.classin" }]);
  });
});

function executionPlan(): AssetCompositeExecutionPlan {
  const common = {
    caseStepId: "case-step",
    runtimeParams: { className: "班级四十二号", lessonName: "自动化课堂" }
  };
  return {
    status: "ready",
    compositeCaseId: "case-1",
    compositeCaseName: "指定班级创建课堂",
    graphVersionId: "graph-version",
    runtimeParams: common.runtimeParams,
    requiredParameters: ["className"],
    issues: [],
    steps: [
      { ...common, id: "compiled-1", order: 1, metaFunctionId: "meta-enter", metaFunctionName: "进入指定班级", metaFunctionStepId: "reach-home", kind: "reach_page", targetPageModelId: "page-home" },
      { ...common, id: "compiled-2", order: 2, metaFunctionId: "meta-enter", metaFunctionName: "进入指定班级", metaFunctionStepId: "open-class", kind: "invoke_capability", sourcePageModelId: "page-home", targetPageModelId: "page-detail", pageElementId: "class-grid", pageTransitionId: "transition-home-detail" },
      { ...common, id: "compiled-3", order: 3, metaFunctionId: "meta-create", metaFunctionName: "创建课堂但不发布", metaFunctionStepId: "fill-form", kind: "run_page_task", targetPageModelId: "page-create", pageTaskId: "task-fill-lesson" },
      { ...common, id: "compiled-4", order: 4, metaFunctionId: "meta-create", metaFunctionName: "创建课堂但不发布", metaFunctionStepId: "verify", kind: "verify_page", targetPageModelId: "page-create" }
    ]
  };
}

function launchAppPlan(): AssetCompositeExecutionPlan {
  return {
    status: "ready",
    compositeCaseId: "case-1",
    compositeCaseName: "启动 App",
    graphVersionId: "graph-version-empty",
    runtimeParams: {},
    requiredParameters: [],
    issues: [],
    steps: [
      {
        id: "compiled-launch",
        order: 1,
        caseStepId: "case-step-launch",
        metaFunctionId: "meta-launch",
        metaFunctionName: "启动 App",
        metaFunctionStepId: "launch-app",
        kind: "system_action",
        targetPageModelId: "cn.eeo.classin",
        systemAction: "launch_app",
        packageName: "cn.eeo.classin",
        runtimeParams: {}
      }
    ]
  };
}

function testRun(id: string, status: TestRun["status"]): TestRun {
  return {
    id,
    caseName: id,
    deviceSerial: "device-1",
    status,
    config: { deviceSerial: "device-1", mode: "once", repeatCount: 1, stepIntervalMs: 0, stopOnFailure: true, recordVideo: false, keepVideoOnSuccess: false },
    steps: [],
    stepResults: [],
    metrics: [],
    events: [],
    artifacts: [],
    startedAt: "2026-07-12T00:00:00.000Z",
    endedAt: "2026-07-12T00:00:01.000Z"
  };
}
