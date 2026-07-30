import {
  RunExecutionController,
  RunStateMachine,
  RunnerStoppedError,
  isRunnerStoppedError,
  normalizeRunConfig,
  shouldRecordVideoForDevice
} from "@mobile-automation/runner-core";
import {
  createId,
  nowIso,
  stepToAction,
  type ActionStep,
  type ArtifactRef,
  type DeviceActionResult,
  type DeviceEvent,
  type MetricSample,
  type FlowStartStrategy,
  type RunConfig,
  type RunMode,
  type StepExpectation,
  type StepExpectationResult,
  type StepResult,
  type RuntimeFlow,
  type TestRun
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver, DeviceEventWatcher, MobileVideoRecording, ObservedDeviceEvent } from "./mobile-driver.js";
import { createDefaultOcrService, type OcrService } from "./ocr.js";
import type { Storage } from "./storage.js";
import {
  StepExpectationEvaluator,
  annotateNonBlockingExpectationResults,
  enabledExpectations,
  shouldFailStepForExpectation,
  type PageStateExpectationVerifier
} from "./step-expectations.js";
import { ConditionalStepExecutor } from "./conditional-step-executor.js";
import { AndroidAppMonitorRunSupport } from "./android-app-monitor-run-support.js";
import { ObservationService } from "./observation-service.js";
import { RunArtifactService } from "./run-artifact-service.js";
import { RuntimeInterceptor, type RuntimeInterceptorRecord } from "./runtime-interceptor.js";
import { SemanticStepResolver } from "./semantic-locator.js";
import { DeviceExecutionLease } from "./device-execution-lease.js";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { PageStateService } from "./page-state-service.js";
import { findPageNavigationPath, readPageNavigationEdges } from "./page-navigation.js";

export type RunnerStorage = Pick<
  Storage,
  | "createRun"
  | "getRun"
  | "updateRunStatus"
  | "addDeviceEvent"
  | "listRunIdsByStatus"
  | "addStepResult"
  | "addMetricSample"
  | "writeArtifact"
  | "addArtifact"
  | "updateRunReport"
> & {
  listRuntimeInterceptorRules?: Storage["listRuntimeInterceptorRules"];
};

export type AutomationRunnerOptions = {
  verifyPageState?: PageStateExpectationVerifier;
  pageStateService?: PageStateService;
  executionLease?: DeviceExecutionLease;
};

type StartRunInput = {
  deviceSerial: string;
  caseName?: string;
  steps?: ActionStep[];
  persistedSteps?: ActionStep[];
  mode?: RunMode;
  repeatCount?: number;
  stepIntervalMs?: number;
  stopOnFailure?: boolean;
  recordVideo?: boolean;
  keepVideoOnSuccess?: boolean;
  pauseAfterEachStep?: boolean;
  startStrategy?: FlowStartStrategy;
  startAppPackageName?: string;
  startSetupScope?: RunConfig["startSetupScope"];
  androidAppMonitor?: RunConfig["androidAppMonitor"];
  sourceSnapshot?: TestRun["sourceSnapshot"];
};

type ActiveRun = {
  promise: Promise<void>;
  controller: RunExecutionController;
  deviceSerial: string;
};

type PreconditionEvaluationOutcome = {
  passed: boolean;
  failedResult?: StepExpectationResult;
  results: StepExpectationResult[];
  artifacts: ArtifactRef[];
  metadata: {
    status: "passed" | "failed";
    durationMs: number;
    results: StepExpectationResult[];
    evidenceArtifactIds: string[];
  };
};

type RuntimeInterceptorMetadataRecord = RuntimeInterceptorRecord & {
  phase: "precondition" | "state_transition";
};

type RuntimeInterceptorRunOutcome = {
  records: RuntimeInterceptorMetadataRecord[];
  warning?: string;
};

export class AutomationRunner {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly artifactService: RunArtifactService;
  private readonly expectationEvaluator: StepExpectationEvaluator;
  private readonly conditionalStepExecutor: ConditionalStepExecutor;
  private readonly semanticStepResolver: SemanticStepResolver;
  private readonly observationService: ObservationService;
  private readonly executionLease: DeviceExecutionLease;
  private readonly pageStateService?: PageStateService;

  constructor(
    private readonly storage: RunnerStorage,
    private readonly driver: AutomationDeviceDriver,
    private readonly ocr: OcrService = createDefaultOcrService(),
    options: AutomationRunnerOptions = {}
  ) {
    this.artifactService = new RunArtifactService(this.storage, this.driver);
    this.expectationEvaluator = new StepExpectationEvaluator({
      ocr: this.ocr,
      collectLogs: (serial, tailLines) => this.driver.collectLogs(serial, tailLines),
      writeLog: (runId, fileName, content, stepResultId) => this.artifactService.writeLog(runId, fileName, content, stepResultId),
      readArtifact: (runId, artifactId) => this.artifactService.readArtifactBytes(runId, artifactId),
      writeExpectationImageArtifact: (runId, stepResultId, fileName, png) =>
        this.artifactService.writeExpectationImageArtifact(runId, stepResultId, fileName, png),
      captureExpectationScreenshot: (runId, stepResultId, serial, expectationId, attempt) =>
        this.artifactService.captureExpectationScreenshot(runId, stepResultId, serial, expectationId, attempt),
      getForegroundApp: this.driver.getForegroundApp ? (serial) => this.driver.getForegroundApp!(serial) : undefined,
      dumpUiHierarchy: this.driver.dumpUiHierarchy ? (serial) => this.driver.dumpUiHierarchy!(serial) : undefined,
      verifyPageState: options.verifyPageState
    });
    this.conditionalStepExecutor = new ConditionalStepExecutor({
      ocr: this.ocr,
      performAction: async (serial, action) => {
        await this.driver.performAction(serial, action);
      },
      captureConditionScreenshot: (runId, stepResultId, serial, stepId, attempt) =>
        this.artifactService.captureConditionScreenshot(runId, stepResultId, serial, stepId, attempt)
    });
    this.semanticStepResolver = new SemanticStepResolver({
      ocr: this.ocr,
      performAction: (serial, action) => this.driver.performAction(serial, action),
      performSemanticAction: this.driver.performSemanticAction ? (serial, action) => this.driver.performSemanticAction!(serial, action) : undefined,
      dumpUiHierarchy: this.driver.dumpUiHierarchy ? (serial) => this.driver.dumpUiHierarchy!(serial) : undefined,
      captureLocatorScreenshot: (runId, stepResultId, serial, stepId, attempt) =>
        this.artifactService.captureLocatorScreenshot(runId, stepResultId, serial, stepId, attempt)
    });
    this.observationService = new ObservationService(this.driver, this.ocr);
    this.executionLease = options.executionLease ?? new DeviceExecutionLease();
    this.pageStateService = options.pageStateService;
  }

  start(input: StartRunInput): TestRun {
    const testCase = this.buildRuntimeFlow(input);
    const defaultStartAppPackageName = testCase.targetApp?.androidPackageName;
    const defaultStartStrategy = defaultStartAppPackageName ? "launch_app" : "keep_current";
    const config = normalizeRunConfig({
      deviceSerial: input.deviceSerial,
      mode: input.mode,
      repeatCount: input.repeatCount ?? 1,
      stepIntervalMs: input.stepIntervalMs ?? 400,
      stopOnFailure: input.stopOnFailure ?? true,
      recordVideo: input.recordVideo ?? false,
      keepVideoOnSuccess: input.keepVideoOnSuccess ?? true,
      pauseAfterEachStep: input.pauseAfterEachStep ?? false,
      startStrategy: input.startStrategy ?? defaultStartStrategy,
      startAppPackageName: input.startAppPackageName ?? defaultStartAppPackageName,
      startSetupScope: input.startSetupScope ?? "before_run",
      androidAppMonitor: input.androidAppMonitor
    });
    const runId = createId("run");
    this.executionLease.acquire(input.deviceSerial, runId, "script_flow");
    let run: TestRun;
    try {
      run = this.storage.createRun({
        id: runId,
        caseName: testCase.name,
        deviceSerial: input.deviceSerial,
        configJson: JSON.stringify(config),
        runSnapshotJson: JSON.stringify(persistedCase(testCase, input.persistedSteps)),
        steps: persistedSteps(input.persistedSteps, testCase.steps)
      });
    } catch (error) {
      this.executionLease.release(input.deviceSerial, runId);
      throw error;
    }

    const controller = new RunExecutionController();
    const promise = this.execute(run.id, testCase, config, controller).finally(() => {
      this.activeRuns.delete(run.id);
      this.executionLease.release(input.deviceSerial, run.id);
    });
    this.activeRuns.set(run.id, {
      promise,
      controller,
      deviceSerial: input.deviceSerial
    });

    return run;
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  getActiveRunForDevice(deviceSerial: string): { runId: string; deviceSerial: string } | undefined {
    for (const [runId, activeRun] of this.activeRuns) {
      if (activeRun.deviceSerial === deviceSerial) {
        return {
          runId,
          deviceSerial: activeRun.deviceSerial
        };
      }
    }
    return undefined;
  }

  async stop(runId: string): Promise<boolean> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      const run = this.storage.getRun(runId);
      if (run?.status === "running" || run?.status === "paused") {
        this.storage.updateRunStatus(runId, "stopped");
        this.addDeviceEvent({
          id: createId("event"),
          runId,
          deviceSerial: run.deviceSerial,
          type: "runner_error",
          severity: "warning",
          occurredAt: nowIso(),
          summary: "Run marked stopped",
          detail: "The run was marked as stopped because no active worker owns it.",
          artifactIds: []
        });
        await this.artifactService.generateReport(runId);
        return true;
      }
      return false;
    }

    activeRun.controller.stop();
    await Promise.race([activeRun.promise, sleep(8000)]).catch(() => undefined);
    return true;
  }

  pause(runId: string): TestRun | undefined {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return this.storage.getRun(runId);
    }
    activeRun.controller.pause();
    return this.storage.getRun(runId);
  }

  resume(runId: string): TestRun | undefined {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return this.storage.getRun(runId);
    }
    activeRun.controller.resume();
    return this.storage.getRun(runId);
  }

  step(runId: string): TestRun | undefined {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return this.storage.getRun(runId);
    }
    activeRun.controller.step();
    return this.storage.getRun(runId);
  }

  async stopAll(): Promise<void> {
    const activeRuns = Array.from(this.activeRuns.keys());
    await Promise.all(activeRuns.map((runId) => this.stop(runId)));
  }

  async markStaleRunningRunsStopped(reason: string): Promise<number> {
    const runIds = [...this.storage.listRunIdsByStatus("running"), ...this.storage.listRunIdsByStatus("paused")];
    for (const runId of runIds) {
      if (this.activeRuns.has(runId)) {
        continue;
      }
      const run = this.storage.getRun(runId);
      if (!run) {
        continue;
      }
      this.storage.updateRunStatus(runId, "stopped");
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: run.deviceSerial,
        type: "runner_error",
        severity: "warning",
        occurredAt: nowIso(),
        summary: "Stale running run stopped",
        detail: reason,
        artifactIds: []
      });
      await this.artifactService.generateReport(runId);
    }
    return runIds.length;
  }

  private buildRuntimeFlow(input: StartRunInput): RuntimeFlow & { sourceSnapshot?: TestRun["sourceSnapshot"] } {
    const now = nowIso();
    return {
      id: createId("adhoc_case"),
      name: input.caseName?.trim() || "Ad-hoc Run",
      platformScope: "mobile-both",
      tags: [],
      version: 1,
      steps: (input.steps ?? []).map((step, index) => ({ ...step, order: index + 1 })),
      createdAt: now,
      updatedAt: now,
      ...(input.sourceSnapshot ? { sourceSnapshot: input.sourceSnapshot } : {})
    };
  }

  private async execute(runId: string, testCase: RuntimeFlow, config: RunConfig, controller: RunExecutionController): Promise<void> {
    const runStartedAt = new Date();
    let failed = false;
    let stopped = false;
    let videoRecording: MobileVideoRecording | undefined;
    let eventWatcher: DeviceEventWatcher | undefined;
    let appMonitor: AndroidAppMonitorRunSupport | undefined;
    const pendingEventWrites: Promise<void>[] = [];
    let runtimeFailure = false;
    let runtimeFailureEventType: DeviceEvent["type"] | undefined;
    let activeStepResultId: string | undefined;

    try {
      controller.throwIfStopped();
      const device = await this.driver.getDeviceInfo(config.deviceSerial);
      const deviceSize = device.resolution;
      appMonitor = new AndroidAppMonitorRunSupport({
        runId,
        deviceSerial: config.deviceSerial,
        config: config.androidAppMonitor,
        stopOnFailure: config.stopOnFailure,
        driver: this.driver,
        artifactService: this.artifactService,
        addDeviceEvent: (event) => this.addDeviceEvent(event),
        stopRun: () => controller.stop(),
        markRuntimeFailure: () => {
          runtimeFailure = true;
        },
        getActiveStepResultId: () => activeStepResultId
      });
      await appMonitor.start();
      eventWatcher = await this.startEventWatcher(
        runId,
        config.deviceSerial,
        (event) => {
          if (event.type === "crash" || event.type === "anr") {
            runtimeFailure = true;
            runtimeFailureEventType = event.type;
            if (config.stopOnFailure) {
              controller.stop();
            }
          }
        },
        (eventWrite) => pendingEventWrites.push(eventWrite),
        () => activeStepResultId,
        runStartedAt,
        config.androidAppMonitor?.packageName ?? config.startAppPackageName
      );

      if (config.recordVideo && !shouldRecordVideoForDevice(config, device)) {
        this.addDeviceEvent({
          id: createId("event"),
          runId,
          deviceSerial: config.deviceSerial,
          type: "video_unavailable",
          severity: "warning",
          occurredAt: nowIso(),
          summary: "Video recording skipped",
          detail: `${device.platform} device ${config.deviceSerial} does not report video recording capability.`,
          artifactIds: []
        });
      } else if (shouldRecordVideoForDevice(config, device)) {
        try {
          videoRecording = await this.driver.startVideoRecording(config.deviceSerial, runId, this.artifactService.absoluteRunDir(runId, "videos"));
        } catch (error) {
          const artifact = await this.artifactService.writeLog(runId, `video-start-failed-${Date.now()}.txt`, errorToString(error));
          this.addDeviceEvent({
            id: createId("event"),
            runId,
            deviceSerial: config.deviceSerial,
            type: "video_unavailable",
            severity: "warning",
            occurredAt: nowIso(),
            summary: "Video recording unavailable",
            detail: errorToString(error),
            artifactIds: [artifact.id]
          });
        }
      }

      controller.throwIfStopped();
      if (config.startSetupScope !== "before_each_iteration") {
        await this.applyStartStrategy(runId, config);
      }
      await this.collectMetric(runId, config.deviceSerial);
      const stateMachine = new RunStateMachine({
        config,
        steps: testCase.steps,
        controller,
        beforeIteration: async () => {
          if (config.startSetupScope === "before_each_iteration") {
            await this.applyStartStrategy(runId, config);
          }
        },
        onStatusChange: (status) => this.storage.updateRunStatus(runId, status),
        executeStep: ({ iterationIndex, step, signal }) =>
          this.executeStep(runId, iterationIndex, step, config, deviceSize, signal, (stepResultId) => {
            activeStepResultId = stepResultId;
          }, () => runtimeFailure, () => runtimeFailureEventType)
      });
      const result = await stateMachine.run();
      failed = result.failed || runtimeFailure;
      stopped = result.stopped && !runtimeFailure;
      controller.throwIfStopped();
      await this.collectMetric(runId, config.deviceSerial);
    } catch (error) {
      stopped = isRunnerStoppedError(error) && !runtimeFailure;
      failed = runtimeFailure || !stopped;
      if (!runtimeFailure || !isRunnerStoppedError(error)) {
        this.addDeviceEvent({
          id: createId("event"),
          runId,
          deviceSerial: config.deviceSerial,
          type: "runner_error",
          severity: stopped ? "warning" : "error",
          occurredAt: nowIso(),
          summary: stopped ? "Runner execution stopped" : "Runner execution failed",
          detail: errorToString(error),
          artifactIds: []
        });
        await this.artifactService.writeLog(runId, `run-error-${Date.now()}.txt`, errorToString(error));
      }
    } finally {
      await eventWatcher?.stop().catch(() => undefined);
      await Promise.allSettled(pendingEventWrites);
      await appMonitor?.stopAndWriteArtifacts();
      await this.artifactService.finalizeVideo(runId, videoRecording, failed || stopped || config.keepVideoOnSuccess);
      const status = stopped ? "stopped" : failed ? "failed" : "passed";
      this.storage.updateRunStatus(runId, status);
      await this.artifactService.generateReport(runId);
    }
  }

  private async executeStep(
    runId: string,
    iterationIndex: number,
    step: ActionStep,
    config: RunConfig,
    deviceSize: { width: number; height: number } | undefined,
    signal: AbortSignal,
    setActiveStepResultId?: (stepResultId: string | undefined) => void,
    isRuntimeFailure?: () => boolean,
    getRuntimeFailureEventType?: () => DeviceEvent["type"] | undefined
  ): Promise<StepResult> {
    if (step.timing?.delayBeforeMs) {
      await sleepInterruptibly(step.timing.delayBeforeMs, signal);
    }
    if (config.stepIntervalMs > 0) {
      await sleepInterruptibly(config.stepIntervalMs, signal);
    }

    const startedAt = nowIso();
    const startedMs = Date.now();
    const result: StepResult = {
      id: createId("step_result"),
      runId,
      iterationIndex,
      stepId: step.id,
      stepOrder: step.order,
      type: step.type,
      status: "running",
      startedAt,
      artifacts: [],
      metadata: scriptStepResultMetadata(step.params)
    };
    setActiveStepResultId?.(result.id);

    try {
      throwIfStopped(signal);
      result.metadata = mergeRuntimeInterceptorMetadata(
        result.metadata,
        await this.handleRuntimeInterceptors({
          serial: config.deviceSerial,
          deviceSize,
          phase: "precondition"
        })
      );
      const preconditionOutcome = await this.evaluatePreconditions({
        runId,
        result,
        step,
        serial: config.deviceSerial,
        isRuntimeFailure
      });
      if (preconditionOutcome) {
        result.metadata = {
          ...(result.metadata ?? {}),
          preconditions: preconditionOutcome.metadata
        };
        for (const artifact of preconditionOutcome.artifacts) {
          result.artifacts.push(artifact);
        }
        if (!preconditionOutcome.passed) {
          result.status = "failed";
          result.errorCode = "PRECONDITION_FAILED";
          result.errorMessage = `Precondition ${preconditionOutcome.failedResult?.type ?? "unknown"}: ${
            preconditionOutcome.failedResult?.reason ?? preconditionOutcome.failedResult?.actual ?? "not satisfied"
          }`;
          if (preconditionOutcome.artifacts[0]) {
            result.afterScreenshotId = preconditionOutcome.artifacts[0].id;
          }
          await this.collectMetric(runId, config.deviceSerial, result.id);
          return result;
        }
      }

      const needsBeforeScreenshot = enabledExpectations(step).some((expectation) => expectation.type === "screen_changed");
      const beforeScreenshot = needsBeforeScreenshot
        ? await this.artifactService.captureStepScreenshotWithBytes(runId, result.id, iterationIndex, step.order, config.deviceSerial, "before")
        : undefined;
      if (beforeScreenshot) {
        result.artifacts.push(beforeScreenshot.artifact);
      }
      if (step.type === "reach_page") {
        const navigation = await this.executeReachPage({
          runId,
          stepResultId: result.id,
          step,
          serial: config.deviceSerial,
          deviceSize,
          signal
        });
        result.metadata = { ...(result.metadata ?? {}), pageNavigation: navigation.metadata };
        result.artifacts.push(...navigation.artifacts);
        if (!navigation.passed) {
          result.status = "failed";
          result.errorCode = "PAGE_NAVIGATION_FAILED";
          result.errorMessage = navigation.message;
          return result;
        }
      } else {
        const conditionalOutcome = await this.conditionalStepExecutor.executeIfNeeded({
          runId,
          stepResultId: result.id,
          step,
          serial: config.deviceSerial,
          deviceSize
        });
        if (conditionalOutcome) {
          result.metadata = {
            ...(result.metadata ?? {}),
            condition: conditionalOutcome.metadata
          };
          for (const artifact of conditionalOutcome.artifacts) {
            result.artifacts.push(artifact);
          }
          if (!conditionalOutcome.performed) {
            result.status = "skipped";
            result.errorCode = "CONDITION_NOT_MET";
            result.errorMessage = conditionalOutcome.message;
            return result;
          }
        } else {
          const semanticOutcome = await this.semanticStepResolver.resolveIfNeeded({
            runId,
            stepResultId: result.id,
            step,
            serial: config.deviceSerial,
            deviceSize
          });
          if (semanticOutcome) {
            result.metadata = {
              ...(result.metadata ?? {}),
              semantic: semanticOutcome.metadata,
              actionBackend: semanticOutcome.actionResult
            };
            for (const artifact of semanticOutcome.artifacts) {
              result.artifacts.push(artifact);
            }
            if (!semanticOutcome.resolved) {
              result.status = "failed";
              result.errorCode = semanticOutcome.supported ? "SEMANTIC_TARGET_NOT_FOUND" : "SEMANTIC_ACTION_UNSUPPORTED";
              result.errorMessage = semanticOutcome.message;
              return result;
            }
          } else {
            const actionResult = await this.driver.performAction(config.deviceSerial, stepToAction(step, deviceSize));
            result.metadata = mergeActionBackendMetadata(result.metadata, actionResult);
          }
        }
      }
      result.metadata = mergeRuntimeInterceptorMetadata(
        result.metadata,
        await this.handleRuntimeInterceptors({
          serial: config.deviceSerial,
          deviceSize,
          phase: "state_transition"
        })
      );
      throwIfStopped(signal);
      const screenshot = await this.artifactService.captureStepScreenshotWithBytes(runId, result.id, iterationIndex, step.order, config.deviceSerial, "after");
      result.afterScreenshotId = screenshot.artifact.id;
      result.artifacts.push(screenshot.artifact);
      throwIfStopped(signal);
      const metric = await this.collectMetric(runId, config.deviceSerial, result.id);
      result.expectationResults = annotateNonBlockingExpectationResults(
        step,
        await this.expectationEvaluator.evaluate({
          runId,
          serial: config.deviceSerial,
          stepResultId: result.id,
          step,
          beforeScreenshot,
          afterScreenshot: screenshot,
          metric,
          runtimeFailure: Boolean(isRuntimeFailure?.())
        })
      );
      const failedExpectation = result.expectationResults.find((expectation) => shouldFailStepForExpectation(step, expectation));
      if (failedExpectation) {
        result.status = "failed";
        result.errorCode = "EXPECTATION_FAILED";
        result.errorMessage = `${failedExpectation.type}: ${failedExpectation.reason ?? failedExpectation.actual}`;
      } else {
        result.status = "passed";
      }
    } catch (error) {
      if (isRunnerStoppedError(error)) {
        if (isRuntimeFailure?.()) {
          result.status = "failed";
          result.errorCode = "DEVICE_EVENT_FAILED";
          result.errorMessage = runtimeFailureMessage(getRuntimeFailureEventType?.());
          await this.collectMetric(runId, config.deviceSerial, result.id);
        } else {
          result.status = "skipped";
          result.errorCode = "RUN_STOPPED";
          result.errorMessage = errorToString(error);
          throw error;
        }
      } else {
        result.status = "failed";
        result.errorCode = "ACTION_FAILED";
        result.errorMessage = errorToString(error);
        await this.artifactService.captureStepScreenshot(runId, result.id, iterationIndex, step.order, config.deviceSerial)
          .then((artifact) => {
            result.afterScreenshotId = artifact.id;
            result.artifacts.push(artifact);
          })
          .catch(() => undefined);
        await this.driver
          .collectLogs(config.deviceSerial, 500)
          .then((logs) => this.artifactService.writeLog(runId, `step-${iterationIndex}-${step.order}-logcat.txt`, logs, result.id))
          .then((artifact) => {
            result.artifacts.push(artifact);
            this.addDeviceEvent({
              id: createId("event"),
              runId,
              stepResultId: result.id,
              deviceSerial: config.deviceSerial,
              type: "command_failed",
              severity: "error",
              occurredAt: nowIso(),
              summary: `${step.type} failed`,
              detail: result.errorMessage,
              artifactIds: [artifact.id]
            });
          })
          .catch(() => undefined);
        await this.collectMetric(runId, config.deviceSerial, result.id);
      }
    } finally {
      result.endedAt = nowIso();
      result.durationMs = Date.now() - startedMs;
      this.storage.addStepResult(result);
      setActiveStepResultId?.(undefined);
    }

    return result;
  }

  private async executeReachPage(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize: { width: number; height: number } | undefined;
    signal: AbortSignal;
  }): Promise<{
    passed: boolean;
    message?: string;
    artifacts: ArtifactRef[];
    metadata: Record<string, unknown>;
  }> {
    const pageState = this.pageStateService;
    const appId = navigationString(input.step.params.appId);
    const platform = navigationPlatform(input.step.params.platform);
    const targetPageId = navigationString(input.step.params.targetPageId) || navigationString(input.step.params.pageId);
    const targetPageName = navigationString(input.step.params.targetPageName) || targetPageId;
    const policy = navigationString(input.step.params.policy) || "safe";
    const baseMetadata = { targetPageId, targetPageName, policy, route: [] as Record<string, unknown>[] };
    if (!pageState || !appId || !platform || !targetPageId) {
      return {
        passed: false,
        message: "页面导航运行环境不完整，无法识别或到达目标页面。",
        artifacts: [],
        metadata: { ...baseMetadata, status: "unavailable" }
      };
    }
    if (policy !== "safe") {
      return {
        passed: false,
        message: `不支持的页面导航策略：${policy}`,
        artifacts: [],
        metadata: { ...baseMetadata, status: "unsupported_policy" }
      };
    }
    const navigationEdges = readPageNavigationEdges(input.step.params.navigationEdges);
    const allowBackRecovery = input.step.params.allowBackRecovery === true;
    const recoveryStopPageIds = navigationStringSet(input.step.params.recoveryStopPageIds);
    const routeSourcePageIds = new Set(
      navigationEdges
        .map((edge) => edge.fromPageId)
        .filter((pageId, index, values) => values.indexOf(pageId) === index)
        .filter((pageId) => Boolean(findPageNavigationPath(navigationEdges, pageId, targetPageId)))
    );
    const maxRecoveryBacks = navigationInteger(input.step.params.maxRecoveryBacks, 6, 0, 12);
    const recoveryDelayMs = navigationInteger(input.step.params.recoveryDelayMs, 250, 0, 2_000);
    let current = await pageState.identifyCurrentPage({ serial: input.serial, appId, platform });
    const initialStatus = current.status;
    let recoveryActions = 0;
    let path = current.status === "matched" && current.page
      ? findPageNavigationPath(navigationEdges, current.page.id, targetPageId)
      : undefined;

    while (true) {
      if (current.status === "matched" && current.page?.id === targetPageId) {
        return {
          passed: true,
          artifacts: [],
          metadata: {
            ...baseMetadata,
            status: recoveryActions ? "recovered_to_target" : "already_on_target",
            currentPageId: current.page.id,
            recoveryActions,
            initialStatus
          }
        };
      }
      if (path) break;
      if (current.status === "outside_app") {
        return {
          passed: false,
          message: `页面恢复已离开目标 App，已停止继续返回；无法安全到达目标页面“${targetPageName}”。`,
          artifacts: [],
          metadata: {
            ...baseMetadata,
            status: "recovery_left_app",
            currentStatus: current.status,
            recoveryActions,
            initialStatus
          }
        };
      }
      if (current.status === "matched" && current.page) {
        if (recoveryStopPageIds.has(current.page.id)) {
          return {
            passed: false,
            message: `已到达导航状态入口“${current.page.name}”，但当前索引没有到目标页面“${targetPageName}”的可靠路径，已停止返回。`,
            artifacts: [],
            metadata: {
              ...baseMetadata,
              status: "recovery_stopped_at_anchor",
              currentStatus: current.status,
              currentPageId: current.page.id,
              recoveryActions,
              initialStatus
            }
          };
        }
        if (!allowBackRecovery && routeSourcePageIds.size === 0) {
          return {
            passed: false,
            message: `当前已识别为“${current.page.name}”，但导航索引中没有到目标页面“${targetPageName}”的可靠路径，未执行返回操作。`,
            artifacts: [],
            metadata: {
              ...baseMetadata,
              status: "no_reliable_path",
              currentStatus: current.status,
              currentPageId: current.page.id,
              recoveryActions,
              initialStatus
            }
          };
        }
      }
      if (recoveryActions >= maxRecoveryBacks) {
        const currentPageName = current.status === "matched" && current.page ? `“${current.page.name}”` : "未识别页面";
        return {
          passed: false,
          message: `有限恢复后仍没有从${currentPageName}到目标页面“${targetPageName}”的可靠路径。`,
          artifacts: [],
          metadata: {
            ...baseMetadata,
            status: "recovery_exhausted",
            currentStatus: current.status,
            ...(current.status === "matched" && current.page ? { currentPageId: current.page.id } : {}),
            recoveryActions,
            initialStatus
          }
        };
      }
      throwIfStopped(input.signal);
      await this.driver.performAction(input.serial, { type: "back" });
      recoveryActions += 1;
      if (recoveryDelayMs) await sleepInterruptibly(recoveryDelayMs, input.signal);
      current = await pageState.identifyCurrentPage({ serial: input.serial, appId, platform });
      path = current.status === "matched" && current.page
        ? findPageNavigationPath(navigationEdges, current.page.id, targetPageId)
        : undefined;
    }
    if (current.status !== "matched" || !current.page) {
      return {
        passed: false,
        message: `未能稳定识别当前设备页面，无法规划到目标页面“${targetPageName}”。`,
        artifacts: [],
        metadata: { ...baseMetadata, status: "current_page_unknown", currentStatus: current.status, recoveryActions, initialStatus }
      };
    }
    const artifacts: ArtifactRef[] = [];
    const route: Record<string, unknown>[] = [];
    for (const edge of path) {
      throwIfStopped(input.signal);
      const actionBackends: DeviceActionResult[] = [];
      for (const action of edge.actions) {
        throwIfStopped(input.signal);
        const semanticOutcome = await this.semanticStepResolver.resolveIfNeeded({
          runId: input.runId,
          stepResultId: input.stepResultId,
          step: action,
          serial: input.serial,
          deviceSize: input.deviceSize
        });
        let actionBackend: DeviceActionResult | undefined;
        if (semanticOutcome) {
          artifacts.push(...semanticOutcome.artifacts);
          if (!semanticOutcome.resolved) {
            return {
              passed: false,
              message: `导航步骤“${edge.flowName} / ${action.title ?? action.id}”执行失败：${semanticOutcome.message}`,
              artifacts,
              metadata: {
                ...baseMetadata,
                status: "route_action_failed",
                currentPageId: current.page.id,
                failedSegmentId: edge.segmentId,
                failedActionId: action.id,
                route
              }
            };
          }
          actionBackend = semanticOutcome.actionResult;
        } else {
          actionBackend = await this.driver.performAction(input.serial, stepToAction(action, input.deviceSize)) ?? undefined;
        }
        if (actionBackend) actionBackends.push(actionBackend);
      }
      const reached = await pageState.waitForExpectedPage({
        serial: input.serial,
        appId,
        platform,
        pageId: edge.toPageId,
        timeoutMs: edge.actions.at(-1)?.timing?.timeoutMs ?? 15_000
      });
      route.push({
        fromPageId: edge.fromPageId,
        toPageId: edge.toPageId,
        flowId: edge.flowId,
        flowName: edge.flowName,
        segmentId: edge.segmentId,
        stepIds: edge.stepIds,
        ...(actionBackends.length ? { actionBackends } : {})
      });
      if (reached.status !== "matched") {
        return {
          passed: false,
          message: `导航片段“${edge.flowName}”执行后未到达预期页面。`,
          artifacts,
          metadata: { ...baseMetadata, status: "route_verification_failed", currentPageId: current.page.id, route }
        };
      }
    }
    return {
      passed: true,
      artifacts,
      metadata: { ...baseMetadata, status: "reached", currentPageId: current.page.id, route, recoveryActions, initialStatus }
    };
  }

  private async handleRuntimeInterceptors(input: {
    serial: string;
    deviceSize: { width: number; height: number } | undefined;
    phase: "precondition" | "state_transition";
  }): Promise<RuntimeInterceptorRunOutcome> {
    try {
      const rules = this.storage.listRuntimeInterceptorRules?.({ enabledOnly: true }) ?? [];
      const interceptor = new RuntimeInterceptor({
        observe: () =>
          this.observationService.collect(input.serial, {
            includeScreenshot: false,
            includeUiTree: true,
            includeOcr: false
          }),
        performAction: async (actionStep) => {
          await this.driver.performAction(input.serial, runtimeInterceptorStepToAction(actionStep, input.deviceSize));
        }
      }, rules);
      const outcome = await interceptor.handle({ phase: input.phase });
      return {
        records: outcome.records.map((record) => ({
          ...record,
          phase: input.phase
        }))
      };
    } catch (error) {
      return {
        records: [],
        warning: errorToString(error)
      };
    }
  }

  private async evaluatePreconditions(input: {
    runId: string;
    result: StepResult;
    step: ActionStep;
    serial: string;
    isRuntimeFailure?: () => boolean;
  }): Promise<PreconditionEvaluationOutcome | undefined> {
    const preconditions = enabledPreconditions(input.step);
    if (!preconditions.length) {
      return undefined;
    }

    const startedMs = Date.now();
    const screenshot = await this.artifactService.captureExpectationScreenshot(
      input.runId,
      input.result.id,
      input.serial,
      `precondition-${input.step.id}`,
      1
    );
    const preconditionStep: ActionStep = {
      ...input.step,
      expectations: preconditions
    };
    const results = annotateNonBlockingExpectationResults(
      preconditionStep,
      await this.expectationEvaluator.evaluate({
        runId: input.runId,
        serial: input.serial,
        stepResultId: input.result.id,
        step: preconditionStep,
        afterScreenshot: screenshot,
        runtimeFailure: Boolean(input.isRuntimeFailure?.())
      })
    );
    const failedResult = results.find((result) => shouldFailStepForExpectation(preconditionStep, result));
    const evidenceArtifactIds = Array.from(new Set([screenshot.artifact.id, ...results.flatMap((result) => result.evidenceArtifactIds)]));
    return {
      passed: !failedResult,
      failedResult,
      results,
      artifacts: [screenshot.artifact],
      metadata: {
        status: failedResult ? "failed" : "passed",
        durationMs: Date.now() - startedMs,
        results,
        evidenceArtifactIds
      }
    };
  }

  private async applyStartStrategy(runId: string, config: RunConfig): Promise<void> {
    const strategy = config.startStrategy ?? "keep_current";
    try {
      if (strategy === "keep_current") {
        return;
      }
      if (strategy === "go_home") {
        await this.driver.performAction(config.deviceSerial, { type: "home" });
        return;
      }
      const packageName = config.startAppPackageName?.trim();
      if (!packageName) {
        throw new Error(`${strategy} requires startAppPackageName`);
      }
      if (strategy === "restart_app") {
        await this.driver.performAction(config.deviceSerial, { type: "close_app", packageName });
        await sleep(500);
        await this.driver.performAction(config.deviceSerial, { type: "launch_app", packageName });
        return;
      }
      if (strategy === "clear_data_and_launch") {
        await this.driver.performAction(config.deviceSerial, { type: "close_app", packageName });
        await this.driver.clearAppData(config.deviceSerial, packageName);
        await sleep(500);
        await this.driver.performAction(config.deviceSerial, { type: "launch_app", packageName });
        return;
      }
      if (strategy === "launch_app") {
        await this.driver.performAction(config.deviceSerial, { type: "launch_app", packageName });
        return;
      }
      throw new Error(`Unsupported start strategy: ${strategy}`);
    } catch (error) {
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: config.deviceSerial,
        type: "start_state_failed",
        severity: "error",
        occurredAt: nowIso(),
        summary: "Flow start state failed",
        detail: errorToString(error),
        artifactIds: []
      });
      throw new Error(`Flow start state failed: ${errorToString(error)}`);
    }
  }

  private async collectMetric(runId: string, serial: string, stepResultId?: string): Promise<MetricSample | undefined> {
    try {
      const sample = await this.driver.samplePerformance(serial, runId, stepResultId);
      this.storage.addMetricSample(sample);
      return sample;
    } catch {
      return undefined;
    }
  }

  private addDeviceEvent(event: DeviceEvent): void {
    this.storage.addDeviceEvent(event);
  }

  private async startEventWatcher(
    runId: string,
    serial: string,
    onObservedEvent: (event: ObservedDeviceEvent) => void,
    trackEventWrite?: (write: Promise<void>) => void,
    getActiveStepResultId?: () => string | undefined,
    since?: Date,
    packageName?: string
  ): Promise<DeviceEventWatcher | undefined> {
    if (!this.driver.watchDeviceEvents) {
      return undefined;
    }
    try {
      return await this.driver.watchDeviceEvents(serial, (event) => {
        onObservedEvent(event);
        const eventWrite = this.recordObservedDeviceEvent(runId, serial, event, getActiveStepResultId?.()).catch((error) => {
          this.addDeviceEvent({
            id: createId("event"),
            runId,
            deviceSerial: serial,
            type: "runner_error",
            severity: "warning",
            occurredAt: nowIso(),
            summary: "Failed to record observed device event",
            detail: errorToString(error),
            artifactIds: []
          });
        });
        trackEventWrite?.(eventWrite);
        void eventWrite;
      }, { since, packageName });
    } catch (error) {
      const artifact = await this.artifactService.writeLog(runId, `event-watch-start-failed-${Date.now()}.txt`, errorToString(error));
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: serial,
        type: "command_failed",
        severity: "warning",
        occurredAt: nowIso(),
        summary: "Device event watcher unavailable",
        detail: errorToString(error),
        artifactIds: [artifact.id]
      });
      return undefined;
    }
  }

  private async recordObservedDeviceEvent(runId: string, serial: string, observed: ObservedDeviceEvent, stepResultId?: string): Promise<void> {
    const artifact = observed.detail
      ? await this.artifactService.writeLog(runId, `device-event-${observed.type}-${Date.now()}.txt`, observed.detail)
      : undefined;
    const screenshot =
      observed.type === "crash" || observed.type === "anr"
        ? await this.artifactService.captureRunEventScreenshot(runId, stepResultId, observed.type, serial).catch(() => undefined)
        : undefined;
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      stepResultId,
      deviceSerial: serial,
      type: observed.type,
      severity: observed.severity,
      occurredAt: observed.occurredAt ?? nowIso(),
      summary: observed.summary,
      detail: observed.detail,
      artifactIds: [artifact?.id, screenshot?.id].filter((id): id is string => Boolean(id))
    });
  }

}

function runtimeFailureMessage(eventType: DeviceEvent["type"] | undefined): string {
  switch (eventType) {
    case "crash":
      return "Run stopped after Android app crash event.";
    case "native_crash":
      return "Run stopped after Android app native crash event.";
    case "anr":
      return "Run stopped after Android app ANR event.";
    case "process_death":
      return "Run stopped after Android app process death event.";
    default:
      return "Run stopped after Android app stability failure.";
  }
}

function persistedCase(
  testCase: RuntimeFlow & { sourceSnapshot?: TestRun["sourceSnapshot"] },
  steps: ActionStep[] | undefined
): RuntimeFlow & { sourceSnapshot?: TestRun["sourceSnapshot"] } {
  return steps ? { ...testCase, steps: persistedSteps(steps, testCase.steps) } : testCase;
}

function persistedSteps(steps: ActionStep[] | undefined, fallback: ActionStep[]): ActionStep[] {
  return (steps ?? fallback).map((step, index) => ({ ...step, order: index + 1 }));
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function navigationString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function navigationPlatform(value: unknown): PageAssetPlatform | undefined {
  return value === "android" || value === "ios" || value === "harmony" || value === "flutter" ? value : undefined;
}

function navigationInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function navigationStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(navigationString).filter(Boolean));
}

function scriptStepResultMetadata(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = ["scriptFlowId", "scriptVersion", "scriptStepId", "sourceFlowName", "executionPhase", "onPage", "expectPage", "locatorStrategy"];
  const entries = keys.flatMap((key) => params[key] === undefined ? [] : [[key, params[key]] as const]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sleepInterruptibly(ms: number, signal: AbortSignal): Promise<void> {
  throwIfStopped(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RunnerStoppedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfStopped(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new RunnerStoppedError();
  }
}

function enabledPreconditions(step: ActionStep): StepExpectation[] {
  return (step.preconditions ?? []).filter((precondition) => precondition.enabled);
}

function mergeRuntimeInterceptorMetadata(
  metadata: StepResult["metadata"],
  outcome: RuntimeInterceptorRunOutcome
): StepResult["metadata"] {
  if (!outcome.records.length && !outcome.warning) {
    return metadata;
  }
  const currentRecords = Array.isArray(metadata?.runtimeInterceptors)
    ? (metadata.runtimeInterceptors as RuntimeInterceptorMetadataRecord[])
    : [];
  const currentWarnings = Array.isArray(metadata?.runtimeInterceptorWarnings)
    ? (metadata.runtimeInterceptorWarnings as string[])
    : [];
  return {
    ...(metadata ?? {}),
    ...(outcome.records.length ? { runtimeInterceptors: [...currentRecords, ...outcome.records] } : {}),
    ...(outcome.warning ? { runtimeInterceptorWarnings: [...currentWarnings, outcome.warning] } : {})
  };
}

function mergeActionBackendMetadata(metadata: StepResult["metadata"], actionResult: DeviceActionResult | void): StepResult["metadata"] {
  if (!actionResult) {
    return metadata;
  }
  return {
    ...(metadata ?? {}),
    actionBackend: actionResult
  };
}

function runtimeInterceptorStepToAction(step: ActionStep, deviceSize: { width: number; height: number } | undefined) {
  if ((step.type === "tap_on_text" || step.type === "tap_on_element") && (typeof step.coordinate?.x === "number" || typeof step.coordinate?.xRatio === "number")) {
    return stepToAction({ ...step, type: "tap" }, deviceSize);
  }
  return stepToAction(step, deviceSize);
}
