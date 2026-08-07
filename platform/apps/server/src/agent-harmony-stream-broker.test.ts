import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { defaultHarmonyCapabilities } from "@mobile-automation/shared";
import { AgentHarmonyStreamBroker } from "./agent-harmony-stream-broker.js";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T10:30:00.000Z";

describe("AgentHarmonyStreamBroker", () => {
  it("requests one Harmony stream and fans it out to multiple browser sockets", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "harmony-1",
        platform: "harmony",
        status: "online",
        capabilities: {
          ...defaultHarmonyCapabilities(),
          harmonyScreenStream: true
        }
      }]
    });
    const broker = new AgentHarmonyStreamBroker(registry, { streamIdGenerator: () => "harmony-stream-1" });
    const firstBrowser = new FakeSocket();
    const secondBrowser = new FakeSocket();
    const agent = new FakeSocket();

    broker.attachBrowser("agent-a:harmony:harmony-1", firstBrowser);
    const [command] = registry.takePendingCommands("agent-a");
    expect(command).toEqual(expect.objectContaining({
      requestId: "request-1",
      command: "startHarmonyStream",
      payload: { streamId: "harmony-stream-1" }
    }));
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "harmony-stream-1" } });
    broker.attachAgent("agent-a", "harmony-stream-1", agent);
    broker.attachBrowser("agent-a:harmony:harmony-1", secondBrowser);

    const metadata = JSON.stringify({ type: "metadata", codecName: "h264" });
    const configuration = Buffer.from([1, 0, 0, 0]);
    const frame = Buffer.from([2, 1, 9, 9]);
    agent.emitMessage(metadata, false);
    agent.emitMessage(configuration, true);
    agent.emitMessage(frame, true);

    expect(firstBrowser.sent).toEqual([
      { data: metadata, options: { binary: false } },
      { data: configuration, options: { binary: true } },
      { data: frame, options: { binary: true } }
    ]);
    expect(secondBrowser.sent).toEqual([
      { data: metadata, options: { binary: false } },
      { data: configuration, options: { binary: true } },
      { data: frame, options: { binary: true } }
    ]);
    expect(registry.takePendingCommands("agent-a")).toEqual([]);
    expect(broker.isDeviceStreaming("agent-a:harmony:harmony-1")).toBe(true);
  });

  it("replays cached Harmony stream state to a browser that joins after frames started", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "harmony-1",
        platform: "harmony",
        status: "online",
        capabilities: {
          ...defaultHarmonyCapabilities(),
          harmonyScreenStream: true
        }
      }]
    });
    const broker = new AgentHarmonyStreamBroker(registry, { streamIdGenerator: () => "harmony-stream-1" });
    const firstBrowser = new FakeSocket();
    const secondBrowser = new FakeSocket();
    const agent = new FakeSocket();

    broker.attachBrowser("agent-a:harmony:harmony-1", firstBrowser);
    registry.takePendingCommands("agent-a");
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "harmony-stream-1" } });
    broker.attachAgent("agent-a", "harmony-stream-1", agent);

    const metadata = JSON.stringify({ type: "metadata", codecName: "h264" });
    const configuration = Buffer.from([1, 0, 0, 0]);
    const keyframe = Buffer.from([2, 1, 9, 9]);
    const deltaFrame = Buffer.from([2, 0, 7, 7]);
    agent.emitMessage(metadata, false);
    agent.emitMessage(configuration, true);
    agent.emitMessage(keyframe, true);
    agent.emitMessage(deltaFrame, true);

    broker.attachBrowser("agent-a:harmony:harmony-1", secondBrowser);

    expect(secondBrowser.sent).toEqual([
      { data: metadata, options: { binary: false } },
      { data: configuration, options: { binary: true } },
      { data: keyframe, options: { binary: true } }
    ]);
  });

  it("rejects Harmony streams when the device has no stream capability", () => {
    const registry = new ServerAgentRegistry({ now: () => now });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "harmony-1",
        platform: "harmony",
        status: "online",
        capabilities: defaultHarmonyCapabilities()
      }]
    });
    const broker = new AgentHarmonyStreamBroker(registry);
    const browser = new FakeSocket();

    broker.attachBrowser("agent-a:harmony:harmony-1", browser);

    expect(browser.sent).toEqual([{
      data: JSON.stringify({ type: "error", message: "HarmonyOS realtime preview requires a registered HarmonyOS agent device with harmonyScreenStream capability." }),
      options: undefined
    }]);
    expect(browser.closed).toBe(true);
  });
});

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: Array<{ data: unknown; options?: { binary?: boolean } }> = [];
  closed = false;

  send(data: unknown, options?: { binary?: boolean }): void {
    this.sent.push({ data, options });
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }

  emitMessage(data: unknown, isBinary: boolean): void {
    this.emit("message", data, isBinary);
  }
}
