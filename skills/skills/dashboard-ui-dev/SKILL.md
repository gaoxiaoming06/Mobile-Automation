---
name: dashboard-ui-dev
description: Use when implementing Mobile-Automation Dashboard UI: device list, preview page, recorder, step editor, run configuration, execution details, or report pages.
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
- Recorder and live step list.
- StructuredFlow case library and case execution.
- StructuredFlow detail and step detail.
- Run configuration.
- Run detail.
- Report list and report detail.
- Experimental graph module.

## UI Rules

- Keep operational UI dense and clear; this is a testing tool, not a landing page.
- Keep StructuredFlow / Smart Recorded Flow as the primary product workflow.
- Keep the graph module visually and semantically experimental; do not make BusinessGraph, source scanning, target-node route planning, or graph-runs the primary navigation path unless explicitly requested.
- Show explicit states: loading, empty, online, offline, locked, recording, running, failed.
- Disable unsupported actions based on `DeviceCapabilities`.
- Preview controls must preserve aspect ratio and expose scale/coordinate metadata for debugging.
- Keep module pages distinct: device management owns device facts and refresh, recording owns live preview, execution owns run control and results.
- The case library should show structured steps: beforeState, semantic action, afterExpectations, systemGuards, recent result, and execution-to-step options.
- Do not expose `tap_if_text` as a normal step shortcut. Show it as an inserted conditional branch: "when text is visible, tap; otherwise skip".
- For semantic target work, clearly separate coordinate, element, text, image/region, and conditional branch steps.

## Implementation Notes

- Step recording helpers live in `platform/apps/dashboard/src/recording.ts`; reuse `createRecordedStep()` and `renumberSteps()` instead of rebuilding step objects in `App.tsx`.
- scrcpy control message helpers live in `platform/apps/dashboard/src/scrcpy-control.ts`; keep control serialization covered by tests when changing pointer, key, text, or control channel behavior.
- Preview gesture classification lives in `platform/apps/dashboard/src/preview-gesture.ts`; keep tap/long-press/swipe thresholds covered by tests.
- Dashboard state is split across hooks such as `useDeviceList`, `useScrcpyStream`, `useRecorder`, and `useRunExecution`; do not add new large stateful blocks to `App.tsx`.
- Step expectation and condition editors live in `StepsPanel`; changes there should preserve expected/actual, OCR, condition result, and run control display.
- Keep browser preview actions mapped through device coordinates and ratios. UI pixel coordinates are only an input to the shared coordinate conversion path.
- Graph UI components can remain available for experiments, but ordinary recording, replay, package smoke, and AI / CI validation should point users to StructuredFlow.

## Testing

- Component-test key states.
- E2E-test the Mock Driver flow: select device, preview, record, save, run, report.
- Unit-test changes to `recording.ts` and `scrcpy-control.ts` before touching the live preview or recorder flow.
