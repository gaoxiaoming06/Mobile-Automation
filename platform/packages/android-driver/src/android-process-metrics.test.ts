import { describe, expect, it, vi } from "vitest";
import { type AndroidProcessInfo } from "@mobile-automation/shared";
import { type AndroidShellExecutor } from "./android-actions.js";
import {
  AndroidProcessMetricSampler,
  parseAppSummary,
  parseProcessCpuStat,
  parseSystemCpuStat,
  parseTotalPssKb
} from "./android-process-metrics.js";

const processInfo: AndroidProcessInfo = {
  pid: 1234,
  processName: "cn.eeo.classin:worker",
  packageName: "cn.eeo.classin",
  isMainProcess: false,
  discoveredAt: "2026-07-22T00:00:00.000Z"
};

describe("process cpu stat parsers", () => {
  it("parses system total ticks and core count", () => {
    expect(
      parseSystemCpuStat(
        [
          "cpu  100 0 100 800 0 0 0 0 0 0",
          "cpu0 25 0 25 200 0 0 0 0 0 0",
          "cpu1 25 0 25 200 0 0 0 0 0 0",
          "cpu2 25 0 25 200 0 0 0 0 0 0",
          "cpu3 25 0 25 200 0 0 0 0 0 0"
        ].join("\n")
      )
    ).toEqual({ total: 1000, coreCount: 4 });
  });

  it("parses process utime and stime when process names contain parentheses", () => {
    expect(parseProcessCpuStat("1234 (cn.eeo.classin(worker)) S 1 2 3 4 5 6 7 8 9 10 11 31")).toEqual({
      utime: 11,
      stime: 31,
      total: 42
    });
  });
});

describe("AndroidProcessMetricSampler CPU", () => {
  it("uses two stat reads to calculate process cpu percent", async () => {
    const sampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "cat /proc/stat": [
          "cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 100 0 100 800 0 0 0 0 0 0",
          "cpu  125 0 125 850 0 0 0 0 0 0\ncpu0 125 0 125 850 0 0 0 0 0 0"
        ],
        "cat /proc/1234/stat": [
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 100 50",
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 120 70"
        ]
      }),
      sleep: async () => undefined
    });

    const sample = await sampler.sampleCpu("device-1", processInfo);

    expect(sample).toEqual(
      expect.objectContaining({
        pid: 1234,
        processName: "cn.eeo.classin:worker",
        cpuPercent: 40
      })
    );
    expect(sample.sampledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes to one core so a fully busy core on a four-core device is about 100 percent", async () => {
    const sampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "cat /proc/stat": [
          [
            "cpu  100 0 0 300 0 0 0 0 0 0",
            "cpu0 25 0 0 75 0 0 0 0 0 0",
            "cpu1 25 0 0 75 0 0 0 0 0 0",
            "cpu2 25 0 0 75 0 0 0 0 0 0",
            "cpu3 25 0 0 75 0 0 0 0 0 0"
          ].join("\n"),
          [
            "cpu  125 0 0 675 0 0 0 0 0 0",
            "cpu0 50 0 0 150 0 0 0 0 0 0",
            "cpu1 25 0 0 175 0 0 0 0 0 0",
            "cpu2 25 0 0 175 0 0 0 0 0 0",
            "cpu3 25 0 0 175 0 0 0 0 0 0"
          ].join("\n")
        ],
        "cat /proc/1234/stat": [
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 0 0",
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 100 0"
        ]
      }),
      sleep: async () => undefined
    });

    const sample = await sampler.sampleCpu("device-1", processInfo);

    expect(sample.cpuPercent).toBeCloseTo(100, 5);
  });

  it("allows multicore process cpu above 100 percent", async () => {
    const sampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "cat /proc/stat": [
          "cpu  100 0 0 300 0 0 0 0 0 0\ncpu0 25 0 0 75 0 0 0 0 0 0\ncpu1 25 0 0 75 0 0 0 0 0 0\ncpu2 25 0 0 75 0 0 0 0 0 0\ncpu3 25 0 0 75 0 0 0 0 0 0",
          "cpu  200 0 0 600 0 0 0 0 0 0\ncpu0 50 0 0 150 0 0 0 0 0 0\ncpu1 50 0 0 150 0 0 0 0 0 0\ncpu2 50 0 0 150 0 0 0 0 0 0\ncpu3 50 0 0 150 0 0 0 0 0 0"
        ],
        "cat /proc/1234/stat": [
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 0 0",
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 300 0"
        ]
      }),
      sleep: async () => undefined
    });

    const sample = await sampler.sampleCpu("device-1", processInfo);

    expect(sample.cpuPercent).toBeCloseTo(300, 5);
  });

  it("returns undefined cpu when total delta is not positive or stat output is invalid", async () => {
    const zeroDeltaSampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "cat /proc/stat": ["cpu  100 0 0 300 0 0 0 0 0 0", "cpu  100 0 0 300 0 0 0 0 0 0"],
        "cat /proc/1234/stat": [
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 0 0",
          "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 10 0"
        ]
      }),
      sleep: async () => undefined
    });
    const invalidSampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "cat /proc/stat": ["cpu  100 0 0 300 0 0 0 0 0 0", "cpu  120 0 0 320 0 0 0 0 0 0"],
        "cat /proc/1234/stat": ["not a stat line", "not a stat line"]
      }),
      sleep: async () => undefined
    });

    await expect(zeroDeltaSampler.sampleCpu("device-1", processInfo)).resolves.toEqual(
      expect.objectContaining({ cpuPercent: undefined })
    );
    await expect(invalidSampler.sampleCpu("device-1", processInfo)).resolves.toEqual(
      expect.objectContaining({ cpuPercent: undefined })
    );
  });
});

describe("meminfo parsers", () => {
  it("parses total pss from compact TOTAL PSS output", () => {
    expect(parseTotalPssKb("TOTAL PSS: 528864K")).toBe(528864);
  });

  it("parses total pss from the TOTAL table row", () => {
    expect(parseTotalPssKb("TOTAL    528864   477352     1024")).toBe(528864);
  });

  it("parses App Summary heap rows", () => {
    expect(
      parseAppSummary(
        [
          "App Summary",
          "                       Pss(KB)",
          "                        ------",
          "           Java Heap:   123456",
          "         Native Heap:    65432",
          "            Graphics:    12000"
        ].join("\n")
      )
    ).toEqual(
      expect.objectContaining({
        javaHeapKb: 123456,
        nativeHeapKb: 65432,
        graphicsKb: 12000
      })
    );
  });
});

describe("AndroidProcessMetricSampler memory", () => {
  it("samples pss and App Summary from dumpsys meminfo", async () => {
    const sampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "dumpsys meminfo 1234": [
          "TOTAL PSS: 528864K",
          "App Summary",
          "                       Pss(KB)",
          "                        ------",
          "           Java Heap:   123456",
          "         Native Heap:    65432"
        ].join("\n")
      })
    });

    const sample = await sampler.sampleMemory("device-1", processInfo);

    expect(sample).toEqual(
      expect.objectContaining({
        pid: 1234,
        processName: "cn.eeo.classin:worker",
        pssKb: 528864
      })
    );
    expect(sample.raw).toEqual(
      expect.objectContaining({
        appSummary: expect.objectContaining({
          javaHeapKb: 123456,
          nativeHeapKb: 65432
        })
      })
    );
  });

  it("keeps the sample usable when dumpsys meminfo fails", async () => {
    const sampler = new AndroidProcessMetricSampler({
      shell: createShellSequence({
        "dumpsys meminfo 1234": new Error("permission denied")
      })
    });

    await expect(sampler.sampleMemory("device-1", processInfo)).resolves.toEqual(
      expect.objectContaining({
        pid: 1234,
        pssKb: undefined,
        raw: expect.objectContaining({
          error: "permission denied"
        })
      })
    );
  });
});

function createShellSequence(outputs: Record<string, string | string[] | Error>): AndroidShellExecutor {
  const readCounts = new Map<string, number>();
  return vi.fn<AndroidShellExecutor>(async (_serial, args) => {
    const key = args.join(" ");
    const output = outputs[key];
    if (output instanceof Error) {
      throw output;
    }
    if (Array.isArray(output)) {
      const readCount = readCounts.get(key) ?? 0;
      readCounts.set(key, readCount + 1);
      const value = output[readCount];
      if (value === undefined) {
        throw new Error(`Unexpected shell command read: ${key}`);
      }
      return value;
    }
    if (output === undefined) {
      throw new Error(`Unexpected shell command: ${key}`);
    }
    return output;
  });
}
