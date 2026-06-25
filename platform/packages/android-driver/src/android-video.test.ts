import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AndroidVideoRecorder } from "./android-video.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn()
  };
});

describe("AndroidVideoRecorder", () => {
  afterEach(() => {
    vi.mocked(execFile).mockReset();
    vi.mocked(spawn).mockReset();
  });

  it("records with Android screenrecord first and removes device video when discarded", async () => {
    const calls: string[][] = [];
    const child = createChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const tempDir = await mkdtemp(path.join(tmpdir(), "mobile-automation-video-"));
    const recorder = new AndroidVideoRecorder({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "sh" && String(args[2]).includes("command -v screenrecord")) {
          return "/system/bin/screenrecord";
        }
        if (args[0] === "sh" && String(args[2]).includes("screenrecord --help")) {
          return "0";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    try {
      const recording = await recorder.startVideoRecording("device-1", "run-1", tempDir);

      expect(recording.kind).toBe("screenrecord");
      expect(recording.devicePath).toBe("/sdcard/mobile-automation/run-1.mp4");
      expect(recording.localPath).toBe(path.join(tempDir, "run-1.mp4"));
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        "adb",
        ["-s", "device-1", "shell", "screenrecord", "--bit-rate", "4000000", "/sdcard/mobile-automation/run-1.mp4"],
        { stdio: "pipe" }
      );

      await recorder.stopVideoRecording(recording, false);

      expect(calls).toEqual(
        expect.arrayContaining([
          ["mkdir", "-p", "/sdcard/mobile-automation"],
          ["rm", "-f", "/sdcard/mobile-automation/run-1.mp4"]
        ])
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to scrcpy recording when screenrecord is unavailable", async () => {
    const execFileMock = vi.mocked(execFile) as unknown as {
      mockImplementation: (implementation: (...args: unknown[]) => unknown) => void;
    };
    execFileMock.mockImplementation((command, _args, _options, callback) => {
      const done = callback as (error: Error | null, stdout: string, stderr: string) => void;
      done(command === "scrcpy" ? null : new Error("missing"), "", "");
    });
    const child = createChildProcess();
    child.pid = 1234;
    vi.mocked(spawn).mockReturnValueOnce(child as never);
    const tempDir = await mkdtemp(path.join(tmpdir(), "mobile-automation-video-"));
    const recorder = new AndroidVideoRecorder({
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "sh" && String(args[2]).includes("command -v screenrecord")) {
          return "";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    try {
      const recording = await recorder.startVideoRecording("device-1", "run-2", tempDir);

      expect(recording.kind).toBe("scrcpy");
      expect(recording.processGroupPid).toBe(1234);
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        "scrcpy",
        ["--serial", "device-1", "--no-playback", "--no-audio", "--record", path.join(tempDir, "run-2.mp4")],
        { detached: true, stdio: "pipe" }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function createChildProcess(): EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  killed: boolean;
  pid?: number;
  kill: (signal?: NodeJS.Signals) => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    killed: boolean;
    pid?: number;
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
