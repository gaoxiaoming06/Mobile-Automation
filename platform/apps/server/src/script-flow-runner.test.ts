import { describe, expect, it, vi } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { DeviceInfo, TestRun } from "@mobile-automation/shared";
import type { PageAssetCatalog, PageAssetSummary } from "./page-asset-catalog.js";
import { ScriptFlowRunner, type ScriptFlowRunBackend } from "./script-flow-runner.js";
import { ScriptTargetResolver } from "./script-target-resolver.js";

describe("ScriptFlowRunner", () => {
  it("compiles one business action with page precondition and result verification", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = document([
      {
        id: "open-class",
        name: "打开指定班级",
        onPage: "classin.home",
        expectPage: "classin.class.detail",
        tap: { target: { ocrText: "${className}" } }
      }
    ], {
      className: { type: "string", required: true }
    });

    await runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" },
      confirmedRiskSteps: ["open-class"],
      androidAppMonitor: {
        enabled: true,
        packageName: "cn.eeo.classin"
      },
      recordVideo: false
    });

    expect(backend.input?.steps).toHaveLength(1);
    expect(backend.input?.androidAppMonitor).toEqual({
      enabled: true,
      packageName: "cn.eeo.classin"
    });
    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "open-class",
      type: "tap_on_text",
      title: "打开指定班级",
      params: expect.objectContaining({
        text: "班级四十二号",
        scriptFlowId: "flow-1",
        scriptStepId: "open-class",
        locatorStrategy: "ocr_text"
      }),
      preconditions: [expect.objectContaining({ type: "state_is", params: expect.objectContaining({ pageId: "classin.home" }) })],
      expectations: [expect.objectContaining({ type: "state_is", params: expect.objectContaining({ pageId: "classin.class.detail" }) })]
    }));
  });

  it("keeps waitForPage as one report step instead of creating a verification step pair", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow: document([{ id: "wait-home", waitForPage: "classin.home", timeoutMs: 5000 }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps).toHaveLength(1);
    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "wait-home",
      type: "wait",
      expectations: [expect.objectContaining({ type: "state_is", params: expect.objectContaining({ pageId: "classin.home", timeoutMs: 5000 }) })]
    }));
  });

  it("uses typed run parameters and confirms each risky step independently", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = document([
      { id: "publish-primary", tap: { target: { ocrText: "发布" } } },
      { id: "publish-copy", tap: { target: { ocrText: "再次发布" } } }
    ], {
      lessonName: { type: "string", required: true }
    });

    await expect(runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { lessonName: "本次课堂" },
      recordVideo: false
    })).rejects.toThrow("Risk confirmation required: publish-primary (publish), publish-copy (publish)");

    await expect(runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { lessonName: "本次课堂" },
      confirmedRiskSteps: ["publish-primary"],
      recordVideo: false
    })).rejects.toThrow("Risk confirmation required: publish-copy (publish)");

    await runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { lessonName: "本次课堂" },
      confirmedRiskSteps: ["publish-primary", "publish-copy"],
      recordVideo: false
    });
    expect(backend.input?.steps?.[0]?.params.scriptParameters).toEqual({ lessonName: "本次课堂" });
  });

  it("rejects a platform that the selected device cannot execute", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend, "ios");

    await expect(runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow: document([{ id: "open", tap: { target: { ocrText: "主页" } } }]),
      deviceSerial: "device-1"
    })).rejects.toThrow("Script platform android does not match device platform ios");
  });

  it("executes sensitive values in memory but sends redacted steps to persistence", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-sensitive",
      flow: document([{
        id: "password",
        inputText: { target: { ocrText: "密码" }, value: "${password}" }
      }], {
        password: { type: "string", required: true, sensitive: true }
      }),
      deviceSerial: "device-1",
      parameters: { password: "top-secret" },
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]?.params.text).toBe("top-secret");
    expect(backend.input?.persistedSteps?.[0]?.params.text).toBe("[REDACTED]");
    expect(JSON.stringify(backend.input?.persistedSteps)).not.toContain("top-secret");
  });

  it("redacts sensitive scalar fields without corrupting step structure", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-sensitive-scalars",
      flow: document([
        { id: "step-1", inputText: { target: { ocrText: "短码" }, value: "${token}" } },
        { id: "step-number", inputText: { target: { ocrText: "数字" }, value: "${pin}" } },
        { id: "step-boolean", inputText: { target: { ocrText: "开关" }, value: "${enabled}" } }
      ], {
        token: { type: "string", required: true, sensitive: true },
        pin: { type: "number", required: true, sensitive: true },
        enabled: { type: "boolean", required: true, sensitive: true }
      }),
      deviceSerial: "device-1",
      parameters: { token: "__SCRIPT_FLOW_REDACTED__", pin: 1, enabled: true },
      recordVideo: false
    });

    expect(backend.input?.persistedSteps?.map((step) => ({
      id: step.id,
      order: step.order,
      enabled: step.enabled,
      text: step.params.text
    }))).toEqual([
      { id: "step-1", order: 1, enabled: true, text: "[REDACTED]" },
      { id: "step-number", order: 2, enabled: true, text: "[REDACTED]" },
      { id: "step-boolean", order: 3, enabled: true, text: "[REDACTED]" }
    ]);
  });

  it("keeps persisted evidence timestamps aligned with runtime steps", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const clock = vi.spyOn(Date.prototype, "toISOString")
      .mockReturnValueOnce("2026-07-28T00:00:00.001Z")
      .mockReturnValueOnce("2026-07-28T00:00:00.002Z");

    try {
      await runner.start({
        ...previewBinding,
        flowId: "flow-sensitive-time",
        flow: document([{
          id: "password",
          inputText: { target: { ocrText: "密码" }, value: "${password}" }
        }], {
          password: { type: "string", required: true, sensitive: true }
        }),
        deviceSerial: "device-1",
        parameters: { password: "secret" },
        recordVideo: false
      });
    } finally {
      clock.mockRestore();
    }

    expect(backend.input?.persistedSteps?.[0]?.createdAt).toBe(backend.input?.steps?.[0]?.createdAt);
  });
});

const previewBinding = { planDigest: "a".repeat(64), dependencies: [] };

function runnerWith(backend: CapturingBackend, platform: DeviceInfo["platform"] = "android"): ScriptFlowRunner {
  return new ScriptFlowRunner({
    backend,
    driver: {
      getDeviceInfo: async () => device(platform)
    },
    targetResolver: new ScriptTargetResolver(new EmptyCatalog())
  });
}

class CapturingBackend implements ScriptFlowRunBackend {
  input?: Parameters<ScriptFlowRunBackend["start"]>[0];

  start(input: Parameters<ScriptFlowRunBackend["start"]>[0]): TestRun {
    this.input = input;
    return {
      id: "run-1",
      caseName: input.caseName ?? "ScriptFlow",
      deviceSerial: input.deviceSerial,
      status: "pending",
      config: {} as TestRun["config"],
      steps: input.steps ?? [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-07-28T00:00:00.000Z"
    };
  }
}

class EmptyCatalog implements PageAssetCatalog {
  listPages(): PageAssetSummary[] { return []; }
  getPage(): undefined { return undefined; }
  resolvePage(): undefined { return undefined; }
  listLocators(): [] { return []; }
  findConfusablePages(): PageAssetSummary[] { return []; }
}

function document(
  steps: ScriptFlowDocument["steps"],
  parameters: ScriptFlowDocument["parameters"] = {}
): ScriptFlowDocument {
  return {
    version: 1,
    name: "创建课堂",
    app: { id: "cn.eeo.classin", platform: "android" },
    start: { strategy: "keepCurrent" },
    parameters,
    steps,
    tags: []
  };
}

function device(platform: DeviceInfo["platform"]): DeviceInfo {
  return {
    id: "device-1",
    serial: "device-1",
    platform,
    status: "online",
    capabilities: {
      preview: true,
      tap: true,
      longPress: true,
      swipe: true,
      back: true,
      home: true,
      recentApps: true,
      textInput: true,
      screenshot: true,
      launchApp: true,
      closeApp: true,
      recordVideo: false,
      metrics: { cpu: false, memory: false, fps: false, network: false, battery: false, temperature: false },
      events: { crash: false, anr: false, logs: false }
    },
    lastSeenAt: "2026-07-28T00:00:00.000Z"
  };
}
