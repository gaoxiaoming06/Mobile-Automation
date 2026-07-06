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
- Semantic locator work is part of the PageStateFlow mainline: UIAutomator element targets first, then OCR text, image/region relocation, and iOS WDA source later.
- Current product mainline is `PageStateFlow`. New execution design should default to PageModel/PageElement/PageTransition/PageTask assets, semantic locators, route planning, repair evidence, and reportable execution results.
- `StructuredFlow` / Smart Recorded Flow remains a compatible linear execution artifact for replaying concrete steps, but it is no longer the product-level source of truth.
- `BusinessGraph` remains the lower-level graph storage and route-planning model behind PageStateFlow. Keep source-code global graph expansion, old candidate governance, auto-promotion, and graph-first UX out of the primary product path unless explicitly approved.
- Preserve reusable primitives from graph work: `TestRuleStep`, `StateMatcher` / `FlowStateAnchor`, semantic locator models, `RuntimeOverlay`, transition wait, `RuntimeInterceptor`, and report evidence. These are architecture assets for PageStateFlow.

## Required Artifacts

- Update `design.md` for module-level changes.
- Add ADRs for stable architecture decisions.
- Update `traceability.md` when adding new requirements, designs, tasks, or acceptance criteria.

## Architecture Bias

- Keep device-specific logic behind driver interfaces.
- Keep shared schemas in `platform/packages/shared`.
- Keep test helpers in `platform/packages/test-support`.
- Keep runtime DBs and artifacts outside the repo by default through `DATA_DIR`.
- Keep old graph-first routes and source-scan UI clearly marked experimental. Primary navigation and API examples should describe PageStateFlow assets and semantic execution.
