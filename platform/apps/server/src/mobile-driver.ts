import {
  AndroidDriver,
  type AndroidAppMonitorCallbacks,
  type AndroidAppMonitorSession,
  type AndroidAppMonitorSessionOptions,
  type VideoRecording
} from "@mobile-automation/android-driver";
import { IosDriver, type IosVideoRecording } from "@mobile-automation/ios-driver";
import type {
  AndroidAppMonitorConfig,
  AndroidAppMonitorSummary,
  DeviceActionRequest,
  DeviceActionResult,
  DeviceEvent,
  DeviceInfo,
  InstalledAppInfo,
  MetricSample,
  SemanticDeviceActionRequest,
  ToolStatus
} from "@mobile-automation/shared";

export type MobileVideoRecording = VideoRecording | IosVideoRecording;
export type MobileAppMonitorSession = Pick<AndroidAppMonitorSession, "start" | "stop" | "getSummary">;

export type ObservedDeviceEvent = Pick<DeviceEvent, "type" | "severity" | "summary"> & {
  occurredAt?: string;
  detail?: string;
};

export type DeviceEventWatcher = {
  stop(): Promise<void>;
};

export interface AutomationDeviceDriver {
  getToolStatus(): Promise<ToolStatus[]>;
  listDevices(): Promise<DeviceInfo[]>;
  getDeviceInfo(serial: string): Promise<DeviceInfo>;
  getInstalledAppInfo?(serial: string, appIdentifier: string): Promise<InstalledAppInfo>;
  screenshot(serial: string): Promise<Buffer>;
  getForegroundApp?(serial: string): Promise<{ packageName?: string; activityName?: string; componentName?: string }>;
  dumpUiHierarchy?(serial: string): Promise<string>;
  performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void>;
  performSemanticAction?(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void>;
  clearAppData(serial: string, packageName: string): Promise<void>;
  collectLogs(serial: string, lines?: number): Promise<string>;
  watchDeviceEvents?(
    serial: string,
    onEvent: (event: ObservedDeviceEvent) => void,
    options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher>;
  samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample>;
  startAppMonitor?(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    writeTextArtifact: AndroidAppMonitorSessionOptions["writeTextArtifact"],
    callbacks?: AndroidAppMonitorCallbacks
  ): Promise<MobileAppMonitorSession>;
  startVideoRecording(serial: string, runId: string, localDir: string): Promise<MobileVideoRecording>;
  stopVideoRecording(recording: MobileVideoRecording, keep: boolean): Promise<string | undefined>;
}

export class MobileDriver implements AutomationDeviceDriver {
  private readonly platformCache = new Map<string, DeviceInfo["platform"]>();

  constructor(private readonly android = new AndroidDriver(), private readonly ios = new IosDriver()) {}

  async getToolStatus(): Promise<ToolStatus[]> {
    const [androidTools, iosTools] = await Promise.all([this.android.getToolStatus(), this.ios.getToolStatus()]);
    return [...androidTools, ...iosTools];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [androidDevices, iosDevices] = await Promise.all([this.android.listDevices(), this.ios.listDevices()]);
    const devices = [...androidDevices, ...iosDevices];
    for (const device of devices) {
      this.platformCache.set(device.serial, device.platform);
    }
    return devices;
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.getDeviceInfo(serial) : this.android.getDeviceInfo(serial);
  }

  async getInstalledAppInfo(serial: string, appIdentifier: string): Promise<InstalledAppInfo> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      throw new Error("iOS installed app version lookup is not supported yet");
    }
    return this.android.getInstalledAppInfo(serial, appIdentifier);
  }

  async screenshot(serial: string): Promise<Buffer> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.screenshot(serial) : this.android.screenshot(serial);
  }

  async getForegroundApp(serial: string): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      return {};
    }
    return this.android.getForegroundApp(serial);
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      throw new Error("iOS UI hierarchy locator is not supported yet");
    }
    return this.android.dumpUiHierarchy(serial);
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.performAction(serial, action) : this.android.performAction(serial, action);
  }

  async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      throw new Error("iOS semantic action backend is not supported yet");
    }
    return this.android.performSemanticAction(serial, action);
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      throw new Error("clear_data_and_launch is not supported for iOS yet");
    }
    return this.android.clearAppData(serial, packageName);
  }

  async collectLogs(serial: string, lines?: number): Promise<string> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.collectLogs(serial, lines) : this.android.collectLogs(serial, lines);
  }

  async watchDeviceEvents(
    serial: string,
    onEvent: (event: ObservedDeviceEvent) => void,
    options?: { since?: Date; packageName?: string }
  ): Promise<DeviceEventWatcher> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      return {
        stop: async () => undefined
      };
    }
    return this.android.watchDeviceEvents(serial, onEvent, options);
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.samplePerformance(serial, runId, stepResultId) : this.android.samplePerformance(serial, runId, stepResultId);
  }

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    writeTextArtifact: AndroidAppMonitorSessionOptions["writeTextArtifact"],
    callbacks: AndroidAppMonitorCallbacks = {}
  ): Promise<MobileAppMonitorSession> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "ios") {
      return createIosNoopAppMonitorSession(config);
    }
    return this.android.startAppMonitor(serial, runId, config, writeTextArtifact, callbacks);
  }

  async startVideoRecording(serial: string, runId: string, localDir: string): Promise<MobileVideoRecording> {
    const platform = await this.resolvePlatform(serial);
    return platform === "ios" ? this.ios.startVideoRecording(serial, runId, localDir) : this.android.startVideoRecording(serial, runId, localDir);
  }

  async stopVideoRecording(recording: MobileVideoRecording, keep: boolean): Promise<string | undefined> {
    return "kind" in recording ? this.android.stopVideoRecording(recording, keep) : this.ios.stopVideoRecording(recording, keep);
  }

  listScrcpyControlSessions() {
    return this.android.listScrcpyControlSessions();
  }

  startScrcpyControl(serial: string) {
    return this.android.startScrcpyControl(serial);
  }

  stopScrcpyControl(serial: string) {
    return this.android.stopScrcpyControl(serial);
  }

  private async resolvePlatform(serial: string): Promise<DeviceInfo["platform"]> {
    const cached = this.platformCache.get(serial);
    if (cached) {
      return cached;
    }

    const devices = await this.listDevices();
    const device = devices.find((item) => item.serial === serial);
    if (!device) {
      throw new Error(`Device not found: ${serial}`);
    }
    return device.platform;
  }
}

function createIosNoopAppMonitorSession(config: AndroidAppMonitorConfig): MobileAppMonitorSession {
  const summary: AndroidAppMonitorSummary = {
    packageName: config.packageName,
    startedAt: new Date().toISOString(),
    processes: [],
    sampleCounts: {
      cpu: 0,
      memory: 0,
      lifecycle: 0
    },
    incidents: [],
    artifacts: {}
  };
  let stopped = false;

  return {
    start: async () => undefined,
    stop: async () => {
      if (!stopped) {
        summary.endedAt = new Date().toISOString();
        stopped = true;
      }
      return cloneSummary(summary);
    },
    getSummary: () => cloneSummary(summary)
  };
}

function cloneSummary(summary: AndroidAppMonitorSummary): AndroidAppMonitorSummary {
  return {
    ...summary,
    processes: [...summary.processes],
    sampleCounts: { ...summary.sampleCounts },
    incidents: [...summary.incidents],
    artifacts: { ...summary.artifacts }
  };
}
