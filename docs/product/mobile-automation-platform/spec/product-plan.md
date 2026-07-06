---
title: 自动化测试平台产品规划
doc_type: product-plan
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-06
updated_at: 2026-07-06
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台产品规划

## 规划结论

当前主要项目目标正式命名为：

> PageStateFlow：页面状态资产驱动的移动端智能回放测试平台。

平台目标不应停留在“录制坐标然后回放”，也不应在当前阶段追求穷尽全 App 所有状态的全局业务图谱。新的主线是维护可复用的页面状态资产：平台按 App、平台和版本保存每个稳定页面 / 页面变体的识别规则、截图锚点、UI dump、可操作元素、动作能力、跳转关系和阻断页处理策略。录制、自动探索、源码扫描和人工标注都只是补充页面资产库的入口；执行时平台基于当前 Observation 识别所在页面，从页面资产库中规划到目标页面 / 目标操作的路径，并按统一测试规则执行与验证。

v2.0 的产品目标应升级为：

> 面向 Android / iOS 应用包、设备、测试流程、性能指标和测试报告的移动端持续质量保障平台。

新的核心底座是 `PageStateFlow`。`PageModel` 表达一个稳定页面或页面变体，`PageElement` 表达页面上的可操作元素，`PageTransition` 表达某个页面动作会导航到另一个页面、打开弹层、产生局部状态变化或保持在当前页面。`StructuredFlow` / Smart Recorded Flow 继续保留，但定位调整为“基于 PageStateFlow 生成的线性路径快照 / 回归用例”：它适合固化某次关键路径、支持执行到中间步骤和临时预期覆盖，但不再是唯一的长期资产形态。

此前的 `BusinessGraph`、源码扫描、目标节点路径规划和候选资产治理保留为实验能力和未来扩展入口。它们沉淀出的 `StateMatcher`、`ActionPolicy`、`RuntimeOverlay`、`Observation`、动态等待和 Runtime Interceptor 等底层能力继续复用于 PageStateFlow；全局业务节点图不作为当前默认主线继续扩张，除非后续有明确产品决策重新打开。

第一阶段继续强化浏览器内远程操控、页面状态识别、页面资产录入、页面转移学习、结构化回放、执行报告和异常证据闭环。第二阶段引入包管理、SMB 拉包、新包冒烟、页面资产跨版本验证、版本性能并排对比、自动触发和企业微信通知。第三阶段再扩展 PageStateFlow REST / CLI / MCP、AI/CI 动态预期验证、跨版本趋势和团队级质量看板。实验性业务图谱能力保留在独立入口，不应挤压页面资产库、录制和回放主流程。

产品形态上的关键结论：

- 页面资产库是当前主线事实来源；它保存“这个页面是什么、怎么识别、能做什么、做完会到哪里”。
- 页面资产必须按逻辑页面 key 跨端复用，例如 `home` / `teacher_class_list` / `lesson_create` 只建一份逻辑 PageModel。正式 PageModel 身份优先使用跨端 portable 的 OCR、截图重点区域和 `semantic_image_region`；Android activity、resource-id、accessibility id、iOS WDA source / accessibility label 等平台字段只进入平台 profile、候选发现或调试证据，不作为正式页面身份。
- 录制不是为了无限保存线性脚本，而是边操作边沉淀 PageModel、PageElement 和 PageTransition。
- StructuredFlow 是页面路径的一次可执行快照，可作为回归用例、问题复现用例和 AI/CI 调用入口。
- 自动测试产品形态拆成三层：目标驱动编排验证核心业务，资产驱动巡检验证已录入资产和主流程覆盖，自动探索 / 稳定性探索发现未知页面和异常状态。三者共享 Observation、语义定位、报告和性能监控，但入口、执行策略和资产写入权限必须隔离。
- Runtime Interceptor 用于处理权限、升级、公告、选择学科等临时阻断页面；这些阻断不进入主业务页面路径。
- 坐标只作为 fallback 证据，稳定 PageStateFlow 资产优先使用 OCR、图像区域、页面截图锚点和人工确认的语义区域。resource-id、accessibility id、content-desc、UIAutomator / WDA 文本等平台信号只能辅助候选生成、调试解释或平台专属 fallback，不能绕过人工确认成为正式页面身份。
- 当某个平台缺少专属证据时，平台可以使用跨端通用的截图区域、OCR 文本、布局描述和页面语义进行低置信执行；执行报告必须提示“缺少该平台精确识别 / 定位信息”，并引导补录该平台 profile。

## 行业做法参考

| 方向 | 主流做法 | 对本平台的启发 |
|---|---|---|
| 跨平台自动化底层 | Appium 将核心 API、Driver、Client、Plugin 分层，按平台安装对应 Driver。 | 保持当前 Driver 抽象，Android / iOS 能力差异通过 capabilities 暴露，不把平台命令散落在业务层。 |
| 流程用例表达 | Maestro 使用 YAML Flow 描述用户旅程，包含 appId、标签、环境变量、命令、断言、条件、循环等。 | 录制结果应能导出为可读 Flow，也支持用户手写或导入 Flow；流程不是只能来自录制。 |
| 稳定回放模型 | 主流平台不会只验证“动作是否下发”，会把动作后的页面、元素、文本、图像、日志、性能和崩溃状态作为每一步的验证依据。 | 固定流程需要步骤级预期验证：每一步都能输入 expected，并在报告中展示 actual；状态锚点和语义动作用于提升执行稳定性。 |
| 录制定位模型 | Appium Inspector 通过 Source 树、Selected Element 和 Suggested Locators 帮助用户生成元素定位；截图区域 tap / swipe 只是通用兜底。 | 本平台录制不能长期停留在坐标点击，应在坐标之外生成元素、文字、图像 / 区域候选目标，并允许用户确认转换。 |
| 手工会话修复 | Kobiton 等平台会把手工 session 转成可复跑用例，并在元素跨设备失效时提供重新选择 / remediation；网络、日志、截图等证据进入 session。 | 回放失败后应支持修复目标定位，而不是只重录坐标；报告继续沉淀视频、截图、日志、网络等证据。 |
| 自动探索冒烟 | Firebase Test Lab Robo 会分析 UI 并自动探索，记录日志、截图、视频和 crawl stats；遇到非标准 UI 时会使用半随机点击，也支持脚本补充。 | 新包冒烟建议采用“固定关键流程 + 可控随机探索”的组合，而不是纯随机或纯固定。 |
| 报告证据 | Allure 支持把截图、视频、文本、JSON、YAML 等附件挂到测试结果或具体步骤上。 | 继续保留每步截图，每次执行均保留视频；报告内要把视频、截图、日志和指标关联到步骤。 |
| 应用包管理 | BrowserStack / Sauce Labs 等会先上传 APK/AAB/IPA 到应用存储，再选择设备执行。 | 平台需要 Build Registry：记录包来源、版本、渠道、校验值、安装状态和测试历史。 |

## 内部项目借鉴

本规划已参考 `ClassInAutoTest` master 分支和 `repo-profile` 分支，但只吸收产品与架构思路，不直接搬运其桌面技术栈或代码。

| 借鉴点 | 可吸收内容 | 落到本平台的规划 |
|---|---|---|
| Action / Session 模型 | 操作步骤带 `delay`、`timestamp`，拖拽保留路径，录制会话保存屏幕 / 窗口上下文。 | 强化 ActionStep / Flow 元数据：保存坐标空间、设备分辨率、预览渲染区域、方向、截图和录制来源。 |
| 录制 / 回放状态机 | 录制、暂停、恢复、停止、循环次数、当前步骤都有明确状态。 | Runner、Recorder 和 Dashboard 必须共享可测试状态机，并在报告中保留执行进度。 |
| 包下载 / 安装状态流 | SMB 拉包和安装流程按步骤展示下载、连接、安装、失败原因。 | BuildDownloadService / BuildInstallService 必须输出可观察状态，Dashboard 包管理页展示每个阶段和错误。 |
| 动作列表 UI | 操作卡片用图标、颜色、序号、关键参数和时间信息表达。 | Web 步骤编辑器需要做成高信息密度步骤卡片，支持快速扫读和定位失败步骤。 |
| MCP 工具接口 | 通过 MCP 暴露分支查询、触发构建、发送提测单等工具。 | 后续提供外部工具接口，允许 CI、CLI、MCP 或 AI Agent 发起冒烟、查询报告、触发通知。 |
| repo-profile 分支 | `.ai/repo-profile.yml` 和 `.ai/context-guide.md` 作为仓库导航。 | 本项目也应维护 `.ai/` 仓库导航，但正式需求和任务仍以 `docs/product/.../spec/` 为事实来源。 |

反向约束：

- 不借鉴明文 token、SMB 密码、Webhook key 写入代码的做法；所有敏感配置必须通过环境变量、配置文件或部署密钥注入。
- 不借鉴仓库中混放临时脚本、输出文件和运行数据的组织方式；运行数据继续外置到 `<DATA_DIR>`。
- 不把 KMP / Compose Desktop 作为本平台技术路线；本平台继续采用 Web Dashboard + Backend + Driver 的形态。

参考资料：

- Appium 文档：https://appium.io/docs/en/latest/intro/
- Appium Inspector Source：https://appium.github.io/appium-inspector/2024.8/session-inspector/source/
- Appium Inspector Recorder：https://appium.github.io/appium-inspector/2024.8/session-inspector/recorder/
- Kobiton Element Selection Remediation：https://docs.kobiton.com/test-management/remediation/element-selection-remediation
- Kobiton Network Payload Capture：https://docs.kobiton.com/manual-testing/local-devices/capture-network-payload-data
- Maestro Flow 文档：https://docs.maestro.dev/maestro-flows
- Firebase Test Lab Robo 文档：https://firebase.google.com/docs/test-lab/android/robo-ux-test
- Allure 附件文档：https://allurereport.org/docs/attachments/
- Sauce Labs Mobile App Storage：https://docs.saucelabs.com/mobile-apps/app-storage/
- BrowserStack App Automate 上传示例：https://www.browserstack.com/docs/app-automate/appium/getting-started/java/integrate-your-tests

## 产品能力域

### 0. PageStateFlow 与页面资产域（当前核心底座）

目标：平台独立于业务源码运行，核心资产从“全局业务节点图”收敛为“页面状态资产库”。系统先认识页面，再认识页面上的可操作元素，最后沉淀页面之间的转移关系；录制回放、自动探索和 AI/CI 验证都围绕这套资产执行。

核心模型：

| 对象 | 说明 | 示例 |
|---|---|---|
| PageStateLibrary | 某个 App、平台和版本范围下的页面资产库。 | ClassIn Android Page Library |
| PageModel | 一个跨平台逻辑页面、弹层或页面变体模板。 | 首页、教师班级列表、班级详情 |
| PlatformPageProfile | 同一逻辑页面在某个平台 / 版本范围下的识别和执行证据。 | Android 首页 profile、iOS 首页 profile |
| PageMatcher | 页面识别规则，正式资产只组合 portable OCR、截图重点区域、`semantic_image_region` 和人工确认的区域约束；平台字段只做候选 / 调试。 | 标题栏“新建公开课” OCR + 顶部截图重点区域 |
| PageElement | 页面上的可操作元素或区域。 | 第一个班级卡片、右下角加号、课堂入口 |
| LocatorCandidate | 元素定位候选，按当前技术栈可用性和人工确认程度排序；正式执行优先使用人工截图区域、OCR 重定位和滚动容器描述，平台 locator 只做可选 fallback。 | OCR 文案重定位 > image region > 滚动容器候选 > 坐标 fallback |
| PageTransition | 某个 PageElement 动作导致的结果。 | tap 加号 -> 发布活动弹层 |
| PageVariant / Overlay | 页面局部状态、菜单、弹层或阻断页。 | 权限弹窗、升级提示、选择学科临时页 |
| PathPlan | 从当前页面到目标页面 / 目标元素动作的规划结果。 | 首页 -> 教师列表 -> 班级详情 -> 发布活动 |
| StructuredFlow | 从页面资产库生成或录制固化的一条线性路径快照。 | ClassIn-5.0.8-教师列表-新建课堂 |

执行流：

```text
collect Observation
  -> match current PageModel
  -> if outside target app: apply start strategy and re-observe
  -> plan path from current PageModel to target PageModel / target action
  -> for each PageTransition:
       wait source PageMatcher
       run RuntimeInterceptor for blocking overlays
       resolve PageElement locator by priority
       execute action through action backend
       poll Observation until transition outcome is satisfied
       collect screenshot, video timestamp, logs, metrics
       write expected / actual and evidence
  -> generate PageStateFlow report and optional StructuredFlow snapshot
```

页面资产建设方式：

- 手工录制：用户每完成一步，平台保存 before PageModel、PageElement action、after PageModel / Overlay 和 transition expectation。
- 当前页面识别 / 标注：用户可把当前设备页面保存为 PageModel，并圈选主要截图区域和可操作元素。
- 页面身份标注：用户确认的标题栏、页面主体和稳定业务区域可以成为 PageMatcher；全屏 OCR / UI 文本只作为候选，OCR 候选确认时必须绑定相对区域、视觉语义区域和坐标空间，并保存为 `ocr_text:文案@region(x,y,width,height)`。底部 Tab、固定导航栏和全局入口默认作为 PageElement / PageTransition 操作资产，不作为页面身份 critical matcher。
- 视觉区域资产：用户圈选区域不是单纯固定坐标，而是“原始截图相对矩形 + semanticArea + coordinateSpace + baseline / OCR / layout 证据”。`semanticArea` 只保留 `top` / `content` / `bottom` / `unknown` 四个大区；旧细分区域数据不做兼容映射，异常资产删除后重新录入。运行时 PageMatcher 允许同一语义区域内的小幅漂移，执行 `tap_on_image` 时必须先按 OCR、crop hash/template、视觉候选或结构候选在当前截图中重定位；找不到时失败并进入 locator 修复，不再退回人工区域中心点。
- 页面操作资产：每个 PageModel 维护本页可执行的 PageElement / PageAbility 入口，而不是把菜单、临时黑条、底部面板和动态卡片都拆成独立页面。资产录制阶段先按能力类型录入区域和参数：`fixed_tap` 表示固定位置点击，`scroll_candidate` 表示在内容区滚动查找某个 OCR / 图像目标，`grid_candidate` 表示动态列表 / 两列网格中的候选入口，`conditional_tap` 表示只在条件满足时出现的点击能力；连接边阶段再选择已保存 PageElement、执行动作并确认目标页面 / 页面内状态，沉淀为 PageTransition。对于“主页两列班级列表 -> 班级详情 -> 有 add 按钮才可创建课堂”这类场景，主页只录入“打开班级详情”的 `grid_candidate` 能力：圈选列表容器，保存列数、候选 item 高度、点击安全点、滑动步长和失败策略，并在跳转页面类型下绑定“班级详情”目标页面；班级详情再录入“创建课堂”的 `conditional_tap` 能力。如果业务目标要求进入指定数据项，例如“进入 {{className}} 这个班级再创建课堂”，`grid_candidate.scrollProfile.targetQuery` 可以保存 `{{className}}` 模板，目标页面测试通过运行参数 `className=班级四十一号` 注入；运行时只在人工圈选的列表 / 网格区域内 OCR 查找该文本，找不到时按容器滑动继续查找，最终仍找不到则失败并报告，不得退化为随便点击第一个候选。对于会随滚动出现的图标 / 图片按钮，录入 `scroll_candidate + targetKind=image_region`，执行时在内容区循环截图查找该图像目标。已绑定目标页面的 `navigate` PageAbility 会在路径规划和执行时临时转成 active route edge；未绑定目标页面的跳转能力会在保存或 route-plan 中提示，不参与规划。`grid_candidate` 运行时按视觉区域和安全点点击候选，不依赖 UIAutomator dump。同屏候选一期开通：非指定候选的下游失败重规划时会按 recovery attempt 尝试下一个候选；跨屏滚动翻页继续作为后续增强，而不是把每个班级卡片或每种账号数据保存成页面。
- 自动探索：平台只针对已识别为已保存 PageModel 的当前页运行，V1 做当前页一跳探索，V2 做受深度和动作数限制的多层探索。候选来源优先使用已录入 PageElement / PageAbility，其次使用带区域的 OCR 文本候选；删除、退出登录、支付、发布、提交、确认等危险文案默认标记为 skipped。自动探索只生成候选、执行报告、新页面候选和异常证据，不直接写入正式 PageMatcher、PageElement 或 PageTransition；用户确认后仍通过“页面能力”和“连接边”流程入库。探索采集默认使用快速视觉模式（截图 + OCR + 已有视觉基线匹配），不依赖 UIAutomator / WDA 作为主路径。
- 资产驱动巡检：作为独立于“目标执行”和“自动探索 / 稳定性探索”的产品入口，按已保存 PageModel 识别当前页面，再读取该页 PageElement、PageTransition、PageTask 和人工标注区域生成巡检计划。巡检先做页面健康检查、内容区滚动检查、元素重定位检查，再按风险策略验证连接边和轻量 PageTask；未录入为正式资产的 OCR / UI 候选只进入建议，不直接执行。巡检报告输出页面覆盖率、元素定位成功率、连接边稳定性、路径缺口、性能耗时、异常事件和修复入口。
- AI 异常诊断：正常执行仍由 PageStateFlow / 资产巡检规则驱动，AI 不参与常规路径规划和设备控制；当执行出现 crash / ANR、页面匹配失败、元素重定位失败、状态迁移失败或资产巡检异常时，系统生成脱敏证据包并调用大模型做归因。AI 输出必须是结构化 JSON，分类为 App 问题、资产问题、自动化系统问题、环境问题或未知；如果判断为资产问题，可以生成受控的 `AssetPatchCandidate` 草稿。后续自动应用只允许在高置信、低风险、可验证且不依赖设备坐标的修复上开启，并必须保留诊断附件、修复 diff 和验证结果。
- 稳定性探索：作为独立于目标执行和资产录制的测试入口，用于启动 App 后持续探索安全点击 / 滑动位置，发现 crash、ANR、黑屏、卡死、App 退出、未知页面和不可恢复状态。它类似视觉版 Monkey / Fastbot，但必须受最大时长、最大步数、危险词、黑名单区域、App 外恢复和 seed 复现约束；探索出来的新页面 / 新边 / 新能力只进入 draft 候选，不直接污染正式页面资产库。
- 源码 / UI dump 辅助：源码、UIAutomator dump、WDA source、OCR 和截图分析只作为候选生成来源，不直接发布正式资产；其中 UIAutomator / WDA / resource-id / accessibility-id 相关信息必须留在 raw/debug evidence 或平台 profile，不能进入 active PageMatcher 白名单。
- AI / CI 动态验证：AI 可请求执行到某个 PageModel 或运行某条 StructuredFlow，并临时覆盖目标预期。

### 0.1 StructuredFlow 与测试规则域（当前执行快照）

目标：平台独立于业务源码运行，核心测试资产是一条条结构化录制用例。最终测试以“按确定流程执行并逐步验证”为中心，而不是以“全局 App 地图自动规划任意目标节点”为中心。

核心模型：

| 对象 | 说明 | 示例 |
|---|---|---|
| StructuredFlow | 一条有限范围、可复用、可验证的测试流程。 | ClassIn-5.0.8-教师首页-新建课堂 |
| TestRuleStep | Flow 内的单个规则步骤。 | beforeState -> tap_on_element -> afterExpectations |
| FlowStateAnchor | 步骤前置或终点状态锚点。 | 区域 OCR + 截图重点区域 + 页面语义说明 |
| StateMatcher | 判断状态是否成立的组合规则；PageStateFlow 正式资产只允许 portable visual / OCR 身份进入 active matcher。 | OCR 标题 + image_region baseline + semantic_image_region |
| ActionPolicy / semantic action | 描述动作意图和定位优先级。 | 先按 OCR / image region 重定位，再按人工区域中心兜底 |
| StepExpectation | 步骤完成后的可判定预期。 | 出现指定控件 / 文案、无 crash、App alive |
| RuntimeOverlay | 一次运行时临时覆盖的预期。 | AI 改文案后传入“页面显示 yyy” |
| RuntimeInterceptor | 处理权限、升级提示、公告、loading 等运行时扰动。 | 看到“允许”则点击并继续当前步骤 |

StructuredFlow 执行流：

```text
load StructuredFlow
  -> verify target app and optional app version
  -> apply start strategy when needed
  -> for each enabled TestRuleStep:
       wait / verify beforeState
       run RuntimeInterceptor for blockers
       resolve semantic action target
       execute action through driver
       poll Observation until afterExpectations pass or timeout
       collect screenshot, video timestamp, logs, metrics
       write expected / actual and evidence
  -> generate report and structured result
```

业务图谱实验能力：

| 能力 | 当前定位 |
|---|---|
| BusinessGraph / BusinessNode / OperationEdge | 高阶实验资产，不作为默认产品主线。 |
| SourceScanner / ExplorationEngine | 冻结为实验能力；不继续扩展，除非明确重新打开。 |
| RoutePlanner / GraphRunner | 保留已实现入口和回归测试，作为未来图谱方向验证，不替代 FlowRunner。 |
| Candidate validation / auto promotion | 冻结为候选治理实验，不要求维护者逐条 review，也不进入当前 MVP 主闭环。 |
| Graph Dashboard | 降级为“实验能力”入口，避免和用例库 / 录制 / 执行结果抢主心智。 |

AI / CI 验证闭环应优先以 StructuredFlow 为入口：

- 外部工具选择已有 Flow、设备和包版本。
- 可传入 RuntimeOverlay 临时覆盖某一步或终点预期。
- 平台复用同一 FlowRunner、设备锁、视频、截图、日志、性能采集和报告生成。
- 失败返回区分前置状态不满足、语义定位失败、后置预期失败、crash / ANR、设备问题和性能问题。

新旧能力关系：

- legacy 坐标录制回放保留兼容，但新录制和新执行入口默认保存 / 执行 StructuredFlow。
- 用例库升级为 StructuredFlow 测试资产库，承载结构化流程、步骤详情、预期编辑、执行到中间步骤和最近结果。
- 执行引擎从“线性动作下发”升级为“TestRuleStep 执行器”：beforeState -> action -> afterExpectations -> systemGuards -> evidence。
- 报告从单纯步骤列表升级为“每步 expected / actual + 截图 / 视频 / 日志 / 性能 / 异常证据”的报告。
- 业务图谱上层不删除、不强制迁移旧数据，但只保留为实验入口；当前主流程不再要求录制结果写入全局图谱。

### A. 设备管理域

目标：管理 Android / iOS 设备、能力、占用和运行状态。

当前已在规划内：

- 设备发现。
- 实时预览。
- 浏览器内远程操控。
- 录制和回放。
- 设备锁与并发控制。

后续增强：

- 设备分组，例如冒烟设备组、性能基线设备组、兼容性设备组。
- 设备标签，例如系统版本、机型、屏幕尺寸、是否稳定机、是否专用于 CI。
- 设备健康检查，例如 WDA 是否可达、ADB 是否授权、磁盘空间、网络状态。

### B. 应用包管理域

目标：平台不仅管理设备，也管理被测应用包。

核心对象：

- Android APK / AAB。
- iOS IPA。
- 包来源：SMB 路径、本地上传、构建产物目录、CI 回调、HTTP 下载 URL、内部包服务。
- 包元数据：应用 ID、版本号、versionCode/build number、commit、分支、构建时间、构建人、渠道、环境。
- 版本唯一标识：建议使用 `versionName + buildNumber + commitId` 标识一次构建。
- 安装状态：已安装设备、安装时间、安装失败原因。

建议能力：

- 注册 App 实体，例如 ClassIn Android / ClassIn iOS。
- 上传或登记应用版本。
- 通过 SMB 目录模板扫描最新包，并按文件名规则解析版本号、构建号、分支等信息。
- 接收 CI/CD Webhook，把包版本、commit、分支和下载地址登记为 AppVersion。
- 对指定设备安装、覆盖安装、卸载、清理数据。
- 安装前后校验目标 App 版本。
- 记录每个包跑过哪些测试、在哪些设备上跑、结果如何。
- 支持“同一流程在不同包之间对比”。

MVP 建议先做 Android APK：

- 手动上传、配置本地 APK 路径，或从 SMB 路径拉取 APK。
- 安装到选中 Android 设备。
- 配置 package name。
- 执行前可选择覆盖安装、重启 App、清理数据。

### C. 测试流程域

目标：流程不仅可以录制，也可以人工编排、导入、参数化和断言。

推荐把测试流程分成三类：

| 类型 | 说明 | 典型用途 |
|---|---|---|
| 录制流程 | 用户在预览页操作，平台生成步骤。 | 快速生成回归路径、问题复现路径。 |
| 手写流程 | 用户用可视化编辑器或 YAML/JSON 描述动作和断言。 | 稳定冒烟、核心业务流、CI 长期维护流程。 |
| 探索流程 | 平台按规则自动探索或随机打乱一组动作。 | 新包粗筛、未知崩溃发现、UI 健康检查。 |

固定流程不能只理解成“按录制坐标重放”。更稳定的模型是“动作 + 预期 + 验证证据”：

1. 先定义流程起始状态，例如回到 Home、启动 App、重启 App、清理数据后启动、安装指定包后启动。
2. 再为每个关键步骤定义执行后的预期结果，例如看到某段文字、某个区域与基准图匹配、App 仍然存活、无 crash / ANR、耗时不超过阈值。
3. 平台把用户输入的预期保存成结构化 `StepExpectation`，自然语言只通过规则模板生成候选项并由用户确认。
4. 回放时每一步动作执行完成后验证 expected / actual，并把截图、视频时间点、日志、OCR、图像差异或指标作为证据写入报告。
5. 对滑动、等待、点击等易受当前页面影响的动作，再额外使用状态锚点和语义动作，例如 `scroll_until_visible`、`wait_until_visible`、`tap_on_text`、`tap_on_image`，用于保证动作在正确上下文中执行。

坐标型 `tap` / `swipe` 仍保留，用于快速录制和 fallback；长期稳定的冒烟、回归和性能流程应逐步使用步骤预期、状态锚点和语义动作。

录制定位模型建议按可靠性分层：

| 目标类型 | 适用场景 | 可靠性 | 说明 |
|---|---|---|---|
| 文字目标 | 页面标题、按钮文字、弹窗文字稳定。 | 高 | 通过 OCR 生成 `tap_on_text`、文本目标的 `wait_until_visible`、`tap_if_text`；OCR 需绑定区域、置信度和截图证据。 |
| 图像 / 区域目标 | 自绘 UI、图片按钮、Canvas、无控件树区域。 | 高 | 用户从截图圈选区域或基准图，生成 `tap_on_image` / `tap_on_region`；运行时允许同语义区域小范围漂移和 OCR 重定位。 |
| 元素目标 | App 暴露了 resource-id、accessibility id、text、class、bounds。 | 辅助 | Android UIAutomator dump、iOS WDA / Appium source 只生成候选和调试证据；正式资产仍需转成 OCR / image region / 人工语义区域后确认。 |
| 坐标目标 | 快速录制、不可识别区域、临时调试。 | 低 | 继续保留，但关键业务流程应提示补充预期、状态锚点或语义目标。 |

`tap_if_text` 只用于可选分支，例如“看到弹窗则点击，否则跳过”。它不等同于普通的“点击文字”。普通主流程应使用 `tap_on_element`、`tap_on_text`、`tap_on_image` 或 `wait_until_visible + tap`。

对“我输入测试流程以及对应测试结果，平台进行验证”的建议：

- 不建议只输入“期望结果文字”，因为机器很难稳定判断自然语言。
- 主流更可维护的方式是把期望结果变成可执行断言，例如 `assert_text`、`assert_image`、`assert_app_alive`、`assert_no_crash`、`assert_metric_below`。
- 可以允许用户写自然语言备注，但真正执行时必须落到结构化断言。
- 平台优先使用规则模板解析，例如“看到 xxx”转成 `assert_text`，“不能崩溃”转成 `assert_no_crash`，“内存不超过 800MB”转成 `assert_metric_below`。
- 模板无法识别的描述只作为备注保存，提示用户手动选择断言类型，不依赖大模型自动生成断言。

### D. 测试策略域

目标：同一条流程可以服务不同测试目标。

建议测试目标模型：

| 测试目标 | 判断方式 | 示例 |
|---|---|---|
| 功能完整性 | 关键断言全部通过，无 crash/ANR，目标页面或文本出现。 | 登录成功、进入课堂成功、消息发送成功。 |
| 稳定性 | N 次或指定时长内无 crash/ANR/设备断连，失败率低于阈值。 | 登录流程循环 100 次。 |
| 性能 | 指标不超过阈值，或相对基线无明显劣化。 | 首屏耗时、CPU 均值、内存峰值、FPS、卡顿次数。 |
| 兼容性 | 同一包在多个设备/系统版本通过。 | Android 12/13/14 设备组冒烟。 |
| 探索发现 | 自动探索覆盖更多页面并发现异常。 | 新包上传后跑 5 分钟探索。 |

每次测试任务应明确：

- 被测包。
- 被测设备或设备组。
- 测试流程。
- 测试目标。
- 通过标准。
- 失败处理。
- 报告和通知策略。

### E. 新包冒烟域

目标：新打包产物出现后，平台自动或人工触发冒烟验证。

建议冒烟组成：

1. 包安装检查：能安装、能启动、版本正确。
2. 基础健康检查：启动后无 crash/ANR，主进程存活。
3. 固定关键流程：登录、进入核心页面、打开关键业务模块。
4. 轻量性能采样：启动耗时、CPU、内存、FPS、卡顿、网络错误。
5. 可控探索：在固定流程之后运行短时随机/规则探索，发现明显崩溃。
6. 报告通知：保留视频、截图、日志和关键指标；失败时突出异常摘要并通知相关群或回调 CI。

推荐策略：

- 固定流程用于防止核心功能回归。
- 可控随机探索用于发现“固定流程覆盖不到”的崩溃。
- 随机探索必须有边界：最大时长、最大动作数、黑名单区域、可重放种子、失败后复现路径。
- 冒烟随机化优先做“用例顺序 shuffle”和“用例池 sampling”，不默认打乱单个用例内部步骤。
- 关键用例可以标记为 required，required 用例失败时整体冒烟失败。

### F. 性能基线域

目标：记录每个包的关键性能指标，并与上一个包或指定基线包并排比较。

建议指标：

- App 启动耗时。
- 关键流程耗时。
- CPU 平均值 / 峰值。
- 内存平均值 / 峰值。
- FPS 平均值 / 最低值。
- 卡顿次数或长帧次数，平台支持时采集。
- 网络收发量。
- 电量、温度，平台支持时采集。
- crash/ANR 数量。

基线比较方式：

- 与同分支上一个通过包比较。
- 与指定稳定版本比较。
- 与最近 N 个通过包均值比较。
- 按设备型号、系统版本分别比较，避免跨设备误判。

当前阶段建议：

- 报告详情页提供“与历史版本对比”入口。
- 包版本列表页支持选择两个版本并排对比。
- 对比表展示基线值、当前值、绝对变化和百分比变化。
- 结论由人工判断，不自动阻断流程。

未来可选阈值：

- 绝对阈值：例如内存峰值不得超过 800 MB。
- 相对阈值：例如启动耗时不得比基线劣化超过 10%。
- 趋势阈值：例如连续 3 个包持续上升则预警。

### G. 自动触发与通知域

目标：既支持人工发起测试，也支持新包自动冒烟和定时巡检。

触发类型：

- 人工触发：用户在面板选择包、设备、流程并启动。
- 新包触发：CI 或包服务通知平台有新包。
- 定时触发：每日/每小时稳定性巡检。
- API/CLI 触发：外部系统传入包 ID、用例 ID、设备组。

通知对象：

- 企业微信，MVP 优先。
- Webhook。
- 飞书/Slack，后续扩展。
- CI 回调。
- 邮件。
- 缺陷系统联动单独按 T-091 规划：自动化失败先生成缺陷候选，再按去重和审核策略提报 TAPD。

通知内容：

- 包信息。
- 测试目标。
- 总体结果。
- 失败流程和失败步骤。
- crash/ANR 摘要。
- 版本性能摘要。
- HTML 报告链接。

企业微信 Markdown 通知建议覆盖：

- 新包自动接入：检测到新包，已自动发起冒烟。
- 冒烟通过：包版本、设备、通过率、报告链接。
- 冒烟失败：失败用例、失败步骤、crash/ANR 摘要、报告链接。
- 手动套件执行完成：测试结论和性能摘要。

## 路线图

### Phase 1：交互录制与回放闭环

目标：先让用户能在浏览器中稳定远程操控 Android，完成录制、编辑、回放、每步截图、执行视频和 HTML 报告；同时把线性步骤的执行语义收敛为后续图谱执行可复用的“前置条件 -> 动作策略 -> 后置预期 -> 证据”。

重点：

- Android scrcpy 预览和控制稳定。
- 录制回放主流程稳定。
- 步骤级预期验证第一版：每一步可输入 expected，并在报告中展示 actual 和证据。
- 录制步骤 UI 收敛条件分支入口：`tap_if_text` 不再作为普通步骤快捷按钮暴露，而是归入“插入条件分支 / 看到文字则点击”。
- 每步截图、执行视频、报告可用。
- 主流程回归测试补齐。
- iOS 完成 WDA 签名和基础控制验证。

### Phase 2：结构化录制用例主线

重点：

- StructuredFlow / TestRuleStep / FlowStateAnchor 模型和存储。
- 录制保存时自动绑定 App、包名、版本、起点、终点和设备信息。
- 每一步保存 beforeState、语义 action、afterExpectations、systemGuards、timing 和 evidence。
- 用例库作为主入口：搜索、查看步骤详情、编辑预期、执行、执行到中间步骤、查看最近结果。
- StructuredFlowRunner 复用动态等待、RuntimeInterceptor、截图、视频、日志、性能采集和报告。
- 支持 RuntimeOverlay：临时修改某一步前置或后置预期，只影响本次运行。
- 保留 legacy 坐标脚本兼容，但新能力默认进入 StructuredFlow。

### Phase 2E：业务图谱实验能力冻结与隔离

目标：保留已经实现的图谱实验能力和底层可复用模块，但停止把全局图谱作为当前产品默认方向继续扩张。

重点：

- BusinessGraph / SourceScanner / RoutePlanner / GraphRunner 保留现状和回归测试。
- Dashboard 图谱入口标记为实验能力。
- 后续新功能不得默认扩展 source scan、候选图谱治理、自动晋级或目标节点规划，除非明确重新打开该方向。
- 可复用的 StateMatcher、ActionPolicy、Observation、RuntimeOverlay、动态等待和 RuntimeInterceptor 继续服务 StructuredFlow。

### Phase 3：包管理与手动冒烟

目标：开始管理被测包，并能人工选择 StructuredFlow 集合发起冒烟。

重点：

- Build Registry。
- App / AppVersion 管理。
- SMB 拉包。
- Android APK 安装、卸载、清理数据。
- 用例库 / 套件绑定目标 App 和包版本。
- 冒烟测试计划支持选择 StructuredFlow 集合。
- 报告记录包信息。
- 企业微信或 Webhook 通知。
- 版本性能并排展示。

### Phase 4：自动冒烟与性能基线

目标：新包出来后自动跑 StructuredFlow 冒烟，并对比性能指标。

重点：

- CI / 包服务回调。
- 自动下载新包。
- 设备组调度。
- 性能指标基线。
- 并排展示人工判断。
- 新包质量报告。

### Phase 5：Flow 断言、语义动作与探索辅助

目标：让结构化录制用例更稳定、更可维护，而不是只依赖坐标录制。

重点：

- YAML/JSON Flow 导入导出。
- 源码扫描器和自动探索维持实验状态；只有在明确需要时作为 Flow 候选状态 / 动作推荐来源。
- 语义定位录制增强：录制点击后生成元素、文字、图像 / 区域候选目标，并支持用户确认转换。
- 完整语义动作：`tap_on_element`、`wait_until_visible`、`tap_on_text`、`tap_on_image`、OCR 目标滚动。
- `assert_text`、`assert_image`、`assert_app_alive`、`assert_metric_below`。
- 参数化和测试数据。
- 可控随机探索。
- 探索路径可复现。

### Phase 5A：资产驱动巡检

目标：在已经录入一批高质量 PageStateFlow 资产后，提供一个比盲目探索更稳定、比固定目标任务更覆盖面的巡检入口，持续验证“当前 App 还是否符合我们录入过的页面资产和主流程连接”。

重点：

- 新增“资产驱动巡检”入口，保留现有自动探索 / 稳定性探索入口不删除。
- 支持从当前设备当前页面开始巡检；当前页面必须稳定匹配已保存 PageModel，未知页只做诊断。
- 生成 AssetPatrolPlan：页面健康检查、区域滚动检查、PageElement 重定位检查、PageTransition 验证、PageTask dry-run / 轻量验证和系统守护。
- 巡检策略按页面集合、风险等级、最大时长、最大边数、是否允许高风险动作、是否允许真实提交业务数据配置。
- 输出资产健康报告：页面覆盖率、元素定位成功率、连接边成功率、耗时分布、性能指标、异常事件、跳过原因和修复建议。
- 新发现页面 / 元素 / 边进入候选管理或资产录制确认流程，不自动写入 active 资产。

### Phase 6：AI / CI 闭环验证与团队级质量平台

目标：从工具升级为 AI/CI 可调用的结构化流程验证平台和团队质量看板。

重点：

- 外部工具接口：CI、CLI、MCP 或 AI Agent 可发起 StructuredFlow 测试、查报告、获取失败证据、发通知。
- AI 代码修改后动态传入 Flow、执行到中间步骤或预期覆盖，平台验证后返回结构化结果。
- 探索异常 AI 诊断：执行异常先固化证据并脱敏，再由规则和 AI 分类为业务异常、资产过期、测试计划缺口、环境问题或不可判定；业务异常进入报告 / 缺陷候选并按策略重启继续，资产问题默认生成受控 patch 草稿，高置信、低风险且验证通过时可按策略自动应用为新的 active 资产版本并继续。
- `.ai/` 仓库导航：让维护者和大模型快速理解代码入口、构建命令、风险边界。
- 多人权限。
- 包质量趋势。
- 设备稳定性趋势。
- Flow、步骤和语义定位稳定性统计。
- 缺陷候选与 TAPD 提报：从 crash / ANR / 预期失败 / 路径失败 / 性能劣化生成候选，去重后人工确认或高置信自动提报。
- 测试资产治理。

## 关键决策与开放问题

| ID | 状态 | 问题 / 决策 | 当前结论 |
|---|---|---|---|
| PP-Q001 | resolved | 新包来源是本地目录、CI 回调、包下载服务，还是都要支持？ | MVP 优先支持 SMB + 手动上传，CI/CD 通过 `POST /api/builds` 接入；HTTP / 内部包服务后续扩展。 |
| PP-Q002 | open | 冒烟默认覆盖哪些核心流程？ | 先由用户维护 smoke 标签用例集合，后续在套件中配置 required 用例。 |
| PP-Q003 | resolved | 性能基线比较用哪个版本？ | 默认同设备、同流程、同分支最近一次 passed 包，用户可手动切换。 |
| PP-Q004 | resolved | 性能劣化阈值由谁维护？ | 当前阶段先并排展示人工判断，阈值告警后续再开放。 |
| PP-Q005 | open | 随机探索是否首版进入？ | 不进入 MVP，先规划，等固定流程稳定后再做。 |
| PP-Q006 | resolved | 通知优先接哪个系统？ | MVP 优先企业微信 Markdown，Webhook 保留。 |
| PP-Q007 | resolved | 是否使用大模型把自然语言转断言？ | 默认不使用；采用规则模板解析 + 用户手动确认。 |
| PP-Q008 | resolved | 步骤级预期验证是否和现有断言、冒烟、随机探索规划冲突？ | 不冲突。步骤预期负责每一步动作后的 expected / actual 判定；状态感知回放负责固定流程稳定推进；冒烟随机化只打乱用例顺序或抽样；随机探索作为固定流程后的补充。 |
| PP-Q009 | resolved | 是否要在业务源码中新增自动化契约？ | 不要求业务 App 改源码。平台保持独立；有源码时只读扫描生成候选图谱，没有源码时通过自动探索和录制沉淀。 |
| PP-Q010 | resolved | 新目标是否要推翻现有平台重做？ | 不新建仓库重做；保留现有设备、预览、控制、报告、包管理等底座，在同仓新增 v2 图谱内核，逐步迁移旧录制回放。 |
| PP-Q011 | open | 业务图谱节点粒度如何确定？ | 建议以“可识别业务页面 / 业务位置 / 关键状态”为节点，具体粒度需用首个真实 App 试点校准。 |
| PP-Q012 | open | 源码扫描首个目标仓库和技术栈是什么？ | 影响扫描器范围：Android Activity/Fragment/XML/Compose/Router，或 iOS ViewController/SwiftUI/Coordinator。 |
| PP-Q013 | open | AI/CI 调用平台时动态预期的信任边界是什么？ | 建议动态预期只作为本次 Run overlay，不自动写入 active 图谱；是否允许自动提升为正式预期需要后续确认。 |
