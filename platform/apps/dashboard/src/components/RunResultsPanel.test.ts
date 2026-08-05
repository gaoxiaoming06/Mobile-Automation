import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TestRun } from "@mobile-automation/shared";
import { RunResultsPanel } from "./RunResultsPanel.js";

describe("RunResultsPanel", () => {
  it("renders each ScriptFlow execution as one run", () => {
    const runs = [
      run({
        id: "run-child-2",
        caseName: "创建课堂但不发布",
        status: "failed",
        startedMinute: 2
      }),
      run({
        id: "run-child-1",
        caseName: "打开新建课堂",
        status: "passed",
        startedMinute: 1
      })
    ];

    const markup = renderToStaticMarkup(
      React.createElement(RunResultsPanel, {
        currentRun: null,
        runs,
        runsLimit: 30,
        selectedSerial: "device-1",
        setCurrentRunId: () => undefined,
        stopCurrentRun: async () => undefined,
        pauseCurrentRun: async () => undefined,
        resumeCurrentRun: async () => undefined,
        stepCurrentRun: async () => undefined,
        loadMoreRuns: () => undefined
      })
    );

    expect(markup).toContain("2 条记录");
    expect(markup).toContain("创建课堂但不发布");
    expect(markup).toContain("打开新建课堂");
    expect(markup).not.toContain("子 Run");
  });

  it("renders current run app performance summary without exposing raw csv links", () => {
    const currentRun = run({
      id: "run-monitor",
      caseName: "资产巡检｜课程表",
      status: "passed",
      startedMinute: 1,
      events: [androidAppMonitorEvent({ severity: "warning", incidents: 1 })],
      artifacts: [
        androidAppMonitorArtifact("artifact-summary", "report_json", "android-app-monitor-summary.json"),
        androidAppMonitorArtifact("artifact-cpu", "metrics", "android-app-monitor-cpu.csv")
      ]
    });

    const markup = renderToStaticMarkup(
      React.createElement(RunResultsPanel, {
        currentRun,
        runs: [currentRun],
        runsLimit: 30,
        selectedSerial: "device-1",
        setCurrentRunId: () => undefined,
        stopCurrentRun: async () => undefined,
        pauseCurrentRun: async () => undefined,
        resumeCurrentRun: async () => undefined,
        stepCurrentRun: async () => undefined,
        loadMoreRuns: () => undefined
      })
    );

    expect(markup).toContain("App 性能");
    expect(markup).toContain("有告警");
    expect(markup).toContain("cn.eeo.classin");
    expect(markup).toContain("CPU 12");
    expect(markup).toContain("内存 6");
    expect(markup).not.toContain("android-app-monitor-cpu.csv");
    expect(markup).not.toContain("android-app-monitor-summary.json");
  });

  it("shows app performance status on execution records", () => {
    const runs = [
      run({
        id: "run-monitor-child",
        caseName: "资产组合｜创建课堂｜提交表单",
        status: "passed",
        startedMinute: 1,
        events: [androidAppMonitorEvent({ severity: "info", incidents: 0 })]
      })
    ];

    const markup = renderToStaticMarkup(
      React.createElement(RunResultsPanel, {
        currentRun: null,
        runs,
        runsLimit: 30,
        selectedSerial: "device-1",
        setCurrentRunId: () => undefined,
        stopCurrentRun: async () => undefined,
        pauseCurrentRun: async () => undefined,
        resumeCurrentRun: async () => undefined,
        stepCurrentRun: async () => undefined,
        loadMoreRuns: () => undefined
      })
    );

    expect(markup).toContain("App 性能正常");
  });

  it("labels HarmonyOS devices explicitly", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RunResultsPanel, {
        selectedDevice: {
          id: "harmony-1",
          serial: "harmony-1",
          platform: "harmony",
          status: "online",
          capabilities: {
            preview: true,
            tap: true,
            longPress: true,
            swipe: true,
            back: true,
            home: true,
            recentApps: false,
            textInput: true,
            screenshot: true,
            launchApp: true,
            closeApp: true,
            recordVideo: false,
            metrics: { cpu: false, memory: false, fps: false, network: false, battery: false, temperature: false },
            events: { crash: false, anr: false, logs: true }
          },
          lastSeenAt: "2026-08-04T00:00:00.000Z"
        },
        currentRun: null,
        runs: [],
        runsLimit: 30,
        selectedSerial: "harmony-1",
        setCurrentRunId: () => undefined,
        stopCurrentRun: async () => undefined,
        pauseCurrentRun: async () => undefined,
        resumeCurrentRun: async () => undefined,
        stepCurrentRun: async () => undefined,
        loadMoreRuns: () => undefined
      })
    );

    expect(markup).toContain("HarmonyOS");
    expect(markup).not.toContain("Android");
  });

  it("shows a public failure summary instead of raw step errors", () => {
    const currentRun = run({
      id: "run-failed",
      caseName: "打开添加好友",
      status: "failed",
      startedMinute: 1,
      stepResults: [{
        id: "result-1",
        runId: "run-failed",
        iterationIndex: 0,
        stepId: "internal-step-id",
        stepOrder: 1,
        type: "tap_on_text",
        status: "failed",
        startedAt: "2026-07-23T08:01:00.000Z",
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        errorMessage: "OCR locator failed at x=12,y=34",
        artifacts: [],
        metadata: { semantic: { reason: "target_not_found" } }
      }]
    });

    const markup = renderToStaticMarkup(React.createElement(RunResultsPanel, {
      currentRun,
      runs: [currentRun],
      runsLimit: 30,
      selectedSerial: "device-1",
      setCurrentRunId: () => undefined,
      stopCurrentRun: async () => undefined,
      pauseCurrentRun: async () => undefined,
      resumeCurrentRun: async () => undefined,
      stepCurrentRun: async () => undefined,
      loadMoreRuns: () => undefined
    }));

    expect(markup).toContain("未找到当前操作的目标");
    expect(markup).not.toContain("OCR locator failed");
    expect(markup).not.toContain("internal-step-id");
  });

  it("uses planned case step titles for current run step results", () => {
    const currentRun = run({
      id: "run-readable-steps",
      caseName: "创建公开课并发布",
      status: "running",
      startedMinute: 1,
      steps: [
        {
          id: "open-create-lesson",
          order: 1,
          type: "tap_on_text",
          enabled: true,
          title: "tap",
          params: { text: "创建公开课" },
          createdAt: "2026-07-23T08:01:00.000Z"
        },
        {
          id: "select-duration",
          order: 2,
          type: "tap_on_image",
          enabled: true,
          title: "selectText",
          params: { text: "课堂时长", value: "7小时20分钟" },
          createdAt: "2026-07-23T08:01:05.000Z"
        }
      ],
      stepResults: [
        {
          id: "result-1",
          runId: "run-readable-steps",
          iterationIndex: 0,
          stepId: "open-create-lesson",
          stepOrder: 1,
          type: "tap_on_text",
          status: "passed",
          startedAt: "2026-07-23T08:01:00.000Z",
          durationMs: 9414,
          artifacts: []
        },
        {
          id: "result-2",
          runId: "run-readable-steps",
          iterationIndex: 0,
          stepId: "select-duration",
          stepOrder: 2,
          type: "tap_on_image",
          status: "passed",
          startedAt: "2026-07-23T08:01:05.000Z",
          durationMs: 25303,
          artifacts: []
        }
      ],
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
            }
          ],
          tags: []
        }
      }
    });

    const markup = renderToStaticMarkup(React.createElement(RunResultsPanel, {
      currentRun,
      runs: [currentRun],
      runsLimit: 30,
      selectedSerial: "device-1",
      setCurrentRunId: () => undefined,
      stopCurrentRun: async () => undefined,
      pauseCurrentRun: async () => undefined,
      resumeCurrentRun: async () => undefined,
      stepCurrentRun: async () => undefined,
      loadMoreRuns: () => undefined
    }));

    expect(markup).toContain("点击“创建公开课”");
    expect(markup).toContain("将“课堂时长”选择为“7小时20分钟”");
  });

  it("shows structured target lookup diagnostics", () => {
    const currentRun = run({
      id: "run-text-not-found",
      caseName: "选择联席教师",
      status: "failed",
      startedMinute: 2,
      steps: [{
        id: "tap-confirm",
        order: 1,
        type: "tap_on_text",
        enabled: true,
        title: "确认联席教师",
        params: { text: "确认" },
        createdAt: "2026-07-23T08:02:00.000Z"
      }],
      stepResults: [{
        id: "result-1",
        runId: "run-text-not-found",
        iterationIndex: 0,
        stepId: "tap-confirm",
        stepOrder: 1,
        type: "tap_on_text",
        status: "failed",
        startedAt: "2026-07-23T08:02:00.000Z",
        errorCode: "SEMANTIC_TARGET_NOT_FOUND",
        artifacts: [],
        metadata: {
          semantic: {
            type: "text",
            expected: ["确认"],
            actual: "选择联席教师 海外55 确定 1/6",
            reason: "target_not_found",
            attempts: 3,
            candidateCount: 14,
            search: { mode: "visibleOnly" }
          }
        }
      }]
    });

    const markup = renderToStaticMarkup(React.createElement(RunResultsPanel, {
      currentRun,
      runs: [currentRun],
      runsLimit: 30,
      selectedSerial: "device-1",
      setCurrentRunId: () => undefined,
      stopCurrentRun: async () => undefined,
      pauseCurrentRun: async () => undefined,
      resumeCurrentRun: async () => undefined,
      stepCurrentRun: async () => undefined,
      loadMoreRuns: () => undefined
    }));

    expect(markup).toContain("步骤“确认联席教师”需要点击文字“确认”");
    expect(markup).toContain("预期目标");
    expect(markup).toContain("OCR 识别到 14 个文字候选");
    expect(markup).toContain("现场识别到“确定”");
  });
});

function run(input: {
  id: string;
  caseName: string;
  status: TestRun["status"];
  startedMinute: number;
  events?: TestRun["events"];
  artifacts?: TestRun["artifacts"];
  steps?: TestRun["steps"];
  stepResults?: TestRun["stepResults"];
  sourceSnapshot?: TestRun["sourceSnapshot"];
}): TestRun {
  return {
    id: input.id,
    caseName: input.caseName,
    deviceSerial: "device-1",
    status: input.status,
    config: {
      deviceSerial: "device-1",
      mode: "once",
      repeatCount: 1,
      stepIntervalMs: 0,
      stopOnFailure: true,
      recordVideo: true,
      keepVideoOnSuccess: false,
      runKind: "script_flow"
    },
    steps: input.steps ?? [],
    stepResults: input.stepResults ?? [],
    metrics: [],
    events: input.events ?? [],
    artifacts: input.artifacts ?? [],
    ...(input.sourceSnapshot ? { sourceSnapshot: input.sourceSnapshot } : {}),
    startedAt: `2026-07-23T08:0${input.startedMinute}:00.000Z`
  };
}

function androidAppMonitorEvent(input: { severity: TestRun["events"][number]["severity"]; incidents: number }): TestRun["events"][number] {
  return {
    id: "event-monitor",
    runId: "run-monitor",
    deviceSerial: "device-1",
    type: "android_app_monitor",
    severity: input.severity,
    occurredAt: "2026-07-23T08:01:30.000Z",
    summary: "[Android App Monitor] collected 12 CPU, 6 memory, 2 lifecycle samples",
    detail: JSON.stringify({
      packageName: "cn.eeo.classin",
      sampleCounts: { cpu: 12, memory: 6, lifecycle: 2 },
      processes: [{ pid: 123, processName: "cn.eeo.classin", isMainProcess: true }],
      incidents: input.incidents
    }),
    artifactIds: ["artifact-summary", "artifact-cpu"]
  };
}

function androidAppMonitorArtifact(id: string, type: "metrics" | "report_json", name: string): TestRun["artifacts"][number] {
  return {
    id,
    runId: "run-monitor",
    type,
    name,
    path: `runs/run-monitor/${type === "metrics" ? "metrics" : "reports"}/${name}`,
    url: `/artifacts/runs/run-monitor/${type === "metrics" ? "metrics" : "reports"}/${name}`,
    mimeType: type === "metrics" ? "text/csv" : "application/json",
    createdAt: "2026-07-23T08:01:30.000Z"
  };
}
