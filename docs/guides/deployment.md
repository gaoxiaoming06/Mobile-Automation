---
title: Deployment Guide
doc_type: guide
status: draft
created_at: 2026-06-05
updated_at: 2026-08-11
---

# Deployment Guide

This project is currently optimized for local or intranet QA deployment with a central server plus one or more Device Agents. The server hosts the dashboard, APIs, storage, AI orchestration, and reports. Each Agent runs on a machine with physical device access and provides Android, iOS, and HarmonyOS device commands.

## Service Topology

Device discovery always goes through Device Agents. A healthy server/dashboard with no registered Agent will show `0` devices.

| Process | Development command | Team/production command | Runs on | Purpose |
| --- | --- | --- | --- | --- |
| Dashboard dev server | `pnpm --filter @mobile-automation/dashboard dev` | Not used after `pnpm build` | Developer workstation | Vite HMR during development |
| Central server | `pnpm --filter @mobile-automation/server dev` | `PORT=4010 DATA_DIR=/var/lib/mobile-automation pnpm --filter @mobile-automation/server start` | Workstation or intranet server | API, storage, AI orchestration, reports, and built dashboard SPA fallback |
| Device Agent | `DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010 DEVICE_AGENT_SHARED=1 pnpm agent` | Same command, with the intranet server URL | Every host with USB devices | Android, iOS, and HarmonyOS discovery and commands |
| RapidOCR sidecar | Auto-started by server unless disabled | Auto-started by server unless disabled | Server host | Local OCR backend |

For single-workstation development with local USB devices, prefer:

```bash
pnpm install
pnpm dev:local
```

Use `pnpm dev` only when you intentionally want to run the web service without registering local devices. Start at least one `pnpm agent` process before expecting devices in `/api/devices` or the dashboard.

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
# One command, includes a shared local Agent
pnpm dev:local
```

Or split the processes for clearer logs:

```bash
# Terminal 1: server + dashboard
pnpm dev

# Terminal 2: local Agent
DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010 DEVICE_AGENT_SHARED=1 pnpm agent
```

Use the HTTPS dev shape when another computer opens the dashboard over the LAN. Browser Android realtime preview depends on WebCodecs, and many browsers only expose WebCodecs in a secure context. Plain `http://<lan-ip>:5173` can therefore fall back to screenshot preview even when the Agent and Android device support realtime streaming.

```bash
# One command, includes a shared local Agent over HTTPS
pnpm dev:https:local

# Or split terminals
pnpm dev:https
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
pnpm install
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

For teammates who do not have the repository checked out, use the Dashboard device page instead:

- `共享 Agent` copies a one-line installer command that downloads or reuses the Agent and publishes the host's devices to the public pool.
- `配对 Agent` creates a short-lived pairing code and copies a one-line installer command that keeps the host's devices visible only to the current browser session.

The installer stores files under `~/.mobile-automation-agent`, verifies the downloaded Agent checksum from `/agent/manifest.json`, checks `agent.pid` to avoid duplicate Agent processes, and writes logs to `~/.mobile-automation-agent/agent.log`.

## Process Management

For a simple intranet setup, run the server with a process manager and serve the dashboard through the server's SPA fallback after building the dashboard.

Minimal PM2 example:

```bash
pnpm build
DATA_DIR=/var/lib/mobile-automation PORT=4010 pm2 start "pnpm --filter @mobile-automation/server start" --name mobile-automation
pm2 save
```

Run Agents as separate managed processes on the device hosts, not inside the central server process. Example PM2 Agent process on a lab Mac:

```bash
DEVICE_AGENT_SERVER_URL=http://mobile-automation.local \
DEVICE_AGENT_ID=lab-mac-01 \
DEVICE_AGENT_SHARED=1 \
pm2 start "pnpm agent" --name mobile-automation-agent-lab-mac-01
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
- The current `start` command still uses the workspace TypeScript runtime through `tsx`; install the full workspace dependencies on the runtime host.
- Browser-embedded Android realtime preview depends on WebCodecs support; LAN browser access should use HTTPS so the page is a secure context. HarmonyOS dashboard preview currently uses screenshot polling.
