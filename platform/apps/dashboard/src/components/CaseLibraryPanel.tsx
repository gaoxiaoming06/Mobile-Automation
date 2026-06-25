import { useState } from "react";
import { Edit3, Eye, Play, Save, Search, Trash2 } from "lucide-react";
import type { StepExpectation, StructuredFlow, StructuredFlowStep, TestRun } from "@mobile-automation/shared";
import { expectationLabel } from "./StepExpectationPanel";
import { formatShortTime } from "./StepsPanelParts";

export type FlowExpectationOverride = {
  stepId: string;
  expectationId: string;
  scope?: "beforeState" | "afterExpectations" | "systemGuards";
  enabled?: boolean;
  title?: string;
  note?: string;
  params?: Record<string, unknown>;
};

type CaseLibraryPanelProps = {
  flows: StructuredFlow[];
  runs?: TestRun[];
  searchText: string;
  selectedFlowId: string;
  highlightedFlowId?: string;
  selectedSerial: string;
  selectedDeviceBusy: boolean;
  onSearchTextChange: (value: string) => void;
  onSelectFlow?: (flowId: string) => void;
  onEditFlow: (flowId: string) => Promise<void>;
  onStartFlowRun: (flowId: string, stopAtStepId?: string, expectationOverrides?: FlowExpectationOverride[]) => Promise<void>;
  onUpdateFlow?: (flow: StructuredFlow) => Promise<void>;
  onDeleteFlow: (flowId: string) => Promise<void>;
};

export function CaseLibraryPanel({
  flows,
  runs = [],
  searchText,
  selectedFlowId,
  highlightedFlowId,
  selectedSerial,
  selectedDeviceBusy,
  onSearchTextChange,
  onSelectFlow,
  onEditFlow,
  onStartFlowRun,
  onUpdateFlow,
  onDeleteFlow
}: CaseLibraryPanelProps) {
  const [stopStepByFlowId, setStopStepByFlowId] = useState<Record<string, string>>({});
  const [expectationDraftByKey, setExpectationDraftByKey] = useState<Record<string, string>>({});
  const [savingExpectationKey, setSavingExpectationKey] = useState("");
  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredFlows = normalizedSearch
    ? flows.filter((item) => flowSearchText(item).toLowerCase().includes(normalizedSearch))
    : flows;
  const selectedFlow = filteredFlows.find((flow) => flow.id === selectedFlowId) ?? filteredFlows[0];
  const selectedRecentRun = selectedFlow ? findRecentRunForFlow(selectedFlow.name, runs) : undefined;
  return (
    <section className="module-page case-library-module">
      <div className="panel case-library-page">
        <div className="module-list-head">
          <div>
            <span className="module-eyebrow">结构化用例库</span>
            <h2>已保存用例</h2>
            <p>按 App、版本、起点和终点管理可复用流程。</p>
          </div>
          <strong>{filteredFlows.length}</strong>
        </div>

        <label className="case-search">
          <Search size={16} />
          <input value={searchText} onChange={(event) => onSearchTextChange(event.target.value)} placeholder="搜索 App、版本、起点、终点或标签" />
        </label>

        <div className="case-library-layout">
          <div className="case-table">
            {filteredFlows.map((item) => (
              (() => {
                const recentRun = findRecentRunForFlow(item.name, runs);
                return (
              <article
                className={[
                  "case-row",
                  item.id === selectedFlowId ? "active" : "",
                  item.id === highlightedFlowId ? "recently-saved" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
              >
                <div className="case-row-main">
                  <strong>{item.name}</strong>
                  <span>
                    {item.steps.length} 步 · {item.startState.name} → {item.endState.name} · 更新于 {formatShortTime(item.updatedAt)}
                  </span>
                </div>
                <div className="case-row-meta">
                  <span>{item.appName}</span>
                  <span>{item.appVersion.displayVersion}</span>
                  <span>{item.platform}</span>
                  <span>{item.status}</span>
                  <span>{recentRun ? `最近结果：${recentRun.status}` : "最近结果：暂无"}</span>
                </div>
                <label className="case-row-run-target">
                  <span>执行范围</span>
                  <select
                    aria-label={`${item.name} 执行范围`}
                    value={stopStepByFlowId[item.id] ?? ""}
                    onChange={(event) =>
                      setStopStepByFlowId((current) => ({
                        ...current,
                        [item.id]: event.target.value
                      }))
                    }
                  >
                    <option value="">完整执行</option>
                    {item.steps.map((step) => (
                      <option key={step.id} value={step.id}>
                        执行到：{step.title || `步骤 ${step.order}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="case-row-actions">
                  <button className="icon-button" onClick={() => onSelectFlow?.(item.id)} type="button" title="查看用例详情">
                    <Eye size={16} />
                    详情
                  </button>
                  <button className="icon-button" onClick={() => void onEditFlow(item.id)} type="button" title="编辑结构化用例">
                    <Edit3 size={16} />
                    编辑
                  </button>
                  <button
                    className="icon-button primary"
                    onClick={() => void onStartFlowRun(item.id, stopStepByFlowId[item.id] || undefined)}
                    type="button"
                    disabled={!selectedSerial || selectedDeviceBusy}
                    title={selectedDeviceBusy ? "当前设备正在执行任务" : stopStepByFlowId[item.id] ? "执行到选中的结构化步骤" : "执行完整结构化用例"}
                  >
                    <Play size={16} />
                    执行
                  </button>
                  <button className="icon-button danger" onClick={() => void onDeleteFlow(item.id)} type="button" title="删除用例">
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              </article>
                );
              })()
            ))}
            {!filteredFlows.length && <div className="empty case-library-empty">暂无结构化用例</div>}
          </div>

          <FlowDetailPanel
            expectationDraftByKey={expectationDraftByKey}
            flow={selectedFlow}
            onDraftExpectationChange={(key, value) =>
              setExpectationDraftByKey((current) => ({
                ...current,
                [key]: value
              }))
            }
            onSaveTextExpectation={async (flow, step, scope, expectation, expected) => {
              if (!onUpdateFlow) {
                return;
              }
              const key = expectationKey(step.id, scope, expectation.id);
              setSavingExpectationKey(key);
              try {
                await onUpdateFlow(updateFlowTextExpectation(flow, step.id, scope, expectation.id, expected));
              } finally {
                setSavingExpectationKey("");
              }
            }}
            onStartTemporaryRun={async (flow, step, scope, expectation, expected) => {
              await onStartFlowRun(flow.id, step.id, [
                {
                  stepId: step.id,
                  expectationId: expectation.id,
                  scope,
                  params: {
                    expected
                  }
                }
              ]);
            }}
            recentRun={selectedRecentRun}
            savingExpectationKey={savingExpectationKey}
          />
        </div>
      </div>
    </section>
  );
}

function FlowDetailPanel({
  expectationDraftByKey,
  flow,
  onDraftExpectationChange,
  onSaveTextExpectation,
  onStartTemporaryRun,
  recentRun,
  savingExpectationKey
}: {
  expectationDraftByKey: Record<string, string>;
  flow: StructuredFlow | undefined;
  onDraftExpectationChange: (key: string, value: string) => void;
  onSaveTextExpectation: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  onStartTemporaryRun: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  recentRun: TestRun | undefined;
  savingExpectationKey: string;
}) {
  if (!flow) {
    return (
      <aside className="case-detail-panel empty">
        <strong>用例详情</strong>
        <span>选择一条用例查看结构化步骤。</span>
      </aside>
    );
  }
  return (
    <aside className="case-detail-panel">
      <div className="case-detail-head">
        <div>
          <span className="module-eyebrow">用例详情</span>
          <h3>{flow.name}</h3>
          <p>
            {flow.appName} · {flow.platform} · {flow.appVersion.displayVersion}
          </p>
        </div>
        <span className={`case-status-pill status-${flow.status}`}>{flow.status}</span>
      </div>
      <div className="case-detail-meta">
        <span>包名：{targetAppIdentifier(flow)}</span>
        <span>Build：{flow.appVersion.buildNumber ?? flow.appVersion.versionCode ?? "未知"}</span>
        <span>启动策略：{flow.startStrategy}</span>
        <span>起点：{flow.startState.name}</span>
        <span>终点：{flow.endState.name}</span>
        <span>最近结果：{recentRun?.status ?? "暂无"}</span>
      </div>
      <div className="case-detail-steps">
        <div className="case-detail-section-title">步骤详情</div>
        {flow.steps.map((step) => (
          <FlowStepDetail
            expectationDraftByKey={expectationDraftByKey}
            flow={flow}
            key={step.id}
            onDraftExpectationChange={onDraftExpectationChange}
            onSaveTextExpectation={onSaveTextExpectation}
            onStartTemporaryRun={onStartTemporaryRun}
            recentRun={recentRun}
            savingExpectationKey={savingExpectationKey}
            step={step}
          />
        ))}
      </div>
    </aside>
  );
}

function FlowStepDetail({
  expectationDraftByKey,
  flow,
  onDraftExpectationChange,
  onSaveTextExpectation,
  onStartTemporaryRun,
  step,
  recentRun,
  savingExpectationKey
}: {
  expectationDraftByKey: Record<string, string>;
  flow: StructuredFlow;
  onDraftExpectationChange: (key: string, value: string) => void;
  onSaveTextExpectation: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  onStartTemporaryRun: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  step: StructuredFlowStep;
  recentRun: TestRun | undefined;
  savingExpectationKey: string;
}) {
  const result = recentRun?.stepResults.find((item) => item.stepId === step.action.id || item.stepId === step.id);
  const beforeTextExpectations = (step.beforeState.expectations ?? []).filter((expectation) => expectation.type === "text");
  const afterTextExpectations = step.afterExpectations.filter((expectation) => expectation.type === "text");
  return (
    <article className="case-step-detail">
      <div className="case-step-detail-head">
        <strong>
          {step.order}. {step.title}
        </strong>
        <span>{result ? `最近结果：${result.status}` : "最近结果：暂无"}</span>
      </div>
      <dl>
        <div>
          <dt>前置状态</dt>
          <dd>{stateSummary(step)}</dd>
        </div>
        <div>
          <dt>执行动作</dt>
          <dd>{actionSummary(step)}</dd>
        </div>
        <div>
          <dt>后置预期</dt>
          <dd>{expectationList(step.afterExpectations)}</dd>
        </div>
        <div>
          <dt>系统守护</dt>
          <dd>{expectationList(step.systemGuards)}</dd>
        </div>
      </dl>
      <TextExpectationEditorSection
        emptyText="暂无可编辑前置文字条件"
        expectationDraftByKey={expectationDraftByKey}
        expectations={beforeTextExpectations}
        flow={flow}
        inputLabel={`${step.title} 前置文字条件`}
        onDraftExpectationChange={onDraftExpectationChange}
        onSaveTextExpectation={onSaveTextExpectation}
        onStartTemporaryRun={onStartTemporaryRun}
        placeholder="输入动作执行前应看到的文字"
        savingExpectationKey={savingExpectationKey}
        scope="beforeState"
        step={step}
        title="编辑前置条件"
      />
      <TextExpectationEditorSection
        emptyText="暂无可编辑后置文字预期"
        expectationDraftByKey={expectationDraftByKey}
        expectations={afterTextExpectations}
        flow={flow}
        inputLabel={`${step.title} 文字预期`}
        onDraftExpectationChange={onDraftExpectationChange}
        onSaveTextExpectation={onSaveTextExpectation}
        onStartTemporaryRun={onStartTemporaryRun}
        placeholder="输入动作完成后应出现的文字"
        savingExpectationKey={savingExpectationKey}
        scope="afterExpectations"
        step={step}
        title="编辑后置预期"
      />
    </article>
  );
}

function TextExpectationEditorSection({
  emptyText,
  expectationDraftByKey,
  expectations,
  flow,
  inputLabel,
  onDraftExpectationChange,
  onSaveTextExpectation,
  onStartTemporaryRun,
  placeholder,
  savingExpectationKey,
  scope,
  step,
  title
}: {
  emptyText: string;
  expectationDraftByKey: Record<string, string>;
  expectations: StepExpectation[];
  flow: StructuredFlow;
  inputLabel: string;
  onDraftExpectationChange: (key: string, value: string) => void;
  onSaveTextExpectation: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  onStartTemporaryRun: (flow: StructuredFlow, step: StructuredFlowStep, scope: FlowExpectationOverride["scope"], expectation: StepExpectation, expected: string) => Promise<void>;
  placeholder: string;
  savingExpectationKey: string;
  scope: FlowExpectationOverride["scope"];
  step: StructuredFlowStep;
  title: string;
}) {
  return (
    <div className="case-expectation-editor">
      <strong>{title}</strong>
      {expectations.map((expectation) => {
        const key = expectationKey(step.id, scope, expectation.id);
        const expected = expectationDraftByKey[key] ?? stringParam(expectation.params.expected);
        return (
          <label key={expectation.id} className="case-expectation-input">
            <span>{expectation.title || expectationLabel(expectation.type)}</span>
            <input
              aria-label={inputLabel}
              value={expected}
              onChange={(event) => onDraftExpectationChange(key, event.target.value)}
              placeholder={placeholder}
            />
            <button
              className="icon-button"
              disabled={savingExpectationKey === key}
              onClick={() => void onSaveTextExpectation(flow, step, scope, expectation, expected)}
              type="button"
              title="保存该步骤的文字条件"
            >
              <Save size={14} />
              保存预期
            </button>
            <button
              className="icon-button"
              onClick={() => void onStartTemporaryRun(flow, step, scope, expectation, expected)}
              type="button"
              title="仅本次运行，不保存到用例"
            >
              <Play size={14} />
              临时运行
            </button>
          </label>
        );
      })}
      {!expectations.length && <span>{emptyText}</span>}
    </div>
  );
}

function updateFlowTextExpectation(
  flow: StructuredFlow,
  stepId: string,
  scope: FlowExpectationOverride["scope"],
  expectationId: string,
  expected: string
): StructuredFlow {
  return {
    ...flow,
    steps: flow.steps.map((step) =>
      step.id === stepId
        ? updateStepTextExpectation(step, scope, expectationId, expected)
        : step
    )
  };
}

function updateStepTextExpectation(
  step: StructuredFlowStep,
  scope: FlowExpectationOverride["scope"],
  expectationId: string,
  expected: string
): StructuredFlowStep {
  const nextSource = {
    ...step.source,
    lastExpectationEditAt: new Date().toISOString()
  };
  if (scope === "beforeState") {
    return {
      ...step,
      beforeState: {
        ...step.beforeState,
        expectations: updateTextExpectationList(step.beforeState.expectations ?? [], expectationId, expected)
      },
      source: nextSource
    };
  }
  return {
    ...step,
    afterExpectations: updateTextExpectationList(step.afterExpectations, expectationId, expected),
    source: nextSource
  };
}

function updateTextExpectationList(expectations: StepExpectation[], expectationId: string, expected: string): StepExpectation[] {
  return expectations.map((expectation) =>
    expectation.id === expectationId
      ? {
          ...expectation,
          params: {
            ...expectation.params,
            expected,
            source: "manual_edit"
          }
        }
      : expectation
  );
}

function expectationKey(stepId: string, scope: FlowExpectationOverride["scope"], expectationId: string): string {
  return `${stepId}:${scope ?? "afterExpectations"}:${expectationId}`;
}

function flowSearchText(flow: StructuredFlow): string {
  return [
    flow.name,
    flow.appName,
    flow.platform,
    flow.appVersion.displayVersion,
    flow.appVersion.buildNumber,
    flow.targetApp.androidPackageName,
    flow.targetApp.iosBundleId,
    flow.startState.name,
    flow.endState.name,
    flow.status,
    ...flow.tags
  ]
    .filter(Boolean)
    .join(" ");
}

function findRecentRunForFlow(flowName: string, runs: TestRun[]): TestRun | undefined {
  return runs.find((run) => run.caseName === flowName);
}

function stateSummary(step: StructuredFlowStep): string {
  const matcherText = step.beforeState.matchers.map((matcher) => matcher.value).filter(Boolean).join(" / ");
  return matcherText ? `${step.beforeState.name}：${matcherText}` : step.beforeState.name;
}

function actionSummary(step: StructuredFlowStep): string {
  const locator = objectParam(step.action.params.locator);
  const resourceId = stringValue(step.action.params.resourceId ?? locator?.resourceId);
  const contentDesc = stringValue(step.action.params.contentDesc ?? locator?.contentDesc);
  const text = stringValue(step.action.params.text ?? locator?.text);
  const selector = stringValue(step.action.params.selector);
  const locatorDetails = [
    selector ? `selector=${selector}` : undefined,
    resourceId ? `resourceId=${resourceId}` : undefined,
    contentDesc ? `contentDesc=${contentDesc}` : undefined,
    text ? `text=${text}` : undefined
  ].filter(Boolean);

  if (step.action.type === "input_text_to_element") {
    return ["输入到元素", ...locatorDetails, text ? `输入=${text}` : undefined].filter(Boolean).join(" · ");
  }
  if (step.action.type === "scroll_until_visible") {
    return [
      "滚动直到可见",
      ...locatorDetails,
      `direction=${step.action.params.direction ?? "down"}`,
      `maxSwipes=${step.action.params.maxSwipes ?? 5}`
    ].join(" · ");
  }
  if (step.action.type === "wait_until_state") {
    return ["等待状态", ...locatorDetails, `timeoutMs=${step.action.params.timeoutMs ?? step.timing?.transitionTimeoutMs ?? 3000}`].join(" · ");
  }
  return [step.action.type, selector ?? resourceId ?? contentDesc ?? text].filter(Boolean).join(" · ");
}

function expectationList(expectations: StepExpectation[]): string {
  if (!expectations.length) {
    return "未配置";
  }
  return expectations.map(expectationSummary).join("；");
}

function expectationSummary(expectation: StepExpectation): string {
  const expected = typeof expectation.params.expected === "string" ? expectation.params.expected : undefined;
  if (expectation.type === "text" && expected) {
    return `看到 ${expected}`;
  }
  return expectationLabel(expectation.type);
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectParam(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function targetAppIdentifier(flow: StructuredFlow): string {
  return flow.platform === "ios" ? flow.targetApp.iosBundleId ?? "未配置" : flow.targetApp.androidPackageName ?? "未配置";
}
