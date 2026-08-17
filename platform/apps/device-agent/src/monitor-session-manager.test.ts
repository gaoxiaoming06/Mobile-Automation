import { describe, expect, it } from "vitest";
import {
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary
} from "@mobile-automation/shared";
import { MonitorSessionManager } from "./monitor-session-manager.js";

const config: AndroidAppMonitorConfig = {
  enabled: true,
  packageName: "cn.eeo.classin"
};

describe("MonitorSessionManager", () => {
  it("rejects a second active monitor for the same local serial and names the occupying run", async () => {
    const driver = new FakeMonitorDriver();
    const manager = new MonitorSessionManager({ driver, now: () => 1000 });

    await manager.start({
      monitorId: "monitor-1",
      runId: "run-1",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    });

    await expect(manager.start({
      monitorId: "monitor-2",
      runId: "run-2",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    })).rejects.toThrow("pixel-1 is already monitored by run run-1");
  });

  it("allows concurrent monitors on different local serials", async () => {
    const driver = new FakeMonitorDriver();
    const manager = new MonitorSessionManager({ driver, now: () => 1000 });

    await manager.start({
      monitorId: "monitor-1",
      runId: "run-1",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    });
    await manager.start({
      monitorId: "monitor-2",
      runId: "run-2",
      deviceKey: "agent-a:android:pixel-2",
      localSerial: "pixel-2",
      config
    });

    expect(driver.starts.map((start) => start.localSerial)).toEqual(["pixel-1", "pixel-2"]);
    expect(manager.activeMonitorCount()).toBe(2);
  });

  it("makes stop idempotent while releasing the local serial for a later run", async () => {
    const driver = new FakeMonitorDriver();
    const manager = new MonitorSessionManager({ driver, now: () => 1000 });
    await manager.start({
      monitorId: "monitor-1",
      runId: "run-1",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    });

    const first = await manager.stop("monitor-1");
    const second = await manager.stop("monitor-1");
    await manager.start({
      monitorId: "monitor-2",
      runId: "run-2",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    });

    expect(driver.sessions[0]?.stopCount).toBe(1);
    expect(first).toEqual(second);
    expect(manager.activeMonitorCount()).toBe(1);
  });

  it("stops expired sessions during TTL cleanup", async () => {
    const driver = new FakeMonitorDriver();
    const manager = new MonitorSessionManager({ driver, now: () => 1000, ttlMs: 5000 });
    await manager.start({
      monitorId: "monitor-1",
      runId: "run-1",
      deviceKey: "agent-a:android:pixel-1",
      localSerial: "pixel-1",
      config
    });

    await manager.cleanupExpired(7001);

    expect(driver.sessions[0]?.stopCount).toBe(1);
    expect(manager.activeMonitorCount()).toBe(0);
  });
});

class FakeMonitorDriver {
  readonly starts: Array<{ localSerial: string; runId: string; config: AndroidAppMonitorConfig }> = [];
  readonly sessions: FakeMonitorSession[] = [];

  async startAppMonitor(
    localSerial: string,
    runId: string,
    monitorConfig: AndroidAppMonitorConfig,
    callbacks?: { onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void> }
  ): Promise<FakeMonitorSession> {
    this.starts.push({ localSerial, runId, config: monitorConfig });
    const session = new FakeMonitorSession(monitorConfig.packageName, callbacks);
    this.sessions.push(session);
    return session;
  }
}

class FakeMonitorSession {
  stopCount = 0;

  constructor(
    private readonly packageName: string,
    readonly callbacks?: { onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void> }
  ) {}

  async start(): Promise<void> {
    return undefined;
  }

  async stop(): Promise<AndroidAppMonitorSummary> {
    this.stopCount += 1;
    return this.getSummary();
  }

  getSummary(): AndroidAppMonitorSummary {
    return {
      packageName: this.packageName,
      startedAt: "2026-08-14T00:00:00.000Z",
      processes: [],
      sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 },
      incidents: [],
      artifacts: {}
    };
  }
}
