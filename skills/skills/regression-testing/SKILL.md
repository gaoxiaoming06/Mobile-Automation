---
name: regression-testing
description: Use when creating or updating Mobile-Automation regression tests, test plans, test reports, evidence capture, or release verification.
---

# Regression Testing

Regression protects verified flows from future feature work.

## Core Regression Set

- Device discovery with Mock Driver.
- Device Agent registration, heartbeat, shared/private visibility, pairing codes, command results, leases, and disconnected-agent behavior.
- Android browser scrcpy preview/control lifecycle and screenshot fallback.
- iOS screenshot preview when a trusted physical device is online.
- HarmonyOS HDC discovery, screenshot preview, UI hierarchy, actions, and ScriptFlow execution. Exercise the experimental stream bridge only when explicitly enabled.
- AI ScriptFlow draft lifecycle: generate, edit, validate, preview, trial run, repair, save, and outcome review.
- Step editor delete/insert/copy/reorder/disable.
- ScriptFlow parser/validator/compiler/serializer, plan digest, `runFlow`, repeat/when, parameters, saved vs draft flows, trial vs normal runs, and temporary tests.
- MCP adapter tools for generate/preview/run/wait/report/reuse/repair.
- Runner once/repeat/loop.
- Runner pause/resume/step and pause-after-each-step.
- Flow start strategies: launch app, restart app, clear data and launch.
- `startSetupScope`: before run and before each iteration.
- OCR text expectations and unsupported OCR fallback.
- `tap_if_text`: visible text performs tap; absent text is skipped and does not fail the run.
- Semantic locator regression: text target, icon/visual target, control target, scoped text field, element target, image/region evidence, coordinate fallback.
- Failure policies.
- Metrics and event capture.
- HTML report generation.
- Execution video and per-step screenshots as report evidence.
- Cross-platform driver fallbacks, including iOS unsupported-video handling and Android command safety.

## Evidence

Store outputs under:

- `docs/test/plans/`
- `docs/test/reports/`
- `docs/test/screenshots/`
- `docs/test/scripts/`
- `docs/test/fixtures/`

## Report Template

Each report should include:

- Date.
- Scope.
- Environment.
- Commands run.
- Passed/failed/blocked cases.
- Evidence paths.
- Residual risks.
