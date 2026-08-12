import type { ScriptParameterDefinitionView, ScriptParameterValue } from "./ScriptRunForm.js";

export type CaseDocumentView = {
  version: 1;
  kind: "case" | "scenario";
  purpose?: "navigation" | "fixture" | "business" | "recovery";
  testLevel?: "probe" | "component" | "business_smoke" | "full_regression";
  name: string;
  description?: string;
  app: { id: string };
  start?: { strategy: "keepCurrent" | "goHome" | "launchApp" | "restartApp" | "clearDataAndLaunch" };
  entry?: { page?: string; session?: "authenticated" | "unauthenticated"; role?: string };
  outcome?: { page?: string; session?: "authenticated" | "unauthenticated"; role?: string };
  loop?: { reset: "none" };
  parameters: Record<string, ScriptParameterDefinitionView>;
  steps: CaseSourceStep[];
  tags: string[];
};

export type CaseSourceStep = Record<string, unknown> & {
  id: string;
  name?: string;
  role?: "setup" | "navigation" | "business" | "assertion" | "cleanup" | "recovery" | "reset";
  onPage?: string;
  expectPage?: string;
};

export type CasePlanView = {
  steps: Array<{
    id: string;
    order: number;
    name?: string;
    action: string;
    input?: Record<string, unknown>;
    onPage?: string;
    expectPage?: string;
    phase?: "preparation" | "business" | "verification" | "reset";
    role?: "setup" | "navigation" | "business" | "assertion" | "cleanup" | "recovery" | "reset";
    source?: {
      flowName?: string;
      stepId?: string;
    };
  }>;
};

export type CaseStepView = {
  id: string;
  order: number;
  name: string;
  action: string;
  context?: string;
  phase?: "preparation" | "business" | "verification" | "reset";
};

export type LoopBodyAvailability = {
  available: boolean;
  mode: "steps" | "none" | "unconfigured";
  resetStepCount: number;
  reason?: string;
};

export type CaseStepViewOptions = {
  parameterValues?: Record<string, ScriptParameterValue>;
};

export function loopBodyAvailability(document: CaseDocumentView | undefined): LoopBodyAvailability {
  const resetStepCount = flattenSourceSteps(document?.steps ?? []).filter((step) => step.role === "reset").length;
  if (resetStepCount > 0 && document?.loop?.reset === "none") {
    return {
      available: false,
      mode: "unconfigured",
      resetStepCount,
      reason: "每轮复位步骤与“无需复位”不能同时配置。"
    };
  }
  if (resetStepCount > 0) {
    return { available: true, mode: "steps", resetStepCount };
  }
  if (document?.loop?.reset === "none") {
    return { available: true, mode: "none", resetStepCount: 0 };
  }
  return {
    available: false,
    mode: "unconfigured",
    resetStepCount: 0,
    reason: "请先配置每轮复位步骤，或明确业务执行后已回到循环起点。"
  };
}

export function readCaseDocument(value: Record<string, unknown> | undefined): CaseDocumentView | undefined {
  if (!value || !value.app || typeof value.app !== "object" || !Array.isArray(value.steps)) return undefined;
  return { kind: "case", ...value } as unknown as CaseDocumentView;
}

export function testKindLabel(kind: CaseDocumentView["kind"] | undefined): string {
  return kind === "scenario" ? "场景" : "用例";
}

export function testPurposeLabel(purpose: CaseDocumentView["purpose"]): string {
  if (purpose === "navigation") return "导航";
  if (purpose === "fixture") return "准备";
  if (purpose === "recovery") return "恢复";
  return "业务";
}

export function testLevelLabel(testLevel: CaseDocumentView["testLevel"]): string {
  if (testLevel === "probe") return "临时验证";
  if (testLevel === "component") return "控件能力";
  if (testLevel === "full_regression") return "全字段回归";
  return "业务冒烟";
}

export function defaultCaseParameterValues(document: CaseDocumentView | undefined): Record<string, ScriptParameterValue> {
  if (!document) return {};
  return Object.fromEntries(Object.entries(document.parameters).flatMap(([key, definition]) => definition.default === undefined ? [] : [[key, definition.default]]));
}

export function caseStepViews(document: CaseDocumentView | undefined, plan?: CasePlanView, options: CaseStepViewOptions = {}): CaseStepView[] {
  const display = stepDisplayContext(document, options);
  if (plan) {
    const sourceDisplayById = sourceStepDisplayMap(document, display);
    return plan.steps.map((step) => {
      const sourceDisplay = sourceDisplayById.get(planSourceStepId(step) ?? step.id);
      return {
        id: step.id,
        order: step.order,
        name: planStepDisplayName(step, sourceDisplay),
        action: step.action,
        context: planStepContext(step) ?? sourceDisplay?.context,
        ...(step.phase ? { phase: step.phase } : {})
      };
    });
  }
  return flattenSourceSteps(document?.steps ?? []).map((step, index) => {
    const action = sourceAction(step);
    return {
      id: step.id,
      order: index + 1,
      name: sourceStepDisplayName(step, action, display),
      action,
      context: sourceStepContext(step, display)
    };
  });
}

type SourceStepDisplay = {
  name: string;
  context?: string;
};

function sourceStepDisplayMap(
  document: CaseDocumentView | undefined,
  display: StepDisplayContext
): Map<string, SourceStepDisplay> {
  return new Map(flattenSourceSteps(document?.steps ?? []).map((step) => {
    const action = sourceAction(step);
    return [step.id, {
      name: sourceStepDisplayName(step, action, display),
      context: sourceStepContext(step, display)
    }];
  }));
}

function planStepDisplayName(
  step: CasePlanView["steps"][number],
  sourceDisplay: SourceStepDisplay | undefined
): string {
  const explicitName = stringValue(step.name);
  if (explicitName && !isGenericStepName(explicitName, step.action)) return explicitName;
  return sourceDisplay?.name ?? explicitName ?? caseActionLabel(step.action);
}

function planSourceStepId(step: CasePlanView["steps"][number]): string | undefined {
  return stringValue(recordValue(step.source)?.stepId);
}

export function caseActionLabel(action: string): string {
  const labels: Record<string, string> = {
    launchApp: "重启 App",
    tap: "点击目标",
    inputText: "输入文本",
    clearText: "清空输入",
    selectText: "选择选项",
    swipe: "滑动页面",
    scrollUntilVisible: "查找内容",
    reachPage: "到达页面",
    waitForPage: "等待页面",
    assertPage: "确认页面",
    assertText: "确认出现指定内容",
    runFlow: "执行复用用例",
    repeat: "重复执行",
    when: "条件执行"
  };
  return labels[action] ?? action;
}

function flattenSourceSteps(steps: CaseSourceStep[]): CaseSourceStep[] {
  return steps.flatMap((step) => {
    const repeat = recordValue(step.repeat);
    const when = recordValue(step.when);
    const nested = Array.isArray(repeat?.steps) ? repeat.steps : Array.isArray(when?.steps) ? when.steps : undefined;
    return nested ? [step, ...flattenSourceSteps(nested as CaseSourceStep[])] : [step];
  });
}

function sourceAction(step: CaseSourceStep): string {
  const actions = ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "runFlow", "repeat", "when"];
  return actions.find((action) => action in step) ?? "unknown";
}

function pageContext(onPage: string | undefined, expectPage: string | undefined): string | undefined {
  if (onPage && expectPage) return `${onPage} → ${expectPage}`;
  return onPage ?? expectPage;
}

function planStepContext(step: CasePlanView["steps"][number]): string | undefined {
  if (step.action === "reachPage" && typeof step.input?.pageId === "string") {
    return `目标页面：${step.input.pageId}`;
  }
  if (step.action === "assertText" && typeof step.input?.text === "string") {
    return step.input.text;
  }
  return pageContext(step.onPage, step.expectPage);
}

function sourceStepContext(step: CaseSourceStep, display: StepDisplayContext): string | undefined {
  const reachPage = recordValue(step.reachPage);
  if (typeof reachPage?.page === "string") {
    return `目标页面：${reachPage.page}`;
  }
  const assertText = recordValue(step.assertText);
  if (typeof assertText?.text === "string") {
    return displayValue(assertText.text, display);
  }
  const tap = actionTargetRecord(step.tap);
  if (tap) return targetContext(tap.target, display);
  const inputText = actionTargetRecord(step.inputText);
  if (inputText) {
    const label = targetLabel(inputText.target, display);
    const value = displayValue(inputText.action.value, display);
    return label && value ? `${label} = ${value}` : label;
  }
  const clearText = actionTargetRecord(step.clearText);
  if (clearText) return targetLabel(clearText.target, display);
  const selectText = actionTargetRecord(step.selectText);
  if (selectText) {
    const label = targetLabel(selectText.target, display);
    const value = displayValue(selectText.action.value, display);
    return label && value ? `${label} → ${value}` : label;
  }
  const scrollUntilVisible = actionTargetRecord(step.scrollUntilVisible);
  if (scrollUntilVisible) return targetLabel(scrollUntilVisible.target, display);
  return pageContext(step.onPage, step.expectPage);
}

function sourceStepDisplayName(step: CaseSourceStep, action: string, display: StepDisplayContext): string {
  const explicitName = stringValue(step.name);
  if (explicitName && !isGenericStepName(explicitName, action)) return explicitName;
  return sourceActionSummary(step, action, display) ?? explicitName ?? caseActionLabel(action);
}

function sourceActionSummary(step: CaseSourceStep, action: string, display: StepDisplayContext): string | undefined {
  if (action === "tap") {
    const tap = actionTargetRecord(step.tap);
    return tap ? tapSummary(tap.target, display) : undefined;
  }
  if (action === "inputText") {
    const input = actionTargetRecord(step.inputText);
    if (!input) return undefined;
    const label = descriptiveTargetLabel(input.target, display);
    const value = displayValue(input.action.value, display);
    if (label && value) return `在“${label}”中输入“${value}”`;
    if (value) return `输入“${value}”`;
    return label ? `在“${label}”中输入文本` : undefined;
  }
  if (action === "clearText") {
    const clear = actionTargetRecord(step.clearText);
    const label = clear ? descriptiveTargetLabel(clear.target, display) : undefined;
    return label ? `清空“${label}”` : undefined;
  }
  if (action === "selectText") {
    const select = actionTargetRecord(step.selectText);
    if (!select) return undefined;
    const label = descriptiveTargetLabel(select.target, display);
    const value = displayValue(select.action.value, display);
    if (label && value) return `将“${label}”选择为“${value}”`;
    if (value) return `选择“${value}”`;
    return label ? `选择“${label}”` : undefined;
  }
  if (action === "scrollUntilVisible") {
    const scroll = actionTargetRecord(step.scrollUntilVisible);
    if (!scroll) return undefined;
    const label = descriptiveTargetLabel(scroll.target, display);
    const direction = directionLabel(stringValue(scroll.action.direction));
    return label ? `${direction}滚动查找“${label}”` : `${direction}滚动查找内容`;
  }
  if (action === "swipe") {
    const swipe = recordValue(step.swipe);
    return `${directionLabel(stringValue(swipe?.direction))}滑动页面`;
  }
  if (action === "reachPage") {
    const page = stringValue(recordValue(step.reachPage)?.page);
    return page ? `到达页面“${page}”` : undefined;
  }
  if (action === "waitForPage") {
    const page = stringValue(step.waitForPage);
    return page ? `等待进入页面“${page}”` : undefined;
  }
  if (action === "assertPage") {
    const page = stringValue(step.assertPage);
    return page ? `确认已进入页面“${page}”` : undefined;
  }
  if (action === "assertText") {
    const text = displayValue(recordValue(step.assertText)?.text, display);
    return text ? `确认出现“${text}”` : undefined;
  }
  return undefined;
}

function tapSummary(target: Record<string, unknown>, display: StepDisplayContext): string | undefined {
  const control = stringValue(target.control);
  const label = descriptiveTargetLabel(target, display);
  const checked = typeof target.checked === "boolean" ? target.checked : undefined;
  if (control === "switch") {
    const subject = label ? `“${label}”开关` : "开关";
    return checked === true ? `打开${subject}` : checked === false ? `关闭${subject}` : `点击${subject}`;
  }
  if (control === "checkbox") {
    const subject = label ? `“${label}”` : "复选框";
    return checked === true ? `勾选${subject}` : checked === false ? `取消勾选${subject}` : `点击${subject}`;
  }
  const icon = stringValue(target.icon);
  if (icon) return `点击${targetPositionLabel(target)}${iconLabel(icon)}`;
  const visual = stringValue(recordValue(target.visual)?.query);
  if (visual) return `点击视觉目标“${visual}”`;
  return label ? `点击“${label}”` : control ? `点击${control}` : undefined;
}

function descriptiveTargetLabel(target: Record<string, unknown>, display: StepDisplayContext): string | undefined {
  return relativeTextFieldLabel(target, display)
    ?? displayValue(target.text, display)
    ?? displayValue(target.nearText, display)
    ?? displayValue(target.scopeText, display)
    ?? displayValue(target.semantic, display);
}

function targetPositionLabel(target: Record<string, unknown>): string {
  const area = stringValue(target.area);
  const position = stringValue(target.position);
  if (area === "topBar" && position === "leading") return "左上角";
  if (area === "topBar" && position === "trailing") return "右上角";
  if (area === "bottomBar" && position === "leading") return "左下角";
  if (area === "bottomBar" && position === "trailing") return "右下角";
  if (area === "topBar") return "顶部";
  if (area === "bottomBar") return "底部";
  return "";
}

function directionLabel(direction: string | undefined): string {
  if (direction === "up") return "向上";
  if (direction === "left") return "向左";
  if (direction === "right") return "向右";
  return "向下";
}

function isGenericStepName(name: string, action: string): boolean {
  return name === action || GENERIC_STEP_NAMES.has(name) || name === caseActionLabel(action);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function actionTargetRecord(value: unknown): { action: Record<string, unknown>; target: Record<string, unknown> } | undefined {
  const action = recordValue(value);
  const target = recordValue(action?.target);
  return action && target ? { action, target } : undefined;
}

function targetContext(target: Record<string, unknown>, display: StepDisplayContext): string | undefined {
  const control = stringValue(target.control);
  if (control === "switch") {
    const label = targetLabel(target, display);
    const checked = typeof target.checked === "boolean" ? target.checked : undefined;
    if (!label) return checked === undefined ? "开关" : `开关：${checked ? "开启" : "关闭"}`;
    return checked === undefined ? `${label} 开关` : `${label} 开关：${checked ? "开启" : "关闭"}`;
  }
  if (control === "checkbox") {
    const label = targetLabel(target, display);
    return label ? `${label} 复选框` : "复选框";
  }
  if (control === "textField") return targetLabel(target, display) ?? "输入框";
  return targetLabel(target, display);
}

function targetLabel(target: Record<string, unknown>, display: StepDisplayContext): string | undefined {
  return relativeTextFieldLabel(target, display)
    ?? displayValue(target.text, display)
    ?? displayValue(target.nearText, display)
    ?? displayValue(target.scopeText, display)
    ?? displayValue(target.semantic, display)
    ?? iconLabel(stringValue(target.icon))
    ?? stringValue(target.control);
}

function relativeTextFieldLabel(target: Record<string, unknown>, display: StepDisplayContext): string | undefined {
  if (stringValue(target.control) !== "textField") return undefined;
  const anchor = displayValue(target.anchorText, display);
  if (!anchor) return undefined;
  const relation = stringValue(target.relation);
  const suffixes: Record<string, string> = {
    above: "上方输入框",
    below: "下方输入框",
    leftOf: "左侧输入框",
    rightOf: "右侧输入框"
  };
  return `${anchor}${suffixes[relation ?? ""] ?? "附近输入框"}`;
}

function iconLabel(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  const labels: Record<string, string> = {
    add: "新增图标",
    back: "返回图标",
    close: "关闭图标",
    home: "主页图标",
    more: "更多图标",
    search: "搜索图标",
    share: "分享图标"
  };
  return labels[icon] ?? `${icon} 图标`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

type StepDisplayContext = {
  parameters: Record<string, ScriptParameterDefinitionView>;
  parameterValues: Record<string, ScriptParameterValue>;
};

function stepDisplayContext(document: CaseDocumentView | undefined, options: CaseStepViewOptions): StepDisplayContext {
  return {
    parameters: document?.parameters ?? {},
    parameterValues: options.parameterValues ?? {}
  };
}

function displayValue(value: unknown, context: StepDisplayContext): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const parameterName = parameterReferenceName(text);
  if (!parameterName) return text;
  const hasRuntimeValue = Object.prototype.hasOwnProperty.call(context.parameterValues, parameterName);
  if (!hasRuntimeValue) return text;
  const definition = context.parameters[parameterName];
  const runtimeValue = hasRuntimeValue ? context.parameterValues[parameterName] : undefined;
  const renderedValue = parameterRuntimeValueLabel(runtimeValue, definition);
  return `${renderedValue}（参数：${parameterName}）`;
}

function parameterReferenceName(value: string): string | undefined {
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1];
}

function parameterRuntimeValueLabel(
  value: ScriptParameterValue | undefined,
  definition: ScriptParameterDefinitionView | undefined
): string {
  if (definition?.sensitive) return "******";
  if (value === undefined) return "未填写";
  return String(value);
}

const GENERIC_STEP_NAMES = new Set([
  "点击目标",
  "输入文本",
  "清空输入",
  "选择选项",
  "滑动页面",
  "查找内容",
  "到达页面",
  "等待页面",
  "确认页面",
  "确认文字",
  "确认出现指定内容"
]);
