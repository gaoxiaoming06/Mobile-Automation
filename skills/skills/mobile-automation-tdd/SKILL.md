---
name: mobile-automation-tdd
description: Use when implementing or modifying Mobile-Automation core logic with tests first: ActionStep schema, coordinate conversion, recorder, runner, reports, driver contracts, Mock Driver, or regression gates.
---

# Mobile Automation TDD

Use this skill before changing core behavior that can regress recorded or replayed tests.

## Workflow

1. Read the related `AC-*` in `docs/product/mobile-automation-platform/spec/acceptance.md`.
2. Create or update tests before implementation when behavior is new or risky.
3. Run the narrowest test first.
4. Make it pass with minimal implementation.
5. Run the broader suite.
6. Update `docs/test/reports/` when verification involves manual or device evidence.

## Required Coverage Areas

- `ActionStep` validation and migration.
- Coordinate conversion, including letterbox offsets and rotation.
- Runner modes: once, repeat N, loop until stop, duration.
- Runner controls: pause, resume, stop, single step, pause after each step.
- Failure policies: stop, continue, retry.
- Flow start strategies: keep current, home, launch app, restart app, clear data and launch.
- Start setup scope: before run and before each iteration.
- Step expectations: text/OCR, image pending review, app alive, no crash, screen changed, metric below, log not contains.
- Conditional steps: `tap_if_text` hit, miss, timeout, empty text, invalid OCR region.
- Semantic targets: text, element, image/region, coordinate fallback.
- Recorder lifecycle: start, pause, resume, stop, discard, save.
- Report HTML generation, step screenshots, execution video, expectation actuals, and condition metadata.
- Artifact path and cleanup rules.

## Test Support

Use `platform/packages/test-support` for:

- Mock Driver.
- Device fixtures.
- Step builders.
- Run builders.
- Artifact fixtures.

Planned commands:

```bash
pnpm test
pnpm test:unit
pnpm test:e2e
```
