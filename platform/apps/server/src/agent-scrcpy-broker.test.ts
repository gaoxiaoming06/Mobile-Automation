import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities } from "@mobile-automation/shared";
import { AgentScrcpyBroker } from "./agent-scrcpy-broker.js";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T10:00:00.000Z";

describe("AgentScrcpyBroker", () => {
  it("requests an agent stream and relays traffic between browser and agent sockets", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "android-1",
        platform: "android",
        status: "online",
        capabilities: defaultAndroidCapabilities()
      }]
    });
    const broker = new AgentScrcpyBroker(registry, { streamIdGenerator: () => "stream-1" });
    const browser = new FakeSocket();
    const agent = new FakeSocket();
    const lease = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:android-1",
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    });

    broker.attachBrowser("agent-a:android:android-1", browser);
    const [command] = registry.takePendingCommands("agent-a");
    expect(command).toEqual(expect.objectContaining({
      requestId: "request-1",
      command: "startScrcpyStream",
      payload: { streamId: "stream-1" }
    }));
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "stream-1" } });

    broker.attachAgent("agent-a", "stream-1", agent);
    browser.emitMessage(JSON.stringify({
      type: "control",
      action: { type: "back" },
      videoWidth: 1080,
      videoHeight: 2340,
      leaseId: lease.id,
      ownerId: lease.ownerId
    }), false);
    agent.emitMessage(Buffer.from([1, 2, 3]), true);

    expect(agent.sent).toEqual([{
      data: JSON.stringify({
        type: "control",
        action: { type: "back" },
        videoWidth: 1080,
        videoHeight: 2340,
        leaseId: lease.id,
        ownerId: lease.ownerId
      }),
      options: { binary: false }
    }]);
    expect(browser.sent).toEqual([{ data: Buffer.from([1, 2, 3]), options: { binary: true } }]);
    expect(broker.isDeviceStreaming("agent-a:android:android-1")).toBe(true);
  });

  it("fans out one Android scrcpy stream to multiple browser sockets", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "android-1",
        platform: "android",
        status: "online",
        capabilities: defaultAndroidCapabilities()
      }]
    });
    const broker = new AgentScrcpyBroker(registry, { streamIdGenerator: () => "stream-1" });
    const firstBrowser = new FakeSocket();
    const secondBrowser = new FakeSocket();
    const agent = new FakeSocket();

    broker.attachBrowser("agent-a:android:android-1", firstBrowser);
    const [command] = registry.takePendingCommands("agent-a");
    expect(command).toEqual(expect.objectContaining({
      requestId: "request-1",
      command: "startScrcpyStream",
      payload: { streamId: "stream-1" }
    }));
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "stream-1" } });
    broker.attachAgent("agent-a", "stream-1", agent);
    broker.attachBrowser("agent-a:android:android-1", secondBrowser);

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
    expect(broker.isDeviceStreaming("agent-a:android:android-1")).toBe(true);
  });

  it("replays cached Android stream state to a browser that joins after frames started", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "android-1",
        platform: "android",
        status: "online",
        capabilities: defaultAndroidCapabilities()
      }]
    });
    const broker = new AgentScrcpyBroker(registry, { streamIdGenerator: () => "stream-1" });
    const firstBrowser = new FakeSocket();
    const secondBrowser = new FakeSocket();
    const agent = new FakeSocket();

    broker.attachBrowser("agent-a:android:android-1", firstBrowser);
    registry.takePendingCommands("agent-a");
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "stream-1" } });
    broker.attachAgent("agent-a", "stream-1", agent);

    const metadata = JSON.stringify({ type: "metadata", codecName: "h264" });
    const configuration = Buffer.from([1, 0, 0, 0]);
    const keyframe = Buffer.from([2, 1, 9, 9]);
    const deltaFrame = Buffer.from([2, 0, 7, 7]);
    agent.emitMessage(metadata, false);
    agent.emitMessage(configuration, true);
    agent.emitMessage(keyframe, true);
    agent.emitMessage(deltaFrame, true);

    broker.attachBrowser("agent-a:android:android-1", secondBrowser);

    expect(secondBrowser.sent).toEqual([
      { data: metadata, options: { binary: false } },
      { data: configuration, options: { binary: true } },
      { data: keyframe, options: { binary: true } }
    ]);
  });

  it("rejects scrcpy control messages without the active device lease", () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [{
        serial: "android-1",
        platform: "android",
        status: "online",
        capabilities: defaultAndroidCapabilities()
      }]
    });
    registry.acquireDeviceLease({
      deviceKey: "agent-a:android:android-1",
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    });
    const broker = new AgentScrcpyBroker(registry, { streamIdGenerator: () => "stream-1" });
    const browser = new FakeSocket();
    const agent = new FakeSocket();

    broker.attachBrowser("agent-a:android:android-1", browser);
    registry.takePendingCommands("agent-a");
    registry.completeCommand("agent-a", "request-1", { ok: true, result: { streamId: "stream-1" } });
    broker.attachAgent("agent-a", "stream-1", agent);
    browser.emitMessage(JSON.stringify({
      type: "control",
      action: { type: "back" },
      videoWidth: 1080,
      videoHeight: 2340
    }), false);

    expect(agent.sent).toEqual([]);
    expect(browser.sent).toEqual([{
      data: JSON.stringify({ type: "control_error", message: "Scrcpy control requires the active device lease." }),
      options: undefined
    }]);
  });

  it("rejects scrcpy streams for non-agent device serials", () => {
    const broker = new AgentScrcpyBroker(new ServerAgentRegistry({ now: () => now }));
    const browser = new FakeSocket();

    broker.attachBrowser("android-1", browser);

    expect(browser.sent).toEqual([{
      data: JSON.stringify({ type: "error", message: "Agent scrcpy preview requires a registered Android agent device." }),
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
