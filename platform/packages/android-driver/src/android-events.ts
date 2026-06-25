import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { nowIso } from "@mobile-automation/shared";
import { formatLogcatSince, parseAndroidLogEvent, type AndroidObservedDeviceEvent } from "./android-parsers.js";

export type AndroidDeviceEventWatcher = {
  stop(): Promise<void>;
};

export type AndroidWatchDeviceEventOptions = {
  since?: Date;
};

export class AndroidLogcatEventWatcher {
  async watchDeviceEvents(
    serial: string,
    onEvent: (event: AndroidObservedDeviceEvent) => void,
    options: AndroidWatchDeviceEventOptions = {}
  ): Promise<AndroidDeviceEventWatcher> {
    const since = options.since ?? new Date(Date.now() - 3000);
    const process = spawn("adb", ["-s", serial, "logcat", "-v", "time", "-T", formatLogcatSince(since)], {
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
        const event = parseAndroidLogEvent(trimmed, recentLines);
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
