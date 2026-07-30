import { isCodexAppServerProvider } from "./ai-client.js";

export type AiModelConfig =
  | {
      enabled: true;
      baseURL: string;
      apiKey?: string;
      model: string;
      timeoutMs: number;
    }
  | {
      enabled: false;
      reason: "disabled" | "missing_config";
    };

export type AiModelStoredSettings = {
  enabled: boolean;
  model?: string;
  timeoutMs?: number;
  updatedAt?: string;
};

export type AiModelSettingsUpdateInput = Partial<AiModelStoredSettings>;

export type PublicAiModelSettings = {
  enabled: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  source: "stored" | "environment" | "none";
};

type EnvLike = Record<string, string | undefined>;

const CODEX_PROVIDER = "codex://app-server";
const DEFAULT_CODEX_TIMEOUT_MS = 120_000;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export function resolveAiModelConfig(env: EnvLike = process.env, settings?: AiModelStoredSettings): AiModelConfig {
  if (settings) {
    if (!settings.enabled) {
      return { enabled: false, reason: "disabled" };
    }
    const model = firstNonEmpty(settings.model);
    if (!model) {
      return { enabled: false, reason: "missing_config" };
    }
    return {
      enabled: true,
      baseURL: CODEX_PROVIDER,
      model,
      timeoutMs: positiveInteger(settings.timeoutMs) ?? DEFAULT_CODEX_TIMEOUT_MS
    };
  }

  if (String(env.AI_MODEL_ENABLED ?? "").toLowerCase() !== "true") {
    return { enabled: false, reason: "disabled" };
  }
  const baseURL = normalizeEnvironmentBaseUrl(firstNonEmpty(env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL));
  const apiKey = firstNonEmpty(env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY);
  const model = firstNonEmpty(env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME);
  if (!baseURL || !model || (!apiKey && !isCodexAppServerProvider(baseURL))) {
    return { enabled: false, reason: "missing_config" };
  }
  return withoutUndefined({
    enabled: true,
    baseURL,
    apiKey,
    model,
    timeoutMs: positiveInteger(env.AI_MODEL_TIMEOUT_MS) ?? (isCodexAppServerProvider(baseURL) ? DEFAULT_CODEX_TIMEOUT_MS : DEFAULT_HTTP_TIMEOUT_MS)
  }) as AiModelConfig;
}

export function publicAiModelSettings(env: EnvLike = process.env, settings?: AiModelStoredSettings): PublicAiModelSettings {
  if (settings) {
    return {
      enabled: settings.enabled,
      baseURL: CODEX_PROVIDER,
      model: settings.model ?? "",
      timeoutMs: positiveInteger(settings.timeoutMs) ?? DEFAULT_CODEX_TIMEOUT_MS,
      apiKeyConfigured: false,
      source: "stored"
    };
  }
  const enabled = String(env.AI_MODEL_ENABLED ?? "").toLowerCase() === "true";
  const baseURL = firstNonEmpty(env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL) ?? "";
  const model = firstNonEmpty(env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME) ?? "";
  const apiKeyConfigured = Boolean(firstNonEmpty(env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY));
  return {
    enabled,
    baseURL,
    model,
    timeoutMs: positiveInteger(env.AI_MODEL_TIMEOUT_MS) ?? (isCodexAppServerProvider(baseURL) ? DEFAULT_CODEX_TIMEOUT_MS : DEFAULT_HTTP_TIMEOUT_MS),
    apiKeyConfigured,
    source: enabled || baseURL || model || apiKeyConfigured ? "environment" : "none"
  };
}

export function previewAiModelSettingsUpdate(
  existing: AiModelStoredSettings | undefined,
  input: AiModelSettingsUpdateInput
): AiModelStoredSettings {
  return withoutUndefined({
    enabled: input.enabled ?? existing?.enabled ?? false,
    model: firstNonEmpty(input.model, existing?.model),
    timeoutMs: positiveInteger(input.timeoutMs) ?? positiveInteger(existing?.timeoutMs),
    updatedAt: firstNonEmpty(input.updatedAt, existing?.updatedAt)
  }) as AiModelStoredSettings;
}

export function readAiModelSettingsUpdate(value: unknown): AiModelSettingsUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI settings body must be an object");
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set(["enabled", "model", "timeoutMs"]);
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) {
    throw new Error(`Unknown AI settings field: ${unknown}`);
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    throw new Error("enabled must be boolean");
  }
  if (body.model !== undefined && (typeof body.model !== "string" || !body.model.trim())) {
    throw new Error("model must be a non-empty string");
  }
  if (body.timeoutMs !== undefined && positiveInteger(body.timeoutMs) === undefined) {
    throw new Error("timeoutMs must be a positive integer");
  }
  return withoutUndefined({
    enabled: body.enabled as boolean | undefined,
    model: typeof body.model === "string" ? body.model.trim() : undefined,
    timeoutMs: positiveInteger(body.timeoutMs)
  });
}

function normalizeEnvironmentBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (isCodexAppServerProvider(value)) return CODEX_PROVIDER;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
