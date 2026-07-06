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

- Current mainline: `PageStateFlow`.
- New product work defaults to page assets and semantic execution: `PageModel`, `PageElement`, `PageTransition`, `PageTask`, page matching, semantic locators, route planning, repair evidence, reports, package smoke, and REST / CLI / MCP integration.
- PageElement execution must relocate at runtime through OCR, visual template/candidates, or structural locator evidence. Do not default to `region_center`; keep recorded regions and centers as evidence for reports and repair UI.
- Dynamic list work should model `dynamicRegion`, `itemTemplate`, `parameterMapping`, `locatorKind`, and `dynamicMasks` first. Do not expand every real list item into a fixed PageElement.
- `StructuredFlow` / Smart Recorded Flow remains a compatible linear execution artifact for replaying concrete steps, but it is no longer the product-level source of truth.
- `BusinessGraph` remains the lower-level graph storage and route-planning model behind PageStateFlow. Do not revive source-code global graph expansion, auto-promotion, or old graph-first UX unless the user explicitly reopens that direction.
- Keep reusable lower-level primitives: `TestRuleStep`, `StateMatcher` / `FlowStateAnchor`, semantic locators, `RuntimeOverlay`, dynamic wait, `RuntimeInterceptor`, screenshots, video, logs, metrics, and report evidence.
