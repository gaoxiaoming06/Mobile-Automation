# 用例中心与 AI 用例工作台实现方案

> **对于智能体：** 必需子技能：使用 test-driven-development 逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 将面向用户的 ScriptFlow 编辑器改造成用例中心，并让 AI 工作台直接完成用例生成、临时执行、保存和自然语言修改。

**架构：** `ScriptFlow` 继续作为服务端内部的确定性执行格式，但前端不再显示或编辑 YAML。用例中心读取已保存用例的结构化详情并负责复用、执行和发起 AI 修改；AI 工作台持有未保存草稿，可通过草稿预检/运行接口直接执行，或通过现有持久化接口保存和更新。

**技术栈：** React、TypeScript、Express、Vitest、现有 ScriptFlow 编译器与执行器。

---

### 任务 1：定义草稿修改与临时执行 API

**文件：**
- 修改：`platform/apps/server/src/script-flow-ai-api.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/index.ts`
- 测试：`platform/apps/server/src/script-flow-ai-api.test.ts`
- 测试：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 测试：`platform/apps/server/src/script-flow-api.test.ts`

- [ ] 先写测试：AI 生成接口接受 `flowId + expectedVersion`，服务端读取现有用例作为修改上下文，并拒绝过期版本。
- [ ] 运行定向测试，确认失败来自接口尚未支持修改模式。
- [ ] 扩展 AI Planner 输入，将现有完整用例和用户修改要求一并提交给模型，并要求未提及内容保持不变。
- [ ] 先写测试：草稿预检和草稿运行不创建持久化用例，但使用同一份摘要和依赖快照执行。
- [ ] 运行定向测试，确认草稿路由尚不存在。
- [ ] 新增 `POST /api/script-flow-drafts/preview` 与 `POST /api/script-flow-drafts/runs`，复用现有编译、风险检查和执行器。
- [ ] 运行服务端定向测试并确认通过。

### 任务 2：将脚本用例重构为用例中心

**文件：**
- 创建：`platform/apps/dashboard/src/components/CaseCenterPanel.tsx`
- 创建：`platform/apps/dashboard/src/components/CaseCenterPanel.test.tsx`
- 删除：`platform/apps/dashboard/src/components/ScriptFlowsPanel.tsx`
- 删除：`platform/apps/dashboard/src/components/ScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/components/AppNav.tsx`
- 修改：`platform/apps/dashboard/src/components/AppNav.test.tsx`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`
- 修改：`platform/apps/dashboard/src/styles.css`

- [ ] 先写静态行为测试：导航显示“用例中心”，页面不包含 YAML、脚本编辑器、手工校验和手工保存入口。
- [ ] 运行组件测试并确认失败。
- [ ] 实现用例列表、业务说明、参数摘要和可读步骤详情。
- [ ] 保留已保存用例的预检、参数配置和执行能力，并提供“修改用例”与“AI 创建用例”入口。
- [ ] 删除旧 ScriptFlow YAML 编辑器组件和仅为编辑器服务的状态逻辑。
- [ ] 运行组件测试并确认通过。

### 任务 3：重构 AI 用例工作台

**文件：**
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`

- [ ] 先写组件测试：生成结果显示可读步骤，不显示 YAML，并提供“直接执行”和“保存到用例中心”。
- [ ] 先写组件测试：修改模式显示当前用例名称和修改说明入口，保存时更新原用例。
- [ ] 运行组件测试并确认失败。
- [ ] 实现新建/修改两种 AI 请求模式以及生成结果的业务步骤预览。
- [ ] 接入参数表单、设备选择、风险确认和草稿直接执行；运行记录跳转到执行结果。
- [ ] 接入新建保存与按版本更新，保存成功后返回并选中用例中心对应用例。
- [ ] 运行组件测试并确认通过。

### 任务 4：系统验证

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`

- [ ] 更新产品说明，明确用例是用户事实、ScriptFlow 是内部执行格式。
- [ ] 运行 `pnpm test`，预期全部测试通过。
- [ ] 运行 `pnpm build`，预期类型检查和前端生产构建通过。
- [ ] 运行 `git diff --check`，预期无空白错误。
- [ ] 检查 `/api/health` 和 `http://localhost:5173`，确认服务可继续试用。
