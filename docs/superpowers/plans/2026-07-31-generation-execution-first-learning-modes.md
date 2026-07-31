# 测试生成执行优先与持续学习分阶段实现方案

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 先把“自然语言描述测试 -> 生成确定性 ScriptFlow -> 在真实设备稳定执行 -> 输出可诊断结果”做成可靠主链路，再通过可控的三态持续学习模式逐步引入页面、交互和导航资产学习。

**架构：** ScriptFlow 始终是测试事实来源，现有 active 资产始终只作为可选增强信息读取。持续学习使用服务端源码常量 `disabled | shadow | active` 控制证据写入、候选聚合、AI 分析和资产发布；默认 `disabled`，不提供设置、API 或环境变量开关。第一阶段验收通过后通过代码评审改为 `shadow`，影子数据达到质量门槛后再通过代码评审改为 `active`。生成阶段不读取设备，执行阶段负责页面识别、目标查找、受控恢复和结果验证。

**技术栈：** TypeScript、React、Express、Node.js 24 `node:sqlite`、Vitest、Vite、现有 OCR/视觉定位器、ScriptFlow v1。

---

## 执行环境

执行本文所有 `pnpm` 命令前先切换到项目要求的 Node.js 24；否则存储测试会因 Node 18 不包含 `node:sqlite` 而产生与代码无关的失败。

```bash
export PATH=/Users/eeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node --version
```

预期 Node 版本：`v24.x`。

## 一、产品决策

### 1. 两条主线的优先级

第一阶段只以“生成与执行主线”是否可靠作为发布标准：

1. 用户输入明确操作时，系统完整保留操作顺序和动作类型。
2. 用户只描述模糊目标时，系统只使用已验证用例、导航索引和页面目录补齐路径。
3. 无法安全补齐时要求用户补充操作过程，不猜测、不读取当前设备辅助规划。
4. 生成结果经过 schema、语义约束、参数和结果验证检查后才允许执行。
5. 执行器处理当前屏定位、屏外查找、页面验证、受控恢复和失败归因。

第二阶段才启用“持续学习主线”：

1. 从已验证成功运行中采集页面、交互和导航证据。
2. 多次运行聚合，排除动态文本、敏感数据、坐标和一次性内容。
3. 高歧义候选由 AI 提出身份建议，确定性规则负责冲突检查和发布。
4. 已发布资产持续跟踪健康度，失效后停止复用，不直接覆盖旧资产。

持续学习不仅降低描述成本，还为模糊目标补齐路径、提高定位稳定性、减少 AI 自由发挥并支持 App 升级后的资产失效诊断。但它不是测试执行的前置条件，也不能在第一阶段掩盖执行器缺陷。

### 2. 三态学习模式

| 模式 | 生成/执行读取现有 active 资产 | 新建学习会话与候选 | 聚合证据 | 调用学习 AI | 发布新资产 | 新候选影响执行 |
| --- | --- | --- | --- | --- | --- | --- |
| `disabled` | 是 | 否 | 否 | 否 | 否 | 否 |
| `shadow` | 是 | 是 | 是 | 否 | 否 | 否 |
| `active` | 是 | 是 | 是 | 达到门槛时 | 通过校验后 | 仅 active 资产可以 |

规则：

- 生产源码常量 `ASSET_LEARNING_MODE` 必须默认并暂时固定为 `disabled`。
- 不提供数据库设置、HTTP API、前端控件或环境变量覆盖，防止功能验收前被误开启。
- 代码模式只控制新证据和新资产生命周期，不关闭现有可靠资产读取。
- `shadow` 中即使聚合状态达到 ready，也不执行 AI 分析和 promotion。
- 从 `shadow` 切到 `active` 后，可以处理已经达到门槛的存量聚合。
- 从 `active` 切回 `disabled` 不删除资产或候选，只停止新学习工作。
- 三种模式都必须保持 App ID 与平台隔离。
- 测试可以注入模式验证边界，正式服务只能读取源码常量；资产本身继续按 App ID 和平台隔离。

### 3. 阶段准入标准

第一阶段满足以下条件后，才允许通过独立代码提交把常量改为 `shadow`：

- 代表性明确流程中，用户动作保留率为 100%。
- 已知文字、系统控件、常见图标和屏外内容四类目标都能稳定执行。
- 结果页未录入时，存在稳定 `assertText` 可执行；没有结果 oracle 时会明确要求补充。
- 页面验证不能把 unknown 或低置信候选判成已到达。
- 任意当前状态进入测试时，恢复行为有界，不会连续返回到系统桌面。
- 失败报告能区分规划缺口、参数缺失、定位失败、页面验证失败、离开 App、App 异常和基础设施异常。
- Node 24 下全量单元测试、类型检查和 Dashboard 构建通过。
- ClassIn Android 真实设备代表集连续 20 次执行成功率不低于 95%，且不存在错误点击后被误判通过。

`shadow` 满足以下条件后，才允许通过独立代码提交把常量改为 `active`：

- 每类候选至少覆盖 3 次独立成功运行和 2 份不同截图证据。
- 页面候选冲突率低于 1%，并且没有动态账号、班级名、日期、数量被写成页面唯一身份。
- 交互候选不含坐标、区域或敏感数据。
- 导航候选同时具备已知来源页、成功语义操作、已知目标页和通过的目标页验证。
- 回放影子候选时不会改变同一测试的目标选择结果。
- AI 学习调用次数、耗时和失败率可观测，AI 不可用不会影响普通测试执行。

## 二、文件边界

### 新建文件

- `platform/apps/server/src/asset-learning-mode.ts`：三态源码常量以及采集、发布边界函数。
- `platform/apps/server/src/asset-learning-mode.test.ts`：锁定生产默认关闭和三态行为。
- `docs/test/plans/generation-execution-phase-1.md`：真实设备第一阶段用例矩阵和逐次结果记录。
- `docs/test/plans/asset-learning-shadow-phase-2.md`：影子学习质量、冲突率和 AI 调用统计记录。

### 修改文件

- `platform/apps/server/src/storage.ts`：在运行结束时按注入或生产代码模式决定是否创建学习证据。
- `platform/apps/server/src/automatic-asset-learning.ts`：仅 active 执行分析与发布。
- `platform/apps/server/src/automatic-asset-learning-runtime.ts`：删除旧布尔环境开关，固定读取生产源码常量。
- `platform/apps/server/src/automatic-asset-learning.test.ts`：disabled、shadow、active 的后台行为测试。
- `platform/apps/server/src/script-flow-ai-planner.ts`：第一阶段生成约束和失败分类。
- `platform/apps/server/src/script-flow-ai-planner.test.ts`：明确操作、模糊目标、混合请求和结果 oracle 测试。
- `platform/packages/script-flow/src/types.ts`：统一可搜索目标动作的搜索策略。
- `platform/packages/script-flow/src/parser.ts`：搜索策略 schema 校验。
- `platform/packages/script-flow/src/compiler.ts`：把统一搜索策略编译到执行计划。
- `platform/packages/script-flow/src/parser.test.ts`：输入、选择和清空动作的搜索策略测试。
- `platform/packages/script-flow/src/compiler.test.ts`：搜索策略编译测试。
- `platform/apps/server/src/script-target-resolver.ts`：统一当前屏优先和有界滚动查找。
- `platform/apps/server/src/script-target-resolver.test.ts`：屏内、屏外、固定栏和滚动边界测试。
- `platform/apps/server/src/semantic-locator.ts`：文字、图标、控件的唯一性和歧义处理。
- `platform/apps/server/src/semantic-locator.test.ts`：同文案、多图标和遮罩层测试。
- `platform/apps/server/src/page-state-service.ts`：严格页面身份判定和 unknown 结果。
- `platform/apps/server/src/page-state-service.test.ts`：重复稳定证据、动态内容和低置信候选测试。
- `platform/apps/server/src/automation-runner.ts`：有界恢复、离开 App 保护和失败元数据。
- `platform/apps/server/src/automation-runner.test.ts`：登录页/主页双根、未知页、系统桌面和恢复上限测试。
- `platform/apps/server/src/script-flow-api.ts`：执行前检查和公开错误分类。
- `platform/apps/server/src/script-flow-api.test.ts`：生成、预览、执行门禁的 API 回归。
- `platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`：第一阶段错误提示和执行状态。
- `platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`：可执行、需补充和失败分类视图测试。
- `platform/apps/dashboard/src/components/RunResultsPanel.tsx`：资产过期与执行失败的用户可读诊断。
- `platform/apps/dashboard/src/components/RunResultsPanel.test.ts`：诊断映射测试。
- `docs/product/mobile-automation-platform/adr/0004-trial-run-asset-learning.md`：记录三态模式和分阶段准入决策。
- `docs/product/mobile-automation-platform/spec/script-flow-v1.md`：记录搜索、恢复和结果验证契约。

## 三、实施任务

### 任务 1：建立代码级学习模式总闸门

**文件：**
- 创建：`platform/apps/server/src/asset-learning-mode.ts`
- 创建：`platform/apps/server/src/asset-learning-mode.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/learning-storage.test.ts`
- 修改：`platform/apps/server/src/automatic-asset-learning.ts`
- 修改：`platform/apps/server/src/automatic-asset-learning-runtime.ts`
- 修改：`platform/apps/server/src/automatic-asset-learning.test.ts`

- [x] **步骤 1：先写失败测试锁定生产默认关闭**

```ts
expect(ASSET_LEARNING_MODE).toBe("disabled");
expect(shouldCollectAssetLearning("disabled")).toBe(false);
expect(shouldPublishAssetLearning("shadow")).toBe(false);
expect(shouldPublishAssetLearning("active")).toBe(true);
```

- [x] **步骤 2：验证 disabled 下不创建学习会话**

用测试注入 `assetLearningMode: "disabled"`，完成 trial run 后断言 session 和 aggregate 均不存在。现有学习测试显式注入 active，不改变其原有验证目标。

- [x] **步骤 3：实现生产代码常量和运行结束闸门**

```ts
export type AssetLearningMode = "disabled" | "shadow" | "active";
export const ASSET_LEARNING_MODE: AssetLearningMode = "disabled";
```

`Storage` 默认读取该常量；仅测试构造参数可以覆盖。运行健康统计保持启用，但只有 shadow/active 可以创建学习证据。

- [x] **步骤 4：禁止后台在 disabled/shadow 下分析和发布**

`AutomaticAssetLearningService` 仅在 `shouldPublishAssetLearning(mode)` 为 true 时启动扫描和执行 `runOnce()`。运行时直接读取源码常量，不读取 `ASSET_LEARNING_ENABLED` 或其他模式环境变量。

- [x] **步骤 5：运行聚焦测试**

运行：

```bash
pnpm vitest run platform/apps/server/src/asset-learning-mode.test.ts platform/apps/server/src/automatic-asset-learning.test.ts platform/apps/server/src/learning-storage.test.ts
```

结果：3 个测试文件、28 项测试通过。

- [x] **步骤 6：提交代码级总闸门**

```bash
git add platform/apps/server/src/asset-learning-mode.ts platform/apps/server/src/asset-learning-mode.test.ts platform/apps/server/src/storage.ts platform/apps/server/src/learning-storage.test.ts platform/apps/server/src/automatic-asset-learning.ts platform/apps/server/src/automatic-asset-learning-runtime.ts platform/apps/server/src/automatic-asset-learning.test.ts docs/superpowers/plans/2026-07-31-generation-execution-first-learning-modes.md
git commit -m "feat: 默认关闭持续学习链路"
```

### 任务 2：完成生成阶段的确定性合同

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.test.ts`

- [x] **步骤 1：补齐四类输入测试**

每类至少包含一个正例和一个拒绝例：

1. 明确流程：严格保留点击、输入、滑动、系统返回和结果断言顺序。
2. 模糊目标：只使用已验证的用例或导航索引。
3. 混合流程：明确部分不可被资产替代，只补模糊缺口。
4. 未知结果页：有稳定结果文字时生成 `assertText`；没有 oracle 时返回 clarification。

- [x] **步骤 2：运行测试并确认新增边界失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-planner.test.ts
```

- [x] **步骤 3：实现生成后确定性检查**

检查顺序固定为：

```text
AI JSON 解析
-> ScriptFlow schema
-> 明确操作保留
-> App/平台隔离
-> reachPage/runFlow 可达性
-> 必填参数
-> 结果 oracle
-> 允许执行或要求补充
```

内部页面 ID 只能进入结构化草稿，不出现在面向用户的 clarification 文案中。

- [x] **步骤 4：运行测试并确认通过**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-ai-planner.test.ts platform/apps/server/src/script-flow-api.test.ts
```

- [x] **步骤 5：提交生成合同**

```bash
git add platform/apps/server/src/script-flow-ai-planner.ts platform/apps/server/src/script-flow-ai-planner.test.ts
git commit -m "fix: 完善 AI 测试生成确定性门禁"
```

### 任务 3：统一所有目标动作的屏外查找语义

**文件：**
- 修改：`platform/packages/script-flow/src/types.ts`
- 修改：`platform/packages/script-flow/src/parser.ts`
- 修改：`platform/packages/script-flow/src/compiler.ts`
- 修改：`platform/packages/script-flow/src/parser.test.ts`
- 修改：`platform/packages/script-flow/src/compiler.test.ts`
- 修改：`platform/apps/server/src/script-target-resolver.ts`
- 修改：`platform/apps/server/src/script-target-resolver.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`

- [x] **步骤 1：编写 input、clear、select 的 search 失败测试**

```yaml
- id: fill-title
  input:
    target: { text: "课堂名称", control: input }
    value: "自动化课堂"
    search: { mode: auto, direction: down, maxSwipes: 6 }
```

断言 parser 接受，compiler 保留，执行器先查当前屏，找不到才滚动。

- [x] **步骤 2：编写固定栏和歧义目标测试**

- `area: top`、`area: bottom`、弹窗和临时菜单强制 `visibleOnly`。
- 同屏存在两个“公告”时，不因任一文字命中直接点击；需要 area、position、control 或上下文消歧。
- 滚动扫描到边界后停止，不超过 `maxSwipes`。

- [x] **步骤 3：运行测试并确认失败**

运行：

```bash
pnpm vitest run platform/packages/script-flow/src/parser.test.ts platform/packages/script-flow/src/compiler.test.ts platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/semantic-locator.test.ts
```

- [x] **步骤 4：实现统一搜索合同**

`search: auto` 表示执行期许可，不表示生成期知道目标在屏外：

1. 当前截图定位。
2. 唯一命中则执行。
3. 未命中且允许滚动时，按方向有界扫描。
4. 多个候选无法消歧时失败，不选择最高分碰运气。
5. 找到目标后执行动作并继续页面/文本结果验证。

- [x] **步骤 5：运行测试并确认通过**

运行任务 3 步骤 3 的同一命令，预期全部通过。

- [x] **步骤 6：提交统一目标搜索**

```bash
git add platform/packages/script-flow/src platform/apps/server/src/script-target-resolver.ts platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/semantic-locator.ts platform/apps/server/src/semantic-locator.test.ts
git commit -m "feat: 统一语义目标的屏内与屏外查找"
```

### 任务 4：收紧页面验证和任意状态恢复

**文件：**
- 修改：`platform/apps/server/src/page-state-service.ts`
- 修改：`platform/apps/server/src/page-state-service.test.ts`
- 修改：`platform/apps/server/src/automation-runner.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`
- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/script-flow-runner.test.ts`

- [x] **步骤 1：编写页面身份冲突测试**

覆盖两个页面共享“教学方案”等稳定文字、账号/班级名动态变化、遮罩提示和半屏弹层。共享证据不能单独确认页面，低置信结果返回 unknown。

- [x] **步骤 2：编写多入口根页面恢复测试**

导航根不是固定主页。测试登录页和教师主页均可成为停止恢复的 anchor；返回导致离开目标 App 时立即停止并报 `recovery_left_app`，不能继续返回到桌面。

- [x] **步骤 3：运行测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/page-state-service.test.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/script-flow-runner.test.ts
```

- [x] **步骤 4：实现严格匹配与恢复顺序**

```text
识别当前页面
-> 已在目标页：完成
-> 当前页有已验证路径：执行路径
-> 当前页未知：有界系统返回
-> 命中任一声明根页面：从导航索引继续
-> 离开 App / 达到上限：失败并保留准确原因
```

不得把“固定起点是目标页”当成设备实时状态。

- [x] **步骤 5：运行测试并确认通过**

运行任务 4 步骤 3 的同一命令，预期全部通过。

- [x] **步骤 6：提交页面与恢复逻辑**

```bash
git add platform/apps/server/src/page-state-service.ts platform/apps/server/src/page-state-service.test.ts platform/apps/server/src/automation-runner.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/script-flow-runner.ts platform/apps/server/src/script-flow-runner.test.ts
git commit -m "fix: 收紧页面识别与有界恢复"
```

### 任务 5：形成可操作的失败分类和第一阶段验收

**文件：**
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/script-flow-api.test.ts`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/components/RunResultsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/RunResultsPanel.test.ts`
- 创建：`docs/test/plans/generation-execution-phase-1.md`

- [ ] **步骤 1：定义并测试公开失败类型**

```ts
type PublicExecutionFailureKind =
  | "needs_clarification"
  | "missing_parameter"
  | "target_not_found"
  | "target_ambiguous"
  | "page_not_recognized"
  | "result_not_verified"
  | "left_target_app"
  | "app_failure"
  | "infrastructure_failure";
```

用户提示只说明发生了什么和下一步需要补充什么，不显示内部页面 ID、堆栈或 locator payload。

- [ ] **步骤 2：运行 API 和前端测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-api.test.ts platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx platform/apps/dashboard/src/components/RunResultsPanel.test.ts
```

- [ ] **步骤 3：实现失败映射和界面**

报告保留完整技术细节；AI 生成测试页只显示简短说明和可执行动作，例如补充操作过程、补充参数、查看报告或重新执行。

- [ ] **步骤 4：建立真实设备矩阵**

`docs/test/plans/generation-execution-phase-1.md` 固定记录以下 20 次连续运行：登录、退出登录、主页加号进入添加好友、进入指定班级、屏外教学方案、创建课堂但不发布、公告页、成长页课堂报告、未知结果页文字断言和离开 App 恢复。

- [ ] **步骤 5：运行完整门禁**

运行：

```bash
export PATH=/Users/eeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
pnpm test
pnpm --filter @mobile-automation/dashboard build
```

预期：全量测试、类型检查和构建通过。

- [ ] **步骤 6：完成真实设备验收**

成功标准：20 次中至少 19 次通过，唯一一次失败必须被正确归因；任何误点后误判通过都视为阶段失败。

- [ ] **步骤 7：提交第一阶段闭环**

```bash
git add platform/apps/server/src/script-flow-api.ts platform/apps/server/src/script-flow-api.test.ts platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx platform/apps/dashboard/src/components/RunResultsPanel.tsx platform/apps/dashboard/src/components/RunResultsPanel.test.ts docs/test/plans/generation-execution-phase-1.md
git commit -m "feat: 完成测试生成执行第一阶段闭环"
```

### 任务 6：第一阶段通过后进入 shadow 并扩展全过程证据

**前置条件：** 任务 5 的真实设备验收已通过，并由项目负责人通过独立代码提交把 `ASSET_LEARNING_MODE` 从 disabled 改为 shadow。

**文件：**
- 修改：`platform/apps/server/src/automation-runner.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`
- 修改：`platform/apps/server/src/trial-page-learning.ts`
- 修改：`platform/apps/server/src/trial-page-learning.test.ts`
- 修改：`platform/apps/server/src/trial-interaction-learning.ts`
- 修改：`platform/apps/server/src/trial-interaction-learning.test.ts`
- 修改：`platform/apps/server/src/trial-navigation-learning.ts`
- 修改：`platform/apps/server/src/learning-storage.test.ts`
- 创建：`docs/test/plans/asset-learning-shadow-phase-2.md`

- [ ] **步骤 1：编写每步后证据采集测试**

断言成功步骤记录已有 after screenshot、OCR 摘要、语义目标、`onPage`、`expectPage` 和结果验证引用；不得为学习额外截一次图或重复 OCR。

- [ ] **步骤 2：编写动态内容过滤测试**

账号、手机号、邮箱、密码、日期、时间、班级实例名、数量和长数字不得进入稳定页面身份或通用交互资产。

- [ ] **步骤 3：运行测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/trial-page-learning.test.ts platform/apps/server/src/trial-interaction-learning.test.ts platform/apps/server/src/learning-storage.test.ts
```

- [ ] **步骤 4：实现全过程影子采集**

只复用正常报告已有证据。shadow 只更新 collecting/ready/awaiting_ai 状态，不调用 AI、不创建 active 资产、不写导航索引。

- [ ] **步骤 5：运行测试并确认通过**

运行任务 6 步骤 3 的同一命令，预期全部通过。

- [ ] **步骤 6：记录影子质量**

在 `docs/test/plans/asset-learning-shadow-phase-2.md` 记录候选总数、重复率、冲突率、动态内容拦截数、缺少证据数和按 App/平台隔离结果。

- [ ] **步骤 7：提交影子学习**

```bash
git add platform/apps/server/src/automation-runner.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/trial-page-learning.ts platform/apps/server/src/trial-page-learning.test.ts platform/apps/server/src/trial-interaction-learning.ts platform/apps/server/src/trial-interaction-learning.test.ts platform/apps/server/src/trial-navigation-learning.ts platform/apps/server/src/learning-storage.test.ts docs/test/plans/asset-learning-shadow-phase-2.md
git commit -m "feat: 扩展影子模式全过程学习证据"
```

### 任务 7：通过 AI 提案和确定性校验发布资产

**前置条件：** shadow 数据满足本文“阶段准入标准”。

**文件：**
- 修改：`platform/apps/server/src/asset-learning-ai.ts`
- 修改：`platform/apps/server/src/asset-learning-ai.test.ts`
- 修改：`platform/apps/server/src/automatic-asset-learning.ts`
- 修改：`platform/apps/server/src/automatic-asset-learning.test.ts`
- 修改：`platform/apps/server/src/learning-lifecycle.ts`
- 修改：`platform/apps/server/src/learning-lifecycle.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/learning-storage.test.ts`

- [ ] **步骤 1：编写 AI 权限边界测试**

AI 只能返回 `approve | observe | reject` 和结构化候选建议；不能直接写数据库、降低最小运行数、绕过冲突检查或发布坐标资产。

- [ ] **步骤 2：编写页面冲突和 interaction 唯一性测试**

共享稳定文字、同页相同语义目标、多资产命中、App/平台不一致均拒绝 promotion。

- [ ] **步骤 3：运行测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/asset-learning-ai.test.ts platform/apps/server/src/automatic-asset-learning.test.ts platform/apps/server/src/learning-lifecycle.test.ts platform/apps/server/src/learning-storage.test.ts
```

- [ ] **步骤 4：实现 active 发布链路**

```text
达到确定性门槛
-> 高歧义候选调用一次 AI
-> AI 提出建议
-> schema 校验
-> 隐私过滤
-> App/平台隔离
-> 冲突与唯一性检查
-> 原子发布 active 资产
```

AI 请求失败将 aggregate 标记为 `analysis_failed`，普通测试不失败。

- [ ] **步骤 5：运行测试并确认通过**

运行任务 7 步骤 3 的同一命令，预期全部通过。

- [ ] **步骤 6：提交正式学习发布链路**

```bash
git add platform/apps/server/src/asset-learning-ai.ts platform/apps/server/src/asset-learning-ai.test.ts platform/apps/server/src/automatic-asset-learning.ts platform/apps/server/src/automatic-asset-learning.test.ts platform/apps/server/src/learning-lifecycle.ts platform/apps/server/src/learning-lifecycle.test.ts platform/apps/server/src/storage.ts platform/apps/server/src/learning-storage.test.ts
git commit -m "feat: 完成持续学习资产安全发布"
```

### 任务 8：补齐资产健康、保留策略和 active 灰度

**文件：**
- 修改：`platform/apps/server/src/interaction-asset-health.ts`
- 修改：`platform/apps/server/src/interaction-asset-health.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`
- 修改：`platform/apps/dashboard/src/components/RunResultsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/RunResultsPanel.test.ts`
- 修改：`docs/product/mobile-automation-platform/adr/0004-trial-run-asset-learning.md`
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] **步骤 1：编写资产失效与非资产失败测试**

同一 active 交互资产连续 3 次明确 locator failure 后进入 degraded；ANR、网络失败、业务断言失败和设备断开不计入资产健康。

- [ ] **步骤 2：编写数据保留测试**

保留 active/degraded 资产及其最小证据；清理过期 collecting/rejected/analysis_failed 聚合和无引用学习截图。正式 Run 报告继续遵循现有附件保留策略。

- [ ] **步骤 3：运行测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/interaction-asset-health.test.ts platform/apps/server/src/storage.test.ts platform/apps/dashboard/src/components/RunResultsPanel.test.ts
```

- [ ] **步骤 4：实现健康提示和保留策略**

报告提示“某个操作的复用定位经验可能已过期”，并允许用户通过新的自然语言操作重新生成和执行；成功的新证据仍需经过聚合门槛，不能一次运行直接覆盖旧资产。

- [ ] **步骤 5：运行完整门禁**

运行：

```bash
export PATH=/Users/eeo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
pnpm test
pnpm --filter @mobile-automation/dashboard build
```

- [ ] **步骤 6：active 灰度验证**

先通过独立代码提交只在本地 ClassIn Android 数据集把 `ASSET_LEARNING_MODE` 改为 active。确认 AI 学习失败不阻塞测试、资产命中唯一、未出现跨 App 数据、连续 20 次代表性执行不低于 shadow 阶段成功率后，才保留 active。

- [ ] **步骤 7：提交第二阶段闭环**

```bash
git add platform/apps/server/src/interaction-asset-health.ts platform/apps/server/src/interaction-asset-health.test.ts platform/apps/server/src/storage.ts platform/apps/server/src/storage.test.ts platform/apps/dashboard/src/components/RunResultsPanel.tsx platform/apps/dashboard/src/components/RunResultsPanel.test.ts docs/product/mobile-automation-platform/adr/0004-trial-run-asset-learning.md docs/product/mobile-automation-platform/spec/script-flow-v1.md
git commit -m "feat: 完成持续学习健康治理与灰度准入"
```

## 四、最终验收流程

1. 新安装或清空学习数据后保持 `disabled`。
2. 不录页面/元素资产，输入完整明确操作，生成并执行测试。
3. 输入模糊目标，验证仅从已存在的可靠能力补齐；无能力时要求补充。
4. 验证 disabled 下数据库不新增 learning session、candidate、aggregate，AI 学习调用为零。
5. 通过独立代码提交把 `ASSET_LEARNING_MODE` 改为 shadow，重复执行代表流程，验证只积累候选且不发布、不影响计划摘要。
6. 运行影子质量报告并满足准入门槛。
7. 通过独立代码提交把 `ASSET_LEARNING_MODE` 改为 active，验证达到门槛的聚合按规则发布。
8. 模拟 App UI 变化导致 locator failure，验证资产降级且报告给出可操作提示。
9. 通过独立代码提交改回 disabled，验证普通生成和执行继续工作，已有可靠 active 资产仍可读取。

## 五、明确不在本方案中实现

- 不恢复 `ref`、元素资产 ID、固定坐标或截图区域脚本。
- 不让用户维护 YAML 或人工审核每一个学习候选。
- 不在生成阶段读取或操作当前设备。
- 不提供用户可操作的学习设置、HTTP API 或环境变量覆盖。
- 不为每个 App 增加独立学习开关；模式只允许通过源码评审变更。
- 不在 Android 第一阶段通过前并行开展 iOS、鸿蒙和 Flutter 驱动适配。
- 不把一次成功执行直接视为可发布资产。
- 不让学习 AI 参与普通测试的每一步执行。
