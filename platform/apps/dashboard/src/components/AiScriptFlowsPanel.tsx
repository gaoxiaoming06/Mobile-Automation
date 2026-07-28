import { ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ScriptFlow } from "@mobile-automation/shared";
import { apiFetchJson } from "../api.js";

type ReadyDraft = {
  status: "ready";
  sourceYaml: string;
  document: { name: string; steps: unknown[] };
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

type AiScriptFlowsPanelProps = {
  defaultAppId: string;
  setMessage: (message: string) => void;
  onUseDraft: (sourceYaml: string) => void;
  initialDraft?: AiDraft;
};

export function AiScriptFlowsPanel({ defaultAppId, setMessage, onUseDraft, initialDraft }: AiScriptFlowsPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [appId, setAppId] = useState(defaultAppId);
  const [platform, setPlatform] = useState<ScriptFlow["platform"]>("android");
  const [draft, setDraft] = useState<AiDraft | undefined>(initialDraft);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!prompt.trim() || !appId.trim()) return;
    try {
      setBusy(true);
      const response = await apiFetchJson<{ draft: AiDraft }>("/api/script-flow-drafts/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), appId: appId.trim(), platform })
      });
      setDraft(response.draft);
      setMessage(response.draft.status === "ready" ? response.draft.summary : response.draft.clarification);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page ai-script-module">
      <header className="ai-script-header">
        <div><h2>AI 生成用例</h2><p>描述业务过程，生成可校验、可编辑的 ScriptFlow 草稿。</p></div>
      </header>
      <div className="ai-script-layout">
        <section className="ai-script-request">
          <div className="form-grid two-columns">
            <label>App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} /></label>
            <label>平台<select value={platform} onChange={(event) => setPlatform(event.target.value as ScriptFlow["platform"])}>
              <option value="android">Android</option><option value="ios">iOS</option><option value="harmony">鸿蒙</option><option value="flutter">Flutter</option>
            </select></label>
          </div>
          <label className="ai-script-prompt"><span>测试目标或操作过程</span><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布" /></label>
          <button className="primary-button ai-script-generate" type="button" onClick={() => void generate()} disabled={busy || !prompt.trim() || !appId.trim()}>
            <Sparkles size={17} /><span>{busy ? "生成中" : "生成脚本草稿"}</span>
          </button>
        </section>
        <section className="ai-script-result" aria-live="polite">
          {!draft ? <div className="empty"><strong>等待生成</strong><span>规划时不会读取或改变当前设备页面。</span></div> : null}
          {draft?.status === "needs_clarification" ? <div className="ai-script-clarification"><strong>需要补充信息</strong><p>{draft.clarification}</p></div> : null}
          {draft?.status === "ready" ? <>
            <header><div><h3>{draft.document.name}</h3><p>{draft.summary}</p></div><span>{draft.document.steps.length} 个步骤</span></header>
            {draft.assumptions.length ? <div className="ai-script-assumptions"><strong>生成假设</strong>{draft.assumptions.map((item) => <p key={item}>{item}</p>)}</div> : null}
            <pre>{draft.sourceYaml}</pre>
            <button className="primary-button" type="button" onClick={() => onUseDraft(draft.sourceYaml)}><span>进入脚本编辑器</span><ArrowRight size={16} /></button>
          </> : null}
        </section>
      </div>
    </section>
  );
}
