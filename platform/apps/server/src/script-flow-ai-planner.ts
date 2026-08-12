import {
  parseScriptFlow,
  serializeScriptFlow,
  validateScriptFlowDocument,
  type ScriptFlowDocument,
  type ScriptParameterDefinition,
  type ScriptParameterValue,
  type ScriptSearchPolicy,
  type ScriptStep,
  type ScriptTarget,
  type ScriptFlowTestLevel
} from "@mobile-automation/script-flow";
import type { NavigationEntry, ScreenUnderstandingContext, ScriptFlow, ScriptFlowVerificationAssessment } from "@mobile-automation/shared";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetCatalog, PageAssetPlatform } from "./page-asset-catalog.js";
import type { ScriptFlowAiTimingContext } from "./script-flow-ai-timing.js";
import { timedScriptFlowAiStage } from "./script-flow-ai-timing.js";
import { assessScriptFlowVerification } from "./script-flow-verification.js";

export const SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化 ScriptFlow 规划器，只生成可审查的脚本草稿，不操作设备。",
  "规划阶段默认不读取实时设备页面；只有用户显式开启看屏时，才能使用服务端提供的受控 screenContext。onPage 和 expectPage 只表达显式步骤自身的页面约束。",
  "先判断测试类型：单一业务目标标记为 case；多个可独立成立的业务目标标记为 scenario。导航、登录态准备和结果验证不算额外业务目标。",
  "必须用顶层 purpose 标记测试主要目的：navigation、fixture、business 或 recovery。navigation 只到达状态，fixture 准备测试环境，business 验证业务行为，recovery 恢复可执行状态。",
  "每个步骤必须显式标记 role：setup、navigation、business、assertion、reset、cleanup 或 recovery。role 按该步骤在整个测试中的语义填写，不能仅根据动作类型猜测。",
  "新草稿使用显式步骤表达前置准备、业务操作、结果验证和每轮复位：setup 步骤属于前置准备，business 步骤属于业务操作，assertion 步骤属于结果验证，reset 步骤属于循环业务与验证时每轮结束后回到业务起点的动作。不要使用 entry、outcome 或 start 让执行器补动作。",
  "每轮复位不得自动推断。只有用户明确描述循环时每轮结束后的返回路径，才生成 role: reset 的步骤；只有用户明确说明业务执行后自然回到起点、无需复位时，才输出顶层 loop: { reset: \"none\" }；其他情况省略 loop 和 reset 步骤，交给用户在编排器确认。",
  "页面目录只负责页面身份。动作目标必须且只能使用 text、icon、visual 或 control：已知屏幕原文用 text；文本语义匹配使用 text + match: semantic；搜索/返回/分享/更多/加号等常见标准视觉符号用 icon；无法确定为标准 icon role、但用户明确说图标、图片、图形、视觉符号或 icon/image 时必须使用 visual；通用表单控件用 control。禁止生成 semantic 目标字段。",
  "页面 key、页面 id、ScriptFlow id 和类似 classin.teacher.xxx 的内部引用不能作为 tap、inputText、clearText、selectText 或 scrollUntilVisible 的动作目标。",
  "text 必须是用户原文、页面目录名称或现有用例中已有的字面标签，禁止擅自增加‘创建、进入、打开、发布’等词。需要表达‘进入教学方案的入口’这类文本语义目标时，使用 text + match: semantic，不能伪装成屏幕原文。",
  "text 目标必须显式区分 exact/contains 语义：默认或省略 match 等价于 match: exact，运行时语义是 equals；执行器会严格按脚本 match 执行，equals 不会自动退化为 contains。可点击 text 目标默认按完整控件文字匹配：按钮、Tab、菜单项、卡片标题、班级名、昵称、编号和 ${parameterName} 这类参数化名称不要写 match: contains；用户明确表达‘包含、带有、关键字、模糊匹配’，或受控 screenContext/读屏证据显示实际控件原文包含目标基础词但额外带动态数量、状态、后缀或前缀时，才可写 match: contains，且必须尽量补充 area、nearText、scopeText、ordinal 或容器语义。",
  "text、icon、visual 和 control 都不要求先创建元素资产。内容可能在屏幕外时配置 search: { mode: auto }；弹层菜单、顶栏和底栏使用 search: { mode: visibleOnly }。",
  "完整当前页控件动作是指用户已经给出字段/控件名以及要执行的状态或输入值，且没有明确要求进入、前往或到达某个页面。此时必须生成基于当前页面的直接动作，不要补 entry、outcome、onPage、reachPage 或 runFlow，也不要把页面目录当成动作前置条件。",
  "表单字段动作默认使用 search: { mode: auto }。只有用户明确说当前可见、顶部、底部、弹窗/菜单，或受控 screenContext 明确给出当前可见候选时，才使用 visibleOnly。",
  "用户说通过滑动、滚动、查找、找到、定位或搜索某字段/条目/控件时，这是目标动作的运行时查找策略，不是独立 swipe 步骤；即使 screenContext 当前首屏没有该字段，也应生成该字段的直接动作并使用 search: { mode: auto }，不能因此追问。",
  "不要把“修改、设置、输入、打开、关闭、选择”等用户操作动词当成按钮文字。用户没有明确说点击某个入口时，禁止擅自补“点击修改”或其他桥接动作；只有当前屏幕没有证实目标字段、且用户也没有提供字段文字或可执行查找策略时，才返回 needs_clarification 询问准确字段位置或完整操作路径。",
  "text 目标默认不要猜测 topBar/bottomBar。只有用户明确说顶部、底部、左上角、右上角等位置，或目录中的已验证导航入口/原用例已经给出同一目标位置时，才可增加窄区域约束；否则省略 area，让执行器在当前屏幕查找。",
  "发布、提交、删除、支付等操作按钮可能位于顶部、内容区或底部；用户或已验证知识未提供位置时必须省略 area，禁止根据动作名称猜测区域。",
  "icon 和 visual 都是非 OCR 视觉目标；非 OCR 视觉目标必须尽量补全跨平台限定：area、position、nearText、scopeText 或 ordinal。用户明确说顶部、底部、左上角、右上角、左侧、右侧或某段文字附近时必须写入对应限定；用户未提供任何限定且标准视觉 role 足够明确时才可省略。内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing }；不要把自定义产品图形臆测成标准图标。",
  "visual 用于无法归入标准 icon role、但用户明确描述为视觉目标的对象，例如 { visual: { kind: icon, query: \"课堂报告右侧箭头图标\", area: content, position: trailing, nearText: \"课堂报告\" } } 或 { visual: { kind: image, query: \"封面图片\", area: content } }。执行器如果缺少视觉 grounding 能力会明确失败，planner 不得改写成 text。",
  "用户明确说‘点击左上角返回按钮/返回图标’时，必须生成 { icon: back, area: topBar, position: leading } 的 tap；右上角分享按钮生成 { icon: share, area: topBar, position: trailing }。这是视觉点击，不得改写为页面恢复、reachPage 或重启。",
  "control 当前支持 checkbox、switch 和 textField。checkbox 必须描述 area: content 和 nearText；switch 必须描述 area: content、nearText 和 checked，checked=true 表示打开/开启，checked=false 表示关闭；textField 必须描述 area: content、scopeText 和 ordinal，用于预填输入框没有稳定标签的场景；登录账号或密码这类没有稳定外显字段标签的输入框必须使用 control: textField，不能用占位符 OCR 文本作为 target.text。",
  "textField.scopeText 必须是局部表单区域标题、字段组标题或控件附近稳定文字，不能使用页面标题、顶栏固定标题、App 名称等全局固定文字。用户只用“某页面标题上方/下方/第几个输入框”定位时应返回 needs_clarification，请其补充局部字段名或开启当前屏幕辅助。",
  "执行器能力合同：visual 仅支持 tap；selectText 和 scrollUntilVisible 必须使用 text；inputText 和 clearText 必须使用 text 或 control: textField。",
  "一个 tap 只执行一次点击。即使目标标签像流程描述，也不得把一次点击解释成打开菜单后继续选择；用户过程包含几次点击就生成几个步骤。",
  "用户明确操作是硬约束：点击、输入、清空、滑动或启动等操作必须按用户描述的顺序保留，不能被 reachPage、runFlow、已有资产或更短路径替代。用户明确要求启动时生成唯一一个 role: setup 的 launchApp；没有要求启动时不要添加。",
  "ScriptFlow 的 launchApp 表示保留应用数据，先终止应用进程再重新启动；步骤名称应写为‘重启 App’，不能把它描述成仅切回前台。",
  "用户描述打开选择器、滑动到具体选中值并确认时，必须把这组机械操作规范化为一个 selectText：target 保留字段入口，value 完整保留用户指定值，confirmText 保留确认文字。selectText 自身会点击并打开字段，由执行器动态查找选项；禁止保留前置 tap，也禁止猜测固定滑动次数。",
  "用户只表达进入、打开、前往或回到某页面时，这是目标状态而不是操作方式。只有目标是 navigationAnchors 中的状态入口，或 transitions 中存在到该目标的路径时，才生成 reachPage；不要因为‘回到’推断系统返回或重启。",
  "navigationEntries 是试运行验证并经用户确认的导航入口。目标型请求只能使用 navigationEntries、已验证 transitions 或 navigationAnchors；页面标签和页面名称不能作为入口推断依据。",
  "只有用户明确描述点击、返回、重启等过程时才生成对应过程；reachPage 的运行时执行器只使用已验证导航索引和受控入口恢复，不会猜测未知点击路径。",
  "动作会进入另一个页面时，把目标页写在该动作的 expectPage；不要再紧跟一个独立 assertPage。assertPage 只用于用户明确要求单独验证当前页面的场景。",
  "目标页面未录入时禁止引用或编造 page key。用户提供明确操作或完整操作链时必须先生成可试运行的直接动作；有独有稳定文字时用最终 assertText 验证，没有稳定文字时省略未知页面约束和结果断言，由系统标记为结果待确认，不能因此返回 needs_clarification。",
  "只能引用目录中存在的 page key 和 active ScriptFlow id。禁止元素资产 ID、坐标、bounds、region_center、圈选区域或固定屏幕区域点击。",
  "用户只说到达一个未录入页面、又没有提供操作路径时返回 needs_clarification，请用户补充从已知状态开始的完整点击过程或目标页独有稳定文字。不要要求用户先录制资产。",
  "目标型请求生成 reachPage；过程型请求按用户描述保留每个动作，不擅自扩展成创建、发布、提交或删除。场景编排命中完全匹配的启用用例时自动使用 runFlow，不要求用户再确认复用；用户明确描述具体操作过程时则保留该过程。",
  "runFlow 只复用子用例的业务步骤与结果验证，不继承子用例的前置准备和每轮复位。引用用于登录或环境准备时标记 role: setup，引用作为被测流程时标记 role: business，作为结果验证时标记 role: assertion，作为每轮复位时标记 role: reset；父测试必须显式维护自己的启动、环境准备和复位步骤。",
  "动态业务值必须声明为 parameters 并在步骤中使用 ${parameterName}。用户已给出的值放入顶层 parameterValues，仅用于本次运行；未给出但执行必需的值设 required: true。字段标签、按钮、Tab、菜单项和固定入口文案不是参数；输入值、选中值、搜索词以及班级、老师、学生、课程、文件、群、日期、时间、数量等业务实体才是参数。",
  "账号、密码等 sensitive 参数禁止写入 parameters.default、summary 或 assumptions，必须只放入顶层 parameterValues。",
  "runFlow 会自动继承父测试中的同名参数；规划器会把复用用例和 reachPage 导航路径所需参数汇总到运行配置。",
  "常用参数直接展示；低频可选参数标记 advanced: true。枚举只有在输入目录给出合法选项时才能使用 select/options。",
  "执行器严格按照脚本中的显式命令执行，不推测前置页面，不插入返回、重启、页面恢复或结果断言。",
  "信息不足时返回 needs_clarification 和一个简短问题，不要猜测。只返回唯一 JSON 对象，不要 Markdown、代码围栏、解释文字或额外字段。"
].join("\n");

export type ScriptFlowPlannerCatalog = ReturnType<typeof buildScriptFlowPlannerCatalog>;

export type ScriptFlowExternalContext = {
  source: "code" | "directory" | "classin-code" | "manual";
  summary: string;
  implementationStack?: "android-native" | "ios-native" | "harmony-native" | "flutter" | "compose" | "swiftui" | "arkui" | "unknown";
  relevantFiles?: string[];
  candidateSteps?: string[];
  constraints?: string[];
};

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

const SCRIPT_FLOW_READY_RESPONSE_FIELDS = ["status", "summary", "assumptions", "parameterValues", "document"];
const SCRIPT_FLOW_DOCUMENT_RESPONSE_FIELDS = [
  "version",
  "kind",
  "purpose",
  "testLevel",
  "name",
  "description",
  "app",
  "start",
  "entry",
  "outcome",
  "parameters",
  "steps",
  "loop",
  "tags"
];
const SCRIPT_FLOW_FLATTENED_READY_RESPONSE_FIELDS = new Set([
  ...SCRIPT_FLOW_READY_RESPONSE_FIELDS,
  ...SCRIPT_FLOW_DOCUMENT_RESPONSE_FIELDS
]);

export async function generateScriptFlowDraft(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  pageCatalog: PageAssetCatalog;
  flows: ScriptFlow[];
  navigationEntries?: NavigationEntry[];
  existingFlow?: ScriptFlow;
  screenContext?: ScreenUnderstandingContext;
  externalContext?: ScriptFlowExternalContext;
  timingContext?: ScriptFlowAiTimingContext;
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
  const plannerPrompt = buildScriptFlowPlannerPrompt(input.prompt, input.appId, input.platform, catalog, existingDocument, input.screenContext, input.externalContext);
  const plannerEffort = scriptFlowPlannerEffort({
    prompt: input.prompt,
    existingDocument,
    screenContext: input.screenContext
  });
  const result = await timedScriptFlowAiStage(input.timingContext, "planner_request", () => runAiJsonRequest(requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: plannerPrompt,
    effort: plannerEffort
  }, input.fetchImpl ?? fetch), { channel, model: input.config.model, screenContext: Boolean(input.screenContext), effort: plannerEffort });
  const parseInput = {
    appId: input.appId,
    platform: input.platform,
    catalog,
    prompt: input.prompt,
    existingDocument,
    screenContext: input.screenContext
  };
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
    if (firstError instanceof ActionTargetPageReferenceError) {
      return {
        status: "needs_clarification",
        clarification: actionTargetPageReferenceClarification(firstError.reference),
        channel,
        model: input.config.model
      };
    }
    if (firstError instanceof UnsupportedExecutableTargetError) {
      return {
        status: "needs_clarification",
        clarification: unsupportedExecutableTargetClarification(firstError.action),
        channel,
        model: input.config.model
      };
    }
    if (firstError instanceof PlaceholderExecutableTargetError) {
      return {
        status: "needs_clarification",
        clarification: placeholderExecutableTargetClarification(firstError.target),
        channel,
        model: input.config.model
      };
    }
    if (firstError instanceof UnstableTextFieldScopeError) {
      return {
        status: "needs_clarification",
        clarification: unstableTextFieldScopeClarification(firstError.scopeText),
        channel,
        model: input.config.model
      };
    }
    const repaired = await timedScriptFlowAiStage(input.timingContext, "repair_request", () => runAiJsonRequest(requestConfig, {
      developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
      userContent: buildScriptFlowRepairPrompt(plannerPrompt, result.content, firstError),
      effort: "low"
    }, input.fetchImpl ?? fetch), { channel, model: input.config.model, error: compactError(firstError) });
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
      if (repairError instanceof ActionTargetPageReferenceError) {
        return {
          status: "needs_clarification",
          clarification: actionTargetPageReferenceClarification(repairError.reference),
          channel,
          model: input.config.model
        };
      }
      if (repairError instanceof UnsupportedExecutableTargetError) {
        return {
          status: "needs_clarification",
          clarification: unsupportedExecutableTargetClarification(repairError.action),
          channel,
          model: input.config.model
        };
      }
      if (repairError instanceof PlaceholderExecutableTargetError) {
        return {
          status: "needs_clarification",
          clarification: placeholderExecutableTargetClarification(repairError.target),
          channel,
          model: input.config.model
        };
      }
      if (repairError instanceof UnstableTextFieldScopeError) {
        return {
          status: "needs_clarification",
          clarification: unstableTextFieldScopeClarification(repairError.scopeText),
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
    const clarification = parsed.clarification;
    const reviewed = await timedScriptFlowAiStage(input.timingContext, "clarification_review_request", () => runAiJsonRequest(requestConfig, {
      developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
      userContent: buildScriptFlowClarificationReviewPrompt(plannerPrompt, clarification),
      effort: "low"
    }, input.fetchImpl ?? fetch), { channel, model: input.config.model });
    try {
      parsed = parseScriptFlowAiResponse(reviewed.content, parseInput);
    } catch {
      parsed = initialClarification;
    }
  }
  if (parsed.status === "needs_clarification") {
    return { ...parsed, channel, model: input.config.model };
  }
  parsed = await reviewAndRepairParameterization({
    parsed,
    plannerPrompt,
    requestConfig,
    parseInput,
    fetchImpl: input.fetchImpl ?? fetch,
    channel,
    model: input.config.model,
    timingContext: input.timingContext
  });
  parsed = await reviewAndRepairNonOcrGrounding({
    parsed,
    plannerPrompt,
    requestConfig,
    parseInput,
    fetchImpl: input.fetchImpl ?? fetch,
    channel,
    model: input.config.model,
    timingContext: input.timingContext
  });
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
  existingDocument?: ScriptFlowDocument,
  screenContext?: ScreenUnderstandingContext,
  externalContext?: ScriptFlowExternalContext
): string {
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
        app: { id: appId },
        parameters: {},
        steps: [],
        tags: ["ai-generated"]
      }
    }, null, 2),
    "可用动作：launchApp、tap、inputText、clearText、selectText、swipe、scrollUntilVisible、reachPage、waitForPage、assertPage、assertText、runFlow、repeat、when。",
    `系统判定的 testLevel：${systemTestLevel}。document.testLevel 必须保持这个值，不能由模型自行改成其它层级。`,
    "testLevel 含义：probe=临时验证单点问题，component=字段/控件能力用例，business_smoke=最小业务主链路，full_regression=全字段或全配置回归。",
    "full_regression 不允许凭页面名称自动枚举字段。用户未列出全部字段时，先根据已有上下文生成可编辑草稿，并在 assumptions 中说明当前覆盖范围；不要仅因此返回 needs_clarification。",
    "每个 steps 项必须包含非空 id 和显式 role，并把动作名直接作为字段；每步只能有一个动作字段。不要输出 action 或 page 字段。",
    "步骤格式示例（只说明结构，页面引用必须从本次目录选择）：",
    JSON.stringify(stepShapeExamples(appId, catalog), null, 2),
    "target 必须且只能使用 text、icon、visual 或 control。text 是可在屏幕上按字面读取的原文，必须能追溯到用户输入或已知目录；文本语义匹配使用 text + match: semantic；搜索/返回/分享/更多/加号等常见标准视觉符号用 icon；无法确定为标准 icon role、但用户明确说图标、图片、图形、视觉符号或 icon/image 时必须使用 visual，不能改写成 text。非 OCR 视觉目标必须尽量补全跨平台限定：area、position、nearText、scopeText 或 ordinal；用户明确说顶部、底部、左上角、右上角、左侧、右侧或某段文字附近时必须写入对应限定。control 支持 checkbox、switch 与 textField：checkbox 必须带 area: content 和 nearText；switch 必须带 area: content、nearText 和 checked；textField 必须带 area: content、scopeText 和 ordinal；登录账号或密码这类没有稳定外显字段标签的输入框必须使用 control: textField，不能用占位符 OCR 文本作为 target.text；禁止元素资产 ID、坐标、区域和临时视觉模板，也禁止 semantic 目标字段。",
    "textField.scopeText 必须是局部表单区域标题、字段组标题或控件附近稳定文字，不能使用页面标题、顶栏固定标题、App 名称等全局固定文字。用户只用“某页面标题上方/下方/第几个输入框”定位时返回 needs_clarification，要求补充局部字段名或开启当前屏幕辅助。",
    "text 目标必须显式区分 exact/contains 语义：默认或省略 match 等价于 match: exact，运行时语义是 equals；执行器会严格按脚本 match 执行，equals 不会自动退化为 contains。可点击 text 默认按完整控件文字匹配，按钮、Tab、菜单项、卡片标题、班级名、昵称、编号和参数化名称不要写 match: contains。使用 screenContext 或读屏证据时，根据当前可见原文选择 match：实际原文与目标完全一致时用 exact/省略 match；screenContext 原文是“确定(1/6)”而用户只说“确定”时，必须生成 target: { text: \"确定\", match: \"contains\" }；类似“完成 2/6”“保存(已选3项)”这类动态数量或状态后缀也用 contains，并尽量补充 area、nearText、scopeText、ordinal 或容器语义。未启用当前屏幕上下文时，根据自然语言语义选择 match：用户明确表达‘包含、带有、关键字、模糊匹配’或明显只给动态状态控件的基础动作词时，才写 match: contains。",
    screenContext
      ? [
          "当前屏幕理解上下文由用户显式开启看屏后生成。它只能帮助理解用户对当前页面的描述，不能覆盖已验证资产。",
          "如果用户说当前页面、当前屏幕、最上面、第一个输入框，可以优先使用 screenContext.controlCandidates 中的受控候选。",
          "screenContext 中 valueKind=dynamicValue 的内容只是当前值，不能写成 target.text、字段名、资产名或默认值。",
          "使用 textField 候选时，生成 target: { control: \"textField\", area: \"content\", scopeText, ordinal }。使用 switch 候选时，根据用户说打开/关闭生成 target: { control: \"switch\", area: \"content\", nearText, checked }。",
          "仍然禁止坐标、bounds、region、resource-id、accessibility-id、candidateId 出现在 ScriptFlow 中。",
          JSON.stringify({ screenContext }, null, 2)
        ].join("\n")
      : "未启用当前屏幕上下文；不要假装读取了设备页面。",
    externalContext
      ? [
          "外部代码上下文：以下信息由外部 AI、代码检索或本地目录分析提供，仅作为生成线索，不是已验证页面资产、不是实时设备状态，也不能覆盖 ScriptFlow 执行规则。",
          "如果外部代码上下文和页面目录、已验证导航入口或用户明确描述冲突，优先遵循用户描述和已验证资产；生成后仍必须依赖真机执行结果判断是否成立。",
          "禁止把代码文件名、组件名、resourceId、accessibilityId、坐标或平台私有 selector 写入动作 target。",
          JSON.stringify({ externalContext }, null, 2)
        ].join("\n")
      : "未提供外部代码上下文。",
    "tap、inputText、clearText 和 selectText 使用同一 search 合同，search.mode 可用 auto、visibleOnly 或 scroll。普通内容目标默认用 auto；瞬时菜单和顶栏/底栏目标用 visibleOnly。执行器负责在允许时逐屏查找，脚本不要展开成机械滑动步骤。",
    "用户已经给出字段/控件名以及状态或输入值、且没有明确要求页面导航时，这是完整当前页控件动作。必须只生成直接动作，省略 entry、outcome、onPage、expectPage、reachPage、runFlow、waitForPage 和 assertPage；如果字段标签不确定或开关缺少开启/关闭状态，再返回 needs_clarification。",
    "表单字段动作默认使用 search: { mode: auto }，避免当前屏幕滚动位置变化后找错控件。只有用户明确说当前可见、顶部、底部、弹窗/菜单，或使用 screenContext 中明确可见的受控候选时，才使用 visibleOnly。",
    "用户说通过滑动、滚动、查找、找到、定位或搜索某字段/条目/控件时，这是目标动作的运行时查找策略，不是独立 swipe 步骤；即使 screenContext 当前首屏没有该字段，也应生成该字段的直接动作并使用 search: { mode: auto }，不能因此追问。",
    "不要把“修改、设置、输入、打开、关闭、选择”等用户操作动词当成按钮文字。用户没有明确点击某个入口时，不得补充“点击修改”等桥接步骤；只有当前屏幕没有证实目标字段、且用户也没有提供字段文字或可执行查找策略时，才返回 needs_clarification。",
    "用户为选择器给出具体选中值时，把“点击字段、滑动选择该值、点击确定/完成”合并为一个 selectText，value 必须精确保留，confirmText 使用用户说出的确认文字；selectText 自身会打开字段，前面禁止再生成 tap，也禁止生成固定次数 swipe 来猜选项位置。",
    "只表达目标页面时，仅当目标属于 navigationAnchors，或能通过 navigationEntries、已验证 transitions 到达时使用 reachPage: { page: <目录页面>, policy: safe }。不要因为“回到”推断系统返回或重启，也不要根据页面名称或标签猜测导航入口。reachPage 自身会验证目标页，不要追加 assertPage。",
    "不要输出 risk 字段。用户点击执行即表示授权运行当前可见脚本，系统不根据按钮文案推断业务风险。",
    "直接理解用户的完整意图和操作顺序，不依赖服务端预先拆出的中文动作契约。用户明确描述的过程应逐步保留；只描述目标时可以使用已验证导航知识补全。",
    "明确操作即使缺少当前页面 key、目标页面资产或自动结果判据，也应返回 ready 并生成可试运行动作；省略无法确定的 onPage、expectPage、outcome 和断言，系统会将结果标记为待确认。只有缺少班级名、账号、输入值等实际执行参数时才能返回 needs_clarification。",
    existingDocument ? "修改现有用例：" : "输入：",
    JSON.stringify({ prompt, appId, ...(existingDocument ? { existingDocument } : {}), catalog }, null, 2)
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

export function scriptFlowPlannerEffort(input: {
  prompt: string;
  existingDocument?: ScriptFlowDocument;
  screenContext?: ScreenUnderstandingContext;
}): "low" | "medium" {
  if (input.existingDocument || classifyScriptFlowTestLevel(input.prompt) === "full_regression") {
    return "medium";
  }
  const compactPrompt = input.prompt.replace(/\s+/g, " ").trim();
  if (compactPrompt.length > 240) {
    return "medium";
  }
  if (input.screenContext) {
    return "low";
  }
  const explicitOperations = extractExplicitOperationContract(input.prompt);
  return explicitOperations.length > 0 && explicitOperations.length <= 6 ? "low" : "medium";
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

type ReadyParsedScriptFlowAiDraft =
  Omit<ScriptFlowAiGeneratedDraft, "status" | "channel" | "model" | "verification"> & { status: "ready" };

type ScriptFlowReviewAssessment = {
  status: "ok" | "needs_repair";
  summary: string;
  issues: Array<{ stepId?: string; reason: string }>;
  repairInstructions?: string;
};

type ScriptFlowParameterizationReview = ScriptFlowReviewAssessment;
type ScriptFlowGroundingReview = ScriptFlowReviewAssessment;

async function reviewAndRepairParameterization(input: {
  parsed: ReadyParsedScriptFlowAiDraft;
  plannerPrompt: string;
  requestConfig: { baseURL: string; apiKey?: string; model: string; timeoutMs: number };
  parseInput: Parameters<typeof parseScriptFlowAiResponse>[1];
  fetchImpl: AiClientFetch;
  channel: "codex" | "openai-compatible";
  model: string;
  timingContext?: ScriptFlowAiTimingContext;
}): Promise<ReadyParsedScriptFlowAiDraft> {
  const review = await timedScriptFlowAiStage(input.timingContext, "parameterization_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowParameterizationReviewPrompt(input.parseInput.prompt ?? "", input.parsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const assessment = parseScriptFlowParameterizationReview(review.content);
  if (assessment.status === "ok") return input.parsed;

  const repaired = await timedScriptFlowAiStage(input.timingContext, "parameterization_repair_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowParameterizationRepairPrompt(input.plannerPrompt, input.parsed, assessment),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedParsed = parseScriptFlowAiResponse(repaired.content, input.parseInput);
  if (repairedParsed.status === "needs_clarification") {
    throw new Error(`parameterization repair 返回了追问信息：${repairedParsed.clarification}`);
  }
  const repairedReview = await timedScriptFlowAiStage(input.timingContext, "parameterization_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowParameterizationReviewPrompt(input.parseInput.prompt ?? "", repairedParsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedAssessment = parseScriptFlowParameterizationReview(repairedReview.content);
  if (repairedAssessment.status === "needs_repair") {
    throw new Error(`AI 修复后仍未通过参数化 review：${repairedAssessment.summary}`);
  }
  return repairedParsed;
}

async function reviewAndRepairNonOcrGrounding(input: {
  parsed: ReadyParsedScriptFlowAiDraft;
  plannerPrompt: string;
  requestConfig: { baseURL: string; apiKey?: string; model: string; timeoutMs: number };
  parseInput: Parameters<typeof parseScriptFlowAiResponse>[1];
  fetchImpl: AiClientFetch;
  channel: "codex" | "openai-compatible";
  model: string;
  timingContext?: ScriptFlowAiTimingContext;
}): Promise<ReadyParsedScriptFlowAiDraft> {
  if (!hasNonOcrTapTargets(input.parsed.document)) return input.parsed;
  const review = await timedScriptFlowAiStage(input.timingContext, "grounding_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowGroundingReviewPrompt(input.parseInput.prompt ?? "", input.parsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const assessment = parseScriptFlowGroundingReview(review.content);
  if (assessment.status === "ok") return input.parsed;

  const repaired = await timedScriptFlowAiStage(input.timingContext, "grounding_repair_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowGroundingRepairPrompt(input.plannerPrompt, input.parsed, assessment),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedParsed = parseScriptFlowAiResponse(repaired.content, input.parseInput);
  if (repairedParsed.status === "needs_clarification") {
    throw new Error(`grounding repair 返回了追问信息：${repairedParsed.clarification}`);
  }
  const repairedReview = await timedScriptFlowAiStage(input.timingContext, "grounding_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowGroundingReviewPrompt(input.parseInput.prompt ?? "", repairedParsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedAssessment = parseScriptFlowGroundingReview(repairedReview.content);
  if (repairedAssessment.status === "needs_repair") {
    throw new Error(`AI 修复后仍未通过非 OCR 目标 grounding review：${repairedAssessment.summary}`);
  }
  return repairedParsed;
}

function buildScriptFlowParameterizationReviewPrompt(
  prompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml" | "summary" | "assumptions" | "parameterValues">
): string {
  return [
    "请对下面 ScriptFlow 草稿做参数化 review。",
    "目标：判断用户原始描述中的运行时业务值是否被错误硬编码在脚本里。你需要理解自然语言和业务语义，不要依赖固定词表，也不要因为脚本合法就直接通过。",
    "应该参数化：inputText.value、selectText.value、搜索词、账号、密码、课堂名、班级名、老师名、学生名、课程名、文件名、群名、日期、时间、数量，以及用户要选择的具体业务实体。tap.target.text 如果是用户要选中的具体业务对象，也应该参数化。",
    "不应该参数化：固定 UI 控件、按钮、Tab、菜单项、字段标签、页面入口、确认/取消/发布/创建/课堂信息/联席教师等产品文案。字段标签本身不是参数，字段的值才是参数；开关名通常不是参数，除非用户明确要求开关状态运行时可变。",
    "如果发现硬编码业务值，返回 needs_repair 并给出可操作的 repairInstructions；修复时必须在 document.parameters 声明参数，脚本中改用 ${parameterName}，用户本次给出的值放入顶层 parameterValues。sensitive 参数不得写入 default、summary 或 assumptions。",
    "如果参数化已经合理，返回 ok。",
    "只返回唯一 JSON 对象，格式：",
    JSON.stringify({
      status: "ok | needs_repair",
      summary: "审查摘要",
      issues: [{ stepId: "可选步骤 id", reason: "问题原因" }],
      repairInstructions: "needs_repair 时填写"
    }, null, 2),
    "用户原始描述：",
    prompt || "未提供",
    "草稿摘要：",
    parsed.summary,
    "草稿 assumptions：",
    JSON.stringify(parsed.assumptions, null, 2),
    "草稿 parameterValues：",
    JSON.stringify(parsed.parameterValues, null, 2),
    "草稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function buildScriptFlowParameterizationRepairPrompt(
  plannerPrompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml">,
  review: ScriptFlowParameterizationReview
): string {
  return [
    plannerPrompt,
    "上一稿未通过参数化 review。请只根据 review 指令修复硬编码业务值的参数化，不要改变步骤顺序、动作语义、页面约束、match/search 策略或非参数相关目标定位。",
    "修复要求：在 document.parameters 中声明缺失参数；步骤中用 ${parameterName} 引用；用户本次已经给出的值放入顶层 parameterValues；固定 UI 文案继续保留字面量；sensitive 参数不要写 default、summary 或 assumptions。",
    "review 结果：",
    JSON.stringify(review, null, 2),
    "上一稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function buildScriptFlowGroundingReviewPrompt(
  prompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml" | "summary" | "assumptions">
): string {
  return [
    "请对下面 ScriptFlow 草稿做 grounding review。",
    "只审查 icon/visual 这类非 OCR 视觉目标是否充分保留了用户原始描述中的跨平台定位线索，例如位置、顺序、附近文字、所属区域或范围。",
    "由你根据自然语言灵活判断用户是否提供了这些线索；不要依赖固定词表，也不要因为脚本合法就直接通过。",
    "如果脚本丢失了重要线索，返回 needs_repair 并给出可操作的 repairInstructions；否则返回 ok。",
    "只返回唯一 JSON 对象，格式：",
    JSON.stringify({
      status: "ok | needs_repair",
      summary: "审查摘要",
      issues: [{ stepId: "可选步骤 id", reason: "问题原因" }],
      repairInstructions: "needs_repair 时填写"
    }, null, 2),
    "用户原始描述：",
    prompt || "未提供",
    "草稿摘要：",
    parsed.summary,
    "草稿 assumptions：",
    JSON.stringify(parsed.assumptions, null, 2),
    "草稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function buildScriptFlowGroundingRepairPrompt(
  plannerPrompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml">,
  review: ScriptFlowGroundingReview
): string {
  return [
    plannerPrompt,
    "上一稿未通过非 OCR 目标 grounding review。请只根据 review 指令修复脚本中缺失的跨平台限定，不要引入坐标、resourceId、accessibilityId 或平台私有 selector。",
    "review 结果：",
    JSON.stringify(review, null, 2),
    "上一稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function parseScriptFlowGroundingReview(raw: string): ScriptFlowGroundingReview {
  return parseScriptFlowReviewAssessment(raw, "grounding review");
}

function parseScriptFlowParameterizationReview(raw: string): ScriptFlowParameterizationReview {
  return parseScriptFlowReviewAssessment(raw, "参数化 review");
}

function parseScriptFlowReviewAssessment(raw: string, label: string): ScriptFlowReviewAssessment {
  const root = recordValue(parseAiJsonObject(raw));
  const status = stringValue(root.status);
  if (status === "ready" && root.document) {
    return { status: "ok", summary: `${label} did not return an assessment`, issues: [] };
  }
  if (status !== "ok" && status !== "needs_repair") {
    throw new Error(`${label} 返回了未知状态`);
  }
  const issues = Array.isArray(root.issues)
    ? root.issues.flatMap((item) => {
      const issue = recordValue(item);
      const reason = stringValue(issue.reason);
      if (!reason) return [];
      return [{ ...(stringValue(issue.stepId) ? { stepId: stringValue(issue.stepId) } : {}), reason }];
    })
    : [];
  return {
    status,
    summary: stringValue(root.summary) ?? (status === "ok" ? `${label} passed` : `${label} requested repair`),
    issues,
    ...(stringValue(root.repairInstructions) ? { repairInstructions: stringValue(root.repairInstructions) } : {})
  };
}

function hasNonOcrTapTargets(document: ScriptFlowDocument): boolean {
  return flattenSteps(document.steps).some((step) => "tap" in step && Boolean(step.tap.target.icon || step.tap.target.visual));
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
      tap: { target: { text: "内容文字", match: "exact", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-semantic-entry",
      role: "navigation",
      onPage: pageReference,
      tap: { target: { text: "进入目标功能的入口", match: "semantic", area: "content" }, search: { mode: "auto", direction: "down", maxSwipes: 6 } }
    },
    {
      id: "tap-standard-icon",
      role: "navigation",
      onPage: pageReference,
      tap: { target: { icon: "add", area: "topBar", position: "trailing" }, search: { mode: "visibleOnly" } }
    },
    {
      id: "tap-visual-icon",
      role: "business",
      onPage: pageReference,
      tap: { target: { visual: { kind: "icon", query: "课堂报告右侧箭头图标", area: "content", position: "trailing", nearText: "课堂报告" } }, search: { mode: "visibleOnly" } }
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
      id: "enable-recording",
      role: "business",
      onPage: pageReference,
      tap: { target: { control: "switch", area: "content", nearText: "录制ClassIn教室", checked: true }, search: { mode: "visibleOnly" } }
    },
    {
      id: "fill-content-field",
      role: "business",
      onPage: pageReference,
      inputText: {
        target: { text: "课堂名称", area: "content" },
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
      }
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
    screenContext?: ScreenUnderstandingContext;
  }
): ParsedScriptFlowAiDraft {
  const value = parseAiJsonObject(raw);
  const root = normalizeScriptFlowAiResponseRoot(recordValue(value));
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
  const generatedDocument = normalizeGeneratedExplicitExecution(
    normalizeGeneratedRunFlowReferences(root.document, input.catalog),
    input.appId
  );
  const validated = validateScriptFlowDocument(generatedDocument);
  const hydrated = validateScriptFlowDocument(hydrateGeneratedParameters(validated, input.catalog));
  const { document: extractedDocument, parameterValues } = extractEphemeralParameterValues(hydrated, root.parameterValues);
  const document = validateScriptFlowDocument(normalizeGeneratedExecutableTargets(extractedDocument, input));
  validateGeneratedReferences(document, input);
  validateGeneratedActionTargetReferences(document, input.catalog);
  validateGeneratedExecutableTargetContracts(document, input.prompt);
  validateGeneratedTextFieldScopes(document, input);
  validateGeneratedNavigationReachability(document, input.catalog);
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

function normalizeScriptFlowAiResponseRoot(root: Record<string, unknown>): Record<string, unknown> {
  if ("document" in root || root.status === "needs_clarification") return root;
  if (root.status !== undefined && root.status !== "ready") return root;
  if (!Object.keys(root).every((key) => SCRIPT_FLOW_FLATTENED_READY_RESPONSE_FIELDS.has(key))) return root;

  const document = pickFlattenedScriptFlowDocument(root);
  if (!looksLikeScriptFlowDocumentShape(document)) return root;

  return {
    status: "ready",
    ...(root.summary !== undefined ? { summary: root.summary } : {}),
    ...(root.assumptions !== undefined ? { assumptions: root.assumptions } : {}),
    ...(root.parameterValues !== undefined ? { parameterValues: root.parameterValues } : {}),
    document
  };
}

function normalizeGeneratedExplicitExecution(value: unknown, appId: string): Record<string, unknown> {
  const document = JSON.parse(JSON.stringify(recordValue(value))) as Record<string, unknown>;
  const steps = Array.isArray(document.steps) ? document.steps : [];
  stripLegacyRiskFields(steps);

  const start = recordValue(document.start);
  const strategy = stringValue(start.strategy);
  if (strategy === "keepCurrent") {
    delete document.start;
  } else if (strategy === "launchApp") {
    const first = recordValue(steps[0]);
    if (!Object.hasOwn(first, "launchApp")) {
      steps.unshift({
        id: uniqueGeneratedStepId(steps, "launch-app"),
        name: "重启 App",
        role: "setup",
        launchApp: { appId }
      });
    }
    delete document.start;
  }
  document.steps = steps;
  return document;
}

function stripLegacyRiskFields(steps: unknown[]): void {
  for (const value of steps) {
    const step = recordValue(value);
    delete step.risk;
    const repeat = recordValue(step.repeat);
    const when = recordValue(step.when);
    if (Array.isArray(repeat.steps)) stripLegacyRiskFields(repeat.steps);
    if (Array.isArray(when.steps)) stripLegacyRiskFields(when.steps);
  }
}

function uniqueGeneratedStepId(steps: unknown[], base: string): string {
  const ids = new Set(steps.map((value) => stringValue(recordValue(value).id)).filter(Boolean));
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function pickFlattenedScriptFlowDocument(root: Record<string, unknown>): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const field of SCRIPT_FLOW_DOCUMENT_RESPONSE_FIELDS) {
    if (root[field] !== undefined) document[field] = root[field];
  }
  return document;
}

function looksLikeScriptFlowDocumentShape(document: Record<string, unknown>): boolean {
  const app = recordValue(document.app);
  return document.version === 1
    && !!stringValue(document.kind)
    && !!stringValue(document.name)
    && !!stringValue(app.id)
    && Array.isArray(document.steps);
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

function normalizeGeneratedRunFlowReferences(
  value: unknown,
  catalog: ScriptFlowPlannerCatalog
): unknown {
  const document = recordValue(value);
  if (!Array.isArray(document.steps)) return value;
  return {
    ...document,
    steps: normalizeRawRunFlowSteps(document.steps, catalog, {
      entryPage: stringValue(recordValue(document.entry).page),
      outcomePage: stringValue(recordValue(document.outcome).page)
    })
  };
}

function normalizeRawRunFlowSteps(
  steps: unknown[],
  catalog: ScriptFlowPlannerCatalog,
  documentPages: { entryPage?: string; outcomePage?: string }
): unknown[] {
  return steps.map((value) => {
    const step = recordValue(value);
    const normalizedStep: Record<string, unknown> = { ...step };
    const scrollUntilVisible = recordValue(normalizedStep.scrollUntilVisible);
    if (scrollUntilVisible && typeof scrollUntilVisible.text === "string") {
      const target = recordValue(scrollUntilVisible.target);
      normalizedStep.scrollUntilVisible = {
        ...scrollUntilVisible,
        target: Object.keys(target).length ? target : { text: scrollUntilVisible.text }
      };
      delete (normalizedStep.scrollUntilVisible as Record<string, unknown>).text;
    }
    if (typeof step.runFlow === "string" && !step.runFlow.trim()) {
      if (hasRawActionOtherThanRunFlow(step)) {
        delete normalizedStep.runFlow;
      } else {
        const flowId = uniqueReusableFlowForStep(step, catalog, documentPages);
        if (flowId) normalizedStep.runFlow = flowId;
      }
    }
    const repeat = recordValue(normalizedStep.repeat);
    if (Array.isArray(repeat.steps)) {
      normalizedStep.repeat = {
        ...repeat,
        steps: normalizeRawRunFlowSteps(repeat.steps, catalog, documentPages)
      };
    }
    const when = recordValue(normalizedStep.when);
    if (Array.isArray(when.steps)) {
      normalizedStep.when = {
        ...when,
        steps: normalizeRawRunFlowSteps(when.steps, catalog, documentPages)
      };
    }
    return normalizedStep;
  });
}

function hasRawActionOtherThanRunFlow(step: Record<string, unknown>): boolean {
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "repeat", "when"]
    .some((action) => step[action] !== undefined);
}

function uniqueReusableFlowForStep(
  step: Record<string, unknown>,
  catalog: ScriptFlowPlannerCatalog,
  documentPages: { entryPage?: string; outcomePage?: string }
): string | undefined {
  const onPage = stringValue(step.onPage) ?? documentPages.entryPage;
  const targetPage = stringValue(step.expectPage) ?? documentPages.outcomePage;
  const candidates = catalog.reusableFlows.filter((flow) => {
    const entry = recordValue(flow.entry);
    const outcome = recordValue(flow.outcome);
    const entryPage = stringValue(entry.page);
    const outcomePage = stringValue(outcome.page);
    if (onPage && entryPage && onPage !== entryPage) return false;
    if (targetPage && outcomePage && targetPage !== outcomePage) return false;
    return Boolean(targetPage ? outcomePage === targetPage : entryPage === onPage);
  });
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}

function normalizeGeneratedExecutableTargets(
  document: ScriptFlowDocument,
  input: {
    prompt?: string;
    existingDocument?: ScriptFlowDocument;
    catalog: ScriptFlowPlannerCatalog;
    screenContext?: ScreenUnderstandingContext;
  }
): ScriptFlowDocument {
  const normalizedSteps = normalizeExecutableTargetSteps(document.steps, input);
  return {
    ...document,
    steps: normalizedSteps
  };
}

function normalizeExecutableTargetSteps(
  steps: ScriptStep[],
  input: {
    prompt?: string;
    existingDocument?: ScriptFlowDocument;
    catalog: ScriptFlowPlannerCatalog;
    screenContext?: ScreenUnderstandingContext;
  }
): ScriptStep[] {
  return steps.map((step) => {
    if ("repeat" in step) {
      return {
        ...step,
        repeat: {
          ...step.repeat,
          steps: normalizeExecutableTargetSteps(step.repeat.steps, input)
        }
      };
    }
    if ("when" in step) {
      return {
        ...step,
        when: {
          ...step.when,
          steps: normalizeExecutableTargetSteps(step.when.steps, input)
        }
      };
    }
    if ("tap" in step) {
      return {
        ...step,
        tap: step.tap
      };
    }
    if ("selectText" in step) {
      const target = step.selectText.target;
      return {
        ...step,
        selectText: {
          ...step.selectText,
          target,
          search: normalizeFormSearchPolicy(step.selectText.search, target, input)
        }
      };
    }
    if ("inputText" in step) {
      const target = step.inputText.target;
      return {
        ...step,
        inputText: {
          ...step.inputText,
          target,
          search: normalizeFormSearchPolicy(step.inputText.search, target, input)
        }
      };
    }
    if ("clearText" in step) {
      const target = step.clearText.target;
      return {
        ...step,
        clearText: {
          ...step.clearText,
          target,
          search: normalizeFormSearchPolicy(step.clearText.search, target, input)
        }
      };
    }
    if ("scrollUntilVisible" in step) {
      return {
        ...step,
        scrollUntilVisible: {
          ...step.scrollUntilVisible,
          target: step.scrollUntilVisible.target
        }
      };
    }
    return step;
  });
}

function normalizeFormSearchPolicy(
  search: ScriptSearchPolicy | undefined,
  target: ScriptTarget,
  input: { prompt?: string; screenContext?: ScreenUnderstandingContext }
): ScriptSearchPolicy | undefined {
  if (search?.mode !== "visibleOnly" || isVisibleOnlyGroundedForFormAction(target, input)) return search;
  return { ...search, mode: "auto" };
}

function isVisibleOnlyGroundedForFormAction(
  target: ScriptTarget,
  input: { prompt?: string; screenContext?: ScreenUnderstandingContext }
): boolean {
  if (target.area === "topBar" || target.area === "bottomBar") return true;
  if (input.prompt && /当前(?:屏幕|页面)?可见|屏幕上|顶部|顶栏|底部|底栏|弹窗|弹层|浮层|菜单/u.test(input.prompt)) {
    return true;
  }
  return Boolean(input.screenContext && screenControlCandidateMatchesTarget(target, input.screenContext));
}

function validateGeneratedReferences(
  document: ScriptFlowDocument,
  input: { appId: string; platform: PageAssetPlatform; catalog: ScriptFlowPlannerCatalog }
): void {
  if (document.app.id !== input.appId) {
    throw new Error("AI 草稿修改了指定 App");
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

function validateGeneratedActionTargetReferences(
  document: ScriptFlowDocument,
  catalog: ScriptFlowPlannerCatalog
): void {
  const pageReferences = new Set(catalog.pages.flatMap((page) => [page.id, page.key]));
  const flowReferences = new Set(catalog.reusableFlows.map((flow) => flow.id));
  for (const step of flattenSteps(document.steps)) {
    const target = operationLiteralTargetText(step);
    if (!target) continue;
    const reference = target.trim();
    if (pageReferences.has(reference) || flowReferences.has(reference) || looksLikeInternalPageReference(reference)) {
      throw new ActionTargetPageReferenceError(reference);
    }
  }
}

function validateGeneratedExecutableTargetContracts(document: ScriptFlowDocument, prompt?: string): void {
  const tapOperations = prompt
    ? extractExplicitOperationContract(prompt).filter((operation) => operation.kind === "tap")
    : [];
  const tapSteps = flattenSteps(document.steps).filter((step): step is Extract<ScriptStep, { tap: { target: ScriptTarget } }> => "tap" in step);
  tapSteps.forEach((step, index) => {
    const operationPhrase = tapOperations[index]?.phrase ?? (tapSteps.length === 1 ? prompt : undefined);
    validateTapTargetContract(step.tap.target, operationPhrase);
  });

  for (const step of flattenSteps(document.steps)) {
    const placeholderTarget = operationLiteralTargetText(step);
    if (placeholderTarget && looksLikePlaceholderExecutableTarget(placeholderTarget)) {
      throw new PlaceholderExecutableTargetError(placeholderTarget);
    }
    if ("selectText" in step && !isTextTarget(step.selectText.target)) {
      throw new UnsupportedExecutableTargetError("selectText");
    }
    if ("scrollUntilVisible" in step && !isTextTarget(step.scrollUntilVisible.target)) {
      throw new UnsupportedExecutableTargetError("scrollUntilVisible");
    }
    if ("inputText" in step && !isTextOrTextFieldTarget(step.inputText.target)) {
      throw new UnsupportedExecutableTargetError("inputText");
    }
    if ("clearText" in step && !isTextOrTextFieldTarget(step.clearText.target)) {
      throw new UnsupportedExecutableTargetError("clearText");
    }
  }
}

function validateGeneratedTextFieldScopes(
  document: ScriptFlowDocument,
  input: {
    prompt?: string;
    catalog: ScriptFlowPlannerCatalog;
    screenContext?: ScreenUnderstandingContext;
  }
): void {
  if (!hasRelativeTextFieldPrompt(input.prompt)) {
    return;
  }
  const fixedTitles = fixedPageTitleScopeTexts(input);
  if (!fixedTitles.size) {
    return;
  }
  for (const step of flattenSteps(document.steps)) {
    const target = textFieldActionTarget(step);
    const scopeText = target?.scopeText;
    if (target?.control === "textField" && scopeText && fixedTitles.has(compactGroundingText(scopeText))) {
      throw new UnstableTextFieldScopeError(scopeText);
    }
  }
}

function hasRelativeTextFieldPrompt(prompt: string | undefined): boolean {
  return Boolean(prompt
    && /输入框|文本框|输入栏|输入区/u.test(prompt)
    && /上方|上面|上边|下方|下面|下边|附近|旁边|前面|后面|最上|最下|第[一二三四五六七八九十\d]+个/u.test(prompt));
}

function fixedPageTitleScopeTexts(input: {
  catalog: ScriptFlowPlannerCatalog;
  screenContext?: ScreenUnderstandingContext;
}): Set<string> {
  return new Set([
    ...input.catalog.pages.flatMap((page) => [page.name]),
    input.screenContext?.page.name
  ].map((value) => value ? compactGroundingText(value) : "").filter(Boolean));
}

function textFieldActionTarget(step: ScriptStep): ScriptTarget | undefined {
  if ("inputText" in step) return step.inputText.target;
  if ("clearText" in step) return step.clearText.target;
  return undefined;
}

function validateTapTargetContract(target: ScriptTarget, operationPhrase: string | undefined): void {
  if (!isTextLikeTarget(target)) {
    return;
  }
  const targetDescription = target.text ?? "";
  if (hasExplicitVisualTargetCue(targetDescription) || (operationPhrase && hasExplicitVisualTargetCue(operationPhrase))) {
    throw new Error("显式视觉目标必须使用 visual 或 icon，不能生成为 text OCR 文本目标");
  }
}

function hasExplicitVisualTargetCue(value: string): boolean {
  return /图标|图片|图像|图形|视觉|符号|icon|image|picture|visual|symbol/iu.test(value);
}

function looksLikePlaceholderExecutableTarget(value: string): boolean {
  const text = value.trim();
  if (!text || /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(text)) return false;
  return /^(?:包含|带有).*(?:的)?(?:课程|班级|活动|入口|按钮|条目|记录|对象)$/u.test(text)
    || /^(?:相关|目标|对应|合适|任一|任意|某个|指定)(?:的)?(?:课程|班级|活动|入口|按钮|条目|记录|对象)$/u.test(text)
    || /(?:相关|目标|对应|合适|任一|任意|某个|指定)(?:的)?(?:入口|按钮|条目|对象)$/u.test(text);
}

function isTextLikeTarget(target: ScriptTarget): boolean {
  return Boolean(target.text && !target.icon && !target.visual && !target.control);
}

function isTextTarget(target: ScriptTarget): boolean {
  return Boolean(target.text && !target.icon && !target.visual && !target.control);
}

function isTextOrTextFieldTarget(target: ScriptTarget): boolean {
  return isTextTarget(target) || target.control === "textField";
}

function operationLiteralTargetText(step: ScriptStep): string | undefined {
  if ("tap" in step) return step.tap.target.text;
  if ("inputText" in step) return step.inputText.target.text;
  if ("clearText" in step) return step.clearText.target.text;
  if ("selectText" in step) return step.selectText.target.text;
  if ("scrollUntilVisible" in step) return step.scrollUntilVisible.target.text;
  return undefined;
}

function looksLikeInternalPageReference(value: string): boolean {
  return /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*){2,}$/i.test(value)
    || /^node_[0-9a-f-]{12,}$/i.test(value)
    || /^page[-_][a-z0-9-]+$/i.test(value)
    || /^script_flow_[0-9a-f-]{12,}$/i.test(value);
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

function screenControlCandidateMatchesTarget(
  target: ScriptTarget,
  screenContext: ScreenUnderstandingContext | undefined
): boolean {
  if (!screenContext) return false;
  return screenContext.controlCandidates.some((candidate) => {
    if (target.control && candidate.control !== target.control) return false;
    if (target.control === "textField") {
      return Boolean(target.scopeText
        && candidate.scopeText
        && compactGroundingText(target.scopeText) === compactGroundingText(candidate.scopeText)
        && target.ordinal === candidate.ordinal);
    }
    if (target.control === "switch" || target.control === "checkbox") {
      return Boolean(target.nearText
        && candidate.nearText
        && compactGroundingText(target.nearText) === compactGroundingText(candidate.nearText));
    }
    return [target.text, target.nearText, target.scopeText].some((value) => {
      if (!value) return false;
      return [candidate.nearText, candidate.scopeText, candidate.semanticName].some((candidateValue) =>
        Boolean(candidateValue && compactGroundingText(value) === compactGroundingText(candidateValue))
      );
    });
  });
}

function compactGroundingText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}$\{\}_]+/gu, "");
}

function missingPageClarification(prompt: string): string {
  const request = prompt.replace(/\s+/g, " ").trim().slice(0, 80);
  return `当前还不知道如何到达“${request}”。请补充从已知状态开始的完整操作过程，或提供目标页独有的稳定文字用于验证结果。`;
}

function actionTargetPageReferenceClarification(reference: string): string {
  return `生成结果把内部页面引用“${reference}”当成了可执行动作目标。请补充要操作的字段或按钮原文，或开启“结合当前屏幕生成”让我读取当前页面控件。`;
}

function unsupportedExecutableTargetClarification(action: string): string {
  return `生成结果里的 ${action} 目标不是当前执行器支持的可执行定位方式。请补充要操作的字段或按钮原文，或开启“结合当前屏幕生成”让我读取当前页面控件。`;
}

function placeholderExecutableTargetClarification(target: string): string {
  return `生成结果把“${target}”当成了可执行目标，但这只是占位描述，不是真实屏幕文字。请补充真实班级名、活动标题、入口文字或目标页独有稳定文字。`;
}

function unstableTextFieldScopeClarification(scopeText: string): string {
  return `“${scopeText}”像是固定页面标题，不能作为可滚动页面中输入框的稳定限定范围。请补充该输入框附近的局部字段名或区域名，或开启“结合当前屏幕生成”让我读取当前可见控件。`;
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

class ActionTargetPageReferenceError extends Error {
  constructor(readonly reference: string) {
    super(`页面引用“${reference}”不能作为动作目标`);
    this.name = "ActionTargetPageReferenceError";
  }
}

class UnsupportedExecutableTargetError extends Error {
  constructor(readonly action: string) {
    super(`${action} 使用了当前执行器不支持的目标定位方式`);
    this.name = "UnsupportedExecutableTargetError";
  }
}

class PlaceholderExecutableTargetError extends Error {
  constructor(readonly target: string) {
    super(`AI 草稿把占位描述“${target}”当成可执行目标`);
    this.name = "PlaceholderExecutableTargetError";
  }
}

class UnstableTextFieldScopeError extends Error {
  constructor(readonly scopeText: string) {
    super(`textField.scopeText “${scopeText}” is a fixed page title`);
    this.name = "UnstableTextFieldScopeError";
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
