import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createId,
  nowIso,
  type ActionStep,
  type ArtifactRef,
  type MetricSample,
  type StepExpectation,
  type StepExpectationResult
} from "@mobile-automation/shared";
import type { OcrLayoutResult, OcrResult, OcrService } from "./ocr.js";
import { parseAndroidUiHierarchy } from "./ui-hierarchy-locator.js";

export type ScreenshotCapture = {
  artifact: ArtifactRef;
  png: Buffer;
};

export type TextExpectationMode = "contains" | "equals" | "not_contains";

export type OcrRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageStateExpectationOutcome = {
  status: "matched" | "multiple_candidates" | "unknown" | "outside_app" | "capture_failed";
  pageName?: string;
  candidateNames?: string[];
  observedText?: string;
  actualAppId?: string;
  reason?: string;
};

export type PageStateExpectationVerifier = (input: {
  serial: string;
  appId: string;
  platform: "android" | "ios" | "harmony" | "flutter";
  pageId: string;
  timeoutMs: number;
  screenshot?: Buffer;
}) => Promise<PageStateExpectationOutcome>;

type StepExpectationEvaluatorDeps = {
  ocr: OcrService;
  collectLogs: (serial: string, tailLines: number) => Promise<string>;
  writeLog: (runId: string, fileName: string, content: string, stepResultId?: string) => Promise<ArtifactRef>;
  readArtifact?: (runId: string, artifactId: string) => Promise<Buffer | undefined>;
  writeExpectationImageArtifact?: (runId: string, stepResultId: string, fileName: string, png: Buffer) => Promise<ArtifactRef>;
  getForegroundApp?: (serial: string) => Promise<{ packageName?: string; activityName?: string; componentName?: string }>;
  captureExpectationScreenshot: (
    runId: string,
    stepResultId: string,
    serial: string,
    expectationId: string,
    attempt: number
  ) => Promise<ScreenshotCapture>;
  dumpUiHierarchy?: (serial: string) => Promise<string>;
  verifyPageState?: PageStateExpectationVerifier;
};

export class StepExpectationEvaluator {
  constructor(private readonly deps: StepExpectationEvaluatorDeps) {}

  async evaluate(input: {
    runId: string;
    serial: string;
    stepResultId: string;
    step: ActionStep;
    beforeScreenshot?: ScreenshotCapture;
    afterScreenshot?: ScreenshotCapture;
    metric?: MetricSample;
    runtimeFailure: boolean;
  }): Promise<StepExpectationResult[]> {
    const expectations = enabledExpectations(input.step);
    if (!expectations.length) {
      return [];
    }

    const results: StepExpectationResult[] = [];
    for (const expectation of expectations) {
      if (expectation.type === "no_crash") {
        results.push(
          this.createExpectationResult(expectation, {
            status: input.runtimeFailure ? "failed" : "passed",
            expected: "No crash or ANR is observed during this step.",
            actual: input.runtimeFailure ? "Crash or ANR event was observed." : "No crash or ANR event was observed.",
            reason: input.runtimeFailure ? "Device event watcher reported a runtime failure." : undefined,
            evidenceArtifactIds: input.afterScreenshot ? [input.afterScreenshot.artifact.id] : []
          })
        );
        continue;
      }

      if (expectation.type === "app_alive") {
        const alive = !input.runtimeFailure && Boolean(input.afterScreenshot);
        results.push(
          this.createExpectationResult(expectation, {
            status: alive ? "passed" : "failed",
            expected: "Device remains responsive after the step.",
            actual: alive ? "A screenshot was captured and no runtime failure was observed." : "Device responsiveness could not be confirmed.",
            reason: alive ? undefined : "Screenshot capture failed or a crash/ANR was observed.",
            evidenceArtifactIds: input.afterScreenshot ? [input.afterScreenshot.artifact.id] : []
          })
        );
        continue;
      }

      if (expectation.type === "screen_changed") {
        let screenResult = this.evaluateScreenChangedExpectation(expectation, input.beforeScreenshot, input.afterScreenshot);
        if (screenResult.status === "failed" && input.beforeScreenshot && isBlockingExpectation(expectation)) {
          screenResult = await this.waitForScreenChangedExpectation({
            expectation,
            runId: input.runId,
            stepResultId: input.stepResultId,
            serial: input.serial,
            beforeScreenshot: input.beforeScreenshot,
            initialResult: screenResult
          });
        }
        results.push(screenResult);
        continue;
      }

      if (expectation.type === "metric_below") {
        results.push(this.evaluateMetricBelow(expectation, input.metric));
        continue;
      }

      if (expectation.type === "performance_not_regressed") {
        results.push(this.evaluatePerformanceNotRegressed(expectation, input.metric));
        continue;
      }

      if (expectation.type === "log_not_contains") {
        results.push(await this.evaluateLogNotContains(expectation, input.runId, input.serial, input.stepResultId));
        continue;
      }

      if (expectation.type === "image") {
        results.push(await this.evaluateImageExpectation(expectation, input.runId, input.stepResultId, input.afterScreenshot));
        continue;
      }

      if (expectation.type === "state_is") {
        results.push(await this.evaluateStateExpectation(expectation, input.serial, input.afterScreenshot));
        continue;
      }

      const textResult = await this.evaluateTextExpectation(expectation, input.afterScreenshot, input.serial);
      results.push(textResult);
      if (textResult.status === "failed" && isBlockingExpectation(expectation)) {
        const retryResult = await this.waitForTextExpectation({
          expectation,
          runId: input.runId,
          stepResultId: input.stepResultId,
          serial: input.serial,
          initialResult: textResult
        });
        results[results.length - 1] = retryResult;
      }
    }
    return results;
  }

  private async waitForTextExpectation(input: {
    expectation: StepExpectation;
    runId: string;
    stepResultId: string;
    serial: string;
    initialResult: StepExpectationResult;
  }): Promise<StepExpectationResult> {
    const timeoutMs = expectationTimeoutMs(input.expectation, 8000);
    const intervalMs = expectationIntervalMs(input.expectation, 800);
    const started = Date.now();
    let attempt = 1;
    let latest = input.initialResult;

    while (latest.status === "failed" && Date.now() - started < timeoutMs) {
      await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - started))));
      attempt += 1;
      const screenshot = await this.deps.captureExpectationScreenshot(input.runId, input.stepResultId, input.serial, input.expectation.id, attempt);
      latest = await this.evaluateTextExpectation(input.expectation, screenshot, input.serial);
    }

    if (latest.status === "passed" && attempt > 1) {
      return {
        ...latest,
        reason: `Matched after ${attempt} observation attempts over ${Date.now() - started}ms.`
      };
    }
    if (latest.status === "failed" && attempt > 1) {
      return {
        ...latest,
        reason: `${latest.reason ?? "Text expectation did not match."} Retried ${attempt} observation attempts over ${Date.now() - started}ms.`
      };
    }
    return latest;
  }

  private async waitForScreenChangedExpectation(input: {
    expectation: StepExpectation;
    runId: string;
    stepResultId: string;
    serial: string;
    beforeScreenshot: ScreenshotCapture;
    initialResult: StepExpectationResult;
  }): Promise<StepExpectationResult> {
    const timeoutMs = expectationTimeoutMs(input.expectation, 8000);
    const intervalMs = expectationIntervalMs(input.expectation, 800);
    const started = Date.now();
    let attempt = 1;
    let latest = input.initialResult;

    while (latest.status === "failed" && Date.now() - started < timeoutMs) {
      await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - started))));
      attempt += 1;
      const screenshot = await this.deps.captureExpectationScreenshot(input.runId, input.stepResultId, input.serial, input.expectation.id, attempt);
      latest = this.evaluateScreenChangedExpectation(input.expectation, input.beforeScreenshot, screenshot);
    }

    if (latest.status === "passed" && attempt > 1) {
      return {
        ...latest,
        reason: `Matched after ${attempt} observation attempts over ${Date.now() - started}ms.`
      };
    }
    if (latest.status === "failed" && attempt > 1) {
      return {
        ...latest,
        reason: `${latest.reason ?? "Screen did not change."} Retried ${attempt} observation attempts over ${Date.now() - started}ms.`
      };
    }
    return latest;
  }

  private evaluateScreenChangedExpectation(
    expectation: StepExpectation,
    beforeScreenshot: ScreenshotCapture | undefined,
    afterScreenshot: ScreenshotCapture | undefined
  ): StepExpectationResult {
    const canCompare = Boolean(beforeScreenshot && afterScreenshot);
    const changed = canCompare && !beforeScreenshot!.png.equals(afterScreenshot!.png);
    return this.createExpectationResult(expectation, {
      status: canCompare ? (changed ? "passed" : "failed") : "unsupported",
      expected: "The screen image changes after this step.",
      actual: canCompare ? (changed ? "Screen changed." : "Screen did not change.") : "Before/after screenshots are unavailable.",
      reason: canCompare && !changed ? "Before and after screenshots are byte-identical." : undefined,
      evidenceArtifactIds: [beforeScreenshot?.artifact.id, afterScreenshot?.artifact.id].filter((id): id is string => Boolean(id))
    });
  }

  private async evaluateTextExpectation(
    expectation: StepExpectation,
    screenshot: ScreenshotCapture | undefined,
    serial: string
  ): Promise<StepExpectationResult> {
    const activityExpectation = readActivityExpectation(expectation.params);
    if (activityExpectation) {
      const activityResult = await this.evaluateActivityExpectation(expectation, serial, activityExpectation, screenshot);
      if (activityResult) {
        return activityResult;
      }
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: activityExpectedDescription(activityExpectation),
        actual: "Foreground activity is unavailable.",
        reason: "Activity expectations need foreground app observation.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }

    const elementExpectation = readUiElementExpectation(expectation.params);
    if (elementExpectation) {
      const hierarchyResult = await this.evaluateElementExpectationFromUiHierarchy(expectation, serial, elementExpectation, screenshot);
      if (hierarchyResult) {
        return hierarchyResult;
      }
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: uiElementExpectedDescription(elementExpectation),
        actual: "Android UI hierarchy is unavailable.",
        reason: "Element visibility expectations need a UI hierarchy dump.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }

    const expected = typeof expectation.params.expected === "string" ? expectation.params.expected.trim() : "";
    const mode = textExpectationMode(expectation.params.mode);
    if (!expected) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: "OCR text expectation must configure expected text.",
        actual: "No expected text was configured.",
        reason: "Set the expected text before enabling this expectation.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }

    let region: OcrRegion | undefined;
    try {
      region = readOcrRegion(expectation.params);
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: textExpectedDescription(mode, expected),
        actual: "OCR region is invalid.",
        reason: errorToString(error),
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }

    if (!region && expectation.params.source !== "ocr") {
      const hierarchyResult = await this.evaluateTextExpectationFromUiHierarchy(expectation, serial, expected, mode, screenshot);
      if (hierarchyResult?.status === "passed") {
        return hierarchyResult;
      }
    }

    if (!screenshot) {
      return this.createExpectationResult(expectation, {
        status: "failed",
        expected: textExpectedDescription(mode, expected, region),
        actual: "Screen text could not be observed.",
        reason: "Neither Android UI hierarchy text nor screenshot OCR was available.",
        evidenceArtifactIds: []
      });
    }

    try {
      const lang = typeof expectation.params.lang === "string" ? expectation.params.lang : undefined;
      const image = region ? await cropPngRegion(screenshot.png, region) : screenshot.png;
      const ocrResult = await recognizeForTextExpectation(this.deps.ocr, { image, lang, mode });
      const actualText = normalizeOcrText(ocrResult.text);
      const expectedText = normalizeOcrText(expected);
      const matched = matchOcrResultExpectation(ocrResult, actualText, expectedText, mode);
      return this.createExpectationResult(expectation, {
        status: matched ? "passed" : "failed",
        expected: textExpectedDescription(mode, expected, region),
        actual: actualText || "(empty OCR result)",
        reason: matched ? undefined : `OCR ${ocrResult.engine} (${ocrResult.lang}) did not satisfy the text expectation.`,
        evidenceArtifactIds: [screenshot.artifact.id]
      });
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: textExpectedDescription(mode, expected, region),
        actual: "OCR could not be executed.",
        reason: errorToString(error),
        evidenceArtifactIds: [screenshot.artifact.id]
      });
    }
  }

  private async evaluateActivityExpectation(
    expectation: StepExpectation,
    serial: string,
    expectedActivityName: string,
    screenshot: ScreenshotCapture | undefined
  ): Promise<StepExpectationResult | undefined> {
    if (!this.deps.getForegroundApp) {
      return undefined;
    }
    try {
      const foreground = await this.deps.getForegroundApp(serial);
      const passed = foreground.activityName === expectedActivityName;
      return this.createExpectationResult(expectation, {
        status: passed ? "passed" : "failed",
        expected: activityExpectedDescription(expectedActivityName),
        actual: activityActualDescription(foreground),
        reason: passed ? "Matched by foreground activity observation." : "Foreground activity did not match the expected page state.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: activityExpectedDescription(expectedActivityName),
        actual: "Foreground activity could not be observed.",
        reason: errorToString(error),
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }
  }

  private async evaluateTextExpectationFromUiHierarchy(
    expectation: StepExpectation,
    serial: string,
    expected: string,
    mode: TextExpectationMode,
    screenshot: ScreenshotCapture | undefined
  ): Promise<StepExpectationResult | undefined> {
    if (!this.deps.dumpUiHierarchy) {
      return undefined;
    }

    try {
      const xml = await this.deps.dumpUiHierarchy(serial);
      const actualText = normalizeOcrText(
        parseAndroidUiHierarchy(xml)
          .flatMap((candidate) => [candidate.text, candidate.contentDesc])
          .filter((value): value is string => Boolean(value?.trim()))
          .join(" ")
      );
      const matched = matchTextExpectation(actualText, normalizeOcrText(expected), mode);
      return this.createExpectationResult(expectation, {
        status: matched ? "passed" : "failed",
        expected: textExpectedDescription(mode, expected),
        actual: actualText || "(empty UI hierarchy text)",
        reason: matched ? "Matched by Android UI hierarchy text." : "Android UI hierarchy text did not satisfy the text expectation.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    } catch {
      return undefined;
    }
  }

  private async evaluateElementExpectationFromUiHierarchy(
    expectation: StepExpectation,
    serial: string,
    elementExpectation: UiElementExpectation,
    screenshot: ScreenshotCapture | undefined
  ): Promise<StepExpectationResult | undefined> {
    if (!this.deps.dumpUiHierarchy) {
      return undefined;
    }

    try {
      const xml = await this.deps.dumpUiHierarchy(serial);
      const candidates = parseAndroidUiHierarchy(xml);
      const matched = selectUiElementExpectationMatches(candidates, elementExpectation);
      return this.createExpectationResult(expectation, {
        status: matched.length > 0 ? "passed" : "failed",
        expected: uiElementExpectedDescription(elementExpectation),
        actual:
          matched.length > 0
            ? uiElementMatchDescription(elementExpectation, matched)
            : `No UI element matched among ${candidates.length} parsed node(s).`,
        reason: matched.length > 0 ? "Matched by Android UI hierarchy element attributes." : "Android UI hierarchy did not contain the expected element.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    } catch {
      return undefined;
    }
  }

  private evaluateMetricBelow(expectation: StepExpectation, metric: MetricSample | undefined): StepExpectationResult {
    const metricName = typeof expectation.params.metric === "string" ? expectation.params.metric : "cpuPercent";
    const threshold = typeof expectation.params.threshold === "number" ? expectation.params.threshold : Number(expectation.params.threshold);
    const actualValue = metric ? metricValue(metric, metricName) : undefined;
    if (!Number.isFinite(threshold) || actualValue === undefined) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: `${metricName} below ${String(expectation.params.threshold ?? "-")}`,
        actual: actualValue === undefined ? "Metric sample is unavailable." : `${actualValue}`,
        reason: "Metric name or threshold is invalid for this step.",
        evidenceArtifactIds: []
      });
    }
    const passed = actualValue <= threshold;
    return this.createExpectationResult(expectation, {
      status: passed ? "passed" : "failed",
      expected: `${metricName} <= ${threshold}`,
      actual: `${metricName} = ${actualValue}`,
      reason: passed ? undefined : "Metric value is above the configured threshold.",
      evidenceArtifactIds: []
    });
  }

  private evaluatePerformanceNotRegressed(expectation: StepExpectation, metric: MetricSample | undefined): StepExpectationResult {
    const metricName = typeof expectation.params.metric === "string" ? expectation.params.metric : "cpuPercent";
    const baseline = numberParam(expectation.params.baseline ?? expectation.params.baselineValue);
    const tolerancePercent = positiveNumberParam(expectation.params.tolerancePercent, 10);
    const actualValue = metric ? metricValue(metric, metricName) : undefined;
    if (baseline === undefined || actualValue === undefined) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: `${metricName} does not regress beyond ${tolerancePercent}% from baseline ${String(expectation.params.baseline ?? expectation.params.baselineValue ?? "-")}.`,
        actual: actualValue === undefined ? "Metric sample is unavailable." : `${metricName} = ${actualValue}`,
        reason: "performance_not_regressed requires a numeric baseline and an available metric sample.",
        evidenceArtifactIds: []
      });
    }
    const allowed = baseline * (1 + tolerancePercent / 100);
    const passed = actualValue <= allowed;
    const regressionPercent = baseline === 0 ? (actualValue > 0 ? Number.POSITIVE_INFINITY : 0) : ((actualValue - baseline) / Math.abs(baseline)) * 100;
    return this.createExpectationResult(expectation, {
      status: passed ? "passed" : "failed",
      expected: `${metricName} <= ${formatNumber(allowed)} (baseline ${formatNumber(baseline)}, tolerance ${tolerancePercent}%)`,
      actual: `${metricName} = ${formatNumber(actualValue)} (${formatNumber(regressionPercent)}% vs baseline)`,
      reason: passed ? undefined : "Metric regression is above the configured tolerance.",
      evidenceArtifactIds: []
    });
  }

  private async evaluateStateExpectation(
    expectation: StepExpectation,
    serial: string,
    screenshot: ScreenshotCapture | undefined
  ): Promise<StepExpectationResult> {
    const appId = stringParam(expectation.params.appId);
    const pageId = stringParam(expectation.params.pageId ?? expectation.params.nodeId);
    const platform = pageStatePlatform(expectation.params.platform);
    if (!this.deps.verifyPageState || !appId || !pageId || !platform) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: pageId ? `Page ${pageId}` : stateExpectedDescription(expectation),
        actual: "Page-state verifier or required page identity fields are unavailable.",
        reason: "state_is requires verifyPageState, appId, platform, and pageId.",
        evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
      });
    }
    const outcome = await this.deps.verifyPageState({
      serial,
      appId,
      platform,
      pageId,
      timeoutMs: expectationTimeoutMs(expectation, 8_000),
      screenshot: screenshot?.png
    });
    const passed = outcome.status === "matched";
    const actual = outcome.pageName
      ?? (outcome.status === "multiple_candidates" ? outcome.candidateNames?.join(", ") : outcome.observedText)
      ?? outcome.candidateNames?.join(", ")
      ?? outcome.actualAppId
      ?? outcome.status;
    return this.createExpectationResult(expectation, {
      status: passed ? "passed" : "failed",
      expected: `Page ${pageId}`,
      actual,
      reason: passed ? undefined : outcome.reason ?? outcome.status,
      evidenceArtifactIds: screenshot ? [screenshot.artifact.id] : []
    });
  }

  private async evaluateLogNotContains(expectation: StepExpectation, runId: string, serial: string, stepResultId: string): Promise<StepExpectationResult> {
    const text = typeof expectation.params.text === "string" ? expectation.params.text : "";
    if (!text.trim()) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: "Log must not contain a configured text fragment.",
        actual: "No text fragment was configured.",
        reason: "Set the text parameter before enabling this expectation.",
        evidenceArtifactIds: []
      });
    }

    try {
      const logs = await this.deps.collectLogs(serial, 500);
      const artifact = await this.deps.writeLog(runId, `step-${stepResultId}-expectation-log.txt`, logs, stepResultId);
      const contains = logs.includes(text);
      return this.createExpectationResult(expectation, {
        status: contains ? "failed" : "passed",
        expected: `Log does not contain "${text}".`,
        actual: contains ? `Log contains "${text}".` : `Log does not contain "${text}".`,
        reason: contains ? "Forbidden text was found in collected logs." : undefined,
        evidenceArtifactIds: [artifact.id]
      });
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: `Log does not contain "${text}".`,
        actual: "Logs could not be collected.",
        reason: errorToString(error),
        evidenceArtifactIds: []
      });
    }
  }

  private async evaluateImageExpectation(
    expectation: StepExpectation,
    runId: string,
    stepResultId: string,
    screenshot: ScreenshotCapture | undefined
  ): Promise<StepExpectationResult> {
    const baselineArtifactId = typeof expectation.params.baselineArtifactId === "string" ? expectation.params.baselineArtifactId : "";
    const threshold = imageThreshold(expectation.params.threshold);
    if (!screenshot) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: imageExpectedDescription(threshold),
        actual: "Screenshot is unavailable.",
        reason: "Image comparison needs the step screenshot as input.",
        evidenceArtifactIds: []
      });
    }

    if (!baselineArtifactId) {
      return this.createExpectationResult(expectation, {
        status: "pending_review",
        expected: imageExpectedDescription(threshold),
        actual: "No approved baseline image is attached yet.",
        reason: "Capture and approve a baseline before this expectation can pass automatically.",
        evidenceArtifactIds: [screenshot.artifact.id]
      });
    }

    if (!this.deps.readArtifact) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: imageExpectedDescription(threshold),
        actual: "Baseline artifact cannot be read.",
        reason: "Image comparison storage adapter is not configured.",
        evidenceArtifactIds: [baselineArtifactId, screenshot.artifact.id]
      });
    }

    const baseline = await this.deps.readArtifact(runId, baselineArtifactId);
    if (!baseline) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: imageExpectedDescription(threshold),
        actual: `Baseline artifact ${baselineArtifactId} was not found.`,
        reason: "Approve or attach a valid baseline artifact before enabling this expectation.",
        evidenceArtifactIds: [screenshot.artifact.id]
      });
    }

    let region: OcrRegion | undefined;
    try {
      region = readOcrRegion(expectation.params);
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: imageExpectedDescription(threshold),
        actual: "Image comparison region is invalid.",
        reason: errorToString(error),
        evidenceArtifactIds: [baselineArtifactId, screenshot.artifact.id]
      });
    }

    try {
      const actualImage = region ? await cropPngRegion(screenshot.png, region) : screenshot.png;
      const baselineImage = region ? await cropPngRegion(baseline, region) : baseline;
      const similarity = imageBufferSimilarity(actualImage, baselineImage);
      const passed = similarity >= threshold;
      const evidenceArtifactIds = [baselineArtifactId, screenshot.artifact.id];
      let diffArtifact: ArtifactRef | undefined;
      if (!passed) {
        diffArtifact = await this.writeImageDiffArtifact(runId, stepResultId, expectation, similarity, threshold, baselineArtifactId, screenshot.artifact.id);
        if (diffArtifact) {
          evidenceArtifactIds.push(diffArtifact.id);
        }
      }
      return this.createExpectationResult(expectation, {
        status: passed ? "passed" : "failed",
        expected: imageExpectedDescription(threshold, region),
        actual: `Image similarity = ${similarity.toFixed(4)}.`,
        reason: passed ? undefined : "Image similarity is below the configured threshold.",
        evidenceArtifactIds
      });
    } catch (error) {
      return this.createExpectationResult(expectation, {
        status: "unsupported",
        expected: imageExpectedDescription(threshold, region),
        actual: "Image comparison could not be executed.",
        reason: errorToString(error),
        evidenceArtifactIds: [baselineArtifactId, screenshot.artifact.id]
      });
    }
  }

  private async writeImageDiffArtifact(
    runId: string,
    stepResultId: string,
    expectation: StepExpectation,
    similarity: number,
    threshold: number,
    baselineArtifactId: string,
    actualArtifactId: string
  ): Promise<ArtifactRef | undefined> {
    const content = [
      "Image expectation diff summary",
      `expectationId=${expectation.id}`,
      `baselineArtifactId=${baselineArtifactId}`,
      `actualArtifactId=${actualArtifactId}`,
      `similarity=${similarity.toFixed(6)}`,
      `threshold=${threshold}`
    ].join("\n");
    return this.deps.writeLog(runId, `step-${stepResultId}-image-diff-${expectation.id}.txt`, content, stepResultId).catch(() => undefined);
  }

  private createExpectationResult(
    expectation: StepExpectation,
    input: Omit<StepExpectationResult, "id" | "expectationId" | "type" | "blocking" | "checkedAt">
  ): StepExpectationResult {
    return {
      id: createId("expectation_result"),
      expectationId: expectation.id,
      type: expectation.type,
      status: input.status,
      blocking: isBlockingExpectation(expectation),
      expected: input.expected,
      actual: input.actual,
      reason: input.reason,
      evidenceArtifactIds: input.evidenceArtifactIds,
      checkedAt: nowIso()
    };
  }
}

export async function tryRecognizeTextFromScreenshot(ocr: OcrService, screenshot: ScreenshotCapture, params: Record<string, unknown>): Promise<string> {
  try {
    const lang = typeof params.lang === "string" ? params.lang : undefined;
    const mode = textExpectationMode(params.mode);
    const region = readOcrRegion(params);
    const image = region ? await cropPngRegion(screenshot.png, region) : screenshot.png;
    const ocrResult = await ocr.recognize({ image, lang, mode });
    return ocrResult.text;
  } catch {
    return "";
  }
}

export function enabledExpectations(step: ActionStep): StepExpectation[] {
  return (step.expectations ?? []).filter((expectation) => expectation.enabled);
}

export function shouldFailStepForExpectation(step: ActionStep, result: StepExpectationResult): boolean {
  if (result.status === "passed" || result.status === "pending_review") {
    return false;
  }
  if (result.blocking === false) {
    return false;
  }
  if (result.blocking === true) {
    return true;
  }
  const expectation = (step.expectations ?? []).find((item) => item.id === result.expectationId);
  return isBlockingExpectation(expectation);
}

export function annotateNonBlockingExpectationResults(step: ActionStep, results: StepExpectationResult[]): StepExpectationResult[] {
  return results.map((result) => {
    const expectation = (step.expectations ?? []).find((item) => item.id === result.expectationId);
    const blocking = result.blocking ?? isBlockingExpectation(expectation);
    if (result.status === "passed" || result.status === "pending_review" || blocking) {
      return {
        ...result,
        blocking
      };
    }
    return {
      ...result,
      blocking,
      reason: [result.reason, "Non-blocking expectation; recorded for review and does not fail the step."].filter(Boolean).join(" ")
    };
  });
}

export function isBlockingExpectation(expectation: StepExpectation | undefined): boolean {
  if (!expectation) {
    return true;
  }
  if (expectation.params.blocking === false) {
    return false;
  }
  if (expectation.params.autoGenerated === true && expectation.params.reliability === "P1") {
    return false;
  }
  return true;
}

export function textExpectationMode(value: unknown): TextExpectationMode {
  if (value === "equals" || value === "not_contains") {
    return value;
  }
  return "contains";
}

export function expectationTimeoutMs(expectation: StepExpectation, fallback: number): number {
  const value = expectation.params.timeoutMs ?? expectation.params.waitTimeoutMs;
  return positiveNumberParam(value, fallback);
}

export function expectationIntervalMs(expectation: StepExpectation, fallback: number): number {
  const value = expectation.params.intervalMs ?? expectation.params.pollIntervalMs;
  return positiveNumberParam(value, fallback);
}

export function positiveNumberParam(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export function matchTextExpectation(actual: string, expected: string, mode: TextExpectationMode): boolean {
  if (mode === "equals") {
    return actual === expected;
  }
  if (mode === "not_contains") {
    return !actual.includes(expected);
  }
  return actual.includes(expected);
}

async function recognizeForTextExpectation(
  ocr: OcrService,
  input: Parameters<OcrService["recognize"]>[0]
): Promise<OcrResult | OcrLayoutResult> {
  if (input.mode === "equals" && ocr.locateText) {
    return ocr.locateText(input);
  }
  return ocr.recognize(input);
}

function matchOcrResultExpectation(
  result: OcrResult | OcrLayoutResult,
  actualText: string,
  expectedText: string,
  mode: TextExpectationMode
): boolean {
  if (mode !== "equals" || !("boxes" in result)) {
    return matchTextExpectation(actualText, expectedText, mode);
  }
  return result.boxes.some((box) => normalizeOcrText(box.text) === expectedText)
    || matchTextExpectation(actualText, expectedText, mode);
}

export function textExpectedDescription(mode: TextExpectationMode, expected: string, region?: OcrRegion): string {
  const scope = region ? ` in region x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}` : "";
  if (mode === "equals") {
    return `OCR text${scope} equals "${expected}".`;
  }
  if (mode === "not_contains") {
    return `OCR text${scope} does not contain "${expected}".`;
  }
  return `OCR text${scope} contains "${expected}".`;
}

type UiElementExpectation = {
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  text?: string;
  occurrence?: number;
};

type ParsedUiElement = ReturnType<typeof parseAndroidUiHierarchy>[number];

function readUiElementExpectation(params: Record<string, unknown>): UiElementExpectation | undefined {
  const resourceId = stringParam(params.resourceId);
  const contentDesc = stringParam(params.contentDesc ?? params.accessibilityId);
  const className = stringParam(params.className);
  const text = typeof params.expected === "string" && params.mode === "exists" ? params.expected.trim() : undefined;
  const occurrence = occurrenceParam(params.occurrence);
  if (!resourceId && !contentDesc && !className && !text) {
    return undefined;
  }
  return {
    resourceId,
    contentDesc,
    className,
    text,
    occurrence
  };
}

function matchesUiElementExpectation(candidate: ParsedUiElement, expectation: UiElementExpectation): boolean {
  if (expectation.resourceId && candidate.resourceId !== expectation.resourceId) {
    return false;
  }
  if (expectation.contentDesc && candidate.contentDesc !== expectation.contentDesc) {
    return false;
  }
  if (expectation.className && candidate.className !== expectation.className) {
    return false;
  }
  if (expectation.text && candidate.text !== expectation.text) {
    return false;
  }
  return true;
}

function uiElementExpectedDescription(expectation: UiElementExpectation): string {
  return `UI element exists with ${[
    expectation.resourceId ? `resourceId=${expectation.resourceId}` : undefined,
    expectation.contentDesc ? `contentDesc=${expectation.contentDesc}` : undefined,
    expectation.className ? `className=${expectation.className}` : undefined,
    expectation.text ? `text=${expectation.text}` : undefined,
    expectation.occurrence ? `occurrence=${expectation.occurrence}` : undefined
  ]
    .filter(Boolean)
    .join(", ")}.`;
}

function selectUiElementExpectationMatches(candidates: ParsedUiElement[], expectation: UiElementExpectation): ParsedUiElement[] {
  const matched = candidates.filter((candidate) => matchesUiElementExpectation(candidate, expectation)).sort(compareUiElementVisualOrder);
  if (!expectation.occurrence) {
    return matched;
  }
  const occurrenceMatch = matched[expectation.occurrence - 1];
  return occurrenceMatch ? [occurrenceMatch] : [];
}

function uiElementMatchDescription(expectation: UiElementExpectation, matched: ParsedUiElement[]): string {
  if (expectation.occurrence) {
    return `Matched occurrence ${expectation.occurrence} UI element: ${matched.map(uiElementActualDescription).join("; ")}`;
  }
  return `Matched ${matched.length} UI element(s): ${matched.map(uiElementActualDescription).join("; ")}`;
}

function uiElementActualDescription(candidate: ParsedUiElement): string {
  return [
    candidate.resourceId ? `resourceId=${candidate.resourceId}` : undefined,
    candidate.contentDesc ? `contentDesc=${candidate.contentDesc}` : undefined,
    candidate.className ? `className=${candidate.className}` : undefined,
    candidate.text ? `text=${candidate.text}` : undefined
  ]
    .filter(Boolean)
    .join(", ");
}

function compareUiElementVisualOrder(left: ParsedUiElement, right: ParsedUiElement): number {
  return left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left || left.nodeId - right.nodeId;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pageStatePlatform(value: unknown): "android" | "ios" | "harmony" | "flutter" | undefined {
  return value === "android" || value === "ios" || value === "harmony" || value === "flutter" ? value : undefined;
}

function readActivityExpectation(params: Record<string, unknown>): string | undefined {
  return stringParam(params.activityName);
}

function activityExpectedDescription(activityName: string): string {
  return `Foreground activity is ${activityName}.`;
}

function activityActualDescription(foreground: { packageName?: string; activityName?: string; componentName?: string }): string {
  return `Foreground package=${foreground.packageName ?? "-"}, activity=${foreground.activityName ?? "-"}, component=${foreground.componentName ?? "-"}.`;
}

function occurrenceParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

export function imageThreshold(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) {
      return parsed;
    }
  }
  return 0.92;
}

export function imageExpectedDescription(threshold: number, region?: OcrRegion): string {
  const scope = region ? ` in region x=${region.x}, y=${region.y}, w=${region.width}, h=${region.height}` : "";
  return `Current screenshot${scope} matches approved baseline with similarity >= ${threshold}.`;
}

export function stateExpectedDescription(expectation: StepExpectation): string {
  const expectedNode = stringParam(expectation.params.nodeId ?? expectation.params.expectedNodeId ?? expectation.params.expected);
  const expectedKey = stringParam(expectation.params.nodeKey ?? expectation.params.expectedNodeKey);
  const expectedName = stringParam(expectation.params.nodeName ?? expectation.params.expectedNodeName);
  return `Current business graph state is ${[
    expectedNode ? `nodeId=${expectedNode}` : undefined,
    expectedKey ? `nodeKey=${expectedKey}` : undefined,
    expectedName ? `nodeName=${expectedName}` : undefined
  ]
    .filter(Boolean)
    .join(", ") || "the expected node"}.`;
}

export function imageBufferSimilarity(actual: Buffer, baseline: Buffer): number {
  const maxLength = Math.max(actual.length, baseline.length);
  if (maxLength === 0) {
    return 1;
  }
  let matched = 0;
  const minLength = Math.min(actual.length, baseline.length);
  for (let index = 0; index < minLength; index += 1) {
    if (actual[index] === baseline[index]) {
      matched += 1;
    }
  }
  return matched / maxLength;
}

export function readOcrRegion(params: Record<string, unknown>): OcrRegion | undefined {
  const raw = params.region;
  if (typeof raw === "object" && raw !== null) {
    const region = raw as Record<string, unknown>;
    return normalizeOcrRegion(region.x, region.y, region.width, region.height);
  }
  return normalizeOcrRegion(params.regionX ?? params.x, params.regionY ?? params.y, params.regionWidth ?? params.width, params.regionHeight ?? params.height);
}

export function normalizeOcrText(value: string): string {
  return value
    .replace(/[‐‑‒–—―－﹣−]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOcrRegion(x: unknown, y: unknown, width: unknown, height: unknown): OcrRegion | undefined {
  const parsed = {
    x: numberParam(x),
    y: numberParam(y),
    width: numberParam(width),
    height: numberParam(height)
  };
  if (parsed.x === undefined && parsed.y === undefined && parsed.width === undefined && parsed.height === undefined) {
    return undefined;
  }
  if (
    parsed.x === undefined ||
    parsed.y === undefined ||
    parsed.width === undefined ||
    parsed.height === undefined ||
    parsed.x < 0 ||
    parsed.y < 0 ||
    parsed.width <= 0 ||
    parsed.height <= 0
  ) {
    throw new Error("OCR region must configure non-negative x/y and positive width/height.");
  }
  return {
    x: Math.round(parsed.x),
    y: Math.round(parsed.y),
    width: Math.round(parsed.width),
    height: Math.round(parsed.height)
  };
}

function metricValue(metric: MetricSample, metricName: string): number | undefined {
  if (metricName === "cpuPercent") {
    return metric.cpuPercent;
  }
  if (metricName === "memoryUsedMb") {
    return metric.memoryUsedKb === undefined ? undefined : metric.memoryUsedKb / 1024;
  }
  if (metricName === "memoryUsedKb") {
    return metric.memoryUsedKb;
  }
  if (metricName === "batteryLevel") {
    return metric.batteryLevel;
  }
  if (metricName === "batteryTemperatureC") {
    return metric.batteryTemperatureC;
  }
  const rawValue = metric.raw?.[metricName];
  return typeof rawValue === "number" ? rawValue : undefined;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return Number(value.toFixed(3)).toString();
}

async function cropPngRegion(image: Buffer, region: OcrRegion): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-ocr-region-"));
  const inputPath = path.join(tempDir, "input.png");
  const outputPath = path.join(tempDir, "region.png");
  try {
    await writeFile(inputPath, image);
    await execFileAsync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-vf",
      `crop=${region.width}:${region.height}:${region.x}:${region.y}`,
      outputPath
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000, encoding: "utf8", maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve();
    });
  });
}

function numberParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
