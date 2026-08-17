import { describe, expect, it } from "vitest";
import { renderReportHtml } from "./index.js";
import type { TestRun } from "@mobile-automation/shared";

describe("renderReportHtml", () => {
  it("renders run summary and status", () => {
    const run: TestRun = {
      id: "run-1",
      caseName: "Smoke",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z"
    };

    expect(renderReportHtml(run)).toContain("Smoke");
    expect(renderReportHtml(run)).toContain("passed");
  });

  it("renders the frozen execution profile used by the run", () => {
    const run: TestRun = {
      id: "run-profile",
      caseName: "Profile Evidence",
      deviceSerial: "device-1",
      status: "failed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [],
      artifacts: [],
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "flow-profile",
        version: 2,
        planDigest: "a".repeat(64),
        executionPlatform: "android",
        executionProfile: {
          id: "execution-profile:classin:android:graph-v7",
          appId: "cn.eeo.classin",
          platform: "android",
          version: 7,
          status: "verified",
          digest: "f".repeat(64),
          createdAt: "2026-08-15T00:00:00.000Z",
          screens: [{
            screenRef: "classin.home",
            name: "班级主页",
            assetId: "page-home",
            graphVersionId: "graph-v7",
            evidence: [{ id: "home-title", type: "resource_id", value: "home_title", weight: 1 }]
          }]
        },
        dependencies: [],
        parsed: {}
      },
      startedAt: "2026-08-15T00:00:00.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("执行校验标准");
    expect(html).toContain("execution-profile:classin:android:graph-v7");
    expect(html).toContain("版本 7");
    expect(html).toContain("已冻结 1 个页面校验合同");
    expect(html).toContain("ffffffffffffffff");
  });

  it("renders fixed delay wait source steps with a readable title", () => {
    const run: TestRun = {
      id: "run-wait",
      caseName: "Wait",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [{
        id: "wait-after-submit",
        order: 1,
        type: "wait",
        enabled: true,
        title: "wait",
        params: { scriptStepId: "wait-after-submit" },
        createdAt: "2026-06-04T00:00:00.000Z"
      }],
      stepResults: [{
        id: "step-result-1",
        runId: "run-wait",
        iterationIndex: 1,
        stepId: "wait-after-submit",
        stepOrder: 1,
        type: "wait",
        status: "passed",
        startedAt: "2026-06-04T00:00:01.000Z",
        endedAt: "2026-06-04T00:00:04.000Z",
        durationMs: 3000,
        artifacts: []
      }],
      metrics: [],
      events: [],
      artifacts: [],
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "flow-wait",
        version: 1,
        planDigest: "a".repeat(64),
        executionPurpose: "normal",
        executionPlatform: "android",
        dependencies: [],
        parsed: {
          version: 1,
          kind: "case",
          name: "Wait",
          app: { id: "cn.eeo.classin" },
          parameters: {},
          steps: [{ id: "wait-after-submit", wait: { durationMs: 3000 } }],
          tags: []
        }
      },
      startedAt: "2026-06-04T00:00:00.000Z"
    };

    expect(renderReportHtml(run)).toContain("等待 3 秒");
  });

  it("renders screen contract source steps with their logical screen refs", () => {
    const run: TestRun = {
      id: "run-screen-contract",
      caseName: "Screen contract",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [{
        id: "assert-home",
        order: 1,
        type: "wait",
        enabled: true,
        title: "确认页面",
        params: { scriptStepId: "assert-home" },
        createdAt: "2026-08-15T00:00:00.000Z"
      }],
      stepResults: [{
        id: "step-result-assert-home",
        runId: "run-screen-contract",
        iterationIndex: 1,
        stepId: "assert-home",
        stepOrder: 1,
        type: "wait",
        status: "passed",
        startedAt: "2026-08-15T00:00:01.000Z",
        endedAt: "2026-08-15T00:00:02.000Z",
        durationMs: 1000,
        artifacts: []
      }],
      metrics: [],
      events: [],
      artifacts: [],
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "flow-screen-contract",
        version: 1,
        planDigest: "b".repeat(64),
        dependencies: [],
        parsed: {
          version: 1,
          kind: "case",
          name: "Screen contract",
          app: { id: "cn.eeo.classin" },
          parameters: {},
          steps: [{ id: "assert-home", assertPage: { screenRef: "classin.home" } }],
          tags: []
        }
      },
      startedAt: "2026-08-15T00:00:00.000Z"
    };

    expect(renderReportHtml(run)).toContain("确认已进入页面“classin.home”");
  });

  it("renders android app monitor summary as a readable report section without raw csv links", () => {
    const run: TestRun = {
      id: "run-monitor",
      caseName: "Monitor",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [
        {
          id: "event-monitor",
          runId: "run-monitor",
          deviceSerial: "device-1",
          type: "android_app_monitor",
          severity: "warning",
          occurredAt: "2026-06-04T00:00:02.000Z",
          summary: "[Android App Monitor] collected 12 CPU, 6 memory, 2 lifecycle samples",
          detail: JSON.stringify({
            packageName: "cn.eeo.classin",
            sampleCounts: { cpu: 12, memory: 6, lifecycle: 2 },
            processes: [{ pid: 123, processName: "cn.eeo.classin", isMainProcess: true }],
            incidents: 1
          }),
          artifactIds: ["artifact-summary", "artifact-cpu"]
        }
      ],
      artifacts: [
        {
          id: "artifact-summary",
          runId: "run-monitor",
          type: "report_json",
          name: "android-app-monitor-summary.json",
          path: "runs/run-monitor/reports/android-app-monitor-summary.json",
          url: "/artifacts/runs/run-monitor/reports/android-app-monitor-summary.json",
          mimeType: "application/json",
          createdAt: "2026-06-04T00:00:00.000Z"
        },
        {
          id: "artifact-cpu",
          runId: "run-monitor",
          type: "metrics",
          name: "android-app-monitor-cpu.csv",
          path: "runs/run-monitor/metrics/android-app-monitor-cpu.csv",
          url: "/artifacts/runs/run-monitor/metrics/android-app-monitor-cpu.csv",
          mimeType: "text/csv",
          createdAt: "2026-06-04T00:00:00.000Z"
        }
      ],
      startedAt: "2026-06-04T00:00:00.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("App 性能监控");
    expect(html).toContain("有告警");
    expect(html).toContain("cn.eeo.classin");
    expect(html).toContain("<strong>12</strong>");
    expect(html).not.toContain("android-app-monitor-summary.json");
    expect(html).not.toContain("android-app-monitor-cpu.csv");
    expect(html).not.toContain("/artifacts/runs/run-monitor/metrics/android-app-monitor-cpu.csv");
  });

  it("renders exception details and linked crash evidence", () => {
    const run: TestRun = {
      id: "run-crash",
      caseName: "Crash",
      deviceSerial: "device-1",
      status: "failed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [],
      stepResults: [],
      metrics: [],
      events: [
        {
          id: "event-monitor-crash",
          runId: "run-crash",
          deviceSerial: "device-1",
          type: "crash",
          severity: "error",
          occurredAt: "2026-06-04T00:00:02.000Z",
          summary: "[Android App Monitor] Java crash detected: com.demo",
          detail: "FATAL EXCEPTION: main\nProcess: com.demo, PID: 123",
          artifactIds: ["artifact-crash-screenshot"]
        },
        {
          id: "event-crash",
          runId: "run-crash",
          deviceSerial: "device-1",
          type: "crash",
          severity: "error",
          occurredAt: "2026-06-04T00:00:02.000Z",
          summary: "Java crash detected: com.demo",
          detail: [
            "FATAL EXCEPTION: main",
            "Process: com.demo, PID: 123",
            "",
            "--- Captured logcat ---",
            "08-15 10:57:38.400 I/Unrelated: noise before crash",
            "08-15 10:57:38.425 E/AndroidRuntime(123): FATAL EXCEPTION: main",
          "08-15 10:57:38.425 E/AndroidRuntime(123): Process: com.demo, PID: 123",
          "08-15 10:57:38.425 E/AndroidRuntime(123): java.lang.IllegalStateException: broken state",
          "08-15 10:57:38.425 E/AndroidRuntime(123): \tat com.demo.MainActivity.onCreate(MainActivity.kt:42)",
          "08-15 10:57:38.425 E/AndroidRuntime(123): unrelated runtime diagnostic"
          ].join("\n"),
          artifactIds: ["artifact-crash-log", "artifact-crash-full"]
        },
        {
          id: "event-process-death",
          runId: "run-crash",
          deviceSerial: "device-1",
          type: "process_death",
          severity: "error",
          occurredAt: "2026-06-04T00:00:03.000Z",
          summary: "Process death detected: com.demo",
          detail: "process-death-raw-detail\n\n--- Captured logcat ---\nmore unrelated logs",
          artifactIds: []
        }
      ],
      artifacts: [{
        id: "artifact-crash-log",
        runId: "run-crash",
        type: "log",
        name: "android-app-monitor-crash.log",
        path: "runs/run-crash/logs/android-app-monitor-crash.log",
        url: "/artifacts/runs/run-crash/logs/android-app-monitor-crash.log",
        mimeType: "text/plain",
        sizeBytes: 1024,
        createdAt: "2026-06-04T00:00:02.000Z"
      }, {
        id: "artifact-crash-full",
        runId: "run-crash",
        type: "log",
        name: "android-app-monitor-crash-full.logcat.txt",
        path: "runs/run-crash/logs/android-app-monitor-crash-full.logcat.txt",
        url: "/artifacts/runs/run-crash/logs/android-app-monitor-crash-full.logcat.txt",
        mimeType: "text/plain",
        sizeBytes: 222428,
        createdAt: "2026-06-04T00:00:02.000Z"
      }, {
        id: "artifact-crash-screenshot",
        runId: "run-crash",
        type: "screenshot",
        name: "crash.png",
        path: "runs/run-crash/screenshots/crash.png",
        url: "/artifacts/runs/run-crash/screenshots/crash.png",
        mimeType: "image/png",
        createdAt: "2026-06-04T00:00:02.000Z"
      }],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:03.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("<summary>异常详情");
    expect(html).toContain("java.lang.IllegalStateException: broken state");
    expect(html).toContain("at com.demo.MainActivity.onCreate(MainActivity.kt:42)");
    expect(html).not.toContain("Unrelated: noise before crash");
    expect(html).not.toContain("unrelated runtime diagnostic");
    expect(html).not.toMatch(/08-15 10:57:38\.425|AndroidRuntime/);
    expect(html).not.toContain("Captured logcat");
    expect(html).not.toContain("process-death-raw-detail");
    expect(html).toContain("/artifacts/runs/run-crash/logs/android-app-monitor-crash.log");
    expect(html).not.toContain("/artifacts/runs/run-crash/logs/android-app-monitor-crash-full.logcat.txt");
    const eventDetail = html.slice(html.indexOf('<details class="event-detail">'), html.indexOf("</details>") + "</details>".length);
    expect(eventDetail).not.toContain("/artifacts/runs/run-crash/screenshots/crash.png");
    expect(html.match(/<td>crash<\/td>/g)).toHaveLength(1);
  });


  it("renders stability exploration config and runtime summary", () => {
    const run: TestRun = {
      id: "run-stability",
      caseName: "稳定性探索：com.demo",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        runKind: "stability_exploration",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 350,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false,
        stabilityExploration: {
          packageName: "com.demo",
          strategy: "balanced",
          startMode: "launch_app",
          seed: "seed-42",
          maxDurationMs: 180_000,
          maxActions: 20,
          allowedActions: ["tap", "swipe", "wait"],
          appExitPolicy: "restart_app",
          backtrackStrategy: "shallow",
          maxDepth: 2,
          dangerousTextPatterns: ["删除", "支付"],
          stopOnCrash: true,
          stopOnAnr: true,
          stopOnBlackScreen: true,
          stopOnUnknownPageStuck: true
        }
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-stability",
          iterationIndex: 0,
          stepId: "stability_step_1",
          stepOrder: 1,
          type: "tap",
          status: "passed",
          startedAt: "2026-06-25T10:00:05.000Z",
          durationMs: 320,
          artifacts: [],
          metadata: {
            stabilityExploration: {
              candidateLabel: "添加好友",
              candidateSource: "ocr_text",
              currentPackage: "com.demo",
              skippedCandidates: [{ label: "删除", skipReason: "dangerous_text" }]
            }
          }
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-25T10:00:00.000Z",
      endedAt: "2026-06-25T10:03:00.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("稳定性探索摘要");
    expect(html).toContain("com.demo");
    expect(html).toContain("seed-42");
    expect(html).toContain("balanced");
    expect(html).toContain("添加好友");
    expect(html).toContain("过滤候选");
  });


  it("links step screenshots to video timestamps when a video artifact exists", () => {
    const run: TestRun = {
      id: "run-1",
      caseName: "Smoke",
      deviceSerial: "device-1",
      status: "failed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-1",
          iterationIndex: 1,
          stepId: "step-1",
          stepOrder: 1,
          type: "tap",
          status: "failed",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          afterScreenshotId: "artifact-shot",
          artifacts: [
            {
              id: "artifact-shot",
              runId: "run-1",
              stepResultId: "step-result-1",
              type: "screenshot",
              name: "step.png",
              path: "runs/run-1/screenshots/step.png",
              url: "/artifacts/runs/run-1/screenshots/step.png",
              createdAt: "2026-06-04T00:00:05.000Z"
            }
          ]
        }
      ],
      metrics: [],
      events: [],
      artifacts: [
        {
          id: "artifact-video",
          runId: "run-1",
          type: "video",
          name: "run.mp4",
          path: "runs/run-1/videos/run.mp4",
          url: "/artifacts/runs/run-1/videos/run.mp4",
          createdAt: "2026-06-04T00:00:00.000Z"
        },
        {
          id: "artifact-shot",
          runId: "run-1",
          stepResultId: "step-result-1",
          type: "screenshot",
          name: "step.png",
          path: "runs/run-1/screenshots/step.png",
          url: "/artifacts/runs/run-1/screenshots/step.png",
          createdAt: "2026-06-04T00:00:05.000Z"
        }
      ],
      startedAt: "2026-06-04T00:00:00.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain('<video id="run-video"');
    expect(html).toContain("video-shell");
    expect(html).toContain('data-video-time="5"');
    expect(html).toContain("step.png");
  });

  it("renders planned case step titles in the step result table", () => {
    const run: TestRun = {
      id: "run-readable-steps",
      caseName: "创建公开课并发布",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [
        {
          id: "open-create-lesson",
          order: 1,
          type: "tap_on_text",
          enabled: true,
          title: "tap",
          params: { text: "创建公开课" },
          createdAt: "2026-06-04T00:00:00.000Z"
        },
        {
          id: "select-duration",
          order: 2,
          type: "tap_on_image",
          enabled: true,
          title: "selectText",
          params: { text: "课堂时长", value: "7小时20分钟" },
          createdAt: "2026-06-04T00:00:05.000Z"
        },
        {
          id: "fill-relative-field",
          order: 3,
          type: "input_text",
          enabled: true,
          title: "inputText",
          params: { value: "1212" },
          createdAt: "2026-06-04T00:00:08.000Z"
        }
      ],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-readable-steps",
          iterationIndex: 1,
          stepId: "open-create-lesson",
          stepOrder: 1,
          type: "tap_on_text",
          status: "passed",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          artifacts: []
        },
        {
          id: "step-result-2",
          runId: "run-readable-steps",
          iterationIndex: 1,
          stepId: "select-duration",
          stepOrder: 2,
          type: "tap_on_image",
          status: "passed",
          startedAt: "2026-06-04T00:00:10.000Z",
          durationMs: 230,
          artifacts: []
        },
        {
          id: "step-result-3",
          runId: "run-readable-steps",
          iterationIndex: 1,
          stepId: "fill-relative-field",
          stepOrder: 3,
          type: "input_text",
          status: "passed",
          startedAt: "2026-06-04T00:00:12.000Z",
          durationMs: 180,
          artifacts: []
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:12.000Z",
      sourceSnapshot: {
        kind: "script_flow",
        flowId: "temporary:readable-steps",
        version: 1,
        planDigest: "digest",
        dependencies: [],
        parsed: {
          version: 1,
          kind: "case",
          name: "创建公开课并发布",
          app: { id: "classin" },
          parameters: {},
          steps: [
            {
              id: "open-create-lesson",
              role: "business",
              tap: { target: { text: "创建公开课" } }
            },
            {
              id: "select-duration",
              role: "business",
              selectText: {
                target: { text: "课堂时长", area: "content" },
                value: "7小时20分钟"
              }
            },
            {
              id: "fill-relative-field",
              role: "business",
              inputText: {
                target: { control: "textField", area: "content", anchorText: "开始时间", relation: "above" },
                value: "1212"
              }
            }
          ],
          tags: []
        }
      }
    };

    const html = renderReportHtml(run);

    expect(html).toContain("点击“创建公开课”");
    expect(html).toContain("将“课堂时长”选择为“7小时20分钟”");
    expect(html).toContain("在“开始时间上方输入框”中输入“1212”");
  });

  it("keeps the screenshot gallery focused on primary step screenshots and folds diagnostic captures", () => {
    const locatorGrowth = screenshotArtifact("artifact-locator-growth", "step-result-1", "locator-open-growth-tab-attempt-1.png");
    const afterGrowth = screenshotArtifact("artifact-after-growth", "step-result-1", "iter-1-step-1-after.png");
    const locatorSearch = screenshotArtifact("artifact-locator-search", "step-result-2", "locator-open-global-search-attempt-1.png");
    const afterSearch = screenshotArtifact("artifact-after-search", "step-result-2", "iter-1-step-2-after.png");
    const titleAssertion = screenshotArtifact("artifact-assert-title", "step-result-3", "iter-1-step-3-after.png");
    const inputAssertion = screenshotArtifact("artifact-assert-input", "step-result-4", "iter-1-step-4-after.png");
    const run: TestRun = {
      id: "run-screenshots",
      caseName: "从成长页进入全网搜索",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-screenshots",
          iterationIndex: 1,
          stepId: "open-growth-tab",
          stepOrder: 1,
          type: "tap_on_text",
          status: "passed",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          afterScreenshotId: afterGrowth.id,
          artifacts: [locatorGrowth, afterGrowth]
        },
        {
          id: "step-result-2",
          runId: "run-screenshots",
          iterationIndex: 1,
          stepId: "open-global-search",
          stepOrder: 2,
          type: "tap_on_image",
          status: "passed",
          startedAt: "2026-06-04T00:00:07.000Z",
          durationMs: 120,
          afterScreenshotId: afterSearch.id,
          artifacts: [locatorSearch, afterSearch]
        },
        {
          id: "step-result-3",
          runId: "run-screenshots",
          iterationIndex: 1,
          stepId: "verify-search-title",
          stepOrder: 3,
          type: "wait",
          status: "passed",
          startedAt: "2026-06-04T00:00:09.000Z",
          durationMs: 120,
          afterScreenshotId: titleAssertion.id,
          artifacts: [titleAssertion],
          metadata: { executionPhase: "verification" },
          expectationResults: [{
            id: "expectation-result-title",
            expectationId: "expectation-title",
            type: "text",
            status: "passed",
            blocking: true,
            expected: 'OCR text equals "搜索".',
            actual: "搜索",
            evidenceArtifactIds: [titleAssertion.id],
            checkedAt: "2026-06-04T00:00:09.000Z"
          }]
        },
        {
          id: "step-result-4",
          runId: "run-screenshots",
          iterationIndex: 1,
          stepId: "verify-search-input",
          stepOrder: 4,
          type: "wait",
          status: "passed",
          startedAt: "2026-06-04T00:00:11.000Z",
          durationMs: 120,
          afterScreenshotId: inputAssertion.id,
          artifacts: [inputAssertion],
          metadata: { executionPhase: "verification" },
          expectationResults: [{
            id: "expectation-result-input",
            expectationId: "expectation-input",
            type: "text",
            status: "passed",
            blocking: true,
            expected: 'OCR text contains "请输入搜索内容".',
            actual: "请输入搜索内容",
            evidenceArtifactIds: [inputAssertion.id],
            checkedAt: "2026-06-04T00:00:11.000Z"
          }]
        }
      ],
      metrics: [],
      events: [],
      artifacts: [locatorGrowth, afterGrowth, locatorSearch, afterSearch, titleAssertion, inputAssertion],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:12.000Z"
    };

    const html = renderReportHtml(run);
    const primaryGallery = sectionBetween(html, "<h2>步骤截图</h2>", '<details class="diagnostic-screenshots">');

    expect(primaryGallery).toContain("iter-1-step-1-after.png");
    expect(primaryGallery).toContain("iter-1-step-2-after.png");
    expect(primaryGallery).not.toContain("locator-open-growth-tab-attempt-1.png");
    expect(primaryGallery).not.toContain("locator-open-global-search-attempt-1.png");
    expect(primaryGallery).not.toContain("iter-1-step-3-after.png");
    expect(primaryGallery).not.toContain("iter-1-step-4-after.png");
    expect(html).toContain("<summary>定位与断言证据");
    expect(html).toContain("locator-open-growth-tab-attempt-1.png");
    expect(html).toContain("iter-1-step-3-after.png");
  });

  it("renders metric summary and trend chart when samples exist", () => {
    const run: TestRun = {
      id: "run-2",
      caseName: "Metric Flow",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [],
      metrics: [
        {
          id: "metric-1",
          runId: "run-2",
          deviceSerial: "device-1",
          sampledAt: "2026-06-04T00:00:01.000Z",
          cpuPercent: 10,
          memoryUsedKb: 1024 * 100
        },
        {
          id: "metric-2",
          runId: "run-2",
          deviceSerial: "device-1",
          sampledAt: "2026-06-04T00:00:02.000Z",
          cpuPercent: 30,
          memoryUsedKb: 1024 * 140
        }
      ],
      events: [
        {
          id: "event-metric-time",
          runId: "run-2",
          deviceSerial: "device-1",
          type: "performance_threshold",
          severity: "warning",
          occurredAt: "2026-06-04T00:00:02.000Z",
          summary: "Metric threshold reached",
          artifactIds: []
        }
      ],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:03.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("性能摘要");
    expect(html).toContain("CPU 平均 / 峰值");
    expect(html).toContain("20% / 30%");
    expect(html).toContain('aria-label="性能趋势图"');
    expect(html).toContain("2026-06-04 08:00:01");
    expect(html).toContain("2026-06-04 08:00:02");
    expect(html).not.toContain("2026-06-04T00:00:01.000Z");
    expect(html).not.toContain("2026-06-04T00:00:02.000Z");
  });

  it("renders step expectation summaries, details, and evidence links", () => {
    const run: TestRun = {
      id: "run-3",
      caseName: "Expectation Flow",
      deviceSerial: "device-1",
      status: "failed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-3",
          iterationIndex: 1,
          stepId: "step-1",
          stepOrder: 1,
          type: "tap",
          status: "failed",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          errorMessage: "metric_below: Metric value is above the configured threshold.",
          artifacts: [
            {
              id: "artifact-shot",
              runId: "run-3",
              stepResultId: "step-result-1",
              type: "screenshot",
              name: "step.png",
              path: "runs/run-3/screenshots/step.png",
              url: "/artifacts/runs/run-3/screenshots/step.png",
              createdAt: "2026-06-04T00:00:05.000Z"
            }
          ],
          expectationResults: [
            {
              id: "expectation-result-1",
              expectationId: "expectation-1",
              type: "metric_below",
              status: "failed",
              blocking: false,
              expected: "cpuPercent <= 0",
              actual: "cpuPercent = 1",
              reason: "Metric value is above the configured threshold.",
              evidenceArtifactIds: ["artifact-shot"],
              checkedAt: "2026-06-04T00:00:05.000Z"
            }
          ]
        }
      ],
      metrics: [],
      events: [],
      artifacts: [
        {
          id: "artifact-shot",
          runId: "run-3",
          stepResultId: "step-result-1",
          type: "screenshot",
          name: "step.png",
          path: "runs/run-3/screenshots/step.png",
          url: "/artifacts/runs/run-3/screenshots/step.png",
          createdAt: "2026-06-04T00:00:05.000Z"
        }
      ],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:06.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("Expectations");
    expect(html).toContain("0 / 1");
    expect(html).toContain("预期验证明细");
    expect(html).toContain("metric_below · failed");
    expect(html).toContain("metric_below · failed · 建议");
    expect(html).toContain("<th>规则</th>");
    expect(html).toContain("<td>建议</td>");
    expect(html).toContain("cpuPercent &lt;= 0");
    expect(html).toContain("cpuPercent = 1");
    expect(html).toContain("Metric value is above the configured threshold.");
    expect(html).toContain("/artifacts/runs/run-3/screenshots/step.png");
  });

  it("hides passed system guards but keeps failing guards visible", () => {
    const baseRun: TestRun = {
      id: "run-guards",
      caseName: "Guard Flow",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-guards",
          iterationIndex: 1,
          stepId: "step-1",
          stepOrder: 1,
          type: "tap",
          status: "passed",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          artifacts: [],
          expectationResults: [
            {
              id: "expectation-result-guard",
              expectationId: "expectation-guard",
              type: "no_crash",
              status: "passed",
              blocking: true,
              expected: "No crash or ANR is observed during this step.",
              actual: "No crash or ANR event was observed.",
              evidenceArtifactIds: [],
              checkedAt: "2026-06-04T00:00:05.000Z"
            }
          ]
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:06.000Z"
    };

    const passedHtml = renderReportHtml(baseRun);
    expect(passedHtml).toContain("系统护栏通过");
    expect(passedHtml).not.toContain("no_crash · passed");
    expect(passedHtml).not.toContain("预期验证明细");

    const failedHtml = renderReportHtml({
      ...baseRun,
      status: "failed",
      stepResults: [
        {
          ...baseRun.stepResults[0]!,
          status: "failed",
          expectationResults: [
            {
              ...baseRun.stepResults[0]!.expectationResults![0]!,
              status: "failed",
              actual: "Crash or ANR event was observed.",
              reason: "Device event watcher reported a runtime failure."
            }
          ]
        }
      ]
    });

    expect(failedHtml).toContain("no_crash · failed");
    expect(failedHtml).toContain("Device event watcher reported a runtime failure.");
  });

  it("renders optional skipped condition steps without counting them as failed", () => {
    const run: TestRun = {
      id: "run-4",
      caseName: "Optional Popup Flow",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: true,
        keepVideoOnSuccess: true
      },
      steps: [],
      stepResults: [
        {
          id: "step-result-1",
          runId: "run-4",
          iterationIndex: 1,
          stepId: "step-1",
          stepOrder: 1,
          type: "tap_if_text",
          status: "skipped",
          startedAt: "2026-06-04T00:00:05.000Z",
          durationMs: 120,
          errorCode: "CONDITION_NOT_MET",
          errorMessage: "Skipped optional tap.",
          artifacts: [],
          metadata: {
            condition: {
              matched: false,
              expected: 'OCR text contains "允许".',
              actual: "首页",
              action: "skip"
            }
          }
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:06.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("<span>Failed Steps</span><strong>0</strong>");
    expect(html).toContain("<span>Skipped Steps</span><strong>1</strong>");
    expect(html).toContain("条件步骤");
    expect(html).toContain("未命中，已跳过");
    expect(html).toContain("OCR text contains &quot;允许&quot;.");
  });


});

function screenshotArtifact(id: string, stepResultId: string, name: string) {
  return {
    id,
    runId: "run-screenshots",
    stepResultId,
    type: "screenshot" as const,
    name,
    path: `runs/run-screenshots/screenshots/${name}`,
    url: `/artifacts/runs/run-screenshots/screenshots/${name}`,
    createdAt: "2026-06-04T00:00:05.000Z"
  };
}

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
