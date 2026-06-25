# Platform

This directory contains the product implementation, reusable packages, tool-managed binaries, and the legacy runtime-data marker directory.

| Directory | Purpose |
|---|---|
| [apps](apps/) | Runnable applications |
| [packages](packages/) | Reusable implementation modules |
| [tools](tools/) | Tool-managed binaries, such as `scrcpy-server` |
| [data](data/) | Legacy marker only; runtime data defaults outside the repo |

Keeping platform code under one directory leaves the repository root focused on three top-level concerns:

- `platform/`: implementation
- `docs/`: product, design, test, and decision knowledge
- `skills/`: project-local AI instructions

Runtime databases and artifacts default to `~/.local/share/mobile-automation/`.
Use `DATA_DIR` to place them on a shared disk, NAS mount, CI workspace, or another server-local directory.
