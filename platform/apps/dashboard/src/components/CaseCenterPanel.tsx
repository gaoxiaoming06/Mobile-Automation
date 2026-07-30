import { Pencil, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AndroidAppMonitorConfig, ScriptFlow, TestRun } from "@mobile-automation/shared";
import { apiFetchJson } from "../api.js";
import { ScriptRunForm, type ScriptParameterValue } from "./ScriptRunForm.js";
import {
  caseStepViews,
  defaultCaseParameterValues,
  readCaseDocument,
  testKindLabel,
  type CasePlanView
} from "./case-view.js";

type CaseCenterPanelProps = {
  devices: Array<{ serial: string; name?: string }>;
  selectedSerial: string;
  initialFlows?: ScriptFlow[];
  initialSelectedFlowId?: string;
  setMessage: (message: string) => void;
  onOpenRun: (runId: string) => void;
  onModifyCase: (flow: ScriptFlow) => void;
  onCreateCase: () => void;
  androidAppMonitorForApp?: (appId: string) => AndroidAppMonitorConfig | undefined;
};

export function CaseCenterPanel({
  devices,
  selectedSerial,
  initialFlows,
  initialSelectedFlowId,
  setMessage,
  onOpenRun,
  onModifyCase,
  onCreateCase,
  androidAppMonitorForApp
}: CaseCenterPanelProps) {
  const [flows, setFlows] = useState<ScriptFlow[]>(initialFlows ?? []);
  const [selectedId, setSelectedId] = useState(initialSelectedFlowId ?? initialFlows?.[0]?.id ?? "");
  const selected = flows.find((flow) => flow.id === selectedId) ?? flows[0];
  const document = readCaseDocument(selected?.parsed);
  const [parameterValues, setParameterValues] = useState<Record<string, ScriptParameterValue>>(() => defaultCaseParameterValues(document));
  const [deviceSerial, setDeviceSerial] = useState(selectedSerial);
  const [plan, setPlan] = useState<CasePlanView>();
  const [lastRun, setLastRun] = useState<TestRun>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initialFlows) void refreshFlows();
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
      const next = response.flows.find((flow) => flow.id === (initialSelectedFlowId ?? selectedId)) ?? response.flows[0];
      if (next) selectCase(next);
      setMessage(`已加载 ${response.flows.length} 个测试`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function selectCase(flow: ScriptFlow) {
    setSelectedId(flow.id);
    setParameterValues(defaultCaseParameterValues(readCaseDocument(flow.parsed)));
    setPlan(undefined);
    setLastRun(undefined);
  }

  async function removeSelected() {
    if (!selected) return;
    try {
      setBusy(true);
      await apiFetchJson<{ deleted: true }>(`/api/script-flows/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      const remaining = flows.filter((flow) => flow.id !== selected.id);
      setFlows(remaining);
      if (remaining[0]) selectCase(remaining[0]);
      setMessage("已删除测试");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSelected() {
    if (!selected) return;
    try {
      setBusy(true);
      const preview = await apiFetchJson<{ plan: CasePlanView; planDigest: string }>(`/api/script-flows/${encodeURIComponent(selected.id)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: selected.version, parameters: parameterValues })
      });
      setPlan(preview.plan);
      const androidAppMonitor = androidAppMonitorForApp?.(selected.appId);
      const response = await apiFetchJson<{ run: TestRun }>(`/api/script-flows/${encodeURIComponent(selected.id)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCaseRunRequest({
          expectedVersion: selected.version,
          planDigest: preview.planDigest,
          deviceSerial,
          parameters: parameterValues,
          recordVideo: false,
          ...(androidAppMonitor ? { androidAppMonitor } : {})
        }))
      });
      setLastRun(response.run);
      setMessage(`已启动${testKindLabel(document?.kind)}：${response.run.id}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const steps = caseStepViews(document, plan);

  return (
    <section className="module-page case-center-module">
      <header className="case-center-header">
        <div><h2>用例中心</h2><p>沉淀可复用的用例与场景，通过 AI 完成创建和修改。</p></div>
        <div className="case-center-toolbar">
          <button className="icon-button" type="button" title="刷新测试" onClick={() => void refreshFlows()} disabled={busy}><RefreshCw size={16} /></button>
          <button className="primary-button" type="button" onClick={onCreateCase}><Sparkles size={16} /><span>AI 创建测试</span></button>
        </div>
      </header>
      <div className="case-center-layout">
        <aside className="case-list" aria-label="测试列表">
          {flows.map((flow) => (
            <button key={flow.id} type="button" className={flow.id === selected?.id ? "selected" : ""} onClick={() => selectCase(flow)}>
              <strong>{flow.name}</strong><span>{flow.description || flow.appId}</span><small><span className={`test-kind-badge ${readCaseDocument(flow.parsed)?.kind ?? "case"}`}>{testKindLabel(readCaseDocument(flow.parsed)?.kind)}</span>{statusLabel(flow.status)} · v{flow.version}</small>
            </button>
          ))}
          {!flows.length ? <div className="empty"><strong>暂无测试</strong><span>通过 AI 创建第一个可复用用例或场景。</span></div> : null}
        </aside>
        <section className="case-detail">
          {selected ? <>
            <header className="case-detail-header">
              <div><h3>{selected.name}</h3><p>{selected.description || "暂无测试说明"}</p></div>
              <div className="case-detail-actions">
                <button type="button" onClick={() => onModifyCase(selected)}><Pencil size={16} /><span>修改测试</span></button>
                <button className="icon-button danger" type="button" title="删除测试" onClick={() => void removeSelected()} disabled={busy}><Trash2 size={16} /></button>
              </div>
            </header>
            <div className="case-facts">
              <div><span>类型</span><strong>{testKindLabel(document?.kind)}</strong></div>
              <div><span>App</span><strong>{selected.appId}</strong></div>
              <div><span>平台</span><strong>{platformLabel(selected.platform)}</strong></div>
              <div><span>版本</span><strong>v{selected.version}</strong></div>
              <div><span>状态</span><strong>{statusLabel(selected.status)}</strong></div>
            </div>
            <section className="case-execution-logic">
              <header><h3>执行逻辑</h3><span>{steps.length} 个步骤</span></header>
              <ol className="case-step-list">
                {steps.map((step) => <li key={step.id}><span>{step.order}</span><div><strong>{step.name}</strong><small>{step.context ?? step.id}</small></div></li>)}
              </ol>
              {!steps.length ? <p className="empty">该测试暂无执行步骤</p> : null}
            </section>
          </> : <div className="empty"><strong>选择一个用例或场景</strong><span>查看它的用途和详细执行逻辑。</span></div>}
        </section>
        <aside className="case-run-panel">
          <ScriptRunForm
            parameters={document?.parameters ?? {}}
            values={parameterValues}
            devices={devices}
            deviceSerial={deviceSerial}
            busy={busy}
            disabled={!selected || selected.status === "archived"}
            onValueChange={(key, value) => {
              setParameterValues((current) => ({ ...current, [key]: value }));
              setPlan(undefined);
            }}
            onDeviceChange={setDeviceSerial}
            onRun={() => void runSelected()}
          />
          {lastRun ? <section className="script-run-status"><header><h3>执行状态</h3><strong data-status={lastRun.status}>{lastRun.status}</strong></header><p>{lastRun.stepResults.length}/{lastRun.steps.length} 个步骤</p><button type="button" onClick={() => onOpenRun(lastRun.id)}>查看执行结果</button></section> : null}
        </aside>
      </div>
    </section>
  );
}

export function buildCaseRunRequest<T extends {
  expectedVersion: number;
  planDigest: string;
  deviceSerial: string;
  parameters: Record<string, ScriptParameterValue>;
}>(input: T): T {
  return input;
}

function statusLabel(status: ScriptFlow["status"]): string {
  return { draft: "草稿", active: "启用", archived: "归档" }[status];
}

function platformLabel(platform: ScriptFlow["platform"]): string {
  return { android: "Android", ios: "iOS", harmony: "鸿蒙", flutter: "Flutter" }[platform];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
