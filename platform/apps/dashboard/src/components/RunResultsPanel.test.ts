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
});

function run(input: {
  id: string;
  caseName: string;
  status: TestRun["status"];
  startedMinute: number;
  events?: TestRun["events"];
  artifacts?: TestRun["artifacts"];
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
    steps: [],
    stepResults: [],
    metrics: [],
    events: input.events ?? [],
    artifacts: input.artifacts ?? [],
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
