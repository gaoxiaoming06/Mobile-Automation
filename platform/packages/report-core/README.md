# Report Core

HTML report rendering module.

Current scope:

- Render stored `TestRun` data into a standalone HTML report.
- Summarize status, duration, steps, expectation results, skipped conditions, metrics, app-monitor incidents, abnormal events, and artifacts.
- Link screenshots, logs, videos, metrics, report JSON, and report HTML through stored artifact URLs.
- Handle missing artifacts gracefully and avoid live device or dashboard state.
- Include stability-exploration summaries when the run has a stability config.
