# MCP Adapter

REST-backed Model Context Protocol adapter for Mobile Automation.

The adapter exposes tools for external AI agents to list devices/assets/flows, generate and repair ScriptFlow drafts, validate and preview YAML, run drafts or saved flows, wait for completion, fetch reports, reuse a previous run's exact YAML on another device, and record explicit trial-outcome review.

It calls the Mobile Automation REST server and does not access SQLite, artifacts, or device drivers directly. Configure the server URL with `MOBILE_AUTOMATION_SERVER_URL`; the default is `http://127.0.0.1:4010`.

## MCP Server Config

Start the platform first, then point any MCP-compatible client at this stdio server:

```bash
# Terminal 1
pnpm dev

# Terminal 2
pnpm agent:dev:https
```

Config values:

- name: `mobile-automation`
- transport: `stdio`
- command: `pnpm`
- args: `--dir /Users/eeo/StudioProjects/Mobile-Automation --filter @mobile-automation/mcp-adapter start`
- env: `MOBILE_AUTOMATION_SERVER_URL=https://127.0.0.1:4010`
- env: `NODE_TLS_REJECT_UNAUTHORIZED=0`

The paired workflow prompt lives at `docs/skills/mobile-automation-test/SKILL.md` for clients that support importing skills or reusable instructions.
