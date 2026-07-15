import type { Observation } from "@mobile-automation/graph-core";
import { isCodexAppServerProvider, runAiJsonRequest, type AiClientFetch, type AiJsonResult } from "./ai-client.js";
import type { AiDiagnosisConfig } from "./ai-diagnosis.js";

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
    className?: string;
    resourceIdHint?: string;
    contentDesc?: string;
    text?: string;
    clickable: boolean;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
};

export const AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS = [
  "你是移动端页面资产录入助手。根据当前页面证据，生成 PageStateFlow 页面资产草稿建议，供人工确认后入库。",
  "页面身份规则：只允许稳定业务文案（identityOcrTexts）和截图区域（identityRegions）作为身份；禁止状态栏内容（时间、电量、网速）、动态业务数据（数量、昵称、日期）、底部通用 Tab、resource-id、activity、包名进入身份建议。",
  "identityOcrTexts 的 text 必须逐字来自证据 ocrTexts，不得改写或臆造。",
  "identityRegions 用百分比矩形（x/y/width/height 均为 0-100），semanticArea 只能取 top/content/bottom/unknown；优先标题栏和页面主体稳定区域。",
  "elements 描述页面可操作能力入口：elementLabel 用简洁中文；abilityType 取 fixed_tap/scroll_candidate/grid_candidate/conditional_tap；动态列表或网格必须用 grid_candidate 并给整个容器区域，禁止给单个列表项。",
  "locator 只允许 image-region:x,y,w,h 百分比格式；禁止任何像素坐标、resource-id、xpath。",
  "每项都给 confidence（0-1）；不确定或有风险的项写入 riskNotes。",
  "必须只返回一个 JSON 对象，不要输出 markdown 代码块或解释文字。"
].join("\n");

const OUTPUT_SCHEMA_EXAMPLE = `{
  "page": { "name": "肿瘤百科", "key": "encyclopedia", "assetKind": "page", "confidence": 0.9, "riskNotes": [] },
  "identityOcrTexts": [ { "text": "鲸放肿瘤百科", "confidence": 0.95, "reason": "页面标题，稳定" } ],
  "identityRegions": [ { "id": "title-bar", "label": "标题区", "x": 5, "y": 10.5, "width": 88, "height": 5.5, "semanticArea": "top", "confidence": 0.9, "reason": "品牌标题，跨账号稳定" } ],
  "elements": [ { "elementLabel": "搜索入口", "targetText": "搜索", "abilityType": "fixed_tap", "actionKind": "tap", "locator": "image-region:4,18,92,6", "semanticArea": "top", "confidence": 0.85, "riskNotes": [] } ]
}`;

export function buildPageDraftEvidence(observation: Observation): AiPageDraftEvidence {
  const resolution = observation.resolution;
  const ocrTexts = observation.ocrTexts
    .filter((item) => item.text?.trim())
    .slice(0, AI_PAGE_DRAFT_MAX_OCR_TEXTS)
    .map((item) => ({
      text: item.text.trim(),
      confidence: item.confidence,
      region: toPercentRect(item.region, resolution)
    }));
  const uiElements = observation.uiElements
    .filter((item) => item.clickable === true || Boolean(item.text?.trim()) || Boolean(item.contentDesc?.trim()))
    .slice(0, AI_PAGE_DRAFT_MAX_UI_ELEMENTS)
    .map((item) => ({
      className: item.className,
      resourceIdHint: item.resourceId,
      contentDesc: item.contentDesc,
      text: item.text,
      clickable: item.clickable === true,
      bounds: toPercentRect(item.bounds, resolution)
    }));
  return {
    platform: observation.platform,
    packageName: observation.packageName,
    activityName: observation.activityName,
    resolution,
    ocrTexts,
    uiElements
  };
}

export function buildPageDraftPrompt(evidence: AiPageDraftEvidence): string {
  return [
    "请根据以下页面证据生成页面资产草稿建议。",
    "",
    "【输出 JSON Schema 示例（字段名必须完全一致）】",
    OUTPUT_SCHEMA_EXAMPLE,
    "",
    "字段说明：",
    "- page.key：小写 slug，可用点或中划线分隔，不含包名。",
    "- page.assetKind：整页用 page，弹层/浮层用 overlay。",
    "- identityOcrTexts：页面身份文案，必须逐字来自证据 ocrTexts。",
    "- identityRegions：页面身份截图区域（百分比矩形）。",
    "- elements：页面可操作能力入口，locator 用 image-region:x,y,w,h 百分比格式。",
    "",
    "【页面证据】",
    JSON.stringify(evidence)
  ].join("\n");
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

export type AiPageDraftElementSuggestion = {
  elementLabel: string;
  targetText?: string;
  abilityType: "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap";
  actionKind: "tap" | "scroll" | "long_press" | "input";
  locator: string;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  confidence?: number;
  riskNotes: string[];
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
  elements: AiPageDraftElementSuggestion[];
};

const DYNAMIC_TEXT_PATTERN = /^(\d{1,2}:\d{2}(:\d{2})?|[\d.,]+\s*(KB|MB|GB)\/s|[\d.,]+%?|\d+)$/i;
const IMAGE_REGION_LOCATOR_PATTERN = /^image-region:\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?$/;
const ABILITY_TYPES = new Set(["fixed_tap", "scroll_candidate", "grid_candidate", "conditional_tap"]);
const ACTION_KINDS = new Set(["tap", "scroll", "long_press", "input"]);
const SEMANTIC_AREAS = new Set(["top", "content", "bottom", "unknown"]);

export function parseAiPageDraftResponse(raw: string, observation: Observation): { suggestion: AiPageDraftSuggestion; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new Error("AI 页面草稿输出不是合法 JSON");
  }
  const root = asRecord(parsed);
  const warnings: string[] = [];

  const pageRecord = asRecord(root.page);
  const name = readNonEmptyString(pageRecord.name);
  const rawKey = readNonEmptyString(pageRecord.key);
  if (!name || !rawKey) {
    throw new Error("AI 页面草稿缺少 page.name 或 page.key");
  }
  let assetKind: "page" | "overlay";
  if (pageRecord.assetKind === "page" || pageRecord.assetKind === "overlay") {
    assetKind = pageRecord.assetKind;
  } else {
    assetKind = "page";
    warnings.push(`assetKind "${String(pageRecord.assetKind)}" 不合法，已回退为 page`);
  }
  const page = {
    name,
    key: rawKey.toLowerCase().replace(/\s+/g, "-"),
    assetKind,
    confidence: readNumber(pageRecord.confidence),
    riskNotes: readStringArray(pageRecord.riskNotes)
  };

  const evidenceTexts = new Set(observation.ocrTexts.map((item) => item.text.trim()).filter(Boolean));
  const identityOcrTexts: AiPageDraftSuggestion["identityOcrTexts"] = [];
  for (const item of readArray(root.identityOcrTexts)) {
    const record = asRecord(item);
    const text = readNonEmptyString(record.text);
    if (!text) {
      continue;
    }
    if (!evidenceTexts.has(text)) {
      warnings.push(`AI 建议的身份文案在 OCR 证据中不存在：${text}`);
      continue;
    }
    if (DYNAMIC_TEXT_PATTERN.test(text)) {
      warnings.push(`身份文案疑似动态内容（时间/数字/网速），已剔除：${text}`);
      continue;
    }
    identityOcrTexts.push({ text, confidence: readNumber(record.confidence), reason: readNonEmptyString(record.reason) });
  }

  const identityRegions: AiPageDraftRegionSuggestion[] = [];
  for (const [index, item] of readArray(root.identityRegions).entries()) {
    const record = asRecord(item);
    const label = readNonEmptyString(record.label) ?? `AI 区域 ${index + 1}`;
    const x = clamp(readNumber(record.x) ?? Number.NaN, 0, 100);
    const y = clamp(readNumber(record.y) ?? Number.NaN, 0, 100);
    const width = clamp(readNumber(record.width) ?? Number.NaN, 0, 100 - (Number.isNaN(x) ? 0 : x));
    const height = clamp(readNumber(record.height) ?? Number.NaN, 0, 100 - (Number.isNaN(y) ? 0 : y));
    if ([x, y, width, height].some(Number.isNaN) || width < 1 || height < 1) {
      warnings.push(`身份区域不合法或面积过小，已剔除：${label}`);
      continue;
    }
    const semanticArea = SEMANTIC_AREAS.has(String(record.semanticArea)) ? record.semanticArea as AiPageDraftRegionSuggestion["semanticArea"] : "unknown";
    identityRegions.push({
      id: readNonEmptyString(record.id) ?? `region-${index + 1}`,
      label,
      x,
      y,
      width,
      height,
      semanticArea,
      confidence: readNumber(record.confidence),
      reason: readNonEmptyString(record.reason)
    });
  }

  const elements: AiPageDraftElementSuggestion[] = [];
  for (const item of readArray(root.elements)) {
    const record = asRecord(item);
    const elementLabel = readNonEmptyString(record.elementLabel);
    if (!elementLabel) {
      continue;
    }
    const locator = readNonEmptyString(record.locator) ?? "";
    if (!IMAGE_REGION_LOCATOR_PATTERN.test(locator)) {
      warnings.push(`元素定位格式不合法（需 image-region:x,y,w,h 百分比），已剔除：${elementLabel}`);
      continue;
    }
    if (!ABILITY_TYPES.has(String(record.abilityType)) || !ACTION_KINDS.has(String(record.actionKind))) {
      warnings.push(`元素能力类型或动作不合法，已剔除：${elementLabel}`);
      continue;
    }
    elements.push({
      elementLabel,
      targetText: readNonEmptyString(record.targetText),
      abilityType: record.abilityType as AiPageDraftElementSuggestion["abilityType"],
      actionKind: record.actionKind as AiPageDraftElementSuggestion["actionKind"],
      locator,
      semanticArea: SEMANTIC_AREAS.has(String(record.semanticArea)) ? record.semanticArea as AiPageDraftElementSuggestion["semanticArea"] : undefined,
      confidence: readNumber(record.confidence),
      riskNotes: readStringArray(record.riskNotes)
    });
  }

  return { suggestion: { page, identityOcrTexts, identityRegions, elements }, warnings };
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

export async function generateAiPageDraft(input: { config: AiDiagnosisConfig; observation: Observation; fetchImpl?: AiClientFetch }): Promise<AiPageDraftResult> {
  if (!input.config.enabled) {
    throw new AiPageDraftError("not_configured", `AI 未启用（${input.config.reason}），请在 设置-AI 诊断 中配置模型`);
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

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  if (start < 0) {
    throw new Error("输出中不包含 JSON 对象");
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }
  throw new Error("输出中的 JSON 对象不完整");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return Number.NaN;
  }
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function toPercentRect(
  rect: { x: number; y: number; width: number; height: number } | undefined,
  resolution: { width: number; height: number } | undefined
): { x: number; y: number; width: number; height: number } | undefined {
  if (!rect || !resolution || resolution.width <= 0 || resolution.height <= 0) {
    return undefined;
  }
  return {
    x: toPercent(rect.x, resolution.width),
    y: toPercent(rect.y, resolution.height),
    width: toPercent(rect.width, resolution.width),
    height: toPercent(rect.height, resolution.height)
  };
}

function toPercent(value: number, total: number): number {
  return Math.round((value / total) * 10000) / 100;
}
