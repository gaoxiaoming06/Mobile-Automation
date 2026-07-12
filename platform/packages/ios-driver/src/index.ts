import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultIosCapabilities, type DeviceActionRequest, type DeviceActionResult, type DeviceInfo, type MetricSample, type ToolStatus, nowIso } from "@mobile-automation/shared";

type ExecTextOptions = {
  timeoutMs?: number;
  maxBuffer?: number;
};

type IosDeviceCandidate = {
  serial: string;
  name?: string;
  osVersion?: string;
  status: "online" | "offline";
};

type IosDisplayInfo = {
  resolution?: {
    width: number;
    height: number;
  };
  orientation?: "portrait" | "landscape";
};

type WdaSession = {
  url: string;
  sessionId: string;
};

type WdaProbe = {
  url?: string;
  reachable: boolean;
  configuredBy: "env" | "auto" | "none";
  message?: string;
};

export type IosVideoRecording = {
  id: string;
  serial: string;
  localPath: string;
  startedAt: string;
};

export class IosDriver {
  private readonly wdaSessions = new Map<string, WdaSession>();

  async getToolStatus(): Promise<ToolStatus[]> {
    const [ideviceId, ideviceInfo, ideviceScreenshot, ideviceImageMounter, xcrun, wda] = await Promise.all([
      commandVersion("idevice_id", ["--version"]),
      commandVersion("ideviceinfo", ["--version"]),
      commandVersion("idevicescreenshot", ["--version"]),
      commandVersion("ideviceimagemounter", ["--version"]),
      commandVersion("xcrun", ["--version"]),
      this.probeWdaToolStatus()
    ]);

    return [
      { name: "idevice_id", ...ideviceId },
      { name: "ideviceinfo", ...ideviceInfo },
      { name: "idevicescreenshot", ...ideviceScreenshot },
      { name: "ideviceimagemounter", ...ideviceImageMounter },
      { name: "xcrun", ...xcrun },
      wda
    ];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const [online, xctrace] = await Promise.all([this.listOnlineDevices(), listXctraceDevices().catch(() => [])]);
    const bySerial = new Map<string, IosDeviceCandidate>();

    for (const device of xctrace) {
      bySerial.set(device.serial, device);
    }
    for (const device of online) {
      bySerial.set(device.serial, {
        ...bySerial.get(device.serial),
        ...device,
        status: "online"
      });
    }

    const devices = await Promise.all(Array.from(bySerial.values(), (device: IosDeviceCandidate) => this.toDeviceInfo(device)));
    return devices.filter((device) => device.id.length > 0);
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    const candidate: IosDeviceCandidate = {
      serial,
      status: "online"
    };
    return this.toDeviceInfo(candidate);
  }

  async screenshot(serial: string): Promise<Buffer> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-ios-screenshot-"));
    const filePath = path.join(tmpDir, `${serial}.png`);
    try {
      await execText("idevicescreenshot", ["--udid", serial, filePath], { timeoutMs: 20000, maxBuffer: 4 * 1024 * 1024 });
      return await readFile(filePath);
    } catch (error) {
      const wda = await this.probeWdaFor(serial);
      if (wda.reachable) {
        return this.wdaScreenshot(serial);
      }
      const detail = describeScreenshotFailure(error);
      throw new Error(`iOS screenshot failed through idevicescreenshot and WDA is unavailable: ${detail}`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult> {
    if (action.type === "wait") {
      await sleep(action.durationMs);
      return wdaActionResult();
    }
    if (action.type === "screenshot") {
      await this.screenshot(serial);
      return wdaActionResult();
    }
    if (action.type === "back") {
      return wdaActionResult();
    }

    const session = await this.ensureWdaSession(serial);
    if (action.type === "hide_keyboard") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/keyboard/dismiss`, {}).catch(() => undefined);
      return wdaActionResult();
    }
    if (action.type === "tap") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/tap/0`, { x: action.x, y: action.y });
      return wdaActionResult();
    }
    if (action.type === "long_press") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/touchAndHold`, {
        x: action.x,
        y: action.y,
        duration: (action.durationMs ?? 800) / 1000
      });
      return wdaActionResult();
    }
    if (action.type === "swipe") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/dragfromtoforduration`, {
        fromX: action.startX,
        fromY: action.startY,
        toX: action.endX,
        toY: action.endY,
        duration: (action.durationMs ?? 450) / 1000
      });
      return wdaActionResult();
    }
    if (action.type === "home") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/homescreen`, {});
      return wdaActionResult();
    }
    if (action.type === "input_text") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/keys`, { value: [action.text] });
      return wdaActionResult();
    }
    if (action.type === "launch_app") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/apps/launch`, { bundleId: action.packageName });
      return wdaActionResult();
    }
    if (action.type === "close_app") {
      await wdaRequest(session, "POST", `/session/${session.sessionId}/wda/apps/terminate`, { bundleId: action.packageName });
      return wdaActionResult();
    }

    throw new Error(`iOS action is not supported yet: ${action.type}`);
  }

  async collectLogs(_serial: string, _lines = 400): Promise<string> {
    return "";
  }

  async samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample> {
    const battery = await this.readDeviceValue(serial, "BatteryCurrentCapacity").catch(() => "");
    return {
      id: `metric_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      runId,
      stepResultId,
      deviceSerial: serial,
      sampledAt: nowIso(),
      batteryLevel: Number.isFinite(Number(battery.trim())) ? Number(battery.trim()) : undefined,
      raw: {
        platform: "ios"
      }
    };
  }

  async startVideoRecording(serial: string, _runId: string, _localDir: string): Promise<IosVideoRecording> {
    throw new Error(`iOS video recording is not implemented yet for ${serial}`);
  }

  async stopVideoRecording(_recording: IosVideoRecording, _keep: boolean): Promise<string | undefined> {
    return undefined;
  }

  private async listOnlineDevices(): Promise<IosDeviceCandidate[]> {
    const output = await execText("idevice_id", ["--list"], { timeoutMs: 8000 }).catch(() => "");
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((serial) => ({
        serial,
        status: "online" as const
      }));
  }

  private async toDeviceInfo(candidate: IosDeviceCandidate): Promise<DeviceInfo> {
    const wda = candidate.status === "online" ? await this.probeWdaFor(candidate.serial) : { reachable: false };
    const [name, productType, osVersion, displayInfo] =
      candidate.status === "online"
        ? await Promise.all([
            this.readDeviceValue(candidate.serial, "DeviceName").catch(() => ""),
            this.readDeviceValue(candidate.serial, "ProductType").catch(() => ""),
            this.readDeviceValue(candidate.serial, "ProductVersion").catch(() => ""),
            this.readDisplayInfo(candidate.serial).catch((): IosDisplayInfo => ({}))
          ])
        : [candidate.name ?? "", "", candidate.osVersion ?? "", {} as IosDisplayInfo];

    return {
      id: candidate.serial,
      serial: candidate.serial,
      platform: "ios",
      name: name.trim() || candidate.name || candidate.serial,
      model: productType.trim() || undefined,
      manufacturer: "Apple",
      osVersion: osVersion.trim() || candidate.osVersion,
      resolution: displayInfo.resolution,
      orientation: displayInfo.orientation,
      status: candidate.status,
      capabilities: defaultIosCapabilities({
        screenshot: candidate.status === "online",
        control: wda.reachable,
        recordVideo: false
      }),
      lastSeenAt: nowIso()
    };
  }

  private async readDeviceValue(serial: string, key: string): Promise<string> {
    return execText("ideviceinfo", ["--udid", serial, "--key", key], { timeoutMs: 8000 });
  }

  private async readDisplayInfo(serial: string): Promise<IosDisplayInfo> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-ios-display-"));
    const jsonPath = path.join(tmpDir, `${serial}.json`);
    try {
      await execText(
        "xcrun",
        ["devicectl", "device", "info", "displays", "--device", serial, "--timeout", "5", "--json-output", jsonPath, "--quiet"],
        { timeoutMs: 9000, maxBuffer: 2 * 1024 * 1024 }
      );
      return parseDevicectlDisplays(await readFile(jsonPath, "utf8"));
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async ensureWdaSession(serial: string): Promise<WdaSession> {
    const cached = this.wdaSessions.get(serial);
    if (cached) {
      return cached;
    }

    const url = wdaEndpointFor(serial)?.url;
    if (!url) {
      throw new Error(
        `WDA endpoint is not configured for iOS device ${serial}. Set IOS_WDA_URL / IOS_WDA_URL_<UDID>, or run WDA on http://localhost:8100.`
      );
    }

    await wdaRequest({ url }, "GET", "/status");
    const response = await wdaRequest<{ value?: { sessionId?: string }; sessionId?: string }>({ url }, "POST", "/session", {
      capabilities: {}
    });
    const sessionId = response.value?.sessionId ?? response.sessionId;
    if (!sessionId) {
      throw new Error(`WDA did not return a session id for ${serial}`);
    }

    const session = { url, sessionId };
    this.wdaSessions.set(serial, session);
    return session;
  }

  private async wdaScreenshot(serial: string): Promise<Buffer> {
    const session = await this.ensureWdaSession(serial);
    const response = await wdaRequest<{ value?: string; screenshot?: string }>(session, "GET", `/session/${session.sessionId}/screenshot`);
    const base64 = response.value ?? response.screenshot;
    if (!base64) {
      throw new Error(`WDA screenshot did not return image data for ${serial}`);
    }
    return Buffer.from(base64.replace(/^data:image\/png;base64,/, ""), "base64");
  }

  private async probeWdaFor(serial: string): Promise<WdaProbe> {
    const endpoint = wdaEndpointFor(serial);
    if (!endpoint) {
      return { reachable: false, configuredBy: "none" };
    }
    return probeWdaEndpoint(endpoint.url, endpoint.configuredBy);
  }

  private async probeWdaToolStatus(): Promise<ToolStatus> {
    const endpoint = wdaEndpointFor("");
    if (!endpoint) {
      return { name: "wda", available: false };
    }
    const probe = await probeWdaEndpoint(endpoint.url, endpoint.configuredBy);
    return {
      name: "wda",
      available: probe.reachable,
      version: probe.reachable ? `reachable at ${probe.url}` : `${probe.configuredBy === "auto" ? "not reachable" : "configured but unreachable"} at ${probe.url}`
    };
  }
}

function listXctraceDevices(): Promise<IosDeviceCandidate[]> {
  return execText("xcrun", ["xctrace", "list", "devices"], { timeoutMs: 12000, maxBuffer: 4 * 1024 * 1024 }).then(parseXctraceDevices);
}

export function parseXctraceDevices(output: string): IosDeviceCandidate[] {
  const candidates: IosDeviceCandidate[] = [];
  let inDeviceSection = false;
  let offline = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("== Simulators ==")) {
      break;
    }
    if (line.startsWith("== Devices Offline ==")) {
      inDeviceSection = true;
      offline = true;
      continue;
    }
    if (line.startsWith("== Devices ==")) {
      inDeviceSection = true;
      offline = false;
      continue;
    }
    if (line.startsWith("==")) {
      inDeviceSection = false;
      continue;
    }
    if (!inDeviceSection) {
      continue;
    }

    const match = line.match(/^(.+?)(?:\s+\(([\d.]+)\))?\s+\(([0-9A-Fa-f-]{20,})\)$/);
    if (!match) {
      continue;
    }

    const name = match[1].trim();
    const osVersion = match[2];
    if (!isIosPhysicalDeviceLine(name, osVersion)) {
      continue;
    }

    candidates.push({
      name,
      osVersion,
      serial: match[3],
      status: offline ? "offline" : "online"
    });
  }
  return candidates;
}

export function parseDevicectlDisplays(jsonText: string): IosDisplayInfo {
  const payload = JSON.parse(jsonText) as {
    result?: {
      displays?: Array<{
        nativeSize?: [number, number];
        bounds?: [[number, number], [number, number]];
        primary?: boolean;
      }>;
      orientation?: {
        currentDeviceOrientation?: string;
        currentDeviceNonFlatOrientation?: string;
      };
    };
  };
  const display = payload.result?.displays?.find((item) => item.primary) ?? payload.result?.displays?.[0];
  const size = display?.nativeSize ?? display?.bounds?.[1];
  const width = size?.[0];
  const height = size?.[1];
  const orientationText = payload.result?.orientation?.currentDeviceOrientation || payload.result?.orientation?.currentDeviceNonFlatOrientation;
  return {
    resolution: typeof width === "number" && typeof height === "number" ? { width, height } : undefined,
    orientation: orientationText?.includes("landscape") ? "landscape" : orientationText?.includes("portrait") ? "portrait" : undefined
  };
}

export function iosWdaEnvKey(serial: string): string {
  return `IOS_WDA_URL_${serial.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
}

export function wdaEndpointFor(serial: string): { url: string; configuredBy: "env" | "auto" } | undefined {
  const deviceUrl = serial ? process.env[iosWdaEnvKey(serial)] : undefined;
  if (deviceUrl) {
    return { url: deviceUrl, configuredBy: "env" };
  }
  if (process.env.IOS_WDA_URL) {
    return { url: process.env.IOS_WDA_URL, configuredBy: "env" };
  }
  if (process.env.IOS_WDA_AUTODETECT === "0") {
    return undefined;
  }
  return { url: process.env.IOS_WDA_DEFAULT_URL || "http://localhost:8100", configuredBy: "auto" };
}

function isIosPhysicalDeviceLine(name: string, osVersion: string | undefined): boolean {
  return Boolean(osVersion) || /\b(iPhone|iPad|iPod)\b/i.test(name);
}

async function wdaRequest<T = unknown>(session: Pick<WdaSession, "url">, method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(route, normalizeBaseUrl(session.url)), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  });
  const text = await response.text();
  const json = text ? parseJson<T & WdaErrorPayload>(text) : ({} as T & WdaErrorPayload);
  if (!response.ok) {
    const message = json.value?.message || json.message || response.statusText;
    throw new Error(`WDA ${method} ${route} failed: ${message}`);
  }
  return json;
}

async function probeWdaEndpoint(url: string, configuredBy: "env" | "auto"): Promise<WdaProbe> {
  try {
    await fetch(new URL("/status", normalizeBaseUrl(url)), {
      signal: AbortSignal.timeout(1500)
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(response.statusText);
      }
      await response.text();
    });
    return { url, reachable: true, configuredBy };
  } catch (error) {
    return {
      url,
      reachable: false,
      configuredBy,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

type WdaErrorPayload = {
  value?: {
    error?: string;
    message?: string;
  };
  message?: string;
};

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
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

function execText(command: string, args: string[], options: ExecTextOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeoutMs ?? 15000, encoding: "utf8", maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = [stderr, stdout]
          .map((item) => item.trim())
          .filter(Boolean)
          .join("\n");
        reject(new Error(message || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function describeScreenshotFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/screenshotr service|Developer disk image/i.test(message)) {
    return `${message} Install or mount the matching iOS Developer Disk Image for this device, or run WebDriverAgent and expose /status.`;
  }
  return message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function wdaActionResult(): DeviceActionResult {
  return {
    driverChannel: "appium"
  };
}
