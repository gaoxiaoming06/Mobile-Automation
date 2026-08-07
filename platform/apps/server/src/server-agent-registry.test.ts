import { describe, expect, it } from "vitest";
import { defaultAndroidCapabilities, defaultIosCapabilities } from "@mobile-automation/shared";
import { ServerAgentRegistry } from "./server-agent-registry.js";

const now = "2026-08-07T08:00:00.000Z";

describe("ServerAgentRegistry", () => {
  it("registers an agent snapshot and exposes only shared devices by default", () => {
    const registry = new ServerAgentRegistry({ now: () => now });

    registry.registerAgent({
      agentId: " agent-a ",
      version: "1.2.3",
      shared: false,
      maxConcurrentRuns: 2,
      currentRunCount: 1,
      toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
      devices: [
        {
          serial: "pixel-1",
          platform: "android",
          name: "Pixel 8",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });

    expect(registry.listAgents()).toEqual([
      expect.objectContaining({
        agentId: "agent-a",
        status: "online",
        shared: false,
        version: "1.2.3",
        maxConcurrentRuns: 2,
        currentRunCount: 1,
        toolStatus: [{ name: "adb", available: true, version: "1.0.41" }],
        lastHeartbeatAt: now
      })
    ]);
    expect(registry.listVisibleDevices()).toEqual([]);

    registry.heartbeat("agent-a", {
      shared: true,
      devices: [
        {
          serial: "pixel-1",
          platform: "android",
          name: "Pixel 8",
          status: "online",
          capabilities: defaultAndroidCapabilities()
        }
      ]
    });

    expect(registry.listVisibleDevices()).toEqual([
      expect.objectContaining({
        id: "agent-a:android:pixel-1",
        serial: "agent-a:android:pixel-1",
        platform: "android",
        name: "Pixel 8",
        status: "online",
        capabilities: defaultAndroidCapabilities(),
        agent: {
          agentId: "agent-a",
          deviceKey: "agent-a:android:pixel-1",
          serial: "pixel-1",
          shared: true,
          visibility: "public"
        }
      })
    ]);
  });

  it("keeps private devices hidden except for their paired browser session", () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      pairingCodeGenerator: () => "123456"
    });
    const pairing = registry.createPairingCode({ sessionId: "browser-1", ttlMs: 60_000 });

    registry.registerAgent({
      agentId: "agent-private",
      version: "1.0.0",
      pairingCode: pairing.code,
      devices: [
        {
          serial: "ios-1",
          platform: "ios",
          name: "Lab iPhone",
          status: "online",
          capabilities: defaultIosCapabilities({ screenshot: true })
        }
      ]
    });

    expect(registry.listVisibleDevices()).toEqual([]);
    expect(registry.listVisibleDevices({ sessionId: "browser-2" })).toEqual([]);
    expect(registry.listVisibleDevices({ sessionId: "browser-1" })).toEqual([
      expect.objectContaining({
        serial: "agent-private:ios:ios-1",
        agent: {
          agentId: "agent-private",
          deviceKey: "agent-private:ios:ios-1",
          serial: "ios-1",
          shared: false,
          visibility: "paired"
        }
      })
    ]);
    expect(() => registry.registerAgent({ agentId: "agent-other", pairingCode: "123456" })).toThrow("Pairing code is already used");
  });

  it("marks agent devices offline when the agent disconnects", () => {
    const registry = new ServerAgentRegistry({ now: () => now });
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

    registry.markAgentOffline("agent-a");

    expect(registry.listVisibleDevices()).toEqual([]);
    expect(registry.listVisibleDevices({ includeOffline: true })).toEqual([
      expect.objectContaining({
        serial: "agent-a:android:pixel-1",
        status: "offline",
        agent: expect.objectContaining({ agentId: "agent-a", visibility: "public" })
      })
    ]);
  });

  it("returns pending commands from different devices in the same agent poll", () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: sequentialIds(
        "screen-a-1",
        "screen-a-2",
        "screen-a-3",
        "action-b-1",
        "screen-a-4"
      )
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "device-a", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() },
        { serial: "device-b", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });
    const pending = [
      registry.sendCommand("agent-a:android:device-a", "screenshot"),
      registry.sendCommand("agent-a:android:device-a", "screenshot"),
      registry.sendCommand("agent-a:android:device-a", "screenshot"),
      registry.sendCommand("agent-a:android:device-b", "performAction", { action: { type: "tap", x: 1, y: 2 } }),
      registry.sendCommand("agent-a:android:device-a", "screenshot")
    ];

    const taken: ReturnType<ServerAgentRegistry["takePendingCommands"]> = [];
    try {
      taken.push(...registry.takePendingCommands("agent-a", 3));

      expect(taken.map((command) => command.requestId)).toContain("action-b-1");
      expect(taken.map((command) => command.deviceKey)).toContain("agent-a:android:device-b");
    } finally {
      for (const command of [...taken, ...registry.takePendingCommands("agent-a", 10)]) {
        registry.completeCommand("agent-a", command.requestId, { ok: true, result: {} });
      }
    }
    return Promise.all(pending);
  });

  it("notifies command subscribers after the pending command is registered", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: sequentialIds("request-1")
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });
    registry.subscribeAgentCommands("agent-a", () => {
      const [command] = registry.takePendingCommands("agent-a");
      if (command) {
        registry.completeCommand("agent-a", command.requestId, { ok: true, result: { deliveredBy: "ws" } });
      }
    });

    await expect(registry.sendCommand("agent-a:android:pixel-1", "getDeviceInfo")).resolves.toEqual(expect.objectContaining({
      ok: true,
      result: { deliveredBy: "ws" }
    }));
  });

  it("rejects pending commands and clears queued work when an agent goes offline", async () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      requestIdGenerator: sequentialIds("request-1"),
      commandTimeoutMs: 500
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });
    const pending = registry
      .sendCommand("agent-a:android:pixel-1", "performAction", { action: { type: "tap", x: 1, y: 2 } })
      .then(() => "resolved", (error: unknown) => error instanceof Error ? error.message : String(error));

    registry.markAgentOffline("agent-a");

    await expect(Promise.race([pending, resolveAfter(20, "still-pending")])).resolves.toBe("Agent went offline: agent-a");
    expect(registry.takePendingCommands("agent-a")).toEqual([]);
  });

  it("blocks conflicting write leases while allowing readonly preview leases", () => {
    const registry = new ServerAgentRegistry({
      now: () => now,
      leaseIdGenerator: sequentialIds("preview-lease", "manual-lease", "automation-lease")
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });

    const preview = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "readonly_preview",
      ownerId: "browser-a",
      ttlMs: 60_000
    });
    const manual = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    });

    expect(preview.id).toBe("preview-lease");
    expect(registry.getDeviceSession("agent-a:android:pixel-1")?.currentLease).toEqual(manual);
    expect(registry.listVisibleDevices()).toEqual([
      expect.objectContaining({
        serial: "agent-a:android:pixel-1",
        currentLease: manual
      })
    ]);
    expect(() => registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "automation_run",
      ownerId: "runner-b",
      ttlMs: 60_000
    })).toThrow("Device agent-a:android:pixel-1 is already leased by browser-a");

    expect(registry.releaseDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      leaseId: manual.id,
      ownerId: "browser-b"
    })).toBe(false);
    expect(registry.getDeviceSession("agent-a:android:pixel-1")?.currentLease?.id).toBe("manual-lease");

    expect(registry.releaseDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      leaseId: manual.id,
      ownerId: "browser-a"
    })).toBe(true);
    expect(registry.getDeviceSession("agent-a:android:pixel-1")?.currentLease).toBeUndefined();
    expect(registry.listDeviceLeases("agent-a:android:pixel-1")).toEqual([preview]);
  });

  it("ignores expired write leases when acquiring a new lease", () => {
    let currentTime = now;
    const registry = new ServerAgentRegistry({
      now: () => currentTime,
      leaseIdGenerator: sequentialIds("lease-old", "lease-new")
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });

    registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "automation_run",
      ownerId: "runner-a",
      ttlMs: 1_000
    });
    currentTime = "2026-08-07T08:00:02.000Z";

    const next = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "manual_control",
      ownerId: "browser-b",
      ttlMs: 60_000
    });

    expect(next.id).toBe("lease-new");
    expect(registry.listDeviceLeases("agent-a:android:pixel-1")).toEqual([next]);
  });

  it("renews an existing write lease for the same owner", () => {
    let currentTime = now;
    const registry = new ServerAgentRegistry({
      now: () => currentTime,
      leaseIdGenerator: sequentialIds("lease-1", "unused")
    });
    registry.registerAgent({
      agentId: "agent-a",
      shared: true,
      devices: [
        { serial: "pixel-1", platform: "android", status: "online", capabilities: defaultAndroidCapabilities() }
      ]
    });

    const first = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    });
    currentTime = "2026-08-07T08:00:10.000Z";
    const renewed = registry.acquireDeviceLease({
      deviceKey: "agent-a:android:pixel-1",
      type: "manual_control",
      ownerId: "browser-a",
      ttlMs: 60_000
    });

    expect(renewed).toEqual({
      ...first,
      renewedAt: currentTime,
      expiresAt: "2026-08-07T08:01:10.000Z"
    });
    expect(registry.listDeviceLeases("agent-a:android:pixel-1")).toEqual([renewed]);
    expect(registry.getDeviceSession("agent-a:android:pixel-1")?.currentLease).toEqual(renewed);
  });
});

function sequentialIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `request-${index}`;
}

function resolveAfter<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
