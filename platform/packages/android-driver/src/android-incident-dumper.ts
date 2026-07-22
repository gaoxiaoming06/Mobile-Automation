import { type AndroidProcessInfo } from "@mobile-automation/shared";
import { type AndroidShellExecutor } from "./android-actions.js";

export type AndroidIncidentArtifactWriter = (runId: string, fileName: string, content: string) => Promise<{ id: string }>;

export type AndroidIncidentDumperOptions = {
  shell: AndroidShellExecutor;
  writeTextArtifact: AndroidIncidentArtifactWriter;
};

export type AndroidMemoryIncidentOptions = {
  enableHeapDump: boolean;
};

const cpuCommandTimeoutMs = 10000;
const meminfoCommandTimeoutMs = 12000;
const heapDumpCommandTimeoutMs = 60000;

export class AndroidIncidentDumper {
  constructor(private readonly options: AndroidIncidentDumperOptions) {}

  async dumpCpuIncident(runId: string, serial: string, process: AndroidProcessInfo): Promise<string[]> {
    const topArgs = ["top", "-H", "-b", "-n", "1", "-p", String(process.pid)];
    const sections = [formatProcessHeader("CPU incident", serial, process)];

    try {
      const topOutput = await this.options.shell(serial, topArgs, { timeoutMs: cpuCommandTimeoutMs });
      sections.push(formatCommandSuccess(topArgs, topOutput));
    } catch (error) {
      sections.push(formatCommandFailure(topArgs, error));
      const fallbackArgs = createTaskFallbackArgs(process.pid);
      try {
        const fallbackOutput = await this.options.shell(serial, fallbackArgs, { timeoutMs: cpuCommandTimeoutMs });
        sections.push("top -H failed; captured /proc task fallback instead.");
        sections.push(formatCommandSuccess(fallbackArgs, fallbackOutput));
      } catch (fallbackError) {
        sections.push("top -H failed and /proc task fallback also failed.");
        sections.push(formatCommandFailure(fallbackArgs, fallbackError));
      }
    }

    const artifactId = await this.writeTextArtifactSafely(
      runId,
      `android-cpu-incident-${artifactToken(process.processName)}-${process.pid}-${Date.now()}.txt`,
      sections.join("\n\n")
    );
    return artifactId ? [artifactId] : [];
  }

  async dumpMemoryIncident(
    runId: string,
    serial: string,
    process: AndroidProcessInfo,
    options: AndroidMemoryIncidentOptions
  ): Promise<string[]> {
    const artifactIds: string[] = [];
    const meminfoArgs = ["dumpsys", "meminfo", "-d", String(process.pid)];
    const meminfoSections = [formatProcessHeader("Memory incident", serial, process)];

    try {
      const meminfoOutput = await this.options.shell(serial, meminfoArgs, { timeoutMs: meminfoCommandTimeoutMs });
      meminfoSections.push(formatCommandSuccess(meminfoArgs, meminfoOutput));
    } catch (error) {
      meminfoSections.push(formatCommandFailure(meminfoArgs, error));
    }

    const meminfoArtifactId = await this.writeTextArtifactSafely(
      runId,
      `android-memory-incident-${artifactToken(process.processName)}-${process.pid}-${Date.now()}.txt`,
      meminfoSections.join("\n\n")
    );
    if (meminfoArtifactId) {
      artifactIds.push(meminfoArtifactId);
    }

    if (!options.enableHeapDump) {
      return artifactIds;
    }

    const remotePath = `/sdcard/mobile_automation_${artifactToken(runId)}_${process.pid}_${Date.now()}.hprof`;
    const dumpheapArgs = ["am", "dumpheap", String(process.pid), remotePath];
    const dumpheapSections = [
      formatProcessHeader("Heap dump incident", serial, process),
      `Remote heap dump path: ${remotePath}`,
      "The first implementation records the dumpheap command result only; it does not pull the hprof file."
    ];
    try {
      const dumpheapOutput = await this.options.shell(serial, dumpheapArgs, { timeoutMs: heapDumpCommandTimeoutMs });
      dumpheapSections.push(formatCommandSuccess(dumpheapArgs, dumpheapOutput));
    } catch (error) {
      dumpheapSections.push(formatCommandFailure(dumpheapArgs, error));
    }

    const dumpheapArtifactId = await this.writeTextArtifactSafely(
      runId,
      `android-heapdump-incident-${artifactToken(process.processName)}-${process.pid}-${Date.now()}.txt`,
      dumpheapSections.join("\n\n")
    );
    if (dumpheapArtifactId) {
      artifactIds.push(dumpheapArtifactId);
    }
    return artifactIds;
  }

  private async writeTextArtifactSafely(runId: string, fileName: string, content: string): Promise<string | undefined> {
    try {
      const artifact = await this.options.writeTextArtifact(runId, fileName, content);
      return artifact.id;
    } catch {
      return undefined;
    }
  }
}

function createTaskFallbackArgs(pid: number): string[] {
  const script = [
    `for task in /proc/${pid}/task/*; do`,
    'tid="${task##*/}";',
    'echo "===== ${task}/status =====";',
    'cat "${task}/status" 2>&1;',
    'echo "===== ${task}/stat =====";',
    'cat "${task}/stat" 2>&1;',
    "done"
  ].join(" ");
  return ["sh", "-c", script];
}

function formatProcessHeader(title: string, serial: string, process: AndroidProcessInfo): string {
  return [
    title,
    `Device serial: ${serial}`,
    `Process: ${process.processName}`,
    `Package: ${process.packageName}`,
    `PID: ${process.pid}`,
    `Main process: ${process.isMainProcess ? "yes" : "no"}`,
    `Discovered at: ${process.discoveredAt}`
  ].join("\n");
}

function formatCommandSuccess(args: string[], output: string): string {
  return [`$ ${commandToString(args)}`, output.trim() || "(command completed with no output)"].join("\n");
}

function formatCommandFailure(args: string[], error: unknown): string {
  return [`$ ${commandToString(args)}`, `FAILED: ${errorMessage(error)}`].join("\n");
}

function commandToString(args: string[]): string {
  return args.join(" ");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  return String(error);
}

function artifactToken(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
