import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@mobile-automation/shared";
import { type AndroidShellExecutor, type ExecTextOptions } from "./android-actions.js";

type AndroidVideoRecorderOptions = {
  shell: AndroidShellExecutor;
  sleep?: (ms: number) => Promise<void>;
};

export type VideoRecording = {
  id: string;
  serial: string;
  kind: "scrcpy" | "screenrecord";
  devicePath?: string;
  localPath: string;
  process: ChildProcessWithoutNullStreams;
  processGroupPid?: number;
  startedAt: string;
};

export class AndroidVideoRecorder {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: AndroidVideoRecorderOptions) {
    this.sleep = options.sleep ?? sleep;
  }

  async supportsVideoRecording(serial: string): Promise<boolean> {
    if (await this.supportsScreenrecord(serial).catch(() => false)) {
      return true;
    }
    return commandAvailable("scrcpy");
  }

  async startVideoRecording(serial: string, runId: string, localDir: string): Promise<VideoRecording> {
    await mkdir(localDir, { recursive: true });
    const fileName = `${runId}.mp4`;
    const localPath = path.join(localDir, fileName);

    if (await this.supportsScreenrecord(serial)) {
      const devicePath = `/sdcard/mobile-automation/${fileName}`;
      await this.shell(serial, ["mkdir", "-p", "/sdcard/mobile-automation"]).catch(() => undefined);
      await this.shell(serial, ["rm", "-f", devicePath]).catch(() => undefined);

      const process = spawn("adb", ["-s", serial, "shell", "screenrecord", "--bit-rate", "4000000", devicePath], {
        stdio: "pipe"
      });
      await this.sleep(800);
      if (process.exitCode !== null) {
        const stderr = await readBufferedStderr(process);
        throw new Error(stderr || "Android screenrecord exited immediately");
      }

      return {
        id: runId,
        serial,
        kind: "screenrecord",
        devicePath,
        localPath,
        process,
        startedAt: nowIso()
      };
    }

    if (!(await commandAvailable("scrcpy"))) {
      throw new Error("scrcpy is unavailable and Android screenrecord is unavailable on this device");
    }

    const process = spawn("scrcpy", ["--serial", serial, "--no-window", "--no-audio", "--record", localPath], {
      detached: true,
      stdio: "pipe"
    });
    await this.sleep(800);
    if (process.exitCode !== null) {
      const stderr = await readBufferedStderr(process);
      throw new Error(stderr || "scrcpy recording exited immediately");
    }

    return {
      id: runId,
      serial,
      kind: "scrcpy",
      localPath,
      process,
      processGroupPid: process.pid,
      startedAt: nowIso()
    };
  }

  async stopVideoRecording(recording: VideoRecording, keep: boolean): Promise<string | undefined> {
    await stopProcess(recording.process, { processGroupPid: recording.processGroupPid });

    if (recording.kind === "scrcpy") {
      if (!keep) {
        await rm(recording.localPath, { force: true }).catch(() => undefined);
        return undefined;
      }
      const info = await stat(recording.localPath);
      if (info.size <= 0) {
        throw new Error("scrcpy recording file is empty");
      }
      await validateVideoFile(recording.localPath);
      return recording.localPath;
    }

    if (!keep) {
      await this.shell(recording.serial, ["rm", "-f", recording.devicePath ?? ""]).catch(() => undefined);
      await rm(recording.localPath, { force: true }).catch(() => undefined);
      return undefined;
    }

    await adbText(["-s", recording.serial, "pull", recording.devicePath ?? "", recording.localPath], { timeoutMs: 30000 });
    await this.shell(recording.serial, ["rm", "-f", recording.devicePath ?? ""]).catch(() => undefined);
    await validateVideoFile(recording.localPath);
    return recording.localPath;
  }

  private async supportsScreenrecord(serial: string): Promise<boolean> {
    const output = await this.shell(serial, ["sh", "-c", "command -v screenrecord || ls /system/bin/screenrecord 2>/dev/null || true"], { timeoutMs: 5000 });
    if (!output.trim()) {
      return false;
    }
    const help = await this.shell(serial, ["sh", "-c", "screenrecord --help >/dev/null 2>&1; echo $?"], { timeoutMs: 5000 }).catch(() => "1");
    return help.trim() === "0";
  }

  private shell(serial: string, args: string[], options?: ExecTextOptions): Promise<string> {
    return this.options.shell(serial, args, options);
  }
}

function commandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, ["--version"], { timeout: 5000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error) => {
      resolve(!error);
    });
  });
}

function validateVideoFile(localPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stat(localPath)
      .then((info) => {
        if (info.size <= 0) {
          reject(new Error("video recording file is empty"));
          return;
        }
        execFile(
          "ffprobe",
          ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", localPath],
          { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 },
          (error) => {
            if (error) {
              if ("code" in error && error.code === "ENOENT") {
                resolve();
                return;
              }
              reject(new Error(`video recording is not playable: ${error.message}`));
              return;
            }
            resolve();
          }
        );
      })
      .catch(reject);
  });
}

function readBufferedStderr(process: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve) => {
    let content = "";
    process.stderr.on("data", (chunk: Buffer) => {
      content += chunk.toString("utf8");
    });
    setTimeout(() => resolve(content.trim()), 200);
  });
}

function adbText(args: string[], options: ExecTextOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("adb", args, { timeout: options.timeoutMs ?? 15000, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve([stdout, stderr].filter(Boolean).join("\n"));
    });
  });
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

type StopProcessOptions = {
  processGroupPid?: number;
};

async function stopProcess(child: ChildProcessWithoutNullStreams, options: StopProcessOptions = {}): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  signalProcess(child, "SIGINT", options.processGroupPid);
  await waitForProcess(child, 4000).catch(async () => {
    if (hasExited(child)) {
      return;
    }
    signalProcess(child, "SIGTERM", options.processGroupPid);
    await waitForProcess(child, 2000).catch(async () => {
      if (!hasExited(child)) {
        signalProcess(child, "SIGKILL", options.processGroupPid);
        await waitForProcess(child, 1000).catch(() => undefined);
      }
    });
  });
  await sleep(500);
}

function signalProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals, processGroupPid?: number): void {
  if (processGroupPid && processGroupPid > 0) {
    try {
      process.kill(-processGroupPid, signal);
      return;
    } catch {
      // Fall back to signaling the direct child when process groups are unavailable.
    }
  }
  child.kill(signal);
}

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
