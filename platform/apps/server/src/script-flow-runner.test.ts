import { describe, expect, it, vi } from "vitest";
import { compileScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import type { DeviceInfo, InteractionAsset, TestRun } from "@mobile-automation/shared";
import type { PageAssetCatalog, PageAssetSummary } from "./page-asset-catalog.js";
import type { PageStateService } from "./page-state-service.js";
import type { ExecutionProfileSnapshot } from "./execution-profile.js";
import {
  ScriptFlowRunner,
  pageStateExpectationVerifier,
  selectScriptExecutionSteps,
  type ScriptFlowRunBackend
} from "./script-flow-runner.js";
import { ScriptTargetResolver } from "./script-target-resolver.js";

describe("ScriptFlowRunner", () => {
  it("does not freeze a platform execution profile into the run snapshot", async () => {
    const backend = new CapturingBackend();
    const profile: ExecutionProfileSnapshot = {
      id: "execution-profile:classin:android:graph-v1",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 3,
      status: "verified",
      digest: "profile-digest",
      createdAt: "2026-08-15T00:00:00.000Z",
      screens: []
    };
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("android") },
      targetResolver: new ScriptTargetResolver(),
      profileProvider: { createSnapshot: () => profile }
    } as never);

    await runner.start({
      ...previewBinding,
      flowId: "flow-profile-snapshot",
      flow: document([{ id: "tap-home", tap: { target: { text: "主页" } } }]),
      deviceSerial: "device-1"
    });

    expect(backend.input?.sourceSnapshot).not.toHaveProperty("executionProfile");
  });

  it("selects one source step without entry preparation or outcome assertions", () => {
    const flow: ScriptFlowDocument = {
      ...document([
        { id: "open-form", tap: { target: { text: "创建课堂" } } },
        { id: "fill-name", inputText: { target: { text: "课堂名称" }, value: "自动化课堂" } },
        { id: "assert-created", assertText: { text: "创建成功" } }
      ]),
      entry: { screenRef: "classin.home" },
      outcome: { screenRef: "classin.classroom.detail" }
    };

    const selected = selectScriptExecutionSteps(compileScriptFlow(flow), {
      startStepId: "fill-name",
      endStepId: "fill-name"
    });

    expect(selected.steps.map((step) => step.source.stepId)).toEqual(["fill-name"]);
    expect(selected.steps.map((step) => step.order)).toEqual([1]);
  });

  it("selects remaining executable steps from a source step", () => {
    const plan = compileScriptFlow(document([
      { id: "open-form", tap: { target: { text: "创建课堂" } } },
      { id: "fill-name", inputText: { target: { text: "课堂名称" }, value: "自动化课堂" } },
      { id: "assert-created", assertText: { text: "创建成功" } }
    ]));

    const selected = selectScriptExecutionSteps(plan, { startStepId: "fill-name" });

    expect(selected.steps.map((step) => step.source.stepId)).toEqual(["fill-name", "assert-created"]);
    expect(() => selectScriptExecutionSteps(plan, { startStepId: "missing" })).toThrow(/source step not found/i);
  });

  it("selects only the first expanded occurrence for a repeated child step trial", () => {
    const plan = compileScriptFlow(document([{
      id: "repeat-fields",
      repeat: {
        times: 2,
        steps: [
          { id: "fill-name", inputText: { target: { text: "课堂名称" }, value: "自动化课堂" } },
          { id: "tap-next", tap: { target: { text: "下一步" } } }
        ]
      }
    }]));

    const selected = selectScriptExecutionSteps(plan, {
      startStepId: "fill-name",
      endStepId: "fill-name"
    });

    expect(selected.steps.map((step) => step.id)).toEqual(["repeat-fields[1].fill-name"]);
  });

  it("selects every expanded core step when trialing a runFlow reference", () => {
    const child = document([
      { id: "restart-child", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
      { id: "open-growth", role: "business", tap: { target: { text: "成长" } } },
      { id: "verify-notes", role: "assertion", assertText: { text: "笔记" } },
      { id: "return-home", role: "reset", tap: { target: { text: "主页" } } }
    ]);
    child.name = "open notes";
    const plan = compileScriptFlow(document([
      { id: "reuse-notes", role: "business", runFlow: "flow-open-notes" },
      { id: "next-step", role: "business", tap: { target: { text: "下一步" } } }
    ]), {
      resolveFlow: (id) => id === "flow-open-notes" ? child : undefined
    });

    const selected = selectScriptExecutionSteps(plan, {
      startStepId: "reuse-notes",
      endStepId: "reuse-notes"
    });

    expect(selected.steps.map((step) => step.id)).toEqual([
      "reuse-notes.open-growth",
      "reuse-notes.verify-notes"
    ]);
  });

  it("rejects a partial range whose end step precedes its start step", () => {
    const plan = compileScriptFlow(document([
      { id: "open-form", tap: { target: { text: "创建课堂" } } },
      { id: "fill-name", inputText: { target: { text: "课堂名称" }, value: "自动化课堂" } }
    ]));

    expect(() => selectScriptExecutionSteps(plan, {
      startStepId: "fill-name",
      endStepId: "open-form"
    })).toThrow(/end source step precedes start source step/i);
  });

  it("starts a partial step trial from the current device state", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow: ScriptFlowDocument = {
      ...document([
        { id: "open-form", tap: { target: { text: "创建课堂" } } },
        { id: "fill-name", inputText: { target: { text: "课堂名称" }, value: "自动化课堂" } },
        { id: "assert-created", assertText: { text: "创建成功" } }
      ]),
      start: { strategy: "restartApp" },
      entry: { screenRef: "classin.home" },
      outcome: { screenRef: "classin.classroom.detail" }
    };

    await runner.start({
      ...previewBinding,
      flowId: "flow-step-trial",
      flow,
      deviceSerial: "device-1",
      executionPurpose: "step_trial",
      stepSelection: { startStepId: "fill-name", endStepId: "fill-name" },
      startStrategy: "keep_current",
      pauseAfterEachStep: true
    });

    expect(backend.input?.steps?.map((step) => step.id)).toEqual(["fill-name"]);
    expect(backend.input?.persistedSteps?.map((step) => step.id)).toEqual(["fill-name"]);
    expect(backend.input?.startStrategy).toBe("keep_current");
    expect(backend.input?.pauseAfterEachStep).toBe(true);
    expect(backend.input?.sourceSnapshot?.executionPurpose).toBe("step_trial");
  });

  it("prefers an explicit launch step over a duplicate legacy launch strategy", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow: ScriptFlowDocument = {
      ...document([
        { id: "launch-app", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
        { id: "open-growth", role: "business", tap: { target: { text: "成长" } } }
      ]),
      start: { strategy: "launchApp" }
    };

    await runner.start({
      ...previewBinding,
      flowId: "flow-explicit-launch",
      flow,
      deviceSerial: "device-1"
    });

    expect(backend.input?.startStrategy).toBe("keep_current");
    expect(backend.input?.steps?.map((step) => step.type)).toEqual(["launch_app", "tap_on_text"]);
    expect(backend.input?.steps?.[0]?.params).toMatchObject({ restartBeforeLaunch: true });
  });

  it("converts fixed delay wait script steps to backend wait actions", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-fixed-delay",
      flow: document([
        { id: "submit", tap: { target: { text: "提交" } } },
        { id: "wait-after-submit", wait: { durationMs: 3000 } },
        { id: "continue", tap: { target: { text: "继续" } } }
      ]),
      deviceSerial: "device-1"
    });

    expect(backend.input?.steps?.[1]).toEqual(expect.objectContaining({
      id: "wait-after-submit",
      type: "wait",
      title: "等待 3 秒",
      params: expect.objectContaining({
        durationMs: 3000,
        executionPhase: "business"
      })
    }));
    expect(backend.input?.steps?.[1]?.expectations).toBeUndefined();
  });

  it("passes the selected loop scope to the execution backend", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-loop-business",
      flow: document([
        { id: "prepare", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
        { id: "business", role: "business", tap: { target: { text: "成长" } } },
        { id: "reset", role: "reset", tap: { target: { text: "主页" } } }
      ]),
      deviceSerial: "device-1",
      mode: "loop_until_stop",
      loopScope: "exclude_preparation"
    });

    expect(backend.input?.mode).toBe("loop_until_stop");
    expect(backend.input?.loopScope).toBe("exclude_preparation");
  });

  it("rejects a business loop without reset steps or an explicit no-reset contract", async () => {
    const runner = runnerWith(new CapturingBackend());

    await expect(runner.start({
      ...previewBinding,
      flowId: "flow-open-note",
      flow: document([
        { id: "business", role: "business", tap: { target: { text: "笔记" } } }
      ]),
      deviceSerial: "device-1",
      mode: "loop_until_stop",
      loopScope: "exclude_preparation"
    })).rejects.toThrow(/每轮复位/);
  });

  it("allows a naturally closed business loop when no reset is explicitly declared", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = {
      ...document([{ id: "refresh", role: "business", tap: { target: { text: "刷新" } } }]),
      loop: { reset: "none" as const }
    };

    await runner.start({
      ...previewBinding,
      flowId: "flow-refresh",
      flow,
      deviceSerial: "device-1",
      mode: "loop_until_stop",
      loopScope: "exclude_preparation"
    });

    expect(backend.input?.loopScope).toBe("exclude_preparation");
  });

  it("includes observed OCR text when an expected page does not match", async () => {
    const profile: ExecutionProfileSnapshot = {
      id: "execution-profile:classin:android:graph-v1",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 1,
      status: "verified",
      digest: "profile-digest",
      createdAt: "2026-08-15T00:00:00.000Z",
      screens: []
    };
    const pageState: PageStateService = {
      identifyCurrentScreen: async () => ({ status: "unknown", candidates: [], reason: "page_not_matched" }),
      verifyExpectedScreen: async () => ({ status: "unknown", candidates: [], reason: "page_not_matched" }),
      waitForExpectedScreen: async () => ({
        status: "unknown",
        candidates: [{ id: "page-home", key: "classin.home", name: "主页", appId: "cn.eeo.classin", graphVersionId: "v1", matcherCount: 2 }],
        observation: {
          platform: "android",
          capturedAt: "2026-07-28T00:00:00.000Z",
          uiElements: [],
          ocrTexts: [{ text: "搜索" }, { text: "请输入搜索内容" }, { text: "搜索" }]
        },
        reason: "page_not_matched"
      })
    };
    const verifier = pageStateExpectationVerifier(pageState);

    await expect(verifier({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      screenRef: "classin.home",
      timeoutMs: 1,
      executionProfile: profile
    })).resolves.toMatchObject({
      status: "unknown",
      candidateNames: ["主页"],
      observedText: "搜索、请输入搜索内容",
      reason: "page_not_matched"
    });
  });

  it("uses the frozen profile when evaluating a screen contract", async () => {
    const profile: ExecutionProfileSnapshot = {
      id: "execution-profile:classin:android:graph-v1",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 1,
      status: "verified",
      digest: "profile-digest",
      createdAt: "2026-08-15T00:00:00.000Z",
      screens: []
    };
    const waitForExpectedScreen = vi.fn(async () => ({
      status: "matched" as const,
      candidates: [],
      screen: {
        id: "page-classes",
        key: "classin.teacher.classes",
        screenRef: "classin.teacher.classes",
        name: "班级列表",
        appId: "cn.eeo.classin",
        graphVersionId: "graph-v1",
        matcherCount: 2
      }
    }));
    const pageState = {
      identifyCurrentScreen: async () => ({ status: "unknown" as const, candidates: [] }),
      verifyExpectedScreen: async () => ({ status: "unknown" as const, candidates: [] }),
      waitForExpectedScreen
    } satisfies PageStateService;
    const verifier = pageStateExpectationVerifier(pageState);

    await expect(verifier({
      serial: "device-1",
      appId: "cn.eeo.classin",
      platform: "android",
      screenRef: "classin.teacher.classes",
      timeoutMs: 1,
      executionProfile: profile
    })).resolves.toMatchObject({
      status: "matched",
      pageName: "班级列表"
    });

    expect(waitForExpectedScreen).toHaveBeenCalledWith(expect.objectContaining({
      screenRef: "classin.teacher.classes",
      executionProfile: profile
    }));
  });

  it("compiles one business action with page precondition and result verification", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = document([
      {
        id: "open-class",
        name: "打开指定班级",
        before: { screenRef: "classin.home" },
        after: { screenRef: "classin.class.detail" },
        tap: { target: { text: "${className}" } }
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
        mode: "equals",
        scriptFlowId: "flow-1",
        scriptStepId: "open-class",
        locatorStrategy: "semantic_text"
      })
    }));
    expect(backend.input?.steps?.[0]).not.toHaveProperty("preconditions");
    expect(backend.input?.steps?.[0]).not.toHaveProperty("expectations");
  });

  it("enables Android app monitor by default for script execution", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-monitor-default",
      flow: document([{ id: "open-class", tap: { target: { text: "班级四十二号" } } }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.androidAppMonitor).toEqual({
      enabled: true,
      packageName: "cn.eeo.classin",
      includeSubprocesses: true
    });
  });

  it("keeps Android app monitor disabled when execution explicitly opts out", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-monitor-disabled",
      flow: document([{ id: "open-class", tap: { target: { text: "班级四十二号" } } }]),
      deviceSerial: "device-1",
      recordVideo: false,
      androidAppMonitor: {
        enabled: false,
        packageName: "",
        includeSubprocesses: true
      }
    });

    expect(backend.input?.androidAppMonitor).toEqual({
      enabled: false,
      packageName: "",
      includeSubprocesses: true
    });
  });

  it("defaults script scroll-until-visible steps without direction to downward scanning", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-find-conversation",
      flow: document([{
        id: "find-conversation",
        role: "business",
        scrollUntilVisible: {
          target: { text: "${conversationName}" }
        }
      }], {
        conversationName: { type: "string", required: true }
      }),
      deviceSerial: "device-1",
      parameters: { conversationName: "汉娜7812" },
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "find-conversation",
      type: "scroll_until_visible",
      params: expect.objectContaining({
        locator: { text: "汉娜7812" },
        direction: "down",
        maxSwipes: 5
      })
    }));
  });

  it("passes input text search policy through to runtime target resolution", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-input-message",
      flow: document([{
        id: "input-message",
        role: "business",
        inputText: {
          target: {
            control: "textField",
            area: "content",
            scopeText: "底部输入区域",
            ordinal: 1
          },
          value: "${messageText}",
          search: { mode: "visibleOnly" }
        }
      }], {
        messageText: { type: "string", required: true }
      }),
      deviceSerial: "device-1",
      parameters: { messageText: "123" },
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "input-message",
      type: "input_text_to_element",
      params: expect.objectContaining({
        text: "123",
        searchMode: "visibleOnly"
      })
    }));
    expect(backend.input?.steps?.[0]?.params).not.toHaveProperty("resetToTop");
    expect(backend.input?.steps?.[0]?.params).not.toHaveProperty("searchDirection");
  });

  it("does not block a generated action on an unresolved runtime-discovered expected page", async () => {
    const backend = new CapturingBackend();
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("harmony") },
      targetResolver: new ScriptTargetResolver()
    });

    await runner.start({
      ...previewBinding,
      flowId: "flow-runtime-unknown-target",
      flow: document([{
        id: "tap-create-public-lesson",
        after: { screenRef: "runtime.unknown.1u41ebp" },
        tap: { target: { text: "创建公开课" } }
      }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "tap-create-public-lesson",
      type: "tap_on_text",
      params: expect.objectContaining({
        text: "创建公开课"
      })
    }));
    expect(backend.input?.steps?.[0]?.expectations).toBeUndefined();
  });

  it("does not block a generated action on a confirmed runtime-discovered expected page", async () => {
    const backend = new CapturingBackend();
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("harmony") },
      targetResolver: new ScriptTargetResolver()
    });

    await runner.start({
      ...previewBinding,
      flowId: "flow-runtime-confirmed-target",
      flow: document([{
        id: "tap-create-public-lesson",
        after: { screenRef: "runtime.unknown.1u41ebp" },
        tap: { target: { text: "创建公开课" } }
      }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "tap-create-public-lesson",
      type: "tap_on_text",
      params: expect.objectContaining({
        text: "创建公开课"
      })
    }));
    expect(backend.input?.steps?.[0]?.expectations).toBeUndefined();
  });

  it("does not block a generated action on an unresolved runtime-discovered source page", async () => {
    const backend = new CapturingBackend();
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("harmony") },
      targetResolver: new ScriptTargetResolver()
    });

    await runner.start({
      ...previewBinding,
      flowId: "flow-runtime-unknown-source",
      flow: document([{
        id: "tap-publish",
        before: { screenRef: "runtime.unknown.1u41ebp" },
        tap: { target: { text: "发布" } }
      }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "tap-publish",
      type: "tap_on_text",
      params: expect.objectContaining({
        text: "发布"
      })
    }));
    expect(backend.input?.steps?.[0]?.preconditions).toBeUndefined();
  });

  it("ignores interaction assets and executes the script target as the only source of truth", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const asset = learnedInteractionAsset();

    await runner.start({
      ...previewBinding,
      flowId: "flow-learned",
      flow: document([{
        id: "open-add-friend",
        before: { screenRef: "classin.home" },
        tap: { target: { text: "进入添加好友页面", match: "semantic" } }
      }]),
      deviceSerial: "device-1",
      recordVideo: false,
      ...({ interactionAssets: [{ stepId: "open-add-friend", asset }] } as Record<string, unknown>)
    } as any);

    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      params: expect.objectContaining({
        text: "进入添加好友页面",
        locatorStrategy: "semantic_text"
      })
    }));
    expect(backend.input?.steps?.[0]?.params).not.toHaveProperty("interactionAssetId");
    expect(backend.input?.sourceSnapshot).not.toHaveProperty("interactionAssets");
  });

  it("keeps waitForPage as one non-asset report step", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow: document([{ id: "wait-home", waitForPage: { screenRef: "classin.home" }, timeoutMs: 5000 }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps).toHaveLength(1);
    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "wait-home",
      type: "wait",
    }));
    expect(backend.input?.steps?.[0]).not.toHaveProperty("expectations");
  });

  it("executes assertText as one blocking OCR result assertion", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-assert-text",
      flow: document([{
        id: "verify-teaching-plan",
        name: "确认进入教学方案页",
        timeoutMs: 6000,
        assertText: { text: "教学方案列表", match: "exact" }
      }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps).toHaveLength(1);
    expect(backend.input?.steps?.[0]).toEqual(expect.objectContaining({
      id: "verify-teaching-plan",
      type: "wait",
      title: "确认进入教学方案页",
      params: expect.objectContaining({ durationMs: 0, locatorStrategy: "ocr_text_assertion" }),
      expectations: [expect.objectContaining({
        type: "text",
        params: expect.objectContaining({
          expected: "教学方案列表",
          mode: "equals",
          source: "ocr",
          blocking: true,
          timeoutMs: 6000
        })
      })]
    }));
  });

  it("rejects reachPage instead of compiling it into profile navigation", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await expect(runner.start({
      ...previewBinding,
      flowId: "flow-reach-home",
      flow: document([{ id: "reach-home", name: "到达主页", reachPage: { screenRef: "classin.home", policy: "safe" } }]),
      deviceSerial: "device-1",
      recordVideo: false
    })).rejects.toThrow(/reachPage is no longer supported/);

    expect(backend.input).toBeUndefined();
  });

  it("does not compile entry metadata into a hidden preparation step", async () => {
    const backend = new CapturingBackend();
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("android") },
      targetResolver: new ScriptTargetResolver()
    });
    const flow: ScriptFlowDocument = {
      ...document([{ id: "verify-home", assertPage: { screenRef: "classin.home" } }]),
      entry: { screenRef: "classin.home", session: "authenticated", role: "teacher" }
    };

    await runner.start({
      ...previewBinding,
      navigationRootPages: ["classin.home", "classin.login"],
      flowId: "flow-entry-home",
      flow,
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps).toEqual([expect.objectContaining({ id: "verify-home", type: "wait" })]);
    expect(backend.input?.steps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reach_page" })
    ]));
  });

  it("ignores deprecated navigation segments for explicit actions", async () => {
    const backend = new CapturingBackend();
    const catalog = new NavigationCatalog();
    const runner = new ScriptFlowRunner({
      backend,
      driver: { getDeviceInfo: async () => device("android") },
      targetResolver: new ScriptTargetResolver()
    });
    await runner.start({
      ...previewBinding,
      navigationSegments: [{
        id: "navigation:flow-detail-home:3:1",
        appId: "cn.eeo.classin",
        platform: "android",
        fromPage: "classin.detail",
        toPage: "classin.home",
        flowId: "flow-detail-home",
        flowVersion: 3,
        flowName: "详情返回主页",
        parameters: {},
        stepIds: ["open-menu", "open-home-tab"],
        steps: [
          {
            id: "open-menu",
            before: { screenRef: "classin.detail" },
            tap: { target: { text: "更多" }, search: { mode: "visibleOnly" } }
          },
          {
            id: "open-home-tab",
            tap: { target: { text: "主页", area: "bottomBar" }, search: { mode: "visibleOnly" } },
            after: { screenRef: "classin.home" }
          }
        ]
      }],
      flowId: "flow-reach-home",
      flow: document([{ id: "open-home", tap: { target: { text: "主页" } } }]),
      deviceSerial: "device-1",
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]?.params).not.toHaveProperty("navigationEdges");
  });

  it("uses typed run parameters without blocking on risk metadata", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);
    const flow = document([
      { id: "publish-primary", tap: { target: { text: "发布" } } },
      { id: "publish-copy", tap: { target: { text: "再次发布" } } }
    ], {
      lessonName: { type: "string", required: true }
    });

    await runner.start({
      ...previewBinding,
      flowId: "flow-1",
      flow,
      deviceSerial: "device-1",
      parameters: { lessonName: "本次课堂" },
      recordVideo: false
    });
    expect(backend.input?.steps?.[0]?.params.scriptParameters).toEqual({ lessonName: "本次课堂" });
  });

  it("interprets a cross-platform script with the selected HarmonyOS device runtime bundle id", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend, "harmony");

    await runner.start({
      ...previewBinding,
      flowId: "flow-harmony",
      flow: {
        ...document([{ id: "launch", launchApp: { appId: "classin" } }]),
        app: { id: "classin" }
      },
      deviceSerial: "HARMONY",
      env: { CLASSIN_HARMONY_BUNDLE_ID: "cn.eeo.hos.classin.mobile" }
    });

    expect(backend.input?.startAppPackageName).toBe("cn.eeo.hos.classin.mobile");
    expect(backend.input?.steps?.[0]?.params.packageName).toBe("cn.eeo.hos.classin.mobile");
  });

  it("executes sensitive values in memory but sends redacted steps to persistence", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-sensitive",
      flow: document([{
        id: "password",
        inputText: { target: { text: "密码" }, value: "${password}" }
      }], {
        password: { type: "string", required: true, sensitive: true }
      }),
      deviceSerial: "device-1",
      parameters: { password: "top-secret" },
      recordVideo: false
    });

    expect(backend.input?.steps?.[0]?.params.text).toBe("top-secret");
    expect(backend.input?.steps?.[0]?.params.valueParamKey).toBe("password");
    expect(backend.input?.steps?.[0]?.params.sensitiveInput).toBe(true);
    expect(backend.input?.persistedSteps?.[0]?.params.text).toBe("[REDACTED]");
    expect(backend.input?.persistedSteps?.[0]?.params.valueParamKey).toBe("password");
    expect(backend.input?.persistedSteps?.[0]?.params.sensitiveInput).toBe(true);
    expect(JSON.stringify(backend.input?.persistedSteps)).not.toContain("top-secret");
  });

  it("redacts sensitive scalar fields without corrupting step structure", async () => {
    const backend = new CapturingBackend();
    const runner = runnerWith(backend);

    await runner.start({
      ...previewBinding,
      flowId: "flow-sensitive-scalars",
      flow: document([
        { id: "step-1", inputText: { target: { text: "短码" }, value: "${token}" } },
        { id: "step-number", inputText: { target: { text: "数字" }, value: "${pin}" } },
        { id: "step-boolean", inputText: { target: { text: "开关" }, value: "${enabled}" } }
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
          inputText: { target: { text: "密码" }, value: "${password}" }
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

const previewBinding = { planDigest: "a".repeat(64), dependencies: [], navigationSegments: [] };

function runnerWith(backend: CapturingBackend, platform: DeviceInfo["platform"] = "android"): ScriptFlowRunner {
  return new ScriptFlowRunner({
    backend,
    driver: {
      getDeviceInfo: async () => device(platform)
    },
    targetResolver: new ScriptTargetResolver()
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
  resolvePage(_reference: string, _appId: string, _platform: "android" | "ios" | "harmony" | "flutter"): ReturnType<PageAssetCatalog["resolvePage"]> { return undefined; }
  findConfusablePages(): PageAssetSummary[] { return []; }
}

class NavigationCatalog extends EmptyCatalog {
  override resolvePage(reference: string, _appId: string, _platform: "android" | "ios" | "harmony" | "flutter"): ReturnType<PageAssetCatalog["resolvePage"]> {
    const pages = [
      { id: "page-home", key: "classin.home", name: "主页" },
      { id: "page-login", key: "classin.login", name: "登录" },
      { id: "page-detail", key: "classin.detail", name: "详情" }
    ];
    const page = pages.find((candidate) => candidate.id === reference || candidate.key === reference || candidate.name === reference);
    return page ? {
      ...page,
      appId: "cn.eeo.classin",
      graphVersionId: "v1",
      matcherCount: 1,
      node: {} as never
    } : undefined;
  }
}

class RuntimeUnknownCatalog extends EmptyCatalog {
  override resolvePage(reference: string, _appId: string, _platform: "android" | "ios" | "harmony" | "flutter"): ReturnType<PageAssetCatalog["resolvePage"]> {
    if (reference !== "runtime.unknown.1u41ebp") {
      return undefined;
    }
    return {
      id: "node-runtime-public-lesson",
      key: "runtime.unknown.1u41ebp",
      name: "新建公开课",
      appId: "classin",
      graphVersionId: "v1",
      platformScope: "mobile-both",
      matcherCount: 6,
      node: {} as never
    };
  }
}

function document(
  steps: ScriptFlowDocument["steps"],
  parameters: ScriptFlowDocument["parameters"] = {}
): ScriptFlowDocument {
  return {
    version: 1,
    kind: "case",
    name: "创建课堂",
    app: { id: "cn.eeo.classin" },
    start: { strategy: "keepCurrent" },
    parameters,
    steps,
    tags: []
  };
}

function learnedInteractionAsset(): InteractionAsset {
  return {
    id: "asset-add-friend",
    key: "classin.home.tap.add-friend",
    appId: "cn.eeo.classin",
    platformScope: "android",
    owner: { kind: "page", key: "classin.home" },
    name: "添加好友",
    aliases: ["添加好友"],
    supportedActions: ["tap"],
    semanticContract: { semantic: "进入添加好友页面" },
    locatorVariants: [{
      platform: "android",
      strategy: "ocr_text",
      descriptor: { selectedText: "添加好友" },
      confidence: 0.95
    }],
    status: "active",
    version: 2,
    provenance: { runIds: ["run-trial"], stepIds: ["open-add-friend"], artifactIds: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
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
