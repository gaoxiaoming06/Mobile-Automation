import type {
  AndroidAppMonitorConfig,
  AndroidAppMonitorIncident,
  AndroidAppMonitorSummary,
  AndroidProcessLifecycleEvent,
  AndroidProcessMetricSample
} from "@mobile-automation/shared";

export type AgentMonitorCallbacks = {
  onIncident?: (incident: AndroidAppMonitorIncident) => void | Promise<void>;
  onSample?: (sample: AndroidProcessMetricSample, kind: "cpu" | "memory") => void | Promise<void>;
  onLifecycleEvent?: (event: AndroidProcessLifecycleEvent) => void | Promise<void>;
};

export type AgentMonitorSession = {
  start?(): Promise<void>;
  stop(): Promise<AndroidAppMonitorSummary>;
  getSummary(): AndroidAppMonitorSummary;
};

export type AgentMonitorDriver = {
  startAppMonitor(
    localSerial: string,
    runId: string,
    config: AndroidAppMonitorConfig,
    callbacks?: AgentMonitorCallbacks
  ): Promise<AgentMonitorSession>;
};

export type MonitorSessionStartInput = {
  monitorId: string;
  runId: string;
  deviceKey: string;
  localSerial: string;
  config: AndroidAppMonitorConfig;
  callbacks?: AgentMonitorCallbacks;
};

export type MonitorSessionSamples = {
  cpu: AndroidProcessMetricSample[];
  memory: AndroidProcessMetricSample[];
  lifecycle: AndroidProcessLifecycleEvent[];
};

export type MonitorSessionManagerOptions = {
  driver: AgentMonitorDriver;
  now?: () => number;
  ttlMs?: number;
};

type MonitorSessionRecord = MonitorSessionStartInput & {
  session: AgentMonitorSession;
  startedAtMs: number;
  expiresAtMs: number;
  samples: MonitorSessionSamples;
  stoppedSummary?: AndroidAppMonitorSummary;
  stopping?: Promise<AndroidAppMonitorSummary>;
};

const defaultTtlMs = 30 * 60_000;

export class MonitorSessionManager {
  private readonly sessions = new Map<string, MonitorSessionRecord>();
  private readonly activeByLocalSerial = new Map<string, string>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(private readonly options: MonitorSessionManagerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? defaultTtlMs;
  }

  async start(input: MonitorSessionStartInput): Promise<AgentMonitorSession> {
    const existing = this.sessions.get(input.monitorId);
    if (existing && !existing.stoppedSummary) {
      return existing.session;
    }
    const occupyingMonitorId = this.activeByLocalSerial.get(input.localSerial);
    const occupying = occupyingMonitorId ? this.sessions.get(occupyingMonitorId) : undefined;
    if (occupying && !occupying.stoppedSummary) {
      throw new Error(`${input.localSerial} is already monitored by run ${occupying.runId}`);
    }

    const samples: MonitorSessionSamples = { cpu: [], memory: [], lifecycle: [] };
    const session = await this.options.driver.startAppMonitor(input.localSerial, input.runId, input.config, {
      onIncident: (incident) => input.callbacks?.onIncident?.(incident),
      onSample: async (sample, kind) => {
        if (kind === "cpu") {
          samples.cpu.push(sample);
        } else {
          samples.memory.push(sample);
        }
        await input.callbacks?.onSample?.(sample, kind);
      },
      onLifecycleEvent: async (event) => {
        samples.lifecycle.push(event);
        await input.callbacks?.onLifecycleEvent?.(event);
      }
    });
    await session.start?.();
    const startedAtMs = this.now();
    const record: MonitorSessionRecord = {
      ...input,
      session,
      startedAtMs,
      expiresAtMs: startedAtMs + this.ttlMs,
      samples
    };
    this.sessions.set(input.monitorId, record);
    this.activeByLocalSerial.set(input.localSerial, input.monitorId);
    return session;
  }

  async stop(monitorId: string): Promise<AndroidAppMonitorSummary | undefined> {
    const record = this.sessions.get(monitorId);
    if (!record) {
      return undefined;
    }
    if (record.stoppedSummary) {
      return record.stoppedSummary;
    }
    if (!record.stopping) {
      record.stopping = record.session.stop().then((summary) => {
        record.stoppedSummary = summary;
        this.releaseActiveMonitor(record);
        return summary;
      });
    }
    return record.stopping;
  }

  getSummary(monitorId: string): AndroidAppMonitorSummary | undefined {
    const record = this.sessions.get(monitorId);
    return record?.stoppedSummary ?? record?.session.getSummary();
  }

  samplesFor(monitorId: string): MonitorSessionSamples {
    const samples = this.sessions.get(monitorId)?.samples;
    return {
      cpu: [...(samples?.cpu ?? [])],
      memory: [...(samples?.memory ?? [])],
      lifecycle: [...(samples?.lifecycle ?? [])]
    };
  }

  activeMonitorCount(): number {
    return this.activeByLocalSerial.size;
  }

  async cleanupExpired(nowMs = this.now()): Promise<void> {
    await Promise.all([...this.sessions.values()]
      .filter((record) => !record.stoppedSummary && record.expiresAtMs <= nowMs)
      .map((record) => this.stop(record.monitorId)));
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((monitorId) => this.stop(monitorId)));
  }

  private releaseActiveMonitor(record: MonitorSessionRecord): void {
    if (this.activeByLocalSerial.get(record.localSerial) === record.monitorId) {
      this.activeByLocalSerial.delete(record.localSerial);
    }
  }
}
