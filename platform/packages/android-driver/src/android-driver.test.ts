import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AndroidDriver } from "./index.js";
import type { AndroidActionBackend } from "./android-actions.js";
import { type AndroidLogcatEventWatcher } from "./android-events.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn()
  };
});

describe("AndroidDriver actions", () => {
  it("prefers a configured semantic Android backend before ADB input fallback", async () => {
    const calls: Array<{ serial: string; locator: string }> = [];
    const backend: AndroidActionBackend = {
      channel: "uiautomator2",
      async tapElement(serial, locator) {
        calls.push({ serial, locator: locator.resourceId ?? "" });
        return {
          driverChannel: "uiautomator2",
          details: {
            selector: locator.resourceId
          }
        };
      }
    };
    const driver = new AndroidDriver({
      actionBackend: backend,
      shell: vi.fn(async () => {
        throw new Error("ADB input should not be used for semantic element tap");
      })
    });

    const result = await driver.performSemanticAction("device-1", {
      type: "tap_on_element",
      locator: {
        resourceId: "com.demo:id/login"
      },
      fallbackTap: {
        x: 120,
        y: 240
      }
    });

    expect(calls).toEqual([{ serial: "device-1", locator: "com.demo:id/login" }]);
    expect(result).toEqual({
      driverChannel: "uiautomator2",
      details: {
        selector: "com.demo:id/login"
      }
    });
  });

  it("falls back to ADB input with an explicit reason when semantic backend is unavailable", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      })
    });

    const result = await driver.performSemanticAction("device-1", {
      type: "tap_on_element",
      locator: {
        resourceId: "com.demo:id/login"
      },
      fallbackTap: {
        x: 120,
        y: 240
      }
    });

    expect(calls).toEqual([["input", "tap", "120", "240"]]);
    expect(result).toEqual({
      driverChannel: "adb_input",
      fallbackReason: "semantic_backend_unavailable",
      details: {
        requestedChannel: "uiautomator2",
        semanticAction: "tap_on_element"
      }
    });
  });

  it("uses compressed UIAutomator dump before reading Android hierarchy", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cat") {
          return '<hierarchy rotation="0"></hierarchy>';
        }
        return "UI hierchary dumped";
      })
    });

    await expect(driver.dumpUiHierarchy("device-1")).resolves.toContain("<hierarchy");
    expect(calls[0]).toEqual(["uiautomator", "dump", "--compressed", expect.stringMatching(new RegExp("^/sdcard/mobile_automation_window_.*\\.xml$"))]);
    expect(calls.some((args) => args[0] === "rm" && args[1] === "-f")).toBe(true);
  });

  it("reads installed app version info from dumpsys package", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "dumpsys" && args[1] === "package") {
          return "Package [cn.eeo.classin]\n  versionCode=99856 minSdk=23 targetSdk=35\n  versionName=5.0.8\n";
        }
        return "";
      })
    });

    await expect(driver.getInstalledAppInfo("device-1", "cn.eeo.classin")).resolves.toEqual({
      packageName: "cn.eeo.classin",
      displayVersion: "5.0.8",
      versionCode: "99856"
    });
    expect(calls).toEqual([["dumpsys", "package", "cn.eeo.classin"]]);
  });

  it("starts an Android app monitor session with driver shell, watcher, and dumper wiring", async () => {
    const watcher = createAppMonitorWatcher();
    const writeTextArtifact = vi.fn(async () => ({ id: "cpu-artifact" }));
    const calls: string[][] = [];
    let systemStatReads = 0;
    let processStatReads = 0;
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "ps") {
          return "PID NAME\n1234 cn.eeo.classin\n";
        }
        if (args[0] === "cat" && args[1] === "/proc/1234/cmdline") {
          return "cn.eeo.classin\u0000";
        }
        if (args[0] === "cat" && args[1] === "/proc/stat") {
          systemStatReads += 1;
          return systemStatReads === 1
            ? "cpu  100 0 0 300 0 0 0 0 0 0\ncpu0 100 0 0 300 0 0 0 0 0 0"
            : "cpu  120 0 0 320 0 0 0 0 0 0\ncpu0 120 0 0 320 0 0 0 0 0 0";
        }
        if (args[0] === "cat" && args[1] === "/proc/1234/stat") {
          processStatReads += 1;
          return processStatReads === 1
            ? "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 100 0"
            : "1234 (cn.eeo.classin) S 1 2 3 4 5 6 7 8 9 10 110 0";
        }
        if (args[0] === "top") {
          return "top output";
        }
        if (args[0] === "dumpsys") {
          return "TOTAL 1024\n";
        }
        return "";
      }),
      appMonitor: {
        watcher: watcher.instance,
        sleep: async () => undefined,
        setInterval: () => 1,
        clearInterval: () => undefined
      }
    });

    const session = await driver.startAppMonitor(
      "device-1",
      "run-1",
      {
        enabled: true,
        packageName: "cn.eeo.classin",
        thresholds: {
          cpuPercent: { enabled: true, value: 0, sustainMs: 0, cooldownMs: 0 }
        }
      },
      writeTextArtifact
    );

    expect(watcher.watchDeviceEvents).toHaveBeenCalledWith("device-1", expect.any(Function), { packageName: "cn.eeo.classin" });
    expect(calls).toEqual(expect.arrayContaining([["ps", "-A", "-o", "PID,NAME"], ["top", "-H", "-b", "-n", "1", "-p", "1234"]]));
    expect(session.getSummary().incidents).toEqual([expect.objectContaining({ type: "cpu_threshold", artifactIds: ["cpu-artifact"] })]);
    await session.stop();
  });

  it("launches apps with the queried launcher activity instead of monkey", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example/.MainActivity\n";
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          return "mResumedActivity: ActivityRecord{abc u0 com.example/.MainActivity t1}";
        }
        if (args[0] === "dumpsys" && args[1] === "window") {
          return "mCurrentFocus=Window{123 u0 com.example/.MainActivity}";
        }
        return "";
      })
    });

    const result = await driver.performAction("device-1", { type: "launch_app", packageName: "com.example" });

    expect(result).toEqual({ driverChannel: "adb_input" });
    expect(calls).toEqual([
      [
        "cmd",
        "package",
        "query-activities",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
        "com.example"
      ],
      ["am", "start", "-n", "com.example/.MainActivity"],
      ["dumpsys", "activity", "activities"]
    ]);
  });

  it("prefers product launcher activity over debug launcher activities", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return [
            "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity",
            "cn.eeo.classin/blockcanary.ui.BlockLauncherActivity",
            "cn.eeo.classin/leakcanary.internal.activity.LeakLauncherActivity"
          ].join("\n");
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          return "mResumedActivity: ActivityRecord{abc u0 cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity t1}";
        }
        if (args[0] === "dumpsys" && args[1] === "window") {
          return "mCurrentFocus=Window{123 u0 cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity}";
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "launch_app", packageName: "cn.eeo.classin" });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["am", "start", "-n", "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity"],
        ["dumpsys", "activity", "activities"]
      ])
    );
    expect(calls.some((args) => args[0] === "monkey")).toBe(false);
  });

  it("does not treat a debug launcher activity as a successful foreground app", async () => {
    const calls: string[][] = [];
    let activityChecks = 0;
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return [
            "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity",
            "cn.eeo.classin/blockcanary.ui.BlockLauncherActivity"
          ].join("\n");
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          activityChecks += 1;
          if (activityChecks === 1) {
            return "mResumedActivity: ActivityRecord{abc u0 cn.eeo.classin/blockcanary.ui.BlockLauncherActivity t1}";
          }
          return "mResumedActivity: ActivityRecord{abc u0 cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity t1}";
        }
        if (args[0] === "dumpsys" && args[1] === "window") {
          return "mCurrentFocus=Window{123 u0 cn.eeo.classin/blockcanary.ui.BlockLauncherActivity}";
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "launch_app", packageName: "cn.eeo.classin" });

    expect(activityChecks).toBe(2);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["dumpsys", "window", "windows"],
        ["dumpsys", "activity", "activities"]
      ])
    );
  });

  it("falls back to resolved launcher when query-activities is unavailable", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return "";
        }
        if (args[0] === "cmd" && args[2] === "resolve-activity") {
          return "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example/.MainActivity\n";
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          return "mResumedActivity: ActivityRecord{abc u0 com.example/.MainActivity t1}";
        }
        if (args[0] === "dumpsys" && args[1] === "window") {
          return "mCurrentFocus=Window{123 u0 com.example/.MainActivity}";
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "launch_app", packageName: "com.example" });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["am", "start", "-n", "com.example/.MainActivity"],
        ["dumpsys", "activity", "activities"]
      ])
    );
    expect(calls.some((args) => args[0] === "monkey")).toBe(false);
  });

  it("does not launch a system resolver returned by resolve-activity", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return "";
        }
        if (args[0] === "cmd" && args[2] === "resolve-activity") {
          return "priority=0 preferredOrder=0 match=0x0 specificIndex=-1 isDefault=false\ncom.huawei.android.internal.app/.HwResolverActivity\n";
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          return "mResumedActivity: ActivityRecord{abc u0 com.example/.MainActivity t1}";
        }
        if (args[0] === "dumpsys" && args[1] === "window") {
          return "mCurrentFocus=Window{123 u0 com.example/.MainActivity}";
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "launch_app", packageName: "com.example" });

    expect(calls.some((args) => args.includes("com.huawei.android.internal.app/.HwResolverActivity"))).toBe(false);
    expect(calls).toEqual(
      expect.arrayContaining([
        [
          "am",
          "start",
          "-a",
          "android.intent.action.MAIN",
          "-c",
          "android.intent.category.LAUNCHER",
          "-p",
          "com.example"
        ],
        ["dumpsys", "activity", "activities"]
      ])
    );
  });

  it("fails launch_app when am start reports an unresolved package", async () => {
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "am") {
          return "Error: Activity not started, unable to resolve Intent";
        }
        return "";
      })
    });

    await expect(driver.performAction("device-1", { type: "launch_app", packageName: "not.exists.package" })).rejects.toThrow("unable to resolve");
  });

  it("fails launch_app when resolved activity start reports an error", async () => {
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        if (args[0] === "cmd") {
          return "com.example/.MainActivity";
        }
        return "Error: Activity class does not exist.";
      })
    });

    await expect(driver.performAction("device-1", { type: "launch_app", packageName: "com.example" })).rejects.toThrow("does not exist");
  });

  it("clears text through select-all and delete", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      })
    });

    await driver.performAction("device-1", { type: "clear_text" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["input", "keyevent", "KEYCODE_CTRL_A"],
      ["input", "keyevent", "KEYCODE_DEL"]
    ]);
  });

  it("inputs ascii text with Android input command first", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      })
    });

    await driver.performAction("device-1", { type: "input_text", text: "hello world" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["input", "text", "hello%sworld"]
    ]);
  });

  it("inputs text through ADB Keyboard when available", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "ime" && args[1] === "list") {
          return "com.android.adbkeyboard/.AdbIME\ncom.example/.OtherIme";
        }
        if (args[0] === "settings") {
          return "com.example/.OtherIme";
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "input_text", text: "你好啊" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["settings", "get", "secure", "default_input_method"],
      ["ime", "set", "com.android.adbkeyboard/.AdbIME"],
      ["am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", "你好啊"],
      ["ime", "set", "com.example/.OtherIme"]
    ]);
  });

  it("inputs unicode text through clipboard paste when ADB Keyboard is unavailable", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      })
    });

    await driver.performAction("device-1", { type: "input_text", text: "你好啊" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["sh", "-c", "cmd clipboard set text 'mobile-automation' '你好啊'"],
      ["input", "keyevent", "KEYCODE_PASTE"]
    ]);
  });

  it("falls back to input command when ADB Keyboard and clipboard paste are unavailable", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "sh") {
          throw new Error("cmd clipboard unavailable");
        }
        return "";
      })
    });

    await driver.performAction("device-1", { type: "input_text", text: "你好啊" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["sh", "-c", "cmd clipboard set text 'mobile-automation' '你好啊'"],
      ["input", "text", "你好啊"]
    ]);
  });

  it("opens recent apps with Android app switch keyevent", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      })
    });

    await driver.performAction("device-1", { type: "recent_apps" });

    expect(calls).toEqual([["input", "keyevent", "KEYCODE_APP_SWITCH"]]);
  });

  it("clears app data with pm clear", async () => {
    const calls: string[][] = [];
    const driver = new AndroidDriver({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "Success";
      })
    });

    await driver.clearAppData("device-1", "com.example");

    expect(calls).toEqual([["pm", "clear", "com.example"]]);
  });

  it("fails clear app data when pm clear does not report success", async () => {
    const driver = new AndroidDriver({
      shell: vi.fn(async () => "Failed")
    });

    await expect(driver.clearAppData("device-1", "com.example")).rejects.toThrow("Failed");
  });

  it("starts logcat watcher from the requested time window", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      exitCode: number | null;
      killed: boolean;
      kill: () => boolean;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.kill = vi.fn(() => {
      child.killed = true;
      child.exitCode = 0;
      child.emit("exit", 0);
      return true;
    });
    vi.mocked(spawn).mockReturnValueOnce(child as never);

    const driver = new AndroidDriver();
    const watcher = await driver.watchDeviceEvents("device-1", vi.fn(), {
      since: new Date(2026, 5, 7, 15, 48, 9, 123)
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledWith("adb", ["-s", "device-1", "logcat", "-v", "time", "-T", "06-07 15:48:09.123"], {
      stdio: "pipe"
    });
    await watcher.stop();
  });
});

function createAppMonitorWatcher() {
  const stop = vi.fn(async () => undefined);
  const watchDeviceEvents = vi.fn(async () => ({ stop }));
  return {
    instance: { watchDeviceEvents } as unknown as AndroidLogcatEventWatcher,
    watchDeviceEvents,
    stop
  };
}
