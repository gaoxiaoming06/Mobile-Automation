import {
  androidAppMonitorDisplaySummaryForRuns,
  androidAppMonitorDisplaySummaryFromRun,
  publicExecutionFailureFromRun,
  shouldDisplayExpectationResult,
  type AndroidAppMonitorDisplaySummary,
  type DeviceInfo,
  type StepExpectationResult,
  type TestRun
} from "@mobile-automation/shared";
import { ArrowLeft, Camera, CheckCircle2, Pause, Play, Smartphone, Square, StepForward, Video, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { expectationLabel } from "./StepExpectationPanel";
import { devicePlatformLabel } from "./PreviewPanel";
import { caseStepViews, readCaseDocument } from "./case-view";
import { formatShortTime } from "./time-format";

type RunResultsPanelProps = {
  selectedDevice?: DeviceInfo;
  currentRun: TestRun | null;
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
  const resultGroups = buildRunResultGroups(visibleRuns);
  const failedRunCount = resultGroups.filter((group) => isFailureStatus(group.status)).length;
  const deviceTitle = selectedDevice?.name || selectedSerial || "未选择设备";
  const deviceMeta = selectedDevice
    ? `${devicePlatformLabel(selectedDevice.platform)}${selectedDevice.osVersion ? ` ${selectedDevice.osVersion}` : ""} · ${selectedDevice.status} · ${selectedDevice.serial}`
    : "请选择设备后查看执行结果";
  const executionFailure = currentRun ? publicExecutionFailureFromRun(currentRun) : undefined;
  const sourceStepTitles = currentRun ? sourceStepTitlesForRun(currentRun) : new Map<string, string>();

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
                <span>{resultGroups.length} 条记录</span>
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
              {executionFailure && (
                <div className="execution-failure-notice">
                  <strong>执行未完成</strong>
                  <p>{executionFailure.message}</p>
                  {!!executionFailure.details?.length && (
                    <dl className="execution-failure-details">
                      {executionFailure.details.map((detail) => (
                        <div key={detail.label}>
                          <dt>{detail.label}</dt>
                          <dd>{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <small>现场截图和完整定位记录请查看 HTML 报告。</small>
                </div>
              )}
              {renderAndroidAppMonitorSummary(androidAppMonitorDisplaySummaryFromRun(currentRun))}
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
                    const display = runStepResultDisplay(step, currentRun.steps, sourceStepTitles);
                    return (
                      <div className="run-step-result" key={step.id}>
                        <span className="step-order">{step.stepOrder}</span>
                        <div>
                          <strong>{display.label}</strong>
                          <small>{formatRunStepResultDetail(step, display)}</small>
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
                        <span>{eventSummaryForDisplay(event)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
                    onClick={() => setCurrentRunId(group.runs[0]?.id ?? "")}
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

type RunResultGroup = {
  id: string;
  title: string;
  status: TestRun["status"];
  deviceSerial: string;
  startedAt: string;
  latestStartedAt: string;
  runs: TestRun[];
};

export function buildRunResultGroups(runs: TestRun[]): RunResultGroup[] {
  return runs
    .map((run) => ({
      id: `run:${run.id}`,
      title: run.caseName,
      status: run.status,
      deviceSerial: run.deviceSerial,
      startedAt: run.startedAt,
      latestStartedAt: run.startedAt,
      runs: [run]
    }))
    .sort((left, right) => compareIsoDesc(left.latestStartedAt, right.latestStartedAt));
}

function runResultGroupSubtitle(group: RunResultGroup): string {
  const appMonitorText = androidAppMonitorGroupStatusText(group);
  return `${group.deviceSerial} · ${formatShortTime(group.startedAt)}${appMonitorText ? ` · ${appMonitorText}` : ""}`;
}

function isFailureStatus(status: TestRun["status"]): boolean {
  return status !== "passed" && status !== "running" && status !== "paused" && status !== "pending";
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

function eventSummaryForDisplay(event: TestRun["events"][number]): string {
  if (event.type === "android_app_monitor") return event.summary;
  if (["crash", "anr", "app_exit", "black_screen", "native_crash", "process_death"].includes(event.type)) {
    return "目标 App 在执行过程中出现异常。";
  }
  if (event.type === "device_lost" || event.type === "preview_lost") return "设备连接在执行过程中中断。";
  return "执行过程中记录到异常，技术细节请查看报告。";
}

type RunStepResult = TestRun["stepResults"][number];
type RunStep = TestRun["steps"][number];

type RunStepResultDisplay = {
  label: string;
};

export function runStepResultDisplay(
  step: RunStepResult,
  plannedSteps: RunStep[] = [],
  sourceStepTitles: Map<string, string> = new Map()
): RunStepResultDisplay {
  const plannedStep = plannedStepForResult(step, plannedSteps);
  const sourceStepId = sourceStepIdForResult(step, plannedStep);
  const sourceTitle = sourceStepId ? sourceStepTitles.get(sourceStepId) : undefined;
  return { label: sourceTitle ?? readablePlannedStepTitle(plannedStep) ?? step.type };
}

function formatRunStepResultDetail(step: RunStepResult, _display: RunStepResultDisplay): string {
  return `${step.durationMs ?? "-"} ms · ${step.status}`;
}

function plannedStepForResult(step: RunStepResult, plannedSteps: RunStep[]): RunStep | undefined {
  return plannedSteps.find((candidate) => candidate.id === step.stepId)
    ?? plannedSteps.find((candidate) => candidate.order === step.stepOrder);
}

function sourceStepTitlesForRun(run: TestRun): Map<string, string> {
  const parsed = recordValue(run.sourceSnapshot?.parsed);
  const document = readCaseDocument(parsed);
  if (!document) return new Map();
  return new Map(caseStepViews(document).map((step) => [step.id, step.name]));
}

function sourceStepIdForResult(step: RunStepResult, plannedStep: RunStep | undefined): string | undefined {
  return nonEmptyString(plannedStep?.params.scriptStepId)
    ?? nonEmptyString(step.metadata?.scriptStepId)
    ?? nonEmptyString(step.stepId);
}

function readablePlannedStepTitle(plannedStep: RunStep | undefined): string | undefined {
  const title = nonEmptyString(plannedStep?.title) ?? nonEmptyString(plannedStep?.note);
  if (!title || title === plannedStep?.type || GENERIC_EXECUTION_TITLES.has(title)) return undefined;
  return title;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const GENERIC_EXECUTION_TITLES = new Set([
  "tap",
  "inputText",
  "clearText",
  "selectText",
  "swipe",
  "scrollUntilVisible",
  "reachPage",
  "waitForPage",
  "assertPage",
  "assertText",
  "点击目标",
  "输入文本",
  "清空输入",
  "选择选项",
  "滑动页面",
  "查找内容",
  "到达页面",
  "等待页面",
  "确认页面",
  "确认文字",
  "确认出现指定内容"
]);

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
