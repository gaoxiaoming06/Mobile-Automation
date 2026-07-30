import type { Observation } from "@mobile-automation/graph-core";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch, type AiJsonResult } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";

export const AI_PAGE_DRAFT_MAX_OCR_TEXTS = 120;
export const AI_PAGE_DRAFT_MAX_UI_ELEMENTS = 80;

export type AiPageDraftEvidence = {
  platform: string;
  packageName?: string;
  activityName?: string;
  resolution?: { width: number; height: number };
  ocrTexts: Array<{
    text: string;
    confidence?: number;
    region?: { x: number; y: number; width: number; height: number };
  }>;
  uiElements: Array<{
    contentDesc?: string;
    text?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
};

export const AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS = [
  "你是移动端页面身份录入助手。只根据当前页面证据生成页面名称、稳定身份文案和截图重点区域，不生成动作或元素定位器。",
  "页面身份只能使用稳定业务文案和截图区域；禁止状态栏内容、动态数量、昵称、日期、底部通用 Tab、resource-id、activity 和包名作为身份。",
  "identityOcrTexts.text 必须逐字来自输入的 ocrTexts，不得改写或臆造。",
  "identityRegions 使用屏幕百分比矩形，x、y、width、height 均为 0-100；semanticArea 只能是 top、content、bottom 或 unknown。",
  "禁止输出 elements、actions、locators、坐标点击、元素资产或任何执行步骤。",
  "证据不足时降低 confidence 并写入 riskNotes，不要编造身份依据。",
  "只返回一个 JSON 对象，不要输出 markdown 或解释文字。"
].join("\n");

const OUTPUT_SCHEMA_EXAMPLE = {
  page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", confidence: 0.9, riskNotes: [] },
  identityOcrTexts: [{ text: "鲸放肿瘤百科", confidence: 0.95, reason: "稳定页面标题" }],
  identityRegions: [{ id: "title-bar", label: "标题区", x: 5, y: 10.5, width: 88, height: 5.5, semanticArea: "top", confidence: 0.9, reason: "稳定标题区域" }]
};

export function buildPageDraftEvidence(observation: Observation): AiPageDraftEvidence {
  const resolution = observation.resolution;
  return {
    platform: observation.platform,
    packageName: observation.packageName,
    activityName: observation.activityName,
    resolution,
    ocrTexts: observation.ocrTexts
      .filter((item) => item.text?.trim())
      .slice(0, AI_PAGE_DRAFT_MAX_OCR_TEXTS)
      .map((item) => ({
        text: item.text.trim(),
        confidence: item.confidence,
        region: toPercentRect(item.region, resolution)
      })),
    uiElements: observation.uiElements
      .filter((item) => Boolean(item.text?.trim()) || Boolean(item.contentDesc?.trim()))
      .slice(0, AI_PAGE_DRAFT_MAX_UI_ELEMENTS)
      .map((item) => ({
        contentDesc: item.contentDesc,
        text: item.text,
        bounds: toPercentRect(item.bounds, resolution)
      }))
  };
}

export function buildPageDraftPrompt(evidence: AiPageDraftEvidence): string {
  return [
    "请根据页面证据生成页面身份草稿。",
    "输出字段必须严格符合以下 JSON 结构：",
    JSON.stringify(OUTPUT_SCHEMA_EXAMPLE, null, 2),
    "不得输出示例以外的字段。",
    "页面证据：",
    JSON.stringify(evidence)
  ].join("\n\n");
}

export type AiPageDraftRegionSuggestion = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  semanticArea: "top" | "content" | "bottom" | "unknown";
  confidence?: number;
  reason?: string;
};

export type AiPageDraftSuggestion = {
  page: {
    name: string;
    key: string;
    assetKind: "page" | "overlay";
    confidence?: number;
    riskNotes: string[];
  };
  identityOcrTexts: Array<{ text: string; confidence?: number; reason?: string }>;
  identityRegions: AiPageDraftRegionSuggestion[];
};

const dynamicTextPattern = /^(\d{1,2}:\d{2}(:\d{2})?|[\d.,]+\s*(KB|MB|GB)\/s|[\d.,]+%?|\d+)$/i;
const semanticAreas = new Set(["top", "content", "bottom", "unknown"]);

export function parseAiPageDraftResponse(raw: string, observation: Observation): { suggestion: AiPageDraftSuggestion; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("AI 页面身份草稿不是合法 JSON");
  }
  const root = record(parsed, "$");
  rejectUnknownFields(root, ["page", "identityOcrTexts", "identityRegions"], "$" );
  const warnings: string[] = [];

  const pageValue = record(root.page, "page");
  rejectUnknownFields(pageValue, ["name", "key", "assetKind", "confidence", "riskNotes"], "page");
  const name = requiredString(pageValue.name, "page.name");
  const key = requiredString(pageValue.key, "page.key").toLowerCase().replace(/\s+/g, "-");
  const assetKind = pageValue.assetKind === "overlay" ? "overlay" : "page";
  if (pageValue.assetKind !== undefined && pageValue.assetKind !== "page" && pageValue.assetKind !== "overlay") {
    warnings.push(`assetKind "${String(pageValue.assetKind)}" 不合法，已回退为 page`);
  }

  const evidenceTexts = new Set(observation.ocrTexts.map((item) => item.text.trim()).filter(Boolean));
  const identityOcrTexts: AiPageDraftSuggestion["identityOcrTexts"] = [];
  for (const [index, item] of array(root.identityOcrTexts).entries()) {
    const value = record(item, `identityOcrTexts[${index}]`);
    rejectUnknownFields(value, ["text", "confidence", "reason"], `identityOcrTexts[${index}]`);
    const text = requiredString(value.text, `identityOcrTexts[${index}].text`);
    if (!evidenceTexts.has(text)) {
      warnings.push(`AI 建议的身份文案在 OCR 证据中不存在：${text}`);
      continue;
    }
    if (dynamicTextPattern.test(text)) {
      warnings.push(`身份文案疑似动态内容，已剔除：${text}`);
      continue;
    }
    identityOcrTexts.push({
      text,
      ...optionalNumber(value.confidence, "confidence"),
      ...optionalString(value.reason, "reason")
    });
  }

  const identityRegions: AiPageDraftRegionSuggestion[] = [];
  for (const [index, item] of array(root.identityRegions).entries()) {
    const path = `identityRegions[${index}]`;
    const value = record(item, path);
    rejectUnknownFields(value, ["id", "label", "x", "y", "width", "height", "semanticArea", "confidence", "reason"], path);
    const x = clampedNumber(value.x, 0, 100);
    const y = clampedNumber(value.y, 0, 100);
    const width = clampedNumber(value.width, 0, 100 - x);
    const height = clampedNumber(value.height, 0, 100 - y);
    const label = optionalString(value.label, "label").label ?? `AI 区域 ${index + 1}`;
    if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) {
      warnings.push(`身份区域不合法或面积过小，已剔除：${label}`);
      continue;
    }
    const semanticArea = semanticAreas.has(String(value.semanticArea))
      ? value.semanticArea as AiPageDraftRegionSuggestion["semanticArea"]
      : "unknown";
    identityRegions.push({
      id: optionalString(value.id, "id").id ?? `region-${index + 1}`,
      label,
      x,
      y,
      width,
      height,
      semanticArea,
      ...optionalNumber(value.confidence, "confidence"),
      ...optionalString(value.reason, "reason")
    });
  }

  return {
    suggestion: {
      page: {
        name,
        key,
        assetKind,
        ...optionalNumber(pageValue.confidence, "confidence"),
        riskNotes: stringArray(pageValue.riskNotes)
      },
      identityOcrTexts,
      identityRegions
    },
    warnings
  };
}

export class AiPageDraftError extends Error {
  constructor(
    public readonly code: "not_configured" | "invalid_response" | "timeout" | "llm_failed",
    message: string
  ) {
    super(message);
    this.name = "AiPageDraftError";
  }
}

export type AiPageDraftResult = {
  suggestion: AiPageDraftSuggestion;
  warnings: string[];
  channel: "codex" | "openai-compatible";
  visionUsed: boolean;
};

export async function generateAiPageDraft(input: { config: AiModelConfig; observation: Observation; fetchImpl?: AiClientFetch }): Promise<AiPageDraftResult> {
  if (!input.config.enabled) {
    throw new AiPageDraftError("not_configured", `AI 未启用（${input.config.reason}），请在“系统设置 > AI 模型”中配置`);
  }
  const evidence = buildPageDraftEvidence(input.observation);
  const prompt = buildPageDraftPrompt(evidence);
  const rawScreenshot = input.observation.raw?.screenshotBase64;
  const imagePngBase64 = typeof rawScreenshot === "string" && rawScreenshot ? rawScreenshot : undefined;
  const channel = isCodexAppServerProvider(input.config.baseURL) ? "codex" as const : "openai-compatible" as const;
  let result: AiJsonResult;
  try {
    result = await runAiJsonRequest(
      { baseURL: input.config.baseURL, apiKey: input.config.apiKey, model: input.config.model, timeoutMs: input.config.timeoutMs },
      { developerInstructions: AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS, userContent: prompt, imagePngBase64 },
      input.fetchImpl ?? fetch
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiPageDraftError(/abort|timed? ?out/i.test(message) ? "timeout" : "llm_failed", message);
  }
  try {
    const { suggestion, warnings } = parseAiPageDraftResponse(result.content, input.observation);
    return { suggestion, warnings, channel, visionUsed: result.visionUsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiPageDraftError("invalid_response", `${message}；原始输出前 200 字：${result.content.slice(0, 200)}`);
  }
}

function toPercentRect(
  region: { x: number; y: number; width: number; height: number } | undefined,
  resolution: { width: number; height: number } | undefined
): { x: number; y: number; width: number; height: number } | undefined {
  if (!region || !resolution?.width || !resolution.height) return undefined;
  return {
    x: roundTwo((region.x / resolution.width) * 100),
    y: roundTwo((region.y / resolution.height) * 100),
    width: roundTwo((region.width / resolution.width) * 100),
    height: roundTwo((region.height / resolution.height) * 100)
  };
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("输出中不包含 JSON 对象");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  throw new Error("JSON 对象没有闭合");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [];
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unknown.length) throw new Error(`${path}.${unknown[0]} 是未知字段`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} 必须是非空字符串`);
  return value.trim();
}

function optionalString<K extends string>(value: unknown, key: K): Partial<Record<K, string>> {
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } as Record<K, string> : {};
}

function optionalNumber<K extends string>(value: unknown, key: K): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as Record<K, number> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function clampedNumber(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return Number.NaN;
  return roundTwo(Math.max(min, Math.min(max, value)));
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
