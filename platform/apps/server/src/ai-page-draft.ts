import type { Observation } from "@mobile-automation/graph-core";

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
