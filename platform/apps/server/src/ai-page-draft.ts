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
    className?: string;
    resourceIdHint?: string;
    contentDesc?: string;
    text?: string;
    clickable: boolean;
    bounds?: { x: number; y: number; width: number; height: number };
  }>;
};

export const AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS = [
  "你是移动端页面资产录入助手。根据当前页面证据，生成页面身份和公共定位器草稿，供人工确认后入库。",
  "页面身份规则：只允许稳定业务文案（identityOcrTexts）和截图区域（identityRegions）作为身份；禁止状态栏内容（时间、电量、网速）、动态业务数据（数量、昵称、日期）、底部通用 Tab、resource-id、activity、包名进入身份建议。",
  "identityOcrTexts 的 text 必须逐字来自证据 ocrTexts，不得改写或臆造。",
  "identityRegions 用百分比矩形（x/y/width/height 均为 0-100），semanticArea 只能取 top/content/bottom/unknown；优先标题栏和页面主体稳定区域。",
  "elements 描述可跨脚本复用的公共定位器：elementLabel 用简洁中文，只描述如何找到目标，不描述点击、输入或跳转动作。",
  "每个元素必须选择 locatorKind（定位策略），按以下决策树判断：",
  "1. text_locator：文字按钮、菜单项、带稳定文字的入口。给 targetText（必须逐字来自证据 ocrTexts）。不需要 region。",
  "2. top_bar_icon_locator：顶部栏无文字图标（搜索/添加/更多/关闭/头像等）。给 role（search/add/more/close/back/avatar/settings/share/scan/message 等小写英文）、slot（left/right）、orderFromRight（从右数第几个，1 起）、region（图标所在小区域百分比矩形，必须在页面顶部）。",
  "3. collection_item_locator：动态列表/网格/消息列表。region 给整个列表容器区域，禁止圈单个列表项；给 scroll.direction（vertical/horizontal）和 scroll.containerKind（list/grid_list/carousel/scroll_area）。禁止输出 candidateIndex、第几行第几列等固定位置。",
  "4. structural_locator：行尾开关用 structuralStrategy=ocr_trailing_switch，行首复选框用 structuralStrategy=near_text_checkbox；必须给 anchorText（该行稳定文字，逐字来自证据）和 region（整行区域）。禁止编造其它 strategy。",
  "5. ocr_anchor_offset：目标本身无稳定文字、但与某稳定文字有固定相对位置（如文字右侧小图标）。给 anchorText（逐字来自证据）、anchorOffsetPercent（{x,y} 相对屏幕宽高的有符号百分比偏移）、region（目标所在参考区域）。",
  "6. visual_locator：以上都不适用的纯视觉元素。给 region（参考区域百分比矩形）；region 内含头像/封面/数字等动态内容时给 dynamicMasks（[{kind: avatar/text/image/number, region, reason}]）。",
  "region 一律用百分比矩形（x/y/width/height 0-100），是重定位参考区域，不是固定点击坐标。禁止像素坐标、resource-id、xpath。",
  "证据不足时宁可给低 confidence 并写 riskNotes，不要编造 region 或文案。",
  "每项都给 confidence（0-1）；不确定或有风险的项写入 riskNotes。",
  "必须只返回一个 JSON 对象，不要输出 markdown 代码块或解释文字。"
].join("\n");

const OUTPUT_SCHEMA_EXAMPLE = `{
  "page": { "name": "肿瘤百科", "key": "encyclopedia", "assetKind": "page", "confidence": 0.9, "riskNotes": [] },
  "identityOcrTexts": [ { "text": "鲸放肿瘤百科", "confidence": 0.95, "reason": "页面标题，稳定" } ],
  "identityRegions": [ { "id": "title-bar", "label": "标题区", "x": 5, "y": 10.5, "width": 88, "height": 5.5, "semanticArea": "top", "confidence": 0.9, "reason": "品牌标题，跨账号稳定" } ],
  "elements": [
    { "elementLabel": "免费咨询", "locatorKind": "text_locator", "targetText": "免费咨询", "semanticArea": "content", "confidence": 0.9, "riskNotes": [] },
    { "elementLabel": "搜索图标", "locatorKind": "top_bar_icon_locator", "role": "search", "slot": "right", "orderFromRight": 1, "region": { "x": 86, "y": 4.5, "width": 8, "height": 4 }, "confidence": 0.8, "riskNotes": [] },
    { "elementLabel": "医生列表", "locatorKind": "collection_item_locator", "region": { "x": 2, "y": 30, "width": 96, "height": 55 }, "scroll": { "direction": "vertical", "containerKind": "list" }, "semanticArea": "content", "confidence": 0.85, "riskNotes": [] },
    { "elementLabel": "消息免打扰开关", "locatorKind": "structural_locator", "structuralStrategy": "ocr_trailing_switch", "anchorText": "消息免打扰", "region": { "x": 4, "y": 42, "width": 92, "height": 6 }, "semanticArea": "content", "confidence": 0.8, "riskNotes": [] },
    { "elementLabel": "会员中心右侧箭头", "locatorKind": "ocr_anchor_offset", "anchorText": "会员中心", "anchorOffsetPercent": { "x": 38, "y": 0 }, "region": { "x": 88, "y": 20, "width": 8, "height": 5 }, "semanticArea": "content", "confidence": 0.75, "riskNotes": [] },
    { "elementLabel": "活动横幅", "locatorKind": "visual_locator", "region": { "x": 4, "y": 12, "width": 92, "height": 12 }, "dynamicMasks": [ { "kind": "image", "region": { "x": 4, "y": 12, "width": 30, "height": 12 }, "reason": "活动图轮换" } ], "semanticArea": "content", "confidence": 0.6, "riskNotes": ["横幅内容会随运营活动变化"] }
  ]
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
    "- elements：公共定位器候选，每项按决策树给 locatorKind 与该策略的专属字段；region 是百分比参考区域。",
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

export type AiPageDraftLocatorKind =
  | "text_locator"
  | "visual_locator"
  | "structural_locator"
  | "collection_item_locator"
  | "top_bar_icon_locator"
  | "ocr_anchor_offset";

export type AiPageDraftRect = { x: number; y: number; width: number; height: number };

export type AiPageDraftElementSuggestion = {
  elementLabel: string;
  targetText?: string;
  locatorKind: AiPageDraftLocatorKind;
  /** 服务端按 locatorKind 生成的规范 locator（text:/top-bar-icon:/image-region:）；needsManualCompletion 时为空串 */
  locator: string;
  coordinateSpace: "screen" | "runtime";
  region?: AiPageDraftRect;
  semanticArea?: "top" | "content" | "bottom" | "unknown";
  confidence?: number;
  riskNotes: string[];
  structuralLocator?: Record<string, unknown>;
  visualLocator?: Record<string, unknown>;
  anchorText?: string;
  anchorOffsetPercent?: { x: number; y: number };
  scrollProfile?: {
    containerKind: "list" | "grid_list" | "tab_bar" | "carousel" | "scroll_area";
    direction: "vertical" | "horizontal";
    targetKind: "ocr_text";
    targetQuery: string;
  };
  dynamicRegion?: Record<string, unknown>;
  itemTemplate?: Record<string, unknown>;
  transitionKind?: "parameterized";
  parameterMapping?: Record<string, string>;
  dynamicMasks?: Array<{ kind: "avatar" | "text" | "image" | "number" | "custom"; label?: string; region: AiPageDraftRect; reason?: string }>;
  /** 结构化证据不足且无可靠视觉参考时置真：保留建议但禁止直接保存，等待人工补充 */
  needsManualCompletion?: boolean;
  completionReason?: string;
  /** 结构化校验失败但有可靠 region 时降级为 visual_locator，记录原策略 */
  degradedFrom?: AiPageDraftLocatorKind;
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

  const evidenceTextCounts = new Map<string, number>();
  for (const item of observation.ocrTexts) {
    const text = item.text?.trim();
    if (text) {
      evidenceTextCounts.set(text, (evidenceTextCounts.get(text) ?? 0) + 1);
    }
  }
  const elements: AiPageDraftElementSuggestion[] = [];
  for (const item of readArray(root.elements)) {
    const element = sanitizeElementSuggestion(asRecord(item), evidenceTextCounts, warnings);
    if (element) {
      elements.push(element);
    }
  }

  return { suggestion: { page, identityOcrTexts, identityRegions, elements }, warnings };
}

type SanitizedElementBase = {
  elementLabel: string;
  semanticArea?: AiPageDraftElementSuggestion["semanticArea"];
  confidence?: number;
  riskNotes: string[];
  region?: AiPageDraftRect;
};

function sanitizeElementSuggestion(
  record: Record<string, unknown>,
  evidenceTextCounts: Map<string, number>,
  warnings: string[]
): AiPageDraftElementSuggestion | undefined {
  const elementLabel = readNonEmptyString(record.elementLabel);
  if (!elementLabel) {
    return undefined;
  }
  const region = readElementRegion(record.region);
  const locatorKind = readAiLocatorKind(record.locatorKind) ?? (region ? "visual_locator" : undefined);
  const base: SanitizedElementBase = {
    elementLabel,
    semanticArea: SEMANTIC_AREAS.has(String(record.semanticArea)) ? record.semanticArea as AiPageDraftElementSuggestion["semanticArea"] : undefined,
    confidence: readNumber(record.confidence),
    riskNotes: readStringArray(record.riskNotes),
    region
  };
  if (!locatorKind) {
    warnings.push(`元素缺少 locatorKind 且无参考区域，标记为待人工补充：${elementLabel}`);
    return manualCompletionElement(base, "visual_locator", "AI 未给出定位策略，也没有可用的参考区域，请人工选择策略并圈选。");
  }
  switch (locatorKind) {
    case "text_locator":
      return sanitizeTextLocatorElement(base, record, evidenceTextCounts, warnings);
    case "top_bar_icon_locator":
      return sanitizeTopBarIconElement(base, record, warnings);
    case "collection_item_locator":
      return sanitizeCollectionElement(base, record, warnings);
    case "structural_locator":
      return sanitizeStructuralElement(base, record, evidenceTextCounts, warnings);
    case "ocr_anchor_offset":
      return sanitizeAnchorOffsetElement(base, record, evidenceTextCounts, warnings);
    case "visual_locator":
      return sanitizeVisualElement(base, record, evidenceTextCounts, warnings);
  }
}

function sanitizeTextLocatorElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  evidenceTextCounts: Map<string, number>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  const targetText = readNonEmptyString(record.targetText);
  if (!targetText) {
    warnings.push(`text_locator 缺少 targetText：${base.elementLabel}`);
    return degradeOrRequestCompletion(base, "text_locator", "缺少目标文字，请补充执行识别文字或改用其它策略。", warnings);
  }
  const matchCount = evidenceTextCounts.get(targetText) ?? 0;
  if (matchCount === 0) {
    warnings.push(`text_locator 的目标文字在 OCR 证据中不存在：${targetText}（${base.elementLabel}）`);
    return degradeOrRequestCompletion(base, "text_locator", `目标文字「${targetText}」未在当前页面 OCR 命中，请人工确认。`, warnings);
  }
  const riskNotes = [...base.riskNotes];
  if (matchCount > 1) {
    riskNotes.push(`页面上有 ${matchCount} 处完全相同的文字「${targetText}」，执行时可能点到其它位置，建议补充区域约束后复核`);
  }
  const semanticArea = base.semanticArea ?? (base.region ? semanticAreaForRect(base.region) : undefined);
  return {
    ...base,
    riskNotes,
    locatorKind: "text_locator",
    locator: `text:${targetText}`,
    coordinateSpace: "runtime",
    targetText,
    semanticArea,
    structuralLocator: {
      kind: "ocr_text",
      role: "text_target",
      text: targetText,
      ...(semanticArea ? { semanticArea } : {}),
      ...(base.region ? { regionConstraint: { ...(semanticArea ? { semanticArea } : {}), region: base.region } } : {})
    },
    ...(base.region
      ? { visualLocator: { strategy: "ocr_text", targetText, searchRegion: base.region } }
      : {})
  };
}

function sanitizeTopBarIconElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  if (!base.region) {
    warnings.push(`top_bar_icon_locator 缺少参考区域：${base.elementLabel}`);
    return degradeOrRequestCompletion(base, "top_bar_icon_locator", "顶部栏图标缺少参考区域，运行时无法建立视觉候选，请人工圈选图标位置。", warnings);
  }
  const centerY = base.region.y + base.region.height / 2;
  if (centerY > 18) {
    warnings.push(`top_bar_icon_locator 的参考区域不在页面顶部（中心 y=${Math.round(centerY)}%）：${base.elementLabel}`);
    return degradeOrRequestCompletion(base, "top_bar_icon_locator", "参考区域不在顶部栏范围内，请确认元素策略。", warnings);
  }
  const role = normalizeTopBarIconRole(readNonEmptyString(record.role), base.elementLabel);
  const slot = readNonEmptyString(record.slot) === "left" || readNonEmptyString(record.slot) === "leading" ? "leading" : "trailing";
  const orderFromRightRaw = readNumber(record.orderFromRight);
  const orderFromRight = orderFromRightRaw && orderFromRightRaw >= 1 ? Math.floor(orderFromRightRaw) : undefined;
  if (role === "unknown") {
    warnings.push(`top_bar_icon_locator 无法确定图标 role，已按 unknown 处理：${base.elementLabel}`);
  }
  const candidate = {
    source: "ai_draft",
    label: base.elementLabel,
    role,
    score: base.confidence ?? 0.6,
    region: base.region,
    semanticArea: "top" as const
  };
  return {
    ...base,
    locatorKind: "top_bar_icon_locator",
    locator: `top-bar-icon:${role}`,
    coordinateSpace: "runtime",
    semanticArea: "top",
    structuralLocator: {
      kind: "top_bar_icon",
      role,
      slot,
      ...(orderFromRight ? { orderFromRight } : {}),
      regionConstraint: { semanticArea: "top", region: base.region }
    },
    visualLocator: {
      strategy: "top_bar_icon_shape",
      role,
      slot,
      ...(orderFromRight ? { orderFromRight } : {}),
      searchRegion: base.region,
      candidates: [candidate]
    }
  };
}

function sanitizeCollectionElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  if (!base.region) {
    warnings.push(`collection_item_locator 缺少列表容器区域：${base.elementLabel}`);
    return manualCompletionElement(base, "collection_item_locator", "缺少列表容器区域，请人工圈选整个列表范围。");
  }
  if (record.candidateIndex !== undefined || asRecord(record.scroll).candidateIndex !== undefined) {
    warnings.push(`collection_item_locator 不允许固定序号定位（candidateIndex），已忽略该字段：${base.elementLabel}`);
  }
  const scroll = asRecord(record.scroll ?? record.scrollProfile);
  const direction = scroll.direction === "horizontal" ? "horizontal" as const : "vertical" as const;
  const containerKindRaw = String(scroll.containerKind ?? "");
  const containerKind = containerKindRaw === "list" || containerKindRaw === "grid_list" || containerKindRaw === "tab_bar" || containerKindRaw === "carousel" || containerKindRaw === "scroll_area"
    ? containerKindRaw
    : "list";
  const parameterName = "itemText";
  const baseSlug = slugForAiAsset(base.elementLabel);
  const itemTemplateId = `item_template_ai_${baseSlug}`;
  return {
    ...base,
    locatorKind: "collection_item_locator",
    locator: imageRegionLocatorForRect(base.region),
    coordinateSpace: "screen",
    semanticArea: base.semanticArea ?? semanticAreaForRect(base.region),
    scrollProfile: {
      containerKind,
      direction,
      targetKind: "ocr_text",
      targetQuery: `{{${parameterName}}}`
    },
    dynamicRegion: {
      id: `dynamic_region_ai_${baseSlug}`,
      label: base.elementLabel,
      kind: "grid",
      region: base.region,
      itemTemplateId,
      dynamicFieldRules: [{ name: parameterName, source: "ocr_text", role: "title" }]
    },
    itemTemplate: {
      id: itemTemplateId,
      label: `${base.elementLabel}项`,
      region: base.region,
      actionArea: base.region,
      dynamicFields: [{ name: parameterName, role: "title" }],
      stableStructure: { source: "ai_draft_collection" }
    },
    transitionKind: "parameterized",
    parameterMapping: { [parameterName]: "dynamicRegion.item.titleText" }
  };
}

function sanitizeStructuralElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  evidenceTextCounts: Map<string, number>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  const strategy = readNonEmptyString(record.structuralStrategy) ?? readNonEmptyString(asRecord(record.structuralLocator).strategy);
  const anchorText = readNonEmptyString(record.anchorText) ?? readNonEmptyString(record.targetText);
  if (strategy !== "ocr_trailing_switch" && strategy !== "near_text_checkbox") {
    warnings.push(`structural_locator 的策略不在白名单（ocr_trailing_switch/near_text_checkbox）：${strategy ?? "缺失"}（${base.elementLabel}）`);
    return degradeOrRequestCompletion(base, "structural_locator", "结构策略不受运行时支持，请人工选择策略。", warnings);
  }
  if (!anchorText || !(evidenceTextCounts.get(anchorText) ?? 0)) {
    warnings.push(`structural_locator 的锚点文字缺失或未在 OCR 证据中命中：${anchorText ?? "缺失"}（${base.elementLabel}）`);
    return degradeOrRequestCompletion(base, "structural_locator", "缺少可验证的行内锚点文字，请人工补充。", warnings);
  }
  if (!base.region) {
    warnings.push(`structural_locator 缺少行区域证据：${base.elementLabel}`);
    return manualCompletionElement(base, "structural_locator", "缺少所在行的区域证据，请人工圈选整行。");
  }
  const structuralLocator = strategy === "ocr_trailing_switch"
    ? { strategy: "ocr_trailing_switch", anchorText }
    : { strategy: "near_text", role: "checkbox", clickTarget: "leading_checkbox", anchorText };
  const riskNotes = [...base.riskNotes];
  if (strategy === "ocr_trailing_switch") {
    riskNotes.push("开关型定位器只负责找到控件；具体设置目标状态由 ScriptFlow 步骤描述");
  }
  return {
    ...base,
    riskNotes,
    locatorKind: "structural_locator",
    locator: imageRegionLocatorForRect(base.region),
    coordinateSpace: "screen",
    semanticArea: base.semanticArea ?? semanticAreaForRect(base.region),
    targetText: anchorText,
    anchorText,
    structuralLocator
  };
}

function sanitizeAnchorOffsetElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  evidenceTextCounts: Map<string, number>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  const anchorText = readNonEmptyString(record.anchorText) ?? readNonEmptyString(record.targetText);
  if (!anchorText || !(evidenceTextCounts.get(anchorText) ?? 0)) {
    warnings.push(`ocr_anchor_offset 的锚点文字缺失或未在 OCR 证据中命中：${anchorText ?? "缺失"}（${base.elementLabel}）`);
    return degradeOrRequestCompletion(base, "ocr_anchor_offset", "缺少可验证的锚点文字，请人工补充。", warnings);
  }
  if (!base.region) {
    warnings.push(`ocr_anchor_offset 缺少目标参考区域：${base.elementLabel}`);
    return manualCompletionElement(base, "ocr_anchor_offset", "缺少目标参考区域，请人工圈选目标控件位置。");
  }
  const offsetRecord = asRecord(record.anchorOffsetPercent ?? record.offsetPercent);
  const offsetX = readNumber(offsetRecord.x);
  const offsetY = readNumber(offsetRecord.y);
  const anchorOffsetPercent = offsetX !== undefined && offsetY !== undefined
    ? { x: clampSigned(offsetX, 50), y: clampSigned(offsetY, 50) }
    : undefined;
  const riskNotes = [...base.riskNotes];
  if (!anchorOffsetPercent) {
    warnings.push(`ocr_anchor_offset 缺少 anchorOffsetPercent，执行时将点击锚点文字本身：${base.elementLabel}`);
    riskNotes.push("缺少偏移量，执行时会点击锚点文字本身，请确认是否需要补充 anchorOffsetPercent");
  }
  return {
    ...base,
    riskNotes,
    locatorKind: "ocr_anchor_offset",
    locator: imageRegionLocatorForRect(base.region),
    coordinateSpace: "screen",
    semanticArea: base.semanticArea ?? semanticAreaForRect(base.region),
    targetText: anchorText,
    anchorText,
    ...(anchorOffsetPercent ? { anchorOffsetPercent } : {}),
    structuralLocator: {
      kind: "ocr_anchor_offset",
      anchorText,
      ...(anchorOffsetPercent ? { anchorOffsetPercent } : {})
    }
  };
}

function sanitizeVisualElement(
  base: SanitizedElementBase,
  record: Record<string, unknown>,
  evidenceTextCounts: Map<string, number>,
  warnings: string[]
): AiPageDraftElementSuggestion {
  if (!base.region) {
    warnings.push(`visual_locator 缺少参考区域：${base.elementLabel}`);
    return manualCompletionElement(base, "visual_locator", "缺少视觉参考区域，请人工圈选。");
  }
  let targetText = readNonEmptyString(record.targetText);
  if (targetText && !(evidenceTextCounts.get(targetText) ?? 0)) {
    warnings.push(`visual_locator 的识别文字未在 OCR 证据中命中，已移除：${targetText}（${base.elementLabel}）`);
    targetText = undefined;
  }
  const dynamicMasks = readDynamicMasks(record.dynamicMasks, warnings, base.elementLabel);
  return {
    ...base,
    locatorKind: "visual_locator",
    locator: imageRegionLocatorForRect(base.region),
    coordinateSpace: "screen",
    semanticArea: base.semanticArea ?? semanticAreaForRect(base.region),
    ...(targetText ? { targetText } : {}),
    ...(dynamicMasks.length ? { dynamicMasks } : {})
  };
}

function degradeOrRequestCompletion(
  base: SanitizedElementBase,
  fromKind: AiPageDraftLocatorKind,
  completionReason: string,
  warnings: string[]
): AiPageDraftElementSuggestion {
  if (base.region) {
    warnings.push(`已将「${base.elementLabel}」从 ${fromKind} 降级为 visual_locator（保留参考区域作视觉证据）`);
    return {
      ...base,
      locatorKind: "visual_locator",
      locator: imageRegionLocatorForRect(base.region),
      coordinateSpace: "screen",
      semanticArea: base.semanticArea ?? semanticAreaForRect(base.region),
      degradedFrom: fromKind
    };
  }
  return manualCompletionElement(base, fromKind, completionReason);
}

function manualCompletionElement(
  base: SanitizedElementBase,
  kind: AiPageDraftLocatorKind,
  completionReason: string
): AiPageDraftElementSuggestion {
  return {
    ...base,
    locatorKind: kind,
    locator: "",
    coordinateSpace: kind === "text_locator" || kind === "top_bar_icon_locator" ? "runtime" : "screen",
    needsManualCompletion: true,
    completionReason
  };
}

const TOP_BAR_ICON_ROLE_HINTS: Array<[RegExp, string]> = [
  [/搜索|search/i, "search"],
  [/返回|back/i, "back"],
  [/关闭|close/i, "close"],
  [/更多|菜单|more|menu/i, "more"],
  [/添加|加号|新建|add|plus/i, "add"],
  [/头像|avatar|我的/i, "avatar"],
  [/设置|setting/i, "settings"],
  [/分享|share/i, "share"],
  [/扫码|扫一扫|scan/i, "scan"],
  [/消息|通知|message|notification/i, "message"]
];

function normalizeTopBarIconRole(role: string | undefined, elementLabel: string): string {
  const normalized = role?.toLowerCase().replace(/[^a-z0-9_-]+/g, "").trim();
  if (normalized) {
    return normalized;
  }
  for (const [pattern, hint] of TOP_BAR_ICON_ROLE_HINTS) {
    if (pattern.test(elementLabel)) {
      return hint;
    }
  }
  return "unknown";
}

function readAiLocatorKind(value: unknown): AiPageDraftLocatorKind | undefined {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator" ||
    value === "top_bar_icon_locator" ||
    value === "ocr_anchor_offset"
    ? value
    : undefined;
}

function readElementRegion(value: unknown): AiPageDraftRect | undefined {
  const record = asRecord(value);
  const x = readNumber(record.x);
  const y = readNumber(record.y);
  const width = readNumber(record.width);
  const height = readNumber(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return normalizeRect({ x, y, width, height });
}

function normalizeRect(rect: AiPageDraftRect): AiPageDraftRect | undefined {
  const x = clamp(rect.x, 0, 100);
  const y = clamp(rect.y, 0, 100);
  const width = clamp(rect.width, 0, 100 - x);
  const height = clamp(rect.height, 0, 100 - y);
  if ([x, y, width, height].some(Number.isNaN) || width < 1 || height < 1) {
    return undefined;
  }
  return { x: roundTwo(x), y: roundTwo(y), width: roundTwo(width), height: roundTwo(height) };
}

function imageRegionLocatorForRect(rect: AiPageDraftRect): string {
  return `image-region:${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function semanticAreaForRect(rect: AiPageDraftRect): "top" | "content" | "bottom" {
  const centerY = rect.y + rect.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function readDynamicMasks(
  value: unknown,
  warnings: string[],
  elementLabel: string
): NonNullable<AiPageDraftElementSuggestion["dynamicMasks"]> {
  const masks: NonNullable<AiPageDraftElementSuggestion["dynamicMasks"]> = [];
  for (const item of readArray(value)) {
    const record = asRecord(item);
    const kind = String(record.kind);
    const region = readElementRegion(record.region);
    if (!region || !(kind === "avatar" || kind === "text" || kind === "image" || kind === "number" || kind === "custom")) {
      warnings.push(`动态区域 mask 不合法，已剔除一项：${elementLabel}`);
      continue;
    }
    masks.push({
      kind,
      region,
      ...(readNonEmptyString(record.label) ? { label: readNonEmptyString(record.label) } : {}),
      ...(readNonEmptyString(record.reason) ? { reason: readNonEmptyString(record.reason) } : {})
    });
  }
  return masks;
}

function slugForAiAsset(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function clampSigned(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, roundTwo(value)));
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
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
