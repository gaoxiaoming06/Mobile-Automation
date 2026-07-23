import { createId, nowIso, type DeviceActionRequest, type RunConfig, type RunMode, type TestRun } from "@mobile-automation/shared";
import { missingRequiredParameterKeysFromIssues, type AssetCompositeExecutionPlan, type CompiledAssetCompositionStep } from "./asset-composition.js";

export type AssetCompositeExecutionItemStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "stopped";
export type AssetCompositeExecutionStatus = "running" | "passed" | "failed" | "stopped";
export type AssetCompositeExecutionType = "asset_composition" | "free_composition";

export type AssetCompositeExecutionItem = {
  id: string;
  order: number;
  iteration: number;
  compiledStepId: string;
  metaFunctionId: string;
  metaFunctionName: string;
  metaFunctionStepId: string;
  kind: CompiledAssetCompositionStep["kind"];
  targetPageModelId: string;
  pageElementId?: string;
  pageTransitionId?: string;
  pageTaskId?: string;
  systemAction?: "launch_app";
  packageName?: string;
  status: AssetCompositeExecutionItemStatus;
  runId?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};

export type AssetCompositeExecution = {
  id: string;
  deviceSerial: string;
  compositeCaseId: string;
  compositeCaseName: string;
  executionType: AssetCompositeExecutionType;
  graphVersionId: string;
  status: AssetCompositeExecutionStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  pendingItems: number;
  currentItem?: AssetCompositeExecutionItem;
  items: AssetCompositeExecutionItem[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
};

export type AssetCompositeGraphRunRequest = {
  deviceSerial: string;
  graphVersionId: string;
  targetNodeId: string;
  startNodeId?: string;
  startStrategy: "keep_current";
  startAppScope: "current_device";
  executionProfile: "fast_visual";
  stopOnFailure: boolean;
  caseName: string;
  executionContext?: RunConfig["executionContext"];
  androidAppMonitor?: RunConfig["androidAppMonitor"];
  overlay: {
    id: string;
    targetNodeId: string;
    targetTaskId?: string;
    runtimeParams: Record<string, string>;
    note: string;
  };
};

type AssetCompositeExecutionDependencies = {
  startGraphRun(request: AssetCompositeGraphRunRequest): Promise<{ runId: string }>;
  waitForRun(runId: string): Promise<void>;
  getRun(runId: string): TestRun | undefined;
  stopRun(runId: string): Promise<boolean>;
  performAction(deviceSerial: string, action: DeviceActionRequest): Promise<void>;
};

export class AssetCompositeExecutionManager {
  private readonly executions = new Map<string, AssetCompositeExecution>();
  private readonly active = new Map<string, { promise: Promise<void>; cancelled: boolean; runId?: string }>();

  constructor(private readonly dependencies: AssetCompositeExecutionDependencies) {}

  start(input: {
    deviceSerial: string;
    compositeCaseId: string;
    compositeCaseName: string;
    stopOnFailure: boolean;
    runMode: RunMode;
    repeatCount: number;
    executionType?: AssetCompositeExecutionType;
    androidAppMonitor?: RunConfig["androidAppMonitor"];
    plan: AssetCompositeExecutionPlan;
  }): AssetCompositeExecution {
    if (input.plan.status !== "ready") {
      if (input.plan.status === "needs_parameters") {
        throw new Error("请先补充参数：" + missingRequiredParameterKeysFromIssues(input.plan.issues).join("、"));
      }
      throw new Error(input.plan.issues[0]?.message ?? "组合用例预检未通过。");
    }
    const id = createId("asset_composite_execution");
    const startedAt = nowIso();
    const initialIterations = input.runMode === "loop_until_stop" ? 1 : Math.max(1, input.repeatCount);
    const items = createExecutionItems(id, input.plan.steps, initialIterations);
    const execution: AssetCompositeExecution = {
      id,
      deviceSerial: input.deviceSerial,
      compositeCaseId: input.compositeCaseId,
      compositeCaseName: input.compositeCaseName,
      executionType: input.executionType ?? "asset_composition",
      graphVersionId: input.plan.graphVersionId,
      status: "running",
      totalItems: items.length,
      completedItems: 0,
      failedItems: 0,
      pendingItems: items.length,
      items,
      startedAt,
      updatedAt: startedAt
    };
    this.executions.set(id, execution);
    const state = { promise: Promise.resolve(), cancelled: false, runId: undefined as string | undefined };
    state.promise = this.execute(execution, input.plan, input.stopOnFailure, input.runMode, input.androidAppMonitor, state);
    this.active.set(id, state);
    void state.promise.finally(() => this.active.delete(id));
    return execution;
  }

  getExecution(id: string): AssetCompositeExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(): AssetCompositeExecution[] {
    return [...this.executions.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async waitForExecution(id: string): Promise<void> {
    await this.active.get(id)?.promise;
  }

  async stop(id: string): Promise<boolean> {
    const state = this.active.get(id);
    const execution = this.executions.get(id);
    if (!state || !execution) {
      return false;
    }
    state.cancelled = true;
    if (state.runId) {
      await this.dependencies.stopRun(state.runId);
    }
    for (const item of execution.items) {
      if (item.status === "pending" || item.status === "running") {
        item.status = "stopped";
        item.endedAt = nowIso();
      }
    }
    recomputeExecution(execution, "stopped");
    return true;
  }

  private async execute(
    execution: AssetCompositeExecution,
    plan: AssetCompositeExecutionPlan,
    stopOnFailure: boolean,
    runMode: RunMode,
    androidAppMonitor: RunConfig["androidAppMonitor"] | undefined,
    state: { cancelled: boolean; runId?: string }
  ): Promise<void> {
    const compiledById = new Map(plan.steps.map((step) => [step.id, step]));
    let itemIndex = 0;
    while (itemIndex < execution.items.length) {
      const item = execution.items[itemIndex]!;
      if (state.cancelled) {
        break;
      }
      const step = compiledById.get(item.compiledStepId);
      if (!step) {
        item.status = "failed";
        item.error = `Compiled step not found: ${item.compiledStepId}`;
        item.endedAt = nowIso();
        if (stopOnFailure) {
          skipRemainingItems(execution, item.order);
          break;
        }
        continue;
      }
      item.status = "running";
      item.startedAt = nowIso();
      execution.currentItem = item;
      recomputeExecution(execution);
      try {
        if (step.kind === "system_action") {
          await this.dependencies.performAction(execution.deviceSerial, systemActionRequest(step));
          item.status = state.cancelled ? "stopped" : "passed";
        } else {
          const started = await this.dependencies.startGraphRun(graphRunRequest(execution, item, step, androidAppMonitor));
          state.runId = started.runId;
          item.runId = started.runId;
          await this.dependencies.waitForRun(started.runId);
          const run = this.dependencies.getRun(started.runId);
          item.status = state.cancelled ? "stopped" : run?.status === "passed" ? "passed" : run?.status === "stopped" ? "stopped" : "failed";
          item.error = item.status === "failed" ? runFailureMessage(run) : undefined;
        }
      } catch (error) {
        item.status = "failed";
        item.error = error instanceof Error ? error.message : String(error);
      } finally {
        state.runId = undefined;
        item.endedAt = nowIso();
        execution.currentItem = undefined;
        recomputeExecution(execution);
      }
      if ((item.status === "failed" || item.status === "stopped") && stopOnFailure) {
        skipRemainingItems(execution, item.order);
        break;
      }
      itemIndex += 1;
      if (runMode === "loop_until_stop" && itemIndex === execution.items.length && !state.cancelled) {
        appendExecutionIteration(execution, plan.steps);
      }
    }
    if (execution.status === "running") {
      recomputeExecution(execution, execution.items.some((item) => item.status === "failed") ? "failed" : state.cancelled ? "stopped" : "passed");
    }
  }
}

function appendExecutionIteration(execution: AssetCompositeExecution, steps: CompiledAssetCompositionStep[]): void {
  const iteration = (execution.items.at(-1)?.iteration ?? 0) + 1;
  for (const step of steps) {
    execution.items.push(executionItem(execution.id, execution.items.length + 1, iteration, step));
  }
  execution.totalItems = execution.items.length;
  recomputeExecution(execution);
}

export function renderAssetCompositeExecutionReportHtml(execution: AssetCompositeExecution): string {
  const groups = new Map<string, AssetCompositeExecutionItem[]>();
  for (const item of execution.items) {
    const key = `${item.iteration}:${item.metaFunctionId}:${item.metaFunctionName}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const sections = [...groups.entries()].map(([key, items]) => {
    const [iteration, , name] = key.split(":");
    const rows = items.map((item) => `<tr>
      <td>${item.order}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.targetPageModelId)}</td>
      <td>${escapeHtml(item.systemAction ?? item.pageElementId ?? item.pageTaskId ?? "-")}</td><td class="${item.status}">${escapeHtml(item.status)}</td>
      <td>${item.runId ? escapeHtml(item.runId) : "-"}</td><td>${escapeHtml(item.error ?? "")}</td>
    </tr>`).join("");
    return `<section><h2>第 ${escapeHtml(iteration ?? "1")} 轮 · ${escapeHtml(name ?? "元功能")}</h2>
      <table><thead><tr><th>顺序</th><th>资产步骤</th><th>目标页面</th><th>能力 / 任务</th><th>状态</th><th>Run</th><th>错误</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(execution.compositeCaseName)}</title>
  <style>body{font-family:system-ui;margin:32px;color:#17202a}main{max-width:1180px;margin:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #d7dde5;padding:9px;text-align:left}.passed{color:#16794b}.failed,.stopped{color:#b42318}.skipped{color:#7a5d00}section{margin-top:28px}</style></head>
  <body><main><h1>${escapeHtml(execution.compositeCaseName)}</h1><p>状态：${escapeHtml(execution.status)} · ${execution.completedItems}/${execution.totalItems} 完成</p>${sections}</main></body></html>`;
}

function createExecutionItems(id: string, steps: CompiledAssetCompositionStep[], repeatCount: number): AssetCompositeExecutionItem[] {
  const items: AssetCompositeExecutionItem[] = [];
  for (let iteration = 1; iteration <= repeatCount; iteration += 1) {
    for (const step of steps) {
      items.push({
        ...executionItem(id, items.length + 1, iteration, step)
      });
    }
  }
  return items;
}

function executionItem(id: string, order: number, iteration: number, step: CompiledAssetCompositionStep): AssetCompositeExecutionItem {
  return {
    id: `${id}_item_${order}`,
    order,
    iteration,
    compiledStepId: step.id,
    metaFunctionId: step.metaFunctionId,
    metaFunctionName: step.metaFunctionName,
    metaFunctionStepId: step.metaFunctionStepId,
    kind: step.kind,
    targetPageModelId: step.targetPageModelId,
    pageElementId: step.pageElementId,
    pageTransitionId: step.pageTransitionId,
    pageTaskId: step.pageTaskId,
    systemAction: step.systemAction,
    packageName: step.packageName,
    status: "pending"
  };
}

function systemActionRequest(step: CompiledAssetCompositionStep): DeviceActionRequest {
  if (step.systemAction === "launch_app" && step.packageName) {
    return { type: "launch_app", packageName: step.packageName };
  }
  throw new Error(`Unsupported system action: ${step.systemAction ?? step.kind}`);
}

function graphRunRequest(
  execution: AssetCompositeExecution,
  item: AssetCompositeExecutionItem,
  step: CompiledAssetCompositionStep,
  androidAppMonitor?: RunConfig["androidAppMonitor"]
): AssetCompositeGraphRunRequest {
  const startNodeId = step.kind === "invoke_capability"
    ? step.sourcePageModelId
    : step.kind === "run_page_task" || step.kind === "verify_page"
      ? step.targetPageModelId
      : undefined;
  return {
    deviceSerial: execution.deviceSerial,
    graphVersionId: execution.graphVersionId,
    targetNodeId: step.targetPageModelId,
    ...(startNodeId ? { startNodeId } : {}),
    startStrategy: "keep_current",
    startAppScope: "current_device",
    executionProfile: "fast_visual",
    stopOnFailure: true,
    caseName: `资产组合｜${execution.compositeCaseName}｜${step.metaFunctionName}`,
    executionContext: {
      parentExecutionId: execution.id,
      parentExecutionType: execution.executionType,
      parentExecutionName: execution.compositeCaseName,
      executionItemId: item.id,
      itemOrder: item.order,
      itemLabel: step.metaFunctionStepName ?? step.metaFunctionName,
      itemKind: step.kind
    },
    ...(androidAppMonitor ? { androidAppMonitor } : {}),
    overlay: {
      id: `asset-composite-${execution.id}-${step.id}`,
      targetNodeId: step.targetPageModelId,
      ...(step.kind === "run_page_task" && step.pageTaskId ? { targetTaskId: step.pageTaskId } : {}),
      runtimeParams: step.runtimeParams,
      note: `${step.metaFunctionName} / ${step.metaFunctionStepName ?? step.kind}`
    }
  };
}

function runFailureMessage(run: TestRun | undefined): string {
  if (!run) {
    return "Graph run result not found.";
  }
  return run.stepResults.find((item) => item.status === "failed")?.errorMessage ?? `Graph run ended with ${run.status}.`;
}

function skipRemainingItems(execution: AssetCompositeExecution, afterOrder: number): void {
  for (const item of execution.items) {
    if (item.order > afterOrder && item.status === "pending") {
      item.status = "skipped";
      item.endedAt = nowIso();
    }
  }
  recomputeExecution(execution);
}

function recomputeExecution(execution: AssetCompositeExecution, forcedStatus?: AssetCompositeExecutionStatus): void {
  execution.completedItems = execution.items.filter((item) => item.status === "passed" || item.status === "failed" || item.status === "skipped" || item.status === "stopped").length;
  execution.failedItems = execution.items.filter((item) => item.status === "failed").length;
  execution.pendingItems = execution.items.filter((item) => item.status === "pending").length;
  execution.updatedAt = nowIso();
  if (forcedStatus) {
    execution.status = forcedStatus;
    execution.endedAt = nowIso();
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
