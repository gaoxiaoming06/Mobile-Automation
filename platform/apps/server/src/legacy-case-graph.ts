import type {
  ActionPolicy,
  BusinessGraph,
  BusinessGraphVersion,
  GraphAssetSource,
  GraphTargetApp,
  OperationEdge,
  PlatformScope,
  StateMatcher
} from "@mobile-automation/graph-core";
import {
  createId,
  isSystemGuardExpectationType,
  type ActionStep,
  type StepExpectation,
  type TestCase
} from "@mobile-automation/shared";

export type LegacyCaseGraphStorage = {
  createBusinessGraph(input: {
    appId: string;
    targetApp?: GraphTargetApp;
    platformScope: PlatformScope;
    name: string;
    status?: BusinessGraph["status"];
  }): BusinessGraph;
  getBusinessGraph(id: string): BusinessGraph | undefined;
  createBusinessGraphVersion(input: {
    graphId: string;
    sourceSummary?: string[];
    status?: BusinessGraphVersion["status"];
  }): BusinessGraphVersion;
  createBusinessNode(input: {
    graphVersionId: string;
    key: string;
    name: string;
    nodeType: "root" | "page" | "business_state" | "terminal";
    tags?: string[];
    status?: "draft" | "active" | "deprecated" | "rejected";
    matchers?: StateMatcher[];
    defaultExpectations?: StepExpectation[];
    platformScope?: PlatformScope;
    metadata?: Record<string, unknown>;
  }): {
    id: string;
  };
  createOperationEdge(input: {
    graphVersionId: string;
    fromNodeId: string;
    toNodeId: string;
    key: string;
    name: string;
    intent: string;
    status?: "draft" | "active" | "deprecated" | "rejected";
    source: OperationEdge["source"];
    preconditions?: StepExpectation[];
    actionPolicies?: ActionPolicy[];
    expectations?: StepExpectation[];
    platformScope?: PlatformScope;
    reliabilityScore?: number;
  }): {
    id: string;
  };
  getBusinessGraphVersion(id: string): BusinessGraphVersion | undefined;
};

export type ImportLegacyCaseGraphInput = {
  graphId?: string;
  appId?: string;
  name?: string;
  targetApp?: GraphTargetApp;
};

export type ImportedLegacyCaseGraph = {
  graph: BusinessGraph;
  version: BusinessGraphVersion;
  importedNodeCount: number;
  importedEdgeCount: number;
  unresolvedSteps: Array<{
    stepId: string;
    reason: "disabled_step" | "unsupported_action" | "coordinate_fallback_only";
    message: string;
  }>;
};

export function importLegacyCaseAsDraftGraph(storage: LegacyCaseGraphStorage, testCase: TestCase, input: ImportLegacyCaseGraphInput = {}): ImportedLegacyCaseGraph {
  const enabledSteps = testCase.steps.filter((step) => step.enabled).sort((left, right) => left.order - right.order);
  if (enabledSteps.length === 0) {
    throw new Error("Legacy case has no enabled steps to convert.");
  }

  const targetApp = input.targetApp ?? testCase.targetApp;
  const graph =
    (input.graphId ? storage.getBusinessGraph(input.graphId) : undefined) ??
    storage.createBusinessGraph({
      appId: input.appId?.trim() || defaultAppId(testCase, targetApp),
      targetApp,
      platformScope: testCase.platformScope,
      name: input.name?.trim() || `${testCase.name} 录制候选图谱`,
      status: "draft"
    });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: [
      "manual_recording",
      `source_case:${testCase.id}`,
      `source_case_version:${testCase.version}`,
      `source_steps:${enabledSteps.length}`
    ],
    status: "draft"
  });

  const unresolvedSteps: ImportedLegacyCaseGraph["unresolvedSteps"] = [];
  const source = (step?: ActionStep): GraphAssetSource => ({
    sourceType: "manual_recording",
    caseId: testCase.id,
    stepId: step?.id,
    confidence: step ? actionReliabilityScore(step) : 0.5
  });

  let previousNodeId = storage.createBusinessNode({
    graphVersionId: version.id,
    key: legacyNodeKey(testCase.id, "start"),
    name: `${testCase.name} 起点`,
    nodeType: "root",
    tags: ["manual-recording", "legacy-case", "start"],
    status: "draft",
    matchers: [],
    defaultExpectations: [],
    platformScope: testCase.platformScope,
    metadata: {
      sourceCaseId: testCase.id,
      sourceCaseName: testCase.name,
      sourceCaseVersion: testCase.version,
      source
    }
  }).id;
  let importedEdgeCount = 0;

  for (const step of enabledSteps) {
    const businessExpectations = businessExpectationsFromStep(step.expectations ?? []);
    const nextNode = storage.createBusinessNode({
      graphVersionId: version.id,
      key: legacyNodeKey(testCase.id, `after_step_${step.order}`),
      name: `${testCase.name} / 步骤 ${step.order} 后状态`,
      nodeType: "business_state",
      tags: ["manual-recording", "legacy-case", `step-${step.order}`],
      status: "draft",
      matchers: matchersFromStep(step),
      defaultExpectations: businessExpectations,
      platformScope: testCase.platformScope,
      metadata: {
        sourceCaseId: testCase.id,
        sourceCaseName: testCase.name,
        sourceStepId: step.id,
        sourceStepOrder: step.order,
        sourceStepType: step.type,
        sourceStepTitle: step.title,
        originalParams: step.params,
        originalCoordinate: step.coordinate,
        originalTiming: step.timing,
        source: source(step),
        graphCandidate: graphCandidateMetadata(step)
      }
    });
    const policy = actionPolicyFromStep(step, source(step));
    if (policy.fallback) {
      unresolvedSteps.push({
        stepId: step.id,
        reason: "coordinate_fallback_only",
        message: `Step ${step.order} uses coordinate-only action ${step.type}; it was imported as a fallback policy.`
      });
    }
    storage.createOperationEdge({
      graphVersionId: version.id,
      fromNodeId: previousNodeId,
      toNodeId: nextNode.id,
      key: legacyEdgeKey(testCase.id, step.order),
      name: step.title || `${testCase.name} 步骤 ${step.order}`,
      intent: step.note || step.title || `执行录制步骤 ${step.order}`,
      status: "draft",
      source: "manual_recording",
      preconditions: businessExpectationsFromStep(step.preconditions ?? []),
      actionPolicies: [policy],
      expectations: businessExpectations,
      platformScope: testCase.platformScope,
      reliabilityScore: actionReliabilityScore(step)
    });
    importedEdgeCount += 1;
    previousNodeId = nextNode.id;
  }

  for (const step of testCase.steps.filter((step) => !step.enabled)) {
    unresolvedSteps.push({
      stepId: step.id,
      reason: "disabled_step",
      message: `Step ${step.order} is disabled and was not imported.`
    });
  }

  return {
    graph,
    version: storage.getBusinessGraphVersion(version.id) ?? version,
    importedNodeCount: enabledSteps.length + 1,
    importedEdgeCount,
    unresolvedSteps
  };
}

function actionPolicyFromStep(step: ActionStep, source: GraphAssetSource): ActionPolicy {
  return {
    id: createId("policy"),
    priority: 1,
    action: {
      ...step,
      order: 1
    },
    fallback: isCoordinateOnlyAction(step),
    source,
    reliabilityHint: isCoordinateOnlyAction(step) ? "low" : semanticActionTypes.has(step.type) ? "high" : "medium"
  };
}

function businessExpectationsFromStep(expectations: StepExpectation[]): StepExpectation[] {
  return expectations.filter((expectation) => expectation.enabled && !isSystemGuardExpectationType(expectation.type));
}

function matchersFromStep(step: ActionStep): StateMatcher[] {
  const matchers: StateMatcher[] = [];
  for (const expectation of businessExpectationsFromStep(step.expectations ?? [])) {
    const expected = stringParam(expectation.params.expected);
    const resourceId = stringParam(expectation.params.resourceId);
    if (expectation.type === "text" && expected) {
      matchers.push(matcher(`expectation_${expectation.id}_text`, "text", expected, 2, step));
    }
    if (expectation.type === "image") {
      const baselineArtifactId = stringParam(expectation.params.baselineArtifactId);
      if (baselineArtifactId) {
        matchers.push(matcher(`expectation_${expectation.id}_image`, "image_region", baselineArtifactId, 1.5, step));
      }
    }
    if (resourceId) {
      matchers.push(matcher(`expectation_${expectation.id}_resource`, "resource_id", resourceId, 2, step));
    }
  }
  const stepResourceId = stringParam(step.params.resourceId) || stringParam(readLocator(step).resourceId);
  const stepText = stringParam(step.params.text) || stringParam(readLocator(step).text);
  const stepContentDesc = stringParam(step.params.contentDesc) || stringParam(readLocator(step).contentDesc);
  if (stepResourceId) {
    matchers.push(matcher(`step_${step.id}_resource`, "resource_id", stepResourceId, 3, step, { critical: true }));
  }
  if (stepText) {
    matchers.push(matcher(`step_${step.id}_text`, "text", stepText, 1, step));
  }
  if (stepContentDesc) {
    matchers.push(matcher(`step_${step.id}_content_desc`, "accessibility_id", stepContentDesc, 1, step));
  }
  return uniqueMatchers(matchers);
}

function matcher(id: string, type: StateMatcher["type"], value: string, weight: number, step: ActionStep, options: { critical?: boolean } = {}): StateMatcher {
  return {
    id,
    type,
    value,
    weight,
    critical: options.critical,
    source: {
      sourceType: "manual_recording",
      stepId: step.id,
      confidence: Math.min(0.95, actionReliabilityScore(step))
    }
  };
}

function graphCandidateMetadata(step: ActionStep): Record<string, unknown> {
  const locator = readLocator(step);
  return {
    needsReview: true,
    repairHint: semanticActionTypes.has(step.type) ? "recorded_semantic_locator" : isCoordinateOnlyAction(step) ? "coordinate_fallback_only" : "recorded_action",
    locator: Object.keys(locator).length > 0 ? locator : undefined,
    hasCriticalMatcher: Boolean(stringParam(step.params.resourceId) || stringParam(locator.resourceId))
  };
}

function uniqueMatchers(matchers: StateMatcher[]): StateMatcher[] {
  const seen = new Set<string>();
  return matchers.filter((matcher) => {
    const key = `${matcher.type}:${matcher.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function actionReliabilityScore(step: ActionStep): number {
  if (step.type === "tap_on_element") {
    return stringParam(step.params.resourceId) || stringParam(readLocator(step).resourceId) ? 0.82 : 0.68;
  }
  if (step.type === "tap_on_text" || step.type === "tap_on_image") {
    return 0.72;
  }
  if (isCoordinateOnlyAction(step)) {
    return 0.35;
  }
  return 0.6;
}

const semanticActionTypes = new Set<ActionStep["type"]>(["tap_on_element", "tap_on_text", "tap_on_image", "launch_app", "close_app", "input_text", "clear_text", "back", "home", "recent_apps", "wait"]);

function isCoordinateOnlyAction(step: ActionStep): boolean {
  return step.type === "tap" || step.type === "long_press" || step.type === "swipe";
}

function readLocator(step: ActionStep): Record<string, unknown> {
  return step.params.locator && typeof step.params.locator === "object" && !Array.isArray(step.params.locator)
    ? step.params.locator as Record<string, unknown>
    : {};
}

function defaultAppId(testCase: TestCase, targetApp: GraphTargetApp | undefined): string {
  return targetApp?.androidPackageName ?? targetApp?.iosBundleId ?? `legacy-case-${testCase.id}`;
}

function legacyNodeKey(caseId: string, suffix: string): string {
  return `legacy.${normalizeKey(caseId)}.${suffix}`;
}

function legacyEdgeKey(caseId: string, order: number): string {
  return `legacy.${normalizeKey(caseId)}.step_${order}`;
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "case";
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
