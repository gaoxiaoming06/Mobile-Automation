# Test Support

Testing utilities for stable regression coverage.

Current contents:

- `MockDriver` with a stable Android-like device.
- Screenshot, foreground app, action, clear-data, log, metric, and video-recording fakes.
- A `createTapStep()` builder for coordinate-heavy runner and report tests.

Keep this package small and deterministic. Prefer adding focused fixtures here when tests need shared driver behavior instead of duplicating local fakes across server, runner, and report tests.
