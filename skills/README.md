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
| [mobile-automation-tdd](skills/mobile-automation-tdd/SKILL.md) | TDD workflow for ScriptFlow, Agent/device contracts, runner, reports, and MCP/CLI |
| [android-device-driver](skills/android-device-driver/SKILL.md) | Android ADB/scrcpy driver implementation guidance |
| [dashboard-ui-dev](skills/dashboard-ui-dev/SKILL.md) | Dashboard UI implementation guidance |
| [report-generation](skills/report-generation/SKILL.md) | HTML report and artifact model guidance |
| [regression-testing](skills/regression-testing/SKILL.md) | Regression test and evidence workflow |

## Use

These files are source-of-truth prompts for future AI development sessions. Keep them short and update them when project conventions change.

## Current Product Direction

- Current mainline: `ScriptFlow v1` for executable test cases and `PageAsset` for page identity.
- New product work defaults to ScriptFlow YAML, deterministic preview/plan digest, explicit parameters, `runFlow` reuse, trial execution, outcome review, report evidence, REST / CLI / MCP integration, and Agent-backed device execution.
- PageAsset answers "what page is this" and stores stable visual/OCR evidence, page variants, and optional public locators. It must not become a hidden action graph, PageTask model, or executable route planner.
- Runtime target resolution should use user-visible text, icon/visual targets, controls, area/position, scope text, OCR, visual candidates, and platform hierarchy evidence. Coordinates and recorded regions are fallback evidence, not the default product contract.
- InteractionAsset, NavigationEntry, FlowVerification, and learning candidates are derived support assets for improving future generation/execution; ScriptFlow remains the source of truth for a test's behavior.
- The historical `graph-core` package now contains page identity and matcher utilities for PageStateService. Do not revive source-code global graph expansion, auto-promotion, PageTransition/PageTask, or graph-first UX unless the user explicitly reopens that direction.
- Device execution goes through Device Agent by default. Keep Android, iOS, and HarmonyOS platform details behind driver/agent contracts and report capability gaps explicitly.
