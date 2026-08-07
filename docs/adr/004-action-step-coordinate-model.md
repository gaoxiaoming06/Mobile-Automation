---
title: Action Step Coordinate Model
doc_type: adr
status: accepted
created_at: 2026-06-04
updated_at: 2026-08-07
related_repos: ["Mobile-Automation"]
related_modules: ["shared", "runner-core", "dashboard"]
platform_scope: mobile-shared
---

# ADR-004: ActionStep Coordinate Model

- Status: accepted
- Date: 2026-06-04
- Deciders: project owner + Codex
- Related Spec: [ScriptFlow v1](../product/mobile-automation-platform/spec/script-flow-v1.md)

Current note: coordinate replay remains supported as execution data, but current ScriptFlow authoring must prefer semantic targets such as text, icon, visual, control, area/position, nearby text, and scope text. Coordinates must not become the primary product contract for AI-generated actions.

## Context

Recorded steps must survive preview scaling, browser layout changes, device rotation, and similar Android device resolutions. Raw pixel coordinates alone are fragile.

## Decision

Each coordinate-based step stores both absolute device coordinates and normalized ratios. Replay prefers normalized coordinates and resolves them against the target device resolution and orientation.

## Consequences

### Positive

- More robust across preview sizes and similar device resolutions.
- Easier to debug because reports can show both raw coordinates and ratios.
- Keeps the model compatible with future image/OCR/control-tree locators.

### Negative

- Coordinate conversion must be carefully tested.
- Very different layouts or resolutions can still break coordinate replay.

### Neutral

- Later locator strategies should add fields rather than replace the coordinate model.

## Alternatives Considered

| Option | Reason Not Chosen |
|---|---|
| Absolute coordinates only | Too fragile under scaling and device differences |
| Control-tree locator first | Higher complexity, not required for Android visual MVP |
| OCR/image locator first | Useful later, but heavy for first release |
