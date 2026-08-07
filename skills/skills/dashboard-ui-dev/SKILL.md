---
name: dashboard-ui-dev
description: Use when implementing Mobile-Automation Dashboard UI: device list, Agent pairing/visibility, realtime preview/control, ScriptFlow case center, AI ScriptFlow generation/editing, run configuration, stability exploration, execution details, reports, settings, or advanced PageAsset tools.
---

# Dashboard UI Dev

Current stack:

- React
- TypeScript
- Vite
- WebSocket for realtime updates

## Main Screens

- Device list.
- Device preview and control.
- ScriptFlow case center.
- AI ScriptFlow generation, manual step editing, preview, trial execution, repair, and outcome review.
- Advanced-only PageAsset calibration and PageAsset library maintenance.
- Stability exploration.
- Run configuration and run controls.
- Run detail.
- Report list and report detail.
- System settings, including AI model settings and Android app monitor defaults.

## UI Rules

- Keep operational UI dense and clear; this is a testing tool, not a landing page.
- Keep ScriptFlow authoring, execution, and report review as the primary product workflow.
- Treat PageAsset UI as advanced calibration/governance. A marked region is evidence for page identity or repair, not a promise to click its center.
- When adding target UI, expose user-facing target intent: text, icon/visual, control, area/position, scope text, ordinal, search policy, and clear coordinate fallback only when unavoidable.
- Keep old source-scan graph screens out of primary navigation unless explicitly requested.
- Show explicit states: loading, empty, online, offline, locked, generating, previewing, running, paused, failed.
- Disable unsupported actions based on `DeviceCapabilities`.
- Preview controls must preserve aspect ratio and expose scale/coordinate metadata for debugging.
- Keep module pages distinct: device management owns device facts and refresh, advanced asset calibration owns page identity edits, ScriptFlow modules own authoring/execution, and run pages own results.
- The case library should show ScriptFlow source status, verification status, typed parameters, preview/plan digest, trial/normal run entry points, recent result, and report links.
- Do not expose `tap_if_text` as a normal step shortcut. Show it as an inserted conditional branch: "when text is visible, tap; otherwise skip".
- For semantic target work, clearly separate coordinate fallback, text, icon/visual, control, area/position, scoped target, search policy, and conditional branch steps.

## Implementation Notes

- scrcpy control message helpers live in `platform/apps/dashboard/src/scrcpy-control.ts`; keep control serialization covered by tests when changing pointer, key, text, or control channel behavior.
- Preview gesture classification lives in `platform/apps/dashboard/src/preview-gesture.ts`; keep tap/long-press/swipe thresholds covered by tests.
- Dashboard state is split across hooks such as `useDeviceList`, `useScrcpyStream`, and `useRunExecution`; prefer component-local helpers over adding new large stateful blocks to `App.tsx`.
- ScriptFlow authoring and draft run UI lives in `AiScriptFlowsPanel`; saved-case execution lives in `CaseCenterPanel`; run result grouping lives in `RunResultsPanel`.
- Step expectation and condition editors live in `StepExpectationPanel` and `StepConditionEditor`; preserve expected/actual, OCR, condition result, and run control display.
- Keep browser preview actions mapped through device coordinates and ratios. UI pixel coordinates are only an input to the shared coordinate conversion path.
- Advanced asset panels live in `AssetRecordingPanel` and `PageAssetsPanel`; ordinary generation, replay, package smoke, and AI / CI validation should point users to ScriptFlow cases and reports.

## Testing

- Component-test key states.
- E2E-test the Mock Driver flow: select device, preview, generate/edit ScriptFlow, preview plan, run, and open report.
- Unit-test changes to `scrcpy-control.ts`, `preview-gesture.ts`, `AiScriptFlowsPanel`, `CaseCenterPanel`, `ScriptRunForm`, and run/result panels before touching live preview or execution flow.
