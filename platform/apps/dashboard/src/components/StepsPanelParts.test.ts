import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunConfigDrawer, formatShortTime, requiresStartAppPackageName, startStrategyLabel } from "./StepsPanelParts.js";

const noop = vi.fn();

function renderRunConfigDrawer(overrides: Partial<React.ComponentProps<typeof RunConfigDrawer>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(RunConfigDrawer, {
      repeatCount: 1,
      stepIntervalMs: 500,
      loopUntilStopped: false,
      pauseAfterEachStep: false,
      startStrategy: "keep_current",
      startAppPackageName: "",
      startSetupScope: "before_run",
      androidAppMonitorEnabled: false,
      androidAppMonitorPackageName: "",
      androidAppMonitorIncludeSubprocesses: true,
      androidAppMonitorCpuThresholdEnabled: false,
      androidAppMonitorCpuThresholdPercent: 80,
      androidAppMonitorMemoryThresholdEnabled: false,
      androidAppMonitorMemoryThresholdMb: 512,
      androidAppMonitorHeapDumpEnabled: false,
      setRepeatCount: noop,
      setStepIntervalMs: noop,
      setLoopUntilStopped: noop,
      setPauseAfterEachStep: noop,
      setStartStrategy: noop,
      setStartAppPackageName: noop,
      setStartSetupScope: noop,
      setAndroidAppMonitorEnabled: noop,
      setAndroidAppMonitorPackageName: noop,
      setAndroidAppMonitorIncludeSubprocesses: noop,
      setAndroidAppMonitorCpuThresholdEnabled: noop,
      setAndroidAppMonitorCpuThresholdPercent: noop,
      setAndroidAppMonitorMemoryThresholdEnabled: noop,
      setAndroidAppMonitorMemoryThresholdMb: noop,
      setAndroidAppMonitorHeapDumpEnabled: noop,
      ...overrides
    })
  );
}

describe("StepsPanelParts helpers", () => {
  it("formats saved-case timestamps for compact display", () => {
    expect(formatShortTime("2026-06-09T08:09:10.000Z")).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
    expect(formatShortTime("not-a-date")).toBe("not-a-date");
  });

  it("detects which start strategies require a package name", () => {
    expect(requiresStartAppPackageName("keep_current")).toBe(false);
    expect(requiresStartAppPackageName("go_home")).toBe(false);
    expect(requiresStartAppPackageName("launch_app")).toBe(true);
    expect(requiresStartAppPackageName("restart_app")).toBe(true);
    expect(requiresStartAppPackageName("clear_data_and_launch")).toBe(true);
  });

  it("labels start strategies for the run config summary", () => {
    expect(startStrategyLabel("keep_current")).toBe("保持当前");
    expect(startStrategyLabel("go_home")).toBe("回到 Home");
    expect(startStrategyLabel("launch_app")).toBe("启动 App");
    expect(startStrategyLabel("restart_app")).toBe("重启 App");
    expect(startStrategyLabel("clear_data_and_launch")).toBe("清数据后启动");
  });
});

describe("RunConfigDrawer", () => {
  it("surfaces a blocking warning when restart needs an app package name", () => {
    const markup = renderRunConfigDrawer({ startStrategy: "restart_app", startAppPackageName: "" });

    expect(markup).toContain("执行配置");
    expect(markup).toContain("重启 App");
    expect(markup).toContain("当前起始状态需要 App 包名");
    expect(markup).toContain("field-error");
  });

  it("does not warn for keep-current runs without a package name", () => {
    const markup = renderRunConfigDrawer({ startStrategy: "keep_current", startAppPackageName: "" });

    expect(markup).toContain("保持当前");
    expect(markup).not.toContain("当前起始状态需要 App 包名");
  });

  it("renders compact android app monitor controls", () => {
    const markup = renderRunConfigDrawer({ androidAppMonitorEnabled: true, androidAppMonitorPackageName: "com.example.app" });

    expect(markup).toContain("App 侧车监控");
    expect(markup).toContain("监控包名");
    expect(markup).toContain("包含子进程");
    expect(markup).toContain("CPU 阈值");
    expect(markup).toContain("PSS 阈值");
    expect(markup).toContain("Heap dump");
    expect(markup).toContain("com.example.app");
  });
});
