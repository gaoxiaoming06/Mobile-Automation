import { describe, expect, it, vi } from "vitest";
import { type AndroidShellExecutor } from "./android-actions.js";
import {
  AndroidProcessDiscovery,
  isPackageProcess,
  matchesProcessFilter,
  parsePsOutput
} from "./android-process-discovery.js";

describe("parsePsOutput", () => {
  it("parses modern and legacy ps output into pid/name candidates", () => {
    expect(
      parsePsOutput(
        [
          "  PID NAME",
          "  101 cn.eeo.classin",
          "  102 cn.eeo.classin:push"
        ].join("\n")
      )
    ).toEqual([
      { pid: 101, name: "cn.eeo.classin" },
      { pid: 102, name: "cn.eeo.classin:push" }
    ]);

    expect(
      parsePsOutput(
        [
          "USER PID PPID VSZ RSS WCHAN ADDR S NAME",
          "u0_a123 201 99 123456 1234 0 0 S cn.eeo.classin"
        ].join("\n")
      )
    ).toEqual([{ pid: 201, name: "cn.eeo.classin" }]);
  });
});

describe("process matching helpers", () => {
  it("keeps package ownership and filters exact", () => {
    expect(isPackageProcess("cn.eeo.classin", "cn.eeo.classin", true)).toBe(true);
    expect(isPackageProcess("cn.eeo.classin:privileged_process0", "cn.eeo.classin", true)).toBe(true);
    expect(isPackageProcess("cn.eeo.classin:privileged_process0", "cn.eeo.classin", false)).toBe(false);
    expect(isPackageProcess("cn.eeo.classinhelper", "cn.eeo.classin", true)).toBe(false);

    expect(matchesProcessFilter("cn.eeo.classin", "cn.eeo.classin", ["main"])).toBe(true);
    expect(matchesProcessFilter("cn.eeo.classin:push", "cn.eeo.classin", ["main"])).toBe(false);
    expect(matchesProcessFilter("cn.eeo.classin:privileged_process0", "cn.eeo.classin", [":privileged_process0"])).toBe(true);
    expect(matchesProcessFilter("cn.eeo.classin:push", "cn.eeo.classin", [":privileged_process0"])).toBe(false);
    expect(matchesProcessFilter("cn.eeo.classin:push", "cn.eeo.classin", ["cn.eeo.classin:push"])).toBe(true);
  });
});

describe("AndroidProcessDiscovery", () => {
  it("discovers main and subprocesses from ps -A -o PID,NAME", async () => {
    const shell = createShell({
      "ps -A -o PID,NAME": [
        "  PID NAME",
        "  101 cn.eeo.classin",
        "  102 cn.eeo.classin:push",
        "  103 cn.eeo.classinhelper"
      ].join("\n"),
      "cat /proc/101/cmdline": "cn.eeo.classin\u0000",
      "cat /proc/102/cmdline": "cn.eeo.classin:push\u0000",
      "cat /proc/103/cmdline": "cn.eeo.classinhelper\u0000"
    });
    const discovery = new AndroidProcessDiscovery({ shell });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true,
      processFilters: []
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 101,
        processName: "cn.eeo.classin",
        packageName: "cn.eeo.classin",
        isMainProcess: true
      }),
      expect.objectContaining({
        pid: 102,
        processName: "cn.eeo.classin:push",
        packageName: "cn.eeo.classin",
        isMainProcess: false
      })
    ]);
    expect(processes[0]?.discoveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(shell).toHaveBeenCalledWith("device-1", ["ps", "-A", "-o", "PID,NAME"], { timeoutMs: 5000 });
  });

  it("uses /proc pid cmdline to repair truncated ps names", async () => {
    const shell = createShell({
      "ps -A -o PID,NAME": ["  PID NAME", "  202 cn.eeo.classin:priv"].join("\n"),
      "cat /proc/202/cmdline": "cn.eeo.classin:privileged_process0\u0000"
    });
    const discovery = new AndroidProcessDiscovery({ shell });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 202,
        processName: "cn.eeo.classin:privileged_process0",
        isMainProcess: false
      })
    ]);
  });

  it("falls back to legacy ps when modern ps has no package candidates", async () => {
    const shell = createShell({
      "ps -A -o PID,NAME": ["  PID NAME", "  301 system_server"].join("\n"),
      ps: [
        "USER PID PPID VSZ RSS WCHAN ADDR S NAME",
        "u0_a123 302 99 123456 1234 0 0 S cn.eeo.classin"
      ].join("\n"),
      "cat /proc/302/cmdline": "cn.eeo.classin\u0000"
    });
    const discovery = new AndroidProcessDiscovery({ shell });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 302,
        processName: "cn.eeo.classin",
        isMainProcess: true
      })
    ]);
    expect(shell).toHaveBeenCalledWith("device-1", ["ps"], { timeoutMs: 5000 });
  });

  it("keeps only suffix-matched subprocesses with processFilters", async () => {
    const discovery = new AndroidProcessDiscovery({
      shell: createShell({
        "ps -A -o PID,NAME": [
          "  PID NAME",
          "  401 cn.eeo.classin",
          "  402 cn.eeo.classin:privileged_process0",
          "  403 cn.eeo.classin:push"
        ].join("\n"),
        "cat /proc/401/cmdline": "cn.eeo.classin\u0000",
        "cat /proc/402/cmdline": "cn.eeo.classin:privileged_process0\u0000",
        "cat /proc/403/cmdline": "cn.eeo.classin:push\u0000"
      })
    });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true,
      processFilters: [":privileged_process0"]
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 402,
        processName: "cn.eeo.classin:privileged_process0"
      })
    ]);
  });

  it("keeps only the main process with the main filter", async () => {
    const discovery = new AndroidProcessDiscovery({
      shell: createShell({
        "ps -A -o PID,NAME": ["  PID NAME", "  501 cn.eeo.classin", "  502 cn.eeo.classin:push"].join("\n"),
        "cat /proc/501/cmdline": "cn.eeo.classin\u0000",
        "cat /proc/502/cmdline": "cn.eeo.classin:push\u0000"
      })
    });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true,
      processFilters: ["main"]
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 501,
        processName: "cn.eeo.classin",
        isMainProcess: true
      })
    ]);
  });

  it("excludes subprocesses when includeSubprocesses is false", async () => {
    const discovery = new AndroidProcessDiscovery({
      shell: createShell({
        "ps -A -o PID,NAME": ["  PID NAME", "  601 cn.eeo.classin", "  602 cn.eeo.classin:push"].join("\n"),
        "cat /proc/601/cmdline": "cn.eeo.classin\u0000",
        "cat /proc/602/cmdline": "cn.eeo.classin:push\u0000"
      })
    });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: false
    });

    expect(processes).toEqual([
      expect.objectContaining({
        pid: 601,
        processName: "cn.eeo.classin",
        isMainProcess: true
      })
    ]);
  });

  it("returns an empty list when shell commands fail", async () => {
    const discovery = new AndroidProcessDiscovery({
      shell: vi.fn<AndroidShellExecutor>(async () => {
        throw new Error("adb failed");
      })
    });

    await expect(discovery.discover("device-1", "cn.eeo.classin", { includeSubprocesses: true })).resolves.toEqual([]);
  });

  it("does not match apps that only share a package-name prefix", async () => {
    const discovery = new AndroidProcessDiscovery({
      shell: createShell({
        "ps -A -o PID,NAME": ["  PID NAME", "  701 cn.eeo.classinhelper"].join("\n"),
        ps: ["USER PID PPID VSZ RSS WCHAN ADDR S NAME", "u0_a123 701 99 123456 1234 0 0 S cn.eeo.classinhelper"].join("\n"),
        "cat /proc/701/cmdline": "cn.eeo.classinhelper\u0000"
      })
    });

    const processes = await discovery.discover("device-1", "cn.eeo.classin", {
      includeSubprocesses: true
    });

    expect(processes).toEqual([]);
  });
});

function createShell(outputs: Record<string, string | Error>): AndroidShellExecutor {
  return vi.fn<AndroidShellExecutor>(async (_serial, args) => {
    const key = args.join(" ");
    const output = outputs[key];
    if (output instanceof Error) {
      throw output;
    }
    if (output === undefined) {
      throw new Error(`Unexpected shell command: ${key}`);
    }
    return output;
  });
}
