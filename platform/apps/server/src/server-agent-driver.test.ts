import { describe, expect, it } from "vitest";
import {
  defaultAndroidCapabilities,
  nowIso,
  type DeviceActionRequest,
  type DeviceActionResult,
  type DeviceInfo,
  type MetricSample,
  type ToolStatus
} from "@mobile-automation/shared";
import type { AutomationDeviceDriver, MobileVideoRecording } from "./device-driver.js";
import { ServerAgentDeviceDriver } from "./server-agent-driver.js";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T08:00:00.000Z";

describe("ServerAgentDeviceDriver", () => {
  it("prefers shared agent devices over matching local mirrors", async () => {
    const local = new FakeLocalDriver();
    const registry = new ServerAgentRegistry({ now: () => now });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        {
          serial: "local-1",
          platform: "android",
          name: "Remote Pixel",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });
    const driver = new ServerAgentDeviceDriver(local, registry);

    await expect(driver.listDevices()).resolves.toEqual([
      expect.objectContaining({
        serial: "agent-a:android:local-1",
        name: "Remote Pixel",
        agent: expect.objectContaining({ serial: "local-1", deviceKey: "agent-a:android:local-1" })
      })
    ]);
  });

  it("keeps local devices that are not mirrored by an agent", async () => {
    const local = new FakeLocalDriver();
    const registry = new ServerAgentRegistry({ now: () => now });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        {
          serial: "remote-1",
          platform: "android",
          name: "Remote Pixel",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });
    const driver = new ServerAgentDeviceDriver(local, registry);

    await expect(driver.listDevices()).resolves.toEqual([
      expect.objectContaining({ serial: "local-1", name: "Local Pixel" }),
      expect.objectContaining({ serial: "agent-a:android:remote-1", name: "Remote Pixel" })
    ]);
  });

  it("runs in agent-only mode without exposing or using local devices", async () => {
    const registry = new ServerAgentRegistry({ now: () => now });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
      devices: [
        {
          serial: "local-1",
          platform: "android",
          name: "Remote Pixel",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });
    const driver = ServerAgentDeviceDriver.agentOnly(registry);

    await expect(driver.getToolStatus()).resolves.toEqual([
      expect.objectContaining({ name: "agent:agent-a:adb", available: true, version: "1.0.41" })
    ]);
    await expect(driver.listDevices()).resolves.toEqual([
      expect.objectContaining({ serial: "agent-a:android:local-1", name: "Remote Pixel" })
    ]);
    await expect(driver.screenshot("local-1")).rejects.toThrow("Server local device access is disabled");
  });

  it("routes read-only agent operations through command envelopes", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: () => "request-1"
    });
    registry.registerAgent({
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
    const driver = new ServerAgentDeviceDriver(new FakeLocalDriver(), registry);

    const screenshot = driver.screenshot("agent-a:android:pixel-1");
    expect(registry.takePendingCommands("agent-a")).toEqual([
      {
        type: "command",
        protocolVersion: "server-agent-v1",
        requestId: "request-1",
        agentId: "agent-a",
        deviceKey: "agent-a:android:pixel-1",
        platform: "android",
        timestamp: now,
        command: "screenshot"
      }
    ]);
    registry.completeCommand("agent-a", "request-1", {
      ok: true,
      dataBase64: Buffer.from("png").toString("base64"),
      contentType: "image/png"
    });
    await expect(screenshot).resolves.toEqual(Buffer.from("png"));

    const hierarchy = driver.dumpUiHierarchy("agent-a:android:pixel-1");
    const [command] = registry.takePendingCommands("agent-a");
    expect(command).toEqual(expect.objectContaining({ command: "dumpUiHierarchy", requestId: expect.any(String) }));
    registry.completeCommand("agent-a", command.requestId, { ok: true, result: { uiHierarchyXml: "<hierarchy />" } });
    await expect(hierarchy).resolves.toBe("<hierarchy />");
  });

  it("coalesces concurrent agent screenshots for the same device", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: sequentialIds("request-screen-1", "request-screen-2")
    });
    registry.registerAgent({
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
    const driver = new ServerAgentDeviceDriver(new FakeLocalDriver(), registry);

    const first = driver.screenshot("agent-a:android:pixel-1");
    const second = driver.screenshot("agent-a:android:pixel-1");

    expect(registry.takePendingCommands("agent-a")).toEqual([
      expect.objectContaining({ requestId: "request-screen-1", command: "screenshot" })
    ]);

    registry.completeCommand("agent-a", "request-screen-1", {
      ok: true,
      dataBase64: Buffer.from("png").toString("base64"),
      contentType: "image/png"
    });

    await expect(Promise.all([first, second])).resolves.toEqual([Buffer.from("png"), Buffer.from("png")]);

    const third = driver.screenshot("agent-a:android:pixel-1");
    expect(registry.takePendingCommands("agent-a")).toEqual([
      expect.objectContaining({ requestId: "request-screen-2", command: "screenshot" })
    ]);
    registry.completeCommand("agent-a", "request-screen-2", {
      ok: true,
      dataBase64: Buffer.from("png2").toString("base64"),
      contentType: "image/png"
    });
    await expect(third).resolves.toEqual(Buffer.from("png2"));
  });

  it("falls back to the local driver for non-agent devices", async () => {
    const local = new FakeLocalDriver();
    const driver = new ServerAgentDeviceDriver(local, new ServerAgentRegistry({ now: () => now }));

    await expect(driver.screenshot("local-1")).resolves.toEqual(Buffer.from("local"));

    expect(local.screenshotSerials).toEqual(["local-1"]);
  });

  it("routes agent write actions, logs, foreground state, and metrics through command envelopes", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: sequentialIds("request-action", "request-clear", "request-logs", "request-metric", "request-foreground")
    });
    registry.registerAgent({
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
    const driver = new ServerAgentDeviceDriver(new FakeLocalDriver(), registry);

    const action = driver.performAction("agent-a:android:pixel-1", { type: "tap", x: 4, y: 9 });
    const semanticAction = driver.performSemanticAction("agent-a:android:pixel-1", { type: "tap_on_element", locator: { text: "登录" } });
    const clear = driver.clearAppData("agent-a:android:pixel-1", "cn.eeo.classin");
    const logs = driver.collectLogs("agent-a:android:pixel-1", 50);
    const metric = driver.samplePerformance("agent-a:android:pixel-1", "run-1", "step-1");
    const foreground = driver.getForegroundApp("agent-a:android:pixel-1");

    expect(registry.takePendingCommands("agent-a")).toEqual([
      expect.objectContaining({ requestId: "request-action", command: "performAction", payload: { action: { type: "tap", x: 4, y: 9 } } }),
      expect.objectContaining({ requestId: "request-clear", command: "performSemanticAction", payload: { action: { type: "tap_on_element", locator: { text: "登录" } } } }),
      expect.objectContaining({ requestId: "request-logs", command: "clearAppData", payload: { packageName: "cn.eeo.classin" } }),
      expect.objectContaining({ requestId: "request-metric", command: "collectLogs", payload: { lines: 50 } }),
      expect.objectContaining({ requestId: "request-foreground", command: "samplePerformance", payload: { runId: "run-1", stepResultId: "step-1" } }),
      expect.objectContaining({ requestId: "request-6", command: "getForegroundApp" })
    ]);

    registry.completeCommand("agent-a", "request-action", { ok: true, result: { driverChannel: "mock" } });
    registry.completeCommand("agent-a", "request-clear", { ok: true, result: { driverChannel: "mock" } });
    registry.completeCommand("agent-a", "request-logs", { ok: true, result: {} });
    registry.completeCommand("agent-a", "request-metric", { ok: true, result: { logs: "log tail" } });
    registry.completeCommand("agent-a", "request-foreground", {
      ok: true,
      result: { metric: { id: "metric-1", runId: "run-1", stepResultId: "step-1", deviceSerial: "pixel-1", sampledAt: now } }
    });
    registry.completeCommand("agent-a", "request-6", { ok: true, result: { packageName: "cn.eeo.classin", activityName: ".MainActivity" } });

    await expect(action).resolves.toEqual({ driverChannel: "mock" });
    await expect(semanticAction).resolves.toEqual({ driverChannel: "mock" });
    await expect(clear).resolves.toBeUndefined();
    await expect(logs).resolves.toBe("log tail");
    await expect(metric).resolves.toEqual({ id: "metric-1", runId: "run-1", stepResultId: "step-1", deviceSerial: "pixel-1", sampledAt: now });
    await expect(foreground).resolves.toEqual({ packageName: "cn.eeo.classin", activityName: ".MainActivity" });
  });
});

class FakeLocalDriver implements AutomationDeviceDriver {
  readonly screenshotSerials: string[] = [];

  async getToolStatus(): Promise<ToolStatus[]> {
    return [{ name: "adb", available: true }];
  }

  async listDevices(): Promise<DeviceInfo[]> {
    return [{
      id: "local-1",
      serial: "local-1",
      platform: "android",
      name: "Local Pixel",
      status: "online",
      capabilities: defaultAndroidCapabilities(),
      lastSeenAt: now
    }];
  }

  async getDeviceInfo(serial: string): Promise<DeviceInfo> {
    return {
      id: serial,
      serial,
      platform: "android",
      status: "online",
      capabilities: defaultAndroidCapabilities(),
      lastSeenAt: nowIso()
    };
  }

  async screenshot(serial: string): Promise<Buffer> {
    this.screenshotSerials.push(serial);
    return Buffer.from("local");
  }

  async performAction(_serial: string, _action: DeviceActionRequest): Promise<DeviceActionResult> {
    return { driverChannel: "mock" };
  }

  async clearAppData(): Promise<void> {
    return undefined;
  }

  async collectLogs(): Promise<string> {
    return "";
  }

  async samplePerformance(serial: string, runId: string): Promise<MetricSample> {
    return { id: "metric-1", runId, deviceSerial: serial, sampledAt: nowIso() };
  }

  async startVideoRecording(): Promise<MobileVideoRecording> {
    throw new Error("unsupported");
  }

  async stopVideoRecording(): Promise<string | undefined> {
    return undefined;
  }
}

function sequentialIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `request-${index}`;
}
