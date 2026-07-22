import {
  type AndroidProcessInfo,
  type AndroidProcessMetricSample,
  nowIso
} from "@mobile-automation/shared";
import { type AndroidShellExecutor, type ExecTextOptions } from "./android-actions.js";

export type AndroidProcessMetricSamplerOptions = {
  shell: AndroidShellExecutor;
  sleep?: (ms: number) => Promise<void>;
};

export type ParsedSystemCpuStat = {
  total: number;
  coreCount: number;
};

export type ParsedProcessCpuStat = {
  utime: number;
  stime: number;
  total: number;
};

export type AndroidProcessAppSummary = {
  javaHeapKb?: number;
  nativeHeapKb?: number;
  codeKb?: number;
  stackKb?: number;
  graphicsKb?: number;
  privateOtherKb?: number;
  systemKb?: number;
};

export class AndroidProcessMetricSampler {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AndroidProcessMetricSamplerOptions) {
    this.sleep = options.sleep ?? sleep;
  }

  async sampleCpu(serial: string, process: AndroidProcessInfo): Promise<AndroidProcessMetricSample> {
    const sample = createProcessSample(process);
    try {
      const [firstSystem, firstProcess] = await Promise.all([
        this.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }),
        this.shell(serial, ["cat", `/proc/${process.pid}/stat`], { timeoutMs: 5000 })
      ]);
      await this.sleep(250);
      const [secondSystem, secondProcess] = await Promise.all([
        this.shell(serial, ["cat", "/proc/stat"], { timeoutMs: 5000 }),
        this.shell(serial, ["cat", `/proc/${process.pid}/stat`], { timeoutMs: 5000 })
      ]);

      const firstSystemStat = parseSystemCpuStat(firstSystem);
      const secondSystemStat = parseSystemCpuStat(secondSystem);
      const firstProcessStat = parseProcessCpuStat(firstProcess);
      const secondProcessStat = parseProcessCpuStat(secondProcess);
      if (!firstSystemStat || !secondSystemStat || !firstProcessStat || !secondProcessStat) {
        return {
          ...sample,
          cpuPercent: undefined,
          raw: {
            error: "Unable to parse CPU stat"
          }
        };
      }

      const totalDelta = secondSystemStat.total - firstSystemStat.total;
      const processDelta = secondProcessStat.total - firstProcessStat.total;
      if (totalDelta <= 0 || processDelta < 0) {
        return {
          ...sample,
          cpuPercent: undefined
        };
      }

      const coreCount = secondSystemStat.coreCount || firstSystemStat.coreCount || 1;
      return {
        ...sample,
        cpuPercent: (processDelta / totalDelta) * coreCount * 100
      };
    } catch (error) {
      return {
        ...sample,
        cpuPercent: undefined,
        raw: {
          error: errorMessage(error)
        }
      };
    }
  }

  async sampleMemory(serial: string, process: AndroidProcessInfo): Promise<AndroidProcessMetricSample> {
    const sample = createProcessSample(process);
    try {
      const output = await this.shell(serial, ["dumpsys", "meminfo", String(process.pid)], { timeoutMs: 10000 });
      const pssKb = parseTotalPssKb(output);
      const appSummary = parseAppSummary(output);
      return {
        ...sample,
        pssKb,
        raw: {
          meminfo: output,
          appSummary,
          ...(pssKb === undefined ? { error: "Unable to parse TOTAL PSS" } : {})
        }
      };
    } catch (error) {
      return {
        ...sample,
        pssKb: undefined,
        raw: {
          error: errorMessage(error)
        }
      };
    }
  }

  private shell(serial: string, args: string[], options?: ExecTextOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

export function parseSystemCpuStat(output: string): ParsedSystemCpuStat | undefined {
  const lines = output.split(/\r?\n/);
  const aggregate = lines.find((line) => /^cpu\s+/.test(line));
  if (!aggregate) {
    return undefined;
  }

  const rawFields = aggregate.trim().split(/\s+/).slice(1);
  if (rawFields.length === 0) {
    return undefined;
  }

  let total = 0;
  for (const field of rawFields) {
    const value = parseNumber(field);
    if (value === undefined) {
      return undefined;
    }
    total += value;
  }

  const coreCount = lines.filter((line) => /^cpu\d+\s+/.test(line)).length || 1;
  return { total, coreCount };
}

export function parseProcessCpuStat(output: string): ParsedProcessCpuStat | undefined {
  const trimmed = output.trim();
  const pidAndCommand = trimmed.match(/^\d+\s+\(/);
  const commandEnd = trimmed.lastIndexOf(")");
  if (!pidAndCommand || commandEnd <= pidAndCommand[0].length - 1) {
    return undefined;
  }

  const fields = trimmed.slice(commandEnd + 1).trim().split(/\s+/);
  const utime = parseNumber(fields[11]);
  const stime = parseNumber(fields[12]);
  if (utime === undefined || stime === undefined) {
    return undefined;
  }
  return {
    utime,
    stime,
    total: utime + stime
  };
}

export function parseTotalPssKb(output: string): number | undefined {
  const compactMatch = output.match(/^\s*TOTAL\s+PSS\s*:\s*([\d,]+)\s*K?\b/im);
  if (compactMatch?.[1]) {
    return parseNumber(compactMatch[1].replaceAll(",", ""));
  }

  const tableMatch = output.match(/^\s*TOTAL\s+([\d,]+)(?:\s|$)/im);
  if (tableMatch?.[1]) {
    return parseNumber(tableMatch[1].replaceAll(",", ""));
  }

  return undefined;
}

export function parseAppSummary(output: string): AndroidProcessAppSummary {
  const appSummaryStart = output.search(/^\s*App Summary\s*$/im);
  if (appSummaryStart < 0) {
    return {};
  }

  const summaryText = output.slice(appSummaryStart);
  const summary: AndroidProcessAppSummary = {};
  for (const line of summaryText.split(/\r?\n/)) {
    const match = line.match(/^\s*(Java Heap|Native Heap|Code|Stack|Graphics|Private Other|System):\s*([\d,]+)/i);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const value = parseNumber(match[2].replaceAll(",", ""));
    if (value === undefined) {
      continue;
    }
    const key = appSummaryKey(match[1]);
    summary[key] = value;
  }
  return summary;
}

function appSummaryKey(label: string): keyof AndroidProcessAppSummary {
  switch (label.toLowerCase()) {
    case "java heap":
      return "javaHeapKb";
    case "native heap":
      return "nativeHeapKb";
    case "code":
      return "codeKb";
    case "stack":
      return "stackKb";
    case "graphics":
      return "graphicsKb";
    case "private other":
      return "privateOtherKb";
    case "system":
      return "systemKb";
    default:
      return "systemKb";
  }
}

function createProcessSample(process: AndroidProcessInfo): AndroidProcessMetricSample {
  return {
    sampledAt: nowIso(),
    pid: process.pid,
    processName: process.processName
  };
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
