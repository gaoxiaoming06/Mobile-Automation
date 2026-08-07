import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  DEFAULT_ANDROID_APP_MONITOR_SETTINGS,
  DEFAULT_SCRIPT_APP_ID,
  DASHBOARD_ADVANCED_TOOLS_STORAGE_KEY,
  RetainedNavPanel,
  actionStrategyForWorkspace,
  agentPairingCommand,
  aiModelSettingsRequestBody,
  androidAppMonitorDefaultEnabled,
  dashboardAdvancedToolsEnabled,
  pageAssetLibraryInitialization,
  previewWorkspaceKey,
  shouldHoldDashboardControlLease,
  workspaceStyleForNav
} from "./App.js";
import { defaultAndroidCapabilities, type DeviceInfo } from "@mobile-automation/shared";

describe("App shell", () => {
  it("renders the application shell", () => {
    const markup = renderToStaticMarkup(React.createElement(App));
    expect(markup).toContain("自动化测试平台");
    expect(markup).toContain("设备管理");
    expect(markup).not.toContain("资产校准");
    expect(markup).not.toContain("页面资产库");
    expect(markup).toContain("用例中心");
    expect(markup).not.toContain("脚本用例");
    expect(markup).toContain("AI 生成测试");
    expect(markup).not.toContain("资产用例");
  });

  it("only enables live preview rendering on preview workspaces", () => {
    expect(previewWorkspaceKey("devices")).toBe("deviceDetails");
    expect(previewWorkspaceKey("assetRecording")).toBe("assetRecording");
    expect(previewWorkspaceKey("scriptFlows")).toBe("inactive");
    expect(workspaceStyleForNav("assetRecording", 480, 620)).toEqual(expect.objectContaining({ "--asset-recording-preview-width": "620px" }));
  });

  it("keeps a visited workbench panel mounted while another tab is active", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        RetainedNavPanel,
        { active: false, panelId: "aiScriptFlows" },
        React.createElement("input", { defaultValue: "临时草稿" })
      )
    );

    expect(markup).toContain('data-retained-nav-panel="aiScriptFlows"');
    expect(markup).toContain("hidden");
    expect(markup).toContain('value="临时草稿"');
  });

  it("holds the selected agent device lease across non-preview tabs", () => {
    const selectedDevice = agentDevice("agent-local:android:ERLDU20115007395");

    expect(shouldHoldDashboardControlLease("devices", selectedDevice, selectedDevice.serial)).toBe(true);
    expect(shouldHoldDashboardControlLease("scriptFlows", selectedDevice, selectedDevice.serial)).toBe(true);
    expect(shouldHoldDashboardControlLease("runs", selectedDevice, selectedDevice.serial)).toBe(true);
    expect(shouldHoldDashboardControlLease("settings", selectedDevice, selectedDevice.serial)).toBe(true);
  });

  it("does not hold a control lease without an online selected agent device", () => {
    expect(shouldHoldDashboardControlLease("scriptFlows", undefined, "")).toBe(false);
    expect(shouldHoldDashboardControlLease("scriptFlows", { ...agentDevice("agent-local:android:ERLDU20115007395"), status: "offline" }, "agent-local:android:ERLDU20115007395")).toBe(false);
    expect(shouldHoldDashboardControlLease("scriptFlows", regularDevice("ERLDU20115007395"), "ERLDU20115007395")).toBe(false);
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

  it("uses the cross-platform product id as the default ScriptFlow app id", () => {
    expect(DEFAULT_SCRIPT_APP_ID).toBe("classin");
  });

  it("keeps advanced tools disabled by default and lets local storage override env", () => {
    const emptyStorage = { getItem: () => null };

    expect(dashboardAdvancedToolsEnabled(emptyStorage, undefined)).toBe(false);
    expect(dashboardAdvancedToolsEnabled(emptyStorage, "true")).toBe(true);
    expect(dashboardAdvancedToolsEnabled({ getItem: (key) => (key === DASHBOARD_ADVANCED_TOOLS_STORAGE_KEY ? "false" : null) }, "true")).toBe(false);
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
    expect(pageAssetLibraryInitialization("harmony", { harmonyBundleName: "com.eeo.classin.harmony" })).toEqual({
      platform: "harmony",
      appId: "classin",
      targetIdentifier: "com.eeo.classin.harmony",
      defaultName: "com.eeo.classin.harmony 页面资产"
    });
    expect(pageAssetLibraryInitialization("ios", {})).toBeUndefined();
  });

  it("builds a private agent pairing command for packaged agents", () => {
    expect(agentPairingCommand("654321")).toBe("NODE_BIN=/opt/homebrew/bin/node ./start-private-agent.sh --agent-id agent-package-local --pairing-code 654321");
  });
});

function agentDevice(serial: string): DeviceInfo {
  return {
    ...regularDevice(serial),
    agent: {
      agentId: "agent-local",
      name: "本机 Agent",
      endpoint: "https://127.0.0.1:4010",
      connectedAt: "2026-08-07T08:00:00.000Z",
      lastHeartbeatAt: "2026-08-07T08:00:00.000Z",
      visibility: "public"
    }
  } as DeviceInfo;
}

function regularDevice(serial: string): DeviceInfo {
  return {
    id: serial,
    serial,
    platform: "android",
    name: "YAL-AL10",
    status: "online",
    resolution: { width: 1080, height: 2340 },
    orientation: "portrait",
    capabilities: defaultAndroidCapabilities(),
    lastSeenAt: "2026-08-07T08:00:00.000Z"
  };
}
