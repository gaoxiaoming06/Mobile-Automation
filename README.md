# Mobile Automation

Mobile visual automation testing platform.

The first MVP focuses on Android device discovery, browser-embedded scrcpy live preview, remote control, operation recording, step editing, replay execution, performance/event capture, and HTML test reports. iOS support is now implemented as a first incremental layer for device discovery, screenshot preview, basic battery sampling, and WDA-backed control when WebDriverAgent is configured.

## Project Structure

```text
Mobile-Automation/
  platform/
    apps/
      dashboard/      # React Web dashboard
      server/         # Node.js API, WebSocket, orchestration
    packages/
      shared/         # Shared schemas and utilities
      android-driver/ # Android ADB/scrcpy driver
      ios-driver/     # iOS libimobiledevice/xcrun/WDA driver
      runner-core/    # Test execution engine
      report-core/    # HTML report generation
      test-support/   # Mock Driver, fixtures, builders, assertions
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

- MVP: Android end-to-end, with incremental iOS support.
- Dashboard: React + TypeScript + Vite.
- Server: Node.js + TypeScript.
- Storage: SQLite + filesystem artifacts.
- Android preview: browser-embedded scrcpy stream first, ADB screenshot polling fallback.
- iOS preview: `idevicescreenshot` screenshot polling for trusted online physical devices.
- iOS control: WebDriverAgent required, configured through `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.
- Report: Web detail + HTML export.
- Tests: Mock Driver and regression gate are required.

See [docs/adr](docs/adr/) for decision details.

## Main Spec

Start here:

- [Product README](docs/product/mobile-automation-platform/README.md)
- [Requirements](docs/product/mobile-automation-platform/spec/requirements.md)
- [Design](docs/product/mobile-automation-platform/spec/design.md)
- [Tasks](docs/product/mobile-automation-platform/spec/tasks.md)
- [Acceptance](docs/product/mobile-automation-platform/spec/acceptance.md)
- [Traceability](docs/product/mobile-automation-platform/spec/traceability.md)

## AI Read Order

For future implementation sessions:

1. [README.md](README.md)
2. [AI development workflow](docs/guides/ai-development-workflow.md)
3. [docs/product/mobile-automation-platform/README.md](docs/product/mobile-automation-platform/README.md)
4. Relevant ADRs in [docs/adr](docs/adr/)
5. Relevant local skill in [skills/skills](skills/skills/)
6. Implementation task in [tasks.md](docs/product/mobile-automation-platform/spec/tasks.md)

## First Implementation Direction

1. Create workspace/package tooling.
2. Implement shared schemas.
3. Implement Mock Driver and tests.
4. Implement Android driver foundation.
5. Implement server device/session APIs.
6. Implement dashboard device list and preview.
7. Implement recorder, runner, and report loop.

## Local Development

Requires Node.js >= 22.7.0 and pnpm >= 9.0.0. The server uses `node:sqlite`, so older Node.js versions will fail during startup.

```bash
pnpm install
pnpm dev
```

- Dashboard: http://localhost:5173
- Server health: http://localhost:4010/api/health

Connect Android devices with USB debugging enabled before opening the dashboard. For iOS physical devices, install libimobiledevice tools and trust/unlock the device first:

```bash
brew install libimobiledevice
idevice_id --list
```

To enable iOS remote control, run WebDriverAgent for the target device and configure one of:

```bash
export IOS_WDA_URL=http://localhost:8100
export IOS_WDA_URL_00008020_000260113E04002E=http://localhost:8100
```

Runtime DB and artifacts default to `~/.local/share/mobile-automation`. Override with `DATA_DIR=/path/to/mobile-automation-data` when needed.

### OCR Engines

The server uses pluggable local OCR engines. `OCR_ENGINE=auto` now tries RapidOCR first, then PaddleOCR, then Tesseract, then macOS Vision. RapidOCR is started automatically as a local sidecar when the server starts, unless `OCR_SIDECAR_ENABLED=0` or `RAPID_OCR_AUTOSTART=0` is set. PaddleOCR remains an optional local HTTP service.

RapidOCR is the recommended local cross-platform OCR backend for mobile UI screenshots. Prepare the local Python runtime once:

```bash
uv venv .venv-paddleocr --python 3.11
uv pip install --python .venv-paddleocr/bin/python rapidocr onnxruntime pillow

export OCR_ENGINE=rapid
export RAPID_OCR_ENDPOINT=http://127.0.0.1:8766/ocr
pnpm --filter @mobile-automation/server dev
```

The server will launch `scripts/rapidocr-http-service.py` with `.venv-paddleocr/bin/python` automatically when `OCR_ENGINE=auto` or `OCR_ENGINE=rapid` uses the default local endpoint. To manage RapidOCR yourself, start it manually and the server will reuse the existing service:

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

For an initial team deployment path, see [Deployment Guide](docs/guides/deployment.md).
