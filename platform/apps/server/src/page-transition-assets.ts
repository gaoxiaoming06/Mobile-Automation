import type { ActionPolicy, BusinessGraphVersion, BusinessNode, OperationEdge, PlatformScope } from "@mobile-automation/graph-core";
import { createId, nowIso, type ActionStep, type StepExpectation } from "@mobile-automation/shared";
import type { PageElementQualityResult } from "./page-element-quality.js";

export type ManualPageTransitionOutcomeType = "navigate" | "compound_navigation" | "show_inline_state" | "local_state_change" | "no_visible_change";
export type ManualPageTransitionActionKind = "tap" | "scroll" | "long_press" | "input";
export type ManualPageTransitionCompoundStep = {
  actionKind: ManualPageTransitionActionKind | "wait";
  locator: string;
  elementLabel: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  waitTimeoutMs?: number;
  intervalMs?: number;
};
export type ManualPageTransitionAvailability = "visible" | "after_scroll" | "conditional";
export type ManualPageAbilityType = "scroll_candidate" | "grid_candidate" | "conditional_tap";
export type ManualPageElementLocatorKind = "text_locator" | "visual_locator" | "structural_locator" | "collection_item_locator";
export type ManualPageElementDynamicMask = {
  kind: "avatar" | "text" | "image" | "number" | "custom";
  label?: string;
  region: { x: number; y: number; width: number; height: number };
  reason?: string;
};
export type ManualDynamicRegion = {
  id: string;
  label: string;
  kind: "list" | "grid" | "feed" | "form_group";
  region: { x: number; y: number; width: number; height: number };
  itemTemplateId?: string;
  dynamicFieldRules?: Record<string, unknown>[];
};
export type ManualItemTemplate = {
  id: string;
  label: string;
  region?: { x: number; y: number; width: number; height: number };
  actionArea?: { x: number; y: number; width: number; height: number };
  stableStructure?: Record<string, unknown>;
  stableAnchors?: Record<string, unknown>[];
  dynamicFields?: Record<string, unknown>[];
};
export type ManualPageTransitionScrollProfile = {
  containerKind: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
  direction: "vertical" | "horizontal";
  columns?: number;
  targetKind: "item_text" | "ocr_text" | "semantic_label" | "nth_item" | "image_region";
  targetQuery?: string;
  afterFoundAction: "tap_item" | "tap_child" | "verify_visible";
  candidateItemHeightPercent?: number;
  clickSafePoint?: {
    xPercent: number;
    yPercent: number;
  };
  scrollStepPercent?: number;
  failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
};

export type ManualPageTransitionStorage = {
  findBusinessNodeById(graphVersionId: string, nodeId: string): BusinessNode | undefined;
  findOperationEdgeByKey(graphVersionId: string, key: string): OperationEdge | undefined;
  listOperationEdges?(graphVersionId: string): OperationEdge[];
  createOperationEdge(input: Omit<OperationEdge, "id"> & { id?: string }): OperationEdge;
  updateOperationEdgeStatus(edgeId: string, status: OperationEdge["status"]): OperationEdge | undefined;
  updateBusinessNodeDetails(
    nodeId: string,
    input: {
      metadata?: Record<string, unknown>;
    }
  ): BusinessNode | undefined;
};

export type PersistManualPageTransitionInput = {
  graphVersionId: string;
  storage: ManualPageTransitionStorage;
  sourceNodeId: string;
  targetNodeId: string;
  actionKind: ManualPageTransitionActionKind;
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  availability: ManualPageTransitionAvailability;
  outcomeType: ManualPageTransitionOutcomeType;
  targetLabel?: string;
  platformScope?: PlatformScope;
  abilityType?: ManualPageAbilityType;
  scrollProfile?: ManualPageTransitionScrollProfile;
  tapPointPercent?: { x: number; y: number };
  compoundSteps?: ManualPageTransitionCompoundStep[];
  quality?: PageElementQualityResult;
  visualLocator?: Record<string, unknown>;
  locatorKind?: ManualPageElementLocatorKind;
  dynamicMasks?: ManualPageElementDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: ManualDynamicRegion;
  itemTemplate?: ManualItemTemplate;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
};

export type PersistPageTaskNavigationTransitionInput = {
  graphVersionId: string;
  storage: ManualPageTransitionStorage;
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  taskName?: string;
  platformScope?: PlatformScope;
};

export type PersistManualPageElementInput = {
  graphVersionId: string;
  storage: ManualPageTransitionStorage;
  elementId?: string;
  sourceNodeId: string;
  actionKind: ManualPageTransitionActionKind;
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  availability: ManualPageTransitionAvailability;
  platformScope?: PlatformScope;
  outcomeType?: ManualPageTransitionOutcomeType;
  outcomeLabel?: string;
  targetNodeId?: string;
  targetLabel?: string;
  abilityType?: ManualPageAbilityType;
  scrollProfile?: ManualPageTransitionScrollProfile;
  tapPointPercent?: { x: number; y: number };
  compoundSteps?: ManualPageTransitionCompoundStep[];
  quality?: PageElementQualityResult;
  visualLocator?: Record<string, unknown>;
  locatorKind?: ManualPageElementLocatorKind;
  dynamicMasks?: ManualPageElementDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: ManualDynamicRegion;
  itemTemplate?: ManualItemTemplate;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
};

export type PersistManualPageTransitionResult = {
  status: "created" | "reused" | "skipped";
  edge?: OperationEdge;
  reason?: string;
};

export type PersistManualPageElementResult = {
  status: "saved" | "skipped";
  element?: Record<string, unknown>;
  reason?: string;
};

export type DeleteManualPageElementInput = {
  graphVersionId: string;
  storage: ManualPageTransitionStorage;
  sourceNodeId: string;
  elementId: string;
};

export type DeleteManualPageElementResult = {
  status: "deleted" | "skipped";
  reason?: string;
};

export type DeleteManualPageTransitionInput = {
  graphVersion: BusinessGraphVersion;
  storage: ManualPageTransitionStorage;
  edgeId: string;
};

export type DeleteManualPageTransitionResult = {
  status: "deleted" | "skipped";
  edge?: OperationEdge;
  reason?: string;
};

export function persistManualPageTransitionAsset(input: PersistManualPageTransitionInput): PersistManualPageTransitionResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  const targetNode = input.storage.findBusinessNodeById(input.graphVersionId, input.targetNodeId);
  if (!isConfirmedPageAsset(sourceNode) || !isConfirmedPageAsset(targetNode)) {
    return { status: "skipped", reason: "source_or_target_page_asset_missing" };
  }

  rejectStaleManualTransitionEdges(input, sourceNode, targetNode);
  const key = manualTransitionKey(sourceNode.key, targetNode.key, input.actionKind, input.locator, compoundStepsSignature(input.compoundSteps));
  const existing = input.storage.findOperationEdgeByKey(input.graphVersionId, key);
  if (existing) {
    persistManualPageElement(input, sourceNode, targetNode);
    return { status: "reused", edge: existing };
  }

  const createdAt = nowIso();
  const action = buildManualTransitionAction(input, createdAt);
  const reliabilityScore = reliabilityScoreForManualTransition(input);
  const edge = input.storage.createOperationEdge({
    graphVersionId: input.graphVersionId,
    fromNodeId: sourceNode.id,
    toNodeId: targetNode.id,
    key,
    name: `${sourceNode.name} -> ${targetNode.name}`,
    intent: `${actionVerb(input.actionKind)}：${input.elementLabel || input.locator}`,
    status: edgeStatusFor(input),
    source: "manual_edit",
    preconditions: [stateExpectation(sourceNode, "前置状态", input.outcomeType, createdAt)],
    actionPolicies: [manualActionPolicy(action, reliabilityScore, input, createdAt)],
    expectations: [stateExpectation(targetNode, "预期状态", input.outcomeType, createdAt)],
    failurePolicy: {
      retryCount: 1,
      recoverTo: "replan"
    },
    platformScope: input.platformScope ?? sourceNode.platformScope ?? targetNode.platformScope ?? "android",
    reliabilityScore
  });
  persistManualPageElement(input, sourceNode, targetNode);
  return { status: "created", edge };
}

export function persistPageTaskNavigationTransitionAsset(input: PersistPageTaskNavigationTransitionInput): PersistManualPageTransitionResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  const targetNode = input.storage.findBusinessNodeById(input.graphVersionId, input.targetNodeId);
  if (!isConfirmedPageAsset(sourceNode) || !isConfirmedPageAsset(targetNode)) {
    return { status: "skipped", reason: "source_or_target_page_asset_missing" };
  }
  const taskId = input.taskId.trim();
  if (!taskId) {
    return { status: "skipped", reason: "task_id_missing" };
  }
  const task = readPageTaskSummaries(sourceNode.metadata?.assetRecordingPageTasks).find((item) => item.id === taskId && item.status !== "deprecated");
  if (!task) {
    return { status: "skipped", reason: "source_page_task_missing" };
  }
  const taskName = input.taskName?.trim() || task.name;
  const key = pageTaskNavigationTransitionKey(sourceNode.key, targetNode.key, taskId);
  const existing = input.storage.findOperationEdgeByKey(input.graphVersionId, key);
  if (existing) {
    return { status: "reused", edge: existing };
  }

  const createdAt = nowIso();
  const reliabilityScore = 0.86;
  const action = buildPageTaskNavigationAction({ taskId, taskName, createdAt });
  const edge = input.storage.createOperationEdge({
    graphVersionId: input.graphVersionId,
    fromNodeId: sourceNode.id,
    toNodeId: targetNode.id,
    key,
    name: `${sourceNode.name} -> ${targetNode.name}`,
    intent: `执行页面任务：${taskName}`,
    status: "active",
    source: "manual_edit",
    preconditions: [stateExpectation(sourceNode, "前置状态", "navigate", createdAt)],
    actionPolicies: [taskNavigationActionPolicy(action, reliabilityScore)],
    expectations: [stateExpectation(targetNode, "预期状态", "navigate", createdAt)],
    failurePolicy: {
      retryCount: 1,
      recoverTo: "replan"
    },
    platformScope: input.platformScope ?? sourceNode.platformScope ?? targetNode.platformScope ?? "android",
    reliabilityScore
  });
  return { status: "created", edge };
}

export function persistManualPageElementAsset(input: PersistManualPageElementInput): PersistManualPageElementResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPageAsset(sourceNode)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  if ((input.outcomeType === "navigate" || input.outcomeType === "compound_navigation") && input.targetNodeId) {
    const targetNode = input.storage.findBusinessNodeById(input.graphVersionId, input.targetNodeId);
    if (isConfirmedPageAsset(targetNode)) {
      persistManualPageTransitionAsset({
        graphVersionId: input.graphVersionId,
        storage: input.storage,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        actionKind: input.actionKind,
        locator: input.locator,
        semanticArea: input.semanticArea,
        coordinateSpace: input.coordinateSpace,
        elementLabel: input.elementLabel,
        targetText: input.targetText,
        availability: input.availability,
        outcomeType: input.outcomeType,
        targetLabel: input.targetLabel,
        platformScope: input.platformScope,
        abilityType: input.abilityType,
        scrollProfile: input.scrollProfile,
        tapPointPercent: input.tapPointPercent,
        compoundSteps: input.compoundSteps,
        quality: input.quality,
        visualLocator: input.visualLocator,
        locatorKind: input.locatorKind,
        dynamicMasks: input.dynamicMasks,
        structuralLocator: input.structuralLocator,
        dynamicRegion: input.dynamicRegion,
        itemTemplate: input.itemTemplate,
        transitionKind: input.transitionKind,
        parameterMapping: input.parameterMapping
      });
      return { status: "saved", element: manualPageElement(input, targetNode) };
    }
  }
  const nextElement = manualPageElement(input);
  const existingElements = readManualPageElements(sourceNode.metadata?.assetRecordingManualElements);
  const nextElements = upsertManualPageElement(existingElements, nextElement);
  input.storage.updateBusinessNodeDetails(sourceNode.id, {
    metadata: manualPageAssetMetadata(sourceNode.metadata, nextElements, input)
  });
  return { status: "saved", element: nextElement };
}

export function deleteManualPageElementAsset(input: DeleteManualPageElementInput): DeleteManualPageElementResult {
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersionId, input.sourceNodeId);
  if (!isConfirmedPageAsset(sourceNode)) {
    return { status: "skipped", reason: "source_page_asset_missing" };
  }
  const existingElements = readManualPageElements(sourceNode.metadata?.assetRecordingManualElements);
  const nextElements = existingElements.filter((element) => element.id !== input.elementId);
  if (nextElements.length === existingElements.length) {
    return { status: "skipped", reason: "element_not_found" };
  }
  input.storage.updateBusinessNodeDetails(sourceNode.id, {
    metadata: {
      ...(sourceNode.metadata ?? {}),
      assetRecordingManualElements: nextElements,
      updatedAt: nowIso()
    }
  });
  return { status: "deleted" };
}

export function deleteManualPageTransitionAsset(input: DeleteManualPageTransitionInput): DeleteManualPageTransitionResult {
  const edge = input.graphVersion.edges.find((item) => item.id === input.edgeId);
  if (!edge) {
    return { status: "skipped", reason: "transition_not_found" };
  }
  const deletedEdge = input.storage.updateOperationEdgeStatus(edge.id, "rejected") ?? { ...edge, status: "rejected" as const };
  const deletedAction = manualActionDescriptor(edge);
  const sourceNode = input.storage.findBusinessNodeById(input.graphVersion.id, edge.fromNodeId);
  if (!deletedAction || !sourceNode) {
    return { status: "deleted", edge: deletedEdge };
  }
  const stillUsed = input.graphVersion.edges
    .filter((item) => item.id !== edge.id && item.fromNodeId === edge.fromNodeId && item.status !== "rejected")
    .some((item) => {
      const action = manualActionDescriptor(item);
      return action?.locator === deletedAction.locator && action.actionKind === deletedAction.actionKind && action.compoundSignature === deletedAction.compoundSignature;
    });
  if (stillUsed) {
    return { status: "deleted", edge: deletedEdge };
  }
  const existingElements = readManualPageElements(sourceNode.metadata?.assetRecordingManualElements);
  const nextElements = existingElements.filter((element) => !(element.locator === deletedAction.locator && element.actionKind === deletedAction.actionKind && element.compoundSignature === deletedAction.compoundSignature));
  if (nextElements.length !== existingElements.length) {
    input.storage.updateBusinessNodeDetails(sourceNode.id, {
      metadata: {
        ...(sourceNode.metadata ?? {}),
        assetRecordingManualElements: nextElements,
        updatedAt: nowIso()
      }
    });
  }
  return { status: "deleted", edge: deletedEdge };
}

function rejectStaleManualTransitionEdges(
  input: Pick<PersistManualPageTransitionInput, "graphVersionId" | "storage" | "sourceNodeId" | "targetNodeId" | "actionKind" | "locator" | "compoundSteps">,
  sourceNode: BusinessNode,
  targetNode: BusinessNode
): void {
  const edges = input.storage.listOperationEdges?.(input.graphVersionId) ?? [];
  for (const edge of edges) {
    if (edge.status !== "active" || edge.source !== "manual_edit" || edge.fromNodeId !== sourceNode.id || edge.toNodeId === targetNode.id) {
      continue;
    }
    const action = manualActionDescriptor(edge);
    if (!action || action.locator !== input.locator || action.actionKind !== input.actionKind || action.compoundSignature !== compoundStepsSignature(input.compoundSteps)) {
      continue;
    }
    input.storage.updateOperationEdgeStatus(edge.id, "rejected");
  }
}

function persistManualPageElement(input: PersistManualPageTransitionInput, sourceNode: BusinessNode, targetNode: BusinessNode): void {
  const nextElement = manualPageElement(input, targetNode);
  const existingElements = readManualPageElements(sourceNode.metadata?.assetRecordingManualElements);
  const nextElements = upsertManualPageElement(existingElements, nextElement);
  input.storage.updateBusinessNodeDetails(sourceNode.id, {
    metadata: manualPageAssetMetadata(sourceNode.metadata, nextElements, input)
  });
}

function manualPageElement(input: PersistManualPageElementInput, targetNode?: BusinessNode): Record<string, unknown> {
  const region = parseImageRegionLocator(input.locator);
  return {
    id: input.elementId ?? manualPageElementId(input),
    label: input.elementLabel || input.locator,
    ...(input.targetText ? { targetText: input.targetText } : {}),
    locator: input.locator,
    ...(input.locatorKind ? { locatorKind: input.locatorKind } : {}),
    semanticArea: input.semanticArea ?? (region ? semanticAreaForRegion(region) : undefined),
    coordinateSpace: input.coordinateSpace ?? (region ? "screen" : undefined),
    action: input.actionKind,
    actionKind: input.actionKind,
    ...(input.abilityType ? { abilityType: input.abilityType } : {}),
    availability: input.availability,
    ...(region ? { region } : {}),
    ...(input.tapPointPercent ? { tapPointPercent: input.tapPointPercent } : {}),
    ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : targetNode ? { targetNodeId: targetNode.id } : {}),
    ...("targetLabel" in input && input.targetLabel ? { targetLabel: input.targetLabel } : targetNode ? { targetLabel: targetNode.name } : {}),
    ...("outcomeType" in input ? { outcomeType: input.outcomeType } : {}),
    ...("outcomeLabel" in input && input.outcomeLabel ? { outcomeLabel: input.outcomeLabel } : {}),
    platformScope: input.platformScope ?? "android",
    ...(input.scrollProfile ? { scrollProfile: input.scrollProfile } : {}),
    ...(input.compoundSteps?.length ? { compoundSteps: input.compoundSteps, compoundSignature: compoundStepsSignature(input.compoundSteps) } : {}),
    ...(input.quality ? { quality: input.quality } : {}),
    ...(input.visualLocator ? { visualLocator: input.visualLocator } : {}),
    ...(input.structuralLocator ? { structuralLocator: input.structuralLocator } : {}),
    ...(input.dynamicMasks?.length ? { dynamicMasks: input.dynamicMasks } : {}),
    ...(input.dynamicRegion?.id ? { dynamicRegionId: input.dynamicRegion.id } : {}),
    ...(input.itemTemplate?.id ? { itemTemplateId: input.itemTemplate.id } : input.dynamicRegion?.itemTemplateId ? { itemTemplateId: input.dynamicRegion.itemTemplateId } : {}),
    ...(input.transitionKind ? { transitionKind: input.transitionKind } : {}),
    ...(input.parameterMapping ? { parameterMapping: input.parameterMapping } : {})
  };
}

function manualPageAssetMetadata(
  currentMetadata: Record<string, unknown> | undefined,
  nextElements: Record<string, unknown>[],
  input: Pick<PersistManualPageElementInput, "dynamicRegion" | "itemTemplate">
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(currentMetadata ?? {}),
    assetRecordingManualElements: nextElements,
    updatedAt: nowIso()
  };
  if (input.dynamicRegion) {
    metadata.assetRecordingDynamicRegions = upsertRecordByStableId(
      readRecordArray(currentMetadata?.assetRecordingDynamicRegions),
      input.dynamicRegion
    );
  }
  if (input.itemTemplate) {
    metadata.assetRecordingItemTemplates = upsertRecordByStableId(
      readRecordArray(currentMetadata?.assetRecordingItemTemplates),
      input.itemTemplate
    );
  }
  return metadata;
}

function upsertRecordByStableId(existing: Record<string, unknown>[], next: Record<string, unknown> & { id?: string }): Record<string, unknown>[] {
  const nextId = typeof next.id === "string" ? next.id : undefined;
  if (!nextId) {
    return [...existing, next];
  }
  return [
    ...existing.filter((item) => item.id !== nextId),
    next
  ];
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function upsertManualPageElement(
  existingElements: Array<Record<string, unknown> & { locator?: unknown; actionKind?: unknown; compoundSignature?: unknown }>,
  nextElement: Record<string, unknown>
): Record<string, unknown>[] {
  return [
    ...existingElements.filter((element) => {
      if (manualPageElementMatchesForUpsert(element, nextElement)) {
        return false;
      }
      return true;
    }),
    {
      ...existingElements.find((element) => manualPageElementMatchesForUpsert(element, nextElement)),
      ...nextElement
    }
  ];
}

function manualPageElementMatchesForUpsert(
  existing: Record<string, unknown> & { locator?: unknown; actionKind?: unknown; compoundSignature?: unknown },
  next: Record<string, unknown>
): boolean {
  if (existing.id && next.id && existing.id === next.id) {
    return true;
  }
  if (existing.locator === next.locator && existing.actionKind === next.actionKind && existing.compoundSignature === next.compoundSignature) {
    return true;
  }
  return Boolean(
    existing.label &&
      next.label &&
      existing.label === next.label &&
      existing.actionKind === next.actionKind &&
      existing.compoundSignature === next.compoundSignature &&
      manualPageElementRegionsRepresentSameTarget(existing, next)
  );
}

function manualPageElementRegionsRepresentSameTarget(existing: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const existingRegion = readManualPageElementRegion(existing);
  const nextRegion = readManualPageElementRegion(next);
  return Boolean(existingRegion && nextRegion && rectsRepresentSameMarkedTarget(existingRegion, nextRegion));
}

function readManualPageElementRegion(record: Record<string, unknown>): { x: number; y: number; width: number; height: number } | undefined {
  const region = record.region;
  if (region && typeof region === "object" && !Array.isArray(region)) {
    const value = region as Record<string, unknown>;
    if (
      typeof value.x === "number" &&
      typeof value.y === "number" &&
      typeof value.width === "number" &&
      typeof value.height === "number" &&
      value.width > 0 &&
      value.height > 0
    ) {
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    }
  }
  return typeof record.locator === "string" ? parseImageRegionLocator(record.locator) : undefined;
}

function rectsRepresentSameMarkedTarget(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const minArea = Math.max(1, Math.min(left.width * left.height, right.width * right.height));
  return overlapArea / minArea >= 0.45 || rectCenterInside(left, right) || rectCenterInside(right, left);
}

function rectCenterInside(
  rect: { x: number; y: number; width: number; height: number },
  container: { x: number; y: number; width: number; height: number }
): boolean {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return centerX >= container.x && centerX <= container.x + container.width && centerY >= container.y && centerY <= container.y + container.height;
}

function readManualPageElements(value: unknown): Array<Record<string, unknown> & { locator?: unknown; actionKind?: unknown; compoundSignature?: unknown }> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function readPageTaskSummaries(value: unknown): Array<{ id: string; name: string; status?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): { id: string; name: string; status?: string } | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const status = typeof record.status === "string" ? record.status : undefined;
      return id && name ? { id, name, status } : undefined;
    })
    .filter((item): item is { id: string; name: string; status?: string } => Boolean(item));
}

function manualPageElementId(input: Pick<PersistManualPageElementInput, "actionKind" | "locator" | "compoundSteps">): string {
  return `manual_element_${slug(`${input.actionKind}.${input.locator}.${compoundStepsSignature(input.compoundSteps)}`).slice(0, 72) || "unknown"}`;
}

function edgeStatusFor(input: PersistManualPageTransitionInput): OperationEdge["status"] {
  return input.outcomeType === "navigate" || input.outcomeType === "compound_navigation" ? "active" : "draft";
}

function isConfirmedPageAsset(node: BusinessNode | undefined): node is BusinessNode {
  if (!node || node.status === "deprecated") {
    return false;
  }
  return Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset") || node.tags.includes("asset-recording");
}

function manualTransitionKey(sourceKey: string, targetKey: string, actionKind: string, locator: string, compoundSignature?: string): string {
  return `manual.${slug(sourceKey)}.${slug(targetKey)}.${slug(actionKind)}.${slug(locator).slice(0, 48)}${compoundSignature ? `.${slug(compoundSignature).slice(0, 40)}` : ""}`;
}

function pageTaskNavigationTransitionKey(sourceKey: string, targetKey: string, taskId: string): string {
  return `task.${slug(sourceKey)}.${slug(targetKey)}.${slug(taskId).slice(0, 64)}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown";
}

function buildPageTaskNavigationAction(input: { taskId: string; taskName: string; createdAt: string }): ActionStep {
  return {
    id: createId("step"),
    order: 1,
    type: "wait",
    enabled: true,
    title: `执行页面任务：${input.taskName}`,
    params: {
      taskId: input.taskId,
      taskMode: "source_page_navigation",
      pageTaskName: input.taskName
    },
    createdAt: input.createdAt
  };
}

function buildManualTransitionAction(input: PersistManualPageTransitionInput, createdAt: string): ActionStep {
  return {
    id: createId("step"),
    order: 1,
    type: actionTypeFor(input),
    enabled: true,
    title: `${actionVerb(input.actionKind)}：${input.elementLabel || input.locator}`,
    params: {
      ...locatorParams(input.locator),
      locator: input.locator,
      semanticArea: input.semanticArea ?? semanticAreaForLocator(input.locator),
      coordinateSpace: input.coordinateSpace ?? (input.locator.startsWith("image-region:") ? "screen" : undefined),
      elementLabel: input.elementLabel,
      availability: input.availability,
      ...(input.abilityType ? { abilityType: input.abilityType } : {}),
      outcomeType: input.outcomeType,
      targetLabel: input.targetLabel,
      ...manualAbilityActionParams(input),
      ...(input.compoundSteps?.length ? { compoundSteps: compoundActionSteps(input.compoundSteps, createdAt) } : {}),
      ...(input.scrollProfile ? { scrollProfile: input.scrollProfile } : {})
    },
    createdAt
  };
}

function compoundActionSteps(steps: ManualPageTransitionCompoundStep[], createdAt: string): ActionStep[] {
  return steps.map((step, index) => ({
    id: createId("compound_step"),
    order: index + 2,
    type: compoundActionTypeFor(step),
    enabled: true,
    title: step.elementLabel || `${actionVerb(step.actionKind === "wait" ? "tap" : step.actionKind)}：${step.locator}`,
    params: {
      ...locatorParams(step.locator),
      locator: step.locator,
      semanticArea: step.semanticArea ?? semanticAreaForLocator(step.locator),
      coordinateSpace: step.coordinateSpace ?? (step.locator.startsWith("image-region:") ? "screen" : undefined),
      elementLabel: step.elementLabel,
      ...(step.actionKind === "wait" ? { timeoutMs: step.waitTimeoutMs ?? 3000, intervalMs: step.intervalMs ?? 250 } : {}),
      ...(step.locator.startsWith("image-region:") && step.elementLabel ? { targetText: step.elementLabel } : {})
    },
    createdAt
  }));
}

function compoundActionTypeFor(step: ManualPageTransitionCompoundStep): ActionStep["type"] {
  if (step.actionKind === "wait") {
    return "wait_until_state";
  }
  return actionTypeForLocator(step.actionKind, step.locator);
}

function manualAbilityActionParams(input: PersistManualPageTransitionInput): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...(input.semanticArea ? { semanticArea: input.semanticArea } : input.locator.startsWith("image-region:") ? { semanticArea: semanticAreaForLocator(input.locator) } : {}),
    ...(input.coordinateSpace ? { coordinateSpace: input.coordinateSpace } : input.locator.startsWith("image-region:") ? { coordinateSpace: "screen" } : {}),
    ...(input.locatorKind ? { locatorKind: input.locatorKind } : {}),
    ...(input.structuralLocator ? { structuralLocator: input.structuralLocator } : {}),
    ...(input.dynamicMasks?.length ? { dynamicMasks: input.dynamicMasks } : {}),
    ...(input.dynamicRegion?.id ? { dynamicRegionId: input.dynamicRegion.id } : {}),
    ...(input.itemTemplate?.id ? { itemTemplateId: input.itemTemplate.id } : input.dynamicRegion?.itemTemplateId ? { itemTemplateId: input.dynamicRegion.itemTemplateId } : {}),
    ...(input.transitionKind ? { transitionKind: input.transitionKind } : {}),
    ...(input.parameterMapping ? { parameterMapping: input.parameterMapping } : {})
  };
  const targetText = input.targetText?.trim();
  if ((input.locator.startsWith("image-region:") || input.locator.startsWith("runtime-locator:")) && input.abilityType !== "grid_candidate" && targetText) {
    base.targetText = targetText;
  }
  if (input.locator.startsWith("image-region:") && input.tapPointPercent) {
    base.tapPointPercent = input.tapPointPercent;
  }
  if (input.locator.startsWith("image-region:") && input.visualLocator) {
    base.visualLocator = input.visualLocator;
  }
  if (input.abilityType !== "grid_candidate" || input.scrollProfile?.containerKind !== "grid_list") {
    return base;
  }
  const columns = Math.max(1, Math.floor(input.scrollProfile.columns ?? 1));
  const candidateHeight = input.scrollProfile.candidateItemHeightPercent;
  const clickSafePoint = input.scrollProfile.clickSafePoint;
  if (!candidateHeight || !clickSafePoint) {
    return base;
  }
  return {
    ...base,
    candidateIndex: 0,
    maxCandidateAttempts: maxCandidateAttemptsForGrid(input.scrollProfile),
    tapPointPercent: {
      x: roundPercent(clickSafePoint.xPercent / columns),
      y: roundPercent((candidateHeight * clickSafePoint.yPercent) / 100)
    }
  };
}

function maxCandidateAttemptsForGrid(scrollProfile: ManualPageTransitionScrollProfile): number {
  const columns = Math.max(1, Math.floor(scrollProfile.columns ?? 1));
  const candidateHeight = scrollProfile.candidateItemHeightPercent;
  if (!candidateHeight || candidateHeight <= 0) {
    return columns;
  }
  return Math.max(columns, Math.floor(100 / candidateHeight) * columns);
}

function semanticAreaForLocator(locator: string): PersistManualPageTransitionInput["semanticArea"] | undefined {
  const region = parseImageRegionLocator(locator);
  return region ? semanticAreaForRegion(region) : undefined;
}

function semanticAreaForRegion(region: { x: number; y: number; width: number; height: number }): NonNullable<PersistManualPageTransitionInput["semanticArea"]> {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function actionTypeFor(input: PersistManualPageTransitionInput): ActionStep["type"] {
  if (input.abilityType === "grid_candidate" && input.locator.startsWith("image-region:")) {
    return "tap_on_image";
  }
  return actionTypeForLocator(input.actionKind, input.locator);
}

function actionTypeForLocator(actionKind: ManualPageTransitionActionKind, locator: string): ActionStep["type"] {
  if (actionKind === "scroll") {
    return "scroll_until_visible";
  }
  if (actionKind === "long_press") {
    return "long_press";
  }
  if (actionKind === "input") {
    return "input_text_to_element";
  }
  if (locator.startsWith("runtime-locator:")) {
    return "tap_on_image";
  }
  if (locator.startsWith("image-region:")) {
    return "tap_on_image";
  }
  if (locator.startsWith("resource-id:") || locator.startsWith("accessibility/desc:")) {
    return "tap_on_element";
  }
  return "tap_on_text";
}

function manualActionDescriptor(edge: OperationEdge): { locator: string; actionKind: ManualPageTransitionActionKind; compoundSignature?: string } | undefined {
  const action = edge.actionPolicies[0]?.action;
  const locator = typeof action?.params?.locator === "string" ? action.params.locator : undefined;
  if (!locator) {
    return undefined;
  }
  return {
    locator,
    actionKind: actionKindForActionType(action.type),
    compoundSignature: compoundStepsSignature(readActionCompoundSteps(action.params?.compoundSteps))
  };
}

function readActionCompoundSteps(value: unknown): ManualPageTransitionCompoundStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const steps = value
    .map((item): ManualPageTransitionCompoundStep | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const input = item as ActionStep;
      const locator = typeof input.params?.locator === "string" ? input.params.locator : undefined;
      if (!locator) {
        return undefined;
      }
      return {
        actionKind: input.type === "wait_until_state" ? "wait" : actionKindForActionType(input.type),
        locator,
        elementLabel: typeof input.params?.elementLabel === "string" ? input.params.elementLabel : input.title ?? locator,
        semanticArea: readStoredSemanticArea(input.params?.semanticArea),
        coordinateSpace: readStoredCoordinateSpace(input.params?.coordinateSpace)
      };
    })
    .filter((item): item is ManualPageTransitionCompoundStep => Boolean(item));
  return steps.length ? steps : undefined;
}

function readStoredSemanticArea(value: unknown): ManualPageTransitionCompoundStep["semanticArea"] {
  return value === "top" || value === "content" || value === "bottom" || value === "unknown" ? value : undefined;
}

function readStoredCoordinateSpace(value: unknown): ManualPageTransitionCompoundStep["coordinateSpace"] {
  return value === "screen" || value === "app_viewport" || value === "region" || value === "runtime" ? value : undefined;
}

function compoundStepsSignature(steps: ManualPageTransitionCompoundStep[] | undefined): string | undefined {
  if (!steps?.length) {
    return undefined;
  }
  return steps
    .map((step) => `${step.actionKind}:${step.locator}:${step.elementLabel}`)
    .join(">");
}

function actionKindForActionType(actionType: string): ManualPageTransitionActionKind {
  if (actionType === "scroll_until_visible") {
    return "scroll";
  }
  if (actionType === "long_press") {
    return "long_press";
  }
  if (actionType === "input_text_to_element") {
    return "input";
  }
  return "tap";
}

function locatorParams(locator: string): Record<string, unknown> {
  if (locator.startsWith("resource-id:")) {
    const resourceId = locator.replace(/^resource-id:\s*/, "").trim();
    return { resourceId, selector: `id=${resourceId}` };
  }
  if (locator.startsWith("accessibility/desc:")) {
    const accessibilityId = locator.replace(/^accessibility\/desc:\s*/, "").trim();
    return { accessibilityId, contentDesc: accessibilityId };
  }
  if (locator.startsWith("text:")) {
    return { text: locator.replace(/^text:\s*/, "").trim() };
  }
  if (locator.startsWith("image-region:")) {
    const region = parseImageRegionLocator(locator);
    return region ? { region, targetMode: "image_region" } : { targetMode: "image_region" };
  }
  return {};
}

function parseImageRegionLocator(locator: string): { x: number; y: number; width: number; height: number } | undefined {
  const parts = locator
    .replace(/^image-region:\s*/, "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function manualActionPolicy(action: ActionStep, reliabilityScore: number, input: PersistManualPageTransitionInput, createdAt: string): ActionPolicy {
  return {
    id: createId("action_policy"),
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: reliabilityScore >= 0.85 ? "high" : reliabilityScore >= 0.7 ? "medium" : "low",
    source: {
      sourceType: "manual_edit",
      confidence: reliabilityScore
    }
  };
}

function taskNavigationActionPolicy(action: ActionStep, reliabilityScore: number): ActionPolicy {
  return {
    id: createId("action_policy"),
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: "high",
    source: {
      sourceType: "manual_edit",
      confidence: reliabilityScore
    }
  };
}

function stateExpectation(node: BusinessNode, prefix: string, outcomeType: ManualPageTransitionOutcomeType, createdAt: string): StepExpectation {
  return {
    id: createId("expectation"),
    type: "state_is",
    enabled: true,
    title: `${prefix}：${node.name}`,
    params: {
      nodeId: node.id,
      nodeKey: node.key,
      nodeName: node.name,
      matcherCount: node.matchers.length,
      criticalMatcherCount: node.matchers.filter((matcher) => matcher.critical).length,
      outcomeType
    },
    createdAt
  };
}

function reliabilityScoreForManualTransition(input: PersistManualPageTransitionInput): number {
  if (input.locator.startsWith("resource-id:") || input.locator.startsWith("accessibility/desc:")) {
    return 0.9;
  }
  if (input.locator.startsWith("text:") || input.locator.startsWith("image-region:")) {
    return input.availability === "visible" ? 0.82 : 0.74;
  }
  if (input.actionKind === "scroll") {
    return 0.72;
  }
  return 0.65;
}

function actionVerb(actionKind: ManualPageTransitionActionKind): string {
  if (actionKind === "scroll") {
    return "滑动";
  }
  if (actionKind === "long_press") {
    return "长按";
  }
  if (actionKind === "input") {
    return "输入";
  }
  return "点击";
}
