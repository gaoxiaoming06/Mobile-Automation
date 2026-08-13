# Mobile Automation

Mobile visual automation testing platform.

The current product uses ScriptFlow YAML as the test-case source of truth and PageAsset as the page-identity source of truth. It includes Device Agent based Android, iOS, and HarmonyOS device access, Android browser-embedded realtime preview, HarmonyOS screenshot preview, visual/OCR execution, AI-assisted ScriptFlow generation and repair, trial learning, performance/event capture, MCP integration, and HTML reports.

## Project Structure

```text
Mobile-Automation/
  platform/
    apps/
      dashboard/      # React Web dashboard
      server/         # Node.js API, WebSocket, orchestration
      device-agent/   # Local device node that registers USB devices with server
    packages/
      shared/         # Shared schemas and utilities
      android-driver/ # Android ADB/scrcpy driver
      ios-driver/     # iOS libimobiledevice/xcrun/WDA driver
      harmony-driver/ # HarmonyOS HDC/uitest driver
      script-flow/    # ScriptFlow YAML parser, validator, compiler, serializer
      runner-core/    # Test execution engine
      report-core/    # HTML report generation
      test-support/   # Mock Driver, fixtures, builders, assertions
      mcp-adapter/    # Mobile Automation MCP server/client adapter
      cli/            # REST-backed ScriptFlow command-line helper
    tools/            # Tool-managed binaries, such as scrcpy-server
    data/             # Legacy marker only; runtime data is external by default
  docs/
    product/          # Product-level platform specs
    features/         # Future sub-feature specs
    adr/              # Architecture decision records
    test/             # Test plans, reports, evidence, scripts
    guides/           # Development and operations guides
    reference/        # Tooling and protocol references
    changelog/        # Project-level changelog
  skills/
    agents/           # Project-local AI role prompts
    skills/           # Project-local AI skills
```

Runtime databases, screenshots, videos, logs, and reports default to
`~/.local/share/mobile-automation/` and can be redirected with `DATA_DIR`.

## Current Decisions

- Device access: central server plus one or more Device Agents.
- Android: ADB actions, UIAutomator hierarchy, browser scrcpy stream/control, screenshot fallback, logcat, metrics, app monitor, and video recording where supported.
- iOS: libimobiledevice/xcrun discovery and screenshots, WDA-backed control when configured.
- HarmonyOS: HDC discovery, screenshot preview, `uitest` actions/UI hierarchy, hilog, and an opt-in experimental companion HAP stream bridge that is not the dashboard default.
- Dashboard: React + TypeScript + Vite.
- Server: Node.js + TypeScript.
- Storage: SQLite + filesystem artifacts.
- Android preview: browser-embedded scrcpy stream first, ADB screenshot polling fallback.
- iOS preview: `idevicescreenshot` or WDA screenshot for trusted online physical devices.
- iOS control: WebDriverAgent required, configured on the Agent host through `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.
- Report: Web detail + HTML export.
- Tests: Mock Driver and regression gate are required.

See [docs/adr](docs/adr/) for decision details.

## Main Spec

Start here:

- [Product README](docs/product/mobile-automation-platform/README.md)
- [ScriptFlow v1 contract](docs/product/mobile-automation-platform/spec/script-flow-v1.md)
- [ScriptFlow REST / CLI / MCP guide](docs/guides/script-flow-tools.md)
- [Historical ScriptFlow v1 implementation plan](docs/superpowers/plans/2026-07-28-script-flow-v1-clean-cut.md)

## AI Read Order

For future implementation sessions:

1. [README.md](README.md)
2. [Product README](docs/product/mobile-automation-platform/README.md)
3. [ScriptFlow v1 contract](docs/product/mobile-automation-platform/spec/script-flow-v1.md)
4. [AI development workflow](docs/guides/ai-development-workflow.md)
5. Relevant ADRs in [docs/adr](docs/adr/)
6. Relevant local skill in [skills/skills](skills/skills/)

## Current Implementation Shape

1. `pnpm dev` starts the HTTPS source stack: central server, dashboard, and one shared local Agent for a single workstation.
2. `pnpm dev:web` starts only the central server and dashboard when local devices are intentionally split out or unavailable.
3. `pnpm agent:dev:https` starts a source-watched local Device Agent against the HTTPS development server; `pnpm agent` starts the source Agent once without watch.
4. Dashboard reads devices through `/api/devices`, then routes screenshots, actions, UI hierarchy, streams, logs, and performance sampling through the server-to-agent command channel.
5. ScriptFlow v1 YAML is parsed, validated, previewed into an immutable plan digest, and executed through the shared runner.
6. Runs persist screenshots, logs, metrics, trial-learning summaries, HTML reports, and videos when enabled/supported under `DATA_DIR`.
7. External AI clients can use the MCP adapter to generate, repair, run, and report ScriptFlow validations without direct database or driver access.

## Local Development

Requires Node.js >= 22.7.0 and pnpm >= 9.0.0. The server uses `node:sqlite`, so older Node.js versions will fail during startup.

Development mode runs from source:

```bash
pnpm install
pnpm setup:ocr
pnpm dev
```

- Dashboard: https://localhost:5173
- Server health: https://localhost:4010/api/health
- Devices: provided by the local shared Agent in the same command.
- Source updates: Dashboard uses Vite HMR, server uses `tsx watch`, and the local Agent uses `tsx watch`.

The default command uses HTTPS so browser WebCodecs stays available for realtime preview on localhost and LAN addresses. The first browser visit may require accepting the local self-signed certificate.

If you intentionally want to run the web service without local devices, use `pnpm dev:web`. In that mode `/api/devices` returns an empty list until at least one Agent process registers devices with the server.

To split the processes while developing, use two terminals:

```bash
# Terminal 1: central server + dashboard
pnpm dev:web

# Terminal 2: local source Agent, shared into the public device pool
pnpm agent:dev:https
```

For another computer on the same LAN, open the HTTPS dev dashboard so browser WebCodecs remains available for Android realtime preview:

```bash
# One workstation command
pnpm dev

# Or split terminals
pnpm dev:web
pnpm agent:dev:https
```

- LAN Dashboard: `https://<server-lan-ip>:5173/`
- LAN Server health: `https://<server-lan-ip>:4010/api/health`
- First visit may require accepting the local self-signed certificate.

HTTP development is still available for diagnostics as `pnpm dev:http:local` or `pnpm dev:http:web`, but it can force the dashboard to fall back to screenshot preview in browsers that require a secure context for WebCodecs.

Start at least one Device Agent on every machine that has USB-connected devices:

```bash
pnpm agent:dev:https
```

For non-developer device hosts, open **系统设置 > 设备接入** in the Dashboard and copy one of the generated Agent commands:

- Public-device-pool command: publishes the host's devices to the public device pool.
- Private command: creates a short-lived pairing code and keeps the host's devices visible only to the current browser session.

Both commands download or reuse `~/.mobile-automation-agent/mobile-automation-agent.cjs`, verify it against `/agent/manifest.json`, and start a local control service at `http://127.0.0.1:17611`. Keep that terminal open while sharing devices; after it is running, **系统设置 > 设备接入** can switch between shared/private mode, reconnect with a fresh private pairing code, update the Agent bundle, or disconnect the managed Agent runtime.

## Release Package

Release mode runs compiled artifacts. Use it when you want to deploy the same build to an intranet server instead of running Vite or `tsx watch` on the target machine.

Build the package from a source checkout:

```bash
pnpm install
pnpm package:offline
```

This creates:

- `dist/mobile-automation-release/`: unpacked release directory.
- `dist/mobile-automation-release.tgz`: archive to copy to the central server.

The release directory contains the compiled server bundle, built dashboard, Device Agent distribution manifest/bundle, OCR sidecar script, and OCR requirements:

```text
platform/apps/server/dist/index.mjs
platform/apps/dashboard/dist/
platform/apps/server/public/agent/
scripts/rapidocr-http-service.py
scripts/setup-ocr.mjs
scripts/ensure-lan-https-cert.mjs
requirements-ocr.txt
release-manifest.json
```

Deploy and start on the central server:

```bash
tar -xzf mobile-automation-release.tgz -C /opt
cd /opt/mobile-automation-release
node scripts/setup-ocr.mjs
OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 node platform/apps/server/dist/index.mjs
```

Device hosts do not need the source repository in release mode, and the central server does not run a permanent local Agent unless that same machine also has USB devices to share. Open **系统设置 > 设备接入** on the deployed dashboard and copy the generated Agent command for each device host. When Agent code changes, bump the Agent version and rebuild the release package; after the server is redeployed, new Agent starts download the latest bundle, and already-running managed Agents can detect the newer `/agent/manifest.json` from the settings panel and update manually.

Connect Android devices with USB debugging enabled before starting the agent. For iOS physical devices, install libimobiledevice tools and trust/unlock the device first:

```bash
brew install libimobiledevice
idevice_id --list
```

To enable iOS remote control, run WebDriverAgent for the target device on the Agent host and configure one of:

```bash
export IOS_WDA_URL=http://localhost:8100
export IOS_WDA_URL_00008020_000260113E04002E=http://localhost:8100
```

Runtime DB and artifacts default to `~/.local/share/mobile-automation`. Override with `DATA_DIR=/path/to/mobile-automation-data` when needed.

### Device Agent

The server uses Device Agents as its device access layer. A running server/dashboard without a registered Agent is healthy but has no devices to show. Start the central server first, then start an Agent on each machine that has USB-connected devices, or use `pnpm dev` for the single-workstation development case:

```bash
# Terminal 1: central server + dashboard
pnpm dev:web

# Terminal 2: local device node, shared into the public device pool
pnpm agent:dev:https
```

Agent devices appear in `/api/devices` and the Dashboard with serials like `my-macbook:android:<local-serial>`. The agent uses the command WebSocket with HTTP polling fallback, and executes device info, screenshot, UI hierarchy, foreground app, tap/input/swipe/app launch, clear data, logs, semantic Android actions, stream startup, and performance sampling through the platform drivers.

For private local use from source, create a pairing code from the server and start the Agent without `DEVICE_AGENT_SHARED=1`:

```bash
curl -k -X POST https://127.0.0.1:4010/api/local-sessions/pairing-codes \
  -H 'content-type: application/json' \
  -d '{"sessionId":"my-browser","ttlMs":300000}'

NODE_TLS_REJECT_UNAUTHORIZED=0 \
DEVICE_AGENT_SERVER_URL=https://127.0.0.1:4010 \
DEVICE_AGENT_ID=my-private-agent \
DEVICE_AGENT_PAIRING_CODE=<code> \
pnpm agent:dev

curl -k 'https://127.0.0.1:4010/api/devices?sessionId=my-browser'
```

### OCR Engines

The server uses pluggable local OCR engines. `OCR_ENGINE=auto` now tries RapidOCR first, then PaddleOCR, then Tesseract, then macOS Vision. RapidOCR is started automatically as a local sidecar when the server starts, unless `OCR_SIDECAR_ENABLED=0` or `RAPID_OCR_AUTOSTART=0` is set. PaddleOCR remains an optional local HTTP service.

RapidOCR is the recommended local cross-platform OCR backend for mobile UI screenshots. Prepare the local Python runtime once:

```bash
pnpm setup:ocr

export OCR_ENGINE=rapid
export RAPID_OCR_ENDPOINT=http://127.0.0.1:8766/ocr
pnpm --filter @mobile-automation/server dev
```

`pnpm setup:ocr` creates or updates `.venv-paddleocr` from `requirements-ocr.txt`. It uses `uv` when available and falls back to `python3 -m venv` plus pip. The server does not install OCR packages during startup; it only launches `scripts/rapidocr-http-service.py` with `.venv-paddleocr/bin/python` automatically when `OCR_ENGINE=auto` or `OCR_ENGINE=rapid` uses the default local endpoint. It does not fall back to the system `python3` by default, because Homebrew / IDE-bundled Python versions often do not have the OCR modules installed. If you intentionally want to use a non-project Python runtime, set `RAPID_OCR_PYTHON=/path/to/python` or `RAPID_OCR_ALLOW_SYSTEM_PYTHON=1`.

For a target server without internet access, prepare Python wheels on a machine with the same OS and CPU architecture before `pnpm package:offline`. If `vendor/ocr-wheels` exists in the release, `node scripts/setup-ocr.mjs` installs from that local wheelhouse:

```bash
pnpm setup:ocr
mkdir -p vendor/ocr-wheels
.venv-paddleocr/bin/python -m pip download -r requirements-ocr.txt -d vendor/ocr-wheels
pnpm package:offline
```

When reusing an existing RapidOCR service on `127.0.0.1:8766`, the server checks both `/health` and a tiny real `/ocr` smoke request. A service that only answers `/health` but cannot import `rapidocr` is rejected with an explicit startup warning. If `OCR_ENGINE=rapid` is forced, this becomes a startup error; with `OCR_ENGINE=auto`, the server can continue and let the OCR composite fall back to other engines.

To manage RapidOCR yourself, start it manually with the project venv and the server will reuse the existing service:

```bash
.venv-paddleocr/bin/python scripts/rapidocr-http-service.py
```

PaddleOCR is also supported:

```bash
# Recommended on macOS when the system Python is too new for PaddlePaddle:
uv venv .venv-paddleocr --python 3.11
uv pip install --python .venv-paddleocr/bin/python paddleocr paddlepaddle pillow
.venv-paddleocr/bin/python scripts/paddleocr-http-service.py

# Or, with an existing compatible Python:
python3 -m venv .venv-paddleocr
source .venv-paddleocr/bin/activate
pip install paddleocr paddlepaddle pillow
python scripts/paddleocr-http-service.py

export OCR_ENGINE=paddle
export PADDLE_OCR_ENDPOINT=http://127.0.0.1:8765/ocr
pnpm --filter @mobile-automation/server dev
```

Other supported values are `OCR_ENGINE=paddle`, `OCR_ENGINE=tesseract`, `OCR_ENGINE=vision`, and `OCR_ENGINE=auto`. `vision` is macOS-only; RapidOCR, PaddleOCR, and Tesseract are the cross-platform choices.

Artifact cleanup runs once on server startup and then every 6 hours by default. By default it only removes temporary leftovers such as `.tmp`, `.part`, `.partial`, and `.download` files. Completed reports are not deleted unless retention deletion is explicitly enabled:

```bash
ARTIFACT_RETENTION_ENABLED=1
PASSED_RUN_RETENTION_DAYS=7
FAILED_RUN_RETENTION_DAYS=30
MAX_ARTIFACT_STORAGE_GB=20
CLEANUP_INTERVAL_HOURS=6
```

The dashboard uses an embedded scrcpy stream in the browser through WebCodecs. The embedded stream uses the pinned `platform/tools/scrcpy-server-v3.3.3` file because the current Tango client targets scrcpy protocol 3.3.3. This server file is intentionally committed to git as a small, version-locked runtime dependency. You can verify it with `pnpm check:tools`, refresh it with `pnpm install:scrcpy-server`, or override it with `SCRCPY_SERVER_PATH`.

The local `scrcpy` CLI command is optional. It is only used for the native debug window and as a recording fallback when Android `screenrecord` is unavailable. Browser-embedded preview/control and the core automation flow must not require a locally installed `scrcpy` CLI.

HarmonyOS dashboard preview currently uses screenshot polling. An opt-in experimental stream bridge exists: the device-agent can start a companion HAP, open an `hdc fport` tunnel to its TCP port, and relay H.264 packets through the server, but that path is not the dashboard default. See [HarmonyOS screen stream companion](docs/guides/harmony-screen-stream.md).

For an initial team deployment path, see [Deployment Guide](docs/guides/deployment.md).
