import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdbServerClient } from "@yume-chan/adb";
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import {
  AndroidKeyCode,
  AndroidKeyEventAction,
  AndroidKeyEventMeta,
  AndroidMotionEventAction,
  AndroidMotionEventButton,
  ScrcpyPointerId,
  ScrcpyVideoCodecNameMap,
  type ScrcpyMediaStreamPacket
} from "@yume-chan/scrcpy";
import { ReadableStream, type ReadableStreamDefaultReader } from "@yume-chan/stream-extra";
import type { DeviceActionRequest } from "@mobile-automation/shared";
import type { WebSocket } from "ws";

const protocolVersion = 1;
const scrcpyServerDevicePath = "/data/local/tmp/mobile-automation-scrcpy-server.jar";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(moduleDir, "../../..");
const defaultServerPath = path.join(workspaceRoot, "tools/scrcpy-server-v3.3.3");
const maxWebSocketBacklogBytes = Number(process.env.SCRCPY_STREAM_MAX_WS_BACKLOG_BYTES ?? 512 * 1024);

type ScrcpyStreamSession = {
  serial: string;
  client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>;
  reader?: ReadableStreamDefaultReader<ScrcpyMediaStreamPacket>;
};

type StartupGuard = {
  canceled: boolean;
};

type MetadataMessage = {
  type: "metadata";
  protocolVersion: number;
  serial: string;
  codec: number;
  codecName: string;
  width?: number;
  height?: number;
  deviceName?: string;
};

type ErrorMessage = {
  type: "error" | "control_error";
  message: string;
};

type ClientControlMessage = {
  type: "control";
  action: DeviceActionRequest;
  videoWidth: number;
  videoHeight: number;
};

export class ScrcpyStreamBridge {
  private readonly adbServer = new AdbServerClient(new AdbServerNodeTcpConnector({ host: "127.0.0.1", port: 5037 }));
  private readonly sessions = new Set<ScrcpyStreamSession>();
  private readonly startupGuards = new Map<string, StartupGuard>();

  async attach(serial: string, socket: WebSocket): Promise<void> {
    const existingStartupGuard = this.startupGuards.get(serial);
    if (existingStartupGuard) {
      existingStartupGuard.canceled = true;
    }
    const startupGuard: StartupGuard = { canceled: false };
    this.startupGuards.set(serial, startupGuard);
    let socketClosed = socket.readyState !== socket.OPEN;
    let session: ScrcpyStreamSession | undefined;
    socket.once("close", () => {
      socketClosed = true;
      startupGuard.canceled = true;
      if (session) {
        void this.closeSession(session);
      }
    });

    try {
      await this.closeSessionsForSerial(serial);
      if (shouldStopStartup(socket, socketClosed, startupGuard)) {
        return;
      }

      const serverPath = await resolveScrcpyServerPath();
      const adb = await this.adbServer.createAdb({ serial });
      if (shouldStopStartup(socket, socketClosed, startupGuard)) {
        return;
      }

      await AdbScrcpyClient.pushServer(adb, ReadableStream.from(createReadStream(serverPath)), scrcpyServerDevicePath);
      if (shouldStopStartup(socket, socketClosed, startupGuard)) {
        return;
      }

      const options = new AdbScrcpyOptionsLatest({
        video: true,
        audio: false,
        control: true,
        maxSize: Number(process.env.SCRCPY_STREAM_MAX_SIZE ?? 800),
        maxFps: Number(process.env.SCRCPY_STREAM_MAX_FPS ?? 30),
        videoBitRate: Number(process.env.SCRCPY_STREAM_BIT_RATE ?? 2_000_000),
        sendFrameMeta: true,
        stayAwake: true,
        tunnelForward: true,
        logLevel: "info"
      });

      const client = await AdbScrcpyClient.start(adb, scrcpyServerDevicePath, options);
      session = { serial, client };
      this.sessions.add(session);
      if (shouldStopStartup(socket, socketClosed, startupGuard)) {
        await this.closeSession(session);
        return;
      }

      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          return;
        }
        void handleClientMessage(client, data.toString()).catch((error) => {
          if (socket.readyState === socket.OPEN) {
            sendJson(socket, {
              type: "control_error",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        });
      });

      const video = await client.videoStream;
      if (socket.readyState !== socket.OPEN) {
        await this.closeSession(session);
        return;
      }

      sendJson(socket, {
        type: "metadata",
        protocolVersion,
        serial,
        codec: video.metadata.codec,
        codecName: ScrcpyVideoCodecNameMap.get(video.metadata.codec) ?? "unknown",
        width: video.metadata.width,
        height: video.metadata.height,
        deviceName: video.metadata.deviceName
      });

      const reader = video.stream.getReader();
      session.reader = reader;
      let droppingUntilKeyframe = false;
      while (socket.readyState === socket.OPEN) {
        const { done, value } = await reader.read();
        if (done || !value) {
          break;
        }
        if (shouldDropVideoPacket(value, socket.bufferedAmount, droppingUntilKeyframe)) {
          droppingUntilKeyframe = true;
          continue;
        }
        if (droppingUntilKeyframe && value.type === "data" && value.keyframe) {
          droppingUntilKeyframe = false;
        }
        socket.send(encodePacket(value), { binary: true });
      }
    } catch (error) {
      if (socket.readyState === socket.OPEN) {
        sendJson(socket, {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      if (session) {
        await this.closeSession(session);
      }
      if (socket.readyState === socket.OPEN) {
        socket.close();
      }
      if (this.startupGuards.get(serial) === startupGuard) {
        this.startupGuards.delete(serial);
      }
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions, (session) => this.closeSession(session)));
  }

  isSerialStreaming(serial: string): boolean {
    const startupGuard = this.startupGuards.get(serial);
    return Array.from(this.sessions).some((session) => session.serial === serial) || Boolean(startupGuard && !startupGuard.canceled);
  }

  private async closeSessionsForSerial(serial: string): Promise<void> {
    await Promise.all(Array.from(this.sessions, (session) => (session.serial === serial ? this.closeSession(session) : undefined)));
  }

  private async closeSession(session: ScrcpyStreamSession): Promise<void> {
    if (!this.sessions.delete(session)) {
      return;
    }
    await session.reader?.cancel().catch(() => undefined);
    await session.client.close().catch(() => undefined);
  }
}

function sendJson(socket: WebSocket, message: MetadataMessage | ErrorMessage): void {
  socket.send(JSON.stringify(message));
}

function encodePacket(packet: ScrcpyMediaStreamPacket): Buffer {
  const data = packet.data;
  const output = Buffer.allocUnsafe(18 + data.byteLength);
  output.writeUInt8(packet.type === "configuration" ? 1 : 2, 0);
  output.writeUInt8(packet.type === "data" && packet.keyframe ? 1 : 0, 1);
  output.writeBigInt64BE(packet.type === "data" && typeof packet.pts === "bigint" ? packet.pts : -1n, 2);
  output.writeUInt32BE(data.byteLength, 10);
  output.writeUInt32BE(protocolVersion, 14);
  output.set(data, 18);
  return output;
}

function shouldDropVideoPacket(packet: ScrcpyMediaStreamPacket, bufferedAmount: number, droppingUntilKeyframe: boolean): boolean {
  if (packet.type !== "data") {
    return false;
  }
  if (droppingUntilKeyframe) {
    return !packet.keyframe;
  }
  return bufferedAmount > maxWebSocketBacklogBytes && !packet.keyframe;
}

function shouldStopStartup(socket: WebSocket, socketClosed: boolean, startupGuard: StartupGuard): boolean {
  return socketClosed || startupGuard.canceled || socket.readyState !== socket.OPEN;
}

async function handleClientMessage(client: AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>, text: string): Promise<void> {
  const message = JSON.parse(text) as ClientControlMessage;
  if (message.type !== "control") {
    return;
  }
  const controller = client.controller;
  if (!controller) {
    throw new Error("scrcpy control stream is not available");
  }
  await runScrcpyControlAction(controller, message.action, {
    width: sanitizeVideoSize(message.videoWidth),
    height: sanitizeVideoSize(message.videoHeight)
  });
}

async function runScrcpyControlAction(
  controller: NonNullable<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>["controller"]>,
  action: DeviceActionRequest,
  videoSize: { width: number; height: number }
): Promise<void> {
  if (action.type === "tap") {
    await injectTouch(controller, AndroidMotionEventAction.Down, action.x, action.y, videoSize, 1);
    await injectTouch(controller, AndroidMotionEventAction.Up, action.x, action.y, videoSize, 0);
    return;
  }
  if (action.type === "long_press") {
    await injectTouch(controller, AndroidMotionEventAction.Down, action.x, action.y, videoSize, 1);
    await sleep(action.durationMs ?? 800);
    await injectTouch(controller, AndroidMotionEventAction.Up, action.x, action.y, videoSize, 0);
    return;
  }
  if (action.type === "swipe") {
    const durationMs = Math.max(80, action.durationMs ?? 450);
    const moveCount = Math.max(4, Math.min(24, Math.round(durationMs / 16)));
    await injectTouch(controller, AndroidMotionEventAction.Down, action.startX, action.startY, videoSize, 1);
    for (let index = 1; index < moveCount; index += 1) {
      const progress = index / moveCount;
      await sleep(durationMs / moveCount);
      await injectTouch(
        controller,
        AndroidMotionEventAction.Move,
        interpolate(action.startX, action.endX, progress),
        interpolate(action.startY, action.endY, progress),
        videoSize,
        1
      );
    }
    await sleep(durationMs / moveCount);
    await injectTouch(controller, AndroidMotionEventAction.Up, action.endX, action.endY, videoSize, 0);
    return;
  }
  if (action.type === "back") {
    await controller.backOrScreenOn(AndroidKeyEventAction.Down);
    await controller.backOrScreenOn(AndroidKeyEventAction.Up);
    return;
  }
  if (action.type === "home") {
    await injectKey(controller, AndroidKeyCode.AndroidHome);
    return;
  }
  if (action.type === "recent_apps") {
    await injectKey(controller, AndroidKeyCode.AndroidAppSwitch);
    return;
  }
  if (action.type === "input_text") {
    await controller.injectText(action.text);
    return;
  }
  throw new Error(`scrcpy direct control does not support ${action.type}`);
}

async function injectTouch(
  controller: NonNullable<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>["controller"]>,
  action: AndroidMotionEventAction,
  x: number,
  y: number,
  videoSize: { width: number; height: number },
  pressure: number
): Promise<void> {
  const pressed = pressure > 0;
  await controller.injectTouch({
    action,
    pointerId: ScrcpyPointerId.Finger,
    pointerX: Math.round(x),
    pointerY: Math.round(y),
    videoWidth: videoSize.width,
    videoHeight: videoSize.height,
    pressure,
    actionButton: AndroidMotionEventButton.Primary,
    buttons: pressed ? AndroidMotionEventButton.Primary : AndroidMotionEventButton.None
  });
}

async function injectKey(
  controller: NonNullable<AdbScrcpyClient<AdbScrcpyOptionsLatest<true>>["controller"]>,
  keyCode: AndroidKeyCode
): Promise<void> {
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Down,
    keyCode,
    repeat: 0,
    metaState: AndroidKeyEventMeta.None
  });
  await controller.injectKeyCode({
    action: AndroidKeyEventAction.Up,
    keyCode,
    repeat: 0,
    metaState: AndroidKeyEventMeta.None
  });
}

function sanitizeVideoSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveScrcpyServerPath(): Promise<string> {
  const configured = process.env.SCRCPY_SERVER_PATH;
  const candidates = [
    configured,
    defaultServerPath,
    "/opt/homebrew/Cellar/scrcpy/3.3.3/share/scrcpy/scrcpy-server",
    "/usr/local/Cellar/scrcpy/3.3.3/share/scrcpy/scrcpy-server"
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => undefined);
    if (info?.isFile()) {
      return candidate;
    }
  }

  throw new Error("scrcpy-server v3.3.3 not found. Set SCRCPY_SERVER_PATH or place it at platform/tools/scrcpy-server-v3.3.3");
}
