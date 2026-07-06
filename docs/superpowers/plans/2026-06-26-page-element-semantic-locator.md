# PageElement Semantic Locator 实现方案

> **对于智能体：** 必需子技能：使用 superpowers:executing-plans 逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 将 PageStateFlow 主线统一到文档与技能说明中，并补齐 PageElement 保存质量校验、运行时视觉重定位、报告证据展示。

**架构：** 保留现有 PageModel/PageElement/PageTask/GraphRun 结构，在服务端新增 PageElement 质量校验纯函数和 API；在 `SemanticStepResolver` 里增强 `tap_on_image` 的定位证据与视觉候选重定位；前端保存可操作元素时先做校验并展示结果；报告展示 semantic locator 证据。

**技术栈：** TypeScript、Vitest、Express、React SSR tests、现有 OCR/UI hierarchy/page asset 数据结构。

---

### 任务 1: 统一 PageStateFlow 文档方向

**文件：**
- 修改：`skills/README.md`
- 修改：`skills/agents/tech-architect.agent.md`

- [x] **步骤 1: 修改前阅读旧主线描述**

运行：`rg -n "StructuredFlow|BusinessGraph|PageStateFlow" skills docs/product/mobile-automation-platform/spec`

- [x] **步骤 2: 将 skills 主线改为 PageStateFlow**

把 StructuredFlow/BusinessGraph 的旧主线描述改为：PageStateFlow 是当前主线；StructuredFlow 是兼容的线性执行载体；BusinessGraph 只作为底层图存储和路径规划模型。

- [x] **步骤 3: 验证没有旧主线冲突**

运行：`rg -n "Current mainline|当前主线|StructuredFlow / Smart Recorded Flow|BusinessGraph 上层|frozen" skills`

### 任务 2: PageElement 保存质量校验

**文件：**
- 创建：`platform/apps/server/src/page-element-quality.ts`
- 创建：`platform/apps/server/src/page-element-quality.test.ts`
- 修改：`platform/apps/server/src/index.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`

- [x] **步骤 1: 编写失败测试**

覆盖：区域过小、缺少语义、OCR 目标唯一命中、多个相似 OCR 候选、低置信度 `needs_review`。

- [x] **步骤 2: 运行失败测试**

运行：`pnpm vitest run platform/apps/server/src/page-element-quality.test.ts`

- [x] **步骤 3: 实现质量校验纯函数和 API**

新增 `validatePageElementAssetQuality()`，返回 `status`、`score`、`warnings`、`candidates`、`evidence`。API 路径为 `POST /api/graphs/:versionId/assets/page-elements/validate`。

- [x] **步骤 4: 前端保存前调用校验并展示状态**

保存前请求校验接口；保存请求携带 `quality`；表单下方显示唯一命中、低置信、需要复核等信息。

- [x] **步骤 5: 运行测试**

运行：`pnpm vitest run platform/apps/server/src/page-element-quality.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`

### 任务 3: 运行时 OCR + 视觉局部重定位

**文件：**
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`
- 修改：`platform/apps/server/src/graph-run-service.ts`
- 修改：`platform/apps/server/src/graph-run-service.test.ts`

- [x] **步骤 1: 编写失败测试**

覆盖：`tap_on_image` 无文字目标时，优先用录入 crop template 在原区域附近局部搜索；也支持 `visualLocator.candidates` 在同 semanticArea 里选择最高分候选；低置信候选不点，普通手工区域没有 OCR / 视觉 / 结构重定位证据时失败，metadata 标记 `fallback: region_center_disabled` 和 `reason: runtime_relocation_required`。

- [x] **步骤 2: 运行失败测试**

运行：`pnpm vitest run platform/apps/server/src/semantic-locator.test.ts`

- [x] **步骤 3: 实现 OCR + crop template 局部搜索 + 最小视觉候选选择**

先不接真实 OmniParser；保存 PageElement 时生成 recorded crop template，运行时在记录区域附近做局部搜索；同时支持 runtime params 中的 `visualLocator.candidates`，用 semanticArea、score、targetRole 评分，命中后点击候选中心。普通 `region_center` 只作为记录证据和修复建议，不再执行。

- [x] **步骤 4: 从 PageElement 传递质量/视觉定位参数**

`graph-run-service` 将手工元素上的 `quality`、`visualLocator` 透传到 action params。

- [x] **步骤 5: 运行测试**

运行：`pnpm vitest run platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/graph-run-service.test.ts`

### 任务 4: 报告和失败修复证据展示

**文件：**
- 修改：`platform/packages/report-core/src/index.ts`
- 修改：`platform/packages/report-core/src/report-core.test.ts`
- 修改：`platform/apps/dashboard/src/hooks/useRunExecution.ts`
- 修改：`platform/apps/dashboard/src/components/StepsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/StepsPanel.test.ts`

- [x] **步骤 1: 编写失败测试**

覆盖 HTML 报告和 dashboard 步骤详情中展示 semantic locator 的 resolvedBy、score、candidate、fallback、evidenceArtifactIds。

- [x] **步骤 2: 运行失败测试**

运行：`pnpm vitest run platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts`

- [x] **步骤 3: 实现报告渲染**

在 graph action policy 或 step status 区域追加 `semantic` metadata 的定位证据。

- [x] **步骤 4: 运行测试**

运行：`pnpm vitest run platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts`

### 任务 5: 参数型页面 / 动态区域 / 列表模板第一阶段

**文件：**
- 修改：`platform/apps/server/src/page-transition-assets.ts`
- 修改：`platform/apps/server/src/page-transition-assets.test.ts`
- 修改：`platform/apps/server/src/page-element-quality.ts`
- 修改：`platform/apps/server/src/page-element-quality.test.ts`
- 修改：`platform/apps/server/src/graph-run-service.ts`
- 修改：`platform/apps/server/src/page-ability-edges.ts`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`

- [x] **步骤 1: 保存结构型 PageElement 元数据**

PageElement 支持 `locatorKind`、`dynamicMasks`、`structuralLocator`，用于把个人头像 / 昵称等动态内容从结构行定位中排除。

- [x] **步骤 2: 保存动态列表第一阶段模型**

PageModel metadata 支持 `assetRecordingDynamicRegions` 和 `assetRecordingItemTemplates`；PageElement / PageTransition action params 支持 `transitionKind=parameterized`、`dynamicRegionId`、`itemTemplateId`、`parameterMapping`。

- [x] **步骤 3: 前端录入和刷新回显**

页面能力表单可选择 locator 类型、动态 mask preset，并为 `grid_candidate` 生成动态区域、item template 和参数映射；App 映射层刷新后保留这些字段。

- [x] **步骤 4: 明确边界**

本阶段只落模型、录入、持久化、回显和执行参数透传，不一次性实现完整“班级列表参数化探索规划器”。
