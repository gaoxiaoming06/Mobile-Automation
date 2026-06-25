# Artifacts

Legacy artifact directory for local development.

Runtime artifacts now default to `~/.local/share/mobile-automation/artifacts/` and can be redirected with `DATA_DIR`.

Expected structure:

```text
<DATA_DIR>/artifacts/
  runs/<runId>/
    screenshots/
    logs/
    metrics/
    videos/
    reports/
```
