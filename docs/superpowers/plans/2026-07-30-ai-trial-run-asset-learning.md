# AI 试运行与资产学习闭环实现方案

> 2026-07-30 更新：本方案中“用户逐项确认候选后沉淀”的设计已被 ADR 0004 的自动学习状态机取代。普通用户只确认无法自动判定的测试结果；资产需要多次成功证据，并由后台确定性规则或受约束的 AI 提议完成晋级。

> 2026-08-01 更新：阶段 1.5 引入“显式看屏辅助生成”，它只让 AI 在生成前理解当前截图并产出受控 ScreenUnderstandingContext，不创建 LearningCandidate，也不写 PageAsset、InteractionAsset 或 NavigationEntry。本文的资产学习仍只从试运行成功且结果已验证后的 Run、StepResult 和 Artifact 中产生候选。

> **对于智能体：** 必需子技能：使用 superpowers:subagent-driven-development (推荐) 或 superpowers:executing-plans 来逐个任务执行此方案。步骤使用复选框 (`- [ ]`) 语法进行进度追踪。

**目标：** 让新 App 在零页面资产、零交互资产的情况下，先由 AI 生成可执行测试草稿，再通过一次真实的试运行验证动作并产生可审核的页面、交互、导航和用例候选，逐步把一次性自然语言测试沉淀为稳定、可复用、可自动验证的测试资产。

**架构：** ScriptFlow 继续保存业务语义和测试逻辑，PageAsset 继续保存页面身份；新增 TrialRun、LearningSession、InteractionAsset、NavigationEntry 和 FlowVerification 五个领域对象。试运行使用现有执行器，但开启增强证据采集和失败后人工纠正；学习服务只从结果已验证的试运行中生成候选，候选经过去重、唯一性、稳定性和隐私校验后才能启用。脚本仍只写 `text`、`semantic`、`icon`、`control`，不恢复元素 ID、坐标、区域或 `ref`；已启用的 InteractionAsset 作为执行器的页面内定位记忆，NavigationEntry 作为 AI 与运行时共享的已验证页面导航记忆。

**技术栈：** TypeScript、React、Express、SQLite、Vitest、现有 ScriptFlow 编译器、PageMatcher、OCR/视觉语义执行器。

---

## 一、产品结论

### 1. 推荐的主流程

```text
自然语言需求
  -> AI 生成测试草稿
  -> 确定性预检
  -> 已验证可直接执行 / 未验证需要试运行 / 信息不足需补充
  -> 真实设备试运行
  -> 自动结果验证或用户确认结果
  -> 从实际执行证据生成页面、交互、导航和用例候选
  -> 质量校验与去重
  -> 多次证据聚合、规则准入和必要的人工校准
  -> 更新页面资产、交互资产、用例中心和导航索引
```

这个方向成立，但“动作都执行完”不能等同于“测试成功”。系统必须分别记录：

- `executionStatus`：设备动作是否全部执行完成。
- `outcomeStatus`：业务结果是否由页面、稳定文字或用户确认验证。
- `learningStatus`：本次证据是否允许生成和启用候选资产。

只有 `executionStatus=passed` 且 `outcomeStatus=verified|human_confirmed`，并且没有崩溃、ANR、歧义定位或禁止回退，才允许进入资产学习。

阶段 1.5 的看屏辅助生成不改变这条门禁：AI 看截图得到的屏幕理解可以帮助生成 ScriptFlow，但不能提前成为学习候选。学习服务必须重新从执行后的真实证据中判断候选是否成立。

### 2. 不接受的简化

- 不把一次试运行看到的全部页面和全部 OCR 文本自动保存为资产。
- 不从失败、未验证或用户否认结果的试运行中启用资产。
- 不把用户点中的屏幕坐标保存为元素定位方式。
- 不让 ScriptFlow 重新引用数据库元素 ID、旧 `ref`、截图区域或固定坐标。
- 不把所有临时测试都保存到用例中心。
- 不声称 AI 能在信息不足时“保证”生成语义正确的用例；它只能保证结构合法，业务歧义仍需追问或在试运行中由用户纠正。

### 3. 手工资产录制的定位

“资产录制”不再是新用户入口，也不要求用户先录页面再写测试。它保留为高级的“资产校准”能力，仅在以下情况出现：

- 两个页面视觉证据高度相似，自动学习无法唯一分类。
- 自定义纯图形入口无法靠文字、标准图标或结构语义稳定定位。
- 用户要修正错误页面名称、动态区域掩码或平台变体。
- 已启用资产在新版本中持续失效，需要人工重建基线。

### 4. 用例中心准入规则

试运行结束后，系统给出以下三种建议，用户确认后执行：

| 建议 | 适用条件 | 处理 |
| --- | --- | --- |
| 不保存测试 | 一次性排查、临时数据、探索性步骤、结果不可重复 | 只保留 Run 和报告 |
| 保存为用例 | 单一业务结果、可重复、参数化、入口和结果明确 | 保存为 `case` |
| 保存为场景 | 含两个以上可独立成立的业务目标，或编排多个通用用例 | 保存为 `scenario` |

跨页面不等于场景。登录、进入指定班级、创建课堂都可以是跨页面的单目标用例。场景强调多个业务目标，而不是页面数量。

用例启用前必须满足：

- 有唯一业务结果和自动化结果判定；试运行中的人工确认应在页面资产沉淀后转换为 `outcome.page`、`expectPage` 或稳定 `assertText`。
- 动态业务数据已参数化，不硬编码账号、手机号、密码、具体班级实例等数据。
- 所有必填参数有明确控件、说明和合法值约束。
- 至少有一次结果已验证的试运行。
- 不包含未解决的歧义目标或坐标型回退。

## 二、领域模型

### 1. TrialRun

TrialRun 是真实执行，不是模拟执行。它复用 Run，但在 `sourceSnapshot` 中新增：

```ts
executionPurpose: "trial" | "normal"
sourceHash: string
verificationAssessment: {
  status: "verified" | "needs_trial" | "blocked"
  reasons: string[]
  unresolvedStepIds: string[]
  unresolvedOutcome: boolean
}
```

试运行默认关闭视频，开启轻量增强证据采集；普通执行保持当前速度和采集策略。

### 2. LearningSession

一条 TrialRun 对应一个 LearningSession：

```ts
type LearningSessionStatus =
  | "analyzing"
  | "needs_outcome_review"
  | "ready"
  | "accepted"
  | "rejected"
  | "invalid";

type LearningSession = {
  id: string;
  runId: string;
  appId: string;
  platform: ScriptFlowPlatform;
  sourceHash: string;
  executionPassed: boolean;
  outcomeStatus: "verified" | "human_confirmed" | "rejected" | "unverified";
  status: LearningSessionStatus;
  summary: LearningSummary;
  createdAt: string;
  updatedAt: string;
};
```

### 3. LearningCandidate

候选统一保存来源、证据、置信度和状态：

```ts
type LearningCandidateStatus =
  | "detected"
  | "validated"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "superseded";

type LearningCandidate = {
  id: string;
  sessionId: string;
  kind: "page" | "interaction" | "navigation" | "test";
  stableKey?: string;
  sourceStepId?: string;
  confidence: number;
  status: LearningCandidateStatus;
  payload: Record<string, unknown>;
  evidenceArtifactIds: string[];
  validationIssues: string[];
  createdAt: string;
  updatedAt: string;
};
```

### 4. InteractionAsset

InteractionAsset 不属于 PageAsset，也不保存目标页面。它只描述“在某个表面上，怎样稳定找到一个可操作入口”：

```ts
type InteractionAsset = {
  id: string;
  key: string; // 例如 class-detail.teaching-plan-entry
  appId: string;
  platformScope: "android" | "ios" | "harmony" | "flutter" | "mobile-both";
  owner: {
    kind: "page" | "component" | "overlay";
    key: string;
  };
  name: string;
  aliases: string[];
  supportedActions: Array<"tap" | "inputText" | "clearText" | "selectText">;
  semanticContract: {
    text?: string;
    semantic?: string;
    icon?: string;
    control?: string;
    area?: string;
    position?: string;
    nearText?: string;
  };
  locatorVariants: Array<{
    platform: string;
    appVersionRange?: string;
    strategy: string;
    descriptor: Record<string, unknown>;
    confidence: number;
  }>;
  status: "draft" | "active" | "deprecated" | "rejected";
  version: number;
  provenance: {
    runIds: string[];
    stepIds: string[];
    artifactIds: string[];
  };
};
```

`descriptor` 可以保存 OCR 锚点、相对结构、局部视觉描述和标准图标特征，但不得保存绝对坐标或固定点击点。动态列表项要沉淀为参数化集合模板，例如“名称等于 `${className}` 的班级卡片”，不能沉淀为“班级四十二号”这个实例。

ScriptFlow 仍保持：

```yaml
tap:
  target:
    semantic: "进入教学方案的入口"
```

预览时由 `onPage + target 语义指纹 + action` 查询 InteractionAsset，冻结命中的资产 ID、版本和定位策略到执行计划。没有命中时继续走现有通用 OCR、图标和控件语义定位。这样能够利用学习结果，又不会把脚本重新变成元素 ID 编排。

字段覆盖不新增为 PageAsset 的表单模型。全字段/全配置回归的字段清单应来自用户明确列出的用例输入、已有 verified/full_regression ScriptFlow，或后续由 verified ScriptFlow + InteractionAsset + FlowVerification 派生出的覆盖摘要。InteractionAsset 只回答单个动作目标如何定位，不能被提升为“页面有哪些字段”的事实来源；覆盖摘要如果落地，也应作为派生索引供 AI 规划参考，不能让 ScriptFlow 引用其内部 ID。

### 5. NavigationEntry

NavigationEntry 描述“从已知页面执行一个已验证语义动作后到达哪个已知页面”。它只从通过试运行、通过步骤和通过 `state_is` 页面断言中提取，经用户确认后进入导航索引；同一 stableKey 再次出现时合并 provenance 和版本，不重复建条目。提取复用现有定位 metadata、执行后截图和页面断言，不增加截图或 OCR 调用。

### 6. FlowVerification

验证记录绑定“脚本内容”而不是只绑定用例 ID，因此临时草稿也能验证：

```ts
type FlowVerification = {
  id: string;
  flowId?: string;
  flowVersion?: number;
  sourceHash: string;
  appId: string;
  platform: ScriptFlowPlatform;
  appVersion?: string;
  runId: string;
  status: "provisional" | "verified" | "invalidated";
  coverage: {
    totalSteps: number;
    verifiedSteps: number;
    interactionAssetIds: string[];
    pageAssetIds: string[];
    humanConfirmedOutcome: boolean;
  };
  createdAt: string;
};
```

首次高质量试运行并经用户确认后可以成为 `provisional`；页面匹配唯一、结果自动验证或再次成功运行后成为 `verified`。导航索引只读取 `verified` 用例，避免把一次误学路径用于全局动态规划。

## 三、生成与试运行规则

### 1. AI 草稿状态

扩展当前两态结果：

```ts
status: "ready" | "trial_ready" | "needs_clarification"
```

- `ready`：动作可执行，最终结果有自动判定，且依赖均已验证。
- `trial_ready`：动作可执行，但包含未验证目标、未知页面或需要首次人工确认的结果，只能试运行或保存草稿。
- `needs_clarification`：动作目标本身存在不可执行歧义，例如“点一下那个按钮”且没有文字、图标、上下文或用户操作路径。

必须明确：零资产不等于全部放行。用户提供完整操作链时可以生成 `trial_ready`；用户只说“打开未知页面”且没有路径、稳定结果文字或可复用用例时仍需追问。

### 2. VerificationAssessment

生成后由确定性服务计算，不信任模型自行声明：

- 引用了未验证的 `runFlow`。
- 使用无 `onPage` 约束的自定义 `semantic` 目标。
- 目标页面不存在，最终只有人工结果确认。
- 当前 App、平台或 App 版本没有对应验证记录。
- 用例内容或参数结构在最近一次验证后发生变化。
- 命中 InteractionAsset，但资产状态不是 `active` 或版本不在计划快照中。

任一项成立则为 `needs_trial`。Schema 不合法、必填参数缺失、未知 page key、禁止目标字段或无法表达的自定义纯图标则为 `blocked`。

### 3. 试运行采集策略

试运行只在必要位置采集，不重复做全量 OCR：

- 运行开始时采集一份初始 Observation。
- 复用语义定位器已经产生的截图和 OCR layout，记录实际选中的候选及评分。
- 每个动作后复用现有 after screenshot；发生明显状态变化、存在 `expectPage`、最终步骤或未知表面时补充 OCR Observation。
- UI Tree 默认关闭，仅在 OCR/视觉无法判断控件类型且设备支持时按需采集。
- 学习分析异步执行，设备动作完成后立即释放设备租约，不阻塞后处理。

### 4. 试运行失败纠正

自动定位失败不能直接引导用户去录制资产。界面提供“纠正并继续”：

1. 展示失败步骤截图和模型理解的目标。
2. 用户在实时预览中点击正确目标，或从 OCR 候选中选择。
3. 系统只把这次点击用于建立相对语义/视觉候选，不把坐标写入 ScriptFlow 或 InteractionAsset。
4. 从失败步骤继续执行；如果前置状态已被破坏，则重新开始试运行。
5. 整体结果验证通过后，纠正记录才有资格成为 InteractionAsset 候选。

自定义纯图标在零资产状态下无法可靠从一句描述中自动定位，人工纠正是合理且必要的冷启动机制。

## 四、资产提取与准入

### 1. 页面候选

页面候选来源于初始状态、动作后状态和最终状态，不直接使用用户描述作为事实。准入流程：

1. 使用 PageMatcher 与现有已启用页面去重。
2. 已匹配页面只追加成功运行证据，不新建页面。
3. 未匹配观察按视觉结构、稳定 OCR 和 App 范围聚类。
4. AI 可以建议名称，用户描述只能作为命名线索。
5. 生成 matcher 时屏蔽时间、账号、班级名、数量和本次输入参数等动态内容。
6. 与现有页面存在混淆时标记 `needs_review`，不得自动启用。
7. 高质量唯一候选经用户确认后写入现有 PageAsset；低质量候选需要第二份样本或人工校准。

页面和 overlay 分开分类。菜单、弹窗、底部抽屉可以作为 overlay 候选，但不能伪装成完整页面。

### 2. 交互候选

只提取“本次实际操作且对成功结果有贡献”的目标：

- OCR 可见文字入口。
- 参数化动态列表项。
- 标准图标或通用控件。
- 用户纠正过的自定义图形入口。

不提取：

- 屏幕上所有未操作元素。
- 用户输入值、密码、手机号、验证码。
- Toast、倒计时、红点数量和一次性提示。
- 固定坐标、全屏截图模板和整块大区域。
- 只在本次业务数据中出现且无法参数化的列表实例。

交互候选必须有 owner 表面、语义契约、至少一种非坐标定位策略、来源步骤和结果证据。候选与已有 InteractionAsset 相同则追加 locator variant 或运行证据，不重复建项。

### 3. 用例候选

学习服务计算可复用评分：

- 单一业务结果：+2。
- 已参数化动态数据：+2。
- 有自动结果判定：+2。
- 可复用为准备、导航或业务能力：+2。
- 依赖硬编码实例：-2。
- 仅用于一次性诊断：-3。
- 包含多个独立目标但未拆分：建议场景或拆分子用例。

系统给出建议和原因，不默认把所有试运行保存到用例中心。用户点击确认后才保存；保存时重新执行 schema、参数、依赖、结果判定和版本校验。

### 4. 沉淀后的脚本物化

零资产草稿可能没有 `onPage`、`expectPage` 或已知 `outcome.page`。接受页面候选后，系统生成一版新的 ScriptFlow 草稿：

- 给有明确证据的步骤补上 `onPage` 和 `expectPage`。
- 把最终人工确认结果替换为新页面的 `outcome.page` 或 `assertPage`。
- 保留原有动作语义，不替换为元素 ID。
- 重新预览并生成新的 `planDigest`。
- 低置信页面候选不自动写入脚本。

## 五、交互与页面设计

### AI 生成测试

生成结果区增加：

- 验证状态：`可直接执行`、`需要试运行`、`需要补充信息`。
- 覆盖摘要：已验证步骤、待验证步骤、未知结果页面。
- `试运行`：仅在 `needs_trial` 时作为主按钮。
- `直接执行`：仅在 `verified` 时作为主按钮。
- `保存草稿`：允许保留尚未验证的测试，但不进入启用用例和导航索引。

试运行按钮旁显示一次性说明：“试运行会真实操作当前设备和业务数据，并采集页面与交互证据。”不恢复逐步骤风险勾选。

### 试运行结果

执行中显示：

- 当前步骤、实际选中目标和是否发生人工纠正。
- 技术执行状态与业务结果状态。
- 失败时的“纠正并继续”入口。

执行结束后分两段：

1. 结果确认：自动断言通过则直接显示；没有自动 oracle 时询问“当前结果是否符合预期”。
2. 沉淀建议：显示页面、交互、导航和用例建议的数量、风险与默认选择。

默认只展示高质量推荐项；“查看详情”中才展示 matcher、候选截图、置信度、冲突页和来源步骤，避免把资产工程复杂度转嫁给普通用户。

### 用例中心

- 草稿显示“未验证”，不能作为 `runFlow` 或导航索引来源。
- `provisional` 显示“已试运行”，可以人工执行，但不参与全局路径规划。
- `verified` 显示“已验证”，可以复用和派生导航索引。
- 修改已验证用例后，新版本自动回到“待试运行”，旧版本验证记录不继承。

### 资产入口

侧栏“资产录制”改为高级入口“资产校准”，主页面不再提示用户预先录入。页面资产库增加“来源”列：试运行学习、人工校准、导入；InteractionAsset 使用单独的“交互资产”视图，避免与页面身份混在一起。

## 六、接口设计

### 草稿评估

```http
POST /api/script-flow-drafts/assessment
```

输入 `sourceYaml + parameters`，返回 VerificationAssessment、可执行性和所需试运行原因。当前 `/preview` 仍负责生成冻结计划；assessment 不操作设备。

### 启动试运行

```http
POST /api/script-flow-drafts/trial-runs
POST /api/script-flows/:id/trial-runs
```

请求继续使用 `preview -> planDigest -> run`，额外写入 `executionPurpose=trial`。不能把普通 `/runs` 通过一个可忽略布尔字段偷偷切成试运行。

### 学习摘要与结果确认

```http
GET  /api/trial-runs/:runId/learning-summary
POST /api/trial-runs/:runId/outcome-review
```

`outcome-review` 只接受 `confirmed | rejected` 和可选结果名称。拒绝后 LearningSession 立即失效，不能沉淀候选。

### 候选确认

```http
POST /api/learning-sessions/:id/accept
POST /api/learning-sessions/:id/reject
```

`accept` 接收候选 ID、用户确认名称和是否保存测试。服务端必须重新校验候选状态、run 结果、sourceHash、App 范围、重复资产和当前版本，不能信任前端复选状态。

### 失败纠正

```http
POST /api/trial-runs/:runId/steps/:stepResultId/corrections
POST /api/trial-runs/:runId/resume
```

纠正接口保存用户选择的实时证据，不修改原 ScriptFlow。resume 创建同一 LearningSession 下的新执行 attempt，并在报告中串联展示。

## 七、数据库变更

在 `platform/apps/server/src/storage.ts` 新增：

- `learning_sessions`
- `learning_candidates`
- `interaction_assets`
- `interaction_asset_versions`
- `flow_verifications`

核心约束：

- `learning_sessions.run_id` 唯一。
- 候选必须级联归属 LearningSession，但已接受资产只保存 provenance ID，不反向依赖候选生命周期。
- InteractionAsset 在 `app_id + owner_kind + owner_key + stable_key` 上唯一。
- FlowVerification 在 `source_hash + app_id + platform + app_version + status` 上建立查询索引。
- 资产接受、脚本物化和验证记录更新在一个 SQLite 事务内完成。
- 不在现有 `business_nodes.metadata_json` 中塞入整套学习状态机。

## 八、安全、隐私与性能

### 隐私

- 敏感 ScriptFlow 参数继续只在内存使用，LearningCandidate payload 必须按 sensitive 参数值二次清洗。
- 密码、手机号、验证码、账号和文本输入后的屏幕区域不能成为 matcher 或 interaction alias。
- 试运行学习附件使用独立 retention 类别；候选拒绝后可立即清理非报告必需附件。
- 学习摘要和 AI 命名请求不上传原始密码、完整账号或未脱敏截图。

### 性能

- 普通 Run 不启用新页面发现，不增加全量 PageMatcher 扫描。
- 试运行复用定位器截图和 OCR 结果，避免每步重复截图与 OCR。
- 仅对最终页和疑似页面边界执行全库页面去重；已知 `expectPage` 继续定向匹配。
- 学习提取进入异步队列，UI 轮询 LearningSession，不占用设备执行锁。
- UI Tree 保持最低优先级，默认不采集。

### 一致性

- 预览的 `planDigest` 加入 InteractionAsset snapshot digest。
- 接受新 InteractionAsset 或更新版本后，旧 preview 立即失效并要求重新预览。
- 页面候选只有启用后才进入 PageAssetCatalog。
- 导航索引只有 FlowVerification=`verified` 时生成。

## 九、分阶段开发任务

### 任务 1：固化产品契约与试运行状态模型

**文件：**
- 修改：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`
- 新建：`docs/product/mobile-automation-platform/adr/0004-trial-run-asset-learning.md`
- 修改：`platform/packages/shared/src/index.ts`
- 修改：`platform/packages/shared/src/index.test.ts`

- [x] 先增加测试，覆盖 TrialRun、LearningSession、LearningCandidate、InteractionAsset、FlowVerification 的合法状态和 JSON 往返。
- [x] 明确 `ready / trial_ready / needs_clarification` 与 `verified / needs_trial / blocked` 的区别。
- [x] 在 ADR 中锁死“试运行是真实执行”“失败不学习”“脚本不引用元素 ID/坐标”“交互资产是执行器记忆”的边界。
- [x] 运行 `pnpm vitest run platform/packages/shared/src/index.test.ts`。

### 任务 2：持久化学习会话、候选、交互资产和验证记录

**文件：**
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/storage.test.ts`
- 新建：`platform/apps/server/src/learning-storage.test.ts`

- [x] 先写失败测试，覆盖建表、事务写入、候选状态转换、唯一约束和级联删除。
- [x] 增加五张表及索引，提供显式 CRUD，不把新模型埋进 metadata JSON。
- [x] 实现 `acceptLearningSession` 事务入口，确保部分资产写入失败时整体回滚。
- [x] 实现按 sourceHash、App、平台和 App 版本查询最新验证记录。
- [x] 运行 `pnpm vitest run platform/apps/server/src/storage.test.ts platform/apps/server/src/learning-storage.test.ts`。

### 任务 3：实现确定性的草稿验证评估

**文件：**
- 新建：`platform/apps/server/src/script-flow-verification.ts`
- 新建：`platform/apps/server/src/script-flow-verification.test.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.ts`
- 修改：`platform/apps/server/src/script-flow-ai-planner.test.ts`
- 修改：`platform/apps/server/src/script-flow-ai-api.ts`
- 修改：`platform/apps/server/src/script-flow-ai-api.test.ts`

- [x] 先写测试，证明模型声称 ready 不能绕过本地 assessment。
- [x] 扩展 AI draft 为 `trial_ready`，返回 `unresolvedOutcome` 和 `unverifiedStepIds`，但最终状态由服务端重算。
- [x] 零资产且用户提供完整操作链时允许 `trial_ready`；动作目标歧义时仍返回 `needs_clarification`。
- [x] 目标页未知且无稳定断言时，只允许试运行后的人工结果确认，不允许普通执行或启用保存。
- [x] 修改用例后通过 sourceHash 自动使旧验证失效。
- [x] 运行 `pnpm vitest run platform/apps/server/src/script-flow-ai-planner.test.ts platform/apps/server/src/script-flow-ai-api.test.ts platform/apps/server/src/script-flow-verification.test.ts`。

### 任务 4：拆分普通执行与试运行 API

**文件：**
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/script-flow-api.test.ts`
- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/script-flow-runner.test.ts`
- 修改：`platform/packages/shared/src/index.ts`

- [x] 先写测试，普通 `/runs` 拒绝 `needs_trial` 草稿，`/trial-runs` 接受并写入 `executionPurpose=trial`。
- [x] 新增 draft 和 persisted flow 的 trial-runs 路由，继续校验 planDigest、参数和设备平台。
- [x] sourceSnapshot 写入 assessment、sourceHash 和 asset snapshot digest。
- [x] 试运行强制 `recordVideo=false`，防止长流程产生大视频；显式拒绝 loop_until_stop 试运行。
- [x] 运行 `pnpm vitest run platform/apps/server/src/script-flow-api.test.ts platform/apps/server/src/script-flow-runner.test.ts`。

### 任务 5：复用执行证据并构建 Trial Observation Bundle

**文件：**
- 修改：`platform/apps/server/src/automation-runner.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`
- 修改：`platform/apps/server/src/observation-service.ts`
- 修改：`platform/apps/server/src/observation-service.test.ts`
- 修改：`platform/apps/server/src/run-artifact-service.ts`
- 修改：`platform/apps/server/src/run-artifact-service.test.ts`
- 新建：`platform/apps/server/src/trial-observation.ts`
- 新建：`platform/apps/server/src/trial-observation.test.ts`

- [ ] 先写测试，证明试运行复用已有 locator screenshot/OCR，不为同一步重复调用 OCR。
- [ ] 记录初始 Observation、每步实际 locator 候选、after 状态和最终 Observation。
- [ ] 只在试运行中开启增强采集，普通 Run 的调用次数保持不变。
- [ ] UI Tree 默认关闭，并为 OCR/视觉不足场景保留按需开关。
- [ ] 对 sensitive 参数和输入步骤做候选数据清洗。
- [ ] 运行相关四组测试并对 connected Android 做一次截图/OCR 调用计数验证。

### 任务 6：实现页面候选提取、去重和准入

**文件：**
- 新建：`platform/apps/server/src/trial-page-learning.ts`
- 新建：`platform/apps/server/src/trial-page-learning.test.ts`
- 修改：`platform/apps/server/src/current-page-asset.ts`
- 修改：`platform/apps/server/src/current-page-asset.test.ts`
- 修改：`platform/apps/server/src/page-matcher.ts`
- 修改：`platform/apps/server/src/page-matcher.test.ts`
- 修改：`platform/apps/server/src/page-asset-catalog.ts`

- [ ] 先写测试，覆盖已存在页面追加证据、未知页面建候选、混淆页面阻止启用、动态文本掩码和 overlay 分类。
- [ ] 从 Observation Bundle 聚类页面边界，复用 `buildConfirmedPageAssetInput` 生成 matcher 草稿。
- [ ] 将 prompt 名称只作为建议，不作为身份 matcher。
- [ ] 高置信唯一候选允许一次确认后启用；低置信或混淆候选保持 needs_review。
- [ ] 验证候选未启用前不会被 PageAssetCatalog 返回。
- [ ] 运行 `pnpm vitest run platform/apps/server/src/trial-page-learning.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts`。

### 任务 7：实现 InteractionAsset 目录和运行时解析

**文件：**
- 新建：`platform/apps/server/src/interaction-asset-catalog.ts`
- 新建：`platform/apps/server/src/interaction-asset-catalog.test.ts`
- 新建：`platform/apps/server/src/interaction-asset-api.ts`
- 新建：`platform/apps/server/src/interaction-asset-api.test.ts`
- 修改：`platform/apps/server/src/script-target-resolver.ts`
- 修改：`platform/apps/server/src/script-target-resolver.test.ts`
- 修改：`platform/apps/server/src/script-flow-api.ts`
- 修改：`platform/apps/server/src/script-flow-runner.ts`
- 修改：`platform/apps/server/src/index.ts`

- [x] 先写测试，ScriptTarget 类型仍只有 text/semantic/icon/control，任何 element/ref/坐标字段继续校验失败。
- [x] InteractionAsset 按 owner、语义指纹和 action 严格查询，多个同分候选必须报歧义，不得任取第一个。
- [x] 预览把命中的资产版本和 locator bundle 冻结进内部计划，并计入 planDigest。
- [x] 执行优先使用冻结 bundle，失败时只允许通用语义定位，不允许坐标回退。
- [x] 新资产启用后旧计划摘要失效。
- [ ] 运行 `pnpm vitest run platform/apps/server/src/interaction-asset-catalog.test.ts platform/apps/server/src/interaction-asset-api.test.ts platform/apps/server/src/script-target-resolver.test.ts platform/apps/server/src/script-flow-api.test.ts`。

### 任务 8：实现交互候选提取和参数化动态列表

**文件：**
- 新建：`platform/apps/server/src/trial-interaction-learning.ts`
- 新建：`platform/apps/server/src/trial-interaction-learning.test.ts`
- 修改：`platform/apps/server/src/semantic-locator.ts`
- 修改：`platform/apps/server/src/semantic-locator.test.ts`

- [x] 先写测试，只从实际成功的试运行步骤提取候选；更细粒度的因果贡献分析保留后续增强。
- [x] 从 locator metadata 生成 OCR 锚点、标准图标或控件 descriptor。
- [ ] 将与 ScriptFlow 参数相等的动态文本替换为参数槽位。
- [ ] 拒绝密码、账号、Toast、计数红点、固定坐标和整屏模板。
- [x] 已有资产追加平台/版本 locator variant，不重复创建 stableKey。
- [x] 运行 `pnpm vitest run platform/apps/server/src/trial-interaction-learning.test.ts platform/apps/server/src/semantic-locator.test.ts`。

### 任务 9：实现 LearningSession 编排与原子沉淀

**文件：**
- 新建：`platform/apps/server/src/trial-learning-service.ts`
- 新建：`platform/apps/server/src/trial-learning-service.test.ts`
- 新建：`platform/apps/server/src/trial-learning-api.ts`
- 新建：`platform/apps/server/src/trial-learning-api.test.ts`
- 修改：`platform/apps/server/src/index.ts`

- [x] 先写测试，失败、未验证、用户拒绝和崩溃 Run 均不能生成可接受候选。
- [ ] Run 结束后异步创建 LearningSession，汇总页面、交互和用例建议。
- [x] 没有自动 oracle 时进入 needs_outcome_review；用户确认后候选才允许接受。
- [ ] accept 时重新跑所有质量门禁，并在单事务中写入资产、验证记录和可选用例。
- [x] 接受已有交互时只追加 provenance 和版本证据。
- [x] 运行现有学习存储与 `trial-learning-api.test.ts` 测试；独立异步 service 尚待后续阶段。

### 任务 10：实现脚本物化、用例准入与导航索引门禁

**文件：**
- 新建：`platform/apps/server/src/trial-flow-materializer.ts`
- 新建：`platform/apps/server/src/trial-flow-materializer.test.ts`
- 修改：`platform/apps/server/src/storage.ts`
- 修改：`platform/apps/server/src/page-navigation.ts`
- 修改：`platform/apps/server/src/page-navigation.test.ts`
- 修改：`platform/apps/server/src/script-flow-api.ts`

- [ ] 先写测试，把人工确认的最终页面物化为 outcome/expectPage，同时保持原动作目标不变。
- [ ] 草稿、provisional 和 verified 三种保存状态映射到现有 ScriptFlow status 与 FlowVerification，不新增可绕过的 active 状态。
- [x] 修改后的 sourceHash 自动清除 verified 资格。
- [x] `replacePageNavigationSegments` 只为 verified flow 建索引。
- [x] 从通过页面断言的试运行步骤生成 NavigationEntry 候选，接受后写入独立导航目录。
- [x] AI 规划和运行时导航索引同时读取已启用 NavigationEntry，不再根据页面名称猜测底栏入口。
- [x] 相同 stableKey 重复接受时合并证据并递增版本，不重复创建导航条目。
- [ ] 含未确认页面、未通过结果验证或低置信交互候选的片段不进入导航索引；不根据按钮文案推断业务风险。
- [ ] 运行 `pnpm vitest run platform/apps/server/src/trial-flow-materializer.test.ts platform/apps/server/src/page-navigation.test.ts platform/apps/server/src/storage.test.ts`。

### 任务 11：实现试运行与沉淀建议 UI

**文件：**
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AiScriptFlowsPanel.test.tsx`
- 新建：`platform/apps/dashboard/src/components/TrialRunPanel.tsx`
- 新建：`platform/apps/dashboard/src/components/TrialRunPanel.test.tsx`
- 新建：`platform/apps/dashboard/src/components/LearningReviewPanel.tsx`
- 新建：`platform/apps/dashboard/src/components/LearningReviewPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/components/CaseCenterPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/CaseCenterPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/styles.css`
- 修改：`platform/apps/dashboard/src/styles.test.ts`

- [x] 先写组件测试，验证不同 assessment 只出现对应主按钮。
- [x] AI 结果展示验证覆盖和原因，不展示 YAML、matcher 或数据库 ID。
- [x] 试运行结束后先完成结果确认，再显示推荐沉淀项。
- [x] 默认只选高质量交互候选；页面和用例候选 UI 留待对应学习服务完成。
- [ ] 增加失败步骤纠正并继续交互；用户选择的坐标不能出现在可见脚本或保存请求中。
- [x] 用例中心显示待试运行、已验证和阻断状态，并按状态选择执行接口。
- [x] 完成桌面和窄屏布局截图检查，确保按钮、长名称和候选摘要不重叠。

### 任务 12：资产校准入口与交互资产管理

**文件：**
- 修改：`platform/apps/dashboard/src/components/AppNav.tsx`
- 修改：`platform/apps/dashboard/src/components/AppNav.test.ts`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts`
- 修改：`platform/apps/dashboard/src/components/PageAssetsPanel.tsx`
- 修改：`platform/apps/dashboard/src/components/PageAssetsPanel.test.ts`
- 新建：`platform/apps/dashboard/src/components/InteractionAssetsPanel.tsx`
- 新建：`platform/apps/dashboard/src/components/InteractionAssetsPanel.test.tsx`
- 修改：`platform/apps/dashboard/src/App.tsx`

- [ ] 将“资产录制”降级为“资产校准”，只从学习冲突、页面库和高级导航进入。
- [ ] 页面资产展示来源、观察次数、最近验证版本和混淆风险。
- [ ] 交互资产展示 owner、语义名称、支持动作、平台变体和来源 Run，不暴露固定坐标。
- [ ] 支持拒绝、废弃和重新学习，不支持直接粘贴 locator JSON。
- [ ] 运行对应 dashboard 测试。

### 任务 13：隐私清理、附件策略和普通运行回归

**文件：**
- 修改：`platform/apps/server/src/artifact-cleanup.ts`
- 修改：`platform/apps/server/src/artifact-cleanup.test.ts`
- 新建：`platform/apps/server/src/learning-redaction.ts`
- 新建：`platform/apps/server/src/learning-redaction.test.ts`
- 修改：`platform/apps/server/src/automation-runner.test.ts`

- [ ] 为 trial-learning 附件增加独立保留策略，拒绝候选后清理非报告必需附件。
- [ ] 对 sensitive parameters、账号模式、验证码和输入控件附近 OCR 做清洗测试。
- [ ] 对比普通 Run 改造前后的截图、OCR、PageMatcher 调用次数，不能出现默认性能回退。
- [ ] 验证 loop_until_stop 不能开启试运行学习或视频录制。
- [ ] 运行 `pnpm vitest run platform/apps/server/src/artifact-cleanup.test.ts platform/apps/server/src/learning-redaction.test.ts platform/apps/server/src/automation-runner.test.ts`。

### 任务 14：端到端验收

**场景 A：全新 App、零资产、纯文字入口**

- [ ] 输入完整操作链和最终结果描述，生成 `trial_ready`。
- [ ] 试运行成功，用户确认结果。
- [ ] 自动建议页面和实际操作入口，不保存屏幕上其他元素。
- [ ] 接受后生成 PageAsset、InteractionAsset 和 provisional case。
- [ ] 再次运行可自动验证并升级 verified。

**场景 B：已知页面、未知自定义图标**

- [ ] 自动定位失败后暂停。
- [ ] 用户点击正确图标，继续执行成功。
- [ ] 保存局部视觉/相对语义候选，不保存坐标。
- [ ] 第二次运行无需人工点击。

**场景 C：误点但动作命令返回成功**

- [ ] 最终结果断言失败或用户否认结果。
- [ ] LearningSession 标记 invalid/rejected。
- [ ] 页面、交互和导航索引均无新增。

**场景 D：两个页面稳定证据重复**

- [ ] 候选被标记 needs_review。
- [ ] 用户补充区分证据或第二份样本后才能启用。
- [ ] PageMatcher 不因低阈值强行选中其中一个页面。

**场景 E：动态列表参数**

- [ ] 用 `${className}` 进入不同班级两次。
- [ ] 只生成一个参数化“班级卡片”InteractionAsset。
- [ ] 不生成两个班级实例资产。

**最终命令：**

- [x] `pnpm lint`
- [x] `pnpm test:unit`
- [x] `pnpm build`
- [ ] 在 Android 真机完成上述五个场景并保存 Run ID。
- [ ] 使用 Playwright 检查 `1280x800`、`1440x900` 和移动宽度页面，无重叠、溢出和空白主区域。

## 十、工期与交付切分

### MVP：3.5 至 5 单人周

- 状态模型、存储和 assessment：4 至 6 天。
- 试运行 API 与增强证据采集：4 至 6 天。
- 页面候选学习、结果确认和简单沉淀 UI：5 至 7 天。
- 用例验证状态与导航门禁：3 至 4 天。

MVP 先支持 Android、页面候选、OCR 文字/标准图标交互候选和人工结果确认。它已经能完成零资产冷启动，但自定义纯图形需要用户纠正，交互资产只支持基础策略。

### 完整版本：额外 3 至 5 单人周

- InteractionAsset 多平台/多版本 locator variant。
- 自定义图形纠正与局部视觉描述。
- 参数化动态列表模板。
- 异步学习队列、隐私清理、冲突审核和资产健康度。
- iOS/鸿蒙/Flutter 的观察与驱动适配另行估算，不包含在 Android 完整版本内。

## 十一、预期收益与主要风险

### 收益

- 新 App 不需要先理解资产模型，第一步就是描述并运行测试。
- 页面和交互资产来自真实成功执行，来源和使用价值更明确。
- 只沉淀实际使用的页面和入口，避免全量扫描造成资产膨胀。
- 通用脚本保持业务可读，定位细节由执行器学习和冻结。
- 用例中心只保留稳定可复用能力，导航索引质量更高。

### 风险

- 试运行的证据采集比普通执行慢，需要严格复用截图和 OCR。
- 用户错误确认会污染资产，因此必须保留来源、冲突检测、回滚和健康度。
- 纯图形、自绘控件和高度动态页面无法完全无人工冷启动。
- 页面自动命名容易把业务数据当身份，必须先脱敏和动态值屏蔽。
- 如果 provisional 用例过早进入导航索引，会把局部误学放大成全局错误，因此导航门禁不可省略。

## 十二、最终验收标准

- 零资产 App 可以从完整自然语言操作链生成 `trial_ready` 草稿并进行真实试运行。
- 普通用户不需要进入资产录制页即可完成首次页面和交互资产沉淀。
- 动作完成但结果未验证的 Run 不显示为测试通过，也不能学习资产。
- 失败 Run、用户否认结果和混淆候选不会污染 PageAsset、InteractionAsset 或导航索引。
- ScriptFlow 源码和 AI 输出中仍不存在元素 ID、`ref`、坐标、区域目标或固定点击回退。
- 已学习交互资产能提高后续定位稳定性，但不会成为写新测试的前置条件。
- 只有验证通过且符合准入规则的测试进入用例中心和导航索引。
- 普通 Run 的截图/OCR/PageMatcher 调用量不因学习功能默认增加。

## 十三、行业实现依据

- Playwright Codegen 会从真实交互中生成测试和定位器，并优先选择 role、text、test id 等面向用户且更稳定的定位方式；这支持“先运行/录制行为，再形成可维护测试”的方向，但我们的移动端执行仍使用 OCR 和视觉内核。
- Playwright 的 locator strictness 会在目标不唯一时失败，而不是任意选择第一个；InteractionAsset 和 PageAsset 的准入也必须采用相同的唯一性原则。
- mabl 的 auto-heal 使用历史成功执行更新元素模型，低置信匹配会失败，并通过断言防止错误定位被保存；这支持“结果验证通过后才允许学习”的门禁。
- Tosca 的传统方式要求先扫描控件再构建测试；本方案把扫描变成试运行后的候选学习，目标就是减少这种前置建模成本，同时保留冲突时的人工校准能力。

参考：

- https://playwright.dev/docs/codegen
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/best-practices
- https://help.mabl.com/hc/en-us/articles/19078583792404-How-auto-heal-works
- https://help.mabl.com/hc/en-us/articles/19078158616340-Assertions-and-auto-heal
- https://documentation.tricentis.com/tosca/1520/en/content/tosca_commander/xscan_select_controls.htm
