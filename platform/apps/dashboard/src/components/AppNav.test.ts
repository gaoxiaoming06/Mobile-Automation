import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppNav } from "./AppNav.js";

const noop = vi.fn();

describe("AppNav", () => {
  it("surfaces the asset workflow and hides legacy case, experiment, and device detail entries", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppNav, {
        activeNavItem: "devices",
        navCollapsed: false,
        setNavCollapsed: noop,
        openDevices: noop,
        openAssetRecording: noop,
        openPageAssets: noop,
        openAssetComposition: noop,
        openFreeComposition: noop,
        openParameterCenter: noop,
        openAssetPatrol: noop,
        openStability: noop,
        openRuns: noop,
        openSettings: noop
      })
    );

    expect(markup).toContain("设备管理");
    expect(markup).not.toContain("设备详情");
    expect(markup).toContain("nav-item active");
    expect(markup).not.toContain("用例录制");
    expect(markup).not.toContain("用例库");
    expect(markup).toContain("资产录制");
    expect(markup).toContain("页面资产库");
    expect(markup).toContain("资产用例");
    expect(markup).toContain("AI资产用例");
    expect(markup).toContain("参数中心");
    expect(markup).toContain("资产驱动巡检");
    expect(markup).toContain("稳定性探索");
    expect(markup).toContain("执行结果");
    expect(markup).not.toContain("实验能力");
    expect(markup).toContain("系统设置");
    expect(markup).not.toContain("业务图谱上层能力已冻结");
    expect(markup).not.toContain("设置按产品规划接入");
    expect(markup).not.toContain(">节点测试<");
  });
});
