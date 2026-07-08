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
  type TestCase,
  type TestRun
} from "@mobile-automation/shared";
import { detectNode, type BusinessGraph, type BusinessGraphVersion, type BusinessNode, type Observation, type OperationEdge, type PlatformScope, type RuntimeOverlay } from "@mobile-automation/graph-core";
import type { AutomationDeviceDriver } from "./mobile-driver.js";
import { createDefaultOcrService, type OcrService } from "./ocr.js";
import { ObservationService } from "./observation-service.js";
import { RunArtifactService, type RunArtifactStorage } from "./run-artifact-service.js";
import { artifactUrl, runArtifactPath } from "./artifacts.js";
import { matchCurrentPage, type PageMatcherBaselineReader } from "./page-matcher.js";
import { withPageAbilityEdges } from "./page-ability-edges.js";

export type AssetPatrolStartMode = "current_state" | "launch_app" | "restart_app";
export type AssetPatrolPageScope = "current_page" | "reachable_pages" | "tagged_pages" | "all_active_pages";
export type AssetPatrolCheckKind =
  | "page_match"
  | "screenshot_region_match"
  | "ocr_region_match"
  | "content_scroll"
  | "element_relocation"
  | "transition_validation"
  | "task_dry_run";
export type AssetPatrolPlanStatus = "ready" | "diagnostic";
export type AssetPatrolStepStatus = "ready" | "skipped" | "needs_repair";
export type AssetPatrolSkipReason =
  | "dangerous_action"
  | "business_submit_disabled"
  | "runtime_relocation_required"
  | "missing_action_policy"
  | "unsupported_scope";

export type AssetPatrolConfigInput = {
  packageName: string;
  graphVersionId?: string;
  startMode?: AssetPatrolStartMode;
  pageScope?: AssetPatrolPageScope;
  maxDurationMs?: number;
  maxTransitions?: number;
  allowRiskyActions?: boolean;
  allowBusinessSubmit?: boolean;
  dangerousTextPatterns?: string[];
  runtimeParams?: Record<string, string>;
};

export type AssetPatrolConfig = Required<Omit<AssetPatrolConfigInput, "dangerousTextPatterns" | "graphVersionId" | "runtimeParams">> & {
  graphVersionId?: string;
  dangerousTextPatterns: string[];
  runtimeParams: Record<string, string>;
};

export type AssetPatrolStartInput = AssetPatrolConfigInput & {
  deviceSerial: string;
};

export type AssetPatrolIssue = {
  code:
    | "GRAPH_VERSION_NOT_FOUND"
    | "CURRENT_PAGE_NOT_MATCHED"
    | "CURRENT_PAGE_NOT_CONFIRMED"
    | "NO_PAGE_ASSETS"
    | "UNSUPPORTED_SCOPE";
  severity: "warning" | "error";
  message: string;
  pageModelId?: string;
};

export type AssetPatrolPlanStep = {
  id: string;
  order: number;
  kind: AssetPatrolCheckKind;
  label: string;
  status: AssetPatrolStepStatus;
  skipReason?: AssetPatrolSkipReason;
  pageModelId?: string;
  pageModelName?: string;
  pageElementId?: string;
  pageTransitionId?: string;
  pageTaskId?: string;
  action?: DeviceActionRequest;
  evidence?: Record<string, unknown>;
};

export type AssetPatrolPlan = {
  status: AssetPatrolPlanStatus;
  graphVersionId?: string;
  startPage?: {
    id: string;
    key: string;
    name: string;
    score: number;
  };
  issues: AssetPatrolIssue[];
  steps: AssetPatrolPlanStep[];
  summary: {
    pageChecks: number;
    elementChecks: number;
    transitionChecks: number;
    taskChecks: number;
    skipped: number;
    needsRepair: number;
  };
};

export type AssetRuntimeParamBinding = "value" | "desired_state";

export type AssetRuntimeParamUsage = {
  pageModelId: string;
  pageModelName: string;
  taskId: string;
  taskName: string;
  stepId?: string;
  stepLabel?: string;
  fieldType?: string;
  binding: AssetRuntimeParamBinding;
};

export type AssetRuntimeParamDefinition = {
  key: string;
  usages: AssetRuntimeParamUsage[];
};

export type AssetDrivenExecutionBlockedCode =
  | "PLAN_NOT_READY"
  | "START_PAGE_NOT_FOUND"
  | "BUSINESS_SUBMIT_DISABLED"
  | "NO_EXECUTABLE_TARGET";

export type AssetDrivenExecutionTarget =
  | {
      status: "ready";
      graphVersionId: string;
      startNodeId: string;
      startNodeName: string;
      targetNodeId: string;
      targetNodeName: string;
      transitionId?: string;
      transitionName?: string;
      pageTaskId?: string;
      overlay: RuntimeOverlay;
    }
  | {
      status: "blocked";
      code: AssetDrivenExecutionBlockedCode;
      message: string;
    };

export type AssetDrivenReadyExecutionTarget = Extract<AssetDrivenExecutionTarget, { status: "ready" }>;

export type AssetDrivenExecutionTargets =
  | {
      status: "ready";
      graphVersionId: string;
      startNodeId: string;
      startNodeName: string;
      targets: AssetDrivenReadyExecutionTarget[];
    }
  | {
      status: "blocked";
      code: AssetDrivenExecutionBlockedCode;
      message: string;
    };

export type AssetPatrolStorage = RunArtifactStorage & {
  createRun(input: { caseId?: string; caseName: string; deviceSerial: string; configJson: string; caseSnapshotJson: string; steps: ActionStep[] }): TestRun;
  updateRunStatus(runId: string, status: TestRun["status"], endedAt?: string): void;
  addStepResult(result: StepResult): void;
  addMetricSample(sample: MetricSample): void;
  addDeviceEvent(event: DeviceEvent): void;
  listRunIdsByStatus(status: TestRun["status"]): string[];
  listBusinessGraphs?(): BusinessGraph[];
  getBusinessGraphVersion?(id: string): BusinessGraphVersion | undefined;
};

type ActiveAssetPatrolRun = {
  promise: Promise<void>;
  controller: AbortController;
  deviceSerial: string;
};

type ManualPageElementAsset = {
  id?: string;
  label?: string;
  name?: string;
  actionName?: string;
  locator?: string;
  locatorKind?: string;
  targetText?: string;
  executeText?: string;
  structuralLocator?: unknown;
  semanticArea?: string;
  actionKind?: string;
  abilityType?: string;
  availability?: string;
  outcomeType?: string;
  visualLocator?: unknown;
  scrollProfile?: Record<string, unknown>;
  platformScope?: PlatformScope;
  assetFormat?: "v2" | "legacy";
};

type PageElementAsset = {
  id: string;
  label?: string;
  targetText?: string;
  locator?: string;
  elementKind?: "button" | "icon_button" | "input" | "checkbox" | "picker" | "collection" | "tab" | "menu_item" | "unknown";
  semanticArea?: string;
  coordinateSpace?: string;
  platformScope?: PlatformScope;
  actions?: string[];
  locatorKind?: string;
  visualLocator?: Record<string, unknown>;
  anchorText?: string;
  role?: string;
  slot?: string;
  orderFromRight?: number;
  dynamicMasks?: Record<string, unknown>[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegionId?: string;
  itemTemplateId?: string;
  collection?: {
    kind?: "vertical_list" | "vertical_grid" | "horizontal_list" | "carousel";
    columns?: number;
    itemIdentity?: Record<string, unknown>;
    candidateItemHeightPercent?: number;
    clickSafePoint?: {
      xPercent: number;
      yPercent: number;
    };
    scrollStepPercent?: number;
    failureStrategy?: "none" | "try_next_candidate" | "back_and_try_next_candidate";
  };
};

type ManualPageTaskAsset = {
  id?: string;
  name?: string;
  title?: string;
  status?: string;
  steps?: unknown[];
};

const defaultDangerousTextPatterns = ["删除", "退出登录", "注销", "支付", "发布", "提交", "确认", "解绑", "清空", "购买"];

type AssetDrivenTransitionCandidate = {
  edge: OperationEdge;
  pageTaskId: string | undefined;
};

export class AssetPatrolDeviceBusyError extends Error {
  constructor(
    readonly deviceSerial: string,
    readonly activeRunId: string
  ) {
    super(`Device ${deviceSerial} is already running asset patrol ${activeRunId}`);
    this.name = "AssetPatrolDeviceBusyError";
  }
}

export class AssetPatrol {
  private readonly activeRuns = new Map<string, ActiveAssetPatrolRun>();
  private readonly observationService: ObservationService;
  private readonly artifactService: RunArtifactService;

  constructor(
    private readonly storage: AssetPatrolStorage,
    private readonly driver: AutomationDeviceDriver,
    ocr: OcrService = createDefaultOcrService(),
    private readonly baselineReader?: PageMatcherBaselineReader
  ) {
    this.observationService = new ObservationService(driver, ocr);
    this.artifactService = new RunArtifactService(storage, driver);
  }

  async preview(input: AssetPatrolStartInput): Promise<AssetPatrolPlan> {
    const config = normalizeAssetPatrolConfig(input);
    const graphVersion = this.findActiveGraphVersion(config.packageName, config.graphVersionId);
    if (!graphVersion) {
      return diagnosticPlan("GRAPH_VERSION_NOT_FOUND", "没有找到当前包名对应的 active PageStateFlow 版本。");
    }
    const observation = await this.collectObservation(input.deviceSerial);
    return this.buildPlan(observation, graphVersion, config);
  }

  start(input: AssetPatrolStartInput): TestRun {
    const config = normalizeAssetPatrolConfig(input);
    const existing = this.getActiveRunForDevice(input.deviceSerial) ?? this.getStoredActiveRunForDevice(input.deviceSerial);
    if (existing) {
      throw new AssetPatrolDeviceBusyError(input.deviceSerial, existing.runId);
    }

    const runConfig: RunConfig = {
      deviceSerial: input.deviceSerial,
      runKind: "asset_patrol",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 150,
      stopOnFailure: false,
      recordVideo: false,
      keepVideoOnSuccess: false,
      startStrategy: assetPatrolStartStrategy(config.startMode),
      startAppPackageName: config.packageName,
      assetPatrol: config
    };
    const steps = buildPlaceholderSteps(config.maxTransitions + 24);
    const testCase: TestCase = {
      id: createId("asset_patrol_case"),
      name: `资产驱动巡检：${config.packageName}`,
      platformScope: "android",
      targetApp: { androidPackageName: config.packageName },
      tags: ["asset-patrol", "page-state-flow"],
      version: 1,
      steps,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const run = this.storage.createRun({
      caseName: testCase.name,
      deviceSerial: input.deviceSerial,
      configJson: JSON.stringify(runConfig),
      caseSnapshotJson: JSON.stringify(testCase),
      steps
    });
    const controller = new AbortController();
    const promise = this.execute(run.id, input.deviceSerial, config, controller).finally(() => {
      this.activeRuns.delete(run.id);
    });
    this.activeRuns.set(run.id, { promise, controller, deviceSerial: input.deviceSerial });
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

  private async execute(runId: string, deviceSerial: string, config: AssetPatrolConfig, controller: AbortController): Promise<void> {
    let failed = false;
    let stopped = false;
    let stopReason = "completed";
    try {
      await this.prepareStart(deviceSerial, config, controller);
      this.addEvent(runId, deviceSerial, "asset_patrol", "info", "资产驱动巡检已启动", `package=${config.packageName}; scope=${config.pageScope}`);
      const graphVersion = this.findActiveGraphVersion(config.packageName, config.graphVersionId);
      if (!graphVersion) {
        const plan = diagnosticPlan("GRAPH_VERSION_NOT_FOUND", "没有找到当前包名对应的 active PageStateFlow 版本。");
        this.addDiagnosticResult(runId, plan, "GRAPH_VERSION_NOT_FOUND");
        failed = true;
        stopReason = "graph_not_found";
        return;
      }
      const observation = await this.collectObservation(deviceSerial);
      const plan = await this.buildPlan(observation, graphVersion, config);
      if (plan.status === "diagnostic") {
        this.addDiagnosticResult(runId, plan, plan.issues[0]?.code ?? "CURRENT_PAGE_NOT_MATCHED");
        failed = true;
        stopReason = "diagnostic";
        return;
      }
      let order = 0;
      for (const step of plan.steps) {
        throwIfAborted(controller.signal);
        order += 1;
        const stepResultId = createId("step_result");
        const startedAt = nowIso();
        const startedMs = Date.now();
        const status = step.status === "needs_repair" ? "failed" : step.status === "skipped" ? "skipped" : "passed";
        if (status === "failed") {
          failed = true;
        }
        this.storage.addStepResult(this.stepResult({
          id: stepResultId,
          runId,
          order,
          type: "wait",
          status,
          startedAt,
          startedMs,
          metadata: {
            assetPatrol: stepMetadata(config, plan, step, status)
          },
          errorMessage: status === "failed" ? failureMessageForStep(step) : undefined
        }));
        await this.collectMetric(runId, deviceSerial, stepResultId);
      }
    } catch (error) {
      stopped = controller.signal.aborted && !failed;
      if (!stopped) {
        failed = true;
        stopReason = "runner_error";
        this.addEvent(runId, deviceSerial, "runner_error", "error", "资产驱动巡检失败", errorToString(error));
      }
    } finally {
      if (controller.signal.aborted && !failed) {
        stopped = true;
        stopReason = "manual_stop";
      }
      await this.writeSummaryArtifact(runId, config, stopReason);
      this.storage.updateRunStatus(runId, stopped ? "stopped" : failed ? "failed" : "passed");
      await this.artifactService.generateReport(runId);
    }
  }

  private async prepareStart(deviceSerial: string, config: AssetPatrolConfig, controller: AbortController): Promise<void> {
    const actions = assetPatrolStartActions(config);
    for (const action of actions) {
      await this.driver.performAction(deviceSerial, action);
      if (action.type === "close_app") {
        await sleep(300);
      }
      throwIfAborted(controller.signal);
    }
    if (actions.some((action) => action.type === "launch_app")) {
      await sleep(800);
      throwIfAborted(controller.signal);
    }
  }

  private async buildPlan(observation: Observation, graphVersion: BusinessGraphVersion, config: AssetPatrolConfig): Promise<AssetPatrolPlan> {
    const pageMatch = await matchCurrentPage({
      graphVersion,
      observation,
      baselineReader: this.baselineReader
    });
    const matchedPage = patrolPageFromMatch(pageMatch.match);
    return buildAssetPatrolPlan({
      observation: pageMatch.observation,
      graphVersion,
      config,
      matchedPage
    });
  }

  private async collectObservation(deviceSerial: string): Promise<Observation> {
    return this.observationService.collect(deviceSerial, {
      includeScreenshot: true,
      includeOcr: true,
      includeUiTree: true,
      recentEvents: []
    });
  }

  private findActiveGraphVersion(packageName: string, graphVersionId?: string): BusinessGraphVersion | undefined {
    if (graphVersionId) {
      return this.storage.getBusinessGraphVersion?.(graphVersionId);
    }
    const graphs = this.storage.listBusinessGraphs?.() ?? [];
    const graph = graphs.find((item) => item.status === "active" && item.targetApp?.androidPackageName === packageName && item.activeVersionId)
      ?? graphs.find((item) => item.status === "active" && item.appId === packageName && item.activeVersionId);
    return graph?.activeVersionId ? this.storage.getBusinessGraphVersion?.(graph.activeVersionId) : undefined;
  }

  private addDiagnosticResult(runId: string, plan: AssetPatrolPlan, errorCode: string): void {
    const startedMs = Date.now();
    this.storage.addStepResult(this.stepResult({
      runId,
      order: 1,
      type: "wait",
      status: "failed",
      startedAt: nowIso(),
      startedMs,
      metadata: {
        assetPatrol: {
          kind: "page_match",
          executionMode: "diagnostic",
          planStatus: plan.status,
          issues: plan.issues,
          summary: plan.summary
        }
      },
      errorMessage: plan.issues[0]?.message ?? errorCode
    }));
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
    order: number;
    type: ActionStep["type"];
    status: StepResult["status"];
    startedAt: string;
    startedMs: number;
    metadata?: Record<string, unknown>;
    artifacts?: ArtifactRef[];
    errorMessage?: string;
  }): StepResult {
    return {
      id: input.id ?? createId("step_result"),
      runId: input.runId,
      iterationIndex: 0,
      stepId: `asset_patrol_step_${input.order}`,
      stepOrder: input.order,
      type: input.type,
      status: input.status,
      startedAt: input.startedAt,
      endedAt: nowIso(),
      durationMs: Math.max(0, Date.now() - input.startedMs),
      artifacts: input.artifacts ?? [],
      metadata: input.metadata,
      errorCode: input.status === "failed" ? "ASSET_PATROL_FAILED" : undefined,
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

  private async writeSummaryArtifact(runId: string, config: AssetPatrolConfig, stopReason: string): Promise<void> {
    const run = this.storage.getRun(runId);
    if (!run) {
      return;
    }
    const patrolSteps = run.stepResults
      .map((step) => step.metadata?.assetPatrol)
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item));
    const summary = {
      runId,
      packageName: config.packageName,
      startMode: config.startMode,
      pageScope: config.pageScope,
      stopReason,
      steps: run.stepResults.length,
      failed: run.stepResults.filter((step) => step.status === "failed").length,
      skipped: run.stepResults.filter((step) => step.status === "skipped").length,
      needsRepair: patrolSteps.filter((step) => step.status === "needs_repair" || step.skipReason === "runtime_relocation_required").length,
      events: run.events.map((event) => ({ type: event.type, severity: event.severity, summary: event.summary, occurredAt: event.occurredAt }))
    };
    const relativePath = runArtifactPath(runId, "logs", "asset-patrol-summary.json");
    const written = await this.storage.writeArtifact(relativePath, JSON.stringify(summary, null, 2));
    this.storage.addArtifact({
      id: createId("artifact"),
      runId,
      type: "report_json",
      name: "asset-patrol-summary.json",
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

export function normalizeAssetPatrolConfig(input: AssetPatrolConfigInput): AssetPatrolConfig {
  const packageName = input.packageName.trim();
  if (!packageName) {
    throw new Error("packageName is required");
  }
  return {
    packageName,
    graphVersionId: input.graphVersionId?.trim() || undefined,
    startMode: normalizeStartMode(input.startMode),
    pageScope: normalizePageScope(input.pageScope),
    maxDurationMs: clampInteger(input.maxDurationMs, 120_000, 10_000, 30 * 60_000),
    maxTransitions: clampInteger(input.maxTransitions, 8, 0, 200),
    allowRiskyActions: input.allowRiskyActions ?? false,
    allowBusinessSubmit: input.allowBusinessSubmit ?? false,
    dangerousTextPatterns: uniqueStrings([...(input.dangerousTextPatterns ?? []), ...defaultDangerousTextPatterns].map((item) => item.trim()).filter(Boolean)),
    runtimeParams: normalizeRuntimeParams(input.runtimeParams)
  };
}

export function assetPatrolStartActions(config: AssetPatrolConfig): DeviceActionRequest[] {
  if (config.startMode === "current_state") {
    return [];
  }
  if (config.startMode === "launch_app") {
    return [{ type: "launch_app", packageName: config.packageName }];
  }
  return [
    { type: "close_app", packageName: config.packageName },
    { type: "launch_app", packageName: config.packageName }
  ];
}

export function buildAssetPatrolPlan(input: {
  observation: Observation;
  graphVersion: BusinessGraphVersion;
  config: AssetPatrolConfig;
  matchedPage?: { node: BusinessNode; score: number };
}): AssetPatrolPlan {
  const matched = input.matchedPage ?? detectPatrolPage(input.observation, input.graphVersion);
  if (!matched) {
    return diagnosticPlan("CURRENT_PAGE_NOT_MATCHED", "当前页面没有匹配到已确认页面资产。", input.graphVersion.id);
  }
  if (!isConfirmedStablePage(matched.node)) {
    return diagnosticPlan("CURRENT_PAGE_NOT_CONFIRMED", unconfirmedPageMessage(matched.node, input.config), input.graphVersion.id, matched.node.id);
  }
  if (input.config.pageScope !== "current_page") {
    return diagnosticPlan("UNSUPPORTED_SCOPE", "第一版资产驱动巡检先支持当前页面范围；跨页面轮巡后续接入。", input.graphVersion.id, matched.node.id);
  }
  const steps: AssetPatrolPlanStep[] = [];
  const startPage = {
    id: matched.node.id,
    key: matched.node.key,
    name: matched.node.name,
    score: matched.score
  };
  steps.push({
    id: createId("asset_patrol_plan_step"),
    order: steps.length + 1,
    kind: "page_match",
    label: `页面匹配：${matched.node.name}`,
    status: "ready",
    pageModelId: matched.node.id,
    pageModelName: matched.node.name,
    evidence: {
      score: matched.score,
      observedTexts: input.observation.ocrTexts.slice(0, 12).map((item) => item.text),
      matcherCount: matched.node.matchers.length
    }
  });

  const platform = platformFromObservation(input.observation);
  const graphVersionWithAssetEdges = withPageAbilityEdges(input.graphVersion, platform);
  const elements = readPatrolPageElements(matched.node, platform);
  const transitions = graphVersionWithAssetEdges.edges
    .filter((edge) => edge.status === "active" && edge.fromNodeId === matched.node.id && Boolean(edge.actionPolicies[0]))
    .sort((left, right) => Number(isV2PageTransitionEdge(right)) - Number(isV2PageTransitionEdge(left)))
    .slice(0, input.config.maxTransitions);
  const tasks = readManualPageTasks(matched.node);
  const issues: AssetPatrolIssue[] = [];
  if (!elements.length && !transitions.length && !tasks.length) {
    issues.push({
      code: "NO_PAGE_ASSETS",
      severity: "warning",
      message: `页面 ${matched.node.name} 没有录入可巡检的页面资产。`,
      pageModelId: matched.node.id
    });
  }
  for (const element of elements) {
    const label = elementLabel(element);
    const parameterizedBy = gridCandidateResolvedByClassName(element as Record<string, unknown>, input.config.runtimeParams) ? "className" : undefined;
    const needsRepair = isRegionOnlyElement(element, input.observation, input.config.runtimeParams);
    steps.push({
      id: createId("asset_patrol_plan_step"),
      order: steps.length + 1,
      kind: "element_relocation",
      label: `元素可重定位：${label}`,
      status: needsRepair ? "needs_repair" : "ready",
      skipReason: needsRepair ? "runtime_relocation_required" : undefined,
      pageModelId: matched.node.id,
      pageModelName: matched.node.name,
      pageElementId: element.id,
      evidence: {
        locator: element.locator,
        locatorKind: element.locatorKind,
        targetText: elementSemanticText(element, input.observation) ?? element.targetText ?? element.executeText,
        semanticArea: element.semanticArea,
        actionKind: element.actionKind,
        abilityType: element.abilityType,
        assetFormat: element.assetFormat ?? "legacy",
        parameterizedBy
      }
    });
  }

  for (const transition of transitions) {
    const actionPolicy = transition.actionPolicies[0];
    const dangerous = !input.config.allowRiskyActions && isDangerousTransition(transition, input.config.dangerousTextPatterns);
    const repairReason = actionPolicy ? imageRegionActionRepairReason(actionPolicy.action, input.observation, input.config.runtimeParams) : "missing_action_policy";
    const parameterizedBy = actionPolicy && gridCandidateResolvedByClassName(actionPolicy.action.params ?? {}, input.config.runtimeParams) ? "className" : undefined;
    steps.push({
      id: createId("asset_patrol_plan_step"),
      order: steps.length + 1,
      kind: "transition_validation",
      label: `边巡检：${transition.name}`,
      status: dangerous ? "skipped" : repairReason ? "needs_repair" : "ready",
      skipReason: dangerous ? "dangerous_action" : repairReason,
      pageModelId: matched.node.id,
      pageModelName: matched.node.name,
      pageTransitionId: transition.id,
      evidence: {
        edgeKey: transition.key,
        intent: transition.intent,
        toNodeId: transition.toNodeId,
        actionTitle: actionPolicy?.action.title,
        targetText: actionPolicy ? stringRecordField(actionPolicy.action.params ?? {}, "targetText") ?? stringRecordField(actionPolicy.action.params ?? {}, "anchorText") : undefined,
        visualLocator: actionPolicy ? hasVisualLocator((actionPolicy.action.params ?? {}).visualLocator) : undefined,
        assetFormat: isV2PageTransitionEdge(transition) ? "v2" : "legacy",
        reliabilityScore: transition.reliabilityScore,
        executionMode: "dry_run",
        parameterizedBy
      }
    });
  }

  for (const task of tasks) {
    const label = task.name ?? task.title ?? task.id ?? "未命名任务";
    steps.push({
      id: createId("asset_patrol_plan_step"),
      order: steps.length + 1,
      kind: "task_dry_run",
      label: `任务编排体检：${label}`,
      status: input.config.allowBusinessSubmit ? "ready" : "skipped",
      skipReason: input.config.allowBusinessSubmit ? undefined : "business_submit_disabled",
      pageModelId: matched.node.id,
      pageModelName: matched.node.name,
      pageTaskId: task.id,
      evidence: {
        stepCount: task.steps?.length ?? 0,
        executionMode: "dry_run"
      }
    });
  }

  return {
    status: "ready",
    graphVersionId: input.graphVersion.id,
    startPage,
    issues,
    steps,
    summary: summarizePlanSteps(steps)
  };
}

export function selectAssetDrivenExecutionTarget(input: {
  plan: AssetPatrolPlan;
  graphVersion: BusinessGraphVersion;
  config: AssetPatrolConfig;
}): AssetDrivenExecutionTarget {
  const targets = selectAssetDrivenExecutionTargets(input);
  if (targets.status === "blocked") {
    return targets;
  }
  return targets.targets[0] ?? {
    status: "blocked",
    code: "NO_EXECUTABLE_TARGET",
    message: "当前页面没有可真实执行的 ready 连接边或页面任务，请先补充页面能力/连接边资产。"
  };
}

export function selectAssetDrivenExecutionTargets(input: {
  plan: AssetPatrolPlan;
  graphVersion: BusinessGraphVersion;
  config: AssetPatrolConfig;
}): AssetDrivenExecutionTargets {
  if (input.plan.status !== "ready") {
    return {
      status: "blocked",
      code: "PLAN_NOT_READY",
      message: input.plan.issues[0]?.message ?? "当前资产体检计划还不可用于真实执行。"
    };
  }
  const startPage = input.plan.startPage;
  if (!startPage) {
    return {
      status: "blocked",
      code: "START_PAGE_NOT_FOUND",
      message: "没有识别到当前起点页面，无法开始资产驱动测试。"
    };
  }
  const targets: AssetDrivenReadyExecutionTarget[] = [];
  const graphVersionWithV2Edges = withPageAbilityEdges(input.graphVersion, "android");
  const transitionCandidates = input.plan.steps
    .filter((step) => step.kind === "transition_validation" && step.status === "ready" && Boolean(step.pageTransitionId))
    .map((step) => {
      const edge = graphVersionWithV2Edges.edges.find((item) => item.id === step.pageTransitionId && item.status === "active");
      const action = edge?.actionPolicies[0]?.action;
      return edge && action && edge.fromNodeId === startPage.id
        ? {
            edge,
            pageTaskId: sourcePageNavigationTaskId(action)
          }
        : undefined;
    })
    .filter((item): item is AssetDrivenTransitionCandidate => Boolean(item))
    .sort((left, right) => Number(Boolean(right.pageTaskId)) - Number(Boolean(left.pageTaskId)));
  for (const candidate of transitionCandidates) {
    const edge = candidate.edge;
    const pageTaskId = candidate.pageTaskId;
    if (pageTaskId && !input.config.allowBusinessSubmit) {
      return {
        status: "blocked",
        code: "BUSINESS_SUBMIT_DISABLED",
        message: "这条资产边会执行页面任务，请先勾选“允许业务提交”后再开始资产测试。"
      };
    }
    const targetNode = graphVersionWithV2Edges.nodes.find((node) => node.id === edge.toNodeId);
    targets.push({
      status: "ready",
      graphVersionId: input.graphVersion.id,
      startNodeId: startPage.id,
      startNodeName: startPage.name,
      targetNodeId: edge.toNodeId,
      targetNodeName: targetNode?.name ?? edge.toNodeId,
      transitionId: edge.id,
      transitionName: edge.name,
      pageTaskId,
      overlay: {
        id: `asset-driven-${edge.id}`,
        targetNodeId: edge.toNodeId,
        ...(input.config.runtimeParams && Object.keys(input.config.runtimeParams).length ? { runtimeParams: input.config.runtimeParams } : {}),
        note: `资产驱动测试：${startPage.name} -> ${targetNode?.name ?? edge.toNodeId}`
      }
    });
  }
  for (const step of input.plan.steps) {
    if (step.kind !== "task_dry_run" || step.status !== "ready" || !step.pageTaskId) {
      continue;
    }
    if (!input.config.allowBusinessSubmit) {
      return {
        status: "blocked",
        code: "BUSINESS_SUBMIT_DISABLED",
        message: "当前页面任务需要执行业务提交，请先勾选“允许业务提交”后再开始资产测试。"
      };
    }
    targets.push({
      status: "ready",
      graphVersionId: input.graphVersion.id,
      startNodeId: startPage.id,
      startNodeName: startPage.name,
      targetNodeId: startPage.id,
      targetNodeName: startPage.name,
      pageTaskId: step.pageTaskId,
      overlay: {
        id: `asset-driven-task-${step.pageTaskId}`,
        targetNodeId: startPage.id,
        targetTaskId: step.pageTaskId,
        ...(input.config.runtimeParams && Object.keys(input.config.runtimeParams).length ? { runtimeParams: input.config.runtimeParams } : {}),
        note: `资产驱动测试：${startPage.name} / ${step.label}`
      }
    });
  }
  if (targets.length) {
    return {
      status: "ready",
      graphVersionId: input.graphVersion.id,
      startNodeId: startPage.id,
      startNodeName: startPage.name,
      targets
    };
  }
  if (input.plan.steps.some((step) => step.kind === "task_dry_run" && step.skipReason === "business_submit_disabled")) {
    return {
      status: "blocked",
      code: "BUSINESS_SUBMIT_DISABLED",
      message: "当前页面任务需要执行业务提交，请先勾选“允许业务提交”后再开始资产测试。"
    };
  }
  return {
    status: "blocked",
    code: "NO_EXECUTABLE_TARGET",
    message: "当前页面没有可真实执行的 ready 连接边或页面任务，请先补充页面能力/连接边资产。"
  };
}

export function selectAssetDrivenRecoveryTarget(input: {
  graphVersion: BusinessGraphVersion;
  currentNodeId: string;
  startNodeId: string;
  runtimeParams?: Record<string, string>;
}): AssetDrivenReadyExecutionTarget | undefined {
  if (input.currentNodeId === input.startNodeId) {
    return undefined;
  }
  const currentNode = input.graphVersion.nodes.find((node) => node.id === input.currentNodeId);
  const startNode = input.graphVersion.nodes.find((node) => node.id === input.startNodeId);
  if (!currentNode || !startNode) {
    return undefined;
  }
  const edge = input.graphVersion.edges
    .filter((item) => item.status === "active" && item.fromNodeId === currentNode.id && item.toNodeId === startNode.id && Boolean(item.actionPolicies[0]))
    .sort((left, right) => (right.reliabilityScore ?? 0) - (left.reliabilityScore ?? 0))[0];
  if (!edge) {
    return undefined;
  }
  const runtimeParams = input.runtimeParams ?? {};
  return {
    status: "ready",
    graphVersionId: input.graphVersion.id,
    startNodeId: currentNode.id,
    startNodeName: currentNode.name,
    targetNodeId: startNode.id,
    targetNodeName: startNode.name,
    transitionId: edge.id,
    transitionName: edge.name,
    overlay: {
      id: `asset-driven-recovery-${edge.id}`,
      targetNodeId: startNode.id,
      ...(Object.keys(runtimeParams).length ? { runtimeParams } : {}),
      note: `资产驱动恢复：${currentNode.name} -> ${startNode.name}`
    }
  };
}

export function shouldAvoidBackRecovery(input: {
  graphVersion: BusinessGraphVersion;
  currentNodeId: string;
  startNodeId: string;
}): boolean {
  if (input.currentNodeId === input.startNodeId) {
    return false;
  }
  const currentNode = input.graphVersion.nodes.find((node) => node.id === input.currentNodeId);
  const startNode = input.graphVersion.nodes.find((node) => node.id === input.startNodeId);
  if (!currentNode || !startNode) {
    return false;
  }
  return isBottomTabPageNode(currentNode) && isBottomTabPageNode(startNode);
}

export function collectAssetRuntimeParamDefinitions(graphVersion: BusinessGraphVersion): AssetRuntimeParamDefinition[] {
  const definitions = new Map<string, AssetRuntimeParamDefinition>();
  for (const node of graphVersion.nodes) {
    if (!isConfirmedStablePage(node)) {
      continue;
    }
    for (const task of readManualPageTasks(node)) {
      if (task.status === "deprecated") {
        continue;
      }
      const taskId = task.id?.trim();
      const taskName = task.name ?? task.title ?? taskId;
      if (!taskId || !taskName) {
        continue;
      }
      for (const rawStep of task.steps ?? []) {
        if (!isRecordObject(rawStep)) {
          continue;
        }
        addRuntimeParamDefinition(definitions, rawStep.valueParamKey, {
          pageModelId: node.id,
          pageModelName: node.name,
          taskId,
          taskName,
          stepId: stringRecordField(rawStep, "id"),
          stepLabel: stringRecordField(rawStep, "label"),
          fieldType: stringRecordField(rawStep, "fieldType"),
          binding: "value"
        });
        addRuntimeParamDefinition(definitions, rawStep.desiredStateParamKey, {
          pageModelId: node.id,
          pageModelName: node.name,
          taskId,
          taskName,
          stepId: stringRecordField(rawStep, "id"),
          stepLabel: stringRecordField(rawStep, "label"),
          fieldType: stringRecordField(rawStep, "fieldType"),
          binding: "desired_state"
        });
      }
    }
  }
  const graphVersionWithAssetEdges = withPageAbilityEdges(graphVersion, "android");
  for (const edge of graphVersionWithAssetEdges.edges) {
    if (edge.status !== "active") {
      continue;
    }
    const sourceNode = graphVersionWithAssetEdges.nodes.find((node) => node.id === edge.fromNodeId);
    if (!sourceNode || !isConfirmedStablePage(sourceNode)) {
      continue;
    }
    for (const policy of edge.actionPolicies) {
      const params = policy.action.params ?? {};
      if (!gridCandidateAcceptsClassNameParam(params)) {
        continue;
      }
      addRuntimeParamDefinition(definitions, "className", {
        pageModelId: sourceNode.id,
        pageModelName: sourceNode.name,
        taskId: edge.id,
        taskName: edge.name,
        stepId: policy.action.id,
        stepLabel: policy.action.title,
        fieldType: "grid_candidate",
        binding: "value"
      });
    }
  }
  return Array.from(definitions.values());
}

function gridCandidateAcceptsClassNameParam(params: Record<string, unknown>): boolean {
  if (params.abilityType !== "grid_candidate" || !isRecordObject(params.scrollProfile)) {
    return false;
  }
  const targetQuery = stringRecordField(params.scrollProfile, "targetQuery");
  const targetKind = stringRecordField(params.scrollProfile, "targetKind");
  return !targetQuery || targetKind === "nth_item" || targetQuery.includes("{{className}}");
}

function gridCandidateResolvedByClassName(params: Record<string, unknown>, runtimeParams: Record<string, string>): boolean {
  return Boolean(runtimeParams.className?.trim() && gridCandidateAcceptsClassNameParam(params));
}

function detectPatrolPage(observation: Observation, graphVersion: BusinessGraphVersion): { node: BusinessNode; score: number } | undefined {
  const result = detectNode(observation, graphVersion, observation.platform);
  return patrolPageFromMatch(result);
}

function patrolPageFromMatch(result: ReturnType<typeof detectNode>): { node: BusinessNode; score: number } | undefined {
  if (result.status === "matched" && result.node) {
    return { node: result.node, score: result.score };
  }
  const fallback = result.candidates.find((candidate) => isConfirmedStablePage(candidate.node) && candidate.score >= result.threshold);
  return fallback ? { node: fallback.node, score: fallback.score } : undefined;
}

function diagnosticPlan(code: AssetPatrolIssue["code"], message: string, graphVersionId?: string, pageModelId?: string): AssetPatrolPlan {
  return {
    status: "diagnostic",
    graphVersionId,
    issues: [{ code, severity: "error", message, pageModelId }],
    steps: [],
    summary: emptySummary()
  };
}

function unconfirmedPageMessage(node: BusinessNode, config: AssetPatrolConfig): string {
  if (isStartupPlaceholderNode(node)) {
    const previewHint = config.startMode === "current_state"
      ? "请先把目标 App 打开到登录页或主页后再预览，或把起始方式切到启动/重启后点击“开始资产测试”。"
      : "预览计划不会执行启动或重启；真实执行会先按起始方式启动 App 后再匹配。请先把 App 打开到登录页或主页后预览，或直接点击“开始资产测试”。";
    return `当前匹配到 ${node.name}，它是目标 App 启动前的临时态，不是页面资产。${previewHint}`;
  }
  return `当前匹配页面 ${node.name} 还不是已确认页面资产。`;
}

function isStartupPlaceholderNode(node: BusinessNode): boolean {
  return node.tags.includes("root") || node.key.includes("app.root") || node.name.includes("启动前");
}

function isBottomTabPageNode(node: BusinessNode): boolean {
  const bottomTabNames = new Set(["主页", "首页", "消息", "待办", "课程表", "空间", "成长"]);
  if (bottomTabNames.has(node.name)) {
    return true;
  }
  const intentTags = node.metadata?.intentTags;
  if (Array.isArray(intentTags) && intentTags.some((tag) => typeof tag === "string" && tag === "bottom-tab")) {
    return true;
  }
  const screenshotRegions = node.metadata?.screenshotRegions;
  if (
    Array.isArray(screenshotRegions) &&
    screenshotRegions.some((region) => isBottomTabAssetRecord(region))
  ) {
    return true;
  }
  return readManualPageElements(node).some((element) => {
    const label = [element.label, element.targetText, element.name, element.actionName].filter(Boolean).join(" ");
    return element.semanticArea === "bottom" && Array.from(bottomTabNames).some((name) => label.includes(name));
  });
}

function isBottomTabAssetRecord(value: unknown): boolean {
  if (!isRecordObject(value)) {
    return false;
  }
  const semanticArea = typeof value.semanticArea === "string" ? value.semanticArea : "";
  const label = [value.id, value.label].filter((item): item is string => typeof item === "string").join(" ");
  return semanticArea === "bottom" && (label.includes("tab") || label.includes("Tab") || label.includes("底部选中"));
}

function summarizePlanSteps(steps: AssetPatrolPlanStep[]): AssetPatrolPlan["summary"] {
  return {
    pageChecks: steps.filter((step) => step.kind === "page_match" || step.kind === "screenshot_region_match" || step.kind === "ocr_region_match").length,
    elementChecks: steps.filter((step) => step.kind === "element_relocation").length,
    transitionChecks: steps.filter((step) => step.kind === "transition_validation").length,
    taskChecks: steps.filter((step) => step.kind === "task_dry_run").length,
    skipped: steps.filter((step) => step.status === "skipped").length,
    needsRepair: steps.filter((step) => step.status === "needs_repair").length
  };
}

function emptySummary(): AssetPatrolPlan["summary"] {
  return {
    pageChecks: 0,
    elementChecks: 0,
    transitionChecks: 0,
    taskChecks: 0,
    skipped: 0,
    needsRepair: 0
  };
}

function readManualPageElements(node: BusinessNode): ManualPageElementAsset[] {
  const value = node.metadata?.assetRecordingManualElements;
  return Array.isArray(value) ? value.filter(isRecordObject).map((item) => item as ManualPageElementAsset) : [];
}

function readPatrolPageElements(node: BusinessNode, platform: PlatformScope): ManualPageElementAsset[] {
  const v2Elements = readPageElementPatrolAssets(node, platform);
  const legacyElements = readManualPageElements(node)
    .filter((element) => supportsAssetPlatform(element.platformScope, platform))
    .map((element) => ({ ...element, assetFormat: "legacy" as const }));
  const seen = new Set<string>();
  return [...v2Elements, ...legacyElements].filter((element) => {
    const key = element.id ? `id:${element.id}` : `locator:${element.locator ?? ""}:${element.label ?? element.name ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function readPageElementPatrolAssets(node: BusinessNode, platform: PlatformScope): ManualPageElementAsset[] {
  return readPageElementAssets(node)
    .filter((element) => supportsAssetPlatform(element.platformScope, platform))
    .map(pageElementPatrolAsset);
}

function readPageElementAssets(node: BusinessNode): PageElementAsset[] {
  const value = node.metadata?.assetRecordingPageElements;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): PageElementAsset | undefined => {
      if (!isRecordObject(item)) {
        return undefined;
      }
      const id = stringRecordField(item, "id");
      if (!id) {
        return undefined;
      }
      return {
        ...(item as PageElementAsset),
        id
      };
    })
    .filter((item): item is PageElementAsset => Boolean(item));
}

function pageElementPatrolAsset(element: PageElementAsset): ManualPageElementAsset {
  return {
    id: element.id,
    label: element.label,
    name: element.label,
    targetText: element.targetText,
    locator: element.locator,
    locatorKind: element.locatorKind,
    structuralLocator: element.structuralLocator,
    semanticArea: element.semanticArea,
    actionKind: actionKindForPageElement(element),
    abilityType: element.elementKind === "collection" ? "grid_candidate" : undefined,
    availability: "visible",
    visualLocator: element.visualLocator,
    scrollProfile: scrollProfileForPageElement(element),
    assetFormat: "v2"
  };
}

function actionKindForPageElement(element: PageElementAsset): string {
  const actions = new Set(element.actions ?? []);
  if (actions.has("input")) {
    return "input";
  }
  if (actions.has("scroll")) {
    return "scroll";
  }
  if (actions.has("long_press")) {
    return "long_press";
  }
  return "tap";
}

function scrollProfileForPageElement(element: PageElementAsset): Record<string, unknown> | undefined {
  if (element.elementKind !== "collection") {
    return undefined;
  }
  const collection = element.collection ?? {};
  const itemIdentity = collection.itemIdentity;
  const param = itemIdentity && isRecordObject(itemIdentity) ? stringRecordField(itemIdentity, "param") : undefined;
  const targetQuery = param ? `{{${param}}}` : undefined;
  const horizontal = collection.kind === "horizontal_list" || collection.kind === "carousel";
  return {
    containerKind: collection.kind === "vertical_grid" ? "grid_list" : collection.kind === "carousel" ? "carousel" : "list",
    direction: horizontal ? "horizontal" : "vertical",
    columns: collection.kind === "vertical_grid" ? Math.max(1, Math.floor(collection.columns ?? 1)) : 1,
    targetKind: targetQuery ? "item_text" : "nth_item",
    ...(targetQuery ? { targetQuery } : {}),
    afterFoundAction: "tap_item",
    candidateItemHeightPercent: collection.candidateItemHeightPercent,
    clickSafePoint: collection.clickSafePoint,
    scrollStepPercent: collection.scrollStepPercent,
    failureStrategy: collection.failureStrategy
  };
}

function readManualPageTasks(node: BusinessNode): ManualPageTaskAsset[] {
  const value = node.metadata?.assetRecordingPageTasks;
  return Array.isArray(value) ? value.filter(isRecordObject).map((item) => item as ManualPageTaskAsset) : [];
}

function platformFromObservation(observation: Observation): PlatformScope {
  return observation.platform === "ios" ? "ios" : "android";
}

function supportsAssetPlatform(scope: PlatformScope | undefined, platform: PlatformScope): boolean {
  return scope === undefined || scope === "mobile-both" || scope === platform;
}

function isV2PageTransitionEdge(edge: OperationEdge): boolean {
  return edge.key.startsWith("pagetransition.");
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addRuntimeParamDefinition(
  definitions: Map<string, AssetRuntimeParamDefinition>,
  rawKey: unknown,
  usage: AssetRuntimeParamUsage
): void {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) {
    return;
  }
  const existing = definitions.get(key);
  if (existing) {
    existing.usages.push(usage);
    return;
  }
  definitions.set(key, { key, usages: [usage] });
}

function stringRecordField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function elementLabel(element: ManualPageElementAsset): string {
  return element.label ?? element.actionName ?? element.name ?? element.targetText ?? element.executeText ?? element.id ?? "未命名元素";
}

function isRegionOnlyElement(element: ManualPageElementAsset, observation?: Observation, runtimeParams: Record<string, string> = {}): boolean {
  const locator = (element.locator ?? "").trim();
  const locatorKind = (element.locatorKind ?? "").trim();
  const hasSemanticText = Boolean(elementSemanticText(element, observation));
  if (locatorKind === "ocr_anchor_offset") {
    return !hasSemanticText;
  }
  const hasStructuralLocator = Boolean(element.structuralLocator) || locatorKind === "structural_locator" || locatorKind === "text_locator" || locatorKind === "collection_item_locator";
  if (hasSemanticText || hasStructuralLocator || hasVisualLocator(element.visualLocator) || gridCandidateResolvedByClassName(element as Record<string, unknown>, runtimeParams)) {
    return false;
  }
  return locator.startsWith("image-region:") || locator.startsWith("region_center:") || locatorKind === "region_center" || locatorKind === "image_region";
}

function elementSemanticText(element: ManualPageElementAsset, observation?: Observation): string | undefined {
  const candidates = [
    element.targetText,
    element.executeText,
    element.label,
    element.actionName,
    element.name
  ]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  for (const candidate of new Set(candidates)) {
    if (observationHasText(observation, candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function imageRegionActionRepairReason(action: ActionStep, observation?: Observation, runtimeParams: Record<string, string> = {}): AssetPatrolSkipReason | undefined {
  if (action.type !== "tap_on_image") {
    return undefined;
  }
  const params = action.params ?? {};
  const locator = stringRecordField(params, "locator") ?? "";
  const locatorKind = stringRecordField(params, "locatorKind") ?? "";
  if (locatorKind === "ocr_anchor_offset") {
    const anchorText = stringRecordField(params, "anchorText") ?? stringRecordField(params, "targetText");
    return anchorText && observationHasText(observation, anchorText) ? undefined : "runtime_relocation_required";
  }
  const hasImageRegion = locator.startsWith("image-region:") || Boolean(params.region && typeof params.region === "object");
  if (!hasImageRegion) {
    return undefined;
  }
  if (hasVisualLocator(params.visualLocator)) {
    return undefined;
  }
  if (gridCandidateResolvedByClassName(params, runtimeParams)) {
    return undefined;
  }
  const targetText = stringRecordField(params, "targetText");
  if (targetText && observationHasText(observation, targetText)) {
    return undefined;
  }
  return "runtime_relocation_required";
}

function hasVisualLocator(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Boolean(record.template) || (Array.isArray(record.candidates) && record.candidates.length > 0);
}

function observationHasText(observation: Observation | undefined, target: string): boolean {
  const normalizedTarget = normalizeSearchText(target);
  if (!normalizedTarget) {
    return false;
  }
  return (observation?.ocrTexts ?? []).some((item) => {
    const text = normalizeSearchText(item.text);
    return Boolean(text && text.includes(normalizedTarget));
  });
}

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function isDangerousTransition(edge: OperationEdge, patterns: string[]): boolean {
  const actionTexts = edge.actionPolicies.flatMap((policy) => [
    policy.action.title,
    policy.action.note,
    policy.action.type,
    ...Object.values(policy.action.params ?? {}).map((value) => typeof value === "string" ? value : "")
  ]);
  return isDangerousText([edge.name, edge.intent, ...actionTexts].join(" "), patterns);
}

function sourcePageNavigationTaskId(action: ActionStep): string | undefined {
  const params = action.params ?? {};
  const taskMode = params.taskMode;
  const taskId = params.taskId;
  return taskMode === "source_page_navigation" && typeof taskId === "string" && taskId.trim() ? taskId.trim() : undefined;
}

function isDangerousText(text: string, patterns: string[]): boolean {
  const normalized = text.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function isConfirmedStablePage(node: BusinessNode): boolean {
  return node.status === "active" && node.nodeType === "page" && (Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset") || node.tags.includes("asset-recording"));
}

function buildPlaceholderSteps(maxSteps: number): ActionStep[] {
  const now = nowIso();
  return Array.from({ length: Math.max(1, maxSteps) }, (_, index) => ({
    id: `asset_patrol_step_${index + 1}`,
    order: index + 1,
    type: "wait",
    enabled: true,
    title: `资产巡检 ${index + 1}`,
    params: {},
    createdAt: now
  }));
}

function stepMetadata(
  config: AssetPatrolConfig,
  plan: AssetPatrolPlan,
  step: AssetPatrolPlanStep,
  resultStatus: StepResult["status"]
): Record<string, unknown> {
  return {
    kind: step.kind,
    label: step.label,
    status: step.status,
    resultStatus,
    executionMode: "diagnostic",
    packageName: config.packageName,
    pageScope: config.pageScope,
    planStatus: plan.status,
    graphVersionId: plan.graphVersionId,
    startPage: plan.startPage,
    pageModelId: step.pageModelId,
    pageModelName: step.pageModelName,
    pageElementId: step.pageElementId,
    pageTransitionId: step.pageTransitionId,
    pageTaskId: step.pageTaskId,
    skipReason: step.skipReason,
    evidence: step.evidence,
    summary: plan.summary
  };
}

function failureMessageForStep(step: AssetPatrolPlanStep): string {
  if (step.skipReason === "runtime_relocation_required") {
    return "页面能力仅有固定区域坐标，缺少语义/视觉/结构定位证据，运行时不会直接点击。";
  }
  if (step.skipReason === "missing_action_policy") {
    return "连接边缺少可执行动作策略。";
  }
  return "资产巡检发现需要修复的问题。";
}

function assetPatrolStartStrategy(value: AssetPatrolStartMode): FlowStartStrategy {
  return value === "current_state" ? "keep_current" : value;
}

function normalizeStartMode(value: AssetPatrolStartMode | undefined): AssetPatrolStartMode {
  return value === "launch_app" || value === "restart_app" ? value : "current_state";
}

function normalizePageScope(value: AssetPatrolPageScope | undefined): AssetPatrolPageScope {
  return value === "reachable_pages" || value === "tagged_pages" || value === "all_active_pages" ? value : "current_page";
}

function normalizeRuntimeParams(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => Boolean(entry[0].trim()) && typeof entry[1] === "string"));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("aborted");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
