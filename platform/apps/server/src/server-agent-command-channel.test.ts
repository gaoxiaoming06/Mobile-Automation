import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { defaultAndroidCapabilities } from "@mobile-automation/shared";
import { attachAgentCommandSocket } from "./server-agent-command-channel.js";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T08:00:00.000Z";

describe("attachAgentCommandSocket", () => {
  it("pushes queued commands to the connected agent immediately", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });
    const socket = new FakeWebSocket();
    attachAgentCommandSocket({ registry, agentId: "agent-a", socket: socket as unknown as WebSocket });

    const pending = registry.sendCommand("agent-a:android:pixel-1", "getDeviceInfo");

    expect(socket.messages).toEqual([
      expect.stringContaining("\"type\":\"commands\"")
    ]);
    const message = JSON.parse(socket.messages[0] ?? "{}") as { commands?: Array<{ requestId: string }> };
    expect(message.commands?.[0]?.requestId).toBe("request-1");
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { deliveredBy: "ws" } });

    await expect(pending).resolves.toEqual(expect.objectContaining({
      ok: true,
      result: { deliveredBy: "ws" }
    }));
  });

  it("unsubscribes when the socket closes", () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });
    const socket = new FakeWebSocket();
    attachAgentCommandSocket({ registry, agentId: "agent-a", socket: socket as unknown as WebSocket });

    socket.emit("close");
    const pending = registry.sendCommand("agent-a:android:pixel-1", "getDeviceInfo");

    expect(socket.messages).toEqual([]);
    const [command] = registry.takePendingCommands("agent-a");
    expect(command?.requestId).toBe("request-1");
    registry.completeCommand("agent-a", "request-1", { ok: true, result: {} });
    return pending;
  });
});

class FakeWebSocket extends EventEmitter {
  readonly messages: string[] = [];
  readyState = WebSocket.OPEN;

  send(message: string): void {
    this.messages.push(message);
  }
}
