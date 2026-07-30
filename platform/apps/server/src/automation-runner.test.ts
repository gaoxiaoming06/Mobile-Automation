import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockDriver, type MockVideoRecording } from "@mobile-automation/test-support";
import {
  type ActionStep,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type ArtifactRef,
  type DeviceEvent,
  type MetricSample,
  nowIso,
  type SemanticDeviceActionRequest,
  type StepExpectation,
  type StepResult,
  type TestRun
} from "@mobile-automation/shared";
import { AutomationRunner, type RunnerStorage } from "./automation-runner.js";
import { DeviceExecutionBusyError, DeviceExecutionLease } from "./device-execution-lease.js";
import type { DeviceEventWatcher, MobileAppMonitorSession, ObservedDeviceEvent } from "./mobile-driver.js";
import type { OcrInput, OcrResult, OcrService } from "./ocr.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import type { PageStateService } from "./page-state-service.js";

describe("AutomationRunner regression flow", () => {
  it("passes reach_page without device actions when the target page is already active", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const pageState = pageStateSequence(["page-home"]);
    const runner = new AutomationRunner(storage, driver, undefined, { pageStateService: pageState });

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [reachPageStep("page-home", [])],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "already_on_target",
      targetPageId: "page-home",
      route: []
    }));
  });

  it("executes every action in a frozen navigation segment before verifying its target page", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const pageState = pageStateSequence(["page-detail", "page-home"]);
    const openMenu: ActionStep = {
      id: "navigate:open-menu",
      order: 1,
      type: "back",
      enabled: true,
      params: {},
      createdAt: nowIso()
    };
    const openHome: ActionStep = {
      id: "navigate:open-home",
      order: 2,
      type: "tap",
      enabled: true,
      params: {},
      coordinate: { x: 120, y: 240 },
      createdAt: nowIso()
    };
    const runner = new AutomationRunner(storage, driver, undefined, { pageStateService: pageState });

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [reachPageStep("page-home", [{
        fromPageId: "page-detail",
        toPageId: "page-home",
        flowId: "flow-detail-home",
        flowName: "返回主页",
        segmentId: "detail-home",
        stepIds: ["open-menu", "open-home"],
        actions: [openMenu, openHome]
      }])],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "back" }, { type: "tap", x: 120, y: 240 }]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "reached",
      route: [expect.objectContaining({ flowId: "flow-detail-home", segmentId: "detail-home" })]
    }));
  });

  it("uses bounded back recovery during preparation and stops as soon as the target page is recognized", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentPage: async () => {
          identifyCount += 1;
          if (identifyCount === 1) return { status: "unknown", candidates: [] };
          return {
            status: "matched",
            page: {
              id: "page-home",
              key: "page-home",
              name: "主页",
              appId: "cn.eeo.classin",
              graphVersionId: "v1",
              matcherCount: 1
            },
            candidates: []
          };
        },
        verifyExpectedPage: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedPage: async () => ({ status: "unknown", candidates: [] })
      }
    });

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [reachPageStep("page-home", [])],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "back" }]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "recovered_to_target",
      recoveryActions: 1
    }));
  });

  it("does not press back when the current page is recognized but no reliable route exists", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: pageStateSequence(["page-class-detail"])
    });
    const step = reachPageStep("page-growth", []);
    step.params.maxRecoveryBacks = 1;
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "no_reliable_path",
      currentPageId: "page-class-detail",
      recoveryActions: 0
    }));
  });

  it("backs to a page that can reach the target and then executes the indexed route", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const page = (id: string, name: string) => ({
      status: "matched" as const,
      page: {
        id,
        key: id,
        name,
        appId: "cn.eeo.classin",
        graphVersionId: "v1",
        matcherCount: 1
      },
      candidates: []
    });
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentPage: async () => {
          identifyCount += 1;
          return identifyCount === 1
            ? page("page-class-detail", "班级详情")
            : page("page-home", "主页");
        },
        verifyExpectedPage: async () => page("page-growth", "成长"),
        waitForExpectedPage: async () => page("page-growth", "成长")
      }
    });
    const openGrowth: ActionStep = {
      id: "navigate:open-growth",
      order: 1,
      type: "tap",
      enabled: true,
      params: {},
      coordinate: { x: 320, y: 720 },
      createdAt: nowIso()
    };
    const step = reachPageStep("page-growth", [{
      fromPageId: "page-home",
      toPageId: "page-growth",
      flowId: "flow-home-growth",
      flowName: "从主页进入成长页",
      segmentId: "home-growth",
      stepIds: ["open-growth"],
      actions: [openGrowth]
    }]);
    step.params.recoveryStopPageIds = ["page-home", "page-login"];
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "back" },
      { type: "tap", x: 320, y: 720 }
    ]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "reached",
      recoveryActions: 1,
      route: [expect.objectContaining({ segmentId: "home-growth" })]
    }));
  });

  it("allows a preparation step to back directly to its declared entry page", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentPage: async () => {
          identifyCount += 1;
          const id = identifyCount === 1 ? "page-class-detail" : "page-home";
          return {
            status: "matched",
            page: {
              id,
              key: id,
              name: id === "page-home" ? "主页" : "班级详情",
              appId: "cn.eeo.classin",
              graphVersionId: "v1",
              matcherCount: 1
            },
            candidates: []
          };
        },
        verifyExpectedPage: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedPage: async () => ({ status: "unknown", candidates: [] })
      }
    });
    const step = reachPageStep("page-home", []);
    step.params.allowBackRecovery = true;
    step.params.recoveryStopPageIds = ["page-home", "page-login"];
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "back" }]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "recovered_to_target",
      recoveryActions: 1
    }));
  });

  it("stops preparation recovery at another declared navigation root", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: pageStateSequence(["page-login"])
    });
    const step = reachPageStep("page-home", []);
    step.params.allowBackRecovery = true;
    step.params.recoveryStopPageIds = ["page-home", "page-login"];

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "recovery_stopped_at_anchor",
      currentPageId: "page-login",
      recoveryActions: 0
    }));
  });

  it("stops back recovery immediately after leaving the target app", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentPage: async () => {
          identifyCount += 1;
          if (identifyCount === 1) return { status: "unknown", candidates: [] };
          return {
            status: "outside_app",
            actualAppId: "com.android.launcher",
            candidates: []
          };
        },
        verifyExpectedPage: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedPage: async () => ({ status: "unknown", candidates: [] })
      }
    });
    const step = reachPageStep("page-growth", []);
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([{ type: "back" }]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "recovery_left_app",
      currentStatus: "outside_app",
      recoveryActions: 1
    }));
  });

  it("persists redacted steps while executing the in-memory runtime steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const now = nowIso();
    const runtimeStep: ActionStep = {
      id: "password",
      order: 1,
      type: "input_text",
      enabled: true,
      title: "输入密码",
      params: { text: "top-secret" },
      createdAt: now
    };
    const persistedStep: ActionStep = { ...runtimeStep, params: { text: "[REDACTED]" } };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Sensitive Flow",
      steps: [runtimeStep],
      persistedSteps: [persistedStep],
      stepIntervalMs: 0,
      recordVideo: false
    });
    await waitForRun(runner, storage, started.id);

    expect(driver.actions).toContainEqual({ type: "input_text", text: "top-secret" });
    expect(started.steps[0]?.params.text).toBe("[REDACTED]");
  });

  it("replays recorded steps, captures evidence, and skips unsupported video recording", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = driver.createTapStep(120, 240);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Regression Flow",
      steps: [step],
      repeatCount: 1,
      stepIntervalMs: 0,
      recordVideo: true
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(driver.recordings).toHaveLength(0);
    expect(run.stepResults).toHaveLength(1);
    expect(run.stepResults[0]?.status).toBe("passed");
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        actionBackend: expect.objectContaining({
          driverChannel: "mock"
        })
      })
    );
    expect(run.stepResults[0]?.afterScreenshotId).toBeTruthy();
    expect(run.artifacts.some((artifact) => artifact.type === "screenshot")).toBe(true);
    expect(run.artifacts.some((artifact) => artifact.type === "report_html")).toBe(true);
    expect(run.reportHtmlPath).toBeTruthy();
    expect(run.metrics.length).toBeGreaterThanOrEqual(2);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "video_unavailable",
          summary: "Video recording skipped"
        })
      ])
    );
  });

  it("starts android app monitor and writes metric summary artifacts before report", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Monitor Flow",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo",
        processFilters: [":worker"]
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.monitorStarts).toEqual([
      expect.objectContaining({
        serial: driver.device.serial,
        runId: started.id,
        config: expect.objectContaining({ packageName: "com.demo", processFilters: [":worker"] })
      })
    ]);
    expect(driver.monitorStopCount).toBe(1);
    expect(run.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-cpu.csv", mimeType: "text/csv" }),
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-memory.csv", mimeType: "text/csv" }),
        expect.objectContaining({ type: "metrics", name: "android-app-monitor-lifecycle.csv", mimeType: "text/csv" }),
        expect.objectContaining({ type: "report_json", name: "android-app-monitor-summary.json", mimeType: "application/json" }),
        expect.objectContaining({ type: "report_html", name: "report.html" })
      ])
    );
    const summaryIndex = storage.writes.findIndex((write) => write.relativePath.endsWith("android-app-monitor-summary.json"));
    const reportIndex = storage.writes.findIndex((write) => write.relativePath.endsWith("report.html"));
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(reportIndex).toBeGreaterThan(summaryIndex);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "android_app_monitor",
          severity: "info",
          summary: expect.stringContaining("[Android App Monitor]")
        })
      ])
    );
  });

  it("records android app monitor crash incidents and stops on failure", async () => {
    const storage = new MemoryRunnerStorage();
    const incident: AndroidAppMonitorIncident = {
      id: "incident-1",
      type: "java_crash",
      severity: "error",
      occurredAt: nowIso(),
      processName: "com.demo",
      pid: 123,
      summary: "Java crash detected",
      detail: "FATAL EXCEPTION",
      artifactIds: [],
      metadata: { signal: "SIGABRT" }
    };
    const driver = new AppMonitorMockDriver({ incidents: [incident] });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Monitor Crash",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      stopOnFailure: true,
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo"
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
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

  it("continues and records a warning when android app monitor stop fails", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorMockDriver({ stopError: new Error("monitor stop failed") });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Monitor Stop Failure",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo"
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "android_app_monitor",
          severity: "warning",
          summary: expect.stringContaining("failed to stop")
        })
      ])
    );
    expect(run.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "report_html", name: "report.html" })]));
  });

  it("replays tap_on_element by resolving the current Android UI hierarchy", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new UiHierarchyMockDriver(hierarchy("com.demo:id/join_class"));
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Semantic Element Flow",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 240, y: 240 }]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        status: "passed",
        metadata: expect.objectContaining({
          semantic: expect.objectContaining({
            type: "element",
            action: "tap"
          })
        })
      })
    );
  });

  it("records semantic Android backend channel when element actions use a semantic backend", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SemanticBackendMockDriver(hierarchy("com.demo:id/join_class"));
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Semantic Backend Flow",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([]);
    expect(driver.semanticActions).toEqual([
      expect.objectContaining({
        type: "tap_on_element",
        locator: expect.objectContaining({
          resourceId: "com.demo:id/join_class"
        }),
        fallbackTap: {
          x: 240,
          y: 240
        }
      })
    ]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        status: "passed",
        metadata: expect.objectContaining({
          semantic: expect.objectContaining({
            type: "element",
            action: "tap",
            driverChannel: "uiautomator2"
          }),
          actionBackend: expect.objectContaining({
            driverChannel: "uiautomator2"
          })
        })
      })
    );
  });

  it("fails tap_on_element without falling back to stale recorded coordinates", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new UiHierarchyMockDriver(hierarchy("com.demo:id/other"));
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Missing Semantic Element",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210, { timeoutMs: 1, intervalMs: 1 })],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "tap_on_element",
        status: "failed",
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        errorMessage: "Element target id=com.demo:id/join_class was not found."
      })
    );
  });

  it("inputs text into a semantic element during replay", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new UiHierarchyMockDriver(hierarchy("com.demo:id/search_box"));
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("hello class"));

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Semantic Input Flow",
      steps: [createInputTextToElementStep("com.demo:id/search_box", "hello class")],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 240, y: 240 },
      { type: "clear_text" },
      { type: "input_text", text: "hello class" }
    ]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "input_text_to_element",
        status: "passed",
        metadata: expect.objectContaining({
          semantic: expect.objectContaining({
            type: "element_input",
            action: "input_text"
          })
        })
      })
    );
  });

  it("scrolls until a semantic target is visible during replay", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/other"), hierarchy("com.demo:id/other"), hierarchy("com.demo:id/target")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Semantic Scroll Flow",
      steps: [createSemanticLocatorStep("scroll_until_visible", "com.demo:id/target", { direction: "down", maxSwipes: 3, intervalMs: 1 })],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "swipe", startX: 540, startY: 1800, endX: 540, endY: 600, durationMs: 450 }]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "scroll_until_visible",
        status: "passed",
        metadata: expect.objectContaining({
          semantic: expect.objectContaining({
            type: "scroll",
            action: "visible",
            swipes: 1
          })
        })
      })
    );
  });

  it("waits for semantic state before continuing replay", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/loading"), hierarchy("com.demo:id/loading"), hierarchy("com.demo:id/ready")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Semantic Wait Flow",
      steps: [
        createSemanticLocatorStep("wait_until_state", "com.demo:id/ready", { timeoutMs: 200, intervalMs: 1 }),
        driver.createTapStep(120, 240)
      ],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "wait_until_state",
        status: "passed",
        metadata: expect.objectContaining({
          semantic: expect.objectContaining({
            type: "state_wait",
            action: "matched",
            attempts: 2
          })
        })
      })
    );
  });

  it("does not start video recording unless explicitly enabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-video-"));
    try {
      const storage = new MemoryRunnerStorage();
      const driver = new VideoMockDriver(tempDir);
      const runner = new AutomationRunner(storage, driver);

      const started = runner.start({
        deviceSerial: driver.device.serial,
        caseName: "No Video By Default",
        steps: [driver.createTapStep(120, 240)],
        stepIntervalMs: 0
      });
      const run = await waitForRun(runner, storage, started.id);

      expect(run.status).toBe("passed");
      expect(run.config.recordVideo).toBe(false);
      expect(driver.recordings).toHaveLength(0);
      expect(run.artifacts.some((artifact) => artifact.type === "video")).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps successful run video when explicitly enabled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-video-"));
    try {
      const storage = new MemoryRunnerStorage();
      const driver = new VideoMockDriver(tempDir);
      const runner = new AutomationRunner(storage, driver);

      const started = runner.start({
        deviceSerial: driver.device.serial,
        caseName: "Successful Video",
        steps: [driver.createTapStep(120, 240)],
        stepIntervalMs: 0,
        recordVideo: true
      });
      const run = await waitForRun(runner, storage, started.id);

      expect(run.status).toBe("passed");
      expect(driver.videoKeepRequests).toEqual([true]);
      expect(run.artifacts.some((artifact) => artifact.type === "video")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("can drop successful run video only when explicitly requested by API", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-video-"));
    try {
      const storage = new MemoryRunnerStorage();
      const driver = new VideoMockDriver(tempDir);
      const runner = new AutomationRunner(storage, driver);

      const started = runner.start({
        deviceSerial: driver.device.serial,
        caseName: "Successful Video",
        steps: [driver.createTapStep(120, 240)],
        stepIntervalMs: 0,
        recordVideo: true,
        keepVideoOnSuccess: false
      });
      const run = await waitForRun(runner, storage, started.id);

      expect(run.status).toBe("passed");
      expect(driver.videoKeepRequests).toEqual([false]);
      expect(run.artifacts.some((artifact) => artifact.type === "video")).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps failed run video as failure evidence", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-video-"));
    try {
      const storage = new MemoryRunnerStorage();
      const driver = new VideoMockDriver(tempDir);
      driver.failActions = true;
      const runner = new AutomationRunner(storage, driver);

      const started = runner.start({
        deviceSerial: driver.device.serial,
        caseName: "Failed Video",
        steps: [driver.createTapStep(120, 240)],
        stepIntervalMs: 0,
        recordVideo: true
      });
      const run = await waitForRun(runner, storage, started.id);

      expect(run.status).toBe("failed");
      expect(driver.videoKeepRequests).toEqual([true]);
      expect(run.artifacts.some((artifact) => artifact.type === "video")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("pauses after each step and can advance one step at a time", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const firstStep = driver.createTapStep(120, 240);
    const secondStep = {
      ...driver.createTapStep(220, 340),
      id: "step-2",
      order: 2
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Paused Flow",
      steps: [firstStep, secondStep],
      stepIntervalMs: 0,
      recordVideo: false,
      pauseAfterEachStep: true
    });

    await waitForRunStatus(storage, started.id, "paused");
    expect(driver.actions).toHaveLength(1);

    runner.step(started.id);
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 120, y: 240 },
      { type: "tap", x: 220, y: 340 }
    ]);
  });

  it("runs loop mode until stopped", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Loop Flow",
      steps: [driver.createTapStep(120, 240)],
      mode: "loop_until_stop",
      stepIntervalMs: 0,
      recordVideo: false
    });

    await waitForActionCount(driver, 3);
    await runner.stop(started.id);
    const run = storage.getRun(started.id);

    expect(run?.status).toBe("stopped");
    expect(driver.actions.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects starting another run on a busy device", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Busy Flow",
      steps: [driver.createTapStep(120, 240)],
      mode: "loop_until_stop",
      stepIntervalMs: 0,
      recordVideo: false
    });

    await waitForActionCount(driver, 1);
    expect(runner.getActiveRunForDevice(driver.device.serial)?.runId).toBe(started.id);
    expect(() =>
      runner.start({
        deviceSerial: driver.device.serial,
        caseName: "Second Flow",
        steps: [driver.createTapStep(220, 340)],
        stepIntervalMs: 0,
        recordVideo: false
      })
    ).toThrow(DeviceExecutionBusyError);

    await runner.stop(started.id);
  });

  it("rejects a script run while stability exploration owns the device", () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    const executionLease = new DeviceExecutionLease();
    executionLease.acquire(driver.device.serial, "stability-run", "stability_exploration");
    const runner = new AutomationRunner(storage, driver, undefined, { executionLease });

    expect(() => runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Blocked Flow",
      steps: [driver.createTapStep(120, 240)],
      recordVideo: false
    })).toThrow(DeviceExecutionBusyError);
  });

  it("records watched Android crash events and fails the run", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new EventMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Crash Flow",
      steps: [
        driver.createTapStep(120, 240),
        {
          ...driver.createTapStep(220, 340),
          id: "step-2",
          order: 2
        }
      ],
      stepIntervalMs: 0,
      recordVideo: false,
      startAppPackageName: "demo.app"
    });

    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(run.stepResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          errorCode: "DEVICE_EVENT_FAILED",
          errorMessage: "Run stopped after Android app crash event."
        })
      ])
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "crash",
          summary: "Android crash detected"
        })
      ])
    );
    expect(run.events.some((event) => event.summary === "Runner execution failed")).toBe(false);
    expect(run.artifacts.some((artifact) => artifact.type === "log" && artifact.name.includes("device-event-crash"))).toBe(true);
    expect(run.artifacts.some((artifact) => artifact.type === "screenshot" && artifact.name.includes("crash"))).toBe(true);
    expect(driver.watchOptions).toEqual(expect.objectContaining({ packageName: "demo.app" }));
  });

  it("passes no_crash and app_alive expectations after a successful step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [
      createExpectation("no_crash"),
      createExpectation("app_alive")
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Expectation Pass",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "no_crash", status: "passed" }),
        expect.objectContaining({ type: "app_alive", status: "passed" })
      ])
    );
  });

  it("fails the run when a metric_below expectation is not met", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [createExpectation("metric_below", { metric: "cpuPercent", threshold: 0 })]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Metric Expectation Fail",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "EXPECTATION_FAILED"
      })
    );
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "metric_below",
        status: "failed",
        expected: "cpuPercent <= 0",
        actual: "cpuPercent = 1"
      })
    ]);
  });

  it("evaluates log_not_contains expectations against collected logs", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    driver.logs.push("Activity resumed", "Frame rendered");
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [createExpectation("log_not_contains", { text: "FATAL EXCEPTION" })]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Log Expectation Pass",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual([expect.objectContaining({ type: "log_not_contains", status: "passed" })]);
    expect(run.artifacts.some((artifact) => artifact.type === "log" && artifact.name.includes("expectation-log"))).toBe(true);
  });

  it("passes text expectations when OCR contains the expected text", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("欢迎进入课堂 已开始"));
    const step = withExpectations(driver.createTapStep(120, 240), [createExpectation("text", { expected: "课堂 已开始", mode: "contains" })]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Text Expectation Pass",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "text",
        status: "passed",
        expected: 'OCR text contains "课堂 已开始".',
        actual: "欢迎进入课堂 已开始"
      })
    ]);
  });

  it("waits for text expectations until the target text appears after loading", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new ChangingScreenshotMockDriver();
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceOcrService(["Classin empower education online", "全部班级 我是教师 我是学生"]);
    const runner = new AutomationRunner(storage, driver, ocr);
    const step = withExpectations(driver.createTapStep(120, 240), [
      createExpectation("text", {
        expected: "全部班级",
        mode: "contains",
        timeoutMs: 200,
        intervalMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Text Expectation Wait",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(ocr.calls).toBe(2);
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "text",
        status: "passed",
        actual: "全部班级 我是教师 我是学生",
        reason: expect.stringContaining("Matched after 2 observation attempts")
      })
    ]);
    expect(run.artifacts.filter((artifact) => artifact.type === "screenshot")).toHaveLength(2);
  });

  it("waits for text preconditions before performing the action", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new ChangingScreenshotMockDriver();
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceOcrService(["登录页", "进入课堂"]);
    const runner = new AutomationRunner(storage, driver, ocr);
    const step = withPreconditions(driver.createTapStep(120, 240), [
      createExpectation("text", {
        expected: "进入课堂",
        mode: "contains",
        timeoutMs: 200,
        intervalMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Precondition Wait",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(ocr.calls).toBe(2);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "passed",
        metadata: expect.objectContaining({
          preconditions: expect.objectContaining({
            status: "passed",
            results: [expect.objectContaining({ type: "text", status: "passed", actual: "进入课堂" })]
          })
        })
      })
    );
  });

  it("fails without performing the action when text preconditions are not satisfied", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("登录页"));
    const step = withPreconditions(driver.createTapStep(120, 240), [
      createExpectation("text", {
        expected: "进入课堂",
        mode: "contains",
        timeoutMs: 1,
        intervalMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Precondition Fail",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "PRECONDITION_FAILED",
        metadata: expect.objectContaining({
          preconditions: expect.objectContaining({
            status: "failed",
            results: [expect.objectContaining({ type: "text", status: "failed", actual: "登录页" })]
          })
        })
      })
    );
  });

  it("blocks a script action when its required page is not matched", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const requests: Array<{ pageId: string; appId: string }> = [];
    const runner = new AutomationRunner(storage, driver, undefined, {
      verifyPageState: async (request) => {
        requests.push({ pageId: request.pageId, appId: request.appId });
        return { status: "unknown", reason: "page evidence did not match" };
      }
    });
    const recordedTap = driver.createTapStep(120, 240);
    const step = withPreconditions({
      ...recordedTap,
      params: {
        ...recordedTap.params,
        scriptFlowId: "flow-1",
        scriptStepId: "open-class"
      }
    }, [
      createExpectation("state_is", {
        appId: "cn.eeo.classin",
        platform: "android",
        pageId: "classin.home",
        timeoutMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Script page precondition",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(requests).toEqual([{ pageId: "classin.home", appId: "cn.eeo.classin" }]);
    expect(run.stepResults[0]).toEqual(expect.objectContaining({
      errorCode: "PRECONDITION_FAILED",
      metadata: expect.objectContaining({
        scriptFlowId: "flow-1",
        scriptStepId: "open-class",
        preconditions: expect.objectContaining({ status: "failed" })
      })
    }));
  });

  it("fails text expectations when OCR text does not match", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("登录页"));
    const step = withExpectations(driver.createTapStep(120, 240), [
      createExpectation("text", { expected: "课堂已开始", mode: "contains", timeoutMs: 1, intervalMs: 1 })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Text Expectation Fail",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "text",
        status: "failed",
        actual: "登录页"
      })
    ]);
    expect(run.stepResults[0]?.errorCode).toBe("EXPECTATION_FAILED");
  });

  it("marks text expectations unsupported when OCR is unavailable", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FailingOcrService());
    const step = withExpectations(driver.createTapStep(120, 240), [createExpectation("text", { expected: "课堂已开始" })]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Text Expectation Unsupported",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "text",
        status: "unsupported",
        actual: "OCR could not be executed.",
        reason: "OCR engine unavailable"
      })
    ]);
    expect(run.stepResults[0]?.errorCode).toBe("EXPECTATION_FAILED");
  });

  it("can verify that a step changed the screen", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new ChangingScreenshotMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [createExpectation("screen_changed")]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Screen Changed",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.stepResults[0]?.expectationResults).toEqual([expect.objectContaining({ type: "screen_changed", status: "passed" })]);
    expect(run.stepResults[0]?.artifacts.filter((artifact) => artifact.type === "screenshot")).toHaveLength(2);
  });

  it("waits for post-action screen expectations before deciding the step result", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SequenceScreenshotMockDriver([Buffer.from("before"), Buffer.from("before"), Buffer.from("after")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [
      createExpectation("screen_changed", {
        timeoutMs: 100,
        intervalMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Delayed Screen Changed",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.screenshotCount).toBeGreaterThanOrEqual(3);
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "screen_changed",
        status: "passed",
        reason: expect.stringContaining("Matched after")
      })
    ]);
  });

  it("keeps non-blocking automatic visual expectations from failing the run", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);
    const step = withExpectations(driver.createTapStep(120, 240), [
      createExpectation("screen_changed", {
        autoGenerated: true,
        reliability: "P1",
        blocking: false
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Non Blocking Screen Changed",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "passed"
      })
    );
    expect(run.stepResults[0]?.errorCode).toBeUndefined();
    expect(run.stepResults[0]?.expectationResults).toEqual([
      expect.objectContaining({
        type: "screen_changed",
        status: "failed",
        blocking: false,
        reason: expect.stringContaining("Non-blocking expectation")
      })
    ]);
  });

  it("executes tap_if_text when the optional text condition is visible", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("允许 通知权限"));
    const step = createConditionalTapStep("允许", 320, 880);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Optional Popup Hit",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 320, y: 880 }]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        type: "tap_if_text",
        status: "passed",
        metadata: expect.objectContaining({
          condition: expect.objectContaining({
            matched: true,
            action: "tap",
            actual: "允许 通知权限"
          })
        })
      })
    );
  });

  it("skips tap_if_text when the optional text condition is absent and continues replay", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new FakeOcrService("首页"));
    const optionalStep = createConditionalTapStep("允许", 320, 880);
    const nextStep = {
      ...driver.createTapStep(120, 240),
      id: "next-step",
      order: 2
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Optional Popup Miss",
      steps: [optionalStep, nextStep],
      stepIntervalMs: 0,
      recordVideo: false,
      stopOnFailure: true
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(run.stepResults.map((stepResult) => stepResult.status)).toEqual(["skipped", "passed"]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        errorCode: "CONDITION_NOT_MET",
        metadata: expect.objectContaining({
          condition: expect.objectContaining({
            matched: false,
            action: "skip",
            actual: "首页"
          })
        })
      })
    );
  });

  it("handles common blocking popups before resolving the structured step action", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SequenceUiHierarchyMockDriver([permissionHierarchy("允许"), hierarchy("com.demo:id/join_class")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Runtime Interceptor Flow",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 540, y: 1820 },
      { type: "tap", x: 240, y: 240 }
    ]);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        runtimeInterceptors: [
          expect.objectContaining({
            phase: "precondition",
            ruleName: "Android 权限允许",
            matchedText: "允许"
          })
        ]
      })
    );
  });

  it("loads custom runtime interceptor rules before resolving the structured step action", async () => {
    const storage = new MemoryRunnerStorage();
    storage.runtimeInterceptorRules.push({
      id: "rule-subject-picker",
      name: "选择学科临时页",
      enabled: true,
      platformScope: "android",
      appPackageName: "com.example.app",
      matchers: [{ type: "text", value: "选择学科" }],
      action: {
        type: "tap_text",
        text: "关闭"
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const driver = new SequenceUiHierarchyMockDriver([subjectPickerHierarchy(), hierarchy("com.demo:id/join_class")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Runtime Interceptor Custom Rule Flow",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "tap", x: 960, y: 160 },
      { type: "tap", x: 240, y: 240 }
    ]);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        runtimeInterceptors: [
          expect.objectContaining({
            phase: "precondition",
            ruleName: "选择学科临时页",
            matchedText: "选择学科"
          })
        ]
      })
    );
  });

  it("applies go_home start strategy before replaying steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Start From Home",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "go_home"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "home" },
      { type: "tap", x: 120, y: 240 }
    ]);
    expect(run.config.startStrategy).toBe("go_home");
  });

  it("applies restart_app start strategy before replaying steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Restart App",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "restart_app",
      startAppPackageName: "demo.app"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "tap", x: 120, y: 240 }
    ]);
  });

  it("applies clear_data_and_launch start strategy before replaying steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Clear Data And Launch",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "clear_data_and_launch",
      startAppPackageName: "demo.app"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.clearedAppData).toEqual(["demo.app"]);
    expect(driver.setupActions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "clear_app_data", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" }
    ]);
    expect(driver.actions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "tap", x: 120, y: 240 }
    ]);
    expect(run.config.startSetupScope).toBe("before_run");
  });

  it("can apply start setup before each repeat iteration", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Setup Per Iteration",
      steps: [driver.createTapStep(120, 240)],
      mode: "repeat_n",
      repeatCount: 2,
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "clear_data_and_launch",
      startAppPackageName: "demo.app",
      startSetupScope: "before_each_iteration"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.clearedAppData).toEqual(["demo.app", "demo.app"]);
    expect(driver.setupActions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "clear_app_data", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "close_app", packageName: "demo.app" },
      { type: "clear_app_data", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" }
    ]);
    expect(driver.actions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "tap", x: 120, y: 240 },
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "tap", x: 120, y: 240 }
    ]);
  });

  it("fails before replaying steps when start strategy is invalid", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Invalid Start Strategy",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "launch_app"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults).toEqual([]);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "start_state_failed",
          summary: "Flow start state failed"
        })
      ])
    );
  });
});

function reachPageStep(targetPageId: string, navigationEdges: unknown[]): ActionStep {
  return {
    id: "reach-page",
    order: 1,
    type: "reach_page",
    enabled: true,
    title: "到达目标页",
    params: {
      appId: "cn.eeo.classin",
      platform: "android",
      pageId: targetPageId,
      targetPageId,
      policy: "safe",
      navigationEdges
    },
    createdAt: nowIso()
  };
}

function pageStateSequence(pageIds: string[]): PageStateService {
  let current = 0;
  const result = () => {
    const pageId = pageIds[Math.min(current, pageIds.length - 1)] ?? "page-unknown";
    return {
      status: "matched" as const,
      page: {
        id: pageId,
        key: pageId,
        name: pageId,
        appId: "cn.eeo.classin",
        graphVersionId: "v1",
        matcherCount: 1
      },
      candidates: []
    };
  };
  return {
    identifyCurrentPage: async () => result(),
    verifyExpectedPage: async () => result(),
    waitForExpectedPage: async () => {
      current += 1;
      return result();
    }
  };
}

function createExpectation(type: StepExpectation["type"], params: Record<string, unknown> = {}): StepExpectation {
  return {
    id: `expectation-${type}-${Math.random().toString(16).slice(2)}`,
    type,
    enabled: true,
    params,
    createdAt: new Date().toISOString()
  };
}

function withExpectations(step: ActionStep, expectations: StepExpectation[]): ActionStep {
  return {
    ...step,
    expectations
  };
}

function withPreconditions(step: ActionStep, preconditions: StepExpectation[]): ActionStep {
  return {
    ...step,
    preconditions
  };
}

function createConditionalTapStep(text: string, x: number, y: number): ActionStep {
  return {
    id: `conditional-${Math.random().toString(16).slice(2)}`,
    order: 1,
    type: "tap_if_text",
    enabled: true,
    params: {
      text,
      mode: "contains",
      timeoutMs: 1,
      intervalMs: 1
    },
    coordinate: {
      x,
      y,
      xRatio: x / 1080,
      yRatio: y / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: new Date().toISOString()
  };
}

function createElementTapStep(resourceId: string, x: number, y: number, params: Record<string, unknown> = {}): ActionStep {
  return {
    id: `element-${Math.random().toString(16).slice(2)}`,
    order: 1,
    type: "tap_on_element",
    enabled: true,
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId,
        packageName: "com.demo"
      },
      selector: `id=${resourceId}`,
      ...params
    },
    coordinate: {
      x,
      y,
      xRatio: x / 1080,
      yRatio: y / 2400,
      deviceWidth: 1080,
      deviceHeight: 2400
    },
    createdAt: new Date().toISOString()
  };
}

function createInputTextToElementStep(resourceId: string, text: string): ActionStep {
  return {
    ...createSemanticLocatorStep("input_text_to_element", resourceId, {
      text,
      clearFirst: true
    }),
    title: "输入文字"
  };
}

function createSemanticLocatorStep(type: ActionStep["type"], resourceId: string, params: Record<string, unknown> = {}): ActionStep {
  return {
    id: `${type}-${Math.random().toString(16).slice(2)}`,
    order: 1,
    type,
    enabled: true,
    params: {
      locator: {
        strategy: "android_uiautomator",
        resourceId,
        packageName: "com.demo"
      },
      selector: `id=${resourceId}`,
      ...params
    },
    createdAt: new Date().toISOString()
  };
}

function hierarchy(resourceId: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="进入课堂" resource-id="${resourceId}" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
  </node>
</hierarchy>`;
}

function permissionHierarchy(text: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.permissioncontroller" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="${text}" resource-id="android:id/button1" class="android.widget.Button" package="com.android.permissioncontroller" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[420,1780][660,1860]" />
  </node>
</hierarchy>`;
}

function subjectPickerHierarchy(): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="选择学科" resource-id="com.demo:id/title" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,90][420,160]" />
    <node index="1" text="关闭" resource-id="com.demo:id/close" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[900,120][1020,200]" />
  </node>
</hierarchy>`;
}

class MemoryRunnerStorage implements RunnerStorage {
  private readonly runs = new Map<string, TestRun>();
  readonly writes: Array<{ relativePath: string; bytes: Buffer | string }> = [];
  readonly runtimeInterceptorRules: RuntimeInterceptorRule[] = [];

  createRun(input: { id?: string; caseName: string; deviceSerial: string; configJson: string; runSnapshotJson: string; steps: ActionStep[] }): TestRun {
    const now = new Date().toISOString();
    const run: TestRun = {
      id: input.id ?? `run-${this.runs.size + 1}`,
      caseName: input.caseName,
      deviceSerial: input.deviceSerial,
      status: "running",
      config: JSON.parse(input.configJson) as TestRun["config"],
      steps: input.steps,
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: now
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): TestRun | undefined {
    return this.runs.get(id);
  }

  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void {
    const run = this.mustGetRun(runId);
    run.status = status;
    if (["pending", "running", "paused"].includes(status)) {
      run.endedAt = undefined;
      return;
    }
    run.endedAt = endedAt ?? new Date().toISOString();
  }

  updateRunReport(runId: string, relativePath: string): void {
    this.mustGetRun(runId).reportHtmlPath = relativePath;
  }

  addStepResult(result: StepResult): void {
    this.mustGetRun(result.runId).stepResults.push({ ...result, artifacts: result.artifacts.slice() });
  }

  addArtifact(artifact: ArtifactRef): void {
    const run = artifact.runId ? this.mustGetRun(artifact.runId) : undefined;
    if (!run) {
      return;
    }
    run.artifacts.push(artifact);
    if (artifact.stepResultId) {
      const stepResult = run.stepResults.find((result) => result.id === artifact.stepResultId);
      stepResult?.artifacts.push(artifact);
    }
  }

  addMetricSample(sample: MetricSample): void {
    this.mustGetRun(sample.runId).metrics.push(sample);
  }

  addDeviceEvent(event: DeviceEvent): void {
    this.mustGetRun(event.runId).events.push(event);
  }

  listRunIdsByStatus(status: TestRun["status"]): string[] {
    return Array.from(this.runs.values())
      .filter((run) => run.status === status)
      .map((run) => run.id);
  }

  async writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }> {
    this.writes.push({ relativePath, bytes });
    return {
      absolutePath: `/memory/${relativePath}`,
      sizeBytes: Buffer.byteLength(bytes)
    };
  }

  listRuntimeInterceptorRules(filter: { enabledOnly?: boolean; platform?: "android" | "ios"; appPackageName?: string } = {}): RuntimeInterceptorRule[] {
    return this.runtimeInterceptorRules.filter((rule) => {
      if (filter.enabledOnly && !rule.enabled) {
        return false;
      }
      if (filter.platform && rule.platformScope && rule.platformScope !== "mobile-both" && rule.platformScope !== filter.platform) {
        return false;
      }
      if (filter.appPackageName && rule.appPackageName && rule.appPackageName !== filter.appPackageName) {
        return false;
      }
      return true;
    });
  }

  private mustGetRun(runId: string): TestRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }
}

class VideoMockDriver extends MockDriver {
  readonly videoKeepRequests: boolean[] = [];
  failActions = false;

  constructor(private readonly tempDir: string) {
    super();
    this.device.capabilities.recordVideo = true;
  }

  override async startVideoRecording(serial: string, runId: string, _localDir: string): Promise<MockVideoRecording> {
    this.assertKnownMockDevice(serial);
    const localPath = path.join(this.tempDir, `${runId}.mp4`);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, "mock-video");
    const recording = {
      id: runId,
      serial,
      localPath,
      startedAt: new Date().toISOString()
    };
    this.recordings.push(recording);
    return recording;
  }

  override async stopVideoRecording(recording: MockVideoRecording, keep: boolean): Promise<string | undefined> {
    this.videoKeepRequests.push(keep);
    return keep ? recording.localPath : undefined;
  }

  override async performAction(serial: string, action: Parameters<MockDriver["performAction"]>[1]): ReturnType<MockDriver["performAction"]> {
    if (this.failActions) {
      throw new Error("mock action failed");
    }
    return super.performAction(serial, action);
  }

  private assertKnownMockDevice(serial: string): void {
    if (serial !== this.device.serial) {
      throw new Error(`Mock device not found: ${serial}`);
    }
  }
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

class SemanticBackendMockDriver extends UiHierarchyMockDriver {
  readonly semanticActions: SemanticDeviceActionRequest[] = [];

  async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<{ driverChannel: "uiautomator2"; details: { selector?: string } }> {
    await this.getDeviceInfo(serial);
    this.semanticActions.push(action);
    return {
      driverChannel: "uiautomator2",
      details: {
        selector: action.locator.resourceId ?? action.locator.contentDesc ?? action.locator.text
      }
    };
  }
}

class SequenceUiHierarchyMockDriver extends MockDriver {
  private dumpCount = 0;

  constructor(private readonly xmlSequence: string[]) {
    super();
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    await this.getDeviceInfo(serial);
    const index = Math.min(this.dumpCount, this.xmlSequence.length - 1);
    this.dumpCount += 1;
    return this.xmlSequence[index] ?? hierarchy("com.demo:id/join_class");
  }
}

class EventMockDriver extends MockDriver {
  private eventListener?: (event: ObservedDeviceEvent) => void;
  private emittedCrash = false;
  watchOptions?: { since?: Date; packageName?: string };

  async watchDeviceEvents(
    _serial: string,
    onEvent: (event: ObservedDeviceEvent) => void,
    options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher> {
    this.eventListener = onEvent;
    this.watchOptions = options;
    return {
      stop: async () => undefined
    };
  }

  override async performAction(serial: string, action: Parameters<MockDriver["performAction"]>[1]): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (!this.emittedCrash) {
      this.emittedCrash = true;
      this.eventListener?.({
        type: "crash",
        severity: "error",
        occurredAt: new Date().toISOString(),
        summary: "Android crash detected",
        detail: "FATAL EXCEPTION: main\nProcess: demo.app"
      });
    }
    return result;
  }
}

class AppMonitorMockDriver extends MockDriver {
  readonly monitorStarts: Array<{ serial: string; runId: string; config: AndroidAppMonitorConfig }> = [];
  monitorStopCount = 0;

  constructor(
    private readonly monitorData: {
      cpu?: AndroidProcessMetricSample[];
      memory?: AndroidProcessMetricSample[];
      lifecycle?: AndroidProcessLifecycleEvent[];
      incidents?: AndroidAppMonitorIncident[];
      startError?: Error;
      stopError?: Error;
    } = {}
  ) {
    super();
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
    if (this.monitorData.startError) {
      throw this.monitorData.startError;
    }
    this.monitorStarts.push({ serial, runId, config });
    let started = false;
    return {
      start: async () => {
        if (started) {
          return;
        }
        started = true;
        for (const event of this.monitorData.lifecycle ?? [{ occurredAt: nowIso(), type: "process_started", pid: 123, processName: config.packageName }]) {
          await callbacks.onLifecycleEvent?.(event);
        }
        for (const sample of this.monitorData.cpu ?? [{ sampledAt: nowIso(), pid: 123, processName: config.packageName, cpuPercent: 18.5 }]) {
          await callbacks.onSample?.(sample, "cpu");
        }
        for (const sample of this.monitorData.memory ?? [{ sampledAt: nowIso(), pid: 123, processName: config.packageName, pssKb: 2048, rssKb: 4096 }]) {
          await callbacks.onSample?.(sample, "memory");
        }
        for (const incident of this.monitorData.incidents ?? []) {
          await callbacks.onIncident?.(incident);
        }
      },
      stop: async () => {
        this.monitorStopCount += 1;
        if (this.monitorData.stopError) {
          throw this.monitorData.stopError;
        }
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

class ChangingScreenshotMockDriver extends MockDriver {
  private screenshotCount = 0;

  override async screenshot(serial: string): Promise<Buffer> {
    await this.getDeviceInfo(serial);
    this.screenshotCount += 1;
    return Buffer.from(`mock-screenshot-${this.screenshotCount}`);
  }
}

class SequenceScreenshotMockDriver extends MockDriver {
  screenshotCount = 0;

  constructor(private readonly screenshots: Buffer[]) {
    super();
  }

  override async screenshot(serial: string): Promise<Buffer> {
    await this.getDeviceInfo(serial);
    const screenshot = this.screenshots[Math.min(this.screenshotCount, this.screenshots.length - 1)] ?? Buffer.from("fallback");
    this.screenshotCount += 1;
    return screenshot;
  }
}

class FakeOcrService implements OcrService {
  constructor(private readonly text: string) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    return {
      text: this.text,
      engine: "fake",
      lang: input.lang ?? "test"
    };
  }
}

class SequenceOcrService implements OcrService {
  calls = 0;

  constructor(private readonly texts: string[]) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const text = this.texts[Math.min(this.calls, this.texts.length - 1)] ?? "";
    this.calls += 1;
    return {
      text,
      engine: "fake",
      lang: input.lang ?? "test"
    };
  }
}

class FailingOcrService implements OcrService {
  async recognize(_input: OcrInput): Promise<OcrResult> {
    throw new Error("OCR engine unavailable");
  }
}

async function waitForRun(runner: AutomationRunner, storage: MemoryRunnerStorage, runId: string): Promise<TestRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!runner.isRunning(runId)) {
      const run = storage.getRun(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }
      return run;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Run did not finish: ${runId}`);
}

async function waitForRunStatus(storage: MemoryRunnerStorage, runId: string, status: TestRun["status"]): Promise<TestRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = storage.getRun(runId);
    if (run?.status === status) {
      return run;
    }
    await delay(10);
  }
  throw new Error(`Run did not reach ${status}: ${runId}`);
}

async function waitForActionCount(driver: MockDriver, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (driver.actions.length >= count) {
      return;
    }
    await delay(10);
  }
  throw new Error(`Expected at least ${count} actions, got ${driver.actions.length}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
