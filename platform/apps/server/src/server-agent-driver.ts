import type {
  AndroidAppMonitorConfig,
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
      return { stop: async () => undefined };
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
      throw new Error("Agent app monitor is not enabled in this MVP");
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
