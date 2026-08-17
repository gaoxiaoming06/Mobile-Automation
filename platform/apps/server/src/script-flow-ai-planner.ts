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
import {
  normalizeScriptFlowGenerationContext,
  type ScriptFlowGenerationContextPolicy
} from "./script-flow-generation-context.js";
import type { ScriptFlowAiTimingContext } from "./script-flow-ai-timing.js";
import { timedScriptFlowAiStage } from "./script-flow-ai-timing.js";
import { assessScriptFlowVerification } from "./script-flow-verification.js";

export const SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化 ScriptFlow 规划器，只生成可审查的脚本草稿，不操作设备。",
  "规划阶段默认不读取实时设备页面；只有用户显式开启看屏时，才能使用服务端提供的受控 screenContext。before.screenRef 和 after.screenRef 只表达显式步骤自身的页面约束。",
  "先判断测试类型：单一业务目标标记为 case；多个可独立成立的业务目标标记为 scenario。导航、登录态准备和结果验证不算额外业务目标。",
  "必须用顶层 purpose 标记测试主要目的：navigation、fixture、business 或 recovery。navigation 只到达状态，fixture 准备测试环境，business 验证业务行为，recovery 恢复可执行状态。",
  "每个步骤必须显式标记 role：setup、navigation、business、assertion、reset、cleanup 或 recovery。role 按该步骤在整个测试中的语义填写，不能仅根据动作类型猜测。",
  "新草稿使用显式步骤表达前置准备、业务操作、结果验证和每轮复位：setup 步骤属于前置准备，business 步骤属于业务操作，assertion 步骤属于结果验证，reset 步骤属于循环业务与验证时每轮结束后回到业务起点的动作。不要使用 entry、outcome 或 start 让执行器补动作。",
  "每轮复位不得自动推断。只有用户明确描述循环时每轮结束后的返回路径，才生成 role: reset 的步骤；只有用户明确说明业务执行后自然回到起点、无需复位时，才输出顶层 loop: { reset: \"none\" }；其他情况省略 loop 和 reset 步骤，交给用户在编排器确认。",
  "页面描述只负责业务上下文，不是动作定位依据。动作目标必须且只能使用 text、icon、visual 或 control：已知屏幕原文用 text；文本语义匹配使用 text + match: semantic；搜索/返回/分享/更多/加号等常见标准视觉符号用 icon；无法确定为标准 icon role、但用户明确说图标、图片、图形、视觉符号或 icon/image 时必须使用 visual；通用表单控件用 control。禁止生成 semantic 目标字段。",
  "页面 key、页面 id、ScriptFlow id 和类似 classin.teacher.xxx 的内部引用不能作为 tap、inputText、clearText、selectText 或 scrollUntilVisible 的动作目标。",
  "text 必须是用户原文、页面目录名称或现有用例中已有的字面标签，禁止擅自增加‘创建、进入、打开、发布’等词。需要表达‘进入教学方案的入口’这类文本语义目标时，使用 text + match: semantic，不能伪装成屏幕原文。",
  "text 目标必须显式区分 exact/contains 语义：默认或省略 match 等价于 match: exact，运行时语义是 equals；执行器会严格按脚本 match 执行，equals 不会自动退化为 contains。可点击 text 目标默认按完整控件文字匹配：按钮、Tab、菜单项、卡片标题、班级名、昵称、编号和 ${parameterName} 这类参数化名称不要写 match: contains；用户明确表达‘包含、带有、关键字、模糊匹配’，或受控 screenContext/读屏证据显示实际控件原文包含目标基础词但额外带动态数量、状态、后缀或前缀时，才可写 match: contains，且必须尽量补充 area、nearText、scopeText、ordinal 或容器语义。",
  "text、icon、visual 和 control 都不要求先创建元素资产。内容可能在屏幕外时配置 search: { mode: auto }；弹层菜单、顶栏和底栏使用 search: { mode: visibleOnly }。",
  "完整当前页控件动作是指用户已经给出字段/控件名以及要执行的状态或输入值，且没有明确要求进入、前往或到达某个页面。此时必须生成基于当前页面的直接动作，不要补 entry、outcome、before、after、reachPage 或 runFlow，也不要把页面目录当成动作前置条件。",
  "表单字段动作默认使用 search: { mode: auto }。只有用户明确说当前可见、顶部、底部、弹窗/菜单，或受控 screenContext 明确给出当前可见候选时，才使用 visibleOnly。",
  "用户说通过滑动、滚动、查找、找到、定位或搜索某字段/条目/控件时，这是目标动作的运行时查找策略，不是独立 swipe 步骤；即使 screenContext 当前首屏没有该字段，也应生成该字段的直接动作并使用 search: { mode: auto }，不能因此追问。",
  "不要把“修改、设置、输入、打开、关闭、选择”等用户操作动词当成按钮文字。用户没有明确说点击某个入口时，禁止擅自补“点击修改”或其他桥接动作；只有当前屏幕没有证实目标字段、且用户也没有提供字段文字或可执行查找策略时，才返回 needs_clarification 询问准确字段位置或完整操作路径。",
  "text 目标默认不要猜测 topBar/bottomBar。只有用户明确说顶部、底部、左上角、右上角等位置，或目录中的已验证导航入口/原用例已经给出同一目标位置时，才可增加窄区域约束；否则省略 area，让执行器在当前屏幕查找。",
  "发布、提交、删除、支付等操作按钮可能位于顶部、内容区或底部；用户或已验证知识未提供位置时必须省略 area，禁止根据动作名称猜测区域。",
  "icon 和 visual 都是非 OCR 视觉目标；非 OCR 视觉目标必须尽量补全跨平台限定：area、position、vertical、nearText、scopeText 或 ordinal。position 只表达左右：leading/trailing；vertical 表达上下：top/center/bottom。用户明确说顶部、底部、左上角、右上角、左下角、右下角、左侧、右侧或某段文字附近时必须写入对应限定；用户未提供任何限定且标准视觉 role 足够明确时才可省略。内容区悬浮新增按钮使用 { icon: add, area: content, position: trailing, vertical: bottom }；不要把自定义产品图形臆测成标准图标。",
  "visual 用于无法归入标准 icon role、但用户明确描述为视觉目标的对象。visual 必须保留用户原始视觉描述作为 query，并按用户描述补充 kind、area、position、vertical、nearText、scopeText 或 ordinal。执行器如果缺少视觉 grounding 能力会明确失败，planner 不得改写成 text。",
  "用户明确说‘点击左上角返回按钮/返回图标’时，必须生成 { icon: back, area: topBar, position: leading } 的 tap；右上角分享按钮生成 { icon: share, area: topBar, position: trailing }。这是视觉点击，不得改写为页面恢复、reachPage 或重启。",
  "control 当前只支持 checkbox、switch 和 textField。checkbox 必须描述 area: content 和 nearText；switch 必须描述 area: content、nearText 和 checked，checked=true 表示打开/开启，checked=false 表示关闭；textField 必须描述 area: content。用户明确说第一个输入框、最顶部第一个输入框或第 N 个输入框时，使用 control: textField + ordinal，不要捏造 scopeText；scopeText+ordinal 用于某局部区域内第几个输入框；anchorText+relation 用于某稳定字段文字上方/下方/左侧/右侧最近的输入框，relation 可用 above、below、leftOf、rightOf，表示目标输入框相对 anchorText 的位置；登录账号或密码这类没有稳定外显字段标签的输入框必须使用 control: textField，不能用占位符 OCR 文本作为 target.text。",
  "inputText 和 clearText 会自行定位、点击并聚焦输入框；用户说选中/点击某输入框再输入或清空时，生成一个 inputText/clearText 步骤即可，不要额外生成前置 tap 输入框步骤。",
  "消息输入区、键盘工具栏、表情面板或更多/附件面板里的图标按钮当前使用 icon + area: content，并按用户描述补 position、vertical、nearText、scopeText 或 ordinal；例如表情图标用 icon: emoji，语音/麦克风图标用 icon: mic，加号图标用 icon: add，上箭头发送图标用 icon: arrowUp。不要生成 scope、role、selection、iconButton、submitButton 或 collectionItem。",
  "textField 的 scopeText 或 anchorText 必须是局部表单区域标题、字段组标题、字段标签或控件附近稳定文字，不能使用页面标题、顶栏固定标题、App 名称等全局固定文字。用户只用“某页面标题上方/下方/左侧/右侧”定位时应返回 needs_clarification，请其补充局部字段名或开启当前屏幕辅助；用户只说第几个输入框时使用 ordinal-only textField。",
  "执行器能力合同：visual 仅支持 tap；selectText 和 scrollUntilVisible 必须使用 text；inputText 和 clearText 必须使用 text 或 control: textField。",
  "一个 tap 只执行一次点击。即使目标标签像流程描述，也不得把一次点击解释成打开菜单后继续选择；用户过程包含几次点击就生成几个步骤。",
  "用户明确操作是硬约束：点击、输入、清空、滑动或启动等操作必须按用户描述的顺序保留，不能被 reachPage、runFlow、已有资产或更短路径替代。用户明确要求启动时生成唯一一个 role: setup 的 launchApp；没有要求启动时不要添加。",
  "ScriptFlow 的 launchApp 表示保留应用数据，先终止应用进程再重新启动；步骤名称应写为‘重启 App’，不能把它描述成仅切回前台。",
  "用户明确要求某个动作完成后停留、暂停、等待固定时间再继续时，生成独立 wait 步骤，使用 wait.durationMs 表达固定毫秒数。wait 只表示固定延时，不等待页面、文字或控件状态。",
  "用户描述打开选择器、滑动到具体选中值并确认时，必须把这组机械操作规范化为一个 selectText：target 保留字段入口，value 完整保留用户指定值，confirmText 保留确认文字。selectText 自身会点击并打开字段，由执行器动态查找选项；禁止保留前置 tap，也禁止猜测固定滑动次数。",
  "用户只表达进入、打开、前往或回到某页面时，这是业务目标，不是运行时导航命令。优先从用例中心匹配完整业务路径并生成 runFlow；没有匹配的完整路径时返回 needs_clarification，请用户补充从当前状态开始的操作链。不要因为页面名称、页面资产或‘回到’推断点击、返回或重启。",
  "用例中心中的 active ScriptFlow 是唯一可复用的业务路径知识。目标型请求不要生成 reachPage，也不要读取 navigationEntries、页面目录或导航索引。",
  "只有用户明确描述点击、返回、重启等过程时才生成对应过程；不要依赖页面资产或导航索引猜测未知点击路径。",
  "只有用户明确写出某动作完成后会进入、到达、打开或跳转到哪个页面时，才把该目标页写在该动作的 after.screenRef；不要再紧跟一个独立 assertPage。assertPage 只用于用户明确要求单独验证当前页面的场景。",
  "页面名称或业务页面描述可以直接保留为语义上下文，不要求先录入页面资产。用户提供明确操作或完整操作链时必须先生成可试运行的直接动作；有独有稳定文字时用最终 assertText 验证，没有稳定文字时省略未知页面约束和结果断言，由系统标记为结果待确认，不能因此返回 needs_clarification。",
  "只能引用 active ScriptFlow id；禁止元素资产 ID、坐标、bounds、region_center、圈选区域或固定屏幕区域点击。",
  "用户只说到达一个页面、又没有提供操作路径时返回 needs_clarification，请用户补充从当前状态开始的完整点击过程或目标页独有稳定文字。不要要求用户先录制资产。",
  "目标型请求命中用例中心的完整业务路径时生成 runFlow；过程型请求按用户描述保留每个动作，不擅自扩展成创建、发布、提交或删除。没有完整可复用路径时返回 needs_clarification；用户明确描述具体操作过程时则保留该过程。",
  "runFlow 只复用子用例的业务步骤与结果验证，不继承子用例的前置准备和每轮复位。引用用于登录或环境准备时标记 role: setup，引用作为被测流程时标记 role: business，作为结果验证时标记 role: assertion，作为每轮复位时标记 role: reset；父测试必须显式维护自己的启动、环境准备和复位步骤。",
  "动态业务值必须声明为 parameters 并在步骤中使用 ${parameterName}。用户已给出的值放入顶层 parameterValues，仅用于本次运行；未给出但执行必需的值设 required: true。字段标签、按钮、Tab、菜单项和固定入口文案不是参数；输入值、选中值、搜索词以及班级、老师、学生、课程、文件、群、日期、时间、数量等业务实体才是参数。",
  "账号、密码等 sensitive 参数禁止写入 parameters.default、summary 或 assumptions，必须只放入顶层 parameterValues。",
  "runFlow 会自动继承父测试中的同名参数；规划器会把复用用例所需参数汇总到运行配置。",
  "常用参数直接展示；低频可选参数标记 advanced: true。枚举只有在输入目录给出合法选项时才能使用 select/options。",
  "执行器严格按照脚本中的显式命令执行，不推测前置页面，不插入返回、重启、页面恢复或结果断言。",
  "status 为 ready 时必须包含 document、summary、assumptions 和 parameterValues；status 为 needs_clarification 时只允许返回 status 和 clarification，不能同时返回 document 或草稿字段。",
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

const EMPTY_GENERATION_PAGE_CATALOG: PageAssetCatalog = {
  listPages: () => [],
  getPage: () => undefined,
  resolvePage: () => undefined,
  findConfusablePages: () => []
};

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
  generationContext?: ScriptFlowGenerationContextPolicy;
  timingContext?: ScriptFlowAiTimingContext;
  fetchImpl?: AiClientFetch;
}): Promise<ScriptFlowAiDraft> {
  if (!input.config.enabled) {
    throw new Error(input.config.reason === "missing_config" ? "AI 配置不完整" : "AI 生成未启用");
  }
  const generationContext = normalizeScriptFlowGenerationContext(input.generationContext, {
    hasScreenAssist: Boolean(input.screenContext)
  });
  const pageCatalog = EMPTY_GENERATION_PAGE_CATALOG;
  const reusableFlows = generationContext.useCaseKnowledge ? input.flows : [];
  const navigationEntries: NavigationEntry[] = [];
  const matchedDraft = input.existingFlow || !generationContext.useCaseKnowledge
    ? undefined
    : findMatchingDraftFlow(input.prompt, reusableFlows, pageCatalog, input.appId, input.platform);
  const existingFlow = input.existingFlow ?? matchedDraft;
  const catalog = buildScriptFlowPlannerCatalog(
    pageCatalog,
    existingFlow ? reusableFlows.filter((flow) => flow.id !== existingFlow.id) : reusableFlows,
    input.appId,
    input.platform,
    navigationEntries
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
  const plannerPrompt = buildScriptFlowPlannerPrompt(
    input.prompt,
    input.appId,
    input.platform,
    catalog,
    existingDocument,
    input.screenContext,
    input.externalContext,
    generationContext
  );
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
      if (repairError instanceof GeneratedReachPageError) {
        return {
          status: "needs_clarification",
          clarification: generatedReachPageClarification(input.prompt, repairError.screenRef),
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
  parsed = await reviewAndRepairTargetGrounding({
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
  void learnedNavigationEntries;
  const navigationEntries: NavigationEntry[] = [];
  const transitions = [
    ...flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .flatMap((flow) => transitionEntries(flow))
  ];
  const navigationAnchors = reusableFlows.flatMap((flow) => {
    const page = stringValue(flow.entry?.screenRef);
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
  externalContext?: ScriptFlowExternalContext,
  generationContext: ScriptFlowGenerationContextPolicy = normalizeScriptFlowGenerationContext(undefined, {
    hasScreenAssist: Boolean(screenContext)
  })
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
    "可用动作：launchApp、tap、inputText、clearText、selectText、swipe、wait、scrollUntilVisible、waitForPage、assertPage、assertText、runFlow、repeat、when。",
    `系统判定的 testLevel：${systemTestLevel}。document.testLevel 必须保持这个值，不能由模型自行改成其它层级。`,
    "testLevel 含义：probe=临时验证单点问题，component=字段/控件能力用例，business_smoke=最小业务主链路，full_regression=全字段或全配置回归。",
    "full_regression 不允许凭页面名称自动枚举字段。用户未列出全部字段时，先根据已有上下文生成可编辑草稿，并在 assumptions 中说明当前覆盖范围；不要仅因此返回 needs_clarification。",
    generationContext.mode === "knowledge_enhanced"
      ? "生成上下文模式：knowledge_enhanced。可以参考用例中心中的业务路径和参数契约，并优先输出 runFlow 复用完整子用例；不得读取或生成 PageAsset、InteractionAsset、页面导航索引或平台控件标识。"
      : "生成上下文模式：strict。不要使用沉淀资产、历史脚本、页面目录或导航知识；只按照用户当前描述和显式开启的当前屏幕上下文生成。用户没有明确页面前置或页面结果时，不要生成 entry、outcome、before 或 after。",
    "每个 steps 项必须包含非空 id 和显式 role，并把动作名直接作为字段；每步只能有一个动作字段。不要输出 action 或 page 字段。",
    "步骤字段合同：步骤 id 使用稳定英文短横线命名；role 只能使用 setup、navigation、business、assertion、reset、cleanup 或 recovery；动作字段只能从可用动作列表中选择一个；页面字段不是动作字段，不能用 page/action 包装动作。",
    "target 必须且只能使用 text、icon、visual 或 control。text 是可在屏幕上按字面读取的原文，必须能追溯到用户输入或已知目录；文本语义匹配使用 text + match: semantic；搜索/返回/分享/更多/加号/表情/麦克风/上箭头等常见标准视觉符号用 icon；无法确定为标准 icon role、但用户明确说图标、图片、图形、视觉符号或 icon/image 时必须使用 visual，不能改写成 text。非 OCR 视觉目标必须尽量补全跨平台限定：area、position、vertical、nearText、scopeText 或 ordinal；position 只表达左右：leading/trailing；vertical 表达上下：top/center/bottom。用户明确说顶部、底部、左上角、右上角、左下角、右下角、左侧、右侧或某段文字附近时必须写入对应限定。control 支持 checkbox、switch 和 textField：checkbox 必须带 area: content 和 nearText；switch 必须带 area: content、nearText 和 checked；textField 必须带 area: content，并使用 ordinal、scopeText+ordinal 或 anchorText+relation；用户明确说第一个输入框、最顶部第一个输入框或第 N 个输入框时，使用 control: textField + ordinal，不要捏造 scopeText；登录账号或密码这类没有稳定外显字段标签的输入框必须使用 control: textField，不能用占位符 OCR 文本作为 target.text；禁止元素资产 ID、坐标、区域和临时视觉模板，也禁止 semantic 目标字段。",
    "消息输入区、键盘工具栏、表情面板或更多/附件面板里的图标按钮当前使用 icon + area: content，并按用户描述补 position、vertical、nearText、scopeText 或 ordinal；例如表情图标用 icon: emoji，语音/麦克风图标用 icon: mic，加号图标用 icon: add，上箭头发送图标用 icon: arrowUp。不要生成 scope、role、selection、iconButton、submitButton 或 collectionItem。",
    "textField.ordinal 用于页面内容中的第几个输入框，特别是用户只说第一个输入框、最顶部第一个输入框或第 N 个输入框时；textField.scopeText+ordinal 用于某局部区域内第几个输入框；textField.anchorText+relation 用于某稳定字段文字上方/下方/左侧/右侧最近的输入框，relation 可用 above、below、leftOf、rightOf，表示目标输入框相对 anchorText 的位置。相对锚点文字必须写入 anchorText，不能降级成 target.text；scopeText 或 anchorText 不能使用页面标题、顶栏固定标题、App 名称等全局固定文字；用户只用“某页面标题上方/下方/左侧/右侧”定位时返回 needs_clarification，要求补充局部字段名或开启当前屏幕辅助。",
    "text 目标必须显式区分 exact/contains 语义：默认或省略 match 等价于 match: exact，运行时语义是 equals；执行器会严格按脚本 match 执行，equals 不会自动退化为 contains。可点击 text 默认按完整控件文字匹配，按钮、Tab、菜单项、卡片标题、班级名、昵称、编号和参数化名称不要写 match: contains。使用 screenContext 或读屏证据时，根据当前可见原文选择 match：实际原文与目标完全一致时用 exact/省略 match；screenContext 原文是“确定(1/6)”而用户只说“确定”时，必须生成 target: { text: \"确定\", match: \"contains\" }；类似“完成 2/6”“保存(已选3项)”这类动态数量或状态后缀也用 contains，并尽量补充 area、nearText、scopeText、ordinal 或容器语义。未启用当前屏幕上下文时，根据自然语言语义选择 match：用户明确表达‘包含、带有、关键字、模糊匹配’或明显只给动态状态控件的基础动作词时，才写 match: contains。",
    screenContext
      ? [
          "当前屏幕理解上下文由用户显式开启看屏后生成。它只能帮助理解用户对当前页面的描述，不能覆盖已验证资产。",
          "如果用户说当前页面、当前屏幕、最上面、第一个输入框，可以优先使用 screenContext.controlCandidates 中的受控候选。",
          "screenContext 中 valueKind=dynamicValue 的内容只是当前值，不能写成 target.text、字段名、资产名或默认值。",
          "使用 textField 候选时，用户说第一个输入框、最顶部第一个输入框或第 N 个输入框，优先生成 target: { control: \"textField\", area: \"content\", ordinal }；如果候选包含可靠局部 scopeText 且用户也说了该区域，生成 target: { control: \"textField\", area: \"content\", scopeText, ordinal }；如果用户明确说某稳定文字上方/下方/左侧/右侧输入框，生成 target: { control: \"textField\", area: \"content\", anchorText, relation }。使用 switch 候选时，根据用户说打开/关闭生成 target: { control: \"switch\", area: \"content\", nearText, checked }。",
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
    "用户已经给出字段/控件名以及状态或输入值、且没有明确要求页面导航时，这是完整当前页控件动作。必须只生成直接动作，省略 entry、outcome、before、after、reachPage、runFlow、waitForPage 和 assertPage；如果字段标签不确定或开关缺少开启/关闭状态，再返回 needs_clarification。",
    "表单字段动作默认使用 search: { mode: auto }，避免当前屏幕滚动位置变化后找错控件。只有用户明确说当前可见、顶部、底部、弹窗/菜单，或使用 screenContext 中明确可见的受控候选时，才使用 visibleOnly。",
    "用户说通过滑动、滚动、查找、找到、定位或搜索某字段/条目/控件时，这是目标动作的运行时查找策略，不是独立 swipe 步骤；即使 screenContext 当前首屏没有该字段，也应生成该字段的直接动作并使用 search: { mode: auto }，不能因此追问。",
    "不要把“修改、设置、输入、打开、关闭、选择”等用户操作动词当成按钮文字。用户没有明确点击某个入口时，不得补充“点击修改”等桥接步骤；只有当前屏幕没有证实目标字段、且用户也没有提供字段文字或可执行查找策略时，才返回 needs_clarification。",
    "用户为选择器给出具体选中值时，把“点击字段、滑动选择该值、点击确定/完成”合并为一个 selectText，value 必须精确保留，confirmText 使用用户说出的确认文字；selectText 自身会打开字段，前面禁止再生成 tap，也禁止生成固定次数 swipe 来猜选项位置。",
    "只表达目标页面时，优先输出 runFlow 复用用例中心中的完整业务路径；没有完整可复用路径时返回 needs_clarification，请用户补充从当前状态开始的完整操作路径或目标页独有稳定文字。不要因为页面名称、页面资产、导航索引或“回到”推断点击、返回、重启或 reachPage。",
    "不要输出 risk 字段。用户点击执行即表示授权运行当前可见脚本，系统不根据按钮文案推断业务风险。",
    "直接理解用户的完整意图和操作顺序，不依赖服务端预先拆出的中文动作契约。用户明确描述的过程应逐步保留；只描述目标时只能复用用例中心的完整 runFlow，否则追问完整路径。",
    "明确操作即使缺少当前页面 key、目标页面资产或自动结果判据，也应返回 ready 并生成可试运行动作；省略无法确定的 before、after、outcome 和断言，系统会将结果标记为待确认。只有缺少班级名、账号、输入值等实际执行参数时才能返回 needs_clarification。",
    existingDocument ? "修改现有用例：" : "输入：",
    JSON.stringify({ prompt, appId, generationContext, ...(existingDocument ? { existingDocument } : {}), catalog }, null, 2)
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
    "修复校验错误时必须保持 target 的类别：上一稿中 text、icon、visual、control 的选择是语义合同，不能为了绕过 schema 错误互相改写；icon/visual 非 OCR 目标不能改成 text。若某个字段不合法，只能在同一 target 类别内删除、改名或改用合法限定字段。",
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
type ScriptFlowTargetGroundingReview = ScriptFlowReviewAssessment;
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

async function reviewAndRepairTargetGrounding(input: {
  parsed: ReadyParsedScriptFlowAiDraft;
  plannerPrompt: string;
  requestConfig: { baseURL: string; apiKey?: string; model: string; timeoutMs: number };
  parseInput: Parameters<typeof parseScriptFlowAiResponse>[1];
  fetchImpl: AiClientFetch;
  channel: "codex" | "openai-compatible";
  model: string;
  timingContext?: ScriptFlowAiTimingContext;
}): Promise<ReadyParsedScriptFlowAiDraft> {
  if (!hasEditableTextTargets(input.parsed.document)) return input.parsed;
  const review = await timedScriptFlowAiStage(input.timingContext, "target_grounding_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowTargetGroundingReviewPrompt(input.parseInput.prompt ?? "", input.parsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const assessment = parseScriptFlowTargetGroundingReview(review.content);
  if (assessment.status === "ok") return input.parsed;

  const repaired = await timedScriptFlowAiStage(input.timingContext, "target_grounding_repair_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowTargetGroundingRepairPrompt(input.plannerPrompt, input.parsed, assessment),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedParsed = parseScriptFlowAiResponse(repaired.content, input.parseInput);
  if (repairedParsed.status === "needs_clarification") {
    throw new Error(`target grounding repair 返回了追问信息：${repairedParsed.clarification}`);
  }
  const repairedReview = await timedScriptFlowAiStage(input.timingContext, "target_grounding_review_request", () => runAiJsonRequest(input.requestConfig, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowTargetGroundingReviewPrompt(input.parseInput.prompt ?? "", repairedParsed),
    effort: "low"
  }, input.fetchImpl), { channel: input.channel, model: input.model });
  const repairedAssessment = parseScriptFlowTargetGroundingReview(repairedReview.content);
  if (repairedAssessment.status === "needs_repair") {
    throw new Error(`AI 修复后仍未通过目标 grounding review：${repairedAssessment.summary}`);
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
  if (assessment.status === "ok") {
    return input.parsed;
  }

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
  parsed: Pick<ScriptFlowAiGeneratedDraft, "document" | "parameterValues">
): string {
  return [
    "请对下面 ScriptFlow 草稿做参数化 review。",
    "目标：判断用户原始描述中的运行时业务值是否被错误硬编码在脚本里。你需要理解自然语言和业务语义，不要依赖固定词表，也不要因为脚本合法就直接通过。",
    "审查范围只包括 document.parameters、document.steps 中会影响执行的字段，以及 parameterValues 是否承载用户本次给出的运行值。",
    "不要审查 document.name、description、summary、assumptions、tags、app、purpose、testLevel 或参数 label 等展示元数据；这些可读文案可以包含用户原文，不算执行硬编码。",
    "应该参数化：inputText.value、selectText.value、搜索词、账号、密码、课堂名、班级名、老师名、学生名、课程名、文件名、群名、日期、时间、数量，以及用户要选择的具体业务实体。tap.target.text 如果是用户要选中的具体业务对象，也应该参数化。",
    "不应该参数化：固定 UI 控件、按钮、Tab、菜单项、字段标签、页面入口、确认/取消/发布/创建/课堂信息/联席教师等产品文案。字段标签本身不是参数，字段的值才是参数；开关名通常不是参数，除非用户明确要求开关状态运行时可变。wait.durationMs 是固定执行延时，用户说停留或等待 n 秒/分钟时必须保留为正整数毫秒，不能改成参数、字符串或 parameterValues。",
    "如果发现执行字段里硬编码业务值，返回 needs_repair 并给出可操作的 repairInstructions；修复时必须在 document.parameters 声明参数，脚本中改用 ${parameterName}，用户本次给出的值放入顶层 parameterValues。sensitive 参数不得写入 default、summary 或 assumptions。",
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
    "草稿 parameterValues：",
    JSON.stringify(parsed.parameterValues, null, 2),
    "草稿执行相关字段：",
    JSON.stringify({
      parameters: parsed.document.parameters,
      steps: parsed.document.steps
    }, null, 2)
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
    "修复要求：在 document.parameters 中声明缺失参数；步骤中用 ${parameterName} 引用；用户本次已经给出的值放入顶层 parameterValues；固定 UI 文案继续保留字面量；wait.durationMs 必须保持正整数毫秒，不能参数化；不要因为 name、description、summary、assumptions、tags 或参数 label 等展示元数据包含业务值而修改脚本；sensitive 参数不要写 default、summary 或 assumptions。",
    "review 结果：",
    JSON.stringify(review, null, 2),
    "上一稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function buildScriptFlowTargetGroundingReviewPrompt(
  prompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml" | "summary" | "assumptions">
): string {
  return [
    "请对下面 ScriptFlow 草稿做目标 grounding review。",
    "目标：判断 inputText/clearText 这类可编辑文本动作的 target 是否准确表达了用户真正要操作的输入控件，而不是把用户描述中的参照物、字段组、页面标题、附近文字、相对位置锚点或范围说明误写成可操作目标。",
    "你需要直接理解自然语言里的语义角色，先区分“动作对象”和“定位线索”。不要依赖固定词表，也不要因为脚本结构合法就直接通过。",
    "如果用户是在某个稳定字段标签本身中输入，target.text 可以保留该字段标签；如果用户描述的是某文字附近、上方、下方、左侧、右侧、同一行、某区域内第几个等空间/范围关系，那个文字通常是 anchorText 或 scopeText，真正 target 应该是 control:textField。",
    "对于页面内容第几个输入框，修复为 target: { control: \"textField\", area: \"content\", ordinal }；对于相对位置输入框，修复为 target: { control: \"textField\", area: \"content\", anchorText, relation }，relation 只能是 above、below、leftOf、rightOf；对于局部区域内第几个输入框，修复为 target: { control: \"textField\", area: \"content\", scopeText, ordinal }。",
    "不要新增坐标、bounds、resourceId、accessibilityId、candidateId 或平台私有 selector；不要改变用户给出的输入值、参数化、步骤顺序或非目标语义。",
    "如果目标和锚点已经区分合理，返回 ok；如果混淆，返回 needs_repair 并给出可操作的 repairInstructions。",
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

function buildScriptFlowTargetGroundingRepairPrompt(
  plannerPrompt: string,
  parsed: Pick<ScriptFlowAiGeneratedDraft, "sourceYaml">,
  review: ScriptFlowTargetGroundingReview
): string {
  return [
    plannerPrompt,
    "上一稿未通过目标 grounding review。请只根据 review 指令修复 inputText/clearText 的目标定位，重点区分用户描述中的动作对象、字段标签、局部范围和相对锚点。",
    "修复要求：必要时把误用的 target.text 改成 control:textField + ordinal、scopeText/ordinal 或 anchorText/relation；保留输入值、参数名、步骤顺序、页面约束和 search 策略；不要引入坐标、resourceId、accessibilityId、candidateId 或平台私有 selector。",
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
    "ScriptFlow 位置合同：position 只表达左右 leading/trailing；vertical 表达上下 top/center/bottom。右下角/左下角的标准悬浮 icon 应表达为 area: content + position: trailing/leading + vertical: bottom。",
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
    "修复时必须保持 target 的类别；icon/visual 非 OCR 目标不能改成 text。只能补充或调整 area、position、vertical、nearText、scopeText、ordinal、visual.query 等跨平台限定。",
    "ScriptFlow 位置合同：position 只表达左右 leading/trailing；vertical 表达上下 top/center/bottom。右下角/左下角标准悬浮 icon 应表达为 area: content + position: trailing/leading + vertical: bottom。",
    "review 结果：",
    JSON.stringify(review, null, 2),
    "上一稿 YAML：",
    parsed.sourceYaml
  ].join("\n\n");
}

function parseScriptFlowGroundingReview(raw: string): ScriptFlowGroundingReview {
  return parseScriptFlowReviewAssessment(raw, "grounding review");
}

function parseScriptFlowTargetGroundingReview(raw: string): ScriptFlowTargetGroundingReview {
  return parseScriptFlowReviewAssessment(raw, "目标 grounding review");
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

function hasEditableTextTargets(document: ScriptFlowDocument): boolean {
  return flattenSteps(document.steps).some((step) => {
    const target = textFieldActionTarget(step);
    return Boolean(target?.text && !target.control);
  });
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
  const root = normalizeScriptFlowAiResponseRoot(recordValue(value), input);
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
  const generatedDocument = normalizeGeneratedParameterDefinitions(
    normalizeGeneratedTargetPositionAliases(normalizeGeneratedExplicitExecution(
      normalizeGeneratedWaitDurations(normalizeGeneratedRunFlowReferences(root.document, input.catalog), root.parameterValues),
      input.appId
    )),
    root.parameterValues
  );
  const validated = validateScriptFlowDocument(generatedDocument);
  validateNoGeneratedReachPage(validated);
  const hydrated = validateScriptFlowDocument(hydrateGeneratedParameters(validated, input.catalog));
  const { document: extractedDocument, parameterValues } = extractEphemeralParameterValues(hydrated, root.parameterValues);
  const pageConstrained = validateScriptFlowDocument(normalizeGeneratedPageConstraints(extractedDocument, input));
  const document = validateScriptFlowDocument(normalizeGeneratedExecutableTargets(pageConstrained, input));
  validateGeneratedReferences(document, input);
  validateGeneratedActionTargetReferences(document, input.catalog);
  validateGeneratedExecutableTargetContracts(document, input.prompt);
  validateGeneratedTextFieldScopes(document, input);
  validateNoGeneratedReachPage(document);
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

function normalizeScriptFlowAiResponseRoot(
  root: Record<string, unknown>,
  input: { appId: string; prompt?: string }
): Record<string, unknown> {
  if (root.status === "needs_clarification" && looksLikeContradictoryReadyResponse(root)) {
    return {
      status: "ready",
      ...(root.summary !== undefined ? { summary: root.summary } : {}),
      ...(root.assumptions !== undefined ? { assumptions: root.assumptions } : {}),
      ...(root.parameterValues !== undefined ? { parameterValues: root.parameterValues } : {}),
      document: root.document
    };
  }
  if ("document" in root || root.status === "needs_clarification") return root;
  if (root.status !== undefined && root.status !== "ready") return root;
  if (!Object.keys(root).every((key) => SCRIPT_FLOW_FLATTENED_READY_RESPONSE_FIELDS.has(key))) return root;

  const document = withFlattenedScriptFlowDocumentDefaults(pickFlattenedScriptFlowDocument(root), root, input);
  if (!looksLikeScriptFlowDocumentShape(document)) return root;

  return {
    status: "ready",
    ...(root.summary !== undefined ? { summary: root.summary } : {}),
    ...(root.assumptions !== undefined ? { assumptions: root.assumptions } : {}),
    ...(root.parameterValues !== undefined ? { parameterValues: root.parameterValues } : {}),
    document
  };
}

function looksLikeContradictoryReadyResponse(root: Record<string, unknown>): boolean {
  if (!Object.keys(root).every((key) => SCRIPT_FLOW_READY_RESPONSE_FIELDS.includes(key) || key === "clarification")) {
    return false;
  }
  return looksLikeScriptFlowDocumentShape(recordValue(root.document));
}

function withFlattenedScriptFlowDocumentDefaults(
  document: Record<string, unknown>,
  root: Record<string, unknown>,
  input: { appId: string; prompt?: string }
): Record<string, unknown> {
  if (!Array.isArray(document.steps)) return document;
  const summary = stringValue(root.summary);
  const prompt = input.prompt?.trim();
  return {
    version: document.version ?? 1,
    kind: document.kind ?? "case",
    purpose: document.purpose ?? flattenedDocumentPurpose(document.steps),
    testLevel: document.testLevel ?? (prompt ? classifyScriptFlowTestLevel(prompt) : "business_smoke"),
    name: document.name ?? summary ?? prompt ?? "AI 生成测试",
    app: document.app ?? { id: input.appId },
    parameters: document.parameters ?? {},
    tags: document.tags ?? ["ai-generated"],
    ...document
  };
}

function flattenedDocumentPurpose(steps: unknown[]): ScriptFlowDocument["purpose"] {
  const records = flattenRecords(steps);
  if (records.length && records.every((step) => stringValue(step.role) === "navigation" || Object.hasOwn(step, "reachPage"))) {
    return "navigation";
  }
  if (records.length && records.every((step) => stringValue(step.role) === "setup" || stringValue(step.role) === "recovery")) {
    return "fixture";
  }
  return "business";
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

function normalizeGeneratedTargetPositionAliases(value: unknown): Record<string, unknown> {
  return normalizeGeneratedTargetPlacementAliasesInValue(recordValue(value)) as Record<string, unknown>;
}

function normalizeGeneratedParameterDefinitions(value: unknown, generatedValues: unknown): Record<string, unknown> {
  const document = JSON.parse(JSON.stringify(recordValue(value))) as Record<string, unknown>;
  const parameters = recordValue(document.parameters);
  if (!Object.keys(parameters).length) {
    return document;
  }
  const runtimeValues = recordValue(generatedValues);
  const normalizedParameters: Record<string, unknown> = {};
  for (const [key, rawDefinition] of Object.entries(parameters)) {
    if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
      normalizedParameters[key] = rawDefinition;
      continue;
    }
    const definition = { ...rawDefinition } as Record<string, unknown>;
    if (!stringValue(definition.type)) {
      definition.type = inferredGeneratedParameterType(runtimeValues[key]) ?? "string";
    }
    normalizedParameters[key] = definition;
  }
  return { ...document, parameters: normalizedParameters };
}

function inferredGeneratedParameterType(value: unknown): "string" | "number" | "boolean" | undefined {
  if (typeof value === "string" && value.trim()) return "string";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function normalizeGeneratedTargetPlacementAliasesInValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeGeneratedTargetPlacementAliasesInValue(item));
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      normalizeGeneratedTargetPlacementAliasesInValue(child)
    ])
  );
  const placement = generatedTargetPlacementAlias(normalized.position);
  if (placement?.position) normalized.position = placement.position;
  else if (placement?.vertical) delete normalized.position;
  if (placement?.vertical && normalized.vertical === undefined) normalized.vertical = placement.vertical;
  const vertical = generatedTargetVerticalAlias(normalized.vertical);
  if (vertical) normalized.vertical = vertical;
  return normalized;
}

function generatedTargetPlacementAlias(value: unknown): { position?: "leading" | "trailing"; vertical?: "top" | "center" | "bottom" } | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const position = generatedTargetPositionAlias(text);
  const vertical = generatedTargetVerticalAlias(text);
  if (!position && !vertical) return undefined;
  return {
    ...(position ? { position } : {}),
    ...(vertical ? { vertical } : {})
  };
}

function generatedTargetPositionAlias(value: unknown): "leading" | "trailing" | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  if (text === "leading" || text === "trailing") return text;
  const compact = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact.includes("右") || compact.includes("后")) return "trailing";
  if (compact.includes("左") || compact.includes("前")) return "leading";
  if (["trailing", "right", "end"].includes(compact)
    || compact.includes("trailing")
    || compact.startsWith("right")
    || compact.endsWith("right")
    || compact.startsWith("end")
    || compact.endsWith("end")) {
    return "trailing";
  }
  if (["leading", "left", "start"].includes(compact)
    || compact.includes("leading")
    || compact.startsWith("left")
    || compact.endsWith("left")
    || compact.startsWith("start")
    || compact.endsWith("start")) {
    return "leading";
  }
  return undefined;
}

function generatedTargetVerticalAlias(value: unknown): "top" | "center" | "bottom" | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  if (text === "top" || text === "center" || text === "bottom") return text;
  const compact = text.toLowerCase().replace(/[\s_-]+/g, "");
  if (["top", "upper"].includes(compact) || compact.includes("top") || compact.includes("upper") || compact.includes("上")) {
    return "top";
  }
  if (["bottom", "lower"].includes(compact) || compact.includes("bottom") || compact.includes("lower") || compact.includes("下")) {
    return "bottom";
  }
  if (["middle", "center", "centre"].includes(compact) || compact.includes("middle") || compact.includes("center") || compact.includes("centre") || compact.includes("中")) {
    return "center";
  }
  return undefined;
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
  _pageCatalog: PageAssetCatalog,
  appId: string,
  platform: PageAssetPlatform
): ScriptFlow | undefined {
  const candidates = flows.filter((flow) =>
    flow.appId === appId && flow.platform === platform && flow.status === "draft"
  );
  const normalizedPrompt = compactGroundingText(prompt);
  const exact = candidates.filter((flow) => compactGroundingText(flow.name) === normalizedPrompt);
  if (exact.length === 1) return exact[0];

  const endpointMatches = candidates.filter((flow) => {
    const endpoints = flowPageEndpoints(flow.parsed);
    const endpointText = [endpoints.source, endpoints.target]
      .filter(Boolean)
      .map((value) => compactGroundingText(value!));
    return endpointText.some((value) => normalizedPrompt.includes(value));
  });
  return endpointMatches.length === 1 ? endpointMatches[0] : undefined;
}

function flowPageEndpoints(parsed: Record<string, unknown>): { source?: string; target?: string } {
  const entry = recordValue(parsed.entry);
  const outcome = recordValue(parsed.outcome);
  const steps = flattenRecords(Array.isArray(parsed.steps) ? parsed.steps : []);
  const first = steps[0];
  const source = stringValue(entry.screenRef)
    ?? screenRefOf(first?.waitForPage)
    ?? screenRefOf(first?.before);
  const target = stringValue(outcome.screenRef)
    ?? [...steps].reverse().flatMap((step) => [
      screenRefOf(step.after),
      screenRefOf(step.reachPage),
      screenRefOf(step.assertPage),
      screenRefOf(step.waitForPage)
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
      }
    }
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

function normalizeGeneratedRunFlowReferences(
  value: unknown,
  catalog: ScriptFlowPlannerCatalog
): unknown {
  const document = recordValue(value);
  if (!Array.isArray(document.steps)) return value;
  return {
    ...document,
    steps: normalizeRawRunFlowSteps(document.steps, catalog, {
      entryPage: screenRefOf(recordValue(document.entry)),
      outcomePage: screenRefOf(recordValue(document.outcome))
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
    const normalizedScrollUntilVisible = recordValue(normalizedStep.scrollUntilVisible);
    const scrollSearch = recordValue(normalizedScrollUntilVisible.search);
    if (normalizedScrollUntilVisible && Object.keys(scrollSearch).length) {
      normalizedStep.scrollUntilVisible = {
        ...normalizedScrollUntilVisible,
        ...(normalizedScrollUntilVisible.direction === undefined && scrollSearch.direction !== undefined ? { direction: scrollSearch.direction } : {}),
        ...(normalizedScrollUntilVisible.maxSwipes === undefined && scrollSearch.maxSwipes !== undefined ? { maxSwipes: scrollSearch.maxSwipes } : {})
      };
      delete (normalizedStep.scrollUntilVisible as Record<string, unknown>).search;
    }
    const inputText = recordValue(normalizedStep.inputText);
    if (inputText && Object.hasOwn(inputText, "text")) {
      normalizedStep.inputText = {
        ...inputText,
        ...(inputText.value === undefined ? { value: inputText.text } : {})
      };
      delete (normalizedStep.inputText as Record<string, unknown>).text;
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

function normalizeGeneratedWaitDurations(value: unknown, generatedValues?: unknown): unknown {
  const document = recordValue(value);
  if (!Array.isArray(document.steps)) return value;
  return {
    ...document,
    steps: normalizeRawWaitDurationSteps(document.steps, recordValue(generatedValues))
  };
}

function normalizeRawWaitDurationSteps(steps: unknown[], generatedValues: Record<string, unknown>): unknown[] {
  return steps.map((value) => {
    const step = recordValue(value);
    const normalizedStep: Record<string, unknown> = { ...step };
    const wait = recordValue(normalizedStep.wait);
    if (Object.hasOwn(wait, "durationMs")) {
      const durationMs = normalizedWaitDurationMs(wait.durationMs, generatedValues);
      if (durationMs !== undefined) normalizedStep.wait = { ...wait, durationMs };
    }
    const repeat = recordValue(normalizedStep.repeat);
    if (Array.isArray(repeat.steps)) {
      normalizedStep.repeat = {
        ...repeat,
        steps: normalizeRawWaitDurationSteps(repeat.steps, generatedValues)
      };
    }
    const when = recordValue(normalizedStep.when);
    if (Array.isArray(when.steps)) {
      normalizedStep.when = {
        ...when,
        steps: normalizeRawWaitDurationSteps(when.steps, generatedValues)
      };
    }
    return normalizedStep;
  });
}

function normalizedWaitDurationMs(value: unknown, generatedValues: Record<string, unknown> = {}): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const text = stringValue(value);
  if (!text) return undefined;
  const parameterName = bindingParameterName(text);
  if (parameterName && generatedValues[parameterName] !== undefined) {
    return normalizedWaitDurationMs(generatedValues[parameterName]);
  }
  const compact = text.toLowerCase().replace(/，/g, ",").replace(/\s+/g, "");
  if (/^\d+(?:\.\d+)?$/.test(compact)) {
    const numeric = Number(compact);
    return numeric > 0 ? numeric : undefined;
  }
  const colon = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(compact);
  if (colon) {
    const first = Number(colon[1]);
    const second = Number(colon[2]);
    const third = colon[3] === undefined ? undefined : Number(colon[3]);
    const seconds = third === undefined ? first * 60 + second : first * 3600 + second * 60 + third;
    return seconds > 0 ? Math.round(seconds * 1000) : undefined;
  }
  const unitPattern = /(\d+(?:\.\d+)?)(毫秒|milliseconds?|msecs?|ms|秒钟|秒|seconds?|secs?|s|分钟|分|minutes?|mins?|min|m|小时|时|hours?|hrs?|hr|h)/giu;
  let totalMs = 0;
  let matched = false;
  const leftover = compact.replace(unitPattern, (_match, amount: string, unit: string) => {
    matched = true;
    totalMs += Number(amount) * waitDurationUnitMultiplier(unit);
    return "";
  }).replace(/[,+，、和又]/gu, "");
  if (!matched || leftover) return undefined;
  return totalMs > 0 ? Math.round(totalMs) : undefined;
}

function waitDurationUnitMultiplier(unit: string): number {
  const normalized = unit.toLowerCase();
  if (normalized === "毫秒" || normalized === "ms" || normalized.startsWith("msec") || normalized.startsWith("millisecond")) return 1;
  if (normalized === "秒" || normalized === "秒钟" || normalized === "s" || normalized.startsWith("sec") || normalized.startsWith("second")) return 1000;
  if (normalized === "分" || normalized === "分钟" || normalized === "m" || normalized === "min" || normalized.startsWith("minute")) return 60_000;
  return 3_600_000;
}

function hasRawActionOtherThanRunFlow(step: Record<string, unknown>): boolean {
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "wait", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "repeat", "when"]
    .some((action) => step[action] !== undefined);
}

function uniqueReusableFlowForStep(
  step: Record<string, unknown>,
  catalog: ScriptFlowPlannerCatalog,
  documentPages: { entryPage?: string; outcomePage?: string }
): string | undefined {
  const onPage = screenRefOf(recordValue(step.before)) ?? documentPages.entryPage;
  const targetPage = screenRefOf(recordValue(step.after)) ?? documentPages.outcomePage;
  const candidates = catalog.reusableFlows.filter((flow) => {
    const entry = recordValue(flow.entry);
    const outcome = recordValue(flow.outcome);
    const entryPage = stringValue(entry.screenRef);
    const outcomePage = stringValue(outcome.screenRef);
    if (onPage && entryPage && onPage !== entryPage) return false;
    if (targetPage && outcomePage && targetPage !== outcomePage) return false;
    return Boolean(targetPage ? outcomePage === targetPage : entryPage === onPage);
  });
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}

type PromptPageConstraintGrounding = {
  sourcePages: Set<string>;
  targetPages: Set<string>;
};

function normalizeGeneratedPageConstraints(
  document: ScriptFlowDocument,
  input: {
    prompt?: string;
    existingDocument?: ScriptFlowDocument;
    catalog: ScriptFlowPlannerCatalog;
  }
): ScriptFlowDocument {
  if (!input.prompt || input.existingDocument) return document;

  const grounding = inferPromptPageConstraintGrounding(input.prompt, input.catalog);
  const entry = document.entry && isPromptGroundedPageReference(document.entry.screenRef, grounding.sourcePages, input.catalog)
    ? document.entry
    : undefined;
  const outcome = document.outcome && isPromptGroundedPageReference(document.outcome.screenRef, grounding.targetPages, input.catalog)
    ? document.outcome
    : undefined;
  return {
    ...document,
    entry,
    outcome,
    steps: normalizeGeneratedStepPageConstraints(document.steps, grounding, input.catalog)
  };
}

function normalizeGeneratedStepPageConstraints(
  steps: ScriptStep[],
  grounding: PromptPageConstraintGrounding,
  catalog: ScriptFlowPlannerCatalog
): ScriptStep[] {
  return steps.map((step) => {
    const normalized = { ...step };
    if (normalized.before && !isPromptGroundedPageReference(normalized.before.screenRef, grounding.sourcePages, catalog)) {
      delete normalized.before;
    }
    if (normalized.after && !isPromptGroundedPageReference(normalized.after.screenRef, grounding.targetPages, catalog)) {
      delete normalized.after;
    }
    if ("repeat" in normalized) {
      return {
        ...normalized,
        repeat: {
          ...normalized.repeat,
          steps: normalizeGeneratedStepPageConstraints(normalized.repeat.steps, grounding, catalog)
        }
      };
    }
    if ("when" in normalized) {
      return {
        ...normalized,
        when: {
          ...normalized.when,
          steps: normalizeGeneratedStepPageConstraints(normalized.when.steps, grounding, catalog)
        }
      };
    }
    return normalized;
  });
}

function inferPromptPageConstraintGrounding(
  prompt: string,
  catalog: ScriptFlowPlannerCatalog
): PromptPageConstraintGrounding {
  const sourcePages = new Set<string>();
  const targetPages = new Set<string>();
  for (const page of catalog.pages) {
    if (promptMentionsPageAsSource(prompt, page)) sourcePages.add(page.key);
    if (promptMentionsPageAsTarget(prompt, page)) targetPages.add(page.key);
  }
  return { sourcePages, targetPages };
}

function isPromptGroundedPageReference(
  reference: string | undefined,
  groundedPages: Set<string>,
  catalog: ScriptFlowPlannerCatalog
): boolean {
  if (!reference) return true;
  const canonical = canonicalPlannerPageKey(reference, catalog);
  return Boolean(canonical && groundedPages.has(canonical));
}

function canonicalPlannerPageKey(
  reference: string,
  catalog: ScriptFlowPlannerCatalog
): string | undefined {
  return catalog.pages.find((page) =>
    page.id === reference || page.key === reference || page.name === reference
  )?.key;
}

function promptMentionsPageAsSource(
  prompt: string,
  page: ScriptFlowPlannerCatalog["pages"][number]
): boolean {
  return pagePromptAliases(page).some((alias) =>
    new RegExp(`(?:从|在|当前(?:在|位于)?|位于|处于|先到|先进入|回到|返回到)\\s*[^，,。；;]{0,12}${escapeRegExp(alias)}(?:页|页面)?`, "u").test(prompt)
  );
}

function promptMentionsPageAsTarget(
  prompt: string,
  page: ScriptFlowPlannerCatalog["pages"][number]
): boolean {
  return pagePromptAliases(page).some((alias) =>
    new RegExp(`(?:进入|到达|打开|前往|跳转到|跳至|回到|返回到)\\s*[^，,。；;]{0,12}${escapeRegExp(alias)}(?:页|页面)?`, "u").test(prompt)
  );
}

function pagePromptAliases(page: ScriptFlowPlannerCatalog["pages"][number]): string[] {
  const aliases = new Set([page.name, page.key, page.id].filter(Boolean));
  if (page.name.endsWith("页")) aliases.add(page.name.slice(0, -1));
  if (page.name.endsWith("页面")) aliases.add(page.name.slice(0, -2));
  return [...aliases].filter((alias) => alias.length >= 2);
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
  const normalized: ScriptStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const nextStep = steps[index + 1];
    if (isRedundantTextFieldFocusTap(step, nextStep)) {
      continue;
    }
    if ("repeat" in step) {
      normalized.push({
        ...step,
        repeat: {
          ...step.repeat,
          steps: normalizeExecutableTargetSteps(step.repeat.steps, input)
        }
      });
      continue;
    }
    if ("when" in step) {
      normalized.push({
        ...step,
        when: {
          ...step.when,
          steps: normalizeExecutableTargetSteps(step.when.steps, input)
        }
      });
      continue;
    }
    if ("tap" in step) {
      normalized.push({
        ...step,
        tap: step.tap
      });
      continue;
    }
    if ("selectText" in step) {
      const target = step.selectText.target;
      normalized.push({
        ...step,
        selectText: {
          ...step.selectText,
          target,
          search: normalizeFormSearchPolicy(step.selectText.search, target, input)
        }
      });
      continue;
    }
    if ("inputText" in step) {
      const target = normalizeGenericTextFieldTextTarget(step.inputText.target, input);
      normalized.push({
        ...step,
        inputText: {
          ...step.inputText,
          target,
          search: normalizeFormSearchPolicy(step.inputText.search, target, input)
        }
      });
      continue;
    }
    if ("clearText" in step) {
      const target = normalizeGenericTextFieldTextTarget(step.clearText.target, input);
      normalized.push({
        ...step,
        clearText: {
          ...step.clearText,
          target,
          search: normalizeFormSearchPolicy(step.clearText.search, target, input)
        }
      });
      continue;
    }
    if ("scrollUntilVisible" in step) {
      normalized.push({
        ...step,
        scrollUntilVisible: {
          ...step.scrollUntilVisible,
          target: step.scrollUntilVisible.target
        }
      });
      continue;
    }
    normalized.push(step);
  }
  return normalized;
}

function isRedundantTextFieldFocusTap(step: ScriptStep, nextStep: ScriptStep | undefined): boolean {
  if (!("tap" in step) || !nextStep || !("inputText" in nextStep)) return false;
  const tapTarget = step.tap.target;
  const inputTarget = nextStep.inputText.target;
  const tapText = tapTarget.text;
  const inputText = inputTarget.text;
  return Boolean(
    isTextTarget(tapTarget)
    && isTextTarget(inputTarget)
    && tapText
    && inputText
    && looksLikeGenericTextFieldReference(tapText)
    && compactGroundingText(tapText) === compactGroundingText(inputText)
  );
}

function normalizeGenericTextFieldTextTarget(
  target: ScriptTarget,
  input: { screenContext?: ScreenUnderstandingContext }
): ScriptTarget {
  const targetText = target.text;
  if (!isTextTarget(target) || !targetText || !looksLikeGenericTextFieldReference(targetText)) return target;
  const candidate = uniqueScreenTextFieldCandidate(input.screenContext);
  if (!candidate) return target;
  const normalizedTarget: ScriptTarget = {
    control: "textField",
    area: "content",
    ordinal: candidate.ordinal
  };
  if (candidate.scopeText) normalizedTarget.scopeText = candidate.scopeText;
  return normalizedTarget;
}

function uniqueScreenTextFieldCandidate(
  screenContext: ScreenUnderstandingContext | undefined
): { scopeText?: string; ordinal: number } | undefined {
  const candidates = screenContext?.controlCandidates.flatMap((candidate) => {
    if (candidate.control !== "textField" || typeof candidate.ordinal !== "number" || candidate.ordinal <= 0) {
      return [];
    }
    return [{ scopeText: candidate.scopeText, ordinal: candidate.ordinal }];
  }) ?? [];
  return candidates.length === 1 ? candidates[0] : undefined;
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
  const flowIds = new Set(input.catalog.reusableFlows.map((flow) => flow.id));
  for (const step of flattenSteps(document.steps)) {
    if ("runFlow" in step && !flowIds.has(step.runFlow)) {
      throw new Error(`AI 草稿引用了不存在或未启用的子流程：${step.runFlow}`);
    }
    if ("launchApp" in step && step.launchApp.appId && step.launchApp.appId !== input.appId) {
      throw new Error(`AI 草稿尝试启动其他 App：${step.launchApp.appId}`);
    }
  }
}

function validateNoGeneratedReachPage(document: ScriptFlowDocument): void {
  const reachPageStep = flattenSteps(document.steps).find((step) => "reachPage" in step);
  if (!reachPageStep || !("reachPage" in reachPageStep)) return;
  throw new GeneratedReachPageError(reachPageStep.reachPage.screenRef);
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
    if (target?.control !== "textField") {
      continue;
    }
    const fixedScope = [target.scopeText, target.anchorText].find((value) => value && fixedTitles.has(compactGroundingText(value)));
    if (fixedScope) {
      throw new UnstableTextFieldScopeError(fixedScope);
    }
  }
}

function hasRelativeTextFieldPrompt(prompt: string | undefined): boolean {
  return Boolean(prompt
    && /输入框|文本框|输入栏|输入区/u.test(prompt)
    && /上方|上面|上边|下方|下面|下边|左侧|左边|右侧|右边|附近|旁边|前面|后面|最上|最下|第[一二三四五六七八九十\d]+个/u.test(prompt));
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
  return looksLikeGenericTextFieldReference(text)
    || /^(?:包含|带有).*(?:的)?(?:课程|班级|活动|入口|按钮|条目|记录|对象)$/u.test(text)
    || /^(?:相关|目标|对应|合适|任一|任意|某个|指定)(?:的)?(?:课程|班级|活动|入口|按钮|条目|记录|对象)$/u.test(text)
    || /(?:相关|目标|对应|合适|任一|任意|某个|指定)(?:的)?(?:入口|按钮|条目|对象)$/u.test(text);
}

function looksLikeGenericTextFieldReference(value: string): boolean {
  return /(?:输入框|文本框|输入栏|输入区|输入区域|编辑框|编辑区域|输入控件|文本输入|text\s*field|input\s*(?:field|box|area)?)/iu.test(value.trim());
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
  void document;
  void catalog;
}

function screenControlCandidateMatchesTarget(
  target: ScriptTarget,
  screenContext: ScreenUnderstandingContext | undefined
): boolean {
  if (!screenContext) return false;
  return screenContext.controlCandidates.some((candidate) => {
    if (target.control && candidate.control !== target.control) return false;
    if (target.control === "textField") {
      if (typeof target.ordinal === "number" && target.ordinal > 0 && target.ordinal === candidate.ordinal) {
        if (!target.scopeText && !target.anchorText) return true;
        if (
          target.scopeText
          && candidate.scopeText
          && compactGroundingText(target.scopeText) === compactGroundingText(candidate.scopeText)
        ) return true;
      }
      return Boolean(target.anchorText
        && candidate.nearText
        && compactGroundingText(target.anchorText) === compactGroundingText(candidate.nearText));
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
  return `“${scopeText}”像是固定页面标题，不能作为可滚动页面中输入框的稳定限定范围或相对锚点。请补充该输入框附近的局部字段名或区域名，或开启“结合当前屏幕生成”让我读取当前可见控件。`;
}

function generatedReachPageClarification(prompt: string | undefined, screenRef: string): string {
  const target = prompt?.trim()
    ? prompt.replace(/\s+/g, " ").trim().slice(0, 80)
    : screenRef;
  return `当前不能用 reachPage 作为运行时导航命令。请补充从当前状态到“${target}”的完整操作过程，或提供目标页独有稳定文字用于 assertText；如果用例中心已有完整业务路径，请改用 runFlow 复用。`;
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

class GeneratedReachPageError extends Error {
  constructor(readonly screenRef: string) {
    super("reachPage 已退出新脚本生成；请改用用例中心 runFlow，或补充完整操作路径。");
    this.name = "GeneratedReachPageError";
  }
}

function transitionEntries(flow: ScriptFlow) {
  const steps = Array.isArray(flow.parsed.steps) ? flow.parsed.steps : [];
  return flattenRecords(steps).flatMap((step) => {
    const fromScreenRef = screenRefOf(recordValue(step.before));
    const toScreenRef = screenRefOf(recordValue(step.after));
    if (!fromScreenRef || !toScreenRef) return [];
    return [{
      fromScreenRef,
      toScreenRef,
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
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "wait", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "runFlow", "repeat", "when"]
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

function screenRefOf(value: unknown): string | undefined {
  return stringValue(recordValue(value).screenRef);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}
