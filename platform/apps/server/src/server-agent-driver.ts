import type {
  AndroidAppMonitorConfig,
  AndroidAppMonitorIncident,
  AndroidAppMonitorSummary,
  AndroidProcessLifecycleEvent,
  AndroidProcessMetricSample,
  AgentCommandResultEnvelope,
  AgentDeviceInfo,
  DeviceActionRequest,
  DeviceActionResult,
  DeviceInfo,
  InstalledAppInfo,
  MetricSample,
  SemanticDeviceActionRequest,
  ToolStatus
} from "@mobile-automation/shared";
import { createId as createSharedId } from "@mobile-automation/shared";
import type {
  AutomationDeviceDriver,
  DeviceEventWatcher,
  MobileAppMonitorSession,
  MobileVideoRecording,
  ObservedDeviceEvent
} from "./device-driver.js";
import type { ServerAgentRegistry } from "./server-agent-registry.js";

export class ServerAgentDeviceDriver implements AutomationDeviceDriver {
  private readonly agentScreenshotRequests = new Map<string, Promise<Buffer>>();

  static agentOnly(agents: ServerAgentRegistry): ServerAgentDeviceDriver {
    return new ServerAgentDeviceDriver(undefined, agents);
  }

  constructor(
    private readonly local: AutomationDeviceDriver | undefined,
    private readonly agents: ServerAgentRegistry
  ) {}

  async getToolStatus(): Promise<ToolStatus[]> {
    const localTools = this.local ? await this.local.getToolStatus() : [];
    const agentTools = this.agents.listAgents().flatMap((agent) =>
      agent.status === "online" ? agent.toolStatus.map((tool) => ({
        ...tool,
        name: `agent:${agent.agentId}:${tool.name}`,
        available: tool.available
      })) : []
    );
    return [...localTools, ...agentTools];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [localDevices, agentDevices] = await Promise.all([
      this.local ? this.local.listDevices() : Promise.resolve([]),
      Promise.resolve(this.agents.listVisibleDevices())
    ]);
    return mergeLocalAndAgentDevices(localDevices, agentDevices);
  }

  listVisibleAgentDevices(options: { sessionId?: string; includeOffline?: boolean } = {}): AgentDeviceInfo[] {
    return this.agents.listVisibleDevices(options);
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    if (!this.isAgentDevice(serial)) {
      return this.localDriver().getDeviceInfo(serial);
    }
    const result = await this.agents.sendCommand(serial, "getDeviceInfo");
    const snapshot = this.agents.deviceInfoForKey(serial) ?? missingAgentDevice(serial);
    return mergeReportedDeviceInfo(snapshot, result);
  }

  async getInstalledAppInfo(serial: string, appIdentifier: string): Promise<InstalledAppInfo> {
    if (this.isAgentDevice(serial)) {
      throw new Error("Agent installed app lookup is not enabled in this MVP");
    }
    const local = this.localDriver();
    if (!local.getInstalledAppInfo) {
      throw new Error("Installed app version lookup is not supported");
    }
    return local.getInstalledAppInfo(serial, appIdentifier);
  }

  async screenshot(serial: string): Promise<Buffer> {
    if (!this.isAgentDevice(serial)) {
      return this.localDriver().screenshot(serial);
    }
    const inFlight = this.agentScreenshotRequests.get(serial);
    if (inFlight) {
      return inFlight;
    }
    const request = this.requestAgentScreenshot(serial)
      .finally(() => {
        this.agentScreenshotRequests.delete(serial);
      });
    this.agentScreenshotRequests.set(serial, request);
    return request;
  }

  private async requestAgentScreenshot(serial: string): Promise<Buffer> {
    const result = await this.agents.sendCommand(serial, "screenshot");
    const dataBase64 = result.dataBase64 ?? stringFromRecord(recordValue(result.result), "dataBase64")
      ?? stringFromRecord(recordValue(result.result), "imageBase64")
      ?? stringFromRecord(recordValue(result.result), "pngBase64");
    if (!dataBase64) {
      throw new Error("Agent screenshot response did not include dataBase64");
    }
    return Buffer.from(dataBase64, "base64");
  }

  async getForegroundApp(serial: string): Promise<{ packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string }> {
    if (this.isAgentDevice(serial)) {
      const result = await this.agents.sendCommand(serial, "getForegroundApp");
      return foregroundFromResult(result.result);
    }
    return this.localDriver().getForegroundApp?.(serial) ?? {};
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    if (!this.isAgentDevice(serial)) {
      const local = this.localDriver();
      if (!local.dumpUiHierarchy) {
        throw new Error("UI hierarchy locator is not supported");
      }
      return local.dumpUiHierarchy(serial);
    }
    const result = await this.agents.sendCommand(serial, "dumpUiHierarchy");
    const payload = recordValue(result.result);
    const xml = typeof result.result === "string"
      ? result.result
      : stringFromRecord(payload, "uiHierarchyXml") ?? stringFromRecord(payload, "xml");
    if (!xml) {
      throw new Error("Agent UI hierarchy response did not include uiHierarchyXml");
    }
    return xml;
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void> {
    if (this.isAgentDevice(serial)) {
      const result = await this.agents.sendCommand(serial, "performAction", { action });
      return deviceActionResultFromResult(result.result);
    }
    return this.localDriver().performAction(serial, action);
  }

  async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void> {
    if (this.isAgentDevice(serial)) {
      const result = await this.agents.sendCommand(serial, "performSemanticAction", { action });
      return deviceActionResultFromResult(result.result);
    }
    const local = this.localDriver();
    if (!local.performSemanticAction) {
      throw new Error("Semantic actions are not supported");
    }
    return local.performSemanticAction(serial, action);
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    if (this.isAgentDevice(serial)) {
      await this.agents.sendCommand(serial, "clearAppData", { packageName });
      return;
    }
    const local = this.localDriver();
    if (!local.clearAppData) {
      throw new Error("clearAppData is not supported");
    }
    return local.clearAppData(serial, packageName);
  }

  async collectLogs(serial: string, lines?: number): Promise<string> {
    if (this.isAgentDevice(serial)) {
      const result = await this.agents.sendCommand(serial, "collectLogs", { ...(lines ? { lines } : {}) });
      return logsFromResult(result.result);
    }
    return this.localDriver().collectLogs(serial, lines);
  }

  async watchDeviceEvents(
    serial: string,
    onEvent: (event: ObservedDeviceEvent) => void,
    options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher> {
    if (this.isAgentDevice(serial)) {
      const unsubscribe = this.agents.subscribeAppMonitorIncidents({ deviceKey: serial }, (envelope) => {
        const event = observedEventFromIncident(envelope.incident);
        if (!event || !isObservedEventInWindow(event, options?.since) || !matchesPackageFilter(envelope.incident, options?.packageName)) {
          return;
        }
        onEvent(event);
      });
      return { stop: async () => unsubscribe() };
    }
    return this.localDriver().watchDeviceEvents?.(serial, onEvent, options) ?? { stop: async () => undefined };
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    if (this.isAgentDevice(serial)) {
      const result = await this.agents.sendCommand(serial, "samplePerformance", {
        runId,
        ...(stepResultId ? { stepResultId } : {})
      });
      return metricFromResult(result.result);
    }
    return this.localDriver().samplePerformance(serial, runId, stepResultId);
  }

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    writeTextArtifact: Parameters<NonNullable<AutomationDeviceDriver["startAppMonitor"]>>[3],
    callbacks?: Parameters<NonNullable<AutomationDeviceDriver["startAppMonitor"]>>[4]
  ): Promise<MobileAppMonitorSession> {
    if (this.isAgentDevice(serial)) {
      const monitorId = createSharedId("agent_monitor");
      const session = new AgentProxyAppMonitorSession({
        agents: this.agents,
        deviceKey: serial,
        runId,
        monitorId,
        config,
        callbacks
      });
      await session.startRemote();
      return session;
    }
    const local = this.localDriver();
    if (!local.startAppMonitor) {
      throw new Error("App monitor is not supported");
    }
    return local.startAppMonitor(serial, runId, config, writeTextArtifact, callbacks);
  }

  async startVideoRecording(serial: string, runId: string, localDir: string): Promise<MobileVideoRecording> {
    if (this.isAgentDevice(serial)) {
      throw new Error("Agent video recording is not enabled in this MVP");
    }
    return this.localDriver().startVideoRecording(serial, runId, localDir);
  }

  async stopVideoRecording(recording: MobileVideoRecording, keep: boolean): Promise<string | undefined> {
    return this.localDriver().stopVideoRecording(recording, keep);
  }

  private isAgentDevice(serial: string): boolean {
    return this.agents.hasDevice(serial);
  }

  private localDriver(): AutomationDeviceDriver {
    if (!this.local) {
      throw new Error("Server local device access is disabled; use a registered device agent");
    }
    return this.local;
  }
}

type AgentProxyAppMonitorSessionOptions = {
  agents: ServerAgentRegistry;
  deviceKey: string;
  runId: string;
  monitorId: string;
  config: AndroidAppMonitorConfig;
  callbacks?: Parameters<NonNullable<AutomationDeviceDriver["startAppMonitor"]>>[4];
};

type AgentAppMonitorSamples = {
  cpu: AndroidProcessMetricSample[];
  memory: AndroidProcessMetricSample[];
  lifecycle: AndroidProcessLifecycleEvent[];
};

class AgentProxyAppMonitorSession implements MobileAppMonitorSession {
  private summary: AndroidAppMonitorSummary;
  private readonly seenIncidentIds = new Set<string>();
  private unsubscribe?: () => void;
  private stopPromise?: Promise<AndroidAppMonitorSummary>;

  constructor(private readonly options: AgentProxyAppMonitorSessionOptions) {
    this.summary = emptyAppMonitorSummary(options.config.packageName);
  }

  async startRemote(): Promise<void> {
    this.unsubscribe = this.options.agents.subscribeAppMonitorIncidents({ monitorId: this.options.monitorId }, (envelope) => {
      void this.recordIncident(envelope.incident);
    });
    const result = await this.options.agents.sendCommand(this.options.deviceKey, "startAppMonitor", {
      runId: this.options.runId,
      monitorId: this.options.monitorId,
      config: this.options.config
    });
    this.summary = appMonitorSummaryFromResult(result.result) ?? this.summary;
  }

  async start(): Promise<void> {
    return undefined;
  }

  async stop(): Promise<AndroidAppMonitorSummary> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.stopRemote();
    return this.stopPromise;
  }

  getSummary(): AndroidAppMonitorSummary {
    return cloneAppMonitorSummary(this.summary);
  }

  private async stopRemote(): Promise<AndroidAppMonitorSummary> {
    try {
      const result = await this.options.agents.sendCommand(this.options.deviceKey, "stopAppMonitor", {
        monitorId: this.options.monitorId
      });
      const stopResult = appMonitorStopResultFromResult(result.result);
      await this.replaySamples(stopResult.samples);
      await this.replayMissingIncidents(stopResult.summary.incidents);
      this.summary = stopResult.summary;
      return this.getSummary();
    } finally {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    }
  }

  private async recordIncident(incident: AndroidAppMonitorIncident): Promise<void> {
    if (this.seenIncidentIds.has(incident.id)) {
      return;
    }
    this.seenIncidentIds.add(incident.id);
    this.summary = {
      ...this.summary,
      incidents: [...this.summary.incidents, incident]
    };
    await this.options.callbacks?.onIncident?.(incident);
  }

  private async replayMissingIncidents(incidents: AndroidAppMonitorIncident[]): Promise<void> {
    for (const incident of incidents) {
      await this.recordIncident(incident);
    }
  }

  private async replaySamples(samples: AgentAppMonitorSamples): Promise<void> {
    for (const sample of samples.cpu) {
      await this.options.callbacks?.onSample?.(sample, "cpu");
    }
    for (const sample of samples.memory) {
      await this.options.callbacks?.onSample?.(sample, "memory");
    }
    for (const event of samples.lifecycle) {
      await this.options.callbacks?.onLifecycleEvent?.(event);
    }
  }
}

export function mergeLocalAndAgentDevices(localDevices: DeviceInfo[], agentDevices: AgentDeviceInfo[]): DeviceInfo[] {
  const mirroredLocalDeviceKeys = new Set(agentDevices.map((device) => localDeviceMirrorKey(device.platform, device.agent.serial)));
  return [
    ...localDevices.filter((device) => !mirroredLocalDeviceKeys.has(localDeviceMirrorKey(device.platform, device.serial))),
    ...agentDevices
  ];
}

function localDeviceMirrorKey(platform: DeviceInfo["platform"], serial: string): string {
  return `${platform}:${serial}`;
}

function mergeReportedDeviceInfo(snapshot: AgentDeviceInfo, result: AgentCommandResultEnvelope): DeviceInfo {
  const payload = recordValue(result.result);
  const device = recordValue(payload?.device) ?? payload;
  if (!device) {
    return snapshot;
  }
  return {
    ...snapshot,
    ...(stringFromRecord(device, "name") ? { name: stringFromRecord(device, "name") } : {}),
    ...(stringFromRecord(device, "model") ? { model: stringFromRecord(device, "model") } : {}),
    ...(stringFromRecord(device, "manufacturer") ? { manufacturer: stringFromRecord(device, "manufacturer") } : {}),
    ...(stringFromRecord(device, "osVersion") ? { osVersion: stringFromRecord(device, "osVersion") } : {}),
    ...(resolutionFromRecord(device) ? { resolution: resolutionFromRecord(device) } : {}),
    ...(orientationFromRecord(device) ? { orientation: orientationFromRecord(device) } : {})
  };
}

function foregroundFromResult(result: unknown): { packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string } {
  const payload = recordValue(result);
  if (!payload) {
    return {};
  }
  return {
    ...(stringFromRecord(payload, "packageName") ? { packageName: stringFromRecord(payload, "packageName") } : {}),
    ...(stringFromRecord(payload, "bundleId") ? { bundleId: stringFromRecord(payload, "bundleId") } : {}),
    ...(stringFromRecord(payload, "activityName") ? { activityName: stringFromRecord(payload, "activityName") } : {}),
    ...(stringFromRecord(payload, "abilityName") ? { abilityName: stringFromRecord(payload, "abilityName") } : {}),
    ...(stringFromRecord(payload, "componentName") ? { componentName: stringFromRecord(payload, "componentName") } : {})
  };
}

function deviceActionResultFromResult(result: unknown): DeviceActionResult | undefined {
  const payload = recordValue(result);
  if (!payload) {
    return undefined;
  }
  const channel = payload?.driverChannel;
  if (channel !== "adb_input" && channel !== "uiautomator2" && channel !== "appium" && channel !== "scrcpy_control" && channel !== "hdc_input" && channel !== "mock") {
    return undefined;
  }
  const details = recordValue(payload.details);
  return {
    driverChannel: channel,
    ...(typeof payload.fallbackReason === "string" ? { fallbackReason: payload.fallbackReason } : {}),
    ...(details ? { details } : {})
  };
}

function logsFromResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  return stringFromRecord(recordValue(result), "logs") ?? "";
}

function metricFromResult(result: unknown): MetricSample {
  const metric = recordValue(recordValue(result)?.metric) ?? recordValue(result);
  if (!metric) {
    throw new Error("Agent metric response did not include metric");
  }
  return {
    id: stringFromRecord(metric, "id") ?? "agent_metric",
    runId: stringFromRecord(metric, "runId") ?? "",
    ...(stringFromRecord(metric, "stepResultId") ? { stepResultId: stringFromRecord(metric, "stepResultId") } : {}),
    deviceSerial: stringFromRecord(metric, "deviceSerial") ?? "",
    sampledAt: stringFromRecord(metric, "sampledAt") ?? new Date().toISOString(),
    ...(numberFromRecord(metric, "cpuPercent") !== undefined ? { cpuPercent: numberFromRecord(metric, "cpuPercent") } : {}),
    ...(numberFromRecord(metric, "memoryUsedKb") !== undefined ? { memoryUsedKb: numberFromRecord(metric, "memoryUsedKb") } : {}),
    ...(numberFromRecord(metric, "memoryTotalKb") !== undefined ? { memoryTotalKb: numberFromRecord(metric, "memoryTotalKb") } : {}),
    ...(numberFromRecord(metric, "batteryLevel") !== undefined ? { batteryLevel: numberFromRecord(metric, "batteryLevel") } : {}),
    ...(numberFromRecord(metric, "batteryTemperatureC") !== undefined ? { batteryTemperatureC: numberFromRecord(metric, "batteryTemperatureC") } : {}),
    ...(recordValue(metric.raw) ? { raw: recordValue(metric.raw) } : {})
  };
}

function observedEventFromIncident(incident: AndroidAppMonitorIncident): ObservedDeviceEvent | undefined {
  const type = observedEventTypeFromIncident(incident.type);
  if (!type) {
    return undefined;
  }
  return {
    type,
    severity: incident.severity,
    occurredAt: incident.occurredAt,
    summary: incident.summary,
    ...(incident.detail ? { detail: incident.detail } : {}),
    ...(incident.processName ? { processName: incident.processName } : {}),
    ...(incident.pid !== undefined ? { pid: incident.pid } : {})
  };
}

function observedEventTypeFromIncident(type: AndroidAppMonitorIncident["type"]): ObservedDeviceEvent["type"] | undefined {
  switch (type) {
    case "java_crash":
      return "crash";
    case "native_crash":
    case "anr":
    case "process_death":
      return type;
    case "watcher_error":
      return "command_failed";
    case "cpu_threshold":
    case "memory_threshold":
      return undefined;
  }
}

function isObservedEventInWindow(event: ObservedDeviceEvent, since: Date | undefined): boolean {
  if (!since || !event.occurredAt) {
    return true;
  }
  const occurredAtMs = Date.parse(event.occurredAt);
  return Number.isFinite(occurredAtMs) && occurredAtMs >= since.getTime();
}

function matchesPackageFilter(incident: AndroidAppMonitorIncident, packageName: string | undefined): boolean {
  if (!packageName || !incident.processName) {
    return true;
  }
  return incident.processName === packageName || incident.processName.startsWith(`${packageName}:`);
}

function emptyAppMonitorSummary(packageName: string): AndroidAppMonitorSummary {
  return {
    packageName,
    startedAt: new Date().toISOString(),
    processes: [],
    sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 },
    incidents: [],
    artifacts: {}
  };
}

function appMonitorStopResultFromResult(result: unknown): { summary: AndroidAppMonitorSummary; samples: AgentAppMonitorSamples } {
  const payload = recordValue(result);
  const summary = appMonitorSummaryFromResult(result);
  if (!summary) {
    throw new Error("Agent app monitor response did not include summary");
  }
  return {
    summary,
    samples: appMonitorSamplesFromRecord(recordValue(payload?.samples))
  };
}

function appMonitorSummaryFromResult(result: unknown): AndroidAppMonitorSummary | undefined {
  const payload = recordValue(result);
  const summary = recordValue(payload?.summary) ?? payload;
  if (!summary) {
    return undefined;
  }
  const packageName = stringFromRecord(summary, "packageName");
  const startedAt = stringFromRecord(summary, "startedAt");
  if (!packageName || !startedAt) {
    return undefined;
  }
  const sampleCounts = recordValue(summary.sampleCounts);
  const artifacts = recordValue(summary.artifacts);
  return {
    packageName,
    startedAt,
    ...(stringFromRecord(summary, "endedAt") ? { endedAt: stringFromRecord(summary, "endedAt") } : {}),
    processes: Array.isArray(summary.processes) ? summary.processes.flatMap(androidProcessInfoFromValue) : [],
    sampleCounts: {
      cpu: numberFromRecord(sampleCounts ?? {}, "cpu") ?? 0,
      memory: numberFromRecord(sampleCounts ?? {}, "memory") ?? 0,
      lifecycle: numberFromRecord(sampleCounts ?? {}, "lifecycle") ?? 0
    },
    incidents: Array.isArray(summary.incidents) ? summary.incidents.flatMap(androidAppMonitorIncidentFromValue) : [],
    artifacts: {
      ...(stringFromRecord(artifacts, "cpuCsvArtifactId") ? { cpuCsvArtifactId: stringFromRecord(artifacts, "cpuCsvArtifactId") } : {}),
      ...(stringFromRecord(artifacts, "memoryCsvArtifactId") ? { memoryCsvArtifactId: stringFromRecord(artifacts, "memoryCsvArtifactId") } : {}),
      ...(stringFromRecord(artifacts, "lifecycleCsvArtifactId") ? { lifecycleCsvArtifactId: stringFromRecord(artifacts, "lifecycleCsvArtifactId") } : {}),
      ...(stringFromRecord(artifacts, "summaryJsonArtifactId") ? { summaryJsonArtifactId: stringFromRecord(artifacts, "summaryJsonArtifactId") } : {})
    }
  };
}

function cloneAppMonitorSummary(summary: AndroidAppMonitorSummary): AndroidAppMonitorSummary {
  return {
    ...summary,
    processes: summary.processes.map((process) => ({ ...process })),
    sampleCounts: { ...summary.sampleCounts },
    incidents: summary.incidents.map((incident) => ({
      ...incident,
      artifactIds: [...incident.artifactIds],
      ...(incident.metadata ? { metadata: { ...incident.metadata } } : {})
    })),
    artifacts: { ...summary.artifacts }
  };
}

function appMonitorSamplesFromRecord(record: Record<string, unknown> | undefined): AgentAppMonitorSamples {
  return {
    cpu: Array.isArray(record?.cpu) ? record.cpu.flatMap(androidProcessMetricSampleFromValue) : [],
    memory: Array.isArray(record?.memory) ? record.memory.flatMap(androidProcessMetricSampleFromValue) : [],
    lifecycle: Array.isArray(record?.lifecycle) ? record.lifecycle.flatMap(androidProcessLifecycleEventFromValue) : []
  };
}

function androidProcessInfoFromValue(value: unknown): AndroidAppMonitorSummary["processes"] {
  const process = recordValue(value);
  const pid = numberFromRecord(process ?? {}, "pid");
  const processName = stringFromRecord(process, "processName");
  const packageName = stringFromRecord(process, "packageName");
  const discoveredAt = stringFromRecord(process, "discoveredAt");
  if (pid === undefined || !processName || !packageName || !discoveredAt) {
    return [];
  }
  return [{
    pid,
    processName,
    packageName,
    isMainProcess: process?.isMainProcess === true,
    discoveredAt
  }];
}

function androidProcessMetricSampleFromValue(value: unknown): AndroidProcessMetricSample[] {
  const sample = recordValue(value);
  if (!sample) {
    return [];
  }
  const sampledAt = stringFromRecord(sample, "sampledAt");
  const pid = numberFromRecord(sample, "pid");
  const processName = stringFromRecord(sample, "processName");
  if (!sampledAt || pid === undefined || !processName) {
    return [];
  }
  return [{
    sampledAt,
    pid,
    processName,
    ...(numberFromRecord(sample, "cpuPercent") !== undefined ? { cpuPercent: numberFromRecord(sample, "cpuPercent") } : {}),
    ...(numberFromRecord(sample, "pssKb") !== undefined ? { pssKb: numberFromRecord(sample, "pssKb") } : {}),
    ...(numberFromRecord(sample, "rssKb") !== undefined ? { rssKb: numberFromRecord(sample, "rssKb") } : {}),
    ...(recordValue(sample?.raw) ? { raw: recordValue(sample?.raw) } : {})
  }];
}

function androidProcessLifecycleEventFromValue(value: unknown): AndroidProcessLifecycleEvent[] {
  const event = recordValue(value);
  if (!event) {
    return [];
  }
  const occurredAt = stringFromRecord(event, "occurredAt");
  const type = event?.type;
  const processName = stringFromRecord(event, "processName");
  if (!occurredAt || !processName || (type !== "process_started" && type !== "process_exited" && type !== "process_restarted")) {
    return [];
  }
  return [{
    occurredAt,
    type,
    ...(numberFromRecord(event, "pid") !== undefined ? { pid: numberFromRecord(event, "pid") } : {}),
    ...(numberFromRecord(event, "previousPid") !== undefined ? { previousPid: numberFromRecord(event, "previousPid") } : {}),
    processName
  }];
}

function androidAppMonitorIncidentFromValue(value: unknown): AndroidAppMonitorIncident[] {
  const incident = recordValue(value);
  if (!incident) {
    return [];
  }
  const id = stringFromRecord(incident, "id");
  const type = androidAppMonitorIncidentType(incident?.type);
  const severity = androidAppMonitorIncidentSeverity(incident?.severity);
  const occurredAt = stringFromRecord(incident, "occurredAt");
  const summary = stringFromRecord(incident, "summary");
  if (!id || !type || !severity || !occurredAt || !summary) {
    return [];
  }
  return [{
    id,
    type,
    severity,
    occurredAt,
    ...(stringFromRecord(incident, "processName") ? { processName: stringFromRecord(incident, "processName") } : {}),
    ...(numberFromRecord(incident, "pid") !== undefined ? { pid: numberFromRecord(incident, "pid") } : {}),
    summary,
    ...(stringFromRecord(incident, "detail") ? { detail: stringFromRecord(incident, "detail") } : {}),
    artifactIds: Array.isArray(incident?.artifactIds) ? incident.artifactIds.filter((item): item is string => typeof item === "string") : [],
    ...(recordValue(incident?.metadata) ? { metadata: recordValue(incident?.metadata) } : {})
  }];
}

function androidAppMonitorIncidentType(value: unknown): AndroidAppMonitorIncident["type"] | undefined {
  return value === "cpu_threshold" ||
    value === "memory_threshold" ||
    value === "java_crash" ||
    value === "native_crash" ||
    value === "anr" ||
    value === "process_death" ||
    value === "watcher_error"
    ? value
    : undefined;
}

function androidAppMonitorIncidentSeverity(value: unknown): AndroidAppMonitorIncident["severity"] | undefined {
  return value === "info" || value === "warning" || value === "error" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolutionFromRecord(record: Record<string, unknown>): { width: number; height: number } | undefined {
  const resolution = recordValue(record.resolution);
  const width = Number(resolution?.width);
  const height = Number(resolution?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : undefined;
}

function orientationFromRecord(record: Record<string, unknown>): "portrait" | "landscape" | undefined {
  return record.orientation === "portrait" || record.orientation === "landscape" ? record.orientation : undefined;
}

function missingAgentDevice(serial: string): never {
  throw new Error(`Agent device not found: ${serial}`);
}
