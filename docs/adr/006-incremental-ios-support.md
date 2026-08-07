---
title: Incremental iOS Support
doc_type: adr
status: accepted
created_at: 2026-06-05
updated_at: 2026-08-07
related_repos: ["Mobile-Automation"]
related_modules: ["ios-driver", "server", "dashboard", "runner-core", "device-agent"]
platform_scope: ios
---

# ADR-006: Incremental iOS Support

- Status: accepted
- Date: 2026-06-05
- Deciders: project owner + Codex
- Related Spec: [mobile automation platform](../product/mobile-automation-platform/README.md)

Current note: iOS support now runs through the same Device Agent device-access model as Android and HarmonyOS. WDA is still explicitly configured on the Agent host through `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.

## Context

The Android path already provides the complete browser-operated automation loop. The platform now needs iOS device visibility without destabilizing the Android MVP or pretending that iOS has the same native tooling guarantees.

iOS physical-device control requires WebDriverAgent signing, device trust, and per-device service availability. Screenshot preview and basic device metadata can be implemented with host tools before full parity.

## Decision

Add an incremental iOS driver beside the Android driver:

- Use `libimobiledevice` tools for online device discovery, metadata, screenshot capture, and battery sampling.
- Use `xcrun xctrace list devices` as a fallback to surface paired offline iOS physical devices.
- Filter host Mac and simulator entries from the physical-device dashboard path.
- Use WebDriverAgent only when explicitly configured through `IOS_WDA_URL` or `IOS_WDA_URL_<UDID>`.
- Report iOS capabilities per device so the dashboard can disable unsupported actions.

## Consequences

### Positive

- iOS devices can appear in the same dashboard as Android devices.
- Online trusted iOS devices can use screenshot preview.
- WDA-enabled devices can use the same recorder and replay path for supported actions.
- Android scrcpy performance and browser embedding remain unchanged.

### Negative

- iOS preview is screenshot polling, not a low-latency stream.
- WDA setup is still an external prerequisite.
- iOS video recording, crash logs, and full performance metrics remain future work.

### Neutral

- Simulators are intentionally excluded from this physical-device flow until a separate simulator driver path is designed.
