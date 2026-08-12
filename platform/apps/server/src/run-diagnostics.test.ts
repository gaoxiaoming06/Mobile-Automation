import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactRef, InteractionAsset, TestRun } from "@mobile-automation/shared";
import {
  buildRunDiagnostics,
  buildRunDiagnosticsArchive,
  registerRunDiagnosticsRoutes,
  type RunDiagnosticsStorage
} from "./run-diagnostics.js";

describe("run diagnostics", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("exports only the selected run slice, related assets, and small artifact previews", async () => {
    const storage = diagnosticStorage();

    const diagnostics = await buildRunDiagnostics({
      storage,
      runId: "run-failed",
      now: () => "2026-08-12T03:00:00.000Z",
      serverInfo: { version: "0.1.0", commit: "commit-a" },
      readArtifactBytes: async (artifact) => artifact.id === "log-1" ? Buffer.from("locator score 0.41\ncandidate: 确定") : undefined,
      getDeviceInfo: async () => ({
        id: "device-1",
        serial: "device-1",
        platform: "android",
        status: "online",
        model: "Pixel 8",
        osVersion: "15",
        resolution: { width: 1080, height: 2400 },
        capabilities: deviceCapabilities(),
        lastSeenAt: "2026-08-12T02:59:00.000Z"
      })
    });
    expect(diagnostics).toBeDefined();
    const bundle = diagnostics!;

    expect(bundle).toEqual(expect.objectContaining({
      schemaVersion: 1,
      generatedAt: "2026-08-12T03:00:00.000Z",
      server: expect.objectContaining({ version: "0.1.0", commit: "commit-a" }),
      run: expect.objectContaining({
        id: "run-failed",
        status: "failed",
        stepResultCount: 3,
        artifactCount: 3
      }),
      device: expect.objectContaining({ serial: "device-1", model: "Pixel 8" })
    }));
    expect(bundle.failure?.stepResult?.id).toBe("result-2");
    expect(bundle.trace.stepResults.map((result) => result.id)).toEqual(["result-1", "result-2", "result-3"]);
    expect(bundle.interactionAssets.bindings).toEqual([
      { stepId: "tap-submit", assetId: "asset-submit", key: "classin.submit", version: 2 }
    ]);
    expect(bundle.interactionAssets.assets).toEqual([
      expect.objectContaining({ id: "asset-submit", key: "classin.submit", version: 2 })
    ]);
    expect(bundle.artifacts.manifest.map((artifact) => artifact.id)).toEqual(["screenshot-1", "log-1", "video-1", "asset-baseline"]);
    expect(bundle.artifacts.previews).toEqual([
      expect.objectContaining({
        artifactId: "log-1",
        text: "locator score 0.41\ncandidate: 确定",
        truncated: false
      })
    ]);
    expect(JSON.stringify(bundle)).not.toContain("run-unrelated");
  });

  it("builds a portable zip archive with diagnostics json and bundled evidence files", async () => {
    const archive = await buildRunDiagnosticsArchive({
      storage: diagnosticStorage(),
      runId: "run-failed",
      now: () => "2026-08-12T03:00:00.000Z",
      readArtifactBytes: async (artifact) => artifactBytes(artifact)
    });

    expect(archive).toBeDefined();
    const entries = unzipStoredEntries(archive!);

    expect([...entries.keys()]).toEqual([
      "diagnostics.json",
      "artifacts/screenshots/screenshot-1-after.png",
      "artifacts/logs/log-1-locator.txt",
      "artifacts/screenshots/asset-baseline-asset-baseline.png",
      "README.txt"
    ]);
    expect(entries.get("artifacts/logs/log-1-locator.txt")?.toString("utf8")).toBe("locator score 0.41\ncandidate: 确定");
    const diagnostics = JSON.parse(entries.get("diagnostics.json")!.toString("utf8")) as {
      artifacts: { manifest: Array<{ id: string; bundlePath?: string; skippedReason?: string }> };
    };
    expect(diagnostics.artifacts.manifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "screenshot-1", bundlePath: "artifacts/screenshots/screenshot-1-after.png" }),
      expect.objectContaining({ id: "log-1", bundlePath: "artifacts/logs/log-1-locator.txt" }),
      expect.objectContaining({ id: "asset-baseline", bundlePath: "artifacts/screenshots/asset-baseline-asset-baseline.png" }),
      expect.objectContaining({ id: "video-1", skippedReason: "video_not_bundled_by_default" })
    ]));
  });

  it("does not bundle unrelated run artifacts outside the failure trace", async () => {
    const run = diagnosticRun();
    run.artifacts.push({
      id: "unrelated-screenshot",
      runId: run.id,
      type: "screenshot",
      name: "unrelated.png",
      path: "runs/run-failed/screenshots/unrelated.png",
      url: "/artifacts/runs/run-failed/screenshots/unrelated.png",
      mimeType: "image/png",
      createdAt: "2026-08-12T02:59:59.000Z"
    });
    const archive = await buildRunDiagnosticsArchive({
      storage: {
        ...diagnosticStorage(),
        getRun: (id) => id === run.id ? run : undefined
      },
      runId: "run-failed",
      readArtifactBytes: async (artifact) => artifact.id === "unrelated-screenshot" ? Buffer.from([1, 2, 3]) : artifactBytes(artifact)
    });

    const entries = unzipStoredEntries(archive!);
    const diagnostics = JSON.parse(entries.get("diagnostics.json")!.toString("utf8")) as {
      artifacts: { manifest: Array<{ id: string }> };
    };

    expect([...entries.keys()].some((name) => name.includes("unrelated"))).toBe(false);
    expect(diagnostics.artifacts.manifest.some((artifact) => artifact.id === "unrelated-screenshot")).toBe(false);
  });

  it("serves the diagnostics as a downloaded zip file", async () => {
    const app = express();
    registerRunDiagnosticsRoutes(app, {
      storage: diagnosticStorage(),
      now: () => "2026-08-12T03:00:00.000Z",
      readArtifactBytes: async (artifact) => artifactBytes(artifact)
    });
    const baseUrl = await listen(app, servers);

    const response = await fetch(`${baseUrl}/api/runs/run-failed/diagnostics`);
    const body = Buffer.from(await response.arrayBuffer());
    const entries = unzipStoredEntries(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("content-disposition")).toContain("run-run-failed-diagnostics.zip");
    expect(entries.get("diagnostics.json")?.toString("utf8")).toContain("\"id\": \"run-failed\"");
  });

  it("returns 404 when the run does not exist", async () => {
    const app = express();
    registerRunDiagnosticsRoutes(app, { storage: diagnosticStorage() });
    const baseUrl = await listen(app, servers);

    const response = await fetch(`${baseUrl}/api/runs/missing/diagnostics`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Run not found" });
  });
});

function diagnosticStorage(): RunDiagnosticsStorage {
  const run = diagnosticRun();
  const assets = [interactionAsset()];
  const artifacts = new Map(run.artifacts.map((artifact) => [artifact.id, artifact]));
  artifacts.set("asset-baseline", {
    id: "asset-baseline",
    type: "screenshot",
    name: "asset-baseline.png",
    path: "assets/asset-baseline.png",
    url: "/artifacts/assets/asset-baseline.png",
    mimeType: "image/png",
    createdAt: "2026-08-12T02:55:00.000Z"
  });
  return {
    getRun: (id) => id === run.id ? run : undefined,
    getArtifact: (id) => artifacts.get(id),
    listInteractionAssets: () => assets,
    getInteractionAssetHealth: (assetId) => assetId === "asset-submit"
      ? { status: "active", consecutiveLocatorFailures: 1, successfulRunCount: 4, lastRunId: "run-failed", updatedAt: "2026-08-12T02:59:00.000Z" }
      : undefined
  };
}

function artifactBytes(artifact: ArtifactRef): Buffer | undefined {
  if (artifact.id === "screenshot-1") return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  if (artifact.id === "asset-baseline") return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]);
  if (artifact.id === "log-1") return Buffer.from("locator score 0.41\ncandidate: 确定");
  if (artifact.id === "video-1") return Buffer.from("video bytes should not be bundled");
  return undefined;
}

function unzipStoredEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    expect(method).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);
    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function diagnosticRun(): TestRun {
  return {
    id: "run-failed",
    caseName: "提交作业",
    deviceSerial: "device-1",
    status: "failed",
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: false,
      runKind: "script_flow"
    },
    steps: [{
      id: "tap-submit",
      order: 2,
      type: "tap_on_text",
      enabled: true,
      title: "提交",
      params: { scriptStepId: "tap-submit", text: "提交", baselineArtifactId: "asset-baseline" },
      createdAt: "2026-08-12T02:58:00.000Z"
    }],
    stepResults: [
      stepResult("result-1", "tap-open", "passed", 1),
      stepResult("result-2", "tap-submit", "failed", 2, {
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        errorMessage: "未找到提交按钮",
        artifacts: [artifact("screenshot-1", "screenshot", "after.png"), artifact("log-1", "log", "locator.txt")],
        metadata: { interactionAssetId: "asset-submit", topCandidates: [{ text: "确定", score: 0.41 }] }
      }),
      stepResult("result-3", "cleanup", "skipped", 3)
    ],
    metrics: [
      { id: "metric-1", runId: "run-failed", deviceSerial: "device-1", sampledAt: "2026-08-12T02:58:01.000Z", cpuPercent: 8, memoryUsedKb: 1000 },
      { id: "metric-2", runId: "run-failed", deviceSerial: "device-1", sampledAt: "2026-08-12T02:58:05.000Z", cpuPercent: 21, memoryUsedKb: 1600 }
    ],
    events: [{
      id: "event-1",
      runId: "run-failed",
      deviceSerial: "device-1",
      type: "interaction_asset_degraded",
      severity: "warning",
      occurredAt: "2026-08-12T02:58:05.000Z",
      summary: "定位资产可能过期",
      artifactIds: ["log-1"]
    }],
    artifacts: [
      artifact("screenshot-1", "screenshot", "after.png"),
      artifact("log-1", "log", "locator.txt"),
      artifact("video-1", "video", "run.mp4")
    ],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "flow-1",
      version: 3,
      planDigest: "digest-1",
      executionPlatform: "android",
      executionPurpose: "normal",
      sourceHash: "source-hash",
      interactionAssets: [{ stepId: "tap-submit", assetId: "asset-submit", key: "classin.submit", version: 2 }],
      dependencies: [],
      sourceYaml: "version: 1\nname: 提交作业",
      parsed: { app: { id: "cn.eeo.classin" }, steps: [{ id: "tap-submit" }] }
    },
    startedAt: "2026-08-12T02:58:00.000Z",
    endedAt: "2026-08-12T02:58:05.000Z"
  };
}

function stepResult(
  id: string,
  stepId: string,
  status: TestRun["stepResults"][number]["status"],
  stepOrder: number,
  overrides: Partial<TestRun["stepResults"][number]> = {}
): TestRun["stepResults"][number] {
  return {
    id,
    runId: "run-failed",
    iterationIndex: 0,
    stepId,
    stepOrder,
    type: "tap_on_text",
    status,
    startedAt: "2026-08-12T02:58:00.000Z",
    durationMs: 1000,
    artifacts: [],
    ...overrides
  };
}

function artifact(id: string, type: ArtifactRef["type"], name: string): ArtifactRef {
  return {
    id,
    runId: "run-failed",
    stepResultId: type === "video" ? undefined : "result-2",
    type,
    name,
    path: `runs/run-failed/${type === "screenshot" ? "screenshots" : type === "video" ? "videos" : "logs"}/${name}`,
    url: `/artifacts/runs/run-failed/${type === "screenshot" ? "screenshots" : type === "video" ? "videos" : "logs"}/${name}`,
    mimeType: type === "screenshot" ? "image/png" : type === "video" ? "video/mp4" : "text/plain",
    createdAt: "2026-08-12T02:58:05.000Z"
  };
}

function interactionAsset(): InteractionAsset {
  return {
    id: "asset-submit",
    key: "classin.submit",
    appId: "cn.eeo.classin",
    platformScope: "android",
    owner: { kind: "page", key: "classin.home" },
    name: "提交按钮",
    aliases: ["提交"],
    supportedActions: ["tap"],
    semanticContract: { text: "提交" },
    locatorVariants: [{
      platform: "android",
      strategy: "image_region",
      descriptor: { baselineArtifactId: "asset-baseline", threshold: 0.82 },
      confidence: 0.9
    }],
    status: "active",
    version: 2,
    provenance: { runIds: ["run-failed"], stepIds: ["tap-submit"], artifactIds: ["asset-baseline"] },
    createdAt: "2026-08-12T02:55:00.000Z",
    updatedAt: "2026-08-12T02:56:00.000Z"
  };
}

function deviceCapabilities() {
  return {
    preview: true,
    tap: true,
    longPress: true,
    swipe: true,
    back: true,
    home: true,
    recentApps: true,
    textInput: true,
    screenshot: true,
    launchApp: true,
    closeApp: true,
    recordVideo: true,
    metrics: { cpu: true, memory: true, fps: false, network: false, battery: true, temperature: true },
    events: { crash: true, anr: true, logs: true }
  };
}

async function listen(app: express.Express, servers: Server[]): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
}
