# AI Skills

This directory stores reusable AI instructions related to Mobile Automation.

## mobile-automation-test

`mobile-automation-test` teaches an AI client how to use the Mobile Automation MCP tools safely: read the ScriptFlow authoring contract, validate devices, generate or repair drafts, run trial/normal executions, wait for runs, and return report evidence.

Skill files:

```text
docs/skills/mobile-automation-test/
  SKILL.md
  agents/openai.yaml
```

Clients that support skills or reusable instructions can import this directory. Clients that only support MCP can ignore this directory and use the MCP server config in [ScriptFlow REST / CLI / MCP](../guides/script-flow-tools.md).
