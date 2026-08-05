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
});
