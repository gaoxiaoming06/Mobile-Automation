#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { DeviceAgentRuntime, parseDeviceAgentArgs, parseHarmonyStreamEnabled } from "./device-agent.js";
import { AgentHarmonyStreamClient } from "./agent-harmony-stream.js";
import { AgentScrcpyStreamClient } from "./agent-scrcpy-stream.js";
import { LocalDeviceAgentDriver } from "./local-device-driver.js";
import { createLocalAgentControl, InProcessAgentManager, MemoryLogBuffer, type ManagedAgentConfig } from "./local-agent-control.js";

const config = parseDeviceAgentArgs(process.argv.slice(2));
const controller = new AbortController();
const logBuffer = new MemoryLogBuffer();

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  console.log(`Mobile Automation device agent ${config.agentId} connecting to ${config.serverUrl}`);
  console.log(config.shared ? "Agent devices will be shared publicly." : "Agent devices stay private unless a pairing code is provided.");

  const driver = new LocalDeviceAgentDriver();
  const manager = new InProcessAgentManager(deviceConfigToManagedConfig(config), (nextConfig) => new DeviceAgentRuntime(nextConfig, driver, {
    scrcpy: new AgentScrcpyStreamClient(),
    ...(parseHarmonyStreamEnabled() ? { harmonyStream: new AgentHarmonyStreamClient() } : {}),
    write: (message) => {
      logBuffer.write(message);
      console.log(`[device-agent] ${message}`);
    }
  }), {
    logBuffer,
    agentFile: process.env.MOBILE_AUTOMATION_AGENT_FILE,
    relaunch: process.env.MOBILE_AUTOMATION_AGENT_FILE ? relaunchAgentProcess : undefined
  });
  const controlServer = createLocalAgentControl({ manager, version: config.version });

  const controlUrl = await controlServer.listen();
  console.log(`Mobile Automation Agent local control listening at ${controlUrl}`);

  await manager.start(deviceConfigToManagedConfig(config));

  controller.signal.addEventListener("abort", () => {
    void manager.stop().finally(() => controlServer.close());
  }, { once: true });
}

function deviceConfigToManagedConfig(input: typeof config): ManagedAgentConfig {
  return {
    serverUrl: input.serverUrl,
    agentId: input.agentId,
    shared: input.shared === true,
    ...(input.pairingCode ? { pairingCode: input.pairingCode } : {}),
    ...(input.version ? { version: input.version } : {}),
    insecureTls: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  };
}

function relaunchAgentProcess(nextConfig: ManagedAgentConfig): void {
  const agentFile = process.env.MOBILE_AUTOMATION_AGENT_FILE;
  if (!agentFile) {
    return;
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DEVICE_AGENT_SERVER_URL: nextConfig.serverUrl,
    DEVICE_AGENT_ID: nextConfig.agentId,
    DEVICE_AGENT_SHARED: nextConfig.shared ? "1" : undefined,
    DEVICE_AGENT_PAIRING_CODE: nextConfig.shared ? undefined : nextConfig.pairingCode,
    DEVICE_AGENT_VERSION: nextConfig.version ?? process.env.DEVICE_AGENT_VERSION,
    NODE_TLS_REJECT_UNAUTHORIZED: nextConfig.insecureTls ? "0" : process.env.NODE_TLS_REJECT_UNAUTHORIZED
  };
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) {
      delete env[key];
    }
  }
  const child = spawn(process.execPath, [agentFile], {
    detached: true,
    env,
    stdio: "ignore"
  });
  child.unref();
  setTimeout(() => process.exit(0), 50);
}
