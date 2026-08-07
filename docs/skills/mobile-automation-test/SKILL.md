---
name: mobile-automation-test
description: Mobile app automation testing through Mobile Automation MCP. Use when validating Android, iOS, Harmony, or Flutter app changes on real devices; generating and running ScriptFlow paths from code, bug reports, or product descriptions; reproducing crashes, ANRs, process deaths, navigation failures, or intermittent mobile bugs; running post-fix regression checks; or when the user asks to run a mobile path, verify a page, reproduce a mobile issue, or perform real-device validation.
---

# Mobile Automation Test

Use Mobile Automation MCP to generate, validate, preview, execute, and report ScriptFlow v1 mobile automation runs.

## Preconditions

- Ensure the Mobile Automation REST server is running. Default URL: `http://127.0.0.1:4010`.
- Ensure the target platform has a connected device when real execution is required.
- Do not use coordinates, `resourceId`, `accessibilityId`, platform-private selectors, or implementation-only component names as action targets.
- Always treat external code analysis as a hint, not as verified UI state.

## Platform Fields

- `scriptPlatform` is for ScriptFlow generation and assets: `android`, `ios`, `harmony`, `flutter`, or `mobile`.
- `devicePlatform` is for the real connected device: `android`, `ios`, or `harmony`.
- `appId` may be `classin` or a concrete app identifier understood by Mobile Automation.
- ScriptFlow YAML should only use `app.id`; do not add `app.platform`.

## Default Workflow

1. Call `get_script_flow_authoring_contract`.
   Use the returned contract as the source of truth for supported actions, target types, examples, and unsupported locator forms.

2. Call `list_devices`.
   Choose an online device whose `platform` matches `devicePlatform` and whose capabilities include at least `screenshot`, `tap`, and `launchApp`.

3. Call `validate_device`.
   Stop immediately if it returns `ok: false`. Report the `code`, `message`, requested platform, and available devices.

4. Build `externalContext` from code, local directories, classin-code MCP, a bug report, or the user request.
   Include concise business facts only:
   - `source`: `code`, `directory`, `classin-code`, or `manual`
   - `summary`: short route or behavior summary
   - `implementationStack`: optional stack such as `android-native`, `ios-native`, `harmony-native`, `flutter`, `compose`, `swiftui`, `arkui`, or `unknown`
   - `relevantFiles`: optional file paths
   - `candidateSteps`: likely user-visible steps
   - `constraints`: execution constraints

5. Prefer `generate_and_run_script_flow` for one-call real-device validation when you only need one platform/device run.
   Required inputs:
   - `goal`
   - `appId`
   - `scriptPlatform`
   - `devicePlatform`
   - `deviceSerial`
   - `externalContext`
   - `responseMode`

6. Use `generate_repair_and_run_script_flow` only when bounded script self-repair is appropriate.
   It may repair script-quality failures such as missing target, ambiguity, page mismatch, or result verification mismatch. Do not use it to hide app crashes, ANRs, process deaths, or device infrastructure failures.

7. If you need to run the exact same generated script on another device/platform, do not call `generate_and_run_script_flow` again.
   Use `run_previous_script_flow` with the first run's `runId` as `sourceRunId`.
   This reuses the stored `sourceYaml`, previews it for a fresh `planDigest`, validates the target device, runs it, waits, and returns the report.

8. If a staged workflow is needed, use:
   `generate_script_flow_draft -> validate_script_flow -> preview_script_flow_draft -> run_script_flow_draft -> wait_for_run -> get_run_report`.
   Pass `responseMode` to `get_run_report`.

9. Return a concise result:
   - selected `deviceSerial`
   - `runId`
   - `status`
   - `reportUrl`
   - `finalScreenshotUrl` for compact checks
   - key `artifactUrls` for evidence/full checks
   - abnormal `events` when returned
   - whether the target page/state appears reached
   - failure reason and evidence when failed

## Response Modes

Use `responseMode` to avoid over-fetching evidence:

- `compact`: best for "just reach this page" checks, batch retries, or token-sensitive loops. Returns status, failed steps, report URL, and final screenshot URL.
- `evidence`: default for normal validation. Returns compact fields plus key evidence URLs, failure summary, and abnormal events.
- `full`: use after a failed run, crash, ANR, process death, locator ambiguity, or when the caller asks for the complete report package. Returns all artifact URLs and full event/failure evidence.

If a compact or evidence run fails and the caller needs debugging detail, call `get_run_report` again with `responseMode: "full"`.

## One-Call Example

Use this shape after replacing platform and device values:

```json
{
  "goal": "从成长页进入全网搜索",
  "appId": "classin",
  "scriptPlatform": "android",
  "devicePlatform": "android",
  "deviceSerial": "REPLACE_WITH_ONLINE_DEVICE_SERIAL",
  "responseMode": "evidence",
  "externalContext": {
    "source": "manual",
    "summary": "成长页顶部存在搜索入口，点击后进入全网搜索页，搜索页有搜索输入框。",
    "candidateSteps": [
      "进入成长 Tab",
      "点击顶部搜索入口",
      "确认出现搜索输入框"
    ],
    "constraints": [
      "不要使用坐标",
      "不要使用 resourceId/accessibilityId",
      "图标目标必须使用 icon 或 visual",
      "文字目标使用 text"
    ]
  },
  "timeoutMs": 120000,
  "pollIntervalMs": 1000
}
```

## Reuse Previous Script Example

Use this when Android passed and you want Harmony/iOS to run the same YAML instead of regenerating a similar-but-different script:

```json
{
  "sourceRunId": "run_FROM_FIRST_DEVICE",
  "devicePlatform": "harmony",
  "deviceSerial": "REPLACE_WITH_ONLINE_DEVICE_SERIAL",
  "responseMode": "compact",
  "timeoutMs": 120000,
  "pollIntervalMs": 1000
}
```

The result includes the new `runId`, `status`, `reportUrl`, final/evidence screenshots according to `responseMode`, plus `sourceRunId`, `sourcePlanDigest`, and the fresh `planDigest`.

## Failure Handling

- `DEVICE_NOT_CONNECTED`, `DEVICE_OFFLINE`, `DEVICE_PLATFORM_MISMATCH`, `DEVICE_SELECTION_REQUIRED`, or `PLATFORM_NOT_SUPPORTED_BY_RUNTIME` means the device precondition failed. Do not generate or run more scripts until the device issue is fixed.
- `needs_clarification` means the route or target is underspecified. Add visible page text, the user-visible path, or target page characteristics, then regenerate.
- Script validation errors mean the YAML is not executable. Regenerate or repair according to `get_script_flow_authoring_contract`; do not add forbidden locator types.
- Locator failures mean the target was missing, ambiguous, unsupported, or visually ungrounded. Report the failure and screenshot evidence before retrying.
- App crash, native crash, ANR, or process death events are product/runtime evidence. Return the event details, screenshots, logs if available, and report URL.
- A passed trial run may still require business outcome review. Only call `review_trial_outcome` after the caller explicitly confirms or rejects the visual/report evidence.

## Quality Rules

- Use `text` for visible OCR text.
- Use `icon` for standard known icon roles.
- Use `visual` for user-described icons/images that are not standard icon roles.
- Use `control` for supported controls such as checkbox, switch, and textField.
- Do not turn a visual target into text just because the icon role is unknown.
- Do not silently rewrite a failed script into a different business path.
- Do not pass secrets or large source files in `externalContext`; summarize instead.
- Prefer trial execution for generated or imported drafts.
