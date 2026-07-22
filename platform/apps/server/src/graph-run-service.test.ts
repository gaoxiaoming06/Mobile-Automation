import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionPolicy, BusinessNode, StateMatcher } from "@mobile-automation/graph-core";
import type {
  ActionStep,
  AndroidAppMonitorConfig,
  AndroidAppMonitorIncident,
  AndroidProcessLifecycleEvent,
  AndroidProcessMetricSample,
  DeviceActionRequest,
  StepExpectation
} from "@mobile-automation/shared";
import { MockDriver, type MockVideoRecording } from "@mobile-automation/test-support";
import type { MobileAppMonitorSession } from "./mobile-driver.js";
import type { OcrInput, OcrLayoutResult, OcrResult, OcrService } from "./ocr.js";

let context: { storage: any; tempRoot: string } | undefined;

afterEach(async () => {
  context?.storage.close();
  const tempRoot = context?.tempRoot;
  context = undefined;
  delete process.env.DATA_DIR;
  vi.resetModules();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("grid candidate recovery action", () => {
  it("does not switch candidate indexes for deprecated grid candidates without a semantic target", async () => {
    const { actionWithGridCandidateAttempt } = await import("./graph-run-service.js");
    const action = {
      id: "step-grid",
      order: 1,
      type: "tap_on_image",
      enabled: true,
      title: "点击：班级列表",
      params: {
        abilityType: "grid_candidate",
        candidateIndex: 0,
        maxCandidateAttempts: 3,
        region: { x: 3, y: 32, width: 91, height: 56 }
      },
      createdAt: "2026-06-22T00:00:00.000Z"
    } as ActionStep;

    expect(actionWithGridCandidateAttempt(action, undefined).params.candidateIndex).toBe(0);
    expect(actionWithGridCandidateAttempt(action, 1).params.candidateIndex).toBe(0);
    expect(actionWithGridCandidateAttempt(action, 8).params.candidateIndex).toBe(0);
  });

  it("does not switch candidates for parameterized grid targets", async () => {
    const { actionWithGridCandidateAttempt } = await import("./graph-run-service.js");
    const action = {
      id: "step-grid",
      order: 1,
      type: "tap_on_image",
      enabled: true,
      title: "点击：班级列表",
      params: {
        abilityType: "grid_candidate",
        candidateIndex: 0,
        maxCandidateAttempts: 3,
        region: { x: 3, y: 32, width: 91, height: 56 },
        scrollProfile: {
          containerKind: "grid_list",
          targetKind: "item_text",
          targetQuery: "班级四十二号"
        }
      },
      createdAt: "2026-06-22T00:00:00.000Z"
    } as ActionStep;

    expect(actionWithGridCandidateAttempt(action, 2).params.candidateIndex).toBe(0);
  });
});

describe("GraphRunService", () => {
  it("uses the runner-provided node match when evaluating state_is expectations", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("其它页面"));
    const graph = storage.createBusinessGraph({
      appId: "demo-app",
      targetApp: { androidPackageName: "com.demo" },
      platformScope: "android",
      name: "Demo 图谱",
      status: "draft"
    });
    const version = storage.createBusinessGraphVersion({
      graphId: graph.id,
      sourceSummary: ["test"],
      status: "draft"
    });
    const expectedNode = storage.createBusinessNode(node(version.id, "target", "目标页", [matcher("text", "目标页", 2)], []));
    const staleObservation = {
      id: "observation-stale",
      platform: "android",
      capturedAt: "2026-06-11T00:00:00.000Z",
      packageName: "com.demo",
      activityName: "com.demo.OtherActivity",
      componentName: "com.demo/com.demo.OtherActivity",
      resolution: { width: 1080, height: 2400 },
      uiElements: [],
      ocrTexts: [{ text: "其它页面", source: "ocr", region: { x: 10, y: 10, width: 100, height: 40 } }],
      raw: {
        screenshotBase64: Buffer.from("not-png").toString("base64")
      }
    };
    const providedNodeMatch = {
      status: "matched",
      observationId: staleObservation.id,
      capturedAt: staleObservation.capturedAt,
      node: expectedNode,
      score: 1,
      candidates: [],
      threshold: 0.6
    };

    const result = await (service as any).evaluateStateIsExpectation(
      {
        expectation: textExpectation("expect-target-state", "目标页", {
          nodeId: expectedNode.id,
          nodeKey: expectedNode.key,
          nodeName: expectedNode.name
        }),
        phase: "expectation",
        step: {
          id: "execution-step",
          order: 1,
          edgeId: "edge",
          edgeKey: "edge",
          name: "edge",
          intent: "edge",
          fromNode: expectedNode,
          toNode: expectedNode,
          action: tapOnElementStep(),
          preconditions: [],
          expectations: [],
          systemGuards: [],
          fallbackActionPolicies: [],
          issues: [],
          executionMode: "action"
        },
        observation: staleObservation,
        nodeMatch: providedNodeMatch
      },
      { ...version, nodes: [expectedNode], edges: [] }
    );

    expect(result.status).toBe("passed");
    expect(result.actual).toContain("Matched 目标页");
  });

  it("matches the preferred business node before loading unrelated visual baselines", async () => {
    context = await createContext();
    const { storage, tempRoot } = context;
    const driver = new GraphMockDriver(tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const baseline = pgm(2, 2, [0, 0, 0, 0]);
    const relativePath = path.join("baselines", "unrelated.pgm");
    const absolutePath = path.join(tempRoot, "artifacts", relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, baseline);
    storage.addArtifact({
      id: "artifact-unrelated",
      type: "screenshot",
      name: "unrelated.pgm",
      path: relativePath,
      url: `/artifacts/${relativePath}`,
      mimeType: "image/x-portable-graymap",
      sizeBytes: baseline.byteLength,
      createdAt: "2026-06-11T00:00:00.000Z"
    });
    const targetMatchers = [matcher("package", "com.demo", 2), matcher("text", "目标页", 2), matcher("ocr_text", "目标页", 2)].map((item) => ({
      ...item,
      critical: true
    }));
    const target = {
      ...node("version-1", "target", "目标页", targetMatchers, [], ["page-asset", "asset-recording"]),
      id: "node-target"
    } as BusinessNode;
    target.metadata = { assetRecordingConfirmed: true };
    const unrelated = {
      ...node(
        "version-1",
        "unrelated",
        "无关页",
        [
          {
            ...matcher("image_region", "screenshot-region:unrelated:%E6%97%A0%E5%85%B3", 9),
            critical: true,
            threshold: 0.9,
            region: { x: 0, y: 0, width: 100, height: 100 },
            source: { sourceType: "manual_edit", artifactId: "artifact-unrelated" }
          }
        ],
        [],
        ["page-asset", "asset-recording"]
      ),
      id: "node-unrelated"
    } as BusinessNode;
    unrelated.metadata = { assetRecordingConfirmed: true };
    const getArtifactSpy = vi.spyOn(storage, "getArtifact");

    const match = await (service as any).matchBusinessNode(
      {
        id: "observation-target",
        platform: "android",
        capturedAt: "2026-06-11T00:00:00.000Z",
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity",
        resolution: { width: 2, height: 2 },
        uiElements: [{ text: "目标页", visible: true, enabled: true }],
        ocrTexts: [{ text: "目标页", source: "ocr" }],
        raw: { screenshotBase64: baseline.toString("base64") }
      },
      {
        id: "version-1",
        graphId: "graph-1",
        version: 1,
        sourceSummary: [],
        status: "active",
        nodes: [target, unrelated],
        edges: [],
        createdAt: "2026-06-11T00:00:00.000Z"
      },
      "android",
      target.id
    );

    expect(match.status).toBe("matched");
    expect(match.node?.id).toBe(target.id);
    expect(getArtifactSpy).not.toHaveBeenCalled();
  });

  it("executes a target-node route on a real driver adapter and writes legacy run evidence", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new VisualGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => (driver.actions.some((action) => action.type === "tap") ? "目标页" : "首页")));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    expect(started.run.status).toBe("running");
    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; errorCode?: string; errorMessage?: string }) => ({
          status: step.status,
          errorCode: step.errorCode,
          errorMessage: step.errorMessage
        })),
        events: run.events
      })
    ).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 400 }]);
    expect(run.stepResults).toHaveLength(1);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "passed",
        type: "tap_on_element",
        metadata: expect.objectContaining({
          actionBackend: expect.objectContaining({
            driverChannel: "mock"
          }),
          graph: expect.objectContaining({
            edgeKey: "home.to.target",
            fromNodeName: "首页",
            toNodeName: "目标页"
          })
        })
      })
    );
    expect(run.artifacts.some((artifact: { type: string }) => artifact.type === "screenshot")).toBe(true);
    expect(run.artifacts.some((artifact: { name: string }) => artifact.name === "graph-execution-result.json")).toBe(true);
    expect(run.reportHtmlPath).toBe("runs/" + started.run.id + "/reports/report.html");
  });

  it("starts android app monitor for graph runs and writes incident summary artifacts before report", async () => {
    context = await createContext();
    const { storage } = context;
    const incident: AndroidAppMonitorIncident = {
      id: "incident-graph-1",
      type: "memory_threshold",
      severity: "warning",
      occurredAt: "2026-06-09T00:00:01.000Z",
      processName: "com.demo",
      pid: 123,
      summary: "Memory threshold breached: com.demo",
      detail: "pss exceeded",
      artifactIds: [],
      metadata: { value: 512, threshold: 256 }
    };
    const driver = new GraphAppMonitorMockDriver(context.tempRoot, { incidents: [incident] });
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => (driver.actions.some((action) => action.type === "tap") ? "目标页" : "首页")));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo"
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });
    const run = storage.getRun(started.run.id);

    expect(driver.monitorStarts).toEqual([
      expect.objectContaining({
        serial: driver.device.serial,
        runId: started.run.id,
        config: expect.objectContaining({ packageName: "com.demo" })
      })
    ]);
    expect(driver.monitorStopCount).toBe(1);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "performance_threshold", severity: "warning", summary: expect.stringContaining("Memory threshold breached") }),
        expect.objectContaining({ type: "android_app_monitor", artifactIds: expect.arrayContaining([expect.any(String)]) })
      ])
    );
    expect(run.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-cpu.csv" }),
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-memory.csv" }),
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-lifecycle.csv" }),
        expect.objectContaining({ type: "report_json", name: "android-app-monitor-summary.json" }),
        expect.objectContaining({ type: "report_html", name: "report.html" })
      ])
    );
  });

  it("does not execute graph startStrategy actions when android app monitor reports a crash during start", async () => {
    context = await createContext();
    const { storage } = context;
    const incident: AndroidAppMonitorIncident = {
      id: "incident-graph-crash",
      type: "java_crash",
      severity: "error",
      occurredAt: "2026-06-09T00:00:01.000Z",
      processName: "com.demo",
      pid: 123,
      summary: "Java crash detected",
      detail: "FATAL EXCEPTION",
      artifactIds: [],
      metadata: { watcherEventType: "crash" }
    };
    const driver = new GraphAppMonitorMockDriver(context.tempRoot, { incidents: [incident] });
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => "首页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "launch_app",
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo"
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });
    const run = storage.getRun(started.run.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(driver.monitorStopCount).toBe(1);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "crash",
          severity: "error",
          summary: expect.stringContaining("Java crash detected"),
          detail: expect.stringContaining("\"processName\":\"com.demo\"")
        })
      ])
    );
  });

  it("starts target-node execution from the matched page asset instead of a legacy recording node", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => "首页"));
    const { graph, targetNode, pageAssetNode } = seedPageAssetStartGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });
    const routePlan = storage.getRoutePlan(started.routePlanId);

    expect(routePlan?.startNodeId).toBe(pageAssetNode.id);
    expect(routePlan?.edges.map((item: { edge: { key: string } }) => item.edge.key)).toEqual(["page-asset-home.to.target"]);
  });

  it("uses fast visual execution without Android UI hierarchy collection", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new CountingGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedFastVisualGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; errorCode?: string; errorMessage?: string }) => ({
          status: step.status,
          errorCode: step.errorCode,
          errorMessage: step.errorMessage
        })),
        events: run.events
      })
    ).toBe("passed");
    expect(driver.dumpUiHierarchyCalls).toBe(0);
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 360 }]);
    expect(run.config.recordVideo).toBe(false);
    expect(run.config.keepVideoOnSuccess).toBe(false);
    expect(run.stepResults[0]?.metadata.graph.observationProfile).toBe("fast_visual");
  });

  it("does not block fast visual page-state execution on duplicated edge preconditions", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new CountingGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedFastVisualGraph(storage, {
      edgePreconditions: [
        {
          id: "stale-source-node-precondition",
          type: "state_is",
          enabled: true,
          title: "旧节点前置状态",
          params: {
            nodeId: "node-from-previous-graph-version",
            nodeKey: "home",
            nodeName: "首页"
          },
          createdAt: "2026-06-20T00:00:00.000Z"
        }
      ]
    });

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; errorCode?: string; errorMessage?: string }) => ({
          status: step.status,
          errorCode: step.errorCode,
          errorMessage: step.errorMessage
        })),
        events: run.events
      })
    ).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 360 }]);
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "expect-target-state",
          status: "passed"
        })
      ])
    );
    expect(run.stepResults[0]?.expectationResults).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "stale-source-node-precondition"
        })
      ])
    );
  });

  it("appends and executes the selected page task after reaching the target page", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new PageTaskGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new LessonFormOcrService(() => driver.currentText));
    const { graph, targetNode } = seedPageTaskGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        targetNodeId: targetNode.id,
        targetTaskId: "task-create-lesson",
        runtimeParams: {
          lessonName: "自动化课堂"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 240, y: 360 },
      { type: "tap", x: 432, y: 576 },
      { type: "clear_text" },
      { type: "input_text", text: "自动化课堂" },
      { type: "tap", x: 891, y: 2256 }
    ]);
    expect(run.steps.map((step: ActionStep) => step.title)).toEqual(["快速视觉进入新建课堂", "创建课堂：课堂标题", "创建课堂：发布"]);
    expect(run.steps[1]?.params).toEqual(
      expect.objectContaining({
        quality: expect.objectContaining({
          status: "pass",
          score: 0.88
        }),
        visualLocator: expect.objectContaining({
          minScore: 0.72,
          targetRole: "input"
        })
      })
    );
    expect(run.stepResults.map((stepResult: { status: string }) => stepResult.status)).toEqual(["passed", "passed", "passed"]);
    expect(run.stepResults[1]?.metadata.graph.runtimeOverlay).toEqual(
      expect.objectContaining({
        pageTaskId: "task-create-lesson",
        pageTaskName: "创建课堂",
        runtimeParamKeys: ["lessonName"]
      })
    );
    expect(run.stepResults[1]?.metadata.semantic).toEqual(
      expect.objectContaining({
        resolvedBy: "image_region",
        textLength: 5
      })
    );
  });

  it("expands a task navigation edge into source page task steps before validating the target page", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new LoginTaskGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new LoginFormOcrService(() => driver.loginSnapshot()));
    const { graph, targetNode } = seedLoginTaskNavigationGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        runtimeParams: {
          phone: "18743085313",
          password: "secret"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; type: string; errorCode?: string; metadata?: any }) => ({
          status: step.status,
          type: step.type,
          errorCode: step.errorCode,
          graph: step.metadata?.graph
        })),
        events: run.events
      }, null, 2)
    ).toBe("passed");
    expect(driver.actions).not.toContainEqual({ type: "tap", x: 97, y: 1620 });
    expect(driver.actions).toEqual([
      { type: "tap", x: 540, y: 1392 },
      { type: "clear_text" },
      { type: "input_text", text: "18743085313" },
      { type: "tap", x: 540, y: 1522 },
      { type: "clear_text" },
      { type: "input_text", text: "secret" },
      { type: "tap", x: 540, y: 1224 }
    ]);
    expect(run.steps.map((step: ActionStep) => step.title)).toEqual([
      "账号密码登录：手机号输入框",
      "账号密码登录：密码输入框",
      "账号密码登录：协议勾选",
      "账号密码登录：登录按钮"
    ]);
    expect(run.steps.map((step: ActionStep) => step.params.locator)).toEqual([
      "runtime-locator:phone_or_email_input",
      "runtime-locator:password_input",
      "runtime-locator:agreement_checkbox",
      "runtime-locator:primary_login_button"
    ]);
    expect(run.steps.every((step: ActionStep) => step.params.coordinateSpace === "runtime")).toBe(true);
    expect(run.stepResults.at(-1)?.metadata.graph).toEqual(
      expect.objectContaining({
        edgeKey: expect.stringContaining("login.task.to.home"),
        fromNodeName: "登录",
        toNodeName: "主页"
      })
    );
  }, 15000);

  it("expands runtime structural page task elements into runtime semantic steps", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new LoginTaskGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new LoginFormOcrService(() => driver.loginSnapshot()));
    const { graph, targetNode } = seedLoginTaskNavigationGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        runtimeParams: {
          phone: "18743085313",
          password: "secret"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; type: string; errorCode?: string; metadata?: any }) => ({
          status: step.status,
          type: step.type,
          errorCode: step.errorCode,
          graph: step.metadata?.graph
        })),
        events: run.events
      }, null, 2)
    ).toBe("passed");
    expect(run.steps.map((step: ActionStep) => ({ type: step.type, title: step.title, params: step.params }))).toEqual([
      expect.objectContaining({
        type: "input_text_to_element",
        title: "账号密码登录：手机号输入框",
        params: expect.objectContaining({
          locator: "runtime-locator:phone_or_email_input",
          locatorKind: "structural_locator",
          structuralLocator: expect.objectContaining({ role: "phone_or_email_input" })
        })
      }),
      expect.objectContaining({
        type: "input_text_to_element",
        title: "账号密码登录：密码输入框",
        params: expect.objectContaining({
          locator: "runtime-locator:password_input",
          locatorKind: "structural_locator",
          structuralLocator: expect.objectContaining({ role: "password_input" })
        })
      }),
      expect.objectContaining({
        type: "tap_on_image",
        title: "账号密码登录：协议勾选",
        params: expect.objectContaining({
          locator: "runtime-locator:agreement_checkbox",
          locatorKind: "structural_locator",
          structuralLocator: expect.objectContaining({ role: "checkbox" })
        })
      }),
      expect.objectContaining({
        type: "tap_on_image",
        title: "账号密码登录：登录按钮",
        params: expect.objectContaining({
          locator: "runtime-locator:primary_login_button",
          locatorKind: "structural_locator",
          targetText: "登录",
          structuralLocator: expect.objectContaining({ role: "primary_button" })
        })
      })
    ]);
  }, 15000);

  it("fails an appended target page task when its navigation target is not reached", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new LoginSubmitStaysOnPageMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new LoginFormOcrService(() => driver.loginSnapshot()));
    const { graph, loginNode } = seedLoginTaskNavigationGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: loginNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        targetNodeId: loginNode.id,
        targetTaskId: "task-account-password-login",
        runtimeParams: {
          phone: "18743085313",
          password: "secret"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.steps.at(-1)?.expectations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "expect-home-state"
        })
      ])
    );
    expect(run.status).toBe("failed");
    expect(run.stepResults.at(-1)).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "TO_NODE_NOT_REACHED",
        metadata: expect.objectContaining({
          graph: expect.objectContaining({
            fromNodeName: "登录",
            toNodeName: "主页"
          })
        })
      })
    );
  }, 15000);

  it("executes picker and toggle target page task steps as visual form overrides", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new PageTaskGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedPageTaskGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        targetNodeId: targetNode.id,
        targetTaskId: "task-fill-lesson-form",
        runtimeParams: {
          duration: "45分钟",
          recordClassroom: "on"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 240, y: 360 },
      { type: "tap", x: 810, y: 744 },
      { type: "tap", x: 240, y: 360 },
      { type: "tap", x: 240, y: 240 },
      { type: "tap", x: 918, y: 1092 }
    ]);
    expect(run.steps.map((step: ActionStep) => step.title)).toEqual([
      "快速视觉进入新建课堂",
      "填写课堂表单：课堂时长",
      "填写课堂表单：录制ClassIn教室"
    ]);
    expect(run.steps.slice(1).map((step: ActionStep) => step.params)).toEqual([
      expect.objectContaining({
        fieldType: "picker_select",
        selectedValue: "45分钟",
        valueParamKey: "duration",
        elementLabel: "课堂时长"
      }),
      expect.objectContaining({
        fieldType: "toggle_set",
        desiredState: "on",
        desiredStateParamKey: "recordClassroom",
        elementLabel: "录制ClassIn教室"
      })
    ]);
    expect(run.stepResults.slice(1).map((stepResult: { metadata: { semantic?: Record<string, unknown> } }) => stepResult.metadata.semantic)).toEqual([
      expect.objectContaining({ action: "picker_select", fieldType: "picker_select", selectedValue: "45分钟", confirmedBy: "确定" }),
      expect.objectContaining({ action: "toggle_set", fieldType: "toggle_set", desiredState: "on" })
    ]);
  });

  it("skips optional target page task steps whose runtime params are not provided", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new PageTaskGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedPageTaskGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        targetNodeId: targetNode.id,
        targetTaskId: "task-fill-lesson-form",
        runtimeParams: {
          recordClassroom: "on"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 240, y: 360 },
      { type: "tap", x: 918, y: 1092 }
    ]);
    expect(run.steps.map((step: ActionStep) => step.title)).toEqual([
      "快速视觉进入新建课堂",
      "填写课堂表单：录制ClassIn教室"
    ]);
  });

  it("bootstraps the target app before planning when the device starts outside the app", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new OutsideAppGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.setupActions).toEqual([{ type: "launch_app", packageName: "com.demo" }]);
    expect(driver.actions).toEqual([
      { type: "launch_app", packageName: "com.demo" },
      { type: "tap", x: 240, y: 400 }
    ]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "info",
          summary: "Graph run bootstrapped target app before route planning",
          detail: expect.stringContaining('"reason":"outside_target_app"')
        })
      ])
    );
    expect(run.stepResults).toHaveLength(1);
    expect(run.stepResults[0]?.metadata.graph).toEqual(
      expect.objectContaining({
        fromNodeName: "首页",
        toNodeName: "目标页"
      })
    );
  });

  it("prefers an explicit start app package when restarting before graph execution", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页"));
    const { graph, targetNode } = seedGraph(storage);
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    const homeNode = activeVersion.nodes.find((item: BusinessNode) => item.key === "home");
    expect(homeNode).toBeTruthy();

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startNodeId: homeNode!.id,
      platform: "android",
      startStrategy: "restart_app",
      startAppPackageName: "com.override",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.config.startAppPackageName).toBe("com.override");
    expect(driver.actions.slice(0, 2)).toEqual([
      { type: "close_app", packageName: "com.override" },
      { type: "launch_app", packageName: "com.override" }
    ]);
  }, 15000);

  it("detects the real page after restart instead of trusting a synthetic root start node", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new VisualGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页"));
    const { graph } = seedVisualRestartGraph(storage);
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    const rootNode = activeVersion.nodes.find((item: BusinessNode) => item.key === "root");
    const homeNode = activeVersion.nodes.find((item: BusinessNode) => item.key === "home");
    expect(rootNode).toBeTruthy();
    expect(homeNode).toBeTruthy();

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: homeNode!.id,
      startNodeId: rootNode!.id,
      platform: "android",
      startStrategy: "restart_app",
      startAppPackageName: "com.demo",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(
      run.status,
      JSON.stringify({
        actions: driver.actions,
        stepResults: run.stepResults.map((step: { status: string; type: string; errorCode?: string; metadata?: any }) => ({
          status: step.status,
          type: step.type,
          errorCode: step.errorCode,
          graph: step.metadata?.graph
        })),
        events: run.events
      }, null, 2)
    ).toBe("passed");
    expect(driver.actions.slice(0, 2)).toEqual([
      { type: "close_app", packageName: "com.demo" },
      { type: "launch_app", packageName: "com.demo" }
    ]);
    expect(driver.actions).toHaveLength(2);
    expect(run.stepResults).toHaveLength(1);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "passed",
        type: "wait",
        metadata: expect.objectContaining({
          graph: expect.objectContaining({
            edgeKey: "target.validation",
            fromNodeName: "首页",
            toNodeName: "首页"
          })
        })
      })
    );
  });

  it("can start from the current foreground package when the page visually matches the graph", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new CurrentDevicePackageGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      startAppScope: "current_device"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 400 }]);
    expect(driver.actions.some((action) => action.type === "launch_app")).toBe(false);
  });

  it("backs out of a recognized but unreachable transient page before planning to the target", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new SearchPageGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    const homeNode = activeVersion.nodes.find((item: BusinessNode) => item.key === "home");
    storage.createBusinessNode(
      node(
        activeVersion.id,
        "search",
        "搜索",
        [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/search_title", 3), matcher("text", "搜索", 2)],
        [textExpectation("search-visible", "搜索")],
        ["start:back_recoverable"]
      )
    );

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    const routePlan = storage.getRoutePlan(started.routePlanId);
    expect(run.status).toBe("passed");
    expect(routePlan?.startNodeId).toBe(homeNode.id);
    expect(driver.actions.map((action) => action.type)).toEqual(["back", "tap"]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "info",
          summary: "Graph run backed out of an unreachable start page before route planning",
          detail: expect.stringContaining('"fromNodeName":"搜索"')
        })
      ])
    );
  });

  it("records an unknown app state reason before bootstrap when the target app is foreground but no graph node matches", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new UnknownAppStateGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "info",
          detail: expect.stringContaining('"reason":"unknown_app_state"')
        })
      ])
    );
    expect(driver.setupActions).toEqual([{ type: "launch_app", packageName: "com.demo" }]);
  });

  it("blocks instead of executing a root route when bootstrap still cannot recognize a graph start node", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new UnrecoverableUnknownAppStateGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([{ type: "launch_app", packageName: "com.demo" }]);
    expect(run.stepResults).toHaveLength(0);
    const candidateArtifact = run.artifacts.find((artifact: { name: string }) => artifact.name.startsWith("runtime-unknown-node-candidate-"));
    expect(candidateArtifact).toBeTruthy();
    const candidateJson = JSON.parse(await readFile(path.join(context.tempRoot, "artifacts", candidateArtifact.path), "utf8"));
    expect(candidateJson).toEqual(
      expect.objectContaining({
        status: "draft",
        platformScope: "android",
        matchers: expect.arrayContaining([
          expect.objectContaining({ type: "package", value: "com.demo" }),
          expect.objectContaining({ type: "activity", value: "com.demo.UnknownActivity" }),
          expect.objectContaining({ type: "text", value: "未知页面" })
        ]),
        metadata: expect.objectContaining({
          source: "runtime_unknown_state"
        })
      })
    );
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    const targetEdge = activeVersion.edges.find((edge: { source: string; status: string; toNodeId: string }) => edge.source === "exploration" && edge.status === "draft" && edge.toNodeId === targetNode.id);
    expect(activeVersion.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: candidateJson.key,
          name: candidateJson.name,
          status: "draft",
          metadata: expect.objectContaining({
            source: "runtime_unknown_state",
            artifactId: candidateArtifact.id
          })
        })
      ])
    );
    expect(targetEdge).toEqual(
      expect.objectContaining({
        fromNodeId: activeVersion.nodes.find((node: BusinessNode) => node.key === candidateJson.key)?.id,
        toNodeId: targetNode.id,
        status: "draft",
        source: "exploration",
        actionPolicies: [
          expect.objectContaining({
            action: expect.objectContaining({
              type: "tap_on_element",
              params: expect.objectContaining({
                locator: expect.objectContaining({ resourceId: "com.demo:id/recover_target" })
              })
            }),
            source: expect.objectContaining({
              sourceType: "exploration",
              artifactId: candidateArtifact.id
            })
          })
        ]
      })
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "error",
          summary: "Graph run bootstrap did not reach a recognized graph node",
          detail: expect.stringContaining('"code":"BOOTSTRAP_START_NODE_NOT_RECOGNIZED"'),
          artifactIds: [candidateArtifact.id]
        }),
        expect.objectContaining({
          type: "runner_error",
          severity: "error",
          detail: expect.stringContaining("BOOTSTRAP_START_NODE_NOT_RECOGNIZED")
        })
      ])
    );
  }, 15000);

  it("reuses an existing runtime-discovered draft node when the same unknown state is observed again", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new UnrecoverableUnknownAppStateGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    storage.createBusinessNode({
      graphVersionId: activeVersion.id,
      key: "runtime.unknown.ral704",
      name: "运行期未知节点：未知页面",
      nodeType: "page",
      status: "draft",
      tags: ["runtime-discovered", "needs-review"],
      matchers: [],
      defaultExpectations: [],
      platformScope: "android",
      metadata: { source: "runtime_unknown_state", artifactId: "artifact-old" }
    });

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    const draftNodes = storage.getActiveBusinessGraphVersion(graph.id).nodes.filter((node: BusinessNode) => node.key === "runtime.unknown.ral704");
    expect(run.status).toBe("failed");
    expect(run.events.find((event: { type: string; detail?: string }) => event.type === "runner_error")?.detail).toContain("BOOTSTRAP_START_NODE_NOT_RECOGNIZED");
    expect(run.events.find((event: { detail?: string }) => event.detail?.includes("UNIQUE constraint failed"))).toBeUndefined();
    expect(draftNodes).toHaveLength(1);
    expect(draftNodes[0].metadata.artifactId).toMatch(/^artifact_/);
    expect(run.artifacts.some((artifact: { name: string }) => artifact.name.startsWith("runtime-unknown-node-candidate-"))).toBe(true);
  }, 15000);

  it("backs out of a stable child page and plans from the reachable parent page", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new StableChildPageGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode, homeNode } = seedStableChildRecoveryGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    const routePlan = storage.getRoutePlan(started.routePlanId);
    expect(run.status).toBe("passed");
    expect(routePlan?.startNodeId).toBe(homeNode.id);
    expect(driver.actions.map((action) => action.type)).toEqual(["back", "tap"]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "info",
          summary: "Graph run backed out of an unreachable start page before route planning",
          detail: expect.stringContaining('"fromNodeName":"添加好友"')
        })
      ])
    );
  });

  it("records exploration candidates when controlled back recovery cannot reach a connected page", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new LauncherAfterBackGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedStableChildRecoveryGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(driver.actions.map((action) => action.type)).toEqual(["back"]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "warning",
          summary: "Graph run could not back out of an unreachable start page before route planning",
          detail: expect.stringContaining('"inTargetApp":false')
        })
      ])
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runner_error",
          severity: "error",
          summary: "Graph route planning failed",
          detail: expect.stringContaining('"code":"START_BACK_RECOVERY_FAILED"')
        })
      ])
    );
  }, 15000);

  it("records a login-required start state when the current graph node is an auth gate", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new LoginRequiredGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, loginNode } = seedSpecialStartGraph(storage, {
      key: "login",
      name: "登录页",
      tags: ["auth:login_required"],
      text: "登录",
      resourceId: "com.demo:id/login_title"
    });

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: loginNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "warning",
          detail: expect.stringContaining('"reason":"login_required"')
        })
      ])
    );
    expect(driver.setupActions).toEqual([]);
  });

  it("records a blocking start state when the current graph node is a blocking runtime state", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new BlockingStateGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, blockingNode } = seedSpecialStartGraph(storage, {
      key: "forced_update",
      name: "强制升级弹窗",
      tags: ["runtime:blocking"],
      text: "立即升级",
      resourceId: "com.demo:id/force_update_title"
    });

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: blockingNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          severity: "warning",
          detail: expect.stringContaining('"reason":"blocking_state"')
        })
      ])
    );
    expect(driver.setupActions).toEqual([]);
  });

  it("prevents starting a second graph run on the same device", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new SlowGraphMockDriver(context.tempRoot);
    const { GraphDeviceBusyError, GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id
    });

    await expect(
      service.start({
        deviceSerial: driver.device.serial,
        graphId: graph.id,
        targetNodeId: targetNode.id
      })
    ).rejects.toThrow(GraphDeviceBusyError);

    driver.release();
    await waitForRun(storage, started.run.id, { waitForReport: true });
  });

  it("applies runtime overlay expectations only to the current graph run", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页\n目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-1",
        note: "temporary AI expectation",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [textExpectation("overlay-target-copy", "新版目标页", { timeoutMs: 20, intervalMs: 1 })]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        graph: expect.objectContaining({
          runtimeOverlay: {
            id: "overlay-1",
            note: "temporary AI expectation",
            targetExpectationIds: ["overlay-target-copy"],
            edgeExpectationIds: []
          }
        })
      })
    );
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "overlay-target-copy",
          status: "failed"
        })
      ])
    );
    const activeVersion = storage.getActiveBusinessGraphVersion(graph.id);
    const storedTargetNode = activeVersion.nodes.find((node: BusinessNode) => node.id === targetNode.id);
    expect(storedTargetNode.defaultExpectations.map((expectation: StepExpectation) => expectation.id)).toEqual(["target-visible"]);
  });

  it("writes AI diagnosis evidence for failed graph runs when a diagnosis client is configured", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const aiDiagnosisClient = {
      diagnose: vi.fn(async () => ({
        classification: "asset_issue" as const,
        confidence: 0.88,
        summary: "目标页新增文案导致旧预期失败。",
        reasoning: ["动作已执行", "目标节点视觉可见但覆盖预期未满足"],
        recommendedAction: "create_asset_patch" as const,
        safeToAutoApply: false,
        assetPatch: {
          kind: "page_matcher" as const,
          operation: "update" as const,
          targetId: "node-target",
          summary: "补充新版目标页文案 matcher",
          changes: { matcher: "新版目标页" },
          status: "draft" as const
        }
      }))
    };
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页\n目标页"), { aiDiagnosisClient });
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-ai-diagnosis",
        note: "temporary AI expectation",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [textExpectation("overlay-missing-copy", "不存在的目标页文案", { timeoutMs: 20, intervalMs: 1 })]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(aiDiagnosisClient.diagnose).toHaveBeenCalledTimes(1);
    const aiEvent = run.events.find((event: { type: string }) => event.type === "ai_diagnosis");
    expect(aiEvent).toEqual(
      expect.objectContaining({
        severity: "warning",
        summary: "AI 诊断：asset_issue · 目标页新增文案导致旧预期失败。"
      })
    );
    const artifact = run.artifacts.find((item: { id: string }) => item.id === aiEvent.artifactIds[0]);
    expect(artifact?.name).toMatch(/^ai-diagnosis-/);
    const payload = JSON.parse(await readFile(path.join(context.tempRoot, "artifacts", artifact.path), "utf8"));
    expect(payload).toEqual(
      expect.objectContaining({
        diagnosis: expect.objectContaining({
          classification: "asset_issue",
          assetPatch: expect.objectContaining({ status: "draft" })
        }),
        evidence: expect.objectContaining({
          runId: started.run.id,
          deviceSerial: driver.device.serial
        })
      })
    );
  });

  it("uses saved AI diagnosis settings for failed graph runs without restarting the service", async () => {
    context = await createContext();
    const { storage } = context;
    storage.updateAiDiagnosisSettings({
      enabled: true,
      baseURL: "https://settings.example/v1",
      apiKey: "settings-key",
      model: "settings-model",
      timeoutMs: 7000
    });
    const driver = new GraphMockDriver(context.tempRoot);
    const aiDiagnosisClient = {
      diagnose: vi.fn(async () => ({
        classification: "automation_issue" as const,
        confidence: 0.77,
        summary: "测试配置来源",
        reasoning: ["使用设置页保存的模型配置"],
        recommendedAction: "report_only" as const,
        safeToAutoApply: false
      }))
    };
    const createAiDiagnosisClient = vi.fn(() => aiDiagnosisClient);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页\n目标页"), { createAiDiagnosisClient });
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-ai-settings",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [textExpectation("overlay-missing-copy", "不存在的目标页文案", { timeoutMs: 20, intervalMs: 1 })]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    expect(createAiDiagnosisClient).toHaveBeenCalledWith({
      enabled: true,
      baseURL: "https://settings.example/v1",
      apiKey: "settings-key",
      model: "settings-model",
      timeoutMs: 7000
    });
    expect(aiDiagnosisClient.diagnose).toHaveBeenCalledTimes(1);
  });

  it("evaluates runtime overlay expectations when the device is already at the target node", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    await driver.performAction(driver.device.serial, { type: "tap", x: 240, y: 240 });
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("首页\n目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-already-target",
        note: "already-at-target dynamic expectation",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [textExpectation("overlay-missing-target-copy", "不存在的目标页文案", { timeoutMs: 20, intervalMs: 1 })]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(run.stepResults).toHaveLength(1);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "wait",
        status: "failed",
        metadata: expect.objectContaining({
          graph: expect.objectContaining({
            edgeId: "__target_validation__",
            edgeKey: "target.validation",
            fromNodeId: targetNode.id,
            toNodeId: targetNode.id,
            phase: "expectation",
            runtimeOverlay: {
              id: "overlay-already-target",
              note: "already-at-target dynamic expectation",
              targetExpectationIds: ["overlay-missing-target-copy"],
              edgeExpectationIds: []
            }
          })
        })
      })
    );
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "overlay-missing-target-copy",
          status: "failed"
        })
      ])
    );
    expect(driver.actions).toHaveLength(1);
    expect(storage.getActiveBusinessGraphVersion(graph.id).nodes.find((node: BusinessNode) => node.id === targetNode.id)?.defaultExpectations.map((item: StepExpectation) => item.id)).toEqual([
      "target-visible"
    ]);
  });

  it("evaluates state_is runtime overlay expectations with the business graph detector", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    await driver.performAction(driver.device.serial, { type: "tap", x: 240, y: 240 });
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-state",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [
              {
                id: "overlay-state-is-target",
                type: "state_is",
                enabled: true,
                params: {
                  nodeId: targetNode.id
                },
                createdAt: "2026-06-12T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "overlay-state-is-target",
          type: "state_is",
          status: "passed",
          reason: "Matched by business graph state detector."
        })
      ])
    );
  });

  it("treats state_is nodeId as authoritative when stale nodeKey and nodeName are present", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    await driver.performAction(driver.device.serial, { type: "tap", x: 240, y: 240 });
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      overlay: {
        id: "overlay-state-stale-display-fields",
        nodeExpectationOverrides: [
          {
            nodeId: targetNode.id,
            expectations: [
              {
                id: "overlay-state-stale-display-fields",
                type: "state_is",
                enabled: true,
                params: {
                  nodeId: targetNode.id,
                  nodeKey: "runtime.unknown.old",
                  nodeName: "旧页面名称"
                },
                createdAt: "2026-06-12T00:00:00.000Z"
              }
            ]
          }
        ]
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expectationId: "overlay-state-stale-display-fields",
          type: "state_is",
          status: "passed"
        })
      ])
    );
  });

  it("rejects runtime overlays targeting a different node", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const { graph, targetNode } = seedGraph(storage);

    await expect(
      service.start({
        deviceSerial: driver.device.serial,
        graphId: graph.id,
        targetNodeId: targetNode.id,
        startStrategy: "keep_current",
        overlay: {
          id: "overlay-wrong-target",
          targetNodeId: "node-other",
          nodeExpectationOverrides: [
            {
              nodeId: "node-other",
              expectations: [textExpectation("overlay-other-copy", "其他页面文案")]
            }
          ]
        }
      })
    ).rejects.toThrow("RuntimeOverlay targetNodeId node-other does not match requested target node");
    expect(driver.actions).toHaveLength(0);
  });

  it("replans from the detected actual node and continues to the target when a graph transition deviates", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new DetourGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, detourNode, targetNode } = seedDetourGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions.filter((action: { type: string }) => action.type === "tap")).toHaveLength(2);
    expect(run.stepResults).toHaveLength(2);
    expect(run.stepResults.map((step: { status: string }) => step.status)).toEqual(["failed", "passed"]);
    expect(run.stepResults[0]?.metadata.graph.deviations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        expectedNodeId: targetNode.id,
        actualNodeId: detourNode.id,
        action: "replan_required"
      })
    ]));
    expect(run.stepResults[1]?.metadata.graph).toEqual(
      expect.objectContaining({
        recoveryAttempt: 1,
        edgeKey: "detour.to.target",
        fromNodeId: detourNode.id,
        toNodeId: targetNode.id
      })
    );
    const graphResultArtifact = run.artifacts.find((artifact: { name: string }) => artifact.name === "graph-execution-result.json");
    expect(graphResultArtifact).toBeTruthy();
    const resultJson = JSON.parse(await readFile(path.join(context.tempRoot, "artifacts", graphResultArtifact.path), "utf8"));
    expect(resultJson).toEqual(
      expect.objectContaining({
        status: "passed",
        recoveries: [
          expect.objectContaining({
            attempt: 1,
            fromNodeId: detourNode.id,
            targetNodeId: targetNode.id,
            status: "passed"
          })
        ]
      })
    );
  });

  it("fails deprecated grid candidate edges instead of trying the next recorded slot", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new ClassGridRetryGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedClassGridRetryGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults.map((step: { status: string }) => step.status)).toEqual(["failed"]);
    expect(run.stepResults[0]?.metadata.semantic).toEqual(
      expect.objectContaining({
        reason: "deprecated_grid_candidate_without_target"
      })
    );
    expect(run.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.stringContaining("retrying the next candidate")
        })
      ])
    );
  });

  it("uses className runtime param to enter the matching class card from a semantic grid ability", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new ClassGridRetryGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new ClassGridTargetOcrService(() => driver.currentText));
    const { graph, targetNode } = seedClassGridRetryGraph(storage, { semanticGridTarget: true });

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual",
      overlay: {
        id: "target-class-42",
        targetNodeId: targetNode.id,
        runtimeParams: {
          className: "班级四十二号"
        }
      }
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.steps[0]?.params.scrollProfile).toEqual(
      expect.objectContaining({
        targetKind: "item_text",
        targetQuery: "班级四十二号"
      })
    );
    expect(driver.actions).toEqual([
      { type: "tap", x: 840, y: 295 },
      { type: "tap", x: 240, y: 360 }
    ]);
    expect(run.stepResults[0]?.metadata.semantic).toEqual(
      expect.objectContaining({
        targetQuery: "班级四十二号",
        actual: "班级四十二号",
        candidateGrid: { column: 1, row: 0 }
      })
    );
  });

  it("handles a blocking popup before executing the current graph edge", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new PopupGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 540, y: 620 },
      { type: "tap", x: 240, y: 400 }
    ]);
    expect(run.stepResults[0]?.metadata.graph.interceptors).toEqual([
      expect.objectContaining({
        ruleId: "common-known",
        matchedText: "知道了",
        action: { type: "tap", x: 540, y: 620 }
      })
    ]);
  });

  it("dismisses the ClassIn stage subject picker during a graph transition", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new CloseButtonDismissedBlockingPageGraphMockDriver(context.tempRoot, "让 ClassIn 更懂你的课\n选择学段和学科");
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 400 }, { type: "tap", x: 1008, y: 116 }]);
    expect(run.stepResults[0]?.metadata.graph.interceptors).toEqual([
      expect.objectContaining({
        ruleId: "classin-stage-subject-picker",
        ruleName: "ClassIn 选择学段学科页",
        matchedText: expect.stringContaining("让 ClassIn 更懂你的课"),
        action: { type: "tap", x: 1008, y: 116 }
      })
    ]);
  });

  it("loads custom runtime interceptor rules during graph execution", async () => {
    context = await createContext();
    const { storage } = context;
    storage.createRuntimeInterceptorRule({
      id: "rule-course-preference",
      name: "课程偏好临时页",
      enabled: true,
      platformScope: "android",
      appPackageName: "com.demo",
      matchers: [{ type: "text", value: "课程偏好设置" }],
      action: { type: "back" }
    });
    const driver = new BackDismissedBlockingPageGraphMockDriver(context.tempRoot, "课程偏好设置");
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 400 }, { type: "back" }]);
    expect(run.stepResults[0]?.metadata.graph.interceptors).toEqual([
      expect.objectContaining({
        ruleId: "rule-course-preference",
        ruleName: "课程偏好临时页",
        matchedText: "课程偏好设置"
      })
    ]);
  });

  it("does not record runtime interceptor metadata when no blocking popup is present", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new GraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new FakeOcrService("目标页"));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.metadata.graph.interceptors).toBeUndefined();
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 400 }]);
  });

  it("executes compound page transitions by running menu micro steps before target validation", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new AddFriendMenuGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedCompoundMenuGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current",
      executionProfile: "fast_visual"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true, timeoutMs: 12000 });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 1004, y: 192 },
      { type: "tap", x: 240, y: 360 }
    ]);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        compound: expect.objectContaining({
          total: 3,
          steps: [
            expect.objectContaining({ order: 1, type: "tap_on_image", label: "右上角更多", resolved: true }),
            expect.objectContaining({ order: 2, type: "wait_until_state", label: "等待添加好友菜单出现", resolved: true }),
            expect.objectContaining({ order: 3, type: "tap_on_text", label: "添加好友", resolved: true })
          ]
        })
      })
    );
    expect(run.stepResults[0]?.metadata.graph.actionPolicy.action.params.compoundSteps).toHaveLength(2);
  }, 15000);

  it("limits runtime interceptor passes so repeated blocking popups fail instead of looping forever", async () => {
    context = await createContext();
    const { storage } = context;
    const driver = new StickyPopupGraphMockDriver(context.tempRoot);
    const { GraphRunService } = await import("./graph-run-service.js");
    const service = new GraphRunService(storage, driver, new DynamicFakeOcrService(() => driver.currentText));
    const { graph, targetNode } = seedGraph(storage);

    const started = await service.start({
      deviceSerial: driver.device.serial,
      graphId: graph.id,
      targetNodeId: targetNode.id,
      startStrategy: "keep_current"
    });

    await waitForRun(storage, started.run.id, { waitForReport: true });

    const run = storage.getRun(started.run.id);
    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 540, y: 620 },
      { type: "tap", x: 540, y: 620 }
    ]);
    expect(run.stepResults[0]?.metadata.graph.interceptors).toHaveLength(2);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "ACTION_FAILED"
      })
    );
  });
});

async function createContext(): Promise<{ storage: any; tempRoot: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-graph-run-"));
  process.env.DATA_DIR = tempRoot;
  vi.resetModules();
  const { Storage } = await import("./storage.js");
  const storage = new Storage();
  await storage.ensureDirs();
  return { storage, tempRoot };
}

function seedGraph(storage: any, options: { targetApp?: { androidPackageName: string } } = { targetApp: { androidPackageName: "com.demo" } }): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: options.targetApp,
    platformScope: "android",
    name: "Demo 图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test"],
    status: "draft"
  });
  const root = storage.createBusinessNode(node(version.id, "root", "Root", [matcher("package", "not.demo", 1)], []));
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/home_title", 3), matcher("text", "首页", 2)],
      [textExpectation("home-visible", "首页")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/target_title", 3), matcher("text", "目标页", 2)],
      [textExpectation("target-visible", "目标页")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: root.id,
    toNodeId: home.id,
    key: "root.to.home",
    name: "启动",
    intent: "启动到首页",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(launchStep())],
    expectations: [textExpectation("expect-home", "首页")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.to.target",
    name: "进入目标页",
    intent: "点击目标按钮",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(tapOnElementStep())],
    expectations: [textExpectation("expect-target", "目标页")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: target };
}

function seedVisualRestartGraph(storage: any): { graph: { id: string }; homeNode: BusinessNode; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 视觉重启图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-visual-restart"],
    status: "draft"
  });
  const root = storage.createBusinessNode(node(version.id, "root", "Root", [matcher("package", "not.demo", 1)], []));
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), regionMatcher("ocr_text", "首页", 3)],
      [textExpectation("home-visible", "首页")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), regionMatcher("ocr_text", "目标页", 3)],
      [textExpectation("target-visible", "目标页")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: root.id,
    toNodeId: home.id,
    key: "root.to.home",
    name: "启动",
    intent: "启动到首页",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(launchStep())],
    expectations: [textExpectation("expect-home", "首页")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.to.target",
    name: "进入目标页",
    intent: "点击目标按钮",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(tapOnElementStep())],
    expectations: [textExpectation("expect-target", "目标页")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, homeNode: home, targetNode: target };
}

function seedPageAssetStartGraph(storage: any): { graph: { id: string }; pageAssetNode: BusinessNode; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 页面资产起点图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-page-asset-start"],
    status: "draft"
  });
  storage.createBusinessNode(
    node(
      version.id,
      "recording.home",
      "录制节点：主页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.HomeActivity", 3), matcher("resource_id", "com.demo:id/home_title", 3)],
      [textExpectation("recording-home-visible", "首页")]
    )
  );
  const pageAsset = storage.createBusinessNode({
    ...node(
      version.id,
      "classin.teacher.classes",
      "主页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/home_title", 3), matcher("text", "首页", 2)],
      [textExpectation("home-visible", "首页")],
      ["page-asset", "asset-recording"]
    ),
    metadata: {
      assetRecordingConfirmed: true
    }
  });
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/target_title", 3), matcher("text", "目标页", 2)],
      [textExpectation("target-visible", "目标页")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: pageAsset.id,
    toNodeId: target.id,
    key: "page-asset-home.to.target",
    name: "页面资产主页进入目标页",
    intent: "点击目标按钮",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(tapOnElementStep())],
    expectations: [textExpectation("expect-target", "目标页")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, pageAssetNode: pageAsset, targetNode: target };
}

function seedFastVisualGraph(storage: any, options: { edgePreconditions?: StepExpectation[] } = {}): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 快速视觉图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-fast-visual"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.HomeActivity", 3), matcher("ocr_text", "首页", 3)],
      [stateExpectation("home-state", "home")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.TargetActivity", 3), matcher("ocr_text", "目标页", 3)],
      [stateExpectation("target-state", "target")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.fast.to.target",
    name: "快速视觉进入目标页",
    intent: "点击目标区域",
    status: "active",
    source: "manual_edit",
    preconditions: options.edgePreconditions ?? [],
    actionPolicies: [
      actionPolicy({
        id: "tap-image-target-step",
        order: 1,
        type: "tap_on_image",
        enabled: true,
        params: {
          region: { x: 20, y: 20, width: 20, height: 20 },
          targetText: "进入目标",
          semanticArea: "content"
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      })
    ],
    expectations: [stateExpectation("expect-target-state", "target")],
    platformScope: "android",
    reliabilityScore: 0.95
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: target };
}

function seedPageTaskGraph(storage: any): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 页面任务图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-page-task"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.HomeActivity", 3), matcher("ocr_text", "首页", 3)],
      [stateExpectation("home-state", "home")]
    )
  );
  const target = storage.createBusinessNode({
    ...node(
      version.id,
      "lesson-create",
      "新建课堂",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.CreateLessonActivity", 3), matcher("ocr_text", "新建课堂", 3)],
      [stateExpectation("lesson-create-state", "lesson-create")],
      ["page-asset"]
    ),
    metadata: {
      assetRecordingConfirmed: true,
      assetRecordingManualElements: [
        {
          id: "manual-title",
          label: "课堂标题",
          targetText: "课堂标题",
          locator: "image-region:10,20,60,8",
          actionKind: "input",
          semanticArea: "content",
          coordinateSpace: "screen",
          region: { x: 10, y: 20, width: 60, height: 8 },
          quality: {
            status: "pass",
            score: 0.88,
            warnings: [],
            candidates: [],
            evidence: {
              targetText: "课堂标题",
              semanticArea: "content",
              uniqueCandidate: true,
              candidateCount: 1
            }
          },
          visualLocator: {
            minScore: 0.72,
            targetRole: "input",
            candidates: [
              { source: "vision", label: "课堂标题", role: "input", score: 0.9, semanticArea: "content", region: { x: 10, y: 20, width: 60, height: 8 } }
            ]
          }
        },
        {
          id: "manual-publish",
          label: "发布",
          targetText: "发布",
          locator: "image-region:75,90,15,8",
          actionKind: "tap",
          semanticArea: "bottom",
          coordinateSpace: "screen",
          region: { x: 75, y: 90, width: 15, height: 8 }
        },
        {
          id: "manual-duration",
          label: "课堂时长",
          locator: "image-region:65,28,20,6",
          actionKind: "tap",
          semanticArea: "content",
          coordinateSpace: "screen",
          region: { x: 65, y: 28, width: 20, height: 6 }
        },
        {
          id: "manual-record-classroom",
          label: "录制ClassIn教室",
          locator: "image-region:80,43,10,5",
          actionKind: "tap",
          semanticArea: "content",
          coordinateSpace: "screen",
          region: { x: 80, y: 43, width: 10, height: 5 }
        },
        {
          id: "manual-classroom-info",
          label: "编辑课堂信息",
          locator: "image-region:76,36,12,5",
          actionKind: "tap",
          semanticArea: "content",
          coordinateSpace: "screen",
          region: { x: 76, y: 36, width: 12, height: 5 }
        }
      ],
      assetRecordingPageTasks: [
        {
          id: "task-create-lesson",
          name: "创建课堂",
          status: "active",
          steps: [
            { id: "task-step-title", order: 1, elementId: "manual-title", fieldType: "text_input", valueParamKey: "lessonName" },
            { id: "task-step-submit", order: 2, elementId: "manual-publish", fieldType: "submit" }
          ]
        },
        {
          id: "task-fill-lesson-form",
          name: "填写课堂表单",
          status: "active",
          steps: [
            { id: "task-step-duration", order: 1, elementId: "manual-duration", fieldType: "picker_select", label: "课堂时长", valueParamKey: "duration" },
            { id: "task-step-record-classroom", order: 2, elementId: "manual-record-classroom", fieldType: "toggle_set", label: "录制ClassIn教室", desiredStateParamKey: "recordClassroom" },
            { id: "task-step-classroom-info", order: 3, elementId: "manual-classroom-info", fieldType: "subpage_edit", label: "编辑课堂信息" }
          ]
        }
      ]
    }
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.fast.to.lesson-create",
    name: "快速视觉进入新建课堂",
    intent: "点击新建课堂入口",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "tap-create-lesson-entry",
        order: 1,
        type: "tap_on_image",
        enabled: true,
        params: {
          region: { x: 20, y: 20, width: 20, height: 20 },
          targetText: "新建课堂",
          semanticArea: "content"
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      })
    ],
    expectations: [stateExpectation("expect-lesson-create-state", "lesson-create")],
    platformScope: "android",
    reliabilityScore: 0.95
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: target };
}

function seedLoginTaskNavigationGraph(storage: any): { graph: { id: string }; targetNode: BusinessNode; loginNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 登录任务图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-login-task-navigation"],
    status: "draft"
  });
  const login = storage.createBusinessNode({
    ...node(
      version.id,
      "login",
      "登录",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.LoginActivity", 3), matcher("ocr_text", "登录", 3)],
      [stateExpectation("login-state", "login")],
      ["page-asset"]
    ),
    metadata: {
      assetRecordingConfirmed: true,
      assetRecordingManualElements: runtimeStructuralLoginElements(),
      assetRecordingPageTasks: [
        {
          id: "task-account-password-login",
          name: "账号密码登录",
          status: "active",
          steps: [
            { id: "task-step-phone", order: 1, elementId: "manual-phone", fieldType: "text_input", label: "手机号输入框", valueParamKey: "phone" },
            { id: "task-step-password", order: 2, elementId: "manual-password", fieldType: "text_input", label: "密码输入框", valueParamKey: "password" },
            { id: "task-step-agreement", order: 3, elementId: "manual-agreement", fieldType: "tap", label: "协议勾选" },
            { id: "task-step-submit", order: 4, elementId: "manual-login-submit", fieldType: "submit", label: "登录按钮" }
          ]
        }
      ]
    }
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "主页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.HomeActivity", 3), matcher("ocr_text", "主页", 3)],
      [stateExpectation("home-state", "home")],
      ["page-asset"]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: login.id,
    toNodeId: home.id,
    key: "login.task.to.home",
    name: "登录 -> 主页",
    intent: "执行页面任务：账号密码登录",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "run-account-password-login",
        order: 1,
        type: "wait",
        enabled: true,
        title: "执行页面任务：账号密码登录",
        params: {
          taskId: "task-account-password-login",
          taskMode: "source_page_navigation"
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      })
    ],
    expectations: [stateExpectation("expect-home-state", "home")],
    platformScope: "android",
    reliabilityScore: 0.86
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: home, loginNode: login };
}

function runtimeStructuralLoginElements(): Array<Record<string, unknown>> {
  return [
    {
      id: "manual-phone",
      label: "手机号输入框",
      targetText: "请输入手机号",
      locator: "runtime-locator:phone_or_email_input",
      locatorKind: "structural_locator",
      actionKind: "input",
      semanticArea: "content",
      coordinateSpace: "runtime",
      structuralLocator: {
        strategy: "ocr_or_edittext",
        role: "phone_or_email_input",
        preferredPlaceholderText: "请输入手机号",
        fallbackPolicy: "no_region_center_fallback"
      }
    },
    {
      id: "manual-password",
      label: "密码输入框",
      targetText: "请输入密码",
      locator: "runtime-locator:password_input",
      locatorKind: "structural_locator",
      actionKind: "input",
      semanticArea: "content",
      coordinateSpace: "runtime",
      structuralLocator: {
        strategy: "ocr_or_edittext",
        role: "password_input",
        preferredPlaceholderText: "请输入密码",
        fallbackPolicy: "no_region_center_fallback"
      }
    },
    {
      id: "manual-agreement",
      label: "协议勾选",
      targetText: "已阅读并同意",
      locator: "runtime-locator:agreement_checkbox",
      locatorKind: "structural_locator",
      actionKind: "tap",
      semanticArea: "content",
      coordinateSpace: "runtime",
      structuralLocator: {
        strategy: "near_text",
        role: "checkbox",
        anchorText: "已阅读并同意",
        clickTarget: "leading_checkbox"
      }
    },
    {
      id: "manual-login-submit",
      label: "登录按钮",
      targetText: "登录",
      locator: "runtime-locator:primary_login_button",
      locatorKind: "structural_locator",
      actionKind: "tap",
      semanticArea: "content",
      coordinateSpace: "runtime",
      structuralLocator: {
        strategy: "ocr_text",
        role: "primary_button",
        text: "登录"
      }
    }
  ];
}

function seedUnreachableGraph(storage: any): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 不可达图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-unreachable"],
    status: "draft"
  });
  storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/home_title", 3), matcher("text", "首页", 2)],
      [textExpectation("home-visible", "首页")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/target_title", 3), matcher("text", "目标页", 2)],
      [textExpectation("target-visible", "目标页")]
    )
  );
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: target };
}

function seedStableChildRecoveryGraph(storage: any): { graph: { id: string }; homeNode: BusinessNode; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 稳定页回退恢复图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-stable-child-recovery"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/home_title", 3), matcher("text", "首页", 2)],
      [textExpectation("home-visible", "首页")]
    )
  );
  storage.createBusinessNode(
    node(
      version.id,
      "add-friend",
      "添加好友",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/add_friend_title", 3), matcher("text", "添加好友", 2)],
      [textExpectation("add-friend-visible", "添加好友")],
      ["page-asset"]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "发布活动",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/target_title", 3), matcher("text", "发布活动", 2)],
      [textExpectation("target-visible", "发布活动")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.to.activity",
    name: "首页到发布活动",
    intent: "从首页进入发布活动",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "home-to-activity-action",
        order: 1,
        type: "tap_on_element",
        enabled: true,
        params: {
          locator: { strategy: "android_uiautomator", resourceId: "com.demo:id/target" }
        },
        createdAt: "2026-06-20T00:00:00.000Z"
      })
    ],
    expectations: [stateExpectation("expect-target-state", "target")],
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, homeNode: home, targetNode: target };
}

function seedDetourGraph(storage: any): { graph: { id: string }; detourNode: BusinessNode; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 偏离恢复图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-detour"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "首页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/home_title", 3), matcher("text", "首页", 2)],
      [textExpectation("home-visible", "首页")]
    )
  );
  const detour = storage.createBusinessNode(
    node(
      version.id,
      "detour",
      "中间页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/detour_title", 3), matcher("text", "中间页", 2)],
      [textExpectation("detour-visible", "中间页")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "target",
      "目标页",
      [matcher("package", "com.demo", 2), matcher("resource_id", "com.demo:id/target_title", 3), matcher("text", "目标页", 2)],
      [textExpectation("target-visible", "目标页")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: target.id,
    key: "home.to.target",
    name: "进入目标页",
    intent: "点击目标按钮",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(tapOnElementStep("tap-target-step", "com.demo:id/target"))],
    expectations: [textExpectation("expect-target", "目标页", { timeoutMs: 20, intervalMs: 1 })],
    failurePolicy: {
      retryCount: 0,
      recoverTo: "replan"
    },
    platformScope: "android",
    reliabilityScore: 0.9
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: detour.id,
    toNodeId: target.id,
    key: "detour.to.target",
    name: "从中间页进入目标页",
    intent: "继续点击目标按钮",
    status: "active",
    source: "manual_edit",
    actionPolicies: [actionPolicy(tapOnElementStep("tap-target-from-detour-step", "com.demo:id/target"))],
    expectations: [textExpectation("expect-target-from-detour", "目标页", { timeoutMs: 20, intervalMs: 1 })],
    platformScope: "android",
    reliabilityScore: 0.8
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, detourNode: detour, targetNode: target };
}

function seedClassGridRetryGraph(storage: any, options: { semanticGridTarget?: boolean } = {}): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 网格候选重试图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-grid-candidate-retry"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "主页",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.HomeActivity", 3), matcher("ocr_text", "主页", 2), matcher("ocr_text", "班级列表", 2)],
      [textExpectation("home-visible", "主页")]
    )
  );
  const classDetail = storage.createBusinessNode(
    node(
      version.id,
      "class-detail",
      "班级详情",
      [matcher("package", "com.demo", 2), matcher("activity", "com.demo.ClassDetailActivity", 3), matcher("ocr_text", "班级详情", 3), matcher("ocr_text", "无创建入口", 1), matcher("ocr_text", "创建课堂", 1)],
      [textExpectation("class-detail-visible", "班级详情")]
    )
  );
  const target = storage.createBusinessNode(
    node(
      version.id,
      "lesson-create",
      "新建课堂",
      [matcher("package", "com.demo", 2), matcher("ocr_text", "新建课堂", 3), matcher("activity", "com.demo.CreateLessonActivity", 2)],
      [textExpectation("lesson-create-visible", "新建课堂")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: classDetail.id,
    key: "home.grid.to.class-detail",
    name: "主页班级列表进入班级详情",
    intent: "点击班级列表候选卡片",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "tap-grid-class-card",
        order: 1,
        type: "tap_on_image",
        enabled: true,
        title: "点击：班级列表",
        params: {
          abilityType: "grid_candidate",
          elementLabel: "班级列表",
          region: { x: 0, y: 10, width: 100, height: 30 },
          ...(!options.semanticGridTarget
            ? {
                candidateIndex: 0,
                maxCandidateAttempts: 2,
                tapPointPercent: { x: 25, y: 20 }
              }
            : {}),
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: options.semanticGridTarget ? "item_text" : "nth_item",
            ...(options.semanticGridTarget ? { targetQuery: "{{className}}" } : {}),
            afterFoundAction: "tap_item",
            candidateItemHeightPercent: 30,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            failureStrategy: "back_and_try_next_candidate"
          }
        },
        createdAt: "2026-06-22T00:00:00.000Z"
      })
    ],
    expectations: [textExpectation("expect-class-detail", "班级详情", { timeoutMs: 20, intervalMs: 1 })],
    failurePolicy: {
      retryCount: 0,
      recoverTo: "replan"
    },
    platformScope: "android",
    reliabilityScore: 0.74
  });
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: classDetail.id,
    toNodeId: target.id,
    key: "class-detail.to.lesson-create",
    name: "班级详情进入新建课堂",
    intent: "点击创建课堂入口",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "tap-create-lesson",
        order: 1,
        type: "tap_on_image",
        enabled: true,
        title: "点击：创建课堂",
        params: {
          elementLabel: "创建课堂",
          region: { x: 80, y: 80, width: 10, height: 5 },
          targetText: "创建课堂",
          semanticArea: "content"
        },
        createdAt: "2026-06-22T00:00:00.000Z"
      })
    ],
    expectations: [textExpectation("expect-lesson-create", "新建课堂", { timeoutMs: 20, intervalMs: 1 })],
    failurePolicy: {
      retryCount: 0,
      recoverTo: "replan"
    },
    platformScope: "android",
    reliabilityScore: 0.82
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: target };
}

function seedCompoundMenuGraph(storage: any): { graph: { id: string }; targetNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 复合菜单图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-compound-menu"],
    status: "draft"
  });
  const home = storage.createBusinessNode(
    node(
      version.id,
      "home",
      "主页",
      [matcher("package", "com.demo", 2), matcher("ocr_text", "主页", 3), matcher("activity", "com.demo.HomeActivity", 2)],
      [textExpectation("home-visible", "主页")]
    )
  );
  const addFriend = storage.createBusinessNode(
    node(
      version.id,
      "add-friend",
      "添加好友",
      [matcher("package", "com.demo", 2), matcher("ocr_text", "添加好友页", 3), matcher("activity", "com.demo.AddFriendActivity", 2)],
      [textExpectation("add-friend-visible", "添加好友页")]
    )
  );
  storage.createOperationEdge({
    graphVersionId: version.id,
    fromNodeId: home.id,
    toNodeId: addFriend.id,
    key: "home.more.to.add-friend",
    name: "主页更多进入添加好友",
    intent: "打开更多菜单并点击添加好友",
    status: "active",
    source: "manual_edit",
    actionPolicies: [
      actionPolicy({
        id: "tap-home-more",
        order: 1,
        type: "tap_on_image",
        enabled: true,
        title: "右上角更多",
        params: {
          elementLabel: "右上角更多",
          region: { x: 89, y: 5, width: 8, height: 6 },
          visualLocator: {
            minScore: 0.72,
            targetRole: "button",
            candidates: [
              { source: "vision", label: "右上角更多", role: "button", score: 0.9, semanticArea: "top", region: { x: 90, y: 5, width: 6, height: 6 } }
            ]
          },
          outcomeType: "compound_navigation",
          compoundSteps: [
            {
              id: "wait-add-friend-menu",
              order: 2,
              type: "wait_until_state",
              enabled: true,
              title: "等待添加好友菜单出现",
              params: { text: "添加好友", timeoutMs: 200, intervalMs: 10 },
              createdAt: "2026-06-22T00:00:00.000Z"
            },
            {
              id: "tap-add-friend-menu",
              order: 3,
              type: "tap_on_text",
              enabled: true,
              title: "添加好友",
              params: { text: "添加好友", timeoutMs: 200, intervalMs: 10 },
              createdAt: "2026-06-22T00:00:00.000Z"
            }
          ]
        },
        createdAt: "2026-06-22T00:00:00.000Z"
      })
    ],
    expectations: [textExpectation("expect-add-friend", "添加好友页", { timeoutMs: 20, intervalMs: 1 })],
    failurePolicy: {
      retryCount: 0,
      recoverTo: "replan"
    },
    platformScope: "android",
    reliabilityScore: 0.84
  });
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return { graph, targetNode: addFriend };
}

function seedSpecialStartGraph(
  storage: any,
  input: {
    key: string;
    name: string;
    tags: string[];
    text: string;
    resourceId: string;
  }
): { graph: { id: string }; loginNode: BusinessNode; blockingNode: BusinessNode } {
  const graph = storage.createBusinessGraph({
    appId: "demo-app",
    targetApp: { androidPackageName: "com.demo" },
    platformScope: "android",
    name: "Demo 特殊起点图谱",
    status: "draft"
  });
  const version = storage.createBusinessGraphVersion({
    graphId: graph.id,
    sourceSummary: ["test-special-start"],
    status: "draft"
  });
  const specialNode = storage.createBusinessNode(
    node(
      version.id,
      input.key,
      input.name,
      [matcher("package", "com.demo", 2), matcher("resource_id", input.resourceId, 3), matcher("text", input.text, 2)],
      [textExpectation(`${input.key}-visible`, input.text)],
      input.tags
    )
  );
  storage.setActiveBusinessGraphVersion(graph.id, version.id);
  return {
    graph,
    loginNode: specialNode,
    blockingNode: specialNode
  };
}

function node(graphVersionId: string, key: string, name: string, matchers: StateMatcher[], defaultExpectations: StepExpectation[], tags: string[] = []) {
  return {
    graphVersionId,
    key,
    name,
    nodeType: key === "root" ? "root" : "page",
    tags,
    status: "active",
    matchers,
    defaultExpectations,
    platformScope: "android"
  };
}

function matcher(type: StateMatcher["type"], value: string, weight: number): StateMatcher {
  return {
    id: `${type}-${value}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    value,
    weight,
    platformScope: "android"
  };
}

function regionMatcher(type: StateMatcher["type"], value: string, weight: number): StateMatcher {
  return {
    ...matcher(type, value, weight),
    region: { x: 10, y: 7, width: 25, height: 6 },
    semanticArea: "top"
  };
}

function pgm(width: number, height: number, pixels: number[]): Buffer {
  if (pixels.length !== width * height) {
    throw new Error("Invalid PGM pixel count");
  }
  return Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii"),
    Buffer.from(pixels)
  ]);
}

function textExpectation(id: string, expected: string, extraParams: Record<string, unknown> = {}): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    params: {
      expected,
      mode: "contains",
      ...extraParams
    },
    createdAt: "2026-06-12T00:00:00.000Z"
  };
}

function stateExpectation(id: string, nodeKey: string): StepExpectation {
  return {
    id,
    type: "state_is",
    enabled: true,
    params: {
      nodeKey
    },
    createdAt: "2026-06-20T00:00:00.000Z"
  };
}

function actionPolicy(action: ActionStep): ActionPolicy {
  return {
    id: `${action.id}-policy`,
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: "high"
  };
}

function launchStep(): ActionStep {
  return {
    id: "launch-step",
    order: 1,
    type: "launch_app",
    enabled: true,
    params: { packageName: "com.demo" },
    createdAt: "2026-06-12T00:00:00.000Z"
  };
}

function tapOnElementStep(id = "tap-target-step", resourceId = "com.demo:id/target"): ActionStep {
  return {
    id,
    order: 1,
    type: "tap_on_element",
    enabled: true,
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId
      },
      timeoutMs: 20,
      intervalMs: 1
    },
    createdAt: "2026-06-12T00:00:00.000Z"
  };
}

class GraphMockDriver extends MockDriver {
  protected foreground = {
    packageName: "com.demo",
    activityName: "com.demo.HomeActivity",
    componentName: "com.demo/com.demo.HomeActivity"
  };

  constructor(private readonly tempDir: string) {
    super();
    this.device.capabilities.recordVideo = true;
  }

  async getForegroundApp(): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    return this.foreground;
  }

  async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.actions.some((action) => action.type === "tap") ? "目标页" : "首页");
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity"
      };
    }
    return result;
  }

  override async startVideoRecording(serial: string, runId: string, _localDir: string): Promise<MockVideoRecording> {
    await this.getDeviceInfo(serial);
    const localPath = path.join(this.tempDir, "video", `${runId}.mp4`);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, "video");
    return {
      id: runId,
      serial,
      localPath,
      startedAt: new Date().toISOString()
    };
  }

  override async stopVideoRecording(recording: MockVideoRecording, keep: boolean): Promise<string | undefined> {
    return keep ? recording.localPath : undefined;
  }
}

class GraphAppMonitorMockDriver extends GraphMockDriver {
  readonly monitorStarts: Array<{ serial: string; runId: string; config: AndroidAppMonitorConfig }> = [];
  monitorStopCount = 0;

  constructor(
    tempDir: string,
    private readonly monitorData: {
      cpu?: AndroidProcessMetricSample[];
      memory?: AndroidProcessMetricSample[];
      lifecycle?: AndroidProcessLifecycleEvent[];
      incidents?: AndroidAppMonitorIncident[];
    } = {}
  ) {
    super(tempDir);
  }

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    _writeTextArtifact: (runId: string, fileName: string, content: string) => Promise<{ id: string }>,
    callbacks: {
      onSample?: (sample: AndroidProcessMetricSample, kind: "cpu" | "memory") => void | Promise<void>;
      onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
      onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
    } = {}
  ): Promise<MobileAppMonitorSession> {
    this.monitorStarts.push({ serial, runId, config });
    let started = false;
    return {
      start: async () => {
        if (started) {
          return;
        }
        started = true;
        for (const event of this.monitorData.lifecycle ?? [{ occurredAt: nowIsoForGraphTest(), type: "process_started", pid: 123, processName: config.packageName }]) {
          await callbacks.onLifecycleEvent?.(event);
        }
        for (const sample of this.monitorData.cpu ?? [{ sampledAt: nowIsoForGraphTest(), pid: 123, processName: config.packageName, cpuPercent: 14 }]) {
          await callbacks.onSample?.(sample, "cpu");
        }
        for (const sample of this.monitorData.memory ?? [{ sampledAt: nowIsoForGraphTest(), pid: 123, processName: config.packageName, pssKb: 4096 }]) {
          await callbacks.onSample?.(sample, "memory");
        }
        for (const incident of this.monitorData.incidents ?? []) {
          await callbacks.onIncident?.(incident);
        }
      },
      stop: async () => {
        this.monitorStopCount += 1;
        return this.getMonitorSummary(config);
      },
      getSummary: () => this.getMonitorSummary(config)
    };
  }

  private getMonitorSummary(config: AndroidAppMonitorConfig) {
    return {
      packageName: config.packageName,
      startedAt: "2026-06-09T00:00:00.000Z",
      endedAt: "2026-06-09T00:00:02.000Z",
      processes: [
        {
          pid: 123,
          processName: config.packageName,
          packageName: config.packageName,
          isMainProcess: true,
          discoveredAt: "2026-06-09T00:00:00.000Z"
        }
      ],
      sampleCounts: {
        cpu: this.monitorData.cpu?.length ?? 1,
        memory: this.monitorData.memory?.length ?? 1,
        lifecycle: this.monitorData.lifecycle?.length ?? 1
      },
      incidents: this.monitorData.incidents ?? [],
      artifacts: {}
    };
  }
}

function nowIsoForGraphTest(): string {
  return "2026-06-09T00:00:01.000Z";
}

class VisualGraphMockDriver extends GraphMockDriver {
  override async screenshot(serial: string): Promise<Buffer> {
    await this.getDeviceInfo(serial);
    return pgm(1080, 2400, Array.from({ length: 1080 * 2400 }, () => 255));
  }
}

class CountingGraphMockDriver extends GraphMockDriver {
  currentText = "首页\n进入目标";
  dumpUiHierarchyCalls = 0;

  override async dumpUiHierarchy(): Promise<string> {
    this.dumpUiHierarchyCalls += 1;
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.currentText = "目标页";
    }
    return result;
  }
}

class PageTaskGraphMockDriver extends GraphMockDriver {
  currentText = "首页\n新建课堂";
  pickerOpen = false;
  private enteredText = "";

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "tap" && this.currentText.includes("首页")) {
      this.currentText = "新建课堂";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.CreateLessonActivity",
        componentName: "com.demo/com.demo.CreateLessonActivity"
      };
      return result;
    }
    if (action.type === "clear_text" && this.currentText.startsWith("新建课堂")) {
      this.enteredText = "";
      this.currentText = "新建课堂";
      return result;
    }
    if (action.type === "input_text" && this.currentText.startsWith("新建课堂")) {
      this.enteredText = action.text;
      this.currentText = ["新建课堂", this.enteredText].filter(Boolean).join("\n");
      return result;
    }
    if (action.type === "tap" && this.currentText === "新建课堂" && action.x >= 760 && action.y >= 650 && action.y <= 760) {
      this.pickerOpen = true;
      this.currentText = "30分钟\n45分钟\n1小时";
      return result;
    }
    if (action.type === "tap" && this.pickerOpen && this.currentText !== "确定" && action.y >= 300 && action.y <= 600) {
      this.currentText = "确定";
      return result;
    }
    if (action.type === "tap" && this.pickerOpen && this.currentText === "确定") {
      this.pickerOpen = false;
      this.currentText = "新建课堂";
    }
    return result;
  }
}

class LoginTaskGraphMockDriver extends GraphMockDriver {
  currentText = "登录";
  protected foreground = {
    packageName: "com.demo",
    activityName: "com.demo.LoginActivity",
    componentName: "com.demo/com.demo.LoginActivity"
  };
  private enteredPhone = "";
  private enteredPassword = "";
  private focusedField: "phone" | "password" | undefined;

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  loginSnapshot(): { text: string; phone: string; password: string } {
    return {
      text: this.currentText,
      phone: this.enteredPhone,
      password: this.enteredPassword
    };
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "tap" && this.currentText.startsWith("登录") && action.y >= 1320 && action.y <= 1450) {
      this.focusedField = "phone";
      return result;
    }
    if (action.type === "tap" && this.currentText.startsWith("登录") && action.y >= 1460 && action.y <= 1540) {
      this.focusedField = "password";
      return result;
    }
    if (action.type === "clear_text" && this.focusedField === "phone") {
      this.enteredPhone = "";
      this.refreshLoginText();
      return result;
    }
    if (action.type === "clear_text" && this.focusedField === "password") {
      this.enteredPassword = "";
      this.refreshLoginText();
      return result;
    }
    if (action.type === "input_text" && this.focusedField === "phone") {
      this.enteredPhone = action.text;
      this.refreshLoginText();
      return result;
    }
    if (action.type === "input_text" && this.focusedField === "password") {
      this.enteredPassword = action.text;
      this.refreshLoginText();
      return result;
    }
    if (action.type === "tap" && this.currentText.startsWith("登录") && action.x >= 480 && action.x <= 620 && action.y >= 1100 && action.y <= 1300) {
      this.currentText = "主页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
    }
    return result;
  }

  private refreshLoginText(): void {
    this.currentText = ["登录", this.enteredPhone, this.enteredPassword].filter(Boolean).join("\n");
  }
}

class LoginSubmitStaysOnPageMockDriver extends GraphMockDriver {
  currentText = "登录";
  protected foreground = {
    packageName: "com.demo",
    activityName: "com.demo.LoginActivity",
    componentName: "com.demo/com.demo.LoginActivity"
  };
  private enteredPhone = "";
  private enteredPassword = "";
  private focusedField: "phone" | "password" | undefined;

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  loginSnapshot(): { text: string; phone: string; password: string } {
    return {
      text: this.currentText,
      phone: this.enteredPhone,
      password: this.enteredPassword
    };
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "tap" && this.currentText.startsWith("登录") && action.y >= 1320 && action.y <= 1450) {
      this.focusedField = "phone";
      return result;
    }
    if (action.type === "tap" && this.currentText.startsWith("登录") && action.y >= 1460 && action.y <= 1540) {
      this.focusedField = "password";
      return result;
    }
    if (action.type === "clear_text" && this.focusedField === "phone") {
      this.enteredPhone = "";
      this.refreshLoginText();
      return result;
    }
    if (action.type === "clear_text" && this.focusedField === "password") {
      this.enteredPassword = "";
      this.refreshLoginText();
      return result;
    }
    if (action.type === "input_text" && this.focusedField === "phone") {
      this.enteredPhone = action.text;
      this.refreshLoginText();
      return result;
    }
    if (action.type === "input_text" && this.focusedField === "password") {
      this.enteredPassword = action.text;
      this.refreshLoginText();
      return result;
    }
    return result;
  }

  private refreshLoginText(): void {
    this.currentText = ["登录", this.enteredPhone, this.enteredPassword].filter(Boolean).join("\n");
  }
}

class OutsideAppGraphMockDriver extends GraphMockDriver {
  currentText = "桌面";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.android.launcher",
      activityName: "com.android.launcher.Launcher",
      componentName: "com.android.launcher/.Launcher"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (action.type === "launch_app") {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
      this.currentText = "首页";
      return result;
    }
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.currentText = "目标页";
    }
    return result;
  }
}

class CurrentDevicePackageGraphMockDriver extends GraphMockDriver {
  currentText = "首页";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo.flutter",
      activityName: "com.demo.flutter.MainActivity",
      componentName: "com.demo.flutter/.MainActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.currentText = "目标页";
      this.foreground = {
        packageName: "com.demo.flutter",
        activityName: "com.demo.flutter.TargetActivity",
        componentName: "com.demo.flutter/.TargetActivity"
      };
    }
    return result;
  }
}

class UnknownAppStateGraphMockDriver extends GraphMockDriver {
  currentText = "未知页面";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.UnknownActivity",
      componentName: "com.demo/com.demo.UnknownActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return this.currentText === "未知页面" ? unknownHierarchy(this.currentText) : hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (action.type === "launch_app") {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
      this.currentText = "首页";
      return result;
    }
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.currentText = "目标页";
    }
    return result;
  }
}

class SearchPageGraphMockDriver extends GraphMockDriver {
  currentText = "搜索";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.SearchActivity",
      componentName: "com.demo/com.demo.SearchActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "back") {
      this.currentText = "首页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
      return result;
    }
    if (action.type === "tap") {
      this.currentText = "目标页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity"
      };
    }
    return result;
  }
}

class StableChildPageGraphMockDriver extends GraphMockDriver {
  currentText = "添加好友";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.AddFriendActivity",
      componentName: "com.demo/com.demo.AddFriendActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    if (this.currentText === "添加好友") {
      return specialHierarchy("添加好友", "com.demo:id/add_friend_title");
    }
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "back") {
      this.currentText = "首页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
      return result;
    }
    if (action.type === "tap") {
      this.currentText = "发布活动";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity"
      };
    }
    return result;
  }
}

class LauncherAfterBackGraphMockDriver extends GraphMockDriver {
  currentText = "添加好友";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.AddFriendActivity",
      componentName: "com.demo/com.demo.AddFriendActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    if (this.foreground.packageName !== "com.demo") {
      return unknownHierarchy("桌面");
    }
    return this.currentText === "添加好友" ? specialHierarchy("添加好友", "com.demo:id/add_friend_title") : hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "back") {
      this.currentText = "桌面";
      this.foreground = {
        packageName: "com.android.launcher",
        activityName: "com.android.launcher.Launcher",
        componentName: "com.android.launcher/.Launcher"
      };
    }
    return result;
  }
}

class UnrecoverableUnknownAppStateGraphMockDriver extends GraphMockDriver {
  currentText = "未知页面";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.UnknownActivity",
      componentName: "com.demo/com.demo.UnknownActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return unknownHierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (action.type === "launch_app") {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.UnknownActivity",
        componentName: "com.demo/com.demo.UnknownActivity"
      };
      this.currentText = "未知页面";
      return result;
    }
    return super.performAction(serial, action);
  }
}

class LoginRequiredGraphMockDriver extends GraphMockDriver {
  currentText = "登录";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.LoginActivity",
      componentName: "com.demo/com.demo.LoginActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return specialHierarchy(this.currentText, "com.demo:id/login_title");
  }
}

class BlockingStateGraphMockDriver extends GraphMockDriver {
  currentText = "立即升级";

  constructor(tempDir: string) {
    super(tempDir);
    this.foreground = {
      packageName: "com.demo",
      activityName: "com.demo.ForceUpdateActivity",
      componentName: "com.demo/com.demo.ForceUpdateActivity"
    };
  }

  override async dumpUiHierarchy(): Promise<string> {
    return specialHierarchy(this.currentText, "com.demo:id/force_update_title");
  }
}

class SlowGraphMockDriver extends GraphMockDriver {
  private released = false;
  private releaseWaiters: Array<() => void> = [];

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    await new Promise<void>((resolve) => {
      if (this.released) {
        resolve();
        return;
      }
      this.releaseWaiters.push(resolve);
    });
    return super.performAction(serial, action);
  }

  release(): void {
    this.released = true;
    for (const resolve of this.releaseWaiters) {
      resolve();
    }
    this.releaseWaiters = [];
  }
}

class DetourGraphMockDriver extends GraphMockDriver {
  currentText = "首页";
  private tapCount = 0;

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.tapCount += 1;
      this.currentText = this.tapCount === 1 ? "中间页" : "目标页";
    }
    return result;
  }
}

class ClassGridRetryGraphMockDriver extends GraphMockDriver {
  currentText = "主页\n班级列表";
  private selectedCandidate = -1;

  override async dumpUiHierarchy(): Promise<string> {
    if (this.currentText.includes("新建课堂")) {
      return hierarchy("新建课堂");
    }
    if (this.currentText.includes("班级详情")) {
      return hierarchy("班级详情");
    }
    return hierarchy("主页\n班级列表");
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type === "back") {
      this.currentText = "主页\n班级列表";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.HomeActivity",
        componentName: "com.demo/com.demo.HomeActivity"
      };
      return result;
    }
    if (action.type !== "tap") {
      return result;
    }
    if (this.currentText.includes("主页")) {
      this.selectedCandidate = action.x < 540 ? 0 : 1;
      this.currentText = this.selectedCandidate === 0 ? "班级详情\n无创建入口" : "班级详情\n创建课堂";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.ClassDetailActivity",
        componentName: "com.demo/com.demo.ClassDetailActivity"
      };
      return result;
    }
    if (this.currentText.includes("班级详情") && this.selectedCandidate === 1) {
      this.currentText = "新建课堂";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.CreateLessonActivity",
        componentName: "com.demo/com.demo.CreateLessonActivity"
      };
    }
    return result;
  }
}

class AddFriendMenuGraphMockDriver extends GraphMockDriver {
  currentText = "主页";
  private menuVisible = false;

  override async dumpUiHierarchy(): Promise<string> {
    return hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    const result = await MockDriver.prototype.performAction.call(this, serial, action);
    if (action.type !== "tap") {
      return result;
    }
    if (!this.menuVisible && this.currentText === "主页") {
      this.menuVisible = true;
      this.currentText = "主页\n添加好友\n加入班级\n扫一扫";
      return result;
    }
    if (this.menuVisible && action.x === 240 && action.y === 360) {
      this.menuVisible = false;
      this.currentText = "添加好友页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.AddFriendActivity",
        componentName: "com.demo/com.demo.AddFriendActivity"
      };
    }
    return result;
  }
}

class PopupGraphMockDriver extends GraphMockDriver {
  popupVisible = true;
  private targetEntered = false;

  get currentText(): string {
    if (this.popupVisible) {
      return "首页\n知道了";
    }
    return this.targetEntered ? "目标页" : "首页";
  }

  override async dumpUiHierarchy(): Promise<string> {
    return this.popupVisible ? popupHierarchy("知道了") : hierarchy(this.targetEntered ? "目标页" : "首页");
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (this.popupVisible && action.type === "tap") {
      this.assertPopupTap(action);
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.popupVisible = false;
      return result;
    }
    const result = await super.performAction(serial, action);
    if (action.type === "tap") {
      this.targetEntered = true;
    }
    return result;
  }

  private assertPopupTap(action: DeviceActionRequest): void {
    if (action.type !== "tap" || action.x !== 540 || action.y !== 620) {
      throw new Error(`Unexpected popup tap: ${JSON.stringify(action)}`);
    }
  }
}

class StickyPopupGraphMockDriver extends PopupGraphMockDriver {
  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (this.popupVisible && action.type === "tap") {
      this.assertStickyPopupTap(action);
      return MockDriver.prototype.performAction.call(this, serial, action);
    }
    return super.performAction(serial, action);
  }

  private assertStickyPopupTap(action: DeviceActionRequest): void {
    if (action.type !== "tap" || action.x !== 540 || action.y !== 620) {
      throw new Error(`Unexpected sticky popup tap: ${JSON.stringify(action)}`);
    }
  }
}

class CloseButtonDismissedBlockingPageGraphMockDriver extends GraphMockDriver {
  currentText = "首页";
  private blockingVisible = false;

  constructor(
    tempDir: string,
    private readonly blockingText: string
  ) {
    super(tempDir);
  }

  override async dumpUiHierarchy(): Promise<string> {
    return this.blockingVisible ? closeableBlockingHierarchy(this.blockingText) : hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (action.type === "tap" && this.blockingVisible && action.x === 1008 && action.y === 116) {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.blockingVisible = false;
      this.currentText = "目标页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity"
      };
      return result;
    }
    if (action.type === "tap" && this.currentText === "首页") {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.blockingVisible = true;
      this.currentText = this.blockingText;
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.SelectStageSubjectActivity",
        componentName: "com.demo/com.demo.SelectStageSubjectActivity"
      };
      return result;
    }
    return super.performAction(serial, action);
  }
}

class BackDismissedBlockingPageGraphMockDriver extends GraphMockDriver {
  currentText = "首页";
  private blockingVisible = false;

  constructor(
    tempDir: string,
    private readonly blockingText: string
  ) {
    super(tempDir);
  }

  override async dumpUiHierarchy(): Promise<string> {
    return this.blockingVisible ? specialHierarchy(this.blockingText, "com.demo:id/blocking_title") : hierarchy(this.currentText);
  }

  override async performAction(serial: string, action: DeviceActionRequest): ReturnType<MockDriver["performAction"]> {
    if (action.type === "back" && this.blockingVisible) {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.blockingVisible = false;
      this.currentText = "目标页";
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.TargetActivity",
        componentName: "com.demo/com.demo.TargetActivity"
      };
      return result;
    }
    if (action.type === "tap" && this.currentText === "首页") {
      const result = await MockDriver.prototype.performAction.call(this, serial, action);
      this.blockingVisible = true;
      this.currentText = this.blockingText;
      this.foreground = {
        packageName: "com.demo",
        activityName: "com.demo.SelectStageSubjectActivity",
        componentName: "com.demo/com.demo.SelectStageSubjectActivity"
      };
      return result;
    }
    return super.performAction(serial, action);
  }
}

class FakeOcrService implements OcrService {
  constructor(private readonly text: string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return { text: this.text, engine: "fake", lang: "test" };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    return {
      text: this.text,
      engine: "fake",
      lang: "test",
      width: 1080,
      height: 2400,
      boxes: this.text.split("\n").map((text, index) => ({
        text,
        confidence: 0.98,
        x: 120,
        y: 200 + index * 120,
        width: 240,
        height: 80
      }))
    };
  }
}

class DynamicFakeOcrService implements OcrService {
  constructor(private readonly textProvider: () => string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return { text: this.textProvider(), engine: "fake", lang: "test" };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    const text = this.textProvider();
    return {
      text,
      engine: "fake",
      lang: "test",
      width: 1080,
      height: 2400,
      boxes: text.split("\n").map((item, index) => ({
        text: item,
        confidence: 0.98,
        x: 120,
        y: 200 + index * 120,
        width: 240,
        height: 80
      }))
    };
  }
}

class LoginFormOcrService implements OcrService {
  constructor(private readonly snapshotProvider: () => { text: string; phone: string; password: string }) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    const snapshot = this.snapshotProvider();
    return { text: snapshot.text, engine: "fake", lang: "test" };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    const snapshot = this.snapshotProvider();
    if (snapshot.text.includes("主页")) {
      return {
        text: snapshot.text,
        engine: "fake",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "主页", confidence: 0.98, x: 120, y: 120, width: 120, height: 64 }
        ]
      };
    }
    const boxes: OcrLayoutResult["boxes"] = [
      { text: "登录", confidence: 0.98, x: 120, y: 120, width: 120, height: 64 },
      { text: "登录", confidence: 0.98, x: 108, y: 1152, width: 864, height: 144 },
      { text: "已阅读并同意", confidence: 0.98, x: 120, y: 1590, width: 180, height: 60 }
    ];
    if (snapshot.phone) {
      boxes.push({ text: snapshot.phone, confidence: 0.98, x: 108, y: 1320, width: 864, height: 144 });
    } else {
      boxes.push({ text: "请输入手机号", confidence: 0.98, x: 108, y: 1320, width: 864, height: 144 });
    }
    if (snapshot.password) {
      boxes.push({ text: snapshot.password, confidence: 0.98, x: 108, y: 1460, width: 864, height: 124 });
    } else {
      boxes.push({ text: "请输入密码", confidence: 0.98, x: 108, y: 1460, width: 864, height: 124 });
    }
    return {
      text: snapshot.text,
      engine: "fake",
      lang: "test",
      width: 1080,
      height: 2400,
      boxes
    };
  }
}

class LessonFormOcrService implements OcrService {
  constructor(private readonly textProvider: () => string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return { text: this.textProvider(), engine: "fake", lang: "test" };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    const text = this.textProvider();
    if (text.includes("首页")) {
      return {
        text,
        engine: "fake",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "首页", confidence: 0.98, x: 120, y: 120, width: 120, height: 64 },
          { text: "新建课堂", confidence: 0.98, x: 120, y: 320, width: 240, height: 80 }
        ]
      };
    }
    const boxes: OcrLayoutResult["boxes"] = [
      { text: "新建课堂", confidence: 0.98, x: 120, y: 120, width: 220, height: 64 },
      { text: "课堂标题", confidence: 0.98, x: 180, y: 520, width: 504, height: 112 },
      { text: "发布", confidence: 0.98, x: 810, y: 2220, width: 162, height: 72 }
    ];
    const enteredText = text
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item && item !== "新建课堂");
    if (enteredText) {
      boxes.push({ text: enteredText, confidence: 0.98, x: 180, y: 520, width: 280, height: 64 });
    }
    return {
      text,
      engine: "fake",
      lang: "test",
      width: 1080,
      height: 2400,
      boxes
    };
  }
}

class ClassGridTargetOcrService implements OcrService {
  constructor(private readonly textProvider: () => string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return { text: this.textProvider(), engine: "fake", lang: "test" };
  }

  async locateText(_input: OcrInput): Promise<OcrLayoutResult> {
    const text = this.textProvider();
    if (text.includes("主页")) {
      return {
        text: "主页\n班级列表\n班级四十一号\n班级四十二号",
        engine: "fake",
        lang: "test",
        width: 1080,
        height: 2400,
        boxes: [
          { text: "主页", confidence: 0.98, x: 120, y: 120, width: 160, height: 60 },
          { text: "班级列表", confidence: 0.98, x: 120, y: 200, width: 200, height: 60 },
          { text: "班级四十一号", confidence: 0.98, x: 190, y: 260, width: 220, height: 70 },
          { text: "班级四十二号", confidence: 0.98, x: 730, y: 260, width: 220, height: 70 }
        ]
      };
    }
    return {
      text,
      engine: "fake",
      lang: "test",
      width: 1080,
      height: 2400,
      boxes: text.split("\n").map((item, index) => ({
        text: item,
        confidence: 0.98,
        x: 120,
        y: 200 + index * 120,
        width: 240,
        height: 80
      }))
    };
  }
}

async function waitForRun(storage: any, runId: string, options: { waitForReport?: boolean; timeoutMs?: number } = {}): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < (options.timeoutMs ?? 3000)) {
    const run = storage.getRun(runId);
    if (run && run.status !== "running" && run.status !== "paused") {
      if (!options.waitForReport || run.reportHtmlPath) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Run ${runId} did not finish`);
}

function hierarchy(text: string): string {
  const normalized = text.replace(/\s+/g, "");
  const titleResourceId = normalized.includes("目标页") || normalized.includes("发布活动")
    ? "com.demo:id/target_title"
    : normalized.includes("中间页")
      ? "com.demo:id/detour_title"
      : normalized.includes("搜索")
        ? "com.demo:id/search_title"
        : "com.demo:id/home_title";
  const actionNode = normalized.includes("目标页")
    ? ""
    : '\n    <node index="1" text="进入目标" resource-id="com.demo:id/target" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,360][360,440]" />';
  const loginFormNodes = normalized.includes("登录")
    ? '\n    <node index="2" text="" resource-id="com.demo:id/phone_input" class="android.widget.EditText" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[108,1320][972,1464]" />\n    <node index="3" text="" resource-id="com.demo:id/password_input" class="android.widget.EditText" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="true" scrollable="false" bounds="[108,1460][972,1584]" />'
    : "";
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="${text}" resource-id="${titleResourceId}" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />${actionNode}${loginFormNodes}
  </node>
</hierarchy>`;
}

function popupHierarchy(text: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="首页" resource-id="com.demo:id/home_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
    <node index="1" text="${text}" resource-id="com.demo:id/dialog_confirm" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[420,580][660,660]" />
  </node>
</hierarchy>`;
}

function unknownHierarchy(text: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="${text}" resource-id="com.demo:id/unknown_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
    <node index="1" text="进入目标" resource-id="com.demo:id/recover_target" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,360][360,440]" />
  </node>
</hierarchy>`;
}

function specialHierarchy(text: string, resourceId: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="${text}" resource-id="${resourceId}" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][520,280]" />
  </node>
</hierarchy>`;
}

function closeableBlockingHierarchy(text: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="×" resource-id="com.demo:id/close" class="android.widget.TextView" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[980,88][1036,144]" />
    <node index="1" text="${text}" resource-id="com.demo:id/blocking_title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][520,280]" />
  </node>
</hierarchy>`;
}
