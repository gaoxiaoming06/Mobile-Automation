import {
  type AndroidAppMonitorConfig,
  type AndroidAppMonitorIncident,
  type AndroidAppMonitorSummary,
  type AndroidProcessInfo,
  type AndroidProcessLifecycleEvent,
  type AndroidProcessMetricSample,
  type NormalizedAndroidAppMonitorConfig,
  normalizeAndroidAppMonitorConfig,
  nowIso
} from "@mobile-automation/shared";
import { type AndroidShellExecutor } from "./android-actions.js";
import { AndroidLogcatEventWatcher, type AndroidDeviceEventWatcher } from "./android-events.js";
import { type AndroidObservedDeviceEvent } from "./android-parsers.js";
import { AndroidIncidentDumper, type AndroidIncidentArtifactWriter } from "./android-incident-dumper.js";
import { AndroidProcessDiscovery } from "./android-process-discovery.js";
import { AndroidProcessMetricSampler } from "./android-process-metrics.js";
import { ThresholdTracker } from "./android-thresholds.js";

export type AndroidAppMonitorSampleKind = "cpu" | "memory";

export type AndroidAppMonitorCallbacks = {
  onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
  onSample?: (sample: AndroidProcessMetricSample, kind: AndroidAppMonitorSampleKind) => void | Promise<void>;
  onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
  onWatcherEvent?: (event: AndroidObservedDeviceEvent) => void | Promise<void>;
};

export type AndroidAppMonitorClock = {
  now(): number;
  nowIso(): string;
};

export type AndroidAppMonitorSessionOptions = AndroidAppMonitorCallbacks & {
  serial: string;
  runId: string;
  config: AndroidAppMonitorConfig | NormalizedAndroidAppMonitorConfig;
  shell: AndroidShellExecutor;
  writeTextArtifact: AndroidIncidentArtifactWriter;
  sleep?: (ms: number) => Promise<void>;
  clock?: AndroidAppMonitorClock;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (interval: unknown) => void;
  discovery?: AndroidProcessDiscovery;
  sampler?: AndroidProcessMetricSampler;
  dumper?: AndroidIncidentDumper;
  watcher?: AndroidLogcatEventWatcher;
};

type LoopKind = "lifecycle" | AndroidAppMonitorSampleKind;

const emptyArtifacts: AndroidAppMonitorSummary["artifacts"] = {};

export class AndroidAppMonitorSession {
  private readonly config: NormalizedAndroidAppMonitorConfig;
  private readonly discovery: AndroidProcessDiscovery;
  private readonly sampler: AndroidProcessMetricSampler;
  private readonly dumper: AndroidIncidentDumper;
  private readonly watcher: AndroidLogcatEventWatcher;
  private readonly clock: AndroidAppMonitorClock;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (interval: unknown) => void;
  private readonly intervals: unknown[] = [];
  private readonly runningLoops = new Set<LoopKind>();
  private readonly currentProcesses = new Map<string, AndroidProcessInfo>();
  private readonly observedProcesses = new Map<string, AndroidProcessInfo>();
  private readonly thresholdTrackers = new Map<string, ThresholdTracker>();
  private readonly summary: AndroidAppMonitorSummary;
  private eventWatcher?: AndroidDeviceEventWatcher;
  private started = false;
  private stopping = false;
  private stopped = false;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<AndroidAppMonitorSummary>;
  private incidentIndex = 0;

  constructor(private readonly options: AndroidAppMonitorSessionOptions) {
    this.config = isNormalizedConfig(options.config) ? cloneNormalizedConfig(options.config) : normalizeAndroidAppMonitorConfig(options.config);
    this.discovery = options.discovery ?? new AndroidProcessDiscovery({ shell: options.shell });
    this.sampler = options.sampler ?? new AndroidProcessMetricSampler({ shell: options.shell, sleep: options.sleep });
    this.dumper = options.dumper ?? new AndroidIncidentDumper({ shell: options.shell, writeTextArtifact: options.writeTextArtifact });
    this.watcher = options.watcher ?? new AndroidLogcatEventWatcher();
    this.clock = options.clock ?? {
      now: () => Date.now(),
      nowIso
    };
    this.setTimer = options.setInterval ?? ((callback, ms) => setInterval(callback, ms));
    this.clearTimer = options.clearInterval ?? ((interval) => clearInterval(interval as ReturnType<typeof setInterval>));
    this.summary = {
      packageName: this.config.packageName,
      startedAt: this.clock.nowIso(),
      processes: [],
      sampleCounts: {
        cpu: 0,
        memory: 0,
        lifecycle: 0
      },
      incidents: [],
      artifacts: { ...emptyArtifacts }
    };
  }

  async start(): Promise<void> {
    if (this.stopped || this.stopping) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.started = true;
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.runGuardedLoop("lifecycle", () => this.runLifecycleLoop());
    if (!this.isActive()) {
      return;
    }
    await this.startWatcher();
    if (!this.isActive()) {
      return;
    }
    await this.runGuardedLoop("cpu", () => this.runSampleLoop("cpu"));
    if (!this.isActive()) {
      return;
    }
    await this.runGuardedLoop("memory", () => this.runSampleLoop("memory"));
    if (!this.isActive()) {
      return;
    }
    this.scheduleLoop("lifecycle", this.config.lifecycleIntervalMs, () => this.runLifecycleLoop());
    this.scheduleLoop("cpu", this.config.cpuIntervalMs, () => this.runSampleLoop("cpu"));
    this.scheduleLoop("memory", this.config.memoryIntervalMs, () => this.runSampleLoop("memory"));
  }

  async stop(): Promise<AndroidAppMonitorSummary> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    if (this.stopped) {
      return this.getSummary();
    }
    this.stopping = true;
    this.stopped = true;
    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async stopInternal(): Promise<AndroidAppMonitorSummary> {
    this.clearIntervals();
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined);
    }
    this.clearIntervals();
    await this.stopEventWatcher();
    this.summary.endedAt ??= this.clock.nowIso();
    this.stopping = false;
    return this.getSummary();
  }

  getSummary(): AndroidAppMonitorSummary {
    return {
      ...this.summary,
      processes: [...this.summary.processes],
      sampleCounts: { ...this.summary.sampleCounts },
      incidents: [...this.summary.incidents],
      artifacts: { ...this.summary.artifacts }
    };
  }

  private scheduleLoop(kind: LoopKind, intervalMs: number, callback: () => Promise<void>): void {
    if (!this.isActive()) {
      return;
    }
    const interval = this.setTimer(() => {
      void this.runGuardedLoop(kind, callback);
    }, intervalMs);
    this.intervals.push(interval);
  }

  private async runGuardedLoop(kind: LoopKind, callback: () => Promise<void>): Promise<void> {
    if (!this.isActive() || this.runningLoops.has(kind)) {
      return;
    }
    this.runningLoops.add(kind);
    try {
      await callback();
    } catch {
      // Individual collectors are best-effort; failures are captured in raw samples or incidents where possible.
    } finally {
      this.runningLoops.delete(kind);
    }
  }

  private async runLifecycleLoop(): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    let discovered: AndroidProcessInfo[];
    try {
      discovered = await this.discovery.discover(this.options.serial, this.config.packageName, {
        includeSubprocesses: this.config.includeSubprocesses,
        processFilters: this.config.processFilters
      });
    } catch {
      return;
    }
    if (!this.isActive()) {
      return;
    }

    this.summary.sampleCounts.lifecycle += 1;
    const discoveredByName = new Map(discovered.map((process) => [process.processName, process]));
    for (const process of discovered) {
      if (!this.isActive()) {
        return;
      }
      const previous = this.currentProcesses.get(process.processName);
      this.currentProcesses.set(process.processName, process);
      this.rememberProcess(process);
      if (!previous) {
        await this.emitLifecycleEvent({
          occurredAt: this.clock.nowIso(),
          type: "process_started",
          pid: process.pid,
          processName: process.processName
        });
        if (!this.isActive()) {
          return;
        }
      } else if (previous.pid !== process.pid) {
        this.deleteThresholdTrackers(previous.pid);
        await this.emitLifecycleEvent({
          occurredAt: this.clock.nowIso(),
          type: "process_restarted",
          pid: process.pid,
          previousPid: previous.pid,
          processName: process.processName
        });
        if (!this.isActive()) {
          return;
        }
      }
    }

    for (const [processName, previous] of [...this.currentProcesses.entries()]) {
      if (!this.isActive()) {
        return;
      }
      if (discoveredByName.has(processName)) {
        continue;
      }
      this.currentProcesses.delete(processName);
      this.deleteThresholdTrackers(previous.pid);
      await this.emitLifecycleEvent({
        occurredAt: this.clock.nowIso(),
        type: "process_exited",
        pid: previous.pid,
        processName
      });
      if (!this.isActive()) {
        return;
      }
    }
    this.refreshSummaryProcesses();
  }

  private async runSampleLoop(kind: AndroidAppMonitorSampleKind): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    for (const process of [...this.currentProcesses.values()]) {
      if (!this.isActive() || !this.isCurrentProcess(process)) {
        continue;
      }
      let sample: AndroidProcessMetricSample;
      try {
        sample = await this.sampleProcess(kind, process);
      } catch {
        continue;
      }
      if (!this.isActive() || !this.isCurrentProcess(process)) {
        continue;
      }
      this.summary.sampleCounts[kind] += 1;
      await this.invokeCallback(() => this.options.onSample?.(sample, kind));
      if (!this.isActive() || !this.isCurrentProcess(process)) {
        continue;
      }
      await this.observeThreshold(kind, process, sample);
    }
  }

  private async sampleProcess(kind: AndroidAppMonitorSampleKind, process: AndroidProcessInfo): Promise<AndroidProcessMetricSample> {
    return kind === "cpu"
      ? this.sampler.sampleCpu(this.options.serial, process)
      : this.sampler.sampleMemory(this.options.serial, process);
  }

  private async observeThreshold(
    kind: AndroidAppMonitorSampleKind,
    process: AndroidProcessInfo,
    sample: AndroidProcessMetricSample
  ): Promise<void> {
    const threshold = kind === "cpu" ? this.config.thresholds.cpuPercent : this.config.thresholds.pssMb;
    if (!threshold || !this.isActive() || !this.isCurrentProcess(process)) {
      return;
    }
    const value = kind === "cpu" ? sample.cpuPercent : sample.pssKb === undefined ? undefined : sample.pssKb / 1024;
    const breach = this.getThresholdTracker(process.pid, kind, threshold).observe(value, this.clock.now());
    if (!breach) {
      return;
    }
    if (!this.isActive() || !this.isCurrentProcess(process)) {
      return;
    }

    let artifactIds: string[] = [];
    try {
      artifactIds =
        kind === "cpu"
          ? await this.dumper.dumpCpuIncident(this.options.runId, this.options.serial, process)
          : await this.dumper.dumpMemoryIncident(this.options.runId, this.options.serial, process, {
              enableHeapDump: this.config.enableHeapDump
            });
    } catch {
      artifactIds = [];
    }
    if (!this.isActive() || !this.isCurrentProcess(process)) {
      return;
    }

    await this.recordIncident({
      type: kind === "cpu" ? "cpu_threshold" : "memory_threshold",
      severity: "warning",
      processName: process.processName,
      pid: process.pid,
      summary:
        kind === "cpu"
          ? `CPU threshold breached: ${process.processName}`
          : `Memory threshold breached: ${process.processName}`,
      artifactIds,
      metadata: {
        value,
        threshold: threshold.value,
        breach
      }
    });
  }

  private async startWatcher(): Promise<void> {
    try {
      const eventWatcher = await this.watcher.watchDeviceEvents(
        this.options.serial,
        (event) => {
          void this.handleWatcherEvent(event);
        },
        { packageName: this.config.packageName }
      );
      if (!this.isActive()) {
        await eventWatcher.stop().catch(() => undefined);
        return;
      }
      this.eventWatcher = eventWatcher;
    } catch (error) {
      if (this.isActive()) {
        await this.recordIncident({
          type: "watcher_error",
          severity: "warning",
          summary: "Android logcat watcher failed to start",
          detail: errorMessage(error),
          artifactIds: []
        });
      }
    }
  }

  private async handleWatcherEvent(event: AndroidObservedDeviceEvent): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    await this.invokeCallback(() => this.options.onWatcherEvent?.(event));
    if (!this.isActive()) {
      return;
    }
    const type = mapWatcherIncidentType(event.type);
    if (!type) {
      return;
    }
    await this.recordIncident({
      type,
      severity: event.severity,
      occurredAt: event.occurredAt,
      processName: event.processName,
      pid: event.pid,
      summary: event.summary,
      detail: event.detail,
      artifactIds: [],
      metadata: {
        watcherEventType: event.type
      }
    });
  }

  private async emitLifecycleEvent(event: AndroidProcessLifecycleEvent): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    await this.invokeCallback(() => this.options.onLifecycleEvent?.(event));
  }

  private async recordIncident(
    incident: Omit<AndroidAppMonitorIncident, "id" | "occurredAt" | "artifactIds"> & {
      occurredAt?: string;
      artifactIds?: string[];
    }
  ): Promise<void> {
    if (!this.isActive()) {
      return;
    }
    const completeIncident: AndroidAppMonitorIncident = {
      id: `android_app_monitor_${this.options.runId}_${++this.incidentIndex}`,
      occurredAt: incident.occurredAt ?? this.clock.nowIso(),
      artifactIds: incident.artifactIds ?? [],
      ...incident
    };
    this.summary.incidents.push(completeIncident);
    await this.invokeCallback(() => this.options.onIncident?.(completeIncident));
  }

  private getThresholdTracker(
    pid: number,
    kind: AndroidAppMonitorSampleKind,
    threshold: NonNullable<NormalizedAndroidAppMonitorConfig["thresholds"]["cpuPercent"]>
  ): ThresholdTracker {
    const key = `${pid}:${kind}`;
    let tracker = this.thresholdTrackers.get(key);
    if (!tracker) {
      tracker = new ThresholdTracker(threshold);
      this.thresholdTrackers.set(key, tracker);
    }
    return tracker;
  }

  private deleteThresholdTrackers(pid: number): void {
    this.thresholdTrackers.delete(`${pid}:cpu`);
    this.thresholdTrackers.delete(`${pid}:memory`);
  }

  private rememberProcess(process: AndroidProcessInfo): void {
    this.observedProcesses.set(`${process.processName}:${process.pid}`, process);
  }

  private refreshSummaryProcesses(): void {
    this.summary.processes = [...this.observedProcesses.values()];
  }

  private async invokeCallback(callback: () => void | Promise<void>): Promise<void> {
    try {
      await callback();
    } catch {
      // User callbacks must not break monitor loops.
    }
  }

  private isActive(): boolean {
    return this.started && !this.stopping && !this.stopped && this.config.enabled;
  }

  private isCurrentProcess(process: AndroidProcessInfo): boolean {
    return this.currentProcesses.get(process.processName)?.pid === process.pid;
  }

  private clearIntervals(): void {
    for (const interval of this.intervals.splice(0)) {
      this.clearTimer(interval);
    }
  }

  private async stopEventWatcher(): Promise<void> {
    if (!this.eventWatcher) {
      return;
    }
    const eventWatcher = this.eventWatcher;
    this.eventWatcher = undefined;
    await eventWatcher.stop().catch(() => undefined);
  }
}

function mapWatcherIncidentType(type: AndroidObservedDeviceEvent["type"]): AndroidAppMonitorIncident["type"] | undefined {
  switch (type) {
    case "crash":
      return "java_crash";
    case "native_crash":
    case "anr":
    case "process_death":
      return type;
    case "command_failed":
      return "watcher_error";
    default:
      return undefined;
  }
}

function isNormalizedConfig(
  config: AndroidAppMonitorConfig | NormalizedAndroidAppMonitorConfig
): config is NormalizedAndroidAppMonitorConfig {
  return (
    config.includeSubprocesses !== undefined &&
    config.cpuIntervalMs !== undefined &&
    config.memoryIntervalMs !== undefined &&
    config.lifecycleIntervalMs !== undefined &&
    config.enableHeapDump !== undefined &&
    Array.isArray(config.processFilters)
  );
}

function cloneNormalizedConfig(config: NormalizedAndroidAppMonitorConfig): NormalizedAndroidAppMonitorConfig {
  return {
    ...config,
    processFilters: [...config.processFilters],
    thresholds: {
      ...(config.thresholds.cpuPercent ? { cpuPercent: { ...config.thresholds.cpuPercent } } : {}),
      ...(config.thresholds.pssMb ? { pssMb: { ...config.thresholds.pssMb } } : {})
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
