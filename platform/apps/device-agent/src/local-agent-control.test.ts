import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalAgentControl,
  InProcessAgentManager,
  MemoryLogBuffer,
  type LocalAgentManager,
  type ManagedAgentConfig
} from "./local-agent-control.js";
import type { DeviceAgentRuntime } from "./device-agent.js";

describe("local agent control", () => {
  const controls: Array<{ close(): Promise<void> }> = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(controls.splice(0).map((control) => control.close()));
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("starts, switches, stops, and reports the in-process managed agent", async () => {
    const manager = new FakeLocalAgentManager();
    const control = createLocalAgentControl({ host: "127.0.0.1", port: 0, manager });
    controls.push(control);
    const baseUrl = await control.listen();

    await expect(getJson(`${baseUrl}/status`)).resolves.toMatchObject({
      ok: true,
      control: { running: true },
      agent: { running: false }
    });

    await expect(postJson(`${baseUrl}/start`, {
      serverUrl: "http://server.test/",
      agentId: "macbook-a",
      shared: true
    })).resolves.toMatchObject({
      ok: true,
      agent: { running: true, pid: process.pid }
    });
    expect(manager.starts.at(-1)).toMatchObject({
      serverUrl: "http://server.test",
      agentId: "macbook-a",
      shared: true
    });

    await postJson(`${baseUrl}/start`, {
      serverUrl: "http://server.test",
      agentId: "macbook-a",
      shared: false,
      pairingCode: "123456",
      insecureTls: true
    });
    expect(manager.stops).toBe(1);
    expect(manager.starts.at(-1)).toMatchObject({
      shared: false,
      pairingCode: "123456",
      insecureTls: true
    });

    await expect(postJson(`${baseUrl}/stop`, {})).resolves.toMatchObject({
      ok: true,
      agent: { running: false, pid: process.pid }
    });
    expect(manager.stops).toBe(2);
  });

  it("keeps the control server alive after stopping the runtime", async () => {
    const runtime = new FakeRuntime();
    const manager = new InProcessAgentManager({
      serverUrl: "http://server.test",
      agentId: "agent-a",
      shared: true
    }, () => runtime as unknown as DeviceAgentRuntime);
    const control = createLocalAgentControl({ host: "127.0.0.1", port: 0, manager });
    controls.push(control);
    const baseUrl = await control.listen();

    await postJson(`${baseUrl}/start`, {
      serverUrl: "http://server.test",
      agentId: "agent-a",
      shared: true
    });
    await postJson(`${baseUrl}/stop`, {});

    expect(runtime.aborted).toBe(true);
    await expect(getJson(`${baseUrl}/status`)).resolves.toMatchObject({
      ok: true,
      agent: { running: false }
    });
  });

  it("reports the latest registration error while the agent process is running", async () => {
    const logBuffer = new MemoryLogBuffer();
    const manager = new InProcessAgentManager({
      serverUrl: "http://server.test",
      agentId: "agent-a",
      shared: false,
      pairingCode: "123456"
    }, () => new FakeRuntime() as unknown as DeviceAgentRuntime, { logBuffer });

    await manager.start({
      serverUrl: "http://server.test",
      agentId: "agent-a",
      shared: false,
      pairingCode: "123456"
    });
    logBuffer.write("agent sync failed: /api/agents/register failed (400): Pairing code is invalid or expired");

    await expect(manager.status()).resolves.toMatchObject({
      running: true,
      registrationError: "/api/agents/register failed (400): Pairing code is invalid or expired"
    });

    await manager.start({
      serverUrl: "http://server.test",
      agentId: "agent-a",
      shared: true
    });

    await expect(manager.status()).resolves.not.toHaveProperty("registrationError");
  });

  it("clears a previous registration error when the agent registers again", () => {
    const logBuffer = new MemoryLogBuffer();

    logBuffer.write("agent sync failed: /api/agents/register failed (400): Pairing code is invalid or expired");
    expect(logBuffer.registrationError()).toBe("/api/agents/register failed (400): Pairing code is invalid or expired");
    expect(logBuffer.serverConnected()).toBe(false);

    logBuffer.write("agent registered");

    expect(logBuffer.registrationError()).toBeUndefined();
    expect(logBuffer.serverConnected()).toBe(true);
  });

  it("exposes CORS headers for dashboard calls from the browser", async () => {
    const control = createLocalAgentControl({ host: "127.0.0.1", port: 0, manager: new FakeLocalAgentManager() });
    controls.push(control);
    const baseUrl = await control.listen();

    const response = await fetch(`${baseUrl}/status`, {
      method: "OPTIONS",
      headers: { origin: "http://dashboard.test" }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://dashboard.test");
    expect(response.headers.get("access-control-allow-private-network")).toBe("true");
  });
});

class FakeLocalAgentManager implements LocalAgentManager {
  starts: ManagedAgentConfig[] = [];
  stops = 0;
  private running = false;

  async status() {
    return { running: this.running, pid: process.pid, config: this.starts.at(-1) };
  }

  async start(config: ManagedAgentConfig) {
    if (this.running) {
      await this.stop();
    }
    this.starts.push(config);
    this.running = true;
    return this.status();
  }

  async stop() {
    this.stops += 1;
    this.running = false;
    return this.status();
  }

  async restart() {
    const config = this.starts.at(-1);
    if (!config) {
      return this.status();
    }
    return this.start(config);
  }

  async updateFromServer() {
    return {
      version: "0.2.0",
      agentChanged: false,
      restartRequired: false,
      agent: await this.status()
    };
  }

  async logs() {
    return "agent log";
  }
}

class FakeRuntime implements Pick<DeviceAgentRuntime, "start"> {
  aborted = false;

  async start(signal?: AbortSignal) {
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => {
        this.aborted = true;
        resolve();
      }, { once: true });
    });
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  expect(response.status).toBe(200);
  return response.json();
}
