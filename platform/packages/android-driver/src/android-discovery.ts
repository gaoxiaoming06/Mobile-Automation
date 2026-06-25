import { defaultAndroidCapabilities, type DeviceInfo, nowIso } from "@mobile-automation/shared";
import { type AndroidShellExecutor } from "./android-actions.js";
import { parseDeviceLine, parseWmSize, type AndroidDeviceLine } from "./android-parsers.js";

type AndroidDeviceDiscoveryOptions = {
  listAdbDevices: () => Promise<string>;
  shell: AndroidShellExecutor;
  supportsVideoRecording: (serial: string) => Promise<boolean>;
};

export class AndroidDeviceDiscovery {
  constructor(private readonly options: AndroidDeviceDiscoveryOptions) {}

  async listDevices(): Promise<DeviceInfo[]> {
    const output = await this.options.listAdbDevices();
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("List of devices"));

    const parsed = lines.map(parseDeviceLine).filter((item): item is AndroidDeviceLine => item !== null);
    return Promise.all(
      parsed.map(async (device) => {
        if (device.state !== "device") {
          return {
            id: device.serial,
            serial: device.serial,
            platform: "android" as const,
            status: device.state === "offline" ? ("offline" as const) : ("error" as const),
            capabilities: defaultAndroidCapabilities(),
            lastSeenAt: nowIso()
          };
        }
        return this.getDeviceInfo(device.serial, device.details);
      })
    );
  }

  async getDeviceInfo(serial: string, details = ""): Promise<DeviceInfo> {
    const [model, manufacturer, osVersion, wmSize, canRecordVideo] = await Promise.all([
      this.shell(serial, ["getprop", "ro.product.model"]).catch(() => ""),
      this.shell(serial, ["getprop", "ro.product.manufacturer"]).catch(() => ""),
      this.shell(serial, ["getprop", "ro.build.version.release"]).catch(() => ""),
      this.shell(serial, ["wm", "size"]).catch(() => ""),
      this.options.supportsVideoRecording(serial).catch(() => false)
    ]);
    const resolution = parseWmSize(wmSize);
    const modelFromDetails = details.match(/\bmodel:([^\s]+)/)?.[1]?.replace(/_/g, " ");
    const capabilities = defaultAndroidCapabilities();
    capabilities.recordVideo = canRecordVideo;

    return {
      id: serial,
      serial,
      platform: "android",
      name: model.trim() || modelFromDetails || serial,
      model: model.trim() || modelFromDetails,
      manufacturer: manufacturer.trim() || undefined,
      osVersion: osVersion.trim() || undefined,
      resolution,
      orientation: resolution ? (resolution.width >= resolution.height ? "landscape" : "portrait") : undefined,
      status: "online",
      capabilities,
      lastSeenAt: nowIso()
    };
  }

  private shell(serial: string, args: string[]): Promise<string> {
    return this.options.shell(serial, args);
  }
}
