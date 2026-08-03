# ScriptFlow 脚本编排器实现方案

> **对于智能体：** 必需子技能：使用 superpowers:executing-plans 逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 将 AI 步骤审查升级为可人工独立使用的 ScriptFlow 编排器，并提供不会误验证完整用例的单步试跑和从指定步骤续跑能力。

**架构：** 前端继续以 `ScriptFlowDocument` 为唯一编辑数据源，所有编辑立即重新序列化为 YAML 并把草稿降级为待试跑状态。服务端新增编排试跑入口，在完整文档编译后按源步骤选择局部执行计划，以 `step_trial` 标记执行快照并强制保持当前设备状态；现有执行控制接口负责暂停、下一步、连续执行和停止。

**技术栈：** React 19、TypeScript、Express、Vitest、现有 `@mobile-automation/script-flow` 编译器与 AutomationRunner。

---

### 任务 1: 编排器文档编辑模型

**文件：**
- 创建：`platform/apps/dashboard/src/components/script-flow-orchestrator.ts`
- 创建：`platform/apps/dashboard/src/components/script-flow-orchestrator.test.ts`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`

- [x] **步骤 1: 编写失败的编辑行为测试**

覆盖以下可观察行为：

```ts
it("adds, duplicates, moves, and removes steps without duplicate ids", () => {
  const added = addDraftStep(draft, undefined, "tap");
  const duplicated = duplicateDraftStep(added.draft, added.stepKey);
  const moved = moveDraftStep(duplicated.draft, duplicated.stepKey, "up");
  const removed = removeDraftStep(moved, duplicated.stepKey);
  expect(stepReviewItems(removed.document).map((step) => step.id)).toEqual(["tap-target"]);
});

it("changes an executable action and edits its action-specific values", () => {
  const changed = updateDraftStep(draft, "0:tap-target", {
    action: "inputText",
    name: "填写课堂名称",
    value: "${classroomName}"
  });
  expect(changed.document.steps[0]).toMatchObject({
    name: "填写课堂名称",
    inputText: { target: { control: "textField" }, value: "${classroomName}" }
  });
});
```

- [x] **步骤 2: 运行测试并确认因编辑 API 尚不存在而失败**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/script-flow-orchestrator.test.ts
```

预期：FAIL，提示 `addDraftStep`、`updateDraftStep` 等导出不存在。

- [x] **步骤 3: 实现不可变文档编辑函数**

`script-flow-orchestrator.ts` 负责：

```ts
export function updateDraftStep(draft, stepKey, patch): GeneratedDraftLike;
export function addDraftStep(draft, afterStepKey, action): { draft: GeneratedDraftLike; stepKey: string };
export function duplicateDraftStep(draft, stepKey): { draft: GeneratedDraftLike; stepKey: string };
export function moveDraftStep(draft, stepKey, direction): GeneratedDraftLike;
export function removeDraftStep(draft, stepKey): GeneratedDraftLike;
```

每次修改都深拷贝文档、保持未知字段、重新生成唯一步骤 ID、调用 `serializeScriptFlow`，删除旧 `verification` 并将状态设为 `trial_ready`。移动只允许在同一父级数组内进行，避免破坏 `repeat` / `when` 的结构语义。

- [x] **步骤 4: 运行编辑模型测试并确认通过**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/script-flow-orchestrator.test.ts
```

预期：PASS。

### 任务 2: 局部执行计划与严格脚本语义

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/script-flow-runner.test.ts`
- 修改：`platform/apps/server/src/learning-run-eligibility.test.ts`
- 修改：`platform/apps/server/src/storage.ts`

- [x] **步骤 1: 编写失败的局部计划测试**

```ts
it("selects one source step without entry preparation or outcome assertions", () => {
  const selected = selectScriptExecutionSteps(plan, {
    startStepId: "fill-name",
    endStepId: "fill-name"
  });
  expect(selected.steps.map((step) => step.source.stepId)).toEqual(["fill-name"]);
});

it("selects the remaining executable steps from a source step", () => {
  const selected = selectScriptExecutionSteps(plan, { startStepId: "fill-name" });
  expect(selected.steps.map((step) => step.source.stepId)).toEqual(["fill-name", "assert-created"]);
});
```

同时增加资格测试，断言 `executionPurpose: "step_trial"` 即使通过也不能用于学习。

- [x] **步骤 2: 运行服务端测试并确认失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-runner.test.ts platform/apps/server/src/learning-run-eligibility.test.ts
```

预期：FAIL，提示局部选择函数和 `step_trial` 类型不存在。

- [x] **步骤 3: 实现局部计划选择与执行快照类型**

将执行目的扩展为：

```ts
export type ScriptFlowExecutionPurpose = "trial" | "step_trial" | "normal";
```

`ScriptFlowRunner.start` 接收：

```ts
stepSelection?: { startStepId: string; endStepId?: string };
startStrategy?: FlowStartStrategy;
```

真实计划和脱敏计划使用相同下标截取；局部计划重新编号后再解析为 ActionStep。找不到起止源步骤、结束步骤位于开始步骤之前或选中范围为空时返回明确错误。存储反序列化保留 `step_trial`，但现有完整试运行验证、学习会话和资产学习逻辑只接受 `trial` / 已验证的 `normal`。

- [x] **步骤 4: 运行局部计划与学习资格测试并确认通过**

运行同上，预期：PASS。

### 任务 3: 编排试跑 API

**文件：**
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/script-flow-api.test.ts`

- [x] **步骤 1: 编写失败的 API 测试**

```ts
it("starts an isolated step trial without recording a temporary full test", async () => {
  const response = await post(context.baseUrl, "/api/script-flow-drafts/step-runs", {
    sourceYaml,
    deviceSerial: "device-1",
    parameters: {},
    startStepId: "fill-name",
    endStepId: "fill-name"
  });
  expect(response.status).toBe(202);
  expect(context.runner.inputs[0]).toMatchObject({
    executionPurpose: "step_trial",
    stepSelection: { startStepId: "fill-name", endStepId: "fill-name" },
    startStrategy: "keep_current"
  });
});
```

另测未知字段、缺少步骤 ID 和不存在步骤均返回 400。

- [x] **步骤 2: 运行 API 测试并确认 404 失败**

运行：

```bash
pnpm vitest run platform/apps/server/src/script-flow-api.test.ts
```

预期：FAIL，状态为 404。

- [x] **步骤 3: 实现 `/api/script-flow-drafts/step-runs`**

路由严格接受 `sourceYaml`、`deviceSerial`、`parameters`、`startStepId`、可选 `endStepId`、`pauseAfterEachStep` 和监控配置。服务端在一次请求内解析、编译依赖并启动 `step_trial`，不调用 `recordTemporaryTest`；强制 `keep_current`、单次执行、停止于失败，并返回 `{ run }`。

- [x] **步骤 4: 运行 API 测试并确认通过**

运行同上，预期：PASS。

### 任务 4: 可交互脚本编排器 UI

**文件：**
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`

- [x] **步骤 1: 编写失败的 UI 静态测试**

断言生成草稿出现“脚本编排”、动作类型、步骤名称、定位方式、输入值、添加/复制/删除/上下移动按钮，以及“试跑此步”“从此处试跑”。结构步骤保留展示但禁用局部试跑。

- [x] **步骤 2: 运行 UI 测试并确认缺少控件而失败**

运行：

```bash
pnpm vitest run platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx
```

预期：FAIL，页面仍只展示“步骤审查”。

- [x] **步骤 3: 实现编排器界面与确认失效规则**

将原步骤审查替换为线性步骤编排区域：

- 步骤头部提供确认框、名称、同级上下移动、复制和删除。
- 可执行步骤提供动作类型、所属部分、动作专属字段和完整语义定位字段。
- 新增步骤默认创建安全的 `tap` 草稿，必须补齐目标并确认后才能整条执行或保存。
- 任意字段编辑只取消当前步骤确认；增删、复制、排序清空全部确认。
- 历史测试也进入编排器，但已有完整执行记录的脚本默认不强制重新确认，编辑后重新进入确认状态。

- [x] **步骤 4: 接入步骤试跑与执行控制**

`试跑此步` 发送同一个 `startStepId` / `endStepId`；`从此处试跑` 只发送 `startStepId` 并设置 `pauseAfterEachStep: true`。运行暂停时显示“执行下一步”“连续执行”“停止”，失败后当前步骤保留可编辑，并提供“重试当前步”。局部运行结束后不请求学习摘要、不改变整条脚本验证状态。

- [x] **步骤 5: 运行 UI 测试并确认通过**

运行同上，预期：PASS。

### 任务 5: 完整验证与人工验收

**文件：**
- 修改：`docs/superpowers/plans/2026-08-03-script-flow-orchestrator.md`

- [x] **步骤 1: 运行相关测试**

```bash
pnpm vitest run platform/apps/dashboard/src/components/script-flow-orchestrator.test.ts platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx platform/apps/server/src/script-flow-runner.test.ts platform/apps/server/src/script-flow-api.test.ts platform/apps/server/src/learning-run-eligibility.test.ts
```

预期：全部 PASS。

- [x] **步骤 2: 运行全仓类型检查与测试**

```bash
pnpm test
```

预期：类型检查与 Vitest 全部 PASS。

- [x] **步骤 3: 启动开发服务并检查桌面和窄屏布局**

```bash
pnpm dev
```

访问 `http://localhost:5173`，验证步骤控件没有重叠，长名称能够换行或截断，编排区域可滚动。

- [x] **步骤 4: 使用连接设备验证关键路径**

生成一条至少三步的创建课堂草稿，依次验证：编辑定位后确认失效；单步试跑只执行一项；从第二步开始后自动暂停；“执行下一步”只推进一项；失败后修改并重试；局部通过后整条用例仍保持待验证。

### 任务 6: 三段编排与显式执行收敛

- [x] 编排器固定显示“前置准备、业务步骤、结果验证”，步骤默认确认并折叠，展开后编辑所属部分。
- [x] 新 AI 草稿用显式 `launchApp`、业务动作和断言步骤表达完整流程，不依赖 `start`、`entry` 或 `outcome` 触发隐藏动作。
- [x] 编译器不再从 `entry.page` 自动插入 `reachPage`，也不再从 `outcome.page` 自动插入断言。
- [x] `reachPage` 仅执行冻结导航索引中的可靠路径；当前页未知或无路径时失败，不按返回键试探。
- [x] 移除风险等级、危险关键词拦截和运行前风险确认；保留 schema、参数、目标合同和设备能力校验。
- [x] 历史 `risk` 字段读取后丢弃；历史 `start` 策略继续兼容，并在前置准备中明确展示。

### 任务 7: 用例级持续循环

- [x] 运行配置提供“单次执行、循环业务与验证、循环整个用例”三种方式。
- [x] 循环业务与验证时，前置准备只执行一次；循环整个用例时，全部步骤每轮执行。
- [x] 持续循环显示当前轮次并提供停止操作；未验证试运行不开放无限循环。
- [x] ScriptFlow `launchApp` 统一执行为保留数据的杀进程重启，并在编排器显示为“重启 App”。
