import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAndroidCapabilities } from "@mobile-automation/shared";
import { registerServerAgentRoutes } from "./server-agent-api.js";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T08:00:00.000Z";

describe("server agent API", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("registers agents, lists public devices, and polls command work", async () => {
    const context = await apiContext(servers);

    expect(await post(context.baseUrl, "/api/agents/register", {
      agentId: "agent-a",
      version: "1.0.0",
      shared: true,
      devices: [
        {
          serial: "pixel-1",
          platform: "android",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    })).toEqual({
      status: 201,
      body: {
        agent: expect.objectContaining({ agentId: "agent-a", version: "1.0.0", shared: true }),
        devices: [expect.objectContaining({ deviceKey: "agent-a:android:pixel-1" })]
      }
    });

    expect(await get(context.baseUrl, "/api/agent-devices")).toEqual({
      status: 200,
      body: {
        devices: [expect.objectContaining({ serial: "agent-a:android:pixel-1" })]
      }
    });

    const rpc = context.registry.sendCommand("agent-a:android:pixel-1", "getDeviceInfo");
    expect(await get(context.baseUrl, "/api/agents/agent-a/commands")).toEqual({
      status: 200,
      body: {
        commands: [expect.objectContaining({
          type: "command",
          protocolVersion: "server-agent-v1",
          command: "getDeviceInfo",
          requestId: expect.any(String),
          deviceKey: "agent-a:android:pixel-1"
        })]
      }
    });
    await post(context.baseUrl, "/api/agents/agent-a/commands/request-1/result", {
      ok: true,
      result: { device: { serial: "pixel-1", platform: "android" } }
    });

    await expect(rpc).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("creates pairing codes that reveal private devices only to the paired session", async () => {
    const context = await apiContext(servers);
    const pairing = await post(context.baseUrl, "/api/local-sessions/pairing-codes", { sessionId: "browser-1", ttlMs: 60_000 });

    expect(pairing).toEqual({
      status: 201,
      body: {
        pairing: expect.objectContaining({ code: "654321", sessionId: "browser-1", paired: false })
      }
    });

    await post(context.baseUrl, "/api/agents/register", {
      agentId: "agent-private",
      pairingCode: "654321",
      devices: [
        {
          serial: "pixel-1",
          platform: "android",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });

    expect(await get(context.baseUrl, "/api/agent-devices")).toEqual({ status: 200, body: { devices: [] } });
    expect(await get(context.baseUrl, "/api/agent-devices?sessionId=browser-1")).toEqual({
      status: 200,
      body: {
        devices: [expect.objectContaining({
          serial: "agent-private:android:pixel-1",
          agent: expect.objectContaining({ visibility: "paired" })
        })]
      }
    });
  });

  it("exposes device lease acquire, list, and release endpoints", async () => {
    const context = await apiContext(servers);
    await post(context.baseUrl, "/api/agents/register", {
      agentId: "agent-a",
      shared: true,
      devices: [
        {
          serial: "pixel-1",
          platform: "android",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });

    expect(await post(context.baseUrl, "/api/agent-devices/agent-a%3Aandroid%3Apixel-1/leases", {
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    })).toEqual({
      status: 201,
      body: {
        lease: expect.objectContaining({
          id: "lease-1",
          type: "manual_control",
          ownerId: "browser-a"
        })
      }
    });

    expect(await get(context.baseUrl, "/api/agent-devices/agent-a%3Aandroid%3Apixel-1/leases")).toEqual({
      status: 200,
      body: {
        leases: [expect.objectContaining({ id: "lease-1", ownerId: "browser-a" })]
      }
    });

    expect(await del(context.baseUrl, "/api/agent-devices/agent-a%3Aandroid%3Apixel-1/leases/lease-1", {
      ownerId: "browser-a"
    })).toEqual({ status: 200, body: { released: true } });
  });
});

async function apiContext(servers: Server[]) {
  const registry = new ServerAgentRegistry({
    now: () => now,
    requestIdGenerator: () => "request-1",
    leaseIdGenerator: () => "lease-1",
    pairingCodeGenerator: () => "654321"
  });
  const app = express();
  app.use(express.json());
  registerServerAgentRoutes(app, { registry });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server address unavailable");
  return { baseUrl: `http://127.0.0.1:${address.port}`, registry };
}

async function get(baseUrl: string, pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, body: await response.json() };
}

async function post(baseUrl: string, pathname: string, body: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function del(baseUrl: string, pathname: string, body: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
