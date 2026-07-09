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

export function recomputeAssetDrivenExecutionSession(
  session: AssetDrivenExecutionSession,
  timestamp = nowIso()
): AssetDrivenExecutionSession {
  session.totalEdges = session.items.length;
  session.completedEdges = session.items.filter((item) => item.status === "passed").length;
  session.runningEdges = session.items.filter((item) => item.status === "running").length;
  session.pendingEdges = session.items.filter((item) => item.status === "pending").length;
  session.failedEdges = session.items.filter((item) => item.status === "failed" || item.status === "stopped").length;
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
