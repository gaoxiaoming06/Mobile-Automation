import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { renderReportHtml } from "@mobile-automation/report-core";
import {
  createId,
  nowIso,
  type AndroidAppMonitorSummary,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type ArtifactRef,
  type TestRun
} from "@mobile-automation/shared";
import { artifactRoot, artifactUrl, runArtifactPath } from "./artifacts.js";
import type { AutomationDeviceDriver, MobileVideoRecording } from "./mobile-driver.js";
import type { ScreenshotCapture } from "./step-expectations.js";

export type RunArtifactStorage = {
  getRun(runId: string): TestRun | undefined;
  writeArtifact(relativePath: string, bytes: Buffer | string): Promise<{ absolutePath: string; sizeBytes: number }>;
  addArtifact(artifact: ArtifactRef): void;
  updateRunReport(runId: string, relativePath: string): void;
};

export class RunArtifactService {
  constructor(
    private readonly storage: RunArtifactStorage,
    private readonly driver: Pick<AutomationDeviceDriver, "screenshot" | "stopVideoRecording">
  ) {}

  absoluteRunDir(runId: string, kind: "videos"): string {
    return path.join(artifactRoot, "runs", runId, kind);
  }

  async captureStepScreenshot(runId: string, stepResultId: string, iterationIndex: number, stepOrder: number, serial: string): Promise<ArtifactRef> {
    return (await this.captureStepScreenshotWithBytes(runId, stepResultId, iterationIndex, stepOrder, serial, "after")).artifact;
  }

  async captureStepScreenshotWithBytes(
    runId: string,
    stepResultId: string,
    iterationIndex: number,
    stepOrder: number,
    serial: string,
    phase: "before" | "after"
  ): Promise<ScreenshotCapture> {
    const png = await this.driver.screenshot(serial);
    const fileName = `iter-${iterationIndex}-step-${stepOrder}-${phase}-${Date.now()}.png`;
    return this.writeScreenshotArtifact(runId, stepResultId, fileName, png);
  }

  async captureRunEventScreenshot(runId: string, stepResultId: string | undefined, eventType: string, serial: string): Promise<ArtifactRef> {
    const png = await this.driver.screenshot(serial);
    const fileName = `${eventType}-${Date.now()}.png`;
    return (await this.writeScreenshotArtifact(runId, stepResultId, fileName, png)).artifact;
  }

  async captureExpectationScreenshot(
    runId: string,
    stepResultId: string,
    serial: string,
    expectationId: string,
    attempt: number
  ): Promise<ScreenshotCapture> {
    const png = await this.driver.screenshot(serial);
    const fileName = `expectation-${expectationId}-attempt-${attempt}-${Date.now()}.png`;
    return this.writeScreenshotArtifact(runId, stepResultId, fileName, png);
  }

  async captureConditionScreenshot(runId: string, stepResultId: string, serial: string, stepId: string, attempt: number): Promise<ScreenshotCapture> {
    const png = await this.driver.screenshot(serial);
    const fileName = `condition-${stepId}-attempt-${attempt}-${Date.now()}.png`;
    return this.writeScreenshotArtifact(runId, stepResultId, fileName, png);
  }

  async captureLocatorScreenshot(runId: string, stepResultId: string, serial: string, stepId: string, attempt: number): Promise<ScreenshotCapture> {
    const png = await this.driver.screenshot(serial);
    const fileName = `locator-${stepId}-attempt-${attempt}-${Date.now()}.png`;
    return this.writeScreenshotArtifact(runId, stepResultId, fileName, png);
  }

  async writeLog(runId: string, fileName: string, content: string, stepResultId?: string): Promise<ArtifactRef> {
    const relativePath = runArtifactPath(runId, "logs", fileName);
    const written = await this.storage.writeArtifact(relativePath, content);
    const artifact: ArtifactRef = {
      id: createId("artifact"),
      runId,
      stepResultId,
      type: "log",
      name: fileName,
      path: relativePath,
      url: artifactUrl(relativePath),
      mimeType: "text/plain",
      sizeBytes: written.sizeBytes,
      createdAt: nowIso()
    };
    this.storage.addArtifact(artifact);
    return artifact;
  }

  async writeAndroidAppMonitorArtifacts(
    runId: string,
    summary: AndroidAppMonitorSummary,
    samples: {
      cpu: AndroidProcessMetricSample[];
      memory: AndroidProcessMetricSample[];
      lifecycle: AndroidProcessLifecycleEvent[];
    }
  ): Promise<AndroidAppMonitorSummary> {
    const cpuCsv = await this.writeTypedArtifact(runId, "metrics", "android-app-monitor-cpu.csv", cpuSamplesToCsv(samples.cpu), "metrics", "text/csv");
    const memoryCsv = await this.writeTypedArtifact(
      runId,
      "metrics",
      "android-app-monitor-memory.csv",
      memorySamplesToCsv(samples.memory),
      "metrics",
      "text/csv"
    );
    const lifecycleCsv = await this.writeTypedArtifact(
      runId,
      "metrics",
      "android-app-monitor-lifecycle.csv",
      lifecycleEventsToCsv(samples.lifecycle),
      "metrics",
      "text/csv"
    );
    const summaryJsonArtifactId = createId("artifact");
    const enrichedSummary: AndroidAppMonitorSummary = {
      ...summary,
      sampleCounts: { ...summary.sampleCounts },
      processes: [...summary.processes],
      incidents: summary.incidents.map((incident) => ({
        ...incident,
        artifactIds: [...incident.artifactIds],
        metadata: incident.metadata ? { ...incident.metadata } : undefined
      })),
      artifacts: {
        ...summary.artifacts,
        cpuCsvArtifactId: cpuCsv.id,
        memoryCsvArtifactId: memoryCsv.id,
        lifecycleCsvArtifactId: lifecycleCsv.id,
        summaryJsonArtifactId
      }
    };
    await this.writeTypedArtifact(
      runId,
      "reports",
      "android-app-monitor-summary.json",
      JSON.stringify(enrichedSummary, null, 2),
      "report_json",
      "application/json",
      summaryJsonArtifactId
    );
    return enrichedSummary;
  }

  async writeExpectationImageArtifact(runId: string, stepResultId: string, fileName: string, png: Buffer): Promise<ArtifactRef> {
    return (await this.writeScreenshotArtifact(runId, stepResultId, fileName, png)).artifact;
  }

  async readArtifactBytes(runId: string, artifactId: string): Promise<Buffer | undefined> {
    const run = this.storage.getRun(runId);
    const artifact = run?.artifacts.find((item) => item.id === artifactId);
    if (!artifact) {
      return undefined;
    }
    return readFile(path.join(artifactRoot, artifact.path));
  }

  async finalizeVideo(runId: string, recording: MobileVideoRecording | undefined, failed: boolean): Promise<void> {
    if (!recording) {
      return;
    }

    try {
      const localPath = await this.driver.stopVideoRecording(recording, failed);
      if (!failed || !localPath) {
        return;
      }

      const fileInfo = await stat(localPath);
      const relativePath = path.join("runs", runId, "videos", path.basename(localPath));
      const artifact: ArtifactRef = {
        id: createId("artifact"),
        runId,
        type: "video",
        name: path.basename(localPath),
        path: relativePath,
        url: artifactUrl(relativePath),
        mimeType: "video/mp4",
        sizeBytes: fileInfo.size,
        createdAt: recording.startedAt
      };
      this.storage.addArtifact(artifact);
    } catch (error) {
      await rm(recording.localPath, { force: true }).catch(() => undefined);
      await this.writeLog(runId, `video-stop-failed-${Date.now()}.txt`, errorToString(error));
    }
  }

  async generateReport(runId: string): Promise<void> {
    const run = this.storage.getRun(runId);
    if (!run) {
      return;
    }
    const html = renderReportHtml(run);
    const fileName = "report.html";
    const relativePath = runArtifactPath(runId, "reports", fileName);
    const written = await this.storage.writeArtifact(relativePath, html);
    const artifact: ArtifactRef = {
      id: createId("artifact"),
      runId,
      type: "report_html",
      name: fileName,
      path: relativePath,
      url: artifactUrl(relativePath),
      mimeType: "text/html",
      sizeBytes: written.sizeBytes,
      createdAt: nowIso()
    };
    this.storage.addArtifact(artifact);
    this.storage.updateRunReport(runId, relativePath);
  }

  private async writeScreenshotArtifact(runId: string, stepResultId: string | undefined, fileName: string, png: Buffer): Promise<ScreenshotCapture> {
    const relativePath = runArtifactPath(runId, "screenshots", fileName);
    const written = await this.storage.writeArtifact(relativePath, png);
    const artifact: ArtifactRef = {
      id: createId("artifact"),
      runId,
      stepResultId,
      type: "screenshot",
      name: fileName,
      path: relativePath,
      url: artifactUrl(relativePath),
      mimeType: "image/png",
      sizeBytes: written.sizeBytes,
      createdAt: nowIso()
    };
    this.storage.addArtifact(artifact);
    return { artifact, png };
  }

  private async writeTypedArtifact(
    runId: string,
    kind: "metrics" | "reports" | "logs",
    fileName: string,
    content: Buffer | string,
    type: ArtifactRef["type"],
    mimeType: string,
    artifactId = createId("artifact")
  ): Promise<ArtifactRef> {
    const relativePath = runArtifactPath(runId, kind, fileName);
    const written = await this.storage.writeArtifact(relativePath, content);
    const artifact: ArtifactRef = {
      id: artifactId,
      runId,
      type,
      name: fileName,
      path: relativePath,
      url: artifactUrl(relativePath),
      mimeType,
      sizeBytes: written.sizeBytes,
      createdAt: nowIso()
    };
    this.storage.addArtifact(artifact);
    return artifact;
  }
}

function cpuSamplesToCsv(samples: AndroidProcessMetricSample[]): string {
  return toCsv(
    ["sampledAt", "pid", "processName", "cpuPercent", "raw"],
    samples.map((sample) => [sample.sampledAt, sample.pid, sample.processName, sample.cpuPercent, sample.raw ? JSON.stringify(sample.raw) : ""])
  );
}

function memorySamplesToCsv(samples: AndroidProcessMetricSample[]): string {
  return toCsv(
    ["sampledAt", "pid", "processName", "pssKb", "rssKb", "raw"],
    samples.map((sample) => [sample.sampledAt, sample.pid, sample.processName, sample.pssKb, sample.rssKb, sample.raw ? JSON.stringify(sample.raw) : ""])
  );
}

function lifecycleEventsToCsv(events: AndroidProcessLifecycleEvent[]): string {
  return toCsv(
    ["occurredAt", "type", "pid", "previousPid", "processName"],
    events.map((event) => [event.occurredAt, event.type, event.pid, event.previousPid, event.processName])
  );
}

function toCsv(headers: string[], rows: Array<Array<string | number | undefined>>): string {
  return `${headers.join(",")}\n${rows.map((row) => row.map(csvCell).join(",")).join("\n")}${rows.length ? "\n" : ""}`;
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
