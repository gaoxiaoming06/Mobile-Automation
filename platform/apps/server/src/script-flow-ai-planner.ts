import {
  serializeScriptFlow,
  validateScriptFlowDocument,
  type ScriptFlowDocument,
  type ScriptStep,
  type ScriptTarget
} from "@mobile-automation/script-flow";
import type { ScriptFlow } from "@mobile-automation/shared";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetCatalog, PageAssetPlatform } from "./page-asset-catalog.js";

export const SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化 ScriptFlow 规划器，只生成可审查的脚本草稿，不操作设备。",
  "规划阶段禁止识别实时设备页面；start、onPage 和 expectPage 表达运行时页面约束。",
  "页面目录只负责页面身份，页面元素是可选公共定位器。用户明确描述的点击、输入、滑动可以直接用 ocrText 或 semantic 写入脚本，不要求先创建资产。",
  "只能引用目录中存在的 page key、pageElement id 和 active ScriptFlow id。禁止编造引用，禁止坐标、bounds、region_center 或固定屏幕区域点击。",
  "目标型请求优先复用 transitionIndex 或 runFlow；过程型请求按用户描述保留每个动作，不擅自扩展成创建、发布、提交或删除。",
  "动态业务值必须声明为 parameters 并在步骤中使用 ${parameterName}。用户已给出的值可作为 default；未给出但执行必需的值设 required: true。",
  "常用参数直接展示；低频可选参数标记 advanced: true。枚举只有在输入目录给出合法选项时才能使用 select/options。",
  "发布、提交、删除、支付只在用户明确要求时生成，系统会在执行前再次确认。",
  "信息不足时返回 needs_clarification 和一个简短问题，不要猜测。只返回 JSON 对象。"
].join("\n");

export type ScriptFlowPlannerCatalog = ReturnType<typeof buildScriptFlowPlannerCatalog>;

export type ScriptFlowAiDraft =
  | {
      status: "ready";
      sourceYaml: string;
      document: ScriptFlowDocument;
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
  fetchImpl?: AiClientFetch;
}): Promise<ScriptFlowAiDraft> {
  if (!input.config.enabled) {
    throw new Error(input.config.reason === "missing_config" ? "AI 配置不完整" : "AI 生成未启用");
  }
  const catalog = buildScriptFlowPlannerCatalog(input.pageCatalog, input.flows, input.appId, input.platform);
  const channel = isCodexAppServerProvider(input.config.baseURL) ? "codex" as const : "openai-compatible" as const;
  const result = await runAiJsonRequest({
    baseURL: input.config.baseURL,
    apiKey: input.config.apiKey,
    model: input.config.model,
    timeoutMs: input.config.timeoutMs
  }, {
    developerInstructions: SCRIPT_FLOW_AI_DEVELOPER_INSTRUCTIONS,
    userContent: buildScriptFlowPlannerPrompt(input.prompt, input.appId, input.platform, catalog),
    effort: "medium"
  }, input.fetchImpl ?? fetch);
  const parsed = parseScriptFlowAiResponse(result.content, { appId: input.appId, platform: input.platform, catalog });
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
    name: page.name,
    locators: pageCatalog.listLocators(page.id).map((locator) => ({
      id: locator.id,
      label: locator.label,
      locatorKind: locator.locatorKind,
      targetText: locator.targetText,
      requiresUiTree: locator.requiresUiTree
    }))
  }));
  const reusableFlows = flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .map((flow) => ({
      id: flow.id,
      name: flow.name,
      description: stringValue(flow.parsed.description),
      parameters: recordValue(flow.parsed.parameters)
    }));
  const transitions = flows
    .filter((flow) => flow.appId === appId && flow.platform === platform && flow.status === "active")
    .flatMap((flow) => transitionEntries(flow));
  return { pages, reusableFlows, transitions };
}

export function buildScriptFlowPlannerPrompt(
  prompt: string,
  appId: string,
  platform: PageAssetPlatform,
  catalog: ScriptFlowPlannerCatalog
): string {
  return [
    "根据用户需求生成 ScriptFlow v1 草稿。",
    "输出结构：",
    JSON.stringify({
      status: "ready | needs_clarification",
      clarification: "仅 needs_clarification 时填写",
      summary: "一句话说明生成结果",
      assumptions: ["必要且可审查的假设"],
      document: {
        version: 1,
        name: "用例名称",
        description: "用例说明",
        app: { id: appId, platform },
        start: { strategy: "keepCurrent | goHome | launchApp | restartApp | clearDataAndLaunch" },
        parameters: {},
        steps: [],
        tags: ["ai-generated"]
      }
    }, null, 2),
    "可用动作：launchApp、tap、inputText、clearText、selectText、swipe、scrollUntilVisible、waitForPage、assertPage、runFlow、repeat、when。",
    "target 只允许 ocrText、semantic、pageElement、within；禁止 visualTemplate，除非未来目录明确提供模板 ID。",
    "输入：",
    JSON.stringify({ prompt, appId, platform, catalog }, null, 2)
  ].join("\n\n");
}

export function parseScriptFlowAiResponse(
  raw: string,
  input: { appId: string; platform: PageAssetPlatform; catalog: ScriptFlowPlannerCatalog }
): ParsedScriptFlowAiDraft {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("AI 返回的 ScriptFlow 草稿不是合法 JSON");
  }
  const root = recordValue(value);
  if (root.status === "needs_clarification") {
    const clarification = stringValue(root.clarification);
    if (!clarification) throw new Error("AI 请求补充信息但没有给出问题");
    return { status: "needs_clarification", clarification };
  }
  if (root.status !== "ready") {
    throw new Error("AI 返回了未知的规划状态");
  }
  const document = validateScriptFlowDocument(root.document);
  validateGeneratedReferences(document, input);
  return {
    status: "ready",
    sourceYaml: serializeScriptFlow(document),
    document,
    summary: stringValue(root.summary) ?? `已生成 ${document.name}`,
    assumptions: stringArray(root.assumptions)
  };
}

function validateGeneratedReferences(
  document: ScriptFlowDocument,
  input: { appId: string; platform: PageAssetPlatform; catalog: ScriptFlowPlannerCatalog }
): void {
  if (document.app.id !== input.appId || document.app.platform !== input.platform) {
    throw new Error("AI 草稿修改了指定 App 或平台");
  }
  const pagesByReference = new Map<string, ScriptFlowPlannerCatalog["pages"][number]>();
  const locators = new Map<string, Set<string>>();
  for (const page of input.catalog.pages) {
    pagesByReference.set(page.id, page);
    pagesByReference.set(page.key, page);
    pagesByReference.set(page.name, page);
    locators.set(page.id, new Set(page.locators.map((locator) => locator.id)));
  }
  const flowIds = new Set(input.catalog.reusableFlows.map((flow) => flow.id));
  for (const step of flattenSteps(document.steps)) {
    const onPage = validatePageReference(step.onPage, "onPage", pagesByReference);
    validatePageReference(step.expectPage, "expectPage", pagesByReference);
    if ("assertPage" in step) validatePageReference(step.assertPage, "assertPage", pagesByReference);
    if ("waitForPage" in step) validatePageReference(step.waitForPage, "waitForPage", pagesByReference);
    if ("runFlow" in step && !flowIds.has(step.runFlow)) {
      throw new Error(`AI 草稿引用了不存在或未启用的子流程：${step.runFlow}`);
    }
    if ("launchApp" in step && step.launchApp.appId && step.launchApp.appId !== input.appId) {
      throw new Error(`AI 草稿尝试启动其他 App：${step.launchApp.appId}`);
    }
    const target = targetFromStep(step);
    if (target?.visualTemplate) {
      throw new Error("AI 草稿不能编造视觉模板引用");
    }
    if (target?.pageElement) {
      const allowed = onPage
        ? locators.get(onPage.id)
        : new Set(input.catalog.pages.flatMap((page) => page.locators.map((locator) => locator.id)));
      if (!allowed?.has(target.pageElement)) {
        throw new Error(`AI 草稿引用了不存在的页面元素：${target.pageElement}`);
      }
    }
  }
}

function validatePageReference(
  reference: string | undefined,
  field: string,
  pages: Map<string, ScriptFlowPlannerCatalog["pages"][number]>
) {
  if (!reference) return undefined;
  const page = pages.get(reference);
  if (!page) throw new Error(`AI 草稿的 ${field} 引用了未录入页面：${reference}`);
  return page;
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
      action: actionFromRecord(step)
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

function targetFromStep(step: ScriptStep): ScriptTarget | undefined {
  if ("tap" in step) return step.tap.target;
  if ("clearText" in step) return step.clearText.target;
  if ("scrollUntilVisible" in step) return step.scrollUntilVisible.target;
  if ("inputText" in step) return step.inputText.target;
  if ("selectText" in step) return step.selectText.target;
  return undefined;
}

function actionFromRecord(step: Record<string, unknown>): string {
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "waitForPage", "assertPage", "runFlow", "repeat", "when"]
    .find((action) => action in step) ?? "unknown";
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI response did not contain JSON");
  return raw.slice(start, end + 1);
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
