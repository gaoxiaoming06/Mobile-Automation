import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AiScriptFlowsPanel,
  buildAiGenerateRequestBody,
  draftRunEndpoint,
  draftSaveDestination,
  ExecutionFailureNotice,
  stepReviewItems,
  TrialOutcomeReview,
  updateDraftStepLocator
} from "./AiScriptFlowsPanel.js";

describe("AiScriptFlowsPanel", () => {
  it("uses separate execution endpoints for verified and trial-ready drafts", () => {
    expect(draftRunEndpoint("ready")).toBe("/api/script-flow-drafts/runs");
    expect(draftRunEndpoint("trial_ready")).toBe("/api/script-flow-drafts/trial-runs");
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

  it("renders generated steps as a review checklist with only safe locator edits", () => {
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
          steps: [{
            id: "fill-lesson-title",
            role: "business",
            inputText: {
              target: { text: "课堂标题", area: "bottomBar", nearText: "班级", scopeText: "课堂信息", ordinal: 1 },
              value: "111",
              search: { mode: "visibleOnly", direction: "down", maxSwipes: 6 }
            }
          }],
          tags: []
        },
        summary: "修改课堂标题",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain("步骤审查");
    expect(markup).toContain("0/1 已确认");
    expect(markup).toContain("确认步骤 1：输入文本");
    expect(markup).toContain("这一步会操作");
    expect(markup).toContain("屏幕上的文字");
    expect(markup).toContain('value="课堂标题"');
    expect(markup).toContain("查找方式");
    expect(markup).toContain("只在当前屏幕查找");
    expect(markup).toContain("页面区域");
    expect(markup).toContain("底部栏");
    expect(markup).not.toContain("操作目标");
    expect(markup).not.toContain("滚动方向");
    expect(markup).not.toContain("最多滑动次数");
    expect(markup).not.toContain("最多滑动 6 次");
    expect(markup).not.toContain("高级定位设置");
    expect(markup).not.toContain("旁边有这些文字");
    expect(markup).not.toContain("限定在这个区域或行内");
    expect(markup).not.toContain("第几个匹配项");
    expect(markup).not.toContain('<option value="icon">');
    expect(markup).not.toContain("search.mode");
    expect(markup).not.toContain("nearText");
    expect(markup).not.toContain("scopeText");
    expect(markup).not.toContain("ordinal");
    expect(markup).not.toContain("checked");
    expect(markup).not.toContain(">visibleOnly<");
    expect(markup).not.toContain(">bottomBar<");
    expect(markup).not.toContain("文字 text");
    expect(markup).toContain("确认所有步骤后才能执行或保存");
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

    expect(markup).not.toContain("步骤审查");
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
    expect(markup).toContain("执行逻辑");
    expect(markup).toContain("启动 ClassIn");
    expect(markup).toContain("启动 App 并等待主页");
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
    expect(markup).not.toContain("试运行");
    expect(markup).not.toContain("保存草稿");
    expect(markup).not.toContain("沉淀所选资产");
  });

  it("uses natural language to revise an existing use case", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      revision={{ flowId: "flow-login", version: 3, name: "教师登录" }}
    />);

    expect(markup).toContain("修改测试");
    expect(markup).toContain("教师登录");
    expect(markup).toContain("描述你想怎样修改这个测试");
    expect(markup).not.toContain("App ID");
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
