import {
  shouldDisplayExpectationResult,
  type DeviceInfo,
  type StepExpectationResult,
  type TestRun
} from "@mobile-automation/shared";
import { ArrowLeft, Camera, CheckCircle2, Pause, Play, Smartphone, Square, StepForward, Video, XCircle } from "lucide-react";
import { expectationLabel } from "./StepExpectationPanel";
import { GraphRunDetail, type GraphRunSummary } from "./GraphRunDetail";
import { formatShortTime } from "./time-format";

type RunResultsPanelProps = {
  selectedDevice?: DeviceInfo;
  currentRun: TestRun | null;
  currentGraphRun: GraphRunSummary | null;
  runs: TestRun[];
  runsLimit: number;
  selectedSerial: string;
  setCurrentRunId: (runId: string) => void;
  stopCurrentRun: () => Promise<void>;
  pauseCurrentRun: () => Promise<void>;
  resumeCurrentRun: () => Promise<void>;
  stepCurrentRun: () => Promise<void>;
  loadMoreRuns: () => void;
};

export function RunResultsPanel({
  selectedDevice,
  currentRun,
  currentGraphRun,
  runs,
  runsLimit,
  selectedSerial,
  setCurrentRunId,
  stopCurrentRun,
  pauseCurrentRun,
  resumeCurrentRun,
  stepCurrentRun,
  loadMoreRuns
}: RunResultsPanelProps) {
  const currentDeviceRuns = selectedSerial ? runs.filter((run) => run.deviceSerial === selectedSerial) : [];
  const visibleRuns = currentDeviceRuns.length ? currentDeviceRuns : runs;
  const failedRunCount = visibleRuns.filter((run) => run.status !== "passed" && run.status !== "running" && run.status !== "paused").length;
  const deviceTitle = selectedDevice?.name || selectedSerial || "未选择设备";
  const deviceMeta = selectedDevice
    ? `${selectedDevice.platform === "ios" ? "iOS" : "Android"}${selectedDevice.osVersion ? ` ${selectedDevice.osVersion}` : ""} · ${selectedDevice.status} · ${selectedDevice.serial}`
    : "请选择设备后查看执行结果";

  return (
    <aside className="steps-panel">
      <div className="panel automation-workbench runs-workbench">
        <div className="automation-tab-body runs-tab">
          <div className="run-device-head">
            <div>
              <span>当前设备</span>
              <strong>{deviceTitle}</strong>
              <small>{deviceMeta}</small>
            </div>
            <Smartphone size={20} />
          </div>
          <div className="panel-head">
            <h2>执行结果</h2>
            {!currentRun && (
              <div className="run-count-summary">
                <span>{visibleRuns.length} 条记录</span>
                {!!failedRunCount && <strong>{failedRunCount} 个异常</strong>}
              </div>
            )}
            {currentRun && (
              <button className="icon-button compact" onClick={() => setCurrentRunId("")} title="返回执行列表">
                <ArrowLeft size={16} />
              </button>
            )}
          </div>
          {currentRun ? (
            <div className="run-detail">
              <div className="run-summary-line">
                <div className={`run-status ${currentRun.status}`}>{currentRun.status}</div>
                <div className="run-duration">{formatRunDuration(currentRun)}</div>
              </div>
              <div className="run-meta run-id">{currentRun.id}</div>
              <div className="run-evidence-grid">
                <div><strong>{currentRun.stepResults.length}</strong><span>步骤结果</span></div>
                <div><strong>{currentRun.metrics.length}</strong><span>性能采样</span></div>
                <div><strong>{currentRun.events.length}</strong><span>异常事件</span></div>
                <div><strong>{currentRun.artifacts.filter((artifact) => artifact.type === "video" && !artifact.deletedAt).length}</strong><span>视频</span></div>
              </div>
              {(currentRun.status === "running" || currentRun.status === "paused") && (
                <div className="action-row">
                  {currentRun.status === "running" && (
                    <button className="icon-button" onClick={() => void pauseCurrentRun()}>
                      <Pause size={16} />
                      暂停
                    </button>
                  )}
                  {currentRun.status === "paused" && (
                    <>
                      <button className="icon-button" onClick={() => void resumeCurrentRun()}>
                        <Play size={16} />
                        继续
                      </button>
                      <button className="icon-button" onClick={() => void stepCurrentRun()}>
                        <StepForward size={16} />
                        单步
                      </button>
                    </>
                  )}
                  <button className="icon-button danger" onClick={() => void stopCurrentRun()}>
                    <Square size={16} />
                    停止
                  </button>
                </div>
              )}
              {currentRun.reportHtmlPath && (
                <a className="report-link" href={`/api/reports/${currentRun.id}/html`} target="_blank" rel="noreferrer">
                  打开 HTML 报告
                </a>
              )}
              {currentRun.artifacts
                .filter(isAndroidAppMonitorArtifact)
                .map((artifact) => (
                  <a className="report-link secondary" href={artifact.url} target="_blank" rel="noreferrer" key={artifact.id}>
                    {artifact.name}
                  </a>
                ))}
              {currentGraphRun && <GraphRunDetail summary={currentGraphRun} />}
              {currentRun.artifacts
                .filter((artifact) => artifact.type === "video" && !artifact.deletedAt)
                .slice(0, 1)
                .map((artifact) => (
                  <a className="report-link secondary" href={artifact.url} target="_blank" rel="noreferrer" key={artifact.id}>
                    <Video size={14} />
                    打开执行视频
                  </a>
                ))}
              <div className="run-mini-section">
                <div className="run-mini-head">
                  <strong>步骤结果</strong>
                  <span>{currentRun.stepResults.filter((step) => step.status !== "passed").length} 个非通过</span>
                </div>
                <div className="run-step-results">
                  {currentRun.stepResults.slice(0, 8).map((step) => {
                    const screenshot = step.artifacts.find((artifact) => artifact.type === "screenshot");
                    const display = runStepResultDisplay(step);
                    return (
                      <div className="run-step-result" key={step.id}>
                        <span className="step-order">{step.stepOrder}</span>
                        <div>
                          <strong>{display.label}</strong>
                          <small>{formatRunStepResultDetail(step, display)}</small>
                          {step.errorMessage && <small className="error-text">{step.errorMessage}</small>}
                          {renderStepConditionResult(step.metadata)}
                          {visibleExpectationResults(step.expectationResults).length > 0 && (
                            <div className="expectation-result-chips">
                              {visibleExpectationResults(step.expectationResults).map((result) => renderExpectationResultChip(result))}
                            </div>
                          )}
                        </div>
                        {screenshot && (
                          <a href={screenshot.url} target="_blank" rel="noreferrer" title="查看步骤截图">
                            <Camera size={15} />
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {!currentRun.stepResults.length && <div className="empty">执行中，暂无步骤结果</div>}
                </div>
              </div>
              {!!currentRun.events.length && (
                <div className="run-mini-section">
                  <div className="run-mini-head">
                    <strong>异常事件</strong>
                    <span>{currentRun.events.length}</span>
                  </div>
                  <div className="run-event-list">
                    {currentRun.events.slice(0, 4).map((event) => (
                      <div className={`run-event-item ${event.severity}`} key={event.id}>
                        <strong>{event.type}</strong>
                        <span>{event.summary}</span>
                        {event.detail && <small>{event.detail}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="run-list-head">
              <span>{currentDeviceRuns.length ? "当前设备执行记录" : "全部执行记录"}</span>
              <strong>{visibleRuns.length}</strong>
            </div>
          )}
          {!currentRun && (
            <div className="recent-runs">
              {visibleRuns.map((run) => (
                <button className={isActiveRun(run) ? "active-run-item" : ""} key={run.id} onClick={() => setCurrentRunId(run.id)}>
                  <span className="run-list-main">
                    <strong className="run-list-title">{run.caseName}</strong>
                    <small>{run.deviceSerial} · {formatShortTime(run.startedAt)}</small>
                  </span>
                  <strong className={`run-status-mini ${run.status}`}>{run.status}</strong>
                </button>
              ))}
              {!visibleRuns.length && <div className="empty">暂无执行记录</div>}
              {runs.length >= runsLimit && (
                <button className="load-more-runs" onClick={loadMoreRuns}>
                  加载更多执行记录
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function renderExpectationResultChip(result: StepExpectationResult) {
  const passed = result.status === "passed";
  const Icon = passed ? CheckCircle2 : XCircle;
  const policy = result.blocking === false ? "建议" : "阻断";
  return (
    <span
      className={`expectation-result-chip ${result.status} ${result.blocking === false ? "advisory" : "blocking"}`}
      key={result.id}
      title={`${policy}\n${result.expected}\n${result.actual}${result.reason ? `\n${result.reason}` : ""}`}
    >
      <Icon size={12} />
      {expectationLabel(result.type)}: {result.status} · {policy}
    </span>
  );
}

function visibleExpectationResults(results: StepExpectationResult[] | undefined): StepExpectationResult[] {
  return (results ?? []).filter(shouldDisplayExpectationResult);
}

function isAndroidAppMonitorArtifact(artifact: TestRun["artifacts"][number]): boolean {
  return !artifact.deletedAt && (artifact.type === "metrics" || artifact.type === "report_json") && artifact.name.includes("android-app-monitor");
}

type RunStepResult = TestRun["stepResults"][number];

type RunStepResultDisplay = {
  label: string;
  detailPrefix?: string;
};

export function runStepResultDisplay(step: RunStepResult): RunStepResultDisplay {
  const assetPatrol = readAssetPatrolStepMetadata(step.metadata?.assetPatrol);
  if (assetPatrol) {
    return {
      label: assetPatrol.label || assetPatrol.kind || step.type,
      detailPrefix: [assetPatrol.kind, assetPatrol.skipReason].filter(isNonEmptyString).join(" · ") || undefined
    };
  }
  return { label: step.type };
}

function formatRunStepResultDetail(step: RunStepResult, display: RunStepResultDisplay): string {
  const base = `${step.durationMs ?? "-"} ms · ${step.status}`;
  return display.detailPrefix ? `${display.detailPrefix} · ${base}` : base;
}

function readAssetPatrolStepMetadata(value: unknown): { kind?: string; label?: string; skipReason?: string } | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { kind?: string; label?: string; skipReason?: string })
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function renderStepConditionResult(metadata: Record<string, unknown> | undefined) {
  const condition = metadata?.condition;
  const preconditions = metadata?.preconditions;
  return (
    <>
      {isPreconditionMetadata(preconditions) && (
        <small className={preconditions.status === "passed" ? "condition-result matched" : "condition-result skipped"}>
          前置条件{preconditions.status === "passed" ? "满足" : "失败"}：{preconditions.results.length} 项
        </small>
      )}
      {isConditionMetadata(condition) && (
        <small className={condition.matched ? "condition-result matched" : "condition-result skipped"}>
          条件{condition.matched ? "命中" : "未命中"}：{condition.expected}；实际：{condition.actual}
        </small>
      )}
    </>
  );
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

function formatRunDuration(run: TestRun): string {
  const started = Date.parse(run.startedAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return "-";
  }
  const totalSeconds = Math.max(0, Math.round((ended - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isActiveRun(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}
