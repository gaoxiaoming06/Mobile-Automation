---
title: 自动化测试平台追踪矩阵
doc_type: traceability
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-07-02
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台追踪矩阵

## Requirement 到设计、任务、验收

| Requirement | Design | Task | Code / Docs | Acceptance |
|---|---|---|---|---|
| REQ-001 可视化面板基础框架 | DES-001、DES-002、DES-003、DES-018、DES-019 | T-001、T-002、T-004、T-012、T-013、T-018 | TBD after implementation | AC-001 |
| REQ-002 设备发现与设备管理 | DES-004、DES-005、DES-006、DES-007、DES-019 | T-006、T-007、T-008、T-022、T-023 | TBD after implementation | AC-002、AC-014 |
| REQ-003 设备选择与实时预览 | DES-003、DES-005、DES-006、DES-008、DES-018 | T-009、T-013、T-023 | TBD after implementation | AC-003 |
| REQ-004 预览页远程操控 | DES-003、DES-004、DES-005、DES-006、DES-008、DES-009 | T-010、T-011、T-013、T-024 | TBD after implementation | AC-004、AC-015 |
| REQ-005 操作录制生命周期 | DES-009、DES-010 | T-003、T-014、T-047 | TBD after implementation | AC-005 |
| REQ-006 步骤可视化与编辑 | DES-003、DES-009、DES-011 | T-003、T-015、T-047、T-052 | TBD after implementation | AC-006 |
| REQ-007 动作类型覆盖 | DES-004、DES-005、DES-006、DES-009 | T-003、T-010、T-024、T-028 | TBD after implementation | AC-004、AC-020 |
| REQ-008 测试用例管理 | DES-009、DES-011、DES-017、DES-019 | T-003、T-005、T-015、T-016 | TBD after implementation | AC-006、AC-007 |
| REQ-009 自动回放与执行模式 | DES-012、DES-013、DES-034 | T-017、T-018、T-049、T-054 | TBD after implementation | AC-008、AC-009、AC-010、AC-031 |
| REQ-010 执行过程控制 | DES-003、DES-012、DES-018、DES-022 | T-017、T-018 | TBD after implementation | AC-008、AC-009、AC-010、AC-017 |
| REQ-011 性能数据采集 | DES-014、DES-016 | T-003、T-019、T-024 | TBD after implementation | AC-011 |
| REQ-012 崩溃、ANR 与异常采集 | DES-015、DES-016、DES-022 | T-003、T-020、T-024 | TBD after implementation | AC-012 |
| REQ-013 测试报告生成 | DES-016、DES-017、DES-019 | T-003、T-005、T-021、T-026、T-053、T-059 | TBD after implementation | AC-013 |
| REQ-014 执行记录与证据留存 | DES-012、DES-014、DES-015、DES-016、DES-017 | T-005、T-017、T-019、T-020、T-021、T-027、T-053、T-059 | TBD after implementation | AC-011、AC-012、AC-013、AC-019 |
| REQ-015 跨平台能力抽象 | DES-001、DES-004、DES-005、DES-006 | T-003、T-006、T-008、T-022、T-024 | TBD after implementation | AC-002、AC-004、AC-020 |
| REQ-016 坐标、分辨率、缩放与方向适配 | DES-008、DES-009 | T-011 | TBD after implementation | AC-003、AC-004、AC-015 |
| REQ-017 目标 App 管理 | DES-005、DES-006、DES-013 | T-010、T-016、T-024 | TBD after implementation | AC-016 |
| REQ-018 多设备与并发执行 | DES-007、DES-012、DES-016 | T-007、T-017、T-025 | TBD after implementation | AC-002、AC-008、AC-014 |
| REQ-019 实时执行观察 | DES-003、DES-012、DES-018 | T-018 | TBD after implementation | AC-017 |
| REQ-020 导入、导出与集成 | DES-002、DES-019、DES-020 | T-016、T-021、T-026 | TBD after implementation | AC-007、AC-013、AC-018 |
| REQ-021 权限与审计 | DES-007、DES-021 | T-001、T-007 | TBD after implementation | AC-014 |
| REQ-022 稳定性与容错 | DES-004、DES-007、DES-012、DES-015、DES-022 | T-004、T-007、T-017、T-020 | TBD after implementation | AC-009、AC-010、AC-012 |
| REQ-023 安全与隐私 | DES-017、DES-021 | T-005、T-021、T-027 | TBD after implementation | AC-019 |
| REQ-024 可扩展能力 | DES-002、DES-009、DES-020 | T-003、T-028 | TBD after implementation | AC-020 |
| REQ-025 测试保障与回归防护 | DES-023 | T-002、T-029、T-030、T-051、T-052、T-053、T-054、T-055、T-056、T-057 | TBD after implementation | AC-021 |
| REQ-026 应用包管理 | DES-024、DES-027、DES-031 | T-031、T-032、T-033、T-039、T-040、T-042 | TBD after implementation | AC-022、AC-023 |
| REQ-027 测试计划与流程编排 | DES-025、DES-027、DES-034 | T-033、T-035、T-043、T-047、T-049 | TBD after implementation | AC-023、AC-031 |
| REQ-028 结构化断言与结果验证 | DES-026、DES-032、DES-034 | T-034、T-035、T-044、T-045、T-049 | TBD after implementation | AC-024、AC-028、AC-031 |
| REQ-029 新包冒烟自动化 | DES-024、DES-027、DES-029、DES-031、DES-034 | T-033、T-037、T-039、T-040、T-043、T-049 | TBD after implementation | AC-023、AC-026、AC-029、AC-031 |
| REQ-030 性能基线记录与版本对比 | DES-026、DES-028 | T-034、T-036、T-046 | TBD after implementation | AC-025 |
| REQ-031 自动触发、调度与通知 | DES-027、DES-029、DES-033 | T-037、T-040、T-041、T-048 | TBD after implementation | AC-026、AC-029、AC-030 |
| REQ-032 可控随机探索与稳定性探索测试 | DES-030、DES-034、DES-042 | T-038、T-049、T-090 | TBD after implementation | AC-027、AC-031 |
| REQ-033 外部工具接口与 AI 仓库导航 | DES-033 | T-048、T-051、T-058 | TBD after implementation | AC-030 |
| REQ-034 步骤级预期输入、验证与语义化固定流程 | DES-009、DES-012、DES-025、DES-026、DES-034 | T-034、T-044、T-045、T-049 | TBD after implementation | AC-031 |
| REQ-035 语义定位录制、目标转换与步骤修复 | DES-005、DES-009、DES-010、DES-012、DES-026、DES-034、DES-035 | T-050、T-052、T-055、T-049、T-044、T-045、T-076 | TBD after implementation | AC-033 |
| REQ-036 业务图谱模型与图谱资产管理 [experimental/frozen upper layer] | DES-036、DES-038 | T-060、T-061、T-063、T-064、T-065、T-070、T-083 | 已有图谱模型和实验入口；上层冻结，底层能力复用于 StructuredFlow | AC-034、AC-036、AC-037 |
| REQ-037 多来源业务图谱生成 [experimental/frozen upper layer] | DES-037 | T-062、T-063、T-066、T-072(frozen)、T-073(frozen)、T-074(frozen) | Source scan / exploration / auto promotion 冻结为实验能力 | AC-035、AC-038、AC-041 |
| REQ-038 目标节点路径规划与图谱执行引擎 [experimental/frozen upper layer] | DES-038、DES-036、DES-005、DES-035、DES-041 | T-061、T-064、T-065、T-067、T-070、T-075、T-076、T-083 | Graph run 保留实验入口；执行规则通过 TestRuleStep 复用于 StructuredFlow | AC-036、AC-037、AC-042、AC-043 |
| REQ-039 动态预期覆盖与 AI / CI 验证接口 | DES-039、DES-038、DES-041 | T-067、T-068、T-069、T-070、T-075、T-081、T-082 | RuntimeOverlay 继续用于 StructuredFlow；graph target node 调用为实验入口 | AC-039、AC-042、AC-043 |
| REQ-040 v1 录制回放兼容迁移与回归保护 | DES-040、DES-023、DES-038 | T-071、T-060、T-065、T-066、T-075 | TBD after implementation | AC-040、AC-042 |
| REQ-041 结构化录制用例与路径快照 | DES-041、DES-034、DES-035、DES-038、DES-039 | T-078、T-079、T-080、T-081、T-082、T-083、R-033 | PageStateFlow 的线性路径快照：`StructuredFlow` model / storage / runner / case library / TestRuleCore adapter | AC-043 |
| REQ-042 PageStateFlow 页面状态资产主线 | DES-042、DES-034、DES-035、DES-039、DES-041 | T-084、T-085、T-086、T-087、T-087A、T-088、T-088A、T-089、T-090、R-034 | 当前主要项目目标：跨平台逻辑页面资产库、Android/iOS platform profile、页面元素、页面转移、路径规划、资产录制、目标执行和 StructuredFlow 快照 | AC-044 |
| REQ-043 自动缺陷提报与 TAPD 集成 | DES-043、DES-016、DES-029、DES-033 | T-091 | 从测试失败报告生成缺陷候选，去重后按 manual_review / auto_create 策略提交 TAPD，并在报告和外部 API 返回缺陷状态 | AC-045 |
| REQ-044 资产驱动巡检 | DES-044、DES-042、DES-016、DES-030 | T-092 | 基于 active PageStateFlow 资产验证页面健康、元素重定位、连接边稳定性、PageTask 可执行性和性能异常；保留自动探索 / 稳定性探索为独立发现入口 | AC-046 |
| REQ-045 探索异常 AI 诊断与受控资产修复 | DES-045、DES-044、DES-043、DES-042、DES-030 | T-093 | 执行异常先固化证据并脱敏，再由规则和 AI 诊断分类；业务异常生成报告 / 缺陷候选并按策略重启继续，资产问题默认生成受控 patch，高置信低风险且验证通过时可自动应用为新的 active 资产版本并继续 | AC-047 |

## 设计到任务

| Design | Task | 说明 |
|---|---|---|
| DES-001 分层架构 | T-001、T-002 | 确认范围并创建工程边界 |
| DES-002 推荐工程形态 | T-002、T-026 | 工程骨架与 CI 扩展 |
| DES-003 Dashboard UI | T-012、T-013、T-015、T-016、T-018、T-021、T-052 | 面板所有核心页面 |
| DES-004 设备驱动抽象 | T-006、T-007 | Driver 接口与设备会话 |
| DES-005 Android Driver | T-008、T-009、T-010、T-019、T-020、T-055、T-076 | Android 设备能力、ADB 底座和动作执行通道演进 |
| DES-006 iOS Driver | T-022、T-023、T-024 | iOS 设备能力 |
| DES-007 设备会话与设备锁 | T-007、T-017、T-025 | 占用、锁和并发 |
| DES-008 预览流和坐标映射 | T-009、T-011、T-013 | 预览和坐标转换 |
| DES-009 ActionStep 模型 | T-003、T-014、T-015、T-028、T-047、T-049 | 录制、编辑、执行动作模型 |
| DES-010 录制流程 | T-014、T-049 | Recording Session |
| DES-011 步骤编辑流程 | T-015、T-016 | Case Editor |
| DES-012 Test Runner | T-017、T-018、T-025、T-049、T-054 | 执行器和多设备执行 |
| DES-013 执行配置模型 | T-003、T-017、T-018 | RunConfig |
| DES-014 性能采集设计 | T-019、T-021 | Metrics 和报告 |
| DES-015 异常事件采集设计 | T-020、T-021 | DeviceEvent 和报告 |
| DES-016 报告生成设计 | T-021、T-026、T-059 | Report JSON / HTML |
| DES-017 存储设计 | T-005、T-021、T-027、T-053 | DB 和附件 |
| DES-018 实时通信设计 | T-004、T-007、T-014、T-018 | WebSocket 事件 |
| DES-019 REST API 设计 | T-004、T-016、T-017、T-021 | API |
| DES-020 CLI / CI 集成设计 | T-026 | 外部触发 |
| DES-021 权限与安全扩展 | T-001、T-027 | 多人部署和安全 |
| DES-022 错误码与失败策略 | T-004、T-017、T-020 | 错误处理 |
| DES-023 测试保障架构 | T-002、T-029、T-030、T-051、T-052、T-053、T-054、T-055、T-056、T-057 | 单元测试、集成测试、Mock Driver、质量门禁 |
| DES-024 Build Registry 与应用包管理 | T-031、T-032、T-033、T-042 | 应用包元数据、安装记录和包测试历史 |
| DES-025 测试计划与 Flow 模型 | T-033、T-035、T-043、T-047、T-049 | 冒烟、回归、性能、稳定性等测试计划 |
| DES-026 结构化断言模型 | T-034、T-035、T-044、T-045 | 断言步骤和结果验证 |
| DES-027 冒烟执行编排 | T-033、T-037、T-040、T-043 | 新包冒烟流水线 |
| DES-028 性能基线设计 | T-036、T-046 | 跨包性能并排对比 |
| DES-029 任务调度与通知 | T-037、T-040、T-041、T-048 | 自动触发、队列和通知 |
| DES-030 可控随机探索与稳定性探索设计 | T-038、T-090 | 随机探索 PoC、稳定性探索、失败路径复现和候选资产草稿 |
| DES-031 包下载、解析和安装服务 | T-039、T-040、T-042 | SMB 拉包、CI 接包、元信息解析和安装 |
| DES-032 自然语言模板解析 | T-034、T-044 | 规则模板解析，不使用大模型 |
| DES-033 外部工具接口与 AI 仓库导航 | T-048、T-051、T-058 | MCP / CLI / Agent 工具入口与 `.ai/` 仓库导航 |
| DES-034 步骤级预期验证与状态感知回放设计 | T-049、T-034、T-044、T-045 | 步骤预期、expected/actual、Flow 起始状态、状态锚点、语义动作和报告证据 |
| DES-035 语义定位录制与步骤修复设计 | T-050、T-052、T-055、T-049、T-044、T-045、T-076 | 元素 / 文字 / 图像区域目标、坐标 fallback、条件分支收敛、失败修复和语义 driver 执行通道 |
| DES-036 业务图谱核心模型设计 [experimental/frozen upper layer] | T-060、T-061、T-063、T-064、T-070、T-083 | BusinessGraph 上层冻结；StateMatcher、ActionPolicy、Observation、RuntimeOverlay 等底层原语复用于 StructuredFlow |
| DES-037 多来源图谱生成设计 [experimental/frozen upper layer] | T-062、T-063、T-066、T-072(frozen)、T-073(frozen)、T-074(frozen) | 源码扫描、自动探索、候选图谱治理冻结；后续仅作为 Flow 候选推荐重新评估 |
| DES-038 目标节点路径规划与图谱执行设计 [experimental/frozen upper layer] | T-061、T-064、T-065、T-067、T-070、T-075、T-076、T-083 | RoutePlanner / GraphRunner 保留实验入口；动态等待、matcher 质量门禁和 RuntimeInterceptor 复用于 FlowRunner |
| DES-039 动态预期覆盖与 AI / CI 接入设计 | T-067、T-068、T-069、T-070 | RuntimeOverlay、REST/CLI/MCP 触发、结构化失败反馈 |
| DES-040 v1 / v2 兼容迁移设计 | T-071、T-060、T-065、T-066、T-075、T-078、T-079、T-080、T-081、T-083 | Legacy Flow 向 StructuredFlow 主线迁移；Business Graph 旁路能力保留实验入口，API / Report / Dashboard 保持兼容边界 |
| DES-041 结构化录制用例设计 | T-078、T-079、T-080、T-081、T-082、T-083、R-033 | StructuredFlow 路径快照、TestRuleStep、用例库主入口、执行到中间步骤、Flow REST / CLI / MCP 和统一执行适配层 |
| DES-042 PageStateFlow 页面状态资产设计 | T-084、T-085、T-086、T-087、T-087A、T-088、T-088A、T-089、T-090、R-034 | PageStateLibrary、PageModel、PageElement、PageTransition、PathPlan、页面资产库 UI、资产录制、目标执行和外部调用入口 |
| DES-043 缺陷候选与 TAPD 提报集成设计 | T-091 | DefectCandidate、DefectFingerprint、TAPD payload、人工审核、自动提报、去重、防刷、报告和 Dashboard 缺陷队列 |
| DES-044 资产驱动巡检设计 | T-092 | AssetPatrolPlan、页面健康检查、区域滚动检查、元素重定位检查、连接边验证、PageTask dry-run、巡检报告和候选修复闭环 |
| DES-045 探索异常 AI 诊断与受控资产修复设计 | T-093 | EvidencePackBuilder、RuleFailureClassifier、AiDiagnosisService、DiagnosisPolicyEngine、AssetPatchCandidate、MCP / REST 工具和报告诊断区 |

## 开放问题追踪

| Question | 关联需求 | 关联设计 | 需要确认人 |
|---|---|---|---|
| Q-001 MVP 双端范围 | REQ-001 至 REQ-024 | DES-002、DES-005、DES-006 | resolved: Android 闭环优先，iOS 基础能力已增量接入 |
| Q-002 部署方式 | REQ-001、REQ-021、REQ-023 | DES-002、DES-017、DES-021 | resolved: 本地单机优先，预留局域网共享 |
| Q-003 技术栈偏好 | REQ-001、REQ-020、REQ-025 | DES-002、DES-023 | resolved: React + TypeScript + Vite + Node.js + SQLite |
| Q-004 iOS 工具链 | REQ-002、REQ-003、REQ-004 | DES-006 | resolved: libimobiledevice + xcrun + WebDriverAgent |
| Q-005 Android 预览方案 | REQ-003、REQ-004 | DES-005、DES-008 | resolved: scrcpy 优先，ADB 截图轮询兜底 |
| Q-006 坐标回放还是控件 / OCR / 图像能力 | REQ-006、REQ-007、REQ-024、REQ-028、REQ-034 | DES-009、DES-026、DES-034 | resolved: 坐标型回放继续保留为基础能力和 fallback；固定业务流程需要步骤级预期验证，状态感知回放作为稳定性增强 |
| Q-007 性能指标和采样频率 | REQ-011 | DES-014 | TODO(confirm) |
| Q-008 报告导出格式 | REQ-013、REQ-020 | DES-016 | resolved: HTML |
| Q-009 APK / IPA 安装 | REQ-017、REQ-026 | DES-005、DES-006、DES-024、DES-031 | resolved: Android APK 安装 / 卸载 / 版本校验优先；IPA 后续接入 |
| Q-010 CI 集成 | REQ-020、REQ-031 | DES-020、DES-029 | resolved: `POST /api/builds` 接包并可自动触发冒烟；CLI 后续扩展 |
| Q-011 多人协作和权限 | REQ-021、REQ-023 | DES-021 | resolved: MVP 不做权限 |
| Q-012 数据保留周期 | REQ-014、REQ-023 | DES-017 | partial: 每次执行均录制并保留视频；具体保留周期和空间上限 TODO(confirm) |
| Q-013 新包来源 | REQ-026、REQ-029、REQ-031 | DES-024、DES-027、DES-029、DES-031 | resolved: MVP 优先支持 SMB + 手动上传，后续接 CI Webhook |
| Q-014 冒烟默认流程 | REQ-027、REQ-029 | DES-025、DES-027 | TODO(confirm): 由 smoke 标签用例集合维护 |
| Q-015 性能劣化阈值 | REQ-030 | DES-028 | resolved: 当前阶段并排展示人工判断，阈值告警后续可选 |
| Q-016 通知通道 | REQ-031 | DES-029 | resolved: MVP 优先企业微信，Webhook 保留 |
| Q-017 随机探索 / 稳定性探索排期 | REQ-032 | DES-030 | resolved: PageStateFlow 核心目标执行稳定后开发；作为新包冒烟和稳定性巡检的补充层，不替代目标执行 |
| Q-018 自然语言转断言是否用大模型 | REQ-028 | DES-026、DES-032 | resolved: 默认不使用；采用规则模板解析 + 用户确认 |
| Q-019 步骤级预期验证是否与断言、冒烟随机化、随机探索冲突 | REQ-028、REQ-029、REQ-032、REQ-034 | DES-026、DES-027、DES-030、DES-034 | resolved: 不冲突；步骤预期负责 expected / actual 判定，状态感知回放负责固定流程稳定执行，随机能力作为补充 |
| Q-020 条件点击与普通语义点击如何区分 | REQ-035 | DES-035 | resolved: `tap_if_text` 是可选分支；普通主流程点击使用 `tap_on_element`、`tap_on_text`、`tap_on_image` 或坐标 fallback |
| Q-021 是否要求业务 App 修改源码暴露自动化契约 | REQ-036、REQ-037 | DES-036、DES-037 | resolved: 不要求；平台保持独立，只读源码扫描生成候选图谱 |
| Q-022 新核心目标是否另起仓库重做 | REQ-036、REQ-038 | DES-036、DES-038 | resolved: 不重做；同仓新增 v2 图谱内核，复用现有设备、driver、报告、包管理底座 |
| Q-023 业务图谱节点粒度 | REQ-036、REQ-037 | DES-036、DES-037 | TODO(confirm): 首个真实 App 试点校准，建议以可识别业务页面 / 业务位置为节点 |
| Q-024 AI/CI 动态预期是否可写入正式图谱 | REQ-039 | DES-039 | resolved: 默认只作为本次 Run overlay；是否提升为正式预期需通过自动验证晋级策略或异常治理 |
| Q-025 首个源码扫描目标仓库 | REQ-037 | DES-037 | TODO(confirm): 影响 Android / iOS 扫描范围、SourceWorkspace 和 fixtures |
| Q-026 v2 是否可以直接替换 v1 录制回放入口 | REQ-040 | DES-040 | resolved: 不直接替换；先旁路新增 v2，保留 v1 兼容期和回归门禁 |
| Q-027 候选图谱是否依赖人工逐条 Review | REQ-036、REQ-037、REQ-038 | DES-036、DES-037、DES-038 | resolved: 不依赖；高置信候选通过自动验证晋级，人工只处理低置信、冲突、不可达和高风险异常队列 |
| Q-028 v2 中“用例”是否等于固定规划路径 | REQ-008、REQ-038、REQ-040、REQ-041 | DES-038、DES-040、DES-041 | resolved: 当前 v2 用例是 StructuredFlow，一条有限范围的结构化录制流程；BusinessGraph 的目标节点测试规格库已冻结为实验能力 |
| Q-029 Android 核心执行是否长期依赖裸 ADB | REQ-035、REQ-038 | DES-005、DES-035、DES-038 | resolved: ADB 是设备管理和 fallback 底座；业务图谱主执行路径升级为 UIAutomator2 / Appium-compatible 语义 driver，裸 `adb shell input` 使用时必须记录 fallback |
| Q-030 业务图谱是否仍作为当前主线 | REQ-036、REQ-037、REQ-038、REQ-041、REQ-042 | DES-036、DES-037、DES-038、DES-041、DES-042 | resolved: 不作为当前主线。当前主线为 PageStateFlow；StructuredFlow 是线性路径快照；BusinessGraph 上层、源码扫描、候选治理、目标节点规划冻结为实验能力，底层 StateMatcher / ActionPolicy / Observation / RuntimeOverlay / 动态等待继续复用 |
| Q-031 当前主要项目目标如何命名和收敛 | REQ-042、REQ-041、REQ-036 | DES-042、DES-041、DES-036 | resolved: 命名为 PageStateFlow，中文为“页面状态资产驱动的移动端智能回放测试平台”；页面资产库成为当前主线，StructuredFlow 是路径快照，BusinessGraph 上层继续 experimental |
| Q-032 资产驱动巡检是否替代自动探索 / 稳定性探索 | REQ-044、REQ-032、REQ-042 | DES-044、DES-030、DES-042 | resolved: 不替代。资产驱动巡检按 active 页面资产验证稳定性和覆盖面；自动探索 / 稳定性探索继续作为未知页面、异常状态和 crash / ANR 发现入口，二者入口、策略和资产写入权限隔离 |
