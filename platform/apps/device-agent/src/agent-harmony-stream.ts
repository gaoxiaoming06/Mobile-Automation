import { execFile } from "node:child_process";
import { createServer, connect as netConnect, type Socket } from "node:net";
import type { DeviceInfo } from "@mobile-automation/shared";
import { WebSocket } from "ws";

export const harmonyStreamProtocolVersion = 1;
export const harmonyH264CodecId = 0x68_32_36_34;

const defaultHarmonyStreamBundleName = "com.mobileautomation.screenstream";
const localAuthorizedHarmonyStreamBundleName = "cn.eeo.hos.classin.mobile.autoverify";
const packetHeaderSize = 18;
const maxPacketPayloadBytes = 8 * 1024 * 1024;

type HarmonyStreamLaunchInput = {
  serial: string;
  localPort: number;
  devicePort: number;
  bundleName: string;
  abilityName: string;
};

export type HarmonyStreamLaunchPlan = {
  forwardArgs: string[];
  removeForwardArgs: string[];
  launchArgs: string[];
};

export type HarmonyParserMessage =
  | { kind: "text"; data: string }
  | { kind: "binary"; data: Buffer };

type AgentHarmonyStreamClientOptions = {
  bundleName?: string;
  abilityName?: string;
  devicePort?: number;
  minApiVersion?: number;
  connectTimeoutMs?: number;
  autoAuthorizeScreenShare?: boolean;
};

type AgentHarmonyStreamClientDeps = {
  runHdc?: (args: string[]) => Promise<string>;
  getFreePort?: () => Promise<number>;
  connectTcp?: (port: number) => Socket;
  sleep?: (ms: number) => Promise<void>;
};

export class AgentHarmonyStreamClient {
  private readonly options: Required<Omit<AgentHarmonyStreamClientOptions, "bundleName">> & { bundleNames: string[] };
  private readonly runHdc: (args: string[]) => Promise<string>;
  private readonly getFreePort: () => Promise<number>;
  private readonly connectTcp: (port: number) => Socket;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly sessions = new Map<string, HarmonyStreamSession>();

  constructor(options: AgentHarmonyStreamClientOptions = {}, deps: AgentHarmonyStreamClientDeps = {}) {
    const configuredBundleName = options.bundleName ?? process.env.HARMONY_STREAM_BUNDLE_NAME;
    this.options = {
      bundleNames: configuredBundleName
        ? [configuredBundleName]
        : [defaultHarmonyStreamBundleName, localAuthorizedHarmonyStreamBundleName],
      abilityName: options.abilityName ?? process.env.HARMONY_STREAM_ABILITY_NAME ?? "EntryAbility",
      devicePort: positiveInteger(options.devicePort ?? process.env.HARMONY_STREAM_DEVICE_PORT, 28282),
      minApiVersion: positiveInteger(options.minApiVersion ?? process.env.HARMONY_STREAM_MIN_API, 23),
      connectTimeoutMs: positiveInteger(options.connectTimeoutMs ?? process.env.HARMONY_STREAM_CONNECT_TIMEOUT_MS, 8000),
      autoAuthorizeScreenShare: booleanValue(options.autoAuthorizeScreenShare ?? process.env.HARMONY_STREAM_AUTO_AUTHORIZE, true)
    };
    this.runHdc = deps.runHdc ?? hdcText;
    this.getFreePort = deps.getFreePort ?? getFreeTcpPort;
    this.connectTcp = deps.connectTcp ?? ((port) => netConnect({ host: "127.0.0.1", port }));
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  canStream(device: DeviceInfo): boolean {
    if (device.platform !== "harmony") {
      return false;
    }
    const apiVersion = Number(device.osVersion);
    return Number.isFinite(apiVersion) ? apiVersion >= this.options.minApiVersion : true;
  }

  async connect(input: { serial: string; url: string }): Promise<void> {
    const socket = new WebSocket(input.url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    void this.attach(input.serial, socket);
  }

  async attach(serial: string, socket: WebSocket): Promise<void> {
    await this.closeSession(serial);
    await this.removeStaleHarmonyStreamForwards(serial);

    const localPort = await this.getFreePort();
    const forwardPlan = buildHarmonyStreamLaunchPlan({
      serial,
      localPort,
      devicePort: this.options.devicePort,
      bundleName: this.options.bundleNames[0],
      abilityName: this.options.abilityName
    });
    const session: HarmonyStreamSession = { socket, closed: false, removeForwardArgs: forwardPlan.removeForwardArgs };
    this.sessions.set(serial, session);

    const close = () => {
      void this.closeSessionInstance(serial, session);
    };
    socket.once("close", close);

    try {
      await this.runHdc(forwardPlan.forwardArgs);
      await this.launchAndForwardFirstAvailableBundle(serial, localPort, session);
    } catch (error) {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        }));
      }
    } finally {
      await this.closeSessionInstance(serial, session);
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.keys(), (serial) => this.closeSession(serial)));
  }

  isSerialStreaming(serial: string): boolean {
    return this.sessions.has(serial);
  }

  private async forwardTcpStream(
    serial: string,
    localPort: number,
    session: HarmonyStreamSession,
    options: { requireFirstMessage?: boolean } = {}
  ): Promise<void> {
    const tcp = this.connectTcp(localPort);
    session.tcp = tcp;
    const parser = new HarmonyH264StreamParser(serial);
    await waitForTcpConnect(tcp, this.options.connectTimeoutMs);
    if (this.options.autoAuthorizeScreenShare) {
      void this.authorizeScreenShare(serial);
    }

    await new Promise<void>((resolve, reject) => {
      let receivedMessage = false;
      const resolveTcpClose = () => {
        if (options.requireFirstMessage && !receivedMessage && !session.closed && session.socket.readyState === session.socket.OPEN) {
          reject(new Error("HarmonyOS screen stream companion closed before sending metadata"));
          return;
        }
        resolve();
      };
      tcp.on("data", (chunk: Buffer) => {
        try {
          for (const message of parser.push(chunk)) {
            receivedMessage = true;
            if (session.socket.readyState !== session.socket.OPEN) {
              continue;
            }
            session.socket.send(message.data, { binary: message.kind === "binary" });
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      tcp.once("close", resolveTcpClose);
      tcp.once("end", resolveTcpClose);
      tcp.once("error", reject);
      session.socket.once("close", resolve);
    });
  }

  private async closeSession(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (!session) {
      return;
    }
    await this.closeSessionInstance(serial, session);
  }

  private async closeSessionInstance(serial: string, session: HarmonyStreamSession): Promise<void> {
    if (session.cleanup) {
      await session.cleanup;
      return;
    }
    session.cleanup = Promise.resolve().then(() => this.cleanupSessionInstance(serial, session));
    await session.cleanup;
  }

  private async cleanupSessionInstance(serial: string, session: HarmonyStreamSession): Promise<void> {
    if (this.sessions.get(serial) === session) {
      this.sessions.delete(serial);
    }
    session.closed = true;
    session.tcp?.destroy();
    if (session.socket.readyState === session.socket.OPEN) {
      session.socket.close();
    }
    await this.runHdc(session.removeForwardArgs).catch(() => undefined);
  }

  private async removeStaleHarmonyStreamForwards(serial: string): Promise<void> {
    let output = "";
    try {
      output = await this.runHdc(["-t", serial, "fport", "ls"]);
    } catch {
      return;
    }
    const localPorts = parseHarmonyForwardLocalPorts(output, this.options.devicePort);
    await Promise.all(localPorts.map((localPort) => (
      this.runHdc(["-t", serial, "fport", "rm", `tcp:${localPort}`, `tcp:${this.options.devicePort}`]).catch(() => undefined)
    )));
  }

  private async launchAndForwardFirstAvailableBundle(serial: string, localPort: number, session: HarmonyStreamSession): Promise<void> {
    let lastError: unknown;
    if (await this.forwardAlreadyRunningCompanion(serial, localPort, session)) {
      return;
    }
    for (const bundleName of this.options.bundleNames) {
      try {
        const plan = buildHarmonyStreamLaunchPlan({
          serial,
          localPort,
          devicePort: this.options.devicePort,
          bundleName,
          abilityName: this.options.abilityName
        });
        const launchOutput = await this.runHdc(plan.launchArgs);
        const launchFailure = detectHarmonyStartFailure(launchOutput);
        if (launchFailure) {
          throw new Error(launchFailure);
        }
        if (session.closed || session.socket.readyState !== session.socket.OPEN) {
          return;
        }
        await this.forwardTcpStream(serial, localPort, session);
        return;
      } catch (error) {
        lastError = error;
        session.tcp?.destroy();
        session.tcp = undefined;
        if (session.closed || session.socket.readyState !== session.socket.OPEN) {
          return;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "No HarmonyOS screen stream companion bundle could be started"));
  }

  private async forwardAlreadyRunningCompanion(serial: string, localPort: number, session: HarmonyStreamSession): Promise<boolean> {
    try {
      await this.forwardTcpStream(serial, localPort, session, { requireFirstMessage: true });
      return true;
    } catch (error) {
      session.tcp?.destroy();
      session.tcp = undefined;
      if (session.closed || session.socket.readyState !== session.socket.OPEN) {
        return true;
      }
      return false;
    }
  }

  private async authorizeScreenShare(serial: string): Promise<void> {
    const layoutPath = `/data/local/tmp/mobile_automation_screen_share_${Date.now()}.json`;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await this.runHdc(["-t", serial, "shell", "uitest", "dumpLayout", "-p", layoutPath, "-i"]);
        const layout = await this.runHdc(["-t", serial, "shell", "cat", layoutPath]);
        const targets = findHarmonyScreenShareTapTargets(layout);
        if (targets.length) {
          for (const target of targets) {
            await this.runHdc(["-t", serial, "shell", "uitest", "uiInput", "click", String(target.x), String(target.y)]);
            await this.sleep(250);
          }
          return;
        }
      } catch {
        // The picker is transient; keep polling briefly and let the stream path report real failures.
      }
      await this.sleep(500);
    }
  }
}

type HarmonyStreamSession = {
  socket: WebSocket;
  closed: boolean;
  removeForwardArgs: string[];
  cleanup?: Promise<void>;
  tcp?: Socket;
};

export function buildHarmonyStreamLaunchPlan(input: HarmonyStreamLaunchInput): HarmonyStreamLaunchPlan {
  return {
    forwardArgs: ["-t", input.serial, "fport", `tcp:${input.localPort}`, `tcp:${input.devicePort}`],
    removeForwardArgs: ["-t", input.serial, "fport", "rm", `tcp:${input.localPort}`, `tcp:${input.devicePort}`],
    launchArgs: ["-t", input.serial, "shell", "aa", "start", "-b", input.bundleName, "-a", input.abilityName]
  };
}

function detectHarmonyStartFailure(output: string): string | undefined {
  const normalized = output.trim();
  if (!normalized) {
    return undefined;
  }
  if (/start ability successfully/i.test(normalized)) {
    return undefined;
  }
  if (/fail|failed|error|not found|not exist/i.test(normalized)) {
    return normalized;
  }
  return undefined;
}

export function findHarmonyScreenShareTapTargets(layoutJson: string): Array<{ x: number; y: number }> {
  const roots = JSON.parse(layoutJson) as unknown;
  const nodes: Array<Record<string, unknown>> = [];
  collectLayoutAttributes(roots, nodes);
  const hasScreenSharePicker = nodes.some((node) => nodeText(node).includes("选择共享内容"));
  if (!hasScreenSharePicker) {
    return [];
  }

  const startButton = nodes.find((node) => nodeText(node).includes("开始共享") && centerOfBounds(nodeBounds(node)));
  if (!startButton) {
    return [];
  }
  const screenChoice = nodes.find((node) => {
    const text = nodeText(node);
    return (node.id === "album_detail_0" || text.includes("屏幕")) && node.clickable === "true" && centerOfBounds(nodeBounds(node));
  });
  return [
    ...(screenChoice ? [centerOfBounds(nodeBounds(screenChoice))] : []),
    centerOfBounds(nodeBounds(startButton))
  ].filter((target): target is { x: number; y: number } => Boolean(target));
}

function collectLayoutAttributes(value: unknown, nodes: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLayoutAttributes(item, nodes);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  const node = value as { attributes?: Record<string, unknown>; children?: unknown };
  if (node.attributes) {
    nodes.push(node.attributes);
  }
  collectLayoutAttributes(node.children, nodes);
}

function nodeText(node: Record<string, unknown>): string {
  for (const key of ["text", "originalText", "description", "hint"]) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function nodeBounds(node: Record<string, unknown>): string {
  return typeof node.bounds === "string" ? node.bounds : "";
}

function centerOfBounds(bounds: string): { x: number; y: number } | undefined {
  const match = bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) {
    return undefined;
  }
  const [, left, top, right, bottom] = match.map(Number);
  return {
    x: Math.floor((left + right) / 2),
    y: Math.floor((top + bottom) / 2)
  };
}

function parseHarmonyForwardLocalPorts(output: string, devicePort: number): number[] {
  const localPorts = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\btcp:(\d+)\s+tcp:(\d+)\b/);
    if (match && Number(match[2]) === devicePort) {
      localPorts.add(Number(match[1]));
    }
  }
  return Array.from(localPorts);
}

export class HarmonyH264StreamParser {
  private buffer = Buffer.alloc(0);
  private metadataRead = false;

  constructor(private readonly serial: string) {}

  push(chunk: Buffer): HarmonyParserMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: HarmonyParserMessage[] = [];

    if (!this.metadataRead) {
      const newlineIndex = this.buffer.indexOf(0x0a);
      if (newlineIndex < 0) {
        return messages;
      }
      const line = this.buffer.subarray(0, newlineIndex).toString("utf8").trim();
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      messages.push({ kind: "text", data: JSON.stringify(normalizeMetadata(line, this.serial)) });
      this.metadataRead = true;
    }

    while (this.buffer.byteLength >= packetHeaderSize) {
      const payloadLength = this.buffer.readUInt32BE(10);
      if (payloadLength > maxPacketPayloadBytes) {
        throw new Error(`HarmonyOS stream packet is too large: ${payloadLength}`);
      }
      const packetLength = packetHeaderSize + payloadLength;
      if (this.buffer.byteLength < packetLength) {
        break;
      }
      messages.push({ kind: "binary", data: this.buffer.subarray(0, packetLength) });
      this.buffer = this.buffer.subarray(packetLength);
    }
    return messages;
  }
}

function normalizeMetadata(line: string, serial: string): Record<string, unknown> {
  const raw = JSON.parse(line) as Record<string, unknown>;
  if (raw.type !== undefined && raw.type !== "metadata") {
    return raw;
  }
  return {
    type: "metadata",
    protocolVersion: harmonyStreamProtocolVersion,
    serial,
    codec: numberValue(raw.codec, harmonyH264CodecId),
    codecName: stringValue(raw.codecName, "h264"),
    ...(positiveNumber(raw.width) ? { width: positiveNumber(raw.width) } : {}),
    ...(positiveNumber(raw.height) ? { height: positiveNumber(raw.height) } : {}),
    ...(stringValue(raw.deviceName) ? { deviceName: stringValue(raw.deviceName) } : {})
  };
}

function waitForTcpConnect(socket: Socket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error("Timed out connecting to HarmonyOS screen stream companion"));
    }, timeoutMs);
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to allocate local TCP port for HarmonyOS stream"));
      });
    });
  });
}

function hdcText(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("hdc", args, { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error([stderr, stdout, error.message].filter(Boolean).join("\n").trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }
  return fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
