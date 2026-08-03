import type { ScriptParameterDefinitionView, ScriptParameterValue } from "./ScriptRunForm.js";

export type CaseDocumentView = {
  version: 1;
  kind: "case" | "scenario";
  purpose?: "navigation" | "fixture" | "business" | "recovery";
  testLevel?: "probe" | "component" | "business_smoke" | "full_regression";
  name: string;
  description?: string;
  app: { id: string; platform: string };
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

export function caseStepViews(document: CaseDocumentView | undefined, plan?: CasePlanView): CaseStepView[] {
  if (plan) {
    return plan.steps.map((step) => ({
      id: step.id,
      order: step.order,
      name: step.name ?? caseActionLabel(step.action),
      action: step.action,
      context: planStepContext(step),
      ...(step.phase ? { phase: step.phase } : {})
    }));
  }
  return flattenSourceSteps(document?.steps ?? []).map((step, index) => {
    const action = sourceAction(step);
    return {
      id: step.id,
      order: index + 1,
      name: step.name ?? caseActionLabel(action),
      action,
      context: sourceStepContext(step)
    };
  });
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

function sourceStepContext(step: CaseSourceStep): string | undefined {
  const reachPage = recordValue(step.reachPage);
  if (typeof reachPage?.page === "string") {
    return `目标页面：${reachPage.page}`;
  }
  const assertText = recordValue(step.assertText);
  if (typeof assertText?.text === "string") {
    return assertText.text;
  }
  const tap = actionTargetRecord(step.tap);
  if (tap) return targetContext(tap.target);
  const inputText = actionTargetRecord(step.inputText);
  if (inputText) {
    const label = targetLabel(inputText.target);
    const value = stringValue(inputText.action.value);
    return label && value ? `${label} = ${value}` : label;
  }
  const clearText = actionTargetRecord(step.clearText);
  if (clearText) return targetLabel(clearText.target);
  const selectText = actionTargetRecord(step.selectText);
  if (selectText) {
    const label = targetLabel(selectText.target);
    const value = stringValue(selectText.action.value);
    return label && value ? `${label} → ${value}` : label;
  }
  const scrollUntilVisible = actionTargetRecord(step.scrollUntilVisible);
  if (scrollUntilVisible) return targetLabel(scrollUntilVisible.target);
  return pageContext(step.onPage, step.expectPage);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function actionTargetRecord(value: unknown): { action: Record<string, unknown>; target: Record<string, unknown> } | undefined {
  const action = recordValue(value);
  const target = recordValue(action?.target);
  return action && target ? { action, target } : undefined;
}

function targetContext(target: Record<string, unknown>): string | undefined {
  const control = stringValue(target.control);
  if (control === "switch") {
    const label = targetLabel(target);
    const checked = typeof target.checked === "boolean" ? target.checked : undefined;
    if (!label) return checked === undefined ? "开关" : `开关：${checked ? "开启" : "关闭"}`;
    return checked === undefined ? `${label} 开关` : `${label} 开关：${checked ? "开启" : "关闭"}`;
  }
  if (control === "checkbox") {
    const label = targetLabel(target);
    return label ? `${label} 复选框` : "复选框";
  }
  if (control === "textField") return targetLabel(target) ?? "输入框";
  return targetLabel(target);
}

function targetLabel(target: Record<string, unknown>): string | undefined {
  return stringValue(target.text)
    ?? stringValue(target.nearText)
    ?? stringValue(target.scopeText)
    ?? stringValue(target.semantic)
    ?? iconLabel(stringValue(target.icon))
    ?? stringValue(target.control);
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
