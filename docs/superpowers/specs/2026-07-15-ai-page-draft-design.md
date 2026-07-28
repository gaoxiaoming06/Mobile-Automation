# AI 页面资产草稿生成（AI 录入流水线 MVP）设计

日期：2026-07-15
状态：已确认（方案一，用户授权按推荐方案执行）

> 历史设计说明：页面身份录入能力仍保留，但执行模型已由 PageStateFlow 切换为 ScriptFlow v1。当前产品契约见 `docs/product/mobile-automation-platform/spec/script-flow-v1.md`。

## 背景与目标

页面资产录入原本全靠人工：识别当前页后逐项填页名、勾 OCR 身份文案、圈身份区域、逐个录入公共定位器。真机试点实测一个页面需要 5-15 分钟，是平台经济模型的主要瓶颈。

本 MVP 把"手工填"变成"AI 预填 + 人工确认"：

> 用户在资产录制页点击"AI 识别本页"，系统把当前 Observation（截图 + OCR 带框全文 + UI dump）交给 LLM，按 `page-asset-rules.md` 生成整页草稿建议（页面身份 + 元素清单），预填进现有录制面板；用户微调后走现有晋级/校验路径落库。

验收标准：录一个页面的人工耗时从"逐项填写 5-15 分钟"降到"确认微调 1-2 分钟"。

## 已确认的决策

| 决策点 | 结论 |
|---|---|
| 触发时机 | 手动按钮先做（"AI 识别本页"）；录制自动沉淀、巡检批量生成留待后续 |
| LLM 通道 | Codex app-server（现有 `codex://` 集成，走订阅无需 API key）；架构保持通道无关，OpenAI 兼容端点同样可用 |
| 视觉能力 | 通道支持发图则附截图；不支持则退化为结构化证据模式（OCR 框 + UI dump bounds），两条路都必须可用 |
| MVP 范围 | 只做生成端 + 预填现有面板。不做独立审核队列、不做录制自动沉淀 |
| 信任边界 | AI 输出只到前端表单为止，不写库；落库走现有 promote / page-elements validate+save 路径，门禁原样生效 |
| 生成范围 | 页面身份（名称/key/OCR 文案/截图区域）+ PageElement 清单。不生成 PageTransition（目标页通常尚未录入，且连接边必须引用已存在资产） |

## 架构与数据流

```
Dashboard 资产录制页
  [识别当前页]  → POST /api/graphs/:versionId/current-page（现有：建草稿节点 + 返回 observation）
  [AI 识别本页] → POST /api/graphs/:versionId/ai-page-draft（新增）
                   body: { observation }（复用已采集的；也接受 { deviceSerial } 现采）
                      │
                      ▼
            ai-page-draft.ts（新文件）
              1. buildPageDraftEvidence(observation)：OCR 文案+坐标框（转百分比）、
                 UI dump 可点元素（bounds 转百分比 + resource-id/content-desc 仅作语义提示）、
                 分辨率/包名/activity；截图供视觉通道使用
              2. buildPageDraftPrompt(evidence, rules)：系统指令 = PageStateFlow 资产规则块
                 + 输出 JSON schema 约束；用户内容 = 证据 JSON（+ 截图，若通道支持）
              3. 调用 ai-client.ts（共享 LLM 客户端，见"存量重构"）
              4. parseAiPageDraftResponse(raw)：JSON 解析 + schema 校验 + 消毒
                      │
                      ▼
            返回 { suggestion, warnings }（不写库）
                      │
                      ▼
  Dashboard 预填录制面板：页名/key、预勾 OCR 身份文案、预画身份区域、元素建议清单
                      │
                      ▼
  用户微调确认 → 现有 promote / page-elements/validate / page-elements 落库
```

## 输出 Schema（AiPageDraftSuggestion）

```jsonc
{
  "page": {
    "name": "肿瘤百科",              // 简洁业务页名
    "key": "encyclopedia",           // 小写点分/中划线 slug，不含包名
    "assetKind": "page",             // page | overlay
    "confidence": 0.9,
    "riskNotes": ["顶部含轮播图，已避开"]
  },
  "identityOcrTexts": [
    { "text": "鲸放肿瘤百科", "confidence": 0.95, "reason": "页面标题，稳定" }
  ],
  "identityRegions": [
    { "id": "title-bar", "label": "标题区", "x": 5, "y": 10.5, "width": 88, "height": 5.5,
      "semanticArea": "top", "confidence": 0.9, "reason": "品牌标题，跨账号稳定" }
  ],
  "elements": [
    { "elementLabel": "搜索入口", "targetText": "搜索",
      "abilityType": "fixed_tap",    // fixed_tap | scroll_candidate | grid_candidate | conditional_tap
      "actionKind": "tap",
      "locator": "image-region:4,18,92,6",   // 百分比区域，与现有 manual element locator 格式一致
      "semanticArea": "top",
      "confidence": 0.85,
      "riskNotes": [] }
  ],
  "warnings": ["状态栏文案已剔除"]
}
```

## 提示词要点

- 系统指令复用 `ai-diagnosis.ts` 中的 `PAGE_STATE_FLOW_ASSET_RULES` 思路，但按"录入"场景重写（诊断场景是修复 patch，白名单不同）：页面身份只允许稳定业务文案和区域；禁止状态栏/时间/数字/账号数据/底部通用 Tab 作为身份；动态列表建议 `grid_candidate`/`scroll_candidate` 并给容器区域而非单项坐标。
- 明确要求"只返回 JSON 对象"，schema 以内联示例 + 字段说明给出。
- 证据包里 OCR 全文和 UI dump 需截断保护（OCR 最多 ~120 条、UI 元素最多 ~80 个，优先 clickable / 文本非空项），防止 prompt 爆长。

## 消毒规则（parseAiPageDraftResponse）

1. JSON 解析失败：提取首个 `{...}` 块重试一次解析；仍失败返回错误。
2. 区域数值夹取到 [0,100]，width/height <= 剩余空间；非法区域丢弃并记 warning。
3. `identityOcrTexts` 过滤：不在本次 observation OCR 结果中出现的文案丢弃（防幻觉）；命中动态内容模式（纯数字、时间、网速、电量等）丢弃。
4. `elements` 过滤：locator 必须是合法 `image-region:x,y,w,h`；abilityType 不在枚举内丢弃。
5. 所有被丢弃项写入 `warnings` 返回给前端展示。

## 存量重构：ai-client.ts

`ai-diagnosis.ts`（1000+ 行）内嵌了 codex app-server JSON-RPC 连接管理（spawn、initialize、thread/start、turn/start、消息循环）和 OpenAI 兼容 HTTP 调用。抽出共享模块 `ai-client.ts`：

```ts
export type AiJsonRequest = {
  developerInstructions: string;
  userContent: string;
  imagePngBase64?: string;      // 通道支持则附带
  timeoutMs: number;
};
export async function runAiJsonRequest(config: AiDiagnosisConfig, request: AiJsonRequest): Promise<string>;
```

`ai-diagnosis.ts` 改为调用该模块，行为不变（现有测试守护）；`ai-page-draft.ts` 复用同一模块。配置沿用现有 AI 设置（storage + env：`AI_MODEL_BASE_URL/NAME/API_KEY`，`codex://app-server`）。

codex 通道发图：turn/start 的 input items 尝试附加图片项（写入临时 PNG 后以 local image 形式传递）；若当前 codex 版本不支持，捕获错误并自动退回纯文本证据模式，同时在响应 warnings 中说明。

## API

`POST /api/graphs/:versionId/ai-page-draft`

- 入参：`{ observation?: Observation; deviceSerial?: string }`（二选一，同 current-page 的模式）
- 200：`{ suggestion: AiPageDraftSuggestion; warnings: string[]; channel: "codex" | "openai-compatible"; visionUsed: boolean }`
- 409：AI 未配置/未启用（提示到"设置-AI 诊断"配置，沿用同一份配置）
- 422：LLM 输出无法解析成合法建议（附原始输出摘要）
- 504：LLM 超时（默认 90s，沿用 AI 设置的 timeoutMs）

## Dashboard 交互

资产录制面板（现有"识别当前页"流程之后）：

1. 新按钮"AI 识别本页"：仅在已有 observation（刚做过识别）时可用；点击后 loading 态（提示预计 20-60 秒），把内存中的 observation POST 给新 API。
2. 返回后预填：页名/key 填入表单、`identityOcrTexts` 自动勾选对应 OCR 候选、`identityRegions` 画成可拖拽调整的区域框、`elements` 生成元素建议列表（每项显示 confidence 和 riskNotes）。
3. 元素建议逐个"校验并保存"：走现有 `/page-elements/validate` + `/page-elements`，与手工录入相同的交互。
4. AI 预填的内容带明显标识（如 "AI" 徽标），用户改动后徽标消失；warnings 显示在面板顶部。
5. 失败态：错误信息原样展示 + "重试"；不阻塞手工录入路径。

## 错误处理

- codex CLI 不存在/损坏（本机当前状态）：spawn 失败时返回带修复提示的错误（`npm i -g @openai/codex`）。
- LLM 返回非 JSON：消毒规则 1 重试后仍失败 → 422。
- 视觉不支持：自动退回文本证据模式（warnings 说明），不视为失败。
- observation 缺截图/OCR：能采集则现场补采，不能则 400 说明缺什么。

## 测试

- `ai-page-draft.test.ts`（单测，不依赖真实 LLM）：
  - 证据包构建：百分比换算、截断策略、clickable 优先。
  - 提示词组装：规则块存在、schema 说明存在、图片开关。
  - 解析消毒：合法输出通过；坏 JSON、越界区域、幻觉 OCR 文案、非法 abilityType、状态栏文案各自被丢弃且产生 warning。
- `ai-client.test.ts`：从 ai-diagnosis 现有 codex 测试迁移/复用，覆盖连接失败、超时、正常回包。
- 路由测试：未配置 AI → 409；observation 缺失 → 400。
- `ai-diagnosis.test.ts` 现有用例全绿（守护重构不改行为）。
- 真机验收：cashim 试点 App 上对一个新页面执行"AI 识别本页"，确认预填质量与人工耗时 ≤2 分钟目标。

## 非目标（本期不做）

- 录制时自动沉淀（点击落点反查生成元素草稿）。
- 独立审核队列页面、批量生成。
- PageTransition / PageTask 的 AI 生成。
- AI 直接写库或自动晋级。
