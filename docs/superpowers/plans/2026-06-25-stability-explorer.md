# 稳定性探索实现方案

> **对于智能体：** 本方案在当前会话内联执行。每个核心行为先补失败测试，再实现最小可用代码并运行窄测。

**目标：** 新增独立“稳定性探索”能力，支持选择设备和包名后启动 App，在目标 App 内按受控策略探索，并输出可复现报告。

**架构：** 后端新增 `StabilityExplorer` 服务，复用 Mobile Driver、ObservationService、Storage 和 RunArtifactService，探索运行仍落入现有 `TestRun`/报告体系。Dashboard 新增独立导航 Tab，负责设备/包选择、策略配置、启动/停止和实时进度摘要。

**技术栈：** TypeScript、Express、React、Vitest、SQLite Storage、现有移动端 Driver 抽象。

---

### 任务 1: 后端探索服务

**文件：**
- 创建：`platform/apps/server/src/stability-explorer.ts`
- 创建：`platform/apps/server/src/stability-explorer.test.ts`
- 修改：`platform/apps/server/src/index.ts`
- 修改：`platform/packages/shared/src/index.ts`

- [x] 编写失败测试：配置归一化、候选过滤、启动指定包、动作上限、报告 artifact。
- [x] 运行 `pnpm exec vitest run platform/apps/server/src/stability-explorer.test.ts`，确认 RED。
- [x] 实现服务、API 和 RunConfig 扩展。
- [x] 再运行同一测试确认 GREEN。

### 任务 2: Dashboard 独立入口

**文件：**
- 修改：`platform/apps/dashboard/src/components/AppNav.tsx`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`
- 修改：`platform/apps/dashboard/src/styles.css`

- [x] 编写失败测试：导航出现“稳定性探索”、默认请求体可控、状态摘要可读。
- [x] 运行 `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts`，确认 RED。
- [x] 实现稳定性探索面板。
- [x] 再运行同一测试确认 GREEN。

### 任务 3: 报告与文档

**文件：**
- 修改：`platform/packages/report-core/src/index.ts`
- 修改：`platform/packages/report-core/src/report-core.test.ts`
- 修改：`docs/product/mobile-automation-platform/spec/requirements.md`
- 修改：`docs/product/mobile-automation-platform/spec/design.md`
- 修改：`docs/product/mobile-automation-platform/spec/tasks.md`
- 修改：`docs/product/mobile-automation-platform/spec/acceptance.md`
- 修改：`docs/product/mobile-automation-platform/spec/changelog.md`

- [x] 测试报告中展示稳定性探索配置和摘要。
- [x] 更新 T-090 到第一版实现说明。
- [x] 运行后端、前端和报告相关窄测，再运行类型检查。
