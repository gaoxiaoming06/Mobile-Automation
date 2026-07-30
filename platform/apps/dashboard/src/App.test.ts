import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  DEFAULT_ANDROID_APP_MONITOR_SETTINGS,
  actionStrategyForWorkspace,
  aiModelSettingsRequestBody,
  androidAppMonitorDefaultEnabled,
  pageAssetLibraryInitialization,
  previewWorkspaceKey,
  workspaceStyleForNav
} from "./App.js";

describe("App shell", () => {
  it("renders the application shell", () => {
    const markup = renderToStaticMarkup(React.createElement(App));
    expect(markup).toContain("自动化测试平台");
    expect(markup).toContain("设备管理");
    expect(markup).toContain("用例中心");
    expect(markup).not.toContain("脚本用例");
    expect(markup).toContain("AI 生成测试");
    expect(markup).not.toContain("资产用例");
  });

  it("only enables preview workspaces that own device control", () => {
    expect(previewWorkspaceKey("devices")).toBe("deviceDetails");
    expect(previewWorkspaceKey("assetRecording")).toBe("assetRecording");
    expect(previewWorkspaceKey("scriptFlows")).toBe("inactive");
    expect(workspaceStyleForNav("assetRecording", 480, 620)).toEqual(expect.objectContaining({ "--asset-recording-preview-width": "620px" }));
  });

  it("blocks preview interaction while page identification is running", () => {
    expect(actionStrategyForWorkspace("assetRecording", { identifying: true })).toEqual(expect.objectContaining({ blockPreviewInteraction: true }));
    expect(actionStrategyForWorkspace("assetRecording", { identifying: false })).toEqual(expect.objectContaining({ blockPreviewInteraction: false }));
  });

  it("keeps app monitoring off for scripts unless all runs are enabled", () => {
    expect(DEFAULT_ANDROID_APP_MONITOR_SETTINGS.defaultMode).toBe("off");
    expect(androidAppMonitorDefaultEnabled("off", "script_flow")).toBe(false);
    expect(androidAppMonitorDefaultEnabled("all_runs", "script_flow")).toBe(true);
  });

  it("only submits local Codex preferences from the settings page", () => {
    expect(aiModelSettingsRequestBody({ enabled: true, model: "gpt-5.4", timeoutMs: 15_000 })).toEqual({
      enabled: true,
      model: "gpt-5.4",
      timeoutMs: 15_000
    });
  });

  it("builds first-library initialization from the observed foreground app", () => {
    expect(pageAssetLibraryInitialization("android", { androidPackageName: "cn.eeo.classin" })).toEqual({
      platform: "android",
      appId: "cn.eeo.classin",
      targetIdentifier: "cn.eeo.classin",
      defaultName: "cn.eeo.classin 页面资产"
    });
    expect(pageAssetLibraryInitialization("ios", {})).toBeUndefined();
  });
});
