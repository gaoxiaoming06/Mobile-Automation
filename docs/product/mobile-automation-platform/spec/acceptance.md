---
title: 自动化测试平台验收标准
doc_type: acceptance
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-07-02
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台验收标准

## 验收原则

1. 每个验收项都应能通过手动验证、自动化测试或集成测试证明。
2. Android 与 iOS 若能力不同，验收时必须记录平台差异和原因。
3. 测试执行报告必须能解释每次失败的原因，不能只给出失败状态。
4. 录制、编辑、执行、报告是核心闭环，MVP 必须至少在一个平台完整跑通。
5. 涉及截图、日志、性能数据的验收，需要验证数据可追溯到 Run、设备、轮次和步骤。

## 验收项

### AC-001：Web 面板可访问并展示核心页面

- 关联需求：REQ-001
- 目标平台：Web Dashboard
- 前置条件：后端和前端服务已启动。
- 操作步骤：
  1. 打开 Web 面板。
  2. 进入设备列表页、用例列表页、执行记录页、报告列表页。
  3. 模拟无数据、加载中、接口失败状态。
- 预期结果：
  1. 页面可正常访问。
  2. 主导航清晰可见。
  3. 空状态、加载状态和错误状态都有明确展示。
- 验证方式：手动验证 + 前端组件测试。
- 回归范围：Dashboard 基础布局、路由、API 错误处理。

### AC-002：设备发现与状态刷新

- 关联需求：REQ-002、REQ-018
- 目标平台：Android + iOS
- 前置条件：至少连接一台 Android 设备；iOS 设备按工具链接入情况验证。
- 操作步骤：
  1. 打开设备列表。
  2. 插入设备。
  3. 刷新设备列表。
  4. 断开设备。
  5. 重新连接设备。
- 预期结果：
  1. 在线设备出现在列表中。
  2. 设备显示平台、型号、系统版本、分辨率和能力。
  3. 断连后状态变为离线或不可用。
  4. 重连后恢复在线。
- 验证方式：真实设备手动验证 + Driver mock 集成测试。
- 回归范围：Device Orchestrator、Android Driver、iOS Driver、WebSocket 状态推送。

### AC-003：设备预览可用

- 关联需求：REQ-003、REQ-016
- 目标平台：Android + iOS
- 前置条件：设备在线且具备预览能力。
- 操作步骤：
  1. 从设备列表进入设备预览页。
  2. 观察设备画面。
  3. 旋转设备或切换横竖屏。
  4. 停止并重新开启预览。
- 预期结果：
  1. 预览画面能持续更新。
  2. 画面保持设备宽高比。
  3. 横竖屏变化后预览方向和元数据正确。
  4. 预览中断时 UI 展示原因并支持重试。
- 验证方式：真实设备手动验证。
- 回归范围：Preview Stream、Dashboard 预览组件、坐标元数据。

### AC-004：预览页远程操作生效

- 关联需求：REQ-004、REQ-007、REQ-016、REQ-017
- 目标平台：Android + iOS
- 前置条件：设备在线且进入预览页。
- 操作步骤：
  1. 在预览图上点击一个按钮。
  2. 执行长按。
  3. 执行滑动。
  4. 点击返回。
  5. 输入文本。
  6. 执行截图。
- 预期结果：
  1. 每个动作都在设备上生效。
  2. UI 展示命令发送和执行结果。
  3. 坐标映射准确，点击位置与预览位置一致。
  4. 不支持动作时 UI 给出明确提示。
- 验证方式：真实设备手动验证 + 坐标转换单元测试。
- 回归范围：Action API、Driver executeAction、坐标转换、Dashboard 交互。

### AC-005：录制生命周期完整

- 关联需求：REQ-005
- 目标平台：Android + iOS
- 前置条件：设备在线并可远程操作。
- 操作步骤：
  1. 点击开始录制。
  2. 执行点击、输入、滑动、返回。
  3. 暂停录制。
  4. 执行动作。
  5. 继续录制。
  6. 停止录制。
  7. 保存为测试用例。
- 预期结果：
  1. 录制中动作按顺序生成步骤。
  2. 暂停期间策略符合产品确认结果。
  3. 每一步包含动作类型、参数、时间和截图引用。
  4. 坐标类步骤包含设备分辨率、预览渲染区域、方向、坐标比例和录制来源。
  5. 滑动 / 拖拽步骤保留起点、终点、持续时间和必要路径采样点。
  6. 录制会话包含目标设备、平台、App、开始时间、总时长、分辨率和方向元数据。
  7. 停止录制后可以保存用例。
- 验证方式：手动验证 + Recorder 集成测试。
- 回归范围：Recording Session、ActionStep 生成、用例保存。

### AC-006：步骤可视化编辑

- 关联需求：REQ-006、REQ-008
- 目标平台：Web Dashboard
- 前置条件：已有录制生成的测试用例。
- 操作步骤：
  1. 打开用例详情。
  2. 删除一个步骤。
  3. 插入 wait 步骤。
  4. 复制一个步骤。
  5. 拖拽排序。
  6. 修改坐标或输入文本。
  7. 禁用一个步骤。
  8. 保存并重新打开。
- 预期结果：
  1. 步骤变化正确保存。
  2. 步骤序号重新计算。
  3. 禁用步骤不会在执行中运行。
  4. 参数校验错误能定位到具体步骤。
  5. 步骤卡片展示类型图标、类型颜色、关键参数、延迟 / 耗时和最近一次执行结果。
  6. 失败步骤可从卡片直接定位截图、日志和错误原因。
- 验证方式：手动验证 + 用例 API 测试。
- 回归范围：Case Editor、Step schema、Case API。

### AC-007：测试用例管理

- 关联需求：REQ-008、REQ-020
- 目标平台：Web Dashboard + Backend
- 前置条件：服务已启动。
- 操作步骤：
  1. 新建测试用例。
  2. 编辑用例信息和步骤。
  3. 复制用例。
  4. 导出 JSON。
  5. 删除用例。
  6. 从 JSON 导入用例。
- 预期结果：
  1. 用例 CRUD 均可用。
  2. 导出 JSON 包含完整步骤和目标平台。
  3. 导入后用例可继续编辑和执行。
- 验证方式：API 集成测试 + 手动验证。
- 回归范围：TestCase 存储、导入导出、Dashboard 用例页面。

### AC-008：执行一次和执行 N 次

- 关联需求：REQ-009、REQ-010
- 目标平台：Android + iOS
- 前置条件：已有可执行用例，设备在线。
- 操作步骤：
  1. 选择用例和设备。
  2. 配置执行一次。
  3. 启动执行并等待结束。
  4. 配置执行 N 次。
  5. 再次执行。
- 预期结果：
  1. 执行一次时每个启用步骤只执行一次。
  2. 执行 N 次时按配置轮次执行。
  3. 每轮和每步都有状态、耗时和结果。
  4. 执行结束后自动释放设备锁。
- 验证方式：真实设备手动验证 + Mock Driver 自动化测试。
- 回归范围：Test Runner、RunConfig、设备锁、StepResult。

### AC-009：循环执行与停止

- 关联需求：REQ-009、REQ-010、REQ-022
- 目标平台：Android + iOS
- 前置条件：已有可执行用例，设备在线。
- 操作步骤：
  1. 配置持续循环执行。
  2. 启动执行。
  3. 观察执行至少 3 轮。
  4. 点击暂停。
  5. 点击继续。
  6. 点击停止。
- 预期结果：
  1. 执行持续按轮次推进。
  2. 暂停后不继续下发步骤。
  3. 继续后从正确位置恢复。
  4. 停止后状态为 stopped，并生成报告。
- 验证方式：手动验证 + Runner 状态机测试。
- 回归范围：执行状态机、实时事件、报告生成。

### AC-010：失败策略生效

- 关联需求：REQ-009、REQ-010、REQ-012、REQ-022
- 目标平台：Android + iOS
- 前置条件：构造一个必然失败的步骤。
- 操作步骤：
  1. 配置失败后停止。
  2. 执行用例。
  3. 配置失败后继续。
  4. 再次执行。
  5. 配置单步重试。
- 预期结果：
  1. 失败后停止时 Run 进入 failed。
  2. 失败后继续时后续步骤继续执行，报告标记失败步骤。
  3. 重试时 StepResult 或事件中体现重试次数。
- 验证方式：Mock Driver 自动化测试 + 手动验证。
- 回归范围：failurePolicy、Runner、报告失败展示。

### AC-011：性能数据采集与展示

- 关联需求：REQ-011、REQ-013、REQ-014
- 目标平台：Android + iOS
- 前置条件：执行配置开启性能采集。
- 操作步骤：
  1. 启动测试执行。
  2. 等待多步执行。
  3. 打开报告详情。
  4. 查看性能数据。
- 预期结果：
  1. 性能数据按时间线记录。
  2. 数据关联到 Run、设备、轮次和步骤。
  3. 报告展示最大值、平均值或趋势。
  4. 平台不支持的指标标记为空或不支持原因。
- 验证方式：真实设备手动验证 + MetricSample 存储测试。
- 回归范围：Metrics Collector、Driver metrics、Report UI。

### AC-012：崩溃、ANR 与异常进入报告

- 关联需求：REQ-012、REQ-013、REQ-014、REQ-022
- 目标平台：Android + iOS
- 前置条件：存在可触发异常的测试 App 或 Mock Driver。
- 操作步骤：
  1. 执行会触发 App crash 的用例。
  2. 执行会触发命令失败的用例。
  3. 执行过程中断开设备。
  4. 查看报告。
- 预期结果：
  1. 异常事件被记录。
  2. 事件关联设备、轮次、步骤和时间。
  3. 失败截图和日志附件可查看。
  4. 设备断连时 Run 状态正确。
  5. 无论 Run 最终通过、失败、停止还是设备断连，只要设备和工具链支持录制，Run 视频都作为报告附件保留。
- 验证方式：手动验证 + Mock Driver 异常测试。
- 回归范围：Event Collector、Runner、Artifact、Report。

### AC-013：报告内容完整

- 关联需求：REQ-013、REQ-014、REQ-020
- 目标平台：Web Dashboard + Backend
- 前置条件：至少有一次成功执行和一次失败执行。
- 操作步骤：
  1. 打开报告列表。
  2. 打开成功报告。
  3. 打开失败报告。
  4. 导出 HTML 报告。
- 预期结果：
  1. 报告包含摘要、设备、用例快照、配置快照。
  2. 报告包含轮次、步骤、性能、异常、附件。
  3. 失败报告能定位失败步骤和原因。
  4. 每个步骤结果展示步骤后截图或截图占位状态。
  5. 失败报告展示失败现场截图、日志和视频附件。
  6. 成功报告同样展示执行视频附件，视频可播放并能与步骤截图一起作为测试结果证据。
  7. HTML 导出文件可打开并展示关键内容。
- 验证方式：手动验证 + report-core 单元测试。
- 回归范围：Report Service、Report UI、HTML export、Artifact。

### AC-014：设备锁与占用保护

- 关联需求：REQ-002、REQ-018、REQ-021
- 目标平台：Android + iOS
- 前置条件：同一设备被一个执行任务占用。
- 操作步骤：
  1. 启动一个长时间执行任务。
  2. 尝试在另一个页面或会话中控制同一设备。
  3. 停止执行任务。
  4. 再次尝试控制设备。
- 预期结果：
  1. 执行中设备显示占用状态。
  2. 其他会话不能抢占控制。
  3. 执行停止后设备锁释放。
- 验证方式：手动验证 + 设备锁单元测试。
- 回归范围：Device Session、Device Lock、Dashboard 状态展示。

### AC-015：坐标转换稳定

- 关联需求：REQ-004、REQ-016
- 目标平台：Web Dashboard + Android + iOS
- 前置条件：设备预览可用。
- 操作步骤：
  1. 在不同浏览器窗口尺寸下点击同一预览位置。
  2. 在横屏和竖屏分别点击。
  3. 录制步骤后换相近分辨率设备回放。
- 预期结果：
  1. 点击坐标与预览位置一致。
  2. 横竖屏转换后坐标不偏移。
  3. 归一化坐标在相近分辨率设备上可回放。
  4. 分辨率差异过大时 UI 提示风险。
- 验证方式：坐标单元测试 + 真实设备手动验证。
- 回归范围：Coordinate utils、Preview component、Runner coordinate resolution。

### AC-016：目标 App 管理

- 关联需求：REQ-017
- 目标平台：Android + iOS
- 前置条件：用例配置了目标 App。
- 操作步骤：
  1. 配置 Android package name 或 iOS bundle id。
  2. 执行前选择启动 App。
  3. 执行前选择重启 App。
  4. 执行后查看报告。
- 预期结果：
  1. 目标 App 能按平台能力启动或关闭。
  2. 不支持的能力明确提示。
  3. 报告记录目标 App 信息和执行前配置。
- 验证方式：真实设备手动验证。
- 回归范围：Driver app actions、RunConfig、Report。

### AC-017：实时执行观察

- 关联需求：REQ-010、REQ-019
- 目标平台：Web Dashboard
- 前置条件：执行一个包含多步的用例。
- 操作步骤：
  1. 打开执行详情页。
  2. 启动执行。
  3. 观察当前轮次、当前步骤、日志、性能摘要和异常提示。
- 预期结果：
  1. UI 实时显示当前执行状态。
  2. 步骤开始和结束事件及时更新。
  3. 异常出现时及时提示。
  4. 页面刷新后仍能恢复执行详情。
- 验证方式：手动验证 + WebSocket 事件测试。
- 回归范围：WebSocket、Run detail UI、Run state persistence。

### AC-018：导入导出与 CI 扩展

- 关联需求：REQ-020
- 目标平台：Backend + CLI / API
- 前置条件：已有测试用例和报告。
- 操作步骤：
  1. 导出测试用例 JSON。
  2. 导入测试用例 JSON。
  3. 通过 API 创建执行任务。
  4. 下载执行报告 JSON。
- 预期结果：
  1. JSON 可被平台重新导入。
  2. API 可触发执行。
  3. 报告 JSON 可用于外部系统判断结果。
- 验证方式：API 集成测试。
- 回归范围：Import/export、Run API、Report API。

### AC-019：安全与数据清理

- 关联需求：REQ-014、REQ-023
- 目标平台：Backend
- 前置条件：存在历史执行数据、截图、日志和多个 Run 视频。
- 操作步骤：
  1. 查看 artifact 存储目录。
  2. 触发清理任务。
  3. 查看报告和附件引用。
- 预期结果：
  1. artifact 存储在受控目录。
  2. 清理策略不会留下孤立数据库记录。
  3. 删除数据后 UI 能正确展示已清理状态。
  4. 日志不应包含明显密钥或 Token。
  5. 成功、失败、停止等 Run 的视频在保留期内均可从报告访问。
  6. 保留期、手动删除或最大空间策略命中后，视频被清理且报告展示已清理状态。
  7. 清理策略不应影响正在执行的 Run，也不应在报告生成后立即删除本次执行视频。
- 验证方式：存储集成测试 + 手动检查。
- 回归范围：Storage、Artifact cleanup、Report references。

### AC-020：扩展动作保持兼容

- 关联需求：REQ-024
- 目标平台：Shared + Runner + Dashboard
- 前置条件：已有旧版本测试用例。
- 操作步骤：
  1. 新增一个动作类型或断言类型。
  2. 打开旧用例。
  3. 执行旧用例。
  4. 创建包含新动作的新用例。
- 预期结果：
  1. 旧用例不受影响。
  2. 新动作能通过 schema 校验。
  3. 不支持新动作的平台明确提示。
- 验证方式：schema 兼容测试 + Runner mock 测试。
- 回归范围：ActionStep schema、Case migration、Driver capabilities。

### AC-021：测试保障与质量门禁

- 关联需求：REQ-025
- 目标平台：Shared + Backend + Web Dashboard
- 前置条件：工程已创建测试基础设施。
- 操作步骤：
  1. 修改 Step schema 或坐标转换逻辑。
  2. 运行 `pnpm test:unit`。
  3. 修改 Runner 或 Recorder 逻辑。
  4. 运行 `pnpm test`。
  5. 修改 Dashboard 核心组件。
  6. 运行组件测试或 `pnpm test:e2e`。
- 预期结果：
  1. 核心逻辑都有对应测试覆盖。
  2. Mock Driver 可以模拟设备发现、预览、动作执行、异常和报告生成。
  3. 测试失败时能定位到具体模块。
  4. 新增核心逻辑没有测试时，Review 应要求补充测试。
- 验证方式：测试命令执行 + 人工 Review。
- 回归范围：Step schema、坐标转换、Runner、Recorder、Driver mock、Report、Dashboard 主流程。

### AC-022：应用包登记与安装

- 关联需求：REQ-026、REQ-017
- 目标平台：Android first，iOS follow-up
- 前置条件：存在一个可安装 Android APK。
- 操作步骤：
  1. 在平台注册 App。
  2. 通过 SMB 路径、上传或 `POST /api/builds` 登记 APK 版本。
  3. 查看包详情。
  4. 选择一台 Android 设备安装该包。
  5. 安装完成后读取设备上的 App 版本。
  6. 卸载该 App。
- 预期结果：
  1. 平台记录 App、AppBuild、包名、版本、来源、文件大小和校验值。
  2. SMB 或 Webhook 接入的包可进入 ready 状态。
  3. 下载、解析、安装、版本校验各阶段状态可见。
  4. 安装记录关联 AppBuild 和设备。
  5. 安装后设备上的目标 App 版本与包记录一致。
  6. 安装失败时报告明确错误码、错误原因和失败阶段。
  7. 卸载后安装状态更新。
- 验证方式：真实 Android 设备手动验证 + Build Registry API 测试。
- 回归范围：Build Registry、Android Driver install/uninstall、Storage。

### AC-023：手动新包冒烟

- 关联需求：REQ-027、REQ-029
- 目标平台：Android first
- 前置条件：存在已登记 APK、至少一台在线 Android 设备、至少一个 smoke 标签流程。
- 操作步骤：
  1. 创建冒烟测试计划。
  2. 选择目标 APK、设备和 smoke 流程。
  3. 启动冒烟。
  4. 查看执行详情和报告。
- 预期结果：
  1. 平台先安装包，再启动 App。
  2. 版本校验通过后才执行固定关键流程。
  3. 报告展示包信息、测试计划、设备、流程和结果。
  4. crash、ANR、启动失败、流程失败任一发生时冒烟失败。
  5. 报告保留视频、截图、日志和异常摘要；失败时突出失败证据。
  6. required 用例失败时整体冒烟失败。
  7. shuffle_cases 只打乱用例顺序，不打乱用例内部步骤。
  8. sampling 只执行配置数量的用例。
- 验证方式：真实 Android 设备手动验证 + Mock Driver 冒烟集成测试。
- 回归范围：TestPlan、Runner、Build install、Report。

### AC-024：结构化断言验证

- 关联需求：REQ-028
- 目标平台：Android + iOS
- 前置条件：测试流程中包含断言步骤。
- 操作步骤：
  1. 添加 `assert_app_alive` 步骤。
  2. 添加 `assert_no_crash` 步骤。
  3. 添加 `assert_metric_below` 步骤。
  4. 添加 `assert_text` 步骤并配置 region、expected、mode。
  5. 添加 `assert_image` 步骤并配置 region、threshold。
  6. 构造一个通过场景和一个失败场景。
  7. 查看报告。
- 预期结果：
  1. 断言步骤在步骤列表中可见。
  2. 断言通过时 StepResult 为 passed。
  3. 断言失败时 StepResult 为 failed，并包含预期值、实际值和失败证据。
  4. 平台不支持的断言明确标记为 unsupported。
  5. 常见自然语言期望可通过规则模板生成候选断言，并需要用户确认。
  6. 模板无法识别的自然语言期望只作为备注，不直接决定自动化结果。
  7. `assert_text` 报告展示 OCR 识别结果和匹配状态。
  8. `assert_image` 首次执行生成 pending_review 基准图，不直接参与失败判定。
- 验证方式：Mock Driver 自动化测试 + 报告单元测试。
- 回归范围：ActionStep schema、Runner assertion、Report。

### AC-025：版本性能并排对比

- 关联需求：REQ-030
- 目标平台：Android + iOS
- 前置条件：同一设备、同一流程已经有一次 passed 执行记录。
- 操作步骤：
  1. 运行第一个包并生成性能摘要。
  2. 运行第二个包的同一测试计划。
  3. 打开报告详情页。
  4. 点击“与历史版本对比”。
  5. 选择对比版本。
- 预期结果：
  1. 平台可推荐同设备、同套件、最近一次 passed run 作为默认对比版本。
  2. 报告并排展示两个版本的 CPU、内存、FPS、启动耗时、崩溃和 ANR 数据。
  3. 报告展示绝对变化值和百分比变化。
  4. 当前阶段不因指标变化自动将 Run 标记为 failed。
  5. 没有可对比版本时报告标记 `missing_baseline` 或展示空状态，不直接误判失败。
- 验证方式：Metrics mock 测试 + 报告测试。
- 回归范围：Metrics summary、PerformanceBaseline、Report。

### AC-026：自动触发与通知

- 关联需求：REQ-031
- 目标平台：Backend
- 前置条件：存在测试计划和可用设备，配置一个测试 Webhook。
- 操作步骤：
  1. 通过 `POST /api/builds` 推送新包。
  2. 等待任务进入队列。
  3. 等待任务执行完成。
  4. 检查企业微信或 Webhook 请求内容。
- 预期结果：
  1. API 触发后生成 AppBuild 和 AutomationJob。
  2. 设备被正确加锁和释放。
  3. 任务结果与 Run 结果一致。
  4. 通知包含包信息、计划、结果、失败摘要、版本性能摘要和报告链接。
  5. 通知发送失败时记录事件，但不改变测试本身结果。
- 验证方式：API 集成测试 + Webhook mock。
- 回归范围：Job scheduler、Run API、Notification service。

### AC-027：可控随机探索与稳定性探索 PoC

- 关联需求：REQ-032
- 目标平台：Android first
- 前置条件：目标 App 已配置；至少存在一个可识别 PageModel 或可从固定 Flow 执行到稳定页面。
- 操作步骤：
  1. 打开稳定性探索入口。
  2. 选择设备并输入 / 选择目标包名。
  3. 配置探索 seed、起始方式、最大时长、最大动作数、策略、允许动作、危险词黑名单和 App 外处理策略。
  4. 启动探索。
  5. 使用相同 seed 再次执行。
  6. 人为触发或模拟 crash / ANR / 黑屏 / App 退出 / 未知页卡住。
  7. 查看探索报告和候选资产草稿。
- 预期结果：
  1. 探索动作不超过最大时长和最大动作数。
  2. 同一 seed 在同一设备配置下动作序列可复现。
  3. 候选动作来源按已保存 PageElement / PageAbility、OCR 文本、视觉区域、随机安全区域排序，并展示过滤原因。
  4. 危险文案、黑名单区域和危险页面不会被执行。
  5. crash / ANR / 黑屏 / App 退出 / 设备断连 / 未知页卡住时停止探索或按配置恢复，并保留证据。
  6. 新页面、新元素和新边只进入 draft / candidate，不直接写入 active 页面资产。
  7. 探索路径可导出为可复现 Flow。
  8. Dashboard 执行中展示当前 run、进度、当前包、最近动作、动作来源、过滤候选数和最近步骤时间线。
  9. HTML 报告展示稳定性探索摘要，包括目标包、seed、策略、动作进度、App 外处理、过滤候选和最近动作。
  10. 同一候选动作执行后页面无实质变化时，后续同页探索应跳过该候选并在过滤候选中展示 `repeated_no_change`。
  11. 配置浅层回退和最大深度后，探索进入子页面达到深度上限时应执行 `backtrack` 返回；回到父页面后应跳过已覆盖入口并继续探索其它候选。
  12. 选择“当前页开始”时，目标 App 已在前台则不得重新启动 App；前台包不匹配时应停止并记录 `start_state_failed`。
- 验证方式：Mock Driver PoC 测试 + 真实 Android 手动验证。
- 回归范围：Exploration engine、Runner、Report。

### AC-028：assert_image 基准图审核流程

- 关联需求：REQ-028
- 目标平台：Android + iOS
- 前置条件：用例含 `assert_image` 步骤，且该步骤尚无 approved 基准图。
- 操作步骤：
  1. 执行用例。
  2. 打开报告。
  3. 查看 pending_review 基准图。
  4. 人工点击“确认设为基准图”。
  5. 再次执行用例。
- 预期结果：
  1. 第一次执行不直接判定图像对比失败，而是记录 pending_review。
  2. 人工确认后 baseline_status 变为 approved。
  3. 再次执行时与 approved 基准图对比。
  4. 对比失败时报告展示实际截图、基准图和差异图。
  5. 更新基准图后旧基准图状态变为 superseded。
- 验证方式：artifact / report 集成测试 + 手动验证。
- 回归范围：Artifact baseline、assert_image、Report UI。

### AC-029：定时冒烟调度

- 关联需求：REQ-029、REQ-031
- 目标平台：Backend
- 前置条件：已创建含 cron 表达式的冒烟套件，且存在可用设备和 ready AppBuild。
- 操作步骤：
  1. 配置 cron 触发时间。
  2. 等待触发时间到达。
  3. 查看任务队列和报告。
- 预期结果：
  1. 平台自动创建冒烟任务，无需人工点击。
  2. 同一设备已有任务时，新任务排队等待。
  3. 执行完成后按通知策略推送结果。
- 验证方式：Scheduler mock 时间测试 + API 集成测试。
- 回归范围：Scheduler、Device lock、Notification。

### AC-030：外部工具接口与 AI 仓库导航

- 关联需求：REQ-031、REQ-033
- 目标平台：Backend + Docs
- 前置条件：已存在 App、AppBuild、SmokeSuite 和至少一个可用 Mock Driver 设备。
- 操作步骤：
  1. 调用 `/api/tooling/context`。
  2. 通过 mock MCP / CLI adapter 查询 App 和 Build。
  3. 通过工具接口触发一次冒烟任务。
  4. 查询任务状态和 HTML 报告链接。
  5. 取消一个排队任务。
  6. 检查 `.ai/repo-profile.yml` 和 `.ai/context-guide.md`。
- 预期结果：
  1. 工具接口返回平台版本、能力、可用工具和主要 API。
  2. 工具触发的任务进入同一任务队列，并遵守设备锁。
  3. 工具返回 buildId、jobId、runId、reportUrl 等稳定 ID。
  4. 取消任务后设备锁释放，并生成可解释事件。
  5. 工具 schema、日志和文档不包含 secret。
  6. `.ai/` 只包含仓库导航，不复制完整 Spec 正文。
- 验证方式：API 集成测试 + mock tool adapter 测试 + 文档检查。
- 回归范围：Tool adapter、Job scheduler、Device lock、Notification、Repo docs。

### AC-031：步骤级预期输入与验证

- 关联需求：REQ-009、REQ-027、REQ-028、REQ-029、REQ-034
- 目标平台：Android first，iOS follow-up
- 前置条件：已有一个包含点击、输入、滑动或页面跳转的固定流程，且设备在线。
- 操作步骤：
  1. 为流程配置起始状态，例如 `go_home` 或 `launch_app`。
  2. 为点击步骤添加文本预期，例如执行后屏幕包含指定文字。
  3. 为输入步骤添加屏幕变化或 OCR 文本预期。
  4. 为滑动或页面跳转步骤添加图像区域预期或目标可见预期。
  5. 为关键步骤添加 `no_crash` 或 `app_alive` 预期。
  6. 执行一轮预期全部通过的流程。
  7. 构造文本不存在、图像不匹配、App 不存活或能力不支持的失败场景。
  8. 插入一个 `tap_if_text` 条件步骤，用于处理可能出现的弹窗。
  9. 分别构造弹窗出现和弹窗不出现两个场景。
  10. 打开执行报告。
- 预期结果：
  1. 用户可以为每一步保存一个或多个结构化预期。
  2. 通过场景中，Runner 执行动作后验证 expectations，StepResult 为 passed。
  3. 失败场景中，StepResult 为 failed，并展示 expectation_failed、预期值、实际值和失败原因。
  4. 不支持的验证类型标记为 unsupported，不被静默当作通过。
  5. 图像预期首次生成基准图时可进入 pending_review，人工确认后再参与正式对比。
  6. 报告按步骤展示 expected / actual、验证方式、截图、日志、OCR 结果、图像差异或指标数据。
  7. 起始状态失败时，Run 不盲目执行后续步骤，报告展示 `start_state_failed` 和失败阶段。
  8. 未配置 expectations 的 raw `tap` / `swipe` / `input_text` 仍保持原有回放能力，但报告应提示该步骤未配置结果验证。
  9. `tap_if_text` 条件命中时执行点击，并记录条件 expected / actual 和截图证据。
  10. `tap_if_text` 条件未命中时 StepResult 为 `skipped`，Run 继续执行后续步骤，不计入 failed steps，报告单独展示跳过原因。
- 验证方式：Mock Driver 自动化测试 + Android 真机手动验证。
- 回归范围：StepExpectation、FlowStartState、StateAnchor、Semantic Action、Runner、StepResult、Report。

### AC-032：录制时自动生成候选预期

- 关联需求：REQ-005、REQ-006、REQ-009、REQ-034
- 目标平台：Android first，iOS follow-up
- 前置条件：设备在线并可远程操作，Dashboard 已进入录制状态。
- 操作步骤：
  1. 开始录制。
  2. 执行一个点击动作。
  3. 执行一个滑动动作。
  4. 执行一个返回动作。
  5. 停止录制并查看步骤列表。
  6. 禁用或删除某个自动生成的预期。
  7. 执行录制得到的流程。
- 预期结果：
  1. 每个录制步骤自动带出高可靠预期：`no_crash` 和 `app_alive`。
  2. 对点击、滑动、返回等可能改变画面的动作，平台可按差异阈值生成 `screen_changed` 预期或候选建议。
  3. OCR 文本和图像预期不因低置信识别而自动成为必过条件；需要用户确认或达到明确高置信策略。
  4. 用户可以在步骤编辑器里查看自动生成原因，并能禁用、删除或继续编辑这些预期。
  5. 回放执行时，自动生成的预期参与 StepResult 判定，并在报告里展示 expected / actual。
  6. 未配置或被用户删除预期的步骤仍可作为 raw 动作回放，但报告提示该步骤缺少结果验证。
- 验证方式：Recorder / Dashboard 单元测试 + Android 真机手动验证。
- 回归范围：Recorder、StepExpectation、Dashboard step editor、Runner、Report。

### AC-033：语义定位录制与步骤修复

- 关联需求：REQ-005、REQ-006、REQ-007、REQ-009、REQ-016、REQ-028、REQ-034、REQ-035
- 目标平台：Android first，iOS follow-up
- 前置条件：Android 设备在线，目标 App 已启动，Dashboard 处于用例录制页。
- 操作步骤：
  1. 开始录制。
  2. 在预览画面中点击一个有稳定 resource-id 或文本的控件。
  3. 停止录制并打开步骤编辑器。
  4. 查看该点击步骤的目标候选。
  5. 将原始坐标点击转换为元素点击或文字点击。
  6. 插入一个“看到文字则点击，否则跳过”的条件分支，用于处理可能出现的弹窗。
  7. 执行一次语义目标可命中的回放。
  8. 构造目标不存在或文字不出现的失败场景。
  9. 打开执行报告并查看失败步骤。
- 预期结果：
  1. 录制步骤仍保留坐标和归一化坐标作为 fallback。
  2. Android 点击步骤可生成元素候选，至少包含 locator、bounds、confidence、生成原因和 fallback 坐标。
  3. 元素候选不可用时，平台可生成 OCR 文字候选；低置信候选不默认启用。
  4. 用户可以清晰区分坐标点击、元素点击、文字点击、图像 / 区域点击和条件分支。
  5. `tap_if_text` 在 UI 中展示为“看到文字则点击，否则跳过”，不被误认为普通点击方式。
  6. `tap_on_text` 命中时点击文字区域中心；未命中时 StepResult 失败并记录 `semantic_target_not_found`。
  7. `tap_on_element` 命中时点击元素 bounds 中心；未命中时按 failurePolicy 或 coordinate fallback 处理。
  8. 使用 coordinate fallback 时，报告必须明确展示 fallback 已发生。
  9. 失败报告展示目标描述、截图证据、actual 信息和步骤修复入口。
  10. 语义定位成功后仍会执行步骤 expectations；定位成功不直接等同于测试通过。
- 验证方式：Mock Driver 自动化测试 + Android 真机手动验证。
- 回归范围：Recorder、Android Driver、SemanticTarget、Step editor、Runner、Report。

### AC-034：业务图谱资产管理

- 关联需求：REQ-036
- 当前状态：experimental / frozen；该验收保留为业务图谱实验能力回归，不作为当前 StructuredFlow MVP 交付阻塞项。
- 目标平台：Backend + Web Dashboard
- GIVEN 已登记一个 Android App。
- WHEN 用户创建一个 BusinessGraph，并新增 root、home、homework_create 三个 BusinessNode。
- AND 用户为每个节点配置 activity、resource-id、text 等 StateMatcher。
- AND 用户创建 home -> homework_create 的 OperationEdge，配置 preconditions、actionPolicies 和 expectations。
- THEN 平台应保存图谱、版本、节点、边、matcher、action policy 和 expectation。
- AND draft 节点 / 边不会进入默认执行路径。
- AND 发布 active 版本后，RoutePlanner 可以读取该版本。
- AND 历史 Run 保存 routePlanSnapshot，不受后续图谱编辑影响。
- 验证方式：Storage / API 集成测试 + Dashboard 手动验证。
- 回归范围：Graph model、Storage、Graph API、Dashboard graph pages。

### AC-035：多源源码扫描生成候选图谱

- 关联需求：REQ-037
- 当前状态：experimental / frozen；源码扫描建图不再作为当前主线验收，只在明确重开图谱方向时执行。
- 目标平台：Android + iOS + Backend
- GIVEN 一个 fixtures Android 源码目录，包含 AndroidManifest、Navigation XML、layout XML 和 strings.xml。
- AND 一个 fixtures iOS 源码目录，包含 Info.plist、Storyboard / XIB、SwiftUI / UIKit navigation 和 Localizable.strings。
- AND 一个 SourceWorkspace 由主工程、本地子工程、远程源码 provider 和 artifact provider 组成。
- WHEN 用户在平台触发源码扫描。
- THEN 平台应只读源码，不修改业务仓库文件。
- AND 平台按平台 scanner plugin 生成候选 BusinessNode、StateMatcher 和 OperationEdge。
- AND 每个候选资产包含 provider、repo、branch、module、artifact、source file、line 或可追溯来源。
- AND 候选资产默认状态为 draft。
- AND artifact-only 候选必须标记低置信和能力 warning。
- AND 高置信候选进入自动验证队列，低置信或冲突候选进入异常治理队列。
- 验证方式：source-scanner 单元测试 + SourceWorkspace provider mock + graph candidate API 集成测试。
- 回归范围：SourceScanner、SourceProvider、Graph candidate pipeline、Dashboard governance flow。

### AC-041：候选图谱自动验证与晋级

- 关联需求：REQ-036、REQ-037、REQ-038
- 当前状态：experimental / frozen；候选自动验证和晋级保留为实验能力，不阻塞 StructuredFlow 主线。
- 目标平台：Backend + Mock Driver，Android / iOS 真机 follow-up
- GIVEN 候选池中存在 source scan、recording 和 exploration 生成的候选节点 / 边。
- WHEN CandidateValidationJob 执行这些候选。
- THEN 平台应在设备上采集 before / after Observation、截图、UI tree / WDA source、OCR、日志、异常事件和耗时。
- AND 平台计算 source_signal、runtime_pass_rate、matcher_stability、transition_stability、fallback_penalty、cross_device_coverage、cross_version_stability、health_guard 和 evidence_completeness。
- AND 连续验证通过且无冲突的高置信候选自动晋级到待发布 active 版本。
- AND 中置信候选继续自动补跑验证。
- AND 低置信、不可达、状态冲突或依赖不稳定 fallback 的候选进入异常治理队列。
- AND Dashboard 不要求用户逐条 review 所有原始候选。
- 验证方式：Mock Driver candidate validation 测试 + confidence scoring 单元测试 + Dashboard 异常队列组件测试。
- 回归范围：CandidateValidationJob、GraphRunner、StateDetector、Dashboard graph pages、legacy run。

### AC-036：目标节点路径规划

- 关联需求：REQ-038
- 当前状态：experimental / frozen；目标节点路径规划不再作为默认用户工作流验收。
- 目标平台：Backend
- GIVEN active 图谱包含 root -> home -> class -> homework_create 的路径。
- AND 每条边都包含 action policy 和 expectations。
- WHEN 用户选择 targetNode=homework_create 并请求路径预览。
- THEN RoutePlanner 返回 root、home、class、homework_create 的 RoutePlan。
- AND RoutePlan 包含 edges、strategy、assumptions 和 snapshot。
- WHEN 目标节点不可达或某条边缺少 action policy。
- THEN 平台返回 RoutePlanIssue，不应盲目创建执行任务。
- 验证方式：RoutePlanner 单元测试 + API 集成测试。
- 回归范围：RoutePlanner、Graph validation、Run creation。

### AC-037：图谱路径执行与偏离恢复

- 关联需求：REQ-038
- 当前状态：experimental / frozen；GraphRunner 回归保留，但不替代 StructuredFlowRunner 验收。
- 目标平台：Backend + Mock Driver + Android 真机
- GIVEN active 图谱和 Mock Driver 设备。
- AND Mock Driver 可以按边返回不同 Observation。
- WHEN 用户触发 targetNode 执行。
- THEN GraphRunner 按 RoutePlan 逐边执行。
- AND 每条边执行前校验 fromNode，执行后校验 toNode 和 expectations。
- AND 报告展示规划路径、实际路径、节点识别分数、动作策略和 expected / actual。
- WHEN Mock Driver 模拟阻塞弹窗。
- THEN Runtime Interceptor 处理弹窗后重试当前边。
- AND Runtime Interceptor 处理记录必须写入 step metadata，并在 HTML 报告和 Dashboard 中显示规则、命中文案和执行动作。
- AND 当阻塞弹窗持续出现时，Runner 必须受最大处理轮次限制，不得无限循环。
- WHEN Mock Driver 模拟偏离到已知节点。
- THEN Runner 尝试重新规划或按策略失败，并在报告中记录偏离原因。
- WHEN 后置状态未到达且边配置 `failurePolicy.retryCount`。
- THEN Runner 必须有限次重新观测状态，并记录每次 `retry_observe`；如果仍未到达目标，应按 `recoverTo` 记录 `replan_required`、`recover_required` 或 `fail`，不得无限循环。
- WHEN 后置状态偏离到已知节点且边配置 `failurePolicy.recoverTo=replan`。
- THEN GraphRunService 必须从实际节点重新规划到原目标节点并继续执行；第一版最多重规划 1 次，恢复步骤必须在 API、HTML 报告和 Dashboard 中显示 `recoveryAttempt`。
- WHEN Mock Driver 模拟 crash / ANR。
- THEN Runner 立即失败并保留截图、视频、日志和事件。
- AND Android 真机应至少跑通一个真实业务图谱目标节点执行，报告包含每条边的截图、视频、节点识别和语义定位证据。
- 验证方式：GraphRunner 集成测试 + Android 真机手动验证。
- 回归范围：GraphRunner、StateDetector、Runtime Interceptor、RecoveryPolicy、Report。

### AC-038：录制和探索沉淀候选图谱

- 关联需求：REQ-037
- 当前状态：experimental / frozen；录制主产物应是 StructuredFlow，录制转全局图谱只作为实验能力。
- 目标平台：Recorder + Backend
- GIVEN Dashboard 已进入录制状态，并且当前图谱已有 home 节点。
- WHEN 用户从 home 执行动作进入 homework_create 页面。
- THEN Recorder 采集动作前后 Observation。
- AND 平台识别 beforeNode=home。
- AND 如果 afterNode 可识别，则生成 CandidateEdge。
- AND 如果 afterNode 不可识别，则生成 CandidateNode draft 并提示用户补 matcher。
- AND 坐标动作只作为 fallback ActionPolicy 保存。
- WHEN 自动探索运行到最大动作数。
- THEN 探索停止，并生成 draft 候选资产和可复现 seed。
- 验证方式：Recorder / Exploration mock 测试 + Dashboard 手动验证。
- 回归范围：Recorder、ExplorationEngine、Graph candidate pipeline。

### AC-039：动态预期覆盖与 AI / CI 目标节点验证

- 关联需求：REQ-039
- 当前状态：partially active；RuntimeOverlay 作为底层能力继续用于 StructuredFlow，目标节点 / graph-run 入口为 experimental / frozen。
- 目标平台：REST API + CLI + MCP adapter
- GIVEN active 图谱可以到达 homework_create 节点。
- AND CI / AI 已提供一个新包路径。
- WHEN 调用 `POST /api/graph-runs`，传入 targetNode=homework_create 和 RuntimeOverlay：`text_visible=yyy`。
- THEN 平台安装或启动指定包，并按 active 图谱规划路径。
- AND 沿途默认验证 no_crash、no_anr、app_alive 和状态迁移。
- AND 到达目标节点后验证 overlay expectation。
- AND overlay expectation 只作用于本次 Run，不写入 active 图谱。
- GIVEN 当前设备已经处于 targetNode。
- WHEN 调用 `POST /api/graph-runs` 并传入 RuntimeOverlay。
- THEN 平台必须生成 `target.validation` noop 步骤，验证目标节点默认预期、RuntimeOverlay、no_crash 和 app_alive，并生成截图、视频和报告证据。
- WHEN overlay 验证失败。
- THEN API 返回 failedAt.phase=expectation、expected、actual、reportUrl、screenshots、videoUrl 和 logs。
- WHEN 调用 `GET /api/graph-runs/{runId}` 或 CLI `graph-status --run {runId}`。
- THEN 返回图谱语义摘要，包括 status、target node、route、failedAt、reportUrl、screenshots、videos、logs、failureEvidence 和每步 before / after node match。
- WHEN 在 Dashboard 打开一个图谱 run 的执行详情。
- THEN 页面必须消费 `/api/graph-runs/{runId}` 的图谱语义摘要，并展示目标节点、路径、失败阶段、before / after 节点识别、动态预期、视频和失败证据入口。
- WHEN RuntimeOverlay 包含 `state_is`。
- THEN GraphRunner 必须用 active graph version 和 Observation 管线判断当前业务节点；legacy 线性回放不得用坐标或 OCR 猜测该预期。
- WHEN RuntimeOverlay 包含 `performance_not_regressed` 且传入显式 baseline。
- THEN 平台必须按 metric、baseline 和 tolerancePercent 判断是否劣化，并在报告中展示 expected / actual。
- WHEN 打开 HTML 报告。
- THEN 报告必须展示“业务图谱执行”区，并把预期分为图谱默认、动态预期、系统护栏三类，同时关联截图、视频和日志证据。
- WHEN 调用 `GET /api/graphs/{versionId}/quality`。
- THEN 返回该图谱版本最近节点 / 边执行质量，包括 runCount、passedCount、failedCount、passRate、latestRunId、latestReportUrl 和 latestFailureMessage。
- WHEN 在 Dashboard 业务图谱页选择目标节点。
- THEN 页面展示该目标节点最近执行次数、通过率、最近失败原因和最近报告入口；暂无历史执行时展示首次执行后沉淀稳定性的提示。
- WHEN 通过 MCP adapter 调用 trigger_node_test。
- THEN MCP 工具复用 REST API，不绕过设备锁、任务队列和报告生成。
- 验证方式：API 集成测试 + CLI 测试 + Mock MCP client 测试；`graph-quality.test.ts` 覆盖图谱质量统计；`GraphCandidatesPanel.test.ts` 覆盖 Dashboard 质量展示；`report-core.test.ts` 覆盖图谱报告区；真机已用 ClassIn `classin.teacher.lesson.create` 目标节点验证 already-at-target RuntimeOverlay 失败路径。
- 回归范围：RuntimeOverlay、GraphRunner、GraphQuality、Report、CLI、MCP adapter。

### AC-040：v1 / v2 兼容迁移保护

- 关联需求：REQ-040
- 目标平台：Backend + Dashboard + Mock Driver
- GIVEN 平台已存在一个 legacy 录制用例。
- AND 该用例包含点击、滑动、等待、条件弹窗或预期验证中的至少一种。
- WHEN 开发者新增 BusinessGraph、RoutePlanner 或 GraphRunner 相关能力。
- THEN `/api/cases` 和 `/api/runs` 的 legacy 主流程仍可创建用例、保存步骤、触发执行并生成报告。
- AND Android 预览控制链路不因 graph API 新增而改变事件下发语义。
- AND legacy report 仍包含每步截图、执行视频、步骤结果、异常事件和 HTML 报告链接。
- AND graph API 使用 `/api/graphs` 和 `/api/graph-runs`，不会复用或改变 legacy run 的 request / response 语义。
- WHEN 用户把 legacy 用例转换为候选图谱。
- THEN 平台生成 draft CandidateNode / CandidateEdge / ActionPolicy。
- AND 原始 legacy 用例仍保留，仍可用 v1 回放。
- AND 转换结果记录 sourceCaseId、sourceStepId 和原始截图 / 参数，便于回溯。
- AND 坐标型 tap / long_press / swipe 只能作为 fallback ActionPolicy，语义动作优先作为主策略。
- AND 转换结果不得自动发布为 active 图谱。
- 验证方式：Mock Driver legacy flow 回归测试 + `legacy-case-graph.test.ts` graph candidate 转换测试 + report fixture 测试。
- 回归范围：Legacy Recorder、Case Storage、AutomationRunner、Report、Graph Candidate Adapter、Dashboard navigation。

### AC-042：图谱执行稳定性内核升级

- 关联需求：REQ-038、REQ-039、REQ-040
- 当前状态：partially active；动态等待、matcher 质量门禁、Runtime Interceptor 等底层能力继续复用，GraphRunner / 目标节点测试规格库为 experimental / frozen。
- 目标平台：Backend + runner-core + Dashboard + Android 真机
- GIVEN active 图谱存在 root、home、class、target 等节点，并且节点 matcher 包含 package / activity / resource-id / text / OCR 等多种证据。
- WHEN 用户从系统桌面触发 targetNode 执行。
- THEN GraphRunService 必须先识别当前状态为 App 外或 unknown，再执行 bootstrap / startStrategy 启动目标 App。
- AND bootstrap 后必须重新采集 Observation，并从实际识别出的业务节点规划到目标节点。
- AND 报告必须展示 bootstrap 策略、前后 Observation、规划起点、目标节点和本次 RoutePlanSnapshot。
- GIVEN 用户已经处于 App 内某个 active 图谱节点。
- WHEN 触发另一个 targetNode 执行。
- THEN 平台必须从当前识别节点规划，不应硬走 root 启动路径。
- GIVEN 动作后页面存在 loading、动画或网络等待。
- WHEN GraphRunner 执行该边。
- THEN Runner 必须按 TransitionWaitPolicy 持续 polling Observation，直到目标节点和后置预期稳定通过或超时失败，不得只依赖固定 sleep 后单次判断。
- AND polling 期间 Runtime Interceptor 可处理阻塞弹窗；处理记录必须进入报告。
- GIVEN 目标节点只命中单一弱 matcher 或关键 matcher 缺失。
- WHEN StateDetector 计算节点匹配。
- THEN 结果应降为低置信或 multiple_candidates，并在报告中展示未命中的关键 matcher 和低置信原因。
- GIVEN 用户保存一个 v2 测试规格。
- WHEN 再次执行该规格。
- THEN 平台应保存目标 App、目标节点、运行策略、动态预期模板和质量门禁，并在运行时重新规划 RoutePlan；不得把历史某次 RoutePlan 当作唯一固定路径。
- 验证方式：Mock Driver 集成测试 + `graph-run-service.test.ts` + report-core / Dashboard 组件测试 + Android 真机从桌面启动到真实目标 App 的 active 图谱节点验证。
- 回归范围：GraphRunService、RoutePlanner、GraphRunner、StateDetector、Runtime Interceptor、Graph Report、目标节点测试规格库。

### AC-043：TestRuleCore 底层执行规则统一

- 关联需求：REQ-041、REQ-038、REQ-039、REQ-040
- 目标平台：shared + server runner
- GIVEN 一条 StructuredFlow 录制用例包含 beforeState、语义 action、afterExpectations、systemGuards 和 timing。
- WHEN 用户触发该用例执行。
- THEN 平台必须先把 StructuredFlowStep 作为 TestRuleStep 转换为可执行步骤，再交给统一 Runner 管线执行。
- AND 转换结果必须保留 action 原始参数、真实 preconditions、afterExpectations、systemGuards 和 transition timeout。
- AND 早期错误生成的占位 state anchor，例如“起点 / 终点 / tap / 点击元素：xxx”，不得阻塞执行。
- AND 真实可观测的文本、元素、图像或状态预期必须保留。
- GIVEN targetApp 仍是历史 `unknown.android.package`。
- WHEN 步骤 action 或 locator 中存在真实 Android packageName。
- THEN 执行器必须从步骤中推断启动包名。
- GIVEN 后续 BusinessGraph RoutePlan 需要执行。
- WHEN Graph RoutePlan 被转换为 TestRuleStep。
- THEN 它必须能复用同一转换入口，而不是复制 StructuredFlowRunner 的私有逻辑。
- 验证方式：`test-rule-step.test.ts` 覆盖转换、过滤、timing、metadata 和 package 推断；`structured-flow-runner.test.ts` 覆盖执行器迁移后行为不变。
- 回归范围：StructuredFlowRunner、AutomationRunner adapter、shared model、未来 Graph execution adapter。

### AC-044：PageStateFlow 页面状态资产闭环

- 关联需求：REQ-042
- 目标平台：Backend + Web Dashboard + Android first，iOS follow-up
- GIVEN Dashboard 主导航已加载。
- WHEN 用户查看当前产品入口。
- THEN 平台必须保留“用例录制”和“用例库”两个既有模块。
- AND 平台必须新增“资产录制”模块，用于人工录入 / 更新页面资产。
- AND 平台必须新增“目标执行”模块，用于输入目标页面 / 目标元素 / 可检索描述，并规划和执行路径。
- AND “资产录制”和“目标执行”不得挤占“用例录制 / 用例库”的主流程入口；StructuredFlow 仍作为线性回归资产保留。
- GIVEN 平台已登记一个 Android App，并配置 packageName 和版本范围。
- WHEN 用户进入“资产录制”模块并点击“开始录入 / 识别当前页面”。
- THEN 平台必须采集 Observation，并通过 package、activity、resource-id、文本、OCR、截图区域等多信号匹配 PageModel。
- AND 如果页面属于目标 App 且命中 active PageModel，Dashboard 展示页面名称、匹配分数、命中的 matcher 和未命中的关键 matcher。
- AND 如果页面未知但信号充足，用户可以保存为 draft PageModel。
- AND 如果当前是桌面、系统设置、其他 App 或信号不足，平台不得写入目标 App active 页面资产，并展示原因。
- AND PageModel 必须包含 AI 可读信息，包括 targetRef、中文名、别名、业务描述、意图标签和示例指令。
- AND 资产录制模块左侧必须展示当前连接设备的实时预览和基础操作入口。
- AND 资产录制模块右侧必须展示当前页面候选信息，包括页面 matcher、截图主区域、可操作元素、Android / iOS profile、AI 可读信息和保存 / 更新入口。
- AND 当当前页面与已有逻辑 PageModel 相似时，平台必须优先提示更新该页面的当前平台 profile，而不是默认新建重复页面。
- AND 用户在设备上执行一步动作后，资产录制模块必须能够展示动作前页面、动作元素、动作后页面 / 弹层 / 局部变化，并允许保存为 PageTransition candidate。
- GIVEN PageStateLibrary 已存在逻辑页面 `home`，且只有 Android profile。
- WHEN 用户连接 iOS 设备并识别同一个首页。
- THEN 平台必须通过逻辑 key、页面名称、通用 OCR、截图区域相似度或用户确认匹配已有 `home` PageModel。
- AND 平台应更新 `home` 的 iOS profile，而不是默认创建新的 `ios_home` 逻辑页面。
- GIVEN 用户在 iOS 上执行目标页面，但目标路径中某个页面只有 Android profile。
- WHEN 该页面存在 mobile-both 通用截图区域、OCR 标题或图像区域证据。
- THEN 平台可以使用跨平台视觉 fallback 低置信识别 / 执行。
- AND 报告必须标记 fallback 原因、使用的证据和缺失的 iOS matcher / locator，并提示补录 iOS profile。
- AND 如果 fallback 失败，报告必须给出“缺少平台精确信息”的失败分类，而不是只显示普通定位失败。
- GIVEN 用户在录制中点击一个页面元素。
- WHEN 动作前后 Observation 均可采集。
- THEN 平台必须生成 PageElement locator 候选，优先 resource-id / accessibility id，其次 desc / label、文本、OCR、图像区域，坐标只作为 fallback。
- AND 平台必须识别动作后的 outcome：导航到目标页面、打开弹层、局部状态变化或无可见变化。
- AND 平台必须生成 PageTransition candidate，并保存 source page、action element、target page / overlay、afterExpectation 和证据。
- AND 用户在截图上手工圈选动作区域并保存时，平台必须把该区域同时沉淀为源 PageModel 的 PageElement 和 PageTransition action；再次识别该页面时必须回显该手工动作区域。
- AND `tap_on_image` 使用人工 `image-region` 时，执行器必须先通过 OCR、crop hash/template、视觉候选或结构候选完成运行时重定位；命中后点击运行时目标中心或安全点，并在报告 / metadata 中记录定位证据。
- AND 如果只有人工 `region` / `region_center` 而没有重定位证据，执行器必须失败并在报告 / 修复 UI 暴露记录区域、记录中心点和 `runtime_relocation_required`，不得默认点击区域中心。
- GIVEN 用户在连接边 / 页面能力中配置 `compound_navigation`。
- WHEN 用户保存“点击右上角 + -> 等待添加好友文字 -> 点击添加好友 -> 跳转添加好友页”。
- THEN 平台必须保存 `compoundSteps`，并把该转移作为 active PageTransition 纳入路径规划。
- AND 执行时必须按顺序执行主动作、等待中间状态、点击中间菜单项，再动态等待目标页面；任一步失败时报告展示失败的 micro-step。
- GIVEN 用户在主页保存 `grid_candidate` 班级列表入口，并配置结果为跳转班级详情。
- WHEN 执行目标路径时第一个班级详情缺少后续创建课堂入口。
- THEN 平台必须按失败策略返回主页并尝试下一个同屏候选。
- AND 报告必须显示 `grid_candidate_downstream_failed`、候选序号、回退和重试原因。
- GIVEN 用户在目标执行中输入“目标项 / 班级名”为 `班级四十二号`，或外部 API 传入 `RuntimeOverlay.runtimeParams.className=班级四十二号`。
- WHEN 路径中存在主页 `grid_candidate` 班级列表入口，即使该历史资产仍配置为 `targetKind=nth_item`。
- THEN 本次 ExecutionPlan 必须临时按 `item_text + targetQuery=班级四十二号` 在用户圈选的网格区域内 OCR 定位目标卡片并点击。
- AND 如果指定班级名未找到或下游路径失败，平台必须报告失败，不得自动切换到其它班级候选。
- AND 高置信 candidate 可进入 active；低置信、坐标-only、OCR-only 关键跳转或冲突 candidate 必须进入 draft / 治理队列。
- GIVEN PageStateLibrary 中存在从教师班级列表到新建课堂页的 active PageTransition 链路。
- WHEN 用户打开“目标执行”模块并输入目标页面“新建课堂页”。
- THEN 平台必须先解析目标；如果能唯一解析到 targetRef，才允许继续规划。
- AND 如果存在多个候选目标，平台必须返回 needs_disambiguation 和候选 targetRef 列表，不得直接执行。
- AND 候选列表必须展示页面名、targetRef、别名 / 描述命中原因、平台覆盖情况、最近质量和匹配分数。
- AND 如果找不到候选，平台必须提示“尚未录入该页面资产”，并提供跳转到“资产录制”模块的入口。
- WHEN 用户确认唯一候选并点击执行。
- THEN PathPlanner 必须先识别当前页面；如果当前在目标 App 内且可识别，应从当前页面规划，不应固定从 root 开始。
- AND 如果当前在 App 外，应按 startStrategy 启动 App，重新识别页面后再规划。
- AND 执行器必须逐个 PageTransition 转成 TestRuleStep 执行：等待 source page、处理 Runtime Interceptor、解析语义元素、执行动作、动态等待 outcome、采集证据。
- AND 执行报告必须展示规划页面链路、实际页面链路、页面匹配分数、元素定位方式、expected / actual、截图、视频、日志、性能和阻断页处理记录。
- AND 执行报告必须展示本步执行动作的可读摘要、动作前后页面匹配结果、复合步骤明细、候选重试原因和失败原因。
- AND 执行报告必须展示 AI / 用户输入目标、解析到的 targetRef、候选消歧过程和最终 PathPlan。
- GIVEN 用户已经在“资产录制”中为某个页面保存输入框、按钮等 PageElement。
- WHEN 用户进入该页面的“页面任务”页签。
- THEN Dashboard 必须优先展示已保存 PageTask，并支持新增、编辑、删除。
- AND PageTask 步骤必须能引用当前页已保存 PageElement，`wait` 步骤允许只填写等待文字或参数 key。
- AND 保存 PageTask 必须写入源 PageModel 的 `assetRecordingPageTasks`，不得把运行期业务数据写成页面 matcher。
- GIVEN 用户在“目标页面测试”中选择目标页面和目标页 PageTask。
- WHEN 用户点击“规划并执行”。
- THEN 平台必须先按 PageStateFlow 规划并执行到目标 PageModel，再把选中的 PageTask 步骤追加到 ExecutionPlan 末尾。
- AND PageTask 运行参数是可选覆盖项：传入 `lessonName=数学课`、`duration=45分钟`、`recordClassroom=off` 时只修改对应字段；未传的 `valueParamKey` / `desiredStateParamKey` 不视为失败，对应字段步骤必须跳过并保留页面默认值。
- AND `text_input` 步骤必须从 `RuntimeOverlay.runtimeParams` 中按 `valueParamKey` 取值，找不到运行参数时才允许使用步骤固定文本；两者都没有时跳过该输入步骤。
- AND `tap` / `submit` 步骤必须复用被引用 PageElement 的视觉 locator、语义区域和坐标空间执行。
- AND `wait` 步骤必须等待指定文字或运行参数文本出现。
- AND 执行报告 / step metadata 必须展示 `pageTaskId`、`pageTaskName`、`pageTaskStepId`、`pageTaskStepName` 和本次使用的 `runtimeParamKeys`，便于回溯表单任务每一步。
- WHEN 路径缺失。
- THEN 平台返回 route gap，说明缺少 source page、target page、transition、matcher 或 action locator，并提供“识别当前页面 / 录制补齐路径”的入口。
- AND Dashboard 必须允许用户从 route gap 直接跳转到“资产录制”模块补录缺失页面或转移。
- GIVEN 用户开启受控探索录制高级模式。
- WHEN 平台在预算、深度、黑白名单和风险动作规则内探索页面。
- THEN 平台只能生成 draft PageModel / PageTransition，不得绕过质量策略直接污染 active 页面资产。
- AND 探索结果必须展示新增页面、候选转移、阻断页、失败原因和可人工确认的证据。
- GIVEN App 改版后某个页面 matcher 连续失败。
- WHEN 用户打开页面资产详情。
- THEN 页面资产库必须允许编辑页面 matcher、截图区域、元素 locator、转移预期和兼容版本范围。
- AND 用户可以把旧 profile / transition 标记为 stale、needs_update 或 deprecated。
- 验证方式：PageStateFlow mock 集成测试 + Dashboard 组件测试 + Android 真机手动验证一条真实页面路径。
- 回归范围：ObservationService、PageMatcher scorer、Page asset storage、TargetResolver、Recorder、PathPlanner、TestRuleCore adapter、Report、Dashboard 页面资产库。

### AC-045：自动发现 Bug 后提报 TAPD

- 关联需求：REQ-043
- 目标平台：Backend + Web Dashboard + REST / CLI / MCP adapter
- GIVEN TAPD 配置已启用，模式为 `manual_review`。
- WHEN 一次自动测试发生 crash、ANR、步骤预期失败、PageStateFlow 路径失败、视觉差异失败或性能阈值劣化。
- THEN 平台必须基于 Run 报告生成 `DefectCandidate`，包含标题、失败类型、严重级别、优先级、fingerprint、复现步骤、expected / actual、设备信息、App 版本、报告链接、截图、视频、日志和 crash / ANR / 指标证据。
- AND `manual_review` 模式下不得直接创建 TAPD 缺陷，必须在报告详情或缺陷候选队列等待用户确认。
- WHEN 用户确认提交缺陷。
- THEN 平台必须调用 TAPD 创建缺陷，并把 TAPD bugId、TAPD 链接、提交时间和提交人写回缺陷候选、执行报告和 Dashboard。
- GIVEN TAPD 配置为 `auto_create`，且失败满足高置信策略，例如稳定 crash signature、ANR、关键路径连续复现失败或测试计划显式允许自动提交。
- WHEN Run 失败并生成缺陷候选。
- THEN 平台可以自动提交 TAPD，并在报告中标记自动提交原因。
- GIVEN 同一 fingerprint 的失败已经存在已提交 TAPD 缺陷。
- WHEN 后续 Run 再次发生同类失败。
- THEN 平台不得重复创建新 TAPD 缺陷，应关联已有 bug、追加本次报告证据或标记为 duplicate candidate。
- GIVEN 用户忽略某个候选并设置 suppression window。
- WHEN 同一 fingerprint 在窗口期内再次出现。
- THEN 平台不得自动提交 TAPD，报告应展示已被 suppression 规则忽略。
- GIVEN TAPD API 不可用、鉴权失败、字段校验失败或附件上传失败。
- WHEN 用户或自动策略尝试提交缺陷。
- THEN 测试 Run 结果不得被改写；平台必须记录 `integration_failed` 事件、展示失败原因，并允许重试。
- GIVEN 外部 AI / CI 调用一次目标执行或用例执行。
- WHEN 执行失败且生成缺陷候选。
- THEN API / MCP 响应必须包含缺陷候选 ID、提报状态、TAPD 链接或提交失败原因，便于 AI / CI 继续处理。
- 验证方式：server defect service 单元测试 + TAPD mock client 集成测试 + report-core 测试 + Dashboard 组件测试 + REST / MCP mock 测试。
- 回归范围：Runner result、Report、Artifact storage、Notification / external API、Dashboard 报告详情、缺陷候选队列。

### AC-046：资产驱动巡检

- 关联需求：REQ-044
- 目标平台：Backend + Web Dashboard + Report + Android first，iOS follow-up
- GIVEN Dashboard 主导航已加载。
- WHEN 用户查看测试入口。
- THEN 平台必须保留现有“自动探索 / 稳定性探索”入口。
- AND 平台必须新增独立“资产驱动巡检”入口，不能把它和盲目探索混成同一个默认按钮。
- GIVEN 用户选择“从当前页面开始巡检”。
- WHEN 当前设备页面稳定命中 active PageModel。
- THEN 平台必须生成 AssetPatrolPlan，包含页面健康检查、区域滚动检查、PageElement 重定位检查、PageTransition 验证和 PageTask dry-run。
- AND 计划预览必须展示将要巡检的页面、区域、元素、连接边、页内任务、预计风险和跳过项。
- GIVEN 当前设备页面未知、低置信、多候选或处于目标 App 外。
- WHEN 用户触发资产驱动巡检。
- THEN 平台必须停止或进入只读诊断，不得继续随机点击 OCR / UI 候选。
- GIVEN PageModel 中存在用户标注的 content / list / dynamic region。
- WHEN 巡检执行区域滚动检查。
- THEN Runner 只能在这些区域内滑动，并在滑动后重新识别当前页面。
- AND 标题栏、底部导航、系统栏和危险操作区域不得被用于滚动。
- GIVEN 某个 PageElement 只有历史 region / region_center，没有 OCR、视觉模板、结构定位或候选重定位证据。
- WHEN 巡检执行元素检查。
- THEN 该元素必须标记为 `runtime_relocation_required` 或需要修复，不得点击历史中心点。
- GIVEN 巡检计划包含 PageTransition。
- WHEN PageTransition 文案或 action 被识别为删除、支付、发布、提交、退出登录、确认等高风险动作。
- THEN 默认必须 skipped，并在报告中展示跳过原因。
- AND 只有巡检配置或测试计划显式允许高风险动作时才可以执行。
- GIVEN 巡检计划包含 PageTask。
- WHEN `allowBusinessSubmit=false`。
- THEN Runner 默认只执行 dry-run / 轻量验证，检查元素引用、参数解析和提交前路径，不得真实提交业务数据。
- GIVEN 巡检执行完成。
- THEN 报告必须展示页面覆盖率、元素定位成功率、连接边成功率、PageTask 可执行性、跳过原因、失败分类、耗时分布、性能指标、异常事件和修复入口。
- AND 每个失败项必须关联到具体 PageModel / PageElement / PageTransition / PageTask。
- GIVEN 巡检过程中发现新页面、新元素、新边、页面变体或定位修复建议。
- WHEN Run 结束。
- THEN 新页面、新元素、新边和页面变体默认只能进入候选管理 / 报告候选区 / 资产录制确认流程，不得自动写入 active 页面资产。
- AND 定位修复建议只有在满足 REQ-045 的 AI 高置信、低风险、验证通过和自动修复策略时，才可以通过受控 AssetPatch 流程自动应用为新的 active 资产版本。
- 验证方式：AssetPatrolPlanner / Runner 单元测试 + server API 集成测试 + report-core 测试 + Dashboard 组件测试 + Android 真机主流程巡检手动验证。
- 回归范围：PageMatcher、SemanticLocator、PageTransition execution、PageTask dry-run、RuntimeInterceptor、Report、Dashboard 资产录制和稳定性探索入口。

### AC-047：探索异常 AI 诊断与受控资产修复

- 关联需求：REQ-045
- 目标平台：Backend + MCP / REST adapter + Report + Dashboard，Android first，iOS follow-up
- GIVEN 稳定性探索、资产驱动巡检或目标执行过程中发生 crash / ANR / 黑屏 / App 退出。
- WHEN Runner 进入失败处理。
- THEN 平台必须先固化截图、日志、性能采样、动作序列和运行事件，再生成 AI 诊断证据包。
- AND AI 诊断结果必须把该问题归类为运行 / 业务异常或 `unsafe_to_decide`，不得自动生成 active 资产更新。
- GIVEN 执行失败原因是当前页面未匹配、PageElement 重定位失败或连接边缺失。
- WHEN 规则分类和 AI 诊断判断更可能是资产过期或测试计划缺口。
- THEN 平台必须生成 `AssetPatchCandidate` 或候选建议，并在报告和失败修复 UI 中展示 patch 内容、依据和置信度。
- AND patch 默认必须是 draft，不得绕过资产质量校验、验证结果、风险策略和预算直接写入 active PageStateFlow。
- GIVEN AI 提交了资产修复草稿。
- WHEN 系统验证该草稿。
- THEN 验证必须至少重新执行页面匹配、元素重定位或连接边轻量验证中的相关项。
- AND 验证失败或置信度不足时必须进入人工复核，不得继续盲点点击。
- GIVEN AI 诊断高置信判断为资产问题，patch 类型属于低风险白名单，证据完整，且 `auto_apply_verified_patch` 策略开启。
- WHEN 资产修复 patch 通过系统验证，且单次 Run 自动修复预算未耗尽。
- THEN 平台可以通过受控 MCP / REST 工具自动应用 patch，生成新的 active 资产版本，并继续本次执行。
- AND 报告必须展示 AI 诊断、patch 内容、验证结果、应用策略、新旧版本、回滚入口和继续执行结果。
- GIVEN 资产修复草稿验证通过，但策略未开启自动应用或 patch 风险较高。
- WHEN Runner 继续探索或巡检。
- THEN patch 必须保持 draft / validated，等待人工确认后才能进入 active；Runner 不得把该资产问题静默当作通过。
- GIVEN 外部 AI 通过 MCP / REST 工具请求更新资产。
- WHEN 工具调用 `propose_page_asset_patch`。
- THEN 系统必须创建受控 patch，并校验 patch 类型、资产范围、证据引用、风险等级、预算和权限。
- AND 只有调用 `apply_page_asset_patch` 且策略 / 验证均通过时，patch 才能进入 active。
- AND 工具不得允许 AI 直接控制设备、删除 active 资产、写入平台依赖 matcher、启用历史 `region_center` 点击或绕过回滚记录。
- GIVEN 模型调用超时、返回非 JSON、schema 校验失败或低置信。
- WHEN Runner 处理诊断结果。
- THEN 平台必须回退到规则诊断并保留原始失败，不得把 Run 标记为通过。
- 验证方式：server diagnosis 单元测试 + mock OpenAI-compatible client 测试 + MCP adapter contract 测试 + report-core 测试 + Dashboard 失败修复 UI 测试 + Android 真机三类失败手动验证。
- 回归范围：StabilityExplorer、AssetPatrolRunner、GraphRunService、RunArtifact、DefectCandidate、PageState asset storage、MCP adapter、Report、Dashboard repair UI。

### AC-048：资产衍生组合测试

- 关联需求：REQ-ADT-004、REQ-ADT-006、REQ-ADT-007、REQ-042
- 目标平台：Backend + Web Dashboard + Report + Android first
- GIVEN 用户维护一个 App 级 Parameter Profile。
- WHEN 保存字符串、数字、布尔值或模板值。
- THEN Server 必须持久化参数类型和版本，并允许组合执行期覆盖；缺少元功能必需参数时预检必须失败。
- GIVEN 用户创建元功能。
- WHEN 编排到达页面、执行页面能力、运行 PageTask 和验证页面步骤。
- THEN 元功能只能引用当前 active PageStateFlow 资产，不得复制底层 locator、固定坐标或 ActionStep。
- GIVEN 用户把多个元功能加入组合用例。
- WHEN 点击预检。
- THEN 编译器必须解析当前 active 图版本、校验 App / 平台 / 来源页 / 目标页 / PageElement / PageTransition / PageTask，并输出有序执行计划和参数合并结果。
- GIVEN 组合用例预检通过且设备在线。
- WHEN 用户执行单次或 N 次组合测试。
- THEN 执行器必须按顺序复用 GraphRunService，实时展示当前元功能和资产步骤，支持失败停止和主动停止。
- GIVEN PageTask 输入框当前包含动态业务值。
- WHEN 该输入框定义了 OCR 相对结构 locator。
- THEN Runner 必须按稳定锚点和结构关系在当前截图重定位输入行，不能点击历史区域中心，也不能把动态业务值保存为正式定位依据。
- GIVEN 组合执行结束。
- THEN HTML 报告必须按组合用例、轮次、元功能和资产步骤展示状态、关联 PageElement / PageTask、Graph Run ID 和错误。
- 验证方式：storage / compiler / execution 单元测试 + Dashboard 组件测试 + SemanticLocator / GraphRunService 回归 + Android 真机组合用例。
- 真机验收：`asset_composite_execution_1533c860-64b5-4a81-a999-720dc1e6a95b` 5/5 passed；最终页面显示 `自动化组合课堂`、`30分钟`，未点击发布。
- 回归范围：PageStateFlow assets、GraphRunService、PageTask、SemanticLocator、Dashboard navigation、SQLite migrations、HTML report。
