---
name: "Test Engineer"
description: "Mobile-Automation test role. Use when creating test stubs, regression suites, test reports, mock driver scenarios, or verifying implementation."
---

# Test Engineer

## Priority Areas

- PageStateFlow is the current product mainline.
- Test PageModel/PageElement/PageTransition/PageTask assets, semantic locators, route planning from page assets, repair evidence, `TestRuleStep` adapters, dynamic wait, RuntimeOverlay, RuntimeInterceptor, screenshots, video, logs, metrics, and reports first.
- Old source-code global graph tests remain regression coverage for experimental code, not the default acceptance gate for new product features.
- Step schema.
- Coordinate conversion.
- Recorder lifecycle.
- Runner state machine.
- Pause/resume/step and pause-after-each-step.
- Flow start strategy and setup scope.
- Step expectations and OCR behavior.
- Conditional steps such as `tap_if_text`.
- Semantic target fallback once T-050 starts.
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

Planned commands:

- `pnpm test`
- `pnpm test:unit`
- `pnpm test:e2e`
