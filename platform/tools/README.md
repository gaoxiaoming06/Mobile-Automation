# Tools

Version-pinned local tool files used by the platform during development.

## scrcpy server

The browser-embedded Android preview/control path uses scrcpy protocol `3.3.3`, so the default server fallback is:

```text
platform/tools/scrcpy-server-v3.3.3
```

You can override it with:

```bash
SCRCPY_SERVER_PATH=/path/to/scrcpy-server pnpm dev
```

The pinned `scrcpy-server-v3.3.3` file is intentionally committed to git because the
browser-embedded stream depends on this protocol version and the file is small.
Versioned `scrcpy-server-*` files in this directory are not ignored by git. When the
embedded client upgrades to another scrcpy protocol version, commit the new pinned
server file and update the code, scripts, and docs in the same change.

Run this before starting the dashboard on a new machine:

```bash
pnpm check:tools
```

Install or refresh the pinned server file with:

```bash
pnpm install:scrcpy-server
```

The local `scrcpy` CLI command is different from this server file. It is an optional host tool used for the native debug window and recording fallback only. The platform must still run browser-embedded preview/control without a locally installed `scrcpy` CLI.
