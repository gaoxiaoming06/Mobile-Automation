import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScriptFlow, TestRun } from "@mobile-automation/shared";
import {
  AiScriptFlowsPanel,
  buildAiGenerateRequestBody,
  buildStepRunRequestBody,
  draftRunOptions,
  draftRunEndpoint,
  draftSaveDestination,
  ExecutionFailureNotice,
  ScriptItemPicker,
  reusableFlowCandidates,
  StepTrialRunBar,
  stepTrialStatusForStep,
  stepReviewItems,
  TrialOutcomeReview,
  updateDraftStepLocator
} from "./AiScriptFlowsPanel.js";

describe("AiScriptFlowsPanel", () => {
  it("keeps only stable compatible non-recursive cases as reusable candidates", () => {
    const flows = [
      reusableFlow("flow-current", "当前用例", [{ id: "current", tap: { target: { text: "当前" } } }]),
      reusableFlow("flow-login", "教师登录", [
        { id: "restart", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
        { id: "login", role: "business", tap: { target: { text: "登录" } } },
        { id: "reset", role: "reset", tap: { target: { text: "退出" } } }
      ]),
      { ...reusableFlow("flow-draft", "草稿", [{ id: "draft", tap: { target: { text: "草稿" } } }]), status: "draft" as const },
      reusableFlow("flow-empty", "只有生命周期", [
        { id: "restart", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
        { id: "reset", role: "reset", tap: { target: { text: "主页" } } }
      ]),
      reusableFlow("flow-cycle", "循环引用", [{ id: "back", runFlow: "flow-current" }]),
      { ...reusableFlow("flow-ios", "iOS 用例", [{ id: "ios", tap: { target: { text: "登录" } } }]), platform: "ios" as const,
        parsed: { ...reusableFlow("flow-ios", "iOS 用例", []).parsed, app: { id: "cn.eeo.classin", platform: "ios" } } }
    ];

    expect(reusableFlowCandidates(flows, {
      app: { id: "cn.eeo.classin", platform: "android" },
      currentFlowId: "flow-current"
    }).map((flow) => flow.id)).toEqual(["flow-login"]);
  });

  it("renders one script item picker with all sections and content types", () => {
    const markup = renderToStaticMarkup(<ScriptItemPicker
      flows={[reusableFlow("flow-login", "教师登录", [
        { id: "restart", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
        { id: "login", role: "business", tap: { target: { text: "登录" } } },
        { id: "verify", role: "assertion", assertText: { text: "首页" } }
      ], { account: { type: "string", required: true } })]}
      query=""
      loading={false}
      mode="flow"
      placement="reset"
      action="tap"
      onModeChange={vi.fn()}
      onQueryChange={vi.fn()}
      onPlacementChange={vi.fn()}
      onActionChange={vi.fn()}
      onAddAction={vi.fn()}
      onSelectFlow={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("添加脚本内容");
    expect(markup).toContain("添加位置");
    expect(markup).toContain("内容来源");
    expect(markup).toContain('aria-label="添加位置"');
    expect(markup).toContain('<option value="setup">前置准备</option>');
    expect(markup).toContain('<option value="business">业务步骤</option>');
    expect(markup).toContain('<option value="assertion">结果验证</option>');
    expect(markup).toContain('<option value="reset" selected="">每轮复位</option>');
    expect(markup).toContain("新建操作");
    expect(markup).toContain("引用已有用例");
    expect(markup).not.toContain('aria-label="选择添加位置"');
    expect(markup).not.toContain("业务前执行");
    expect(markup).not.toContain("核心测试操作");
    expect(markup).not.toContain("检查执行结果");
    expect(markup).not.toContain("循环后恢复");
    expect(markup).toContain("教师登录");
    expect(markup).toContain("核心步骤 2");
    expect(markup).toContain("参数 1");
    expect(markup).toContain("不继承子用例自身的前置准备和每轮复位");
    expect(markup).toContain("作为每轮复位引用教师登录");
  });

  it("renders operation choices and one confirm action in the unified picker", () => {
    const markup = renderToStaticMarkup(<ScriptItemPicker
      flows={[]}
      query=""
      loading={false}
      mode="action"
      placement="business"
      action="tap"
      onModeChange={vi.fn()}
      onQueryChange={vi.fn()}
      onPlacementChange={vi.fn()}
      onActionChange={vi.fn()}
      onAddAction={vi.fn()}
      onSelectFlow={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(markup).toContain("点击目标");
    expect(markup).toContain("输入文本");
    expect(markup).toContain("将“点击目标”添加到“业务步骤”");
    expect(markup).toContain("添加到业务步骤");
  });

  it("treats a runFlow reference as an operable orchestrator step", () => {
    const [step] = stepReviewItems({
      version: 1,
      kind: "scenario",
      purpose: "business",
      testLevel: "business_smoke",
      name: "组合场景",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {},
      steps: [{ id: "reuse-login", role: "business", runFlow: "flow-login" }],
      tags: []
    });

    expect(step).toMatchObject({ action: "runFlow", structural: false, phase: "business" });
  });

  it("uses separate execution endpoints for verified and trial-ready drafts", () => {
    expect(draftRunEndpoint("ready")).toBe("/api/script-flow-drafts/runs");
    expect(draftRunEndpoint("trial_ready")).toBe("/api/script-flow-drafts/trial-runs");
  });

  it("keeps the selected loop mode for both verified and temporary drafts", () => {
    expect(draftRunOptions("loop_body")).toEqual({
      mode: "loop_until_stop",
      loopScope: "exclude_preparation"
    });
    expect(draftRunOptions("loop_all")).toEqual({
      mode: "loop_until_stop",
      loopScope: "all_steps"
    });
  });

  it("shows recent temporary tests and keeps navigation flows out of the case center", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialHistory={[{
        id: "temporary-1",
        appId: "cn.eeo.classin",
        platform: "android",
        kind: "case",
        purpose: "navigation",
        name: "从主页进入添加好友",
        prompt: "从主页进入添加好友页面",
        sourceYaml: "version: 1",
        parsed: {},
        parameterValues: {},
        lastRunId: "run-1",
        lastRunStatus: "passed",
        runCount: 2,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T01:00:00.000Z"
      }]}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\npurpose: navigation\nname: 从主页进入添加好友",
        document: {
          version: 1,
          kind: "case",
          purpose: "navigation",
          name: "从主页进入添加好友",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "reach", role: "navigation", reachPage: { page: "classin.friend.add" } }],
          tags: []
        },
        summary: "从主页进入添加好友",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("最近测试");
    expect(markup).toContain("从主页进入添加好友页面");
    expect(markup).toContain("加载测试：从主页进入添加好友");
    expect(markup).toContain("查看“从主页进入添加好友”的最近执行结果");
    expect(markup).not.toContain("再次执行");
    expect(markup).toContain("导航");
    expect(markup).not.toContain("保存到用例中心");
  });

  it("shows the generated test level and keeps probe drafts out of the case center", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialHistory={[{
        id: "temporary-1",
        appId: "cn.eeo.classin",
        platform: "android",
        kind: "case",
        purpose: "business",
        testLevel: "component",
        name: "设置课堂时长",
        prompt: "测试一下课堂时长",
        sourceYaml: "version: 1",
        parsed: { testLevel: "component" },
        parameterValues: {},
        lastRunId: "run-1",
        lastRunStatus: "passed",
        runCount: 1,
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T01:00:00.000Z"
      }]}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 临时验证发布按钮",
        document: {
          version: 1,
          kind: "case",
          purpose: "business",
          testLevel: "probe",
          name: "临时验证发布按钮",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "tap-publish", role: "business", tap: { target: { text: "发布" } } }],
          tags: []
        },
        summary: "临时验证发布按钮能否定位",
        assumptions: [],
        verification: {
          status: "needs_trial",
          sourceHash: "b".repeat(64),
          reasons: ["当前脚本版本尚未通过试运行"],
          unresolvedStepIds: ["tap-publish"],
          unresolvedOutcome: true
        },
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("控件能力");
    expect(markup).toContain("临时验证");
    expect(markup).not.toContain("保存到用例中心");
  });

  it("hides the generated summary and exposes assumptions from a compact help control", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 点击搜索图标",
        document: {
          version: 1,
          kind: "case",
          purpose: "business",
          testLevel: "business_smoke",
          name: "点击搜索图标",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "tap-search", role: "business", tap: { target: { icon: "search" } } }],
          tags: []
        },
        summary: "这段生成摘要不应显示",
        assumptions: ["用户当前位于含搜索入口的页面", "未要求校验点击后的目标页面"],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).not.toContain("这段生成摘要不应显示");
    expect(markup).toContain('aria-label="查看生成假设"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain("用户当前位于含搜索入口的页面");
    expect(markup).toContain("未要求校验点击后的目标页面");
  });

  it("renders generated steps collapsed and confirmed by default", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 修改课堂标题",
        document: {
          version: 1,
          kind: "case",
          purpose: "business",
          testLevel: "component",
          name: "修改课堂标题",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [
            {
              id: "fill-lesson-title",
              role: "business",
              inputText: {
                target: { text: "课堂标题", area: "bottomBar", nearText: "班级", scopeText: "课堂信息", ordinal: 1 },
                value: "111",
                search: { mode: "visibleOnly", direction: "down", maxSwipes: 6 }
              }
            },
            {
              id: "toggle-recording",
              tap: {
                target: { control: "switch", area: "content", nearText: "录制现场", checked: false },
                search: { mode: "auto", container: "content" }
              }
            }
          ],
          tags: []
        },
        summary: "修改课堂标题",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("脚本编排");
    expect(markup).toContain("前置准备");
    expect(markup).toContain("业务步骤");
    expect(markup).toContain("结果验证");
    expect(markup).toContain("无前置准备，执行时依赖当前设备状态");
    expect(markup).toContain("未设置结果验证，执行完成后需要人工确认");
    expect(markup).toContain("2/2 已确认");
    expect(markup).toContain("确认步骤 1：输入文本");
    expect(markup).toContain("展开步骤 1");
    expect(markup).toContain("所有步骤已确认，可以执行或保存");
    expect(markup).toContain("<span>添加</span>");
    expect(markup).not.toContain("添加步骤");
    expect(markup).not.toContain("引用用例");
    expect(markup).not.toContain("步骤名称");
    expect(markup).not.toContain("这一步会操作");
    expect(markup).not.toContain("上移步骤 1");
    expect(markup).not.toContain("试跑第 1 步");
    expect(markup).not.toContain("确认所有步骤后才能执行或保存");
  });

  it("does not show a duplicate legacy launch strategy beside an explicit launch step", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 启动并进入成长",
        document: {
          version: 1,
          kind: "case",
          purpose: "business",
          testLevel: "business_smoke",
          name: "启动并进入成长",
          app: { id: "cn.eeo.classin", platform: "android" },
          start: { strategy: "launchApp" },
          parameters: {},
          steps: [
            { id: "launch-app", role: "setup", launchApp: { appId: "cn.eeo.classin" } },
            { id: "open-growth", role: "business", tap: { target: { text: "成长" } } }
          ],
          tags: []
        },
        summary: "启动并进入成长",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("前置准备");
    expect(markup).toContain("确认步骤 1：重启 App");
    expect(markup).not.toContain("启动策略：启动 App");
  });

  it("builds isolated and remaining-step trial request bodies", () => {
    const common = {
      sourceYaml: "version: 1\nname: 创建课堂",
      deviceSerial: "device-1",
      parameters: { classroomName: "自动化课堂" },
      stepId: "fill-classroom-name"
    };

    expect(buildStepRunRequestBody({ ...common, mode: "single" })).toEqual({
      sourceYaml: common.sourceYaml,
      deviceSerial: "device-1",
      parameters: { classroomName: "自动化课堂" },
      startStepId: "fill-classroom-name",
      endStepId: "fill-classroom-name",
      pauseAfterEachStep: false
    });
    expect(buildStepRunRequestBody({ ...common, mode: "from_here" })).toEqual({
      sourceYaml: common.sourceYaml,
      deviceSerial: "device-1",
      parameters: { classroomName: "自动化课堂" },
      startStepId: "fill-classroom-name",
      pauseAfterEachStep: true
    });
  });

  it("shows completed and paused statuses beside the affected trial steps", () => {
    const run = stepTrialRun({
      status: "paused",
      stepResults: [{ stepId: "launch-app", status: "passed" }]
    });

    expect(stepTrialStatusForStep(run, "launch-app")).toBe("passed");
    expect(stepTrialStatusForStep(run, "tap-growth-tab")).toBe("paused");
    expect(stepTrialStatusForStep(run, "tap-notes-entry")).toBeUndefined();
  });

  it("aggregates expanded child action statuses on the runFlow reference", () => {
    const run = stepTrialRun({ status: "passed", stepResults: [] });
    run.steps = [
      { ...run.steps[1]!, id: "reuse-login.input-account", params: { scriptStepId: "reuse-login.input-account" } },
      { ...run.steps[1]!, id: "reuse-login.tap-login", params: { scriptStepId: "reuse-login.tap-login" } }
    ];
    run.stepResults = run.steps.map((step, index) => ({
      id: `result-child-${index}`,
      runId: run.id,
      iterationIndex: 1,
      stepId: step.id,
      stepOrder: index + 1,
      type: step.type,
      status: "passed",
      startedAt: "2026-08-03T00:00:00.000Z",
      artifacts: []
    }));

    expect(stepTrialStatusForStep(run, "reuse-login")).toBe("passed");
  });

  it("renders the active step trial and its controls at the orchestrator", () => {
    const markup = renderToStaticMarkup(<StepTrialRunBar
      run={stepTrialRun({
        status: "paused",
        stepResults: [{ stepId: "launch-app", status: "passed" }]
      })}
      busy={false}
      onControl={vi.fn()}
      onOpenResult={vi.fn()}
    />);

    expect(markup).toContain("启动后进入成长并点击笔记");
    expect(markup).toContain("1/3 个步骤");
    expect(markup).toContain("已暂停");
    expect(markup).toContain("执行下一步");
    expect(markup).toContain("连续执行");
    expect(markup).toContain("停止");
  });

  it("restores an active device step trial when the editor is reopened", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1" }]}
      selectedSerial="device-1"
      activeRunForDevice={stepTrialRun({
        status: "paused",
        stepResults: [{ stepId: "launch-app", status: "passed" }]
      })}
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 启动后进入成长并点击笔记",
        document: {
          version: 1,
          kind: "case",
          name: "启动后进入成长并点击笔记",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [
            { id: "launch-app", launchApp: { appId: "cn.eeo.classin" } },
            { id: "tap-growth-tab", tap: { target: { text: "成长" } } },
            { id: "tap-notes-entry", tap: { target: { text: "笔记" } } }
          ],
          tags: []
        },
        summary: "启动后进入成长并点击笔记",
        assumptions: [],
        channel: "history",
        model: "snapshot"
      } as never}
    />);

    expect(markup).toContain("当前试跑");
    expect(markup).toContain("启动后进入成长并点击笔记");
    expect(markup).toContain("已暂停");
    expect(markup).toContain("run-status-badge");
    expect(markup).not.toContain("step-trial-status");
  });

  it("shows and controls the active step trial before a draft is loaded", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1" }]}
      selectedSerial="device-1"
      activeRunForDevice={stepTrialRun({
        status: "paused",
        stepResults: [{ stepId: "launch-app", status: "passed" }]
      })}
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
    />);

    expect(markup).toContain("当前试跑");
    expect(markup).toContain("启动后进入成长并点击笔记");
    expect(markup).toContain("执行下一步");
    expect(markup).toContain("停止");
  });

  it("collapses structural and nested steps together by default", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 重复填写",
        document: {
          version: 1,
          kind: "case",
          name: "重复填写",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{
            id: "repeat-fields",
            repeat: {
              times: 2,
              steps: [{ id: "tap-field", tap: { target: { text: "课堂名称" } } }]
            }
          }],
          tags: []
        },
        summary: "重复填写",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("2/2 已确认");
    expect(markup).toContain('aria-label="展开步骤 1"');
    expect(markup).toContain('aria-label="展开步骤 2"');
    expect(markup).not.toContain("结构步骤由内部步骤组成");
    expect(markup).not.toContain('aria-label="试跑第 1 步"');
  });

  it("keeps the orchestrator available for an empty draft", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 新测试",
        document: {
          version: 1,
          kind: "case",
          name: "新测试",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [],
          tags: []
        },
        summary: "新测试",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("脚本编排");
    expect(markup).toContain("<span>添加</span>");
    expect(markup).not.toContain("添加复位步骤");
    expect(markup).toContain("请至少添加一个步骤");
    expect(markup).toContain("disabled");
  });

  it("updates a generated draft when a step locator is edited", () => {
    const draft = {
      status: "ready" as const,
      sourceYaml: "version: 1\nname: 修改课堂标题",
      document: {
        version: 1 as const,
        kind: "case" as const,
        purpose: "business" as const,
        testLevel: "component" as const,
        name: "修改课堂标题",
        app: { id: "cn.eeo.classin", platform: "android" },
        parameters: {},
        steps: [{
          id: "fill-lesson-title",
          role: "business" as const,
          inputText: {
            target: { text: "课堂标题", area: "content" },
            value: "111",
            search: { mode: "visibleOnly" as const }
          }
        }],
        tags: []
      },
      summary: "修改课堂标题",
      assumptions: [],
      channel: "codex",
      model: "planner"
    };

    const [step] = stepReviewItems(draft.document);
    const updated = updateDraftStepLocator(draft, step!.key, {
      targetKind: "control",
      targetValue: "textField",
      scopeText: "课堂标题",
      ordinal: "1",
      searchMode: "auto",
      direction: "down",
      maxSwipes: "6"
    });

    expect(updated.status).toBe("trial_ready");
    expect(updated.document.steps[0]).toMatchObject({
      inputText: {
        target: { control: "textField", scopeText: "课堂标题", ordinal: 1, area: "content" },
        search: { mode: "auto", direction: "down", maxSwipes: 6 }
      }
    });
    expect(updated.sourceYaml).toContain('control: "textField"');
    expect(updated.sourceYaml).toContain('mode: "auto"');
  });

  it("does not require step review for a draft loaded from recent test history and keeps parameter values", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 修改课堂标题",
        document: {
          version: 1,
          kind: "case",
          purpose: "business",
          testLevel: "component",
          name: "修改课堂标题",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {
            lessonTitle: { type: "string", label: "课堂标题", required: true }
          },
          steps: [{
            id: "fill-lesson-title",
            role: "business",
            inputText: {
              target: { text: "课堂标题", area: "content" },
              value: "${lessonTitle}",
              search: { mode: "auto", direction: "down", maxSwipes: 6 }
            }
          }],
          tags: []
        },
        parameterValues: { lessonTitle: "历史课堂标题" },
        summary: "修改课堂标题",
        assumptions: [],
        channel: "history",
        model: "snapshot"
      } as never}
    />);

    expect(markup).toContain("脚本编排");
    expect(markup).not.toContain("确认所有步骤后才能执行或保存");
    expect(markup).toContain("课堂标题");
    expect(markup).toContain('value="历史课堂标题"');
    expect(markup).toContain(">执行<");
  });

  it("updates the matched saved draft instead of creating a duplicate use case", () => {
    expect(draftSaveDestination(undefined, {
      id: "flow-add-friend",
      version: 4,
      name: "从主页进入添加好友页面"
    })).toEqual({
      url: "/api/script-flows/flow-add-friend",
      method: "PUT",
      expectedVersion: 4
    });
  });

  it("builds screen assist request only when current-screen generation is explicitly enabled", () => {
    expect(buildAiGenerateRequestBody({
      prompt: "当前页面第一个输入框改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      useCurrentScreen: false,
      deviceSerial: "device-1"
    })).toEqual({
      prompt: "当前页面第一个输入框改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android"
    });

    expect(buildAiGenerateRequestBody({
      prompt: "当前页面第一个输入框改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      useCurrentScreen: true,
      deviceSerial: "device-1"
    })).toEqual({
      prompt: "当前页面第一个输入框改成自动化课堂",
      appId: "cn.eeo.classin",
      platform: "android",
      screenAssist: { mode: "current", deviceSerial: "device-1" }
    });
  });

  it("disables current-screen generation when no device is selected", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
    />);

    expect(markup).toContain("结合当前屏幕生成");
    expect(markup).toContain("请选择设备后可用");
    expect(markup).toContain("type=\"checkbox\"");
    expect(markup).toContain("disabled=\"\"");
  });

  it("labels a matched saved draft as an update", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 从主页进入添加好友页面",
        document: {
          version: 1,
          kind: "case",
          name: "从主页进入添加好友页面",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [],
          tags: []
        },
        summary: "已找到待验证草稿",
        assumptions: [],
        sourceFlow: { id: "flow-add-friend", version: 4, name: "从主页进入添加好友页面" },
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("更新用例中心");
    expect(markup).not.toContain("保存到用例中心");
  });

  it("asks for a single business outcome review when the trial has no automatic oracle", () => {
    const markup = renderToStaticMarkup(<TrialOutcomeReview
      session={{
        id: "session-1",
        runId: "run-1",
        appId: "cn.eeo.classin",
        platform: "android",
        sourceHash: "a".repeat(64),
        executionPassed: true,
        outcomeStatus: "unverified",
        status: "needs_outcome_review",
        summary: { pageCandidates: 0, interactionCandidates: 0, navigationCandidates: 0, testCandidates: 1, issues: [] },
        createdAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z"
      }}
      busy={false}
      onReview={vi.fn()}
    />);

    expect(markup).toContain("确认执行结果");
    expect(markup).toContain("结果符合预期");
    expect(markup).toContain("不符合预期");
  });

  it("shows only the public execution failure and keeps technical details in the report", () => {
    const markup = renderToStaticMarkup(<ExecutionFailureNotice
      failure={{
        kind: "target_not_found",
        message: "未找到当前操作的目标，请补充目标文字、图标特征或所在位置。",
        nextAction: "supplement_process"
      }}
      onOpenReport={vi.fn()}
    />);

    expect(markup).toContain("未找到当前操作的目标");
    expect(markup).toContain("查看执行结果");
    expect(markup).not.toContain("SEMANTIC_TARGET_NOT_FOUND");
  });
  it("shows a generated draft without reading current device state", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 打开主页",
        document: {
          version: 1,
          kind: "case",
          name: "打开主页",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "launch", name: "启动 ClassIn", launchApp: { appId: "cn.eeo.classin" } }],
          tags: []
        },
        summary: "启动 App 并等待主页",
        assumptions: [],
        channel: "codex",
        model: "planner"
      }}
    />);

    expect(markup).toContain("AI 生成测试");
    expect(markup).toContain("用例");
    expect(markup).toContain(">执行<");
    expect(markup).toContain("保存到用例中心");
    expect(markup).not.toContain("执行逻辑");
    expect(markup).toContain("启动 ClassIn");
    expect(markup).not.toContain("启动 App 并等待主页");
    expect(markup).not.toContain("version: 1");
    expect(markup).not.toContain("进入脚本编辑器");
    expect(markup).not.toContain("识别当前设备页面");
    expect(markup).not.toContain("key=value");
  });

  it("offers the same execute and save actions for a first-run test", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "trial_ready",
        sourceYaml: "version: 1\nname: 打开添加好友",
        document: {
          version: 1,
          kind: "case",
          name: "打开添加好友",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "open-add-friend", tap: { target: { text: "添加好友" } } }],
          tags: []
        },
        summary: "打开添加好友页面",
        assumptions: [],
        verification: {
          status: "needs_trial",
          sourceHash: "a".repeat(64),
          reasons: ["当前脚本版本尚未通过试运行"],
          unresolvedStepIds: ["open-add-friend"],
          unresolvedOutcome: true
        },
        channel: "codex",
        model: "planner"
      }}
    />);

    expect(markup).toContain(">执行<");
    expect(markup).toContain("保存到用例中心");
    expect(markup).toContain("循环业务与验证");
    expect(markup).toContain("循环整个用例");
    expect(markup).toContain("每轮复位");
    expect(markup).toContain("业务执行后已回到起点，无需复位");
    expect(markup).toContain("请先配置每轮复位步骤");
    expect(markup).not.toContain("试运行");
    expect(markup).not.toContain("保存草稿");
    expect(markup).not.toContain("沉淀所选资产");
  });

  it("uses natural language to revise an existing use case", () => {
    const onStartNewTest = vi.fn();
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      onStartNewTest={onStartNewTest}
      revision={{ flowId: "flow-login", version: 3, name: "教师登录" }}
    />);

    expect(markup).toContain("AI 调整测试");
    expect(markup).toContain("教师登录");
    expect(markup).toContain("描述你想怎样修改这个测试");
    expect(markup).toContain("新建测试");
    expect(markup).not.toContain("App ID");
  });

  it("opens a saved use case directly in the script orchestrator for manual editing", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      revision={{ flowId: "flow-login", version: 3, name: "教师登录" }}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 教师登录",
        document: {
          version: 1,
          kind: "case",
          name: "教师登录",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "tap-login", name: "点击登录", tap: { target: { text: "登录" } } }],
          tags: []
        },
        summary: "教师登录",
        assumptions: [],
        channel: "manual",
        model: "saved-flow"
      }}
    />);

    expect(markup).toContain("编辑测试");
    expect(markup).toContain("脚本编排");
    expect(markup).toContain("点击登录");
    expect(markup).toContain("保存修改");
    expect(markup).not.toContain("描述你想怎样修改这个测试");
    expect(markup).not.toContain("生成修改方案");
    expect(markup).not.toContain("等待修改说明");
  });

  it("prefills ephemeral parameter values returned with an AI draft", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 教师登录",
        document: {
          version: 1,
          kind: "case",
          name: "教师登录",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {
            account: { type: "string", label: "手机号或邮箱", required: true, sensitive: true },
            password: { type: "string", label: "密码", required: true, sensitive: true }
          },
          steps: [],
          tags: []
        },
        parameterValues: { account: "demo-account", password: "demo-secret" },
        summary: "登录教师账号",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain('value="demo-account"');
    expect(markup).toContain('value="demo-secret"');
  });
});

function reusableFlow(
  id: string,
  name: string,
  steps: Array<Record<string, unknown>>,
  parameters: Record<string, Record<string, unknown>> = {}
): ScriptFlow {
  return {
    id,
    appId: "cn.eeo.classin",
    platform: "android",
    name,
    sourceYaml: "version: 1",
    parsed: {
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "business_smoke",
      name,
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters,
      steps,
      tags: []
    },
    status: "active",
    version: 3,
    tags: [],
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z"
  };
}

function stepTrialRun(input: {
  status: TestRun["status"];
  stepResults: Array<{ stepId: string; status: TestRun["stepResults"][number]["status"] }>;
}): TestRun {
  const stepIds = ["launch-app", "tap-growth-tab", "tap-notes-entry"];
  return {
    id: "run-step-trial",
    caseName: "启动后进入成长并点击笔记",
    deviceSerial: "device-1",
    status: input.status,
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: false,
      keepVideoOnSuccess: false,
      pauseAfterEachStep: true
    },
    steps: stepIds.map((id, index) => ({
      id,
      order: index + 1,
      type: index === 0 ? "launch_app" : "tap_on_text",
      enabled: true,
      params: { scriptStepId: id },
      createdAt: "2026-08-03T00:00:00.000Z"
    })),
    stepResults: input.stepResults.map((result, index) => ({
      id: `result-${index + 1}`,
      runId: "run-step-trial",
      iterationIndex: 1,
      stepId: result.stepId,
      stepOrder: stepIds.indexOf(result.stepId) + 1,
      type: result.stepId === "launch-app" ? "launch_app" : "tap_on_text",
      status: result.status,
      startedAt: "2026-08-03T00:00:00.000Z",
      artifacts: []
    })),
    metrics: [],
    events: [],
    artifacts: [],
    sourceSnapshot: {
      kind: "script_flow",
      flowId: "temporary:test",
      version: 1,
      planDigest: "digest",
      executionPurpose: "step_trial",
      dependencies: [],
      parsed: {}
    },
    startedAt: "2026-08-03T00:00:00.000Z"
  };
}
