# Data

Legacy local runtime data directory.

Runtime databases, screenshots, videos, logs, reports, and other artifacts now default to:

```text
~/.local/share/mobile-automation/
```

Override the runtime data root with:

```bash
DATA_DIR=/path/to/mobile-automation-data pnpm dev
```

This directory should stay empty unless a developer intentionally points `DATA_DIR` back into the repository for debugging. Do not commit generated runtime data unless it is a small fixture intentionally used by tests.
