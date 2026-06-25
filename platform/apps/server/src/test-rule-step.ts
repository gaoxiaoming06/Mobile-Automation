import type { ActionStep, StepExpectation, StructuredFlow, TestRuleStep } from "@mobile-automation/shared";

export function testRuleStepToExecutableActionStep(ruleStep: TestRuleStep, order: number): ActionStep {
  const timing = {
    ...(ruleStep.action.timing ?? {})
  };
  if (typeof ruleStep.timing?.transitionTimeoutMs === "number") {
    timing.timeoutMs = ruleStep.timing.transitionTimeoutMs;
  }

  return {
    ...ruleStep.action,
    order,
    params: {
      ...ruleStep.action.params,
      ruleSource: {
        ruleStepId: ruleStep.id,
        sourceType: typeof ruleStep.source?.sourceType === "string" ? ruleStep.source.sourceType : "structured_flow"
      }
    },
    preconditions: [...validRulePreconditions(ruleStep.action.preconditions), ...validRulePreconditions(ruleStep.beforeState.expectations)],
    expectations: [...ruleStep.afterExpectations, ...ruleStep.systemGuards],
    timing: Object.keys(timing).length > 0 ? timing : undefined
  };
}

export function structuredFlowToExecutableSteps(flow: StructuredFlow, stopAtStepId?: string): ActionStep[] {
  return flow.steps
    .slice(0, stopAtIndex(flow.steps, stopAtStepId))
    .map((flowStep, index) => testRuleStepToExecutableActionStep(flowStep, index + 1));
}

export function inferAndroidPackageNameFromStructuredFlow(flow: StructuredFlow): string | undefined {
  return normalizeKnownPackageName(flow.targetApp.androidPackageName) ?? inferAndroidPackageNameFromRuleSteps(flow.steps);
}

export function inferAndroidPackageNameFromRuleSteps(steps: TestRuleStep[]): string | undefined {
  for (const step of steps) {
    const packageName = packageNameFromAction(step.action);
    if (packageName) {
      return packageName;
    }
  }
  return undefined;
}

export function validRulePreconditions(expectations: StepExpectation[] | undefined): StepExpectation[] {
  return (expectations ?? []).filter((expectation) => {
    if (expectation.params.source !== "structured_flow_state_anchor") {
      return true;
    }
    const expected = typeof expectation.params.expected === "string" ? expectation.params.expected.trim() : "";
    return Boolean(expected && expected !== "起点" && expected !== "终点" && !expected.startsWith("点击元素：") && expected !== "tap");
  });
}

function stopAtIndex(steps: Array<{ id: string }>, stopAtStepId: string | undefined): number {
  if (!stopAtStepId) {
    return steps.length;
  }
  const index = steps.findIndex((step) => step.id === stopAtStepId);
  return index >= 0 ? index + 1 : steps.length;
}

function packageNameFromAction(action: ActionStep): string | undefined {
  const direct = normalizeKnownPackageName(typeof action.params.packageName === "string" ? action.params.packageName : undefined);
  if (direct) {
    return direct;
  }
  const locator = action.params.locator;
  if (locator && typeof locator === "object" && "packageName" in locator) {
    return normalizeKnownPackageName(typeof locator.packageName === "string" ? locator.packageName : undefined);
  }
  return undefined;
}

function normalizeKnownPackageName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unknown.android.package") {
    return undefined;
  }
  return trimmed;
}
