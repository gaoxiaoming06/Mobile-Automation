import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentDistributionManifest,
  buildAgentInstallScript,
  registerAgentDistributionRoutes
} from "./agent-distribution.js";

describe("agent distribution", () => {
  const servers: Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("builds an idempotent install script for shared and paired agents", () => {
    const script = buildAgentInstallScript({ defaultServerUrl: "https://mobile.example.test" });

    expect(script).toContain("agent.pid");
    expect(script).toContain("kill -0");
    expect(script).toContain("/agent/manifest.json");
    expect(script).toContain("/agent/mobile-automation-agent.mjs");
    expect(script).toContain("--shared");
    expect(script).toContain("--pairing-code");
    expect(script).toContain("NODE_TLS_REJECT_UNAUTHORIZED=0");
    expect(script).toContain("DEVICE_AGENT_SHARED=1");
    expect(script).toContain("DEVICE_AGENT_PAIRING_CODE");
  });

  it("serves manifest, install script, and the agent bundle", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mobile-agent-dist-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "mobile-automation-agent.mjs"), "console.log('agent')\n");

    const app = express();
    registerAgentDistributionRoutes(app, {
      distributionDir: dir,
      version: "0.1.0-test",
      sha256: "abc123"
    });
    const baseUrl = await listen(app, servers);

    expect(await getJson(`${baseUrl}/agent/manifest.json`)).toEqual({
      version: "0.1.0-test",
      file: "mobile-automation-agent.mjs",
      url: "/agent/mobile-automation-agent.mjs",
      sha256: "abc123"
    });
    expect(await getText(`${baseUrl}/agent/install.sh?server=https%3A%2F%2Fmobile.example.test`)).toContain(
      'DEFAULT_SERVER_URL="https://mobile.example.test"'
    );
    expect(await getText(`${baseUrl}/agent/mobile-automation-agent.mjs`)).toBe("console.log('agent')\n");
  });

  it("creates stable manifest values", () => {
    expect(agentDistributionManifest({ version: "0.1.0", sha256: "abc123" })).toEqual({
      version: "0.1.0",
      file: "mobile-automation-agent.mjs",
      url: "/agent/mobile-automation-agent.mjs",
      sha256: "abc123"
    });
  });
});

async function listen(app: express.Express, servers: Server[]): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.text();
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}
