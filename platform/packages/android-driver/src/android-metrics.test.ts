import { describe, expect, it, vi } from "vitest";
import { AndroidMetricSampler } from "./android-metrics.js";

describe("AndroidMetricSampler", () => {
  it("samples cpu, memory and battery into a MetricSample", async () => {
    let procStatReads = 0;
    const sampler = new AndroidMetricSampler({
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "cat" && args[1] === "/proc/stat") {
          procStatReads += 1;
          return procStatReads === 1 ? "cpu  10 0 10 80 0 0 0 0 0 0" : "cpu  20 0 40 140 0 0 0 0 0 0";
        }
        if (args[0] === "cat" && args[1] === "/proc/meminfo") {
          return "MemTotal:       1000 kB\nMemAvailable:    250 kB";
        }
        if (args[0] === "dumpsys" && args[1] === "battery") {
          return "level: 87\ntemperature: 326";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    const sample = await sampler.samplePerformance("device-1", "run-1", "step-1");

    expect(sample).toEqual(
      expect.objectContaining({
        runId: "run-1",
        stepResultId: "step-1",
        deviceSerial: "device-1",
        cpuPercent: 40,
        memoryUsedKb: 750,
        memoryTotalKb: 1000,
        batteryLevel: 87,
        batteryTemperatureC: 32.6
      })
    );
    expect(sample.id).toMatch(/^metric_/);
    expect(sample.sampledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sample.raw).toEqual({
      meminfo: {
        MemAvailable: 250,
        MemTotal: 1000
      },
      battery: {
        level: 87,
        temperature: 326
      }
    });
  });

  it("keeps metric samples usable when cpu data cannot be parsed", async () => {
    const sampler = new AndroidMetricSampler({
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "cat" && args[1] === "/proc/stat") {
          return "not cpu data";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    const sample = await sampler.samplePerformance("device-1", "run-1");

    expect(sample.cpuPercent).toBeUndefined();
    expect(sample.memoryUsedKb).toBeUndefined();
    expect(sample.batteryLevel).toBeUndefined();
  });
});
