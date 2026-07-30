import { Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { AndroidAppMonitorConfig, ScriptFlow, TestRun } from "@mobile-automation/shared";
import { apiFetchJson } from "../api.js";
import { ScriptRunForm, type ScriptParameterValue } from "./ScriptRunForm.js";
import {
  caseStepViews,
  defaultCaseParameterValues,
  testKindLabel,
  type CaseDocumentView,
  type CasePlanView
} from "./case-view.js";

type ReadyDraft = {
  status: "ready";
  sourceYaml: string;
  document: CaseDocumentView;
  parameterValues?: Record<string, ScriptParameterValue>;
  summary: string;
  assumptions: string[];
  channel: string;
  model: string;
};

type ClarificationDraft = {
  status: "needs_clarification";
  clarification: string;
  channel: string;
  model: string;
};

type AiDraft = ReadyDraft | ClarificationDraft;

export type CaseRevision = {
  flowId: string;
  version: number;
  name: string;
};

type AiScriptFlowsPanelProps = {
  defaultAppId: string;
  devices: Array<{ serial: string; name?: string }>;
  selectedSerial: string;
  setMessage: (message: string) => void;
  onSaved: (flow: ScriptFlow) => void;
  onOpenRun: (runId: string) => void;
  revision?: CaseRevision;
  initialDraft?: AiDraft;
  androidAppMonitorForApp?: (appId: string) => AndroidAppMonitorConfig | undefined;
};

export function AiScriptFlowsPanel({
  defaultAppId,
  devices,
  selectedSerial,
  setMessage,
  onSaved,
  onOpenRun,
  revision,
  initialDraft,
  androidAppMonitorForApp
}: AiScriptFlowsPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [appId, setAppId] = useState(defaultAppId);
  const [platform, setPlatform] = useState<ScriptFlow["platform"]>("android");
  const [draft, setDraft] = useState<AiDraft | undefined>(initialDraft);
  const readyDraft = draft?.status === "ready" ? draft : undefined;
  const [parameterValues, setParameterValues] = useState<Record<string, ScriptParameterValue>>(() => draftParameterValues(readyDraft));
  const [deviceSerial, setDeviceSerial] = useState(selectedSerial);
  const [plan, setPlan] = useState<CasePlanView>();
  const [lastRun, setLastRun] = useState<TestRun>();
  const [busyAction, setBusyAction] = useState<"generate" | "save" | "run">();

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

  async function generate() {
    if (!prompt.trim() || (!revision && !appId.trim())) return;
    try {
      setBusyAction("generate");
      const body = revision
        ? { prompt: prompt.trim(), flowId: revision.flowId, expectedVersion: revision.version }
        : { prompt: prompt.trim(), appId: appId.trim(), platform };
      const response = await apiFetchJson<{ draft: AiDraft }>("/api/script-flow-drafts/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      setDraft(response.draft);
      setLastRun(undefined);
      setPlan(undefined);
      if (response.draft.status === "ready") {
        setParameterValues(draftParameterValues(response.draft));
        setMessage(response.draft.summary);
      } else {
        setParameterValues({});
        setMessage(response.draft.clarification);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function saveDraft() {
    if (!readyDraft) return;
    try {
      setBusyAction("save");
      const response = await apiFetchJson<{ flow: ScriptFlow }>(revision ? `/api/script-flows/${encodeURIComponent(revision.flowId)}` : "/api/script-flows", {
        method: revision ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceYaml: readyDraft.sourceYaml,
          status: "active",
          ...(revision ? { expectedVersion: revision.version } : {})
        })
      });
      setMessage(revision ? `已更新${testKindLabel(readyDraft.document.kind)} ${response.flow.name} · v${response.flow.version}` : `已保存到用例中心：${response.flow.name}`);
      onSaved(response.flow);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function runDraft() {
    if (!readyDraft) return;
    try {
      setBusyAction("run");
      const preview = await apiFetchJson<{ plan: CasePlanView; planDigest: string }>("/api/script-flow-drafts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceYaml: readyDraft.sourceYaml, parameters: parameterValues })
      });
      setPlan(preview.plan);
      const androidAppMonitor = androidAppMonitorForApp?.(readyDraft.document.app.id);
      const response = await apiFetchJson<{ run: TestRun }>("/api/script-flow-drafts/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceYaml: readyDraft.sourceYaml,
          planDigest: preview.planDigest,
          deviceSerial,
          parameters: parameterValues,
          recordVideo: false,
          ...(androidAppMonitor ? { androidAppMonitor } : {})
        })
      });
      setLastRun(response.run);
      setMessage(`已启动临时测试：${response.run.id}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  const steps = caseStepViews(readyDraft?.document);
  const busy = busyAction !== undefined;

  return (
    <section className="module-page ai-script-module">
      <header className="ai-script-header">
        <div>
          <h2>{revision ? "修改测试" : "AI 生成测试"}</h2>
          <p>{revision ? `正在修改“${revision.name}”，描述需要调整的业务逻辑。` : "只需描述业务目标，AI 会生成可直接执行或保存的用例/场景。"}</p>
        </div>
      </header>
      <div className="ai-script-layout">
        <section className="ai-script-request">
          {revision ? <div className="ai-revision-context"><span>当前测试</span><strong>{revision.name}</strong><small>v{revision.version}</small></div> : (
            <div className="form-grid two-columns">
              <label>App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} /></label>
              <label>平台<select value={platform} onChange={(event) => setPlatform(event.target.value as ScriptFlow["platform"])}>
                <option value="android">Android</option><option value="ios">iOS</option><option value="harmony">鸿蒙</option><option value="flutter">Flutter</option>
              </select></label>
            </div>
          )}
          <label className="ai-script-prompt">
            <span>{revision ? "描述你想怎样修改这个测试" : "测试目标或操作过程"}</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={revision ? "例如：登录成功后增加主页校验，失败时保留截图" : "例如：启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布"}
            />
          </label>
          <button className="primary-button ai-script-generate" type="button" onClick={() => void generate()} disabled={busy || !prompt.trim() || (!revision && !appId.trim())}>
            <Sparkles size={17} /><span>{busyAction === "generate" ? "生成中" : revision ? "生成修改方案" : "生成测试"}</span>
          </button>
        </section>
        <section className="ai-script-result" aria-live="polite">
          {!draft ? <div className="empty"><strong>{revision ? "等待修改说明" : "等待生成"}</strong><span>规划时不会读取或改变当前设备页面。</span></div> : null}
          {draft?.status === "needs_clarification" ? <div className="ai-script-clarification"><strong>需要补充信息</strong><p>{draft.clarification}</p></div> : null}
          {readyDraft ? <>
            <header><div><span className={`test-kind-badge ${readyDraft.document.kind}`}>{testKindLabel(readyDraft.document.kind)}</span><h3>{readyDraft.document.name}</h3><p>{readyDraft.summary}</p></div><span>{steps.length} 个步骤</span></header>
            {readyDraft.assumptions.length ? <div className="ai-script-assumptions"><strong>生成假设</strong>{readyDraft.assumptions.map((item) => <p key={item}>{item}</p>)}</div> : null}
            <section className="ai-case-logic">
              <header><h3>执行逻辑</h3><span>{steps.length} 个步骤</span></header>
              <ol className="case-step-list">
                {steps.map((step) => <li key={step.id}><span>{step.order}</span><div><strong>{step.name}</strong><small>{step.context ?? step.id}</small></div></li>)}
              </ol>
            </section>
            <div className="ai-case-actions">
              <button type="button" onClick={() => void saveDraft()} disabled={busy}><Save size={16} /><span>{revision ? "保存修改" : "保存到用例中心"}</span></button>
            </div>
            <ScriptRunForm
              parameters={readyDraft.document.parameters}
              values={parameterValues}
              devices={devices}
              deviceSerial={deviceSerial}
              busy={busyAction === "run"}
              onValueChange={(key, value) => {
                setParameterValues((current) => ({ ...current, [key]: value }));
                setPlan(undefined);
              }}
              onDeviceChange={setDeviceSerial}
              onRun={() => void runDraft()}
              buttonLabel="直接执行"
            />
            {lastRun ? <section className="script-run-status"><header><h3>执行状态</h3><strong data-status={lastRun.status}>{lastRun.status}</strong></header><p>{lastRun.stepResults.length}/{lastRun.steps.length} 个步骤</p><button type="button" onClick={() => onOpenRun(lastRun.id)}>查看执行结果</button></section> : null}
          </> : null}
        </section>
      </div>
    </section>
  );
}

function draftParameterValues(draft: ReadyDraft | undefined): Record<string, ScriptParameterValue> {
  return {
    ...defaultCaseParameterValues(draft?.document),
    ...(draft?.parameterValues ?? {})
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
