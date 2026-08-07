import { defaultHarmonyCapabilities, nowIso, type DeviceInfo } from "@mobile-automation/shared";
import { parseHdcTargets } from "./harmony-parsers.js";

export type HarmonyShellOptions = {
  timeoutMs?: number;
};

export type HarmonyShellExecutor = (
  serial: string,
  args: string[],
  options?: HarmonyShellOptions
) => Promise<string>;

type HarmonyDeviceDiscoveryOptions = {
  listTargets: () => Promise<string>;
  shell: HarmonyShellExecutor;
  resolution?: (serial: string) => Promise<{ width: number; height: number } | undefined>;
};

export class HarmonyDeviceDiscovery {
  private readonly resolutionCache = new Map<string, { width: number; height: number } | undefined>();

  constructor(private readonly options: HarmonyDeviceDiscoveryOptions) {}

  async listDevices(): Promise<DeviceInfo[]> {
    const serials = parseHdcTargets(await this.options.listTargets());
    return Promise.all(serials.map((serial) => this.getDeviceInfo(serial)));
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    const [model, manufacturer, osVersion, resolution] = await Promise.all([
      this.shell(serial, ["param", "get", "const.product.model"]).catch(() => ""),
      this.shell(serial, ["param", "get", "const.product.manufacturer"]).catch(() => ""),
      this.shell(serial, ["param", "get", "const.ohos.apiversion"]).catch(() => ""),
      this.resolutionFor(serial)
    ]);
    const normalizedModel = model.trim();
    return {
      id: serial,
      serial,
      platform: "harmony",
      name: normalizedModel || serial,
      model: normalizedModel || undefined,
      manufacturer: manufacturer.trim() || undefined,
      osVersion: osVersion.trim() || undefined,
      resolution,
      orientation: orientationFromResolution(resolution),
      status: "online",
      capabilities: defaultHarmonyCapabilities(),
      lastSeenAt: nowIso()
    };
  }

  private shell(serial: string, args: string[], options?: HarmonyShellOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }

  private async resolutionFor(serial: string): Promise<{ width: number; height: number } | undefined> {
    if (this.resolutionCache.has(serial)) {
      return this.resolutionCache.get(serial);
    }
    const resolution = await this.options.resolution?.(serial).catch(() => undefined);
    this.resolutionCache.set(serial, resolution);
    return resolution;
  }
}

function orientationFromResolution(resolution: { width: number; height: number } | undefined): DeviceInfo["orientation"] {
  if (!resolution) {
    return undefined;
  }
  return resolution.width > resolution.height ? "landscape" : "portrait";
}
