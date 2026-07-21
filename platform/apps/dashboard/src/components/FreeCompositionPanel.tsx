import { Play, RefreshCw, Search, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParameterProfile, Platform, RunMode } from "@mobile-automation/shared";
import { apiFetchJson } from "../api";

type FreeCompositionCandidate = {
  id: string;
  kind: "composite_case" | "meta_function" | "page_task" | "page_transition" | "system_action" | "generated_flow";
  appId: string;
  platform: Platform;
  name: string;
  description?: string;
  parameterProfileId?: string;
  parameterKeys: string[];
  score: number;
  matchedTerms: string[];
  systemAction?: "launch_app";
  composedCandidateIds?: string[];
};

type FreeCompositionIntent = {
  prompt: string;
  runMode: RunMode;
  repeatCount: number;
  riskTerms: string[];
  runtimeOverrides?: Record<string, string>;
};

type FreeCompositionResolution = {
  status: "ready" | "needs_clarification" | "missing_assets";
  intent: FreeCompositionIntent;
  candidates: FreeCompositionCandidate[];
  message: string;
};

type CompositePlan = {
  status: "ready" | "needs_parameters" | "blocked";
  runtimeParams: Record<string, string>;
  requiredParameters: string[];
  steps: Array<{ id: string; metaFunctionName: string; kind: string; targetPageModelId: string; pageElementId?: string; pageTaskId?: string; systemAction?: string; packageName?: string }>;
  issues: Array<{ code: string; message: string; assetId?: string }>;
};

type CompositeExecution = {
  id: string;
  status: "running" | "passed" | "failed" | "stopped";
  totalItems: number;
  completedItems: number;
  failedItems: number;
  currentItem?: { metaFunctionName: string; kind: string };
  items: Array<{ id: string; metaFunctionName: string; kind: string; status: string; error?: string }>;
};

type FreeCompositionSession = {
  id: string;
  appId: string;
  platform: Platform;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  resolution: FreeCompositionResolution;
  selectedCandidateId?: string;
  parameterProfileId?: string;
  plan?: CompositePlan;
  executionId?: string;
  execution?: CompositeExecution;
  status: "awaiting_selection" | "awaiting_parameters" | "awaiting_confirmation" | "blocked" | "running" | "passed" | "failed" | "stopped";
  riskConfirmed?: boolean;
};

export type FreeCompositionInitialData = {
  sessions: FreeCompositionSession[];
  profiles: ParameterProfile[];
};

type FreeCompositionPanelProps = {
  selectedSerial: string;
  selectedDeviceBusy: boolean;
  defaultAppId: string;
  setMessage: (message: string) => void;
  initialData?: FreeCompositionInitialData;
};

export function FreeCompositionPanel({ selectedSerial, selectedDeviceBusy, defaultAppId, setMessage, initialData }: FreeCompositionPanelProps) {
  const initialSession = initialData?.sessions[0];
  const initialCandidate = initialSession?.resolution.candidates[0];
  const [appId, setAppId] = useState(defaultAppId);
  const [prompt, setPrompt] = useState("");
  const [sessions, setSessions] = useState<FreeCompositionSession[]>(initialData?.sessions ?? []);
  const [profiles, setProfiles] = useState<ParameterProfile[]>(initialData?.profiles ?? []);
  const [selectedSessionId, setSelectedSessionId] = useState(initialSession?.id ?? "");
  const [selectedCandidateId, setSelectedCandidateId] = useState(initialCandidate?.id ?? "");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [riskConfirmed, setRiskConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initialData) {
      void refresh();
    }
  }, []);

  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? sessions[0];
  const activeCandidateId = selectedCandidateId || selectedSession?.selectedCandidateId || selectedSession?.resolution.candidates[0]?.id || "";
  const activeCandidate = selectedSession?.resolution.candidates.find((candidate) => candidate.id === activeCandidateId) ?? selectedSession?.resolution.candidates[0];
  const activeProfileId = selectedProfileId || selectedSession?.parameterProfileId || activeCandidate?.parameterProfileId || "";
  const hasRisk = Boolean(selectedSession?.resolution.intent.riskTerms.length);
  const conversationMissingKeys = selectedSession ? missingParameterKeysForSession(selectedSession, activeCandidate) : [];
  const replyingToMissingParameters = conversationMissingKeys.length > 0 && selectedSession?.resolution.status !== "missing_assets";
  const conversationMessages = selectedSession ? conversationMessagesForSession(selectedSession, activeCandidate, profiles) : [];
  const flowSelectLabel = activeCandidate?.kind === "generated_flow" ? "执行流程" : "候选流程";

  useEffect(() => {
    if (!selectedSession?.executionId || selectedSession.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void apiFetchJson<{ session: FreeCompositionSession }>(`/api/free-composition/sessions/${encodeURIComponent(selectedSession.id)}`)
        .then((response) => updateSession(response.session))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [selectedSession?.id, selectedSession?.executionId, selectedSession?.status]);

  async function refresh() {
    if (!appId.trim()) {
      setMessage("请输入 App 包名");
      return;
    }
    setBusy(true);
    try {
      const query = `appId=${encodeURIComponent(appId.trim())}&platform=android`;
      const [sessionResponse, profileResponse] = await Promise.all([
        apiFetchJson<{ sessions: FreeCompositionSession[] }>(`/api/free-composition/sessions?${query}`),
        apiFetchJson<{ profiles: ParameterProfile[] }>(`/api/asset-composition/parameter-profiles?${query}`)
      ]);
      setSessions(sessionResponse.sessions);
      setProfiles(profileResponse.profiles);
      applySelectedSession(sessionResponse.sessions[0]);
      setMessage(`已加载 ${sessionResponse.sessions.length} 个AI资产用例会话`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function analyzePrompt() {
    if (!appId.trim() || !prompt.trim()) {
      setMessage(!appId.trim() ? "请输入 App 包名" : "请输入要测试的流程");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetchJson<{ session: FreeCompositionSession }>("/api/free-composition/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: appId.trim(), platform: "android", prompt: prompt.trim() })
      });
      updateSession(response.session);
      applySelectedSession(response.session);
      setRiskConfirmed(false);
      setPrompt("");
      setMessage(response.session.resolution.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan() {
    if (!selectedSession || !activeCandidateId) {
      setMessage("请先分析需求并选择候选流程");
      return;
    }
    setBusy(true);
    try {
      const body = {
        candidateId: activeCandidateId,
        ...(activeProfileId ? { parameterProfileId: activeProfileId } : {})
      };
      const response = await apiFetchJson<{ session: FreeCompositionSession; plan: CompositePlan }>(`/api/free-composition/sessions/${encodeURIComponent(selectedSession.id)}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      updateSession(response.session);
      setSelectedSessionId(response.session.id);
      setSelectedCandidateId(response.session.selectedCandidateId ?? "");
      setSelectedProfileId(response.session.parameterProfileId ?? "");
      setMessage(messageForPlan(response.plan, "AI资产用例计划"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (replyingToMissingParameters) {
      await replyToMissingParameters();
      return;
    }
    await analyzePrompt();
  }

  async function replyToMissingParameters() {
    if (!selectedSession || !activeCandidateId) {
      setMessage("请先选择AI资产用例会话");
      return;
    }
    const reply = prompt.trim();
    if (!reply) {
      setMessage("请直接回复缺少的参数值，或回复“使用参数集：名称”。");
      return;
    }
    const missingKeys = conversationMissingKeys.length ? conversationMissingKeys : missingParameterKeysForSession(selectedSession, activeCandidate);
    const profileId = freeCompositionReplyProfileId(reply, profiles);
    const runtimeOverrides = {
      ...knownRuntimeParamsForSession(selectedSession),
      ...freeCompositionReplyRuntimeOverrides(reply, missingKeys)
    };
    setBusy(true);
    try {
      const response = await apiFetchJson<{ session: FreeCompositionSession; plan: CompositePlan }>(`/api/free-composition/sessions/${encodeURIComponent(selectedSession.id)}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: activeCandidateId,
          ...(profileId ? { parameterProfileId: profileId } : activeProfileId ? { parameterProfileId: activeProfileId } : {}),
          runtimeOverrides: nonEmptyRuntimeOverrides(runtimeOverrides)
        })
      });
      updateSession(response.session);
      setSelectedSessionId(response.session.id);
      setSelectedCandidateId(response.session.selectedCandidateId ?? "");
      setSelectedProfileId(response.session.parameterProfileId ?? profileId ?? "");
      setPrompt("");
      setMessage(messageForPlan(response.plan, "AI资产用例计划"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function executePlan() {
    if (!selectedSession || !selectedSerial) {
      setMessage(!selectedSerial ? "请先选择执行设备" : "请先生成AI资产用例计划");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetchJson<{ session: FreeCompositionSession; execution: CompositeExecution; plan: CompositePlan }>(`/api/free-composition/sessions/${encodeURIComponent(selectedSession.id)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial: selectedSerial, confirmed: true, riskConfirmed })
      });
      updateSession(response.session);
      setMessage(`已启动AI资产用例：${response.execution.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function updateSession(session: FreeCompositionSession) {
    setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
  }

  function applySelectedSession(session: FreeCompositionSession | undefined) {
    const candidate = session?.resolution.candidates.find((item) => item.id === session.selectedCandidateId) ?? session?.resolution.candidates[0];
    setSelectedSessionId(session?.id ?? "");
    setSelectedCandidateId(candidate?.id ?? "");
    setSelectedProfileId(session?.parameterProfileId ?? "");
  }

  function selectCandidate(candidateId: string) {
    setSelectedCandidateId(candidateId);
  }

  return (
    <section className="module-page asset-composition-module free-composition-module">
      <div className="module-header asset-composition-header">
        <div className="asset-composition-title">
          <h2>AI资产用例</h2>
          <p>用 AI 基于已保存页面资产生成临时测试计划，确认后通过现有执行器运行。</p>
        </div>
        <div className="asset-composition-app-picker">
          <input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="App 包名" />
          <button className="icon-button" type="button" onClick={() => void refresh()} disabled={busy} title="刷新AI资产用例"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="free-composition-grid free-composition-workbench">
        <aside className="free-composition-chat free-composition-conversation-panel">
          {conversationMessages.length ? (
            <div className="free-composition-thread">
              {conversationMessages.map((message) => (
                <div className={`free-composition-message ${message.role}`} key={`${message.role}-${message.text}`}>
                  <span>{message.role === "user" ? "你" : "系统"}</span>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="free-composition-input-block">
            <label>
              {replyingToMissingParameters ? "回复" : "测试目标"}
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={replyingToMissingParameters ? "例如：eeo123 或 password=eeo123" : "例如：用教师账号测试登录流程，循环 3 次"} rows={5} />
            </label>
            <button className="primary-button" type="button" onClick={() => void sendMessage()} disabled={busy}>{replyingToMissingParameters ? <Send size={15} /> : <Search size={15} />}{replyingToMissingParameters ? "发送回复" : "分析需求"}</button>
          </div>
          <div className="composition-asset-list free-composition-session-list free-composition-session-feed">
            {sessions.map((session) => <button type="button" className={session.id === selectedSession?.id ? "selected" : ""} key={session.id} onClick={() => { applySelectedSession(session); setRiskConfirmed(session.riskConfirmed === true); }}>
              <strong>{session.prompt}</strong>
              <span>{sessionStatusLabel(session.status)} · {runModeLabel(session.resolution.intent.runMode, session.resolution.intent.repeatCount)}</span>
            </button>)}
            {!sessions.length ? <div className="empty">暂无AI资产用例会话</div> : null}
          </div>
        </aside>

        <div className="composition-editor-form free-composition-plan free-composition-execution-panel">
          {selectedSession ? <>
            <section className={`composition-plan free-composition-status-summary ${selectedSession.resolution.status === "missing_assets" ? "blocked" : "ready"}`}>
              <strong>{selectedSession.resolution.message}</strong>
              <span>{runModeLabel(selectedSession.resolution.intent.runMode, selectedSession.resolution.intent.repeatCount)}</span>
              {selectedSession.resolution.intent.riskTerms.length ? <span>风险操作：{selectedSession.resolution.intent.riskTerms.join("、")}</span> : null}
            </section>

            <div className="free-composition-controls">
              <label>{flowSelectLabel}<select value={activeCandidateId} onChange={(event) => selectCandidate(event.target.value)}>
                {selectedSession.resolution.candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidateKindLabel(candidate.kind)} · {candidate.name}</option>)}
              </select></label>
              {hasRisk ? <label className="checkbox-field"><input type="checkbox" checked={riskConfirmed} onChange={(event) => setRiskConfirmed(event.target.checked)} />确认执行发布/提交等风险操作</label> : null}
            </div>

            <div className="composition-run-actions free-composition-action-bar">
              <button className="secondary-button" type="button" disabled={!activeCandidateId || busy} onClick={() => void generatePlan()}>生成计划</button>
              <button className="primary-button" type="button" disabled={!selectedSession.plan || selectedSession.plan.status !== "ready" || !selectedSerial || selectedDeviceBusy || busy || selectedSession.status === "running"} onClick={() => void executePlan()}><Play size={15} />开始执行</button>
            </div>

            <div className="free-composition-result-stack">
              {selectedSession.plan ? <PlanView plan={selectedSession.plan} /> : null}
              {selectedSession.execution ? <ExecutionView execution={selectedSession.execution} /> : null}
            </div>
          </> : <div className="empty">输入自然语言测试目标后开始。</div>}
        </div>
      </div>
    </section>
  );
}

function PlanView({ plan }: { plan: CompositePlan }) {
  const runtimeParamSummary = runtimeParamsSummary(plan.runtimeParams);
  const missingPrompt = missingParameterPrompt(plan);
  return <div className={`composition-plan ${plan.status}`}>
    <strong>{plan.status === "ready" ? `预检通过 · ${plan.steps.length} 个资产步骤` : plan.status === "needs_parameters" ? "需要补充参数" : "预检未通过"}</strong>
    {missingPrompt ? <span>{missingPrompt}</span> : null}
    {plan.requiredParameters.length ? <span>需要参数：{plan.requiredParameters.join("、")}</span> : null}
    {runtimeParamSummary ? <span>本次参数：{runtimeParamSummary}</span> : null}
    {plan.status !== "needs_parameters" ? plan.issues.map((item) => <span key={`${item.code}-${item.message}`}>{item.code} · {item.message}</span>) : null}
  </div>;
}

function ExecutionView({ execution }: { execution: CompositeExecution }) {
  return <div className="composition-execution"><div className="panel-head"><strong>{execution.status} · {execution.completedItems}/{execution.totalItems}</strong><a href={`/api/asset-composition/executions/${encodeURIComponent(execution.id)}/report`} target="_blank" rel="noreferrer">打开报告</a></div>{execution.currentItem ? <p>当前：{execution.currentItem.metaFunctionName} · {execution.currentItem.kind}</p> : null}<div className="composition-execution-list">{execution.items.map((item) => <div key={item.id} className={item.status}><strong>{item.metaFunctionName}</strong><span>{item.kind} · {item.status}{item.error ? ` · ${item.error}` : ""}</span></div>)}</div></div>;
}

function runModeLabel(runMode: RunMode, repeatCount: number): string {
  if (runMode === "loop_until_stop") {
    return "持续循环";
  }
  if (runMode === "repeat_n") {
    return `循环 ${repeatCount} 次`;
  }
  return "单次执行";
}

function candidateKindLabel(kind: FreeCompositionCandidate["kind"]): string {
  if (kind === "composite_case") {
    return "组合用例";
  }
  if (kind === "page_task") {
    return "页面任务";
  }
  if (kind === "generated_flow") {
    return "生成流程";
  }
  if (kind === "page_transition") {
    return "页面连接";
  }
  if (kind === "system_action") {
    return "系统步骤";
  }
  return "元功能";
}

function sessionStatusLabel(status: FreeCompositionSession["status"]): string {
  const labels: Record<FreeCompositionSession["status"], string> = {
    awaiting_selection: "等待选择",
    awaiting_parameters: "等待补参数",
    awaiting_confirmation: "等待确认",
    blocked: "无法继续",
    running: "执行中",
    passed: "已通过",
    failed: "失败",
    stopped: "已停止"
  };
  return labels[status];
}

function messageForPlan(plan: CompositePlan, label: string): string {
  if (plan.status === "ready") {
    return `${label}预检通过`;
  }
  return missingParameterPrompt(plan) ?? plan.issues[0]?.message ?? `${label}预检失败`;
}

function missingParameterPrompt(plan: CompositePlan): string | undefined {
  if (plan.status !== "needs_parameters") {
    return undefined;
  }
  const missing = missingParameterKeys(plan);
  return missing.length ? followUpQuestion(missing) : "需要补充参数";
}

function missingParameterKeys(plan: CompositePlan): string[] {
  return [...new Set(plan.issues
    .filter((issue) => issue.code === "MISSING_REQUIRED_PARAMETER")
    .map((issue) => issue.assetId?.trim() ?? "")
    .filter(Boolean))]
    .sort();
}

function nonEmptyRuntimeOverrides(values: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(values)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key && value);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function runtimeParamsSummary(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${redactedRuntimeValue(key, value)}`)
    .join("、");
}

function redactedRuntimeValue(key: string, value: string): string {
  return key.toLowerCase().includes("password") || key.includes("密码") ? "***" : value;
}

function conversationMessagesForSession(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate | undefined,
  profiles: ParameterProfile[]
): Array<{ role: "user" | "assistant"; text: string }> {
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [
    { role: "user", text: session.prompt }
  ];
  if (session.resolution.status === "missing_assets") {
    messages.push({ role: "assistant", text: session.resolution.message });
    return messages;
  }
  const missing = missingParameterKeysForSession(session, candidate);
  if (missing.length) {
    const knownSummary = runtimeParamsSummary(knownRuntimeParamsForSession(session));
    const profileHint = profiles.length ? `也可以回复“使用参数集：${profiles[0]!.name}”。` : "";
    messages.push({
      role: "assistant",
      text: [knownSummary ? `我已识别 ${knownSummary}。` : "", followUpQuestion(missing), profileHint].filter(Boolean).join("")
    });
    return messages;
  }
  if (session.plan?.status === "ready") {
    messages.push({ role: "assistant", text: "参数已补齐，可以开始执行。" });
    return messages;
  }
  messages.push({ role: "assistant", text: session.resolution.message });
  return messages;
}

function missingParameterKeysForSession(
  session: FreeCompositionSession,
  candidate: FreeCompositionCandidate | undefined
): string[] {
  const planMissing = session.plan ? missingParameterKeys(session.plan) : [];
  if (planMissing.length) {
    return planMissing;
  }
  const known = knownRuntimeParamsForSession(session);
  return (candidate?.parameterKeys ?? [])
    .filter((key) => !known[key]?.trim())
    .sort();
}

function knownRuntimeParamsForSession(session: FreeCompositionSession): Record<string, string> {
  return {
    ...(session.resolution.intent.runtimeOverrides ?? {}),
    ...(session.plan?.runtimeParams ?? {})
  };
}

function followUpQuestion(keys: string[]): string {
  return keys.length === 1
    ? `还需要 ${keys[0]}。直接回复 ${keys[0]} 的值。`
    : `还需要 ${keys.join("、")}。请用 key=value 的方式回复。`;
}

export function freeCompositionReplyRuntimeOverrides(reply: string, missingKeys: string[]): Record<string, string> {
  const normalizedMissingKeys = missingKeys.map((key) => key.trim()).filter(Boolean);
  const explicit = explicitRuntimeOverridesFromReply(reply, normalizedMissingKeys);
  if (Object.keys(explicit).length) {
    return explicit;
  }
  const trimmed = reply.trim();
  if (normalizedMissingKeys.length === 1 && trimmed && !looksLikeProfileReply(trimmed)) {
    return { [normalizedMissingKeys[0]!]: trimmed };
  }
  return {};
}

export function freeCompositionReplyProfileId(reply: string, profiles: ParameterProfile[]): string | undefined {
  const trimmed = reply.trim();
  if (!looksLikeProfileReply(trimmed)) {
    return undefined;
  }
  const requested = trimmed.replace(/^(?:使用|用)?(?:已有)?参数集[:：]?\s*/u, "").trim();
  if (!requested) {
    return undefined;
  }
  return profiles.find((profile) => requested.includes(profile.name) || profile.name.includes(requested))?.id;
}

function explicitRuntimeOverridesFromReply(reply: string, missingKeys: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of missingKeys) {
    const escapedKey = escapeRegExp(key);
    const match = reply.match(new RegExp(`(?:^|[\\s,，;；])${escapedKey}\\s*(?:=|:|：|为|是)\\s*([^\\s,，;；]+)`, "i"));
    if (match?.[1]?.trim()) {
      values[key] = match[1].trim();
    }
  }
  return values;
}

function looksLikeProfileReply(reply: string): boolean {
  return /参数集|参数组合|测试数据/.test(reply);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
