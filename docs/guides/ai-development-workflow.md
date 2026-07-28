---
title: AI Development Workflow
doc_type: guide
status: active
updated_at: 2026-07-28
---

# AI Development Workflow

## Read order

1. Repository `README.md`.
2. `docs/product/mobile-automation-platform/README.md`.
3. `docs/product/mobile-automation-platform/spec/script-flow-v1.md`.
4. Relevant ADRs and implementation plan.

## Development rules

1. Clarify product behavior before changing shared contracts.
2. Write a short implementation plan for architecture or workflow changes.
3. Add focused tests for schema, compiler, runner, storage, page matching and API behavior.
4. Implement vertical slices that can run independently.
5. Run targeted tests first, then workspace typecheck, unit tests, lint and build.
6. Restart local services and verify the real API after runtime or storage changes.
7. Keep current behavior documented in the ScriptFlow contract or an ADR.

## Product boundary

Do not reintroduce page transitions, PageTask, MetaFunction, asset composition or graph execution as compatibility layers. PageAsset identifies pages; ScriptFlow defines behavior; Run records evidence.

## Definition of done

- The current product contract matches the implementation.
- Changed core behavior has regression coverage.
- Typecheck, tests and build pass, or remaining failures are explicitly documented.
- Runtime data migrations have a verified backup when destructive changes are required.
