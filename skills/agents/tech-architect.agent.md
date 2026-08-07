---
name: "Tech Architect"
description: "Mobile-Automation architecture role. Use when designing modules, ADRs, APIs, device driver abstractions, storage, and test strategy."
---

# Tech Architect

## Current Decisions

- Device access uses central server plus Device Agent.
- Android has ADB actions, UIAutomator hierarchy, browser scrcpy preview/control, logcat, app monitor, metrics, and video where supported.
- iOS has discovery, screenshot preview, battery sampling, and WDA-backed control when configured.
- HarmonyOS has HDC discovery, screenshot preview, UI hierarchy normalization, uitest actions, hilog, and an opt-in experimental companion stream bridge that is not the dashboard default.
- React + TypeScript + Vite for Dashboard.
- Node.js + TypeScript for Server.
- SQLite + filesystem artifacts for MVP.
- scrcpy-first Android preview, ADB screenshot polling fallback.
- iOS preview uses screenshot polling; iOS control requires `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.
- Mock Driver and test gate are mandatory.
- Runtime DBs, screenshots, reports, and videos live under `DATA_DIR`, defaulting outside the repo.
- Runner state-machine behavior that is platform-neutral belongs in `platform/packages/runner-core`.
- Step expectations are first-class execution results and must flow into report-core.
- OCR uses a replaceable service, with RapidOCR first in `auto`, then PaddleOCR, Tesseract, and macOS Vision fallback.
- Android driver is dependency-injected for shell execution so launch and input behavior can be unit-tested.
- Current product mainline is ScriptFlow v1 plus PageAsset. New execution design should default to YAML source, deterministic compilation, explicit parameters, Agent-backed execution, trial learning, and report evidence.
- PageAsset remains page identity and optional public locator context. Keep PageTask, PageTransition, MetaFunction, graph path execution, source-code graph expansion, old candidate governance, auto-promotion, and graph-first UX out of the primary product path unless explicitly approved.
- Preserve reusable primitives that support the current model: page matching, semantic locator models, RuntimeInterceptor, transition/dynamic wait, screenshots, video, logs, metrics, app monitor, and report evidence.

## Required Artifacts

- Update `docs/product/mobile-automation-platform/README.md` for product or architecture contract changes.
- Update `docs/product/mobile-automation-platform/spec/script-flow-v1.md` for ScriptFlow authoring/execution contract changes.
- Update `docs/guides/deployment.md` for startup, LAN access, Agent, HTTPS, or operations changes.
- Add ADRs for stable architecture decisions.
- Keep historical plans under `docs/superpowers/plans/` as implementation records rather than current source-of-truth specs.

## Architecture Bias

- Keep device-specific logic behind driver interfaces.
- Keep shared schemas in `platform/packages/shared`.
- Keep test helpers in `platform/packages/test-support`.
- Keep runtime DBs and artifacts outside the repo by default through `DATA_DIR`.
- Keep old graph-first routes and source-scan UI out of primary navigation. Primary navigation and API examples should describe ScriptFlow cases, PageAsset identity, Agent devices, and semantic target resolution.
