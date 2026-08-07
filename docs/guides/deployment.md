---
title: Deployment Guide
doc_type: guide
status: draft
created_at: 2026-06-05
updated_at: 2026-08-07
---

# Deployment Guide

This project is currently optimized for local or intranet QA deployment with a central server plus one or more Device Agents. The server hosts the dashboard, APIs, storage, AI orchestration, and reports. Each Agent runs on a machine with physical device access and provides Android, iOS, and HarmonyOS device commands.

## Option A: Single QA Workstation

Use this when the server, dashboard, and devices are on the same Mac/Linux workstation. Run the server/dashboard and the Agent as separate processes:

```bash
pnpm install
pnpm check:tools
pnpm build
DATA_DIR=/Users/Shared/mobile-automation-data PORT=4010 pnpm --filter @mobile-automation/server start
```

```bash
DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010 \
DEVICE_AGENT_ID=qa-workstation-1 \
DEVICE_AGENT_SHARED=1 \
pnpm agent
```

Use the dev shape during active development:

```bash
# Terminal 1
pnpm dev

# Terminal 2
DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010 DEVICE_AGENT_SHARED=1 pnpm agent
```

Use the HTTPS dev shape when another computer opens the dashboard over the LAN. Browser Android realtime preview depends on WebCodecs, and many browsers only expose WebCodecs in a secure context. Plain `http://<lan-ip>:5173` can therefore fall back to screenshot preview even when the Agent and Android device support realtime streaming.

```bash
# Terminal 1: HTTPS dashboard + HTTPS API
pnpm dev:https

# Terminal 2: local Agent over HTTPS
pnpm agent:https
```

Open the dashboard from another LAN machine at `https://<server-lan-ip>:5173/`, for example `https://10.254.32.11:5173/`. The first visit may require accepting the local self-signed certificate. When starting the Agent manually instead of using `pnpm agent:https`, set `DEVICE_AGENT_SERVER_URL=https://127.0.0.1:4010`. HarmonyOS dashboard preview currently uses screenshots; set `HARMONY_STREAM_ENABLED=1` only when explicitly testing the experimental HarmonyOS stream bridge.

Recommended runtime data locations:

- macOS single user: `~/.local/share/mobile-automation`
- macOS shared QA machine: `/Users/Shared/mobile-automation-data`
- Linux server: `/var/lib/mobile-automation`
- NAS-backed team storage: a mounted directory passed through `DATA_DIR`

The runtime data directory contains SQLite DB files, screenshots, videos, logs, HTML reports, and temporary artifacts. Do not place it in the repository for normal use.

## Option B: Central Server + Device Agents

Use this when the dashboard and storage should run on an intranet server while devices remain attached to QA laptops or lab hosts.

Central server:

```bash
pnpm build
DATA_DIR=/var/lib/mobile-automation PORT=4010 pnpm --filter @mobile-automation/server start
```

On each device host:

```bash
DEVICE_AGENT_SERVER_URL=http://mobile-automation.local \
DEVICE_AGENT_ID=lab-mac-01 \
DEVICE_AGENT_SHARED=1 \
DEVICE_AGENT_MAX_CONCURRENT_RUNS=3 \
pnpm agent
```

Private local devices should omit `DEVICE_AGENT_SHARED=1`. Generate a short-lived code from the dashboard `配对 Agent` button, then start the packaged Agent with:

```bash
NODE_BIN=/opt/homebrew/bin/node ./start-private-agent.sh --agent-id agent-package-local --pairing-code <code>
```

## Process Management

For a simple intranet setup, run the server with a process manager and serve the dashboard through the server's SPA fallback after building the dashboard.

Minimal PM2 example:

```bash
pnpm build
DATA_DIR=/var/lib/mobile-automation PORT=4010 pm2 start "pnpm --filter @mobile-automation/server start" --name mobile-automation
pm2 save
```

Minimal systemd shape:

```ini
[Unit]
Description=Mobile Automation Server
After=network.target

[Service]
WorkingDirectory=/opt/mobile-automation
Environment=PORT=4010
Environment=DATA_DIR=/var/lib/mobile-automation
ExecStart=/usr/local/bin/pnpm --filter @mobile-automation/server start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

## Reverse Proxy

Expose the server behind an intranet reverse proxy when the dashboard is shared by a QA team.

```nginx
server {
  listen 80;
  server_name mobile-automation.local;

  location / {
    proxy_pass http://127.0.0.1:4010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## Environment

Start from `.env.example` and only override what is needed:

- `DATA_DIR`: external runtime data root.
- `PORT`: server port.
- `SCRCPY_SERVER_PATH`: optional custom scrcpy-server v3.3.3 file. The default pinned server file is committed at `platform/tools/scrcpy-server-v3.3.3`.
- `DEVICE_AGENT_SERVER_URL`: server URL used by `pnpm agent`.
- `DEVICE_AGENT_ID`: stable Agent id. Defaults to host-based local identity when unset.
- `DEVICE_AGENT_SHARED`: set to `1` to publish Agent devices to the public pool.
- `DEVICE_AGENT_PAIRING_CODE`: short-lived code for private local-session devices.
- `DEVICE_AGENT_MAX_CONCURRENT_RUNS`: Agent-side concurrency limit.
- `HARMONY_STREAM_ENABLED`: opt-in switch for the experimental HarmonyOS companion stream bridge. The dashboard currently uses screenshot preview for HarmonyOS by default.
- `HTTPS`: set to `1` for the local HTTPS dev server/dashboard path.
- `HTTPS_KEY` and `HTTPS_CERT`: optional certificate paths used by `pnpm dev:https`; the helper script creates `.cert/mobile-automation-lan-key.pem` and `.cert/mobile-automation-lan-cert.pem` by default.
- `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`: optional iOS control endpoint on the Agent host.
- `ARTIFACT_RETENTION_ENABLED`: keep disabled unless the team has agreed on report retention.
- `VITE_DASHBOARD_ADVANCED_TOOLS`: optional dashboard switch for local asset calibration and page asset governance tools. This is an operator/debug convenience, not an authentication or permission boundary.

The host `scrcpy` CLI is optional on Agent hosts. Install it only when you need the native debug window or recording fallback; browser-embedded Android preview/control uses the pinned server file above.

## Dashboard Advanced Tools

The dashboard hides asset governance tools by default. Normal users should create, run, and review ScriptFlow tests without seeing page asset calibration screens.

Advanced tools expose:

- `资产校准`: manually confirm or correct page identity evidence.
- `页面资产库`: inspect saved page assets and explicitly deactivate broken assets.

Enable advanced tools for a local browser session from Chrome DevTools Console:

```js
localStorage.setItem("mobile-automation.advancedTools", "true");
location.reload();
```

Disable the local override:

```js
localStorage.removeItem("mobile-automation.advancedTools");
location.reload();
```

Operators can also enable the tools for a dev/build session with:

```bash
VITE_DASHBOARD_ADVANCED_TOOLS=true pnpm dev
```

The `localStorage` value overrides `VITE_DASHBOARD_ADVANCED_TOOLS` in that browser. This switch only changes local dashboard visibility; it is not an authentication, authorization, or audit boundary.

## Current Limits

- No authentication or multi-user permission model in MVP.
- No Docker image yet; Agent device connectivity is easier and more predictable on host workstations.
- No production CI/CD pipeline yet.
- Browser-embedded Android realtime preview depends on WebCodecs support; LAN browser access should use HTTPS so the page is a secure context. HarmonyOS dashboard preview currently uses screenshot polling.
