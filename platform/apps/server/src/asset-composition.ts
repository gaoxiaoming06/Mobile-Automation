import type { BusinessGraphVersion, BusinessNode, OperationEdge } from "@mobile-automation/graph-core";
import type {
  AssetCompositeCase,
  AssetCompositeCaseStep,
  MetaFunction,
  MetaFunctionStep,
  ParameterProfile
} from "@mobile-automation/shared";

export type AssetCompositionIssueCode =
  | "META_FUNCTION_NOT_FOUND"
  | "META_FUNCTION_INACTIVE"
  | "MISSING_REQUIRED_PARAMETER"
  | "PAGE_MODEL_NOT_FOUND"
  | "SOURCE_PAGE_NOT_FOUND"
  | "TARGET_PAGE_NOT_FOUND"
  | "PAGE_ELEMENT_NOT_FOUND"
  | "PAGE_TRANSITION_NOT_FOUND"
  | "PAGE_TASK_NOT_FOUND"
  | "PLATFORM_MISMATCH";

export type AssetCompositionIssue = {
  code: AssetCompositionIssueCode;
  message: string;
  caseStepId?: string;
  metaFunctionId?: string;
  metaFunctionStepId?: string;
  assetId?: string;
};

export type CompiledAssetCompositionStep = {
  id: string;
  order: number;
  caseStepId: string;
  metaFunctionId: string;
  metaFunctionName: string;
  metaFunctionStepId: string;
  metaFunctionStepName?: string;
  kind: MetaFunctionStep["kind"];
  sourcePageModelId?: string;
  targetPageModelId: string;
  pageElementId?: string;
  pageTransitionId?: string;
  pageTaskId?: string;
  systemAction?: "launch_app";
  packageName?: string;
  runtimeParams: Record<string, string>;
};

export type AssetCompositeExecutionPlan = {
  status: "ready" | "needs_parameters" | "blocked";
  compositeCaseId: string;
  compositeCaseName: string;
  graphVersionId: string;
  parameterProfileId?: string;
  runtimeParams: Record<string, string>;
  requiredParameters: string[];
  steps: CompiledAssetCompositionStep[];
  issues: AssetCompositionIssue[];
};

export type AssetCompositionCatalog = {
  graphVersionId: string;
  pages: Array<{
    id: string;
    name: string;
    elements: Array<{ id: string; label: string; targetPageModelId?: string; targetPageName?: string; outcomeType?: string }>;
    transitions: Array<{ id: string; elementId?: string; targetPageModelId?: string; targetPageName?: string; parameterKeys: string[] }>;
    tasks: Array<{ id: string; name: string; status?: string; parameterKeys: string[] }>;
  }>;
};

export function assetCompositionCatalog(graphVersion: BusinessGraphVersion): AssetCompositionCatalog {
  const nodeById = new Map(graphVersion.nodes.map((item) => [item.id, item]));
  return {
    graphVersionId: graphVersion.id,
    pages: graphVersion.nodes
      .filter((node) => node.status === "active" && node.nodeType === "page" && node.metadata?.assetRecordingConfirmed === true)
      .map((node) => {
        const elements = pageElements(node, graphVersion);
        return {
          id: node.id,
          name: node.name,
          elements: elements.map((item) => ({
            id: item.id,
            label: item.label ?? item.id,
            ...(item.targetNodeId ? { targetPageModelId: item.targetNodeId } : {}),
            ...(item.targetPageName ? { targetPageName: item.targetPageName } : {}),
            ...(item.outcomeType ? { outcomeType: item.outcomeType } : {})
          })),
          transitions: pageTransitions(graphVersion, node, elements).map((item) => ({
            id: item.id,
            elementId: item.elementId,
            targetPageModelId: item.targetNodeId,
            targetPageName: item.targetNodeId ? nodeById.get(item.targetNodeId)?.name : undefined,
            parameterKeys: item.parameterKeys
          })),
          tasks: pageTasks(node).map((item) => ({ id: item.id, name: item.name ?? item.id, status: item.status, parameterKeys: item.parameterKeys }))
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
  };
}

export function compileAssetCompositeCase(input: {
  compositeCase: AssetCompositeCase;
  metaFunctions: MetaFunction[];
  parameterProfile?: ParameterProfile;
  runtimeParams?: Record<string, string>;
  graphVersion: BusinessGraphVersion;
  runtimeOverrides?: Record<string, string | number | boolean>;
}): AssetCompositeExecutionPlan {
  const issues: AssetCompositionIssue[] = [];
  const metaFunctionById = new Map(input.metaFunctions.map((item) => [item.id, item]));
  const nodeById = new Map(input.graphVersion.nodes.map((item) => [item.id, item]));
  const baseRuntimeParams = {
    ...(input.runtimeParams ?? parameterProfileRuntimeParams(input.parameterProfile)),
    ...stringifyRuntimeParams(input.runtimeOverrides ?? {})
  };
  const requiredParameters = new Set<string>();
  const steps: CompiledAssetCompositionStep[] = [];

  if (input.parameterProfile && input.parameterProfile.platform !== input.compositeCase.platform) {
    issues.push({
      code: "PLATFORM_MISMATCH",
      message: `参数集平台 ${input.parameterProfile.platform} 与组合用例平台 ${input.compositeCase.platform} 不一致。`,
      assetId: input.parameterProfile.id
    });
  }

  const caseSteps = normalizeEnabledSteps(input.compositeCase.steps);
  for (const caseStep of caseSteps) {
    const metaFunction = metaFunctionById.get(caseStep.metaFunctionId);
    if (!metaFunction) {
      issues.push({
        code: "META_FUNCTION_NOT_FOUND",
        message: `组合步骤引用的元功能不存在：${caseStep.metaFunctionId}`,
        caseStepId: caseStep.id,
        assetId: caseStep.metaFunctionId
      });
      continue;
    }
    if (metaFunction.status !== "active") {
      issues.push({
        code: "META_FUNCTION_INACTIVE",
        message: `元功能 ${metaFunction.name} 当前状态为 ${metaFunction.status}，不能执行。`,
        caseStepId: caseStep.id,
        metaFunctionId: metaFunction.id
      });
    }
    if (metaFunction.platform !== input.compositeCase.platform || metaFunction.appId !== input.compositeCase.appId) {
      issues.push({
        code: "PLATFORM_MISMATCH",
        message: `元功能 ${metaFunction.name} 不属于当前 App / 平台。`,
        caseStepId: caseStep.id,
        metaFunctionId: metaFunction.id
      });
    }

    const stepRuntimeParams = {
      ...metaFunctionDefaultParams(metaFunction),
      ...baseRuntimeParams,
      ...stringifyRuntimeParams(caseStep.parameterOverrides ?? {})
    };
    for (const parameter of metaFunction.parameters) {
      if (parameter.required) {
        requiredParameters.add(parameter.key);
        if (!hasRuntimeParam(stepRuntimeParams, parameter.key)) {
          issues.push({
            code: "MISSING_REQUIRED_PARAMETER",
            message: `元功能 ${metaFunction.name} 缺少必需参数 ${parameter.key}。`,
            caseStepId: caseStep.id,
            metaFunctionId: metaFunction.id,
            assetId: parameter.key
          });
        }
      }
    }

    for (const metaStep of normalizeEnabledSteps(metaFunction.steps)) {
      const resolved = resolveMetaFunctionStep({
        caseStep,
        metaFunction,
        metaStep,
        graphVersion: input.graphVersion,
        nodeById,
        runtimeParams: stepRuntimeParams,
        requiredParameters,
        order: steps.length + 1,
        issues
      });
      if (resolved) {
        steps.push(resolved);
      }
    }
    Object.assign(baseRuntimeParams, stepRuntimeParams);
  }

  return {
    status: assetCompositionPlanStatus(issues),
    compositeCaseId: input.compositeCase.id,
    compositeCaseName: input.compositeCase.name,
    graphVersionId: input.graphVersion.id,
    parameterProfileId: input.parameterProfile?.id,
    runtimeParams: baseRuntimeParams,
    requiredParameters: [...requiredParameters].sort(),
    steps,
    issues
  };
}

export function missingRequiredParameterKeysFromIssues(issues: AssetCompositionIssue[]): string[] {
  return [...new Set(issues
    .filter((issue) => issue.code === "MISSING_REQUIRED_PARAMETER")
    .map((issue) => issue.assetId?.trim() ?? "")
    .filter(Boolean))]
    .sort();
}

function resolveMetaFunctionStep(input: {
  caseStep: AssetCompositeCaseStep;
  metaFunction: MetaFunction;
  metaStep: MetaFunctionStep;
  graphVersion: BusinessGraphVersion;
  nodeById: Map<string, BusinessNode>;
  runtimeParams: Record<string, string>;
  requiredParameters: Set<string>;
  order: number;
  issues: AssetCompositionIssue[];
}): CompiledAssetCompositionStep | undefined {
  const metaStep = input.metaStep;
  const common = {
    id: `${input.caseStep.id}:${metaStep.id}`,
    order: input.order,
    caseStepId: input.caseStep.id,
    metaFunctionId: input.metaFunction.id,
    metaFunctionName: input.metaFunction.name,
    metaFunctionStepId: metaStep.id,
    metaFunctionStepName: metaStep.name,
    kind: metaStep.kind,
    runtimeParams: { ...input.runtimeParams }
  };

  if (metaStep.kind === "system_action") {
    const packageName = metaStep.packageName?.trim() || input.metaFunction.appId;
    return {
      ...common,
      targetPageModelId: packageName,
      systemAction: metaStep.actionType,
      packageName
    };
  }

  if (metaStep.kind === "reach_page" || metaStep.kind === "verify_page") {
    const pageModelId = metaStep.kind === "reach_page" ? metaStep.targetPageModelId : metaStep.pageModelId;
    if (!input.nodeById.has(pageModelId)) {
      input.issues.push(issueForStep("PAGE_MODEL_NOT_FOUND", `页面资产不存在：${pageModelId}`, input, pageModelId));
      return undefined;
    }
    return {
      ...common,
      targetPageModelId: pageModelId
    };
  }

  if (metaStep.kind === "invoke_capability") {
    const sourceNode = input.nodeById.get(metaStep.sourcePageModelId);
    if (!sourceNode) {
      input.issues.push(issueForStep("SOURCE_PAGE_NOT_FOUND", `能力来源页面不存在：${metaStep.sourcePageModelId}`, input, metaStep.sourcePageModelId));
    }
    const targetNode = metaStep.targetPageModelId ? input.nodeById.get(metaStep.targetPageModelId) : undefined;
    if (metaStep.targetPageModelId && !targetNode) {
      input.issues.push(issueForStep("TARGET_PAGE_NOT_FOUND", `能力目标页面不存在：${metaStep.targetPageModelId}`, input, metaStep.targetPageModelId));
    }
    const sourceElements = sourceNode ? pageElements(sourceNode, input.graphVersion) : [];
    const pageElement = sourceElements.find((item) => item.id === metaStep.pageElementId);
    if (sourceNode && !pageElement) {
      input.issues.push(issueForStep("PAGE_ELEMENT_NOT_FOUND", `页面 ${sourceNode.name} 找不到能力 ${metaStep.pageElementId}`, input, metaStep.pageElementId));
    }
    const transition = sourceNode
      ? pageTransitions(input.graphVersion, sourceNode, sourceElements).find((item) => item.elementId === metaStep.pageElementId && (!metaStep.targetPageModelId || item.targetNodeId === metaStep.targetPageModelId))
      : undefined;
    if (sourceNode && pageElement && !transition) {
      input.issues.push(issueForStep("PAGE_TRANSITION_NOT_FOUND", `能力 ${metaStep.pageElementId} 没有可执行连接边。`, input, metaStep.pageElementId));
    }
    if (!sourceNode || !pageElement || !transition || !metaStep.targetPageModelId || !targetNode) {
      return undefined;
    }
    for (const parameterKey of transition.parameterKeys) {
      input.requiredParameters.add(parameterKey);
      if (!hasRuntimeParam(input.runtimeParams, parameterKey)) {
        pushMissingRequiredParameterIssue(input.issues, {
          ...issueForStep(
            "MISSING_REQUIRED_PARAMETER",
            `页面连接 ${sourceNode.name} -> ${targetNode.name} 缺少必需参数 ${parameterKey}。`,
            input,
            parameterKey
          )
        });
      }
    }
    return {
      ...common,
      sourcePageModelId: metaStep.sourcePageModelId,
      targetPageModelId: metaStep.targetPageModelId,
      pageElementId: metaStep.pageElementId,
      pageTransitionId: transition.id
    };
  }

  const pageNode = input.nodeById.get(metaStep.pageModelId);
  if (!pageNode) {
    input.issues.push(issueForStep("PAGE_MODEL_NOT_FOUND", `页面资产不存在：${metaStep.pageModelId}`, input, metaStep.pageModelId));
    return undefined;
  }
  const task = pageTasks(pageNode).find((item) => item.id === metaStep.pageTaskId && item.status !== "deprecated");
  if (!task) {
    input.issues.push(issueForStep("PAGE_TASK_NOT_FOUND", `页面 ${pageNode.name} 找不到任务 ${metaStep.pageTaskId}`, input, metaStep.pageTaskId));
    return undefined;
  }
  for (const parameterKey of task.parameterKeys) {
    const declaration = input.metaFunction.parameters.find((parameter) => parameter.key === parameterKey);
    const required = declaration ? declaration.required === true : true;
    if (required) {
      input.requiredParameters.add(parameterKey);
    }
    if (required && !hasRuntimeParam(input.runtimeParams, parameterKey)) {
      pushMissingRequiredParameterIssue(input.issues, {
        ...issueForStep(
          "MISSING_REQUIRED_PARAMETER",
          `页面任务 ${task.name ?? task.id} 缺少必需参数 ${parameterKey}。`,
          input,
          parameterKey
        )
      });
    }
  }
  return {
    ...common,
    targetPageModelId: metaStep.pageModelId,
    pageTaskId: metaStep.pageTaskId
  };
}

function issueForStep(
  code: AssetCompositionIssueCode,
  message: string,
  input: { caseStep: AssetCompositeCaseStep; metaFunction: MetaFunction; metaStep: MetaFunctionStep },
  assetId: string
): AssetCompositionIssue {
  return {
    code,
    message,
    caseStepId: input.caseStep.id,
    metaFunctionId: input.metaFunction.id,
    metaFunctionStepId: input.metaStep.id,
    assetId
  };
}

function normalizeEnabledSteps<T extends { order: number; enabled: boolean }>(steps: T[]): T[] {
  return [...steps].filter((item) => item.enabled).sort((left, right) => left.order - right.order);
}

type PageElementSummary = { id: string; label?: string; targetNodeId?: string; targetPageName?: string; outcomeType?: string };
type PageTransitionSummary = { id: string; elementId?: string; targetNodeId?: string; parameterKeys: string[] };

function pageElements(node: BusinessNode, graphVersion?: BusinessGraphVersion): PageElementSummary[] {
  const values = [node.metadata?.assetRecordingPageElements, node.metadata?.assetRecordingManualElements];
  const byId = new Map<string, PageElementSummary>();
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value.filter(isRecord)) {
      if (typeof item.id === "string") {
        const targetNodeId = stringRecordValue(item, "targetNodeId");
        const targetPageName = targetNodeId
          ? graphVersion?.nodes.find((target) => target.id === targetNodeId)?.name ?? stringRecordValue(item, "targetLabel")
          : stringRecordValue(item, "targetLabel");
        const outcomeType = stringRecordValue(item, "outcomeType");
        byId.set(item.id, {
          id: item.id,
          label: typeof item.label === "string" ? item.label : undefined,
          ...(targetNodeId ? { targetNodeId } : {}),
          ...(targetPageName ? { targetPageName } : {}),
          ...(outcomeType ? { outcomeType } : {})
        });
      }
    }
  }
  if (graphVersion) {
    const baseElements = [...byId.values()];
    for (const edge of graphVersion.edges.filter((item) =>
      item.status === "active" &&
      item.fromNodeId === node.id &&
      graphVersion.nodes.some((target) => target.id === item.toNodeId && target.status === "active")
    )) {
      const elementId = operationEdgeElementId(edge, baseElements) ?? operationEdgeSyntheticElementId(edge);
      if (elementId && !byId.has(elementId)) {
        byId.set(elementId, {
          id: elementId,
          label: operationEdgeElementLabel(edge) ?? elementId
        });
      }
    }
  }
  return [...byId.values()];
}

function pageTransitions(graphVersion: BusinessGraphVersion, node: BusinessNode, elements: PageElementSummary[] = pageElements(node, graphVersion)): PageTransitionSummary[] {
  const legacyValue = node.metadata?.assetRecordingPageTransitions;
  const legacy = Array.isArray(legacyValue)
    ? legacyValue.filter(isRecord).flatMap((item) =>
      typeof item.id === "string"
        ? [{ id: item.id, elementId: stringRecordValue(item, "elementId"), targetNodeId: stringRecordValue(item, "targetNodeId"), parameterKeys: runtimeParameterKeysFromAsset(item) }]
        : []
    )
    : [];
  const manualValue = node.metadata?.assetRecordingManualElements;
  const manual = Array.isArray(manualValue)
    ? manualValue.filter(isRecord).flatMap((item) => {
      if (
        typeof item.id !== "string" ||
        typeof item.targetNodeId !== "string" ||
        (item.outcomeType !== "navigate" && item.outcomeType !== "compound_navigation")
      ) {
        return [];
      }
      const edge = graphVersion.edges.find((candidate) =>
        candidate.status === "active" &&
        candidate.fromNodeId === node.id &&
        candidate.toNodeId === item.targetNodeId
      );
      return edge ? [{ id: edge.id, elementId: item.id, targetNodeId: item.targetNodeId, parameterKeys: runtimeParameterKeysFromAsset(item) }] : [];
    })
    : [];
  const graphEdges = graphVersion.edges.flatMap((edge) => {
    if (edge.status !== "active" || edge.fromNodeId !== node.id || !graphVersion.nodes.some((target) => target.id === edge.toNodeId && target.status === "active")) {
      return [];
    }
    const elementId = operationEdgeElementId(edge, elements) ?? operationEdgeSyntheticElementId(edge);
    return elementId ? [{ id: edge.id, elementId, targetNodeId: edge.toNodeId, parameterKeys: operationEdgeParameterKeys(edge) }] : [];
  });
  return mergePageTransitions([...legacy, ...manual, ...graphEdges]);
}

function operationEdgeSyntheticElementId(edge: OperationEdge): string | undefined {
  return edge.actionPolicies.some((policy) => policy.action.enabled !== false)
    ? `edge_action:${edge.id}`
    : undefined;
}

function operationEdgeElementLabel(edge: OperationEdge): string | undefined {
  const labels = edge.actionPolicies.flatMap((policy) => [
    stringRecordValue(policy.action.params, "elementLabel"),
    stringRecordValue(policy.action.params, "targetText"),
    normalizeActionTitle(policy.action.title)
  ]);
  return labels.find((label): label is string => Boolean(label)) ?? edge.intent?.trim() ?? edge.name.trim();
}

function operationEdgeParameterKeys(edge: OperationEdge): string[] {
  return runtimeParameterKeysFromAsset(edge.actionPolicies.map((policy) => policy.action.params));
}

function mergePageTransitions(values: PageTransitionSummary[]): PageTransitionSummary[] {
  const byId = new Map<string, PageTransitionSummary>();
  for (const value of values) {
    const existing = byId.get(value.id);
    byId.set(value.id, existing
      ? {
        ...existing,
        elementId: existing.elementId ?? value.elementId,
        targetNodeId: existing.targetNodeId ?? value.targetNodeId,
        parameterKeys: uniqueStrings([...existing.parameterKeys, ...value.parameterKeys])
      }
      : {
        ...value,
        parameterKeys: uniqueStrings(value.parameterKeys)
      });
  }
  return [...byId.values()];
}

function runtimeParameterKeysFromAsset(value: unknown): string[] {
  const keys = new Set<string>();
  collectRuntimeParameterKeys(value, keys);
  return [...keys].sort();
}

function collectRuntimeParameterKeys(value: unknown, keys: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)) {
      if (match[1]) {
        keys.add(match[1].trim());
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRuntimeParameterKeys(item, keys);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const parameterMapping = value.parameterMapping;
  if (isRecord(parameterMapping)) {
    for (const key of Object.keys(parameterMapping)) {
      if (key.trim()) {
        keys.add(key.trim());
      }
    }
  }
  const itemIdentity = value.itemIdentity;
  const itemIdentityParam = stringRecordValue(itemIdentity, "param");
  if (itemIdentityParam) {
    keys.add(itemIdentityParam);
  }
  for (const item of Object.values(value)) {
    collectRuntimeParameterKeys(item, keys);
  }
}

function normalizeActionTitle(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^点击[:：]\s*/u, "");
  return normalized || undefined;
}

function operationEdgeElementId(edge: OperationEdge, elements: PageElementSummary[]): string | undefined {
  const labelCandidates = edge.actionPolicies
    .flatMap((policy) => [
      stringRecordValue(policy.action.params, "elementId"),
      stringRecordValue(policy.action.params, "pageElementId")
    ])
    .filter((value): value is string => Boolean(value));
  const directId = labelCandidates.find((value) => elements.some((element) => element.id === value));
  if (directId) {
    return directId;
  }

  const textCandidates = edge.actionPolicies
    .flatMap((policy) => [
      stringRecordValue(policy.action.params, "elementLabel"),
      stringRecordValue(policy.action.params, "targetText"),
      policy.action.title
    ])
    .concat([edge.intent, edge.name])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return elements.find((element) => {
    const label = element.label;
    return Boolean(label && textCandidates.some((candidate) => candidate === label || candidate.includes(label)));
  })?.id;
}

function pageTasks(node: BusinessNode): Array<{ id: string; name?: string; status?: string; parameterKeys: string[] }> {
  const value = node.metadata?.assetRecordingPageTasks;
  return Array.isArray(value)
    ? value
      .filter(isRecord)
      .filter((item): item is { id: string; name?: string; status?: string; steps?: unknown } => typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        name: typeof item.name === "string" ? item.name : undefined,
        status: typeof item.status === "string" ? item.status : undefined,
        parameterKeys: pageTaskParameterKeys(item.steps)
      }))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringRecordValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function parameterProfileRuntimeParams(profile: ParameterProfile | undefined): Record<string, string> {
  if (!profile) {
    return {};
  }
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return Object.fromEntries(Object.entries(profile.values).map(([key, entry]) => {
    const value = entry.type === "template" ? String(entry.value).replaceAll("{{timestamp}}", timestamp) : String(entry.value);
    return [key, value];
  }));
}

function metaFunctionDefaultParams(metaFunction: MetaFunction): Record<string, string> {
  return Object.fromEntries(metaFunction.parameters
    .filter((item) => item.defaultValue !== undefined)
    .map((item) => [item.key, String(item.defaultValue)]));
}

function stringifyRuntimeParams(values: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function hasRuntimeParam(values: Record<string, string>, key: string): boolean {
  return typeof values[key] === "string" && values[key]!.trim().length > 0;
}

function assetCompositionPlanStatus(issues: AssetCompositionIssue[]): AssetCompositeExecutionPlan["status"] {
  if (!issues.length) {
    return "ready";
  }
  return issues.every((issue) => issue.code === "MISSING_REQUIRED_PARAMETER") ? "needs_parameters" : "blocked";
}

function pageTaskParameterKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter(isRecord)
    .flatMap((step) => [step.valueParamKey, step.desiredStateParamKey])
    .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
    .map((key) => key.trim()))].sort();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function pushMissingRequiredParameterIssue(issues: AssetCompositionIssue[], issue: AssetCompositionIssue): void {
  const exists = issues.some((item) =>
    item.code === "MISSING_REQUIRED_PARAMETER" &&
    item.caseStepId === issue.caseStepId &&
    item.metaFunctionId === issue.metaFunctionId &&
    item.assetId === issue.assetId
  );
  if (!exists) {
    issues.push(issue);
  }
}
