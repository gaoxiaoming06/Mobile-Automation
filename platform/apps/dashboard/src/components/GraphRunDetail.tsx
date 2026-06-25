import { CheckCircle2, FileText, GitBranch, Image, Video, XCircle } from "lucide-react";
import type { ArtifactRef, StepExpectationResult, TestRun } from "@mobile-automation/shared";
import { shouldDisplayExpectationResult } from "@mobile-automation/shared";
import { expectationLabel } from "./StepExpectationPanel";

export type GraphRunSummary = {
  id: string;
  isGraphRun: boolean;
  active: boolean;
  status: TestRun["status"];
  caseName: string;
  deviceSerial: string;
  startedAt: string;
  endedAt?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  targetNodeName?: string;
  route: GraphRouteItem[];
  failedAt?: GraphRunFailure;
  reportUrl?: string;
  reportPath?: string;
  screenshots: ArtifactRef[];
  videos: ArtifactRef[];
  logs: ArtifactRef[];
  failureEvidence: ArtifactRef[];
  steps: GraphRunStep[];
  diagnostics?: {
    bootstrapCount?: number;
    transitionWaitCount?: number;
    recoveryCount?: number;
    bootstrapEvents?: Array<{
      summary: string;
      detail?: string;
      occurredAt?: string;
    }>;
  };
};

export type GraphRouteItem = {
  edgeId?: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
};

export type GraphRunFailure = {
  stepId?: string;
  edgeId?: string;
  edgeKey?: string;
  nodeId?: string;
  nodeName?: string;
  phase?: string;
  code?: string;
  message?: string;
  expectation?: {
    id: string;
    type: StepExpectationResult["type"];
    expected: string;
    actual: string;
    reason?: string;
  };
};

export type GraphRunStep = {
  id: string;
  order: number;
  status: string;
  type: string;
  phase?: string;
  edgeId?: string;
  edgeKey?: string;
  fromNodeId?: string;
  fromNodeName?: string;
  toNodeId?: string;
  toNodeName?: string;
  runtimeOverlay?: unknown;
  beforeMatch?: unknown;
  afterMatch?: unknown;
  actionPolicy?: unknown;
  action?: {
    label?: string;
    type?: string;
    elementLabel?: string;
    abilityType?: string;
    candidateIndex?: number;
    targetLabel?: string;
  };
  matches?: {
    before?: unknown;
    after?: unknown;
  };
  retry?: {
    attempt?: number;
    reason?: string;
    reasonDeviationId?: string;
  };
  compound?: unknown;
  failureReason?: string;
  recoveryAttempt?: number;
  recoveryReasonDeviationId?: string;
  deviations?: unknown[];
  interceptors?: unknown[];
  errorCode?: string;
  errorMessage?: string;
  expectationResults: StepExpectationResult[];
  artifactIds: string[];
};

type GraphRunDetailProps = {
  summary: GraphRunSummary;
};

export function GraphRunDetail({ summary }: GraphRunDetailProps) {
  const failedSteps = summary.steps.filter((step) => step.status !== "passed" && step.status !== "skipped");
  return (
    <div className="graph-run-detail">
      <div className="graph-run-title">
        <div>
          <span className="module-eyebrow">业务图谱执行</span>
          <h3>{summary.targetNodeName || summary.targetNodeId || "目标节点"}</h3>
        </div>
        <span className={`run-status ${summary.status}`}>{summary.status}</span>
      </div>

      <div className="graph-run-stats">
        <div>
          <strong>{summary.steps.length}</strong>
          <span>图谱步骤</span>
        </div>
        <div>
          <strong>{summary.route.length}</strong>
          <span>业务边</span>
        </div>
        <div>
          <strong>{summary.failureEvidence.length}</strong>
          <span>失败证据</span>
        </div>
        <div>
          <strong>{summary.videos.filter((video) => !video.deletedAt).length}</strong>
          <span>视频</span>
        </div>
        <div>
          <strong>{summary.diagnostics?.bootstrapCount ?? 0}</strong>
          <span>启动归位</span>
        </div>
        <div>
          <strong>{summary.diagnostics?.transitionWaitCount ?? 0}</strong>
          <span>状态等待</span>
        </div>
        <div>
          <strong>{summary.diagnostics?.recoveryCount ?? 0}</strong>
          <span>路径恢复</span>
        </div>
      </div>

      {!!summary.diagnostics?.bootstrapEvents?.length && (
        <div className="graph-run-diagnostics">
          {summary.diagnostics.bootstrapEvents.map((event) => (
            <div key={`${event.occurredAt ?? ""}-${event.summary}`}>
              <strong>启动归位</strong>
              <span>{event.summary}{event.detail ? `：${event.detail}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      <div className="graph-run-path" aria-label="图谱执行路径">
        {routeNodeNames(summary.route).map((node, index) => (
          <span key={`${node}-${index}`}>
            {index > 0 && <small>→</small>}
            <strong>{node}</strong>
          </span>
        ))}
        {!summary.route.length && <span className="empty">目标验证步骤，无需路径迁移</span>}
      </div>

      {summary.failedAt && (
        <div className="graph-run-failure">
          <XCircle size={16} />
          <div>
            <strong>{summary.failedAt.phase || "执行失败"} · {summary.failedAt.nodeName || summary.failedAt.edgeKey || summary.failedAt.stepId}</strong>
            {summary.failedAt.message && <span>{summary.failedAt.message}</span>}
            {summary.failedAt.expectation && (
              <small>
                {expectationLabel(summary.failedAt.expectation.type)}：期望 {summary.failedAt.expectation.expected}；实际 {summary.failedAt.expectation.actual}
                {summary.failedAt.expectation.reason ? `；${summary.failedAt.expectation.reason}` : ""}
              </small>
            )}
          </div>
        </div>
      )}

      <div className="graph-run-links">
        {summary.reportUrl && (
          <a className="report-link secondary" href={summary.reportUrl} target="_blank" rel="noreferrer">
            <FileText size={14} />
            图谱 HTML 报告
          </a>
        )}
        {summary.videos
          .filter((artifact) => !artifact.deletedAt)
          .slice(0, 1)
          .map((artifact) => (
            <a className="report-link secondary" href={artifact.url} target="_blank" rel="noreferrer" key={artifact.id}>
              <Video size={14} />
              执行视频
            </a>
          ))}
        {summary.failureEvidence.slice(0, 1).map((artifact) => (
          <a className="report-link secondary" href={artifact.url} target="_blank" rel="noreferrer" key={artifact.id}>
            <Image size={14} />
            失败证据
          </a>
        ))}
      </div>

      <div className="graph-run-step-list">
        {summary.steps.map((step) => (
          <GraphRunStepCard key={step.id} step={step} />
        ))}
        {!summary.steps.length && <div className="empty">执行中，暂无图谱步骤结果</div>}
      </div>

      {!!failedSteps.length && (
        <div className="graph-run-note">
          <GitBranch size={15} />
          <span>失败优先看图谱步骤中的前置识别、动作定位和后置预期；底层截图、视频、日志仍保留在执行报告中。</span>
        </div>
      )}
    </div>
  );
}

function GraphRunStepCard({ step }: { step: GraphRunStep }) {
  const visibleResults = step.expectationResults.filter(shouldDisplayExpectationResult);
  return (
    <article className={`graph-run-step ${step.status}`}>
      <div className="graph-run-step-order">{step.order}</div>
      <div className="graph-run-step-main">
        <div className="graph-run-step-head">
          <strong>{step.edgeKey || step.edgeId || step.type}</strong>
          <span className={`run-status-mini ${step.status}`}>{step.status}</span>
        </div>
        <span>
          {step.fromNodeName || step.fromNodeId || "-"} → {step.toNodeName || step.toNodeId || "-"}
        </span>
        <small>{step.phase || "graph"} · {step.type}</small>
        <GraphActionReadableSummary step={step} />
        <ActionPolicySummary value={step.actionPolicy} stepType={step.type} />
        {readCompoundStepRecords(step.compound).length > 0 && (
          <div className="graph-compound-step-list">
            {readCompoundStepRecords(step.compound).map((item) => (
              <small key={`${item.order}-${item.type}-${item.label}`} className={item.resolved === false ? "graph-compound-step failed" : "graph-compound-step"}>
                复合 {item.order} · {item.type} · {item.label || "-"} · {item.resolved === false ? "未完成" : "完成"}
                {item.message ? ` · ${item.message}` : ""}
              </small>
            ))}
          </div>
        )}
        {(typeof step.retry?.attempt === "number" || typeof step.recoveryAttempt === "number") && (
          <small className="graph-recovery-item">
            恢复路径 · 第 {step.retry?.attempt ?? step.recoveryAttempt} 次重规划
            {step.retry?.reason ? ` · ${step.retry.reason}` : ""}
            {step.retry?.reasonDeviationId || step.recoveryReasonDeviationId ? ` · 来源偏离 ${step.retry?.reasonDeviationId ?? step.recoveryReasonDeviationId}` : ""}
          </small>
        )}
        <div className="graph-run-match-grid">
          <NodeMatchPill label="Before" value={step.matches?.before ?? step.beforeMatch} />
          <NodeMatchPill label="After" value={step.matches?.after ?? step.afterMatch} />
        </div>
        {!!visibleResults.length && (
          <div className="expectation-result-chips">
            {visibleResults.map((result) => (
              <GraphExpectationChip key={result.id} result={result} overlay={isOverlayExpectation(step.runtimeOverlay, result.expectationId)} />
            ))}
          </div>
        )}
        {readDeviationRecords(step.deviations).length > 0 && (
          <div className="graph-deviation-list">
            {readDeviationRecords(step.deviations).map((deviation) => (
              <small key={deviation.id || `${deviation.phase}-${deviation.attempt}`} className="graph-deviation-item">
                偏离 {deviation.phase || "-"} · 第 {deviation.attempt || 1} 次 · {deviation.action || "-"}：{deviation.message || "-"}
              </small>
            ))}
          </div>
        )}
        {readInterceptorRecords(step.interceptors).length > 0 && (
          <div className="graph-interceptor-list">
            {readInterceptorRecords(step.interceptors).map((interceptor) => (
              <small key={interceptor.id || `${interceptor.phase}-${interceptor.ruleId}-${interceptor.matchedText}`} className="graph-interceptor-item">
                运行时清障 {interceptor.phase || "-"} · {interceptor.ruleName || interceptor.ruleId || "-"}：{interceptor.matchedText || "-"}
                {interceptor.action ? ` · ${interceptor.action}` : ""}
              </small>
            ))}
          </div>
        )}
        {(step.failureReason || step.errorMessage) && <small className="error-text">{step.failureReason || step.errorMessage}</small>}
      </div>
    </article>
  );
}

function GraphActionReadableSummary({ step }: { step: GraphRunStep }) {
  const action = step.action;
  if (!action?.label && !action?.type && !action?.elementLabel && typeof action?.candidateIndex !== "number") {
    return null;
  }
  const parts = [
    action.label || action.elementLabel,
    action.type,
    action.abilityType,
    typeof action.candidateIndex === "number" ? `候选 #${action.candidateIndex}` : undefined,
    action.targetLabel ? `目标 ${action.targetLabel}` : undefined
  ].filter(Boolean);
  return <small className="graph-action-readable">执行 {parts.join(" · ")}</small>;
}

function NodeMatchPill({ label, value }: { label: string; value: unknown }) {
  const match = readNodeMatch(value);
  const score = typeof match.score === "number" ? ` ${Math.round(match.score * 100)}%` : "";
  const topCandidate = match.candidates[0];
  return (
    <div className={`graph-match-pill ${match.status === "matched" ? "matched" : ""}`}>
      <strong>{label}</strong>
      <span>{match.status || "无"} {match.nodeName || match.nodeId || ""}{score}</span>
      {topCandidate && (
        <small className="graph-match-candidate">
          候选 {topCandidate.nodeName || topCandidate.nodeId || "-"}
          {typeof topCandidate.score === "number" ? ` · ${Math.round(topCandidate.score * 100)}%` : ""}
          {typeof topCandidate.matchedWeight === "number" && typeof topCandidate.totalWeight === "number"
            ? ` · 命中 ${topCandidate.matchedWeight} / ${topCandidate.totalWeight}`
            : ""}
        </small>
      )}
      {topCandidate?.quality && (
        <small className={`graph-match-quality ${topCandidate.quality.status === "sufficient" ? "sufficient" : "low"}`}>
          质量 {topCandidate.quality.status || "-"}
          {typeof topCandidate.quality.matchedStrongSignals === "number" ? ` · 强锚点 ${topCandidate.quality.matchedStrongSignals}` : ""}
          {typeof topCandidate.quality.matchedWeakSignals === "number" ? ` · 弱锚点 ${topCandidate.quality.matchedWeakSignals}` : ""}
          {typeof topCandidate.quality.matchedContextSignals === "number" ? ` · 上下文 ${topCandidate.quality.matchedContextSignals}` : ""}
          {topCandidate.quality.reasons.length ? ` · ${topCandidate.quality.reasons.join(", ")}` : ""}
          {topCandidate.quality.missingStrongMatcherIds.length ? ` · 缺失 ${topCandidate.quality.missingStrongMatcherIds.join(", ")}` : ""}
        </small>
      )}
      {!!topCandidate?.matcherResults.length && (
        <div className="graph-matcher-list">
          {topCandidate.matcherResults.slice(0, 4).map((result) => (
            <small key={result.matcherId || `${result.type}-${result.expected}`} className={`graph-matcher-item ${result.matched === false ? "missed" : "matched"}`}>
              {result.matched === false ? "未命中" : "命中"} {result.matcherId || "-"} · {result.type || "-"}
              {result.reason ? ` · ${result.reason}` : ""}
            </small>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionPolicySummary({ value, stepType }: { value: unknown; stepType: string }) {
  const policy = readActionPolicy(value);
  if (!policy.id && !policy.actionType && !policy.paramsText) {
    return null;
  }
  return (
    <div className="graph-action-policy">
      <strong>{policy.actionType || stepType}</strong>
      <small>
        {policy.id || "-"}
        {typeof policy.priority === "number" ? ` · P${policy.priority}` : ""}
        {typeof policy.fallback === "boolean" ? ` · fallback=${policy.fallback}` : ""}
        {policy.reliabilityHint ? ` · ${policy.reliabilityHint}` : ""}
      </small>
      {policy.paramsText && <code>params={policy.paramsText}</code>}
      {policy.coordinateText && <code>coordinate={policy.coordinateText}</code>}
      {policy.timingText && <code>timing={policy.timingText}</code>}
    </div>
  );
}

function GraphExpectationChip({ result, overlay }: { result: StepExpectationResult; overlay: boolean }) {
  const passed = result.status === "passed";
  const Icon = passed ? CheckCircle2 : XCircle;
  const source = overlay ? "动态预期" : result.type === "no_crash" || result.type === "app_alive" ? "系统护栏" : "图谱默认";
  return (
    <span
      className={`expectation-result-chip ${result.status} ${result.blocking === false ? "advisory" : "blocking"}`}
      title={`${result.expected}\n${result.actual}${result.reason ? `\n${result.reason}` : ""}`}
    >
      <Icon size={12} />
      {expectationLabel(result.type)}: {result.status} · {source}
    </span>
  );
}

function routeNodeNames(route: GraphRouteItem[]): string[] {
  const names: string[] = [];
  for (const edge of route) {
    const from = edge.fromNodeName || edge.fromNodeId;
    const to = edge.toNodeName || edge.toNodeId;
    if (from && names.length === 0) {
      names.push(from);
    }
    if (to && names.at(-1) !== to) {
      names.push(to);
    }
  }
  return names;
}

type NodeMatchView = {
  status?: string;
  nodeId?: string;
  nodeName?: string;
  score?: number;
  candidates: Array<{
    nodeId?: string;
    nodeName?: string;
    score?: number;
    matchedWeight?: number;
    totalWeight?: number;
    quality?: {
      status?: string;
      reasons: string[];
      matchedContextSignals?: number;
      matchedStrongSignals?: number;
      matchedWeakSignals?: number;
      missingStrongMatcherIds: string[];
    };
    matcherResults: Array<{
      matcherId?: string;
      type?: string;
      expected?: string;
      actual?: string;
      weight?: number;
      matched?: boolean;
      score?: number;
      reason?: string;
    }>;
  }>;
};

function readNodeMatch(value: unknown): NodeMatchView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { candidates: [] };
  }
  const input = value as { status?: unknown; nodeId?: unknown; nodeName?: unknown; score?: unknown; candidates?: unknown };
  return {
    status: typeof input.status === "string" ? input.status : undefined,
    nodeId: typeof input.nodeId === "string" ? input.nodeId : undefined,
    nodeName: typeof input.nodeName === "string" ? input.nodeName : undefined,
    score: typeof input.score === "number" ? input.score : undefined,
    candidates: readNodeMatchCandidates(input.candidates)
  };
}

function readNodeMatchCandidates(value: unknown): NodeMatchView["candidates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      nodeId: typeof item.nodeId === "string" ? item.nodeId : undefined,
      nodeName: typeof item.nodeName === "string" ? item.nodeName : undefined,
      score: typeof item.score === "number" ? item.score : undefined,
      matchedWeight: typeof item.matchedWeight === "number" ? item.matchedWeight : undefined,
      totalWeight: typeof item.totalWeight === "number" ? item.totalWeight : undefined,
      quality: readMatchQuality(item.quality),
      matcherResults: readMatcherResults(item.matcherResults)
    }));
}

function readMatchQuality(value: unknown): NodeMatchView["candidates"][number]["quality"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  return {
    status: typeof input.status === "string" ? input.status : undefined,
    reasons: Array.isArray(input.reasons) ? input.reasons.filter((item): item is string => typeof item === "string") : [],
    matchedContextSignals: typeof input.matchedContextSignals === "number" ? input.matchedContextSignals : undefined,
    matchedStrongSignals: typeof input.matchedStrongSignals === "number" ? input.matchedStrongSignals : undefined,
    matchedWeakSignals: typeof input.matchedWeakSignals === "number" ? input.matchedWeakSignals : undefined,
    missingStrongMatcherIds: Array.isArray(input.missingStrongMatcherIds) ? input.missingStrongMatcherIds.filter((item): item is string => typeof item === "string") : []
  };
}

function readMatcherResults(value: unknown): NodeMatchView["candidates"][number]["matcherResults"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      matcherId: typeof item.matcherId === "string" ? item.matcherId : undefined,
      type: typeof item.type === "string" ? item.type : undefined,
      expected: typeof item.expected === "string" ? item.expected : undefined,
      actual: typeof item.actual === "string" ? item.actual : undefined,
      weight: typeof item.weight === "number" ? item.weight : undefined,
      matched: typeof item.matched === "boolean" ? item.matched : undefined,
      score: typeof item.score === "number" ? item.score : undefined,
      reason: typeof item.reason === "string" ? item.reason : undefined
    }));
}

function readActionPolicy(value: unknown): {
  id?: string;
  priority?: number;
  fallback?: boolean;
  reliabilityHint?: string;
  actionType?: string;
  paramsText?: string;
  coordinateText?: string;
  timingText?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const action = typeof input.action === "object" && input.action !== null && !Array.isArray(input.action) ? (input.action as Record<string, unknown>) : {};
  return {
    id: typeof input.id === "string" ? input.id : undefined,
    priority: typeof input.priority === "number" ? input.priority : undefined,
    fallback: typeof input.fallback === "boolean" ? input.fallback : undefined,
    reliabilityHint: typeof input.reliabilityHint === "string" ? input.reliabilityHint : undefined,
    actionType: typeof action.type === "string" ? action.type : undefined,
    paramsText: formatUnknown(action.params),
    coordinateText: formatUnknown(action.coordinate),
    timingText: formatUnknown(action.timing)
  };
}

function formatUnknown(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
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

function isOverlayExpectation(runtimeOverlay: unknown, expectationId: string): boolean {
  if (!runtimeOverlay || typeof runtimeOverlay !== "object" || Array.isArray(runtimeOverlay)) {
    return false;
  }
  const overlay = runtimeOverlay as { targetExpectationIds?: unknown; edgeExpectationIds?: unknown };
  return [...readStringArray(overlay.targetExpectationIds), ...readStringArray(overlay.edgeExpectationIds)].includes(expectationId);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readDeviationRecords(value: unknown): Array<{ id?: string; phase?: string; attempt?: number; action?: string; message?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : undefined,
      phase: typeof item.phase === "string" ? item.phase : undefined,
      attempt: typeof item.attempt === "number" ? item.attempt : undefined,
      action: typeof item.action === "string" ? item.action : undefined,
      message: typeof item.message === "string" ? item.message : undefined
    }));
}

function readInterceptorRecords(value: unknown): Array<{ id?: string; phase?: string; ruleId?: string; ruleName?: string; matchedText?: string; action?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => {
      const action = typeof item.action === "object" && item.action !== null && !Array.isArray(item.action) ? (item.action as Record<string, unknown>) : undefined;
      const actionText = action
        ? `${typeof action.type === "string" ? action.type : "-"}(${typeof action.x === "number" ? action.x : "-"}, ${typeof action.y === "number" ? action.y : "-"})`
        : undefined;
      return {
        id: typeof item.id === "string" ? item.id : undefined,
        phase: typeof item.phase === "string" ? item.phase : undefined,
        ruleId: typeof item.ruleId === "string" ? item.ruleId : undefined,
        ruleName: typeof item.ruleName === "string" ? item.ruleName : undefined,
        matchedText: typeof item.matchedText === "string" ? item.matchedText : undefined,
        action: actionText
      };
    });
}

function readCompoundStepRecords(value: unknown): Array<{ order?: number; type?: string; label?: string; resolved?: boolean; message?: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const input = value as Record<string, unknown>;
  const steps = input.steps;
  if (!Array.isArray(steps)) {
    return [];
  }
  return steps
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
    .map((item) => ({
      order: typeof item.order === "number" ? item.order : undefined,
      type: typeof item.type === "string" ? item.type : undefined,
      label: typeof item.label === "string" ? item.label : undefined,
      resolved: typeof item.resolved === "boolean" ? item.resolved : undefined,
      message: typeof item.message === "string" ? item.message : undefined
    }));
}
