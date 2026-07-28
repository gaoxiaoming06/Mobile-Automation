import { describe, expect, it } from "vitest";
import type { ActionStep, ArtifactRef, MetricSample, StepExpectation } from "@mobile-automation/shared";
import type { OcrInput, OcrResult, OcrService } from "./ocr.js";
import {
  StepExpectationEvaluator,
  annotateNonBlockingExpectationResults,
  imageBufferSimilarity,
  imageThreshold,
  matchTextExpectation,
  normalizeOcrText,
  readOcrRegion,
  shouldFailStepForExpectation,
  textExpectationMode,
  type ScreenshotCapture
} from "./step-expectations.js";

describe("step expectation helpers", () => {
  it("parses OCR regions from nested or flat params", () => {
    expect(readOcrRegion({ region: { x: "1.2", y: 2, width: 100.7, height: "50" } })).toEqual({
      x: 1,
      y: 2,
      width: 101,
      height: 50
    });
    expect(readOcrRegion({ regionX: 4, regionY: 5, regionWidth: 6, regionHeight: 7 })).toEqual({
      x: 4,
      y: 5,
      width: 6,
      height: 7
    });
    expect(readOcrRegion({})).toBeUndefined();
    expect(() => readOcrRegion({ region: { x: 0, y: 0, width: 0, height: 10 } })).toThrow("OCR region must configure");
  });

  it("normalizes OCR text and evaluates text match modes", () => {
    expect(normalizeOcrText(" 首页\n  已开始 ")).toBe("首页 已开始");
    expect(textExpectationMode("equals")).toBe("equals");
    expect(textExpectationMode("unknown")).toBe("contains");
    expect(matchTextExpectation("首页 已开始", "首页", "contains")).toBe(true);
    expect(matchTextExpectation("首页 已开始", "首页 已开始", "equals")).toBe(true);
    expect(matchTextExpectation("首页 已开始", "错误", "not_contains")).toBe(true);
  });

  it("normalizes image thresholds and compares image buffers", () => {
    expect(imageThreshold("0.8")).toBe(0.8);
    expect(imageThreshold(2)).toBe(0.92);
    expect(imageBufferSimilarity(Buffer.from("abcd"), Buffer.from("abxd"))).toBe(0.75);
    expect(imageBufferSimilarity(Buffer.alloc(0), Buffer.alloc(0))).toBe(1);
  });

  it("keeps non-blocking expectation failures advisory", () => {
    const step = actionStep([expectation("screen_changed", { blocking: false })]);
    const result = annotateNonBlockingExpectationResults(step, [
      {
        id: "result-1",
        expectationId: "expectation-screen_changed",
        type: "screen_changed",
        status: "failed",
        expected: "screen changed",
        actual: "same",
        evidenceArtifactIds: [],
        checkedAt: "2026-06-09T00:00:00.000Z"
      }
    ])[0]!;

    expect(result.blocking).toBe(false);
    expect(result.reason).toContain("Non-blocking expectation");
    expect(shouldFailStepForExpectation(step, result)).toBe(false);
  });
});

describe("StepExpectationEvaluator", () => {
  it("evaluates state_is through the injected page verifier", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry"),
      verifyPageState: async (input) => {
        expect(input).toEqual(expect.objectContaining({
          serial: "device-1",
          appId: "cn.eeo.classin",
          platform: "android",
          pageId: "classin.home",
          timeoutMs: 1200,
          screenshot: Buffer.from("after")
        }));
        return { status: "matched", pageName: "主页" };
      }
    });
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step: actionStep([expectation("state_is", {
        appId: "cn.eeo.classin",
        platform: "android",
        pageId: "classin.home",
        timeoutMs: 1200
      })]),
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "state_is",
        status: "passed",
        expected: "Page classin.home",
        actual: "主页",
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
  });

  it("fails state_is when page evidence is ambiguous", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry"),
      verifyPageState: async () => ({
        status: "multiple_candidates",
        candidateNames: ["主页", "主页变体"],
        reason: "ambiguous_evidence"
      })
    });
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step: actionStep([expectation("state_is", {
        appId: "cn.eeo.classin",
        platform: "android",
        pageId: "classin.home"
      })]),
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results[0]).toEqual(expect.objectContaining({
      status: "failed",
      actual: "主页, 主页变体",
      reason: "ambiguous_evidence"
    }));
  });

  it("evaluates metric, log, and OCR text expectations with injected dependencies", async () => {
    const logArtifact = artifact("artifact-log", "log");
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService("欢迎进入课堂"),
      collectLogs: async () => "normal log line",
      writeLog: async () => logArtifact,
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([
      expectation("metric_below", { metric: "cpuPercent", threshold: 50 }),
      expectation("log_not_contains", { text: "FATAL EXCEPTION" }),
      expectation("text", { expected: "课堂", mode: "contains" })
    ]);
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      metric: metricSample({ cpuPercent: 12 }),
      runtimeFailure: false
    });

    expect(results.map((result) => [result.type, result.status])).toEqual([
      ["metric_below", "passed"],
      ["log_not_contains", "passed"],
      ["text", "passed"]
    ]);
    expect(results[1]?.evidenceArtifactIds).toEqual([logArtifact.id]);
    expect(results[2]?.evidenceArtifactIds).toEqual(["artifact-after"]);
  });

  it("passes text expectations that use foreground activity as a state anchor", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      getForegroundApp: async () => ({
        packageName: "cn.eeo.classin",
        activityName: "cn.eeo.classin.ClassDetailActivity",
        componentName: "cn.eeo.classin/.ClassDetailActivity"
      }),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([
      expectation("text", {
        activityName: "cn.eeo.classin.ClassDetailActivity",
        mode: "exists",
        timeoutMs: 20,
        intervalMs: 1
      })
    ]);

    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "text",
        status: "passed",
        expected: "Foreground activity is cn.eeo.classin.ClassDetailActivity.",
        actual: "Foreground package=cn.eeo.classin, activity=cn.eeo.classin.ClassDetailActivity, component=cn.eeo.classin/.ClassDetailActivity.",
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
  });

  it("fails foreground activity state anchors when the current activity differs", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      getForegroundApp: async () => ({
        packageName: "cn.eeo.classin",
        activityName: "cn.eeo.classin.HomeActivity",
        componentName: "cn.eeo.classin/.HomeActivity"
      }),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([
      expectation("text", {
        activityName: "cn.eeo.classin.ClassDetailActivity",
        mode: "exists",
        timeoutMs: 20,
        intervalMs: 1
      })
    ]);

    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results[0]).toEqual(
      expect.objectContaining({
        type: "text",
        status: "failed",
        expected: "Foreground activity is cn.eeo.classin.ClassDetailActivity.",
        actual: "Foreground package=cn.eeo.classin, activity=cn.eeo.classin.HomeActivity, component=cn.eeo.classin/.HomeActivity."
      })
    );
  });

  it("evaluates explicit performance regression baselines", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("performance_not_regressed", { metric: "cpuPercent", baseline: 30, tolerancePercent: 10 })]);

    const passed = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      metric: metricSample({ cpuPercent: 32 }),
      runtimeFailure: false
    });
    const failed = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      metric: metricSample({ cpuPercent: 40 }),
      runtimeFailure: false
    });

    expect(passed[0]).toEqual(
      expect.objectContaining({
        type: "performance_not_regressed",
        status: "passed",
        expected: "cpuPercent <= 33 (baseline 30, tolerance 10%)"
      })
    );
    expect(failed[0]).toEqual(
      expect.objectContaining({
        type: "performance_not_regressed",
        status: "failed",
        reason: "Metric regression is above the configured tolerance."
      })
    );
  });

  it("marks no_crash failed when a runtime failure was observed", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("no_crash", {})]);
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: true
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "no_crash",
        status: "failed",
        actual: "Crash or ANR event was observed."
      })
    ]);
  });

  it("passes text expectations that use a resource-id state anchor from Android UI hierarchy", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/title"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("text", { resourceId: "com.demo:id/title", mode: "exists", timeoutMs: 20, intervalMs: 1 })]);

    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "text",
        status: "passed",
        expected: "UI element exists with resourceId=com.demo:id/title.",
        reason: "Matched by Android UI hierarchy element attributes.",
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
  });

  it("passes element existence expectations for repeated content descriptions by occurrence", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      dumpUiHierarchy: async () => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="" class="android.widget.ImageView" package="com.demo" content-desc="course Photo" clickable="true" enabled="true" bounds="[100,500][400,800]" />
    <node index="1" text="" resource-id="" class="android.widget.ImageView" package="com.demo" content-desc="course Photo" clickable="true" enabled="true" bounds="[500,500][800,800]" />
  </node>
</hierarchy>`,
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("text", { contentDesc: "course Photo", occurrence: 2, mode: "exists", timeoutMs: 20, intervalMs: 1 })]);

    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "text",
        status: "passed",
        expected: "UI element exists with contentDesc=course Photo, occurrence=2.",
        actual: expect.stringContaining("Matched occurrence 2 UI element")
      })
    ]);
  });

  it("fails text expectations when a resource-id state anchor is missing", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      dumpUiHierarchy: async () => hierarchy("com.demo:id/other"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("text", { resourceId: "com.demo:id/title", mode: "exists", timeoutMs: 20, intervalMs: 1 })]);

    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "text",
        status: "failed",
        expected: "UI element exists with resourceId=com.demo:id/title.",
        reason: expect.stringContaining("Android UI hierarchy did not contain the expected element.")
      })
    ]);
  });

  it("marks image expectations pending review before a baseline is approved", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("image", { threshold: 0.9 })]);
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "after"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "image",
        status: "pending_review",
        evidenceArtifactIds: ["artifact-after"]
      })
    ]);
  });

  it("passes image expectations when the approved baseline is similar enough", async () => {
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async () => artifact("artifact-log", "log"),
      readArtifact: async () => Buffer.from("abcdef"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("image", { baselineArtifactId: "artifact-baseline", threshold: 0.9 })]);
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "abcdef"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "image",
        status: "passed",
        evidenceArtifactIds: ["artifact-baseline", "artifact-after"]
      })
    ]);
  });

  it("fails image expectations and writes diff evidence when similarity is below threshold", async () => {
    const diffArtifact = artifact("artifact-diff", "log");
    const evaluator = new StepExpectationEvaluator({
      ocr: new FakeOcrService(""),
      collectLogs: async () => "",
      writeLog: async (_runId, _fileName, content) => {
        expect(content).toContain("similarity=");
        return diffArtifact;
      },
      readArtifact: async () => Buffer.from("abcdef"),
      captureExpectationScreenshot: async () => screenshot("artifact-retry", "retry")
    });
    const step = actionStep([expectation("image", { baselineArtifactId: "artifact-baseline", threshold: 0.9 })]);
    const results = await evaluator.evaluate({
      runId: "run-1",
      serial: "device-1",
      stepResultId: "step-result-1",
      step,
      afterScreenshot: screenshot("artifact-after", "zzzzzz"),
      runtimeFailure: false
    });

    expect(results).toEqual([
      expect.objectContaining({
        type: "image",
        status: "failed",
        evidenceArtifactIds: ["artifact-baseline", "artifact-after", "artifact-diff"]
      })
    ]);
  });
});

function actionStep(expectations: StepExpectation[]): ActionStep {
  return {
    id: "step-1",
    order: 1,
    type: "tap",
    enabled: true,
    params: {},
    coordinate: { x: 1, y: 2 },
    expectations,
    createdAt: "2026-06-09T00:00:00.000Z"
  };
}

function expectation(type: StepExpectation["type"], params: Record<string, unknown>): StepExpectation {
  return {
    id: `expectation-${type}`,
    type,
    enabled: true,
    params,
    createdAt: "2026-06-09T00:00:00.000Z"
  };
}

function metricSample(overrides: Partial<MetricSample>): MetricSample {
  return {
    id: "metric-1",
    runId: "run-1",
    deviceSerial: "device-1",
    sampledAt: "2026-06-09T00:00:00.000Z",
    ...overrides
  };
}

function screenshot(artifactId: string, content: string): ScreenshotCapture {
  return {
    artifact: artifact(artifactId, "screenshot"),
    png: Buffer.from(content)
  };
}

function artifact(id: string, type: ArtifactRef["type"]): ArtifactRef {
  return {
    id,
    type,
    name: `${id}.${type === "screenshot" ? "png" : "txt"}`,
    path: `runs/run-1/${id}`,
    url: `/artifacts/runs/run-1/${id}`,
    createdAt: "2026-06-09T00:00:00.000Z"
  };
}

function hierarchy(resourceId: string): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="新建课堂" resource-id="${resourceId}" class="android.widget.TextView" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
  </node>
</hierarchy>`;
}

class FakeOcrService implements OcrService {
  constructor(private readonly text: string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    return {
      text: this.text,
      engine: "fake",
      lang: "zh-Hans"
    };
  }
}
