import type { Observation } from "@mobile-automation/graph-core";
import type { ScreenUnderstandingCandidate, ScreenUnderstandingContext } from "@mobile-automation/shared";
import { runAiJsonRequest, type AiClientFetch } from "./ai-client.js";
import type { AiModelConfig } from "./ai-model-settings.js";
import type { PageAssetPlatform } from "./page-asset-catalog.js";
import { buildScreenEvidence, sanitizeScreenUnderstandingCandidate } from "./script-flow-screen-context.js";

export const SCREEN_UNDERSTANDING_INSTRUCTIONS = [
  "你只负责理解当前移动端截图，输出候选屏幕模型，不生成 ScriptFlow，不操作设备，不沉淀资产。",
  "禁止输出坐标、bounds、resource-id、accessibility-id、XPath、selector 或截图区域。",
  "把按钮标题、区域标题、字段标签标为 stableLabel；把姓名、账号、手机号、邮箱、日期、数量、预填值标为 dynamicValue 或 sensitiveValue。",
  "预填输入框没有标签时，可以用 scopeText + ordinal 表达，例如课堂信息区域第 1 个 textField。",
  "只返回唯一 JSON 对象，不要 Markdown、代码围栏或解释。"
].join("\n");

export async function understandScreenForScriptFlow(input: {
  config: AiModelConfig;
  prompt: string;
  appId: string;
  platform: PageAssetPlatform;
  observation: Observation;
  fetchImpl?: AiClientFetch;
}): Promise<ScreenUnderstandingContext> {
  if (!input.config.enabled) {
    throw new Error(input.config.reason === "missing_config" ? "AI 配置不完整" : "AI 生成未启用");
  }
  const evidence = buildScreenEvidence(input.observation);
  const result = await runAiJsonRequest({
    baseURL: input.config.baseURL,
    apiKey: input.config.apiKey,
    model: input.config.model,
    timeoutMs: input.config.timeoutMs
  }, {
    developerInstructions: SCREEN_UNDERSTANDING_INSTRUCTIONS,
    userContent: buildScreenUnderstandingPrompt(input, evidence.promptEvidence),
    imagePngBase64: evidence.imagePngBase64,
    effort: "low"
  }, input.fetchImpl);

  return sanitizeScreenUnderstandingCandidate({
    observationId: input.observation.id ?? "observation-current-screen",
    visionUsed: result.visionUsed,
    candidate: parseScreenUnderstandingJson(result.content)
  });
}

function buildScreenUnderstandingPrompt(
  input: {
    prompt: string;
    appId: string;
    platform: PageAssetPlatform;
  },
  promptEvidence: unknown
): string {
  return JSON.stringify({
    prompt: input.prompt,
    appId: input.appId,
    platform: input.platform,
    evidence: promptEvidence,
    output: {
      page: { key: "known page key if confident", name: "visible page name", confidence: 0 },
      visibleStableTexts: ["stable UI labels only"],
      dynamicTexts: [{ text: "dynamic visible value", reason: "name" }],
      controlCandidates: [{
        candidateId: "stable temporary id",
        control: "textField",
        semanticName: "lessonName",
        scopeText: "课堂信息",
        ordinal: 1,
        currentValue: "visible current value",
        valueKind: "dynamicValue",
        confidence: 0,
        assetEligible: false
      }],
      warnings: []
    }
  }, null, 2);
}

function parseScreenUnderstandingJson(raw: string): ScreenUnderstandingCandidate {
  const value = parseJsonObject(raw);
  const root = recordValue(value, "$");
  const page = recordValue(root.page, "page");
  const visibleStableTexts = stringArray(root.visibleStableTexts);
  const dynamicTexts = Array.isArray(root.dynamicTexts)
    ? root.dynamicTexts.map((item) => {
        const dynamic = recordValue(item, "dynamicTexts[]");
        return {
          text: stringValue(dynamic.text),
          reason: dynamicReason(dynamic.reason)
        };
      }).filter((item) => item.text)
    : [];
  const controlCandidates = Array.isArray(root.controlCandidates)
    ? root.controlCandidates.map((item) => controlCandidate(recordValue(item, "controlCandidates[]")))
    : [];
  return {
    page: {
      ...(stringValue(page.key) ? { key: stringValue(page.key) } : {}),
      ...(stringValue(page.name) ? { name: stringValue(page.name) } : {}),
      confidence: numberValue(page.confidence)
    },
    visibleStableTexts,
    dynamicTexts,
    controlCandidates,
    warnings: stringArray(root.warnings)
  };
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const candidates = [trimmed];
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/giu)];
  if (fenced.length === 1 && fenced[0]?.[1]) {
    candidates.push(fenced[0][1].trim());
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next representation before failing.
    }
  }
  throw new Error("AI 屏幕理解结果不是有效 JSON");
}

function controlCandidate(record: Record<string, unknown>): ScreenUnderstandingCandidate["controlCandidates"][number] {
  return {
    candidateId: stringValue(record.candidateId) || "screen-control",
    control: controlValue(record.control),
    ...(stringValue(record.semanticName) ? { semanticName: stringValue(record.semanticName) } : {}),
    ...(stringValue(record.text) ? { text: stringValue(record.text) } : {}),
    ...(stringValue(record.scopeText) ? { scopeText: stringValue(record.scopeText) } : {}),
    ...(stringValue(record.nearText) ? { nearText: stringValue(record.nearText) } : {}),
    ...(numberValue(record.ordinal) ? { ordinal: numberValue(record.ordinal) } : {}),
    ...(stringValue(record.currentValue) ? { currentValue: stringValue(record.currentValue) } : {}),
    ...(valueKind(record.valueKind) ? { valueKind: valueKind(record.valueKind) } : {}),
    confidence: numberValue(record.confidence),
    assetEligible: record.assetEligible === true,
    ...copyForbiddenCandidateFields(record)
  };
}

function copyForbiddenCandidateFields(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["bounds", "region", "resourceId", "accessibilityId", "screenshotBase64", "coordinate", "coordinates", "x", "y"]) {
    if (record[key] !== undefined) {
      result[key] = record[key];
    }
  }
  return result;
}

function recordValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function controlValue(value: unknown): ScreenUnderstandingCandidate["controlCandidates"][number]["control"] {
  return value === "button" || value === "textField" || value === "checkbox" || value === "switch" || value === "select" || value === "text"
    ? value
    : "text";
}

function dynamicReason(value: unknown): ScreenUnderstandingCandidate["dynamicTexts"][number]["reason"] {
  return value === "account" || value === "phone" || value === "email" || value === "name" || value === "date" || value === "time" || value === "number" || value === "unknown_dynamic"
    ? value
    : "unknown_dynamic";
}

function valueKind(value: unknown): ScreenUnderstandingCandidate["controlCandidates"][number]["valueKind"] | undefined {
  return value === "stableLabel" || value === "dynamicValue" || value === "sensitiveValue" || value === "unknown" ? value : undefined;
}
