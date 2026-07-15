# AI 页面草稿：语义定位策略输出（v2）设计

日期：2026-07-15
分支：claude/ai-page-draft
前置：`2026-07-15-ai-page-draft-design.md`（MVP：image-region 草稿 + 前端预填）

## 背景与目标

MVP 版 AI 草稿只产出 `image-region:x,y,w,h` 候选，虽带 `targetText` 可走运行时 OCR 重定位，但资产本身停留在"加快旧式圈选"，没有生成平台真正的结构化语义资产。本轮目标：

**AI 输出与运行时精确对齐的六类 locatorKind 结构化建议，继续走现有 validate + save 质量门，不越过信任边界。**

六类策略（`ManualPageElementLocatorKind`，page-transition-assets.ts:18）：
`text_locator` / `visual_locator` / `structural_locator` / `collection_item_locator` / `top_bar_icon_locator` / `ocr_anchor_offset`。

## 核实过的运行时约束（决定设计的硬事实）

1. **top_bar_icon 运行时必须有 `visualLocator.candidates`**（semantic-locator.ts `resolveTopBarIconTap` → `selectTopBarIconCandidate`，candidates 为空直接 fail `candidate_not_found`）。手动构建器只产 `top_bar_icon_shape + searchRegion`，不含 candidates——AI 链路必须由**服务端从参考区域确定性生成 candidates**，不能只给 role/slot/orderFromRight。
2. **ocr_anchor_offset 运行时读 `params.anchorOffsetPercent`**（`resolveOcrAnchorOffsetTap`，字段名严格如此；anchorText 回退 targetText）。且该字段目前**没有**从元素资产贯通到 step params（`abilityActionParams` 不传）——需补 element 级 `anchorOffsetPercent` 贯通链。其执行入口是 `tap_on_image` + `locatorKind==="ocr_anchor_offset"`，因此资产 locator 仍用 image-region（参考区域），靠 locatorKind 分流。
3. **质量门当前只显式覆盖前四类**（page-element-quality.ts:58），且 validate 路由（index.ts:1393）没把 locatorKind/structuralLocator/visualLocator 传进校验——top_bar 与 anchor 两类需要补规则，validate 路由需要补传参（顺带修复手动链路同一缺口）。
4. **元素能力 → step params 的传递面**（page-ability-edges.ts `abilityActionParams`）：locatorKind、visualLocator、structuralLocator、anchorText、role、slot、orderFromRight、dynamicMasks 均会透传；locator 前缀决定 step 类型（`top-bar-icon:`/`image-region:` → tap_on_image，`text:` → tap_on_text）。
5. **列表/网格**：`collection_item_locator` 走容器 region + `dynamicRegion`/`itemTemplate`/`parameterMapping`（对齐 `collectionModelFromForm` 的形状），targetQuery 由用例参数注入。
6. **保存 API 字段齐全**：`assetPageElementRequestBody` / `PersistManualPageElementInput` 已承载 locatorKind、structuralLocator、visualLocator、dynamicMasks、dynamicRegion、itemTemplate、transitionKind、parameterMapping（唯缺 anchorOffsetPercent）。

## AI 输出协议 v2（elements 项）

LLM **不再直接输出 locator 字符串，也不输出 visualLocator**——只输出语义意图字段，由服务端消毒层确定性生成规范 locator 与结构化载荷（防幻觉格式）：

```jsonc
{
  "elementLabel": "搜索",
  "locatorKind": "top_bar_icon_locator",   // 六类之一；缺省按下述兼容规则处理
  "targetText": "搜索",                     // text/visual 类的执行识别文字
  "abilityType": "fixed_tap",
  "actionKind": "tap",
  "region": { "x": 86, "y": 5, "width": 10, "height": 4 },  // 参考/搜索/容器区域（百分比）
  "semanticArea": "top",
  "confidence": 0.85,
  "riskNotes": [],
  // —— top_bar_icon_locator 专属 ——
  "role": "search", "slot": "right", "orderFromRight": 1,
  // —— ocr_anchor_offset 专属 ——
  "anchorText": "会员中心", "anchorOffsetPercent": { "x": 40, "y": 0 },
  // —— structural_locator 专属（白名单策略）——
  "structuralStrategy": "ocr_trailing_switch",  // 或 "leading_checkbox_near_text"
  // —— collection_item_locator 专属 ——
  "scroll": { "direction": "vertical", "containerKind": "grid_list", "columns": 2 }
}
```

向后兼容：若元素仍给旧式 `locator: "image-region:..."` 且无 locatorKind → 按 `visual_locator` 处理。

## 按类型消毒规则（服务端 ai-page-draft.ts）

| kind | 必要证据 | 生成产物 | 失败处理 |
|---|---|---|---|
| text_locator | targetText 逐字命中 OCR 证据且**归一化后唯一**（>1 命中视为歧义） | `text:<targetText>` + structuralLocator `{kind:"ocr_text", role:"text_target", text, semanticArea, regionConstraint?}`（对齐手动构建器） | 歧义/未命中 → 走降级判定 |
| top_bar_icon_locator | region 必给且中心 y ≤ 18；role 归一化小写 slug（缺省从 elementLabel 推断，再缺 "unknown"） | `top-bar-icon:<role>` + structuralLocator `{kind:"top_bar_icon", role, slot, orderFromRight?, regionConstraint:{semanticArea:"top", region}}` + visualLocator `{strategy:"top_bar_icon_shape", role, slot, orderFromRight?, searchRegion, candidates:[{source:"ai_draft", label, role, score, region, semanticArea:"top"}]}` | region 缺失/不在顶部 → 走降级判定 |
| ocr_anchor_offset | anchorText 逐字命中 OCR；region 必给；anchorOffsetPercent 各分量 clamp [-50,50]（缺省 {0,0} 并警告） | `image-region:<region>` + locatorKind + targetText=anchorText + 元素级 anchorOffsetPercent + structuralLocator `{kind:"ocr_anchor_offset", anchorText, anchorOffsetPercent}` | anchorText 未命中/region 缺失 → 走降级判定 |
| structural_locator | 策略白名单：`ocr_trailing_switch`（anchorText 命中 OCR）/ `leading_checkbox_near_text`（anchorText 命中 OCR）；region 必给 | `image-region:<region>` + structuralLocator 按运行时 reader 拼：开关 `{strategy:"ocr_trailing_switch", anchorText}` + fieldType 由 actionKind 映射 toggle_set；复选 `{strategy:"near_text", role:"checkbox", clickTarget:"leading_checkbox", anchorText}` | 策略不在白名单/证据不足 → 走降级判定 |
| collection_item_locator | 容器 region 必给（圈容器不圈项，沿用 grid 规则） | `image-region:<容器>` + abilityType 强制 grid_candidate + scrollProfile + dynamicRegion/itemTemplate/parameterMapping（对齐 collectionModelFromForm 形状，参数名 itemText） | region 缺失 → 走降级判定 |
| visual_locator | region 必给 | `image-region:<region>`（现状逻辑，quality/validate 自动补 crop template） | region 缺失 → 剔除并警告 |

**降级原则（从严）**：结构化校验失败时——
- AI 给了**合规稳定 region**（clamp 后 width/height ≥ 1）→ 降级为 `visual_locator` + image-region，记 warning 与 `degradedFrom: <原kind>`；
- **没有可靠 region → 不降级、不剔除**：保留建议并标 `needsManualCompletion: true` + `completionReason`，前端禁用一键保存，提示人工补充。禁止凭空制造圈选资产。

## 质量门扩展（page-element-quality.ts + index.ts validate 路由）

- `locatorKind` union 增加 `top_bar_icon_locator` / `ocr_anchor_offset`；输入面增加 `visualLocator`、`anchorOffsetPercent`。
- `locatorKindRequiresMarkedRegion`：`text_locator` 与 `top_bar_icon_locator` 不要求圈选 region。
- 新规则：
  - top_bar_icon_locator：structuralLocator.kind==="top_bar_icon" 且 role 非空，否则 error `top_bar_icon_locator_incomplete`；`visualLocator.candidates` 为空 → error `top_bar_icon_candidates_missing`（运行时必失败）。
  - ocr_anchor_offset：anchorText（回退 targetText）缺失或未命中 observation OCR → error `anchor_text_missing` / warning `target_text_not_found`（复用现有候选匹配）；anchorOffsetPercent 缺失 → warning（默认点锚点本身）。
- validate 路由把 body 的 locatorKind/structuralLocator/visualLocator/dynamicMasks/anchorOffsetPercent 全量传入 `validatePageElementAssetQuality`（同时修复手动链路"质量门收不到 locatorKind"的存量缺口）。

## anchorOffsetPercent 贯通链

`readManualPageElementRequest`（index.ts）→ `PersistManualPageElementInput` / 持久化（page-transition-assets.ts）→ `PageElementAsset` / `ManualPageAbilityElement` / `abilityActionParams`（page-ability-edges.ts）→ step params，字段名与 `resolveOcrAnchorOffsetTap` 读取名严格一致：`anchorOffsetPercent: {x, y}`（有符号百分比）。

## 前端（ai-page-draft-merge.ts + AssetRecordingPanel.tsx）

- `AiElementSuggestion` v2 全字段透传（含 locatorKind、region、role/slot/orderFromRight、anchorText/anchorOffsetPercent、structuralLocator、scrollProfile、dynamicRegion/itemTemplate/parameterMapping、needsManualCompletion/completionReason、degradedFrom）。
- `aiElementSuggestionToDraft`：服务端已生成全部结构化载荷，前端只做形状搬运（不再自行拼 locator）；coordinateSpace 按 kind（text/top_bar → runtime，其余 → screen）。
- 面板建议卡片：策略 chip（六类中文名 + 降级来源标注）、riskNotes、needsManualCompletion 时"保存该元素"按钮禁用并显示 completionReason。

## 提示词策略决策树（写入 developer instructions）

1. 纯文字按钮/入口（OCR 有稳定唯一文案）→ `text_locator`；
2. 顶部栏无文字图标（搜索/返回/更多/头像等）→ `top_bar_icon_locator`（给参考小区域 + role + slot + 从右序号）；
3. 动态列表/网格 → `collection_item_locator`（圈整个容器，禁止圈单项）；
4. 行尾开关、行首复选框 → `structural_locator` + 对应 structuralStrategy + anchorText（行内稳定文案）；
5. 紧邻稳定文案的小控件（文案右侧图标等）→ `ocr_anchor_offset`（anchorText + 偏移百分比 + 参考区域）；
6. 以上都不适用且区域视觉稳定 → `visual_locator`；
7. 证据不足时宁可低 confidence + riskNotes，不要编造 region 或文案。

## 错误与信任边界（不变）

AI 永不直写存储；全部建议经前端人工确认 → `/assets/page-elements/validate`（质量门）→ save。API 错误码沿用 MVP（409/422/504/502）。

## 测试计划

- server：ai-page-draft.test.ts 六类消毒各正反用例 + 降级/needsManualCompletion 判定 + 向后兼容旧 locator；page-element-quality.test.ts 新增两类规则；page-ability-edges.test.ts anchorOffsetPercent 透传。
- dashboard：ai-page-draft-merge.test.ts 各 kind 的 draft 形状对齐 manualOperationDraftFromForm；AssetRecordingPanel.test.ts 策略 chip 与禁用逻辑。
- 真机验收：cashim 就医咨询/首页各生成一次，重点核对顶栏图标与列表容器两类判断。
