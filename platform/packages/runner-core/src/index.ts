import type { ExecutionPlan, ExecutionPlanStep, NodeMatchResult, Observation } from "@mobile-automation/graph-core";
import {
  createId,
  nowIso,
  type ActionStep,
  type DeviceInfo,
  type RunConfig,
  type RunStatus,
  type StepExpectation,
  type StepExpectationResult,
  type StepResult
} from "@mobile-automation/shared";

export function normalizeRunConfig(config: Partial<RunConfig> & { deviceSerial: string }): RunConfig {
  const repeatCount = Math.max(1, Math.floor(config.repeatCount ?? 1));
  const mode = config.mode ?? (repeatCount > 1 ? "repeat_n" : "once");
  return {
    caseId: config.caseId,
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

export type GraphExecutionPhase = "precondition" | "action" | "state_transition" | "expectation" | "system_guard" | "target_validation" | "device";

export type GraphExpectationEvaluationInput = {
  expectation: StepExpectation;
  phase: Exclude<GraphExecutionPhase, "action" | "state_transition" | "device">;
  step: ExecutionPlanStep;
  observation?: Observation;
  nodeMatch?: NodeMatchResult;
};

export type GraphRunnerDriver = {
  observe(step: ExecutionPlanStep, phase: "precondition" | "state_transition" | "expectation" | "system_guard"): Promise<Observation>;
  detectNode(observation: Observation): Promise<NodeMatchResult>;
  performAction(action: ActionStep, step: ExecutionPlanStep): Promise<void>;
  evaluateExpectation(input: GraphExpectationEvaluationInput): Promise<StepExpectationResult>;
};

export type GraphStepExecutionResult = {
  id: string;
  planStepId: string;
  order: number;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  actionId?: string;
  status: "passed" | "failed" | "blocked" | "skipped";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  phase?: GraphExecutionPhase;
  errorCode?: string;
  errorMessage?: string;
  observations: {
    before?: Observation;
    after?: Observation;
  };
  nodeMatches: {
    before?: NodeMatchResult;
    after?: NodeMatchResult;
  };
  preconditionResults: StepExpectationResult[];
  expectationResults: StepExpectationResult[];
  systemGuardResults: StepExpectationResult[];
  usedActionPolicyId?: string;
  fallbackActionPolicyId?: string;
  recoveryAttempt?: number;
  recoveryReasonDeviationId?: string;
  deviations: GraphDeviationRecord[];
};

export type GraphDeviationRecord = {
  id: string;
  phase: GraphExecutionPhase;
  expectedNodeId?: string;
  actualNodeId?: string;
  actualStatus?: NodeMatchResult["status"];
  attempt: number;
  action: "retry_observe" | "fail" | "replan_required" | "recover_required";
  message: string;
  recordedAt: string;
};

export type GraphRecoveryRecord = {
  id: string;
  attempt: number;
  fromNodeId: string;
  targetNodeId: string;
  routePlanId?: string;
  executionPlanId?: string;
  status: "planned" | "passed" | "failed" | "blocked" | "stopped";
  reasonDeviationId?: string;
  message: string;
  recordedAt: string;
};

export type GraphExecutionResult = {
  id: string;
  executionPlanId: string;
  routePlanId: string;
  graphVersionId: string;
  appId: string;
  targetNodeId: string;
  status: "passed" | "failed" | "blocked" | "stopped";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  steps: GraphStepExecutionResult[];
  failure?: {
    stepId?: string;
    edgeId?: string;
    phase: GraphExecutionPhase;
    code: string;
    message: string;
  };
  deviations: GraphDeviationRecord[];
  recoveries?: GraphRecoveryRecord[];
};

export type GraphRunnerOptions = {
  executionPlan: ExecutionPlan;
  driver: GraphRunnerDriver;
  controller?: RunExecutionController;
  stopOnFailure?: boolean;
  idFactory?: (prefix: string) => string;
  now?: () => string;
};

export class GraphRunner {
  private readonly controller: RunExecutionController;
  private readonly stopOnFailure: boolean;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => string;

  constructor(private readonly options: GraphRunnerOptions) {
    this.controller = options.controller ?? new RunExecutionController();
    this.stopOnFailure = options.stopOnFailure ?? true;
    this.idFactory = options.idFactory ?? createId;
    this.now = options.now ?? nowIso;
  }

  async run(): Promise<GraphExecutionResult> {
    const startedAt = this.now();
    const startedMs = Date.now();
    const steps: GraphStepExecutionResult[] = [];
    const blockingIssue = this.options.executionPlan.unresolvedIssues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
      return {
        id: this.idFactory("graph_run"),
        executionPlanId: this.options.executionPlan.id,
        routePlanId: this.options.executionPlan.routePlanId,
        graphVersionId: this.options.executionPlan.graphVersionId,
        appId: this.options.executionPlan.appId,
        targetNodeId: this.options.executionPlan.targetNodeId,
        status: "blocked",
        startedAt,
        endedAt: this.now(),
        durationMs: Date.now() - startedMs,
        steps,
        deviations: [],
        failure: {
          edgeId: blockingIssue.edgeId,
          phase: "action",
          code: blockingIssue.code,
          message: blockingIssue.message
        }
      };
    }

    try {
      for (const step of this.options.executionPlan.steps) {
        await this.controller.waitUntilRunnable();
        const result = await this.executeStep(step);
        steps.push(result);
        if (result.status !== "passed" && this.stopOnFailure) {
          return this.buildResult("failed", startedAt, startedMs, steps, result);
        }
        await yieldToEventLoop();
      }
    } catch (error) {
      if (isRunnerStoppedError(error)) {
        return this.buildResult("stopped", startedAt, startedMs, steps);
      }
      const failedStep = steps.at(-1);
      return this.buildResult("failed", startedAt, startedMs, steps, failedStep, {
        phase: failedStep?.phase ?? "device",
        code: "GRAPH_RUNNER_ERROR",
        message: errorToString(error)
      });
    }

    return this.buildResult("passed", startedAt, startedMs, steps);
  }

  private async executeStep(step: ExecutionPlanStep): Promise<GraphStepExecutionResult> {
    const startedAt = this.now();
    const startedMs = Date.now();
    const base: Omit<GraphStepExecutionResult, "endedAt" | "durationMs" | "status"> = {
      id: this.idFactory("graph_step_result"),
      planStepId: step.id,
      order: step.order,
      edgeId: step.edgeId,
      fromNodeId: step.fromNode.id,
      toNodeId: step.toNode.id,
      actionId: step.action?.id,
      startedAt,
      observations: {},
      nodeMatches: {},
      preconditionResults: [],
      expectationResults: [],
      systemGuardResults: [],
      usedActionPolicyId: step.selectedActionPolicy?.id,
      recoveryAttempt: step.recovery?.attempt,
      recoveryReasonDeviationId: step.recovery?.reasonDeviationId,
      deviations: []
    };
    const finish = (result: Omit<GraphStepExecutionResult, "endedAt" | "durationMs">): GraphStepExecutionResult => ({
      ...result,
      endedAt: this.now(),
      durationMs: Date.now() - startedMs
    });

    if (step.executionMode === "blocked") {
      const issue = step.issues[0];
      return finish({
        ...base,
        status: "blocked",
        phase: "action",
        errorCode: issue?.code ?? "STEP_BLOCKED",
        errorMessage: issue?.message ?? `Execution step ${step.id} is blocked.`
      });
    }

    const before = await this.options.driver.observe(step, "precondition");
    const beforeMatch = await this.options.driver.detectNode(before);
    base.observations.before = before;
    base.nodeMatches.before = beforeMatch;
    if (beforeMatch.status !== "matched" || beforeMatch.node?.id !== step.fromNode.id) {
      return finish({
        ...base,
        status: "failed",
        phase: "precondition",
        errorCode: "FROM_NODE_NOT_MATCHED",
        errorMessage: `Expected current node ${step.fromNode.id}, got ${beforeMatch.node?.id ?? beforeMatch.status}.`
      });
    }

    const preconditionResults = await this.evaluateExpectations(step.preconditions, step, "precondition", before, beforeMatch);
    base.preconditionResults = preconditionResults;
    const failedPrecondition = firstBlockingFailure(preconditionResults);
    if (failedPrecondition) {
      return finish({
        ...base,
        status: "failed",
        phase: "precondition",
        errorCode: "PRECONDITION_FAILED",
        errorMessage: `${failedPrecondition.type}: ${failedPrecondition.reason ?? failedPrecondition.actual}`
      });
    }

    if (step.executionMode === "noop") {
      const expectationResults = await this.evaluateExpectations(step.expectations, step, "expectation", before, beforeMatch);
      base.expectationResults = expectationResults;
      const failedExpectation = firstBlockingFailure(expectationResults);
      if (failedExpectation) {
        return finish({
          ...base,
          status: "failed",
          phase: "expectation",
          errorCode: "EXPECTATION_FAILED",
          errorMessage: `${failedExpectation.type}: ${failedExpectation.reason ?? failedExpectation.actual}`
        });
      }

      const systemGuardResults = await this.evaluateExpectations(step.systemGuards, step, "system_guard", before, beforeMatch);
      base.systemGuardResults = systemGuardResults;
      const failedSystemGuard = firstBlockingFailure(systemGuardResults);
      if (failedSystemGuard) {
        return finish({
          ...base,
          status: "failed",
          phase: "system_guard",
          errorCode: "SYSTEM_GUARD_FAILED",
          errorMessage: `${failedSystemGuard.type}: ${failedSystemGuard.reason ?? failedSystemGuard.actual}`
        });
      }

      return finish({
        ...base,
        status: "passed",
        phase: "target_validation"
      });
    }

    if (!step.action) {
      return finish({
        ...base,
        status: "blocked",
        phase: "action",
        errorCode: "STEP_ACTION_MISSING",
        errorMessage: `Execution step ${step.id} has no action.`
      });
    }

    try {
      await this.options.driver.performAction(step.action, step);
    } catch (error) {
      return finish({
        ...base,
        status: "failed",
        phase: "action",
        errorCode: "ACTION_FAILED",
        errorMessage: errorToString(error)
      });
    }
    if (shouldSkipStateTransitionValidation(step)) {
      return finish({
        ...base,
        status: "passed",
        phase: "action"
      });
    }
    const waitPolicy = transitionWaitPolicyFor(step);
    let after = await this.options.driver.observe(step, "state_transition");
    let afterMatch = await this.options.driver.detectNode(after);
    let transitionAttempt = 0;
    const startedWaitingAt = Date.now();
    const timeWindowMaxAttempts = Math.max(1, Math.ceil(waitPolicy.timeoutMs / Math.max(1, waitPolicy.pollIntervalMs)));
    const retryLimit = typeof step.failurePolicy?.retryCount === "number" ? Math.max(0, Math.floor(step.failurePolicy.retryCount)) + 1 : undefined;
    const maxAttempts = Math.max(2, retryLimit === undefined ? timeWindowMaxAttempts : Math.min(timeWindowMaxAttempts, retryLimit));
    const shouldRetryTransitionObserve = () => {
      if (afterMatch.status === "matched" && afterMatch.node?.id === step.toNode.id) {
        return false;
      }
      if (transitionAttempt >= maxAttempts - 1) {
        return false;
      }
      const withinWaitWindow = Date.now() - startedWaitingAt < waitPolicy.timeoutMs;
      return withinWaitWindow || transitionAttempt === 0;
    };
    while (shouldRetryTransitionObserve()) {
      const actualNodeId = afterMatch.node?.id;
      if (transitionAttempt === 0) {
        base.deviations.push({
          id: this.idFactory("graph_deviation"),
          phase: "state_transition",
          expectedNodeId: step.toNode.id,
          actualNodeId,
          actualStatus: afterMatch.status,
          attempt: transitionAttempt + 1,
          action: "retry_observe",
          message: `Expected next node ${step.toNode.id}, got ${actualNodeId ?? afterMatch.status}; polling transition until the target state appears or the wait window expires.`,
          recordedAt: this.now()
        });
      }
      transitionAttempt += 1;
      await delay(waitPolicy.pollIntervalMs);
      after = await this.options.driver.observe(step, "state_transition");
      afterMatch = await this.options.driver.detectNode(after);
    }
    base.observations.after = after;
    base.nodeMatches.after = afterMatch;
    if (afterMatch.status !== "matched" || afterMatch.node?.id !== step.toNode.id) {
      const actualNodeId = afterMatch.node?.id;
      base.deviations.push({
        id: this.idFactory("graph_deviation"),
        phase: "state_transition",
        expectedNodeId: step.toNode.id,
        actualNodeId,
        actualStatus: afterMatch.status,
        attempt: transitionAttempt + 1,
        action: recoveryActionFor(step.failurePolicy?.recoverTo),
        message: `Expected next node ${step.toNode.id}, got ${actualNodeId ?? afterMatch.status}.`,
        recordedAt: this.now()
      });
      return finish({
        ...base,
        status: "failed",
        phase: "state_transition",
        errorCode: "TO_NODE_NOT_REACHED",
        errorMessage: `Expected next node ${step.toNode.id}, got ${afterMatch.node?.id ?? afterMatch.status}.`
      });
    }

    const expectationResults = await this.evaluateExpectations(step.expectations, step, "expectation", after, afterMatch);
    base.expectationResults = expectationResults;
    const failedExpectation = firstBlockingFailure(expectationResults);
    if (failedExpectation) {
      return finish({
        ...base,
        status: "failed",
        phase: "expectation",
        errorCode: "EXPECTATION_FAILED",
        errorMessage: `${failedExpectation.type}: ${failedExpectation.reason ?? failedExpectation.actual}`
      });
    }

    const systemGuardResults = await this.evaluateExpectations(step.systemGuards, step, "system_guard", after, afterMatch);
    base.systemGuardResults = systemGuardResults;
    const failedSystemGuard = firstBlockingFailure(systemGuardResults);
    if (failedSystemGuard) {
      return finish({
        ...base,
        status: "failed",
        phase: "system_guard",
        errorCode: "SYSTEM_GUARD_FAILED",
        errorMessage: `${failedSystemGuard.type}: ${failedSystemGuard.reason ?? failedSystemGuard.actual}`
      });
    }

    return finish({
      ...base,
      status: "passed"
    });
  }

  private async evaluateExpectations(
    expectations: StepExpectation[],
    step: ExecutionPlanStep,
    phase: GraphExpectationEvaluationInput["phase"],
    observation: Observation,
    nodeMatch?: NodeMatchResult
  ): Promise<StepExpectationResult[]> {
    const enabled = expectations.filter((expectation) => expectation.enabled);
    const results: StepExpectationResult[] = [];
    for (const expectation of enabled) {
      results.push(
        await this.options.driver.evaluateExpectation({
          expectation,
          phase,
          step,
          observation,
          nodeMatch
        })
      );
    }
    return results;
  }

  private buildResult(
    status: GraphExecutionResult["status"],
    startedAt: string,
    startedMs: number,
    steps: GraphStepExecutionResult[],
    failedStep?: GraphStepExecutionResult,
    overrideFailure?: {
      phase: GraphExecutionPhase;
      code: string;
      message: string;
    }
  ): GraphExecutionResult {
    const failure =
      status === "failed" || status === "blocked"
        ? {
            stepId: failedStep?.planStepId,
            edgeId: failedStep?.edgeId,
            phase: overrideFailure?.phase ?? failedStep?.phase ?? "device",
            code: overrideFailure?.code ?? failedStep?.errorCode ?? status.toUpperCase(),
            message: overrideFailure?.message ?? failedStep?.errorMessage ?? `Graph run ${status}.`
          }
        : undefined;
    return {
      id: this.idFactory("graph_run"),
      executionPlanId: this.options.executionPlan.id,
      routePlanId: this.options.executionPlan.routePlanId,
      graphVersionId: this.options.executionPlan.graphVersionId,
      appId: this.options.executionPlan.appId,
      targetNodeId: this.options.executionPlan.targetNodeId,
      status,
      startedAt,
      endedAt: this.now(),
      durationMs: Date.now() - startedMs,
      steps,
      deviations: steps.flatMap((step) => step.deviations),
      failure
    };
  }
}

function transitionWaitPolicyFor(step: ExecutionPlanStep): { timeoutMs: number; pollIntervalMs: number } {
  const params = [step.selectedActionPolicy?.action.params, step.action?.params, ...step.expectations.map((expectation) => expectation.params), ...step.toNode.defaultExpectations.map((expectation) => expectation.params)];
  const timeoutMs = firstPositiveNumber(params, "transitionTimeoutMs") ?? firstPositiveNumber(params, "timeoutMs") ?? 5000;
  const pollIntervalMs = firstPositiveNumber(params, "pollIntervalMs") ?? firstPositiveNumber(params, "intervalMs") ?? 250;
  return {
    timeoutMs: clampNumber(timeoutMs, 50, 60000),
    pollIntervalMs: clampNumber(pollIntervalMs, 10, 5000)
  };
}

function shouldSkipStateTransitionValidation(step: ExecutionPlanStep): boolean {
  return step.selectedActionPolicy?.action.params?.skipStateTransitionValidation === true || step.action?.params?.skipStateTransitionValidation === true;
}

function firstPositiveNumber(records: Array<Record<string, unknown> | undefined>, key: string): number | undefined {
  for (const record of records) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function recoveryActionFor(recoverTo: NonNullable<ExecutionPlanStep["failurePolicy"]>["recoverTo"] | undefined): GraphDeviationRecord["action"] {
  if (recoverTo === "replan") {
    return "replan_required";
  }
  if (recoverTo === "previous_node" || recoverTo === "root") {
    return "recover_required";
  }
  return "fail";
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

function firstBlockingFailure(results: StepExpectationResult[]): StepExpectationResult | undefined {
  return results.find((result) => result.status === "failed" && result.blocking !== false);
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}
