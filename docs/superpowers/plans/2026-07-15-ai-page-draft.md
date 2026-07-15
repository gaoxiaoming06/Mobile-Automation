# AI 页面资产草稿生成（MVP）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资产录制页新增"AI 识别本页"：把 Observation 交给 LLM（codex:// 或 OpenAI 兼容端点）生成页面身份 + 元素清单草稿，预填现有录制面板，落库全部走现有校验路径。

**Architecture:** 无状态生成（方案一）。新增 `ai-page-draft.ts`（证据包/提示词/解析消毒/编排，纯函数为主）+ 一个路由；把 `ai-diagnosis.ts` 内嵌的 codex app-server JSON-RPC 与 OpenAI 兼容调用抽成共享 `ai-client.ts`（行为不变）。Dashboard 在 App.tsx 加请求处理，AssetRecordingPanel 加按钮与建议列表，元素建议直接通过现有 `onSavePageElement` 落库。

**Tech Stack:** TypeScript（严格模式）、Express、Vitest、React；不新增任何依赖。

**Spec:** `docs/superpowers/specs/2026-07-15-ai-page-draft-design.md`

## Global Constraints

- 不新增 npm 依赖；测试一律 Vitest，Dashboard 组件测试用 `renderToStaticMarkup` + 纯函数导出的既有风格。
- pnpm 命令本机需加前缀：`COREPACK_INTEGRITY_KEYS=0 corepack pnpm ...`。
- AI 输出永不直接写库；所有落库走现有 promote / page-elements API。
- AI 建议中禁止平台字段（resource-id/activity 等）与坐标兜底进入身份/定位建议；`locator` 只允许 `image-region:x,y,w,h` 百分比格式。
- UI 文案用简体中文，与现有面板一致。
- `ai-diagnosis.ts` 对外导出的函数名与行为不变（现有测试必须全绿）。

---

### Task 1: 抽出共享 LLM 客户端 ai-client.ts（行为不变重构）

**Files:**
- Create: `platform/apps/server/src/ai-client.ts`
- Create: `platform/apps/server/src/ai-client.test.ts`
- Modify: `platform/apps/server/src/ai-diagnosis.ts`（删除被移走的代码，改为调用 ai-client）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces（后续任务依赖，签名必须一致）:

```ts
// ai-client.ts
export type AiClientConfig = { baseURL: string; apiKey?: string; model: string; timeoutMs: number };
export type AiClientFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type AiJsonRequest = {
  developerInstructions: string;
  userContent: string;
  imagePngBase64?: string;          // 提供则尝试视觉；通道不支持时自动降级重试
  effort?: "low" | "medium" | "high"; // 仅 codex 通道使用，默认 "low"
};
export type AiJsonResult = { content: string; visionUsed: boolean };
export function isCodexAppServerProvider(baseURL?: string): boolean;
export async function runAiJsonRequest(config: AiClientConfig, request: AiJsonRequest, fetchImpl?: AiClientFetch): Promise<AiJsonResult>;
```

- [ ] **Step 1: 写失败测试（OpenAI 兼容通道，注入 fetch）**

`ai-client.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { isCodexAppServerProvider, runAiJsonRequest } from "./ai-client.js";

const config = { baseURL: "https://llm.example.com/v1", apiKey: "sk-test", model: "test-model", timeoutMs: 5000 };

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("ai-client", () => {
  it("identifies codex app-server provider", () => {
    expect(isCodexAppServerProvider("codex://app-server")).toBe(true);
    expect(isCodexAppServerProvider("https://llm.example.com/v1")).toBe(false);
  });

  it("runs text-only request through OpenAI-compatible endpoint", async () => {
    const fetchImpl = vi.fn(async () => okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user" }, fetchImpl);
    expect(result).toEqual({ content: '{"ok":true}', visionUsed: false });
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "user" });
  });

  it("sends image as multimodal content and reports visionUsed", async () => {
    const fetchImpl = vi.fn(async () => okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user", imagePngBase64: "aGk=" }, fetchImpl);
    expect(result.visionUsed).toBe(true);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "user" },
      { type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }
    ]);
  });

  it("falls back to text-only when image request is rejected", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported content", { status: 400 }))
      .mockResolvedValueOnce(okResponse('{"ok":true}'));
    const result = await runAiJsonRequest(config, { developerInstructions: "sys", userContent: "user", imagePngBase64: "aGk=" }, fetchImpl);
    expect(result).toEqual({ content: '{"ok":true}', visionUsed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when API key is missing for OpenAI-compatible endpoint", async () => {
    await expect(
      runAiJsonRequest({ ...config, apiKey: undefined }, { developerInstructions: "s", userContent: "u" })
    ).rejects.toThrow(/API key/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-client.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 创建 ai-client.ts**

从 `ai-diagnosis.ts` **原样搬移**以下私有代码（连同 `CODEX_PROVIDER_BASE_URL`、`CODEX_PROCESS_START_TIMEOUT_MS`、`CODEX_CLEANUP_TIMEOUT_MS` 常量与 `CodexJsonRpcMessage`、`CodexConnection` 类型）：`createCodexConnection`、`codexRequest`、`codexRespondToServerRequest`、`codexNextMessage`、`codexSendMessage`、`closeCodexConnection`、`unrefNodeHandle`、`isCodexRequestMessage`、`isCodexResponseMessage`、`codexClosedConnectionError`，以及本文件内需要的 `asRecord`/`stringFromRecord` 小工具（在 ai-client 内保留私有副本，ai-diagnosis 里同名工具保留不动，避免交叉导出）。

在其上实现公开 API：

```ts
export function isCodexAppServerProvider(baseURL?: string): boolean {
  return Boolean(baseURL?.trim().toLowerCase().startsWith(CODEX_PROVIDER_BASE_URL));
}

export async function runAiJsonRequest(config: AiClientConfig, request: AiJsonRequest, fetchImpl: AiClientFetch = fetch): Promise<AiJsonResult> {
  if (isCodexAppServerProvider(config.baseURL)) {
    return runCodexJsonTurn(config, request);
  }
  return runOpenAiCompatibleJsonRequest(config, request, fetchImpl);
}
```

`runOpenAiCompatibleJsonRequest`：以 `createOpenAiCompatibleDiagnosisClient` 现有实现为模板改造——无 apiKey 抛 `OpenAI-compatible AI request requires an API key.`；带 `imagePngBase64` 时 user message content 用多模态数组（见 Step 1 测试期望的形状）；响应非 2xx 且带过图片时，**降级为纯文本重发一次**（`visionUsed: false`），第二次仍失败才抛错；正常返回 `{ content, visionUsed }`。

`runCodexJsonTurn`：以 `runCodexDiagnosisTurn` 为模板改造——`developerInstructions` 从参数传入（不再固定用诊断指令）；`effort` 用 `request.effort ?? "low"`；带 `imagePngBase64` 时把图片写入 `os.tmpdir()` 下临时 PNG（`fs/promises.writeFile`，用完 `rm` 清理），input 数组附加 `{ type: "localImage", path }` 项，`visionUsed: true`；若 turn/start 因图片项报错（error message 含 `localImage`/`invalid`/`unknown` 之一），去掉图片项重试一次并置 `visionUsed: false`。其余消息循环逻辑原样保留。

- [ ] **Step 4: 改造 ai-diagnosis.ts 调用共享客户端**

- 删除被搬移的 codex 私有函数与常量（保留 `CODEX_DIAGNOSIS_DEVELOPER_INSTRUCTIONS` 等提示词常量）。
- `isCodexAppServerProvider` 改为 `export { isCodexAppServerProvider } from "./ai-client.js";`（保持既有导出名）。
- `createOpenAiCompatibleDiagnosisClient` 改为：

```ts
export function createOpenAiCompatibleDiagnosisClient(config: Extract<AiDiagnosisConfig, { enabled: true }>, fetchImpl: DiagnosisFetch = fetch): AiDiagnosisClient {
  return {
    async diagnose(evidence) {
      const result = await runAiJsonRequest(
        { baseURL: config.baseURL, apiKey: config.apiKey, model: config.model, timeoutMs: config.timeoutMs },
        { developerInstructions: CODEX_DIAGNOSIS_DEVELOPER_INSTRUCTIONS, userContent: buildDiagnosisPrompt(evidence) },
        fetchImpl
      );
      if (!result.content.trim()) {
        throw new Error("AI diagnosis response did not include text content.");
      }
      return parseAiDiagnosisResponse(result.content);
    }
  };
}
```

- `createCodexAppServerDiagnosisClient` 同样改为经 `runAiJsonRequest`（不传 fetchImpl）。
- 注意：OpenAI 路径原实现带 `temperature: 0.1` 与 `response_format: { type: "json_object" }`，这两个参数移入 `runOpenAiCompatibleJsonRequest` 保持不变。

- [ ] **Step 5: 跑新测试 + 现有诊断测试**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-client.test.ts src/ai-diagnosis.test.ts`
Expected: 全部 PASS（诊断测试一行不改）

- [ ] **Step 6: typecheck + 提交**

```bash
cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm typecheck
git add platform/apps/server/src/ai-client.ts platform/apps/server/src/ai-client.test.ts platform/apps/server/src/ai-diagnosis.ts
git commit -m "refactor: 抽出共享 AI JSON 客户端 ai-client.ts（codex/OpenAI 兼容双通道）"
```

---

### Task 2: 证据包与提示词（ai-page-draft.ts 纯函数部分）

**Files:**
- Create: `platform/apps/server/src/ai-page-draft.ts`
- Create: `platform/apps/server/src/ai-page-draft.test.ts`

**Interfaces:**
- Consumes: `Observation` 类型（`@mobile-automation/graph-core`，字段见 `graph-core/src/index.ts:352`：`ocrTexts: ObservationText[]`（`region?: Rect` 为像素）、`uiElements: ObservationUiElement[]`（`bounds?: Rect` 像素）、`resolution`、`raw.screenshotBase64`）。
- Produces:

```ts
export type AiPageDraftEvidence = {
  platform: string;
  packageName?: string;
  activityName?: string;
  resolution?: { width: number; height: number };
  ocrTexts: Array<{ text: string; confidence?: number; region?: { x: number; y: number; width: number; height: number } }>; // region 为百分比，保留两位小数
  uiElements: Array<{ className?: string; resourceIdHint?: string; contentDesc?: string; text?: string; clickable: boolean; bounds?: { x: number; y: number; width: number; height: number } }>;
};
export const AI_PAGE_DRAFT_MAX_OCR_TEXTS = 120;
export const AI_PAGE_DRAFT_MAX_UI_ELEMENTS = 80;
export const AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS: string;
export function buildPageDraftEvidence(observation: Observation): AiPageDraftEvidence;
export function buildPageDraftPrompt(evidence: AiPageDraftEvidence): string;
```

- [ ] **Step 1: 写失败测试**

`ai-page-draft.test.ts`（本任务先只写证据/提示词部分）：

```ts
import { describe, expect, it } from "vitest";
import type { Observation } from "@mobile-automation/graph-core";
import { AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS, buildPageDraftEvidence, buildPageDraftPrompt } from "./ai-page-draft.js";

function observationFixture(overrides: Partial<Observation> = {}): Observation {
  return {
    platform: "android",
    capturedAt: "2026-07-15T00:00:00.000Z",
    packageName: "com.demo",
    activityName: "com.demo.MainActivity",
    resolution: { width: 1000, height: 2000 },
    uiElements: [],
    ocrTexts: [],
    ...overrides
  };
}

describe("buildPageDraftEvidence", () => {
  it("converts OCR pixel regions to percent with two decimals", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      ocrTexts: [{ text: "首页", confidence: 0.98, region: { x: 100, y: 500, width: 333, height: 100 } }]
    }));
    expect(evidence.ocrTexts).toEqual([
      { text: "首页", confidence: 0.98, region: { x: 10, y: 25, width: 33.3, height: 5 } }
    ]);
  });

  it("keeps only clickable or labelled ui elements and caps the list", () => {
    const clickable = { className: "android.widget.Button", clickable: true, bounds: { x: 0, y: 0, width: 100, height: 100 } };
    const noise = { className: "android.widget.FrameLayout", clickable: false };
    const labelled = { className: "android.view.View", clickable: false, text: "提交" };
    const evidence = buildPageDraftEvidence(observationFixture({
      uiElements: [noise, clickable, labelled, ...Array.from({ length: 200 }, () => clickable)]
    }));
    expect(evidence.uiElements.length).toBeLessThanOrEqual(80);
    expect(evidence.uiElements[0]).toMatchObject({ clickable: true, bounds: { x: 0, y: 0, width: 10, height: 5 } });
    expect(evidence.uiElements.some((item) => item.text === "提交")).toBe(true);
  });

  it("caps ocr texts at 120", () => {
    const evidence = buildPageDraftEvidence(observationFixture({
      ocrTexts: Array.from({ length: 300 }, (_, index) => ({ text: `文案${index}` }))
    }));
    expect(evidence.ocrTexts).toHaveLength(120);
  });
});

describe("buildPageDraftPrompt", () => {
  it("embeds rules, schema and evidence json", () => {
    const prompt = buildPageDraftPrompt(buildPageDraftEvidence(observationFixture({ ocrTexts: [{ text: "肿瘤百科" }] })));
    expect(prompt).toContain("肿瘤百科");
    expect(prompt).toContain("identityOcrTexts");
    expect(prompt).toContain("image-region:");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("只返回 JSON");
    expect(AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS).toContain("状态栏");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现证据包与提示词**

`buildPageDraftEvidence` 实现要点：
- `toPercentRect(rect, resolution)`：`Math.round(value / total * 10000) / 100`；无 `resolution` 时省略 region/bounds。
- OCR：保序取前 120 条，text trim 后为空的丢弃。
- UI 元素：过滤 `clickable === true || text?.trim() || contentDesc?.trim()`，保序取前 80，`resourceId` 改名 `resourceIdHint`（明示仅作语义提示）。

`AI_PAGE_DRAFT_DEVELOPER_INSTRUCTIONS`（完整文案）：

```ts
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
```

`buildPageDraftPrompt(evidence)` 返回：输出 schema 说明（字段名与 Task 3 的 `AiPageDraftSuggestion` 完全一致的内联 JSON 示例）+ `【页面证据】` + `JSON.stringify(evidence)`。schema 示例直接抄设计文档"输出 Schema"一节的 JSON（含注释剥离）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add platform/apps/server/src/ai-page-draft.ts platform/apps/server/src/ai-page-draft.test.ts
git commit -m "feat: AI 页面草稿证据包与提示词构建"
```

---

### Task 3: 输出解析与消毒（parseAiPageDraftResponse）

**Files:**
- Modify: `platform/apps/server/src/ai-page-draft.ts`
- Modify: `platform/apps/server/src/ai-page-draft.test.ts`

**Interfaces:**
- Produces:

```ts
export type AiPageDraftRegionSuggestion = { id: string; label: string; x: number; y: number; width: number; height: number; semanticArea: "top" | "content" | "bottom" | "unknown"; confidence?: number; reason?: string };
export type AiPageDraftElementSuggestion = { elementLabel: string; targetText?: string; abilityType: "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap"; actionKind: "tap" | "scroll" | "long_press" | "input"; locator: string; semanticArea?: "top" | "content" | "bottom" | "unknown"; confidence?: number; riskNotes: string[] };
export type AiPageDraftSuggestion = {
  page: { name: string; key: string; assetKind: "page" | "overlay"; confidence?: number; riskNotes: string[] };
  identityOcrTexts: Array<{ text: string; confidence?: number; reason?: string }>;
  identityRegions: AiPageDraftRegionSuggestion[];
  elements: AiPageDraftElementSuggestion[];
};
export function parseAiPageDraftResponse(raw: string, observation: Observation): { suggestion: AiPageDraftSuggestion; warnings: string[] };
```

- [ ] **Step 1: 写失败测试（追加到 ai-page-draft.test.ts）**

```ts
import { parseAiPageDraftResponse } from "./ai-page-draft.js";

const validPayload = {
  page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", confidence: 0.9, riskNotes: [] },
  identityOcrTexts: [{ text: "鲸放肿瘤百科", confidence: 0.95 }],
  identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }],
  elements: [{ elementLabel: "搜索入口", abilityType: "fixed_tap", actionKind: "tap", locator: "image-region:4,18,92,6", semanticArea: "top", confidence: 0.8, riskNotes: [] }]
};
const parseObservation = observationFixture({ ocrTexts: [{ text: "鲸放肿瘤百科" }, { text: "10:57" }] });

describe("parseAiPageDraftResponse", () => {
  it("accepts a valid payload", () => {
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(validPayload), parseObservation);
    expect(suggestion.page.key).toBe("encyclopedia");
    expect(suggestion.identityOcrTexts).toHaveLength(1);
    expect(suggestion.elements).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("extracts json from surrounding prose", () => {
    const raw = "以下是建议：\n" + JSON.stringify(validPayload) + "\n请确认。";
    expect(parseAiPageDraftResponse(raw, parseObservation).suggestion.page.name).toBe("肿瘤百科");
  });

  it("throws on unparseable output", () => {
    expect(() => parseAiPageDraftResponse("完全不是 JSON", parseObservation)).toThrow(/JSON/);
  });

  it("drops hallucinated identity ocr texts", () => {
    const payload = { ...validPayload, identityOcrTexts: [{ text: "证据里不存在的文案" }] };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityOcrTexts).toEqual([]);
    expect(warnings.some((w) => w.includes("证据里不存在的文案"))).toBe(true);
  });

  it("drops dynamic texts like clock even when present in evidence", () => {
    const payload = { ...validPayload, identityOcrTexts: [{ text: "10:57" }] };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityOcrTexts).toEqual([]);
    expect(warnings.length).toBe(1);
  });

  it("clamps out-of-range regions and drops degenerate ones", () => {
    const payload = {
      ...validPayload,
      identityRegions: [
        { id: "a", label: "越界", x: -5, y: 95, width: 120, height: 20, semanticArea: "top" },
        { id: "b", label: "零面积", x: 10, y: 10, width: 0, height: 5, semanticArea: "content" }
      ]
    };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.identityRegions).toEqual([
      { id: "a", label: "越界", x: 0, y: 95, width: 100, height: 5, semanticArea: "top" }
    ]);
    expect(warnings.some((w) => w.includes("零面积"))).toBe(true);
  });

  it("drops elements with illegal locator or abilityType", () => {
    const payload = {
      ...validPayload,
      elements: [
        { elementLabel: "坏定位", abilityType: "fixed_tap", actionKind: "tap", locator: "xpath://Button", riskNotes: [] },
        { elementLabel: "坏类型", abilityType: "magic_tap", actionKind: "tap", locator: "image-region:1,1,10,10", riskNotes: [] }
      ]
    };
    const { suggestion, warnings } = parseAiPageDraftResponse(JSON.stringify(payload), parseObservation);
    expect(suggestion.elements).toEqual([]);
    expect(warnings).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts`
Expected: 新增用例 FAIL（`parseAiPageDraftResponse` 未导出）

- [ ] **Step 3: 实现解析消毒**

实现要点（全部在 `ai-page-draft.ts`）：

```ts
const DYNAMIC_TEXT_PATTERN = /^(\d{1,2}:\d{2}(:\d{2})?|[\d.,]+\s*(KB|MB|GB)\/s|[\d.,]+%?|\d+)$/i;
const IMAGE_REGION_LOCATOR_PATTERN = /^image-region:\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?,\d+(\.\d+)?$/;

function extractJsonObject(raw: string): string { /* 与 ai-diagnosis.ts:752 同实现：找第一个 { 起的平衡大括号块；本文件保留私有副本 */ }
```

- JSON：`JSON.parse(extractJsonObject(raw))`，失败抛 `Error("AI 页面草稿输出不是合法 JSON")`。
- page：`name`/`key` 非空字符串（key 转小写、空白替换为 `-`）；`assetKind` 非 `page|overlay` 时回退 `page` 并记 warning。
- identityOcrTexts：text 必须在 `observation.ocrTexts` 的 text 集合（trim 全等）中出现，否则丢弃 + warning `AI 建议的身份文案在 OCR 证据中不存在：<text>`；命中 `DYNAMIC_TEXT_PATTERN` 丢弃 + warning。
- identityRegions：x/y 夹取 [0,100]，width/height 夹取 [0, 100-x/y]；夹取后 width/height < 1 丢弃 + warning（消息含 label）。
- elements：locator 不匹配 `IMAGE_REGION_LOCATOR_PATTERN` 丢弃；abilityType/actionKind 不在枚举内丢弃；每次丢弃 warning（消息含 elementLabel）；`riskNotes` 缺省为 `[]`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add platform/apps/server/src/ai-page-draft.ts platform/apps/server/src/ai-page-draft.test.ts
git commit -m "feat: AI 页面草稿输出解析与消毒"
```

---

### Task 4: 编排函数与 REST 路由

**Files:**
- Modify: `platform/apps/server/src/ai-page-draft.ts`
- Modify: `platform/apps/server/src/ai-page-draft.test.ts`
- Modify: `platform/apps/server/src/index.ts`（新增路由，放在 `POST /api/graphs/:versionId/current-page` 路由之后）

**Interfaces:**
- Consumes: Task 1 `runAiJsonRequest`/`AiClientFetch`；Task 2/3 的全部纯函数；`resolveAiDiagnosisConfig`、`AiDiagnosisConfig`（ai-diagnosis.ts）；`observationService.collect`（index.ts 现有实例）。
- Produces:

```ts
export class AiPageDraftError extends Error {
  constructor(public readonly code: "not_configured" | "invalid_response" | "timeout" | "llm_failed", message: string);
}
export type AiPageDraftResult = { suggestion: AiPageDraftSuggestion; warnings: string[]; channel: "codex" | "openai-compatible"; visionUsed: boolean };
export async function generateAiPageDraft(input: { config: AiDiagnosisConfig; observation: Observation; fetchImpl?: AiClientFetch }): Promise<AiPageDraftResult>;
```

- [ ] **Step 1: 写失败测试（追加）**

```ts
import { AiPageDraftError, generateAiPageDraft } from "./ai-page-draft.js";

const enabledConfig = { enabled: true as const, baseURL: "https://llm.example.com/v1", apiKey: "sk", model: "m", timeoutMs: 5000 };

describe("generateAiPageDraft", () => {
  it("throws not_configured when AI is disabled", async () => {
    await expect(
      generateAiPageDraft({ config: { enabled: false, reason: "disabled" }, observation: parseObservation })
    ).rejects.toMatchObject({ code: "not_configured" });
  });

  it("returns sanitized suggestion via openai-compatible channel", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }), { status: 200 });
    const result = await generateAiPageDraft({ config: enabledConfig, observation: parseObservation, fetchImpl });
    expect(result.channel).toBe("openai-compatible");
    expect(result.suggestion.page.key).toBe("encyclopedia");
    expect(result.visionUsed).toBe(false);
  });

  it("attaches screenshot from raw evidence as image", async () => {
    let sawImage = false;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      sawImage = JSON.stringify(JSON.parse(init!.body as string).messages).includes("data:image/png;base64");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPayload) } }] }), { status: 200 });
    };
    const observationWithShot = { ...parseObservation, raw: { screenshotBase64: "aGk=" } };
    const result = await generateAiPageDraft({ config: enabledConfig, observation: observationWithShot, fetchImpl });
    expect(sawImage).toBe(true);
    expect(result.visionUsed).toBe(true);
  });

  it("wraps unparseable llm output as invalid_response", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: "不是 JSON" } }] }), { status: 200 });
    await expect(generateAiPageDraft({ config: enabledConfig, observation: parseObservation, fetchImpl }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts`
Expected: 新增用例 FAIL

- [ ] **Step 3: 实现 generateAiPageDraft**

```ts
export async function generateAiPageDraft(input: { config: AiDiagnosisConfig; observation: Observation; fetchImpl?: AiClientFetch }): Promise<AiPageDraftResult> {
  if (!input.config.enabled) {
    throw new AiPageDraftError("not_configured", `AI 未启用（${input.config.reason}），请在 设置-AI 诊断 中配置模型`);
  }
  const evidence = buildPageDraftEvidence(input.observation);
  const prompt = buildPageDraftPrompt(evidence);
  const imagePngBase64 = typeof input.observation.raw?.screenshotBase64 === "string" ? input.observation.raw.screenshotBase64 : undefined;
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
    throw new AiPageDraftError(/abort|timeout/i.test(message) ? "timeout" : "llm_failed", message);
  }
  try {
    const { suggestion, warnings } = parseAiPageDraftResponse(result.content, input.observation);
    return { suggestion, warnings, channel, visionUsed: result.visionUsed };
  } catch (error) {
    throw new AiPageDraftError("invalid_response", `${error instanceof Error ? error.message : String(error)}；原始输出前 200 字：${result.content.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: index.ts 加路由**

在 current-page 路由之后：

```ts
app.post("/api/graphs/:versionId/ai-page-draft", async (req, res) => {
  try {
    const graphVersion = storage.getBusinessGraphVersion(req.params.versionId);
    if (!graphVersion) {
      res.status(404).json({ error: "Graph version not found" });
      return;
    }
    const body = req.body as { observation?: Observation; deviceSerial?: string };
    const observation =
      body.observation ??
      (body.deviceSerial
        ? await observationService.collect(body.deviceSerial, { includeOcr: true, includeUiTree: true, includeScreenshot: true })
        : undefined);
    if (!observation) {
      res.status(400).json({ error: "observation or deviceSerial is required" });
      return;
    }
    const config = resolveAiDiagnosisConfig(process.env, storage.getAiDiagnosisSettings());
    const result = await generateAiPageDraft({ config, observation });
    res.json(result);
  } catch (error) {
    if (error instanceof AiPageDraftError) {
      const statusByCode = { not_configured: 409, invalid_response: 422, timeout: 504, llm_failed: 502 } as const;
      res.status(statusByCode[error.code]).json({ error: error.message, code: error.code });
      return;
    }
    sendError(res, error);
  }
});
```

同文件顶部补 import：`generateAiPageDraft`、`AiPageDraftError`（from `./ai-page-draft.js`）。

- [ ] **Step 5: 跑测试 + typecheck + 提交**

Run: `cd platform/apps/server && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft.test.ts && COREPACK_INTEGRITY_KEYS=0 corepack pnpm typecheck`
Expected: PASS

```bash
git add platform/apps/server/src/ai-page-draft.ts platform/apps/server/src/ai-page-draft.test.ts platform/apps/server/src/index.ts
git commit -m "feat: AI 页面草稿生成编排与 /ai-page-draft 路由"
```

---

### Task 5: Dashboard 按钮、预填与元素建议列表

**Files:**
- Create: `platform/apps/dashboard/src/ai-page-draft-merge.ts`
- Create: `platform/apps/dashboard/src/ai-page-draft-merge.test.ts`
- Modify: `platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- Modify: `platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`
- Modify: `platform/apps/dashboard/src/App.tsx`

**Interfaces:**
- Consumes: Task 4 的 API 响应 `{ suggestion, warnings, channel, visionUsed }`；`AssetRecordingCurrentPage`、`AssetRecordingScreenshotRegion`、`AssetRecordingPageElementDraft`（AssetRecordingPanel.tsx 现有导出）；`onSavePageElement` 面板 prop（现有）。
- Produces:

```ts
// ai-page-draft-merge.ts
export type AiElementSuggestion = { elementLabel: string; targetText?: string; abilityType: "fixed_tap" | "scroll_candidate" | "grid_candidate" | "conditional_tap"; actionKind: "tap" | "scroll" | "long_press" | "input"; locator: string; semanticArea?: "top" | "content" | "bottom" | "unknown"; confidence?: number; riskNotes: string[] };
export type AiPageDraftApiResponse = {
  suggestion: {
    page: { name: string; key: string; assetKind: "page" | "overlay"; confidence?: number; riskNotes: string[] };
    identityOcrTexts: Array<{ text: string; confidence?: number; reason?: string }>;
    identityRegions: Array<{ id: string; label: string; x: number; y: number; width: number; height: number; semanticArea: "top" | "content" | "bottom" | "unknown" }>;
    elements: AiElementSuggestion[];
  };
  warnings: string[];
  channel: string;
  visionUsed: boolean;
};
export function mergeAiPageDraftIntoPage(page: AssetRecordingCurrentPage, response: AiPageDraftApiResponse): AssetRecordingCurrentPage;
export function aiElementSuggestionToDraft(suggestion: AiElementSuggestion, sourceNodeId: string | undefined): AssetRecordingPageElementDraft;
```

同时给 `AssetRecordingCurrentPage`（AssetRecordingPanel.tsx:295）追加两个可选字段：`aiElementSuggestions?: AiElementSuggestion[]; aiWarnings?: string[];`（类型从 merge 模块 import，注意避免循环依赖——`AiElementSuggestion` 定义在 merge 模块，panel 从 merge 模块 import）。

- [ ] **Step 1: 写 merge 纯函数失败测试**

`ai-page-draft-merge.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { aiElementSuggestionToDraft, mergeAiPageDraftIntoPage, type AiPageDraftApiResponse } from "./ai-page-draft-merge.js";

const response: AiPageDraftApiResponse = {
  suggestion: {
    page: { name: "肿瘤百科", key: "encyclopedia", assetKind: "page", riskNotes: [] },
    identityOcrTexts: [{ text: "鲸放肿瘤百科" }],
    identityRegions: [{ id: "title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top" }],
    elements: [{ elementLabel: "搜索入口", abilityType: "fixed_tap", actionKind: "tap", locator: "image-region:4,18,92,6", semanticArea: "top", riskNotes: [] }]
  },
  warnings: ["状态栏文案已剔除"],
  channel: "codex",
  visionUsed: true
};

describe("mergeAiPageDraftIntoPage", () => {
  it("fills empty name/key, unions ocr texts, appends ai regions", () => {
    const merged = mergeAiPageDraftIntoPage({ status: "draft_created", confirmedOcrTexts: ["已有文案"], screenshotRegions: [] }, response);
    expect(merged.pageName).toBe("肿瘤百科");
    expect(merged.targetRef).toBe("encyclopedia");
    expect(merged.confirmedOcrTexts).toEqual(["已有文案", "鲸放肿瘤百科"]);
    expect(merged.screenshotRegions).toEqual([
      { id: "ai-title", label: "标题区", x: 5, y: 10, width: 88, height: 6, semanticArea: "top", coordinateSpace: "screen" }
    ]);
    expect(merged.aiElementSuggestions).toHaveLength(1);
    expect(merged.aiWarnings).toEqual(["状态栏文案已剔除"]);
  });

  it("does not overwrite user-entered name/key and dedupes", () => {
    const merged = mergeAiPageDraftIntoPage({
      status: "draft_created",
      pageName: "用户已填",
      targetRef: "user.key",
      confirmedOcrTexts: ["鲸放肿瘤百科"],
      screenshotRegions: [{ id: "ai-title", label: "旧", x: 1, y: 1, width: 2, height: 2 }]
    }, response);
    expect(merged.pageName).toBe("用户已填");
    expect(merged.targetRef).toBe("user.key");
    expect(merged.confirmedOcrTexts).toEqual(["鲸放肿瘤百科"]);
    expect(merged.screenshotRegions).toHaveLength(1);
  });
});

describe("aiElementSuggestionToDraft", () => {
  it("maps suggestion to element draft with defaults", () => {
    expect(aiElementSuggestionToDraft(response.suggestion.elements[0]!, "node-1")).toEqual({
      sourceNodeId: "node-1",
      abilityType: "fixed_tap",
      actionKind: "tap",
      availability: "visible",
      locator: "image-region:4,18,92,6",
      semanticArea: "top",
      coordinateSpace: "screen",
      elementLabel: "搜索入口",
      targetText: undefined
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd platform/apps/dashboard && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft-merge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 merge 模块使测试通过，并给 AssetRecordingCurrentPage 加字段**

实现按测试期望；`mergeAiPageDraftIntoPage` 规则：`pageName`/`targetRef` 仅在原值为空白时填入；`confirmedOcrTexts` 去重合并；regions 以 `ai-${id}` 为 id，已存在同 id 则跳过；`aiElementSuggestions`/`aiWarnings` 整体替换为本次响应内容。

Run: `cd platform/apps/dashboard && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run src/ai-page-draft-merge.test.ts`
Expected: PASS

- [ ] **Step 4: 面板 UI（按钮 + 警告条 + 建议列表）**

`AssetRecordingPanel.tsx`：
- Props 追加：`onAiIdentify?: () => void | Promise<void>; aiIdentifying?: boolean;`。
- 在现有"识别当前页"按钮旁渲染：

```tsx
{onAiIdentify ? (
  <button
    type="button"
    className="secondary"
    disabled={busy || identifying || aiIdentifying || !currentPage?.observation}
    onClick={() => void onAiIdentify()}
    title="将当前页面证据交给 AI 生成资产草稿建议（预计 20-60 秒）"
  >
    {aiIdentifying ? "AI 识别中…" : "AI 识别本页"}
  </button>
) : null}
```

- `currentPage.aiWarnings?.length` 时在工作台 tab 顶部渲染 `<div className="hint">AI 提示：{currentPage.aiWarnings.join("；")}</div>`。
- "actions" tab 中，`currentPage.aiElementSuggestions?.length` 时渲染建议卡片列表：每项显示 `elementLabel`、`abilityType`、`locator`、`confidence`（有则以百分比显示）、`riskNotes.join("；")`，以及按钮 `保存该元素`：`onClick={() => void onSavePageElement?.(aiElementSuggestionToDraft(item, currentPage?.nodeId))}`（`aiElementSuggestionToDraft` 从 `../ai-page-draft-merge.js` import），`disabled={busy || !onSavePageElement || !currentPage?.nodeId}`。

面板测试（AssetRecordingPanel.test.ts 追加，沿用 renderToStaticMarkup 风格）：

```ts
it("renders ai suggestions and forwards save", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssetRecordingPanel, {
      selectedSerial: "serial",
      busy: false,
      onPageDraftChange: () => undefined,
      onIdentifyCurrentPage: () => undefined,
      onSaveCurrentPageAsset: () => undefined,
      onAiIdentify: () => undefined,
      initialDetailTab: "actions",
      currentPage: {
        status: "draft_created",
        nodeId: "node-1",
        observation: {},
        aiWarnings: ["状态栏文案已剔除"],
        aiElementSuggestions: [{ elementLabel: "搜索入口", abilityType: "fixed_tap", actionKind: "tap", locator: "image-region:4,18,92,6", riskNotes: [] }]
      }
    })
  );
  expect(html).toContain("AI 识别本页");
  expect(html).toContain("搜索入口");
  expect(html).toContain("保存该元素");
  expect(html).toContain("状态栏文案已剔除");
});
```

- [ ] **Step 5: App.tsx 接线**

- 新增 state：`const [aiIdentifying, setAiIdentifying] = useState(false);`
- 新增处理函数（放在 `identifyCurrentPageAsset` 之后）：

```tsx
async function requestAiPageDraft() {
  const graphVersionId = assetRecordingPage.graphVersionId;
  const observation = assetRecordingPage.observation;
  if (!graphVersionId || !observation) {
    setMessage("请先执行“识别当前页”");
    return;
  }
  setAiIdentifying(true);
  try {
    const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/ai-page-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation })
    });
    const json = (await response.json().catch(() => ({}))) as AiPageDraftApiResponse & { error?: string };
    if (!response.ok || !json.suggestion) {
      throw new Error(json.error ?? "AI 识别失败");
    }
    setAssetRecordingPage((page) => mergeAiPageDraftIntoPage(page, json));
    setMessage(`AI 草稿已生成（${json.visionUsed ? "视觉" : "文本"}模式），请确认后保存`);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error));
  } finally {
    setAiIdentifying(false);
  }
}
```

- import `mergeAiPageDraftIntoPage, type AiPageDraftApiResponse` from `./ai-page-draft-merge`；
- `<AssetRecordingPanel ... onAiIdentify={requestAiPageDraft} aiIdentifying={aiIdentifying} />`（资产录制页处的实例）。

- [ ] **Step 6: 全量 dashboard 测试 + typecheck + 提交**

Run: `cd platform/apps/dashboard && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run && COREPACK_INTEGRITY_KEYS=0 corepack pnpm typecheck`
Expected: PASS

```bash
git add platform/apps/dashboard/src/ai-page-draft-merge.ts platform/apps/dashboard/src/ai-page-draft-merge.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.tsx platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.tsx
git commit -m "feat: 资产录制页接入 AI 识别本页与草稿预填"
```

---

### Task 6: 全仓回归、文档与真机验收

**Files:**
- Modify: `docs/product/mobile-automation-platform/spec/changelog.md`（追加条目）
- Modify: `docs/product/mobile-automation-platform/spec/asset-driven-testing-requirements.md`（REQ-ADT-002 追加"实现状态"一行）

**Interfaces:** 无新接口。

- [ ] **Step 1: 全仓回归**

Run: `COREPACK_INTEGRITY_KEYS=0 corepack pnpm -r typecheck && COREPACK_INTEGRITY_KEYS=0 corepack pnpm vitest run`
Expected: 全部 PASS（基线：84 文件 / 883 用例 + 本计划新增）

- [ ] **Step 2: 文档更新**

changelog.md 追加（沿用文件既有格式）：AI 页面资产草稿生成 MVP——资产录制页"AI 识别本页"、`POST /api/graphs/:versionId/ai-page-draft`、共享 ai-client、消毒规则与预填交互；引用 spec `docs/superpowers/specs/2026-07-15-ai-page-draft-design.md`。

asset-driven-testing-requirements.md 的 REQ-ADT-002 验收要点后追加：

```
实现状态：AI 辅助录入 v1 已落地（手动触发）。资产录制页支持"AI 识别本页"：LLM 按 page-asset-rules 生成页面身份与元素草稿并预填面板，消毒后仅作建议，落库仍走人工确认与既有校验门禁。
```

- [ ] **Step 3: 真机验收（人工，含环境修复）**

1. 修复 codex CLI：`npm i -g @openai/codex`，验证 `codex --version` 正常。
2. 启动 server + dashboard，AI 设置里确认 baseURL=`codex://app-server`、model 已配置（或临时用 OpenAI 兼容端点）。
3. 真机打开 `com.cashim.patient` 任一未录入页面 → 资产录制页"识别当前页" → "AI 识别本页" → 检查预填质量（页名、身份文案、区域、元素建议）→ 微调并保存 → 计时确认 ≤2 分钟。
4. 若 codex 不支持图片项：确认响应 `visionUsed:false` 且流程仍可用（文本证据模式）。

- [ ] **Step 4: 提交**

```bash
git add docs/product/mobile-automation-platform/spec/changelog.md docs/product/mobile-automation-platform/spec/asset-driven-testing-requirements.md docs/superpowers/plans/2026-07-15-ai-page-draft.md
git commit -m "docs: AI 页面资产草稿生成 MVP 落地记录"
```
