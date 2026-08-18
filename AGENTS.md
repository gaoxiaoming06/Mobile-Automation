---
name: mobile-automation
repo_id: github.gaoxiaoming06.mobile-automation
description: Mobile visual automation platform with central server, dashboard, Device Agents, ScriptFlow execution, AI-assisted generation, and reports.
default_branch: main
last_verified_commit: b23777d
updated_at: 2026-08-18
---

# AGENTS.md - mobile-automation

This file is the first stop for AI agents and human maintainers. Machine-readable repository metadata is in [`repo-profile.yml`](repo-profile.yml). Keep both files in sync when the repository layout, deployment flow, or quality gates change.

# 1. 仓库定位

## 核心职责
- 提供移动端视觉自动化测试平台：中心 Server、React Dashboard、Device Agent、ScriptFlow v1、AI 辅助生成/修复、执行报告和设备预览。
- Server 负责任务编排、存储、AI 调用、Agent relay、OCR、报告和 Dashboard 静态资源；真实设备能力始终通过 Device Agent 进入。
- ScriptFlow YAML 是可执行用例的来源，报告和运行证据保存在外部 `DATA_DIR`。

## 明确不负责
- 不承载 ClassIn 客户端业务源码。
- 不把运行数据、账号密码、SSH 私钥、pairing code、浏览器 session token 提交进仓库。
- 不让中心 Server 直接操作 USB 设备；设备操作必须通过 Agent。

## 适用场景
- 开发或修复 Dashboard、Server、Agent、ScriptFlow、runner、报告、部署脚本和运维文档。
- 更新正式部署、启动/重启服务、接入设备宿主机、排查 Agent 离线或无设备问题。

# 2. AI 阅读顺序

Agent 进入本仓后按这个顺序建立上下文，不要一上来全仓扫描：

1. 本文件的 §1、§2、§11、§12、§13、§14。
2. [`repo-profile.yml`](repo-profile.yml)，确认模块、入口和质量门禁。
3. 处理部署、更新部署、SSH 主机、端口、Server/Agent 服务时，必须先读 [`docs/guides/deployment.md`](docs/guides/deployment.md)，尤其是 `Port Roles`、`Current Internal Host`、`Production Update Runbook`、`Device Agents`、`Process Management`。
4. 处理产品能力或 ScriptFlow 规则时，读 [`README.md`](README.md)、[`docs/product/mobile-automation-platform/README.md`](docs/product/mobile-automation-platform/README.md)、[`docs/product/mobile-automation-platform/spec/script-flow-v1.md`](docs/product/mobile-automation-platform/spec/script-flow-v1.md)。
5. 处理具体代码时，再按 §4/§5 进入相关模块和入口文件。

# 3. 技术栈与运行方式

- 平台：Web Dashboard、Node Server、Device Agent、CLI、移动设备驱动。
- 语言：TypeScript、JavaScript、Python。
- 构建系统：pnpm workspace。
- 主要框架/工具：React、Vite、Express、SQLite、WebSocket、Vitest、RapidOCR、ADB、scrcpy、HDC、libimobiledevice。
- 开发启动：`pnpm dev`。
- 只启动 Web/Server 开发栈：`pnpm dev:web`。
- 本地 Agent 开发启动：`pnpm agent:dev:https`。
- 正式打包：`pnpm package:offline`。
- 正式服务端口：`4010`。`5173` 只是 Vite 开发端口。

# 4. 关键目录导航

| 路径 | 职责 | 何时修改 | 注意事项 |
| --- | --- | --- | --- |
| `platform/apps/server` | API、存储、AI、Agent relay、ScriptFlow 执行、OCR、报告、Dashboard SPA fallback | Server 行为、部署服务、执行链路、AI 生成/修复、报告和 Agent 协议变化 | 改 Agent 协议时同步 `platform/apps/device-agent` 和测试 |
| `platform/apps/dashboard` | React 工作台、设备管理、用例中心、AI 生成、执行结果、预览和设置页 | UI、交互、前端状态、运行配置、用例编辑体验变化 | 改用户流程时检查相关组件测试 |
| `platform/apps/device-agent` | 设备发现、ADB/HDC/iOS 工具、截图、UI hierarchy、动作、日志、stream、Agent 本地控制 | 设备侧能力、输入/点击、截图、定位、stream、Agent 更新逻辑变化 | 正式部署时 Agent 是独立进程，不在 Server 里 |
| `platform/packages/script-flow` | ScriptFlow v1 parser、validator、compiler、serializer 和类型 | YAML 规则、target 表达、校验、编译计划变化 | 改规则要同步 spec 和 AI 生成约束 |
| `platform/packages/runner-core` | 共享 runner 契约和执行支持 | 执行协议或 runner 共享类型变化 | 影响 Server runner 和测试 |
| `docs/guides` | 开发、部署、运维、ScriptFlow 工具文档 | 流程、命令、端口、服务、运维约定变化 | 部署相关请求先读 `docs/guides/deployment.md` |
| `scripts` | 打包、证书、OCR、工具安装脚本 | release 包、OCR、证书、工具链变化 | 脚本改动后至少跑相关单测或实际命令验证 |

# 5. 关键文件与代码入口

## `platform/apps/server/src/index.ts`

- 主要符号：server bootstrap。
- 功能说明：启动 Express/HTTP(S)/WebSocket 服务，装配 Storage、Agent registry、Agent driver、OCR sidecar、ScriptFlow runner、AI routes、trial learning、reports、dashboard static handlers。
- 常见改动：新增 API、调整服务启动环境变量、Agent route、runner 装配、OCR 或 Dashboard fallback。
- 关联测试：`platform/apps/server/src/*.test.ts`，以及按变更选择具体 API/runner/agent 测试。
- 修改风险：会影响正式服务启动和端口 `4010`，部署前必须跑 `pnpm build` 或相关单测。

## `platform/apps/dashboard/src/App.tsx`

- 主要符号：dashboard app shell。
- 功能说明：工作台主页面和主要面板装配入口。
- 常见改动：导航、面板展示、设备/用例/报告相关入口变化。
- 关联测试：`platform/apps/dashboard/src/App.test.ts` 和组件级测试。

## `platform/apps/device-agent/src/index.ts`

- 主要符号：device agent bootstrap。
- 功能说明：启动 Device Agent runtime、本地控制服务和 Agent relaunch/update 支持。
- 常见改动：Agent 启动参数、控制端口、环境变量、Agent 更新逻辑。
- 修改风险：会影响所有设备宿主机，正式更新时通常需要重启或更新 Agent。

## `platform/packages/script-flow/src/index.ts`

- 主要符号：ScriptFlow public API。
- 功能说明：导出 parser、validator、compiler、serializer 和 ScriptFlow 类型。
- 常见改动：新增 YAML 能力、target 类型、校验规则或编译输出。
- 修改风险：可能让历史用例不兼容，必须同步 `docs/product/mobile-automation-platform/spec/script-flow-v1.md`。

## `scripts/package-offline-release.mjs`

- 主要符号：offline release packager。
- 功能说明：构建 Agent、Server、Dashboard，并把运行所需产物打成 `dist/mobile-automation-release.tgz`。
- 常见改动：release 包结构、构建命令、OCR/Agent 产物复制、跨平台 pnpm 调用。
- 关联测试：`platform/apps/server/src/offline-release.test.ts`。

## `docs/guides/deployment.md`

- 主要符号：production deployment runbook。
- 功能说明：正式部署和更新部署的唯一运维入口，包含端口、当前内部主机、目录、systemd 服务、Server/Agent 更新、回滚。
- 常见改动：部署机变化、端口变化、服务名变化、Agent 管理方式变化。

# 6. 主要流程

## 开发运行

1. `pnpm dev` 先构建 Agent bundle 和本地 HTTPS 证书。
2. Server、Dashboard、共享本地 Agent 并行启动。
3. Dashboard 从 Server 读取设备，Server 通过 Agent command channel 调设备侧能力。

## 正式部署与更新

1. 在 `/root/automation/mobile-automation` 拉取 `master` 并执行 `pnpm package:offline`。
2. 把 release 包安装到版本目录，更新 `/opt/mobile-automation-release`，重启 `mobile-automation.service`。
3. 如服务所在机器也接 USB 设备，重启或更新 `mobile-automation-agent.service`。

这个流程的 source of truth 是 [`docs/guides/deployment.md`](docs/guides/deployment.md)。部署任务不要仅凭聊天记录执行。

## ScriptFlow 生成与执行

1. Dashboard 或 API 提交自然语言/ScriptFlow YAML。
2. Server 解析、校验、编译为执行计划。
3. Runner 通过 Agent driver 执行截图、定位、点击、输入、断言和报告采集。

# 7. 依赖与集成点

## 上游依赖
- 本仓无已登记的内部上游 repo 依赖。

## 下游使用方
- 本仓无已登记的内部下游 repo 依赖。

## 外部库和工具
- Node.js/pnpm：构建和运行。
- React/Vite：Dashboard。
- Express/ws：Server API 和 WebSocket。
- Vitest：单元测试。
- RapidOCR：本地 OCR sidecar。
- ADB/scrcpy：Android 设备能力和实时预览。
- HDC：HarmonyOS 设备能力。
- libimobiledevice/WDA：iOS 设备能力和控制。

# 8. docs/ 与 SDD Spec 维护约定

- 产品主文档：`docs/product/mobile-automation-platform/README.md`。
- ScriptFlow 契约：`docs/product/mobile-automation-platform/spec/script-flow-v1.md`。
- 运维部署文档：`docs/guides/deployment.md`。
- 设计/计划沉淀：`docs/superpowers/plans` 和 `docs/superpowers/specs`。
- 改功能行为时，同步相关 README/spec/guide；改部署流程时同步 `docs/guides/deployment.md` 和本文件的部署路由。

# 9. 需求模糊时的追问规则

- 部署任务里缺少目标机器、分支、服务名、端口、是否更新 Agent、是否可中断当前执行时，先追问或从 `docs/guides/deployment.md` 查证。
- 涉及删除数据、重置数据库、覆盖 `/var/lib/mobile-automation`、改 SSH 凭据、暴露服务到公网时，必须先确认。
- 涉及 ScriptFlow 兼容性、历史用例迁移、Agent 协议变更时，确认是否需要兼容旧用例/旧 Agent。
- 一次只问关键 1-3 个问题；能从仓库文档或代码确认的不要问。

# 10. 代码修改原则

- 优先沿用现有模块边界和测试风格。
- Server、Dashboard、Agent、ScriptFlow 的协议字段变化要同步两端和测试。
- 正式部署能力改动要同步 `docs/guides/deployment.md`。
- 不把运行数据写进仓库，`DATA_DIR` 应指向外部目录。
- 不把账号、密码、私钥、pairing code、session token 写入文档或代码。

# 11. 变更边界与高风险区域

## 可以安全修改
- 文档说明、README、测试 fixture、独立组件样式和小范围 UI 文案。

## 需要 owner 确认
- ScriptFlow v1 schema、历史用例兼容、Agent 协议、正式部署目录/端口/服务名、安全凭据策略。

## 高风险改动
- 删除或迁移 `/var/lib/mobile-automation`。
- 修改 `scripts/package-offline-release.mjs`、OCR setup、HTTPS 证书生成、systemd 运行方式。
- 修改 text input、locator、screenshot、UI hierarchy、stream 等设备侧执行能力。

# 12. 常见任务路由

| 任务类型 | 入口/起点 | 需同步检查 |
| --- | --- | --- |
| 更新正式部署 | `docs/guides/deployment.md` | `mobile-automation.service`、`mobile-automation-agent.service`、`/var/lib/mobile-automation` 不可删 |
| 排查无设备 | `docs/guides/deployment.md`、`platform/apps/device-agent/README.md` | Agent 是否注册、`/api/agents`、USB/ADB/HDC/iOS 工具状态 |
| 改 AI 生成 ScriptFlow | `platform/apps/server/src/script-flow-ai-planner.ts` | ScriptFlow spec、生成测试、Dashboard 展示 |
| 改 ScriptFlow schema/target | `platform/packages/script-flow` | `docs/product/mobile-automation-platform/spec/script-flow-v1.md`、Server runner、历史用例 |
| 改 Dashboard 面板 | `platform/apps/dashboard/src/components` | 组件测试、API 类型、样式回归 |
| 改 release 打包 | `scripts/package-offline-release.mjs` | `pnpm package:offline`、`docs/guides/deployment.md` |

# 13. 验证要求

- 常规构建：`pnpm build`。
- 单元测试：`pnpm test:unit`。
- 类型检查/静态检查：`pnpm lint`。
- 正式包验证：`pnpm package:offline`。
- 只改文档时至少运行 `git diff --check`。
- 改 `docs/guides/deployment.md` 后检查部署命令是否仍符合当前端口、目录、服务名。

# 14. 安全与敏感信息规则

- 不提交密码、SSH 私钥、API token、pairing code、浏览器 session token。
- 仓库文档可以记录非敏感连接元数据，如域名、端口、服务名、目录，但认证凭据必须放公司密码管理器或本机安全存储。
- 不删除、不覆盖、不迁移 `/var/lib/mobile-automation`，除非用户明确要求并确认备份/回滚方案。
- `~/.ssh/config` 只能作为本机便利配置示例，不要提交个人真实私钥路径或密码。

# 15. 提交前检查清单

- [ ] 改动范围聚焦当前任务。
- [ ] 已按 §13 运行对应验证，或在回复中说明为何未运行。
- [ ] 部署/运维变化已同步 `docs/guides/deployment.md`。
- [ ] ScriptFlow 行为变化已同步 spec 和相关测试。
- [ ] Server/Agent 协议变化已同时检查两侧。
- [ ] 未提交敏感凭据或运行数据。
- [ ] 提交信息说明变更目的、影响范围和验证结果。

# 16. 待确认项

- `business_line`、`products`、`domain_tags` 当前按内部测试仓库推断为 `common` / `classin` / `infra, ui, monitor, compat`；如后续有正式归属，需要同步更新 `repo-profile.yml`。
