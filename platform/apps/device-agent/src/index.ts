#!/usr/bin/env tsx
import { DeviceAgentRuntime, parseDeviceAgentArgs, parseHarmonyStreamEnabled } from "./device-agent.js";
import { AgentHarmonyStreamClient } from "./agent-harmony-stream.js";
import { AgentScrcpyStreamClient } from "./agent-scrcpy-stream.js";
import { LocalDeviceAgentDriver } from "./local-device-driver.js";

const config = parseDeviceAgentArgs(process.argv.slice(2));
const controller = new AbortController();

process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

console.log(`Mobile Automation device agent ${config.agentId} connecting to ${config.serverUrl}`);
console.log(config.shared ? "Agent devices will be shared publicly." : "Agent devices stay private unless a pairing code is provided.");

const runtime = new DeviceAgentRuntime(config, new LocalDeviceAgentDriver(), {
  scrcpy: new AgentScrcpyStreamClient(),
  ...(parseHarmonyStreamEnabled() ? { harmonyStream: new AgentHarmonyStreamClient() } : {}),
  write: (message) => console.log(`[device-agent] ${message}`)
});

runtime.start(controller.signal).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
