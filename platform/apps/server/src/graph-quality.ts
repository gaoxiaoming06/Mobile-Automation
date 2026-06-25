import type { StepResult, TestRun } from "@mobile-automation/shared";

export type GraphQualityStorage = {
  listRuns(limit?: number, offset?: number): TestRun[];
};

export type GraphQualitySummary = {
  graphVersionId: string;
  analyzedRunCount: number;
  limit: number;
  generatedAt: string;
  nodes: GraphQualityNodeSummary[];
  edges: GraphQualityEdgeSummary[];
};

export type GraphQualityNodeSummary = GraphQualityItemSummary & {
  nodeId: string;
  nodeName?: string;
};

export type GraphQualityEdgeSummary = GraphQualityItemSummary & {
  edgeId: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
};

type GraphQualityItemSummary = {
  runCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  recoveryAttemptCount: number;
  recoveredRunCount: number;
  latestRunId?: string;
  latestStatus?: TestRun["status"];
  latestReportUrl?: string;
  latestFailureMessage?: string;
  latestAt?: string;
};

type MutableNodeSummary = Omit<GraphQualityNodeSummary, "passRate"> & {
  latestAtMs?: number;
};

type MutableEdgeSummary = Omit<GraphQualityEdgeSummary, "passRate"> & {
  latestAtMs?: number;
};

type GraphStepMetadata = {
  versionId?: string;
  edgeId?: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
  recoveryAttempt?: number;
};

export function buildGraphQualitySummary(storage: GraphQualityStorage, graphVersionId: string, options: { limit?: number; now?: string } = {}): GraphQualitySummary {
  const limit = clampLimit(options.limit ?? 100);
  const runs = storage.listRuns(limit, 0);
  const nodes = new Map<string, MutableNodeSummary>();
  const edges = new Map<string, MutableEdgeSummary>();
  const analyzedRunIds = new Set<string>();

  for (const run of runs) {
    let runMatched = false;
    for (const step of run.stepResults) {
      const graph = readStepGraphMetadata(step);
      if (graph.versionId !== graphVersionId) {
        continue;
      }
      runMatched = true;
      applyEdgeStats(edges, run, step, graph);
      applyNodeStats(nodes, run, step, graph);
    }
    if (runMatched) {
      analyzedRunIds.add(run.id);
    }
  }

  return {
    graphVersionId,
    analyzedRunCount: analyzedRunIds.size,
    limit,
    generatedAt: options.now ?? new Date().toISOString(),
    nodes: Array.from(nodes.values()).map(finalizeNodeSummary).sort(sortQualityItems),
    edges: Array.from(edges.values()).map(finalizeEdgeSummary).sort(sortQualityItems)
  };
}

function applyEdgeStats(edges: Map<string, MutableEdgeSummary>, run: TestRun, step: StepResult, graph: GraphStepMetadata): void {
  if (!graph.edgeId) {
    return;
  }
  const summary =
    edges.get(graph.edgeId) ??
    ({
      edgeId: graph.edgeId,
      edgeKey: graph.edgeKey,
      fromNodeId: graph.fromNodeId,
      fromNodeName: graph.fromNodeName,
      toNodeId: graph.toNodeId,
      toNodeName: graph.toNodeName,
      runCount: 0,
      passedCount: 0,
      failedCount: 0,
      recoveryAttemptCount: 0,
      recoveredRunCount: 0
    } satisfies MutableEdgeSummary);
  updateStats(summary, run, step);
  edges.set(graph.edgeId, summary);
}

function applyNodeStats(nodes: Map<string, MutableNodeSummary>, run: TestRun, step: StepResult, graph: GraphStepMetadata): void {
  if (!graph.toNodeId) {
    return;
  }
  const summary =
    nodes.get(graph.toNodeId) ??
    ({
      nodeId: graph.toNodeId,
      nodeName: graph.toNodeName,
      runCount: 0,
      passedCount: 0,
      failedCount: 0,
      recoveryAttemptCount: 0,
      recoveredRunCount: 0
    } satisfies MutableNodeSummary);
  updateStats(summary, run, step);
  nodes.set(graph.toNodeId, summary);
}

function updateStats(summary: MutableNodeSummary | MutableEdgeSummary, run: TestRun, step: StepResult): void {
  summary.runCount += 1;
  if (isStepPassed(step)) {
    summary.passedCount += 1;
  } else {
    summary.failedCount += 1;
  }
  const graph = readStepGraphMetadata(step);
  if (typeof graph.recoveryAttempt === "number" && graph.recoveryAttempt > 0) {
    summary.recoveryAttemptCount += 1;
    if (isStepPassed(step)) {
      summary.recoveredRunCount += 1;
    }
  }

  const latestAt = step.endedAt ?? step.startedAt ?? run.endedAt ?? run.startedAt;
  const latestAtMs = Date.parse(latestAt);
  if (summary.latestAtMs === undefined || (Number.isFinite(latestAtMs) && latestAtMs >= summary.latestAtMs)) {
    summary.latestAt = latestAt;
    summary.latestAtMs = Number.isFinite(latestAtMs) ? latestAtMs : summary.latestAtMs;
    summary.latestRunId = run.id;
    summary.latestStatus = run.status;
    summary.latestReportUrl = run.reportHtmlPath ? `/artifacts/${run.reportHtmlPath}` : undefined;
    summary.latestFailureMessage = isStepPassed(step) ? undefined : step.errorMessage ?? firstBlockingExpectationMessage(step);
  }
}

function finalizeNodeSummary(summary: MutableNodeSummary): GraphQualityNodeSummary {
  const { latestAtMs: _latestAtMs, ...rest } = summary;
  return {
    ...rest,
    passRate: passRate(summary)
  };
}

function finalizeEdgeSummary(summary: MutableEdgeSummary): GraphQualityEdgeSummary {
  const { latestAtMs: _latestAtMs, ...rest } = summary;
  return {
    ...rest,
    passRate: passRate(summary)
  };
}

function readStepGraphMetadata(step: StepResult): GraphStepMetadata {
  const graph = step.metadata?.graph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return {};
  }
  const input = graph as Record<string, unknown>;
  return {
    versionId: stringValue(input.versionId),
    edgeId: stringValue(input.edgeId),
    edgeKey: stringValue(input.edgeKey),
    fromNodeId: stringValue(input.fromNodeId),
    fromNodeName: stringValue(input.fromNodeName),
    toNodeId: stringValue(input.toNodeId),
    toNodeName: stringValue(input.toNodeName),
    recoveryAttempt: numberValue(input.recoveryAttempt)
  };
}

function isStepPassed(step: StepResult): boolean {
  return step.status === "passed" || step.status === "skipped";
}

function firstBlockingExpectationMessage(step: StepResult): string | undefined {
  const failed = step.expectationResults?.find((result) => result.status === "failed" && result.blocking !== false);
  if (!failed) {
    return undefined;
  }
  return `${failed.type}: ${failed.reason ?? failed.actual}`;
}

function passRate(summary: { runCount: number; passedCount: number }): number {
  if (summary.runCount <= 0) {
    return 0;
  }
  return Number((summary.passedCount / summary.runCount).toFixed(4));
}

function sortQualityItems(left: GraphQualityItemSummary, right: GraphQualityItemSummary): number {
  return Date.parse(right.latestAt ?? "") - Date.parse(left.latestAt ?? "") || left.passRate - right.passRate;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.min(500, Math.max(1, Math.floor(value)));
}
