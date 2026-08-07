---
name: mobile-automation-tdd
description: Use when implementing or modifying Mobile-Automation core logic with tests first: ScriptFlow schema/compiler, ActionStep mapping, coordinate conversion, Agent/device driver contracts, runner controls, reports, learning, MCP/CLI adapters, Mock Driver, or regression gates.
---

# Mobile Automation TDD

Use this skill before changing core behavior that can regress recorded or replayed tests.

## Workflow

1. Read `docs/product/mobile-automation-platform/README.md`, `docs/product/mobile-automation-platform/spec/script-flow-v1.md`, and the related ADR/guide before changing shared behavior.
2. Create or update tests before implementation when behavior is new or risky.
3. Run the narrowest test first.
4. Make it pass with minimal implementation.
5. Run the broader suite.
6. Update `docs/test/reports/` when verification involves manual or device evidence.

## Required Coverage Areas

- `ActionStep` validation and migration.
- ScriptFlow parsing, validation, serialization, compilation, `runFlow` expansion, parameter substitution, preview/plan digest, and draft/saved run endpoints.
- Coordinate conversion, including letterbox offsets and rotation.
- Device Agent registration, heartbeat, command result handling, shared/private visibility, pairing codes, leases, and platform capability checks.
- Runner modes: once, repeat N, loop until stop, duration.
- Runner controls: pause, resume, stop, single step, pause after each step.
- Failure policies: stop, continue, retry.
- Flow start strategies: keep current, home, launch app, restart app, clear data and launch.
- Start setup scope: before run and before each iteration.
- Step expectations: text/OCR, image pending review, app alive, no crash, screen changed, metric below, log not contains.
- Conditional steps: `tap_if_text` hit, miss, timeout, empty text, invalid OCR region.
- Semantic targets: text, element, image/region, coordinate fallback.
- AI draft generation/repair, temporary tests, trial runs, outcome review, and learning summaries when changing generation/execution flow.
- Dashboard case center, AI ScriptFlow editor, run controls, and advanced PageAsset calibration.
- Report HTML generation, step screenshots, execution video, expectation actuals, and condition metadata.
- Artifact path and cleanup rules.

## Test Support

Use `platform/packages/test-support` for:

- Mock Driver.
- Device fixtures.
- Step builders.
- Run builders.
- Artifact fixtures.

Commands:

```bash
pnpm test
pnpm test:unit
pnpm test:e2e
```
