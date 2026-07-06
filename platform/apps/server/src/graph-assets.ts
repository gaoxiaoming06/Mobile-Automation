import type { BusinessGraphVersion, BusinessNode, OperationEdge } from "@mobile-automation/graph-core";
import type { ArtifactRef, TestRun } from "@mobile-automation/shared";
import { readStepGraphMetadata } from "./graph-node-test-result.js";

export type GraphAssetGovernanceSummary = {
  graphVersionId: string;
  pageAssets: PageAssetSummary[];
  runtimeDraftNodes: RuntimeDraftNodeSummary[];
  explorationDraftEdges: ExplorationDraftEdgeSummary[];
  routeGapArtifacts: RouteGapArtifactSummary[];
};

export type PageAssetSummary = {
  id: string;
  key: string;
  name: string;
  status: BusinessNode["status"];
  platformScope?: BusinessNode["platformScope"];
  tags: string[];
  matcherCount: number;
  criticalMatcherCount: number;
  elementCount: number;
  identityTexts: string[];
  confirmedMatchers: string[];
  confirmedUiTexts: string[];
  confirmedOcrTexts: string[];
  screenshotRegions: PageAssetScreenshotRegionSummary[];
  visibleTexts: string[];
  resourceIds: string[];
  accessibilityIds: string[];
  transitions: PageAssetTransitionSummary[];
  tasks: PageAssetTaskSummary[];
  updatedAt?: string;
};

export type PageAssetTaskSummary = {
  id: string;
  name: string;
  status: "active" | "draft" | "deprecated";
  stepCount: number;
  parameterKeys: string[];
  updatedAt?: string;
};

export type PageAssetScreenshotRegionSummary = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  semanticArea?: string;
  coordinateSpace?: string;
  evidenceTexts: string[];
  baselineUrl?: string;
};

export type PageAssetTransitionSummary = {
  id: string;
  key: string;
  name: string;
  status: OperationEdge["status"];
  source: OperationEdge["source"];
  actionSummary?: string;
  actionLocator?: string;
  actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
  targetNodeId: string;
  targetName?: string;
  targetKey?: string;
  expectationSummary?: string;
  reliabilityScore?: number;
};

export type RuntimeDraftNodeSummary = {
  id: string;
  key: string;
  name: string;
  status: BusinessNode["status"];
  tags: string[];
  observationCount: number;
  firstObservedAt?: string;
  lastObservedAt?: string;
  visibleTexts: string[];
  resourceIds: string[];
  accessibilityIds: string[];
  artifactIds: string[];
};

export type ExplorationDraftEdgeSummary = {
  id: string;
  key: string;
  name: string;
  status: OperationEdge["status"];
  source: OperationEdge["source"];
  fromNodeId: string;
  fromNodeName?: string;
  toNodeId: string;
  toNodeName?: string;
  suggestedAction?: string;
  reliabilityScore?: number;
  artifactIds: string[];
};

export type RouteGapArtifactSummary = {
  id: string;
  runId?: string;
  graphVersionId: string;
  name: string;
  url: string;
  createdAt: string;
};

export type GraphAssetPromotionPolicy = {
  minRuntimeObservationCount?: number;
  minExplorationReliabilityScore?: number;
};

export type GraphAssetPromotionSelection = {
  nodeIds: string[];
  edgeIds: string[];
  skipped: Array<{ id: string; type: "node" | "edge"; reason: string }>;
};

export function buildGraphAssetGovernanceSummary(graphVersion: BusinessGraphVersion, runs: TestRun[]): GraphAssetGovernanceSummary {
  const nodesById = new Map(graphVersion.nodes.map((node) => [node.id, node]));
  const outgoingEdgesByNodeId = groupEdgesByFromNodeId(graphVersion.edges);
  return {
    graphVersionId: graphVersion.id,
    pageAssets: graphVersion.nodes.filter(isPageAssetNode).map((node) => summarizePageAsset(node, outgoingEdgesByNodeId.get(node.id) ?? [], nodesById)),
    runtimeDraftNodes: graphVersion.nodes.filter(isRuntimeDraftNode).map(summarizeRuntimeDraftNode),
    explorationDraftEdges: graphVersion.edges.filter(isExplorationDraftEdge).map((edge) => summarizeExplorationDraftEdge(edge, nodesById)),
    routeGapArtifacts: runs.flatMap((run) => summarizeRouteGapArtifacts(run, graphVersion.id))
  };
}

export function selectAutoPromotableGraphAssets(graphVersion: BusinessGraphVersion, policy: GraphAssetPromotionPolicy = {}): GraphAssetPromotionSelection {
  const minRuntimeObservationCount = policy.minRuntimeObservationCount ?? 2;
  const minExplorationReliabilityScore = policy.minExplorationReliabilityScore ?? 0.75;
  const activeNodeIds = new Set(graphVersion.nodes.filter((node) => node.status === "active").map((node) => node.id));
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const skipped: GraphAssetPromotionSelection["skipped"] = [];

  for (const node of graphVersion.nodes.filter(isRuntimeDraftNode)) {
    const observationCount = numberField(node.metadata, "observationCount") ?? 1;
    const hasCriticalMatcher = node.matchers.some((matcher) => matcher.critical === true);
    if (observationCount >= minRuntimeObservationCount && hasCriticalMatcher) {
      nodeIds.push(node.id);
    } else {
      skipped.push({
        id: node.id,
        type: "node",
        reason: "runtime_node_below_threshold"
      });
    }
  }
  for (const nodeId of nodeIds) {
    activeNodeIds.add(nodeId);
  }

  for (const edge of graphVersion.edges.filter(isExplorationDraftEdge)) {
    const endpointsAreActive = activeNodeIds.has(edge.fromNodeId) && activeNodeIds.has(edge.toNodeId);
    if (!endpointsAreActive) {
      skipped.push({
        id: edge.id,
        type: "edge",
        reason: "edge_endpoint_not_active"
      });
      continue;
    }
    const reliabilityScore = edge.reliabilityScore ?? 0;
    const hasEvidence = edge.actionPolicies.some((policyItem) => typeof policyItem.source?.artifactId === "string" && policyItem.source.artifactId.length > 0);
    if (reliabilityScore >= minExplorationReliabilityScore && hasEvidence) {
      edgeIds.push(edge.id);
    } else {
      skipped.push({
        id: edge.id,
        type: "edge",
        reason: "exploration_edge_below_threshold"
      });
    }
  }

  return { nodeIds, edgeIds, skipped };
}

function isRuntimeDraftNode(node: BusinessNode): boolean {
  return node.status === "draft" && node.tags.includes("runtime-discovered");
}

function isPageAssetNode(node: BusinessNode): boolean {
  return node.status !== "deprecated" && (booleanField(node.metadata, "assetRecordingConfirmed") || node.tags.includes("page-asset") || node.tags.includes("asset-recording"));
}

function summarizePageAsset(node: BusinessNode, outgoingEdges: OperationEdge[], nodesById: Map<string, BusinessNode>): PageAssetSummary {
  const confirmedMatchers = stringArrayField(node.metadata, "confirmedMatchers");
  const confirmedUiTexts = stringArrayField(node.metadata, "confirmedUiTexts");
  const confirmedOcrTexts = stringArrayField(node.metadata, "confirmedOcrTexts");
  const screenshotRegions = summarizeScreenshotRegions(node.metadata);
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    status: node.status,
    platformScope: node.platformScope,
    tags: node.tags,
    matcherCount: node.matchers.length,
    criticalMatcherCount: node.matchers.filter((matcher) => matcher.critical).length,
    elementCount: Math.max(
      manualElementCount(node.metadata),
      stringArrayField(node.metadata, "resourceIds").length,
      stringArrayField(node.metadata, "accessibilityIds").length
    ),
    identityTexts: summarizeIdentityTexts({
      confirmedMatchers,
      confirmedUiTexts,
      confirmedOcrTexts,
      screenshotRegions,
      matchers: node.matchers
    }),
    confirmedMatchers,
    confirmedUiTexts,
    confirmedOcrTexts,
    screenshotRegions,
    visibleTexts: stringArrayField(node.metadata, "visibleTexts"),
    resourceIds: stringArrayField(node.metadata, "resourceIds"),
    accessibilityIds: stringArrayField(node.metadata, "accessibilityIds"),
    transitions: outgoingEdges
      .filter((edge) => edge.status !== "rejected" && edge.status !== "deprecated")
      .map((edge) => summarizePageAssetTransition(edge, nodesById)),
    tasks: summarizePageTasks(node.metadata),
    updatedAt: stringField(node.metadata, "lastObservedAt") ?? stringField(node.metadata, "updatedAt")
  };
}

function summarizePageTasks(record: Record<string, unknown> | undefined): PageAssetTaskSummary[] {
  const value = record?.assetRecordingPageTasks;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): PageAssetTaskSummary | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const task = item as Record<string, unknown>;
      const id = stringField(task, "id");
      const name = stringField(task, "name");
      if (!id || !name) {
        return undefined;
      }
      const steps = Array.isArray(task.steps) ? task.steps.filter((step) => Boolean(step) && typeof step === "object") : [];
      const status = task.status === "draft" || task.status === "deprecated" ? task.status : "active";
      return {
        id,
        name,
        status,
        stepCount: steps.length,
        parameterKeys: uniqueStrings(
          steps.flatMap((step) => {
            const valueParamKey = stringField(step as Record<string, unknown>, "valueParamKey");
            const desiredStateParamKey = stringField(step as Record<string, unknown>, "desiredStateParamKey");
            return [valueParamKey, desiredStateParamKey].filter((value): value is string => Boolean(value));
          })
        ),
        updatedAt: stringField(task, "updatedAt")
      };
    })
    .filter((item): item is PageAssetTaskSummary => Boolean(item));
}

function summarizeIdentityTexts(input: {
  confirmedMatchers: string[];
  confirmedUiTexts: string[];
  confirmedOcrTexts: string[];
  screenshotRegions: PageAssetScreenshotRegionSummary[];
  matchers: BusinessNode["matchers"];
}): string[] {
  return uniqueStrings(
    [
      ...input.confirmedMatchers.map(readEvidenceDisplayText).filter((value) => isDisplaySafeIdentityText(value)),
      ...input.confirmedOcrTexts.map(readEvidenceDisplayText).filter((value) => isDisplaySafeIdentityText(value)),
      ...input.screenshotRegions.flatMap((region) => [
        ...region.evidenceTexts.map(readEvidenceDisplayText).filter((value) => isDisplaySafeIdentityText(value, { autoEvidence: true })),
        region.label
      ]),
      ...input.matchers
        .filter((matcher) => matcher.critical && isHumanReadableMatcherType(matcher.type))
        .map((matcher) => readEvidenceDisplayText(matcher.value))
        .filter((value) => isDisplaySafeIdentityText(value))
    ].filter((value): value is string => Boolean(value))
  );
}

function isHumanReadableMatcherType(type: string): boolean {
  return type === "text" || type === "ocr_text" || type === "custom";
}

function readEvidenceDisplayText(value: string): string | undefined {
  const withoutPrefix = value.replace(/^(?:text|ocr_text|ocr|matcher):/i, "");
  const withoutRegion = withoutPrefix.replace(/@region\([^)]+\)$/i, "");
  const trimmed = withoutRegion.trim();
  return trimmed.length ? trimmed : undefined;
}

function isDisplaySafeIdentityText(value: string | undefined, options: { autoEvidence?: boolean } = {}): value is string {
  if (!value) {
    return false;
  }
  const text = value.trim();
  if (!text || isPlatformSpecificText(text)) {
    return false;
  }
  if (options.autoEvidence && isCommonTechnicalAccessibilityLabel(text)) {
    return false;
  }
  return /[\p{L}\p{N}]/u.test(text);
}

function isPlatformSpecificText(value: string): boolean {
  const normalized = value.trim();
  return (
    /^[a-z][\w.]+:id\/[\w.]+$/i.test(normalized) ||
    /^android(?:x)?\.[\w.$]+$/i.test(normalized) ||
    /^ios\.[\w.$]+$/i.test(normalized) ||
    /^XCUIElementType\w+$/i.test(normalized) ||
    /^(?:resource-id|accessibility-id|content-desc|class)\s*:/i.test(normalized)
  );
}

function isCommonTechnicalAccessibilityLabel(value: string): boolean {
  return new Set([
    "avatar",
    "back",
    "close",
    "contact",
    "down",
    "icon",
    "search",
    "user avatar"
  ]).has(value.trim().toLowerCase());
}

function summarizeScreenshotRegions(metadata: Record<string, unknown> | undefined): PageAssetScreenshotRegionSummary[] {
  const value = metadata?.screenshotRegions;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): PageAssetScreenshotRegionSummary | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const input = item as Record<string, unknown>;
      const x = numberField(input, "x");
      const y = numberField(input, "y");
      const width = numberField(input, "width");
      const height = numberField(input, "height");
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        return undefined;
      }
      return {
        id: stringField(input, "id") ?? `region-${index + 1}`,
        label: stringField(input, "label") ?? `重点区域 ${index + 1}`,
        x,
        y,
        width,
        height,
        ...(stringField(input, "semanticArea") ? { semanticArea: stringField(input, "semanticArea") } : {}),
        ...(stringField(input, "coordinateSpace") ? { coordinateSpace: stringField(input, "coordinateSpace") } : {}),
        evidenceTexts: stringArrayField(input, "evidenceTexts"),
        ...(stringField(input, "baselineUrl") ? { baselineUrl: stringField(input, "baselineUrl") } : {})
      };
    })
    .filter((item): item is PageAssetScreenshotRegionSummary => Boolean(item));
}

function summarizePageAssetTransition(edge: OperationEdge, nodesById: Map<string, BusinessNode>): PageAssetTransitionSummary {
  const target = nodesById.get(edge.toNodeId);
  const action = edge.actionPolicies[0]?.action;
  return {
    id: edge.id,
    key: edge.key,
    name: edge.name,
    status: edge.status,
    source: edge.source,
    actionSummary: summarizeAction(action),
    actionLocator: summarizeActionLocator(action),
    actionKind: summarizeActionKind(action?.type),
    targetNodeId: edge.toNodeId,
    targetName: target?.name,
    targetKey: target?.key,
    expectationSummary: edge.expectations[0]?.title,
    reliabilityScore: edge.reliabilityScore
  };
}

function summarizeActionKind(actionType: string | undefined): PageAssetTransitionSummary["actionKind"] {
  if (actionType === "scroll_until_visible") {
    return "scroll";
  }
  if (actionType === "long_press") {
    return "long_press";
  }
  if (actionType === "input_text_to_element") {
    return "input";
  }
  if (actionType) {
    return "tap";
  }
  return undefined;
}

function summarizeActionLocator(action: { type: string; params?: Record<string, unknown> } | undefined): string | undefined {
  const locator = stringField(action?.params, "locator");
  if (locator) {
    return locator;
  }
  const resourceId = stringField(action?.params, "resourceId");
  if (resourceId) {
    return `resource-id: ${resourceId}`;
  }
  const accessibilityId = stringField(action?.params, "accessibilityId") ?? stringField(action?.params, "contentDesc");
  if (accessibilityId) {
    return `accessibility/desc: ${accessibilityId}`;
  }
  const text = stringField(action?.params, "text");
  if (text) {
    return `text: ${text}`;
  }
  return undefined;
}

function isExplorationDraftEdge(edge: OperationEdge): boolean {
  return edge.status === "draft" && edge.source === "exploration";
}

function summarizeRuntimeDraftNode(node: BusinessNode): RuntimeDraftNodeSummary {
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    status: node.status,
    tags: node.tags,
    observationCount: numberField(node.metadata, "observationCount") ?? 1,
    firstObservedAt: stringField(node.metadata, "firstObservedAt"),
    lastObservedAt: stringField(node.metadata, "lastObservedAt"),
    visibleTexts: stringArrayField(node.metadata, "visibleTexts"),
    resourceIds: stringArrayField(node.metadata, "resourceIds"),
    accessibilityIds: stringArrayField(node.metadata, "accessibilityIds"),
    artifactIds: stringArrayField(node.metadata, "artifactIds")
  };
}

function summarizeExplorationDraftEdge(edge: OperationEdge, nodesById: Map<string, BusinessNode>): ExplorationDraftEdgeSummary {
  return {
    id: edge.id,
    key: edge.key,
    name: edge.name,
    status: edge.status,
    source: edge.source,
    fromNodeId: edge.fromNodeId,
    fromNodeName: nodesById.get(edge.fromNodeId)?.name,
    toNodeId: edge.toNodeId,
    toNodeName: nodesById.get(edge.toNodeId)?.name,
    suggestedAction: summarizeAction(edge.actionPolicies[0]?.action),
    reliabilityScore: edge.reliabilityScore,
    artifactIds: uniqueStrings(edge.actionPolicies.map((policy) => policy.source?.artifactId).filter((id): id is string => Boolean(id)))
  };
}

function summarizeRouteGapArtifacts(run: TestRun, graphVersionId: string): RouteGapArtifactSummary[] {
  if (!runBelongsToGraphVersion(run, graphVersionId)) {
    return [];
  }
  return run.artifacts
    .filter((artifact) => artifact.type === "log" && artifact.name.startsWith("route-gap-exploration-"))
    .map((artifact) => ({
      id: artifact.id,
      runId: artifact.runId,
      graphVersionId,
      name: artifact.name,
      url: artifact.url,
      createdAt: artifact.createdAt
    }));
}

function runBelongsToGraphVersion(run: TestRun, graphVersionId: string): boolean {
  return run.stepResults.some((step) => readStepGraphMetadata(step)?.versionId === graphVersionId);
}

function summarizeAction(action: { type: string; params?: Record<string, unknown> } | undefined): string | undefined {
  if (!action) {
    return undefined;
  }
  const text = stringField(action.params, "text");
  const resourceId = stringField(action.params, "resourceId");
  const accessibilityId = stringField(action.params, "accessibilityId") ?? stringField(action.params, "contentDesc");
  const label = text ?? resourceId ?? accessibilityId;
  return label ? `${action.type}: ${label}` : action.type;
}

function groupEdgesByFromNodeId(edges: OperationEdge[]): Map<string, OperationEdge[]> {
  const result = new Map<string, OperationEdge[]>();
  for (const edge of edges) {
    const existing = result.get(edge.fromNodeId) ?? [];
    existing.push(edge);
    result.set(edge.fromNodeId, existing);
  }
  return result;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanField(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}

function manualElementCount(record: Record<string, unknown> | undefined): number {
  const value = record?.assetRecordingManualElements;
  return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === "object").length : 0;
}

function stringArrayField(record: Record<string, unknown> | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
