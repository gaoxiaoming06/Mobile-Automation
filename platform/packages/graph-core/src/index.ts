import type { ActionStep, Platform, StepExpectation } from "@mobile-automation/shared";

export type PlatformScope = Platform | "mobile-both";

export type VisualSemanticArea = "top" | "content" | "bottom" | "unknown";

export type GraphLifecycleStatus = "draft" | "active" | "deprecated" | "rejected";

export type GraphTargetApp = {
  androidPackageName?: string;
  iosBundleId?: string;
};

export type BusinessGraph = {
  id: string;
  appId: string;
  targetApp?: GraphTargetApp;
  platformScope: PlatformScope;
  name: string;
  status: "draft" | "active" | "deprecated";
  activeVersionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessGraphVersion = {
  id: string;
  graphId: string;
  version: number;
  sourceSummary: string[];
  status: "draft" | "active" | "archived";
  nodes: BusinessNode[];
  edges: OperationEdge[];
  createdAt: string;
};

export type BusinessNode = {
  id: string;
  graphVersionId: string;
  key: string;
  name: string;
  nodeType: "root" | "page" | "business_state" | "terminal";
  tags: string[];
  status: GraphLifecycleStatus;
  matchers: StateMatcher[];
  defaultExpectations: StepExpectation[];
  platformScope?: PlatformScope;
  metadata?: Record<string, unknown>;
};

export type OperationEdge = {
  id: string;
  graphVersionId: string;
  fromNodeId: string;
  toNodeId: string;
  key: string;
  name: string;
  intent: string;
  status: GraphLifecycleStatus;
  source: "source_scan" | "exploration" | "manual_recording" | "manual_edit" | "imported" | "ai_draft";
  preconditions: StepExpectation[];
  actionPolicies: ActionPolicy[];
  expectations: StepExpectation[];
  failurePolicy?: FailurePolicy;
  platformScope?: PlatformScope;
  reliabilityScore?: number;
};

export type StateMatcher = {
  id: string;
  type:
    | "activity"
    | "route"
    | "fragment"
    | "resource_id"
    | "accessibility_id"
    | "text"
    | "ocr_text"
    | "image_region"
    | "semantic_image_region"
    | "package"
    | "bundle_id"
    | "custom";
  value: string;
  weight: number;
  critical?: boolean;
  threshold?: number;
  region?: Rect;
  ignoreRegions?: Rect[];
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region";
  platformScope?: PlatformScope;
  source?: GraphAssetSource;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphAssetSource = {
  sourceType: "source_scan" | "exploration" | "manual_recording" | "manual_edit" | "imported" | "ai_draft";
  filePath?: string;
  line?: number;
  caseId?: string;
  stepId?: string;
  artifactId?: string;
  confidence?: number;
};

export type ActionPolicy = {
  id: string;
  priority: number;
  action: ActionStep;
  fallback: boolean;
  source?: GraphAssetSource;
  reliabilityHint?: "high" | "medium" | "low";
};

export type FailurePolicy = {
  retryCount?: number;
  recoverTo?: "previous_node" | "root" | "replan" | "fail";
};

export type RouteStrategy = "most_stable" | "shortest" | "smoke" | "performance";

export type TargetNodeQuery = {
  nodeId?: string;
  key?: string;
  name?: string;
  text?: string;
  tags?: string[];
  intent?: string;
  platform?: Platform;
  includeDraft?: boolean;
  maxCandidates?: number;
};

export type TargetNodeCandidate = {
  node: BusinessNode;
  score: number;
  matchedBy: string[];
  reasons: string[];
};

export type TargetResolutionResult = {
  status: "resolved" | "ambiguous" | "not_found";
  targetNode?: BusinessNode;
  candidates: TargetNodeCandidate[];
  query: TargetNodeQuery;
  message?: string;
};

export type RoutePlan = {
  id: string;
  graphVersionId: string;
  appId: string;
  targetApp?: GraphTargetApp;
  targetNodeId: string;
  startNodeId: string;
  strategy: RouteStrategy;
  nodes: BusinessNode[];
  edges: RoutePlanEdge[];
  assumptions: string[];
  unresolvedIssues: RoutePlanIssue[];
  snapshot: RoutePlanSnapshot;
};

export type ExecutionPlan = {
  id: string;
  routePlanId: string;
  graphVersionId: string;
  appId: string;
  targetApp?: GraphTargetApp;
  targetNodeId: string;
  startNodeId: string;
  platform: Platform;
  strategy: RouteStrategy;
  steps: ExecutionPlanStep[];
  unresolvedIssues: RoutePlanIssue[];
  assumptions: string[];
  snapshot: ExecutionPlanSnapshot;
  createdAt: string;
};

export type ExecutionPlanStep = {
  id: string;
  order: number;
  edgeId: string;
  edgeKey: string;
  name: string;
  intent: string;
  fromNode: BusinessNode;
  toNode: BusinessNode;
  preconditions: StepExpectation[];
  selectedActionPolicy?: ActionPolicy;
  action?: ActionStep;
  fallbackActionPolicies: ActionPolicy[];
  expectations: StepExpectation[];
  systemGuards: StepExpectation[];
  failurePolicy?: FailurePolicy;
  executionMode: "action" | "noop" | "blocked";
  issues: RoutePlanIssue[];
  runtimeOverlay?: ExecutionPlanStepRuntimeOverlay;
  recovery?: ExecutionPlanStepRecoveryContext;
};

export type ExecutionPlanStepRuntimeOverlay = {
  id?: string;
  note?: string;
  targetExpectationIds: string[];
  edgeExpectationIds: string[];
  runtimeParamKeys?: string[];
  pageTaskId?: string;
  pageTaskName?: string;
  pageTaskStepId?: string;
  pageTaskStepName?: string;
};

export type ExecutionPlanStepRecoveryContext = {
  attempt: number;
  reasonDeviationId?: string;
  originalPlanStepId?: string;
  originalEdgeId?: string;
};

const TARGET_VALIDATION_EDGE_ID = "__target_validation__";
const TARGET_VALIDATION_EDGE_KEY = "target.validation";

export type ExecutionPlanSnapshot = {
  routePlanId: string;
  graphVersionId: string;
  nodeIds: string[];
  edgeIds: string[];
  actionIds: string[];
  createdAt: string;
};

export type BuildExecutionPlanInput = {
  routePlan: RoutePlan;
  platform: Platform;
  now?: string;
  idFactory?: (prefix: string) => string;
  includeSystemGuards?: boolean;
};

export type RoutePlanEdge = {
  order: number;
  edge: OperationEdge;
  fromNode: BusinessNode;
  toNode: BusinessNode;
};

export type RoutePlanIssue = {
  code:
    | "GRAPH_VERSION_NOT_ACTIVE"
    | "GRAPH_APP_BINDING_MISSING"
    | "CURRENT_NODE_UNKNOWN"
    | "START_NODE_NOT_FOUND"
    | "TARGET_NODE_NOT_FOUND"
    | "TARGET_NODE_UNREACHABLE"
    | "NODE_NOT_ACTIVE"
    | "EDGE_NOT_ACTIVE"
    | "PLATFORM_NOT_SUPPORTED"
    | "MISSING_MATCHER"
    | "MISSING_ACTION_POLICY"
    | "UNSTABLE_COORDINATE_ACTION"
    | "PAGE_ABILITY_TARGET_MISSING"
    | "PAGE_ABILITY_TARGET_NOT_FOUND";
  severity: "warning" | "error";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type RoutePlanSnapshot = {
  graphVersionId: string;
  nodeIds: string[];
  edgeIds: string[];
  createdAt: string;
};

export type RoutePlanInput = {
  graphVersion: BusinessGraphVersion;
  appId: string;
  targetApp?: GraphTargetApp;
  targetNodeId: string;
  startNodeId?: string;
  platform: Platform;
  strategy?: RouteStrategy;
  now?: string;
  idFactory?: (prefix: string) => string;
};

export type RuntimeOverlay = {
  id?: string;
  targetNodeId?: string;
  targetTaskId?: string;
  nodeExpectationOverrides?: NodeExpectationOverride[];
  edgeExpectationOverrides?: EdgeExpectationOverride[];
  runtimeParams?: Record<string, string>;
  note?: string;
};

export function applyRuntimeOverlayToExecutionPlan(executionPlan: ExecutionPlan, overlay: RuntimeOverlay | undefined): ExecutionPlan {
  if (!overlay) {
    return executionPlan;
  }
  const runtimeParams = normalizeRuntimeParams(overlay.runtimeParams);
  const runtimeParamKeys = Object.keys(runtimeParams).sort();
  const nodeOverrides = new Map((overlay.nodeExpectationOverrides ?? []).map((item) => [item.nodeId, item.expectations]));
  const edgeOverrides = new Map((overlay.edgeExpectationOverrides ?? []).map((item) => [item.edgeId, item.expectations]));
  const steps = executionPlan.steps.map((step) => {
    const targetExpectations = cloneExpectations(nodeOverrides.get(step.toNode.id) ?? []);
    const edgeExpectations = cloneExpectations(edgeOverrides.get(step.edgeId) ?? []);
    const action = runtimeParamKeys.length && step.action ? applyRuntimeParamsToAction(step.action, runtimeParams) : step.action;
    const selectedActionPolicy = runtimeParamKeys.length && step.selectedActionPolicy ? applyRuntimeParamsToPolicy(step.selectedActionPolicy, runtimeParams) : step.selectedActionPolicy;
    const fallbackActionPolicies = runtimeParamKeys.length ? step.fallbackActionPolicies.map((policy) => applyRuntimeParamsToPolicy(policy, runtimeParams)) : step.fallbackActionPolicies;
    if (!targetExpectations.length && !edgeExpectations.length && !runtimeParamKeys.length) {
      return step;
    }
    return {
      ...step,
      selectedActionPolicy,
      action,
      fallbackActionPolicies,
      expectations: [...step.expectations, ...targetExpectations, ...edgeExpectations],
      runtimeOverlay: {
        ...(step.runtimeOverlay ?? {}),
        id: overlay.id,
        note: overlay.note,
        targetExpectationIds: targetExpectations.map((expectation) => expectation.id),
        edgeExpectationIds: edgeExpectations.map((expectation) => expectation.id),
        ...(runtimeParamKeys.length ? { runtimeParamKeys } : {})
      }
    };
  });
  return {
    ...executionPlan,
    steps,
    assumptions: [...executionPlan.assumptions, "RuntimeOverlay expectations are applied only to this execution plan and do not modify the active graph."]
  };
}

export type Observation = {
  id?: string;
  deviceSerial?: string;
  platform: Platform;
  capturedAt: string;
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  componentName?: string;
  routeName?: string;
  fragments?: string[];
  resolution?: {
    width: number;
    height: number;
  };
  orientation?: "portrait" | "landscape";
  screenshot?: ObservationScreenshot;
  uiElements: ObservationUiElement[];
  ocrTexts: ObservationText[];
  imageRegions?: ObservationImageRegion[];
  events?: ObservationEventSummary[];
  raw?: Record<string, unknown>;
};

export type ObservationScreenshot = {
  artifactId?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

export type ObservationUiElement = {
  resourceId?: string;
  accessibilityId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  bounds?: Rect;
  enabled?: boolean;
  visible?: boolean;
  clickable?: boolean;
  longClickable?: boolean;
  focusable?: boolean;
  scrollable?: boolean;
};

export type ObservationText = {
  text: string;
  confidence?: number;
  region?: Rect;
  semanticArea?: VisualSemanticArea;
  source?: "ocr" | "ui_tree" | "accessibility";
};

export type ObservationImageRegion = {
  id?: string;
  value: string;
  region?: Rect;
  semanticArea?: VisualSemanticArea;
  similarity?: number;
  artifactId?: string;
};

export type ObservationEventSummary = {
  type: "crash" | "anr" | "command_failed" | "device_lost" | "preview_lost" | "runner_error" | "video_unavailable" | "start_state_failed";
  severity: "info" | "warning" | "error";
  summary: string;
  occurredAt?: string;
};

export type NodeMatchStatus = "matched" | "multiple_candidates" | "unknown";

export type MatcherResult = {
  matcherId: string;
  type: StateMatcher["type"];
  expected: string;
  actual?: string;
  weight: number;
  critical?: boolean;
  region?: Rect;
  source?: GraphAssetSource;
  matched: boolean;
  score: number;
  reason?: string;
};

export type NodeMatchQuality = {
  status: "sufficient" | "low_confidence";
  reasons: string[];
  matchedContextSignals: number;
  matchedStrongSignals: number;
  matchedWeakSignals: number;
  missingStrongMatcherIds: string[];
  missingCriticalMatcherIds: string[];
};

export type NodeMatchCandidate = {
  node: BusinessNode;
  score: number;
  matchedWeight: number;
  totalWeight: number;
  matcherResults: MatcherResult[];
  quality: NodeMatchQuality;
};

export type NodeMatchResult = {
  status: NodeMatchStatus;
  observationId?: string;
  capturedAt: string;
  node?: BusinessNode;
  score: number;
  candidates: NodeMatchCandidate[];
  threshold: number;
};

export type DetectNodeOptions = {
  minScore?: number;
  tieTolerance?: number;
  evidenceTieTolerance?: number;
  maxCandidates?: number;
};

export type NodeExpectationOverride = {
  nodeId: string;
  expectations: StepExpectation[];
};

export type EdgeExpectationOverride = {
  edgeId: string;
  expectations: StepExpectation[];
};

export function detectNode(
  observation: Observation,
  graphVersion: BusinessGraphVersion,
  platform: Platform = observation.platform,
  options: DetectNodeOptions = {}
): NodeMatchResult {
  const minScore = options.minScore ?? 0.6;
  const tieTolerance = options.tieTolerance ?? 0.05;
  const evidenceTieTolerance = options.evidenceTieTolerance ?? 0.1;
  const maxCandidates = options.maxCandidates ?? 5;
  const candidates = graphVersion.nodes
    .filter((node) => node.status === "active" && supportsPlatform(node.platformScope, platform))
    .map((node) => scoreNode(node, observation, platform))
    .filter((candidate) => candidate.totalWeight > 0)
    .sort((left, right) => right.score - left.score || right.matchedWeight - left.matchedWeight || left.node.name.localeCompare(right.node.name));

  const topCandidate = candidates[0];
  if (!topCandidate || topCandidate.score < minScore) {
    return {
      status: "unknown",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: topCandidate?.score ?? 0,
      candidates: candidates.slice(0, maxCandidates),
      threshold: minScore
    };
  }

  const qualityCandidates = candidates.filter((candidate) => candidate.score >= minScore && candidate.quality.status === "sufficient");
  const top = qualityCandidates[0];
  if (!top) {
    const tiedLowConfidence = candidates
      .filter(
        (candidate) =>
          candidate.score >= minScore &&
          topCandidate.score - candidate.score <= tieTolerance &&
          topCandidate.matchedWeight - candidate.matchedWeight <= evidenceTieTolerance
      )
      .slice(0, maxCandidates);
    return {
      status: tiedLowConfidence.length > 1 ? "multiple_candidates" : "unknown",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: topCandidate.score,
      candidates: candidates.slice(0, maxCandidates),
      threshold: minScore
    };
  }

  const tied = qualityCandidates
    .filter(
      (candidate) =>
        candidate.score >= minScore &&
        top.score - candidate.score <= tieTolerance &&
        top.matchedWeight - candidate.matchedWeight <= evidenceTieTolerance
    )
    .slice(0, maxCandidates);
  if (tied.length > 1) {
    return {
      status: "multiple_candidates",
      observationId: observation.id,
      capturedAt: observation.capturedAt,
      score: top.score,
      candidates: tied,
      threshold: minScore
    };
  }

  return {
    status: "matched",
    observationId: observation.id,
    capturedAt: observation.capturedAt,
    node: top.node,
    score: top.score,
    candidates: [top, ...candidates.slice(1, maxCandidates)],
    threshold: minScore
  };
}

export function resolveTargetNode(graphVersion: BusinessGraphVersion, query: TargetNodeQuery): TargetResolutionResult {
  const maxCandidates = Math.max(1, Math.floor(query.maxCandidates ?? 10));
  const nodes = graphVersion.nodes.filter((node) => {
    if (!query.includeDraft && node.status !== "active") {
      return false;
    }
    return query.platform ? supportsPlatform(node.platformScope, query.platform) : true;
  });

  const candidates = nodes
    .map((node) => scoreTargetNode(node, graphVersion, query))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.node.name.localeCompare(right.node.name))
    .slice(0, maxCandidates);

  const top = candidates[0];
  if (!top) {
    return {
      status: "not_found",
      candidates: [],
      query,
      message: "No business graph node matched the requested target."
    };
  }

  const tied = candidates.filter((candidate) => candidate.score === top.score);
  if (tied.length > 1 && top.score < 100) {
    return {
      status: "ambiguous",
      candidates,
      query,
      message: "Multiple business graph nodes matched the requested target."
    };
  }

  return {
    status: "resolved",
    targetNode: top.node,
    candidates,
    query
  };
}

export function planRoute(input: RoutePlanInput): RoutePlan {
  const strategy = input.strategy ?? "shortest";
  const now = input.now ?? new Date().toISOString();
  const idFactory = input.idFactory ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  const issues: RoutePlanIssue[] = validateTargetAppBinding(input.targetApp, input.platform);

  if (input.graphVersion.status !== "active") {
    issues.push({
      code: "GRAPH_VERSION_NOT_ACTIVE",
      severity: "error",
      message: `Graph version ${input.graphVersion.id} is not active.`
    });
  }

  const activeNodes = input.graphVersion.nodes.filter((node) => node.status === "active" && supportsPlatform(node.platformScope, input.platform));
  const activeNodeIds = new Set(activeNodes.map((node) => node.id));
  const startNode = resolveStartNode(activeNodes, input.startNodeId);
  const targetNode = activeNodes.find((node) => node.id === input.targetNodeId);

  if (!startNode) {
    issues.push({
      code: "START_NODE_NOT_FOUND",
      severity: "error",
      message: input.startNodeId ? `Start node ${input.startNodeId} was not found or is not active.` : "No active root node found.",
      nodeId: input.startNodeId
    });
  }

  if (!targetNode) {
    issues.push({
      code: "TARGET_NODE_NOT_FOUND",
      severity: "error",
      message: `Target node ${input.targetNodeId} was not found, inactive, or unsupported on ${input.platform}.`,
      nodeId: input.targetNodeId
    });
  }

  if (!startNode || !targetNode || hasBlockingIssue(issues)) {
    return emptyPlan(input, idFactory, strategy, now, startNode?.id ?? input.startNodeId ?? "", issues);
  }

  const activeEdges = input.graphVersion.edges.filter((edge) => isExecutableEdge(edge, activeNodeIds, input.platform));
  const routeEdges = findShortestPath(activeEdges, startNode.id, targetNode.id);
  if (!routeEdges && startNode.id !== targetNode.id) {
    issues.push({
      code: "TARGET_NODE_UNREACHABLE",
      severity: "error",
      message: `Target node ${targetNode.id} is unreachable from ${startNode.id}.`,
      nodeId: targetNode.id
    });
    return emptyPlan(input, idFactory, strategy, now, startNode.id, issues);
  }

  const edges = (routeEdges ?? []).map((edge, index) => {
    const fromNode = activeNodes.find((node) => node.id === edge.fromNodeId);
    const toNode = activeNodes.find((node) => node.id === edge.toNodeId);
    if (!fromNode || !toNode) {
      throw new Error(`Invalid route edge ${edge.id}: missing from/to node.`);
    }
    return {
      order: index + 1,
      edge,
      fromNode,
      toNode
    };
  });
  const nodes = [startNode, ...edges.map((edge) => edge.toNode)];
  const validationIssues = validateRoute(nodes, edges, input.platform);

  return {
    id: idFactory("route"),
    graphVersionId: input.graphVersion.id,
    appId: input.appId,
    targetApp: input.targetApp,
    targetNodeId: input.targetNodeId,
    startNodeId: startNode.id,
    strategy,
    nodes,
    edges,
    assumptions: [`Route planned with ${strategy} strategy.`, "Only active nodes and edges were considered."],
    unresolvedIssues: [...issues, ...validationIssues],
    snapshot: {
      graphVersionId: input.graphVersion.id,
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.edge.id),
      createdAt: now
    }
  };
}

export function validateRoute(nodes: BusinessNode[], edges: RoutePlanEdge[], platform: Platform): RoutePlanIssue[] {
  const issues: RoutePlanIssue[] = [];
  for (const node of nodes) {
    if (node.status !== "active") {
      issues.push({
        code: "NODE_NOT_ACTIVE",
        severity: "error",
        message: `Node ${node.id} is not active.`,
        nodeId: node.id
      });
    }
    if (!supportsPlatform(node.platformScope, platform)) {
      issues.push({
        code: "PLATFORM_NOT_SUPPORTED",
        severity: "error",
        message: `Node ${node.id} does not support ${platform}.`,
        nodeId: node.id
      });
    }
    if (node.matchers.length === 0) {
      issues.push({
        code: "MISSING_MATCHER",
        severity: "warning",
        message: `Node ${node.id} has no state matcher.`,
        nodeId: node.id
      });
    }
  }
  for (const routeEdge of edges) {
    const edge = routeEdge.edge;
    if (edge.status !== "active") {
      issues.push({
        code: "EDGE_NOT_ACTIVE",
        severity: "error",
        message: `Edge ${edge.id} is not active.`,
        edgeId: edge.id
      });
    }
    if (!supportsPlatform(edge.platformScope, platform)) {
      issues.push({
        code: "PLATFORM_NOT_SUPPORTED",
        severity: "error",
        message: `Edge ${edge.id} does not support ${platform}.`,
        edgeId: edge.id
      });
    }
    if (edge.actionPolicies.length === 0) {
      issues.push(missingActionPolicyIssue(edge.id));
    } else {
      const enabledActionPolicies = edge.actionPolicies.filter((policy) => policy.action.enabled);
      if (enabledActionPolicies.length > 0 && enabledActionPolicies.every((policy) => isUnstableCoordinateAction(policy.action))) {
        issues.push(unstableCoordinateActionIssue(edge.id));
      }
    }
  }
  return issues;
}

export function buildExecutionPlan(input: BuildExecutionPlanInput): ExecutionPlan {
  const now = input.now ?? new Date().toISOString();
  const idFactory = input.idFactory ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`);
  const includeSystemGuards = input.includeSystemGuards ?? true;
  const steps =
    input.routePlan.edges.length > 0
      ? input.routePlan.edges.map((routeEdge) =>
          buildExecutionPlanStep({
            routeEdge,
            platform: input.platform,
            now,
            idFactory,
            includeSystemGuards
          })
        )
      : buildTargetValidationSteps(input.routePlan, now, idFactory, includeSystemGuards);
  const stepIssues = steps.flatMap((step) => step.issues);
  const actionIds = steps.map((step) => step.action?.id).filter((id): id is string => Boolean(id));
  return {
    id: idFactory("execution_plan"),
    routePlanId: input.routePlan.id,
    graphVersionId: input.routePlan.graphVersionId,
    appId: input.routePlan.appId,
    targetApp: input.routePlan.targetApp,
    targetNodeId: input.routePlan.targetNodeId,
    startNodeId: input.routePlan.startNodeId,
    platform: input.platform,
    strategy: input.routePlan.strategy,
    steps,
    unresolvedIssues: mergeIssues(input.routePlan.unresolvedIssues, stepIssues),
    assumptions: [
      ...input.routePlan.assumptions,
      "Each edge is expanded to one executable step with preconditions, selected action policy, post expectations, and system guards."
    ],
    snapshot: {
      routePlanId: input.routePlan.id,
      graphVersionId: input.routePlan.graphVersionId,
      nodeIds: input.routePlan.snapshot.nodeIds,
      edgeIds: input.routePlan.snapshot.edgeIds,
      actionIds,
      createdAt: now
    },
    createdAt: now
  };
}

function buildTargetValidationSteps(
  routePlan: RoutePlan,
  now: string,
  idFactory: (prefix: string) => string,
  includeSystemGuards: boolean
): ExecutionPlanStep[] {
  if (routePlan.startNodeId !== routePlan.targetNodeId) {
    return [];
  }
  const targetNode = routePlan.nodes.find((node) => node.id === routePlan.targetNodeId);
  if (!targetNode) {
    return [];
  }
  return [
    {
      id: idFactory("execution_step"),
      order: 1,
      edgeId: TARGET_VALIDATION_EDGE_ID,
      edgeKey: TARGET_VALIDATION_EDGE_KEY,
      name: `验证目标节点：${targetNode.name}`,
      intent: "当前已经处于目标节点，只验证目标状态、动态预期和系统守卫。",
      fromNode: targetNode,
      toNode: targetNode,
      preconditions: [],
      fallbackActionPolicies: [],
      expectations: [...targetNode.defaultExpectations],
      systemGuards: includeSystemGuards ? defaultSystemGuards(TARGET_VALIDATION_EDGE_ID, now) : [],
      executionMode: "noop",
      issues: []
    }
  ];
}

function buildExecutionPlanStep(input: {
  routeEdge: RoutePlanEdge;
  platform: Platform;
  now: string;
  idFactory: (prefix: string) => string;
  includeSystemGuards: boolean;
}): ExecutionPlanStep {
  const edge = input.routeEdge.edge;
  const actionCandidates = sortedActionPolicies(edge.actionPolicies).filter((policy) => policy.action.enabled);
  const stableActionCandidates = actionCandidates.filter((policy) => !isUnstableCoordinateAction(policy.action));
  const selectedActionPolicy = stableActionCandidates.find((policy) => !policy.fallback) ?? stableActionCandidates[0];
  const fallbackActionPolicies = actionCandidates.filter((policy) => policy.id !== selectedActionPolicy?.id);
  const issues: RoutePlanIssue[] = [];
  if (!selectedActionPolicy) {
    issues.push(actionCandidates.length > 0 ? unstableCoordinateActionIssue(edge.id) : missingActionPolicyIssue(edge.id));
  }
  const systemGuards = input.includeSystemGuards ? defaultSystemGuards(edge.id, input.now) : [];
  return {
    id: input.idFactory("execution_step"),
    order: input.routeEdge.order,
    edgeId: edge.id,
    edgeKey: edge.key,
    name: edge.name,
    intent: edge.intent,
    fromNode: input.routeEdge.fromNode,
    toNode: input.routeEdge.toNode,
    preconditions: [...input.routeEdge.fromNode.defaultExpectations, ...edge.preconditions],
    selectedActionPolicy,
    action: selectedActionPolicy?.action,
    fallbackActionPolicies,
    expectations: [...edge.expectations, ...input.routeEdge.toNode.defaultExpectations],
    systemGuards,
    failurePolicy: edge.failurePolicy,
    executionMode: selectedActionPolicy ? "action" : "blocked",
    issues
  };
}

function cloneExpectations(expectations: StepExpectation[]): StepExpectation[] {
  return expectations.map((expectation) => ({
    ...expectation,
    params: { ...expectation.params }
  }));
}

function normalizeRuntimeParams(value: RuntimeOverlay["runtimeParams"]): Record<string, string> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, paramValue]) => [key.trim(), String(paramValue).trim()] as const)
      .filter(([key, paramValue]) => key.length > 0 && paramValue.length > 0)
  );
}

function applyRuntimeParamsToPolicy(policy: ActionPolicy, runtimeParams: Record<string, string>): ActionPolicy {
  return {
    ...policy,
    action: applyRuntimeParamsToAction(policy.action, runtimeParams)
  };
}

function applyRuntimeParamsToAction(action: ActionStep, runtimeParams: Record<string, string>): ActionStep {
  const params = applyRuntimeParamsToValue(action.params, runtimeParams) as Record<string, unknown>;
  return {
    ...action,
    params: applyRuntimeParamConventions(params, runtimeParams)
  };
}

function applyRuntimeParamsToValue(value: unknown, runtimeParams: Record<string, string>): unknown {
  if (typeof value === "string") {
    return renderRuntimeTemplate(value, runtimeParams);
  }
  if (Array.isArray(value)) {
    return value.map((item) => applyRuntimeParamsToValue(item, runtimeParams));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyRuntimeParamsToValue(item, runtimeParams)]));
  }
  return value;
}

function renderRuntimeTemplate(value: string, runtimeParams: Record<string, string>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => runtimeParams[key] ?? match);
}

function applyRuntimeParamConventions(params: Record<string, unknown>, runtimeParams: Record<string, string>): Record<string, unknown> {
  const className = runtimeParams.className?.trim();
  if (!className || params.abilityType !== "grid_candidate" || !params.scrollProfile || typeof params.scrollProfile !== "object") {
    return params;
  }
  const scrollProfile = params.scrollProfile as Record<string, unknown>;
  const targetQuery = typeof scrollProfile.targetQuery === "string" ? scrollProfile.targetQuery.trim() : "";
  const targetKind = typeof scrollProfile.targetKind === "string" ? scrollProfile.targetKind : undefined;
  if (targetQuery && targetKind !== "nth_item") {
    return params;
  }
  return {
    ...params,
    scrollProfile: {
      ...scrollProfile,
      targetKind: "item_text",
      targetQuery: className
    }
  };
}

function sortedActionPolicies(policies: ActionPolicy[]): ActionPolicy[] {
  return [...policies].sort((left, right) => left.priority - right.priority || reliabilityRank(right.reliabilityHint) - reliabilityRank(left.reliabilityHint) || Number(left.fallback) - Number(right.fallback) || left.id.localeCompare(right.id));
}

function reliabilityRank(value: ActionPolicy["reliabilityHint"]): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  if (value === "low") {
    return 1;
  }
  return 0;
}

function validateTargetAppBinding(targetApp: GraphTargetApp | undefined, platform: Platform): RoutePlanIssue[] {
  if (platform === "android" && !targetApp?.androidPackageName?.trim()) {
    return [
      {
        code: "GRAPH_APP_BINDING_MISSING",
        severity: "error",
        message: "Android business graph route planning requires targetApp.androidPackageName."
      }
    ];
  }
  if (platform === "ios" && !targetApp?.iosBundleId?.trim()) {
    return [
      {
        code: "GRAPH_APP_BINDING_MISSING",
        severity: "error",
        message: "iOS business graph route planning requires targetApp.iosBundleId."
      }
    ];
  }
  return [];
}

function isUnstableCoordinateAction(action: ActionStep): boolean {
  return action.type === "tap" || action.type === "long_press" || action.type === "swipe";
}

function missingActionPolicyIssue(edgeId: string): RoutePlanIssue {
  return {
    code: "MISSING_ACTION_POLICY",
    severity: "error",
    message: `Edge ${edgeId} has no action policy.`,
    edgeId
  };
}

function unstableCoordinateActionIssue(edgeId: string): RoutePlanIssue {
  return {
    code: "UNSTABLE_COORDINATE_ACTION",
    severity: "error",
    message: `Edge ${edgeId} only has coordinate-based action policies. Formal business graphs require text, element, image, or app actions as the primary locator.`,
    edgeId
  };
}

function defaultSystemGuards(edgeId: string, now: string): StepExpectation[] {
  return [
    {
      id: `guard_no_crash_${edgeId}`,
      type: "no_crash",
      enabled: true,
      title: "无崩溃 / ANR",
      params: {},
      createdAt: now
    },
    {
      id: `guard_app_alive_${edgeId}`,
      type: "app_alive",
      enabled: true,
      title: "应用可响应",
      params: {},
      createdAt: now
    }
  ];
}

function mergeIssues(left: RoutePlanIssue[], right: RoutePlanIssue[]): RoutePlanIssue[] {
  const merged = new Map<string, RoutePlanIssue>();
  for (const issue of [...left, ...right]) {
    const key = `${issue.code}:${issue.nodeId ?? ""}:${issue.edgeId ?? ""}:${issue.message}`;
    merged.set(key, issue);
  }
  return Array.from(merged.values());
}

function emptyPlan(
  input: RoutePlanInput,
  idFactory: (prefix: string) => string,
  strategy: RouteStrategy,
  now: string,
  startNodeId: string,
  issues: RoutePlanIssue[]
): RoutePlan {
  return {
    id: idFactory("route"),
    graphVersionId: input.graphVersion.id,
    appId: input.appId,
    targetApp: input.targetApp,
    targetNodeId: input.targetNodeId,
    startNodeId,
    strategy,
    nodes: [],
    edges: [],
    assumptions: ["Route planning stopped before execution because blocking issues were found."],
    unresolvedIssues: issues,
    snapshot: {
      graphVersionId: input.graphVersion.id,
      nodeIds: [],
      edgeIds: [],
      createdAt: now
    }
  };
}

function resolveStartNode(nodes: BusinessNode[], startNodeId: string | undefined): BusinessNode | undefined {
  if (startNodeId) {
    return nodes.find((node) => node.id === startNodeId);
  }
  return nodes.find((node) => node.nodeType === "root");
}

function isExecutableEdge(edge: OperationEdge, activeNodeIds: Set<string>, platform: Platform): boolean {
  return edge.status === "active" && supportsPlatform(edge.platformScope, platform) && activeNodeIds.has(edge.fromNodeId) && activeNodeIds.has(edge.toNodeId);
}

function findShortestPath(edges: OperationEdge[], startNodeId: string, targetNodeId: string): OperationEdge[] | undefined {
  if (startNodeId === targetNodeId) {
    return [];
  }

  const outgoing = new Map<string, OperationEdge[]>();
  for (const edge of edges) {
    const group = outgoing.get(edge.fromNodeId) ?? [];
    group.push(edge);
    group.sort((a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0) || a.name.localeCompare(b.name));
    outgoing.set(edge.fromNodeId, group);
  }

  const queue: Array<{ nodeId: string; path: OperationEdge[] }> = [{ nodeId: startNodeId, path: [] }];
  const visited = new Set<string>([startNodeId]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor];
    if (!item) {
      continue;
    }
    for (const edge of outgoing.get(item.nodeId) ?? []) {
      if (visited.has(edge.toNodeId)) {
        continue;
      }
      const path = [...item.path, edge];
      if (edge.toNodeId === targetNodeId) {
        return path;
      }
      visited.add(edge.toNodeId);
      queue.push({ nodeId: edge.toNodeId, path });
    }
  }

  return undefined;
}

function supportsPlatform(scope: PlatformScope | undefined, platform: Platform): boolean {
  return !scope || scope === "mobile-both" || scope === platform;
}

function hasBlockingIssue(issues: RoutePlanIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function scoreTargetNode(node: BusinessNode, graphVersion: BusinessGraphVersion, query: TargetNodeQuery): TargetNodeCandidate {
  let score = 0;
  const matchedBy: string[] = [];
  const reasons: string[] = [];
  const normalizedName = normalizeText(node.name);
  const normalizedKey = normalizeText(node.key);

  if (query.nodeId && node.id === query.nodeId) {
    score += 100;
    matchedBy.push("nodeId");
    reasons.push(`node id equals ${query.nodeId}`);
  }
  if (query.key && normalizedKey === normalizeText(query.key)) {
    score += 90;
    matchedBy.push("key");
    reasons.push(`node key equals ${query.key}`);
  }
  if (query.name) {
    const normalizedQueryName = normalizeText(query.name);
    if (normalizedName === normalizedQueryName) {
      score += 80;
      matchedBy.push("name");
      reasons.push(`node name equals ${query.name}`);
    } else if (normalizedName.includes(normalizedQueryName) || normalizedQueryName.includes(normalizedName)) {
      score += 40;
      matchedBy.push("name");
      reasons.push(`node name partially matches ${query.name}`);
    }
  }
  if (query.text) {
    const normalizedText = normalizeText(query.text);
    const textMatchers = node.matchers.filter((matcher) => ["text", "ocr_text", "accessibility_id", "resource_id"].includes(matcher.type));
    const matchedMatcher = textMatchers.find((matcher) => normalizeText(matcher.value).includes(normalizedText) || normalizedText.includes(normalizeText(matcher.value)));
    if (matchedMatcher) {
      score += matchedMatcher.type === "resource_id" ? 30 : 45;
      matchedBy.push(matchedMatcher.type);
      reasons.push(`node matcher ${matchedMatcher.type} matches ${query.text}`);
    }
    const expectationMatch = node.defaultExpectations.find((expectation) => expectationContainsText(expectation, normalizedText));
    if (expectationMatch) {
      score += 35;
      matchedBy.push("defaultExpectation");
      reasons.push(`default expectation ${expectationMatch.id} matches ${query.text}`);
    }
  }
  for (const tag of query.tags ?? []) {
    if (node.tags.some((nodeTag) => normalizeText(nodeTag) === normalizeText(tag))) {
      score += 20;
      matchedBy.push("tag");
      reasons.push(`node tag matches ${tag}`);
    }
  }
  if (query.intent) {
    const normalizedIntent = normalizeText(query.intent);
    const relatedEdges = graphVersion.edges.filter((edge) => edge.toNodeId === node.id || edge.fromNodeId === node.id);
    const intentMatched = relatedEdges.find((edge) => normalizeText(edge.intent).includes(normalizedIntent) || normalizeText(edge.name).includes(normalizedIntent));
    if (intentMatched) {
      score += intentMatched.toNodeId === node.id ? 35 : 15;
      matchedBy.push("intent");
      reasons.push(`related edge ${intentMatched.id} matches intent ${query.intent}`);
    }
  }

  return {
    node,
    score,
    matchedBy: Array.from(new Set(matchedBy)),
    reasons
  };
}

function expectationContainsText(expectation: StepExpectation, normalizedText: string): boolean {
  for (const value of Object.values(expectation.params)) {
    if (typeof value === "string" && normalizeText(value).includes(normalizedText)) {
      return true;
    }
  }
  return false;
}

function scoreNode(node: BusinessNode, observation: Observation, platform: Platform): NodeMatchCandidate {
  const matcherResults = node.matchers
    .filter((matcher) => supportsPlatform(matcher.platformScope, platform))
    .map((matcher) => evaluateMatcher(matcher, observation));
  const effectiveMatcherResults = effectiveNodeMatcherResults(matcherResults);
  const totalWeight = effectiveMatcherResults.reduce((sum, result) => sum + result.weight, 0);
  const matchedWeight = effectiveMatcherResults.reduce((sum, result) => sum + result.score, 0);
  return {
    node,
    score: totalWeight > 0 ? roundScore(matchedWeight / totalWeight) : 0,
    matchedWeight: roundScore(matchedWeight),
    totalWeight: roundScore(totalWeight),
    matcherResults,
    quality: evaluateNodeMatchQuality(effectiveMatcherResults)
  };
}

function evaluateNodeMatchQuality(matcherResults: MatcherResult[]): NodeMatchQuality {
  const matchedContextSignals = matcherResults.filter((result) => result.matched && isContextMatcherType(result.type)).length;
  const strongStateResults = matcherResults.filter((result) => isStrongStateMatcher(result));
  const matchedStrongSignals = strongStateResults.filter((result) => result.matched).length;
  const matchedWeakSignals = matcherResults.filter((result) => result.matched && isWeakStateMatcher(result)).length;
  const matchedCommonNavigationSignals = matcherResults.filter((result) => result.matched && isCommonNavigationMatcher(result)).length;
  const matchedPageSpecificSignals = matcherResults.filter((result) => result.matched && isPageSpecificMatcher(result)).length;
  const missingStrongMatcherIds = strongStateResults.filter((result) => !result.matched).map((result) => result.matcherId);
  const missingCriticalMatcherIds = matcherResults.filter((result) => result.critical && !result.matched).map((result) => result.matcherId);
  const reasons: string[] = [];

  if (missingCriticalMatcherIds.length > 0) {
    reasons.push("critical_matcher_missing");
  }
  if (strongStateResults.length > 0 && matchedStrongSignals === 0) {
    reasons.push("strong_state_anchor_missing");
  }
  if (strongStateResults.length === 0 && matchedWeakSignals < 2) {
    reasons.push(matchedWeakSignals === 0 ? "state_evidence_missing" : "single_weak_state_signal");
  }
  if (matchedContextSignals > 0 && matchedStrongSignals === 0 && matchedWeakSignals === 0) {
    reasons.push("context_only_match");
  }
  if (matchedCommonNavigationSignals > 0 && matchedPageSpecificSignals === 0) {
    reasons.push("page_specific_evidence_missing");
  }

  return {
    status: reasons.length === 0 ? "sufficient" : "low_confidence",
    reasons,
    matchedContextSignals,
    matchedStrongSignals,
    matchedWeakSignals,
    missingStrongMatcherIds,
    missingCriticalMatcherIds
  };
}

function effectiveNodeMatcherResults(matcherResults: MatcherResult[]): MatcherResult[] {
  const matchedImageRegions = matcherResults.filter((result) => isImageRegionMatcherType(result.type) && result.matched && result.region);
  const matchedSemanticImageRegions = matcherResults.filter((result) => result.type === "semantic_image_region" && result.matched && result.region);
  const matchedStrongSignals = matcherResults.filter((result) => result.matched && isStrongStateMatcher(result)).length;
  const matchedWeakSignals = matcherResults.filter((result) => result.matched && isWeakStateMatcher(result)).length;
  return matcherResults.filter(
    (result) =>
      !isDerivedRegionTextCoveredByMatchedImageRegion(result, matchedImageRegions) &&
      !isImageRegionCoveredByMatchedSemanticRegion(result, matchedSemanticImageRegions) &&
      !isChangedImageRegionCoveredByOtherPageAnchors(result, matchedImageRegions, matchedStrongSignals, matchedWeakSignals)
  );
}

function isDerivedRegionTextCoveredByMatchedImageRegion(result: MatcherResult, matchedImageRegions: MatcherResult[]): boolean {
  if (!(result.type === "text" || result.type === "ocr_text") || !result.region || result.matched) {
    return false;
  }
  if (result.source?.sourceType !== "manual_edit" || result.source.confidence !== 0.9) {
    return false;
  }
  return matchedImageRegions.some((imageRegion) => imageRegion.region && rectsNearlyEqual(result.region!, imageRegion.region));
}

function isChangedImageRegionCoveredByOtherPageAnchors(result: MatcherResult, matchedImageRegions: MatcherResult[], matchedStrongSignals: number, matchedWeakSignals: number): boolean {
  return isImageRegionMatcherType(result.type) && !result.matched && matchedImageRegions.length >= 1 && matchedStrongSignals >= 2 && matchedWeakSignals >= 2;
}

function isImageRegionCoveredByMatchedSemanticRegion(result: MatcherResult, matchedSemanticImageRegions: MatcherResult[]): boolean {
  return result.type === "image_region" && !result.critical && !result.matched && Boolean(result.region) && matchedSemanticImageRegions.some((semanticRegion) => semanticRegion.region && rectsNearlyEqual(result.region!, semanticRegion.region));
}

function isImageRegionMatcherType(type: StateMatcher["type"]): boolean {
  return type === "image_region" || type === "semantic_image_region";
}

function rectsNearlyEqual(left: Rect, right: Rect): boolean {
  const tolerance = 0.01;
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

function isContextMatcherType(type: StateMatcher["type"]): boolean {
  return type === "package" || type === "bundle_id";
}

function isStrongStateMatcherType(type: StateMatcher["type"]): boolean {
  return type === "activity" || type === "route" || type === "fragment" || type === "resource_id" || type === "accessibility_id" || type === "image_region" || type === "semantic_image_region" || type === "custom";
}

function isStrongStateMatcher(result: MatcherResult): boolean {
  if (isStrongStateMatcherType(result.type)) {
    return true;
  }
  return Boolean(result.region && (result.type === "text" || result.type === "ocr_text"));
}

function isWeakStateMatcherType(type: StateMatcher["type"]): boolean {
  return type === "text" || type === "ocr_text";
}

function isWeakStateMatcher(result: MatcherResult): boolean {
  return isWeakStateMatcherType(result.type) && !result.region;
}

function isPageSpecificMatcher(result: MatcherResult): boolean {
  if (!result.matched) {
    return false;
  }
  if (result.type === "image_region") {
    return !isCommonNavigationMatcher(result);
  }
  if (result.type === "semantic_image_region") {
    return !isCommonNavigationMatcher(result);
  }
  if (result.type === "text" || result.type === "ocr_text") {
    return Boolean(result.region && !isCommonNavigationMatcher(result));
  }
  if (result.type === "resource_id" || result.type === "accessibility_id" || result.type === "route" || result.type === "fragment" || result.type === "custom") {
    return true;
  }
  return false;
}

function isCommonNavigationMatcher(result: MatcherResult): boolean {
  if (!result.matched || !result.region) {
    return false;
  }
  return isCommonNavigationRegion(result.region) && isCommonNavigationSignature(result.expected);
}

function isCommonNavigationRegion(region: Rect): boolean {
  return region.y >= 82 && region.height <= 18;
}

function isCommonNavigationSignature(value: string): boolean {
  const decoded = safeDecodeURIComponent(value);
  const normalized = normalizeText(decoded);
  const tabTokenCount = ["主页", "消息", "待办", "课程表", "空间", "成长"].filter((token) => normalized.includes(normalizeText(token))).length;
  return /tab|navigation|fixed_bottom_navigation/i.test(decoded) || tabTokenCount >= 3;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function evaluateMatcher(matcher: StateMatcher, observation: Observation): MatcherResult {
  const weight = positiveWeight(matcher.weight);
  const base = {
    matcherId: matcher.id,
    type: matcher.type,
    expected: matcher.value,
    weight,
    critical: Boolean(matcher.critical),
    region: matcher.region,
    source: matcher.source
  };

  switch (matcher.type) {
    case "package": {
      const actual = observation.packageName ?? componentPackage(observation.componentName);
      return result(base, equalsNormalized(actual, matcher.value), actual);
    }
    case "bundle_id": {
      return result(base, equalsNormalized(observation.bundleId ?? observation.packageName, matcher.value), observation.bundleId ?? observation.packageName);
    }
    case "activity": {
      const actual = observation.activityName ?? componentActivity(observation.componentName);
      return result(base, activityMatches(actual, observation.componentName, matcher.value), actual ?? observation.componentName);
    }
    case "route": {
      return result(base, equalsNormalized(observation.routeName, matcher.value), observation.routeName);
    }
    case "fragment": {
      const actual = observation.fragments?.find((fragment) => textMatches(fragment, matcher.value));
      return result(base, Boolean(actual), actual);
    }
    case "resource_id": {
      const actual = observation.uiElements.find((element) => equalsNormalized(element.resourceId, matcher.value))?.resourceId;
      return result(base, Boolean(actual), actual);
    }
    case "accessibility_id": {
      const actual = observation.uiElements.find((element) => equalsNormalized(element.accessibilityId ?? element.contentDesc, matcher.value))?.accessibilityId;
      const fallback = actual ?? observation.uiElements.find((element) => equalsNormalized(element.contentDesc, matcher.value))?.contentDesc;
      return result(base, Boolean(fallback), fallback);
    }
    case "text": {
      const actual = observation.uiElements.find((element) => textRectMatchesMatcherRegion(element.bounds, matcher, observation.resolution) && (textMatches(element.text, matcher.value) || textMatches(element.contentDesc, matcher.value)));
      return result(base, Boolean(actual), actual?.text ?? actual?.contentDesc);
    }
    case "ocr_text": {
      const actual = observation.ocrTexts.find((text) => textRectMatchesMatcherRegion(text.region, matcher, observation.resolution, text.semanticArea) && textMatches(text.text, matcher.value));
      return result(base, Boolean(actual), actual?.text);
    }
    case "image_region": {
      const threshold = matcher.threshold ?? 0.9;
      const actual = observation.imageRegions?.find((region) => equalsNormalized(region.value, matcher.value) && (region.similarity ?? 1) >= threshold);
      return result(base, Boolean(actual), actual ? `${actual.value}:${actual.similarity ?? 1}` : undefined);
    }
    case "semantic_image_region": {
      const threshold = matcher.threshold ?? 0.68;
      const actual = observation.imageRegions?.find((region) => equalsNormalized(region.value, matcher.value) && (region.similarity ?? 1) >= threshold);
      return result(base, Boolean(actual), actual ? `${actual.value}:${actual.similarity ?? 1}` : undefined);
    }
    case "custom":
      return result(base, customSignalMatches(observation.raw, matcher.value), matcher.value);
    default:
      return {
        ...base,
        matched: false,
        score: 0,
        reason: "unsupported_matcher"
      };
  }
}

function result(
  base: Omit<MatcherResult, "matched" | "score">,
  matched: boolean,
  actual: string | undefined,
  reason?: string
): MatcherResult {
  return {
    ...base,
    actual,
    matched,
    score: matched ? base.weight : 0,
    reason: matched ? undefined : reason ?? "not_found"
  };
}

function positiveWeight(weight: number): number {
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function equalsNormalized(actual: string | undefined, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

function textMatches(actual: string | undefined, expected: string): boolean {
  const normalizedActual = normalizeMatcherText(actual);
  const normalizedExpected = normalizeMatcherText(expected);
  return Boolean(normalizedActual && normalizedExpected && normalizedActual.includes(normalizedExpected));
}

function textRectMatchesMatcherRegion(
  actualRect: Rect | undefined,
  matcher: StateMatcher,
  resolution: Observation["resolution"],
  actualSemanticArea?: VisualSemanticArea
): boolean {
  if (!matcher.region) {
    return true;
  }
  if (rectOverlapsMatcherRegion(actualRect, matcher.region, resolution)) {
    return true;
  }
  if (!actualRect) {
    return false;
  }
  const matcherArea = matcher.semanticArea ?? semanticAreaForRect(matcher.region, resolution);
  const actualArea = actualSemanticArea ?? semanticAreaForRect(actualRect, resolution);
  if (matcherArea === "unknown" || actualArea === "unknown" || matcherArea !== actualArea) {
    return false;
  }
  const matcherCenter = rectCenterPercent(matcher.region, resolution);
  const actualCenter = rectCenterPercent(actualRect, resolution);
  if (!matcherCenter || !actualCenter) {
    return false;
  }
  if (matcherArea === "top" || matcherArea === "bottom") {
    return Math.abs(matcherCenter.y - actualCenter.y) <= 8 && Math.abs(matcherCenter.x - actualCenter.x) <= 18;
  }
  if (matcherArea === "content") {
    return Math.abs(matcherCenter.y - actualCenter.y) <= 10 && Math.abs(matcherCenter.x - actualCenter.x) <= 24;
  }
  return Math.abs(matcherCenter.y - actualCenter.y) <= 8 && Math.abs(matcherCenter.x - actualCenter.x) <= 20;
}

function rectOverlapsMatcherRegion(actualRect: Rect | undefined, matcherRegion: Rect, resolution: Observation["resolution"]): boolean {
  if (!actualRect) {
    return false;
  }
  const expected = percentRectToPixels(matcherRegion, resolution);
  const actual = normalizeObservationRect(actualRect, resolution);
  if (!expected || !actual) {
    return false;
  }
  const overlapWidth = Math.max(0, Math.min(actual.x + actual.width, expected.x + expected.width) - Math.max(actual.x, expected.x));
  const overlapHeight = Math.max(0, Math.min(actual.y + actual.height, expected.y + expected.height) - Math.max(actual.y, expected.y));
  const overlapArea = overlapWidth * overlapHeight;
  const actualArea = actual.width * actual.height;
  if (actualArea <= 0) {
    return false;
  }
  return overlapArea / actualArea >= 0.35 || overlapArea > 0;
}

function rectCenterPercent(rect: Rect, resolution: Observation["resolution"]): { x: number; y: number } | undefined {
  const normalized = rectToPercent(rect, resolution);
  if (!normalized) {
    return undefined;
  }
  return {
    x: normalized.x + normalized.width / 2,
    y: normalized.y + normalized.height / 2
  };
}

function rectToPercent(rect: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    if (rect.x <= 100 && rect.y <= 100 && rect.width <= 100 && rect.height <= 100) {
      return rect;
    }
    return undefined;
  }
  if (rect.x <= 100 && rect.y <= 100 && rect.width <= 100 && rect.height <= 100) {
    return rect;
  }
  return {
    x: (rect.x / resolution.width) * 100,
    y: (rect.y / resolution.height) * 100,
    width: (rect.width / resolution.width) * 100,
    height: (rect.height / resolution.height) * 100
  };
}

function semanticAreaForRect(rect: Rect, resolution: Observation["resolution"]): VisualSemanticArea {
  const normalized = rectToPercent(rect, resolution);
  if (!normalized) {
    return "unknown";
  }
  const centerY = normalized.y + normalized.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function percentRectToPixels(region: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    return region.x <= 100 && region.y <= 100 && region.width <= 100 && region.height <= 100
      ? { x: region.x, y: region.y, width: region.width, height: region.height }
      : undefined;
  }
  return {
    x: (region.x / 100) * resolution.width,
    y: (region.y / 100) * resolution.height,
    width: (region.width / 100) * resolution.width,
    height: (region.height / 100) * resolution.height
  };
}

function normalizeObservationRect(rect: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height || rect.x > 100 || rect.y > 100 || rect.width > 100 || rect.height > 100) {
    return rect;
  }
  return percentRectToPixels(rect, resolution);
}

function activityMatches(activityName: string | undefined, componentName: string | undefined, expected: string): boolean {
  const normalizedExpected = normalize(expected);
  const normalizedActivity = normalize(activityName);
  const normalizedComponent = normalize(componentName);
  if (!normalizedExpected) {
    return false;
  }
  return (
    normalizedActivity === normalizedExpected ||
    normalizedActivity.endsWith(normalizedExpected.replace(/^\./, "")) ||
    normalizedComponent === normalizedExpected ||
    normalizedComponent.endsWith(`/${normalizedExpected}`) ||
    normalizedComponent.endsWith(normalizedExpected.replace(/^\./, ""))
  );
}

function componentPackage(componentName: string | undefined): string | undefined {
  return componentName?.split("/")[0];
}

function componentActivity(componentName: string | undefined): string | undefined {
  if (!componentName?.includes("/")) {
    return undefined;
  }
  const [packageName, activity] = componentName.split("/");
  if (!activity) {
    return undefined;
  }
  return activity.startsWith(".") ? `${packageName}${activity}` : activity;
}

function customSignalMatches(raw: Record<string, unknown> | undefined, expected: string): boolean {
  if (!raw) {
    return false;
  }
  const [key, value] = expected.split("=");
  if (!key || value === undefined) {
    return Object.values(raw).some((item) => normalize(String(item)) === normalize(expected));
  }
  return normalize(String(raw[key])) === normalize(value);
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeText(value: string | undefined): string {
  return normalize(value).replace(/\s+/g, "");
}

function normalizeMatcherText(value: string | undefined): string {
  return normalizeText(value).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}
