---
title: ScriptFlow REST / CLI / MCP 使用指南
---

# ScriptFlow 工具

## REST

- `GET /api/page-assets`：列出页面资产库。
- `GET /api/script-flows`：列出 ScriptFlow。
- `POST /api/script-flows`：保存 ScriptFlow。
- `POST /api/script-flow-drafts/generate`：根据自然语言生成草稿。
- `POST /api/script-flows/:id/runs`：执行已保存用例。
- `GET /api/runs/:id`：查询 Run。
- `GET /api/reports/:id/html`：打开 HTML 报告。

## CLI

```bash
pnpm cli -- flows
pnpm cli -- run-flow --flow flow_xxx --device SERIAL --params '{"className":"班级四十二号"}'
pnpm cli -- runs
pnpm cli -- report --run run_xxx
```

## MCP

MCP 暴露 `list_page_assets`、`list_script_flows`、`generate_script_flow`、`run_script_flow`、`get_run` 和 `get_report`。工具只调用平台 REST API，不直接访问数据库或设备驱动。
