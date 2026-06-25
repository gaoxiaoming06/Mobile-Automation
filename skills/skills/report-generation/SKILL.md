---
name: report-generation
description: Use when implementing Mobile-Automation HTML reports, report data models, performance charts, step evidence, exception events, or artifact retention.
---

# Report Generation

MVP report format:

- Web report detail.
- HTML export.
- Raw JSON may exist internally for regeneration and future CI.
- PDF is out of MVP scope.

## Report Must Include

- Run summary.
- Device and app information.
- Run configuration snapshot.
- Test case snapshot.
- Iteration and step results.
- Step expectation expected/actual/status details.
- Conditional step metadata: condition hit/miss, attempts, skipped reason, and evidence.
- Screenshots or key artifacts.
- Execution video for every run, linked from the report and step evidence when possible.
- Metrics summary and timeline.
- Crash, ANR, command failure, timeout, and device-lost events.

## Rules

- Generate reports from stored run data, not live UI state.
- Every failure should link to step, event, screenshot/log artifact when available.
- Do not hardcode local absolute paths in report data.
- Store artifacts under `<DATA_DIR>/artifacts/runs/<runId>/`; `DATA_DIR` defaults to `~/.local/share/mobile-automation`.

## Tests

- Successful run report.
- Failed step report.
- Failed expectation report.
- Optional skipped condition step report.
- Device lost report.
- Event with screenshot/log artifact.
- Missing artifact graceful rendering.
