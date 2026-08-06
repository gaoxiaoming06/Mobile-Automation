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
  type Platform,
} from "@mobile-automation/shared";
import { renderReportHtml } from "@mobile-automation/report-core";
import { type BusinessGraphVersion, type Observation } from "@mobile-automation/graph-core";
import { WebSocketServer } from "ws";
import { ArtifactCleanupScheduler } from "./artifact-cleanup.js";
import { createAutomaticAssetLearningService } from "./automatic-asset-learning-runtime.js";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";
import { AutomationRunner } from "./automation-runner.js";
import { DeviceExecutionBusyError, DeviceExecutionLease } from "./device-execution-lease.js";
import { artifactFilePath, artifactRoot, artifactSendFileOptions, artifactUrl } from "./artifacts.js";
import { pageAssetLibraryTargetMismatchMessage } from "./page-asset-library-target.js";
import { registerPageAssetLibraryRoutes } from "./page-asset-library-api.js";
import { buildConfirmedPageAssetInput, identifyOrCreateCurrentPageDraft, readCurrentPageCollectionOptions } from "./current-page-asset.js";
import { buildPageAssetLibrarySummary } from "./page-assets-summary.js";
import { scaleLocatorCoordinate } from "./locator-coordinate.js";
import { MobileDriver } from "./mobile-driver.js";
import { ScrcpyStreamBridge } from "./scrcpy-stream.js";
import { resolveServerHost } from "./server-network.js";
import { Storage } from "./storage.js";
import {
  previewAiModelSettingsUpdate,
  publicAiModelSettings,
  readAiModelSettingsUpdate,
  resolveAiModelConfig,
} from "./ai-model-settings.js";
import { AiPageDraftError, generateAiPageDraft } from "./ai-page-draft.js";
import {
  StabilityExplorer,
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
import { StoragePageAssetCatalog } from "./page-asset-catalog.js";
import { DefaultPageStateService } from "./page-state-service.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { findNearestTextCandidate } from "./semantic-locator.js";
import { registerScriptFlowRoutes } from "./script-flow-api.js";
import { registerScriptFlowAiRoutes } from "./script-flow-ai-api.js";
import { registerTrialLearningRoutes } from "./trial-learning-api.js";
import { generateScriptFlowDraft } from "./script-flow-ai-planner.js";
import { createScriptFlowAiTimingContext, timedScriptFlowAiStage } from "./script-flow-ai-timing.js";
import { understandScreenForScriptFlow } from "./script-flow-screen-understanding.js";
import { pageStateExpectationVerifier, ScriptFlowRunner } from "./script-flow-runner.js";
import { ScriptTargetResolver } from "./script-target-resolver.js";
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
const observationService = new ObservationService(driver, ocr);
const pageAssetCatalog = new StoragePageAssetCatalog(storage);
const pageStateService = new DefaultPageStateService(pageAssetCatalog, observationService, readPageAssetBaselineArtifact);
const deviceExecutionLease = new DeviceExecutionLease();
const runner = new AutomationRunner(storage, driver, ocr, {
  verifyPageState: pageStateExpectationVerifier(pageStateService),
  pageStateService,
  executionLease: deviceExecutionLease
});
const scriptFlowRunner = new ScriptFlowRunner({
  backend: runner,
  driver,
  targetResolver: new ScriptTargetResolver(),
  pageCatalog: pageAssetCatalog
});
const stabilityExplorer = new StabilityExplorer(storage, driver, ocr, deviceExecutionLease);
const scrcpyStreamBridge = new ScrcpyStreamBridge();
const artifactCleanupScheduler = new ArtifactCleanupScheduler(storage);
const automaticAssetLearningService = createAutomaticAssetLearningService({
  storage,
  ocr,
  getAiConfig: () => resolveAiModelConfig(process.env, storage.getAiModelSettings())
});

await storage.ensureDirs();
await runner.markStaleRunningRunsStopped("Server started with no active worker for this run.").catch((error) => {
  console.warn("Failed to mark stale runs stopped", error);
});
artifactCleanupScheduler.start();
automaticAssetLearningService.start();

app.use(express.json({ limit: "5mb" }));
app.use("/artifacts", express.static(artifactRoot, { fallthrough: false }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mobile-automation-server",
    artifactRoot
  });
});

registerScriptFlowRoutes(app, { storage, runner: scriptFlowRunner });
registerTrialLearningRoutes(app, { storage });
registerPageAssetLibraryRoutes(app, { storage });
registerScriptFlowAiRoutes(app, {
  getFlow: (id) => storage.getScriptFlow(id),
  getRun: (id) => storage.getRun(id),
  generateDraft: async ({ prompt, appId, platform, existingFlow, screenAssist, externalContext }) => {
    const timingContext = createScriptFlowAiTimingContext(prompt);
    return timedScriptFlowAiStage(timingContext, "total", async () => {
      const config = resolveAiModelConfig(process.env, storage.getAiModelSettings());
      const observation = screenAssist
        ? await timedScriptFlowAiStage(timingContext, "collect_observation", () => observationService.collect(screenAssist.deviceSerial, {
            includeScreenshot: true,
            includeUiTree: true,
            includeOcr: true
          }), { deviceSerial: screenAssist.deviceSerial })
        : undefined;
      const screenPlatform = observation?.platform ?? platform;
      const screenContext = observation
        ? await timedScriptFlowAiStage(timingContext, "understand_screen", () => understandScreenForScriptFlow({
            config,
            prompt,
            appId,
            platform: screenPlatform,
            observation
          }), { deviceSerial: screenAssist?.deviceSerial })
        : undefined;
      return generateScriptFlowDraft({
        config,
        prompt,
        appId,
        platform,
        existingFlow,
        ...(screenContext ? { screenContext } : {}),
        ...(externalContext ? { externalContext } : {}),
        timingContext,
        pageCatalog: pageAssetCatalog,
        flows: storage.listScriptFlows({ appId, platform }),
        navigationEntries: storage.listNavigationEntries({ appId, platform })
      });
    }, { screenAssist: Boolean(screenAssist), appId, platform });
  }
});

app.get("/api/settings/ai-model", (_req, res) => {
  res.json({ settings: publicAiModelSettings(process.env, storage.getAiModelSettings()) });
});

app.put("/api/settings/ai-model", (req, res) => {
  try {
    const update = readAiModelSettingsUpdate(req.body);
    const candidate = previewAiModelSettingsUpdate(storage.getAiModelSettings(), update);
    const resolved = resolveAiModelConfig(process.env, candidate);
    if (candidate.enabled && !resolved.enabled) {
      res.status(400).json({ error: "AI 模型配置不完整，请填写 Codex 模型名" });
      return;
    }
    const saved = storage.updateAiModelSettings(update);
    res.json({ settings: publicAiModelSettings(process.env, saved) });
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

app.post("/api/page-assets/:versionId/current-page", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const body = req.body as {
      deviceSerial?: string;
      observation?: Parameters<typeof identifyOrCreateCurrentPageDraft>[0]["observation"];
      includeOcr?: boolean;
      includeUiTree?: boolean;
      assetOnly?: boolean;
    };
    const observation =
      body.observation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, readCurrentPageCollectionOptions(body))
        : undefined);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    if (sendPageAssetLibraryTargetMismatch(res, graphVersion, observation)) {
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
      assets: buildPageAssetLibrarySummary(latestGraphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/page-assets/:versionId/ai-page-draft", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const body = req.body as { observation?: Observation; deviceSerial?: string };
    const observation =
      body.observation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, {
            includeOcr: true,
            includeUiTree: true,
            includeScreenshot: true
          })
        : undefined);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    const config = resolveAiModelConfig(process.env, storage.getAiModelSettings());
    const result = await generateAiPageDraft({ config, observation });
    res.json(result);
  } catch (error) {
    if (error instanceof AiPageDraftError) {
      const statusByCode = { not_configured: 409, invalid_response: 422, timeout: 504, llm_failed: 502 } as const;
      res.status(statusByCode[error.code]).json({ error: error.message, code: error.code });
      return;
    }
    sendError(res, error);
  }
});

app.get("/api/page-assets/:versionId/assets", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    res.json({
      assets: buildPageAssetLibrarySummary(graphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/page-assets/:versionId/assets/nodes/:nodeId/promote", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const node = graphVersion.nodes.find((item) => item.id === req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: "Page asset not found" });
      return;
    }
    const body = req.body as {
      observation?: Observation;
      match?: Parameters<typeof buildConfirmedPageAssetInput>[0]["match"];
    };
    const draft = readPageAssetDraftRequest(req.body);
    if (body.observation && sendPageAssetLibraryTargetMismatch(res, graphVersion, body.observation)) {
      return;
    }
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
      assets: buildPageAssetLibrarySummary(latestGraphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/page-assets/:versionId/assets/nodes", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
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
    if (sendPageAssetLibraryTargetMismatch(res, graphVersion, body.observation)) {
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
      assets: buildPageAssetLibrarySummary(latestGraphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.delete("/api/page-assets/:versionId/assets/nodes/:nodeId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const node = graphVersion.nodes.find((item) => item.id === req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: "Page asset not found" });
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
      assets: buildPageAssetLibrarySummary(latestGraphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/runtime-interceptor-rules", (req, res) => {
  try {
    const platform = req.query.platform === "android" || req.query.platform === "ios" || req.query.platform === "harmony" ? req.query.platform : undefined;
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
    const run = stabilityExplorer.start(body);
    res.status(202).json({ run, active: stabilityExplorer.isRunning(run.id) });
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
  res.json({ run, active: runner.isRunning(req.params.id) || stabilityExplorer.isRunning(req.params.id) });
});

app.post("/api/runs/:id/stop", async (req, res) => {
  try {
    const stopped = await stabilityExplorer.stop(req.params.id) || await runner.stop(req.params.id);
    const run = storage.getRun(req.params.id);
    res.json({ stopped, run, active: runner.isRunning(req.params.id) || stabilityExplorer.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/pause", (req, res) => {
  try {
    const run = runner.pause(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/resume", (req, res) => {
  try {
    const run = runner.resume(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/runs/:id/step", (req, res) => {
  try {
    const run = runner.step(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ run, active: runner.isRunning(req.params.id) });
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

const host = resolveServerHost(process.env);
server.listen(port, host, () => {
  console.log(`Mobile Automation server listening on http://${host}:${port}`);
});

async function shutdown(): Promise<void> {
  artifactCleanupScheduler.stop();
  automaticAssetLearningService.stop();
  await Promise.all([runner.stopAll(), stabilityExplorer.stopAll(), scrcpyStreamBridge.closeAll(), ocrSidecar.stop()]);
}

function sendError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
}

function sendPageAssetLibraryTargetMismatch(res: express.Response, graphVersion: BusinessGraphVersion, observation: Observation): boolean {
  const graph = storage.getBusinessGraph(graphVersion.graphId);
  if (!graph) {
    res.status(404).json({ error: "Business graph not found" });
    return true;
  }
  const message = pageAssetLibraryTargetMismatchMessage(graph, observation);
  if (!message) {
    return false;
  }
  res.status(409).json({ error: message });
  return true;
}

function sendKnownError(res: express.Response, error: unknown): boolean {
  if (error instanceof DeviceExecutionBusyError) {
    res.status(409).json({
      error: "设备正在执行其他任务，请等待当前执行结束或先停止当前执行。",
      activeRunId: error.activeRunId,
      deviceSerial: error.deviceSerial,
      activeKind: error.activeKind
    });
    return true;
  }
  return false;
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
    androidAppMonitor?: unknown;
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
    stopOnUnknownPageStuck: readOptionalBoolean(input.stopOnUnknownPageStuck),
    androidAppMonitor: readAndroidAppMonitorConfig(input.androidAppMonitor)
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

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
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
    platformScope: input.platformScope === "android" || input.platformScope === "ios" || input.platformScope === "harmony" || input.platformScope === "mobile-both" ? input.platformScope : undefined,
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

type PageAssetDraftRequest = {
  key?: string;
  name?: string;
  assetKind?: "page" | "overlay";
  parentPageId?: string;
  parentPageName?: string;
  overlayType?: string;
  overlayBehavior?: "blocking" | "non_blocking" | "page_state";
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

async function readPageAssetBaselineArtifact(artifactId: string, fallbackPath?: string): Promise<Buffer | undefined> {
  const artifact = storage.getArtifact(artifactId);
  const relativePath = artifact?.path ?? fallbackPath;
  if (!relativePath) {
    return undefined;
  }
  return readFile(artifactFilePath(relativePath)).catch(() => undefined);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(values: unknown[]): string | undefined {
  return values.map(stringValue).find(Boolean);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
