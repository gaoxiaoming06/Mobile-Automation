import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { DeviceAgentConfig, DeviceAgentRuntime } from "./device-agent.js";

export type ManagedAgentConfig = {
  serverUrl: string;
  agentId: string;
  shared: boolean;
  pairingCode?: string;
  insecureTls?: boolean;
  version?: string;
};

export type ManagedAgentSnapshot = {
  running: boolean;
  pid: number;
  config?: ManagedAgentConfig;
  serverConnected?: boolean;
  registrationError?: string;
};

export type AgentControlUpdateResult = {
  version: string;
  agentChanged: boolean;
  restartRequired: boolean;
  agent: ManagedAgentSnapshot;
};

export type LocalAgentManager = {
  status(): Promise<ManagedAgentSnapshot>;
  start(config: ManagedAgentConfig): Promise<ManagedAgentSnapshot>;
  stop(): Promise<ManagedAgentSnapshot>;
  restart(): Promise<ManagedAgentSnapshot>;
  updateFromServer(input: { serverUrl?: string }): Promise<AgentControlUpdateResult>;
  logs(lines?: number): Promise<string>;
};

export type LocalAgentControlOptions = {
  host?: string;
  port?: number;
  version?: string;
  manager: LocalAgentManager;
};

export type LocalAgentControlServer = {
  listen(): Promise<string>;
  close(): Promise<void>;
  url(): string | undefined;
};

export type DeviceAgentRuntimeFactory = (config: DeviceAgentConfig) => DeviceAgentRuntime;

export class MemoryLogBuffer {
  private readonly entries: string[] = [];
  private latestRegistrationError?: string;
  private connectedToServer = false;

  constructor(private readonly maxEntries = 400) {}

  write(message: string): void {
    this.entries.push(`${new Date().toISOString()} ${message}`);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    const registrationError = agentSyncFailureMessage(message);
    if (registrationError) {
      this.latestRegistrationError = registrationError;
      this.connectedToServer = false;
      return;
    }
    if (message === "agent registered") {
      this.latestRegistrationError = undefined;
      this.connectedToServer = true;
      return;
    }
    if (message === "agent command channel connected" || message.startsWith("processed ")) {
      this.latestRegistrationError = undefined;
    }
  }

  clearRegistrationError(): void {
    this.latestRegistrationError = undefined;
  }

  resetConnectionState(): void {
    this.latestRegistrationError = undefined;
    this.connectedToServer = false;
  }

  registrationError(): string | undefined {
    return this.latestRegistrationError;
  }

  serverConnected(): boolean {
    return this.connectedToServer;
  }

  read(lines = 200): string {
    return this.entries.slice(Math.max(0, this.entries.length - lines)).join("\n");
  }
}

export class InProcessAgentManager implements LocalAgentManager {
  private current?: {
    controller: AbortController;
    promise: Promise<void>;
    config: ManagedAgentConfig;
    running: boolean;
  };
  private lastConfig?: ManagedAgentConfig;

  constructor(
    initialConfig: ManagedAgentConfig | undefined,
    private readonly createRuntime: DeviceAgentRuntimeFactory,
    private readonly options: {
      logBuffer?: MemoryLogBuffer;
      agentFile?: string;
      relaunch?: (config: ManagedAgentConfig) => void;
    } = {}
  ) {
    this.lastConfig = initialConfig;
  }

  async status(): Promise<ManagedAgentSnapshot> {
    const config = this.current?.config ?? this.lastConfig;
    const registrationError = this.current?.running ? this.options.logBuffer?.registrationError() : undefined;
    const serverConnected = this.current?.running ? this.options.logBuffer?.serverConnected() : false;
    return {
      running: this.current?.running === true,
      pid: process.pid,
      ...(config ? { config } : {}),
      serverConnected,
      ...(registrationError ? { registrationError } : {})
    };
  }

  async start(config: ManagedAgentConfig): Promise<ManagedAgentSnapshot> {
    await this.stop();
    this.options.logBuffer?.resetConnectionState();
    this.lastConfig = normalizeManagedAgentConfig(config);
    applyManagedTlsConfig(this.lastConfig);
    const controller = new AbortController();
    const runtime = this.createRuntime(managedConfigToDeviceAgentConfig(this.lastConfig));
    const current = {
      controller,
      config: this.lastConfig,
      running: true,
      promise: runtime.start(controller.signal).catch((error: unknown) => {
        this.options.logBuffer?.write(`agent runtime failed: ${errorMessage(error)}`);
      }).finally(() => {
        current.running = false;
      })
    };
    this.current = current;
    this.options.logBuffer?.write(this.lastConfig.shared ? "agent connected in shared mode" : "agent connected in private mode");
    return this.status();
  }

  async stop(): Promise<ManagedAgentSnapshot> {
    if (this.current?.running) {
      this.current.controller.abort();
      await Promise.race([this.current.promise, sleep(1200)]);
      this.options.logBuffer?.write("agent connection stopped");
    }
    this.current = undefined;
    return this.status();
  }

  async restart(): Promise<ManagedAgentSnapshot> {
    const config = this.current?.config ?? this.lastConfig;
    if (!config) {
      return this.status();
    }
    return this.start(config);
  }

  async updateFromServer(input: { serverUrl?: string }): Promise<AgentControlUpdateResult> {
    const config = this.current?.config ?? this.lastConfig;
    const serverUrl = (input.serverUrl ?? config?.serverUrl)?.replace(/\/+$/, "");
    if (!serverUrl) {
      throw new Error("serverUrl is required");
    }
    const manifest = await fetchAgentDistributionManifest(serverUrl);
    const agentFile = this.options.agentFile ?? process.env.MOBILE_AUTOMATION_AGENT_FILE;
    const agentChanged = agentFile ? await downloadBundleIfNeeded({
      filePath: agentFile,
      url: absoluteUrl(manifest.url, serverUrl),
      sha256: manifest.sha256
    }) : false;
    if (agentFile && manifest.scrcpyServer) {
      const scrcpyServerFile = path.join(path.dirname(agentFile), manifest.scrcpyServer.file);
      await downloadBundleIfNeeded({
        filePath: scrcpyServerFile,
        url: absoluteUrl(manifest.scrcpyServer.url, serverUrl),
        sha256: manifest.scrcpyServer.sha256
      });
      process.env.SCRCPY_SERVER_PATH = scrcpyServerFile;
    }
    const nextConfig = config ? { ...config, serverUrl, version: manifest.version } : undefined;
    if (nextConfig) {
      this.lastConfig = nextConfig;
    }
    const agent = await this.status();
    this.options.logBuffer?.write(agentChanged ? `agent bundle updated to ${manifest.version}` : `agent bundle already at ${manifest.version}`);
    if (agentChanged && nextConfig && this.options.relaunch) {
      setTimeout(() => this.options.relaunch?.(nextConfig), 100);
    }
    return {
      version: manifest.version,
      agentChanged,
      restartRequired: agentChanged && !this.options.relaunch,
      agent
    };
  }

  async logs(lines = 200): Promise<string> {
    return this.options.logBuffer?.read(lines) ?? "";
  }
}

export function createLocalAgentControl(options: LocalAgentControlOptions): LocalAgentControlServer {
  const host = options.host ?? process.env.MOBILE_AUTOMATION_AGENT_CONTROL_HOST ?? "127.0.0.1";
  const port = options.port ?? positiveInteger(process.env.MOBILE_AUTOMATION_AGENT_CONTROL_PORT) ?? 17611;
  const version = options.version ?? process.env.DEVICE_AGENT_VERSION ?? "0.1.0";
  const server = createServer((req, res) => {
    void handleControlRequest(req, res, { version, port, manager: options.manager });
  });

  return {
    async listen() {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return serverUrl(server, host);
    },
    async close() {
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
    url() {
      return server.listening ? serverUrl(server, host) : undefined;
    }
  };
}

type RequestContext = {
  version: string;
  port: number;
  manager: LocalAgentManager;
};

async function handleControlRequest(req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> {
  writeCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  try {
    if (req.method === "GET" && url.pathname === "/status") {
      await sendStatus(res, context);
      return;
    }
    if (req.method === "POST" && url.pathname === "/start") {
      const agent = await context.manager.start(readManagedAgentConfig(await readJsonBody(req)));
      sendJson(res, 200, { ok: true, control: controlSnapshot(context), agent });
      return;
    }
    if (req.method === "POST" && url.pathname === "/stop") {
      const agent = await context.manager.stop();
      sendJson(res, 200, { ok: true, control: controlSnapshot(context), agent });
      return;
    }
    if (req.method === "POST" && url.pathname === "/restart") {
      const agent = await context.manager.restart();
      sendJson(res, 200, { ok: true, control: controlSnapshot(context), agent });
      return;
    }
    if (req.method === "POST" && url.pathname === "/update") {
      const body = await readJsonBody(req);
      const serverUrl = body && typeof body === "object" ? optionalString((body as Record<string, unknown>).serverUrl) : undefined;
      const update = await context.manager.updateFromServer({ serverUrl });
      sendJson(res, 200, { ok: true, control: controlSnapshot(context), update, agent: update.agent });
      return;
    }
    if (req.method === "GET" && url.pathname === "/logs") {
      const lines = positiveInteger(url.searchParams.get("lines") ?? undefined) ?? 200;
      sendJson(res, 200, { ok: true, logs: await context.manager.logs(lines) });
      return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: errorMessage(error) });
  }
}

async function sendStatus(res: ServerResponse, context: RequestContext): Promise<void> {
  sendJson(res, 200, {
    ok: true,
    control: controlSnapshot(context),
    agent: await context.manager.status()
  });
}

function controlSnapshot(context: RequestContext): { running: true; port: number; version: string } {
  return {
    running: true,
    port: context.port,
    version: context.version
  };
}

function readManagedAgentConfig(input: unknown): ManagedAgentConfig {
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return normalizeManagedAgentConfig({
    serverUrl: requiredString(record.serverUrl, "serverUrl"),
    agentId: optionalString(record.agentId) ?? os.hostname(),
    shared: record.shared === true || record.shared === "true" || record.shared === 1,
    ...(optionalString(record.pairingCode) ? { pairingCode: optionalString(record.pairingCode) } : {}),
    ...(record.insecureTls === true ? { insecureTls: true } : {}),
    ...(optionalString(record.version) ? { version: optionalString(record.version) } : {})
  });
}

function normalizeManagedAgentConfig(config: ManagedAgentConfig): ManagedAgentConfig {
  const serverUrl = requiredString(config.serverUrl, "serverUrl").replace(/\/+$/, "");
  const agentId = requiredString(config.agentId, "agentId");
  if (config.shared && config.pairingCode) {
    throw new Error("shared and pairingCode cannot be used together");
  }
  return {
    serverUrl,
    agentId,
    shared: config.shared === true,
    ...(config.pairingCode ? { pairingCode: config.pairingCode } : {}),
    ...(config.insecureTls ? { insecureTls: true } : {}),
    ...(config.version ? { version: config.version } : {})
  };
}

function managedConfigToDeviceAgentConfig(config: ManagedAgentConfig): DeviceAgentConfig {
  return {
    serverUrl: config.serverUrl,
    agentId: config.agentId,
    shared: config.shared,
    ...(config.pairingCode ? { pairingCode: config.pairingCode } : {}),
    ...(config.version ? { version: config.version } : {})
  };
}

function applyManagedTlsConfig(config: ManagedAgentConfig): void {
  if (config.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

function writeCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  res.setHeader("access-control-allow-origin", typeof origin === "string" && origin ? origin : "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-private-network", "true");
  res.setHeader("vary", "Origin");
}

function serverUrl(server: Server, host: string): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Agent control did not bind to a TCP port");
  }
  return `http://${host}:${address.port}`;
}

type AgentDistributionManifest = {
  version: string;
  url: string;
  sha256: string;
  scrcpyServer?: {
    file: string;
    url: string;
    sha256: string;
  };
};

async function fetchAgentDistributionManifest(serverUrl: string): Promise<AgentDistributionManifest> {
  const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/agent/manifest.json`);
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status} ${response.statusText}`);
  }
  const manifest = await response.json() as Partial<AgentDistributionManifest>;
  return {
    version: requiredString(manifest.version, "manifest.version"),
    url: requiredString(manifest.url, "manifest.url"),
    sha256: requiredString(manifest.sha256, "manifest.sha256"),
    ...(readManifestScrcpyServer(manifest.scrcpyServer) ? { scrcpyServer: readManifestScrcpyServer(manifest.scrcpyServer) } : {})
  };
}

function readManifestScrcpyServer(value: unknown): AgentDistributionManifest["scrcpyServer"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    file: optionalString(record.file) ?? "scrcpy-server-v3.3.3",
    url: requiredString(record.url, "manifest.scrcpyServer.url"),
    sha256: requiredString(record.sha256, "manifest.scrcpyServer.sha256")
  };
}

async function downloadBundleIfNeeded(input: { filePath: string; url: string; sha256: string }): Promise<boolean> {
  const currentSha256 = await sha256File(input.filePath);
  if (currentSha256 && currentSha256 === input.sha256) {
    return false;
  }
  const response = await fetch(input.url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const bundle = Buffer.from(await response.arrayBuffer());
  const actualSha256 = sha256Buffer(bundle);
  if (actualSha256 !== input.sha256) {
    throw new Error("Downloaded bundle checksum mismatch");
  }
  await writeFile(input.filePath, bundle);
  return true;
}

async function sha256File(filePath: string): Promise<string | undefined> {
  const data = await readFile(filePath).catch((error: unknown) => {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  });
  return data ? sha256Buffer(data) : undefined;
}

function sha256Buffer(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function absoluteUrl(url: string, serverUrl: string): string {
  return new URL(url, `${serverUrl.replace(/\/+$/, "")}/`).toString();
}

function requiredString(value: unknown, name: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`${name} is required`);
  }
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function agentSyncFailureMessage(message: string): string | undefined {
  const prefix = "agent sync failed: ";
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
