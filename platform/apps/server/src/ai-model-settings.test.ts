import { describe, expect, it } from "vitest";
import { isCodexAppServerProvider } from "./ai-client.js";
import {
  previewAiModelSettingsUpdate,
  publicAiModelSettings,
  resolveAiModelConfig
} from "./ai-model-settings.js";

describe("AI model settings", () => {
  it("resolves enabled model settings without exposing the API key", () => {
    const stored = {
      enabled: true,
      baseURL: "https://model.example/v1",
      apiKey: "secret",
      model: "vision-model",
      timeoutMs: 12_000
    };
    expect(resolveAiModelConfig({}, stored)).toEqual({
      enabled: true,
      baseURL: "https://model.example/v1",
      apiKey: "secret",
      model: "vision-model",
      timeoutMs: 12_000
    });
    expect(publicAiModelSettings({}, stored)).toEqual({
      enabled: true,
      baseURL: "https://model.example/v1",
      model: "vision-model",
      timeoutMs: 12_000,
      apiKeyConfigured: true,
      source: "stored"
    });
  });

  it("supports the Codex app-server provider without an API key", () => {
    const config = resolveAiModelConfig({}, { enabled: true, baseURL: "codex://app-server", model: "gpt-5.4" });
    expect(config).toEqual({ enabled: true, baseURL: "codex://app-server", model: "gpt-5.4", timeoutMs: 30_000 });
    expect(isCodexAppServerProvider(config.enabled ? config.baseURL : "")).toBe(true);
  });

  it("uses the new generic environment contract", () => {
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

  it("can clear a stored API key", () => {
    expect(previewAiModelSettingsUpdate(
      { enabled: true, baseURL: "https://model.example/v1", apiKey: "secret", model: "vision-model" },
      { clearApiKey: true }
    )).toEqual({ enabled: true, baseURL: "https://model.example/v1", model: "vision-model" });
  });
});
