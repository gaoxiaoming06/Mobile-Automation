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
  baseURL?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  updatedAt?: string;
};

export type AiModelSettingsUpdateInput = Partial<AiModelStoredSettings> & {
  clearApiKey?: boolean;
};

export type PublicAiModelSettings = {
  enabled: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  source: "stored" | "environment" | "none";
};

type EnvLike = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;

export function resolveAiModelConfig(env: EnvLike = process.env, settings?: AiModelStoredSettings): AiModelConfig {
  if (settings) {
    if (!settings.enabled) {
      return { enabled: false, reason: "disabled" };
    }
    const baseURL = firstNonEmpty(settings.baseURL, env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL);
    const apiKey = firstNonEmpty(settings.apiKey, env.AI_MODEL_API_KEY, env.MIDSCENE_MODEL_API_KEY, env.OPENAI_API_KEY);
    const model = firstNonEmpty(settings.model, env.AI_MODEL_NAME, env.MIDSCENE_MODEL_NAME);
    if (!baseURL || !model || (!apiKey && !isCodexAppServerProvider(baseURL))) {
      return { enabled: false, reason: "missing_config" };
    }
    return withoutUndefined({
      enabled: true,
      baseURL,
      apiKey,
      model,
      timeoutMs: positiveInteger(settings.timeoutMs) ?? positiveInteger(env.AI_MODEL_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
    }) as AiModelConfig;
  }

  if (String(env.AI_MODEL_ENABLED ?? "").toLowerCase() !== "true") {
    return { enabled: false, reason: "disabled" };
  }
  const baseURL = firstNonEmpty(env.AI_MODEL_BASE_URL, env.MIDSCENE_MODEL_BASE_URL);
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
    timeoutMs: positiveInteger(env.AI_MODEL_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS
  }) as AiModelConfig;
}

export function publicAiModelSettings(env: EnvLike = process.env, settings?: AiModelStoredSettings): PublicAiModelSettings {
  if (settings) {
    return {
      enabled: settings.enabled,
      baseURL: settings.baseURL ?? "",
      model: settings.model ?? "",
      timeoutMs: positiveInteger(settings.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
      apiKeyConfigured: Boolean(settings.apiKey?.trim()),
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
    timeoutMs: positiveInteger(env.AI_MODEL_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
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
    baseURL: firstNonEmpty(input.baseURL, existing?.baseURL),
    apiKey: input.clearApiKey ? undefined : firstNonEmpty(input.apiKey, existing?.apiKey),
    model: firstNonEmpty(input.model, existing?.model),
    timeoutMs: positiveInteger(input.timeoutMs) ?? positiveInteger(existing?.timeoutMs),
    updatedAt: firstNonEmpty(input.updatedAt, existing?.updatedAt)
  }) as AiModelStoredSettings;
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
