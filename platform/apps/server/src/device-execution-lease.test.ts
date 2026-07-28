import { describe, expect, it } from "vitest";
import { DeviceExecutionBusyError, DeviceExecutionLease } from "./device-execution-lease.js";

describe("DeviceExecutionLease", () => {
  it("prevents different execution engines from owning the same device", () => {
    const lease = new DeviceExecutionLease();
    lease.acquire("device-1", "script-run", "script_flow");

    expect(() => lease.acquire("device-1", "stability-run", "stability_exploration"))
      .toThrow(DeviceExecutionBusyError);
    expect(lease.current("device-1")).toEqual({
      deviceSerial: "device-1",
      runId: "script-run",
      kind: "script_flow"
    });

    lease.release("device-1", "script-run");
    expect(() => lease.acquire("device-1", "stability-run", "stability_exploration")).not.toThrow();
  });

  it("does not let an old owner release a newer lease", () => {
    const lease = new DeviceExecutionLease();
    lease.acquire("device-1", "run-1", "script_flow");
    lease.release("device-1", "wrong-run");

    expect(lease.current("device-1")?.runId).toBe("run-1");
  });
});
