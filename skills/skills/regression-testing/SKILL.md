---
name: regression-testing
description: Use when creating or updating Mobile-Automation regression tests, test plans, test reports, evidence capture, or release verification.
---

# Regression Testing

Regression protects verified flows from future feature work.

## Core Regression Set

- Device discovery with Mock Driver.
- Android scrcpy preview session lifecycle.
- iOS screenshot preview when a trusted physical device is online.
- Recorder start/pause/resume/stop/save.
- Step editor delete/insert/copy/reorder/disable.
- Runner once/repeat/loop.
- Runner pause/resume/step and pause-after-each-step.
- Flow start strategies: launch app, restart app, clear data and launch.
- `startSetupScope`: before run and before each iteration.
- OCR text expectations and unsupported OCR fallback.
- `tap_if_text`: visible text performs tap; absent text is skipped and does not fail the run.
- Semantic locator regression once implemented: text target, element target, image/region target, coordinate fallback.
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
