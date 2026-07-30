# 删除 ScriptFlow Ref 目标实现方案

> **对于智能体：** 必需子技能：使用 test-driven-development 在当前会话逐项执行。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 从脚本协议、AI 生成上下文、运行时执行和现有用例中彻底删除 `ref`，使动作只依赖脚本中的通用语义目标与执行器的实时定位能力。

**架构：** 页面资产只负责页面身份识别和动作后的页面验证。脚本描述文字、标准图标和通用控件等目标语义，执行器通过 OCR、标准控件视觉规则和必要的运行时结构策略寻找目标，不读取页面元素资产。AI 只接收页面目录与可复用用例目录，输出经过严格 schema 校验的 ScriptFlow；任何 `ref`、坐标、区域或元素资产 ID 都在保存和执行前被拒绝。

**技术栈：** TypeScript、Vitest、YAML、Express、React、ADB/OCR/视觉定位

---

### 任务 1: 锁死 ScriptFlow 协议边界

**文件：**
- 修改：`platform/packages/script-flow/src/types.ts`
- 修改：`platform/packages/script-flow/src/parser.ts`
- 修改：`platform/packages/script-flow/src/parser.test.ts`
- 修改：`platform/packages/script-flow/src/compiler.test.ts`
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] 增加失败测试：包含 `target.ref` 的 YAML 必须报 `Unknown field`，目标只能使用 `text`、`icon` 或通用 `control`。
- [ ] 运行 `pnpm --filter @mobile-automation/script-flow test`，确认新测试先失败。
- [ ] 删除 `ScriptTarget.ref` 和解析分支，更新编译测试为语义文字、图标或控件目标。
- [ ] 再次运行包测试，确认协议层无法接受 `ref`。

### 任务 2: 关闭 AI 污染入口

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 修改：`platform/apps/server/src/page-navigation.test.ts`

- [ ] 增加失败测试：AI 开发者规则不得暴露 `ref` 或页面元素目录，并必须明确禁止元素资产 ID、坐标和圈选区域。
- [ ] 增加失败测试：模型返回 `target.ref` 时，草稿校验失败并进入修复；修复后仍含 `ref` 则拒绝生成。
- [ ] 从 Planner Catalog 删除页面 locators，只保留页面身份和启用的用例/场景导航摘要。
- [ ] 删除 ref 存在性、requiredParameters 聚合和 ref 示例，所有示例改为通用语义目标。
- [ ] 运行 `script-flow-ai-planner` 和 `page-navigation` 测试，确认模型输出无法绕过 schema。

### 任务 3: 删除运行时 Ref 解析并补齐通用控件

**文件：**
- 修改：`platform/apps/server/src/script-target-resolver.ts`
- 修改：`platform/apps/server/src/script-target-resolver.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`
- 修改：`platform/apps/server/src/index.ts`

- [ ] 增加失败测试：带文字锚点的复选框可在没有页面元素资产、录制区域和坐标时完成勾选。
- [ ] 增加失败测试：Resolver 构造和解析不再依赖 `PageAssetCatalog`。
- [ ] 定义并解析通用控件目标，例如 `control: checkbox` 配合 `nearText`；输出只包含运行时结构语义。
- [ ] 删除 `resolveTargetReference`、locator 参数绑定和页面元素目录查询分支。
- [ ] 运行 Resolver 与 SemanticLocator 测试，确认文字输入、标准图标、复选框均不读取元素资产。

### 任务 4: 迁移产品数据并移除冲突入口

**文件：**
- 修改：`platform/apps/server/src/page-asset-catalog.ts`
- 修改：`platform/apps/server/src/page-asset-catalog.test.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/CaseCenterPanel.tsx`

- [ ] 将教师登录、教师退出登录及其他启用用例中的 `ref` 改为文字、标准图标和通用控件目标，并生成新版本。
- [ ] 页面资产目录对脚本与 AI 不再暴露元素 locator；资产录制和页面资产库不再把元素资产作为脚本前置条件展示。
- [ ] 删除仍会生成、选择或提示 `ref` 的产品入口和文案。
- [ ] 扫描持久化 ScriptFlow，确保所有启用版本均不包含 `target.ref`。

### 任务 5: 验证删除完整性

**文件：**
- 验证：`platform/`
- 验证：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] 运行定向测试并确认全部通过。
- [ ] 运行 `pnpm test` 与 `pnpm typecheck`，确认全量回归通过。
- [ ] 使用 `rg` 扫描 ScriptFlow、Planner 和 Resolver，确认不存在协议意义的 `ref`、`resolveTargetReference` 或 AI locator 目录。
- [ ] 在真机执行退出登录、教师登录和进入新建课堂流程，确认运行记录只出现 OCR、标准图标或通用控件的实时定位证据。
