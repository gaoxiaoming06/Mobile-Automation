import {
  parseScriptFlow,
  serializeScriptFlow,
  validateScriptFlowDocument,
  type ScriptFlowDocument,
  type ScriptParameterDefinition,
  type ScriptParameterValue,
  type ScriptStep,
  type ScriptFlowTestLevel
} from "@mobile-automation/script-flow";
import type { NavigationEntry, ScriptFlow, ScriptFlowVerificationAssessment } from "@mobile-automation/shared";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetCatalog, PageAssetPlatform } from "./page-asset-catalog.js";
import { assessScriptFlowVerification } from "./script-flow-verification.js";

export const SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化 ScriptFlow 规划器，只生成可审查的脚本草稿，不操作设备。",
  "规划阶段禁止识别实时设备页面；start、onPage 和 expectPage 表达运行时页面约束。",
  "先判断测试类型：单一业务目标标记为 case；多个可独立成立的业务目标标记为 scenario。导航、登录态准备和结果验证不算额外业务目标。",
  "必须用顶层 purpose 标记测试主要目的：navigation、fixture、business 或 recovery。navigation 只到达状态，fixture 准备测试环境，business 验证业务行为，recovery 恢复可执行状态。",
  "每个步骤必须显式标记 role：setup、navigation、business、assertion、cleanup 或 recovery。role 按该步骤在整个测试中的语义填写，不能仅根据动作类型猜测。",
  "使用 entry 和 outcome 声明测试入口与结果状态：page 表示页面，session 只能是 authenticated 或 unauthenticated，登录后可用 role 表示角色。不要把准备动作展开进业务步骤。",
  "页面目录只负责页面身份。动作目标必须且只能使用 text、semantic、icon 或 control：已知屏幕原文用 text，不知道准确标签时用 semantic 描述操作意图，常见标准图标用 icon，通用表单控件用 control。",
  "text 必须是用户原文、页面目录名称或现有用例中已有的字面标签，禁止擅自增加‘创建、进入、打开、发布’等词。semantic 用于‘进入教学方案的入口’这类概念目标，不能伪装成屏幕原文。",
  "text、semantic、icon 和 control 都不要求先创建元素资产。内容可能在屏幕外时配置 search: { mode: auto }；弹层菜单、顶栏和底栏使用 search: { mode: visibleOnly }。",
  "text 或 semantic 目标默认不要猜测 topBar/bottomBar。只有用户明确说顶部、底部、左上角、右上角等位置，或目录中的已验证导航入口/原用例已经给出同一目标位置时，才可增加窄区域约束；否则省略 area，让执行器在当前屏幕查找。",
  "发布、提交、删除、支付等操作按钮可能位于顶部、内容区或底部；用户或已验证知识未提供位置时必须省略 area，禁止根据动作名称猜测区域。",
  "icon 必须描述 area 和 position。顶部栏标准图标使用 topBar；内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing }；不要把自定义产品图形臆测成标准图标。",
  "用户明确说‘点击左上角返回按钮/返回图标’时，必须生成 { icon: back, area: topBar, position: leading } 的 tap；右上角分享按钮生成 { icon: share, area: topBar, position: trailing }。这是视觉点击，不得改写为页面恢复、reachPage 或重启。",
  "control 当前只支持 checkbox，必须描述 area: content 和 nearText；执行器会在文字附近识别并校验勾选状态。",
  "一个 tap 只执行一次点击。即使目标标签像流程描述，也不得把一次点击解释成打开菜单后继续选择；用户过程包含几次点击就生成几个步骤。",
  "用户明确操作是硬约束：点击、输入、清空、滑动、启动或重启等操作必须按用户描述的顺序保留，不能被 reachPage、runFlow、已有资产或更短路径替代。资产只可补充定位、页面约束和结果验证。",
  "用户描述打开选择器、滑动到具体选中值并确认时，必须把这组机械操作规范化为一个 selectText：target 保留字段入口，value 完整保留用户指定值，confirmText 保留确认文字。selectText 自身会点击并打开字段，由执行器动态查找选项；禁止保留前置 tap，也禁止猜测固定滑动次数。",
  "用户只表达进入、打开、前往或回到某页面时，这是目标状态而不是操作方式。只有目标是 navigationAnchors 中的状态入口，或 transitions 中存在到该目标的路径时，才生成 reachPage；不要因为‘回到’推断系统返回或重启。",
  "navigationEntries 是试运行验证并经用户确认的导航入口。目标型请求只能使用 navigationEntries、已验证 transitions 或 navigationAnchors；页面标签和页面名称不能作为入口推断依据。",
  "只有用户明确描述点击、返回、重启等过程时才生成对应过程；reachPage 的运行时执行器只使用已验证导航索引和受控入口恢复，不会猜测未知点击路径。",
  "动作会进入另一个页面时，把目标页写在该动作的 expectPage；不要再紧跟一个独立 assertPage。assertPage 只用于用户明确要求单独验证当前页面的场景。",
  "目标页面未录入时禁止引用或编造 page key。用户提供明确操作或完整操作链时必须先生成可试运行的直接动作；有独有稳定文字时用最终 assertText 验证，没有稳定文字时省略未知页面约束和结果断言，由系统标记为结果待确认，不能因此返回 needs_clarification。",
  "只能引用目录中存在的 page key 和 active ScriptFlow id。禁止元素资产 ID、坐标、bounds、region_center、圈选区域或固定屏幕区域点击。",
  "用户只说到达一个未录入页面、又没有提供操作路径时返回 needs_clarification，请用户补充从已知状态开始的完整点击过程或目标页独有稳定文字。不要要求用户先录制资产。",
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

type ScriptFlowAiGeneratedDraft = {
      status: "ready" | "trial_ready";
      sourceYaml: string;
      document: ScriptFlowDocument;
      kind: ScriptFlowDocument["kind"];
      parameterValues: Record<string, ScriptParameterValue>;
      summary: string;
      assumptions: string[];
      verification: ScriptFlowVerificationAssessment;
      sourceFlow?: { id: string; version: number; name: string };
      channel: "codex" | "openai-compatible";
      model: string;
    };

export type ScriptFlowAiDraft =
  | ScriptFlowAiGeneratedDraft
  | {
      status: "needs_clarification";
      clarification: string;
      channel: "codex" | "openai-compatible";
      model: string;
    };

type ParsedScriptFlowAiDraft =
  | Omit<ScriptFlowAiGeneratedDraft, "status" | "channel" | "model" | "verification"> & { status: "ready" }
  | Omit<Extract<ScriptFlowAiDraft, { status: "needs_clarification" }>, "channel" | "model">;

export async function generateScriptFlowDraft(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  pageCatalog: PageAssetCatalog;
  flows: ScriptFlow[];
  navigationEntries?: NavigationEntry[];
  existingFlow?: ScriptFlow;
  fetchImpl?: AiClientFetch;
}): Promise<ScriptFlowAiDraft> {
  if (!input.config.enabled) {
    throw new Error(input.config.reason === "missing_config" ? "AI 配置不完整" : "AI 生成未启用");
  }
  const matchedDraft = input.existingFlow
    ? undefined
    : findMatchingDraftFlow(input.prompt, input.flows, input.pageCatalog, input.appId, input.platform);
  const existingFlow = input.existingFlow ?? matchedDraft;
  const catalog = buildScriptFlowPlannerCatalog(
    input.pageCatalog,
    existingFlow ? input.flows.filter((flow) => flow.id !== existingFlow.id) : input.flows,
    input.appId,
    input.platform,
    input.navigationEntries ?? []
  );
  const channel = isCodexAppServerProvider(input.config.baseURL) ? "codex" as const : "openai-compatible" as const;
  const requestConfig = {
    baseURL: input.config.baseURL,
    apiKey: input.config.apiKey,
    model: input.config.model,
    timeoutMs: input.config.timeoutMs
  };
  const existingDocument = existingFlow ? parseScriptFlow(existingFlow.sourceYaml) : undefined;
  const sourceFlow = existingFlow ? savedFlowReference(existingFlow) : undefined;
  if (matchedDraft && extractExplicitOperationContract(input.prompt).length === 0 && existingDocument) {
    const verification = assessScriptFlowVerification({
      document: existingDocument,
      sourceYaml: matchedDraft.sourceYaml
    });
    return {
      status: verification.status === "verified" ? "ready" : "trial_ready",
      sourceYaml: matchedDraft.sourceYaml,
      document: existingDocument,
      kind: existingDocument.kind,
      parameterValues: {},
      summary: `已找到用例中心中的待验证草稿“${matchedDraft.name}”，可以直接执行验证。`,
      assumptions: ["复用已有草稿进行验证，不将其视为已验证导航路径。"],
      verification,
      sourceFlow,
      channel,
      model: input.config.model
    };
  }
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
    if (firstError instanceof UnresolvedGoalOnlyNavigationError) {
      return {
        status: "needs_clarification",
        clarification: unresolvedGoalOnlyNavigationClarification(input.prompt),
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
      if (repairError instanceof UnresolvedGoalOnlyNavigationError) {
        return {
          status: "needs_clarification",
          clarification: unresolvedGoalOnlyNavigationClarification(input.prompt),
          channel,
          model: input.config.model
        };
      }
      if (repairError instanceof UnreachableReachPageError) {
        return {
          status: "needs_clarification",
          clarification: `${repairError.message} 请补充从已知页面开始的操作过程。`,
          channel,
          model: input.config.model
        };
      }
      throw new Error(`AI 未能生成有效的 ScriptFlow 草稿：${compactError(repairError)}`);
    }
  }
  if (parsed.status === "needs_clarification") {
    const initialClarification = parsed;
    const reviewed = await runAiJsonRequest(requestConfig, {
      developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
      userContent: buildScriptFlowClarificationReviewPrompt(plannerPrompt, parsed.clarification),
      effort: "medium"
    }, input.fetchImpl ?? fetch);
    try {
      parsed = parseScriptFlowAiResponse(reviewed.content, parseInput);
    } catch {
      parsed = initialClarification;
    }
  }
  if (parsed.status === "needs_clarification") {
    return { ...parsed, channel, model: input.config.model };
  }
  const verification = assessScriptFlowVerification({
    document: parsed.document,
    sourceYaml: parsed.sourceYaml
  });
  return {
    ...parsed,
    status: verification.status === "verified" ? "ready" : "trial_ready",
    verification,
    ...(sourceFlow ? { sourceFlow } : {}),
    channel,
    model: input.config.model
  };
}

export function buildScriptFlowPlannerCatalog(
  pageCatalog: PageAssetCatalog,
  flows: ScriptFlow[],
  appId: string,
  platform: PageAssetPlatform,
  learnedNavigationEntries: NavigationEntry[] = []
) {
  const pages = pageCatalog.listPages(appId, platform).map((page) => ({
    id: page.id,
    key: page.key,
    name: page.name,
    tags: page.tags ?? []
  }));
  const reusableFlows = flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .map((flow) => {
      const entry = recordValue(flow.parsed.entry);
      const outcome = recordValue(flow.parsed.outcome);
      return {
        id: flow.id,
        kind: flow.parsed.kind === "scenario" ? "scenario" as const : "case" as const,
        purpose: flow.parsed.purpose === "navigation"
          || flow.parsed.purpose === "fixture"
          || flow.parsed.purpose === "recovery"
          ? flow.parsed.purpose
          : "business" as const,
        name: flow.name,
        description: stringValue(flow.parsed.description),
        parameters: recordValue(flow.parsed.parameters),
        ...(Object.keys(entry).length ? { entry } : {}),
        ...(Object.keys(outcome).length ? { outcome } : {})
      };
    });
  const navigationEntries = learnedNavigationEntries
    .filter((entry) => entry.appId === appId
      && entry.status === "active"
      && (entry.platformScope === platform || entry.platformScope === "mobile-both"))
    .map((entry) => ({
      id: entry.id,
      key: entry.key,
      name: entry.name,
      from: entry.from,
      toPage: entry.toPage,
      action: entry.action,
      confidence: entry.confidence,
      version: entry.version
    }));
  const transitions = [
    ...flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .flatMap((flow) => transitionEntries(flow)),
    ...navigationEntries.flatMap((entry) => entry.from.kind === "page" ? [{
      onPage: entry.from.key,
      expectPage: entry.toPage,
      flowId: `navigation-entry:${entry.id}`,
      flowName: entry.name,
      stepId: `navigate-with-${entry.id}`,
      action: entry.action.kind,
      parameters: {},
      source: "navigation_entry" as const
    }] : [])
  ];
  const navigationAnchors = reusableFlows.flatMap((flow) => {
    const page = stringValue(flow.entry?.page);
    const session = stringValue(flow.entry?.session);
    if (!page || !session) return [];
    return [{ page, session, ...(stringValue(flow.entry?.role) ? { role: stringValue(flow.entry?.role) } : {}) }];
  }).filter((anchor, index, anchors) => anchors.findIndex((candidate) => candidate.page === anchor.page) === index);
  return { pages, reusableFlows, navigationEntries, transitions, navigationAnchors };
}

export function buildScriptFlowPlannerPrompt(
  prompt: string,
  appId: string,
  platform: PageAssetPlatform,
  catalog: ScriptFlowPlannerCatalog,
  existingDocument?: ScriptFlowDocument
): string {
  const explicitOperations = extractExplicitOperationContract(prompt);
  const systemTestLevel = existingDocument?.testLevel ?? classifyScriptFlowTestLevel(prompt);
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
        purpose: "navigation | fixture | business | recovery",
        testLevel: systemTestLevel,
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
    `系统判定的 testLevel：${systemTestLevel}。document.testLevel 必须保持这个值，不能由模型自行改成其它层级。`,
    "testLevel 含义：probe=临时验证单点问题，component=字段/控件能力用例，business_smoke=最小业务主链路，full_regression=全字段或全配置回归。",
    "每个 steps 项必须包含非空 id 和显式 role，并把动作名直接作为字段；每步只能有一个动作字段。不要输出 action 或 page 字段。",
    "步骤格式示例（只说明结构，页面引用必须从本次目录选择）：",
    JSON.stringify(stepShapeExamples(appId, catalog), null, 2),
    "target 必须且只能使用 text、semantic、icon 或 control。text 是可在屏幕上按字面读取的原文，必须能追溯到用户输入或已知目录；不知道准确标签时改用 semantic。icon 必须带 area 和 position；control 当前只支持 checkbox，并且必须带 area: content 和 nearText；禁止元素资产 ID、坐标、区域和临时视觉模板。",
    "tap、inputText、clearText 和 selectText 使用同一 search 合同，search.mode 可用 auto、visibleOnly 或 scroll。普通内容目标默认用 auto；瞬时菜单和顶栏/底栏目标用 visibleOnly。执行器负责在允许时逐屏查找，脚本不要展开成机械滑动步骤。",
    "用户为选择器给出具体选中值时，把“点击字段、滑动选择该值、点击确定/完成”合并为一个 selectText，value 必须精确保留，confirmText 使用用户说出的确认文字；selectText 自身会打开字段，前面禁止再生成 tap，也禁止生成固定次数 swipe 来猜选项位置。",
    "只表达目标页面时，仅当目标属于 navigationAnchors，或能通过 navigationEntries、已验证 transitions 到达时使用 reachPage: { page: <目录页面>, policy: safe }。不要因为“回到”推断系统返回或重启，也不要根据页面名称或标签猜测导航入口。reachPage 自身会验证目标页，不要追加 assertPage。",
    "tap 与 selectText 默认标记 risk: interaction。明确属于提交、发布、删除或支付时，risk 分别填写 submit、publish、delete 或 payment；这些标记仅用于报告审计，无需运行前确认；禁止 risk: none。",
    explicitOperations.length
      ? `用户明确操作契约（必须按顺序生成直接动作，不能用 reachPage 或 runFlow 代替）：${explicitOperations.map((operation) => operation.phrase).join(" -> ")}`
      : "用户没有明确指定操作过程；可以使用已验证导航知识补全目标型请求。",
    explicitOperations.length
      ? "明确操作即使缺少当前页面 key、目标页面资产或自动结果判据，也必须返回 ready 并生成可试运行动作；省略无法确定的 onPage、expectPage、outcome 和断言，系统会将结果标记为待确认。只有缺少班级名、账号、输入值等实际执行参数时才能返回 needs_clarification。"
      : "目标型请求没有已验证路径或可用结果依据时返回 needs_clarification。",
    existingDocument ? "修改现有用例：" : "输入：",
    JSON.stringify({ prompt, appId, platform, ...(existingDocument ? { existingDocument } : {}), catalog }, null, 2)
  ].join("\n\n");
}

export function classifyScriptFlowTestLevel(prompt: string): ScriptFlowTestLevel {
  const compact = compactGroundingText(prompt);
  if (/所有表单|全部表单|全字段|全部字段|所有配置|全部配置|全量|完整覆盖/u.test(prompt)) {
    return "full_regression";
  }
  if (/临时|先验证一下|验证一下|排查|复现|看看.*能不能/u.test(prompt)) {
    return "probe";
  }
  if (/创建|发布|提交|完成|下单|支付|删除|登录|退出|业务|主链路/u.test(prompt)) {
    return "business_smoke";
  }
  if (/课堂时长|字段|表单项|控件|滚轮|选择器|输入框|输入|填写|清空|开关|复选框|checkbox|picker|slider/i.test(prompt)) {
    return "component";
  }
  return compact.length <= 18 && /测试|验证|检查/u.test(prompt) ? "probe" : "business_smoke";
}

function buildScriptFlowRepairPrompt(plannerPrompt: string, invalidResponse: string, error: unknown): string {
  return [
    plannerPrompt,
    "上一稿未通过 ScriptFlow v1 校验。请重新输出唯一、完整的 JSON 对象，不要 Markdown、代码围栏、解释文字、额外字段，也不要沿用无效字段。",
    `校验错误：${compactError(error)}`,
    `上一稿：${invalidResponse.slice(0, 12_000)}`
  ].join("\n\n");
}

function buildScriptFlowClarificationReviewPrompt(plannerPrompt: string, clarification: string): string {
  return [
    plannerPrompt,
    "上一稿准备向用户追问。请重新逐字检查原始输入：用户可能已经给出了班级、账号、时间、输入值或完整操作过程。已经提供的信息必须提取到 parameterValues 或对应动作中，不能重复追问。",
    "如果信息实际已经足够，返回 ready 草稿；只有执行所需的具体值确实不存在且无法从现有用例或目录补齐时，才再次返回 needs_clarification。",
    `上一稿的问题：${clarification}`
  ].join("\n\n");
}

function stepShapeExamples(appId: string, catalog: ScriptFlowPlannerCatalog): Record<string, unknown>[] {
  const page = catalog.pages[0];
  const pageReference = page?.key ?? page?.id ?? "<目录中的 page key>";
  const examples: Record<string, unknown>[] = [
    { id: "launch-app", role: "setup", launchApp: { appId } },
    {
      id: "tap-content-text",
      role: "business",
      onPage: pageReference,
      tap: { target: { text: "内容文字", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-semantic-entry",
      role: "navigation",
      onPage: pageReference,
      tap: { target: { semantic: "进入目标功能的入口", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-standard-icon",
      role: "navigation",
      onPage: pageReference,
      tap: { target: { icon: "add", area: "topBar", position: "trailing" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "tap-floating-add",
      role: "business",
      onPage: pageReference,
      tap: { target: { icon: "add", area: "content", position: "trailing" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "check-agreement",
      role: "business",
      onPage: pageReference,
      tap: { target: { control: "checkbox", area: "content", nearText: "我已阅读并同意" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "fill-content-field",
      role: "business",
      onPage: pageReference,
      inputText: {
        target: { semantic: "课堂名称输入框", area: "content" },
        value: "${lessonName}",
        search: { mode: "auto", direction: "down", maxSwipes: 6 }
      }
    },
    {
      id: "select-content-option",
      role: "business",
      onPage: pageReference,
      selectText: {
        target: { text: "课程", area: "content" },
        value: "${course}",
        search: { mode: "auto", direction: "down", maxSwipes: 6 }
      },
      risk: "interaction"
    },
    { id: "reach-page", role: "navigation", reachPage: { page: pageReference, policy: "safe" } },
    { id: "assert-page", role: "assertion", assertPage: pageReference },
    { id: "assert-stable-text", role: "assertion", assertText: { text: "用户明确提供的页面独有文字", match: "contains" } }
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
  const value = parseAiJsonObject(raw);
  const root = recordValue(value);
  if (root.status === "needs_clarification") {
    assertKnownResponseFields(root, ["status", "clarification"]);
    const clarification = stringValue(root.clarification);
    if (!clarification) throw new Error("AI 请求补充信息但没有给出问题");
    return { status: "needs_clarification", clarification: humanizePageReferences(clarification, input.catalog) };
  }
  if (root.status !== "ready") {
    throw new Error("AI 返回了未知的规划状态");
  }
  assertKnownResponseFields(root, ["status", "summary", "assumptions", "parameterValues", "document"]);
  assertNoLegacyGeneratedFields(root.document);
  assertGeneratedClassification(root.document, input.existingDocument?.testLevel ?? (input.prompt ? classifyScriptFlowTestLevel(input.prompt) : undefined));
  const validated = validateScriptFlowDocument(root.document);
  const hydrated = validateScriptFlowDocument(hydrateGeneratedParameters(validated, input.catalog));
  const { document, parameterValues } = extractEphemeralParameterValues(hydrated, root.parameterValues);
  validateGeneratedReferences(document, input);
  validateGeneratedNavigationReachability(document, input.catalog);
  validateGeneratedTargetGrounding(document, input);
  validateGeneratedTargetAreaGrounding(document, input);
  validateExactPickerSelections(document, input.prompt, parameterValues);
  validateExplicitOperationContract(document, input.prompt, parameterValues);
  validateGoalOnlyNavigationEvidence(document, input.prompt);
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

function parseAiJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/giu)];
  if (fenced.length === 1 && fenced[0]?.[1]) candidates.push(fenced[0][1].trim());
  const extracted = extractBalancedJsonObject(trimmed);
  if (extracted) candidates.push(extracted);

  for (const candidate of [...new Set(candidates)]) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Try the next safe representation before rejecting the response.
    }
  }
  throw new Error("AI 返回中没有可解析的唯一 JSON 对象");
}

function extractBalancedJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

function assertGeneratedClassification(value: unknown, expectedTestLevel?: ScriptFlowTestLevel): void {
  const document = recordValue(value);
  if (!stringValue(document.purpose)) {
    throw new Error("AI 草稿必须显式标记 purpose");
  }
  const testLevel = stringValue(document.testLevel);
  if (!testLevel) {
    throw new Error("AI 草稿必须显式标记 testLevel");
  }
  if (expectedTestLevel && testLevel !== expectedTestLevel) {
    throw new Error(`AI 草稿 testLevel 必须保持系统判定的 ${expectedTestLevel}，实际为 ${testLevel}`);
  }
  const steps = Array.isArray(document.steps) ? document.steps : [];
  assertGeneratedStepRoles(steps, "document.steps");
}

function assertGeneratedStepRoles(steps: unknown[], path: string): void {
  steps.forEach((value, index) => {
    const step = recordValue(value);
    if (!stringValue(step.role)) {
      throw new Error(`AI 草稿的 ${path}[${index}] 必须显式标记 role`);
    }
    const repeat = recordValue(step.repeat);
    const when = recordValue(step.when);
    if (Array.isArray(repeat.steps)) assertGeneratedStepRoles(repeat.steps, `${path}[${index}].repeat.steps`);
    if (Array.isArray(when.steps)) assertGeneratedStepRoles(when.steps, `${path}[${index}].when.steps`);
  });
}

function findMatchingDraftFlow(
  prompt: string,
  flows: ScriptFlow[],
  pageCatalog: PageAssetCatalog,
  appId: string,
  platform: PageAssetPlatform
): ScriptFlow | undefined {
  const candidates = flows.filter((flow) =>
    flow.appId === appId && flow.platform === platform && flow.status === "draft"
  );
  const normalizedPrompt = compactGroundingText(prompt);
  const exact = candidates.filter((flow) => compactGroundingText(flow.name) === normalizedPrompt);
  if (exact.length === 1) return exact[0];

  const pages = pageCatalog.listPages(appId, platform);
  const pageNames = new Map<string, string>();
  for (const page of pages) {
    pageNames.set(page.id, page.name);
    pageNames.set(page.key, page.name);
    pageNames.set(page.name, page.name);
  }
  const endpointMatches = candidates.filter((flow) => {
    const endpoints = flowPageEndpoints(flow.parsed);
    const targetName = endpoints.target ? pageNames.get(endpoints.target) : undefined;
    const sourceName = endpoints.source ? pageNames.get(endpoints.source) : undefined;
    if (!targetName || !normalizedPrompt.includes(compactGroundingText(targetName))) return false;
    return !sourceName || normalizedPrompt.includes(compactGroundingText(sourceName));
  });
  return endpointMatches.length === 1 ? endpointMatches[0] : undefined;
}

function flowPageEndpoints(parsed: Record<string, unknown>): { source?: string; target?: string } {
  const entry = recordValue(parsed.entry);
  const outcome = recordValue(parsed.outcome);
  const steps = flattenRecords(Array.isArray(parsed.steps) ? parsed.steps : []);
  const first = steps[0];
  const source = stringValue(entry.page)
    ?? stringValue(first?.waitForPage)
    ?? stringValue(first?.onPage);
  const target = stringValue(outcome.page)
    ?? [...steps].reverse().flatMap((step) => [
      stringValue(step.expectPage),
      stringValue(recordValue(step.reachPage).page),
      stringValue(step.assertPage),
      stringValue(step.waitForPage)
    ]).find(Boolean);
  return { ...(source ? { source } : {}), ...(target ? { target } : {}) };
}

function savedFlowReference(flow: ScriptFlow): { id: string; version: number; name: string } {
  return { id: flow.id, version: flow.version, name: flow.name };
}

function humanizePageReferences(message: string, catalog: ScriptFlowPlannerCatalog): string {
  const references = catalog.pages
    .flatMap((page) => [page.id, page.key].map((reference) => ({ reference, name: page.name })))
    .sort((left, right) => right.reference.length - left.reference.length);
  return references.reduce((result, item) => result.replace(
    new RegExp(`["'\`“”]?${escapeRegExp(item.reference)}["'\`“”]?`, "g"),
    `“${item.name}”`
  ), message).replace(/\s*“/g, "“").replace(/”\s*/g, "”");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type ExplicitOperationKind = "launch" | "tap" | "input" | "clear" | "swipe";

type GeneratedOperationKind = ExplicitOperationKind | "select";

type ExplicitOperationContract = {
  kind: ExplicitOperationKind;
  phrase: string;
};

function extractExplicitOperationContract(prompt: string): ExplicitOperationContract[] {
  const operationPattern = /向上滑动|向下滑动|上滑|下滑|点击|点按|轻触|点(?=\s*(?:确定|取消|发布|提交|完成|下一步|返回))|输入|填写|键入|清空|滑动|启动|重启/gu;
  const clauses = prompt
    .split(/[\n，,。；;]+|(?:然后|接着|之后|随后|再(?:次)?|并(?:且)?)(?=\s*[^，,。；;])/gu)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.flatMap((clause) => {
    const matches = [...clause.matchAll(operationPattern)];
    return matches.map((match, index) => {
      const verb = match[0];
      const start = index === 0 ? 0 : match.index ?? 0;
      const end = matches[index + 1]?.index ?? clause.length;
      const phrase = clause.slice(start, end).trim();
      return {
        kind: explicitOperationKind(verb),
        phrase: phrase || verb
      };
    });
  });
}

function explicitOperationKind(verb: string): ExplicitOperationKind {
  if (/点击|点按|轻触|点/u.test(verb)) return "tap";
  if (/输入|填写|键入/u.test(verb)) return "input";
  if (verb === "清空") return "clear";
  if (/滑/u.test(verb)) return "swipe";
  return "launch";
}

function validateExplicitOperationContract(
  document: ScriptFlowDocument,
  prompt?: string,
  parameterValues: Record<string, ScriptParameterValue> = {}
): void {
  if (!prompt) return;
  const contract = extractExplicitOperationContract(prompt);
  if (!contract.length) return;
  const generated = generatedDirectOperations(document);
  let cursor = 0;
  let operationIndex = 0;
  while (operationIndex < contract.length) {
    const pickerAt = generated.findIndex((candidate, index) => index >= cursor
      && candidate.kind === "select"
      && pickerSequenceMatches(contract, operationIndex, candidate.step, parameterValues));
    if (pickerAt > cursor) {
      throw new Error("selectText 自身会打开选择字段，禁止保留重复的前置 tap 或机械滑动步骤");
    }
    const candidate = generated[cursor];
    if (pickerAt === cursor && candidate?.kind === "select" && pickerSequenceMatches(
      contract,
      operationIndex,
      candidate.step,
      parameterValues
    )) {
      operationIndex += 3;
      cursor += 1;
      continue;
    }
    const operation = contract[operationIndex]!;
    const foundAt = generated.findIndex((candidate, index) => index >= cursor && candidate.kind === operation.kind);
    if (foundAt < 0) {
      throw new Error(`用户明确操作“${operation.phrase}”没有按顺序保留；明确操作不能被 reachPage、runFlow 或已有资产替代`);
    }
    if (!explicitOperationTargetMatches(operation, generated[foundAt]!.step)) {
      throw new Error(`用户明确操作“${operation.phrase}”对应的动作目标与描述不一致或顺序错误`);
    }
    cursor = foundAt + 1;
    operationIndex += 1;
  }
}

function generatedDirectOperations(document: ScriptFlowDocument): Array<{ kind: GeneratedOperationKind; step?: ScriptStep }> {
  const operations: Array<{ kind: GeneratedOperationKind; step?: ScriptStep }> = [];
  if (["launchApp", "restartApp", "clearDataAndLaunch"].includes(document.start?.strategy ?? "")) {
    operations.push({ kind: "launch" });
  }
  for (const step of flattenSteps(document.steps)) {
    if ("launchApp" in step) operations.push({ kind: "launch", step });
    else if ("tap" in step) operations.push({ kind: "tap", step });
    else if ("inputText" in step) operations.push({ kind: "input", step });
    else if ("selectText" in step) operations.push({ kind: "select", step });
    else if ("clearText" in step) operations.push({ kind: "clear", step });
    else if ("swipe" in step || "scrollUntilVisible" in step) operations.push({ kind: "swipe", step });
  }
  return operations;
}

function validateExactPickerSelections(
  document: ScriptFlowDocument,
  prompt: string | undefined,
  parameterValues: Record<string, ScriptParameterValue>
): void {
  if (!prompt) return;
  const requestedValues = [...prompt.matchAll(
    /(?:滑动|滚动)[^，,。；;\n]{0,40}?(?:选择(?!中)|选中|调整到|设置为)\s*([^，,。；;\n]+?)(?=\s*(?:，|,|。|；|;|然后|接着|之后|随后|再(?:次)?|并(?:且)?|点(?:击|按)?\s*(?:确定|完成)|$))/gu
  )].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
  if (!requestedValues.length) return;
  const selections = flattenSteps(document.steps)
    .filter((step): step is Extract<ScriptStep, { selectText: unknown }> => "selectText" in step)
    .map((step) => resolvedScriptValue(step.selectText.value, parameterValues));
  for (const requestedValue of requestedValues) {
    const compactRequested = compactGroundingText(requestedValue);
    if (selections.some((value) => compactGroundingText(value) === compactRequested)) continue;
    throw new Error(`具体选中值“${requestedValue}”必须使用 selectText 精确保留，不能转换为固定次数滑动`);
  }
}

function pickerSequenceMatches(
  contract: ExplicitOperationContract[],
  index: number,
  step: ScriptStep | undefined,
  parameterValues: Record<string, ScriptParameterValue>
): boolean {
  if (!step || !("selectText" in step)) return false;
  const [open, choose, confirm] = contract.slice(index, index + 3);
  if (open?.kind !== "tap" || choose?.kind !== "swipe" || confirm?.kind !== "tap") return false;
  if (!explicitOperationTargetMatches(open, step)) return false;
  const selectedValue = resolvedScriptValue(step.selectText.value, parameterValues);
  if (!selectedValue || !compactGroundingText(choose.phrase).includes(compactGroundingText(selectedValue))) return false;
  const confirmText = step.selectText.confirmText?.trim() || "确定";
  return compactGroundingText(confirm.phrase).includes(compactGroundingText(confirmText))
    || (!step.selectText.confirmText && /完成/u.test(confirm.phrase));
}

function resolvedScriptValue(
  value: string,
  parameterValues: Record<string, ScriptParameterValue>
): string {
  const parameter = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim());
  if (!parameter) return value;
  const resolved = parameterValues[parameter[1]!];
  return resolved === undefined ? value : String(resolved);
}

function explicitOperationTargetMatches(operation: ExplicitOperationContract, step?: ScriptStep): boolean {
  if (!step || operation.kind === "launch" || operation.kind === "swipe") return true;
  const target = operationTarget(step);
  if (!target) return true;
  const phrase = compactGroundingText(operation.phrase);
  const operationConcept = compactOperationConcept(operation.phrase);
  if (!operationConcept) return true;
  if (target.text) return phrase.includes(compactGroundingText(target.text));
  if (target.nearText && phrase.includes(compactGroundingText(target.nearText))) return true;
  if (target.semantic) {
    const semantic = compactOperationConcept(target.semantic);
    return Boolean(semantic && operationConcept && (semantic.includes(operationConcept) || operationConcept.includes(semantic)));
  }
  if (target.icon) {
    return iconAliases(target.icon).some((alias) => phrase.includes(compactGroundingText(alias)));
  }
  if (target.control) {
    return target.control === "checkbox" && /复选框|勾选|选中|选择框|同意/u.test(operation.phrase);
  }
  return true;
}

function operationTarget(step: ScriptStep): Record<string, string> | undefined {
  const action = "tap" in step
    ? step.tap
    : "inputText" in step
      ? step.inputText
      : "clearText" in step
        ? step.clearText
        : "selectText" in step
          ? step.selectText
          : undefined;
  if (!action) return undefined;
  return Object.fromEntries(
    Object.entries(action.target).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function compactOperationConcept(value: string): string {
  return compactGroundingText(value).replace(
    /然后|接着|之后|点击|点按|轻触|找到|查找|进入|打开|前往|跳转|返回|按钮|图标|入口|页面|一个|这个|的/gu,
    ""
  );
}

function iconAliases(icon: string): string[] {
  const aliases: Record<string, string[]> = {
    add: ["add", "加号", "新增", "添加"],
    back: ["back", "返回", "左箭头"],
    close: ["close", "关闭", "叉号"],
    home: ["home", "主页", "首页"],
    more: ["more", "更多", "省略号"],
    search: ["search", "搜索", "放大镜"],
    share: ["share", "分享"]
  };
  return aliases[icon.toLowerCase()] ?? [icon];
}

function validateGoalOnlyNavigationEvidence(document: ScriptFlowDocument, prompt?: string): void {
  if (hasGeneratedResultOracle(document)) return;
  if (prompt && extractExplicitOperationContract(prompt).length > 0) return;
  const lastStep = flattenSteps(document.steps).at(-1);
  const semantic = lastStep ? stepSemanticTarget(lastStep) : undefined;
  const describesPageDestination = /(?:进入|打开|前往|跳转|到达|去往).{0,30}(?:页面|页)/u
    .test(`${prompt ?? ""} ${document.name} ${document.description ?? ""}`)
    || Boolean(semantic && /进入|打开|前往|跳转|页面|页/u.test(semantic));
  if (document.purpose === "navigation" && describesPageDestination) {
    throw new UnresolvedGoalOnlyNavigationError();
  }
}

function hasGeneratedResultOracle(document: ScriptFlowDocument): boolean {
  if (document.outcome?.page) return true;
  const lastStep = flattenSteps(document.steps).at(-1);
  if (!lastStep || "repeat" in lastStep || "when" in lastStep || "runFlow" in lastStep) return false;
  return Boolean(lastStep.expectPage)
    || "assertPage" in lastStep
    || "assertText" in lastStep
    || "waitForPage" in lastStep
    || "reachPage" in lastStep;
}

function stepSemanticTarget(step: ScriptStep): string | undefined {
  if ("tap" in step) return step.tap.target.semantic;
  if ("inputText" in step) return step.inputText.target.semantic;
  if ("clearText" in step) return step.clearText.target.semantic;
  if ("selectText" in step) return step.selectText.target.semantic;
  if ("scrollUntilVisible" in step) return step.scrollUntilVisible.target.semantic;
  return undefined;
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

function validateGeneratedNavigationReachability(
  document: ScriptFlowDocument,
  catalog: ScriptFlowPlannerCatalog
): void {
  const pagesByReference = new Map<string, ScriptFlowPlannerCatalog["pages"][number]>();
  for (const page of catalog.pages) {
    pagesByReference.set(page.id, page);
    pagesByReference.set(page.key, page);
    pagesByReference.set(page.name, page);
  }
  const canonicalPage = (reference: string | undefined) => reference ? pagesByReference.get(reference)?.key : undefined;
  const transitions = catalog.transitions.flatMap((transition) => {
    const onPage = canonicalPage(transition.onPage);
    const expectPage = canonicalPage(transition.expectPage);
    return onPage && expectPage ? [{ ...transition, onPage, expectPage }] : [];
  });
  const navigationAnchors = new Set([
    ...catalog.navigationAnchors.flatMap((anchor) => canonicalPage(anchor.page) ?? []),
    ...catalog.pages.filter((page) => page.tags.some((tag) => tag === "navigation-root" || tag === "session-root")).map((page) => page.key)
  ]);
  const flows = new Map(catalog.reusableFlows.map((flow) => [flow.id, flow]));
  let currentPage = canonicalPage(document.entry?.page);

  for (const step of flattenSteps(document.steps)) {
    if ("runFlow" in step) {
      currentPage = canonicalPage(stringValue(flows.get(step.runFlow)?.outcome?.page)) ?? currentPage;
      continue;
    }
    if ("reachPage" in step) {
      const targetPage = canonicalPage(step.reachPage.page);
      if (!targetPage) continue;
      const reachableFromCurrent = currentPage === targetPage
        || Boolean(currentPage && findPlannerTransitionPath(transitions, currentPage, targetPage));
      const reachableFromIndex = transitions.some((transition) =>
        Boolean(findPlannerTransitionPath(transitions, transition.onPage, targetPage))
      );
      if (!reachableFromCurrent && !reachableFromIndex && !navigationAnchors.has(targetPage)) {
        const target = pagesByReference.get(step.reachPage.page);
        throw new UnreachableReachPageError(target?.name ?? step.reachPage.page);
      }
      currentPage = targetPage;
      continue;
    }
    if (step.expectPage) currentPage = canonicalPage(step.expectPage) ?? currentPage;
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

function validateGeneratedTargetAreaGrounding(
  document: ScriptFlowDocument,
  input: { prompt?: string; existingDocument?: ScriptFlowDocument; catalog: ScriptFlowPlannerCatalog }
): void {
  if (!input.prompt) return;
  const explicitAreas = new Set<string>();
  if (/顶部|顶栏|上方|左上角|右上角/u.test(input.prompt)) explicitAreas.add("topBar");
  if (/底部|底栏|下方|左下角|右下角/u.test(input.prompt)) explicitAreas.add("bottomBar");
  if (/内容区|页面中(?:间|部)?|列表中|表单中/u.test(input.prompt)) explicitAreas.add("content");
  const existingTargets = flattenSteps(input.existingDocument?.steps ?? [])
    .map((step) => operationTarget(step))
    .filter((target): target is Record<string, string> => Boolean(target));
  const knownTargets: Array<Record<string, unknown>> = [
    ...existingTargets,
    ...input.catalog.navigationEntries.map((entry) => ({ ...entry.action.target }))
  ];

  for (const step of flattenSteps(document.steps)) {
    const target = operationTarget(step);
    const area = target?.area;
    const positionSensitiveRisk = step.risk === "publish"
      || step.risk === "submit"
      || step.risk === "delete"
      || step.risk === "payment";
    if (!target
      || (!target.text && !target.semantic)
      || !area
      || (area === "content" && !positionSensitiveRisk)
      || explicitAreas.has(area)) continue;
    const grounded = knownTargets.some((known) => known.area === area && sameSemanticTarget(target, known));
    if (grounded) continue;
    const label = target.text ?? target.semantic ?? target.icon ?? target.control ?? "动作目标";
    throw new Error(`动作目标“${label}”的 ${area} 约束没有来自用户描述或已验证导航知识的位置依据`);
  }
}

function sameSemanticTarget(left: Record<string, string>, right: Record<string, unknown>): boolean {
  return ["text", "semantic", "icon", "control"].some((key) => {
    const leftValue = left[key];
    const rightValue = stringValue(right[key]);
    return Boolean(leftValue && rightValue && compactGroundingText(leftValue) === compactGroundingText(rightValue));
  });
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
  return `当前还不知道如何到达“${request}”。请补充从已知状态开始的完整操作过程，或提供目标页独有的稳定文字用于验证结果。`;
}

function unresolvedGoalOnlyNavigationClarification(prompt: string): string {
  const request = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  return `当前没有完成“${request}”的已验证路径，也没有可确定的结果依据。请补充完整操作过程，或提供成功后应看到的稳定内容。`;
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

class UnreachableReachPageError extends Error {
  constructor(readonly pageName: string) {
    super(`目标页面“${pageName}”没有可执行导航路径。`);
    this.name = "UnreachableReachPageError";
  }
}

class UnresolvedGoalOnlyNavigationError extends Error {
  constructor() {
    super("目标型导航既没有已验证路径，也没有可审查的结果依据");
    this.name = "UnresolvedGoalOnlyNavigationError";
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
