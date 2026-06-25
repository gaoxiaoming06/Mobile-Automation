import type { ActionPolicy, BusinessGraphVersion, BusinessNode, OperationEdge, PlatformScope, RoutePlanIssue } from "@mobile-automation/graph-core";
import { createId, nowIso, type ActionStep } from "@mobile-automation/shared";

type ManualPageAbilityElement = {
  id?: string;
  label?: string;
  targetText?: string;
  locator?: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region";
  actionKind?: "tap" | "scroll" | "long_press" | "input";
  abilityType?: "scroll_candidate" | "grid_candidate" | "conditional_tap";
  availability?: "visible" | "after_scroll" | "conditional";
  outcomeType?: "navigate" | "compound_navigation" | "show_inline_state" | "local_state_change" | "no_visible_change";
  targetNodeId?: string;
  targetLabel?: string;
  platformScope?: PlatformScope;
  scrollProfile?: {
    containerKind?: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
    direction?: "vertical" | "horizontal";
    columns?: number;
    targetKind?: "item_text" | "ocr_text" | "semantic_label" | "nth_item" | "image_region";
    targetQuery?: string;
    afterFoundAction?: "tap_item" | "tap_child" | "verify_visible";
    candidateItemHeightPercent?: number;
    clickSafePoint?: {
      xPercent: number;
      yPercent: number;
    };
    scrollStepPercent?: number;
    failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
  };
  compoundSteps?: Array<{
    actionKind?: "tap" | "scroll" | "long_press" | "input" | "wait";
    locator?: string;
    elementLabel?: string;
    semanticArea?: "top" | "content" | "bottom" | "unknown";
    coordinateSpace?: "screen" | "app_viewport" | "region";
    waitTimeoutMs?: number;
    intervalMs?: number;
  }>;
};

export function withPageAbilityEdges(graphVersion: BusinessGraphVersion, platform: PlatformScope = "android"): BusinessGraphVersion {
  const existingEdgeKeys = new Set(graphVersion.edges.map((edge) => edge.key));
  const abilityEdges = graphVersion.nodes.flatMap((node) => pageAbilityEdgesForNode(graphVersion, node, platform, existingEdgeKeys));
  for (const edge of abilityEdges) {
    existingEdgeKeys.add(edge.key);
  }
  const homeTabEdges = homeTabEdgesForGraph(graphVersion, platform, existingEdgeKeys);
  if (!abilityEdges.length && !homeTabEdges.length) {
    return graphVersion;
  }
  return {
    ...graphVersion,
    edges: [...graphVersion.edges, ...abilityEdges, ...homeTabEdges]
  };
}

export function pageAbilityRouteGapIssues(
  graphVersion: BusinessGraphVersion,
  platform: PlatformScope = "android",
  options: { startNodeId?: string } = {}
): RoutePlanIssue[] {
  return graphVersion.nodes
    .filter((node) => !options.startNodeId || node.id === options.startNodeId)
    .flatMap((node) =>
      readManualElements(node)
        .filter((element) => isPotentialRouteAbility(element, platform))
        .map((element) => pageAbilityRouteGapIssue(graphVersion, node, element))
        .filter((issue): issue is RoutePlanIssue => Boolean(issue))
    );
}

function pageAbilityEdgesForNode(
  graphVersion: BusinessGraphVersion,
  sourceNode: BusinessNode,
  platform: PlatformScope,
  existingEdgeKeys: Set<string>
): OperationEdge[] {
  return readManualElements(sourceNode)
    .filter((element) => isNavigablePageAbility(element, platform))
    .map((element) => pageAbilityEdge(graphVersion, sourceNode, element, platform))
    .filter((edge): edge is OperationEdge => Boolean(edge))
    .filter((edge) => !existingEdgeKeys.has(edge.key));
}

type HomeTabSpec = {
  key: string;
  label: string;
  aliases: string[];
  region: { x: number; y: number; width: number; height: number };
};

const HOME_TAB_SPECS: HomeTabSpec[] = [
  { key: "home", label: "主页", aliases: ["主页", "首页"], region: { x: 0, y: 91, width: 16.67, height: 8 } },
  { key: "message", label: "消息", aliases: ["消息"], region: { x: 16.67, y: 91, width: 16.67, height: 8 } },
  { key: "todo", label: "待办", aliases: ["待办"], region: { x: 33.34, y: 91, width: 16.67, height: 8 } },
  { key: "schedule", label: "课程表", aliases: ["课程表"], region: { x: 50.01, y: 91, width: 16.67, height: 8 } },
  { key: "space", label: "空间", aliases: ["空间", "控件"], region: { x: 66.68, y: 91, width: 16.67, height: 8 } },
  { key: "growth", label: "成长", aliases: ["成长"], region: { x: 83.35, y: 91, width: 16.65, height: 8 } }
];

function homeTabEdgesForGraph(
  graphVersion: BusinessGraphVersion,
  platform: PlatformScope,
  existingEdgeKeys: Set<string>
): OperationEdge[] {
  const activeNodes = graphVersion.nodes.filter((item) => item.status === "active" && supportsPlatform(item.platformScope, platform));
  const tabNodes = HOME_TAB_SPECS.flatMap((spec) => {
    const node = activeNodes
      .filter((item) => isHomeTabNode(item, spec))
      .sort((a, b) => homeTabNodeScore(b, spec) - homeTabNodeScore(a, spec) || a.name.localeCompare(b.name))[0];
    return node ? [{ spec, node }] : [];
  });
  if (tabNodes.length < 2) {
    return [];
  }
  return tabNodes.flatMap((source) =>
    tabNodes
      .filter((target) => target.node.id !== source.node.id)
      .map((target) => homeTabEdge(graphVersion, source.node, target.node, target.spec, platform))
      .filter((edge) => !existingEdgeKeys.has(edge.key))
      .map((edge) => {
        existingEdgeKeys.add(edge.key);
        return edge;
      })
  );
}

function homeTabNodeScore(node: BusinessNode, spec: HomeTabSpec): number {
  const nodeName = normalize(node.name);
  const nodeKey = normalize(node.key);
  const tags = new Set(node.tags.map((tag) => normalize(tag)));
  const metadata = node.metadata ?? {};
  const pageName = typeof metadata.pageName === "string" ? normalize(metadata.pageName) : "";
  const visualPageName = typeof metadata.visualPageName === "string" ? normalize(metadata.visualPageName) : "";
  const aliases = spec.aliases.map(normalize);
  let score = 0;
  if (tags.has("page-asset") || tags.has("asset-recording")) {
    score += 20;
  }
  if (tags.has(`bottom-tab:${spec.key}`)) {
    score += 16;
  }
  if (tags.has(spec.key)) {
    score += 10;
  }
  if (aliases.includes(nodeName)) {
    score += 14;
  }
  if (aliases.includes(pageName) || aliases.includes(visualPageName)) {
    score += 12;
  }
  if (nodeKey.endsWith(`.${spec.key}`)) {
    score += 6;
  }
  return score;
}

function isHomeTabNode(node: BusinessNode, spec: HomeTabSpec): boolean {
  const nodeName = normalize(node.name);
  const nodeKey = normalize(node.key);
  const tags = new Set(node.tags.map((tag) => normalize(tag)));
  const metadata = node.metadata ?? {};
  const pageName = typeof metadata.pageName === "string" ? normalize(metadata.pageName) : "";
  const visualPageName = typeof metadata.visualPageName === "string" ? normalize(metadata.visualPageName) : "";
  return (
    tags.has(`bottom-tab:${spec.key}`) ||
    tags.has(spec.key) ||
    spec.aliases.some((alias) => {
      const normalizedAlias = normalize(alias);
      return nodeName === normalizedAlias || pageName === normalizedAlias || visualPageName === normalizedAlias || nodeKey.endsWith(`.${spec.key}`);
    })
  );
}

function homeTabEdge(
  graphVersion: BusinessGraphVersion,
  sourceNode: BusinessNode,
  targetNode: BusinessNode,
  targetSpec: HomeTabSpec,
  platform: PlatformScope
): OperationEdge {
  const edgeKey = `system.home-tab.${slug(sourceNode.key)}.${slug(targetNode.key)}`;
  return {
    id: `edge_${edgeKey}`,
    graphVersionId: graphVersion.id,
    fromNodeId: sourceNode.id,
    toNodeId: targetNode.id,
    key: edgeKey,
    name: `${sourceNode.name} -> ${targetNode.name}`,
    intent: `切换底部 Tab：${targetSpec.label}`,
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: [homeTabActionPolicy(targetSpec)],
    expectations: [],
    failurePolicy: { retryCount: 1, recoverTo: "replan" },
    platformScope: platform,
    reliabilityScore: 0.86
  };
}

function homeTabActionPolicy(targetSpec: HomeTabSpec): ActionPolicy {
  const action: ActionStep = {
    id: createId("step"),
    order: 1,
    enabled: true,
    type: "tap_on_image",
    title: `点击底部 Tab：${targetSpec.label}`,
    params: {
      region: targetSpec.region,
      targetMode: "image_region",
      locator: `image-region:${targetSpec.region.x},${targetSpec.region.y},${targetSpec.region.width},${targetSpec.region.height}`,
      elementLabel: targetSpec.label,
      targetText: targetSpec.label,
      semanticArea: "bottom",
      coordinateSpace: "screen",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: targetSpec.label
    },
    createdAt: nowIso()
  };
  return {
    id: createId("action_policy"),
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: "high",
    source: {
      sourceType: "manual_edit",
      confidence: 0.86
    }
  };
}

function readManualElements(sourceNode: BusinessNode): ManualPageAbilityElement[] {
  const elements = sourceNode.metadata?.assetRecordingManualElements;
  return Array.isArray(elements) ? elements.filter((item): item is ManualPageAbilityElement => Boolean(item) && typeof item === "object") : [];
}

function isNavigablePageAbility(element: ManualPageAbilityElement, platform: PlatformScope): boolean {
  return (
    Boolean(element.locator) &&
    Boolean(element.targetNodeId) &&
    (element.outcomeType === "navigate" || element.outcomeType === "compound_navigation") &&
    (element.platformScope === undefined || element.platformScope === platform || element.platformScope === "mobile-both")
  );
}

function isPotentialRouteAbility(element: ManualPageAbilityElement, platform: PlatformScope): boolean {
  return (
    Boolean(element.locator) &&
    (element.outcomeType === "navigate" || element.outcomeType === "compound_navigation") &&
    (element.platformScope === undefined || element.platformScope === platform || element.platformScope === "mobile-both")
  );
}

function pageAbilityRouteGapIssue(
  graphVersion: BusinessGraphVersion,
  sourceNode: BusinessNode,
  element: ManualPageAbilityElement
): RoutePlanIssue | undefined {
  const label = element.label ?? element.locator ?? "未命名能力";
  if (!element.targetNodeId) {
    return {
      code: "PAGE_ABILITY_TARGET_MISSING",
      severity: "error",
      nodeId: sourceNode.id,
      message: `页面「${sourceNode.name}」的可操作能力「${label}」是跳转页面，但还没有绑定目标页面；它不会进入路径规划。`
    };
  }
  if (!graphVersion.nodes.some((node) => node.id === element.targetNodeId)) {
    return {
      code: "PAGE_ABILITY_TARGET_NOT_FOUND",
      severity: "error",
      nodeId: sourceNode.id,
      message: `页面「${sourceNode.name}」的可操作能力「${label}」绑定的目标页面不存在：${element.targetNodeId}。`
    };
  }
  return undefined;
}

function pageAbilityEdge(
  graphVersion: BusinessGraphVersion,
  sourceNode: BusinessNode,
  element: ManualPageAbilityElement,
  platform: PlatformScope
): OperationEdge | undefined {
  const targetNode = graphVersion.nodes.find((node) => node.id === element.targetNodeId);
  if (!targetNode || !element.locator) {
    return undefined;
  }
  const action = pageAbilityAction(element);
  const edgeKey = `pageability.${slug(sourceNode.key)}.${slug(targetNode.key)}.${slug(element.id ?? element.locator)}`;
  return {
    id: `edge_${edgeKey}`,
    graphVersionId: graphVersion.id,
    fromNodeId: sourceNode.id,
    toNodeId: targetNode.id,
    key: edgeKey,
    name: `${sourceNode.name} -> ${targetNode.name}`,
    intent: `${actionVerb(element.actionKind)}：${element.label ?? element.locator}`,
    status: "active",
    source: "manual_edit",
    preconditions: [],
    actionPolicies: [pageAbilityActionPolicy(action)],
    expectations: [],
    failurePolicy: element.abilityType === "grid_candidate" ? { retryCount: 0, recoverTo: "replan" } : { retryCount: 1, recoverTo: "replan" },
    platformScope: element.platformScope ?? platform,
    reliabilityScore: element.abilityType === "grid_candidate" ? 0.74 : 0.8
  };
}

function pageAbilityAction(element: ManualPageAbilityElement): ActionStep {
  const locator = element.locator ?? "";
  const actionKind = element.actionKind ?? "tap";
  const actionType = element.abilityType === "grid_candidate" && locator.startsWith("image-region:")
    ? "tap_on_image"
    : actionTypeFor(actionKind, locator);
  return {
    id: createId("step"),
    order: 1,
    type: actionType,
    enabled: true,
    title: `${actionVerb(actionKind)}：${element.label ?? locator}`,
    params: {
      ...locatorParams(locator),
      locator,
      elementLabel: element.label,
      availability: element.availability,
      outcomeType: element.outcomeType,
      targetLabel: element.targetLabel,
      ...(element.abilityType ? { abilityType: element.abilityType } : {}),
      ...abilityActionParams(element),
      ...(element.compoundSteps?.length ? { compoundSteps: compoundActionSteps(element.compoundSteps) } : {}),
      ...(element.scrollProfile ? { scrollProfile: element.scrollProfile } : {})
    },
    createdAt: nowIso()
  };
}

function compoundActionSteps(steps: NonNullable<ManualPageAbilityElement["compoundSteps"]>): ActionStep[] {
  return steps
    .filter((step) => step.locator)
    .map((step, index) => {
      const locator = step.locator ?? "";
      const actionKind = step.actionKind ?? "tap";
      return {
        id: createId("compound_step"),
        order: index + 2,
        type: actionKind === "wait" ? "wait_until_state" : actionTypeFor(actionKind, locator),
        enabled: true,
        title: step.elementLabel || locator,
        params: {
          ...locatorParams(locator),
          locator,
          semanticArea: step.semanticArea ?? semanticAreaForLocator(locator),
          coordinateSpace: step.coordinateSpace ?? (locator.startsWith("image-region:") ? "screen" : undefined),
          elementLabel: step.elementLabel,
          ...(actionKind === "wait" ? { timeoutMs: step.waitTimeoutMs ?? 3000, intervalMs: step.intervalMs ?? 250 } : {}),
          ...(locator.startsWith("image-region:") && step.elementLabel ? { targetText: step.elementLabel } : {})
        },
        createdAt: nowIso()
      } satisfies ActionStep;
    });
}

function pageAbilityActionPolicy(action: ActionStep): ActionPolicy {
  return {
    id: createId("action_policy"),
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: "medium",
    source: {
      sourceType: "manual_edit",
      confidence: 0.78
    }
  };
}

function actionTypeFor(actionKind: NonNullable<ManualPageAbilityElement["actionKind"]>, locator: string): ActionStep["type"] {
  if (actionKind === "scroll") {
    return "scroll_until_visible";
  }
  if (actionKind === "long_press") {
    return "long_press";
  }
  if (actionKind === "input") {
    return "input_text_to_element";
  }
  if (locator.startsWith("image-region:")) {
    return "tap_on_image";
  }
  if (locator.startsWith("resource-id:") || locator.startsWith("accessibility/desc:")) {
    return "tap_on_element";
  }
  return "tap_on_text";
}

function locatorParams(locator: string): Record<string, unknown> {
  if (locator.startsWith("resource-id:")) {
    const resourceId = locator.replace(/^resource-id:\s*/, "").trim();
    return { resourceId, selector: `id=${resourceId}` };
  }
  if (locator.startsWith("accessibility/desc:")) {
    const accessibilityId = locator.replace(/^accessibility\/desc:\s*/, "").trim();
    return { accessibilityId };
  }
  if (locator.startsWith("text:")) {
    return { text: locator.replace(/^text:\s*/, "").trim() };
  }
  if (locator.startsWith("image-region:")) {
    const region = parseImageRegionLocator(locator);
    return region
      ? {
          region,
          targetMode: "image_region",
          semanticArea: semanticAreaForRegion(region),
          coordinateSpace: "screen"
        }
      : { targetMode: "image_region", coordinateSpace: "screen" };
  }
  return {};
}

function abilityActionParams(element: ManualPageAbilityElement): Record<string, unknown> {
  const semanticArea = element.semanticArea ?? semanticAreaForLocator(element.locator ?? "");
  const targetText = stringValue(element.targetText).trim() || stringValue(element.label).trim();
  const base: Record<string, unknown> = {
    ...(semanticArea ? { semanticArea } : {}),
    ...(element.coordinateSpace ? { coordinateSpace: element.coordinateSpace } : {})
  };
  if (element.locator?.startsWith("image-region:") && element.abilityType !== "grid_candidate" && targetText) {
    base.targetText = targetText;
  }
  if (
    element.locator?.startsWith("image-region:") &&
    element.abilityType !== "grid_candidate" &&
    semanticArea === "content" &&
    element.outcomeType === "navigate" &&
    (targetText || element.availability === "after_scroll")
  ) {
    base.revealOnMissing = true;
    base.revealDirection = "up";
    base.revealMaxSwipes = 2;
  }
  if (element.abilityType !== "grid_candidate" || element.scrollProfile?.containerKind !== "grid_list") {
    return base;
  }
  const columns = Math.max(1, Math.floor(element.scrollProfile.columns ?? 1));
  const candidateHeight = element.scrollProfile.candidateItemHeightPercent;
  const clickSafePoint = element.scrollProfile.clickSafePoint;
  if (!candidateHeight || !clickSafePoint) {
    return base;
  }
  return {
    ...base,
    candidateIndex: 0,
    maxCandidateAttempts: maxCandidateAttemptsForGrid(element.scrollProfile),
    tapPointPercent: {
      x: roundPercent(clickSafePoint.xPercent / columns),
      y: roundPercent((candidateHeight * clickSafePoint.yPercent) / 100)
    }
  };
}

function maxCandidateAttemptsForGrid(scrollProfile: NonNullable<ManualPageAbilityElement["scrollProfile"]>): number {
  const columns = Math.max(1, Math.floor(scrollProfile.columns ?? 1));
  const candidateHeight = scrollProfile.candidateItemHeightPercent;
  if (!candidateHeight || candidateHeight <= 0) {
    return columns;
  }
  return Math.max(columns, Math.floor(100 / candidateHeight) * columns);
}

function semanticAreaForLocator(locator: string): NonNullable<ManualPageAbilityElement["semanticArea"]> | undefined {
  const region = parseImageRegionLocator(locator);
  return region ? semanticAreaForRegion(region) : undefined;
}

function semanticAreaForRegion(region: { x: number; y: number; width: number; height: number }): NonNullable<ManualPageAbilityElement["semanticArea"]> {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
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

function actionVerb(actionKind: ManualPageAbilityElement["actionKind"]): string {
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

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown";
}

function supportsPlatform(scope: PlatformScope | undefined, platform: PlatformScope): boolean {
  return scope === undefined || scope === "mobile-both" || scope === platform;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
