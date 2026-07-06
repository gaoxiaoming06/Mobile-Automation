import {
  isSystemGuardExpectationType,
  shouldDisplayExpectationResult,
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
    .graph-panel { background: #fff; border: 1px solid #dce4ef; border-radius: 8px; padding: 16px; margin-top: 12px; box-shadow: 0 10px 28px rgba(20, 34, 52, 0.04); }
    .graph-path { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
    .graph-node { border: 1px solid #cbd8e7; background: #f8fafc; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 720; color: #1d2733; }
    .graph-arrow { color: #64748b; font-weight: 760; }
    .graph-meta { color: #64748b; font-size: 12px; margin-top: 4px; word-break: break-all; }
    .graph-match { display: grid; gap: 4px; color: #64748b; font-size: 12px; }
    .graph-match strong { color: #1d2733; }
    .graph-match-candidates { display: grid; gap: 5px; margin-top: 4px; }
    .graph-match-candidates > div { border: 1px solid #dce4ef; background: #f8fafc; border-radius: 7px; padding: 6px 8px; }
    .graph-matchers { display: grid; gap: 4px; margin-top: 5px; }
    .graph-matchers div { border: 1px solid #dce4ef; background: #fff; border-radius: 6px; padding: 5px 6px; }
    .graph-matchers div.matched { border-color: #b7e4c7; background: #f6fef9; }
    .graph-matchers div.missed { border-color: #f3b5af; background: #fff5f4; }
    .graph-matchers span { display: block; margin-top: 2px; word-break: break-all; }
    .graph-action { display: grid; gap: 4px; color: #64748b; font-size: 12px; }
    .graph-action strong { color: #1d2733; }
    .graph-action span { word-break: break-all; }
    .graph-json { display: block; max-width: 320px; white-space: pre-wrap; word-break: break-all; border: 1px solid #dce4ef; background: #f8fafc; border-radius: 6px; padding: 5px 6px; color: #334155; font-size: 11px; }
    .graph-source { display: inline-flex; align-items: center; min-height: 21px; border-radius: 999px; padding: 0 8px; background: #f1f5f9; color: #475569; font-size: 12px; font-weight: 720; }
    .graph-source.overlay { background: #e0f2fe; color: #026aa2; }
    .graph-source.guard { background: #fff7d6; color: #915700; }
    .graph-deviations { display: grid; gap: 5px; margin-top: 8px; }
    .graph-deviations div { border: 1px solid #f3cf72; background: #fffbeb; color: #93370d; border-radius: 7px; padding: 6px 8px; font-size: 12px; }
    .graph-deviations strong, .graph-deviations span { display: block; }
    .graph-diagnostics { display: grid; gap: 8px; margin-top: 12px; }
    .graph-diagnostics div { border: 1px solid #dce4ef; background: #f8fafc; color: #475569; border-radius: 7px; padding: 8px 10px; font-size: 12px; }
    .graph-diagnostics strong { color: #1d2733; display: block; margin-bottom: 3px; }
    .graph-diagnostics span { display: block; word-break: break-all; }
    .graph-diagnostics .warning { border-color: #f3cf72; background: #fffbeb; color: #93370d; }
    .graph-interceptors { display: grid; gap: 5px; margin-top: 8px; }
    .graph-interceptors div { border: 1px solid #bae6fd; background: #f0f9ff; color: #075985; border-radius: 7px; padding: 6px 8px; font-size: 12px; }
    .graph-interceptors strong, .graph-interceptors span { display: block; }
    .graph-recovery { border: 1px solid #a7f3d0; background: #ecfdf3; color: #067647; border-radius: 7px; padding: 6px 8px; font-size: 12px; margin-top: 8px; }
    .graph-recovery strong, .graph-recovery span { display: block; }
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

    ${renderGraphReport(run)}
    ${renderStabilityReport(run)}
    ${renderAssetPatrolReport(run)}
    ${renderAiDiagnosisReport(run)}

    <h2>性能摘要</h2>
    <section class="summary">
      <div class="metric"><span>CPU 平均 / 峰值</span><strong>${formatMetricPair(metricSummary.cpuAvg, metricSummary.cpuMax, "%")}</strong></div>
      <div class="metric"><span>内存平均 / 峰值</span><strong>${formatMetricPair(metricSummary.memoryAvgMb, metricSummary.memoryMaxMb, " MB")}</strong></div>
      <div class="metric"><span>采样数</span><strong>${run.metrics.length}</strong></div>
      <div class="metric"><span>视频证据</span><strong>${videoArtifacts.length ? `${videoArtifacts.length} 个` : "无"}</strong></div>
    </section>
    ${renderMetricTrend(run.metrics)}

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
      ${[...videoArtifacts, ...logArtifacts].map(renderArtifact).join("") || '<div class="muted">无视频或日志附件</div>'}
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

type GraphStepReport = {
  step: StepResult;
  graph: GraphStepMetadata;
};

type GraphStepMetadata = {
  versionId?: string;
  planStepId?: string;
  edgeId?: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
  phase?: string;
  usedActionPolicyId?: string;
  fallbackActionPolicyId?: string;
  runtimeOverlay?: {
    id?: string;
    note?: string;
    targetExpectationIds?: string[];
    edgeExpectationIds?: string[];
  };
  beforeMatch?: NodeMatchSummary;
  afterMatch?: NodeMatchSummary;
  actionPolicy?: GraphActionPolicySummary;
  recoveryAttempt?: number;
  recoveryReasonDeviationId?: string;
  deviations?: GraphDeviationSummary[];
  interceptors?: GraphInterceptorSummary[];
};

type GraphDeviationSummary = {
  id?: string;
  phase?: string;
  expectedNodeId?: string;
  actualNodeId?: string;
  actualStatus?: string;
  attempt?: number;
  action?: string;
  message?: string;
  recordedAt?: string;
};

type GraphInterceptorSummary = {
  id?: string;
  phase?: string;
  ruleId?: string;
  ruleName?: string;
  matchedText?: string;
  action?: {
    type?: string;
    x?: number;
    y?: number;
  };
  handledAt?: string;
};

type NodeMatchSummary = {
  status?: string;
  nodeId?: string;
  nodeName?: string;
  score?: number;
  candidates?: NodeMatchCandidateSummary[];
};

type NodeMatchCandidateSummary = {
  nodeId?: string;
  nodeName?: string;
  score?: number;
  matchedWeight?: number;
  totalWeight?: number;
  quality?: {
    status?: string;
    reasons?: string[];
    matchedContextSignals?: number;
    matchedStrongSignals?: number;
    matchedWeakSignals?: number;
    missingStrongMatcherIds?: string[];
  };
  matcherResults?: MatcherResultSummary[];
};

type MatcherResultSummary = {
  matcherId?: string;
  type?: string;
  expected?: string;
  actual?: string;
  weight?: number;
  matched?: boolean;
  score?: number;
  reason?: string;
};

type GraphActionPolicySummary = {
  id?: string;
  priority?: number;
  fallback?: boolean;
  reliabilityHint?: string;
  action?: {
    id?: string;
    type?: string;
    title?: string;
    params?: unknown;
    timing?: unknown;
    coordinate?: unknown;
  };
};

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
    <section class="graph-panel">
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
      <div class="graph-diagnostics">
        <div><strong>允许动作</strong><span>${escapeHtml(config.allowedActions.join(", "))}</span></div>
        <div><strong>危险词</strong><span>${escapeHtml(config.dangerousTextPatterns.join(", "))}</span></div>
        <div><strong>最近来源</strong><span>${escapeHtml(latestMetadata?.candidateSource ?? "-")} · ${escapeHtml(latestMetadata?.currentPackage ?? config.packageName)}</span></div>
      </div>
    </section>`;
}

function renderAssetPatrolReport(run: TestRun): string {
  const config = run.config.assetPatrol;
  if (!config) {
    return "";
  }
  const latestStep = run.stepResults.at(-1);
  const latestMetadata = readAssetPatrolMetadata(latestStep?.metadata);
  const assetSteps = run.stepResults
    .map((step) => ({ step, metadata: readAssetPatrolMetadata(step.metadata) }))
    .filter((item): item is { step: StepResult; metadata: NonNullable<ReturnType<typeof readAssetPatrolMetadata>> } => Boolean(item.metadata));
  const failedSteps = assetSteps.filter(({ step }) => step.status === "failed").length;
  const skippedSteps = assetSteps.filter(({ step }) => step.status === "skipped").length;
  const needsRepair = assetSteps.filter(({ metadata }) => metadata.status === "needs_repair" || metadata.skipReason === "runtime_relocation_required").length;

  return `<h2>资产驱动巡检摘要</h2>
    <section class="graph-panel">
      <section class="summary">
        <div class="metric"><span>目标包</span><strong>${escapeHtml(config.packageName)}</strong></div>
        <div class="metric"><span>启动方式</span><strong>${escapeHtml(config.startMode)}</strong></div>
        <div class="metric"><span>巡检范围</span><strong>${escapeHtml(config.pageScope)}</strong></div>
        <div class="metric"><span>检查项</span><strong>${assetSteps.length}</strong></div>
        <div class="metric"><span>失败检查</span><strong>${failedSteps}</strong></div>
        <div class="metric"><span>跳过检查</span><strong>${skippedSteps}</strong></div>
        <div class="metric"><span>建议修复</span><strong>${needsRepair}</strong></div>
        <div class="metric"><span>当前页</span><strong>${escapeHtml(latestMetadata?.pageModelName ?? latestMetadata?.startPage?.name ?? "-")}</strong></div>
        <div class="metric"><span>最近检查</span><strong>${escapeHtml(latestMetadata?.label ?? "-")}</strong></div>
      </section>
      <div class="graph-diagnostics">
        <div><strong>危险词</strong><span>${escapeHtml(config.dangerousTextPatterns.join(", "))}</span></div>
        <div><strong>最近原因</strong><span>${escapeHtml(latestMetadata?.skipReason ?? "-")}</span></div>
        <div><strong>执行模式</strong><span>${escapeHtml(latestMetadata?.executionMode ?? "diagnostic")}</span></div>
      </div>
    </section>`;
}

function renderAiDiagnosisReport(run: TestRun): string {
  const events = run.events.filter((event) => event.type === "ai_diagnosis");
  if (!events.length) {
    return "";
  }
  return `<h2>AI 诊断</h2>
    <section class="graph-panel">
      <div class="graph-diagnostics">
        ${events
          .map((event) => {
            const detail = readJsonObject(event.detail);
            const artifacts = event.artifactIds
              .map((id) => run.artifacts.find((artifact) => artifact.id === id))
              .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
            return `<div class="${event.severity === "warning" ? "warning" : ""}">
              <strong>${escapeHtml(event.summary)}</strong>
              <span>置信度=${escapeHtml(formatUnknown(detail?.confidence, "-"))} · 建议=${escapeHtml(formatUnknown(detail?.recommendedAction, "-"))} · 自动应用=${escapeHtml(formatUnknown(detail?.safeToAutoApply, false))}</span>
              ${artifacts.length ? renderEvidenceLinks(artifacts) : ""}
            </div>`;
          })
          .join("")}
      </div>
    </section>`;
}

function renderGraphReport(run: TestRun): string {
  const graphSteps = collectGraphSteps(run);
  if (!graphSteps.length) {
    return "";
  }
  const first = graphSteps[0]!;
  const last = graphSteps.at(-1)!;
  const failed = graphSteps.find(({ step }) => step.status === "failed" || step.status === "timeout");
  const routeNodes = graphRouteNodes(graphSteps);
  const overlayCount = graphSteps.reduce((count, item) => count + overlayExpectationIds(item.graph).size, 0);
  const diagnostics = graphDiagnostics(run, graphSteps);
  return `<h2>业务图谱执行</h2>
    <section class="graph-panel">
      <section class="summary">
        <div class="metric"><span>Graph Version</span><strong>${escapeHtml(first.graph.versionId ?? "-")}</strong></div>
        <div class="metric"><span>Start Node</span><strong>${escapeHtml(first.graph.fromNodeName ?? first.graph.fromNodeId ?? "-")}</strong></div>
        <div class="metric"><span>Target Node</span><strong>${escapeHtml(last.graph.toNodeName ?? last.graph.toNodeId ?? "-")}</strong></div>
        <div class="metric"><span>Graph Steps</span><strong>${graphSteps.length}</strong></div>
        <div class="metric"><span>Runtime Overlay</span><strong>${overlayCount ? `${overlayCount} 条` : "无"}</strong></div>
        <div class="metric"><span>Failed At</span><strong>${failed ? `${failed.graph.toNodeName ?? failed.graph.toNodeId ?? "-"} / ${failed.graph.phase ?? failed.step.status}` : "无"}</strong></div>
        <div class="metric"><span>Bootstrap</span><strong>${diagnostics.bootstrapEvents.length ? `${diagnostics.bootstrapEvents.length} 次` : "无"}</strong></div>
        <div class="metric"><span>Transition Wait</span><strong>${diagnostics.transitionWaits.length ? `${diagnostics.transitionWaits.length} 次` : "无"}</strong></div>
      </section>
      <div class="graph-path">
        ${routeNodes.map((node, index) => `${index > 0 ? '<span class="graph-arrow">→</span>' : ""}<span class="graph-node">${escapeHtml(node)}</span>`).join("")}
      </div>
      ${renderGraphDiagnostics(diagnostics)}
      <div class="graph-meta">这一区域展示图谱规划路径和真实执行结果；旧版线性步骤只作为底层证据，图谱语义以节点、边、状态识别和预期验证为准。</div>
    </section>
    <table>
      <thead>
        <tr><th>#</th><th>业务边</th><th>节点迁移</th><th>状态</th><th>节点识别</th><th>动作策略</th><th>预期分组</th><th>证据</th></tr>
      </thead>
      <tbody>
        ${graphSteps.map(({ step, graph }) => renderGraphStepRow(run, step, graph)).join("")}
      </tbody>
    </table>`;
}

function graphDiagnostics(run: TestRun, graphSteps: GraphStepReport[]): {
  bootstrapEvents: TestRun["events"];
  transitionWaits: GraphDeviationSummary[];
  recoveries: GraphStepMetadata[];
} {
  const transitionWaits = graphSteps.flatMap(({ graph }) => graph.deviations ?? []).filter((deviation) => deviation.action === "retry_observe");
  const recoveries = graphSteps.map(({ graph }) => graph).filter((graph) => typeof graph.recoveryAttempt === "number");
  return {
    bootstrapEvents: run.events.filter((event) => event.type === "start_state_failed"),
    transitionWaits,
    recoveries
  };
}

function renderGraphDiagnostics(diagnostics: ReturnType<typeof graphDiagnostics>): string {
  const rows: string[] = [];
  for (const event of diagnostics.bootstrapEvents) {
    rows.push(`<div class="warning"><strong>启动归位</strong><span>${escapeHtml(event.summary)}${event.detail ? `：${escapeHtml(event.detail)}` : ""}</span></div>`);
  }
  for (const deviation of diagnostics.transitionWaits.slice(0, 5)) {
    rows.push(
      `<div><strong>状态等待</strong><span>${escapeHtml(deviation.message ?? "动作后持续等待目标节点出现。")} ${
        deviation.actualNodeId ? `实际节点=${escapeHtml(deviation.actualNodeId)}` : ""
      }</span></div>`
    );
  }
  if (diagnostics.recoveries.length) {
    rows.push(`<div><strong>路径恢复</strong><span>本次执行触发 ${diagnostics.recoveries.length} 次恢复 / 重规划。</span></div>`);
  }
  return rows.length ? `<div class="graph-diagnostics">${rows.join("")}</div>` : "";
}

function renderGraphStepRow(run: TestRun, step: StepResult, graph: GraphStepMetadata): string {
  const evidenceIds = uniqueStrings([
    step.afterScreenshotId,
    ...step.artifacts.map((artifact) => artifact.id),
    ...(step.expectationResults ?? []).flatMap((result) => result.evidenceArtifactIds)
  ]);
  const artifacts = evidenceIds
    .map((id) => run.artifacts.find((artifact) => artifact.id === id) ?? step.artifacts.find((artifact) => artifact.id === id))
    .filter((artifact): artifact is ArtifactRef => Boolean(artifact));
  return `<tr>
    <td>${step.stepOrder}</td>
    <td><strong>${escapeHtml(graph.edgeKey ?? graph.edgeId ?? "-")}</strong><div class="graph-meta">${escapeHtml(graph.edgeId ?? "")}</div></td>
    <td>${escapeHtml(graph.fromNodeName ?? graph.fromNodeId ?? "-")}<br /><span class="muted">→</span> ${escapeHtml(graph.toNodeName ?? graph.toNodeId ?? "-")}</td>
    <td>${renderStepStatus(step.status)}<div class="graph-meta">${escapeHtml(graph.phase ?? "-")}</div>${renderGraphRecovery(graph)}${step.errorMessage ? `<div class="expectation-reason">${escapeHtml(step.errorMessage)}</div>` : ""}</td>
    <td>${renderGraphMatch("Before", graph.beforeMatch)}${renderGraphMatch("After", graph.afterMatch)}</td>
    <td>${renderGraphActionPolicy(step, graph)}${renderSemanticLocatorEvidence(step.metadata?.semantic)}</td>
    <td>${renderGraphExpectationGroups(step.expectationResults ?? [], graph)}${renderGraphInterceptors(graph.interceptors)}${renderGraphDeviations(graph.deviations)}</td>
    <td>${renderEvidenceLinks(artifacts)}</td>
  </tr>`;
}

function renderGraphInterceptors(interceptors: GraphInterceptorSummary[] | undefined): string {
  if (!interceptors?.length) {
    return "";
  }
  return `<div class="graph-interceptors">${interceptors
    .map(
      (item) =>
        `<div><strong>运行时清障 ${escapeHtml(item.phase ?? "-")}</strong><span>${escapeHtml(item.ruleName ?? item.ruleId ?? "-")}：${escapeHtml(item.matchedText ?? "-")}${
          item.action?.type ? ` · ${escapeHtml(item.action.type)}(${escapeHtml(String(item.action.x ?? "-"))}, ${escapeHtml(String(item.action.y ?? "-"))})` : ""
        }</span></div>`
    )
    .join("")}</div>`;
}

function renderGraphDeviations(deviations: GraphDeviationSummary[] | undefined): string {
  if (!deviations?.length) {
    return "";
  }
  return `<div class="graph-deviations">${deviations
    .map((deviation) =>
      `<div><strong>偏离 ${escapeHtml(deviation.phase ?? "-")}</strong><span>第 ${escapeHtml(String(deviation.attempt ?? 1))} 次 · ${escapeHtml(deviation.action ?? "-")}：${escapeHtml(deviation.message ?? "-")}</span></div>`
    )
    .join("")}</div>`;
}

function renderGraphRecovery(graph: GraphStepMetadata): string {
  if (typeof graph.recoveryAttempt !== "number") {
    return "";
  }
  return `<div class="graph-recovery"><strong>恢复路径</strong><span>第 ${escapeHtml(String(graph.recoveryAttempt))} 次重规划${
    graph.recoveryReasonDeviationId ? ` · 来源偏离 ${escapeHtml(graph.recoveryReasonDeviationId)}` : ""
  }</span></div>`;
}

function renderGraphMatch(label: string, match: NodeMatchSummary | undefined): string {
  if (!match) {
    return `<div class="graph-match"><strong>${escapeHtml(label)}:</strong> <span class="muted">无</span></div>`;
  }
  const score = typeof match.score === "number" ? ` ${(match.score * 100).toFixed(0)}%` : "";
  const candidates = (match.candidates ?? [])
    .slice(0, 3)
    .map((candidate) => {
      const candidateScore = typeof candidate.score === "number" ? ` ${Math.round(candidate.score * 100)}%` : "";
      const weight =
        typeof candidate.matchedWeight === "number" && typeof candidate.totalWeight === "number"
          ? ` · 命中 ${candidate.matchedWeight} / ${candidate.totalWeight}`
          : "";
      return `<div><span>${escapeHtml(candidate.nodeName ?? candidate.nodeId ?? "-")}${escapeHtml(candidateScore)}${escapeHtml(weight)}${renderMatchQualityText(
        candidate.quality
      )}</span>${renderMatcherResults(candidate.matcherResults)}</div>`;
    })
    .join("");
  return `<div class="graph-match"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(match.status ?? "-")} ${escapeHtml(match.nodeName ?? match.nodeId ?? "")}${escapeHtml(score)}${
    candidates ? `<div class="graph-match-candidates"><strong>候选</strong>${candidates}</div>` : ""
  }</div>`;
}

function renderMatchQualityText(quality: NodeMatchCandidateSummary["quality"]): string {
  if (!quality) {
    return "";
  }
  const signalText = [
    typeof quality.matchedStrongSignals === "number" ? `强锚点 ${quality.matchedStrongSignals}` : "",
    typeof quality.matchedWeakSignals === "number" ? `弱锚点 ${quality.matchedWeakSignals}` : "",
    typeof quality.matchedContextSignals === "number" ? `上下文 ${quality.matchedContextSignals}` : ""
  ]
    .filter(Boolean)
    .join(" / ");
  const reasons = quality.reasons?.length ? ` · 原因 ${quality.reasons.join(", ")}` : "";
  const missing = quality.missingStrongMatcherIds?.length ? ` · 缺失强锚点 ${quality.missingStrongMatcherIds.join(", ")}` : "";
  const prefix = quality.status ? ` · 质量 ${quality.status}` : "";
  return `${prefix}${signalText ? ` · ${signalText}` : ""}${reasons}${missing}`;
}

function renderMatcherResults(results: MatcherResultSummary[] | undefined): string {
  if (!results?.length) {
    return "";
  }
  return `<div class="graph-matchers">${results
    .slice(0, 6)
    .map((result) => {
      const state = result.matched === false ? "未命中" : "命中";
      const detail = [
        result.expected ? `期望=${result.expected}` : "",
        result.actual ? `实际=${result.actual}` : "",
        typeof result.weight === "number" ? `权重=${result.weight}` : "",
        typeof result.score === "number" ? `得分=${result.score}` : "",
        result.reason ? `原因=${result.reason}` : ""
      ]
        .filter(Boolean)
        .join("；");
      return `<div class="${result.matched === false ? "missed" : "matched"}"><strong>${escapeHtml(state)} ${escapeHtml(result.matcherId ?? "-")}</strong><span>${escapeHtml(result.type ?? "-")}${
        detail ? ` · ${escapeHtml(detail)}` : ""
      }</span></div>`;
    })
    .join("")}</div>`;
}

function renderGraphActionPolicy(step: StepResult, graph: GraphStepMetadata): string {
  const policy = graph.actionPolicy;
  if (!policy) {
    return `${escapeHtml(step.type)}${graph.usedActionPolicyId ? `<div class="graph-meta">policy=${escapeHtml(graph.usedActionPolicyId)}</div>` : ""}${
      graph.fallbackActionPolicyId ? `<div class="graph-meta">fallback=${escapeHtml(graph.fallbackActionPolicyId)}</div>` : ""
    }`;
  }
  const action = policy.action;
  return `<div class="graph-action">
    <strong>${escapeHtml(action?.type ?? step.type)}</strong>
    <span>policy=${escapeHtml(policy.id ?? graph.usedActionPolicyId ?? "-")}</span>
    <span>priority=${escapeHtml(String(policy.priority ?? "-"))} · fallback=${escapeHtml(String(policy.fallback ?? false))} · reliability=${escapeHtml(policy.reliabilityHint ?? "-")}</span>
    ${action?.params !== undefined ? `<code class="graph-json">params=${escapeHtml(formatUnknownValue(action.params))}</code>` : ""}
    ${action?.coordinate !== undefined ? `<code class="graph-json">coordinate=${escapeHtml(formatUnknownValue(action.coordinate))}</code>` : ""}
    ${action?.timing !== undefined ? `<code class="graph-json">timing=${escapeHtml(formatUnknownValue(action.timing))}</code>` : ""}
    ${graph.fallbackActionPolicyId ? `<span>fallbackPolicy=${escapeHtml(graph.fallbackActionPolicyId)}</span>` : ""}
  </div>`;
}

function renderSemanticLocatorEvidence(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const semantic = value as Record<string, unknown>;
  const rows = [
    textValue(semantic.relocatedBy) ? `resolvedBy=${textValue(semantic.relocatedBy)}` : "",
    textValue(semantic.focusResolvedBy) ? `focus=${textValue(semantic.focusResolvedBy)}` : "",
    textValue(semantic.fallback) ? `fallback=${textValue(semantic.fallback)}` : "",
    textValue(semantic.targetText) ? `target=${textValue(semantic.targetText)}` : "",
    typeof semantic.inputVerified === "boolean" ? `inputVerified=${semantic.inputVerified}` : "",
    textValue(semantic.verificationStrategy) ? `verify=${textValue(semantic.verificationStrategy)}` : ""
  ].filter(Boolean);
  const visualCandidate = readSemanticObject(semantic.visualCandidate);
  if (visualCandidate) {
    rows.push(
      [
        "candidate",
        textValue(visualCandidate.label),
        textValue(visualCandidate.role),
        typeof visualCandidate.score === "number" ? `score=${visualCandidate.score}` : "",
        textValue(visualCandidate.semanticArea)
      ].filter(Boolean).join(" · ")
    );
  }
  const visualTemplate = readSemanticObject(semantic.visualTemplate);
  if (visualTemplate) {
    rows.push(
      [
        "template",
        textValue(visualTemplate.hash) ? `hash=${textValue(visualTemplate.hash)}` : "",
        typeof visualTemplate.similarity === "number" ? `similarity=${visualTemplate.similarity}` : ""
      ].filter(Boolean).join(" · ")
    );
  }
  const visualRelocation = readSemanticObject(semantic.visualRelocation);
  if (visualRelocation) {
    rows.push(
      [
        "relocation",
        textValue(visualRelocation.reason),
        typeof visualRelocation.minScore === "number" ? `min=${visualRelocation.minScore}` : "",
        typeof visualRelocation.candidateCount === "number" ? `candidates=${visualRelocation.candidateCount}` : ""
      ].filter(Boolean).join(" · ")
    );
  }
  if (!rows.length) {
    rows.push(formatUnknownValue(semantic));
  }
  return `<div class="graph-diagnostics semantic-locator-evidence"><div><strong>定位证据</strong><span>${escapeHtml(rows.join("；"))}</span></div></div>`;
}

function readSemanticObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function renderGraphExpectationGroups(results: StepExpectationResult[], graph: GraphStepMetadata): string {
  if (!results.length) {
    return '<span class="muted">未配置</span>';
  }
  const overlayIds = overlayExpectationIds(graph);
  return `<div class="expectation-chips">${results
    .map((result) => {
      const source = overlayIds.has(result.expectationId) ? "overlay" : isSystemGuardExpectationType(result.type) ? "guard" : "default";
      const sourceLabel = source === "overlay" ? "动态预期" : source === "guard" ? "系统护栏" : "图谱默认";
      return `<span>${renderExpectationChip(result)} <span class="graph-source ${source}">${sourceLabel}</span></span>`;
    })
    .join("")}</div>`;
}

function collectGraphSteps(run: TestRun): GraphStepReport[] {
  return run.stepResults
    .map((step) => ({ step, graph: readGraphMetadata(step.metadata) }))
    .filter((item): item is GraphStepReport => Boolean(item.graph));
}

function readGraphMetadata(metadata: Record<string, unknown> | undefined): GraphStepMetadata | undefined {
  const graph = metadata?.graph;
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
    return undefined;
  }
  return graph as GraphStepMetadata;
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

function readAssetPatrolMetadata(metadata: Record<string, unknown> | undefined): {
  kind?: string;
  label?: string;
  status?: string;
  executionMode?: string;
  pageModelName?: string;
  skipReason?: string;
  startPage?: { name?: string };
} | undefined {
  const value = metadata?.assetPatrol;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as {
        kind?: string;
        label?: string;
        status?: string;
        executionMode?: string;
        pageModelName?: string;
        skipReason?: string;
        startPage?: { name?: string };
      })
    : undefined;
}

function renderStepActionCell(step: StepResult): string {
  const assetPatrol = readAssetPatrolMetadata(step.metadata);
  if (!assetPatrol) {
    return escapeHtml(step.type);
  }
  const label = assetPatrol.label || assetPatrol.kind || step.type;
  const detail = [assetPatrol.kind, assetPatrol.status, assetPatrol.skipReason].filter(isNonEmptyString).join(" · ");
  return `<strong>${escapeHtml(label)}</strong>${detail ? `<div class="graph-meta">${escapeHtml(detail)}</div>` : ""}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function graphRouteNodes(graphSteps: GraphStepReport[]): string[] {
  const nodes: string[] = [];
  for (const { graph } of graphSteps) {
    const from = graph.fromNodeName ?? graph.fromNodeId;
    const to = graph.toNodeName ?? graph.toNodeId;
    if (from && nodes.length === 0) {
      nodes.push(from);
    }
    if (to && nodes.at(-1) !== to) {
      nodes.push(to);
    }
  }
  return nodes;
}

function overlayExpectationIds(graph: GraphStepMetadata): Set<string> {
  return new Set([...(graph.runtimeOverlay?.targetExpectationIds ?? []), ...(graph.runtimeOverlay?.edgeExpectationIds ?? [])]);
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
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

function formatUnknownValue(value: unknown): string {
  if (value === undefined) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatUnknown(value: unknown, fallback: unknown): string {
  return formatUnknownValue(value ?? fallback);
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
