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
- PageStateFlow asset recording and page task execution.
- StructuredFlow detail and step detail for compatible linear replay artifacts.
- Run configuration.
- Run detail.
- Report list and report detail.
- Experimental graph module.

## UI Rules

- Keep operational UI dense and clear; this is a testing tool, not a landing page.
- Keep PageStateFlow asset recording, page abilities, page tasks, and semantic execution as the primary product workflow.
- When adding or editing PageElement UI, expose locator intent (`text_locator`, `visual_locator`, `structural_locator`, `collection_item_locator`) and dynamic masks when relevant. A marked region is evidence, not a promise to click its center.
- For dynamic lists or grids, model the container and item template (`dynamicRegion`, `itemTemplate`, `parameterMapping`) before adding planner behavior. Do not encourage users to save each concrete row/card as a separate fixed element.
- Keep old source-scan graph screens visually and semantically experimental; do not make source-code graph construction or auto-promotion the primary navigation path unless explicitly requested.
- Show explicit states: loading, empty, online, offline, locked, recording, running, failed.
- Disable unsupported actions based on `DeviceCapabilities`.
- Preview controls must preserve aspect ratio and expose scale/coordinate metadata for debugging.
- Keep module pages distinct: device management owns device facts and refresh, recording owns live preview, execution owns run control and results.
- The case library should show structured steps: beforeState, semantic action, afterExpectations, systemGuards, recent result, and execution-to-step options.
- Do not expose `tap_if_text` as a normal step shortcut. Show it as an inserted conditional branch: "when text is visible, tap; otherwise skip".
- For semantic target work, clearly separate coordinate, element, text, image/region, structural locator, collection item, and conditional branch steps.

## Implementation Notes

- Step recording helpers live in `platform/apps/dashboard/src/recording.ts`; reuse `createRecordedStep()` and `renumberSteps()` instead of rebuilding step objects in `App.tsx`.
- scrcpy control message helpers live in `platform/apps/dashboard/src/scrcpy-control.ts`; keep control serialization covered by tests when changing pointer, key, text, or control channel behavior.
- Preview gesture classification lives in `platform/apps/dashboard/src/preview-gesture.ts`; keep tap/long-press/swipe thresholds covered by tests.
- Dashboard state is split across hooks such as `useDeviceList`, `useScrcpyStream`, `useRecorder`, and `useRunExecution`; do not add new large stateful blocks to `App.tsx`.
- Step expectation and condition editors live in `StepsPanel`; changes there should preserve expected/actual, OCR, condition result, and run control display.
- Keep browser preview actions mapped through device coordinates and ratios. UI pixel coordinates are only an input to the shared coordinate conversion path.
- Old graph UI components can remain available for experiments, but ordinary recording, replay, package smoke, and AI / CI validation should point users to PageStateFlow assets and page tasks.

## Testing

- Component-test key states.
- E2E-test the Mock Driver flow: select device, preview, record, save, run, report.
- Unit-test changes to `recording.ts` and `scrcpy-control.ts` before touching the live preview or recorder flow.
