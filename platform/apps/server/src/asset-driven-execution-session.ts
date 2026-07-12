import { createId, nowIso, type RunStatus, type TestRun } from "@mobile-automation/shared";
import type { AssetDrivenReadyExecutionTarget } from "./asset-patrol.js";

export type AssetDrivenExecutionItemStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "stopped";
export type AssetDrivenExecutionSessionStatus = "running" | "passed" | "failed" | "stopped";

export type AssetDrivenExecutionRepairAttempt = {
  id: string;
  runId: string;
  classification?: string;
  confidence?: number;
  action: "diagnosed" | "applied" | "skipped" | "failed";
  summary: string;
  detail?: string;
  createdAt: string;
};

export type AssetDrivenExecutionRecovery = {
  id: string;
  afterItemOrder: number;
  fromPage: string;
  toPage: string;
  status: "passed" | "failed";
  strategy: string;
  durationMs: number;
  message: string;
  createdAt: string;
};

export type AssetDrivenExecutionItem = {
  id: string;
  order: number;
  label: string;
  fromPage: string;
  toPage: string;
  transitionId?: string;
  pageTaskId?: string;
  runId?: string;
  status: AssetDrivenExecutionItemStatus;
  latestStep?: string;
  errorMessage?: string;
  reportHtmlPath?: string;
  startedAt?: string;
  endedAt?: string;
  repairAttempts?: AssetDrivenExecutionRepairAttempt[];
};

export type AssetDrivenExecutionSession = {
  id: string;
  deviceSerial: string;
  packageName: string;
  graphVersionId?: string;
  startNodeId: string;
  startNodeName: string;
  status: AssetDrivenExecutionSessionStatus;
  totalEdges: number;
  completedEdges: number;
  runningEdges: number;
  pendingEdges: number;
  failedEdges: number;
  needsRepair: number;
  runningItem?: AssetDrivenExecutionItem;
  items: AssetDrivenExecutionItem[];
  recoveries: AssetDrivenExecutionRecovery[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
};

export function createAssetDrivenExecutionSession(input: {
  id?: string;
  deviceSerial: string;
  packageName: string;
  graphVersionId?: string;
  startNodeId: string;
  startNodeName: string;
  targets: AssetDrivenReadyExecutionTarget[];
  now?: string;
}): AssetDrivenExecutionSession {
  const timestamp = input.now ?? nowIso();
  const sessionId = input.id ?? createId("asset_execution");
  const session: AssetDrivenExecutionSession = {
    id: sessionId,
    deviceSerial: input.deviceSerial,
    packageName: input.packageName,
    graphVersionId: input.graphVersionId,
    startNodeId: input.startNodeId,
    startNodeName: input.startNodeName,
    status: "running",
    totalEdges: input.targets.length,
    completedEdges: 0,
    runningEdges: 0,
    pendingEdges: input.targets.length,
    failedEdges: 0,
    needsRepair: 0,
    recoveries: [],
    items: input.targets.map((target, index) => ({
      id: `${sessionId}_item_${index + 1}`,
      order: index + 1,
      label: assetDrivenExecutionTargetLabel(target),
      fromPage: target.startNodeName,
      toPage: target.targetNodeName,
      transitionId: target.transitionId,
      pageTaskId: target.pageTaskId,
      status: "pending"
    })),
    startedAt: timestamp,
    updatedAt: timestamp
  };
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function markAssetDrivenExecutionItemStarted(
  session: AssetDrivenExecutionSession,
  itemIndex: number,
  run: TestRun,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  const item = session.items[itemIndex];
  if (!item) {
    return recomputeAssetDrivenExecutionSession(session, timestamp);
  }
  item.runId = run.id;
  item.status = "running";
  item.latestStep = latestRunStepLabel(run);
  item.reportHtmlPath = run.reportHtmlPath;
  item.startedAt = timestamp;
  item.endedAt = undefined;
  item.errorMessage = undefined;
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function updateAssetDrivenExecutionItemFromRun(
  session: AssetDrivenExecutionSession,
  run: TestRun,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  const item = session.items.find((candidate) => candidate.runId === run.id);
  if (!item) {
    return recomputeAssetDrivenExecutionSession(session, timestamp);
  }
  item.status = assetDrivenItemStatusFromRunStatus(run.status);
  item.latestStep = latestRunStepLabel(run) ?? item.latestStep;
  item.errorMessage = latestRunErrorMessage(run);
  item.reportHtmlPath = run.reportHtmlPath;
  if (item.status !== "running" && !item.endedAt) {
    item.endedAt = timestamp;
  }
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function recordAssetDrivenExecutionRepairAttempt(
  session: AssetDrivenExecutionSession,
  runId: string,
  attempt: Omit<AssetDrivenExecutionRepairAttempt, "id" | "runId" | "createdAt">,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  const item = session.items.find((candidate) => candidate.runId === runId);
  if (!item) {
    return recomputeAssetDrivenExecutionSession(session, timestamp);
  }
  item.repairAttempts = [
    ...(item.repairAttempts ?? []),
    {
      id: createId("asset_repair"),
      runId,
      ...attempt,
      createdAt: timestamp
    }
  ];
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function recordAssetDrivenExecutionRecovery(
  session: AssetDrivenExecutionSession,
  recovery: Omit<AssetDrivenExecutionRecovery, "id" | "createdAt">,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  session.recoveries.push({
    id: createId("asset_recovery"),
    ...recovery,
    createdAt: timestamp
  });
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function skipPendingAssetDrivenExecutionItems(
  session: AssetDrivenExecutionSession,
  reason: string,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  for (const item of session.items) {
    if (item.status === "pending") {
      item.status = "skipped";
      item.errorMessage = reason;
      item.endedAt = timestamp;
    }
  }
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function stopAssetDrivenExecutionSession(
  session: AssetDrivenExecutionSession,
  reason: string,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  for (const item of session.items) {
    if (item.status === "running" || item.status === "pending" || (item.status === "stopped" && !item.errorMessage)) {
      item.status = "stopped";
      item.errorMessage = reason;
      item.endedAt = timestamp;
    }
  }
  return recomputeAssetDrivenExecutionSession(session, timestamp);
}

export function shouldAttemptNextAssetDrivenTarget(status: RunStatus | undefined): boolean {
  return status === "passed" || status === "failed";
}

export function renderAssetDrivenExecutionReportHtml(session: AssetDrivenExecutionSession): string {
  const itemRows = session.items.map((item) => `
    <tr>
      <td>${item.order}</td>
      <td>${escapeHtml(item.label)}</td>
      <td><span class="status ${item.status}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.runId ?? "-")}</td>
      <td>${escapeHtml(item.errorMessage ?? "-")}</td>
    </tr>`).join("");
  const recoveryRows = session.recoveries.length
    ? session.recoveries.map((recovery) => `
      <tr>
        <td>${recovery.afterItemOrder}</td>
        <td>${escapeHtml(recovery.fromPage)} → ${escapeHtml(recovery.toPage)}</td>
        <td>${escapeHtml(recovery.strategy)}</td>
        <td><span class="status ${recovery.status}">${escapeHtml(recovery.status)}</span></td>
        <td>${recovery.durationMs} ms</td>
        <td>${escapeHtml(recovery.message)}</td>
      </tr>`).join("")
    : '<tr><td colspan="6">本批次没有边间恢复记录。</td></tr>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>资产测试批次报告</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;margin:32px;color:#171717;background:#f7f7f7}main{max-width:1180px;margin:auto;background:#fff;padding:28px;border:1px solid #ddd}h1,h2{margin:0 0 18px}h2{margin-top:30px;font-size:18px}.summary{display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:10px}.summary div{padding:12px;border:1px solid #ddd}.summary strong{display:block;font-size:22px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #ddd;text-align:left;vertical-align:top}.status{font-weight:700}.passed{color:#16794b}.failed,.skipped,.stopped{color:#b42318}.running{color:#175cd3}small{color:#666}
  </style>
</head>
<body><main>
  <h1>资产测试批次报告</h1>
  <small>${escapeHtml(session.id)} · ${escapeHtml(session.packageName)} · ${escapeHtml(session.deviceSerial)}</small>
  <div class="summary">
    <div><span>起点</span><strong>${escapeHtml(session.startNodeName)}</strong></div>
    <div><span>总边数</span><strong>${session.totalEdges}</strong></div>
    <div><span>通过</span><strong>${session.completedEdges}</strong></div>
    <div><span>失败</span><strong>${session.failedEdges}</strong></div>
    <div><span>状态</span><strong>${escapeHtml(session.status)}</strong></div>
  </div>
  <h2>边执行结果</h2>
  <p>单边失败会记录后继续执行其余独立边；仅无法恢复起点、设备丢失或用户停止时中断。失败后继续。</p>
  <table><thead><tr><th>#</th><th>连接边</th><th>状态</th><th>Run</th><th>错误</th></tr></thead><tbody>${itemRows}</tbody></table>
  <h2>起点恢复记录</h2>
  <table><thead><tr><th>前序边</th><th>恢复路径</th><th>策略</th><th>状态</th><th>耗时</th><th>说明</th></tr></thead><tbody>${recoveryRows}</tbody></table>
</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function recomputeAssetDrivenExecutionSession(
  session: AssetDrivenExecutionSession,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  session.totalEdges = session.items.length;
  session.completedEdges = session.items.filter((item) => item.status === "passed").length;
  session.runningEdges = session.items.filter((item) => item.status === "running").length;
  session.pendingEdges = session.items.filter((item) => item.status === "pending").length;
  session.failedEdges = session.items.filter((item) => item.status === "failed" || item.status === "stopped" || item.status === "skipped").length;
  session.needsRepair = session.items.filter((item) => item.status === "failed").length;
  session.runningItem = session.items.find((item) => item.status === "running");
  if (session.runningEdges > 0 || session.pendingEdges > 0) {
    session.status = "running";
    session.endedAt = undefined;
  } else if (session.failedEdges > 0) {
    session.status = session.items.some((item) => item.status === "stopped") ? "stopped" : "failed";
    session.endedAt ??= timestamp;
  } else {
    session.status = "passed";
    session.endedAt ??= timestamp;
  }
  session.updatedAt = timestamp;
  return session;
}

function assetDrivenExecutionTargetLabel(target: AssetDrivenReadyExecutionTarget): string {
  return target.transitionName?.trim() || `${target.startNodeName} -> ${target.targetNodeName}`;
}

function assetDrivenItemStatusFromRunStatus(status: RunStatus): AssetDrivenExecutionItemStatus {
  if (status === "passed") {
    return "passed";
  }
  if (status === "running" || status === "pending" || status === "paused") {
    return "running";
  }
  if (status === "stopped" || status === "device_lost") {
    return "stopped";
  }
  return "failed";
}

function latestRunStepLabel(run: TestRun): string | undefined {
  const step = run.stepResults.at(-1);
  if (!step) {
    return undefined;
  }
  const graphMetadata = step.metadata?.graph;
  if (graphMetadata && typeof graphMetadata === "object" && "label" in graphMetadata && typeof graphMetadata.label === "string") {
    return graphMetadata.label;
  }
  return step.type;
}

function latestRunErrorMessage(run: TestRun): string | undefined {
  for (let index = run.stepResults.length - 1; index >= 0; index -= 1) {
    const step = run.stepResults[index];
    if (step && (step.status === "failed" || step.status === "timeout")) {
      return step.errorMessage;
    }
  }
  return undefined;
}
