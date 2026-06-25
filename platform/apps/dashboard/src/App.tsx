import {
  PlayCircle,
  RefreshCw,
  Smartphone
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import {
  viewportPointToDevicePoint,
  type DeviceActionRequest,
  type DeviceInfo,
  type StructuredFlow,
  type TestCase,
  type TestRun,
  type ToolStatus
} from "@mobile-automation/shared";
import { DeviceSidebar } from "./components/DeviceSidebar";
import { AppNav, type AppNavItemId } from "./components/AppNav";
import {
  AssetRecordingPanel,
  type AssetRecordingAutoExploreReport,
  type AssetRecordingCurrentPage,
  type AssetRecordingOperationTransitionDraft,
  type AssetRecordingPageElementDraft,
  type AssetRecordingPageTask,
  type AssetRecordingPageTaskDraft,
  type AssetRecordingPageTaskTransitionDraft
} from "./components/AssetRecordingPanel";
import { CaseLibraryPanel, type FlowExpectationOverride } from "./components/CaseLibraryPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { GraphCandidatesPanel } from "./components/GraphCandidatesPanel";
import { PageAssetsPanel } from "./components/PageAssetsPanel";
import { RuntimeInterceptorPanel, type RuntimeInterceptorRule } from "./components/RuntimeInterceptorPanel";
import { StepsPanel } from "./components/StepsPanel";
import { ToolStatusBar } from "./components/StepsPanelParts";
import { useDeviceList } from "./hooks/useDeviceList";
import { useRecorder } from "./hooks/useRecorder";
import { useRunExecution } from "./hooks/useRunExecution";
import { useScrcpyStream } from "./hooks/useScrcpyStream";
import { classifyPreviewGesture } from "./preview-gesture";
import { attachRecordingObservationsToActionStep, createRecordedStep, type RecordableAction } from "./recording";
import {
  createTapRecordingActionFromElementLookup,
  createTapRecordingActionFromSnapshot,
  type ElementLookupResponse,
  type ElementSnapshot,
  type SemanticSnapshots,
  type TextSnapshot
} from "./semantic-snapshot";

type PointerStart = {
  x: number;
  y: number;
  at: number;
};

type ResizeStart = {
  startX: number;
  startWidth: number;
};

type AutomationTab = "steps" | "runs";
type NavItemId = AppNavItemId;
type RecordingWorkspaceStyle = CSSProperties & {
  "--recording-preview-width"?: string;
  "--asset-recording-preview-width"?: string;
};

type RecordingObservation = {
  id?: string;
  deviceSerial?: string;
  platform: DeviceInfo["platform"];
  capturedAt: string;
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  componentName?: string;
  resolution?: {
    width: number;
    height: number;
  };
  uiElements: Array<{
    resourceId?: string;
    accessibilityId?: string;
    text?: string;
    contentDesc?: string;
    className?: string;
    packageName?: string;
    bounds?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    enabled?: boolean;
    visible?: boolean;
    clickable?: boolean;
    longClickable?: boolean;
    focusable?: boolean;
    scrollable?: boolean;
  }>;
  ocrTexts: Array<{
    text: string;
    confidence?: number;
    region?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    source?: "ocr";
  }>;
  raw?: Record<string, unknown>;
};

type RecordingGraphAssetApiResponse = {
  result: {
    from: {
      status?: "matched" | "created" | "reused" | "skipped";
      reason?: string;
      node?: { name: string; key: string; matchers?: Array<{ critical?: boolean }> };
    };
    to: {
      status?: "matched" | "created" | "reused" | "skipped";
      reason?: string;
      node?: { name: string; key: string; matchers?: Array<{ critical?: boolean }> };
    };
    edge: {
      status?: "created" | "reused" | "skipped";
      reason?: string;
      edge?: {
        name: string;
        status: "draft" | "active" | "deprecated" | "rejected";
        reliabilityScore?: number;
        expectations?: Array<{ title?: string; type?: string }>;
      };
    };
    warnings: Array<{ code: string; message: string }>;
  };
};

type GraphListItem = {
  status?: string;
  platformScope?: string;
  activeVersion?: {
    id?: string;
    status?: string;
  };
};

type CurrentPageAssetNodeApi = {
  id?: string;
  key?: string;
  name?: string;
  nodeType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type CurrentPageMatcherEvidenceApi = {
  type?: string;
  expected?: string;
  actual?: string;
  matched?: boolean;
};

type CurrentPageMatcherDiagnosticsApi = {
  status?: string;
  matchedEvidence?: CurrentPageMatcherEvidenceApi[];
  missingEvidence?: CurrentPageMatcherEvidenceApi[];
  topCandidate?: {
    nodeId?: string;
    key?: string;
    name?: string;
    score?: number;
  };
};

type CurrentPageAssetApiResponse = {
  result?: {
    status: "matched" | "draft_created" | "draft_reused" | "draft_candidate";
    visualPageName?: string;
    matcherDiagnostics?: CurrentPageMatcherDiagnosticsApi;
    match: {
      status: string;
      score: number;
      node?: CurrentPageAssetNodeApi;
      candidates?: Array<{
        node?: CurrentPageAssetNodeApi;
        score?: number;
        matcherResults?: Array<{
          type?: string;
          expected?: string;
          actual?: string;
          matched?: boolean;
        }>;
      }>;
    };
    node?: CurrentPageAssetNodeApi;
    observation?: RecordingObservation;
  };
  assets?: {
    pageAssets?: Array<{
      id: string;
      key: string;
      name: string;
      status: string;
      platformScope?: string;
      matcherCount?: number;
      elementCount?: number;
      updatedAt?: string;
      transitions?: Array<{
        id: string;
        key?: string;
        name: string;
        status: string;
        source?: string;
        actionSummary?: string;
        actionLocator?: string;
        actionKind?: "tap" | "scroll" | "long_press" | "input" | "unknown";
        targetName?: string;
        targetKey?: string;
        expectationSummary?: string;
        reliabilityScore?: number;
      }>;
      tasks?: Array<{
        id: string;
        name: string;
        status: "active" | "draft" | "deprecated";
        stepCount?: number;
        parameterKeys?: string[];
        updatedAt?: string;
      }>;
    }>;
  };
  error?: string;
};

const recordingPreviewMinWidth = 420;
const recordingPreviewMaxWidth = 980;
const recordingStepsMinWidth = 540;

export function previewWorkspaceKey(navItem: AppNavItemId): "recording" | "assetRecording" | "inactive" {
  if (navItem === "recording" || navItem === "assetRecording") {
    return navItem;
  }
  return "inactive";
}

export function workspaceStyleForNav(navItem: AppNavItemId, recordingPreviewWidth: number, assetRecordingPreviewWidth: number): RecordingWorkspaceStyle {
  if (navItem === "recording") {
    return {
      "--recording-preview-width": `${recordingPreviewWidth}px`
    };
  }
  if (navItem === "assetRecording") {
    return {
      "--asset-recording-preview-width": `${assetRecordingPreviewWidth}px`
    };
  }
  return {};
}

export function actionStrategyForWorkspace(
  navItem: AppNavItemId,
  state: { identifying: boolean; recording: boolean }
): {
  useCachedSemanticTarget: boolean;
  resolveLiveLocatorBeforeAction: boolean;
  fetchBeforeObservationBeforeAction: boolean;
  blockPreviewInteraction: boolean;
} {
  if (navItem === "assetRecording") {
    return {
      useCachedSemanticTarget: !state.identifying,
      resolveLiveLocatorBeforeAction: false,
      fetchBeforeObservationBeforeAction: false,
      blockPreviewInteraction: state.identifying
    };
  }
  return {
    useCachedSemanticTarget: navItem === "recording" && state.recording,
    resolveLiveLocatorBeforeAction: navItem === "recording" && state.recording,
    fetchBeforeObservationBeforeAction: false,
    blockPreviewInteraction: false
  };
}

export function assetRecordingIdentificationStateAfter(
  currentInFlightCount: number,
  event: "begin" | "end"
): { inFlightCount: number; identifying: boolean } {
  const inFlightCount =
    event === "begin"
      ? currentInFlightCount + 1
      : Math.max(0, currentInFlightCount - 1);
  return {
    inFlightCount,
    identifying: inFlightCount > 0
  };
}

export function assetConnectionEdgeMessage(
  type: "missing_source" | "confirm_failed" | "confirmed" | "delete_failed" | "deleted",
  edgeName?: string
): string {
  if (type === "missing_source") {
    return "当前页面还没有保存为页面资产，请先保存页面后再确认连接边";
  }
  if (type === "confirm_failed") {
    return "连接边确认失败";
  }
  if (type === "confirmed") {
    return `已确认连接边：${edgeName ?? "目标页面"}`;
  }
  if (type === "delete_failed") {
    return "删除连接边失败";
  }
  return `已删除连接边：${edgeName ?? "目标页面"}`;
}

export function assetOperationTransitionRequestBody(
  draft: AssetRecordingOperationTransitionDraft,
  context: { sourceNodeId: string; platformScope: "android" | "ios" | "mobile-both" }
) {
  return {
    sourceNodeId: context.sourceNodeId,
    targetNodeId: draft.targetNodeId ?? context.sourceNodeId,
    ...(draft.abilityType ? { abilityType: draft.abilityType } : {}),
    actionKind: draft.actionKind,
    locator: draft.locator,
    semanticArea: draft.semanticArea,
    coordinateSpace: draft.coordinateSpace,
    elementLabel: draft.elementLabel,
    targetText: draft.targetText,
    availability: draft.availability,
    outcomeType: draft.outcomeType,
    targetLabel: draft.targetLabel,
    platformScope: context.platformScope,
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {})
  };
}

export function assetPageElementRequestBody(
  draft: AssetRecordingPageElementDraft,
  context: { sourceNodeId: string; platformScope: "android" | "ios" | "mobile-both" }
) {
  return {
    elementId: draft.elementId,
    sourceNodeId: context.sourceNodeId,
    ...(draft.abilityType ? { abilityType: draft.abilityType } : {}),
    actionKind: draft.actionKind,
    locator: draft.locator,
    semanticArea: draft.semanticArea,
    coordinateSpace: draft.coordinateSpace,
    elementLabel: draft.elementLabel,
    targetText: draft.targetText,
    availability: draft.availability,
    platformScope: context.platformScope,
    outcomeType: draft.outcomeType,
    outcomeLabel: draft.outcomeLabel,
    targetNodeId: draft.targetNodeId,
    targetLabel: draft.targetLabel,
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {})
  };
}

export function assetPageTaskRequestBody(
  draft: AssetRecordingPageTaskDraft,
  context: { sourceNodeId: string }
) {
  return {
    sourceNodeId: context.sourceNodeId,
    taskId: draft.taskId,
    name: draft.name,
    status: draft.status,
    steps: draft.steps
  };
}

export function assetPageTaskTransitionRequestBody(
  draft: AssetRecordingPageTaskTransitionDraft,
  context: { sourceNodeId: string; platformScope: "android" | "ios" | "mobile-both" }
) {
  return {
    sourceNodeId: context.sourceNodeId,
    targetNodeId: draft.targetNodeId,
    taskId: draft.taskId,
    taskName: draft.taskName,
    platformScope: context.platformScope
  };
}

export function validateAssetPageElementDraftForSave(draft: AssetRecordingPageElementDraft): string | undefined {
  if (draft.outcomeType === "navigate" && !draft.targetNodeId?.trim()) {
    return "跳转页面类型必须选择已保存的目标页面，否则不会进入路径规划";
  }
  return undefined;
}

export function App() {
  const [inputText, setInputText] = useState("");
  const [message, setMessage] = useState("准备连接设备");
  const [busy, setBusy] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [activeNavItem, setActiveNavItem] = useState<NavItemId>("recording");
  const [automationTab, setAutomationTab] = useState<AutomationTab>("steps");
  const [recordingPreviewWidth, setRecordingPreviewWidth] = useState(560);
  const [assetRecordingPreviewWidth, setAssetRecordingPreviewWidth] = useState(560);
  const [highlightedCaseId, setHighlightedCaseId] = useState("");
  const [structuredFlows, setStructuredFlows] = useState<StructuredFlow[]>([]);
  const [flowSearchText, setFlowSearchText] = useState("");
  const [highlightedFlowId, setHighlightedFlowId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [runtimeInterceptorRules, setRuntimeInterceptorRules] = useState<RuntimeInterceptorRule[]>([]);
  const [assetRecordingGraphVersionId, setAssetRecordingGraphVersionId] = useState("");
  const [assetRecordingPage, setAssetRecordingPage] = useState<AssetRecordingCurrentPage>({ status: "idle" });
  const [assetAutoExploreReport, setAssetAutoExploreReport] = useState<AssetRecordingAutoExploreReport>();
  const [assetRecordingIdentifying, setAssetRecordingIdentifying] = useState(false);
  const activePreviewWorkspaceKey = previewWorkspaceKey(activeNavItem);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const resizeStartRef = useRef<ResizeStart | null>(null);
  const semanticSnapshotsRef = useRef<SemanticSnapshots>({});
  const recordingGraphVersionIdRef = useRef("");
  const elementSnapshotInFlightRef = useRef(false);
  const textSnapshotInFlightRef = useRef(false);
  const assetRecordingIdentificationInFlightRef = useRef(0);

  const {
    devices,
    selectedSerial,
    selectedDevice,
    tools,
    scrcpyAvailable,
    scrcpyRunning,
    setScrcpyRunning,
    refreshDevices,
    selectDevice
  } = useDeviceList({ setMessage });
  const {
    imageRef,
    canvasRef,
    videoRef,
    previewUrl,
    screenshotError,
    previewMode,
    previewRenderer,
    previewMediaSize,
    selectedDeviceSize,
    scrcpyStreamStatus,
    isScrcpyPreviewActive,
    closeScrcpyStream,
    refreshScreenshot,
    sendScrcpyDirectAction,
    handleScreenshotLoaded
  } = useScrcpyStream({
    selectedSerial,
    selectedDevice,
    enabled: activePreviewWorkspaceKey !== "inactive",
    previewSessionKey: activePreviewWorkspaceKey,
    setMessage
  });
  const {
    steps,
    selectedCaseId,
    recording,
    caseName,
    cases,
    setRecording,
    setCaseName,
    appendStep,
    updateStepById,
    moveStep,
    removeStep,
    insertWaitStep,
    insertConditionalTapStep,
    copyStep,
    toggleStepEnabled,
    updateStep,
    addStepExpectation,
    updateStepExpectation,
    removeStepExpectation,
    resetEditor,
    saveCase,
    loadCase,
    loadStructuredFlow,
    deleteCase
  } = useRecorder({ selectedDeviceSize, selectedSerial, setMessage });
  const {
    runs,
    currentRun,
    currentGraphRun,
    runsLimit,
    activeRunForSelectedDevice,
    selectedDeviceBusy,
    repeatCount,
    stepIntervalMs,
    loopUntilStopped,
    pauseAfterEachStep,
    startStrategy,
    startAppPackageName,
    startSetupScope,
    setCurrentRunId,
    setRepeatCount,
    setStepIntervalMs,
    setLoopUntilStopped,
    setPauseAfterEachStep,
    setStartStrategy,
    setStartAppPackageName,
    setStartSetupScope,
    loadMoreRuns,
    startRun,
    startFlowRun,
    stopCurrentRun,
    pauseCurrentRun,
    resumeCurrentRun,
    stepCurrentRun
  } = useRunExecution({ selectedSerial, caseName, steps, setMessage });

  function updateAssetRecordingIdentification(event: "begin" | "end") {
    const nextState = assetRecordingIdentificationStateAfter(assetRecordingIdentificationInFlightRef.current, event);
    assetRecordingIdentificationInFlightRef.current = nextState.inFlightCount;
    setAssetRecordingIdentifying(nextState.identifying);
  }

  function beginAssetRecordingIdentification() {
    updateAssetRecordingIdentification("begin");
  }

  function endAssetRecordingIdentification() {
    updateAssetRecordingIdentification("end");
  }

  async function refreshStructuredFlows() {
    const response = await fetch("/api/structured-flows");
    const json = (await response.json()) as { flows?: StructuredFlow[]; error?: string };
    if (!response.ok || !json.flows) {
      throw new Error(json.error ?? "加载结构化用例失败");
    }
    setStructuredFlows(json.flows);
  }

  async function refreshRuntimeInterceptorRules() {
    const response = await fetch("/api/runtime-interceptor-rules?enabledOnly=true");
    const json = (await response.json()) as { rules?: RuntimeInterceptorRule[]; error?: string };
    if (!response.ok || !json.rules) {
      throw new Error(json.error ?? "加载临时阻断页规则失败");
    }
    setRuntimeInterceptorRules(json.rules);
  }

  useEffect(() => {
    refreshStructuredFlows().catch(() => undefined);
    refreshRuntimeInterceptorRules().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeNavItem !== "assetRecording" || !selectedSerial || !selectedDevice) {
      return;
    }
    void identifyCurrentPageAsset();
  }, [activeNavItem, selectedDevice?.platform, selectedSerial]);

  useEffect(() => {
    let cancelled = false;
    recordingGraphVersionIdRef.current = "";
    if (!recording || !selectedDevice) {
      return;
    }
    const platform = selectedDevice.platform;

    async function refreshRecordingGraphVersion() {
      try {
        const response = await fetch("/api/graphs");
        if (!response.ok) {
          return;
        }
        const json = (await response.json()) as { graphs: GraphListItem[] };
        const graphVersionId = selectRecordingGraphVersionId(json.graphs, platform);
        if (!cancelled) {
          recordingGraphVersionIdRef.current = graphVersionId ?? "";
        }
      } catch {
        if (!cancelled) {
          recordingGraphVersionIdRef.current = "";
        }
      }
    }

    void refreshRecordingGraphVersion();
    return () => {
      cancelled = true;
    };
  }, [recording, selectedDevice]);

  useEffect(() => {
    setRecordingPreviewWidth((width) => clamp(width, recordingWidthLimits().min, recordingWidthLimits().max));
    setAssetRecordingPreviewWidth((width) => clamp(width, assetRecordingWidthLimits().min, assetRecordingWidthLimits().max));
  }, [navCollapsed]);

  useEffect(() => {
    function onPointerMove(event: globalThis.PointerEvent) {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) {
        return;
      }
      if (activeNavItem === "assetRecording") {
        const limits = assetRecordingWidthLimits();
        setAssetRecordingPreviewWidth(clamp(resizeStart.startWidth + event.clientX - resizeStart.startX, limits.min, limits.max));
        return;
      }
      const limits = recordingWidthLimits();
      setRecordingPreviewWidth(clamp(resizeStart.startWidth + event.clientX - resizeStart.startX, limits.min, limits.max));
    }

    function onPointerUp() {
      resizeStartRef.current = null;
      document.body.classList.remove("recording-resize-active");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.classList.remove("recording-resize-active");
    };
  }, [activeNavItem, navCollapsed]);

  useEffect(() => {
    semanticSnapshotsRef.current = {};
    if (!recording || activeNavItem !== "recording" || !selectedSerial || selectedDevice?.platform !== "android") {
      return;
    }

    let cancelled = false;
    let elementTimer: number | undefined;
    let textTimer: number | undefined;
    let textStartTimer: number | undefined;
    const serial = selectedSerial;

    async function refreshElementSnapshot() {
      if (elementSnapshotInFlightRef.current) {
        return;
      }
      elementSnapshotInFlightRef.current = true;
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/locators/element-snapshot`);
        if (!response.ok) {
          return;
        }
        const snapshot = (await response.json()) as ElementSnapshot;
        if (!cancelled) {
          semanticSnapshotsRef.current = {
            ...semanticSnapshotsRef.current,
            element: snapshot
          };
        }
      } catch {
        // Recording must stay responsive even when a semantic snapshot fails.
      } finally {
        elementSnapshotInFlightRef.current = false;
      }
    }

    async function refreshTextSnapshot() {
      if (textSnapshotInFlightRef.current) {
        return;
      }
      textSnapshotInFlightRef.current = true;
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/locators/text-snapshot`);
        if (!response.ok) {
          return;
        }
        const snapshot = (await response.json()) as TextSnapshot;
        if (!cancelled) {
          semanticSnapshotsRef.current = {
            ...semanticSnapshotsRef.current,
            text: snapshot
          };
        }
      } catch {
        // OCR is a best-effort fallback for recording; click control should never wait for it.
      } finally {
        textSnapshotInFlightRef.current = false;
      }
    }

    void refreshElementSnapshot();
    elementTimer = window.setInterval(() => {
      void refreshElementSnapshot();
    }, 1200);
    textStartTimer = window.setTimeout(() => {
      void refreshTextSnapshot();
      textTimer = window.setInterval(() => {
        void refreshTextSnapshot();
      }, 4000);
    }, 600);

    return () => {
      cancelled = true;
      semanticSnapshotsRef.current = {};
      elementSnapshotInFlightRef.current = false;
      textSnapshotInFlightRef.current = false;
      if (elementTimer !== undefined) {
        window.clearInterval(elementTimer);
      }
      if (textTimer !== undefined) {
        window.clearInterval(textTimer);
      }
      if (textStartTimer !== undefined) {
        window.clearTimeout(textStartTimer);
      }
    };
  }, [activeNavItem, recording, selectedDevice?.platform, selectedSerial]);

  async function runAction(action: DeviceActionRequest, shouldRecord = true, recordedAction?: RecordableAction) {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (selectedDevice && !canDeviceRunAction(selectedDevice, action.type)) {
      setMessage(selectedDevice.platform === "ios" ? `iOS 设备暂不支持 ${action.type}，需要设备在线并配置 WDA` : `当前设备暂不支持 ${action.type}`);
      return;
    }
    const shouldAppendRecordingStep = activeNavItem === "recording" && recording && shouldRecord;
    const actionStrategy = actionStrategyForWorkspace(activeNavItem, {
      identifying: assetRecordingIdentifying || assetRecordingIdentificationInFlightRef.current > 0,
      recording
    });
    if (actionStrategy.blockPreviewInteraction) {
      setMessage("正在识别当前页面，请稍候");
      return;
    }
    const beforeRecordingObservation =
      shouldAppendRecordingStep && selectedDevice
        ? buildRecordingObservationFromSnapshots(selectedSerial, selectedDevice.platform, semanticSnapshotsRef.current)
        : undefined;
    const shouldCaptureAssetTransition = activeNavItem === "assetRecording" && selectedDevice && shouldRecord;
    const cachedAssetObservation = isRecordingObservation(assetRecordingPage.observation) ? assetRecordingPage.observation : undefined;
    const beforeAssetObservation =
      shouldCaptureAssetTransition && selectedDevice
        ? buildRecordingObservationFromSnapshots(selectedSerial, selectedDevice.platform, semanticSnapshotsRef.current) ?? cachedAssetObservation
        : undefined;
    const appendRecordedStep = (recordable: RecordableAction) => {
      const step = attachRecordingObservationsToActionStep(appendStep(recordable), beforeRecordingObservation);
      if (step.params.recordingContext) {
        updateStepById(step.id, {
          params: {
            recordingContext: step.params.recordingContext
          }
        });
      }
      scheduleRecordingAfterObservation(step);
      queueRecordingGraphAsset(step, beforeRecordingObservation);
    };
    if (sendScrcpyDirectAction(action)) {
      if (shouldAppendRecordingStep) {
        appendRecordedStep(recordedAction ?? action);
      }
      semanticSnapshotsRef.current = {};
      setMessage(`已通过 scrcpy 执行 ${action.type}`);
      if (activeNavItem === "assetRecording") {
        scheduleAssetRecordingTransition(recordedAction ?? action, beforeAssetObservation);
      }
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(selectedSerial)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action)
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "动作执行失败");
      }
      if (shouldAppendRecordingStep) {
        appendRecordedStep(recordedAction ?? action);
      }
      semanticSnapshotsRef.current = {};
      refreshScreenshot();
      setMessage(`已执行 ${action.type}`);
      if (activeNavItem === "assetRecording") {
        scheduleAssetRecordingTransition(recordedAction ?? action, beforeAssetObservation);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function scheduleAssetRecordingTransition(recordable: RecordableAction, beforeObservation: RecordingObservation | undefined) {
    beginAssetRecordingIdentification();
    window.setTimeout(() => {
      void (async () => {
        try {
          await captureAssetRecordingTransition(recordable, beforeObservation, { manageIdentification: false });
        } finally {
          endAssetRecordingIdentification();
        }
      })();
    }, 900);
  }

  async function captureAssetRecordingTransition(
    recordable: RecordableAction,
    beforeObservation: RecordingObservation | undefined,
    options: { manageIdentification?: boolean } = {}
  ) {
    if (!selectedSerial || !selectedDevice) {
      return;
    }
    const shouldManageIdentification = options.manageIdentification ?? true;
    if (shouldManageIdentification) {
      beginAssetRecordingIdentification();
    }
    try {
      const graphVersionId = assetRecordingGraphVersionId || (await fetchWritableGraphVersionId(selectedDevice.platform));
      if (!graphVersionId) {
        await identifyCurrentPageAsset();
        return;
      }
      setAssetRecordingGraphVersionId(graphVersionId);
      const before = beforeObservation ?? (await fetchRecordingObservation(selectedSerial).catch(() => undefined));
      const after = await fetchRecordingObservation(selectedSerial).catch(() => undefined);
      if (!before || !after) {
        await identifyCurrentPageAsset();
        setMessage("已刷新页面信息，但本次动作缺少前后页面快照，暂未生成 PageTransition candidate");
        return;
      }
      const step = deviceActionToAssetRecordingStep(recordable, selectedDeviceSize);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/recording-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          beforeObservation: before,
          afterObservation: after,
          confirm: false,
          includeOcr: false
        })
      });
      const json = (await response.json()) as RecordingGraphAssetApiResponse & CurrentPageAssetApiResponse & { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "PageTransition candidate 生成失败");
      }
      await identifyCurrentPageAsset();
      const edge = json.result.edge.edge;
      const messagePrefix = edge ? `已生成 PageTransition candidate：${edge.name}` : "动作已执行，PageTransition candidate 暂未生成";
      setMessage(messagePrefix);
    } catch (error) {
      await identifyCurrentPageAsset();
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (shouldManageIdentification) {
        endAssetRecordingIdentification();
      }
    }
  }

  function scheduleRecordingAfterObservation(step: ReturnType<typeof appendStep>) {
    if (!recording || !selectedSerial || !selectedDevice) {
      return;
    }
    const serial = selectedSerial;
    window.setTimeout(() => {
      void (async () => {
        const afterObservation = await fetchRecordingObservation(serial).catch(() => undefined);
        if (!afterObservation) {
          return;
        }
        const next = attachRecordingObservationsToActionStep(step, undefined, afterObservation);
        if (next.params.recordingContext) {
          updateStepById(step.id, {
            params: {
              recordingContext: next.params.recordingContext
            },
            expectations: next.expectations
          });
        }
      })();
    }, Math.max(600, Number(step.timing?.delayBeforeMs ?? 700)));
  }

  function queueRecordingGraphAsset(step: ReturnType<typeof appendStep>, beforeObservation: RecordingObservation | undefined) {
    if (!recording) {
      return;
    }
    const graphVersionId = recordingGraphVersionIdRef.current;
    if (!graphVersionId) {
      updateStepById(step.id, {
        params: {
          ...step.params,
          graphAsset: {
            status: "draft",
            warnings: [{ code: "GRAPH_VERSION_MISSING", message: "未找到可写入的 active 业务图谱版本" }]
          }
        }
      });
      return;
    }
    if (!selectedSerial || !beforeObservation) {
      updateStepById(step.id, {
        params: {
          ...step.params,
          graphAsset: {
            status: "draft",
            warnings: [{ code: "BEFORE_OBSERVATION_MISSING", message: "录制前页面快照缺失，本步骤暂未写入图谱" }]
          }
        }
      });
      return;
    }
    updateStepById(step.id, {
      params: {
        ...step.params,
        graphAsset: {
          status: "pending",
          warnings: []
        }
      }
    });
    window.setTimeout(() => {
      void persistRecordedStepGraphAsset(graphVersionId, selectedSerial, step, beforeObservation);
    }, Math.max(600, Number(step.timing?.delayBeforeMs ?? 900)));
  }

  async function persistRecordedStepGraphAsset(graphVersionId: string, serial: string, step: ReturnType<typeof appendStep>, beforeObservation: RecordingObservation) {
    try {
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/recording-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          beforeObservation,
          deviceSerial: serial,
          confirm: true,
          includeOcr: false
        })
      });
      const json = (await response.json()) as RecordingGraphAssetApiResponse & { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "录制步骤写入图谱失败");
      }
      const edge = json.result.edge.edge;
      const fromNode = json.result.from.node;
      const toNode = json.result.to.node;
      const skipped = json.result.edge.status === "skipped" || !edge || !fromNode || !toNode;
      updateStepById(step.id, {
        params: {
          ...step.params,
          graphAsset: {
            status: skipped ? "skipped" : edge.status === "active" ? "confirmed" : "draft",
            fromNodeName: fromNode?.name,
            fromNodeKey: fromNode?.key,
            fromMatcherCount: fromNode?.matchers?.length ?? 0,
            fromCriticalMatcherCount: fromNode?.matchers?.filter((matcher) => matcher.critical).length ?? 0,
            toNodeName: toNode?.name,
            toNodeKey: toNode?.key,
            toMatcherCount: toNode?.matchers?.length ?? 0,
            toCriticalMatcherCount: toNode?.matchers?.filter((matcher) => matcher.critical).length ?? 0,
            edgeName: edge?.name,
            expectationSummary: edge?.expectations?.[0]?.title,
            reliabilityScore: edge?.reliabilityScore,
            warnings: [
              ...json.result.warnings,
              ...(skipped && json.result.edge.reason ? [{ code: "GRAPH_ASSET_SKIPPED", message: json.result.edge.reason }] : [])
            ]
          }
        }
      });
    } catch (error) {
      updateStepById(step.id, {
        params: {
          ...step.params,
          graphAsset: {
            status: "draft",
            warnings: [{ code: "GRAPH_ASSET_WRITE_FAILED", message: error instanceof Error ? error.message : String(error) }]
          }
        }
      });
    }
  }

  async function createTapRecordingAction(point: { x: number; y: number }): Promise<RecordableAction> {
    const fallback: RecordableAction = { type: "tap", x: point.x, y: point.y };
    const actionStrategy = actionStrategyForWorkspace(activeNavItem, {
      identifying: assetRecordingIdentifying || assetRecordingIdentificationInFlightRef.current > 0,
      recording
    });
    if (!actionStrategy.useCachedSemanticTarget || !selectedSerial || !selectedDevice?.capabilities.screenshot) {
      return fallback;
    }
    const cachedAction = createTapRecordingActionFromSnapshot(point, selectedDeviceSize, semanticSnapshotsRef.current);
    if (cachedAction.type !== "tap" || selectedDevice.platform !== "android" || !actionStrategy.resolveLiveLocatorBeforeAction) {
      return cachedAction;
    }
    const liveElementAction = await fetchTapElementRecordingAction(selectedSerial, point);
    return liveElementAction ?? cachedAction;
  }

  async function fetchTapElementRecordingAction(serial: string, point: { x: number; y: number }): Promise<RecordableAction | undefined> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1600);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/locators/element-at`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          x: point.x,
          y: point.y,
          deviceWidth: selectedDeviceSize.width,
          deviceHeight: selectedDeviceSize.height
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        return undefined;
      }
      const lookup = (await response.json()) as ElementLookupResponse;
      return createTapRecordingActionFromElementLookup(point, lookup);
    } catch {
      return undefined;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function startScrcpy() {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    const response = await fetch(`/api/devices/${encodeURIComponent(selectedSerial)}/scrcpy`, { method: "POST" });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(json.error ?? "scrcpy 启动失败");
      return;
    }
    setScrcpyRunning(true);
    setMessage("调试窗口已打开");
  }

  async function stopScrcpy() {
    if (!selectedSerial) {
      return;
    }
    await fetch(`/api/devices/${encodeURIComponent(selectedSerial)}/scrcpy`, { method: "DELETE" });
    setScrcpyRunning(false);
    setMessage("调试窗口已关闭");
  }

  function pointerToDevice(
    event: PointerEvent,
    targetSize = selectedDeviceSize
  ): { x: number; y: number; xRatio: number; yRatio: number } | null {
    const preview = previewRef.current;
    if (!preview || previewMode === "scrcpy_connecting" || !targetSize.width || !targetSize.height) {
      return null;
    }
    const rect = preview.getBoundingClientRect();
    const mediaSize =
      previewMode === "scrcpy"
        ? previewMediaSize
        : {
            width: imageRef.current?.naturalWidth || selectedDeviceSize.width,
            height: imageRef.current?.naturalHeight || selectedDeviceSize.height
          };
    return viewportPointToDevicePoint(
      { x: event.clientX, y: event.clientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      mediaSize,
      targetSize
    );
  }

  function onPreviewPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  }

  function onPreviewPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) {
      return;
    }
    const controlSize = previewMode === "scrcpy" ? previewMediaSize : selectedDeviceSize;
    const endControlPoint = pointerToDevice(event, controlSize);
    const endRecordedPoint = pointerToDevice(event, selectedDeviceSize);
    if (!endControlPoint || !endRecordedPoint) {
      return;
    }

    const durationMs = Math.max(200, Date.now() - start.at);
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const preview = previewRef.current;
    if (!preview) {
      return;
    }
    const rect = preview.getBoundingClientRect();
    const mediaSize =
      previewMode === "scrcpy"
        ? previewMediaSize
        : {
            width: imageRef.current?.naturalWidth || selectedDeviceSize.width,
            height: imageRef.current?.naturalHeight || selectedDeviceSize.height
          };
    const startControlPoint = viewportPointToDevicePoint(
      { x: start.x, y: start.y },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      mediaSize,
      controlSize
    );
    const startRecordedPoint = viewportPointToDevicePoint(
      { x: start.x, y: start.y },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      mediaSize,
      selectedDeviceSize
    );

    const gesture = classifyPreviewGesture({ distancePx: distance, durationMs });
    if (gesture === "swipe") {
      void runAction({
        type: "swipe",
        startX: startControlPoint.x,
        startY: startControlPoint.y,
        endX: endControlPoint.x,
        endY: endControlPoint.y,
        durationMs
      }, true, {
        type: "swipe",
        startX: startRecordedPoint.x,
        startY: startRecordedPoint.y,
        endX: endRecordedPoint.x,
        endY: endRecordedPoint.y,
        durationMs
      });
    } else if (gesture === "long_press") {
      void runAction(
        { type: "long_press", x: startControlPoint.x, y: startControlPoint.y, durationMs },
        true,
        { type: "long_press", x: startRecordedPoint.x, y: startRecordedPoint.y, durationMs }
      );
    } else {
      void (async () => {
        const recordedAction = await createTapRecordingAction(endRecordedPoint);
        await runAction({ type: "tap", x: endControlPoint.x, y: endControlPoint.y }, true, recordedAction);
      })();
    }
  }

  function onPreviewPointerCancel() {
    pointerStartRef.current = null;
  }

  function recordingWidthLimits() {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const navWidth = navCollapsed ? 64 : 184;
    const horizontalPadding = 24;
    const gaps = 36;
    const availableWidth = Math.max(0, workspaceWidth - navWidth - horizontalPadding - gaps);
    const dynamicMin = Math.min(recordingPreviewMinWidth, Math.max(320, availableWidth - recordingStepsMinWidth));
    const dynamicMax = Math.max(dynamicMin, Math.min(recordingPreviewMaxWidth, availableWidth - recordingStepsMinWidth));
    return {
      min: dynamicMin,
      max: dynamicMax
    };
  }

  function assetRecordingWidthLimits() {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const navWidth = navCollapsed ? 64 : 184;
    const horizontalPadding = 24;
    const gaps = 36;
    const availableWidth = Math.max(0, workspaceWidth - navWidth - horizontalPadding - gaps);
    const assetEditorMinWidth = 540;
    const dynamicMin = Math.min(recordingPreviewMinWidth, Math.max(320, availableWidth - assetEditorMinWidth));
    const dynamicMax = Math.max(dynamicMin, Math.min(recordingPreviewMaxWidth, availableWidth - assetEditorMinWidth));
    return {
      min: dynamicMin,
      max: dynamicMax
    };
  }

  function onRecordingResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (activeNavItem !== "recording") {
      return;
    }
    event.preventDefault();
    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: recordingPreviewWidth
    };
    document.body.classList.add("recording-resize-active");
  }

  function onAssetRecordingResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (activeNavItem !== "assetRecording") {
      return;
    }
    event.preventDefault();
    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: assetRecordingPreviewWidth
    };
    document.body.classList.add("recording-resize-active");
  }

  function openDevices() {
    setActiveNavItem("devices");
  }

  function openRecording() {
    setActiveNavItem("recording");
    setAutomationTab("steps");
  }

  function openCaseLibrary() {
    setActiveNavItem("caseLibrary");
  }

  function openAssetRecording() {
    setActiveNavItem("assetRecording");
  }

  function openPageAssets() {
    setActiveNavItem("pageAssets");
  }

  function openRuns() {
    setActiveNavItem("runs");
    setAutomationTab("runs");
  }

  function selectDeviceAndCloseStream(device: DeviceInfo) {
    selectDevice(device, () => closeScrcpyStream("device switch"));
  }

  async function startSavedCaseRun(caseId: string) {
    setActiveNavItem("runs");
    setAutomationTab("runs");
    await startRun(caseId);
  }

  async function saveCaseAndOpenLibrary() {
    const savedFlow = await saveCase();
    if (!savedFlow) {
      return;
    }
    setRecording(false);
    setHighlightedFlowId(savedFlow.id);
    setSelectedFlowId(savedFlow.id);
    setActiveNavItem("caseLibrary");
    await refreshStructuredFlows().catch(() => undefined);
    window.setTimeout(() => {
      setHighlightedFlowId((current) => (current === savedFlow.id ? "" : current));
    }, 2600);
  }

  async function editCaseFromLibrary(flowId: string) {
    const loadedFlow = await loadStructuredFlow(flowId);
    if (!loadedFlow) {
      return;
    }
    setSelectedFlowId(flowId);
    setHighlightedFlowId(flowId);
    openRecording();
    window.setTimeout(() => {
      setHighlightedFlowId((current) => (current === flowId ? "" : current));
    }, 1800);
  }

  async function startSavedFlowRun(flowId: string, stopAtStepId?: string, expectationOverrides?: FlowExpectationOverride[]) {
    setSelectedFlowId(flowId);
    setActiveNavItem("runs");
    setAutomationTab("runs");
    await startFlowRun(flowId, stopAtStepId, expectationOverrides);
  }

  async function updateStructuredFlow(flow: StructuredFlow) {
    const response = await fetch(`/api/structured-flows/${encodeURIComponent(flow.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flow)
    });
    const json = (await response.json()) as { flow?: StructuredFlow; error?: string };
    if (!response.ok || !json.flow) {
      setMessage(json.error ?? "更新结构化用例失败");
      return;
    }
    setSelectedFlowId(json.flow.id);
    await refreshStructuredFlows().catch(() => undefined);
    setMessage(`已更新结构化用例：${json.flow.name}`);
  }

  async function deleteStructuredFlow(flowId: string) {
    const response = await fetch(`/api/structured-flows/${encodeURIComponent(flowId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      setMessage("删除结构化用例失败");
      return;
    }
    if (selectedFlowId === flowId) {
      setSelectedFlowId("");
    }
    await refreshStructuredFlows().catch(() => undefined);
    setMessage("已删除结构化用例");
  }

  async function markCurrentPageAsRuntimeInterceptor() {
    if (!selectedSerial || !selectedDevice) {
      setMessage("请先选择设备");
      return;
    }
    try {
      const observation = await fetchRecordingObservation(selectedSerial);
      if (!observation) {
        setMessage("当前页面识别失败，无法生成临时阻断规则");
        return;
      }
      const defaultTrigger = pickRuntimeInterceptorTriggerText(observation);
      const triggerText = window.prompt("看到哪个文字时认为这是临时阻断页？", defaultTrigger);
      if (!triggerText?.trim()) {
        return;
      }
      const defaultAction = pickRuntimeInterceptorActionText(observation, triggerText.trim());
      const actionText = window.prompt("处理方式：输入要点击的文字；留空表示按返回键处理。", defaultAction);
      const ruleName = window.prompt("规则名称", `${triggerText.trim()} 临时阻断页`);
      if (!ruleName?.trim()) {
        return;
      }
      const response = await fetch("/api/runtime-interceptor-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName.trim(),
          enabled: true,
          platformScope: selectedDevice.platform,
          appPackageName: selectedDevice.platform === "android" ? observation.packageName : undefined,
          iosBundleId: selectedDevice.platform === "ios" ? observation.bundleId : undefined,
          text: triggerText.trim(),
          matchers: [
            {
              type: "text",
              value: triggerText.trim(),
              mode: "contains"
            }
          ],
          action: actionText?.trim()
            ? {
                type: "tap_text",
                text: actionText.trim(),
                mode: "contains"
              }
            : {
                type: "back"
              }
        })
      });
      const json = (await response.json()) as { rule?: RuntimeInterceptorRule; error?: string };
      if (!response.ok || !json.rule) {
        throw new Error(json.error ?? "保存临时阻断规则失败");
      }
      await refreshRuntimeInterceptorRules();
      setMessage(`已标记临时阻断页：${json.rule.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRuntimeInterceptorRule(ruleId: string) {
    try {
      const response = await fetch(`/api/runtime-interceptor-rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "删除临时阻断规则失败");
      }
      await refreshRuntimeInterceptorRules();
      setMessage("已删除临时阻断规则");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function identifyCurrentPageAsset() {
    if (!selectedSerial || !selectedDevice) {
      setMessage("请先选择设备");
      return;
    }
    try {
      beginAssetRecordingIdentification();
      const graphVersionId = assetRecordingGraphVersionId || (await fetchWritableGraphVersionId(selectedDevice.platform));
      if (!graphVersionId) {
        setAssetRecordingPage({
          status: "error",
          message: "未找到可写入的页面资产库版本，请先初始化 PageStateFlow 资产库"
        });
        setMessage("未找到可写入的页面资产库版本");
        return;
      }
      setAssetRecordingGraphVersionId(graphVersionId);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/current-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          includeOcr: true,
          assetOnly: true
        })
      });
      const json = (await readCurrentPageAssetResponse(response)) as CurrentPageAssetApiResponse;
      if (!response.ok || !json.result) {
        throw new Error(json.error ?? "当前页面识别失败");
      }
      const mappedPage = mapCurrentPageAssetResponse(json, graphVersionId);
      setAssetRecordingPage(mappedPage);
      setAssetAutoExploreReport(undefined);
      setMessage(pageAssetMessage(json, mappedPage));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setAssetRecordingPage({ status: "error", message: messageText });
      setMessage(messageText);
    } finally {
      endAssetRecordingIdentification();
    }
  }

  async function saveCurrentPageAsset(mode: "create" | "update", overrides: Partial<AssetRecordingCurrentPage> = {}) {
    if (assetRecordingPage.status === "idle") {
      return;
    }
    const pageDraft = {
      ...assetRecordingPage,
      ...overrides
    };
    if (!assetRecordingPage.graphVersionId) {
      setMessage("当前页面缺少资产库版本，请先点击开始录入并确认识别结果");
      return;
    }
    if (!pageDraft.nodeId && !pageDraft.observation) {
      setMessage("当前页面缺少采集信息，请重新识别当前页面后再保存");
      return;
    }
    try {
      setBusy(true);
      const assetPayload = {
        name: pageDraft.pageName,
        key: pageDraft.targetRef,
        assetKind: "page",
        aliasText: pageDraft.aliasText,
        intentTagsText: pageDraft.intentTagsText,
        aiDescription: pageDraft.aiDescription,
        visualPageName: pageDraft.visualPageName,
        confirmedMatchers: pageDraft.confirmedMatchers,
        confirmedUiTexts: pageDraft.confirmedUiTexts,
        confirmedOcrTexts: pageDraft.confirmedOcrTexts,
        screenshotRegions: pageDraft.screenshotRegions,
        observation: pageDraft.observation,
        match: pageDraft.match
      };
      const response = pageDraft.nodeId
        ? await fetch(
            `/api/graphs/${encodeURIComponent(assetRecordingPage.graphVersionId)}/assets/nodes/${encodeURIComponent(pageDraft.nodeId)}/promote`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(assetPayload)
            }
          )
        : await fetch(`/api/graphs/${encodeURIComponent(assetRecordingPage.graphVersionId)}/assets/nodes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(assetPayload)
          });
      const json = (await response.json().catch(() => ({}))) as {
        node?: { id?: string; key?: string; name?: string; status?: string };
        assets?: CurrentPageAssetApiResponse["assets"];
        error?: string;
      };
      if (!response.ok || !json.node) {
        throw new Error(json.error ?? "页面资产确认失败");
      }
      setAssetRecordingPage((page) => ({
        ...page,
        ...overrides,
        status: "matched",
        nodeId: json.node?.id ?? page.nodeId,
        targetRef: page.targetRef ?? json.node?.key,
        pageName: pageDraft.pageName ?? json.node?.name ?? page.pageName,
        savedAssets: mapPageAssets(json.assets),
        message: "页面资产已确认"
      }));
      const action = mode === "create" ? "保存为新页面" : "更新已有页面";
      setMessage(`${action}成功：${json.node.name ?? pageDraft.pageName ?? "页面资产"}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssetOperationTransition(draft: AssetRecordingOperationTransitionDraft) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = draft.sourceNodeId ?? assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId) {
      setMessage(assetConnectionEdgeMessage("missing_source"));
      return;
    }
    if (draft.outcomeType === "navigate" && !draft.targetNodeId) {
      setMessage("请选择已保存的目标页面资产");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          assetOperationTransitionRequestBody(draft, {
            sourceNodeId,
            platformScope: selectedDevice?.platform ?? "android"
          })
        )
      });
      const json = (await response.json().catch(() => ({}))) as CurrentPageAssetApiResponse & {
        result?: { status?: string; edge?: { id?: string; name?: string } };
        error?: string;
      };
      if (!response.ok || !json.result?.edge) {
        throw new Error(json.error ?? assetConnectionEdgeMessage("confirm_failed"));
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        transitions: mapAssetTransitions(json.assets, sourceNodeId),
        elements: mergeOperationElements(
          [manualElementFromOperationDraft(draft, selectedDevice?.platform ?? "android")],
          page.elements ?? []
        )
      }));
      setMessage(assetConnectionEdgeMessage("confirmed", json.result.edge.name ?? draft.targetLabel));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveAssetPageElement(draft: AssetRecordingPageElementDraft) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = draft.sourceNodeId ?? assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId) {
      setMessage("当前页面还没有保存为页面资产，请先保存页面后再录入可操作元素");
      return;
    }
    const validationMessage = validateAssetPageElementDraftForSave(draft);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-elements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          assetPageElementRequestBody(draft, {
            sourceNodeId,
            platformScope: selectedDevice?.platform ?? "android"
          })
        )
      });
      const json = (await response.json().catch(() => ({}))) as {
        result?: { status?: string; element?: Record<string, unknown> };
        assets?: CurrentPageAssetApiResponse["assets"];
        error?: string;
      };
      if (!response.ok || json.result?.status !== "saved") {
        throw new Error(json.error ?? "可操作元素保存失败");
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        elements: mergeOperationElements(
          [manualElementFromOperationDraft(draft, selectedDevice?.platform ?? "android", json.result?.element)],
          page.elements ?? []
        )
      }));
      setMessage(`已保存可操作元素：${draft.elementLabel}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssetPageElement(element: NonNullable<AssetRecordingCurrentPage["elements"]>[number]) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId || !element.id) {
      setMessage("当前可操作元素缺少可删除的资产标识");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-elements/${encodeURIComponent(sourceNodeId)}/${encodeURIComponent(element.id)}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => ({}))) as {
        result?: { status?: string };
        assets?: CurrentPageAssetApiResponse["assets"];
        error?: string;
      };
      if (!response.ok || json.result?.status !== "deleted") {
        throw new Error(json.error ?? "删除可操作元素失败");
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        elements: (page.elements ?? []).filter((item) => item.id !== element.id)
      }));
      setMessage(`已删除可操作元素：${element.label}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveAssetPageTask(draft: AssetRecordingPageTaskDraft) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = draft.sourceNodeId ?? assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId) {
      setMessage("当前页面还没有保存为页面资产，请先保存页面后再编排页面任务");
      return;
    }
    if (!draft.steps.length) {
      setMessage("页面任务至少需要一个有效步骤");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetPageTaskRequestBody(draft, { sourceNodeId }))
      });
      const json = (await response.json().catch(() => ({}))) as {
        result?: { status?: string; task?: AssetRecordingPageTask };
        assets?: CurrentPageAssetApiResponse["assets"];
        error?: string;
      };
      if (!response.ok || json.result?.status !== "saved" || !json.result.task) {
        throw new Error(json.error ?? "页面任务保存失败");
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        tasks: mergePageTasks([json.result!.task!], page.tasks ?? [])
      }));
      setMessage(`已保存页面任务：${json.result.task.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssetPageTask(task: AssetRecordingPageTask) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId || !task.id) {
      setMessage("当前页面任务缺少可删除的资产标识");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-tasks/${encodeURIComponent(sourceNodeId)}/${encodeURIComponent(task.id)}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => ({}))) as {
        result?: { status?: string };
        assets?: CurrentPageAssetApiResponse["assets"];
        error?: string;
      };
      if (!response.ok || json.result?.status !== "deleted") {
        throw new Error(json.error ?? "删除页面任务失败");
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        tasks: (page.tasks ?? []).filter((item) => item.id !== task.id)
      }));
      setMessage(`已删除页面任务：${task.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssetPageTaskTransition(draft: AssetRecordingPageTaskTransitionDraft) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = draft.sourceNodeId ?? assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId) {
      setMessage(assetConnectionEdgeMessage("missing_source"));
      return;
    }
    if (!draft.targetNodeId) {
      setMessage("请选择已保存的目标页面资产");
      return;
    }
    if (!draft.taskId) {
      setMessage("请选择页面任务");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/task-transitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          assetPageTaskTransitionRequestBody(draft, {
            sourceNodeId,
            platformScope: selectedDevice?.platform ?? "android"
          })
        )
      });
      const json = (await response.json().catch(() => ({}))) as CurrentPageAssetApiResponse & {
        result?: { status?: string; edge?: { id?: string; name?: string } };
        error?: string;
      };
      if (!response.ok || !json.result?.edge) {
        throw new Error(json.error ?? assetConnectionEdgeMessage("confirm_failed"));
      }
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        transitions: mapAssetTransitions(json.assets, sourceNodeId)
      }));
      setMessage(assetConnectionEdgeMessage("confirmed", json.result.edge.name ?? draft.taskName));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function previewAutoExplore(options: { maxDepth: number; maxCandidates: number; maxActions: number }) {
    await requestAutoExplore("preview", options);
  }

  async function runAutoExplore(options: { maxDepth: number; maxCandidates: number; maxActions: number }) {
    await requestAutoExplore("run", options);
  }

  async function requestAutoExplore(mode: "preview" | "run", options: { maxDepth: number; maxCandidates: number; maxActions: number }) {
    if (!selectedSerial || !selectedDevice) {
      setMessage("请先选择设备");
      return;
    }
    const graphVersionId = assetRecordingPage.graphVersionId || assetRecordingGraphVersionId || (await fetchWritableGraphVersionId(selectedDevice.platform));
    if (!graphVersionId) {
      setMessage("未找到可写入的页面资产库版本");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/auto-explorer/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceSerial: selectedSerial,
          maxDepth: options.maxDepth,
          maxCandidates: options.maxCandidates,
          maxActions: options.maxActions
        })
      });
      const json = (await response.json().catch(() => ({}))) as {
        report?: AssetRecordingAutoExploreReport;
        error?: string;
      };
      if (!response.ok || !json.report) {
        throw new Error(json.error ?? "自动探索失败");
      }
      setAssetRecordingGraphVersionId(graphVersionId);
      setAssetAutoExploreReport(json.report);
      const action = mode === "preview" ? "已生成自动探索候选" : "自动探索执行完成";
      setMessage(json.report.status === "blocked" ? json.report.message ?? "自动探索已阻断" : `${action}：${json.report.plan.steps.length} 步`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAssetOperationTransition(transition: NonNullable<AssetRecordingCurrentPage["transitions"]>[number]) {
    const graphVersionId = assetRecordingPage.graphVersionId;
    if (!graphVersionId) {
      setMessage("当前页面还没有关联业务图谱版本");
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/transitions/${encodeURIComponent(transition.id)}`, {
        method: "DELETE"
      });
      const json = (await response.json().catch(() => ({}))) as {
        assets?: CurrentPageAssetApiResponse["assets"];
        result?: { status?: string };
        error?: string;
      };
      if (!response.ok || json.result?.status !== "deleted") {
        throw new Error(json.error ?? assetConnectionEdgeMessage("delete_failed"));
      }
      const sourceNodeId = assetRecordingPage.nodeId;
      setAssetRecordingPage((page) => ({
        ...page,
        savedAssets: mapPageAssets(json.assets),
        transitions: mapAssetTransitions(json.assets, sourceNodeId),
        elements: removeManualElementForTransition(page.elements ?? [], transition)
      }));
      setMessage(assetConnectionEdgeMessage("deleted", transition.name));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const workspaceStyle: RecordingWorkspaceStyle = workspaceStyleForNav(activeNavItem, recordingPreviewWidth, assetRecordingPreviewWidth);

  const stepsPanel = (
    <StepsPanel
      activeTab={activeNavItem === "runs" ? "runs" : automationTab}
      steps={steps}
      selectedDevice={selectedDevice}
      selectedCaseId={selectedCaseId}
      recording={recording}
      caseName={caseName}
      repeatCount={repeatCount}
      stepIntervalMs={stepIntervalMs}
      loopUntilStopped={loopUntilStopped}
      pauseAfterEachStep={pauseAfterEachStep}
      startStrategy={startStrategy}
      startAppPackageName={startAppPackageName}
      startSetupScope={startSetupScope}
      currentRun={currentRun}
      currentGraphRun={currentGraphRun}
      runs={runs}
      runsLimit={runsLimit}
      activeRunForSelectedDevice={activeRunForSelectedDevice}
      selectedSerial={selectedSerial}
      setRecording={setRecording}
      setCaseName={setCaseName}
      setRepeatCount={setRepeatCount}
      setStepIntervalMs={setStepIntervalMs}
      setLoopUntilStopped={setLoopUntilStopped}
      setPauseAfterEachStep={setPauseAfterEachStep}
      setStartStrategy={setStartStrategy}
      setStartAppPackageName={setStartAppPackageName}
      setStartSetupScope={setStartSetupScope}
      moveStep={moveStep}
      removeStep={removeStep}
      insertWaitStep={insertWaitStep}
      insertConditionalTapStep={insertConditionalTapStep}
      copyStep={copyStep}
      toggleStepEnabled={toggleStepEnabled}
      updateStep={updateStep}
      addStepExpectation={addStepExpectation}
      updateStepExpectation={updateStepExpectation}
      removeStepExpectation={removeStepExpectation}
      resetEditor={resetEditor}
      saveCase={saveCaseAndOpenLibrary}
      stopCurrentRun={stopCurrentRun}
      pauseCurrentRun={pauseCurrentRun}
      resumeCurrentRun={resumeCurrentRun}
      stepCurrentRun={stepCurrentRun}
      setCurrentRunId={setCurrentRunId}
      loadMoreRuns={loadMoreRuns}
    />
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>自动化测试平台</h1>
        </div>
        <p>{message}</p>
      </header>

      <section ref={workspaceRef} className={`workspace ${navCollapsed ? "nav-collapsed" : "nav-expanded"} page-${activeNavItem}`} style={workspaceStyle}>
        <AppNav
          activeNavItem={activeNavItem}
          navCollapsed={navCollapsed}
          setNavCollapsed={setNavCollapsed}
          openDevices={openDevices}
          openRecording={openRecording}
          openCaseLibrary={openCaseLibrary}
          openAssetRecording={openAssetRecording}
          openPageAssets={openPageAssets}
          openRuns={openRuns}
          openGraphs={() => setActiveNavItem("graphs")}
        />

        {activeNavItem === "devices" && (
          <DeviceManagementView
            devices={devices}
            selectedSerial={selectedSerial}
            selectedDevice={selectedDevice}
            tools={tools}
            cases={cases}
            runs={runs}
            activeRunForSelectedDevice={activeRunForSelectedDevice}
            selectedDeviceBusy={selectedDeviceBusy}
            onSelectDevice={selectDeviceAndCloseStream}
            onLoadCase={editCaseFromLibrary}
            onStartRun={startSavedCaseRun}
            onDeleteCase={deleteCase}
            onOpenRecording={openRecording}
            onOpenRuns={openRuns}
            onRefreshDevices={() => refreshDevices().catch((error) => setMessage(error.message))}
          />
        )}

        {activeNavItem === "caseLibrary" && (
          <CaseLibraryPanel
            flows={structuredFlows}
            runs={runs}
            searchText={flowSearchText}
            selectedFlowId={selectedFlowId}
            highlightedFlowId={highlightedFlowId}
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            onSearchTextChange={setFlowSearchText}
            onSelectFlow={setSelectedFlowId}
            onEditFlow={editCaseFromLibrary}
            onStartFlowRun={startSavedFlowRun}
            onUpdateFlow={updateStructuredFlow}
            onDeleteFlow={deleteStructuredFlow}
          />
        )}

        {activeNavItem === "recording" && (
          <>
            <PreviewPanel
              key={`preview-${activePreviewWorkspaceKey}-${selectedSerial || "none"}`}
              devices={devices}
              selectedSerial={selectedSerial}
              selectedDevice={selectedDevice}
              previewRef={previewRef}
              imageRef={imageRef}
              canvasRef={canvasRef}
              videoRef={videoRef}
              previewUrl={previewUrl}
              screenshotError={screenshotError}
              previewMode={previewMode}
              previewRenderer={previewRenderer}
              scrcpyStreamStatus={scrcpyStreamStatus}
              isScrcpyPreviewActive={isScrcpyPreviewActive}
              scrcpyAvailable={scrcpyAvailable}
              scrcpyRunning={scrcpyRunning}
              busy={busy}
              inputText={inputText}
              setInputText={setInputText}
              setMessage={setMessage}
              startScrcpy={startScrcpy}
              stopScrcpy={stopScrcpy}
              runAction={runAction}
              onSelectDevice={selectDeviceAndCloseStream}
              handleScreenshotLoaded={handleScreenshotLoaded}
              onPreviewPointerDown={onPreviewPointerDown}
              onPreviewPointerUp={onPreviewPointerUp}
              onPreviewPointerCancel={onPreviewPointerCancel}
            />
            <div className="recording-resizer" onPointerDown={onRecordingResizePointerDown} role="separator" aria-orientation="vertical" aria-label="调整预览和步骤区域宽度" title="拖动调整左右区域宽度" />
            <div className="recording-side-stack">
              <RuntimeInterceptorPanel
                selectedSerial={selectedSerial}
                selectedDevice={selectedDevice}
                rules={runtimeInterceptorRules}
                onMarkCurrentPage={markCurrentPageAsRuntimeInterceptor}
                onDeleteRule={deleteRuntimeInterceptorRule}
              />
              {stepsPanel}
            </div>
          </>
        )}

        {activeNavItem === "assetRecording" && (
          <AssetRecordingPanel
            selectedSerial={selectedSerial}
            selectedDeviceName={selectedDevice?.name || selectedDevice?.serial}
            busy={busy || assetRecordingIdentifying}
            identifying={assetRecordingIdentifying}
            currentPage={assetRecordingPage}
            onPageDraftChange={(patch) => setAssetRecordingPage((page) => ({ ...page, ...patch }))}
            onIdentifyCurrentPage={identifyCurrentPageAsset}
            onSaveCurrentPageAsset={saveCurrentPageAsset}
            onConfirmOperationTransition={confirmAssetOperationTransition}
            onConfirmPageTaskTransition={confirmAssetPageTaskTransition}
            onDeleteOperationTransition={deleteAssetOperationTransition}
            onSavePageElement={saveAssetPageElement}
            onDeletePageElement={deleteAssetPageElement}
            onSavePageTask={saveAssetPageTask}
            onDeletePageTask={deleteAssetPageTask}
            autoExploreReport={assetAutoExploreReport}
            onPreviewAutoExplore={previewAutoExplore}
            onRunAutoExplore={runAutoExplore}
            onResizePointerDown={onAssetRecordingResizePointerDown}
            previewSlot={
              <PreviewPanel
                key={`preview-${activePreviewWorkspaceKey}-${selectedSerial || "none"}`}
                devices={devices}
                selectedSerial={selectedSerial}
                selectedDevice={selectedDevice}
                previewRef={previewRef}
                imageRef={imageRef}
                canvasRef={canvasRef}
                videoRef={videoRef}
                previewUrl={previewUrl}
                screenshotError={screenshotError}
                previewMode={previewMode}
                previewRenderer={previewRenderer}
                scrcpyStreamStatus={scrcpyStreamStatus}
                isScrcpyPreviewActive={isScrcpyPreviewActive}
                scrcpyAvailable={scrcpyAvailable}
                scrcpyRunning={scrcpyRunning}
                busy={busy || assetRecordingIdentifying}
                inputText={inputText}
                setInputText={setInputText}
                setMessage={setMessage}
                startScrcpy={startScrcpy}
                stopScrcpy={stopScrcpy}
                runAction={runAction}
                onSelectDevice={selectDeviceAndCloseStream}
                handleScreenshotLoaded={handleScreenshotLoaded}
                onPreviewPointerDown={onPreviewPointerDown}
                onPreviewPointerUp={onPreviewPointerUp}
                onPreviewPointerCancel={onPreviewPointerCancel}
                compact
              />
            }
          />
        )}

        {activeNavItem === "pageAssets" && (
          <PageAssetsPanel
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            onOpenAssetRecording={openAssetRecording}
            onRunStarted={(runId) => {
              setCurrentRunId(runId);
              setActiveNavItem("runs");
              setAutomationTab("runs");
            }}
            setMessage={setMessage}
          />
        )}

        {activeNavItem === "runs" && <section className="module-page execution-module">{stepsPanel}</section>}

        {activeNavItem === "graphs" && (
          <GraphCandidatesPanel
            setMessage={setMessage}
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            onRunStarted={(runId) => {
              setCurrentRunId(runId);
              setActiveNavItem("runs");
              setAutomationTab("runs");
            }}
          />
        )}
      </section>
    </main>
  );
}

type DeviceManagementViewProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  tools: ToolStatus[];
  cases: TestCase[];
  runs: TestRun[];
  activeRunForSelectedDevice?: TestRun;
  selectedDeviceBusy: boolean;
  onSelectDevice: (device: DeviceInfo) => void;
  onLoadCase: (caseId: string) => Promise<void>;
  onStartRun: (caseId: string) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
  onOpenRecording: () => void;
  onOpenRuns: () => void;
  onRefreshDevices: () => void;
};

function DeviceManagementView({
  devices,
  selectedSerial,
  selectedDevice,
  tools,
  cases,
  runs,
  activeRunForSelectedDevice,
  selectedDeviceBusy,
  onSelectDevice,
  onLoadCase,
  onStartRun,
  onDeleteCase,
  onOpenRecording,
  onOpenRuns,
  onRefreshDevices
}: DeviceManagementViewProps) {
  const selectedDeviceRuns = selectedSerial ? runs.filter((run) => run.deviceSerial === selectedSerial).slice(0, 5) : [];
  const onlineCount = devices.filter((device) => device.status === "online").length;
  const controllableCount = devices.filter((device) => device.capabilities.tap || device.capabilities.swipe).length;
  const activeRunsCount = runs.filter(isActiveRunStatus).length;

  return (
    <section className="module-page device-module">
      <DeviceSidebar
        devices={devices}
        selectedSerial={selectedSerial}
        cases={cases}
        runs={runs}
        selectedDeviceBusy={selectedDeviceBusy}
        onSelectDevice={onSelectDevice}
        onLoadCase={onLoadCase}
        onStartRun={onStartRun}
        onDeleteCase={onDeleteCase}
        showCases={false}
      />

      <div className="device-detail-panel">
        <div className="panel module-head-panel">
          <div>
            <span className="module-eyebrow">设备管理</span>
            <h2>设备资产与可用状态</h2>
            <ToolStatusBar tools={tools} />
          </div>
          <div className="device-head-actions">
            <div className="module-stat-grid">
              <div>
                <strong>{devices.length}</strong>
                <span>发现设备</span>
              </div>
              <div>
                <strong>{onlineCount}</strong>
                <span>在线</span>
              </div>
              <div>
                <strong>{controllableCount}</strong>
                <span>可控制</span>
              </div>
              <div>
                <strong>{activeRunsCount}</strong>
                <span>执行中</span>
              </div>
            </div>
            <button className="icon-button" onClick={onRefreshDevices} title="刷新设备" type="button">
              <RefreshCw size={18} />
              刷新设备
            </button>
          </div>
        </div>

        <div className="panel device-profile-card">
          {selectedDevice ? (
            <>
              <div className="device-profile-head">
                <div>
                  <h2>{selectedDevice.name || selectedDevice.serial}</h2>
                  <span>{selectedDevice.serial}</span>
                </div>
                <div className="device-profile-actions">
                  <span className={`device-status-pill ${selectedDevice.status}`}>{selectedDevice.status}</span>
                  <button className="icon-button primary" type="button" onClick={onOpenRecording}>
                    进入录制
                  </button>
                  <button className="icon-button" type="button" onClick={onOpenRuns}>
                    查看执行
                  </button>
                </div>
              </div>

              <div className="device-facts">
                <div>
                  <span>平台</span>
                  <strong>{selectedDevice.platform === "ios" ? "iOS" : "Android"}</strong>
                </div>
                <div>
                  <span>系统</span>
                  <strong>{selectedDevice.osVersion || "未知"}</strong>
                </div>
                <div>
                  <span>型号</span>
                  <strong>{selectedDevice.model || selectedDevice.manufacturer || "未知"}</strong>
                </div>
                <div>
                  <span>分辨率</span>
                  <strong>{selectedDevice.resolution ? `${selectedDevice.resolution.width} x ${selectedDevice.resolution.height}` : "未知"}</strong>
                </div>
                <div>
                  <span>方向</span>
                  <strong>{selectedDevice.orientation || "未知"}</strong>
                </div>
                <div>
                  <span>最后发现</span>
                  <strong>{formatDateTime(selectedDevice.lastSeenAt)}</strong>
                </div>
              </div>

              {activeRunForSelectedDevice && (
                <div className="device-active-run">
                  <strong>当前设备执行中</strong>
                  <span>{activeRunForSelectedDevice.caseName}</span>
                  <button className="icon-button" type="button" onClick={onOpenRuns}>
                    查看执行
                  </button>
                </div>
              )}

              <div className="capability-section">
                <h2>控制能力</h2>
                <div className="capability-grid">
                  {buildCapabilityItems(selectedDevice).map((item) => (
                    <span className={item.enabled ? "capability-chip enabled" : "capability-chip"} key={item.label}>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>

            </>
          ) : (
            <div className="empty device-empty-state">请先在左侧选择一台设备</div>
          )}
        </div>

        <div className="panel device-runs-card">
          <div className="panel-head">
            <h2>该设备最近执行</h2>
            <button className="icon-button compact" type="button" onClick={onOpenRuns} title="打开用例执行">
              <PlayCircle size={16} />
            </button>
          </div>
          <div className="device-run-list">
            {selectedDeviceRuns.map((run) => (
              <button key={run.id} type="button" onClick={onOpenRuns}>
                <div>
                  <strong>{run.caseName}</strong>
                  <span>{formatDateTime(run.startedAt)} · {run.id}</span>
                </div>
                <span className={`run-status-mini ${run.status}`}>{run.status}</span>
              </button>
            ))}
            {!selectedDeviceRuns.length && <div className="empty">暂无该设备执行记录</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function selectRecordingGraphVersionId(
  graphs: GraphListItem[],
  platform: DeviceInfo["platform"]
): string | undefined {
  return graphs.find((graph) => {
    if (graph.status === "deprecated" || !graph.activeVersion?.id) {
      return false;
    }
    if (graph.activeVersion.status && graph.activeVersion.status !== "active") {
      return false;
    }
    return graph.platformScope === platform || graph.platformScope === "mobile-both";
  })?.activeVersion?.id;
}

async function fetchWritableGraphVersionId(platform: DeviceInfo["platform"]): Promise<string | undefined> {
  const response = await fetch("/api/graphs");
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { graphs: GraphListItem[] };
  return selectRecordingGraphVersionId(json.graphs, platform);
}

async function readCurrentPageAssetResponse(response: Response): Promise<CurrentPageAssetApiResponse> {
  const text = await response.text();
  if (!text.trim()) {
    return { error: response.statusText || `请求失败：${response.status}` };
  }
  try {
    return JSON.parse(text) as CurrentPageAssetApiResponse;
  } catch {
    return { error: "服务返回了非 JSON 响应，请确认后端服务和代理配置正常" };
  }
}

export async function currentPageAssetErrorMessage(response: Response): Promise<string> {
  const json = await readCurrentPageAssetResponse(response);
  return json.error ?? "当前页面识别失败";
}

export function mapCurrentPageAssetResponse(response: CurrentPageAssetApiResponse, graphVersionId?: string): AssetRecordingCurrentPage {
  const result = response.result;
  if (!result) {
    return {
      status: "error",
      message: response.error ?? "当前页面识别失败"
    };
  }
  const observation = result.observation;
  const candidate = result.match.candidates?.[0];
  const matchedPageNode = result.status === "matched" ? result.match.node : undefined;
  const node = matchedPageNode ?? result.node;
  const nodeMetadata = matchedPageNode?.metadata ?? result.node?.metadata;
  const visualPageName = sanitizeAssetDisplayName(result.visualPageName ?? stringMetadata(nodeMetadata, "visualPageName") ?? inferVisualPageName(observation, node?.name));
  const screenshotRegions = screenshotRegionsMetadata(nodeMetadata);
  const isMatchedAsset = result.status === "matched" || Boolean(matchedPageNode);
  const pageName = stringMetadata(nodeMetadata, "pageName") ?? (isMatchedAsset ? sanitizeAssetDisplayName(node?.name) ?? visualPageName : visualPageName ?? sanitizeAssetDisplayName(node?.name));
  const mappedStatus = matchedPageNode ? "matched" : result.status;
  return {
    status: mappedStatus,
    graphVersionId,
    assetKind: "page",
    nodeId: matchedPageNode?.id ?? (result.status === "draft_candidate" ? undefined : result.match.node?.id ?? result.node?.id ?? candidate?.node?.id),
    observation,
    match: result.match,
    pageName,
    visualPageName,
    matchedAssetName: isMatchedAsset && node?.name && node.name !== pageName ? node.name : undefined,
    matchedAssetKey: isMatchedAsset ? node?.key : undefined,
    targetRef: node?.key,
    aliasText: arrayMetadata(nodeMetadata, "alias").join("，"),
    intentTagsText: arrayMetadata(nodeMetadata, "intentTags").join("，"),
    matchScore: result.match.score || candidate?.score,
    packageName: observation?.packageName ?? observation?.bundleId,
    activityName: observation?.activityName ?? observation?.componentName,
    screenshotUrl: observationScreenshotUrl(observation),
    screenshotRegions,
    matchedMatchers: summarizeEvidenceDiagnostics(result.matcherDiagnostics?.matchedEvidence) ?? summarizeMatcherResults(candidate?.matcherResults, true),
    missedMatchers: summarizeEvidenceDiagnostics(result.matcherDiagnostics?.missingEvidence) ?? summarizeMatcherResults(candidate?.matcherResults, false),
    confirmedMatchers: arrayMetadata(nodeMetadata, "confirmedMatchers"),
    confirmedUiTexts: arrayMetadata(nodeMetadata, "confirmedUiTexts"),
    confirmedOcrTexts: arrayMetadata(nodeMetadata, "confirmedOcrTexts"),
    uiTexts: summarizeObservationTexts(observation, "ui"),
    ocrTexts: summarizeObservationTexts(observation, "ocr"),
    elements: mergeOperationElements(manualOperationElementsMetadata(nodeMetadata, observation?.resolution), summarizeObservationElements(observation)),
    transitions: mapAssetTransitions(response.assets, matchedPageNode?.id ?? result.match.node?.id ?? result.node?.id ?? candidate?.node?.id),
    tasks: pageTasksMetadata(nodeMetadata),
    aiDescription: stringMetadata(nodeMetadata, "aiDescription") ?? summarizeAssetAiDescription(mappedStatus, pageName, observation),
    savedAssets: mapPageAssets(response.assets)
  };
}

function mapAssetTransitions(assets: CurrentPageAssetApiResponse["assets"], nodeId: string | undefined): AssetRecordingCurrentPage["transitions"] {
  if (!nodeId) {
    return [];
  }
  const asset = (assets?.pageAssets ?? []).find((item) => item.id === nodeId);
  return (asset?.transitions ?? []).map((transition) => ({
    id: transition.id,
    name: transition.name,
    status: transition.status,
    source: transition.source,
    actionSummary: transition.actionSummary,
    targetName: transition.targetName,
    targetKey: transition.targetKey,
    expectationSummary: transition.expectationSummary,
    reliabilityScore: transition.reliabilityScore,
    actionLocator: transition.actionLocator,
    actionKind: transition.actionKind
  }));
}

function mapPageAssets(assets: CurrentPageAssetApiResponse["assets"]): AssetRecordingCurrentPage["savedAssets"] {
  return (assets?.pageAssets ?? []).map((asset) => ({
    id: asset.id,
    key: asset.key,
    name: asset.name,
    status: asset.status,
    platformScope: asset.platformScope,
    matcherCount: asset.matcherCount,
    elementCount: asset.elementCount,
    updatedAt: asset.updatedAt
  }));
}

function pageTasksMetadata(metadata: Record<string, unknown> | undefined): NonNullable<AssetRecordingCurrentPage["tasks"]> {
  const value = metadata?.assetRecordingPageTasks;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(pageTaskMetadata)
    .filter((task): task is NonNullable<AssetRecordingCurrentPage["tasks"]>[number] => Boolean(task))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function pageTaskMetadata(value: unknown): NonNullable<AssetRecordingCurrentPage["tasks"]>[number] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const task = value as Record<string, unknown>;
  const id = stringMetadata(task, "id");
  const name = stringMetadata(task, "name");
  if (!id || !name) {
    return undefined;
  }
  const status = task.status === "draft" || task.status === "deprecated" ? task.status : "active";
  const steps = pageTaskStepsMetadata(task.steps);
  return {
    id,
    name,
    status,
    steps,
    createdAt: stringMetadata(task, "createdAt"),
    updatedAt: stringMetadata(task, "updatedAt")
  };
}

function pageTaskStepsMetadata(value: unknown): AssetRecordingPageTask["steps"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index): AssetRecordingPageTask["steps"][number] | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const step = item as Record<string, unknown>;
      return {
        id: stringMetadata(step, "id"),
        order: numberMetadata(step.order) ?? index + 1,
        elementId: stringMetadata(step, "elementId"),
        fieldType: pageTaskFieldTypeMetadata(step.fieldType),
        label: stringMetadata(step, "label"),
        valueParamKey: stringMetadata(step, "valueParamKey"),
        desiredStateParamKey: stringMetadata(step, "desiredStateParamKey"),
        text: stringMetadata(step, "text")
      };
    })
    .filter((step): step is AssetRecordingPageTask["steps"][number] => Boolean(step))
    .sort((left, right) => left.order - right.order);
}

function pageTaskFieldTypeMetadata(value: unknown): AssetRecordingPageTask["steps"][number]["fieldType"] {
  return value === "text_input" ||
    value === "picker_select" ||
    value === "toggle_set" ||
    value === "subpage_edit" ||
    value === "submit" ||
    value === "tap" ||
    value === "wait"
    ? value
    : "tap";
}

function inferVisualPageName(observation: RecordingObservation | undefined, fallback?: string): string | undefined {
  const texts = compactUnique(
    [
      ...(observation?.uiElements.map((element) => element.text) ?? []),
      ...(observation?.ocrTexts.map((text) => text.text) ?? [])
    ]
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text)),
    24
  );
  return texts.find((text) => isLikelyPageTitle(text)) ?? fallback;
}

function sanitizeAssetDisplayName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^(运行期未知节点|录制节点)：\s*/, "").trim() || trimmed;
}

function isLikelyPageTitle(text: string): boolean {
  return text.length <= 12 && !/^\d+$/.test(text) && /[\u4e00-\u9fa5]/.test(text);
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function observationScreenshotUrl(observation: RecordingObservation | undefined): string | undefined {
  const screenshotBase64 = observation?.raw?.screenshotBase64;
  if (typeof screenshotBase64 === "string" && screenshotBase64.trim()) {
    return `data:image/png;base64,${screenshotBase64}`;
  }
  return observation?.deviceSerial ? `/api/devices/${encodeURIComponent(observation.deviceSerial)}/screenshot?force=true&t=${Date.now()}` : undefined;
}

function arrayMetadata(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function screenshotRegionsMetadata(metadata: Record<string, unknown> | undefined): AssetRecordingCurrentPage["screenshotRegions"] {
  const value = metadata?.screenshotRegions;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const region = item as Record<string, unknown>;
      const x = numberMetadata(region.x);
      const y = numberMetadata(region.y);
      const width = numberMetadata(region.width);
      const height = numberMetadata(region.height);
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        return undefined;
      }
      const ignoreRegions = screenshotRegionRectsMetadata(region.ignoreRegions);
      return {
        id: stringMetadata(region, "id") ?? `region-${index + 1}`,
        label: stringMetadata(region, "label") ?? `重点区域 ${index + 1}`,
        x,
        y,
        width,
        height,
        ...(typeof region.semanticArea === "string" ? { semanticArea: region.semanticArea } : {}),
        ...(typeof region.coordinateSpace === "string" ? { coordinateSpace: region.coordinateSpace } : {}),
        ...(ignoreRegions.length ? { ignoreRegions } : {})
      };
    })
    .filter((item): item is NonNullable<AssetRecordingCurrentPage["screenshotRegions"]>[number] => Boolean(item));
}

function screenshotRegionRectsMetadata(value: unknown): Array<{ x: number; y: number; width: number; height: number }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const region = item as Record<string, unknown>;
      const x = numberMetadata(region.x);
      const y = numberMetadata(region.y);
      const width = numberMetadata(region.width);
      const height = numberMetadata(region.height);
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        return undefined;
      }
      return { x, y, width, height };
    })
    .filter((item): item is { x: number; y: number; width: number; height: number } => Boolean(item));
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function manualOperationElementsMetadata(metadata: Record<string, unknown> | undefined, resolution: RecordingObservation["resolution"]): NonNullable<AssetRecordingCurrentPage["elements"]> {
  type PageElement = NonNullable<AssetRecordingCurrentPage["elements"]>[number];
  const value = metadata?.assetRecordingManualElements;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): PageElement | undefined => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const element = item as Record<string, unknown>;
      const label = stringMetadata(element, "label");
      const locator = stringMetadata(element, "locator");
      if (!label || !locator) {
        return undefined;
      }
      const id = stringMetadata(element, "id");
      const abilityType = manualOperationAbilityType(element.abilityType);
      const actionKind = manualOperationActionKind(element.actionKind);
      const availability = manualOperationAvailability(element.availability);
      const semanticArea = visualSemanticAreaMetadata(element.semanticArea);
      const coordinateSpace = coordinateSpaceMetadata(element.coordinateSpace);
      const region = rectMetadata(element.region);
      const scrollProfile = scrollProfileMetadata(element.scrollProfile);
      const outcomeType = stringMetadata(element, "outcomeType");
      const outcomeLabel = stringMetadata(element, "outcomeLabel") ?? stringMetadata(element, "targetLabel");
      const targetNodeId = stringMetadata(element, "targetNodeId");
      const targetLabel = stringMetadata(element, "targetLabel");
      const targetText = stringMetadata(element, "targetText");
      const compoundSteps = compoundStepsMetadata(element.compoundSteps);
      return {
        ...(id ? { id } : {}),
        label,
        locator,
        ...(semanticArea ? { semanticArea } : {}),
        ...(coordinateSpace ? { coordinateSpace } : {}),
        action: stringMetadata(element, "action") ?? actionKind,
        ...(abilityType ? { abilityType } : {}),
        actionKind,
        availability,
        source: "manual",
        ...(region ? { region } : {}),
        ...(resolution ? { viewport: resolution } : {}),
        ...(outcomeType ? { outcomeType: outcomeType as NonNullable<PageElement["outcomeType"]> } : {}),
        ...(outcomeLabel ? { outcomeLabel } : {}),
        ...(targetNodeId ? { targetNodeId } : {}),
        ...(targetLabel ? { targetLabel } : {}),
        ...(targetText ? { targetText } : {}),
        ...(compoundSteps.length ? { compoundSteps } : {}),
        ...(scrollProfile ? { scrollProfile } : {})
      };
    })
    .filter((item): item is PageElement => Boolean(item));
}

function mergeOperationElements(
  manualElements: NonNullable<AssetRecordingCurrentPage["elements"]>,
  candidateElements: NonNullable<AssetRecordingCurrentPage["elements"]>
): NonNullable<AssetRecordingCurrentPage["elements"]> {
  const manualKeys = new Set(manualElements.map((element) => `${element.actionKind ?? element.action}:${element.locator}`));
  const manualIds = new Set(manualElements.map((element) => element.id).filter(Boolean));
  return [
    ...manualElements,
    ...candidateElements.filter((element) => !manualKeys.has(`${element.actionKind ?? element.action}:${element.locator}`) && (!element.id || !manualIds.has(element.id)))
  ];
}

function mergePageTasks(
  nextTasks: NonNullable<AssetRecordingCurrentPage["tasks"]>,
  currentTasks: NonNullable<AssetRecordingCurrentPage["tasks"]>
): NonNullable<AssetRecordingCurrentPage["tasks"]> {
  const nextIds = new Set(nextTasks.map((task) => task.id));
  return [...currentTasks.filter((task) => !nextIds.has(task.id)), ...nextTasks].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function manualElementFromOperationDraft(
  draft: AssetRecordingPageElementDraft,
  _platformScope: string,
  persistedElement?: Record<string, unknown>
): NonNullable<AssetRecordingCurrentPage["elements"]>[number] {
  const region = imageRegionMetadata(draft.locator);
  const id = stringMetadata(persistedElement, "id");
  const abilityType = manualOperationAbilityType(persistedElement?.abilityType) ?? draft.abilityType;
  const targetNodeId = stringMetadata(persistedElement, "targetNodeId") ?? draft.targetNodeId;
  const targetLabel = stringMetadata(persistedElement, "targetLabel") ?? draft.targetLabel;
  const targetText = stringMetadata(persistedElement, "targetText") ?? draft.targetText;
  const semanticArea = visualSemanticAreaMetadata(persistedElement?.semanticArea) ?? draft.semanticArea;
  const coordinateSpace = coordinateSpaceMetadata(persistedElement?.coordinateSpace) ?? draft.coordinateSpace;
  return {
    ...(id ?? draft.elementId ? { id: id ?? draft.elementId } : {}),
    label: draft.elementLabel,
    locator: draft.locator,
    ...(semanticArea ? { semanticArea } : {}),
    ...(coordinateSpace ? { coordinateSpace } : {}),
    action: draft.actionKind,
    ...(abilityType ? { abilityType } : {}),
    actionKind: draft.actionKind,
    availability: draft.availability,
    source: "manual",
    ...(region ? { region } : {}),
    ...(draft.outcomeType ? { outcomeType: draft.outcomeType } : {}),
    ...(draft.outcomeLabel ? { outcomeLabel: draft.outcomeLabel } : {}),
    ...(targetNodeId ? { targetNodeId } : {}),
    ...(targetLabel ? { targetLabel } : {}),
    ...(targetText ? { targetText } : {}),
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {})
  };
}

function removeManualElementForTransition(
  elements: NonNullable<AssetRecordingCurrentPage["elements"]>,
  transition: NonNullable<AssetRecordingCurrentPage["transitions"]>[number]
): NonNullable<AssetRecordingCurrentPage["elements"]> {
  if (!transition.actionLocator) {
    return elements;
  }
  return elements.filter((element) => !(element.source === "manual" && element.locator === transition.actionLocator && (!transition.actionKind || transition.actionKind === element.actionKind)));
}

function imageRegionMetadata(locator: string): { x: number; y: number; width: number; height: number } | undefined {
  if (!locator.startsWith("image-region:")) {
    return undefined;
  }
  const [x, y, width, height] = locator
    .replace(/^image-region:\s*/, "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function rectMetadata(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = numberMetadata(input.x);
  const y = numberMetadata(input.y);
  const width = numberMetadata(input.width);
  const height = numberMetadata(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function manualOperationActionKind(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["actionKind"]> {
  return value === "scroll" || value === "long_press" || value === "input" || value === "unknown" ? value : "tap";
}

function manualOperationAvailability(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["availability"]> {
  return value === "after_scroll" || value === "conditional" ? value : "visible";
}

function manualOperationAbilityType(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["abilityType"]> | undefined {
  return value === "fixed_tap" || value === "scroll_candidate" || value === "grid_candidate" || value === "conditional_tap" ? value : undefined;
}

function visualSemanticAreaMetadata(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["semanticArea"]> | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function coordinateSpaceMetadata(value: unknown): "screen" | "app_viewport" | "region" | undefined {
  return value === "screen" || value === "app_viewport" || value === "region" ? value : undefined;
}

function scrollProfileMetadata(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["scrollProfile"]> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  return {
    containerKind: input.containerKind === "grid_list" || input.containerKind === "tab_bar" || input.containerKind === "carousel" || input.containerKind === "scroll_area" ? input.containerKind : "list",
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    columns: numberMetadata(input.columns),
    targetKind: input.targetKind === "ocr_text" || input.targetKind === "semantic_label" || input.targetKind === "nth_item" || input.targetKind === "image_region" ? input.targetKind : "item_text",
    targetQuery: stringMetadata(input, "targetQuery"),
    afterFoundAction: input.afterFoundAction === "tap_child" || input.afterFoundAction === "verify_visible" ? input.afterFoundAction : "tap_item",
    candidateItemHeightPercent: numberMetadata(input.candidateItemHeightPercent),
    clickSafePoint: clickSafePointMetadata(input.clickSafePoint),
    scrollStepPercent: numberMetadata(input.scrollStepPercent),
    failureStrategy: input.failureStrategy === "none" || input.failureStrategy === "try_next_candidate" || input.failureStrategy === "back_and_try_next_candidate" ? input.failureStrategy : undefined
  };
}

function clickSafePointMetadata(value: unknown): { xPercent: number; yPercent: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const xPercent = numberMetadata(input.xPercent);
  const yPercent = numberMetadata(input.yPercent);
  if (xPercent === undefined || yPercent === undefined) {
    return undefined;
  }
  return { xPercent, yPercent };
}

function compoundStepsMetadata(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["compoundSteps"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const steps: NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["compoundSteps"]> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const step = item as Record<string, unknown>;
    const type = step.type === "wait_until_state" || step.type === "tap_on_text" ? step.type : undefined;
    const text = stringMetadata(step, "text");
    if (!type || !text) {
      continue;
    }
    steps.push({
      type,
      text,
      label: stringMetadata(step, "label"),
      timeoutMs: numberMetadata(step.timeoutMs)
    });
  }
  return steps;
}

function summarizeMatcherResults(
  matcherResults: Array<{ type?: string; expected?: string; actual?: string; matched?: boolean }> | undefined,
  matched: boolean
): string[] {
  return (matcherResults ?? [])
    .filter((result) => result.matched === matched)
    .slice(0, 8)
    .map((result) => `${result.type ?? "matcher"}:${result.expected ?? result.actual ?? "unknown"}`);
}

function summarizeEvidenceDiagnostics(evidence: CurrentPageMatcherEvidenceApi[] | undefined): string[] | undefined {
  if (!evidence) {
    return undefined;
  }
  return evidence
    .slice(0, 8)
    .map((result) => `${result.type ?? "matcher"}:${result.expected ?? result.actual ?? "unknown"}`);
}

function summarizeObservationElements(observation: RecordingObservation | undefined) {
  const previewCrop = summarizeOperationPreviewCrop(observation?.resolution);
  const elementCandidates = (observation?.uiElements ?? [])
    .filter((element) => element.visible !== false && hasStableOperationSignal(element))
    .slice(0, 18)
    .map((element) => {
      const actionKind = summarizeElementActionKind(element);
      const region = summarizeElementRegion(element, observation?.resolution);
      return {
        label: element.text || element.contentDesc || element.accessibilityId || element.resourceId || element.className || "未命名元素",
        locator: element.resourceId
          ? `resource-id: ${element.resourceId}`
          : element.accessibilityId || element.contentDesc
            ? `accessibility/desc: ${element.accessibilityId ?? element.contentDesc}`
            : element.text
              ? `text: ${element.text}`
              : element.className
                ? `class: ${element.className}`
                : "locator 待确认",
        action: actionKind === "scroll" ? "scroll" : actionKind === "long_press" ? "long_press / tap" : "tap",
        actionKind,
        availability: summarizeElementAvailability(element),
        ...(region ? { region } : {}),
        previewCrop,
        viewport: observation?.resolution,
        ...(actionKind === "scroll" ? { scrollProfile: summarizeScrollProfile(element) } : {})
      };
    });
  return [...elementCandidates, ...summarizeInferredScrollRegions(observation, previewCrop)];
}

function summarizeInferredScrollRegions(observation: RecordingObservation | undefined, previewCrop: ReturnType<typeof summarizeOperationPreviewCrop>) {
  const resolution = observation?.resolution;
  if (!resolution?.width || !resolution.height) {
    return [];
  }
  const cardElements = (observation?.uiElements ?? [])
    .filter((element) => element.visible !== false && element.bounds && looksLikeScrollableCardText(element))
    .slice(0, 12);
  if (cardElements.length < 3) {
    return [];
  }
  const bounds = combinedBounds(cardElements.map((element) => element.bounds!).filter(Boolean));
  if (!bounds) {
    return [];
  }
  const uniqueColumns = uniqueRounded(cardElements.map((element) => element.bounds!.x), 80).length;
  const columns = Math.max(1, Math.min(3, uniqueColumns));
  return [
    {
      label: columns >= 2 ? "推断滚动区域：班级列表" : "推断滚动区域：列表",
      locator: columns >= 2 ? "inferred-scroll-region: class-card-grid" : "inferred-scroll-region: vertical-list",
      action: "scroll",
      actionKind: "scroll" as const,
      availability: "visible" as const,
      region: summarizeBoundsRegion(bounds, resolution),
      previewCrop,
      viewport: resolution,
      scrollProfile: {
        containerKind: columns >= 2 ? "grid_list" as const : "list" as const,
        direction: "vertical" as const,
        columns,
        targetKind: "item_text" as const,
        afterFoundAction: "tap_item" as const
      }
    }
  ];
}

function looksLikeScrollableCardText(element: RecordingObservation["uiElements"][number]): boolean {
  const text = `${element.text ?? ""} ${element.contentDesc ?? ""}`;
  return /班级|课程|开放加入|加入|课节|课堂/.test(text);
}

function combinedBounds(items: Array<{ x: number; y: number; width: number; height: number }>) {
  if (!items.length) {
    return undefined;
  }
  const left = Math.min(...items.map((item) => item.x));
  const top = Math.min(...items.map((item) => item.y));
  const right = Math.max(...items.map((item) => item.x + item.width));
  const bottom = Math.max(...items.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function summarizeBoundsRegion(bounds: { x: number; y: number; width: number; height: number }, resolution: NonNullable<RecordingObservation["resolution"]>) {
  return {
    x: clampPercent((bounds.x / resolution.width) * 100),
    y: clampPercent((bounds.y / resolution.height) * 100),
    width: clampPercent((bounds.width / resolution.width) * 100),
    height: clampPercent((bounds.height / resolution.height) * 100)
  };
}

function uniqueRounded(values: number[], tolerance: number): number[] {
  return values.reduce<number[]>((items, value) => {
    return items.some((item) => Math.abs(item - value) <= tolerance) ? items : [...items, value];
  }, []);
}

function summarizeScrollProfile(element: RecordingObservation["uiElements"][number]) {
  const label = `${element.text ?? ""} ${element.contentDesc ?? ""} ${element.resourceId ?? ""} ${element.className ?? ""}`.toLowerCase();
  const isGridLike = /grid|recycler|class_list|班级|card/.test(label);
  const isHorizontalLike = /tab|horizontal|carousel|横向|分类/.test(label);
  return {
    containerKind: isHorizontalLike ? "tab_bar" as const : isGridLike ? "grid_list" as const : "list" as const,
    direction: isHorizontalLike ? "horizontal" as const : "vertical" as const,
    columns: isGridLike && !isHorizontalLike ? 2 : 1,
    targetKind: "item_text" as const,
    afterFoundAction: isHorizontalLike ? "tap_item" as const : "tap_item" as const
  };
}

function summarizeOperationPreviewCrop(resolution: RecordingObservation["resolution"]): { x: number; y: number; width: number; height: number } | undefined {
  if (!resolution?.width || !resolution.height) {
    return undefined;
  }
  const topInsetPercent = resolution.height >= 2000 ? 4 : 3;
  const bottomInsetPercent = 0;
  return {
    x: 0,
    y: topInsetPercent,
    width: 100,
    height: Math.max(1, 100 - topInsetPercent - bottomInsetPercent)
  };
}

function summarizeElementRegion(element: RecordingObservation["uiElements"][number], resolution: RecordingObservation["resolution"]): { x: number; y: number; width: number; height: number } | undefined {
  if (!element.bounds || !resolution?.width || !resolution.height || element.bounds.width <= 0 || element.bounds.height <= 0) {
    return undefined;
  }
  const x = clampPercent((element.bounds.x / resolution.width) * 100);
  const y = clampPercent((element.bounds.y / resolution.height) * 100);
  return {
    x,
    y,
    width: clampPercent((element.bounds.width / resolution.width) * 100, 0, 100 - x),
    height: clampPercent((element.bounds.height / resolution.height) * 100, 0, 100 - y)
  };
}

function clampPercent(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function hasStableOperationSignal(element: RecordingObservation["uiElements"][number]): boolean {
  if (element.scrollable && (element.resourceId || element.accessibilityId || element.contentDesc || element.text)) {
    return true;
  }
  return Boolean(element.resourceId || element.accessibilityId || element.contentDesc || element.text);
}

function summarizeElementActionKind(element: RecordingObservation["uiElements"][number]): "tap" | "scroll" | "long_press" {
  if (element.scrollable) {
    return "scroll";
  }
  if (element.longClickable) {
    return "long_press";
  }
  return "tap";
}

function summarizeElementAvailability(element: RecordingObservation["uiElements"][number]): "visible" | "conditional" {
  if (element.clickable || element.scrollable || element.longClickable) {
    return "visible";
  }
  return "conditional";
}

function summarizeObservationTexts(observation: RecordingObservation | undefined, source: "ui" | "ocr"): string[] {
  if (source === "ocr") {
    return compactUnique(
      (observation?.ocrTexts ?? [])
        .map((text) => summarizeOcrEvidenceValue(text, observation?.resolution))
        .filter((text): text is string => Boolean(text)),
      18
    );
  }
  return compactUnique(
    (observation?.uiElements ?? [])
      .flatMap((element) => [element.text, element.contentDesc, element.accessibilityId, element.resourceId])
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text)),
    24
  );
}

function summarizeOcrEvidenceValue(text: RecordingObservation["ocrTexts"][number], resolution: RecordingObservation["resolution"]): string | undefined {
  const value = text.text?.trim();
  if (!value) {
    return undefined;
  }
  const region = normalizeOcrEvidenceRegion(text.region, resolution);
  if (!region) {
    return value;
  }
  return `ocr_text:${value}@region(${formatEvidenceRegion(region)})`;
}

function normalizeOcrEvidenceRegion(
  region: RecordingObservation["ocrTexts"][number]["region"],
  resolution: RecordingObservation["resolution"]
): { x: number; y: number; width: number; height: number } | undefined {
  if (!region || region.width <= 0 || region.height <= 0) {
    return undefined;
  }
  if (!resolution?.width || !resolution.height) {
    const x = clampPercent(region.x);
    const y = clampPercent(region.y);
    return {
      x,
      y,
      width: clampPercent(region.width, 0.01, 100 - x),
      height: clampPercent(region.height, 0.01, 100 - y)
    };
  }
  const x = clampPercent((region.x / resolution.width) * 100);
  const y = clampPercent((region.y / resolution.height) * 100);
  return {
    x,
    y,
    width: clampPercent((region.width / resolution.width) * 100, 0.01, 100 - x),
    height: clampPercent((region.height / resolution.height) * 100, 0.01, 100 - y)
  };
}

function formatEvidenceRegion(region: { x: number; y: number; width: number; height: number }): string {
  return [region.x, region.y, region.width, region.height].map(formatEvidenceNumber).join(",");
}

function formatEvidenceNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, "").replace(/\.$/, "");
}

function summarizeAssetAiDescription(status: NonNullable<CurrentPageAssetApiResponse["result"]>["status"], pageName: string | undefined, observation: RecordingObservation | undefined): string {
  const texts = compactUnique(
    [
      ...(observation?.uiElements.map((element) => element.text || element.contentDesc || element.accessibilityId) ?? []),
      ...(observation?.ocrTexts.map((text) => text.text) ?? [])
    ],
    6
  );
  const prefix = status === "matched" ? "已匹配页面" : "已生成页面草稿";
  return `${prefix}${pageName ? `：${pageName}` : ""}。主要可见信息：${texts.length ? texts.join("、") : "暂无文本候选"}。`;
}

export function pageAssetMessage(response: CurrentPageAssetApiResponse, mappedPage?: AssetRecordingCurrentPage): string {
  const result = response.result;
  if (!result) {
    return "当前页面识别完成";
  }
  if (mappedPage?.status === "matched") {
    return mappedPage.assetKind === "overlay"
      ? `已匹配浮层资产：${mappedPage.pageName ?? "未知浮层"}`
      : `已匹配页面资产：${mappedPage.pageName ?? result.match.node?.name ?? "未知页面"}`;
  }
  if (result.status === "matched") {
    return `已匹配页面资产：${result.match.node?.name ?? "未知页面"}`;
  }
  if (result.status === "draft_created") {
    return `已创建页面资产草稿：${result.node?.name ?? "未知页面"}`;
  }
  if (result.status === "draft_reused") {
    return `已复用页面资产草稿：${result.node?.name ?? "未知页面"}`;
  }
  if (result.status === "draft_candidate") {
    return `已识别待保存页面：${mappedPage?.pageName ?? sanitizeAssetDisplayName(result.node?.name) ?? "未知页面"}`;
  }
  return "当前页面识别完成";
}

function buildRecordingObservationFromSnapshots(
  serial: string,
  platform: DeviceInfo["platform"],
  snapshots: SemanticSnapshots
): RecordingObservation | undefined {
  const element = snapshots.element;
  const text = snapshots.text;
  if (!element && !text) {
    return undefined;
  }
  const uiElements =
    element?.candidates.map((candidate) => ({
      resourceId: candidate.resourceId,
      accessibilityId: candidate.contentDesc,
      text: candidate.text,
      contentDesc: candidate.contentDesc,
      className: candidate.className,
      packageName: candidate.packageName,
      bounds: {
        x: candidate.bounds.left,
        y: candidate.bounds.top,
        width: candidate.bounds.width,
        height: candidate.bounds.height
      },
      enabled: candidate.enabled,
      visible: true,
      clickable: candidate.clickable,
      longClickable: candidate.longClickable,
      focusable: candidate.focusable
    })) ?? [];
  const ocrTexts =
    text?.boxes.map((box) => ({
      text: box.text,
      confidence: box.confidence,
      region: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      },
      source: "ocr" as const
    })) ?? [];
  if (!uiElements.length && !ocrTexts.length) {
    return undefined;
  }
  const resolution =
    element?.width && element.height
      ? { width: element.width, height: element.height }
      : text?.width && text.height
        ? { width: text.width, height: text.height }
        : undefined;
  return {
    id: `recording_observation_${Date.now()}`,
    deviceSerial: serial,
    platform,
    capturedAt: latestCapturedAt([element?.capturedAt, text?.capturedAt]),
    packageName: uiElements.find((item) => item.packageName)?.packageName,
    resolution,
    uiElements,
    ocrTexts
  };
}

function deviceActionToAssetRecordingStep(action: RecordableAction, deviceSize: { width: number; height: number }): ReturnType<typeof createRecordedStep> {
  return createRecordedStep({
    action,
    order: 1,
    deviceSize,
    id: `asset-step-${Date.now()}`,
    autoExpectations: false
  });
}

async function fetchRecordingObservation(serial: string): Promise<RecordingObservation | undefined> {
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/observation?screenshot=false&uiTree=true&ocr=false`);
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { observation?: unknown };
  return isRecordingObservation(json.observation) ? json.observation : undefined;
}

function isRecordingObservation(value: unknown): value is RecordingObservation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<RecordingObservation>;
  return (
    (input.platform === "android" || input.platform === "ios") &&
    typeof input.capturedAt === "string" &&
    Array.isArray(input.uiElements) &&
    Array.isArray(input.ocrTexts)
  );
}

function pickRuntimeInterceptorTriggerText(observation: RecordingObservation): string {
  const candidates = compactUnique(
    [
      ...observation.uiElements.map((element) => element.text),
      ...observation.uiElements.map((element) => element.contentDesc ?? element.accessibilityId),
      ...observation.ocrTexts.map((text) => text.text)
    ],
    12
  ).filter((text) => text.length >= 2);
  return candidates[0] ?? "";
}

function pickRuntimeInterceptorActionText(observation: RecordingObservation, triggerText: string): string {
  const actionWords = ["关闭", "取消", "知道了", "稍后", "跳过", "允许", "确定", "暂不"];
  const texts = compactUnique(
    [
      ...observation.uiElements.filter((element) => element.clickable !== false).map((element) => element.text || element.contentDesc || element.accessibilityId),
      ...observation.ocrTexts.map((text) => text.text)
    ],
    20
  );
  return texts.find((text) => text !== triggerText && actionWords.some((word) => text.includes(word))) ?? "";
}

function compactUnique(values: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function latestCapturedAt(values: Array<string | undefined>): string {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return latest ?? new Date().toISOString();
}

function navButtonClass(activeNavItem: NavItemId, item: NavItemId): string {
  return activeNavItem === item ? "nav-item active" : "nav-item";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildCapabilityItems(device: DeviceInfo): Array<{ label: string; enabled: boolean }> {
  return [
    { label: "预览", enabled: device.capabilities.preview },
    { label: "点击", enabled: device.capabilities.tap },
    { label: "长按", enabled: device.capabilities.longPress },
    { label: "滑动", enabled: device.capabilities.swipe },
    { label: "返回", enabled: device.capabilities.back },
    { label: "Home", enabled: device.capabilities.home },
    { label: "最近任务", enabled: device.capabilities.recentApps },
    { label: "文本输入", enabled: device.capabilities.textInput },
    { label: "截图", enabled: device.capabilities.screenshot },
    { label: "启动 App", enabled: device.capabilities.launchApp },
    { label: "关闭 App", enabled: device.capabilities.closeApp },
    { label: "视频", enabled: device.capabilities.recordVideo },
    { label: "性能", enabled: device.capabilities.metrics.cpu || device.capabilities.metrics.memory || device.capabilities.metrics.battery },
    { label: "Crash/ANR", enabled: device.capabilities.events.crash || device.capabilities.events.anr }
  ];
}

function isActiveRunStatus(run: TestRun): boolean {
  return run.status === "running" || run.status === "paused";
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function canDeviceRunAction(device: DeviceInfo, actionType: DeviceActionRequest["type"]): boolean {
  if (actionType === "wait") {
    return true;
  }
  if (actionType === "tap") {
    return device.capabilities.tap;
  }
  if (actionType === "long_press") {
    return device.capabilities.longPress;
  }
  if (actionType === "swipe") {
    return device.capabilities.swipe;
  }
  if (actionType === "back") {
    return device.capabilities.back;
  }
  if (actionType === "home") {
    return device.capabilities.home;
  }
  if (actionType === "recent_apps") {
    return device.capabilities.recentApps;
  }
  if (actionType === "input_text" || actionType === "clear_text") {
    return device.capabilities.textInput;
  }
  if (actionType === "screenshot") {
    return device.capabilities.screenshot;
  }
  if (actionType === "launch_app") {
    return device.capabilities.launchApp;
  }
  if (actionType === "close_app") {
    return device.capabilities.closeApp;
  }
  return false;
}
