import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiDiagnosisConfig } from "./ai-diagnosis.js";
import {
  pageTaskCandidateId,
  pageTransitionCandidateId,
  resolveFreeComposition,
  systemActionCandidateId,
  type FreeCompositionCandidate,
  type FreeCompositionAiPlannerHints,
  type FreeCompositionResolution,
  type ResolveFreeCompositionInput
} from "./free-composition.js";

export const FREE_COMPOSITION_AI_PLANNER_DEVELOPER_INSTRUCTIONS = [
  "你是 AI资产用例 的自然语言 Planner，只负责理解用户意图并返回结构化提示。",
  "PageStateFlow 资产目录是唯一事实来源；只能引用输入中已经列出的 asset id、asset name、page name、parameter key。",
  "禁止执行点击、禁止生成坐标、禁止编造页面、禁止编造资产、禁止绕过系统校验。",
  "如果用户意图需要多个动作，请按执行顺序输出 orderedAssetIds 或 orderedAssetNames；不确定时留空并用 clarification 简短询问。",
  "如果用户说进入、打开、跳转、前往某个页面，优先输出 targetPageName；不要把页面进入意图升级为填写表单、创建、发布、提交。",
  "除非用户明确要求填写、输入、创建、发布、提交、保存，否则不要选择名称中包含这些动作的 page_task、meta_function 或 composite_case；页面名包含“新建/发布”不等于执行创建/发布动作。",
  "如果用户表达了执行次数或循环意图，请输出 runMode：once、repeat_n、loop_until_stop；repeat_n 必须同时输出 repeatCount（1-1000）。",
  "如果用户提出了当前系统协议无法表达或执行的要求，请输出 unsupportedRequirements，使用简短中文能力名，例如：步骤间隔等待、条件分支、随机数据生成。不要把 unsupportedRequirements 静默改写成可执行流程。",
  "runtimeOverrides 只放用户明确给出的参数值，例如 phone、password、className、lessonName。",
  "missingParams 只放资产目录中声明过但用户未给出的必填参数 key。",
  "riskTerms 只记录发布、提交、删除、退出登录、注销、支付这类明确肯定风险词，不代表已获得执行授权；不发布、不提交、不删除等否定表达不要输出风险词。",
  "必须只返回一个 JSON 对象，不要输出 markdown 代码块或解释文字。"
].join("\n");

type CatalogAsset = {
  id: string;
  kind: string;
  name: string;
  description?: string;
  parameterKeys: string[];
  sourcePageName?: string;
  targetPageName?: string;
};

type CatalogPage = {
  id: string;
  name: string;
};

type PlannerCatalog = {
  assets: CatalogAsset[];
  pages: CatalogPage[];
  parameterKeys: string[];
};

export type FreeCompositionAiPlanResult = {
  plan: FreeCompositionAiPlannerHints & { status: "used" };
  channel: "codex" | "openai-compatible";
};

export async function planFreeCompositionWithAiFallback(input: {
  config: AiDiagnosisConfig;
  prompt: string;
  input: ResolveFreeCompositionInput;
  fetchImpl?: AiClientFetch;
}): Promise<FreeCompositionAiPlannerHints> {
  if (canUseDeterministicFreeCompositionPlan(input.prompt, input.input)) {
    return { status: "fallback", errorMessage: "本地确定性规划已命中，未调用 AI。" };
  }
  if (!input.config.enabled) {
    return { status: "fallback", errorMessage: `AI 未启用：${input.config.reason}` };
  }
  try {
    return (await generateFreeCompositionAiPlan(input)).plan;
  } catch (error) {
    return {
      status: "fallback",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

export function canUseDeterministicFreeCompositionPlan(
  prompt: string,
  input: ResolveFreeCompositionInput
): boolean {
  const resolution = resolveFreeComposition(prompt, { ...input, aiPlanner: undefined });
  return deterministicResolutionCanSkipAi(resolution);
}

function deterministicResolutionCanSkipAi(resolution: FreeCompositionResolution): boolean {
  if (resolution.status !== "ready" || resolution.candidates.length !== 1) {
    return false;
  }
  return deterministicCandidateCanSkipAi(resolution.candidates[0]);
}

function deterministicCandidateCanSkipAi(candidate: FreeCompositionCandidate | undefined): boolean {
  if (!candidate || candidate.kind !== "generated_flow") {
    return false;
  }
  if (candidate.requiresExecution === false) {
    return true;
  }
  const composedIds = candidate.composedCandidateIds ?? [];
  return composedIds.length > 0 && composedIds.every((id) =>
    id.startsWith("page_transition:") || id.startsWith("page_task:")
  );
}

export async function generateFreeCompositionAiPlan(input: {
  config: AiDiagnosisConfig;
  prompt: string;
  input: ResolveFreeCompositionInput;
  fetchImpl?: AiClientFetch;
}): Promise<FreeCompositionAiPlanResult> {
  if (!input.config.enabled) {
    throw new Error(`AI 未启用：${input.config.reason}`);
  }
  const catalog = buildPlannerCatalog(input.input);
  const channel = isCodexAppServerProvider(input.config.baseURL) ? "codex" as const : "openai-compatible" as const;
  const result = await runAiJsonRequest(
    {
      baseURL: input.config.baseURL,
      apiKey: input.config.apiKey,
      model: input.config.model,
      timeoutMs: input.config.timeoutMs
    },
    {
      developerInstructions: FREE_COMPOSITION_AI_PLANNER_DEVELOPER_INSTRUCTIONS,
      userContent: buildFreeCompositionAiPlannerPrompt({
        prompt: input.prompt,
        appId: input.input.appId,
        platform: input.input.platform,
        currentPage: input.input.currentPage,
        currentPageDetectionFailure: input.input.currentPageDetectionFailure,
        catalog
      }),
      effort: "low"
    },
    input.fetchImpl ?? fetch
  );
  const plan = parseFreeCompositionAiPlannerResponse(result.content, catalog);
  return {
    channel,
    plan: {
      ...plan,
      channel,
      model: input.config.model
    }
  };
}

export function buildFreeCompositionAiPlannerPrompt(input: {
  prompt: string;
  appId: string;
  platform: string;
  currentPage?: ResolveFreeCompositionInput["currentPage"];
  currentPageDetectionFailure?: ResolveFreeCompositionInput["currentPageDetectionFailure"];
  catalog: PlannerCatalog;
}): string {
  return [
    "请根据用户自然语言和 PageStateFlow 资产目录，输出可供系统校验的结构化理解。",
    "",
    "输出 JSON Schema:",
    JSON.stringify({
      normalizedPrompt: "简短改写用户真实意图",
      orderedAssetIds: ["asset-id-1", "asset-id-2"],
      orderedAssetNames: ["资产名称1", "资产名称2"],
      targetPageName: "目标页面名",
      runMode: "repeat_n",
      repeatCount: 8,
      unsupportedRequirements: ["步骤间隔等待"],
      runtimeOverrides: { phone: "12133333302", className: "班级一号" },
      missingParams: ["password"],
      riskTerms: ["退出登录"],
      clarification: "",
      confidence: 0.9,
      summary: "一句话说明理解结果"
    }, null, 2),
    "",
    "输入:",
    JSON.stringify({
      appId: input.appId,
      platform: input.platform,
      prompt: input.prompt,
      currentPage: input.currentPage,
      currentPageDetectionFailure: input.currentPageDetectionFailure,
      assets: input.catalog.assets,
      pages: input.catalog.pages,
      allowedParameterKeys: input.catalog.parameterKeys
    }, null, 2)
  ].join("\n");
}

export function parseFreeCompositionAiPlannerResponse(raw: string, catalog: PlannerCatalog): FreeCompositionAiPlannerHints & { status: "used" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("AI 资产用例 Planner 输出不是合法 JSON");
  }
  const root = asRecord(parsed);
  const warnings: string[] = [];
  const assetNames = new Set(catalog.assets.map((asset) => asset.name));
  const assetIds = new Set(catalog.assets.map((asset) => asset.id));
  const pageNames = new Set(catalog.pages.map((page) => page.name));
  const parameterKeys = new Set(catalog.parameterKeys);

  const orderedAssetIds = filterKnownStrings(readStringArray(root.orderedAssetIds), assetIds, "未入库资产 ID", warnings);
  const orderedAssetNames = filterKnownStrings(readStringArray(root.orderedAssetNames), assetNames, "未入库资产", warnings);
  const rawTargetPageName = readNonEmptyString(root.targetPageName);
  const targetPageName = rawTargetPageName && pageNames.has(rawTargetPageName) ? rawTargetPageName : undefined;
  if (rawTargetPageName && !targetPageName) {
    warnings.push(`AI 返回了未入库页面，已忽略：${rawTargetPageName}`);
  }
  const runMode = readRunMode(root.runMode);
  const repeatCount = runMode === "repeat_n" ? readRepeatCount(root.repeatCount) : undefined;
  if (root.runMode !== undefined && !runMode) {
    warnings.push(`AI 返回了非法运行模式，已忽略：${String(root.runMode)}`);
  }
  if (runMode === "repeat_n" && !repeatCount) {
    warnings.push("AI 返回 repeat_n 但缺少合法 repeatCount，已回退为单次。");
  }

  return {
    status: "used",
    normalizedPrompt: readNonEmptyString(root.normalizedPrompt),
    orderedAssetIds,
    orderedAssetNames,
    targetPageName,
    runMode: runMode === "repeat_n" && !repeatCount ? undefined : runMode,
    repeatCount,
    unsupportedRequirements: readUnsupportedRequirements(root.unsupportedRequirements),
    runtimeOverrides: readRuntimeOverrides(root.runtimeOverrides, parameterKeys, warnings),
    missingParams: filterKnownStrings(readStringArray(root.missingParams), parameterKeys, "未声明参数", warnings),
    riskTerms: filterKnownStrings(readStringArray(root.riskTerms), new Set(["发布", "提交", "删除", "退出登录", "注销", "支付"]), "未知风险词", warnings),
    clarification: readNonEmptyString(root.clarification),
    confidence: clampConfidence(root.confidence),
    summary: readNonEmptyString(root.summary),
    warnings
  };
}

function buildPlannerCatalog(input: ResolveFreeCompositionInput): PlannerCatalog {
  const activeMetaFunctions = input.metaFunctions.filter((metaFunction) =>
    metaFunction.appId === input.appId &&
    metaFunction.platform === input.platform &&
    metaFunction.status === "active"
  );
  const metaFunctionsById = new Map(activeMetaFunctions.map((item) => [item.id, item]));
  const assets: CatalogAsset[] = [
    {
      id: systemActionCandidateId("launch_app"),
      kind: "system_action",
      name: "启动 App",
      description: "启动当前 App，不会保存为正式资产。",
      parameterKeys: []
    },
    ...input.compositeCases
      .filter((compositeCase) =>
        compositeCase.appId === input.appId &&
        compositeCase.platform === input.platform &&
        compositeCase.status === "active"
      )
      .map((compositeCase) => ({
        id: compositeCase.id,
        kind: "composite_case",
        name: compositeCase.name,
        description: compositeCase.description,
        parameterKeys: uniqueStrings(compositeCase.steps
          .filter((step) => step.enabled)
          .flatMap((step) => metaFunctionsById.get(step.metaFunctionId)?.parameters ?? [])
          .map((parameter) => parameter.key))
      })),
    ...activeMetaFunctions.map((metaFunction) => ({
      id: metaFunction.id,
      kind: "meta_function",
      name: metaFunction.name,
      description: metaFunction.description,
      parameterKeys: uniqueStrings(metaFunction.parameters.map((parameter) => parameter.key))
    })),
    ...(input.pageTasks ?? [])
      .filter((pageTask) =>
        pageTask.appId === input.appId &&
        pageTask.platform === input.platform &&
        pageTask.status !== "deprecated"
      )
      .map((pageTask) => ({
        id: pageTaskCandidateId(pageTask.pageModelId, pageTask.pageTaskId),
        kind: "page_task",
        name: `${pageTask.pageModelName} / ${pageTask.pageTaskName}`,
        parameterKeys: uniqueStrings(pageTask.parameterKeys),
        targetPageName: pageTask.pageModelName
      })),
    ...(input.pageTransitions ?? [])
      .filter((transition) =>
        transition.appId === input.appId &&
        transition.platform === input.platform &&
        transition.status !== "deprecated"
      )
      .map((transition) => ({
        id: pageTransitionCandidateId(transition.sourcePageModelId, transition.pageElementId, transition.targetPageModelId),
        kind: "page_transition",
        name: `${transition.sourcePageModelName} / ${transition.pageElementLabel} → ${transition.targetPageModelName}`,
        description: transition.pageTransitionName,
        parameterKeys: uniqueStrings(transition.parameterKeys ?? []),
        sourcePageName: transition.sourcePageModelName,
        targetPageName: transition.targetPageModelName
      }))
  ];
  const pages = (input.pageAssets ?? [])
    .filter((page) =>
      page.appId === input.appId &&
      page.platform === input.platform &&
      page.status !== "deprecated"
    )
    .map((page) => ({ id: page.pageModelId, name: page.pageModelName }));
  return {
    assets,
    pages,
    parameterKeys: uniqueStrings(assets.flatMap((asset) => asset.parameterKeys))
  };
}

function readRuntimeOverrides(value: unknown, parameterKeys: Set<string>, warnings: string[]): Record<string, string> {
  const record = asRecord(value);
  const entries: Array<[string, string]> = [];
  for (const [key, rawValue] of Object.entries(record)) {
    const trimmedKey = key.trim();
    if (!parameterKeys.has(trimmedKey)) {
      warnings.push(`AI 返回了未声明参数，已忽略：${trimmedKey}`);
      continue;
    }
    const stringValue = typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean"
      ? String(rawValue).trim()
      : "";
    if (stringValue) {
      entries.push([trimmedKey, stringValue]);
    }
  }
  return Object.fromEntries(entries);
}

function filterKnownStrings(values: string[], allowed: Set<string>, label: string, warnings: string[]): string[] {
  const result: string[] = [];
  for (const value of uniqueStrings(values)) {
    if (allowed.has(value)) {
      result.push(value);
    } else {
      warnings.push(`AI 返回了${label}，已忽略：${value}`);
    }
  }
  return result;
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error("输出中不包含 JSON 对象");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  throw new Error("输出中的 JSON 对象不完整");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readUnsupportedRequirements(value: unknown): string[] {
  return uniqueStrings(readStringArray(value).map((item) => item.slice(0, 80))).slice(0, 8);
}

function readRunMode(value: unknown): "once" | "repeat_n" | "loop_until_stop" | undefined {
  if (value === "once" || value === "repeat_n" || value === "loop_until_stop") {
    return value;
  }
  return undefined;
}

function readRepeatCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(1000, Math.floor(parsed)));
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
