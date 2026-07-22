import { nowIso } from "@mobile-automation/shared";

export type AndroidStabilityEvent = {
  type: "java_crash" | "native_crash" | "anr" | "process_death";
  severity: "error" | "warning";
  occurredAt: string;
  processName?: string;
  pid?: number;
  summary: string;
  detail: string;
};

export type AndroidStabilityEventParserOptions = {
  packageName: string;
  dedupeWindowMs?: number;
};

const defaultDedupeWindowMs = 1500;

export class AndroidStabilityEventParser {
  private readonly packageName: string;
  private readonly dedupeWindowMs: number;
  private readonly emittedAtByKey = new Map<string, number>();

  constructor(options: AndroidStabilityEventParserOptions) {
    this.packageName = options.packageName;
    this.dedupeWindowMs = options.dedupeWindowMs ?? defaultDedupeWindowMs;
  }

  observe(line: string, recentLines: string[]): AndroidStabilityEvent | undefined {
    const detail = buildDetail(line, recentLines);
    const event =
      this.parseJavaCrash(line, detail) ??
      this.parseNativeCrash(line, detail) ??
      this.parseAnr(line, detail) ??
      this.parseProcessDeath(line, detail);
    if (!event) {
      return undefined;
    }
    return this.dedupe(event);
  }

  private parseJavaCrash(line: string, detail: string): AndroidStabilityEvent | undefined {
    if (!/FATAL EXCEPTION|AndroidRuntime|Process:\s*/.test(line) || !detail.includes("FATAL EXCEPTION")) {
      return undefined;
    }

    const process = [...detail.matchAll(/Process:\s*([^,\s]+),\s*PID:\s*(\d+)/g)]
      .map((match) => ({ processName: match[1], pid: Number(match[2]) }))
      .reverse()
      .find((candidate) => this.isTargetProcess(candidate.processName));
    if (!process) {
      return undefined;
    }

    return {
      type: "java_crash",
      severity: "error",
      occurredAt: nowIso(),
      processName: process.processName,
      pid: process.pid,
      summary: `Java crash detected: ${process.processName}`,
      detail
    };
  }

  private parseNativeCrash(line: string, detail: string): AndroidStabilityEvent | undefined {
    if (!/(?:Fatal\s+)?signal\s+\d+/i.test(line) || !/(?:\bDEBUG\b|\blibc\b|Fatal\s+signal)/i.test(detail)) {
      return undefined;
    }

    const process = this.parseNativeProcess(detail);
    if (!process || !this.isTargetProcess(process.processName)) {
      return undefined;
    }

    return {
      type: "native_crash",
      severity: "error",
      occurredAt: nowIso(),
      processName: process.processName,
      pid: process.pid,
      summary: `Native crash detected: ${process.processName}`,
      detail
    };
  }

  private parseAnr(line: string, detail: string): AndroidStabilityEvent | undefined {
    const match = line.match(/\bANR in\s+([^\s(]+)/);
    const processName = match?.[1]?.replace(/[,:]$/, "");
    if (!processName || !this.isTargetProcess(processName)) {
      return undefined;
    }

    return {
      type: "anr",
      severity: "error",
      occurredAt: nowIso(),
      processName,
      summary: `ANR detected: ${processName}`,
      detail
    };
  }

  private parseProcessDeath(line: string, detail: string): AndroidStabilityEvent | undefined {
    if (!/\b(?:Killing|killed|died|am_proc_died|am_kill)\b/i.test(line)) {
      return undefined;
    }

    const process = parseProcessDeathLine(line);
    if (!process || !this.isTargetProcess(process.processName)) {
      return undefined;
    }

    return {
      type: "process_death",
      severity: "warning",
      occurredAt: nowIso(),
      processName: process.processName,
      pid: process.pid,
      summary: `Process death detected: ${process.processName}`,
      detail
    };
  }

  private parseNativeProcess(detail: string): { processName: string; pid?: number } | undefined {
    const tombstoneProcess = [...detail.matchAll(/>>>\s*([^<]+?)\s*<</g)]
      .map((match) => match[1].trim())
      .reverse()
      .find((processName) => this.isTargetProcess(processName));
    if (tombstoneProcess) {
      return {
        processName: tombstoneProcess,
        pid: parseFirstNumber(detail, /\bpid:\s*(\d+)/i) ?? parseFirstNumber(detail, /\bpid\s+(\d+)\b/i)
      };
    }

    const libcProcess = detail.match(/\bpid\s+(\d+)\s+\(([^)]+)\)/i);
    if (libcProcess && this.isTargetProcess(libcProcess[2])) {
      return {
        pid: Number(libcProcess[1]),
        processName: libcProcess[2]
      };
    }

    const namedProcess = [...detail.matchAll(/\bname:\s*([^\s]+)/gi)]
      .map((match) => match[1])
      .reverse()
      .find((processName) => this.isTargetProcess(processName));
    if (namedProcess) {
      return {
        processName: namedProcess,
        pid: parseFirstNumber(detail, /\bpid:\s*(\d+)/i)
      };
    }

    return undefined;
  }

  private isTargetProcess(processName: string | undefined): boolean {
    return processName === this.packageName || !!processName?.startsWith(`${this.packageName}:`);
  }

  private dedupe(event: AndroidStabilityEvent): AndroidStabilityEvent | undefined {
    const key = `${event.type}:${event.processName ?? ""}:${event.summary}`;
    const now = Date.now();
    const lastEmittedAt = this.emittedAtByKey.get(key);
    if (lastEmittedAt !== undefined && now - lastEmittedAt < this.dedupeWindowMs) {
      return undefined;
    }
    this.emittedAtByKey.set(key, now);
    return event;
  }
}

function buildDetail(line: string, recentLines: string[]): string {
  const detailLines = recentLines.map((item) => item.trim()).filter(Boolean);
  const currentLine = line.trim();
  if (currentLine && detailLines[detailLines.length - 1] !== currentLine) {
    detailLines.push(currentLine);
  }
  return detailLines.join("\n");
}

function parseProcessDeathLine(line: string): { processName: string; pid?: number } | undefined {
  const diedMatch = line.match(/\bProcess\s+([^\s(]+)\s+\(pid\s+(\d+)\)\s+has died\b/i);
  if (diedMatch) {
    return {
      processName: diedMatch[1],
      pid: Number(diedMatch[2])
    };
  }

  const killingMatch = line.match(/\bKilling\s+(\d+):([^/\s]+)/i);
  if (killingMatch) {
    return {
      pid: Number(killingMatch[1]),
      processName: killingMatch[2]
    };
  }

  const eventsMatch = line.match(/\b(?:am_proc_died|am_kill)\b.*\[[^,\]]*,\s*(\d+),\s*([^,\]]+)/i);
  if (eventsMatch) {
    return {
      pid: Number(eventsMatch[1]),
      processName: eventsMatch[2].trim()
    };
  }

  const processRecordMatch = line.match(/\bProcessRecord\{[^}]*\s(\d+):([^/\s]+)\/[^}]*\}.*\bdied\b/i);
  if (processRecordMatch) {
    return {
      pid: Number(processRecordMatch[1]),
      processName: processRecordMatch[2]
    };
  }

  return undefined;
}

function parseFirstNumber(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}
