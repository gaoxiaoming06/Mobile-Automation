import { describe, expect, it, vi } from "vitest";
import { AndroidDeviceDiscovery } from "./android-discovery.js";

describe("AndroidDeviceDiscovery", () => {
  it("lists online and unavailable adb devices with stable capabilities", async () => {
    const discovery = new AndroidDeviceDiscovery({
      listAdbDevices: vi.fn(async () =>
        [
          "List of devices attached",
          "device-1 device product:foo model:Pixel_6 device:oriole",
          "device-2 offline product:foo model:Pixel_5",
          "device-3 unauthorized"
        ].join("\n")
      ),
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "getprop" && args[1] === "ro.product.model") {
          return "Pixel 6";
        }
        if (args[0] === "getprop" && args[1] === "ro.product.manufacturer") {
          return "Google";
        }
        if (args[0] === "getprop" && args[1] === "ro.build.version.release") {
          return "14";
        }
        if (args[0] === "wm") {
          return "Physical size: 1080x2400";
        }
        return "";
      }),
      supportsVideoRecording: vi.fn(async () => true)
    });

    const devices = await discovery.listDevices();

    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual(
      expect.objectContaining({
        id: "device-1",
        name: "Pixel 6",
        model: "Pixel 6",
        manufacturer: "Google",
        osVersion: "14",
        platform: "android",
        status: "online",
        resolution: { width: 1080, height: 2400 },
        orientation: "portrait"
      })
    );
    expect(devices[0]?.capabilities.recordVideo).toBe(true);
    expect(devices[1]).toEqual(
      expect.objectContaining({
        id: "device-2",
        status: "offline",
        platform: "android"
      })
    );
    expect(devices[2]).toEqual(
      expect.objectContaining({
        id: "device-3",
        status: "error",
        platform: "android"
      })
    );
  });

  it("uses adb details as a model fallback when getprop is empty", async () => {
    const discovery = new AndroidDeviceDiscovery({
      listAdbDevices: vi.fn(async () => ""),
      shell: vi.fn(async () => ""),
      supportsVideoRecording: vi.fn(async () => false)
    });

    const device = await discovery.getDeviceInfo("device-1", "product:foo model:Pixel_Tablet device:tangorpro");

    expect(device).toEqual(
      expect.objectContaining({
        id: "device-1",
        name: "Pixel Tablet",
        model: "Pixel Tablet",
        status: "online"
      })
    );
    expect(device.capabilities.recordVideo).toBe(false);
  });
});
