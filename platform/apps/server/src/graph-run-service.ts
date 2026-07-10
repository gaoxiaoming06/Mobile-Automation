import { readFile } from "node:fs/promises";
import {
  GraphRunner,
  RunExecutionController,
  type GraphExpectationEvaluationInput,
  type GraphExecutionResult,
  type GraphRecoveryRecord,
  type GraphRunnerDriver
} from "@mobile-automation/runner-core";
import {
  applyRuntimeOverlayToExecutionPlan,
  buildExecutionPlan,
  detectNode,
  planRoute,
  resolveTargetNode,
  type BusinessNode,
  type BusinessGraphVersion,
  type ActionPolicy,
  type ExecutionPlanStep,
  type GraphTargetApp,
  type NodeMatchResult,
  type OperationEdge,
  type RoutePlan,
  type RoutePlanIssue,
  type Observation,
  type ObservationUiElement,
  type RouteStrategy,
  type RuntimeOverlay,
  type TargetNodeQuery
} from "@mobile-automation/graph-core";
import {
  createId,
  nowIso,
  stepToAction,
  type ActionStep,
  type DeviceActionRequest,
  type DeviceEvent,
  type FlowStartStrategy,
  type MetricSample,
  type Platform,
  type RunConfig,
  type StepExpectationResult,
  type StepResult,
  type TestCase,
  type TestRun
} from "@mobile-automation/shared";
import { shouldRecordVideoForDevice } from "@mobile-automation/runner-core";
import type { AutomationDeviceDriver, DeviceEventWatcher, MobileVideoRecording, ObservedDeviceEvent } from "./mobile-driver.js";
import type { OcrService } from "./ocr.js";
import { ObservationService } from "./observation-service.js";
import { RunArtifactService } from "./run-artifact-service.js";
import { buildRuntimeUnknownNodeCandidate, mergeRuntimeUnknownNodeMetadata, summarizeObservation, type RuntimeUnknownNodeCandidate } from "./runtime-graph-candidate.js";
import { RuntimeInterceptor, type RuntimeInterceptorRecord, type RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { artifactFilePath } from "./artifacts.js";
import { matchCurrentPage } from "./page-matcher.js";
import { pageAbilityRouteGapIssues, withPageAbilityEdges } from "./page-ability-edges.js";
import { SemanticStepResolver } from "./semantic-locator.js";
import { resolveReachableStartNode, type StartAppScope } from "./start-node-recovery.js";
import { StepExpectationEvaluator, annotateNonBlockingExpectationResults, shouldFailStepForExpectation, stateExpectedDescription } from "./step-expectations.js";
import type { Storage } from "./storage.js";
import {
  buildAiDiagnosisEvidencePack,
  createAiDiagnosisClient,
  resolveAiDiagnosisConfig,
  type AiDiagnosisConfig,
  type AiDiagnosisClient,
  type AiDiagnosisResult
} from "./ai-diagnosis.js";

type GraphExecutionPlan = ReturnType<typeof buildExecutionPlan>;

const MAX_GRAPH_REPLAN_ATTEMPTS = 7;

type RuntimeStartStateReason =
  | "matched_graph_node"
  | "outside_target_app"
  | "unknown_app_state"
  | "multiple_candidates"
  | "low_confidence_graph_state"
  | "login_required"
  | "blocking_state";

type RuntimeStartState = {
  nodeId?: string;
  match?: NodeMatchResult;
  observation?: Observation;
  inTargetApp: boolean;
  reason: RuntimeStartStateReason;
};

export type GraphRunStorage = Pick<
  Storage,
  | "createRun"
  | "getRun"
  | "getBusinessGraph"
  | "getBusinessGraphVersion"
  | "getActiveBusinessGraphVersion"
  | "saveRoutePlan"
  | "updateRunStatus"
  | "addStepResult"
  | "addMetricSample"
  | "addDeviceEvent"
  | "writeArtifact"
  | "addArtifact"
  | "getArtifact"
  | "updateRunReport"
  | "listRunIdsByStatus"
  | "createBusinessNode"
  | "findBusinessNodeByKey"
  | "updateBusinessNodeMetadata"
  | "createOperationEdge"
  | "findOperationEdgeByKey"
  | "listRuntimeInterceptorRules"
  | "getAiDiagnosisSettings"
>;

export type StartGraphRunInput = {
  deviceSerial: string;
  graphId?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  target?: TargetNodeQuery;
  startNodeId?: string;
  platform?: "android" | "ios";
  strategy?: RouteStrategy;
  stopOnFailure?: boolean;
  startStrategy?: FlowStartStrategy;
  startAppPackageName?: string;
  overlay?: RuntimeOverlay;
  executionProfile?: "full" | "fast_visual";
  startAppScope?: StartAppScope;
  caseName?: string;
};

export type StartedGraphRun = {
  run: TestRun;
  routePlanId: string;
  executionPlanId: string;
  graphVersionId: string;
  targetNodeId: string;
  targetResolution?: ReturnType<typeof resolveTargetNode>;
};

export type GraphRunServiceOptions = {
  aiDiagnosisClient?: AiDiagnosisClient;
  createAiDiagnosisClient?: (config: Extract<AiDiagnosisConfig, { enabled: true }>) => AiDiagnosisClient;
};

type ActiveGraphRun = {
  promise: Promise<void>;
  controller: RunExecutionController;
  deviceSerial: string;
};

export class GraphRunService {
  private readonly activeRuns = new Map<string, ActiveGraphRun>();
  private readonly artifactService: RunArtifactService;
  private readonly expectationEvaluator: StepExpectationEvaluator;
  private readonly semanticStepResolver: SemanticStepResolver;
  private readonly observationService: ObservationService;
  private readonly aiDiagnosisClient?: AiDiagnosisClient;
  private readonly createAiDiagnosisClient: (config: Extract<AiDiagnosisConfig, { enabled: true }>) => AiDiagnosisClient;

  constructor(
    private readonly storage: GraphRunStorage,
    private readonly driver: AutomationDeviceDriver,
    private readonly ocr: OcrService,
    options: GraphRunServiceOptions = {}
  ) {
    this.aiDiagnosisClient = options.aiDiagnosisClient;
    this.createAiDiagnosisClient = options.createAiDiagnosisClient ?? createAiDiagnosisClient;
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
      dumpUiHierarchy: this.driver.dumpUiHierarchy ? (serial) => this.driver.dumpUiHierarchy!(serial) : undefined
    });
    this.semanticStepResolver = new SemanticStepResolver({
      ocr: this.ocr,
      performAction: (serial, action) => this.driver.performAction(serial, action),
      performSemanticAction: this.driver.performSemanticAction ? (serial, action) => this.driver.performSemanticAction!(serial, action) : undefined,
      dumpUiHierarchy: this.driver.dumpUiHierarchy ? (serial) => this.driver.dumpUiHierarchy!(serial) : undefined,
      captureLocatorScreenshot: (runId, stepResultId, serial, stepId, attempt) =>
        this.artifactService.captureLocatorScreenshot(runId, stepResultId, serial, stepId, attempt)
    });
    this.observationService = new ObservationService(driver, ocr);
  }

  async start(input: StartGraphRunInput): Promise<StartedGraphRun> {
    const activeRun = this.getActiveRunForDevice(input.deviceSerial);
    if (activeRun) {
      throw new GraphDeviceBusyError(input.deviceSerial, activeRun.runId);
    }

    const graphVersion = this.resolveGraphVersion(input);
    const graph = this.storage.getBusinessGraph(graphVersion.graphId);
    if (!graph) {
      throw new Error(`Business graph not found: ${graphVersion.graphId}`);
    }
    const platform = input.platform ?? platformFromTargetApp(graph.targetApp);
    if (!platform) {
      throw new Error("platform is required when the graph target app is not platform-specific");
    }
    const planningGraphVersion = withPageAbilityEdges(graphVersion, platform);
    const targetResolution = input.target ? resolveTargetNode(planningGraphVersion, { ...input.target, platform }) : undefined;
    if (targetResolution && targetResolution.status !== "resolved") {
      throw new GraphTargetResolutionError(targetResolution.status === "ambiguous" ? "Target node is ambiguous" : "Target node not found", targetResolution);
    }
    const targetNodeId = targetResolution?.targetNode?.id ?? input.targetNodeId?.trim();
    if (!targetNodeId) {
      throw new Error("targetNodeId or target is required");
    }
    validateRuntimeOverlayTarget(input.overlay, targetNodeId);

    const observationProfile = graphObservationProfile(input.executionProfile);
    const startResolution = input.startNodeId?.trim()
      ? { startNodeId: input.startNodeId.trim() }
      : await resolveReachableStartNode({
          graphVersion: planningGraphVersion,
          appId: graph.appId,
          targetApp: graph.targetApp,
          platform,
          targetNodeId,
          strategy: input.strategy,
          collectObservation: () =>
            this.observationService.collect(input.deviceSerial, {
              includeScreenshot: true,
              includeUiTree: observationProfile.includeUiTree,
              includeOcr: true
            }),
          performAction: (action) => this.driver.performAction(input.deviceSerial, action),
          baselineReader: (artifactId) => this.readPageAssetBaselineArtifact(artifactId),
          startAppScope: input.startAppScope
        });
    const detectedStartNodeId = startResolution.startNodeId;
    const routePlan = planRoute({
      graphVersion: planningGraphVersion,
      appId: graph.appId,
      targetApp: graph.targetApp,
      targetNodeId,
      startNodeId: detectedStartNodeId,
      platform,
      strategy: input.strategy
    });
    const finalRoutePlan = this.withPageAbilityRouteGapIssues(routePlan, graphVersion, platform, detectedStartNodeId);
    const baseExecutionPlan = buildExecutionPlan({
      routePlan: finalRoutePlan,
      platform
    });
    const executionPlan = appendTargetPageTaskSteps(
      appendSourcePageTaskNavigationSteps(applyRuntimeOverlayToExecutionPlan(baseExecutionPlan, input.overlay), planningGraphVersion, input.overlay),
      planningGraphVersion,
      input.overlay
    );
    this.storage.saveRoutePlan(finalRoutePlan);

    const config = this.createRunConfig(
      input.deviceSerial,
      input.startAppScope === "current_device" ? undefined : graph.targetApp,
      input.startStrategy,
      input.executionProfile,
      input.startAppPackageName
    );
    const testCase = graphExecutionPlanToCase(graph.name, executionPlan.steps, graph.targetApp, input.overlay, input.caseName);
    const run = this.storage.createRun({
      caseName: testCase.name,
      deviceSerial: input.deviceSerial,
      configJson: JSON.stringify(config),
      caseSnapshotJson: JSON.stringify(testCase),
      steps: testCase.steps
    });
    if (startResolution.recovery) {
      this.addDeviceEvent({
        id: createId("event"),
        runId: run.id,
        deviceSerial: input.deviceSerial,
        type: "start_state_failed",
        severity: startResolution.recovery.status === "recovered" ? "info" : "warning",
        occurredAt: nowIso(),
        summary:
          startResolution.recovery.status === "recovered"
            ? "Graph run backed out of an unreachable start page before route planning"
            : "Graph run could not back out of an unreachable start page before route planning",
        detail: JSON.stringify({
          reason: startResolution.recovery.status === "recovered" ? "back_recovery_to_reachable_node" : "back_recovery_exhausted",
          ...startResolution.recovery
        }),
        artifactIds: []
      });
    }
    if (startResolution.recovery?.status === "failed") {
      this.addDeviceEvent({
        id: createId("event"),
        runId: run.id,
        deviceSerial: input.deviceSerial,
        type: "runner_error",
        severity: "error",
        occurredAt: nowIso(),
        summary: "Graph route planning failed",
        detail: JSON.stringify({
          code: "START_BACK_RECOVERY_FAILED",
          message: "Controlled back recovery could not find a page that can reach the target. Please add a connection edge from a reachable page.",
          graphVersionId: graphVersion.id,
          startNodeId: detectedStartNodeId,
          targetNodeId,
          recovery: startResolution.recovery
        }),
        artifactIds: []
      });
      this.storage.updateRunStatus(run.id, "failed");
      await this.artifactService.generateReport(run.id);
      return {
        run: this.storage.getRun(run.id) ?? run,
        routePlanId: finalRoutePlan.id,
        executionPlanId: executionPlan.id,
        graphVersionId: graphVersion.id,
        targetNodeId,
        targetResolution
      };
    }

    const controller = new RunExecutionController();
    const promise = this.execute(run.id, planningGraphVersion, executionPlan, config, controller, input.stopOnFailure ?? true, input.overlay, input.startAppScope).finally(() => {
      this.activeRuns.delete(run.id);
    });
    this.activeRuns.set(run.id, {
      promise,
      controller,
      deviceSerial: input.deviceSerial
    });

    return {
      run,
      routePlanId: finalRoutePlan.id,
      executionPlanId: executionPlan.id,
      graphVersionId: graphVersion.id,
      targetNodeId,
      targetResolution
    };
  }

  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }

  async waitForRun(runId: string): Promise<void> {
    await this.activeRuns.get(runId)?.promise;
  }

  getActiveRunForDevice(deviceSerial: string): { runId: string; deviceSerial: string } | undefined {
    for (const [runId, activeRun] of this.activeRuns) {
      if (activeRun.deviceSerial === deviceSerial) {
        return { runId, deviceSerial };
      }
    }
    return undefined;
  }

  async stop(runId: string): Promise<boolean> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) {
      return false;
    }
    activeRun.controller.stop();
    await Promise.race([activeRun.promise, sleep(8000)]).catch(() => undefined);
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.activeRuns.keys()).map((runId) => this.stop(runId)));
  }

  private async execute(
    runId: string,
    graphVersion: BusinessGraphVersion,
    executionPlan: ReturnType<typeof buildExecutionPlan>,
    config: RunConfig,
    controller: RunExecutionController,
    stopOnFailure: boolean,
    overlay?: RuntimeOverlay,
    startAppScope?: StartAppScope
  ): Promise<void> {
    const runStartedAt = new Date();
    let failed = false;
    let stopped = false;
    let videoRecording: MobileVideoRecording | undefined;
    let eventWatcher: DeviceEventWatcher | undefined;
    const pendingEventWrites: Promise<void>[] = [];
    let runtimeFailure = false;
    let activeStepResultId: string | undefined;

    try {
      controller.throwIfStopped();
      const device = await this.driver.getDeviceInfo(config.deviceSerial);
      eventWatcher = await this.startEventWatcher(
        runId,
        config.deviceSerial,
        (event) => {
          if (event.type === "crash" || event.type === "anr") {
            runtimeFailure = true;
            if (stopOnFailure) {
              controller.stop();
            }
          }
        },
        (eventWrite) => pendingEventWrites.push(eventWrite),
        () => activeStepResultId,
        runStartedAt
      );

      if (shouldRecordVideoForDevice(config, device)) {
        try {
          videoRecording = await this.driver.startVideoRecording(config.deviceSerial, runId, this.artifactService.absoluteRunDir(runId, "videos"));
        } catch (error) {
          const artifact = await this.artifactService.writeLog(runId, `graph-video-start-failed-${Date.now()}.txt`, errorToString(error));
          this.addDeviceEvent({
            id: createId("event"),
            runId,
            deviceSerial: config.deviceSerial,
            type: "video_unavailable",
            severity: "warning",
            occurredAt: nowIso(),
            summary: "Graph run video recording unavailable",
            detail: errorToString(error),
            artifactIds: [artifact.id]
          });
        }
      }

      await this.applyStartStrategy(runId, config);
      await this.collectMetric(runId, config.deviceSerial);
      const graphStepResults = new Map<string, StepResult>();
      const runtimeExecutionPlan = await this.prepareRuntimeExecutionPlan({
        runId,
        serial: config.deviceSerial,
        graphVersion,
        targetNodeId: executionPlan.targetNodeId,
        platform: executionPlan.platform,
        strategy: executionPlan.strategy,
        targetApp: executionPlan.targetApp,
        overlay,
        requestedStartNodeId: executionPlan.startNodeId,
        executionProfile: config.executionProfile,
        startStrategy: config.startStrategy,
        startAppScope
      });
      const executablePlan = normalizeRuntimeExecutionPlan(runtimeExecutionPlan, config.executionProfile);
      const graphDriver = this.createGraphDriver(runId, graphVersion, config.deviceSerial, graphStepResults, (stepResultId) => {
        activeStepResultId = stepResultId;
      }, () => runtimeFailure, config.executionProfile);
      const graphRunner = new GraphRunner({
        executionPlan: executablePlan,
        driver: graphDriver,
        controller,
        stopOnFailure
      });
      const initialResult = await graphRunner.run();
      const result = await this.replanAndContinueIfPossible({
        runId,
        graphVersion,
        platform: executionPlan.platform,
        strategy: executionPlan.strategy,
        overlay,
        initialPlan: executablePlan,
        initialResult,
        graphDriver,
        controller,
        stopOnFailure
      });
      await this.writeGraphExecutionResult(runId, result, graphStepResults, executablePlan);
      failed = result.status === "failed" || result.status === "blocked" || runtimeFailure;
      stopped = result.status === "stopped" && !runtimeFailure;
      await this.collectMetric(runId, config.deviceSerial);
    } catch (error) {
      stopped = isRunnerStoppedError(error) && !runtimeFailure;
      failed = runtimeFailure || !stopped;
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: config.deviceSerial,
        type: "runner_error",
        severity: stopped ? "warning" : "error",
        occurredAt: nowIso(),
        summary: stopped ? "Graph run stopped" : "Graph run failed",
        detail: errorToString(error),
        artifactIds: []
      });
      await this.artifactService.writeLog(runId, `graph-run-error-${Date.now()}.txt`, errorToString(error)).catch(() => undefined);
    } finally {
      await eventWatcher?.stop().catch(() => undefined);
      await Promise.allSettled(pendingEventWrites);
      await this.artifactService.finalizeVideo(runId, videoRecording, failed || stopped || config.keepVideoOnSuccess);
      if (failed && !stopped) {
        await this.writeAiDiagnosis(runId, config, activeStepResultId).catch((error) => this.writeAiDiagnosisFailure(runId, config.deviceSerial, error, activeStepResultId));
      }
      this.storage.updateRunStatus(runId, stopped ? "stopped" : failed ? "failed" : "passed");
      await this.artifactService.generateReport(runId);
    }
  }

  private createGraphDriver(
    runId: string,
    graphVersion: BusinessGraphVersion,
    serial: string,
    stepResultsByPlanStepId: Map<string, StepResult>,
    setActiveStepResultId: (stepResultId: string | undefined) => void,
    isRuntimeFailure: () => boolean,
    executionProfile?: RunConfig["executionProfile"]
  ): GraphRunnerDriver {
    const latestMetricByStepResultId = new Map<string, MetricSample | undefined>();
    const preferredNodeIdByObservationId = new Map<string, string>();

    return {
      observe: async (step, phase) => {
        const stepResult = ensureGraphStepResult(runId, step, stepResultsByPlanStepId);
        setActiveStepResultId(stepResult.id);
        if (phase === "precondition") {
          stepResult.startedAt = stepResult.startedAt || nowIso();
        }
        const observationPhase = phase === "precondition" ? "precondition" : "state_transition";
        const interceptor = new RuntimeInterceptor({
          observe: () => this.collectGraphObservation(runId, serial, step, stepResult, observationPhase, executionProfile),
          performAction: async (action) => {
            await this.driver.performAction(serial, runtimeInterceptorStepToAction(action));
          }
        }, this.runtimeInterceptorRulesForGraph(graphVersion, observationPhase));
        const outcome = await interceptor.handle({ phase: observationPhase });
        const observation = outcome.observation;
        if (observation.id) {
          preferredNodeIdByObservationId.set(observation.id, phase === "precondition" ? step.fromNode.id : step.toNode.id);
        }
        const graphMetadata = readGraphMetadata(stepResult.metadata).graph ?? {};
        stepResult.metadata = {
          ...(stepResult.metadata ?? {}),
          graph: {
            ...graphMetadata,
            versionId: graphVersion.id,
            planStepId: step.id,
            edgeId: step.edgeId,
            edgeKey: step.edgeKey,
            fromNodeId: step.fromNode.id,
            fromNodeName: step.fromNode.name,
            toNodeId: step.toNode.id,
            toNodeName: step.toNode.name,
            runtimeOverlay: step.runtimeOverlay,
            observationProfile: executionProfile ?? "full",
            interceptors: appendInterceptorRecords(graphMetadata.interceptors, outcome.records, observationPhase),
            observations: {
              ...(graphMetadata.observations ?? {}),
              [phase]: summarizeObservation(observation)
            }
          }
        };
        return observation;
      },
      detectNode: async (observation) => {
        const preferredNodeId = observation.id ? preferredNodeIdByObservationId.get(observation.id) : undefined;
        return this.matchBusinessNode(observation, graphVersion, observation.platform, preferredNodeId);
      },
      performAction: async (action, step) => {
        const stepResult = ensureGraphStepResult(runId, step, stepResultsByPlanStepId);
        const device = await this.driver.getDeviceInfo(serial);
        const resolvedAction = actionWithGridCandidateAttempt(action, step.recovery?.attempt);
        const compoundSteps = compoundActionStepsFor(resolvedAction);
        if (compoundSteps.length) {
          const compoundResults: Array<Record<string, unknown>> = [];
          const actions = [resolvedAction, ...compoundSteps];
          for (let index = 0; index < actions.length; index += 1) {
            const microStep = { ...actions[index], order: index + 1 };
            const result = await this.performGraphActionMicroStep({
              runId,
              stepResult,
              action: microStep,
              serial,
              deviceSize: device.resolution
            });
            compoundResults.push({
              order: index + 1,
              id: microStep.id,
              type: microStep.type,
              label: microStep.title ?? stringParam(microStep.params.elementLabel) ?? microStep.type,
              resolved: result.resolved,
              message: result.message,
              metadata: result.metadata
            });
            if (!result.resolved) {
              stepResult.metadata = {
                ...(stepResult.metadata ?? {}),
                compound: {
                  total: actions.length,
                  steps: compoundResults
                },
                graph: readGraphMetadata(stepResult.metadata).graph
              };
              throw new Error(result.message ?? `Compound action ${microStep.type} was not resolved.`);
            }
          }
          stepResult.metadata = {
            ...(stepResult.metadata ?? {}),
            compound: {
              total: actions.length,
              steps: compoundResults
            },
            graph: readGraphMetadata(stepResult.metadata).graph
          };
          return;
        }
        const actionResult = await this.performGraphActionMicroStep({
          runId,
          stepResult,
          action: resolvedAction,
          serial,
          deviceSize: device.resolution
        });
        stepResult.metadata = {
          ...(stepResult.metadata ?? {}),
          actionBackend: actionResult.actionResult,
          semantic: actionResult.metadata,
          graph: readGraphMetadata(stepResult.metadata).graph
        };
        if (!actionResult.resolved) {
          throw new Error(actionResult.message ?? `Action ${action.type} was not resolved.`);
        }
      },
      evaluateExpectation: async (input) => {
        const stepResult = ensureGraphStepResult(runId, input.step, stepResultsByPlanStepId);
        if (input.expectation.type === "state_is") {
          return this.evaluateStateIsExpectation(input, graphVersion);
        }
        const metric =
          latestMetricByStepResultId.get(stepResult.id) ??
          (await this.collectMetric(runId, serial, stepResult.id).then((sample) => {
            latestMetricByStepResultId.set(stepResult.id, sample);
            return sample;
          }));
        const expectationStep = {
          ...(input.step.action ?? graphStepFallbackAction(input.step)),
          expectations: [input.expectation]
        };
        const results = annotateNonBlockingExpectationResults(
          expectationStep,
          await this.expectationEvaluator.evaluate({
            runId,
            serial,
            stepResultId: stepResult.id,
            step: expectationStep,
            afterScreenshot: await this.screenshotFromObservation(runId, input.observation),
            metric,
            runtimeFailure: isRuntimeFailure()
          })
        );
        return results[0] ?? unsupportedExpectationResult(input);
      }
    };
  }

  private async performGraphActionMicroStep(input: {
    runId: string;
    stepResult: StepResult;
    action: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<{
    resolved: boolean;
    message?: string;
    actionResult?: unknown;
    metadata?: Record<string, unknown>;
  }> {
    if (isSemanticAction(input.action)) {
      const outcome = await this.semanticStepResolver.resolveIfNeeded({
        runId: input.runId,
        stepResultId: input.stepResult.id,
        step: input.action,
        serial: input.serial,
        deviceSize: input.deviceSize
      });
      for (const artifact of outcome?.artifacts ?? []) {
        input.stepResult.artifacts.push(artifact);
      }
      return {
        resolved: outcome?.resolved === true,
        message: outcome?.message,
        actionResult: outcome?.actionResult,
        metadata: outcome?.metadata
      };
    }
    if (input.action.type === "wait_until_state") {
      return this.waitForMicroState(input);
    }
    const actionResult = await this.driver.performAction(input.serial, stepToAction(input.action));
    return {
      resolved: true,
      actionResult,
      metadata: {
        type: input.action.type,
        action: "direct"
      }
    };
  }

  private async waitForMicroState(input: {
    action: ActionStep;
    serial: string;
  }): Promise<{
    resolved: boolean;
    message: string;
    metadata: Record<string, unknown>;
  }> {
    const expectedText = stringParam(input.action.params.text ?? input.action.params.expected ?? input.action.params.elementLabel);
    if (!expectedText) {
      return {
        resolved: false,
        message: "wait_until_state requires text or expected params.",
        metadata: {
          type: "state_wait",
          action: "fail",
          reason: "missing_text"
        }
      };
    }
    const timeoutMs = positiveNumber(input.action.params.timeoutMs, 3000);
    const intervalMs = positiveNumber(input.action.params.intervalMs, 250);
    const started = Date.now();
    let attempts = 0;
    let latestText = "";
    while (Date.now() - started <= timeoutMs) {
      attempts += 1;
      const observation = await this.observationService.collect(input.serial, {
        includeScreenshot: true,
        includeUiTree: true,
        includeOcr: true
      });
      latestText = observationTextSnapshot(observation);
      if (latestText.includes(expectedText)) {
        return {
          resolved: true,
          message: `State text "${expectedText}" appeared after ${attempts} attempt(s).`,
          metadata: {
            type: "state_wait",
            action: "matched",
            expectedText,
            attempts,
            actualText: latestText
          }
        };
      }
      await sleep(intervalMs);
    }
    return {
      resolved: false,
      message: `State text "${expectedText}" did not appear within ${timeoutMs}ms.`,
      metadata: {
        type: "state_wait",
        action: "fail",
        expectedText,
        attempts,
        actualText: latestText
      }
    };
  }

  private runtimeInterceptorRulesForGraph(graphVersion: BusinessGraphVersion, _phase: "precondition" | "state_transition"): RuntimeInterceptorRule[] {
    const graph = this.storage.getBusinessGraph(graphVersion.graphId);
    return this.storage.listRuntimeInterceptorRules?.({
      enabledOnly: true,
      platform: graph?.platformScope === "ios" ? "ios" : "android",
      appPackageName: graph?.targetApp?.androidPackageName,
      iosBundleId: graph?.targetApp?.iosBundleId
    }) ?? [];
  }

  private async collectGraphObservation(
    runId: string,
    serial: string,
    step: ExecutionPlanStep,
    stepResult: StepResult,
    phase: "precondition" | "state_transition",
    executionProfile?: RunConfig["executionProfile"]
  ): Promise<Observation> {
    const screenshot = await this.artifactService.captureStepScreenshotWithBytes(runId, stepResult.id, 0, step.order, serial, phase === "precondition" ? "before" : "after");
    stepResult.artifacts.push(screenshot.artifact);
    if (phase !== "precondition") {
      stepResult.afterScreenshotId = screenshot.artifact.id;
    }
    const observation = await this.observationService.collect(serial, {
      includeScreenshot: true,
      includeUiTree: graphObservationProfile(executionProfile).includeUiTree,
      includeOcr: true,
      screenshotOverride: screenshot.png
    });
    observation.screenshot = {
      ...(observation.screenshot ?? {}),
      artifactId: screenshot.artifact.id
    };
    return observation;
  }

  private async replanAndContinueIfPossible(input: {
    runId: string;
    graphVersion: BusinessGraphVersion;
    platform: "android" | "ios";
    strategy: RouteStrategy;
    overlay?: RuntimeOverlay;
    initialPlan: GraphExecutionPlan;
    initialResult: GraphExecutionResult;
    graphDriver: GraphRunnerDriver;
    controller: RunExecutionController;
    stopOnFailure: boolean;
  }): Promise<GraphExecutionResult> {
    let result = input.initialResult;
    const recoveries: GraphRecoveryRecord[] = [...(result.recoveries ?? [])];
    const executedPlans = [input.initialPlan];
    let recoveryAttempt = 0;

    while (recoveryAttempt < MAX_GRAPH_REPLAN_ATTEMPTS) {
      const gridRequest = this.findGridCandidateRetryRequest(result, input.initialPlan);
      if (gridRequest) {
        recoveryAttempt += 1;
        const recovered = await this.backToGridCandidateSource({
          runId: input.runId,
          graphVersion: input.graphVersion,
          graphDriver: input.graphDriver,
          controller: input.controller,
          gridStep: gridRequest.gridStep,
          failedStep: gridRequest.failedStep,
          attempt: recoveryAttempt
        });
        recoveries.push(recovered.record);
        if (!recovered.startNodeId) {
          break;
        }
        const recovery = this.planRecovery({
          runId: input.runId,
          graphVersion: input.graphVersion,
          platform: input.platform,
          strategy: input.strategy,
          overlay: input.overlay,
          targetNodeId: input.initialPlan.targetNodeId,
          startNodeId: recovered.startNodeId,
          attempt: recoveryAttempt,
          reasonDeviationId: gridRequest.failedStep.deviations.at(-1)?.id,
          originalPlanStepId: gridRequest.gridStep.id,
          originalEdgeId: gridRequest.gridStep.edgeId
        });
        recoveries[recoveries.length - 1] = {
          ...recoveries[recoveries.length - 1],
          ...recovery.record,
          message: `Returned to ${gridRequest.gridStep.fromNode.name} and retrying grid candidate #${recoveryAttempt}.`,
          recordedAt: nowIso()
        };
        if (!recovery.executionPlan) {
          break;
        }
        const recoveryResult = await new GraphRunner({
          executionPlan: recovery.executionPlan,
          driver: input.graphDriver,
          controller: input.controller,
          stopOnFailure: input.stopOnFailure
        }).run();
        executedPlans.push(recovery.executionPlan);
        recoveries[recoveries.length - 1] = {
          ...recoveries[recoveries.length - 1],
          status: recoveryResult.status,
          message:
            recoveryResult.status === "passed"
              ? `Retried grid candidate #${recoveryAttempt} from ${gridRequest.gridStep.fromNode.name} and reached ${input.initialPlan.targetNodeId}.`
              : `Grid candidate retry #${recoveryAttempt} ended with ${recoveryResult.status}: ${recoveryResult.failure?.message ?? "no failure message"}.`,
          recordedAt: nowIso()
        };
        result = mergeGraphExecutionResults({
          base: result,
          next: recoveryResult,
          status: recoveryResult.status === "passed" ? "passed" : recoveryResult.status,
          recoveries: [...recoveries],
          executionPlanId: executedPlans.map((plan) => plan.id).join("+"),
          routePlanId: executedPlans.map((plan) => plan.routePlanId).join("+")
        });
        if (recoveryResult.status === "passed" || recoveryResult.status === "stopped") {
          return result;
        }
        continue;
      }
      const request = this.findReplanRequest(result);
      if (!request) {
        break;
      }
      recoveryAttempt += 1;
      const recovery = this.planRecovery({
        runId: input.runId,
        graphVersion: input.graphVersion,
        platform: input.platform,
        strategy: input.strategy,
        overlay: input.overlay,
        targetNodeId: input.initialPlan.targetNodeId,
        startNodeId: request.actualNodeId,
        attempt: recoveryAttempt,
        reasonDeviationId: request.deviation.id,
        originalPlanStepId: request.step.planStepId,
        originalEdgeId: request.step.edgeId
      });
      recoveries.push(recovery.record);
      if (!recovery.executionPlan) {
        break;
      }

      const recoveryResult = await new GraphRunner({
        executionPlan: recovery.executionPlan,
        driver: input.graphDriver,
        controller: input.controller,
        stopOnFailure: input.stopOnFailure
      }).run();
      executedPlans.push(recovery.executionPlan);

      const latestRecovery: GraphRecoveryRecord = {
        ...recovery.record,
        status: recoveryResult.status,
        message:
          recoveryResult.status === "passed"
            ? `Replanned from ${request.actualNodeId} and reached ${input.initialPlan.targetNodeId}.`
            : `Replan from ${request.actualNodeId} ended with ${recoveryResult.status}: ${recoveryResult.failure?.message ?? "no failure message"}.`,
        recordedAt: nowIso()
      };
      recoveries[recoveries.length - 1] = latestRecovery;
      result = mergeGraphExecutionResults({
        base: result,
        next: recoveryResult,
        status: recoveryResult.status === "passed" ? "passed" : recoveryResult.status,
        recoveries: [...recoveries],
        executionPlanId: executedPlans.map((plan) => plan.id).join("+"),
        routePlanId: executedPlans.map((plan) => plan.routePlanId).join("+")
      });

      if (recoveryResult.status === "passed") {
        return result;
      }
      if (recoveryResult.status === "stopped") {
        return result;
      }
    }

    return recoveries.length ? { ...result, recoveries } : result;
  }

  private async prepareRuntimeExecutionPlan(input: {
    runId: string;
    serial: string;
    graphVersion: BusinessGraphVersion;
    targetNodeId: string;
    platform: "android" | "ios";
    strategy: RouteStrategy;
    targetApp?: GraphTargetApp;
    overlay?: RuntimeOverlay;
    requestedStartNodeId?: string;
    executionProfile?: RunConfig["executionProfile"];
    startStrategy?: FlowStartStrategy;
    startAppScope?: StartAppScope;
  }): Promise<GraphExecutionPlan> {
    const graph = this.storage.getBusinessGraph(input.graphVersion.graphId);
    const startStrategyKeepsCurrentState = !input.startStrategy || input.startStrategy === "keep_current";
    const shouldTrustRequestedStart = input.executionProfile === "fast_visual" && Boolean(input.requestedStartNodeId) && startStrategyKeepsCurrentState;
    const startState = shouldTrustRequestedStart
      ? undefined
      : await this.detectRuntimeStartState(input.serial, input.graphVersion, input.targetApp, input.platform, input.executionProfile, input.startAppScope);
    let startNodeId = startState?.nodeId ?? (shouldTrustRequestedStart ? input.requestedStartNodeId : undefined);
    if (startState && startNodeId && shouldRecordMatchedStartState(startState.reason)) {
      this.recordMatchedStartState(input.runId, input.serial, startState);
    }
    if (!startNodeId) {
      if (input.startAppScope === "current_device") {
        await this.recordUnrecognizedCurrentDeviceStart(input.runId, input.serial, input.graphVersion, input.targetNodeId, startState ?? {
          inTargetApp: true,
          reason: "unknown_app_state"
        });
        throw new Error("CURRENT_DEVICE_START_NODE_NOT_RECOGNIZED: current device state did not match any business graph node.");
      }
      await this.performBootstrapStart(input.runId, input.serial, input.targetApp, startState ?? {
        inTargetApp: true,
        reason: "unknown_app_state"
      });
      const bootstrapped = await this.waitForRecognizedStartNode(input.serial, input.graphVersion, input.platform, input.targetApp, input.executionProfile, input.startAppScope);
      startNodeId = bootstrapped.nodeId;
      if (!startNodeId) {
        await this.recordUnrecognizedBootstrapStart(input.runId, input.serial, input.graphVersion, input.targetNodeId, startState ?? {
          inTargetApp: true,
          reason: "unknown_app_state"
        }, bootstrapped.state);
        throw new Error("BOOTSTRAP_START_NODE_NOT_RECOGNIZED: target app was launched but no business graph node matched the current state.");
      }
    }
    startNodeId = startNodeId ?? input.requestedStartNodeId ?? rootNodeId(input.graphVersion, input.platform);

    const routePlan = planRoute({
      graphVersion: input.graphVersion,
      appId: graph?.appId ?? "",
      targetApp: input.targetApp,
      targetNodeId: input.targetNodeId,
      startNodeId,
      platform: input.platform,
      strategy: input.strategy
    });
    const finalRoutePlan = this.withPageAbilityRouteGapIssues(routePlan, input.graphVersion, input.platform, startNodeId);
    this.storage.saveRoutePlan(finalRoutePlan);
    const baseExecutionPlan = buildExecutionPlan({
      routePlan: finalRoutePlan,
      platform: input.platform
    });
    const executionPlan = appendTargetPageTaskSteps(
      appendSourcePageTaskNavigationSteps(applyRuntimeOverlayToExecutionPlan(baseExecutionPlan, input.overlay), input.graphVersion, input.overlay),
      input.graphVersion,
      input.overlay
    );
    const blockingIssue = executionPlan.unresolvedIssues.find((issue) => issue.severity === "error");
    if (blockingIssue) {
      await this.recordRoutePlanningBlocked(input.runId, input.serial, input.graphVersion, finalRoutePlan, blockingIssue.message);
      throw new Error(blockingIssue.message);
    }
    return executionPlan;
  }

  private withPageAbilityRouteGapIssues(
    routePlan: RoutePlan,
    graphVersion: BusinessGraphVersion,
    platform: Platform,
    startNodeId?: string
  ): RoutePlan {
    if (!routePlan.unresolvedIssues.some((issue) => issue.code === "TARGET_NODE_UNREACHABLE")) {
      return routePlan;
    }
    const abilityIssues = pageAbilityRouteGapIssues(graphVersion, platform, { startNodeId });
    if (!abilityIssues.length) {
      return routePlan;
    }
    return {
      ...routePlan,
      unresolvedIssues: appendUniqueRouteIssues(routePlan.unresolvedIssues, abilityIssues),
      assumptions: [...routePlan.assumptions, "Some saved page abilities are not connected to target pages yet."]
    };
  }

  private async recordRoutePlanningBlocked(
    runId: string,
    serial: string,
    graphVersion: BusinessGraphVersion,
    routePlan: RoutePlan,
    message: string
  ): Promise<void> {
    const blockingIssue = routePlan.unresolvedIssues.find((issue) => issue.severity === "error");
    const observation = await this.observationService.collect(serial, {
      includeScreenshot: true,
      includeUiTree: true,
      includeOcr: true
    }).catch(() => undefined);
    const artifact = await this.writeRouteGapExplorationArtifact(runId, graphVersion, routePlan, observation);
    if (artifact && observation) {
      this.createRouteGapDraftEdge(graphVersion, routePlan, observation, artifact.id);
    }
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial: serial,
      type: "runner_error",
      severity: "error",
      occurredAt: nowIso(),
      summary: "Graph route planning failed",
      detail: JSON.stringify({
        code: blockingIssue?.code ?? "ROUTE_PLANNING_BLOCKED",
        message,
        routePlanId: routePlan.id,
        graphVersionId: graphVersion.id,
        startNodeId: routePlan.startNodeId,
        targetNodeId: routePlan.targetNodeId,
        issue: blockingIssue,
        explorationArtifactId: artifact?.id
      }),
      artifactIds: artifact ? [artifact.id] : []
    });
  }

  private async writeRouteGapExplorationArtifact(
    runId: string,
    graphVersion: BusinessGraphVersion,
    routePlan: RoutePlan,
    observation: Observation | undefined
  ): Promise<Awaited<ReturnType<RunArtifactService["writeLog"]>> | undefined> {
    if (!observation) {
      return undefined;
    }
    const startNode = graphVersion.nodes.find((node) => node.id === routePlan.startNodeId);
    const targetNode = graphVersion.nodes.find((node) => node.id === routePlan.targetNodeId);
    const blockingIssue = routePlan.unresolvedIssues.find((issue) => issue.severity === "error");
    const artifact = {
      source: "route_gap",
      reasonCode: blockingIssue?.code ?? "ROUTE_PLANNING_BLOCKED",
      message: blockingIssue?.message,
      graphVersionId: graphVersion.id,
      routePlanId: routePlan.id,
      startNode: startNode ? summarizeBusinessNode(startNode) : { id: routePlan.startNodeId },
      targetNode: targetNode ? summarizeBusinessNode(targetNode) : { id: routePlan.targetNodeId },
      observation: summarizeObservation(observation),
      actionCandidates: buildRouteGapActionCandidates(observation),
      nextStepHint: "Promote a verified candidate into graph nodes/edges, then let RoutePlanner compute the path. Do not hardcode recovery paths."
    };
    return this.artifactService.writeLog(runId, `route-gap-exploration-${Date.now()}.json`, JSON.stringify(artifact, null, 2));
  }

  private createRouteGapDraftEdge(graphVersion: BusinessGraphVersion, routePlan: RoutePlan, observation: Observation, artifactId: string): void {
    const startNode = graphVersion.nodes.find((node) => node.id === routePlan.startNodeId);
    const targetNode = graphVersion.nodes.find((node) => node.id === routePlan.targetNodeId);
    if (!startNode || !targetNode) {
      return;
    }
    const candidate = selectRouteGapActionCandidate(buildRouteGapActionCandidates(observation), startNode);
    const action = readSuggestedAction(candidate);
    if (!candidate || !action) {
      return;
    }
    const key = `exploration.${startNode.key}.to.${targetNode.key}.${stableHash(JSON.stringify(action.params ?? {}))}`;
    if (this.storage.findOperationEdgeByKey(graphVersion.id, key)) {
      return;
    }
    this.storage.createOperationEdge({
      graphVersionId: graphVersion.id,
      fromNodeId: startNode.id,
      toNodeId: targetNode.id,
      key,
      name: `探索候选：${startNode.name} -> ${targetNode.name}`,
      intent: `从当前页面候选控件探索到目标节点 ${targetNode.name}`,
      status: "draft",
      source: "exploration",
      actionPolicies: [
        {
          id: createId("action_policy"),
          priority: 1,
          action: {
            id: createId("step"),
            order: 1,
            type: action.type,
            enabled: true,
            title: `探索点击：${String(candidate.text ?? candidate.resourceId ?? candidate.accessibilityId ?? targetNode.name)}`,
            params: action.params,
            createdAt: nowIso()
          },
          fallback: false,
          source: {
            sourceType: "exploration",
            artifactId,
            confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0.6
          },
          reliabilityHint: "medium"
        }
      ],
      expectations: [...targetNode.defaultExpectations],
      platformScope: observation.platform,
      reliabilityScore: typeof candidate.confidence === "number" ? candidate.confidence : 0.6,
      failurePolicy: {
        recoverTo: "replan"
      }
    });
  }

  private async detectRuntimeStartState(
    serial: string,
    graphVersion: BusinessGraphVersion,
    targetApp: GraphTargetApp | undefined,
    platform: "android" | "ios",
    executionProfile?: RunConfig["executionProfile"],
    startAppScope?: StartAppScope
  ): Promise<RuntimeStartState> {
    const observationProfile = graphObservationProfile(executionProfile);
    const observation = await this.observationService.collect(serial, {
      includeScreenshot: true,
      includeUiTree: observationProfile.includeUiTree,
      includeOcr: true
    });
    const match = await this.matchBusinessNode(observation, graphVersion, platform);
    const inTargetApp = isObservationInRunScope(observation, targetApp, platform, startAppScope);
    const nodeId = match.status === "matched" && inTargetApp ? match.node?.id : undefined;
    return {
      nodeId,
      match,
      observation,
      inTargetApp,
      reason: classifyRuntimeStartState({ match, inTargetApp })
    };
  }

  private async waitForRecognizedStartNode(
    serial: string,
    graphVersion: BusinessGraphVersion,
    platform: "android" | "ios",
    targetApp: GraphTargetApp | undefined,
    executionProfile?: RunConfig["executionProfile"],
    startAppScope?: StartAppScope
  ): Promise<{ nodeId?: string; match?: NodeMatchResult; state?: RuntimeStartState }> {
    const deadline = Date.now() + 8000;
    let latest: { nodeId?: string; match?: NodeMatchResult; state?: RuntimeStartState } = {};
    while (Date.now() < deadline) {
      const state = await this.detectRuntimeStartState(serial, graphVersion, targetApp, platform, executionProfile, startAppScope);
      latest = { nodeId: state.nodeId, match: state.match, state };
      if (state.nodeId && state.inTargetApp) {
        return latest;
      }
      await sleep(300);
    }
    return latest;
  }

  private async performBootstrapStart(runId: string, serial: string, targetApp: GraphTargetApp | undefined, startState: RuntimeStartState): Promise<void> {
    const appIdentifier = targetApp?.androidPackageName ?? targetApp?.iosBundleId;
    if (!appIdentifier) {
      throw new Error("Cannot bootstrap graph run because target app package/bundle id is missing.");
    }
    await this.driver.performAction(serial, { type: "launch_app", packageName: appIdentifier });
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial: serial,
      type: "start_state_failed",
      severity: "info",
      occurredAt: nowIso(),
      summary: "Graph run bootstrapped target app before route planning",
      detail: JSON.stringify({
        reason: startState.reason,
        appIdentifier,
        inTargetApp: startState.inTargetApp,
        beforeObservation: startState.observation ? summarizeObservation(startState.observation) : undefined,
        beforeMatch: summarizeNodeMatch(startState.match)
      }),
      artifactIds: []
    });
  }

  private recordMatchedStartState(runId: string, serial: string, startState: RuntimeStartState): void {
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial: serial,
      type: "start_state_failed",
      severity: "warning",
      occurredAt: nowIso(),
      summary: "Graph run detected a special start state before route planning",
      detail: JSON.stringify({
        reason: startState.reason,
        inTargetApp: startState.inTargetApp,
        beforeObservation: startState.observation ? summarizeObservation(startState.observation) : undefined,
        beforeMatch: summarizeNodeMatch(startState.match)
      }),
      artifactIds: []
    });
  }

  private async recordUnrecognizedBootstrapStart(
    runId: string,
    serial: string,
    graphVersion: BusinessGraphVersion,
    targetNodeId: string,
    startState: RuntimeStartState,
    afterState: RuntimeStartState | undefined
  ): Promise<void> {
    const candidate = await this.writeRuntimeUnknownNodeCandidate(runId, graphVersion, afterState?.observation ?? startState.observation, afterState?.match);
    const edge = candidate
      ? this.createRuntimeUnknownToTargetDraftEdge({
          graphVersion,
          fromNode: candidate.node,
          targetNodeId,
          observation: afterState?.observation ?? startState.observation,
          artifactId: candidate.artifact.id
        })
      : undefined;
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial: serial,
      type: "start_state_failed",
      severity: "error",
      occurredAt: nowIso(),
      summary: "Graph run bootstrap did not reach a recognized graph node",
      detail: JSON.stringify({
        code: "BOOTSTRAP_START_NODE_NOT_RECOGNIZED",
        reason: startState.reason,
        inTargetApp: startState.inTargetApp,
        beforeObservation: startState.observation ? summarizeObservation(startState.observation) : undefined,
        beforeMatch: summarizeNodeMatch(startState.match),
        afterObservation: afterState?.observation ? summarizeObservation(afterState.observation) : undefined,
        afterMatch: summarizeNodeMatch(afterState?.match),
        candidateNodeId: candidate?.node.id,
        candidateNodeKey: candidate?.node.key,
        candidateArtifactId: candidate?.artifact.id,
        candidateEdgeId: edge?.id,
        candidateEdgeKey: edge?.key,
        hint: "Add a recovery edge to a known node or strengthen matchers for the current page before running this target."
      }),
      artifactIds: candidate ? [candidate.artifact.id] : []
    });
  }

  private async recordUnrecognizedCurrentDeviceStart(
    runId: string,
    serial: string,
    graphVersion: BusinessGraphVersion,
    targetNodeId: string,
    startState: RuntimeStartState
  ): Promise<void> {
    const candidate = await this.writeRuntimeUnknownNodeCandidate(runId, graphVersion, startState.observation, startState.match);
    const edge = candidate
      ? this.createRuntimeUnknownToTargetDraftEdge({
          graphVersion,
          fromNode: candidate.node,
          targetNodeId,
          observation: startState.observation,
          artifactId: candidate.artifact.id
        })
      : undefined;
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      deviceSerial: serial,
      type: "start_state_failed",
      severity: "error",
      occurredAt: nowIso(),
      summary: "Current device start state did not match a recognized graph node",
      detail: JSON.stringify({
        code: "CURRENT_DEVICE_START_NODE_NOT_RECOGNIZED",
        reason: startState.reason,
        inTargetApp: startState.inTargetApp,
        observation: startState.observation ? summarizeObservation(startState.observation) : undefined,
        match: summarizeNodeMatch(startState.match),
        candidateNodeId: candidate?.node.id,
        candidateNodeKey: candidate?.node.key,
        candidateArtifactId: candidate?.artifact.id,
        candidateEdgeId: edge?.id,
        candidateEdgeKey: edge?.key,
        hint: "Strengthen matchers for the current page or add a connection edge before running this target."
      }),
      artifactIds: candidate ? [candidate.artifact.id] : []
    });
  }

  private async writeRuntimeUnknownNodeCandidate(
    runId: string,
    graphVersion: BusinessGraphVersion,
    observation: Observation | undefined,
    match: NodeMatchResult | undefined
  ): Promise<{ node: BusinessNode; artifact: Awaited<ReturnType<RunArtifactService["writeLog"]>> } | undefined> {
    if (!observation) {
      return undefined;
    }
    const candidate = buildRuntimeUnknownNodeCandidate(graphVersion.id, observation, match);
    const artifact = await this.artifactService.writeLog(runId, `runtime-unknown-node-candidate-${Date.now()}.json`, JSON.stringify(candidate, null, 2));
    const existingNode = this.storage.findBusinessNodeByKey(graphVersion.id, candidate.key);
    if (existingNode) {
      const metadata = mergeRuntimeUnknownNodeMetadata(existingNode.metadata, candidate.metadata, artifact.id);
      const node = this.storage.updateBusinessNodeMetadata(existingNode.id, metadata) ?? {
        ...existingNode,
        metadata
      };
      return { node, artifact };
    }
    const node = this.storage.createBusinessNode({
      ...candidate,
      graphVersionId: graphVersion.id,
      metadata: {
        ...(candidate.metadata ?? {}),
        artifactId: artifact.id,
        artifactIds: [artifact.id],
        observationCount: 1,
        firstObservedAt: nowIso(),
        lastObservedAt: nowIso()
      }
    });
    return { node, artifact };
  }

  private createRuntimeUnknownToTargetDraftEdge(input: {
    graphVersion: BusinessGraphVersion;
    fromNode: BusinessNode;
    targetNodeId: string;
    observation: Observation | undefined;
    artifactId: string;
  }): ReturnType<GraphRunStorage["createOperationEdge"]> | undefined {
    if (!input.observation) {
      return undefined;
    }
    const targetNode = input.graphVersion.nodes.find((node) => node.id === input.targetNodeId);
    if (!targetNode || targetNode.id === input.fromNode.id) {
      return undefined;
    }
    const candidate = selectRuntimeUnknownActionCandidate(buildRouteGapActionCandidates(input.observation));
    const action = readSuggestedAction(candidate);
    if (!candidate || !action) {
      return undefined;
    }
    const key = `exploration.${input.fromNode.key}.to.${targetNode.key}.${stableHash(JSON.stringify(action.params ?? {}))}`;
    const existing = this.storage.findOperationEdgeByKey(input.graphVersion.id, key);
    if (existing) {
      return existing;
    }
    return this.storage.createOperationEdge({
      graphVersionId: input.graphVersion.id,
      fromNodeId: input.fromNode.id,
      toNodeId: targetNode.id,
      key,
      name: `探索候选：${input.fromNode.name} -> ${targetNode.name}`,
      intent: `从运行期未知页候选控件探索到目标节点 ${targetNode.name}`,
      status: "draft",
      source: "exploration",
      actionPolicies: [
        {
          id: createId("action_policy"),
          priority: 1,
          action: {
            id: createId("step"),
            order: 1,
            type: action.type,
            enabled: true,
            title: `探索点击：${String(candidate.text ?? candidate.resourceId ?? candidate.accessibilityId ?? targetNode.name)}`,
            params: action.params,
            createdAt: nowIso()
          },
          fallback: false,
          source: {
            sourceType: "exploration",
            artifactId: input.artifactId,
            confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0.6
          },
          reliabilityHint: "medium"
        }
      ],
      expectations: [...targetNode.defaultExpectations],
      platformScope: input.observation.platform,
      reliabilityScore: typeof candidate.confidence === "number" ? candidate.confidence : 0.6,
      failurePolicy: {
        recoverTo: "replan"
      }
    });
  }

  private findReplanRequest(result: GraphExecutionResult):
    | {
        step: GraphExecutionResult["steps"][number];
        deviation: NonNullable<GraphExecutionResult["deviations"][number]>;
        actualNodeId: string;
      }
    | undefined {
    if (result.status !== "failed") {
      return undefined;
    }
    const failedStep = [...result.steps].reverse().find((step) => step.status === "failed" && step.phase === "state_transition");
    const deviation = [...(failedStep?.deviations ?? [])]
      .reverse()
      .find((item) => item.action === "replan_required" && item.phase === "state_transition" && typeof item.actualNodeId === "string" && item.actualNodeId.trim());
    if (!failedStep || !deviation?.actualNodeId) {
      return undefined;
    }
    if (deviation.actualNodeId === failedStep.toNodeId) {
      return undefined;
    }
    if (deviation.actualNodeId === failedStep.fromNodeId) {
      return undefined;
    }
    return {
      step: failedStep,
      deviation,
      actualNodeId: deviation.actualNodeId
    };
  }

  private findGridCandidateRetryRequest(
    result: GraphExecutionResult,
    executionPlan: GraphExecutionPlan
  ):
    | {
        failedStep: GraphExecutionResult["steps"][number];
        gridStep: GraphExecutionPlan["steps"][number];
      }
    | undefined {
    if (result.status !== "failed") {
      return undefined;
    }
    const failedStep = [...result.steps].reverse().find((step) => step.status === "failed");
    if (!failedStep) {
      return undefined;
    }
    const failedPlanIndex = executionPlan.steps.findIndex((step) => step.id === failedStep.planStepId);
    if (failedPlanIndex <= 0) {
      return undefined;
    }
    for (let index = failedPlanIndex - 1; index >= 0; index -= 1) {
      const planStep = executionPlan.steps[index];
      if (planStep.action?.params.abilityType !== "grid_candidate") {
        continue;
      }
      return undefined;
    }
    return undefined;
  }

  private async backToGridCandidateSource(input: {
    runId: string;
    graphVersion: BusinessGraphVersion;
    graphDriver: GraphRunnerDriver;
    controller: RunExecutionController;
    gridStep: GraphExecutionPlan["steps"][number];
    failedStep: GraphExecutionResult["steps"][number];
    attempt: number;
  }): Promise<{ record: GraphRecoveryRecord; startNodeId?: string }> {
    await input.controller.waitUntilRunnable();
    await this.driver.performAction(this.storage.getRun(input.runId)?.deviceSerial ?? "", { type: "back" });
    let latestObservation: Observation | undefined;
    let latestMatch: NodeMatchResult | undefined;
    const started = Date.now();
    while (Date.now() - started <= 3000) {
      latestObservation = await input.graphDriver.observe(input.gridStep, "precondition");
      latestMatch = await input.graphDriver.detectNode(latestObservation);
      if (latestMatch.status === "matched" && latestMatch.node?.id === input.gridStep.fromNode.id) {
        break;
      }
      await sleep(250);
    }
    this.addDeviceEvent({
      id: createId("event"),
      runId: input.runId,
      deviceSerial: this.storage.getRun(input.runId)?.deviceSerial ?? "",
      type: "runner_error",
      severity: latestMatch?.node?.id === input.gridStep.fromNode.id ? "warning" : "error",
      occurredAt: nowIso(),
      summary:
        latestMatch?.node?.id === input.gridStep.fromNode.id
          ? "Graph run returned to a grid candidate source page before retrying the next candidate"
          : "Graph run could not return to the grid candidate source page",
      detail: JSON.stringify({
        reason: "grid_candidate_downstream_failed",
        failedStepId: input.failedStep.planStepId,
        failedEdgeId: input.failedStep.edgeId,
        sourceNodeId: input.gridStep.fromNode.id,
        sourceNodeName: input.gridStep.fromNode.name,
        latestMatch: summarizeNodeMatch(latestMatch),
        observation: latestObservation ? summarizeObservation(latestObservation) : undefined
      }),
      artifactIds: []
    });
    return {
      record: {
        id: createId("graph_recovery"),
        attempt: input.attempt,
        fromNodeId: input.gridStep.fromNode.id,
        targetNodeId: input.gridStep.toNode.id,
        status: latestMatch?.node?.id === input.gridStep.fromNode.id ? "planned" : "blocked",
        message:
          latestMatch?.node?.id === input.gridStep.fromNode.id
            ? `Returned to ${input.gridStep.fromNode.name}; retrying after semantic relocation.`
            : `Could not return to ${input.gridStep.fromNode.name}; latest state was ${latestMatch?.node?.id ?? latestMatch?.status ?? "unknown"}.`,
        recordedAt: nowIso()
      },
      startNodeId: latestMatch?.node?.id === input.gridStep.fromNode.id ? input.gridStep.fromNode.id : undefined
    };
  }

  private planRecovery(input: {
    runId: string;
    graphVersion: BusinessGraphVersion;
    platform: "android" | "ios";
    strategy: RouteStrategy;
    overlay?: RuntimeOverlay;
    targetNodeId: string;
    startNodeId: string;
    attempt: number;
    reasonDeviationId?: string;
    originalPlanStepId?: string;
    originalEdgeId?: string;
  }): { record: GraphRecoveryRecord; executionPlan?: GraphExecutionPlan } {
    const graph = this.storage.getBusinessGraph(input.graphVersion.graphId);
    const routePlan = planRoute({
      graphVersion: input.graphVersion,
      appId: graph?.appId ?? "",
      targetApp: graph?.targetApp,
      targetNodeId: input.targetNodeId,
      startNodeId: input.startNodeId,
      platform: input.platform,
      strategy: input.strategy
    });
    this.storage.saveRoutePlan(routePlan);
    const blockingRouteIssue = routePlan.unresolvedIssues.find((issue) => issue.severity === "error");
    const baseRecord: GraphRecoveryRecord = {
      id: createId("graph_recovery"),
      attempt: input.attempt,
      fromNodeId: input.startNodeId,
      targetNodeId: input.targetNodeId,
      routePlanId: routePlan.id,
      reasonDeviationId: input.reasonDeviationId,
      status: blockingRouteIssue ? "blocked" : "planned",
      message: blockingRouteIssue
        ? `Cannot replan from ${input.startNodeId} to ${input.targetNodeId}: ${blockingRouteIssue.message}`
        : `Replanned from actual node ${input.startNodeId} to target node ${input.targetNodeId}.`,
      recordedAt: nowIso()
    };
    if (blockingRouteIssue) {
      return { record: baseRecord };
    }

    const baseExecutionPlan = buildExecutionPlan({
      routePlan,
      platform: input.platform
    });
    const executionPlan = this.markRecoveryExecutionPlan(
      appendTargetPageTaskSteps(
        appendSourcePageTaskNavigationSteps(applyRuntimeOverlayToExecutionPlan(baseExecutionPlan, input.overlay), input.graphVersion, input.overlay),
        input.graphVersion,
        input.overlay
      ),
      input.attempt,
      input.reasonDeviationId,
      input.originalPlanStepId,
      input.originalEdgeId
    );
    const blockingExecutionIssue = executionPlan.unresolvedIssues.find((issue) => issue.severity === "error");
    if (blockingExecutionIssue) {
      return {
        record: {
          ...baseRecord,
          executionPlanId: executionPlan.id,
          status: "blocked",
          message: `Cannot execute recovery plan ${executionPlan.id}: ${blockingExecutionIssue.message}`,
          recordedAt: nowIso()
        }
      };
    }
    return {
      record: {
        ...baseRecord,
        executionPlanId: executionPlan.id
      },
      executionPlan
    };
  }

  private markRecoveryExecutionPlan(
    executionPlan: GraphExecutionPlan,
    attempt: number,
    reasonDeviationId?: string,
    originalPlanStepId?: string,
    originalEdgeId?: string
  ): GraphExecutionPlan {
    return {
      ...executionPlan,
      steps: executionPlan.steps.map((step) => ({
        ...step,
        order: step.order + 1000 * attempt,
        recovery: {
          attempt,
          reasonDeviationId,
          originalPlanStepId,
          originalEdgeId
        }
      }))
    };
  }

  private async evaluateStateIsExpectation(input: GraphExpectationEvaluationInput, graphVersion: BusinessGraphVersion): Promise<StepExpectationResult> {
    if (!input.observation) {
      return {
        id: createId("expectation_result"),
        expectationId: input.expectation.id,
        type: input.expectation.type,
        status: "unsupported",
        blocking: true,
        expected: stateExpectedDescription(input.expectation),
        actual: "Observation is unavailable.",
        reason: "state_is requires a graph observation collected at the verification phase.",
        evidenceArtifactIds: [],
        checkedAt: nowIso()
      };
    }
    const match =
      input.nodeMatch && input.nodeMatch.observationId === input.observation.id
        ? input.nodeMatch
        : await this.matchBusinessNode(input.observation, graphVersion, input.observation.platform);
    const expectedNodeId = stringParam(input.expectation.params.nodeId ?? input.expectation.params.expectedNodeId ?? input.expectation.params.expected);
    const expectedNodeKey = stringParam(input.expectation.params.nodeKey ?? input.expectation.params.expectedNodeKey);
    const expectedNodeName = stringParam(input.expectation.params.nodeName ?? input.expectation.params.expectedNodeName);
    const matched =
      match.status === "matched" &&
      Boolean(match.node) &&
      (expectedNodeId
        ? match.node!.id === expectedNodeId
        : (!expectedNodeKey || match.node!.key === expectedNodeKey) && (!expectedNodeName || match.node!.name === expectedNodeName));
    const actual = match.node
      ? `Matched ${match.node.name} (${match.node.key}, ${match.node.id}) with score ${Math.round(match.score * 100)}%.`
      : `State detection returned ${match.status} with score ${Math.round(match.score * 100)}%.`;
    return {
      id: createId("expectation_result"),
      expectationId: input.expectation.id,
      type: input.expectation.type,
      status: matched ? "passed" : "failed",
      blocking: input.expectation.params.blocking === false ? false : true,
      expected: stateExpectedDescription(input.expectation),
      actual,
      reason: matched ? "Matched by business graph state detector." : "Detected business node does not match the expected state.",
      evidenceArtifactIds: [input.observation.screenshot?.artifactId].filter((id): id is string => Boolean(id)),
      checkedAt: nowIso()
    };
  }

  private async writeGraphExecutionResult(
    runId: string,
    result: GraphExecutionResult,
    stepResultsByPlanStepId: Map<string, StepResult>,
    executionPlan: ReturnType<typeof buildExecutionPlan>
  ): Promise<void> {
    const graphResultArtifact = await this.artifactService.writeLog(runId, "graph-execution-result.json", JSON.stringify(result, null, 2));
    for (const step of result.steps) {
      const planStep = executionPlan.steps.find((item) => item.id === step.planStepId);
      const stepResultKey = graphStepResultKeyFromResultStep(step);
      const stepResult: StepResult = stepResultsByPlanStepId.get(stepResultKey) ?? {
        id: createId("step_result"),
        runId,
        iterationIndex: 0,
        stepId: stepResultKey,
        stepOrder: step.order,
        type: planStep?.action?.type ?? "wait",
        status: "running",
        startedAt: step.startedAt,
        artifacts: [],
        metadata: {}
      };
      const persisted: StepResult = {
        ...stepResult,
        status: graphStepStatusToLegacy(step.status),
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        durationMs: step.durationMs,
        errorCode: step.errorCode,
        errorMessage: step.errorMessage,
        afterScreenshotId: step.observations.after?.screenshot?.artifactId ?? step.observations.before?.screenshot?.artifactId,
        expectationResults: [...step.preconditionResults, ...step.expectationResults, ...step.systemGuardResults],
        metadata: {
          ...(stepResult.metadata ?? {}),
          graph: {
            ...readGraphMetadata(stepResult.metadata).graph,
            planStepId: step.planStepId,
            edgeId: step.edgeId,
            edgeKey: planStep?.edgeKey ?? readGraphMetadata(stepResult.metadata).graph?.edgeKey,
            fromNodeId: step.fromNodeId,
            fromNodeName: planStep?.fromNode.name ?? readGraphMetadata(stepResult.metadata).graph?.fromNodeName,
            toNodeId: step.toNodeId,
            toNodeName: planStep?.toNode.name ?? readGraphMetadata(stepResult.metadata).graph?.toNodeName,
            phase: step.phase,
            usedActionPolicyId: step.usedActionPolicyId,
            fallbackActionPolicyId: step.fallbackActionPolicyId,
            actionPolicy: summarizeActionPolicy(planStep?.selectedActionPolicy),
            recoveryAttempt: step.recoveryAttempt,
            recoveryReasonDeviationId: step.recoveryReasonDeviationId,
            recoveryReason: recoveryReasonForStep(step),
            beforeMatch: summarizeNodeMatch(step.nodeMatches.before),
            afterMatch: summarizeNodeMatch(step.nodeMatches.after),
            compound: stepResult.metadata?.compound,
            deviations: step.deviations
          }
        }
      };
      this.storage.addStepResult(persisted);
    }
    if (result.failure) {
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: this.storage.getRun(runId)?.deviceSerial ?? "",
        type: "runner_error",
        severity: "error",
        occurredAt: nowIso(),
        summary: `Graph run failed at ${result.failure.phase}`,
        detail: `${result.failure.code}: ${result.failure.message}`,
        artifactIds: [graphResultArtifact.id]
      });
    }
  }

  private async screenshotFromObservation(runId: string, observation: Observation | undefined) {
    const artifactId = observation?.screenshot?.artifactId;
    if (!artifactId) {
      return undefined;
    }
    const png = await this.artifactService.readArtifactBytes(runId, artifactId);
    if (!png) {
      return undefined;
    }
    return {
      artifact: {
        id: artifactId,
        type: "screenshot" as const,
        name: artifactId,
        path: "",
        url: "",
        createdAt: observation.capturedAt
      },
      png
    };
  }

  private resolveGraphVersion(input: StartGraphRunInput): BusinessGraphVersion {
    if (input.graphVersionId) {
      const graphVersion = this.storage.getBusinessGraphVersion(input.graphVersionId);
      if (!graphVersion) {
        throw new Error(`Business graph version not found: ${input.graphVersionId}`);
      }
      return graphVersion;
    }
    if (!input.graphId) {
      throw new Error("graphVersionId or graphId is required");
    }
    const graphVersion = this.storage.getActiveBusinessGraphVersion(input.graphId);
    if (!graphVersion) {
      throw new Error(`Active graph version not found for graph: ${input.graphId}`);
    }
    return graphVersion;
  }

  private async detectCurrentStartNodeId(
    deviceSerial: string,
    graphVersion: BusinessGraphVersion,
    targetApp: GraphTargetApp | undefined,
    platform: "android" | "ios"
  ): Promise<string | undefined> {
    try {
      const observation = await this.observationService.collect(deviceSerial, {
        includeScreenshot: true,
        includeUiTree: true,
        includeOcr: true
      });
      if (!isObservationInTargetApp(observation, targetApp, platform)) {
        return rootNodeId(graphVersion, platform);
      }
      const result = await this.matchBusinessNode(observation, graphVersion, platform);
      return result.status === "matched" ? result.node?.id : undefined;
    } catch {
      return rootNodeId(graphVersion, platform);
    }
  }

  private async matchBusinessNode(
    observation: Observation,
    graphVersion: BusinessGraphVersion,
    platform: "android" | "ios",
    preferredNodeId?: string
  ): Promise<NodeMatchResult> {
    const graphMatch = detectNode(observation, graphVersion, platform);
    if (graphMatch.status === "matched" && (isBlockingStateNode(graphMatch.node) || isLoginRequiredNode(graphMatch.node))) {
      return graphMatch;
    }
    if (preferredNodeId && graphMatch.status === "matched" && graphMatch.node?.id === preferredNodeId) {
      return graphMatch;
    }
    const pageMatch = await matchCurrentPage({
      graphVersion,
      observation,
      baselineReader: (artifactId) => this.readPageAssetBaselineArtifact(artifactId),
      candidateNodeIds: preferredNodeId ? [preferredNodeId] : undefined
    });
    if (pageMatch.match.status === "matched") {
      return pageMatch.match;
    }
    if (preferredNodeId) {
      const fallbackPageMatch = await matchCurrentPage({
        graphVersion,
        observation,
        baselineReader: (artifactId) => this.readPageAssetBaselineArtifact(artifactId)
      });
      if (fallbackPageMatch.match.status === "matched") {
        return fallbackPageMatch.match;
      }
      return graphMatch.status === "matched" ? graphMatch : detectNode(fallbackPageMatch.observation, graphVersion, platform);
    }
    return graphMatch.status === "matched" ? graphMatch : detectNode(pageMatch.observation, graphVersion, platform);
  }

  private async readPageAssetBaselineArtifact(artifactId: string): Promise<Buffer | undefined> {
    const artifact = this.storage.getArtifact(artifactId);
    if (!artifact) {
      return undefined;
    }
    return readFile(artifactFilePath(artifact.path)).catch(() => undefined);
  }

  private createRunConfig(
    deviceSerial: string,
    targetApp: GraphTargetApp | undefined,
    startStrategy: FlowStartStrategy | undefined,
    executionProfile: RunConfig["executionProfile"] | undefined,
    explicitStartAppPackageName?: string
  ): RunConfig {
    const startAppPackageName = explicitStartAppPackageName?.trim() || targetApp?.androidPackageName;
    const profile = executionProfile ?? "full";
    return {
      deviceSerial,
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 300,
      stopOnFailure: true,
      recordVideo: profile !== "fast_visual",
      keepVideoOnSuccess: profile !== "fast_visual",
      startStrategy: startStrategy ?? "keep_current",
      startAppPackageName,
      startSetupScope: "before_run",
      executionProfile: profile
    };
  }

  private async applyStartStrategy(runId: string, config: RunConfig): Promise<void> {
    const strategy = config.startStrategy ?? "keep_current";
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
    if (strategy === "launch_app") {
      await this.driver.performAction(config.deviceSerial, { type: "launch_app", packageName });
      return;
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

  private async startEventWatcher(
    runId: string,
    serial: string,
    onObservedEvent: (event: ObservedDeviceEvent) => void,
    trackEventWrite?: (write: Promise<void>) => void,
    getActiveStepResultId?: () => string | undefined,
    since?: Date
  ): Promise<DeviceEventWatcher | undefined> {
    if (!this.driver.watchDeviceEvents) {
      return undefined;
    }
    try {
      return await this.driver.watchDeviceEvents(serial, (event) => {
        onObservedEvent(event);
        const eventWrite = this.recordObservedDeviceEvent(runId, serial, event, getActiveStepResultId?.()).catch(() => undefined);
        trackEventWrite?.(eventWrite);
        void eventWrite;
      }, { since });
    } catch (error) {
      const artifact = await this.artifactService.writeLog(runId, `graph-event-watch-start-failed-${Date.now()}.txt`, errorToString(error));
      this.addDeviceEvent({
        id: createId("event"),
        runId,
        deviceSerial: serial,
        type: "command_failed",
        severity: "warning",
        occurredAt: nowIso(),
        summary: "Graph run device event watcher unavailable",
        detail: errorToString(error),
        artifactIds: [artifact.id]
      });
      return undefined;
    }
  }

  private async recordObservedDeviceEvent(runId: string, serial: string, observed: ObservedDeviceEvent, stepResultId?: string): Promise<void> {
    const artifact = observed.detail
      ? await this.artifactService.writeLog(runId, `graph-device-event-${observed.type}-${Date.now()}.txt`, observed.detail, stepResultId)
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
      artifactIds: [artifact?.id].filter((id): id is string => Boolean(id))
    });
  }

  private async writeAiDiagnosis(runId: string, config: RunConfig, activeStepResultId?: string): Promise<void> {
    const aiDiagnosisClient = this.resolveAiDiagnosisClient();
    if (!aiDiagnosisClient) {
      return;
    }
    const run = this.storage.getRun(runId);
    if (!run) {
      return;
    }
    const failedStep = latestFailedStep(run.stepResults) ?? run.stepResults.at(-1);
    const evidence = buildAiDiagnosisEvidencePack({
      runId,
      runKind: config.runKind,
      deviceSerial: config.deviceSerial,
      packageName: config.assetPatrol?.packageName ?? config.startAppPackageName,
      currentPage: graphString(failedStep, "fromNodeName"),
      targetPage: graphString(failedStep, "toNodeName"),
      failedStep: failedStep
        ? {
            id: failedStep.id,
            title: graphString(failedStep, "edgeKey") ?? graphString(failedStep, "edgeId") ?? failedStep.stepId,
            status: failedStep.status,
            errorMessage: failedStep.errorMessage
          }
        : undefined,
      error: failedStep?.errorMessage ?? latestErrorEvent(run.events)?.detail ?? "Run failed without a step error message.",
      runtimeParams: config.assetPatrol?.runtimeParams,
      recentSteps: run.stepResults.slice(-8).map((step) => ({
        id: step.id,
        stepId: step.stepId,
        order: step.stepOrder,
        type: step.type,
        status: step.status,
        errorCode: step.errorCode,
        errorMessage: step.errorMessage,
        graph: readRecord(step.metadata?.graph)
      })),
      recentEvents: run.events.slice(-8).map((event) => ({
        type: event.type,
        severity: event.severity,
        summary: event.summary,
        detail: event.detail,
        artifactIds: event.artifactIds
      })),
      artifacts: run.artifacts.slice(-12).map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        name: artifact.name,
        path: artifact.path,
        url: artifact.url
      }))
    });
    const diagnosis = await aiDiagnosisClient.diagnose(evidence);
    const artifact = await this.artifactService.writeLog(
      runId,
      `ai-diagnosis-${Date.now()}.json`,
      JSON.stringify({ evidence, diagnosis }, null, 2),
      activeStepResultId ?? failedStep?.id
    );
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      stepResultId: activeStepResultId ?? failedStep?.id,
      deviceSerial: config.deviceSerial,
      type: "ai_diagnosis",
      severity: aiDiagnosisSeverity(diagnosis),
      occurredAt: nowIso(),
      summary: `AI 诊断：${diagnosis.classification} · ${diagnosis.summary}`,
      detail: JSON.stringify({
        confidence: diagnosis.confidence,
        recommendedAction: diagnosis.recommendedAction,
        safeToAutoApply: diagnosis.safeToAutoApply,
        assetPatch: diagnosis.assetPatch
      }),
      artifactIds: [artifact.id]
    });
  }

  private resolveAiDiagnosisClient(): AiDiagnosisClient | undefined {
    if (this.aiDiagnosisClient) {
      return this.aiDiagnosisClient;
    }
    const aiDiagnosisConfig = resolveAiDiagnosisConfig(process.env, this.storage.getAiDiagnosisSettings());
    return aiDiagnosisConfig.enabled ? this.createAiDiagnosisClient(aiDiagnosisConfig) : undefined;
  }

  private async writeAiDiagnosisFailure(runId: string, serial: string, error: unknown, activeStepResultId?: string): Promise<void> {
    const artifact = await this.artifactService.writeLog(runId, `ai-diagnosis-failed-${Date.now()}.txt`, errorToString(error), activeStepResultId).catch(() => undefined);
    this.addDeviceEvent({
      id: createId("event"),
      runId,
      stepResultId: activeStepResultId,
      deviceSerial: serial,
      type: "ai_diagnosis",
      severity: "warning",
      occurredAt: nowIso(),
      summary: "AI 诊断失败",
      detail: errorToString(error),
      artifactIds: [artifact?.id].filter((id): id is string => Boolean(id))
    });
  }

  private addDeviceEvent(event: DeviceEvent): void {
    this.storage.addDeviceEvent(event);
  }
}

export class GraphDeviceBusyError extends Error {
  constructor(
    readonly deviceSerial: string,
    readonly activeRunId: string
  ) {
    super(`Device ${deviceSerial} is already running graph test ${activeRunId}`);
    this.name = "GraphDeviceBusyError";
  }
}

export class GraphTargetResolutionError extends Error {
  constructor(
    message: string,
    readonly targetResolution: ReturnType<typeof resolveTargetNode>
  ) {
    super(message);
    this.name = "GraphTargetResolutionError";
  }
}

function graphExecutionPlanToCase(
  name: string,
  steps: ExecutionPlanStep[],
  targetApp?: GraphTargetApp,
  overlay?: RuntimeOverlay,
  caseName?: string
): TestCase {
  const now = nowIso();
  return {
    id: createId("graph_case"),
    name: caseName?.trim() || `${name} 目标节点执行`,
    platformScope: "mobile-both",
    targetApp,
    tags: overlay ? ["graph-run", "runtime-overlay"] : ["graph-run"],
    version: 1,
    steps: steps.map((step) => {
      const action = step.action ?? graphStepFallbackAction(step);
      return {
        ...action,
        id: step.id,
        order: step.order,
        title: step.name,
        note: "graph-run",
        params: {
          ...(action.params ?? {}),
          graphRun: true
        },
        preconditions: step.preconditions,
        expectations: [...step.expectations, ...step.systemGuards]
      };
    }),
    createdAt: now,
    updatedAt: now
  };
}

function ensureGraphStepResult(runId: string, step: ExecutionPlanStep, results: Map<string, StepResult>): StepResult {
  const resultKey = graphStepResultKeyFromPlanStep(step);
  const existing = results.get(resultKey);
  if (existing) {
    return existing;
  }
  const result: StepResult = {
    id: createId("step_result"),
    runId,
    iterationIndex: 0,
    stepId: resultKey,
    stepOrder: step.order,
    type: step.action?.type ?? "wait",
    status: "running",
    startedAt: nowIso(),
    artifacts: [],
    metadata: {
      graph: {
        planStepId: step.id,
        edgeId: step.edgeId,
        edgeKey: step.edgeKey,
        fromNodeId: step.fromNode.id,
        fromNodeName: step.fromNode.name,
        toNodeId: step.toNode.id,
        toNodeName: step.toNode.name,
        runtimeOverlay: step.runtimeOverlay
      }
    }
  };
  results.set(resultKey, result);
  return result;
}

function graphStepResultKeyFromPlanStep(step: ExecutionPlanStep): string {
  const attempt = step.recovery?.attempt;
  return typeof attempt === "number" && Number.isFinite(attempt) ? `${step.id}__recovery_${Math.max(0, Math.floor(attempt))}` : step.id;
}

function graphStepResultKeyFromResultStep(step: GraphExecutionResult["steps"][number]): string {
  const attempt = step.recoveryAttempt;
  return typeof attempt === "number" && Number.isFinite(attempt) ? `${step.planStepId}__recovery_${Math.max(0, Math.floor(attempt))}` : step.planStepId;
}

function graphStepFallbackAction(step: ExecutionPlanStep): ActionStep {
  return {
    id: step.id,
    order: step.order,
    type: "wait",
    enabled: true,
    title: step.name,
    params: {
      durationMs: 1
    },
    createdAt: nowIso()
  };
}

function mergeGraphExecutionResults(input: {
  base: GraphExecutionResult;
  next: GraphExecutionResult;
  status: GraphExecutionResult["status"];
  recoveries: GraphRecoveryRecord[];
  executionPlanId: string;
  routePlanId: string;
}): GraphExecutionResult {
  const steps = [...input.base.steps, ...input.next.steps].map((step, index) => ({
    ...step,
    order: index + 1
  }));
  const endedAt = input.next.endedAt;
  const startedMs = Date.parse(input.base.startedAt);
  const endedMs = Date.parse(endedAt);
  return {
    ...input.base,
    executionPlanId: input.executionPlanId,
    routePlanId: input.routePlanId,
    status: input.status,
    endedAt,
    durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? endedMs - startedMs : input.base.durationMs + input.next.durationMs,
    steps,
    deviations: steps.flatMap((step) => step.deviations),
    recoveries: input.recoveries,
    failure: input.status === "passed" ? undefined : input.next.failure ?? input.base.failure
  };
}

function unsupportedExpectationResult(input: GraphExpectationEvaluationInput): StepExpectationResult {
  return {
    id: createId("expectation_result"),
    expectationId: input.expectation.id,
    type: input.expectation.type,
    status: "unsupported",
    blocking: true,
    expected: `Evaluate ${input.expectation.type}`,
    actual: "No evaluator result was produced.",
    reason: "Graph expectation adapter returned no result.",
    evidenceArtifactIds: [],
    checkedAt: nowIso()
  };
}

function graphStepStatusToLegacy(status: GraphExecutionResult["steps"][number]["status"]): StepResult["status"] {
  if (status === "blocked") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  return status;
}

function summarizeBusinessNode(node: BusinessNode): Record<string, unknown> {
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    nodeType: node.nodeType,
    tags: node.tags,
    status: node.status
  };
}

function buildRouteGapActionCandidates(observation: Observation): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const candidates: Array<Record<string, unknown>> = [];
  for (const element of observation.uiElements) {
    if (!isRouteGapActionCandidate(element)) {
      continue;
    }
    const key = `${element.resourceId ?? ""}|${element.accessibilityId ?? element.contentDesc ?? ""}|${element.text ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({
      text: element.text,
      resourceId: element.resourceId,
      accessibilityId: element.accessibilityId ?? element.contentDesc,
      className: element.className,
      bounds: element.bounds,
      confidence: routeGapCandidateConfidence(element),
      suggestedAction: {
        type: "tap_on_element",
        params: {
          locator: {
            strategy: "android_uiautomator",
            resourceId: element.resourceId,
            contentDesc: element.accessibilityId ?? element.contentDesc,
            text: element.text
          },
          tapTarget: "clickable_ancestor"
        }
      }
    });
  }
  return candidates
    .sort((left, right) => Number(right.confidence ?? 0) - Number(left.confidence ?? 0))
    .slice(0, 12);
}

function selectRouteGapActionCandidate(candidates: Array<Record<string, unknown>>, startNode: BusinessNode): Record<string, unknown> | undefined {
  const startAnchors = new Set(
    startNode.matchers
      .filter((matcher) => matcher.type === "resource_id" || matcher.type === "accessibility_id" || matcher.type === "text" || matcher.type === "ocr_text")
      .map((matcher) => `${matcher.type}:${matcher.value}`)
  );
  return candidates.find((candidate) => {
    const resourceId = typeof candidate.resourceId === "string" ? candidate.resourceId : undefined;
    const accessibilityId = typeof candidate.accessibilityId === "string" ? candidate.accessibilityId : undefined;
    const text = typeof candidate.text === "string" ? candidate.text : undefined;
    return !(
      (resourceId && startAnchors.has(`resource_id:${resourceId}`)) ||
      (accessibilityId && startAnchors.has(`accessibility_id:${accessibilityId}`)) ||
      (text && (startAnchors.has(`text:${text}`) || startAnchors.has(`ocr_text:${text}`)))
    );
  });
}

function selectRuntimeUnknownActionCandidate(candidates: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return candidates[0];
}

function isRouteGapActionCandidate(element: ObservationUiElement): boolean {
  if (element.enabled === false || !element.visible || !element.bounds) {
    return false;
  }
  return Boolean(isMeaningfulResourceId(element.resourceId) || isMeaningfulText(element.accessibilityId ?? element.contentDesc) || isMeaningfulText(element.text));
}

function routeGapCandidateConfidence(element: ObservationUiElement): number {
  let score = 0.3;
  if (element.clickable) {
    score += 0.35;
  } else if (element.longClickable) {
    score += 0.25;
  } else if (element.focusable) {
    score += 0.1;
  }
  if (isMeaningfulResourceId(element.resourceId)) {
    score += 0.3;
  }
  if (isMeaningfulText(element.accessibilityId ?? element.contentDesc)) {
    score += 0.15;
  }
  if (isMeaningfulText(element.text)) {
    score += 0.1;
  }
  return Math.min(0.95, Number(score.toFixed(2)));
}

function readSuggestedAction(candidate: Record<string, unknown> | undefined): Pick<ActionStep, "type" | "params"> | undefined {
  const suggestedAction = candidate?.suggestedAction;
  if (!suggestedAction || typeof suggestedAction !== "object" || Array.isArray(suggestedAction)) {
    return undefined;
  }
  const action = suggestedAction as Record<string, unknown>;
  const params = action.params;
  if (action.type !== "tap_on_element" || !params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return {
    type: "tap_on_element",
    params: params as Record<string, unknown>
  };
}

function summarizeNodeMatch(match: NodeMatchResult | undefined): Record<string, unknown> | undefined {
  if (!match) {
    return undefined;
  }
  return {
    status: match.status,
    nodeId: match.node?.id,
    nodeName: match.node?.name,
    score: match.score,
    candidates: match.candidates.slice(0, 5).map((candidate) => ({
      nodeId: candidate.node.id,
      nodeName: candidate.node.name,
      score: candidate.score,
      matchedWeight: candidate.matchedWeight,
      totalWeight: candidate.totalWeight,
      quality: candidate.quality,
      matcherResults: candidate.matcherResults.map((result) => ({
        matcherId: result.matcherId,
        type: result.type,
        expected: result.expected,
        actual: result.actual,
        weight: result.weight,
        matched: result.matched,
        score: result.score,
        reason: result.reason
      }))
    }))
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isMeaningfulText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMeaningfulResourceId(value: string | undefined): value is string {
  if (!isMeaningfulText(value)) {
    return false;
  }
  return value !== "android:id/content" && !value.endsWith(":id/action_bar_root") && !value.endsWith(":id/content_frame");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function summarizeActionPolicy(policy: ExecutionPlanStep["selectedActionPolicy"]): Record<string, unknown> | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    id: policy.id,
    priority: policy.priority,
    fallback: policy.fallback,
    reliabilityHint: policy.reliabilityHint,
    action: {
      id: policy.action.id,
      type: policy.action.type,
      title: policy.action.title,
      params: policy.action.params,
      timing: policy.action.timing,
      coordinate: policy.action.coordinate
    }
  };
}

function recoveryReasonForStep(step: GraphExecutionResult["steps"][number]): string | undefined {
  if (typeof step.recoveryAttempt !== "number") {
    return undefined;
  }
  if (step.recoveryReasonDeviationId) {
    return `状态偏离后重规划，来源偏离 ${step.recoveryReasonDeviationId}`;
  }
  return "下游目标失败，返回候选入口页面尝试下一个候选";
}

function classifyRuntimeStartState(input: { match: NodeMatchResult; inTargetApp: boolean }): RuntimeStartStateReason {
  if (!input.inTargetApp) {
    return "outside_target_app";
  }
  if (input.match.status === "matched") {
    if (isBlockingStateNode(input.match.node)) {
      return "blocking_state";
    }
    if (isLoginRequiredNode(input.match.node)) {
      return "login_required";
    }
    return "matched_graph_node";
  }
  if (input.match.status === "multiple_candidates") {
    return "multiple_candidates";
  }
  const hasLowConfidenceCandidate = input.match.candidates.some((candidate) => candidate.score >= input.match.threshold && candidate.quality.status === "low_confidence");
  return hasLowConfidenceCandidate ? "low_confidence_graph_state" : "unknown_app_state";
}

function runtimeInterceptorStepToAction(action: ActionStep): DeviceActionRequest {
  if ((action.type === "tap_on_text" || action.type === "tap_on_element") && action.coordinate && typeof action.coordinate.x === "number" && typeof action.coordinate.y === "number") {
    return {
      type: "tap",
      x: action.coordinate.x,
      y: action.coordinate.y
    };
  }
  return stepToAction(action);
}

function shouldRecordMatchedStartState(reason: RuntimeStartStateReason): boolean {
  return reason === "login_required" || reason === "blocking_state";
}

function isLoginRequiredNode(node: NodeMatchResult["node"]): boolean {
  return hasAnyNodeTag(node, ["auth:login_required", "login_required", "requires_login", "unauthenticated"]);
}

function isBlockingStateNode(node: NodeMatchResult["node"]): boolean {
  return hasAnyNodeTag(node, ["runtime:blocking", "blocking_state", "blocking", "blocker"]);
}

function hasAnyNodeTag(node: NodeMatchResult["node"], tags: string[]): boolean {
  if (!node) {
    return false;
  }
  const normalized = new Set(node.tags.map((tag) => tag.trim().toLowerCase()));
  return tags.some((tag) => normalized.has(tag));
}

function validateRuntimeOverlayTarget(overlay: RuntimeOverlay | undefined, targetNodeId: string): void {
  if (overlay?.targetNodeId && overlay.targetNodeId !== targetNodeId) {
    throw new Error(`RuntimeOverlay targetNodeId ${overlay.targetNodeId} does not match requested target node ${targetNodeId}`);
  }
}

function appendInterceptorRecords(existing: unknown, records: RuntimeInterceptorRecord[], phase: "precondition" | "state_transition"): Array<RuntimeInterceptorRecord & { phase: string }> | undefined {
  const previous = Array.isArray(existing) ? existing : [];
  const next = records.map((record) => ({
    ...record,
    phase
  }));
  const merged = [...previous, ...next];
  return merged.length ? merged : undefined;
}

function readGraphMetadata(metadata: StepResult["metadata"]): { graph?: Record<string, any> } {
  if (metadata && typeof metadata === "object" && "graph" in metadata && typeof metadata.graph === "object" && metadata.graph !== null) {
    return metadata as { graph?: Record<string, any> };
  }
  return {};
}

function normalizeRuntimeExecutionPlan(executionPlan: GraphExecutionPlan, executionProfile: RunConfig["executionProfile"] | undefined): GraphExecutionPlan {
  if (executionProfile !== "fast_visual") {
    return executionPlan;
  }
  return {
    ...executionPlan,
    steps: executionPlan.steps.map((step) => ({
      ...step,
      preconditions: []
    })),
    assumptions: [
      ...executionPlan.assumptions,
      "Fast visual PageStateFlow treats the matched source page as the precondition and skips duplicated edge precondition assertions."
    ]
  };
}

function platformFromTargetApp(targetApp: GraphTargetApp | undefined): "android" | "ios" | undefined {
  if (targetApp?.androidPackageName) {
    return "android";
  }
  if (targetApp?.iosBundleId) {
    return "ios";
  }
  return undefined;
}

function rootNodeId(graphVersion: BusinessGraphVersion, platform: "android" | "ios"): string | undefined {
  return graphVersion.nodes.find((node) => node.status === "active" && node.nodeType === "root" && supportsNodePlatform(node.platformScope, platform))?.id;
}

function supportsNodePlatform(scope: BusinessGraphVersion["nodes"][number]["platformScope"], platform: "android" | "ios"): boolean {
  return !scope || scope === "mobile-both" || scope === platform;
}

function appendUniqueRouteIssues(existing: RoutePlanIssue[], additions: RoutePlanIssue[]): RoutePlanIssue[] {
  const seen = new Set(existing.map(routeIssueKey));
  const next = [...existing];
  for (const issue of additions) {
    const key = routeIssueKey(issue);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(issue);
    }
  }
  return next;
}

function routeIssueKey(issue: RoutePlanIssue): string {
  return [issue.code, issue.nodeId ?? "", issue.edgeId ?? "", issue.message].join("|");
}

type StoredPageTask = {
  id: string;
  name: string;
  status?: "active" | "draft" | "deprecated";
  steps: StoredPageTaskStep[];
};

type StoredPageTaskStep = {
  id: string;
  order?: number;
  elementId?: string;
  fieldType?: "text_input" | "picker_select" | "toggle_set" | "subpage_edit" | "submit" | "tap" | "wait";
  valueParamKey?: string;
  desiredStateParamKey?: string;
  label?: string;
  text?: string;
};

type StoredManualPageElement = {
  id?: string;
  label?: string;
  targetText?: string;
  locator?: string;
  actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  region?: { x: number; y: number; width: number; height: number };
  tapPointPercent?: { x: number; y: number };
  quality?: Record<string, unknown>;
  visualLocator?: Record<string, unknown>;
  locatorKind?: string;
  anchorText?: string;
  anchorOffsetPercent?: Record<string, unknown>;
  role?: string;
  slot?: string;
  orderFromRight?: number;
  dynamicMasks?: Record<string, unknown>[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegionId?: string;
  itemTemplateId?: string;
  transitionKind?: string;
  parameterMapping?: Record<string, unknown>;
};

function appendSourcePageTaskNavigationSteps(executionPlan: GraphExecutionPlan, graphVersion: BusinessGraphVersion, overlay: RuntimeOverlay | undefined): GraphExecutionPlan {
  const runtimeParams = normalizeOverlayRuntimeParams(overlay?.runtimeParams);
  const steps = executionPlan.steps.flatMap((step) => {
    const taskId = sourceNavigationTaskId(step);
    if (!taskId) {
      return [step];
    }
    const task = readStoredPageTasks(step.fromNode.metadata).find((item) => item.id === taskId && item.status !== "deprecated");
    if (!task) {
      return [
        {
          ...step,
          issues: [
            ...step.issues,
            {
              code: "TARGET_NODE_NOT_FOUND" as const,
              severity: "error" as const,
              message: `Source page task not found: ${taskId}`,
              nodeId: step.fromNode.id,
              edgeId: step.edgeId
            }
          ],
          executionMode: "blocked" as const
        }
      ];
    }
    const manualElements = readStoredManualElements(step.fromNode.metadata);
    const taskSteps = task.steps
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))
      .map((taskStep, index, sortedSteps) => pageTaskExecutionStep({
        executionPlan,
        targetNode: index === sortedSteps.length - 1 ? step.toNode : step.fromNode,
        sourceNode: step.fromNode,
        task,
        taskStep,
        element: manualElements.find((element) => element.id === taskStep.elementId),
        runtimeParams,
        order: step.order + index,
        edgeContext: step,
        isNavigationSubmitStep: index === sortedSteps.length - 1
      }))
      .filter((item): item is ExecutionPlanStep => Boolean(item));
    return taskSteps.length ? taskSteps : [step];
  }).map((step, index) => ({ ...step, order: index + 1 }));
  if (steps.length === executionPlan.steps.length && steps.every((step, index) => step === executionPlan.steps[index])) {
    return executionPlan;
  }
  return {
    ...executionPlan,
    steps,
    assumptions: [...executionPlan.assumptions, "Source PageTask navigation edges are expanded into page task execution steps."],
    snapshot: {
      ...executionPlan.snapshot,
      nodeIds: uniqueStrings([...executionPlan.snapshot.nodeIds, ...steps.flatMap((step) => [step.fromNode.id, step.toNode.id])]),
      edgeIds: uniqueStrings([...executionPlan.snapshot.edgeIds, ...steps.map((step) => step.edgeId)]),
      actionIds: uniqueStrings([...executionPlan.snapshot.actionIds, ...steps.flatMap((step) => step.action?.id ? [step.action.id] : [])])
    }
  };
}

function sourceNavigationTaskId(step: ExecutionPlanStep): string | undefined {
  const params = step.action?.params;
  return params ? sourceNavigationTaskIdFromParams(params) : undefined;
}

function sourceNavigationTaskIdFromParams(params: Record<string, unknown>): string | undefined {
  if (params.taskMode !== "source_page_navigation") {
    return undefined;
  }
  return stringParam(params.taskId);
}

function appendTargetPageTaskSteps(executionPlan: GraphExecutionPlan, graphVersion: BusinessGraphVersion, overlay: RuntimeOverlay | undefined): GraphExecutionPlan {
  const targetTaskId = overlay?.targetTaskId?.trim();
  if (!targetTaskId) {
    return executionPlan;
  }
  const targetNode = graphVersion.nodes.find((node) => node.id === executionPlan.targetNodeId);
  const task = readStoredPageTasks(targetNode?.metadata).find((item) => item.id === targetTaskId && item.status !== "deprecated");
  if (!targetNode || !task) {
    return {
      ...executionPlan,
      unresolvedIssues: [
        ...executionPlan.unresolvedIssues,
        {
          code: "TARGET_NODE_NOT_FOUND",
          severity: "error",
          message: `Target page task not found: ${targetTaskId}`,
          nodeId: executionPlan.targetNodeId
        }
      ]
    };
  }
  const manualElements = readStoredManualElements(targetNode.metadata);
  const runtimeParams = normalizeOverlayRuntimeParams(overlay?.runtimeParams);
  const navigationEdge = findPageTaskNavigationEdge(graphVersion, targetNode.id, targetTaskId);
  const navigationTargetNode = navigationEdge ? graphVersion.nodes.find((node) => node.id === navigationEdge.toNodeId) : undefined;
  const taskSteps = task.steps
    .slice()
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id))
    .map((taskStep, index, sortedSteps) => {
      const isNavigationSubmitStep = Boolean(navigationEdge && navigationTargetNode && index === sortedSteps.length - 1);
      return pageTaskExecutionStep({
      executionPlan,
      targetNode: isNavigationSubmitStep ? navigationTargetNode! : targetNode,
      sourceNode: targetNode,
      task,
      taskStep,
      element: manualElements.find((element) => element.id === taskStep.elementId),
      runtimeParams,
      order: executionPlan.steps.length + index + 1,
      edgeContext: navigationEdge && navigationTargetNode ? pageTaskNavigationEdgeContext(executionPlan, targetNode, navigationTargetNode, navigationEdge, index) : undefined,
      isNavigationSubmitStep
      });
    })
    .filter((step): step is ExecutionPlanStep => Boolean(step));
  if (!taskSteps.length) {
    return executionPlan;
  }
  return {
    ...executionPlan,
    steps: [...executionPlan.steps, ...taskSteps],
    assumptions: [
      ...executionPlan.assumptions,
      navigationEdge ? `PageTask "${task.name}" is appended after reaching the target page and inherits navigation edge "${navigationEdge.name}".` : `PageTask "${task.name}" is appended after reaching the target page.`
    ],
    snapshot: {
      ...executionPlan.snapshot,
      nodeIds: uniqueStrings([...executionPlan.snapshot.nodeIds, targetNode.id, ...taskSteps.flatMap((step) => [step.fromNode.id, step.toNode.id])]),
      edgeIds: uniqueStrings([...executionPlan.snapshot.edgeIds, ...taskSteps.map((step) => step.edgeId)]),
      actionIds: [...executionPlan.snapshot.actionIds, ...taskSteps.flatMap((step) => step.action?.id ? [step.action.id] : [])]
    }
  };
}

function findPageTaskNavigationEdge(graphVersion: BusinessGraphVersion, fromNodeId: string, taskId: string): OperationEdge | undefined {
  return graphVersion.edges.find((edge) =>
    edge.status !== "deprecated" &&
    edge.fromNodeId === fromNodeId &&
    edge.actionPolicies.some((policy) => sourceNavigationTaskIdFromParams(policy.action.params) === taskId)
  );
}

function pageTaskNavigationEdgeContext(
  executionPlan: GraphExecutionPlan,
  fromNode: BusinessNode,
  toNode: BusinessNode,
  edge: OperationEdge,
  index: number
): ExecutionPlanStep {
  const actionPolicy = edge.actionPolicies.find((policy) => sourceNavigationTaskIdFromParams(policy.action.params)) ?? edge.actionPolicies[0];
  return {
    id: `execution_step_${edge.id}_target_page_task_context_${index}`,
    order: executionPlan.steps.length + index + 1,
    edgeId: edge.id,
    edgeKey: edge.key,
    name: edge.name,
    intent: edge.intent,
    fromNode,
    toNode,
    preconditions: edge.preconditions,
    selectedActionPolicy: actionPolicy,
    action: actionPolicy?.action,
    fallbackActionPolicies: edge.actionPolicies.filter((policy) => policy.id !== actionPolicy?.id),
    expectations: edge.expectations,
    systemGuards: [],
    failurePolicy: edge.failurePolicy,
    executionMode: actionPolicy ? "action" : "blocked",
    issues: [],
    runtimeOverlay: {
      id: executionPlan.steps.at(-1)?.runtimeOverlay?.id,
      note: executionPlan.steps.at(-1)?.runtimeOverlay?.note,
      targetExpectationIds: [],
      edgeExpectationIds: edge.expectations.map((expectation) => expectation.id)
    }
  };
}

function pageTaskExecutionStep(input: {
  executionPlan: GraphExecutionPlan;
  targetNode: BusinessNode;
  sourceNode?: BusinessNode;
  task: StoredPageTask;
  taskStep: StoredPageTaskStep;
  element?: StoredManualPageElement;
  runtimeParams: Record<string, string>;
  order: number;
  edgeContext?: ExecutionPlanStep;
  isNavigationSubmitStep?: boolean;
}): ExecutionPlanStep | undefined {
  const action = pageTaskAction(input.task, input.taskStep, input.element, input.runtimeParams, input.order);
  if (!action) {
    return undefined;
  }
  const actionPolicy: ActionPolicy = {
    id: `${action.id}-policy`,
    priority: 1,
    action,
    fallback: false,
    reliabilityHint: "high",
    source: {
      sourceType: "manual_edit",
      confidence: 0.9
    }
  };
  const edgeId = input.edgeContext ? `${input.edgeContext.edgeId}__page_task_${slug(input.taskStep.id)}` : `page_task_${slug(input.task.id)}_${slug(input.taskStep.id)}`;
  const fromNode = input.sourceNode ?? input.targetNode;
  const toNode = input.isNavigationSubmitStep ? input.targetNode : fromNode;
  return {
    id: `execution_step_${edgeId}`,
    order: input.order,
    edgeId,
    edgeKey: input.edgeContext ? `${input.edgeContext.edgeKey}.page-task.${slug(input.taskStep.id)}` : `page-task.${slug(input.task.id)}.${slug(input.taskStep.id)}`,
    name: `${input.task.name}：${input.taskStep.label ?? input.element?.label ?? input.taskStep.fieldType ?? input.taskStep.id}`,
    intent: `执行页面任务：${input.task.name}`,
    fromNode,
    toNode,
    preconditions: [],
    selectedActionPolicy: actionPolicy,
    action,
    fallbackActionPolicies: [],
    expectations: input.isNavigationSubmitStep ? input.edgeContext?.expectations ?? [] : [],
    systemGuards: [],
    failurePolicy: input.isNavigationSubmitStep ? input.edgeContext?.failurePolicy ?? {
      retryCount: 1,
      recoverTo: "replan"
    } : {
      retryCount: 1,
      recoverTo: "replan"
    },
    executionMode: "action",
    issues: [],
    runtimeOverlay: {
      id: input.edgeContext?.runtimeOverlay?.id ?? input.executionPlan.steps.at(-1)?.runtimeOverlay?.id,
      note: input.edgeContext?.runtimeOverlay?.note ?? input.executionPlan.steps.at(-1)?.runtimeOverlay?.note,
      targetExpectationIds: [],
      edgeExpectationIds: [],
      runtimeParamKeys: Object.keys(input.runtimeParams).sort(),
      pageTaskId: input.task.id,
      pageTaskName: input.task.name,
      pageTaskStepId: input.taskStep.id,
      pageTaskStepName: input.taskStep.label ?? input.element?.label
    }
  };
}

function pageTaskAction(
  task: StoredPageTask,
  taskStep: StoredPageTaskStep,
  element: StoredManualPageElement | undefined,
  runtimeParams: Record<string, string>,
  order: number
): ActionStep | undefined {
  const createdAt = nowIso();
  const label = taskStep.label ?? element?.label ?? taskStep.fieldType ?? taskStep.id;
  const baseParams = element ? manualElementActionParams(element) : {};
  const taskParams = pageTaskActionParams(taskStep, runtimeParams, label);
  const stateValidationParams = taskStep.fieldType === "submit" ? {} : { skipStateTransitionValidation: true };
  if (taskStep.fieldType === "text_input") {
    const text = runtimeParamValue(runtimeParams, taskStep.valueParamKey) ?? taskStep.text ?? "";
    if (!text) {
      return undefined;
    }
    return {
      id: `page_task_action_${slug(task.id)}_${slug(taskStep.id)}`,
      order,
      type: "input_text_to_element",
      enabled: true,
      title: label,
      params: {
        ...baseParams,
        ...taskParams,
        ...stateValidationParams,
        text,
        clearFirst: true,
        elementLabel: label
      },
      createdAt
    };
  }
  if (taskStep.fieldType === "wait") {
    const expected = taskStep.text ?? runtimeParamValue(runtimeParams, taskStep.valueParamKey);
    if (!expected) {
      return undefined;
    }
    return {
      id: `page_task_action_${slug(task.id)}_${slug(taskStep.id)}`,
      order,
      type: "wait_until_state",
      enabled: true,
      title: label,
      params: {
        ...stateValidationParams,
        text: expected,
        timeoutMs: 3000,
        intervalMs: 250
      },
      createdAt
    };
  }
  if (taskStep.fieldType === "picker_select" && !taskParams.selectedValue) {
    return undefined;
  }
  if (taskStep.fieldType === "toggle_set" && !taskParams.desiredState) {
    return undefined;
  }
  if (taskStep.fieldType === "subpage_edit" && !taskStep.text && !(taskStep.valueParamKey && runtimeParamValue(runtimeParams, taskStep.valueParamKey))) {
    return undefined;
  }
  return {
    id: `page_task_action_${slug(task.id)}_${slug(taskStep.id)}`,
    order,
    type: actionTypeForManualElement(element),
    enabled: true,
    title: label,
    params: {
      ...baseParams,
      ...taskParams,
      ...stateValidationParams,
      elementLabel: label
    },
    createdAt
  };
}

function pageTaskActionParams(taskStep: StoredPageTaskStep, runtimeParams: Record<string, string>, label: string): Record<string, unknown> {
  const params: Record<string, unknown> = {
    fieldType: taskStep.fieldType ?? "tap",
    pageTaskStepLabel: label
  };
  if (taskStep.valueParamKey) {
    params.valueParamKey = taskStep.valueParamKey;
  }
  if (taskStep.desiredStateParamKey) {
    params.desiredStateParamKey = taskStep.desiredStateParamKey;
  }
  const selectedValue = runtimeParamValue(runtimeParams, taskStep.valueParamKey) ?? taskStep.text;
  if (taskStep.fieldType === "picker_select" && selectedValue) {
    params.selectedValue = selectedValue;
  }
  const desiredState = runtimeParamValue(runtimeParams, taskStep.desiredStateParamKey) ?? taskStep.text;
  if (taskStep.fieldType === "toggle_set" && desiredState) {
    params.desiredState = desiredState;
  }
  if (taskStep.fieldType === "subpage_edit") {
    params.subpageEdit = true;
  }
  return params;
}

function manualElementActionParams(element: StoredManualPageElement): Record<string, unknown> {
  const region = element.region ?? parseImageRegionLocator(element.locator);
  if (element.locatorKind === "top_bar_icon_locator" || element.locator?.startsWith("top-bar-icon:")) {
    return {
      locator: element.locator,
      locatorKind: element.locatorKind ?? "top_bar_icon_locator",
      semanticArea: element.semanticArea ?? "top",
      coordinateSpace: element.coordinateSpace ?? "runtime",
      ...(element.targetText ? { targetText: element.targetText } : {}),
      ...(element.anchorText ? { anchorText: element.anchorText } : {}),
      ...(element.role ? { role: element.role } : {}),
      ...(element.slot ? { slot: element.slot } : {}),
      ...(typeof element.orderFromRight === "number" ? { orderFromRight: element.orderFromRight } : {}),
      ...(element.quality ? { quality: element.quality } : {}),
      ...(element.visualLocator ? { visualLocator: element.visualLocator } : {}),
      ...(element.dynamicMasks?.length ? { dynamicMasks: element.dynamicMasks } : {}),
      ...(element.transitionKind ? { transitionKind: element.transitionKind } : {}),
      ...(element.parameterMapping ? { parameterMapping: element.parameterMapping } : {})
    };
  }
  if (element.locatorKind === "ocr_anchor_offset") {
    return {
      locator: element.locator,
      locatorKind: element.locatorKind,
      semanticArea: element.semanticArea ?? "top",
      coordinateSpace: element.coordinateSpace ?? "screen",
      ...(element.targetText ? { targetText: element.targetText } : {}),
      ...(element.anchorText ? { anchorText: element.anchorText } : {}),
      ...(element.anchorOffsetPercent ? { anchorOffsetPercent: element.anchorOffsetPercent } : {})
    };
  }
  if (element.locator?.startsWith("runtime-locator:")) {
    return {
      locator: element.locator,
      semanticArea: element.semanticArea ?? "content",
      coordinateSpace: element.coordinateSpace ?? "runtime",
      ...(element.targetText ? { targetText: element.targetText } : {}),
      ...(element.quality ? { quality: element.quality } : {}),
      ...(element.locatorKind ? { locatorKind: element.locatorKind } : {}),
      ...(element.dynamicMasks?.length ? { dynamicMasks: element.dynamicMasks } : {}),
      ...(element.structuralLocator ? { structuralLocator: element.structuralLocator } : {}),
      ...(element.dynamicRegionId ? { dynamicRegionId: element.dynamicRegionId } : {}),
      ...(element.itemTemplateId ? { itemTemplateId: element.itemTemplateId } : {}),
      ...(element.transitionKind ? { transitionKind: element.transitionKind } : {}),
      ...(element.parameterMapping ? { parameterMapping: element.parameterMapping } : {})
    };
  }
  if (region) {
    return {
      region,
      targetMode: "image_region",
      locator: element.locator,
      semanticArea: element.semanticArea ?? semanticAreaForPercentRegion(region),
      coordinateSpace: element.coordinateSpace ?? "screen",
      ...(element.tapPointPercent ? { tapPointPercent: element.tapPointPercent } : {}),
      ...(element.targetText ? { targetText: element.targetText } : {}),
      ...(element.quality ? { quality: element.quality } : {}),
      ...(element.visualLocator ? { visualLocator: element.visualLocator } : {}),
      ...(element.locatorKind ? { locatorKind: element.locatorKind } : {}),
      ...(element.dynamicMasks?.length ? { dynamicMasks: element.dynamicMasks } : {}),
      ...(element.structuralLocator ? { structuralLocator: element.structuralLocator } : {}),
      ...(element.dynamicRegionId ? { dynamicRegionId: element.dynamicRegionId } : {}),
      ...(element.itemTemplateId ? { itemTemplateId: element.itemTemplateId } : {}),
      ...(element.transitionKind ? { transitionKind: element.transitionKind } : {}),
      ...(element.parameterMapping ? { parameterMapping: element.parameterMapping } : {})
    };
  }
  if (element.locator?.startsWith("text:")) {
    return { text: element.locator.replace(/^text:\s*/, "").trim() };
  }
  return {
    locator: element.locator
  };
}

function actionTypeForManualElement(element: StoredManualPageElement | undefined): ActionStep["type"] {
  if (!element) {
    return "wait";
  }
  if (element.actionKind === "long_press") {
    return "long_press";
  }
  if (element.actionKind === "scroll") {
    return "scroll_until_visible";
  }
  if (element.actionKind === "input") {
    return "input_text_to_element";
  }
  if (element.locator?.startsWith("runtime-locator:")) {
    return "tap_on_image";
  }
  if (element.locatorKind === "ocr_anchor_offset" || element.locatorKind === "top_bar_icon_locator" || element.locator?.startsWith("top-bar-icon:")) {
    return "tap_on_image";
  }
  if (element.locator?.startsWith("image-region:") || element.region) {
    return "tap_on_image";
  }
  if (element.locator?.startsWith("text:")) {
    return "tap_on_text";
  }
  return "tap_on_element";
}

function readStoredPageTasks(metadata: Record<string, unknown> | undefined): StoredPageTask[] {
  const value = metadata?.assetRecordingPageTasks;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): StoredPageTask | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const id = stringParam(record.id);
      const name = stringParam(record.name);
      if (!id || !name || !Array.isArray(record.steps)) {
        return undefined;
      }
      return {
        id,
        name,
        status: record.status === "draft" || record.status === "deprecated" ? record.status : "active",
        steps: record.steps.map(readStoredPageTaskStep).filter((step): step is StoredPageTaskStep => Boolean(step))
      };
    })
    .filter((item): item is StoredPageTask => Boolean(item));
}

function readStoredPageTaskStep(value: unknown): StoredPageTaskStep | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = stringParam(record.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    order: typeof record.order === "number" && Number.isFinite(record.order) ? record.order : undefined,
    elementId: stringParam(record.elementId),
    fieldType: readPageTaskFieldType(record.fieldType),
    valueParamKey: stringParam(record.valueParamKey),
    desiredStateParamKey: stringParam(record.desiredStateParamKey),
    label: stringParam(record.label),
    text: stringParam(record.text)
  };
}

function readStoredManualElements(metadata: Record<string, unknown> | undefined): StoredManualPageElement[] {
  const value = metadata?.assetRecordingManualElements;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): StoredManualPageElement | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const locator = stringParam(record.locator);
      const id = stringParam(record.id);
      if (!id && !locator) {
        return undefined;
      }
      return {
        id,
        label: stringParam(record.label),
        targetText: stringParam(record.targetText),
        locator,
        actionKind: readStoredActionKind(record.actionKind),
        semanticArea: readStoredSemanticArea(record.semanticArea),
        coordinateSpace: readStoredCoordinateSpace(record.coordinateSpace),
        region: readStoredRect(record.region) ?? parseImageRegionLocator(locator),
        tapPointPercent: readStoredPointPercent(record.tapPointPercent),
        quality: readStoredRecord(record.quality),
        visualLocator: readStoredRecord(record.visualLocator),
        locatorKind: stringParam(record.locatorKind),
        anchorText: stringParam(record.anchorText),
        anchorOffsetPercent: readStoredRecord(record.anchorOffsetPercent),
        role: stringParam(record.role),
        slot: stringParam(record.slot),
        orderFromRight: numberParam(record.orderFromRight),
        dynamicMasks: readStoredRecordArray(record.dynamicMasks),
        structuralLocator: readStoredRecord(record.structuralLocator),
        dynamicRegionId: stringParam(record.dynamicRegionId),
        itemTemplateId: stringParam(record.itemTemplateId),
        transitionKind: stringParam(record.transitionKind),
        parameterMapping: readStoredRecord(record.parameterMapping)
      };
    })
    .filter((item): item is StoredManualPageElement => Boolean(item));
}

function readPageTaskFieldType(value: unknown): StoredPageTaskStep["fieldType"] {
  return value === "text_input" ||
    value === "picker_select" ||
    value === "toggle_set" ||
    value === "subpage_edit" ||
    value === "submit" ||
    value === "tap" ||
    value === "wait"
    ? value
    : "tap";
}

function readStoredActionKind(value: unknown): StoredManualPageElement["actionKind"] {
  return value === "scroll" || value === "long_press" || value === "input" || value === "unknown" ? value : "tap";
}

function readStoredSemanticArea(value: unknown): StoredManualPageElement["semanticArea"] {
  return value === "top" || value === "content" || value === "bottom" || value === "unknown" ? value : undefined;
}

function readStoredCoordinateSpace(value: unknown): StoredManualPageElement["coordinateSpace"] {
  return value === "screen" || value === "app_viewport" || value === "region" || value === "runtime" ? value : undefined;
}

function readStoredRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readStoredRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return records.length ? records : undefined;
}

function readStoredRect(value: unknown): StoredManualPageElement["region"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = numberParam(record.x);
  const y = numberParam(record.y);
  const width = numberParam(record.width);
  const height = numberParam(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function readStoredPointPercent(value: unknown): StoredManualPageElement["tapPointPercent"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = numberParam(record.x);
  const y = numberParam(record.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y))
  };
}

function parseImageRegionLocator(locator: string | undefined): StoredManualPageElement["region"] {
  if (!locator?.startsWith("image-region:")) {
    return undefined;
  }
  const [x, y, width, height] = locator
    .replace(/^image-region:\s*/, "")
    .split(",")
    .map((value) => Number(value.trim()));
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function semanticAreaForPercentRegion(region: { y: number; height: number }): "top" | "content" | "bottom" {
  const centerY = region.y + region.height / 2;
  if (centerY <= 18) {
    return "top";
  }
  if (centerY >= 82) {
    return "bottom";
  }
  return "content";
}

function numberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOverlayRuntimeParams(value: RuntimeOverlay["runtimeParams"]): Record<string, string> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, paramValue]) => [key.trim(), String(paramValue).trim()] as const)
      .filter(([key, paramValue]) => key.length > 0 && paramValue.length > 0)
  );
}

function runtimeParamValue(runtimeParams: Record<string, string>, key: string | undefined): string | undefined {
  return key ? runtimeParams[key] : undefined;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, ".")
    .replace(/^\.+|\.+$/g, "") || "unknown";
}

function isObservationInTargetApp(observation: Observation, targetApp: GraphTargetApp | undefined, platform: "android" | "ios"): boolean {
  if (platform === "android") {
    const packageName = targetApp?.androidPackageName;
    if (!packageName) {
      return true;
    }
    return observation.packageName === packageName || observation.componentName?.startsWith(`${packageName}/`) === true;
  }
  const bundleId = targetApp?.iosBundleId;
  if (!bundleId) {
    return true;
  }
  return observation.bundleId === bundleId || observation.packageName === bundleId;
}

function isObservationInRunScope(
  observation: Observation,
  targetApp: GraphTargetApp | undefined,
  platform: "android" | "ios",
  startAppScope: StartAppScope | undefined
): boolean {
  if (startAppScope === "current_device") {
    return true;
  }
  return isObservationInTargetApp(observation, targetApp, platform);
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRunnerStoppedError(error: unknown): boolean {
  return error instanceof Error && error.name === "RunnerStoppedError";
}

function graphObservationProfile(executionProfile: RunConfig["executionProfile"] | undefined): { includeUiTree: boolean } {
  return {
    includeUiTree: executionProfile !== "fast_visual"
  };
}

function isSemanticAction(action: ActionStep): boolean {
  return action.type === "tap_on_text" || action.type === "tap_on_element" || action.type === "tap_on_image" || action.type === "input_text_to_element" || action.type === "scroll_until_visible";
}

function compoundActionStepsFor(action: ActionStep): ActionStep[] {
  const value = action.params.compoundSteps;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isActionStepLike);
}

function isActionStepLike(value: unknown): value is ActionStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const input = value as Partial<ActionStep>;
  return typeof input.id === "string" && typeof input.type === "string" && typeof input.order === "number" && input.params !== undefined && typeof input.params === "object";
}

function observationTextSnapshot(observation: Observation): string {
  return uniqueStrings([
    ...observation.uiElements.map((element) => element.text),
    ...observation.uiElements.map((element) => element.contentDesc),
    ...observation.uiElements.map((element) => element.accessibilityId),
    ...observation.ocrTexts.map((text) => text.text)
  ]).join("\n");
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function actionWithGridCandidateAttempt(action: ActionStep, _recoveryAttempt?: number): ActionStep {
  return action;
}

function latestFailedStep(steps: StepResult[]): StepResult | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && (step.status === "failed" || step.status === "timeout")) {
      return step;
    }
  }
  return undefined;
}

function latestErrorEvent(events: DeviceEvent[]): DeviceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.severity === "error") {
      return event;
    }
  }
  return undefined;
}

function graphString(step: StepResult | undefined, key: string): string | undefined {
  const graph = readRecord(step?.metadata?.graph);
  const value = graph?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function aiDiagnosisSeverity(diagnosis: AiDiagnosisResult): DeviceEvent["severity"] {
  if (diagnosis.classification === "app_issue" || diagnosis.classification === "environment_issue") {
    return "error";
  }
  return "warning";
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
