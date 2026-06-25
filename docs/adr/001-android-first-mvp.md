---
title: Android-first MVP
doc_type: adr
status: superseded
created_at: 2026-06-04
updated_at: 2026-06-05
related_repos: ["Mobile-Automation"]
related_modules: ["android-driver", "dashboard", "server", "runner-core"]
platform_scope: android
superseded_by: "006-incremental-ios-support"
---

# ADR-001: Android-first MVP

- Status: superseded by [ADR-006: Incremental iOS Support](006-incremental-ios-support.md)
- Date: 2026-06-04
- Deciders: project owner + Codex
- Related Spec: [mobile automation platform](../product/mobile-automation-platform/README.md)

## Context

The platform targets Android and iOS eventually, but the first milestone needs a complete, usable loop: device discovery, preview, remote control, recording, step editing, replay, metrics, abnormal event capture, and HTML report generation.

iOS real-device control depends on additional signing and automation infrastructure. Building both platforms at once would delay the first usable MVP.

## Decision

The MVP implements Android-only end to end. iOS is kept as a second-stage roadmap item and should not block Android delivery.

## Consequences

### Positive

- Faster MVP delivery.
- Android ADB and scrcpy provide a practical control and preview path.
- The team can validate the recorder, runner, report, and test model before adding iOS complexity.

### Negative

- Cross-platform parity is deferred.
- Some abstractions must be designed now even though only Android implements them.

### Neutral

- The codebase may keep an `ios-driver` placeholder, but no iOS functionality is required in the first release.

## Alternatives Considered

| Option | Reason Not Chosen |
|---|---|
| Android + iOS full MVP | Higher risk and slower first delivery |
| iOS first | Less aligned with current implementation simplicity |
