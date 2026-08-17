import {
  createId,
  nowIso,
  extractAndroidCrashLog,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type DeviceEvent
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver, MobileAppMonitorSession } from "./device-driver.js";
import { RunArtifactService } from "./run-artifact-service.js";

type AndroidAppMonitorRunSupportOptions = {
  runId: string;
  deviceSerial: string;
  config?: AndroidAppMonitorConfig;
  stopOnFailure: boolean;
  driver: Pick<AutomationDeviceDriver, "collectLogs" | "startAppMonitor">;
  artifactService: RunArtifactService;
  addDeviceEvent: (event: DeviceEvent) => void;
  stopRun: () => void;
  markRuntimeFailure: () => void;
  getActiveStepResultId?: () => string | undefined;
  normalizeIncident?: (incident: AndroidAppMonitorIncident) => AndroidAppMonitorIncident | undefined;
  summaryPrefix?: string;
};

export class AndroidAppMonitorRunSupport {
  private session?: MobileAppMonitorSession;
  private started = false;
  private readonly cpuSamples: AndroidProcessMetricSample[] = [];
  private readonly memorySamples: AndroidProcessMetricSample[] = [];
  private readonly lifecycleEvents: AndroidProcessLifecycleEvent[] = [];

  constructor(private readonly options: AndroidAppMonitorRunSupportOptions) {}

  isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    const config = this.options.config;
    if (!config?.enabled) {
      return;
    }
    if (!this.options.driver.startAppMonitor) {
      await this.recordSupportFailure("Android app monitor unavailable", "Driver does not support startAppMonitor.");
      return;
    }
    try {
      this.session = await this.options.driver.startAppMonitor(
        this.options.deviceSerial,
        this.options.runId,
        config,
        (runId, fileName, content) => this.options.artifactService.writeLog(runId, fileName, content),
        {
          onSample: (sample, kind) => {
            if (kind === "cpu") {
              this.cpuSamples.push(sample);
            } else {
              this.memorySamples.push(sample);
            }
          },
          onLifecycleEvent: (event) => {
            this.lifecycleEvents.push(event);
          },
          onIncident: (incident) => this.recordIncident(incident)
        }
      );
      await this.session.start();
      this.started = true;
    } catch (error) {
      await this.recordSupportFailure("Android app monitor failed to start", errorToString(error));
    }
  }

  async stopAndWriteArtifacts(): Promise<void> {
    if (!this.options.config?.enabled || !this.started || !this.session) {
      return;
    }
    let summary: AndroidAppMonitorSummary | undefined;
    try {
      summary = await this.session.stop();
    } catch (error) {
      await this.recordSupportFailure("Android app monitor failed to stop", errorToString(error));
      try {
        summary = this.session.getSummary();
      } catch {
        summary = undefined;
      }
    }
    if (!summary) {
      return;
    }

    try {
      const normalizedSummary = this.normalizeSummary(summary);
      const enrichedSummary = await this.options.artifactService.writeAndroidAppMonitorArtifacts(this.options.runId, normalizedSummary, {
        cpu: this.cpuSamples,
        memory: this.memorySamples,
        lifecycle: this.lifecycleEvents
      });
      this.recordSummary(enrichedSummary);
    } catch (error) {
      await this.recordSupportFailure("Android app monitor artifacts failed to write", errorToString(error));
    }
  }

  private async recordIncident(incident: AndroidAppMonitorIncident): Promise<void> {
    const normalizedIncident = this.normalizeIncident(incident);
    if (!normalizedIncident) {
      return;
    }
    const runtimeFailure = isRuntimeFailureIncident(normalizedIncident);
    if (runtimeFailure) {
      this.options.markRuntimeFailure();
    }
    const evidence = shouldCaptureCrashEvidence(normalizedIncident)
      ? await this.captureRuntimeFailureEvidence(normalizedIncident)
      : { artifactIds: [], detail: normalizedIncident.detail };
    const severity = normalizedIncident.type === "cpu_threshold" || normalizedIncident.type === "memory_threshold"
      ? normalizedIncident.severity === "error" ? "error" : "warning"
      : normalizedIncident.severity;
    this.options.addDeviceEvent({
      id: createId("event"),
      runId: this.options.runId,
      stepResultId: this.options.getActiveStepResultId?.(),
      deviceSerial: this.options.deviceSerial,
      type: mapIncidentType(normalizedIncident.type),
      severity,
      occurredAt: normalizedIncident.occurredAt,
      summary: `${this.options.summaryPrefix ?? "[Android App Monitor]"} ${normalizedIncident.summary}`,
      detail: isCrashLikeIncident(normalizedIncident) && evidence.detail
        ? evidence.detail
        : formatIncidentDetail({ ...normalizedIncident, detail: evidence.detail }),
      artifactIds: [...normalizedIncident.artifactIds, ...evidence.artifactIds]
    });
    if ((runtimeFailure || severity === "error") && this.options.stopOnFailure) {
      this.options.stopRun();
    }
  }

  private async captureRuntimeFailureEvidence(incident: AndroidAppMonitorIncident): Promise<{ artifactIds: string[]; detail?: string }> {
    const artifactIds: string[] = [];
    let detail = incident.detail;
    const stepResultId = this.options.getActiveStepResultId?.();

    try {
      await sleep(300);
      const logs = await this.options.driver.collectLogs(this.options.deviceSerial, 800);
      const normalizedLogs = logs.trim();
      if (normalizedLogs) {
        const crashLog = extractCrashLog(normalizedLogs, incident) ?? incident.detail?.trim();
        if (!crashLog) {
          return { artifactIds, detail };
        }
        const artifact = await this.options.artifactService.writeLog(
          this.options.runId,
          `android-app-monitor-${mapIncidentType(incident.type)}-${Date.now()}.txt`,
          crashLog,
          stepResultId
        );
        artifactIds.push(artifact.id);
        detail = crashLog;
      }
    } catch {
      // The original incident remains useful when a best-effort logcat snapshot is unavailable.
    }

    try {
      const screenshot = await this.options.artifactService.captureRunEventScreenshot(
        this.options.runId,
        stepResultId,
        mapIncidentType(incident.type),
        this.options.deviceSerial
      );
      artifactIds.push(screenshot.id);
    } catch {
      // A crash can make screenshots unavailable; do not discard the incident.
    }

    return { artifactIds, detail };
  }

  private normalizeSummary(summary: AndroidAppMonitorSummary): AndroidAppMonitorSummary {
    if (!this.options.normalizeIncident) {
      return summary;
    }
    const incidents = summary.incidents
      .map((incident) => this.normalizeIncident(incident))
      .filter((incident): incident is AndroidAppMonitorIncident => Boolean(incident));
    return {
      ...summary,
      incidents
    };
  }

  private normalizeIncident(incident: AndroidAppMonitorIncident): AndroidAppMonitorIncident | undefined {
    return this.options.normalizeIncident ? this.options.normalizeIncident(incident) : incident;
  }

  private recordSummary(summary: AndroidAppMonitorSummary): void {
    const artifactIds = [
      summary.artifacts.summaryJsonArtifactId,
      summary.artifacts.cpuCsvArtifactId,
      summary.artifacts.memoryCsvArtifactId,
      summary.artifacts.lifecycleCsvArtifactId
    ].filter((id): id is string => Boolean(id));
    const warningCount = summary.incidents.filter((incident) => incident.severity !== "info").length;
    this.options.addDeviceEvent({
      id: createId("event"),
      runId: this.options.runId,
      deviceSerial: this.options.deviceSerial,
      type: "android_app_monitor",
      severity: warningCount ? "warning" : "info",
      occurredAt: nowIso(),
      summary: `${this.options.summaryPrefix ?? "[Android App Monitor]"} collected ${summary.sampleCounts.cpu} CPU, ${summary.sampleCounts.memory} memory, ${summary.sampleCounts.lifecycle} lifecycle samples`,
      detail: JSON.stringify({
        packageName: summary.packageName,
        sampleCounts: {
          cpu: summary.sampleCounts.cpu,
          memory: summary.sampleCounts.memory,
          lifecycle: summary.sampleCounts.lifecycle
        },
        processes: summary.processes.map((process) => ({
          pid: process.pid,
          processName: process.processName,
          isMainProcess: process.isMainProcess
        })),
        incidents: summary.incidents.length,
        artifacts: summary.artifacts
      }),
      artifactIds
    });
  }

  private async recordSupportFailure(summary: string, detail: string): Promise<void> {
    let artifactId: string | undefined;
    try {
      const artifact = await this.options.artifactService.writeLog(this.options.runId, `android-app-monitor-error-${Date.now()}.txt`, detail);
      artifactId = artifact.id;
    } catch {
      artifactId = undefined;
    }
    this.options.addDeviceEvent({
      id: createId("event"),
      runId: this.options.runId,
      deviceSerial: this.options.deviceSerial,
      type: "android_app_monitor",
      severity: "warning",
      occurredAt: nowIso(),
      summary: `${this.options.summaryPrefix ?? "[Android App Monitor]"} ${summary}`,
      detail,
      artifactIds: artifactId ? [artifactId] : []
    });
  }
}

function mapIncidentType(type: AndroidAppMonitorIncident["type"]): DeviceEvent["type"] {
  switch (type) {
    case "java_crash":
      return "crash";
    case "native_crash":
      return "native_crash";
    case "anr":
      return "anr";
    case "process_death":
      return "process_death";
    case "cpu_threshold":
    case "memory_threshold":
      return "performance_threshold";
    case "watcher_error":
      return "android_app_monitor";
  }
}

function isRuntimeFailureIncident(incident: AndroidAppMonitorIncident): boolean {
  return incident.type === "java_crash"
    || incident.type === "native_crash"
    || incident.type === "anr"
    || (incident.type === "process_death" && incident.severity === "error");
}

function shouldCaptureCrashEvidence(incident: AndroidAppMonitorIncident): boolean {
  return isCrashLikeIncident(incident);
}

function isCrashLikeIncident(incident: AndroidAppMonitorIncident): boolean {
  return incident.type === "java_crash" || incident.type === "native_crash" || incident.type === "anr";
}

function formatIncidentDetail(incident: AndroidAppMonitorIncident): string | undefined {
  if (isCrashLikeIncident(incident) && incident.detail) {
    return incident.detail;
  }
  const metadata = {
    processName: incident.processName,
    pid: incident.pid,
    metadata: incident.metadata
  };
  const metadataText = JSON.stringify(metadata);
  return incident.detail ? `${incident.detail}\n\n${metadataText}` : metadataText;
}

function extractCrashLog(logcat: string, incident: AndroidAppMonitorIncident): string | undefined {
  if (incident.type !== "java_crash" && incident.type !== "native_crash" && incident.type !== "anr") {
    return undefined;
  }
  return extractAndroidCrashLog(logcat, incident.type, incident.processName);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
