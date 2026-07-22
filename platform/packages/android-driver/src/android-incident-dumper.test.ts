import { type AndroidProcessInfo } from "@mobile-automation/shared";
import { describe, expect, it, vi } from "vitest";
import { type AndroidShellExecutor } from "./android-actions.js";
import { AndroidIncidentDumper } from "./android-incident-dumper.js";

const processInfo: AndroidProcessInfo = {
  pid: 1234,
  processName: "cn.eeo.classin:privileged_process0",
  packageName: "cn.eeo.classin",
  isMainProcess: false,
  discoveredAt: "2026-07-22T00:00:00.000Z"
};

describe("AndroidIncidentDumper CPU incidents", () => {
  it("captures top -H output and writes it as an artifact", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async () => "Threads: 18\n  PID   TID USER      PR CPU% S  NAME\n");
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    const artifactIds = await dumper.dumpCpuIncident("run-1", "device-1", processInfo);

    expect(artifactIds).toEqual(["artifact-1"]);
    expect(shell).toHaveBeenCalledWith(
      "device-1",
      ["top", "-H", "-b", "-n", "1", "-p", "1234"],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(writeTextArtifact).toHaveBeenCalledWith(
      "run-1",
      expect.stringMatching(/^android-cpu-incident-cn_eeo_classin_privileged_process0-1234-.*\.txt$/),
      expect.stringContaining("Threads: 18")
    );
    expect(writeTextArtifact.mock.calls[0][2]).toContain("top -H -b -n 1 -p 1234");
  });

  it("falls back to /proc pid task diagnostics when top -H fails", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async (_serial, args) => {
      if (args[0] === "top") {
        throw new Error("top: invalid option -- H");
      }
      return "task 1234 status\nName:\tmain\n";
    });
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    const artifactIds = await dumper.dumpCpuIncident("run-1", "device-1", processInfo);

    expect(artifactIds).toEqual(["artifact-1"]);
    expect(shell).toHaveBeenCalledTimes(2);
    expect(shell.mock.calls[1][1]).toEqual(["sh", "-c", expect.stringContaining("/proc/1234/task")]);
    expect(writeTextArtifact.mock.calls[0][2]).toContain("top -H failed");
    expect(writeTextArtifact.mock.calls[0][2]).toContain("task 1234 status");
  });

  it("writes a failure artifact instead of throwing when top -H and /proc fallback fail", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async (_serial, args) => {
      if (args[0] === "top") {
        throw new Error("top failed");
      }
      throw new Error("permission denied reading /proc/1234/task");
    });
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    await expect(dumper.dumpCpuIncident("run-1", "device-1", processInfo)).resolves.toEqual(["artifact-1"]);
    expect(writeTextArtifact.mock.calls[0][2]).toContain("top failed");
    expect(writeTextArtifact.mock.calls[0][2]).toContain("permission denied reading /proc/1234/task");
  });

  it("resolves without artifact ids when writing the CPU artifact fails", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async () => "Threads: 18\n");
    const writeTextArtifact = vi.fn(async () => {
      throw new Error("artifact store unavailable");
    });
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    await expect(dumper.dumpCpuIncident("run-1", "device-1", processInfo)).resolves.toEqual([]);
    expect(writeTextArtifact).toHaveBeenCalledTimes(1);
  });
});

describe("AndroidIncidentDumper memory incidents", () => {
  it("captures meminfo and does not run dumpheap when heap dumps are disabled", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async () => "Applications Memory Usage (in Kilobytes):\nTOTAL 2048\n");
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    const artifactIds = await dumper.dumpMemoryIncident("run-1", "device-1", processInfo, { enableHeapDump: false });

    expect(artifactIds).toEqual(["artifact-1"]);
    expect(shell).toHaveBeenCalledWith(
      "device-1",
      ["dumpsys", "meminfo", "-d", "1234"],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
    expect(shell.mock.calls.some((call) => call[1][0] === "am" && call[1][1] === "dumpheap")).toBe(false);
    expect(writeTextArtifact.mock.calls[0][2]).toContain("TOTAL 2048");
  });

  it("attempts dumpheap when enabled and writes the failure as an artifact", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async (_serial, args) => {
      if (args[0] === "dumpsys") {
        return "TOTAL 2048\n";
      }
      throw new Error("heap dump permission denied");
    });
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    const artifactIds = await dumper.dumpMemoryIncident("run-1", "device-1", processInfo, { enableHeapDump: true });

    expect(artifactIds).toEqual(["artifact-1", "artifact-2"]);
    expect(shell.mock.calls[1][1]).toEqual([
      "am",
      "dumpheap",
      "1234",
      expect.stringMatching(/^\/sdcard\/mobile_automation_run-1_1234_.*\.hprof$/)
    ]);
    expect(writeTextArtifact.mock.calls[1][2]).toContain("heap dump permission denied");
  });

  it("writes a meminfo failure artifact instead of throwing", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async () => {
      throw new Error("dumpsys meminfo timed out");
    });
    const writeTextArtifact = createArtifactWriter();
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    await expect(dumper.dumpMemoryIncident("run-1", "device-1", processInfo, { enableHeapDump: false })).resolves.toEqual([
      "artifact-1"
    ]);
    expect(writeTextArtifact.mock.calls[0][2]).toContain("dumpsys meminfo timed out");
  });

  it("continues memory incident collection and returns successful artifact ids when one artifact write fails", async () => {
    const shell = vi.fn<AndroidShellExecutor>(async (_serial, args) => {
      if (args[0] === "dumpsys") {
        return "TOTAL 2048\n";
      }
      return "Heap dump file created\n";
    });
    const writeTextArtifact = vi
      .fn<(runId: string, fileName: string, content: string) => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("meminfo artifact write failed"))
      .mockResolvedValueOnce({ id: "heap-artifact" });
    const dumper = new AndroidIncidentDumper({ shell, writeTextArtifact });

    await expect(dumper.dumpMemoryIncident("run-1", "device-1", processInfo, { enableHeapDump: true })).resolves.toEqual([
      "heap-artifact"
    ]);
    expect(shell.mock.calls.some((call) => call[1][0] === "am" && call[1][1] === "dumpheap")).toBe(true);
    expect(writeTextArtifact).toHaveBeenCalledTimes(2);
  });
});

function createArtifactWriter(): ReturnType<typeof vi.fn<(runId: string, fileName: string, content: string) => Promise<{ id: string }>>> {
  let index = 0;
  return vi.fn(async () => {
    index += 1;
    return { id: `artifact-${index}` };
  });
}
