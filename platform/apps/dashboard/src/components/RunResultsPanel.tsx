import {
  androidAppMonitorDisplaySummaryForRuns,
  androidAppMonitorDisplaySummaryFromRun,
  shouldDisplayExpectationResult,
  type AndroidAppMonitorDisplaySummary,
  type DeviceInfo,
  type StepExpectationResult,
  type TestRun
} from "@mobile-automation/shared";
import { ArrowLeft, Camera, CheckCircle2, Pause, Play, Smartphone, Square, StepForward, Video, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
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
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const currentDeviceRuns = selectedSerial ? runs.filter((run) => run.deviceSerial === selectedSerial) : [];
  const visibleRuns = currentDeviceRuns.length ? currentDeviceRuns : runs;
  const resultGroups = buildRunResultGroups(visibleRuns);
  const selectedGroup = selectedGroupId ? resultGroups.find((group) => group.id === selectedGroupId) : undefined;
  const failedRunCount = resultGroups.filter((group) => isFailureStatus(group.status)).length;
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
            {!currentRun && !selectedGroup && (
              <div className="run-count-summary">
                <span>{resultGroups.length} 条记录</span>
                {!!failedRunCount && <strong>{failedRunCount} 个异常</strong>}
              </div>
            )}
            {!currentRun && selectedGroup && (
              <button className="icon-button compact" onClick={() => setSelectedGroupId("")} title="返回执行列表">
                <ArrowLeft size={16} />
              </button>
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
              {renderAndroidAppMonitorSummary(androidAppMonitorDisplaySummaryFromRun(currentRun))}
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
                        {eventDetailForDisplay(event) && <small>{eventDetailForDisplay(event)}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : selectedGroup ? (
            <RunResultGroupDetail group={selectedGroup} onSelectRun={setCurrentRunId} />
          ) : (
            <>
              <div className="run-list-head">
                <span>{currentDeviceRuns.length ? "当前设备执行记录" : "全部执行记录"}</span>
                <strong>{resultGroups.length}</strong>
              </div>
              <div className="recent-runs">
                {resultGroups.map((group) => (
                  <button
                    className={group.runs.some(isActiveRun) ? "active-run-item" : ""}
                    key={group.id}
                    onClick={() => {
                      if (group.isBatch) {
                        setCurrentRunId("");
                        setSelectedGroupId(group.id);
                        return;
                      }
                      setSelectedGroupId("");
                      setCurrentRunId(group.runs[0]?.id ?? "");
                    }}
                  >
                    <span className="run-list-main">
                      <strong className="run-list-title">{group.title}</strong>
                      <small>{runResultGroupSubtitle(group)}</small>
                    </span>
                    <strong className={`run-status-mini ${group.status}`}>{group.status}</strong>
                  </button>
                ))}
                {!resultGroups.length && <div className="empty">暂无执行记录</div>}
                {runs.length >= runsLimit && (
                  <button className="load-more-runs" onClick={loadMoreRuns}>
                    加载更多执行记录
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

type RunExecutionContext = NonNullable<TestRun["config"]["executionContext"]>;

type RunResultGroup = {
  id: string;
  title: string;
  status: TestRun["status"];
  deviceSerial: string;
  startedAt: string;
  latestStartedAt: string;
  runs: TestRun[];
  isBatch: boolean;
  context?: RunExecutionContext;
};

function RunResultGroupDetail({
  group,
  onSelectRun
}: {
  group: RunResultGroup;
  onSelectRun: (runId: string) => void;
}) {
  const failedChildren = group.runs.filter((run) => isFailureStatus(run.status)).length;
  return (
    <div className="run-detail">
      <div className="run-summary-line">
        <div className={`run-status ${group.status}`}>{group.status}</div>
        <div className="run-duration">{group.runs.length} 个子 Run</div>
      </div>
      <div className="run-group-summary">
        <strong>{group.title}</strong>
        <span>{group.deviceSerial} · {formatShortTime(group.startedAt)}</span>
      </div>
      <div className="run-evidence-grid">
        <div><strong>{group.runs.length}</strong><span>子 Run</span></div>
        <div><strong>{group.runs.filter((run) => run.status === "passed").length}</strong><span>通过</span></div>
        <div><strong>{failedChildren}</strong><span>异常</span></div>
        <div><strong>{group.runs.filter(isActiveRun).length}</strong><span>运行中</span></div>
      </div>
      <div className="run-mini-section">
        <div className="run-mini-head">
          <strong>子 Run 明细</strong>
          <span>按资产步骤顺序</span>
        </div>
        <div className="recent-runs run-child-runs">
          {group.runs.map((run) => (
            <button className={isActiveRun(run) ? "active-run-item" : ""} key={run.id} onClick={() => onSelectRun(run.id)}>
              <span className="run-child-order">{formatRunExecutionOrder(run)}</span>
              <span className="run-list-main">
                <strong className="run-list-title">{runResultChildTitle(run)}</strong>
                <small>{runExecutionKindLabel(run)} · {run.id} · {formatShortTime(run.startedAt)}</small>
              </span>
              <strong className={`run-status-mini ${run.status}`}>{run.status}</strong>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function buildRunResultGroups(runs: TestRun[]): RunResultGroup[] {
  const groups = new Map<string, RunResultGroup>();
  for (const run of runs) {
    const context = normalizedRunExecutionContext(run);
    const groupId = context ? `context:${context.parentExecutionType}:${context.parentExecutionId}` : `run:${run.id}`;
    const existing = groups.get(groupId);
    if (existing) {
      existing.runs.push(run);
      existing.startedAt = minIso(existing.startedAt, run.startedAt);
      existing.latestStartedAt = maxIso(existing.latestStartedAt, run.startedAt);
      existing.status = aggregateRunStatus(existing.runs);
      continue;
    }
    groups.set(groupId, {
      id: groupId,
      title: context ? runExecutionGroupTitle(context) : run.caseName,
      status: run.status,
      deviceSerial: run.deviceSerial,
      startedAt: run.startedAt,
      latestStartedAt: run.startedAt,
      runs: [run],
      isBatch: Boolean(context),
      ...(context ? { context } : {})
    });
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      status: aggregateRunStatus(group.runs),
      runs: [...group.runs].sort(compareRunsWithinGroup)
    }))
    .sort((left, right) => compareIsoDesc(left.latestStartedAt, right.latestStartedAt));
}

function normalizedRunExecutionContext(run: TestRun): RunExecutionContext | undefined {
  const context = run.config.executionContext;
  return context?.parentExecutionId?.trim() ? context : undefined;
}

function runExecutionGroupTitle(context: RunExecutionContext): string {
  return `${runExecutionParentTypeLabel(context.parentExecutionType)}：${context.parentExecutionName || "未命名执行"}`;
}

function runExecutionParentTypeLabel(type: RunExecutionContext["parentExecutionType"]): string {
  if (type === "free_composition") {
    return "AI资产用例";
  }
  if (type === "asset_patrol") {
    return "资产巡检";
  }
  return "资产用例";
}

function runResultGroupSubtitle(group: RunResultGroup): string {
  const childRunText = group.isBatch ? ` · ${group.runs.length} 个子 Run` : "";
  const appMonitorText = androidAppMonitorGroupStatusText(group);
  return `${group.deviceSerial} · ${formatShortTime(group.startedAt)}${childRunText}${appMonitorText ? ` · ${appMonitorText}` : ""}`;
}

function runResultChildTitle(run: TestRun): string {
  const label = run.config.executionContext?.itemLabel?.trim();
  return label || run.caseName;
}

function runExecutionKindLabel(run: TestRun): string {
  const kind = run.config.executionContext?.itemKind;
  if (kind === "asset_target") {
    return "资产边";
  }
  if (kind === "retry") {
    return "重试";
  }
  if (kind === "recovery") {
    return "恢复";
  }
  return kind || "Run";
}

function formatRunExecutionOrder(run: TestRun): string {
  const order = run.config.executionContext?.itemOrder;
  return typeof order === "number" && Number.isFinite(order) ? `#${order}` : "#";
}

function compareRunsWithinGroup(left: TestRun, right: TestRun): number {
  const leftOrder = left.config.executionContext?.itemOrder;
  const rightOrder = right.config.executionContext?.itemOrder;
  if (typeof leftOrder === "number" && typeof rightOrder === "number" && leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (typeof leftOrder === "number" && typeof rightOrder !== "number") {
    return -1;
  }
  if (typeof leftOrder !== "number" && typeof rightOrder === "number") {
    return 1;
  }
  return compareIsoAsc(left.startedAt, right.startedAt);
}

function aggregateRunStatus(runs: TestRun[]): TestRun["status"] {
  if (runs.some((run) => run.status === "running")) {
    return "running";
  }
  if (runs.some((run) => run.status === "paused")) {
    return "paused";
  }
  if (runs.some((run) => run.status === "device_lost")) {
    return "device_lost";
  }
  if (runs.some((run) => run.status === "timeout")) {
    return "timeout";
  }
  if (runs.some((run) => run.status === "failed")) {
    return "failed";
  }
  if (runs.some((run) => run.status === "stopped")) {
    return "stopped";
  }
  return runs.every((run) => run.status === "passed") ? "passed" : runs[0]?.status ?? "pending";
}

function isFailureStatus(status: TestRun["status"]): boolean {
  return status !== "passed" && status !== "running" && status !== "paused" && status !== "pending";
}

function minIso(left: string, right: string): string {
  return compareIsoAsc(left, right) <= 0 ? left : right;
}

function maxIso(left: string, right: string): string {
  return compareIsoAsc(left, right) >= 0 ? left : right;
}

function compareIsoAsc(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.localeCompare(right);
}

function compareIsoDesc(left: string, right: string): number {
  return compareIsoAsc(right, left);
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

function renderAndroidAppMonitorSummary(summary: AndroidAppMonitorDisplaySummary | undefined): ReactNode {
  if (!summary) {
    return null;
  }
  return (
    <div className={`run-mini-section app-monitor-run-summary ${summary.severity}`}>
      <div className="run-mini-head">
        <strong>App 性能</strong>
        <span>{androidAppMonitorHealthLabel(summary)}</span>
      </div>
      <div className="run-evidence-grid">
        <div><strong>{summary.packageName}</strong><span>监控 App</span></div>
        <div><strong>{summary.processCount}</strong><span>进程</span></div>
        <div><strong>{summary.incidentCount}</strong><span>告警</span></div>
        <div><strong>{summary.cpuSamples + summary.memorySamples}</strong><span>采样</span></div>
      </div>
      <div className="run-meta">{androidAppMonitorSampleText(summary)}</div>
    </div>
  );
}

function androidAppMonitorGroupStatusText(group: RunResultGroup): string {
  const summary = androidAppMonitorDisplaySummaryForRuns(group.runs);
  return summary ? `App 性能${androidAppMonitorHealthLabel(summary)}` : "";
}

function androidAppMonitorHealthLabel(summary: AndroidAppMonitorDisplaySummary): string {
  return summary.severity === "error" || summary.severity === "warning" || summary.incidentCount > 0 ? "有告警" : "正常";
}

function androidAppMonitorSampleText(summary: AndroidAppMonitorDisplaySummary): string {
  return `CPU ${summary.cpuSamples} · 内存 ${summary.memorySamples} · 生命周期 ${summary.lifecycleSamples}`;
}

function eventDetailForDisplay(event: TestRun["events"][number]): string {
  if (event.type === "android_app_monitor") {
    return "";
  }
  return event.detail ?? "";
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
