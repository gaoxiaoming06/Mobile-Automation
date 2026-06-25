---
title: AI Development Workflow
doc_type: guide
status: draft
created_at: 2026-06-08
updated_at: 2026-06-12
---

# AI Development Workflow

This project uses a spec-first and test-first workflow inspired by OpenSpec and Superpowers, but keeps the source of truth inside the existing project structure.

## Superpowers-Inspired Execution Discipline

This project adopts the practical development discipline from GitHub `obra/superpowers`, without migrating the repository structure or replacing the existing product spec system.

Use Superpowers ideas as execution rules:

1. Brainstorm before coding when the feature is vague, product-level, or workflow-changing.
2. Write a small plan before touching implementation files for P0 / P1 core flows.
3. Prefer test-first implementation for graph-core, runner-core, storage, reports, driver contracts, semantic locator, and execution APIs.
4. Implement in small vertical slices that can be validated independently.
5. After each slice, run the narrowest relevant test before broader gates.
6. Before closing a task, perform a self-review against product spec, module boundaries, regression risk, and evidence quality.
7. Archive the result by updating tasks, changelog, traceability, and residual-risk notes when applicable.

Do not blindly copy Superpowers mechanics that do not fit this repository:

- Do not require git worktrees while this workspace is not guaranteed to be a git repository.
- Do not require pure TDD for every visual tweak, but do require tests for core behavior and regression-prone flows.
- Do not introduce multi-agent orchestration unless the task is large enough to benefit from parallel review or implementation.
- Do not move product requirements into skill files; skills define process, specs define product behavior.

For this platform, the most important Superpowers rule is evidence-based closure: a task is not done because code was changed; it is done when the changed behavior is tested, documented, and its remaining risk is visible.

## Mapping

| Concept | This Project |
|---|---|
| Product roadmap | `docs/product/mobile-automation-platform/spec/product-plan.md` |
| Requirements | `docs/product/mobile-automation-platform/spec/requirements.md` |
| Technical design | `docs/product/mobile-automation-platform/spec/design.md` and `docs/adr/` |
| Execution plan | `docs/product/mobile-automation-platform/spec/tasks.md` |
| Acceptance | `docs/product/mobile-automation-platform/spec/acceptance.md` |
| Traceability | `docs/product/mobile-automation-platform/spec/traceability.md` |
| Change archive | `docs/product/mobile-automation-platform/spec/changelog.md` and `docs/changelog/` |
| Large change workspace | `docs/changes/<change-id>/` |
| Execution discipline | `skills/agents/` and `skills/skills/` |
| Test evidence | `docs/test/` |

## Why Not Full OpenSpec Migration

Do not migrate the whole project to OpenSpec by default.

Reasons:

- The current REQ / DES / T / AC ids and `traceability.md` are already stable and useful.
- ADRs are first-class architecture records in this project and should stay in `docs/adr/`.
- The project uses Codex as the fixed AI implementation environment, so OpenSpec's multi-tool adapter advantage is less important.
- Full migration would create duplicate specs and slow down product implementation.

Borrow only the parts that fit this repository: lightweight delta change directories and clearer GIVEN-WHEN-THEN acceptance wording for new acceptance criteria.

## Requirement Intake Rule

When the user asks for a new capability, first classify the request before writing code.

### Direct Implementation

Use direct implementation only when the request is already detailed, bounded, and unambiguous.

Examples:

- Move a button or metric to a specific module.
- Fix a named bug or broken interaction.
- Delete or replace a specific text string.
- Adjust a specific layout that is visibly clipped or overlapping.
- Add a small behavior whose inputs, outputs, and acceptance condition are already clear.

For these items, follow the fast-track or normal implementation flow and validate the change.

### Research And Requirement Draft First

Do not directly implement when the request is a product-level capability, a vague goal, or a feature whose workflow is not yet precisely defined.

Examples:

- Package management, smoke testing, execution center, report center, scheduling, notifications, performance baseline, smart assertions, random exploration, or major recording/replay UX changes.
- Any request phrased as a desired outcome rather than a concrete UI / API / data behavior.
- Any feature where mature products are likely to have established interaction patterns or operational safeguards.

Required output before implementation:

1. Research mature products or common industry practice for the same or similar capability.
2. Summarize mainstream approaches, tradeoffs, and what fits this project.
3. Produce a detailed development requirement covering user flow, UI entry points, data model impact, edge cases, test strategy, and acceptance criteria.
4. Record the requirement in the right place: use `docs/changes/<change-id>/` for large deltas, or update the main product spec directly for small accepted changes.
5. Ask the user to confirm key product decisions before implementation.

This rule is project workflow guidance, so its source of truth is this guide and the project skills / agents. Product specs should record the resulting feature requirement, not the meta-rule itself.

## Standard Flow

### 1. Propose

Use this stage for new features, risky refactors, product direction changes, or regressions that affect verified flows.

Required output:

- For large changes, create `docs/changes/<change-id>/` first and write the delta files there.
- For small approved changes, add or update the relevant requirement directly in `requirements.md`.
- Add or update the design in `design.md`, or write `delta-design.md` for large changes.
- Add or update task rows in `tasks.md`, or write `delta-tasks.md` for large changes.
- Add or update acceptance criteria in `acceptance.md`, or write `delta-acceptance.md` for large changes.
- New acceptance criteria should prefer GIVEN-WHEN-THEN wording. Existing AC items do not need a bulk rewrite.
- Update `traceability.md` when adding new REQ / DES / T / AC ids, after the delta is accepted into the main spec.
- Add an ADR when the decision changes architecture, storage, toolchain, runtime data, driver strategy, or deployment.

Small bug fixes may skip new requirement ids, but must still update `tasks.md` or a test report when the issue belongs to the product backlog.

### 2. Plan

Before code changes, convert the approved direction into small implementation steps.

Rules:

- Each task should have a clear boundary, expected files or modules, and validation command.
- Prefer steps that can be completed and tested independently.
- Mark exactly what is in scope and what remains out of scope.
- If the work touches Android driver, dashboard control, runner, recorder, reports, storage, or OCR/image assertions, identify the regression tests first.

### 3. Implement With Tests

Implementation should follow the relevant local skill:

- Core runner, recorder, schema, coordinate, report, or driver contracts: `skills/skills/mobile-automation-tdd/SKILL.md`.
- Android ADB/scrcpy logic: `skills/skills/android-device-driver/SKILL.md`.
- Dashboard UI: `skills/skills/dashboard-ui-dev/SKILL.md`.
- Report and artifacts: `skills/skills/report-generation/SKILL.md`.
- Regression evidence: `skills/skills/regression-testing/SKILL.md`.

Rules:

- Add or update tests before implementation for risky behavior.
- Run the narrowest test first.
- Then run the broader gate, usually `pnpm lint` and `pnpm test:unit`.
- For real-device behavior, add a short manual verification note under `docs/test/reports/` when the result matters for future debugging.

### 4. Review

Every meaningful change should pass two review lenses before closure.

Spec compliance review:

- Does the implementation match the relevant REQ / DES / T / AC?
- Are out-of-scope items still out of scope?
- Did the change accidentally alter a verified main flow?
- Are docs updated for changed behavior?

Code quality review:

- Are module boundaries still clean?
- Are long files or UI state blocks getting worse?
- Are errors and unsupported states explicit?
- Are artifacts, runtime data, and local paths handled safely?
- Are tests meaningful rather than only checking mocks that cannot fail?

### 5. Verify

Minimum verification by change type:

| Change Type | Required Gate |
|---|---|
| Docs only | Read affected links and check references |
| Shared model / runner / storage / reports | `pnpm lint` + `pnpm test:unit` |
| Dashboard UI | `pnpm --filter @mobile-automation/dashboard build` plus relevant unit tests |
| Android control / preview | Unit tests plus real-device smoke when possible |
| iOS control | Unit tests plus WDA smoke when signing is available |
| Report / artifact behavior | Unit tests plus opening a generated report when possible |

### 6. Archive

When a task is complete:

- Mark the task row as `done` in `tasks.md`.
- If the work used `docs/changes/<change-id>/`, merge accepted deltas into the main spec files.
- Add a concise entry to the feature `changelog.md` when product behavior, architecture, or workflow changed.
- Update `traceability.md` for new or changed ids.
- Record residual risks or blocked manual checks in `docs/test/reports/` or the task row.

## Fast-Track Rules

P0 production-style regressions can use a shortened path:

1. Reproduce or define the failing behavior.
2. Add or update a regression test when feasible.
3. Fix the issue.
4. Run the narrow and broad gates.
5. Backfill `tasks.md` / `changelog.md` if the fix affects platform behavior.

Do not use fast-track for new product capabilities, architecture decisions, storage changes, or driver strategy changes.

## Definition Of Done

A development item is done only when:

- The product or technical spec reflects the current behavior.
- Tests cover the changed main logic or the residual manual risk is documented.
- Verification commands have passed or failures are clearly explained.
- Runtime services are restarted when required for manual testing.
- The next task is visible in `tasks.md` or the final response.
