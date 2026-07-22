import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidStabilityEventParser } from "./android-stability-events.js";

describe("AndroidStabilityEventParser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects Java crashes for the target package main process", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const event = parser.observe("07-22 10:00:00.002 E AndroidRuntime: Process: cn.eeo.classin, PID: 1234", [
      "07-22 10:00:00.001 E AndroidRuntime: FATAL EXCEPTION: main"
    ]);

    expect(event).toEqual(
      expect.objectContaining({
        type: "java_crash",
        severity: "error",
        processName: "cn.eeo.classin",
        pid: 1234,
        summary: "Java crash detected: cn.eeo.classin"
      })
    );
    expect(event?.detail).toContain("FATAL EXCEPTION");
    expect(event?.detail).toContain("Process: cn.eeo.classin, PID: 1234");
  });

  it("detects Java crashes for target package subprocesses", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const event = parser.observe("07-22 10:00:00.002 E AndroidRuntime: Process: cn.eeo.classin:privileged_process0, PID: 2234", [
      "07-22 10:00:00.001 E AndroidRuntime: FATAL EXCEPTION: binder:2234_1"
    ]);

    expect(event).toEqual(
      expect.objectContaining({
        type: "java_crash",
        processName: "cn.eeo.classin:privileged_process0",
        pid: 2234
      })
    );
  });

  it("does not accept packages that merely share the target package prefix", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const event = parser.observe("07-22 10:00:00.002 E AndroidRuntime: Process: cn.eeo.classinhelper, PID: 3234", [
      "07-22 10:00:00.001 E AndroidRuntime: FATAL EXCEPTION: main"
    ]);

    expect(event).toBeUndefined();
  });

  it("detects native crashes for the target package", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const event = parser.observe("07-22 10:00:01.002 F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR)", [
      "07-22 10:00:01.001 F DEBUG   : pid: 1234, tid: 1234, name: cn.eeo.classin  >>> cn.eeo.classin <<<"
    ]);

    expect(event).toEqual(
      expect.objectContaining({
        type: "native_crash",
        severity: "error",
        processName: "cn.eeo.classin",
        pid: 1234,
        summary: "Native crash detected: cn.eeo.classin"
      })
    );
  });

  it("detects ANRs for the target package", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const event = parser.observe("07-22 10:00:02.000 E ActivityManager: ANR in cn.eeo.classin:privileged_process0", []);

    expect(event).toEqual(
      expect.objectContaining({
        type: "anr",
        severity: "error",
        processName: "cn.eeo.classin:privileged_process0",
        summary: "ANR detected: cn.eeo.classin:privileged_process0"
      })
    );
  });

  it("detects process death and kill events for the target package", () => {
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin" });

    const died = parser.observe("07-22 10:00:03.000 I ActivityManager: Process cn.eeo.classin (pid 1234) has died: fg TOP", []);
    const killed = parser.observe("07-22 10:00:04.000 I ActivityManager: Killing 2234:cn.eeo.classin:worker/u0a123 (adj 900): remove task", []);

    expect(died).toEqual(
      expect.objectContaining({
        type: "process_death",
        severity: "warning",
        processName: "cn.eeo.classin",
        pid: 1234
      })
    );
    expect(killed).toEqual(
      expect.objectContaining({
        type: "process_death",
        severity: "warning",
        processName: "cn.eeo.classin:worker",
        pid: 2234
      })
    );
  });

  it("deduplicates the same event within the configured window", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const parser = new AndroidStabilityEventParser({ packageName: "cn.eeo.classin", dedupeWindowMs: 5000 });
    const recentLines = ["07-22 10:00:00.001 E AndroidRuntime: FATAL EXCEPTION: main"];
    const line = "07-22 10:00:00.002 E AndroidRuntime: Process: cn.eeo.classin, PID: 1234";

    expect(parser.observe(line, recentLines)).toBeDefined();
    vi.mocked(Date.now).mockReturnValue(4000);
    expect(parser.observe(line, recentLines)).toBeUndefined();
  });
});
