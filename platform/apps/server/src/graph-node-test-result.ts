import type { ArtifactRef, RunStatus, StepExpectationResult, StepResult, TestRun } from "@mobile-automation/shared";

export type GraphRouteResultItem = {
  edgeId?: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
  status?: StepResult["status"];
  phase?: string;
  actionLabel?: string;
  beforeNodeName?: string;
  afterNodeName?: string;
  failureReason?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type GraphStepResultItem = {
  stepId?: string;
  edgeId?: string;
  edgeKey?: string;
  status?: StepResult["status"];
  phase?: string;
  action?: {
    label?: string;
    type?: string;
    elementLabel?: string;
    abilityType?: string;
    candidateIndex?: number;
    targetLabel?: string;
  };
  matches?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  retry?: {
    attempt?: number;
    reason?: string;
    reasonDeviationId?: string;
  };
  compound?: unknown;
  failureReason?: string;
};

export type NodeTestResult = {
  runId: string;
  status: RunStatus;
  active: boolean;
  caseName: string;
  deviceSerial: string;
  startedAt: string;
  endedAt?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  targetNodeName?: string;
  route: GraphRouteResultItem[];
  steps: GraphStepResultItem[];
  failedAt?: {
    stepId?: string;
    edgeId?: string;
    edgeKey?: string;
    nodeId?: string;
    nodeName?: string;
    phase?: string;
    code?: string;
    message?: string;
    expectation?: {
      id: string;
      type: StepExpectationResult["type"];
      expected: string;
      actual: string;
      reason?: string;
    };
  };
  reason?: string;
  reportUrl?: string;
  evidence: {
    screenshots: string[];
    videos: string[];
    logs: string[];
    failureArtifacts: string[];
  };
  actual: {
    stepCount: number;
    passedStepCount: number;
    failedStepCount: number;
    latestPhase?: string;
    latestNodeId?: string;
    latestNodeName?: string;
    failedExpectationCount: number;
  };
  diagnostics: {
    bootstrapCount: number;
    transitionWaitCount: number;
    recoveryCount: number;
    bootstrapEvents: Array<{
      summary: string;
      detail?: string;
      occurredAt?: string;
    }>;
  };
};

export function isGraphRun(run: TestRun): boolean {
  return collectGraphStepRecords(run).length > 0 || run.steps.some((step) => step.params?.graphRun === true) || run.steps.some((step) => step.note === "graph-run");
}

export function buildNodeTestResult(run: TestRun, active: boolean): NodeTestResult {
  const graphSteps = collectGraphStepRecords(run);
  const lastGraphStep = graphSteps.at(-1);
  const failedStep = run.stepResults.find((step) => step.status === "failed" || step.status === "timeout");
  const failedGraph = failedStep ? readStepGraphMetadata(failedStep) : undefined;
  const failedExpectation = failedStep?.expectationResults?.find((result) => result.status === "failed" && result.blocking !== false);
  const failureEvidence = resolveFailureEvidence(run, failedStep, failedExpectation);
  const latestGraph = lastGraphStep?.graph;
  const route = graphSteps.map(({ step, graph }) => routeItemFromGraphStep(step, graph));
  const steps = graphSteps.map(({ step, graph }) => stepItemFromGraphStep(step, graph));

  return {
    runId: run.id,
    status: run.status,
    active,
    caseName: run.caseName,
    deviceSerial: run.deviceSerial,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    graphVersionId: firstString(graphSteps.map((item) => item.graph.versionId)),
    targetNodeId: firstString([...graphSteps.map((item) => item.graph.toNodeId)].reverse()) ?? stringValue(latestGraph?.toNodeId),
    targetNodeName: firstString([...graphSteps.map((item) => item.graph.toNodeName)].reverse()) ?? stringValue(latestGraph?.toNodeName),
    route,
    steps,
    failedAt: failedStep
      ? {
          stepId: failedStep.stepId,
          edgeId: stringValue(failedGraph?.edgeId),
          edgeKey: stringValue(failedGraph?.edgeKey),
          nodeId: stringValue(failedGraph?.toNodeId),
          nodeName: stringValue(failedGraph?.toNodeName),
          phase: stringValue(failedGraph?.phase),
          code: failedStep.errorCode,
          message: failedStep.errorMessage,
          expectation: failedExpectation
            ? {
                id: failedExpectation.expectationId,
                type: failedExpectation.type,
                expected: failedExpectation.expected,
                actual: failedExpectation.actual,
                reason: failedExpectation.reason
              }
            : undefined
        }
      : undefined,
    reason: failedStep?.errorMessage ?? failedExpectation?.reason,
    reportUrl: run.reportHtmlPath ? `/artifacts/${run.reportHtmlPath}` : undefined,
    evidence: {
      screenshots: urls(run.artifacts.filter((artifact) => artifact.type === "screenshot")),
      videos: urls(run.artifacts.filter((artifact) => artifact.type === "video" && !artifact.deletedAt)),
      logs: urls(run.artifacts.filter((artifact) => artifact.type === "log")),
      failureArtifacts: urls(failureEvidence)
    },
    actual: {
      stepCount: graphSteps.length,
      passedStepCount: graphSteps.filter(({ step }) => step.status === "passed").length,
      failedStepCount: graphSteps.filter(({ step }) => step.status === "failed" || step.status === "timeout").length,
      latestPhase: stringValue(latestGraph?.phase),
      latestNodeId: stringValue(latestGraph?.toNodeId),
      latestNodeName: stringValue(latestGraph?.toNodeName),
      failedExpectationCount: run.stepResults.flatMap((step) => step.expectationResults ?? []).filter((result) => result.status === "failed").length
    },
    diagnostics: {
      bootstrapCount: run.events.filter((event) => event.type === "start_state_failed").length,
      transitionWaitCount: graphSteps.flatMap((item) => arrayValue(item.graph.deviations)).filter((deviation) => recordString(deviation, "action") === "retry_observe").length,
      recoveryCount: graphSteps.filter((item) => typeof item.graph.recoveryAttempt === "number").length,
      bootstrapEvents: run.events
        .filter((event) => event.type === "start_state_failed")
        .map((event) => ({
          summary: event.summary,
          detail: event.detail,
          occurredAt: event.occurredAt
        }))
    }
  };
}

function routeItemFromGraphStep(step: StepResult, graph: Record<string, unknown>): GraphRouteResultItem {
  const action = actionSummary(graph.actionPolicy) ?? {};
  return {
    edgeId: stringValue(graph.edgeId),
    edgeKey: stringValue(graph.edgeKey),
    fromNodeId: stringValue(graph.fromNodeId),
    fromNodeName: stringValue(graph.fromNodeName),
    toNodeId: stringValue(graph.toNodeId),
    toNodeName: stringValue(graph.toNodeName),
    status: step.status,
    phase: stringValue(graph.phase),
    actionLabel: action.label,
    beforeNodeName: nodeMatchName(graph.beforeMatch) ?? stringValue(graph.fromNodeName),
    afterNodeName: nodeMatchName(graph.afterMatch) ?? stringValue(graph.toNodeName),
    failureReason: step.errorMessage ?? failedExpectationReason(step),
    errorCode: step.errorCode,
    errorMessage: step.errorMessage
  };
}

function stepItemFromGraphStep(step: StepResult, graph: Record<string, unknown>): GraphStepResultItem {
  return {
    stepId: step.stepId,
    edgeId: stringValue(graph.edgeId),
    edgeKey: stringValue(graph.edgeKey),
    status: step.status,
    phase: stringValue(graph.phase),
    action: actionSummary(graph.actionPolicy),
    matches: {
      before: recordValue(graph.beforeMatch),
      after: recordValue(graph.afterMatch)
    },
    retry: {
      attempt: numberValue(graph.recoveryAttempt),
      reason: stringValue(graph.recoveryReason),
      reasonDeviationId: stringValue(graph.recoveryReasonDeviationId)
    },
    compound: graph.compound,
    failureReason: step.errorMessage ?? failedExpectationReason(step)
  };
}

function actionSummary(value: unknown): GraphStepResultItem["action"] {
  const policy = recordValue(value);
  const action = recordValue(policy?.action);
  const params = recordValue(action?.params);
  return {
    label: stringValue(action?.title),
    type: stringValue(action?.type),
    elementLabel: stringValue(params?.elementLabel),
    abilityType: stringValue(params?.abilityType),
    candidateIndex: numberValue(params?.candidateIndex),
    targetLabel: stringValue(params?.targetLabel)
  };
}

function nodeMatchName(value: unknown): string | undefined {
  const match = recordValue(value);
  return stringValue(match?.nodeName) ?? stringValue(match?.nodeId);
}

function failedExpectationReason(step: StepResult): string | undefined {
  return step.expectationResults?.find((result) => result.status === "failed" && result.blocking !== false)?.reason;
}

export function collectGraphStepRecords(run: TestRun): Array<{ step: StepResult; graph: Record<string, unknown> }> {
  return run.stepResults
    .map((step) => ({ step, graph: readStepGraphMetadata(step) }))
    .filter((item): item is { step: StepResult; graph: Record<string, unknown> } => Boolean(item.graph));
}

export function readStepGraphMetadata(step: StepResult): Record<string, unknown> | undefined {
  const graph = step.metadata?.graph;
  return typeof graph === "object" && graph !== null && !Array.isArray(graph) ? (graph as Record<string, unknown>) : undefined;
}

function resolveFailureEvidence(run: TestRun, failedStep: StepResult | undefined, failedExpectation: StepExpectationResult | undefined): ArtifactRef[] {
  const ids = new Set<string>(
    [failedStep?.afterScreenshotId, ...(failedExpectation?.evidenceArtifactIds ?? []), ...run.events.flatMap((event) => event.artifactIds)].filter((id): id is string => Boolean(id))
  );
  const artifactsById = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  return Array.from(ids)
    .map((id) => artifactsById.get(id))
    .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
}

function urls(artifacts: ArtifactRef[]): string[] {
  return artifacts.map((artifact) => artifact.url).filter((url): url is string => Boolean(url));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstString(values: unknown[]): string | undefined {
  return values.map(stringValue).find(Boolean);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordString(value: unknown, key: string): string | undefined {
  return typeof value === "object" && value !== null ? stringValue((value as Record<string, unknown>)[key]) : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
