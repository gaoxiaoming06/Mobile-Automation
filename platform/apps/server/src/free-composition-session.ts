import { randomUUID } from "node:crypto";
import type {
  AssetCompositeCase,
  MetaFunction,
  ParameterDataRecord,
  ParameterProfile,
  Platform
} from "@mobile-automation/shared";
import type { BusinessGraphVersion } from "@mobile-automation/graph-core";
import type { AssetCompositeExecution, AssetCompositeExecutionStatus } from "./asset-composite-execution.js";
import {
  compileAssetCompositeCase,
  missingRequiredParameterKeysFromIssues,
  type AssetCompositeExecutionPlan
} from "./asset-composition.js";
import { resolveParameterProfileRuntimeSnapshot } from "./asset-parameter-center.js";
import type {
  FreeCompositionCandidate,
  FreeCompositionResolution
} from "./free-composition.js";
import { riskTermsInText } from "./free-composition.js";

export type FreeCompositionSessionStatus =
  | "awaiting_selection"
  | "awaiting_parameters"
  | "awaiting_confirmation"
  | "blocked"
  | "running"
  | "passed"
  | "failed"
  | "stopped";

export type FreeCompositionSession = {
  id: string;
  appId: string;
  platform: Platform;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  resolution: FreeCompositionResolution;
  selectedCandidateId?: string;
  parameterProfileId?: string;
  compositeCase?: AssetCompositeCase;
  generatedMetaFunctions?: MetaFunction[];
  plan?: AssetCompositeExecutionPlan;
  executionId?: string;
  status: FreeCompositionSessionStatus;
  riskConfirmed?: boolean;
};

type TimestampInput = {
  now?: string;
};

export function createFreeCompositionSession(
  input: {
    appId: string;
    platform: Platform;
    prompt: string;
    resolution: FreeCompositionResolution;
  } & TimestampInput
): FreeCompositionSession {
  const now = input.now ?? new Date().toISOString();
  return {
    id: "free_composition_" + randomUUID(),
    appId: input.appId,
    platform: input.platform,
    prompt: input.prompt,
    createdAt: now,
    updatedAt: now,
    resolution: input.resolution,
    status:
      input.resolution.status === "missing_assets"
        ? "blocked"
        : "awaiting_selection"
  };
}

export function selectFreeCompositionCandidate(
  input: {
    session: FreeCompositionSession;
    candidateId: string;
    parameterProfileId?: string;
    metaFunctions: MetaFunction[];
    compositeCases: AssetCompositeCase[];
  } & TimestampInput
): FreeCompositionSession {
  const candidate = input.session.resolution.candidates.find(
    (item) => item.id === input.candidateId
  );
  if (!candidate) {
    throw new Error("选择的候选不属于当前AI资产用例会话。");
  }

  const now = input.now ?? new Date().toISOString();
  const temporary = temporaryCompositeCaseForCandidate(
    input.session,
    candidate,
    input.metaFunctions,
    input.compositeCases,
    input.parameterProfileId,
    now
  );
  const compositeCase = temporary.compositeCase;
  const resolution: FreeCompositionResolution = {
    ...input.session.resolution,
    intent: {
      ...input.session.resolution.intent,
      riskTerms: [...new Set([
        ...input.session.resolution.intent.riskTerms,
        ...riskTermsForSelectedCandidate(candidate, input.session.resolution.candidates)
      ])]
    }
  };

  return {
    ...input.session,
    resolution,
    selectedCandidateId: candidate.id,
    parameterProfileId: compositeCase.parameterProfileId,
    compositeCase,
    generatedMetaFunctions: temporary.generatedMetaFunctions,
    updatedAt: now,
    status: "awaiting_confirmation"
  };
}

function riskTermsForSelectedCandidate(
  candidate: FreeCompositionCandidate,
  candidates: FreeCompositionCandidate[]
): string[] {
  const riskText = executableCandidatesForRisk(candidate, candidates)
    .flatMap((item) => [item.name, item.description ?? "", item.pageTaskName ?? ""])
    .join("\n");
  return riskTermsInText(riskText);
}

function executableCandidatesForRisk(
  candidate: FreeCompositionCandidate,
  candidates: FreeCompositionCandidate[],
  visited = new Set<string>()
): FreeCompositionCandidate[] {
  if (visited.has(candidate.id)) {
    return [];
  }
  visited.add(candidate.id);
  if (candidate.kind === "composite_case" || candidate.kind === "meta_function" || candidate.kind === "page_task") {
    return [candidate];
  }
  if (candidate.kind !== "generated_flow") {
    return [];
  }
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const components = candidate.composedCandidates ?? (candidate.composedCandidateIds ?? []).flatMap((id) => {
    const component = byId.get(id);
    return component ? [component] : [];
  });
  return components.flatMap((component) => executableCandidatesForRisk(component, candidates, visited));
}

export function assertFreeCompositionExecutionAllowed(
  session: FreeCompositionSession,
  input: {
    confirmed: boolean;
    riskConfirmed: boolean;
  }
): void {
  if (!freeCompositionSessionRequiresExecution(session)) {
    throw new Error("当前目标已满足，无需执行。");
  }
  if (!session.compositeCase) {
    throw new Error("请先选择一个已存在的元功能或组合用例。");
  }
  if (!input.confirmed) {
    throw new Error("请先确认临时组合计划后再执行。");
  }
  if (session.plan?.status === "needs_parameters") {
    throw new Error("请先补充参数：" + missingRequiredParameterKeysFromIssues(session.plan.issues).join("、"));
  }
  if (session.plan?.status === "blocked") {
    throw new Error(session.plan.issues[0]?.message ?? "AI资产用例计划预检未通过。");
  }
  if (
    session.resolution.intent.riskTerms.length > 0 &&
    !input.riskConfirmed
  ) {
    throw new Error(
      "该计划包含高风险操作：" +
        session.resolution.intent.riskTerms.join("、") +
        "。请明确确认后再执行。"
    );
  }
}

export function previewFreeCompositionSession(
  input: {
    session: FreeCompositionSession;
    metaFunctions: MetaFunction[];
    parameterProfile?: ParameterProfile;
    parameterDataRecords: ParameterDataRecord[];
    graphVersion: BusinessGraphVersion;
    runtimeOverrides?: Record<string, string | number | boolean>;
  } & TimestampInput
): { session: FreeCompositionSession; plan: AssetCompositeExecutionPlan } {
  if (!input.session.compositeCase) {
    throw new Error("请先选择一个已存在的元功能或组合用例。");
  }
  const runtimeOverrides = mergeRuntimeOverrides(
    input.session.resolution.intent.runtimeOverrides,
    input.runtimeOverrides
  );
  const runtimeParams = input.parameterProfile
    ? resolveParameterProfileRuntimeSnapshot({
      profile: input.parameterProfile,
      appId: input.session.compositeCase.appId,
      platform: input.session.compositeCase.platform,
      records: input.parameterDataRecords,
      overrides: runtimeOverrides
    }).runtimeParams
    : undefined;
  const plan = compileAssetCompositeCase({
    compositeCase: input.session.compositeCase,
    metaFunctions: [...input.metaFunctions, ...(input.session.generatedMetaFunctions ?? [])],
    parameterProfile: input.parameterProfile,
    runtimeParams,
    graphVersion: input.graphVersion,
    runtimeOverrides
  });
  const resolution: FreeCompositionResolution = {
    ...input.session.resolution,
    intent: {
      ...input.session.resolution.intent,
      riskTerms: [...new Set([
        ...input.session.resolution.intent.riskTerms,
        ...riskTermsForPlan(plan, input.graphVersion)
      ])]
    }
  };
  return {
    plan,
    session: {
      ...input.session,
      resolution,
      parameterProfileId: input.parameterProfile?.id ?? input.session.parameterProfileId,
      plan,
      status: freeCompositionStatusForPlan(plan),
      updatedAt: input.now ?? new Date().toISOString()
    }
  };
}

function riskTermsForPlan(plan: AssetCompositeExecutionPlan, graphVersion: BusinessGraphVersion): string[] {
  const nodeById = new Map(graphVersion.nodes.map((node) => [node.id, node]));
  const terms: string[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "run_page_task" || !step.pageTaskId) {
      continue;
    }
    const node = nodeById.get(step.targetPageModelId);
    const task = metadataRecords(node?.metadata?.assetRecordingPageTasks)
      .find((item) => item.id === step.pageTaskId);
    for (const taskStep of metadataRecords(task?.steps)) {
      if (taskStep.fieldType !== "submit") {
        continue;
      }
      const elementId = typeof taskStep.elementId === "string" ? taskStep.elementId : "";
      const element = pageElementRecords(node?.metadata).find((item) => item.id === elementId);
      terms.push(...riskTermsInText([
        stringValue(taskStep.label),
        stringValue(element?.label),
        stringValue(element?.targetText)
      ].filter(Boolean).join("\n")));
    }
  }
  return [...new Set(terms)];
}

function pageElementRecords(metadata: Record<string, unknown> | undefined): Record<string, unknown>[] {
  return [metadata?.assetRecordingPageElements, metadata?.assetRecordingManualElements]
    .flatMap((value) => metadataRecords(value));
}

function metadataRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function markFreeCompositionSessionExecutionStarted(
  session: FreeCompositionSession,
  input: { executionId: string; riskConfirmed?: boolean } & TimestampInput
): FreeCompositionSession {
  return {
    ...session,
    executionId: input.executionId,
    status: "running",
    riskConfirmed: input.riskConfirmed ?? session.riskConfirmed,
    updatedAt: input.now ?? new Date().toISOString()
  };
}

export function syncFreeCompositionSessionExecution(
  session: FreeCompositionSession,
  execution: AssetCompositeExecution | undefined,
  input: TimestampInput = {}
): FreeCompositionSession {
  if (!session.executionId || !execution) {
    return session;
  }
  const status = freeCompositionStatusForExecution(execution.status);
  if (session.status === status) {
    return session;
  }
  return {
    ...session,
    status,
    updatedAt: input.now ?? new Date().toISOString()
  };
}

function temporaryCompositeCaseForCandidate(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate,
  metaFunctions: MetaFunction[],
  compositeCases: AssetCompositeCase[],
  parameterProfileId: string | undefined,
  now: string
): { compositeCase: AssetCompositeCase; generatedMetaFunctions?: MetaFunction[] } {
  const intent = session.resolution.intent;
  if (candidate.kind === "generated_flow") {
    const embeddedCandidatesById = new Map((candidate.composedCandidates ?? []).map((item) => [item.id, item]));
    const composedCandidates = (candidate.composedCandidateIds ?? []).map((candidateId) =>
      embeddedCandidatesById.get(candidateId) ?? session.resolution.candidates.find((item) => item.id === candidateId)
    );
    if (composedCandidates.some((item) => !item)) {
      throw new Error("生成流程引用的候选不完整，请重新分析需求。");
    }
    const generatedMetaFunctions: MetaFunction[] = [];
    const steps: AssetCompositeCase["steps"] = [];
    for (const [index, composedCandidate] of (composedCandidates as FreeCompositionCandidate[]).entries()) {
      if (composedCandidate.kind === "page_task") {
        const generatedMetaFunction = temporaryMetaFunctionForPageTask(session, composedCandidate, now, String(index + 1));
        generatedMetaFunctions.push(generatedMetaFunction);
        steps.push({
          id: `free_composition_step_${session.id}_${index + 1}`,
          order: steps.length + 1,
          metaFunctionId: generatedMetaFunction.id,
          enabled: true
        });
        continue;
      }
      if (composedCandidate.kind === "page_transition") {
        const generatedMetaFunction = temporaryMetaFunctionForPageTransition(session, composedCandidate, now, String(index + 1));
        generatedMetaFunctions.push(generatedMetaFunction);
        steps.push({
          id: `free_composition_step_${session.id}_${index + 1}`,
          order: steps.length + 1,
          metaFunctionId: generatedMetaFunction.id,
          enabled: true
        });
        continue;
      }
      if (composedCandidate.kind === "page_goal") {
        const generatedMetaFunction = temporaryMetaFunctionForPageGoal(session, composedCandidate, now, String(index + 1));
        generatedMetaFunctions.push(generatedMetaFunction);
        steps.push({
          id: `free_composition_step_${session.id}_${index + 1}`,
          order: steps.length + 1,
          metaFunctionId: generatedMetaFunction.id,
          enabled: true
        });
        continue;
      }
      if (composedCandidate.kind === "system_action") {
        const generatedMetaFunction = temporaryMetaFunctionForSystemAction(session, composedCandidate, now, String(index + 1));
        generatedMetaFunctions.push(generatedMetaFunction);
        steps.push({
          id: `free_composition_step_${session.id}_${index + 1}`,
          order: steps.length + 1,
          metaFunctionId: generatedMetaFunction.id,
          enabled: true
        });
        continue;
      }
      if (composedCandidate.kind === "meta_function") {
        const source = metaFunctions.find((item) => item.id === composedCandidate.id);
        if (!source) {
          throw new Error("找不到生成流程引用的元功能，请重新分析需求。");
        }
        steps.push({
          id: `free_composition_step_${session.id}_${index + 1}`,
          order: steps.length + 1,
          metaFunctionId: source.id,
          enabled: true
        });
        continue;
      }
      if (composedCandidate.kind === "composite_case") {
        const source = compositeCases.find((item) => item.id === composedCandidate.id);
        if (!source) {
          throw new Error("找不到生成流程引用的组合用例，请重新分析需求。");
        }
        for (const sourceStep of source.steps.filter((step) => step.enabled).sort((left, right) => left.order - right.order)) {
          steps.push({
            ...sourceStep,
            id: `free_composition_step_${session.id}_${index + 1}_${sourceStep.id}`,
            order: steps.length + 1
          });
        }
      }
    }
    return {
      compositeCase: {
        id: "free_composition_case_" + session.id,
        appId: session.appId,
        platform: session.platform,
        name: "AI资产用例：" + candidate.name,
        description: "由自然语言顺序生成：" + session.prompt,
        parameterProfileId,
        runMode: intent.runMode,
        repeatCount: intent.repeatCount,
        stopOnFailure: true,
        steps,
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      generatedMetaFunctions
    };
  }

  if (candidate.kind === "composite_case") {
    const source = compositeCases.find((item) => item.id === candidate.id);
    if (!source) {
      throw new Error("找不到选中的组合用例，请重新分析需求。");
    }
    return { compositeCase: {
      ...source,
      id: "free_composition_case_" + session.id,
      name: "AI资产用例：" + source.name,
      description:
        "由自然语言临时组合生成，不会改写原组合用例。原用例：" +
        source.name,
      parameterProfileId: parameterProfileId ?? source.parameterProfileId,
      runMode: intent.runMode,
      repeatCount: intent.repeatCount,
      steps: source.steps.map((step) => ({ ...step })),
      version: 1,
      createdAt: now,
      updatedAt: now
    } };
  }

  if (candidate.kind === "page_task") {
    const generatedMetaFunction = temporaryMetaFunctionForPageTask(session, candidate, now);
    return {
      compositeCase: {
        id: "free_composition_case_" + session.id,
        appId: session.appId,
        platform: session.platform,
        name: "AI资产用例：" + generatedMetaFunction.name,
        description: "由自然语言临时组合生成：" + session.prompt,
        parameterProfileId,
        runMode: intent.runMode,
        repeatCount: intent.repeatCount,
        stopOnFailure: true,
        steps: [
          {
            id: "free_composition_step_" + session.id + "_1",
            order: 1,
            metaFunctionId: generatedMetaFunction.id,
            enabled: true
          }
        ],
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      generatedMetaFunctions: [generatedMetaFunction]
    };
  }

  if (candidate.kind === "page_transition") {
    const generatedMetaFunction = temporaryMetaFunctionForPageTransition(session, candidate, now);
    return {
      compositeCase: {
        id: "free_composition_case_" + session.id,
        appId: session.appId,
        platform: session.platform,
        name: "AI资产用例：" + generatedMetaFunction.name,
        description: "由自然语言临时组合生成：" + session.prompt,
        parameterProfileId,
        runMode: intent.runMode,
        repeatCount: intent.repeatCount,
        stopOnFailure: true,
        steps: [
          {
            id: "free_composition_step_" + session.id + "_1",
            order: 1,
            metaFunctionId: generatedMetaFunction.id,
            enabled: true
          }
        ],
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      generatedMetaFunctions: [generatedMetaFunction]
    };
  }

  if (candidate.kind === "system_action") {
    const generatedMetaFunction = temporaryMetaFunctionForSystemAction(session, candidate, now);
    return {
      compositeCase: {
        id: "free_composition_case_" + session.id,
        appId: session.appId,
        platform: session.platform,
        name: "AI资产用例：" + generatedMetaFunction.name,
        description: "由自然语言临时组合生成：" + session.prompt,
        parameterProfileId,
        runMode: intent.runMode,
        repeatCount: intent.repeatCount,
        stopOnFailure: true,
        steps: [
          {
            id: "free_composition_step_" + session.id + "_1",
            order: 1,
            metaFunctionId: generatedMetaFunction.id,
            enabled: true
          }
        ],
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now
      },
      generatedMetaFunctions: [generatedMetaFunction]
    };
  }

  const source = metaFunctions.find((item) => item.id === candidate.id);
  if (!source) {
    throw new Error("找不到选中的元功能，请重新分析需求。");
  }

  return { compositeCase: {
    id: "free_composition_case_" + session.id,
    appId: session.appId,
    platform: session.platform,
    name: "AI资产用例：" + source.name,
    description: "由自然语言临时组合生成：" + session.prompt,
    parameterProfileId,
    runMode: intent.runMode,
    repeatCount: intent.repeatCount,
    stopOnFailure: true,
    steps: [
      {
        id: "free_composition_step_" + session.id + "_1",
        order: 1,
        metaFunctionId: source.id,
        enabled: true
      }
    ],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  } };
}

function temporaryMetaFunctionForSystemAction(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate,
  now: string,
  suffix = ""
): MetaFunction {
  if (candidate.systemAction !== "launch_app") {
    throw new Error("系统候选缺少可执行动作，请重新分析需求。");
  }
  const idSuffix = suffix ? `_${suffix}` : "";
  return {
    id: "free_composition_system_meta_" + session.id + idSuffix,
    appId: session.appId,
    platform: session.platform,
    name: candidate.name,
    description: "由AI资产用例临时包装的系统步骤，不会保存为正式元功能。",
    parameters: [],
    steps: [
      {
        id: "free_composition_launch_app_" + session.id + idSuffix,
        order: 1,
        enabled: true,
        kind: "system_action",
        actionType: "launch_app"
      }
    ],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function temporaryMetaFunctionForPageTransition(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate,
  now: string,
  suffix = ""
): MetaFunction {
  if (
    !candidate.sourcePageModelId ||
    !candidate.targetPageModelId ||
    !candidate.pageElementId ||
    !candidate.sourcePageModelName ||
    !candidate.targetPageModelName ||
    !candidate.pageElementLabel
  ) {
    throw new Error("页面连接候选缺少页面或能力信息，请重新分析需求。");
  }
  const idSuffix = suffix ? `_${suffix}` : "";
  return {
    id: "free_composition_transition_meta_" + session.id + idSuffix,
    appId: session.appId,
    platform: session.platform,
    name: `${candidate.sourcePageModelName} / ${candidate.pageElementLabel} → ${candidate.targetPageModelName}`,
    description: "由AI资产用例临时包装的页面连接，不会保存为正式元功能。",
    parameters: candidate.parameterKeys.map((key) => ({ key, type: "string", required: true })),
    steps: [
      {
        id: "free_composition_reach_source_" + session.id + idSuffix,
        order: 1,
        enabled: true,
        name: `确认当前在${candidate.sourcePageModelName}`,
        kind: "reach_page",
        targetPageModelId: candidate.sourcePageModelId
      },
      {
        id: "free_composition_invoke_transition_" + session.id + idSuffix,
        order: 2,
        enabled: true,
        name: `点击「${candidate.pageElementLabel}」并进入${candidate.targetPageModelName}`,
        kind: "invoke_capability",
        sourcePageModelId: candidate.sourcePageModelId,
        pageElementId: candidate.pageElementId,
        targetPageModelId: candidate.targetPageModelId
      }
    ],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function temporaryMetaFunctionForPageGoal(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate,
  now: string,
  suffix = ""
): MetaFunction {
  const pageModelId = candidate.targetPageModelId ?? candidate.pageModelId;
  const pageModelName = candidate.targetPageModelName ?? candidate.pageModelName;
  if (!pageModelId || !pageModelName) {
    throw new Error("页面目标候选缺少目标页面信息，请重新分析需求。");
  }
  const idSuffix = suffix ? `_${suffix}` : "";
  return {
    id: "free_composition_page_goal_meta_" + session.id + idSuffix,
    appId: session.appId,
    platform: session.platform,
    name: `到达${pageModelName}`,
    description: "执行时识别设备当前页面并动态规划到目标页，不会保存为正式元功能。",
    parameters: [],
    steps: [
      {
        id: "free_composition_reach_goal_" + session.id + idSuffix,
        order: 1,
        enabled: true,
        name: `执行时到达${pageModelName}`,
        kind: "reach_page",
        targetPageModelId: pageModelId
      }
    ],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function temporaryMetaFunctionForPageTask(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate,
  now: string,
  suffix = ""
): MetaFunction {
  if (!candidate.pageModelId || !candidate.pageTaskId || !candidate.pageModelName || !candidate.pageTaskName) {
    throw new Error("页面任务候选缺少页面或任务信息，请重新分析需求。");
  }
  const idSuffix = suffix ? `_${suffix}` : "";
  return {
    id: "free_composition_meta_" + session.id + idSuffix,
    appId: session.appId,
    platform: session.platform,
    name: `${candidate.pageModelName} / ${candidate.pageTaskName}`,
    description: "由AI资产用例临时包装的页面任务，不会保存为正式元功能。",
    parameters: candidate.parameters ?? candidate.parameterKeys.map((key) => ({ key, type: "string", required: true })),
    steps: [
      {
        id: "free_composition_reach_page_" + session.id + idSuffix,
        order: 1,
        enabled: true,
        name: `确认当前在${candidate.pageModelName}`,
        kind: "reach_page",
        targetPageModelId: candidate.pageModelId
      },
      {
        id: "free_composition_run_page_task_" + session.id + idSuffix,
        order: 2,
        enabled: true,
        name: `执行「${candidate.pageTaskName}」`,
        kind: "run_page_task",
        pageModelId: candidate.pageModelId,
        pageTaskId: candidate.pageTaskId
      }
    ],
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function freeCompositionStatusForExecution(status: AssetCompositeExecutionStatus): FreeCompositionSessionStatus {
  if (status === "passed") {
    return "passed";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "stopped") {
    return "stopped";
  }
  return "running";
}

function freeCompositionStatusForPlan(plan: AssetCompositeExecutionPlan): FreeCompositionSessionStatus {
  if (plan.status === "ready") {
    return plan.steps.length === 0 ? "passed" : "awaiting_confirmation";
  }
  if (plan.status === "needs_parameters") {
    return "awaiting_parameters";
  }
  return "blocked";
}

export function freeCompositionSessionRequiresExecution(session: FreeCompositionSession): boolean {
  const selectedCandidate = session.resolution.candidates.find((candidate) => candidate.id === session.selectedCandidateId);
  if (selectedCandidate?.requiresExecution === false) {
    return false;
  }
  return !(session.plan?.status === "ready" && session.plan.steps.length === 0);
}

function stringifyRuntimeOverrides(values: Record<string, string | number | boolean> | undefined): Record<string, string> | undefined {
  if (!values) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

function mergeRuntimeOverrides(
  left: Record<string, string> | undefined,
  right: Record<string, string | number | boolean> | undefined
): Record<string, string> | undefined {
  const merged = {
    ...(left ?? {}),
    ...(stringifyRuntimeOverrides(right) ?? {})
  };
  return Object.keys(merged).length ? merged : undefined;
}
