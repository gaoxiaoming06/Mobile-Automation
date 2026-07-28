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
      events: [],
      artifacts: [],
      startedAt: "2026-06-04T00:00:00.000Z",
      endedAt: "2026-06-04T00:00:03.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("性能摘要");
    expect(html).toContain("CPU 平均 / 峰值");
    expect(html).toContain("20% / 30%");
    expect(html).toContain('aria-label="性能趋势图"');
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
