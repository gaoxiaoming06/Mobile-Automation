# 资产组合测试实现方案

> **对于智能体：** 在当前会话中按 TDD 逐项执行；每个生产行为先补失败测试，再实现并回归。

**目标：** 基于 PageStateFlow 正式资产提供 Parameter Profile、Meta Function 和组合用例，用户不重复录制动作即可组合、执行和查看分层报告。

**架构：** 组合资产只保存 PageModel、PageElement、PageTask 和目标页引用，不复制底层 ActionStep。服务端把元功能步骤动态解析为 GraphRunner 目标执行请求，组合执行器按顺序运行元功能、复用运行参数、自动恢复/重规划，并把结果汇总成用例级报告。

**技术栈：** TypeScript、SQLite、Express、React、Vitest、现有 PageStateFlow / GraphRunner / TestRuleCore。

---

### 任务 1：正式模型与持久化

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`

- [ ] 先测试 ParameterProfile、MetaFunction、AssetCompositeCase 的 SQLite CRUD、版本递增和级联删除。
- [ ] 定义参数值类型、元功能步骤联合类型、组合用例步骤和运行策略。
- [ ] 新增三张主表及元功能/用例步骤表，沿用现有 schema 初始化方式。
- [ ] 运行 storage 与 shared typecheck。

### 任务 2：资产引用预检与编译

**文件：**
- 创建：`platform/apps/server/src/asset-composition.ts`
- 创建：`platform/apps/server/src/asset-composition.test.ts`

- [ ] 先测试缺页面、缺 PageElement、缺 PageTask、缺参数、平台不匹配和成功编译。
- [ ] 元功能支持 `reach_page`、`invoke_capability`、`run_page_task`、`verify_page` 四类步骤。
- [ ] `invoke_capability` 必须从 PageElement 找到 active PageTransition；不得从组合资产复制 locator/action。
- [ ] 编译结果输出顺序化执行目标、所需参数、引用资产和可读诊断。

### 任务 3：组合执行服务与报告

**文件：**
- 创建：`platform/apps/server/src/asset-composite-execution.ts`
- 创建：`platform/apps/server/src/asset-composite-execution.test.ts`
- 修改：`platform/apps/server/src/index.ts`

- [ ] 先测试元功能顺序执行、失败停止、参数覆盖、GraphRunner 状态映射和分层报告。
- [ ] 每个 `reach_page` / capability 导航调用现有 GraphRunner；PageTask 通过 RuntimeOverlay `targetTaskId` 执行。
- [ ] 每个步骤执行前重新确认当前页面，偏离时由现有路径规划和恢复逻辑处理。
- [ ] 报告按组合用例、元功能、资产步骤、底层 run 四层展示。

### 任务 4：REST API

**文件：**
- 修改：`platform/apps/server/src/index.ts`
- 创建或修改对应 server API 测试。

- [ ] 实现 Parameter Profile、Meta Function、组合用例 CRUD。
- [ ] 实现组合用例 preview、execute、execution status、stop、HTML report。
- [ ] 写入前执行 schema 和资产引用校验，失败返回具体引用路径。

### 任务 5：Dashboard 产品入口

**文件：**
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`
- 修改：`platform/apps/dashboard/src/App.test.ts`

- [ ] 先测试导航入口、参数集表单、元功能步骤编辑、组合用例排序与执行请求。
- [ ] 新增“资产用例”一级入口，内部使用“参数集 / 元功能 / 组合用例”三个视图。
- [ ] 元功能和用例使用有序步骤卡片、添加/上移/下移/删除控件，不使用自由画布。
- [ ] 组合执行展示预检、当前元功能、步骤结果和报告入口。

### 任务 6：正式 Spec、回归与真机验收

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/asset-driven-testing-requirements.md`
- 修改：`docs/product/mobile-automation-platform/spec/design.md`
- 修改：`docs/product/mobile-automation-platform/spec/tasks.md`
- 修改：`docs/product/mobile-automation-platform/spec/acceptance.md`
- 修改：`docs/product/mobile-automation-platform/spec/traceability.md`
- 修改：`docs/product/mobile-automation-platform/spec/changelog.md`

- [ ] 固化 v1 决策：元功能 `draft/active/deprecated`，不做审批；参数集支持 string/number/boolean/template；调度首版只支持 once/repeat/loop。
- [ ] 跑新增测试、相关 GraphRunner/PageTask/Dashboard 回归、`pnpm lint`、`git diff --check`。
- [ ] 真机创建并执行“进入指定班级 → 创建课堂但不发布”组合用例，参数来自 Parameter Profile。
- [ ] 报告确认元功能级和资产步骤级结果，且业务参数不写回页面资产。
