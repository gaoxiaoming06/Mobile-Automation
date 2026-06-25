import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupArtifacts, readArtifactCleanupConfig, type ArtifactCleanupConfig } from "./artifact-cleanup.js";
import type { StoredRunForCleanup } from "./storage.js";

const config: ArtifactCleanupConfig = {
  enabled: true,
  retentionEnabled: true,
  passedRunRetentionDays: 7,
  failedRunRetentionDays: 30,
  maxArtifactStorageBytes: 1024 * 1024 * 1024,
  cleanupIntervalMs: 6 * 60 * 60 * 1000
};

describe("artifact cleanup", () => {
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it("keeps retention deletion disabled by default", () => {
    expect(readArtifactCleanupConfig({}).retentionEnabled).toBe(false);
    expect(readArtifactCleanupConfig({ ARTIFACT_RETENTION_ENABLED: "1" }).retentionEnabled).toBe(true);
  });

  it("keeps completed reports when retention is disabled and only removes temporary files", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-cleanup-"));
    const storage = new FakeCleanupStorage(tempRoot, [run("run-passed-old", "passed", "2026-01-01T00:00:00.000Z")]);
    await storage.writeRunArtifact("run-passed-old", 10);
    await storage.writeRunTempArtifact("run-passed-old", 5);

    const result = await cleanupArtifacts(
      storage,
      {
        ...config,
        retentionEnabled: false,
        passedRunRetentionDays: 1,
        maxArtifactStorageBytes: 1
      },
      new Date("2026-06-05T00:00:00.000Z"),
      tempRoot
    );

    expect(result.deletedRunIds).toEqual([]);
    expect(result.deletedTempFiles).toBe(1);
    expect(result.deletedTempBytes).toBe(5);
    expect(storage.hasRun("run-passed-old")).toBe(true);
  });

  it("deletes expired passed and failed runs by their own retention windows", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-cleanup-"));
    const storage = new FakeCleanupStorage(tempRoot, [
      run("run-passed-old", "passed", "2026-05-20T00:00:00.000Z"),
      run("run-failed-recent", "failed", "2026-05-20T00:00:00.000Z"),
      run("run-failed-old", "failed", "2026-04-20T00:00:00.000Z")
    ]);
    await storage.writeRunArtifact("run-passed-old", 10);
    await storage.writeRunArtifact("run-failed-recent", 10);
    await storage.writeRunArtifact("run-failed-old", 10);

    const result = await cleanupArtifacts(storage, config, new Date("2026-06-05T00:00:00.000Z"), tempRoot);

    expect(result.deletedRunIds).toEqual(["run-passed-old", "run-failed-old"]);
    expect(storage.hasRun("run-failed-recent")).toBe(true);
  });

  it("uses passed runs first when enforcing the max storage limit", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-cleanup-"));
    const storage = new FakeCleanupStorage(tempRoot, [
      run("run-passed", "passed", "2026-06-04T00:00:00.000Z"),
      run("run-failed", "failed", "2026-06-03T00:00:00.000Z")
    ]);
    await storage.writeRunArtifact("run-passed", 80);
    await storage.writeRunArtifact("run-failed", 80);

    const result = await cleanupArtifacts(
      storage,
      {
        ...config,
        passedRunRetentionDays: 365,
        failedRunRetentionDays: 365,
        maxArtifactStorageBytes: 100
      },
      new Date("2026-06-05T00:00:00.000Z"),
      tempRoot
    );

    expect(result.deletedRunIds).toEqual(["run-passed"]);
    expect(storage.hasRun("run-failed")).toBe(true);
  });
});

class FakeCleanupStorage {
  private readonly runs = new Map<string, StoredRunForCleanup>();

  constructor(
    private readonly artifactsRoot: string,
    runs: StoredRunForCleanup[]
  ) {
    for (const item of runs) {
      this.runs.set(item.id, item);
    }
  }

  listRunsForCleanup(): StoredRunForCleanup[] {
    return Array.from(this.runs.values());
  }

  async deleteRun(runId: string): Promise<boolean> {
    const deleted = this.runs.delete(runId);
    if (deleted) {
      await rm(path.join(this.artifactsRoot, "runs", runId), { recursive: true, force: true });
    }
    return deleted;
  }

  hasRun(runId: string): boolean {
    return this.runs.has(runId);
  }

  async writeRunArtifact(runId: string, bytes: number): Promise<void> {
    const dir = path.join(this.artifactsRoot, "runs", runId, "reports");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "report.html"), "x".repeat(bytes));
  }

  async writeRunTempArtifact(runId: string, bytes: number): Promise<void> {
    const dir = path.join(this.artifactsRoot, "runs", runId, "videos");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "recording.mp4.tmp"), "x".repeat(bytes));
  }
}

function run(id: string, status: StoredRunForCleanup["status"], endedAt: string): StoredRunForCleanup {
  return {
    id,
    status,
    createdAt: endedAt,
    endedAt
  };
}
