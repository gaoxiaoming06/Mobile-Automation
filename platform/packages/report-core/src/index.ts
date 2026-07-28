import {
  androidAppMonitorDisplaySummaryFromRun,
  shouldDisplayExpectationResult,
  type AndroidAppMonitorDisplaySummary,
  type ArtifactRef,
  type MetricSample,
  type StepExpectationResult,
  type StepResult,
  type TestRun
} from "@mobile-automation/shared";

export function renderReportHtml(run: TestRun): string {
  const statusClass = run.status === "passed" ? "passed" : "failed";
  const screenshotArtifacts = run.artifacts.filter((artifact) => artifact.type === "screenshot");
  const videoArtifacts = run.artifacts.filter((artifact) => artifact.type === "video" && !artifact.deletedAt);
  const primaryVideo = videoArtifacts[0];
  const logArtifacts = run.artifacts.filter((artifact) => artifact.type === "log");
  const keyArtifacts = run.artifacts.filter((artifact) => ["video", "log", "metrics", "report_json"].includes(artifact.type) && !artifact.deletedAt && !isAndroidAppMonitorArtifact(artifact));
  const latestMetric = run.metrics.at(-1);
  const metricSummary = summarizeMetrics(run.metrics);
  const failedSteps = run.stepResults.filter((step) => step.status !== "passed" && step.status !== "skipped");
  const skippedSteps = run.stepResults.filter((step) => step.status === "skipped");
  const expectationResults = run.stepResults.flatMap((step) => visibleExpectationResults(step.expectationResults));
  const durationMs = runDurationMs(run);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(run.caseName)} - 测试报告</title>
  <style>
    :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #eef2f7; color: #1d2733; }
    main { max-width: 1220px; margin: 0 auto; padding: 28px; }
    h1, h2, h3 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 30px; line-height: 1.15; }
    h2 { font-size: 17px; margin-top: 26px; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #dce4ef; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 28px rgba(20, 34, 52, 0.04); }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e8eef6; vertical-align: top; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    th { background: #f8fafc; color: #475569; font-weight: 720; }
    .report-hero { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 22px; box-shadow: 0 14px 38px rgba(20, 34, 52, 0.06); }
    .hero-top { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; }
    .hero-meta { color: #64748b; margin-top: 8px; font-size: 13px; word-break: break-all; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
    .metric { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 12px; min-width: 0; }
    .report-hero .metric { background: #f8fafc; }
    .metric span { display: block; color: #64748b; font-size: 11px; font-weight: 650; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 7px; font-size: 17px; line-height: 1.25; word-break: break-word; }
    .status { display: inline-flex; align-items: center; min-height: 30px; padding: 0 12px; border-radius: 999px; font-weight: 760; }
    .status.passed { background: #dcfae6; color: #067647; }
    .status.failed { background: #fee4e2; color: #b42318; }
    .step-status { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 720; }
    .step-status.passed { background: #dcfae6; color: #067647; }
    .step-status.failed, .step-status.timeout { background: #fee4e2; color: #b42318; }
    .step-status.skipped { background: #fff7d6; color: #915700; }
    .artifact-list { display: grid; gap: 8px; margin-top: 12px; }
    .artifact { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 10px 12px; }
    .artifact a { color: #2563eb; font-weight: 650; text-decoration: none; }
    .video-evidence { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 14px; margin-top: 12px; box-shadow: 0 14px 38px rgba(20, 34, 52, 0.06); }
    .video-shell { background: #0d1624; border-radius: 8px; padding: 10px; }
    .video-evidence video { width: 100%; max-height: 600px; display: block; background: #0d1624; border-radius: 6px; }
    .video-caption { margin-top: 10px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: #64748b; font-size: 12px; }
    .video-jump { border: 1px solid #cbd8e7; background: #fff; color: #2563eb; border-radius: 6px; padding: 5px 8px; cursor: pointer; font-weight: 650; }
    .video-jump:hover { background: #eff6ff; }
    .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
    .thumb { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 8px; box-shadow: 0 10px 28px rgba(20, 34, 52, 0.04); }
    .thumb img { width: 100%; display: block; border-radius: 6px; background: #111827; }
    .chart-card { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 14px; margin-top: 12px; box-shadow: 0 10px 28px rgba(20, 34, 52, 0.04); }
    .chart-card svg { width: 100%; height: auto; display: block; }
    .chart-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; color: #607087; font-size: 12px; }
    .legend-dot { width: 10px; height: 10px; display: inline-block; border-radius: 999px; margin-right: 5px; }
    .dot-cpu { background: #2563eb; }
    .dot-memory { background: #b45309; }
    .muted { color: #64748b; }
    .expectation-chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .expectation-chip { display: inline-flex; align-items: center; min-height: 22px; border-radius: 999px; padding: 0 8px; font-size: 12px; font-weight: 720; }
    .expectation-chip.passed { background: #dcfae6; color: #067647; }
    .expectation-chip.failed, .expectation-chip.unsupported, .expectation-chip.pending_review { background: #fee4e2; color: #b42318; }
    .expectation-chip.advisory { background: #e0f2fe; color: #026aa2; }
    .expectation-reason { color: #b42318; font-size: 12px; margin-top: 4px; }
    .condition-detail { color: #64748b; font-size: 12px; margin-top: 5px; }
    .condition-detail strong { color: #1d2733; }
    .evidence-links { display: grid; gap: 4px; }
    .evidence-links a { color: #2563eb; text-decoration: none; font-weight: 650; }
    .run-summary-panel { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 16px; margin-top: 12px; box-shadow: 0 10px 28px rgba(20, 34, 52, 0.04); }
    .run-diagnostics { display: grid; gap: 8px; margin-top: 12px; }
    .run-diagnostics div { border: 1px solid #dce4ef; background: #f8fafc; color: #475569; border-radius: 7px; padding: 8px 10px; font-size: 12px; }
    .run-diagnostics strong { color: #1d2733; display: block; margin-bottom: 3px; }
    .run-diagnostics span { display: block; word-break: break-all; }
    @media (max-width: 760px) {
      main { padding: 14px; }
      .hero-top { display: grid; }
      h1 { font-size: 24px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main>
    <section class="report-hero">
      <div class="hero-top">
        <div>
          <h1>${escapeHtml(run.caseName)}</h1>
          <div class="hero-meta">${escapeHtml(run.id)} · ${escapeHtml(run.deviceSerial)}</div>
        </div>
        <span class="status ${statusClass}">${escapeHtml(run.status)}</span>
      </div>
      <section class="summary">
        <div class="metric"><span>Started</span><strong>${formatDateTime(run.startedAt)}</strong></div>
        <div class="metric"><span>Ended</span><strong>${formatDateTime(run.endedAt)}</strong></div>
        <div class="metric"><span>Duration</span><strong>${formatDuration(Math.round(durationMs / 1000))}</strong></div>
        <div class="metric"><span>Steps</span><strong>${run.stepResults.length}</strong></div>
        <div class="metric"><span>Failed Steps</span><strong>${failedSteps.length}</strong></div>
        <div class="metric"><span>Skipped Steps</span><strong>${skippedSteps.length}</strong></div>
        <div class="metric"><span>Events</span><strong>${run.events.length}</strong></div>
        <div class="metric"><span>Artifacts</span><strong>${run.artifacts.length}</strong></div>
        <div class="metric"><span>Expectations</span><strong>${expectationResults.length ? `${passedExpectationCount(expectationResults)} / ${expectationResults.length}` : "无"}</strong></div>
        <div class="metric"><span>Battery</span><strong>${latestMetric?.batteryLevel ?? "-"}%</strong></div>
      </section>
    </section>

    ${renderStabilityReport(run)}

    <h2>性能摘要</h2>
    <section class="summary">
      <div class="metric"><span>CPU 平均 / 峰值</span><strong>${formatMetricPair(metricSummary.cpuAvg, metricSummary.cpuMax, "%")}</strong></div>
      <div class="metric"><span>内存平均 / 峰值</span><strong>${formatMetricPair(metricSummary.memoryAvgMb, metricSummary.memoryMaxMb, " MB")}</strong></div>
      <div class="metric"><span>采样数</span><strong>${run.metrics.length}</strong></div>
      <div class="metric"><span>视频证据</span><strong>${videoArtifacts.length ? `${videoArtifacts.length} 个` : "无"}</strong></div>
    </section>
    ${renderMetricTrend(run.metrics)}
    ${renderAndroidAppMonitorReport(run)}

    ${primaryVideo ? renderVideoEvidence(primaryVideo) : renderVideoUnavailable(run)}

    <h2>步骤结果</h2>
    <table>
      <thead>
        <tr><th>#</th><th>动作</th><th>状态</th><th>预期验证</th><th>耗时</th><th>错误</th><th>截图</th><th>视频时间点</th></tr>
      </thead>
      <tbody>
        ${run.stepResults
          .map((step) => {
            const screenshot = step.artifacts.find((artifact) => artifact.type === "screenshot");
            const videoOffset = primaryVideo ? videoOffsetSeconds(primaryVideo.createdAt, step.startedAt) : undefined;
            return `<tr>
              <td>${step.stepOrder}</td>
              <td>${renderStepActionCell(step)}</td>
              <td>${renderStepStatus(step.status)}${renderPreconditionDetail(step.metadata)}${renderConditionDetail(step.metadata)}</td>
              <td>${renderExpectationSummary(step.expectationResults ?? [])}</td>
              <td>${step.durationMs ?? "-"} ms</td>
              <td>${escapeHtml(step.errorMessage ?? "")}</td>
              <td>${screenshot ? `<a href="${escapeAttr(screenshot.url)}">${escapeHtml(screenshot.name)}</a>` : '<span class="muted">无</span>'}</td>
              <td>${videoOffset !== undefined ? `<button class="video-jump" type="button" data-video-time="${videoOffset}">${formatDuration(videoOffset)}</button>` : '<span class="muted">无视频</span>'}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>

    ${renderExpectationDetails(run)}

    <h2>性能采样</h2>
    <table>
      <thead>
        <tr><th>时间</th><th>CPU</th><th>内存</th><th>电量</th><th>温度</th></tr>
      </thead>
      <tbody>
        ${run.metrics
          .map(
            (metric) => `<tr>
              <td>${escapeHtml(metric.sampledAt)}</td>
              <td>${formatMaybe(metric.cpuPercent, "%")}</td>
              <td>${metric.memoryUsedKb ? `${Math.round(metric.memoryUsedKb / 1024)} MB` : "-"}</td>
              <td>${formatMaybe(metric.batteryLevel, "%")}</td>
              <td>${formatMaybe(metric.batteryTemperatureC, " C")}</td>
            </tr>`
          )
          .join("") || '<tr><td colspan="5" class="muted">无性能采样</td></tr>'}
      </tbody>
    </table>

    <h2>异常事件</h2>
    <table>
      <thead>
        <tr><th>时间</th><th>类型</th><th>等级</th><th>摘要</th></tr>
      </thead>
      <tbody>
        ${run.events
          .map(
            (event) => `<tr>
              <td>${escapeHtml(event.occurredAt)}</td>
              <td>${escapeHtml(event.type)}</td>
              <td>${escapeHtml(event.severity)}</td>
              <td>${escapeHtml(event.summary)}</td>
            </tr>`
          )
          .join("") || '<tr><td colspan="4" class="muted">无异常事件</td></tr>'}
      </tbody>
    </table>

    <h2>关键附件</h2>
    <div class="artifact-list">
      ${keyArtifacts.map(renderArtifact).join("") || '<div class="muted">无关键附件</div>'}
    </div>

    <h2>步骤截图</h2>
    <div class="thumbs">
      ${screenshotArtifacts
        .slice(0, 80)
        .map((artifact) => `<div class="thumb"><img src="${escapeAttr(artifact.url)}" alt="${escapeAttr(artifact.name)}" /><div>${escapeHtml(artifact.name)}</div></div>`)
        .join("") || '<div class="muted">无截图</div>'}
    </div>
  </main>
  <script>
    document.querySelectorAll("[data-video-time]").forEach((button) => {
      button.addEventListener("click", () => {
        const video = document.getElementById("run-video");
        if (!video) return;
        const requestedTime = Number(button.getAttribute("data-video-time") || 0);
        video.currentTime = Number.isFinite(video.duration) ? Math.min(requestedTime, video.duration) : requestedTime;
        video.play().catch(() => undefined);
      });
    });
  </script>
</body>
</html>`;
}

function renderStabilityReport(run: TestRun): string {
  const config = run.config.stabilityExploration;
  if (!config) {
    return "";
  }
  const latestStep = run.stepResults.at(-1);
  const latestMetadata = readStabilityMetadata(latestStep?.metadata);
  const failedSteps = run.stepResults.filter((step) => step.status === "failed").length;
  const skippedSteps = run.stepResults.filter((step) => step.status === "skipped").length;
  const skippedCandidates = run.stepResults.reduce((sum, step) => sum + (readStabilityMetadata(step.metadata)?.skippedCandidates?.length ?? 0), 0);

  return `<h2>稳定性探索摘要</h2>
    <section class="run-summary-panel">
      <section class="summary">
        <div class="metric"><span>目标包</span><strong>${escapeHtml(config.packageName)}</strong></div>
        <div class="metric"><span>Seed</span><strong>${escapeHtml(config.seed)}</strong></div>
        <div class="metric"><span>策略</span><strong>${escapeHtml(config.strategy)}</strong></div>
        <div class="metric"><span>动作进度</span><strong>${run.stepResults.length} / ${config.maxActions}</strong></div>
        <div class="metric"><span>最大时长</span><strong>${formatDuration(Math.round(config.maxDurationMs / 1000))}</strong></div>
        <div class="metric"><span>App 外处理</span><strong>${escapeHtml(config.appExitPolicy)}</strong></div>
        <div class="metric"><span>失败动作</span><strong>${failedSteps}</strong></div>
        <div class="metric"><span>跳过动作</span><strong>${skippedSteps}</strong></div>
        <div class="metric"><span>过滤候选</span><strong>${skippedCandidates}</strong></div>
        <div class="metric"><span>最近动作</span><strong>${escapeHtml(latestMetadata?.candidateLabel ?? "-")}</strong></div>
      </section>
      <div class="run-diagnostics">
        <div><strong>允许动作</strong><span>${escapeHtml(config.allowedActions.join(", "))}</span></div>
        <div><strong>危险词</strong><span>${escapeHtml(config.dangerousTextPatterns.join(", "))}</span></div>
        <div><strong>最近来源</strong><span>${escapeHtml(latestMetadata?.candidateSource ?? "-")} · ${escapeHtml(latestMetadata?.currentPackage ?? config.packageName)}</span></div>
      </div>
    </section>`;
}

 function readStabilityMetadata(metadata: Record<string, unknown> | undefined): {
  candidateLabel?: string;
  candidateSource?: string;
  currentPackage?: string;
  skippedCandidates?: Array<{ label?: string; skipReason?: string }>;
} | undefined {
  const value = metadata?.stabilityExploration;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as {
        candidateLabel?: string;
        candidateSource?: string;
        currentPackage?: string;
        skippedCandidates?: Array<{ label?: string; skipReason?: string }>;
      })
    : undefined;
}

function renderStepActionCell(step: StepResult): string {
  return escapeHtml(step.type);
}

function renderExpectationDetails(run: TestRun): string {
  const rows = run.stepResults.flatMap((step) =>
    visibleExpectationResults(step.expectationResults).map((result) => {
      const evidenceArtifacts = result.evidenceArtifactIds
        .map((id) => run.artifacts.find((artifact) => artifact.id === id) ?? step.artifacts.find((artifact) => artifact.id === id))
        .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
      return `<tr>
        <td>${step.stepOrder}</td>
        <td>${escapeHtml(result.type)}</td>
        <td>${renderExpectationChip(result)}</td>
        <td>${renderExpectationPolicy(result)}</td>
        <td>${escapeHtml(result.expected)}</td>
        <td>${escapeHtml(result.actual)}${result.reason ? `<div class="expectation-reason">${escapeHtml(result.reason)}</div>` : ""}</td>
        <td>${renderEvidenceLinks(evidenceArtifacts)}</td>
      </tr>`;
    })
  );
  if (!rows.length) {
    return "";
  }
    return `<h2>预期验证明细</h2>
    <table>
      <thead>
        <tr><th>步骤</th><th>类型</th><th>状态</th><th>规则</th><th>期望</th><th>实际</th><th>证据</th></tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

function renderExpectationSummary(results: StepExpectationResult[]): string {
  const visibleResults = visibleExpectationResults(results);
  if (!visibleResults.length) {
    if (results.length) {
      return '<span class="muted">系统护栏通过</span>';
    }
    return '<span class="muted">未配置</span>';
  }
  return `<div class="expectation-chips">${visibleResults.map(renderExpectationChip).join("")}</div>`;
}

function visibleExpectationResults(results: StepExpectationResult[] | undefined): StepExpectationResult[] {
  return (results ?? []).filter(shouldDisplayExpectationResult);
}

function renderExpectationChip(result: StepExpectationResult): string {
  const policyClass = result.blocking === false ? "advisory" : "blocking";
  return `<span class="expectation-chip ${escapeAttr(result.status)} ${policyClass}">${escapeHtml(result.type)} · ${escapeHtml(result.status)} · ${renderExpectationPolicy(result)}</span>`;
}

function renderExpectationPolicy(result: StepExpectationResult): string {
  return result.blocking === false ? "建议" : "阻断";
}

function renderStepStatus(status: string): string {
  return `<span class="step-status ${escapeAttr(status)}">${escapeHtml(status)}</span>`;
}

function renderConditionDetail(metadata: Record<string, unknown> | undefined): string {
  const condition = metadata?.condition;
  if (!isConditionMetadata(condition)) {
    return "";
  }
  const state = condition.matched ? "命中并执行点击" : "未命中，已跳过";
  return `<div class="condition-detail"><strong>条件步骤：</strong>${escapeHtml(state)}<br /><strong>期望：</strong>${escapeHtml(condition.expected)}<br /><strong>实际：</strong>${escapeHtml(condition.actual)}</div>`;
}

function renderPreconditionDetail(metadata: Record<string, unknown> | undefined): string {
  const preconditions = metadata?.preconditions;
  if (!isPreconditionMetadata(preconditions)) {
    return "";
  }
  const failedResults = preconditions.results.filter((result) => result.status !== "passed" && result.status !== "pending_review");
  const state = preconditions.status === "passed" ? "已满足" : "未满足";
  const failedText = failedResults.length ? `<br /><strong>失败：</strong>${escapeHtml(failedResults.map((result) => result.reason ?? result.actual).join("；"))}` : "";
  return `<div class="condition-detail"><strong>前置条件：</strong>${escapeHtml(state)}（${preconditions.results.length} 项）${failedText}</div>`;
}

function isConditionMetadata(value: unknown): value is { matched: boolean; expected: string; actual: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { matched?: unknown }).matched === "boolean" &&
    typeof (value as { expected?: unknown }).expected === "string" &&
    typeof (value as { actual?: unknown }).actual === "string"
  );
}

function isPreconditionMetadata(value: unknown): value is { status: "passed" | "failed"; results: StepExpectationResult[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    ((value as { status?: unknown }).status === "passed" || (value as { status?: unknown }).status === "failed") &&
    Array.isArray((value as { results?: unknown }).results)
  );
}

function renderEvidenceLinks(artifacts: ArtifactRef[]): string {
  if (!artifacts.length) {
    return '<span class="muted">无</span>';
  }
  return `<div class="evidence-links">${artifacts.map((artifact) => `<a href="${escapeAttr(artifact.url)}">${escapeHtml(artifact.name)}</a>`).join("")}</div>`;
}


function passedExpectationCount(results: StepExpectationResult[]): number {
  return results.filter((result) => result.status === "passed").length;
}

function renderVideoEvidence(artifact: ArtifactRef): string {
  return `<h2>视频证据</h2>
    <div class="video-evidence">
      <div class="video-shell">
        <video id="run-video" controls preload="metadata" src="${escapeAttr(artifact.url)}"></video>
      </div>
      <div class="video-caption">
        <span>${escapeHtml(artifact.name)}</span>
        <span>${artifact.sizeBytes ? formatBytes(artifact.sizeBytes) : ""}</span>
      </div>
    </div>`;
}

function renderArtifact(artifact: ArtifactRef): string {
  return `<div class="artifact"><a href="${escapeAttr(artifact.url)}">${escapeHtml(artifact.name)}</a><span class="muted"> ${escapeHtml(artifact.type)}</span></div>`;
}

function renderAndroidAppMonitorReport(run: TestRun): string {
  const summary = androidAppMonitorDisplaySummaryFromRun(run);
  if (!summary) {
    return "";
  }
  return `<h2>App 性能监控</h2>
    <section class="summary">
      <div class="metric"><span>状态</span><strong>${escapeHtml(androidAppMonitorHealthLabel(summary))}</strong></div>
      <div class="metric"><span>监控 App</span><strong>${escapeHtml(summary.packageName)}</strong></div>
      <div class="metric"><span>进程数</span><strong>${summary.processCount}</strong></div>
      <div class="metric"><span>告警</span><strong>${summary.incidentCount}</strong></div>
      <div class="metric"><span>CPU 采样</span><strong>${summary.cpuSamples}</strong></div>
      <div class="metric"><span>内存采样</span><strong>${summary.memorySamples}</strong></div>
      <div class="metric"><span>生命周期采样</span><strong>${summary.lifecycleSamples}</strong></div>
    </section>`;
}

function androidAppMonitorHealthLabel(summary: AndroidAppMonitorDisplaySummary): string {
  return summary.severity === "error" || summary.severity === "warning" || summary.incidentCount > 0 ? "有告警" : "正常";
}

function isAndroidAppMonitorArtifact(artifact: ArtifactRef): boolean {
  return artifact.name.includes("android-app-monitor");
}

function renderVideoUnavailable(run: TestRun): string {
  const videoEvent = run.events.find((event) => event.type === "video_unavailable");
  return `<h2>视频证据</h2>
    <div class="video-evidence">
      <div class="muted">${escapeHtml(videoEvent?.summary ?? "本次执行没有可用视频。")}</div>
    </div>`;
}

function summarizeMetrics(metrics: MetricSample[]): {
  cpuAvg?: number;
  cpuMax?: number;
  memoryAvgMb?: number;
  memoryMaxMb?: number;
} {
  const cpuValues = metrics.map((metric) => metric.cpuPercent).filter(isNumber);
  const memoryValuesMb = metrics.map((metric) => (isNumber(metric.memoryUsedKb) ? metric.memoryUsedKb / 1024 : undefined)).filter(isNumber);
  return {
    cpuAvg: average(cpuValues),
    cpuMax: max(cpuValues),
    memoryAvgMb: average(memoryValuesMb),
    memoryMaxMb: max(memoryValuesMb)
  };
}

function renderMetricTrend(metrics: MetricSample[]): string {
  const cpuPoints = metrics.map((metric) => metric.cpuPercent).filter(isNumber);
  const memoryPoints = metrics.map((metric) => (isNumber(metric.memoryUsedKb) ? metric.memoryUsedKb / 1024 : undefined)).filter(isNumber);
  if (cpuPoints.length < 2 && memoryPoints.length < 2) {
    return '<div class="chart-card muted">性能采样不足，暂不生成趋势图。</div>';
  }
  const width = 960;
  const height = 240;
  const padding = { left: 46, right: 18, top: 18, bottom: 34 };
  const cpuPath = buildLinePath(cpuPoints, { width, height, padding, maxValue: Math.max(100, max(cpuPoints) ?? 100) });
  const memoryMax = max(memoryPoints) ?? 1;
  const memoryPath = buildLinePath(memoryPoints, { width, height, padding, maxValue: memoryMax || 1 });
  return `<div class="chart-card">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="性能趋势图">
      <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#cfd8e6" />
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#cfd8e6" />
      <text x="${padding.left}" y="${height - 10}" fill="#607087" font-size="12">start</text>
      <text x="${width - 58}" y="${height - 10}" fill="#607087" font-size="12">end</text>
      ${cpuPath ? `<path d="${cpuPath}" fill="none" stroke="#225ea8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />` : ""}
      ${memoryPath ? `<path d="${memoryPath}" fill="none" stroke="#b45309" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />` : ""}
    </svg>
    <div class="chart-legend">
      <span><i class="legend-dot dot-cpu"></i>CPU %</span>
      <span><i class="legend-dot dot-memory"></i>内存 MB</span>
    </div>
  </div>`;
}

function buildLinePath(
  values: number[],
  options: { width: number; height: number; padding: { left: number; right: number; top: number; bottom: number }; maxValue: number }
): string {
  if (values.length < 2) {
    return "";
  }
  const usableWidth = options.width - options.padding.left - options.padding.right;
  const usableHeight = options.height - options.padding.top - options.padding.bottom;
  return values
    .map((value, index) => {
      const x = options.padding.left + (usableWidth * index) / Math.max(1, values.length - 1);
      const ratio = Math.max(0, Math.min(1, value / options.maxValue));
      const y = options.padding.top + usableHeight * (1 - ratio);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}


function formatMaybe(value: number | undefined, suffix: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(1))}${suffix}` : "-";
}

function formatMetricPair(avgValue: number | undefined, maxValue: number | undefined, suffix: string): string {
  if (!isNumber(avgValue) && !isNumber(maxValue)) {
    return "-";
  }
  return `${formatMaybe(avgValue, suffix)} / ${formatMaybe(maxValue, suffix)}`;
}

function average(values: number[]): number | undefined {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function max(values: number[]): number | undefined {
  return values.length ? Math.max(...values) : undefined;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function runDurationMs(run: TestRun): number {
  const started = Date.parse(run.startedAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return 0;
  }
  return Math.max(0, ended - started);
}

function videoOffsetSeconds(runStartedAt: string, stepStartedAt: string): number {
  const runStartedMs = Date.parse(runStartedAt);
  const stepStartedMs = Date.parse(stepStartedAt);
  if (!Number.isFinite(runStartedMs) || !Number.isFinite(stepStartedMs)) {
    return 0;
  }
  return Math.max(0, Math.round((stepStartedMs - runStartedMs) / 1000));
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
