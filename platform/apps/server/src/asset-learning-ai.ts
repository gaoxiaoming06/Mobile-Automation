export type AssetLearningSample = {
  runId: string;
  artifactId: string;
  ocrTexts: string[];
  imagePngBase64?: string;
};

export type AssetLearningAnalysis = {
  decision: "approve" | "observe" | "reject";
  canonicalName?: string;
  canonicalKey?: string;
  stableTexts: string[];
  dynamicTexts: string[];
  confidence: number;
  reason: string;
  validationIssues: string[];
};

export const ASSET_LEARNING_DEVELOPER_INSTRUCTIONS = [
  "你是移动自动化资产学习助手，只能根据提供的多次成功执行证据提出候选，不能创建或发布正式资产。",
  "稳定页面身份文案必须在每一个样本中逐字出现；昵称、账号、手机号、日期、时间、数量和业务实例名称应视为动态内容。",
  "不要把可能滚出屏幕的操作入口当成页面必要身份；页面身份与页面上的可操作元素必须分开。",
  "不得输出坐标、区域点击、resource-id、accessibility-id、旧元素引用或输入中不存在的证据。",
  "证据不足、样本相似度不足或无法排除页面冲突时返回 observe；确认错误或敏感时返回 reject。",
  "AI 只能提出候选，不得决定发布；最终发布由确定性规则控制。",
  "只返回 JSON 对象，不要输出 Markdown。"
].join("\n");

export function buildAssetLearningPrompt(input: {
  kind: "page" | "interaction" | "navigation";
  stableKey: string;
  payload: Record<string, unknown>;
  samples: AssetLearningSample[];
}): string {
  return [
    `请分析 ${input.kind} 候选。只能提出候选，不得决定发布。`,
    "返回严格 JSON：",
    JSON.stringify({
      decision: "approve | observe | reject",
      canonicalName: "规范名称",
      canonicalKey: "lower-kebab-case",
      stableTexts: ["所有样本都存在的稳定文案"],
      dynamicTexts: ["动态或敏感文案"],
      confidence: 0.95,
      reason: "简短原因"
    }),
    "候选上下文：",
    JSON.stringify({
      stableKey: input.stableKey,
      payload: input.payload,
      samples: input.samples.map(({ runId, artifactId, ocrTexts }) => ({ runId, artifactId, ocrTexts }))
    })
  ].join("\n\n");
}

export function parseAssetLearningResponse(
  raw: string,
  input: { kind: "page" | "interaction" | "navigation"; samples: AssetLearningSample[] }
): AssetLearningAnalysis {
  const root = parseRoot(raw);
  const unknown = Object.keys(root).filter((key) => ![
    "decision",
    "canonicalName",
    "canonicalKey",
    "stableTexts",
    "dynamicTexts",
    "confidence",
    "reason"
  ].includes(key));
  if (unknown.length) throw new Error(`Unknown asset learning field: ${unknown[0]}`);

  const requestedDecision = root.decision === "approve" || root.decision === "reject"
    ? root.decision
    : "observe";
  const validationIssues: string[] = [];
  const stableTexts = stringArray(root.stableTexts).filter((text) => {
    if (isDynamicOrSensitiveText(text)) {
      validationIssues.push(`dynamic_or_sensitive:${text}`);
      return false;
    }
    if (!input.samples.every((sample) => sample.ocrTexts.some((observed) => normalize(observed) === normalize(text)))) {
      validationIssues.push(`not_present_in_every_sample:${text}`);
      return false;
    }
    return true;
  });
  const minimumStableTexts = input.kind === "page" ? 2 : 0;
  const evidenceSufficient = stableTexts.length >= minimumStableTexts;
  const decision = requestedDecision === "approve" && (!evidenceSufficient || validationIssues.length > 0)
    ? "observe"
    : requestedDecision;
  const canonicalKey = optionalString(root.canonicalKey)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    decision,
    ...(optionalString(root.canonicalName) ? { canonicalName: optionalString(root.canonicalName) } : {}),
    ...(canonicalKey ? { canonicalKey } : {}),
    stableTexts: unique(stableTexts),
    dynamicTexts: unique(stringArray(root.dynamicTexts)),
    confidence: clampNumber(root.confidence),
    reason: optionalString(root.reason) ?? "AI did not provide a reason",
    validationIssues
  };
}

function parseRoot(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Asset learning response is not JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Asset learning response must be an object");
  }
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0;
}

function isDynamicOrSensitiveText(value: string): boolean {
  const text = value.trim();
  return !text
    || /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(text)
    || /(?:^|\D)1\d{10}(?:\D|$)/.test(text)
    || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)
    || /^\d+(?:[.,]\d+)?(?:%|人|个|条|次|分钟|小时)?$/.test(text)
    || /(?:password|passwd|secret|token)[-_:：= ]*[A-Za-z0-9]{6,}/i.test(text);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
