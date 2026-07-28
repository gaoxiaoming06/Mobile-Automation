import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  DEFAULT_ANDROID_APP_MONITOR_SETTINGS,
  actionStrategyForWorkspace,
  androidAppMonitorDefaultEnabled,
  assetPageElementRequestBody,
  previewWorkspaceKey,
  validateAssetPageElementDraftForSave,
  workspaceStyleForNav
} from "./App.js";

describe("App shell", () => {
  it("renders the application shell", () => {
    const markup = renderToStaticMarkup(React.createElement(App));
    expect(markup).toContain("自动化测试平台");
    expect(markup).toContain("设备管理");
    expect(markup).toContain("脚本用例");
    expect(markup).toContain("AI 生成用例");
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

  it("persists a public locator without transition or task fields", () => {
    const body = assetPageElementRequestBody({
      sourceNodeId: "page-home",
      locator: "text:添加好友",
      elementLabel: "添加好友",
      targetText: "添加好友"
    }, { sourceNodeId: "page-home", platformScope: "android" });

    expect(body).toEqual(expect.objectContaining({
      sourceNodeId: "page-home",
      locator: "text:添加好友",
      elementLabel: "添加好友"
    }));
    expect(body).not.toHaveProperty("outcomeType");
    expect(body).not.toHaveProperty("targetNodeId");
    expect(body).not.toHaveProperty("transitionKind");
    expect(body).not.toHaveProperty("parameterMapping");
  });

  it("rejects screenshot regions that are too small to relocate", () => {
    expect(validateAssetPageElementDraftForSave({
      sourceNodeId: "page-home",
      locator: "image-region:10,10,0.1,0.1",
      elementLabel: "按钮"
    })).toContain("圈选区域过小");
  });
});
