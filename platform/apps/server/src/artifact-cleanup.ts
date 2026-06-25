import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { RunStatus } from "@mobile-automation/shared";
import { artifactRoot } from "./artifacts.js";
import type { StoredRunForCleanup, Storage } from "./storage.js";

export type ArtifactCleanupConfig = {
  enabled: boolean;
  retentionEnabled: boolean;
  passedRunRetentionDays: number;
  failedRunRetentionDays: number;
  maxArtifactStorageBytes: number;
  cleanupIntervalMs: number;
};

export type ArtifactCleanupResult = {
  deletedRunIds: string[];
  deletedByAge: number;
  deletedBySize: number;
  deletedTempFiles: number;
  deletedTempBytes: number;
  bytesBefore: number;
  bytesAfter: number;
};

type ArtifactCleanupStorage = Pick<Storage, "listRunsForCleanup" | "deleteRun">;

const bytesPerGb = 1024 * 1024 * 1024;
const msPerDay = 24 * 60 * 60 * 1000;
const msPerHour = 60 * 60 * 1000;
const temporaryArtifactSuffixes = [".tmp", ".part", ".partial", ".download"];

export function readArtifactCleanupConfig(env: NodeJS.ProcessEnv = process.env): ArtifactCleanupConfig {
  return {
    enabled: env.ARTIFACT_CLEANUP_ENABLED !== "0",
    retentionEnabled: parseBoolean(env.ARTIFACT_RETENTION_ENABLED, false),
    passedRunRetentionDays: parsePositiveNumber(env.PASSED_RUN_RETENTION_DAYS ?? env.ARTIFACT_PASSED_RUN_RETENTION_DAYS, 7),
    failedRunRetentionDays: parsePositiveNumber(env.FAILED_RUN_RETENTION_DAYS ?? env.ARTIFACT_FAILED_RUN_RETENTION_DAYS, 30),
    maxArtifactStorageBytes:
      parsePositiveNumber(env.MAX_ARTIFACT_STORAGE_GB ?? env.ARTIFACT_MAX_STORAGE_GB, 20) * bytesPerGb,
    cleanupIntervalMs: parsePositiveNumber(env.CLEANUP_INTERVAL_HOURS ?? env.ARTIFACT_CLEANUP_INTERVAL_HOURS, 6) * msPerHour
  };
}

export class ArtifactCleanupScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly config: ArtifactCleanupConfig;

  constructor(
    private readonly storage: ArtifactCleanupStorage,
    config: ArtifactCleanupConfig = readArtifactCleanupConfig()
  ) {
    this.config = config;
  }

  start(): void {
    if (!this.config.enabled) {
      return;
    }
    void this.runOnce("startup");
    if (this.config.cleanupIntervalMs > 0) {
      this.timer = setInterval(() => {
        void this.runOnce("interval");
      }, this.config.cleanupIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runOnce(reason = "manual"): Promise<ArtifactCleanupResult | undefined> {
    if (this.running || !this.config.enabled) {
      return undefined;
    }
    this.running = true;
    try {
      const result = await cleanupArtifacts(this.storage, this.config);
      if (result.deletedRunIds.length > 0 || result.deletedTempFiles > 0) {
        console.log(
          `Artifact cleanup ${reason}: deleted ${result.deletedRunIds.length} runs and ${result.deletedTempFiles} temp files, ${formatBytes(result.bytesBefore)} -> ${formatBytes(result.bytesAfter)}`
        );
      }
      return result;
    } catch (error) {
      console.warn(`Artifact cleanup ${reason} failed`, error);
      return undefined;
    } finally {
      this.running = false;
    }
  }
}

export async function cleanupArtifacts(
  storage: ArtifactCleanupStorage,
  config: ArtifactCleanupConfig,
  now = new Date(),
  artifactsRoot = artifactRoot
): Promise<ArtifactCleanupResult> {
  const bytesBefore = await directorySize(artifactsRoot);
  const deletedRunIds: string[] = [];
  let deletedByAge = 0;
  let deletedBySize = 0;
  const tempCleanup = await cleanupTemporaryArtifactFiles(artifactsRoot);

  if (!config.retentionEnabled) {
    return {
      deletedRunIds,
      deletedByAge,
      deletedBySize,
      deletedTempFiles: tempCleanup.deletedFiles,
      deletedTempBytes: tempCleanup.deletedBytes,
      bytesBefore,
      bytesAfter: await directorySize(artifactsRoot)
    };
  }

  const runs = storage.listRunsForCleanup();
  for (const run of runs) {
    if (isExpired(run, config, now)) {
      if (await storage.deleteRun(run.id)) {
        deletedRunIds.push(run.id);
        deletedByAge += 1;
      }
    }
  }

  let bytesAfter = await directorySize(artifactsRoot);
  if (config.maxArtifactStorageBytes > 0 && bytesAfter > config.maxArtifactStorageBytes) {
    const deleted = new Set(deletedRunIds);
    const candidates = runs.filter((run) => !deleted.has(run.id)).sort(compareCleanupPriority);
    for (const run of candidates) {
      if (bytesAfter <= config.maxArtifactStorageBytes) {
        break;
      }
      const runBytes = await directorySize(path.join(artifactsRoot, "runs", run.id));
      if (await storage.deleteRun(run.id)) {
        deletedRunIds.push(run.id);
        deletedBySize += 1;
        bytesAfter = Math.max(0, bytesAfter - runBytes);
      }
    }
  }

  return {
    deletedRunIds,
    deletedByAge,
    deletedBySize,
    deletedTempFiles: tempCleanup.deletedFiles,
    deletedTempBytes: tempCleanup.deletedBytes,
    bytesBefore,
    bytesAfter: await directorySize(artifactsRoot)
  };
}

async function cleanupTemporaryArtifactFiles(targetPath: string): Promise<{ deletedFiles: number; deletedBytes: number }> {
  const info = await stat(targetPath).catch(() => undefined);
  if (!info) {
    return { deletedFiles: 0, deletedBytes: 0 };
  }
  if (info.isFile()) {
    if (!isTemporaryArtifactFile(targetPath)) {
      return { deletedFiles: 0, deletedBytes: 0 };
    }
    await rm(targetPath, { force: true });
    return { deletedFiles: 1, deletedBytes: info.size };
  }
  if (!info.isDirectory()) {
    return { deletedFiles: 0, deletedBytes: 0 };
  }

  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => []);
  const results = await Promise.all(entries.map((entry) => cleanupTemporaryArtifactFiles(path.join(targetPath, entry.name))));
  return results.reduce(
    (total, result) => ({
      deletedFiles: total.deletedFiles + result.deletedFiles,
      deletedBytes: total.deletedBytes + result.deletedBytes
    }),
    { deletedFiles: 0, deletedBytes: 0 }
  );
}

async function directorySize(targetPath: string): Promise<number> {
  const info = await stat(targetPath).catch(() => undefined);
  if (!info) {
    return 0;
  }
  if (info.isFile()) {
    return info.size;
  }
  if (!info.isDirectory()) {
    return 0;
  }

  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        return directorySize(entryPath);
      }
      if (entry.isFile()) {
        return stat(entryPath)
          .then((fileInfo) => fileInfo.size)
          .catch(() => 0);
      }
      return Promise.resolve(0);
    })
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function isExpired(run: StoredRunForCleanup, config: ArtifactCleanupConfig, now: Date): boolean {
  const retentionDays = run.status === "passed" ? config.passedRunRetentionDays : config.failedRunRetentionDays;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    return false;
  }
  const referenceMs = runReferenceTime(run);
  return now.getTime() - referenceMs > retentionDays * msPerDay;
}

function compareCleanupPriority(a: StoredRunForCleanup, b: StoredRunForCleanup): number {
  const priorityDiff = statusCleanupPriority(a.status) - statusCleanupPriority(b.status);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  return runReferenceTime(a) - runReferenceTime(b);
}

function statusCleanupPriority(status: RunStatus): number {
  return status === "passed" ? 0 : 1;
}

function runReferenceTime(run: StoredRunForCleanup): number {
  const parsed = Date.parse(run.endedAt ?? run.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function isTemporaryArtifactFile(filePath: string): boolean {
  return temporaryArtifactSuffixes.some((suffix) => filePath.endsWith(suffix));
}

function formatBytes(bytes: number): string {
  if (bytes >= bytesPerGb) {
    return `${(bytes / bytesPerGb).toFixed(1)}GB`;
  }
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}
