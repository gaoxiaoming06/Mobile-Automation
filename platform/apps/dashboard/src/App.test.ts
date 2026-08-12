import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  App,
  AgentAccessView,
  DEFAULT_ANDROID_APP_MONITOR_SETTINGS,
  DEFAULT_AI_MODEL_SETTINGS,
  DEFAULT_SCRIPT_APP_ID,
  DEFAULT_TARGET_APPS,
  DASHBOARD_ADVANCED_TOOLS_STORAGE_KEY,
  DeviceManagementView,
  GlobalDeviceSwitcher,
  GlobalTargetAppSwitcher,
  RetainedNavPanel,
  SettingsView,
  TargetAppMenu,
  actionStrategyForWorkspace,
  agentPairingCommand,
  aiModelSettingsRequestBody,
  aiModelDraftFromSettings,
  androidAppMonitorDefaultEnabled,
  agentVersionOutdated,
  compareAgentVersions,
  defaultSelectedTargetAppId,
  deleteTargetApp,
  copyCreatedAgentPairingCommand,
  dashboardAdvancedToolsEnabled,
  detectAgentCommandShell,
  fetchAgentDistributionManifest,
  isDefaultTargetApp,
  localAgentDisplayVersion,
  loadTargetApps,
  pageAssetLibraryInitialization,
  previewWorkspaceKey,
  saveTargetApps,
  shouldHoldDashboardControlLease,
  targetAppIdentifierForPlatform,
  upsertTargetApp,
  workspaceStyleForNav
} from "./App.js";
import { defaultAndroidCapabilities, type DeviceInfo } from "@mobile-automation/shared";
import type { LocalAgentControlStatus } from "./App.js";

describe("App shell", () => {
  it("keeps global dropdown menus anchored to the trigger right edge", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const baseMenuIndex = styles.lastIndexOf(".device-switch-menu {");
    const globalMenuIndex = styles.lastIndexOf(".device-switch-menu.global-device-switch-menu");
    const globalMenuRule = styles.slice(globalMenuIndex, styles.indexOf("}", globalMenuIndex) + 1);

    expect(globalMenuIndex).toBeGreaterThan(baseMenuIndex);
    expect(globalMenuRule).toContain("left: auto");
    expect(globalMenuRule).toContain("right: 0");
  });

  it("renders the application shell", () => {
    const markup = renderToStaticMarkup(React.createElement(App));
    expect(markup).toContain("自动化测试平台");
    expect(markup).toContain("topbar-context-group");
    expect(markup).toContain("设备管理");
    expect(markup).not.toContain("设备接入");
    expect(markup).not.toContain("资产校准");
    expect(markup).not.toContain("页面资产库");
    expect(markup).toContain("用例中心");
    expect(markup).not.toContain("脚本用例");
    expect(markup).toContain("AI 生成测试");
    expect(markup).not.toContain("资产用例");
  });

  it("places Agent access inside system settings", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SettingsView, {
        aiSettings: DEFAULT_AI_MODEL_SETTINGS,
        aiDraft: aiModelDraftFromSettings(DEFAULT_AI_MODEL_SETTINGS),
        androidAppMonitorDraft: DEFAULT_ANDROID_APP_MONITOR_SETTINGS,
        busy: false,
        activeSection: "agentAccess",
        agentAccessPanel: React.createElement("div", null, "接入命令"),
        onSectionChange: () => undefined,
        onAiDraftChange: () => undefined,
        onAndroidAppMonitorDraftChange: () => undefined,
        onSaveAiSettings: () => undefined
      })
    );

    expect(markup).toContain("系统设置");
    expect(markup).toContain("设备接入");
    expect(markup).toContain("接入命令");
    expect(markup).toContain("Android 监控");
    expect(markup).toContain("AI 模型");
  });

  it("links the empty device state to Agent access settings", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DeviceManagementView, {
        devices: [],
        selectedSerial: "",
        previewPanel: React.createElement("div", null, "preview"),
        tools: [],
        runs: [],
        controlOwnerId: "browser-a",
        onOpenRuns: () => undefined,
        onRefreshDevices: () => undefined,
        onOpenAgentAccess: () => undefined
      })
    );

    expect(markup).toContain("没有可管理设备");
    expect(markup).toContain("去设置接入 Agent");
  });

  it("keeps Agent access controls focused on mode switching instead of logs and low-level status", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AgentAccessView, {
        status: localAgentStatus(false),
        error: "",
        busy: false,
        agentPairing: {
          code: "335226",
          sessionId: "pairing-session",
          createdAt: "2026-08-12T02:50:00.000Z",
          expiresAt: "2026-08-12T02:56:09.000Z",
          paired: false
        },
        sharedAgentCommand: "",
        onRefreshStatus: () => undefined,
        onStartShared: () => undefined,
        onStartPrivate: () => undefined,
        onStop: () => undefined,
        onRestart: () => undefined,
        onUpdate: () => undefined,
        onCreatePairingCommand: () => undefined,
        onCopyPairingCommand: () => undefined,
        onCopySharedCommand: () => undefined
      })
    );

    expect(markup).toContain("接入命令");
    expect(markup).toContain("共享模式");
    expect(markup).toContain("私有模式");
    const actionGrid = markup.slice(markup.indexOf("agent-action-grid"), markup.indexOf("agent-config-grid"));
    expect(markup).toContain("切换为共享模式");
    expect(actionGrid).toContain("重连 Agent");
    expect(actionGrid).toContain("断开 Agent");
    expect(actionGrid).not.toContain("更新 Agent");
    expect(markup.match(/agent-mode-switch-button/g)).toHaveLength(1);
    expect(markup).not.toContain("共享到服务端");
    expect(markup).not.toContain(">私有接入<");
    expect(markup).not.toContain("查看日志");
    expect(markup).not.toContain("本机 Agent 日志");
    expect(markup).not.toContain("control online");
    expect(markup).not.toContain("agent pid");
  });

  it("moves Agent update into the version card with an outdated badge", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AgentAccessView, {
        status: localAgentStatus(false),
        error: "",
        busy: false,
        agentPairing: undefined,
        sharedAgentCommand: "",
        agentManifest: {
          version: "0.2.0",
          file: "mobile-automation-agent.cjs",
          url: "/agent/mobile-automation-agent.cjs",
          sha256: "sha256"
        },
        onRefreshStatus: () => undefined,
        onStartShared: () => undefined,
        onStartPrivate: () => undefined,
        onStop: () => undefined,
        onRestart: () => undefined,
        onUpdate: () => undefined,
        onCreatePairingCommand: () => undefined,
        onCopyPairingCommand: () => undefined,
        onCopySharedCommand: () => undefined
      })
    );
    const actionGrid = markup.slice(markup.indexOf("agent-action-grid"), markup.indexOf("agent-config-grid"));
    const statGrid = markup.slice(markup.indexOf("agent-access-stat-grid"), markup.indexOf("agent-access-grid"));

    expect(actionGrid).not.toContain("更新 Agent");
    expect(statGrid).toContain("agent-version-card");
    expect(statGrid).toContain("agent-update-dot");
    expect(statGrid).toContain("服务端 0.2.0");
    expect(statGrid).toContain("aria-label=\"更新 Agent\"");
  });

  it("shows pairing expiration only on the private command row", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AgentAccessView, {
        status: localAgentStatus(false),
        error: "",
        busy: false,
        agentPairing: {
          code: "335226",
          sessionId: "pairing-session",
          createdAt: "2026-08-12T02:50:00.000Z",
          expiresAt: "2026-08-12T02:56:09.000Z",
          paired: false
        },
        sharedAgentCommand: "",
        onRefreshStatus: () => undefined,
        onStartShared: () => undefined,
        onStartPrivate: () => undefined,
        onStop: () => undefined,
        onRestart: () => undefined,
        onUpdate: () => undefined,
        onCreatePairingCommand: () => undefined,
        onCopyPairingCommand: () => undefined,
        onCopySharedCommand: () => undefined
      })
    );
    const commandHeader = markup.slice(markup.indexOf("agent-command-title"), markup.indexOf("agent-command-list"));
    const privateRow = markup.slice(markup.indexOf("私有 335226"));

    expect(commandHeader).toContain("已按当前系统显示");
    expect(commandHeader).not.toContain("过期");
    expect(privateRow).toContain("过期");
  });

  it("explains expired private pairing errors in Agent access settings", () => {
    const status = localAgentStatus(false);
    status.agent.registrationError = "/api/agents/register failed (400): Pairing code is invalid or expired";
    const markup = renderToStaticMarkup(
      React.createElement(AgentAccessView, {
        status,
        error: "",
        busy: false,
        agentPairing: undefined,
        sharedAgentCommand: "",
        onRefreshStatus: () => undefined,
        onStartShared: () => undefined,
        onStartPrivate: () => undefined,
        onStop: () => undefined,
        onRestart: () => undefined,
        onUpdate: () => undefined,
        onCreatePairingCommand: () => undefined,
        onCopyPairingCommand: () => undefined,
        onCopySharedCommand: () => undefined
      })
    );

    expect(markup).toContain("私有配对码无效或已过期");
    expect(markup).toContain("重连 Agent 会生成新配对码");
  });

  it("separates local process status from server registration status", () => {
    const status = localAgentStatus(false);
    status.agent.serverConnected = false;
    status.agent.registrationError = "/api/agents/register failed (400): Pairing code is invalid or expired";
    const markup = renderToStaticMarkup(
      React.createElement(AgentAccessView, {
        status,
        error: "",
        busy: false,
        agentPairing: undefined,
        sharedAgentCommand: "",
        onRefreshStatus: () => undefined,
        onStartShared: () => undefined,
        onStartPrivate: () => undefined,
        onStop: () => undefined,
        onRestart: () => undefined,
        onUpdate: () => undefined,
        onCreatePairingCommand: () => undefined,
        onCopyPairingCommand: () => undefined,
        onCopySharedCommand: () => undefined
      })
    );
    const statGrid = markup.slice(markup.indexOf("agent-access-stat-grid"), markup.indexOf("agent-access-grid"));

    expect(statGrid).toContain("<strong>可用</strong><span>本机控制</span>");
    expect(statGrid).toContain("<strong>运行</strong><span>Agent 进程</span>");
    expect(statGrid).toContain("<strong>注册失败</strong><span>服务端接入</span>");
    expect(statGrid).not.toContain("<strong>在线</strong><span>控制服务</span>");
  });

  it("renders the selected target app in the global topbar switcher", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GlobalTargetAppSwitcher, {
        apps: DEFAULT_TARGET_APPS,
        selectedApp: DEFAULT_TARGET_APPS[0],
        selectedPlatform: "harmony",
        onSelectApp: () => undefined,
        onCreateApp: () => undefined
      })
    );

    expect(markup).toContain("context-switch-button");
    expect(markup).toContain("context-switch-kicker");
    expect(markup).toContain(">应用<");
    expect(markup).toContain("ClassIn");
    expect(markup).toContain("新增应用");
  });

  it("renders icon-only app row actions without a separate management header", () => {
    const apps = [
      ...DEFAULT_TARGET_APPS,
      {
        appId: "321",
        name: "321",
        androidPackageName: "123"
      }
    ];
    const markup = renderToStaticMarkup(
      React.createElement(TargetAppMenu, {
        apps,
        selectedApp: apps[1],
        selectedPlatform: "android",
        onSelectApp: () => undefined,
        onEditApp: () => undefined,
        onDeleteApp: () => undefined
      })
    );

    expect(markup).not.toContain("管理应用");
    expect(markup).toContain("默认应用");
    expect(markup).toContain('aria-label="编辑目标应用 321"');
    expect(markup).toContain('aria-label="移除目标应用 321"');
    expect(markup).not.toContain("</svg>编辑</button>");
    expect(markup).not.toContain("</svg>移除</button>");
  });

  it("renders the selected device in the global topbar switcher", () => {
    const device = regularDevice("device-1");
    const markup = renderToStaticMarkup(
      React.createElement(GlobalDeviceSwitcher, {
        devices: [device],
        selectedSerial: "device-1",
        selectedDevice: device,
        controlOwnerId: "browser-a",
        onSelectDevice: () => undefined,
        onRefreshDevices: () => undefined
      })
    );

    expect(markup).toContain("context-switch-button");
    expect(markup).toContain("context-switch-kicker");
    expect(markup).toContain(">设备<");
    expect(markup).toContain("YAL-AL10");
    expect(markup).toContain("刷新设备");
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

  it("keeps ClassIn as the default target app across platform identifiers", () => {
    expect(DEFAULT_TARGET_APPS[0]).toEqual({
      appId: "classin",
      name: "ClassIn",
      androidPackageName: "cn.eeo.classin",
      harmonyBundleName: "com.eeo.classin.harmony"
    });
    expect(targetAppIdentifierForPlatform(DEFAULT_TARGET_APPS[0], "android")).toBe("cn.eeo.classin");
    expect(targetAppIdentifierForPlatform(DEFAULT_TARGET_APPS[0], "harmony")).toBe("com.eeo.classin.harmony");
    expect(targetAppIdentifierForPlatform(DEFAULT_TARGET_APPS[0], "ios")).toBeUndefined();
  });

  it("loads and saves locally added target apps", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      }
    };
    const apps = [
      ...DEFAULT_TARGET_APPS,
      {
        appId: "demo",
        name: "Demo",
        androidPackageName: "com.example.demo",
        iosBundleId: "com.example.demo.ios"
      }
    ];

    saveTargetApps(apps, storage);

    expect(loadTargetApps(storage)).toEqual(apps);
    expect(defaultSelectedTargetAppId(loadTargetApps(storage), "missing")).toBe("classin");
    expect(defaultSelectedTargetAppId(loadTargetApps(storage), "demo")).toBe("demo");
  });

  it("updates an existing target app instead of duplicating the app id", () => {
    const apps = [
      ...DEFAULT_TARGET_APPS,
      {
        appId: "321",
        name: "321",
        androidPackageName: "123"
      }
    ];

    expect(upsertTargetApp(apps, {
      appId: "321",
      name: "ClassIn 测试包",
      androidPackageName: "cn.eeo.classin.debug",
      harmonyBundleName: "com.eeo.classin.harmony.debug"
    })).toEqual([
      ...DEFAULT_TARGET_APPS,
      {
        appId: "321",
        name: "ClassIn 测试包",
        androidPackageName: "cn.eeo.classin.debug",
        harmonyBundleName: "com.eeo.classin.harmony.debug"
      }
    ]);
  });

  it("deletes locally added target apps while keeping the built-in ClassIn app", () => {
    const apps = [
      ...DEFAULT_TARGET_APPS,
      {
        appId: "321",
        name: "321",
        androidPackageName: "123"
      }
    ];

    const nextApps = deleteTargetApp(apps, "321");

    expect(nextApps).toEqual(DEFAULT_TARGET_APPS);
    expect(defaultSelectedTargetAppId(nextApps, "321")).toBe("classin");
    expect(isDefaultTargetApp("classin")).toBe(true);
    expect(isDefaultTargetApp("321")).toBe(false);
    expect(deleteTargetApp(nextApps, "classin")).toEqual(DEFAULT_TARGET_APPS);
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
    expect(agentPairingCommand("654321", {
      currentOrigin: "https://10.0.0.8:5173",
      serverUrl: "https://10.0.0.8:4010"
    })).toBe("curl -kfsSL 'https://10.0.0.8:5173/agent/install.sh?server=https%3A%2F%2F10.0.0.8%3A4010' | bash -s -- --agent-id \"$(hostname)\" --pairing-code 654321 --insecure-tls");
  });

  it("copies the private agent command immediately after pairing creation", async () => {
    const copiedCommands: string[] = [];
    const message = await copyCreatedAgentPairingCommand(
      "654321",
      async (command) => {
        copiedCommands.push(command);
        return true;
      },
      {
        currentOrigin: "https://10.0.0.8:5173",
        serverUrl: "https://10.0.0.8:4010"
      }
    );

    expect(copiedCommands).toEqual([
      "curl -kfsSL 'https://10.0.0.8:5173/agent/install.sh?server=https%3A%2F%2F10.0.0.8%3A4010' | bash -s -- --agent-id \"$(hostname)\" --pairing-code 654321 --insecure-tls"
    ]);
    expect(message).toBe("已复制 Agent 配对命令");
  });

  it("builds a shared agent install command", () => {
    expect(agentPairingCommand(undefined, {
      currentOrigin: "https://mobile.example.test",
      serverUrl: "https://mobile.example.test",
      mode: "shared",
      agentId: "lab-mac-01",
      insecureTls: false
    })).toBe("curl -fsSL 'https://mobile.example.test/agent/install.sh?server=https%3A%2F%2Fmobile.example.test' | bash -s -- --agent-id lab-mac-01 --shared");
  });

  it("builds a Windows PowerShell agent install command", () => {
    expect(agentPairingCommand("654321", {
      currentOrigin: "https://mobile.example.test",
      serverUrl: "https://mobile.example.test",
      shell: "powershell",
      insecureTls: false
    })).toContain("/agent/install.ps1?server=https%3A%2F%2Fmobile.example.test");
    expect(agentPairingCommand("654321", {
      currentOrigin: "https://mobile.example.test",
      serverUrl: "https://mobile.example.test",
      shell: "powershell",
      insecureTls: false
    })).toContain("-PairingCode '654321'");
  });

  it("detects the command shell from the browser platform", () => {
    expect(detectAgentCommandShell("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("bash");
    expect(detectAgentCommandShell("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("powershell");
  });

  it("compares Agent versions numerically before showing update hints", () => {
    const status = localAgentStatus(false);

    expect(localAgentDisplayVersion(status)).toBe("0.1.0");
    expect(compareAgentVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareAgentVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(agentVersionOutdated("0.1.0", "0.2.0")).toBe(true);
    expect(agentVersionOutdated("0.10.0", "0.9.0")).toBe(false);
  });

  it("loads the Agent distribution manifest for update checks", async () => {
    const manifest = {
      version: "0.2.0",
      file: "mobile-automation-agent.cjs",
      url: "/agent/mobile-automation-agent.cjs",
      sha256: "sha256"
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(fetchAgentDistributionManifest()).resolves.toEqual(manifest);
      expect(fetchMock).toHaveBeenCalledWith("/agent/manifest.json");
    } finally {
      vi.unstubAllGlobals();
    }
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

function localAgentStatus(shared: boolean): LocalAgentControlStatus {
  return {
    ok: true,
    control: {
      running: true,
      port: 17611,
      version: "0.1.0"
    },
    agent: {
      running: true,
      pid: 66107,
      config: {
        serverUrl: "http://10.254.32.11:4010",
        agentId: "eeos-MacBook-Pro-4.local",
        shared,
        version: "0.1.0"
      }
    }
  };
}
