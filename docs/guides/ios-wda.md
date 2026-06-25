---
title: iOS WebDriverAgent Setup
doc_type: guide
status: draft
created_at: 2026-06-05
updated_at: 2026-06-05
---

# iOS WebDriverAgent Setup

iOS preview and control need one working screenshot/control source:

- `idevicescreenshot` for screenshot preview, which may require a matching Developer Disk Image.
- WebDriverAgent (WDA) for screenshot fallback and remote actions.

## Local Checks

```bash
idevice_id --list
idevicepair validate --udid <UDID>
xcrun devicectl device info displays --device <UDID> --timeout 5
curl http://localhost:8100/status
```

The dashboard enables iOS control only when WDA `/status` is reachable.

## Start WDA

This workstation has a WDA project at:

```text
/Users/eeo/Xcode/WebDriverAgent/WebDriverAgent.xcodeproj
```

Start WDA for a connected device:

```bash
xcodebuild test \
  -project /Users/eeo/Xcode/WebDriverAgent/WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner \
  -destination 'id=<UDID>' \
  -allowProvisioningUpdates
```

Expected result: WDA listens on `http://localhost:8100`, and `curl http://localhost:8100/status` returns JSON.

## Current Workstation Diagnosis

For device `00008020-000260113E04002E`:

- Pairing is valid.
- `devicectl` can read display info: `1242 x 2688`, portrait.
- `idevicescreenshot` fails with `Could not start screenshotr service: Invalid service`.
- WDA is not reachable at `http://localhost:8100`.
- `xcodebuild test` fails because Xcode has no logged-in account and no provisioning profile for `com.gaoxm.WebDriverAgentRunner.xctrunner`.

To finish setup, open Xcode and add a developer account, or install a matching provisioning profile for the WDA runner bundle id. After that, rerun the `xcodebuild test` command above.

## Environment

The server auto-detects `http://localhost:8100`. Override when needed:

```bash
export IOS_WDA_URL=http://localhost:8100
export IOS_WDA_URL_00008020_000260113E04002E=http://localhost:8100
export IOS_WDA_AUTODETECT=0
```

Use the UDID-specific variable when multiple iOS devices need different WDA ports.
