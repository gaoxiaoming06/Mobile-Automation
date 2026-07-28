import {
  createId,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type DeviceEvent,
  type FlowStartStrategy,
  type MetricSample,
  type RunConfig,
  type StepResult,
  type RuntimeFlow,
  type TestRun
} from "@mobile-automation/shared";
import type { Observation } from "@mobile-automation/graph-core";
import type { AutomationDeviceDriver, DeviceEventWatcher, ObservedDeviceEvent } from "./mobile-driver.js";
import { createDefaultOcrService, type OcrService } from "./ocr.js";
import { ObservationService } from "./observation-service.js";
import { RuntimeInterceptor, type RuntimeInterceptorRecord, type RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { RunArtifactService, type RunArtifactStorage } from "./run-artifact-service.js";
import { artifactUrl, runArtifactPath } from "./artifacts.js";
import { DeviceExecutionBusyError, DeviceExecutionLease } from "./device-execution-lease.js";

export type StabilityExplorerStrategy = "conservative" | "balanced" | "aggressive";
export type StabilityExplorerStartMode = "launch_app" | "current_state" | "restart_app";
export type StabilityExplorerAllowedAction = "tap" | "swipe" | "back" | "wait";
export type StabilityExplorerAppExitPolicy = "back_to_app" | "restart_app" | "stop";
export type StabilityExplorerBacktrackStrategy = "none" | "shallow" | "depth_first";
export type StabilityCandidateSource = "runtime_interceptor" | "backtrack" | "ocr_text" | "ui_element" | "visual_safe_region" | "random_safe_region" | "system";
export type StabilityCandidateStatus = "ready" | "skipped";

export type StabilityExplorerConfigInput = {
  packageName: string;
  maxDurationMs?: number;
  maxActions?: number;
  strategy?: StabilityExplorerStrategy;
  startMode?: StabilityExplorerStartMode;
  allowedActions?: StabilityExplorerAllowedAction[];
  seed?: string;
  appExitPolicy?: StabilityExplorerAppExitPolicy;
  backtrackStrategy?: StabilityExplorerBacktrackStrategy;
  maxDepth?: number;
  dangerousTextPatterns?: string[];
  stopOnCrash?: boolean;
  stopOnAnr?: boolean;
  stopOnBlackScreen?: boolean;
  stopOnUnknownPageStuck?: boolean;
};

export type StabilityExplorerConfig = Required<Omit<StabilityExplorerConfigInput, "allowedActions" | "dangerousTextPatterns" | "seed">> & {
  allowedActions: StabilityExplorerAllowedAction[];
  dangerousTextPatterns: string[];
  seed: string;
};

export type StabilityExplorerStartInput = StabilityExplorerConfigInput & {
  deviceSerial: string;
  androidAppMonitor?: RunConfig["androidAppMonitor"];
};

export type StabilityCandidate = {
  id: string;
  label: string;
  source: StabilityCandidateSource;
  status: StabilityCandidateStatus;
  action?: DeviceActionRequest;
  skipReason?: "dangerous_text" | "unsupported_action" | "missing_region" | "system_region" | "system_text" | "repeated_no_change" | "path_explored";
  region?: { x: number; y: number; width: number; height: number };
  priority?: number;
};

export type StabilityExplorerStorage = RunArtifactStorage & {
  createRun(input: { id?: string; caseName: string; deviceSerial: string; configJson: string; runSnapshotJson: string; steps: ActionStep[] }): TestRun;
  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void;
  addStepResult(result: StepResult): void;
  addMetricSample(sample: MetricSample): void;
  addDeviceEvent(event: DeviceEvent): void;
  listRunIdsByStatus(status: TestRun["status"]): string[];
  listRuntimeInterceptorRules?(filter?: { enabledOnly?: boolean; platform?: "android" | "ios"; appPackageName?: string; iosBundleId?: string }): RuntimeInterceptorRule[];
};

type ActiveStabilityRun = {
  promise: Promise<void>;
  controller: AbortController;
  deviceSerial: string;
};

type StabilityBacktrackState = {
  stack: string[];
};

const defaultDangerousTextPatterns = ["删除", "退出登录", "注销", "支付", "发布", "提交", "确认删除", "解绑", "清空", "购买"];
const defaultAllowedActions: StabilityExplorerAllowedAction[] = ["tap", "swipe", "back", "wait"];
const defaultPostActionDelayMs = 350;
const postActionPollIntervalMs = 300;
const postActionMaxWaitMs = 5000;

export class StabilityExplorer {
  private readonly activeRuns = new Map<string, ActiveStabilityRun>();
  private readonly observationService: ObservationService;
  private readonly artifactService: RunArtifactService;

  constructor(
    private readonly storage: StabilityExplorerStorage,
    private readonly driver: AutomationDeviceDriver,
    ocr: OcrService = createDefaultOcrService(),
    private readonly executionLease: DeviceExecutionLease = new DeviceExecutionLease()
  ) {
    this.observationService = new ObservationService(driver, ocr);
    this.artifactService = new RunArtifactService(storage, driver);
  }

  start(input: StabilityExplorerStartInput): TestRun {
    const config = normalizeStabilityExplorerConfig(input);
    const existing = this.getActiveRunForDevice(input.deviceSerial) ?? this.getStoredActiveRunForDevice(input.deviceSerial);
    if (existing) {
      throw new DeviceExecutionBusyError(input.deviceSerial, existing.runId, "stability_exploration");
    }

    const runConfig: RunConfig = {
      deviceSerial: input.deviceSerial,
      runKind: "stability_exploration",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 350,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false,
      startStrategy: stabilityStartStrategy(config.startMode),
      startAppPackageName: config.packageName,
      androidAppMonitor: input.androidAppMonitor,
      stabilityExploration: config
    };
    const steps = buildPlaceholderSteps(config.maxActions);
    const testCase: RuntimeFlow = {
      id: createId("stability_case"),
      name: `稳定性探索：${config.packageName}`,
      platformScope: "android",
      targetApp: { androidPackageName: config.packageName },
      tags: ["stability-exploration"],
      version: 1,
      steps,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const runId = createId("run");
    this.executionLease.acquire(input.deviceSerial, runId, "stability_exploration");
    let run: TestRun;
    try {
      run = this.storage.createRun({
        id: runId,
        caseName: testCase.name,
        deviceSerial: input.deviceSerial,
        configJson: JSON.stringify(runConfig),
        runSnapshotJson: JSON.stringify(testCase),
        steps
      });
    } catch (error) {
      this.executionLease.release(input.deviceSerial, runId);
      throw error;
    }
    const controller = new AbortController();
    const promise = this.execute(run.id, input.deviceSerial, config, controller).finally(() => {
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
    for (const [runId, run] of this.activeRuns) {
      if (run.deviceSerial === deviceSerial) {
        return { runId, deviceSerial };
      }
    }
    return undefined;
  }

  async stop(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const run = this.storage.getRun(runId);
      if (run?.status === "running") {
        this.storage.updateRunStatus(runId, "stopped");
        await this.artifactService.generateReport(runId);
        return true;
      }
      return false;
    }
    active.controller.abort();
    await Promise.race([active.promise, sleep(3000)]).catch(() => undefined);
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.activeRuns.keys()).map((runId) => this.stop(runId)));
  }

  async waitForRun(runId: string): Promise<void> {
    await this.activeRuns.get(runId)?.promise;
  }

  private async execute(runId: string, deviceSerial: string, config: StabilityExplorerConfig, controller: AbortController): Promise<void> {
    const startedMs = Date.now();
    let failed = false;
    let stopped = false;
    let stopReason = "max_actions";
    let eventWatcher: DeviceEventWatcher | undefined;
    let recentEvents: ObservedDeviceEvent[] = [];
    let unknownPageCount = 0;
    let unchangedScreenCount = 0;
    let previousSignature = "";
    const avoidedCandidateKeysBySignature = new Map<string, Set<string>>();
    const exploredCandidateKeysBySignature = new Map<string, Set<string>>();
    const backtrackState: StabilityBacktrackState = { stack: [] };

    try {
      eventWatcher = await this.driver.watchDeviceEvents?.(
        deviceSerial,
        (event) => {
          recentEvents = [...recentEvents.slice(-9), event];
          this.addEvent(runId, deviceSerial, event.type === "crash" || event.type === "anr" ? event.type : "stability_exploration", event.severity, event.summary, event.detail);
          if ((event.type === "crash" && config.stopOnCrash) || (event.type === "anr" && config.stopOnAnr)) {
            failed = true;
            stopReason = event.type;
            controller.abort();
          }
        },
        { since: new Date() }
      );
      const startReady = await this.prepareStart(runId, deviceSerial, config, controller);
      if (!startReady) {
        failed = true;
        stopReason = "start_state_failed";
        return;
      }
      this.addEvent(runId, deviceSerial, "stability_exploration", "info", "稳定性探索已启动", `package=${config.packageName}; seed=${config.seed}`);

      for (let index = 0; index < config.maxActions; index += 1) {
        throwIfAborted(controller.signal);
        if (Date.now() - startedMs >= config.maxDurationMs) {
          stopReason = "max_duration";
          break;
        }
        let before = await this.collectObservation(deviceSerial, recentEvents);
        const foregroundPackage = before.packageName;
        if (foregroundPackage !== config.packageName) {
          const recovered = await this.handleAppExit({ runId, deviceSerial, config, observation: before, controller });
          if (!recovered) {
            failed = config.appExitPolicy === "stop";
            stopReason = "app_exit";
            break;
          }
          before = recovered;
        }

        const stepStarted = nowIso();
        const stepStartedMs = Date.now();
        const interceptorOutcome = await this.handleRuntimeInterceptors({
          deviceSerial,
          config,
          initialObservation: before
        });
        if (interceptorOutcome.records.length) {
          const record = interceptorOutcome.records[0]!;
          const after = interceptorOutcome.observation;
          const stepResultId = createId("step_result");
          const screenshot = await this.artifactService.captureStepScreenshot(runId, stepResultId, 0, index + 1, deviceSerial).catch(() => undefined);
          const status = after.packageName === config.packageName ? "passed" : "failed";
          this.storage.addStepResult(this.stepResult({
            id: stepResultId,
            runId,
            index,
            type: actionTypeForStep(record.action),
            status,
            startedAt: stepStarted,
            startedMs: stepStartedMs,
            afterScreenshotId: screenshot?.id,
            artifacts: screenshot ? [screenshot] : [],
            metadata: {
              stabilityExploration: stepMetadata(
                config,
                index,
                before,
                {
                  id: record.id,
                  label: record.ruleName,
                  source: "runtime_interceptor",
                  status: "ready",
                  action: record.action
                },
                [],
                "runtime_interceptor",
                { runtimeInterceptors: interceptorOutcome.records }
              )
            },
            errorMessage: status === "failed" ? "临时页处理后目标 App 不在前台。" : undefined
          }));
          await this.collectMetric(runId, deviceSerial, stepResultId);
          if (status === "failed") {
            failed = true;
            stopReason = "app_exit";
            this.addEvent(runId, deviceSerial, "app_exit", "error", "临时页处理后跳出目标 App", `foreground=${after.packageName ?? "unknown"}`);
            break;
          }
          unknownPageCount = 0;
          continue;
        }

        const beforeMeaningfulSignature = meaningfulObservationSignature(before);
        let candidates = buildBacktrackCandidates(config, backtrackState);
        if (!candidates.length) {
          candidates = buildStabilityCandidates({
            observation: before,
            config,
            actionIndex: index,
            avoidCandidateKeys: avoidedCandidateKeysBySignature.get(beforeMeaningfulSignature),
            exploredCandidateKeys: exploredCandidateKeysBySignature.get(beforeMeaningfulSignature)
          });
        }
        let candidate = candidates.find((item) => item.status === "ready" && item.action);
        if (!candidate?.action && canBacktrack(config, backtrackState)) {
          candidates = buildBacktrackCandidates(config, backtrackState, "no_candidate");
          candidate = candidates.find((item) => item.status === "ready" && item.action);
        }
        if (!candidate?.action) {
          unknownPageCount += 1;
          this.storage.addStepResult(this.stepResult({ runId, index, type: "wait", status: "skipped", startedAt: stepStarted, startedMs: stepStartedMs, metadata: {
            stabilityExploration: stepMetadata(config, index, before, undefined, candidates, "no_candidate")
          }, errorMessage: "当前页面没有可执行的安全候选。" }));
          if (config.stopOnUnknownPageStuck && unknownPageCount >= 3) {
            failed = true;
            stopReason = "unknown_page_stuck";
            this.addEvent(runId, deviceSerial, "unknown_page_stuck", "error", "连续未知页无可探索候选", "连续 3 次未生成安全候选。");
            break;
          }
          await sleep(250);
          continue;
        }

        unknownPageCount = 0;
        const actionBacktrackDepth = backtrackState.stack.length;
        await this.driver.performAction(deviceSerial, candidate.action);
        let after = await this.waitForPostActionObservation({
          deviceSerial,
          recentEvents,
          before,
          action: candidate.action,
          targetPackageName: config.packageName,
          controller
        });
        let recoveredFromAppExit = false;
        if (after.packageName !== config.packageName) {
          const recovered = await this.handleAppExit({ runId, deviceSerial, config, observation: after, controller });
          if (recovered) {
            after = recovered;
            recoveredFromAppExit = true;
          } else {
            failed = true;
            stopReason = "app_exit";
          }
        }
        const afterMeaningfulSignature = meaningfulObservationSignature(after);
        if (after.packageName === config.packageName && afterMeaningfulSignature === beforeMeaningfulSignature) {
          rememberAvoidedCandidate(avoidedCandidateKeysBySignature, beforeMeaningfulSignature, candidate);
        }
        if (after.packageName === config.packageName && afterMeaningfulSignature !== beforeMeaningfulSignature) {
          if (candidate.source === "backtrack") {
            updateBacktrackState(backtrackState, beforeMeaningfulSignature, afterMeaningfulSignature, candidate, config);
          } else {
            rememberAvoidedCandidate(exploredCandidateKeysBySignature, beforeMeaningfulSignature, candidate);
            updateBacktrackState(backtrackState, beforeMeaningfulSignature, afterMeaningfulSignature, candidate, config);
          }
        }
        const signature = observationSignature(after);
        unchangedScreenCount = signature && signature === previousSignature ? unchangedScreenCount + 1 : 0;
        previousSignature = signature;
        const stepResultId = createId("step_result");
        const screenshot = await this.artifactService.captureStepScreenshot(runId, stepResultId, 0, index + 1, deviceSerial).catch(() => undefined);
        const status = after.packageName === config.packageName ? "passed" : "failed";
        if (status === "failed") {
          failed = true;
          stopReason = "app_exit";
        }
        this.storage.addStepResult(this.stepResult({
          id: stepResultId,
          runId,
          index,
          type: actionTypeForStep(candidate.action),
          status,
          startedAt: stepStarted,
          startedMs: stepStartedMs,
          afterScreenshotId: screenshot?.id,
          artifacts: screenshot ? [screenshot] : [],
          metadata: {
            stabilityExploration: stepMetadata(
              config,
              index,
              before,
              candidate,
              candidates,
              status === "passed" ? recoveredFromAppExit ? "app_exit_recovered" : candidate.source === "backtrack" ? "backtrack" : "executed" : "app_exit",
              { backtrackDepth: actionBacktrackDepth }
            )
          },
          errorMessage: status === "failed" ? "探索动作后目标 App 不在前台。" : undefined
        }));
        await this.collectMetric(runId, deviceSerial, stepResultId);
        if (failed) {
          this.addEvent(runId, deviceSerial, "app_exit", "error", "探索过程中跳出目标 App", `foreground=${after.packageName ?? "unknown"}`);
          break;
        }
        if (config.stopOnBlackScreen && unchangedScreenCount >= 5 && after.ocrTexts.length === 0 && after.uiElements.length === 0) {
          failed = true;
          stopReason = "black_screen";
          this.addEvent(runId, deviceSerial, "black_screen", "error", "疑似黑屏或画面长时间无变化", "连续多步无 OCR / UI 候选且画面签名未变化。");
          break;
        }
      }
    } catch (error) {
      stopped = controller.signal.aborted && !failed;
      if (!stopped) {
        failed = true;
        stopReason = "runner_error";
        this.addEvent(runId, deviceSerial, "runner_error", "error", "稳定性探索失败", errorToString(error));
      }
    } finally {
      await eventWatcher?.stop().catch(() => undefined);
      if (controller.signal.aborted && !failed) {
        stopped = true;
        stopReason = stopReason === "max_actions" ? "manual_stop" : stopReason;
      }
      await this.writeSummaryArtifact(runId, config, stopReason);
      this.storage.updateRunStatus(runId, stopped ? "stopped" : failed ? "failed" : "passed");
      await this.artifactService.generateReport(runId);
    }
  }

  private async handleAppExit(input: {
    runId: string;
    deviceSerial: string;
    config: StabilityExplorerConfig;
    observation: Observation;
    controller: AbortController;
  }): Promise<Observation | undefined> {
    this.addEvent(input.runId, input.deviceSerial, "app_exit", "warning", "目标 App 不在前台", `foreground=${input.observation.packageName ?? "unknown"}`);
    if (input.config.appExitPolicy === "stop") {
      return undefined;
    }
    if (input.config.appExitPolicy === "back_to_app") {
      await this.driver.performAction(input.deviceSerial, { type: "back" });
      await sleep(300);
      const afterBack = await this.collectObservation(input.deviceSerial, []);
      if (afterBack.packageName === input.config.packageName) {
        return afterBack;
      }
    }
    throwIfAborted(input.controller.signal);
    await this.driver.performAction(input.deviceSerial, { type: "launch_app", packageName: input.config.packageName });
    await sleep(500);
    const relaunched = await this.collectObservation(input.deviceSerial, []);
    return relaunched.packageName === input.config.packageName ? relaunched : undefined;
  }

  private async prepareStart(
    runId: string,
    deviceSerial: string,
    config: StabilityExplorerConfig,
    controller: AbortController
  ): Promise<boolean> {
    if (config.startMode === "current_state") {
      const current = await this.collectObservation(deviceSerial, []);
      if (current.packageName !== config.packageName) {
        this.addEvent(runId, deviceSerial, "start_state_failed", "error", "当前页启动失败", `foreground=${current.packageName ?? "unknown"}; expected=${config.packageName}`);
        return false;
      }
      return true;
    }
    if (config.startMode === "restart_app") {
      await this.driver.performAction(deviceSerial, { type: "close_app", packageName: config.packageName });
      await sleep(300);
      throwIfAborted(controller.signal);
    }
    await this.driver.performAction(deviceSerial, { type: "launch_app", packageName: config.packageName });
    return true;
  }

  private async collectObservation(deviceSerial: string, recentEvents: ObservedDeviceEvent[]): Promise<Observation> {
    return this.observationService.collect(deviceSerial, {
      includeScreenshot: true,
      includeOcr: true,
      includeUiTree: true,
      recentEvents
    });
  }

  private async waitForPostActionObservation(input: {
    deviceSerial: string;
    recentEvents: ObservedDeviceEvent[];
    before: Observation;
    action: DeviceActionRequest;
    targetPackageName: string;
    controller: AbortController;
  }): Promise<Observation> {
    const initialDelay = input.action.type === "wait" ? input.action.durationMs : defaultPostActionDelayMs;
    await sleep(initialDelay);

    const deadline = Date.now() + postActionMaxWaitMs;
    const beforeSignature = meaningfulObservationSignature(input.before);
    let previousNonLoadingSignature: string | undefined;
    let latest = await this.collectObservation(input.deviceSerial, input.recentEvents);

    while (true) {
      throwIfAborted(input.controller.signal);
      const latestSignature = meaningfulObservationSignature(latest);
      if (latest.packageName !== input.targetPackageName) {
        return latest;
      }
      if (!hasLoadingState(latest)) {
        if (latestSignature === beforeSignature || latestSignature === previousNonLoadingSignature) {
          return latest;
        }
        previousNonLoadingSignature = latestSignature;
      }
      if (Date.now() >= deadline) {
        return latest;
      }
      await sleep(postActionPollIntervalMs);
      latest = await this.collectObservation(input.deviceSerial, input.recentEvents);
    }
  }

  private async handleRuntimeInterceptors(input: {
    deviceSerial: string;
    config: StabilityExplorerConfig;
    initialObservation: Observation;
  }): Promise<{ observation: Observation; records: RuntimeInterceptorRecord[] }> {
    let firstObservation: Observation | undefined = input.initialObservation;
    const observe = async () => {
      if (firstObservation) {
        const observation = firstObservation;
        firstObservation = undefined;
        return observation;
      }
      return this.collectObservation(input.deviceSerial, []);
    };
    const rules = this.storage.listRuntimeInterceptorRules?.({
      enabledOnly: true,
      platform: input.initialObservation.platform,
      appPackageName: input.config.packageName,
      iosBundleId: input.initialObservation.bundleId
    }) ?? [];
    const interceptor = new RuntimeInterceptor({
      observe,
      performAction: async (step) => {
        await this.driver.performAction(input.deviceSerial, runtimeInterceptorAction(step));
      }
    }, rules);
    return interceptor.handle({ phase: "state_transition", maxPasses: 2 });
  }

  private async collectMetric(runId: string, deviceSerial: string, stepResultId?: string): Promise<void> {
    const metric = await this.driver.samplePerformance(deviceSerial, runId, stepResultId).catch(() => undefined);
    if (metric) {
      this.storage.addMetricSample(metric);
    }
  }

  private stepResult(input: {
    id?: string;
    runId: string;
    index: number;
    type: ActionStep["type"];
    status: StepResult["status"];
    startedAt: string;
    startedMs: number;
    metadata?: Record<string, unknown>;
    artifacts?: ArtifactRef[];
    afterScreenshotId?: string;
    errorMessage?: string;
  }): StepResult {
    return {
      id: input.id ?? createId("step_result"),
      runId: input.runId,
      iterationIndex: 0,
      stepId: `stability_step_${input.index + 1}`,
      stepOrder: input.index + 1,
      type: input.type,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: nowIso(),
      durationMs: Math.max(0, Date.now() - input.startedMs),
      afterScreenshotId: input.afterScreenshotId,
      artifacts: input.artifacts ?? [],
      metadata: input.metadata,
      errorCode: input.status === "failed" ? "STABILITY_EXPLORATION_FAILED" : undefined,
      errorMessage: input.errorMessage
    };
  }

  private addEvent(runId: string, deviceSerial: string, type: DeviceEvent["type"], severity: DeviceEvent["severity"], summary: string, detail?: string): void {
    this.storage.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial,
      type,
      severity,
      occurredAt: nowIso(),
      summary,
      detail,
      artifactIds: []
    });
  }

  private async writeSummaryArtifact(runId: string, config: StabilityExplorerConfig, stopReason: string): Promise<void> {
    const run = this.storage.getRun(runId);
    if (!run) {
      return;
    }
    const summary = {
      runId,
      packageName: config.packageName,
      seed: config.seed,
      strategy: config.strategy,
      backtrackStrategy: config.backtrackStrategy,
      maxDepth: config.maxDepth,
      stopReason,
      actions: run.stepResults.length,
      failedActions: run.stepResults.filter((step) => step.status === "failed").length,
      skippedActions: run.stepResults.filter((step) => step.status === "skipped").length,
      events: run.events.map((event) => ({ type: event.type, severity: event.severity, summary: event.summary, occurredAt: event.occurredAt }))
    };
    const relativePath = runArtifactPath(runId, "logs", "stability-exploration-summary.json");
    const written = await this.storage.writeArtifact(relativePath, JSON.stringify(summary, null, 2));
    this.storage.addArtifact({
      id: createId("artifact"),
      runId,
      type: "report_json",
      name: "stability-exploration-summary.json",
      path: relativePath,
      url: artifactUrl(relativePath),
      mimeType: "application/json",
      sizeBytes: written.sizeBytes,
      createdAt: nowIso()
    });
  }

  private getStoredActiveRunForDevice(deviceSerial: string): { runId: string; deviceSerial: string } | undefined {
    for (const status of ["running", "paused"] as const) {
      for (const runId of this.storage.listRunIdsByStatus(status)) {
        const run = this.storage.getRun(runId);
        if (run?.deviceSerial === deviceSerial) {
          return { runId, deviceSerial };
        }
      }
    }
    return undefined;
  }
}

export function normalizeStabilityExplorerConfig(input: StabilityExplorerConfigInput): StabilityExplorerConfig {
  const packageName = input.packageName.trim();
  if (!packageName) {
    throw new Error("packageName is required");
  }
  return {
    packageName,
    maxDurationMs: clampInteger(input.maxDurationMs, 180_000, 10_000, 30 * 60_000),
    maxActions: clampInteger(input.maxActions, 100, 1, 1000),
    strategy: input.strategy === "balanced" || input.strategy === "aggressive" ? input.strategy : "conservative",
    startMode: normalizeStartMode(input.startMode),
    allowedActions: normalizeAllowedActions(input.allowedActions),
    seed: input.seed?.trim() || createId("seed"),
    appExitPolicy: input.appExitPolicy === "restart_app" || input.appExitPolicy === "stop" ? input.appExitPolicy : "back_to_app",
    backtrackStrategy: normalizeBacktrackStrategy(input.backtrackStrategy),
    maxDepth: clampInteger(input.maxDepth, 4, 1, 10),
    dangerousTextPatterns: uniqueStrings([...(input.dangerousTextPatterns ?? []), ...defaultDangerousTextPatterns].map((item) => item.trim()).filter(Boolean)),
    stopOnCrash: input.stopOnCrash ?? true,
    stopOnAnr: input.stopOnAnr ?? true,
    stopOnBlackScreen: input.stopOnBlackScreen ?? true,
    stopOnUnknownPageStuck: input.stopOnUnknownPageStuck ?? true
  };
}

export function buildStabilityCandidates(input: {
  observation: Observation;
  config: StabilityExplorerConfig;
  actionIndex: number;
  avoidCandidateKeys?: Set<string>;
  exploredCandidateKeys?: Set<string>;
}): StabilityCandidate[] {
  const candidates: StabilityCandidate[] = [];
  const resolution = input.observation.resolution ?? { width: 1080, height: 2400 };
  for (const text of input.observation.ocrTexts ?? []) {
    if (!text.text?.trim()) {
      continue;
    }
    const label = text.text.trim();
    const region = text.region;
    const dangerous = isDangerousText(label, input.config.dangerousTextPatterns);
    const systemSkipReason = dangerous ? undefined : systemOcrSkipReason(label, region, resolution);
    const supportsTap = input.config.allowedActions.includes("tap");
    const skipReason = dangerous ? "dangerous_text" : systemSkipReason ?? (region ? supportsTap ? undefined : "unsupported_action" : "missing_region");
    candidates.push({
      id: createId("stability_candidate"),
      label,
      source: "ocr_text",
      status: skipReason ? "skipped" : "ready",
      skipReason,
      region,
      priority: region ? ocrCandidatePriority(label, region, resolution) : undefined,
      action: !skipReason && region
        ? {
            type: "tap",
            x: Math.round(region.x + region.width / 2),
            y: Math.round(region.y + region.height / 2)
          }
        : undefined
    });
  }

  if ((input.config.strategy === "balanced" || input.config.strategy === "aggressive") && input.config.allowedActions.includes("swipe")) {
    candidates.push({
      id: createId("stability_candidate"),
      label: "内容区滑动",
      source: "visual_safe_region",
      status: "ready",
      action: {
        type: "swipe",
        startX: Math.round(resolution.width * 0.5),
        startY: Math.round(resolution.height * 0.72),
        endX: Math.round(resolution.width * 0.5),
        endY: Math.round(resolution.height * 0.38),
        durationMs: 420
      }
    });
  }

  if (input.config.strategy === "aggressive") {
    const random = seededUnit(input.config.seed, input.actionIndex);
    if (input.config.allowedActions.includes("tap")) {
      candidates.push({
        id: createId("stability_candidate"),
        label: "随机安全区域点击",
        source: "random_safe_region",
        status: "ready",
        action: {
          type: "tap",
          x: Math.round(resolution.width * (0.18 + random * 0.64)),
          y: Math.round(resolution.height * (0.22 + seededUnit(input.config.seed, input.actionIndex + 17) * 0.58))
        }
      });
    }
    if (input.config.allowedActions.includes("wait")) {
      candidates.push({
        id: createId("stability_candidate"),
        label: "等待页面稳定",
        source: "random_safe_region",
        status: "ready",
        action: { type: "wait", durationMs: 500 }
      });
    }
  }

  if (!candidates.some((candidate) => candidate.status === "ready") && input.config.allowedActions.includes("wait")) {
    candidates.push({
      id: createId("stability_candidate"),
      label: "等待页面变化",
      source: "system",
      status: "ready",
      action: { type: "wait", durationMs: 500 }
    });
  }

  applyPathExploredSkips(candidates, input.exploredCandidateKeys);
  applyRepeatedNoChangeSkips(candidates, input.avoidCandidateKeys);
  return candidates.sort((left, right) => candidateRank(left) - candidateRank(right));
}

function stepMetadata(
  config: StabilityExplorerConfig,
  index: number,
  observation: Observation,
  candidate: StabilityCandidate | undefined,
  candidates: StabilityCandidate[],
  resultType: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    actionIndex: index + 1,
    packageName: config.packageName,
    seed: config.seed,
    strategy: config.strategy,
    resultType,
    currentPackage: observation.packageName,
    candidateLabel: candidate?.label,
    candidateSource: candidate?.source,
    candidateAction: candidate?.action,
    skippedCandidates: candidates
      .filter((item) => item.status === "skipped")
      .slice(0, 12)
      .map((item) => ({ label: item.label, source: item.source, skipReason: item.skipReason })),
    observedTexts: observation.ocrTexts.slice(0, 12).map((item) => item.text),
    ...extra
  };
}

function buildPlaceholderSteps(maxActions: number): ActionStep[] {
  const now = nowIso();
  return Array.from({ length: maxActions }, (_, index) => ({
    id: `stability_step_${index + 1}`,
    order: index + 1,
    type: "wait",
    enabled: true,
    title: `探索动作 ${index + 1}`,
    params: {},
    createdAt: now
  }));
}

function actionTypeForStep(action: DeviceActionRequest): ActionStep["type"] {
  if (action.type === "tap" || action.type === "swipe" || action.type === "back" || action.type === "wait") {
    return action.type;
  }
  return "wait";
}

function candidateRank(candidate: StabilityCandidate): number {
  const statusRank = candidate.status === "ready" ? 0 : 100_000;
  const sourceRank: Record<StabilityCandidateSource, number> = {
    runtime_interceptor: 0,
    backtrack: 1,
    ocr_text: 2,
    ui_element: 3,
    visual_safe_region: 4,
    random_safe_region: 5,
    system: 6
  };
  return statusRank + sourceRank[candidate.source] * 1000 + (candidate.priority ?? 0);
}

function buildBacktrackCandidates(
  config: StabilityExplorerConfig,
  state: StabilityBacktrackState,
  reason: "max_depth" | "no_candidate" = "max_depth"
): StabilityCandidate[] {
  if (!shouldBacktrack(config, state, reason)) {
    return [];
  }
  return [
    {
      id: createId("stability_candidate"),
      label: "返回上一页",
      source: "backtrack",
      status: "ready",
      action: { type: "back" },
      priority: -2000
    }
  ];
}

function shouldBacktrack(
  config: StabilityExplorerConfig,
  state: StabilityBacktrackState,
  reason: "max_depth" | "no_candidate"
): boolean {
  if (!canBacktrack(config, state)) {
    return false;
  }
  return reason === "no_candidate" || state.stack.length >= config.maxDepth;
}

function canBacktrack(config: StabilityExplorerConfig, state: StabilityBacktrackState): boolean {
  return config.backtrackStrategy !== "none" && config.allowedActions.includes("back") && state.stack.length > 0;
}

function updateBacktrackState(
  state: StabilityBacktrackState,
  beforeSignature: string,
  afterSignature: string,
  candidate: StabilityCandidate,
  config: StabilityExplorerConfig
): void {
  if (config.backtrackStrategy === "none" || !beforeSignature || !afterSignature || beforeSignature === afterSignature) {
    return;
  }
  if (candidate.source === "backtrack") {
    state.stack.pop();
    return;
  }
  const ancestorIndex = state.stack.indexOf(afterSignature);
  if (ancestorIndex >= 0) {
    state.stack.splice(ancestorIndex);
    return;
  }
  if (state.stack.at(-1) !== beforeSignature) {
    state.stack.push(beforeSignature);
  }
  if (state.stack.length > 20) {
    state.stack.splice(0, state.stack.length - 20);
  }
}

function applyPathExploredSkips(candidates: StabilityCandidate[], exploredCandidateKeys: Set<string> | undefined): void {
  if (!exploredCandidateKeys?.size) {
    return;
  }
  for (const candidate of candidates) {
    if (candidate.status !== "ready") {
      continue;
    }
    if (exploredCandidateKeys.has(candidateAvoidKey(candidate))) {
      candidate.status = "skipped";
      candidate.skipReason = "path_explored";
    }
  }
}

function applyRepeatedNoChangeSkips(candidates: StabilityCandidate[], avoidCandidateKeys: Set<string> | undefined): void {
  if (!avoidCandidateKeys?.size) {
    return;
  }
  for (const candidate of candidates) {
    if (candidate.status !== "ready") {
      continue;
    }
    if (avoidCandidateKeys.has(candidateAvoidKey(candidate))) {
      candidate.status = "skipped";
      candidate.skipReason = "repeated_no_change";
    }
  }
}

function rememberAvoidedCandidate(
  avoidedCandidateKeysBySignature: Map<string, Set<string>>,
  signature: string,
  candidate: StabilityCandidate
): void {
  const key = candidateAvoidKey(candidate);
  const keys = avoidedCandidateKeysBySignature.get(signature) ?? new Set<string>();
  keys.add(key);
  avoidedCandidateKeysBySignature.set(signature, keys);
}

function candidateAvoidKey(candidate: StabilityCandidate): string {
  return [candidate.source, normalizeComparableObservationText(candidate.label), actionAvoidKey(candidate.action)].join("|");
}

function actionAvoidKey(action: DeviceActionRequest | undefined): string {
  if (!action) {
    return "none";
  }
  if (action.type === "tap") {
    return `tap:${Math.round(action.x)}:${Math.round(action.y)}`;
  }
  if (action.type === "swipe") {
    return `swipe:${Math.round(action.startX)}:${Math.round(action.startY)}:${Math.round(action.endX)}:${Math.round(action.endY)}`;
  }
  if (action.type === "wait") {
    return `wait:${action.durationMs}`;
  }
  if (action.type === "back") {
    return "back";
  }
  if (action.type === "launch_app") {
    return `launch_app:${action.packageName}`;
  }
  return action.type;
}

function actionAllowed(action: DeviceActionRequest, allowedActions: StabilityExplorerAllowedAction[]): boolean {
  if (action.type === "tap" || action.type === "swipe" || action.type === "back" || action.type === "wait") {
    return allowedActions.includes(action.type);
  }
  return false;
}

function runtimeInterceptorAction(step: ActionStep): DeviceActionRequest {
  if (step.type === "back") {
    return { type: "back" };
  }
  if (typeof step.coordinate?.x === "number" && typeof step.coordinate.y === "number") {
    return {
      type: "tap",
      x: step.coordinate.x,
      y: step.coordinate.y
    };
  }
  throw new Error(`Runtime interceptor step cannot be converted to device action: ${step.type}`);
}

function systemOcrSkipReason(
  label: string,
  region: StabilityCandidate["region"],
  resolution: { width: number; height: number }
): StabilityCandidate["skipReason"] | undefined {
  const normalized = label.trim();
  if (!region) {
    return undefined;
  }
  const centerY = region.y + region.height / 2;
  if (centerY < Math.max(96, resolution.height * 0.06)) {
    return "system_region";
  }
  if (/^\d{1,2}:\d{2}$/.test(normalized) || /^[0-9%]+$/.test(normalized)) {
    return "system_text";
  }
  return undefined;
}

function ocrCandidatePriority(
  label: string,
  region: NonNullable<StabilityCandidate["region"]>,
  resolution: { width: number; height: number }
): number {
  let priority = 0;
  const normalized = label.trim();
  if (/(创建|新建|添加|加入|上课|进入|打开|搜索|更多|详情|班级|课程|消息|待办)/.test(normalized)) {
    priority -= 300;
  }
  if (/^(主页|首页|全部|全部班级|我是教师|我是学生)$/.test(normalized)) {
    priority += 220;
  }
  const centerY = region.y + region.height / 2;
  if (centerY < resolution.height * 0.14) {
    priority += 180;
  }
  if (centerY > resolution.height * 0.9) {
    priority += 120;
  }
  priority += Math.round(Math.abs(centerY - resolution.height * 0.48) / resolution.height * 100);
  return priority;
}

function normalizeAllowedActions(value: StabilityExplorerAllowedAction[] | undefined): StabilityExplorerAllowedAction[] {
  const allowed = new Set<StabilityExplorerAllowedAction>();
  for (const item of value?.length ? value : defaultAllowedActions) {
    if (item === "tap" || item === "swipe" || item === "back" || item === "wait") {
      allowed.add(item);
    }
  }
  return allowed.size ? Array.from(allowed) : [...defaultAllowedActions];
}

function normalizeStartMode(value: StabilityExplorerStartMode | undefined): StabilityExplorerStartMode {
  return value === "launch_app" || value === "current_state" ? value : "restart_app";
}

function normalizeBacktrackStrategy(value: StabilityExplorerBacktrackStrategy | undefined): StabilityExplorerBacktrackStrategy {
  return value === "none" || value === "depth_first" ? value : "shallow";
}

function stabilityStartStrategy(value: StabilityExplorerStartMode): FlowStartStrategy {
  return value === "current_state" ? "keep_current" : value;
}

function isDangerousText(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function observationSignature(observation: Observation): string {
  return [
    observation.packageName ?? "",
    ...observation.ocrTexts.slice(0, 20).map((item) => item.text),
    ...observation.uiElements.slice(0, 20).map((item) => item.text ?? item.contentDesc ?? item.resourceId ?? "")
  ].join("|");
}

function hasLoadingState(observation: Observation): boolean {
  return observation.ocrTexts.some((item) => isLoadingText(item.text))
    || observation.uiElements.some((item) => isLoadingText(item.text)
      || isLoadingText(item.contentDesc)
      || isLoadingUiElement(item.className, item.resourceId));
}

function isLoadingText(value: string | undefined): boolean {
  const normalized = normalizeObservationText(value);
  return /加载中|正在加载|页面加载|数据加载|载入中|请稍候|请稍等|努力加载|刷新中|同步中|loading/.test(normalized);
}

function isLoadingUiElement(className: string | undefined, resourceId: string | undefined): boolean {
  const normalizedClassName = normalizeObservationText(className);
  const normalizedResourceId = normalizeObservationText(resourceId);
  return normalizedClassName.includes("progressbar")
    || normalizedResourceId.includes("progress")
    || normalizedResourceId.includes("loading");
}

function meaningfulObservationSignature(observation: Observation): string {
  const resolution = observation.resolution ?? { width: 1080, height: 2400 };
  const ocrTokens = observation.ocrTexts
    .map((item) => meaningfulTextToken(item.text, item.region, resolution))
    .filter((item): item is string => Boolean(item));
  const uiTokens = observation.uiElements
    .flatMap((item) => [
      meaningfulTextToken(item.text, item.bounds, resolution),
      meaningfulTextToken(item.contentDesc, item.bounds, resolution),
      item.resourceId ? `id:${item.resourceId}` : undefined
    ])
    .filter((item): item is string => Boolean(item));

  return [
    observation.packageName ?? "",
    observation.activityName ?? "",
    ...uniqueStrings([...ocrTokens, ...uiTokens]).sort().slice(0, 60)
  ].join("|");
}

function meaningfulTextToken(
  value: string | undefined,
  region: StabilityCandidate["region"],
  resolution: { width: number; height: number }
): string | undefined {
  const normalized = normalizeObservationText(value);
  if (!normalized || systemOcrSkipReason(normalized, region, resolution) || isVolatileObservationText(normalized)) {
    return undefined;
  }
  const comparable = normalizeComparableObservationText(normalized);
  if (!comparable) {
    return undefined;
  }
  if (!region) {
    return comparable;
  }
  const centerXBucket = Math.round((region.x + region.width / 2) / 24);
  const centerYBucket = Math.round((region.y + region.height / 2) / 24);
  return `${comparable}@${centerXBucket}:${centerYBucket}`;
}

function normalizeObservationText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeComparableObservationText(value: string | undefined): string {
  return normalizeObservationText(value).replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function isVolatileObservationText(value: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(value)
    || /^[\d:：./年月日时分秒%+-]+$/.test(value)
    || /^(cpu|mem|fps)[:：]?[\d.]+(%|mb)?$/.test(value)
    || /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(value)
    || /^\d{1,2}月\d{1,2}日$/.test(value)
    || /^\d+时\d+分$/.test(value)
    || /^已上课\d+时\d+分/.test(value)
    || /^周[一二三四五六日天]$/.test(value);
}

function seededUnit(seed: string, index: number): number {
  let hash = 2166136261;
  const input = `${seed}:${index}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("stability exploration stopped");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
