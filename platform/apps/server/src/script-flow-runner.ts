import {
  compileScriptFlow,
  type CompileScriptFlowOptions,
  type ScriptExecutionPlanStep,
  type ScriptFlowDocument,
  type ScriptParameterValue,
  type ScriptTarget
} from "@mobile-automation/script-flow";
import {
  nowIso,
  type ActionStep,
  type AndroidAppMonitorConfig,
  type FlowStartStrategy,
  type RunMode,
  type TestRun
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver } from "./mobile-driver.js";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import type { PageStateService } from "./page-state-service.js";
import type { PageStateExpectationVerifier } from "./step-expectations.js";
import { ScriptTargetResolver } from "./script-target-resolver.js";

export type ScriptFlowBackendStartInput = {
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
  androidAppMonitor?: AndroidAppMonitorConfig;
  sourceSnapshot?: TestRun["sourceSnapshot"];
};

export interface ScriptFlowRunBackend {
  start(input: ScriptFlowBackendStartInput): TestRun;
}

export type StartScriptFlowRunInput = {
  flowId: string;
  scriptVersion?: number;
  planDigest: string;
  dependencies: NonNullable<TestRun["sourceSnapshot"]>["dependencies"];
  sourceYaml?: string;
  flow: ScriptFlowDocument;
  deviceSerial: string;
  parameters?: Record<string, ScriptParameterValue>;
  confirmedRiskSteps?: string[];
  resolveFlow?: CompileScriptFlowOptions["resolveFlow"];
  mode?: RunMode;
  repeatCount?: number;
  stepIntervalMs?: number;
  stopOnFailure?: boolean;
  recordVideo?: boolean;
  keepVideoOnSuccess?: boolean;
  pauseAfterEachStep?: boolean;
  androidAppMonitor?: AndroidAppMonitorConfig;
};

export type ScriptFlowRunnerDeps = {
  backend: ScriptFlowRunBackend;
  driver: Pick<AutomationDeviceDriver, "getDeviceInfo">;
  targetResolver: ScriptTargetResolver;
};

export class ScriptFlowRunner {
  constructor(private readonly deps: ScriptFlowRunnerDeps) {}

  async start(input: StartScriptFlowRunInput): Promise<TestRun> {
    const device = await this.deps.driver.getDeviceInfo(input.deviceSerial);
    if (!platformCanRun(input.flow.app.platform, device.platform)) {
      throw new Error(`Script platform ${input.flow.app.platform} does not match device platform ${device.platform}`);
    }
    const plan = compileScriptFlow(input.flow, {
      parameters: input.parameters ?? {},
      resolveFlow: input.resolveFlow
    });
    const persistedPlan = compileScriptFlow(input.flow, {
      parameters: input.parameters ?? {},
      resolveFlow: input.resolveFlow,
      redactSensitiveParameters: true
    });
    const requiredRiskSteps = new Set(plan.riskConfirmations.map((confirmation) => confirmation.stepId));
    const unknownConfirmations = (input.confirmedRiskSteps ?? []).filter((stepId) => !requiredRiskSteps.has(stepId));
    if (unknownConfirmations.length) {
      throw new Error(`Unknown risk confirmation step: ${unknownConfirmations.join(", ")}`);
    }
    const missingRisks = plan.riskConfirmations.filter((confirmation) => !(input.confirmedRiskSteps ?? []).includes(confirmation.stepId));
    if (missingRisks.length) {
      throw new Error(`Risk confirmation required: ${missingRisks.map((item) => `${item.stepId} (${item.risk})`).join(", ")}`);
    }
    const scriptParameters = visibleParameters(input.flow, plan.parameters);
    const stepContext = {
      flowId: input.flowId,
      scriptVersion: input.scriptVersion ?? 1,
      appId: input.flow.app.id,
      platform: input.flow.app.platform,
      scriptParameters
    };
    const steps = plan.steps.map((step) => this.toActionStep(step, stepContext, nowIso()));
    const persistedCandidates = persistedPlan.steps.map((step, index) =>
      this.toActionStep(step, stepContext, steps[index]?.createdAt ?? nowIso())
    );
    const persistedSteps = maskPlanDifferences(steps, persistedCandidates);
    return this.deps.backend.start({
      deviceSerial: input.deviceSerial,
      caseName: input.flow.name,
      steps,
      persistedSteps,
      mode: input.mode,
      repeatCount: input.repeatCount,
      stepIntervalMs: input.stepIntervalMs ?? 0,
      stopOnFailure: input.stopOnFailure,
      recordVideo: input.recordVideo,
      keepVideoOnSuccess: input.keepVideoOnSuccess,
      pauseAfterEachStep: input.pauseAfterEachStep,
      androidAppMonitor: input.androidAppMonitor,
      startStrategy: startStrategy(input.flow),
      startAppPackageName: input.flow.app.id,
      sourceSnapshot: {
        kind: "script_flow",
        flowId: input.flowId,
        version: input.scriptVersion ?? 1,
        planDigest: input.planDigest,
        dependencies: input.dependencies,
        ...(input.sourceYaml ? { sourceYaml: input.sourceYaml } : {}),
        parsed: input.flow as unknown as Record<string, unknown>
      }
    });
  }

  private toActionStep(
    step: ScriptExecutionPlanStep,
    context: {
      flowId: string;
      scriptVersion: number;
      appId: string;
      platform: PageAssetPlatform;
      scriptParameters: Record<string, ScriptParameterValue>;
    },
    createdAt: string
  ): ActionStep {
    const resolved = this.resolveAction(step, context.appId, context.platform);
    const metadata = {
      scriptFlowId: context.flowId,
      scriptVersion: context.scriptVersion,
      scriptStepId: step.id,
      sourceFlowName: step.source.flowName,
      ...(step.onPage ? { onPage: step.onPage } : {}),
      ...(step.expectPage ? { expectPage: step.expectPage } : {}),
      ...(resolved.strategy ? { locatorStrategy: resolved.strategy } : {}),
      scriptParameters: context.scriptParameters
    };
    const expectedPage = step.action === "waitForPage" || step.action === "assertPage"
      ? stringInput(step.input, "pageId")
      : step.expectPage;
    const timeoutMs = step.timeoutMs ?? (step.action === "assertPage" ? 1 : 8_000);
    return {
      id: step.id,
      order: step.order,
      type: resolved.type,
      enabled: true,
      title: step.name ?? defaultStepTitle(step),
      params: {
        ...resolved.params,
        ...metadata
      },
      ...(resolved.coordinate ? { coordinate: resolved.coordinate } : {}),
      ...(step.onPage ? { preconditions: [pageExpectation(`before:${step.id}`, step.onPage, context, timeoutMs, createdAt)] } : {}),
      ...(expectedPage ? { expectations: [pageExpectation(`after:${step.id}`, expectedPage, context, timeoutMs, createdAt)] } : {}),
      ...(step.timeoutMs ? { timing: { timeoutMs: step.timeoutMs } } : {}),
      createdAt
    };
  }

  private resolveAction(step: ScriptExecutionPlanStep, appId: string, platform: PageAssetPlatform): {
    type: ActionStep["type"];
    params: Record<string, unknown>;
    coordinate?: ActionStep["coordinate"];
    strategy?: string;
  } {
    if (step.action === "launchApp") {
      return { type: "launch_app", params: { packageName: stringInput(step.input, "appId") || appId } };
    }
    if (step.action === "swipe") {
      return swipeAction(step.input);
    }
    if (step.action === "waitForPage" || step.action === "assertPage") {
      return { type: "wait", params: { durationMs: 0 }, strategy: "page_state" };
    }
    const target = targetInput(step.input);
    if (step.action === "tap") {
      return this.deps.targetResolver.resolve({ action: "tap", target, onPage: step.onPage, appId, platform });
    }
    if (step.action === "inputText") {
      return this.deps.targetResolver.resolve({
        action: "inputText",
        target,
        onPage: step.onPage,
        appId,
        platform,
        value: stringInput(step.input, "value")
      });
    }
    if (step.action === "clearText") {
      return this.deps.targetResolver.resolve({ action: "clearText", target, onPage: step.onPage, appId, platform });
    }
    if (step.action === "selectText") {
      return this.deps.targetResolver.resolve({
        action: "selectText",
        target,
        onPage: step.onPage,
        appId,
        platform,
        value: stringInput(step.input, "value"),
        confirmText: optionalStringInput(step.input, "confirmText")
      });
    }
    return this.deps.targetResolver.resolve({
      action: "scrollUntilVisible",
      target,
      onPage: step.onPage,
      appId,
      platform,
      direction: verticalDirectionInput(step.input),
      maxSwipes: numberInput(step.input, "maxSwipes")
    });
  }
}

function maskPlanDifferences<T>(runtime: T, redacted: T): T {
  if (Object.is(runtime, redacted)) {
    return runtime;
  }
  if (Array.isArray(runtime) && Array.isArray(redacted)) {
    return runtime.map((item, index) => maskPlanDifferences(item, redacted[index])) as T;
  }
  if (runtime && redacted && typeof runtime === "object" && typeof redacted === "object") {
    return Object.fromEntries(Object.entries(runtime).map(([key, value]) => [
      key,
      maskPlanDifferences(value, (redacted as Record<string, unknown>)[key])
    ])) as T;
  }
  return "[REDACTED]" as T;
}

export function pageStateExpectationVerifier(pageState: PageStateService): PageStateExpectationVerifier {
  return async (request) => {
    const result = await pageState.waitForExpectedPage({
      serial: request.serial,
      appId: request.appId,
      platform: request.platform,
      pageId: request.pageId,
      timeoutMs: request.timeoutMs,
      screenshot: request.screenshot
    });
    return {
      status: result.status,
      pageName: result.page?.name,
      candidateNames: result.candidates.map((candidate) => candidate.name),
      actualAppId: result.actualAppId,
      reason: result.reason
    };
  };
}

function pageExpectation(
  id: string,
  pageId: string,
  context: { appId: string; platform: PageAssetPlatform },
  timeoutMs: number,
  createdAt: string
): NonNullable<ActionStep["expectations"]>[number] {
  return {
    id,
    type: "state_is",
    enabled: true,
    params: {
      appId: context.appId,
      platform: context.platform,
      pageId,
      timeoutMs,
      blocking: true
    },
    createdAt
  };
}

function swipeAction(input: Record<string, unknown>): {
  type: "swipe";
  params: Record<string, unknown>;
  coordinate: NonNullable<ActionStep["coordinate"]>;
  strategy: string;
} {
  const direction = directionInput(input, true);
  const distance = Math.max(0.1, Math.min(0.8, numberInput(input, "distance") ?? 0.35));
  const center = 0.5;
  const low = center - distance / 2;
  const high = center + distance / 2;
  const coordinate = direction === "up"
    ? { startXRatio: center, startYRatio: high, endXRatio: center, endYRatio: low }
    : direction === "down"
      ? { startXRatio: center, startYRatio: low, endXRatio: center, endYRatio: high }
      : direction === "left"
        ? { startXRatio: high, startYRatio: center, endXRatio: low, endYRatio: center }
        : { startXRatio: low, startYRatio: center, endXRatio: high, endYRatio: center };
  return { type: "swipe", params: {}, coordinate, strategy: "relative_swipe" };
}

function targetInput(input: Record<string, unknown>): ScriptTarget {
  const target = input.target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    throw new Error("Compiled script target is missing");
  }
  return target as ScriptTarget;
}

function visibleParameters(
  flow: ScriptFlowDocument,
  parameters: Record<string, ScriptParameterValue>
): Record<string, ScriptParameterValue> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => flow.parameters[key]?.sensitive !== true));
}

function platformCanRun(script: ScriptFlowDocument["app"]["platform"], device: "android" | "ios"): boolean {
  return script === device || script === "flutter";
}

function startStrategy(flow: ScriptFlowDocument): FlowStartStrategy {
  const strategy = flow.start?.strategy ?? "keepCurrent";
  const values: Record<typeof strategy, FlowStartStrategy> = {
    keepCurrent: "keep_current",
    goHome: "go_home",
    launchApp: "launch_app",
    restartApp: "restart_app",
    clearDataAndLaunch: "clear_data_and_launch"
  };
  return values[strategy];
}

function defaultStepTitle(step: ScriptExecutionPlanStep): string {
  if (step.action === "waitForPage") {
    return `等待页面 ${stringInput(step.input, "pageId")}`;
  }
  if (step.action === "assertPage") {
    return `确认页面 ${stringInput(step.input, "pageId")}`;
  }
  return step.action;
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function optionalStringInput(input: Record<string, unknown>, key: string): string | undefined {
  return stringInput(input, key) || undefined;
}

function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function directionInput(input: Record<string, unknown>, horizontal = false): "up" | "down" | "left" | "right" {
  const value = input.direction;
  if (value === "down" || (horizontal && (value === "left" || value === "right"))) {
    return value;
  }
  return "up";
}

function verticalDirectionInput(input: Record<string, unknown>): "up" | "down" {
  return input.direction === "down" ? "down" : "up";
}
