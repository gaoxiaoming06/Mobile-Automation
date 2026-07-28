import {
  type ActionStep,
  type DeviceInfo,
  type RunConfig,
  type RunStatus,
  type StepResult
} from "@mobile-automation/shared";

export function normalizeRunConfig(config: Partial<RunConfig> & { deviceSerial: string }): RunConfig {
  const repeatCount = Math.max(1, Math.floor(config.repeatCount ?? 1));
  const mode = config.mode ?? (repeatCount > 1 ? "repeat_n" : "once");
  return {
    deviceSerial: config.deviceSerial,
    mode,
    repeatCount,
    stepIntervalMs: Math.max(0, Math.floor(config.stepIntervalMs ?? 400)),
    stopOnFailure: config.stopOnFailure ?? true,
    recordVideo: config.recordVideo ?? true,
    keepVideoOnSuccess: config.keepVideoOnSuccess ?? true,
    pauseAfterEachStep: config.pauseAfterEachStep ?? false,
    startStrategy: config.startStrategy ?? "keep_current",
    startAppPackageName: config.startAppPackageName,
    startSetupScope: config.startSetupScope ?? "before_run",
    androidAppMonitor: config.androidAppMonitor ? cloneAndroidAppMonitorConfig(config.androidAppMonitor) : undefined
  };
}

function cloneAndroidAppMonitorConfig(config: NonNullable<RunConfig["androidAppMonitor"]>): NonNullable<RunConfig["androidAppMonitor"]> {
  const thresholds = config.thresholds ?? {};
  return {
    ...config,
    processFilters: config.processFilters ? [...config.processFilters] : undefined,
    thresholds: config.thresholds
      ? {
          ...(thresholds.cpuPercent ? { cpuPercent: { ...thresholds.cpuPercent } } : {}),
          ...(thresholds.pssMb ? { pssMb: { ...thresholds.pssMb } } : {})
        }
      : undefined
  };
}

export function enabledSteps(steps: ActionStep[]): ActionStep[] {
  return steps
    .filter((step) => step.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
}

export function totalStepExecutions(config: RunConfig, steps: ActionStep[]): number {
  if (config.mode === "loop_until_stop") {
    return Number.POSITIVE_INFINITY;
  }
  return enabledSteps(steps).length * config.repeatCount;
}

export function shouldStopAfterFailure(config: RunConfig): boolean {
  return config.stopOnFailure;
}

export function shouldRecordVideoForDevice(config: RunConfig, device: Pick<DeviceInfo, "capabilities">): boolean {
  return config.recordVideo && device.capabilities.recordVideo;
}

export type RunnerControlStatus = Extract<RunStatus, "running" | "paused" | "stopped">;

export type RunStepExecutionInput = {
  iterationIndex: number;
  step: ActionStep;
  signal: AbortSignal;
};

export type RunStepExecutionResult = Pick<StepResult, "status">;

export type RunStateMachineOptions = {
  config: RunConfig;
  steps: ActionStep[];
  controller: RunExecutionController;
  executeStep: (input: RunStepExecutionInput) => Promise<RunStepExecutionResult>;
  beforeIteration?: (iterationIndex: number) => Promise<void>;
  onStatusChange?: (status: Extract<RunStatus, "running" | "paused">) => void;
};

export type RunStateMachineResult = {
  status: Extract<RunStatus, "passed" | "failed" | "stopped">;
  failed: boolean;
  stopped: boolean;
  executedStepCount: number;
  completedIterationCount: number;
};

type ControllerListener = (status: RunnerControlStatus) => void;

export class RunnerStoppedError extends Error {
  constructor(message = "Run stopped by user") {
    super(message);
    this.name = "RunnerStoppedError";
  }
}

export class RunExecutionController {
  private readonly abortController = new AbortController();
  private readonly listeners = new Set<ControllerListener>();
  private readonly waiters = new Set<() => void>();
  private paused = false;
  private stopped = false;
  private stepPermits = 0;

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get status(): RunnerControlStatus {
    if (this.stopped) {
      return "stopped";
    }
    return this.paused ? "paused" : "running";
  }

  onStatusChange(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause(): boolean {
    if (this.stopped || this.paused) {
      return false;
    }
    this.paused = true;
    this.notify();
    return true;
  }

  resume(): boolean {
    if (this.stopped || !this.paused) {
      return false;
    }
    this.paused = false;
    this.stepPermits = 0;
    this.notify();
    this.releaseWaiters();
    return true;
  }

  step(): boolean {
    if (this.stopped) {
      return false;
    }
    if (!this.paused) {
      this.paused = true;
      this.notify();
    }
    this.stepPermits += 1;
    this.releaseWaiters();
    return true;
  }

  stop(): boolean {
    if (this.stopped) {
      return false;
    }
    this.stopped = true;
    this.paused = false;
    this.stepPermits = 0;
    this.abortController.abort();
    this.notify();
    this.releaseWaiters();
    return true;
  }

  async waitUntilRunnable(): Promise<void> {
    this.throwIfStopped();
    while (this.paused) {
      if (this.stepPermits > 0) {
        this.stepPermits -= 1;
        return;
      }
      await this.waitForStateChange();
      this.throwIfStopped();
    }
  }

  throwIfStopped(): void {
    if (this.stopped || this.signal.aborted) {
      throw new RunnerStoppedError();
    }
  }

  private waitForStateChange(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }

  private releaseWaiters(): void {
    const waiters = Array.from(this.waiters);
    this.waiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  }

  private notify(): void {
    const status = this.status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

export class RunStateMachine {
  constructor(private readonly options: RunStateMachineOptions) {}

  async run(): Promise<RunStateMachineResult> {
    const { config, controller, executeStep } = this.options;
    const steps = enabledSteps(this.options.steps);
    if (steps.length === 0) {
      throw new Error("No enabled steps to execute");
    }

    const unsubscribe = controller.onStatusChange((status) => {
      if (status === "running" || status === "paused") {
        this.options.onStatusChange?.(status);
      }
    });

    let failed = false;
    let stopped = false;
    let executedStepCount = 0;
    let completedIterationCount = 0;

    try {
      const maxIterations = maxIterationsFor(config);
      for (let iterationIndex = 1; iterationIndex <= maxIterations; iterationIndex += 1) {
        await this.options.beforeIteration?.(iterationIndex);
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
          await controller.waitUntilRunnable();
          const result = await executeStep({
            iterationIndex,
            step: steps[stepIndex],
            signal: controller.signal
          });
          executedStepCount += 1;
          if (result.status !== "passed" && result.status !== "skipped") {
            failed = true;
            if (config.stopOnFailure) {
              return {
                status: "failed",
                failed,
                stopped,
                executedStepCount,
                completedIterationCount
              };
            }
          }
          await yieldToEventLoop();

          const hasNextStep = stepIndex < steps.length - 1 || iterationIndex < maxIterations;
          if (config.pauseAfterEachStep && hasNextStep) {
            controller.pause();
          }
        }
        completedIterationCount += 1;
      }
    } catch (error) {
      stopped = isRunnerStoppedError(error);
      if (!stopped) {
        throw error;
      }
    } finally {
      unsubscribe();
    }

    return {
      status: stopped ? "stopped" : failed ? "failed" : "passed",
      failed,
      stopped,
      executedStepCount,
      completedIterationCount
    };
  }
}

export function isRunnerStoppedError(error: unknown): error is RunnerStoppedError {
  return error instanceof RunnerStoppedError || (error instanceof Error && error.name === "RunnerStoppedError");
}

function maxIterationsFor(config: RunConfig): number {
  if (config.mode === "loop_until_stop") {
    return Number.POSITIVE_INFINITY;
  }
  if (config.mode === "once") {
    return 1;
  }
  return Math.max(1, Math.floor(config.repeatCount));
}

function yieldToEventLoop(): Promise<void> {
  return delay(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
