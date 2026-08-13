---
title: Deployment Guide
doc_type: guide
status: draft
created_at: 2026-06-05
updated_at: 2026-08-13
---

# Deployment Guide

This project has two explicit operating modes:

- Development mode runs server, dashboard, and local Agent from source so code changes are picked up quickly.
- Release mode builds a compiled offline package and deploys that package to the central server.

Device discovery always goes through Device Agents. A healthy server/dashboard with no registered Agent will show `0` devices.

## Service Topology

| Process | Development command | Release command/artifact | Runs on | Purpose |
| --- | --- | --- | --- | --- |
| Dashboard | `pnpm --filter @mobile-automation/dashboard dev` | `platform/apps/dashboard/dist` served by server | Developer workstation / central server | Vite HMR in development, static SPA in release |
| Central server | `pnpm --filter @mobile-automation/server dev` | `node platform/apps/server/dist/index.mjs` | Workstation or intranet server | API, storage, AI orchestration, reports, built dashboard SPA fallback |
| Device Agent | `pnpm agent:dev:https` or launched by `pnpm dev` | Dashboard-generated installer command downloads `/agent/manifest.json` bundle | Every host with USB devices | Android, iOS, and HarmonyOS discovery and commands |
| RapidOCR sidecar | `pnpm setup:ocr`, then auto-started by server | `node scripts/setup-ocr.mjs`, then auto-started by server | Server host | Local OCR backend |

## Development Mode

Use this while editing code. Dashboard changes hot reload through Vite. Server changes restart through `tsx watch`. The local Agent also uses `tsx watch` when launched through `pnpm dev`, `pnpm dev:local`, `pnpm dev:https`, `pnpm dev:https:local`, `pnpm agent:dev:https`, or `pnpm agent:dev`.

Single workstation with local USB devices:

```bash
pnpm install
pnpm setup:ocr
pnpm dev
```

- Dashboard: `https://localhost:5173`
- Server health: `https://localhost:4010/api/health`
- Devices: provided by the local shared Agent in the same command.
- HTTPS is the default development mode so browser WebCodecs stays available for realtime preview on localhost and LAN addresses.

Run the web service without local devices:

```bash
pnpm dev:web
```

Split the source processes for clearer logs:

```bash
# Terminal 1: server + dashboard from source
pnpm dev:web

# Terminal 2: local Agent from source, shared into the public device pool
pnpm agent:dev:https
```

HTTPS development over a LAN uses the same default command:

```bash
pnpm setup:ocr
pnpm dev
```

Open the dashboard from another LAN machine at `https://<server-lan-ip>:5173/`, for example `https://10.254.32.11:5173/`. The first visit may require accepting the local self-signed certificate. Browser Android realtime preview depends on WebCodecs, and many browsers only expose WebCodecs in a secure context. Plain `http://<lan-ip>:5173` can therefore fall back to screenshot preview even when the Agent and Android device support realtime streaming.

Split HTTPS source processes:

```bash
# Terminal 1
pnpm dev:web

# Terminal 2
pnpm agent:dev:https
```

HTTP source mode is available only through explicit diagnostic commands:

```bash
pnpm dev:http:local
pnpm dev:http:web
```

`pnpm agent` still runs the source Agent once without watch. Use `pnpm agent:dev:https` while editing Agent, driver, or shared protocol code against the default HTTPS dev server.

## Release Mode

Use this when deploying a tested build to a central server. The target server runs compiled artifacts instead of Vite or `tsx watch`. Device Agents are started separately on the machines that have USB devices; the central server does not need to run an Agent unless it is also a device host.

Build the release package from a source checkout:

```bash
pnpm install
pnpm package:offline
```

The command runs the staged build:

1. `pnpm build:agent` bundles the Device Agent and writes `platform/apps/server/public/agent/manifest.json`.
2. `pnpm -r typecheck` checks all workspace packages.
3. `pnpm build:server` bundles the central server to `platform/apps/server/dist/index.mjs`.
4. `pnpm --filter @mobile-automation/dashboard build` writes `platform/apps/dashboard/dist`.
5. `scripts/package-offline-release.mjs` copies runtime artifacts into `dist/mobile-automation-release` and creates `dist/mobile-automation-release.tgz`.

The release directory contains:

```text
platform/apps/server/dist/
platform/apps/dashboard/dist/
platform/apps/server/public/agent/
scripts/rapidocr-http-service.py
scripts/setup-ocr.mjs
scripts/ensure-lan-https-cert.mjs
requirements-ocr.txt
release-manifest.json
```

Deploy it to the central server:

```bash
tar -xzf mobile-automation-release.tgz -C /opt
cd /opt/mobile-automation-release
node scripts/setup-ocr.mjs
OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 node platform/apps/server/dist/index.mjs
```

For direct HTTPS without a reverse proxy:

```bash
node scripts/ensure-lan-https-cert.mjs
HOST=0.0.0.0 HTTPS=1 \
HTTPS_KEY=$PWD/.cert/mobile-automation-lan-key.pem \
HTTPS_CERT=$PWD/.cert/mobile-automation-lan-cert.pem \
OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 \
node platform/apps/server/dist/index.mjs
```

Recommended runtime data locations:

- macOS single user: `~/.local/share/mobile-automation`
- macOS shared QA machine: `/Users/Shared/mobile-automation-data`
- Linux server: `/var/lib/mobile-automation`
- NAS-backed team storage: a mounted directory passed through `DATA_DIR`

The runtime data directory contains SQLite DB files, screenshots, videos, logs, HTML reports, and temporary artifacts. Do not place it in the repository for normal use.

## Device Agents

For release deployments, device hosts do not need the source repository. Open **系统设置 > 设备接入** in the deployed dashboard and copy the generated Agent command:

- Public-device-pool command downloads or reuses the Agent and publishes the host's devices to the public pool.
- Private command creates a short-lived pairing code and keeps the host's devices visible only to the current browser session.

The installer stores files under `~/.mobile-automation-agent`, verifies the downloaded Agent checksum from `/agent/manifest.json`, and starts a local control service at `http://127.0.0.1:17611`. Keep that terminal open on the device host. After the control service is online, **系统设置 > 设备接入** can switch shared/private mode, reconnect with a fresh private pairing code, update the downloaded Agent bundle, or disconnect the managed Agent runtime without closing the control service.

Private pairing codes are short-lived bootstrap tokens, currently 5 minutes. If a private Agent starts after the code expires, or the server restarts before the Agent successfully registers, the Agent stays running but registration is rejected; use **重连 Agent** in the settings panel to generate a fresh private code and restart the managed runtime.

When Agent code changes, bump the Agent version and rebuild the release package. After the server is redeployed, new Agent starts download the latest bundle, and already-running managed Agents can detect the newer `/agent/manifest.json` from the settings panel and update manually.

## OCR Setup

RapidOCR is the recommended local cross-platform OCR backend for mobile UI screenshots. OCR dependencies are prepared during setup, not during server startup.

Source checkout:

```bash
pnpm setup:ocr
```

Release package:

```bash
node scripts/setup-ocr.mjs
```

The setup script creates or updates `.venv-paddleocr` from `requirements-ocr.txt`. It uses `uv` when available and falls back to `python3 -m venv` plus pip.

During server startup, `ensureRapidOcrSidecar` only checks the configured endpoint and launches `scripts/rapidocr-http-service.py` with `.venv-paddleocr/bin/python` when `OCR_ENGINE=auto` or `OCR_ENGINE=rapid` uses the default local endpoint `http://127.0.0.1:8766/ocr`. If `OCR_ENGINE=rapid` is forced, missing or unhealthy RapidOCR is a startup error; with `OCR_ENGINE=auto`, the server can continue and let the OCR composite fall back to other engines.

For a fully offline target server, prepare OCR wheels on a compatible build machine before `pnpm package:offline`:

```bash
pnpm setup:ocr
mkdir -p vendor/ocr-wheels
.venv-paddleocr/bin/python -m pip download -r requirements-ocr.txt -d vendor/ocr-wheels
pnpm package:offline
```

If `vendor/ocr-wheels` exists in the release, `node scripts/setup-ocr.mjs` installs OCR packages from that local wheelhouse with `--no-index --find-links`.

To manage RapidOCR yourself, start it manually and the server will reuse the existing service:

```bash
.venv-paddleocr/bin/python scripts/rapidocr-http-service.py
```

Other supported OCR engines are `paddle`, `tesseract`, `vision`, and `auto`. `vision` is macOS-only; RapidOCR, PaddleOCR, and Tesseract are the cross-platform choices.

## Process Management

For a simple intranet setup, run the compiled server with a process manager and serve the dashboard through the server's SPA fallback.

Minimal PM2 example:

```bash
DATA_DIR=/var/lib/mobile-automation PORT=4010 pm2 start "node platform/apps/server/dist/index.mjs" --name mobile-automation
pm2 save
```

Minimal systemd shape:

```ini
[Unit]
Description=Mobile Automation Server
After=network.target

[Service]
WorkingDirectory=/opt/mobile-automation-release
Environment=PORT=4010
Environment=DATA_DIR=/var/lib/mobile-automation
Environment=OCR_ENGINE=rapid
ExecStart=/usr/local/bin/node /opt/mobile-automation-release/platform/apps/server/dist/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Run Agents as separate managed processes on the device hosts, not inside the central server process. For non-developer hosts, prefer the dashboard-generated installer command. For developer hosts with a source checkout, a PM2 Agent process can still use source mode:

```bash
DEVICE_AGENT_SERVER_URL=http://mobile-automation.local \
DEVICE_AGENT_ID=lab-mac-01 \
DEVICE_AGENT_SHARED=1 \
pm2 start "pnpm agent:dev" --name mobile-automation-agent-lab-mac-01
pm2 save
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
- `SCRCPY_SERVER_PATH`: optional custom scrcpy-server v3.3.3 file. The default pinned server file is committed at `platform/tools/scrcpy-server-v3.3.3` and included in the release Agent distribution.
- `DEVICE_AGENT_SERVER_URL`: server URL used by source Agent commands.
- `DEVICE_AGENT_ID`: stable Agent id. Defaults to host-based local identity when unset.
- `DEVICE_AGENT_SHARED`: set to `1` to publish Agent devices to the public pool.
- `DEVICE_AGENT_PAIRING_CODE`: short-lived code for private local-session devices.
- `DEVICE_AGENT_MAX_CONCURRENT_RUNS`: Agent-side concurrency limit.
- `HARMONY_STREAM_ENABLED`: opt-in switch for the experimental HarmonyOS companion stream bridge. The dashboard currently uses screenshot preview for HarmonyOS by default.
- `HTTPS`: set to `1` for direct HTTPS.
- `HTTPS_KEY` and `HTTPS_CERT`: optional certificate paths. The helper script creates `.cert/mobile-automation-lan-key.pem` and `.cert/mobile-automation-lan-cert.pem` by default.
- `OCR_ENGINE`: `auto` by default; use `rapid` when RapidOCR must be available and startup should fail if it is not.
- `RAPID_OCR_ENDPOINT`: defaults to `http://127.0.0.1:8766/ocr`.
- `RAPID_OCR_PYTHON`: optional Python path for RapidOCR sidecar. Defaults to `.venv-paddleocr/bin/python`.
- `OCR_SIDECAR_ENABLED` or `RAPID_OCR_AUTOSTART`: set to `0` to stop server-managed RapidOCR startup.
- `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`: optional iOS control endpoint on the Agent host.
- `ARTIFACT_RETENTION_ENABLED`: keep disabled unless the team has agreed on report retention.
- `VITE_DASHBOARD_ADVANCED_TOOLS`: optional dashboard switch for local asset calibration and page asset governance tools. This is an operator/debug convenience, not an authentication or permission boundary.

The host `scrcpy` CLI is optional on Agent hosts. Browser-embedded Android preview/control uses the pinned server file shipped through the Agent distribution.

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
