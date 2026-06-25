import { describe, expect, it } from "vitest";
import {
  assertAmStartSucceeded,
  escapeInputText,
  escapeShellSingleQuoted,
  formatLogcatSince,
  isForegroundComponentForPackage,
  isPmClearSuccess,
  parseAndroidLogEvent,
  parseBattery,
  parseDeviceLine,
  parseForegroundApp,
  parseFocusedComponent,
  parseMeminfo,
  parsePackageInfo,
  parseProcStat,
  parseWmSize,
  pickLauncherComponent
} from "./android-parsers.js";

describe("android parser helpers", () => {
  it("parses adb device lines and wm size", () => {
    expect(parseDeviceLine("abc123 device product:foo model:Pixel_6 device:oriole")).toEqual({
      serial: "abc123",
      state: "device",
      details: "product:foo model:Pixel_6 device:oriole"
    });
    expect(parseDeviceLine("badline")).toBeNull();
    expect(parseWmSize("Physical size: 1080x2400")).toEqual({ width: 1080, height: 2400 });
  });

  it("escapes text for Android input and shell clipboard commands", () => {
    expect(escapeInputText("hello world%\"'")).toBe("hello%sworld\\%\\\"\\'");
    expect(escapeShellSingleQuoted("I'm here")).toBe("I'\\''m here");
  });

  it("parses performance shell outputs", () => {
    expect(parseProcStat("cpu  10 0 5 85 0 0 0 0 0 0")).toEqual({ idle: 85, total: 100 });
    expect(parseMeminfo("MemTotal:       1000 kB\nMemAvailable:    250 kB")).toEqual({
      totalKb: 1000,
      usedKb: 750,
      raw: {
        MemAvailable: 250,
        MemTotal: 1000
      }
    });
    expect(parseBattery("level: 87\ntemperature: 326")).toEqual({
      level: 87,
      temperatureC: 32.6,
      raw: {
        level: 87,
        temperature: 326
      }
    });
  });

  it("formats logcat start time and classifies Android event lines", () => {
    expect(formatLogcatSince(new Date(2026, 5, 7, 15, 48, 9, 123))).toBe("06-07 15:48:09.123");
    expect(parseAndroidLogEvent("FATAL EXCEPTION: main", ["before", "FATAL EXCEPTION: main"])).toEqual(
      expect.objectContaining({
        type: "crash",
        severity: "error",
        summary: "Android crash detected"
      })
    );
    expect(parseAndroidLogEvent("ANR in cn.eeo.classin", ["ANR in cn.eeo.classin"])).toEqual(
      expect.objectContaining({
        type: "anr",
        summary: "Android ANR detected: cn.eeo.classin"
      })
    );
    expect(parseAndroidLogEvent("cmd: Failure calling service", ["cmd: Failure calling service"])).toEqual(
      expect.objectContaining({
        type: "command_failed",
        severity: "warning"
      })
    );
    expect(parseAndroidLogEvent("06-21 11:11:36.226 E/libteec_vendor(  598): InvokeCommand failed", ["InvokeCommand failed"])).toBeUndefined();
  });

  it("selects product launcher components before debug launcher components", () => {
    const output = [
      "cn.eeo.classin/blockcanary.ui.BlockLauncherActivity",
      "cn.eeo.classin/leakcanary.internal.activity.LeakLauncherActivity",
      "cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity"
    ].join("\n");

    expect(pickLauncherComponent(output, "cn.eeo.classin")).toBe("cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity");
  });

  it("rejects debug launcher components as foreground success", () => {
    const output = "mCurrentFocus=Window{123 u0 cn.eeo.classin/blockcanary.ui.BlockLauncherActivity}";
    const component = parseFocusedComponent(output);

    expect(component).toBe("cn.eeo.classin/blockcanary.ui.BlockLauncherActivity");
    expect(isForegroundComponentForPackage(component, "cn.eeo.classin")).toBe(false);
    expect(isForegroundComponentForPackage("cn.eeo.classin/cn.eeo.startup.ui.LogoSplashActivity", "cn.eeo.classin")).toBe(true);
  });

  it("parses foreground package and activity from focused component output", () => {
    expect(parseForegroundApp("mCurrentFocus=Window{123 u0 com.demo/.MainActivity}")).toEqual({
      componentName: "com.demo/.MainActivity",
      packageName: "com.demo",
      activityName: "com.demo.MainActivity"
    });
    expect(parseForegroundApp("mResumedActivity: ActivityRecord{abc u0 com.demo/com.demo.HomeActivity t1}")).toEqual({
      componentName: "com.demo/com.demo.HomeActivity",
      packageName: "com.demo",
      activityName: "com.demo.HomeActivity"
    });
  });

  it("parses installed package version info", () => {
    const output = [
      "Packages:",
      "  Package [cn.eeo.classin] (abc123):",
      "    versionCode=99856 minSdk=23 targetSdk=35",
      "    versionName=5.0.8",
      "    firstInstallTime=2026-06-01 10:20:30",
      "    lastUpdateTime=2026-06-14 12:30:45"
    ].join("\n");

    expect(parsePackageInfo(output, "cn.eeo.classin")).toEqual({
      packageName: "cn.eeo.classin",
      displayVersion: "5.0.8",
      versionCode: "99856",
      firstInstallTime: "2026-06-01 10:20:30",
      lastUpdateTime: "2026-06-14 12:30:45"
    });
  });

  it("detects am start and pm clear success or failure text", () => {
    expect(() => assertAmStartSucceeded("Starting: Intent { cmp=com.example/.MainActivity }")).not.toThrow();
    expect(() => assertAmStartSucceeded("Error: Activity class does not exist.")).toThrow("does not exist");
    expect(isPmClearSuccess("Success")).toBe(true);
    expect(isPmClearSuccess("Package com.example success")).toBe(true);
    expect(isPmClearSuccess("Failed")).toBe(false);
  });
});
