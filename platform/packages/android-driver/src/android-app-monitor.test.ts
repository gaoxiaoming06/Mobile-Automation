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
    watcher.emit({ type: "native_crash", severity: "error", summary: "Native crash detected", processName: "cn.eeo.classin", pid: 123 });
    watcher.emit({ type: "anr", severity: "error", summary: "ANR detected" });
    watcher.emit({ type: "process_death", severity: "warning", summary: "Process death detected" });
    watcher.emit({ type: "command_failed", severity: "warning", summary: "Android logcat watcher exited", detail: "logcat died" });
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
        summary: "Native crash detected",
        processName: "cn.eeo.classin",
        pid: 123
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
      }),
      expect.objectContaining({
        type: "watcher_error",
        severity: "warning",
        summary: "Android logcat watcher exited",
        detail: "logcat died",
        metadata: {
          watcherEventType: "command_failed"
        }
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

  it("stops a delayed watcher that resolves after stop and does not schedule intervals", async () => {
    const timers = createTimers();
    const watcher = createDelayedWatcher();
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[]]),
      watcher: watcher.instance,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval
    });

    const startPromise = session.start();
    await flushPromises();
    const stopPromise = session.stop();
    watcher.resolve();
    await expect(startPromise).resolves.toBeUndefined();
    const summary = await stopPromise;

    expect(watcher.stop).toHaveBeenCalledTimes(1);
    expect(timers.count()).toBe(0);
    expect(summary).toEqual(expect.objectContaining({ endedAt: expect.any(String), incidents: [] }));
  });

  it("does not reenter a slow sample loop when the interval fires again", async () => {
    const timers = createTimers();
    const sampleGate = createDeferred<AndroidProcessMetricSample>();
    let activeSamples = 0;
    let maxActiveSamples = 0;
    const sampler = {
      sampleCpu: vi.fn(async (_serial: string, process: AndroidProcessInfo) => {
        activeSamples += 1;
        maxActiveSamples = Math.max(maxActiveSamples, activeSamples);
        try {
          return await sampleGate.promise;
        } finally {
          activeSamples -= 1;
        }
      }),
      sampleMemory: vi.fn(async (_serial: string, process: AndroidProcessInfo) => ({
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName
      }))
    } as unknown as AndroidProcessMetricSampler;
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[], [processInfo(111)]]),
      sampler,
      watcher: createWatcher().instance,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval
    });

    await session.start();
    await timers.tick(0);
    timers.fire(1);
    timers.fire(1);
    await flushPromises();
    expect(sampler.sampleCpu).toHaveBeenCalledTimes(1);
    expect(maxActiveSamples).toBe(1);

    sampleGate.resolve({
      sampledAt: "2026-07-22T00:00:00.000Z",
      pid: 111,
      processName: "cn.eeo.classin",
      cpuPercent: 10
    });
    await flushPromises();
    await session.stop();
  });

  it("drops sample results that resolve after stop without callbacks or threshold incidents", async () => {
    const timers = createTimers();
    const sampleGate = createDeferred<AndroidProcessMetricSample>();
    const onSample = vi.fn();
    const dumper = createDumper();
    const sampler = {
      sampleCpu: vi.fn(async () => sampleGate.promise),
      sampleMemory: vi.fn(async (_serial: string, process: AndroidProcessInfo) => ({
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName
      }))
    } as unknown as AndroidProcessMetricSampler;
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: {
        ...baseConfig,
        thresholds: {
          cpuPercent: { enabled: true, value: 1, sustainMs: 0, cooldownMs: 0 }
        }
      },
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[], [processInfo(111)]]),
      sampler,
      dumper: dumper.instance,
      watcher: createWatcher().instance,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      onSample
    });

    await session.start();
    await timers.tick(0);
    timers.fire(1);
    await flushPromises();
    const stopPromise = session.stop();
    sampleGate.resolve({
      sampledAt: "2026-07-22T00:00:00.000Z",
      pid: 111,
      processName: "cn.eeo.classin",
      cpuPercent: 90
    });
    await stopPromise;
    await flushPromises();

    expect(onSample).not.toHaveBeenCalled();
    expect(dumper.dumpCpuIncident).not.toHaveBeenCalled();
    expect(session.getSummary().incidents).toEqual([]);
  });

  it("drops stale pid sample results after lifecycle exit before threshold dumping", async () => {
    const timers = createTimers();
    const sampleGate = createDeferred<AndroidProcessMetricSample>();
    const onSample = vi.fn();
    const dumper = createDumper();
    const sampler = {
      sampleCpu: vi.fn(async () => sampleGate.promise),
      sampleMemory: vi.fn(async (_serial: string, process: AndroidProcessInfo) => ({
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName
      }))
    } as unknown as AndroidProcessMetricSampler;
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: {
        ...baseConfig,
        thresholds: {
          cpuPercent: { enabled: true, value: 1, sustainMs: 0, cooldownMs: 0 }
        }
      },
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[], [processInfo(111)], []]),
      sampler,
      dumper: dumper.instance,
      watcher: createWatcher().instance,
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
      onSample
    });

    await session.start();
    await timers.tick(0);
    timers.fire(1);
    await flushPromises();
    await timers.tick(0);
    sampleGate.resolve({
      sampledAt: "2026-07-22T00:00:00.000Z",
      pid: 111,
      processName: "cn.eeo.classin",
      cpuPercent: 90
    });
    await flushPromises();

    expect(onSample).not.toHaveBeenCalled();
    expect(dumper.dumpCpuIncident).not.toHaveBeenCalled();
    expect(session.getSummary().incidents).toEqual([]);
    await session.stop();
  });

  it("isolates one rejected process sample and continues sampling other processes", async () => {
    const onSample = vi.fn();
    const sampler = {
      sampleCpu: vi.fn(async (_serial: string, process: AndroidProcessInfo) => {
        if (process.pid === 111) {
          throw new Error("proc stat unavailable");
        }
        return {
          sampledAt: "2026-07-22T00:00:00.000Z",
          pid: process.pid,
          processName: process.processName,
          cpuPercent: 12
        };
      }),
      sampleMemory: vi.fn(async (_serial: string, process: AndroidProcessInfo) => ({
        sampledAt: "2026-07-22T00:00:00.000Z",
        pid: process.pid,
        processName: process.processName
      }))
    } as unknown as AndroidProcessMetricSampler;
    const session = new AndroidAppMonitorSession({
      serial: "device-1",
      runId: "run-1",
      config: baseConfig,
      shell: vi.fn(),
      writeTextArtifact: vi.fn(),
      discovery: createDiscovery([[processInfo(111), processInfo(222, "cn.eeo.classin:worker")]]),
      sampler,
      watcher: createWatcher().instance,
      onSample
    });

    await expect(session.start()).resolves.toBeUndefined();
    expect(sampler.sampleCpu).toHaveBeenCalledTimes(2);
    expect(onSample).toHaveBeenCalledWith(expect.objectContaining({ pid: 222 }), "cpu");
    expect(session.getSummary().sampleCounts.cpu).toBe(1);
    await session.stop();
  });
});

function processInfo(pid: number, processName = "cn.eeo.classin"): AndroidProcessInfo {
  return {
    pid,
    processName,
    packageName: "cn.eeo.classin",
    isMainProcess: processName === "cn.eeo.classin",
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

function createDelayedWatcher() {
  let onEvent: Parameters<AndroidLogcatEventWatcher["watchDeviceEvents"]>[1] | undefined;
  const stop = vi.fn(async () => undefined);
  const watcherGate = createDeferred<{ stop: typeof stop }>();
  const watchDeviceEvents = vi.fn(async (_serial, callback) => {
    onEvent = callback;
    return watcherGate.promise;
  });
  return {
    instance: { watchDeviceEvents } as unknown as AndroidLogcatEventWatcher,
    watchDeviceEvents,
    stop,
    emit: (event: Parameters<NonNullable<typeof onEvent>>[0]) => onEvent?.(event),
    resolve: () => watcherGate.resolve({ stop })
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
    count: () => callbacks.length,
    fire: (index: number) => {
      callbacks[index]?.();
    },
    tick: async (index: number) => {
      callbacks[index]?.();
      await flushPromises();
    }
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
