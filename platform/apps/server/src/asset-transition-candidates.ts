import {
  detectNode,
  type BusinessGraphVersion,
  type BusinessNode,
  type GraphTargetApp,
  type Observation,
  type OperationEdge,
  type StateMatcher
} from "@mobile-automation/graph-core";
import { createId, nowIso, type ActionStep, type StepExpectation } from "@mobile-automation/shared";
import { pageAssetOnlyGraphVersion, promoteParentPageLocalStateMatch } from "./page-matcher.js";
import { buildRuntimeUnknownNodeCandidate } from "./runtime-graph-candidate.js";

export type AssetTransitionCandidateWarning = {
  code: "COORDINATE_ONLY_ACTION" | "LOW_CONFIDENCE_NODE" | "OUTSIDE_TARGET_APP" | "INSUFFICIENT_OBSERVATION";
  message: string;
  stepId?: string;
};

export type AssetTransitionCandidateNodeResult = {
  status: "matched" | "created" | "reused" | "skipped";
  node?: BusinessNode;
  reason?: string;
};

export type AssetTransitionCandidateEdgeResult = {
  status: "created" | "reused" | "skipped";
  edge?: OperationEdge;
  reason?: string;
};

export type AssetTransitionCandidateResult = {
  from: AssetTransitionCandidateNodeResult;
  to: AssetTransitionCandidateNodeResult;
  edge: AssetTransitionCandidateEdgeResult;
  warnings: AssetTransitionCandidateWarning[];
};

export type AssetTransitionCandidateStorage = {
  findBusinessNodeByKey(graphVersionId: string, key: string): BusinessNode | undefined;
  createBusinessNode(input: Omit<BusinessNode, "id"> & { id?: string }): BusinessNode;
  updateBusinessNodeMetadata(nodeId: string, metadata: Record<string, unknown>): BusinessNode | undefined;
  updateBusinessNodeStatus(nodeId: string, status: BusinessNode["status"]): BusinessNode | undefined;
  findOperationEdgeByKey(graphVersionId: string, key: string): OperationEdge | undefined;
  createOperationEdge(input: Omit<OperationEdge, "id"> & { id?: string }): OperationEdge;
  updateOperationEdgeStatus(edgeId: string, status: OperationEdge["status"]): OperationEdge | undefined;
};

const LOCAL_PAGE_STATE_REASON = "动作后只识别到页面内菜单/弹窗等局部状态，暂不创建资产候选节点。";

export function persistAssetTransitionCandidate(input: {
  graphVersion: BusinessGraphVersion;
  storage: AssetTransitionCandidateStorage;
  beforeObservation: Observation;
  afterObservation: Observation;
  step: ActionStep;
  targetApp?: GraphTargetApp;
  confirm?: boolean;
}): AssetTransitionCandidateResult {
  const warnings: AssetTransitionCandidateWarning[] = [];
  const scopeViolation = validateAssetTransitionScope(input.beforeObservation, input.afterObservation, input.targetApp);
  if (scopeViolation) {
    warnings.push(scopeViolation);
    return skippedResult(scopeViolation.message, warnings);
  }
  const beforeSignalViolation = validateObservationHasStateSignal(input.beforeObservation, "动作前页面");
  if (beforeSignalViolation) {
    warnings.push(beforeSignalViolation);
    return skippedResult(beforeSignalViolation.message, warnings);
  }
  const afterSignalViolation = validateObservationHasStateSignal(input.afterObservation, "动作后页面");
  if (afterSignalViolation) {
    warnings.push(afterSignalViolation);
    return skippedResult(afterSignalViolation.message, warnings);
  }

  const actionReliability = actionReliabilityScore(input.step);
  if (actionReliability < 0.7) {
    warnings.push({
      code: "COORDINATE_ONLY_ACTION",
      message: "该动作只包含坐标，跨设备/跨分辨率稳定性不足，需补充文字、resource-id 或图像定位后才能自动转正。",
      stepId: input.step.id
    });
  }

  const from = identifyOrPersistAssetCandidateNode({
    graphVersion: input.graphVersion,
    storage: input.storage,
    observation: input.beforeObservation,
    role: "from",
    confirm: input.confirm === true
  });
  const to = identifyOrPersistAssetCandidateNode({
    graphVersion: input.graphVersion,
    storage: input.storage,
    observation: input.afterObservation,
    role: "to",
    confirm: input.confirm === true
  });
  if (from.node && to.status === "skipped" && to.reason === LOCAL_PAGE_STATE_REASON) {
    return {
      from,
      to,
      edge: {
        status: "skipped",
        reason: "动作后仍停留在同一页面，按页面内状态/局部变化处理，不生成 PageTransition。"
      },
      warnings
    };
  }
  if (!from.node || !to.node) {
    return skippedResult("本次资产候选没有可写入的前后业务节点。", warnings);
  }

  if (from.node.id === to.node.id) {
    return {
      from,
      to,
      edge: {
        status: "skipped",
        reason: "动作后仍停留在同一页面，按页面内状态/局部变化处理，不生成 PageTransition。"
      },
      warnings
    };
  }

  if (strongMatcherCount(from.node.matchers) === 0) {
    warnings.push({
      code: "LOW_CONFIDENCE_NODE",
      message: `前置节点「${from.node.name}」缺少强识别规则。`
    });
  }
  if (strongMatcherCount(to.node.matchers) === 0) {
    warnings.push({
      code: "LOW_CONFIDENCE_NODE",
      message: `后置节点「${to.node.name}」缺少强识别规则。`
    });
  }

  const shouldActivateEdge = input.confirm === true && actionReliability >= 0.7;
  const edge = persistAssetCandidateEdge({
    graphVersionId: input.graphVersion.id,
    storage: input.storage,
    fromNode: from.node,
    toNode: to.node,
    step: input.step,
    status: shouldActivateEdge ? "active" : "draft",
    reliabilityScore: actionReliability
  });

  return {
    from,
    to,
    edge,
    warnings
  };
}

function skippedResult(reason: string, warnings: AssetTransitionCandidateWarning[]): AssetTransitionCandidateResult {
  return {
    from: { status: "skipped", reason },
    to: { status: "skipped", reason },
    edge: { status: "skipped", reason },
    warnings
  };
}

function validateAssetTransitionScope(before: Observation, after: Observation, targetApp: GraphTargetApp | undefined): AssetTransitionCandidateWarning | undefined {
  const androidPackageName = targetApp?.androidPackageName?.trim();
  if (!androidPackageName || before.platform !== "android") {
    return undefined;
  }
  const beforePackage = observationPackageName(before);
  const afterPackage = observationPackageName(after);
  if (beforePackage && beforePackage !== androidPackageName) {
    return {
      code: "OUTSIDE_TARGET_APP",
      message: `动作前页面属于 ${beforePackage}，不是当前图谱绑定的 Android 包 ${androidPackageName}，本步骤不会写入该 App 图谱。`
    };
  }
  if (afterPackage && afterPackage !== androidPackageName) {
    return {
      code: "OUTSIDE_TARGET_APP",
      message: `动作后页面属于 ${afterPackage}，不是当前图谱绑定的 Android 包 ${androidPackageName}，本步骤不会写入该 App 图谱。`
    };
  }
  return undefined;
}

function validateObservationHasStateSignal(observation: Observation, label: string): AssetTransitionCandidateWarning | undefined {
  const packageName = observationPackageName(observation);
  const visibleTexts = observation.uiElements.some((element) => Boolean(element.text?.trim())) || observation.ocrTexts.some((text) => Boolean(text.text.trim()));
  const resourceIds = observation.uiElements.some((element) => Boolean(element.resourceId?.trim() || element.accessibilityId?.trim()));
  const routeSignals = Boolean(observation.activityName?.trim() || observation.routeName?.trim() || observation.fragments?.some((fragment) => fragment.trim()));
  if (packageName || visibleTexts || resourceIds || routeSignals) {
    return undefined;
  }
  return {
    code: "INSUFFICIENT_OBSERVATION",
    message: `${label}缺少 package、activity、resource-id、文字或 OCR 等有效状态信号，本步骤不会写入业务图谱。`
  };
}

function observationPackageName(observation: Observation): string | undefined {
  return observation.packageName?.trim() || observation.uiElements.map((element) => element.packageName?.trim()).find(Boolean);
}

function identifyOrPersistAssetCandidateNode(input: {
  graphVersion: BusinessGraphVersion;
  storage: AssetTransitionCandidateStorage;
  observation: Observation;
  role: "from" | "to";
  confirm: boolean;
}): AssetTransitionCandidateNodeResult {
  const pageGraphVersion = pageAssetOnlyGraphVersion(input.graphVersion);
  const match = promoteParentPageLocalStateMatch(detectNode(input.observation, pageGraphVersion, input.observation.platform), input.observation);
  if (match.status === "matched" && match.node) {
    return {
      status: "matched",
      node: match.node
    };
  }

  if (input.role === "to" && isLikelyLocalPageStateObservation(input.observation)) {
    return {
      status: "skipped",
      reason: LOCAL_PAGE_STATE_REASON
    };
  }

  const candidate = buildRuntimeUnknownNodeCandidate(input.graphVersion.id, input.observation, match);
  const key = candidate.key.replace("runtime.unknown.", "asset.candidate.");
  const existing = input.storage.findBusinessNodeByKey(input.graphVersion.id, key);
  const now = nowIso();
  if (existing) {
    const metadata = {
      ...(existing.metadata ?? {}),
      lastObservedAt: now,
      observationCount: typeof existing.metadata?.observationCount === "number" ? existing.metadata.observationCount + 1 : 2,
      assetCandidateRole: input.role
    };
    const updated = input.storage.updateBusinessNodeMetadata(existing.id, metadata) ?? { ...existing, metadata };
    if (input.confirm && updated.status !== "active") {
      return {
        status: "reused",
        node: input.storage.updateBusinessNodeStatus(updated.id, "active") ?? { ...updated, status: "active" }
      };
    }
    return {
      status: "reused",
      node: updated
    };
  }

  const node = input.storage.createBusinessNode({
    ...candidate,
    key,
    name: assetCandidateNodeName(candidate.name),
    tags: uniqueStrings(["asset-transition-candidate", input.confirm ? "asset-candidate-confirmed" : "needs-review", ...candidate.tags.filter((tag) => tag !== "runtime-discovered")]),
    status: input.confirm ? "active" : "draft",
    metadata: {
      ...(candidate.metadata ?? {}),
      source: "manual_recording",
      assetCandidateRole: input.role,
      observationId: input.observation.id,
      observationCount: 1,
      firstObservedAt: now,
      lastObservedAt: now
    }
  });
  return {
    status: "created",
    node
  };
}

function persistAssetCandidateEdge(input: {
  graphVersionId: string;
  storage: AssetTransitionCandidateStorage;
  fromNode: BusinessNode;
  toNode: BusinessNode;
  step: ActionStep;
  status: OperationEdge["status"];
  reliabilityScore: number;
}): AssetTransitionCandidateEdgeResult {
  const key = assetCandidateEdgeKey(input.fromNode.key, input.toNode.key, input.step);
  const existing = input.storage.findOperationEdgeByKey(input.graphVersionId, key);
  if (existing) {
    if (input.status === "active" && existing.status !== "active") {
      return {
        status: "reused",
        edge: input.storage.updateOperationEdgeStatus(existing.id, "active") ?? { ...existing, status: "active" }
      };
    }
    return {
      status: "reused",
      edge: existing
    };
  }

  const createdAt = nowIso();
  const edge = input.storage.createOperationEdge({
    graphVersionId: input.graphVersionId,
    fromNodeId: input.fromNode.id,
    toNodeId: input.toNode.id,
    key,
    name: `${input.fromNode.name} -> ${input.toNode.name}`,
    intent: input.step.title ?? summarizeActionIntent(input.step),
    status: input.status,
    source: "manual_recording",
    preconditions: [stateExpectation(input.fromNode, "前置状态", createdAt)],
    actionPolicies: [
      {
        id: createId("action_policy"),
        priority: 1,
        action: input.step,
        fallback: false,
        reliabilityHint: input.reliabilityScore >= 0.85 ? "high" : input.reliabilityScore >= 0.7 ? "medium" : "low",
        source: {
          sourceType: "manual_recording",
          stepId: input.step.id,
          confidence: input.reliabilityScore
        }
      }
    ],
    expectations: [stateExpectation(input.toNode, "预期状态", createdAt)],
    failurePolicy: {
      retryCount: 1,
      recoverTo: "replan"
    },
    platformScope: input.step.params.platformScope === "ios" ? "ios" : input.step.params.platformScope === "mobile-both" ? "mobile-both" : "android",
    reliabilityScore: input.reliabilityScore
  });
  return {
    status: "created",
    edge
  };
}

function stateExpectation(node: BusinessNode, prefix: string, createdAt: string): StepExpectation {
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
      criticalMatcherCount: node.matchers.filter((matcher) => matcher.critical).length
    },
    createdAt
  };
}

function actionReliabilityScore(step: ActionStep): number {
  if (step.type === "tap_on_element") {
    const hasResourceId = typeof step.params.resourceId === "string" && step.params.resourceId.length > 0;
    const hasSelector = typeof step.params.selector === "string" && step.params.selector.length > 0;
    const hasAccessibilityId = typeof step.params.accessibilityId === "string" && step.params.accessibilityId.length > 0;
    return hasResourceId || hasSelector || hasAccessibilityId ? 0.9 : 0.65;
  }
  if (step.type === "tap_on_text") {
    return typeof step.params.text === "string" && step.params.text.length > 0 ? 0.82 : 0.6;
  }
  if (step.type === "tap_on_image") {
    return typeof step.params.baselineArtifactId === "string" && step.params.baselineArtifactId.length > 0 ? 0.78 : 0.62;
  }
  if (step.type === "input_text" || step.type === "wait" || step.type === "back" || step.type === "launch_app" || step.type === "close_app") {
    return 0.75;
  }
  return 0.45;
}

function assetCandidateEdgeKey(fromKey: string, toKey: string, step: ActionStep): string {
  return `asset.candidate.${stableHash([fromKey, toKey, step.type, actionIdentity(step)].join("|"))}`;
}

function actionIdentity(step: ActionStep): string {
  return [
    step.params.resourceId,
    step.params.selector,
    step.params.accessibilityId,
    step.params.text,
    step.params.baselineArtifactId,
    step.coordinate?.xRatio,
    step.coordinate?.yRatio,
    step.coordinate?.startXRatio,
    step.coordinate?.startYRatio,
    step.coordinate?.endXRatio,
    step.coordinate?.endYRatio
  ]
    .filter((value) => value !== undefined && value !== null && String(value).length > 0)
    .map(String)
    .join(":");
}

function summarizeActionIntent(step: ActionStep): string {
  if (step.type === "tap_on_element") {
    return `点击元素 ${String(step.params.selector ?? step.params.resourceId ?? step.params.accessibilityId ?? "")}`.trim();
  }
  if (step.type === "tap_on_text") {
    return `点击文字 ${String(step.params.text ?? "")}`.trim();
  }
  if (step.type === "tap_on_image") {
    return "点击图像区域";
  }
  return step.type;
}

function assetCandidateNodeName(name: string): string {
  return name.replace(/^运行期未知节点：/, "资产候选节点：");
}

function isLikelyLocalPageStateObservation(observation: Observation): boolean {
  const texts = uniqueStrings([
    ...observation.uiElements.map((element) => element.text),
    ...observation.uiElements.map((element) => element.contentDesc),
    ...observation.ocrTexts.map((text) => text.text)
  ].filter((value): value is string => typeof value === "string"));
  if (texts.length < 2) {
    return false;
  }
  return texts.filter(isLikelyLocalMenuActionText).length >= Math.min(2, texts.length);
}

function isLikelyLocalMenuActionText(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 8 || /^\d+$/.test(normalized)) {
    return false;
  }
  return /添加|加入|扫一扫|搜索|设置|更多|创建|新建|删除|编辑|分享|取消|确定|关闭|完成|选择|上传|下载|复制|粘贴/.test(normalized);
}

function strongMatcherCount(matchers: StateMatcher[]): number {
  return matchers.filter((matcher) => matcher.critical || matcher.type === "activity" || matcher.type === "resource_id" || matcher.type === "accessibility_id").length;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
