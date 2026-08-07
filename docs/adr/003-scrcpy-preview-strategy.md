---
title: Android Preview Strategy
doc_type: adr
status: accepted
created_at: 2026-06-04
updated_at: 2026-08-07
related_repos: ["Mobile-Automation"]
related_modules: ["android-driver", "dashboard", "server", "device-agent"]
platform_scope: android
---

# ADR-003: scrcpy-first Android Preview Strategy

- Status: accepted
- Date: 2026-06-04
- Deciders: project owner + Codex
- Related Spec: [mobile automation platform](../product/mobile-automation-platform/README.md)

Current note: this ADR still governs Android preview, but the scrcpy process and device-specific work now run through the Device Agent. The server brokers the stream to the dashboard and screenshot polling remains the fallback.

## Context

The dashboard must show the current Android device screen and allow actions from the preview. Preview latency, frame rate, and coordinate correctness directly affect recording quality.

## Decision

Use scrcpy as the preferred Android preview/control foundation. Keep ADB screenshot polling as a fallback for early integration, debugging, and devices where scrcpy fails.

## Consequences

### Positive

- scrcpy is mature for Android mirroring and low-latency screen updates.
- It avoids building a preview protocol from scratch.
- ADB screenshot polling provides a simple fallback path.

### Negative

- Integrating scrcpy into a Web panel may require stream adaptation.
- The project must manage scrcpy process lifecycle and errors.

### Neutral

- minicap/minitouch can be revisited only if scrcpy is unsuitable.

## Alternatives Considered

| Option | Reason Not Chosen |
|---|---|
| ADB screenshot polling as primary | Simple but too slow for comfortable recording |
| minicap/minitouch | Useful historically, but more maintenance risk |
| Full Appium-only preview/control | Better for UI automation, not ideal for live visual dashboard MVP |
