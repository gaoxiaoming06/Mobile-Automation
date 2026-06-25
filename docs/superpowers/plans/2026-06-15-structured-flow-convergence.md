# StructuredFlow 方向收敛治理实现方案

> **对于智能体：** 必需子技能：使用 test-driven-development 逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 把当前产品主线固化为 StructuredFlow，冻结 BusinessGraph 上层实验能力，避免后续开发继续被全局图谱方向牵引。

**架构：** 文档层标记 Graph 上层 frozen / experimental，skills 层约束默认开发方向，Dashboard 层把图谱入口降级为高级实验入口。保留 TestRuleStep、StateMatcher、语义定位、动态等待和 RuntimeInterceptor 作为 StructuredFlow 底层能力。

**技术栈：** React、Vitest、TypeScript、Markdown spec。

---

### 任务 1: Dashboard 导航降级

**文件：**
- 创建：`platform/apps/dashboard/src/components/AppNav.tsx`
- 创建：`platform/apps/dashboard/src/components/AppNav.test.tsx`
- 修改：`platform/apps/dashboard/src/App.tsx`

- [ ] **步骤 1: 编写失败测试**
  - 验证主导航仍包含设备管理、用例录制、用例库、执行结果。
  - 验证 Graph 入口显示为“实验能力”，并带有“业务图谱上层能力已冻结”的说明。

- [ ] **步骤 2: 运行测试观察失败**
  - 命令：`pnpm exec vitest run platform/apps/dashboard/src/components/AppNav.test.tsx`
  - 预期：因为 `AppNav` 尚不存在而失败。

- [ ] **步骤 3: 实现最小组件并替换 App 内联导航**
  - 抽出 `AppNav` 组件，不改变现有导航行为，只调整 Graph 入口文案和 title。

- [ ] **步骤 4: 运行测试和 dashboard typecheck**
  - 命令：`pnpm exec vitest run platform/apps/dashboard/src/components/AppNav.test.tsx`
  - 命令：`pnpm --filter @mobile-automation/dashboard typecheck`

### 任务 2: Spec 收敛

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/requirements.md`
- 修改：`docs/product/mobile-automation-platform/spec/design.md`
- 修改：`docs/product/mobile-automation-platform/spec/acceptance.md`
- 修改：`docs/product/mobile-automation-platform/spec/traceability.md`
- 修改：`docs/product/mobile-automation-platform/spec/tasks.md`
- 修改：`docs/product/mobile-automation-platform/spec/changelog.md`

- [ ] **步骤 1: 标记 Graph 上层 frozen / experimental**
  - REQ-036 保留底层能力。
  - REQ-037 / REQ-038 标记为 frozen / experimental，不作为当前 P0 默认开发方向。

- [ ] **步骤 2: 强化 StructuredFlow 主线**
  - REQ-041 / DES-041 / R-031 作为当前 P0。
  - 补充 `input_text_to_element`、`scroll_until_visible`、`wait_until_state` 为 StructuredFlow 主线后续任务。

### 任务 3: Skills 收敛

**文件：**
- 修改：`skills/README.md`
- 修改：`skills/agents/feature-pipeline.agent.md`
- 修改：`skills/agents/tech-architect.agent.md`
- 修改：`skills/agents/rnd-engineer.agent.md`
- 修改：`skills/skills/dashboard-ui-dev/SKILL.md`

- [ ] **步骤 1: 固化默认方向**
  - 新功能默认进入 StructuredFlow。
  - BusinessGraph 上层建设、源码扫描建图、候选资产晋级、目标节点规划默认为 frozen / experimental。

- [ ] **步骤 2: 明确保留底层能力**
  - StateMatcher、语义定位、动态等待、RuntimeInterceptor、TestRuleStep 继续作为底层能力复用。
