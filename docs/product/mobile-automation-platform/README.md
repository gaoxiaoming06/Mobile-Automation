---
title: 自动化测试平台
doc_type: README
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-06-04
updated_at: 2026-07-17
related_repos: ["Mobile-Automation"]
related_modules: []
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# 自动化测试平台

## 摘要

建设一个新的自动化测试平台，通过可视化 Web 面板统一管理 Android / iOS 设备、被测应用包、页面状态资产、结构化测试流程、执行任务和测试报告。当前主要项目目标正式命名为 `PageStateFlow`：页面状态资产驱动的移动端智能回放测试平台。

PageStateFlow 的核心资产是页面状态库：每个稳定全屏页面保存识别规则、截图锚点、可操作元素、动作能力和动作后的页面转移。右上角更多菜单、底部 sheet、选择器、临时弹窗和局部黑条这类页面内状态不再单独入库为页面；它们归属到父页面的 PageElement、PageAbility 或 PageTransition 中间步骤。当前主执行链路不再依赖线性录制脚本，而是基于已确认资产编译执行计划；资产录入只负责沉淀和修正 PageModel、PageElement、PageTransition、PageTask。

ClassIn 首页底部 Tab（主页、消息、待办、课程表、空间 / 控件、成长）按“首页 Tab 根页面组”处理：它们都是 App 内安全起点，恢复策略不会继续对这些页面执行 back；路径规划会在运行期自动生成 Tab 之间的互通边，不要求人工录入 6×5 条连接边。业务页面仍然通过各 Tab 页面上的 PageAbility / PageTransition 继续向下连接，例如从消息页到加入班级页会先自动切回主页，再执行主页的“更多菜单 -> 加入班级”复合转移。

业务图谱、源码扫描、目标节点路径规划和候选图谱治理不再作为当前默认产品主线，只作为实验能力和未来扩展入口保留。它们沉淀出的 StateMatcher、ActionPolicy、RuntimeOverlay、Observation、动态等待和 Runtime Interceptor 等底层能力继续复用于 PageStateFlow。后续平台还需要支持新包冒烟、指定包回归、指定页面 / 指定流程验证、性能基线对比、自动触发和结果通知。

## 当前状态

| 项目 | 状态 |
|---|---|
| Spec 状态 | draft |
| 实现状态 | MVP in progress |
| 整体平台范围 | Android + iOS + Web Dashboard |
| MVP 范围 | Android 闭环：设备管理、浏览器内 scrcpy 预览操控、页面资产录入、资产驱动执行、性能/异常采集、HTML 报告 |
| 当前主线 | PageStateFlow、页面状态资产库、页面元素、页面转移、页面任务、语义动作、动态等待、资产组合和报告 |
| 实验能力 | BusinessGraph、源码扫描、目标节点路径规划、Graph Runner、候选图谱治理 |
| 迁移策略 | legacy 坐标脚本和旧线性录制 UI 不再作为 Dashboard 主入口；新功能默认进入资产驱动链路，图谱上层冻结为实验入口 |
| iOS 范围 | 基础接入：设备发现、截图预览、电量采样；配置 WebDriverAgent 后支持点击、长按、滑动、Home、输入、启动/关闭 App |
| 权限范围 | 第一版不做登录、角色、审计 |
| 目标仓库 | Mobile-Automation |
| 目标版本 | MVP |

## Spec 文件

| 文档 | 说明 |
|---|---|
| [product-plan.md](spec/product-plan.md) | 产品级路线图：包管理、新包冒烟、性能基线、流程验证、触发通知 |
| [requirements.md](spec/requirements.md) | 产品需求、使用场景、非功能需求、开放问题 |
| [asset-driven-testing-requirements.md](spec/asset-driven-testing-requirements.md) | 资产驱动测试产品形态：资产录入、参数集、巡检、元功能、组合用例、AI/MCP |
| [free-composition-requirements.md](spec/free-composition-requirements.md) | 自由组合：用自然语言受约束地编排资产测试、参数、循环、风险确认和 AI 修复 |
| [design.md](spec/design.md) | 技术设计、模块边界、数据模型、关键流程、风险 |
| [tasks.md](spec/tasks.md) | 可执行开发任务拆分 |
| [acceptance.md](spec/acceptance.md) | 验收标准与验证方法 |
| [traceability.md](spec/traceability.md) | 需求、设计、任务、验收追踪矩阵 |
| [changelog.md](spec/changelog.md) | Spec 变更记录 |

## 核心能力地图

1. 设备管理：发现、展示、选择、连接状态、基础信息、可用能力。
2. 实时预览：显示当前设备画面，支持横竖屏、缩放、断连恢复。
3. 远程操控：在预览区域完成点击、长按、滑动、返回、输入等操作。
4. 资产录入：把当前页面、可操作元素、页面转移和页面任务沉淀为可复用资产。
5. 资产组合：基于页面任务、元功能、参数集和目标页面组合测试计划。
6. 资产驱动执行：支持单次执行、批量/巡检、失败策略、暂停恢复。
7. 性能采集：CPU、内存、网络、FPS、温度、电量等指标按时间线记录。
8. 异常捕获：崩溃、ANR、系统日志、应用日志、设备断连、执行失败。
9. 测试报告：生成执行摘要、步骤明细、性能曲线、异常证据、附件。
10. 包管理与冒烟：登记 APK / IPA，安装到指定设备，对新包发起冒烟和回归。
11. 性能基线：记录每个包的关键性能指标，并与上一个包或指定基线对比。
12. 自动触发与通知：支持人工、定时、CI / 包服务触发，并通知测试结果。
13. 外部工具与 AI 导航：预留 CI / CLI / MCP / Agent 工具接口，并维护 `.ai/` 仓库导航。
14. PageStateFlow 主线：维护页面状态资产库、页面识别、页面元素、页面转移和执行到目标页面。
15. StructuredFlow 路径快照：作为历史兼容和外部调用能力保留，不再作为 Dashboard 主流程。
16. 业务图谱实验能力：保留 BusinessNode、OperationEdge、StateMatcher、ActionPolicy、RoutePlan 和 Graph Runner 作为高阶能力，不作为默认主流程。
17. 兼容迁移：保留 legacy 坐标脚本和报告；新功能默认面向 PageStateFlow，不为了旧坐标脚本或全局图谱上层做结构性妥协。

## AI 推荐阅读顺序

1. 先读 [AI / New Contributor Handoff](ai-handoff.md)，确认当前主入口、legacy 入口和执行链路验收规则。
2. 再读 [product-plan.md](spec/product-plan.md)，理解平台当前主线：从裸坐标录制回放升级为 PageStateFlow 页面状态资产驱动平台。
3. 再读 [requirements.md](spec/requirements.md)，理解产品范围和开放问题。
4. 再读 [design.md](spec/design.md)，理解建议架构、接口和关键流程。
5. 开始实现前读 [tasks.md](spec/tasks.md)，按阶段推进。
6. 每完成一组任务，对照 [acceptance.md](spec/acceptance.md) 验证。
7. 变更需求或设计时同步更新 [traceability.md](spec/traceability.md) 和 [changelog.md](spec/changelog.md)。

## 已知代码入口

| 模块 | 路径 | 说明 |
|---|---|---|
| Web Dashboard | `platform/apps/dashboard` | 可视化面板 |
| Backend API | `platform/apps/server` | 设备、用例、执行、报告 API |
| Android Driver | `platform/packages/android-driver` | Android 设备发现、预览、控制、采集 |
| iOS Driver | `platform/packages/ios-driver` | iOS 设备发现、截图预览、WDA 控制 |
| Test Runner | `platform/packages/runner-core` + `platform/apps/server/src/automation-runner.ts` + `platform/apps/server/src/structured-flow-runner.ts` | legacy 用例和 StructuredFlow 执行状态管理 |
| Report Service | `platform/packages/report-core` | 报告生成与附件管理 |
| Test Support | `platform/packages/test-support` | 单元测试、集成测试、Driver mock、回归质量门禁 |

## 开放问题入口

完整开放问题见 [requirements.md](spec/requirements.md#开放问题)。优先需要确认：

1. 性能数据的采样指标和采样频率要求。
2. 失败报告、截图、日志、视频和包文件的保留周期。
3. 冒烟默认覆盖哪些 smoke 标签用例集合。
4. 随机探索能力进入开发的具体排期。

已确认决策：

1. 首版保留坐标型回放；断言优先做 OCR 文本和截图区域对比，控件定位后续评估。
2. Android APK 安装、卸载、版本校验优先；iOS IPA 后续接入。
3. 包来源 MVP 优先支持 SMB 和手动上传，CI/CD 通过 `POST /api/builds` 接入。
4. 自然语言期望结果默认不使用大模型，采用规则模板解析并由用户确认。
5. 版本性能对比当前阶段只并排展示，人工判断，不自动阻断流程。
