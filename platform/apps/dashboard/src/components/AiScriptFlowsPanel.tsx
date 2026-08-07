import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  FileSearch,
  FileUp,
  History,
  Link2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  StepForward,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { ApiError, apiFetchJson } from "../api.js";
import {
  ScriptRunForm,
  currentRunIteration,
  runOptionsForExecutionMode,
  type ScriptParameterValue,
  type ScriptRunExecutionMode
} from "./ScriptRunForm.js";
import {
  caseStepViews,
  caseActionLabel,
  defaultCaseParameterValues,
  loopBodyAvailability,
  readCaseDocument,
  testKindLabel,
  testLevelLabel,
  testPurposeLabel,
  type CaseDocumentView,
  type CasePlanView,
  type CaseSourceStep
} from "./case-view.js";
import {
  addDraftFlowReference,
  addDraftStep,
  duplicateDraftStep,
  moveDraftStep,
  removeDraftStep,
  setDraftLoopResetMode,
  updateDraftStep,
  updateDraftStepLocator as updateOrchestratorStepLocator,
  type DraftStepPlacement,
  type DraftStepPatch,
  type EditableStepAction
} from "./script-flow-orchestrator.js";

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

export function draftFromSavedFlow(
  flow: ScriptFlow,
  verification?: ScriptFlowVerificationAssessment
): GeneratedDraft | undefined {
  const document = readCaseDocument(flow.parsed);
  if (!document) return undefined;
  return {
    status: verification?.status === "verified" ? "ready" : "trial_ready",
    sourceYaml: flow.sourceYaml,
    document,
    summary: flow.description || flow.name,
    assumptions: [],
    ...(verification ? { verification } : {}),
    sourceFlow: { id: flow.id, version: flow.version, name: flow.name },
    channel: "manual",
    model: "saved-flow"
  };
}

export function draftFromImportedScript(sourceYaml: string, documentValue: Record<string, unknown>): GeneratedDraft {
  const document = readCaseDocument(documentValue);
  if (!document) {
    throw new Error("脚本文档缺少 app 或 steps，无法进入编排界面");
  }
  return {
    status: "trial_ready",
    sourceYaml,
    document,
    parameterValues: defaultCaseParameterValues(document),
    summary: `已导入脚本：${document.name}`,
    assumptions: [],
    channel: "manual-import",
    model: "scriptflow-yaml"
  };
}

type ClarificationDraft = {
  status: "needs_clarification";
  clarification: string;
  channel: string;
  model: string;
};

type AiDraft = GeneratedDraft | ClarificationDraft;
type CreationMode = "generate" | "import";
type RepairHistoryEntry = {
  runId: string;
  mode: "manual" | "auto";
  summary: string;
};

type LearningSummaryResponse = {
  session: LearningSession;
  verification?: FlowVerification;
};

type TargetKind = "text" | "icon" | "visual" | "control";

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
  phase: "preparation" | "business" | "verification" | "reset";
  source: CaseSourceStep;
  structural: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  locator?: StepLocatorView;
};

export type StepLocatorPatch = Partial<StepLocatorView>;

type LocatorOption = { value: string; label: string };

const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  text: "屏幕文字",
  icon: "图标",
  visual: "视觉目标",
  control: "表单控件"
};

const CONTROL_OPTIONS: LocatorOption[] = [
  { value: "textField", label: "输入框" },
  { value: "switch", label: "开关" },
  { value: "checkbox", label: "复选框" }
];

const AREA_OPTIONS: LocatorOption[] = [
  { value: "", label: "自动判断" },
  { value: "topBar", label: "顶部栏" },
  { value: "content", label: "页面内容" },
  { value: "bottomBar", label: "底部栏" }
];

const SEARCH_MODE_OPTIONS: LocatorOption[] = [
  { value: "", label: "默认查找" },
  { value: "auto", label: "自动滚动查找" },
  { value: "visibleOnly", label: "只在当前屏幕查找" },
  { value: "scroll", label: "滚动查找" }
];

const EDITABLE_ACTIONS: EditableStepAction[] = [
  "launchApp",
  "tap",
  "inputText",
  "clearText",
  "selectText",
  "swipe",
  "scrollUntilVisible",
  "reachPage",
  "waitForPage",
  "assertPage",
  "assertText"
];

const SECTION_ROLE_OPTIONS: LocatorOption[] = [
  { value: "setup", label: "前置准备" },
  { value: "business", label: "业务步骤" },
  { value: "assertion", label: "结果验证" },
  { value: "reset", label: "每轮复位" }
];

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
  onStartNewTest?: () => void;
  revision?: CaseRevision;
  initialDraft?: AiDraft;
  initialHistory?: TemporaryTest[];
  activeRunForDevice?: TestRun;
  androidAppMonitorForApp?: (appId: string) => AndroidAppMonitorConfig | undefined;
};

export function AiScriptFlowsPanel({
  defaultAppId,
  devices,
  selectedSerial,
  setMessage,
  onSaved,
  onOpenRun,
  onStartNewTest,
  revision,
  initialDraft,
  initialHistory = [],
  activeRunForDevice,
  androidAppMonitorForApp
}: AiScriptFlowsPanelProps) {
  const manualEditing = Boolean(revision && initialDraft);
  const [prompt, setPrompt] = useState("");
  const [importSource, setImportSource] = useState("");
  const [creationMode, setCreationMode] = useState<CreationMode>("generate");
  const [appId, setAppId] = useState(defaultAppId);
  const [draft, setDraft] = useState<AiDraft | undefined>(initialDraft);
  const [history, setHistory] = useState<TemporaryTest[]>(initialHistory);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const generatedDraft = draft?.status === "ready" || draft?.status === "trial_ready" ? draft : undefined;
  const trialRequired = generatedDraft?.status === "trial_ready";
  const [parameterValues, setParameterValues] = useState<Record<string, ScriptParameterValue>>(() => draftParameterValues(generatedDraft));
  const [deviceSerial, setDeviceSerial] = useState(selectedSerial);
  const [plan, setPlan] = useState<CasePlanView>();
  const [lastRun, setLastRun] = useState<TestRun | undefined>(() => activeStepTrialRun(activeRunForDevice));
  const [learning, setLearning] = useState<LearningSummaryResponse>();
  const [busyAction, setBusyAction] = useState<"generate" | "import" | "save" | "run" | "review" | "select" | "stepRun" | "runControl" | "repair">();
  const [useCurrentScreen, setUseCurrentScreen] = useState(false);
  const [autoRepairEnabled, setAutoRepairEnabled] = useState(false);
  const [repairHistory, setRepairHistory] = useState<RepairHistoryEntry[]>([]);
  const [repairAttemptRunIds, setRepairAttemptRunIds] = useState<Set<string>>(() => new Set());
  const [executionMode, setExecutionMode] = useState<ScriptRunExecutionMode>("once");
  const [newStepAction, setNewStepAction] = useState<EditableStepAction>("tap");
  const [scriptItemPickerOpen, setScriptItemPickerOpen] = useState(false);
  const [scriptItemPickerMode, setScriptItemPickerMode] = useState<"action" | "flow">("action");
  const [reusableFlowLoading, setReusableFlowLoading] = useState(false);
  const [reusableFlowQuery, setReusableFlowQuery] = useState("");
  const [reusableFlows, setReusableFlows] = useState<ScriptFlow[]>([]);
  const [scriptItemPlacement, setScriptItemPlacement] = useState<DraftStepPlacement>("business");
  const [stepRunContext, setStepRunContext] = useState<{ stepId: string; mode: "single" | "from_here" }>();
  const [confirmedStepKeys, setConfirmedStepKeys] = useState<Set<string>>(() => confirmedKeysForDraft(initialDraft));
  const [expandedStepKeys, setExpandedStepKeys] = useState<Set<string>>(() => new Set());
  const [stepReviewRequired, setStepReviewRequired] = useState(() => draftRequiresStepReview(initialDraft));
  const lastRunFailure = lastRun ? publicExecutionFailureFromRun(lastRun) : undefined;

  useEffect(() => {
    if (selectedSerial) setDeviceSerial(selectedSerial);
  }, [selectedSerial]);

  useEffect(() => {
    if (!scriptItemPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScriptItemPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [scriptItemPickerOpen]);

  useEffect(() => {
    const activeStepRun = activeStepTrialRun(activeRunForDevice);
    if (activeStepRun) setLastRun(activeStepRun);
  }, [activeRunForDevice]);

  useEffect(() => {
    if (revision || !appId.trim()) return;
    void refreshHistory(appId.trim()).then(setHistory).catch(() => undefined);
  }, [appId, revision?.flowId]);

  useEffect(() => {
    if (!lastRun || !["pending", "running", "paused"].includes(lastRun.status)) return;
    const timer = window.setInterval(() => {
      void apiFetchJson<{ run: TestRun }>(`/api/script-flow-runs/${encodeURIComponent(lastRun.id)}`)
        .then(async ({ run }) => {
          setLastRun(run);
          const failure = publicExecutionFailureFromRun(run);
          if (failure) setMessage(failure.message);
          if (!["pending", "running", "paused"].includes(run.status) && run.sourceSnapshot?.executionPurpose === "step_trial") {
            if (run.status === "passed") setMessage("步骤试跑通过，可以确认或继续调整当前脚本");
            return;
          }
          if (["pending", "running", "paused"].includes(run.status) || run.sourceSnapshot?.executionPurpose !== "trial") return;
          const summary = await loadLearningSummary(run.id);
          setLearning(summary);
          if (run.status !== "passed") {
            const terminalFailure = publicExecutionFailureFromRun(run);
            if (
              autoRepairEnabled
              && draft?.status === "trial_ready"
              && terminalFailure
              && repairablePanelFailure(terminalFailure)
              && !repairAttemptRunIds.has(run.id)
            ) {
              setRepairAttemptRunIds((current) => new Set(current).add(run.id));
              void repairDraftFromRun(run, "auto", draft);
            }
            return;
          }
          if (draft?.status !== "trial_ready") return;
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
  }, [lastRun?.id, lastRun?.status, draft?.status, autoRepairEnabled, repairAttemptRunIds]);

  async function generate() {
    if (!prompt.trim() || (!revision && !appId.trim())) return;
    try {
      setBusyAction("generate");
      setDraft(undefined);
      setParameterValues({});
      setLastRun(undefined);
      setStepRunContext(undefined);
      setLearning(undefined);
      setPlan(undefined);
      setSelectedHistoryId(undefined);
      setRepairHistory([]);
      setRepairAttemptRunIds(new Set());
      setConfirmedStepKeys(new Set());
      setExpandedStepKeys(new Set());
      setStepReviewRequired(false);
      setExecutionMode("once");
      const body = buildAiGenerateRequestBody({
        prompt: prompt.trim(),
        appId: appId.trim(),
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
      setConfirmedStepKeys(confirmedKeysForDraft(nextDraft));
      setExpandedStepKeys(new Set());
      if (nextDraft.status === "ready" || nextDraft.status === "trial_ready") {
        setStepReviewRequired(true);
        setParameterValues(draftParameterValues(nextDraft));
        setMessage(nextDraft.summary);
      } else if (nextDraft.status === "needs_clarification") {
        setStepReviewRequired(false);
        setParameterValues({});
        setMessage(nextDraft.clarification);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function importScript() {
    const sourceYaml = importSource.trim();
    if (!sourceYaml || revision) return;
    try {
      setBusyAction("import");
      setDraft(undefined);
      setParameterValues({});
      setLastRun(undefined);
      setStepRunContext(undefined);
      setLearning(undefined);
      setPlan(undefined);
      setSelectedHistoryId(undefined);
      setRepairHistory([]);
      setRepairAttemptRunIds(new Set());
      setConfirmedStepKeys(new Set());
      setExpandedStepKeys(new Set());
      setStepReviewRequired(false);
      setExecutionMode("once");
      const response = await apiFetchJson<{ document: Record<string, unknown> }>("/api/script-flows/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceYaml })
      });
      const imported = draftFromImportedScript(sourceYaml, response.document);
      const nextDraft = await reconcileDraftVerification(imported);
      setPrompt(imported.document.description ?? imported.document.name);
      setAppId(imported.document.app.id);
      setDraft(nextDraft);
      setParameterValues(draftParameterValues(nextDraft));
      setConfirmedStepKeys(confirmedKeysForDraft(nextDraft));
      setExpandedStepKeys(new Set());
      setStepReviewRequired(true);
      setMessage(`已导入脚本：${imported.document.name}`);
    } catch (error) {
      setMessage(scriptImportErrorMessage(error));
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
    if (executionMode === "loop_body" && !loopBodyReady) {
      setMessage(loopBodyUnavailableReason ?? "请先配置每轮复位步骤。");
      return;
    }
    await executeDraft(generatedDraft, parameterValues, prompt.trim() || generatedDraft.document.description || generatedDraft.document.name);
  }

  async function repairDraftFromRun(
    run: TestRun,
    mode: "manual" | "auto",
    baseDraft: GeneratedDraft | undefined = generatedDraft
  ) {
    const failure = publicExecutionFailureFromRun(run);
    if (!baseDraft || !failure) return;
    if (!repairablePanelFailure(failure)) {
      setMessage("当前失败属于 App、设备或环境问题，不应通过修改脚本掩盖。");
      return;
    }
    try {
      setBusyAction("repair");
      const response = await apiFetchJson<{ draft: AiDraft; repair?: { runId?: string } }>("/api/script-flow-drafts/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRepairDraftRequestBody({
          sourceYaml: baseDraft.sourceYaml,
          runId: run.id,
          prompt: prompt.trim() || baseDraft.document.description || baseDraft.document.name,
          appId: baseDraft.document.app.id,
          useCurrentScreen,
          deviceSerial,
          scriptPlatform: run.sourceSnapshot?.executionPlatform
        }))
      });
      const nextDraft = response.draft.status === "trial_ready"
        ? await reconcileDraftVerification(response.draft)
        : response.draft;
      setDraft(nextDraft);
      setPlan(undefined);
      setLearning(undefined);
      if (nextDraft.status === "needs_clarification") {
        setStepReviewRequired(false);
        setMessage(nextDraft.clarification);
        return;
      }
      const nextValues = {
        ...defaultCaseParameterValues(nextDraft.document),
        ...(baseDraft.parameterValues ?? {}),
        ...parameterValues
      };
      setParameterValues(nextValues);
      setConfirmedStepKeys(confirmedKeysForDraft(nextDraft));
      setExpandedStepKeys(new Set());
      setStepReviewRequired(mode === "manual");
      setRepairHistory((current) => [
        ...current,
        {
          runId: run.id,
          mode,
          summary: nextDraft.summary || "已生成修复草稿"
        }
      ]);
      if (mode === "auto") {
        setMessage("已生成修复草稿，正在重新执行。");
        await executeDraft(nextDraft, nextValues, prompt.trim() || nextDraft.document.description || nextDraft.document.name);
      } else {
        setMessage("已生成修复草稿，请确认步骤后重新执行。");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
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
          ...draftRunOptions(executionMode),
          ...(androidAppMonitor ? { androidAppMonitor } : {})
        })
      });
      setLastRun(response.run);
      setLearning(undefined);
      setMessage(`已启动测试：${response.run.id}`);
      if (!revision) setHistory(await refreshHistory(targetDraft.document.app.id));
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
      setDraft(nextDraft);
      setParameterValues(values);
      setLastRun(undefined);
      setStepRunContext(undefined);
      setLearning(undefined);
      setPlan(undefined);
      setSelectedHistoryId(item.id);
      setRepairHistory([]);
      setRepairAttemptRunIds(new Set());
      setConfirmedStepKeys(confirmedKeysForDraft(nextDraft));
      setExpandedStepKeys(new Set());
      setStepReviewRequired(false);
      setExecutionMode("once");
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

  const steps = caseStepViews(generatedDraft?.document, undefined, { parameterValues });
  const reviewSteps = stepReviewItems(generatedDraft?.document, parameterValues);
  const loopReset = loopBodyAvailability(generatedDraft?.document);
  const unconfirmedResetStep = reviewSteps.find((step) => step.phase === "reset" && !confirmedStepKeys.has(step.key));
  const loopBodyReady = loopReset.available && !unconfirmedResetStep;
  const loopBodyUnavailableReason = unconfirmedResetStep
    ? "请先确认所有每轮复位步骤。"
    : loopReset.reason;
  const confirmedStepCount = reviewSteps.filter((step) => confirmedStepKeys.has(step.key)).length;
  const showStepOrchestrator = Boolean(generatedDraft);
  const reviewBlocked = Boolean(generatedDraft && (
    reviewSteps.length === 0 || (stepReviewRequired && confirmedStepCount < reviewSteps.length)
  ));
  const busy = busyAction !== undefined;
  const isStepTrial = lastRun?.sourceSnapshot?.executionPurpose === "step_trial";
  const stepTrialRun = isStepTrial ? lastRun : undefined;
  const trialStatusesEnabled = Boolean(
    stepTrialRun?.sourceSnapshot?.sourceYaml
    && stepTrialRun.sourceSnapshot.sourceYaml === generatedDraft?.sourceYaml
  );
  const stepTrialActive = Boolean(isStepTrial && lastRun && ["pending", "running", "paused"].includes(lastRun.status));
  const continuousRunActive = Boolean(!isStepTrial && lastRun && ["pending", "running", "paused"].includes(lastRun.status));
  const showNewTestAction = Boolean(onStartNewTest && (revision || draft || prompt.trim()));
  const retryStepId = lastRun ? failedScriptStepId(lastRun) : undefined;
  const retryStep = reviewSteps.find((step) => retryStepId === step.id || retryStepId?.startsWith(`${step.id}.`))
    ?? (stepRunContext ? reviewSteps.find((step) => step.id === stepRunContext.stepId) : undefined);

  function toggleStepConfirmed(stepKey: string, confirmed: boolean) {
    setConfirmedStepKeys((current) => {
      const next = new Set(current);
      if (confirmed) next.add(stepKey);
      else next.delete(stepKey);
      return next;
    });
  }

  function toggleStepExpanded(stepKey: string) {
    setExpandedStepKeys((current) => {
      const next = new Set(current);
      if (next.has(stepKey)) next.delete(stepKey);
      else next.add(stepKey);
      return next;
    });
  }

  function updateStepLocator(stepKey: string, patch: StepLocatorPatch) {
    if (!generatedDraft) return;
    try {
      const updated = updateDraftStepLocator(generatedDraft, stepKey, patch);
      setDraft(updated);
      setPlan(undefined);
      setStepReviewRequired(true);
      setConfirmedStepKeys((current) => {
        const next = new Set(current);
        next.delete(stepKey);
        return next;
      });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function updateStep(stepKey: string, patch: DraftStepPatch) {
    if (!generatedDraft) return;
    try {
      setDraft(updateDraftStep(generatedDraft, stepKey, patch));
      markStepEdited(stepKey);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function addActionFromPicker() {
    if (!generatedDraft) return;
    try {
      const added = addDraftStep(generatedDraft, undefined, newStepAction, scriptItemPlacement);
      applyStructuralDraftChange(added.draft, added.stepKey);
      setScriptItemPickerOpen(false);
      setMessage(`已将${caseActionLabel(newStepAction)}添加到${draftStepPlacementLabel(scriptItemPlacement)}`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function openScriptItemPicker() {
    if (!generatedDraft) return;
    setScriptItemPickerOpen(true);
    setScriptItemPickerMode("action");
    setReusableFlowLoading(true);
    setReusableFlowQuery("");
    setScriptItemPlacement("business");
    setNewStepAction("tap");
    try {
      const query = new URLSearchParams({
        appId: generatedDraft.document.app.id,
        status: "active"
      });
      const response = await apiFetchJson<{ flows: ScriptFlow[] }>(`/api/script-flows?${query.toString()}`);
      setReusableFlows(reusableFlowCandidates(response.flows, {
        app: generatedDraft.document.app,
        currentFlowId: revision?.flowId ?? generatedDraft.sourceFlow?.id
      }));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setReusableFlowLoading(false);
    }
  }

  function addReusableFlow(flow: ScriptFlow) {
    if (!generatedDraft) return;
    const document = readCaseDocument(flow.parsed);
    if (!document) {
      setMessage("所选用例脚本无法解析，不能引用");
      return;
    }
    try {
      const added = addDraftFlowReference(generatedDraft, undefined, {
        id: flow.id,
        name: flow.name,
        placement: scriptItemPlacement,
        parameters: document.parameters
      });
      applyStructuralDraftChange(added.draft);
      setParameterValues((current) => ({
        ...defaultCaseParameterValues(added.draft.document),
        ...current
      }));
      setScriptItemPickerOpen(false);
      setMessage(`已将稳定用例“${flow.name}”添加到${draftStepPlacementLabel(scriptItemPlacement)}`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function changeScriptItemPlacement(placement: DraftStepPlacement) {
    setScriptItemPlacement(placement);
    if (!editableActionsForPlacement(placement).includes(newStepAction)) {
      setNewStepAction(defaultActionForPlacement(placement));
    }
  }

  function setNoResetNeeded(checked: boolean) {
    if (!generatedDraft) return;
    try {
      const updated = setDraftLoopResetMode(generatedDraft, checked ? "none" : "unconfigured");
      setDraft(updated);
      setPlan(undefined);
      setStepReviewRequired(true);
      setMessage(checked ? "已声明业务执行后会自然回到下一轮起点" : "已取消无需复位声明");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function duplicateStep(stepKey: string) {
    if (!generatedDraft) return;
    try {
      applyStructuralDraftChange(duplicateDraftStep(generatedDraft, stepKey).draft);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function moveStep(stepKey: string, direction: "up" | "down") {
    if (!generatedDraft) return;
    try {
      applyStructuralDraftChange(moveDraftStep(generatedDraft, stepKey, direction));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function deleteStep(stepKey: string) {
    if (!generatedDraft) return;
    try {
      applyStructuralDraftChange(removeDraftStep(generatedDraft, stepKey));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function markStepEdited(stepKey: string) {
    setPlan(undefined);
    setStepReviewRequired(true);
    setConfirmedStepKeys((current) => {
      const next = new Set(current);
      next.delete(stepKey);
      return next;
    });
  }

  function applyStructuralDraftChange(next: GeneratedDraft, expandedStepKey?: string) {
    setDraft(next);
    setPlan(undefined);
    setStepReviewRequired(true);
    setConfirmedStepKeys(new Set());
    setExpandedStepKeys(expandedStepKey ? new Set([expandedStepKey]) : new Set());
  }

  async function runDraftStep(step: StepReviewItem, mode: "single" | "from_here") {
    if (!generatedDraft || step.structural) return;
    if (!deviceSerial) {
      setMessage("请先选择执行设备");
      return;
    }
    try {
      setBusyAction("stepRun");
      const androidAppMonitor = androidAppMonitorForApp?.(generatedDraft.document.app.id);
      const response = await apiFetchJson<{ run: TestRun }>("/api/script-flow-drafts/step-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildStepRunRequestBody({
          sourceYaml: generatedDraft.sourceYaml,
          deviceSerial,
          parameters: parameterValues,
          stepId: step.id,
          mode,
          androidAppMonitor
        }))
      });
      setLastRun(response.run);
      setLearning(undefined);
      setStepRunContext({ stepId: step.id, mode });
      setMessage(mode === "single" ? `正在试跑步骤 ${step.order}` : `已从步骤 ${step.order} 开始，完成每步后会暂停`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function controlStepRun(action: "step" | "resume" | "stop") {
    if (!lastRun) return;
    try {
      setBusyAction("runControl");
      const response = await apiFetchJson<{ run?: TestRun }>(`/api/runs/${encodeURIComponent(lastRun.id)}/${action}`, {
        method: "POST"
      });
      if (response.run) setLastRun(response.run);
      setMessage(action === "step" ? "正在执行下一步" : action === "resume" ? "已继续执行剩余步骤" : "已停止步骤试跑");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  async function stopCurrentRun() {
    if (!lastRun) return;
    try {
      setBusyAction("runControl");
      const response = await apiFetchJson<{ run?: TestRun }>(`/api/runs/${encodeURIComponent(lastRun.id)}/stop`, {
        method: "POST"
      });
      if (response.run) setLastRun(response.run);
      setMessage("已停止当前执行");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusyAction(undefined);
    }
  }

  return (
    <section className="module-page ai-script-module">
      <header className="ai-script-header">
        <div>
          <h2>{manualEditing ? "编辑测试" : revision ? "AI 调整测试" : "AI 生成测试"}</h2>
          <p>{manualEditing ? `正在编辑“${revision!.name}”，展开步骤后可直接修改。` : revision ? `正在调整“${revision.name}”，描述需要变更的业务逻辑。` : "只需描述业务目标，AI 会生成可执行或保存的用例/场景。"}</p>
        </div>
        {showNewTestAction ? <button
          className="workspace-action-button secondary ai-script-new-test-button"
          type="button"
          onClick={onStartNewTest}
          disabled={busy || continuousRunActive || stepTrialActive}
          title={continuousRunActive || stepTrialActive ? "请先停止当前执行" : "新建测试"}
        ><Plus size={16} /><span>新建测试</span></button> : null}
      </header>
      <div className={`ai-script-layout${manualEditing ? " manual-edit" : ""}`}>
        {!manualEditing ? <section className="ai-script-request">
          {revision ? <>
            <div className="ai-revision-context"><span>当前测试</span><strong>{revision.name}</strong><small>v{revision.version}</small></div>
            <label className="ai-script-prompt">
              <span>描述你想怎样修改这个测试</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：登录成功后增加主页校验，失败时保留截图"
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
            <button className="primary-button ai-script-generate" type="button" onClick={() => void generate()} disabled={busy || !prompt.trim()}>
              <Sparkles size={17} /><span>{busyAction === "generate" ? "生成中" : "生成修改方案"}</span>
            </button>
          </> : <section className="script-creation-panel">
            <header>
              <strong>创建测试</strong>
              <div className="creation-mode-tabs" role="tablist" aria-label="创建测试来源">
                <button type="button" role="tab" aria-selected={creationMode === "generate"} aria-pressed={creationMode === "generate"} onClick={() => setCreationMode("generate")}>
                  <Sparkles size={14} /><span>AI 生成</span>
                </button>
                <button type="button" role="tab" aria-selected={creationMode === "import"} aria-pressed={creationMode === "import"} onClick={() => setCreationMode("import")}>
                  <FileUp size={14} /><span>导入 YAML</span>
                </button>
              </div>
            </header>
            {creationMode === "generate" ? <>
              <div className="form-grid two-columns">
                <label>App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} /></label>
              </div>
              <label className="ai-script-prompt">
                <span>测试目标或操作过程</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="例如：启动 App，进入班级四十二号，打开新建课堂，填写课堂名称但不要发布"
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
              <button className="primary-button ai-script-generate" type="button" onClick={() => void generate()} disabled={busy || !prompt.trim() || !appId.trim()}>
                <Sparkles size={17} /><span>{busyAction === "generate" ? "生成中" : "生成测试"}</span>
              </button>
            </> : <section className="script-import-panel">
              <label>
                <span>ScriptFlow YAML</span>
                <textarea
                  value={importSource}
                  onChange={(event) => setImportSource(event.target.value)}
                  placeholder="粘贴 ScriptFlow v1 YAML"
                />
              </label>
              <button className="primary-button" type="button" onClick={() => void importScript()} disabled={busy || !importSource.trim()}>
                <FileUp size={15} /><span>{busyAction === "import" ? "导入中" : "导入脚本"}</span>
              </button>
            </section>}
          </section>}
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
        </section> : null}
        <section className="ai-script-result" aria-live="polite">
          {stepTrialRun && !generatedDraft ? <StepTrialRunBar
            run={stepTrialRun}
            busy={busyAction === "runControl"}
            onControl={(action) => void controlStepRun(action)}
            onOpenResult={() => onOpenRun(stepTrialRun.id)}
          /> : null}
          {!draft ? <div className="empty"><strong>{revision ? "等待修改说明" : "等待生成"}</strong><span>规划时不会读取或改变当前设备页面。</span></div> : null}
          {draft?.status === "needs_clarification" ? <div className="ai-script-clarification"><strong>需要补充信息</strong><p>{draft.clarification}</p></div> : null}
          {generatedDraft ? <>
            <header>
              <div className="script-workspace-title"><strong>脚本编排</strong><div><span className={`test-kind-badge ${generatedDraft.document.kind}`}>{testKindLabel(generatedDraft.document.kind)}</span><span className={`test-purpose-badge ${generatedDraft.document.purpose ?? "business"}`}>{testPurposeLabel(generatedDraft.document.purpose)}</span><span className={`test-level-badge ${generatedDraft.document.testLevel ?? "business_smoke"}`}>{testLevelLabel(generatedDraft.document.testLevel)}</span></div><h3>{generatedDraft.document.name}</h3></div>
              <div className="ai-script-result-meta">
                <span>{steps.length} 个步骤</span>
                {generatedDraft.assumptions.length ? <AssumptionsHelp assumptions={generatedDraft.assumptions} /> : null}
              </div>
            </header>
            {showStepOrchestrator ? <StepReviewPanel
              steps={reviewSteps}
              startStrategy={generatedDraft.document.start?.strategy}
              loopResetMode={loopReset.mode}
              confirmedStepKeys={confirmedStepKeys}
              expandedStepKeys={expandedStepKeys}
              confirmationRequired={stepReviewRequired}
              deviceAvailable={Boolean(deviceSerial)}
              busy={busy || stepTrialActive}
              trialRun={stepTrialRun}
              trialStatusesEnabled={trialStatusesEnabled}
              runControlBusy={busyAction === "runControl"}
              onConfirm={toggleStepConfirmed}
              onToggleExpanded={toggleStepExpanded}
              onStepChange={updateStep}
              onLocatorChange={updateStepLocator}
              onOpenItemPicker={() => void openScriptItemPicker()}
              onNoResetNeededChange={setNoResetNeeded}
              onDuplicateStep={duplicateStep}
              onMoveStep={moveStep}
              onDeleteStep={deleteStep}
              onRunStep={(step, mode) => void runDraftStep(step, mode)}
              onControlRun={(action) => void controlStepRun(action)}
              onOpenRun={onOpenRun}
              onRetryStep={retryStep ? () => void runDraftStep(retryStep, "single") : undefined}
            /> : null}
            {scriptItemPickerOpen ? <ScriptItemPicker
              flows={reusableFlows}
              query={reusableFlowQuery}
              loading={reusableFlowLoading}
              mode={scriptItemPickerMode}
              placement={scriptItemPlacement}
              action={newStepAction}
              onModeChange={setScriptItemPickerMode}
              onQueryChange={setReusableFlowQuery}
              onPlacementChange={changeScriptItemPlacement}
              onActionChange={setNewStepAction}
              onAddAction={addActionFromPicker}
              onSelectFlow={addReusableFlow}
              onClose={() => setScriptItemPickerOpen(false)}
            /> : null}
            {caseCenterEligible(generatedDraft.document) ? <div className="ai-case-actions">
              <button className="workspace-action-button secondary" type="button" onClick={() => void saveDraft()} disabled={busy || reviewBlocked}><Save size={16} /><span>{revision ? "保存修改" : generatedDraft.sourceFlow ? "更新用例中心" : "保存到用例中心"}</span></button>
            </div> : <p className="navigation-flow-note">{generatedDraft.document.testLevel === "probe" ? "临时验证默认只保留在最近测试，不进入用例中心。" : "导航流程执行成功后会作为系统内部导航能力复用。"}</p>}
            {generatedDraft.status === "trial_ready" ? <label className="auto-repair-toggle">
              <input
                type="checkbox"
                checked={autoRepairEnabled}
                disabled={busy}
                onChange={(event) => setAutoRepairEnabled(event.target.checked)}
              />
              <span>失败后自动修复重试</span>
              <small>仅处理定位、页面识别和结果验证类失败。</small>
            </label> : null}
            {repairHistory.length ? <section className="repair-history" aria-label="修复历史">
              <strong>AI 修复记录</strong>
              {repairHistory.map((item, index) => (
                <p key={`${item.runId}-${index}`}>{item.mode === "auto" ? "自动" : "手动"}修复 run {item.runId}：{item.summary}</p>
              ))}
            </section> : null}
            <ScriptRunForm
              parameters={generatedDraft.document.parameters}
              values={parameterValues}
              devices={devices}
              deviceSerial={deviceSerial}
              busy={busyAction === "run" || busyAction === "runControl"}
              executionMode={executionMode}
              active={continuousRunActive}
              currentIteration={lastRun ? currentRunIteration(lastRun.stepResults) : undefined}
              disabled={reviewBlocked}
              loopBodyAvailable={loopBodyReady}
              loopBodyUnavailableReason={loopBodyUnavailableReason}
              onValueChange={(key, value) => {
                setParameterValues((current) => ({ ...current, [key]: value }));
                setPlan(undefined);
              }}
              onDeviceChange={setDeviceSerial}
              onExecutionModeChange={setExecutionMode}
              onRun={() => void runDraft()}
              onStop={() => void stopCurrentRun()}
              buttonLabel="执行"
            />
            {lastRun && !isStepTrial ? <section className="script-run-status">
              <header><h3>执行状态</h3><strong data-status={lastRun.status}>{runStatusLabel(lastRun.status)}</strong></header>
              {lastRun.config.mode === "loop_until_stop"
                ? <p>第 {currentRunIteration(lastRun.stepResults) || 1} 轮 · 累计执行 {lastRun.stepResults.length} 个步骤</p>
                : <p>{lastRun.stepResults.length}/{lastRun.steps.length} 个步骤</p>}
              {lastRunFailure ? <ExecutionFailureNotice
                failure={lastRunFailure}
                onOpenReport={() => onOpenRun(lastRun.id)}
                onRepair={generatedDraft && repairablePanelFailure(lastRunFailure) ? () => void repairDraftFromRun(lastRun, "manual") : undefined}
                repairBusy={busyAction === "repair"}
              /> : <button type="button" onClick={() => onOpenRun(lastRun.id)}>查看执行结果</button>}
            </section> : null}
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

export function StepTrialRunBar({
  run,
  busy,
  onControl,
  onOpenResult,
  onRetry
}: {
  run: TestRun;
  busy: boolean;
  onControl: (action: "step" | "resume" | "stop") => void;
  onOpenResult: () => void;
  onRetry?: () => void;
}) {
  const active = ["pending", "running", "paused"].includes(run.status);
  return <section className="step-trial-run-bar" aria-label="当前步骤试跑">
    <div className="step-trial-run-copy">
      <span>当前试跑</span>
      <strong>{run.caseName}</strong>
      <small>{run.stepResults.length}/{run.steps.length} 个步骤</small>
    </div>
    <strong className="run-status-badge" data-status={run.status}>{runStatusLabel(run.status)}</strong>
    <div className="step-run-controls">
      {run.status === "paused" ? <>
        <button type="button" onClick={() => onControl("step")} disabled={busy}><StepForward size={15} /><span>执行下一步</span></button>
        <button type="button" onClick={() => onControl("resume")} disabled={busy}><Play size={15} /><span>连续执行</span></button>
      </> : null}
      {active ? <button type="button" onClick={() => onControl("stop")} disabled={busy}><Square size={15} /><span>停止</span></button> : null}
      {run.status === "failed" && onRetry ? <button type="button" onClick={onRetry} disabled={busy}><RotateCcw size={15} /><span>重试失败步骤</span></button> : null}
      <button type="button" onClick={onOpenResult} disabled={busy}><FileSearch size={15} /><span>查看结果</span></button>
    </div>
  </section>;
}

function AssumptionsHelp({ assumptions }: { assumptions: string[] }) {
  return <details className="ai-script-assumptions-help">
    <summary aria-label="查看生成假设" title="生成假设"><CircleHelp size={16} /></summary>
    <div className="ai-script-assumptions-popover" role="tooltip">
      <strong>生成假设</strong>
      <ul>{assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  </details>;
}

export function reusableFlowCandidates(
  flows: ScriptFlow[],
  context: { app: CaseDocumentView["app"]; currentFlowId?: string }
): ScriptFlow[] {
  const flowsById = new Map(flows.map((flow) => [flow.id, flow]));
  return flows.filter((flow) => {
    if (flow.status !== "active" || flow.id === context.currentFlowId) return false;
    if (flow.appId !== context.app.id) return false;
    const document = readCaseDocument(flow.parsed);
    if (!document || document.app.id !== context.app.id) return false;
    if (reusableCoreStepCount(document.steps) === 0) return false;
    return !context.currentFlowId || !referencesFlow(flow, context.currentFlowId, flowsById, new Set());
  });
}

export function ScriptItemPicker({
  flows,
  query,
  loading,
  mode,
  placement,
  action,
  onModeChange,
  onQueryChange,
  onPlacementChange,
  onActionChange,
  onAddAction,
  onSelectFlow,
  onClose
}: {
  flows: ScriptFlow[];
  query: string;
  loading: boolean;
  mode: "action" | "flow";
  placement: DraftStepPlacement;
  action: EditableStepAction;
  onModeChange: (mode: "action" | "flow") => void;
  onQueryChange: (query: string) => void;
  onPlacementChange: (placement: DraftStepPlacement) => void;
  onActionChange: (action: EditableStepAction) => void;
  onAddAction: () => void;
  onSelectFlow: (flow: ScriptFlow) => void;
  onClose: () => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFlows = flows.filter((flow) => !normalizedQuery || [flow.name, flow.description, ...flow.tags]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalizedQuery)));
  const placementLabel = draftStepPlacementLabel(placement);
  const availableActions = editableActionsForPlacement(placement);
  return <div className="reusable-flow-modal-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="reusable-flow-picker script-item-picker" role="dialog" aria-modal="true" aria-labelledby="script-item-picker-title">
      <header>
        <h3 id="script-item-picker-title">添加脚本内容</h3>
        <button type="button" title="关闭" aria-label="关闭添加脚本内容" onClick={onClose}><X size={16} /></button>
      </header>
      <div className="script-item-picker-layout">
        <div className="script-item-picker-main">
          <div className="script-item-picker-controls">
            <label className="script-item-placement-field">
              <span>添加位置</span>
              <select
                aria-label="添加位置"
                value={placement}
                onChange={(event) => onPlacementChange(event.target.value as DraftStepPlacement)}
              >
                <option value="setup">前置准备</option>
                <option value="business">业务步骤</option>
                <option value="assertion">结果验证</option>
                <option value="reset">每轮复位</option>
              </select>
            </label>
            <div className="script-item-source-field">
              <span>内容来源</span>
              <div className="script-item-mode" role="group" aria-label="添加内容类型">
                <button type="button" aria-pressed={mode === "action"} onClick={() => onModeChange("action")}>新建操作</button>
                <button type="button" aria-pressed={mode === "flow"} onClick={() => onModeChange("flow")}>引用已有用例</button>
              </div>
            </div>
          </div>
          {mode === "action" ? <>
            <div className="script-action-list" role="group" aria-label="具体操作步骤">
              {availableActions.map((candidate) => <button
                type="button"
                key={candidate}
                aria-pressed={action === candidate}
                onClick={() => onActionChange(candidate)}
              >{caseActionLabel(candidate)}</button>)}
            </div>
            <footer className="script-item-picker-footer">
              <span>将“{caseActionLabel(action)}”添加到“{placementLabel}”</span>
              <button type="button" onClick={onAddAction}><Plus size={15} /><span>添加到{placementLabel}</span></button>
            </footer>
          </> : <>
            <div className="reusable-flow-toolbar">
              <label>搜索用例<input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} /></label>
              <div
                className="reusable-flow-scope"
                title={`${referencePlacementScope(placement)}；不继承子用例自身的前置准备和每轮复位`}
              ><CircleHelp size={14} /><span>引用规则</span></div>
            </div>
            {loading ? <p className="reusable-flow-empty">正在加载稳定用例</p> : visibleFlows.length ? <div className="reusable-flow-list">
              {visibleFlows.map((flow) => {
                const document = readCaseDocument(flow.parsed)!;
                return <article key={flow.id}>
                  <div className="reusable-flow-copy">
                    <strong>{flow.name}</strong>
                    {flow.description ? <span>{flow.description}</span> : null}
                    <small>v{flow.version} · 核心步骤 {reusableCoreStepCount(document.steps)} · 参数 {Object.keys(document.parameters).length}</small>
                  </div>
                  <button type="button" aria-label={`作为${placementLabel}引用${flow.name}`} onClick={() => onSelectFlow(flow)}><Link2 size={15} /><span>引用</span></button>
                </article>;
              })}
            </div> : <p className="reusable-flow-empty">没有匹配的稳定用例</p>}
          </>}
        </div>
      </div>
    </section>
  </div>;
}

function draftStepPlacementLabel(placement: DraftStepPlacement): string {
  if (placement === "setup") return "前置准备";
  if (placement === "assertion") return "结果验证";
  if (placement === "reset") return "每轮复位";
  return "业务步骤";
}

function referencePlacementScope(placement: DraftStepPlacement): string {
  if (placement === "setup") return "核心步骤将在父用例的前置准备阶段执行";
  if (placement === "assertion") return "核心步骤将在父用例的结果验证阶段执行";
  if (placement === "reset") return "核心步骤将在父用例的每轮复位阶段执行";
  return "引用范围：业务步骤与结果验证";
}

function editableActionsForPlacement(placement: DraftStepPlacement): EditableStepAction[] {
  if (placement === "assertion") return ["waitForPage", "assertPage", "assertText"];
  if (placement === "business") return EDITABLE_ACTIONS.filter((action) => action !== "launchApp"
    && action !== "waitForPage"
    && action !== "assertPage"
    && action !== "assertText");
  return EDITABLE_ACTIONS.filter((action) => action !== "waitForPage" && action !== "assertPage" && action !== "assertText");
}

function defaultActionForPlacement(placement: DraftStepPlacement): EditableStepAction {
  if (placement === "setup") return "launchApp";
  if (placement === "assertion") return "assertText";
  return "tap";
}

function reusableCoreStepCount(steps: CaseSourceStep[]): number {
  return steps.reduce((count, step) => {
    if (!isReusableCoreSourceStep(step)) return count;
    const children = nestedSteps(step);
    return count + (children ? reusableCoreStepCount(children) : 1);
  }, 0);
}

function isReusableCoreSourceStep(step: CaseSourceStep): boolean {
  return step.role !== "setup"
    && step.role !== "recovery"
    && step.role !== "reset"
    && !("launchApp" in step);
}

function referencesFlow(
  flow: ScriptFlow,
  targetFlowId: string,
  flowsById: Map<string, ScriptFlow>,
  visited: Set<string>
): boolean {
  if (visited.has(flow.id)) return false;
  visited.add(flow.id);
  const document = readCaseDocument(flow.parsed);
  if (!document) return false;
  for (const referenceId of reusableCoreReferenceIds(document.steps)) {
    if (referenceId === targetFlowId) return true;
    const referenced = flowsById.get(referenceId);
    if (referenced && referencesFlow(referenced, targetFlowId, flowsById, visited)) return true;
  }
  return false;
}

function reusableCoreReferenceIds(steps: CaseSourceStep[]): string[] {
  return steps.flatMap((step) => {
    if (!isReusableCoreSourceStep(step)) return [];
    const children = nestedSteps(step);
    if (children) return reusableCoreReferenceIds(children);
    return typeof step.runFlow === "string" ? [step.runFlow] : [];
  });
}

function StepReviewPanel({
  steps,
  startStrategy,
  loopResetMode,
  confirmedStepKeys,
  expandedStepKeys,
  confirmationRequired,
  deviceAvailable,
  busy,
  trialRun,
  trialStatusesEnabled,
  runControlBusy,
  onConfirm,
  onToggleExpanded,
  onStepChange,
  onLocatorChange,
  onOpenItemPicker,
  onNoResetNeededChange,
  onDuplicateStep,
  onMoveStep,
  onDeleteStep,
  onRunStep,
  onControlRun,
  onOpenRun,
  onRetryStep
}: {
  steps: StepReviewItem[];
  startStrategy?: NonNullable<CaseDocumentView["start"]>["strategy"];
  loopResetMode: "steps" | "none" | "unconfigured";
  confirmedStepKeys: Set<string>;
  expandedStepKeys: Set<string>;
  confirmationRequired: boolean;
  deviceAvailable: boolean;
  busy: boolean;
  trialRun?: TestRun;
  trialStatusesEnabled: boolean;
  runControlBusy: boolean;
  onConfirm: (stepKey: string, confirmed: boolean) => void;
  onToggleExpanded: (stepKey: string) => void;
  onStepChange: (stepKey: string, patch: DraftStepPatch) => void;
  onLocatorChange: (stepKey: string, patch: StepLocatorPatch) => void;
  onOpenItemPicker: () => void;
  onNoResetNeededChange: (checked: boolean) => void;
  onDuplicateStep: (stepKey: string) => void;
  onMoveStep: (stepKey: string, direction: "up" | "down") => void;
  onDeleteStep: (stepKey: string) => void;
  onRunStep: (step: StepReviewItem, mode: "single" | "from_here") => void;
  onControlRun: (action: "step" | "resume" | "stop") => void;
  onOpenRun: (runId: string) => void;
  onRetryStep?: () => void;
}) {
  const confirmedCount = steps.filter((step) => confirmedStepKeys.has(step.key)).length;
  const empty = steps.length === 0;
  const blocked = confirmationRequired && steps.length > 0 && confirmedCount < steps.length;
  const sections = stepReviewSections(steps);
  const displayedStartStrategy = startStrategy === "launchApp" && steps.some((step) => step.phase === "preparation" && step.action === "launchApp")
    ? undefined
    : startStrategy;
  return <section className="ai-step-review">
    <header>
      <div><h3>脚本编排</h3><span>{confirmationRequired ? `${confirmedCount}/${steps.length} 已确认` : "已有执行记录"}</span></div>
      <div className="orchestrator-add-step">
        <button className="workspace-action-button secondary" type="button" onClick={onOpenItemPicker} disabled={busy}><Plus size={15} /><span>添加</span></button>
      </div>
    </header>
    {trialRun ? <StepTrialRunBar
      run={trialRun}
      busy={runControlBusy}
      onControl={onControlRun}
      onOpenResult={() => onOpenRun(trialRun.id)}
      onRetry={onRetryStep}
    /> : null}
    {empty ? <p className="ai-step-review-warning">请至少添加一个步骤，才能执行或保存。</p> : blocked ? <p className="ai-step-review-warning">确认所有步骤后才能执行或保存。</p> : confirmationRequired
      ? <p className="ai-step-review-ready">所有步骤已确认，可以执行或保存。</p>
      : <p className="ai-step-review-ready">当前脚本已有执行记录；编辑后需要重新确认。</p>}
    <div className="ai-step-review-sections">
      {sections.map((section) => <section className="ai-step-review-section" key={section.id} aria-labelledby={`step-section-${section.id}`}>
        <header className="ai-step-review-section-head">
          <h4 id={`step-section-${section.id}`}>{section.title}</h4>
          <div>
            <span>{section.steps.length} 项</span>
          </div>
        </header>
        {section.id === "preparation" && displayedStartStrategy ? <p className="legacy-start-strategy">启动策略：{startStrategyLabel(displayedStartStrategy)}</p> : null}
        {section.id === "reset" ? <label className="loop-reset-none">
          <input
            type="checkbox"
            checked={loopResetMode === "none"}
            disabled={busy || section.steps.length > 0}
            onChange={(event) => onNoResetNeededChange(event.target.checked)}
          />
          <span>业务执行后已回到起点，无需复位</span>
        </label> : null}
        {section.steps.length ? <ol className="ai-step-review-list">
          {section.steps.map((step) => {
        const expanded = expandedStepKeys.has(step.key);
        const trialStatus = trialRun && trialStatusesEnabled ? stepTrialStatusForStep(trialRun, step.id) : undefined;
        return <li
          key={step.key}
          data-confirmed={confirmedStepKeys.has(step.key)}
          data-expanded={expanded}
          data-structural={step.structural}
          style={{ marginLeft: `${Math.min(3, Math.max(0, step.path.length - 1)) * 16}px` }}
        >
          <div className="ai-step-review-head">
            <div className="ai-step-review-title">
              <label>
                <input
                  type="checkbox"
                  checked={confirmedStepKeys.has(step.key)}
                  onChange={(event) => onConfirm(step.key, event.target.checked)}
                />
                <span>确认步骤 {step.order}：{step.name}</span>
              </label>
              {trialStatus ? <span className="step-trial-status" data-status={trialStatus}>{stepTrialStatusLabel(trialStatus)}</span> : null}
            </div>
            <div className="orchestrator-step-tools">
              {expanded ? <>
                <button type="button" title="上移" aria-label={`上移步骤 ${step.order}`} onClick={() => onMoveStep(step.key, "up")} disabled={busy || !step.canMoveUp}><ArrowUp size={14} /></button>
                <button type="button" title="下移" aria-label={`下移步骤 ${step.order}`} onClick={() => onMoveStep(step.key, "down")} disabled={busy || !step.canMoveDown}><ArrowDown size={14} /></button>
                <button type="button" title="复制" aria-label={`复制步骤 ${step.order}`} onClick={() => onDuplicateStep(step.key)} disabled={busy}><Copy size={14} /></button>
                <button type="button" title="删除" aria-label={`删除步骤 ${step.order}`} onClick={() => onDeleteStep(step.key)} disabled={busy}><Trash2 size={14} /></button>
              </> : null}
              <button
                type="button"
                className="orchestrator-step-toggle"
                title={expanded ? "收起" : "展开"}
                aria-label={`${expanded ? "收起" : "展开"}步骤 ${step.order}`}
                aria-expanded={expanded}
                onClick={() => onToggleExpanded(step.key)}
              >
                {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
          </div>
          {expanded ? <>
            <small className="orchestrator-step-context">{step.context ?? step.id}</small>
            <StepActionEditor step={step} onChange={onStepChange} />
            {step.locator ? <StepLocatorEditor stepKey={step.key} locator={step.locator} onChange={onLocatorChange} /> : step.structural
              ? <p className="ai-step-review-static">结构步骤由内部步骤组成，请在下方逐步调整。</p>
              : <p className="ai-step-review-static">此动作不需要元素定位参数。</p>}
            <div className="orchestrator-step-run-actions">
              <button type="button" aria-label={`试跑第 ${step.order} 步`} onClick={() => onRunStep(step, "single")} disabled={busy || !deviceAvailable || step.structural}><Play size={14} /><span>试跑此步</span></button>
              <button type="button" aria-label={`从第 ${step.order} 步开始试跑`} onClick={() => onRunStep(step, "from_here")} disabled={busy || !deviceAvailable || step.structural}><StepForward size={14} /><span>从此处试跑</span></button>
            </div>
          </> : null}
        </li>;
          })}
        </ol> : section.id === "preparation" && displayedStartStrategy
          ? null
          : section.id === "reset" && loopResetMode === "none"
            ? <p className="ai-step-review-section-empty">已明确无需复位，可以循环业务与验证。</p>
            : <p className="ai-step-review-section-empty">{section.emptyText}</p>}
      </section>)}
    </div>
  </section>;
}

function stepReviewSections(steps: StepReviewItem[]) {
  const definitions = [
    { id: "preparation" as const, title: "前置准备", emptyText: "无前置准备，执行时依赖当前设备状态" },
    { id: "business" as const, title: "业务步骤", emptyText: "请至少添加一个业务步骤" },
    { id: "verification" as const, title: "结果验证", emptyText: "未设置结果验证，执行完成后需要人工确认" },
    { id: "reset" as const, title: "每轮复位", emptyText: "请先配置每轮复位步骤，或明确业务执行后已回到循环起点。" }
  ];
  return definitions.map((definition) => ({
    ...definition,
    steps: steps.filter((step) => step.phase === definition.id)
  }));
}

function startStrategyLabel(strategy: NonNullable<CaseDocumentView["start"]>["strategy"]): string {
  const labels: Record<NonNullable<CaseDocumentView["start"]>["strategy"], string> = {
    keepCurrent: "保持当前设备状态",
    goHome: "返回系统桌面",
    launchApp: "重启 App",
    restartApp: "重启 App",
    clearDataAndLaunch: "清除应用数据并启动 App"
  };
  return labels[strategy];
}

function StepActionEditor({
  step,
  onChange
}: {
  step: StepReviewItem;
  onChange: (stepKey: string, patch: DraftStepPatch) => void;
}) {
  const role = roleForReviewPhase(step.phase);
  return <div className="step-action-editor">
    <div className="step-action-grid">
      <label>步骤名称<input value={typeof step.source.name === "string" ? step.source.name : ""} placeholder={step.name} onChange={(event) => onChange(step.key, { name: event.target.value })} /></label>
      {step.structural || step.action === "runFlow" ? <label>动作类型<input value={caseActionLabel(step.action)} disabled /></label> : <label>动作类型<select value={step.action} onChange={(event) => onChange(step.key, { action: event.target.value as EditableStepAction })}>
        {editableActionsForPlacement(role).map((action) => <option key={action} value={action}>{caseActionLabel(action)}</option>)}
      </select></label>}
      {step.action === "runFlow"
        ? <label>所属部分<input value={draftStepPlacementLabel(role)} disabled /></label>
        : <label>所属部分<select value={role} onChange={(event) => onChange(step.key, { role: event.target.value })}>
            {SECTION_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>}
      <StepActionFields step={step} onChange={onChange} />
    </div>
  </div>;
}

function StepActionFields({
  step,
  onChange
}: {
  step: StepReviewItem;
  onChange: (stepKey: string, patch: DraftStepPatch) => void;
}) {
  const action = step.action;
  if (action === "runFlow") {
    return <>
      <label>引用标识<input value={typeof step.source.runFlow === "string" ? step.source.runFlow : ""} disabled /></label>
      <label>引用范围<input value={referencePlacementScope(roleForReviewPhase(step.phase))} disabled /></label>
    </>;
  }
  const value = stepActionValue(step.source, action);
  if (action === "inputText" || action === "selectText") {
    return <label>{action === "inputText" ? "输入内容" : "选择内容"}<input value={value} onChange={(event) => onChange(step.key, { value: event.target.value })} /></label>;
  }
  if (action === "assertText") {
    return <>
      <label>预期文字<input value={value} onChange={(event) => onChange(step.key, { value: event.target.value })} /></label>
      <label>匹配方式<select value={stepActionMatch(step.source)} onChange={(event) => onChange(step.key, { match: event.target.value })}><option value="contains">包含文本</option><option value="exact">整屏文本完全一致</option></select></label>
    </>;
  }
  if (action === "reachPage" || action === "waitForPage" || action === "assertPage") {
    return <label>页面标识<input value={stepActionPage(step.source, action)} onChange={(event) => onChange(step.key, { page: event.target.value })} /></label>;
  }
  if (action === "swipe") {
    return <>
      <label>滑动方向<select value={stepActionDirection(step.source, action)} onChange={(event) => onChange(step.key, { direction: event.target.value })}><option value="up">向上</option><option value="down">向下</option><option value="left">向左</option><option value="right">向右</option></select></label>
      <label>滑动距离<input type="number" min="0.1" max="1" step="0.1" value={stepActionDistance(step.source)} onChange={(event) => onChange(step.key, { distance: event.target.value })} /></label>
    </>;
  }
  if (action === "scrollUntilVisible") {
    return <label>滚动方向<select value={stepActionDirection(step.source, action)} onChange={(event) => onChange(step.key, { direction: event.target.value })}><option value="down">向下</option><option value="up">向上</option></select></label>;
  }
  return null;
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
  const targetValueLabel = locatorTargetValueLabel(locator.targetKind);
  return <div className="step-locator-editor">
    <div className="step-locator-summary">
      <span>这一步会操作</span>
      <strong>{locatorTargetSummary(locator)}</strong>
      <small>{locatorSearchSummary(locator)}</small>
    </div>
    <div className="step-locator-grid">
      <label>定位方式<select value={locator.targetKind} onChange={(event) => onChange(stepKey, { targetKind: event.target.value as TargetKind })}>
        {(Object.keys(TARGET_KIND_LABELS) as TargetKind[]).map((kind) => <option key={kind} value={kind}>{TARGET_KIND_LABELS[kind]}</option>)}
      </select></label>
      {locator.targetKind === "control" ? <label>控件类型<select value={locator.targetValue} onChange={(event) => onChange(stepKey, { targetValue: event.target.value })}>
        {CONTROL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label> : <label>{targetValueLabel}<input value={locator.targetValue} onChange={(event) => onChange(stepKey, { targetValue: event.target.value })} /></label>}
      <label>页面区域<select value={locator.targetKind === "control" ? "content" : locator.area ?? ""} onChange={(event) => onChange(stepKey, { area: event.target.value })} disabled={locator.targetKind === "control"}>
        {AREA_OPTIONS.map((option) => <option key={option.value || "auto"} value={option.value}>{option.label}</option>)}
      </select></label>
      {locator.usesSearchPolicy ? <label>查找方式<select value={locator.searchMode ?? ""} onChange={(event) => onChange(stepKey, { searchMode: event.target.value })}>
        {SEARCH_MODE_OPTIONS.map((option) => <option key={option.value || "default"} value={option.value}>{option.label}</option>)}
      </select></label> : null}
      <label>相邻文字<input value={locator.nearText ?? ""} onChange={(event) => onChange(stepKey, { nearText: event.target.value })} /></label>
      <label>限定文字<input value={locator.scopeText ?? ""} onChange={(event) => onChange(stepKey, { scopeText: event.target.value })} /></label>
      <label>匹配序号<input type="number" min="1" value={locator.ordinal ?? ""} onChange={(event) => onChange(stepKey, { ordinal: event.target.value })} /></label>
      {locator.targetKind === "control" && locator.targetValue === "switch" ? <label>选中状态<select value={locator.checked ?? "false"} onChange={(event) => onChange(stepKey, { checked: event.target.value })}><option value="true">已选中</option><option value="false">未选中</option></select></label> : null}
      {locator.targetKind === "icon" || locator.targetKind === "visual" ? <label>相对位置<select value={locator.position ?? ""} onChange={(event) => onChange(stepKey, { position: event.target.value })}><option value="">自动</option><option value="leading">前侧</option><option value="trailing">后侧</option></select></label> : null}
      {locator.usesSearchPolicy ? <>
        <label>滚动方向<select value={locator.direction ?? ""} onChange={(event) => onChange(stepKey, { direction: event.target.value })}><option value="">自动</option><option value="down">向下</option><option value="up">向上</option><option value="both">双向</option></select></label>
        <label>最多滑动次数<input type="number" min="1" value={locator.maxSwipes ?? ""} onChange={(event) => onChange(stepKey, { maxSwipes: event.target.value })} /></label>
        <label>滚动起点<select value={locator.resetToTop ?? ""} onChange={(event) => onChange(stepKey, { resetToTop: event.target.value })}><option value="">自动</option><option value="true">先回到顶部</option><option value="false">保持当前位置</option></select></label>
        <label>查找容器<select value={locator.container ?? ""} onChange={(event) => onChange(stepKey, { container: event.target.value })}><option value="">默认</option><option value="content">页面内容</option></select></label>
      </> : <label>最多滑动次数<input type="number" min="1" value={locator.maxSwipes ?? ""} onChange={(event) => onChange(stepKey, { maxSwipes: event.target.value })} /></label>}
    </div>
  </div>;
}

function locatorTargetSummary(locator: StepLocatorView): string {
  const kind = targetKindLabel(locator.targetKind);
  const value = locator.targetKind === "control" ? controlLabel(locator.targetValue) : locator.targetValue.trim();
  return value ? `${kind}“${value}”` : kind;
}

function locatorSearchSummary(locator: StepLocatorView): string {
  const parts = [
    `区域：${optionLabel(AREA_OPTIONS, locator.area)}`,
    locator.usesSearchPolicy ? `查找：${optionLabel(SEARCH_MODE_OPTIONS, locator.searchMode)}` : undefined
  ].filter(Boolean);
  return parts.join(" · ");
}

function locatorTargetValueLabel(kind: TargetKind): string {
  if (kind === "text") return "屏幕上的文字";
  if (kind === "icon") return "图标描述";
  if (kind === "visual") return "视觉目标描述";
  return "控件类型";
}

function targetKindLabel(kind: TargetKind): string {
  return TARGET_KIND_LABELS[kind];
}

function controlLabel(value: string | undefined): string {
  return optionLabel(CONTROL_OPTIONS, value);
}

function optionLabel(options: LocatorOption[], value: string | undefined): string {
  return options.find((option) => option.value === (value ?? ""))?.label ?? (value?.trim() || "默认");
}

function roleForReviewPhase(phase: StepReviewItem["phase"]): "setup" | "business" | "assertion" | "reset" {
  if (phase === "preparation") return "setup";
  if (phase === "verification") return "assertion";
  if (phase === "reset") return "reset";
  return "business";
}

function stepActionValue(step: CaseSourceStep, action: string): string {
  const record = action === "inputText"
    ? recordValue(step.inputText)
    : action === "selectText"
      ? recordValue(step.selectText)
      : action === "assertText"
        ? recordValue(step.assertText)
        : undefined;
  const value = action === "assertText" ? record?.text : record?.value;
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function stepActionPage(step: CaseSourceStep, action: string): string {
  if (action === "reachPage") {
    const value = recordValue(step.reachPage)?.page;
    return typeof value === "string" ? value : "";
  }
  const value = action === "waitForPage" ? step.waitForPage : step.assertPage;
  return typeof value === "string" ? value : "";
}

function stepActionDirection(step: CaseSourceStep, action: string): string {
  const record = action === "swipe" ? recordValue(step.swipe) : recordValue(step.scrollUntilVisible);
  return typeof record?.direction === "string" ? record.direction : action === "swipe" ? "up" : "down";
}

function stepActionDistance(step: CaseSourceStep): string {
  const value = recordValue(step.swipe)?.distance;
  return typeof value === "number" ? String(value) : "";
}

function stepActionMatch(step: CaseSourceStep): string {
  return recordValue(step.assertText)?.match === "exact" ? "exact" : "contains";
}

export function ExecutionFailureNotice({
  failure,
  onOpenReport,
  onRepair,
  repairBusy
}: {
  failure: PublicExecutionFailure;
  onOpenReport: () => void;
  onRepair?: () => void;
  repairBusy?: boolean;
}) {
  return (
    <div className="execution-failure-notice">
      <strong>执行未完成</strong>
      <p>{failure.message}</p>
      {!!failure.details?.length && (
        <dl className="execution-failure-details">
          {failure.details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="execution-failure-actions">
        {onRepair ? <button type="button" onClick={onRepair} disabled={repairBusy}>
          <Sparkles size={14} /><span>{repairBusy ? "修复中" : "AI 诊断修复"}</span>
        </button> : null}
        <button type="button" onClick={onOpenReport}>查看执行结果</button>
      </div>
    </div>
  );
}

export function caseCenterEligible(document: Pick<CaseDocumentView, "purpose" | "testLevel"> | undefined): boolean {
  return document?.purpose !== "navigation" && document?.testLevel !== "probe";
}

function repairablePanelFailure(failure: PublicExecutionFailure): boolean {
  return failure.kind !== "app_failure" && failure.kind !== "infrastructure_failure" && failure.kind !== "left_target_app";
}

type StepTrialStatus = "running" | "passed" | "paused" | "failed" | "stopped";

function activeStepTrialRun(run: TestRun | undefined): TestRun | undefined {
  return run?.sourceSnapshot?.executionPurpose === "step_trial" ? run : undefined;
}

export function stepTrialStatusForStep(run: TestRun, scriptStepId: string): StepTrialStatus | undefined {
  const plannedSteps = run.steps.filter((step) => {
    const actionStepId = actionScriptStepId(step);
    return actionStepId === scriptStepId || actionStepId?.startsWith(`${scriptStepId}.`);
  });
  if (!plannedSteps.length) return undefined;

  const plannedActionIds = new Set(plannedSteps.map((step) => step.id));
  const results = run.stepResults.filter((result) => plannedActionIds.has(result.stepId));
  if (results.some((result) => result.status === "failed" || result.status === "timeout")) return "failed";
  if (results.some((result) => result.status === "running" || result.status === "pending")) return "running";

  const completedActionIds = new Set(run.stepResults
    .filter((result) => ["passed", "failed", "skipped", "timeout"].includes(result.status))
    .map((result) => result.stepId));
  const allPassed = plannedSteps.every((step) => run.stepResults.some((result) => (
    result.stepId === step.id && (result.status === "passed" || result.status === "skipped")
  )));
  if (allPassed) return "passed";

  const currentAction = run.steps.find((step) => !completedActionIds.has(step.id));
  if (!currentAction || actionScriptStepId(currentAction) !== scriptStepId) return undefined;
  if (run.status === "paused") return "paused";
  if (run.status === "pending" || run.status === "running") return "running";
  if (run.status === "stopped") return "stopped";
  if (run.status === "failed" || run.status === "timeout" || run.status === "device_lost") return "failed";
  return undefined;
}

function failedScriptStepId(run: TestRun): string | undefined {
  const failed = run.stepResults.find((result) => result.status === "failed" || result.status === "timeout");
  const action = failed ? run.steps.find((step) => step.id === failed.stepId) : undefined;
  return action ? actionScriptStepId(action) : undefined;
}

function actionScriptStepId(step: TestRun["steps"][number]): string | undefined {
  const scriptStepId = step.params.scriptStepId;
  return typeof scriptStepId === "string" ? scriptStepId : step.id;
}

function stepTrialStatusLabel(status: StepTrialStatus): string {
  if (status === "running") return "执行中";
  if (status === "passed") return "已通过";
  if (status === "paused") return "已暂停";
  if (status === "failed") return "失败";
  return "已停止";
}

function runStatusLabel(status: TestRun["status"]): string {
  if (status === "passed") return "已通过";
  if (status === "failed") return "失败";
  if (status === "running" || status === "pending") return "执行中";
  if (status === "paused") return "已暂停";
  if (status === "stopped") return "已停止";
  if (status === "timeout") return "超时";
  return "设备已断开";
}

async function refreshHistory(appId: string): Promise<TemporaryTest[]> {
  const query = new URLSearchParams({ appId, limit: "50" });
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

function confirmedKeysForDraft(draft: AiDraft | undefined): Set<string> {
  if (draft?.status !== "ready" && draft?.status !== "trial_ready") return new Set();
  return new Set(stepReviewItems(draft.document).map((step) => step.key));
}

function draftRequiresStepReview(draft: AiDraft | undefined): boolean {
  return (draft?.status === "ready" || draft?.status === "trial_ready") && draft.channel !== "history";
}

export function draftRunEndpoint(status: GeneratedDraft["status"]): string {
  return status === "trial_ready" ? "/api/script-flow-drafts/trial-runs" : "/api/script-flow-drafts/runs";
}

export function draftRunOptions(executionMode: ScriptRunExecutionMode): ReturnType<typeof runOptionsForExecutionMode> {
  return runOptionsForExecutionMode(executionMode);
}

export function stepReviewItems(
  document: CaseDocumentView | undefined,
  parameterValues: Record<string, ScriptParameterValue> = {}
): StepReviewItem[] {
  if (!document) return [];
  const views = caseStepViews(document, undefined, { parameterValues });
  return flattenStepEntries(document.steps).map((entry, index) => {
    const view = views[index];
    const action = sourceActionName(entry.step);
    const siblings = stepSiblingsAtPath(document.steps, entry.path);
    return {
      key: reviewStepKey(entry.path, entry.step),
      path: entry.path,
      id: entry.step.id,
      order: view?.order ?? index + 1,
      name: view?.name ?? action,
      action,
      context: view?.context,
      phase: reviewPhase(entry.step, action),
      source: entry.step,
      structural: action !== "runFlow" && !EDITABLE_ACTIONS.includes(action as EditableStepAction),
      canMoveUp: entry.path.at(-1)! > 0,
      canMoveDown: entry.path.at(-1)! < siblings.length - 1,
      locator: locatorView(entry.step)
    };
  });
}

function reviewPhase(step: CaseSourceStep, action: string): StepReviewItem["phase"] {
  if (step.role === "reset") return "reset";
  if (step.role === "setup" || step.role === "recovery" || action === "launchApp") return "preparation";
  if (step.role === "assertion" || step.role === "cleanup" || action === "assertPage" || action === "assertText" || action === "waitForPage") {
    return "verification";
  }
  return "business";
}

function stepSiblingsAtPath(steps: CaseSourceStep[], path: number[]): CaseSourceStep[] {
  let siblings = steps;
  for (const index of path.slice(0, -1)) {
    const parent = siblings[index];
    if (!parent) return [];
    siblings = nestedSteps(parent) ?? [];
  }
  return siblings;
}

export function updateDraftStepLocator(
  draft: GeneratedDraft,
  stepKey: string,
  patch: StepLocatorPatch
): GeneratedDraft {
  return updateOrchestratorStepLocator(draft, stepKey, patch);
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
  if (typeof target.icon === "string") return { kind: "icon", value: target.icon };
  const visual = recordValue(target.visual);
  if (typeof visual?.query === "string") return { kind: "visual", value: visual.query };
  if (typeof target.control === "string") return { kind: "control", value: target.control };
  return { kind: "text", value: "" };
}

function optionalStringField<K extends keyof StepLocatorView>(
  value: unknown,
  key: K
): Partial<Pick<StepLocatorView, K>> {
  return typeof value === "string" && value ? { [key]: value } as Partial<Pick<StepLocatorView, K>> : {};
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function buildAiGenerateRequestBody(input: {
  prompt: string;
  appId: string;
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
        ...screenAssist
      };
}

export function buildRepairDraftRequestBody(input: {
  sourceYaml: string;
  runId: string;
  prompt: string;
  appId: string;
  useCurrentScreen: boolean;
  deviceSerial: string;
  scriptPlatform?: "android" | "ios" | "harmony" | "flutter" | "mobile";
}): Record<string, unknown> {
  return {
    sourceYaml: input.sourceYaml,
    runId: input.runId,
    instruction: input.prompt,
    appId: input.appId,
    ...(input.scriptPlatform ? { scriptPlatform: input.scriptPlatform } : {}),
    ...(input.useCurrentScreen && input.deviceSerial
      ? { screenAssist: { mode: "current" as const, deviceSerial: input.deviceSerial } }
      : {})
  };
}

export function buildStepRunRequestBody(input: {
  sourceYaml: string;
  deviceSerial: string;
  parameters: Record<string, ScriptParameterValue>;
  stepId: string;
  mode: "single" | "from_here";
  androidAppMonitor?: AndroidAppMonitorConfig;
}): Record<string, unknown> {
  return {
    sourceYaml: input.sourceYaml,
    deviceSerial: input.deviceSerial,
    parameters: input.parameters,
    startStepId: input.stepId,
    ...(input.mode === "single" ? { endStepId: input.stepId } : {}),
    pauseAfterEachStep: input.mode === "from_here",
    ...(input.androidAppMonitor ? { androidAppMonitor: input.androidAppMonitor } : {})
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

export function scriptImportErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = scriptImportIssues(error.payload);
    if (issues.length) {
      return `脚本校验失败：${issues.map((issue) => [issue.path, issue.message].filter(Boolean).join(" ")).join("；")}`;
    }
  }
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function scriptImportIssues(payload: unknown): Array<{ path?: string; message: string }> {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { issues?: unknown }).issues)) {
    return [];
  }
  return (payload as { issues: unknown[] }).issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object") return [];
    const record = issue as { path?: unknown; message?: unknown };
    const message = typeof record.message === "string" ? record.message : "";
    if (!message) return [];
    return [{
      ...(typeof record.path === "string" && record.path ? { path: record.path } : {}),
      message
    }];
  });
}
