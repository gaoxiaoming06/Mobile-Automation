---
title: PageStateFlow 页面资产规则
doc_type: asset-rules
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-07-06
updated_at: 2026-07-06
platform_scope: mobile-both
---

# PageStateFlow 页面资产规则

## 目标

这份规则是 PageStateFlow 资产的准入契约。后续资产可以由人工、自动探索、源码扫描或 AI 生成，但进入正式资产库前必须遵守同一套结构：PageMatcher 只负责识别页面，PageElement 只负责描述页面能力入口，PageTransition 只负责连接能力执行后的结果，PageTask 只负责编排可复用任务。

正式资产必须尽量跨端、跨设备、跨账号可用。Android resource-id、accessibility-id、UIAutomator dump、iOS WDA source、精确像素坐标和运行时 OCR 全量文本只能作为候选、调试证据或平台 fallback，不能绕过规则直接成为 active 资产。

## 分层边界

| 资产 | 只允许表达 | 禁止混入 |
|---|---|---|
| PageModel | 逻辑页面身份、版本范围、平台 profile、页面 matcher 集合。 | 页面上的点击动作、跳转目标、执行参数。 |
| PageMatcher | “当前截图是不是这个页面”的证据。 | 可点击元素、目标页面、连接边、任务参数。 |
| PageElement | “这个页面有什么可操作能力入口、入口在哪里、怎么重定位”。 | `targetNodeId`、`targetLabel`、`outcomeType`、连接边结果、任务流程。 |
| PageTransition | “对某个 PageElement 执行动作后会发生什么”。 | 顶层 `locator`、`visualLocator`、`semanticArea`、`collection` 等元素定位字段。 |
| PageTask | “为了完成一个业务目标需要组合哪些 transition / element action”。 | 新页面身份、独立定位证据、不可复用的临时坐标脚本。 |

## PageMatcher 规则

PageMatcher 是页面身份，不是页面能力。正式 matcher 只能使用稳定、可解释、带区域约束的证据：

- `ocr_text:文案@region(x,y,width,height)`：OCR 文案必须绑定截图相对区域和 `semanticArea`，不能只保存裸文本。
- `image_region` / `semantic_image_region`：必须保存 baseline 区域、截图相对矩形、`semanticArea`、`coordinateSpace` 和允许漂移范围。
- `layout_signature`：只能描述稳定布局结构，例如顶部标题栏、内容区骨架、底部固定区域组合。
- `composite`：多个 matcher 加权组合，至少一个 critical matcher 必须来自页面主体或页面标题栏。

PageMatcher 禁止：

- 把底部通用 Tab、全局导航入口、右上角加号、搜索按钮作为页面身份 critical matcher。
- 把动态业务数据作为页面身份，例如班级名、账号名、出勤数、角标、课程人数、公告数量。
- 把全屏 OCR 文本直接作为 critical matcher。
- 把 Android package、activity、resource-id、content-desc、accessibility-id、iOS WDA label/source 作为 active 页面身份。
- 用固定像素坐标描述状态栏、导航栏或设备外壳区域。

## PageElement 规则

PageElement 是页面能力入口，必须描述“这个元素是什么、在哪里、可以做哪些动作”，不描述“做完会去哪里”。

推荐字段：

```json
{
  "id": "home-class-grid",
  "label": "班级列表",
  "elementKind": "collection",
  "actions": ["tap_item"],
  "locator": "image-region:3.06,30.44,93.99,59.13",
  "locatorKind": "collection_item_locator",
  "semanticArea": "content",
  "coordinateSpace": "screen",
  "platformScope": "mobile-both",
  "collection": {
    "kind": "vertical_grid",
    "columns": 2,
    "itemIdentity": { "type": "ocr_title" },
    "candidateItemHeightPercent": 24.5,
    "clickSafePoint": { "xPercent": 50, "yPercent": 28 },
    "scrollStepPercent": 65,
    "failureStrategy": "try_next_candidate"
  }
}
```

通用字段：

- `elementKind`：`button`、`icon_button`、`input`、`checkbox`、`picker`、`collection`、`tab`、`menu_item`、`unknown`。
- `actions`：元素支持的动作，如 `tap`、`tap_item`、`input`、`scroll`、`long_press`。
- `semanticArea`：只允许 `top`、`content`、`bottom`、`unknown`。
- `coordinateSpace`：`screen`、`app_viewport`、`region`、`runtime`。
- `locatorKind`：`text_locator`、`visual_locator`、`structural_locator`、`collection_item_locator`、`top_bar_icon_locator`。
- `targetText` / `anchorText`：只作为元素重定位线索，必须配合区域或结构约束。
- `visualLocator` / `structuralLocator`：描述图标、按钮形态、相邻文本、布局槽位等跨设备定位线索。

PageElement 禁止：

- 保存 `targetNodeId`、`targetLabel`、`outcomeType`、`outcomeLabel`、`transitionKind`、`parameterMapping`。
- 把一次业务流程的多个步骤塞进一个普通元素。
- 把平台专属 ID 当成唯一定位来源；需要保留时只能放在 raw/debug evidence 或平台 fallback。
- 对动态列表的某一个具体卡片保存固定坐标；应保存 collection 容器和 item 查找策略。

## CollectionElement 规则

动态列表、两列网格、横滑卡片、轮播都必须用 CollectionElement 表达，而不是给每个动态 item 建 PageElement。

CollectionElement 必须包含：

- `elementKind: "collection"`。
- 容器 locator，通常是内容区 `image-region` 或 `semantic_image_region`。
- `collection.kind`：`vertical_list`、`vertical_grid`、`horizontal_list`、`carousel`。
- `itemIdentity`：候选项识别方式，例如 `ocr_title`、`image_template`、`layout_cell`。
- `clickSafePoint`：命中候选 item 后点击 item 内的安全点，不是屏幕固定点。
- `scrollStepPercent`：找不到候选时在容器内滚动的步长。
- `failureStrategy`：下游失败时是否尝试下一个候选。

指定动态数据时，通过 PageTransition / PageTask 参数传入，例如 `params.itemText = "{{className}}"`。运行时只能在该 collection 容器内查找 `className`，找不到就滚动继续找，最终失败必须报告，不得退化为点击第一个可见 item。

## PageTransition 规则

PageTransition 连接一个已存在的 PageElement 和执行结果。它不能重新定义元素在哪里，只能引用 `elementId`。

推荐字段：

```json
{
  "id": "home-open-class-detail",
  "elementId": "home-class-grid",
  "action": "tap_item",
  "outcomeType": "navigate",
  "targetNodeId": "node-class-detail",
  "targetLabel": "班级详情",
  "params": {
    "itemText": "{{className}}"
  }
}
```

PageTransition 允许：

- `elementId`：引用当前 PageModel 下的 PageElement。
- `action`：本次边执行的动作，如 `tap`、`tap_item`、`scroll`、`long_press`、`input`。
- `outcomeType`：`navigate`、`compound_navigation`、`show_inline_state`、`local_state_change`、`no_visible_change`。
- `targetNodeId` / `targetLabel`：仅在 `navigate` / `compound_navigation` 时使用。
- `params`：运行参数映射，例如 `itemText`、`inputText`、`duration`。
- `availability`：能力出现条件，例如 `visible`、`after_scroll`、`conditional`。
- `compoundSteps`：仅用于更多菜单、临时弹层这类过渡步骤。稳定可复用的中间元素应抽成 PageElement。

PageTransition 禁止：

- 顶层保存 `locator`、`locatorKind`、`targetText`、`semanticArea`、`coordinateSpace`、`visualLocator`、`anchorText`、`role`、`slot`、`orderFromRight`、`dynamicMasks`、`structuralLocator`、`dynamicRegionId`、`itemTemplateId`、`collection`、`actions`。
- 在未绑定目标页面时参与路径规划。
- 把表单填写流程伪装成普通页面跳转边。需要多步输入 / 勾选 / 选择器时，应建 PageTask 或 `compound_navigation`，并让每一步引用 PageElement 或受控临时 step。

## PageTask 规则

PageTask 是可复用业务任务，负责把页面能力组合起来。典型场景：

- 登录：输入手机号、输入密码、勾选协议、点击登录。
- 新建课堂：可选修改标题、可选选择时长、可选选择学科、可选勾选设置。
- 创建指定班级课堂：在主页 collection 中查找 `{{className}}`，进入班级详情，再执行新建课堂任务。

PageTask 参数必须显式声明，并允许默认值为空。参数为空时不执行对应可选步骤，不能为了填参数强行覆盖页面默认值。

## AI 资产生成准入流程

AI 可以负责资产录入，但不能直接污染 active 资产库。准入流程必须是：

```text
collect Observation
  -> AI 生成 PageAssetDraft
  -> schema validation
  -> boundary validation
  -> matcher health check
  -> element relocation dry-run
  -> transition dry-run / patrol
  -> promote to active PageStateFlow asset
```

AI 生成资产时必须输出结构化 JSON：

- `pageMatchers[]`：页面身份证据，必须带区域和 `semanticArea`。
- `pageElements[]`：页面能力入口，不允许带 transition 结果字段。
- `pageTransitions[]`：引用元素并描述结果，不允许带顶层定位字段。
- `pageTasks[]`：可选业务任务，引用 PageElement / PageTransition，不复制定位数据。
- `rawEvidence`：OCR 全量文本、UI dump、截图候选、平台字段、失败样本等只能进入证据区。
- `riskNotes[]`：列出动态业务数据、低置信 matcher、可能跨设备漂移的元素。

AI 生成的 draft 必须通过系统校验后才能进入 active。当前已实现的硬校验包括：

- `PAGE_ELEMENT_MIXED_TRANSITION_FIELD`：PageElement 混入连接边字段。
- `PAGE_TRANSITION_MIXED_ELEMENT_FIELD`：PageTransition 混入元素定位字段。
- `PAGE_TRANSITION_ELEMENT_MISSING`：PageTransition 引用不存在的 PageElement。
- `PAGE_TRANSITION_TARGET_MISSING`：跳转结果未绑定目标页面。
- `PAGE_TRANSITION_TARGET_NOT_FOUND`：跳转目标页面不存在。

## 资产质量判断

一个资产能被认为“高质量”，至少满足：

- 页面身份不依赖账号、业务数据、角标、状态栏、设备外壳和平台专属 ID。
- 页面能力能在同一 semanticArea 内通过 OCR、图像、结构或 collection 策略重定位。
- 连接边只引用 PageElement，不重复保存定位数据。
- 动态列表使用 CollectionElement，不保存某个动态 item 的固定坐标。
- 路径执行失败时报告能说明是页面没匹配、元素没找到、目标没出现、App 异常还是环境异常。
- 新设备 / 新账号上至少可以通过资产驱动巡检验证 matcher 和 element relocation。
