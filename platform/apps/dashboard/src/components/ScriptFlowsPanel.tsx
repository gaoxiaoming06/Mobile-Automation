import { CheckCircle2, FilePlus2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AndroidAppMonitorConfig, ScriptFlow, TestRun } from "@mobile-automation/shared";
import { ApiError, apiFetchJson } from "../api.js";
import {
  ScriptRunForm,
  type ScriptParameterDefinitionView,
  type ScriptParameterValue
} from "./ScriptRunForm.js";

type ScriptDocumentView = {
  version: 1;
  name: string;
  description?: string;
  app: { id: string; platform: string };
  parameters: Record<string, ScriptParameterDefinitionView>;
  steps: Array<Record<string, unknown> & { id: string; name?: string; onPage?: string; expectPage?: string }>;
  tags: string[];
};

type ScriptPlanView = {
  steps: Array<{
    id: string;
    order: number;
    name?: string;
    action: string;
    onPage?: string;
    expectPage?: string;
    risk: string;
  }>;
  requiredRiskConfirmations: string[];
};

type ScriptFlowsPanelProps = {
  devices: Array<{ serial: string; name?: string }>;
  selectedSerial: string;
  initialFlows?: ScriptFlow[];
  initialSourceYaml?: string;
  onInitialSourceConsumed?: () => void;
  setMessage: (message: string) => void;
  onOpenRun: (runId: string) => void;
  androidAppMonitorForApp?: (appId: string) => AndroidAppMonitorConfig | undefined;
};

export function ScriptFlowsPanel({ devices, selectedSerial, initialFlows, initialSourceYaml, onInitialSourceConsumed, setMessage, onOpenRun, androidAppMonitorForApp }: ScriptFlowsPanelProps) {
  const [flows, setFlows] = useState<ScriptFlow[]>(initialFlows ?? []);
  const [selectedId, setSelectedId] = useState(initialFlows?.[0]?.id ?? "");
  const selected = flows.find((flow) => flow.id === selectedId);
  const [sourceYaml, setSourceYaml] = useState(initialSourceYaml ?? selected?.sourceYaml ?? newScriptTemplate());
  const [status, setStatus] = useState<ScriptFlow["status"]>(selected?.status ?? "draft");
  const [document, setDocument] = useState<ScriptDocumentView | undefined>(() => readDocument(selected?.parsed));
  const [issues, setIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [plan, setPlan] = useState<ScriptPlanView>();
  const [parameterValues, setParameterValues] = useState<Record<string, ScriptParameterValue>>(() => defaultParameterValues(document));
  const [deviceSerial, setDeviceSerial] = useState(selectedSerial);
  const [confirmedRisks, setConfirmedRisks] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<TestRun>();
  const [busy, setBusy] = useState(false);
  const lineNumbers = useMemo(() => sourceYaml.split(/\r?\n/).map((_, index) => index + 1).join("\n"), [sourceYaml]);

  useEffect(() => {
    if (initialFlows) return;
    void refreshFlows();
  }, []);

  useEffect(() => {
    if (initialSourceYaml) onInitialSourceConsumed?.();
  }, []);

  useEffect(() => {
    if (selectedSerial) setDeviceSerial(selectedSerial);
  }, [selectedSerial]);

  useEffect(() => {
    if (!lastRun || !["pending", "running", "paused"].includes(lastRun.status)) return;
    const timer = window.setInterval(() => {
      void apiFetchJson<{ run: TestRun }>(`/api/script-flow-runs/${encodeURIComponent(lastRun.id)}`)
        .then(({ run }) => setLastRun(run))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastRun?.id, lastRun?.status]);

  async function refreshFlows() {
    try {
      const response = await apiFetchJson<{ flows: ScriptFlow[] }>("/api/script-flows");
      setFlows(response.flows);
      if (!selectedId && response.flows[0]) selectFlow(response.flows[0]);
      setMessage(`已加载 ${response.flows.length} 个脚本用例`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function selectFlow(flow: ScriptFlow) {
    const parsed = readDocument(flow.parsed);
    setSelectedId(flow.id);
    setSourceYaml(flow.sourceYaml);
    setStatus(flow.status);
    setDocument(parsed);
    setParameterValues(defaultParameterValues(parsed));
    setIssues([]);
    setPlan(undefined);
    setConfirmedRisks([]);
    setLastRun(undefined);
  }

  function createNew() {
    setSelectedId("");
    setSourceYaml(newScriptTemplate());
    setStatus("draft");
    setDocument(undefined);
    setParameterValues({});
    setIssues([]);
    setPlan(undefined);
    setConfirmedRisks([]);
    setLastRun(undefined);
  }

  async function validate(): Promise<ScriptDocumentView | undefined> {
    try {
      setBusy(true);
      const response = await apiFetchJson<{ valid: true; document: ScriptDocumentView }>("/api/script-flows/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceYaml })
      });
      setDocument(response.document);
      setParameterValues((current) => ({ ...defaultParameterValues(response.document), ...current }));
      setIssues([]);
      setMessage("ScriptFlow 校验通过");
      return response.document;
    } catch (error) {
      const parsedIssues = validationIssues(error);
      setIssues(parsedIssues);
      setMessage(errorMessage(error));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const validated = await validate();
    if (!validated) return;
    try {
      setBusy(true);
      const response = await apiFetchJson<{ flow: ScriptFlow }>(selectedId ? `/api/script-flows/${encodeURIComponent(selectedId)}` : "/api/script-flows", {
        method: selectedId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceYaml, status })
      });
      setFlows((current) => [response.flow, ...current.filter((flow) => flow.id !== response.flow.id)]);
      selectFlow(response.flow);
      setMessage(`已保存 ${response.flow.name} · v${response.flow.version}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedId) return;
    try {
      setBusy(true);
      await apiFetchJson<{ deleted: true }>(`/api/script-flows/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
      const remaining = flows.filter((flow) => flow.id !== selectedId);
      setFlows(remaining);
      if (remaining[0]) selectFlow(remaining[0]); else createNew();
      setMessage("已删除脚本用例");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!selectedId) {
      setMessage("请先保存脚本用例");
      return;
    }
    try {
      setBusy(true);
      const response = await apiFetchJson<{ plan: ScriptPlanView }>(`/api/script-flows/${encodeURIComponent(selectedId)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parameters: parameterValues })
      });
      setPlan(response.plan);
      setConfirmedRisks([]);
      setMessage(`已生成 ${response.plan.steps.length} 个脚本步骤`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!selectedId) return;
    try {
      setBusy(true);
      const androidAppMonitor = document?.app.id ? androidAppMonitorForApp?.(document.app.id) : undefined;
      const response = await apiFetchJson<{ run: TestRun }>(`/api/script-flows/${encodeURIComponent(selectedId)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceSerial,
          parameters: parameterValues,
          confirmedRisks,
          ...(androidAppMonitor ? { androidAppMonitor } : {})
        })
      });
      setLastRun(response.run);
      setMessage(`已启动脚本：${response.run.id}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page script-flows-module">
      <header className="script-flows-header">
        <div><h2>脚本用例</h2><p>{flows.length} 个用例</p></div>
        <div className="script-flows-toolbar">
          <button className="icon-button" type="button" title="刷新脚本用例" onClick={() => void refreshFlows()} disabled={busy}><RefreshCw size={16} /></button>
          <button type="button" onClick={createNew}><FilePlus2 size={16} /><span>新建</span></button>
          <select aria-label="脚本状态" value={status} onChange={(event) => setStatus(event.target.value as ScriptFlow["status"])}>
            <option value="draft">草稿</option><option value="active">启用</option><option value="archived">归档</option>
          </select>
          <button type="button" onClick={() => void validate()} disabled={busy}><CheckCircle2 size={16} /><span>校验</span></button>
          <button className="primary-button" type="button" onClick={() => void save()} disabled={busy}><Save size={16} /><span>保存</span></button>
          <button className="icon-button danger" type="button" title="删除脚本用例" onClick={() => void removeSelected()} disabled={busy || !selectedId}><Trash2 size={16} /></button>
        </div>
      </header>
      <div className="script-flows-workbench">
        <aside className="script-flow-list" aria-label="脚本列表">
          {flows.map((flow) => (
            <button key={flow.id} type="button" className={flow.id === selectedId ? "selected" : ""} onClick={() => selectFlow(flow)}>
              <strong>{flow.name}</strong><span>{flow.appId}</span><small>{flow.status} · v{flow.version}</small>
            </button>
          ))}
          {!flows.length ? <p className="empty">暂无脚本用例</p> : null}
        </aside>
        <section className="script-flow-editor-pane">
          <header><h3>ScriptFlow YAML</h3><button type="button" onClick={() => void preview()} disabled={busy || !selectedId}>预览计划</button></header>
          <div className="script-yaml-editor">
            <pre aria-hidden="true">{lineNumbers}</pre>
            <textarea
              aria-label="ScriptFlow YAML"
              spellCheck={false}
              value={sourceYaml}
              onChange={(event) => {
                setSourceYaml(event.target.value);
                setIssues([]);
                setPlan(undefined);
              }}
            />
          </div>
          {issues.length ? <div className="script-validation-errors">{issues.map((issue) => <p key={`${issue.path}:${issue.message}`}><code>{issue.path}</code> {issue.message}</p>)}</div> : null}
        </section>
        <aside className="script-flow-inspector">
          <ScriptStepPreview document={document} plan={plan} />
          <ScriptRunForm
            parameters={document?.parameters ?? {}}
            values={parameterValues}
            devices={devices}
            deviceSerial={deviceSerial}
            requiredRisks={plan?.requiredRiskConfirmations ?? []}
            confirmedRisks={confirmedRisks}
            busy={busy}
            disabled={!selectedId}
            onValueChange={(key, value) => setParameterValues((current) => ({ ...current, [key]: value }))}
            onDeviceChange={setDeviceSerial}
            onRiskChange={(risk, checked) => setConfirmedRisks((current) => checked ? [...new Set([...current, risk])] : current.filter((item) => item !== risk))}
            onRun={() => void run()}
          />
          {lastRun ? (
            <section className="script-run-status">
              <header><h3>执行状态</h3><strong data-status={lastRun.status}>{lastRun.status}</strong></header>
              <p>{lastRun.stepResults.length}/{lastRun.steps.length} 个步骤</p>
              <button type="button" onClick={() => onOpenRun(lastRun.id)}>查看执行结果</button>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function ScriptStepPreview({ document, plan }: { document?: ScriptDocumentView; plan?: ScriptPlanView }) {
  const steps = plan?.steps ?? document?.steps.map((step, index) => ({
    id: step.id,
    order: index + 1,
    name: step.name,
    action: sourceAction(step),
    onPage: step.onPage,
    expectPage: step.expectPage,
    risk: "none"
  })) ?? [];
  return (
    <section className="script-step-preview">
      <header><h3>步骤预览</h3><span>{steps.length}</span></header>
      <ol>
        {steps.map((step) => (
          <li key={step.id}>
            <span>{step.order}</span>
            <div><strong>{step.name ?? actionLabel(step.action)}</strong><small>{[step.onPage, step.expectPage].filter(Boolean).join(" → ") || step.id}</small></div>
            {step.risk !== "none" ? <em>{step.risk}</em> : null}
          </li>
        ))}
      </ol>
      {!steps.length ? <p className="empty">校验后显示步骤</p> : null}
    </section>
  );
}

function readDocument(value: Record<string, unknown> | undefined): ScriptDocumentView | undefined {
  if (!value || !value.app || typeof value.app !== "object" || !Array.isArray(value.steps)) return undefined;
  return value as unknown as ScriptDocumentView;
}

function defaultParameterValues(document: ScriptDocumentView | undefined): Record<string, ScriptParameterValue> {
  if (!document) return {};
  return Object.fromEntries(Object.entries(document.parameters).flatMap(([key, definition]) => definition.default === undefined ? [] : [[key, definition.default]]));
}

function sourceAction(step: Record<string, unknown>): string {
  const actions = ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "waitForPage", "assertPage", "runFlow", "repeat", "when"];
  return actions.find((action) => action in step) ?? "unknown";
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = { launchApp: "启动 App", tap: "点击", inputText: "输入文本", clearText: "清空输入", selectText: "选择选项", swipe: "滑动", scrollUntilVisible: "滚动查找", waitForPage: "等待页面", assertPage: "确认页面", runFlow: "执行子流程", repeat: "重复", when: "条件步骤" };
  return labels[action] ?? action;
}

function newScriptTemplate(): string {
  return `version: 1
name: 新脚本用例
app:
  id: cn.eeo.classin
  platform: android
start:
  strategy: keepCurrent
parameters: {}
steps:
  - id: verify-current-page
    assertPage: classin.home
tags: []
`;
}

function validationIssues(error: unknown): Array<{ path: string; message: string }> {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const issues = (error.payload as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const parsed = issues.flatMap((issue) => {
        if (!issue || typeof issue !== "object") return [];
        const path = "path" in issue && typeof issue.path === "string" ? issue.path : "$";
        const message = "message" in issue && typeof issue.message === "string" ? issue.message : undefined;
        return message ? [{ path, message }] : [];
      });
      if (parsed.length) return parsed;
    }
  }
  const message = errorMessage(error);
  return [{ path: "$", message }];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
