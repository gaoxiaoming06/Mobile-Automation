import { describe, expect, it } from "vitest";
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
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" },
      recordVideo: false
    });

    expect(backend.input?.steps).toHaveLength(1);
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

  it("merges profile values below this-run input and blocks unconfirmed risky actions", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = document([
      { id: "publish", tap: { target: { ocrText: "发布" } } }
    ], {
      lessonName: { type: "string", required: true }
    });

    await expect(runner.start({
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      profileParameters: { lessonName: "Profile 课堂" },
      parameters: { lessonName: "本次课堂" },
      recordVideo: false
    })).rejects.toThrow("Risk confirmation required: publish");

    await runner.start({
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      profileParameters: { lessonName: "Profile 课堂" },
      parameters: { lessonName: "本次课堂" },
      confirmedRisks: ["publish"],
      recordVideo: false
    });
    expect(backend.input?.steps?.[0]?.params.scriptParameters).toEqual({ lessonName: "本次课堂" });
  });

  it("rejects a platform that the selected device cannot execute", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend, "ios");

    await expect(runner.start({
      flowId: "flow-1",
      flow: document([{ id: "open", tap: { target: { ocrText: "主页" } } }]),
      deviceSerial: "device-1"
    })).rejects.toThrow("Script platform android does not match device platform ios");
  });
});

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
