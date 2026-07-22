import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { nowIso } from "@mobile-automation/shared";
import { formatLogcatSince, parseAndroidLogEvent, type AndroidObservedDeviceEvent } from "./android-parsers.js";
import { AndroidStabilityEventParser, type AndroidStabilityEvent } from "./android-stability-events.js";

export type AndroidDeviceEventWatcher = {
  stop(): Promise<void>;
};

export type AndroidWatchDeviceEventOptions = {
  since?: Date;
  packageName?: string;
};

export class AndroidLogcatEventWatcher {
  async watchDeviceEvents(
    serial: string,
    onEvent: (event: AndroidObservedDeviceEvent) => void,
    options: AndroidWatchDeviceEventOptions = {}
  ): Promise<AndroidDeviceEventWatcher> {
    const since = options.since ?? new Date(Date.now() - 3000);
    const stabilityParser = options.packageName ? new AndroidStabilityEventParser({ packageName: options.packageName }) : undefined;
    const process = spawn("adb", createLogcatArgs(serial, since, !!options.packageName), {
      stdio: "pipe"
    });
    let stopped = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const recentLines: string[] = [];
    const emittedAtByKey = new Map<string, number>();

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        recentLines.push(trimmed);
        if (recentLines.length > 80) {
          recentLines.shift();
        }
        const stabilityEvent = stabilityParser?.observe(trimmed, recentLines);
        const event = stabilityEvent
          ? mapStabilityEvent(stabilityEvent)
          : parseGenericLogEvent(trimmed, recentLines, !!stabilityParser);
        if (!event) {
          continue;
        }
        const eventKey = `${event.type}:${event.summary}`;
        const now = Date.now();
        const lastEmittedAt = emittedAtByKey.get(eventKey) ?? 0;
        if (now - lastEmittedAt < 1500) {
          continue;
        }
        emittedAtByKey.set(eventKey, now);
        onEvent(event);
      }
    });
    process.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });
    process.once("exit", (code) => {
      if (stopped || code === 0) {
        return;
      }
      onEvent({
        type: "command_failed",
        severity: "warning",
        occurredAt: nowIso(),
        summary: "Android logcat watcher exited",
        detail: stderrBuffer.trim() || `adb logcat exited with code ${code ?? "unknown"}`
      });
    });

    await sleep(150);
    if (process.exitCode !== null) {
      throw new Error(stderrBuffer.trim() || "adb logcat exited immediately");
    }

    return {
      stop: async () => {
        stopped = true;
        await stopProcess(process);
      }
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForProcess(process: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for process exit"));
    }, timeoutMs);

    process.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  child.kill("SIGINT");
  await waitForProcess(child, 4000).catch(async () => {
    if (hasExited(child)) {
      return;
    }
    child.kill("SIGTERM");
    await waitForProcess(child, 2000).catch(async () => {
      if (!hasExited(child)) {
        child.kill("SIGKILL");
        await waitForProcess(child, 1000).catch(() => undefined);
      }
    });
  });
  await sleep(500);
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function createLogcatArgs(serial: string, since: Date, includeTargetBuffers: boolean): string[] {
  if (!includeTargetBuffers) {
    return ["-s", serial, "logcat", "-v", "time", "-T", formatLogcatSince(since)];
  }
  return [
    "-s",
    serial,
    "logcat",
    "-v",
    "time",
    "-b",
    "main",
    "-b",
    "system",
    "-b",
    "events",
    "-b",
    "crash",
    "-T",
    formatLogcatSince(since)
  ];
}

function parseGenericLogEvent(line: string, recentLines: string[], suppressGenericStabilityEvents: boolean): AndroidObservedDeviceEvent | undefined {
  const event = parseAndroidLogEvent(line, recentLines);
  if (!event) {
    return undefined;
  }
  if (suppressGenericStabilityEvents && (event.type === "crash" || event.type === "anr")) {
    return undefined;
  }
  return event;
}

function mapStabilityEvent(event: AndroidStabilityEvent): AndroidObservedDeviceEvent {
  const type: AndroidObservedDeviceEvent["type"] = event.type === "java_crash" ? "crash" : event.type;
  return {
    type,
    severity: event.severity,
    occurredAt: event.occurredAt,
    processName: event.processName,
    pid: event.pid,
    summary: event.summary,
    detail: event.detail
  };
}
