import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceInfo,
  type InstalledAppInfo,
  type MetricSample,
  type AndroidAppMonitorConfig,
  type ToolStatus,
  nowIso
} from "@mobile-automation/shared";
import {
  AndroidActionExecutor,
  createAndroidActionBackendFromEnv,
  type AndroidActionBackend,
  type AndroidShellExecutor,
  type ExecTextOptions
} from "./android-actions.js";
import { AndroidDeviceDiscovery } from "./android-discovery.js";
import { AndroidLogcatEventWatcher, type AndroidDeviceEventWatcher, type AndroidWatchDeviceEventOptions } from "./android-events.js";
import {
  AndroidAppMonitorSession,
  type AndroidAppMonitorCallbacks,
  type AndroidAppMonitorSessionOptions
} from "./android-app-monitor.js";
import { AndroidMetricSampler } from "./android-metrics.js";
import { AndroidVideoRecorder, type VideoRecording } from "./android-video.js";
import { parseForegroundApp, parsePackageInfo, type AndroidForegroundApp } from "./android-parsers.js";

export type { AndroidDeviceEventWatcher, AndroidWatchDeviceEventOptions } from "./android-events.js";
export {
  AndroidAppMonitorSession,
  type AndroidAppMonitorCallbacks,
  type AndroidAppMonitorClock,
  type AndroidAppMonitorSampleKind,
  type AndroidAppMonitorSessionOptions
} from "./android-app-monitor.js";
export type { AndroidForegroundApp } from "./android-parsers.js";
export { AndroidIncidentDumper, type AndroidIncidentArtifactWriter, type AndroidIncidentDumperOptions } from "./android-incident-dumper.js";
export {
  AndroidStabilityEventParser,
  type AndroidStabilityEvent,
  type AndroidStabilityEventParserOptions
} from "./android-stability-events.js";
export {
  AndroidProcessMetricSampler,
  parseAppSummary,
  parseProcessCpuStat,
  parseSystemCpuStat,
  parseTotalPssKb,
  type AndroidProcessAppSummary,
  type AndroidProcessMetricSamplerOptions,
  type ParsedProcessCpuStat,
  type ParsedSystemCpuStat
} from "./android-process-metrics.js";
export {
  AndroidProcessDiscovery,
  isPackageProcess,
  matchesProcessFilter,
  parsePsOutput,
  type AndroidProcessDiscoveryFilter
} from "./android-process-discovery.js";
export { ThresholdTracker, type ThresholdBreach } from "./android-thresholds.js";
export type { VideoRecording } from "./android-video.js";

type AndroidDriverOptions = {
  shell?: AndroidShellExecutor;
  actionBackend?: AndroidActionBackend;
  appMonitor?: Pick<AndroidAppMonitorSessionOptions, "setInterval" | "clearInterval" | "sleep" | "watcher">;
};

type ExecBufferOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
};

export type ScrcpyControlSession = {
  id: string;
  serial: string;
  processId?: number;
  startedAt: string;
  status: "running" | "exited";
  exitCode?: number | null;
};

export class AndroidDriver {
  private readonly scrcpySessions = new Map<string, ScrcpyControlSession & { process: ChildProcessWithoutNullStreams }>();
  private readonly actions: AndroidActionExecutor;
  private readonly discovery: AndroidDeviceDiscovery;
  private readonly events = new AndroidLogcatEventWatcher();
  private readonly metrics: AndroidMetricSampler;
  private readonly video: AndroidVideoRecorder;

  constructor(private readonly options: AndroidDriverOptions = {}) {
    this.actions = new AndroidActionExecutor({
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions),
      semanticBackend: options.actionBackend ?? createAndroidActionBackendFromEnv()
    });
    this.discovery = new AndroidDeviceDiscovery({
      listAdbDevices: () => adbText(["devices", "-l"]),
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions),
      supportsVideoRecording: (serial) => this.supportsVideoRecording(serial)
    });
    this.metrics = new AndroidMetricSampler({
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions)
    });
    this.video = new AndroidVideoRecorder({
      shell: (serial, args, shellOptions) => this.shell(serial, args, shellOptions)
    });
  }

  async getToolStatus(): Promise<ToolStatus[]> {
    const adbVersion = await commandVersion("adb", ["version"]);
    const scrcpyVersion = await commandVersion("scrcpy", ["--version"]);
    const ffmpegVersion = await commandVersion("ffmpeg", ["-version"]);
    return [
      {
        name: "adb",
        ...adbVersion
      },
      {
        name: "scrcpy",
        ...scrcpyVersion
      },
      {
        name: "ffmpeg",
        ...ffmpegVersion
      }
    ];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return this.discovery.listDevices();
  }

  async getDeviceInfo(serial: string, details = ""): Promise<DeviceInfo> {
    return this.discovery.getDeviceInfo(serial, details);
  }

  async screenshot(serial: string): Promise<Buffer> {
    return adbBuffer(["-s", serial, "exec-out", "screencap", "-p"], {
      timeoutMs: 10000,
      maxBuffer: 50 * 1024 * 1024
    });
  }

  async dumpUiHierarchy(serial: string): Promise<string> {
    const remotePath = `/sdcard/mobile_automation_window_${Date.now()}.xml`;
    try {
      await this.dumpUiHierarchyToPath(serial, remotePath);
      const xml = await this.shell(serial, ["cat", remotePath], { timeoutMs: 12000 });
      if (!xml.includes("<hierarchy")) {
        throw new Error(xml.trim() || "uiautomator dump did not return XML hierarchy");
      }
      return xml;
    } finally {
      await this.shell(serial, ["rm", "-f", remotePath], { timeoutMs: 5000 }).catch(() => undefined);
    }
  }

  private async dumpUiHierarchyToPath(serial: string, remotePath: string): Promise<void> {
    try {
      await this.shell(serial, ["uiautomator", "dump", "--compressed", remotePath], { timeoutMs: 12000 });
    } catch {
      await this.shell(serial, ["uiautomator", "dump", remotePath], { timeoutMs: 12000 });
    }
  }

  async getForegroundApp(serial: string): Promise<AndroidForegroundApp> {
    const activityState = await this.shell(serial, ["dumpsys", "activity", "activities"], { timeoutMs: 8000 }).catch(() => "");
    const fromActivity = parseForegroundApp(activityState);
    if (fromActivity.componentName) {
      return fromActivity;
    }
    const windowState = await this.shell(serial, ["dumpsys", "window", "windows"], { timeoutMs: 8000 }).catch(() => "");
    return parseForegroundApp(windowState);
  }

  async getInstalledAppInfo(serial: string, packageName: string): Promise<InstalledAppInfo> {
    const output = await this.shell(serial, ["dumpsys", "package", packageName], { timeoutMs: 10000 });
    const info = parsePackageInfo(output, packageName);
    if (!info) {
      throw new Error(`Installed package not found or version unavailable: ${packageName}`);
    }
    return info;
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "screenshot") {
      await this.screenshot(serial);
      return {
        driverChannel: "adb_input"
      };
    }
    return this.actions.performAction(serial, action);
  }

  async performSemanticAction(serial: string, action: Parameters<AndroidActionExecutor["performSemanticAction"]>[1]): Promise<DeviceActionResult> {
    return this.actions.performSemanticAction(serial, action);
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    await this.actions.clearAppData(serial, packageName);
  }

  async collectLogs(serial: string, lines = 400): Promise<string> {
    return this.shell(serial, ["logcat", "-d", "-t", String(lines)], { timeoutMs: 12000 });
  }

  async watchDeviceEvents(
    serial: string,
    onEvent: Parameters<AndroidLogcatEventWatcher["watchDeviceEvents"]>[1],
    options: AndroidWatchDeviceEventOptions = {}
  ): Promise<AndroidDeviceEventWatcher> {
    return this.events.watchDeviceEvents(serial, onEvent, options);
  }

  async startScrcpyControl(serial: string): Promise<ScrcpyControlSession> {
    if (!(await commandAvailable("scrcpy"))) {
      throw new Error("scrcpy is not installed or not available in PATH");
    }

    const existing = this.scrcpySessions.get(serial);
    if (existing && existing.status === "running" && !existing.process.killed) {
      return stripProcess(existing);
    }

    const sessionId = `scrcpy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const process = spawn(
      "scrcpy",
      [
        "--serial",
        serial,
        "--stay-awake",
        "--max-size",
        "1600",
        "--video-bit-rate",
        "8M",
        "--no-audio",
        "--window-title",
        `Mobile Automation ${serial}`
      ],
      { stdio: "pipe" }
    );
    const session: ScrcpyControlSession & { process: ChildProcessWithoutNullStreams } = {
      id: sessionId,
      serial,
      processId: process.pid,
      startedAt: nowIso(),
      status: "running",
      process
    };
    this.scrcpySessions.set(serial, session);

    process.once("exit", (code) => {
      session.status = "exited";
      session.exitCode = code;
    });

    await sleep(500);
    if (session.status === "exited") {
      const stderr = await readBufferedStderr(process);
      throw new Error(stderr || "scrcpy exited immediately");
    }

    return stripProcess(session);
  }

  async stopScrcpyControl(serial: string): Promise<boolean> {
    const session = this.scrcpySessions.get(serial);
    if (!session) {
      return false;
    }
    if (session.status === "running") {
      await stopProcess(session.process);
    }
    this.scrcpySessions.delete(serial);
    return true;
  }

  listScrcpyControlSessions(): ScrcpyControlSession[] {
    return Array.from(this.scrcpySessions.values()).map(stripProcess);
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    return this.metrics.samplePerformance(serial, runId, stepResultId);
  }

  async startAppMonitor(
    serial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    writeTextArtifact: AndroidAppMonitorSessionOptions["writeTextArtifact"],
    callbacks: AndroidAppMonitorCallbacks = {}
  ): Promise<AndroidAppMonitorSession> {
    const session = new AndroidAppMonitorSession({
      serial,
      runId,
      config,
      shell: (deviceSerial, args, shellOptions) => this.shell(deviceSerial, args, shellOptions),
      writeTextArtifact,
      ...callbacks,
      ...this.options.appMonitor
    });
    await session.start();
    return session;
  }

  async startVideoRecording(serial: string, runId: string, localDir: string): Promise<VideoRecording> {
    return this.video.startVideoRecording(serial, runId, localDir);
  }

  async stopVideoRecording(recording: VideoRecording, keep: boolean): Promise<string | undefined> {
    return this.video.stopVideoRecording(recording, keep);
  }

  private async shell(serial: string, args: string[], options: ExecTextOptions = {}): Promise<string> {
    if (this.options.shell) {
      return this.options.shell(serial, args, options);
    }
    return adbText(["-s", serial, "shell", ...args], options);
  }

  private async supportsVideoRecording(serial: string): Promise<boolean> {
    return this.video.supportsVideoRecording(serial);
  }
}

function stripProcess(session: ScrcpyControlSession & { process: ChildProcessWithoutNullStreams }): ScrcpyControlSession {
  return {
    id: session.id,
    serial: session.serial,
    processId: session.processId,
    startedAt: session.startedAt,
    status: session.status,
    exitCode: session.exitCode
  };
}

function commandVersion(command: string, args: string[]): Promise<Omit<ToolStatus, "name">> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ available: false });
        return;
      }
      resolve({
        available: true,
        version: (stdout || stderr).split(/\r?\n/).find(Boolean)?.trim()
      });
    });
  });
}

async function commandAvailable(command: string): Promise<boolean> {
  return (await commandVersion(command, ["--version"])).available;
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

function adbBuffer(args: string[], options: ExecBufferOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "adb",
      args,
      { timeout: options.timeoutMs ?? 15000, encoding: "buffer", maxBuffer: options.maxBuffer ?? 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const message = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr).trim();
          reject(new Error(message || error.message));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      }
    );
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
