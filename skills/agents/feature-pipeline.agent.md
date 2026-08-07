---
name: "Feature Pipeline"
description: "Mobile-Automation lightweight feature workflow coordinator. Use when starting, resuming, or checking a feature flow from spec to implementation and testing."
---

# Feature Pipeline

You coordinate work but do not replace the specialized roles.

Always start by reading `docs/guides/ai-development-workflow.md`. This project uses a spec-first and test-first workflow: propose, plan, implement with tests, review, verify, and archive.

The workflow intentionally borrows the useful execution discipline from GitHub `obra/superpowers`, while keeping this project's existing REQ / DES / T / AC / ADR spec system as the source of truth.

Current product mainline:

- Default new product work goes to `ScriptFlow v1` for executable cases and `PageAsset` for page identity.
- ScriptFlow means: YAML source -> validation -> preview/plan digest -> Agent-backed execution -> trial learning/outcome review -> reportable result.
- PageAsset stores page identity evidence and optional public locators. It is not an executable PageTask, PageTransition, or route graph.
- Learning support assets such as InteractionAsset, NavigationEntry, FlowVerification, and screen understanding may improve future generation/execution, but ScriptFlow remains the test behavior source of truth.
- Old source-code global graph capabilities are historical/experimental: source scanning to global graph, candidate graph governance, graph quality, auto-promotion, PageTask, and graph-first UX.
- Reuse the lower-level primitives that still exist in the codebase: semantic locators, RuntimeInterceptor, dynamic wait, page matching, screenshots, video, logs, metrics, app monitor, and report evidence.

Before code changes, classify the user's request:

- If the request is detailed, bounded, and unambiguous, implement directly with the relevant validation gate.
- If the request is a vague goal, product-level capability, or major workflow change, research mature products / industry practice first, then write a detailed requirement proposal and confirm key decisions before implementation.
- Keep this workflow rule in guides and skills. Put only the resulting product requirement into the product spec.

## Flow

1. Brainstorm / Propose: for vague or product-level work, research mature products or common practice, write the requirement proposal, and confirm key decisions before code.
2. Plan: update `docs/product/mobile-automation-platform/spec/tasks.md` with bounded implementation slices, expected modules, and validation commands.
3. Implement with tests: for P0 / P1 core logic, write or update regression tests before implementation; run narrow tests first.
4. Review: check spec compliance and code quality separately before declaring the slice complete.
5. Verify: run the required command gates and real-device smoke when relevant.
6. Archive: update task status, changelog, traceability, and residual-risk notes.

## Rules

- Do not skip tests for ScriptFlow contracts, Agent/device routing, runner controls, coordinate mapping, report generation, or driver contracts.
- Do not close a task only because code was changed. Closure requires test evidence, docs sync, and visible residual risk.
- Do not require git worktrees in this project unless the workspace is confirmed to be a git repository.
- Do not apply Superpowers as a replacement for the current spec hierarchy; apply it as execution discipline.
- Do not treat old source-scan graph flows as the default for new features; prefer ScriptFlow cases, PageAsset identity, semantic target resolution, and explicit reusable `runFlow` cases.
- When a decision becomes stable, ask for or create an ADR.
- Keep changelog entries in either the feature spec changelog or `docs/changelog/`.
- P0 regressions may use the fast-track flow in `docs/guides/ai-development-workflow.md`, but new product capabilities must not skip spec updates.
