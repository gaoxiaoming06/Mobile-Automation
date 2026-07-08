import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type FlowStartStrategy,
  type Platform,
  type RunMode,
  type StepExpectation,
  type StepExpectationResult,
  type StepResult,
  type StructuredFlow,
  type TestRun
} from "@mobile-automation/shared";
import { renderReportHtml } from "@mobile-automation/report-core";
import {
  buildExecutionPlan,
  detectNode,
  planRoute,
  resolveTargetNode,
  type BusinessGraphVersion,
  type GraphTargetApp,
  type Observation,
  type RouteStrategy,
  type RuntimeOverlay,
  type TargetNodeQuery
} from "@mobile-automation/graph-core";
import { defaultSourceScanMaxFiles, maxSourceScanMaxFiles, scanAndroidSource } from "@mobile-automation/source-scanner";
import { WebSocketServer } from "ws";
import { ArtifactCleanupScheduler } from "./artifact-cleanup.js";
import { AutomationRunner, DeviceBusyError } from "./automation-runner.js";
import { artifactFilePath, artifactRoot, artifactSendFileOptions, artifactUrl } from "./artifacts.js";
import { seedBuiltinCases } from "./builtin-cases.js";
import { seedBuiltinGraphs } from "./builtin-graphs.js";
import { buildConfirmedPageAssetInput, identifyOrCreateCurrentPageDraft } from "./current-page-asset.js";
import { buildGraphAssetGovernanceSummary, selectAutoPromotableGraphAssets } from "./graph-assets.js";
import { buildNodeTestResult, collectGraphStepRecords, isGraphRun as isGraphRunResult, readStepGraphMetadata, type GraphStepResultItem, type NodeTestResult } from "./graph-node-test-result.js";
import { pageAbilityRouteGapIssues, withPageAbilityEdges } from "./page-ability-edges.js";
import { createVisualLocatorTemplate } from "./page-matcher.js";
import {
  candidateActionForObservation,
  classifyExplorationResult,
  createAutoExploreReport,
  generateExplorationCandidates,
  type AutoExploreCandidate,
  type AutoExploreCandidateResult
} from "./auto-explorer.js";
import { GraphDeviceBusyError, GraphRunService, GraphTargetResolutionError } from "./graph-run-service.js";
import { buildGraphQualitySummary } from "./graph-quality.js";
import { importLegacyCaseAsDraftGraph } from "./legacy-case-graph.js";
import { scaleLocatorCoordinate } from "./locator-coordinate.js";
import { MobileDriver } from "./mobile-driver.js";
import {
  deleteManualPageTransitionAsset,
  deleteManualPageElementAsset,
  persistManualPageElementAsset,
  persistManualPageTransitionAsset,
  persistPageTaskNavigationTransitionAsset,
  type ManualPageTransitionActionKind,
  type ManualPageTransitionAvailability,
  type ManualPageAbilityType,
  type ManualDynamicRegion,
  type ManualItemTemplate,
  type ManualPageElementDynamicMask,
  type ManualPageElementLocatorKind,
  type ManualPageTransitionCompoundStep,
  type ManualPageTransitionOutcomeType,
  type ManualPageTransitionScrollProfile
} from "./page-transition-assets.js";
import { validatePageElementAssetQuality, type PageElementQualityResult } from "./page-element-quality.js";
import {
  deletePageTaskAsset,
  persistPageTaskAsset,
  type PageTaskAssetStep,
  type PageTaskFieldType
} from "./page-task-assets.js";
import { ScrcpyStreamBridge } from "./scrcpy-stream.js";
import { Storage } from "./storage.js";
import { StructuredFlowRunner, type StartStructuredFlowRunInput } from "./structured-flow-runner.js";
import { orderedRunStopTargets, type RunStopTarget } from "./run-stop-routing.js";
import {
  AssetPatrol,
  AssetPatrolDeviceBusyError,
  assetPatrolStartActions,
  collectAssetRuntimeParamDefinitions,
  normalizeAssetPatrolConfig,
  selectAssetDrivenRecoveryTarget,
  selectAssetDrivenExecutionTargets,
  shouldAvoidBackRecovery,
  type AssetDrivenReadyExecutionTarget,
  type AssetPatrolPageScope,
  type AssetPatrolStartInput,
  type AssetPatrolStartMode
} from "./asset-patrol.js";
import {
  createAssetDrivenExecutionSession,
  markAssetDrivenExecutionItemStarted,
  skipPendingAssetDrivenExecutionItems,
  stopAssetDrivenExecutionSession,
  updateAssetDrivenExecutionItemFromRun,
  type AssetDrivenExecutionSession
} from "./asset-driven-execution-session.js";
import {
  previewAiDiagnosisSettingsUpdate,
  publicAiDiagnosisSettings,
  resolveAiDiagnosisConfig,
  type AiDiagnosisSettingsUpdateInput
} from "./ai-diagnosis.js";
import {
  StabilityExplorer,
  StabilityExplorerDeviceBusyError,
  type StabilityExplorerAllowedAction,
  type StabilityExplorerAppExitPolicy,
  type StabilityExplorerBacktrackStrategy,
  type StabilityExplorerStartInput,
  type StabilityExplorerStartMode,
  type StabilityExplorerStrategy
} from "./stability-explorer.js";
import { ensureRapidOcrSidecar } from "./ocr-sidecar.js";
import { createDefaultOcrService } from "./ocr.js";
import { ObservationService } from "./observation-service.js";
import { matchCurrentPage } from "./page-matcher.js";
import { RuntimeInterceptor, type RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { resolveRoutePlanStart, routePreviewBlockingIssue, summarizeRoutePlanStartDetection, type StartAppScope } from "./route-plan-preview.js";
import { persistRecordingStepGraphAsset } from "./recording-graph-assets.js";
import { resolveReachableStartNode } from "./start-node-recovery.js";
import { listSourceScanDirectories, listSourceScanRoots, pickSourceScanDirectory } from "./source-scan-roots.js";
import { findNearestTextCandidate } from "./semantic-locator.js";
import {
  findElementAtPointFromCandidates,
  hasStableLocator,
  hierarchySize,
  isRecordableElementCandidate,
  locatorFromCandidate,
  parseAndroidUiHierarchy,
  selectorFromLocator
} from "./ui-hierarchy-locator.js";

const port = Number(process.env.PORT ?? 4010);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDist = path.resolve(moduleDir, "../../dashboard/dist");
const dashboardIndex = path.join(dashboardDist, "index.html");
const app = express();
const storage = new Storage();
const driver = new MobileDriver();
const ocrSidecar = await ensureRapidOcrSidecar();
const ocr = createDefaultOcrService();
const runner = new AutomationRunner(storage, driver, ocr);
const flowRunner = new StructuredFlowRunner(storage, driver, ocr);
const graphRunner = new GraphRunService(storage, driver, ocr);
const stabilityExplorer = new StabilityExplorer(storage, driver, ocr);
const assetPatrol = new AssetPatrol(storage, driver, ocr, readPageAssetBaselineArtifact);
const observationService = new ObservationService(driver, ocr);
const scrcpyStreamBridge = new ScrcpyStreamBridge();
const artifactCleanupScheduler = new ArtifactCleanupScheduler(storage);
const activeAssetDrivenExecutionQueues = new Map<string, { runId: string; sessionId: string; cancelled?: boolean; promise: Promise<void> }>();
const assetDrivenExecutionSessions = new Map<string, AssetDrivenExecutionSession>();

await storage.ensureDirs();
const builtinCaseSeedResult = seedBuiltinCases(storage);
if (builtinCaseSeedResult.created > 0) {
  console.log(`Seeded ${builtinCaseSeedResult.created} built-in test case(s).`);
}
const builtinGraphSeedResult = seedBuiltinGraphs(storage);
if (builtinGraphSeedResult.created > 0) {
  console.log(`Seeded ${builtinGraphSeedResult.created} built-in business graph(s).`);
}
await runner.markStaleRunningRunsStopped("Server started with no active worker for this run.").catch((error) => {
  console.warn("Failed to mark stale runs stopped", error);
});
artifactCleanupScheduler.start();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/artifacts", express.static(artifactRoot, { fallthrough: false }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mobile-automation-server",
    artifactRoot
  });
});

app.get("/api/settings/ai-diagnosis", (_req, res) => {
  res.json({ settings: publicAiDiagnosisSettings(process.env, storage.getAiDiagnosisSettings()) });
});

app.put("/api/settings/ai-diagnosis", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const update = aiDiagnosisSettingsUpdateFromBody(body);
    const candidate = previewAiDiagnosisSettingsUpdate(storage.getAiDiagnosisSettings(), update);
    const resolved = resolveAiDiagnosisConfig(process.env, candidate);
    if (candidate.enabled && !resolved.enabled) {
      res.status(400).json({ error: "AI 诊断配置不完整，请填写接口地址和模型名；HTTP 接口还需要 API Key" });
      return;
    }
    const saved = storage.updateAiDiagnosisSettings(update);
    res.json({ settings: publicAiDiagnosisSettings(process.env, saved) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/system/tools", async (_req, res) => {
  try {
    res.json({ tools: await driver.getToolStatus() });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices", async (_req, res) => {
  try {
    const devices = await driver.listDevices();
    res.json({ devices });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices/:serial/screenshot", async (req, res) => {
  try {
    const force = parseBooleanQuery(req.query.force, false);
    if (!force && scrcpyStreamBridge.isSerialStreaming(req.params.serial)) {
      res.status(409).json({ error: "Embedded scrcpy stream is active; screenshot polling is paused." });
      return;
    }
    const png = await driver.screenshot(req.params.serial);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.send(png);
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices/:serial/apps/:packageName", async (req, res) => {
  try {
    if (!driver.getInstalledAppInfo) {
      res.status(501).json({ error: "Installed app version lookup is not supported" });
      return;
    }
    const packageName = decodeURIComponent(req.params.packageName).trim();
    if (!packageName) {
      res.status(400).json({ error: "packageName is required" });
      return;
    }
    const appInfo = await driver.getInstalledAppInfo(req.params.serial, packageName);
    res.json({ appInfo });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/scrcpy/sessions", (_req, res) => {
  res.json({ sessions: driver.listScrcpyControlSessions() });
});

app.post("/api/devices/:serial/scrcpy", async (req, res) => {
  try {
    const session = await driver.startScrcpyControl(req.params.serial);
    res.status(201).json({ session });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/devices/:serial/scrcpy", async (req, res) => {
  try {
    const stopped = await driver.stopScrcpyControl(req.params.serial);
    res.json({ stopped });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/devices/:serial/actions", async (req, res) => {
  try {
    const action = req.body as DeviceActionRequest;
    await driver.performAction(req.params.serial, action);
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/devices/:serial/locators/text-at", async (req, res) => {
  try {
    if (!ocr.locateText) {
      res.status(501).json({ error: "OCR text locator is unavailable" });
      return;
    }
    const body = req.body as { x?: number; y?: number; deviceWidth?: number; deviceHeight?: number; maxDistance?: number; lang?: string };
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      res.status(400).json({ error: "x and y are required" });
      return;
    }
    const png = await driver.screenshot(req.params.serial);
    const layout = await ocr.locateText({ image: png, lang: body.lang });
    const point = {
      x: scaleLocatorCoordinate(body.x!, body.deviceWidth, layout.width),
      y: scaleLocatorCoordinate(body.y!, body.deviceHeight, layout.height)
    };
    const candidate = findNearestTextCandidate(layout, point, positiveNumber(body.maxDistance, 140));
    res.json({
      candidate,
      text: layout.text,
      width: layout.width,
      height: layout.height,
      candidateCount: layout.boxes.length
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/devices/:serial/locators/element-at", async (req, res) => {
  try {
    const body = req.body as { x?: number; y?: number; deviceWidth?: number; deviceHeight?: number };
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      res.status(400).json({ error: "x and y are required" });
      return;
    }

    const device = await driver.getDeviceInfo(req.params.serial);
    if (device.platform !== "android") {
      res.status(501).json({ error: "Element locator is currently supported for Android only" });
      return;
    }

    const xml = await driver.dumpUiHierarchy(req.params.serial);
    const candidates = parseAndroidUiHierarchy(xml);
    const size = hierarchySize(candidates) ?? device.resolution;
    if (!size) {
      res.json({
        candidate: undefined,
        locator: undefined,
        reason: "hierarchy_size_unavailable",
        candidateCount: candidates.length
      });
      return;
    }

    const point = {
      x: scaleLocatorCoordinate(body.x!, body.deviceWidth, size.width),
      y: scaleLocatorCoordinate(body.y!, body.deviceHeight, size.height)
    };
    const recordableCandidates = candidates.filter((candidate) => isRecordableElementCandidate(candidate, size));
    const candidate = findElementAtPointFromCandidates(recordableCandidates, point);
    const locator = candidate ? locatorFromCandidate(candidate, recordableCandidates) : undefined;
    const stable = locator ? hasStableLocator(locator) : false;
    const responseCandidate = candidate && stable && locator ? { ...candidate, selector: selectorFromLocator(locator) } : candidate;
    res.json({
      candidate: responseCandidate,
      locator: stable ? locator : undefined,
      stable,
      width: size.width,
      height: size.height,
      candidateCount: candidates.length,
      reason: candidate ? (stable ? undefined : "unstable_locator") : "target_not_found"
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices/:serial/locators/element-snapshot", async (req, res) => {
  try {
    const device = await driver.getDeviceInfo(req.params.serial);
    if (device.platform !== "android") {
      res.status(501).json({ error: "Element snapshot is currently supported for Android only" });
      return;
    }

    const xml = await driver.dumpUiHierarchy(req.params.serial);
    const candidates = parseAndroidUiHierarchy(xml);
    const size = hierarchySize(candidates) ?? device.resolution;
    if (!size) {
      res.json({
        capturedAt: new Date().toISOString(),
        width: 0,
        height: 0,
        candidates: [],
        candidateCount: candidates.length,
        reason: "hierarchy_size_unavailable"
      });
      return;
    }

    const recordableSourceCandidates = candidates.filter((candidate) => isRecordableElementCandidate(candidate, size));
    const recordableCandidates = recordableSourceCandidates.slice(0, 300).map((candidate) => {
      const locator = locatorFromCandidate(candidate, recordableSourceCandidates);
      return {
        ...candidate,
        selector: selectorFromLocator(locator),
        locator,
        stable: true
      };
    });

    res.json({
      capturedAt: new Date().toISOString(),
      width: size.width,
      height: size.height,
      candidates: recordableCandidates,
      candidateCount: candidates.length
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices/:serial/locators/text-snapshot", async (req, res) => {
  try {
    if (!ocr.locateText) {
      res.status(501).json({ error: "OCR text locator is unavailable" });
      return;
    }
    const lang = typeof req.query.lang === "string" ? req.query.lang : undefined;
    const png = await driver.screenshot(req.params.serial);
    const layout = await ocr.locateText({ image: png, lang });
    res.json({
      capturedAt: new Date().toISOString(),
      width: layout.width,
      height: layout.height,
      text: layout.text,
      boxes: layout.boxes,
      candidateCount: layout.boxes.length,
      image: {
        width: layout.width,
        height: layout.height,
        source: "screenshot_for_ocr"
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/devices/:serial/observation", async (req, res) => {
  try {
    const observation = await observationService.collect(req.params.serial, {
      includeScreenshot: parseBooleanQuery(req.query.screenshot, true),
      includeUiTree: parseBooleanQuery(req.query.uiTree, true),
      includeOcr: parseBooleanQuery(req.query.ocr, true),
      lang: typeof req.query.lang === "string" ? req.query.lang : undefined
    });
    res.json({ observation });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/graphs", (req, res) => {
  try {
    const graphId = typeof req.query.graphId === "string" ? req.query.graphId.trim() : "";
    const graphs = storage.listBusinessGraphs().filter((graph) => !graphId || graph.id === graphId);
    res.json({
      graphs: graphs.map((graph) => ({
        ...graph,
        activeVersion: graph.activeVersionId ? storage.getBusinessGraphVersion(graph.activeVersionId) : undefined
      }))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/detect-node", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = req.body as {
      observation?: Parameters<typeof detectNode>[0];
      deviceSerial?: string;
      includeOcr?: boolean;
      minScore?: number;
      tieTolerance?: number;
    };
    const observation =
      body.observation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, {
            includeOcr: body.includeOcr ?? true
          })
        : undefined);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }

    const result = detectNode(observation, graphVersion, observation.platform, {
      minScore: positiveNumber(body.minScore, 0.6),
      tieTolerance: positiveNumber(body.tieTolerance, 0.05)
    });
    res.json({ result, observation });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/current-page", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = req.body as {
      deviceSerial?: string;
      observation?: Parameters<typeof identifyOrCreateCurrentPageDraft>[0]["observation"];
      includeOcr?: boolean;
      assetOnly?: boolean;
    };
    const observation =
      body.observation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, {
            includeOcr: body.includeOcr ?? true,
            includeUiTree: true,
            includeScreenshot: true
          })
        : undefined);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    const result = await identifyOrCreateCurrentPageDraft({
      graphVersion,
      observation,
      storage,
      assetOnly: body.assetOnly === true,
      baselineReader: readPageAssetBaselineArtifact
    });
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/auto-explorer/preview", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const graph = storage.getBusinessGraph(graphVersion.graphId);
    if (!graph) {
      res.status(404).json({ error: "Business graph not found" });
      return;
    }
    const body = readAutoExploreRequest(req.body);
    const observation = await resolveAutoExploreObservation(body);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    if (!isObservationInTargetApp(observation, graph.targetApp)) {
      res.json({
        report: autoExploreBlockedReport("当前设备不在目标 App 内，自动探索已停止。", body.maxDepth, body.maxActions),
        observation
      });
      return;
    }
    const source = await resolveAutoExploreSource(graphVersion, observation, body.sourceNodeId);
    const report = source.sourceNodeId
      ? createAutoExploreReport({
          graphVersion,
          sourceNodeId: source.sourceNodeId,
          observation,
          maxDepth: body.maxDepth,
          maxCandidates: body.maxCandidates,
          maxActions: body.maxActions
        })
      : autoExploreBlockedReport(source.message ?? "当前页面没有匹配到可探索的页面资产。", body.maxDepth, body.maxActions);
    res.json({
      report,
      observation,
      match: source.match
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/auto-explorer/run", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const graph = storage.getBusinessGraph(graphVersion.graphId);
    if (!graph) {
      res.status(404).json({ error: "Business graph not found" });
      return;
    }
    const body = readAutoExploreRequest(req.body);
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required for explorer run" });
      return;
    }
    const observation = await resolveAutoExploreObservation(body);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    if (!isObservationInTargetApp(observation, graph.targetApp)) {
      res.json({
        report: autoExploreBlockedReport("当前设备不在目标 App 内，自动探索已停止。", body.maxDepth, body.maxActions),
        observation
      });
      return;
    }
    const source = await resolveAutoExploreSource(graphVersion, observation, body.sourceNodeId);
    if (!source.sourceNodeId) {
      res.json({
        report: autoExploreBlockedReport(source.message ?? "当前页面没有匹配到可探索的页面资产。", body.maxDepth, body.maxActions),
        observation,
        match: source.match
      });
      return;
    }
    const report = createAutoExploreReport({
      graphVersion,
      sourceNodeId: source.sourceNodeId,
      observation,
      maxDepth: body.maxDepth,
      maxCandidates: body.maxCandidates,
      maxActions: body.maxActions
    });
    if (report.status === "blocked") {
      res.json({ report, observation, match: source.match });
      return;
    }
    let currentObservation = observation;
    let currentSourceNodeId = source.sourceNodeId;
    const results: AutoExploreCandidateResult[] = [];
    const maxActions = Math.min(body.maxActions, report.plan.steps.length);
    for (const step of report.plan.steps.slice(0, maxActions)) {
      if (currentSourceNodeId !== step.sourceNodeId) {
        const recovered = await recoverExplorerSource(body.deviceSerial, graphVersion, step.sourceNodeId, body.recoveryBackLimit);
        currentObservation = recovered.observation ?? currentObservation;
        currentSourceNodeId = recovered.sourceNodeId ?? currentSourceNodeId;
        if (currentSourceNodeId !== step.sourceNodeId) {
          results.push({
            candidateId: step.candidateId,
            candidateLabel: step.candidateLabel,
            status: "failed",
            resultType: "failed",
            message: `无法回到待探索页面：${step.sourceNodeName}`
          });
          continue;
        }
      }
      const sourceNode = graphVersion.nodes.find((node) => node.id === step.sourceNodeId);
      const candidate = sourceNode
        ? generateExplorationCandidates({
            node: sourceNode,
            observation: currentObservation,
            graphVersion,
            maxCandidates: body.maxCandidates
          }).find((item) => item.id === step.candidateId || item.label === step.candidateLabel)
        : undefined;
      if (!candidate) {
        results.push({
          candidateId: step.candidateId,
          candidateLabel: step.candidateLabel,
          status: "failed",
          resultType: "failed",
          message: "候选动作已失效，请重新预览自动探索候选。"
        });
        continue;
      }
      const result = await executeAutoExploreCandidate({
        deviceSerial: body.deviceSerial,
        graphVersion,
        candidate,
        beforeObservation: currentObservation
      });
      results.push(result);
      currentObservation = await collectFastVisualObservation(body.deviceSerial);
      const currentMatch = await matchCurrentPage({
        graphVersion,
        observation: currentObservation,
        baselineReader: readPageAssetBaselineArtifact
      });
      currentSourceNodeId = currentMatch.match.status === "matched" ? currentMatch.match.node?.id ?? currentSourceNodeId : currentSourceNodeId;
    }
    res.json({
      report: {
        ...report,
        results
      },
      observation,
      match: source.match
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/recording-assets", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const graph = storage.getBusinessGraph(graphVersion.graphId);
    if (!graph) {
      res.status(404).json({ error: "Business graph not found" });
      return;
    }
    const body = readRecordingGraphAssetRequest(req.body);
    const afterObservation =
      body.afterObservation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, {
            includeOcr: body.includeOcr,
            includeUiTree: true,
            includeScreenshot: false
          })
        : undefined);
    if (!afterObservation) {
      res.status(400).json({ error: "afterObservation or deviceSerial is required" });
      return;
    }

    const result = persistRecordingStepGraphAsset({
      graphVersion,
      storage,
      beforeObservation: body.beforeObservation,
      afterObservation,
      step: body.step,
      targetApp: graph.targetApp,
      confirm: body.confirm
    });
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(201).json({
      result,
      graphVersion: latestGraphVersion,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/route-plan", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const graph = storage.getBusinessGraph(graphVersion.graphId);
    if (!graph) {
      res.status(404).json({ error: "Business graph not found" });
      return;
    }
    const body = readRoutePlanRequest(req.body);
    const planningGraphVersion = withPageAbilityEdges(graphVersion, body.platform);
    const targetResolution = body.target
      ? resolveTargetNode(planningGraphVersion, {
          ...body.target,
          platform: body.platform
        })
      : undefined;
    if (targetResolution && targetResolution.status !== "resolved") {
      res.status(422).json({
        error: targetResolution.status === "ambiguous" ? "Target node is ambiguous" : "Target node not found",
        targetResolution
      });
      return;
    }
    const targetNodeId = targetResolution?.targetNode?.id ?? body.targetNodeId;
    if (!targetNodeId) {
      res.status(400).json({ error: "targetNodeId or target is required" });
      return;
    }
    const startRecovery =
      body.deviceSerial && !body.startNodeId
        ? await resolveReachableStartNode({
            graphVersion: planningGraphVersion,
            appId: graph.appId,
            targetApp: graph.targetApp,
            platform: body.platform,
            targetNodeId,
            strategy: body.strategy,
            collectObservation: () =>
              observationService.collect(body.deviceSerial!, {
                includeScreenshot: true,
                includeUiTree: body.executionProfile !== "fast_visual",
                includeOcr: true
              }),
            performAction: (action) => driver.performAction(body.deviceSerial!, action),
            baselineReader: readPageAssetBaselineArtifact,
            startAppScope: body.startAppScope
          })
        : undefined;
    const observation =
      body.deviceSerial && !startRecovery?.startNodeId
        ? await observationService.collect(body.deviceSerial, {
            includeOcr: true
          })
        : undefined;
    const startDetection = startRecovery?.startNodeId
      ? {
          source: "device_observation" as const,
          startNodeId: startRecovery.startNodeId,
          inTargetApp: true
        }
      : await resolveRoutePlanStart({
          graphVersion: planningGraphVersion,
          targetApp: graph.targetApp,
          platform: body.platform,
          requestedStartNodeId: body.startNodeId,
          observation,
          baselineReader: readPageAssetBaselineArtifact,
          startAppScope: body.startAppScope
        });
    const routePlan = planRoute({
      graphVersion: planningGraphVersion,
      appId: graph.appId,
      targetApp: graph.targetApp,
      targetNodeId,
      startNodeId: startDetection.startNodeId,
      platform: body.platform,
      strategy: body.strategy
    });
    const routeGapIssues =
      routePlan.unresolvedIssues.some((issue) => issue.code === "TARGET_NODE_UNREACHABLE")
        ? pageAbilityRouteGapIssues(graphVersion, body.platform, { startNodeId: startDetection.startNodeId })
        : [];
    const previewRoutePlan = routeGapIssues.length
      ? {
          ...routePlan,
          unresolvedIssues: [...routePlan.unresolvedIssues, ...routeGapIssues],
          assumptions: [...routePlan.assumptions, "Some saved page abilities are not connected to target pages yet."]
        }
      : routePlan;
    const executionPlan = buildExecutionPlan({
      routePlan: previewRoutePlan,
      platform: body.platform
    });
    const previewIssue = routePreviewBlockingIssue(startDetection);
    const previewExecutionPlan = previewIssue
      ? {
          ...executionPlan,
          unresolvedIssues: [...executionPlan.unresolvedIssues, previewIssue]
        }
      : executionPlan;
    const hasBlockingIssue = previewExecutionPlan.unresolvedIssues.some((issue) => issue.severity === "error");
    const persisted = body.persist !== false && !hasBlockingIssue;
    if (persisted) {
      storage.saveRoutePlan(previewRoutePlan);
    }
    res.json({
      routePlan: previewRoutePlan,
      executionPlan: previewExecutionPlan,
      targetResolution,
      startDetection: summarizeRoutePlanStartDetection(startDetection),
      startRecovery: startRecovery?.recovery,
      persisted,
      persistSkippedReason: persisted ? undefined : hasBlockingIssue ? "blocking_issues" : "persist_disabled"
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/graphs/:versionId/quality", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 100, 1, 500);
    res.json({
      quality: buildGraphQualitySummary(storage, req.params.versionId, { limit })
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/graphs/:versionId/assets", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const limit = parsePositiveInt(req.query.limit, 100, 1, 500);
    res.json({
      assets: buildGraphAssetGovernanceSummary(graphVersion, storage.listRuns(limit, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/nodes/:nodeId/promote", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const node = graphVersion.nodes.find((item) => item.id === req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: "Graph node not found" });
      return;
    }
    const body = req.body as {
      observation?: Observation;
      match?: Parameters<typeof buildConfirmedPageAssetInput>[0]["match"];
    };
    const draft = readPageAssetDraftRequest(req.body);
    const nodeInput = body.observation
      ? await buildConfirmedPageAssetInput({
          graphVersionId: graphVersion.id,
          observation: body.observation,
          match: body.match,
          draft: {
            key: draft.key ?? node.key,
            name: draft.name ?? node.name,
            tags: mergePageAssetTags(node.tags, draft),
            metadata: mergePageAssetDraftMetadata(node.metadata, draft)
          },
          assetWriter: writePageAssetBaselineArtifact
        })
      : {
          key: draft.key ?? node.key,
          name: draft.name ?? node.name,
          nodeType: draft.assetKind === "overlay" ? "business_state" as const : node.nodeType,
          tags: mergePageAssetTags(node.tags, draft),
          status: "active" as const,
          matchers: node.matchers,
          platformScope: node.platformScope,
          metadata: mergePageAssetDraftMetadata(node.metadata, draft)
        };
    const promoted = storage.updateBusinessNodeDetails(node.id, {
      key: nodeInput.key,
      name: nodeInput.name,
      nodeType: nodeInput.nodeType,
      tags: nodeInput.tags,
      status: nodeInput.status,
      matchers: nodeInput.matchers,
      platformScope: nodeInput.platformScope,
      metadata: nodeInput.metadata
    });
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      node: promoted,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/nodes", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = req.body as {
      observation?: Observation;
      match?: Parameters<typeof buildConfirmedPageAssetInput>[0]["match"];
    };
    if (!body.observation) {
      res.status(400).json({ error: "observation is required" });
      return;
    }
    const draft = readPageAssetDraftRequest(req.body);
    const metadata = mergePageAssetDraftMetadata(undefined, draft);
    const nodeInput = await buildConfirmedPageAssetInput({
      graphVersionId: graphVersion.id,
      observation: body.observation,
      match: body.match,
      draft: {
        key: draft.key,
        name: draft.name,
        tags: mergePageAssetTags([], draft),
        metadata
      },
      assetWriter: writePageAssetBaselineArtifact
    });
    const previous = storage.findBusinessNodeByKey(graphVersion.id, nodeInput.key);
    const node = previous
      ? storage.updateBusinessNodeDetails(previous.id, {
          key: nodeInput.key,
          name: nodeInput.name,
          nodeType: nodeInput.nodeType,
          tags: nodeInput.tags,
          status: nodeInput.status,
          matchers: nodeInput.matchers,
          platformScope: nodeInput.platformScope,
          metadata: nodeInput.metadata
        }) ?? previous
      : storage.createBusinessNode(nodeInput);
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      node,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/transitions", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = readManualPageTransitionRequest(req.body);
    const result = persistManualPageTransitionAsset({
      graphVersionId: graphVersion.id,
      storage,
      ...body
    });
    if (result.status === "skipped") {
      res.status(422).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(result.status === "created" ? 201 : 200).json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/task-transitions", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = readPageTaskNavigationTransitionRequest(req.body);
    const result = persistPageTaskNavigationTransitionAsset({
      graphVersionId: graphVersion.id,
      storage,
      ...body
    });
    if (result.status === "skipped") {
      res.status(422).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(result.status === "created" ? 201 : 200).json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/page-elements", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = readManualPageElementRequest(req.body);
    const result = persistManualPageElementAsset({
      graphVersionId: graphVersion.id,
      storage,
      ...body
    });
    if (result.status === "skipped") {
      res.status(422).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(200).json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/page-elements/validate", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = readManualPageElementRequest(req.body);
    const observation = await resolvePageElementQualityObservation(req.body);
    const sourceNode = storage.findBusinessNodeById(graphVersion.id, body.sourceNodeId);
    const region = parsePercentRegionFromLocator(body.locator);
    const quality = validatePageElementAssetQuality({
      element: {
        elementId: body.elementId,
        locator: body.locator,
        actionKind: body.actionKind,
        elementLabel: body.elementLabel,
        targetText: body.targetText,
        semanticArea: body.semanticArea,
        region
      },
      observation,
      existingElements: readManualElementsForQuality(sourceNode?.metadata?.assetRecordingManualElements)
    });
    const visualLocator = region ? await createPageElementVisualLocator(observation, region) : undefined;
    res.json({ quality, visualLocator, observation });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/graphs/:versionId/assets/page-elements/:sourceNodeId/:elementId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const result = deleteManualPageElementAsset({
      graphVersionId: graphVersion.id,
      storage,
      sourceNodeId: req.params.sourceNodeId,
      elementId: req.params.elementId
    });
    if (result.status === "skipped") {
      res.status(404).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/page-tasks", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = readPageTaskAssetRequest(req.body);
    const result = persistPageTaskAsset({
      graphVersionId: graphVersion.id,
      storage,
      ...body
    });
    if (result.status === "skipped") {
      res.status(422).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(200).json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/graphs/:versionId/assets/page-tasks/:sourceNodeId/:taskId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const result = deletePageTaskAsset({
      graphVersionId: graphVersion.id,
      storage,
      sourceNodeId: req.params.sourceNodeId,
      taskId: req.params.taskId
    });
    if (result.status === "skipped") {
      res.status(404).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/graphs/:versionId/assets/transitions/:edgeId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const result = deleteManualPageTransitionAsset({
      graphVersion,
      storage,
      edgeId: req.params.edgeId
    });
    if (result.status === "skipped") {
      res.status(404).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      result,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/graphs/:versionId/assets/nodes/:nodeId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const node = graphVersion.nodes.find((item) => item.id === req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: "Graph node not found" });
      return;
    }
    if (!isConfirmedPageAssetNode(node)) {
      res.status(400).json({ error: "Only confirmed page assets can be deleted from the page asset library" });
      return;
    }
    const deprecated = storage.updateBusinessNodeStatus(node.id, "deprecated");
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      node: deprecated,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/edges/:edgeId/promote", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const edge = graphVersion.edges.find((item) => item.id === req.params.edgeId);
    if (!edge) {
      res.status(404).json({ error: "Graph edge not found" });
      return;
    }
    const promoted = storage.updateOperationEdgeStatus(edge.id, "active");
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      edge: promoted,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graphs/:versionId/assets/auto-promote", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = req.body as {
      minRuntimeObservationCount?: number;
      minExplorationReliabilityScore?: number;
    };
    const selection = selectAutoPromotableGraphAssets(graphVersion, {
      minRuntimeObservationCount: parseOptionalPositiveInt(body.minRuntimeObservationCount),
      minExplorationReliabilityScore: parseOptionalRatio(body.minExplorationReliabilityScore)
    });
    for (const nodeId of selection.nodeIds) {
      storage.updateBusinessNodeStatus(nodeId, "active");
    }
    for (const edgeId of selection.edgeIds) {
      storage.updateOperationEdgeStatus(edgeId, "active");
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.json({
      promoted: {
        nodeIds: selection.nodeIds,
        edgeIds: selection.edgeIds
      },
      skipped: selection.skipped,
      assets: buildGraphAssetGovernanceSummary(latestGraphVersion, storage.listRuns(120, 0))
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/graph-runs", async (req, res) => {
  try {
    const body = readGraphRunRequest(req.body);
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
    }
    const activeStabilityRun = stabilityExplorer.getActiveRunForDevice(body.deviceSerial);
    if (activeStabilityRun) {
      throw new StabilityExplorerDeviceBusyError(body.deviceSerial, activeStabilityRun.runId);
    }
    const activeAssetPatrolRun = assetPatrol.getActiveRunForDevice(body.deviceSerial);
    if (activeAssetPatrolRun) {
      throw new AssetPatrolDeviceBusyError(body.deviceSerial, activeAssetPatrolRun.runId);
    }
    const started = await graphRunner.start(body);
    const run = storage.getRun(started.run.id) ?? started.run;
    res.status(202).json({
      run,
      active: graphRunner.isRunning(started.run.id),
      routePlanId: started.routePlanId,
      executionPlanId: started.executionPlanId,
      graphVersionId: started.graphVersionId,
      targetNodeId: started.targetNodeId,
      targetResolution: started.targetResolution,
      nodeTestResult: buildNodeTestResult(run, graphRunner.isRunning(started.run.id))
    });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.get("/api/graph-runs/:id", (req, res) => {
  const run = storage.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Graph run not found" });
    return;
  }
  const graphRun = summarizeGraphRun(run, graphRunner.isRunning(req.params.id));
  if (!graphRun.isGraphRun) {
    res.status(404).json({ error: "Run is not a graph run", runId: run.id });
    return;
  }
  res.json({ graphRun, nodeTestResult: buildNodeTestResult(run, graphRunner.isRunning(req.params.id)), run });
});

app.get("/api/route-plans/:id", (req, res) => {
  try {
    const routePlan = storage.getRoutePlan(req.params.id);
    if (!routePlan) {
      res.status(404).json({ error: "Route plan not found" });
      return;
    }
    res.json({ routePlan });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/source-scan/android", async (req, res) => {
  try {
    const result = await scanAndroidSource(readSourceScanRequest(req.body));
    res.json({ result });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/source-scan/roots", async (_req, res) => {
  try {
    res.json({
      roots: await listSourceScanRoots(),
      defaults: {
        maxFiles: defaultSourceScanMaxFiles,
        maxAllowedFiles: maxSourceScanMaxFiles
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/source-scan/directories", async (req, res) => {
  try {
    const parentPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!parentPath.trim()) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    res.json({ directories: await listSourceScanDirectories(parentPath) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/source-scan/pick-directory", async (req, res) => {
  try {
    const body = req.body as { initialPath?: string };
    const result = await pickSourceScanDirectory(typeof body.initialPath === "string" ? body.initialPath : undefined);
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/source-scan/android/import", async (req, res) => {
  try {
    const body = req.body as { graphId?: string; name?: string };
    const scanInput = readSourceScanRequest(req.body);
    const result = await scanAndroidSource(scanInput);
    const imported = storage.importSourceScanGraph({
      graphId: typeof body.graphId === "string" && body.graphId.trim() ? body.graphId.trim() : undefined,
      appId: scanInput.appId,
      targetApp: scanInput.targetApp,
      name: typeof body.name === "string" ? body.name : undefined,
      scanResult: result
    });
    res.status(201).json({ result, imported });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/cases", (_req, res) => {
  res.json({ cases: storage.listCases() });
});

app.post("/api/cases", (req, res) => {
  try {
    const body = req.body as { name?: string; description?: string; steps?: ActionStep[] };
    if (!body.name?.trim()) {
      res.status(400).json({ error: "Case name is required" });
      return;
    }
    if (!body.steps?.length) {
      res.status(400).json({ error: "At least one step is required" });
      return;
    }
    const testCase = storage.createCase({
      name: body.name.trim(),
      description: body.description,
      steps: body.steps
    });
    res.status(201).json({ case: testCase });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/cases/:id", (req, res) => {
  const testCase = storage.getCase(req.params.id);
  if (!testCase) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.json({ case: testCase });
});

app.put("/api/cases/:id", (req, res) => {
  try {
    const body = req.body as { name?: string; description?: string; steps?: ActionStep[] };
    if (!body.name?.trim()) {
      res.status(400).json({ error: "Case name is required" });
      return;
    }
    if (!body.steps?.length) {
      res.status(400).json({ error: "At least one step is required" });
      return;
    }
    const testCase = storage.updateCase(req.params.id, {
      name: body.name.trim(),
      description: body.description,
      steps: body.steps
    });
    res.json({ case: testCase });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/cases/:id", (req, res) => {
  const deleted = storage.deleteCase(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Case not found" });
    return;
  }
  res.status(204).send();
});

app.get("/api/structured-flows", (_req, res) => {
  res.json({ flows: storage.listStructuredFlows() });
});

app.post("/api/structured-flows", (req, res) => {
  try {
    const input = readStructuredFlowInput(req.body);
    const flow = storage.createStructuredFlow(input);
    res.status(201).json({ flow });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/structured-flows/:id", (req, res) => {
  const flow = storage.getStructuredFlow(req.params.id);
  if (!flow) {
    res.status(404).json({ error: "Structured flow not found" });
    return;
  }
  res.json({ flow });
});

app.put("/api/structured-flows/:id", (req, res) => {
  try {
    const input = readStructuredFlowInput(req.body);
    const flow = storage.updateStructuredFlow(req.params.id, input);
    res.json({ flow });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/structured-flows/:id", (req, res) => {
  const deleted = storage.deleteStructuredFlow(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Structured flow not found" });
    return;
  }
  res.status(204).send();
});

app.get("/api/runtime-interceptor-rules", (req, res) => {
  try {
    const platform = req.query.platform === "android" || req.query.platform === "ios" ? req.query.platform : undefined;
    const enabledOnly = parseBooleanQuery(req.query.enabledOnly, false);
    const appPackageName = typeof req.query.appPackageName === "string" ? req.query.appPackageName.trim() : undefined;
    const flowId = typeof req.query.flowId === "string" ? req.query.flowId.trim() : undefined;
    res.json({
      rules: storage.listRuntimeInterceptorRules({
        enabledOnly,
        platform,
        appPackageName: appPackageName || undefined,
        flowId: flowId || undefined
      })
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runtime-interceptor-rules", (req, res) => {
  try {
    const rule = storage.createRuntimeInterceptorRule(readRuntimeInterceptorRuleInput(req.body));
    res.status(201).json({ rule });
  } catch (error) {
    sendError(res, error);
  }
});

app.put("/api/runtime-interceptor-rules/:id", (req, res) => {
  try {
    const rule = storage.updateRuntimeInterceptorRule(req.params.id, readRuntimeInterceptorRulePatch(req.body));
    if (!rule) {
      res.status(404).json({ error: "Runtime interceptor rule not found" });
      return;
    }
    res.json({ rule });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/runtime-interceptor-rules/:id", (req, res) => {
  const deleted = storage.deleteRuntimeInterceptorRule(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Runtime interceptor rule not found" });
    return;
  }
  res.status(204).send();
});

app.post("/api/cases/:id/import-graph", (req, res) => {
  try {
    const testCase = storage.getCase(req.params.id);
    if (!testCase) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    const body = req.body as {
      graphId?: string;
      appId?: string;
      name?: string;
      targetApp?: GraphTargetApp;
    };
    const imported = importLegacyCaseAsDraftGraph(storage, testCase, {
      graphId: body.graphId,
      appId: body.appId,
      name: body.name,
      targetApp: readGraphTargetApp(body)
    });
    res.status(201).json({ imported });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/artifacts/:id/approve-baseline", (req, res) => {
  try {
    const body = req.body as { caseId?: string; stepId?: string; expectationId?: string };
    if (!body.caseId || !body.stepId || !body.expectationId) {
      res.status(400).json({ error: "caseId, stepId and expectationId are required" });
      return;
    }
    const artifact = storage.getArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    const testCase = storage.getCase(body.caseId);
    if (!testCase) {
      res.status(404).json({ error: "Case not found" });
      return;
    }

    let updatedExpectation = false;
    const steps = testCase.steps.map((step) => {
      if (step.id !== body.stepId) {
        return step;
      }
      const expectations = (step.expectations ?? []).map((expectation) => {
        if (expectation.id !== body.expectationId) {
          return expectation;
        }
        if (expectation.type !== "image") {
          throw new Error("Only image expectations can approve a baseline artifact");
        }
        updatedExpectation = true;
        return {
          ...expectation,
          enabled: true,
          params: {
            ...expectation.params,
            baselineArtifactId: artifact.id
          }
        };
      });
      return {
        ...step,
        expectations
      };
    });

    if (!updatedExpectation) {
      res.status(404).json({ error: "Expectation not found" });
      return;
    }

    const updatedCase = storage.updateCase(testCase.id, {
      name: testCase.name,
      description: testCase.description,
      steps
    });
    res.json({ case: updatedCase, baselineArtifactId: artifact.id });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/runs", (req, res) => {
  const limit = parsePositiveInt(req.query.limit, 30, 1, 200);
  const offset = parsePositiveInt(req.query.offset, 0, 0, 10000);
  res.json({ runs: storage.listRuns(limit, offset), limit, offset });
});

app.post("/api/stability-explorations", (req, res) => {
  try {
    const body = readStabilityExplorerRequest(req.body);
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.packageName) {
      res.status(400).json({ error: "packageName is required" });
      return;
    }
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial) ?? flowRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
    }
    const activeGraphRun = graphRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeGraphRun) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeGraphRun.runId);
    }
    const activeAssetPatrolRun = assetPatrol.getActiveRunForDevice(body.deviceSerial);
    if (activeAssetPatrolRun) {
      throw new AssetPatrolDeviceBusyError(body.deviceSerial, activeAssetPatrolRun.runId);
    }
    const run = stabilityExplorer.start(body);
    res.status(202).json({ run, active: stabilityExplorer.isRunning(run.id) });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.post("/api/asset-patrols/preview", async (req, res) => {
  try {
    const body = readAssetPatrolRequest(req.body);
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.packageName) {
      res.status(400).json({ error: "packageName is required" });
      return;
    }
    const plan = await assetPatrol.preview(body);
    res.json({ plan });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.get("/api/asset-patrols/runtime-params", (req, res) => {
  try {
    const packageName = typeof req.query.packageName === "string" ? req.query.packageName.trim() : "";
    const graphVersionId = typeof req.query.graphVersionId === "string" ? req.query.graphVersionId.trim() : "";
    if (!packageName && !graphVersionId) {
      res.status(400).json({ error: "packageName or graphVersionId is required" });
      return;
    }
    const graphVersion = findAssetPatrolGraphVersion(packageName, graphVersionId || undefined);
    if (!graphVersion) {
      res.status(404).json({ error: "没有找到当前包名对应的 active PageStateFlow 版本。" });
      return;
    }
    const parameters = collectAssetRuntimeParamDefinitions(graphVersion);
    res.json({
      graphVersionId: graphVersion.id,
      parameters,
      templateText: parameters.map((item) => `${item.key}=`).join("\n")
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/asset-patrols", (req, res) => {
  try {
    const body = readAssetPatrolRequest(req.body);
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.packageName) {
      res.status(400).json({ error: "packageName is required" });
      return;
    }
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial) ?? flowRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
    }
    const activeGraphRun = graphRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeGraphRun) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeGraphRun.runId);
    }
    const activeAssetDrivenQueue = activeAssetDrivenExecutionQueues.get(body.deviceSerial);
    if (activeAssetDrivenQueue) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeAssetDrivenQueue.runId);
    }
    const activeStabilityRun = stabilityExplorer.getActiveRunForDevice(body.deviceSerial);
    if (activeStabilityRun) {
      throw new StabilityExplorerDeviceBusyError(body.deviceSerial, activeStabilityRun.runId);
    }
    const run = assetPatrol.start(body);
    res.status(202).json({ run, active: assetPatrol.isRunning(run.id) });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.get("/api/asset-patrols/executions", (req, res) => {
  const deviceSerial = typeof req.query.deviceSerial === "string" ? req.query.deviceSerial.trim() : "";
  const packageName = typeof req.query.packageName === "string" ? req.query.packageName.trim() : "";
  const executions = Array.from(assetDrivenExecutionSessions.values())
    .filter((execution) => !deviceSerial || execution.deviceSerial === deviceSerial)
    .filter((execution) => !packageName || execution.packageName === packageName)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeExecution = executions.find((execution) => execution.status === "running");
  res.json({ execution: activeExecution ?? executions[0] ?? null, executions });
});

app.get("/api/asset-patrols/executions/:executionId", (req, res) => {
  const execution = assetDrivenExecutionSessions.get(req.params.executionId);
  if (!execution) {
    res.status(404).json({ error: "asset-driven execution not found" });
    return;
  }
  res.json({ execution });
});

app.post("/api/asset-patrols/executions/:executionId/stop", async (req, res) => {
  try {
    const execution = assetDrivenExecutionSessions.get(req.params.executionId);
    if (!execution) {
      res.status(404).json({ error: "asset-driven execution not found" });
      return;
    }
    const queueState = activeAssetDrivenExecutionQueues.get(execution.deviceSerial);
    if (queueState?.sessionId === execution.id) {
      queueState.cancelled = true;
    }
    const activeRunIds = Array.from(new Set([
      execution.runningItem?.runId,
      queueState?.sessionId === execution.id ? queueState.runId : undefined
    ].filter((item): item is string => Boolean(item))));
    for (const runId of activeRunIds) {
      const run = storage.getRun(runId);
      await stopRunByKind(runId, run?.config.runKind);
      const stoppedRun = storage.getRun(runId);
      if (stoppedRun) {
        updateAssetDrivenExecutionItemFromRun(execution, stoppedRun);
      }
    }
    stopAssetDrivenExecutionSession(execution, "用户停止本轮资产测试。");
    if (queueState?.sessionId === execution.id) {
      activeAssetDrivenExecutionQueues.delete(execution.deviceSerial);
    }
    res.json({ execution, stopped: true });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/asset-patrols/execute", async (req, res) => {
  try {
    const body = readAssetPatrolRequest(req.body);
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.packageName) {
      res.status(400).json({ error: "packageName is required" });
      return;
    }
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial) ?? flowRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
    }
    const activeGraphRun = graphRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeGraphRun) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeGraphRun.runId);
    }
    const activeStabilityRun = stabilityExplorer.getActiveRunForDevice(body.deviceSerial);
    if (activeStabilityRun) {
      throw new StabilityExplorerDeviceBusyError(body.deviceSerial, activeStabilityRun.runId);
    }
    const activeAssetPatrolRun = assetPatrol.getActiveRunForDevice(body.deviceSerial);
    if (activeAssetPatrolRun) {
      throw new AssetPatrolDeviceBusyError(body.deviceSerial, activeAssetPatrolRun.runId);
    }
    const config = normalizeAssetPatrolConfig(body);
    const startActions = assetPatrolStartActions(config);
    for (const action of startActions) {
      await driver.performAction(body.deviceSerial, action);
      if (action.type === "close_app") {
        await delay(300);
      }
    }
    if (startActions.some((action) => action.type === "launch_app")) {
      await delay(800);
    }
    await handleAssetDrivenRuntimeInterceptors(body.deviceSerial, config.packageName);
    const plan = await assetPatrol.preview(body);
    const graphVersion = plan.graphVersionId ? storage.getBusinessGraphVersion(plan.graphVersionId) : undefined;
    if (!graphVersion) {
      res.status(422).json({ error: plan.issues[0]?.message ?? "没有找到可执行的 PageStateFlow 版本。", plan });
      return;
    }
    const executionTargets = selectAssetDrivenExecutionTargets({ plan, graphVersion, config });
    if (executionTargets.status === "blocked") {
      res.status(422).json({ error: executionTargets.message, executionTarget: executionTargets, executionTargets, plan });
      return;
    }
    const executionTarget = executionTargets.targets[0];
    if (!executionTarget) {
      res.status(422).json({
        error: "当前页面没有可真实执行的 ready 连接边或页面任务，请先补充页面能力/连接边资产。",
        executionTargets,
        plan
      });
      return;
    }
    const assetDrivenExecution = createAssetDrivenExecutionSession({
      deviceSerial: body.deviceSerial,
      packageName: config.packageName,
      graphVersionId: executionTargets.graphVersionId,
      startNodeId: executionTargets.startNodeId,
      startNodeName: executionTargets.startNodeName,
      targets: executionTargets.targets
    });
    assetDrivenExecutionSessions.set(assetDrivenExecution.id, assetDrivenExecution);
    const started = await startAssetDrivenGraphTarget(body.deviceSerial, executionTarget);
    markAssetDrivenExecutionItemStarted(assetDrivenExecution, 0, started.run);
    const queueState = { runId: started.run.id, sessionId: assetDrivenExecution.id, cancelled: false, promise: Promise.resolve() };
    const queuePromise = continueAssetDrivenExecutionQueue({
      body,
      config,
      startNodeId: executionTargets.startNodeId,
      targets: executionTargets.targets,
      firstRunId: started.run.id,
      session: assetDrivenExecution,
      queueState
    })
      .catch((error) => {
        skipPendingAssetDrivenExecutionItems(assetDrivenExecution, error instanceof Error ? error.message : String(error));
        console.error("Asset-driven execution queue failed", error);
      })
      .finally(() => {
        if (activeAssetDrivenExecutionQueues.get(body.deviceSerial)?.promise === queuePromise) {
          activeAssetDrivenExecutionQueues.delete(body.deviceSerial);
        }
      });
    queueState.promise = queuePromise;
    activeAssetDrivenExecutionQueues.set(body.deviceSerial, queueState);
    const run = storage.getRun(started.run.id) ?? started.run;
    res.status(202).json({
      run,
      active: graphRunner.isRunning(started.run.id),
      routePlanId: started.routePlanId,
      executionPlanId: started.executionPlanId,
      graphVersionId: started.graphVersionId,
      targetNodeId: started.targetNodeId,
      targetResolution: started.targetResolution,
      executionTarget,
      executionTargets,
      assetDrivenExecution,
      assetDrivenQueue: {
        id: assetDrivenExecution.id,
        total: executionTargets.targets.length,
        started: 1,
        remaining: Math.max(0, executionTargets.targets.length - 1)
      },
      plan,
      nodeTestResult: buildNodeTestResult(run, graphRunner.isRunning(started.run.id))
    });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.post("/api/runs", (req, res) => {
  try {
    const body = req.body as {
      deviceSerial?: string;
      caseId?: string;
      caseName?: string;
      steps?: ActionStep[];
      mode?: RunMode;
      repeatCount?: number;
      stepIntervalMs?: number;
      stopOnFailure?: boolean;
      recordVideo?: boolean;
      keepVideoOnSuccess?: boolean;
      pauseAfterEachStep?: boolean;
      startStrategy?: FlowStartStrategy;
      startAppPackageName?: string;
      startSetupScope?: "before_run" | "before_each_iteration";
    };
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.caseId && !body.steps?.length) {
      res.status(400).json({ error: "caseId or steps is required" });
      return;
    }
    if (requiresStartAppPackageName(body.startStrategy) && !body.startAppPackageName?.trim()) {
      res.status(400).json({ error: `${body.startStrategy} requires startAppPackageName` });
      return;
    }
    const activeGraphRun = graphRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeGraphRun) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeGraphRun.runId);
    }
    const activeStabilityRun = stabilityExplorer.getActiveRunForDevice(body.deviceSerial);
    if (activeStabilityRun) {
      throw new StabilityExplorerDeviceBusyError(body.deviceSerial, activeStabilityRun.runId);
    }
    const activeAssetPatrolRun = assetPatrol.getActiveRunForDevice(body.deviceSerial);
    if (activeAssetPatrolRun) {
      throw new AssetPatrolDeviceBusyError(body.deviceSerial, activeAssetPatrolRun.runId);
    }
    const run = runner.start({
      deviceSerial: body.deviceSerial,
      caseId: body.caseId,
      caseName: body.caseName,
      steps: body.steps,
      mode: body.mode,
      repeatCount: body.repeatCount,
      stepIntervalMs: body.stepIntervalMs,
      stopOnFailure: body.stopOnFailure,
      recordVideo: body.recordVideo,
      keepVideoOnSuccess: body.keepVideoOnSuccess,
      pauseAfterEachStep: body.pauseAfterEachStep,
      startStrategy: body.startStrategy,
      startAppPackageName: body.startAppPackageName,
      startSetupScope: body.startSetupScope
    });
    res.status(202).json({ run });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.post("/api/flow-runs", async (req, res) => {
  try {
    const body = req.body as Partial<StartStructuredFlowRunInput>;
    if (!body.deviceSerial) {
      res.status(400).json({ error: "deviceSerial is required" });
      return;
    }
    if (!body.flowId) {
      res.status(400).json({ error: "flowId is required" });
      return;
    }
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
    }
    const activeGraphRun = graphRunner.getActiveRunForDevice(body.deviceSerial);
    if (activeGraphRun) {
      throw new GraphDeviceBusyError(body.deviceSerial, activeGraphRun.runId);
    }
    const activeStabilityRun = stabilityExplorer.getActiveRunForDevice(body.deviceSerial);
    if (activeStabilityRun) {
      throw new StabilityExplorerDeviceBusyError(body.deviceSerial, activeStabilityRun.runId);
    }
    const activeAssetPatrolRun = assetPatrol.getActiveRunForDevice(body.deviceSerial);
    if (activeAssetPatrolRun) {
      throw new AssetPatrolDeviceBusyError(body.deviceSerial, activeAssetPatrolRun.runId);
    }
    const run = await flowRunner.start({
      flowId: body.flowId,
      deviceSerial: body.deviceSerial,
      mode: body.mode,
      repeatCount: body.repeatCount,
      stepIntervalMs: body.stepIntervalMs,
      stopOnFailure: body.stopOnFailure,
      recordVideo: body.recordVideo,
      keepVideoOnSuccess: body.keepVideoOnSuccess,
      pauseAfterEachStep: body.pauseAfterEachStep,
      stopAtStepId: body.stopAtStepId,
      expectationOverrides: body.expectationOverrides
    });
    res.status(202).json({ run });
  } catch (error) {
    if (sendKnownError(res, error)) {
      return;
    }
    sendError(res, error);
  }
});

app.get("/api/runs/:id", (req, res) => {
  const run = storage.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({ run, active: runner.isRunning(req.params.id) || flowRunner.isRunning(req.params.id) || graphRunner.isRunning(req.params.id) || stabilityExplorer.isRunning(req.params.id) || assetPatrol.isRunning(req.params.id) });
});

app.get("/api/flow-runs/:id", (req, res) => {
  const run = storage.getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Flow run not found" });
    return;
  }
  const active = flowRunner.isRunning(req.params.id) || runner.isRunning(req.params.id);
  res.json({ run, active, flowRun: summarizeRun(run, active) });
});

async function stopRunByKind(runId: string, runKind: TestRun["config"]["runKind"] | undefined): Promise<boolean> {
  for (const target of orderedRunStopTargets(runKind)) {
    const stopped = await stopRunTarget(target, runId);
    if (stopped) {
      return true;
    }
  }
  return false;
}

function stopRunTarget(target: RunStopTarget, runId: string): Promise<boolean> {
  if (target === "asset_patrol") {
    return assetPatrol.stop(runId);
  }
  if (target === "stability") {
    return stabilityExplorer.stop(runId);
  }
  if (target === "graph") {
    return graphRunner.stop(runId);
  }
  if (target === "flow") {
    return flowRunner.stop(runId);
  }
  return runner.stop(runId);
}

app.post("/api/runs/:id/stop", async (req, res) => {
  try {
    const runBeforeStop = storage.getRun(req.params.id);
    const stopped = await stopRunByKind(req.params.id, runBeforeStop?.config.runKind);
    const run = storage.getRun(req.params.id);
    res.json({ stopped, run, active: runner.isRunning(req.params.id) || flowRunner.isRunning(req.params.id) || graphRunner.isRunning(req.params.id) || stabilityExplorer.isRunning(req.params.id) || assetPatrol.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/pause", (req, res) => {
  try {
    const run = runner.pause(req.params.id) ?? flowRunner.pause(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) || flowRunner.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/resume", (req, res) => {
  try {
    const run = runner.resume(req.params.id) ?? flowRunner.resume(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) || flowRunner.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/step", (req, res) => {
  try {
    const run = runner.step(req.params.id) ?? flowRunner.step(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) || flowRunner.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/reports/:runId/html", async (req, res) => {
  const run = storage.getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.send(renderReportHtml(run));
});

app.get("/api/reports/:runId/artifact-html", async (req, res) => {
  const run = storage.getRun(req.params.runId);
  if (!run?.reportHtmlPath) {
    res.status(404).json({ error: "Report artifact not found" });
    return;
  }
  let reportPath: string;
  try {
    reportPath = artifactFilePath(run.reportHtmlPath);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    return;
  }
  const exists = await access(reportPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    res.status(404).json({
      error: "Report artifact missing",
      path: run.reportHtmlPath
    });
    return;
  }
  res.sendFile(reportPath, artifactSendFileOptions);
});

app.use(express.static(dashboardDist, { fallthrough: true }));

app.use(async (req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/artifacts")) {
    next();
    return;
  }
  const exists = await access(dashboardIndex)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    next();
    return;
  }
  res.sendFile(dashboardIndex);
});

const server = createServer(app);
const webSocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", `http://${request.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/api\/devices\/([^/]+)\/scrcpy\/ws$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const serial = decodeURIComponent(match[1]);
  (socket as Socket).setNoDelay(true);
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    void scrcpyStreamBridge.attach(serial, webSocket).catch((error) => {
      if (webSocket.readyState === webSocket.OPEN) {
        webSocket.send(
          JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : String(error)
          })
        );
        webSocket.close();
      }
    });
  });
});

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

server.listen(port, () => {
  console.log(`Mobile Automation server listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  artifactCleanupScheduler.stop();
  await Promise.all([runner.stopAll(), flowRunner.stopAll(), graphRunner.stopAll(), stabilityExplorer.stopAll(), assetPatrol.stopAll(), scrcpyStreamBridge.closeAll(), ocrSidecar.stop()]);
}

function sendError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
}

function sendKnownError(res: express.Response, error: unknown): boolean {
  if (error instanceof DeviceBusyError) {
    res.status(409).json({
      error: "设备正在执行用例，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial
    });
    return true;
  }
  if (error instanceof GraphDeviceBusyError) {
    res.status(409).json({
      error: "设备正在执行图谱用例，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial
    });
    return true;
  }
  if (error instanceof StabilityExplorerDeviceBusyError) {
    res.status(409).json({
      error: "设备正在执行稳定性探索，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial
    });
    return true;
  }
  if (error instanceof AssetPatrolDeviceBusyError) {
    res.status(409).json({
      error: "设备正在执行资产驱动巡检，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial
    });
    return true;
  }
  if (error instanceof GraphTargetResolutionError) {
    res.status(422).json({
      error: error.message,
      targetResolution: error.targetResolution
    });
    return true;
  }
  return false;
}

function readAssetPatrolRequest(body: unknown): AssetPatrolStartInput {
  const input = (body ?? {}) as {
    deviceSerial?: string;
    packageName?: string;
    graphVersionId?: string;
    startMode?: string;
    pageScope?: string;
    maxDurationMs?: unknown;
    maxTransitions?: unknown;
    allowRiskyActions?: unknown;
    allowBusinessSubmit?: unknown;
    dangerousTextPatterns?: unknown;
    runtimeParams?: unknown;
  };
  return {
    deviceSerial: input.deviceSerial?.trim() ?? "",
    packageName: input.packageName?.trim() ?? "",
    graphVersionId: input.graphVersionId?.trim() || undefined,
    startMode: readAssetPatrolStartMode(input.startMode),
    pageScope: readAssetPatrolPageScope(input.pageScope),
    maxDurationMs: typeof input.maxDurationMs === "number" || typeof input.maxDurationMs === "string" ? Number(input.maxDurationMs) : undefined,
    maxTransitions: typeof input.maxTransitions === "number" || typeof input.maxTransitions === "string" ? Number(input.maxTransitions) : undefined,
    allowRiskyActions: readOptionalBoolean(input.allowRiskyActions),
    allowBusinessSubmit: readOptionalBoolean(input.allowBusinessSubmit),
    dangerousTextPatterns: readRawStringArray(input.dangerousTextPatterns),
    runtimeParams: readAssetPatrolRuntimeParams(input.runtimeParams)
  };
}

function findAssetPatrolGraphVersion(packageName: string, graphVersionId?: string): BusinessGraphVersion | undefined {
  if (graphVersionId) {
    return storage.getBusinessGraphVersion(graphVersionId);
  }
  const normalizedPackageName = packageName.trim();
  if (!normalizedPackageName) {
    return undefined;
  }
  const graph = storage.listBusinessGraphs().find((item) => item.status === "active" && item.targetApp?.androidPackageName === normalizedPackageName && item.activeVersionId)
    ?? storage.listBusinessGraphs().find((item) => item.status === "active" && item.appId === normalizedPackageName && item.activeVersionId);
  return graph?.activeVersionId ? storage.getBusinessGraphVersion(graph.activeVersionId) : undefined;
}

function readAssetPatrolStartMode(value: string | undefined): AssetPatrolStartMode | undefined {
  return value === "current_state" || value === "launch_app" || value === "restart_app" ? value : undefined;
}

function readAssetPatrolPageScope(value: string | undefined): AssetPatrolPageScope | undefined {
  return value === "current_page" || value === "reachable_pages" || value === "tagged_pages" || value === "all_active_pages" ? value : undefined;
}

function readStabilityExplorerRequest(body: unknown): StabilityExplorerStartInput {
  const input = (body ?? {}) as {
    deviceSerial?: string;
    packageName?: string;
    maxDurationMs?: unknown;
    maxActions?: unknown;
    strategy?: string;
    startMode?: string;
    allowedActions?: unknown;
    seed?: string;
    appExitPolicy?: string;
    backtrackStrategy?: string;
    maxDepth?: unknown;
    dangerousTextPatterns?: unknown;
    stopOnCrash?: unknown;
    stopOnAnr?: unknown;
    stopOnBlackScreen?: unknown;
    stopOnUnknownPageStuck?: unknown;
  };
  return {
    deviceSerial: input.deviceSerial?.trim() ?? "",
    packageName: input.packageName?.trim() ?? "",
    maxDurationMs: typeof input.maxDurationMs === "number" || typeof input.maxDurationMs === "string" ? Number(input.maxDurationMs) : undefined,
    maxActions: typeof input.maxActions === "number" || typeof input.maxActions === "string" ? Number(input.maxActions) : undefined,
    strategy: readStabilityExplorerStrategy(input.strategy),
    startMode: readStabilityStartMode(input.startMode),
    allowedActions: readStabilityAllowedActions(input.allowedActions),
    seed: input.seed?.trim() || undefined,
    appExitPolicy: readStabilityAppExitPolicy(input.appExitPolicy),
    backtrackStrategy: readStabilityBacktrackStrategy(input.backtrackStrategy),
    maxDepth: typeof input.maxDepth === "number" || typeof input.maxDepth === "string" ? Number(input.maxDepth) : undefined,
    dangerousTextPatterns: readRawStringArray(input.dangerousTextPatterns),
    stopOnCrash: readOptionalBoolean(input.stopOnCrash),
    stopOnAnr: readOptionalBoolean(input.stopOnAnr),
    stopOnBlackScreen: readOptionalBoolean(input.stopOnBlackScreen),
    stopOnUnknownPageStuck: readOptionalBoolean(input.stopOnUnknownPageStuck)
  };
}

function readStabilityExplorerStrategy(value: string | undefined): StabilityExplorerStrategy | undefined {
  return value === "conservative" || value === "balanced" || value === "aggressive" ? value : undefined;
}

function readStabilityStartMode(value: string | undefined): StabilityExplorerStartMode | undefined {
  return value === "launch_app" || value === "current_state" || value === "restart_app" ? value : undefined;
}

function readStabilityAppExitPolicy(value: string | undefined): StabilityExplorerAppExitPolicy | undefined {
  return value === "back_to_app" || value === "restart_app" || value === "stop" ? value : undefined;
}

function readStabilityBacktrackStrategy(value: string | undefined): StabilityExplorerBacktrackStrategy | undefined {
  return value === "none" || value === "shallow" || value === "depth_first" ? value : undefined;
}

function readStabilityAllowedActions(value: unknown): StabilityExplorerAllowedAction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is StabilityExplorerAllowedAction => item === "tap" || item === "swipe" || item === "back" || item === "wait");
}

function readRawStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readAssetPatrolRuntimeParams(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string")
      .map(([key, item]) => [key.trim(), item])
      .filter(([key]) => Boolean(key))
  );
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function parseOptionalRatio(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, parsed));
}

function readSourceScanRequest(body: unknown): Parameters<typeof scanAndroidSource>[0] {
  const input = (body ?? {}) as {
    appId?: string;
    targetApp?: GraphTargetApp;
    androidPackageName?: string;
    repoPath?: string;
    includePatterns?: string[];
    excludePatterns?: string[];
    maxFiles?: number;
  };
  if (!input.appId?.trim()) {
    throw new Error("appId is required");
  }
  if (!input.repoPath?.trim()) {
    throw new Error("repoPath is required");
  }
  return {
    appId: input.appId.trim(),
    targetApp: readGraphTargetApp(input),
    repoPath: input.repoPath.trim(),
    platform: "android",
    includePatterns: Array.isArray(input.includePatterns) ? input.includePatterns : undefined,
    excludePatterns: Array.isArray(input.excludePatterns) ? input.excludePatterns : undefined,
    maxFiles: Number.isFinite(input.maxFiles)
      ? Math.min(maxSourceScanMaxFiles, Math.max(100, Number(input.maxFiles)))
      : defaultSourceScanMaxFiles
  };
}

function readRecordingGraphAssetRequest(body: unknown): {
  step: ActionStep;
  beforeObservation: Observation;
  afterObservation?: Observation;
  deviceSerial?: string;
  includeOcr: boolean;
  confirm: boolean;
} {
  const input = (body ?? {}) as {
    step?: ActionStep;
    beforeObservation?: Observation;
    afterObservation?: Observation;
    deviceSerial?: string;
    includeOcr?: boolean;
    confirm?: boolean;
  };
  if (!isActionStep(input.step)) {
    throw new Error("step is required");
  }
  if (!isObservation(input.beforeObservation)) {
    throw new Error("beforeObservation is required");
  }
  if (input.afterObservation !== undefined && !isObservation(input.afterObservation)) {
    throw new Error("afterObservation is invalid");
  }
  return {
    step: input.step,
    beforeObservation: input.beforeObservation,
    afterObservation: input.afterObservation,
    deviceSerial: input.deviceSerial?.trim() || undefined,
    includeOcr: typeof input.includeOcr === "boolean" ? input.includeOcr : false,
    confirm: input.confirm === true
  };
}

type AutoExploreApiRequest = {
  sourceNodeId?: string;
  observation?: Observation;
  deviceSerial?: string;
  maxDepth: number;
  maxCandidates: number;
  maxActions: number;
  recoveryBackLimit: number;
};

function readAutoExploreRequest(body: unknown): AutoExploreApiRequest {
  const input = (body ?? {}) as {
    sourceNodeId?: string;
    observation?: Observation;
    deviceSerial?: string;
    maxDepth?: number;
    maxCandidates?: number;
    maxActions?: number;
    recoveryBackLimit?: number;
  };
  if (input.observation !== undefined && !isObservation(input.observation)) {
    throw new Error("observation is invalid");
  }
  return {
    sourceNodeId: input.sourceNodeId?.trim() || undefined,
    observation: input.observation,
    deviceSerial: input.deviceSerial?.trim() || undefined,
    maxDepth: clampNumber(input.maxDepth, 1, 1, 3),
    maxCandidates: clampNumber(input.maxCandidates, 12, 1, 30),
    maxActions: clampNumber(input.maxActions, input.maxCandidates ?? 8, 1, 30),
    recoveryBackLimit: clampNumber(input.recoveryBackLimit, 1, 0, 3)
  };
}

async function resolveAutoExploreObservation(body: AutoExploreApiRequest): Promise<Observation | undefined> {
  return body.observation ?? (body.deviceSerial ? collectFastVisualObservation(body.deviceSerial) : undefined);
}

async function collectFastVisualObservation(deviceSerial: string): Promise<Observation> {
  return observationService.collect(deviceSerial, {
    includeScreenshot: true,
    includeUiTree: false,
    includeOcr: true
  });
}

async function resolveAutoExploreSource(
  graphVersion: ReturnType<Storage["getBusinessGraphVersion"]> extends infer T ? NonNullable<T> : never,
  observation: Observation,
  requestedSourceNodeId?: string
): Promise<{
  sourceNodeId?: string;
  match?: Awaited<ReturnType<typeof matchCurrentPage>>["match"];
  message?: string;
}> {
  if (requestedSourceNodeId) {
    return { sourceNodeId: requestedSourceNodeId };
  }
  const match = await matchCurrentPage({
    graphVersion,
    observation,
    baselineReader: readPageAssetBaselineArtifact
  });
  if (match.match.status !== "matched" || !match.match.node) {
    return {
      match: match.match,
      message: "当前页面没有匹配到已保存页面资产，自动探索不会创建运行期草稿。"
    };
  }
  return {
    sourceNodeId: match.match.node.id,
    match: match.match
  };
}

async function executeAutoExploreCandidate(input: {
  deviceSerial: string;
  graphVersion: ReturnType<Storage["getBusinessGraphVersion"]> extends infer T ? NonNullable<T> : never;
  candidate: AutoExploreCandidate;
  beforeObservation: Observation;
}): Promise<AutoExploreCandidateResult> {
  if (input.candidate.status === "skipped") {
    return {
      candidateId: input.candidate.id,
      candidateLabel: input.candidate.label,
      status: "skipped",
      resultType: "dangerous_skipped",
      message: input.candidate.skipReason ?? "候选动作被安全策略跳过。"
    };
  }
  const action = candidateActionForObservation(input.candidate, input.beforeObservation);
  if (!action) {
    return {
      candidateId: input.candidate.id,
      candidateLabel: input.candidate.label,
      status: "failed",
      resultType: "failed",
      message: "无法把候选区域转换为设备动作。"
    };
  }
  await driver.performAction(input.deviceSerial, action);
  await delay(800);
  const afterObservation = await collectFastVisualObservation(input.deviceSerial);
  const afterMatch = await matchCurrentPage({
    graphVersion: input.graphVersion,
    observation: afterObservation,
    baselineReader: readPageAssetBaselineArtifact
  });
  return {
    ...classifyExplorationResult({
      sourceNodeId: input.candidate.sourceNodeId,
      beforeObservation: input.beforeObservation,
      afterObservation,
      afterMatch: afterMatch.match
    }),
    candidateId: input.candidate.id,
    candidateLabel: input.candidate.label
  };
}

async function recoverExplorerSource(
  deviceSerial: string,
  graphVersion: ReturnType<Storage["getBusinessGraphVersion"]> extends infer T ? NonNullable<T> : never,
  targetSourceNodeId: string,
  backLimit: number
): Promise<{ sourceNodeId?: string; observation?: Observation }> {
  let observation = await collectFastVisualObservation(deviceSerial);
  for (let attempt = 0; attempt <= backLimit; attempt += 1) {
    const match = await matchCurrentPage({
      graphVersion,
      observation,
      baselineReader: readPageAssetBaselineArtifact
    });
    if (match.match.status === "matched" && match.match.node?.id === targetSourceNodeId) {
      return { sourceNodeId: targetSourceNodeId, observation };
    }
    if (attempt >= backLimit) {
      break;
    }
    await driver.performAction(deviceSerial, { type: "back" });
    await delay(700);
    observation = await collectFastVisualObservation(deviceSerial);
  }
  return { observation };
}

function autoExploreBlockedReport(message: string, maxDepth: number, maxActions: number) {
  return {
    status: "blocked" as const,
    version: maxDepth > 1 ? "v2" as const : "v1" as const,
    blockReason: "source_not_found" as const,
    message,
    candidates: [],
    plan: {
      version: maxDepth > 1 ? "v2" as const : "v1" as const,
      maxDepth,
      maxActions,
      steps: []
    },
    results: []
  };
}

async function startAssetDrivenGraphTarget(deviceSerial: string, target: AssetDrivenReadyExecutionTarget) {
  return graphRunner.start({
    deviceSerial,
    graphVersionId: target.graphVersionId,
    startNodeId: target.startNodeId,
    targetNodeId: target.targetNodeId,
    startStrategy: "keep_current",
    startAppScope: "current_device",
    executionProfile: "fast_visual",
    stopOnFailure: true,
    overlay: target.overlay
  });
}

async function continueAssetDrivenExecutionQueue(input: {
  body: AssetPatrolStartInput;
  config: ReturnType<typeof normalizeAssetPatrolConfig>;
  startNodeId: string;
  targets: AssetDrivenReadyExecutionTarget[];
  firstRunId: string;
  session: AssetDrivenExecutionSession;
  queueState: { runId: string; sessionId: string; cancelled?: boolean; promise: Promise<void> };
}): Promise<void> {
  let previousRunId = input.firstRunId;
  await graphRunner.waitForRun(previousRunId);
  const firstRun = storage.getRun(previousRunId);
  if (firstRun) {
    updateAssetDrivenExecutionItemFromRun(input.session, firstRun);
  }
  if (input.queueState.cancelled) {
    return;
  }
  for (const target of input.targets.slice(1)) {
    if (input.queueState.cancelled) {
      return;
    }
    const previousRun = storage.getRun(previousRunId);
    if (previousRun?.status !== "passed") {
      skipPendingAssetDrivenExecutionItems(input.session, `前置边 ${previousRunId} 未通过，停止后续资产边执行。`);
      return;
    }
    const restored = await recoverAssetDrivenStartPage({
      body: input.body,
      packageName: input.config.packageName,
      startNodeId: input.startNodeId
    });
    if (!restored) {
      skipPendingAssetDrivenExecutionItems(input.session, "未能恢复到本轮资产测试的起始页面。");
      return;
    }
    if (input.queueState.cancelled) {
      return;
    }
    await handleAssetDrivenRuntimeInterceptors(input.body.deviceSerial, input.config.packageName);
    if (input.queueState.cancelled) {
      return;
    }
    const started = await startAssetDrivenGraphTarget(input.body.deviceSerial, target);
    previousRunId = started.run.id;
    input.queueState.runId = previousRunId;
    const itemIndex = input.targets.indexOf(target);
    markAssetDrivenExecutionItemStarted(input.session, itemIndex, started.run);
    await graphRunner.waitForRun(previousRunId);
    const completedRun = storage.getRun(previousRunId);
    if (completedRun) {
      updateAssetDrivenExecutionItemFromRun(input.session, completedRun);
    }
  }
}

async function recoverAssetDrivenStartPage(input: {
  body: AssetPatrolStartInput;
  packageName: string;
  startNodeId: string;
  maxBacks?: number;
}): Promise<boolean> {
  const maxBacks = input.maxBacks ?? 3;
  for (let attempt = 0; attempt <= maxBacks; attempt += 1) {
    await handleAssetDrivenRuntimeInterceptors(input.body.deviceSerial, input.packageName);
    const plan = await assetPatrol.preview({
      ...input.body,
      startMode: "current_state",
      pageScope: "current_page"
    });
    if (plan.status === "ready" && plan.startPage?.id === input.startNodeId) {
      return true;
    }
    const graphVersion = plan.graphVersionId ? storage.getBusinessGraphVersion(plan.graphVersionId) : undefined;
    const recoveryTarget = graphVersion && plan.status === "ready" && plan.startPage?.id
      ? selectAssetDrivenRecoveryTarget({
          graphVersion,
          currentNodeId: plan.startPage.id,
          startNodeId: input.startNodeId,
          runtimeParams: input.body.runtimeParams
        })
      : undefined;
    if (recoveryTarget) {
      const started = await startAssetDrivenGraphTarget(input.body.deviceSerial, recoveryTarget);
      await graphRunner.waitForRun(started.run.id);
      if (storage.getRun(started.run.id)?.status !== "passed") {
        return false;
      }
      await delay(500);
      continue;
    }
    if (
      graphVersion &&
      plan.status === "ready" &&
      plan.startPage?.id &&
      shouldAvoidBackRecovery({ graphVersion, currentNodeId: plan.startPage.id, startNodeId: input.startNodeId })
    ) {
      return false;
    }
    if (attempt >= maxBacks) {
      break;
    }
    await driver.performAction(input.body.deviceSerial, { type: "back" });
    await delay(700);
  }
  return false;
}

function isObservationInTargetApp(observation: Observation, targetApp: GraphTargetApp | undefined): boolean {
  if (!targetApp?.androidPackageName && !targetApp?.iosBundleId) {
    return true;
  }
  if (observation.platform === "android" && targetApp.androidPackageName) {
    return observation.packageName === targetApp.androidPackageName;
  }
  if (observation.platform === "ios" && targetApp.iosBundleId) {
    return observation.bundleId === targetApp.iosBundleId;
  }
  return true;
}

async function handleAssetDrivenRuntimeInterceptors(deviceSerial: string, packageName: string): Promise<void> {
  const interceptor = new RuntimeInterceptor({
    observe: () => observationService.collect(deviceSerial, {
      includeScreenshot: true,
      includeUiTree: true,
      includeOcr: true
    }),
    performAction: async (action) => {
      await driver.performAction(deviceSerial, runtimeInterceptorActionStepToDeviceAction(action));
      await delay(500);
    }
  }, storage.listRuntimeInterceptorRules({
    enabledOnly: true,
    platform: "android",
    appPackageName: packageName
  }));
  await interceptor.handle({ phase: "precondition", maxPasses: 2 });
}

function runtimeInterceptorActionStepToDeviceAction(action: ActionStep): DeviceActionRequest {
  if (
    (action.type === "tap_on_text" || action.type === "tap_on_element") &&
    typeof action.coordinate?.x === "number" &&
    typeof action.coordinate.y === "number"
  ) {
    return {
      type: "tap",
      x: Math.round(action.coordinate.x),
      y: Math.round(action.coordinate.y)
    };
  }
  if (action.type === "back") {
    return { type: "back" };
  }
  throw new Error(`Unsupported runtime interceptor action for asset-driven test: ${action.type}`);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function readManualPageTransitionRequest(body: unknown): {
  sourceNodeId: string;
  targetNodeId: string;
  actionKind: ManualPageTransitionActionKind;
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  availability: ManualPageTransitionAvailability;
  outcomeType: ManualPageTransitionOutcomeType;
  targetLabel?: string;
  platformScope?: Platform | "mobile-both";
  abilityType?: ManualPageAbilityType;
  scrollProfile?: ManualPageTransitionScrollProfile;
  compoundSteps?: ManualPageTransitionCompoundStep[];
  locatorKind?: ManualPageElementLocatorKind;
  dynamicMasks?: ManualPageElementDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: ManualDynamicRegion;
  itemTemplate?: ManualItemTemplate;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
} {
  const input = (body ?? {}) as {
    sourceNodeId?: string;
    targetNodeId?: string;
    actionKind?: string;
    locator?: string;
    semanticArea?: string;
    coordinateSpace?: string;
    elementLabel?: string;
    targetText?: string;
    availability?: string;
    outcomeType?: string;
    targetLabel?: string;
    platformScope?: Platform | "mobile-both";
    abilityType?: string;
    scrollProfile?: unknown;
    compoundSteps?: unknown;
    locatorKind?: unknown;
    dynamicMasks?: unknown;
    structuralLocator?: unknown;
    dynamicRegion?: unknown;
    itemTemplate?: unknown;
    transitionKind?: unknown;
    parameterMapping?: unknown;
  };
  const sourceNodeId = input.sourceNodeId?.trim();
  const targetNodeId = input.targetNodeId?.trim();
  const locator = input.locator?.trim();
  const elementLabel = input.elementLabel?.trim();
  if (!sourceNodeId) {
    throw new Error("sourceNodeId is required");
  }
  if (!targetNodeId) {
    throw new Error("targetNodeId is required");
  }
  if (!locator) {
    throw new Error("locator is required");
  }
  return {
    sourceNodeId,
    targetNodeId,
    actionKind: readManualActionKind(input.actionKind),
    locator,
    semanticArea: readVisualSemanticArea(input.semanticArea),
    coordinateSpace: readCoordinateSpace(input.coordinateSpace),
    elementLabel: elementLabel || locator,
    targetText: input.targetText?.trim() || undefined,
    availability: readManualAvailability(input.availability),
    outcomeType: readManualOutcomeType(input.outcomeType),
    targetLabel: input.targetLabel?.trim() || undefined,
    platformScope: input.platformScope === "ios" || input.platformScope === "mobile-both" ? input.platformScope : "android",
    abilityType: readManualAbilityType(input.abilityType),
    scrollProfile: readManualScrollProfile(input.scrollProfile),
    compoundSteps: readManualCompoundSteps(input.compoundSteps),
    locatorKind: readManualLocatorKind(input.locatorKind),
    dynamicMasks: readManualDynamicMasks(input.dynamicMasks),
    structuralLocator: readPlainRecord(input.structuralLocator),
    dynamicRegion: readManualDynamicRegion(input.dynamicRegion),
    itemTemplate: readManualItemTemplate(input.itemTemplate),
    transitionKind: readManualTransitionKind(input.transitionKind),
    parameterMapping: readStringRecord(input.parameterMapping)
  };
}

function readPageTaskNavigationTransitionRequest(body: unknown): {
  sourceNodeId: string;
  targetNodeId: string;
  taskId: string;
  taskName?: string;
  platformScope?: Platform | "mobile-both";
} {
  const input = (body ?? {}) as {
    sourceNodeId?: string;
    targetNodeId?: string;
    taskId?: string;
    taskName?: string;
    platformScope?: Platform | "mobile-both";
  };
  const sourceNodeId = input.sourceNodeId?.trim();
  const targetNodeId = input.targetNodeId?.trim();
  const taskId = input.taskId?.trim();
  if (!sourceNodeId) {
    throw new Error("sourceNodeId is required");
  }
  if (!targetNodeId) {
    throw new Error("targetNodeId is required");
  }
  if (!taskId) {
    throw new Error("taskId is required");
  }
  return {
    sourceNodeId,
    targetNodeId,
    taskId,
    taskName: input.taskName?.trim() || undefined,
    platformScope: input.platformScope === "ios" || input.platformScope === "mobile-both" ? input.platformScope : "android"
  };
}

function readPageTaskAssetRequest(body: unknown): {
  sourceNodeId: string;
  taskId?: string;
  name: string;
  status?: "active" | "draft" | "deprecated";
  steps: PageTaskAssetStep[];
} {
  const input = (body ?? {}) as {
    sourceNodeId?: string;
    taskId?: string;
    name?: string;
    status?: string;
    steps?: unknown;
  };
  const sourceNodeId = input.sourceNodeId?.trim();
  const name = input.name?.trim();
  if (!sourceNodeId) {
    throw new Error("sourceNodeId is required");
  }
  if (!name) {
    throw new Error("name is required");
  }
  if (!Array.isArray(input.steps)) {
    throw new Error("steps must be an array");
  }
  return {
    sourceNodeId,
    taskId: input.taskId?.trim() || undefined,
    name,
    status: readPageTaskStatus(input.status),
    steps: input.steps.map(readPageTaskStepRequest).filter((step): step is PageTaskAssetStep => Boolean(step))
  };
}

function readPageTaskStepRequest(value: unknown, index: number): PageTaskAssetStep | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const fieldType = readPageTaskFieldType(input.fieldType);
  const elementId = nonEmptyString(input.elementId);
  if (fieldType !== "wait" && !elementId) {
    return undefined;
  }
  return {
    id: nonEmptyString(input.id),
    order: readPositiveNumber(input.order) ?? index + 1,
    elementId,
    fieldType,
    label: nonEmptyString(input.label),
    valueParamKey: nonEmptyString(input.valueParamKey),
    desiredStateParamKey: nonEmptyString(input.desiredStateParamKey),
    text: nonEmptyString(input.text)
  };
}

function readPageTaskStatus(value: unknown): "active" | "draft" | "deprecated" | undefined {
  return value === "draft" || value === "deprecated" || value === "active" ? value : undefined;
}

function readPageTaskFieldType(value: unknown): PageTaskFieldType {
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

function readManualPageElementRequest(body: unknown): {
  elementId?: string;
  sourceNodeId: string;
  actionKind: ManualPageTransitionActionKind;
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  availability: ManualPageTransitionAvailability;
  platformScope?: Platform | "mobile-both";
  outcomeType?: ManualPageTransitionOutcomeType;
  outcomeLabel?: string;
  targetNodeId?: string;
  targetLabel?: string;
  abilityType?: ManualPageAbilityType;
  scrollProfile?: ManualPageTransitionScrollProfile;
  tapPointPercent?: { x: number; y: number };
  compoundSteps?: ManualPageTransitionCompoundStep[];
  quality?: PageElementQualityResult;
  visualLocator?: Record<string, unknown>;
  locatorKind?: ManualPageElementLocatorKind;
  dynamicMasks?: ManualPageElementDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: ManualDynamicRegion;
  itemTemplate?: ManualItemTemplate;
  transitionKind?: "static" | "parameterized";
  parameterMapping?: Record<string, string>;
} {
  const input = (body ?? {}) as {
    elementId?: string;
    sourceNodeId?: string;
    actionKind?: string;
    locator?: string;
    semanticArea?: string;
    coordinateSpace?: string;
    elementLabel?: string;
    targetText?: string;
    availability?: string;
    platformScope?: Platform | "mobile-both";
    outcomeType?: string;
    outcomeLabel?: string;
    targetNodeId?: string;
    targetLabel?: string;
    abilityType?: string;
    scrollProfile?: unknown;
    tapPointPercent?: unknown;
    compoundSteps?: unknown;
    quality?: unknown;
    visualLocator?: unknown;
    locatorKind?: unknown;
    dynamicMasks?: unknown;
    structuralLocator?: unknown;
    dynamicRegion?: unknown;
    itemTemplate?: unknown;
    transitionKind?: unknown;
    parameterMapping?: unknown;
  };
  const sourceNodeId = input.sourceNodeId?.trim();
  const locator = input.locator?.trim();
  const elementLabel = input.elementLabel?.trim();
  if (!sourceNodeId) {
    throw new Error("sourceNodeId is required");
  }
  if (!locator) {
    throw new Error("locator is required");
  }
  return {
    elementId: input.elementId?.trim() || undefined,
    sourceNodeId,
    actionKind: readManualActionKind(input.actionKind),
    locator,
    semanticArea: readVisualSemanticArea(input.semanticArea),
    coordinateSpace: readCoordinateSpace(input.coordinateSpace),
    elementLabel: elementLabel || locator,
    targetText: input.targetText?.trim() || undefined,
    availability: readManualAvailability(input.availability),
    platformScope: input.platformScope === "ios" || input.platformScope === "mobile-both" ? input.platformScope : "android",
    outcomeType: readManualElementOutcomeType(input.outcomeType),
    outcomeLabel: input.outcomeLabel?.trim() || undefined,
    targetNodeId: input.targetNodeId?.trim() || undefined,
    targetLabel: input.targetLabel?.trim() || undefined,
    abilityType: readManualAbilityType(input.abilityType),
    scrollProfile: readManualScrollProfile(input.scrollProfile),
    tapPointPercent: readManualTapPointPercent(input.tapPointPercent),
    compoundSteps: readManualCompoundSteps(input.compoundSteps),
    quality: readPageElementQuality(input.quality),
    visualLocator: readPlainRecord(input.visualLocator),
    locatorKind: readManualLocatorKind(input.locatorKind),
    dynamicMasks: readManualDynamicMasks(input.dynamicMasks),
    structuralLocator: readPlainRecord(input.structuralLocator),
    dynamicRegion: readManualDynamicRegion(input.dynamicRegion),
    itemTemplate: readManualItemTemplate(input.itemTemplate),
    transitionKind: readManualTransitionKind(input.transitionKind),
    parameterMapping: readStringRecord(input.parameterMapping)
  };
}

async function createPageElementVisualLocator(
  observation: Observation | undefined,
  region: { x: number; y: number; width: number; height: number }
): Promise<Record<string, unknown> | undefined> {
  const screenshotBase64 = observation?.raw?.screenshotBase64;
  if (typeof screenshotBase64 !== "string" || !screenshotBase64) {
    return undefined;
  }
  const template = await createVisualLocatorTemplate({
    screenshot: Buffer.from(screenshotBase64, "base64"),
    percentRegion: region,
    resolution: observation.resolution,
    sampleSize: 16
  });
  if (!template) {
    return undefined;
  }
  return {
    version: 1,
    strategy: "recorded_crop_template",
    minTemplateSimilarity: 0.82,
    template
  };
}

async function resolvePageElementQualityObservation(body: unknown): Promise<Observation | undefined> {
  const input = (body ?? {}) as {
    observation?: Observation;
    deviceSerial?: string;
    includeOcr?: boolean;
    lang?: string;
  };
  if (input.observation && typeof input.observation === "object") {
    return input.observation;
  }
  const deviceSerial = input.deviceSerial?.trim();
  if (!deviceSerial) {
    return undefined;
  }
  return observationService.collect(deviceSerial, {
    includeScreenshot: true,
    includeUiTree: true,
    includeOcr: input.includeOcr ?? true,
    lang: input.lang
  });
}

function readManualElementsForQuality(value: unknown): Array<{ id?: string; label?: string; locator?: string; actionKind?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): { id?: string; label?: string; locator?: string; actionKind?: string } | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      return {
        id: nonEmptyString(record.id),
        label: nonEmptyString(record.label),
        locator: nonEmptyString(record.locator),
        actionKind: nonEmptyString(record.actionKind)
      };
    })
    .filter((item): item is { id?: string; label?: string; locator?: string; actionKind?: string } => Boolean(item));
}

function readPageElementQuality(value: unknown): PageElementQualityResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const status = input.status === "pass" || input.status === "needs_review" || input.status === "fail" ? input.status : undefined;
  const score = typeof input.score === "number" && Number.isFinite(input.score) ? input.score : undefined;
  if (!status || score === undefined) {
    return undefined;
  }
  return {
    status,
    score,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter(isQualityWarning) : [],
    candidates: Array.isArray(input.candidates) ? input.candidates.filter(isQualityCandidate) : [],
    evidence: input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence) ? input.evidence as PageElementQualityResult["evidence"] : {
      uniqueCandidate: false,
      candidateCount: 0
    }
  };
}

function readPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readPlainRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return records.length ? records : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  const record = readPlainRecord(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record)
    .map(([key, entryValue]) => [key.trim(), typeof entryValue === "string" ? entryValue.trim() : ""] as const)
    .filter(([key, entryValue]) => Boolean(key && entryValue));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function readManualLocatorKind(value: unknown): ManualPageElementLocatorKind | undefined {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator"
    ? value
    : undefined;
}

function readManualTransitionKind(value: unknown): "static" | "parameterized" | undefined {
  return value === "static" || value === "parameterized" ? value : undefined;
}

function readPercentRect(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = readManualPercent(input.x);
  const y = readManualPercent(input.y);
  const width = readManualPercent(input.width);
  const height = readManualPercent(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function readManualDynamicMasks(value: unknown): ManualPageElementDynamicMask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const masks = value
    .map((item): ManualPageElementDynamicMask | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const input = item as Record<string, unknown>;
      const region = readPercentRect(input.region);
      if (!region) {
        return undefined;
      }
      return {
        kind: readDynamicMaskKind(input.kind),
        label: typeof input.label === "string" && input.label.trim() ? input.label.trim() : undefined,
        region,
        reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : undefined
      };
    })
    .filter((item): item is ManualPageElementDynamicMask => Boolean(item));
  return masks.length ? masks : undefined;
}

function readDynamicMaskKind(value: unknown): ManualPageElementDynamicMask["kind"] {
  return value === "avatar" || value === "text" || value === "image" || value === "number" ? value : "custom";
}

function readManualDynamicRegion(value: unknown): ManualDynamicRegion | undefined {
  const input = readPlainRecord(value);
  const id = typeof input?.id === "string" ? input.id.trim() : "";
  const label = typeof input?.label === "string" ? input.label.trim() : "";
  const region = readPercentRect(input?.region);
  if (!input || !id || !label || !region) {
    return undefined;
  }
  const itemTemplateId = typeof input.itemTemplateId === "string" && input.itemTemplateId.trim() ? input.itemTemplateId.trim() : undefined;
  return {
    id,
    label,
    kind: readManualDynamicRegionKind(input.kind),
    region,
    ...(itemTemplateId ? { itemTemplateId } : {}),
    ...(readPlainRecordArray(input.dynamicFieldRules) ? { dynamicFieldRules: readPlainRecordArray(input.dynamicFieldRules) } : {})
  };
}

function readManualDynamicRegionKind(value: unknown): ManualDynamicRegion["kind"] {
  return value === "grid" || value === "feed" || value === "form_group" ? value : "list";
}

function readManualItemTemplate(value: unknown): ManualItemTemplate | undefined {
  const input = readPlainRecord(value);
  const id = typeof input?.id === "string" ? input.id.trim() : "";
  const label = typeof input?.label === "string" ? input.label.trim() : "";
  if (!input || !id || !label) {
    return undefined;
  }
  return {
    id,
    label,
    ...(readPercentRect(input.region) ? { region: readPercentRect(input.region) } : {}),
    ...(readPercentRect(input.actionArea) ? { actionArea: readPercentRect(input.actionArea) } : {}),
    ...(readPlainRecord(input.stableStructure) ? { stableStructure: readPlainRecord(input.stableStructure) } : {}),
    ...(readPlainRecordArray(input.stableAnchors) ? { stableAnchors: readPlainRecordArray(input.stableAnchors) } : {}),
    ...(readPlainRecordArray(input.dynamicFields) ? { dynamicFields: readPlainRecordArray(input.dynamicFields) } : {})
  };
}

function isQualityWarning(value: unknown): value is PageElementQualityResult["warnings"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return typeof input.code === "string" && typeof input.message === "string" && (input.severity === "info" || input.severity === "warning" || input.severity === "error");
}

function isQualityCandidate(value: unknown): value is PageElementQualityResult["candidates"][number] {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePercentRegionFromLocator(locator: string): { x: number; y: number; width: number; height: number } | undefined {
  if (!locator.startsWith("image-region:")) {
    return undefined;
  }
  const [x, y, width, height] = locator
    .replace(/^image-region:\s*/, "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function readVisualSemanticArea(value: unknown): "top" | "content" | "bottom" | "unknown" | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function readCoordinateSpace(value: unknown): "screen" | "app_viewport" | "region" | "runtime" | undefined {
  return value === "screen" || value === "app_viewport" || value === "region" || value === "runtime" ? value : undefined;
}

function readManualElementOutcomeType(value: unknown): ManualPageTransitionOutcomeType | undefined {
  if (value === "navigate" || value === "compound_navigation" || value === "show_inline_state" || value === "local_state_change" || value === "no_visible_change") {
    return value;
  }
  return undefined;
}

function readManualActionKind(value: unknown): ManualPageTransitionActionKind {
  return value === "scroll" || value === "long_press" || value === "input" ? value : "tap";
}

function readManualAvailability(value: unknown): ManualPageTransitionAvailability {
  return value === "after_scroll" || value === "conditional" ? value : "visible";
}

function readManualOutcomeType(value: unknown): ManualPageTransitionOutcomeType {
  return value === "compound_navigation" || value === "show_inline_state" || value === "local_state_change" || value === "no_visible_change" ? value : "navigate";
}

function readManualCompoundSteps(value: unknown): ManualPageTransitionCompoundStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const steps = value
    .map(readManualCompoundStep)
    .filter((step): step is ManualPageTransitionCompoundStep => Boolean(step));
  return steps.length ? steps : undefined;
}

function readManualCompoundStep(value: unknown): ManualPageTransitionCompoundStep | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const locator = typeof input.locator === "string" && input.locator.trim() ? input.locator.trim() : undefined;
  if (!locator) {
    return undefined;
  }
  return {
    actionKind: input.actionKind === "wait" ? "wait" : readManualActionKind(input.actionKind),
    locator,
    elementLabel: typeof input.elementLabel === "string" && input.elementLabel.trim() ? input.elementLabel.trim() : locator,
    semanticArea: readVisualSemanticArea(input.semanticArea),
    coordinateSpace: readCoordinateSpace(input.coordinateSpace),
    waitTimeoutMs: readPositiveNumber(input.waitTimeoutMs),
    intervalMs: readPositiveNumber(input.intervalMs)
  };
}

function readPositiveNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  return Number.isFinite(numberValue) && numberValue! > 0 ? numberValue : undefined;
}

function readManualAbilityType(value: unknown): ManualPageAbilityType | undefined {
  return value === "scroll_candidate" || value === "grid_candidate" || value === "conditional_tap" ? value : undefined;
}

function readManualScrollProfile(value: unknown): ManualPageTransitionScrollProfile | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  return {
    containerKind: readManualScrollContainerKind(input.containerKind),
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    columns: readManualScrollColumns(input.columns),
    targetKind: readManualScrollTargetKind(input.targetKind),
    targetQuery: typeof input.targetQuery === "string" && input.targetQuery.trim() ? input.targetQuery.trim() : undefined,
    afterFoundAction: input.afterFoundAction === "tap_child" || input.afterFoundAction === "verify_visible" ? input.afterFoundAction : "tap_item",
    candidateItemHeightPercent: readManualPercent(input.candidateItemHeightPercent),
    clickSafePoint: readManualClickSafePoint(input.clickSafePoint),
    scrollStepPercent: readManualPercent(input.scrollStepPercent),
    failureStrategy: readManualCandidateFailureStrategy(input.failureStrategy)
  };
}

function readManualScrollContainerKind(value: unknown): ManualPageTransitionScrollProfile["containerKind"] {
  return value === "grid_list" || value === "tab_bar" || value === "carousel" || value === "scroll_area" ? value : "list";
}

function readManualScrollTargetKind(value: unknown): ManualPageTransitionScrollProfile["targetKind"] {
  return value === "ocr_text" || value === "semantic_label" || value === "nth_item" || value === "image_region" ? value : "item_text";
}

function readManualScrollColumns(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  if (!Number.isFinite(numberValue) || numberValue! < 1) {
    return undefined;
  }
  return Math.min(6, Math.floor(numberValue!));
}

function readManualPercent(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, numberValue!));
}

function readManualTapPointPercent(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = readManualPercent(input.x);
  const y = readManualPercent(input.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

function readManualClickSafePoint(value: unknown): { xPercent: number; yPercent: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const xPercent = readManualPercent(input.xPercent);
  const yPercent = readManualPercent(input.yPercent);
  if (xPercent === undefined || yPercent === undefined) {
    return undefined;
  }
  return { xPercent, yPercent };
}

function readManualCandidateFailureStrategy(value: unknown): ManualPageTransitionScrollProfile["failureStrategy"] {
  return value === "none" || value === "try_next_candidate" || value === "back_and_try_next_candidate" ? value : undefined;
}

function readRuntimeInterceptorRuleInput(body: unknown): Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt"> & { id?: string } {
  const input = readRuntimeInterceptorRuleShape(body);
  if (!input.name?.trim()) {
    throw new Error("name is required");
  }
  if (!input.matchers?.length && !input.text?.trim()) {
    throw new Error("at least one matcher is required");
  }
  if (!input.action) {
    throw new Error("action is required");
  }
  return {
    id: input.id?.trim() || undefined,
    name: input.name.trim(),
    enabled: input.enabled !== false,
    text: input.text?.trim() || undefined,
    matchers: input.matchers?.length ? input.matchers : input.text ? [{ type: "text", value: input.text.trim() }] : [],
    action: input.action,
    platformScope: input.platformScope,
    appPackageName: input.appPackageName,
    iosBundleId: input.iosBundleId,
    flowId: input.flowId,
    stepId: input.stepId
  };
}

function readRuntimeInterceptorRulePatch(body: unknown): Partial<Omit<RuntimeInterceptorRule, "id" | "createdAt" | "updatedAt">> {
  const input = readRuntimeInterceptorRuleShape(body, true);
  return {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.text !== undefined ? { text: input.text.trim() || undefined } : {}),
    ...(input.matchers !== undefined ? { matchers: input.matchers } : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.platformScope !== undefined ? { platformScope: input.platformScope } : {}),
    ...(input.appPackageName !== undefined ? { appPackageName: input.appPackageName } : {}),
    ...(input.iosBundleId !== undefined ? { iosBundleId: input.iosBundleId } : {}),
    ...(input.flowId !== undefined ? { flowId: input.flowId } : {}),
    ...(input.stepId !== undefined ? { stepId: input.stepId } : {})
  };
}

function readRuntimeInterceptorRuleShape(
  body: unknown,
  partial = false
): Partial<Omit<RuntimeInterceptorRule, "createdAt" | "updatedAt">> & { id?: string; name?: string; action?: RuntimeInterceptorRule["action"] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("rule body must be an object");
  }
  const input = body as Partial<RuntimeInterceptorRule>;
  const action = input.action === undefined && partial ? undefined : readRuntimeInterceptorAction(input.action);
  return {
    id: stringOrUndefined(input.id),
    name: typeof input.name === "string" ? input.name : undefined,
    enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    text: typeof input.text === "string" ? input.text : undefined,
    matchers: input.matchers === undefined ? undefined : readRuntimeInterceptorMatchers(input.matchers),
    action,
    platformScope: input.platformScope === "android" || input.platformScope === "ios" || input.platformScope === "mobile-both" ? input.platformScope : undefined,
    appPackageName: stringOrUndefined(input.appPackageName),
    iosBundleId: stringOrUndefined(input.iosBundleId),
    flowId: stringOrUndefined(input.flowId),
    stepId: stringOrUndefined(input.stepId)
  };
}

function readRuntimeInterceptorMatchers(value: unknown): RuntimeInterceptorRule["matchers"] {
  if (!Array.isArray(value)) {
    throw new Error("matchers must be an array");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("matcher must be an object");
    }
    const input = item as NonNullable<RuntimeInterceptorRule["matchers"]>[number];
    if (input.type !== "text" && input.type !== "resource_id" && input.type !== "content_desc" && input.type !== "activity" && input.type !== "package") {
      throw new Error("unsupported runtime interceptor matcher type");
    }
    if (typeof input.value !== "string" || !input.value.trim()) {
      throw new Error("matcher value is required");
    }
    return {
      type: input.type,
      value: input.value.trim(),
      mode: input.mode === "equals" ? "equals" : "contains"
    };
  });
}

function readRuntimeInterceptorAction(value: unknown): RuntimeInterceptorRule["action"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("action is required");
  }
  const input = value as RuntimeInterceptorRule["action"];
  if (input.type === "back") {
    return { type: "back" };
  }
  if (input.type === "tap_text") {
    if (typeof input.text !== "string" || !input.text.trim()) {
      throw new Error("tap_text action requires text");
    }
    return {
      type: "tap_text",
      text: input.text.trim(),
      mode: input.mode === "equals" ? "equals" : "contains"
    };
  }
  if (input.type === "tap_element") {
    return {
      type: "tap_element",
      resourceId: stringOrUndefined(input.resourceId),
      text: stringOrUndefined(input.text),
      contentDesc: stringOrUndefined(input.contentDesc),
      mode: input.mode === "equals" ? "equals" : "contains"
    };
  }
  throw new Error("unsupported runtime interceptor action type");
}

function isActionStep(value: unknown): value is ActionStep {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<ActionStep>;
  return typeof input.id === "string" && typeof input.order === "number" && typeof input.type === "string" && typeof input.enabled === "boolean";
}

function isObservation(value: unknown): value is Observation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<Observation>;
  return (
    (input.platform === "android" || input.platform === "ios") &&
    typeof input.capturedAt === "string" &&
    Array.isArray(input.uiElements) &&
    Array.isArray(input.ocrTexts)
  );
}

function readGraphTargetApp(input: { targetApp?: GraphTargetApp; androidPackageName?: string }): GraphTargetApp | undefined {
  const androidPackageName = typeof input.targetApp?.androidPackageName === "string" ? input.targetApp.androidPackageName.trim() : input.androidPackageName?.trim();
  const iosBundleId = typeof input.targetApp?.iosBundleId === "string" ? input.targetApp.iosBundleId.trim() : undefined;
  if (!androidPackageName && !iosBundleId) {
    return undefined;
  }
  return {
    androidPackageName: androidPackageName || undefined,
    iosBundleId: iosBundleId || undefined
  };
}

function readRoutePlanRequest(body: unknown): {
  targetNodeId?: string;
  target?: TargetNodeQuery;
  startNodeId?: string;
  deviceSerial?: string;
  platform: Platform;
  strategy?: RouteStrategy;
  persist?: boolean;
  executionProfile?: "full" | "fast_visual";
  startAppScope?: StartAppScope;
} {
  const input = (body ?? {}) as {
    targetNodeId?: string;
    target?: TargetNodeQuery;
    startNodeId?: string;
    deviceSerial?: string;
    platform?: string;
    strategy?: string;
    persist?: boolean;
    executionProfile?: string;
    startAppScope?: string;
  };
  const platform = input.platform === "ios" ? "ios" : input.platform === "android" ? "android" : undefined;
  if (!platform) {
    throw new Error("platform must be android or ios");
  }
  const target = readTargetNodeQuery(input.target);
  if (!input.targetNodeId?.trim() && !target) {
    throw new Error("targetNodeId or target is required");
  }
  return {
    targetNodeId: input.targetNodeId?.trim() || undefined,
    target,
    startNodeId: input.startNodeId?.trim() || undefined,
    deviceSerial: input.deviceSerial?.trim() || undefined,
    platform,
    strategy: readRouteStrategy(input.strategy),
    persist: typeof input.persist === "boolean" ? input.persist : undefined,
    executionProfile: readExecutionProfile(input.executionProfile),
    startAppScope: readStartAppScope(input.startAppScope)
  };
}

type PageAssetDraftRequest = {
  key?: string;
  name?: string;
  assetKind?: "page" | "overlay";
  parentPageId?: string;
  parentPageName?: string;
  overlayType?: string;
  overlayBehavior?: "blocking" | "non_blocking" | "page_state";
  closeAction?: string;
  clearCloseAction?: boolean;
  aliasText?: string;
  intentTagsText?: string;
  aiDescription?: string;
  visualPageName?: string;
  confirmedMatchers?: string[];
  confirmedUiTexts?: string[];
  confirmedOcrTexts?: string[];
  screenshotRegions?: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

function readPageAssetDraftRequest(body: unknown): PageAssetDraftRequest {
  if (!body || typeof body !== "object") {
    return {};
  }
  const input = body as Record<string, unknown>;
  return {
    key: nonEmptyString(input.key),
    name: nonEmptyString(input.name),
    assetKind: input.assetKind === "overlay" ? "overlay" : input.assetKind === "page" ? "page" : undefined,
    parentPageId: nonEmptyString(input.parentPageId),
    parentPageName: nonEmptyString(input.parentPageName),
    overlayType: nonEmptyString(input.overlayType),
    overlayBehavior: readOverlayBehavior(input.overlayBehavior),
    closeAction: nonEmptyString(input.closeAction),
    clearCloseAction: input.closeAction === "",
    aliasText: nonEmptyString(input.aliasText),
    intentTagsText: nonEmptyString(input.intentTagsText),
    aiDescription: nonEmptyString(input.aiDescription),
    visualPageName: nonEmptyString(input.visualPageName),
    confirmedMatchers: readStringArray(input.confirmedMatchers),
    confirmedUiTexts: readStringArray(input.confirmedUiTexts),
    confirmedOcrTexts: readStringArray(input.confirmedOcrTexts),
    screenshotRegions: readScreenshotRegions(input.screenshotRegions)
  };
}

function mergePageAssetDraftMetadata(previous: Record<string, unknown> | undefined, draft: PageAssetDraftRequest): Record<string, unknown> {
  const alias = splitCsvText(draft.aliasText);
  const intentTags = splitCsvText(draft.intentTagsText);
  return {
    ...(previous ?? {}),
    assetRecordingConfirmed: true,
    assetRecordingConfirmedAt: nonEmptyString(previous?.assetRecordingConfirmedAt) ?? nowIso(),
    assetKind: draft.assetKind ?? "page",
    ...(draft.parentPageId ? { parentPageId: draft.parentPageId } : {}),
    ...(draft.parentPageName ? { parentPageName: draft.parentPageName } : {}),
    ...(draft.overlayType ? { overlayType: draft.overlayType } : {}),
    ...(draft.overlayBehavior ? { overlayBehavior: draft.overlayBehavior } : {}),
    ...(draft.clearCloseAction ? { closeAction: "" } : draft.closeAction ? { closeAction: draft.closeAction } : {}),
    ...(draft.name ? { pageName: draft.name } : {}),
    ...(draft.aiDescription ? { aiDescription: draft.aiDescription } : {}),
    ...(draft.visualPageName ? { visualPageName: draft.visualPageName } : {}),
    ...(draft.confirmedMatchers ? { confirmedMatchers: draft.confirmedMatchers } : {}),
    ...(draft.confirmedUiTexts ? { confirmedUiTexts: draft.confirmedUiTexts } : {}),
    ...(draft.confirmedOcrTexts ? { confirmedOcrTexts: draft.confirmedOcrTexts } : {}),
    ...(alias.length ? { alias } : {}),
    ...(intentTags.length ? { intentTags } : {}),
    ...(draft.screenshotRegions ? { screenshotRegions: draft.screenshotRegions } : {}),
    updatedAt: nowIso()
  };
}

function mergePageAssetTags(previous: string[], draft: PageAssetDraftRequest): string[] | undefined {
  const intentTags = splitCsvText(draft.intentTagsText);
  const baseTags = draft.assetKind === "overlay" ? previous.filter((tag) => tag !== "page-asset") : previous;
  const assetTags = draft.assetKind === "overlay" ? ["page-state", "page-overlay", "asset-recording"] : ["page-asset", "asset-recording"];
  return Array.from(new Set([...baseTags, ...assetTags, ...intentTags]));
}

function isConfirmedPageAssetNode(node: { tags?: string[]; metadata?: Record<string, unknown> }): boolean {
  return node.metadata?.assetRecordingConfirmed === true || node.tags?.includes("page-asset") === true;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function readOverlayBehavior(value: unknown): PageAssetDraftRequest["overlayBehavior"] {
  return value === "blocking" || value === "non_blocking" || value === "page_state" ? value : undefined;
}

function readScreenshotRegions(value: unknown): PageAssetDraftRequest["screenshotRegions"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const input = item as Record<string, unknown>;
      const x = boundedPercent(input.x);
      const y = boundedPercent(input.y);
      const width = boundedPercent(input.width, 0, 100 - x);
      const height = boundedPercent(input.height, 0, 100 - y);
      if (width <= 0 || height <= 0) {
        return undefined;
      }
      return {
        id: nonEmptyString(input.id) ?? `region-${index + 1}`,
        label: nonEmptyString(input.label) ?? `重点区域 ${index + 1}`,
        x,
        y,
        width,
        height
      };
    })
    .filter((item): item is NonNullable<PageAssetDraftRequest["screenshotRegions"]>[number] => Boolean(item));
}

function boundedPercent(value: unknown, min = 0, max = 100): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function splitCsvText(value: string | undefined): string[] {
  return (
    value
      ?.split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function writePageAssetBaselineArtifact(relativePath: string, bytes: Buffer): Promise<ArtifactRef> {
  const written = await storage.writeArtifact(relativePath, bytes);
  const artifact: ArtifactRef = {
    id: `asset_region_${nowIso().replace(/[^0-9]/g, "")}_${Math.random().toString(36).slice(2, 8)}`,
    type: "screenshot",
    name: path.basename(relativePath),
    path: relativePath,
    url: artifactUrl(relativePath),
    mimeType: "image/png",
    sizeBytes: written.sizeBytes,
    createdAt: nowIso()
  };
  storage.addArtifact(artifact);
  return artifact;
}

async function readPageAssetBaselineArtifact(artifactId: string): Promise<Buffer | undefined> {
  const artifact = storage.getArtifact(artifactId);
  if (!artifact) {
    return undefined;
  }
  return readFile(artifactFilePath(artifact.path));
}

function readGraphRunRequest(body: unknown): {
  deviceSerial: string;
  graphId?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  target?: TargetNodeQuery;
  startNodeId?: string;
  platform?: Platform;
  strategy?: RouteStrategy;
  stopOnFailure?: boolean;
  startStrategy?: FlowStartStrategy;
  startAppPackageName?: string;
  overlay?: RuntimeOverlay;
  executionProfile?: "full" | "fast_visual";
  startAppScope?: StartAppScope;
} {
  const input = (body ?? {}) as {
    deviceSerial?: string;
    graphId?: string;
    graphVersionId?: string;
    targetNodeId?: string;
    target?: TargetNodeQuery;
    startNodeId?: string;
    platform?: string;
    strategy?: string;
    stopOnFailure?: boolean;
    startStrategy?: string;
    startAppPackageName?: string;
    overlay?: RuntimeOverlay;
    executionProfile?: string;
    startAppScope?: string;
  };
  if (!input.deviceSerial?.trim()) {
    throw new Error("deviceSerial is required");
  }
  if (!input.graphVersionId?.trim() && !input.graphId?.trim()) {
    throw new Error("graphVersionId or graphId is required");
  }
  const target = readTargetNodeQuery(input.target);
  if (!input.targetNodeId?.trim() && !target) {
    throw new Error("targetNodeId or target is required");
  }
  return {
    deviceSerial: input.deviceSerial.trim(),
    graphId: input.graphId?.trim() || undefined,
    graphVersionId: input.graphVersionId?.trim() || undefined,
    targetNodeId: input.targetNodeId?.trim() || undefined,
    target,
    startNodeId: input.startNodeId?.trim() || undefined,
    platform: input.platform === "ios" ? "ios" : input.platform === "android" ? "android" : undefined,
    strategy: readRouteStrategy(input.strategy),
    stopOnFailure: typeof input.stopOnFailure === "boolean" ? input.stopOnFailure : undefined,
    startStrategy: readFlowStartStrategy(input.startStrategy),
    startAppPackageName: input.startAppPackageName?.trim() || undefined,
    overlay: readRuntimeOverlay(input.overlay),
    executionProfile: readExecutionProfile(input.executionProfile),
    startAppScope: readStartAppScope(input.startAppScope)
  };
}

function readRuntimeOverlay(value: unknown): RuntimeOverlay | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("overlay must be an object");
  }
  const input = value as RuntimeOverlay;
  return {
    id: stringOrUndefined(input.id),
    targetNodeId: stringOrUndefined(input.targetNodeId),
    targetTaskId: stringOrUndefined(input.targetTaskId),
    note: stringOrUndefined(input.note),
    runtimeParams: readRuntimeParams((input as RuntimeOverlay & { runtimeParams?: unknown }).runtimeParams),
    nodeExpectationOverrides: readNodeExpectationOverrides(input.nodeExpectationOverrides),
    edgeExpectationOverrides: readEdgeExpectationOverrides(input.edgeExpectationOverrides)
  };
}

function readRuntimeParams(value: unknown): RuntimeOverlay["runtimeParams"] {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("overlay.runtimeParams must be an object");
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : item === undefined || item === null ? "" : String(item).trim()] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function readNodeExpectationOverrides(value: unknown): RuntimeOverlay["nodeExpectationOverrides"] {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("overlay.nodeExpectationOverrides must be an array");
  }
  return value.map((item) => {
    const input = item as { nodeId?: unknown; expectations?: unknown };
    const nodeId = stringOrUndefined(input.nodeId);
    if (!nodeId) {
      throw new Error("overlay.nodeExpectationOverrides[].nodeId is required");
    }
    return {
      nodeId,
      expectations: readOverlayExpectations(input.expectations, "overlay.nodeExpectationOverrides[].expectations")
    };
  });
}

function readEdgeExpectationOverrides(value: unknown): RuntimeOverlay["edgeExpectationOverrides"] {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("overlay.edgeExpectationOverrides must be an array");
  }
  return value.map((item) => {
    const input = item as { edgeId?: unknown; expectations?: unknown };
    const edgeId = stringOrUndefined(input.edgeId);
    if (!edgeId) {
      throw new Error("overlay.edgeExpectationOverrides[].edgeId is required");
    }
    return {
      edgeId,
      expectations: readOverlayExpectations(input.expectations, "overlay.edgeExpectationOverrides[].expectations")
    };
  });
}

function readOverlayExpectations(value: unknown, fieldName: string): StepExpectation[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${fieldName}[${index}] must be an object`);
    }
    const input = item as Partial<StepExpectation>;
    const id = stringOrUndefined(input.id);
    const type = stringOrUndefined(input.type);
    if (!id || !type) {
      throw new Error(`${fieldName}[${index}] requires id and type`);
    }
    if (!isStepExpectationType(type)) {
      throw new Error(`${fieldName}[${index}].type is unsupported`);
    }
    return {
      id,
      type,
      enabled: typeof input.enabled === "boolean" ? input.enabled : true,
      title: stringOrUndefined(input.title),
      note: stringOrUndefined(input.note),
      params: typeof input.params === "object" && input.params !== null && !Array.isArray(input.params) ? { ...input.params } : {},
      createdAt: stringOrUndefined(input.createdAt) ?? nowIso()
    };
  });
}

function isStepExpectationType(value: string): value is StepExpectation["type"] {
  return ["text", "image", "app_alive", "no_crash", "screen_changed", "metric_below", "log_not_contains", "state_is", "performance_not_regressed"].includes(value);
}

function readStructuredFlowInput(value: unknown): Omit<StructuredFlow, "id" | "version" | "createdAt" | "updatedAt" | "steps" | "tags" | "status" | "startStrategy"> & {
  startStrategy?: StructuredFlow["startStrategy"];
  tags?: string[];
  status?: StructuredFlow["status"];
  steps: StructuredFlow["steps"];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Structured flow payload must be an object");
  }
  const input = value as Partial<StructuredFlow>;
  const name = stringOrUndefined(input.name);
  const appName = stringOrUndefined(input.appName);
  if (!name) {
    throw new Error("Structured flow name is required");
  }
  if (!appName) {
    throw new Error("Structured flow appName is required");
  }
  if (input.platform !== "android" && input.platform !== "ios") {
    throw new Error("Structured flow platform must be android or ios");
  }
  if (!input.targetApp || (input.platform === "android" && !stringOrUndefined(input.targetApp.androidPackageName)) || (input.platform === "ios" && !stringOrUndefined(input.targetApp.iosBundleId))) {
    throw new Error("Structured flow targetApp does not match platform");
  }
  if (!input.appVersion?.displayVersion?.trim()) {
    throw new Error("Structured flow appVersion.displayVersion is required");
  }
  if (!input.startState?.id || !input.endState?.id) {
    throw new Error("Structured flow startState and endState are required");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Structured flow requires at least one step");
  }
  return {
    name,
    description: stringOrUndefined(input.description),
    appId: stringOrUndefined(input.appId),
    appName,
    platform: input.platform,
    targetApp: input.targetApp,
    appVersion: input.appVersion,
    startState: input.startState,
    endState: input.endState,
    role: stringOrUndefined(input.role),
    startStrategy: readStructuredFlowStartStrategy(input.startStrategy),
    tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()) : undefined,
    status: readStructuredFlowStatus(input.status),
    steps: input.steps
  };
}

function readStructuredFlowStatus(value: unknown): StructuredFlow["status"] | undefined {
  return value === "draft" || value === "active" || value === "deprecated" ? value : undefined;
}

function readStructuredFlowStartStrategy(value: unknown): StructuredFlow["startStrategy"] | undefined {
  if (
    value === "keep_current" ||
    value === "go_home" ||
    value === "launch_app" ||
    value === "restart_app" ||
    value === "clear_data_and_launch" ||
    value === "install_build_and_launch"
  ) {
    return value;
  }
  return undefined;
}

function readTargetNodeQuery(value: TargetNodeQuery | undefined): TargetNodeQuery | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const query: TargetNodeQuery = {
    nodeId: stringOrUndefined(value.nodeId),
    key: stringOrUndefined(value.key),
    name: stringOrUndefined(value.name),
    text: stringOrUndefined(value.text),
    intent: stringOrUndefined(value.intent),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).map((tag) => tag.trim()) : undefined,
    includeDraft: typeof value.includeDraft === "boolean" ? value.includeDraft : undefined,
    maxCandidates: typeof value.maxCandidates === "number" && Number.isFinite(value.maxCandidates) ? value.maxCandidates : undefined
  };
  if (!query.nodeId && !query.key && !query.name && !query.text && !query.intent && !query.tags?.length) {
    return undefined;
  }
  return query;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRouteStrategy(value: string | undefined): RouteStrategy | undefined {
  if (value === "most_stable" || value === "shortest" || value === "smoke" || value === "performance") {
    return value;
  }
  return undefined;
}

function readFlowStartStrategy(value: string | undefined): FlowStartStrategy | undefined {
  if (value === "keep_current" || value === "go_home" || value === "launch_app" || value === "restart_app" || value === "clear_data_and_launch") {
    return value;
  }
  return undefined;
}

function readExecutionProfile(value: string | undefined): "full" | "fast_visual" | undefined {
  return value === "fast_visual" || value === "full" ? value : undefined;
}

function readStartAppScope(value: string | undefined): StartAppScope | undefined {
  return value === "current_device" || value === "target_app" ? value : undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanQuery(value: unknown, fallback: boolean): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function requiresStartAppPackageName(strategy: FlowStartStrategy | undefined): boolean {
  return strategy === "launch_app" || strategy === "restart_app" || strategy === "clear_data_and_launch";
}

type GraphRunSummary = {
  id: string;
  isGraphRun: boolean;
  active: boolean;
  status: TestRun["status"];
  caseName: string;
  deviceSerial: string;
  startedAt: string;
  endedAt?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  targetNodeName?: string;
  route: Array<{
    edgeId?: string;
    edgeKey?: string;
    fromNodeId?: string;
    fromNodeName?: string;
    toNodeId?: string;
    toNodeName?: string;
  }>;
  failedAt?: {
    stepId?: string;
    edgeId?: string;
    edgeKey?: string;
    nodeId?: string;
    nodeName?: string;
    phase?: string;
    code?: string;
    message?: string;
    expectation?: {
      id: string;
      type: StepExpectationResult["type"];
      expected: string;
      actual: string;
      reason?: string;
    };
  };
  reportUrl?: string;
  reportPath?: string;
  screenshots: ArtifactRef[];
  videos: ArtifactRef[];
  logs: ArtifactRef[];
  failureEvidence: ArtifactRef[];
  nodeTestResult: NodeTestResult;
  steps: Array<{
    id: string;
    order: number;
    status: StepResult["status"];
    type: StepResult["type"];
    phase?: string;
    edgeId?: string;
    edgeKey?: string;
    fromNodeId?: string;
    fromNodeName?: string;
    toNodeId?: string;
    toNodeName?: string;
    runtimeOverlay?: unknown;
    beforeMatch?: unknown;
    afterMatch?: unknown;
    actionPolicy?: unknown;
    semantic?: unknown;
    action?: GraphStepResultItem["action"];
    matches?: GraphStepResultItem["matches"];
    retry?: GraphStepResultItem["retry"];
    compound?: unknown;
    failureReason?: string;
    recoveryAttempt?: number;
    recoveryReasonDeviationId?: string;
    deviations?: unknown[];
    interceptors?: unknown[];
    errorCode?: string;
    errorMessage?: string;
    expectationResults: StepExpectationResult[];
    artifactIds: string[];
  }>;
};

function summarizeGraphRun(run: TestRun, active: boolean): GraphRunSummary {
  const graphSteps = collectGraphStepRecords(run);
  const isGraphRun = isGraphRunResult(run);
  const nodeTestResult = buildNodeTestResult(run, active);
  const lastGraphStep = graphSteps.at(-1)?.graph;
  const failedStep = run.stepResults.find((step) => step.status === "failed" || step.status === "timeout");
  const failedGraph = failedStep ? readStepGraphMetadata(failedStep) : undefined;
  const failedExpectation = failedStep?.expectationResults?.find((result) => result.status === "failed" && result.blocking !== false);
  const failureEvidenceIds = new Set<string>([
    failedStep?.afterScreenshotId,
    ...(failedExpectation?.evidenceArtifactIds ?? []),
    ...run.events.flatMap((event) => event.artifactIds)
  ].filter((id): id is string => Boolean(id)));
  const artifactsById = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  return {
    id: run.id,
    isGraphRun,
    active,
    status: run.status,
    caseName: run.caseName,
    deviceSerial: run.deviceSerial,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    graphVersionId: firstString(graphSteps.map((item) => item.graph?.versionId)),
    targetNodeId: firstString([...graphSteps.map((item) => item.graph?.toNodeId)].reverse()) ?? stringValue(lastGraphStep?.toNodeId),
    targetNodeName: firstString([...graphSteps.map((item) => item.graph?.toNodeName)].reverse()) ?? stringValue(lastGraphStep?.toNodeName),
    route: graphSteps.map((item) => ({
      edgeId: stringValue(item.graph?.edgeId),
      edgeKey: stringValue(item.graph?.edgeKey),
      fromNodeId: stringValue(item.graph?.fromNodeId),
      fromNodeName: stringValue(item.graph?.fromNodeName),
      toNodeId: stringValue(item.graph?.toNodeId),
      toNodeName: stringValue(item.graph?.toNodeName)
    })),
    failedAt: failedStep
      ? {
          stepId: failedStep.stepId,
          edgeId: stringValue(failedGraph?.edgeId),
          edgeKey: stringValue(failedGraph?.edgeKey),
          nodeId: stringValue(failedGraph?.toNodeId),
          nodeName: stringValue(failedGraph?.toNodeName),
          phase: stringValue(failedGraph?.phase),
          code: failedStep.errorCode,
          message: failedStep.errorMessage,
          expectation: failedExpectation
            ? {
                id: failedExpectation.expectationId,
                type: failedExpectation.type,
                expected: failedExpectation.expected,
                actual: failedExpectation.actual,
                reason: failedExpectation.reason
              }
            : undefined
        }
      : undefined,
    reportUrl: run.reportHtmlPath ? `/artifacts/${run.reportHtmlPath}` : undefined,
    reportPath: run.reportHtmlPath,
    screenshots: run.artifacts.filter((artifact) => artifact.type === "screenshot"),
    videos: run.artifacts.filter((artifact) => artifact.type === "video"),
    logs: run.artifacts.filter((artifact) => artifact.type === "log"),
    failureEvidence: Array.from(failureEvidenceIds)
      .map((id) => artifactsById.get(id))
      .filter((artifact): artifact is ArtifactRef => Boolean(artifact)),
    nodeTestResult,
    steps: graphSteps.map(({ step, graph }) => {
      const structuredStep = nodeTestResult.steps.find((item) => item.stepId === step.stepId || item.edgeId === stringValue(graph?.edgeId));
      return {
      id: step.id,
      order: step.stepOrder,
      status: step.status,
      type: step.type,
      phase: stringValue(graph?.phase),
      edgeId: stringValue(graph?.edgeId),
      edgeKey: stringValue(graph?.edgeKey),
      fromNodeId: stringValue(graph?.fromNodeId),
      fromNodeName: stringValue(graph?.fromNodeName),
      toNodeId: stringValue(graph?.toNodeId),
      toNodeName: stringValue(graph?.toNodeName),
      runtimeOverlay: graph?.runtimeOverlay,
      beforeMatch: graph?.beforeMatch,
      afterMatch: graph?.afterMatch,
      actionPolicy: graph?.actionPolicy,
      semantic: step.metadata?.semantic,
      action: structuredStep?.action,
      matches: structuredStep?.matches,
      retry: structuredStep?.retry,
      compound: structuredStep?.compound,
      failureReason: structuredStep?.failureReason,
      recoveryAttempt: numberValue(graph?.recoveryAttempt),
      recoveryReasonDeviationId: stringValue(graph?.recoveryReasonDeviationId),
      deviations: Array.isArray(graph?.deviations) ? graph.deviations : [],
      interceptors: Array.isArray(graph?.interceptors) ? graph.interceptors : [],
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
      expectationResults: step.expectationResults ?? [],
      artifactIds: uniqueStrings([
        step.afterScreenshotId,
        ...step.artifacts.map((artifact) => artifact.id),
        ...(step.expectationResults ?? []).flatMap((result) => result.evidenceArtifactIds)
      ])
    };
    })
  };
}

function summarizeRun(run: TestRun, active: boolean) {
  const failedStep = run.stepResults.find((step) => step.status === "failed" || step.status === "timeout");
  const failedExpectation = failedStep?.expectationResults?.find((result) => result.status === "failed" && result.blocking !== false);
  const failureEvidenceIds = new Set<string>([
    failedStep?.afterScreenshotId,
    ...(failedExpectation?.evidenceArtifactIds ?? []),
    ...run.events.flatMap((event) => event.artifactIds)
  ].filter((id): id is string => Boolean(id)));
  const artifactsById = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  return {
    id: run.id,
    active,
    status: run.status,
    caseName: run.caseName,
    deviceSerial: run.deviceSerial,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    reportUrl: run.reportHtmlPath ? `/artifacts/${run.reportHtmlPath}` : undefined,
    screenshots: run.artifacts.filter((artifact) => artifact.type === "screenshot"),
    videos: run.artifacts.filter((artifact) => artifact.type === "video" && !artifact.deletedAt),
    logs: run.artifacts.filter((artifact) => artifact.type === "log"),
    failureEvidence: Array.from(failureEvidenceIds)
      .map((id) => artifactsById.get(id))
      .filter((artifact): artifact is ArtifactRef => Boolean(artifact)),
    failedAt: failedStep
      ? {
          stepId: failedStep.stepId,
          code: failedStep.errorCode,
          message: failedStep.errorMessage,
          expectation: failedExpectation
            ? {
                id: failedExpectation.expectationId,
                type: failedExpectation.type,
                expected: failedExpectation.expected,
                actual: failedExpectation.actual,
                reason: failedExpectation.reason
              }
            : undefined
        }
      : undefined,
    actual: {
      stepCount: run.stepResults.length,
      passedStepCount: run.stepResults.filter((step) => step.status === "passed").length,
      failedStepCount: run.stepResults.filter((step) => step.status === "failed" || step.status === "timeout").length,
      failedExpectationCount: run.stepResults.flatMap((step) => step.expectationResults ?? []).filter((result) => result.status === "failed").length
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringBodyValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumberBodyValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function aiDiagnosisSettingsUpdateFromBody(body: Record<string, unknown>): AiDiagnosisSettingsUpdateInput {
  return {
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    baseURL: stringBodyValue(body.baseURL),
    apiKey: stringBodyValue(body.apiKey),
    model: stringBodyValue(body.model),
    timeoutMs: positiveNumberBodyValue(body.timeoutMs),
    clearApiKey: body.clearApiKey === true
  };
}

function firstString(values: unknown[]): string | undefined {
  return values.map(stringValue).find(Boolean);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
