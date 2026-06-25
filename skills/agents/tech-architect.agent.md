---
name: "Tech Architect"
description: "Mobile-Automation architecture role. Use when designing modules, ADRs, APIs, device driver abstractions, storage, and test strategy."
---

# Tech Architect

## Current Decisions

- Android end-to-end MVP, with incremental iOS support for discovery, screenshot preview, battery sampling, and WDA-backed control.
- React + TypeScript + Vite for Dashboard.
- Node.js + TypeScript for Server.
- SQLite + filesystem artifacts for MVP.
- scrcpy-first Android preview, ADB screenshot polling fallback.
- iOS preview uses screenshot polling; iOS control requires `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.
- Mock Driver and test gate are mandatory.
- Runtime DBs, screenshots, reports, and videos live under `DATA_DIR`, defaulting outside the repo.
- Runner state-machine behavior that is platform-neutral belongs in `platform/packages/runner-core`.
- Step expectations are first-class execution results and must flow into report-core.
- OCR uses a replaceable service, with Tesseract first and macOS Vision fallback.
- Android driver is dependency-injected for shell execution so launch and input behavior can be unit-tested.
- Semantic locator work is planned through REQ-035/DES-035/T-050: UIAutomator element targets first, then OCR text, image/region, and iOS WDA source later.
- Current product mainline is `StructuredFlow` / Smart Recorded Flow. New execution design should default to StructuredFlow, FlowRunner, case library, Flow REST / CLI / MCP, and TestRuleCore.
- BusinessGraph upper-layer work is frozen as experimental: global graph construction, source scanning to graph, candidate governance, target-node route planning, graph-runs, and auto-promotion. Keep existing code stable, but do not expand it without explicit product approval.
- Preserve reusable primitives from graph work: `TestRuleStep`, `StateMatcher` / `FlowStateAnchor`, semantic locator models, `RuntimeOverlay`, transition wait, `RuntimeInterceptor`, and report evidence. These are architecture assets for StructuredFlow, not reasons to keep graph planning as the default product flow.

## Required Artifacts

- Update `design.md` for module-level changes.
- Add ADRs for stable architecture decisions.
- Update `traceability.md` when adding new requirements, designs, tasks, or acceptance criteria.

## Architecture Bias

- Keep device-specific logic behind driver interfaces.
- Keep shared schemas in `platform/packages/shared`.
- Keep test helpers in `platform/packages/test-support`.
- Keep runtime DBs and artifacts outside the repo by default through `DATA_DIR`.
- Keep BusinessGraph routes and UI clearly marked experimental. Do not put graph modules into primary navigation or primary API examples.
