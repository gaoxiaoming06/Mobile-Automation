import {
  compileScriptFlow,
  type CompileScriptFlowOptions,
  type ScriptExecutionPlan,
  type ScriptExecutionPlanStep,
  type ScriptFlowDocument,
  type ScriptParameterValue,
  type ScriptTarget
} from "@mobile-automation/script-flow";
import {
  CROSS_PLATFORM_SCRIPT_SCOPE,
  nowIso,
  type ActionStep,
  type AndroidAppMonitorConfig,
  type FlowStartSetupScope,
  type FlowStartStrategy,
  type InteractionAsset,
  type RunLoopScope,
  type RunMode,
  type ScriptFlowExecutionPurpose,
  type ScriptFlowVerificationAssessment,
  type TestRun,
  type Platform
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver } from "./device-driver.js";
import type { PageAssetCatalog, PageAssetPlatform } from "./page-asset-catalog.js";
import type { PageNavigationEdge, PageNavigationSegmentSnapshot } from "./page-navigation.js";
import type { PageStateService } from "./page-state-service.js";
import type { PageStateExpectationVerifier } from "./step-expectations.js";
import { ScriptTargetResolver } from "./script-target-resolver.js";
import { resolveRuntimeAppIdentifier, type RuntimeAppEnv } from "./target-app-runtime.js";

export type ScriptFlowBackendStartInput = {
  deviceSerial: string;
  caseName?: string;
  steps?: ActionStep[];
  persistedSteps?: ActionStep[];
  mode?: RunMode;
  loopScope?: RunLoopScope;
  repeatCount?: number;
  stepIntervalMs?: number;
  stopOnFailure?: boolean;
  recordVideo?: boolean;
  keepVideoOnSuccess?: boolean;
  pauseAfterEachStep?: boolean;
  startSetupScope?: FlowStartSetupScope;
  startStrategy?: FlowStartStrategy;
  startAppPackageName?: string;
  androidAppMonitor?: AndroidAppMonitorConfig;
  sourceSnapshot?: TestRun["sourceSnapshot"];
};

export interface ScriptFlowRunBackend {
  start(input: ScriptFlowBackendStartInput): TestRun;
}

export type ScriptInteractionAssetBinding = {
  stepId: string;
  asset: InteractionAsset;
};

export type StartScriptFlowRunInput = {
  flowId: string;
  scriptVersion?: number;
  planDigest: string;
  dependencies: NonNullable<TestRun["sourceSnapshot"]>["dependencies"];
  navigationSegments?: PageNavigationSegmentSnapshot[];
  navigationRootPages?: string[];
  interactionAssets?: ScriptInteractionAssetBinding[];
  sourceYaml?: string;
  sourceHash?: string;
  executionPurpose?: ScriptFlowExecutionPurpose;
  verificationAssessment?: ScriptFlowVerificationAssessment;
  flow: ScriptFlowDocument;
  deviceSerial: string;
  parameters?: Record<string, ScriptParameterValue>;
  resolveFlow?: CompileScriptFlowOptions["resolveFlow"];
  mode?: RunMode;
  loopScope?: RunLoopScope;
  repeatCount?: number;
  stepIntervalMs?: number;
  stopOnFailure?: boolean;
  recordVideo?: boolean;
  keepVideoOnSuccess?: boolean;
  pauseAfterEachStep?: boolean;
  stepSelection?: ScriptExecutionStepSelection;
  startStrategy?: FlowStartStrategy;
  androidAppMonitor?: AndroidAppMonitorConfig;
  env?: RuntimeAppEnv;
};

export type ScriptExecutionStepSelection = {
  startStepId: string;
  endStepId?: string;
};

export type ScriptFlowRunnerDeps = {
  backend: ScriptFlowRunBackend;
  driver: Pick<AutomationDeviceDriver, "getDeviceInfo">;
  targetResolver: ScriptTargetResolver;
  pageCatalog?: Pick<PageAssetCatalog, "resolvePage">;
};

export class ScriptFlowRunner {
  constructor(private readonly deps: ScriptFlowRunnerDeps) {}

  validatePlan(
    plan: ScriptExecutionPlan,
    interactionAssets: ScriptInteractionAssetBinding[] = [],
    platform: PageAssetPlatform = CROSS_PLATFORM_SCRIPT_SCOPE
  ): void {
    const assetsByStep = interactionAssetMap(interactionAssets);
    for (const step of plan.steps) {
      this.resolveAction(step, plan.app.id, plan.app.id, platform, plan.parameters, assetsByStep.get(step.id));
    }
  }

  async start(input: StartScriptFlowRunInput): Promise<TestRun> {
    const compiledPlan = compileScriptFlow(input.flow, {
      parameters: input.parameters ?? {},
      resolveFlow: input.resolveFlow
    });
    validateBusinessLoopContract(input, compiledPlan);
    const compiledPersistedPlan = compileScriptFlow(input.flow, {
      parameters: input.parameters ?? {},
      resolveFlow: input.resolveFlow,
      redactSensitiveParameters: true
    });
    const plan = input.stepSelection
      ? selectScriptExecutionSteps(compiledPlan, input.stepSelection)
      : compiledPlan;
    const persistedPlan = input.stepSelection
      ? selectScriptExecutionSteps(compiledPersistedPlan, input.stepSelection)
      : compiledPersistedPlan;
    const device = await this.deps.driver.getDeviceInfo(input.deviceSerial);
    this.validatePlan(plan, input.interactionAssets, device.platform);
    const runtimeAppIdentifier = resolveRuntimeAppIdentifier({
      appId: input.flow.app.id,
      platform: device.platform,
      env: input.env
    });
    const scriptParameters = visibleParameters(input.flow, plan.parameters);
    const stepContext = {
      flowId: input.flowId,
      scriptVersion: input.scriptVersion ?? 1,
      appId: input.flow.app.id,
      runtimeAppIdentifier,
      platform: device.platform,
      scriptParameters,
      resolutionParameters: plan.parameters
    };
    const persistedStepContext = {
      ...stepContext,
      resolutionParameters: persistedPlan.parameters
    };
    const createdAt = nowIso();
    const interactionAssetsByStep = interactionAssetMap(input.interactionAssets ?? []);
    const navigationEdges = this.buildNavigationEdges(input.navigationSegments ?? [], stepContext, createdAt, false);
    const persistedNavigationEdges = this.buildNavigationEdges(input.navigationSegments ?? [], persistedStepContext, createdAt, true);
    const steps = plan.steps.map((step) => this.toActionStep(
      step,
      stepContext,
      createdAt,
      navigationEdges,
      interactionAssetsByStep.get(step.id)
    ));
    const persistedCandidates = persistedPlan.steps.map((step, index) =>
      this.toActionStep(
        step,
        persistedStepContext,
        steps[index]?.createdAt ?? createdAt,
        persistedNavigationEdges,
        interactionAssetsByStep.get(step.id)
      )
    );
    const persistedSteps = maskPlanDifferences(steps, persistedCandidates);
    return this.deps.backend.start({
      deviceSerial: input.deviceSerial,
      caseName: input.flow.name,
      steps,
      persistedSteps,
      mode: input.mode,
      loopScope: input.loopScope,
      repeatCount: input.repeatCount,
      stepIntervalMs: input.stepIntervalMs ?? 0,
      stopOnFailure: input.stopOnFailure,
      recordVideo: input.recordVideo,
      keepVideoOnSuccess: input.keepVideoOnSuccess,
      pauseAfterEachStep: input.pauseAfterEachStep,
      startSetupScope: input.mode === "loop_until_stop" && input.loopScope === "all_steps"
        ? "before_each_iteration"
        : "before_run",
      androidAppMonitor: input.androidAppMonitor,
      startStrategy: input.startStrategy ?? executionStartStrategy(input.flow, plan),
      startAppPackageName: runtimeAppIdentifier,
      sourceSnapshot: {
        kind: "script_flow",
        flowId: input.flowId,
        version: input.scriptVersion ?? 1,
        planDigest: input.planDigest,
        executionPlatform: device.platform,
        executionPurpose: input.executionPurpose ?? "normal",
        ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
        ...(input.verificationAssessment ? { verificationAssessment: input.verificationAssessment } : {}),
        ...(input.interactionAssets?.length ? {
          interactionAssets: input.interactionAssets.map((binding) => ({
            stepId: binding.stepId,
            assetId: binding.asset.id,
            key: binding.asset.key,
            version: binding.asset.version
          }))
        } : {}),
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
      runtimeAppIdentifier: string;
      platform: PageAssetPlatform;
      scriptParameters: Record<string, ScriptParameterValue>;
      resolutionParameters: Record<string, ScriptParameterValue>;
    },
    createdAt: string,
    navigationEdges: PageNavigationEdge[] = [],
    interactionAsset?: InteractionAsset
  ): ActionStep {
    const resolved = this.resolveAction(
      step,
      context.appId,
      context.runtimeAppIdentifier,
      context.platform,
      context.resolutionParameters,
      interactionAsset
    );
    const metadata = {
      scriptFlowId: context.flowId,
      scriptVersion: context.scriptVersion,
      scriptStepId: step.id,
      executionPhase: step.phase,
      sourceFlowName: step.source.flowName,
      ...(step.onPage ? { onPage: step.onPage } : {}),
      ...(step.expectPage ? { expectPage: step.expectPage } : {}),
      ...(resolved.strategy ? { locatorStrategy: resolved.strategy } : {}),
      scriptParameters: context.scriptParameters
    };
    const expectedPage = step.action === "waitForPage" || step.action === "assertPage" || step.action === "reachPage"
      ? stringInput(step.input, "pageId")
      : step.expectPage;
    const timeoutMs = step.timeoutMs ?? 15_000;
    const expectedPageExpectation = expectedPage
      ? this.pageExpectationFor(`after:${step.id}`, expectedPage, context, timeoutMs, createdAt)
      : undefined;
    const expectations = [
      ...(expectedPageExpectation ? [expectedPageExpectation] : []),
      ...(step.action === "assertText" ? [textExpectation(`after:${step.id}`, step.input, timeoutMs, createdAt)] : [])
    ];
    const onPagePrecondition = step.onPage
      ? this.pageExpectationFor(`before:${step.id}`, step.onPage, context, timeoutMs, createdAt)
      : undefined;
    return {
      id: step.id,
      order: step.order,
      type: resolved.type,
      enabled: true,
      title: step.name ?? defaultStepTitle(step),
      params: {
        ...resolved.params,
        ...(step.action === "reachPage" ? {
          navigationEdges
        } : {}),
        ...metadata
      },
      ...(resolved.coordinate ? { coordinate: resolved.coordinate } : {}),
      ...(onPagePrecondition ? { preconditions: [onPagePrecondition] } : {}),
      ...(expectations.length ? { expectations } : {}),
      ...(step.timeoutMs ? { timing: { timeoutMs: step.timeoutMs } } : {}),
      createdAt
    };
  }

  private pageExpectationFor(
    id: string,
    pageId: string,
    context: { appId: string; platform: PageAssetPlatform },
    timeoutMs: number,
    createdAt: string
  ): NonNullable<ActionStep["expectations"]>[number] | undefined {
    if (isRuntimeUnknownPageReference(pageId)) {
      return undefined;
    }
    return pageExpectation(id, pageId, context, timeoutMs, createdAt);
  }

  private resolveAction(
    step: ScriptExecutionPlanStep,
    appId: string,
    runtimeAppIdentifier: string,
    platform: PageAssetPlatform,
    parameters: Record<string, ScriptParameterValue>,
    interactionAsset?: InteractionAsset
  ): {
    type: ActionStep["type"];
    params: Record<string, unknown>;
    coordinate?: ActionStep["coordinate"];
    strategy?: string;
  } {
    if (step.action === "launchApp") {
      return {
        type: "launch_app",
        params: {
          packageName: launchAppIdentifier(step.input, appId, runtimeAppIdentifier),
          restartBeforeLaunch: true
        }
      };
    }
    if (step.action === "swipe") {
      return swipeAction(step.input);
    }
    if (step.action === "reachPage") {
      const pageReference = stringInput(step.input, "pageId");
      const targetPage = this.deps.pageCatalog?.resolvePage(pageReference, appId, platform);
      return {
        type: "reach_page",
        params: {
          pageId: pageReference,
          targetPageId: targetPage?.id ?? pageReference,
          ...(targetPage?.name ? { targetPageName: targetPage.name } : {}),
          appId,
          platform,
          policy: stringInput(step.input, "policy") || "safe"
        },
        strategy: "runtime_page_navigation"
      };
    }
    if (step.action === "waitForPage" || step.action === "assertPage") {
      return { type: "wait", params: { durationMs: 0 }, strategy: "page_state" };
    }
    if (step.action === "assertText") {
      return { type: "wait", params: { durationMs: 0 }, strategy: "ocr_text_assertion" };
    }
    const target = targetInput(step.input);
    if (step.action === "tap") {
      return this.deps.targetResolver.resolve({
        action: "tap",
        target,
        search: searchInput(step.input),
        onPage: step.onPage,
        appId,
        platform,
        parameters,
        interactionAsset
      });
    }
    if (step.action === "inputText") {
      return this.deps.targetResolver.resolve({
        action: "inputText",
        target,
        onPage: step.onPage,
        appId,
        platform,
        parameters,
        value: stringInput(step.input, "value"),
        interactionAsset
      });
    }
    if (step.action === "clearText") {
      return this.deps.targetResolver.resolve({
        action: "clearText",
        target,
        onPage: step.onPage,
        appId,
        platform,
        parameters,
        interactionAsset
      });
    }
    if (step.action === "selectText") {
      return this.deps.targetResolver.resolve({
        action: "selectText",
        target,
        onPage: step.onPage,
        appId,
        platform,
        parameters,
        value: stringInput(step.input, "value"),
        confirmText: optionalStringInput(step.input, "confirmText"),
        interactionAsset
      });
    }
    return this.deps.targetResolver.resolve({
      action: "scrollUntilVisible",
      target,
      onPage: step.onPage,
      appId,
      platform,
      parameters,
      direction: verticalDirectionInput(step.input),
      maxSwipes: numberInput(step.input, "maxSwipes"),
      interactionAsset
    });
  }

  private buildNavigationEdges(
    segments: PageNavigationSegmentSnapshot[],
    context: {
      flowId: string;
      scriptVersion: number;
      appId: string;
      runtimeAppIdentifier: string;
      platform: PageAssetPlatform;
      scriptParameters: Record<string, ScriptParameterValue>;
      resolutionParameters: Record<string, ScriptParameterValue>;
    },
    createdAt: string,
    redactSensitiveParameters: boolean
  ): PageNavigationEdge[] {
    if (!this.deps.pageCatalog) return [];
    const result: PageNavigationEdge[] = [];
    const seen = new Set<string>();
    for (const segment of segments) {
      let plan: ScriptExecutionPlan;
      try {
        if (segment.appId !== context.appId || !navigationSegmentSupportsPlatform(segment.platform, context.platform as Platform)) continue;
        const document: ScriptFlowDocument = {
          version: 1,
          kind: "case",
          name: segment.flowName,
          app: { id: segment.appId },
          start: { strategy: "keepCurrent" },
          parameters: segment.parameters,
          steps: segment.steps,
          tags: []
        };
        const parameters = Object.fromEntries(Object.keys(segment.parameters).flatMap((key) => {
          const value = context.resolutionParameters[key];
          return value === undefined ? [] : [[key, value]];
        }));
        plan = compileScriptFlow(document, { parameters, redactSensitiveParameters });
      } catch {
        continue;
      }
      if (!plan.steps.length) continue;
      const fromPage = this.deps.pageCatalog.resolvePage(segment.fromPage, context.appId, context.platform);
      const toPage = this.deps.pageCatalog.resolvePage(segment.toPage, context.appId, context.platform);
      if (!fromPage || !toPage) continue;
      try {
        const segmentContext = {
          ...context,
          flowId: segment.flowId,
          scriptVersion: segment.flowVersion,
          scriptParameters: visibleParameters({
            version: 1,
            kind: "case",
            name: segment.flowName,
            app: { id: segment.appId },
            parameters: segment.parameters,
            steps: segment.steps,
            tags: []
          }, plan.parameters)
        };
        const actions = plan.steps.map((step) => this.toActionStep(step, segmentContext, createdAt));
        const key = `${fromPage.id}:${toPage.id}:${JSON.stringify(actions.map((action) => [action.type, action.params, action.coordinate]))}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          fromPageId: fromPage.id,
          toPageId: toPage.id,
          flowId: segment.flowId,
          flowName: segment.flowName,
          segmentId: segment.id,
          stepIds: segment.stepIds,
          actions
        });
      } catch {
        continue;
      }
    }
    return result;
  }

}

function validateBusinessLoopContract(input: StartScriptFlowRunInput, plan: ScriptExecutionPlan): void {
  if (input.mode !== "loop_until_stop" || input.loopScope !== "exclude_preparation") return;
  const resetStepCount = plan.steps.filter((step) => step.phase === "reset").length;
  if (resetStepCount > 0 && input.flow.loop?.reset === "none") {
    throw new Error("每轮复位步骤与“无需复位”声明不能同时存在");
  }
  if (resetStepCount === 0 && input.flow.loop?.reset !== "none") {
    throw new Error("循环业务与验证前，请配置每轮复位步骤，或明确声明业务执行后无需复位");
  }
}

export function selectScriptExecutionSteps(
  plan: ScriptExecutionPlan,
  selection: ScriptExecutionStepSelection
): ScriptExecutionPlan {
  const belongsToRootFlow = (step: ScriptExecutionPlanStep, stepId: string) =>
    step.source.flowName === plan.flowName && step.source.stepId === stepId;
  const belongsToExpandedGroup = (step: ScriptExecutionPlanStep, stepId: string) =>
    step.id.startsWith(`${stepId}.`);
  const directStartIndex = plan.steps.findIndex((step) => belongsToRootFlow(step, selection.startStepId));
  const startIndex = directStartIndex >= 0
    ? directStartIndex
    : plan.steps.findIndex((step) => belongsToExpandedGroup(step, selection.startStepId));
  if (startIndex < 0) {
    throw new Error(`Source step not found in execution plan: ${selection.startStepId}`);
  }

  let endIndex = plan.steps.length - 1;
  if (selection.endStepId) {
    const directEndIndex = plan.steps.findIndex(
      (step, index) => index >= startIndex && belongsToRootFlow(step, selection.endStepId!)
    );
    endIndex = directEndIndex >= 0
      ? directEndIndex
      : findLastIndex(plan.steps, (step, index) => (
          index >= startIndex && belongsToExpandedGroup(step, selection.endStepId!)
        ));
    if (endIndex < 0) {
      const earlierEndIndex = plan.steps.findIndex((step) => belongsToRootFlow(step, selection.endStepId!));
      if (earlierEndIndex >= 0 && earlierEndIndex < startIndex) {
        throw new Error(`End source step precedes start source step: ${selection.endStepId}`);
      }
      throw new Error(`Source step not found in execution plan: ${selection.endStepId}`);
    }
  }
  if (endIndex < startIndex) {
    throw new Error(`End source step precedes start source step: ${selection.endStepId}`);
  }

  const steps = plan.steps.slice(startIndex, endIndex + 1).map((step, index) => ({
    ...step,
    order: index + 1
  }));
  if (steps.length === 0) throw new Error("Selected execution step range is empty");
  return {
    ...plan,
    steps
  };
}

function findLastIndex<T>(items: T[], predicate: (item: T, index: number) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!, index)) return index;
  }
  return -1;
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
      observedText: observationTextSummary(result.observation?.ocrTexts.map((item) => item.text) ?? []),
      actualAppId: result.actualAppId,
      reason: result.reason
    };
  };
}

function observationTextSummary(values: string[]): string | undefined {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!unique.length) {
    return undefined;
  }
  return unique.slice(0, 10).join("、").slice(0, 240);
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

function isRuntimeUnknownPageReference(reference: string): boolean {
  return reference.trim().startsWith("runtime.unknown.");
}

function textExpectation(
  id: string,
  input: Record<string, unknown>,
  timeoutMs: number,
  createdAt: string
): NonNullable<ActionStep["expectations"]>[number] {
  return {
    id,
    type: "text",
    enabled: true,
    params: {
      expected: stringInput(input, "text"),
      mode: stringInput(input, "match") === "exact" ? "equals" : "contains",
      source: "ocr",
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

function interactionAssetMap(bindings: ScriptInteractionAssetBinding[]): Map<string, InteractionAsset> {
  const result = new Map<string, InteractionAsset>();
  for (const binding of bindings) {
    if (result.has(binding.stepId)) {
      throw new Error(`Multiple interaction assets are bound to script step ${binding.stepId}`);
    }
    result.set(binding.stepId, binding.asset);
  }
  return result;
}

function searchInput(input: Record<string, unknown>): import("@mobile-automation/script-flow").ScriptSearchPolicy | undefined {
  const search = input.search;
  if (search === undefined) {
    return undefined;
  }
  if (typeof search !== "object" || search === null || Array.isArray(search)) {
    throw new Error("Compiled script search policy is invalid");
  }
  return search as import("@mobile-automation/script-flow").ScriptSearchPolicy;
}

function visibleParameters(
  flow: ScriptFlowDocument,
  parameters: Record<string, ScriptParameterValue>
): Record<string, ScriptParameterValue> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => flow.parameters[key]?.sensitive !== true));
}

function navigationSegmentSupportsPlatform(segmentPlatform: PageNavigationSegmentSnapshot["platform"], devicePlatform: Platform): boolean {
  return segmentPlatform === CROSS_PLATFORM_SCRIPT_SCOPE || segmentPlatform === "flutter" || segmentPlatform === devicePlatform;
}

function startStrategy(flow: ScriptFlowDocument): FlowStartStrategy {
  const strategy = flow.start?.strategy ?? "keepCurrent";
  const values: Record<typeof strategy, FlowStartStrategy> = {
    keepCurrent: "keep_current",
    goHome: "go_home",
    launchApp: "restart_app",
    restartApp: "restart_app",
    clearDataAndLaunch: "clear_data_and_launch"
  };
  return values[strategy];
}

function executionStartStrategy(flow: ScriptFlowDocument, plan: ScriptExecutionPlan): FlowStartStrategy {
  if (flow.start?.strategy === "launchApp" && plan.steps[0]?.action === "launchApp") return "keep_current";
  return startStrategy(flow);
}

function defaultStepTitle(step: ScriptExecutionPlanStep): string {
  if (step.action === "waitForPage") {
    return `等待页面 ${stringInput(step.input, "pageId")}`;
  }
  if (step.action === "assertPage") {
    return `确认页面 ${stringInput(step.input, "pageId")}`;
  }
  if (step.action === "assertText") {
    return `确认出现 ${stringInput(step.input, "text")}`;
  }
  if (step.action === "reachPage") {
    return `到达页面 ${stringInput(step.input, "pageId")}`;
  }
  return step.action;
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function launchAppIdentifier(input: Record<string, unknown>, appId: string, runtimeAppIdentifier: string): string {
  const explicitAppId = stringInput(input, "appId");
  return explicitAppId && explicitAppId !== appId ? explicitAppId : runtimeAppIdentifier;
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
