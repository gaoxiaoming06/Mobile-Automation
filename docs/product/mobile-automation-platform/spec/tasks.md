---
title: 自动化测试平台任务拆分
doc_type: tasks
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-07-23
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台任务拆分

## 任务状态说明

| 状态 | 说明 |
|---|---|
| todo | 待开始 |
| in-progress | 进行中 |
| done | 已完成 |
| blocked | 阻塞 |
| cancelled | 取消 |
| frozen | 冻结 / 实验能力保留，不作为当前主线推进 |

## 当前修复队列

> 该队列用于承接 review 中确认合理、但不适合混入小修的一组问题。执行窗口按 Codex 开发轮次推进：下一轮表示下一次进入实现任务时优先处理，第二轮表示主流程回归测试稳定后处理，稳定性阶段表示核心功能完整后处理。
>
> 2026-07-23 之后，历史行里出现的“用例录制 / StepsPanel / useRecorder / recording.ts”只代表历史追溯，不再代表当前 Dashboard 主入口。当前主流程是 PageStateFlow 资产驱动执行；旧线性录制 UI 已在 R-037 移除。

| 编号 | 优先级 | 状态 | 计划窗口 | 内容 | 验收方式 |
|---|---|---|---|---|---|
| R-001 | P0 | done | 下一轮 | 补齐主流程回归测试：Android 实时预览控制、录制步骤、回放执行、每步截图、报告生成、iOS unsupported-video fallback | `pnpm test:unit` 覆盖核心主流程；修预览或控制时测试能防止回归 |
| R-002 | P0 | done | 当前轮 | 已拆分 `platform/apps/dashboard/src/App.tsx`：状态逻辑抽为 `useScrcpyStream`、`useDeviceList`、`useRecorder`、`useRunExecution`，页面 UI 拆为 Device/Preview/Steps 面板组件 | dashboard typecheck/build 通过；现有录制、控制、回放路径不退化 |
| R-003 | P1 | done | 第二轮 | 已将执行状态机下沉到 `runner-core`，server 保留 API、Storage、Driver、截图、视频和报告适配 | `RunStateMachine` 覆盖 once/repeat/loop/失败策略/pause/step；`pnpm test` 通过 |
| R-004 | P1 | done | 第二轮 | 已补 loop 执行模式、步骤插入等待、步骤复制、步骤启用/禁用、pause/resume、单步执行、每步后暂停等待继续 | Dashboard 可配置并执行；Runner 状态正确落库；`pnpm test` 通过 |
| R-005 | P1 | done | 第二轮 | 已实现 Android logcat 实时监听 Crash/ANR/command failure，并将事件日志作为 report artifact 关联到 Run | Mock 事件回归覆盖 crash 入报告；`pnpm test` 通过；真机 Crash/ANR 需后续人工验收 |
| R-006 | P2 | todo | 稳定性阶段 | 报告增强：性能摘要、性能图表、离线 HTML 截图内嵌或可导出 bundle | HTML 离线打开可查看关键证据；报告展示 CPU/内存趋势 |
| R-007 | P2 | todo | 稳定性阶段 | 存储增强：runs 分页、schema migration、artifact 清理配置、历史数据清理 | 多次执行后可分页查看；清理后数据库和文件一致 |
| R-008 | P2 | todo | 稳定性阶段 | 类型增强：将 `ActionStep.params` 从 `Record<string, unknown>` 收敛为按动作区分的 discriminated union | 非法步骤参数在 TypeScript 或 schema 校验阶段被拦截 |
| R-009 | P2 | todo | 稳定性阶段 | 工程规范：引入 ESLint / Prettier / lint-staged，并补真实 lint 规则 | `pnpm lint` 同时覆盖 typecheck 和 lint；无大面积格式噪音 |
| R-010 | P2 | todo | 稳定性阶段 | 补全 `docs/guides`：本地启动、scrcpy 故障排查、iOS WDA 配置、真机调试流程 | 新开发者按 guide 可启动服务并连接 Android/iOS 设备 |
| R-011 | P1 | done | 第二轮 | 仓库结构治理：支持 `DATA_DIR` 外置运行时数据库和 artifacts、清理 dashboard `dist` 版本污染风险、设计 scrcpy-server 下载/校验策略 | 新 clone 后无运行产物污染；运行时数据可放到 repo 外；缺少 scrcpy-server 时有明确安装/下载路径 |
| R-012 | P1 | done | 第二轮 | Artifact 清理策略：启动时清理临时残留，后台定时清理；历史报告默认不删，显式开启 `ARTIFACT_RETENTION_ENABLED=1` 后才按 passed/failed 保留天数和总空间上限删除；报告发送兼容外置隐藏目录 | 报告 HTML 可访问；默认不会删除已完成报告；开启 retention 后过期 run 会同步删除 DB 与 artifact 文件；`pnpm test:unit` 覆盖策略 |
| R-013 | P1 | done | 第二轮 | 报告证据策略：每步截图继续保留；每次执行均录制并保留视频；HTML 报告内嵌视频并可从步骤跳转到对应时间点 | Runner 测试覆盖成功、失败、停止场景视频留存；报告测试覆盖视频与步骤截图关联 |
| R-014 | P1 | done | 当前轮 | Review 低成本工程对齐：更新 README/platform 结构说明、补 `.env.example`、新增最小部署指南、同步 tech-architect 与 dashboard-ui-dev skills | README 不再把运行时 artifacts 描述为 repo 内目录；环境变量有示例；部署指南覆盖单机内网路径；skills 记录 iOS 和 dashboard 关键实现边界 |
| R-015 | P1 | done | 规划完成后 | 产品目标升级：把包管理、新包冒烟、性能基线、测试计划、结构化断言、自动触发通知纳入正式路线图 | Spec 中已新增并合并 REQ/DES/T/AC 追踪；后续实现按新任务推进 |
| R-016 | P1 | in-progress | 当前轮 | 步骤级预期验证：已落地 `expectations` schema、Dashboard 每步预期编辑、Runner expected/actual 验证、OCR 文字预期、Flow 起始状态、报告展示和 Mock Driver 回归；已补录制时自动生成候选预期、`clear_data_and_launch` 起始策略、Setup 执行时机、`tap_if_text` 可选弹窗条件步骤、可配置 Runtime Interceptor 临时阻断页 watcher，以及 `wait_until_state` 动态状态等待；录制页步骤卡片已支持前置条件 / 后置预期统一编辑，可把候选条件切换为“强基准 / 建议 / 候选”，并可从 before / after evidence 一键升格 Activity、UI 元素、OCR 文字为强前置 / 强后置；Activity 强基准已接入前台 Activity 验证；之后再做图像基准、区域圈选和语义动作修复入口 | `pnpm lint`、`pnpm test:unit` 通过；真实 Android 回放已验证 OCR 文本预期通过；录制新步骤自动带出高可靠预期；执行前可配置清数据后启动；条件弹窗步骤命中时点击、未命中时 skipped 并继续；结构化用例每步可通过后置预期 / wait_until_state / activityName 动态等待，避免纯固定间隔；用户可把当前页面标记为临时阻断页，后续执行会自动处理后继续原步骤 |
| R-017 | P1 | in-progress | 当前轮 | 语义定位录制增强：已加入 `tap_on_text`、`tap_on_element`、`tap_on_image` schema 和防误执行测试；已补录制点击的缓存快照优先、实时 element-at 兜底、Android compressed UIAutomator dump、hierarchy 裁剪系统栏时的坐标映射修复，以及重复 resource-id / content-desc / text 的 `occurrence` 视觉序号消歧；录制 Observation summary 现在保留紧凑 elementCandidates / textCandidates，步骤编辑器可从这些候选一键填入 `tap_on_element` / `tap_on_text` 动作策略，或选择 resource-id、content-desc、文字、OCR 区域等强基准；后续继续做图片 / 区域锚点、步骤修复入口和 iOS 元素定位 | Dashboard 能清晰区分坐标点击、元素点击、文字点击、图像 / 区域点击和条件分支；重复同名元素显示为 `#2` / `#3` 并在回放定位时使用同一语义序号；步骤编辑器展示动作前 / 动作后采集证据，并允许在动作策略里切换 `tap_on_element`、`tap_on_text`、`tap_on_image`、`input_text_to_element`、`scroll_until_visible`、`wait_until_state` 等方式；Mock Driver 覆盖语义目标命中、未命中和 fallback；Android 真机验证一次文字或元素点击回放 |
| R-018 | P1 | done | 当前轮 | Review 规划治理：把 Claude review 中确认合理的重构、文档、工程合理化问题拆为立即治理任务；功能性问题按产品优先级进入路线图 | tasks / changelog / skills 已同步；后续执行不再把结构治理和功能开发混在一个任务里 |
| R-019 | P0 | done | 当前轮 | StepsPanel 拆分与组件测试：已拆出 RunConfigDrawer、CaseLibrary、ToolStatusBar、StepList、StepConditionEditor、StepExpectationPanel，并补轻量组件测试 | Dashboard typecheck 通过；组件测试覆盖步骤编辑、条件分支、预期编辑、执行控制；页面和 server 探活正常 |
| R-020 | P0 | done | 当前轮 | Storage 测试补齐：已为 SQLite CRUD、schema 初始化、runs/cases/steps/artifacts、清理查询和分页查询补单元/集成测试 | `storage.test.ts` 覆盖核心读写和迁移风险；清理后 DB 与 artifact 文件一致 |
| R-021 | P1 | done | 当前轮 | automation-runner 职责拆分：已拆出 step expectation evaluator、OCR / 断言 helper、`tap_if_text` conditional step executor、artifact/video/report service；纯执行状态机已由 runner-core 承接 | `automation-runner.ts` 保留编排；runner-core 和 server runner 测试全绿；新增测试覆盖各 evaluator |
| R-022 | P1 | done | 当前轮 | android-driver 职责拆分：已拆出 parser、actions/app lifecycle/text input、discovery、metrics、logcat events、video recording 模块和窄测试 | Android driver 行为测试全绿；launchApp、text input、recent_apps、clearAppData 不退化 |
| R-023 | P1 | done | 当前轮 | 图像断言 diff 第一版：已实现无 baseline 时 pending_review、approve-baseline API 写回 baselineArtifactId、有 baseline 后相似度对比、失败 diff summary artifact 和报告证据链接 | `assert_image` 不再只是 unsupported；首次 pending_review、确认后对比、失败 diff 三类测试通过 |
| R-024 | P1 | done | 当前轮 | CLI trigger 第一版：新增 `@mobile-automation/cli` 和 `pnpm cli -- ...`，支持 devices/cases/runs/run/status/report | CLI 可列用例、触发一次 run、查询状态和报告链接；复用 REST API、设备锁和错误码 |
| R-025 | P2 | todo | 稳定性阶段 | 工程规范与测试目录统一：统一 tests 目录约定，引入真实 ESLint/Prettier/lint-staged 或等价门禁 | `pnpm lint` 覆盖格式/规则/类型；测试目录迁移不造成大面积无意义 diff |
| R-026 | P2 | todo | 稳定性阶段 | 报告性能图表与离线体验：增加 CPU/内存/电量等折线图、视频/截图证据定位和离线 bundle 能力 | 大报告可读性提升；HTML 离线打开能查看关键证据；报告测试覆盖缺失 artifact |
| R-027 | P0 | in-progress | 支撑能力 | v2 图谱内核保留为底层能力：已完成 v1/v2 迁移护栏、graph-core 纯模型、Observation 管线、Graph Storage、TargetResolver、RoutePlanner、ExecutionPlan、纯 GraphRunner、真实设备 GraphRunService Adapter、graph-runs API / CLI / Dashboard 入口、RuntimeOverlay 基础能力和图谱报告第一版；产品主线不再追求全 App 全局图谱穷尽，后续只把其中稳定能力复用于结构化录制用例 | 状态识别、语义动作、动态预期、报告证据可被 StructuredFlow 复用；目标节点执行入口保留为实验 / 高阶能力，不再作为下一阶段默认主入口 |
| R-028 | P0 | in-progress | 支撑能力 | 图谱执行稳定性内核作为结构化用例执行支撑：已补两阶段 bootstrap、动态 transition wait policy、matcher 质量门禁、bootstrap / transition wait / recovery 诊断；后续重点迁移到 FlowStep 的 beforeState / afterExpectations 动态等待和异常清障 | 结构化录制用例执行不依赖固定 sleep；每步能展示 beforeState、动作、afterExpectation、系统守护、异常清障和证据 |
| R-029 | P1 | in-progress | 执行引擎演进 | Android 动作执行通道升级：已抽象 `AndroidActionBackend` 和 `SemanticDeviceActionRequest`，AndroidDriver 支持 `performSemanticAction`，并新增 Appium / UIAutomator2-compatible HTTP backend 环境变量接入；StructuredFlowRunner / GraphRunService 的语义动作优先走 backend，不可用时才 ADB fallback | `tap_on_element`、`input_text_to_element`、`scroll_until_visible` 可接元素级 driver；未配置 backend 时继续使用 UIAutomator dump + ADB fallback，且 step metadata 记录 `driverChannel` / `fallbackReason`；注意当前只是 backend 协议接入，不代表本地 UIAutomator2 / Appium 服务已内置启动；剩余真实 server 进程管理、session 绑定、工具探活和报告可视化 |
| R-030 | P2 | frozen | 实验能力 | 图谱 AppBuild 版本兼容治理冻结：全局图谱版本兼容、candidate / draft、graphVersion 发布不再作为当前主线推进；包版本兼容优先落到 StructuredFlow 的 appVersion / compatibleRange | 未来重新打开图谱方向时再恢复；当前新包冒烟和包版本提示走 StructuredFlow |
| R-031 | P0 | in-progress | 支撑主线 | 结构化录制用例能力：已完成 Smart Recorded Flow 基础模型、SQLite 存储、录制保存、StructuredFlowRunner、用例库主入口、执行到中间步骤、运行时预期覆盖；本轮补齐 `input_text_to_element`、`scroll_until_visible`、`wait_until_state`，并新增 Flow 执行前平台 / 包名 / 安装版本校验、用例库详情展示增强和录制步骤规则编辑器；后续继续做 Flow REST / CLI / MCP 外部接口和更完整的步骤修复入口 | 用户可录制一条“App-版本-起点-终点”用例并保存；再次执行时每步先校验 beforeState、执行语义动作、动态等待 afterExpectations；可指定执行到中间步骤；录制页可查看动作前采集、动作策略、动作后采集，并把任一候选提升为强基准；执行前能提示设备平台、包名或版本不满足；AI 可通过后续 MCP 触发并拿到结构化结果；后续作为 PageStateFlow 的路径快照能力继续演进 |
| R-032 | P0 | done | 当前轮 | 统一 TestRuleCore 底层执行规则：StructuredFlow 作为线性路径快照，BusinessGraph / PageStateFlow 作为未来来源；底层都收敛为 `TestRuleStep`，再由同一适配层转换为可执行 ActionStep | StructuredFlowRunner 不再内联转换逻辑；适配层测试覆盖 beforeState、afterExpectations、systemGuards、timing、source metadata、历史占位 precondition 过滤和 package 推断；后续 PageTransition / Graph RoutePlan 可复用该入口 |
| R-033 | P0 | done | 当前轮 | StructuredFlow 阶段收敛治理：顶层 README / product-plan / requirements / design / acceptance / tasks / traceability / skills 曾明确 StructuredFlow 是主线，BusinessGraph 上层冻结为实验能力；该结论已被 R-034 PageStateFlow 主线切换覆盖，StructuredFlow 保留为路径快照 | 后续开发默认进入 PageStateFlow / 页面资产库 / TestRuleCore；StructuredFlow 继续作为路径快照和回归用例；除非明确重新打开图谱方向，否则不扩展源码扫描、候选图谱治理、自动晋级和目标节点规划 |
| R-034 | P0 | in-progress | 当前主线 | PageStateFlow 主线切换：当前主要项目目标命名为“页面状态资产驱动的移动端智能回放测试平台”；新增 PageStateLibrary / PageModel / PageElement / PageTransition / PathPlan，录制用于学习页面资产，StructuredFlow 作为页面路径快照，BusinessGraph 上层继续 experimental；当前已把页面匹配和手工操作区域从“固定坐标”升级为“原始相对区域 + semanticArea + coordinateSpace + OCR / layout / image evidence”，并让 `tap_on_image` 运行时优先在同一语义区域内按 OCR 文案重定位；登录 / 表单类固定语义控件进一步收口为 `runtime-locator:*` + `structural_locator` + `coordinateSpace=runtime`，历史圈选区域只保留为 `searchHintRegion` 调试证据 | 文档完成 REQ-042 / DES-042 / AC-044 / T-084 至 T-089；当前已验证页面身份依据保存、区域 OCR 漂移匹配、手工 PageElement / PageTransition 语义字段透传、视觉点击重定位、资产录制面板 semanticArea 人工确认、连接边页签、`compound_navigation` 复合跳转、同一触发区域多条复合菜单出口共存、同屏 grid candidate 下游失败后尝试下一个候选，以及目标执行报告结构化解释；本轮已清理 active graph 中旧平台依赖 matcher / 旧录制节点 / `tap_on_element + android_uiautomator` 旧边，修复 `state_is` 以 `nodeId` 为权威身份，并用真机通过 `主页 -> 新建公开课`、`主页 -> 添加好友`、`主页 -> 加入班级`、`主页 -> 班级详情 -> 新建课堂` 四条核心回归；PageTask 已在真机打通 `text_input` 输入后 OCR 反查、`picker_select` 选择时长和 `toggle_set` 安全开关，验证新建课堂页可填写课堂标题和课堂时长但不点击发布；登录页本地资产已改为 4 个 runtime structural PageElement + 1 个 `账号密码登录` PageTask + 1 条 `source_page_navigation` 任务边，旧区域点击登录边已下线；当前已补齐并验证 `班级详情` 到教学方案、学习方案、班级聊天、班级待办、班级公告、发布活动类型选择页、新建课堂，以及 `发布活动类型选择页` 到新建课堂、新建作业、新建测验、新建录播课、新建资料的出口；后续继续补 subpage_edit、滚动翻页候选闭环、跨设备样本验证、PageTransition 批量治理、更多真实页面出口，以及独立稳定性探索测试入口 |
| R-035 | P0 | done | 当前轮 | 已关闭 `tap_on_image` / 输入型 PageElement 的默认 `region_center` 执行兜底：普通手工 `image-region` 必须优先依赖 OCR / recorded crop template / 视觉候选 / 结构候选等运行时重定位证据；当跨设备、分辨率变化或已有 `targetText` / `visualLocator` 但重定位失败时，不再退化为原始圈选坐标点击，而是失败并暴露 `runtime_relocation_required` | Server 测试覆盖 OCR / template / visual candidate 命中才执行、重定位失败不点击、报告 metadata 区分 `ocr_text` / `template_search` / `visual_candidate` / `region_center_disabled`；剩余 P0 follow-up 是把失败修复 UI 做成专门 locator 修复卡片 |
| R-036 | P0 | planned | 当前主线支撑 | Android App 旁路性能与稳定性监控：借鉴 `apk_auto_test` 的多进程发现、进程级 CPU / PSS、sustain / cooldown 阈值、incident 证据、logcat 稳定性事件解析和 HTML 报告思路，但以 TypeScript 内核接入现有 Runner、Storage、Artifact、Report、缺陷候选和 AI 诊断链路，不引入独立 Python CLI 作为长期主路径 | `T-095` 完成后，Run 可按包名自动监控主进程和子进程；报告展示进程级 CPU / 内存曲线、生命周期、阈值事件、crash / ANR / process death 和证据；高频时序写 artifact，Run 中只保存摘要；真机 ClassIn 5 分钟监控可生成可读报告 |
| R-037 | P0 | done | 当前轮 | 移除旧线性录制 Dashboard 主流程：删除 `StepsPanel`、`StepList`、`CaseLibraryPanel`、`useRecorder`、`recording.ts`，设备预览入口改为 `deviceDetails`，运行结果展示收敛到 `RunResultsPanel`，原录制写图谱资产能力改名为资产连接候选 | Dashboard / Server typecheck 通过；聚焦测试覆盖导航、App 主入口、语义资产快照和资产连接候选；新功能不得重新挂回旧录制入口 |

## Phase 0：需求确认与工程决策

### T-001：确认 MVP 范围

- 状态：done
- 关联需求：REQ-001 至 REQ-024
- 关联设计：DES-001、DES-002
- 目标平台：Android + iOS + Web Dashboard
- 修改边界：文档和计划
- 任务内容：
  1. 已确认首版 Android 优先，并增量接入 iOS 基础能力。
  2. 已确认首版不做权限。
  3. 已确认部署方式：本地单机优先，预留局域网共享；Docker Compose 放到第二阶段。
  4. 确认技术栈。
  5. 已确认报告首版支持 HTML 导出。
- 验证方式：MVP 阻塞问题有明确结论；非阻塞开放问题保留 `TODO(confirm)`、影响范围和后续阶段说明。

### T-002：创建工程骨架

- 状态：done
- 关联需求：REQ-001、REQ-015、REQ-020、REQ-025
- 关联设计：DES-001、DES-002、DES-023
- 目标平台：Web Dashboard + Backend
- 修改边界：工程结构、包管理、基础配置
- 任务内容：
  1. 创建 monorepo 或确认替代工程结构。
  2. 创建 dashboard、server、shared、driver、runner、report 包。
  3. 创建 test-support 包，用于 Mock Driver、fixtures、测试 builder。
  4. 配置 TypeScript、lint、format、test。
  5. 配置开发启动命令。
- 验证方式：
  1. `pnpm install` 可以完成依赖安装。
  2. `pnpm dev` 或 README 中明确记录的等价命令可以同时启动 Dashboard 和 Server。
  3. Dashboard 本地页面可访问，Server 健康检查接口可访问。
  4. `pnpm lint` 可以运行。
  5. `pnpm test` 和 `pnpm test:unit` 可以运行，空工程或最小样例测试通过。

## Phase 1：共享模型与基础服务

### T-003：定义共享数据模型

- 状态：done
- 关联需求：REQ-005、REQ-006、REQ-007、REQ-008、REQ-009、REQ-011、REQ-012、REQ-013、REQ-014
- 关联设计：DES-009、DES-013、DES-014、DES-015、DES-016
- 目标平台：Shared
- 修改边界：公共类型、schema 校验
- 任务内容：
  1. 定义 DeviceInfo、DeviceCapabilities。
  2. 定义 ActionStep。
  3. 定义 TestCase、RunConfig、TestRun、StepResult。
  4. 定义 MetricSample、DeviceEvent、ArtifactRef、TestReport。
  5. 建立 schema 校验和默认值。
  6. 后续增强 ActionStep 时，需要补齐 source、context、coordinate path、preview rendered metadata 和 session metadata。
- 验证方式：模型单元测试覆盖必填字段、动作参数和非法输入。

### T-004：实现 Backend API 基础框架

- 状态：done
- 关联需求：REQ-001、REQ-020、REQ-022
- 关联设计：DES-018、DES-019
- 目标平台：Backend
- 修改边界：server 模块
- 任务内容：
  1. 创建 REST API 服务。
  2. 创建 WebSocket 服务。
  3. 实现统一错误码。
  4. 实现健康检查接口。
  5. 实现基础日志。
- 验证方式：REST 和 WebSocket 基础连接测试通过。

### T-005：实现存储层

- 状态：in-progress
- 关联需求：REQ-008、REQ-014、REQ-023
- 关联设计：DES-017
- 目标平台：Backend
- 修改边界：数据库、artifact 目录管理
- 任务内容：
  1. 建立 SQLite 表结构：devices、test_cases、steps、runs、run_iterations、step_results、metric_samples、device_events、artifacts。
  2. 实现用例 CRUD 存储。
  3. 实现执行记录和步骤结果存储。
  4. 实现指标、事件、附件 metadata 存储。
  5. 实现 artifact 路径管理。
  6. 实现每步截图、报告、日志、执行视频的 artifact metadata 写入。
  7. 实现执行视频统一留存，并接入 artifact 清理策略。
- 验证方式：数据库迁移、CRUD、artifact metadata 和清理策略测试通过。

## Phase 2：设备管理与 Android MVP

### T-006：实现 Driver Core

- 状态：done
- 关联需求：REQ-002、REQ-003、REQ-004、REQ-015、REQ-022
- 关联设计：DES-004、DES-007
- 目标平台：Backend + Driver
- 修改边界：driver-core 模块
- 任务内容：
  1. 定义 DeviceDriver 接口。
  2. 定义 Driver 错误类型。
  3. 定义设备会话模型。
  4. 定义设备能力上报。
  5. 实现 Mock Driver 用于 UI 和 runner 测试。
- 验证方式：Mock Driver 集成测试通过。

### T-007：实现设备发现与设备锁

- 状态：in-progress
- 关联需求：REQ-002、REQ-018、REQ-022
- 关联设计：DES-007
- 目标平台：Backend
- 修改边界：Device Orchestrator
- 任务内容：
  1. 定时发现设备。
  2. 维护设备在线 / 离线状态。
  3. 实现设备会话。
  4. 实现设备锁。
  5. 推送设备状态 WebSocket 事件。
- 验证方式：设备状态变化和锁冲突测试通过。

### T-008：实现 Android 设备发现和基础信息

- 状态：done
- 关联需求：REQ-002
- 关联设计：DES-005
- 目标平台：Android
- 修改边界：android-driver 模块
- 任务内容：
  1. 调用 ADB 发现设备。
  2. 获取型号、系统版本、分辨率、方向。
  3. 上报 Android 能力。
  4. 处理 ADB 不存在或设备未授权。
- 验证方式：真实 Android 设备可出现在设备列表。

### T-009：实现 Android 预览

- 状态：done
- 关联需求：REQ-003、REQ-016
- 关联设计：DES-005、DES-008
- 目标平台：Android
- 修改边界：android-driver、server、dashboard 预览接口
- 任务内容：
  1. 接入 scrcpy 作为首选预览方案，截图轮询作为兜底。
  2. 输出预览帧和元数据。
  3. 处理预览启动、停止、断流。
  4. 前端展示预览并保持宽高比。
  5. 实现 scrcpy 进程生命周期管理。
  6. 实现多设备端口分配和进程隔离。
  7. 服务启动或设备断连时清理失效预览进程。
- 验证方式：真实 Android 设备预览可用，旋转后元数据正确；两台 Android 设备可同时预览且端口不冲突。

### T-010：实现 Android 远程操作

- 状态：done
- 关联需求：REQ-004、REQ-007、REQ-016、REQ-017
- 关联设计：DES-005、DES-008、DES-009
- 目标平台：Android
- 修改边界：android-driver、action API
- 任务内容：
  1. 实现 tap。
  2. 实现 long_press。
  3. 实现 swipe。
  4. 实现 back、home。
  5. 实现 input_text、clear_text 基础能力。
  6. 实现 screenshot。
  7. 实现 launch_app、close_app。
- 验证方式：真实 Android 设备上每个动作均可执行并返回结果。

### T-011：实现坐标转换

- 状态：done
- 关联需求：REQ-004、REQ-016
- 关联设计：DES-008
- 目标平台：Web Dashboard + Shared
- 修改边界：dashboard 预览组件、shared 坐标工具
- 任务内容：
  1. 计算预览图实际渲染区域。
  2. 实现浏览器坐标到设备坐标转换。
  3. 实现绝对坐标和归一化坐标互转。
  4. 处理横竖屏和旋转。
  5. 增加单元测试。
- 验证方式：不同容器尺寸、分辨率、方向下转换结果正确。

## Phase 3：Dashboard 与录制编辑

### T-012：实现设备列表页

- 状态：done
- 关联需求：REQ-001、REQ-002
- 关联设计：DES-003
- 目标平台：Web Dashboard
- 修改边界：dashboard 设备页面
- 任务内容：
  1. 展示设备列表。
  2. 展示平台、状态、型号、系统版本、能力。
  3. 支持刷新。
  4. 支持跳转预览页。
  5. 展示空状态和错误状态。
- 验证方式：设备列表 UI 手动验证和组件测试通过。

### T-013：实现设备预览页

- 状态：done
- 关联需求：REQ-003、REQ-004、REQ-019
- 关联设计：DES-003、DES-008
- 目标平台：Web Dashboard
- 修改边界：dashboard 预览页面
- 任务内容：
  1. 展示设备画面。
  2. 支持点击、滑动、返回、Home、输入。
  3. 展示设备状态和预览状态。
  4. 展示最近命令结果。
  5. 处理断流和重试。
- 验证方式：真实 Android 设备预览页可以完成基础操作。

### T-014：实现录制生命周期

- 状态：in-progress
- 关联需求：REQ-005
- 关联设计：DES-010
- 目标平台：Web Dashboard + Backend
- 修改边界：recording API、dashboard recording UI
- 任务内容：
  1. 开始录制。
  2. 暂停录制。
  3. 继续录制。
  4. 停止录制。
  5. 放弃录制。
  6. 录制过程中生成 ActionStep。
- 验证方式：录制操作后步骤顺序、时间和参数正确。

### T-015：实现步骤编辑器

- 状态：in-progress
- 关联需求：REQ-006、REQ-008
- 关联设计：DES-011
- 目标平台：Web Dashboard + Backend
- 修改边界：case editor、case API
- 任务内容：
  1. 步骤列表展示。
  2. 删除、插入、复制、排序。
  3. 修改参数。
  4. 启用 / 禁用。
  5. 添加备注。
  6. 保存为 TestCase。
  7. 后端校验 Step schema。
- 验证方式：编辑后保存并重新打开，用例内容一致。

### T-016：实现用例管理

- 状态：in-progress
- 关联需求：REQ-008、REQ-020
- 关联设计：DES-003、DES-019
- 目标平台：Web Dashboard + Backend
- 修改边界：case list、case detail、case API
- 任务内容：
  1. 用例列表。
  2. 用例详情。
  3. 新建、编辑、删除、复制。
  4. JSON 导入 / 导出。
  5. 标签和目标平台。
- 验证方式：用例 CRUD 和导入导出测试通过。

## Phase 4：执行与报告

### T-017：实现 Test Runner

- 状态：in-progress
- 关联需求：REQ-009、REQ-010、REQ-014、REQ-018
- 关联设计：DES-012、DES-013、DES-017
- 目标平台：Backend
- 修改边界：runner-core、run API
- 任务内容：
  1. 创建 Run。
  2. 生成 TestCase 快照。
  3. 校验设备能力。
  4. 获取设备锁。
  5. 按执行模式循环步骤。
  6. 每个步骤完成后自动截图并关联到 StepResult。
  7. 执行期间启动设备视频录制。
  8. 记录 StepResult。
  9. 支持暂停、继续、停止。
  10. 释放设备锁。
  11. Run 结束后保留执行视频并写入报告附件；录制不可用时记录明确事件。
- 验证方式：Mock Driver 下执行一次、N 次、停止和失败策略均正确；每步结果有截图引用，成功、失败、停止 Run 均保留视频或记录视频不可用原因。

### T-018：实现执行配置与执行详情页

- 状态：in-progress
- 关联需求：REQ-009、REQ-010、REQ-019
- 关联设计：DES-003、DES-013、DES-018
- 目标平台：Web Dashboard
- 修改边界：run config page、run detail page
- 任务内容：
  1. 选择用例和设备。
  2. 配置次数、循环、间隔、失败策略。
  3. 展示实时步骤进度。
  4. 展示日志流和异常提示。
  5. 支持暂停、继续、停止。
- 验证方式：执行详情页能实时反映 Run 状态。

### T-019：实现性能采集

- 状态：in-progress
- 关联需求：REQ-011
- 关联设计：DES-014
- 目标平台：Android first，iOS follow-up
- 修改边界：metrics collector、android-driver、ios-driver
- 任务内容：
  1. 实现采样调度。
  2. Android 采集 CPU、内存。
  3. 采样关联 run、iteration、step。
  4. 存储 MetricSample。
  5. iOS 指标按确认方案接入。
- 验证方式：执行报告中可看到性能时间线。

### T-020：实现异常采集

- 状态：in-progress
- 关联需求：REQ-012、REQ-022
- 关联设计：DES-015、DES-022
- 目标平台：Android first，iOS follow-up
- 修改边界：event collector、driver、runner
- 任务内容：
  1. 捕获命令失败。
  2. 捕获设备断连。
  3. 捕获步骤超时。
  4. Android 采集 crash / ANR 相关 logcat。
  5. iOS crash / hang 按确认方案接入。
  6. 异常关联截图、日志和执行视频。
- 验证方式：人工制造失败、断连、App crash，报告中有事件、截图、日志；执行视频被保留并能定位异常时段。

### T-021：实现报告生成

- 状态：in-progress
- 关联需求：REQ-013、REQ-014、REQ-020
- 关联设计：DES-016、DES-017
- 目标平台：Backend + Web Dashboard
- 修改边界：report-core、report API、report UI
- 任务内容：
  1. 生成 TestReport JSON。
  2. 生成报告详情页。
  3. 展示执行摘要。
  4. 展示每轮和每步结果。
  5. 展示性能曲线。
  6. 展示异常和附件。
  7. 支持 HTML 导出。
  8. 保留 JSON 原始数据模型，后续用于 CI / API 导出。
  9. 展示每步执行后截图。
  10. 成功、失败、Crash、ANR、超时、设备断连报告均展示视频附件或视频不可用原因。
- 验证方式：一次成功、一失败、一设备断连均能生成报告；成功和失败报告都有可播放视频或明确的视频不可用状态。

## Phase 5：iOS 能力接入

### T-022：调研并确认 iOS 工具链

- 状态：done
- 关联需求：REQ-002、REQ-003、REQ-004、REQ-011、REQ-012、REQ-017
- 关联设计：DES-006
- 目标平台：iOS
- 修改边界：调研文档、PoC
- 任务内容：
  1. 已选择 WebDriverAgent 作为 iOS 真机控制方案。
  2. 已暂缓 idb，不进入当前物理设备实现。
  3. 已选择 libimobiledevice 作为在线发现、基础信息、截图和电量采样方案。
  4. crash log、视频录制和更完整性能采集保留为后续任务。
  5. 已在 `platform/packages/ios-driver/README.md` 输出 iOS 能力矩阵。
- 验证方式：工具探测、设备发现解析和能力上报测试通过；WDA 点击 / 截图需在在线 iOS 真机上继续手动验证。

### T-023：实现 iOS 设备发现与预览

- 状态：done
- 关联需求：REQ-002、REQ-003
- 关联设计：DES-006
- 目标平台：iOS
- 修改边界：ios-driver、server、dashboard
- 任务内容：
  1. 已发现在线 iOS 设备，并通过 xcrun fallback 展示离线物理设备。
  2. 已获取基础信息。
  3. 已上报截图、控制、视频、指标、事件能力。
  4. 已实现 idevicescreenshot 截图预览。
  5. 已通过 `xcrun devicectl device info displays` 补充分辨率和方向，用于 WDA 坐标换算。
  6. 已补充 WDA screenshot 兜底：idevicescreenshot 失败且 WDA 可达时仍可取图。
  7. Dashboard 已按平台区分 Android scrcpy 与 iOS 截图预览。
- 验证方式：`/api/devices` 可返回 iOS 设备；在线可信 iOS 设备可展示截图预览；WDA endpoint 解析和自动探测单测通过。

### T-024：实现 iOS 操作和异常采集

- 状态：in-progress
- 关联需求：REQ-004、REQ-007、REQ-011、REQ-012、REQ-017
- 关联设计：DES-006
- 目标平台：iOS
- 修改边界：ios-driver
- 任务内容：
  1. 已实现 WDA tap、long_press、swipe、input_text。
  2. 已实现 WDA Home；Back 无 iOS 通用系统能力，暂不暴露。
  3. 已实现 WDA App 启动和关闭。
  4. 已补充 WDA 可达性探测：只有 endpoint 真实可达时才启用 iOS 控制能力；默认自动探测 `http://localhost:8100`。
  5. crash log 采集待实现。
  6. 当前已接入电量采样，更完整性能采集待实现。
  7. iOS 视频录制待实现，Runner 会记录 `video_unavailable`。
- 验证方式：单元测试覆盖能力模型、设备解析、WDA endpoint 解析和 WDA tap 请求链路；WDA 控制、iOS 录制执行报告需在 WDA 可用真机上手动验证。

## Phase 6：稳定性、扩展和集成

### T-025：实现多设备并发执行

- 状态：todo
- 关联需求：REQ-018、REQ-019
- 关联设计：DES-012、DES-016
- 目标平台：Android + iOS
- 修改边界：runner、report
- 任务内容：
  1. 支持一个用例选择多台设备。
  2. 每台设备独立 Run 或 Run 子任务。
  3. 报告按设备聚合。
  4. 设备锁互不影响。
- 验证方式：两台设备并发执行结果正确。

### T-026：实现报告导出与 CI API

- 状态：in-progress
- 关联需求：REQ-020
- 关联设计：DES-020
- 目标平台：Backend
- 修改边界：report export、CLI/API
- 任务内容：
  1. HTML 报告导出。
  2. CLI 触发执行。
  3. API 轮询 Run 状态。
  4. CI 失败码策略。
- 验证方式：命令行触发用例并下载报告。

### T-027：实现数据清理策略

- 状态：in-progress
- 关联需求：REQ-014、REQ-023
- 关联设计：DES-017
- 目标平台：Backend
- 修改边界：storage、artifact cleanup
- 任务内容：
  1. 按天数清理历史 Run。
  2. 按磁盘空间清理附件。
  3. 删除报告时清理关联文件。
  4. 提供清理配置。
  5. Run 完成并生成报告后保留执行视频 artifact，不按通过 / 失败即时删除。
  6. 执行视频按保留周期、手动删除 Run 或最大空间策略清理。
- 验证方式：清理后数据库和文件系统一致；保留期内成功、失败视频均可从报告访问，清理后报告展示已清理状态。

### T-028：扩展断言能力

- 状态：in-progress
- 关联需求：REQ-007、REQ-024
- 关联设计：DES-009
- 目标平台：Android + iOS
- 修改边界：step model、runner、dashboard
- 任务内容：
  1. 图像断言：待实现。
  2. OCR 文本断言：已实现第一版，支持 `contains` / `equals` / `not_contains`；OCR 后端已升级为可选 RapidOCR HTTP 服务、PaddleOCR HTTP 服务、Tesseract、macOS Vision 兜底，`OCR_ENGINE=auto` 默认按 RapidOCR -> PaddleOCR -> Tesseract -> macOS Vision 尝试。
  3. 断言失败报告：已实现第一版，步骤结果展示 expected / actual / reason / screenshot evidence。
  4. 断言步骤编辑 UI：已实现每步 `expectations` 编辑；独立 `assert_*` 动作步骤和截图区域圈选待实现。
- 验证方式：断言成功和失败都能正确反映到报告；本机无 Tesseract 时仍可通过 macOS Vision OCR 执行文字预期。

### T-029：实现测试基础设施

- 状态：in-progress
- 关联需求：REQ-025
- 关联设计：DES-023
- 目标平台：Shared + Backend + Web Dashboard
- 修改边界：test-support、package scripts、测试配置
- 任务内容：
  1. 配置 Vitest。
  2. 配置 React Testing Library。
  3. 预留 Playwright 配置。
  4. 实现 Mock Driver。
  5. 实现测试 fixtures 和 builders。
  6. 配置统一测试命令 `pnpm test`、`pnpm test:unit`、`pnpm test:e2e`。
- 验证方式：空工程或最小样例测试可通过。

### T-030：实现核心回归测试集

- 状态：in-progress
- 关联需求：REQ-025
- 关联设计：DES-023
- 目标平台：Shared + Backend + Web Dashboard
- 修改边界：shared、runner-core、report-core、dashboard tests
- 任务内容：
  1. Step schema 测试。
  2. 坐标转换测试。
  3. Runner 状态机测试。
  4. 失败策略测试。
  5. Device lock 测试。
  6. Recorder 生成步骤测试。
  7. Report HTML 生成测试。
  8. Dashboard 关键组件测试。
  9. Mock Driver 端到端主流程测试。
- 验证方式：改动核心逻辑后运行 `pnpm test` 能防止已验证主流程回退。

## Phase 7：包管理与手动冒烟

### T-031：实现 Build Registry 基础模型

- 状态：todo
- 关联需求：REQ-026
- 关联设计：DES-024
- 目标平台：Backend + Storage
- 修改边界：storage、shared model、build API
- 任务内容：
  1. 新增 apps、app_builds、app_install_records 表。
  2. 定义 App、AppBuild、AppInstallRecord schema。
  3. 实现包登记、查询、删除或软删除。
  4. 支持 SMB 路径、本地 APK 路径或上传文件登记。
  5. 计算文件大小和 sha256。
  6. 支持 `versionName + buildNumber + commitId` 构建唯一性校验。
- 验证方式：Build Registry CRUD 和 schema 测试通过。

### T-032：实现 Android APK 解析与安装

- 状态：todo
- 关联需求：REQ-026、REQ-017
- 关联设计：DES-024、DES-005
- 目标平台：Android
- 修改边界：android-driver、build API、run config
- 任务内容：
  1. 解析 APK package name、versionName、versionCode、minSdk。
  2. 支持安装 APK 到指定设备。
  3. 支持卸载目标 App。
  4. 支持执行前覆盖安装。
  5. 支持执行前清理 App 数据。
  6. 安装后校验设备上目标 App 版本。
- 验证方式：真实 Android 设备上 APK 安装、卸载、版本校验成功；Mock Driver 测试覆盖失败路径。

### T-033：实现测试计划模型与手动冒烟

- 状态：todo
- 关联需求：REQ-027、REQ-029
- 关联设计：DES-025、DES-027
- 目标平台：Backend + Dashboard
- 修改边界：plan API、dashboard plan pages、runner
- 任务内容：
  1. 新增 TestPlan 模型。
  2. 新增 SmokeSuite 模型。
  3. 支持创建冒烟计划。
  4. 支持计划关联用例 / Flow、设备组、目标包和执行配置。
  5. 支持 required 用例、允许失败数、required-only 通过条件。
  6. 支持用例顺序 shuffle 和用例池 sampling。
  7. 不默认支持单个用例内部步骤乱序。
  8. 支持用户手动选择包发起冒烟。
  9. 报告展示包信息、计划信息和冒烟结论。
- 验证方式：选择 APK、设备和冒烟计划后可完成一次手动冒烟并生成报告。

## Phase 8：步骤预期、断言与性能基线

### T-049：实现步骤级预期验证第一版

- 状态：in-progress
- 关联需求：REQ-009、REQ-027、REQ-028、REQ-029、REQ-034
- 关联设计：DES-012、DES-025、DES-026、DES-034
- 目标平台：Android first，iOS follow-up
- 修改边界：shared model、runner-core、server runner、dashboard step editor、report-core
- 任务内容：
  1. [done] 为 ActionStep 增加 `expectations` 和 `StepExpectationResult` 模型。
  2. [done] 支持 `text`、`image`、`app_alive`、`no_crash`、`screen_changed`、`metric_below`、`log_not_contains` 等预期类型的 schema。
  3. [done] Dashboard 步骤编辑器支持为每一步添加、编辑、删除第一批可执行预期：`text`、`no_crash`、`app_alive`、`screen_changed`、`metric_below`、`log_not_contains`。
  4. [partial] 已支持手动输入 OCR 文本预期；录制时自动生成 P0/P1 预期、从步骤 after 截图圈选区域生成 OCR 文本预期或图像预期仍待实现，图像基准图首次生成时进入 pending_review。
  5. [todo] 支持常用自然语言模板生成候选预期，必须用户确认后才保存为结构化 `expectations`。
  6. [done] Runner 执行动作后验证该步骤所有 expectations，记录 expected、actual、status、reason 和 evidence artifacts。
  7. [partial] 报告展示每一步的预期、实际、验证状态、失败原因、截图、日志和视频时间点；OCR 结果已进入 actual，图像差异待图像能力接入。
  8. [done] 为 RunConfig 增加起始状态配置，支持 `keep_current`、`go_home`、`launch_app`、`restart_app`、`clear_data_and_launch`。
  9. [done] 支持 Setup 执行时机：整次 Run 前执行一次，或 repeat/loop 每轮执行前执行。
  10. [done] 录制时自动为动作步骤生成 `no_crash`、`app_alive`；对可能改变画面的动作生成 `screen_changed`，OCR / 图像候选先作为建议项，不默认强制启用。
  11. [done] 为候选预期记录来源、可靠性级别、默认启用策略和生成原因，并在步骤编辑器里允许用户确认、禁用或删除。
  12. 为关键步骤预留 `stateGuards.before`、`stateGuards.after`，并支持 App 状态锚点和截图区域锚点，作为执行前定位和恢复机制。
  13. 保留 raw `tap` / `swipe` / `input_text` 的原有回放能力，作为 fallback。
- 验证方式：
  1. Mock Driver 覆盖预期通过、预期失败、预期 unsupported、OCR 通过/失败/不可用、起始状态成功/失败；图像 pending_review 待后续能力接入后补齐。
  2. Android 真机手动验证一个包含点击、输入、滑动的流程，新录制步骤自动带出 `no_crash` / `app_alive` 和必要的 `screen_changed`，并能在报告中看到 expected / actual。
  3. [done] `pnpm test:unit` 覆盖 schema、Runner 状态机、预期验证和报告状态展示。

### T-050：实现语义定位录制与步骤修复第一版

- 状态：in-progress
- 关联需求：REQ-005、REQ-006、REQ-007、REQ-009、REQ-016、REQ-028、REQ-034、REQ-035
- 关联设计：DES-009、DES-010、DES-012、DES-026、DES-034、DES-035
- 目标平台：Android first，iOS follow-up
- 修改边界：shared model、android-driver、server runner、dashboard step editor、report-core
- 任务内容：
  1. 收敛 Dashboard 步骤操作区：移除每个步骤上的“条件”快捷按钮，改为“插入步骤”菜单中的“看到文字则点击，否则跳过”。
  2. 在步骤编辑器中区分并展示目标类型：坐标、元素、文字、图像 / 区域、条件分支。
  3. [partial] 为 ActionStep 增加语义目标 schema：已加入 `tap_on_element`、`tap_on_text`、`tap_on_image`、`tap_if_text`，并保留 coordinate fallback；直接动作转换会拒绝未解析的语义步骤，避免误执行。
  4. [partial] Android Driver 提供 UIAutomator hierarchy 获取能力，并根据点击坐标查找最小可点击 / 有意义控件；当前已改为 `uiautomator dump --compressed` 优先，避免部分设备普通 dump 退出 137 导致无法识别 resourceId / desc。
  5. [partial] 录制 tap / long_press 后生成元素目标候选，候选包含 locator、bounds、confidence、生成原因和 fallback 坐标；当前录制点击会先用后台 element snapshot，缓存未命中时再调用实时 `element-at`，并已修复 hierarchy 只裁掉系统栏时点击点被错误缩放的问题，仍无法识别才保留坐标兜底。
  6. [partial] 当元素候选不足时，基于点击点附近 OCR 生成文字目标候选；当前已有后台 OCR snapshot 兜底，实时 OCR 和低置信候选确认待补。
  7. 支持用户从截图中圈选区域，生成 OCR region、image baseline 或区域点击目标候选。
  8. Runner 支持 `tap_on_text`：截图 OCR 后点击匹配文字区域中心；未找到时记录 `semantic_target_not_found`。
  9. Runner 支持 Android `tap_on_element`：查找 locator 并点击 bounds 中心；未找到时按 failurePolicy 处理。
  10. Runner 支持 semantic target fallback：使用坐标 fallback 时必须在 StepResult metadata 中记录。
  11. 报告展示语义目标描述、定位结果、fallback 使用情况、失败截图和修复入口。
  12. iOS 暂不强制实现语义定位；WDA / Appium source 稳定后补 iOS element target。
- 验证方式：
  1. 单元测试覆盖候选评分、UI hierarchy 坐标命中、OCR 文字目标转换、semantic target schema 校验。
  2. Runner 测试覆盖 `tap_on_text` 命中 / 未命中、`tap_on_element` 命中 / 未命中、coordinate fallback。
  3. Dashboard 测试覆盖插入步骤菜单、目标类型展示、条件分支文案和 raw 坐标提示。
  4. Android 真机手动验证：录制点击后至少能生成一个元素或文字候选，并能用语义目标回放。

### T-034：实现结构化断言第一版

- 状态：partial
- 关联需求：REQ-028
- 关联设计：DES-026
- 目标平台：Shared + Runner + Report
- 修改边界：ActionStep schema、runner、report-core、dashboard step editor
- 任务内容：
  1. 新增 `assert_app_alive`。
  2. 新增 `assert_no_crash`。
  3. 新增 `assert_metric_below`。
  4. 新增 `assert_text` 参数 schema：region、expected、mode、ocrEngine。
  5. 新增 `assert_image` 参数 schema：region、baselineArtifactId、threshold。
  6. Dashboard 支持编辑断言步骤。
  7. 报告展示断言预期值、实际值和失败证据。
  8. 实现自然语言期望的规则模板解析，不接入大模型。
  9. 模板解析结果必须经过用户确认后才保存为结构化断言。
- 验证方式：断言成功、断言失败、平台不支持三类场景测试通过。

### T-035：实现 Flow 导入导出

- 状态：todo
- 关联需求：REQ-027、REQ-028
- 关联设计：DES-025、DES-026
- 目标平台：Backend + Dashboard
- 修改边界：case/flow API、shared schema、dashboard editor
- 任务内容：
  1. 将当前 TestCase 步骤导出为平台 JSON Flow。
  2. 支持导入平台 JSON Flow。
  3. 预留 YAML Flow 导入导出格式。
  4. 导入时校验动作、断言、变量和平台能力。
- 验证方式：录制流程可导出、重新导入、执行结果一致。

### T-036：实现性能基线比较

- 状态：todo
- 关联需求：REQ-030
- 关联设计：DES-028
- 目标平台：Backend + Report
- 修改边界：metrics collector、storage、report-core、dashboard report UI
- 任务内容：
  1. 按 app、build、plan、flow、device 记录性能摘要。
  2. 自动选择同设备、同流程最近一次 passed run 作为默认基线。
  3. 支持手动选择基线。
  4. 报告展示两个版本并排指标、绝对变化值和百分比变化。
  5. 当前阶段不自动判定劣化，不自动阻断流程。
  6. 预留绝对阈值和相对劣化阈值配置入口。
- 验证方式：构造两次执行后，报告页可并排展示两个版本指标；不会因指标变化自动失败。

## Phase 9：自动触发、通知与探索

### T-037：实现自动触发和通知第一版

- 状态：todo
- 关联需求：REQ-031
- 关联设计：DES-029
- 目标平台：Backend
- 修改边界：job scheduler、webhook API、notification service
- 任务内容：
  1. 新增 AutomationJob 队列。
  2. 支持 `POST /api/builds` 接收 CI/CD 构建信息。
  3. 支持 API 触发测试计划。
  4. 支持 cron 定时任务触发。
  5. 支持 Webhook 通知。
  6. 实现企业微信 Markdown 通知适配。
  7. 通知内容包含包、计划、结果、失败摘要、版本性能摘要和报告链接。
- 验证方式：API 触发后任务进入队列并执行；失败后发送企业微信 / Webhook 通知。

### T-038：设计并 PoC 可控随机探索

- 状态：todo
- 关联需求：REQ-032
- 关联设计：DES-030
- 目标平台：Android first
- 修改边界：runner、exploration engine、report-core
- 任务内容：
  1. 定义 ExplorationConfig。
  2. 支持从固定流程结束状态开始探索。
  3. 支持 seed、最大时长、最大动作数。
  4. 记录探索动作序列。
  5. 失败后可把探索路径导出为 Flow。
  6. 报告展示探索路径和失败证据。
- 验证方式：同一 seed 在同一设备配置下生成可复现动作序列；crash 时保留路径、截图、日志和视频。

### T-039：实现 SMB 拉包服务

- 状态：todo
- 关联需求：REQ-026、REQ-029
- 关联设计：DES-024、DES-031
- 目标平台：Backend
- 修改边界：build download service、storage、env config
- 任务内容：
  1. 支持配置 SMB 连接和目录模板。
  2. 支持按文件名规则解析 versionName、buildNumber、branch、channel。
  3. 支持把 SMB 文件下载到 `<DATA_DIR>/builds/`。
  4. 下载完成后计算 sha256 并更新 AppBuild 状态。
  5. 下载失败时记录 errorMessage，不影响已有构建。
- 验证方式：给定 SMB 路径或 mock SMB 下载源，能创建 ready 状态 AppBuild。

### T-040：实现 CI/CD Webhook 接包

- 状态：todo
- 关联需求：REQ-026、REQ-029、REQ-031
- 关联设计：DES-024、DES-027、DES-029
- 目标平台：Backend
- 修改边界：build API、job scheduler、runner
- 任务内容：
  1. 新增 `POST /api/builds`。
  2. 接收 appId、version、buildNumber、branch、commitId、downloadUrl、triggerSmoke、smokeSuiteId、deviceIds。
  3. 自动匹配 App 并创建 AppBuild。
  4. 支持触发下载和元信息解析。
  5. triggerSmoke=true 时按套件和设备创建冒烟任务。
  6. 返回 buildId 和可选 runId。
- 验证方式：curl 调接口后平台创建 AppBuild，符合规则时自动生成冒烟 Run。

### T-041：实现企业微信通知服务

- 状态：todo
- 关联需求：REQ-031
- 关联设计：DES-029
- 目标平台：Backend
- 修改边界：notification service、run lifecycle、suite config
- 任务内容：
  1. 支持企业微信 Webhook URL 配置。
  2. 支持多个 Webhook URL。
  3. 实现新包接入通知。
  4. 实现冒烟通过通知。
  5. 实现冒烟失败通知。
  6. 实现手动套件完成通知开关。
  7. 通知失败写入事件，不改变 Run 结果。
- 验证方式：Mock Webhook 接收到正确 Markdown 消息；通知失败时报告中有事件记录。

### T-042：实现 Dashboard 包管理页

- 状态：todo
- 关联需求：REQ-026
- 关联设计：DES-024、DES-031
- 目标平台：Web Dashboard
- 修改边界：dashboard apps/builds pages、build API
- 任务内容：
  1. App 列表页。
  2. App 详情页和版本历史。
  3. 手动创建 App。
  4. 手动上传或登记 APK / SMB 路径。
  5. 对指定设备安装 / 卸载版本。
  6. 展示 AppBuild 下载、解析、安装、版本校验状态。
  7. 失败时展示结构化错误码、错误描述和最近一次安装记录。
- 验证方式：用户可在 UI 上注册 App、查看版本列表、安装 APK 到设备。

### T-043：实现 Dashboard 冒烟套件管理页

- 状态：todo
- 关联需求：REQ-027、REQ-029
- 关联设计：DES-025、DES-027
- 目标平台：Web Dashboard
- 修改边界：dashboard suite pages、suite API
- 任务内容：
  1. 冒烟套件列表页。
  2. 套件编辑页。
  3. 选择用例、required 标记和顺序。
  4. 配置设备、分支触发规则、cron、通知 Webhook。
  5. 配置 shuffle_cases / sampling。
  6. 手动触发并查看执行进度。
- 验证方式：用户可在 UI 上创建套件、绑定用例和设备，并手动触发执行。

### T-044：实现 assert_text OCR 断言

- 状态：todo
- 关联需求：REQ-028
- 关联设计：DES-026、DES-032
- 目标平台：Backend + Android first
- 修改边界：runner、assertion service、report-core
- 任务内容：
  1. [done] 集成本地 OCR 引擎，默认可替换 `OcrService`；当前支持 RapidOCR HTTP、PaddleOCR HTTP、Tesseract、macOS Vision。
  2. [todo] 支持对截图指定 region 做 OCR。
  3. [done] 支持 contains、equals、not_contains。
  4. [done] 报告展示 OCR 原始结果和匹配状态。
  5. [done] OCR 失败时返回明确 unsupported 或 failed 原因。
- 验证方式：Mock OCR 覆盖包含目标文字、文本不匹配和 OCR 不可用；中文识别风险在报告中可解释，真机 OCR 质量待人工验收。

### T-045：实现 assert_image 基准图与差异图

- 状态：done
- 关联需求：REQ-028
- 关联设计：DES-026
- 目标平台：Backend + Web Dashboard
- 修改边界：runner、artifact service、report UI
- 任务内容：
  1. [done] 首次执行生成 pending_review 结果，并把当前截图作为待审证据。
  2. [done] 新增确认基准图 API：`POST /api/artifacts/:id/approve-baseline` 可把 artifact 写回指定用例步骤的 image expectation。
  3. [done] 有 `baselineArtifactId` 后执行相似度对比，支持 region 裁剪。
  4. [done] 失败时生成 diff summary artifact；可视化 diff 图进入报告增强后续项。
  5. [done] 报告通过 expectation evidence links 展示实际图、基准图和 diff summary；并排三图进入报告增强后续项。
  6. [done] 支持手动更新基准图：再次调用 approve-baseline 会覆盖 expectation 的 `baselineArtifactId`；完整 supersede 历史状态进入后续基准管理项。
- 验证方式：首次执行 pending，确认后再次执行进行对比；失败时生成差异图。

### T-046：实现 FPS 和启动耗时采集

- 状态：todo
- 关联需求：REQ-011、REQ-030
- 关联设计：DES-014、DES-028
- 目标平台：Android first
- 修改边界：android-driver、metrics collector、report-core
- 任务内容：
  1. 通过 `dumpsys gfxinfo` 或 SurfaceFlinger 采集 FPS / 帧耗时。
  2. 通过 logcat `Displayed` 关键词解析冷启动耗时。
  3. 存储 fpsAvg、fpsMin、launchTimeMs。
  4. 报告展示版本对比中的 FPS 和启动耗时。
- 验证方式：真实 Android 设备上能采集并展示 FPS / 启动耗时。

## Phase 10：工具化与 AI 导航

### T-047：强化 Action / Flow 元数据与步骤卡片体验

- 状态：todo
- 关联需求：REQ-005、REQ-006、REQ-027
- 关联设计：DES-009、DES-025
- 目标平台：Shared + Backend + Web Dashboard
- 修改边界：ActionStep schema、Flow schema、recording API、step editor
- 任务内容：
  1. 为 ActionStep 增加 source、context、recordedTimestampMs、lastDurationMs。
  2. 为坐标类步骤增加 previewRenderedWidth、previewRenderedHeight、previewOffsetX、previewOffsetY、rotation。
  3. 为滑动 / 拖拽步骤增加 path 采样点，并限制最大点数或做可解释压缩。
  4. 为 TestFlow 增加 RecordingSessionMetadata。
  5. 步骤卡片展示类型图标、类型颜色、序号、关键参数、延迟 / 耗时、最近执行状态。
  6. 执行失败时步骤卡片能直接定位截图、日志和错误原因。
- 验证方式：录制后保存的 Flow 包含会话元数据；步骤卡片能正确展示 click/swipe/input/wait/assert 等类型；坐标转换测试覆盖 preview offset 和 rotation。

### T-048：实现外部工具接口与 .ai 仓库导航

- 状态：todo
- 关联需求：REQ-031、REQ-033
- 关联设计：DES-029、DES-033
- 目标平台：Backend + Docs
- 修改边界：REST API、tool adapter、repo metadata docs
- 任务内容：
  1. 新增 `/api/tooling/context`，返回平台版本、能力、可用工具和主要 API。
  2. 支持取消任务 API：`POST /api/jobs/:id/cancel`。
  3. 设计 MCP / CLI adapter 的工具 schema：list_apps、list_builds、trigger_smoke_run、get_run_status、get_report_link、cancel_job、send_run_notification。
  4. 工具调用全部复用现有 REST API、任务队列、设备锁和通知服务。
  5. 新增 `.ai/repo-profile.yml`，描述仓库定位、技术栈、模块职责、入口和构建测试命令。
  6. 新增 `.ai/context-guide.md`，描述 AI / 新维护者阅读顺序和风险边界。
  7. 校验工具 schema、日志和文档不包含 secret。
- 验证方式：通过 mock tool adapter 可触发一次冒烟任务并查询报告链接；`.ai/` 文件能帮助新 agent 找到 server、dashboard、driver、runner、report 入口。

## Phase 11：工程治理、重构与可维护性

### T-051：Review 治理队列与 Skills 同步

- 状态：done
- 关联需求：REQ-025、REQ-033
- 关联设计：DES-023、DES-033
- 目标平台：Docs + Skills
- 修改边界：tasks、skills/agents、skills/skills、changelog
- 任务内容：
  1. 将 review 中确认合理的问题拆为立即治理队列和功能路线队列。
  2. 同步 skills 当前项目事实：expectations、OCR、`tap_if_text`、Flow start strategy、execution video、语义定位规划。
  3. 明确结构治理、文档同步、测试补洞优先于继续堆功能。
  4. 功能性问题继续按产品价值和依赖关系进入 R/T 队列。
- 验证方式：后续 agent 阅读 skills 时能看到当前能力边界；tasks 中能看到 review 问题的优先级和计划窗口。

### T-052：拆分 StepsPanel 并补组件测试

- 状态：done
- 关联需求：REQ-001、REQ-006、REQ-009、REQ-028、REQ-034、REQ-035
- 关联设计：DES-003、DES-009、DES-011、DES-026、DES-034、DES-035
- 目标平台：Web Dashboard
- 修改边界：dashboard components、dashboard tests、styles
- 任务内容：
  1. [done] 将 `StepsPanel.tsx` 拆为 StepList、StepActions、StepEditor、ExpectationEditor、ConditionEditor、RunConfigDrawer、CaseLibrary 等组件；已拆出 RunConfigDrawer、CaseLibrary、ToolStatusBar、StepList、StepConditionEditor、StepExpectationPanel。
  2. [done] 抽离步骤摘要、条件结果、预期结果渲染等纯函数，并补单元测试；已覆盖起始状态包名判断、执行配置摘要、用例库禁用态、步骤摘要和预期标签。
  3. [done] 组件测试覆盖步骤删除、复制、移动、启用/禁用、插入等待、插入条件分支；已覆盖列表动作入口和条件步骤编辑器静态结构。
  4. [done] 组件测试覆盖 expectation 添加/编辑/删除、OCR 文本预期、condition result 展示；已覆盖文本预期编辑器、OCR 区域输入、预期空态和自动候选标签。
  5. [done] 保持现有录制、保存、回放、暂停、单步执行入口不退化；本轮 Browser 工具不可用，已通过 dashboard/server 探活和全量测试替代验证。
- 验证方式：Dashboard typecheck 通过；组件或单元测试覆盖核心 UI 状态；dashboard/server 探活正常。

### T-053：补齐 Storage 层测试与迁移保护

- 状态：done
- 关联需求：REQ-008、REQ-013、REQ-014、REQ-023、REQ-025
- 关联设计：DES-017、DES-023
- 目标平台：Backend
- 修改边界：server storage、test fixtures、artifact cleanup
- 任务内容：
  1. [done] 为 SQLite schema 初始化和临时 `DATA_DIR` 启动补测试。
  2. [done] 覆盖 cases、steps、runs、step_results、metric_samples、device_events、artifacts 的核心 CRUD。
  3. [done] 覆盖 runs 分页、按状态查询、清理候选查询和 case 保存 / 更新。
  4. [done] 覆盖 artifact 文件写入与 `deleteRun` 清理，确保 DB 记录和文件删除一致。
  5. [done] 为后续 schema migration 预留独立 `storage.test.ts` 测试结构，后续新增迁移时直接追加旧 schema fixture。
- 验证方式：Storage 测试可在临时 DATA_DIR 运行；反复执行不会污染仓库或真实运行数据。

### T-054：拆分 AutomationRunner 职责

- 状态：done
- 关联需求：REQ-009、REQ-010、REQ-012、REQ-013、REQ-014、REQ-028、REQ-034
- 关联设计：DES-012、DES-016、DES-022、DES-026、DES-034
- 目标平台：Backend + runner-core
- 修改边界：automation-runner、runner-core、ocr/evaluator services、report adapter
- 任务内容：
  1. [done] 保留 `AutomationRunner` 的任务编排职责：加载用例、加锁、执行循环、停止/暂停/单步、落库。
  2. [done] 将 expectation evaluation 拆为独立 evaluator，覆盖 text、image、app_alive、no_crash、screen_changed、metric_below、log_not_contains。
  3. [done] 将 `tap_if_text` 条件步骤执行拆成 conditional step executor。
  4. [done] 将截图、视频、artifact、报告生成适配封装成边界服务。
  5. [done] 能下沉到 runner-core 的纯状态机逻辑已放到 runner-core：执行循环、repeat、loop_until_stop、暂停、单步、停止、失败中断、视频策略判断由 runner-core 覆盖。
- 验证方式：现有 automation-runner 测试全绿；新增 evaluator 单测；重构后文件职责和测试边界更清晰。

### T-055：拆分 Android Driver 职责

- 状态：done
- 关联需求：REQ-002、REQ-003、REQ-004、REQ-007、REQ-011、REQ-012、REQ-017、REQ-035
- 关联设计：DES-004、DES-005、DES-015、DES-035
- 目标平台：Android Driver
- 修改边界：android-driver package、android-driver tests
- 任务内容：
  1. [done] 按 discovery、actions、app lifecycle、metrics、logcat events、scrcpy/video、text input 拆分当前单文件；已拆出 `android-parsers.ts`、`android-actions.ts`、`android-metrics.ts`、`android-discovery.ts`、`android-events.ts` 和 `android-video.ts`。
  2. [done] 保留 shell 依赖注入，避免回退到难测试的 private command。
  3. [done] 保持 launch activity 解析、debug/system resolver 过滤、前台验证测试，并新增 parser 级测试覆盖 debug launcher 过滤。
  4. [done] 为 clear app data、recent apps、text input、logcat event watcher 补窄测试；已新增 action / metrics / discovery / events / video 模块窄测试，现有行为测试保持全绿。
  5. [done] 为后续 UIAutomator hierarchy / `tap_on_element` 留出模块边界；动作、发现、事件和视频职责已从 driver 主类隔离。
- 验证方式：android-driver 全量测试通过；真机 smoke 可正常发现设备、启动 App、输入、返回、最近任务和截图。

### T-056：工程规范与测试目录统一

- 状态：todo
- 关联需求：REQ-025
- 关联设计：DES-023
- 目标平台：Repo-wide
- 修改边界：workspace config、tests layout、lint config
- 任务内容：
  1. 制定测试文件放置规范：包内 `tests/` 或 `src/__tests__` 二选一，并写入 guide。
  2. 逐步迁移不一致测试文件，避免一次性大面积无意义移动。
  3. 引入真实 ESLint / Prettier / lint-staged 或等价门禁。
  4. 确认 `pnpm lint` 覆盖 typecheck、lint 和格式检查。
  5. 更新 README 和开发流程说明。
- 验证方式：CI / 本地命令能统一运行；迁移后测试路径清晰，新测试不再随意混放。

### T-057：OCR 工具脚本边界整理

- 状态：todo
- 关联需求：REQ-028、REQ-034
- 关联设计：DES-026、DES-034
- 目标平台：Backend
- 修改边界：server OCR service、tool scripts、packaging docs
- 任务内容：
  1. 评估 `vision-ocr.swift` 是否继续放在 server `src/`，或移动到明确的 tools/resources 目录。
  2. 保证打包、运行和测试时能稳定找到 OCR 脚本。
  3. 文档说明 RapidOCR、PaddleOCR、Tesseract 和 macOS Vision fallback 的依赖、路径和失败提示。
  4. OCR 不可用时继续返回 unsupported，不静默通过。
- 验证方式：OCR 单测通过；本地无 Tesseract 时 RapidOCR / PaddleOCR / Vision fallback 或 unsupported 行为可解释。

### T-058：实现最小 CLI Trigger

- 状态：done
- 关联需求：REQ-020、REQ-031、REQ-033
- 关联设计：DES-020、DES-029、DES-033
- 目标平台：Backend + CLI
- 修改边界：REST API wrapper、package scripts、docs
- 任务内容：
  1. [done] 提供最小 CLI/package script：`pnpm cli -- devices|cases|runs|run|status|report`。
  2. [done] CLI 复用现有 REST API，不绕过设备锁、任务队列和报告生成。
  3. [done] 返回稳定 ID、状态、报告链接和结构化错误。
  4. [done] 文档给出 CI 使用示例；第一版命令帮助内置在 CLI help。
- 验证方式：CLI 单测通过；本地服务下 `pnpm cli -- devices` 和 `pnpm cli -- runs --limit 3` 已跑通。

### T-059：报告性能图表与离线证据体验

- 状态：todo
- 关联需求：REQ-011、REQ-013、REQ-014、REQ-030
- 关联设计：DES-014、DES-016、DES-028
- 目标平台：Report Core + Dashboard
- 修改边界：report-core、artifact service、report UI
- 任务内容：
  1. 报告增加 CPU、内存、电量等基础指标趋势图。
  2. 支持步骤截图、视频时间点、日志和事件之间的快速跳转。
  3. 评估 HTML 离线 bundle：关键截图、视频或缩略证据可随报告导出。
  4. 缺失 artifact 时降级展示，不让报告打不开。
- 验证方式：成功/失败/长流程报告均能打开；性能图表和缺失 artifact 场景有测试覆盖。

## Phase 12：v2 业务图谱、目标节点执行与 AI/CI 验证

### T-071：建立 v1 / v2 兼容迁移护栏

- 状态：done
- 关联需求：REQ-040、REQ-025、REQ-036、REQ-038
- 关联设计：DES-040、DES-023
- 目标平台：Backend + Dashboard + Test Support
- 修改边界：测试基线、API 兼容约束、迁移适配层规划
- 任务内容：
  1. 明确 v1 legacy flow 的兼容清单：设备列表、Android 预览控制、录制、保存用例、回放执行、执行中状态、每步截图、执行视频、HTML 报告。
  2. 为 v1 主流程补或确认 Mock Driver 集成测试，作为后续 v2 改动的回归门禁。
  3. 约定 `/api/cases`、`/api/runs`、legacy report 的兼容边界，新增 graph API 不复用旧语义。
  4. 设计 v1 TestCase / ActionStep 到 CandidateNode / CandidateEdge 的转换适配层接口，但第一步不自动迁移旧数据。
  5. 在 Dashboard 信息架构中保留用例录制、用例库和用例执行入口；图谱入口作为新增模块接入。
  6. 更新开发检查清单：每个 v2 任务完成后必须运行 v1 主流程测试。
- 验证方式：已新增 `legacy-flow-contract.test.ts` 覆盖真实 SQLite Storage + AutomationRunner + Mock Driver 的 legacy flow；`pnpm test:unit` 和 `pnpm lint` 通过；文档记录 v1 API / UI / report 的兼容期和迁移条件。

### T-060：实现 Business Graph 核心模型与存储

- 状态：done
- 关联需求：REQ-036、REQ-040
- 关联设计：DES-036、DES-040
- 目标平台：Shared + Backend
- 修改边界：shared schema、server storage、graph-core package
- 任务内容：
  1. 已新增 `graph-core` 包，定义 BusinessGraph、BusinessGraphVersion、BusinessNode、OperationEdge、StateMatcher、ActionPolicy、RoutePlan、RuntimeOverlay 类型。
  2. 已新增 SQLite 表：business_graphs、business_graph_versions、business_nodes、state_matchers、operation_edges、edge_preconditions、edge_action_policies、edge_expectations、graph_asset_sources、route_plans、route_plan_edges。
  3. 已支持图谱、版本、节点、边、matcher、action policy、precondition、expectation 的基础 CRUD。
  4. 已支持 draft / active / deprecated / rejected 状态和 active graph version 切换。
  5. 已支持 routePlanSnapshot 保存，确保历史报告不依赖当前图谱状态。
  6. 已为 BusinessGraph 增加 `targetApp` 绑定，Android 图谱可持久化真实 package name，iOS 预留 bundle id。
  7. 保持 legacy TestCase / ActionStep schema 不被强制迁移。
- 验证方式：已新增 graph-core route planner 单元测试；storage 测试覆盖创建图谱、保存节点 / 边、版本切换、targetApp 持久化、routePlanSnapshot 持久化；legacy case CRUD 测试仍通过；`pnpm test:unit` 和 `pnpm lint` 通过。

### T-061：实现状态识别与 Observation 管线

- 状态：done
- 关联需求：REQ-036、REQ-038
- 关联设计：DES-036、DES-038
- 目标平台：Backend + Android first
- 修改边界：graph-core、android-driver、server observation service
- 任务内容：
  1. 已在 `graph-core` 定义 Observation、ObservationUiElement、ObservationText、ObservationImageRegion、NodeMatchResult、MatcherResult。
  2. 已在 Android Driver 接入前台 activity / package / component 识别；ObservationService 接入截图、UIAutomator dump、OCR、resolution、orientation、timestamp、event summary。
  3. 已实现 `detectNode`，对 BusinessNode matchers 做加权评分。
  4. 已支持 unknown、multiple_candidates、matched 三类识别结果，并返回命中 / 未命中 matcher、score、候选节点和阈值。
  5. 已新增 `/api/devices/:serial/observation` 和 `/api/graphs/:versionId/detect-node`，供后续 Graph Runner、Dashboard 和 CI/AI 调用。
  6. NodeMatchResult 写入正式报告将在 T-065 Graph Runner 执行结果落库时接入；当前任务已完成采集与识别管线。
- 验证方式：已新增 Mock Observation 测试覆盖 activity / resource-id / text / OCR / image_region 加权命中、unknown 和 multiple_candidates；ObservationService 测试覆盖前台应用、截图元信息、UI tree、OCR boxes 和跳过 OCR；Android parser 测试覆盖前台 package/activity 解析；`pnpm test:unit` 和 `pnpm lint` 通过。

### T-062：实现源码扫描器 PoC

- 状态：done
- 关联需求：REQ-037
- 关联设计：DES-037
- 目标平台：Backend tools + Android first
- 修改边界：source-scanner package、dashboard import UI、graph candidate API
- 任务内容：
  1. 已新增 `source-scanner` 包，提供 AndroidSourceScanner / scanAndroidSource 接口。
  2. 已支持 Android first 扫描 AndroidManifest、Navigation XML、layout XML、strings.xml、Kotlin / Java 源码。
  3. 已识别 Activity / Fragment / layout / route、resource-id、文本文案，生成 draft CandidateNode 和 StateMatcher。
  4. 已尝试识别 navigation action、deeplink、navigate、startActivity、setOnClickListener / onClick，生成 draft CandidateEdge 和候选 ActionPolicy。
  5. 候选资产已记录 source file、line、confidence 和 source_scan 来源。
  6. 已新增 `/api/source-scan/android` 后端预览接口，输入 appId + repoPath 返回候选图谱 JSON。
  7. 已把默认扫描上限提升到适配大型 Android 工程的 20000 个相关文件，并保留上限告警，防止误选超大目录时卡死。
  8. Dashboard 候选结果只读预览、确认、合并、拒绝入口并入 T-063 图谱候选资产 Review 与合并。
- 验证方式：已新增 fixtures Android 项目扫描测试，覆盖 Manifest、Navigation XML、Layout XML、strings、Kotlin navigate；不写入业务源码；候选资产默认 draft；旧 legacy flow 护栏仍通过；`pnpm test:unit` 和 `pnpm lint` 通过。

### T-063：实现图谱候选资产导入、治理与合并

- 状态：in-progress
- 关联需求：REQ-036、REQ-037
- 关联设计：DES-036、DES-037
- 目标平台：Web Dashboard + Backend
- 修改边界：graph API、dashboard graph pages
- 任务内容：
  1. 已新增业务图谱模块入口和源码扫描候选预览页面，展示候选节点、候选边、来源、置信度和扫描统计。
  2. 已支持服务端配置源码根目录，并在 Dashboard 通过源码根 / 子目录选择路径；手动输入仍作为兜底。
  3. 已支持从扫描结果导入为 draft BusinessGraphVersion，导入时写入候选节点、matcher、可解析 from/to 的候选边和 ActionPolicy。
  4. 已修复重复导入同一扫描候选时复用候选 id 导致 `state_matchers.id` 唯一键冲突的问题；候选 id 只作为 metadata 保留，持久化 id 新生成。
  5. 已修复候选页面固定高度导致配置区被挤压的问题，让候选节点 / 候选边列表占满主工作区剩余高度。
  6. [done] 已新增运行期候选资产治理区和 `GET /api/graphs/:versionId/assets`：展示 `runtime-discovered` 草稿节点、`source=exploration` 草稿边、`route-gap-exploration` artifact，帮助定位系统卡在哪个页面、识别到哪些文本 / resourceId、建议补哪条边；draft 资产默认不参与 RoutePlanner。
  7. [done] 已支持手动晋级 draft node / draft edge 为 active，晋级后 RoutePlanner 才会把它纳入正式路径计算。
  8. [partial] 已新增保守自动晋级策略雏形：runtime 节点需要 observationCount 达阈值且有 critical matcher；exploration 边需要 reliabilityScore 达阈值、具备 artifact 证据且 from/to 节点均为 active。后续接 T-074 的真机验证评分和异常队列。
  9. 后续补候选节点 / 边自动去重、冲突分组、重命名和补充 matcher / expectation。
  10. 后续补异常治理队列：只展示低置信、冲突、不可达和无法自动验证的候选。
  11. 后续补 active 图谱版本发布，发布前读取 T-074 的自动验证评分。
  12. 第一版采用列表 + 详情，不做复杂画布。
- 验证方式：已新增 Storage 导入测试、重复导入测试、源码根目录边界测试和 Dashboard 图谱模块静态渲染测试；`graph-assets.test.ts` 覆盖 runtime 草稿节点、exploration 草稿边、route-gap artifact 摘要和自动晋级选择策略；`storage.test.ts` 覆盖节点 / 边 lifecycle 状态更新；`GraphCandidatesPanel.test.ts` 覆盖候选资产治理展示和晋级入口；`pnpm test:unit` 和 `pnpm lint` 通过。完成态仍需验证自动验证通过的候选节点晋级成 active 节点，并合并重复节点。

### T-072：实现 SourceWorkspace 与 SourceProvider 多源扫描

- 状态：frozen
- 关联需求：REQ-037
- 关联设计：DES-037
- 目标平台：source-scanner package + Backend provider adapter
- 修改边界：source workspace、source provider abstraction、dependency discovery、scanner integration
- 任务内容：
  0. 当前冻结说明：该任务属于全局业务图谱上层能力，不再作为当前 StructuredFlow 主线开发项；如后续需要源码能力，应先定义为 Flow 候选状态 / 动作推荐，再重新拆任务。
  1. 抽象 `SourceWorkspace`，支持一个 App 绑定主工程、本地子工程、includeBuild / submodule、远程源码仓库和 artifact 依赖。
  2. 抽象 `SourceProvider`，让扫描器消费统一的 SourceFileRef / SourceSymbolRef，而不是只依赖本地文件系统。
  3. 保留 `LocalSourceProvider` 作为默认 provider，支持本机源码目录和 CI workspace。
  4. 新增通用 `SourceIndexProvider`，通过可插拔源码索引服务获取远程仓库文件、符号、调用关系和跨仓上下文，用于本地 artifact / 远程模块缺源码时补齐候选图谱来源。
  5. 新增 `ArtifactProvider` PoC，解析 Android AAR / Maven cache / iOS framework 中可用的 manifest、res、R.txt、navigation XML、Info.plist、storyboard、strings 或有限符号线索，并在结果中明确低置信度。
  6. Android workspace discovery 读取 Gradle settings、includeBuild、submodule、version catalog、Maven / AAR 坐标。
  7. iOS workspace discovery 读取 `.xcodeproj` / `.xcworkspace`、Package.swift、Podfile、Cartfile、project.pbxproj、Info.plist。
  8. 候选资产必须记录 provider、repo、branch、module、artifact、file、line、symbol 和 confidence，且仍进入候选池和自动验证流程。
- 验证方式：fixtures 覆盖 local provider；mock source index provider 覆盖跨仓源码补齐；artifact fixture 覆盖仅资源可见时的低置信候选；重复导入和 legacy flow 测试仍通过。

### T-073：实现 iOS SourceScanner MVP

- 状态：frozen
- 关联需求：REQ-037
- 关联设计：DES-037
- 目标平台：source-scanner package + Backend + Dashboard
- 修改边界：ios source scanner、source scan API、dashboard platform selector
- 任务内容：
  0. 当前冻结说明：该任务属于源码扫描建图实验能力；iOS 当前优先补 WDA 控制、元素定位和 StructuredFlow 执行，不推进 iOS 全局图谱扫描。
  1. 新增 `IosSourceScanner`，与 Android scanner 输出同一 CandidateNode / CandidateEdge / StateMatcher / ActionPolicy 模型。
  2. 扫描 Info.plist、AppDelegate / SceneDelegate、UIViewController、Storyboard / XIB、SwiftUI NavigationStack / NavigationLink、Coordinator / Router、URL scheme / universal link、Localizable.strings、accessibilityIdentifier。
  3. Dashboard 源码扫描页增加平台选择，Android / iOS 调用统一 source scan API，未支持能力显示 capability warning。
  4. iOS 候选 matcher 优先使用 bundle id、view controller、accessibilityIdentifier、label / title、route / deeplink。
  5. iOS 候选动作策略优先使用 accessibility id / label，坐标只作为 fallback。
- 验证方式：fixtures iOS 项目覆盖 Info.plist、Storyboard、SwiftUI、UIKit route、Localizable.strings；Dashboard 静态渲染覆盖平台选择；Android 扫描回归仍通过。

### T-074：实现候选图谱自动验证与自动晋级

- 状态：frozen
- 关联需求：REQ-036、REQ-037、REQ-038
- 关联设计：DES-036、DES-037、DES-038
- 目标平台：Backend + graph-runner + Dashboard
- 修改边界：candidate validation job、confidence scoring、promotion policy、exception queue
- 任务内容：
  0. 当前冻结说明：候选图谱自动验证与晋级属于重型图谱治理上层能力；当前主线不再要求维护者或系统治理全局图谱候选。
  1. 新增 CandidateValidationJob，对候选节点 / 边生成可验证路径或最小验证任务。
  2. 在真机 / 模拟器上执行验证，采集 before / after Observation、截图、UI tree / WDA source、OCR、日志、crash / ANR / hang、动作结果和耗时。
  3. 实现置信度评分：source_signal、runtime_pass_rate、matcher_stability、transition_stability、fallback_penalty、cross_device_coverage、cross_version_stability、health_guard、evidence_completeness。
  4. 高置信候选自动晋级到待发布 active 版本；中置信候选继续自动补跑验证；低置信、冲突、不可达、重复疑似进入异常治理队列。
  5. Dashboard 只要求人工处理异常队列，不要求逐条 review 所有扫描候选。
  6. 所有自动晋级必须保留验证证据、评分明细和可回滚记录。
- 验证方式：Mock Driver 覆盖高置信自动晋级、中置信继续验证、低置信进入异常队列、冲突候选不晋级；真实 Android 跑一次小图谱验证；legacy run 回归仍通过。

### T-064：实现 Route Planner MVP

- 状态：done
- 关联需求：REQ-038
- 关联设计：DES-038
- 目标平台：graph-core + Backend
- 修改边界：graph-core route planner、run API
- 任务内容：
  1. 已实现 BFS 路径规划，从 startNode 或 rootNode 到 targetNode。
  2. 已过滤非 active 节点 / 边和当前平台不支持的边。
  3. 已检测不可达、缺 matcher、缺 action policy，并生成 RoutePlanIssue。
  4. 已生成 RoutePlan、RoutePlanSnapshot 和 ExecutionPlan；ExecutionPlan 将每条 OperationEdge 展开为可执行步骤，包含前置条件、ActionPolicy、后置预期和默认系统守护。
  5. 已实现 TargetResolver，支持不用大模型、通过 nodeId / key / name / text / tags / intent 将结构化目标解析为目标节点；歧义时返回候选，不自动猜测。
  6. 已新增 `/api/graphs/:versionId/route-plan`，支持 `targetNodeId` 或结构化 `target` 请求，返回 routePlan + executionPlan。
  7. 已要求 RoutePlan 必须携带 targetApp；缺少 Android package name / iOS bundle id 时返回阻断错误。
  8. 已禁止正式图谱选择坐标-only 动作作为主动作；坐标只能作为 legacy 或 fallback，缺少语义动作时返回 `UNSTABLE_COORDINATE_ACTION`。
  9. 已确认 ExecutionPlan 自动组装每步业务预期：来源节点默认预期 + 边前置条件，边后置预期 + 目标节点默认预期。
- 验证方式：graph-core 单元测试覆盖目标解析、可达路径、不可达、平台过滤、缺动作策略、缺 targetApp、坐标-only 阻断、语义动作优先、ExecutionPlan 预期组装；server typecheck 通过；API 可返回路径预览和执行计划。

### T-065：实现 Graph Runner MVP

- 状态：in-progress
- 关联需求：REQ-038、REQ-040
- 关联设计：DES-038、DES-040
- 目标平台：Backend + runner-core
- 修改边界：graph-runner package、automation-runner adapter、report-core
- 任务内容：
  1. 已在 `runner-core` 新增纯 GraphRunner 内核，消费 ExecutionPlan，不依赖 Android / iOS / scrcpy 具体实现。
  2. 已支持每条边执行前采集 Observation、识别当前节点并校验 fromNode。
  3. 已按 selected ActionPolicy 执行动作，并保留 usedActionPolicyId / fallbackActionPolicyId 结果字段。
  4. 已支持执行后识别 toNode，并验证 edge / node expectations 和默认 system guards。
  5. 已支持失败 phase：precondition、action、state_transition、expectation、system_guard、device。
  6. 已支持 ExecutionPlan 存在阻断错误时直接 blocked，不进入执行。
  7. 已接入真实设备 GraphRunner Adapter：复用 ObservationService、SemanticStepResolver、StepExpectationEvaluator、RunArtifactService 和 report-core。
  8. 已修正状态识别消歧：当宽泛页面节点和具体业务状态同时满分命中时，优先证据权重更高的具体状态，避免“首页壳”压过“教师班级列表 / 发布活动浮层”。
  9. [done] 内置图谱已从“ClassIn 教师新建课堂业务图谱”升级为 `classin-android` / `ClassIn Android 业务图谱` 的 App 级总图谱；“新建课堂”作为总图谱中的一个目标节点 / 目标路径存在。旧 `classin-android-teacher-create-lesson` 图谱在启动时标记为 deprecated，避免面板继续把子流程误认为主图谱。
  10. [done] 已新增 ClassIn 新建课堂目标路径基础数据：启动边绑定到教师班级列表，发布活动建模为 `business_state`，动作策略使用 text/resource-id 语义定位，不使用坐标主动作。
  11. [done] GraphRunService 已支持第一版真实偏离恢复：当后置状态偏离到可识别的已知节点，且边配置 `failurePolicy.recoverTo=replan` 时，最多自动重规划 1 次，从实际节点继续规划到原目标节点并执行。
  12. [done] 已接入 Runtime Interceptor 第一版：GraphRunService 在每次图谱观测前自动识别并处理常见阻塞文案（允许 / 知道了 / 稍后 / 跳过 / 取消），处理后重新观测当前边；每次最多处理 2 轮，避免弹窗循环。
  13. [done] Runtime Interceptor 处理记录已写入 step `metadata.graph.interceptors`，并在 HTML 报告和 Dashboard 图谱运行详情中展示“运行时清障”。
  14. [done] Dashboard 图谱信息页已展示 App 级图谱的节点和边结构，并默认隐藏 deprecated 旧子图和无 active version 的空草稿图谱。
  15. 后续报告展示 matcher 逐项命中、动作策略完整参数和恢复链路质量趋势。
  16. Graph Runner 不改变 AutomationRunner 对 legacy ActionStep 的执行语义；但后续录制回放模块应适配 BusinessGraph / OperationEdge / ExpectationSet，而不是让图谱内核迁就旧线性脚本结构。
- 验证方式：runner-core Mock Driver 图谱执行测试已覆盖成功、fromNode 不匹配、action 失败、toNode 未到达、system guard 失败、阻断错误；`graph-run-service.test.ts` 覆盖真实设备适配层的语义动作、设备锁、RuntimeOverlay、replan 偏离恢复、Runtime Interceptor 弹窗处理 / 无弹窗跳过 / 最大轮次限制和 evidence 落库；Android 真机 `ERLDU20115007395` 已执行 `run_ac1c19d6-4b77-44a4-bede-c3213392909a`，从“我是教师班级列表”到“新建课堂页”三条图谱边全部 passed；`pnpm lint` 和 `pnpm test:unit` 通过。

### T-066：实现录制 / 探索转候选图谱

- 状态：partial
- 关联需求：REQ-037、REQ-040
- 关联设计：DES-037、DES-040
- 目标平台：Recorder + Backend + Dashboard
- 修改边界：recorder、exploration engine、graph candidate API
- 任务内容：
  1. [partial] 录制每步前后采集 Observation，并尝试识别 beforeNode / afterNode；当前 Dashboard 录制页使用动作前缓存语义快照构造 before Observation，动作后由服务端按 deviceSerial 采集 after Observation，不阻塞动作下发。
  2. [partial] before/after 均可生成稳定节点时生成 CandidateEdge；当前 `POST /api/graphs/:versionId/recording-assets` 已能生成或复用 fromNode、toNode 和 `source=manual_recording` OperationEdge，并写入 state_is 前置 / 后置预期；已接入 BusinessGraph.targetApp 门禁，非目标 Android package 不写入该 App 图谱。
  3. [partial] after 无法识别时生成 CandidateNode draft，并要求用户补 matcher；当前已支持从已保存 TestCase 生成 draft BusinessGraphVersion，占位节点保留 sourceCaseId/sourceStepId/source params，并支持录制 Observation 生成节点资产；Observation 缺少 package/activity/resource-id/text/OCR 等有效状态信号时会跳过写入，避免生成“未知节点-未知未知”；后续补显式 matcher 修复 UI。
  4. [done] 坐标动作作为 ActionPolicy fallback 保存；语义动作按 `tap_on_element` / `tap_on_text` / `tap_on_image` 保留主动作策略。
  5. [todo] 自动探索生成 CandidateNode / CandidateEdge / BlockingRuleCandidate，并带 seed 和证据。
  6. [done] 原始录制用例继续保留，可继续走 v1 回放；Dashboard 用例库新增“转图谱”入口，转换结果默认 draft，不自动发布 active 图谱。
- 验证方式：`legacy-case-graph.test.ts` 覆盖 legacy 用例转 draft graph、source metadata、系统护栏过滤和坐标 fallback；`CaseLibraryPanel.test.ts` 覆盖“转图谱”入口；`recording-graph-assets.test.ts` 覆盖录制 Observation 生成节点 / 边 / state expectation、坐标动作保守降级、非目标 App package 跳过、状态信号不足跳过；`StepList.test.ts` 覆盖 skipped 资产不显示未知占位；后续补自动探索最大动作数、停止条件和候选冲突治理。

### T-067：实现目标节点执行 API / CLI

- 状态：in-progress
- 关联需求：REQ-038、REQ-039
- 关联设计：DES-038、DES-039
- 目标平台：Backend + CLI
- 修改边界：REST API、CLI、job queue
- 任务内容：
  1. [done] 新增 `POST /api/graph-runs` 第一版，支持 deviceSerial、graphId / graphVersionId、targetNodeId / target query、routeStrategy、startStrategy。
  2. [done] 图谱执行结果先复用 legacy `runs`、`step_results`、artifact 和 HTML report 作为第一版承载；step metadata 保存 graphVersion、edgeKey、from/to node、before/after node match、semantic locator 和 observation 摘要。
  3. [done] CLI 增加 `graph-run`，可通过 `--graph` / `--graphVersion` 和 `--targetKey` / `--targetNode` 触发目标节点执行；已补 `graph-status --run <runId>`、`graph-nodes [--graph <graphId>]`、`graph-report --run <runId>` 语义命令。
  4. [partial] 调用已复用设备锁、执行视频、每步截图、指标采样、事件监听和报告生成；包安装、任务队列、buildId/buildPath 进入 Phase 7/9 后接入。
  5. [done] REST、CLI 和 MCP adapter 已返回并消费结构化 `NodeTestResult`，包含 runId、status、active、target、route、failedAt、reason、reportUrl、evidence 和 actual 汇总；旧的 run、routePlanId、executionPlanId、graphVersionId、targetNodeId 和 targetResolution 继续保留兼容 Dashboard。
  6. [done] 执行前先采集 Observation 并识别当前节点，能从当前状态规划路径；识别失败时才回退到 root 起点。
  7. [done] Dashboard 业务图谱页支持选择 active graph 的目标节点、预览路径并启动“执行到目标”；启动后自动跳到执行详情复用现有报告入口。
  8. [done] 补 `GET /api/graph-runs/:runId` 和图谱专属 report link，返回 status、target、route、failedAt、expectation、截图、视频、日志、failureEvidence 和 graph step metadata，减少调用方解析 legacy run metadata 的成本。
- 验证方式：`graph-run-service.test.ts` 覆盖 Mock targetNode 执行、语义元素定位、设备锁、RuntimeOverlay 和 legacy report evidence；`graph-node-test-result.test.ts` 覆盖 `NodeTestResult` 的失败分类、证据 URL、route 和 actual 汇总；`GraphCandidatesPanel` 测试覆盖目标节点执行入口文案；`cli` 测试覆盖 `graph-run` 请求体、`graph-status`、`graph-nodes`、`graph-report` 请求体和 `NodeTestResult` 输出；`mcp-adapter` 测试覆盖 `triggerNodeTest` / `getRunStatus` 消费 `NodeTestResult`；Android 真机 `run_ac1c19d6-4b77-44a4-bede-c3213392909a` passed；Android 真机 `run_9d704da2-0bb7-491e-969f-6ce2dd8fe9ee` 验证“已在目标节点时只执行目标验证 + RuntimeOverlay 失败证据”；2026-06-12 追加验证：`pnpm exec vitest run platform/apps/server/src/graph-node-test-result.test.ts platform/packages/cli/src/index.test.ts platform/packages/mcp-adapter/src/index.test.ts`、server / cli / mcp-adapter typecheck 通过；`pnpm lint`、`pnpm test:unit` 通过。

### T-068：实现 RuntimeOverlay 动态预期覆盖

 - 状态：done
- 关联需求：REQ-039
- 关联设计：DES-039
- 目标平台：graph-runner + report-core
- 修改边界：RuntimeOverlay schema、expectation evaluator、report UI
- 任务内容：
  1. [done] RuntimeOverlay 支持 nodeExpectationOverrides 和 edgeExpectationOverrides。
  2. [done] 已支持 `text` 动态预期、resource-id / content-desc / className 元素锚点存在检查、`metric_below`、`no_crash`、`app_alive`、`image` 基线断言、图谱 `state_is` 和显式基线版 `performance_not_regressed`。
  3. [done] Overlay 只作用于本次 Run，不写入 active 图谱。
  4. [done] HTML 报告已新增业务图谱执行区，展示 graph default expectations、runtime overlay expectations、system guards 分组，保留 step metadata 供 API / CLI 使用。
  5. [done] 失败返回和 step result 包含 overlay expectation expected / actual、reason、截图证据。
  6. [done] 当当前节点已经是 targetNode 时，ExecutionPlan 自动生成 `target.validation` noop 步骤，不执行动作，只验证目标默认预期、RuntimeOverlay 和系统守卫。
  7. [done] RuntimeOverlay 如果声明 `targetNodeId`，必须与本次请求目标节点一致；不一致时在创建 run 前阻断，避免 AI / CI 把其他节点预期误用于当前目标。
- 验证方式：`graph-core.test.ts` 覆盖 target validation noop plan；`runner-core.test.ts` 覆盖 noop 不发动作、预期失败；`graph-run-service.test.ts` 覆盖 overlay 不污染 active 图谱、已在目标节点时 overlay 失败、`state_is` 动态预期通过、overlay targetNodeId 不匹配时阻断；`step-expectations.test.ts` 覆盖 `performance_not_regressed` 显式基线通过 / 失败；Android 真机 `run_9d704da2-0bb7-491e-969f-6ce2dd8fe9ee` 生成视频、截图、HTML 报告，且只有动态预期失败；2026-06-12 追加验证：`pnpm exec vitest run platform/apps/server/src/graph-run-service.test.ts platform/packages/graph-core/src/graph-core.test.ts platform/packages/cli/src/index.test.ts`、server / graph-core typecheck 通过；`pnpm lint`、`pnpm test:unit` 通过。

### T-069：实现 MCP Adapter 第一版

- 状态：done
- 关联需求：REQ-039、REQ-033
- 关联设计：DES-039、DES-033
- 目标平台：MCP adapter + Backend
- 修改边界：mcp package、tool schema、docs
- 任务内容：
  1. [done] 新增 `@mobile-automation/mcp-adapter` 包，提供 REST-only 工具适配层。
  2. [done] 已提供 `listApps`、`listGraphNodes`、`getNodeDetail`、`triggerNodeTest`、`getRunStatus`、`getReport`、`getFailureEvidence`、`getGraphQuality`。
  2.1 [done] `getGraphQuality` 复用 `GET /api/graphs/:versionId/quality` 获取节点 / 边最近执行质量，供 AI / CI 在触发目标节点前判断路径稳定性。
  3. [done] Adapter 只调用 REST API，不直接访问数据库、不绕过设备锁、任务队列、视频录制、截图、报告生成和失败证据链。
  4. [done] 工具返回结构化 JSON，适合 AI 判断路径失败、预期失败、设备失败、crash / ANR 和性能失败。
  5. [done] 新增 MCP wrapper 描述层：导出 `mobileAutomationMcpTools` 和 `createMobileAutomationMcpToolHandlers()`，把同名工具映射到 REST-only adapter；不承载业务逻辑，不直连数据库 / driver。
  6. [done] 新增 `docs/guides/ai-ci-graph-tools.md`，给出 REST、CLI、MCP adapter 的 Codex / Claude / CI 调用示例。
  7. [done] 新增 MCP tool schema 安全校验，工具定义不暴露 token、secret、password、credential、apiKey 等字段；敏感信息只能通过环境变量或部署 Secret 注入。
  8. [todo] 如需真正 stdio / HTTP MCP server，可在后续部署适配中引入具体 MCP SDK，把现有 tool definitions 和 handlers 注册出去，不新增业务逻辑。
- 验证方式：`mcp-adapter` mock REST client 测试覆盖应用列表、节点列表、节点详情、触发目标节点测试、轮询结果、报告链接、失败证据和图谱质量统计；`mcp-wrapper.test.ts` 覆盖工具定义、schema 不含 secret-like 字段、handler 只调用 REST adapter；2026-06-12 追加验证：`pnpm exec vitest run platform/packages/mcp-adapter/src/index.test.ts platform/packages/mcp-adapter/src/mcp-wrapper.test.ts`、`pnpm --filter @mobile-automation/mcp-adapter typecheck` 通过。

### T-070：实现图谱报告与质量统计

- 状态：in-progress
- 关联需求：REQ-036、REQ-038、REQ-039
- 关联设计：DES-036、DES-038、DES-039
- 目标平台：report-core + Dashboard
- 修改边界：report model、dashboard report pages
- 任务内容：
  1. [done] HTML 报告新增业务图谱执行区，展示 Graph Version、Start Node、Target Node、Graph Steps、RuntimeOverlay、Failed At。
  2. [done] 报告展示规划 / 实际路径的节点链路，以及每一步 from/to 节点迁移。
  3. [done] 报告展示每个步骤 before / after 节点识别状态、分数、候选节点、matchedWeight / totalWeight、matcher 逐项命中 / 未命中和原因。
  4. [done] 报告展示 OperationEdge 的 edgeKey / edgeId、动作类型、usedActionPolicyId、fallbackActionPolicyId、action policy 优先级 / fallback / reliabilityHint、动作 params / timing / coordinate 和 expected / actual。
  5. [done] 报告按图谱默认预期、动态预期、系统护栏分组展示，并关联截图 / 日志 / 视频时间点。
  6. [done] Dashboard 执行详情消费 `/api/graph-runs/:runId`，展示目标节点、路径、失败阶段、before / after 节点识别、动态预期、系统护栏、视频、截图和失败证据入口。
  7. [partial] 已展示偏离、有限重试和恢复记录：GraphRunner 对后置状态未到达支持 `failurePolicy.retryCount` 的 observe retry，并在 result、step metadata、`/api/graph-runs/:runId`、HTML 报告和 Dashboard 中展示 `retry_observe` / `replan_required` / `recover_required` / `fail`；GraphRunService 已支持 `recoverTo=replan` 的第一版真实自动重规划恢复，恢复步骤带 `recoveryAttempt` 和 `recoveryReasonDeviationId`。后续再接 `previous_node/root` 恢复动作、弹窗 watcher 和多次受控恢复策略。
  8. [done] 新增 `GET /api/graphs/:versionId/quality`，服务端按最近 graph runs 汇总节点 / 边执行次数、通过率、最近失败信息、报告链接、恢复尝试次数和恢复成功次数；Dashboard 图谱页在目标节点选择区展示该目标最近执行质量和恢复成功趋势。
- 验证方式：`runner-core.test.ts` 覆盖后置状态偏离的 observe retry 和最终 `replan_required` 记录；`graph-run-service.test.ts` 覆盖偏离到已知节点后的自动 replan 恢复和 Runtime Interceptor 弹窗处理；`graph-quality.test.ts` 覆盖节点 / 边质量统计、最近失败、报告链接、恢复尝试次数和恢复成功次数；`GraphCandidatesPanel.test.ts` 覆盖目标节点质量展示和恢复成功趋势；`report-core.test.ts` 覆盖图谱路径、节点识别 matcher 明细、动作策略完整参数、overlay 预期分组、偏离记录、运行时清障和恢复路径标记；`StepsPanel.test.ts` 覆盖 Dashboard 图谱运行详情展示 matcher 明细和动作 params；成功 / 失败 / overlay 失败 / replan 恢复 / 弹窗清障报告均可读。2026-06-12 追加验证：`pnpm exec vitest run platform/apps/server/src/graph-quality.test.ts platform/apps/dashboard/src/components/GraphCandidatesPanel.test.ts platform/packages/mcp-adapter/src/index.test.ts platform/packages/cli/src/index.test.ts`、server / dashboard typecheck、`pnpm exec vitest run platform/packages/report-core/src/report-core.test.ts platform/apps/dashboard/src/components/StepsPanel.test.ts`、`pnpm lint`、`pnpm test:unit` 均通过。

### T-075：图谱执行稳定性内核升级

- 状态：in-progress
- 关联需求：REQ-038、REQ-039、REQ-040
- 关联设计：DES-038、DES-039、DES-040
- 目标平台：graph-core + runner-core + Backend + Dashboard report
- 修改边界：GraphRunService planning lifecycle、RoutePlanner input、GraphRunner wait policy、NodeMatch quality gate、graph run report
- 任务内容：
  1. [partial] 实现两阶段规划：GraphRunService 执行线程内先 Observation + detect current node；若识别到目标 App 内 active 节点，则从当前节点规划；若在 App 外或 unknown，则先 bootstrap 启动目标 App，再重新 Observation 并从实际识别节点规划。当前已补 `outside_target_app`、`unknown_app_state`、`login_required`、`blocking_state` 起始原因分类；登录 / 强阻塞态第一版通过节点标签（如 `auth:login_required`、`runtime:blocking`）诊断；当前节点已知但目标不可达时，会生成 `route-gap-exploration-*.json` artifact，记录起点、目标、不可达原因和当前页面可定位动作候选，并把最高置信候选沉淀为 `source=exploration` 的 draft edge（排除当前起点状态锚点，不参与规划），不会硬编码恢复路径。bootstrap 后仍处于目标 App 内但无法识别 active 节点时，也会把当前未知页沉淀为 runtime draft node，并生成“runtime draft node -> 本次目标节点”的 `source=exploration` draft edge；该边只有晋级为 active 后才参与 RoutePlanner。后续补正式 start policy、登录恢复和阻塞态治理 UI。
  2. [partial] bootstrap 过程必须可解释：当前已记录 `start_state_failed` 事件，包含启动目标 App 的策略和原因；App 外 / unknown bootstrap、登录门禁、强阻塞态都会写入结构化 detail，包含 reason、Observation 摘要和 NodeMatch 候选；bootstrap 后仍无法识别起点时会生成 `runtime-unknown-node-candidate-*.json` artifact，并把当前页面沉淀为 `runtime-discovered` / `needs-review` 草稿节点，重复观察同一未知页面时复用已有草稿节点并更新 artifact / observationCount，不再因唯一键冲突中断诊断；若当前页存在可定位动作候选，会同步生成 exploration draft edge，并在事件 detail 中记录 `candidateEdgeId` / `candidateEdgeKey`；同一套候选构建规则已抽为共享模块，`POST /api/graphs/:versionId/current-page` 和 Dashboard“识别当前页面”可在不启动测试的情况下识别当前页，命中 active 节点则展示匹配结果，未知则沉淀草稿节点；`/api/graph-runs/:runId`、HTML 报告和 Dashboard 已展示启动归位次数与事件说明。后续补前后 Observation artifact、失败原因专门展示和登录 / 阻塞态治理 UI。
  3. [partial] 引入 `TransitionWaitPolicy`：GraphRunner 动作后已按 `transitionTimeoutMs` / `pollIntervalMs` 或 `timeoutMs` / `intervalMs` 持续采集 Observation，直到目标节点匹配或超时。后续补 `stableSampleCount`、loading / blocker policy 和边级显式 waitPolicy schema。
  4. [done] 替换 GraphRunner 当前偏固定的后置 observe retry 语义，把它升级为状态迁移等待窗口；保留 retry / replan / recover 的最大次数和报告记录，轮询过程只记录首个等待偏离和最终结论，避免报告噪音。
  5. [partial] 补状态识别质量门禁：`detectNode` 已把 package / bundle 作为上下文证据，不再单独证明业务节点；节点至少需要命中一个强状态锚点（activity / route / fragment / resource_id / accessibility_id / image_region / custom）或两个弱状态锚点（text / ocr_text）才会被接受为可信 matched。`StateMatcher` 已支持 `critical` schema，关键 matcher 未命中时返回 `critical_matcher_missing` 和 `missingCriticalMatcherIds`，并通过 SQLite 持久化。候选结果新增 `quality`、低置信原因、强 / 弱 / 上下文信号数量和缺失强锚点；GraphRunService、HTML 报告和 Dashboard 已透传展示。后续补 unknown / multiple_candidates 的专门失败 UI 和图谱治理建议。
  6. [partial] 调整产品信息架构：Dashboard 第一版曾把左侧核心入口调整为“节点测试 / 执行结果 / 历史脚本”，后续需按 Phase 13 收敛为“用例库 / 用例录制 / 用例执行”主入口；目标节点测试保留为实验 / 高阶能力，不再作为默认主心智。
  7. [partial] 执行结果保存本次 `RoutePlanSnapshot`，并在 Dashboard / HTML 报告展示 bootstrap、规划起点、目标、路径策略、polling 等待结果、最终状态和失败阶段；当前已在真实执行结果和 step metadata 中保存实际 RoutePlan / node match / deviation，HTML 报告和 Dashboard 已展示启动归位、状态等待和路径恢复诊断；目标节点测试页的执行计划预览已改为步骤列表内部滚动，避免长路径撑破页面。后续补 RoutePlanSnapshot 专门 UI 展示。
  8. [done] 保持 legacy `/api/cases` / `/api/runs` 可用，但后续录制模块应产出图谱候选资产，不再要求图谱内核迁就旧线性坐标步骤。
- 验证方式：`runner-core.test.ts` 已覆盖 loading 后动态 polling 成功、超时失败、偏离后 replan；`graph-run-service.test.ts` 已覆盖 App 外启动 bootstrap、App 内未知状态 bootstrap、未知页 runtime 草稿节点沉淀与重复复用、未知页到目标节点 exploration draft edge 沉淀、已知起点到目标不可达时生成 route-gap 探索候选、登录门禁起始诊断、强阻塞起始诊断、偏离恢复和 Runtime Interceptor 弹窗处理；`runtime-graph-candidate.test.ts`、`current-page-asset.test.ts` 覆盖运行期候选节点构建、重复 metadata 合并、当前页面匹配和未知页草稿沉淀；`graph-core.test.ts` 已覆盖单弱文本拒绝、双弱文本兜底、强锚点缺失低置信、critical matcher 缺失阻断；`storage.test.ts` 已覆盖 critical matcher 持久化；`report-core.test.ts`、`graph-node-test-result.test.ts`、`StepsPanel.test.ts` 已覆盖 bootstrap / transition wait / recovery 诊断和 matcher quality 展示；`CaseLibraryPanel.test.ts`、`GraphCandidatesPanel.test.ts` 覆盖历史脚本与目标节点测试入口语义、执行计划预览滚动结构和候选资产治理入口；graph-core / server typecheck 通过。Android 真机已验证：当前处于 ClassIn MainActivity 的“课堂报告”未知页时，route-plan preview 返回 `CURRENT_NODE_UNKNOWN` 且不持久化误导性 root 路径；`current-page` 复用 `runtime.unknown.f8fqy5` 草稿节点；启动目标节点执行失败后生成 `runtime-discovered` 草稿节点和 `exploration.runtime.unknown.f8fqy5.to.classin.teacher.lesson.create.*` 草稿边。剩余：bootstrap 失败专门报告、unknown / multiple_candidates 专门 UI、正式测试规格库数据模型、Android 真机从桌面到目标节点完整路径。

### T-076：Android 执行动作通道升级

- 状态：in-progress
- 关联需求：REQ-035、REQ-038
- 关联设计：DES-005、DES-035、DES-038
- 目标平台：android-driver + runner-core + Backend report
- 修改边界：AndroidActionExecutor、SemanticStepResolver、GraphRunService metadata、report-core
- 任务内容：
  1. [done] 抽象动作执行结果层：`performAction` 已可返回 `DeviceActionResult`，`performSemanticAction` 已可接收 `SemanticDeviceActionRequest`，把动作意图、语义目标和底层执行通道元数据解耦；当前 ADB / WDA / Mock / HTTP semantic backend 已返回通道结果。
  2. [done] 为动作结果记录 `driverChannel`，当前覆盖 `adb_input`、`appium`、`mock`，类型预留 `uiautomator2`、`scrcpy_control`，并预留 `fallbackReason`。
  3. [partial] 调研并确定 Android 元素级执行方案：第一版提供 `AndroidHttpActionBackend`，可通过 `ANDROID_ACTION_BACKEND=uiautomator2|appium`、`UIAUTOMATOR2_SERVER_URL`、`APPIUM_SERVER_URL`、`APPIUM_SESSION_ID` 接入外部元素级 driver；后续补本地启动方式、端口管理、设备并发、依赖安装和失败恢复。
  3.1. [todo] 接入真实 UIAutomator2 / Appium 服务生命周期：服务端负责检测依赖、分配端口、按 device serial 建立 session、健康检查、断线重连、运行结束释放 session，并把启动失败转成明确错误码。
  3.2. [todo] 明确本地依赖策略：`adb` 和项目固定 `scrcpy-server` 属于基础能力；UIAutomator2 / Appium server 属于自动化执行增强能力，缺失时必须在工具探活和执行报告中提示“已降级为 UIAutomator dump + ADB fallback”。
  3.3. [todo] 补真实设备验证矩阵：至少覆盖 `tap_on_element`、`input_text_to_element`、`scroll_until_visible`、UI idle / waitForExists、服务异常 fallback、同一设备串行和多设备并发。
  4. [partial] 第一批迁移 `tap_on_element`、`input_text_to_element`、`scroll_until_visible`：`SemanticStepResolver` 会先定位稳定 locator，再优先调用 `performSemanticAction`；backend 不可用时才走 UIAutomator dump + ADB input / text fallback，并写入 fallback metadata。
  5. RoutePlanner / ActionPolicy 评分引入执行通道稳定性：元素级 driver 优先，OCR / image 次之，ADB 坐标 fallback 降权。
  6. Dashboard 和 HTML 报告展示动作通道、fallback 使用次数和不稳定路径提示。
  7. [todo] 更新工具探活接口，区分 `adb` 必需能力、`scrcpy CLI` 可选调试能力、`scrcpy-server` 预览能力和 `uiautomator2/appium` 自动化执行能力。
- 验证方式：Mock backend / Android driver / iOS driver 已覆盖基础通道元数据返回；AutomationRunner 和 GraphRunService 已把直接动作与语义动作的 `actionBackend.driverChannel` 写入 step metadata；`android-actions.test.ts` 覆盖 env backend 和 HTTP backend 协议；`android-driver.test.ts` 覆盖 semantic backend 优先与 ADB fallback；`semantic-locator.test.ts`、`automation-runner.test.ts` 覆盖 runner 优先调用 semantic backend；`structured-flow-runner.test.ts`、`graph-run-service.test.ts` 回归通过；shared / android-driver / server typecheck 通过。剩余：真实 UIAutomator2 / Appium server 进程管理、session 绑定、工具探活、fallbackReason 报告展示、Android 真机元素级 driver 验证。

### T-077：录制资产图谱化迁移

- 状态：in-progress
- 关联需求：REQ-036、REQ-038、REQ-040
- 关联设计：DES-036、DES-038
- 目标平台：Backend + Dashboard recording
- 修改边界：legacy case graph import、recording semantic snapshot、graph candidate metadata
- 任务内容：
  1. [done] 保留历史脚本入口，但产品文案明确其作为旧录制脚本和图谱草稿输入，不再作为 v2 核心执行真相。
  2. [done] `POST /api/cases/:id/import-graph` 导入录制脚本时，语义元素步骤会把 resource-id / text / content-desc 转成候选节点 matcher。
  3. [done] 录制到的 resource-id matcher 默认提升为 `critical=true`，权重提高到 3，避免后续图谱识别只靠文字或坐标。
  4. [done] 候选节点 metadata 增加 `graphCandidate`，标记 `needsReview`、`repairHint` 和 locator 信息，为后续语义修复入口使用。
  5. [todo] Dashboard 在历史脚本转图谱后展示候选节点的 matcher 质量、critical 标记和修复建议。
  6. [partial] 录制模块结束保存时可直接产出图谱候选资产，减少用户手动点“转图谱”的步骤；当前已支持录制过程中每步异步写入图谱资产，保存用例仍保留历史脚本入口。
  7. [partial] 支持把一次录制拆成“新增节点 / 新增边 / 修复已有边动作策略”三种候选变更；当前已能区分 created / reused node 和 created / reused edge，后续补已有边动作策略 / 预期的显式修复入口。
  8. [partial] 录制过程中每完成一步，展示该步的 fromNode 识别、ActionPolicy、toNode 识别和 ExpectationSet；当前步骤卡片展示 from -> to、边名称、稳定度和警告，后续补可编辑 matcher / expectation 的确认面板。
  9. [partial] 高置信录制候选支持按策略自动晋级为 active，低置信或冲突候选保留在候选资产治理页；当前语义动作确认写入 active，纯坐标动作强制 draft 并提示风险，后续补冲突检测和用户确认策略配置。
- 验证方式：`legacy-case-graph.test.ts` 覆盖历史脚本导入图谱草稿、语义元素 locator 转 critical matcher、候选节点修复 metadata；`storage.test.ts` 覆盖 critical matcher 持久化；`graph-run-service.test.ts` 保障图谱执行不回退；`recording-graph-assets.test.ts` 覆盖手工录制生成 graph asset；`StepList.test.ts` 覆盖录制步骤图谱资产展示。

## Phase 13：结构化录制用例主线

### T-078：定义 StructuredFlow 模型与存储

- 状态：done
- 关联需求：REQ-041、REQ-008、REQ-014、REQ-040
- 关联设计：DES-041、DES-017
- 目标平台：shared + server storage
- 修改边界：shared schema、SQLite schema、storage API、test-support builders
- 任务内容：
  1. 已定义 `StructuredFlow`、`StructuredFlowStep`、`FlowStateAnchor`、`StructuredFlowAppVersion`、`StructuredFlowStatus`、`StructuredFlowStartStrategy` 类型；`FlowRunConfig` / `FlowRunResult` 随 T-080 执行器落地。
  2. 已新增 `structured_flows` / `structured_flow_steps` SQLite 表：保存 appName、platform、targetApp、appVersion、compatibleRange、startState、endState、steps、status 和版本号。
  3. 已保留 legacy TestCase，不复用旧 `steps` 表承载新模型，避免旧用例和结构化用例互相污染。
  4. 已补 storage 测试 fixture 覆盖结构化状态锚点、动作、后置预期、系统守护和 legacy case 不退化。
- 验证方式：`pnpm exec vitest run platform/apps/server/src/storage.test.ts`、`pnpm --filter @mobile-automation/shared typecheck`、`pnpm --filter @mobile-automation/server typecheck` 通过。

### T-079：录制保存 StructuredFlow

- 状态：done
- 关联需求：REQ-041、REQ-034、REQ-035
- 关联设计：DES-041、DES-034、DES-035
- 目标平台：Dashboard recording + Backend
- 修改边界：recorder hooks、recording API、StepList / Flow editor UI
- 任务内容：
  1. 已新增 `buildStructuredFlowDraft`，可把录制步骤转换为 `StructuredFlow` 草稿，包含 App、版本、起点、终点、beforeState、semantic action、afterExpectations、systemGuards。
  2. 已新增 `/api/structured-flows` CRUD 入口，并让录制保存优先写入 `structured_flows` / `structured_flow_steps`。
  3. 已支持默认中文命名规则 `App名-版本号(构建号)-起点-终点`；用户编辑用例名时保存用户命名。
  4. 已复用录制时生成的 `tap_on_element` / `tap_on_text` 语义动作和系统守护；保存时会从语义 locator / packageName 推断 Android targetApp 和默认 App 名，避免保存出 `unknown.android.package`；Android 保存前会通过设备查询已安装包版本并自动绑定 displayVersion / versionCode / buildNumber，低稳定性提示将在后续增强中继续补齐。
  4.0. 新录制语义点击会自动生成动作前置：`tap_on_text` 等待目标文字可见，`tap_on_element` 等待目标元素存在；元素前置会继承 resource-id / content-desc / text / occurrence，避免同名控件或页面未就绪时盲点。
  4.1. 点击同名元素时会保存 `occurrence` 视觉序号：例如两个 `content-desc="course Photo"` 中点击第二个，会记录并展示为 `desc=course Photo#2`，回放时按当前 UI hierarchy 的视觉顺序选择第 2 个匹配元素。
  4.2. 动作后采集到 after Observation 时会自动生成到达页预期：优先选择新增的标题 / toolbar / header 类 resource-id + 文本，例如点击加号进入“发布活动”页后生成“发布活动可见 / 标题元素存在”；`screen_changed` 继续保留为弱候选。候选选择会过滤 status / state / tag / badge / time / count 等瞬态元素和“已结束 / 进行中 / 热门 / 更多”等列表状态文本，并在重新采集 after Observation 时替换旧 `recording_arrival_*` 自动预期，避免错误候选残留。
  5. 状态锚点不再把“起点 / 终点 / 点击元素标题 / tap”等展示文案生成强前置断言，避免结构化用例执行前被不可观测占位文本阻塞。
  6. 保存后仍跳转用例库并高亮最新保存项；用例库全面切换为 StructuredFlow 列表由 T-081 承接。
  7. 录制步骤已保存动作前 / 动作后的轻量 Observation 摘要：包含 package、activity、分辨率、关键 resourceId、关键文本和候选数量；StructuredFlow 的 beforeState metadata / matchers / source / artifacts 会复用这些摘要，为后续预期编辑和稳定执行提供依据。
- 验证方式：`pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts`、`pnpm exec vitest run platform/apps/server/src/storage.test.ts -t "structured flows"`、dashboard / server typecheck 通过；2026-06-15 追加验证：`pnpm exec vitest run platform/apps/dashboard/src/recording.test.ts -t "replaces stale generated arrival expectations|transient list status|OCR page title"` 通过，覆盖瞬态状态文案过滤和旧自动到达页预期替换。

### T-080：StructuredFlow 执行器

- 状态：done
- 关联需求：REQ-041、REQ-009、REQ-010、REQ-012、REQ-014
- 关联设计：DES-041、DES-034、DES-038
- 目标平台：runner-core + server runner
- 修改边界：FlowRunner、StepExpectationEvaluator、Runtime Interceptor、report metadata
- 任务内容：
  1. 已新增 `StructuredFlowRunner`，按 FlowStep 顺序把 `beforeState.expectations` 映射为 preconditions，把 `afterExpectations + systemGuards` 映射为步骤预期，并复用现有语义动作、动态文字等待、截图、视频、指标、日志和 HTML 报告管线。
  2. 已支持 `stopAtStepId`，执行到指定中间结构化步骤即可完成。
  3. 已新增 `POST /api/flow-runs` 触发结构化用例执行，并复用设备锁、run 查询、停止、暂停、继续、单步接口。
  4. 已兼容历史坏 StructuredFlow：当 targetApp 为 `unknown.android.package` 时，执行器会从步骤 locator / packageName 推断启动包名；同时过滤早期错误生成的 `structured_flow_state_anchor` 占位前置。
  5. 已新增 `GET /api/flow-runs/:runId` 查询别名，返回 run、active 和 flowRun 摘要，后续 CLI / MCP 可直接复用。
  6. 执行前 package / bundle、appVersion / compatibleRange 校验和从某一步开始执行仍待后续增强；当前先完成主闭环。
  7. 每步默认可检查 no_crash、app_alive；ANR 仍由底层设备事件 watcher 进入 no_crash 语义。
  8. StructuredFlow 执行已复用 RuntimeInterceptor：在前置检查前和动作后预期检查前，自动识别并处理“允许 / 知道了 / 稍后 / 跳过 / 取消”等常见阻塞弹窗，处理记录写入 step metadata，避免权限弹窗、升级提示等阻断主流程。
  8.1. RuntimeInterceptor 已从硬编码常见文案升级为可配置规则：新增 `runtime_interceptor_rules` 持久化表和 `/api/runtime-interceptor-rules` CRUD；规则支持平台 / App 包名 / Flow 作用域，支持 text、resource-id、content-desc、activity、package matcher，处理动作首版支持 `tap_text`、`tap_element`、`back`。录制页新增“临时阻断页”面板，可把当前页面标记为阻断规则，例如“看到选择学科 -> 点击关闭”，后续执行主 Flow 时自动处理并继续等待原步骤前置 / 后置条件。
  9. StructuredFlow 入口不再继承 legacy `stepIntervalMs=400ms` 固定等待；未显式配置时默认 `0ms`，由每步 `beforeState` / `afterExpectations` 的 timeout / interval 控制节奏。
  10. 阻塞型 `screen_changed` 后置预期已从“一次 after 截图即判定”升级为动态轮询：首次未变化时按 `timeoutMs` / `intervalMs` 继续采集截图，直到预期满足或超时；非阻塞自动视觉预期不参与长轮询，避免拖慢流程。
- 验证方式：`pnpm exec vitest run platform/apps/server/src/structured-flow-runner.test.ts platform/apps/server/src/storage.test.ts`、`pnpm exec vitest run platform/apps/server/src/automation-runner.test.ts platform/apps/server/src/structured-flow-runner.test.ts`、`pnpm --filter @mobile-automation/server typecheck`、server / shared typecheck 通过；2026-06-16 追加验证：`pnpm exec vitest run platform/apps/server/src/runtime-interceptor.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/automation-runner.test.ts -t "RuntimeInterceptor|runtime interceptor rules|custom runtime interceptor"`、`pnpm exec vitest run platform/apps/dashboard/src/components/RuntimeInterceptorPanel.test.ts`、`pnpm lint` 通过。

### T-081：用例库与执行面板重构

- 状态：done
- 关联需求：REQ-041、REQ-019、REQ-020
- 关联设计：DES-041、DES-003
- 目标平台：Dashboard
- 修改边界：navigation、case library、recording page、execution page、report entry
- 任务内容：
  1. 已将用例库恢复为主导航核心模块，并切换为 StructuredFlow 主列表，支持按 App / 版本 / 起点 / 终点 / 标签搜索。
  2. 已在用例库卡片展示结构化步骤数量、App、版本、起点 -> 终点、状态和最近执行结果。
  3. 已支持从用例库直接执行 StructuredFlow，调用 `/api/flow-runs` 并复用执行结果页。
  4. 已支持从用例库编辑 StructuredFlow：回到录制页并把 FlowStep 的 action、beforeState expectations、afterExpectations、systemGuards 回填到步骤编辑器。
  5. 历史 TestCase 仍作为设备管理页的 legacy 辅助入口保留；目标节点测试继续保留为实验能力。
  6. 已支持在用例库卡片选择“完整执行”或“执行到某个结构化步骤”，并把 `stopAtStepId` 传给 `/api/flow-runs`。
  7. 已新增用例详情 / 步骤详情预览区：选中用例后展示 App、平台、版本、起点、终点、最近结果，以及每一步的 beforeState、执行动作、afterExpectations、systemGuards 和最近步骤结果。
  8. 已在用例详情中区分两种预期修改模式：保存模式可直接修改某个结构化步骤的前置文字条件或后置文字预期并保存回 `/api/structured-flows/:id`；临时运行模式通过 `/api/flow-runs.expectationOverrides` 覆盖本次运行的 beforeState / afterExpectations，不污染已保存用例，并默认执行到当前步骤验证该临时预期。
  9. 已修复用例库执行到中间步骤时 App 层丢失 `stopAtStepId` 的问题。
  10. 录制页步骤卡片已从“图谱资产”主展示切换为 StructuredFlow 规则摘要：优先展示动作详情、前置条件、后置预期和系统守护；图谱资产 / adb dump 等调试信息不再占据录制步骤主体。
- 验证方式：`pnpm exec vitest run platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/recording.test.ts`、`pnpm exec vitest run platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts platform/apps/dashboard/src/recording.test.ts`、dashboard / server typecheck 通过；四任务整体验证 `pnpm exec vitest run platform/apps/server/src/storage.test.ts platform/apps/server/src/structured-flow-runner.test.ts platform/apps/dashboard/src/recording.test.ts platform/apps/dashboard/src/components/CaseLibraryPanel.test.ts` 通过；录制步骤规则摘要验证 `pnpm exec vitest run platform/apps/dashboard/src/components/StepList.test.ts`、`pnpm --filter @mobile-automation/dashboard typecheck` 通过。

### T-082：Flow REST / CLI / MCP 接口

- 状态：planned
- 关联需求：REQ-041、REQ-033、REQ-039
- 关联设计：DES-041、DES-039
- 目标平台：server API + cli + mcp-adapter
- 修改边界：REST routes、CLI commands、MCP tool definitions、docs/guides
- 任务内容：
  1. 新增 REST：`GET /api/flows`、`GET /api/flows/:id`、`POST /api/flows`、`PATCH /api/flows/:id`、`POST /api/flows/:id/runs`、`GET /api/flow-runs/:runId`。
  2. CLI 新增 `flows`、`flow-run`、`flow-status`、`flow-report`。
  3. MCP adapter 新增 `listFlows`、`getFlowDetail`、`runFlow`、`getFlowRunStatus`、`getFlowReport`、`getFlowFailureEvidence`。
  4. `runFlow` 支持 runtimeOverlay、stopAtStepId、stopAtStateId、expectedAppVersion 和 startStrategy。
  5. 返回结构必须包含 status、failedAt、reason、reportUrl、screenshots、videoUrl、logs、failureEvidence、expected / actual 摘要。
- 验证方式：API 测试覆盖成功触发、版本不匹配、设备锁、stopAtStepId、overlay；CLI / MCP mock REST 测试覆盖工具 schema 不暴露 secret，并复用 REST-only adapter。

### T-083：统一 TestRuleCore 底层执行规则

- 状态：done
- 关联需求：REQ-041、REQ-038、REQ-039、REQ-040
- 关联设计：DES-041、DES-038、DES-039
- 目标平台：shared + server runner
- 修改边界：shared rule step schema、server execution adapter、StructuredFlowRunner、runner tests
- 任务内容：
  1. 已在 shared 中明确 `TestRuleStep`、`RuleStateAnchor`、`RuleStateMatcher` 的底层类型；`StructuredFlowStep` 直接复用该规则步骤结构，避免录制回放和图谱执行各自维护一套 before / action / after 语义。
  2. 已新增 server 适配层，把 `TestRuleStep` 转为现有成熟 AutomationRunner 可执行的 `ActionStep`，统一处理 `beforeState.expectations`、action preconditions、afterExpectations、systemGuards、timing 和 source metadata。
  3. 已将 StructuredFlowRunner 的内联转换逻辑迁移到适配层；BusinessGraph 暂不迁移产品入口，只保留未来 `ExecutionPlanStep -> TestRuleStep` 的清晰扩展点。
  4. 适配层继续过滤早期错误生成的 `structured_flow_state_anchor` 占位前置，例如“起点 / 终点 / tap / 点击元素：xxx”，但保留真实可观测文本、元素、图像和状态预期。
  5. 适配层统一从 Flow targetApp、动作 params、语义 locator 中推断 Android packageName，避免历史 `unknown.android.package` 用例无法执行。
- 验证方式：已先写失败测试覆盖 TestRuleStep 转 ActionStep，再实现适配层；`test-rule-step.test.ts`、`structured-flow-runner.test.ts`、`recording.test.ts`、storage / CaseLibrary 回归和 shared / server / dashboard typecheck 通过。

## Phase 14：PageStateFlow 页面状态资产主线

### T-084：定义 PageStateFlow 模型与存储

- 状态：planned
- 关联需求：REQ-042、REQ-014、REQ-025
- 关联设计：DES-042、DES-017
- 目标平台：shared + server storage
- 修改边界：shared schema、SQLite schema、storage API、test-support builders
- 任务内容：
  1. 定义 `PageStateLibrary`、`PageModel`、`PlatformPageProfile`、`PageMatcher`、`PageElement`、`ElementLocatorProfile`、`LocatorCandidate`、`PageTransition`、`PathPlan`、`AiReadableAssetInfo` 类型。
  2. 新增 SQLite 表：`page_state_libraries`、`page_models`、`page_platform_profiles`、`page_matchers`、`page_elements`、`page_element_locator_profiles`、`page_locator_candidates`、`page_transitions`。
  3. 保存 App / packageName / bundleId / versionScope，确保页面资产按 App、逻辑 key、平台 profile 和版本范围隔离。
  4. 坐标 locator 只能保存为 `coordinate_fallback`，不得成为默认 primary locator。
  4.1. PageModel、PageElement、PageTransition 必须保存 AI 可读字段：targetRef、displayName、aliases、description、businessDomain、roles、intentTags、examples。
  5. 支持同一 PageModel 下挂 Android / iOS / mobile-both profiles；同一 PageElement 下挂 Android / iOS / mobile-both locator profiles。
  6. 补 storage builder 和 fixtures，覆盖 active / draft / stale / needs_update / deprecated、blocking_page、overlay、navigate transition、local_state_change transition。
- 验证方式：先写 storage/schema 失败测试，再实现类型和表结构；`storage.test.ts` 覆盖 CRUD、逻辑 key 唯一性、Android / iOS profile 合并、AI 可读字段、版本范围、draft/active/stale 状态、locator 优先级和坐标 fallback 限制；shared / server typecheck 通过。

### T-085：实现当前页面识别与页面资产录入

- 状态：in_progress
- 关联需求：REQ-042、REQ-034、REQ-035
- 关联设计：DES-042、DES-034、DES-035
- 目标平台：server Observation + Dashboard
- 修改边界：ObservationService、PageMatcher scorer、API、Dashboard 页面资产库
- 任务内容：
  1. [partial] 新增 PageMatcher scorer：当前已抽出独立 `PageMatcher` server 模块，识别时只使用已确认且 active 的页面资产节点，排除 runtime draft、录制节点和 deprecated 资产；PageStateFlow 正式身份按 portable visual / OCR 白名单匹配，package / bundle、activity / route、resource-id / accessibility id、UI tree / WDA source 只作为平台上下文、候选发现或调试证据，不再生成正式页面身份 matcher。截图区域已接入 baseline artifact 视觉比较，采用灰度结构相似度 + average-hash 相似度组合评分，并支持 `ignoreRegions` 屏蔽状态栏、动态 banner、账号 / 班级名等不稳定子区域；带 `region` 的 `ocr_text` matcher 会作为区域锚点，只在用户圈选的相对区域内匹配，避免同一文案出现在页面底部或动态列表里误命中；OCR matcher 会归一化首尾符号噪声，兼容历史确认依据中把返回箭头或装饰符号与标题合并保存的情况，例如 `< 新建公开课` 可命中运行时 OCR 的 `新建公开课`，但不会放宽区域限制；已新增 `semantic_image_region` 轻量语义区域 matcher，基于同一圈选区域的 OCR tokens、layout 区域和签名 hash 计算相似度，默认非 critical，用于动态数字、角标、账号数据变化时补强召回；语义区域只作为辅助证据，不能覆盖同区域 critical `image_region` 未命中，避免“发布活动”等页面因为底部局部语义相似被误判为“班级详情页”。后续继续补多截图样本、真实 pHash / SSIM 库、OpenCLIP / SigLIP embedding 服务、平台 profile 分层 scorer 和跨平台 fallback 置信度策略。
  2. 新增 `POST /api/page-state/current-page`，输入 deviceSerial + libraryId，返回 matched / low-confidence / multiple_candidates / unknown。
  3. 新增 `POST /api/page-state/pages`，允许把当前 Observation 保存为 draft PageModel，或更新已有 PageModel 的 Android / iOS profile。
  4. [partial] Dashboard 新增“页面资产库”模块和“识别当前页面”按钮；匹配成功展示页面详情，未知时允许保存 draft；当前 `/api/graphs/:versionId/current-page` 在 `assetOnly=true` 时已透传 `matcherDiagnostics`，包含命中的确认依据、缺失依据、最高候选和候选列表，Dashboard 优先展示 PageMatcher 诊断而不是旧 candidate matcherResults。跨端相似时提示“补充当前平台 profile”待补。
  5. 禁止系统桌面、其他 App 或 package / bundle 不匹配的 Observation 写入目标 App active 页面资产。
  6. 当目标平台缺少 profile 时，允许用 commonMatchers / mobile-both profile 做低置信跨平台视觉 fallback，并返回明确 fallback reason。
  7. [done] 页面识别已增加公共导航质量门禁：底部 Tab / 固定导航等通用区域只能作为操作入口或辅助证据，不能在缺少标题区、主体区域或用户确认截图重点区域等页面专属证据时把页面判为 matched；这类候选会返回 `page_specific_evidence_missing`。
- 验证方式：当前 `graph-core.test.ts` 覆盖带相对区域的 `ocr_text` / `text` matcher 只在标题栏等配置区域内命中，底部同名文字不会误判，覆盖 OCR 标题首尾符号噪声兼容，并覆盖 `semantic_image_region` 达到阈值时可作为页面状态锚点，但非 critical `semantic_image_region` 不能替代同区域缺失的 critical `image_region`；`page-matcher.test.ts` 覆盖只匹配 confirmed active 页面资产、排除 runtime / deprecated 候选、缺失依据诊断、截图重点区域 baseline 相似度、动态子区域 ignore 后仍命中、稳定区域变化时低于阈值，以及 OCR / layout tokens 在动态数字变化时命中 `semantic_image_region`；`current-page-asset.test.ts` 覆盖 assetOnly 识别透传 PageMatcher 命中 / 缺失诊断，以及截图重点区域 `ignoreRegions` 在 baseline artifact、`image_region` 和 `semantic_image_region` matcher 中保留；`storage.test.ts` 覆盖 `StateMatcher.ignoreRegions` 持久化；`App.test.ts` 覆盖 Dashboard 优先展示 PageMatcher 诊断而不是旧高分候选，并保留截图重点区域 ignoreRegions，避免更新页面资产时丢失动态忽略区；`pnpm exec vitest run platform/apps/dashboard/src/App.test.ts platform/apps/dashboard/src/components/AssetRecordingPanel.test.ts platform/apps/server/src/current-page-asset.test.ts platform/apps/server/src/page-matcher.test.ts platform/apps/server/src/storage.test.ts platform/apps/server/src/graph-assets.test.ts platform/apps/server/src/page-transition-assets.test.ts`、`pnpm exec tsc -p platform/apps/dashboard/tsconfig.json --noEmit`、`pnpm exec tsc -p platform/apps/server/tsconfig.json --noEmit` 通过。后续补 `page-state-detector.test.ts` 覆盖 App 外拒绝、Android 已存在而 iOS 补 profile、缺 iOS profile 时 cross_platform_visual_fallback。

### T-086：实现页面元素抽取、编辑和主截图区域

- 状态：planned
- 关联需求：REQ-042、REQ-035
- 关联设计：DES-042、DES-035
- 目标平台：server locator + Dashboard
- 修改边界：UI hierarchy parser、OCR evidence、element editor、screenshot region editor
- 任务内容：
  1. 从 UIAutomator / WDA source 和 OCR 中抽取 PageElement 候选，保留 resource-id、accessibility id、content-desc / label、text、class、bounds、clickable、longClickable。
  2. 对重复 resource-id / desc / text 自动生成 occurrence、父级锚点、邻近文字锚点或区域约束。
  3. Dashboard 页面详情支持按 Android / iOS profile 查看 / 编辑元素 locator 候选，并选择强基准、建议基准、fallback。
  4. 页面截图支持圈选主要匹配区域，保存为 ScreenshotAnchor。
  5. Compose / Flutter 缺少稳定元素时，UI 标记为 OCR / image_region 低稳定性候选。
  6. 页面详情支持编辑页面逻辑 key、名称、matcher 权重、版本范围和 stale / needs_update 状态。
- 验证方式：locator extractor 测试覆盖重复同名元素、父级锚点、OCR fallback；Dashboard 测试覆盖 locator 优先级编辑、Android / iOS profile 编辑、截图区域保存和版本失效状态编辑。

### T-087：录制学习 PageTransition 并生成 StructuredFlow 快照

- 状态：planned
- 关联需求：REQ-042、REQ-041、REQ-034、REQ-035
- 关联设计：DES-042、DES-041
- 目标平台：Dashboard recording + server page-state API
- 修改边界：recorder、StepList、PageTransition service、StructuredFlow draft builder
- 任务内容：
  1. 录制开始时先识别当前 PageModel；无法识别但信号充足时生成 draft PageModel。
  2. 每次用户动作生成 PageElement action，并在动作后识别 after PageModel / Overlay / local_state_change。
  3. 新增 PageTransition candidate 写入逻辑，区分 navigate、show_inline_state、local_state_change、no_visible_change。
  4. 高置信 transition 可自动 active；低置信、冲突、坐标-only、OCR-only 关键跳转进入 draft。
  5. 停止录制时继续生成 StructuredFlow 快照，作为用例库可执行资产；快照引用 PageModel / PageTransition source metadata。
- 验证方式：recording page-state 测试覆盖 before page、action element、after page、transition candidate、StructuredFlow snapshot；Dashboard StepList 展示 source page -> action -> outcome page。

### T-087A：资产录制模块一期

- 状态：in_progress
- 关联需求：REQ-042、REQ-035
- 关联设计：DES-042、DES-003
- 目标平台：Dashboard + server page-state API
- 修改边界：Dashboard navigation、AssetRecordingPage、device preview reuse、current page API、page editor components
- 任务内容：
  1. [done] 新增“资产录制”导航模块，保留现有“用例录制”和“用例库”不变。
  2. [done] 左侧复用设备预览和远程操作，但在资产录制页使用 compact preview，只保留设备画面、设备切换和系统导航；用例录制 / 资产录制之间切换时使用独立 preview workspace，强制刷新截图并重建 scrcpy 绑定，避免显示上一个模块的旧画面。
  3. [done] 进入资产录制页或在该页操作设备后自动识别当前页面；右侧展示 activity / view controller、UI tree 摘要、OCR 摘要、截图、候选 matcher 和候选元素；当内嵌 scrcpy 实时流开启时，资产录制截图使用强制取证截图 URL，避免右侧截图因预览流保护返回 409。
  4. [partial] 支持保存为新 PageModel，或更新已有 PageModel 的 Android / iOS profile；当前已支持把识别出的 draft 页面节点确认 / 晋级为 active 页面资产，保存时写入 `page-asset` / `asset-recording` 标签和 `assetRecordingConfirmed` 元数据；页面名称、key、别名、业务描述、意图标签、截图重点区域、截图动态忽略区、已确认 matcher 和已确认 OCR 文本已可随保存 / 更新写入节点 metadata；保存 / 更新时会同步生成并替换真实 `StateMatcher`，其中 OCR 文本作为跨平台 matcher 持久化为 `mobile-both`，并支持 `ocr_text:文案@region(x,y,width,height)` 形式保存相对区域 OCR 依据；Dashboard 从 observation 映射 OCR 候选时会把 OCR 框统一归一化为相对区域，用户点击“设为依据”后保存区域化 OCR，修正 OCR 误识别文字时保留原区域；UI 树文本、Android package / activity / resource-id / accessibility-id、iOS WDA / accessibility id 等平台特征只保留在候选或 raw/debug evidence，不再生成正式页面身份 matcher；截图区域 matcher 持久化 baseline artifact、`region`、`ignoreRegions` 和轻量语义签名；保存 / 更新采用白名单确认模型，未确认候选和运行期自动推断 matcher 不会进入正式 matcher，且没有任何可执行确认依据时会拒绝保存；截图重点区域只有在已绑定视觉基线 artifact 后才会生成 critical `image_region` 强 matcher，并同步生成默认非 critical 的 `semantic_image_region` 补强 matcher；旧资产里只有坐标、没有 baseline 的截图区域仅保留为 metadata，不会阻断已有文本 / 控件证据充分的页面匹配。完整 matcher 权重和平台 profile 编辑待补。
  5. [partial] 支持编辑页面 key、名称、targetRef、别名、业务描述、意图标签、截图区域和基础 AI 可读信息；页面标题以只读确认名展示，点击“修改名称”后在独立输入区确认修改，确认后直接更新页面资产节点名称和 `metadata.pageName`；视觉标题 `visualPageName` 仅作为未确认时的默认候选，避免清空输入时被自动识别结果回填覆盖；页面身份依据改为白名单确认模型：系统采集到的 matcher / UI 文本 / OCR 文本默认只进入“候选信息”，并按“通用候选（OCR 文本、截图重点区域等视觉证据）优先、平台候选（UI 树文本、Android matcher / resource-id / package 等）其次”分组展示，用户点击“设为依据”后只有 portable OCR / visual 依据能进入正式 matcher；UI 树文本可人工修正为 OCR 依据或保留为调试候选，但不直接生成正式 `text` matcher；已确认或候选中的 OCR 文本支持人工修正后再作为确认依据保存，避免 OCR 把图标、角标或噪声误识别成长期页面 matcher；用户圈选并保存的截图重点区域默认视为人工确认的视觉依据，保存时生成 `image_region` matcher，并生成 `semantic_image_region` 轻量语义 matcher；当前页识别会基于区域视觉基线 artifact、自动系统栏 mask、动态忽略区、局部 SSIM + aHash / dHash 视觉相似、邻域漂移搜索和区域内 OCR 签名计算 `Observation.imageRegions` 相似度，适合屏蔽状态栏、账号相关文案、动态课程条、班级名等不稳定内容，再进入 `detectNode` 质量门禁；region-bound OCR 和手工动作区域现在会保存 `semanticArea` 与 `coordinateSpace`，其中 `semanticArea` 已收敛为 `top` / `content` / `bottom` / `unknown` 四个大区，旧的 `top_bar`、`bottom_navigation`、`list_container` 等细分值不再做兼容映射，异常历史数据按删除后重新录入处理；匹配时允许同一语义区域内的小幅 OCR 框漂移，跨语义区域同文案不命中；matcher 权重、ignore region 可视化编辑、ORB / template-search 和元素 locator 详细编辑仍由 T-086 / T-089 承接。
  6. [partial] 资产录制入口已调整为 page-only：保存 / 更新按钮只保存稳定 PageModel；右上角菜单、底部面板、局部黑条和弹窗不再作为独立页面资产入口展示，而应沉淀到父页面的可操作元素、连接边 micro-step 或 Runtime Interceptor。页面能力页签当前只管理 PageElement / PageAbility：优先展示“已录入可操作元素”列表，用户可以编辑 / 删除；列表底部提供“+ 添加可操作元素”；当前没有已录入元素时显示 `0 个元素` 和空态，不自动展开表单。用户点击添加后才出现编辑态条目，通过左侧截图圈选区域、右侧选择能力类型、动作类型、出现条件、结果草稿、目标页面草稿和滚动 / 候选布局参数保存到源 PageModel 的 `assetRecordingManualElements`，不会在该页签创建 PageTransition。当前能力类型包含 `fixed_tap`、`scroll_candidate`、`grid_candidate` 和 `conditional_tap`：`fixed_tap` 用于顶部 / 底部等固定区域的稳定点击；`scroll_candidate` 用于中间内容区内需要滚动查找的目标，支持 `targetKind=image_region` 表达没有稳定 OCR 的图标 / 图片按钮；`grid_candidate` 用于两列班级列表、动态卡片列表等候选入口，保存容器区域、列数、候选 item 高度、点击安全点、滑动步长和失败策略；默认可配置为 `targetKind=item_text` + `targetQuery={{className}}`，用于“指定班级名”这类运行期参数化候选；`conditional_tap` 用于班级详情中“右下角 add 按钮可见才可继续”的条件能力。左侧截图按真实截图比例自适应显示；已圈选动作区域支持整体拖动和边 / 角缩放，只有在空白区域拖拽才会重画新区域，避免用户二次编辑时误重置。结果草稿支持直接跳转、复合跳转、出现页面内状态、局部变化和无明显变化；复合跳转用于“先弹菜单再点菜单项跳页”，页面内状态 / 局部变化用于“点时长弹选择框，确认后选择框消失”等场景。`navigate` / `compound_navigation` 类型 PageAbility 必须绑定已保存目标页面，否则保存入口会提示其不会进入路径规划；服务端 route-plan / graph-run 也会返回 `PAGE_ABILITY_TARGET_MISSING` 诊断，指出具体页面和能力。已绑定目标页面的 PageAbility 会在规划 / 执行时临时转成 active route edge；`compound_navigation` 会持久化 `compoundSteps` 并在执行时展开为“主动作 -> 等待文字出现 -> 点击文字”等 micro-step；`grid_candidate` 即使表单动作方式为滑动，也会按人工圈选容器和点击安全点生成视觉候选点击动作，不走 UI dump 的 `scroll_until_visible`。同屏候选失败重规划时已按 recovery attempt 递增 `candidateIndex`，优先尝试下一个同屏候选；参数化 `targetQuery` 执行时只点击 OCR 命中的指定候选，找不到则失败，不会退化为任选候选；跨屏滚动翻页候选闭环由 T-088 继续承接。
  7. [done] 新增“页面任务”页签和 PageTask 持久化链路：PageTask 归属于当前 PageModel，用于表达到达目标页后的表单填写、按钮提交、等待结果和后续选择器 / 勾选 / 子页面编辑任务。Dashboard 页面任务页签优先展示已保存任务，支持新增、编辑和删除；步骤必须引用当前页已保存手工 PageElement，`wait` 步骤可以只填写等待文本。服务端新增 `POST /api/graphs/:versionId/assets/page-tasks` 和 `DELETE /api/graphs/:versionId/assets/page-tasks/:sourceNodeId/:taskId`，写入源 PageModel 的 `assetRecordingPageTasks`。保存时会归一化步骤顺序、过滤无效元素引用，并拒绝未确认的源页面资产。
  8. [done] 新增资产录制“自动探索”页签：V1 预览 / 执行当前页一跳候选，V2 按深度和动作数限制生成多层探索计划。自动探索必须先命中已保存 PageModel；如果在桌面、其他 App、未知页或低置信页，不创建运行期草稿，也不写入正式资产。候选来源优先为已保存 PageElement / PageAbility，其次为带区域的 OCR 文本；删除、退出登录、支付、发布、提交、确认等危险文案默认 skipped。服务端新增 `/api/graphs/:versionId/auto-explorer/preview` 和 `/api/graphs/:versionId/auto-explorer/run`，采集使用快速视觉模式（截图 + OCR，不采集 UI tree），执行结果只返回 existing_page、new_page_candidate、local_state_change、no_change、dangerous_skipped 或 failed 报告，正式入库仍走页面能力 / 连接边确认流程。
- 当前实现说明：Dashboard 已新增 `AssetRecordingPanel`，入口接入 `AppNav`，左侧复用 compact `PreviewPanel`，右侧通过现有 `/api/graphs/:versionId/current-page` 自动识别当前页面并展示 PageModel 候选、截图、候选识别信息、元素和资产 ID。页面详情已使用页签组织为“页面匹配 / 页面能力 / 连接边 / 页面任务 / 自动探索”：页面匹配展示截图重点区域、“已确认匹配依据”和“候选信息”；候选信息默认不写入页面 matcher，并按“通用候选 / 平台候选”分组，用户点击“设为依据”后才进入确认区；截图重点区域和手工动作区域均支持人工选择 / 修改四区 `semanticArea`，已确认或候选中的 OCR 文本可以点击“编辑”人工修正，OCR 候选在 UI 上只显示可读文字，实际保存值会携带相对 `region`、`semanticArea` 和 `coordinateSpace`；UI 树文本和平台 id 只能作为候选 / 调试展示，不再进入正式页面身份 matcher。保存 / 更新页面资产时，仅白名单 `confirmedMatchers`、`confirmedOcrTexts` 和带 baseline artifact 的截图重点区域会作为页面匹配依据持久化，`confirmedUiTexts` 不再生成正式 `text` matcher。页面能力页签已切到 PageElement-first：已保存手工元素优先显示，自动识别出的 `uiElements` 不再作为默认候选区展示；空列表只显示计数和空态，点击“+ 添加可操作元素”后才出现编辑态；已保存元素缩略图会围绕人工操作区域自动裁剪，编辑器在当前元素条目内展开，编辑 / 删除 / 添加按钮统一为轻量操作按钮。手工元素保存调用 `POST /api/graphs/:versionId/assets/page-elements`，只写回源 PageModel 的 `assetRecordingManualElements`，删除调用 page-elements DELETE API，不再通过删除 PageTransition 间接清理元素。手工录入交互已改为左侧圈选操作区域、右侧选择能力类型 / 动作方式 / 出现条件 / 结果类型；`scroll_candidate` 已可保存滚动查找目标，并支持没有 OCR 文案的 `targetKind=image_region` / `targetQuery=image-region:x,y,width,height`；`grid_candidate` 已可保存候选容器的布局和重试参数，并在列表中显示为“网格候选入口”；`conditional_tap` 已可保存条件点击能力类型。左侧动作区域可在已有框内拖动移动，也可拖动八个控制点缩放，截图层自适应高度展示完整手机截图。`连接边` 页签已支持选择当前页已保存 PageElement、搜索 / 选择目标页面、保存 navigate / compound_navigation PageTransition，并展示 / 删除已录入连接边；复合跳转编辑器支持填写等待文字、点击文字和超时时间；同一主动作 locator 但 `compoundSteps` 不同的复合边会作为不同 PageTransition / PageElement 保存，例如主页右上角加号可同时连接“添加好友”和“加入班级”。`页面任务` 页签已支持把当前页手工 PageElement 编排为 PageTask，供目标执行到达该页面后继续输入表单、点击提交和等待结果；目标页面测试中若目标页有 active PageTask，可在“目标动作”选择“执行页面任务”。`自动探索` 页签展示 V1 / V2 候选、计划和执行结果；其报告只作为候选证据，不会自动污染 PageMatcher / PageTransition。手工 PageElement / PageTransition / PageTask 的 `image-region` locator 会带上 `semanticArea`、`coordinateSpace` 和非网格元素的 `targetText`，执行 `tap_on_image` 时先用当前 OCR 在同一语义区域内重定位目标文字；登录 / 表单类固定语义控件使用 `runtime-locator:*` 运行时结构定位，历史圈选仅保留为 `searchHintRegion`，不得退回人工区域中心。active graph 中已按这套规则录入并验证 `主页 -> 课程表 / 空间 / 成长 / 添加好友 / 加入班级`，其中底部 Tab 为固定视觉区域，右上角加号菜单为 `compound_navigation`。
- 验证方式：Dashboard 组件测试覆盖资产录制导航、资产录制面板核心信息展示、录制页 / 资产录制页独立预览工作区、人工页面名优先级、修改名称确认入口、视觉页面名 / 匹配状态拆分、截图重点区域、页面详情四页签、semanticArea 人工选择 / 覆盖、确认区 / 候选区、候选默认不入库、候选按通用 / 平台分组展示、page-only 保存入口、旧浮层 metadata 不暴露浮层控件、弹窗 / 菜单 / 底部面板 / 动态黑条仍匹配父页面或历史页面上下文、页面资产库删除按钮、页面能力页签 PageElement-first 展示、手工截图区域生成 `image-region` PageElement draft、手工动作区域绘制 / 移动 / 边角缩放、已保存手工 PageElement 回显 / 编辑 / 删除入口、自动候选默认隐藏、连接边页签入口、连接边由已保存 PageElement 创建 navigate / compound_navigation PageTransition、页面任务页签展示 / draft 生成 / 保存请求体、保存 / 更新判定、固定卡片 / 详情滚动布局、资产录制动作即时下发策略、识别中重叠任务阻断、`navigate` PageAbility 目标页保存校验，以及 `scroll_candidate` image-region 目标、`grid_candidate` 页面能力 draft 和候选布局参数生成；Server 测试覆盖当前页面视觉名推断、ClassIn 首页 / 教师列表状态 matcher 结构、页面资产列表过滤、deprecated 页面资产从列表隐藏、页面资产 outgoing transition 摘要、手工 PageElement 直接写回源页面资产、手工 PageElement 更新和删除不依赖 PageTransition、PageTask 保存 / 更新 / 删除、手工确认 `navigate` / `compound_navigation` PageTransition 只在源 / 目标均为已保存页面资产时创建 `active/manual_edit` 边并可被 `planRoute` 使用、复合跳转 `compoundSteps` 入库和执行、非跳转 outcome 保持 `draft`、手工 image-region locator 持久化为 `tap_on_image` action params、`tap_on_image` 运行时重定位、runtime structural 登录控件展开为 `runtime-locator:*` 动作、scrollProfile 和 `scroll_candidate` / `grid_candidate` abilityType / candidate layout 后端持久化、PageAbility 临时规划边、未绑定目标页的 PageAbility 断边诊断、`grid_candidate` 视觉候选点击生成、下游失败后返回源页面并重试下一个候选、只有显式确认依据才生成页面 matcher、确认依据的 `platformScope` 持久化、截图重点区域生成 `image_region` 强 matcher、区域 baseline artifact 绑定和识别时区域相似度参与匹配、系统栏 mask、局部 SSIM + aHash / dHash 组合评分、圈选区域邻域漂移搜索，以及更新页面资产时替换旧 matcher / nodeType。后续继续补 matcher 权重编辑、元素 locator 详细编辑、滚动翻页候选闭环、inline state / local_state_change 专用持久化、picker / toggle / subpage PageTask 执行细节、ORB / template-search 和 PageTransition 批量治理入口。
- 2026-06-26 修正：以上历史说明中的 `region_center` 执行兜底已作废。当前 `tap_on_image` 必须先通过 OCR、crop hash/template、视觉候选或结构候选完成运行时重定位；普通手工 `image-region` 如果只有记录区域而无重定位证据，执行结果为 `runtime_relocation_required`，metadata 标记 `fallback=region_center_disabled`，记录中心点只用于报告和修复建议。
- 高优先级后续待办：报告和失败修复 UI 需要把 `region_center_disabled` / `runtime_relocation_required` 提升成专门的 locator 修复卡片，直接引导用户补 `targetText`、结构定位、dynamic masks、visual template 或 OmniParser 候选，而不是只展示原始 metadata。

### T-088：实现 PageStateFlow 路径规划与执行适配

- 状态：in_progress
- 关联需求：REQ-042、REQ-009、REQ-039、REQ-041
- 关联设计：DES-042、DES-041、DES-039
- 目标平台：server planner + runner adapter + report-core
- 修改边界：PathPlanner、TestRuleCore adapter、FlowRunner、report model
- 任务内容：
  1. 新增 PathPlanner：输入 current PageModel 和 target PageModel / target PageElement action，按 active PageTransition 规划路径。
  1.1. 新增 TargetResolver：支持精确 targetRef 和自然语言目标解析，返回 PageModel / PageElement / PageTransition / StructuredFlow 候选。
  1.2. 自然语言候选不唯一时返回 `needs_disambiguation`，不得直接执行。
  2. 如果当前在 App 外，执行 startStrategy 后重新识别页面再规划。
  2.1. [done] 如果当前在目标 App 内且稳定命中 active 页面资产，但该页面到目标不可达，执行器和 route-plan preview 会先受控执行最多 3 次 `back`，每次重新识别当前页面；回到可达页面后再重新规划，不要求为搜索页、临时二级页等状态补齐到所有目标的边。恢复仅适用于 `matched_graph_node`，未知页、低置信、目标 App 外、登录态缺失或阻断态不会盲目 back。
  3. 如果路径缺失，返回 route gap，说明缺少页面、元素、转移或 matcher，不伪造路径。
  4. 将 PageTransition 转换为 TestRuleStep，复用现有 `beforeState -> action -> afterExpectations -> systemGuards -> evidence` 执行管线。
  4.1. [done] 支持 `compound_navigation`：PageTransition 保存 `compoundSteps`，GraphRun 执行时把主动作和复合步骤展开为 micro-step 序列，并把每个 micro-step 的执行结果写入报告。
  4.2. [done] 支持 `grid_candidate` 下游失败重试：如果点击候选入口后的后续路径失败，执行器返回候选源页面并尝试下一个同屏候选，报告记录 `grid_candidate_downstream_failed`、候选序号和重试原因。
  4.3. [done] 支持参数化 `grid_candidate`：`RuntimeOverlay.runtimeParams` 会在 ExecutionPlan 中替换 `{{className}}` 等 action params 模板；语义定位器在人工圈选的网格 / 列表区域内用 OCR 搜索目标文本，按 OCR 文本中心推导候选 cell 并点击安全点，找不到时滑动容器重试；指定目标最终未命中时返回 `target_not_found`，不 fallback 到第一个候选。
  5. 如果目标平台缺少 profile，但存在 commonMatchers / mobile-both 视觉证据，允许低置信跨平台 fallback 执行，并降低路径稳定性评分。
  6. [done] 报告新增 PageStateFlow 区：展示规划页面链路、实际页面链路、页面匹配分数、元素 locator、expected / actual、跨平台 fallback 原因、阻断页处理记录、可读动作摘要、动作前后页面匹配、复合 micro-step、候选重试原因和失败原因。
- 验证方式：PathPlanner 单元测试覆盖从当前页面规划、App 外 bootstrap、已知但不可达起点 back 恢复、不可达 route gap、缺 iOS profile 时视觉 fallback；TargetResolver 测试覆盖 targetRef 精确命中、自然语言别名命中、多候选 disambiguation、无目标；runner adapter 测试覆盖 PageTransition 转 TestRuleStep、`compound_navigation` micro-step 执行、`grid_candidate` 下游失败重试、运行期参数模板替换、OCR 命中指定网格候选、滑动后命中指定候选和参数化目标未找到失败；report-core / Dashboard 测试覆盖 PageStateFlow 报告区、目标解析过程、fallback 提示、可读动作、复合步骤、候选重试和失败原因。

### T-088A：目标执行模块一期

- 状态：superseded
- 关联需求：REQ-042、REQ-039
- 关联设计：DES-042、DES-039
- 目标平台：Dashboard + server planner
- 修改边界：Dashboard navigation、TargetExecutionPage、TargetResolver API、PathPlanner preview API、run API
- 任务内容：
  1. [superseded] Dashboard 不再提供“页面资产库 / 目标页面测试”入口；`PageAssetsPanel` 只用于浏览和治理已保存页面资产。
  2. [superseded] 新的执行入口统一走 AI资产用例、资产用例和资产驱动巡检；运行参数、PageTask 注入、性能监控和报告证据必须在这些入口对应链路中接入。
  3. [guardrail] 不得再从 `PageAssetsPanel` 直接拼 route-plan / graph-run 请求；如需恢复“跑到某个页面”的产品能力，应新建独立目标执行模块，并先更新需求、设计、入口和报告归属。
- 验证方式：Dashboard 组件测试应覆盖 `PageAssetsPanel` 不导出目标页执行 helper、不渲染“目标页面测试 / 规划并执行”等旧控件；资产执行相关能力转由 AI资产用例、资产用例和资产驱动巡检测试覆盖。

### T-089：页面资产库产品化和外部调用入口

- 状态：planned
- 关联需求：REQ-042、REQ-033、REQ-039
- 关联设计：DES-042、DES-033、DES-039
- 目标平台：Dashboard + REST + CLI / MCP adapter
- 修改边界：Dashboard navigation、REST routes、CLI commands、MCP tools、docs/guides
- 任务内容：
  1. [partial] Dashboard 主导航新增“页面资产库”，当前只展示“已保存页面资产”；旧“目标页面测试”页签已移除。页面列表只展示经过资产录制确认保存的页面资产，页面详情、Android / iOS 覆盖状态、AI 可读信息编辑、元素列表、转移列表和最近验证结果待补。
  2. 新增 REST：`GET /api/page-state/libraries`、`GET /api/page-state/pages`、`GET /api/page-state/pages/:id`、`PATCH /api/page-state/pages/:id`、`GET /api/page-state/transitions`、`POST /api/page-state/runs`。
  3. CLI / MCP adapter 增加 listPages、getPageDetail、searchTargets、resolveTarget、identifyCurrentPage、runToPage、getPageRunStatus、getPageRunReport。
  4. 用例库中 StructuredFlow 详情展示其引用的 PageModel / PageTransition，支持从失败步骤跳转到页面资产修复。
  5. 更新用户指南，说明页面资产、录制快照、阻断页和实验图谱的区别。
  6. 页面资产库支持合并重复逻辑页面、更新平台 profile、标记改版失效、恢复旧版本范围。
  7. 页面资产库支持编辑 targetRef、别名、业务描述、业务域、角色、意图标签和示例 AI 指令。
- 验证方式：API 测试覆盖 CRUD、设备锁、RuntimeOverlay、平台 profile 更新、AI 可读字段和 stale 标记；CLI / MCP mock REST 测试覆盖 searchTargets / resolveTarget 工具 schema；Dashboard 组件测试覆盖页面资产库浏览、AI 信息编辑、Android / iOS 覆盖状态、跳转和失败修复入口；当前已覆盖页面资产库独立模块、已保存页面资产列表、资产详情和资产录制跳转入口。

### T-090：受控探索录制与稳定性探索 PoC

- 状态：done
- 关联需求：REQ-042、REQ-032
- 关联设计：DES-042、DES-030
- 目标平台：server exploration + Dashboard advanced mode + Stability Explorer
- 修改边界：Exploration policy、candidate provider、draft asset writer、stability run service、report evidence、Dashboard exploration controls
- 交付口径：本次关闭“指定包启动后，在 App 内可控持续探索并输出可复现报告”的 PoC 第一版；draft 资产入库和一键转人工确认流程作为后续增强继续沉淀。
- 任务内容：
  1. [done] 设计统一探索策略：限制目标 App、最大步数、最大时长、允许动作、危险动作黑名单、退出条件和 seed。
  2. [done] 拆分两个产品入口：资产录制内的“自动探索”继续用于生成 draft 页面 / 元素 / 转移候选；新增独立“稳定性探索”入口用于持续探索并发现 crash / ANR / 黑屏 / 卡死 / App 退出。
  3. [done] 实现候选来源优先级：临时页 / 阻断页处理规则优先，其次使用已保存 PageElement / PageAbility，再使用带区域 OCR 候选、视觉安全区域和随机安全区域。
  4. [done] 实现探索策略：保守模式执行低风险 OCR 候选；平衡模式允许视觉候选；激进模式允许随机安全区域。
  5. [done] 探索过程不写入 active 页面资产；第一版先写 Run / StepResult / report summary，draft PageModel / PageElement / PageTransition 入库后续补。
  6. [done] 保留 seed、动作序列、每步截图、动作来源、候选过滤原因、OCR 摘要、日志 summary 和异常事件。
  7. [done] 稳定性探索支持启动 App、从当前页开始、重启 App、App 外按策略恢复 / 停止、App 内浅层回退 / 深度回溯、连续未知页停止、黑屏 / 长时间无变化检测；动作后会动态等待 H5 / WebView / 网络加载态稳定；同页候选执行后无实质变化时会跳过该候选并继续尝试其他安全候选；进入子页面并回退后会在父页面跳过已覆盖入口；从根页面 / 固定 Flow 终点开始后续补。
  8. [done] Dashboard 稳定性探索入口支持配置起始方式、最大时长、最大动作数、策略、允许动作、回退策略、最大深度、危险词、App 外处理策略、运行中提示、停止和报告入口。
  9. [todo] 探索结果可一键转入人工确认流程；确认仍走页面能力 / 连接边 / 资产录制流程。
- 当前实现说明：已新增 `platform/apps/server/src/stability-explorer.ts`，通过 `/api/stability-explorations` 启动独立稳定性探索 Run，RunConfig 记录 `runKind=stability_exploration` 和完整探索配置；起始方式支持 `launch_app`、`current_state`、`restart_app`，默认 `restart_app`；App 外处理支持 `back_to_app`、`restart_app`、`stop`，默认 `back_to_app`；回退策略默认 `shallow`，最大深度默认 4；危险词保留默认集合，并在 Dashboard 侧按 packageName 本地保存补充危险词，同一包再次选择时自动合并回显；其中 `current_state` 校验当前前台包，不满足则写入 `start_state_failed`；每轮先执行 RuntimeInterceptor 临时页处理规则，命中已保存稳定页面资产时优先使用该页面 PageAbility，再通过 Observation + OCR / 视觉 / 随机安全候选生成动作，危险词候选跳过；动作后先短等待，再轮询 Observation，遇到 `加载中`、`正在加载`、`loading`、ProgressBar 等加载态会继续等待页面稳定；如果候选执行后页面有意义签名未变化，会在当前页面签名下标记该候选为 `repeated_no_change` 并换下一个候选；如果进入子页面达到最大深度或当前页无候选，会生成 `backtrack` 动作返回上一层，并把已覆盖入口标记为 `path_explored`；动作结果写入 StepResult metadata，结束时写入 `stability-exploration-summary.json` 并生成 HTML 报告。Dashboard 已新增“稳定性探索”导航页，支持设备选择、目标包输入 / 候选、起始方式、探索策略、seed、动作集合、App 外策略、回退策略、最大深度、危险词、执行提示、最近步骤、停止和报告入口。Report Core 已新增“稳定性探索摘要”。
- 验证方式：已新增 `stability-explorer.test.ts` 覆盖配置默认值、危险词过滤、候选来源、启动指定包、当前页开始不重启 App、临时页优先处理、稳定页面 PageAbility 优先探索、动作后等待 H5 加载态稳定、同页无变化候选跳过、进入子页面后按最大深度回退、最大动作数、StepResult metadata 和 summary artifact；`App.test.ts` 覆盖导航、请求体和运行摘要；`report-core.test.ts` 覆盖稳定性探索报告摘要。后续补真实 Android 保守策略手动验证和 draft 资产入库。

## Phase 15：缺陷提报与外部系统集成

### T-091：TAPD 自动缺陷提报集成

- 状态：planned
- 关联需求：REQ-043、REQ-012、REQ-013、REQ-014、REQ-031、REQ-033、REQ-039、REQ-042
- 关联设计：DES-043、DES-016、DES-029、DES-033
- 目标平台：server defect service + report-core + Dashboard + REST / MCP adapter
- 修改边界：shared defect schema、server storage、DefectCandidate generator、TapdClient、report detail、Dashboard defect queue、external API
- 任务内容：
  1. 定义 `DefectCandidate`、`DefectFingerprint`、`DefectEvidence`、`TapdConfig`、`DefectSubmission` 和 `TapdIssuePayload`，并补 shared schema 单元测试。
  2. 新增缺陷候选存储表：`defect_candidates`、`defect_occurrences`、`defect_submissions`、`defect_integration_events`；保存 fingerprint、runId、证据、TAPD 状态和去重信息。
  3. 实现 failure-to-defect candidate generator：从 crash / ANR、步骤预期失败、PageStateFlow path_failed、视觉差异、性能劣化和 flaky 聚合生成缺陷候选。
  4. 实现 fingerprint 去重：同一 app / version / platform / test entry / failed step / error signature / expectation signature / screenshot hash 不重复创建 TAPD 缺陷，支持追加证据、忽略窗口、关联已有缺陷。
  5. 实现 TAPD client 抽象和 mock client：服务端从环境变量读取 TAPD 认证信息，构造 title、description、severity、priority、module、owner、custom fields 和附件 / 报告链接。
  6. 实现提报策略：`disabled`、`manual_review`、`auto_create`；MVP 默认 `manual_review`，`auto_create` 只允许高置信 crash / ANR / 连续复现失败或显式配置的测试计划。
  7. 新增 REST API：候选列表、run 关联缺陷、刷新候选、提交 TAPD、忽略、关联已有 TAPD、重试失败提交。
  8. Dashboard 报告详情新增“缺陷提报”区域；新增缺陷候选队列和人工审核弹窗，支持提交、忽略、关联已有缺陷、重试。
  9. Report model / HTML 报告展示缺陷状态、fingerprint、TAPD bugId、TAPD 链接、提交失败原因和候选证据摘要。
  10. CLI / MCP adapter 返回缺陷候选和 TAPD 提报状态，供 AI / CI 在执行后获取结构化结果。
- 验证方式：先写失败测试覆盖 candidate generation、fingerprint dedup、Tapd payload mapping、manual_review 不自动提交、auto_create 策略、TAPD auth failure、重复失败复用缺陷、报告展示和 Dashboard 审核交互；再实现服务端和 UI；使用 mock TapdClient，不在单元测试中调用真实 TAPD。

## Phase 16：资产驱动巡检与候选管理

### T-092：资产驱动巡检入口与执行器

- 状态：in_progress
- 关联需求：REQ-044、REQ-042、REQ-009、REQ-011、REQ-012、REQ-013、REQ-014、REQ-032
- 关联设计：DES-044、DES-042、DES-016、DES-030
- 目标平台：Dashboard + server patrol service + runner adapter + report-core
- 修改边界：AssetPatrolPlanner、AssetPatrolRunner、PageStateFlow runner adapter、Report model、Dashboard navigation、候选管理 / 资产录制跳转
- 产品口径：保留现有自动探索 / 稳定性探索入口；本任务新增独立“资产驱动巡检”，按已保存 PageStateFlow 资产做受控验证，不执行盲点探索，不自动写 active 资产。
- 任务内容：
  1. 定义 `AssetPatrolConfig`、`AssetPatrolPlan`、`AssetPatrolStep`、`AssetPatrolSummary`、`AssetPatrolFinding` shared schema，覆盖起点、页面范围、风险策略、预算、允许动作、运行期参数和报告字段。
  2. 新增 `AssetPatrolPlanner`：输入当前 Observation / target App / page scope，稳定命中 PageModel 后生成页面健康检查、区域滚动检查、元素重定位检查、连接边验证和 PageTask dry-run 计划。
  3. 新增 `AssetPatrolRunner`：复用 PageStateFlow 语义定位、TransitionWait、RuntimeInterceptor、性能采样、异常监听和报告证据；未知页、低置信、多候选和 App 外状态默认停止或诊断，不进入盲点点击。
  4. 实现页面健康检查：PageMatcher 分数、critical matcher 命中、截图重点区域相似度、OCR 区域漂移、dynamic mask 效果、页面加载耗时。
  5. 实现区域滚动检查：只在人工标注的 content / list / dynamic region 内滑动，滑动后重新识别页面并验证固定区域仍稳定。
  6. 实现 PageElement 重定位检查：OCR、crop hash/template、视觉候选或结构定位成功才允许执行低风险动作；只有 `region_center` 时输出 `runtime_relocation_required`。
  7. 实现 PageTransition 验证：按风险等级、最近失败率、业务优先级和预算排序；删除、支付、发布、提交、退出登录、确认等高风险动作默认 skipped，显式允许时才执行。
  8. 实现 PageTask dry-run：默认只验证元素引用、参数解析和提交前路径；真实业务提交必须由巡检配置或测试计划显式允许。
  9. 新增 REST API：`POST /api/asset-patrols/preview`、`POST /api/asset-patrols`、`GET /api/asset-patrols/:runId`、`POST /api/asset-patrols/:runId/stop`。
  10. Dashboard 新增“资产驱动巡检”入口：选择设备、目标 App、起点策略、页面范围、巡检预算、风险策略和运行参数；展示计划预览、运行状态、最近步骤、停止和报告入口。
  11. Report Core 新增资产巡检摘要：页面覆盖率、元素定位成功率、连接边成功率、PageTask 可执行性、跳过原因、失败分类、耗时分布、性能指标和异常事件。
  12. 候选闭环：巡检发现的新页面、新元素、新边和页面变体进入 candidate queue 或报告候选区；点击候选跳转到资产录制 / 失败修复 UI，默认不能自动写入 active 资产。若修复建议来自 REQ-045 AI 诊断且满足高置信、低风险、验证通过和自动修复策略，可通过受控 AssetPatch 流程自动应用。
- 验证方式：先写失败测试覆盖 planner 起点匹配、未知页停止、页面健康检查、区域滚动边界、元素重定位失败、region_center 禁止执行、危险边 skipped、显式允许高风险动作、PageTask dry-run、报告 summary 和 Dashboard 请求体；再实现服务端和 UI；最后用真实 Android 主流程页面跑一次资产巡检手动验证。
- 进展：
  - 已支持 `current_page` 与 `reachable_pages` 计划生成；`reachable_pages` 从当前匹配页按 active PageTransition 做受控 BFS，只覆盖已确认 PageModel，不执行未确认 OCR / UI 候选。
  - 已开放 Dashboard 巡检范围中的“可达页面”，并把计划预览按“页面 / 能力 / 连接边 / 任务”分组展示。
  - 已补齐批次失败判定与自动起点恢复：跳过项计入失败；每条边成功后利用已验证目标页作为一次性恢复提示，页面刷新匹配暂不稳定时仍能返回原起点并继续下一条边，不向用户暴露手工续跑流程。根导航只认明确名称 / `bottom-tab` 标签，局部 bottom tabs 不阻止 Back；单边失败按 fail-collect 记录后继续巡检其他独立边。
  - 已补批次级 HTML 报告和 Dashboard 报告入口，按边汇总执行结果、错误、恢复策略、恢复耗时和 fail-collect 行为；执行会话持久化每次起点恢复记录。
  - 已优化边间恢复性能：不再重新生成完整巡检计划；普通子 Activity 使用轻量 foreground component 观测和受控 Back 恢复，同一 Activity 内根页面切换继续使用正式 PageTransition / 视觉 PageMatcher；恢复前可统一执行 `hide_keyboard`。
  - `reachable_pages` 的边预算已改为按已发现页面轮转分配，并过滤返回批次起点、非起点根 Tab 互跳等恢复型导航；非起点页的 OCR / 视觉动作允许依据已保存的 runtime locator 进入执行队列，到达来源页后再做真实重定位。
  - 已补顶部头像专用视觉定位，`主页 -> 设置` 不依赖 Android UI tree、平台 id 或固定坐标。
  - 真机 `ERLDU20115007395 / YAL-AL10` 批次 `asset_execution_51716a0e-1eac-46aa-8505-193374da7f7b` 已验证主页 8 条出口边 8/8 通过；每条边完成后自动恢复主页继续，包含 `加入班级 -> 主页 -> 课程表` 的多 Back 恢复和头像入口设置页定位。
  - 真机批次 `asset_execution_61331554-a760-4bfe-b8f6-8cac63d9d7f2` 已验证有限预算下覆盖二级页面：`主页 -> 班级聊天（经班级详情）`、`主页 -> 学习方案（经班级详情）` 与其余 5 条可执行边全部通过；危险发布边保持 skipped。
  - `tagged_pages` 与 `all_active_pages` 仍保留为后续入口，当前 UI 禁用且请求会回退到 `current_page`。

### T-093：探索异常 AI 诊断与受控资产修复

- 状态：planned
- 关联需求：REQ-045、REQ-044、REQ-043、REQ-042、REQ-039、REQ-032、REQ-012、REQ-013、REQ-014
- 关联设计：DES-045、DES-044、DES-043、DES-042、DES-039、DES-030
- 目标平台：server diagnosis service + MCP / REST adapter + report-core + Dashboard repair UI
- 修改边界：StabilityExplorer、AssetPatrolRunner、GraphRunService / AutomationRunner failure path、RunArtifactService、PageState asset storage、MCP adapter、Report model、Dashboard 报告和失败修复 UI
- 产品口径：AI 只负责异常诊断和受控资产修复，不参与正常步骤规划，也不直接控制设备；当策略开启且满足高置信、低风险、可验证和预算约束时，AI 提出的 patch 可以由系统自动应用为新的 active 资产版本，否则保持草稿或人工确认。
- 任务内容：
  1. 定义 `AiDiagnosisEvidencePack`、`AiDiagnosisRequest`、`AiDiagnosisResult`、`AssetPatchCandidate`、`AssetPatchValidationResult` shared schema，并补 JSON schema / fixture 测试。
  2. 新增 `EvidencePackBuilder`：从 Run、StepResult、Observation、matcher diagnostics、locator diagnostics、runtime events、performance samples、screenshots、logs 和 current graph assets 汇总脱敏证据包。
  3. 新增 `RuleFailureClassifier`：优先识别 crash、ANR、黑屏、App 退出、系统弹窗、fatal log、页面未匹配、元素重定位失败、边缺失、任务参数缺失、性能劣化等确定性类型。
  4. 新增 `AiModelClient`：第一版实现 OpenAI-compatible provider，配置 `baseUrl`、`apiKey`、`model`、`timeoutMs`、`extraHeaders`，并提供 mock provider 单元测试。
  5. 新增 `AiDiagnosisService`：构建 prompt、调用模型、校验 JSON schema、超时 / 限流 / 解析失败 fallback 到规则诊断，并把 prompt 摘要和响应保存为 artifact。
  6. 新增 `DiagnosisPolicyEngine`：根据分类、置信度、严重级别、策略预算和风险配置，决定 `report_defect`、`restart_and_continue`、`propose_asset_patch`、`retry_once` 或 `stop_for_review`。
  7. 新增 `AssetPatchService`：允许 AI 提交受控 patch，覆盖 OCR 别名、截图重点区域、动态 mask、PageElement 定位、PageTransition candidate、页面变体 candidate 和 asset stale 标记；支持 `draft`、`validated`、`auto_applied`、`applied`、`rejected`、`rolled_back` 状态；禁止写平台依赖 matcher、历史 region_center 或直接删除 active 资产。
  8. 新增 `AssetPatchValidator`：对 patch 执行页面匹配、元素重定位、连接边轻量验证或离线证据验证；验证失败保持 draft 并进入人工复核；验证通过且策略允许时可自动生成 active 资产版本并返回回滚点。
  9. 在 `StabilityExplorer`、`AssetPatrolRunner` 和目标执行失败路径接入诊断：异常先固化证据，再调用诊断；业务异常生成缺陷候选 / 报告，资产问题按策略生成草稿或自动应用已验证 patch 后继续。
  10. 新增 MCP / REST 工具：`get_run_context`、`get_failure_evidence`、`list_page_assets`、`get_page_asset`、`propose_page_asset_patch`、`validate_page_asset_patch`、`apply_page_asset_patch`、`rollback_page_asset_patch`、`create_defect_candidate`、`continue_exploration`。
  11. Report Core 新增 AI 诊断区：展示分类、置信度、推荐动作、证据引用、缺陷候选、资产 patch、验证结果和继续执行策略。
  12. Dashboard 失败修复 UI 新增“AI 诊断 / 资产修复”区域，支持查看证据、查看自动应用记录、接受 / 拒绝 patch、触发验证、回滚、继续执行或转缺陷。
- 验证方式：先写失败测试覆盖证据脱敏、规则分类、模型 JSON 校验、模型失败 fallback、crash 不走资产修复、页面未匹配生成 asset patch、非法 patch 被拒绝、patch 验证通过后按策略自动应用并继续、低置信进入人工复核、自动应用预算、回滚、MCP 工具权限和报告展示；再实现服务端和 UI；最后用真机模拟页面未匹配、元素重定位失败和 crash 三类场景手动验证。

## Phase 17：资产衍生组合测试

### T-094：参数集、元功能和组合用例闭环

- 状态：done
- 关联需求：REQ-ADT-004、REQ-ADT-006、REQ-ADT-007、REQ-042
- 关联设计：DES-046、DES-042、DES-039、DES-016
- 目标平台：shared + server + Dashboard + report + Android real device
- 修改边界：组合资产 schema、SQLite storage、资产编译器、组合执行会话、REST API、Dashboard 资产用例面板、HTML 报告
- 已完成：
  1. 新增 Parameter Profile、Meta Function、Asset Composite Case shared model 和 SQLite CRUD，保存版本号、App / 平台归属、参数类型、步骤顺序和执行策略。
  2. 新增资产目录与编译器，解析当前 active PageModel、PageElement、PageTransition、PageTask，合并参数并在执行前校验资产引用和必需参数。
  3. 新增组合执行管理器，按顺序复用 GraphRunService 执行到页、页面能力、PageTask 和页面验证，支持单次、N 次、循环直到停止、失败停止、主动停止和运行态查询。
  4. 新增 REST API，覆盖参数集 / 元功能 / 组合用例 CRUD、资产目录、预检、执行、停止、状态和 HTML 报告。
  5. Dashboard 新增“资产用例”入口和参数集 / 元功能 / 组合用例三视图，支持资产选择、步骤排序、预检、执行和报告入口。
  6. 新增 OCR 相对结构输入定位，允许通过稳定锚点找到动态已有值输入行；“新建课堂”标题输入资产已从固定截图区域迁移为 runtime structural locator。
  7. 真机完成 `进入指定班级 -> 创建课堂但不发布`：参数 `className=班级四十二号`、`lessonName=自动化组合课堂`、`duration=30`，5/5 资产步骤通过，最终停留在发布前页面。
- 后续：参数反向引用展示、从成功执行一键保存元功能草稿、定时调度和资产包迁移由独立任务承接，不阻塞 v1 使用。

## Phase 18：Android App 旁路监控

### T-095：Android App 旁路性能与稳定性监控内核

- 状态：planned
- 关联需求：REQ-046、REQ-011、REQ-012、REQ-013、REQ-014、REQ-043、REQ-045
- 关联设计：DES-047、DES-014、DES-015、DES-016、DES-043、DES-045
- 目标平台：Android Driver + server Runner adapters + Storage artifacts + Report Core + Dashboard run config
- 修改边界：`platform/packages/android-driver`、`platform/apps/server/src/automation-runner.ts`、`platform/apps/server/src/graph-run-service.ts`、`platform/apps/server/src/asset-patrol.ts`、`platform/apps/server/src/stability-explorer.ts`、`platform/packages/report-core`、Dashboard 执行配置和报告入口
- 产品口径：新增目标 App 级旁路 watcher；Runner 继续负责动作执行，旁路 watcher 负责监控包名对应进程、性能阈值、稳定性事件和现场证据。
- 任务内容：
  1. 定义 shared / driver 层配置和结果类型：`AndroidAppMonitorConfig`、`AndroidProcessInfo`、`AndroidProcessMetricSample`、`AndroidProcessLifecycleEvent`、`AndroidAppMonitorIncident`、`AndroidAppMonitorSummary`。
  2. 新增 `AndroidProcessDiscovery`，兼容 `ps -A -o PID,NAME`、旧版 `ps`、`dumpsys activity processes` 和 `/proc/<pid>/cmdline` 校验，支持 `main`、`:suffix`、完整进程名过滤。
  3. 新增进程级 CPU / PSS sampler：CPU 用 `/proc/stat` + `/proc/<pid>/stat` 差分计算单核归一化百分比；内存用 `dumpsys meminfo` 解析 PSS 和 App Summary 分类。
  4. 新增 `ThresholdTracker` 和 per-process tracker pool，支持 CPU / 内存阈值、`sustainMs`、`cooldownMs`、峰值记录和告警状态机。
  5. 新增 incident dumper：CPU 告警抓 `top -H` 或 `/proc/<pid>/task` fallback；内存告警抓 `dumpsys meminfo -d` 文本和解析 JSON；heap dump 默认关闭，只在显式配置时尝试。
  6. 增强 Android logcat watcher：读取 main / system / events / crash buffer，解析 Java Crash、Native Crash、ANR、process death，并按时间窗口去重。
  7. 新增 `AndroidAppMonitorSession`，管理进程发现、采样循环、logcat watcher、artifact writer、status heartbeat、bounded dump 并发和 stop / flush 生命周期。
  8. 接入 Runner：AutomationRunner、GraphRunService、AssetPatrolRunner、StabilityExplorer 在 Run 开始时按 RunConfig 启动 monitor，在 finally 中停止；事件尽量关联 active stepResultId。
  9. 存储策略：高频 `cpu.csv`、`memory.csv`、`lifecycle.csv`、`monitor-summary.json` 写入 artifact；Storage 只保存 DeviceEvent、ArtifactRef 和必要 summary，不把高频样本全部塞进 `metric_samples`。
  10. Report Core 新增“目标 App 旁路监控”区块，展示包名、进程列表、阈值、CPU / 内存统计、生命周期、incident、稳定性事件、采样失败和证据链接。
  11. Dashboard 执行配置、稳定性探索、资产巡检和 CI/CLI 入参支持 monitor 开关、阈值、采样间隔、进程过滤、heap dump 开关；默认开启轻量监控，heap dump 默认关闭。
  12. 缺陷候选和 AI 诊断接入：crash / ANR / process death / 持续 CPU 或内存超阈可进入 DefectCandidate 和 AiDiagnosisEvidencePack。
- 验证方式：先写失败测试覆盖进程发现解析、cmdline 截断校验、CPU / PSS 解析、阈值 sustain / cooldown、CPU / 内存 incident dumper fallback、Java / Native / ANR / process death parser、事件去重、monitor session stop flush、Runner 接入、Report 展示和 Dashboard 配置；再实现代码；最后用真实 Android 设备运行 `cn.eeo.classin` 5 分钟，确认自动发现主进程与 `:privileged_process0`，报告生成 CPU / 内存曲线、生命周期和至少一次阈值 / clean 结果。
