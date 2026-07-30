import { describe, expect, it, vi } from "vitest";
import { isCodexAppServerProvider, resolveCodexExecutable, runAiJsonRequest } from "./ai-client.js";

const config = { baseURL: "https://llm.example.com/v1", apiKey: "sk-test", model: "test-model", timeoutMs: 5000 };

it("recognizes only the exact local Codex provider address", () => {
  expect(isCodexAppServerProvider("codex://app-server")).toBe(true);
  expect(isCodexAppServerProvider("codex://app-server.evil.example")).toBe(false);
});

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("ai-client", () => {
  it("prefers an explicitly configured Codex executable", () => {
    expect(resolveCodexExecutable({ configuredPath: "/custom/bin/codex" })).toBe("/custom/bin/codex");
  });

  it("finds the Codex binary bundled in the macOS desktop app when PATH does not contain it", () => {
    expect(resolveCodexExecutable({
      platform: "darwin",
      fileExists: (candidate) => candidate === "/Applications/ChatGPT.app/Contents/Resources/codex"
    })).toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
  });

  it("falls back to PATH lookup outside a bundled desktop installation", () => {
    expect(resolveCodexExecutable({ platform: "linux", fileExists: () => false })).toBe("codex");
  });

  it("identifies codex app-server provider", () => {
    expect(isCodexAppServerProvider("codex://app-server")).toBe(true);
    expect(isCodexAppServerProvider("https://llm.example.com/v1")).toBe(false);
    expect(isCodexAppServerProvider(undefined)).toBe(false);
  });

  it("runs text-only request through OpenAI-compatible endpoint", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user" }, fetchImpl);
    expect(result).toEqual({ content: '{"ok":true}', visionUsed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "user" });
  });

  it("sends image as multimodal content and reports visionUsed", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user", imagePngBase64: "aGk=" }, fetchImpl);
    expect(result.visionUsed).toBe(true);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages[1]!.content).toEqual([
      { type: "text", text: "user" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }
    ]);
  });

  it("falls back to text-only when image request is rejected", async () => {
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("unsupported content", { status: 400 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user", imagePngBase64: "aGk=" }, fetchImpl);
    expect(result).toEqual({ content: '{"ok":true}', visionUsed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(secondBody.messages[1]).toEqual({ role: "user", content: "user" });
  });

  it("throws when API key is missing for OpenAI-compatible endpoint", async () => {
    await expect(
      runAiJsonRequest({ ...config, apiKey: undefined }, { developerInstructions: "s", userContent: "u" })
    ).rejects.toThrow(/API key/i);
  });

  it("throws on non-2xx response without image", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("boom", { status: 500 }));
    await expect(
      runAiJsonRequest(config, { developerInstructions: "s", userContent: "u" }, fetchImpl)
    ).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
