import type {
  AndroidAppMonitorConfig,
  AndroidAppMonitorIncident,
  AndroidAppMonitorSummary,
  AndroidProcessLifecycleEvent,
  AndroidProcessMetricSample,
  DeviceActionRequest,
  DeviceActionResult,
  DeviceEvent,
  DeviceInfo,
  InstalledAppInfo,
  MetricSample,
  SemanticDeviceActionRequest,
  ToolStatus
} from "@mobile-automation/shared";

export type MobileVideoRecording = {
  id: string;
  serial: string;
  localPath: string;
  startedAt: string;
  kind?: string;
  devicePath?: string;
  process?: unknown;
  processGroupPid?: number;
};

export type MobileAppMonitorSession = {
  start(): Promise<void>;
  stop(): Promise<AndroidAppMonitorSummary>;
  getSummary(): AndroidAppMonitorSummary;
};

export type ObservedDeviceEvent = Pick<DeviceEvent, "type" | "severity" | "summary"> & {
  occurredAt?: string;
  detail?: string;
  processName?: string;
  pid?: number;
};

export type DeviceEventWatcher = {
  stop(): Promise<void>;
};

export type AppMonitorTextArtifactWriter = (runId: string, fileName: string, content: string) => Promise<{ id: string }>;

export type AppMonitorCallbacks = {
  onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
  onSample?: (sample: AndroidProcessMetricSample, kind: "cpu" | "memory") => void | Promise<void>;
  onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
};

export interface AutomationDeviceDriver {
  getToolStatus(): Promise<ToolStatus[]>;
  listDevices(): Promise<DeviceInfo[]>;
  getDeviceInfo(serial: string): Promise<DeviceInfo>;
  getInstalledAppInfo?(serial: string, appIdentifier: string): Promise<InstalledAppInfo>;
  screenshot(serial: string): Promise<Buffer>;
  getForegroundApp?(serial: string): Promise<{ packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string }>;
  dumpUiHierarchy?(serial: string): Promise<string>;
  performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void>;
  performSemanticAction?(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void>;
  clearAppData?(serial: string, packageName: string): Promise<void>;
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
    writeTextArtifact: AppMonitorTextArtifactWriter,
    callbacks?: AppMonitorCallbacks
  ): Promise<MobileAppMonitorSession>;
  startVideoRecording(serial: string, runId: string, localDir: string): Promise<MobileVideoRecording>;
  stopVideoRecording(recording: MobileVideoRecording, keep: boolean): Promise<string | undefined>;
}
