import {
  type AndroidAppMonitorConfig,
  type AndroidProcessInfo,
  type AndroidProcessMetricSample
} from "@mobile-automation/shared";
import { describe, expect, it, vi } from "vitest";
import { type AndroidShellExecutor } from "./android-actions.js";
import { AndroidAppMonitorSession } from "./android-app-monitor.js";
import { type AndroidLogcatEventWatcher } from "./android-events.js";
import { type AndroidIncidentDumper } from "./android-incident-dumper.js";
import { type AndroidProcessDiscovery } from "./android-process-discovery.js";
import { type AndroidProcessMetricSampler } from "./android-process-metrics.js";

const baseConfig: AndroidAppMonitorConfig = {
  enabled: true,
  packageName: "cn.eeo.classin",
  cpuIntervalMs: 10,
  memoryIntervalMs: 10,
  lifecycleIntervalMs: 10
};

describe("AndroidAppMonitorSession", () => {
  it("returns a disabled summary without starting shell collectors or watcher", async () => {
    const shell = vi.fn<AndroidShellExecutor>();
    const watcher = createWatcher();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: { ...baseConfig, enabled: false },
      shell,
      writeTextArtifact: vi.fn(),
      watcher: watcher.instance
    });

    await session.start();
    const summary = await session.stop();

    expect(shell).not.toHaveBeenCalled();
    expect(watcher.watchDeviceEvents).not.toHaveBeenCalled();
    expect(summary).toEqual(
      expect.objectContaining({
        packageName: "cn.eeo.classin",
        processes: [],
        sampleCounts: { cpu: 0, memory: 0, lifecycle: 0 },
        incidents: []
      })
    );
  });

  it("tracks process start, restart, and exit, and does not sample an exited pid", async () => {
    const timers = createTimers();
    const lifecycleEvents: string[] = [];
    const sampler = createSampler();
    const discovery = createDiscovery([[processInfo(111)], [processInfo(222)], []]);
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery,
      sampler: sampler.instance,
      watcher: createWatcher().instance,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      onLifecycleEvent: (event) => {
        lifecycleEvents.push(`${event.type}:${event.previousPid ?? ""}:${event.pid ?? ""}`);
      }
    });

    await session.start();
    expect(sampler.cpuPids).toEqual([111]);

    await timers.tick(0);
    await timers.tick(1);
    await timers.tick(0);
    await timers.tick(1);

    expect(lifecycleEvents).toEqual(["process_started::111", "process_restarted:111:222", "process_exited::222"]);
    expect(sampler.cpuPids).toEqual([111, 222]);
    expect(session.getSummary().processes.map((process) => process.pid)).toEqual([111, 222]);
  });

  it("samples CPU and memory, calls onSample, and increments sample counts", async () => {
    const samples: Array<{ pid: number; kind: "cpu" | "memory" }> = [];
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[processInfo(111)]]),
      sampler: createSampler({ cpuPercent: 12, pssKb: 2048 }).instance,
      watcher: createWatcher().instance,
      onSample: (sample, kind) => {
        samples.push({ pid: sample.pid, kind });
      }
    });

    await session.start();

    expect(samples).toEqual([
      { pid: 111, kind: "cpu" },
      { pid: 111, kind: "memory" }
    ]);
    expect(session.getSummary().sampleCounts).toEqual({ cpu: 1, memory: 1, lifecycle: 1 });
  });

  it("creates CPU threshold incidents with dumper artifact ids", async () => {
    const dumper = createDumper();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: {
        ...baseConfig,
        thresholds: {
          cpuPercent: { enabled: true, value: 50, sustainMs: 0, cooldownMs: 0 }
        }
      },
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[processInfo(111)]]),
      sampler: createSampler({ cpuPercent: 90 }).instance,
      dumper: dumper.instance,
      watcher: createWatcher().instance
    });

    await session.start();

    expect(dumper.dumpCpuIncident).toHaveBeenCalledWith("run-1", "device-1", expect.objectContaining({ pid: 111 }));
    expect(session.getSummary().incidents).toEqual([
      expect.objectContaining({
        type: "cpu_threshold",
        severity: "warning",
        artifactIds: ["cpu-artifact"]
      })
    ]);
  });

  it("creates memory threshold incidents and passes enableHeapDump to the dumper", async () => {
    const dumper = createDumper();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: {
        ...baseConfig,
        enableHeapDump: true,
        thresholds: {
          pssMb: { enabled: true, value: 1, sustainMs: 0, cooldownMs: 0 }
        }
      },
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[processInfo(111)]]),
      sampler: createSampler({ pssKb: 2048 }).instance,
      dumper: dumper.instance,
      watcher: createWatcher().instance
    });

    await session.start();

    expect(dumper.dumpMemoryIncident).toHaveBeenCalledWith("run-1", "device-1", expect.objectContaining({ pid: 111 }), {
      enableHeapDump: true
    });
    expect(session.getSummary().incidents[0]).toEqual(
      expect.objectContaining({
        type: "memory_threshold",
        artifactIds: ["memory-artifact"]
      })
    );
  });

  it("turns watcher stability events into incidents, records start failures, and stops the watcher", async () => {
    const watcher = createWatcher();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[]]),
      watcher: watcher.instance
    });

    await session.start();
    watcher.emit({ type: "crash", severity: "error", summary: "Java crash detected", detail: "stack" });
    watcher.emit({ type: "native_crash", severity: "error", summary: "Native crash detected" });
    watcher.emit({ type: "anr", severity: "error", summary: "ANR detected" });
    watcher.emit({ type: "process_death", severity: "warning", summary: "Process death detected" });
    await flushPromises();
    await session.stop();

    expect(session.getSummary().incidents).toEqual([
      expect.objectContaining({
        type: "java_crash",
        severity: "error",
        summary: "Java crash detected"
      }),
      expect.objectContaining({
        type: "native_crash",
        severity: "error",
        summary: "Native crash detected"
      }),
      expect.objectContaining({
        type: "anr",
        severity: "error",
        summary: "ANR detected"
      }),
      expect.objectContaining({
        type: "process_death",
        severity: "warning",
        summary: "Process death detected"
      })
    ]);
    expect(watcher.stop).toHaveBeenCalledTimes(1);

    const failingWatcher = createWatcher(new Error("logcat unavailable"));
    const failingSession = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-2",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[]]),
      watcher: failingWatcher.instance
    });

    await expect(failingSession.start()).resolves.toBeUndefined();
    expect(failingSession.getSummary().incidents).toEqual([
      expect.objectContaining({
        type: "watcher_error",
        severity: "warning",
        summary: "Android logcat watcher failed to start"
      })
    ]);
  });

  it("keeps stop idempotent and ignores callback failures", async () => {
    const watcher = createWatcher();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[processInfo(111)]]),
      sampler: createSampler().instance,
      watcher: watcher.instance,
      onSample: () => {
        throw new Error("callback failed");
      }
    });

    await expect(session.start()).resolves.toBeUndefined();
    await expect(session.stop()).resolves.toEqual(expect.objectContaining({ endedAt: expect.any(String) }));
    await expect(session.stop()).resolves.toEqual(expect.objectContaining({ endedAt: expect.any(String) }));
    expect(watcher.stop).toHaveBeenCalledTimes(1);
  });
});

function processInfo(pid: number): AndroidProcessInfo {
  return {
    pid,
    processName: "cn.eeo.classin",
    packageName: "cn.eeo.classin",
    isMainProcess: true,
    discoveredAt: "2026-07-22T00:00:00.000Z"
  };
}

function createDiscovery(sequences: AndroidProcessInfo[][]): AndroidProcessDiscovery {
  let index = 0;
  return {
    discover: vi.fn(async () => sequences[Math.min(index++, sequences.length - 1)] ?? [])
  } as unknown as AndroidProcessDiscovery;
}

function createSampler(sample: Partial<AndroidProcessMetricSample> = {}) {
  const cpuPids: number[] = [];
  const memoryPids: number[] = [];
  const sampler = {
    sampleCpu: vi.fn(async (_serial: string, process: AndroidProcessInfo) => {
      cpuPids.push(process.pid);
      return {
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName,
        cpuPercent: sample.cpuPercent,
        raw: sample.cpuPercent === undefined ? { error: "cpu unavailable" } : undefined
      };
    }),
    sampleMemory: vi.fn(async (_serial: string, process: AndroidProcessInfo) => {
      memoryPids.push(process.pid);
      return {
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName,
        pssKb: sample.pssKb,
        raw: sample.pssKb === undefined ? { error: "memory unavailable" } : undefined
      };
    })
  };
  return {
    instance: sampler as unknown as AndroidProcessMetricSampler,
    cpuPids,
    memoryPids
  };
}

function createDumper() {
  const dumper = {
    dumpCpuIncident: vi.fn(async () => ["cpu-artifact"]),
    dumpMemoryIncident: vi.fn(async () => ["memory-artifact"])
  };
  return {
    instance: dumper as unknown as AndroidIncidentDumper,
    dumpCpuIncident: dumper.dumpCpuIncident,
    dumpMemoryIncident: dumper.dumpMemoryIncident
  };
}

function createWatcher(startError?: Error) {
  let onEvent: Parameters<AndroidLogcatEventWatcher["watchDeviceEvents"]>[1] | undefined;
  const stop = vi.fn(async () => undefined);
  const watchDeviceEvents = vi.fn(async (_serial, callback) => {
    if (startError) {
      throw startError;
    }
    onEvent = callback;
    return { stop };
  });
  return {
    instance: { watchDeviceEvents } as unknown as AndroidLogcatEventWatcher,
    watchDeviceEvents,
    stop,
    emit: (event: Parameters<NonNullable<typeof onEvent>>[0]) => onEvent?.(event)
  };
}

function createTimers() {
  const callbacks: Array<() => void> = [];
  return {
    setInterval: (callback: () => void) => {
      callbacks.push(callback);
      return callback;
    },
    clearInterval: vi.fn(),
    tick: async (index: number) => {
      callbacks[index]?.();
      await flushPromises();
    }
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
