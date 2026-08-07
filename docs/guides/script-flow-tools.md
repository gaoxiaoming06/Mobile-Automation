---
title: ScriptFlow REST / CLI / MCP 使用指南
---

# ScriptFlow 工具

## REST

- `GET /api/page-assets`：列出页面资产库。
- `GET /api/script-flows`：列出 ScriptFlow。
- `POST /api/script-flows`：保存 ScriptFlow。
- `POST /api/script-flow-drafts/generate`：根据自然语言生成草稿。
- `POST /api/script-flows/validate`：校验导入或生成的 ScriptFlow YAML。
- `POST /api/script-flow-drafts/preview`：预览草稿并生成 `planDigest`。
- `POST /api/script-flow-drafts/trial-runs`：试运行未保存草稿。
- `POST /api/script-flows/:id/runs`：执行已保存用例。
- `GET /api/runs/:id`：查询 Run。
- `GET /api/script-flow-runs/:id`：查询 ScriptFlow Run 的结构化失败信息。
- `GET /api/reports/:id/html`：打开 HTML 报告。

## CLI

```bash
pnpm cli -- flows
pnpm cli -- preview-flow --flow flow_xxx --version 1 --params '{"className":"班级四十二号"}'
pnpm cli -- run-flow --flow flow_xxx --version 1 --plan PLAN_DIGEST --device SERIAL --params '{"className":"班级四十二号"}'
pnpm cli -- runs
pnpm cli -- report --run run_xxx
```

## MCP

MCP server 通过 `@mobile-automation/mcp-adapter` 暴露，只调用平台 REST API，不直接访问数据库或设备驱动。

### MCP Server 配置信息

前置条件：

1. 已在仓库根目录执行 `pnpm install`。
2. Mobile Automation REST server 正在运行，默认 `http://127.0.0.1:4010`。
3. 真机执行时，至少一个 Device Agent 已连接到同一个 REST server。

Server 信息：

- name: `mobile-automation`
- transport: `stdio`
- command: `pnpm`
- args: `--dir /Users/eeo/StudioProjects/Mobile-Automation --filter @mobile-automation/mcp-adapter start`
- env: `MOBILE_AUTOMATION_SERVER_URL=http://127.0.0.1:4010`

```json
{
  "mcpServers": {
    "mobile-automation": {
      "command": "pnpm",
      "args": ["--dir", "/Users/eeo/StudioProjects/Mobile-Automation", "--filter", "@mobile-automation/mcp-adapter", "start"],
      "env": {
        "MOBILE_AUTOMATION_SERVER_URL": "http://127.0.0.1:4010"
      }
    }
  }
}
```

MCP adapter 通过 stdio 启动，只依赖 REST API；如果 REST server 未启动，工具会存在但调用会失败。不同 AI 客户端的导入方式不同，按各自客户端要求填入上面的 server 信息即可。

配套工作流说明在 `docs/skills/mobile-automation-test/SKILL.md`，用于告诉 AI 如何安全使用这些 MCP tools。需要导入 skill 的客户端可以直接引用该目录；不支持 skill 的客户端也可以只接入 MCP tools。

平台字段分两类：

- `scriptPlatform`：脚本和页面资产范围，可选 `android | ios | harmony | flutter | mobile`。
- `devicePlatform`：真实执行设备平台，只能是 `android | ios | harmony`。

主要工具：

- `get_script_flow_authoring_contract`：读取 ScriptFlow v1 编写规则。
- `list_devices` / `validate_device`：列出设备并在执行前做平台、在线状态和能力校验。
- `list_apps` / `list_page_assets` / `get_page_asset`：读取已录入页面资产。
- `list_script_flows` / `get_script_flow`：读取可复用用例。
- `generate_script_flow_draft`：根据 `goal/prompt + appId + scriptPlatform + externalContext` 生成草稿。
- `validate_script_flow`：校验 YAML 是否符合 ScriptFlow v1。
- `preview_script_flow_draft` / `preview_script_flow`：冻结执行计划并返回 `planDigest`。
- `run_script_flow_draft` / `run_script_flow`：经过设备预检后执行草稿或已保存用例。
- `wait_for_run` / `get_run` / `get_run_report` / `get_report`：轮询执行结果和报告。`get_run_report` 支持 `responseMode`。
- `generate_and_run_script_flow`：一站式执行 `validate device -> generate -> preview -> trial run -> wait -> report`，支持 `responseMode`。
- `generate_repair_and_run_script_flow`：一站式生成、试运行、基于失败证据修复并重跑，适合定位失败、页面不匹配或结果验证失败；不要用于崩溃、ANR 或设备基础设施故障。
- `run_previous_script_flow`：复用某次 ScriptFlow run 中保存的 `sourceYaml`，重新 preview 后在另一台设备上执行，不重新生成脚本。
- `review_trial_outcome`：调用方明确确认或拒绝试运行结果后再调用。

`responseMode` 用来控制 MCP 返回体大小：

- `compact`：只返回终态、失败步骤、报告 URL 和最终截图 URL，适合“到没到目标页”、批量重试、token 敏感链路。
- `evidence`：默认模式，返回关键截图/日志 URL、失败摘要和异常事件，适合普通验证结果上报。
- `full`：返回完整 artifact URL、事件和失败证据，适合失败、崩溃、ANR、进程死亡、定位歧义等排查场景。

推荐外部 AI 链路：

1. 读取 `get_script_flow_authoring_contract`。
2. 从代码、本地目录或 classin-code MCP 总结 `externalContext`，不要直接输出平台私有 selector。
3. 调用 `generate_script_flow_draft`，需要当前屏幕辅助时传 `screenAssist`。
4. 调用 `preview_script_flow_draft` 获取 `planDigest`。
5. 调用 `validate_device` 或直接在 `run_script_flow_draft` 中触发设备预检。
6. 调用 `wait_for_run` 和 `get_run_report` 获取最终状态、截图、异常事件和 HTML 报告。普通验证使用 `responseMode: "evidence"`；只需要结果图使用 `compact`；需要完整排查信息使用 `full`。

跨设备复用同一脚本时：

1. 第一次使用 `generate_and_run_script_flow` 或 staged workflow 生成并执行脚本，记录返回的 `runId`。
2. 第二台设备不要再次调用生成工具。
3. 调用 `run_previous_script_flow`：
   - `sourceRunId`：第一次执行的 `runId`
   - `devicePlatform` / `deviceSerial`：目标设备
   - `responseMode`：按需选择 `compact | evidence | full`
4. 工具会读取 `sourceRunId` 的 `sourceSnapshot.sourceYaml`，重新 `preview` 生成当前参数下的 `planDigest`，校验目标设备，执行并返回报告。
