import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MockDriver, type MockVideoRecording } from "@mobile-automation/test-support";
import {
  type ActionStep,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type ArtifactRef,
  type DeviceEvent,
  type ExecutionProfileSnapshot,
  type MetricSample,
  nowIso,
  type SemanticDeviceActionRequest,
  type StepExpectation,
  type StepResult,
  type TestRun
} from "@mobile-automation/shared";
import { AutomationRunner, type RunnerStorage } from "./automation-runner.js";
import { DeviceExecutionBusyError, DeviceExecutionLease } from "./device-execution-lease.js";
import type { DeviceEventWatcher, MobileAppMonitorSession, ObservedDeviceEvent } from "./device-driver.js";
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
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "already_on_target",
      targetScreenRef: "page-home",
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
      sourceSnapshot: navigationSourceSnapshot(),
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

  it("fails without device actions when the current page is unknown", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentScreen: async () => {
          identifyCount += 1;
          if (identifyCount === 1) return { status: "unknown", candidates: [] };
          return {
            status: "matched",
            screen: {
              id: "page-home",
              key: "page-home",
              screenRef: "page-home",
              name: "主页",
              appId: "cn.eeo.classin",
              graphVersionId: "v1",
              matcherCount: 1
            },
            candidates: []
          };
        },
        verifyExpectedScreen: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedScreen: async () => ({ status: "unknown", candidates: [] })
      }
    });

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [reachPageStep("page-home", [])],
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(identifyCount).toBe(1);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "current_page_unknown"
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
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "no_reliable_path",
      currentScreenRef: "page-class-detail"
    }));
  });

  it("does not backtrack to search for a page that can reach the target", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const page = (id: string, name: string) => ({
      status: "matched" as const,
      screen: {
        id,
        key: id,
        screenRef: id,
        name,
        appId: "cn.eeo.classin",
        graphVersionId: "v1",
        matcherCount: 1
      },
      candidates: []
    });
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentScreen: async () => {
          identifyCount += 1;
          return identifyCount === 1
            ? page("page-class-detail", "班级详情")
            : page("page-home", "主页");
        },
        verifyExpectedScreen: async () => page("page-growth", "成长"),
        waitForExpectedScreen: async () => page("page-growth", "成长")
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
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(identifyCount).toBe(1);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "no_reliable_path",
      currentScreenRef: "page-class-detail",
      route: []
    }));
  });

  it("ignores legacy back-recovery flags on preparation steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentScreen: async () => {
          identifyCount += 1;
          const id = identifyCount === 1 ? "page-class-detail" : "page-home";
          return {
            status: "matched",
            screen: {
              id,
              key: id,
              screenRef: id,
              name: id === "page-home" ? "主页" : "班级详情",
              appId: "cn.eeo.classin",
              graphVersionId: "v1",
              matcherCount: 1
            },
            candidates: []
          };
        },
        verifyExpectedScreen: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedScreen: async () => ({ status: "unknown", candidates: [] })
      }
    });
    const step = reachPageStep("page-home", []);
    step.params.allowBackRecovery = true;
    step.params.recoveryStopPageIds = ["page-home", "page-login"];
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(identifyCount).toBe(1);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "no_reliable_path",
      currentScreenRef: "page-class-detail"
    }));
  });

  it("reports no reliable path without interpreting navigation roots", async () => {
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
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "no_reliable_path",
      currentScreenRef: "page-login"
    }));
  });

  it("does not press back to discover a page when page identity is unknown", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    let identifyCount = 0;
    const runner = new AutomationRunner(storage, driver, undefined, {
      pageStateService: {
        identifyCurrentScreen: async () => {
          identifyCount += 1;
          if (identifyCount === 1) return { status: "unknown", candidates: [] };
          return {
            status: "outside_app",
            actualAppId: "com.android.launcher",
            candidates: []
          };
        },
        verifyExpectedScreen: async () => ({ status: "unknown", candidates: [] }),
        waitForExpectedScreen: async () => ({ status: "unknown", candidates: [] })
      }
    });
    const step = reachPageStep("page-growth", []);
    step.params.recoveryDelayMs = 0;

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [step],
      sourceSnapshot: navigationSourceSnapshot(),
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([]);
    expect(identifyCount).toBe(1);
    expect(run.stepResults[0]?.metadata?.pageNavigation).toEqual(expect.objectContaining({
      status: "current_page_unknown",
      currentStatus: "unknown"
    }));
  });

  it("persists redacted steps while executing the in-memory runtime steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const step = driver.createTapStep(120, 240);
    step.params = {
      ...step.params,
      interactionAssetId: "asset-home-add",
      interactionAssetKey: "classin.home.tap.icon.add",
      interactionAssetVersion: 2
    };

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
        interactionAssetId: "asset-home-add",
        interactionAssetKey: "classin.home.tap.icon.add",
        interactionAssetVersion: 2,
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

  it("handles fixed delay wait steps in the runner without dispatching a device action", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const waitStep: ActionStep = {
      id: "wait-after-tap",
      order: 1,
      type: "wait",
      enabled: true,
      title: "等待 1 ms",
      params: { durationMs: 1 },
      createdAt: nowIso()
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Fixed Delay Wait",
      steps: [waitStep],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([]);
    expect(run.stepResults[0]).toEqual(expect.objectContaining({
      type: "wait",
      status: "passed",
      metadata: expect.objectContaining({
        actionBackend: expect.objectContaining({
          driverChannel: "runner",
          details: expect.objectContaining({ durationMs: 1 })
        })
      })
    }));
  });

  it("starts android app monitor and writes metric summary artifacts before report", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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

  it("does not run per-step foreground exit fallback when android app monitor is active", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new ForegroundCountingAppMonitorMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Monitor Foreground Cost",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startAppPackageName: "com.demo",
      androidAppMonitor: {
        enabled: true,
        packageName: "com.demo"
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.foregroundReadCount).toBe(2);
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
    const driver = new AppMonitorMockDriver({
      incidents: [incident],
      collectedLogs: [
        "--------- beginning of main",
        "08-15 10:57:38.400 I/Unrelated: noise before crash",
        "--------- beginning of crash",
        "08-15 10:57:38.425 E/AndroidRuntime(123): FATAL EXCEPTION: main",
        "08-15 10:57:38.425 E/AndroidRuntime(123): Process: com.demo, PID: 123",
        "08-15 10:57:38.425 E/AndroidRuntime(123): java.lang.IllegalStateException: broken state",
        "08-15 10:57:38.425 E/AndroidRuntime(123): \tat com.demo.MainActivity.onCreate(MainActivity.kt:42)",
        "08-15 10:57:38.425 E/AndroidRuntime(123): Caused by: java.lang.IllegalArgumentException: invalid state",
        "08-15 10:57:38.425 E/AndroidRuntime(123): \tat com.demo.StateValidator.validate(StateValidator.kt:19)",
        "08-15 10:57:38.500 E/AndroidRuntime(123): unrelated runtime diagnostic",
        "08-15 10:57:38.500 I/ActivityManager: Process com.demo (pid 123) has died"
      ].join("\n")
    });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    expect(driver.eventWatcherStartCount).toBe(0);
    expect(driver.logCollectionCount).toBe(1);
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "crash",
          severity: "error",
          summary: expect.stringContaining("Java crash detected"),
          detail: expect.stringContaining("java.lang.IllegalStateException: broken state")
        })
      ])
    );
    expect(run.events.filter((event) => event.type === "crash")).toHaveLength(1);
    const crashEvent = run.events.find((event) => event.type === "crash");
    expect(crashEvent?.detail).not.toContain("Unrelated: noise before crash");
    expect(crashEvent?.detail).not.toContain("Captured logcat");
    const crashLog = storage.writes.find((write) => write.relativePath.includes("android-app-monitor-crash-"));
    expect(crashLog?.bytes).toContain("java.lang.IllegalStateException: broken state");
    expect(crashLog?.bytes).not.toContain("Unrelated: noise before crash");
    expect(crashLog?.bytes).toBe([
      "FATAL EXCEPTION: main",
      "Process: com.demo, PID: 123",
      "java.lang.IllegalStateException: broken state",
      "\tat com.demo.MainActivity.onCreate(MainActivity.kt:42)",
      "Caused by: java.lang.IllegalArgumentException: invalid state",
      "\tat com.demo.StateValidator.validate(StateValidator.kt:19)"
    ].join("\n"));
    expect(crashLog?.bytes).not.toContain("unrelated runtime diagnostic");
    expect(crashLog?.bytes).not.toMatch(/08-15|AndroidRuntime/);
    expect(run.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "log",
          name: expect.stringMatching(/^android-app-monitor-crash-/)
        }),
        expect.objectContaining({
          type: "screenshot",
          name: expect.stringMatching(/^crash-/)
        })
      ])
    );
  });

  it("keeps process death monitor events concise instead of attaching crash log evidence", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorMockDriver({
      incidents: [{
        id: "incident-process-death",
        type: "process_death",
        severity: "error",
        occurredAt: nowIso(),
        processName: "com.demo",
        pid: 123,
        summary: "Process death detected: com.demo",
        detail: "ActivityManager: Process com.demo (pid 123) has died",
        artifactIds: []
      }],
      collectedLogs: "--------- beginning of crash\nFATAL EXCEPTION: main\njava.lang.IllegalStateException: stale"
    });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Monitor Process Death",
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
    expect(driver.logCollectionCount).toBe(0);
    expect(run.events.find((event) => event.type === "process_death")?.detail).toContain("Process com.demo");
    expect(run.artifacts.some((artifact) => artifact.name.includes("android-app-monitor-process_death"))).toBe(false);
  });

  it("continues and records a warning when android app monitor stop fails", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorMockDriver({ stopError: new Error("monitor stop failed") });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/other"), hierarchy("com.demo:id/target")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/loading"), hierarchy("com.demo:id/ready")]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
      const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
      const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
      const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
      const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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

  it("does not mark a run stopped when it does not own the active worker", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    storage.createRun({
      id: "stability-run",
      caseName: "Stability run",
      deviceSerial: driver.device.serial,
      configJson: "{}",
      runSnapshotJson: "{}",
      steps: []
    });

    await expect(runner.stop("stability-run")).resolves.toBe(false);
    expect(storage.getRun("stability-run")?.status).toBe("running");
  });

  it("does not execute per-iteration reset steps during a single run", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const business = {
      ...driver.createTapStep(20, 20),
      id: "business",
      params: { executionPhase: "business" }
    };
    const reset = {
      ...driver.createTapStep(30, 30),
      id: "reset",
      order: 2,
      params: { executionPhase: "reset" }
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Single Run",
      steps: [business, reset],
      mode: "once",
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 20, y: 20 }]);
  });

  it("executes a per-iteration reset step when it is selected for a step trial", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const reset = {
      ...driver.createTapStep(30, 30),
      id: "reset",
      params: { executionPhase: "reset" }
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Reset Step Trial",
      steps: [reset],
      mode: "once",
      stepIntervalMs: 0,
      recordVideo: false,
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "flow-reset-trial",
        version: 1,
        planDigest: "digest-reset-trial",
        executionPurpose: "step_trial",
        dependencies: [],
        parsed: {}
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([{ type: "tap", x: 30, y: 30 }]);
  });

  it("does not execute per-iteration reset steps when looping the whole case", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const business = {
      ...driver.createTapStep(20, 20),
      id: "business",
      params: { executionPhase: "business" }
    };
    const reset = {
      ...driver.createTapStep(30, 30),
      id: "reset",
      order: 2,
      params: { executionPhase: "reset" }
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Whole Case Loop",
      steps: [business, reset],
      mode: "loop_until_stop",
      loopScope: "all_steps",
      stepIntervalMs: 0,
      recordVideo: false
    });

    await waitForMatchingActionCount(driver, (action) => action.type === "tap" && action.x === 20, 3);
    await runner.stop(started.id);

    expect(driver.actions.filter((action) => action.type === "tap" && action.x === 30)).toHaveLength(0);
  });

  it("runs preparation once when looping only business and verification steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const preparation = {
      ...driver.createTapStep(10, 10),
      id: "prepare",
      params: { executionPhase: "preparation" }
    };
    const business = {
      ...driver.createTapStep(20, 20),
      id: "business",
      order: 3,
      params: { executionPhase: "business" }
    };
    const reset = {
      ...driver.createTapStep(30, 30),
      id: "reset",
      order: 2,
      params: { executionPhase: "reset" }
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Loop Business Only",
      steps: [preparation, reset, business],
      mode: "loop_until_stop",
      loopScope: "exclude_preparation",
      stepIntervalMs: 0,
      recordVideo: false
    });

    await waitForMatchingActionCount(driver, (action) => action.type === "tap" && action.x === 20, 3);
    await runner.stop(started.id);

    expect(driver.actions.filter((action) => action.type === "tap" && action.x === 10)).toHaveLength(1);
    expect(driver.actions.filter((action) => action.type === "tap" && action.x === 20).length).toBeGreaterThanOrEqual(3);
    expect(driver.actions.slice(0, 5)).toEqual([
      { type: "tap", x: 10, y: 10 },
      { type: "tap", x: 20, y: 20 },
      { type: "tap", x: 30, y: 30 },
      { type: "tap", x: 20, y: 20 },
      { type: "tap", x: 30, y: 30 }
    ]);
  });

  it("force-stops the app before a script launch step marked for restart", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const launchStep: ActionStep = {
      id: "launch",
      order: 1,
      type: "launch_app",
      enabled: true,
      params: { packageName: "demo.app", restartBeforeLaunch: true },
      createdAt: nowIso()
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      steps: [launchStep],
      stepIntervalMs: 0,
      recordVideo: false,
      startStrategy: "keep_current"
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" }
    ]);
  });

  it("rejects starting another run on a busy device", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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

  it("records watched Android native crash events and fails the run", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new EventMockDriver({
      type: "native_crash",
      severity: "error",
      occurredAt: new Date().toISOString(),
      summary: "Native crash detected: demo.app",
      detail: "Fatal signal 11 (SIGSEGV)",
      processName: "demo.app",
      pid: 1234
    });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Native Crash Flow",
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
          errorMessage: "Run stopped after Android app native crash event."
        })
      ])
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "native_crash",
          severity: "error",
          summary: "Native crash detected: demo.app"
        })
      ])
    );
    expect(run.artifacts.some((artifact) => artifact.type === "log" && artifact.name.includes("device-event-native_crash"))).toBe(true);
    expect(run.artifacts.some((artifact) => artifact.type === "screenshot" && artifact.name.includes("native_crash"))).toBe(true);
  });

  it("fails the run when the main app process dies during a business step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new EventMockDriver({
      type: "process_death",
      severity: "warning",
      occurredAt: new Date().toISOString(),
      summary: "Process death detected: demo.app",
      detail: "ActivityManager: Process demo.app (pid 1234) has died",
      processName: "demo.app",
      pid: 1234
    });
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Process Death Flow",
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
          errorMessage: "Run stopped after Android app process death event."
        })
      ])
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "process_death",
          severity: "error",
          summary: "Process death detected: demo.app"
        })
      ])
    );
    expect(run.artifacts.some((artifact) => artifact.type === "log" && artifact.name.includes("device-event-process_death"))).toBe(true);
    expect(run.artifacts.some((artifact) => artifact.type === "screenshot" && artifact.name.includes("process_death"))).toBe(true);
  });

  it("fails the step when a successful action leaves the target app foreground", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new ForegroundExitMockDriver(["demo.app", "demo.app", "com.android.launcher", "com.android.launcher"]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Foreground Exit Flow",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false,
      startAppPackageName: "demo.app"
    });

    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(run.stepResults[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "DEVICE_EVENT_FAILED",
        errorMessage: "Run stopped after target app left the foreground."
      })
    );
    expect(run.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "app_exit",
          severity: "error",
          stepResultId: run.stepResults[0]?.id,
          summary: "Target app left foreground",
          detail: "expected=demo.app; foreground=com.android.launcher"
        })
      ])
    );
  });

  it("does not record process deaths caused by a restart launch step as abnormal events", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new RestartProcessDeathMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const launchStep: ActionStep = {
      id: "launch",
      order: 1,
      type: "launch_app",
      enabled: true,
      title: "重启 App",
      params: {
        packageName: "demo.app",
        restartBeforeLaunch: true
      },
      createdAt: nowIso()
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Restart Flow",
      steps: [
        launchStep,
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

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "close_app", packageName: "demo.app" },
      { type: "launch_app", packageName: "demo.app" },
      { type: "tap", x: 220, y: 340 }
    ]);
    expect(run.events.filter((event) => event.type === "process_death")).toEqual([]);
  });

  it("does not fail android app monitor runs for process deaths caused by a restart launch step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new AppMonitorRestartProcessDeathMockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
    const launchStep: ActionStep = {
      id: "launch",
      order: 1,
      type: "launch_app",
      enabled: true,
      title: "重启 App",
      params: {
        packageName: "demo.app",
        restartBeforeLaunch: true
      },
      createdAt: nowIso()
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Restart With Monitor Flow",
      steps: [
        launchStep,
        {
          ...driver.createTapStep(220, 340),
          id: "step-2",
          order: 2
        }
      ],
      stepIntervalMs: 0,
      recordVideo: false,
      startAppPackageName: "demo.app",
      androidAppMonitor: {
        enabled: true,
        packageName: "demo.app"
      }
    });

    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(run.events.filter((event) => event.type === "process_death")).toEqual([]);
    expect(run.events.filter((event) => event.severity !== "info")).toEqual([]);
  });

  it("passes no_crash and app_alive expectations after a successful step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const requests: Array<{ screenRef: string; appId: string }> = [];
    const runner = new AutomationRunner(storage, driver, undefined, {
      verifyPageState: async (request) => {
        requests.push({ screenRef: request.screenRef, appId: request.appId });
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
        screenRef: "classin.home",
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
    expect(requests).toEqual([{ screenRef: "classin.home", appId: "cn.eeo.classin" }]);
    expect(run.stepResults[0]).toEqual(expect.objectContaining({
      errorCode: "PRECONDITION_FAILED",
      metadata: expect.objectContaining({
        scriptFlowId: "flow-1",
        scriptStepId: "open-class",
        preconditions: expect.objectContaining({ status: "failed" })
      })
    }));
  });

  it("passes the frozen execution profile to screen-state preconditions", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
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
    const requests: unknown[] = [];
    const runner = new AutomationRunner(storage, driver, undefined, {
      verifyPageState: async (request) => {
        requests.push(request);
        return { status: "matched", pageName: "班级列表" };
      }
    });
    const recordedTap = driver.createTapStep(120, 240);
    const step = withPreconditions(recordedTap, [
      createExpectation("state_is", {
        appId: "cn.eeo.classin",
        platform: "android",
        screenRef: "classin.teacher.classes",
        timeoutMs: 1
      })
    ]);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Frozen profile precondition",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false,
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "flow-profile",
        version: 1,
        planDigest: "profile-digest",
        executionProfile: profile,
        dependencies: [],
        parsed: {}
      }
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(requests).toEqual([
      expect.objectContaining({
        screenRef: "classin.teacher.classes",
        executionProfile: profile
      })
    ]);
  });

  it("synthesizes expected-page verification from script metadata when expectations are missing", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const requests: Array<{ screenRef: string; appId: string }> = [];
    const runner = new AutomationRunner(storage, driver, undefined, {
      verifyPageState: async (request) => {
        requests.push({ screenRef: request.screenRef, appId: request.appId });
        return { status: "unknown", reason: "page evidence did not match" };
      }
    });
    const recordedTap = driver.createTapStep(120, 240);
    const step: ActionStep = {
      ...recordedTap,
      params: {
        ...recordedTap.params,
        scriptFlowId: "flow-1",
        scriptStepId: "open-lesson",
        appId: "cn.eeo.classin",
        platform: "android",
        afterScreenRef: "classin.lesson.create"
      }
    };

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Script expected page fallback",
      steps: [step],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("failed");
    expect(driver.actions).toEqual([{ type: "tap", x: 120, y: 240 }]);
    expect(requests).toEqual([{ screenRef: "classin.lesson.create", appId: "cn.eeo.classin" }]);
    expect(run.stepResults[0]).toEqual(expect.objectContaining({
      errorCode: "EXPECTATION_FAILED",
      expectationResults: [expect.objectContaining({
        type: "state_is",
        status: "failed",
        blocking: true
      })]
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const driver = new SequenceScreenshotMockDriver([
      pngBuffer(1),
      pngBuffer(2),
      pngBuffer(1),
      pngBuffer(2),
      pngBuffer(3)
    ]);
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    expect(driver.screenshotCount).toBeGreaterThanOrEqual(5);
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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());
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
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/join_class")]);
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceLayoutOcrService([
      ["允许"],
      ["首页"]
    ]);
    const runner = new AutomationRunner(storage, driver, ocr);

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
      { type: "tap", x: 160, y: 225 },
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
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/join_class")]);
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceLayoutOcrService([
      ["选择学科", "数学", "关闭"],
      ["班级详情"]
    ]);
    const runner = new AutomationRunner(storage, driver, ocr);

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
      { type: "tap", x: 160, y: 385 },
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

  it("uses OCR runtime interceptors for Harmony blocking upgrade popups before replaying a step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new HarmonyRuntimeInterceptorMockDriver();
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceLayoutOcrService([
      ["版本6.1.0", "6.1.0", "新活动来了", "了解更新详情", "立即更新"],
      ["主页", "创建公开课"],
      ["主页", "创建公开课"]
    ]);
    const runner = new AutomationRunner(storage, driver, ocr);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Harmony Runtime Interceptor Flow",
      steps: [driver.createTapStep(120, 240)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "back" },
      { type: "tap", x: 120, y: 240 }
    ]);
    expect(driver.dumpUiHierarchyCount).toBe(0);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        runtimeInterceptors: [
          expect.objectContaining({
            phase: "precondition",
            ruleId: "classin-upgrade-popup",
            ruleName: "ClassIn 升级提示弹窗"
          })
        ]
      })
    );
  });

  it("handles Harmony upgrade popups that appear during OCR text locating before tapping background text", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new HarmonyRuntimeInterceptorMockDriver();
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceLayoutOcrService([
      ["主页", "创建公开课"],
      ["版本6.1.0", "了解更新详情", "立即更新", "主页", "创建公开课"],
      ["主页", "创建公开课"],
      ["主页", "创建公开课"],
      ["主页", "创建公开课"]
    ]);
    const runner = new AutomationRunner(storage, driver, ocr);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Harmony Locator Runtime Interceptor Flow",
      steps: [createTextTapStep("创建公开课")],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "back" },
      { type: "tap", x: 160, y: 305 }
    ]);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        runtimeInterceptors: [
          expect.objectContaining({
            phase: "locator",
            ruleId: "classin-upgrade-popup",
            ruleName: "ClassIn 升级提示弹窗"
          })
        ],
        semantic: expect.objectContaining({
          tapPointSource: "ocr_text_center"
        })
      })
    );
  });

  it("uses OCR runtime interceptors for Android blocking upgrade popups before replaying a step", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new SequenceUiHierarchyMockDriver([hierarchy("com.demo:id/join_class")]);
    driver.device.capabilities.recordVideo = false;
    const ocr = new SequenceLayoutOcrService([
      ["版本6.1.0", "了解更新详情", "立即更新"],
      ["主页", "创建公开课"],
      ["主页", "创建公开课"]
    ]);
    const runner = new AutomationRunner(storage, driver, ocr);

    const started = runner.start({
      deviceSerial: driver.device.serial,
      caseName: "Android OCR Runtime Interceptor Flow",
      steps: [createElementTapStep("com.demo:id/join_class", 140, 210)],
      stepIntervalMs: 0,
      recordVideo: false
    });
    const run = await waitForRun(runner, storage, started.id);

    expect(run.status).toBe("passed");
    expect(driver.actions).toEqual([
      { type: "back" },
      { type: "tap", x: 240, y: 240 }
    ]);
    expect(run.stepResults[0]?.metadata).toEqual(
      expect.objectContaining({
        runtimeInterceptors: [
          expect.objectContaining({
            phase: "precondition",
            ruleId: "classin-upgrade-popup",
            ruleName: "ClassIn 升级提示弹窗"
          })
        ]
      })
    );
  });

  it("applies go_home start strategy before replaying steps", async () => {
    const storage = new MemoryRunnerStorage();
    const driver = new MockDriver();
    driver.device.capabilities.recordVideo = false;
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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
    const runner = new AutomationRunner(storage, driver, new EmptyOcrService());

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

function reachPageStep(targetScreenRef: string, navigationEdges: unknown[]): ActionStep {
  return {
    id: "reach-page",
    order: 1,
    type: "reach_page",
    enabled: true,
    title: "到达目标页",
    params: {
      appId: "cn.eeo.classin",
      platform: "android",
      screenRef: targetScreenRef,
      targetScreenRef,
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
      screen: {
        id: pageId,
        key: pageId,
        screenRef: pageId,
        name: pageId,
        appId: "cn.eeo.classin",
        graphVersionId: "v1",
        matcherCount: 1
      },
      candidates: []
    };
  };
  return {
    identifyCurrentScreen: async () => result(),
    verifyExpectedScreen: async () => result(),
    waitForExpectedScreen: async () => {
      current += 1;
      return result();
    }
  };
}

function navigationSourceSnapshot(): NonNullable<TestRun["sourceSnapshot"]> {
  return {
    kind: "script_flow",
    flowId: "navigation-test-flow",
    version: 1,
    planDigest: "navigation-test-plan",
    executionPlatform: "android",
    executionProfile: {
      id: "execution-profile:navigation-test:android",
      appId: "cn.eeo.classin",
      platform: "android",
      version: 1,
      status: "verified",
      digest: "navigation-test-profile",
      createdAt: nowIso(),
      screens: []
    },
    dependencies: [],
    parsed: {}
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

function createTextTapStep(text: string, params: Record<string, unknown> = {}): ActionStep {
  return {
    id: `text-${Math.random().toString(16).slice(2)}`,
    order: 1,
    type: "tap_on_text",
    enabled: true,
    params: {
      text,
      mode: "equals",
      searchMode: "visibleOnly",
      timeoutMs: 100,
      intervalMs: 1,
      ...params
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
  protected eventListener?: (event: ObservedDeviceEvent) => void;
  private emittedCrash = false;
  watchOptions?: { since?: Date; packageName?: string };

  constructor(private readonly event: ObservedDeviceEvent = {
    type: "crash",
    severity: "error",
    occurredAt: new Date().toISOString(),
    summary: "Android crash detected",
    detail: "FATAL EXCEPTION: main\nProcess: demo.app"
  }) {
    super();
  }

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
      this.eventListener?.(this.event);
    }
    return result;
  }
}

class RestartProcessDeathMockDriver extends MockDriver {
  private eventListener?: (event: ObservedDeviceEvent) => void;

  async watchDeviceEvents(
    _serial: string,
    onEvent: (event: ObservedDeviceEvent) => void,
    options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher> {
    this.eventListener = onEvent;
    return {
      stop: async () => undefined
    };
  }

  override async performAction(serial: string, action: Parameters<MockDriver["performAction"]>[1]): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "close_app") {
      this.eventListener?.({
        type: "process_death",
        severity: "warning",
        occurredAt: new Date().toISOString(),
        summary: `Process death detected: ${action.packageName}`,
        detail: `ActivityManager: Process ${action.packageName} (pid 1234) has died`,
        processName: action.packageName,
        pid: 1234
      });
      this.eventListener?.({
        type: "process_death",
        severity: "warning",
        occurredAt: new Date().toISOString(),
        summary: `Process death detected: ${action.packageName}:worker`,
        detail: `ActivityManager: Killing 2345:${action.packageName}:worker/u0a123`,
        processName: `${action.packageName}:worker`,
        pid: 2345
      });
    }
    return result;
  }
}

class ForegroundExitMockDriver extends MockDriver {
  private callCount = 0;

  constructor(private readonly foregroundPackages: string[]) {
    super();
  }

  override async getForegroundApp(serial: string): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    await this.getDeviceInfo(serial);
    const packageName = this.foregroundPackages[Math.min(this.callCount, this.foregroundPackages.length - 1)];
    this.callCount += 1;
    return packageName
      ? {
          packageName,
          activityName: `${packageName}.MainActivity`,
          componentName: `${packageName}/.MainActivity`
        }
      : {};
  }
}

class AppMonitorRestartProcessDeathMockDriver extends MockDriver {
  private monitorCallbacks?: {
    onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
    onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
  };
  private monitorConfig?: AndroidAppMonitorConfig;
  private readonly monitorIncidents: AndroidAppMonitorIncident[] = [];

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    _writeTextArtifact: (runId: string, fileName: string, content: string) => Promise<{ id: string }>,
    callbacks: {
      onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
      onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
    } = {}
  ): Promise<MobileAppMonitorSession> {
    this.monitorCallbacks = callbacks;
    this.monitorConfig = config;
    return {
      start: async () => {
        await callbacks.onLifecycleEvent?.({
          occurredAt: nowIso(),
          type: "process_started",
          pid: 123,
          processName: config.packageName
        });
      },
      stop: async () => this.getMonitorSummary(),
      getSummary: () => this.getMonitorSummary()
    };
  }

  override async performAction(serial: string, action: Parameters<MockDriver["performAction"]>[1]): ReturnType<MockDriver["performAction"]> {
    const result = await super.performAction(serial, action);
    if (action.type === "close_app") {
      const incident: AndroidAppMonitorIncident = {
        id: "incident-process-death",
        type: "process_death",
        severity: "warning",
        occurredAt: nowIso(),
        processName: action.packageName,
        pid: 1234,
        summary: `Process death detected: ${action.packageName}`,
        detail: `ActivityManager: Process ${action.packageName} (pid 1234) has died`,
        artifactIds: []
      };
      this.monitorIncidents.push(incident);
      await this.monitorCallbacks?.onIncident?.(incident);
    }
    return result;
  }

  private getMonitorSummary(): AndroidAppMonitorSummary {
    const packageName = this.monitorConfig?.packageName ?? "demo.app";
    return {
      packageName,
      startedAt: "2026-06-09T00:00:00.000Z",
      endedAt: "2026-06-09T00:00:02.000Z",
      processes: [
        {
          pid: 123,
          processName: packageName,
          packageName,
          isMainProcess: true,
          discoveredAt: "2026-06-09T00:00:00.000Z"
        }
      ],
      sampleCounts: {
        cpu: 0,
        memory: 0,
        lifecycle: 1
      },
      incidents: this.monitorIncidents,
      artifacts: {}
    };
  }
}

class AppMonitorMockDriver extends MockDriver {
  readonly monitorStarts: Array<{ serial: string; runId: string; config: AndroidAppMonitorConfig }> = [];
  monitorStopCount = 0;
  eventWatcherStartCount = 0;
  logCollectionCount = 0;

  constructor(
    private readonly monitorData: {
      cpu?: AndroidProcessMetricSample[];
      memory?: AndroidProcessMetricSample[];
      lifecycle?: AndroidProcessLifecycleEvent[];
      incidents?: AndroidAppMonitorIncident[];
      collectedLogs?: string;
      startError?: Error;
      stopError?: Error;
    } = {}
  ) {
    super();
  }

  override async collectLogs(serial: string, lines?: number): Promise<string> {
    this.logCollectionCount += 1;
    if (this.monitorData.collectedLogs !== undefined) {
      return this.monitorData.collectedLogs;
    }
    return super.collectLogs(serial, lines);
  }

  async watchDeviceEvents(
    _serial: string,
    _onEvent: (event: ObservedDeviceEvent) => void,
    _options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher> {
    this.eventWatcherStartCount += 1;
    return {
      stop: async () => undefined
    };
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

class ForegroundCountingAppMonitorMockDriver extends AppMonitorMockDriver {
  foregroundReadCount = 0;

  override async getForegroundApp(serial: string): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    await this.getDeviceInfo(serial);
    this.foregroundReadCount += 1;
    return {
      packageName: "com.demo",
      activityName: "com.demo.MainActivity",
      componentName: "com.demo/.MainActivity"
    };
  }
}

class ChangingScreenshotMockDriver extends MockDriver {
  private screenshotCount = 0;

  override async screenshot(serial: string): Promise<Buffer> {
    await this.getDeviceInfo(serial);
    this.screenshotCount += 1;
    return pngBuffer(this.screenshotCount);
  }
}

class SequenceScreenshotMockDriver extends MockDriver {
  screenshotCount = 0;

  constructor(private readonly screenshots: Buffer[]) {
    super();
  }

  override async screenshot(serial: string): Promise<Buffer> {
    await this.getDeviceInfo(serial);
    const screenshot = this.screenshots[Math.min(this.screenshotCount, this.screenshots.length - 1)] ?? pngBuffer(0);
    this.screenshotCount += 1;
    return screenshot;
  }
}

class HarmonyRuntimeInterceptorMockDriver extends MockDriver {
  dumpUiHierarchyCount = 0;

  constructor() {
    super();
    this.device.id = "mock-harmony-1";
    this.device.serial = "mock-harmony-1";
    this.device.platform = "harmony";
    this.device.name = "Mock Harmony";
    this.device.resolution = { width: 1080, height: 2400 };
    this.device.orientation = "portrait";
  }

  override async getForegroundApp(serial: string): Promise<{
    packageName?: string;
    bundleId?: string;
    activityName?: string;
    abilityName?: string;
    componentName?: string;
  }> {
    await this.getDeviceInfo(serial);
    return {
      bundleId: "cn.eeo.hos.classin.mobile",
      abilityName: "EntryAbility"
    };
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    await this.getDeviceInfo(serial);
    this.dumpUiHierarchyCount += 1;
    return hierarchy("com.demo:id/join_class");
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

class EmptyOcrService implements OcrService {
  async recognize(input: OcrInput): Promise<OcrResult> {
    return {
      text: "",
      engine: "fake",
      lang: input.lang ?? "test"
    };
  }

  async locateText(input: OcrInput) {
    return {
      text: "",
      engine: "fake",
      lang: input.lang ?? "test",
      width: 0,
      height: 0,
      boxes: []
    };
  }
}

class SequenceLayoutOcrService implements OcrService {
  calls = 0;

  constructor(private readonly textSequences: string[][]) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const texts = this.currentTexts();
    return {
      text: texts.join("\n"),
      engine: "fake",
      lang: input.lang ?? "test"
    };
  }

  async locateText(input: OcrInput) {
    const texts = this.currentTexts();
    this.calls += 1;
    return {
      text: texts.join("\n"),
      engine: "fake",
      lang: input.lang ?? "test",
      width: 1080,
      height: 2400,
      boxes: texts.map((text, index) => ({
        text,
        confidence: 0.99,
        x: 40,
        y: 200 + index * 80,
        width: 240,
        height: 50
      }))
    };
  }

  private currentTexts(): string[] {
    return this.textSequences[Math.min(this.calls, this.textSequences.length - 1)] ?? [];
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

  async locateText(input: OcrInput) {
    return {
      text: "",
      engine: "fake",
      lang: input.lang ?? "test",
      width: 0,
      height: 0,
      boxes: []
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

async function waitForMatchingActionCount(
  driver: MockDriver,
  matches: (action: (typeof driver.actions)[number]) => boolean,
  count: number
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (driver.actions.filter(matches).length >= count) return;
    await delay(10);
  }
  throw new Error(`Expected at least ${count} matching actions`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pngBuffer(seed = 0): Buffer {
  const buffer = Buffer.alloc(32, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  return buffer;
}
