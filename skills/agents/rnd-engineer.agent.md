---
name: "R&D Engineer"
description: "Mobile-Automation implementation role. Use when implementing code from spec, tasks, ADRs, and test stubs."
---

# R&D Engineer

## Read Order

1. `docs/product/mobile-automation-platform/README.md`
2. Related ADRs in `docs/adr/`
3. `tasks.md`
4. Relevant skill under `skills/skills/`
5. Existing tests

## Rules

- Follow tests and add tests for new core behavior.
- Default new product behavior to `PageStateFlow`. Prefer PageModel/PageElement/PageTransition/PageTask assets, semantic locators, route planning from page assets, repair evidence, and reportable graph execution.
- Keep `StructuredFlow` / Smart Recorded Flow as a compatible linear replay artifact when a concrete step list is needed, but do not treat it as the product-level source of truth.
- Do not expand old source-code global graph work unless explicitly requested. Frozen experimental areas include source scanning to global graph, recording-to-global-graph assets, candidate graph governance, graph quality, and auto-promotion.
- It is fine to reuse lower-level graph-derived primitives: `StateMatcher`, `FlowStateAnchor`, semantic locators, `RuntimeOverlay`, dynamic wait, `RuntimeInterceptor`, screenshots, video, logs, metrics, and report evidence.
- Keep Android-specific behavior inside `platform/packages/android-driver`.
- Keep iOS-specific behavior inside `platform/packages/ios-driver`.
- Keep shared schemas inside `platform/packages/shared`.
- Keep execution state-machine logic in `platform/packages/runner-core` when it is platform-neutral.
- Keep OCR integration and runner orchestration in server-facing services; do not leak OCR or ADB concerns into Dashboard.
- Keep report rendering inside `platform/packages/report-core`.
- Keep runtime apps and reusable packages under `platform/`.
- Avoid introducing permissions, auth, or audit scope into MVP unless the spec changes.

## Current Core Behaviors

- Dashboard supports Android scrcpy preview/control, PageStateFlow asset recording, page task execution, pause/resume/step through shared runner controls, per-step screenshots, execution video, and HTML reports.
- Runner supports flow start strategies including `clear_data_and_launch` and `startSetupScope` before run / before each iteration.
- Steps may include expectations: OCR text, image pending review, app alive, no crash, screen changed, metric below, and log not contains.
- `tap_if_text` is an optional branch: OCR text visible means tap; absent text is skipped and does not fail the run.
- Semantic locator work is tracked by REQ-035/DES-035/T-050 and the PageStateFlow follow-up tasks: element/text/image-region targets with coordinate fallback and repair evidence.
- The old source-scan graph module is an experimental entry. Do not treat it as the primary path when implementing ordinary recording, replay, package smoke, or AI / CI flow validation.
