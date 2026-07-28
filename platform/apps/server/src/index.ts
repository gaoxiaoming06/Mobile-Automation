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
  type Platform,
} from "@mobile-automation/shared";
import { renderReportHtml } from "@mobile-automation/report-core";
import { type BusinessGraphVersion, type Observation } from "@mobile-automation/graph-core";
import { WebSocketServer } from "ws";
import { ArtifactCleanupScheduler } from "./artifact-cleanup.js";
import { readAndroidAppMonitorConfig } from "./android-app-monitor-request.js";
import { AutomationRunner, DeviceBusyError } from "./automation-runner.js";
import { artifactFilePath, artifactRoot, artifactSendFileOptions, artifactUrl } from "./artifacts.js";
import { pageAssetLibraryTargetMismatchMessage } from "./page-asset-library-target.js";
import { buildConfirmedPageAssetInput, identifyOrCreateCurrentPageDraft, readCurrentPageCollectionOptions } from "./current-page-asset.js";
import { buildPageAssetLibrarySummary } from "./page-assets-summary.js";
import { createVisualLocatorTemplate } from "./page-matcher.js";
import { scaleLocatorCoordinate } from "./locator-coordinate.js";
import { MobileDriver } from "./mobile-driver.js";
import {
  deletePageElementAsset,
  persistPageElementAsset,
  type PageElementDynamicMask,
  type PageElementDynamicRegion,
  type PageElementItemTemplate,
  type PageElementLocatorKind,
  type PageElementScrollProfile
} from "./page-element-assets.js";
import { validatePageElementAssetQuality, type PageElementQualityResult } from "./page-element-quality.js";
import { ScrcpyStreamBridge } from "./scrcpy-stream.js";
import { Storage } from "./storage.js";
import {
  previewAiModelSettingsUpdate,
  publicAiModelSettings,
  resolveAiModelConfig,
  type AiModelSettingsUpdateInput
} from "./ai-model-settings.js";
import { AiPageDraftError, generateAiPageDraft } from "./ai-page-draft.js";
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
import { StoragePageAssetCatalog } from "./page-asset-catalog.js";
import { DefaultPageStateService } from "./page-state-service.js";
import type { RuntimeInterceptorRule } from "./runtime-interceptor.js";
import { findNearestTextCandidate } from "./semantic-locator.js";
import { registerScriptFlowRoutes } from "./script-flow-api.js";
import { registerScriptFlowAiRoutes } from "./script-flow-ai-api.js";
import { generateScriptFlowDraft } from "./script-flow-ai-planner.js";
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
const runner = new AutomationRunner(storage, driver, ocr, {
  verifyPageState: pageStateExpectationVerifier(pageStateService)
});
const scriptFlowRunner = new ScriptFlowRunner({
  backend: runner,
  driver,
  targetResolver: new ScriptTargetResolver(pageAssetCatalog)
});
const stabilityExplorer = new StabilityExplorer(storage, driver, ocr);
const scrcpyStreamBridge = new ScrcpyStreamBridge();
const artifactCleanupScheduler = new ArtifactCleanupScheduler(storage);

await storage.ensureDirs();
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

registerScriptFlowRoutes(app, { storage, runner: scriptFlowRunner });
registerScriptFlowAiRoutes(app, {
  generateDraft: ({ prompt, appId, platform }) => generateScriptFlowDraft({
    config: resolveAiModelConfig(process.env, storage.getAiModelSettings()),
    prompt,
    appId,
    platform,
    pageCatalog: pageAssetCatalog,
    flows: storage.listScriptFlows({ appId, platform })
  })
});

app.get("/api/settings/ai-model", (_req, res) => {
  res.json({ settings: publicAiModelSettings(process.env, storage.getAiModelSettings()) });
});

app.put("/api/settings/ai-model", (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const update = aiModelSettingsUpdateFromBody(body);
    const candidate = previewAiModelSettingsUpdate(storage.getAiModelSettings(), update);
    const resolved = resolveAiModelConfig(process.env, candidate);
    if (candidate.enabled && !resolved.enabled) {
      res.status(400).json({ error: "AI 模型配置不完整，请填写接口地址和模型名；HTTP 接口还需要 API Key" });
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

app.get("/api/page-assets", (req, res) => {
  try {
    const graphId = typeof req.query.graphId === "string" ? req.query.graphId.trim() : "";
    const libraries = storage.listBusinessGraphs().filter((graph) => !graphId || graph.id === graphId);
    res.json({
      libraries: libraries.map((graph) => ({
        ...graph,
        activeVersion: graph.activeVersionId ? storage.getBusinessGraphVersionSummary(graph.activeVersionId) : undefined
      }))
    });
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

app.post("/api/page-assets/:versionId/assets/page-elements", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const body = readManualPageElementRequest(req.body);
    const result = persistPageElementAsset({
      graphVersionId: graphVersion.id,
      storage,
      ...body,
      label: body.elementLabel
    });
    if (result.status === "skipped") {
      res.status(422).json(result);
      return;
    }
    const latestGraphVersion = storage.getBusinessGraphVersion(req.params.versionId) ?? graphVersion;
    res.status(200).json({
      result,
      assets: buildPageAssetLibrarySummary(latestGraphVersion)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/page-assets/:versionId/assets/page-elements/validate", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const body = readManualPageElementRequest(req.body);
    const observation = await resolvePageElementQualityObservation(req.body);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    if (sendPageAssetLibraryTargetMismatch(res, graphVersion, observation)) {
      return;
    }
    const sourceNode = storage.findBusinessNodeById(graphVersion.id, body.sourceNodeId);
    const region = parsePercentRegionFromLocator(body.locator);
    const quality = validatePageElementAssetQuality({
      element: {
        elementId: body.elementId,
        locator: body.locator,
        elementLabel: body.elementLabel,
        targetText: body.targetText,
        semanticArea: body.semanticArea,
        region,
        locatorKind: body.locatorKind,
        structuralLocator: body.structuralLocator,
        visualLocator: body.visualLocator,
        dynamicMasks: body.dynamicMasks,
        anchorOffsetPercent: body.anchorOffsetPercent
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

app.delete("/api/page-assets/:versionId/assets/page-elements/:sourceNodeId/:elementId", (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Page asset library version not found" });
      return;
    }
    const result = deletePageElementAsset({
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
    const activeLegacyRun = runner.getActiveRunForDevice(body.deviceSerial);
    if (activeLegacyRun) {
      throw new DeviceBusyError(body.deviceSerial, activeLegacyRun.runId);
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

server.listen(port, () => {
  console.log(`Mobile Automation server listening on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  artifactCleanupScheduler.stop();
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
  if (error instanceof DeviceBusyError) {
    res.status(409).json({
      error: "设备正在执行用例，请等待当前执行结束或先停止当前执行。",
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

function readManualPageElementRequest(body: unknown): {
  elementId?: string;
  sourceNodeId: string;
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  coordinateSpace?: "screen" | "app_viewport" | "region" | "runtime";
  elementLabel: string;
  targetText?: string;
  platformScope?: Platform | "mobile-both";
  scrollProfile?: PageElementScrollProfile;
  tapPointPercent?: { x: number; y: number };
  anchorOffsetPercent?: { x: number; y: number };
  quality?: PageElementQualityResult;
  visualLocator?: Record<string, unknown>;
  locatorKind?: PageElementLocatorKind;
  dynamicMasks?: PageElementDynamicMask[];
  structuralLocator?: Record<string, unknown>;
  dynamicRegion?: PageElementDynamicRegion;
  itemTemplate?: PageElementItemTemplate;
} {
  const input = (body ?? {}) as {
    elementId?: string;
    sourceNodeId?: string;
    locator?: string;
    semanticArea?: string;
    coordinateSpace?: string;
    elementLabel?: string;
    targetText?: string;
    platformScope?: Platform | "mobile-both";
    scrollProfile?: unknown;
    tapPointPercent?: unknown;
    anchorOffsetPercent?: unknown;
    quality?: unknown;
    visualLocator?: unknown;
    locatorKind?: unknown;
    dynamicMasks?: unknown;
    structuralLocator?: unknown;
    dynamicRegion?: unknown;
    itemTemplate?: unknown;
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
    locator,
    semanticArea: readVisualSemanticArea(input.semanticArea),
    coordinateSpace: readCoordinateSpace(input.coordinateSpace),
    elementLabel: elementLabel || locator,
    targetText: input.targetText?.trim() || undefined,
    platformScope: input.platformScope === "ios" || input.platformScope === "mobile-both" ? input.platformScope : "android",
    scrollProfile: readManualScrollProfile(input.scrollProfile),
    tapPointPercent: readManualTapPointPercent(input.tapPointPercent),
    anchorOffsetPercent: readManualSignedPercentPoint(input.anchorOffsetPercent),
    quality: readPageElementQuality(input.quality),
    visualLocator: readPlainRecord(input.visualLocator),
    locatorKind: readManualLocatorKind(input.locatorKind),
    dynamicMasks: readManualDynamicMasks(input.dynamicMasks),
    structuralLocator: readPlainRecord(input.structuralLocator),
    dynamicRegion: readManualDynamicRegion(input.dynamicRegion),
    itemTemplate: readManualItemTemplate(input.itemTemplate)
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

function readManualElementsForQuality(value: unknown): Array<{ id?: string; label?: string; locator?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): { id?: string; label?: string; locator?: string } | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      return {
        id: nonEmptyString(record.id),
        label: nonEmptyString(record.label),
        locator: nonEmptyString(record.locator)
      };
    })
    .filter((item): item is { id?: string; label?: string; locator?: string } => Boolean(item));
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

function readManualLocatorKind(value: unknown): PageElementLocatorKind | undefined {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator" ||
    value === "top_bar_icon_locator" ||
    value === "ocr_anchor_offset"
    ? value
    : undefined;
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

function readManualDynamicMasks(value: unknown): PageElementDynamicMask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const masks = value
    .map((item): PageElementDynamicMask | undefined => {
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
    .filter((item): item is PageElementDynamicMask => Boolean(item));
  return masks.length ? masks : undefined;
}

function readDynamicMaskKind(value: unknown): PageElementDynamicMask["kind"] {
  return value === "avatar" || value === "text" || value === "image" || value === "number" ? value : "custom";
}

function readManualDynamicRegion(value: unknown): PageElementDynamicRegion | undefined {
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

function readManualDynamicRegionKind(value: unknown): PageElementDynamicRegion["kind"] {
  return value === "grid" || value === "feed" || value === "form_group" ? value : "list";
}

function readManualItemTemplate(value: unknown): PageElementItemTemplate | undefined {
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

function readManualScrollProfile(value: unknown): PageElementScrollProfile | undefined {
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
    candidateItemHeightPercent: readManualPercent(input.candidateItemHeightPercent),
    clickSafePoint: readManualClickSafePoint(input.clickSafePoint),
    scrollStepPercent: readManualPercent(input.scrollStepPercent),
    failureStrategy: readManualCandidateFailureStrategy(input.failureStrategy)
  };
}

function readManualScrollContainerKind(value: unknown): PageElementScrollProfile["containerKind"] {
  return value === "grid_list" || value === "tab_bar" || value === "carousel" || value === "scroll_area" ? value : "list";
}

function readManualScrollTargetKind(value: unknown): PageElementScrollProfile["targetKind"] {
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

function readManualSignedPercentPoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = typeof input.x === "number" && Number.isFinite(input.x) ? Math.max(-100, Math.min(100, input.x)) : undefined;
  const y = typeof input.y === "number" && Number.isFinite(input.y) ? Math.max(-100, Math.min(100, input.y)) : undefined;
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

function readManualCandidateFailureStrategy(value: unknown): PageElementScrollProfile["failureStrategy"] {
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

async function readPageAssetBaselineArtifact(artifactId: string): Promise<Buffer | undefined> {
  const artifact = storage.getArtifact(artifactId);
  if (!artifact) {
    return undefined;
  }
  return readFile(artifactFilePath(artifact.path));
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

function stringBodyValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumberBodyValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function aiModelSettingsUpdateFromBody(body: Record<string, unknown>): AiModelSettingsUpdateInput {
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
