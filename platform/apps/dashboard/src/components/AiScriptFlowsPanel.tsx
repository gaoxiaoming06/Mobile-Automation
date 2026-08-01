import { FileSearch, History, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { serializeScriptFlow, type ScriptFlowDocument } from "@mobile-automation/script-flow";
import { publicExecutionFailureFromRun } from "@mobile-automation/shared";
import type {
  AndroidAppMonitorConfig,
  FlowVerification,
  LearningSession,
  PublicExecutionFailure,
  ScriptFlow,
  ScriptFlowVerificationAssessment,
  TemporaryTest,
  TestRun
} from "@mobile-automation/shared";
import { apiFetchJson } from "../api.js";
import { ScriptRunForm, type ScriptParameterValue } from "./ScriptRunForm.js";
import {
  caseStepViews,
  defaultCaseParameterValues,
  readCaseDocument,
  testKindLabel,
  testLevelLabel,
  testPurposeLabel,
  type CaseDocumentView,
  type CasePlanView,
  type CaseSourceStep
} from "./case-view.js";

export type GeneratedDraft = {
  status: "ready" | "trial_ready";
  sourceYaml: string;
  document: CaseDocumentView;
  parameterValues?: Record<string, ScriptParameterValue>;
  summary: string;
  assumptions: string[];
  verification?: ScriptFlowVerificationAssessment;
  sourceFlow?: SavedFlowReference;
  channel: string;
  model: string;
};

type ClarificationDraft = {
  status: "needs_clarification";
  clarification: string;
  channel: string;
  model: string;
};

type AiDraft = GeneratedDraft | ClarificationDraft;

type LearningSummaryResponse = {
  session: LearningSession;
  verification?: FlowVerification;
};

type TargetKind = "text" | "semantic" | "icon" | "control";

type StepLocatorView = {
  targetKind: TargetKind;
  targetValue: string;
  usesSearchPolicy: boolean;
  area?: string;
  position?: string;
  nearText?: string;
  scopeText?: string;
  ordinal?: string;
  checked?: string;
  searchMode?: string;
  direction?: string;
  maxSwipes?: string;
  resetToTop?: string;
  container?: string;
};

export type StepReviewItem = {
  key: string;
  path: number[];
  id: string;
  order: number;
  name: string;
  action: string;
  context?: string;
  risk: string;
  locator?: StepLocatorView;
};

export type StepLocatorPatch = Partial<StepLocatorView>;

export type CaseRevision = {
  flowId: string;
  version: number;
  name: string;
};

type SavedFlowReference = {
  id: string;
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
  initialHistory?: TemporaryTest[];
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
  initialHistory = [],
  androidAppMonitorForApp
}: AiScriptFlowsPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [appId, setAppId] = useState(defaultAppId);
  const [platform, setPlatform] = useState<ScriptFlow["platform"]>("android");
  const [draft, setDraft] = useState<AiDraft | undefined>(initialDraft);
  const [history, setHistory] = useState<TemporaryTest[]>(initialHistory);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const generatedDraft = draft?.status === "ready" || draft?.status === "trial_ready" ? draft : undefined;
  const trialRequired = generatedDraft?.status === "trial_ready";
  const [parameterValues, setParameterValues] = useState<Record<string, ScriptParameterValue>>(() => draftParameterValues(generatedDraft));
  const [deviceSerial, setDeviceSerial] = useState(selectedSerial);
  const [plan, setPlan] = useState<CasePlanView>();
  const [lastRun, setLastRun] = useState<TestRun>();
  const [learning, setLearning] = useState<LearningSummaryResponse>();
  const [busyAction, setBusyAction] = useState<"generate" | "save" | "run" | "review" | "select">();
  const [useCurrentScreen, setUseCurrentScreen] = useState(false);
  const [confirmedStepKeys, setConfirmedStepKeys] = useState<Set<string>>(() => new Set());
  const lastRunFailure = lastRun ? publicExecutionFailureFromRun(lastRun) : undefined;

  useEffect(() => {
    if (selectedSerial) setDeviceSerial(selectedSerial);
  }, [selectedSerial]);

  useEffect(() => {
    if (revision || !appId.trim()) return;
    void refreshHistory(appId.trim(), platform).then(setHistory).catch(() => undefined);
  }, [appId, platform, revision?.flowId]);

  useEffect(() => {
    if (!lastRun || !["pending", "running", "paused"].includes(lastRun.status)) return;
    const timer = window.setInterval(() => {
      void apiFetchJson<{ run: TestRun }>(`/api/script-flow-runs/${encodeURIComponent(lastRun.id)}`)
        .then(async ({ run }) => {
          setLastRun(run);
          const failure = publicExecutionFailureFromRun(run);
          if (failure) setMessage(failure.message);
          if (["pending", "running", "paused"].includes(run.status) || run.sourceSnapshot?.executionPurpose !== "trial") return;
          const summary = await loadLearningSummary(run.id);
          setLearning(summary);
          if (run.status !== "passed" || draft?.status !== "trial_ready") return;
          if (summary.session.status === "needs_outcome_review") {
            setMessage("执行操作已完成，请确认当前业务结果是否符合预期");
            return;
          }
          const reconciled = await reconcileDraftVerification(draft);
          setDraft((current) => current?.status === "trial_ready" && current.sourceYaml === reconciled.sourceYaml ? reconciled : current);
          if (reconciled.status === "ready") setMessage("执行通过，当前版本已验证");
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lastRun?.id, lastRun?.status, draft?.status]);

  async function generate() {
    if (!prompt.trim() || (!revision && !appId.trim())) return;
    try {
      setBusyAction("generate");
      setDraft(undefined);
      setParameterValues({});
      setLastRun(undefined);
      setLearning(undefined);
      setPlan(undefined);
      setSelectedHistoryId(undefined);
      setConfirmedStepKeys(new Set());
      const body = buildAiGenerateRequestBody({
        prompt: prompt.trim(),
        appId: appId.trim(),
        platform,
        revision,
        useCurrentScreen,
        deviceSerial
      });
      const response = await apiFetchJson<{ draft: AiDraft }>("/api/script-flow-drafts/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const nextDraft = response.draft.status === "trial_ready"
        ? await reconcileDraftVerification(response.draft)
        : response.draft;
      setDraft(nextDraft);
      setConfirmedStepKeys(new Set());
      if (nextDraft.status === "ready" || nextDraft.status === "trial_ready") {
        setParameterValues(draftParameterValues(nextDraft));
        setMessage(nextDraft.summary);
      } else if (nextDraft.status === "needs_clarification") {
        setParameterValues({});
        setMessage(nextDraft.clarification);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function saveDraft() {
    if (!generatedDraft) return;
    if (reviewBlocked) {
      setMessage("请先确认所有执行步骤，再保存或执行测试。");
      return;
    }
    try {
      setBusyAction("save");
      const destination = draftSaveDestination(revision, generatedDraft.sourceFlow);
      const response = await apiFetchJson<{ flow: ScriptFlow }>(destination.url, {
        method: destination.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceYaml: generatedDraft.sourceYaml,
          status: trialRequired ? "draft" : "active",
          ...(destination.expectedVersion ? { expectedVersion: destination.expectedVersion } : {})
        })
      });
      setMessage(trialRequired
        ? destination.method === "PUT" ? `已更新草稿：${response.flow.name}` : `已保存草稿：${response.flow.name}`
        : destination.method === "PUT"
          ? `已更新${testKindLabel(generatedDraft.document.kind)} ${response.flow.name} · v${response.flow.version}`
          : `已保存到用例中心：${response.flow.name}`);
      onSaved(response.flow);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function runDraft() {
    if (!generatedDraft) return;
    if (reviewBlocked) {
      setMessage("请先确认所有执行步骤，再保存或执行测试。");
      return;
    }
    await executeDraft(generatedDraft, parameterValues, prompt.trim() || generatedDraft.document.description || generatedDraft.document.name);
  }

  async function executeDraft(
    targetDraft: GeneratedDraft,
    values: Record<string, ScriptParameterValue>,
    sourcePrompt: string
  ) {
    try {
      setBusyAction("run");
      const preview = await apiFetchJson<{ plan: CasePlanView; planDigest: string }>("/api/script-flow-drafts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceYaml: targetDraft.sourceYaml, parameters: values })
      });
      setPlan(preview.plan);
      const androidAppMonitor = androidAppMonitorForApp?.(targetDraft.document.app.id);
      const response = await apiFetchJson<{ run: TestRun }>(draftRunEndpoint(targetDraft.status), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: sourcePrompt,
          sourceYaml: targetDraft.sourceYaml,
          planDigest: preview.planDigest,
          deviceSerial,
          parameters: values,
          recordVideo: false,
          ...(androidAppMonitor ? { androidAppMonitor } : {})
        })
      });
      setLastRun(response.run);
      setLearning(undefined);
      setMessage(`已启动测试：${response.run.id}`);
      if (!revision) setHistory(await refreshHistory(targetDraft.document.app.id, targetDraft.document.app.platform));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function selectTemporaryTest(item: TemporaryTest) {
    const document = readCaseDocument(item.parsed);
    if (!document) {
      setMessage("历史测试快照已损坏，无法加载");
      return;
    }
    try {
      setBusyAction("select");
      const base: GeneratedDraft = {
        status: "trial_ready",
        sourceYaml: item.sourceYaml,
        document,
        parameterValues: item.parameterValues,
        summary: item.prompt,
        assumptions: [],
        channel: "history",
        model: "snapshot"
      };
      const nextDraft = await reconcileDraftVerification(base);
      const values = { ...defaultCaseParameterValues(document), ...item.parameterValues };
      setPrompt(item.prompt);
      setAppId(item.appId);
      setPlatform(item.platform);
      setDraft(nextDraft);
      setParameterValues(values);
      setLastRun(undefined);
      setLearning(undefined);
      setPlan(undefined);
      setSelectedHistoryId(item.id);
      setConfirmedStepKeys(new Set());
      setMessage(`已加载最近测试：${item.name}`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function reviewOutcome(decision: "confirmed" | "rejected") {
    if (!lastRun) return;
    try {
      setBusyAction("review");
      const reviewed = await apiFetchJson<{ session: LearningSession; verification?: FlowVerification }>(
        `/api/trial-runs/${encodeURIComponent(lastRun.id)}/outcome-review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision })
        }
      );
      setLearning((current) => current ? { ...current, ...reviewed } : undefined);
      if (decision === "rejected") {
        setMessage("已标记执行结果不符合预期，本次执行不会用于验证或自动学习");
        return;
      }
      if (draft?.status === "trial_ready") {
        const reconciled = await reconcileDraftVerification(draft);
        setDraft(reconciled);
      }
      setMessage("业务结果已确认，当前测试版本已验证");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  const steps = caseStepViews(generatedDraft?.document);
  const reviewSteps = stepReviewItems(generatedDraft?.document);
  const confirmedStepCount = reviewSteps.filter((step) => confirmedStepKeys.has(step.key)).length;
  const reviewBlocked = Boolean(generatedDraft && reviewSteps.length > 0 && confirmedStepCount < reviewSteps.length);
  const busy = busyAction !== undefined;

  function toggleStepConfirmed(stepKey: string, confirmed: boolean) {
    setConfirmedStepKeys((current) => {
      const next = new Set(current);
      if (confirmed) next.add(stepKey);
      else next.delete(stepKey);
      return next;
    });
  }

  function updateStepLocator(stepKey: string, patch: StepLocatorPatch) {
    if (!generatedDraft) return;
    try {
      const updated = updateDraftStepLocator(generatedDraft, stepKey, patch);
      setDraft(updated);
      setPlan(undefined);
      setConfirmedStepKeys((current) => {
        const next = new Set(current);
        next.delete(stepKey);
        return next;
      });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section className="module-page ai-script-module">
      <header className="ai-script-header">
        <div>
          <h2>{revision ? "修改测试" : "AI 生成测试"}</h2>
          <p>{revision ? `正在修改“${revision.name}”，描述需要调整的业务逻辑。` : "只需描述业务目标，AI 会生成可执行或保存的用例/场景。"}</p>
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
          <label className="screen-assist-toggle">
            <input
              type="checkbox"
              checked={useCurrentScreen}
              disabled={!deviceSerial || busy}
              onChange={(event) => setUseCurrentScreen(event.target.checked)}
            />
            <span>结合当前屏幕生成</span>
            <small>{deviceSerial ? "默认优先使用资产库" : "请选择设备后可用"}</small>
          </label>
          <button className="primary-button ai-script-generate" type="button" onClick={() => void generate()} disabled={busy || !prompt.trim() || (!revision && !appId.trim())}>
            <Sparkles size={17} /><span>{busyAction === "generate" ? "生成中" : revision ? "生成修改方案" : "生成测试"}</span>
          </button>
          {!revision ? <section className="temporary-test-history">
            <header><div><History size={16} /><strong>最近测试</strong></div><span>{history.length} 条</span></header>
            {history.length ? <div className="temporary-test-list">{history.map((item) => <article key={item.id} data-selected={selectedHistoryId === item.id}>
              <button
                className="temporary-test-select"
                type="button"
                aria-pressed={selectedHistoryId === item.id}
                aria-label={`加载测试：${item.name}`}
                onClick={() => void selectTemporaryTest(item)}
                disabled={busy}
              >
                <span className="temporary-test-copy">
                  <span className="temporary-test-title"><span className={`test-purpose-badge ${item.purpose}`}>{testPurposeLabel(item.purpose)}</span><span className={`test-level-badge ${item.testLevel ?? "business_smoke"}`}>{testLevelLabel(item.testLevel)}</span><strong>{item.name}</strong></span>
                  <span className="temporary-test-prompt">{item.prompt}</span>
                  <small>{testKindLabel(item.kind)} · {item.lastRunStatus ? runStatusLabel(item.lastRunStatus) : "已记录"} · 执行 {item.runCount} 次</small>
                </span>
              </button>
              <div className="temporary-test-actions">
                <button type="button" title="查看最近执行结果" aria-label={`查看“${item.name}”的最近执行结果`} onClick={() => onOpenRun(item.lastRunId)}><FileSearch size={15} /></button>
              </div>
            </article>)}</div> : <p className="temporary-test-empty">执行过的临时测试会保留在这里。</p>}
          </section> : null}
        </section>
        <section className="ai-script-result" aria-live="polite">
          {!draft ? <div className="empty"><strong>{revision ? "等待修改说明" : "等待生成"}</strong><span>规划时不会读取或改变当前设备页面。</span></div> : null}
          {draft?.status === "needs_clarification" ? <div className="ai-script-clarification"><strong>需要补充信息</strong><p>{draft.clarification}</p></div> : null}
          {generatedDraft ? <>
            <header><div><span className={`test-kind-badge ${generatedDraft.document.kind}`}>{testKindLabel(generatedDraft.document.kind)}</span><span className={`test-purpose-badge ${generatedDraft.document.purpose ?? "business"}`}>{testPurposeLabel(generatedDraft.document.purpose)}</span><span className={`test-level-badge ${generatedDraft.document.testLevel ?? "business_smoke"}`}>{testLevelLabel(generatedDraft.document.testLevel)}</span><h3>{generatedDraft.document.name}</h3><p>{generatedDraft.summary}</p></div><span>{steps.length} 个步骤</span></header>
            {generatedDraft.assumptions.length ? <div className="ai-script-assumptions"><strong>生成假设</strong>{generatedDraft.assumptions.map((item) => <p key={item}>{item}</p>)}</div> : null}
            <section className="ai-case-logic">
              <header><h3>执行逻辑</h3><span>{steps.length} 个步骤</span></header>
              <ol className="case-step-list">
                {steps.map((step) => <li key={step.id}><span>{step.order}</span><div><strong>{step.name}</strong><small>{step.context ?? step.id}</small></div></li>)}
              </ol>
            </section>
            <StepReviewPanel
              steps={reviewSteps}
              confirmedStepKeys={confirmedStepKeys}
              onConfirm={toggleStepConfirmed}
              onLocatorChange={updateStepLocator}
            />
            {caseCenterEligible(generatedDraft.document) ? <div className="ai-case-actions">
              <button type="button" onClick={() => void saveDraft()} disabled={busy || reviewBlocked}><Save size={16} /><span>{revision ? "保存修改" : generatedDraft.sourceFlow ? "更新用例中心" : "保存到用例中心"}</span></button>
            </div> : <p className="navigation-flow-note">{generatedDraft.document.testLevel === "probe" ? "临时验证默认只保留在最近测试，不进入用例中心。" : "导航流程执行成功后会作为系统内部导航能力复用。"}</p>}
            <ScriptRunForm
              parameters={generatedDraft.document.parameters}
              values={parameterValues}
              devices={devices}
              deviceSerial={deviceSerial}
              busy={busyAction === "run"}
              disabled={reviewBlocked}
              onValueChange={(key, value) => {
                setParameterValues((current) => ({ ...current, [key]: value }));
                setPlan(undefined);
              }}
              onDeviceChange={setDeviceSerial}
              onRun={() => void runDraft()}
              buttonLabel="执行"
            />
            {lastRun ? <section className="script-run-status"><header><h3>执行状态</h3><strong data-status={lastRun.status}>{lastRun.status}</strong></header><p>{lastRun.stepResults.length}/{lastRun.steps.length} 个步骤</p>{lastRunFailure ? <ExecutionFailureNotice failure={lastRunFailure} onOpenReport={() => onOpenRun(lastRun.id)} /> : <button type="button" onClick={() => onOpenRun(lastRun.id)}>查看执行结果</button>}</section> : null}
            {learning ? <TrialOutcomeReview
              session={learning.session}
              busy={busyAction === "review"}
              onReview={(decision) => void reviewOutcome(decision)}
            /> : null}
          </> : null}
        </section>
      </div>
    </section>
  );
}

function StepReviewPanel({
  steps,
  confirmedStepKeys,
  onConfirm,
  onLocatorChange
}: {
  steps: StepReviewItem[];
  confirmedStepKeys: Set<string>;
  onConfirm: (stepKey: string, confirmed: boolean) => void;
  onLocatorChange: (stepKey: string, patch: StepLocatorPatch) => void;
}) {
  const confirmedCount = steps.filter((step) => confirmedStepKeys.has(step.key)).length;
  const blocked = steps.length > 0 && confirmedCount < steps.length;
  return <section className="ai-step-review">
    <header><h3>步骤审查</h3><span>{confirmedCount}/{steps.length} 已确认</span></header>
    {blocked ? <p className="ai-step-review-warning">确认所有步骤后才能执行或保存。</p> : <p className="ai-step-review-ready">所有步骤已确认，可以执行或保存。</p>}
    <ol className="ai-step-review-list">
      {steps.map((step) => <li key={step.key} data-confirmed={confirmedStepKeys.has(step.key)}>
        <div className="ai-step-review-head">
          <label>
            <input
              type="checkbox"
              checked={confirmedStepKeys.has(step.key)}
              onChange={(event) => onConfirm(step.key, event.target.checked)}
            />
            <span>确认步骤 {step.order}：{step.name}</span>
          </label>
          <small>{step.context ?? step.id}</small>
        </div>
        {step.locator ? <StepLocatorEditor stepKey={step.key} locator={step.locator} onChange={onLocatorChange} /> : (
          <p className="ai-step-review-static">此步骤没有元素定位参数。</p>
        )}
      </li>)}
    </ol>
  </section>;
}

function StepLocatorEditor({
  stepKey,
  locator,
  onChange
}: {
  stepKey: string;
  locator: StepLocatorView;
  onChange: (stepKey: string, patch: StepLocatorPatch) => void;
}) {
  return <div className="step-locator-editor">
    <strong>元素定位</strong>
    <div className="step-locator-grid">
      <label>目标类型<select value={locator.targetKind} onChange={(event) => onChange(stepKey, { targetKind: event.target.value as TargetKind })}>
        <option value="text">文字 text</option>
        <option value="semantic">语义 semantic</option>
        <option value="icon">图标 icon</option>
        <option value="control">控件 control</option>
      </select></label>
      <label>目标值{locator.targetKind === "control" ? (
        <select value={locator.targetValue} onChange={(event) => onChange(stepKey, { targetValue: event.target.value })}>
          <option value="textField">textField</option>
          <option value="switch">switch</option>
          <option value="checkbox">checkbox</option>
        </select>
      ) : (
        <input value={locator.targetValue} onChange={(event) => onChange(stepKey, { targetValue: event.target.value })} />
      )}</label>
      <label>区域<select value={locator.area ?? ""} onChange={(event) => onChange(stepKey, { area: event.target.value })}>
        <option value="">自动</option>
        <option value="topBar">topBar</option>
        <option value="content">content</option>
        <option value="bottomBar">bottomBar</option>
      </select></label>
      {locator.usesSearchPolicy ? <label>search.mode<select value={locator.searchMode ?? ""} onChange={(event) => onChange(stepKey, { searchMode: event.target.value })}>
        <option value="">默认</option>
        <option value="auto">auto</option>
        <option value="visibleOnly">visibleOnly</option>
        <option value="scroll">scroll</option>
      </select></label> : null}
      <label>方向<select value={locator.direction ?? ""} onChange={(event) => onChange(stepKey, { direction: event.target.value })}>
        <option value="">默认</option>
        <option value="down">down</option>
        <option value="up">up</option>
        <option value="both">both</option>
      </select></label>
      <label>最大滑动<input type="number" min="1" max="50" value={locator.maxSwipes ?? ""} onChange={(event) => onChange(stepKey, { maxSwipes: event.target.value })} /></label>
      <label>nearText<input value={locator.nearText ?? ""} onChange={(event) => onChange(stepKey, { nearText: event.target.value })} /></label>
      <label>scopeText<input value={locator.scopeText ?? ""} onChange={(event) => onChange(stepKey, { scopeText: event.target.value })} /></label>
      <label>ordinal<input type="number" min="1" value={locator.ordinal ?? ""} onChange={(event) => onChange(stepKey, { ordinal: event.target.value })} /></label>
      <label>checked<select value={locator.checked ?? ""} onChange={(event) => onChange(stepKey, { checked: event.target.value })}>
        <option value="">不指定</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select></label>
    </div>
  </div>;
}

export function ExecutionFailureNotice({
  failure,
  onOpenReport
}: {
  failure: PublicExecutionFailure;
  onOpenReport: () => void;
}) {
  return <div className="execution-failure-notice"><strong>执行未完成</strong><p>{failure.message}</p><button type="button" onClick={onOpenReport}>查看执行结果</button></div>;
}

export function caseCenterEligible(document: Pick<CaseDocumentView, "purpose" | "testLevel"> | undefined): boolean {
  return document?.purpose !== "navigation" && document?.testLevel !== "probe";
}

function runStatusLabel(status: TestRun["status"]): string {
  if (status === "passed") return "已通过";
  if (status === "failed") return "失败";
  if (status === "running" || status === "pending") return "执行中";
  if (status === "stopped") return "已停止";
  return status;
}

async function refreshHistory(appId: string, platform: string): Promise<TemporaryTest[]> {
  const query = new URLSearchParams({ appId, platform, limit: "50" });
  const response = await apiFetchJson<{ tests: TemporaryTest[] }>(`/api/temporary-tests?${query.toString()}`);
  return response.tests;
}

export function draftSaveDestination(
  revision?: CaseRevision,
  sourceFlow?: SavedFlowReference
): { url: string; method: "POST" | "PUT"; expectedVersion?: number } {
  const target = revision
    ? { id: revision.flowId, version: revision.version }
    : sourceFlow;
  return target
    ? {
        url: `/api/script-flows/${encodeURIComponent(target.id)}`,
        method: "PUT",
        expectedVersion: target.version
      }
    : { url: "/api/script-flows", method: "POST" };
}

export function TrialOutcomeReview({
  session,
  busy,
  onReview
}: {
  session: LearningSession;
  busy: boolean;
  onReview: (decision: "confirmed" | "rejected") => void;
}) {
  if (session.status === "needs_outcome_review") {
    return <section className="trial-outcome-review">
      <div><strong>确认执行结果</strong><p>设备操作已完成，当前业务结果是否符合你的测试预期？</p></div>
      <div className="trial-outcome-actions">
        <button type="button" onClick={() => onReview("rejected")} disabled={busy}>不符合预期</button>
        <button className="primary-button" type="button" onClick={() => onReview("confirmed")} disabled={busy}>结果符合预期</button>
      </div>
    </section>;
  }
  if (session.status === "ready") {
    return <section className="trial-outcome-review verified"><strong>执行结果已验证</strong><p>当前测试可以直接执行或保存到用例中心。</p></section>;
  }
  if (session.status === "rejected" || session.status === "invalid") {
    return <section className="trial-outcome-review rejected"><strong>本次执行未通过验证</strong><p>请调整测试描述后重新执行。</p></section>;
  }
  return null;
}

function draftParameterValues(draft: GeneratedDraft | undefined): Record<string, ScriptParameterValue> {
  return {
    ...defaultCaseParameterValues(draft?.document),
    ...(draft?.parameterValues ?? {})
  };
}

export function draftRunEndpoint(status: GeneratedDraft["status"]): string {
  return status === "trial_ready" ? "/api/script-flow-drafts/trial-runs" : "/api/script-flow-drafts/runs";
}

export function stepReviewItems(document: CaseDocumentView | undefined): StepReviewItem[] {
  if (!document) return [];
  const views = caseStepViews(document);
  return flattenStepEntries(document.steps).map((entry, index) => {
    const view = views[index];
    const action = sourceActionName(entry.step);
    return {
      key: reviewStepKey(entry.path, entry.step),
      path: entry.path,
      id: entry.step.id,
      order: view?.order ?? index + 1,
      name: view?.name ?? action,
      action,
      context: view?.context,
      risk: view?.risk ?? "none",
      locator: locatorView(entry.step)
    };
  });
}

export function updateDraftStepLocator(
  draft: GeneratedDraft,
  stepKey: string,
  patch: StepLocatorPatch
): GeneratedDraft {
  const document = cloneCaseDocument(draft.document);
  const step = stepByReviewKey(document.steps, stepKey);
  if (!step) throw new Error("没有找到要编辑的步骤");
  const targetAction = targetActionRecord(step);
  if (!targetAction) throw new Error("当前步骤没有可编辑的元素定位");
  applyLocatorPatch(targetAction, patch);
  const { verification: _verification, ...rest } = draft;
  return {
    ...rest,
    status: "trial_ready",
    document,
    sourceYaml: serializeScriptFlow(document as unknown as ScriptFlowDocument)
  };
}

function flattenStepEntries(
  steps: CaseSourceStep[],
  prefix: number[] = []
): Array<{ path: number[]; step: CaseSourceStep }> {
  return steps.flatMap((step, index) => {
    const path = [...prefix, index];
    const children = nestedSteps(step);
    return children ? [{ path, step }, ...flattenStepEntries(children, path)] : [{ path, step }];
  });
}

function nestedSteps(step: CaseSourceStep): CaseSourceStep[] | undefined {
  const repeat = recordValue(step.repeat);
  const when = recordValue(step.when);
  if (Array.isArray(repeat?.steps)) return repeat.steps as CaseSourceStep[];
  if (Array.isArray(when?.steps)) return when.steps as CaseSourceStep[];
  return undefined;
}

function reviewStepKey(path: number[], step: CaseSourceStep): string {
  return `${path.join(".")}:${step.id}`;
}

function stepByReviewKey(steps: CaseSourceStep[], key: string): CaseSourceStep | undefined {
  const path = key.split(":")[0]?.split(".").map((item) => Number(item));
  if (!path?.length || path.some((item) => !Number.isInteger(item) || item < 0)) return undefined;
  let currentSteps = steps;
  let current: CaseSourceStep | undefined;
  for (const index of path) {
    current = currentSteps[index];
    if (!current) return undefined;
    currentSteps = nestedSteps(current) ?? [];
  }
  return current;
}

function cloneCaseDocument(document: CaseDocumentView): CaseDocumentView {
  return JSON.parse(JSON.stringify(document)) as CaseDocumentView;
}

function sourceActionName(step: CaseSourceStep): string {
  return ["launchApp", "tap", "inputText", "clearText", "selectText", "swipe", "scrollUntilVisible", "reachPage", "waitForPage", "assertPage", "assertText", "runFlow", "repeat", "when"]
    .find((action) => action in step) ?? "unknown";
}

function targetActionRecord(step: CaseSourceStep): { actionName: string; action: Record<string, unknown>; target: Record<string, unknown> } | undefined {
  for (const actionName of ["tap", "inputText", "clearText", "selectText", "scrollUntilVisible"]) {
    const action = recordValue(step[actionName]);
    const target = recordValue(action?.target);
    if (action && target) return { actionName, action, target };
  }
  return undefined;
}

function locatorView(step: CaseSourceStep): StepLocatorView | undefined {
  const targetAction = targetActionRecord(step);
  if (!targetAction) return undefined;
  const primary = primaryTargetValue(targetAction.target);
  const search = recordValue(targetAction.action.search);
  return {
    targetKind: primary.kind,
    targetValue: primary.value,
    usesSearchPolicy: targetAction.actionName !== "scrollUntilVisible",
    ...optionalStringField(targetAction.target.area, "area"),
    ...optionalStringField(targetAction.target.position, "position"),
    ...optionalStringField(targetAction.target.nearText, "nearText"),
    ...optionalStringField(targetAction.target.scopeText, "scopeText"),
    ...(typeof targetAction.target.ordinal === "number" ? { ordinal: String(targetAction.target.ordinal) } : {}),
    ...(typeof targetAction.target.checked === "boolean" ? { checked: String(targetAction.target.checked) } : {}),
    ...optionalStringField(search?.mode, "searchMode"),
    ...optionalStringField(search?.direction ?? targetAction.action.direction, "direction"),
    ...(typeof search?.maxSwipes === "number"
      ? { maxSwipes: String(search.maxSwipes) }
      : typeof targetAction.action.maxSwipes === "number"
        ? { maxSwipes: String(targetAction.action.maxSwipes) }
        : {}),
    ...(typeof search?.resetToTop === "boolean" ? { resetToTop: String(search.resetToTop) } : {}),
    ...optionalStringField(search?.container, "container")
  };
}

function primaryTargetValue(target: Record<string, unknown>): { kind: TargetKind; value: string } {
  if (typeof target.text === "string") return { kind: "text", value: target.text };
  if (typeof target.semantic === "string") return { kind: "semantic", value: target.semantic };
  if (typeof target.icon === "string") return { kind: "icon", value: target.icon };
  if (typeof target.control === "string") return { kind: "control", value: target.control };
  return { kind: "semantic", value: "" };
}

function optionalStringField<K extends keyof StepLocatorView>(
  value: unknown,
  key: K
): Partial<Pick<StepLocatorView, K>> {
  return typeof value === "string" && value ? { [key]: value } as Partial<Pick<StepLocatorView, K>> : {};
}

function applyLocatorPatch(
  targetAction: { actionName: string; action: Record<string, unknown>; target: Record<string, unknown> },
  patch: StepLocatorPatch
): void {
  applyPrimaryTargetPatch(targetAction.target, patch);
  setOptionalString(targetAction.target, "area", patch.area);
  setOptionalString(targetAction.target, "position", patch.position);
  setOptionalString(targetAction.target, "nearText", patch.nearText);
  setOptionalString(targetAction.target, "scopeText", patch.scopeText);
  setOptionalNumber(targetAction.target, "ordinal", patch.ordinal);
  setOptionalBoolean(targetAction.target, "checked", patch.checked);

  if (targetAction.actionName === "scrollUntilVisible") {
    setOptionalString(targetAction.action, "direction", patch.direction);
    setOptionalNumber(targetAction.action, "maxSwipes", patch.maxSwipes);
    return;
  }

  const search = { ...recordValue(targetAction.action.search) };
  setOptionalString(search, "mode", patch.searchMode);
  setOptionalString(search, "direction", patch.direction);
  setOptionalNumber(search, "maxSwipes", patch.maxSwipes);
  setOptionalBoolean(search, "resetToTop", patch.resetToTop);
  setOptionalString(search, "container", patch.container);
  if (Object.keys(search).length) targetAction.action.search = search;
  else delete targetAction.action.search;
}

function applyPrimaryTargetPatch(target: Record<string, unknown>, patch: StepLocatorPatch): void {
  const current = primaryTargetValue(target);
  const kind = patch.targetKind ?? current.kind;
  const value = patch.targetValue ?? (patch.targetKind && patch.targetKind !== current.kind ? defaultTargetValue(kind, current.value) : current.value);
  if (patch.targetKind === undefined && patch.targetValue === undefined) return;
  delete target.text;
  delete target.semantic;
  delete target.icon;
  delete target.control;
  if (value.trim()) target[kind] = value.trim();
}

function defaultTargetValue(kind: TargetKind, currentValue: string): string {
  if (kind === "control") return "textField";
  return currentValue;
}

function setOptionalString(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (value.trim()) target[key] = value.trim();
  else delete target[key];
}

function setOptionalNumber(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (!value.trim()) {
    delete target[key];
    return;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) target[key] = numeric;
}

function setOptionalBoolean(target: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (value === "true") target[key] = true;
  else if (value === "false") target[key] = false;
  else delete target[key];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function buildAiGenerateRequestBody(input: {
  prompt: string;
  appId: string;
  platform: ScriptFlow["platform"];
  revision?: CaseRevision;
  useCurrentScreen: boolean;
  deviceSerial: string;
}): Record<string, unknown> {
  const screenAssist = input.useCurrentScreen && input.deviceSerial
    ? { screenAssist: { mode: "current" as const, deviceSerial: input.deviceSerial } }
    : {};
  return input.revision
    ? {
        prompt: input.prompt,
        flowId: input.revision.flowId,
        expectedVersion: input.revision.version,
        ...screenAssist
      }
    : {
        prompt: input.prompt,
        appId: input.appId,
        platform: input.platform,
        ...screenAssist
      };
}

async function reconcileDraftVerification(draft: GeneratedDraft): Promise<GeneratedDraft> {
  const response = await apiFetchJson<{ verification: ScriptFlowVerificationAssessment }>("/api/script-flow-drafts/verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceYaml: draft.sourceYaml })
  });
  return {
    ...draft,
    status: response.verification.status === "verified" ? "ready" : "trial_ready",
    verification: response.verification
  };
}

async function loadLearningSummary(runId: string): Promise<LearningSummaryResponse> {
  return apiFetchJson<LearningSummaryResponse>(`/api/trial-runs/${encodeURIComponent(runId)}/learning-summary`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
