import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScriptFlow } from "@mobile-automation/shared";
import { registerScriptFlowAiRoutes } from "./script-flow-ai-api.js";

describe("ScriptFlow AI API", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

  it("generates a draft without accepting device state or compiled actions", async () => {
    const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请选择班级", channel: "codex", model: "planner" });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, { generateDraft, getFlow: () => undefined });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "打开班级详情", appId: "cn.eeo.classin", platform: "android" })
    });
    expect(response.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledWith({ prompt: "打开班级详情", appId: "classin", platform: "android" });

    const bypass = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "打开主页", appId: "cn.eeo.classin", platform: "android", currentPage: "home" })
    });
    expect(bypass.status).toBe(400);
    expect(await bypass.json()).toEqual({ error: "Unknown request field: currentPage" });
  });

  it("passes explicit screen assist request to the draft generator", async () => {
    const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请选择班级", channel: "codex", model: "planner" });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, { generateDraft, getFlow: () => undefined });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "把当前页第一个输入框改成自动化课堂",
        appId: "cn.eeo.classin",
        platform: "android",
        screenAssist: { mode: "current", deviceSerial: "device-1" }
      })
    });

    expect(response.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledWith({
      prompt: "把当前页第一个输入框改成自动化课堂",
      appId: "classin",
      platform: "android",
      screenAssist: { mode: "current", deviceSerial: "device-1" }
    });
  });

  it("accepts external code context and scriptPlatform from external AI callers", async () => {
    const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请选择入口", channel: "codex", model: "planner" });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, { generateDraft, getFlow: () => undefined });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "从成长页进入全网搜索",
        appId: "classin",
        scriptPlatform: "harmony",
        externalContext: {
          source: "classin-code",
          implementationStack: "harmony-native",
          summary: "Growth 页面顶栏存在搜索入口。",
          candidateSteps: ["打开成长 Tab", "点击搜索入口", "确认搜索输入框"]
        }
      })
    });

    expect(response.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledWith({
      prompt: "从成长页进入全网搜索",
      appId: "classin",
      platform: "harmony",
      externalContext: {
        source: "classin-code",
        implementationStack: "harmony-native",
        summary: "Growth 页面顶栏存在搜索入口。",
        candidateSteps: ["打开成长 Tab", "点击搜索入口", "确认搜索输入框"]
      }
    });
  });

  it("loads the current saved case as context when AI modifies a use case", async () => {
    const existingFlow: ScriptFlow = {
      id: "flow-login",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师登录",
      sourceYaml: "version: 1\nname: 教师登录",
      parsed: { version: 1, name: "教师登录", steps: [] },
      status: "active",
      version: 3,
      tags: [],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    };
    const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请提供账号", channel: "codex", model: "planner" });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, { generateDraft, getFlow: (id: string) => id === existingFlow.id ? existingFlow : undefined });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "登录后增加主页校验", flowId: existingFlow.id, expectedVersion: 3 })
    });

    expect(response.status).toBe(200);
    expect(generateDraft).toHaveBeenCalledWith({
      prompt: "登录后增加主页校验",
      appId: "cn.eeo.classin",
      platform: "android",
      existingFlow
    });

    const stale = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "修改登录", flowId: existingFlow.id, expectedVersion: 2 })
    });
    expect(stale.status).toBe(409);
  });

  it("repairs an unsaved draft from a failed trial run", async () => {
    const sourceYaml = `version: 1
kind: case
name: 打开搜索
app: { id: classin }
steps:
  - id: tap-search
    tap:
      target: { text: 搜索图标 }
`;
    const failedRun = {
      id: "run-failed",
      status: "failed",
      caseName: "打开搜索",
      sourceSnapshot: { kind: "script_flow", sourceYaml },
      steps: [{ id: "action-1", title: "点击搜索图标", params: { scriptStepId: "tap-search" } }],
      stepResults: [{
        id: "step-result-1",
        runId: "run-failed",
        iterationIndex: 1,
        stepId: "action-1",
        stepOrder: 1,
        type: "tap",
        status: "failed",
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        errorMessage: "未找到搜索图标",
        metadata: { semantic: { reason: "current_visual_icon_not_found", role: "search" } },
        startedAt: "2026-08-05T00:00:00.000Z",
        artifacts: []
      }],
      artifacts: [{ id: "shot-1", type: "screenshot", name: "failed.png", path: "failed.png", url: "/artifacts/failed.png", createdAt: "2026-08-05T00:00:00.000Z" }],
      events: []
    };
    const generateDraft = vi.fn().mockResolvedValue({
      status: "trial_ready",
      sourceYaml: sourceYaml.replace("text: 搜索图标", "icon: search"),
      document: { version: 1, kind: "case", name: "打开搜索", app: { id: "classin" }, steps: [] },
      summary: "已将搜索目标修复为图标定位",
      assumptions: [],
      channel: "codex",
      model: "planner"
    });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, {
      generateDraft,
      getFlow: () => undefined,
      getRun: (id: string) => id === "run-failed" ? failedRun as never : undefined
    });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceYaml,
        runId: "run-failed",
        instruction: "只修复失败步骤",
        scriptPlatform: "android"
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      draft: {
        status: "trial_ready",
        sourceYaml: expect.stringContaining("icon: search")
      },
      repair: {
        runId: "run-failed",
        failure: { kind: "target_not_found" }
      }
    });
    expect(generateDraft).toHaveBeenCalledWith(expect.objectContaining({
      appId: "classin",
      platform: "android",
      existingFlow: expect.objectContaining({
        sourceYaml,
        name: "打开搜索"
      }),
      externalContext: expect.objectContaining({
        source: "manual",
        summary: expect.stringContaining("未找到搜索图标"),
        constraints: expect.arrayContaining([
          "只修复失败步骤，不改变原业务目标。",
          "禁止使用坐标、resourceId、accessibilityId 或平台私有 selector。"
        ])
      })
    }));
    expect(generateDraft.mock.calls[0]![0].prompt).toContain("只修复失败步骤");
    expect(generateDraft.mock.calls[0]![0].prompt).toContain("target_not_found");
  });

  it("does not repair runtime or infrastructure failures", async () => {
    const generateDraft = vi.fn();
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, {
      generateDraft,
      getFlow: () => undefined,
      getRun: (id: string) => id === "run-crash" ? {
        id: "run-crash",
        status: "failed",
        caseName: "打开页面",
        sourceSnapshot: { kind: "script_flow" },
        steps: [],
        stepResults: [],
        artifacts: [],
        events: [{
          id: "event-1",
          runId: "run-crash",
          deviceSerial: "device-1",
          type: "crash",
          severity: "error",
          occurredAt: "2026-08-05T00:00:00.000Z",
          summary: "目标 App 崩溃"
        }]
      } as never : undefined
    });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/script-flow-drafts/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceYaml: "version: 1\nname: 打开页面\napp: { id: classin }\nsteps: []", runId: "run-crash" })
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "当前失败属于 App、设备或环境问题，不应通过修改脚本掩盖。",
      failure: { kind: "app_failure" }
    });
    expect(generateDraft).not.toHaveBeenCalled();
  });
});
