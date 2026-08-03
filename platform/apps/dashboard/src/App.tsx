import {
  PlayCircle,
  RefreshCw,
  Save,
  Square,
  Smartphone
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import {
  viewportPointToDevicePoint,
  nowIso,
  type ActionStep,
  type AndroidAppMonitorConfig,
  type DeviceActionRequest,
  type DeviceInfo,
  type FlowStartStrategy,
  type Platform,
  type SemanticDeviceActionRequest,
  type TestRun,
  type ToolStatus
} from "@mobile-automation/shared";
import { AppNav, type AppNavItemId } from "./components/AppNav";
import {
  AssetRecordingPanel,
  type AssetRecordingCurrentPage
} from "./components/AssetRecordingPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { PageAssetsPanel } from "./components/PageAssetsPanel";
import { CaseCenterPanel } from "./components/CaseCenterPanel";
import {
  AiScriptFlowsPanel,
  draftFromSavedFlow,
  type CaseRevision,
  type GeneratedDraft
} from "./components/AiScriptFlowsPanel";
import type { RuntimeInterceptorRule } from "./components/RuntimeInterceptorPanel";
import { RunResultsPanel } from "./components/RunResultsPanel";
import { ToolStatusBar } from "./components/ToolStatusBar";
import { useDeviceList } from "./hooks/useDeviceList";
import { controllableDevices, isControllableDevice } from "./device-availability";
import { buildAndroidAppMonitorRequest, useRunExecution, type AndroidAppMonitorRequestState } from "./hooks/useRunExecution";
import { useScrcpyStream } from "./hooks/useScrcpyStream";
import { classifyPreviewGesture } from "./preview-gesture";
import {
  createTapAssetActionFromElementLookup,
  createTapAssetActionFromSnapshot,
  type ElementLookupResponse,
  type ElementSnapshot,
  type SemanticSnapshots,
  type TextSnapshot
} from "./semantic-snapshot";
import { apiFetchJson } from "./api";
import { mergeAiPageDraftIntoPage, type AiPageDraftApiResponse } from "./ai-page-draft-merge";

type PointerStart = {
  x: number;
  y: number;
  at: number;
};

type ResizeStart = {
  startX: number;
  startWidth: number;
};

type NavItemId = AppNavItemId;
const retainedWorkbenchNavItems = new Set<NavItemId>(["pageAssets", "scriptFlows", "aiScriptFlows", "runs"]);

export function RetainedNavPanel({
  active,
  panelId,
  children
}: {
  active: boolean;
  panelId: NavItemId;
  children?: ReactNode;
}) {
  return <div
    className="retained-nav-panel"
    data-retained-nav-panel={panelId}
    hidden={!active}
    aria-hidden={!active}
  >{children}</div>;
}

type AssetRecordingAction =
  | DeviceActionRequest
  | {
      type: "tap_on_element";
      locator: Extract<SemanticDeviceActionRequest, { type: "tap_on_element" }>["locator"];
      selector?: string;
      bounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
      };
      x: number;
      y: number;
      timeoutMs?: number;
      intervalMs?: number;
      maxDistance?: number;
    }
  | {
      type: "tap_on_text";
      text: string;
      x: number;
      y: number;
      mode?: "contains" | "equals";
      timeoutMs?: number;
      intervalMs?: number;
      lang?: string;
    };
type StabilityExplorerStrategy = "conservative" | "balanced" | "aggressive";
type StabilityExplorerStartMode = "launch_app" | "current_state" | "restart_app";
type StabilityExplorerAppExitPolicy = "back_to_app" | "restart_app" | "stop";
type StabilityExplorerBacktrackStrategy = "none" | "shallow" | "depth_first";
export type AndroidAppMonitorDefaultMode = "off" | "all_runs";
export type AndroidAppMonitorExecutionKind = "stability_exploration" | "script_flow";
type AndroidAppMonitorSettingsDraft = Omit<AndroidAppMonitorRequestState, "enabled" | "packageName" | "startStrategy" | "startAppPackageName"> & {
  defaultMode: AndroidAppMonitorDefaultMode;
};
type AndroidAppMonitorExecutionOverrides = Partial<Record<AndroidAppMonitorExecutionKind, boolean>>;
type StabilityAllowedActions = {
  tap: boolean;
  swipe: boolean;
  back: boolean;
  wait: boolean;
};
type TextStorage = Pick<Storage, "getItem" | "setItem">;
type AiModelSettingsSource = "stored" | "environment" | "none";
export type PublicAiModelSettings = {
  enabled: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  source: AiModelSettingsSource;
};
export type AiModelSettingsDraft = {
  enabled: boolean;
  model: string;
  timeoutMs: number;
};

export const DEFAULT_STABILITY_EXPLORER_START_MODE: StabilityExplorerStartMode = "restart_app";
export const DEFAULT_STABILITY_EXPLORER_APP_EXIT_POLICY: StabilityExplorerAppExitPolicy = "back_to_app";
export const DEFAULT_STABILITY_EXPLORER_MAX_DEPTH = 4;
export const DEFAULT_STABILITY_DANGEROUS_TEXT_PATTERNS = ["删除", "退出登录", "注销", "支付", "发布", "提交", "确认删除"];
export const DEFAULT_STABILITY_DANGEROUS_TEXT = DEFAULT_STABILITY_DANGEROUS_TEXT_PATTERNS.join("\n");
export const DEFAULT_SCRIPT_APP_ID = "cn.eeo.classin";
export const DEFAULT_AI_MODEL_SETTINGS: PublicAiModelSettings = {
  enabled: false,
  baseURL: "",
  model: "",
  timeoutMs: 30_000,
  apiKeyConfigured: false,
  source: "none"
};
export const DEFAULT_ANDROID_APP_MONITOR_SETTINGS: AndroidAppMonitorSettingsDraft = {
  defaultMode: "off",
  includeSubprocesses: true,
  cpuThresholdEnabled: false,
  cpuThresholdPercent: 80,
  memoryThresholdEnabled: false,
  memoryThresholdMb: 1024,
  enableHeapDump: false
};
const STABILITY_DANGEROUS_TEXT_BY_PACKAGE_STORAGE_KEY = "mobile-automation.stabilityDangerousTextByPackage.v1";
type PreviewWorkspaceStyle = CSSProperties & {
  "--asset-recording-preview-width"?: string;
};

type AssetObservation = {
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

type PageAssetTargetProfile = {
  id?: string;
  platform?: DeviceInfo["platform"] | "harmony" | "flutter";
  displayName?: string;
  androidPackageName?: string;
  iosBundleId?: string;
  harmonyBundleName?: string;
  flutterAppId?: string;
  isPrimary?: boolean;
};

type PageAssetTargetApp = {
  productId?: string;
  productName?: string;
  profiles?: PageAssetTargetProfile[];
};

type AssetTargetProfileLookup = {
  androidPackageName?: string;
  iosBundleId?: string;
};

type PageAssetLibraryInitialization = {
  platform: DeviceInfo["platform"];
  appId: string;
  targetIdentifier: string;
  defaultName: string;
};

type PageAssetLibraryListItem = {
  appId?: string;
  name?: string;
  status?: string;
  platformScope?: string;
  targetApp?: PageAssetTargetApp;
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

type CurrentPagePollutionApi = {
  code?: string;
  message?: string;
  pollutionTexts?: Array<{ text?: string }>;
  affectedMatchers?: Array<{ nodeName?: string; matcherId?: string; type?: string; expected?: string }>;
};

type CurrentPageMatcherDiagnosticsApi = {
  status?: string;
  matchedEvidence?: CurrentPageMatcherEvidenceApi[];
  missingEvidence?: CurrentPageMatcherEvidenceApi[];
  pollution?: CurrentPagePollutionApi;
  topCandidate?: {
    nodeId?: string;
    key?: string;
    name?: string;
    score?: number;
  };
};

type CurrentPageAssetApiResponse = {
  result?: {
    status: "matched" | "draft_created" | "draft_reused" | "draft_candidate" | "blocked";
    visualPageName?: string;
    matcherDiagnostics?: CurrentPageMatcherDiagnosticsApi;
    blocker?: CurrentPagePollutionApi;
    message?: string;
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
    observation?: AssetObservation;
  };
  assets?: {
    pageAssets?: Array<{
      id: string;
      key: string;
      name: string;
      status: string;
      platformScope?: string;
      matcherCount?: number;
      updatedAt?: string;
    }>;
  };
  error?: string;
};

const assetPreviewMinWidth = 420;
const assetPreviewMaxWidth = 980;

export function previewWorkspaceKey(navItem: AppNavItemId): "deviceDetails" | "assetRecording" | "inactive" {
  if (navItem === "devices") {
    return "deviceDetails";
  }
  if (navItem === "assetRecording") {
    return "assetRecording";
  }
  return "inactive";
}

export function workspaceStyleForNav(navItem: AppNavItemId, _devicePreviewWidth: number, assetRecordingPreviewWidth: number): PreviewWorkspaceStyle {
  if (navItem === "assetRecording") {
    return {
      "--asset-recording-preview-width": `${assetRecordingPreviewWidth}px`
    };
  }
  return {};
}

export function actionStrategyForWorkspace(
  navItem: AppNavItemId,
  state: { identifying: boolean }
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
    useCachedSemanticTarget: false,
    resolveLiveLocatorBeforeAction: false,
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

export function stabilityExplorerRequestBody(input: {
  selectedSerial: string;
  packageName: string;
  maxDurationMinutes: number;
  maxActions: number;
  strategy: StabilityExplorerStrategy;
  startMode: StabilityExplorerStartMode;
  seed: string;
  allowedActions: StabilityAllowedActions;
  appExitPolicy: StabilityExplorerAppExitPolicy;
  backtrackStrategy: StabilityExplorerBacktrackStrategy;
  maxDepth: number;
  dangerousTextPatternsText: string;
  androidAppMonitor?: AndroidAppMonitorConfig;
}) {
  return {
    deviceSerial: input.selectedSerial,
    packageName: input.packageName.trim(),
    maxDurationMs: Math.max(1, Math.floor(input.maxDurationMinutes || 1)) * 60_000,
    maxActions: Math.max(1, Math.floor(input.maxActions || 1)),
    strategy: input.strategy,
    startMode: input.startMode,
    seed: input.seed.trim() || undefined,
    allowedActions: (["tap", "swipe", "back", "wait"] as const).filter((action) => input.allowedActions[action]),
    appExitPolicy: input.appExitPolicy,
    backtrackStrategy: input.backtrackStrategy,
    maxDepth: Math.max(1, Math.floor(input.maxDepth || 1)),
    dangerousTextPatterns: dangerousTextPatternsFromText(input.dangerousTextPatternsText),
    stopOnCrash: true,
    stopOnAnr: true,
    stopOnBlackScreen: true,
    stopOnUnknownPageStuck: true,
    ...(input.androidAppMonitor ? { androidAppMonitor: input.androidAppMonitor } : {})
  };
}

export function loadStabilityDangerousTextForPackage(packageName: string, storage: TextStorage | undefined = browserTextStorage()): string {
  const normalizedPackageName = packageName.trim();
  if (!normalizedPackageName || !storage) {
    return DEFAULT_STABILITY_DANGEROUS_TEXT;
  }
  const savedText = readDangerousTextByPackage(storage)[normalizedPackageName];
  return savedText ? mergeDangerousText(DEFAULT_STABILITY_DANGEROUS_TEXT, savedText) : DEFAULT_STABILITY_DANGEROUS_TEXT;
}

export function saveStabilityDangerousTextForPackage(packageName: string, text: string, storage: TextStorage | undefined = browserTextStorage()): void {
  const normalizedPackageName = packageName.trim();
  if (!normalizedPackageName || !storage) {
    return;
  }
  const byPackage = readDangerousTextByPackage(storage);
  byPackage[normalizedPackageName] = mergeDangerousText(text);
  storage.setItem(STABILITY_DANGEROUS_TEXT_BY_PACKAGE_STORAGE_KEY, JSON.stringify(byPackage));
}

function browserTextStorage(): TextStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readDangerousTextByPackage(storage: TextStorage): Record<string, string> {
  try {
    const raw = storage.getItem(STABILITY_DANGEROUS_TEXT_BY_PACKAGE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function dangerousTextPatternsFromText(text: string): string[] {
  return text
    .split(/\n|,|，/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeDangerousText(...texts: string[]): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    for (const pattern of dangerousTextPatternsFromText(text)) {
      const key = pattern.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(pattern);
      }
    }
  }
  return merged.join("\n");
}

export function stabilityRunProgressSummary(run: TestRun | null | undefined) {
  if (!run?.config.stabilityExploration) {
    return undefined;
  }
  const latestStep = run.stepResults.at(-1);
  const metadata = latestStep?.metadata?.stabilityExploration;
  const stabilityMetadata = isStabilityStepMetadata(metadata) ? metadata : undefined;
  return {
    packageName: run.config.stabilityExploration.packageName,
    seed: run.config.stabilityExploration.seed,
    progressText: `${run.stepResults.length} / ${run.config.stabilityExploration.maxActions}`,
    latestAction: stabilityMetadata?.candidateLabel ?? "-",
    latestSource: stabilityMetadata?.candidateSource ?? "-",
    currentPackage: stabilityMetadata?.currentPackage ?? run.config.stabilityExploration.packageName,
    skippedCandidates: stabilityMetadata?.skippedCandidates?.length ?? 0
  };
}

export function aiModelDraftFromSettings(settings: PublicAiModelSettings): AiModelSettingsDraft {
  return {
    enabled: settings.enabled,
    model: settings.model,
    timeoutMs: settings.timeoutMs || DEFAULT_AI_MODEL_SETTINGS.timeoutMs
  };
}

export function aiModelSettingsRequestBody(draft: AiModelSettingsDraft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    model: draft.model.trim(),
    timeoutMs: draft.timeoutMs
  };
}

export function androidAppMonitorForExecution(
  draft: AndroidAppMonitorSettingsDraft,
  input: {
    executionKind: AndroidAppMonitorExecutionKind;
    startStrategy: FlowStartStrategy;
    executionPackageName: string;
    enabledOverride?: boolean;
  }
): AndroidAppMonitorConfig | undefined {
  const executionPackageName = input.executionPackageName.trim();
  if (!executionPackageName) {
    return undefined;
  }
  return buildAndroidAppMonitorRequest({
    ...draft,
    enabled: androidAppMonitorEnabledForExecution(draft, input.executionKind, input.enabledOverride),
    packageName: executionPackageName,
    startStrategy: input.startStrategy,
    startAppPackageName: executionPackageName
  });
}

export function androidAppMonitorDefaultEnabled(defaultMode: AndroidAppMonitorDefaultMode, executionKind: AndroidAppMonitorExecutionKind): boolean {
  return defaultMode === "all_runs" && (executionKind === "script_flow" || executionKind === "stability_exploration");
}

function androidAppMonitorEnabledForExecution(
  draft: AndroidAppMonitorSettingsDraft,
  executionKind: AndroidAppMonitorExecutionKind,
  enabledOverride?: boolean
): boolean {
  return enabledOverride ?? androidAppMonitorDefaultEnabled(draft.defaultMode, executionKind);
}

function flowStartStrategyForExplorerStartMode(mode: StabilityExplorerStartMode): FlowStartStrategy {
  if (mode === "current_state") {
    return "keep_current";
  }
  return mode;
}

export function App() {
  const [inputText, setInputText] = useState("");
  const [message, setMessage] = useState("准备连接设备");
  const [busy, setBusy] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [activeNavItem, setActiveNavItem] = useState<NavItemId>("devices");
  const [pendingCaseRevision, setPendingCaseRevision] = useState<CaseRevision>();
  const [pendingCaseDraft, setPendingCaseDraft] = useState<GeneratedDraft>();
  const [pendingCaseSelection, setPendingCaseSelection] = useState("");
  const [newCaseWorkspaceVersion, setNewCaseWorkspaceVersion] = useState(0);
  const [retainedNavItems, setRetainedNavItems] = useState<Set<NavItemId>>(() => new Set(["devices"]));
  const [assetRecordingPreviewWidth, setAssetRecordingPreviewWidth] = useState(560);
  const [runtimeInterceptorRules, setRuntimeInterceptorRules] = useState<RuntimeInterceptorRule[]>([]);
  const [assetRecordingGraphVersionId, setAssetRecordingGraphVersionId] = useState("");
  const [assetRecordingPage, setAssetRecordingPage] = useState<AssetRecordingCurrentPage>({ status: "idle" });
  const [assetLibraryInitialization, setAssetLibraryInitialization] = useState<PageAssetLibraryInitialization>();
  const [assetRecordingIdentifying, setAssetRecordingIdentifying] = useState(false);
  const [assetRecordingAiIdentifying, setAssetRecordingAiIdentifying] = useState(false);
  const [stabilityPackageName, setStabilityPackageName] = useState("");
  const [stabilityMaxDurationMinutes, setStabilityMaxDurationMinutes] = useState(3);
  const [stabilityMaxActions, setStabilityMaxActions] = useState(100);
  const [stabilityStrategy, setStabilityStrategy] = useState<StabilityExplorerStrategy>("conservative");
  const [stabilityStartMode, setStabilityStartMode] = useState<StabilityExplorerStartMode>(DEFAULT_STABILITY_EXPLORER_START_MODE);
  const [stabilitySeed, setStabilitySeed] = useState("");
  const [stabilityAppExitPolicy, setStabilityAppExitPolicy] = useState<StabilityExplorerAppExitPolicy>(DEFAULT_STABILITY_EXPLORER_APP_EXIT_POLICY);
  const [stabilityBacktrackStrategy, setStabilityBacktrackStrategy] = useState<StabilityExplorerBacktrackStrategy>("shallow");
  const [stabilityMaxDepth, setStabilityMaxDepth] = useState(DEFAULT_STABILITY_EXPLORER_MAX_DEPTH);
  const [stabilityDangerousText, setStabilityDangerousText] = useState(DEFAULT_STABILITY_DANGEROUS_TEXT);
  const [stabilityAllowedActions, setStabilityAllowedActions] = useState<StabilityAllowedActions>({
    tap: true,
    swipe: true,
    back: true,
    wait: true
  });
  const [aiModelSettings, setAiModelSettings] = useState<PublicAiModelSettings>(DEFAULT_AI_MODEL_SETTINGS);
  const [aiModelDraft, setAiModelDraft] = useState<AiModelSettingsDraft>(aiModelDraftFromSettings(DEFAULT_AI_MODEL_SETTINGS));
  const [androidAppMonitorDraft, setAndroidAppMonitorDraft] = useState<AndroidAppMonitorSettingsDraft>(DEFAULT_ANDROID_APP_MONITOR_SETTINGS);
  const [androidAppMonitorExecutionOverrides, setAndroidAppMonitorExecutionOverrides] = useState<AndroidAppMonitorExecutionOverrides>({});
  const activePreviewWorkspaceKey = previewWorkspaceKey(activeNavItem);

  const workspaceRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const resizeStartRef = useRef<ResizeStart | null>(null);
  const semanticSnapshotsRef = useRef<SemanticSnapshots>({});
  const assetRecordingIdentificationInFlightRef = useRef(0);
  const aiModelSettingsLoadedRef = useRef(false);

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
  const selectableDevices = controllableDevices(devices);
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
    runs,
    currentRun,
    runsLimit,
    activeRunForSelectedDevice,
    selectedDeviceBusy,
    setCurrentRunId,
    refreshRuns,
    loadMoreRuns,
    stopCurrentRun,
    pauseCurrentRun,
    resumeCurrentRun,
    stepCurrentRun
  } = useRunExecution({ selectedSerial, setMessage });
  const stabilityAndroidAppMonitorEnabled = androidAppMonitorEnabledForExecution(
    androidAppMonitorDraft,
    "stability_exploration",
    androidAppMonitorExecutionOverrides.stability_exploration
  );

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

  async function refreshRuntimeInterceptorRules() {
    const response = await fetch("/api/runtime-interceptor-rules?enabledOnly=true");
    const json = (await response.json()) as { rules?: RuntimeInterceptorRule[]; error?: string };
    if (!response.ok || !json.rules) {
      throw new Error(json.error ?? "加载临时阻断页规则失败");
    }
    setRuntimeInterceptorRules(json.rules);
  }

  async function loadAiModelSettings() {
    try {
      const json = await apiFetchJson<{ settings: PublicAiModelSettings }>("/api/settings/ai-model");
      setAiModelSettings(json.settings);
      setAiModelDraft(aiModelDraftFromSettings(json.settings));
      setMessage("已加载 AI 模型配置");
    } catch (error) {
      aiModelSettingsLoadedRef.current = false;
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveAiModelSettings() {
    try {
      setBusy(true);
      const json = await apiFetchJson<{ settings: PublicAiModelSettings }>("/api/settings/ai-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiModelSettingsRequestBody(aiModelDraft))
      });
      setAiModelSettings(json.settings);
      setAiModelDraft(aiModelDraftFromSettings(json.settings));
      setMessage("已保存 AI 模型配置");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshRuntimeInterceptorRules().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!retainedWorkbenchNavItems.has(activeNavItem)) return;
    setRetainedNavItems((current) => {
      if (current.has(activeNavItem)) return current;
      const next = new Set(current);
      next.add(activeNavItem);
      return next;
    });
  }, [activeNavItem]);

  useEffect(() => {
    if (activeNavItem !== "settings" || aiModelSettingsLoadedRef.current) {
      return;
    }
    aiModelSettingsLoadedRef.current = true;
    void loadAiModelSettings();
  }, [activeNavItem]);

  useEffect(() => {
    if (activeNavItem !== "assetRecording" || !selectedSerial || !selectedDevice) {
      return;
    }
    void identifyCurrentPageAsset();
  }, [activeNavItem, selectedDevice?.platform, selectedSerial]);

  useEffect(() => {
    setAssetRecordingPreviewWidth((width) => clamp(width, assetRecordingWidthLimits().min, assetRecordingWidthLimits().max));
  }, [navCollapsed]);

  useEffect(() => {
    function onPointerMove(event: globalThis.PointerEvent) {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) {
        return;
      }
      if (activeNavItem !== "assetRecording") {
        return;
      }
      const limits = assetRecordingWidthLimits();
      setAssetRecordingPreviewWidth(clamp(resizeStart.startWidth + event.clientX - resizeStart.startX, limits.min, limits.max));
    }

    function onPointerUp() {
      resizeStartRef.current = null;
      document.body.classList.remove("asset-recording-resize-active");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.classList.remove("asset-recording-resize-active");
    };
  }, [activeNavItem, navCollapsed]);

  async function runAction(action: DeviceActionRequest) {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (selectedDevice && !canDeviceRunAction(selectedDevice, action.type)) {
      setMessage(selectedDevice.platform === "ios" ? `iOS 设备暂不支持 ${action.type}，需要设备在线并配置 WDA` : `当前设备暂不支持 ${action.type}`);
      return;
    }
    const actionStrategy = actionStrategyForWorkspace(activeNavItem, {
      identifying: assetRecordingIdentifying || assetRecordingIdentificationInFlightRef.current > 0
    });
    if (actionStrategy.blockPreviewInteraction) {
      setMessage("正在识别当前页面，请稍候");
      return;
    }
    if (sendScrcpyDirectAction(action)) {
      semanticSnapshotsRef.current = {};
      setMessage(`已通过 scrcpy 执行 ${action.type}`);
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
      semanticSnapshotsRef.current = {};
      refreshScreenshot();
      setMessage(`已执行 ${action.type}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
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
    if (!endControlPoint) {
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
    const gesture = classifyPreviewGesture({ distancePx: distance, durationMs });
    if (gesture === "swipe") {
      void runAction({
        type: "swipe",
        startX: startControlPoint.x,
        startY: startControlPoint.y,
        endX: endControlPoint.x,
        endY: endControlPoint.y,
        durationMs
      });
    } else if (gesture === "long_press") {
      void runAction({ type: "long_press", x: startControlPoint.x, y: startControlPoint.y, durationMs });
    } else {
      void runAction({ type: "tap", x: endControlPoint.x, y: endControlPoint.y });
    }
  }

  function onPreviewPointerCancel() {
    pointerStartRef.current = null;
  }

  function assetRecordingWidthLimits() {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const navWidth = navCollapsed ? 64 : 184;
    const horizontalPadding = 24;
    const gaps = 36;
    const availableWidth = Math.max(0, workspaceWidth - navWidth - horizontalPadding - gaps);
    const assetEditorMinWidth = 540;
    const dynamicMin = Math.min(assetPreviewMinWidth, Math.max(320, availableWidth - assetEditorMinWidth));
    const dynamicMax = Math.max(dynamicMin, Math.min(assetPreviewMaxWidth, availableWidth - assetEditorMinWidth));
    return {
      min: dynamicMin,
      max: dynamicMax
    };
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
    document.body.classList.add("asset-recording-resize-active");
  }

  function openDevices() {
    setActiveNavItem("devices");
  }

  function openAssetRecording() {
    setActiveNavItem("assetRecording");
  }

  function openPageAssets() {
    setActiveNavItem("pageAssets");
  }

  function openScriptFlows() {
    setActiveNavItem("scriptFlows");
  }

  function openAiScriptFlows() {
    setActiveNavItem("aiScriptFlows");
  }

  function openNewAiScriptFlow() {
    setPendingCaseRevision(undefined);
    setPendingCaseDraft(undefined);
    setNewCaseWorkspaceVersion((version) => version + 1);
    setActiveNavItem("aiScriptFlows");
  }

  function openStability() {
    setActiveNavItem("stability");
  }

  function openSettings() {
    setActiveNavItem("settings");
  }

  function openRuns(options: { keepCurrentRun?: boolean } = {}) {
    if (!options.keepCurrentRun) {
      setCurrentRunId("");
    }
    setActiveNavItem("runs");
  }

  function selectDeviceAndCloseStream(device: DeviceInfo) {
    selectDevice(device, () => closeScrcpyStream("device switch"));
  }

  async function markCurrentPageAsRuntimeInterceptor() {
    if (!selectedSerial || !selectedDevice) {
      setMessage("请先选择设备");
      return;
    }
    try {
      const observation = await fetchAssetObservation(selectedSerial);
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
      const { graphVersionId, targetProfile } = await resolveAssetRecordingGraphVersionId({
        platform: selectedDevice.platform,
        observe: () => fetchAssetForegroundObservation(selectedSerial),
        fetchWritableGraphVersionId
      });
      if (!graphVersionId) {
        const initialization = pageAssetLibraryInitialization(selectedDevice.platform, targetProfile);
        setAssetLibraryInitialization(initialization);
        setAssetRecordingPage({
          status: "error",
          message: initialization ? "当前 App 尚未创建页面资产库" : "未能识别当前前台 App，无法初始化页面资产库"
        });
        setMessage(initialization ? "请先初始化当前 App 的页面资产库" : "未能识别当前前台 App");
        return;
      }
      setAssetLibraryInitialization(undefined);
      setAssetRecordingGraphVersionId(graphVersionId);
      await identifyPageAssetWithVersion(graphVersionId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setAssetRecordingPage({ status: "error", message: messageText });
      setMessage(messageText);
    } finally {
      endAssetRecordingIdentification();
    }
  }

  async function identifyPageAssetWithVersion(graphVersionId: string) {
      const response = await fetch(`/api/page-assets/${encodeURIComponent(graphVersionId)}/current-page`, {
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
      setMessage(pageAssetMessage(json, mappedPage));
  }

  async function initializePageAssetLibrary(name: string) {
    if (!assetLibraryInitialization || !selectedSerial) {
      return;
    }
    try {
      beginAssetRecordingIdentification();
      const response = await fetch("/api/page-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId: assetLibraryInitialization.appId,
          name,
          platform: assetLibraryInitialization.platform,
          targetIdentifier: assetLibraryInitialization.targetIdentifier
        })
      });
      const json = (await response.json().catch(() => ({}))) as {
        library?: PageAssetLibraryListItem;
        error?: string;
      };
      const graphVersionId = json.library?.activeVersion?.id;
      if (!response.ok || !graphVersionId) {
        throw new Error(json.error ?? "页面资产库初始化失败");
      }
      setAssetRecordingGraphVersionId(graphVersionId);
      setAssetLibraryInitialization(undefined);
      await identifyPageAssetWithVersion(graphVersionId);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      setAssetRecordingPage({ status: "error", message: messageText });
      setMessage(messageText);
    } finally {
      endAssetRecordingIdentification();
    }
  }

  async function requestAiPageDraft() {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const observation = assetRecordingPage.observation;
    if (!graphVersionId || !observation) {
      setMessage("请先执行“识别当前页”，再使用 AI 辅助识别");
      return;
    }
    setAssetRecordingAiIdentifying(true);
    try {
      const response = await fetch(`/api/page-assets/${encodeURIComponent(graphVersionId)}/ai-page-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observation })
      });
      const json = (await response.json().catch(() => ({}))) as AiPageDraftApiResponse & { error?: string };
      if (!response.ok || !json.suggestion) {
        throw new Error(json.error ?? "AI 识别失败");
      }
      setAssetRecordingPage((page) => mergeAiPageDraftIntoPage(page, json));
      setMessage(`AI 草稿已生成（${json.visionUsed ? "视觉" : "文本"}模式），请确认后保存`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAssetRecordingAiIdentifying(false);
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
        key: pageDraft.pageKey,
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
            `/api/page-assets/${encodeURIComponent(assetRecordingPage.graphVersionId)}/assets/nodes/${encodeURIComponent(pageDraft.nodeId)}/promote`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(assetPayload)
            }
          )
        : await fetch(`/api/page-assets/${encodeURIComponent(assetRecordingPage.graphVersionId)}/assets/nodes`, {
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
        pageKey: page.pageKey ?? json.node?.key,
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

  function updateStabilityPackageName(packageName: string) {
    setStabilityPackageName(packageName);
    setStabilityDangerousText(loadStabilityDangerousTextForPackage(packageName));
  }

  function updateStabilityDangerousText(text: string) {
    setStabilityDangerousText(text);
    saveStabilityDangerousTextForPackage(stabilityPackageName, text);
  }

  function updateAndroidAppMonitorExecutionOverride(kind: AndroidAppMonitorExecutionKind, enabled: boolean) {
    setAndroidAppMonitorExecutionOverrides((current) => ({
      ...current,
      [kind]: enabled
    }));
  }

  function keepCurrentAndroidAppMonitorForPackage(
    executionKind: AndroidAppMonitorExecutionKind,
    packageName: string,
    enabledOverride?: boolean
  ): AndroidAppMonitorConfig | undefined {
    return androidAppMonitorForExecution(androidAppMonitorDraft, {
      executionKind,
      startStrategy: "keep_current",
      executionPackageName: packageName,
      enabledOverride
    });
  }

  async function startStabilityExploration() {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (!stabilityPackageName.trim()) {
      setMessage("请先填写目标包名");
      return;
    }
    if (selectedDeviceBusy) {
      setMessage(`当前设备正在执行：${activeRunForSelectedDevice?.id ?? ""}`);
      return;
    }
    try {
      setBusy(true);
      saveStabilityDangerousTextForPackage(stabilityPackageName, stabilityDangerousText);
      const response = await fetch("/api/stability-explorations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          stabilityExplorerRequestBody({
            selectedSerial,
            packageName: stabilityPackageName,
            maxDurationMinutes: stabilityMaxDurationMinutes,
            maxActions: stabilityMaxActions,
            strategy: stabilityStrategy,
            startMode: stabilityStartMode,
            seed: stabilitySeed,
            allowedActions: stabilityAllowedActions,
            appExitPolicy: stabilityAppExitPolicy,
            backtrackStrategy: stabilityBacktrackStrategy,
            maxDepth: stabilityMaxDepth,
            dangerousTextPatternsText: stabilityDangerousText,
            androidAppMonitor: androidAppMonitorForExecution(androidAppMonitorDraft, {
              executionKind: "stability_exploration",
              startStrategy: flowStartStrategyForExplorerStartMode(stabilityStartMode),
              executionPackageName: stabilityPackageName,
              enabledOverride: androidAppMonitorExecutionOverrides.stability_exploration
            })
          })
        )
      });
      const json = (await response.json().catch(() => ({}))) as { run?: TestRun; error?: string; activeRunId?: string };
      if (!response.ok || !json.run) {
        throw new Error(json.error ?? (json.activeRunId ? `设备正在执行：${json.activeRunId}` : "启动稳定性探索失败"));
      }
      setCurrentRunId(json.run.id);
      await refreshRuns();
      setMessage(`已启动稳定性探索：${json.run.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopStabilityExploration(runId: string) {
    try {
      setBusy(true);
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as { run?: TestRun; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "停止稳定性探索失败");
      }
      setCurrentRunId(runId);
      await refreshRuns();
      setMessage(`已停止稳定性探索：${runId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const workspaceStyle: PreviewWorkspaceStyle = workspaceStyleForNav(activeNavItem, 0, assetRecordingPreviewWidth);
  const stabilityPackageOptions = knownStabilityPackages(runs);
  const currentStabilityRun =
    (currentRun?.config.runKind === "stability_exploration" ? currentRun : undefined) ??
    runs.find((run) => run.config.runKind === "stability_exploration" && run.deviceSerial === selectedSerial && isActiveRunStatus(run)) ??
    runs.find((run) => run.config.runKind === "stability_exploration" && run.deviceSerial === selectedSerial);
  const stabilitySummary = stabilityRunProgressSummary(currentStabilityRun);

  const runResultsPanel = (
    <RunResultsPanel
      selectedDevice={selectedDevice}
      currentRun={currentRun}
      runs={runs}
      runsLimit={runsLimit}
      selectedSerial={selectedSerial}
      stopCurrentRun={stopCurrentRun}
      pauseCurrentRun={pauseCurrentRun}
      resumeCurrentRun={resumeCurrentRun}
      stepCurrentRun={stepCurrentRun}
      setCurrentRunId={setCurrentRunId}
      loadMoreRuns={loadMoreRuns}
    />
  );

  const devicePreviewPanel = (
    <PreviewPanel
      key={`preview-${activePreviewWorkspaceKey}-${selectedSerial || "none"}`}
      devices={selectableDevices}
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
          openAssetRecording={openAssetRecording}
          openPageAssets={openPageAssets}
          openScriptFlows={openScriptFlows}
          openAiScriptFlows={openAiScriptFlows}
          openStability={openStability}
          openRuns={openRuns}
          openSettings={openSettings}
        />

        {activeNavItem === "devices" && (
          <DeviceManagementView
            devices={devices}
            selectedSerial={selectedSerial}
            selectedDevice={selectedDevice}
            previewPanel={devicePreviewPanel}
            tools={tools}
            runs={runs}
            activeRunForSelectedDevice={activeRunForSelectedDevice}
            onOpenRuns={openRuns}
            onRefreshDevices={() => refreshDevices().catch((error) => setMessage(error.message))}
          />
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
            onAiIdentify={requestAiPageDraft}
            aiIdentifying={assetRecordingAiIdentifying}
            onSaveCurrentPageAsset={saveCurrentPageAsset}
            libraryInitialization={assetLibraryInitialization}
            onInitializePageAssetLibrary={initializePageAssetLibrary}
            onResizePointerDown={onAssetRecordingResizePointerDown}
            previewSlot={
              <PreviewPanel
                key={`preview-${activePreviewWorkspaceKey}-${selectedSerial || "none"}`}
                devices={selectableDevices}
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

        {(activeNavItem === "pageAssets" || retainedNavItems.has("pageAssets")) && (
          <RetainedNavPanel active={activeNavItem === "pageAssets"} panelId="pageAssets">
            <PageAssetsPanel
              onOpenAssetRecording={openAssetRecording}
              setMessage={setMessage}
            />
          </RetainedNavPanel>
        )}

        {(activeNavItem === "scriptFlows" || retainedNavItems.has("scriptFlows")) && (
          <RetainedNavPanel active={activeNavItem === "scriptFlows"} panelId="scriptFlows">
            <CaseCenterPanel
              devices={selectableDevices}
              selectedSerial={selectedSerial}
              initialSelectedFlowId={pendingCaseSelection || undefined}
              setMessage={setMessage}
              onCreateCase={openNewAiScriptFlow}
              onModifyCase={(flow, verification) => {
                const draft = draftFromSavedFlow(flow, verification);
                if (!draft) {
                  setMessage("当前测试脚本无法解析，不能打开脚本编排");
                  return;
                }
                setPendingCaseRevision({ flowId: flow.id, version: flow.version, name: flow.name });
                setPendingCaseDraft(draft);
                setActiveNavItem("aiScriptFlows");
              }}
              onAiModifyCase={(flow) => {
                setPendingCaseRevision({ flowId: flow.id, version: flow.version, name: flow.name });
                setPendingCaseDraft(undefined);
                setActiveNavItem("aiScriptFlows");
              }}
              androidAppMonitorForApp={(appId) => keepCurrentAndroidAppMonitorForPackage(
                "script_flow",
                appId,
                androidAppMonitorExecutionOverrides.script_flow
              )}
              onOpenRun={(runId) => {
                setCurrentRunId(runId);
                openRuns({ keepCurrentRun: true });
              }}
            />
          </RetainedNavPanel>
        )}

        {(activeNavItem === "aiScriptFlows" || retainedNavItems.has("aiScriptFlows")) && (
          <RetainedNavPanel active={activeNavItem === "aiScriptFlows"} panelId="aiScriptFlows">
            <AiScriptFlowsPanel
              key={pendingCaseRevision ? `${pendingCaseRevision.flowId}:${pendingCaseRevision.version}:${pendingCaseDraft ? "manual" : "ai"}` : `new-case:${newCaseWorkspaceVersion}`}
              defaultAppId={DEFAULT_SCRIPT_APP_ID}
              devices={selectableDevices}
              selectedSerial={selectedSerial}
              activeRunForDevice={activeRunForSelectedDevice}
              setMessage={setMessage}
              onStartNewTest={openNewAiScriptFlow}
              revision={pendingCaseRevision}
              initialDraft={pendingCaseDraft}
              androidAppMonitorForApp={(appId) => keepCurrentAndroidAppMonitorForPackage(
                "script_flow",
                appId,
                androidAppMonitorExecutionOverrides.script_flow
              )}
              onSaved={(flow) => {
                setPendingCaseSelection(flow.id);
                setPendingCaseRevision(undefined);
                setPendingCaseDraft(undefined);
                openScriptFlows();
              }}
              onOpenRun={(runId) => {
                setCurrentRunId(runId);
                openRuns({ keepCurrentRun: true });
              }}
            />
          </RetainedNavPanel>
        )}

        {activeNavItem === "stability" && (
          <StabilityExplorerPanel
            devices={selectableDevices}
            selectedSerial={selectedSerial}
            selectedDevice={selectedDevice}
            selectedDeviceBusy={selectedDeviceBusy}
            packageName={stabilityPackageName}
            packageOptions={stabilityPackageOptions}
            maxDurationMinutes={stabilityMaxDurationMinutes}
            maxActions={stabilityMaxActions}
            strategy={stabilityStrategy}
            startMode={stabilityStartMode}
            seed={stabilitySeed}
            allowedActions={stabilityAllowedActions}
            appExitPolicy={stabilityAppExitPolicy}
            backtrackStrategy={stabilityBacktrackStrategy}
            maxDepth={stabilityMaxDepth}
            dangerousTextPatternsText={stabilityDangerousText}
            currentRun={currentStabilityRun}
            summary={stabilitySummary}
            androidAppMonitorEnabled={stabilityAndroidAppMonitorEnabled}
            busy={busy}
            onAndroidAppMonitorEnabledChange={(enabled) => updateAndroidAppMonitorExecutionOverride("stability_exploration", enabled)}
            onSelectDevice={(serial) => {
              const device = selectableDevices.find((item) => item.serial === serial);
              if (device) {
                selectDeviceAndCloseStream(device);
              }
            }}
            onPackageNameChange={updateStabilityPackageName}
            onMaxDurationMinutesChange={setStabilityMaxDurationMinutes}
            onMaxActionsChange={setStabilityMaxActions}
            onStrategyChange={setStabilityStrategy}
            onStartModeChange={setStabilityStartMode}
            onSeedChange={setStabilitySeed}
            onAllowedActionsChange={setStabilityAllowedActions}
            onAppExitPolicyChange={setStabilityAppExitPolicy}
            onBacktrackStrategyChange={setStabilityBacktrackStrategy}
            onMaxDepthChange={setStabilityMaxDepth}
            onDangerousTextPatternsChange={updateStabilityDangerousText}
            onStart={startStabilityExploration}
            onStop={(runId) => void stopStabilityExploration(runId)}
            onOpenRun={(runId) => {
              setCurrentRunId(runId);
              openRuns({ keepCurrentRun: true });
            }}
          />
        )}

        {(activeNavItem === "runs" || retainedNavItems.has("runs")) && (
          <RetainedNavPanel active={activeNavItem === "runs"} panelId="runs">
            <section className="module-page execution-module">{runResultsPanel}</section>
          </RetainedNavPanel>
        )}

        {activeNavItem === "settings" && (
          <SettingsView
            aiSettings={aiModelSettings}
            aiDraft={aiModelDraft}
            androidAppMonitorDraft={androidAppMonitorDraft}
            busy={busy}
            onAiDraftChange={(patch) => setAiModelDraft((draft) => ({ ...draft, ...patch }))}
            onAndroidAppMonitorDraftChange={(patch) => setAndroidAppMonitorDraft((draft) => ({ ...draft, ...patch }))}
            onSaveAiSettings={() => void saveAiModelSettings()}
          />
        )}

      </section>
    </main>
  );
}

type SettingsViewProps = {
  aiSettings: PublicAiModelSettings;
  aiDraft: AiModelSettingsDraft;
  androidAppMonitorDraft: AndroidAppMonitorSettingsDraft;
  busy: boolean;
  onAiDraftChange: (patch: Partial<AiModelSettingsDraft>) => void;
  onAndroidAppMonitorDraftChange: (patch: Partial<AndroidAppMonitorSettingsDraft>) => void;
  onSaveAiSettings: () => void;
};

function SettingsView({
  aiSettings,
  aiDraft,
  androidAppMonitorDraft,
  busy,
  onAiDraftChange,
  onAndroidAppMonitorDraftChange,
  onSaveAiSettings
}: SettingsViewProps) {
  return (
    <section className="module-page settings-module">
      <AndroidAppMonitorSettingsPanel
        draft={androidAppMonitorDraft}
        onDraftChange={onAndroidAppMonitorDraftChange}
      />
      <AiModelSettingsPanel
        settings={aiSettings}
        draft={aiDraft}
        busy={busy}
        onDraftChange={onAiDraftChange}
        onSave={onSaveAiSettings}
      />
    </section>
  );
}

type AiModelSettingsPanelProps = {
  settings: PublicAiModelSettings;
  draft: AiModelSettingsDraft;
  busy: boolean;
  onDraftChange: (patch: Partial<AiModelSettingsDraft>) => void;
  onSave: () => void;
};

type AndroidAppMonitorSettingsPanelProps = {
  draft: AndroidAppMonitorSettingsDraft;
  onDraftChange: (patch: Partial<AndroidAppMonitorSettingsDraft>) => void;
};

export function AndroidAppMonitorSettingsPanel({
  draft,
  onDraftChange
}: AndroidAppMonitorSettingsPanelProps) {
  return (
    <div className="panel settings-card app-monitor-settings-card">
      <div className="panel-head">
        <div>
          <h2>Android 性能监控</h2>
        </div>
      </div>
      <div className="monitor-default-block">
        <span className="settings-field-title">App 监控默认</span>
        <div className="settings-option-grid" role="radiogroup" aria-label="App 监控默认">
          {androidAppMonitorDefaultModeOptions().map((option) => (
            <label className="settings-option-card" key={option.value}>
              <input
                type="radio"
                name="android-app-monitor-default"
                value={option.value}
                checked={draft.defaultMode === option.value}
                onChange={() => onDraftChange({ defaultMode: option.value })}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <details className="settings-advanced-section">
        <summary>高级采样与告警</summary>
        <div className="settings-advanced-grid">
          <label className="settings-advanced-toggle">
            <span>
              <strong>包含子进程</strong>
              <small>同时采集同一应用下的子进程。</small>
            </span>
            <input type="checkbox" checked={draft.includeSubprocesses} onChange={(event) => onDraftChange({ includeSubprocesses: event.target.checked })} />
          </label>
          <label className="settings-advanced-toggle">
            <span>
              <strong>抓取内存快照</strong>
              <small>达到内存阈值时保存现场，耗时较长。</small>
            </span>
            <input type="checkbox" checked={draft.enableHeapDump} onChange={(event) => onDraftChange({ enableHeapDump: event.target.checked })} />
          </label>
          <div className="settings-threshold-row">
            <label className="settings-threshold-toggle">
              <input type="checkbox" checked={draft.cpuThresholdEnabled} onChange={(event) => onDraftChange({ cpuThresholdEnabled: event.target.checked })} />
              <span>
                <strong>CPU 使用率告警</strong>
                <small>超过阈值时在报告中标记。</small>
              </span>
            </label>
            <label className="settings-inline-field">
              阈值 %
              <input
                type="number"
                min={1}
                max={100}
                value={draft.cpuThresholdPercent}
                onChange={(event) => onDraftChange({ cpuThresholdPercent: clampNumberInput(event.target.value, 1, 100, DEFAULT_ANDROID_APP_MONITOR_SETTINGS.cpuThresholdPercent) })}
              />
            </label>
          </div>
          <div className="settings-threshold-row">
            <label className="settings-threshold-toggle">
              <input type="checkbox" checked={draft.memoryThresholdEnabled} onChange={(event) => onDraftChange({ memoryThresholdEnabled: event.target.checked })} />
              <span>
                <strong>内存占用告警</strong>
                <small>超过上限时在报告中标记。</small>
              </span>
            </label>
            <label className="settings-inline-field">
              上限 MB
              <input
                type="number"
                min={1}
                max={8192}
                value={draft.memoryThresholdMb}
                onChange={(event) => onDraftChange({ memoryThresholdMb: clampNumberInput(event.target.value, 1, 8192, DEFAULT_ANDROID_APP_MONITOR_SETTINGS.memoryThresholdMb) })}
              />
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}

function androidAppMonitorDefaultModeOptions(): Array<{ value: AndroidAppMonitorDefaultMode; label: string; detail: string }> {
  return [
    { value: "off", label: "关闭", detail: "不额外采集应用 CPU、内存数据，报告仍保留基础设备性能。" },
    { value: "all_runs", label: "全部执行", detail: "ScriptFlow 与稳定性探索默认采集应用 CPU、内存证据。" }
  ];
}

export function AiModelSettingsPanel({
  settings,
  draft,
  busy,
  onDraftChange,
  onSave
}: AiModelSettingsPanelProps) {
  const providerLabel = settings.source === "environment" && settings.baseURL
    ? settings.baseURL
    : "Codex 本机";
  return (
    <div className="panel settings-content-panel">
      <div className="panel-head">
        <div>
          <h2>AI 模型</h2>
          <span className="settings-status-line">
            {settings.enabled ? "已启用" : "未启用"} · {providerLabel} · {settingsSourceLabel(settings.source)}
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="icon-button primary" type="button" disabled={busy} onClick={onSave}>
            <Save size={16} />
            保存
          </button>
        </div>
      </div>
      <div className="settings-form-grid">
        <label className="settings-toggle-row">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => onDraftChange({ enabled: event.target.checked })} />
          启用 AI 页面分析与用例生成
        </label>
        <label>
          模型名
          <input value={draft.model} onChange={(event) => onDraftChange({ model: event.target.value })} placeholder="gpt-5.4" />
        </label>
        <label>
          超时 ms
          <input
            min={1000}
            max={120000}
            type="number"
            value={draft.timeoutMs}
            onChange={(event) => onDraftChange({ timeoutMs: clampNumberInput(event.target.value, 1000, 120000, DEFAULT_AI_MODEL_SETTINGS.timeoutMs) })}
          />
        </label>
      </div>
    </div>
  );
}

function settingsSourceLabel(source: AiModelSettingsSource): string {
  if (source === "stored") {
    return "本机配置";
  }
  if (source === "environment") {
    return "环境变量";
  }
  return "未配置";
}

function AppMonitorExecutionToggle({
  enabled,
  packageName,
  onChange
}: {
  enabled: boolean;
  packageName: string;
  onChange?: (enabled: boolean) => void;
}) {
  return (
    <label className="app-monitor-execution-toggle">
      <span>
        <strong>App 进程监控</strong>
        <small>{enabled ? `开启 · ${packageName.trim() || "-"}` : "关闭"}</small>
      </span>
      <input type="checkbox" checked={enabled} onChange={(event) => onChange?.(event.target.checked)} />
    </label>
  );
}

type StabilityExplorerPanelProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  selectedDeviceBusy: boolean;
  packageName: string;
  packageOptions: string[];
  maxDurationMinutes: number;
  maxActions: number;
  strategy: StabilityExplorerStrategy;
  startMode: StabilityExplorerStartMode;
  seed: string;
  allowedActions: StabilityAllowedActions;
  appExitPolicy: StabilityExplorerAppExitPolicy;
  backtrackStrategy: StabilityExplorerBacktrackStrategy;
  maxDepth: number;
  dangerousTextPatternsText: string;
  currentRun?: TestRun;
  summary?: ReturnType<typeof stabilityRunProgressSummary>;
  androidAppMonitorEnabled?: boolean;
  busy: boolean;
  onAndroidAppMonitorEnabledChange?: (enabled: boolean) => void;
  onSelectDevice: (serial: string) => void;
  onPackageNameChange: (value: string) => void;
  onMaxDurationMinutesChange: (value: number) => void;
  onMaxActionsChange: (value: number) => void;
  onStrategyChange: (value: StabilityExplorerStrategy) => void;
  onStartModeChange: (value: StabilityExplorerStartMode) => void;
  onSeedChange: (value: string) => void;
  onAllowedActionsChange: (value: StabilityAllowedActions) => void;
  onAppExitPolicyChange: (value: StabilityExplorerAppExitPolicy) => void;
  onBacktrackStrategyChange: (value: StabilityExplorerBacktrackStrategy) => void;
  onMaxDepthChange: (value: number) => void;
  onDangerousTextPatternsChange: (value: string) => void;
  onStart: () => void;
  onStop: (runId: string) => void;
  onOpenRun: (runId: string) => void;
};

export function StabilityExplorerPanel({
  devices,
  selectedSerial,
  selectedDevice,
  selectedDeviceBusy,
  packageName,
  packageOptions,
  maxDurationMinutes,
  maxActions,
  strategy,
  startMode,
  seed,
  allowedActions,
  appExitPolicy,
  backtrackStrategy,
  maxDepth,
  dangerousTextPatternsText,
  currentRun,
  summary,
  androidAppMonitorEnabled = false,
  busy,
  onAndroidAppMonitorEnabledChange,
  onSelectDevice,
  onPackageNameChange,
  onMaxDurationMinutesChange,
  onMaxActionsChange,
  onStrategyChange,
  onStartModeChange,
  onSeedChange,
  onAllowedActionsChange,
  onAppExitPolicyChange,
  onBacktrackStrategyChange,
  onMaxDepthChange,
  onDangerousTextPatternsChange,
  onStart,
  onStop,
  onOpenRun
}: StabilityExplorerPanelProps) {
  const running = Boolean(currentRun && isActiveRunStatus(currentRun));
  const canStart = Boolean(selectedSerial && packageName.trim() && !selectedDeviceBusy && !busy);

  return (
    <section className="module-page stability-module">
      <div className="panel module-head-panel">
        <div>
          <span className="module-eyebrow">稳定性探索</span>
          <h2>指定包稳定性巡检</h2>
        </div>
        <div className="module-stat-grid">
          <div>
            <strong>{summary?.progressText ?? "0 / 0"}</strong>
            <span>探索进度</span>
          </div>
          <div>
            <strong>{currentRun?.status ?? "idle"}</strong>
            <span>运行状态</span>
          </div>
          <div>
            <strong>{summary?.skippedCandidates ?? 0}</strong>
            <span>过滤候选</span>
          </div>
        </div>
      </div>

      <div className="stability-layout">
        <div className="panel stability-config-panel">
          <div className="panel-head">
            <h2>执行配置</h2>
          </div>
          <div className="stability-form-grid">
            <label>
              设备
              <select value={selectedSerial} onChange={(event) => onSelectDevice(event.target.value)}>
                <option value="">选择设备</option>
                {devices.map((device) => (
                  <option key={device.serial} value={device.serial}>
                    {device.name || device.serial}
                  </option>
                ))}
              </select>
            </label>
            <label>
              目标包
              <input list="stability-package-options" value={packageName} onChange={(event) => onPackageNameChange(event.target.value)} placeholder="com.example.app" />
              <datalist id="stability-package-options">
                {packageOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label>
              最大时长
              <input min={1} max={30} type="number" value={maxDurationMinutes} onChange={(event) => onMaxDurationMinutesChange(clampNumberInput(event.target.value, 1, 30, 3))} />
            </label>
            <label>
              最大动作
              <input min={1} max={1000} type="number" value={maxActions} onChange={(event) => onMaxActionsChange(clampNumberInput(event.target.value, 1, 1000, 100))} />
            </label>
            <label>
              策略
              <select value={strategy} onChange={(event) => onStrategyChange(event.target.value as StabilityExplorerStrategy)}>
                <option value="conservative">保守</option>
                <option value="balanced">平衡</option>
                <option value="aggressive">激进</option>
              </select>
            </label>
            <label>
              起始方式
              <select value={startMode} onChange={(event) => onStartModeChange(event.target.value as StabilityExplorerStartMode)}>
                <option value="restart_app">重启 App</option>
                <option value="launch_app">启动 App</option>
                <option value="current_state">当前页开始</option>
              </select>
            </label>
            <label>
              Seed
              <input value={seed} onChange={(event) => onSeedChange(event.target.value)} placeholder="自动生成" />
            </label>
            <label>
              App 外处理
              <select value={appExitPolicy} onChange={(event) => onAppExitPolicyChange(event.target.value as StabilityExplorerAppExitPolicy)}>
                <option value="back_to_app">返回 App</option>
                <option value="restart_app">重启 App</option>
                <option value="stop">停止探索</option>
              </select>
            </label>
            <label>
              回退策略
              <select value={backtrackStrategy} onChange={(event) => onBacktrackStrategyChange(event.target.value as StabilityExplorerBacktrackStrategy)}>
                <option value="shallow">浅层回退</option>
                <option value="depth_first">深度优先</option>
                <option value="none">不主动返回</option>
              </select>
            </label>
            <label>
              最大深度
              <input min={1} max={10} type="number" value={maxDepth} onChange={(event) => onMaxDepthChange(clampNumberInput(event.target.value, 1, 10, DEFAULT_STABILITY_EXPLORER_MAX_DEPTH))} />
            </label>
          </div>

          <div className="stability-checkbox-grid">
            {(["tap", "swipe", "back", "wait"] as const).map((action) => (
              <label key={action}>
                <input
                  type="checkbox"
                  checked={allowedActions[action]}
                  onChange={(event) => onAllowedActionsChange({ ...allowedActions, [action]: event.target.checked })}
                />
                {stabilityActionLabel(action)}
              </label>
            ))}
          </div>

          <label className="stability-danger-list">
            危险词
            <textarea value={dangerousTextPatternsText} onChange={(event) => onDangerousTextPatternsChange(event.target.value)} rows={5} />
          </label>

          <AppMonitorExecutionToggle
            enabled={androidAppMonitorEnabled}
            packageName={packageName}
            onChange={onAndroidAppMonitorEnabledChange}
          />

          <div className="action-row">
            <button className="icon-button primary" type="button" disabled={!canStart} onClick={onStart}>
              <PlayCircle size={16} />
              开始探索
            </button>
            {running && currentRun ? (
              <button className="icon-button danger" type="button" disabled={busy} onClick={() => onStop(currentRun.id)}>
                <Square size={16} />
                停止
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel stability-status-panel">
          <div className="panel-head">
            <h2>执行提示</h2>
            {currentRun ? <span className={`run-status-mini ${currentRun.status}`}>{currentRun.status}</span> : null}
          </div>
          {currentRun && summary ? (
            <>
              <div className="stability-run-card">
                <strong>{currentRun.caseName}</strong>
                <span>{currentRun.id}</span>
              </div>
              <div className="stability-facts">
                <div><span>设备</span><strong>{selectedDevice?.name || selectedSerial || currentRun.deviceSerial}</strong></div>
                <div><span>包名</span><strong>{summary.packageName}</strong></div>
                <div><span>Seed</span><strong>{summary.seed}</strong></div>
                <div><span>当前包</span><strong>{summary.currentPackage}</strong></div>
                <div><span>最近动作</span><strong>{summary.latestAction}</strong></div>
                <div><span>动作来源</span><strong>{summary.latestSource}</strong></div>
              </div>
              <div className="stability-timeline">
                {currentRun.stepResults.slice(-6).reverse().map((step) => (
                  <div key={step.id} className={`stability-step ${step.status}`}>
                    <strong>{step.stepOrder}. {stabilityStepLabel(step)}</strong>
                    <span>{step.type} · {step.status} · {step.durationMs ?? "-"} ms</span>
                    {step.errorMessage ? <small>{step.errorMessage}</small> : null}
                  </div>
                ))}
                {!currentRun.stepResults.length ? <div className="empty">启动中，等待第一步探索结果</div> : null}
              </div>
              <div className="action-row">
                <button className="icon-button" type="button" onClick={() => onOpenRun(currentRun.id)}>
                  查看执行
                </button>
                {currentRun.reportHtmlPath ? (
                  <a className="report-link" href={`/api/reports/${currentRun.id}/html`} target="_blank" rel="noreferrer">
                    打开报告
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            <div className="empty">选择设备和目标包后启动探索</div>
          )}
        </div>
      </div>
    </section>
  );
}

type DeviceManagementViewProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  previewPanel: ReactNode;
  tools: ToolStatus[];
  runs: TestRun[];
  activeRunForSelectedDevice?: TestRun;
  onOpenRuns: () => void;
  onRefreshDevices: () => void;
};

function DeviceManagementView({
  devices,
  selectedSerial,
  selectedDevice,
  previewPanel,
  tools,
  runs,
  activeRunForSelectedDevice,
  onOpenRuns,
  onRefreshDevices
}: DeviceManagementViewProps) {
  const selectedDeviceRuns = selectedSerial ? runs.filter((run) => run.deviceSerial === selectedSerial).slice(0, 5) : [];
  const selectableDeviceCount = devices.filter(isControllableDevice).length;
  const onlineCount = devices.filter((device) => device.status === "online").length;
  const unavailableCount = devices.length - selectableDeviceCount;
  const activeRunsCount = runs.filter(isActiveRunStatus).length;

  return (
    <section className="module-page device-module">
      <div className="device-management-preview">{previewPanel}</div>

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
                <strong>{selectableDeviceCount}</strong>
                <span>可用设备</span>
              </div>
              <div>
                <strong>{onlineCount}</strong>
                <span>在线</span>
              </div>
              <div>
                <strong>{unavailableCount}</strong>
                <span>已隐藏</span>
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

export function selectPageAssetLibraryVersionId(
  libraries: PageAssetLibraryListItem[],
  platform: DeviceInfo["platform"],
  targetProfile?: AssetTargetProfileLookup
): string | undefined {
  const activeLibraries = libraries.filter((library) => {
    if (library.status === "deprecated" || !library.activeVersion?.id) {
      return false;
    }
    if (library.activeVersion.status && library.activeVersion.status !== "active") {
      return false;
    }
    return platformScopeMatchesLibrary(library.platformScope, platform);
  });
  if (hasTargetProfileLookup(targetProfile, platform)) {
    return activeLibraries.find((library) => libraryMatchesTargetProfile(library, targetProfile, platform))?.activeVersion?.id;
  }
  return activeLibraries[0]?.activeVersion?.id;
}

type AssetRecordingGraphVersionResolution = {
  graphVersionId?: string;
  targetProfile?: AssetTargetProfileLookup;
};

export async function resolveAssetRecordingGraphVersionId(input: {
  platform: DeviceInfo["platform"];
  observe: () => Promise<AssetObservation | undefined>;
  fetchWritableGraphVersionId: (platform: DeviceInfo["platform"], targetProfile?: AssetTargetProfileLookup) => Promise<string | undefined>;
  retryDelayMs?: number;
  maxProfileAttempts?: number;
}): Promise<AssetRecordingGraphVersionResolution> {
  const maxAttempts = Math.max(1, Math.floor(input.maxProfileAttempts ?? 2));
  let lastTargetProfile: AssetTargetProfileLookup | undefined;
  for (let index = 0; index < maxAttempts; index += 1) {
    const targetProfile = targetProfileLookupFromObservation(await input.observe().catch(() => undefined));
    if (targetProfile) {
      lastTargetProfile = targetProfile;
      const graphVersionId = await input.fetchWritableGraphVersionId(input.platform, targetProfile);
      if (graphVersionId) {
        return { graphVersionId, targetProfile };
      }
    } else {
      const graphVersionId = await input.fetchWritableGraphVersionId(input.platform);
      if (graphVersionId) {
        return { graphVersionId };
      }
    }
    if (index < maxAttempts - 1) {
      await delay(input.retryDelayMs ?? 250);
    }
  }
  return { targetProfile: lastTargetProfile };
}

export function pageAssetLibraryInitialization(
  platform: DeviceInfo["platform"],
  targetProfile?: AssetTargetProfileLookup
): PageAssetLibraryInitialization | undefined {
  const targetIdentifier = platform === "android"
    ? normalizeText(targetProfile?.androidPackageName)
    : normalizeText(targetProfile?.iosBundleId);
  if (!targetIdentifier) {
    return undefined;
  }
  return {
    platform,
    appId: targetIdentifier,
    targetIdentifier,
    defaultName: `${targetIdentifier} 页面资产`
  };
}

function delay(ms: number): Promise<void> {
  const delayMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

async function fetchWritableGraphVersionId(platform: DeviceInfo["platform"], targetProfile?: AssetTargetProfileLookup): Promise<string | undefined> {
  const response = await fetch("/api/page-assets");
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { libraries: PageAssetLibraryListItem[] };
  return selectPageAssetLibraryVersionId(json.libraries, platform, targetProfile);
}

function libraryMatchesTargetProfile(library: PageAssetLibraryListItem, targetProfile: AssetTargetProfileLookup | undefined, platform: DeviceInfo["platform"]): boolean {
  return targetProfilesForLibrary(library).some((profile) => {
    if (platform === "android") {
      const androidPackageName = normalizeText(targetProfile?.androidPackageName);
      return profile.platform === "android" && Boolean(androidPackageName) && normalizeText(profile.androidPackageName) === androidPackageName;
    }
    const iosBundleId = normalizeText(targetProfile?.iosBundleId);
    return profile.platform === "ios" && Boolean(iosBundleId) && normalizeText(profile.iosBundleId) === iosBundleId;
  });
}

function targetProfilesForLibrary(library: PageAssetLibraryListItem): PageAssetTargetProfile[] {
  const profiles = (library.targetApp?.profiles ?? [])
    .map(normalizePageAssetTargetProfile)
    .filter((profile): profile is PageAssetTargetProfile => Boolean(profile));
  return dedupePageAssetTargetProfiles(profiles);
}

function normalizePageAssetTargetProfile(profile: PageAssetTargetProfile): PageAssetTargetProfile | undefined {
  const platform = profile.platform === "android" || profile.platform === "ios" || profile.platform === "harmony" || profile.platform === "flutter" ? profile.platform : undefined;
  if (!platform) {
    return undefined;
  }
  return {
    ...profile,
    id: normalizeText(profile.id) ?? `${platform}:profile`,
    platform,
    displayName: normalizeText(profile.displayName),
    androidPackageName: normalizeText(profile.androidPackageName),
    iosBundleId: normalizeText(profile.iosBundleId),
    harmonyBundleName: normalizeText(profile.harmonyBundleName),
    flutterAppId: normalizeText(profile.flutterAppId)
  };
}

function dedupePageAssetTargetProfiles(profiles: PageAssetTargetProfile[]): PageAssetTargetProfile[] {
  const seen = new Set<string>();
  const result: PageAssetTargetProfile[] = [];
  for (const profile of profiles) {
    const key = pageAssetTargetProfileKey(profile);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(profile);
  }
  return result;
}

function pageAssetTargetProfileKey(profile: PageAssetTargetProfile): string {
  if (profile.platform === "android" && profile.androidPackageName) {
    return `android:${profile.androidPackageName}`;
  }
  if (profile.platform === "ios" && profile.iosBundleId) {
    return `ios:${profile.iosBundleId}`;
  }
  if (profile.platform === "harmony" && profile.harmonyBundleName) {
    return `harmony:${profile.harmonyBundleName}`;
  }
  if (profile.platform === "flutter" && profile.flutterAppId) {
    return `flutter:${profile.flutterAppId}`;
  }
  return `${profile.platform ?? "unknown"}:${profile.id ?? ""}`;
}

function targetProfileLookupFromObservation(observation: AssetObservation | undefined): AssetTargetProfileLookup | undefined {
  if (!observation) {
    return undefined;
  }
  if (observation.platform === "android") {
    const androidPackageName = normalizeText(observation.packageName);
    return androidPackageName ? { androidPackageName } : undefined;
  }
  const iosBundleId = normalizeText(observation.bundleId);
  return iosBundleId ? { iosBundleId } : undefined;
}

function hasTargetProfileLookup(targetProfile: AssetTargetProfileLookup | undefined, platform: DeviceInfo["platform"]): boolean {
  return platform === "android" ? Boolean(normalizeText(targetProfile?.androidPackageName)) : Boolean(normalizeText(targetProfile?.iosBundleId));
}

function platformScopeMatchesLibrary(scope: string | undefined, platform: DeviceInfo["platform"]): boolean {
  return !scope || scope === platform || scope === "mobile-both";
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function knownStabilityPackages(runs: TestRun[]): string[] {
  const packages = new Set<string>();
  for (const run of runs) {
    if (run.config.startAppPackageName) {
      packages.add(run.config.startAppPackageName);
    }
    if (run.config.stabilityExploration?.packageName) {
      packages.add(run.config.stabilityExploration.packageName);
    }
  }
  return Array.from(packages).sort();
}

function clampNumberInput(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function stabilityActionLabel(action: keyof StabilityAllowedActions): string {
  if (action === "tap") {
    return "点击";
  }
  if (action === "swipe") {
    return "滑动";
  }
  if (action === "back") {
    return "返回";
  }
  return "等待";
}

function stabilityStepLabel(step: TestRun["stepResults"][number]): string {
  const metadata = step.metadata?.stabilityExploration;
  if (isStabilityStepMetadata(metadata)) {
    return metadata.candidateLabel ?? metadata.resultType ?? step.type;
  }
  return step.type;
}

function isStabilityStepMetadata(value: unknown): value is {
  candidateLabel?: string;
  candidateSource?: string;
  currentPackage?: string;
  resultType?: string;
  skippedCandidates?: Array<{ label?: string; skipReason?: string }>;
} {
  return typeof value === "object" && value !== null;
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
  if (result.status === "blocked") {
    const message = result.message ?? result.blocker?.message ?? result.matcherDiagnostics?.pollution?.message ?? "当前页面识别被阻断，请查看诊断信息";
    return {
      status: "error",
      message,
      graphVersionId,
      assetKind: "page",
      observation: result.observation,
      match: result.match,
      pageName: sanitizeAssetDisplayName(result.visualPageName) ?? "未知页面",
      visualPageName: sanitizeAssetDisplayName(result.visualPageName),
      matchScore: result.match.score,
      packageName: result.observation?.packageName ?? result.observation?.bundleId,
      activityName: result.observation?.activityName ?? result.observation?.componentName,
      screenshotUrl: observationScreenshotUrl(result.observation),
      matchedMatchers: summarizeEvidenceDiagnostics(result.matcherDiagnostics?.matchedEvidence),
      missedMatchers: summarizeEvidenceDiagnostics(result.matcherDiagnostics?.missingEvidence),
      uiTexts: summarizeObservationTexts(result.observation, "ui"),
      ocrTexts: summarizeObservationTexts(result.observation, "ocr"),
      aiDescription: message,
      savedAssets: mapPageAssets(response.assets)
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
    pageKey: node?.key,
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
    aiDescription: stringMetadata(nodeMetadata, "aiDescription") ?? summarizeAssetAiDescription(mappedStatus, pageName, observation),
    savedAssets: mapPageAssets(response.assets)
  };
}

function mapPageAssets(assets: CurrentPageAssetApiResponse["assets"]): AssetRecordingCurrentPage["savedAssets"] {
  return (assets?.pageAssets ?? []).map((asset) => ({
    id: asset.id,
    key: asset.key,
    name: asset.name,
    status: asset.status,
    platformScope: asset.platformScope,
    matcherCount: asset.matcherCount,
    updatedAt: asset.updatedAt
  }));
}

function inferVisualPageName(observation: AssetObservation | undefined, fallback?: string): string | undefined {
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
  return trimmed.replace(/^(运行期未知节点|资产候选节点|录制节点)：\s*/, "").trim() || trimmed;
}

function isLikelyPageTitle(text: string): boolean {
  return text.length <= 12 && !/^\d+$/.test(text) && /[\u4e00-\u9fa5]/.test(text);
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function observationScreenshotUrl(observation: AssetObservation | undefined): string | undefined {
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

function clampPercent(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function summarizeObservationTexts(observation: AssetObservation | undefined, source: "ui" | "ocr"): string[] {
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

function summarizeOcrEvidenceValue(text: AssetObservation["ocrTexts"][number], resolution: AssetObservation["resolution"]): string | undefined {
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
  region: AssetObservation["ocrTexts"][number]["region"],
  resolution: AssetObservation["resolution"]
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

function summarizeAssetAiDescription(status: NonNullable<CurrentPageAssetApiResponse["result"]>["status"], pageName: string | undefined, observation: AssetObservation | undefined): string {
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
  if (result.status === "blocked") {
    return result.message ?? result.blocker?.message ?? result.matcherDiagnostics?.pollution?.message ?? "当前页面识别被阻断";
  }
  return "当前页面识别完成";
}

function buildAssetObservationFromSnapshots(
  serial: string,
  platform: DeviceInfo["platform"],
  snapshots: SemanticSnapshots
): AssetObservation | undefined {
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
    id: `asset_observation_${Date.now()}`,
    deviceSerial: serial,
    platform,
    capturedAt: latestCapturedAt([element?.capturedAt, text?.capturedAt]),
    packageName: uiElements.find((item) => item.packageName)?.packageName,
    resolution,
    uiElements,
    ocrTexts
  };
}

function deviceActionToAssetRecordingStep(action: AssetRecordingAction, deviceSize: { width: number; height: number }): ActionStep {
  const base = {
    id: `asset-step-${Date.now()}`,
    order: 1,
    enabled: true,
    params: {},
    preconditions: [],
    expectations: [],
    createdAt: nowIso()
  };
  if (action.type === "tap") {
    return {
      ...base,
      type: "tap",
      coordinate: coordinateForPoint(action, deviceSize)
    };
  }
  if (action.type === "tap_on_text") {
    return {
      ...base,
      type: "tap_on_text",
      title: `点击文字：${action.text}`,
      params: {
        text: action.text,
        mode: action.mode ?? "contains",
        timeoutMs: action.timeoutMs ?? 3000,
        intervalMs: action.intervalMs ?? 500,
        lang: action.lang ?? "",
        locator: "ocr_text"
      },
      coordinate: coordinateForPoint(action, deviceSize)
    };
  }
  if (action.type === "tap_on_element") {
    return {
      ...base,
      type: "tap_on_element",
      title: `点击元素：${action.selector ?? describeAssetElementLocator(action.locator)}`,
      params: {
        locator: action.locator,
        selector: action.selector ?? describeAssetElementLocator(action.locator),
        bounds: action.bounds,
        resourceId: action.locator.resourceId,
        text: action.locator.text,
        contentDesc: action.locator.contentDesc,
        className: action.locator.className,
        packageName: action.locator.packageName,
        occurrence: action.locator.occurrence,
        timeoutMs: action.timeoutMs ?? 3000,
        intervalMs: action.intervalMs ?? 500,
        maxDistance: action.maxDistance ?? 240
      },
      coordinate: coordinateForPoint(action, deviceSize)
    };
  }
  if (action.type === "swipe") {
    return {
      ...base,
      type: "swipe",
      params: { durationMs: action.durationMs ?? 450 },
      coordinate: {
        startX: action.startX,
        startY: action.startY,
        endX: action.endX,
        endY: action.endY,
        startXRatio: ratio(action.startX, deviceSize.width),
        startYRatio: ratio(action.startY, deviceSize.height),
        endXRatio: ratio(action.endX, deviceSize.width),
        endYRatio: ratio(action.endY, deviceSize.height),
        deviceWidth: deviceSize.width,
        deviceHeight: deviceSize.height
      }
    };
  }
  if (action.type === "long_press") {
    return {
      ...base,
      type: "long_press",
      params: { durationMs: action.durationMs ?? 800 },
      coordinate: coordinateForPoint(action, deviceSize)
    };
  }
  if (action.type === "hide_keyboard") {
    return {
      ...base,
      type: "wait",
      params: { durationMs: 0, internalDeviceAction: "hide_keyboard" }
    };
  }
  return {
    ...base,
    type: action.type,
    params: actionToAssetStepParams(action)
  };
}

function coordinateForPoint(point: { x: number; y: number }, deviceSize: { width: number; height: number }): NonNullable<ActionStep["coordinate"]> {
  return {
    x: point.x,
    y: point.y,
    xRatio: ratio(point.x, deviceSize.width),
    yRatio: ratio(point.y, deviceSize.height),
    deviceWidth: deviceSize.width,
    deviceHeight: deviceSize.height
  };
}

function ratio(value: number, size: number): number | undefined {
  return size > 0 ? value / size : undefined;
}

function actionToAssetStepParams(action: DeviceActionRequest): Record<string, unknown> {
  if (action.type === "input_text" || action.type === "input_keyevents") {
    return { text: action.text, ...(action.type === "input_keyevents" ? { intervalMs: action.intervalMs } : {}) };
  }
  if (action.type === "wait") {
    return { durationMs: action.durationMs };
  }
  if (action.type === "launch_app" || action.type === "close_app") {
    return { packageName: action.packageName };
  }
  return {};
}

function describeAssetElementLocator(locator: Extract<SemanticDeviceActionRequest, { type: "tap_on_element" }>["locator"]): string {
  const occurrence = typeof locator.occurrence === "number" && Number.isFinite(locator.occurrence) && locator.occurrence > 1 ? `#${Math.floor(locator.occurrence)}` : "";
  if (locator.resourceId) {
    return `id=${locator.resourceId}${occurrence}`;
  }
  if (locator.contentDesc) {
    return `desc=${locator.contentDesc}${occurrence}`;
  }
  if (locator.text) {
    return `text=${locator.text}${occurrence}`;
  }
  return "android_uiautomator";
}

async function fetchAssetObservation(serial: string): Promise<AssetObservation | undefined> {
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/observation?screenshot=false&uiTree=true&ocr=false`);
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { observation?: unknown };
  return isAssetObservation(json.observation) ? json.observation : undefined;
}

async function fetchAssetForegroundObservation(serial: string): Promise<AssetObservation | undefined> {
  const response = await fetch(`/api/devices/${encodeURIComponent(serial)}/observation?screenshot=false&uiTree=false&ocr=false`);
  if (!response.ok) {
    return undefined;
  }
  const json = (await response.json()) as { observation?: unknown };
  return isAssetObservation(json.observation) ? json.observation : undefined;
}

function isAssetObservation(value: unknown): value is AssetObservation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<AssetObservation>;
  return (
    (input.platform === "android" || input.platform === "ios") &&
    typeof input.capturedAt === "string" &&
    Array.isArray(input.uiElements) &&
    Array.isArray(input.ocrTexts)
  );
}

function pickRuntimeInterceptorTriggerText(observation: AssetObservation): string {
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

function pickRuntimeInterceptorActionText(observation: AssetObservation, triggerText: string): string {
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
