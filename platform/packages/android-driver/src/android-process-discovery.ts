import { type AndroidProcessInfo, nowIso } from "@mobile-automation/shared";
import { type AndroidShellExecutor, type ExecTextOptions } from "./android-actions.js";

export type AndroidProcessDiscoveryFilter = {
  includeSubprocesses?: boolean;
  processFilters?: string[];
};

export type AndroidPsProcess = {
  pid: number;
  name: string;
};

type AndroidProcessDiscoveryOptions = {
  shell: AndroidShellExecutor;
};

const psTimeout: ExecTextOptions = { timeoutMs: 5000 };
const cmdlineTimeout: ExecTextOptions = { timeoutMs: 2000 };
const androidCommTruncationMinLength = 15;

export class AndroidProcessDiscovery {
  constructor(private readonly options: AndroidProcessDiscoveryOptions) {}

  async discover(serial: string, packageName: string, filter: AndroidProcessDiscoveryFilter = {}): Promise<AndroidProcessInfo[]> {
    const includeSubprocesses = filter.includeSubprocesses ?? true;
    const psProcesses = await this.listProcessCandidates(serial, packageName);
    if (psProcesses.length === 0) {
      return [];
    }

    const discoveredAt = nowIso();
    const processes: AndroidProcessInfo[] = [];
    for (const process of psProcesses) {
      const cmdlineProcessName = await this.readCmdline(serial, process.pid);
      if (!cmdlineProcessName && isAndroidCommTruncatedCandidate(process.name, packageName)) {
        continue;
      }
      const processName = cmdlineProcessName ?? process.name;
      if (!isPackageProcess(processName, packageName, includeSubprocesses)) {
        continue;
      }
      if (!matchesProcessFilter(processName, packageName, filter.processFilters)) {
        continue;
      }
      processes.push({
        pid: process.pid,
        processName,
        packageName,
        isMainProcess: processName === packageName,
        discoveredAt
      });
    }

    return processes;
  }

  private async listProcessCandidates(serial: string, packageName: string): Promise<AndroidPsProcess[]> {
    const modern = await this.readPs(serial, ["ps", "-A", "-o", "PID,NAME"]);
    const modernCandidates = filterPotentialPackageProcesses(modern, packageName);
    if (modernCandidates.length > 0) {
      return modernCandidates;
    }

    const legacy = await this.readPs(serial, ["ps"]);
    return filterPotentialPackageProcesses(legacy, packageName);
  }

  private async readPs(serial: string, args: string[]): Promise<AndroidPsProcess[]> {
    try {
      return parsePsOutput(await this.shell(serial, args, psTimeout));
    } catch {
      return [];
    }
  }

  private async readCmdline(serial: string, pid: number): Promise<string | undefined> {
    try {
      const output = await this.shell(serial, ["cat", `/proc/${pid}/cmdline`], cmdlineTimeout);
      const processName = output.split("\u0000")[0]?.trim();
      return processName || undefined;
    } catch {
      return undefined;
    }
  }

  private shell(serial: string, args: string[], options?: ExecTextOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

export function parsePsOutput(output: string): AndroidPsProcess[] {
  const processes: AndroidPsProcess[] = [];
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerColumns = lines[0]?.split(/\s+/) ?? [];
  const pidHeaderIndex = findColumnIndex(headerColumns, "PID");
  const nameHeaderIndex = findColumnIndex(headerColumns, "NAME");

  for (const line of lines) {
    const columns = line.split(/\s+/);
    const parsed = parsePsColumns(columns, pidHeaderIndex, nameHeaderIndex);
    if (parsed) {
      processes.push(parsed);
    }
  }

  return processes;
}

export function isPackageProcess(processName: string, packageName: string, includeSubprocesses = true): boolean {
  if (processName === packageName) {
    return true;
  }
  return includeSubprocesses && processName.startsWith(`${packageName}:`);
}

export function matchesProcessFilter(processName: string, packageName: string, processFilters: string[] = []): boolean {
  const filters = processFilters.map((item) => item.trim()).filter(Boolean);
  if (filters.length === 0) {
    return true;
  }

  return filters.some((filter) => {
    if (filter === "main") {
      return processName === packageName;
    }
    if (filter.startsWith(":")) {
      return processName === `${packageName}${filter}`;
    }
    return processName === filter;
  });
}

function filterPotentialPackageProcesses(processes: AndroidPsProcess[], packageName: string): AndroidPsProcess[] {
  return processes.filter((process) => isPotentialPackageProcess(process.name, packageName));
}

function isPotentialPackageProcess(processName: string, packageName: string): boolean {
  return isPackageProcess(processName, packageName, true) || isAndroidCommTruncatedCandidate(processName, packageName);
}

function isAndroidCommTruncatedCandidate(processName: string, packageName: string): boolean {
  if (processName === packageName || processName.length < androidCommTruncationMinLength) {
    return false;
  }

  const subprocessPrefix = `${packageName}:`;
  return packageName.startsWith(processName) || subprocessPrefix.startsWith(processName) || processName.startsWith(subprocessPrefix);
}

function parsePsColumns(columns: string[], pidHeaderIndex: number, nameHeaderIndex: number): AndroidPsProcess | undefined {
  if (pidHeaderIndex >= 0 && nameHeaderIndex >= 0) {
    const pid = Number(columns[pidHeaderIndex]);
    const name = columns[nameHeaderIndex];
    if (Number.isInteger(pid) && pid > 0 && name && name !== "NAME") {
      return { pid, name };
    }
    return undefined;
  }

  if (columns.length >= 2) {
    const firstColumnPid = Number(columns[0]);
    if (Number.isInteger(firstColumnPid) && firstColumnPid > 0) {
      return { pid: firstColumnPid, name: columns[columns.length - 1] };
    }

    const secondColumnPid = Number(columns[1]);
    if (Number.isInteger(secondColumnPid) && secondColumnPid > 0) {
      return { pid: secondColumnPid, name: columns[columns.length - 1] };
    }
  }

  return undefined;
}

function findColumnIndex(columns: string[], name: string): number {
  return columns.findIndex((column) => column.toUpperCase() === name);
}
