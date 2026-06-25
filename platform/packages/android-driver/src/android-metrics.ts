import { type MetricSample, nowIso } from "@mobile-automation/shared";
import { parseBattery, parseMeminfo, parseProcStat } from "./android-parsers.js";
import { type AndroidShellExecutor, type ExecTextOptions } from "./android-actions.js";

type AndroidMetricSamplerOptions = {
  shell: AndroidShellExecutor;
  sleep?: (ms: number) => Promise<void>;
};

export class AndroidMetricSampler {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AndroidMetricSamplerOptions) {
    this.sleep = options.sleep ?? sleep;
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    const [cpu, meminfo, battery] = await Promise.all([
      this.sampleCpu(serial).catch(() => undefined),
      this.shell(serial, ["cat", "/proc/meminfo"]).catch(() => ""),
      this.shell(serial, ["dumpsys", "battery"]).catch(() => "")
    ]);
    const memory = parseMeminfo(meminfo);
    const batteryInfo = parseBattery(battery);

    return {
      id: `metric_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      cpuPercent: cpu,
      memoryUsedKb: memory.usedKb,
      memoryTotalKb: memory.totalKb,
      batteryLevel: batteryInfo.level,
      batteryTemperatureC: batteryInfo.temperatureC,
      raw: {
        meminfo: memory.raw,
        battery: batteryInfo.raw
      }
    };
  }

  private async sampleCpu(serial: string): Promise<number | undefined> {
    const first = parseProcStat(await this.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }));
    await this.sleep(250);
    const second = parseProcStat(await this.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }));
    if (!first || !second) {
      return undefined;
    }
    const idleDelta = second.idle - first.idle;
    const totalDelta = second.total - first.total;
    if (totalDelta <= 0) {
      return undefined;
    }
    return Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
  }

  private shell(serial: string, args: string[], options?: ExecTextOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
