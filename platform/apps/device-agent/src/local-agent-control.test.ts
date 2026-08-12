import { createServer, type Server } from "node:http";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(controls.splice(0).map((control) => control.close()));
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  it("applies insecure TLS mode before starting the in-process runtime", async () => {
    const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    let observedTlsSetting: string | undefined;
    const manager = new InProcessAgentManager(undefined, () => ({
      start: async (signal?: AbortSignal) => {
        observedTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    }) as unknown as DeviceAgentRuntime);

    try {
      await manager.start({
        serverUrl: "https://server.test",
        agentId: "agent-a",
        shared: false,
        pairingCode: "123456",
        insecureTls: true
      });

      expect(observedTlsSetting).toBe("0");
    } finally {
      await manager.stop();
      if (originalTlsSetting === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
      }
    }
  });

  it("downloads the bundled scrcpy server during managed updates", async () => {
    const agentHome = await mkdtemp(path.join(os.tmpdir(), "mobile-agent-update-"));
    tempDirs.push(agentHome);
    const agentFile = path.join(agentHome, "mobile-automation-agent.cjs");
    await writeFile(agentFile, "old agent");
    const server = createServer((req, res) => {
      if (req.url === "/agent/manifest.json") {
        sendTestJson(res, {
          version: "0.2.0",
          url: "/agent/mobile-automation-agent.cjs",
          sha256: sha256Text("new agent"),
          scrcpyServer: {
            file: "scrcpy-server-v3.3.3",
            url: "/agent/scrcpy-server-v3.3.3",
            sha256: sha256Text("scrcpy server")
          }
        });
        return;
      }
      if (req.url === "/agent/mobile-automation-agent.cjs") {
        res.writeHead(200).end("new agent");
        return;
      }
      if (req.url === "/agent/scrcpy-server-v3.3.3") {
        res.writeHead(200).end("scrcpy server");
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);
    const serverUrl = await listen(server);
    const manager = new InProcessAgentManager({
      serverUrl,
      agentId: "agent-a",
      shared: true
    }, () => new FakeRuntime() as unknown as DeviceAgentRuntime, { agentFile });

    await manager.updateFromServer({ serverUrl });

    await expect(readFile(agentFile, "utf8")).resolves.toBe("new agent");
    await expect(readFile(path.join(agentHome, "scrcpy-server-v3.3.3"), "utf8")).resolves.toBe("scrcpy server");
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

function sendTestJson(res: { writeHead(status: number, headers?: Record<string, string>): unknown; end(body?: string): unknown }, body: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("server did not bind to a port");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
