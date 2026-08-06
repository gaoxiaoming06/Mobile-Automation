import { describe, expect, it, vi } from "vitest";
import { AndroidActionExecutor, AndroidHttpActionBackend, createAndroidActionBackendFromEnv } from "./android-actions.js";

describe("AndroidActionExecutor", () => {
  it("creates an Appium-compatible HTTP backend from env config", () => {
    expect(
      createAndroidActionBackendFromEnv({
        ANDROID_ACTION_BACKEND: "appium",
        APPIUM_SERVER_URL: "http://127.0.0.1:4723",
        APPIUM_SESSION_ID: "session-1"
      })
    ).toBeInstanceOf(AndroidHttpActionBackend);
  });

  it("does not create a semantic backend without explicit env config", () => {
    expect(createAndroidActionBackendFromEnv({})).toBeUndefined();
  });

  it("sends semantic tap requests to the configured Appium-compatible backend", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const backend = new AndroidHttpActionBackend({
      channel: "appium",
      endpoint: "http://127.0.0.1:4723",
      sessionId: "session-1",
      fetch: async (url, init) => {
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        return {
          ok: true,
          status: 200,
          text: async () => "{}"
        };
      }
    });

    const result = await backend.tapElement("device-1", {
      resourceId: "com.demo:id/login",
      packageName: "com.demo"
    });

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:4723/session/session-1/mobile-automation/tap-element",
        body: {
          serial: "device-1",
          locator: {
            resourceId: "com.demo:id/login",
            packageName: "com.demo"
          }
        }
      }
    ]);
    expect(result).toEqual({
      driverChannel: "appium",
      details: {
        endpoint: "http://127.0.0.1:4723/session/session-1/mobile-automation/tap-element"
      }
    });
  });

  it("dispatches basic input actions to stable Android keyevents", async () => {
    const calls: string[][] = [];
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      }),
      sleep: async () => undefined
    });

    await actions.performAction("device-1", { type: "tap", x: 10, y: 20 });
    await actions.performAction("device-1", { type: "long_press", x: 30, y: 40, durationMs: 900 });
    await actions.performAction("device-1", { type: "swipe", startX: 1, startY: 2, endX: 3, endY: 4 });
    await actions.performAction("device-1", { type: "hide_keyboard" });
    await actions.performAction("device-1", { type: "back" });
    await actions.performAction("device-1", { type: "home" });
    await actions.performAction("device-1", { type: "recent_apps" });

    expect(calls).toEqual([
      ["input", "tap", "10", "20"],
      ["input", "swipe", "30", "40", "30", "40", "900"],
      ["input", "swipe", "1", "2", "3", "4", "450"],
      ["input", "keyevent", "111"],
      ["input", "keyevent", "4"],
      ["input", "keyevent", "3"],
      ["input", "keyevent", "KEYCODE_APP_SWITCH"]
    ]);
  });

  it("launches the selected product launcher and verifies foreground state", async () => {
    const calls: string[][] = [];
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args[0] === "cmd" && args[2] === "query-activities") {
          return [
            "cn.eeo.classin/blockcanary.ui.BlockLauncherActivity",
            "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity"
          ].join("\n");
        }
        if (args[0] === "dumpsys" && args[1] === "activity") {
          return "mResumedActivity: ActivityRecord{abc u0 cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity t1}";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    await actions.performAction("device-1", { type: "launch_app", packageName: "cn.eeo.classin" });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["am", "start", "-n", "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity"],
        ["dumpsys", "activity", "activities"]
      ])
    );
    expect(calls.some((args) => args.includes("blockcanary.ui.BlockLauncherActivity"))).toBe(false);
  });

  it("uses clipboard fallback for unicode text when ADB Keyboard is unavailable", async () => {
    const calls: string[][] = [];
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      }),
      sleep: async () => undefined
    });

    await actions.performAction("device-1", { type: "input_text", text: "你好啊" });

    expect(calls).toEqual([
      ["ime", "list", "-s"],
      ["sh", "-c", "cmd clipboard set text 'mobile-automation' '你好啊'"],
      ["input", "keyevent", "KEYCODE_PASTE"]
    ]);
  });

  it("clears focused text with redundant delete fallbacks when ADB Keyboard is available", async () => {
    const calls: string[][] = [];
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        if (args.join(" ") === "ime list -s") {
          return "com.android.adbkeyboard/.AdbIME\ncom.demo/.Ime";
        }
        if (args.join(" ") === "settings get secure default_input_method") {
          return "com.demo/.Ime\n";
        }
        return "";
      }),
      sleep: async () => undefined
    });

    await actions.performAction("device-1", { type: "clear_text" });

    expect(calls.slice(0, 5)).toEqual([
      ["ime", "list", "-s"],
      ["settings", "get", "secure", "default_input_method"],
      ["ime", "set", "com.android.adbkeyboard/.AdbIME"],
      ["am", "broadcast", "-a", "ADB_CLEAR_TEXT"],
      ["ime", "set", "com.demo/.Ime"]
    ]);
    expect(calls.slice(5, 8)).toEqual([
      ["input", "keyevent", "KEYCODE_MOVE_END"],
      ["input", "keyevent", "KEYCODE_CTRL_A"],
      ["input", "keyevent", "KEYCODE_DEL"]
    ]);
    expect(calls.filter((args) => args.join(" ") === "input keyevent KEYCODE_DEL")).toHaveLength(41);
  });

  it("inputs text through Android keyevents when requested", async () => {
    const calls: string[][] = [];
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async (_serial, args) => {
        calls.push(args);
        return "";
      }),
      sleep: async () => undefined
    });

    await actions.performAction("device-1", { type: "input_keyevents", text: "a9 Z.", intervalMs: 0 });

    expect(calls).toEqual([
      ["input", "keyevent", "KEYCODE_A"],
      ["input", "keyevent", "KEYCODE_9"],
      ["input", "keyevent", "KEYCODE_SPACE"],
      ["input", "keyevent", "KEYCODE_Z"],
      ["input", "keyevent", "KEYCODE_PERIOD"]
    ]);
  });

  it("throws when clearing app data does not report success", async () => {
    const actions = new AndroidActionExecutor({
      shell: vi.fn(async () => "Failed"),
      sleep: async () => undefined
    });

    await expect(actions.clearAppData("device-1", "com.example")).rejects.toThrow("Failed");
  });
});
