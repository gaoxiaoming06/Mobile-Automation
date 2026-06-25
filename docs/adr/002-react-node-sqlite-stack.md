---
title: React Node SQLite Stack
doc_type: adr
status: accepted
created_at: 2026-06-04
updated_at: 2026-06-04
related_repos: ["Mobile-Automation"]
related_modules: ["dashboard", "server", "shared"]
platform_scope: mobile-shared
---

# ADR-002: React + Node.js + SQLite Stack

- Status: accepted
- Date: 2026-06-04
- Deciders: project owner + Codex
- Related Spec: [design.md](../product/mobile-automation-platform/spec/design.md)

## Context

The platform is a realtime dashboard plus device-control backend. It needs shared action models, WebSocket updates, subprocess control, local artifact storage, and fast iteration.

## Decision

Use:

- Frontend: React + TypeScript + Vite
- Backend: Node.js + TypeScript
- Realtime: WebSocket
- MVP storage: SQLite + filesystem artifacts
- Later storage: PostgreSQL + object storage if the project becomes multi-user or long-running

## Consequences

### Positive

- Frontend and backend can share TypeScript models such as `ActionStep`, `RunConfig`, and `TestReport`.
- Node.js is a good fit for WebSocket and subprocess orchestration.
- SQLite keeps MVP setup light.

### Negative

- Backend must maintain discipline as orchestration grows.
- Long-running reports and metrics may eventually require PostgreSQL or a time-series strategy.

### Neutral

- Docker Compose is deferred to stage two; local host execution is preferred for USB/ADB access in MVP.

## Alternatives Considered

| Option | Reason Not Chosen |
|---|---|
| Python FastAPI backend | Good scripting fit, but weaker shared type model with frontend |
| Java/Spring backend | Stable but heavier for MVP |
| Electron desktop app | Good local access, weaker fit for future shared Web panel |
