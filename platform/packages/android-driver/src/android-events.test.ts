import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidLogcatEventWatcher } from "./android-events.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn()
  };
});

describe("AndroidLogcatEventWatcher", () => {
  afterEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("starts logcat from the requested time and emits parsed crash events", async () => {
    const child = createChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const onEvent = vi.fn();
    const watcher = await new AndroidLogcatEventWatcher().watchDeviceEvents("device-1", onEvent, {
      since: new Date(2026, 5, 7, 15, 48, 9, 123)
    });

    child.stdout.write("06-07 15:48:10.000 F DEBUG before\n");
    child.stdout.write("FATAL EXCEPTION: main\n");
    child.stdout.write("FATAL EXCEPTION: main\n");

    expect(vi.mocked(spawn)).toHaveBeenCalledWith("adb", ["-s", "device-1", "logcat", "-v", "time", "-T", "06-07 15:48:09.123"], {
      stdio: "pipe"
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "crash",
        severity: "error",
        summary: "Android crash detected"
      })
    );

    await watcher.stop();
  });

  it("emits a warning when logcat exits unexpectedly", async () => {
    const child = createChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const onEvent = vi.fn();
    await new AndroidLogcatEventWatcher().watchDeviceEvents("device-1", onEvent);

    child.stderr.write("device disconnected");
    child.exitCode = 1;
    child.emit("exit", 1);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command_failed",
        severity: "warning",
        summary: "Android logcat watcher exited",
        detail: "device disconnected"
      })
    );
  });
});

function createChildProcess(): EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    killed: boolean;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = vi.fn((signal?: NodeJS.Signals) => {
    child.killed = true;
    child.signalCode = signal ?? "SIGTERM";
    child.exitCode = 0;
    child.emit("exit", 0);
    return true;
  });
  return child;
}
