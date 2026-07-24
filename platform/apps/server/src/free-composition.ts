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

export type FreeCompositionResolution = {
  status: "ready" | "needs_clarification" | "missing_assets";
  intent: FreeCompositionIntent;
  candidates: FreeCompositionCandidate[];
  message: string;
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

const INTENT_TERMS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /登录|登陆|账号/, terms: ["登录", "账号"] },
  { pattern: /跳转|进入|详情/, terms: ["进入", "跳转", "详情"] },
  { pattern: /创建课堂|新建课堂|建课/, terms: ["课堂", "建课"] },
  { pattern: /公开课/, terms: ["公开课"] },
  { pattern: /班级|进入班级/, terms: ["班级"] },
  { pattern: /作业/, terms: ["作业"] },
  { pattern: /搜索/, terms: ["搜索"] }
];

export function parseFreeCompositionIntent(prompt: string): FreeCompositionIntent {
  const normalized = normalize(prompt);
  const repeatMatch = normalized.match(/(?:循环|重复|执行)(\d{1,4})次/);
  const repeatCount = repeatMatch ? clampRepeatCount(Number(repeatMatch[1])) : 1;
  const loopUntilStopped = /一直循环|持续循环|直到停止|无限循环/.test(normalized);

  return {
    prompt: prompt.trim(),
    runMode: loopUntilStopped ? "loop_until_stop" : repeatMatch ? "repeat_n" : "once",
    repeatCount: loopUntilStopped ? 1 : repeatCount,
    riskTerms: riskTermsInText(prompt),
    runtimeOverrides: extractRuntimeOverridesFromPrompt(prompt)
  };
}

export function riskTermsInText(text: string): string[] {
  const normalized = normalize(text);
  return RISK_TERMS.filter((term) => normalized.includes(term));
}

export function resolveFreeComposition(
  prompt: string,
  input: ResolveFreeCompositionInput
): FreeCompositionResolution {
  const intent = parseFreeCompositionIntent(prompt);
  const activeMetaFunctions = input.metaFunctions.filter(
    (metaFunction) =>
      metaFunction.appId === input.appId &&
      metaFunction.platform === input.platform &&
      metaFunction.status === "active"
  );
  const metaFunctionsById = new Map(activeMetaFunctions.map((item) => [item.id, item]));
  const systemActionCandidate = buildSystemActionCandidate(intent.prompt, input);
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
          intent.prompt
        )
      ),
    ...activeMetaFunctions.map((metaFunction) =>
      buildCandidate(
        metaFunction,
        "meta_function",
        metaFunction.parameters.map((parameter) => parameter.key),
        intent.prompt
      )
    ),
    ...(input.pageTasks ?? [])
      .filter((pageTask) =>
        pageTask.appId === input.appId &&
        pageTask.platform === input.platform &&
        pageTask.status !== "deprecated"
      )
      .map((pageTask) => buildPageTaskCandidate(pageTask, intent.prompt)),
    ...(input.pageTransitions ?? [])
      .filter((pageTransition) =>
        pageTransition.appId === input.appId &&
        pageTransition.platform === input.platform &&
        pageTransition.status !== "deprecated"
      )
      .map((pageTransition) => buildPageTransitionCandidate(pageTransition, intent.prompt))
  ]
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"));
  const currentRouteFlow = buildCurrentPageRouteCandidate(intent.prompt, input, baseCandidates);
  if (currentRouteFlow) {
    return {
      status: "ready",
      intent,
      candidates: [currentRouteFlow],
      message: currentRouteFlow.requiresExecution === false
        ? "当前设备已在目标页面，无需执行。"
        : "已根据当前设备页面规划到目标页面的唯一执行流程。确认参数后生成执行计划。"
    };
  }
  const blockedTargetPage = currentPageDetectionBlockedTargetPage(intent.prompt, input);
  if (blockedTargetPage) {
    if (input.currentPageDetectionFailure?.reason === "outside_app") {
      return {
        status: "missing_assets",
        intent,
        candidates: [],
        message: `当前设备不在目标 App 内，无法从当前页规划到目标页“${blockedTargetPage.pageModelName}”。请先启动目标 App 后重试。`
      };
    }
    return {
      status: "missing_assets",
      intent,
      candidates: [],
      message: `未能稳定识别当前设备页面，无法从当前页规划到目标页“${blockedTargetPage.pageModelName}”。请先回到已录入页面、关闭当前前景页，或补充当前页面资产后重试。`
    };
  }
  const generatedFlow = buildGeneratedFlowCandidate(intent.prompt, baseCandidates);
  const candidates = generatedFlow ? [generatedFlow, ...baseCandidates] : baseCandidates;

  if (candidates.length === 0) {
    return {
      status: "missing_assets",
      intent,
      candidates: [],
      message: missingAssetsMessage(intent.prompt, input)
    };
  }

  if (!generatedFlow && requiresClarification(intent.prompt, candidates)) {
    return {
      status: "needs_clarification",
      intent,
      candidates,
      message: "找到多个可能的流程，请选择你想执行的资产后再生成计划。"
    };
  }

  return {
    status: "ready",
    intent,
    candidates,
    message: generatedFlow
      ? "已按需求生成临时执行流程。确认参数后生成执行计划。"
      : "已找到可执行候选。请选择候选并确认参数后生成执行计划。"
  };
}

function currentPageDetectionBlockedTargetPage(prompt: string, input: ResolveFreeCompositionInput): FreeCompositionPageAsset | undefined {
  if (!input.currentPageDetectionAttempted || input.currentPage?.pageModelId || !isTargetPageNavigationIntent(prompt)) {
    return undefined;
  }
  return bestTargetPageForPrompt(prompt, input);
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

function buildCurrentPageRouteCandidate(
  prompt: string,
  input: ResolveFreeCompositionInput,
  baseCandidates: FreeCompositionCandidate[]
): FreeCompositionCandidate | undefined {
  if (!input.currentPage?.pageModelId || !isTargetPageNavigationIntent(prompt)) {
    return undefined;
  }
  const targetPage = bestTargetPageForPrompt(prompt, input);
  if (!targetPage) {
    return undefined;
  }
  if (targetPage.pageModelId === input.currentPage.pageModelId) {
    return {
      id: `generated_flow:current_page:${targetPage.pageModelId}`,
      kind: "generated_flow",
      appId: input.appId,
      platform: input.platform,
      name: `当前已在${targetPage.pageModelName}`,
      description: `当前设备已识别在目标页“${targetPage.pageModelName}”，无需额外跳转。`,
      parameterKeys: [],
      score: 240,
      matchedTerms: [targetPage.pageModelName],
      pageModelId: targetPage.pageModelId,
      pageModelName: targetPage.pageModelName,
      targetPageModelId: targetPage.pageModelId,
      targetPageModelName: targetPage.pageModelName,
      composedCandidateIds: [],
      composedCandidates: [],
      requiresExecution: false
    };
  }
  const path = shortestPageTransitionPath(input.currentPage.pageModelId, targetPage.pageModelId, input);
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
    description: `由当前页“${input.currentPage.pageModelName ?? input.currentPage.pageModelId}”到目标页“${targetPage.pageModelName}”自动规划的临时流程。`,
    parameterProfileId: composedCandidates.find((item) => item.parameterProfileId)?.parameterProfileId,
    parameterKeys: uniqueStrings(composedCandidates.flatMap((item) => item.parameterKeys)).sort(),
    score: composedCandidates.reduce((sum, item) => sum + item.score, 120),
    matchedTerms: uniqueStrings([targetPage.pageModelName, ...composedCandidates.flatMap((item) => item.matchedTerms)]),
    composedCandidateIds: composedCandidates.map((item) => item.id),
    composedCandidates
  };
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
  const matchingPages = (input.pageAssets ?? [])
    .filter((page) => page.appId === input.appId && page.platform === input.platform && page.status !== "deprecated")
    .map((page) => ({ page, score: textMatchScore(prompt, page.pageModelName) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.page.pageModelName.localeCompare(right.page.pageModelName, "zh-CN"));
  const matchingAbilities = (input.pageAbilities ?? [])
    .filter((ability) => ability.appId === input.appId && ability.platform === input.platform && ability.status !== "deprecated")
    .map((ability) => ({ ability, score: textMatchScore(prompt, ability.pageElementLabel) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.ability.pageElementLabel.localeCompare(right.ability.pageElementLabel, "zh-CN"));

  const page = matchingPages[0]?.page;
  const ability = matchingAbilities[0]?.ability;
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
