# CLI

Small REST-backed command-line helper for Mobile Automation.

Current commands:

- `devices`: list visible devices.
- `flows`: list ScriptFlow use cases.
- `preview-flow`: compile a saved flow and return the `planDigest`.
- `run-flow`: run a saved flow with a previously previewed plan digest.
- `runs`: list recent runs.
- `status`: show one run's status.
- `report`: print the HTML report URL when ready.

Use `--server <url>` or `AUTOTEST_SERVER_URL` to point at a non-default server.
