import { readFile } from "node:fs/promises";
import type express from "express";
import type { ActionStep, ArtifactRef, DeviceEvent, DeviceInfo, InteractionAsset, MetricSample, StepResult, TestRun } from "@mobile-automation/shared";
import { nowIso } from "@mobile-automation/shared";
import { artifactFilePath } from "./artifacts.js";

const DIAGNOSTIC_STEP_WINDOW_RADIUS = 3;
const DIAGNOSTIC_EVENT_LIMIT = 20;
const DIAGNOSTIC_TEXT_ARTIFACT_LIMIT = 10;
const DIAGNOSTIC_TEXT_ARTIFACT_BYTES = 64 * 1024;

type InteractionAssetBinding = NonNullable<NonNullable<TestRun["sourceSnapshot"]>["interactionAssets"]>[number];
type DiagnosticArtifactRef = ArtifactRef & {
  bundlePath?: string;
  skippedReason?: string;
};

export type RunDiagnosticsStorage = {
  getRun(runId: string): TestRun | undefined;
  getArtifact?(artifactId: string): ArtifactRef | undefined;
  listInteractionAssets?(filter: { appId: string }): InteractionAsset[];
  getInteractionAssetHealth?(assetId: string): unknown;
};

export type RunDiagnosticsServerInfo = {
  version: string;
  commit?: string;
  buildTime?: string;
  nodeVersion: string;
  platform: string;
};

export type RunDiagnosticsBundle = {
  schemaVersion: 1;
  generatedAt: string;
  server: RunDiagnosticsServerInfo;
  run: {
    id: string;
    caseName: string;
    deviceSerial: string;
    status: TestRun["status"];
    config: TestRun["config"];
    startedAt: string;
    endedAt?: string;
    reportHtmlPath?: string;
    stepCount: number;
    stepResultCount: number;
    artifactCount: number;
    eventCount: number;
    metricCount: number;
  };
  device?: DeviceInfo | { serial: string; error: string };
  failure?: {
    stepResult: StepResult;
    plannedStep?: ActionStep;
    message?: string;
  };
  trace: {
    plannedSteps: ActionStep[];
    stepResults: StepResult[];
    events: DeviceEvent[];
    metrics: MetricSummary;
  };
  sourceSnapshot?: TestRun["sourceSnapshot"];
  interactionAssets: {
    bindings: InteractionAssetBinding[];
    assets: InteractionAsset[];
    health: Array<{ assetId: string; health: unknown }>;
  };
  artifacts: {
    manifest: DiagnosticArtifactRef[];
    previews: ArtifactTextPreview[];
  };
};

export type ArtifactTextPreview = {
  artifactId: string;
  name: string;
  mimeType?: string;
  text: string;
  truncated: boolean;
  readError?: string;
};

type MetricSummary = {
  count: number;
  firstSampledAt?: string;
  lastSampledAt?: string;
  maxCpuPercent?: number;
  maxMemoryUsedKb?: number;
  maxBatteryTemperatureC?: number;
};

type BuildRunDiagnosticsOptions = {
  storage: RunDiagnosticsStorage;
  runId: string;
  now?: () => string;
  serverInfo?: Partial<RunDiagnosticsServerInfo>;
  getDeviceInfo?: (serial: string) => Promise<DeviceInfo>;
  readArtifactBytes?: (artifact: ArtifactRef) => Promise<Buffer | undefined>;
};

type RegisterRunDiagnosticsOptions = Omit<BuildRunDiagnosticsOptions, "runId">;

export async function buildRunDiagnostics(options: BuildRunDiagnosticsOptions): Promise<RunDiagnosticsBundle | undefined> {
  const run = options.storage.getRun(options.runId);
  if (!run) {
    return undefined;
  }
  const failedStep = firstFailedStepResult(run);
  const traceStepResults = diagnosticStepWindow(run.stepResults, failedStep);
  const tracePlannedSteps = plannedStepsForTrace(run.steps, traceStepResults, failedStep);
  const interactionAssets = runInteractionAssets(run, options.storage);
  const artifactManifest = diagnosticArtifactManifest(run, traceStepResults, tracePlannedSteps, interactionAssets.assets, options.storage);
  const artifactPreviews = await textArtifactPreviews(artifactManifest, options.readArtifactBytes ?? readArtifactFromDisk);
  const device = await diagnosticDevice(run.deviceSerial, options.getDeviceInfo);

  return {
    schemaVersion: 1,
    generatedAt: options.now?.() ?? nowIso(),
    server: {
      ...defaultServerInfo(),
      ...options.serverInfo
    },
    run: {
      id: run.id,
      caseName: run.caseName,
      deviceSerial: run.deviceSerial,
      status: run.status,
      config: run.config,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      reportHtmlPath: run.reportHtmlPath,
      stepCount: run.steps.length,
      stepResultCount: run.stepResults.length,
      artifactCount: run.artifacts.filter((artifact) => !artifact.deletedAt).length,
      eventCount: run.events.length,
      metricCount: run.metrics.length
    },
    device,
    failure: failedStep
      ? {
          stepResult: failedStep,
          plannedStep: plannedStepForResult(run.steps, failedStep),
          message: failedStep.errorMessage
        }
      : undefined,
    trace: {
      plannedSteps: tracePlannedSteps,
      stepResults: traceStepResults,
      events: recentEvents(run.events),
      metrics: summarizeMetrics(run.metrics)
    },
    sourceSnapshot: run.sourceSnapshot,
    interactionAssets,
    artifacts: {
      manifest: artifactManifest,
      previews: artifactPreviews
    }
  };
}

export async function buildRunDiagnosticsArchive(options: BuildRunDiagnosticsOptions): Promise<Buffer | undefined> {
  const readArtifactBytes = options.readArtifactBytes ?? readArtifactFromDisk;
  const diagnostics = await buildRunDiagnostics({ ...options, readArtifactBytes });
  if (!diagnostics) {
    return undefined;
  }

  const entries: ZipEntryInput[] = [];
  const bundledArtifacts: DiagnosticArtifactRef[] = [];
  const usedBundlePaths = new Set<string>();

  for (const artifact of diagnostics.artifacts.manifest) {
    if (artifact.type === "video") {
      bundledArtifacts.push({ ...artifact, skippedReason: "video_not_bundled_by_default" });
      continue;
    }
    const bytes = await readArtifactBytes(artifact);
    if (!bytes) {
      bundledArtifacts.push({ ...artifact, skippedReason: "artifact_bytes_unavailable" });
      continue;
    }
    const bundlePath = uniqueBundlePath(artifactBundlePath(artifact), usedBundlePaths);
    usedBundlePaths.add(bundlePath);
    bundledArtifacts.push({ ...artifact, bundlePath });
    entries.push({ path: bundlePath, bytes });
  }

  const archiveDiagnostics: RunDiagnosticsBundle = {
    ...diagnostics,
    artifacts: {
      ...diagnostics.artifacts,
      manifest: bundledArtifacts
    }
  };
  const archiveEntries: ZipEntryInput[] = [
    { path: "diagnostics.json", bytes: Buffer.from(JSON.stringify(archiveDiagnostics, null, 2), "utf8") },
    ...entries,
    { path: "README.txt", bytes: Buffer.from(diagnosticsReadme(), "utf8") }
  ];
  return createStoredZip(archiveEntries);
}

export function registerRunDiagnosticsRoutes(app: express.Application, options: RegisterRunDiagnosticsOptions): void {
  app.get("/api/runs/:id/diagnostics", async (req, res) => {
    try {
      if (req.query.format === "json") {
        const diagnostics = await buildRunDiagnostics({ ...options, runId: req.params.id });
        if (!diagnostics) {
          res.status(404).json({ error: "Run not found" });
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store, max-age=0");
        res.setHeader("Content-Disposition", `attachment; filename="${diagnosticJsonFileName(req.params.id)}"`);
        res.send(JSON.stringify(diagnostics, null, 2));
        return;
      }

      const archive = await buildRunDiagnosticsArchive({ ...options, runId: req.params.id });
      if (!archive) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Content-Disposition", `attachment; filename="${diagnosticZipFileName(req.params.id)}"`);
      res.send(archive);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function firstFailedStepResult(run: TestRun): StepResult | undefined {
  return run.stepResults.find((step) => step.status === "failed" || step.status === "timeout")
    ?? run.stepResults.find((step) => step.errorCode || step.errorMessage);
}

function diagnosticStepWindow(stepResults: StepResult[], failedStep: StepResult | undefined): StepResult[] {
  if (!stepResults.length) {
    return [];
  }
  const center = failedStep ? stepResults.findIndex((step) => step.id === failedStep.id) : stepResults.length - 1;
  const safeCenter = center >= 0 ? center : stepResults.length - 1;
  const start = Math.max(0, safeCenter - DIAGNOSTIC_STEP_WINDOW_RADIUS);
  const end = Math.min(stepResults.length, safeCenter + DIAGNOSTIC_STEP_WINDOW_RADIUS + 1);
  return stepResults.slice(start, end);
}

function plannedStepsForTrace(steps: ActionStep[], stepResults: StepResult[], failedStep: StepResult | undefined): ActionStep[] {
  const ids = new Set(stepResults.map((step) => step.stepId));
  if (failedStep) {
    ids.add(failedStep.stepId);
  }
  return steps.filter((step) => ids.has(step.id) || stepResults.some((result) => result.stepOrder === step.order));
}

function plannedStepForResult(steps: ActionStep[], result: StepResult): ActionStep | undefined {
  return steps.find((step) => step.id === result.stepId) ?? steps.find((step) => step.order === result.stepOrder);
}

function recentEvents(events: DeviceEvent[]): DeviceEvent[] {
  return events.slice(Math.max(0, events.length - DIAGNOSTIC_EVENT_LIMIT));
}

function summarizeMetrics(metrics: MetricSample[]): MetricSummary {
  return {
    count: metrics.length,
    firstSampledAt: metrics[0]?.sampledAt,
    lastSampledAt: metrics.at(-1)?.sampledAt,
    maxCpuPercent: maxNumber(metrics.map((sample) => sample.cpuPercent)),
    maxMemoryUsedKb: maxNumber(metrics.map((sample) => sample.memoryUsedKb)),
    maxBatteryTemperatureC: maxNumber(metrics.map((sample) => sample.batteryTemperatureC))
  };
}

function runInteractionAssets(run: TestRun, storage: RunDiagnosticsStorage): RunDiagnosticsBundle["interactionAssets"] {
  const bindings = run.sourceSnapshot?.interactionAssets ?? [];
  const ids = new Set(bindings.map((binding) => binding.assetId));
  const appId = runSourceAppId(run);
  const assets = appId && storage.listInteractionAssets
    ? storage.listInteractionAssets({ appId }).filter((asset) => ids.has(asset.id))
    : [];
  return {
    bindings,
    assets,
    health: [...ids].map((assetId) => ({
      assetId,
      health: storage.getInteractionAssetHealth?.(assetId)
    })).filter((item) => item.health !== undefined)
  };
}

function diagnosticArtifactManifest(
  run: TestRun,
  stepResults: StepResult[],
  plannedSteps: ActionStep[],
  interactionAssets: InteractionAsset[],
  storage: RunDiagnosticsStorage
): DiagnosticArtifactRef[] {
  const artifacts = new Map<string, DiagnosticArtifactRef>();
  const addArtifact = (artifact: ArtifactRef | undefined) => {
    if (artifact && !artifact.deletedAt) {
      artifacts.set(artifact.id, artifact);
    }
  };

  for (const result of stepResults) {
    for (const artifact of result.artifacts) {
      addArtifact(artifact);
    }
  }
  for (const artifact of run.artifacts.filter((item) => item.type === "video")) {
    addArtifact(artifact);
  }
  for (const id of relatedArtifactIds(stepResults, plannedSteps, recentEvents(run.events), interactionAssets)) {
    addArtifact(run.artifacts.find((artifact) => artifact.id === id) ?? storage.getArtifact?.(id));
  }

  return [...artifacts.values()];
}

function relatedArtifactIds(
  stepResults: StepResult[],
  plannedSteps: ActionStep[],
  events: DeviceEvent[],
  interactionAssets: InteractionAsset[]
): string[] {
  const ids = new Set<string>();
  for (const value of [...stepResults, ...plannedSteps, ...events, ...interactionAssets]) {
    collectArtifactIds(value, ids);
  }
  return [...ids];
}

function collectArtifactIds(value: unknown, ids: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactIds(item, ids, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (artifactIdKey(key)) {
      addArtifactIdValue(child, ids);
    }
    collectArtifactIds(child, ids, depth + 1);
  }
}

function artifactIdKey(key: string): boolean {
  return /(?:artifactid|artifactids|evidenceartifactids|baselineartifactid|screenshotartifactid)$/i.test(key);
}

function addArtifactIdValue(value: unknown, ids: Set<string>): void {
  if (typeof value === "string" && value.trim()) {
    ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      addArtifactIdValue(item, ids);
    }
  }
}

async function textArtifactPreviews(
  artifacts: ArtifactRef[],
  readArtifactBytes: (artifact: ArtifactRef) => Promise<Buffer | undefined>
): Promise<ArtifactTextPreview[]> {
  const textArtifacts = artifacts.filter(isPreviewableTextArtifact).slice(0, DIAGNOSTIC_TEXT_ARTIFACT_LIMIT);
  const previews: ArtifactTextPreview[] = [];
  for (const artifact of textArtifacts) {
    try {
      const bytes = await readArtifactBytes(artifact);
      if (!bytes) {
        continue;
      }
      const truncated = bytes.length > DIAGNOSTIC_TEXT_ARTIFACT_BYTES;
      previews.push({
        artifactId: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        text: bytes.subarray(0, DIAGNOSTIC_TEXT_ARTIFACT_BYTES).toString("utf8"),
        truncated
      });
    } catch (error) {
      previews.push({
        artifactId: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        text: "",
        truncated: false,
        readError: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return previews;
}

function isPreviewableTextArtifact(artifact: ArtifactRef): boolean {
  const mimeType = artifact.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return true;
  }
  return /\.(?:txt|log|json|csv)$/i.test(artifact.name);
}

async function readArtifactFromDisk(artifact: ArtifactRef): Promise<Buffer | undefined> {
  return readFile(artifactFilePath(artifact.path)).catch(() => undefined);
}

async function diagnosticDevice(serial: string, getDeviceInfo: BuildRunDiagnosticsOptions["getDeviceInfo"]): Promise<RunDiagnosticsBundle["device"]> {
  if (!getDeviceInfo) {
    return undefined;
  }
  try {
    return await getDeviceInfo(serial);
  } catch (error) {
    return {
      serial,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function runSourceAppId(run: TestRun): string | undefined {
  const parsed = recordValue(run.sourceSnapshot?.parsed);
  const app = recordValue(parsed?.app);
  return typeof app?.id === "string" && app.id.trim() ? app.id.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function maxNumber(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : undefined;
}

function defaultServerInfo(): RunDiagnosticsServerInfo {
  return {
    version: process.env.npm_package_version ?? "0.1.0",
    commit: process.env.GIT_COMMIT ?? process.env.COMMIT_SHA,
    buildTime: process.env.BUILD_TIME,
    nodeVersion: process.version,
    platform: process.platform
  };
}

function artifactBundlePath(artifact: ArtifactRef): string {
  return `artifacts/${artifactBundleFolder(artifact.type)}/${safeFileName(`${artifact.id}-${artifact.name}`)}`;
}

function artifactBundleFolder(type: ArtifactRef["type"]): string {
  if (type === "screenshot") return "screenshots";
  if (type === "log") return "logs";
  if (type === "metrics") return "metrics";
  if (type === "report_json" || type === "report_html") return "reports";
  return "artifacts";
}

function uniqueBundlePath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    return path;
  }
  const dot = path.lastIndexOf(".");
  const stem = dot > 0 ? path.slice(0, dot) : path;
  const extension = dot > 0 ? path.slice(dot) : "";
  for (let index = 2; ; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!usedPaths.has(candidate)) {
      return candidate;
    }
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function diagnosticsReadme(): string {
  return [
    "Mobile Automation diagnostics bundle",
    "",
    "diagnostics.json contains the run slice, failure trace, interaction asset metadata, and artifact manifest.",
    "Bundled screenshots/logs/metrics/reports are referenced by artifacts.manifest[].bundlePath.",
    "Videos are not bundled by default to keep the archive small; their original artifact metadata remains in diagnostics.json.",
    ""
  ].join("\n");
}

type ZipEntryInput = {
  path: string;
  bytes: Buffer;
};

function createStoredZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const crc = crc32(entry.bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(entry.bytes.length, 18);
    localHeader.writeUInt32LE(entry.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.bytes);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(entry.bytes.length, 20);
    centralHeader.writeUInt32LE(entry.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + entry.bytes.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

const crcTable = new Uint32Array(256).map((_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function diagnosticJsonFileName(runId: string): string {
  return `run-${runId.replace(/[^a-zA-Z0-9._-]+/g, "-")}-diagnostics.json`;
}

function diagnosticZipFileName(runId: string): string {
  return `run-${runId.replace(/[^a-zA-Z0-9._-]+/g, "-")}-diagnostics.zip`;
}
