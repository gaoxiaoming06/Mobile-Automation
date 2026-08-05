import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  nowIso,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceInfo,
  type InstalledAppInfo,
  type MetricSample,
  type ToolStatus
} from "@mobile-automation/shared";
import { HarmonyActionExecutor } from "./harmony-actions.js";
import { HarmonyDeviceDiscovery } from "./harmony-discovery.js";
import { commandVersion, hdcFileRecv, hdcShell, hdcText } from "./hdc.js";
import { parseBundleVersion, parseForegroundBundle, parsePngSize } from "./harmony-parsers.js";

type HarmonyDriverOptions = {
  abilityName?: (bundleName: string) => string | undefined;
};

export class HarmonyDriver {
  private readonly actions: HarmonyActionExecutor;
  private readonly discovery: HarmonyDeviceDiscovery;

  constructor(options: HarmonyDriverOptions = {}) {
    this.actions = new HarmonyActionExecutor({
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions),
      abilityName: options.abilityName
    });
    this.discovery = new HarmonyDeviceDiscovery({
      listTargets: () => hdcText(["list", "targets"], { timeoutMs: 10000 }),
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions),
      resolution: (serial) => this.screenshotResolution(serial)
    });
  }

  async getToolStatus(): Promise<ToolStatus[]> {
    return [
      {
        name: "hdc",
        ...(await commandVersion("hdc", ["version"]))
      }
    ];
  }

  listDevices(): Promise<DeviceInfo[]> {
    return this.discovery.listDevices();
  }

  getDeviceInfo(serial: string): Promise<DeviceInfo> {
    return this.discovery.getDeviceInfo(serial);
  }

  async screenshot(serial: string): Promise<Buffer> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-harmony-screenshot-"));
    const localPath = path.join(tmpDir, `${serial}.png`);
    const remotePath = `/data/local/tmp/mobile_automation_${Date.now()}.png`;
    try {
      await this.shell(serial, ["uitest", "screenCap", "-p", remotePath], { timeoutMs: 15000 });
      await hdcFileRecv(serial, remotePath, localPath, { timeoutMs: 15000, maxBuffer: 8 * 1024 * 1024 });
      return await readFile(localPath);
    } finally {
      await this.shell(serial, ["rm", "-f", remotePath], { timeoutMs: 5000 }).catch(() => undefined);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async getForegroundApp(serial: string): Promise<{ bundleId?: string; abilityName?: string; packageName?: string }> {
    const output = await this.shell(serial, ["aa", "dump", "-a"], { timeoutMs: 8000 }).catch(() => "");
    return parseForegroundBundle(output);
  }

  async getInstalledAppInfo(serial: string, bundleName: string): Promise<InstalledAppInfo> {
    const output = await this.shell(serial, ["bm", "dump", "-n", bundleName], { timeoutMs: 10000 }).catch(() => "");
    return {
      bundleId: bundleName,
      displayVersion: parseBundleVersion(output) ?? "unknown"
    };
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "screenshot") {
      await this.screenshot(serial);
      return { driverChannel: "hdc_input" };
    }
    return this.actions.performAction(serial, action);
  }

  clearAppData(serial: string, bundleName: string): Promise<void> {
    return this.actions.clearAppData(serial, bundleName);
  }

  async collectLogs(serial: string, lines = 400): Promise<string> {
    return this.shell(serial, ["hilog", "-x", "-t", String(lines)], { timeoutMs: 12000 }).catch(() => "");
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return {
      id: `metric_${Date.now()}`,
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      raw: {
        platform: "harmony",
        status: "unsupported"
      }
    };
  }

  async startVideoRecording(): Promise<never> {
    throw new Error("HarmonyOS video recording is not supported yet");
  }

  async stopVideoRecording(): Promise<string | undefined> {
    return undefined;
  }

  private shell(serial: string, args: string[], options?: { timeoutMs?: number; maxBuffer?: number }): Promise<string> {
    return hdcShell(serial, args, options);
  }

  private async screenshotResolution(serial: string): Promise<{ width: number; height: number } | undefined> {
    return parsePngSize(await this.screenshot(serial));
  }
}

export { HarmonyActionExecutor } from "./harmony-actions.js";
export { HarmonyDeviceDiscovery } from "./harmony-discovery.js";
export { parseForegroundBundle, parseHdcTargets, parseLaunchAbility, parsePngSize } from "./harmony-parsers.js";
