import {
  createId,
  nowIso,
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type DeviceEvent
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver, MobileAppMonitorSession } from "./mobile-driver.js";
import { RunArtifactService } from "./run-artifact-service.js";

type AndroidAppMonitorRunSupportOptions = {
  runId: string;
  deviceSerial: string;
  config?: AndroidAppMonitorConfig;
  stopOnFailure: boolean;
  driver: Pick<AutomationDeviceDriver, "startAppMonitor">;
  artifactService: RunArtifactService;
  addDeviceEvent: (event: DeviceEvent) => void;
  stopRun: () => void;
  markRuntimeFailure: () => void;
  getActiveStepResultId?: () => string | undefined;
  summaryPrefix?: string;
};

export class AndroidAppMonitorRunSupport {
  private session?: MobileAppMonitorSession;
  private started = false;
  private readonly cpuSamples: AndroidProcessMetricSample[] = [];
  private readonly memorySamples: AndroidProcessMetricSample[] = [];
  private readonly lifecycleEvents: AndroidProcessLifecycleEvent[] = [];

  constructor(private readonly options: AndroidAppMonitorRunSupportOptions) {}

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
      const enrichedSummary = await this.options.artifactService.writeAndroidAppMonitorArtifacts(this.options.runId, summary, {
        cpu: this.cpuSamples,
        memory: this.memorySamples,
        lifecycle: this.lifecycleEvents
      });
      this.recordSummary(enrichedSummary);
    } catch (error) {
      await this.recordSupportFailure("Android app monitor artifacts failed to write", errorToString(error));
    }
  }

  private recordIncident(incident: AndroidAppMonitorIncident): void {
    const runtimeFailure = isRuntimeFailureIncident(incident.type);
    if (runtimeFailure) {
      this.options.markRuntimeFailure();
    }
    const severity = incident.type === "cpu_threshold" || incident.type === "memory_threshold"
      ? incident.severity === "error" ? "error" : "warning"
      : incident.severity;
    this.options.addDeviceEvent({
      id: createId("event"),
      runId: this.options.runId,
      stepResultId: this.options.getActiveStepResultId?.(),
      deviceSerial: this.options.deviceSerial,
      type: mapIncidentType(incident.type),
      severity,
      occurredAt: incident.occurredAt,
      summary: `${this.options.summaryPrefix ?? "[Android App Monitor]"} ${incident.summary}`,
      detail: formatIncidentDetail(incident),
      artifactIds: [...incident.artifactIds]
    });
    if ((runtimeFailure || severity === "error") && this.options.stopOnFailure) {
      this.options.stopRun();
    }
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

function isRuntimeFailureIncident(type: AndroidAppMonitorIncident["type"]): boolean {
  return type === "java_crash" || type === "native_crash" || type === "anr" || type === "process_death";
}

function formatIncidentDetail(incident: AndroidAppMonitorIncident): string | undefined {
  const metadata = {
    processName: incident.processName,
    pid: incident.pid,
    metadata: incident.metadata
  };
  const metadataText = JSON.stringify(metadata);
  return incident.detail ? `${incident.detail}\n\n${metadataText}` : metadataText;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
