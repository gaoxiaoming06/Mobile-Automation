import type { RawData } from "ws";
import type { AgentDeviceInfo } from "@mobile-automation/shared";
import type { ServerAgentRegistry } from "./server-agent-registry.js";

type RelaySocket = {
  readonly OPEN: number;
  readyState: number;
  send(data: unknown, options?: { binary?: boolean }): void;
  close(): void;
  on(event: "message", listener: (data: RawData | string | Buffer, isBinary: boolean) => void): unknown;
  once(event: "close", listener: () => void): unknown;
};

type AgentHarmonyStreamBrokerOptions = {
  streamIdGenerator?: () => string;
};

type StreamSession = {
  streamId: string;
  agentId: string;
  deviceKey: string;
  browsers: Set<RelaySocket>;
  agent?: RelaySocket;
  lastMetadata?: RawData | string | Buffer;
  lastConfiguration?: RawData | string | Buffer;
  lastKeyframe?: RawData | string | Buffer;
  starting: boolean;
};

export class AgentHarmonyStreamBroker {
  private readonly sessionsByStreamId = new Map<string, StreamSession>();
  private readonly streamIdByDeviceKey = new Map<string, string>();

  constructor(
    private readonly registry: ServerAgentRegistry,
    private readonly options: AgentHarmonyStreamBrokerOptions = {}
  ) {}

  attachBrowser(deviceKey: string, browser: RelaySocket): void {
    const device = this.registry.deviceInfoForKey(deviceKey);
    if (!isHarmonyStreamDevice(device)) {
      sendErrorAndClose(browser, "HarmonyOS stream bridge requires a registered HarmonyOS agent device with harmonyScreenStream capability.");
      return;
    }

    const session = this.sessionForDevice(device);
    session.browsers.add(browser);
    replayCachedStreamState(session, browser);
    browser.once("close", () => this.detachBrowser(session, browser));

    if (!session.starting && !session.agent) {
      this.startAgentStream(session);
    }
  }

  attachAgent(agentId: string, streamId: string, agent: RelaySocket): void {
    const session = this.sessionsByStreamId.get(streamId);
    if (!session || session.agentId !== agentId) {
      sendErrorAndClose(agent, "HarmonyOS stream session not found.");
      return;
    }
    session.agent = agent;
    session.starting = false;
    agent.once("close", () => this.closeSession(session));

    agent.on("message", (data, isBinary) => {
      if (!isBinary) {
        session.lastMetadata = data;
      } else if (isConfigurationPacket(data)) {
        session.lastConfiguration = data;
      } else if (isKeyframePacket(data)) {
        session.lastKeyframe = data;
      }
      for (const browser of session.browsers) {
        relayTo(browser, data, isBinary);
      }
    });
  }

  isDeviceStreaming(deviceKey: string): boolean {
    return this.streamIdByDeviceKey.has(deviceKey);
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessionsByStreamId.values()) {
      closeSocket(session.agent);
      for (const browser of session.browsers) {
        closeSocket(browser);
      }
    }
    this.sessionsByStreamId.clear();
    this.streamIdByDeviceKey.clear();
  }

  private sessionForDevice(device: AgentDeviceInfo): StreamSession {
    const existingStreamId = this.streamIdByDeviceKey.get(device.agent.deviceKey);
    const existing = existingStreamId ? this.sessionsByStreamId.get(existingStreamId) : undefined;
    if (existing) {
      return existing;
    }

    const streamId = this.nextStreamId();
    const session: StreamSession = {
      streamId,
      agentId: device.agent.agentId,
      deviceKey: device.agent.deviceKey,
      browsers: new Set(),
      starting: false
    };
    this.sessionsByStreamId.set(streamId, session);
    this.streamIdByDeviceKey.set(device.agent.deviceKey, streamId);
    return session;
  }

  private startAgentStream(session: StreamSession): void {
    session.starting = true;
    this.registry.sendCommand(session.deviceKey, "startHarmonyStream", { streamId: session.streamId })
      .then((result) => {
        if (!result.ok) {
          this.failSession(session, result.error ?? "Agent failed to start HarmonyOS stream.");
        }
      })
      .catch((error: unknown) => {
        this.failSession(session, error instanceof Error ? error.message : String(error));
      });
  }

  private detachBrowser(session: StreamSession, browser: RelaySocket): void {
    session.browsers.delete(browser);
    if (session.browsers.size === 0) {
      this.closeSession(session);
    }
  }

  private failSession(session: StreamSession, message: string): void {
    for (const browser of session.browsers) {
      sendErrorAndClose(browser, message);
    }
    this.closeSession(session);
  }

  private closeSession(session: StreamSession): void {
    if (!this.sessionsByStreamId.has(session.streamId)) {
      return;
    }
    this.sessionsByStreamId.delete(session.streamId);
    this.streamIdByDeviceKey.delete(session.deviceKey);
    closeSocket(session.agent);
    for (const browser of session.browsers) {
      closeSocket(browser);
    }
    session.browsers.clear();
  }

  private nextStreamId(): string {
    return this.options.streamIdGenerator?.() ?? `harmony_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function replayCachedStreamState(session: StreamSession, browser: RelaySocket): void {
  if (session.lastMetadata) {
    relayTo(browser, session.lastMetadata, false);
  }
  if (session.lastConfiguration) {
    relayTo(browser, session.lastConfiguration, true);
  }
  if (session.lastKeyframe) {
    relayTo(browser, session.lastKeyframe, true);
  }
}

function relayTo(socket: RelaySocket | undefined, data: RawData | string | Buffer, isBinary: boolean): void {
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(data, { binary: isBinary });
}

function sendErrorAndClose(socket: RelaySocket, message: string): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ type: "error", message }));
  }
  socket.close();
}

function closeSocket(socket: RelaySocket | undefined): void {
  if (socket && socket.readyState === socket.OPEN) {
    socket.close();
  }
}

function isHarmonyStreamDevice(device: AgentDeviceInfo | undefined): device is AgentDeviceInfo {
  return Boolean(device?.agent && device.platform === "harmony" && device.capabilities.harmonyScreenStream === true);
}

function isConfigurationPacket(data: RawData | string | Buffer): boolean {
  return Buffer.isBuffer(data) && data.byteLength > 0 && data.readUInt8(0) === 1;
}

function isKeyframePacket(data: RawData | string | Buffer): boolean {
  return Buffer.isBuffer(data) && data.byteLength > 1 && data.readUInt8(0) === 2 && data.readUInt8(1) === 1;
}
