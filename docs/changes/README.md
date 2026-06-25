---
title: Change Workspaces
doc_type: change-index
status: draft
created_at: 2026-06-08
updated_at: 2026-06-08
---

# Change Workspaces

This directory stores lightweight delta workspaces for large feature changes.

The main source of truth remains:

- `docs/product/mobile-automation-platform/spec/requirements.md`
- `docs/product/mobile-automation-platform/spec/design.md`
- `docs/product/mobile-automation-platform/spec/tasks.md`
- `docs/product/mobile-automation-platform/spec/acceptance.md`
- `docs/product/mobile-automation-platform/spec/traceability.md`

Use `docs/changes/<change-id>/` only when a change is large enough that reading or editing the full spec would make review noisy.

## Suggested Layout

```text
docs/changes/<change-id>/
  proposal.md             # Why this change exists, scope, non-goals
  delta-requirements.md   # Added or modified REQ items only
  delta-design.md         # Added or modified DES items only
  delta-tasks.md          # New or changed tasks only
  delta-acceptance.md     # New AC items, preferably GIVEN-WHEN-THEN
  verify.md               # Verification commands, evidence, residual risk
```

## Rules

- Keep stable ids from the main spec, such as `REQ-034`, `DES-034`, `T-049`, and `AC-031`.
- Do not create a second numbering system.
- Do not move ADRs into this directory; architecture decisions stay in `docs/adr/`.
- After implementation, merge accepted deltas back into the main spec files and record the result in the feature changelog.
- Small fixes and P0 regressions can skip `docs/changes/` and use the fast-track flow in `docs/guides/ai-development-workflow.md`.
