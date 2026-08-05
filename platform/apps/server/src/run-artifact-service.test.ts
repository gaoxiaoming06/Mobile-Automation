import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactRef, TestRun } from "@mobile-automation/shared";
import type { MobileVideoRecording } from "./mobile-driver.js";
import { RunArtifactService, type RunArtifactStorage } from "./run-artifact-service.js";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("RunArtifactService", () => {
  it("captures screenshots and persists artifact metadata", async () => {
    const storage = new MemoryArtifactStorage();
    const png = pngBuffer();
    const service = new RunArtifactService(storage, {
      screenshot: async () => png,
      stopVideoRecording: async () => undefined
    });

    const capture = await service.captureStepScreenshotWithBytes("run-1", "step-result-1", 0, 1, "device-1", "after");

    expect(capture.png).toEqual(png);
    expect(capture.artifact).toEqual(
      expect.objectContaining({
        runId: "run-1",
        stepResultId: "step-result-1",
        type: "screenshot",
        mimeType: "image/png"
      })
    );
    expect(storage.artifacts).toHaveLength(1);
    expect(storage.writes[0]?.relativePath).toContain("runs/run-1/screenshots/");
  });

  it("retries empty screenshots before writing an artifact", async () => {
    const storage = new MemoryArtifactStorage();
    const png = pngBuffer();
    let attempts = 0;
    const service = new RunArtifactService(
      storage,
      {
        screenshot: async () => {
          attempts += 1;
          return attempts === 1 ? Buffer.alloc(0) : png;
        },
        stopVideoRecording: async () => undefined
      },
      { screenshotRetryDelayMs: 0 }
    );

    const capture = await service.captureLocatorScreenshot("run-1", "step-result-1", "device-1", "select-duration", 1);

    expect(attempts).toBe(2);
    expect(capture.png).toEqual(png);
    expect(storage.artifacts).toHaveLength(1);
    expect(storage.artifacts[0]?.sizeBytes).toBe(png.byteLength);
    expect(storage.writes).toEqual([expect.objectContaining({ bytes: png })]);
  });

  it("rejects invalid screenshots after retrying without writing an artifact", async () => {
    const storage = new MemoryArtifactStorage();
    let attempts = 0;
    const service = new RunArtifactService(
      storage,
      {
        screenshot: async () => {
          attempts += 1;
          return attempts === 1 ? Buffer.alloc(0) : Buffer.from("not-a-png");
        },
        stopVideoRecording: async () => undefined
      },
      { screenshotRetryDelayMs: 0 }
    );

    await expect(service.captureLocatorScreenshot("run-1", "step-result-1", "device-1", "select-duration", 1)).rejects.toThrow(
      "Invalid screenshot captured from device device-1 after 3 attempts"
    );
    expect(attempts).toBe(3);
    expect(storage.artifacts).toEqual([]);
    expect(storage.writes).toEqual([]);
  });

  it("writes logs and stores them as log artifacts", async () => {
    const storage = new MemoryArtifactStorage();
    const service = new RunArtifactService(storage, {
      screenshot: async () => pngBuffer(),
      stopVideoRecording: async () => undefined
    });

    const artifact = await service.writeLog("run-1", "step-log.txt", "hello", "step-result-1");

    expect(artifact).toEqual(
      expect.objectContaining({
        type: "log",
        name: "step-log.txt",
        mimeType: "text/plain",
        stepResultId: "step-result-1"
      })
    );
    expect(storage.artifacts).toEqual([artifact]);
  });

  it("writes android app monitor CSV and summary JSON artifacts", async () => {
    const storage = new MemoryArtifactStorage();
    const service = new RunArtifactService(storage, {
      screenshot: async () => pngBuffer(),
      stopVideoRecording: async () => undefined
    });

    const summary = await service.writeAndroidAppMonitorArtifacts(
      "run-1",
      {
        packageName: "com.demo",
        startedAt: "2026-06-09T00:00:00.000Z",
        endedAt: "2026-06-09T00:00:02.000Z",
        processes: [],
        sampleCounts: { cpu: 1, memory: 1, lifecycle: 1 },
        incidents: [],
        artifacts: {}
      },
      {
        cpu: [{ sampledAt: "2026-06-09T00:00:01.000Z", pid: 123, processName: "com.demo", cpuPercent: 12.5 }],
        memory: [{ sampledAt: "2026-06-09T00:00:01.000Z", pid: 123, processName: "com.demo", pssKb: 2048, rssKb: 4096 }],
        lifecycle: [{ occurredAt: "2026-06-09T00:00:00.500Z", type: "process_started", pid: 123, processName: "com.demo" }]
      }
    );

    expect(storage.artifacts).toEqual([
      expect.objectContaining({ type: "metrics", name: "android-app-monitor-cpu.csv", mimeType: "text/csv" }),
      expect.objectContaining({ type: "metrics", name: "android-app-monitor-memory.csv", mimeType: "text/csv" }),
      expect.objectContaining({ type: "metrics", name: "android-app-monitor-lifecycle.csv", mimeType: "text/csv" }),
      expect.objectContaining({ type: "report_json", name: "android-app-monitor-summary.json", mimeType: "application/json" })
    ]);
    expect(storage.writes.map((write) => write.relativePath)).toEqual([
      "runs/run-1/metrics/android-app-monitor-cpu.csv",
      "runs/run-1/metrics/android-app-monitor-memory.csv",
      "runs/run-1/metrics/android-app-monitor-lifecycle.csv",
      "runs/run-1/reports/android-app-monitor-summary.json"
    ]);
    expect(summary.artifacts.summaryJsonArtifactId).toBe(storage.artifacts[3]?.id);
    expect(summary.artifacts.cpuCsvArtifactId).toBe(storage.artifacts[0]?.id);
    expect(String(storage.writes[0]?.bytes)).toContain("cpuPercent");
    expect(JSON.parse(String(storage.writes[3]?.bytes))).toEqual(summary);
  });

  it("keeps stopped videos as video artifacts when requested", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-artifacts-"));
    const videoPath = path.join(tempRoot, "run-1.mp4");
    await mkdir(path.dirname(videoPath), { recursive: true });
    await writeFile(videoPath, "video");
    const storage = new MemoryArtifactStorage();
    const service = new RunArtifactService(storage, {
      screenshot: async () => pngBuffer(),
      stopVideoRecording: async () => videoPath
    });

    await service.finalizeVideo("run-1", videoRecording(videoPath), true);

    expect(storage.artifacts).toEqual([
      expect.objectContaining({
        type: "video",
        name: "run-1.mp4",
        mimeType: "video/mp4",
        sizeBytes: 5
      })
    ]);
  });

  it("generates an HTML report artifact and updates the run report path", async () => {
    const storage = new MemoryArtifactStorage();
    storage.run = {
      id: "run-1",
      caseName: "Smoke",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-09T00:00:00.000Z",
      endedAt: "2026-06-09T00:00:01.000Z"
    };
    const service = new RunArtifactService(storage, {
      screenshot: async () => pngBuffer(),
      stopVideoRecording: async () => undefined
    });

    await service.generateReport("run-1");

    expect(storage.reportPath).toBe("runs/run-1/reports/report.html");
    expect(storage.artifacts).toEqual([
      expect.objectContaining({
        type: "report_html",
        name: "report.html",
        mimeType: "text/html"
      })
    ]);
    expect(String(storage.writes[0]?.bytes)).toContain("Smoke");
  });

  it("removes failed video files and writes a log when stopping recording fails", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-artifacts-"));
    const videoPath = path.join(tempRoot, "run-1.mp4");
    await writeFile(videoPath, "video");
    const storage = new MemoryArtifactStorage();
    const service = new RunArtifactService(storage, {
      screenshot: async () => pngBuffer(),
      stopVideoRecording: async () => {
        throw new Error("stop failed");
      }
    });

    await service.finalizeVideo("run-1", videoRecording(videoPath), true);

    await expect(stat(videoPath)).rejects.toThrow();
    expect(storage.artifacts).toEqual([expect.objectContaining({ type: "log", name: expect.stringContaining("video-stop-failed") })]);
  });
});

class MemoryArtifactStorage implements RunArtifactStorage {
  artifacts: ArtifactRef[] = [];
  writes: Array<{ relativePath: string; bytes: Buffer | string }> = [];
  reportPath = "";
  run: TestRun | undefined;

  getRun(runId: string): TestRun | undefined {
    return this.run?.id === runId ? this.run : undefined;
  }

  async writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }> {
    this.writes.push({ relativePath, bytes });
    return {
      absolutePath: path.join("/tmp", relativePath),
      sizeBytes: Buffer.byteLength(bytes)
    };
  }

  addArtifact(artifact: ArtifactRef): void {
    this.artifacts.push(artifact);
  }

  updateRunReport(_runId: string, relativePath: string): void {
    this.reportPath = relativePath;
  }
}

function videoRecording(localPath: string): MobileVideoRecording {
  return {
    id: "run-1",
    serial: "device-1",
    localPath,
    startedAt: "2026-06-09T00:00:00.000Z"
  };
}

function pngBuffer(width = 1, height = 1): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
