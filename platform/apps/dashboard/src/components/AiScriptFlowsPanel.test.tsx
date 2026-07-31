import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiScriptFlowsPanel, draftRunEndpoint, draftSaveDestination, ExecutionFailureNotice, TrialOutcomeReview } from "./AiScriptFlowsPanel.js";

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
    expect(markup).toContain("再次执行");
    expect(markup).toContain("导航");
    expect(markup).not.toContain("保存到用例中心");
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
