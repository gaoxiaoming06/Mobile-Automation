import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export type AiDiagnosisClassification = "app_issue" | "asset_issue" | "automation_issue" | "environment_issue" | "unknown";

export type AiDiagnosisRecommendedAction = "report_only" | "restart_app_continue" | "create_asset_patch" | "apply_verified_asset_patch";

export type AiDiagnosisConfig =
  | {
      enabled: true;
      baseURL: string;
      apiKey?: string;
      model: string;
      timeoutMs: number;
    }
  | {
      enabled: false;
      reason: "disabled" | "missing_config";
    };

export type AiDiagnosisStoredSettings = {
  enabled: boolean;
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  updatedAt?: string;
};

export type AiDiagnosisSettingsUpdateInput = Partial<AiDiagnosisStoredSettings> & {
  clearApiKey?: boolean;
};

export type PublicAiDiagnosisSettings = {
  enabled: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  source: "stored" | "environment" | "none";
};

export type AiDiagnosisEvidencePack = {
  schemaVersion: 1;
  runId: string;
  runKind?: string;
  deviceSerial: string;
  packageName?: string;
  currentPage?: string;
  targetPage?: string;
  failedStep?: {
    id?: string;
    title?: string;
    status?: string;
    errorMessage?: string;
  };
  error: {
    message: string;
    stack?: string;
  };
  runtimeParams?: Record<string, string>;
  recentSteps: Array<Record<string, unknown>>;
  recentEvents: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
};

export type AssetPatchCandidate = {
  kind: "page_matcher" | "page_element" | "page_transition" | "page_task";
  operation: "create" | "update" | "delete";
  targetId?: string;
  summary: string;
  changes: Record<string, unknown>;
  status: "draft";
};

export type AiDiagnosisResult = {
  classification: AiDiagnosisClassification;
  confidence: number;
  summary: string;
  reasoning: string[];
  recommendedAction: AiDiagnosisRecommendedAction;
  safeToAutoApply: boolean;
  assetPatch?: AssetPatchCandidate;
};

export type AiDiagnosisClient = {
  diagnose(evidence: AiDiagnosisEvidencePack): Promise<AiDiagnosisResult>;
};

type EnvLike = Record<string, string | undefined>;
type DiagnosisFetch = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 30_000;
const CLASSIFICATIONS: AiDiagnosisClassification[] = ["app_issue", "asset_issue", "automation_issue", "environment_issue", "unknown"];
const RECOMMENDED_ACTIONS: AiDiagnosisRecommendedAction[] = ["report_only", "restart_app_continue", "create_asset_patch", "apply_verified_asset_patch"];
const PATCH_KINDS: AssetPatchCandidate["kind"][] = ["page_matcher", "page_element", "page_transition", "page_task"];
const PATCH_OPERATIONS: AssetPatchCandidate["operation"][] = ["create", "update", "delete"];
const SECRET_KEY_PATTERN = /password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session/i;
const PHONE_KEY_PATTERN = /phone|mobile|手机号|账号/i;
const PHONE_VALUE_PATTERN = /\b1[3-9]\d{9}\b/g;
const SECRET_ASSIGNMENT_PATTERN = /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|session)\s*[:=]\s*["']?[^"'\s,;]+/gi;
const PHONE_ASSIGNMENT_PATTERN = /\b(phone|mobile)\s*[:=]\s*["']?\+?\d[\d-]{6,}/gi;
const CODEX_PROVIDER_BASE_URL = "codex://app-server";
const CODEX_PROCESS_START_TIMEOUT_MS = 15_000;
const CODEX_CLEANUP_TIMEOUT_MS = 8_000;
const CODEX_DIAGNOSIS_DEVELOPER_INSTRUCTIONS =
  "你是移动自动化测试异常诊断助手。只判断异常归因和受控资产修复建议，不直接执行设备操作，不直接修改文件。可以在证据充分时返回 apply_verified_asset_patch，由系统校验后更新资产。必须先按 PageStateFlow 资产规则判断要修页面、元素、边还是任务，再用字段白名单表达可执行补丁。必须只返回 JSON 对象。";
const PAGE_STATE_FLOW_ASSET_RULES = [
  "PageModel / 页面资产：一个节点代表一个可识别页面状态或稳定子状态；页面识别必须依赖多锚点 evidence，不依赖包名、历史点击坐标或 region_center。页面级动态内容如头像、昵称、数量、浮层、列表项变化不能作为强锚点。",
  "PageMatcher / 页面识别资产：优先使用稳定 OCR 文案、语义区域、结构锚点和经过 dynamic mask 的视觉区域。critical matcher 只能给稳定、不随账号/时间/列表滑动变化的证据；过期或动态 matcher 应降权，不应删除全部旧证据。",
  "PageElement / 可操作元素资产：元素是页面上的语义能力，不是固定坐标。必须包含 label/name、elementKind、semanticArea、actions，并用 text_locator、visual_locator、structural_locator 或 collection_item_locator 描述如何在当前截图重定位。个人头像、昵称、班级封面、数量等动态内容要用 dynamicMasks、structuralLocator、dynamicRegionId 或 itemTemplateId 排除。",
  "PageTransition / 连接边资产：边表示从 source PageModel 通过某个 elementId/action 到 target PageModel 或本地状态变化。必须描述 outcomeType、targetNodeId/targetLabel、availability、params/parameterMapping；同页 tab 或局部状态变化不要误写成必须 back 恢复的跨页导航。",
  "PageTask / 页面任务资产：任务是由 PageElement 引用组成的参数化步骤序列。输入类步骤必须使用 valueParamKey/desiredStateParamKey 从 runtimeParams 取值，不把真实账号密码写入资产。",
  "动态区域 / 列表模板 / 参数化：列表、网格、feed、表单组应抽象为 dynamicRegion + itemTemplate。列表项点击要用 collection_item_locator、itemIdentity、targetQuery、clickSafePoint 和 scrollProfile，而不是保存某一屏某一行坐标。",
  "AI 生成修复时必须先选择要修复的资产类型，再按对应 PageStateFlow 资产模型生成完整语义；字段白名单只是系统可执行补丁协议，不是资产设计规则本身。",
  "page_element 补丁必须说明定位策略、语义目标、动态内容处理和验证证据；如果缺少这些证据，只能返回 create_asset_patch 并说明需要补录或扩展规则。",
  "AI 需要按这些资产规则生成新的 matcher、元素、边或任务修复草稿；如果当前 AssetPatch 协议无法表达所需新资产，返回 create_asset_patch 并在 reasoning 中明确说明需要扩展系统规则，不要伪造成坐标或随意发明字段。"
];
const ASSET_PATCH_SCHEMA_RULES = [
  "assetPatch.kind 只允许 page_transition、page_element、page_matcher、page_task；operation 当前自动修复只接受 update。",
  "page_matcher.changes 只允许：addMatchersDraft、addMatchers、deprioritizeMatchersDraft、deprioritizeMatchers、deprioritizeMatcherIds、matchers、visualLocator、ocrHints、semanticAnchors、identityHints、aiHints、quality。",
  "page_matcher 用于页面识别修复时，优先返回 addMatchersDraft: [{ type: \"ocr_text\", expected: \"页面稳定文字\", weight: 1.4-2.2, critical?: true }]，以及 deprioritizeMatchersDraft: [\"过期 matcher id\"]。",
  "不要返回 matcherDraft、nodeName、reason 对象、promoteExistingMatchers 这类说明性字段；说明写在 summary 或 reasoning，changes 里只放系统可执行字段。",
  "page_transition.changes 只允许：id、elementId、action、outcomeType、targetNodeId、targetLabel、availability、platformScope、params、compoundSteps、aiHints、notes、quality。",
  "page_element.changes 只允许：id、label、name、targetText、locator、locatorKind、structuralLocator、visualLocator、semanticArea、elementKind、actions、availability、platformScope、anchorText、role、slot、orderFromRight、dynamicMasks、dynamicRegionId、itemTemplateId、collection、scrollProfile、aiHints、quality。",
  "page_element 修复只用于“操作元素找不到/无法重定位/点错元素”类资产问题。补丁必须更新可重定位规则：locatorKind 应为 text_locator、visual_locator、structural_locator、collection_item_locator、top_bar_icon_locator 或 ocr_anchor_offset；同时至少提供 locator、targetText、anchorText、role/slot/orderFromRight、structuralLocator、visualLocator、collection/scrollProfile 中的一类稳定证据。",
  "page_element 补丁不能只改 label/name/notes；也不能把个人头像、昵称、封面、数量、时间、列表临时内容作为强识别。遇到动态内容时必须用 dynamicMasks、dynamicRegionId、itemTemplateId 或 collection.itemIdentity 表达排除/参数化规则。",
  "如果 evidence 中有 elementId，请优先把 assetPatch.targetId 设为该 elementId；如果只能判断页面匹配过期而不是元素定位过期，使用 page_matcher，不要误改 page_element。",
  "page_task.changes 只允许：name、description、steps、fields、params、aiHints、quality。",
  "禁止任何坐标兜底字段或值：x、y、center、coordinate、bounds、image_region、region_center、fallback_tap、screen coordinate。"
];

type CodexJsonRpcMessage = Record<string, unknown>;

type CodexConnection = {
  child: ChildProcessWithoutNullStreams;
  lineReader: Interface;
  lineBuffer: string[];
  pendingMessages: CodexJsonRpcMessage[];
  nextRequestId: number;
  closed: boolean;
  lastExitCode: number | null;
  processErrorMessage?: string;
  stderrBuffer: string;
};

export function resolveAiDiagnosisConfig(env: EnvLike = process.env, settings?: AiDiagnosisStoredSettings): AiDiagnosisConfig {
  if (settings) {
    if (!settings.enabled) {
      return { enabled: false, reason: "disabled" };
    }
    const baseURL = firstNonEmpty(settings.baseURL, env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL);
    const apiKey = firstNonEmpty(settings.apiKey, env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY);
    const model = firstNonEmpty(settings.model, env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME);
    if (!baseURL || !model || (!apiKey && !isCodexAppServerProvider(baseURL))) {
      return { enabled: false, reason: "missing_config" };
    }
    return dropUndefined({
      enabled: true,
      baseURL,
      apiKey,
      model,
      timeoutMs: settings.timeoutMs && settings.timeoutMs > 0 ? Math.round(settings.timeoutMs) : parsePositiveInt(env.AI_DIAGNOSIS_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
    }) as AiDiagnosisConfig;
  }

  if (String(env.AI_DIAGNOSIS_ENABLED ?? "").toLowerCase() !== "true") {
    return { enabled: false, reason: "disabled" };
  }

  const baseURL = firstNonEmpty(env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL);
  const apiKey = firstNonEmpty(env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY);
  const model = firstNonEmpty(env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME);
  if (!baseURL || !model || (!apiKey && !isCodexAppServerProvider(baseURL))) {
    return { enabled: false, reason: "missing_config" };
  }

  return dropUndefined({
    enabled: true,
    baseURL,
    apiKey,
    model,
    timeoutMs: parsePositiveInt(env.AI_DIAGNOSIS_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
  }) as AiDiagnosisConfig;
}

export function isCodexAppServerProvider(baseURL?: string): boolean {
  return Boolean(baseURL?.trim().toLowerCase().startsWith(CODEX_PROVIDER_BASE_URL));
}

export function publicAiDiagnosisSettings(env: EnvLike = process.env, settings?: AiDiagnosisStoredSettings): PublicAiDiagnosisSettings {
  if (settings) {
    return {
      enabled: settings.enabled,
      baseURL: settings.baseURL ?? "",
      model: settings.model ?? "",
      timeoutMs: settings.timeoutMs && settings.timeoutMs > 0 ? Math.round(settings.timeoutMs) : DEFAULT_TIMEOUT_MS,
      apiKeyConfigured: Boolean(settings.apiKey?.trim()),
      source: "stored"
    };
  }
  const envEnabled = String(env.AI_DIAGNOSIS_ENABLED ?? "").toLowerCase() === "true";
  const baseURL = firstNonEmpty(env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL) ?? "";
  const model = firstNonEmpty(env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME) ?? "";
  const apiKeyConfigured = Boolean(firstNonEmpty(env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY));
  return {
    enabled: envEnabled,
    baseURL,
    model,
    timeoutMs: parsePositiveInt(env.AI_DIAGNOSIS_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    apiKeyConfigured,
    source: envEnabled || baseURL || model || apiKeyConfigured ? "environment" : "none"
  };
}

export function previewAiDiagnosisSettingsUpdate(
  existing: AiDiagnosisStoredSettings | undefined,
  input: AiDiagnosisSettingsUpdateInput
): AiDiagnosisStoredSettings {
  return dropUndefined({
    enabled: input.enabled ?? existing?.enabled ?? false,
    baseURL: firstNonEmpty(input.baseURL, existing?.baseURL),
    apiKey: input.clearApiKey ? undefined : firstNonEmpty(input.apiKey, existing?.apiKey),
    model: firstNonEmpty(input.model, existing?.model),
    timeoutMs: positiveIntegerValue(input.timeoutMs) ?? positiveIntegerValue(existing?.timeoutMs),
    updatedAt: firstNonEmpty(input.updatedAt, existing?.updatedAt)
  }) as AiDiagnosisStoredSettings;
}

export function buildAiDiagnosisEvidencePack(input: {
  runId: string;
  runKind?: string;
  deviceSerial: string;
  packageName?: string;
  currentPage?: string;
  targetPage?: string;
  failedStep?: AiDiagnosisEvidencePack["failedStep"];
  error: unknown;
  runtimeParams?: Record<string, string | undefined>;
  recentSteps?: Array<Record<string, unknown>>;
  recentEvents?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
}): AiDiagnosisEvidencePack {
  const sensitiveValues = collectSensitiveValues(input.runtimeParams ?? {});
  const runtimeParams = input.runtimeParams ? redactRuntimeParams(input.runtimeParams) : undefined;
  const evidence: AiDiagnosisEvidencePack = {
    schemaVersion: 1,
    runId: input.runId,
    runKind: input.runKind,
    deviceSerial: input.deviceSerial,
    packageName: input.packageName,
    currentPage: input.currentPage,
    targetPage: input.targetPage,
    failedStep: input.failedStep ? redactObject(input.failedStep, sensitiveValues) as AiDiagnosisEvidencePack["failedStep"] : undefined,
    error: redactObject(errorToEvidence(input.error), sensitiveValues) as AiDiagnosisEvidencePack["error"],
    runtimeParams,
    recentSteps: (redactObject(input.recentSteps ?? [], sensitiveValues) as Array<Record<string, unknown>>).slice(-8),
    recentEvents: (redactObject(input.recentEvents ?? [], sensitiveValues) as Array<Record<string, unknown>>).slice(-8),
    artifacts: (redactObject(input.artifacts ?? [], sensitiveValues) as Array<Record<string, unknown>>).slice(-12)
  };
  return dropUndefined(evidence) as AiDiagnosisEvidencePack;
}

export function parseAiDiagnosisResponse(raw: string): AiDiagnosisResult {
  const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
  const classification = enumValue(parsed.classification, CLASSIFICATIONS, "unknown");
  const confidence = clampNumber(numberValue(parsed.confidence, 0), 0, 1);
  const recommendedAction = enumValue(parsed.recommendedAction, RECOMMENDED_ACTIONS, "report_only");
  const safeToAutoApply = Boolean(parsed.safeToAutoApply);
  const assetPatch = normalizeAssetPatch(parsed.assetPatch);

  return dropUndefined({
    classification,
    confidence,
    summary: stringValue(parsed.summary, "AI diagnosis did not provide a summary."),
    reasoning: arrayOfStrings(parsed.reasoning),
    recommendedAction,
    safeToAutoApply,
    assetPatch
  }) as AiDiagnosisResult;
}

export function createAiDiagnosisClient(config: Extract<AiDiagnosisConfig, { enabled: true }>, fetchImpl: DiagnosisFetch = fetch): AiDiagnosisClient {
  if (isCodexAppServerProvider(config.baseURL)) {
    return createCodexAppServerDiagnosisClient(config);
  }
  return createOpenAiCompatibleDiagnosisClient(config, fetchImpl);
}

export function createOpenAiCompatibleDiagnosisClient(config: Extract<AiDiagnosisConfig, { enabled: true }>, fetchImpl: DiagnosisFetch = fetch): AiDiagnosisClient {
  return {
    async diagnose(evidence) {
      if (!config.apiKey?.trim()) {
        throw new Error("OpenAI-compatible AI diagnosis requires an API key.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(`${config.baseURL.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: CODEX_DIAGNOSIS_DEVELOPER_INSTRUCTIONS
              },
              {
                role: "user",
                content: buildDiagnosisPrompt(evidence)
              }
            ]
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`AI diagnosis request failed: HTTP ${response.status} ${await response.text().catch(() => "")}`.trim());
        }
        const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          throw new Error("AI diagnosis response did not include text content.");
        }
        return parseAiDiagnosisResponse(content);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

export function createCodexAppServerDiagnosisClient(config: Extract<AiDiagnosisConfig, { enabled: true }>): AiDiagnosisClient {
  return {
    async diagnose(evidence) {
      const content = await runCodexDiagnosisTurn(config, buildDiagnosisPrompt(evidence));
      if (!content.trim()) {
        throw new Error("Codex app-server diagnosis response did not include text content.");
      }
      return parseAiDiagnosisResponse(content);
    }
  };
}

export function buildDiagnosisPrompt(evidence: AiDiagnosisEvidencePack): string {
  return [
    "请基于下面的移动自动化异常证据，判断问题来源。",
    "",
    "分类只允许：app_issue、asset_issue、automation_issue、environment_issue、unknown。",
    "recommendedAction 只允许：report_only、restart_app_continue、create_asset_patch、apply_verified_asset_patch。",
    "只有当证据非常明确、补丁很小、且不依赖设备坐标/截图百分比/region_center 时，safeToAutoApply 才能为 true。",
    "如果你能确认是资产问题且能按规则直接修复，请使用 recommendedAction=apply_verified_asset_patch；否则使用 create_asset_patch 或 report_only。",
    "assetPatch 只能描述资产字段修复，不能要求点击、输入、重启、创建临时页面或改运行逻辑。",
    "禁止在 assetPatch.changes 中加入 x/y/center/coordinate/bounds/image-region/region_center/fallback_tap 等坐标兜底字段。",
    "如果现有规则无法表达修复，请不要绕过规则；返回 create_asset_patch，并在 reasoning 说明需要扩展系统资产规则。",
    "支持的自动修复优先级：page_transition 修改 targetNodeId/targetLabel/elementId/params；page_element 修改语义定位字段；page_matcher 补充页面识别草稿；page_task 修改参数化任务字段。",
    "如果建议更新资产，请在 assetPatch 中给出 draft 级别的结构化修复草稿。",
    "",
    "当前 PageStateFlow 资产规则：",
    ...PAGE_STATE_FLOW_ASSET_RULES,
    "",
    "可执行 assetPatch 协议：",
    ...ASSET_PATCH_SCHEMA_RULES,
    "",
    "返回 JSON schema:",
    JSON.stringify(
      {
        classification: "asset_issue",
        confidence: 0.9,
        summary: "一句话结论",
        reasoning: ["证据点 1", "证据点 2"],
        recommendedAction: "create_asset_patch",
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_transition",
          operation: "update",
          targetId: "optional",
          summary: "optional",
          changes: {}
        }
      },
      null,
      2
    ),
    "",
    "证据:",
    JSON.stringify(evidence, null, 2)
  ].join("\n");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

async function runCodexDiagnosisTurn(config: Extract<AiDiagnosisConfig, { enabled: true }>, prompt: string): Promise<string> {
  const connection = await createCodexConnection();
  const deadlineAt = Date.now() + config.timeoutMs;
  let threadId: string | undefined;
  let turnId: string | undefined;
  try {
    const threadStartResponse = asRecord(
      await codexRequest(connection, "thread/start", {
        model: config.model,
        cwd: process.cwd(),
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
        developerInstructions: CODEX_DIAGNOSIS_DEVELOPER_INSTRUCTIONS
      }, deadlineAt)
    );
    threadId = stringFromRecord(asRecord(threadStartResponse.thread), "id");
    if (!threadId) {
      throw new Error("thread/start did not return a thread id");
    }

    const turnStartResponse = asRecord(
      await codexRequest(connection, "turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: []
          }
        ],
        effort: "low"
      }, deadlineAt)
    );
    turnId = stringFromRecord(asRecord(turnStartResponse.turn), "id");
    if (!turnId) {
      throw new Error("turn/start did not return a turn id");
    }

    let accumulatedText = "";
    let latestErrorMessage: string | undefined;
    while (true) {
      const message = await codexNextMessage(connection, deadlineAt);
      if (isCodexResponseMessage(message)) {
        continue;
      }
      if (isCodexRequestMessage(message)) {
        await codexRespondToServerRequest(connection, message);
        continue;
      }

      const method = stringFromRecord(message, "method");
      const params = asRecord(message.params);
      if (method === "error") {
        latestErrorMessage = stringFromRecord(asRecord(params.error), "message") ?? stringFromRecord(params, "message");
        continue;
      }
      if (method === "item/agentMessage/delta" && params.threadId === threadId && params.turnId === turnId) {
        accumulatedText += stringFromRecord(params, "delta") ?? "";
        continue;
      }
      if (
        method === "item/completed" &&
        params.threadId === threadId &&
        params.turnId === turnId &&
        asRecord(params.item).type === "agentMessage" &&
        !accumulatedText
      ) {
        accumulatedText = stringFromRecord(asRecord(params.item), "text") ?? "";
        continue;
      }
      if (method === "turn/completed" && params.threadId === threadId && asRecord(params.turn).id === turnId) {
        const status = stringFromRecord(asRecord(params.turn), "status");
        const turnError = stringFromRecord(asRecord(asRecord(params.turn).error), "message");
        if (status !== "completed") {
          throw new Error(turnError ?? latestErrorMessage ?? `codex turn finished with status "${status ?? "unknown"}"`);
        }
        return accumulatedText;
      }
    }
  } finally {
    if (threadId) {
      await codexRequest(connection, "thread/unsubscribe", { threadId }, Date.now() + CODEX_CLEANUP_TIMEOUT_MS).catch(() => undefined);
    }
    closeCodexConnection(connection);
  }
}

async function createCodexConnection(): Promise<CodexConnection> {
  const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
  const connection: CodexConnection = {
    child,
    lineReader: createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }),
    lineBuffer: [],
    pendingMessages: [],
    nextRequestId: 1,
    closed: false,
    lastExitCode: null,
    stderrBuffer: ""
  };
  connection.lineReader.on("line", (line) => connection.lineBuffer.push(line));
  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    connection.stderrBuffer = `${connection.stderrBuffer}${text}`.slice(-8192);
  });
  child.on("exit", (code) => {
    connection.closed = true;
    connection.lastExitCode = code;
  });
  child.on("error", (error) => {
    connection.closed = true;
    connection.processErrorMessage = error.message;
  });

  child.unref?.();
  unrefNodeHandle(child.stdin);
  unrefNodeHandle(child.stdout);
  unrefNodeHandle(child.stderr);

  const deadlineAt = Date.now() + CODEX_PROCESS_START_TIMEOUT_MS;
  await codexRequest(connection, "initialize", {
    clientInfo: {
      name: "mobile_automation_ai_diagnosis",
      title: "Mobile Automation AI Diagnosis",
      version: "1.0.0"
    },
    capabilities: {
      experimentalApi: false
    }
  }, deadlineAt);
  await codexSendMessage(connection, { method: "initialized" });
  return connection;
}

async function codexRequest(connection: CodexConnection, method: string, params: unknown, deadlineAt: number): Promise<unknown> {
  const id = connection.nextRequestId++;
  await codexSendMessage(connection, { id, method, params });
  while (true) {
    const message = await codexNextMessage(connection, deadlineAt, false);
    if (isCodexResponseMessage(message) && message.id === id) {
      if (message.error) {
        throw new Error(`codex app-server ${method} failed: ${stringFromRecord(asRecord(message.error), "message") ?? "unknown error"}`);
      }
      return message.result ?? {};
    }
    if (isCodexRequestMessage(message)) {
      await codexRespondToServerRequest(connection, message);
      continue;
    }
    connection.pendingMessages.push(message);
  }
}

async function codexRespondToServerRequest(connection: CodexConnection, request: CodexJsonRpcMessage): Promise<void> {
  const method = stringFromRecord(request, "method");
  const id = request.id;
  let result: unknown;
  if (method === "item/commandExecution/requestApproval") {
    result = { decision: "decline" };
  } else if (method === "item/fileChange/requestApproval") {
    result = { decision: "decline" };
  } else if (method === "mcpServer/elicitation/request") {
    result = { action: "cancel", content: null };
  } else if (method === "item/tool/requestUserInput") {
    result = { answers: [] };
  } else {
    await codexSendMessage(connection, {
      id,
      error: {
        code: -32601,
        message: `unsupported server request: ${method ?? "unknown"}`
      }
    });
    return;
  }
  await codexSendMessage(connection, { id, result });
}

async function codexNextMessage(connection: CodexConnection, deadlineAt: number, includePending = true): Promise<CodexJsonRpcMessage> {
  if (includePending && connection.pendingMessages.length) {
    return connection.pendingMessages.shift() as CodexJsonRpcMessage;
  }
  while (true) {
    if (Date.now() > deadlineAt) {
      throw new Error("codex app-server request timed out");
    }
    if (connection.lineBuffer.length) {
      const line = connection.lineBuffer.shift()?.trim();
      if (!line) {
        continue;
      }
      try {
        return JSON.parse(line) as CodexJsonRpcMessage;
      } catch {
        continue;
      }
    }
    if (connection.closed) {
      throw codexClosedConnectionError(connection);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function codexSendMessage(connection: CodexConnection, payload: Record<string, unknown>): Promise<void> {
  if (connection.closed) {
    throw codexClosedConnectionError(connection);
  }
  await new Promise<void>((resolve, reject) => {
    connection.child.stdin.write(`${JSON.stringify(payload)}\n`, (error: Error | null | undefined) => {
      if (error) {
        reject(new Error(`failed writing to codex app-server stdin: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

function closeCodexConnection(connection: CodexConnection): void {
  try {
    connection.lineReader.close();
  } catch {
    // Best effort cleanup.
  }
  connection.child.stdin.end();
  connection.child.kill();
}

function unrefNodeHandle(handle: unknown): void {
  const candidate = handle as { unref?: () => void };
  candidate.unref?.();
}

function isCodexRequestMessage(message: CodexJsonRpcMessage): boolean {
  return typeof message.method === "string" && message.id !== undefined && message.result === undefined && message.error === undefined;
}

function isCodexResponseMessage(message: CodexJsonRpcMessage): boolean {
  return message.id !== undefined && (message.result !== undefined || message.error !== undefined) && typeof message.method !== "string";
}

function codexClosedConnectionError(connection: CodexConnection): Error {
  const stderr = connection.stderrBuffer.trim();
  if (connection.processErrorMessage) {
    return new Error(stderr ? `codex app-server process error: ${connection.processErrorMessage}. stderr=${stderr}` : `codex app-server process error: ${connection.processErrorMessage}`);
  }
  return new Error(stderr ? `codex app-server connection closed (exitCode=${connection.lastExitCode}). stderr=${stderr}` : `codex app-server connection closed (exitCode=${connection.lastExitCode})`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function positiveIntegerValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function errorToEvidence(error: unknown): AiDiagnosisEvidencePack["error"] {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

function collectSensitiveValues(runtimeParams: Record<string, string | undefined>): string[] {
  return Object.entries(runtimeParams)
    .filter(([key, value]) => Boolean(value) && (SECRET_KEY_PATTERN.test(key) || PHONE_KEY_PATTERN.test(key)))
    .map(([, value]) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length >= 4));
}

function redactRuntimeParams(runtimeParams: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtimeParams)) {
    if (value === undefined) {
      continue;
    }
    if (PHONE_KEY_PATTERN.test(key)) {
      result[key] = "<redacted:phone>";
    } else if (/password|passwd|pwd/i.test(key)) {
      result[key] = "<redacted:password>";
    } else if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "<redacted:secret>";
    } else {
      result[key] = sanitizeText(value, []);
    }
  }
  return result;
}

function redactObject(value: unknown, sensitiveValues: string[]): unknown {
  if (typeof value === "string") {
    return sanitizeText(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, sensitiveValues));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PHONE_KEY_PATTERN.test(key)) {
      result[key] = "<redacted:phone>";
    } else if (/password|passwd|pwd/i.test(key)) {
      result[key] = "<redacted:password>";
    } else if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "<redacted:secret>";
    } else {
      result[key] = redactObject(nested, sensitiveValues);
    }
  }
  return result;
}

function sanitizeText(text: string, sensitiveValues: string[]): string {
  let result = text;
  for (const value of sensitiveValues) {
    result = result.split(value).join("<redacted>");
  }
  return result
    .replace(PHONE_ASSIGNMENT_PATTERN, "$1=<redacted:phone>")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=<redacted:secret>")
    .replace(PHONE_VALUE_PATTERN, "<redacted:phone>");
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const direct = trimmed.match(/^\{[\s\S]*\}$/);
  if (direct) {
    return direct[0];
  }
  const fenced = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fenced?.[1]) {
    return fenced[1];
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  throw new Error("AI diagnosis response did not contain a JSON object.");
}

function normalizeAssetPatch(value: unknown): AssetPatchCandidate | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const kind = enumValue(input.kind, PATCH_KINDS);
  const operation = enumValue(input.operation, PATCH_OPERATIONS);
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const changes = input.changes && typeof input.changes === "object" && !Array.isArray(input.changes) ? input.changes as Record<string, unknown> : undefined;
  if (!kind || !operation || !summary || !changes) {
    return undefined;
  }
  return dropUndefined({
    kind,
    operation,
    targetId: typeof input.targetId === "string" && input.targetId.trim() ? input.targetId.trim() : undefined,
    summary,
    changes,
    status: "draft" as const
  }) as AssetPatchCandidate;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return allowed[0]!;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      result[key] = item;
    }
  }
  return result as T;
}
