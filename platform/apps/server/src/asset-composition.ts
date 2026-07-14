import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
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
  runtimeParams: Record<string, string>;
};

export type AssetCompositeExecutionPlan = {
  status: "ready" | "blocked";
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
    elements: Array<{ id: string; label: string }>;
    transitions: Array<{ id: string; elementId?: string; targetPageModelId?: string; targetPageName?: string }>;
    tasks: Array<{ id: string; name: string; status?: string }>;
  }>;
};

export function assetCompositionCatalog(graphVersion: BusinessGraphVersion): AssetCompositionCatalog {
  const nodeById = new Map(graphVersion.nodes.map((item) => [item.id, item]));
  return {
    graphVersionId: graphVersion.id,
    pages: graphVersion.nodes
      .filter((node) => node.status === "active" && node.nodeType === "page" && node.metadata?.assetRecordingConfirmed === true)
      .map((node) => ({
        id: node.id,
        name: node.name,
        elements: pageElements(node).map((item) => ({ id: item.id, label: item.label ?? item.id })),
        transitions: pageTransitions(graphVersion, node).map((item) => ({
          id: item.id,
          elementId: item.elementId,
          targetPageModelId: item.targetNodeId,
          targetPageName: item.targetNodeId ? nodeById.get(item.targetNodeId)?.name : undefined
        })),
        tasks: pageTasks(node).map((item) => ({ id: item.id, name: item.name ?? item.id, status: item.status }))
      }))
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
      ...baseRuntimeParams,
      ...metaFunctionDefaultParams(metaFunction),
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
    status: issues.length ? "blocked" : "ready",
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

function resolveMetaFunctionStep(input: {
  caseStep: AssetCompositeCaseStep;
  metaFunction: MetaFunction;
  metaStep: MetaFunctionStep;
  graphVersion: BusinessGraphVersion;
  nodeById: Map<string, BusinessNode>;
  runtimeParams: Record<string, string>;
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
    const pageElement = sourceNode ? pageElements(sourceNode).find((item) => item.id === metaStep.pageElementId) : undefined;
    if (sourceNode && !pageElement) {
      input.issues.push(issueForStep("PAGE_ELEMENT_NOT_FOUND", `页面 ${sourceNode.name} 找不到能力 ${metaStep.pageElementId}`, input, metaStep.pageElementId));
    }
    const transition = sourceNode
      ? pageTransitions(input.graphVersion, sourceNode).find((item) => item.elementId === metaStep.pageElementId && (!metaStep.targetPageModelId || item.targetNodeId === metaStep.targetPageModelId))
      : undefined;
    if (sourceNode && pageElement && !transition) {
      input.issues.push(issueForStep("PAGE_TRANSITION_NOT_FOUND", `能力 ${metaStep.pageElementId} 没有可执行连接边。`, input, metaStep.pageElementId));
    }
    if (!sourceNode || !pageElement || !transition || !metaStep.targetPageModelId || !targetNode) {
      return undefined;
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

function pageElements(node: BusinessNode): Array<{ id: string; label?: string }> {
  const values = [node.metadata?.assetRecordingPageElements, node.metadata?.assetRecordingManualElements];
  const byId = new Map<string, { id: string; label?: string }>();
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value.filter(isRecord)) {
      if (typeof item.id === "string") {
        byId.set(item.id, {
          id: item.id,
          label: typeof item.label === "string" ? item.label : undefined
        });
      }
    }
  }
  return [...byId.values()];
}

function pageTransitions(graphVersion: BusinessGraphVersion, node: BusinessNode): Array<{ id: string; elementId?: string; targetNodeId?: string }> {
  const legacyValue = node.metadata?.assetRecordingPageTransitions;
  const legacy = Array.isArray(legacyValue)
    ? legacyValue.filter(isRecord).filter((item): item is { id: string; elementId?: string; targetNodeId?: string } => typeof item.id === "string")
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
      return edge ? [{ id: edge.id, elementId: item.id, targetNodeId: item.targetNodeId }] : [];
    })
    : [];
  return [...new Map([...legacy, ...manual].map((item) => [item.id, item])).values()];
}

function pageTasks(node: BusinessNode): Array<{ id: string; name?: string; status?: string }> {
  const value = node.metadata?.assetRecordingPageTasks;
  return Array.isArray(value) ? value.filter(isRecord).filter((item): item is { id: string; name?: string; status?: string } => typeof item.id === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
