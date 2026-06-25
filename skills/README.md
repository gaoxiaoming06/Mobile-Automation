# Mobile Automation Skills

This directory stores project-local AI instructions for Mobile-Automation.

## Agents

| Agent | Purpose |
|---|---|
| [feature-pipeline.agent.md](agents/feature-pipeline.agent.md) | Lightweight feature pipeline coordinator |
| [product-manager.agent.md](agents/product-manager.agent.md) | Requirements and acceptance framing |
| [tech-architect.agent.md](agents/tech-architect.agent.md) | Architecture, ADR, and module planning |
| [test-engineer.agent.md](agents/test-engineer.agent.md) | Test-first and regression quality gate |
| [rnd-engineer.agent.md](agents/rnd-engineer.agent.md) | Implementation against spec and tests |

## Skills

| Skill | Purpose |
|---|---|
| [mobile-automation-tdd](skills/mobile-automation-tdd/SKILL.md) | TDD workflow for recorder, runner, reports, and driver contracts |
| [android-device-driver](skills/android-device-driver/SKILL.md) | Android ADB/scrcpy driver implementation guidance |
| [dashboard-ui-dev](skills/dashboard-ui-dev/SKILL.md) | Dashboard UI implementation guidance |
| [report-generation](skills/report-generation/SKILL.md) | HTML report and artifact model guidance |
| [regression-testing](skills/regression-testing/SKILL.md) | Regression test and evidence workflow |

## Use

These files are source-of-truth prompts for future AI development sessions. Keep them short and update them when project conventions change.

## Current Product Direction

- Current mainline: `StructuredFlow` / Smart Recorded Flow.
- New product work defaults to the structured flow path: case library, recording, semantic actions, dynamic waits, step expectations, runtime interceptors, evidence, reports, package smoke, and Flow REST / CLI / MCP.
- BusinessGraph upper-layer work is frozen as experimental: source scanning to global graph, candidate graph governance, target-node route planning, graph-runs, and auto-promotion should not be expanded unless the user explicitly reopens that direction.
- Keep reusable lower-level primitives: `TestRuleStep`, `StateMatcher` / `FlowStateAnchor`, semantic locators, `RuntimeOverlay`, dynamic wait, `RuntimeInterceptor`, screenshots, video, logs, metrics, and report evidence.
