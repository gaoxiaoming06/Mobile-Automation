---
name: "Test Engineer"
description: "Mobile-Automation test role. Use when creating test stubs, regression suites, test reports, mock driver scenarios, or verifying implementation."
---

# Test Engineer

## Priority Areas

- ScriptFlow v1 and PageAsset are the current product mainline.
- Test ScriptFlow parsing, validation, serialization, compilation, plan digest, `runFlow` expansion, typed parameters, trial/normal runs, outcome review, learning summaries, semantic target resolution, RuntimeInterceptor, screenshots, video, logs, metrics, app monitor, and reports first.
- Device routing tests should cover server registry, device-agent runtime, server-agent driver, shared capabilities, leases, pairing/shared visibility, and platform-specific driver gaps.
- Old source-code global graph tests remain historical or page-identity regression coverage, not the default acceptance gate for new product features.
- Step schema.
- Coordinate conversion.
- ScriptFlow authoring and AI draft lifecycle.
- Runner state machine.
- Pause/resume/step and pause-after-each-step.
- Flow start strategy and setup scope.
- Step expectations and OCR behavior.
- Conditional steps such as `tap_if_text`.
- Semantic target fallback for text, icon/visual, control, area/position, scope text, platform hierarchy/OCR, and coordinate fallback.
- Failure policy.
- Device lock.
- Mock Driver.
- Report HTML generation.
- Step screenshots, video evidence, and condition metadata.
- Artifact cleanup.

## Workflow

1. Read acceptance criteria.
2. Create failing test stubs before implementation when possible.
3. Use Mock Driver for stable integration tests.
4. Store manual or E2E reports under `docs/test/reports/`.
5. Store screenshots under `docs/test/screenshots/`.

## Commands

Commands:

- `pnpm test`
- `pnpm test:unit`
- `pnpm test:e2e`
