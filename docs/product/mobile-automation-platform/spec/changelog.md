---
title: 自动化测试平台 Spec 变更记录
doc_type: changelog
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-07-10
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台 Spec 变更记录

## 2026-07-10

### Added

- 新增 `asset-driven-testing-requirements.md`，沉淀资产驱动测试的产品形态：App 级资产工作区、页面能力作为原子能力源头、连接边派生规则、参数中心、资产驱动巡检、元功能、组合用例、AI/MCP 诊断修复和全 App 巡检路线。

### Changed

- 平台 README 的 Spec 文件索引新增资产驱动测试产品形态需求入口，方便后续实现和评审引用。

## 2026-07-05

### Changed

- 登录 / 表单类固定语义控件正式收口为运行时定位规则：手机号 / 邮箱输入框、密码输入框、协议勾选、主登录按钮等 PageElement 使用 `runtime-locator:*`、`locatorKind=structural_locator` 和 `coordinateSpace=runtime`；历史圈选区域只允许保留为 `searchHintRegion` / debug evidence，不能作为 `region`、最终点击点、输入点或验证区域。
- 登录页本地页面资产更新为 4 个 runtime structural PageElement + 1 个 `账号密码登录` PageTask；`登录 -> 主页` 连接边只引用 `taskMode=source_page_navigation` + `taskId`，不再复制手机号输入框、密码输入框、协议勾选和登录按钮的底层动作。
- 资产录制面板对没有固定 `region` 的 runtime structural PageElement 显示“运行时定位”，避免把登录输入框 / 登录按钮误解为“未采集到控件位置”。

### Verified

- `pnpm vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/page-transition-assets.test.ts --testTimeout=15000` 通过，共 166 个测试，覆盖 runtime structural 登录控件展示、登录 PageTask 展开、运行时输入 / 点击定位和 source page task navigation。
- `pnpm --filter @mobile-automation/server typecheck` 与 `pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- 本地 SQLite 已备份到 `mobile-automation.sqlite.bak-login-runtime-cleanup-20260705165947`；登录页只保留 active 的 `登录 -> 主页` source PageTask 任务边，旧 `image-region:6,47,88,8` 登录按钮边和旧录制节点边已标记为 `deprecated`。

## 2026-07-02

### Added

- 新增 REQ-045 / DES-045 / T-093 / AC-047：探索异常 AI 诊断与受控资产修复。执行异常先固化证据并脱敏，再由规则和 AI 诊断分类为业务异常、资产过期、测试计划缺口、环境问题或不可判定。
- 新增 `AiDiagnosisEvidencePack`、`AiDiagnosisResult`、`AssetPatchCandidate`、`AssetPatchValidator` 和 MCP / REST 工具规划，支持 AI 查询证据、提交资产修复 patch、验证 patch、自动应用已验证 patch、回滚 patch、创建缺陷候选和按策略继续探索。

### Changed

- 明确 AI 不直接控制设备、不裸写 active 页面资产、不写入平台依赖 matcher；资产问题默认生成受控 draft patch，高置信、低风险、验证通过且策略允许时，可由系统自动应用为新的 active 资产版本并继续执行。
- 明确 crash / ANR / 黑屏 / App 退出 / fatal log 等高置信运行异常优先进入报告和缺陷候选，不自动走资产修复。

## 2026-07-01

### Added

- 新增 REQ-044 / DES-044 / T-092 / AC-046：资产驱动巡检。该能力作为独立产品入口，基于 active PageStateFlow 页面资产验证页面健康、区域滚动、元素重定位、连接边稳定性、PageTask 可执行性、性能指标和异常事件。
- 产品规划新增三层自动测试形态：目标驱动编排验证核心业务，资产驱动巡检验证已录入资产和主流程覆盖，自动探索 / 稳定性探索发现未知页面和异常状态。
- 新增场景 14“资产驱动巡检”，明确从当前页面匹配 PageModel 后按资产生成巡检计划，未录入候选只进入建议，不直接执行。

### Changed

- 明确旧的自动探索 / 稳定性探索入口不删除；资产驱动巡检和盲目探索必须入口隔离、策略隔离、资产写入权限隔离。
- 明确资产驱动巡检不得点击历史 `region_center`，也不得把所有 OCR / UI dump 候选当成可操作目标；只有正式 PageElement / PageTransition / PageTask 或明确允许的低风险健康动作可执行。

## 2026-06-26

### Changed

- `tap_on_image` 普通手工 `image-region` 不再默认点击 `region_center`。运行时必须先由 OCR、crop hash/template、视觉候选或结构候选完成重定位；失败时返回 `runtime_relocation_required`，metadata 标记 `fallback=region_center_disabled`，报告和修复 UI 使用记录区域 / 记录中心点作为修复证据。
- PageElement 录入模型新增 `locatorKind`、`dynamicMasks`、`structuralLocator`，用于区分文本定位、视觉定位、结构定位和集合项定位，并排除头像、昵称、业务标题、数字等动态内容。
- 动态列表 / 网格第一阶段模型落地：PageModel metadata 可保存 `dynamicRegion` 和 `itemTemplate`，PageElement / PageTransition action params 可保存 `transitionKind=parameterized` 与 `parameterMapping`。当前阶段先覆盖录入、持久化、回显和执行参数透传，不一次性实现完整列表参数化探索规划器。
- PageElement 保存质量校验扩展到结构型定位和动态内容：结构定位可用 `dynamicMasks` 排除个人头像 / 昵称；视觉-only 区域如果包含动态 OCR 文本且没有 mask，会提示 `dynamic_content_unmasked` 建议复核。

### Verified

- `CI=true pnpm vitest run platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-element-quality.test.ts` 通过，共 73 个测试。
- `CI=true pnpm vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts -t "structural locator|collection item|manual operation drafts"` 通过。
- `CI=true pnpm vitest run platform/apps/dashboard/src/App.test.ts -t "structural locator metadata|dynamic region|page ability type"` 通过。
- `CI=true pnpm --filter @mobile-automation/server typecheck` 与 `CI=true pnpm --filter @mobile-automation/dashboard typecheck` 通过。

## 2026-06-25

### Changed

- T-090 第一版稳定性探索落地：新增独立 Dashboard “稳定性探索”入口，可选择设备、输入 / 选择目标包、配置最大时长、最大动作数、seed、策略、允许动作、危险词和 App 外处理策略，并显示运行中提示、最近步骤、停止和报告入口。
- 后端新增 `StabilityExplorer` 服务和 `POST /api/stability-explorations`，稳定性探索以 `runKind=stability_exploration` 写入统一 Run / StepResult / Report 体系，保留 seed、动作来源、候选过滤原因、当前包、OCR 摘要和 summary artifact。
- Report Core 新增“稳定性探索摘要”，展示目标包、seed、策略、动作进度、App 外处理、过滤候选和最近动作。
- 已补 `stability-explorer.test.ts`、`App.test.ts`、`report-core.test.ts` 覆盖第一版稳定性探索核心行为。
- 登录页建模口径收口：登录页保留 4 个页面能力和 1 个页面任务 `账号密码登录`，其中任务负责手机号、密码、协议勾选和登录按钮的页内编排；从登录页到主页的连接边改为 `source_page_navigation` 任务边，只引用 `taskId` 和目标页，不再把多步登录动作复制进普通连接边。
- Dashboard 连接边页签新增“通过页面任务连接”入口，可从当前页已保存的 PageTask 直接创建到目标页面的边，适合登录、发布、创建这类多步跨页动作。
- GraphRun 执行链路已支持展开源页面 PageTask 导航边：运行时会先把登录页 PageTask 解析成多步 ActionStep，再进入目标页验证逻辑。

## 2026-06-23

### Changed

- 目标页面测试的 PageTask 参数语义调整为“可选覆盖项”：面板会按选中的目标页 PageTask 展开 `lessonName`、`duration`、`recordClassroom`、`recordLive` 等运行参数输入，但不要求必填。执行时只追加有值的字段步骤；未传参数的输入框、选择器、开关或次级编辑步骤会跳过，保留页面默认值。这样 `新建课堂` 页面不传 `duration` 时不会再进入课堂时长选择器并报错。
- 班级详情滚动状态识别收口：`班级详情` 展开态和折叠态仍归属同一个 PageModel，页面身份以稳定的页内底部 OCR 区域 `目录 / 聊天 / 待办 / 公告` 为关键依据；顶部栏、教学方案 / 学习方案入口等会随滚动变化的区域降为辅助依据，不再因为缺失而把页面识别为 unknown。PageMatcher 允许已确认页面资产在无 critical 缺失、候选质量 sufficient 且分数仅被可选滚动态 matcher 稀释时晋级命中。
- 班级详情出口动作定位文本拆分：`创建教学方案` / `创建学习方案` 保留为业务动作名，但运行时 OCR 定位 `targetText` 使用当前屏幕真实可见的 `教学方案` / `学习方案`；PageAbility 生成 `tap_on_image` 时优先使用显式 `targetText`，再回退到展示 `label`，避免业务名和 UI 文案不一致导致查找失败。
- PageTask 表单填写闭环补齐：`text_input` 不再只以 ADB 命令成功作为通过，输入后会再次截图并用 OCR 验证目标文本是否真实出现在页面中；验证失败时步骤直接失败并保留证据截图，避免“实际没输入但 run 通过”的假阳性。
- Android 文本输入 fallback 加固：`clear_text` 在检测到 ADB Keyboard 时优先使用 `ADB_CLEAR_TEXT` 广播，并在输入通道中继续使用 `ADB_INPUT_TEXT`；该策略解决华为设备上 `KEYCODE_CTRL_A` / `KEYCODE_DEL` 无法清空中文输入框的问题。
- PageTask 选择器和开关执行口径转正：`picker_select` 支持 OCR 空格归一和 `45` + `分钟` 分裂框合并后选中并确认；`toggle_set` 对未知状态的关闭请求采用安全跳过，避免误打开开关。`subpage_edit` 仍保留为后续能力。
- PageStateFlow 页面资产规则完成一次审计收口并清理本地 active graph：旧 `recording.*` / `录制节点:*` / `ClassIn 首页壳` 节点、旧 `package` / `activity` / `resource_id` / `accessibility_id` / UI-tree `text` 等平台依赖 matcher，以及旧 `tap_on_element` + `android_uiautomator` 动作边均已下线或清除。当前 active graph 不再保留会干扰 PageStateFlow 的旧平台依赖数据。
- 正式资产录入规则写入 design / tasks：人工录入、AI 录入、自动探索草稿转正都必须遵循 portable visual / OCR 白名单。PageModel 身份只允许确认 OCR、带 baseline 的截图重点区域和同区域 `semantic_image_region`；Android package / activity / resource-id / accessibility-id / className、UIAutomator 文本、iOS bundle / view controller / WDA source / accessibility id 等平台字段只能进入 raw/debug evidence 或平台 profile，不能成为正式页面身份。
- Server 保存链路加固：`confirmedMatchers` 继续过滤到 portable matcher，`confirmedOcrTexts` 也会过滤平台样式字符串；即使 AI 或用户误把 `resource-id:*`、`package:*`、`class:*`、`android.*` 等填进 OCR 字段，也不会生成正式 `ocr_text` matcher。页面资产仍要求至少有一条可执行的确认依据，否则拒绝保存。
- 页面资产库身份摘要继续收口：普通列表 / 详情的“页面匹配依据”不再使用 `confirmedUiTexts` 汇总，UI tree 文本和平台 id 只进入候选或折叠调试信息；正式摘要仅来自 portable OCR、截图重点区域和当前正式 matcher。
- `state_is` 页面状态预期收敛身份规则：当预期里存在 `nodeId` 时，`nodeId` 是唯一权威身份；历史 `nodeKey` / `nodeName` 只作为报告展示字段，不再因为用户改名或旧 runtime key 残留导致执行失败。缺少 `nodeId` 时才回退使用 key / name 约束。
- 修复内置业务图谱 revision 升级后“已保存页面资产消失”的显示问题：seed 内置图谱时会把上一 active version 中用户确认的 PageAsset 和 `manual.*` PageTransition 迁移到新 active version；页面资产库刷新时重新以 `/api/graphs` 的最新 activeVersion 拉取资产，并在页面重新获得焦点时自动刷新，避免旧 graph version 缓存让面板显示 0 个资产。
- PageStateFlow 主页出口资产补录：active graph `ClassIn Android 业务图谱` 中已确认 `课程表`、`空间`、`成长`、`添加好友`、`加入班级` 页面资产，并补齐从 `主页 / classin.teacher.classes` 到这些页面的 active PageTransition；底部 Tab 使用手工 `image-region`，右上角加号菜单使用 `compound_navigation`。
- 修复同一触发区域的复合跳转互相覆盖问题：例如 `主页 -> 添加好友` 和 `主页 -> 加入班级` 都先点击右上角加号，但中间等待 / 点击的菜单项不同；PageTransition key、旧边淘汰、PageElement upsert 和删除逻辑现在都会带上 `compoundSteps` 签名，确保多条菜单出口可共存、可规划、可删除。
- 页面资产摘要过滤规则补齐：已 `deprecated` 的 PageTransition 不再出现在已保存页面资产的 outgoing transitions 中，避免面板继续展示旧录制节点或已废弃连接边。
- 误录资产治理：此前误把菜单中的 `加入公开课` 捕获成“全网搜索班级 / 输入班级号加入班级”同类页面，已将错误节点和对应旧边下线；真实 `新建公开课` 页面资产和已有直达连接不受影响。若后续需要覆盖“加入公开课”这个菜单入口，需要在确认真实目标页后重新按复合边录入。
- 修复主页滚动后执行 `主页 -> 新建公开课` 被前置条件阻断的问题：内置 `classin.teacher.classes` 页面不再把 `创建班级` 这种内容区滚动入口作为页面身份 matcher 或默认预期；这类入口归属 PageAbility / PageElement，由 `availability=after_scroll` 描述。
- PageStateFlow 快速视觉执行口径收敛：当前页面由 PageMatcher 识别为 step source 后，边上的历史 `state_is` / 文本前置断言不再作为阻断条件；边只负责执行当前页已确认出口能力，执行后再用目标页面 matcher / expectation 验证是否到达，避免 active graph 迁移后旧 nodeId 前置误杀。
- `tap_on_image` 执行器补齐内容区滚动显露策略：当动作带有 `targetText`、`semanticArea=content` 且 `availability=after_scroll` 时，会先 OCR 定位目标文字；若不可见，会先执行受控滑动显露，再重新截图 / OCR 并点击运行时文字位置，减少页面已滚动导致的旧坐标误点。
- 兼容历史页面出口数据：旧 PageTransition 如果只保存了 `elementLabel` 而没有 `targetText`，在 `content + availability=after_scroll` 场景下会把 `elementLabel` 作为 OCR 查找目标，先滑动显露再点击；顶部 / 底部固定元素仍按人工标记区域执行。
- PageStateFlow 支持运行期动态参数：目标页面测试新增“目标项 / 班级名”输入，支持直接填 `班级四十二号`，也支持 `className=班级四十二号`；`RuntimeOverlay.runtimeParams` 会在本次 ExecutionPlan 内替换 `{{className}}` 等 action params 模板，不写回 active graph。`grid_candidate` 可把 `scrollProfile.targetQuery` 配成 `{{className}}`，执行时在人工圈选的列表 / 网格区域内 OCR 查找指定文本，按文本所在 cell 点击安全点，找不到则滑动容器继续搜索；指定目标最终未命中会失败并报告 `target_not_found`，不会自动改点第一个候选。历史 `targetKind=nth_item` 网格资产如果本次运行带 `className`，会临时升级为按 OCR 文本定位目标卡片，避免“指定四十二号却进入四十一号”。
- 页面资产库面板收敛为业务视角：移除常驻 `PageStateFlow` / `PageStateLibrary` 等内部解释文案；资产列表默认只展示页面名、已确认摘要、匹配依据数、可操作数、出口数和操作按钮；点击“详情”后从右侧打开半屏抽屉，展示概览、页面匹配依据、截图重点区域、页面能力、连接边和折叠调试信息。资产库展示的“匹配依据”只来自白名单 `confirmedMatchers`、`confirmedOcrTexts` 和带 baseline 的 `screenshotRegions`；`confirmedUiTexts`、`visibleTexts`、resource-id、accessibility-id 等 UI tree / 原始采集信号只放入候选或“原始采集与调试信息”，避免账号名、组织名、课程标题等动态业务数据被误当成稳定页面身份。
- 页面资产详情继续收紧展示口径：截图重点区域自动采集的 `evidenceTexts` 中如果包含 Android resource-id、`android.view.*`、`user avatar`、`icon`、`search` 等平台 / 技术标签，只进入“原始采集与调试信息”，不再出现在“页面匹配依据”或重点区域普通展示中；用户可读 OCR 文字和人工区域标签仍保留为资产摘要。
- 新增 PageTask 页内任务闭环：资产录制详情新增“页面任务”页签，PageTask 归属于当前 PageModel，用来编排到达目标页面后的输入文本、点击 / 提交和等待结果等页面内步骤；步骤引用当前页已保存 PageElement，`wait` 步骤可只依赖等待文字。Dashboard 可新增、编辑、删除 PageTask，Server 通过 `POST /api/graphs/:versionId/assets/page-tasks` 和 `DELETE /api/graphs/:versionId/assets/page-tasks/:sourceNodeId/:taskId` 写入源页面的 `assetRecordingPageTasks`。目标页面测试的“目标动作”可选择目标页 PageTask，GraphRun 到达目标 PageModel 后会追加 PageTask steps，并通过 `RuntimeOverlay.runtimeParams` 注入 `lessonName` 等运行期业务参数，报告 metadata 回显 `pageTaskId` / `pageTaskName` / `pageTaskStepId` / `runtimeParamKeys`。
- 班级详情出口补齐为正式 PageElement / PageTransition：`班级详情` 现在稳定连接 `教学方案`、`学习方案`、`班级聊天`、`班级待办`、`班级公告`、`发布活动类型选择页`，并可通过两跳 `班级详情 -> 发布活动类型选择页 -> 新建课堂` 到达新建课堂。底部 `聊天 / 待办 / 公告` 作为底部固定区域能力保存；`教学方案 / 学习方案 / 发布活动` 作为内容区条件点击能力保存，并携带运行时 OCR `targetText` 用于视觉重定位和滚动显露。
- 发布活动类型选择页出口补齐为正式 PageElement / PageTransition：`发布活动类型选择页` 现在连接 `新建课堂`、`新建作业`、`新建测验`、`新建录播课`、`新建资料`。活动类型入口按人工 `image-region` + `targetText` 执行，路径规划不依赖 Android UIAutomator / resource-id。
- 页面能力保存链路新增显式 `targetText` 字段：Dashboard PageElement / 连接边表单、REST `/assets/page-elements` 与 `/assets/transitions`、Server 持久化和 PageAbility 临时边生成均支持把“展示给人的动作名”与“运行时 OCR 识别文字”拆开。例如动作名可保存为 `创建学习方案`，执行识别文字保存为 `学习方案`。
- 本地 active graph 清理重复 runtime 页面资产：旧 `runtime.unknown.1ium727 / 发布活动` 与 `runtime.unknown.1ip80po / 新建课堂` 已合并到 canonical visual 页面资产 `classin.teacher.activity.publish.visual` 与 `classin.teacher.lesson.create.visual`，旧节点标记为 deprecated 并记录 `canonicalNodeId`；相关旧 `recording.*` draft 边和历史 `tap_on_element + android_uiautomator` 发布活动边不再参与规划。

### Verified

- 真机 `ERLDU20115007395 / YAL-AL10` 在 `cn.eeo.classin/cn.eeo.lms.lesson.LmsCreateLessonActivity` 上验证新建课堂 PageTask：最小输入链路成功把标题清空并输入 `自动化课堂最小验证`；完整目标页 PageTask `task-fill-new-lesson-form-no-publish` 执行通过，runId 为 `run_ac71431c-d086-42a8-a961-698b4f3fcec3`，5 个步骤全部 passed，最终页面显示 `自动化课堂测试7` 和 `11小时45分钟`，未点击发布。
- 真机 `ERLDU20115007395 / YAL-AL10` 验证班级详情展开态：当前页识别命中 `班级详情`，虽然总分 `0.5909 < 0.6`，但因质量 sufficient 且无 critical 缺失被正确晋级；随后执行 `班级详情 -> 学习方案` 通过，runId 为 `run_1bae8b51-4ac9-4c11-adee-0268737ee1fa`，执行前匹配 `班级详情`，执行后匹配 `学习方案`，动作参数使用 `targetText=学习方案`。
- 真机 `ERLDU20115007395 / YAL-AL10` 验证 PageTask 可选参数规则：目标为 `新建课堂`，选择 `task-fill-new-lesson-form-no-publish` 但不传任何运行参数，runId 为 `run_d9220db6-13e3-487c-bd94-a72a989cb07b`，执行只验证到达目标页并通过，没有执行课堂时长 / 开关 / 输入覆盖步骤。
- `pnpm vitest run platform/packages/android-driver/src/android-actions.test.ts` 通过，共 8 个测试，覆盖 ADB Keyboard 清空文本通道。
- `pnpm vitest run platform/apps/server/src/semantic-locator.test.ts` 通过，共 29 个测试，覆盖输入后 OCR 验证、验证失败阻断、选择器分裂 OCR、开关安全跳过等 PageTask 关键动作。
- `pnpm vitest run platform/apps/server/src/graph-run-service.test.ts --testNamePattern "target page task|picker, toggle"` 通过；`pnpm --filter @mobile-automation/server typecheck` 与 `pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm test:unit platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/graph-run-service.test.ts` 通过，共 53 个测试，覆盖 deprecated transition 过滤、同触发复合边共存、PageAbility 边规划和 GraphRun 回归。
- `pnpm vitest run platform/apps/server/src/builtin-graphs.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/page-transition-assets.test.ts` 通过，覆盖主页不依赖内容区滚动入口、`after_scroll` 视觉动作先显露再点击、页面能力边和页面转移资产回归。
- `pnpm --filter @mobile-automation/server typecheck` 通过；本地 SQLite active graph 已刷新到 `builtin_revision:classin_android_graph:v8`，active `classin.teacher.classes` 节点不再包含 `创建班级` matcher / 默认预期。
- 真机 `ERLDU20115007395 / YAL_AL10` 验证 PageStateFlow 目标执行：`主页 -> 空间`、`主页 -> 成长`、`主页 -> 课程表`、`主页 -> 添加好友`、`主页 -> 加入班级` 均执行通过；复合边报告中可看到主动作 `tap_on_image`、中间 `wait_until_state` 和菜单项 `tap_on_text` 的 micro-step。
- 真机 `ERLDU20115007395 / YAL_AL10` 验证班级详情与发布活动出口：`班级详情 -> 发布活动类型选择页 -> 新建课堂` 执行通过，runId 为 `run_4e63eb88-3b2a-42a7-b1fc-16902eb17ae7`；`班级详情 -> 班级公告` 执行通过，runId 为 `run_08151334-6aa3-4c2a-8df9-2d68a40fbe9d`；`发布活动类型选择页 -> 新建作业` 执行通过，runId 为 `run_2dba3148-6001-4410-ac9e-665c59a64939`。`route-plan` 批量预检通过 `班级详情` 的教学方案、学习方案、聊天、待办、公告、发布活动、新建课堂，以及 `发布活动类型选择页` 的新建课堂、作业、测验、录播课、资料出口。
- 通过 `/api/graphs/:graphVersionId/assets` 复核 active graph：`加入公开课` 错误资产不再出现在页面资产列表；`主页` outgoing transitions 中保留 active 的底部 Tab 出口、菜单复合出口，以及已有搜索 / 待办 / 消息 / 班级详情等人工录入出口。
- `pnpm vitest run platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts` 通过，共 104 个测试，覆盖 `targetText` 在 PageElement、PageTransition、Dashboard 表单和请求体中的透传；`pnpm --filter @mobile-automation/server typecheck` 与 `pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm vitest run platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/server/src/builtin-graphs.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/page-transition-assets.test.ts` 通过，共 47 个测试，覆盖 active graph 资产迁移、资产面板按最新 activeVersion 刷新、页面资产和连接边回归；`pnpm --filter @mobile-automation/dashboard typecheck` 与 `pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm vitest run platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/builtin-graphs.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts` 通过，共 78 个测试，覆盖 fast_visual 跳过重复边前置、`elementLabel + after_scroll` 滚动显露兼容、内置图谱迁移和页面连接边回归；`pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm vitest run platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，共 10 个测试，覆盖目标页面测试表单、资产列表业务摘要、资产详情抽屉、原始业务文本不冒充匹配依据和 active graph 资产刷新；`pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，共 16 个测试，覆盖页面资产 summary 将确认依据与原始可见文本拆开，以及 Dashboard 只用确认依据展示资产摘要；`pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，共 19 个测试，覆盖截图重点区域自动 evidence 中的平台 id / 技术标签不再进入普通页面匹配依据展示。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts` 通过，共 28 个测试，覆盖 `state_is` 以 `nodeId` 为权威身份、旧 `nodeKey` / `nodeName` 不再阻断执行。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，覆盖 RuntimeOverlay 运行参数模板替换、OCR 命中指定 `grid_candidate`、滑动后命中指定候选、参数化候选未找到失败，以及目标页面测试表单提交运行参数。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，共 97 个测试，覆盖纯文本班级名解析为 `className`、旧 `nth_item` grid candidate 带 `className` 时临时升级为 OCR `item_text`、指定班级名时点击对应网格卡片，以及参数化候选不触发下游失败后的“换下一个候选”策略。
- 本地 SQLite active graph `graph_version_71f325ac-0bbb-4a02-9d7a-5cc35c8f3507` 复核通过：active 旧录制节点数量 0，active 平台依赖 matcher 数量 0，active `tap_on_element` / `android_uiautomator` 旧动作边数量 0。
- 真机 `ERLDU20115007395` 以 `fast_visual` 执行 PageStateFlow 核心目标回归均通过：`主页 -> 新建公开课`（`run_651ef753-5132-4c45-9a45-74d1987120dd`）、`主页 -> 添加好友`（`run_2bb6886d-1582-4ecc-8bda-ec39569c89fc`）、`主页 -> 加入班级`（`run_ff9ea335-8570-487d-b97e-49ec533e8fad`）、`主页 -> 班级详情 -> 发布活动类型选择页 -> 新建课堂`（`run_799eb985-35ac-496f-9a61-90ce80f06d49`）。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，覆盖 PageTask 保存请求体、当前页资产映射 PageTask、资产录制“页面任务”页签、PageTask 表单 draft、目标页面测试选择目标页 PageTask 并生成 `targetTaskId`。
- `pnpm exec vitest run platform/apps/server/src/page-task-assets.test.ts platform/apps/server/src/graph-run-service.test.ts -t "PageTask|page task|target page task|persistPageTaskAsset"` 通过，覆盖 PageTask 保存 / 更新 / 删除、未确认页面拒绝保存、GraphRun 到达目标页后追加并执行目标 PageTask。
- `pnpm --filter @mobile-automation/dashboard typecheck` 与 `pnpm --filter @mobile-automation/server typecheck` 通过。

## 2026-06-22

### Changed

- PageStateFlow 视觉资产坐标模型升级：`StateMatcher`、截图重点区域、region-bound OCR / UI 文本、手工 PageElement 和 PageTransition action params 现在会保存 `semanticArea` 与 `coordinateSpace`。`semanticArea` 收敛为 `top` / `content` / `bottom` / `unknown` 四个大区；旧细分区域值不做兼容映射，异常历史资产按删除后重新录入处理。区域坐标继续保留为用户圈选的原始证据，但不再作为唯一真理。
- PageMatcher 支持同语义区域内的区域 OCR / 文本漂移匹配：如果历史资产保存的 OCR 框和当前 OCR 框因为 OCR 引擎、状态栏 inset 或截图采集差异发生小幅偏移，只要仍处于同一视觉语义区域即可命中；跨语义区域同文案不会误命中。
- `tap_on_image` 执行策略升级：非网格手工 image-region 动作会携带 `targetText`，运行时先在当前截图 OCR 结果中按同一 `semanticArea` 重定位目标文字并点击 OCR 框中心；当日实现曾允许区域中心兜底，该兜底已在 2026-06-26 废弃。
- 兼容历史手工 image-region 边：旧 action 如果还没有 `targetText`，运行时会读取 `elementLabel` / `label` 作为重定位目标文案，减少旧资产重录成本。
- 资产录制面板和后端 API 已贯通 `semanticArea` / `coordinateSpace`：截图重点区域绘制 / 移动 / 缩放会实时刷新语义区域，保存页面资产、保存手工可操作元素、由 PageElement 创建 navigate transition 时均会保留这些字段。
- 资产录制面板支持人工选择 / 修改 `semanticArea`：页面截图重点区域和手工动作区域都提供语义区域下拉，用户可以在 `top`、`content`、`bottom`、`unknown` 四个大区里修正系统推断结果，保存后进入 PageMatcher / PageElement / PageTransition 数据。
- 页面能力新增 `scroll_candidate`：用于表达中间内容区里需要滚动查找的目标；当目标是图标、图片按钮或其它没有稳定 OCR 的元素时，面板会保存 `targetKind=image_region` 与 `targetQuery=image-region:x,y,width,height`，执行侧后续可按“截图查找目标 -> 找不到就滑动”的闭环处理。
- 资产录制详情页签职责收口：“页面能力”只管理 PageElement / PageAbility；连接边页签从当前页已保存 PageElement 中选择动作，搜索 / 选择目标页面，保存 navigate PageTransition，并展示 / 删除当前页已录入连接边。
- `grid_candidate` 保存和执行链路补齐同屏候选重试信息：PageAbility / 手工 PageTransition 保存时写入 `candidateIndex=0` 和 `maxCandidateAttempts`；`tap_on_image` 会按候选序号计算网格点击点；graph-run 失败重规划时根据 recovery attempt 改写 `candidateIndex`，尝试下一个同屏候选。滚动翻页候选闭环仍作为后续增强。
- OCR 后端接入 PaddleOCR：Server 新增 `PaddleOcrService`，通过本地 HTTP 服务协议调用 PaddleOCR，协议为 `POST /ocr`，请求 `{ imageBase64, lang }`，响应 `{ text, engine, lang, width, height, boxes[] }`；`OCR_ENGINE=paddle` 可强制使用 PaddleOCR，`OCR_ENGINE=auto` 默认按 PaddleOCR -> Tesseract -> macOS Vision fallback。
- 新增 `scripts/paddleocr-http-service.py` 作为本地 PaddleOCR HTTP wrapper 示例，避免 Node 服务直接绑定 Python / PaddlePaddle 依赖；README 补充 PaddleOCR 启动和环境变量配置。
- PaddleOCR wrapper 加固新版 / 旧版返回结构归一化：支持 `.json()` / `.json` / `.res` 结果对象、`rec_polys` / `dt_polys` / `rec_boxes` / `boxes` 坐标字段，并按 PaddleOCR 语言缓存实例，避免多语言请求复用错误模型。
- OCR 后端新增 RapidOCR：Server 新增 `RapidOcrService`，通过 `scripts/rapidocr-http-service.py` 本地 HTTP 服务调用 RapidOCR / ONNX Runtime；`OCR_ENGINE=rapid` 可强制使用，`OCR_ENGINE=auto` 更新为 RapidOCR -> PaddleOCR -> Tesseract -> macOS Vision fallback。
- Server 启动流程新增 RapidOCR sidecar 自动启动：默认在 `OCR_ENGINE=auto` / `rapid` 且使用本地 `RAPID_OCR_ENDPOINT` 时自动拉起 `scripts/rapidocr-http-service.py`，已有健康服务则复用；SIGINT / SIGTERM 时随 server 一起关闭。
- 基于实时 Android 设备截图重新 benchmark OCR：RapidOCR 在 1080x2340 ClassIn 主页全屏截图约 0.6s/张，且能完整识别底部导航；PaddleOCR CPU 全屏约 13-16s/张；macOS Vision 约 0.8-1.8s/张。
- 页面资产库 / 目标页面测试页签改为任务表单，不再展示已保存资产列表；表单包含“目标页面”下拉输入、“目标动作”和“目标验证”。当前目标动作一期支持“页面到达后不执行动作”，目标验证支持“仅验证已到达目标页面”和“验证目标页面包含文字”，文字验证通过 RuntimeOverlay 临时挂到目标节点，不写入资产库。
- 明确页面内状态不再作为独立页面资产：右上角更多菜单、底部 sheet、选择器、临时弹窗、局部黑条等归属到父页面的 PageElement / PageAbility / PageTransition 中间步骤。PageMatcher 在父页面身份锚点仍命中、只是局部状态遮挡部分 matcher 时回落匹配父页面；录制动作前后仍为同一 PageModel 时跳过 PageTransition candidate，不再生成 `主页 -> 录制节点：添加好友` 这类边。
- 当前页面识别和资产录制动作后识别进一步收紧为 stable PageModel-only：只允许 `nodeType=page`、`status=active` 且已确认为 `page-asset` / `assetRecordingConfirmed` 的节点参与当前页身份匹配；历史 `business_state`、`page-overlay`、`asset-recording`、`manual-recording` 节点即使命中“添加好友”等局部菜单文案，也不会再成为当前页或 PageTransition 目标。
- 资产录制写入 PageTransition 时新增 popup-only / local-state 保护：动作后如果只观察到“添加好友 / 加入班级 / 加入公开课 / 扫一扫”等页面内菜单文字，而没有稳定命中新的 PageModel，则按父页面局部状态处理并跳过 PageTransition，不再创建或复用 `recording.*` 旧录制节点。
- 清理本地实验图谱中的旧录制数据：已将 active graph 里的旧 `manual_recording`、`recording.*`、`runtime-discovered`、`legacy.case_*` 节点 / 边下线为 `deprecated`；当前页面资产和 `manual_edit` 页面连接边保留。清理前已备份 SQLite 到 `/Users/eeo/.local/share/mobile-automation/backups/mobile-automation-before-old-recording-node-cleanup-20260622210214.sqlite`。
- `compound_navigation` 复合跳转链路落地：PageElement / PageTransition API、持久化和 Dashboard 表单均支持 `compoundSteps`；连接边可表达“点击右上角 + -> 等待添加好友文字 -> 点击添加好友 -> 到达添加好友页”，中间菜单不再作为独立 PageModel。
- GraphRun 执行器支持复合 micro-step：执行时会把主动作和 `compoundSteps` 展开为同一个 PageTransition 内的动作序列，任一步失败会中止该边，并在报告中展示每个 micro-step 的类型、标签、结果和失败信息。
- `grid_candidate` 下游失败重试补齐：当候选入口进入详情后，后续路径失败时，执行器会返回候选源页并尝试下一个同屏候选；报告记录 `grid_candidate_downstream_failed`、候选序号、回退动作和重试原因。
- 目标执行报告优化：GraphRun 详情页现在展示本步可读动作摘要、动作前 / 后页面匹配结果、复合步骤明细、候选重试原因和失败原因，避免只看到 edge id 或底层 metadata。
- Spec 同步更新：requirements / design / tasks / acceptance 已把 `compound_navigation`、`grid_candidate` 候选重试和结构化执行报告列为 PageStateFlow 当前主线能力。

### Verified

- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/semantic-locator.test.ts platform/packages/graph-core/src/graph-core.test.ts` 通过，覆盖四区 `semanticArea`、页面匹配、页面资产保存、手工 PageElement / PageTransition 入库、`scroll_candidate` image-region、grid candidate 参数保存和视觉候选点击，共 159 个测试。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts` 通过，覆盖 graph-run 恢复、fast_visual 和 `grid_candidate` recovery attempt 转候选序号，共 23 个测试。
- `pnpm exec tsc -p platform/packages/graph-core/tsconfig.json --noEmit` 通过。
- `pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过。
- `pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit` 通过。
- `pnpm exec vitest run platform/apps/server/src/ocr.test.ts` 通过，覆盖 PaddleOCR adapter 的 text / boxes 标准化和 `OCR_ENGINE=paddle` 选择。
- `python3 -m py_compile scripts/paddleocr-http-service.py` 通过，确认 PaddleOCR HTTP wrapper 脚本语法有效。
- 本机通过 `uv venv .venv-paddleocr --python 3.11` 安装 `paddleocr==3.7.0`、`paddlepaddle==3.3.1`，临时启动 `scripts/paddleocr-http-service.py` 并对真实截图 `.tmp-home-current.png` 调用 `POST /ocr` 成功，返回 `engine=paddleocr`、18 个 OCR boxes 和中文文本预览。
- `pnpm exec vitest run platform/apps/server/src/ocr.test.ts` 通过，覆盖 RapidOCR adapter 的 text / boxes 标准化和 `OCR_ENGINE=rapid` 选择。
- `pnpm exec vitest run platform/apps/server/src/ocr-sidecar.test.ts` 通过，覆盖 RapidOCR sidecar 自动启动条件、关闭开关和 health URL 规则。
- `python3 -m py_compile scripts/rapidocr-http-service.py` 通过，确认 RapidOCR HTTP wrapper 脚本语法有效。
- 本机安装 `rapidocr==3.8.4`、`onnxruntime==1.27.0`，对 ADB 实时截图 `.tmp-live-ocr-benchmark/live-1.png` / `live-2.png` / `live-3.png` 调用 RapidOCR 成功，单张全屏约 0.6s，关键字命中包含 `主页`、`消息`、`待办`、`创建公开课`、`全部班级`、`我是教师`、`课程表`、`空间`、`成长`。
- `PORT=4029 OCR_ENGINE=rapid pnpm --filter @mobile-automation/server start` smoke 通过：server 启动时自动拉起 RapidOCR sidecar，`/api/health` 和 `http://127.0.0.1:8766/health` 均可访问；停止 server 后 RapidOCR sidecar 随之退出。
- `pnpm exec vitest run platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/dashboard/src/App.test.ts` 通过，覆盖目标页面测试任务表单、目标资产选择、RuntimeOverlay 文字验证请求和页面资产库列表页签回归。
- `pnpm vitest run platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/recording-graph-assets.test.ts` 通过，覆盖“主页 + 更多菜单”识别回父页面，以及同页局部状态不生成 PageTransition candidate。
- `pnpm vitest run platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/recording-graph-assets.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖页面匹配、录制资产、目标执行、页面能力、连接边和面板映射回归，共 154 个测试。
- `pnpm vitest run platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/recording-graph-assets.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖旧 overlay / manual recording 节点不参与当前页识别、局部菜单动作不生成跨页 PageTransition、页面匹配和目标执行回归，共 135 个测试。
- `pnpm -r typecheck` 通过。
- 本地 SQLite 清理后通过 `/api/graphs` 验证 active graph 中未下线的旧录制节点 / 旧录制边数量均为 0；原异常边 `主页 -> 录制节点：添加好友` 和目标节点 `录制节点：添加好友` 均已变为 `deprecated`。
- `pnpm vitest run platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/recording-graph-assets.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，共 113 个测试。
- `pnpm vitest run platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/graph-node-test-result.test.ts` 通过，共 65 个测试，覆盖复合跳转入库 / 执行、grid candidate 重试、语义 locator 和 GraphRun 结构化结果。
- `pnpm vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts` 通过，共 73 个测试，覆盖复合跳转表单、连接边请求参数和报告可读展示。
- `pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm --filter @mobile-automation/dashboard typecheck` 通过。

## 2026-06-20

### Changed

- 目标页面测试新增 `fast_visual` 快速执行模式：Dashboard 的 route-plan preview 和 graph-run 请求默认携带 `executionProfile=fast_visual`；预检和执行 Observation 关闭 UI tree / UIAutomator dump，页面匹配优先使用已确认截图重点区域、区域 OCR 和 PageMatcher；graph-run 会复用预检识别到的 `startNodeId`，避免启动执行后再做一次起点识别；快速模式下默认不录制 / 保留成功视频，动作优先走人工区域生成的 `tap_on_image`。
- 目标执行新增“已知但不可达起点自动返回恢复”：route-plan preview 和 graph-run 启动前会先识别当前页面；如果当前页面在目标 App 内、稳定命中 active 页面资产，但从该页面到目标不可达，系统会最多执行 3 次 `back` 并在每次返回后重新识别页面，一旦回到可达页面再重新规划路径。该策略用于处理“当前停在搜索页但目标是新建课堂”等场景，不要求录入“搜索页 -> 所有目标页”的无意义连接边；未知页、低置信页、目标 App 外、登录态缺失或阻断态不会盲目 back。
- 目标页面测试页签接入执行入口：输入页面名 / key / 页面摘要后，会从已保存页面资产中选择最佳匹配页面资产作为目标节点，并调用现有 `/api/graph-runs` 发起执行，启动后跳转到执行结果页；如果当前页到目标页缺少 active PageTransition / graph edge，后端会返回路径不可达或规划失败，不再停留在按钮只有展示的状态。
- PageMatcher 文本 / OCR 依据匹配新增首尾符号噪声归一化：历史资产里保存的标题依据如果包含 OCR 合并出的返回箭头或装饰符号，例如 `< 新建公开课`，运行时识别到 `新建公开课` 仍可命中；该逻辑只处理首尾非文字 / 数字符号，并继续保留 `region` 区域约束，避免同名文案出现在底部导航、列表或弹窗时误判为当前页面。

### Verified

- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts` 通过，覆盖 `fast_visual` 模式不采集 Android UI hierarchy、关闭成功视频保留、执行 `tap_on_image` 区域点击，并确认默认完整模式的 App 外 / 未知状态 / 登录态 / 阻断态起点识别回归不受影响。
- `pnpm exec vitest run platform/apps/server/src/start-node-recovery.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，覆盖目标页面测试请求携带 `fast_visual`、复用预检起点和起点恢复 UI 回归。
- `pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit` 通过。
- `pnpm exec vitest run platform/apps/server/src/start-node-recovery.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，覆盖从“搜索”等已知但不可达起点执行 back 恢复、GraphRun 事件记录和目标页面执行提示。
- 起点恢复策略调整为受控返回探路：稳定页面资产在到目标不可达时允许最多 3 次 `back` 并逐次重新识别；一旦回到主页 / 首页 / root 仍不可达，就停止并提示补录从主页到目标的连接边；一旦 `back` 后离开目标 App，就直接返回 `START_BACK_RECOVERY_FAILED`，不再继续启动 App 或退到桌面。返回能力不沉淀为普通业务边，因此不需要录入 `添加好友 -> 主页` 或 `添加好友 -> 发布活动` 这类反向 / 跨页恢复边。
- `pnpm test:unit platform/apps/server/src/start-node-recovery.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/route-plan-preview.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/page-ability-edges.test.ts` 通过，覆盖受控起点恢复、稳定子页 back 到可达父页、离开目标 App 立即失败、页面能力边和页面转移资产回归。
- `pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts --testNamePattern "leading symbol noise|configured relative title region"` 通过，覆盖 OCR 标题首尾符号噪声兼容，以及底部同名文字仍不命中。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts` 通过，覆盖页面资产库目标页签、目标资产选择和执行入口挂接。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts` 通过，覆盖 graph-core、当前页面资产识别和 PageMatcher 回归。
- `pnpm exec tsc -p platform/packages/graph-core/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit` 通过。
- 真机调用 `POST /api/graphs/:versionId/current-page` 验证当前 ClassIn `新建公开课` 页面恢复为 `matched`，命中已保存页面资产 `新建公开课 / node_e61d09a2-d8d3-455e-9776-dc778f3f5924`，`< 新建公开课` critical OCR 依据实际命中 OCR 结果 `新建公开课`。

## 2026-06-18

### Changed

- 新增 `semantic_image_region` 页面匹配器：截图重点区域保存 baseline artifact 后，除 critical `image_region` 外，会同步生成默认非 critical 的轻量语义区域 matcher；识别时先用区域内 OCR / UI tokens、相对 layout 和签名 hash 计算语义相似度，并可结合视觉 baseline 作为兜底，解决同一页面固定区域内角标、出勤数字、账号 / 班级动态信息变化导致纯像素区域低分的问题。OpenCLIP / SigLIP embedding 服务暂不接入生产逻辑，仅作为后续可选增强规划。
- 资产录制入口调整为 page-only：Dashboard 不再展示“保存类型 / 页面 / 浮层”“浮层类型”“行为类型”“关闭方式”，保存 / 更新按钮只写入页面资产。右上角菜单、底部面板、局部黑条、弹窗等不再默认保存为独立 PageModel，而是沉淀到父页面的页面能力、连接边条件步骤或 Runtime Interceptor；历史 `assetKind=overlay` / `page-overlay` 数据仅作为兼容输入读取和迁移上下文。
- 资产录制截图重点区域从纯 metadata 升级为强匹配依据：保存 / 更新页面资产时会为圈选区域生成 `image_region` matcher，并在当前 Observation 截图可用时写入区域 baseline artifact；当前页面识别会优先基于 baseline artifact 计算区域相似度，缺少基线时回退到区域内 OCR / UI 文本签名；已保存过但尚未重新保存的旧资产，会从 `metadata.screenshotRegions` 临时合成 `image_region` 强 matcher，避免仅凭单个弱 OCR 文本误命中已保存浮层。
- 资产录制页支持人工修正 OCR 文本依据：已确认或候选中的 `OCR 文字` 可点击“编辑”修正后写回确认依据；`页面文字` / UI tree 文本只作为候选或调试来源，若要成为页面身份必须转换为带区域的 OCR 依据，避免把平台树文本、图标、角标或 OCR 噪声作为长期页面 matcher 保存。
- 页面资产保存和当前页显示收紧为严格确认模型：保存 / 更新 active PageModel 时必须至少有一个可执行确认依据；未确认候选和运行期自动 matcher 不再写入正式 matcher；Dashboard 也不再把高分 `draft_candidate` 前端提升为“已匹配”，只有后端 `detectNode` 通过质量门禁返回 `matched` 才显示为已匹配。
- 调整截图重点区域匹配策略：只有已绑定视觉 baseline artifact 的截图区域才会生成 critical `image_region` matcher；旧资产里仅有坐标、没有 baseline 的截图区域继续作为 metadata 保存，但不再阻断页面匹配，避免主页等页面在文本 / 控件证据全部命中时仍显示“待建立基准”。
- 资产录制页预览操作改为即时下发：点击 / 滑动 / 长按不再为了实时 locator 或当前页 observation 采集而阻塞手机动作；动作发送成功后进入“识别中”状态，后台等待新界面稳定、生成 PageTransition candidate 并刷新当前页面识别，期间遮罩预览区并阻断继续操作。
- 资产录制识别状态改为 in-flight 计数：页面切换自动识别、动作后识别和手动识别重叠时，只有所有识别任务结束才解除“识别中”遮罩，避免遮罩提前消失或连续误点。
- 资产录制页默认页面名不再展示内部草稿前缀：待保存草稿优先使用视觉识别名，例如 `消息`；只有系统内部节点仍保留 `运行期未知节点：xxx` 用于诊断。已保存页面资产继续优先展示用户确认过的资产名，不会被视觉标题覆盖。
- 旧浮层保存能力降级为兼容层：后端仍可读取既有 overlay metadata，便于迁移历史数据；新录入页面不再从资产录制 UI 创建浮层资产。
- 页面资产库新增删除入口：已保存页面资产列表每行提供“删除”按钮；删除采用软删除 / 弃用实现，服务端把确认过的页面资产节点置为 `deprecated`，资产摘要默认隐藏 deprecated 页面，历史报告和旧引用仍可追溯。
- 资产录制“页面能力”页签改为 PageElement-first：该页签只管理当前页面可操作元素，不在同一表单内绑定目标页面或创建 PageTransition。已录入元素优先展示，支持编辑 / 删除；列表底部提供“+ 添加可操作元素”。用户在截图上圈选区域后填写动作名称、出现条件、结果草稿和滚动容器信息，保存为 `image-region:x,y,width,height` PageElement，写入源 PageModel 的 `assetRecordingManualElements`。结果草稿支持直接跳转、复合跳转、出现页面内状态、局部变化和无明显变化。
- 手工截图动作区域链路调整为直接 PageElement API：Dashboard 保存可操作元素时调用 `POST /api/graphs/:versionId/assets/page-elements`，Server 只更新源 PageModel 的 `assetRecordingManualElements`，不创建或修改 PageTransition；删除调用 page-elements DELETE API，删除元素不再依赖 rejected transition。Dashboard 重新识别已保存页面时会优先回显这些手工 PageElement，页面资产摘要的 elementCount 也会统计手工动作区域。
- PageTransition 连接边拆为独立后续流程：用户先完成页面和 PageElement 录入，再选择起点页面 + 已保存 PageElement，执行动作并确认目标页面 / 页面内状态 / 无可见变化后保存 PageTransition。同一个 PageElement 可以被多个连接边复用，例如“右上角加号”只录一次，连接边再描述多步菜单和最终目标。
- 操作候选 locator 质量门禁收紧：只有 `className` 的候选（例如 `class: android.view.View`）不再展示为可确认操作入口，避免把无法唯一定位的 View 类型当成可复用 PageElement；这类区域后续需要通过文本、resource-id、accessibility-desc、邻近锚点或 image region 补强后再沉淀。
- 操作候选新增视觉确认和目标搜索的旧方案已降级为后续高级模式；默认资产录制不再展示自动候选，也不在可操作元素页签内确认目标页面。
- 操作候选缩略图坐标系修正：候选预览默认只裁掉顶部薄状态栏，底部先不裁，保留 App 自己的底部 tab、黑条和操作区；元素 bounds 会映射到裁剪后的 App 可视区域后再绘制蓝色圈选框，避免整屏截图 `object-fit` 留白导致圈选偏移。
- 页面能力新增滚动容器抽象：scrollable 候选不再按固定点击点表达，面板新增“滚动容器”编辑器，可配置容器类型、滚动方向、布局列数、目标匹配和找到后动作；Dashboard draft 会携带 `scrollProfile`，用于表达首页两列班级列表、横向 TabBar、横向卡片 / 轮播等动态容器。
- 滚动容器配置先贯通 PageElement 保存链路：Dashboard 保存可操作元素时会把 `scrollProfile` 传给 page-elements API，Server 保存到源 PageModel 的 `assetRecordingManualElements`，避免两列列表、横向 TabBar、轮播等动态容器退化为固定坐标。连接边流程会复用该 PageElement 再生成 PageTransition action params。
- 页面能力手工录入交互收敛为“左侧圈选区域 + 右侧选择动作方式 / 出现条件 / 结果类型”：移除旧的“标注点击 / 标注滑动 / 标注长按 / 标注输入”按钮组，用户先在截图上圈区域，再在右侧选择 `tap` / `scroll` / `long_press` / `input`。`navigate` / `compound_navigation` 可保存目标页面草稿和说明，仍只作为 PageElement outcome draft，不创建正式 PageTransition；编辑已有元素时会携带 `elementId` 覆盖旧区域，避免重新圈选后残留旧标注。左侧操作标注截图不再被固定 440px 高度截断。
- 页面能力空列表交互调整：当前页面没有已录入可操作元素时显示 `0 个元素` 和空态，不再自动展开添加表单；用户点击“+ 添加可操作元素”后才创建编辑态条目，保存成功后进入已录入列表，取消则回到空态 / 列表态。
- 页面能力已保存元素列表优化：截图缩略图会自动围绕人工操作区域裁剪，避免整张手机截图压缩到不可读；编辑器改为在当前元素条目内展开，编辑 / 删除 / 添加按钮样式统一为轻量操作按钮。
- 页面能力手工动作区域支持二次编辑：左侧标注截图按真实截图比例自适应高度，尽量展示完整手机画面；已有蓝色动作框可拖动整体位置，也可拖动八个边 / 角控制点调整大小；只有在空白截图区域拖拽时才重新绘制新区域，避免每次点击都重置已选范围。
- 滑动区域新增结构推断：当 UI 树没有暴露 `scrollable=true`，但页面上出现多个相似班级 / 课程卡片文本并形成列表或两列网格时，Dashboard 会合成 `inferred-scroll-region` 滚动候选，避免 ClassIn 首页这类 Compose / 自绘区域完全识别不出可滚动列表。
- 当前页面识别核心抽出 `PageMatcher` 模块：`assetOnly` 识别只读取 confirmed active PageModel，排除 runtime draft、录制节点和 deprecated 资产；识别前会根据截图重点区域 baseline artifact 补充 `Observation.imageRegions` 相似度，再复用 `detectNode` critical matcher 质量门禁；结果新增 `matcherDiagnostics`，用于解释已命中依据、缺失依据、最高候选和候选列表。Dashboard 资产录制映射优先使用该诊断，不再依赖旧高分 candidate matcherResults 解释页面状态。
- PageMatcher 视觉匹配第三片落地：截图重点区域 baseline 比较从固定百分比裁剪 / byte similarity 升级为局部灰度 SSIM + aHash / dHash 组合评分；识别时会在用户圈选区域附近做小范围候选搜索，允许状态栏、设备 inset 或截图采集抖动造成的轻微位置漂移；与系统顶部状态栏 / 底部导航栏重叠的像素会在比较时自动 mask，不需要用户手动圈掉系统栏。
- PageAbility 进入路径规划预览链路：已绑定目标页面的 `navigate` PageElement / PageAbility 会在 route-plan 和 graph-run 中临时转成 active route edge；未绑定目标页面的跳转能力会返回 `PAGE_ABILITY_TARGET_MISSING` 诊断，明确指出页面和能力名称。Dashboard 保存跳转型可操作元素时会要求选择目标页面，避免“看起来保存了但规划不可达”。
- `grid_candidate` 运行期执行方式调整为视觉候选点击：即使录入时动作方式为“滑动”，服务端生成规划边时也会按人工圈选容器、列数、候选高度和点击安全点生成 `tap_on_image`，不再退化为依赖 UI dump 稳定 locator 的 `scroll_until_visible`。同屏候选失败后会在重规划中尝试下一个候选；滚动翻页候选循环仍由后续任务实现。
- PageMatcher 视觉匹配第二片落地：截图重点区域 baseline 比较从 byte similarity 升级为灰度结构相似度 + average-hash 组合评分，并支持 `ignoreRegions` 屏蔽区域内部动态内容；`ignoreRegions` 已贯通 StateMatcher 类型、SQLite 持久化、页面资产 baseline 保存、current-page asset metadata 回填和 Dashboard 映射，避免更新页面资产时丢失动态忽略区。
- 页面文字 / OCR 匹配新增相对区域约束：`text` / `ocr_text` matcher 若携带 `region`，只会在该用户确认区域内匹配，并作为强状态锚点参与质量门禁；但截图重点区域内自动识别到的 OCR / UI 文本只保留为 metadata 解释信息，不再自动生成 critical matcher，避免 `40`、`contact`、`fixed_bottom_navigation_badge` 等噪声阻断页面匹配。
- 资产录制截图圈选坐标修正：右侧页面截图的拖拽坐标现在直接按图片层实际 `getBoundingClientRect()` 换算，不再按外层黑色容器或推算后的显示区域计算；截图重点区域框也渲染在图片层上，保证用户看到的框、保存的百分比坐标和后端裁剪 baseline artifact 三者对齐。
- PageMatcher 兼容历史截图区域噪声 matcher：旧页面资产中已经保存的同区域自动 OCR matcher 若未命中，但对应的 `image_region` baseline 已命中，则该派生 OCR matcher 不再参与得分、强基准缺失、critical 阻断和面板缺失依据展示；用户明确确认的页面文字 / OCR 依据不受影响。
- PageMatcher 截图区域改为多锚点容错：当页面已有其他截图区域和页面文字充分命中时，单个截图区域因账号切换、班级卡片、底部上课条、出勤数字、角标等动态内容变化未命中，不再一票否决页面识别，也不再作为面板缺失依据展示。
- Observation 采集降级为 screenshot-first：Android `uiautomator dump` 偶发失败时不再让当前页面接口 500，而是记录 `raw.uiHierarchyError` 并继续返回前台 App、截图和 OCR，用于 PageMatcher 在 Compose / Flutter / UI 树不可用时继续工作。

### Verified

- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/current-page-asset.test.ts --testNamePattern "semantic image region|semantic image regions|can bind screenshot focus regions"` 通过，覆盖核心 `semantic_image_region` 阈值匹配、PageMatcher OCR / layout tokens 语义区域命中，以及截图重点区域保存时同步生成语义 matcher。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/storage.test.ts` 通过，覆盖 graph-core、PageMatcher、页面资产保存和 StateMatcher 持久化相关回归。
- `pnpm exec tsc -p platform/packages/graph-core/tsconfig.json --noEmit` 通过。
- `pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过。
- `pnpm exec vitest run platform/apps/server/src/current-page-asset.test.ts` 通过，覆盖截图重点区域 matcher、区域 baseline artifact 和识别时区域相似度。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖 OCR / UI 文本依据编辑入口和 OCR 修正写回逻辑。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/current-page-asset.test.ts` 通过，覆盖资产录制 page-only 展示、弹窗 / 底部面板 / 动态黑条仍匹配父页面或页面上下文，以及旧浮层 metadata 不再暴露浮层控件。
- 真机调用 `/api/graphs/:versionId/current-page` 验证 ClassIn 主页已恢复为 `matched`，命中节点 `主页 / classin.teacher.classes`，score 为 1。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/storage.test.ts` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖资产录制动作即时下发策略、识别中遮罩和重叠识别任务阻断。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖待保存草稿页面名去除内部前缀，以及已保存资产名优先展示。
- `pnpm exec vitest run platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/server/src/graph-assets.test.ts` 通过，覆盖已保存页面资产删除按钮和 deprecated 页面资产从默认列表隐藏。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖页面能力候选按点击 / 滑动 / 条件分组、动作候选编辑字段和 Observation 到候选分类的映射。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖 class-only clickable view 不再暴露为稳定操作候选。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖操作候选截图圈选区域、目标页面搜索和局部变化字段语义。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖操作候选裁剪预览和 bounds 到 App 可视区域坐标映射。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖滚动容器编辑器和 scrollProfile draft 生成。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/page-transition-assets.test.ts` 通过，覆盖手工确认 navigate 转移 active 可规划、非跳转转移保持 draft、scrollProfile 请求透传与后端持久化，以及资产录制相关回归。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖无原生 scrollable 标记时根据重复卡片文本推断滚动区域。
- `pnpm exec vitest run platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/graph-assets.test.ts` 通过，覆盖手工确认 PageTransition 资产创建、只允许已保存源 / 目标页面沉淀转移，以及资产摘要展示 outgoing transitions。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/server/src/page-transition-assets.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/semantic-locator.test.ts` 通过，覆盖截图手工标注生成 draft、手工 PageElement 写回 / 回显、资产摘要计数、`image-region` PageTransition 持久化和 `tap_on_image` 区域中心点击执行。
- `pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/server/src/page-transition-assets.test.ts` 通过，覆盖手工动作区域绘制、移动、边角缩放，以及资产录制 / 页面能力相关面板回归。
- `pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过，确认动作区域编辑交互类型安全。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/page-transition-assets.test.ts` 通过，覆盖 PageMatcher 模块、current-page 诊断透传、Dashboard 优先展示 PageMatcher 诊断，以及资产录制 / 页面资产 / 页面能力相关回归。
- `pnpm exec vitest run platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts` 通过，覆盖视觉 baseline ignoreRegions、稳定区域变化阈值、页面资产保存 / 存储贯通。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/apps/server/src/current-page-asset.test.ts --testNamePattern "relative title region|can bind screenshot focus regions"` 通过，覆盖用户确认的区域 OCR / UI 文本只在相对标题区域内命中，以及截图重点区域保存时只生成 image_region matcher。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖 Dashboard 保留截图重点区域 ignoreRegions 和资产录制面板回归。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖截图圈选坐标按实际图片内容区域映射，避免容器留白导致重点区域 baseline 截偏。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts --testNamePattern "derived region OCR noise"` 通过，覆盖历史截图区域 OCR 噪声不再阻断同区域 image_region 命中的页面资产。
- `pnpm exec vitest run platform/apps/server/src/current-page-asset.test.ts --testNamePattern "bind screenshot focus regions"` 通过，覆盖新保存截图重点区域不再自动生成 critical OCR matcher。
- `pnpm exec vitest run platform/apps/server/src/page-matcher.test.ts --testNamePattern "derived region OCR noise"` 通过，覆盖 PageMatcher 诊断不再把已被 image_region 覆盖的历史 OCR 噪声展示为缺失依据。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts --testNamePattern "one changed screenshot region"` 通过，覆盖单个动态截图区域变化不再阻断已有充分页面锚点的 PageModel。
- `pnpm exec vitest run platform/apps/server/src/page-matcher.test.ts --testNamePattern "one changed screenshot region"` 通过，覆盖 PageMatcher 诊断不再把被其它页面锚点覆盖的动态截图区域展示为缺失依据。
- `pnpm exec vitest run platform/apps/server/src/observation-service.test.ts --testNamePattern "UI hierarchy dump fails"` 通过，覆盖 Android UI hierarchy 采集失败时继续保留截图 / OCR observation。
- `pnpm exec vitest run platform/apps/server/src/observation-service.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts platform/packages/graph-core/src/graph-core.test.ts` 通过，覆盖 Observation 降级、PageMatcher、页面资产保存和存储回归。
- 真机调用 `POST /api/graphs/:versionId/current-page` 验证当前 ClassIn 主页已恢复为 `matched`，命中节点 `主页 / classin.teacher.classes`，score 为 1；旧数据中的 `40`、`icon`、底部导航 resource-id 等派生 OCR matcher 仍可追溯，但不再阻断识别。
- `pnpm exec vitest run platform/apps/server/src/page-matcher.test.ts` 通过，覆盖截图重点区域与系统栏重叠时自动 mask，以及圈选区域轻微漂移时仍能通过邻域视觉搜索命中。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过，覆盖资产录制页面匹配录入区展示“自动忽略系统状态栏”和“允许小幅位置漂移”的录入规则。
- `pnpm exec vitest run platform/apps/server/src/current-page-asset.test.ts` 通过，确认当前页面资产保存 / 识别链路仍兼容新的 PageMatcher 视觉相似度。
- `pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit` 通过。
- `pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过。
- `pnpm exec tsc -p platform/packages/graph-core/tsconfig.json --noEmit` 通过。

## 2026-06-16

### Added

- 当前主要项目目标正式命名为 PageStateFlow：页面状态资产驱动的移动端智能回放测试平台。
- 新增 REQ-042 / DES-042 / AC-044 / R-034 / T-084 至 T-089：规划 PageStateLibrary、PageModel、PageMatcher、PageElement、LocatorCandidate、PageTransition、PathPlan、页面资产库 UI、当前页面识别、录制学习页面转移和执行到目标页面能力。
- 产品主线调整为“页面资产库优先”：录制用于学习页面、元素和转移；StructuredFlow 作为页面路径快照和回归执行资产；BusinessGraph 上层继续保留为 experimental / frozen。
- 明确页面资产跨平台策略：Android first 使用 UIAutomator hierarchy、activity、resource-id、content-desc、OCR 和截图区域；iOS 后续使用 WDA source、accessibility id、label、view controller、OCR 和截图区域；Compose / Flutter 缺少 semantics 时降级为 OCR / image_region 并提示风险。
- 补充 PageStateFlow 跨端复用策略：同一逻辑页面 key 只建一份 PageModel，Android / iOS 信息分别挂载 PlatformPageProfile；缺平台 profile 时允许跨平台视觉 fallback 低置信执行并在报告提示补录；页面资产支持编辑、合并重复逻辑页面、标记 stale / needs_update 和维护版本兼容范围。
- 补充 AI 可理解资产要求：PageModel / PageElement / PageTransition 必须保存 targetRef、中文名、别名、业务描述、意图标签和示例指令；AI / CI 输入自然语言目标时必须先解析和消歧，报告回显 input target、resolved targetRef、候选消歧过程和最终路径。
- 补充 Dashboard 产品形态：保留现有“用例录制”和“用例库”模块；新增“资产录制”模块用于人工沉淀 / 更新页面资产和 PageTransition；新增“目标执行”模块用于输入目标页面或可检索描述、展示候选、规划路径并执行。
- 新增 T-087A / T-088A / T-090：规划资产录制模块一期、目标执行模块一期和受控探索录制 PoC；自动探索仅生成 draft 资产，后续通过质量策略或人工确认进入 active。
- 落地 T-087A 第一阶段：Dashboard 新增“资产录制”导航入口和 `AssetRecordingPanel`；左侧复用设备预览 / 远程操作，右侧可点击“开始录入”调用当前页面识别，展示页面候选、matcher 命中情况、可操作元素、资产 ID 和 AI 可读摘要。保存 / 更新按钮已接入现有 node promote API，可把草稿页面确认为 active 页面资产；完整 PageModel 编辑保存和 PageTransition candidate 表单留作 T-087A 后续步骤。
- 修复资产录制页预览未启用的问题：`useScrcpyStream` 现在在“用例录制”和“资产录制”两个模块都保持设备截图 / 实时预览可用，避免资产录制页卡在“正在获取截图预览”。
- 修复资产录制页“页面候选”信息被裁剪的问题：新增 asset panel 覆盖规则，使页面候选、资产 ID、App 包、Activity、matcher 列表能按内容撑开，不再被通用 `.panel` 的 `overflow: hidden` 截断。
- 修复“用例录制 / 资产录制”之间切换时预览画面不刷新的问题：Dashboard 为两个模块建立独立 preview workspace key，切换 tab 时会清空旧截图、重新拉取截图，并重建 scrcpy 实时预览绑定，避免复用旧 DOM ref 导致画面停留在上一个模块。
- 资产录制页改为“左侧纯设备预览 + 右侧资产检查表”形态：移除重复说明区、开始录入按钮、调试窗口和输入 / 等待工具条；进入资产录制或在该页操作设备后自动识别当前页面，右侧展示截图、activity、package、matcher、UI 文本、OCR 文本、可操作元素、AI 描述编辑区和底部浮动保存 / 更新按钮。
- 图谱资产摘要新增 `pageAssets` 列表，Dashboard 资产录制页可直接展示“已保存页面资产”，说明保存后的页面资产落在当前 active graph version 的 BusinessNode / PageModel 草稿或 active 节点中。
- 修复资产录制页“主页被显示为我是教师班级列表”的产品表达问题：当前页面识别结果现在拆分展示“视觉页面名”和“匹配资产 / 状态”。ClassIn 首页中命中“主页 + 我是教师 + 全部班级 + 创建班级”时，页面标题可显示“主页”，同时说明匹配状态资产是“我是教师班级列表”。
- 修复资产录制页右侧截图不显示的问题：当左侧内嵌 scrcpy 实时流处于 active 状态时，资产录制截图使用 `/api/devices/:serial/screenshot?force=true` 进行显式取证，避免普通截图轮询保护返回 409 导致 `<img>` 断图。
- 资产录制页新增截图重点区域圈选：用户可在右侧页面截图上拖拽生成重点区域，保存 / 更新页面时会随页面名称、key、别名、业务描述和意图标签写入页面资产 metadata。
- 修复资产录制页右侧底部保存 / 更新区遮挡内容的问题：右侧详情区改为独立滚动容器，保存 / 更新条固定在栏底但不覆盖 matcher、OCR、元素和资产列表。
- 修复资产录制页误显示“更新页面”的问题：只有经过资产录制确认保存、带 `assetRecordingConfirmed` 或页面资产标签的节点才算“已保存页面资产”；普通匹配节点、runtime draft 和录制节点不再触发更新模式。
- 页面资产库从资产录制页拆为独立导航模块，首版提供“目标页面测试”和“已保存页面资产”两个页签；资产录制页只负责当前页面识别、编辑、截图圈选和保存 / 更新，避免全量资产列表挤占录入区域。
- 修复资产录制页右侧可操作元素 / AI 信息 / 截图区域的重叠风险：元素和 AI 卡片改为隐藏溢出并使用内部滚动，只有当前页面信息卡按内容撑开。
- 继续修复资产录制页右侧布局重叠：当前页面信息卡也回到正常文档流并隐藏溢出，右侧滚动区底部预留保存条高度，避免“可操作元素”压住页面编辑区或底部保存按钮。
- StructuredFlow RuntimeInterceptor 升级为可配置临时阻断页 watcher：新增 `runtime_interceptor_rules` SQLite 表，规则支持平台 / App 包名 / Flow 作用域，matcher 支持 text、resource-id、content-desc、activity、package，动作首版支持 `tap_text`、`tap_element`、`back`。
- 新增 `/api/runtime-interceptor-rules` CRUD 接口，供 Dashboard、CLI / MCP 后续统一管理“看到某个弹窗或临时页 -> 自动处理 -> 继续等待原步骤预期”的运行时规则。
- 录制页新增“临时阻断页”面板：用户可在当前页面点击“标记当前页”，从实时 Observation 提取默认触发文案和处理文案，保存后后续 StructuredFlow 执行会自动处理该阻断页。

### Verified

- `pnpm exec vitest run platform/apps/server/src/runtime-interceptor.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/automation-runner.test.ts -t "RuntimeInterceptor|runtime interceptor rules|custom runtime interceptor"` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/components/RuntimeInterceptorPanel.test.ts platform/apps/server/src/runtime-interceptor.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/automation-runner.test.ts -t "RuntimeInterceptorPanel|RuntimeInterceptor|runtime interceptor rules|custom runtime interceptor"` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AppNav.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/styles.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖录制页 / 资产录制页独立预览工作区和资产录制布局回归。
- `pnpm exec vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖页面资产列表摘要、资产录制新布局、自动识别信息展示和底部保存 / 更新入口。
- `pnpm exec vitest run platform/apps/server/src/builtin-graphs.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖 ClassIn 首页 / 教师列表状态 matcher、视觉页面名推断、截图重点区域和资产录制底部布局。
- `pnpm exec vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/components/AppNav.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/styles.test.ts` 通过，覆盖确认保存才算页面资产、资产录制页不再展示全量资产列表、页面资产库独立模块和布局防重叠。
- `pnpm exec vitest run platform/apps/dashboard/src/styles.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/dashboard/src/components/PageAssetsPanel.test.ts platform/apps/dashboard/src/App.test.ts` 通过，并通过浏览器 DOM 位置检查确认资产录制页当前页面卡、可操作元素卡和底部保存条不再互相覆盖。
- `pnpm lint` 通过。

## 2026-06-15

### Changed

- 落地 R-029 第一阶段：新增 `AndroidActionBackend` / `SemanticDeviceActionRequest`，Android driver 支持 `performSemanticAction`；`tap_on_element`、`input_text_to_element`、`scroll_until_visible` 现在优先走 semantic backend，未配置时回退到 UIAutomator dump + ADB，并在 step metadata 中记录 `driverChannel` / `fallbackReason`。新增 `AndroidHttpActionBackend`，支持通过 `ANDROID_ACTION_BACKEND=uiautomator2|appium`、`UIAUTOMATOR2_SERVER_URL`、`APPIUM_SERVER_URL`、`APPIUM_SESSION_ID` 接入外部 HTTP driver。
- 澄清 R-029 接入边界：当前已完成 UIAutomator2 / Appium-compatible HTTP backend 协议挂钩，但本地 UIAutomator2 / Appium server 的依赖检测、端口分配、session 管理、健康检查、断线恢复和真机验证仍是后续任务；缺失时必须明确降级为 UIAutomator dump + ADB fallback。
- StructuredFlow 执行入口不再默认继承 legacy `stepIntervalMs=400ms` 固定等待；未显式配置时使用 `0ms`，每步节奏由 beforeState / afterExpectations 的 timeout / interval 控制。
- 阻塞型 `screen_changed` 预期支持动作后动态等待：首次 after 截图未变化时按 `timeoutMs` / `intervalMs` 继续采集截图，直到画面变化或超时；非阻塞自动视觉预期不触发长轮询，避免拖慢录制回放。
- `android-actions.test.ts`、`android-driver.test.ts`、`semantic-locator.test.ts`、`automation-runner.test.ts`、`structured-flow-runner.test.ts`、`graph-run-service.test.ts` 通过；`shared` / `android-driver` / `server` typecheck 通过。

- 完成产品方向收敛治理：当前产品主线明确为 StructuredFlow / Smart Recorded Flow；BusinessGraph 上层、源码扫描建图、候选自动晋级和目标节点路径规划冻结为实验能力。
- 顶层 README、product-plan、requirements、design、acceptance、tasks 和 traceability 已同步新定位，REQ-036 / REQ-037 / REQ-038、DES-036 / DES-037 / DES-038、AC-034 至 AC-042 标注 experimental / frozen 边界。
- Dashboard 主导航将旧“业务图谱”入口降级为“实验能力”，并保留 tooltip 说明；StructuredFlow 相关的用例库、录制和执行结果保持主入口。
- 新增 R-033：StructuredFlow 主线收敛治理；T-072 / T-073 / T-074 标记 frozen，后续不再默认扩展 SourceWorkspace、多源扫描、iOS SourceScanner 和候选图谱自动晋级。
- 明确当前产品主线为 StructuredFlow / Smart Recorded Flow：录制回放继续是主入口，但每一步都必须是 beforeState、语义动作、afterExpectations、systemGuards、timing 和 evidence 的结构化规则步骤。
- BusinessGraph 保留为未来扩展和底层能力来源，不再驱动当前产品 UI / 存储复杂化；未来 RoutePlan 需要先转换为同一 `TestRuleStep` 再复用执行管线。
- 新增 R-032 / T-083 / AC-043，规划 TestRuleCore 底层执行规则统一：StructuredFlowStep 直接复用 `TestRuleStep`，服务端新增统一适配层，把规则步骤转换为成熟 AutomationRunner 可执行的 ActionStep。
- 追踪矩阵新增 REQ-041 / DES-041 / T-083 / AC-043 映射，避免后续实现只改代码不更新产品约束。
- 暂缓 T-082 外部接口开发，优先把 Dashboard 主流程做实；用例库现在支持选择“完整执行”或“执行到某个结构化步骤”，并复用现有 `/api/flow-runs.stopAtStepId`。
- 用例库新增详情 / 步骤详情预览区：选中用例后可查看 App、平台、版本、起终点、最近结果，以及每一步的 beforeState、执行动作、afterExpectations、systemGuards 和最近步骤结果。
- Android 录制保存 StructuredFlow 前会从设备查询真实已安装包版本：新增 `InstalledAppInfo`、Android `dumpsys package` 解析、server app-info API，并在保存草稿时自动填充 displayVersion / versionCode / buildNumber，减少 `unknown` 版本用例。
- 录制步骤新增 before/after Observation 摘要：动作前复用后台语义快照，动作后轻量采集 UI observation；保存 StructuredFlow 时会把 package、activity、关键 resourceId、关键文本和候选数量写入 beforeState metadata / matchers / source / artifacts。
- 用例库详情新增前置 / 后置文字条件编辑入口，并区分“保存预期”和“临时运行”两种模式：保存会更新 StructuredFlow 本体，临时运行通过 `expectationOverrides` 只覆盖本次 FlowRun。
- `/api/flow-runs` 新增 `expectationOverrides` 支持，StructuredFlowRunner 会在内存副本中覆盖 beforeState / afterExpectations / systemGuards，运行完成后不污染已保存用例；同时修复 App 层未把 `stopAtStepId` 传给 FlowRunner 的问题。
- StructuredFlow / AutomationRunner 已接入 RuntimeInterceptor：前置检查前和动作后会自动处理常见权限 / 提示 / 升级阻塞弹窗，并把处理记录写入 step metadata。
- 录制页步骤卡片改为 StructuredFlow 规则摘要：主体展示动作详情、前置条件、后置预期和系统守护，不再把图谱资产、未写入状态或 adb dump 原始错误作为录制步骤的主要内容。
- 录制点击的语义定位优先级继续收紧：前端先使用后台 element snapshot / OCR snapshot，缓存未命中时会在点击前短超时调用实时 `element-at` 查询，优先记录 `tap_on_element` 的 resourceId / desc / text；Android Driver 改为优先执行 `uiautomator dump --compressed`，修复部分设备普通 dump 退出 137 后只能记录坐标的问题。
- 统一语义点击前置条件：`tap_on_text` 自动等待目标文字可见，`tap_on_element` 自动等待目标元素存在，并继承 resource-id / content-desc / text / occurrence；步骤卡片中元素存在前置显示为“元素存在”，不再误导为 OCR 文字断言。
- 录制步骤卡片升级为可编辑规则步骤：同一张卡片内展示并编辑前置条件、动作策略和后置预期；动作策略可在 `tap_on_element`、`tap_on_text`、`tap_on_image`、`input_text_to_element`、`scroll_until_visible`、`wait_until_state`、坐标 fallback 等方式之间切换；前置 / 后置条件可选择“强基准 / 建议 / 候选”，系统守护继续默认参与执行但不再占用步骤卡片展示空间。
- 录制 Observation 摘要新增紧凑候选证据：动作前 / 动作后会保留 `elementCandidates` 和 `textCandidates`，包含 resource-id、content-desc / accessibilityId、text、className、bounds、clickable、OCR confidence / region 等信息，用于后续在步骤编辑器中选择稳定强基准，而不是只保存计数和几个字符串。
- 录制步骤候选证据升级为可操作资产：步骤卡片现在按 Activity、UI tree 元素、页面文字、OCR 文字分组展示 before / after evidence，用户可一键把任一候选设为强前置 / 强后置；动作前元素或 OCR 文字也可一键填入动作策略，优先生成 `tap_on_element` 或 `tap_on_text`，坐标仍仅作为 fallback。
- StructuredFlow 执行器补齐 Activity 强基准验证：当步骤前置或后置预期包含 `activityName` 时，StepExpectationEvaluator 会读取设备前台 App / Activity 并动态等待匹配，不再把 Activity 证据保存成普通 Flow 无法执行的图谱 `state_is`。
- 录制动作后新增到达页预期自动生成：after Observation 会提取新增页面锚点，优先标题 / toolbar / header 类 resource-id + 文本，作为默认启用的业务后置预期；`screen_changed` 仍只作为弱候选，避免点击跳页只验证“画面变了”。
- 到达页预期生成新增瞬态状态过滤和刷新策略：不再把列表状态、角标、标签、时间、计数等信号（例如 `tv_activity_status=已结束`）作为页面到达锚点；重新采集 after Observation 时会替换旧 `recording_arrival_*` 自动预期，避免错误候选残留。
- 步骤预期编辑器布局调整为标题、输入行、OCR 区域分层展示，窄面板下自动纵向堆叠，避免“文字 / OCR 区域”标签与输入控件重叠。
- 修复重复语义元素无法区分的问题：当多个元素拥有相同 resource-id、content-desc 或 text（例如两个 `desc=course Photo`）时，录制器会按视觉顺序写入 `occurrence`，Dashboard 展示为 `#2` / `#3`，回放时也按该序号在当前 UI hierarchy 中定位目标元素，坐标仅保留为 fallback 证据。
- 修复录制点击在 UIAutomator hierarchy 只裁掉系统栏时的坐标映射问题：当设备物理高度与 hierarchy 高度差异在 10% 内且点击点仍落在 hierarchy 范围内，不再按比例缩放，避免底部按钮被误判为 `target_not_found` 并退化成坐标 tap。
- 补齐 StructuredFlow 主线关键语义动作：新增 `input_text_to_element`、`scroll_until_visible`、`wait_until_state` 到共享模型和服务端 `SemanticStepResolver`。执行时先通过 UI hierarchy 等稳定 locator 定位目标，再执行聚焦输入、滚动查找或状态等待；这些动作仍禁止绕过语义解析器直接进入 `stepToAction`。
- StructuredFlowRunner 新增执行前校验：启动 Flow 前会检查设备平台与用例平台、Android startStrategy 所需 packageName、以及可读取时的目标 App 安装版本 / build / versionCode；不满足时在创建 Run 前返回明确错误，避免生成误导性失败报告。
- 用例库详情继续打磨：详情区展示目标包名 / bundleId、build/versionCode、startStrategy；步骤动作摘要支持 `input_text_to_element`、`scroll_until_visible`、`wait_until_state`，并保留“保存预期”和“临时运行”两种预期修改模式。

### Verified

- `pnpm exec vitest run platform/apps/dashboard/src/components/AppNav.test.ts` 通过，覆盖主导航 StructuredFlow 模块优先、图谱入口标记 experimental。
- `pnpm exec vitest run platform/apps/dashboard/src/components/AppNav.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖导航收敛、用例库主入口和录制步骤规则摘要回归。
- `pnpm --filter @mobile-automation/dashboard typecheck` 通过，覆盖 AppNav 接入后的 Dashboard 类型检查。
- `pnpm exec vitest run platform/apps/server/src/test-rule-step.test.ts` 通过，覆盖 TestRuleStep 到 ActionStep 的转换、占位前置过滤、执行到中间步骤和 package 推断。
- `pnpm exec vitest run platform/apps/server/src/test-rule-step.test.ts platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/recording.test.ts` 通过，覆盖统一适配层、StructuredFlowRunner 迁移和录制保存不退化。
- `pnpm exec vitest run platform/apps/server/src/storage.test.ts platform/apps/server/src/structured-flow-runner.test.ts platform/apps/server/src/test-rule-step.test.ts platform/apps/dashboard/src/recording.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts` 通过，32 个测试覆盖结构化用例存储、执行、录制保存和用例库主流程。
- `pnpm exec vitest run platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts` 通过，覆盖用例库执行范围选择器、中间步骤入口、用例详情和步骤规则预览。
- `pnpm exec vitest run platform/packages/android-driver/src/android-parsers.test.ts platform/packages/android-driver/src/android-driver.test.ts platform/apps/dashboard/src/recording.test.ts` 通过，40 个测试覆盖版本信息解析、Android driver 查询和 StructuredFlow 草稿版本合并。
- `pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts` 通过，覆盖 Observation 摘要、step params 合并和 StructuredFlow state matcher 生成。
- `pnpm exec vitest run platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/recording.test.ts` 通过，覆盖用例详情预期编辑入口和录制 Observation 增强。
- `pnpm exec vitest run platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/structured-flow-runner.test.ts` 通过，覆盖 StructuredFlow 复用 watcher、自动处理常见阻塞弹窗和现有执行器回归。
- `pnpm exec vitest run platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/recording.test.ts` 通过，覆盖临时预期覆盖不污染已保存用例、前置 / 后置预期编辑入口和录制保存回归。
- `pnpm exec vitest run platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖录制步骤规则摘要、图谱资产调试信息退出主卡片和步骤预期编辑回归。
- `pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖录制 before / after 候选证据保存、前置 / 后置强基准选择、动作策略切换和系统守护隐式展示。
- `pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts platform/apps/dashboard/src/components/StepList.test.ts platform/apps/dashboard/src/components/StepExpectationPanel.test.ts platform/apps/server/src/step-expectations.test.ts` 通过，覆盖候选证据升格、动作目标选择、Activity 强基准执行验证和步骤预期编辑。
- `pnpm --filter @mobile-automation/dashboard typecheck`、`pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/test-support typecheck`、`pnpm lint` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/semantic-snapshot.test.ts platform/packages/android-driver/src/android-driver.test.ts platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖实时 element-at 录制转换、compressed UIAutomator dump 和步骤卡片展示回归。
- `pnpm exec vitest run platform/apps/dashboard/src/semantic-snapshot.test.ts platform/apps/server/src/locator-coordinate.test.ts platform/packages/android-driver/src/android-driver.test.ts platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖 hierarchy 裁剪系统栏时不缩放坐标、真实分辨率差异仍缩放、实时 element-at 录制转换和步骤卡片展示回归。
- `pnpm exec vitest run platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/components/StepList.test.ts platform/apps/dashboard/src/recording.test.ts platform/packages/shared/src/index.test.ts` 通过，82 个测试覆盖新增语义动作、Flow 执行前校验、用例库详情和录制动作支持列表。
- `pnpm exec vitest run platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/structured-flow-runner.test.ts` 通过，41 个测试覆盖 StructuredFlow 默认无固定 stepInterval、动作后 `screen_changed` 动态等待、非阻塞视觉预期不拖慢流程，以及现有 Runner 回归。
- `pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts -t "replaces stale generated arrival expectations|transient list status|OCR page title"`、`pnpm exec vitest run platform/apps/dashboard/src/components/StepExpectationPanel.test.ts platform/apps/dashboard/src/components/StepList.test.ts` 通过，覆盖到达页瞬态状态过滤、旧自动候选替换和步骤预期编辑器布局回归。
- `pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm --filter @mobile-automation/shared typecheck`、`pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- 真机 `ERLDU20115007395` 验证：`POST /api/devices/:serial/locators/element-at` 对 `x=942,y=1929,device=1080x2340` 返回 `stable=true`，命中 `contentDesc=add btn`，不再返回 `target_not_found`。
- `pnpm --filter @mobile-automation/shared typecheck`、`pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/dashboard typecheck`、`pnpm --filter @mobile-automation/android-driver typecheck` 通过。

## 2026-06-14

### Changed

- 产品主线从“穷尽全 App 的全局业务图谱”收敛为“结构化录制用例”：录制回放重新成为核心入口，但每一步必须结构化为 beforeState、语义动作、afterExpectations、系统守护和证据。
- 新增 REQ-041 / DES-041 / Phase 13，规划 Smart Recorded Flow、用例库主入口、执行到中间步骤、RuntimeOverlay 动态预期覆盖和 Flow REST / CLI / MCP 接口。
- T-078 已落地 `StructuredFlow` 基础模型和 SQLite 存储：新增 `FlowStateAnchor`、`StructuredFlowStep`、`StructuredFlow` 类型，以及 `structured_flows` / `structured_flow_steps` 表和 CRUD；legacy `TestCase` 继续保留为历史兼容模型。
- T-079 已落地录制保存 StructuredFlow 第一版：录制步骤通过 `buildStructuredFlowDraft` 转换为结构化用例草稿，并通过 `/api/structured-flows` 写入新存储；默认命名使用 `App名-版本号(构建号)-起点-终点`。
- T-080 已落地 StructuredFlow 执行器第一版：`StructuredFlowRunner` 复用现有成熟执行管线，按 beforeState preconditions、语义动作、afterExpectations、systemGuards 执行，并支持 `stopAtStepId` 执行到中间步骤和 `/api/flow-runs` 触发入口。
- T-081 已落地用例库与执行面板重构第一版：Dashboard 主入口改为 StructuredFlow 列表，支持搜索、编辑回录制页、直接执行到 FlowRun、展示最近执行结果；历史 TestCase 仅作为 legacy 辅助保留。
- 修复最近保存的 StructuredFlow 执行失败问题：录制保存时会从语义 locator / packageName 推断 Android targetApp 和默认 App 名，不再写入 `unknown.android.package`；状态锚点不再把“起点 / 终点 / 点击元素标题”等展示文案生成强前置断言；执行器兼容历史坏数据，可从步骤 locator 推断包名并过滤错误的 `structured_flow_state_anchor` 占位前置。
- 新增 `GET /api/flow-runs/:runId` 查询别名，返回 run、active 和 flowRun 摘要，避免结构化用例运行结果查询拿到 Express HTML 404。
- 业务图谱能力降级为底层支撑能力：保留 StateMatcher、ActionPolicy、RuntimeOverlay、Observation、动态等待、报告证据等资产，不再要求维护全局可达图谱。
- Dashboard 目标节点测试页的“执行计划预览”改为卡片内滚动：路径步骤较多时只滚动步骤列表，不再把业务图谱页面撑出首屏，方便继续查看规划起点、设备识别和执行入口。
- Dashboard 候选资产页新增运行期候选资产治理区：展示 `runtime-discovered` 草稿节点、`source=exploration` 草稿边和 `route-gap-exploration` 证据；新增只读 API `GET /api/graphs/:versionId/assets`，统一返回候选治理摘要，draft 资产仍不参与 RoutePlanner。
- 新增候选资产晋级第一版：支持手动把 draft node / draft edge 晋级为 active；新增保守自动晋级策略，runtime 节点需达到观察次数阈值且包含 critical matcher，exploration 边需达到可靠性阈值、具备 artifact 证据且两端节点均为 active。
- 新增“识别当前页面”入口：`POST /api/graphs/:versionId/current-page` 会采集当前设备 Observation；命中 active 节点时返回匹配结果，未知时复用同一套 runtime-discovered 候选规则沉淀草稿节点，Dashboard 候选资产治理区可直接触发并展示结果。
- bootstrap 后仍处于目标 App 内但无法识别 active 业务节点时，GraphRunService 除了沉淀 `runtime-discovered` 草稿节点，还会基于当前页面最高置信可交互候选生成“runtime draft node -> 本次目标节点”的 `source=exploration` 草稿边；该边默认不参与 RoutePlanner，只有晋级为 active 后才进入正式路径计算。
- Observation 的 UI 元素补充 `clickable`、`longClickable`、`focusable`、`scrollable` 可交互属性，探索候选排序优先可交互控件，避免把页面标题等状态锚点误当成下一步动作入口。
- 内置图谱组织升级：`classin-android` / `ClassIn Android 业务图谱` 成为 ClassIn Android 的 App 级总图谱，“新建课堂”降级为总图谱中的目标节点 / 目标路径；旧 `classin-android-teacher-create-lesson` 子流程图谱启动后标记为 deprecated，避免 UI 把它当作主图谱。
- Dashboard 图谱信息页新增节点和边结构预览，并默认隐藏 deprecated 图谱和无 active version 的空草稿图谱。
- 产品文档明确手工录制长期定位为“图谱资产录入器”：录制每一步都应生成 fromNode、OperationEdge、toNode、ActionPolicy 和 ExpectationSet 候选，用户确认后进入 App 级业务图谱候选库。
- 新增录制步骤写入业务图谱资产第一版：`POST /api/graphs/:versionId/recording-assets` 接收录制前 Observation、录制动作和录制后 Observation / deviceSerial，生成或复用 fromNode、toNode 和 `source=manual_recording` OperationEdge；语义动作确认后可进入 active，纯坐标动作即使确认也只保留为 draft 并给出稳定性警告。
- Dashboard 录制页接入图谱资产回填：录制时根据缓存语义快照构造动作前 Observation，动作下发不等待图谱写入；动作后异步调用图谱资产 API，并在步骤卡片中展示“图谱资产”、from -> to、边名称、稳定度和警告。
- 录制写入图谱资产新增 App 归属门禁：非目标 Android package、系统桌面、其他 App 或状态信号不足的 Observation 会跳过写入并返回明确 warning，避免生成“未知节点-未知未知”。
- 明确图谱版本与包版本的维护边界：BusinessGraphVersion 管图谱资产版本，AppBuild / AppVersion 管被测包版本；节点、边、matcher 和 expectation 后续需要记录兼容版本元数据，并通过新 graphVersion 发布稳定变更。

### Verified

- `pnpm exec vitest run platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts` 通过，覆盖执行计划预览结构和目标节点测试入口。
- `pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm exec vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts platform/apps/server/src/graph-run-service.test.ts -t "unknown|exploration candidates"` 通过，覆盖候选资产摘要、Dashboard 展示和 runtime unknown / route-gap 回归。
- `pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm exec vitest run platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/storage.test.ts platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts` 通过，覆盖自动晋级选择策略、节点 / 边 lifecycle 状态更新和 Dashboard 晋级入口。
- `pnpm exec vitest run platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/runtime-graph-candidate.test.ts platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts` 通过，覆盖当前页面匹配、未知页草稿沉淀和 Dashboard 一键识别入口。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/runtime-graph-candidate.test.ts platform/apps/server/src/route-plan-preview.test.ts platform/packages/graph-core/src/graph-core.test.ts` 通过，50 个测试覆盖未知页草稿节点 / 草稿边、候选资产治理、路径预览阻塞和图谱核心。
- `pnpm --filter @mobile-automation/graph-core typecheck`、`pnpm --filter @mobile-automation/server typecheck` 通过。
- Android 真机 `ERLDU20115007395` 验证：在 ClassIn MainActivity 的“课堂报告”未知页上，route-plan preview 返回 `CURRENT_NODE_UNKNOWN` 且不持久化误导性 root 路径；`current-page` 复用 `runtime.unknown.f8fqy5` 草稿节点；执行目标 `classin.teacher.lesson.create` 失败后生成 `exploration.runtime.unknown.f8fqy5.to.classin.teacher.lesson.create.*` 草稿边并展示在候选资产接口。
- `pnpm exec vitest run platform/apps/server/src/builtin-graphs.test.ts platform/apps/server/src/storage.test.ts` 通过，覆盖 canonical ClassIn Android 总图谱 seed、旧子图 deprecated 和 SQLite 图谱 profile 更新。
- `pnpm exec vitest run platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过，覆盖图谱信息页节点 / 边结构预览和 deprecated / empty draft 图谱隐藏。
- `pnpm exec vitest run platform/apps/server/src/recording-graph-assets.test.ts` 通过，覆盖语义录制步骤生成 active 节点 / 边 / state expectation，以及坐标动作降级为 draft。
- `pnpm exec vitest run platform/apps/dashboard/src/components/StepList.test.ts`、`pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过，覆盖录制步骤图谱资产展示和前后端类型检查。
- `pnpm exec vitest run platform/apps/server/src/recording-graph-assets.test.ts platform/apps/dashboard/src/components/StepList.test.ts`、server / dashboard typecheck 通过，覆盖非目标 App package 跳过、状态信号不足跳过和 StepList skipped 状态不显示未知节点占位。
- `pnpm exec vitest run platform/apps/server/src/storage.test.ts`、`pnpm --filter @mobile-automation/shared typecheck`、`pnpm --filter @mobile-automation/server typecheck` 通过，覆盖 StructuredFlow 创建、更新、查询、删除、状态锚点 / 步骤持久化和 legacy case 不退化。
- `pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts`、`pnpm exec vitest run platform/apps/server/src/storage.test.ts -t "structured flows"`、`pnpm --filter @mobile-automation/dashboard typecheck`、`pnpm --filter @mobile-automation/server typecheck` 通过，覆盖录制步骤生成 StructuredFlow 草稿和保存链路类型检查。
- `pnpm exec vitest run platform/apps/server/src/structured-flow-runner.test.ts platform/apps/server/src/storage.test.ts`、`pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/shared typecheck` 通过，覆盖 StructuredFlow 正常执行、执行到中间步骤、存储和类型链路。
- `pnpm exec vitest run platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/recording.test.ts`、`pnpm exec vitest run platform/apps/server/src/storage.test.ts platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/recording.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过，覆盖结构化用例库列表、搜索、编辑、最近执行状态、保存与执行回填。
- `pnpm exec vitest run platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/recording.test.ts`、server / dashboard typecheck 通过，覆盖 unknown package 修复、占位 state anchor 过滤、旧坏 StructuredFlow 兼容执行和录制保存推断。

## 2026-06-13

### Changed

- GraphRunService 起始状态诊断补齐 `outside_target_app`、`unknown_app_state`、`login_required` 和 `blocking_state` 原因；登录门禁和强阻塞节点可通过图谱节点标签记录为 `start_state_failed` 诊断事件，避免目标节点执行失败时只看到泛化的路径规划错误。
- `StateMatcher` 新增 `critical` 关键匹配标记；节点识别质量门禁会在关键 matcher 未命中时返回 `critical_matcher_missing` 和 `missingCriticalMatcherIds`，并通过 SQLite `state_matchers.critical` 持久化。
- Dashboard 信息架构第一版调整：左侧导航把旧“用例库 / 用例执行”弱化为“历史脚本 / 执行结果”，业务图谱模块主 tab 改为“目标节点测试”，历史脚本库说明其作为旧录制脚本和图谱草稿输入。
- 录制脚本导入业务图谱草稿时，语义元素 locator 会沉淀为节点 matcher；resource-id matcher 默认标记为 critical 并提升权重，候选节点 metadata 写入 graphCandidate 修复提示。
- Driver 动作执行新增 `DeviceActionResult` 元数据；Android ADB 返回 `adb_input`、iOS WDA 返回 `appium`、Mock 返回 `mock`，AutomationRunner / GraphRunService 会把直接动作和语义动作的 `actionBackend.driverChannel` 写入 step metadata，为后续 UIAutomator2/Appium-compatible 执行通道切换做准备。
- GraphRunService 在 bootstrap 后仍无法识别业务节点时，会生成 `runtime-unknown-node-candidate-*.json` artifact，并将当前页面沉淀为 `runtime-discovered` / `needs-review` 草稿节点；重复遇到同一未知页面时复用已有草稿节点并更新 artifact / observationCount，避免重复插入导致唯一键失败。未知页不会被硬编码为恢复路径，后续能否规划仍由图谱节点和边决定。
- GraphRunService 在当前节点已知但目标节点不可达时，会创建失败运行并生成 `route-gap-exploration-*.json` artifact，记录 `TARGET_NODE_UNREACHABLE`、起点 / 目标节点和当前页面可定位动作候选；最高置信候选会沉淀为 `source=exploration` 的 draft edge，并排除当前起点状态锚点，避免把页面标题误当成动作入口。不可达路径不被自动伪造成恢复路径，仍需通过图谱节点 / 边治理后由 RoutePlanner 计算。

### Verified

- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts -t "bootstraps|unknown app state"` 通过。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts -t "login-required|blocking start state"` 通过。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts` 通过，14 个 GraphRunService 测试覆盖 App 外启动、未知页 bootstrap、登录态诊断、阻塞态诊断、RuntimeOverlay、弹窗清障和偏离恢复。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts` 通过，24 个图谱核心测试覆盖 critical matcher 缺失阻断。
- `pnpm exec vitest run platform/apps/server/src/storage.test.ts -t "persists business graph versions"` 通过，覆盖 critical matcher 持久化。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/storage.test.ts`、`pnpm --filter @mobile-automation/graph-core typecheck`、`pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm exec vitest run platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过。
- `pnpm exec vitest run platform/apps/server/src/legacy-case-graph.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/graph-run-service.test.ts`、`pnpm --filter @mobile-automation/server typecheck` 通过。
- `pnpm exec vitest run platform/apps/server/src/semantic-locator.test.ts platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/graph-run-service.test.ts platform/packages/android-driver/src/android-driver.test.ts` 通过，65 个相关测试覆盖语义动作和普通动作通道 metadata；server / android-driver / ios-driver typecheck 通过。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts -t "reuses an existing runtime-discovered"` 通过，覆盖重复未知页复用 runtime 草稿节点。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts -t "records exploration candidates"` 通过，覆盖不可达路径的 route-gap 探索候选记录。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/graph-node-test-result.test.ts platform/apps/server/src/storage.test.ts platform/packages/graph-core/src/graph-core.test.ts` 通过，48 个相关测试覆盖图谱执行、报告查询、存储和图谱核心。
- `pnpm --filter @mobile-automation/server typecheck`、`pnpm --filter @mobile-automation/graph-core typecheck` 通过。

## 2026-06-12

### Added

- 新增目标节点执行 API 第一版：`POST /api/graph-runs` 支持按 graphId / graphVersionId 和 targetNode / targetKey 触发业务图谱路径规划与执行。
- 新增 GraphRunService，将 ObservationService、RoutePlanner、GraphRunner、SemanticStepResolver、StepExpectationEvaluator、RunArtifactService 串成真实设备执行适配层。
- 新增 CLI `graph-run` 命令，允许 CI / AI / 本地脚本通过命令行触发目标节点执行。
- Dashboard 业务图谱页新增目标节点选择、路径规划和“执行到目标”入口，执行后跳转到执行详情并复用现有 HTML 报告。
- 新增 GraphRunService 回归测试，覆盖当前节点识别、语义元素点击、设备锁、legacy run / step result / artifact / report evidence 落库。
- 新增 ClassIn 教师新建课堂 v6 内置业务图谱，使用教师班级列表、班级详情、发布活动业务状态和新建课堂页作为真实业务节点 / 状态。
- 新增状态识别消歧测试：宽泛页面节点和具体业务状态同时命中时，优先证据权重更高的具体状态。
- 新增 RuntimeOverlay 第一版实现：支持 node / edge expectation overrides，并通过 REST API、CLI 和 GraphRunService 接入目标节点执行。
- 新增 `target.validation` noop 执行步骤：当设备已经处于目标节点时仍验证目标节点默认预期、动态预期和系统守卫，不再把空路径直接视为成功。
- 新增 resource-id / content-desc / className 元素锚点预期能力，图谱节点验证可优先走 UI hierarchy，OCR 作为补充。
- 新增 `GET /api/graph-runs/:runId` 图谱运行摘要接口和 CLI `graph-status --run <runId>`，返回 target、route、failedAt、reportUrl、screenshots、videos、logs、failureEvidence 和 graph step metadata。
- 新增 HTML 报告“业务图谱执行”区，展示 Graph Version、Start Node、Target Node、路径链路、节点识别分数、动作策略、图谱默认预期、动态预期、系统护栏和证据链接。
- 新增 RuntimeOverlay `state_is` 图谱状态预期和显式基线版 `performance_not_regressed` 性能劣化预期。
- 新增 `@mobile-automation/mcp-adapter` REST-only 工具适配层，支持 AI / CI 通过 list apps、list nodes、get node detail、trigger node test、get run status、get report、get failure evidence 调用目标节点验证。
- 新增 Dashboard 图谱运行详情：执行结果页消费 `/api/graph-runs/:runId`，展示目标节点、路径、失败阶段、before / after 节点识别、动态预期、视频和失败证据。
- 新增 CLI `graph-nodes` 和 `graph-report` 语义命令，补齐目标节点执行的命令行查询闭环。
- 新增 GraphRunner 偏离记录第一版：后置状态未到达时支持有限 observe retry，并在执行结果、step metadata、API、HTML 报告和 Dashboard 中展示 retry / replan-required / recover-required 记录。
- 新增 GraphRunService 自动重规划恢复第一版：当后置状态偏离到可识别业务节点且 `recoverTo=replan` 时，最多自动重规划 1 次并继续执行到原目标节点；恢复步骤在 API、HTML 报告和 Dashboard 中展示 `recoveryAttempt`。
- 新增 Runtime Interceptor 第一版：GraphRunService 在图谱观测阶段自动处理常见阻塞弹窗文案（允许 / 知道了 / 稍后 / 跳过 / 取消），最多 2 轮，处理记录进入 step metadata、HTML 报告和 Dashboard 图谱详情。
- 新增 `GET /api/graphs/:versionId/quality` 图谱质量统计接口，并在 Dashboard 业务图谱页展示目标节点最近执行次数、通过率、最近失败和报告入口。
- 新增 CLI `graph-quality` 和 MCP adapter `getGraphQuality`，AI / CI 可在命令行或工具层读取图谱版本节点 / 边最近质量。
- 新增 legacy 用例转图谱草稿能力：`POST /api/cases/:id/import-graph` 可把已保存 TestCase 转成 draft BusinessGraphVersion，保留 sourceCaseId / sourceStepId / 原始参数，坐标动作只作为 fallback policy。
- 新增图谱报告解释性增强：HTML 报告和 Dashboard 图谱详情展示节点候选 matchedWeight / totalWeight、matcher 命中 / 未命中原因，以及 action policy 的优先级、fallback、reliabilityHint、动作类型和 params。
- 新增结构化 `NodeTestResult`：`POST /api/graph-runs` 与 `GET /api/graph-runs/:runId` 统一返回 run 状态、目标节点、route、failedAt、reportUrl、evidence 和 actual 汇总；CLI 与 MCP adapter 已优先消费该结构。
- RuntimeOverlay 新增目标节点一致性校验：当 overlay 声明 `targetNodeId` 且与本次请求目标不一致时，GraphRunService 在创建 run 前阻断。
- 新增 MCP wrapper 描述层和调用指南：`mobileAutomationMcpTools` / `createMobileAutomationMcpToolHandlers()` 只映射 REST adapter，并新增 `docs/guides/ai-ci-graph-tools.md` 覆盖 REST、CLI、MCP adapter 调用方式和 secret 约束。
- 图谱质量统计新增恢复趋势：节点 / 边质量摘要返回恢复尝试次数和恢复成功次数，Dashboard 目标质量卡展示“恢复成功 x/y”。
- 新增 R-028 / T-075 / AC-042，规划图谱执行稳定性内核升级：两阶段 bootstrap 规划、TransitionWaitPolicy 动态等待、状态识别质量门禁和目标节点测试规格库迁移。
- 新增 Q-028，明确 v2 中“用例”不等于固定规划路径；它应建模为目标节点测试规格，每次运行动态生成 RoutePlan 并保存快照。
- 新增 R-029 / T-076 / Q-029，规划 Android 动作执行通道升级：ADB 保留为设备管理和 fallback 底座，业务图谱主执行路径逐步升级为 UIAutomator2 / Appium-compatible 语义 driver。

### Changed

- 目标节点执行前先采集 Observation 并识别当前业务节点；只有识别失败时才回退到 root 起点，避免已在中间页面时仍然硬走完整启动路径。
- 目标节点规划口径升级为两阶段：App 内已知节点直接规划；App 外 / unknown / 未登录 / 强阻塞态先执行 bootstrap，再重新 Observation 后规划。
- 图谱边执行从固定等待调整为动态状态迁移等待：动作后按 Observation polling 检查目标节点和后置预期稳定通过，超时、偏离、阻塞、crash / ANR 都进入结构化结果和报告。
- 用例库产品定位调整：legacy 用例库保留为历史脚本和候选图谱输入；v2 核心资产升级为目标节点测试规格库 / 路径库 / 场景库，运行时重新规划路径。此口径已被 2026-06-15 StructuredFlow 主线收敛决策覆盖，后续以 StructuredFlow 用例库为主线。
- 图谱执行第一版复用现有 `runs`、`step_results`、artifact 和 HTML 报告承载结果，metadata 中保留 graphVersion、edge、fromNode / toNode、node match 和 observation 摘要；后续再升级为图谱专属报告。
- 录制回放迁移口径调整：保留入口、历史数据和用户可用性，但实现方向必须逐步适配业务图谱核心规则；不为了兼容旧线性脚本而牺牲图谱模型、语义定位和步骤预期结构。
- ClassIn 示例图谱从“启动到首页再切教师”调整为“根据当前 Observation 从教师班级列表继续规划；若在 App 外则通过 root 启动到教师班级列表”。发布活动弹层建模为 `business_state`，避免被底层班级详情 Activity 误判。
- 文本预期的重试描述从 OCR attempts 调整为 observation attempts，因为同一 `text` expectation 现在可能通过 UI hierarchy 或 OCR 完成观测。
- 图谱报告从仅复用 legacy 步骤表升级为图谱语义优先展示；legacy 步骤表继续保留作为底层证据。
- GraphRunService 开始执行两阶段 runtime planning：执行线程先采集当前 Observation；若设备在目标 App 外或无法识别 active 节点，则先启动目标 App，再重新识别实际起点并规划 RoutePlan，避免从桌面或 App 外直接按错误路径执行。
- GraphRunner 的状态迁移验证从固定 observe retry 升级为动态 polling 窗口：动作后按 `transitionTimeoutMs` / `pollIntervalMs` 或 `timeoutMs` / `intervalMs` 轮询 Observation，直到目标节点出现或超时；报告只记录首个等待偏离和最终结论，避免 polling 噪音。
- 图谱执行结果新增诊断摘要：`/api/graph-runs/:runId`、HTML 报告和 Dashboard 图谱详情展示启动归位、状态等待和路径恢复次数，并列出 bootstrap 事件说明。
- 状态识别新增质量门禁第一版：package / bundle 只作为上下文证据；业务节点匹配需要强状态锚点或至少两个弱状态锚点，低置信候选会带上原因、信号数量和缺失强锚点，并展示在 HTML 报告和 Dashboard 图谱详情。
- AI 开发流程吸收 Superpowers 执行纪律：新增 brainstorming、small-plan、test-first slice、self-review、evidence-based closure 等规则；保持当前 REQ / DES / T / AC / ADR 体系不迁移。
- 偏离恢复成功时 Run 总体可判定通过，但原偏离步骤仍按失败步骤保留，边级质量统计继续暴露该边不稳定，避免恢复成功掩盖图谱质量问题。
- 弹窗、权限、升级提示等阻塞态继续归入 Runtime Interceptor / BlockingRule，不进入 BusinessGraph 主图；当前第一版先支持常见文本按钮，后续扩展为可配置规则和 loading / network blocker。
- Android 执行动作规划从“ADB input 打通闭环”调整为“语义目标 + 可插拔 ActionBackend”：`tap_on_element`、`input_text`、`scroll_until_visible` 后续优先走元素级 driver；裸 `adb shell input` 使用时必须记录 `driverChannel` 和 fallback 原因。

### Verified

- `pnpm lint` 通过。
- `pnpm test:unit` 通过，43 个测试文件、251 个测试通过。
- `pnpm lint` 通过，所有 workspace typecheck 通过。
- `pnpm test:unit -- platform/packages/mcp-adapter/src/index.test.ts` 通过，44 个测试文件、254 个测试通过。
- `pnpm test:unit -- platform/packages/cli/src/index.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts` 通过，44 个测试文件、256 个测试通过。
- `pnpm test:unit -- platform/packages/report-core/src/report-core.test.ts platform/packages/runner-core/src/runner-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts` 通过，44 个测试文件、258 个测试通过。
- `pnpm exec vitest run platform/packages/report-core/src/report-core.test.ts platform/apps/server/src/graph-node-test-result.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts` 通过；report-core / server / dashboard typecheck 通过，覆盖图谱执行诊断摘要展示。
- `pnpm exec vitest run platform/packages/graph-core/src/graph-core.test.ts platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts platform/apps/server/src/graph-run-service.test.ts platform/apps/server/src/graph-node-test-result.test.ts` 通过；graph-core / report-core / server / dashboard typecheck 通过，覆盖状态识别质量门禁和报告展示。
- `pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts` 通过，覆盖 Runtime Interceptor 弹窗处理、报告展示和 Dashboard 展示。
- `pnpm test:unit` 通过，46 个测试文件、268 个测试通过。
- `pnpm --filter @mobile-automation/dashboard build` 通过。
- Android 真机 `ERLDU20115007395` 执行图谱目标节点 `classin.teacher.lesson.create` 通过，runId 为 `run_ac1c19d6-4b77-44a4-bede-c3213392909a`，路径为“我是教师班级列表 -> 班级详情 -> 发布活动类型选择页 -> 新建课堂页”。
- Android 真机 `ERLDU20115007395` 已在 `classin.teacher.lesson.create` 目标节点时执行 RuntimeOverlay 失败验证，runId 为 `run_9d704da2-0bb7-491e-969f-6ce2dd8fe9ee`；结果生成视频、截图、`graph-execution-result.json` 和 HTML 报告，目标默认文本预期与 resource-id 元素锚点通过，动态预期失败。

## 2026-06-11

### Added

- 新增 v2 核心产品目标：平台核心从“录制回放”升级为“多来源业务图谱 + 目标节点驱动执行 + 动态预期覆盖 + AI/CI 可调用验证”。
- 新增 REQ-036 / DES-036 / T-060 / AC-034，规划 BusinessGraph、BusinessNode、OperationEdge、StateMatcher、ActionPolicy、图谱版本和图谱资产治理。
- 新增 REQ-037 / DES-037 / T-062 / T-063 / T-066 / AC-035 / AC-038，规划源码扫描、自动探索、手工录制和手工维护生成候选图谱。
- 新增 REQ-038 / DES-038 / T-061 / T-064 / T-065 / T-067 / T-070 / AC-036 / AC-037，规划目标节点路径规划、GraphRunner、状态识别、偏离恢复和图谱报告。
- 新增 REQ-039 / DES-039 / T-068 / T-069 / AC-039，规划 RuntimeOverlay 动态预期覆盖和 REST / CLI / MCP AI/CI 调用接口。
- 新增 R-027，将 v2 图谱内核切换提升为下一轮 P0 队列：保留现有设备、driver、报告和包管理底座，同仓新增 graph-core / source-scanner / graph-runner / MCP adapter。
- 新增 AC-034 至 AC-039，使用 GIVEN / WHEN / THEN 方式定义图谱资产管理、源码扫描、路径规划、图谱执行、录制探索沉淀和动态预期验证的完成标准。
- 新增 Q-021 至 Q-025，记录“不要求业务 App 修改源码”“不另起仓库重做”“图谱节点粒度待试点”“动态预期默认只作为 Run overlay”“首个源码扫描目标仓库待确认”等关键决策和开放问题。
- 新增 REQ-040 / DES-040 / T-071 / AC-040，明确 v1 录制回放兼容迁移策略：v2 旁路新增，不直接替换 legacy 用例、`/api/runs`、报告和 Dashboard 入口；v1 用例转图谱只生成 draft 候选资产。
- 新增 Q-026，确认 v2 不直接替换 v1，必须先完成兼容护栏和回归门禁。

### Changed

- 录制回放被重新定位为输入模块：用于无源码 App、补充缺失路径、人工探索和问题复现；长期目标是生成候选节点 / 边 / matcher / action policy，而不是维护大量线性脚本。
- 业务图谱生成策略调整为自动验证优先：高置信候选通过真机验证和评分后自动晋级，人工治理只处理低置信、冲突、不可达和高风险异常队列。
- 源码扫描规划从 Android 本地目录 PoC 扩展为 SourceWorkspace + SourceProvider 多源扫描，覆盖主工程、本地子工程、远程源码索引和 Android / iOS artifact 依赖。
- 新增 iOS SourceScanner 规划：扫描 Info.plist、Storyboard / XIB、SwiftUI / UIKit navigation、Coordinator / Router、localized strings 和 accessibilityIdentifier。
- 用例库未来升级方向调整为路径库 / 场景库，引用业务图谱节点、边和目标节点集合。
- 执行主线从线性步骤回放升级为目标节点执行：识别当前节点、规划 RoutePlan、按边执行、验证状态迁移、处理阻塞和偏离、生成图谱报告。
- AI / CI 集成口径调整为“REST API 为核心，CLI / MCP 为适配层”；MCP 不作为唯一入口，所有外部调用必须复用设备锁、包安装、任务队列和报告生成。
- 源码扫描口径明确为只读，不要求业务 App 添加自动化契约或修改源码；扫描结果只生成 draft 候选资产。
- Phase 12 实施顺序调整为先建立 v1 / v2 兼容迁移护栏，再实现 graph-core、Observation、RoutePlanner 和 GraphRunner，避免新主线开发破坏已验证主流程。

## 2026-06-09

### Added

- 新增 REQ-035 / DES-035 / T-050 / AC-033，规划语义定位录制、目标转换和步骤修复能力。
- 明确成熟平台参考：Appium Inspector 的 Source / Selected Element / Suggested Locators，以及 Kobiton 的 session evidence 和 element remediation 思路。
- 新增语义目标分层：元素定位、OCR 文字定位、图像 / 区域定位和坐标 fallback。
- 新增 `tap_if_text` 产品边界：它是“看到文字则点击，否则跳过”的可选条件分支，不是普通文字点击；普通主流程应使用 `tap_on_element`、`tap_on_text`、`tap_on_image` 或坐标 fallback。
- 新增 Review 治理规划：R-018 至 R-026、T-051 至 T-059，将结构重构、文档/skills 同步、测试补洞和功能路线分开推进。
- 新增 Storage 回归测试，覆盖用例 CRUD、run / step result / metric / event / artifact 持久化、报告路径、分页 / 清理查询，以及临时 `DATA_DIR` 下 artifact 写入和 `deleteRun` 文件清理一致性。
- 新增 `StepsPanelParts` 轻量组件测试，覆盖执行配置包名提示、起始状态文案、用例库空态和设备忙时禁止执行。
- 新增 `step-expectations.ts` 和对应单测，将 OCR 文本、图像 pending、no_crash、app_alive、screen_changed、metric_below、log_not_contains 等步骤预期验证从 `automation-runner.ts` 拆出。
- 新增 `android-parsers.ts` 和对应单测，将 Android 设备行、分辨率、性能输出、logcat 事件、launcher 选择、前台组件判断、输入转义和 `pm clear` 结果解析从 driver 主类拆出。
- 新增 `StepList.tsx` 和对应轻量组件测试，将步骤列表、条件步骤编辑、预期编辑和步骤摘要从 `StepsPanel.tsx` 拆出。
- 新增 `conditional-step-executor.ts` 和对应单测，将 `tap_if_text` 可选条件点击逻辑从 `automation-runner.ts` 拆出。
- 新增 `run-artifact-service.ts` 和对应单测，将步骤截图、异常截图、OCR / 条件截图、日志、视频 artifact 和 HTML 报告生成从 `automation-runner.ts` 拆出。
- 新增 `android-actions.ts` 和对应单测，将 Android 点击、长按、滑动、返回、Home、最近任务、文本输入、启动 App、清缓存等主控动作从 driver 主类拆出。
- 新增 `android-metrics.ts` 和对应单测，将 CPU、内存、电量采样从 driver 主类拆出。
- 新增 `android-discovery.ts` 和对应单测，将 Android 设备发现、设备详情组装、离线 / 未授权状态映射从 driver 主类拆出。
- 新增 `android-video.ts` 和对应单测，将 Android 测试视频录制、screenrecord 优先策略、scrcpy 录制兜底和视频停止清理从 driver 主类拆出。
- 新增 `android-events.ts` 和对应单测，将 logcat Crash / ANR / command_failed 监听从 driver 主类拆出。
- 新增 `StepConditionEditor`、`StepExpectationPanel` 和对应组件测试，继续拆分 Dashboard 步骤列表中的条件点击编辑器和预期验证编辑器。
- 新增 image expectation 第一版：无 baseline 时返回 `pending_review`；`POST /api/artifacts/:id/approve-baseline` 可把 baseline artifact 写回用例；有 `baselineArtifactId` 时执行相似度对比，失败时生成 diff summary artifact 并关联到报告证据。
- 新增 `@mobile-automation/cli` 和根脚本 `pnpm cli -- ...`，支持 devices、cases、runs、run、status、report，方便 CI 或本地命令行触发与查询。
- 新增语义动作 schema 基础层：`tap_on_text`、`tap_on_element`、`tap_on_image` 已进入共享模型；`stepToAction` 对未解析语义步骤显式报错，避免被误当成坐标动作执行。

### Changed

- 固化 AI 需求接入规则：明确小修和准确需求可直接开发；模糊目标、产品级新能力或重大流程变化必须先调研成熟产品 / 行业实践，整理详细开发需求并确认关键决策后再实现。
- 调整开发优先级：重构性、文档性、工程合理化问题优先进入立即治理队列；功能性问题按产品价值和依赖关系进入后续路线。
- 规则主位置为 `docs/guides/ai-development-workflow.md` 和 `skills/agents/feature-pipeline.agent.md`；正式 Spec 只记录确认后的产品需求，不承载 AI 工作流元规则。
- 设备发现口径调整为自动发现 / 周期刷新为主，手动刷新仅作为立即重扫和故障恢复入口。
- 明确测试用例是 App / 业务流程 / 测试套件级资产，不与单台设备强绑定；设备管理页不承载完整用例库。
- Dashboard 信息架构调整：用例录制和用例执行作为一级导航后，模块内不再显示“步骤 / 执行”二级 tab；已保存用例先在用例录制模块的轻量用例库展示，后续升级为独立用例管理页。
- `StepsPanel.tsx` 开始按职责拆分：先抽出 RunConfigDrawer、CaseLibrary、ToolStatusBar，后续继续拆 StepList、StepEditor、ExpectationEditor。
- `AutomationRunner` 开始按职责拆分：runner 保留执行编排，步骤预期验证改由 `StepExpectationEvaluator` 负责，条件步骤和 artifact/report 边界后续继续拆。
- `AndroidDriver` 开始按职责拆分：driver 主类保留 ADB / scrcpy 调用编排，纯解析逻辑移入 parser 模块并单独覆盖 debug launcher 过滤等历史风险点。
- `StepsPanel.tsx` 继续瘦身：步骤列表职责改由 `StepList` 承接，`StepsPanel` 更聚焦用例录制区编排和执行结果区展示。
- `StepList` 继续瘦身：条件点击编辑和步骤预期验证分别改由 `StepConditionEditor`、`StepExpectationPanel` 承接。
- `AutomationRunner` 继续瘦身：条件步骤执行改由 `ConditionalStepExecutor` 负责，runner 不再直接处理 OCR 轮询、条件 metadata 和条件点击坐标转换。
- `AutomationRunner` 的 artifact / video / report 边界改由 `RunArtifactService` 承接，runner 更聚焦执行状态和设备操作编排。
- `AutomationRunner` 职责拆分收口：纯执行循环、repeat、loop_until_stop、暂停、单步、停止、失败中断和视频策略判断已由 `runner-core` 承接并通过独立测试覆盖。
- `AndroidDriver` 继续瘦身：动作执行和 App 生命周期改由 `AndroidActionExecutor` 承接，driver 主类继续保留截图、设备发现、性能、logcat 和录屏编排。
- `AndroidDriver` 的性能采样改由 `AndroidMetricSampler` 承接，driver 主类不再直接解析 `/proc/stat`、`/proc/meminfo` 和 `dumpsys battery`。
- `AndroidDriver` 的设备发现改由 `AndroidDeviceDiscovery` 承接，driver 主类不再直接组装 `DeviceInfo`。
- `AndroidDriver` 的测试执行视频录制改由 `AndroidVideoRecorder` 承接，driver 主类不再直接处理 screenrecord/scrcpy 录制生命周期。
- `AndroidDriver` 的 logcat 事件监听改由 `AndroidLogcatEventWatcher` 承接，driver 主类不再直接解析崩溃 / ANR 流。

## 2026-06-08

### Added

- 新增 `docs/guides/ai-development-workflow.md`，将 OpenSpec / Superpowers 风格的 spec-first、test-first 流程映射到当前项目结构。
- README、docs 索引和 `feature-pipeline` agent 已加入 AI 开发流程入口，后续功能默认按 propose、plan、implement with tests、review、verify、archive 推进。
- 新增 `docs/changes/` 作为大功能轻量 Delta 工作区；明确不全量迁移 OpenSpec，保留现有 REQ / DES / T / AC、traceability 和 ADR 体系。
- 新增验收写法约定：新 AC 优先采用 GIVEN-WHEN-THEN，存量 AC 不做批量重写。

## 2026-06-07

### Changed

- 执行视频策略调整为“每次执行均录制并保留视频，视频作为测试结果证据”；移除“通过后删除 / 通过也保留”的产品口径。
- requirements、design、tasks、acceptance、traceability 和 product-plan 已同步视频留存、报告展示和清理策略。
- 新增步骤级预期输入与验证规划：补充场景 8、REQ-034、DES-034、T-049、AC-031 和追踪矩阵，明确固定流程不能只验证“动作是否下发”，还要验证每一步 expected / actual。
- 明确步骤级预期验证与结构化断言、新包冒烟、可控随机探索不冲突：步骤预期负责每步结果判定，状态锚点负责流程推进，冒烟随机化只打乱用例或抽样，随机探索作为固定流程后的补充。
- product-plan 已把步骤级预期验证第一版提升到 Phase 1，完整 OCR 语义动作放到 Phase 4。

## 2026-06-06

### Added

- 新增预览页快捷设备切换和系统导航入口规划：设备名可弹出设备列表切换，主操作按钮聚焦返回、Home、最近任务。
- 新增 `recent_apps` 动作和 `recentApps` capability 口径：Android 支持最近任务，iOS 当前不暴露。
- 保留 Android 原生 scrcpy 窗口作为次级调试入口，用于排查预览延迟、坐标映射或底层控制问题。
- 新增 [product-plan.md](product-plan.md)，将产品目标从录制回放升级为“应用包 + 设备 + 测试流程 + 自动执行 + 性能基线 + 报告通知”的自动化测试平台。
- 新增 REQ-026 至 REQ-032，覆盖应用包管理、测试计划与流程编排、结构化断言、新包冒烟、性能基线、自动触发通知、可控随机探索。
- 新增 DES-024 至 DES-030，覆盖 Build Registry、Flow 模型、断言模型、冒烟编排、性能基线、任务调度通知、随机探索设计。
- 新增 T-031 至 T-038，规划包管理、APK 解析安装、手动冒烟、断言、Flow 导入导出、性能基线、自动触发通知和随机探索 PoC。
- 新增 AC-022 至 AC-027，覆盖包登记安装、手动新包冒烟、结构化断言、性能基线、自动触发通知和随机探索 PoC 验收。
- 新增 Q-013 至 Q-017，记录新包来源、冒烟默认流程、性能阈值、通知通道和随机探索排期等开放问题。
- 新增 DES-031 / DES-032，细化包下载解析安装服务和自然语言模板解析。
- 新增 T-039 至 T-046，细化 SMB 拉包、CI/CD Webhook 接包、企业微信通知、Dashboard 包管理、Dashboard 冒烟套件、OCR 断言、截图基准图、FPS / 启动耗时采集。
- 新增 AC-028 / AC-029，覆盖截图基准图人工审核流程和定时冒烟调度。
- 新增 REQ-033 / DES-033 / T-048 / AC-030，规划外部工具接口、MCP / CLI / Agent 适配和 `.ai/` 仓库导航。
- 新增 T-047，规划 Action / Flow 元数据增强和步骤卡片体验优化。

### Changed

- 产品口径调整为“自动化测试平台”，录制回放作为底座能力，不再作为唯一目标。
- README 推荐阅读顺序增加 product-plan，并补充包管理、性能基线、自动触发和通知能力。
- 自然语言流程和期望结果转换方案调整为规则模板解析，不默认使用大模型；模板解析结果必须由用户确认后保存为结构化断言。
- 将 v2.0 细化为移动端持续质量保障平台：SMB 拉包、App/AppBuild、SmokeSuite、企业微信通知、OCR / 截图断言、人工确认基准图、版本性能并排对比进入正式规划。
- 性能对比口径调整为当前阶段并排展示、人工判断；自动阈值告警作为后续可选能力。
- README 和 product-plan 的开放问题入口已同步为“已确认决策 + 待确认问题”，避免把 APK / CI / 断言方向误标为未决问题。
- 吸收 ClassInAutoTest 可借鉴设计：Action / Session 元数据、回放状态机、安装状态流、动作卡片 UI、MCP 工具接口和 repo-profile 导航；同时明确不借鉴明文密钥和运行数据混放做法。

## 2026-06-05

### Added

- 新增 iOS Driver 基础实现说明：libimobiledevice + xcrun 发现设备，idevicescreenshot 截图预览，WebDriverAgent 执行远程控制。
- 新增 ADR-006，记录 iOS 增量接入方案和当前边界。
- 新增 ios-driver README，说明工具依赖、WDA 配置、当前能力和已知缺口。

### Changed

- MVP 范围从 Android-only 文档口径调整为 Android 完整闭环 + iOS 基础能力增量接入。
- T-022 / T-023 更新为已完成基础版，T-024 更新为进行中。
- Q-001 / Q-004 更新为已确认 iOS 基础范围和工具链。

## 2026-06-04

### Added

- 新增自动化测试平台 Spec 文档包。
- 新增需求文档，覆盖设备管理、实时预览、远程操控、录制、步骤编辑、自动回放、性能采集、异常采集、测试报告、权限与扩展能力。
- 新增设计文档，定义分层架构、Driver 抽象、Android / iOS 能力边界、ActionStep 模型、录制流程、Runner、Metrics、DeviceEvent、Report 和存储设计。
- 新增任务拆分，按需求确认、工程骨架、共享模型、设备能力、录制编辑、执行报告、iOS 接入、稳定性扩展拆分开发任务。
- 新增验收标准，覆盖核心闭环和关键异常场景。
- 新增追踪矩阵，建立 REQ、DES、T、AC 的对应关系。
- 新增 REQ-025 测试保障与回归防护需求。
- 新增 DES-023 测试保障架构，覆盖单元测试、集成测试、Mock Driver、前端组件测试和端到端测试。
- 新增 T-029 / T-030 测试基础设施与核心回归测试任务。
- 新增 AC-021 测试保障与质量门禁验收项。
- 新增历史版执行视频录制策略：测试期间录制，异常场景留存，普通通过场景清理；该口径已在 2026-06-07 调整为每次执行均保留视频。
- 新增回放每步执行后自动截图要求，并将截图关联到 StepResult 和报告。
- 新增 SQLite 表结构建议，覆盖 devices、test_cases、steps、runs、run_iterations、step_results、metric_samples、device_events、artifacts。
- 新增 scrcpy 多设备并发进程管理、端口分配、进程生命周期和僵尸进程清理要求。

### Open

- TODO(confirm): 性能指标、数据保留周期和 CI 集成要求。

### Changed

- MVP 范围调整为 Android-only 闭环，iOS 改为第二阶段接入。
- 报告导出格式确认首版使用 HTML，PDF 首版不做。
- 权限范围确认第一版不做登录、角色、权限和审计。
- 部署方案确认本地单机优先，预留局域网共享启动方式，Docker Compose 放到第二阶段。
- 技术栈确认 React + TypeScript + Vite + Node.js + WebSocket + SQLite + 文件系统 artifacts。
- Android 预览方案确认 scrcpy 优先，ADB 截图轮询作为兜底方案。
- T-002 工程骨架验收明确为 `pnpm install`、`pnpm dev`、健康检查、`pnpm lint`、`pnpm test` / `pnpm test:unit` 可运行。
- AC-013 报告验收从 JSON 下载调整为 HTML 导出优先，JSON 保留为内部数据或后续集成能力。
