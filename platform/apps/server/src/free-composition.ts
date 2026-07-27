import type {
  AssetCompositeCase,
  MetaFunction,
  Platform,
  RunMode
} from "@mobile-automation/shared";

export type FreeCompositionCandidateKind =
  | "composite_case"
  | "meta_function"
  | "page_task"
  | "page_transition"
  | "system_action"
  | "generated_flow";

export type FreeCompositionCandidate = {
  id: string;
  kind: FreeCompositionCandidateKind;
  appId: string;
  platform: Platform;
  name: string;
  description?: string;
  parameterProfileId?: string;
  parameterKeys: string[];
  score: number;
  matchedTerms: string[];
  pageModelId?: string;
  pageModelName?: string;
  pageTaskId?: string;
  pageTaskName?: string;
  sourcePageModelId?: string;
  sourcePageModelName?: string;
  targetPageModelId?: string;
  targetPageModelName?: string;
  pageElementId?: string;
  pageElementLabel?: string;
  pageTransitionId?: string;
  systemAction?: "launch_app";
  composedCandidateIds?: string[];
  composedCandidates?: FreeCompositionCandidate[];
  requiresExecution?: boolean;
};

export type FreeCompositionIntent = {
  prompt: string;
  runMode: RunMode;
  repeatCount: number;
  riskTerms: string[];
  runtimeOverrides: Record<string, string>;
};

export type FreeCompositionAiPlannerHints = {
  status: "used" | "fallback";
  normalizedPrompt?: string;
  targetPageName?: string;
  orderedAssetNames?: string[];
  orderedAssetIds?: string[];
  runtimeOverrides?: Record<string, string>;
  runMode?: RunMode;
  repeatCount?: number;
  unsupportedRequirements?: string[];
  missingParams?: string[];
  riskTerms?: string[];
  clarification?: string;
  summary?: string;
  confidence?: number;
  channel?: "codex" | "openai-compatible";
  model?: string;
  warnings?: string[];
  errorMessage?: string;
};

export type FreeCompositionRecordingIntent = {
  kind: "navigation" | "compound_navigation";
  sourcePageModelId?: string;
  sourcePageName?: string;
  targetPageModelId?: string;
  targetPageName: string;
  triggerLabel?: string;
  waitText?: string;
  tapText?: string;
  timeoutMs?: number;
};

export type FreeCompositionResolution = {
  status: "ready" | "needs_clarification" | "missing_assets";
  intent: FreeCompositionIntent;
  candidates: FreeCompositionCandidate[];
  message: string;
  aiPlanner?: FreeCompositionAiPlannerHints;
  recordingIntent?: FreeCompositionRecordingIntent;
};

export type ResolveFreeCompositionInput = {
  appId: string;
  platform: Platform;
  metaFunctions: MetaFunction[];
  compositeCases: AssetCompositeCase[];
  pageTasks?: FreeCompositionPageTaskAsset[];
  pageTransitions?: FreeCompositionPageTransitionAsset[];
  pageAssets?: FreeCompositionPageAsset[];
  pageAbilities?: FreeCompositionPageAbilityAsset[];
  currentPageDetectionAttempted?: boolean;
  currentPage?: {
    pageModelId: string;
    pageModelName?: string;
  };
  currentPageDetectionFailure?: {
    reason: "outside_app";
    expectedAppId?: string;
    actualAppId?: string;
  };
  aiPlanner?: FreeCompositionAiPlannerHints;
};

export type FreeCompositionPageTaskAsset = {
  appId: string;
  platform: Platform;
  pageModelId: string;
  pageModelName: string;
  pageTaskId: string;
  pageTaskName: string;
  parameterKeys: string[];
  status?: string;
};

export type FreeCompositionPageTransitionAsset = {
  appId: string;
  platform: Platform;
  sourcePageModelId: string;
  sourcePageModelName: string;
  targetPageModelId: string;
  targetPageModelName: string;
  pageElementId: string;
  pageElementLabel: string;
  pageTransitionId: string;
  pageTransitionName?: string;
  parameterKeys?: string[];
  status?: string;
};

export type FreeCompositionPageAsset = {
  appId: string;
  platform: Platform;
  pageModelId: string;
  pageModelName: string;
  status?: string;
};

export type FreeCompositionPageAbilityAsset = {
  appId: string;
  platform: Platform;
  pageModelId: string;
  pageModelName: string;
  pageElementId: string;
  pageElementLabel: string;
  targetPageModelId?: string;
  targetPageModelName?: string;
  status?: string;
};

const RISK_TERMS = ["发布", "提交", "删除", "退出登录", "注销", "支付"] as const;
const NON_NAVIGATION_ACTION_TERMS = [
  "填写",
  "填入",
  "输入",
  "选择",
  "勾选",
  "点击",
  "点一下",
  "发起",
  "创建",
  "新建",
  "发布",
  "提交",
  "保存",
  "完成",
  "确认",
  "支付",
  "删除",
  "退出登录",
  "注销",
  "登录",
  "登出"
] as const;
const ACTION_LIKE_PAGE_NAME_TERMS = new Set<string>(["创建", "新建", "发布", "提交", "支付", "登录"]);

const INTENT_TERMS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /登录|登陆|账号/, terms: ["登录", "账号"] },
  { pattern: /跳转|进入|详情/, terms: ["进入", "跳转", "详情"] },
  { pattern: /创建课堂|新建课堂|建课/, terms: ["课堂", "建课"] },
  { pattern: /公开课/, terms: ["公开课"] },
  { pattern: /班级|进入班级/, terms: ["班级"] },
  { pattern: /作业/, terms: ["作业"] },
  { pattern: /搜索/, terms: ["搜索"] }
];

export function parseFreeCompositionIntent(prompt: string, aiPlanner?: FreeCompositionAiPlannerHints): FreeCompositionIntent {
  const normalized = normalize(prompt);
  const repeatCountFromPrompt = repeatCountFromNormalizedPrompt(normalized);
  const aiRunMode = aiPlanner?.status === "used" ? aiPlanner.runMode : undefined;
  const repeatCountFromAi = aiRunMode === "repeat_n" ? aiPlanner?.repeatCount : undefined;
  const repeatCount = repeatCountFromPrompt
    ? clampRepeatCount(repeatCountFromPrompt)
    : repeatCountFromAi
      ? clampRepeatCount(repeatCountFromAi)
      : 1;
  const loopUntilStopped = /一直循环|持续循环|直到停止|无限循环/.test(normalized) || aiRunMode === "loop_until_stop";

  return {
    prompt: prompt.trim(),
    runMode: loopUntilStopped ? "loop_until_stop" : repeatCountFromPrompt || repeatCountFromAi ? "repeat_n" : "once",
    repeatCount: loopUntilStopped ? 1 : repeatCount,
    riskTerms: uniqueStrings([
      ...riskTermsInText(prompt),
      ...groundedAiRiskTerms(prompt, aiPlanner),
      ...riskTermsInText(aiPlanner?.normalizedPrompt ?? "")
    ]),
    runtimeOverrides: {
      ...extractRuntimeOverridesFromPrompt(prompt),
      ...normalizedAiRuntimeOverrides(aiPlanner?.runtimeOverrides)
    }
  };
}

function repeatCountFromNormalizedPrompt(normalizedPrompt: string): number | undefined {
  const explicitRepeatMatch = normalizedPrompt.match(/(?:循环|重复|执行|跑)(\d{1,4})次/);
  if (explicitRepeatMatch?.[1]) {
    return Number(explicitRepeatMatch[1]);
  }

  const trailingCountMatch = normalizedPrompt.match(/(\d{1,4})次$/);
  if (!trailingCountMatch?.[1]) {
    return undefined;
  }
  const countIndex = trailingCountMatch.index ?? -1;
  if (countIndex > 0 && normalizedPrompt[countIndex - 1] === "第") {
    return undefined;
  }
  const actionText = normalizedPrompt.slice(0, countIndex);
  if (!/(测试|测|验证|进入|打开|跳转|创建|新建|登录|发布|执行|跑|用例|流程)/.test(actionText)) {
    return undefined;
  }
  return Number(trailingCountMatch[1]);
}

export function riskTermsInText(text: string): string[] {
  const normalized = normalize(text);
  return RISK_TERMS.filter((term) => containsAffirmativeRiskTerm(normalized, term));
}

function groundedAiRiskTerms(prompt: string, aiPlanner: FreeCompositionAiPlannerHints | undefined): string[] {
  if (aiPlanner?.status !== "used") {
    return [];
  }
  const groundingText = normalize([prompt, aiPlanner.normalizedPrompt].filter(Boolean).join("\n"));
  return uniqueStrings(aiPlanner.riskTerms ?? []).filter((term) => containsAffirmativeRiskTerm(groundingText, term));
}

function containsAffirmativeRiskTerm(text: string, term: string): boolean {
  let index = text.indexOf(term);
  while (index >= 0) {
    if (
      !hasNegatedRiskPrefix(text.slice(Math.max(0, index - 12), index)) &&
      !hasPageReferenceRiskSuffix(text.slice(index + term.length, index + term.length + 12))
    ) {
      return true;
    }
    index = text.indexOf(term, index + term.length);
  }
  return false;
}

function hasNegatedRiskPrefix(prefix: string): boolean {
  return /(?:不|别|勿|未|非|无须|无需|不用|不要|不会|不需要|禁止)(?:进行|执行|去|再|直接)?$/.test(prefix);
}

function hasPageReferenceRiskSuffix(suffix: string): boolean {
  return /^(?:页|页面|入口|中心|列表|详情|设置|管理|记录|类型|选择|[\u4e00-\u9fa5]{0,8}(?:页|页面|入口|中心|列表|详情|设置|管理|记录))/.test(suffix);
}

export function resolveFreeComposition(
  prompt: string,
  input: ResolveFreeCompositionInput
): FreeCompositionResolution {
  const matchingPrompt = promptWithAiPlannerHints(prompt, input.aiPlanner);
  const intent = parseFreeCompositionIntent(prompt, input.aiPlanner);
  const unsupportedRequirements = unsupportedRequirementsFromAiPlanner(input.aiPlanner);
  if (unsupportedRequirements.length) {
    return withAiPlanner({
      status: "missing_assets",
      intent,
      candidates: [],
      message: unsupportedRequirementsMessage(prompt, input.aiPlanner, unsupportedRequirements)
    }, input.aiPlanner);
  }
  const activeMetaFunctions = input.metaFunctions.filter(
    (metaFunction) =>
      metaFunction.appId === input.appId &&
      metaFunction.platform === input.platform &&
      metaFunction.status === "active"
  );
  const metaFunctionsById = new Map(activeMetaFunctions.map((item) => [item.id, item]));
  const systemActionCandidate = buildSystemActionCandidate(matchingPrompt, input);
  const baseCandidates = [
    ...(systemActionCandidate ? [systemActionCandidate] : []),
    ...input.compositeCases
      .filter(
        (compositeCase) =>
          compositeCase.appId === input.appId &&
          compositeCase.platform === input.platform &&
          compositeCase.status === "active"
      )
      .map((compositeCase) =>
        buildCandidate(
          compositeCase,
          "composite_case",
          compositeCase.steps
            .filter((step) => step.enabled)
            .flatMap((step) => metaFunctionsById.get(step.metaFunctionId)?.parameters ?? [])
            .map((parameter) => parameter.key),
          matchingPrompt
        )
      ),
    ...activeMetaFunctions.map((metaFunction) =>
      buildCandidate(
        metaFunction,
        "meta_function",
        metaFunction.parameters.map((parameter) => parameter.key),
        matchingPrompt
      )
    ),
    ...(input.pageTasks ?? [])
      .filter((pageTask) =>
        pageTask.appId === input.appId &&
        pageTask.platform === input.platform &&
        pageTask.status !== "deprecated"
      )
      .map((pageTask) => buildPageTaskCandidate(pageTask, matchingPrompt)),
    ...(input.pageTransitions ?? [])
      .filter((pageTransition) =>
        pageTransition.appId === input.appId &&
        pageTransition.platform === input.platform &&
        pageTransition.status !== "deprecated"
      )
      .map((pageTransition) => buildPageTransitionCandidate(pageTransition, matchingPrompt))
  ]
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"));
  const fixedRouteFlow = buildFixedStartRouteCandidate(matchingPrompt, input, baseCandidates);
  if (fixedRouteFlow && shouldPreferFixedRouteForPageEntry(prompt, input.aiPlanner, fixedRouteFlow)) {
    return withAiPlanner({
      status: "ready",
      intent,
      candidates: [fixedRouteFlow],
      message: "已按固定流程线规划执行路径。执行时会根据当前设备页面动态接入流程线。"
    }, input.aiPlanner);
  }
  const fixedRouteWithActionFlow = fixedRouteFlow
    ? buildFixedRouteWithExplicitActionCandidate(prompt, fixedRouteFlow, baseCandidates)
    : undefined;
  const generatedFlow =
    fixedRouteWithActionFlow ??
    buildAiGeneratedFlowCandidate(input.aiPlanner, baseCandidates) ??
    buildGeneratedFlowCandidate(matchingPrompt, baseCandidates);
  if (!generatedFlow) {
    if (fixedRouteFlow) {
      return withAiPlanner({
        status: "ready",
        intent,
        candidates: [fixedRouteFlow],
        message: "已按固定流程线规划执行路径。执行时会根据当前设备页面动态接入流程线。"
      }, input.aiPlanner);
    }
  }
  const candidates = generatedFlow ? [generatedFlow, ...baseCandidates] : baseCandidates;

  if (candidates.length === 0) {
    const recordingIntent = missingAssetsRecordingIntent(matchingPrompt, input);
    return withAiPlanner({
      status: "missing_assets",
      intent,
      candidates: [],
      message: missingAssetsMessage(matchingPrompt, input),
      ...(recordingIntent ? { recordingIntent } : {})
    }, input.aiPlanner);
  }

  if (!generatedFlow && requiresClarification(matchingPrompt, candidates)) {
    return withAiPlanner({
      status: "needs_clarification",
      intent,
      candidates,
      message: "找到多个可能的流程，请选择你想执行的流程。"
    }, input.aiPlanner);
  }

  return withAiPlanner({
    status: "ready",
    intent,
    candidates,
    message: generatedFlow
      ? "已按需求生成临时执行流程。"
      : "已找到可执行候选，请选择要执行的流程。"
  }, input.aiPlanner);
}

function withAiPlanner(resolution: FreeCompositionResolution, aiPlanner: FreeCompositionAiPlannerHints | undefined): FreeCompositionResolution {
  return aiPlanner ? { ...resolution, aiPlanner } : resolution;
}

function unsupportedRequirementsFromAiPlanner(aiPlanner: FreeCompositionAiPlannerHints | undefined): string[] {
  if (aiPlanner?.status !== "used") {
    return [];
  }
  return uniqueStrings(aiPlanner.unsupportedRequirements ?? []);
}

function unsupportedRequirementsMessage(
  prompt: string,
  aiPlanner: FreeCompositionAiPlannerHints | undefined,
  unsupportedRequirements: string[]
): string {
  const understood = aiPlanner?.normalizedPrompt?.trim() || aiPlanner?.summary?.trim() || prompt.trim();
  return `AI已理解：${understood}。系统暂不支持：${unsupportedRequirements.join("、")}。请调整需求，或先补齐对应系统能力后重试。`;
}

function promptWithAiPlannerHints(prompt: string, aiPlanner: FreeCompositionAiPlannerHints | undefined): string {
  if (!aiPlanner || aiPlanner.status !== "used") {
    return prompt;
  }
  const hintLines = [
    prompt,
    aiPlanner.normalizedPrompt,
    aiPlanner.targetPageName ? `目标页面：${aiPlanner.targetPageName}` : "",
    aiPlanner.runMode === "repeat_n" && aiPlanner.repeatCount ? `重复执行${aiPlanner.repeatCount}次` : "",
    aiPlanner.runMode === "loop_until_stop" ? "持续循环直到停止" : "",
    orderedAssetHint(aiPlanner.orderedAssetNames),
    runtimeOverrideHint(aiPlanner.runtimeOverrides)
  ].filter((line): line is string => Boolean(line?.trim()));
  return hintLines.join("\n");
}

function orderedAssetHint(names: string[] | undefined): string {
  const ordered = uniqueStrings(names ?? []);
  if (!ordered.length) {
    return "";
  }
  return ordered.map((name, index) => `${index === 0 ? "先" : "然后"}${name}`).join(" ");
}

function runtimeOverrideHint(overrides: Record<string, string> | undefined): string {
  const entries = Object.entries(normalizedAiRuntimeOverrides(overrides));
  return entries.map(([key, value]) => `${key}=${value}`).join(" ");
}

function normalizedAiRuntimeOverrides(overrides: Record<string, string> | undefined): Record<string, string> {
  if (!overrides) {
    return {};
  }
  return Object.fromEntries(Object.entries(overrides)
    .map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : ""] as const)
    .filter(([key, value]) => key && value));
}

function buildAiGeneratedFlowCandidate(
  aiPlanner: FreeCompositionAiPlannerHints | undefined,
  candidates: FreeCompositionCandidate[]
): FreeCompositionCandidate | undefined {
  if (!aiPlanner || aiPlanner.status !== "used") {
    return undefined;
  }
  const orderedCandidates = candidatesForAiOrderedAssets(aiPlanner, candidates);
  if (orderedCandidates.length < 2) {
    return undefined;
  }
  return {
    id: "generated_flow:" + orderedCandidates.map((item) => item.id).join(">"),
    kind: "generated_flow",
    appId: orderedCandidates[0]!.appId,
    platform: orderedCandidates[0]!.platform,
    name: orderedCandidates.map((item) => item.name).join(" → "),
    description: "由 AI 理解自然语言后，经系统资产校验生成的临时流程，不会保存为正式资产。",
    parameterProfileId: orderedCandidates.find((item) => item.parameterProfileId)?.parameterProfileId,
    parameterKeys: uniqueStrings(orderedCandidates.flatMap((item) => item.parameterKeys)).sort(),
    score: orderedCandidates.reduce((sum, item) => sum + item.score, 180),
    matchedTerms: uniqueStrings(orderedCandidates.flatMap((item) => item.matchedTerms)),
    composedCandidateIds: orderedCandidates.map((item) => item.id)
  };
}

function candidatesForAiOrderedAssets(
  aiPlanner: FreeCompositionAiPlannerHints,
  candidates: FreeCompositionCandidate[]
): FreeCompositionCandidate[] {
  const selected: FreeCompositionCandidate[] = [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  for (const id of uniqueStrings(aiPlanner.orderedAssetIds ?? [])) {
    const candidate = byId.get(id);
    if (candidate && !selected.some((item) => item.id === candidate.id)) {
      selected.push(candidate);
    }
  }
  for (const name of uniqueStrings(aiPlanner.orderedAssetNames ?? [])) {
    const candidate = candidates.find((item) => item.name === name);
    if (candidate && !selected.some((item) => item.id === candidate.id)) {
      selected.push(candidate);
    }
  }
  return selected;
}

function buildPageTransitionCandidate(pageTransition: FreeCompositionPageTransitionAsset, prompt: string): FreeCompositionCandidate {
  const normalizedPrompt = normalize(prompt);
  const normalizedSource = normalize(pageTransition.sourcePageModelName);
  const normalizedTarget = normalize(pageTransition.targetPageModelName);
  const normalizedElement = normalize(pageTransition.pageElementLabel);
  const normalizedTransition = normalize(pageTransition.pageTransitionName ?? "");
  const matchedTerms: string[] = [];
  let score = 0;

  if (normalizedTarget && normalizedPrompt.includes(normalizedTarget)) {
    score += 90;
    matchedTerms.push(pageTransition.targetPageModelName);
  }
  if (normalizedElement && normalizedPrompt.includes(normalizedElement)) {
    score += 75;
    matchedTerms.push(pageTransition.pageElementLabel);
  }
  if (normalizedTransition && normalizedPrompt.includes(normalizedTransition)) {
    score += 70;
    matchedTerms.push(pageTransition.pageTransitionName ?? "");
  }
  if (normalizedSource && normalizedPrompt.includes(normalizedSource)) {
    score += 35;
    matchedTerms.push(pageTransition.sourcePageModelName);
  }
  for (const intentTerm of INTENT_TERMS) {
    if (!intentTerm.pattern.test(normalizedPrompt)) {
      continue;
    }
    for (const term of intentTerm.terms) {
      if (normalizedTarget.includes(term) || normalizedElement.includes(term) || normalizedTransition.includes(term)) {
        score += 30;
        matchedTerms.push(term);
      }
    }
  }

  return {
    id: pageTransitionCandidateId(pageTransition.sourcePageModelId, pageTransition.pageElementId, pageTransition.targetPageModelId),
    kind: "page_transition",
    appId: pageTransition.appId,
    platform: pageTransition.platform,
    name: `${pageTransition.sourcePageModelName} / ${pageTransition.pageElementLabel} → ${pageTransition.targetPageModelName}`,
    description: pageTransition.pageTransitionName,
    parameterKeys: uniqueStrings(pageTransition.parameterKeys ?? []),
    score,
    matchedTerms: [...new Set(matchedTerms.filter(Boolean))],
    sourcePageModelId: pageTransition.sourcePageModelId,
    sourcePageModelName: pageTransition.sourcePageModelName,
    targetPageModelId: pageTransition.targetPageModelId,
    targetPageModelName: pageTransition.targetPageModelName,
    pageElementId: pageTransition.pageElementId,
    pageElementLabel: pageTransition.pageElementLabel,
    pageTransitionId: pageTransition.pageTransitionId
  };
}

function buildSystemActionCandidate(prompt: string, input: ResolveFreeCompositionInput): FreeCompositionCandidate | undefined {
  if (!containsAppLaunchIntent(prompt)) {
    return undefined;
  }
  return {
    id: systemActionCandidateId("launch_app"),
    kind: "system_action",
    appId: input.appId,
    platform: input.platform,
    name: "启动 App",
    description: "启动当前 App，不会保存为正式资产。",
    parameterKeys: [],
    score: 160,
    matchedTerms: ["打开 App"],
    systemAction: "launch_app"
  };
}

export function systemActionCandidateId(action: "launch_app"): string {
  return `system_action:${action}`;
}

export function pageTransitionCandidateId(sourcePageModelId: string, pageElementId: string, targetPageModelId: string): string {
  return `page_transition:${sourcePageModelId}:${pageElementId}:${targetPageModelId}`;
}

function buildPageTaskCandidate(pageTask: FreeCompositionPageTaskAsset, prompt: string): FreeCompositionCandidate {
  const normalizedPrompt = normalize(prompt);
  const normalizedPageName = normalize(pageTask.pageModelName);
  const normalizedTaskName = normalize(pageTask.pageTaskName);
  const matchedTerms: string[] = [];
  let score = 0;

  if (normalizedPageName && normalizedPrompt.includes(normalizedPageName)) {
    score += 45;
    matchedTerms.push(pageTask.pageModelName);
  }
  if (normalizedTaskName && normalizedPrompt.includes(normalizedTaskName)) {
    score += 80;
    matchedTerms.push(pageTask.pageTaskName);
  }
  for (const intentTerm of INTENT_TERMS) {
    if (!intentTerm.pattern.test(normalizedPrompt)) {
      continue;
    }
    for (const term of intentTerm.terms) {
      if (normalizedPageName.includes(term) || normalizedTaskName.includes(term)) {
        score += 30;
        matchedTerms.push(term);
      }
    }
  }

  return {
    id: pageTaskCandidateId(pageTask.pageModelId, pageTask.pageTaskId),
    kind: "page_task",
    appId: pageTask.appId,
    platform: pageTask.platform,
    name: `${pageTask.pageModelName} / ${pageTask.pageTaskName}`,
    parameterKeys: uniqueStrings(pageTask.parameterKeys),
    score,
    matchedTerms: [...new Set(matchedTerms)],
    pageModelId: pageTask.pageModelId,
    pageModelName: pageTask.pageModelName,
    pageTaskId: pageTask.pageTaskId,
    pageTaskName: pageTask.pageTaskName
  };
}

export function pageTaskCandidateId(pageModelId: string, pageTaskId: string): string {
  return `page_task:${pageModelId}:${pageTaskId}`;
}

function buildCandidate(
  source: AssetCompositeCase | MetaFunction,
  kind: FreeCompositionCandidateKind,
  parameterKeys: string[],
  prompt: string
): FreeCompositionCandidate {
  const normalizedPrompt = normalize(prompt);
  const normalizedName = normalize(source.name);
  const normalizedDescription = normalize(source.description ?? "");
  const matchedTerms: string[] = [];
  let score = 0;

  // A saved case often adds a suffix such as "巡检" or "用例". Match its
  // meaningful name first so an explicitly named workflow wins over an atom.
  const coreName = normalizedName.replace(/(?:巡检|测试|流程|用例)$/g, "");

  if (normalizedName && normalizedPrompt.includes(normalizedName)) {
    score += 100;
    matchedTerms.push(source.name);
  } else if (coreName.length >= 2 && normalizedPrompt.includes(coreName)) {
    score += 80;
    matchedTerms.push(coreName);
  }

  if (isGenericCourseCreationIntent(normalizedPrompt)) {
    if (normalizedName.includes("课堂") || normalizedName.includes("公开课")) {
      score += 30;
      matchedTerms.push("建课");
    }
  }

  for (const intentTerm of INTENT_TERMS) {
    if (!intentTerm.pattern.test(normalizedPrompt)) {
      continue;
    }
    for (const term of intentTerm.terms) {
      if (normalizedName.includes(term)) {
        score += 30;
        matchedTerms.push(term);
      } else if (normalizedDescription.includes(term)) {
        score += 12;
        matchedTerms.push(term);
      }
    }
  }

  for (const riskTerm of RISK_TERMS) {
    if (normalizedPrompt.includes(riskTerm) && normalizedName.includes(riskTerm)) {
      score += 20;
      matchedTerms.push(riskTerm);
    }
  }

  return {
    id: source.id,
    kind,
    appId: source.appId,
    platform: source.platform,
    name: source.name,
    description: source.description,
    parameterProfileId: kind === "composite_case" && "parameterProfileId" in source ? source.parameterProfileId : undefined,
    parameterKeys: [...new Set(parameterKeys)],
    score,
    matchedTerms: [...new Set(matchedTerms)]
  };
}

function requiresClarification(prompt: string, candidates: FreeCompositionCandidate[]): boolean {
  if (candidates.length < 2) {
    return false;
  }

  const normalized = normalize(prompt);
  const [first, second] = candidates;
  const closeScores = first.score - second.score <= 10;
  const ambiguousCourseCreation =
    isGenericCourseCreationIntent(normalized) &&
    !normalized.includes("公开课") &&
    candidates.some((candidate) => candidate.name.includes("公开课")) &&
    candidates.some((candidate) => candidate.name.includes("课堂") && !candidate.name.includes("公开课"));

  return closeScores || ambiguousCourseCreation;
}

function isGenericCourseCreationIntent(normalizedPrompt: string): boolean {
  return /创建课堂|新建课堂|建课/.test(normalizedPrompt);
}

function clampRepeatCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(1000, Math.floor(value)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function extractRuntimeOverridesFromPrompt(prompt: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  const directKeyValue = /([a-zA-Z][a-zA-Z0-9_.-]{0,63})\s*(?:=|:|：|为|是)\s*([^，,。；;\n\r]+)/g;
  for (const match of prompt.matchAll(directKeyValue)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value) {
      overrides[key] = value;
    }
  }

  assignAliasValue(overrides, "phone", prompt, /(?:账号|帐号|手机号|手机号码|手机|phone|account)\s*(?:为|是|=|:|：)?\s*([0-9][0-9\s-]{4,})/i, (value) => value.replace(/\D/g, ""));
  assignAliasValue(overrides, "password", prompt, /(?:密码|password|pwd)\s*(?:为|是|=|:|：)\s*([^，,。；;\s]+)/i);
  assignAliasValue(overrides, "className", prompt, /(?:班级名|班级名称|班级|className)\s*(?:为|是|=|:|：)\s*([^，,。；;\n\r]+)/i);
  assignAliasValue(overrides, "className", prompt, /(班级[一二三四五六七八九十百千万零〇两0-9]+号?)(?:的?班级详情|详情|$|[，,。；;\s])/i);
  assignAliasValue(overrides, "lessonName", prompt, /(?:课堂名|课堂名称|课程名|课程名称|lessonName)\s*(?:为|是|=|:|：)\s*([^，,。；;\n\r]+)/i);
  assignAliasValue(overrides, "duration", prompt, /(?:课堂时长|时长|duration)\s*(?:为|是|=|:|：)?\s*(\d{1,4})/i);

  return overrides;
}

function assignAliasValue(
  target: Record<string, string>,
  key: string,
  prompt: string,
  pattern: RegExp,
  normalizeValue: (value: string) => string = (value) => value.trim()
): void {
  const match = prompt.match(pattern);
  const value = match?.[1] ? normalizeValue(match[1]) : "";
  if (value) {
    target[key] = value;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildGeneratedFlowCandidate(prompt: string, candidates: FreeCompositionCandidate[]): FreeCompositionCandidate | undefined {
  const segments = orderedPromptSegments(prompt);
  if (segments.length < 2) {
    return undefined;
  }
  const selected: FreeCompositionCandidate[] = [];
  for (const segment of segments) {
    const candidate = bestCandidateForSegment(segment, candidates, new Set(selected.map((item) => item.id)));
    if (candidate) {
      selected.push(candidate);
    }
  }
  if (selected.length < 2) {
    return undefined;
  }
  const ordered = selected.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);
  if (ordered.length < 2) {
    return undefined;
  }
  return {
    id: "generated_flow:" + ordered.map((item) => item.id).join(">"),
    kind: "generated_flow",
    appId: ordered[0]!.appId,
    platform: ordered[0]!.platform,
    name: ordered.map((item) => item.name).join(" → "),
    description: "由自然语言顺序生成的临时流程，不会保存为正式资产。",
    parameterProfileId: ordered.find((item) => item.parameterProfileId)?.parameterProfileId,
    parameterKeys: uniqueStrings(ordered.flatMap((item) => item.parameterKeys)).sort(),
    score: ordered.reduce((sum, item) => sum + item.score, 100),
    matchedTerms: uniqueStrings(ordered.flatMap((item) => item.matchedTerms)),
    composedCandidateIds: ordered.map((item) => item.id)
  };
}

function buildFixedStartRouteCandidate(
  prompt: string,
  input: ResolveFreeCompositionInput,
  baseCandidates: FreeCompositionCandidate[]
): FreeCompositionCandidate | undefined {
  if (!isTargetPageNavigationIntent(prompt)) {
    return undefined;
  }
  const targetPage = bestTargetPageForPrompt(prompt, input);
  if (!targetPage) {
    return undefined;
  }
  const startPage = bestFixedStartPage(input, targetPage.pageModelId);
  if (!startPage) {
    return undefined;
  }
  if (targetPage.pageModelId === startPage.pageModelId) {
    return {
      id: `generated_flow:fixed_start:${targetPage.pageModelId}`,
      kind: "generated_flow",
      appId: input.appId,
      platform: input.platform,
      name: `固定起点已是${targetPage.pageModelName}`,
      description: `目标页“${targetPage.pageModelName}”就是固定流程起点，无需额外资产步骤。`,
      parameterKeys: [],
      score: 240,
      matchedTerms: [targetPage.pageModelName],
      pageModelId: startPage.pageModelId,
      pageModelName: startPage.pageModelName,
      targetPageModelId: targetPage.pageModelId,
      targetPageModelName: targetPage.pageModelName,
      composedCandidateIds: [],
      composedCandidates: [],
      requiresExecution: false
    };
  }
  const path = shortestPageTransitionPath(startPage.pageModelId, targetPage.pageModelId, input);
  if (!path.length) {
    return undefined;
  }
  const composedCandidates = path.map((transition) => {
    const candidateId = pageTransitionCandidateId(transition.sourcePageModelId, transition.pageElementId, transition.targetPageModelId);
    return baseCandidates.find((candidate) => candidate.id === candidateId) ?? buildPageTransitionCandidate(transition, prompt);
  });
  return {
    id: "generated_flow:" + composedCandidates.map((item) => item.id).join(">"),
    kind: "generated_flow",
    appId: input.appId,
    platform: input.platform,
    name: composedCandidates.map((item) => item.name).join(" → "),
    description: `由固定流程起点“${startPage.pageModelName}”到目标页“${targetPage.pageModelName}”规划的临时流程。执行时会根据设备当前页面动态接入流程线。`,
    parameterProfileId: composedCandidates.find((item) => item.parameterProfileId)?.parameterProfileId,
    parameterKeys: uniqueStrings(composedCandidates.flatMap((item) => item.parameterKeys)).sort(),
    score: composedCandidates.reduce((sum, item) => sum + item.score, 120),
    matchedTerms: uniqueStrings([targetPage.pageModelName, ...composedCandidates.flatMap((item) => item.matchedTerms)]),
    composedCandidateIds: composedCandidates.map((item) => item.id),
    composedCandidates
  };
}

function shouldPreferFixedRouteForPageEntry(
  prompt: string,
  aiPlanner: FreeCompositionAiPlannerHints | undefined,
  fixedRouteFlow: FreeCompositionCandidate
): boolean {
  const targetPageName = fixedRouteFlow.targetPageModelName ?? aiPlanner?.targetPageName ?? fixedRouteFlow.pageModelName ?? "";
  const navigationIntentText = [
    prompt,
    aiPlanner?.status === "used" ? aiPlanner.normalizedPrompt : "",
    targetPageName ? `进入${targetPageName}` : ""
  ].filter((line): line is string => Boolean(line?.trim())).join("\n");
  if (!isTargetPageNavigationIntent(navigationIntentText)) {
    return false;
  }
  return !containsExplicitNonNavigationAction(prompt, targetPageName);
}

function buildFixedRouteWithExplicitActionCandidate(
  prompt: string,
  fixedRouteFlow: FreeCompositionCandidate,
  candidates: FreeCompositionCandidate[]
): FreeCompositionCandidate | undefined {
  const targetPageName = fixedRouteFlow.targetPageModelName ?? fixedRouteFlow.pageModelName ?? "";
  if (!containsExplicitNonNavigationAction(prompt, targetPageName)) {
    return undefined;
  }
  const routeCandidates = composedCandidatesForFlow(fixedRouteFlow, candidates);
  const usedIds = new Set(routeCandidates.map((candidate) => candidate.id));
  const actionCandidate = bestExplicitPageActionCandidate(
    prompt,
    targetPageName,
    fixedRouteFlow.targetPageModelId ?? fixedRouteFlow.pageModelId,
    candidates,
    usedIds
  );
  if (!actionCandidate) {
    return undefined;
  }
  const ordered = uniqueCandidates([...routeCandidates, actionCandidate]);
  return {
    id: "generated_flow:" + ordered.map((item) => item.id).join(">"),
    kind: "generated_flow",
    appId: fixedRouteFlow.appId,
    platform: fixedRouteFlow.platform,
    name: ordered.map((item) => item.name).join(" → "),
    description: `由固定流程线进入“${targetPageName}”后接续用户明确要求的页面动作。`,
    parameterProfileId: ordered.find((item) => item.parameterProfileId)?.parameterProfileId,
    parameterKeys: uniqueStrings(ordered.flatMap((item) => item.parameterKeys)).sort(),
    score: fixedRouteFlow.score + actionCandidate.score + 80,
    matchedTerms: uniqueStrings([...fixedRouteFlow.matchedTerms, ...actionCandidate.matchedTerms]),
    targetPageModelId: fixedRouteFlow.targetPageModelId,
    targetPageModelName: fixedRouteFlow.targetPageModelName,
    composedCandidateIds: ordered.map((item) => item.id),
    composedCandidates: ordered
  };
}

function composedCandidatesForFlow(
  flow: FreeCompositionCandidate,
  candidates: FreeCompositionCandidate[]
): FreeCompositionCandidate[] {
  if (flow.composedCandidates) {
    return flow.composedCandidates;
  }
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return (flow.composedCandidateIds ?? []).flatMap((id) => {
    const candidate = byId.get(id);
    return candidate ? [candidate] : [];
  });
}

function bestExplicitPageActionCandidate(
  prompt: string,
  targetPageName: string,
  targetPageModelId: string | undefined,
  candidates: FreeCompositionCandidate[],
  usedIds: Set<string>
): FreeCompositionCandidate | undefined {
  return candidates
    .filter((candidate) => !usedIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      score: explicitPageActionScore(candidate, prompt, targetPageName, targetPageModelId)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      candidateKindPriority(left.candidate.kind) - candidateKindPriority(right.candidate.kind) ||
      left.candidate.name.localeCompare(right.candidate.name, "zh-CN")
    )[0]?.candidate;
}

function explicitPageActionScore(
  candidate: FreeCompositionCandidate,
  prompt: string,
  targetPageName: string,
  targetPageModelId: string | undefined
): number {
  if (!isExecutableActionCandidate(candidate)) {
    return 0;
  }
  const actionTerms = explicitActionTerms(actionTextWithoutNavigationTarget(prompt, targetPageName));
  if (!actionTerms.length) {
    return 0;
  }
  const candidateText = normalize([
    candidate.name,
    candidate.description,
    candidate.pageTaskName,
    candidate.pageModelName
  ].filter(Boolean).join(""));
  const actionTermScore = actionTerms.some((term) => candidateText.includes(term)) ? 100 : 0;
  if (!actionTermScore) {
    return 0;
  }
  let score = actionTermScore + candidateScoreForText(candidate, prompt);
  if (candidate.kind === "page_task") {
    if (targetPageModelId && candidate.pageModelId !== targetPageModelId) {
      return 0;
    }
    score += 120;
  }
  return score;
}

function isExecutableActionCandidate(candidate: FreeCompositionCandidate): boolean {
  return candidate.kind === "page_task" || candidate.kind === "meta_function" || candidate.kind === "composite_case";
}

function containsExplicitNonNavigationAction(prompt: string, targetPageName: string): boolean {
  return explicitActionTerms(actionTextWithoutNavigationTarget(prompt, targetPageName)).length > 0;
}

function actionTextWithoutNavigationTarget(prompt: string, targetPageName: string): string {
  const normalizedTargetPageName = normalize(targetPageName);
  return normalizedTargetPageName
    ? normalize(prompt).replaceAll(normalizedTargetPageName, "")
    : normalize(prompt);
}

function explicitActionTerms(text: string): string[] {
  return NON_NAVIGATION_ACTION_TERMS.filter((term) => containsExplicitActionTerm(text, term));
}

function containsExplicitActionTerm(text: string, term: string): boolean {
  let index = text.indexOf(term);
  while (index >= 0) {
    if (!isNavigationTargetTerm(text, term, index)) {
      return true;
    }
    index = text.indexOf(term, index + term.length);
  }
  return false;
}

function isNavigationTargetTerm(text: string, term: string, index: number): boolean {
  if (!ACTION_LIKE_PAGE_NAME_TERMS.has(term)) {
    return false;
  }
  const prefix = text.slice(Math.max(0, index - 12), index);
  const suffix = text.slice(index + term.length, index + term.length + 12);
  return /(?:测试|验证|测)?(?:进入|打开|跳转到|跳到|前往|去到|到)$/.test(prefix) &&
    /^(?:页|页面|入口|中心|列表|详情|设置|管理|记录|类型|选择页|活动|课堂|公开课|作业|测验|资料|录播课|课程|方案|信息|班级|账号)/.test(suffix);
}

function uniqueCandidates(candidates: FreeCompositionCandidate[]): FreeCompositionCandidate[] {
  return candidates.filter((item, index, array) => array.findIndex((candidate) => candidate.id === item.id) === index);
}

function bestFixedStartPage(input: ResolveFreeCompositionInput, targetPageModelId: string): FreeCompositionPageAsset | undefined {
  const pages = (input.pageAssets ?? [])
    .filter((page) => page.appId === input.appId && page.platform === input.platform && page.status !== "deprecated");
  const scoredPages = pages
    .map((page) => ({
      page,
      score: fixedStartPageScore(page)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.page.pageModelName.localeCompare(right.page.pageModelName, "zh-CN"));
  for (const item of scoredPages) {
    if (item.page.pageModelId === targetPageModelId || shortestPageTransitionPath(item.page.pageModelId, targetPageModelId, input).length) {
      return item.page;
    }
  }
  return undefined;
}

function fixedStartPageScore(page: FreeCompositionPageAsset): number {
  const normalizedName = normalize(page.pageModelName);
  const normalizedId = normalize(page.pageModelId);
  if (/^(主页|首页|首页tab|主页面)$/.test(normalizedName)) {
    return 120;
  }
  if (normalizedName.includes("主页") || normalizedName.includes("首页")) {
    return 100;
  }
  if (/(^|[-_:])(home|main|root)([-_:]|$)/i.test(page.pageModelId) || /page(home|main|root)/.test(normalizedId)) {
    return 80;
  }
  return 0;
}

function bestTargetPageForPrompt(prompt: string, input: ResolveFreeCompositionInput): FreeCompositionPageAsset | undefined {
  return (input.pageAssets ?? [])
    .filter((page) => page.appId === input.appId && page.platform === input.platform && page.status !== "deprecated")
    .map((page) => ({ page, score: targetPageScore(prompt, page.pageModelName) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.page.pageModelName.localeCompare(right.page.pageModelName, "zh-CN"))[0]?.page;
}

function targetPageScore(prompt: string, pageModelName: string): number {
  const normalizedPrompt = normalize(prompt);
  const normalizedPageName = normalize(pageModelName);
  if (!normalizedPageName) {
    return 0;
  }
  if (normalizedPrompt.includes(normalizedPageName)) {
    return 100;
  }
  return textMatchScore(prompt, pageModelName);
}

function shortestPageTransitionPath(
  sourcePageModelId: string,
  targetPageModelId: string,
  input: ResolveFreeCompositionInput
): FreeCompositionPageTransitionAsset[] {
  const transitions = (input.pageTransitions ?? [])
    .filter((transition) =>
      transition.appId === input.appId &&
      transition.platform === input.platform &&
      transition.status !== "deprecated"
    )
    .sort((left, right) => (left.pageTransitionName ?? left.pageElementLabel).localeCompare(right.pageTransitionName ?? right.pageElementLabel, "zh-CN"));
  const queue: Array<{ pageModelId: string; path: FreeCompositionPageTransitionAsset[] }> = [{ pageModelId: sourcePageModelId, path: [] }];
  const visited = new Set<string>([sourcePageModelId]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const transition of transitions.filter((item) => item.sourcePageModelId === current.pageModelId)) {
      if (visited.has(transition.targetPageModelId)) {
        continue;
      }
      const path = [...current.path, transition];
      if (transition.targetPageModelId === targetPageModelId) {
        return path;
      }
      visited.add(transition.targetPageModelId);
      queue.push({ pageModelId: transition.targetPageModelId, path });
    }
  }
  return [];
}

function isTargetPageNavigationIntent(prompt: string): boolean {
  const normalized = normalize(prompt);
  return /跳转到|跳到|进入|打开|前往|去到|到.+页/.test(normalized);
}

function orderedPromptSegments(prompt: string): string[] {
  return prompt
    .split(/(?:先|然后|再|接着|之后|随后|并且|，|,|。|；|;)/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 2);
}

function bestCandidateForSegment(
  segment: string,
  candidates: FreeCompositionCandidate[],
  usedIds: Set<string>
): FreeCompositionCandidate | undefined {
  return candidates
    .filter((candidate) => !usedIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      score: candidateScoreForText(candidate, segment)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      candidateKindPriority(left.candidate.kind) - candidateKindPriority(right.candidate.kind) ||
      left.candidate.name.localeCompare(right.candidate.name, "zh-CN")
    )[0]?.candidate;
}

function candidateScoreForText(candidate: FreeCompositionCandidate, text: string): number {
  const normalizedText = normalize(text);
  const normalizedName = normalize(candidate.name);
  const normalizedDescription = normalize(candidate.description ?? "");
  const coreName = normalizedName.replace(/(?:巡检|测试|流程|用例)$/g, "");
  let score = 0;

  if (normalizedName && normalizedText.includes(normalizedName)) {
    score += 100;
  } else if (coreName.length >= 2 && normalizedText.includes(coreName)) {
    score += 80;
  }
  if (candidate.kind === "page_task") {
    const pageName = normalize(candidate.pageModelName ?? "");
    const taskName = normalize(candidate.pageTaskName ?? "");
    if (pageName && normalizedText.includes(pageName)) {
      score += 45;
    }
    if (taskName && normalizedText.includes(taskName)) {
      score += 80;
    }
  }
  if (candidate.kind === "system_action" && candidate.systemAction === "launch_app" && isAppLaunchIntent(text)) {
    score += 160;
  }
  for (const intentTerm of INTENT_TERMS) {
    if (!intentTerm.pattern.test(normalizedText)) {
      continue;
    }
    for (const term of intentTerm.terms) {
      if (normalizedName.includes(term)) {
        score += 30;
      } else if (normalizedDescription.includes(term)) {
        score += 12;
      }
      if (candidate.kind === "page_task") {
        const pageName = normalize(candidate.pageModelName ?? "");
        const taskName = normalize(candidate.pageTaskName ?? "");
        if (pageName.includes(term) || taskName.includes(term)) {
          score += 30;
        }
      }
    }
  }
  return score;
}

function candidateKindPriority(kind: FreeCompositionCandidateKind): number {
  if (kind === "system_action") {
    return 0;
  }
  if (kind === "page_task") {
    return 1;
  }
  if (kind === "meta_function") {
    return 2;
  }
  if (kind === "composite_case") {
    return 3;
  }
  if (kind === "page_transition") {
    return 4;
  }
  return 5;
}

function missingAssetsMessage(prompt: string, input: ResolveFreeCompositionInput): string {
  const matchingPages = matchingPageAssets(prompt, input);

  const page = matchingPages[0]?.page;
  const ability = matchingPageAbilities(prompt, input, page)[0]?.ability;
  if (page && ability) {
    return `已找到页面资产“${page.pageModelName}”，也找到可能的入口能力“${ability.pageModelName} / ${ability.pageElementLabel}”，但没有找到绑定到该页面的 active 连接边或页面任务。请先在资产录制中确认“${ability.pageElementLabel}”进入“${page.pageModelName}”的连接边，或创建对应元功能。`;
  }
  if (page) {
    return `已找到页面资产“${page.pageModelName}”，但没有找到可执行到该页面的 active 连接边、页面任务、元功能或组合用例。请先录入入口能力/连接边，或为该页面创建 PageTask / 元功能。`;
  }
  if (ability) {
    return `已找到页面能力“${ability.pageModelName} / ${ability.pageElementLabel}”，但没有找到完整目标页面或可执行连接边。请先在资产录制中补齐目标页面和连接边。`;
  }
  return "没有找到可执行候选。请先录入相关页面任务、页面能力，或创建元功能。";
}

function missingAssetsRecordingIntent(prompt: string, input: ResolveFreeCompositionInput): FreeCompositionRecordingIntent | undefined {
  const page = matchingPageAssets(prompt, input)[0]?.page;
  if (!page) {
    return undefined;
  }
  const ability = matchingPageAbilities(prompt, input, page)[0]?.ability;
  if (!ability || !pageAbilityTargetsPage(ability, page)) {
    return undefined;
  }
  const kind = moreMenuItemName(page.pageModelName) ? "compound_navigation" : "navigation";
  return {
    kind,
    sourcePageModelId: ability.pageModelId,
    sourcePageName: ability.pageModelName,
    targetPageModelId: page.pageModelId,
    targetPageName: page.pageModelName,
    triggerLabel: ability.pageElementLabel,
    ...(kind === "compound_navigation"
      ? {
          waitText: page.pageModelName,
          tapText: page.pageModelName
        }
      : {})
  };
}

function matchingPageAssets(prompt: string, input: ResolveFreeCompositionInput): Array<{ page: FreeCompositionPageAsset; score: number }> {
  return (input.pageAssets ?? [])
    .filter((page) => page.appId === input.appId && page.platform === input.platform && page.status !== "deprecated")
    .map((page) => ({ page, score: textMatchScore(prompt, page.pageModelName) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.page.pageModelName.localeCompare(right.page.pageModelName, "zh-CN"));
}

function matchingPageAbilities(
  prompt: string,
  input: ResolveFreeCompositionInput,
  targetPage?: FreeCompositionPageAsset
): Array<{ ability: FreeCompositionPageAbilityAsset; score: number }> {
  return (input.pageAbilities ?? [])
    .filter((ability) => ability.appId === input.appId && ability.platform === input.platform && ability.status !== "deprecated")
    .map((ability) => ({ ability, score: pageAbilityMatchScore(prompt, ability, targetPage) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.ability.pageElementLabel.localeCompare(right.ability.pageElementLabel, "zh-CN"));
}

function pageAbilityMatchScore(
  prompt: string,
  ability: FreeCompositionPageAbilityAsset,
  targetPage?: FreeCompositionPageAsset
): number {
  let score = Math.max(
    textMatchScore(prompt, ability.pageElementLabel),
    ability.targetPageModelName ? textMatchScore(prompt, ability.targetPageModelName) : 0
  );
  if (targetPage) {
    if (ability.targetPageModelId === targetPage.pageModelId) {
      score += 200;
    } else if (ability.targetPageModelName === targetPage.pageModelName) {
      score += 160;
    }
  }
  return score;
}

function pageAbilityTargetsPage(ability: FreeCompositionPageAbilityAsset, targetPage: FreeCompositionPageAsset): boolean {
  return ability.targetPageModelId === targetPage.pageModelId || ability.targetPageModelName === targetPage.pageModelName;
}

function moreMenuItemName(value: string): string | undefined {
  const normalized = normalize(value);
  const knownMenuItems = ["添加好友", "加入班级", "加入公开课", "扫一扫"];
  return knownMenuItems.find((item) => normalized.includes(normalize(item)));
}

function textMatchScore(prompt: string, value: string): number {
  const normalizedPrompt = normalize(prompt);
  const normalizedValue = normalize(value);
  if (!normalizedValue) {
    return 0;
  }
  if (normalizedPrompt.includes(normalizedValue)) {
    return 100;
  }
  for (const intentTerm of INTENT_TERMS) {
    if (!intentTerm.pattern.test(normalizedPrompt)) {
      continue;
    }
    if (intentTerm.terms.some((term) => normalizedValue.includes(term))) {
      return 40;
    }
  }
  return 0;
}

function isAppLaunchIntent(prompt: string): boolean {
  const normalized = normalize(prompt);
  return /(?:打开|启动|拉起|运行|launch|start)(?:当前)?(?:[a-z0-9_.-]{0,32})?(?:app|应用|客户端|软件|程序)$/.test(normalized);
}

function containsAppLaunchIntent(prompt: string): boolean {
  return isAppLaunchIntent(prompt) || orderedPromptSegments(prompt).some((segment) => isAppLaunchIntent(segment));
}
