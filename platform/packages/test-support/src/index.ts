import {
  createId,
  defaultAndroidCapabilities,
  nowIso,
  type ActionStep,
  type DeviceActionResult,
  type DeviceActionRequest,
  type DeviceInfo,
  type MetricSample,
  type ToolStatus
} from "@mobile-automation/shared";

export type MockVideoRecording = {
  id: string;
  serial: string;
  localPath: string;
  startedAt: string;
};

export class MockDriver {
  readonly device: DeviceInfo = {
    id: "mock-android-1",
    serial: "mock-android-1",
    platform: "android",
    name: "Mock Android",
    model: "Mock",
    osVersion: "15",
    resolution: {
      width: 1080,
      height: 2400
    },
    orientation: "portrait",
    status: "online",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: nowIso()
  };

  readonly actions: DeviceActionRequest[] = [];
  readonly clearedAppData: string[] = [];
  readonly setupActions: Array<DeviceActionRequest | { type: "clear_app_data"; packageName: string }> = [];
  readonly logs: string[] = [];
  readonly recordings: MockVideoRecording[] = [];

  async getToolStatus(): Promise<ToolStatus[]> {
    return [
      {
        name: "mock",
        available: true,
        version: "test"
      }
    ];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [this.device];
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    this.assertKnownDevice(serial);
    return this.device;
  }

  async screenshot(serial: string): Promise<Buffer> {
    this.assertKnownDevice(serial);
    return Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=",
      "base64"
    );
  }

  async getForegroundApp(serial: string): Promise<{ packageName?: string; activityName?: string; componentName?: string }> {
    this.assertKnownDevice(serial);
    return {
      packageName: "com.example.app",
      activityName: "com.example.app.MainActivity",
      componentName: "com.example.app/.MainActivity"
    };
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    this.assertKnownDevice(serial);
    this.actions.push(action);
    if (action.type === "close_app" || action.type === "launch_app" || action.type === "home") {
      this.setupActions.push(action);
    }
    return {
      driverChannel: "mock"
    };
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    this.assertKnownDevice(serial);
    this.clearedAppData.push(packageName);
    this.setupActions.push({ type: "clear_app_data", packageName });
  }

  async collectLogs(serial: string, _lines = 400): Promise<string> {
    this.assertKnownDevice(serial);
    return this.logs.join("\n");
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    this.assertKnownDevice(serial);
    return {
      id: createId("metric"),
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      cpuPercent: 1,
      memoryUsedKb: 128 * 1024,
      memoryTotalKb: 512 * 1024,
      batteryLevel: 90,
      raw: {
        platform: "mock"
      }
    };
  }

  async startVideoRecording(serial: string, runId: string, localDir: string): Promise<MockVideoRecording> {
    this.assertKnownDevice(serial);
    const recording = {
      id: runId,
      serial,
      localPath: `${localDir}/${runId}.mp4`,
      startedAt: nowIso()
    };
    this.recordings.push(recording);
    return recording;
  }

  async stopVideoRecording(recording: MockVideoRecording, keep: boolean): Promise<string | undefined> {
    this.assertKnownDevice(recording.serial);
    return keep ? recording.localPath : undefined;
  }

  createTapStep(x: number, y: number, size = this.device.resolution ?? { width: 1080, height: 2400 }): ActionStep {
    return {
      id: createId("step"),
      order: 1,
      type: "tap" as const,
      enabled: true,
      params: {},
      coordinate: {
        x,
        y,
        xRatio: x / size.width,
        yRatio: y / size.height,
        deviceWidth: size.width,
        deviceHeight: size.height
      },
      createdAt: nowIso()
    };
  }

  private assertKnownDevice(serial: string): void {
    if (serial !== this.device.serial) {
      throw new Error(`Mock device not found: ${serial}`);
    }
  }
}
