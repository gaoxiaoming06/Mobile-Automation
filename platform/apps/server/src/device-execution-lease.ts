export type DeviceExecutionKind = "script_flow" | "stability_exploration";

export type DeviceExecutionOwner = {
  deviceSerial: string;
  runId: string;
  kind: DeviceExecutionKind;
};

export class DeviceExecutionBusyError extends Error {
  constructor(
    readonly deviceSerial: string,
    readonly activeRunId: string,
    readonly activeKind: DeviceExecutionKind
  ) {
    super(`Device ${deviceSerial} is already owned by ${activeKind} run ${activeRunId}`);
    this.name = "DeviceExecutionBusyError";
  }
}

export class DeviceExecutionLease {
  private readonly owners = new Map<string, DeviceExecutionOwner>();

  acquire(deviceSerial: string, runId: string, kind: DeviceExecutionKind): void {
    const current = this.owners.get(deviceSerial);
    if (current) {
      throw new DeviceExecutionBusyError(deviceSerial, current.runId, current.kind);
    }
    this.owners.set(deviceSerial, { deviceSerial, runId, kind });
  }

  release(deviceSerial: string, runId: string): void {
    if (this.owners.get(deviceSerial)?.runId === runId) {
      this.owners.delete(deviceSerial);
    }
  }

  current(deviceSerial: string): DeviceExecutionOwner | undefined {
    const owner = this.owners.get(deviceSerial);
    return owner ? { ...owner } : undefined;
  }
}
