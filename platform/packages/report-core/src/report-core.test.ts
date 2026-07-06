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

  it("renders AI diagnosis events with evidence links", () => {
    const run: TestRun = {
      id: "run-ai",
      caseName: "业务图谱执行",
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
          id: "event-ai",
          runId: "run-ai",
          deviceSerial: "device-1",
          type: "ai_diagnosis",
          severity: "warning",
          occurredAt: "2026-06-04T00:00:01.000Z",
          summary: "AI 诊断：asset_issue · 搜索图标资产失效。",
          detail: JSON.stringify({
            confidence: 0.92,
            recommendedAction: "create_asset_patch",
            safeToAutoApply: false
          }),
          artifactIds: ["artifact-ai"]
        }
      ],
      artifacts: [
        {
          id: "artifact-ai",
          runId: "run-ai",
          type: "log",
          name: "ai-diagnosis-1.json",
          path: "runs/run-ai/logs/ai-diagnosis-1.json",
          url: "/artifacts/runs/run-ai/logs/ai-diagnosis-1.json",
          mimeType: "application/json",
          createdAt: "2026-06-04T00:00:01.000Z"
        }
      ],
      startedAt: "2026-06-04T00:00:00.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("AI 诊断");
    expect(html).toContain("搜索图标资产失效");
    expect(html).toContain("create_asset_patch");
    expect(html).toContain("/artifacts/runs/run-ai/logs/ai-diagnosis-1.json");
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

  it("renders asset patrol semantic labels in the generic step table", () => {
    const run: TestRun = {
      id: "run-asset-patrol",
      caseName: "资产驱动巡检：cn.eeo.classin",
      deviceSerial: "device-1",
      status: "passed",
      config: {
        deviceSerial: "device-1",
        runKind: "asset_patrol",
        mode: "once",
        repeatCount: 1,
        stepIntervalMs: 0,
        stopOnFailure: true,
        recordVideo: false,
        keepVideoOnSuccess: false,
        assetPatrol: {
          packageName: "cn.eeo.classin",
          startMode: "current_state",
          pageScope: "current_page",
          maxDurationMs: 120_000,
          maxTransitions: 8,
          allowRiskyActions: false,
          allowBusinessSubmit: false,
          dangerousTextPatterns: [],
          runtimeParams: {}
        }
      },
      steps: [],
      stepResults: [
        {
          id: "step-page-match",
          runId: "run-asset-patrol",
          iterationIndex: 0,
          stepId: "step-page-match",
          stepOrder: 1,
          type: "wait",
          status: "passed",
          startedAt: "2026-06-30T00:00:00.000Z",
          durationMs: 0,
          artifacts: [],
          metadata: {
            assetPatrol: {
              kind: "page_match",
              label: "页面匹配：登录",
              status: "ready",
              executionMode: "diagnostic",
              pageModelName: "登录"
            }
          }
        },
        {
          id: "step-element",
          runId: "run-asset-patrol",
          iterationIndex: 0,
          stepId: "step-element",
          stepOrder: 2,
          type: "wait",
          status: "passed",
          startedAt: "2026-06-30T00:00:01.000Z",
          durationMs: 0,
          artifacts: [],
          metadata: {
            assetPatrol: {
              kind: "element_relocation",
              label: "元素可重定位：登录按钮",
              status: "ready",
              executionMode: "diagnostic",
              pageModelName: "登录"
            }
          }
        },
        {
          id: "step-task",
          runId: "run-asset-patrol",
          iterationIndex: 0,
          stepId: "step-task",
          stepOrder: 3,
          type: "wait",
          status: "skipped",
          startedAt: "2026-06-30T00:00:02.000Z",
          durationMs: 0,
          artifacts: [],
          metadata: {
            assetPatrol: {
              kind: "task_dry_run",
              label: "任务编排体检：账号密码登录",
              status: "skipped",
              executionMode: "diagnostic",
              pageModelName: "登录",
              skipReason: "business_submit_disabled"
            }
          }
        }
      ],
      metrics: [],
      events: [],
      artifacts: [],
      startedAt: "2026-06-30T00:00:00.000Z",
      endedAt: "2026-06-30T00:00:06.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("资产驱动巡检摘要");
    expect(html).toContain("页面匹配：登录");
    expect(html).toContain("元素可重定位：登录按钮");
    expect(html).toContain("任务编排体检：账号密码登录");
    expect(html).toContain("task_dry_run · skipped · business_submit_disabled");
    expect(html).not.toContain("<td>wait</td>");
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

  it("renders graph route, node match, action policy, and overlay expectation groups", () => {
    const run: TestRun = {
      id: "run-graph",
      caseName: "业务图谱目标节点执行",
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
          id: "step-result-graph",
          runId: "run-graph",
          iterationIndex: 0,
          stepId: "plan-step-1",
          stepOrder: 1,
          type: "tap_on_element",
          status: "failed",
          startedAt: "2026-06-12T00:00:05.000Z",
          durationMs: 280,
          errorMessage: "text: expected copy was missing",
          afterScreenshotId: "artifact-shot",
          artifacts: [
            {
              id: "artifact-shot",
              runId: "run-graph",
              stepResultId: "step-result-graph",
              type: "screenshot",
              name: "graph-step.png",
              path: "runs/run-graph/screenshots/graph-step.png",
              url: "/artifacts/runs/run-graph/screenshots/graph-step.png",
              createdAt: "2026-06-12T00:00:05.000Z"
            }
          ],
          expectationResults: [
            {
              id: "expectation-result-default",
              expectationId: "expect-default",
              type: "text",
              status: "passed",
              blocking: true,
              expected: "OCR text contains \"新建课堂\".",
              actual: "新建课堂",
              evidenceArtifactIds: ["artifact-shot"],
              checkedAt: "2026-06-12T00:00:05.100Z"
            },
            {
              id: "expectation-result-overlay",
              expectationId: "overlay-title",
              type: "text",
              status: "failed",
              blocking: true,
              expected: "OCR text contains \"新版文案\".",
              actual: "新建课堂",
              reason: "Android UI hierarchy text did not satisfy the text expectation.",
              evidenceArtifactIds: ["artifact-shot"],
              checkedAt: "2026-06-12T00:00:05.200Z"
            },
            {
              id: "expectation-result-guard",
              expectationId: "guard-no-crash",
              type: "no_crash",
              status: "passed",
              blocking: true,
              expected: "No crash or ANR is observed during this step.",
              actual: "No crash or ANR event was observed.",
              evidenceArtifactIds: [],
              checkedAt: "2026-06-12T00:00:05.300Z"
            }
          ],
          metadata: {
            semantic: {
              type: "image_region",
              action: "tap",
              relocatedBy: "visual_candidate",
              targetText: "更多",
              fallback: "region_center_disabled",
              visualCandidate: {
                label: "更多按钮",
                role: "button",
                score: 0.91,
                semanticArea: "top"
              },
              visualTemplate: {
                hash: "crop-hash",
                similarity: 0.94
              },
              visualRelocation: {
                reason: "candidate_selected",
                minScore: 0.72,
                candidateCount: 2
              },
              evidenceArtifactIds: ["artifact-shot"]
            },
            graph: {
              versionId: "graph-version-1",
              planStepId: "plan-step-1",
              edgeId: "edge-open-create-lesson",
              edgeKey: "classin.teacher.publish.open_create_lesson",
              fromNodeId: "node-publish",
              fromNodeName: "发布活动页面",
              toNodeId: "node-create-lesson",
              toNodeName: "新建课堂页面",
              phase: "expectation",
              usedActionPolicyId: "policy-tap-classroom",
              runtimeOverlay: {
                id: "overlay-1",
                note: "AI changed page copy",
                targetExpectationIds: ["overlay-title"],
                edgeExpectationIds: []
              },
              beforeMatch: {
                status: "matched",
                nodeId: "node-publish",
                nodeName: "发布活动页面",
                score: 0.96,
                candidates: [
                  {
                    nodeId: "node-publish",
                    nodeName: "发布活动页面",
                    score: 0.96,
                    matchedWeight: 6,
                    totalWeight: 7,
                    quality: {
                      status: "low_confidence",
                      reasons: ["strong_state_anchor_missing"],
                      matchedContextSignals: 1,
                      matchedStrongSignals: 0,
                      matchedWeakSignals: 1,
                      missingStrongMatcherIds: ["m-missing"]
                    },
                    matcherResults: [
                      { matcherId: "m-package", type: "package", expected: "cn.eeo.classin", actual: "cn.eeo.classin", weight: 2, matched: true, score: 2 },
                      { matcherId: "m-text", type: "text", expected: "发布活动", actual: "发布活动", weight: 3, matched: true, score: 3 },
                      { matcherId: "m-missing", type: "resource_id", expected: "cn.eeo.classin:id/missing", weight: 2, matched: false, score: 0, reason: "not_found" }
                    ]
                  }
                ]
              },
              afterMatch: {
                status: "matched",
                nodeId: "node-create-lesson",
                nodeName: "新建课堂页面",
                score: 0.91,
                candidates: [
                  {
                    nodeId: "node-create-lesson",
                    nodeName: "新建课堂页面",
                    score: 0.91,
                    matchedWeight: 10,
                    totalWeight: 11,
                    quality: {
                      status: "sufficient",
                      reasons: [],
                      matchedContextSignals: 0,
                      matchedStrongSignals: 1,
                      matchedWeakSignals: 1,
                      missingStrongMatcherIds: []
                    },
                    matcherResults: [
                      { matcherId: "m-title", type: "text", expected: "新建课堂", actual: "新建课堂", weight: 4, matched: true, score: 4 },
                      { matcherId: "m-input", type: "resource_id", expected: "cn.eeo.classin:id/et_course_name", actual: "cn.eeo.classin:id/et_course_name", weight: 6, matched: true, score: 6 }
                    ]
                  }
                ]
              },
              actionPolicy: {
                id: "policy-tap-classroom",
                priority: 1,
                fallback: false,
                reliabilityHint: "high",
                action: {
                  type: "tap_on_element",
                  params: {
                    locator: {
                      resourceId: "cn.eeo.classin:id/create_lesson"
                    },
                    timeoutMs: 3000
                  }
                }
              },
              recoveryAttempt: 1,
              recoveryReasonDeviationId: "deviation-1",
              interceptors: [
                {
                  id: "interceptor-1",
                  phase: "precondition",
                  ruleId: "common-known",
                  ruleName: "确认提示",
                  matchedText: "知道了",
                  action: { type: "tap", x: 540, y: 620 },
                  handledAt: "2026-06-12T00:00:05.050Z"
                }
              ],
              deviations: [
                {
                  id: "deviation-1",
                  phase: "state_transition",
                  expectedNodeId: "node-create-lesson",
                  actualNodeId: "node-publish",
                  actualStatus: "matched",
                  attempt: 1,
                  action: "retry_observe",
                  message: "Expected next node node-create-lesson, got node-publish; retrying observation.",
                  recordedAt: "2026-06-12T00:00:05.100Z"
                }
              ]
            }
          }
        }
      ],
      metrics: [],
      events: [
        {
          id: "event-bootstrap",
          runId: "run-graph",
          deviceSerial: "device-1",
          type: "start_state_failed",
          severity: "info",
          occurredAt: "2026-06-12T00:00:01.000Z",
          summary: "Graph run bootstrapped target app before route planning",
          detail: "Initial state was not a recognized graph node. Launched cn.eeo.classin and replanned from the detected app state.",
          artifactIds: []
        }
      ],
      artifacts: [
        {
          id: "artifact-shot",
          runId: "run-graph",
          stepResultId: "step-result-graph",
          type: "screenshot",
          name: "graph-step.png",
          path: "runs/run-graph/screenshots/graph-step.png",
          url: "/artifacts/runs/run-graph/screenshots/graph-step.png",
          createdAt: "2026-06-12T00:00:05.000Z"
        }
      ],
      startedAt: "2026-06-12T00:00:00.000Z",
      endedAt: "2026-06-12T00:00:06.000Z"
    };

    const html = renderReportHtml(run);

    expect(html).toContain("业务图谱执行");
    expect(html).toContain("<span>Bootstrap</span><strong>1 次</strong>");
    expect(html).toContain("<span>Transition Wait</span><strong>1 次</strong>");
    expect(html).toContain("启动归位");
    expect(html).toContain("Graph run bootstrapped target app before route planning");
    expect(html).toContain("状态等待");
    expect(html).toContain("发布活动页面");
    expect(html).toContain("新建课堂页面");
    expect(html).toContain("classin.teacher.publish.open_create_lesson");
    expect(html).toContain("policy-tap-classroom");
    expect(html).toContain("resourceId");
    expect(html).toContain("cn.eeo.classin:id/create_lesson");
    expect(html).toContain("定位证据");
    expect(html).toContain("visual_candidate");
    expect(html).toContain("更多按钮");
    expect(html).toContain("template");
    expect(html).toContain("crop-hash");
    expect(html).toContain("candidate_selected");
    expect(html).toContain("fallback=region_center_disabled");
    expect(html).toContain("命中 6 / 7");
    expect(html).toContain("质量 low_confidence");
    expect(html).toContain("strong_state_anchor_missing");
    expect(html).toContain("缺失强锚点 m-missing");
    expect(html).toContain("质量 sufficient");
    expect(html).toContain("强锚点 1");
    expect(html).toContain("m-package");
    expect(html).toContain("m-missing");
    expect(html).toContain("not_found");
    expect(html).toContain("图谱默认");
    expect(html).toContain("动态预期");
    expect(html).toContain("系统护栏");
    expect(html).toContain("偏离 state_transition");
    expect(html).toContain("retry_observe");
    expect(html).toContain("运行时清障 precondition");
    expect(html).toContain("确认提示");
    expect(html).toContain("知道了");
    expect(html).toContain("恢复路径");
    expect(html).toContain("第 1 次重规划");
    expect(html).toContain("91%");
    expect(html).toContain("/artifacts/runs/run-graph/screenshots/graph-step.png");
  });
});
