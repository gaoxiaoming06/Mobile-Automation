# ScriptFlow v1 清洁切换实现方案

> **对于智能体：** 必需子技能：使用 `subagent-driven-development`（推荐）或 `executing-plans` 逐个任务执行本方案。步骤使用复选框 (`- [ ]`) 追踪。每个生产行为先写失败测试，再实现，再做小步提交。

**目标：** 用 Maestro 式 ScriptFlow 取代 PageTransition、PageTask、MetaFunction、CompositeCase、旧 StructuredFlow 和自由组合用例链路，使页面资产只负责页面身份与可选公共定位器，脚本成为测试过程的唯一事实来源。

**架构：** 新增独立的 ScriptFlow 核心模型、YAML 解析器、编译器和执行器；抽出 PageStateService，为脚本步骤的 `onPage` 与 `expectPage` 提供 OCR/截图优先的页面验证。AI 与 MCP 只面向页面目录、公共定位器、已有脚本和脚本校验工具，不再查询或生成手工页面连接边。完成纵向链路后执行一次性数据库清理并删除旧用例代码，不提供兼容层、双写或旧执行入口。

**技术栈：** TypeScript、YAML、SQLite、Express、React、Vitest、现有 Android/iOS Driver、OCR、PageMatcher、SemanticStepResolver、AutomationRunner、Run/StepResult/Artifacts 报告链路。

---

## 不可变决策

1. ScriptFlow 是用例步骤、参数、风险确认和执行语义的唯一事实来源。
2. PageModel + PageMatcher 是页面身份的唯一事实来源；PageElement 只作为可选公共定位器。
3. 不再录入或维护 PageTransition、PageTask、MetaFunction、CompositeCase。
4. 不编写旧模型到新模型的运行时适配器，不双写新旧表，不保留旧执行 API。
5. 旧资产不自动转换。切换时直接删除旧用例数据；需要回看时使用开发前资产备份。
6. 页面连接关系只从 ScriptFlow 的 `onPage -> expectPage` 自动生成只读 TransitionIndex。
7. 规划阶段不实时识别设备页面；执行阶段才通过 PageStateService 验证 `onPage` / `expectPage`。
8. 页面验证默认采集截图 + OCR，不采集 UI Tree；只有显式声明的结构定位器需要时才按步骤采集 UI Tree。
9. 脚本不得保存绝对点击坐标。v1 目标只使用 OCR 文本或公共 PageElement。
10. 第一版不执行任意 JavaScript，不允许无法审计的表达式，只支持声明式参数引用、条件、循环和子流程。
11. 所有点击类动作默认进入确认边界，`risk: none` 不属于可写入的脚本语法；关键词只用于细分风险类别。
12. 预览输出 `planDigest` 并固定全部 `runFlow` 依赖版本；任何源码、依赖或参数变化都必须重新预览。
13. 网页只配置本机 Codex。外部 AI Provider 和密钥只允许来自环境变量，服务默认监听 `127.0.0.1`。

## 基线与恢复

- 代码基线：`bc6bf1a feat: 完善 AI 资产用例参数配置与流程规划`
- 开发分支：`codex/script-flow-v1`
- 页面资产备份：`~/.local/share/mobile-automation/backups/baseline-recorded-assets__branch-codex-script-flow-v1`
- 备份包含 SQLite 一致性快照和 `artifacts/assets`，不包含历史运行报告与视频。
- 数据清理一旦执行，不在运行时代码中提供恢复按钮；恢复动作是停止服务后用上述备份替换数据库与资产目录。

## 保留与删除边界

### 保留并复用

- `platform/packages/android-driver`、`platform/packages/ios-driver`
- `platform/apps/server/src/mobile-driver.ts`
- `platform/apps/server/src/observation-service.ts`
- `platform/apps/server/src/page-matcher.ts`
- `platform/apps/server/src/semantic-step-resolver.ts`
- `platform/apps/server/src/automation-runner.ts`
- `platform/apps/server/src/run-artifact-service.ts`
- `platform/packages/report-core`
- `platform/packages/shared` 中的 Device、ActionStep、Run、StepResult、Artifact、Metric、DeviceEvent 类型
- 页面节点、StateMatcher、页面视觉证据和 `assetRecordingPageElements`
- ParameterProfile / ParameterDataRecord，作为脚本运行参数的可选数据来源
- RuntimeInterceptor，作为执行期间临时弹窗和阻断状态处理器

### 完成切换后删除

- `platform/apps/server/src/free-composition.ts`
- `platform/apps/server/src/free-composition-api.ts`
- `platform/apps/server/src/free-composition-session.ts`
- `platform/apps/server/src/free-composition-current-page.ts`
- `platform/apps/server/src/free-composition-ai-planner.ts`
- `platform/apps/server/src/asset-composition.ts`
- `platform/apps/server/src/asset-composite-execution.ts`
- `platform/apps/server/src/page-task-assets.ts`
- `platform/apps/server/src/page-transition-assets.ts`
- `platform/apps/server/src/structured-flow-runner.ts`
- `platform/apps/server/src/test-rule-step.ts`
- 上述文件对应的测试文件
- `platform/apps/dashboard/src/components/AssetCompositionPanel.tsx`
- `platform/apps/dashboard/src/components/FreeCompositionPanel.tsx`
- 上述组件对应的测试和专属样式
- MCP 中的 Graph route / target node 执行工具

### 数据库一次性删除

- 表：`structured_flow_steps`、`structured_flows`
- 表：`asset_meta_functions`、`asset_composite_cases`
- 数据：全部 `operation_edges`、`edge_preconditions`、`edge_action_policies`、`edge_expectations`
- 数据：全部 `route_plans`、`route_plan_edges`
- 节点 metadata：`assetRecordingPageTasks`、页面连接边缓存、MetaFunction / CompositeCase 引用
- 保留 `business_nodes` 与 `state_matchers` 作为页面身份资产；在 PageAssetCatalog 切换完成后再决定是否把表名物理重命名，首轮不因命名重写稳定数据。

## ScriptFlow v1 文档形态

```yaml
version: 1
name: 指定班级创建课堂但不发布
app:
  id: cn.eeo.classin
  platform: android
start:
  strategy: restartApp
parameters:
  className:
    type: string
    label: 班级
    required: true
  lessonName:
    type: string
    label: 课堂名称
    required: true
  duration:
    type: number
    label: 课堂时长
    default: 30
steps:
  - id: open-class
    onPage: classin.teacher.home
    tap:
      target:
        ocrText: ${className}
    expectPage: classin.teacher.class.detail
  - id: open-create-lesson
    onPage: classin.teacher.class.detail
    tap:
      target:
        ocrText: 新建课堂
    expectPage: classin.teacher.lesson.create
  - id: fill-lesson-name
    onPage: classin.teacher.lesson.create
    inputText:
      target:
        pageElement: lesson-name-input
      value: ${lessonName}
  - id: select-duration
    onPage: classin.teacher.lesson.create
    selectText:
      target:
        pageElement: lesson-duration-picker
      value: ${duration}
  - id: verify-form
    assertPage: classin.teacher.lesson.create
```

## 任务 1：建立 ScriptFlow 核心包

**文件：**
- 创建：`platform/packages/script-flow/package.json`
- 创建：`platform/packages/script-flow/tsconfig.json`
- 创建：`platform/packages/script-flow/src/types.ts`
- 创建：`platform/packages/script-flow/src/parser.ts`
- 创建：`platform/packages/script-flow/src/validator.ts`
- 创建：`platform/packages/script-flow/src/compiler.ts`
- 创建：`platform/packages/script-flow/src/index.ts`
- 创建：`platform/packages/script-flow/src/parser.test.ts`
- 创建：`platform/packages/script-flow/src/compiler.test.ts`
- 修改：`pnpm-lock.yaml`

- [ ] **步骤 1：写 YAML 解析失败测试**

  覆盖合法文档、未知顶层字段、重复步骤 ID、空目标、未声明参数引用、非法 `onPage` / `expectPage`、绝对坐标、未知动作和循环上限。

  ```ts
  expect(() => parseScriptFlow(`
  version: 1
  name: invalid
  app: { id: cn.eeo.classin, platform: android }
  steps:
    - id: tap-by-coordinate
      tap: { target: { x: 100, y: 200 } }
  `)).toThrow(/absolute coordinates are not supported/i);
  ```

- [ ] **步骤 2：运行核心测试并确认失败**

  运行：`pnpm exec vitest run platform/packages/script-flow/src/parser.test.ts platform/packages/script-flow/src/compiler.test.ts`

  预期：测试因模块或导出不存在而失败。

- [ ] **步骤 3：定义严格联合类型**

  ```ts
  export type ScriptTarget = {
    ocrText?: string;
    pageElement?: string;
  };

  type ScriptStepBase = { id: string; onPage?: string; expectPage?: string };

  export type ScriptStep =
    | (ScriptStepBase & { launchApp: { appId?: string } })
    | (ScriptStepBase & { tap: { target: ScriptTarget } })
    | (ScriptStepBase & { inputText: { target: ScriptTarget; value: string } })
    | (ScriptStepBase & { clearText: { target: ScriptTarget } })
    | (ScriptStepBase & { selectText: { target: ScriptTarget; value: string } })
    | (ScriptStepBase & { swipe: { direction: "up" | "down" | "left" | "right"; distance?: number } })
    | (ScriptStepBase & { scrollUntilVisible: { target: ScriptTarget; direction?: "up" | "down"; maxSwipes?: number } })
    | (ScriptStepBase & { waitForPage: string; timeoutMs?: number })
    | (ScriptStepBase & { assertPage: string })
    | (ScriptStepBase & { runFlow: string; with?: Record<string, string | number | boolean> })
    | (ScriptStepBase & { repeat: { times: number | string; steps: ScriptStep[] } })
    | (ScriptStepBase & { when: { parameter: string; equals: string | number | boolean; steps: ScriptStep[] } });
  ```

- [ ] **步骤 4：实现 YAML 解析与严格校验**

  使用 `yaml` 包解析；解析器只接受 v1 字段，错误返回路径，例如 `steps[2].tap.target`。参数引用仅允许 `${name}`，并检查参数已声明。

- [ ] **步骤 5：实现编译器**

  编译输出 `ScriptExecutionPlan`，每个步骤显式包含动作、`onPageId`、`expectPageId`、参数引用、风险等级和源行号；`runFlow` 在编译期展开并检测递归。

- [ ] **步骤 6：验证核心包**

  运行：`pnpm exec vitest run platform/packages/script-flow/src`

  运行：`pnpm --filter @mobile-automation/script-flow typecheck`

- [ ] **步骤 7：提交核心模型**

  ```bash
  git add platform/packages/script-flow pnpm-lock.yaml
  git commit -m "feat: 新增 ScriptFlow v1 核心模型与编译器"
  ```

## 任务 2：抽出 PageAssetCatalog 与 PageStateService

**文件：**
- 创建：`platform/apps/server/src/page-asset-catalog.ts`
- 创建：`platform/apps/server/src/page-asset-catalog.test.ts`
- 创建：`platform/apps/server/src/page-state-service.ts`
- 创建：`platform/apps/server/src/page-state-service.test.ts`
- 修改：`platform/apps/server/src/page-matcher.ts`
- 修改：`platform/apps/server/src/page-matcher.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`

- [ ] **步骤 1：写页面目录测试**

  只返回 active、confirmed、nodeType=page 的 PageModel；公共 PageElement 从节点 metadata 读取；不得返回 operation edge 或 PageTask。

- [ ] **步骤 2：写页面验证测试**

  覆盖目标页命中、目标页未命中、目标页证据与相似页面冲突、App 外、OCR 失败、截图缺失和只在全局识别时扫描全部页面。

- [ ] **步骤 3：实现 PageAssetCatalog**

  ```ts
  export interface PageAssetCatalog {
    listPages(appId: string, platform: Platform): PageAssetSummary[];
    getPage(pageId: string): PageAsset | undefined;
    listLocators(pageId: string): PageElementLocator[];
    findConfusablePages(pageId: string): PageAssetSummary[];
  }
  ```

- [ ] **步骤 4：实现 PageStateService**

  ```ts
  export interface PageStateService {
    identifyCurrentPage(input: IdentifyPageInput): Promise<PageStateResult>;
    verifyExpectedPage(input: VerifyExpectedPageInput): Promise<PageStateResult>;
    waitForExpectedPage(input: WaitForExpectedPageInput): Promise<PageStateResult>;
  }
  ```

  `verifyExpectedPage` 只比较目标页和证据相似的冲突页；目标页通过阈值但与冲突页分差不足时返回 `multiple_candidates`，不得直接通过。`identifyCurrentPage` 只用于资产录制、显式诊断和执行恢复。

- [ ] **步骤 5：固定采集策略**

  默认 `includeScreenshot=true`、`includeOcr=true`、`includeUiTree=false`。公共定位器声明 `requiresUiTree=true` 时只在对应动作解析阶段采集 UI Tree，不影响页面身份识别。

- [ ] **步骤 6：验证页面服务**

  运行：`pnpm exec vitest run platform/apps/server/src/page-asset-catalog.test.ts platform/apps/server/src/page-state-service.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts`

- [ ] **步骤 7：提交页面身份服务**

  ```bash
  git add platform/apps/server/src/page-asset-catalog* platform/apps/server/src/page-state-service* platform/apps/server/src/page-matcher* platform/apps/server/src/storage*
  git commit -m "refactor: 抽出脚本执行页面身份服务"
  ```

## 任务 3：实现 ScriptFlow 执行器纵向链路

**文件：**
- 创建：`platform/apps/server/src/script-flow-runner.ts`
- 创建：`platform/apps/server/src/script-flow-runner.test.ts`
- 创建：`platform/apps/server/src/script-target-resolver.ts`
- 创建：`platform/apps/server/src/script-target-resolver.test.ts`
- 修改：`platform/apps/server/src/automation-runner.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`
- 修改：`platform/apps/server/src/step-expectations.ts`
- 修改：`platform/apps/server/src/step-expectations.test.ts`
- 修改：`platform/apps/server/src/semantic-step-resolver.ts`

- [ ] **步骤 1：写参数和风险预检测试**

  缺必填参数、类型错误、未确认发布/提交/删除/支付动作时禁止启动；默认值与 ParameterProfile 值按“本次输入 > Profile > 脚本默认值”合并。

- [ ] **步骤 2：写页面前后置验证测试**

  `onPage` 不满足时步骤失败且不点击；`expectPage` 在动作后轮询到目标页才通过；当前已在目标页只影响 `assertPage` / `waitForPage`，不得跳过包含动作的步骤。

- [ ] **步骤 3：给通用 expectation evaluator 注入页面验证器**

  ```ts
  type PageStateExpectationVerifier = (input: {
    serial: string;
    pageId: string;
    timeoutMs: number;
    screenshot?: ScreenshotCapture;
  }) => Promise<StepExpectationResult>;
  ```

  删除 `state_is is only supported by graph execution` 分支；没有注入 verifier 时才返回 unsupported。

- [ ] **步骤 4：实现 ScriptTargetResolver**

  目标解析只接受公共 PageElement 或 OCR 文本。任一策略未稳定定位时失败，不按历史坐标或录制区域中心点击。

- [ ] **步骤 5：实现 ScriptFlowRunner**

  Runner 将编译计划转换成 ActionStep，复用 AutomationRunner 的设备锁、视频、截图、性能、异常事件和 HTML 报告。每个 StepResult metadata 记录 `scriptFlowId`、`scriptVersion`、`scriptStepId`、`sourceLine`、`onPage`、`expectPage` 和实际定位策略。

- [ ] **步骤 6：跑第一条自动化纵向测试**

  流程：重启 ClassIn -> 主页选择 `${className}` -> 班级详情 -> 新建课堂 -> 输入 `${lessonName}` -> 选择 `${duration}` -> 保持未发布。

- [ ] **步骤 7：验证执行器**

  运行：`pnpm exec vitest run platform/apps/server/src/script-flow-runner.test.ts platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/step-expectations.test.ts`

- [ ] **步骤 8：提交执行器**

  ```bash
  git add platform/apps/server/src/script-flow-runner* platform/apps/server/src/script-target-resolver* platform/apps/server/src/automation-runner* platform/apps/server/src/step-expectations* platform/apps/server/src/semantic-step-resolver.ts
  git commit -m "feat: 打通 ScriptFlow 页面验证与视觉执行"
  ```

## 任务 4：新增 ScriptFlow 持久化与 API

**文件：**
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/packages/shared/src/index.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`
- 创建：`platform/apps/server/src/script-flow-api.ts`
- 创建：`platform/apps/server/src/script-flow-api.test.ts`
- 修改：`platform/apps/server/src/index.ts`

- [ ] **步骤 1：写 SQLite CRUD 和版本测试**

  新表 `script_flows` 保存当前 YAML、解析快照、状态和版本；`script_flow_versions` 保存每次更新的不可变 YAML 快照。删除脚本时级联删除版本，不影响历史 Run 快照。

- [ ] **步骤 2：创建新表**

  ```sql
  CREATE TABLE script_flows (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    source_yaml TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```

- [ ] **步骤 3：实现 REST API**

  - `GET /api/script-flows`
  - `POST /api/script-flows/validate`
  - `POST /api/script-flows`
  - `GET /api/script-flows/:id`
  - `PUT /api/script-flows/:id`
  - `DELETE /api/script-flows/:id`
  - `POST /api/script-flows/:id/preview`
  - `POST /api/script-flows/:id/runs`
  - `GET /api/script-flow-runs/:runId`

- [ ] **步骤 4：保证 API 不接收编译后 ActionStep 作为事实来源**

  写入接口只接受 YAML；`parsed_json` 与执行计划都由服务端重新生成，客户端不能绕过校验提交编译结果。

- [ ] **步骤 5：验证 API 和类型**

  运行：`pnpm exec vitest run platform/apps/server/src/script-flow-api.test.ts platform/apps/server/src/storage.test.ts platform/packages/shared/src/index.test.ts`

  运行：`pnpm --filter @mobile-automation/server typecheck`

- [ ] **步骤 6：提交持久化与 API**

  ```bash
  git add platform/packages/shared platform/apps/server/src/storage* platform/apps/server/src/script-flow-api* platform/apps/server/src/index.ts
  git commit -m "feat: 新增 ScriptFlow 用例库与执行 API"
  ```

## 任务 5：建立脚本用例产品入口

**文件：**
- 创建：`platform/apps/dashboard/src/components/ScriptFlowsPanel.tsx`
- 创建：`platform/apps/dashboard/src/components/ScriptFlowsPanel.test.ts`
- 创建：`platform/apps/dashboard/src/components/ScriptRunForm.tsx`
- 创建：`platform/apps/dashboard/src/components/ScriptRunForm.test.ts`
- 修改：`platform/apps/dashboard/src/components/AppNav.tsx`
- 修改：`platform/apps/dashboard/src/components/AppNav.test.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/App.test.ts`
- 修改：`platform/apps/dashboard/src/styles.css`

- [ ] **步骤 1：写导航和主流程测试**

  主导航显示“脚本用例”和“AI 生成用例”，不再显示“资产用例”和“AI 资产用例”。脚本页第一屏直接展示脚本列表、编辑区、校验结果和运行参数，不做介绍型落地页。

- [ ] **步骤 2：实现脚本列表与 YAML 编辑器**

  编辑器显示行号和服务端路径错误；保存前自动调用 validate。页面预览把 YAML 编译为只读步骤列表，显示动作、目标、`onPage`、`expectPage` 和风险级别。

- [ ] **步骤 3：实现结构化运行参数表单**

  根据参数 schema 渲染 text、number、toggle、datetime、select；必要参数优先，带默认值的参数已填充，可选参数折叠展示。禁止要求用户填写 `key=value`。

- [ ] **步骤 4：实现执行状态与报告入口**

  逐步显示当前脚本步骤、页面验证、定位策略、动作结果和目标页结果；复用现有 Run 轮询和报告 URL，不展示 Graph route、edge 或 PageTask 字段。

- [ ] **步骤 5：验证 Dashboard**

  运行：`pnpm exec vitest run platform/apps/dashboard/src/components/ScriptFlowsPanel.test.ts platform/apps/dashboard/src/components/ScriptRunForm.test.ts platform/apps/dashboard/src/components/AppNav.test.ts platform/apps/dashboard/src/App.test.ts`

  运行：`pnpm --filter @mobile-automation/dashboard typecheck`

  运行：`pnpm --filter @mobile-automation/dashboard build`

- [ ] **步骤 6：提交脚本用例 UI**

  ```bash
  git add platform/apps/dashboard/src
  git commit -m "feat: 新增 ScriptFlow 用例编辑与执行界面"
  ```

## 任务 6：接入 AI 规划与 MCP 工具

**文件：**
- 创建：`platform/apps/server/src/script-planning-tools.ts`
- 创建：`platform/apps/server/src/script-planning-tools.test.ts`
- 创建：`platform/apps/server/src/script-flow-ai-planner.ts`
- 创建：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 创建：`platform/apps/server/src/transition-index.ts`
- 创建：`platform/apps/server/src/transition-index.test.ts`
- 修改：`platform/packages/mcp-adapter/src/index.ts`
- 修改：`platform/packages/mcp-adapter/src/index.test.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.ts`
- 修改：`platform/packages/mcp-adapter/src/mcp-wrapper.test.ts`
- 修改：`platform/apps/dashboard/src/components/ScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/ScriptFlowsPanel.test.ts`

- [ ] **步骤 1：写只读规划工具测试**

  工具固定为 `list_pages`、`get_page`、`list_page_locators`、`list_flows`、`get_flow`、`find_page_paths`、`validate_script`。规划工具不能操作设备、写页面资产或直接启动执行。

- [ ] **步骤 2：从脚本派生 TransitionIndex**

  仅从已验证脚本中提取相邻 `onPage -> expectPage` 关系，并保留来源脚本/步骤。索引是可重建缓存，不写入 PageTransition 或 operation edge。

- [ ] **步骤 3：实现两类需求语义**

  - “在主页点击右上角加号，然后点击添加好友”：生成显式动作脚本。
  - “打开添加好友页面”：通过 TransitionIndex 查询可复用脚本步骤并生成 `runFlow` 或展开后的动作；找不到路径时返回缺少可复用流程，不伪造点击。

- [ ] **步骤 4：实现 AI 输出校验闭环**

  AI 返回 YAML 草稿后必须执行 `parse -> validate -> resolve page refs -> risk check`。有错误时把结构化错误反馈给模型修正一次；第二次仍失败则展示草稿与错误，不允许执行。

- [ ] **步骤 5：替换 MCP Graph 工具**

  删除 list graph nodes、get node edge detail、trigger node test、graph quality 工具，新增页面目录、脚本查询、脚本校验、启动脚本和查询 Run 工具。

- [ ] **步骤 6：验证 AI 与 MCP**

  运行：`pnpm exec vitest run platform/apps/server/src/script-planning-tools.test.ts platform/apps/server/src/script-flow-ai-planner.test.ts platform/apps/server/src/transition-index.test.ts platform/packages/mcp-adapter/src`

- [ ] **步骤 7：提交 AI 规划链路**

  ```bash
  git add platform/apps/server/src/script-planning-tools* platform/apps/server/src/script-flow-ai-planner* platform/apps/server/src/transition-index* platform/packages/mcp-adapter platform/apps/dashboard/src/components/ScriptFlowsPanel*
  git commit -m "feat: 基于页面资产与脚本索引生成 AI 用例"
  ```

## 任务 7：收窄资产录制与页面资产库

**文件：**
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`
- 修改：`platform/apps/dashboard/src/components/PageAssetsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/PageAssetsPanel.test.ts`
- 修改：`platform/apps/server/src/graph-assets.ts`
- 修改：`platform/apps/server/src/graph-assets.test.ts`
- 修改：`platform/apps/server/src/current-page-asset.ts`
- 修改：`platform/apps/server/src/current-page-asset.test.ts`

- [ ] **步骤 1：删除连接边与页面任务录制 UI**

  资产录制只保留页面命名、页面身份依据、视觉样本/平台变体、公共定位器和临时阻断规则。删除“连接边”“页面任务”“发现页面连接”等入口和请求。

- [ ] **步骤 2：收窄页面资产库详情**

  详情只显示身份依据、平台样本、公共定位器和匹配健康度；不显示连接边、页面能力或 PageTask 数量。

- [ ] **步骤 3：将资产巡检收窄为页面/定位器健康检查**

  删除 transition validation 和 task dry run；保留页面匹配、截图区域、OCR 区域和公共定位器重定位检查。若现有资产巡检组件无法干净收窄，则删除旧入口，后续只通过页面详情执行单页健康检查。

- [ ] **步骤 4：验证录制与资产库**

  运行：`pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/current-page-asset.test.ts`

- [ ] **步骤 5：提交资产职责收窄**

  ```bash
  git add platform/apps/dashboard/src/components/AssetRecordingPanel* platform/apps/dashboard/src/components/PageAssetsPanel* platform/apps/server/src/graph-assets* platform/apps/server/src/current-page-asset*
  git commit -m "refactor: 将资产录制收窄为页面身份与公共定位器"
  ```

## 任务 8：执行清洁切换并删除旧链路

**文件：**
- 创建：`platform/apps/server/src/script-flow-cutover.ts`
- 创建：`platform/apps/server/src/script-flow-cutover.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`
- 修改：`platform/apps/server/src/index.ts`
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/apps/dashboard/src/App.tsx`
- 修改：`platform/apps/dashboard/src/components/AppNav.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`
- 删除：本方案“完成切换后删除”清单中的全部文件及测试

- [ ] **步骤 1：写一次性切换事务测试**

  临时数据库先写入页面节点、matcher、公共定位器、edge、PageTask、StructuredFlow、MetaFunction、CompositeCase 和 route plan；执行切换后页面节点、matcher、公共定位器和新 ScriptFlow 保留，其余数据和表全部消失。重复执行返回 already applied，不重复修改。

- [ ] **步骤 2：新增 schema_migrations**

  迁移 ID 固定为 `20260728_script_flow_v1_clean_cut`。迁移先校验 `script_flows` 表存在，再在单事务中删除旧数据、清理节点 metadata、删除旧表，最后写入迁移记录。

- [ ] **步骤 3：删除旧 API、服务实例和设备忙状态聚合**

  `index.ts` 只保留 ScriptFlowRunner、普通低层 AutomationRunner、稳定性探索、页面资产与录制服务。所有 `/api/free-composition/*`、`/api/asset-composition/*`、`/api/structured-flows/*`、`/api/flow-runs`、`/api/graph-runs` 路由删除。

- [ ] **步骤 4：删除旧类型与页面任务/边扩展逻辑**

  从 shared 删除 StructuredFlow、MetaFunction、AssetCompositeCase；从 GraphRunService 或替代模块移除 PageTask 展开、PageAbility edge 和 route plan 执行。若 GraphRunService 已无生产引用，连同 GraphRunDetail、useRunExecution 和 runner-core 的 GraphRunner 一并删除。

- [ ] **步骤 5：删除旧 Dashboard 入口和样式**

  删除 AssetCompositionPanel、FreeCompositionPanel、GraphRunDetail 及其专属 CSS。全仓搜索不得再出现“资产用例”“AI资产用例”“候选流程”“PageTask”“MetaFunction”“CompositeCase”。

- [ ] **步骤 6：运行删除后全量验证**

  运行：`pnpm test`

  运行：`pnpm build`

  运行：`git diff --check`

- [ ] **步骤 7：提交清洁切换**

  ```bash
  git add -A
  git commit -m "refactor: 删除旧资产图谱用例链路"
  ```

## 任务 9：真机验收与产品文档收口

**文件：**
- 修改：`README.md`
- 修改：`docs/product/mobile-automation-platform/spec/requirements.md`
- 修改：`docs/product/mobile-automation-platform/spec/design.md`
- 修改：`docs/product/mobile-automation-platform/spec/tasks.md`
- 修改：`docs/product/mobile-automation-platform/spec/acceptance.md`
- 修改：`docs/product/mobile-automation-platform/spec/traceability.md`
- 修改：`docs/product/mobile-automation-platform/spec/changelog.md`
- 创建：`platform/flows/classin/create-lesson-without-publish.yaml`

- [ ] **步骤 1：提交第一条可读脚本样例**

  样例使用 `className`、`lessonName`、`duration`，最后停在新建课堂页，不点击发布。

- [ ] **步骤 2：真机执行显式动作需求**

  在 Android 真机运行“主页点击右上角加号 -> 添加好友”，确认脚本包含实际动作和两个页面验证，报告按脚本步骤展示。

- [ ] **步骤 3：真机执行目标页面需求**

  输入“打开添加好友页面”，确认 AI 通过 TransitionIndex 复用已有脚本，而不是查询旧 operation edge。

- [ ] **步骤 4：真机执行课堂表单需求**

  重启 App，进入指定班级，打开新建课堂，填入课堂名和时长，不发布；确认动态班级名只存在于运行参数和报告，不写入页面资产。

- [ ] **步骤 5：验证页面冲突保护**

  构造两个共享稳定 OCR 证据的页面，确认 PageStateService 返回 `multiple_candidates`；补充区分证据后才允许通过。

- [ ] **步骤 6：运行最终质量门禁**

  运行：`pnpm test`

  运行：`pnpm build`

  运行：`pnpm check:tools`

  运行：`git status --short`

- [ ] **步骤 7：提交验收与文档**

  ```bash
  git add README.md docs platform/flows
  git commit -m "docs: 固化 ScriptFlow v1 产品与验收规范"
  ```

## 实施顺序与检查点

1. 任务 1-4 完成后必须得到可通过 API 执行的纵向链路；此时旧链路仍存在，但不新增任何兼容代码。
2. 任务 5-7 完成后新产品入口可独立使用，停止给旧入口补功能或修 UI。
3. 任务 8 在新链路测试和构建通过后立即执行，一次性删除旧代码与旧资产。
4. 任务 9 真机通过后才允许合并到稳定分支。

## 第一批实现范围

第一批只执行任务 1-4，目标是在不依赖 PageTransition、PageTask、MetaFunction、CompositeCase 的情况下，通过 API 跑通以下流程：

```text
ScriptFlow YAML
  -> 严格解析与参数校验
  -> ScriptExecutionPlan
  -> onPage 页面资产验证
  -> OCR/视觉动作
  -> expectPage 页面资产验证
  -> 现有 Run / StepResult / Screenshot / HTML Report
```

第一批完成标准：自动化测试全部通过，并在当前 Android 设备上跑通“进入指定班级 -> 新建课堂 -> 填表但不发布”。第一批不制作旧模型适配器，也不从旧 PageTask 自动生成脚本。
