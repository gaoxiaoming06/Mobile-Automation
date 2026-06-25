---
title: Test Gate and Mock Driver
doc_type: adr
status: accepted
created_at: 2026-06-04
updated_at: 2026-06-04
related_repos: ["Mobile-Automation"]
related_modules: ["test-support", "shared", "runner-core", "report-core", "android-driver"]
platform_scope: mobile-shared
---

# ADR-005: Test Gate and Mock Driver

- Status: accepted
- Date: 2026-06-04
- Deciders: project owner + Codex
- Related Spec: [requirements.md](../product/mobile-automation-platform/spec/requirements.md#req-025测试保障与回归防护)

## Context

The project will evolve through many changes to recording, replay, preview, reports, and device drivers. Without tests, a later feature can easily break old verified flows.

## Decision

Create a `test-support` package in the first engineering skeleton. It provides Mock Driver, fixtures, builders, and assertions. Core logic changes must be backed by tests.

Required test layers:

- Unit tests for schemas, coordinate conversion, runner state machine, and report generation.
- Integration tests for Recorder, Runner, Metrics, Events, and Report using Mock Driver.
- Component tests for Dashboard views.
- E2E tests using Mock Driver for the record/save/run/report flow.

## Consequences

### Positive

- Regressions are caught before manual Android testing.
- Mock Driver allows stable tests without a real phone.
- Future CI can reuse the same local test commands.

### Negative

- Initial setup takes extra time.
- Mock behavior must be kept close to real driver contracts.

### Neutral

- Real Android smoke tests remain necessary for preview and input validation.

## Alternatives Considered

| Option | Reason Not Chosen |
|---|---|
| Manual testing only | Too risky for recorder/runner/report changes |
| Real-device-only tests | Slow, flaky, and hard to run on every change |
