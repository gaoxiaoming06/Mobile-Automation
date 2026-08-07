import { AndroidDriver } from "@mobile-automation/android-driver";
import { HarmonyDriver } from "@mobile-automation/harmony-driver";
import { IosDriver } from "@mobile-automation/ios-driver";
import type {
  DeviceActionRequest,
  DeviceActionResult,
  DeviceInfo,
  InstalledAppInfo,
  MetricSample,
  SemanticDeviceActionRequest,
  ToolStatus
} from "@mobile-automation/shared";
import type { AgentLocalDeviceDriver } from "./device-agent.js";

export class LocalDeviceAgentDriver implements AgentLocalDeviceDriver {
  private readonly platformCache = new Map<string, DeviceInfo["platform"]>();

  constructor(
    private readonly android = new AndroidDriver(),
    private readonly ios = new IosDriver(),
    private readonly harmony = new HarmonyDriver()
  ) {}

  async getToolStatus(): Promise<ToolStatus[]> {
    const [androidTools, iosTools, harmonyTools] = await Promise.all([
      this.android.getToolStatus().catch(toolError("android")),
      this.ios.getToolStatus().catch(toolError("ios")),
      this.harmony.getToolStatus().catch(toolError("harmony"))
    ]);
    return [...androidTools, ...iosTools, ...harmonyTools];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [androidDevices, iosDevices, harmonyDevices] = await Promise.all([
      this.android.listDevices().catch(() => []),
      this.ios.listDevices().catch(() => []),
      this.harmony.listDevices().catch(() => [])
    ]);
    const devices = [...androidDevices, ...iosDevices, ...harmonyDevices];
    for (const device of devices) {
      this.platformCache.set(device.serial, device.platform);
    }
    return devices;
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    return (await this.driverFor(serial)).getDeviceInfo(serial);
  }

  async getInstalledAppInfo(serial: string, appIdentifier: string): Promise<InstalledAppInfo> {
    const driver = await this.driverFor(serial);
    if (!driver.getInstalledAppInfo) {
      throw new Error("installed app lookup is not supported by this platform driver");
    }
    return driver.getInstalledAppInfo(serial, appIdentifier);
  }

  async screenshot(serial: string): Promise<Buffer> {
    return (await this.driverFor(serial)).screenshot(serial);
  }

  async getForegroundApp(serial: string): Promise<{ packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string }> {
    return (await this.driverFor(serial)).getForegroundApp?.(serial) ?? {};
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    const driver = await this.driverFor(serial);
    if (!driver.dumpUiHierarchy) {
      throw new Error("UI hierarchy dump is not supported by this platform driver");
    }
    return driver.dumpUiHierarchy(serial);
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void> {
    return (await this.driverFor(serial)).performAction(serial, action);
  }

  async performSemanticAction(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void> {
    const platform = await this.resolvePlatform(serial);
    if (platform !== "android") {
      throw new Error(`${platform} semantic actions are not supported by this agent`);
    }
    return this.android.performSemanticAction(serial, action);
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    const driver = await this.driverFor(serial);
    if (!driver.clearAppData) {
      throw new Error("clear app data is not supported by this platform driver");
    }
    return driver.clearAppData(serial, packageName);
  }

  async collectLogs(serial: string, lines?: number): Promise<string> {
    return (await this.driverFor(serial)).collectLogs(serial, lines);
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return (await this.driverFor(serial)).samplePerformance(serial, runId, stepResultId);
  }

  private async resolvePlatform(serial: string): Promise<DeviceInfo["platform"]> {
    const cached = this.platformCache.get(serial);
    if (cached) {
      return cached;
    }
    const device = (await this.listDevices()).find((item) => item.serial === serial);
    if (!device) {
      throw new Error(`Device not found: ${serial}`);
    }
    return device.platform;
  }

  private async driverFor(serial: string): Promise<PlatformDriver> {
    const platform = await this.resolvePlatform(serial);
    if (platform === "android") return this.android;
    if (platform === "ios") return this.ios;
    return this.harmony;
  }
}

type PlatformDriver = {
  getDeviceInfo(serial: string): Promise<DeviceInfo>;
  getInstalledAppInfo?(serial: string, appIdentifier: string): Promise<InstalledAppInfo>;
  screenshot(serial: string): Promise<Buffer>;
  getForegroundApp?(serial: string): Promise<{ packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string }>;
  dumpUiHierarchy?(serial: string): Promise<string>;
  performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void>;
  clearAppData?(serial: string, packageName: string): Promise<void>;
  collectLogs(serial: string, lines?: number): Promise<string>;
  samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample>;
};

function toolError(prefix: string): (error: unknown) => ToolStatus[] {
  return (error) => [{
    name: `${prefix}_tools`,
    available: false,
    version: error instanceof Error ? error.message : String(error)
  }];
}
