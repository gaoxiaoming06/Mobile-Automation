import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDriver } from "@mobile-automation/test-support";
import type { ActionStep, StepExpectation, StructuredFlow, TestRun } from "@mobile-automation/shared";
import { Storage } from "./storage.js";
import { StructuredFlowRunner } from "./structured-flow-runner.js";

let tempRoot: string | undefined;

afterEach(async () => {
  const root = tempRoot;
  tempRoot = undefined;
  delete process.env.DATA_DIR;
  vi.resetModules();
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("StructuredFlowRunner", () => {
  it("executes structured flow steps through beforeState, action, afterExpectations, and system guards", async () => {
    const { storage, driver, runner } = await createRunnerContext();
    const flow = storage.createStructuredFlow(flowInput([tapOnElementStep("step-teacher", 1, "我是教师", "cn.eeo.classin:id/item_0"), tapOnElementStep("step-class", 2, "第一个班级", "cn.eeo.classin:id/item_1")]));

    const started = await runner.start({
      flowId: flow.id,
      deviceSerial: driver.device.serial,
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForStructuredRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 240, y: 240 },
      { type: "tap", x: 240, y: 240 }
    ]);
    expect(run.steps.map((step) => [step.id, step.order, step.type])).toEqual([
      ["step-teacher", 1, "tap_on_element"],
      ["step-class", 2, "tap_on_element"]
    ]);
    expect(run.stepResults).toEqual([
      expect.objectContaining({
        stepId: "step-teacher",
        status: "passed",
        expectationResults: expect.arrayContaining([expect.objectContaining({ type: "text", status: "passed" }), expect.objectContaining({ type: "no_crash", status: "passed" })])
      }),
      expect.objectContaining({
        stepId: "step-class",
        status: "passed"
      })
    ]);
    expect(run.reportHtmlPath).toBeTruthy();
  });

  it("can stop at an intermediate structured flow step", async () => {
    const { storage, driver, runner } = await createRunnerContext();
    const flow = storage.createStructuredFlow(flowInput([tapOnElementStep("step-teacher", 1, "我是教师", "cn.eeo.classin:id/item_0"), tapOnElementStep("step-class", 2, "第一个班级", "cn.eeo.classin:id/item_1")]));

    const started = await runner.start({
      flowId: flow.id,
      deviceSerial: driver.device.serial,
      stopAtStepId: "flow-step-step-teacher",
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForStructuredRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 240 }]);
    expect(run.stepResults.map((result) => result.stepId)).toEqual(["step-teacher"]);
  });

  it("runs once with temporary expectation overrides without mutating the saved structured flow", async () => {
    const { storage, driver, runner } = await createRunnerContext(hierarchy(["新文案"], ["cn.eeo.classin:id/item_0"]));
    const step = tapOnElementStep("step-teacher", 1, "旧文案", "cn.eeo.classin:id/item_0");
    step.action.params = {
      ...step.action.params,
      locator: {
        strategy: "android_uiautomator",
        resourceId: "cn.eeo.classin:id/item_0",
        packageName: "cn.eeo.classin"
      }
    };
    step.beforeState = {
      ...step.beforeState,
      expectations: []
    };
    const flow = storage.createStructuredFlow(flowInput([step]));
    const expectationId = flow.steps[0]?.afterExpectations[0]?.id ?? "";

    const started = await runner.start({
      flowId: flow.id,
      deviceSerial: driver.device.serial,
      expectationOverrides: [
        {
          stepId: flow.steps[0]?.id ?? "",
          expectationId,
          scope: "afterExpectations",
          params: {
            expected: "新文案"
          }
        }
      ],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForStructuredRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.steps[0]?.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expectationId,
          params: expect.objectContaining({
            expected: "新文案",
            runtimeOverride: true
          })
        })
      ])
    );
    expect(storage.getStructuredFlow(flow.id)?.steps[0]?.afterExpectations[0]?.params.expected).toBe("旧文案");
  });

  it("repairs legacy structured recordings with placeholder app package and state anchor text", async () => {
    const { storage, driver, runner } = await createRunnerContext(hierarchy(["创建公开课"], ["cn.eeo.classin:id/create_lesson"]));
    const step = tapOnElementStep("step-create", 1, "创建公开课", "cn.eeo.classin:id/create_lesson");
    step.beforeState = {
      id: "state-start",
      name: "起点",
      matchers: [],
      expectations: [
        {
          id: "bad-placeholder-start",
          type: "text",
          enabled: true,
          params: {
            expected: "起点",
            mode: "contains",
            source: "structured_flow_state_anchor",
            timeoutMs: 1,
            intervalMs: 1
          },
          createdAt: "2026-06-14T10:00:00.000Z"
        }
      ]
    };
    const flow = storage.createStructuredFlow({
      ...flowInput([step]),
      name: "未命名应用-unknown-起点-终点",
      appName: "未命名应用",
      targetApp: {
        androidPackageName: "unknown.android.package"
      },
      startStrategy: "restart_app"
    });

    const started = await runner.start({
      flowId: flow.id,
      deviceSerial: driver.device.serial,
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForStructuredRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.setupActions).toEqual([
      { type: "close_app", packageName: "cn.eeo.classin" },
      { type: "launch_app", packageName: "cn.eeo.classin" }
    ]);
    expect(run.steps[0]?.preconditions).toEqual([]);
  });

  it("rejects Android structured flows that require app startup but cannot infer a package name", async () => {
    const { storage, driver, runner } = await createRunnerContext();
    const step = tapOnElementStep("step-unknown", 1, "我是教师", "cn.eeo.classin:id/item_0");
    step.action.params = {};
    const flow = storage.createStructuredFlow({
      ...flowInput([step]),
      targetApp: {
        androidPackageName: "unknown.android.package"
      },
      startStrategy: "restart_app"
    });

    await expect(
      runner.start({
        flowId: flow.id,
        deviceSerial: driver.device.serial,
        stepIntervalMs: 0,
        recordVideo: false
      })
    ).rejects.toThrow("结构化用例执行前校验失败：restart_app 需要明确的 Android packageName");
  });

  it("rejects structured flow execution when the selected device platform does not match the flow", async () => {
    const { storage, driver, runner } = await createRunnerContext();
    driver.device.platform = "ios";
    const flow = storage.createStructuredFlow(flowInput([tapOnElementStep("step-teacher", 1, "我是教师", "cn.eeo.classin:id/item_0")]));

    await expect(
      runner.start({
        flowId: flow.id,
        deviceSerial: driver.device.serial,
        stepIntervalMs: 0,
        recordVideo: false
      })
    ).rejects.toThrow("结构化用例执行前校验失败：用例平台 android 与当前设备平台 ios 不一致");
  });

  it("does not inherit the legacy fixed step interval when structured flow input omits it", async () => {
    const { storage, driver, runner } = await createRunnerContext();
    const flow = storage.createStructuredFlow(flowInput([tapOnElementStep("step-teacher", 1, "我是教师", "cn.eeo.classin:id/item_0")]));

    const started = await runner.start({
      flowId: flow.id,
      deviceSerial: driver.device.serial,
      recordVideo: false
    });
    const run = await waitForStructuredRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.config.stepIntervalMs).toBe(0);
  });
});

async function createRunnerContext(xml = hierarchy(["我是教师", "第一个班级"])): Promise<{ storage: Storage; driver: UiHierarchyMockDriver; runner: StructuredFlowRunner }> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-flow-runner-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const [{ Storage: IsolatedStorage }, { StructuredFlowRunner: IsolatedRunner }] = await Promise.all([import("./storage.js"), import("./structured-flow-runner.js")]);
  const storage = new IsolatedStorage();
  await storage.ensureDirs();
  const driver = new UiHierarchyMockDriver(xml);
  driver.device.capabilities.recordVideo = false;
  return {
    storage,
    driver,
    runner: new IsolatedRunner(storage, driver)
  };
}

function flowInput(steps: StructuredFlow["steps"]): Parameters<Storage["createStructuredFlow"]>[0] {
  return {
    name: "ClassIn-5.0.8-首页-班级详情",
    appName: "ClassIn",
    platform: "android",
    targetApp: {
      androidPackageName: "cn.eeo.classin"
    },
    appVersion: {
      displayVersion: "5.0.8",
      buildNumber: "99856"
    },
    startState: flowState("state-home", "首页", "我是教师"),
    endState: flowState("state-class", "班级详情", "第一个班级"),
    startStrategy: "keep_current",
    tags: ["teacher"],
    status: "active",
    steps
  };
}

function tapOnElementStep(id: string, order: number, text: string, resourceId: string): StructuredFlow["steps"][number] {
  const action: ActionStep = {
    id,
    order,
    type: "tap_on_element",
    enabled: true,
    title: `点击${text}`,
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId,
        text,
        packageName: "cn.eeo.classin"
      },
      selector: `id=${resourceId}`,
      resourceId,
      timeoutMs: 1,
      intervalMs: 1
    },
    coordinate: {
      x: 240,
      y: 240,
      xRatio: 240 / 1080,
      yRatio: 240 / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: "2026-06-14T10:00:00.000Z"
  };
  return {
    id: `flow-step-${id}`,
    order,
    title: action.title ?? text,
    enabled: true,
    beforeState: flowState(`before-${id}`, order === 1 ? "首页" : "班级列表", text),
    action,
    afterExpectations: [textExpectation(`after-${id}`, text)],
    systemGuards: [guardExpectation(`guard-crash-${id}`, "no_crash"), guardExpectation(`guard-alive-${id}`, "app_alive")],
    timing: {
      transitionTimeoutMs: 1,
      pollIntervalMs: 1,
      stableSampleCount: 1
    },
    createdAt: "2026-06-14T10:00:00.000Z"
  };
}

function flowState(id: string, name: string, text: string): StructuredFlow["startState"] {
  return {
    id,
    name,
    matchers: [{ id: `${id}-text`, type: "text", value: text, weight: 1, critical: true }],
    expectations: [textExpectation(`${id}-expect`, text)]
  };
}

function textExpectation(id: string, expected: string): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    params: {
      expected,
      mode: "contains",
      timeoutMs: 1,
      intervalMs: 1
    },
    createdAt: "2026-06-14T10:00:00.000Z"
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
    createdAt: "2026-06-14T10:00:00.000Z"
  };
}

function hierarchy(texts: string[], resourceIds = texts.map((_, index) => `cn.eeo.classin:id/item_${index}`)): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
    ${texts.map((text, index) => `<node index="${index}" text="${text}" resource-id="${resourceIds[index]}" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" bounds="[120,200][360,280]" />`).join("\n")}
  </node>
</hierarchy>`;
}

class UiHierarchyMockDriver extends MockDriver {
  constructor(private readonly xml: string) {
    super();
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    await this.getDeviceInfo(serial);
    return this.xml;
  }
}

async function waitForStructuredRun(runner: StructuredFlowRunner, storage: Storage, runId: string): Promise<TestRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runner.isRunning(runId)) {
      const run = storage.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not finish: ${runId}`);
}
