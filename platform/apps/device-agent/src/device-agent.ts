import {
  type AgentCommandChannelMessage,
  type AgentCommandEnvelope,
  type AgentCommandResultEnvelope,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceInfo,
  type MetricSample,
  type Platform,
  type SemanticDeviceActionRequest,
  type SemanticElementLocator,
  type ToolStatus
} from "@mobile-automation/shared";
import { WebSocket } from "ws";

export type AgentLocalDeviceDriver = {
  getToolStatus(): Promise<ToolStatus[]>;
  listDevices(): Promise<DeviceInfo[]>;
  getDeviceInfo(serial: string): Promise<DeviceInfo>;
  screenshot(serial: string): Promise<Buffer>;
  getForegroundApp?(serial: string): Promise<{ packageName?: string; bundleId?: string; activityName?: string; abilityName?: string; componentName?: string }>;
  dumpUiHierarchy?(serial: string): Promise<string>;
  performAction(serial: string, action: DeviceActionRequest): Promise<DeviceActionResult | void>;
  performSemanticAction?(serial: string, action: SemanticDeviceActionRequest): Promise<DeviceActionResult | void>;
  clearAppData?(serial: string, packageName: string): Promise<void>;
  collectLogs(serial: string, lines?: number): Promise<string>;
  samplePerformance(serial: string, runId: string, stepResultId?: string): Promise<MetricSample>;
};

export type DeviceAgentConfig = {
  serverUrl: string;
  agentId: string;
  version?: string;
  shared?: boolean;
  pairingCode?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxConcurrentRuns?: number;
};

export type DeviceAgentRuntimeDeps = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  write?: (message: string) => void;
  scrcpy?: AgentScrcpyStreamer;
  harmonyStream?: AgentHarmonyStreamer;
  commandSocketFactory?: AgentCommandSocketFactory;
};

export type AgentScrcpyStreamer = {
  connect(input: { serial: string; url: string }): Promise<void>;
};

export type AgentHarmonyStreamer = {
  canStream?(device: DeviceInfo): boolean;
  connect(input: { serial: string; url: string }): Promise<void>;
};

export type AgentCommandSocketFactory = (url: string) => AgentCommandSocket;

export type AgentCommandSocket = {
  readonly readyState: number;
  on(event: "open" | "close" | "error" | "message", listener: (...args: unknown[]) => void): AgentCommandSocket;
  close(): void;
};

type AgentRegistrationPayload = {
  agentId?: string;
  version?: string;
  shared: boolean;
  pairingCode?: string;
  maxConcurrentRuns: number;
  currentRunCount: number;
  toolStatus: ToolStatus[];
  devices: DeviceInfo[];
};

export class DeviceAgentRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly write?: (message: string) => void;
  private readonly scrcpy?: AgentScrcpyStreamer;
  private readonly harmonyStream?: AgentHarmonyStreamer;
  private readonly commandSocketFactory: AgentCommandSocketFactory;
  private readonly backgroundCommands = new Set<Promise<void>>();
  private commandSocket?: AgentCommandSocket;
  private commandSocketAvailable = false;
  private readonly config: Required<Pick<DeviceAgentConfig, "serverUrl" | "agentId" | "shared" | "pollIntervalMs" | "heartbeatIntervalMs" | "maxConcurrentRuns">> & {
    version?: string;
    pairingCode?: string;
  };

  constructor(
    config: DeviceAgentConfig,
    private readonly driver: AgentLocalDeviceDriver,
    deps: DeviceAgentRuntimeDeps = {}
  ) {
    this.config = normalizeConfig(config);
    this.fetchImpl = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.write = deps.write;
    this.scrcpy = deps.scrcpy;
    this.harmonyStream = deps.harmonyStream;
    this.commandSocketFactory = deps.commandSocketFactory ?? ((url) => new WebSocket(url));
  }

  async registerOnce(): Promise<void> {
    await this.postJson("/api/agents/register", {
      agentId: this.config.agentId,
      ...await this.registrationPayload(),
      ...(this.config.pairingCode ? { pairingCode: this.config.pairingCode } : {})
    });
  }

  async heartbeatOnce(): Promise<void> {
    try {
      await this.postJson(`/api/agents/${encodeURIComponent(this.config.agentId)}/heartbeat`, await this.registrationPayload());
    } catch (error) {
      if (!isMissingAgentError(error)) {
        throw error;
      }
      this.write?.("agent session missing; re-registering");
      await this.registerOnce();
    }
  }

  async pollOnce(): Promise<number> {
    const response = await this.getJson<{ commands?: AgentCommandEnvelope[] }>(`/api/agents/${encodeURIComponent(this.config.agentId)}/commands`);
    return this.executeCommands(Array.isArray(response.commands) ? response.commands : []);
  }

  async executeCommands(commandsInput: AgentCommandEnvelope[]): Promise<number> {
    const commands = prioritizeAgentCommands(commandsInput);
    const foregroundCommands: AgentCommandEnvelope[] = [];
    const backgroundCommands: AgentCommandEnvelope[] = [];
    for (const command of commands) {
      if (isBackgroundCommand(command)) {
        backgroundCommands.push(command);
        continue;
      }
      foregroundCommands.push(command);
    }
    await Promise.all(groupCommandsByDevice(foregroundCommands).map((group) => this.executeCommandGroup(group)));
    for (const command of backgroundCommands) {
      this.startBackgroundCommand(command);
    }
    return commands.length;
  }

  async drainBackgroundCommands(): Promise<void> {
    await Promise.all([...this.backgroundCommands]);
  }

  async start(signal?: AbortSignal): Promise<void> {
    let registered = false;
    let lastHeartbeatAt = 0;
    try {
      while (!signal?.aborted) {
        try {
          if (!registered) {
            await this.registerOnce();
            registered = true;
            lastHeartbeatAt = 0;
            this.write?.("agent registered");
          }
          this.connectCommandChannelOnce();
          const now = Date.now();
          if (now - lastHeartbeatAt >= this.config.heartbeatIntervalMs) {
            await this.heartbeatOnce();
            lastHeartbeatAt = now;
          }
          const commandCount = this.commandSocketAvailable ? 0 : await this.pollOnce();
          if (commandCount > 0) {
            this.write?.(`processed ${commandCount} command${commandCount === 1 ? "" : "s"}`);
          }
        } catch (error) {
          registered = false;
          this.closeCommandChannel();
          this.write?.(`agent sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        await this.sleep(this.config.pollIntervalMs);
      }
    } finally {
      this.closeCommandChannel();
    }
  }

  connectCommandChannelOnce(): void {
    if (this.commandSocket) {
      return;
    }
    const url = this.agentWebSocketUrl(`/api/agents/${encodeURIComponent(this.config.agentId)}/commands/ws`);
    const socket = this.commandSocketFactory(url);
    this.commandSocket = socket;
    this.commandSocketAvailable = socket.readyState === WebSocket.OPEN;
    socket.on("open", () => {
      this.commandSocketAvailable = true;
      this.write?.("agent command channel connected");
    });
    socket.on("message", (data) => {
      void this.handleCommandChannelMessage(data).catch((error: unknown) => {
        this.write?.(`agent command channel message failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    socket.on("close", () => {
      if (this.commandSocket === socket) {
        this.commandSocket = undefined;
      }
      this.commandSocketAvailable = false;
    });
    socket.on("error", (error) => {
      this.commandSocketAvailable = false;
      this.write?.(`agent command channel failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async registrationPayload(): Promise<AgentRegistrationPayload> {
    const [toolStatus, devices] = await Promise.all([
      this.driver.getToolStatus().catch((error: unknown) => [{
        name: "agent_driver_tools",
        available: false,
        version: error instanceof Error ? error.message : String(error)
      }]),
      this.driver.listDevices().catch(() => [])
    ]);
    return {
      ...(this.config.version ? { version: this.config.version } : {}),
      shared: this.config.shared,
      maxConcurrentRuns: this.config.maxConcurrentRuns,
      currentRunCount: 0,
      toolStatus,
      devices: this.withAgentStreamCapabilities(devices)
    };
  }

  private async executeCommand(command: AgentCommandEnvelope): Promise<AgentCommandResultEnvelope> {
    const serial = localSerialFromDeviceKey(command.deviceKey, command.agentId, command.platform);
    if (command.command === "getDeviceInfo") {
      return { ok: true, result: { device: await this.driver.getDeviceInfo(serial) } };
    }
    if (command.command === "getForegroundApp") {
      return { ok: true, result: await this.driver.getForegroundApp?.(serial) ?? {} };
    }
    if (command.command === "screenshot") {
      const png = await this.driver.screenshot(serial);
      return { ok: true, dataBase64: png.toString("base64"), contentType: "image/png" };
    }
    if (command.command === "dumpUiHierarchy") {
      if (!this.driver.dumpUiHierarchy) {
        throw new Error("dumpUiHierarchy is not supported by this agent");
      }
      return { ok: true, result: { uiHierarchyXml: await this.driver.dumpUiHierarchy(serial) } };
    }
    if (command.command === "performAction") {
      const action = readDeviceAction(command.payload?.action, "performAction payload.action");
      return { ok: true, result: await this.driver.performAction(serial, action) ?? {} };
    }
    if (command.command === "performSemanticAction") {
      if (!this.driver.performSemanticAction) {
        throw new Error("performSemanticAction is not supported by this agent");
      }
      const action = readSemanticDeviceAction(command.payload?.action, "performSemanticAction payload.action");
      return { ok: true, result: await this.driver.performSemanticAction(serial, action) ?? {} };
    }
    if (command.command === "clearAppData") {
      if (!this.driver.clearAppData) {
        throw new Error("clearAppData is not supported by this agent");
      }
      await this.driver.clearAppData(serial, requiredString(command.payload?.packageName, "clearAppData payload.packageName"));
      return { ok: true, result: {} };
    }
    if (command.command === "collectLogs") {
      return { ok: true, result: { logs: await this.driver.collectLogs(serial, positiveInteger(command.payload?.lines)) } };
    }
    if (command.command === "samplePerformance") {
      return {
        ok: true,
        result: {
          metric: await this.driver.samplePerformance(
            serial,
            requiredString(command.payload?.runId, "samplePerformance payload.runId"),
            optionalString(command.payload?.stepResultId)
          )
        }
      };
    }
    if (command.command === "startScrcpyStream") {
      if (!this.scrcpy) {
        throw new Error("scrcpy streaming is not enabled on this agent");
      }
      if (command.platform !== "android") {
        throw new Error("scrcpy streaming is only supported for Android devices");
      }
      const streamId = requiredString(command.payload?.streamId, "startScrcpyStream payload.streamId");
      const url = this.agentWebSocketUrl(`/api/agents/${encodeURIComponent(command.agentId)}/scrcpy-streams/${encodeURIComponent(streamId)}`);
      void this.scrcpy.connect({ serial, url }).catch((error: unknown) => {
        this.write?.(`scrcpy stream ${streamId} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return { ok: true, result: { streamId } };
    }
    if (command.command === "startHarmonyStream") {
      if (!this.harmonyStream) {
        throw new Error("HarmonyOS screen streaming is not enabled on this agent");
      }
      if (command.platform !== "harmony") {
        throw new Error("HarmonyOS screen streaming is only supported for HarmonyOS devices");
      }
      const streamId = requiredString(command.payload?.streamId, "startHarmonyStream payload.streamId");
      const url = this.agentWebSocketUrl(`/api/agents/${encodeURIComponent(command.agentId)}/harmony-streams/${encodeURIComponent(streamId)}`);
      void this.harmonyStream.connect({ serial, url }).catch((error: unknown) => {
        this.write?.(`HarmonyOS stream ${streamId} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      return { ok: true, result: { streamId } };
    }
    return { ok: false, error: `Unsupported agent command: ${command.command}` };
  }

  private withAgentStreamCapabilities(devices: DeviceInfo[]): DeviceInfo[] {
    if (!this.harmonyStream) {
      return devices;
    }
    return devices.map((device) => {
      if (device.platform !== "harmony" || this.harmonyStream?.canStream?.(device) !== true) {
        return device;
      }
      return {
        ...device,
        capabilities: {
          ...device.capabilities,
          harmonyScreenStream: true
        }
      };
    });
  }

  private startBackgroundCommand(command: AgentCommandEnvelope): void {
    const task = this.executeAndPostCommand(command)
      .catch((error: unknown) => {
        this.write?.(`background command ${command.requestId} failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        this.backgroundCommands.delete(task);
      });
    this.backgroundCommands.add(task);
  }

  private async handleCommandChannelMessage(data: unknown): Promise<void> {
    const message = agentCommandChannelMessage(data);
    if (message.type === "error") {
      throw new Error(message.error);
    }
    const commandCount = await this.executeCommands(message.commands);
    if (commandCount > 0) {
      this.write?.(`processed ${commandCount} pushed command${commandCount === 1 ? "" : "s"}`);
    }
  }

  private closeCommandChannel(): void {
    const socket = this.commandSocket;
    this.commandSocket = undefined;
    this.commandSocketAvailable = false;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  private async executeAndPostCommand(command: AgentCommandEnvelope): Promise<void> {
    const result = await this.executeCommand(command)
      .catch((error: unknown): AgentCommandResultEnvelope => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    await this.postJson(
      `/api/agents/${encodeURIComponent(this.config.agentId)}/commands/${encodeURIComponent(command.requestId)}/result`,
      result
    );
  }

  private async executeCommandGroup(commands: AgentCommandEnvelope[]): Promise<void> {
    for (const command of commands) {
      await this.executeAndPostCommand(command);
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(this.url(path), { method: "GET" });
    return this.readJsonResponse<T>(response, path);
  }

  private async postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    return this.readJsonResponse<T>(response, path);
  }

  private async readJsonResponse<T>(response: Response, path: string): Promise<T> {
    const text = await response.text();
    const payload = text ? JSON.parse(text) as T : {} as T;
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : text;
      throw new AgentServerRequestError(path, response.status, error);
    }
    return payload;
  }

  private url(path: string): string {
    return `${this.config.serverUrl}${path}`;
  }

  private agentWebSocketUrl(path: string): string {
    const url = new URL(this.url(path));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
}

class AgentServerRequestError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly serverMessage: string
  ) {
    super(`${path} failed (${status}): ${serverMessage}`);
  }
}

function isMissingAgentError(error: unknown): boolean {
  return error instanceof AgentServerRequestError && error.status === 404 && error.serverMessage.includes("Agent not found");
}

function prioritizeAgentCommands(commands: AgentCommandEnvelope[]): AgentCommandEnvelope[] {
  return [...commands].sort((left, right) => agentCommandPriority(right) - agentCommandPriority(left));
}

function agentCommandPriority(command: AgentCommandEnvelope): number {
  if (command.command === "performAction" || command.command === "performSemanticAction") {
    return 100;
  }
  if (command.command === "startScrcpyStream" || command.command === "startHarmonyStream") {
    return 90;
  }
  if (command.command === "screenshot") {
    return 0;
  }
  return 50;
}

function isBackgroundCommand(command: AgentCommandEnvelope): boolean {
  return command.command === "screenshot";
}

function groupCommandsByDevice(commands: AgentCommandEnvelope[]): AgentCommandEnvelope[][] {
  const groups = new Map<string, AgentCommandEnvelope[]>();
  for (const command of commands) {
    const group = groups.get(command.deviceKey) ?? [];
    group.push(command);
    groups.set(command.deviceKey, group);
  }
  return [...groups.values()];
}

function agentCommandChannelMessage(data: unknown): AgentCommandChannelMessage {
  const parsed = JSON.parse(socketMessageText(data)) as unknown;
  const message = recordValue(parsed);
  if (!message || typeof message.type !== "string") {
    throw new Error("agent command channel message is invalid");
  }
  if (message.type === "commands") {
    if (!Array.isArray(message.commands)) {
      throw new Error("agent command channel commands message is invalid");
    }
    return { type: "commands", commands: message.commands as AgentCommandEnvelope[] };
  }
  if (message.type === "error" && typeof message.error === "string") {
    return { type: "error", error: message.error };
  }
  throw new Error(`Unsupported agent command channel message: ${message.type}`);
}

function socketMessageText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data) && data.every((item) => Buffer.isBuffer(item))) {
    return Buffer.concat(data).toString("utf8");
  }
  return String(data);
}

export function parseDeviceAgentArgs(argv: string[], env: Record<string, string | undefined> = process.env): DeviceAgentConfig {
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return normalizeConfig({
    serverUrl: stringOption(options.server) ?? env.DEVICE_AGENT_SERVER_URL ?? "http://127.0.0.1:4010",
    agentId: stringOption(options["agent-id"]) ?? env.DEVICE_AGENT_ID ?? defaultAgentId(),
    version: env.DEVICE_AGENT_VERSION ?? "0.1.0",
    shared: booleanOption(options.shared, env.DEVICE_AGENT_SHARED === "1" || env.DEVICE_AGENT_SHARED === "true"),
    pairingCode: stringOption(options["pairing-code"]) ?? env.DEVICE_AGENT_PAIRING_CODE,
    pollIntervalMs: numberOption(options["poll-interval-ms"]) ?? numberOption(env.DEVICE_AGENT_POLL_INTERVAL_MS),
    heartbeatIntervalMs: numberOption(options["heartbeat-interval-ms"]) ?? numberOption(env.DEVICE_AGENT_HEARTBEAT_INTERVAL_MS),
    maxConcurrentRuns: numberOption(options["max-concurrent-runs"]) ?? numberOption(env.DEVICE_AGENT_MAX_CONCURRENT_RUNS)
  });
}

export function parseHarmonyStreamEnabled(value: unknown = process.env.HARMONY_STREAM_ENABLED): boolean {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function normalizeConfig(config: DeviceAgentConfig): DeviceAgentRuntime["config"] {
  return {
    serverUrl: requiredString(config.serverUrl, "serverUrl").replace(/\/+$/, ""),
    agentId: requiredString(config.agentId, "agentId"),
    ...(optionalString(config.version) ? { version: optionalString(config.version) } : {}),
    shared: config.shared === true,
    ...(optionalString(config.pairingCode) ? { pairingCode: optionalString(config.pairingCode) } : {}),
    pollIntervalMs: positiveInteger(config.pollIntervalMs) ?? 1000,
    heartbeatIntervalMs: positiveInteger(config.heartbeatIntervalMs) ?? 5000,
    maxConcurrentRuns: positiveInteger(config.maxConcurrentRuns) ?? 1
  };
}

function localSerialFromDeviceKey(deviceKey: string, agentId: string, platform: Platform): string {
  const prefix = `${agentId}:${platform}:`;
  if (!deviceKey.startsWith(prefix)) {
    throw new Error(`Device key ${deviceKey} does not belong to ${agentId}/${platform}`);
  }
  const serial = deviceKey.slice(prefix.length).trim();
  if (!serial) {
    throw new Error(`Device key ${deviceKey} is missing local serial`);
  }
  return serial;
}

function readDeviceAction(value: unknown, name: string): DeviceActionRequest {
  const action = recordValue(value);
  if (!action || typeof action.type !== "string") {
    throw new Error(`${name} is invalid`);
  }
  if (action.type === "tap" && isFiniteNumber(action.x) && isFiniteNumber(action.y)) {
    return { type: "tap", x: action.x, y: action.y };
  }
  if (action.type === "long_press" && isFiniteNumber(action.x) && isFiniteNumber(action.y)) {
    return { type: "long_press", x: action.x, y: action.y, ...(isFiniteNumber(action.durationMs) ? { durationMs: action.durationMs } : {}) };
  }
  if (action.type === "swipe" && isFiniteNumber(action.startX) && isFiniteNumber(action.startY) && isFiniteNumber(action.endX) && isFiniteNumber(action.endY)) {
    return {
      type: "swipe",
      startX: action.startX,
      startY: action.startY,
      endX: action.endX,
      endY: action.endY,
      ...(isFiniteNumber(action.durationMs) ? { durationMs: action.durationMs } : {})
    };
  }
  if (action.type === "input_text" && typeof action.text === "string") return { type: "input_text", text: action.text };
  if (action.type === "input_keyevents" && typeof action.text === "string") return { type: "input_keyevents", text: action.text, ...(isFiniteNumber(action.intervalMs) ? { intervalMs: action.intervalMs } : {}) };
  if (action.type === "wait" && isFiniteNumber(action.durationMs)) return { type: "wait", durationMs: action.durationMs };
  if ((action.type === "launch_app" || action.type === "close_app") && typeof action.packageName === "string") return { type: action.type, packageName: action.packageName };
  if (action.type === "hide_keyboard" || action.type === "back" || action.type === "home" || action.type === "recent_apps" || action.type === "clear_text" || action.type === "screenshot") {
    return { type: action.type };
  }
  throw new Error(`${name} is invalid`);
}

function readSemanticDeviceAction(value: unknown, name: string): SemanticDeviceActionRequest {
  const action = recordValue(value);
  if (!action || typeof action.type !== "string") {
    throw new Error(`${name} is invalid`);
  }
  const locator = recordValue(action.locator);
  if (!locator) {
    throw new Error(`${name} is invalid`);
  }
  const semanticLocator = semanticLocatorValue(locator);
  if (action.type === "tap_on_element") {
    return {
      type: "tap_on_element",
      locator: semanticLocator,
      ...(pointValue(action.fallbackTap) ? { fallbackTap: pointValue(action.fallbackTap) } : {})
    };
  }
  if (action.type === "input_text_to_element" && typeof action.text === "string") {
    return {
      type: "input_text_to_element",
      locator: semanticLocator,
      text: action.text,
      ...(typeof action.clearFirst === "boolean" ? { clearFirst: action.clearFirst } : {}),
      ...(pointValue(action.fallbackTap) ? { fallbackTap: pointValue(action.fallbackTap) } : {})
    };
  }
  if (action.type === "scroll_until_visible") {
    const fallbackSwipe = swipeActionValue(action.fallbackSwipe);
    return {
      type: "scroll_until_visible",
      locator: semanticLocator,
      ...(directionValue(action.direction) ? { direction: directionValue(action.direction) } : {}),
      ...(positiveInteger(action.maxSwipes) ? { maxSwipes: positiveInteger(action.maxSwipes) } : {}),
      ...(positiveInteger(action.intervalMs) ? { intervalMs: positiveInteger(action.intervalMs) } : {}),
      ...(fallbackSwipe ? { fallbackSwipe } : {})
    };
  }
  throw new Error(`${name} is invalid`);
}

function semanticLocatorValue(locator: Record<string, unknown>): SemanticElementLocator {
  return {
    ...(locator.strategy === "android_uiautomator" ? { strategy: locator.strategy } : {}),
    ...(optionalString(locator.resourceId) ? { resourceId: optionalString(locator.resourceId) } : {}),
    ...(optionalString(locator.text) ? { text: optionalString(locator.text) } : {}),
    ...(locator.textMatchMode === "equals" || locator.textMatchMode === "contains" ? { textMatchMode: locator.textMatchMode } : {}),
    ...(Array.isArray(locator.excludeTexts) ? { excludeTexts: locator.excludeTexts.filter((item): item is string => typeof item === "string") } : {}),
    ...(positiveInteger(locator.occurrence) ? { occurrence: positiveInteger(locator.occurrence) } : {}),
    ...(locator.tapTarget === "self" || locator.tapTarget === "clickable_ancestor" ? { tapTarget: locator.tapTarget } : {}),
    ...(optionalString(locator.contentDesc) ? { contentDesc: optionalString(locator.contentDesc) } : {}),
    ...(optionalString(locator.className) ? { className: optionalString(locator.className) } : {}),
    ...(optionalString(locator.packageName) ? { packageName: optionalString(locator.packageName) } : {})
  };
}

function swipeActionValue(value: unknown): Extract<DeviceActionRequest, { type: "swipe" }> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const action = readDeviceAction(value, "scroll_until_visible fallbackSwipe");
    return action.type === "swipe" ? action : undefined;
  } catch {
    return undefined;
  }
}

function pointValue(value: unknown): { x: number; y: number } | undefined {
  const point = recordValue(value);
  return isFiniteNumber(point?.x) && isFiniteNumber(point?.y) ? { x: point.x, y: point.y } : undefined;
}

function directionValue(value: unknown): "up" | "down" | "left" | "right" | undefined {
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : undefined;
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

function stringOption(value: unknown): string | undefined {
  return optionalString(value);
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" || typeof value === "string" ? positiveInteger(value) : undefined;
}

function booleanOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function defaultAgentId(): string {
  const host = process.env.HOSTNAME || "local";
  return `agent-${host}`.replace(/[^a-zA-Z0-9_.-]+/g, "-");
}
