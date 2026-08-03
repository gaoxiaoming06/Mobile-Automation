import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LearningSession, ScriptFlow } from "@mobile-automation/shared";
import {
  CaseCenterPanel,
  buildCaseRunRequest,
  caseRunEndpoint,
  caseTrialCompletionMessage,
  runOptionsForExecutionMode,
  selectedCaseIdAfterExternalSelection
} from "./CaseCenterPanel.js";

describe("CaseCenterPanel", () => {
  it("shows reusable use cases and readable execution logic without exposing scripts", () => {
    const markup = renderToStaticMarkup(
      <CaseCenterPanel
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        selectedSerial="device-1"
        initialFlows={[flow(), scenario()]}
        setMessage={vi.fn()}
        onOpenRun={vi.fn()}
        onModifyCase={vi.fn()}
        onAiModifyCase={vi.fn()}
        onCreateCase={vi.fn()}
      />
    );

    expect(markup).toContain("用例中心");
    expect(markup).toContain("用例");
    expect(markup).toContain("场景");
    expect(markup).toContain("创建课堂但不发布");
    expect(markup).toContain("执行逻辑");
    expect(markup).toContain("确认已进入新建课堂页");
    expect(markup).toContain("修改测试");
    expect(markup).toContain("AI 调整");
    expect(markup).toContain("AI 创建测试");
    expect(markup).toContain("沉淀可复用的用例与场景");
    expect(markup).toContain("运行配置");
    expect(markup).toContain("开始执行");
    expect(markup).not.toContain("风险确认");
    expect(markup).not.toContain("试运行");
    expect(markup).not.toContain("沉淀所选资产");
    expect(markup).not.toContain("ScriptFlow YAML");
    expect(markup).not.toContain("脚本编辑器");
    expect(markup).not.toContain("校验脚本");
  });

  it("binds execution to the selected use case version and preview digest", () => {
    expect(buildCaseRunRequest({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" }
    })).toEqual({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" }
    });
  });

  it("uses trial execution until the exact use case version is verified", () => {
    expect(caseRunEndpoint("flow-1", "needs_trial")).toBe("/api/script-flows/flow-1/trial-runs");
    expect(caseRunEndpoint("flow-1", "verified")).toBe("/api/script-flows/flow-1/runs");
  });

  it("maps the two continuous UI modes to their backend loop scopes", () => {
    expect(runOptionsForExecutionMode("once")).toEqual({ mode: "once" });
    expect(runOptionsForExecutionMode("loop_body")).toEqual({
      mode: "loop_until_stop",
      loopScope: "exclude_preparation"
    });
    expect(runOptionsForExecutionMode("loop_all")).toEqual({
      mode: "loop_until_stop",
      loopScope: "all_steps"
    });
  });

  it("selects a newly saved case when a retained case center becomes visible again", () => {
    expect(selectedCaseIdAfterExternalSelection("old-flow", "new-flow")).toBe("new-flow");
    expect(selectedCaseIdAfterExternalSelection("old-flow", undefined)).toBe("old-flow");
  });

  it("requires business outcome confirmation before calling a persisted trial verified", () => {
    expect(caseTrialCompletionMessage(learningSession("needs_outcome_review"))).toBe(
      "执行操作已完成，请确认当前业务结果是否符合预期"
    );
    expect(caseTrialCompletionMessage(learningSession("ready"), {
      status: "verified",
      sourceHash: "hash",
      reasons: [],
      unresolvedStepIds: [],
      unresolvedOutcome: false
    })).toBe("执行通过，当前版本已验证");
  });
});

function learningSession(status: LearningSession["status"]): LearningSession {
  return {
    id: "learning-1",
    runId: "run-1",
    appId: "cn.eeo.classin",
    platform: "android",
    sourceHash: "hash",
    executionPassed: true,
    outcomeStatus: status === "needs_outcome_review" ? "unverified" : "human_confirmed",
    status,
    summary: { pageCandidates: 0, interactionCandidates: 0, navigationCandidates: 0, testCandidates: 0, issues: [] },
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  };
}

function flow(): ScriptFlow {
  return {
    id: "flow-1",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "创建课堂但不发布",
    description: "进入指定班级并填写新课堂信息，不执行发布。",
    sourceYaml: "internal script content",
    parsed: {
      version: 1,
      kind: "case",
      name: "创建课堂但不发布",
      description: "进入指定班级并填写新课堂信息，不执行发布。",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: { lessonName: { type: "string", label: "课堂名称", required: true } },
      steps: [{ id: "verify", name: "确认已进入新建课堂页", assertPage: "classin.lesson.create" }],
      tags: ["课堂"]
    },
    status: "active",
    version: 1,
    tags: ["课堂"],
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };
}

function scenario(): ScriptFlow {
  const value = flow();
  return {
    ...value,
    id: "scenario-1",
    name: "登录后创建课堂",
    parsed: { ...value.parsed, kind: "scenario", name: "登录后创建课堂" }
  };
}
