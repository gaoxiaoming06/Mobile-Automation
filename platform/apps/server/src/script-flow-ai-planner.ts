import {
  parseScriptFlow,
  serializeScriptFlow,
  validateScriptFlowDocument,
  type ScriptFlowDocument,
  type ScriptParameterDefinition,
  type ScriptParameterValue,
  type ScriptStep
} from "@mobile-automation/script-flow";
import type { ScriptFlow } from "@mobile-automation/shared";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetCatalog, PageAssetPlatform } from "./page-asset-catalog.js";

export const SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化 ScriptFlow 规划器，只生成可审查的脚本草稿，不操作设备。",
  "规划阶段禁止识别实时设备页面；start、onPage 和 expectPage 表达运行时页面约束。",
  "先判断测试类型：单一业务目标标记为 case；多个可独立成立的业务目标标记为 scenario。导航、登录态准备和结果验证不算额外业务目标。",
  "使用 entry 和 outcome 声明测试入口与结果状态：page 表示页面，session 只能是 authenticated 或 unauthenticated，登录后可用 role 表示角色。不要把准备动作展开进业务步骤。",
  "页面目录只负责页面身份。动作目标必须且只能使用 text、semantic、icon 或 control：已知屏幕原文用 text，不知道准确标签时用 semantic 描述操作意图，常见标准图标用 icon，通用表单控件用 control。",
  "text 必须是用户原文、页面目录名称或现有用例中已有的字面标签，禁止擅自增加‘创建、进入、打开、发布’等词。semantic 用于‘进入教学方案的入口’这类概念目标，不能伪装成屏幕原文。",
  "text、semantic、icon 和 control 都不要求先创建元素资产。内容可能在屏幕外时配置 search: { mode: auto }；弹层菜单、顶栏和底栏使用 search: { mode: visibleOnly }。",
  "icon 必须描述 area 和 position。顶部栏标准图标使用 topBar；内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing }；不要把自定义产品图形臆测成标准图标。",
  "control 当前只支持 checkbox，必须描述 area: content 和 nearText；执行器会在文字附近识别并校验勾选状态。",
  "一个 tap 只执行一次点击。即使目标标签像流程描述，也不得把一次点击解释成打开菜单后继续选择；用户过程包含几次点击就生成几个步骤。",
  "用户只表达进入、打开、前往或回到某页面时，这是目标状态而不是操作方式；目标页面唯一且已录入时生成 reachPage，不要因为‘回到’推断系统返回、重启或要求用户选择底层导航方式。",
  "只有用户明确描述点击、返回、重启等过程时才生成对应操作；reachPage 的运行时执行器负责识别当前页面、选择安全路径并验证目标页。",
  "动作会进入另一个页面时，把目标页写在该动作的 expectPage；不要再紧跟一个独立 assertPage。assertPage 只用于用户明确要求单独验证当前页面的场景。",
  "目标页面未录入但用户提供了该页独有的稳定可见文字时，不要引用未知 page key；用最终 assertText: { text: <用户原文>, match: contains } 验证结果。没有页面资产也没有稳定文字时才返回 needs_clarification。",
  "只能引用目录中存在的 page key 和 active ScriptFlow id。禁止元素资产 ID、坐标、bounds、region_center、圈选区域或固定屏幕区域点击。",
  "用户要求到达的目标页面不在页面目录时，不得编造 page key，也不得省略结果验证后假装生成成功；返回 needs_clarification，请用户录入页面资产，或补充该页面独有的稳定文字作为结果验证依据。",
  "目标型请求生成 reachPage；过程型请求按用户描述保留每个动作，不擅自扩展成创建、发布、提交或删除。场景编排命中完全匹配的启用用例时自动使用 runFlow，不要求用户再确认复用；用户明确描述具体操作过程时则保留该过程。",
  "动态业务值必须声明为 parameters 并在步骤中使用 ${parameterName}。用户已给出的值放入顶层 parameterValues，仅用于本次运行；未给出但执行必需的值设 required: true。",
  "账号、密码等 sensitive 参数禁止写入 parameters.default、summary 或 assumptions，必须只放入顶层 parameterValues。",
  "runFlow 会自动继承父测试中的同名参数；规划器会把复用用例和 reachPage 导航路径所需参数汇总到运行配置。",
  "常用参数直接展示；低频可选参数标记 advanced: true。枚举只有在输入目录给出合法选项时才能使用 select/options。",
  "发布、提交、删除、支付只在用户明确要求时生成，并用 risk 标记供报告审计；所有步骤均无需运行前确认。",
  "risk 是步骤级字段，必须与 tap、selectText 等动作字段同级，禁止写进动作对象内部。",
  "信息不足时返回 needs_clarification 和一个简短问题，不要猜测。只返回唯一 JSON 对象，不要 Markdown、代码围栏、解释文字或额外字段。"
].join("\n");

export type ScriptFlowPlannerCatalog = ReturnType<typeof buildScriptFlowPlannerCatalog>;

export type ScriptFlowAiDraft =
  | {
      status: "ready";
      sourceYaml: string;
      document: ScriptFlowDocument;
      kind: ScriptFlowDocument["kind"];
      parameterValues: Record<string, ScriptParameterValue>;
      summary: string;
      assumptions: string[];
      channel: "codex" | "openai-compatible";
      model: string;
    }
  | {
      status: "needs_clarification";
      clarification: string;
      channel: "codex" | "openai-compatible";
      model: string;
    };

type ParsedScriptFlowAiDraft =
  | Omit<Extract<ScriptFlowAiDraft, { status: "ready" }>, "channel" | "model">
  | Omit<Extract<ScriptFlowAiDraft, { status: "needs_clarification" }>, "channel" | "model">;

export async function generateScriptFlowDraft(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  pageCatalog: PageAssetCatalog;
  flows: ScriptFlow[];
  existingFlow?: ScriptFlow;
  fetchImpl?: AiClientFetch;
}): Promise<ScriptFlowAiDraft> {
  if (!input.config.enabled) {
    throw new Error(input.config.reason === "missing_config" ? "AI 配置不完整" : "AI 生成未启用");
  }
  const catalog = buildScriptFlowPlannerCatalog(
    input.pageCatalog,
    input.existingFlow ? input.flows.filter((flow) => flow.id !== input.existingFlow?.id) : input.flows,
    input.appId,
    input.platform
  );
  const channel = isCodexAppServerProvider(input.config.baseURL) ? "codex" as const : "openai-compatible" as const;
  const requestConfig = {
    baseURL: input.config.baseURL,
    apiKey: input.config.apiKey,
    model: input.config.model,
    timeoutMs: input.config.timeoutMs
  };
  const existingDocument = input.existingFlow ? parseScriptFlow(input.existingFlow.sourceYaml) : undefined;
  const plannerPrompt = buildScriptFlowPlannerPrompt(input.prompt, input.appId, input.platform, catalog, existingDocument);
  const result = await runAiJsonRequest(requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: plannerPrompt,
    effort: "medium"
  }, input.fetchImpl ?? fetch);
  const parseInput = { appId: input.appId, platform: input.platform, catalog, prompt: input.prompt, existingDocument };
  let parsed: ParsedScriptFlowAiDraft;
  try {
    parsed = parseScriptFlowAiResponse(result.content, parseInput);
  } catch (firstError) {
    if (firstError instanceof UnrecordedPageReferenceError) {
      return {
        status: "needs_clarification",
        clarification: missingPageClarification(input.prompt),
        channel,
        model: input.config.model
      };
    }
    const repaired = await runAiJsonRequest(requestConfig, {
      developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
      userContent: buildScriptFlowRepairPrompt(plannerPrompt, result.content, firstError),
      effort: "medium"
    }, input.fetchImpl ?? fetch);
    try {
      parsed = parseScriptFlowAiResponse(repaired.content, parseInput);
    } catch (repairError) {
      if (repairError instanceof UnrecordedPageReferenceError) {
        return {
          status: "needs_clarification",
          clarification: missingPageClarification(input.prompt),
          channel,
          model: input.config.model
        };
      }
      throw new Error(`AI 未能生成有效的 ScriptFlow 草稿：${compactError(repairError)}`);
    }
  }
  if (parsed.status === "needs_clarification") {
    return { ...parsed, channel, model: input.config.model };
  }
  return { ...parsed, channel, model: input.config.model };
}

export function buildScriptFlowPlannerCatalog(
  pageCatalog: PageAssetCatalog,
  flows: ScriptFlow[],
  appId: string,
  platform: PageAssetPlatform
) {
  const pages = pageCatalog.listPages(appId, platform).map((page) => ({
    id: page.id,
    key: page.key,
    name: page.name
  }));
  const reusableFlows = flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .map((flow) => {
      const entry = recordValue(flow.parsed.entry);
      const outcome = recordValue(flow.parsed.outcome);
      return {
        id: flow.id,
        kind: flow.parsed.kind === "scenario" ? "scenario" as const : "case" as const,
        name: flow.name,
        description: stringValue(flow.parsed.description),
        parameters: recordValue(flow.parsed.parameters),
        ...(Object.keys(entry).length ? { entry } : {}),
        ...(Object.keys(outcome).length ? { outcome } : {})
      };
    });
  const transitions = flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .flatMap((flow) => transitionEntries(flow));
  return { pages, reusableFlows, transitions };
}

export function buildScriptFlowPlannerPrompt(
  prompt: string,
  appId: string,
  platform: PageAssetPlatform,
  catalog: ScriptFlowPlannerCatalog,
  existingDocument?: ScriptFlowDocument
): string {
  return [
    existingDocument
      ? "根据用户要求修改现有用例，输出修改后的完整 ScriptFlow v1 草稿。未提及的步骤、参数和约束保持不变。"
      : "根据用户需求生成 ScriptFlow v1 草稿。",
    "输出结构：",
    JSON.stringify({
      status: "ready | needs_clarification",
      clarification: "仅 needs_clarification 时填写",
      summary: "一句话说明生成结果",
      assumptions: ["必要且可审查的假设"],
      parameterValues: { parameterName: "用户已明确提供且仅供本次运行的值" },
      document: {
        version: 1,
        kind: "case | scenario",
        name: "测试名称",
        description: "测试说明",
        app: { id: appId, platform },
        start: { strategy: "keepCurrent | goHome | launchApp | restartApp | clearDataAndLaunch" },
        entry: { page: "可选的目录页面", session: "authenticated | unauthenticated", role: "authenticated 时可选" },
        outcome: { page: "可选的目录页面", session: "authenticated | unauthenticated", role: "authenticated 时可选" },
        parameters: {},
        steps: [],
        tags: ["ai-generated"]
      }
    }, null, 2),
    "可用动作：launchApp、tap、inputText、clearText、selectText、swipe、scrollUntilVisible、reachPage、waitForPage、assertPage、assertText、runFlow、repeat、when。",
    "每个 steps 项必须包含非空 id，并把动作名直接作为字段；每步只能有一个动作字段。不要输出 action 或 page 字段。",
    "步骤格式示例（只说明结构，页面引用必须从本次目录选择）：",
    JSON.stringify(stepShapeExamples(appId, catalog), null, 2),
    "target 必须且只能使用 text、semantic、icon 或 control。text 是可在屏幕上按字面读取的原文，必须能追溯到用户输入或已知目录；不知道准确标签时改用 semantic。icon 必须带 area 和 position；control 当前只支持 checkbox，并且必须带 area: content 和 nearText；禁止元素资产 ID、坐标、区域和临时视觉模板。",
    "tap.search.mode 可用 auto、visibleOnly 或 scroll。普通内容点击目标默认用 auto；瞬时菜单和顶栏/底栏点击目标用 visibleOnly。执行器负责在允许时逐屏查找，脚本不要展开成机械滑动步骤。inputText、clearText 和 selectText 当前不接受 search。",
    "只表达目标页面时使用 reachPage: { page: <目录页面>, policy: safe }，不要因为“回到”推断系统返回或重启。reachPage 自身会验证目标页，不要追加 assertPage。",
    "tap 与 selectText 默认标记 risk: interaction。明确属于提交、发布、删除或支付时，risk 分别填写 submit、publish、delete 或 payment；这些标记仅用于报告审计，无需运行前确认；禁止 risk: none。",
    existingDocument ? "修改现有用例：" : "输入：",
    JSON.stringify({ prompt, appId, platform, ...(existingDocument ? { existingDocument } : {}), catalog }, null, 2)
  ].join("\n\n");
}

function buildScriptFlowRepairPrompt(plannerPrompt: string, invalidResponse: string, error: unknown): string {
  return [
    plannerPrompt,
    "上一稿未通过 ScriptFlow v1 校验。请重新输出唯一、完整的 JSON 对象，不要 Markdown、代码围栏、解释文字、额外字段，也不要沿用无效字段。",
    `校验错误：${compactError(error)}`,
    `上一稿：${invalidResponse.slice(0, 12_000)}`
  ].join("\n\n");
}

function stepShapeExamples(appId: string, catalog: ScriptFlowPlannerCatalog): Record<string, unknown>[] {
  const page = catalog.pages[0];
  const pageReference = page?.key ?? page?.id ?? "<目录中的 page key>";
  const examples: Record<string, unknown>[] = [
    { id: "launch-app", launchApp: { appId } },
    {
      id: "tap-content-text",
      onPage: pageReference,
      tap: { target: { text: "内容文字", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-semantic-entry",
      onPage: pageReference,
      tap: { target: { semantic: "进入目标功能的入口", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-standard-icon",
      onPage: pageReference,
      tap: { target: { icon: "add", area: "topBar", position: "trailing" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "tap-floating-add",
      onPage: pageReference,
      tap: { target: { icon: "add", area: "content", position: "trailing" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "check-agreement",
      onPage: pageReference,
      tap: { target: { control: "checkbox", area: "content", nearText: "我已阅读并同意" }, search: { mode: "visibleOnly" } }
    },
    { id: "reach-page", reachPage: { page: pageReference, policy: "safe" } },
    { id: "assert-page", assertPage: pageReference },
    { id: "assert-stable-text", assertText: { text: "用户明确提供的页面独有文字", match: "contains" } }
  ];
  return examples;
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 1_000);
}

export function parseScriptFlowAiResponse(
  raw: string,
  input: {
    appId: string;
    platform: PageAssetPlatform;
    catalog: ScriptFlowPlannerCatalog;
    prompt?: string;
    existingDocument?: ScriptFlowDocument;
  }
): ParsedScriptFlowAiDraft {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch {
    throw new Error("AI 返回必须是唯一、完整的 JSON 对象，不能包含 Markdown 或解释文字");
  }
  const root = recordValue(value);
  if (root.status === "needs_clarification") {
    assertKnownResponseFields(root, ["status", "clarification"]);
    const clarification = stringValue(root.clarification);
    if (!clarification) throw new Error("AI 请求补充信息但没有给出问题");
    return { status: "needs_clarification", clarification };
  }
  if (root.status !== "ready") {
    throw new Error("AI 返回了未知的规划状态");
  }
  assertKnownResponseFields(root, ["status", "summary", "assumptions", "parameterValues", "document"]);
  assertNoLegacyGeneratedFields(root.document);
  const validated = validateScriptFlowDocument(root.document);
  const hydrated = validateScriptFlowDocument(hydrateGeneratedParameters(validated, input.catalog));
  const { document, parameterValues } = extractEphemeralParameterValues(hydrated, root.parameterValues);
  validateGeneratedReferences(document, input);
  validateGeneratedTargetGrounding(document, input);
  return {
    status: "ready",
    sourceYaml: serializeScriptFlow(document),
    document,
    kind: document.kind,
    parameterValues,
    summary: stringValue(root.summary) ?? `已生成 ${document.name}`,
    assumptions: stringArray(root.assumptions)
  };
}

function extractEphemeralParameterValues(
  document: ScriptFlowDocument,
  generatedValues: unknown
): { document: ScriptFlowDocument; parameterValues: Record<string, ScriptParameterValue> } {
  const parameters = Object.fromEntries(
    Object.entries(document.parameters).map(([key, definition]) => [key, { ...definition }])
  );
  const parameterValues: Record<string, ScriptParameterValue> = {};

  for (const [key, value] of Object.entries(recordValue(generatedValues))) {
    const definition = parameters[key];
    if (!definition) throw new Error(`AI 草稿返回了未声明的运行参数：${key}`);
    const normalized = runtimeParameterValue(value, definition);
    if (normalized === undefined) throw new Error(`AI 草稿的运行参数 ${key} 类型不正确`);
    parameterValues[key] = normalized;
  }

  for (const [key, definition] of Object.entries(parameters)) {
    if (!definition.sensitive || definition.default === undefined) continue;
    if (parameterValues[key] === undefined) parameterValues[key] = definition.default;
    delete definition.default;
    definition.required = true;
  }

  return {
    document: validateScriptFlowDocument({ ...document, parameters }),
    parameterValues
  };
}

function runtimeParameterValue(
  value: unknown,
  definition: ScriptParameterDefinition | undefined
): ScriptParameterValue | undefined {
  if (!definition) return undefined;
  if ((definition.type === "string" || definition.type === "datetime") && typeof value === "string") return value;
  if (definition.type === "number" && typeof value === "number" && Number.isFinite(value)) return value;
  if (definition.type === "boolean" && typeof value === "boolean") return value;
  return undefined;
}

function hydrateGeneratedParameters(
  document: ScriptFlowDocument,
  catalog: ScriptFlowPlannerCatalog
): ScriptFlowDocument {
  const parameters = { ...document.parameters };
  const flows = new Map(catalog.reusableFlows.map((flow) => [flow.id, flow]));
  let currentPage = document.entry?.page;

  for (const step of document.steps) {
    if ("runFlow" in step) {
      const flow = flows.get(step.runFlow);
      if (flow) {
        for (const [childKey, definition] of Object.entries(flow.parameters)) {
          const binding = step.with?.[childKey];
          if (binding === undefined) {
            addParameter(parameters, childKey, definition);
            continue;
          }
          const parentKey = bindingParameterName(binding);
          if (parentKey) addParameter(parameters, parentKey, definition);
        }
        currentPage = stringValue(flow.outcome?.page) ?? currentPage;
      }
      continue;
    }
    if ("reachPage" in step) {
      const targetPage = step.reachPage.page;
      const path = currentPage ? findPlannerTransitionPath(catalog.transitions, currentPage, targetPage) : undefined;
      for (const transition of path ?? []) {
        for (const [key, definition] of Object.entries(transition.parameters)) {
          addParameter(parameters, key, definition);
        }
      }
      currentPage = targetPage;
      continue;
    }
    if (step.expectPage) currentPage = step.expectPage;
  }

  return { ...document, parameters };
}

function addParameter(
  parameters: Record<string, ScriptParameterDefinition>,
  key: string,
  value: unknown
): void {
  if (parameters[key]) return;
  const definition = recordValue(value);
  if (!Object.keys(definition).length) return;
  parameters[key] = definition as ScriptParameterDefinition;
}

function bindingParameterName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1];
}

function findPlannerTransitionPath(
  transitions: ScriptFlowPlannerCatalog["transitions"],
  fromPage: string,
  toPage: string
): ScriptFlowPlannerCatalog["transitions"] | undefined {
  if (fromPage === toPage) return [];
  const outgoing = new Map<string, ScriptFlowPlannerCatalog["transitions"]>();
  for (const transition of transitions) {
    const items = outgoing.get(transition.onPage) ?? [];
    items.push(transition);
    outgoing.set(transition.onPage, items);
  }
  const visited = new Set([fromPage]);
  const queue: Array<{ page: string; path: ScriptFlowPlannerCatalog["transitions"] }> = [{ page: fromPage, path: [] }];
  while (queue.length) {
    const current = queue.shift()!;
    for (const transition of outgoing.get(current.page) ?? []) {
      const path = [...current.path, transition];
      if (transition.expectPage === toPage) return path;
      if (visited.has(transition.expectPage)) continue;
      visited.add(transition.expectPage);
      queue.push({ page: transition.expectPage, path });
    }
  }
  return undefined;
}

function validateGeneratedReferences(
  document: ScriptFlowDocument,
  input: { appId: string; platform: PageAssetPlatform; catalog: ScriptFlowPlannerCatalog }
): void {
  if (document.app.id !== input.appId || document.app.platform !== input.platform) {
    throw new Error("AI 草稿修改了指定 App 或平台");
  }
  const pagesByReference = new Map<string, ScriptFlowPlannerCatalog["pages"][number]>();
  for (const page of input.catalog.pages) {
    pagesByReference.set(page.id, page);
    pagesByReference.set(page.key, page);
    pagesByReference.set(page.name, page);
  }
  validatePageReference(document.entry?.page, "entry.page", pagesByReference);
  validatePageReference(document.outcome?.page, "outcome.page", pagesByReference);
  const flowIds = new Set(input.catalog.reusableFlows.map((flow) => flow.id));
  for (const step of flattenSteps(document.steps)) {
    validatePageReference(step.onPage, "onPage", pagesByReference);
    validatePageReference(step.expectPage, "expectPage", pagesByReference);
    if ("reachPage" in step) validatePageReference(step.reachPage.page, "reachPage.page", pagesByReference);
    if ("assertPage" in step) validatePageReference(step.assertPage, "assertPage", pagesByReference);
    if ("waitForPage" in step) validatePageReference(step.waitForPage, "waitForPage", pagesByReference);
    if ("runFlow" in step && !flowIds.has(step.runFlow)) {
      throw new Error(`AI 草稿引用了不存在或未启用的子流程：${step.runFlow}`);
    }
    if ("launchApp" in step && step.launchApp.appId && step.launchApp.appId !== input.appId) {
      throw new Error(`AI 草稿尝试启动其他 App：${step.launchApp.appId}`);
    }
  }
}

function validateGeneratedTargetGrounding(
  document: ScriptFlowDocument,
  input: { prompt?: string; existingDocument?: ScriptFlowDocument; catalog: ScriptFlowPlannerCatalog }
): void {
  if (!input.prompt) return;
  const normalizedPrompt = compactGroundingText(input.prompt);
  const knownLiteralTexts = new Set(input.catalog.pages.map((page) => compactGroundingText(page.name)));
  for (const step of flattenSteps(input.existingDocument?.steps ?? [])) {
    const text = stepTargetText(step);
    if (text) knownLiteralTexts.add(compactGroundingText(text));
  }
  for (const step of flattenSteps(document.steps)) {
    const text = stepTargetText(step);
    if (!text || /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(text)) continue;
    const normalizedText = compactGroundingText(text);
    if (normalizedPrompt.includes(normalizedText) || knownLiteralTexts.has(normalizedText)) continue;
    throw new Error(`动作字面目标“${text}”没有来自用户描述或已知目录的字面依据；请保留真实原文，无法确定准确标签时改用 semantic`);
  }
}

function stepTargetText(step: ScriptStep): string | undefined {
  if ("tap" in step) return step.tap.target.text;
  if ("inputText" in step) return step.inputText.target.text;
  if ("clearText" in step) return step.clearText.target.text;
  if ("selectText" in step) return step.selectText.target.text;
  if ("scrollUntilVisible" in step) return step.scrollUntilVisible.target.text;
  if ("assertText" in step) return step.assertText.text;
  return undefined;
}

function compactGroundingText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}$\{\}_]+/gu, "");
}

function missingPageClarification(prompt: string): string {
  const request = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  return `目标页面尚未录入页面资产，无法验证“${request}”的执行结果。请先录入目标页面资产，或补充该页面独有的稳定文字作为结果验证依据。`;
}

function validatePageReference(
  reference: string | undefined,
  field: string,
  pages: Map<string, ScriptFlowPlannerCatalog["pages"][number]>
) {
  if (!reference) return undefined;
  const page = pages.get(reference);
  if (!page) throw new UnrecordedPageReferenceError(field, reference);
  return page;
}

class UnrecordedPageReferenceError extends Error {
  constructor(readonly field: string, readonly reference: string) {
    super(`AI 草稿的 ${field} 引用了未录入页面：${reference}`);
    this.name = "UnrecordedPageReferenceError";
  }
}

function transitionEntries(flow: ScriptFlow) {
  const steps = Array.isArray(flow.parsed.steps) ? flow.parsed.steps : [];
  return flattenRecords(steps).flatMap((step) => {
    const onPage = stringValue(step.onPage);
    const expectPage = stringValue(step.expectPage);
    if (!onPage || !expectPage) return [];
    return [{
      onPage,
      expectPage,
      flowId: flow.id,
      flowName: flow.name,
      stepId: stringValue(step.id) ?? "unknown",
      action: actionFromRecord(step),
      parameters: recordValue(flow.parsed.parameters)
    }];
  });
}

function flattenSteps(steps: ScriptStep[]): ScriptStep[] {
  return steps.flatMap((step) => {
    if ("repeat" in step) return [step, ...flattenSteps(step.repeat.steps)];
    if ("when" in step) return [step, ...flattenSteps(step.when.steps)];
    return [step];
  });
}

function flattenRecords(steps: unknown[]): Record<string, unknown>[] {
  return steps.flatMap((value) => {
    const step = recordValue(value);
    const repeat = recordValue(step.repeat);
    const when = recordValue(step.when);
    const nested = Array.isArray(repeat.steps) ? repeat.steps : Array.isArray(when.steps) ? when.steps : [];
    return [step, ...flattenRecords(nested)];
  });
}

function actionFromRecord(step: Record<string, unknown>): string {
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "runFlow", "repeat", "when"]
    .find((action) => action in step) ?? "unknown";
}

function assertKnownResponseFields(root: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(root).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new Error(`AI 返回包含未允许的外层字段：${unknown.join(", ")}`);
  }
}

function assertNoLegacyGeneratedFields(value: unknown, path = "document"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLegacyGeneratedFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  const forbidden = new Set([
    "ref",
    "pageElement",
    "elementId",
    "locator",
    "locatorKind",
    "bounds",
    "coordinates",
    "tapPointPercent"
  ]);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.has(key)) {
      throw new Error(`AI 草稿包含已禁止字段：${path}.${key}`);
    }
    assertNoLegacyGeneratedFields(child, `${path}.${key}`);
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}
