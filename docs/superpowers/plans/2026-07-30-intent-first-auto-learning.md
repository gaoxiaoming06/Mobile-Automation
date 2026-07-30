# Intent-First Generation And Automatic Learning Plan

**Date:** 2026-07-30

## Goal

Make the primary workflow:

1. The user describes a test in natural language.
2. The system generates an executable test while preserving every explicit operation.
3. The user runs it with one action.
4. The system verifies the business outcome and learns reusable evidence internally.

The user should not need to understand ScriptFlow syntax, choose asset candidates, or
manually maintain navigation data.

## Product Rules

### Request interpretation

Interpret the request segment by segment instead of assigning one mode to the entire
sentence.

- Explicit operations are hard constraints. Preserve their order and operation type.
- Explicit outcomes are assertions, not permission to rewrite preceding operations.
- Vague destination requests may use verified use cases and navigation knowledge.
- Mixed requests preserve explicit operations and fill only vague gaps.
- If a vague gap cannot be resolved, ask for the missing operation sequence. Do not guess.

Precedence:

`explicit operation > explicit outcome > verified use case/navigation > generic inference > no guess`

Generation must not inspect or change the live device. Live page recognition and recovery
belong to execution.

### Execution and verification

- All generated tests use the same visible Execute action.
- The backend may internally choose verified execution or first-run validation.
- A run is reusable evidence only after technical success and business-outcome verification.
- When the script has a deterministic oracle, successful verification may complete
  automatically.
- When no deterministic oracle exists, ask only whether the expected business result was
  achieved.

### Automatic learning

Learning is internal. Do not show candidate checkboxes or require users to accept assets.

An interaction or navigation candidate can be promoted automatically only when all of the
following hold:

- The run and business outcome are verified.
- Candidate status is validated.
- Confidence meets the strict threshold.
- Evidence artifacts exist.
- The locator is semantic or visual and contains no coordinate-only constraint.
- The value is not a likely account, password, phone number, email address, timestamp, or
  other dynamic test data.
- The candidate is scoped to the same App ID and platform.

Otherwise keep the candidate as internal evidence. Repeated verified observations may raise
its confidence in a later iteration; they must not pollute the active catalog immediately.

### Asset boundaries

- Page identity assets verify states.
- Interaction assets help locate reusable controls within a page.
- Navigation entries are derived from verified executions.
- Saved tests remain an explicit user decision in the use-case center.
- Every asset and test is isolated by App ID and platform.

## Implementation Steps

### 1. Enforce explicit-operation preservation

Add a deterministic intent contract beside the AI prompt:

- Extract unambiguous operations such as tap, input, clear, swipe, launch, and restart.
- Flatten generated ScriptFlow steps.
- Verify that compatible direct actions appear in the same order.
- Reject a draft where `reachPage` or `runFlow` replaces a user-described direct action.
- Include the contract in repair feedback so the model can regenerate a valid draft.

This validation is deliberately narrower than full language understanding. It protects the
high-risk boundary without replacing the AI planner with another rules engine.

### 2. Add the automatic-learning policy

Create a pure policy module that returns an explicit accept/reject decision and reason.
Use it after:

- a run passes with an automatic oracle; or
- the user confirms a run without an automatic oracle.

Reuse the existing atomic asset-promotion path. The policy chooses eligible candidates; the
storage layer still enforces deduplication, App/platform scope, and forbidden locator checks.

### 3. Simplify the execution UI

For AI generation and the use-case center:

- Rename all visible trial actions to Execute/Start Execution.
- Remove candidate-review and manual asset-promotion controls.
- Keep business-outcome confirmation only when required.
- Present concise execution status and link to the report.

The internal trial API may remain for now because it encodes verification semantics, not a
separate user workflow.

### 4. Harden App isolation

Add regression coverage showing that assets, navigation entries, and planner catalogs from
one App ID or platform cannot appear in another context.

### 5. Verification

Run focused planner, learning policy, storage, and dashboard tests first. Then run the full
Vitest suite and workspace type checking. Restart the API and dashboard services and verify
their health endpoints/pages.

## Deliberate Non-Goals For This Change

- No legacy asset compatibility layer.
- No user-facing ScriptFlow editor.
- No automatic saving of every successful test to the use-case center.
- No speculative promotion of low-confidence icon or dynamic-text targets.
- No cross-App asset reuse until a product-level App Profile explicitly binds platform IDs.

## Follow-Up

Asset aging and self-healing should build on run failure diagnostics:

1. Detect that a failed locator came from a promoted interaction asset.
2. Try the generic semantic/visual locator path without that asset.
3. If fallback succeeds and the outcome verifies, replace the stale evidence atomically.
4. If fallback fails, report the exact operation that needs a new description.

This is separate from first-run learning so the initial change remains testable and does not
mix promotion policy with recovery policy.
