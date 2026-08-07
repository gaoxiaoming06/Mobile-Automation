---
title: Deployment Guide
doc_type: guide
status: draft
created_at: 2026-06-05
updated_at: 2026-06-05
---

# Deployment Guide

This project is currently optimized for a local or intranet QA workstation deployment. The first reliable deployment target is a single machine that has Node.js, pnpm, ADB, scrcpy tooling, and physical device access.

## Option A: QA Workstation

Use this when devices are connected by USB or ADB-over-network to the same Mac/Linux machine that runs the service.

```bash
pnpm install
pnpm check:tools
pnpm build
DATA_DIR=/Users/Shared/mobile-automation-data PORT=4010 pnpm --filter @mobile-automation/server start
```

Recommended runtime data locations:

- macOS single user: `~/.local/share/mobile-automation`
- macOS shared QA machine: `/Users/Shared/mobile-automation-data`
- Linux server: `/var/lib/mobile-automation`
- NAS-backed team storage: a mounted directory passed through `DATA_DIR`

The runtime data directory contains SQLite DB files, screenshots, videos, logs, HTML reports, and temporary artifacts. Do not place it in the repository for normal use.

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
- `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`: optional iOS control endpoint.
- `ARTIFACT_RETENTION_ENABLED`: keep disabled unless the team has agreed on report retention.
- `VITE_DASHBOARD_ADVANCED_TOOLS`: optional dashboard switch for local asset calibration and page asset governance tools. This is an operator/debug convenience, not an authentication or permission boundary.

The host `scrcpy` CLI is optional. Install it only when you need the native debug window or recording fallback; browser-embedded Android preview/control uses the pinned server file above.

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
- No Docker image yet; device connectivity is easier and more predictable on a host workstation.
- No production CI/CD pipeline yet.
- Browser-embedded Android preview depends on WebCodecs support.
