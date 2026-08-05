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
      this.options.resolution?.(serial).catch(() => undefined) ?? Promise.resolve(undefined)
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
}

function orientationFromResolution(resolution: { width: number; height: number } | undefined): DeviceInfo["orientation"] {
  if (!resolution) {
    return undefined;
  }
  return resolution.width > resolution.height ? "landscape" : "portrait";
}
