import { describe, expect, it } from "vitest";
import type { ActionStep, StepExpectation, StructuredFlow, TestRuleStep } from "@mobile-automation/shared";
import { inferAndroidPackageNameFromRuleSteps, structuredFlowToExecutableSteps, testRuleStepToExecutableActionStep } from "./test-rule-step.js";

describe("TestRuleStep execution adapter", () => {
  it("converts a rule step into an executable action step", () => {
    const step = ruleStep({
      action: actionStep("step-create", {
        preconditions: [
          placeholderExpectation("bad-click-title", "点击元素：创建课堂"),
          textExpectation("real-action-precondition", "创建公开课")
        ],
        timing: {
          delayBeforeMs: 120
        }
      }),
      beforeStateExpectations: [placeholderExpectation("bad-start", "起点"), textExpectation("real-before", "我是教师")],
      afterExpectations: [textExpectation("after-visible", "新建课堂")],
      systemGuards: [guardExpectation("guard-crash", "no_crash"), guardExpectation("guard-alive", "app_alive")],
      transitionTimeoutMs: 2500
    });

    const executable = testRuleStepToExecutableActionStep(step, 3);

    expect(executable).toEqual(
      expect.objectContaining({
        id: "step-create",
        order: 3,
        type: "tap_on_element",
        timing: {
          delayBeforeMs: 120,
          timeoutMs: 2500
        }
      })
    );
    expect(executable.preconditions?.map((expectation) => expectation.id)).toEqual(["real-action-precondition", "real-before"]);
    expect(executable.expectations?.map((expectation) => expectation.id)).toEqual(["after-visible", "guard-crash", "guard-alive"]);
    expect(executable.params.ruleSource).toEqual({
      ruleStepId: "flow-step-step-create",
      sourceType: "structured_flow"
    });
  });

  it("keeps real state-anchor expectations while filtering generated placeholders", () => {
    const step = ruleStep({
      beforeStateExpectations: [
        placeholderExpectation("bad-end", "终点"),
        placeholderExpectation("bad-action-type", "tap"),
        placeholderExpectation("bad-click-title", "点击元素：我是教师"),
        textExpectation("real-page-title", "课堂")
      ]
    });

    const executable = testRuleStepToExecutableActionStep(step, 1);

    expect(executable.preconditions?.map((expectation) => expectation.id)).toEqual(["real-page-title"]);
  });

  it("builds executable steps for a structured flow stop target", () => {
    const first = ruleStep({ id: "flow-step-first", action: actionStep("first") });
    const second = ruleStep({ id: "flow-step-second", action: actionStep("second") });
    const third = ruleStep({ id: "flow-step-third", action: actionStep("third") });

    const executable = structuredFlowToExecutableSteps(flow([first, second, third]), "flow-step-second");

    expect(executable.map((step) => [step.id, step.order])).toEqual([
      ["first", 1],
      ["second", 2]
    ]);
  });

  it("infers Android package names from action params and semantic locators", () => {
    const direct = ruleStep({
      action: actionStep("direct", {
        params: {
          packageName: "cn.eeo.classin"
        }
      })
    });
    const locator = ruleStep({
      action: actionStep("locator", {
        params: {
          locator: {
            strategy: "android_uiautomator",
            packageName: "cn.eeo.classin.lesson"
          }
        }
      })
    });

    expect(inferAndroidPackageNameFromRuleSteps([direct])).toBe("cn.eeo.classin");
    expect(inferAndroidPackageNameFromRuleSteps([ruleStep({ action: actionStep("unknown", { params: {} }) }), locator])).toBe("cn.eeo.classin.lesson");
  });
});

function flow(steps: TestRuleStep[]): StructuredFlow {
  return {
    id: "flow_1",
    name: "ClassIn-5.0.8-首页-新建课堂",
    appName: "ClassIn",
    platform: "android",
    targetApp: {
      androidPackageName: "unknown.android.package"
    },
    appVersion: {
      displayVersion: "5.0.8"
    },
    startState: stateAnchor("start", "首页"),
    endState: stateAnchor("end", "新建课堂"),
    startStrategy: "keep_current",
    tags: [],
    status: "active",
    version: 1,
    steps,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z"
  };
}

function ruleStep(
  options: {
    id?: string;
    action?: ActionStep;
    beforeStateExpectations?: StepExpectation[];
    afterExpectations?: StepExpectation[];
    systemGuards?: StepExpectation[];
    transitionTimeoutMs?: number;
  } = {}
): TestRuleStep {
  const action = options.action ?? actionStep("step-create");
  return {
    id: options.id ?? `flow-step-${action.id}`,
    order: action.order,
    title: action.title ?? "点击创建课堂",
    enabled: true,
    beforeState: {
      ...stateAnchor("before", "首页"),
      expectations: options.beforeStateExpectations ?? []
    },
    action,
    afterExpectations: options.afterExpectations ?? [],
    systemGuards: options.systemGuards ?? [],
    timing: {
      transitionTimeoutMs: options.transitionTimeoutMs,
      pollIntervalMs: 100,
      stableSampleCount: 1
    },
    source: {
      sourceType: "structured_flow"
    },
    createdAt: "2026-06-15T10:00:00.000Z"
  };
}

function actionStep(id: string, overrides: Partial<ActionStep> = {}): ActionStep {
  return {
    id,
    order: 1,
    type: "tap_on_element",
    enabled: true,
    title: "点击创建课堂",
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId: "cn.eeo.classin:id/create_lesson",
        packageName: "cn.eeo.classin"
      },
      ...(overrides.params ?? {})
    },
    coordinate: {
      x: 240,
      y: 240,
      xRatio: 240 / 1080,
      yRatio: 240 / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides
  };
}

function stateAnchor(id: string, name: string): TestRuleStep["beforeState"] {
  return {
    id,
    name,
    matchers: [
      {
        id: `${id}-text`,
        type: "text",
        value: name,
        weight: 1,
        critical: true
      }
    ],
    expectations: []
  };
}

function textExpectation(id: string, expected: string): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    params: {
      expected,
      mode: "contains"
    },
    createdAt: "2026-06-15T10:00:00.000Z"
  };
}

function placeholderExpectation(id: string, expected: string): StepExpectation {
  return {
    ...textExpectation(id, expected),
    params: {
      expected,
      mode: "contains",
      source: "structured_flow_state_anchor"
    }
  };
}

function guardExpectation(id: string, type: "no_crash" | "app_alive"): StepExpectation {
  return {
    id,
    type,
    enabled: true,
    params: {
      blocking: true
    },
    createdAt: "2026-06-15T10:00:00.000Z"
  };
}
