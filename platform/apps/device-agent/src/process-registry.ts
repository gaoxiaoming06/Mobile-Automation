export type AgentProcessKind =
  | "screen_stream"
  | "control_stream"
  | "log_stream"
  | "performance_stream"
  | "recording"
  | "wda"
  | "iproxy"
  | "scrcpy"
  | "harmony_capture"
  | "other";

export type AgentProcessResource = {
  id: string;
  deviceKey: string;
  kind: AgentProcessKind;
  stop: () => Promise<void> | void;
};

export type AgentProcessSnapshot = {
  id: string;
  deviceKey: string;
  kind: AgentProcessKind;
  startedAt: string;
};

export type ProcessRegistryOptions = {
  now?: () => string;
};

type RegisteredProcess = AgentProcessResource & {
  startedAt: string;
};

export class ProcessRegistry {
  private readonly processes = new Map<string, RegisteredProcess>();

  constructor(private readonly options: ProcessRegistryOptions = {}) {}

  async register(resource: AgentProcessResource): Promise<AgentProcessSnapshot> {
    const existing = this.processes.get(resource.id);
    if (existing) {
      await this.stopRegistered(existing);
      this.processes.delete(resource.id);
    }
    const process = { ...resource, startedAt: this.now() };
    this.processes.set(resource.id, process);
    return snapshot(process);
  }

  list(): AgentProcessSnapshot[] {
    return [...this.processes.values()].map(snapshot);
  }

  async stopForDevice(deviceKey: string): Promise<void> {
    const targets = [...this.processes.values()].filter((process) => process.deviceKey === deviceKey);
    await this.stopMany(targets);
  }

  async stopAll(): Promise<void> {
    await this.stopMany([...this.processes.values()]);
  }

  private async stopMany(processes: RegisteredProcess[]): Promise<void> {
    for (const process of processes) {
      if (!this.processes.has(process.id)) {
        continue;
      }
      this.processes.delete(process.id);
      await this.stopRegistered(process);
    }
  }

  private async stopRegistered(process: RegisteredProcess): Promise<void> {
    await process.stop();
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

function snapshot(process: RegisteredProcess): AgentProcessSnapshot {
  return {
    id: process.id,
    deviceKey: process.deviceKey,
    kind: process.kind,
    startedAt: process.startedAt
  };
}
