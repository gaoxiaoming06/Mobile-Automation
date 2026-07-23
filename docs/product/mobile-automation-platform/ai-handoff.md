---
title: AI / New Contributor Handoff
doc_type: guide
status: draft
owner: TODO(confirm): owner team unknown
created_at: 2026-07-23
updated_at: 2026-07-23
related_repos: ["Mobile-Automation"]
related_modules: ["platform/apps/dashboard", "platform/apps/server"]
platform_scope: mobile-both
related_platforms: ["Android", "iOS", "Web Dashboard"]
---

# AI / New Contributor Handoff

This page is the first context check for a new engineer or AI agent before changing the Mobile Automation product. It captures the current product truth so legacy names in code do not accidentally drive new work.

## Current Product Truth

The current main line is PageStateFlow: asset-driven mobile testing based on confirmed page assets, page elements, page transitions, page tasks, runtime parameters, and execution reports.

Dashboard primary entries are:

| UI entry | `activeNavItem` | Current role |
|---|---:|---|
| 设备管理 | `devices` | Device selection and run overview |
| 设备详情 | `deviceDetails` | Device preview and manual control |
| 资产录入 | `assetRecording` | Confirm PageModel, PageElement, PageTransition, and PageTask assets |
| 页面资产库 | `pageAssets` | Inspect and govern saved page assets; no execution entry |
| 资产用例 | `assetComposition` | Manage parameter data, meta-functions, and composite asset cases |
| AI资产用例 | `freeComposition` | Natural-language entry that compiles existing assets into a temporary executable asset case |
| 资产驱动巡检 | `assetPatrol` | Validate existing page assets, elements, transitions, and tasks |
| 稳定性探索 | `stability` | Controlled exploration and stability diagnostics |
| 执行结果 | `runs` | Run history and reports |

Do not infer the current product flow from historical docs or stale component names. The legacy linear recording UI has been removed from Dashboard: `StepsPanel`, `StepList`, `CaseLibraryPanel`, `useRecorder`, and `recording.ts` should not reappear as primary entry points. `/api/runs` remains only for run history/control and compatibility with lower-level execution plumbing.

Current tests are asset-driven. A user-facing run should normally start from confirmed assets through AI asset cases, saved asset composite cases, or asset patrol.

## Execution Integration Rule

When adding a run option, monitor, report field, parameter behavior, or execution policy, trace the complete user path first:

1. Identify the actual Dashboard entry used by the target user.
2. Trace UI component -> REST request payload -> server route -> execution manager -> runner / graph runner -> report artifact.
3. Add or update tests for that primary entry before accepting the feature.
4. Verify the running Dashboard path in the browser or with a captured screenshot.
5. Only then update legacy recording / `/api/runs` compatibility paths if the feature should support them too.

For asset-driven execution, the important chains are:

| User path | Expected integration chain |
|---|---|
| AI资产用例 | `FreeCompositionPanel` -> `/api/free-composition/sessions/:id/execute` -> `AssetCompositeExecutionManager` -> `GraphRunService` |
| 资产用例 | `AssetCompositionPanel` -> `/api/asset-composition/cases/:id/execute` -> `AssetCompositeExecutionManager` -> `GraphRunService` |
| 资产驱动巡检 | `AssetPatrolPanel` -> asset patrol API -> `AssetPatrolRunner` / graph run support |

If a feature is only wired through `/api/runs`, it is only available to compatibility callers unless the asset paths above also pass the same configuration.

## AI资产用例 Parameter Guardrail

AI资产用例 must not claim success merely because the selected candidate has no missing parameters.

Before showing a ready state, check:

- whether the selected candidate actually consumes the runtime parameters detected from the prompt;
- whether a better candidate exists that consumes those parameters, such as a PageTask or meta-function;
- whether unused runtime parameters should be surfaced as a warning, for example `当前候选未使用参数：phone`;
- whether the prompt should be treated as ambiguous and require user confirmation.

Example: `切换登录账号为18743085313` should prefer the login PageTask / meta-function that consumes `phone` and `password`, not a parameterless `登录按钮 -> 主页` transition.

## Review Checklist

Use this checklist before marking a task done:

- The primary UI entry is named explicitly in the task or PR notes.
- The code path was verified from UI to backend, not inferred from a `rg` hit.
- New execution options are covered in the asset-driven path first when the feature is for current PageStateFlow usage.
- Legacy names are either renamed, documented as legacy, or isolated behind compatibility wording.
- Acceptance evidence includes the actual request payload or report artifact from the primary path.
- The user-facing copy distinguishes "selected candidate ready" from "user intent fully satisfied".
