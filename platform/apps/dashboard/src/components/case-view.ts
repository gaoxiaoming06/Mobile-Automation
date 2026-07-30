import type { ScriptParameterDefinitionView, ScriptParameterValue } from "./ScriptRunForm.js";

export type CaseDocumentView = {
  version: 1;
  kind: "case" | "scenario";
  name: string;
  description?: string;
  app: { id: string; platform: string };
  entry?: { page?: string; session?: "authenticated" | "unauthenticated"; role?: string };
  outcome?: { page?: string; session?: "authenticated" | "unauthenticated"; role?: string };
  parameters: Record<string, ScriptParameterDefinitionView>;
  steps: CaseSourceStep[];
  tags: string[];
};

export type CaseSourceStep = Record<string, unknown> & {
  id: string;
  name?: string;
  onPage?: string;
  expectPage?: string;
  risk?: string;
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
    risk: string;
    phase?: "preparation" | "test";
  }>;
  riskConfirmations: Array<{ stepId: string; risk: string; stepName?: string }>;
};

export type CaseStepView = {
  id: string;
  order: number;
  name: string;
  action: string;
  context?: string;
  risk: string;
  phase?: "preparation" | "test";
};

export function readCaseDocument(value: Record<string, unknown> | undefined): CaseDocumentView | undefined {
  if (!value || !value.app || typeof value.app !== "object" || !Array.isArray(value.steps)) return undefined;
  return { kind: "case", ...value } as unknown as CaseDocumentView;
}

export function testKindLabel(kind: CaseDocumentView["kind"] | undefined): string {
  return kind === "scenario" ? "场景" : "用例";
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
      risk: step.risk,
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
      context: sourceStepContext(step),
      risk: sourceRisk(step, action)
    };
  });
}

export function caseActionLabel(action: string): string {
  const labels: Record<string, string> = {
    launchApp: "启动 App",
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

function sourceRisk(step: CaseSourceStep, action: string): string {
  if (typeof step.risk === "string") return step.risk;
  return action === "tap" || action === "selectText" ? "interaction" : "none";
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
  return pageContext(step.onPage, step.expectPage);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
