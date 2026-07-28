import { describe, expect, it } from "vitest";
import { isCodexAppServerProvider } from "./ai-client.js";
import {
  previewAiModelSettingsUpdate,
  publicAiModelSettings,
  readAiModelSettingsUpdate,
  resolveAiModelConfig
} from "./ai-model-settings.js";

describe("AI model settings", () => {
  it("stores only local Codex preferences and never provider credentials", () => {
    const stored = { enabled: true, model: "gpt-5.4", timeoutMs: 12_000 };

    expect(resolveAiModelConfig({}, stored)).toEqual({
      enabled: true,
      baseURL: "codex://app-server",
      model: "gpt-5.4",
      timeoutMs: 12_000
    });
    expect(publicAiModelSettings({}, stored)).toEqual({
      enabled: true,
      baseURL: "codex://app-server",
      model: "gpt-5.4",
      timeoutMs: 12_000,
      apiKeyConfigured: false,
      source: "stored"
    });
  });

  it("supports the local Codex provider without an API key", () => {
    const config = resolveAiModelConfig({}, { enabled: true, model: "gpt-5.4" });
    expect(config).toEqual({ enabled: true, baseURL: "codex://app-server", model: "gpt-5.4", timeoutMs: 30_000 });
    expect(isCodexAppServerProvider(config.enabled ? config.baseURL : "")).toBe(true);
  });

  it("allows an operator-managed HTTP provider only through environment variables", () => {
    expect(resolveAiModelConfig({
      AI_MODEL_ENABLED: "true",
      AI_MODEL_BASE_URL: "https://model.example/v1",
      AI_MODEL_API_KEY: "secret",
      AI_MODEL_NAME: "vision-model",
      AI_MODEL_TIMEOUT_MS: "9000"
    })).toEqual({
      enabled: true,
      baseURL: "https://model.example/v1",
      apiKey: "secret",
      model: "vision-model",
      timeoutMs: 9000
    });
  });

  it("drops browser-supplied provider addresses and credentials", () => {
    expect(previewAiModelSettingsUpdate(undefined, {
      enabled: true,
      model: "gpt-5.4",
      timeoutMs: 10_000,
      baseURL: "http://127.0.0.1:9999",
      apiKey: "must-not-persist"
    } as never)).toEqual({ enabled: true, model: "gpt-5.4", timeoutMs: 10_000 });
  });

  it("rejects provider fields at the HTTP settings boundary", () => {
    expect(() => readAiModelSettingsUpdate({ enabled: true, baseURL: "http://127.0.0.1:9999" })).toThrow("Unknown AI settings field: baseURL");
    expect(() => readAiModelSettingsUpdate({ enabled: true, apiKey: "secret" })).toThrow("Unknown AI settings field: apiKey");
    expect(readAiModelSettingsUpdate({ enabled: true, model: "gpt-5.4", timeoutMs: 5000 })).toEqual({ enabled: true, model: "gpt-5.4", timeoutMs: 5000 });
  });
});
