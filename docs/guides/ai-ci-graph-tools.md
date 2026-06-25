---
title: AI / CI 图谱目标节点验证调用指南
doc_type: guide
status: draft
updated_at: 2026-06-12
---

# AI / CI 图谱目标节点验证调用指南

本平台的权威入口是 REST API。CLI 和 MCP 只做适配层，不允许绕过设备锁、执行队列、视频录制、截图、性能采样、失败证据和 HTML 报告。

## REST

触发目标节点执行：

```bash
curl -X POST "$AUTOTEST_SERVER_URL/api/graph-runs" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceSerial": "android-serial",
    "graphId": "graph-classin-teacher",
    "target": { "key": "classin.teacher.lesson.create" },
    "startStrategy": "keep_current",
    "overlay": {
      "id": "ai-change-123",
      "targetNodeId": "node-create-lesson",
      "nodeExpectationOverrides": [
        {
          "nodeId": "node-create-lesson",
          "expectations": [
            {
              "id": "expect-new-title",
              "type": "text",
              "enabled": true,
              "params": { "expected": "新建课堂", "mode": "contains" },
              "createdAt": "2026-06-12T00:00:00.000Z"
            }
          ]
        }
      ]
    }
  }'
```

查询结果：

```bash
curl "$AUTOTEST_SERVER_URL/api/graph-runs/run_xxx"
```

优先读取响应中的 `nodeTestResult`：

- `status`：`running` / `passed` / `failed` / `stopped` 等。
- `targetNodeId` / `targetNodeName`：本次目标。
- `route[]`：每条业务边的执行状态。
- `failedAt`：失败阶段、节点、边、错误码和阻断预期。
- `reportUrl`：HTML 报告。
- `evidence`：截图、视频、日志和失败证据 URL。
- `actual`：步骤数、失败数、最新节点、失败预期数量。

## CLI

```bash
pnpm cli -- graph-run \
  --server "$AUTOTEST_SERVER_URL" \
  --device android-serial \
  --graph graph-classin-teacher \
  --targetKey classin.teacher.lesson.create \
  --overlay ./overlay.json

pnpm cli -- graph-status --server "$AUTOTEST_SERVER_URL" --run run_xxx
pnpm cli -- graph-report --server "$AUTOTEST_SERVER_URL" --run run_xxx
pnpm cli -- graph-quality --server "$AUTOTEST_SERVER_URL" --graphVersion graph_version_xxx
```

## MCP Adapter

`@mobile-automation/mcp-adapter` 暴露 REST-only handler 和 MCP tool definitions：

```ts
import {
  createMobileAutomationMcpToolHandlers,
  mobileAutomationMcpTools
} from "@mobile-automation/mcp-adapter";

const handlers = createMobileAutomationMcpToolHandlers({
  serverUrl: process.env.AUTOTEST_SERVER_URL
});

await handlers.trigger_node_test({
  deviceSerial: "android-serial",
  graphId: "graph-classin-teacher",
  target: { key: "classin.teacher.lesson.create" }
});
```

当前 wrapper 只负责工具定义和 handler 映射。接入具体 MCP SDK 时，只需要把 `mobileAutomationMcpTools` 注册为工具，把同名 handler 作为执行函数。

## 安全规则

- MCP tool schema 不包含 token、secret、password、credential、apiKey 等字段。
- 平台地址、鉴权信息和后续 CI token 必须通过环境变量或部署 Secret 注入。
- AI / CI 调用只能访问 REST API 或 CLI / MCP adapter，不能直连数据库、driver 或 artifact 目录。
- RuntimeOverlay 如果声明 `targetNodeId`，必须与本次目标节点一致；否则服务端会在创建 run 前拒绝。
