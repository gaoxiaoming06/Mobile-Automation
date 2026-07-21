import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import {
  App,
  AssetPatrolPanel,
  ASSET_PATROL_DIAGNOSTIC_MODE_NOTICE,
  ASSET_DRIVEN_TEST_ACTION_LABEL,
  AiDiagnosisSettingsPanel,
  DEFAULT_ASSET_PATROL_PACKAGE_NAME,
  DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES,
  DEFAULT_STABILITY_EXPLORER_APP_EXIT_POLICY,
  DEFAULT_STABILITY_EXPLORER_MAX_DEPTH,
  DEFAULT_STABILITY_EXPLORER_START_MODE,
  DEFAULT_STABILITY_DANGEROUS_TEXT,
  actionStrategyForWorkspace,
  assetConnectionEdgeMessage,
  assetPatrolPanelDisplayMode,
  assetPatrolPlanGroups,
  assetPatrolPageScopeOptions,
  assetPatrolPlanRequiresBusinessSubmit,
  assetPatrolRequestBody,
  assetPatrolRuntimeParamDefinitionsForDisplay,
  assetPatrolRuntimeParamPlaceholder,
  assetPatrolRuntimeParamUsageSummary,
  assetPatrolRuntimeParamsTemplate,
  assetPatrolRuntimeParamValuesFromText,
  assetPatrolRunProgressSummary,
  assetDrivenExecutionProgressSummary,
  mergeAssetPatrolRuntimeParamsText,
  setAssetPatrolRuntimeParamValue,
  assetDrivenTestStartMessage,
  assetPageElementRequestBody,
  assetPageTaskRequestBody,
  assetRecordingIdentificationStateAfter,
  assetOperationTransitionRequestBody,
  currentPageAssetErrorMessage,
  canStartAssetDrivenTest,
  loadStabilityDangerousTextForPackage,
  mapCurrentPageAssetResponse,
  pageAssetMessage,
  previewWorkspaceKey,
  saveStabilityDangerousTextForPackage,
  stabilityExplorerRequestBody,
  stabilityRunProgressSummary,
  shouldAutoSyncAssetPatrolRuntimeParams,
  shouldRestoreAssetDrivenExecution,
  validateAssetPageElementDraftForSave,
  workspaceStyleForNav
} from "./App.js";
import { manualOperationDraftFromForm } from "./components/AssetRecordingPanel.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("App shell", () => {
  it("includes the asset recording navigation entry and keeps existing recording modules", () => {
    const markup = renderToStaticMarkup(React.createElement(App));

    expect(markup).toContain("用例录制");
    expect(markup).toContain("用例库");
    expect(markup).toContain("资产录制");
    expect(markup).toContain("页面资产库");
    expect(markup).toContain("资产驱动巡检");
    expect(markup).toContain("稳定性探索");
    expect(markup).toContain("系统设置");
  });

  it("renders AI diagnosis settings without exposing the saved api key", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AiDiagnosisSettingsPanel, {
        settings: {
          enabled: true,
          baseURL: "https://ai.example/v1",
          model: "gpt-test",
          timeoutMs: 12000,
          apiKeyConfigured: true,
          source: "stored"
        },
        draft: {
          enabled: true,
          baseURL: "https://ai.example/v1",
          apiKey: "",
          model: "gpt-test",
          timeoutMs: 12000
        },
        busy: false,
        onDraftChange: () => undefined,
        onSave: () => undefined
      })
    );

    expect(markup).toContain("AI 诊断");
    expect(markup).toContain("已配置");
    expect(markup).not.toContain("secret-key");
  });

  it("renders AI diagnosis settings as a compact single form", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AiDiagnosisSettingsPanel, {
        settings: {
          enabled: false,
          baseURL: "",
          model: "",
          timeoutMs: 30000,
          apiKeyConfigured: false,
          source: "none"
        },
        draft: {
          enabled: false,
          baseURL: "",
          apiKey: "",
          model: "",
          timeoutMs: 30000
        },
        busy: false,
        onDraftChange: () => undefined,
        onSave: () => undefined
      })
    );

    expect(markup).toContain("AI 诊断");
    expect(markup).toContain("接口地址");
    expect(markup).toContain("保存");
    expect(markup).not.toContain("AI 诊断配置");
    expect(markup).not.toContain("刷新");
    expect(markup).not.toContain("清除已保存密钥");
  });

  it("keeps the stability exploration config panel independently scrollable", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const configPanelRule = styles.match(/\.stability-config-panel\s*\{[^}]+\}/)?.[0] ?? "";
    const panelOverrideRule = styles.match(/\.panel\.stability-config-panel\s*\{[^}]+\}/)?.[0] ?? "";

    expect(configPanelRule).toContain("overflow-y: auto");
    expect(configPanelRule).toContain("max-height:");
    expect(panelOverrideRule).toContain("overflow-y: auto");
  });

  it("defaults stability exploration start mode to restart app", () => {
    expect(DEFAULT_STABILITY_EXPLORER_START_MODE).toBe("restart_app");
  });

  it("defaults stability exploration app-exit policy to returning to app", () => {
    expect(DEFAULT_STABILITY_EXPLORER_APP_EXIT_POLICY).toBe("back_to_app");
  });

  it("defaults stability exploration max depth to four", () => {
    expect(DEFAULT_STABILITY_EXPLORER_MAX_DEPTH).toBe(4);
  });

  it("persists stability dangerous text by package and keeps defaults visible", () => {
    const storage = new MemoryStorage();

    saveStabilityDangerousTextForPackage(" com.demo ", "删除\n支付\n封禁", storage);

    expect(loadStabilityDangerousTextForPackage("com.demo", storage)).toBe(`${DEFAULT_STABILITY_DANGEROUS_TEXT}\n封禁`);
  });

  it("isolates saved stability dangerous text between packages", () => {
    const storage = new MemoryStorage();

    saveStabilityDangerousTextForPackage("com.demo.a", "注销\n清退", storage);

    expect(loadStabilityDangerousTextForPackage("com.demo.b", storage)).toBe(DEFAULT_STABILITY_DANGEROUS_TEXT);
  });

  it("builds a bounded stability exploration request body", () => {
    expect(
      stabilityExplorerRequestBody({
        selectedSerial: "device-1",
        packageName: " com.demo ",
        maxDurationMinutes: 3,
        maxActions: 120,
        strategy: "balanced",
        startMode: "current_state",
        seed: "seed-42",
        allowedActions: {
          tap: true,
          swipe: false,
          back: true,
          wait: true
        },
        appExitPolicy: "restart_app",
        backtrackStrategy: "shallow",
        maxDepth: 2,
        dangerousTextPatternsText: "删除\n支付\n "
      })
    ).toEqual({
      deviceSerial: "device-1",
      packageName: "com.demo",
      maxDurationMs: 180_000,
      maxActions: 120,
      strategy: "balanced",
      startMode: "current_state",
      seed: "seed-42",
      allowedActions: ["tap", "back", "wait"],
      appExitPolicy: "restart_app",
      backtrackStrategy: "shallow",
      maxDepth: 2,
      dangerousTextPatterns: ["删除", "支付"],
      stopOnCrash: true,
      stopOnAnr: true,
      stopOnBlackScreen: true,
      stopOnUnknownPageStuck: true
    });
  });

  it("summarizes stability exploration progress from run metadata", () => {
    const summary = stabilityRunProgressSummary({
      id: "run-1",
      caseName: "稳定性探索：com.demo",
      deviceSerial: "device-1",
      status: "running",
      config: {
        runKind: "stability_exploration",
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 350,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false,
        stabilityExploration: {
          packageName: "com.demo",
          strategy: "balanced",
          startMode: "launch_app",
          seed: "seed-42",
          maxDurationMs: 180_000,
          maxActions: 20,
          allowedActions: ["tap", "swipe"],
          appExitPolicy: "restart_app",
          backtrackStrategy: "shallow",
          maxDepth: 2,
          dangerousTextPatterns: ["删除"],
          stopOnCrash: true,
          stopOnAnr: true,
          stopOnBlackScreen: true,
          stopOnUnknownPageStuck: true
        }
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-1",
          iterationIndex: 0,
          stepId: "stability_step_1",
          stepOrder: 1,
          type: "tap",
          status: "passed",
          startedAt: "2026-06-25T10:00:00.000Z",
          artifacts: [],
          metadata: {
            stabilityExploration: {
              candidateLabel: "添加好友",
              candidateSource: "ocr_text",
              currentPackage: "com.demo",
              skippedCandidates: [{ label: "删除", skipReason: "dangerous_text" }]
            }
          }
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-25T10:00:00.000Z"
    });

    expect(summary).toEqual({
      packageName: "com.demo",
      seed: "seed-42",
      progressText: "1 / 20",
      latestAction: "添加好友",
      latestSource: "ocr_text",
      currentPackage: "com.demo",
      skippedCandidates: 1
    });
  });

  it("builds an asset patrol request body with safe defaults exposed by the UI", () => {
    expect(
      assetPatrolRequestBody({
        selectedSerial: "device-1",
        packageName: " cn.eeo.classin ",
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录\n发布"
      })
    ).toEqual({
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      startMode: "current_state",
      pageScope: "current_page",
      maxDurationMs: 120_000,
      maxTransitions: 8,
      allowRiskyActions: false,
      allowBusinessSubmit: false,
      dangerousTextPatterns: ["删除", "退出登录", "发布"]
    });
  });

  it("includes runtime params in asset patrol requests for real asset-driven execution", () => {
    expect(
      assetPatrolRequestBody({
        selectedSerial: "device-1",
        packageName: " cn.eeo.classin ",
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: true,
        dangerousTextPatternsText: "删除",
        runtimeParamsText: "phone=18743085313\npassword=secret"
      })
    ).toEqual(
      expect.objectContaining({
        runtimeParams: {
          phone: "18743085313",
          password: "secret"
        }
      })
    );
  });

  it("builds and merges global asset runtime parameter templates without overwriting values", () => {
    const parameters = [
      { key: "phone" },
      { key: "password" },
      { key: "className" },
      { key: "duration" },
      { key: "recordClassroom" }
    ];

    expect(DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.phone).toBe("18743085313");
    expect(DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.password).toBe("eeo123");
    expect(DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.className).toBe("班级四十二号");
    expect(assetPatrolRuntimeParamsTemplate(parameters)).toBe("phone=18743085313\npassword=eeo123\nclassName=班级四十二号\nduration=30\nrecordClassroom=true");
    expect(mergeAssetPatrolRuntimeParamsText("phone=19900000000", parameters)).toBe("phone=19900000000\npassword=eeo123\nclassName=班级四十二号\nduration=30\nrecordClassroom=true");
    expect(mergeAssetPatrolRuntimeParamsText("phone=\npassword=secret", parameters)).toBe("phone=18743085313\npassword=secret\nclassName=班级四十二号\nduration=30\nrecordClassroom=true");
  });

  it("keeps runtime parameter values editable as structured fields", () => {
    expect(assetPatrolRuntimeParamValuesFromText("phone=\npassword=secret")).toEqual({
      phone: "",
      password: "secret"
    });
    expect(setAssetPatrolRuntimeParamValue("phone=\npassword=secret", "phone", "18743085313")).toBe("phone=18743085313\npassword=secret");
    expect(setAssetPatrolRuntimeParamValue("phone=18743085313", "password", "secret")).toBe("phone=18743085313\npassword=secret");
  });

  it("prioritizes runtime parameters used by the current page", () => {
    const definitions = [
      { key: "lessonName", usages: [{ pageModelName: "新建公开课", taskName: "创建课堂", stepLabel: "课堂标题" }] },
      { key: "phone", usages: [{ pageModelName: "登录", taskName: "账号密码登录", stepLabel: "手机号输入框" }] },
      { key: "password", usages: [{ pageModelName: "登录", taskName: "账号密码登录", stepLabel: "密码输入框" }] }
    ];

    expect(assetPatrolRuntimeParamDefinitionsForDisplay(definitions, "登录").map((item) => item.key)).toEqual(["phone", "password", "lessonName"]);
    expect(assetPatrolRuntimeParamUsageSummary(definitions[1])).toBe("登录 / 账号密码登录 / 手机号输入框");
    expect(assetPatrolRuntimeParamPlaceholder(definitions[2])).toBe("请输入密码");
  });

  it("enables current and reachable asset patrol scopes while keeping future scopes disabled", () => {
    expect(assetPatrolPageScopeOptions()).toEqual([
      { value: "current_page", label: "当前页", disabled: false },
      { value: "reachable_pages", label: "可达页面", disabled: false },
      { value: "tagged_pages", label: "标记页面（后续接入）", disabled: true },
      { value: "all_active_pages", label: "全部已激活页面（后续接入）", disabled: true }
    ]);
    expect(
      assetPatrolRequestBody({
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        startMode: "current_state",
        pageScope: "reachable_pages",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除"
      }).pageScope
    ).toBe("reachable_pages");
    expect(
      assetPatrolRequestBody({
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        startMode: "current_state",
        pageScope: "all_active_pages",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除"
      }).pageScope
    ).toBe("current_page");
  });

  it("groups asset patrol plans by page, ability, transition, and task", () => {
    const groups = assetPatrolPlanGroups({
      status: "ready",
      startPage: { id: "node-home", name: "主页", score: 0.96 },
      issues: [],
      summary: {
        pageChecks: 2,
        elementChecks: 1,
        transitionChecks: 1,
        taskChecks: 1,
        skipped: 0,
        needsRepair: 0
      },
      steps: [
        { id: "step-page-home", order: 1, kind: "page_match", label: "页面匹配：主页", status: "ready", pageModelName: "主页" },
        { id: "step-page-detail", order: 2, kind: "page_match", label: "可达页面：班级详情", status: "ready", pageModelName: "班级详情" },
        { id: "step-element", order: 3, kind: "element_relocation", label: "元素可重定位：班级列表", status: "ready", pageModelName: "主页" },
        { id: "step-transition", order: 4, kind: "transition_validation", label: "边巡检：主页 -> 班级详情", status: "ready", pageModelName: "主页" },
        { id: "step-task", order: 5, kind: "task_dry_run", label: "任务编排体检：填写课堂信息", status: "skipped", pageModelName: "新建课堂", skipReason: "business_submit_disabled" }
      ]
    });

    expect(groups.map((group) => [group.title, group.items.map((item) => item.label)])).toEqual([
      ["页面", ["页面匹配：主页", "可达页面：班级详情"]],
      ["能力", ["元素可重定位：班级列表"]],
      ["连接边", ["边巡检：主页 -> 班级详情"]],
      ["任务", ["任务编排体检：填写课堂信息"]]
    ]);
    expect(groups[3]?.items[0]?.detail).toBe("新建课堂 · skipped · business_submit_disabled");
  });

  it("defaults asset patrol to the ClassIn Android package", () => {
    expect(DEFAULT_ASSET_PATROL_PACKAGE_NAME).toBe("cn.eeo.classin");
  });

  it("exposes only the real asset-driven execution action in the asset patrol panel", () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(
      React.createElement(AssetPatrolPanel, {
        devices: [],
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        packageName: "cn.eeo.classin",
        packageOptions: ["cn.eeo.classin"],
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录",
        runtimeParamsText: "phone=18743085313\npassword=eeo123",
        runtimeParamDefinitions: [],
        busy: false,
        onSelectDevice: noop,
        onPackageNameChange: noop,
        onStartModeChange: noop,
        onPageScopeChange: noop,
        onMaxDurationMinutesChange: noop,
        onMaxTransitionsChange: noop,
        onAllowRiskyActionsChange: noop,
        onAllowBusinessSubmitChange: noop,
        onDangerousTextPatternsChange: noop,
        onRuntimeParamsChange: noop,
        onSyncRuntimeParams: noop,
        onExecute: noop,
        onStop: noop,
        onOpenRun: noop
      })
    );

    expect(markup).toContain(ASSET_DRIVEN_TEST_ACTION_LABEL);
    expect(markup).toContain("参数中心 &gt; 执行组合");
    expect(markup).not.toContain("测试数据");
    expect(markup).not.toContain("预览计划");
    expect(markup).not.toContain("执行资产体检");
  });

  it("shows asset-driven execution status in the patrol panel even when the run is a graph execution", () => {
    const noop = () => undefined;
    const currentRun: TestRun = {
      id: "run-asset-driven-graph",
      caseName: "ClassIn Android 业务图谱 目标节点执行",
      deviceSerial: "device-1",
      status: "running",
      config: {
        runKind: "business_graph",
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 400,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-07-07T10:00:00.000Z"
    };
    const markup = renderToStaticMarkup(
      React.createElement(AssetPatrolPanel, {
        devices: [],
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        packageName: "cn.eeo.classin",
        packageOptions: ["cn.eeo.classin"],
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录",
        runtimeParamsText: "phone=18743085313\npassword=eeo123",
        runtimeParamDefinitions: [],
        currentRun,
        busy: false,
        onSelectDevice: noop,
        onPackageNameChange: noop,
        onStartModeChange: noop,
        onPageScopeChange: noop,
        onMaxDurationMinutesChange: noop,
        onMaxTransitionsChange: noop,
        onAllowRiskyActionsChange: noop,
        onAllowBusinessSubmitChange: noop,
        onDangerousTextPatternsChange: noop,
        onRuntimeParamsChange: noop,
        onSyncRuntimeParams: noop,
        onExecute: noop,
        onStop: noop,
        onOpenRun: noop
      })
    );

    expect(markup).toContain("执行结果");
    expect(markup).toContain("ClassIn Android 业务图谱 目标节点执行");
    expect(markup).toContain("run-asset-driven-graph");
    expect(markup).toContain("running");
  });

  it("shows asset-driven execution as a batch instead of a single finished run", () => {
    const noop = () => undefined;
    const execution: NonNullable<Parameters<typeof assetDrivenExecutionProgressSummary>[0]> = {
      id: "asset-session-1",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      graphVersionId: "graph-1",
      startNodeId: "node-home",
      startNodeName: "主页",
      status: "running",
      totalEdges: 3,
      completedEdges: 1,
      runningEdges: 1,
      pendingEdges: 1,
      failedEdges: 0,
      needsRepair: 0,
      startedAt: "2026-07-07T10:00:00.000Z",
      updatedAt: "2026-07-07T10:00:03.000Z",
      runningItem: {
        id: "asset-session-1-item-2",
        order: 2,
        label: "主页 -> 添加好友",
        fromPage: "主页",
        toPage: "添加好友",
        status: "running",
        runId: "run-add"
      },
      items: [
        {
          id: "asset-session-1-item-1",
          order: 1,
          label: "主页 -> 搜索",
          fromPage: "主页",
          toPage: "搜索",
          status: "passed",
          runId: "run-search"
        },
        {
          id: "asset-session-1-item-2",
          order: 2,
          label: "主页 -> 添加好友",
          fromPage: "主页",
          toPage: "添加好友",
          status: "running",
          runId: "run-add"
        },
        {
          id: "asset-session-1-item-3",
          order: 3,
          label: "主页 -> 设置",
          fromPage: "主页",
          toPage: "设置",
          status: "pending"
        }
      ]
    };

    expect(assetDrivenExecutionProgressSummary(execution)).toEqual({
      packageName: "cn.eeo.classin",
      pageName: "主页",
      progressText: "1/3",
      latestCheck: "主页 -> 添加好友",
      failed: 0,
      skipped: 0,
      needsRepair: 0
    });

    const markup = renderToStaticMarkup(
      React.createElement(AssetPatrolPanel, {
        devices: [],
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        packageName: "cn.eeo.classin",
        packageOptions: ["cn.eeo.classin"],
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录",
        runtimeParamsText: "phone=18743085313\npassword=eeo123",
        runtimeParamDefinitions: [],
        assetDrivenExecution: execution,
        busy: false,
        onSelectDevice: noop,
        onPackageNameChange: noop,
        onStartModeChange: noop,
        onPageScopeChange: noop,
        onMaxDurationMinutesChange: noop,
        onMaxTransitionsChange: noop,
        onAllowRiskyActionsChange: noop,
        onAllowBusinessSubmitChange: noop,
        onDangerousTextPatternsChange: noop,
        onRuntimeParamsChange: noop,
        onSyncRuntimeParams: noop,
        onExecute: noop,
        onStop: noop,
        onOpenRun: noop
      })
    );

    expect(markup).toContain("资产测试批次");
    expect(markup).toContain("asset-session-1");
    expect(markup).toContain("已完成");
    expect(markup).toContain("1/3");
    expect(markup).toContain("当前执行");
    expect(markup).toContain("主页 -&gt; 添加好友");
    expect(markup).toContain("待执行");
    expect(markup).not.toContain("ClassIn Android 业务图谱 目标节点执行");
  });

  it("allows stopping a refreshed asset-driven execution session without a selected current run", () => {
    const noop = () => undefined;
    const execution: NonNullable<Parameters<typeof assetDrivenExecutionProgressSummary>[0]> = {
      id: "asset-session-refresh",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      graphVersionId: "graph-1",
      startNodeId: "node-home",
      startNodeName: "主页",
      status: "running",
      totalEdges: 2,
      completedEdges: 0,
      runningEdges: 1,
      pendingEdges: 1,
      failedEdges: 0,
      needsRepair: 0,
      startedAt: "2026-07-07T10:00:00.000Z",
      updatedAt: "2026-07-07T10:00:01.000Z",
      runningItem: {
        id: "asset-session-refresh-item-1",
        order: 1,
        label: "主页 -> 搜索",
        fromPage: "主页",
        toPage: "搜索",
        status: "running",
        runId: "run-search"
      },
      items: [
        {
          id: "asset-session-refresh-item-1",
          order: 1,
          label: "主页 -> 搜索",
          fromPage: "主页",
          toPage: "搜索",
          status: "running",
          runId: "run-search"
        },
        {
          id: "asset-session-refresh-item-2",
          order: 2,
          label: "主页 -> 添加好友",
          fromPage: "主页",
          toPage: "添加好友",
          status: "pending"
        }
      ]
    };

    const markup = renderToStaticMarkup(
      React.createElement(AssetPatrolPanel, {
        devices: [],
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        packageName: "cn.eeo.classin",
        packageOptions: ["cn.eeo.classin"],
        startMode: "current_state",
        pageScope: "current_page",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录",
        runtimeParamsText: "",
        runtimeParamDefinitions: [],
        assetDrivenExecution: execution,
        busy: false,
        onSelectDevice: noop,
        onPackageNameChange: noop,
        onStartModeChange: noop,
        onPageScopeChange: noop,
        onMaxDurationMinutesChange: noop,
        onMaxTransitionsChange: noop,
        onAllowRiskyActionsChange: noop,
        onAllowBusinessSubmitChange: noop,
        onDangerousTextPatternsChange: noop,
        onRuntimeParamsChange: noop,
        onSyncRuntimeParams: noop,
        onExecute: noop,
        onStop: noop,
        onOpenRun: noop
      })
    );

    expect(markup).toContain("asset-session-refresh");
    expect(markup).toContain("停止");
  });

  it("keeps failed asset batches automatic without exposing a manual resume action", () => {
    const noop = () => undefined;
    const execution: NonNullable<Parameters<typeof assetDrivenExecutionProgressSummary>[0]> = {
      id: "asset-session-failed",
      deviceSerial: "device-1",
      packageName: "cn.eeo.classin",
      graphVersionId: "graph-1",
      startNodeId: "node-home",
      startNodeName: "主页",
      status: "failed",
      totalEdges: 2,
      completedEdges: 1,
      runningEdges: 0,
      pendingEdges: 0,
      failedEdges: 1,
      needsRepair: 0,
      startedAt: "2026-07-07T10:00:00.000Z",
      updatedAt: "2026-07-07T10:00:03.000Z",
      endedAt: "2026-07-07T10:00:03.000Z",
      items: [
        { id: "item-1", order: 1, label: "主页 -> 班级详情", fromPage: "主页", toPage: "班级详情", status: "passed" },
        { id: "item-2", order: 2, label: "主页 -> 添加好友", fromPage: "主页", toPage: "添加好友", status: "skipped" }
      ]
    };

    const markup = renderToStaticMarkup(
      React.createElement(AssetPatrolPanel, {
        devices: [],
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        packageName: "cn.eeo.classin",
        packageOptions: ["cn.eeo.classin"],
        startMode: "current_state",
        pageScope: "reachable_pages",
        maxDurationMinutes: 2,
        maxTransitions: 8,
        allowRiskyActions: false,
        allowBusinessSubmit: false,
        dangerousTextPatternsText: "删除\n退出登录",
        runtimeParamsText: "",
        runtimeParamDefinitions: [],
        assetDrivenExecution: execution,
        busy: false,
        onSelectDevice: noop,
        onPackageNameChange: noop,
        onStartModeChange: noop,
        onPageScopeChange: noop,
        onMaxDurationMinutesChange: noop,
        onMaxTransitionsChange: noop,
        onAllowRiskyActionsChange: noop,
        onAllowBusinessSubmitChange: noop,
        onDangerousTextPatternsChange: noop,
        onRuntimeParamsChange: noop,
        onSyncRuntimeParams: noop,
        onExecute: noop,
        onStop: noop,
        onOpenRun: noop
      })
    );

    expect(markup).not.toContain("继续未完成");
    expect(markup).toContain("打开批次报告");
  });

  it("disables starting another asset-driven execution while the batch is running", () => {
    expect(
      canStartAssetDrivenTest({
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        selectedDeviceBusy: false,
        busy: false,
        running: true
      })
    ).toBe(false);
    expect(
      canStartAssetDrivenTest({
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        selectedDeviceBusy: false,
        busy: false,
        running: false
      })
    ).toBe(true);
  });

  it("auto-syncs asset patrol runtime params when opening the asset patrol page for a package", () => {
    expect(
      shouldAutoSyncAssetPatrolRuntimeParams({
        activeNavItem: "assetPatrol",
        packageName: " cn.eeo.classin ",
        lastSyncedPackageName: ""
      })
    ).toBe(true);
    expect(
      shouldAutoSyncAssetPatrolRuntimeParams({
        activeNavItem: "assetPatrol",
        packageName: "cn.eeo.classin",
        lastSyncedPackageName: "cn.eeo.classin"
      })
    ).toBe(false);
    expect(
      shouldAutoSyncAssetPatrolRuntimeParams({
        activeNavItem: "recording",
        packageName: "cn.eeo.classin",
        lastSyncedPackageName: ""
      })
    ).toBe(false);
    expect(
      shouldAutoSyncAssetPatrolRuntimeParams({
        activeNavItem: "assetPatrol",
        packageName: " ",
        lastSyncedPackageName: ""
      })
    ).toBe(false);
  });

  it("restores an asset-driven execution session after refreshing the asset patrol page", () => {
    expect(
      shouldRestoreAssetDrivenExecution({
        activeNavItem: "assetPatrol",
        selectedSerial: "device-1",
        packageName: " cn.eeo.classin ",
        assetDrivenExecutionId: ""
      })
    ).toBe(true);
    expect(
      shouldRestoreAssetDrivenExecution({
        activeNavItem: "assetPatrol",
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        assetDrivenExecutionId: "asset-session-1"
      })
    ).toBe(false);
    expect(
      shouldRestoreAssetDrivenExecution({
        activeNavItem: "recording",
        selectedSerial: "device-1",
        packageName: "cn.eeo.classin",
        assetDrivenExecutionId: ""
      })
    ).toBe(false);
  });

  it("summarizes asset patrol progress from run metadata", () => {
    const summary = assetPatrolRunProgressSummary({
      id: "run-asset-patrol",
      caseName: "资产驱动巡检：com.demo",
      deviceSerial: "device-1",
      status: "failed",
      config: {
        runKind: "asset_patrol",
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 150,
        stopOnFailure: false,
        recordVideo: false,
        keepVideoOnSuccess: false,
        assetPatrol: {
          packageName: "com.demo",
          startMode: "current_state",
          pageScope: "current_page",
          maxDurationMs: 120_000,
          maxTransitions: 8,
          allowRiskyActions: false,
          allowBusinessSubmit: false,
          dangerousTextPatterns: ["删除"],
          runtimeParams: {}
        }
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-asset-patrol",
          iterationIndex: 0,
          stepId: "asset_patrol_step_1",
          stepOrder: 1,
          type: "wait",
          status: "failed",
          startedAt: "2026-07-01T10:00:00.000Z",
          artifacts: [],
          metadata: {
            assetPatrol: {
              kind: "element_relocation",
              label: "元素可重定位：旧坐标区域",
              status: "needs_repair",
              skipReason: "runtime_relocation_required",
              pageModelName: "主页"
            }
          }
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-07-01T10:00:00.000Z"
    });

    expect(summary).toEqual({
      packageName: "com.demo",
      progressText: "1 项",
      latestCheck: "元素可重定位：旧坐标区域",
      latestKind: "element_relocation",
      pageName: "主页",
      failed: 1,
      skipped: 0,
      needsRepair: 1
    });
  });

  it("shows freshly previewed asset patrol plans before completed run feedback", () => {
    expect(assetPatrolPanelDisplayMode({ plan: { status: "ready" } as never, currentRun: { id: "run-1", status: "passed" } as never })).toBe("plan");
    expect(assetPatrolPanelDisplayMode({ plan: { status: "ready" } as never, currentRun: { id: "run-1", status: "running" } as never })).toBe("run");
    expect(assetPatrolPanelDisplayMode({ currentRun: { id: "run-1", status: "passed" } as never })).toBe("run");
    expect(assetPatrolPanelDisplayMode({ plan: { status: "ready" } as never })).toBe("plan");
  });

  it("labels asset-driven execution separately from internal diagnostic notices", () => {
    expect(ASSET_DRIVEN_TEST_ACTION_LABEL).toBe("开始资产测试");
    expect(ASSET_PATROL_DIAGNOSTIC_MODE_NOTICE).toContain("诊断模式");
    expect(ASSET_PATROL_DIAGNOSTIC_MODE_NOTICE).toContain("不会触发页面点击或输入");
    expect(assetDrivenTestStartMessage({ id: "run-2" } as never)).toBe("已启动资产测试：run-2");
    expect(assetDrivenTestStartMessage({ id: "run-2" } as never, { total: 3, remaining: 2 })).toBe(
      "已启动资产测试：run-2，本页面资产边 3 条，剩余 2 条后台巡检"
    );
  });

  it("requires explicit business submit permission before running asset page tasks", () => {
    expect(
      assetPatrolPlanRequiresBusinessSubmit({
        status: "ready",
        issues: [],
        steps: [
          {
            id: "task-check",
            order: 1,
            kind: "task_dry_run",
            label: "任务编排体检：账号密码登录",
            status: "skipped",
            skipReason: "business_submit_disabled"
          }
        ],
        summary: {
          pageChecks: 0,
          elementChecks: 0,
          transitionChecks: 0,
          taskChecks: 1,
          skipped: 1,
          needsRepair: 0
        }
      })
    ).toBe(true);

    expect(
      assetPatrolPlanRequiresBusinessSubmit({
        status: "ready",
        issues: [],
        steps: [
          {
            id: "page-check",
            order: 1,
            kind: "page_match",
            label: "页面匹配：登录",
            status: "ready"
          }
        ],
        summary: {
          pageChecks: 1,
          elementChecks: 0,
          transitionChecks: 0,
          taskChecks: 0,
          skipped: 0,
          needsRepair: 0
        }
      })
    ).toBe(false);
  });

  it("uses different preview workspaces for case recording and asset recording", () => {
    expect(previewWorkspaceKey("recording")).toBe("recording");
    expect(previewWorkspaceKey("assetRecording")).toBe("assetRecording");
    expect(previewWorkspaceKey("caseLibrary")).toBe("inactive");
  });

  it("exposes independent resizable preview width variables for recording and asset recording", () => {
    expect(workspaceStyleForNav("recording", 560, 520)).toEqual({
      "--recording-preview-width": "560px"
    });
    expect(workspaceStyleForNav("assetRecording", 560, 520)).toEqual({
      "--asset-recording-preview-width": "520px"
    });
    expect(workspaceStyleForNav("caseLibrary", 560, 520)).toEqual({});
  });

  it("keeps asset recording device actions immediate and blocks only while identifying", () => {
    expect(actionStrategyForWorkspace("assetRecording", { identifying: false, recording: false })).toEqual({
      useCachedSemanticTarget: true,
      resolveLiveLocatorBeforeAction: false,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: false
    });
    expect(actionStrategyForWorkspace("assetRecording", { identifying: true, recording: false })).toEqual({
      useCachedSemanticTarget: false,
      resolveLiveLocatorBeforeAction: false,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: true
    });
    expect(actionStrategyForWorkspace("recording", { identifying: false, recording: true })).toEqual({
      useCachedSemanticTarget: true,
      resolveLiveLocatorBeforeAction: true,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: false
    });
  });

  it("keeps asset recording recognition blocked until overlapping recognition tasks finish", () => {
    const first = assetRecordingIdentificationStateAfter(0, "begin");
    const second = assetRecordingIdentificationStateAfter(first.inFlightCount, "begin");
    const afterOneFinished = assetRecordingIdentificationStateAfter(second.inFlightCount, "end");
    const afterBothFinished = assetRecordingIdentificationStateAfter(afterOneFinished.inFlightCount, "end");
    const afterExtraEnd = assetRecordingIdentificationStateAfter(afterBothFinished.inFlightCount, "end");

    expect(first).toEqual({ inFlightCount: 1, identifying: true });
    expect(second).toEqual({ inFlightCount: 2, identifying: true });
    expect(afterOneFinished).toEqual({ inFlightCount: 1, identifying: true });
    expect(afterBothFinished).toEqual({ inFlightCount: 0, identifying: false });
    expect(afterExtraEnd).toEqual({ inFlightCount: 0, identifying: false });
  });

  it("uses connection-edge wording for asset recording transition messages", () => {
    expect(assetConnectionEdgeMessage("missing_source")).toBe("当前页面还没有保存为页面资产，请先保存页面后再确认连接边");
    expect(assetConnectionEdgeMessage("confirm_failed")).toBe("连接边确认失败");
    expect(assetConnectionEdgeMessage("confirmed", "主页 -> 班级详情")).toBe("已确认连接边：主页 -> 班级详情");
    expect(assetConnectionEdgeMessage("delete_failed")).toBe("删除连接边失败");
    expect(assetConnectionEdgeMessage("deleted", "主页 -> 班级详情")).toBe("已删除连接边：主页 -> 班级详情");
  });

  it("sends runtime OCR target text when saving page abilities and connection edges", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-class-detail",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:6,47.8,88,8.8",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          outcomeType: "navigate",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        },
        { sourceNodeId: "node-class-detail", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );

    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-class-detail",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          locator: "image-region:6,47.8,88,8.8",
          elementLabel: "创建学习方案",
          targetText: "学习方案",
          targetNodeId: "node-learning-plan",
          targetLabel: "学习方案"
        },
        { sourceNodeId: "node-class-detail", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        elementLabel: "创建学习方案",
        targetText: "学习方案"
      })
    );
  });

  it("turns empty current-page API responses into a readable service error", async () => {
    const message = await currentPageAssetErrorMessage(
      new Response("", {
        status: 500,
        statusText: "Internal Server Error"
      })
    );

    expect(message).toBe("Internal Server Error");
  });

  it("uses the saved page asset name before visual title candidates when mapping current page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "我改过的主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "主页", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.pageName).toBe("我改过的主页");
    expect(page.visualPageName).toBe("主页");
    expect(page.matchedAssetName).toBeUndefined();
  });

  it("deduplicates persisted manual elements and keeps the richer semantic locator asset", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-settings",
              key: "classin.settings",
              name: "设置",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "old-qr",
                    label: "我的二维码",
                    targetText: "我的二维码",
                    locator: "image-region:6,43,88,8",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 6, y: 43, width: 88, height: 8 },
                    targetNodeId: "node-qr",
                    targetLabel: "我的二维码",
                    outcomeType: "navigate"
                  },
                  {
                    id: "new-qr",
                    label: "我的二维码",
                    targetText: "我的二维码",
                    locator: "image-region:3.96,47.36,91.57,6.16",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 3.96, y: 47.36, width: 91.57, height: 6.16 },
                    targetNodeId: "node-qr",
                    targetLabel: "我的二维码",
                    outcomeType: "navigate",
                    quality: { status: "pass", score: 1, warnings: [], candidates: [], evidence: { uniqueCandidate: true, candidateCount: 1 } },
                    visualLocator: { strategy: "recorded_crop_template" }
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-26T10:00:00.000Z",
            resolution: { width: 1080, height: 2340 },
            uiElements: [],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    const qrElements = (page.elements ?? []).filter((element) => element.label === "我的二维码");
    expect(qrElements).toHaveLength(1);
    expect(qrElements[0]).toEqual(
      expect.objectContaining({
        id: "new-qr",
        locator: "image-region:3.96,47.36,91.57,6.16",
        quality: expect.objectContaining({ status: "pass" }),
        visualLocator: expect.objectContaining({ strategy: "recorded_crop_template" })
      })
    );
  });

  it("keeps same-label manual elements when their marked regions do not overlap", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-list",
              key: "classin.list",
              name: "列表页",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "first-detail",
                    label: "详情",
                    locator: "image-region:6,20,88,6",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 6, y: 20, width: 88, height: 6 },
                    targetNodeId: "node-detail",
                    targetLabel: "详情页",
                    outcomeType: "navigate"
                  },
                  {
                    id: "second-detail",
                    label: "详情",
                    locator: "image-region:6,60,88,6",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 6, y: 60, width: 88, height: 6 },
                    targetNodeId: "node-detail",
                    targetLabel: "详情页",
                    outcomeType: "navigate",
                    quality: { status: "pass", score: 1, warnings: [], candidates: [], evidence: { uniqueCandidate: true, candidateCount: 1 } }
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-26T10:00:00.000Z",
            resolution: { width: 1080, height: 2340 },
            uiElements: [],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect((page.elements ?? []).filter((element) => element.label === "详情")).toEqual([
      expect.objectContaining({ id: "first-detail", locator: "image-region:6,20,88,6" }),
      expect.objectContaining({ id: "second-detail", locator: "image-region:6,60,88,6" })
    ]);
  });

  it("preserves structural locator metadata when mapping persisted page abilities", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-settings",
              key: "classin.settings",
              name: "设置",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "profile-entry",
                    label: "个人信息",
                    locator: "image-region:6,15,88.77,8.78",
                    locatorKind: "structural_locator",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 6, y: 15, width: 88.77, height: 8.78 },
                    targetNodeId: "node-profile",
                    targetLabel: "个人信息",
                    outcomeType: "navigate",
                    structuralLocator: {
                      kind: "marked_row",
                      role: "list_item",
                      stableAnchors: [{ kind: "row_bounds", region: { x: 6, y: 15, width: 88.77, height: 8.78 } }]
                    },
                    dynamicMasks: [
                      { kind: "avatar", label: "头像", region: { x: 7.78, y: 15.88, width: 14.2, height: 7.02 }, reason: "personalized_visual" },
                      { kind: "text", label: "动态昵称", region: { x: 23.75, y: 15.88, width: 44.39, height: 7.02 }, reason: "personalized_text" }
                    ],
                    quality: {
                      status: "pass",
                      score: 0.87,
                      warnings: [],
                      candidates: [],
                      evidence: { locatorKind: "structural_locator", dynamicMaskCount: 2 }
                    }
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-26T10:00:00.000Z",
            resolution: { width: 1080, height: 2340 },
            uiElements: [],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements?.[0]).toEqual(
      expect.objectContaining({
        id: "profile-entry",
        locatorKind: "structural_locator",
        structuralLocator: expect.objectContaining({ kind: "marked_row" }),
        dynamicMasks: [
          expect.objectContaining({ kind: "avatar", reason: "personalized_visual" }),
          expect.objectContaining({ kind: "text", reason: "personalized_text" })
        ],
        quality: expect.objectContaining({
          evidence: expect.objectContaining({ dynamicMaskCount: 2 })
        })
      })
    );
  });

  it("preserves screenshot focus ignore regions when mapping page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: {
                assetRecordingConfirmed: true,
                screenshotRegions: [
                  {
                    id: "region-main",
                    label: "主页稳定区域",
                    x: 8,
                    y: 12,
                    width: 84,
                    height: 58,
                    ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "主页", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.screenshotRegions).toEqual([
      {
        id: "region-main",
        label: "主页稳定区域",
        x: 8,
        y: 12,
        width: 84,
        height: 58,
        ignoreRegions: [{ x: 0, y: 0, width: 100, height: 8 }]
      }
    ]);
  });

  it("uses the observation screenshot frame for asset recording region editing", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.3,
            candidates: []
          },
          observation: {
            id: "obs-1",
            deviceSerial: "device-1",
            platform: "android",
            capturedAt: "2026-06-17T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [],
            ocrTexts: [],
            raw: {
              screenshotBase64: "frame-from-current-page-observation"
            }
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.screenshotUrl).toBe("data:image/png;base64,frame-from-current-page-observation");
  });

  it("maps OCR text candidates with their relative screen region", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.3,
            candidates: []
          },
          observation: {
            id: "obs-todo",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [],
            ocrTexts: [
              {
                text: "待办",
                confidence: 0.96,
                region: { x: 164, y: 173, width: 198, height: 138 },
                source: "ocr"
              }
            ]
          },
          visualPageName: "待办"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.ocrTexts).toEqual(["ocr_text:待办@region(15.19,7.39,18.33,5.9)"]);
  });

  it("keeps popup menus as page-local transition context instead of page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.38,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, pageName: "主页" }
                },
                score: 0.82,
                matcherResults: [
                  { type: "text", expected: "主页", actual: "主页", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-menu",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "主页", visible: true, enabled: true, bounds: { x: 220, y: 250, width: 140, height: 48 } },
              { text: "添加好友", visible: true, enabled: true, bounds: { x: 690, y: 520, width: 160, height: 48 } },
              { text: "加入班级", visible: true, enabled: true, bounds: { x: 690, y: 610, width: 160, height: 48 } },
              { text: "加入公开课", visible: true, enabled: true, bounds: { x: 690, y: 700, width: 180, height: 48 } },
              { text: "扫一扫", visible: true, enabled: true, bounds: { x: 690, y: 790, width: 130, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "添加好友"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("添加好友");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps a high-scoring draft candidate unsaved when backend did not accept the page match", () => {
    const response = {
      result: {
        status: "draft_candidate" as const,
        match: {
          status: "unknown",
          score: 0.58,
          candidates: [
            {
              node: {
                id: "node-create-public-course",
                key: "classin.course.public.create",
                name: "新建公开课",
                nodeType: "page",
                tags: ["page-asset", "asset-recording"],
                metadata: {
                  assetRecordingConfirmed: true,
                  assetKind: "page",
                  pageName: "新建公开课"
                }
              },
              score: 0.82,
              matcherResults: [
                { type: "text", expected: "新建公开课", actual: "新建公开课", matched: true }
              ]
            }
          ]
        },
        node: {
          id: "runtime-unknown-create-public-course",
          key: "runtime.unknown.create_public_course",
          name: "运行期未知节点：新建公开课",
          metadata: {}
        },
        observation: {
          id: "obs-create-public-course",
          platform: "android" as const,
          capturedAt: "2026-06-18T10:00:00.000Z",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          resolution: { width: 1080, height: 2340 },
          uiElements: [
            { text: "新建公开课", visible: true, enabled: true, bounds: { x: 160, y: 140, width: 220, height: 52 } },
            { text: "封面", visible: true, enabled: true, bounds: { x: 90, y: 480, width: 120, height: 48 } },
            { text: "开始时间", visible: true, enabled: true, bounds: { x: 90, y: 680, width: 160, height: 48 } },
            { text: "课堂时长", visible: true, enabled: true, bounds: { x: 90, y: 850, width: 160, height: 48 } },
            { text: "课堂信息", visible: true, enabled: true, bounds: { x: 90, y: 1030, width: 180, height: 48 } },
            { text: "发布", visible: true, enabled: true, bounds: { x: 450, y: 2190, width: 160, height: 56 } }
          ],
          ocrTexts: []
        },
        visualPageName: "新建公开课"
      },
      assets: { pageAssets: [] }
    };

    const page = mapCurrentPageAssetResponse(response, "version-1");

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("新建公开课");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
    expect(pageAssetMessage(response, page)).toBe("已识别待保存页面：新建公开课");
  });

  it("maps PageMatcher diagnostics before legacy candidate matcher results", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          matcherDiagnostics: {
            status: "unknown",
            topCandidate: {
              nodeId: "node-home",
              key: "classin.home",
              name: "主页",
              score: 0.42
            },
            matchedEvidence: [{ type: "package", expected: "cn.eeo.classin", matched: true }],
            missingEvidence: [
              { type: "text", expected: "主页", matched: false },
              { type: "ocr_text", expected: "我是教师", matched: false }
            ]
          },
          match: {
            status: "unknown",
            score: 0.42,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页"
                },
                score: 0.82,
                matcherResults: [{ type: "text", expected: "错误旧候选", actual: "错误旧候选", matched: true }]
              }
            ]
          },
          node: {
            id: "runtime-unknown-home",
            key: "runtime.unknown.home",
            name: "主页",
            metadata: {}
          },
          observation: {
            id: "obs-home",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [{ text: "消息", visible: true, enabled: true }],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.matchedMatchers).toEqual(["package:cn.eeo.classin"]);
    expect(page.missedMatchers).toEqual(["text:主页", "ocr_text:我是教师"]);
    expect(page.matchedMatchers).not.toContain("text:错误旧候选");
  });

  it("maps screenshot pollution blocks as non-saveable asset recording errors", () => {
    const response = {
      result: {
        status: "blocked" as const,
        blocker: {
          code: "SCREENSHOT_POLLUTION",
          message: "当前截图疑似被调试浮层遮挡，无法确认页面资产。",
          pollutionTexts: [{ text: "MEM: 369.6 MB" }],
          affectedMatchers: [{ nodeName: "主页", matcherId: "matcher-home-title", type: "ocr_text", expected: "主页" }]
        },
        matcherDiagnostics: {
          status: "unknown",
          matchedEvidence: [],
          missingEvidence: [{ type: "ocr_text", expected: "主页", matched: false }]
        },
        match: {
          status: "unknown",
          score: 0,
          candidates: []
        },
        observation: {
          id: "obs-home-polluted",
          platform: "android" as const,
          capturedAt: "2026-07-01T10:00:00.000Z",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          resolution: { width: 1080, height: 2340 },
          uiElements: [],
          ocrTexts: [{ text: "MEM: 369.6 MB", region: { x: 320, y: 150, width: 360, height: 52 }, source: "ocr" as const }]
        },
        visualPageName: "主页"
      },
      assets: { pageAssets: [] }
    };

    const page = mapCurrentPageAssetResponse(response, "version-1");

    expect(page.status).toBe("error");
    expect(page.nodeId).toBeUndefined();
    expect(page.message).toContain("调试浮层遮挡");
    expect(pageAssetMessage(response, page)).toBe("当前截图疑似被调试浮层遮挡，无法确认页面资产。");
  });

  it("keeps bottom sheets as page-local transition context instead of page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.44,
            candidates: [
              {
                node: {
                  id: "node-create-public-course",
                  key: "classin.course.public.create",
                  name: "新建公开课",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, assetKind: "page", pageName: "新建公开课" }
                },
                score: 0.78,
                matcherResults: [
                  { type: "text", expected: "新建公开课", actual: "新建公开课", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-choose-org",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "新建公开课", visible: true, enabled: true, bounds: { x: 160, y: 140, width: 220, height: 52 } },
              { text: "课堂信息", visible: true, enabled: true, bounds: { x: 90, y: 1030, width: 180, height: 48 } },
              { text: "选择组织", visible: true, enabled: true, bounds: { x: 90, y: 1220, width: 180, height: 56 } },
              { text: "EEO-TEST-霍昌峰", visible: true, enabled: true, bounds: { x: 300, y: 1540, width: 480, height: 56 } },
              { text: "取消", visible: true, enabled: true, bounds: { x: 820, y: 2220, width: 90, height: 48 } },
              { text: "确定", visible: true, enabled: true, bounds: { x: 950, y: 2220, width: 90, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "选择组织"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("选择组织");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps dynamic home banners as the parent page instead of creating an overlay", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.5,
            candidates: [
              {
                node: {
                  id: "node-home",
                  key: "classin.home",
                  name: "主页",
                  nodeType: "page",
                  tags: ["page-asset", "asset-recording"],
                  metadata: { assetRecordingConfirmed: true, assetKind: "page", pageName: "主页" }
                },
                score: 0.8,
                matcherResults: [
                  { type: "text", expected: "主页", actual: "主页", matched: true },
                  { type: "text", expected: "我是教师", actual: "我是教师", matched: true }
                ]
              }
            ]
          },
          observation: {
            id: "obs-home-with-active-class",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2340 },
            uiElements: [
              { text: "主页", visible: true, enabled: true, bounds: { x: 450, y: 160, width: 180, height: 54 } },
              { text: "我是教师", visible: true, enabled: true, bounds: { x: 80, y: 360, width: 180, height: 52 } },
              { text: "班级四十一号", visible: true, enabled: true, bounds: { x: 120, y: 1560, width: 360, height: 54 } },
              { text: "进入课堂", visible: true, enabled: true, bounds: { x: 760, y: 1560, width: 180, height: 54 } },
              { text: "消息", visible: true, enabled: true, bounds: { x: 260, y: 2200, width: 100, height: 48 } },
              { text: "我的", visible: true, enabled: true, bounds: { x: 820, y: 2200, width: 100, height: 48 } }
            ],
            ocrTexts: []
          },
          visualPageName: "主页"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("主页");
    expect(page.assetKind).toBe("page");
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("keeps an unknown draft as a page when the nearest candidate is not a confirmed page asset", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0.2,
            candidates: [
              {
                node: {
                  id: "node-runtime",
                  key: "runtime.unknown.1",
                  name: "未知页面",
                  metadata: {}
                },
                score: 0.86,
                matcherResults: []
              }
            ]
          },
          observation: {
            id: "obs-new-page",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "新页面标题", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "新页面标题"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
  });

  it("removes internal runtime unknown prefixes from draft page names", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "draft_candidate",
          match: {
            status: "unknown",
            score: 0,
            candidates: []
          },
          node: {
            id: "runtime-message",
            key: "runtime.unknown.message",
            name: "运行期未知节点：消息",
            metadata: {}
          },
          observation: {
            id: "obs-message",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [{ text: "消息", visible: true, enabled: true }],
            ocrTexts: []
          },
          visualPageName: "消息"
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.pageName).toBe("消息");
    expect(page.matchedAssetName).toBeUndefined();
    expect(pageAssetMessage({ result: { status: "draft_candidate", match: { status: "unknown", score: 0, candidates: [] } } }, page)).toBe("已识别待保存页面：消息");
  });

  it("keeps page ability type and candidate layout in the page element request", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-home",
          abilityType: "grid_candidate",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:3,32,91,56",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "打开班级详情",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "nth_item",
            afterFoundAction: "tap_item",
            candidateItemHeightPercent: 24.5,
            clickSafePoint: { xPercent: 50, yPercent: 28 },
            scrollStepPercent: 65,
            failureStrategy: "try_next_candidate"
          }
        },
        { sourceNodeId: "node-home", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        semanticArea: "content",
        coordinateSpace: "screen",
        scrollProfile: expect.objectContaining({
          containerKind: "grid_list",
          candidateItemHeightPercent: 24.5,
          clickSafePoint: { xPercent: 50, yPercent: 28 },
          failureStrategy: "try_next_candidate"
        })
      })
    );
  });

  it("includes dynamic region and parameterized transition metadata in page element requests", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-home",
          abilityType: "grid_candidate",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:3,32,91,56",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "打开班级详情",
          outcomeType: "navigate",
          targetNodeId: "node-class-detail",
          targetLabel: "班级详情",
          locatorKind: "collection_item_locator",
          transitionKind: "parameterized",
          parameterMapping: { className: "dynamicRegion.item.titleText" },
          dynamicRegion: {
            id: "dynamic_region_node_home_classes",
            label: "班级列表",
            kind: "grid",
            region: { x: 3, y: 32, width: 91, height: 56 },
            itemTemplateId: "item_template_node_home_class_card"
          },
          itemTemplate: {
            id: "item_template_node_home_class_card",
            label: "班级卡片",
            region: { x: 3, y: 32, width: 45.5, height: 18.67 },
            actionArea: { x: 3, y: 32, width: 45.5, height: 18.67 }
          }
        },
        { sourceNodeId: "node-home", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        locatorKind: "collection_item_locator",
        transitionKind: "parameterized",
        parameterMapping: { className: "dynamicRegion.item.titleText" },
        dynamicRegion: expect.objectContaining({
          id: "dynamic_region_node_home_classes",
          itemTemplateId: "item_template_node_home_class_card"
        }),
        itemTemplate: expect.objectContaining({
          id: "item_template_node_home_class_card"
        })
      })
    );
  });

  it("keeps page task drafts in a stable asset request body", () => {
    expect(
      assetPageTaskRequestBody(
        {
          sourceNodeId: "node-create-lesson",
          taskId: "task-create-lesson",
          name: "创建课堂",
          status: "active",
          steps: [
            {
              id: "step-title",
              order: 1,
              elementId: "manual-title",
              fieldType: "text_input",
              label: "课堂标题",
              valueParamKey: "lessonName"
            },
            {
              order: 2,
              elementId: "manual-submit",
              fieldType: "submit",
              label: "发布"
            }
          ]
        },
        { sourceNodeId: "node-create-lesson" }
      )
    ).toEqual({
      sourceNodeId: "node-create-lesson",
      taskId: "task-create-lesson",
      name: "创建课堂",
      status: "active",
      steps: [
        {
          id: "step-title",
          order: 1,
          elementId: "manual-title",
          fieldType: "text_input",
          label: "课堂标题",
          valueParamKey: "lessonName"
        },
        {
          order: 2,
          elementId: "manual-submit",
          fieldType: "submit",
          label: "发布"
        }
      ]
    });
  });

  it("maps observation UI elements into page operation candidate categories", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-actions",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              {
                text: "发布活动",
                resourceId: "cn.eeo.classin:id/publish_activity",
                visible: true,
                enabled: true,
                clickable: true,
                bounds: { x: 810, y: 1890, width: 180, height: 120 }
              },
              {
                resourceId: "cn.eeo.classin:id/class_list",
                className: "androidx.recyclerview.widget.RecyclerView",
                visible: true,
                enabled: true,
                scrollable: true
              },
              {
                text: "更多班级",
                visible: true,
                enabled: true,
                clickable: false
              }
            ],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        label: "发布活动",
        locator: "resource-id: cn.eeo.classin:id/publish_activity",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        region: { x: 75, y: 87.5, width: 16.67, height: 5.56 },
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 }
      },
      {
        label: "cn.eeo.classin:id/class_list",
        locator: "resource-id: cn.eeo.classin:id/class_list",
        action: "scroll",
        actionKind: "scroll",
        availability: "visible",
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 },
        scrollProfile: {
          containerKind: "grid_list",
          direction: "vertical",
          columns: 2,
          targetKind: "item_text",
          afterFoundAction: "tap_item"
        }
      },
      {
        label: "更多班级",
        locator: "text: 更多班级",
        action: "tap",
        actionKind: "tap",
        availability: "conditional",
        previewCrop: { x: 0, y: 4, width: 100, height: 96 },
        viewport: { width: 1080, height: 2160 }
      }
    ]);
  });

  it("infers a scrollable grid region from repeated card-like elements even without native scrollable flag", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-inferred-scroll",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              { text: "班级四十一号!", visible: true, enabled: true, clickable: false, bounds: { x: 95, y: 1014, width: 386, height: 58 } },
              { text: "班级四十二号", visible: true, enabled: true, clickable: false, bounds: { x: 565, y: 1014, width: 386, height: 58 } },
              { text: "开放加入2", visible: true, enabled: true, clickable: false, bounds: { x: 95, y: 1420, width: 386, height: 58 } }
            ],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "推断滚动区域：班级列表",
          locator: "inferred-scroll-region: class-card-grid",
          action: "scroll",
          actionKind: "scroll",
          availability: "visible",
          region: { x: 8.8, y: 46.94, width: 79.26, height: 21.48 },
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            afterFoundAction: "tap_item"
          }
        })
      ])
    );
  });

  it("does not expose class-only clickable views as stable operation candidates", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.9,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: { assetRecordingConfirmed: true }
            },
            candidates: []
          },
          observation: {
            id: "obs-class-only",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [
              {
                className: "android.view.View",
                visible: true,
                enabled: true,
                clickable: true
              },
              {
                text: "创建公开课",
                className: "android.widget.TextView",
                visible: true,
                enabled: true,
                clickable: true
              }
            ],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        label: "创建公开课",
        locator: "text: 创建公开课",
        action: "tap",
        actionKind: "tap",
        availability: "visible"
      }
    ]);
  });

  it("maps persisted manual page elements back into operation candidates", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-home",
              key: "classin.home",
              name: "主页",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "manual_element_search",
                    label: "搜索按钮",
                    locator: "image-region:12.5,8.25,20,6",
                    semanticArea: "top",
                    coordinateSpace: "screen",
                    action: "tap",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 12.5, y: 8.25, width: 20, height: 6 },
                    targetNodeId: "node-search",
                    targetLabel: "搜索页",
                    outcomeType: "navigate",
                    platformScope: "android"
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-home",
            platform: "android",
            capturedAt: "2026-06-18T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            uiElements: [],
            ocrTexts: [],
            resolution: { width: 1080, height: 2160 }
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.elements).toEqual([
      {
        id: "manual_element_search",
        label: "搜索按钮",
        locator: "image-region:12.5,8.25,20,6",
        semanticArea: "top",
        coordinateSpace: "screen",
        action: "tap",
        actionKind: "tap",
        availability: "visible",
        source: "manual",
        region: { x: 12.5, y: 8.25, width: 20, height: 6 },
        viewport: { width: 1080, height: 2160 },
        outcomeType: "navigate",
        outcomeLabel: "搜索页",
        targetNodeId: "node-search",
        targetLabel: "搜索页"
      }
    ]);
  });

  it("maps persisted page tasks from page metadata into current page assets", () => {
    const page = mapCurrentPageAssetResponse(
      {
        result: {
          status: "matched",
          match: {
            status: "matched",
            score: 0.92,
            node: {
              id: "node-create-lesson",
              key: "classin.lesson.create",
              name: "新建课堂",
              metadata: {
                assetRecordingConfirmed: true,
                assetRecordingManualElements: [
                  {
                    id: "manual-title",
                    label: "课堂标题输入框",
                    locator: "image-region:8,24,84,8",
                    actionKind: "input",
                    availability: "visible",
                    region: { x: 8, y: 24, width: 84, height: 8 }
                  },
                  {
                    id: "manual-submit",
                    label: "发布按钮",
                    locator: "image-region:78,91,16,6",
                    actionKind: "tap",
                    availability: "visible",
                    region: { x: 78, y: 91, width: 16, height: 6 }
                  }
                ],
                assetRecordingPageTasks: [
                  {
                    id: "task-create-lesson",
                    name: "创建课堂",
                    status: "active",
                    steps: [
                      {
                        id: "step-title",
                        order: 2,
                        elementId: "manual-title",
                        fieldType: "text_input",
                        label: "课堂标题",
                        valueParamKey: "lessonName"
                      },
                      {
                        id: "step-submit",
                        order: 3,
                        elementId: "manual-submit",
                        fieldType: "submit",
                        label: "发布"
                      },
                      {
                        id: "step-wait",
                        order: 1,
                        fieldType: "wait",
                        label: "等待表单就绪",
                        text: "新建课堂"
                      }
                    ]
                  }
                ]
              }
            },
            candidates: []
          },
          observation: {
            id: "obs-create-lesson",
            platform: "android",
            capturedAt: "2026-06-23T10:00:00.000Z",
            packageName: "cn.eeo.classin",
            activityName: ".MainActivity",
            resolution: { width: 1080, height: 2160 },
            uiElements: [],
            ocrTexts: []
          }
        },
        assets: { pageAssets: [] }
      },
      "version-1"
    );

    expect(page.tasks).toEqual([
      {
        id: "task-create-lesson",
        name: "创建课堂",
        status: "active",
        steps: [
          {
            id: "step-wait",
            order: 1,
            fieldType: "wait",
            label: "等待表单就绪",
            text: "新建课堂"
          },
          {
            id: "step-title",
            order: 2,
            elementId: "manual-title",
            fieldType: "text_input",
            label: "课堂标题",
            valueParamKey: "lessonName"
          },
          {
            id: "step-submit",
            order: 3,
            elementId: "manual-submit",
            fieldType: "submit",
            label: "发布"
          }
        ]
      }
    ]);
  });

  it("includes outcome drafts when building manual page element requests", () => {
    expect(
      assetPageElementRequestBody(
        {
          elementId: "manual_element_plus",
          sourceNodeId: "node-home",
          actionKind: "tap",
          availability: "visible",
          locator: "image-region:12.5,8.25,20,6",
          semanticArea: "top",
          coordinateSpace: "screen",
          elementLabel: "右上加号",
          outcomeType: "compound_navigation",
          targetNodeId: "node-add-friend",
          targetLabel: "添加好友页",
          tapPointPercent: { x: 20, y: 70 },
          outcomeLabel: "弹出更多菜单后可继续点添加好友",
          compoundSteps: [
            { type: "wait_until_state", text: "添加好友", label: "等待更多菜单出现", timeoutMs: 1200 },
            { type: "tap_on_text", text: "添加好友", label: "点击添加好友" }
          ]
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      elementId: "manual_element_plus",
      sourceNodeId: "node-home",
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "右上加号",
      availability: "visible",
      platformScope: "android",
      outcomeType: "compound_navigation",
      targetNodeId: "node-add-friend",
      targetLabel: "添加好友页",
      tapPointPercent: { x: 20, y: 70 },
      outcomeLabel: "弹出更多菜单后可继续点添加好友",
      compoundSteps: [
        { type: "wait_until_state", text: "添加好友", label: "等待更多菜单出现", timeoutMs: 1200 },
        { type: "tap_on_text", text: "添加好友", label: "点击添加好友" }
      ]
    });
  });

  it("builds manual page element drafts with a separate tap point", () => {
    expect(
      manualOperationDraftFromForm(
        {
          actionKind: "input",
          availability: "visible",
          semanticArea: "content",
          elementLabel: "密码输入框",
          outcomeType: "no_visible_change",
          tapPointXPercent: "20",
          tapPointYPercent: "70"
        },
        {
          sourceNodeId: "node-login",
          region: { x: 6, y: 31, width: 88, height: 6, semanticArea: "content" }
        }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-login",
        actionKind: "input",
        locator: "image-region:6,31,88,6",
        elementLabel: "密码输入框",
        tapPointPercent: { x: 20, y: 70 }
      })
    );
  });

  it("requires a target page for navigable page ability requests", () => {
    expect(
      validateAssetPageElementDraftForSave({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        actionKind: "tap",
        availability: "visible",
        locator: "image-region:3,30,94,59",
        elementLabel: "班级列表",
        outcomeType: "navigate",
        targetLabel: "班级详情"
      })
    ).toBe("跳转页面类型必须选择已保存的目标页面；如果只是普通点击，请把结果类型改为本页状态变化或无可见变化");

    expect(
      validateAssetPageElementDraftForSave({
        sourceNodeId: "node-home",
        abilityType: "grid_candidate",
        actionKind: "tap",
        availability: "visible",
        locator: "image-region:3,30,94,59",
        elementLabel: "班级列表",
        outcomeType: "navigate",
        targetNodeId: "node-class-detail",
        targetLabel: "班级详情"
      })
    ).toBeUndefined();
  });

  it("requires a stable manual image region before saving a page ability", () => {
    expect(
      validateAssetPageElementDraftForSave({
        sourceNodeId: "node-home",
        actionKind: "tap",
        availability: "visible",
        locator: "image-region:49,50,1.2,0.8",
        elementLabel: "更多",
        outcomeType: "no_visible_change"
      })
    ).toBe("圈选区域过小，请重新圈选完整的可识别元素区域");
  });

  it("includes page element quality evidence in the save request body", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-login",
          actionKind: "input",
          availability: "visible",
          locator: "image-region:6,31,88,6",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "密码输入框",
          targetText: "请输入密码",
          outcomeType: "no_visible_change",
          quality: {
            status: "pass",
            score: 0.88,
            warnings: [],
            candidates: [],
            evidence: {
              targetText: "请输入密码",
              semanticArea: "content",
              uniqueCandidate: true,
              candidateCount: 1
            }
          },
          visualLocator: {
            version: 1,
            strategy: "recorded_crop_template",
            template: {
              hash: "crop-hash"
            }
          }
        },
        {
          sourceNodeId: "node-login",
          platformScope: "android"
        }
      )
    ).toEqual(
      expect.objectContaining({
        quality: expect.objectContaining({
          status: "pass",
          score: 0.88
        }),
        visualLocator: expect.objectContaining({
          strategy: "recorded_crop_template",
          template: expect.objectContaining({
            hash: "crop-hash"
          })
        })
      })
    );
  });

  it("maps legacy overlay assets as page-local context instead of surfacing overlay controls", () => {
    const response = {
      result: {
        status: "draft_candidate" as const,
        match: {
          status: "unknown",
          score: 0.52,
          candidates: [
            {
              node: {
                id: "node-home-more",
                key: "classin.home.more",
                name: "主页-更多操作",
                nodeType: "business_state",
                tags: ["page-overlay", "page-state", "asset-recording"],
                metadata: {
                  assetRecordingConfirmed: true,
                  assetKind: "overlay",
                  pageName: "主页-更多操作",
                  parentPageId: "node-home",
                  parentPageName: "主页",
                  overlayType: "popup_menu",
                  closeAction: "back"
                }
              },
              score: 0.82,
              matcherResults: [
                { type: "text", expected: "添加好友", actual: "添加好友", matched: true }
              ]
            }
          ]
        },
        node: {
          id: "runtime-unknown-add-friend",
          key: "runtime.unknown.add_friend",
          name: "运行期未知节点：添加好友",
          metadata: {}
        },
        observation: {
          id: "obs-menu",
          platform: "android" as const,
          capturedAt: "2026-06-18T10:00:00.000Z",
          packageName: "cn.eeo.classin",
          activityName: ".MainActivity",
          uiElements: [
            { text: "添加好友", visible: true, enabled: true },
            { text: "加入班级", visible: true, enabled: true },
            { text: "加入公开课", visible: true, enabled: true },
            { text: "扫一扫", visible: true, enabled: true }
          ],
          ocrTexts: []
        },
        visualPageName: "添加好友"
      },
      assets: {
        pageAssets: [
          {
            id: "node-home-more",
            key: "classin.home.more",
            name: "主页-更多操作",
            status: "active",
            platformScope: "android",
            matcherCount: 4,
            elementCount: 0,
            updatedAt: "2026-06-18T10:00:00.000Z"
          }
        ]
      }
    };

    const page = mapCurrentPageAssetResponse(response, "version-1");

    expect(page.status).toBe("draft_candidate");
    expect(page.nodeId).toBeUndefined();
    expect(page.pageName).toBe("添加好友");
    expect(page.targetRef).toBe("runtime.unknown.add_friend");
    expect(page.assetKind).toBe("page");
    expect(page.parentPageId).toBeUndefined();
    expect(page.parentPageName).toBeUndefined();
    expect(page.overlayType).toBeUndefined();
    expect(page.overlayBehavior).toBeUndefined();
    expect(page.closeAction).toBeUndefined();
    expect(page.savedAssets?.some((asset) => asset.id === "node-home-more")).toBe(true);
    expect(pageAssetMessage(response, page)).toBe("已识别待保存页面：添加好友");
  });

  it("includes scroll container profile when building manual operation transition requests", () => {
    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-home",
          targetNodeId: "node-class-detail",
          abilityType: "grid_candidate",
          actionKind: "scroll",
          availability: "visible",
          outcomeType: "navigate",
          locator: "resource-id: cn.eeo.classin:id/class_list",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "班级列表",
          targetLabel: "班级详情",
          scrollProfile: {
            containerKind: "grid_list",
            direction: "vertical",
            columns: 2,
            targetKind: "item_text",
            targetQuery: "班级四十一号",
            afterFoundAction: "tap_item"
          }
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      sourceNodeId: "node-home",
      targetNodeId: "node-class-detail",
      abilityType: "grid_candidate",
      actionKind: "scroll",
      locator: "resource-id: cn.eeo.classin:id/class_list",
      semanticArea: "content",
      coordinateSpace: "screen",
      elementLabel: "班级列表",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "班级详情",
      platformScope: "android",
      scrollProfile: {
        containerKind: "grid_list",
        direction: "vertical",
        columns: 2,
        targetKind: "item_text",
        targetQuery: "班级四十一号",
        afterFoundAction: "tap_item"
      }
    });
  });

  it("keeps scrollable image targets in page ability requests", () => {
    expect(
      assetPageElementRequestBody(
        {
          sourceNodeId: "node-list",
          abilityType: "scroll_candidate",
          actionKind: "scroll",
          availability: "after_scroll",
          locator: "image-region:72,38,6,5",
          semanticArea: "content",
          coordinateSpace: "screen",
          elementLabel: "删除图标",
          outcomeType: "show_inline_state",
          outcomeLabel: "找到删除图标后显示确认弹窗",
          scrollProfile: {
            containerKind: "list",
            direction: "vertical",
            targetKind: "image_region",
            targetQuery: "image-region:72,38,6,5",
            afterFoundAction: "tap_child",
            scrollStepPercent: 62,
            failureStrategy: "try_next_candidate"
          }
        },
        { sourceNodeId: "node-list", platformScope: "android" }
      )
    ).toEqual(
      expect.objectContaining({
        sourceNodeId: "node-list",
        abilityType: "scroll_candidate",
        actionKind: "scroll",
        locator: "image-region:72,38,6,5",
        semanticArea: "content",
        coordinateSpace: "screen",
        scrollProfile: expect.objectContaining({
          targetKind: "image_region",
          targetQuery: "image-region:72,38,6,5",
          afterFoundAction: "tap_child"
        })
      })
    );
  });

  it("includes screenshot marked image-region locators when building manual operation transition requests", () => {
    expect(
      assetOperationTransitionRequestBody(
        {
          sourceNodeId: "node-home",
          targetNodeId: "node-search",
          actionKind: "tap",
          availability: "visible",
          outcomeType: "navigate",
          locator: "image-region:12.5,8.25,20,6",
          elementLabel: "搜索按钮",
          targetLabel: "搜索页"
        },
        {
          sourceNodeId: "node-home",
          platformScope: "android"
        }
      )
    ).toEqual({
      sourceNodeId: "node-home",
      targetNodeId: "node-search",
      actionKind: "tap",
      locator: "image-region:12.5,8.25,20,6",
      elementLabel: "搜索按钮",
      availability: "visible",
      outcomeType: "navigate",
      targetLabel: "搜索页",
      platformScope: "android"
    });
  });
});
