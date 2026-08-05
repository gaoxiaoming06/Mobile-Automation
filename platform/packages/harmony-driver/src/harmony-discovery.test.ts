import { describe, expect, it } from "vitest";
import { HarmonyDeviceDiscovery } from "./harmony-discovery.js";

describe("HarmonyDeviceDiscovery", () => {
  it("lists online devices from hdc targets", async () => {
    const discovery = new HarmonyDeviceDiscovery({
      listTargets: async () => "ABC123\nDEF456\tdevice\n",
      shell: async (_serial, args) => {
        if (args.join(" ") === "param get const.product.model") return "MatePad";
        if (args.join(" ") === "param get const.product.manufacturer") return "HUAWEI";
        if (args.join(" ") === "param get const.ohos.apiversion") return "15";
        return "";
      }
    });

    await expect(discovery.listDevices()).resolves.toMatchObject([
      {
        id: "ABC123",
        serial: "ABC123",
        platform: "harmony",
        name: "MatePad",
        model: "MatePad",
        manufacturer: "HUAWEI",
        osVersion: "15",
        status: "online"
      },
      {
        id: "DEF456",
        serial: "DEF456",
        platform: "harmony",
        status: "online"
      }
    ]);
  });

  it("ignores offline and unauthorized targets", async () => {
    const requestedSerials: string[] = [];
    const discovery = new HarmonyDeviceDiscovery({
      listTargets: async () => "List of devices attached\nABC123\tdevice\nOFFLINE\toffline\nLOCKED\tunauthorized\n",
      shell: async (serial) => {
        requestedSerials.push(serial);
        return "";
      }
    });

    await expect(discovery.listDevices()).resolves.toMatchObject([{ serial: "ABC123", platform: "harmony" }]);
    expect(new Set(requestedSerials)).toEqual(new Set(["ABC123"]));
  });

  it("includes resolution from the optional resolution provider", async () => {
    const discovery = new HarmonyDeviceDiscovery({
      listTargets: async () => "ABC123\n",
      shell: async () => "",
      resolution: async () => ({ width: 1440, height: 3120 })
    });

    await expect(discovery.listDevices()).resolves.toMatchObject([
      {
        serial: "ABC123",
        resolution: { width: 1440, height: 3120 },
        orientation: "portrait"
      }
    ]);
  });
});
