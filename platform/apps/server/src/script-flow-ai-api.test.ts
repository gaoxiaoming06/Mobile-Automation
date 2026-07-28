import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerScriptFlowAiRoutes } from "./script-flow-ai-api.js";

describe("ScriptFlow AI API", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))));

  it("generates a draft without accepting device state or compiled actions", async () => {
    const generateDraft = vi.fn().mockResolvedValue({ status: "needs_clarification", clarification: "请选择班级", channel: "codex", model: "planner" });
    const app = express();
    app.use(express.json());
    registerScriptFlowAiRoutes(app, { generateDraft });
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
    expect(generateDraft).toHaveBeenCalledWith({ prompt: "打开班级详情", appId: "cn.eeo.classin", platform: "android" });

    const bypass = await fetch(`${baseUrl}/api/script-flow-drafts/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "打开主页", appId: "cn.eeo.classin", platform: "android", currentPage: "home" })
    });
    expect(bypass.status).toBe(400);
    expect(await bypass.json()).toEqual({ error: "Unknown request field: currentPage" });
  });
});
