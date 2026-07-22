import {
  PlayCircle,
  RefreshCw,
  Save,
  Square,
  Smartphone
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import {
  viewportPointToDevicePoint,
  type DeviceActionRequest,
  type DeviceInfo,
  type ParameterProfile,
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
  type AssetRecordingDynamicMask,
  type AssetRecordingLocatorKind,
  type AssetRecordingOperationTransitionDraft,
  type AssetRecordingPageElementDraft,
  type AssetRecordingPageTask,
  type AssetRecordingPageTaskDraft,
  type AssetRecordingPageTaskTransitionDraft
} from "./components/AssetRecordingPanel";
import type { FlowExpectationOverride } from "./components/CaseLibraryPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { PageAssetsPanel, parseRuntimeParams } from "./components/PageAssetsPanel";
import { AssetCompositionPanel } from "./components/AssetCompositionPanel";
import { FreeCompositionPanel } from "./components/FreeCompositionPanel";
import type { RuntimeInterceptorRule } from "./components/RuntimeInterceptorPanel";
import { StepsPanel } from "./components/StepsPanel";
import { ToolStatusBar } from "./components/StepsPanelParts";
import { useDeviceList } from "./hooks/useDeviceList";
import { controllableDevices, isControllableDevice } from "./device-availability";
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

type AutomationTab = "steps" | "runs";
type NavItemId = AppNavItemId;
type StabilityExplorerStrategy = "conservative" | "balanced" | "aggressive";
type StabilityExplorerStartMode = "launch_app" | "current_state" | "restart_app";
type StabilityExplorerAppExitPolicy = "back_to_app" | "restart_app" | "stop";
type StabilityExplorerBacktrackStrategy = "none" | "shallow" | "depth_first";
type AssetPatrolStartMode = "current_state" | "launch_app" | "restart_app";
type AssetPatrolPageScope = "current_page" | "reachable_pages" | "tagged_pages" | "all_active_pages";
type AssetPatrolPlanStep = {
  id: string;
  order: number;
  kind: string;
  label: string;
  status: "ready" | "skipped" | "needs_repair";
  skipReason?: string;
  pageModelName?: string;
  pageElementId?: string;
  pageTransitionId?: string;
  pageTaskId?: string;
  evidence?: Record<string, unknown>;
};
type AssetPatrolPlanGroup = {
  key: "page" | "element" | "transition" | "task";
  title: string;
  items: Array<{
    id: string;
    label: string;
    detail: string;
    status: AssetPatrolPlanStep["status"];
  }>;
};
type AssetPatrolPlan = {
  status: "ready" | "diagnostic";
  startPage?: { id: string; name: string; score: number };
  issues: Array<{ code: string; severity: "warning" | "error"; message: string }>;
  steps: AssetPatrolPlanStep[];
  summary: {
    pageChecks: number;
    elementChecks: number;
    transitionChecks: number;
    taskChecks: number;
    skipped: number;
    needsRepair: number;
  };
};
type AssetRuntimeParamDefinition = {
  key: string;
  usages?: Array<{
    pageModelName?: string;
    taskName?: string;
    stepLabel?: string;
    fieldType?: string;
    binding?: string;
  }>;
};
type AssetDrivenExecutionItem = {
  id: string;
  order: number;
  label: string;
  fromPage: string;
  toPage: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped" | "stopped";
  runId?: string;
  latestStep?: string;
  errorMessage?: string;
  reportHtmlPath?: string;
};
type AssetDrivenExecutionSession = {
  id: string;
  deviceSerial: string;
  packageName: string;
  graphVersionId?: string;
  startNodeId: string;
  startNodeName: string;
  status: "running" | "passed" | "failed" | "stopped";
  totalEdges: number;
  completedEdges: number;
  runningEdges: number;
  pendingEdges: number;
  failedEdges: number;
  needsRepair: number;
  runningItem?: AssetDrivenExecutionItem;
  items: AssetDrivenExecutionItem[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
};
type StabilityAllowedActions = {
  tap: boolean;
  swipe: boolean;
  back: boolean;
  wait: boolean;
};
type TextStorage = Pick<Storage, "getItem" | "setItem">;
type AiDiagnosisSettingsSource = "stored" | "environment" | "none";
export type PublicAiDiagnosisSettings = {
  enabled: boolean;
  baseURL: string;
  model: string;
  timeoutMs: number;
  apiKeyConfigured: boolean;
  source: AiDiagnosisSettingsSource;
};
export type AiDiagnosisSettingsDraft = {
  enabled: boolean;
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  clearApiKey?: boolean;
};

export const DEFAULT_STABILITY_EXPLORER_START_MODE: StabilityExplorerStartMode = "restart_app";
export const DEFAULT_STABILITY_EXPLORER_APP_EXIT_POLICY: StabilityExplorerAppExitPolicy = "back_to_app";
export const DEFAULT_STABILITY_EXPLORER_MAX_DEPTH = 4;
export const DEFAULT_STABILITY_DANGEROUS_TEXT_PATTERNS = ["删除", "退出登录", "注销", "支付", "发布", "提交", "确认删除"];
export const DEFAULT_STABILITY_DANGEROUS_TEXT = DEFAULT_STABILITY_DANGEROUS_TEXT_PATTERNS.join("\n");
export const DEFAULT_ASSET_PATROL_PACKAGE_NAME = "cn.eeo.classin";
export const DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES: Record<string, string> = {
  phone: "18743085313",
  mobile: "18743085313",
  password: "eeo123",
  pwd: "eeo123",
  className: "班级四十二号",
  lessonName: "班级四十二号",
  duration: "30",
  recordClassroom: "true",
  recordLive: "false"
};
export const ASSET_DRIVEN_TEST_ACTION_LABEL = "开始资产测试";
export const ASSET_PATROL_DIAGNOSTIC_MODE_NOTICE = "当前为诊断模式：只检查页面匹配、元素重定位、边和任务编排质量，不会触发页面点击或输入。";
export const DEFAULT_AI_DIAGNOSIS_SETTINGS: PublicAiDiagnosisSettings = {
  enabled: false,
  baseURL: "",
  model: "",
  timeoutMs: 30_000,
  apiKeyConfigured: false,
  source: "none"
};
const STABILITY_DANGEROUS_TEXT_BY_PACKAGE_STORAGE_KEY = "mobile-automation.stabilityDangerousTextByPackage.v1";
type RecordingWorkspaceStyle = CSSProperties & {
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

export function previewWorkspaceKey(navItem: AppNavItemId): "recording" | "assetRecording" | "inactive" {
  if (navItem === "recording" || navItem === "assetRecording") {
    return navItem;
  }
  return "inactive";
}

export function workspaceStyleForNav(navItem: AppNavItemId, _recordingPreviewWidth: number, assetRecordingPreviewWidth: number): RecordingWorkspaceStyle {
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
    ...(draft.tapPointPercent ? { tapPointPercent: draft.tapPointPercent } : {}),
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {}),
    ...(draft.locatorKind ? { locatorKind: draft.locatorKind } : {}),
    ...(draft.dynamicMasks?.length ? { dynamicMasks: draft.dynamicMasks } : {}),
    ...(draft.structuralLocator ? { structuralLocator: draft.structuralLocator } : {}),
    ...(draft.dynamicRegion ? { dynamicRegion: draft.dynamicRegion } : {}),
    ...(draft.itemTemplate ? { itemTemplate: draft.itemTemplate } : {}),
    ...(draft.transitionKind ? { transitionKind: draft.transitionKind } : {}),
    ...(draft.parameterMapping ? { parameterMapping: draft.parameterMapping } : {})
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
    ...(draft.tapPointPercent ? { tapPointPercent: draft.tapPointPercent } : {}),
    ...(draft.anchorOffsetPercent ? { anchorOffsetPercent: draft.anchorOffsetPercent } : {}),
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {}),
    ...(draft.quality ? { quality: draft.quality } : {}),
    ...(draft.visualLocator ? { visualLocator: draft.visualLocator } : {}),
    ...(draft.locatorKind ? { locatorKind: draft.locatorKind } : {}),
    ...(draft.dynamicMasks?.length ? { dynamicMasks: draft.dynamicMasks } : {}),
    ...(draft.structuralLocator ? { structuralLocator: draft.structuralLocator } : {}),
    ...(draft.dynamicRegion ? { dynamicRegion: draft.dynamicRegion } : {}),
    ...(draft.itemTemplate ? { itemTemplate: draft.itemTemplate } : {}),
    ...(draft.transitionKind ? { transitionKind: draft.transitionKind } : {}),
    ...(draft.parameterMapping ? { parameterMapping: draft.parameterMapping } : {})
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
  if ((draft.outcomeType === "navigate" || draft.outcomeType === "compound_navigation") && !draft.targetNodeId) {
    return "跳转页面类型必须选择已保存的目标页面；如果只是普通点击，请把结果类型改为本页状态变化或无可见变化";
  }
  const region = imageRegionMetadata(draft.locator);
  if (region && isRegionTooSmallForPageElement(region)) {
    return "圈选区域过小，请重新圈选完整的可识别元素区域";
  }
  if (draft.outcomeType === "navigate" && !draft.targetNodeId?.trim()) {
    return "跳转页面类型必须选择已保存的目标页面，否则不会进入路径规划";
  }
  return undefined;
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
    stopOnUnknownPageStuck: true
  };
}

export function assetPatrolPageScopeOptions(): Array<{ value: AssetPatrolPageScope; label: string; disabled: boolean }> {
  return [
    { value: "current_page", label: "当前页", disabled: false },
    { value: "reachable_pages", label: "可达页面", disabled: false },
    { value: "tagged_pages", label: "标记页面（后续接入）", disabled: true },
    { value: "all_active_pages", label: "全部已激活页面（后续接入）", disabled: true }
  ];
}

export function assetPatrolRequestBody(input: {
  selectedSerial: string;
  packageName: string;
  startMode: AssetPatrolStartMode;
  pageScope: AssetPatrolPageScope;
  maxDurationMinutes: number;
  maxTransitions: number;
  allowRiskyActions: boolean;
  allowBusinessSubmit: boolean;
  dangerousTextPatternsText: string;
  parameterProfileId?: string;
  runtimeParamsText?: string;
}) {
  const runtimeParams = parseRuntimeParams(input.runtimeParamsText);
  return {
    deviceSerial: input.selectedSerial,
    packageName: input.packageName.trim(),
    startMode: input.startMode,
    pageScope: supportedAssetPatrolPageScope(input.pageScope),
    maxDurationMs: Math.max(1, Math.floor(input.maxDurationMinutes || 1)) * 60_000,
    maxTransitions: Math.max(0, Math.floor(input.maxTransitions || 0)),
    allowRiskyActions: input.allowRiskyActions,
    allowBusinessSubmit: input.allowBusinessSubmit,
    dangerousTextPatterns: dangerousTextPatternsFromText(input.dangerousTextPatternsText),
    ...(input.parameterProfileId?.trim() ? { parameterProfileId: input.parameterProfileId.trim() } : {}),
    ...(runtimeParams ? { runtimeParams } : {})
  };
}

export function assetPatrolRuntimeParamsTemplate(parameters: Array<Pick<AssetRuntimeParamDefinition, "key">>): string {
  return parameters
    .map((parameter) => parameter.key.trim())
    .filter(Boolean)
    .map((key) => `${key}=${defaultAssetPatrolRuntimeParamValue(key)}`)
    .join("\n");
}

export function mergeAssetPatrolRuntimeParamsText(currentText: string, parameters: Array<Pick<AssetRuntimeParamDefinition, "key">>): string {
  const existingKeys = runtimeParamKeysFromText(currentText);
  const currentLines = currentText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => defaultedRuntimeParamLine(line));
  const missingLines = parameters
    .map((parameter) => parameter.key.trim())
    .filter((key) => key && !existingKeys.has(key))
    .map((key) => `${key}=${defaultAssetPatrolRuntimeParamValue(key)}`);
  return [...currentLines, ...missingLines].join("\n");
}

function defaultedRuntimeParamLine(line: string): string {
  const separator = line.indexOf("=");
  if (separator < 0) {
    return line;
  }
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (!key || value) {
    return line;
  }
  return `${key}=${defaultAssetPatrolRuntimeParamValue(key)}`;
}

function defaultAssetPatrolRuntimeParamValue(key: string): string {
  const normalized = key.trim();
  if (DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES[normalized] !== undefined) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES[normalized];
  }
  const lower = normalized.toLowerCase();
  if (lower.includes("phone") || lower.includes("mobile")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.phone;
  }
  if (lower.includes("password") || lower.includes("passwd") || lower.includes("pwd")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.password;
  }
  if (lower.includes("classname") || lower.includes("class_name")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.className;
  }
  if (lower.includes("lessonname") || lower.includes("lesson_name") || lower.includes("title")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.lessonName;
  }
  if (lower.includes("duration")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.duration;
  }
  if (lower.includes("recordclassroom")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.recordClassroom;
  }
  if (lower.includes("recordlive")) {
    return DEFAULT_ASSET_PATROL_RUNTIME_PARAM_VALUES.recordLive;
  }
  return "";
}

export function assetPatrolRuntimeParamValuesFromText(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split(/[\n,，;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        if (separator < 0) {
          return undefined;
        }
        const key = item.slice(0, separator).trim();
        return key ? [key, item.slice(separator + 1).trim()] as const : undefined;
      })
      .filter((item): item is readonly [string, string] => Boolean(item))
  );
}

export function setAssetPatrolRuntimeParamValue(currentText: string, key: string, value: string): string {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return currentText;
  }
  const lines = currentText
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let replaced = false;
  const nextLines = lines.map((line) => {
    const separator = line.indexOf("=");
    const lineKey = separator >= 0 ? line.slice(0, separator).trim() : "";
    if (lineKey !== normalizedKey) {
      return line;
    }
    replaced = true;
    return `${normalizedKey}=${value}`;
  });
  if (!replaced) {
    nextLines.push(`${normalizedKey}=${value}`);
  }
  return nextLines.join("\n");
}

export function assetPatrolRuntimeParamDefinitionsForDisplay(
  parameters: AssetRuntimeParamDefinition[],
  currentPageName?: string
): AssetRuntimeParamDefinition[] {
  const normalizedCurrentPageName = currentPageName?.trim();
  return [...parameters].sort((left, right) => {
    const leftCurrentPage = runtimeParamUsedByPage(left, normalizedCurrentPageName);
    const rightCurrentPage = runtimeParamUsedByPage(right, normalizedCurrentPageName);
    if (leftCurrentPage !== rightCurrentPage) {
      return Number(rightCurrentPage) - Number(leftCurrentPage);
    }
    return runtimeParamPriority(left.key) - runtimeParamPriority(right.key);
  });
}

export function assetPatrolRuntimeParamUsageSummary(parameter: AssetRuntimeParamDefinition): string {
  const usage = parameter.usages?.[0];
  return [usage?.pageModelName, usage?.taskName, usage?.stepLabel].filter(Boolean).join(" / ") || parameter.key;
}

export function assetPatrolRuntimeParamPlaceholder(parameter: AssetRuntimeParamDefinition): string {
  const key = parameter.key.toLowerCase();
  const usageText = assetPatrolRuntimeParamUsageSummary(parameter).toLowerCase();
  if (key.includes("password") || usageText.includes("密码")) {
    return "请输入密码";
  }
  if (key.includes("phone") || key.includes("mobile") || usageText.includes("手机号")) {
    return "手机号/邮箱";
  }
  if (key.includes("duration") || usageText.includes("时长")) {
    return "例如：30";
  }
  if (key.includes("record") || parameter.usages?.some((usage) => usage.binding === "desired_state")) {
    return "true / false";
  }
  if (key.includes("name") || key.includes("title") || usageText.includes("标题")) {
    return "填写测试数据";
  }
  return "填写运行值";
}

function runtimeParamUsedByPage(parameter: AssetRuntimeParamDefinition, pageName: string | undefined): boolean {
  if (!pageName) {
    return false;
  }
  return parameter.usages?.some((usage) => usage.pageModelName === pageName) ?? false;
}

function runtimeParamPriority(key: string): number {
  const normalized = key.toLowerCase();
  if (normalized.includes("phone") || normalized.includes("mobile")) {
    return 10;
  }
  if (normalized.includes("password")) {
    return 20;
  }
  if (normalized.includes("classname")) {
    return 30;
  }
  return 100;
}

function runtimeParamKeysFromText(value: string): Set<string> {
  return new Set(
    value
      .split(/[\n,，;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator >= 0 ? item.slice(0, separator).trim() : "";
      })
      .filter(Boolean)
  );
}

function supportedAssetPatrolPageScope(value: AssetPatrolPageScope): AssetPatrolPageScope {
  return value === "current_page" || value === "reachable_pages" ? value : "current_page";
}

export function assetPatrolPlanGroups(plan: AssetPatrolPlan | undefined): AssetPatrolPlanGroup[] {
  if (!plan) {
    return [];
  }
  const groups: AssetPatrolPlanGroup[] = [
    { key: "page", title: "页面", items: [] },
    { key: "element", title: "能力", items: [] },
    { key: "transition", title: "连接边", items: [] },
    { key: "task", title: "任务", items: [] }
  ];
  for (const step of plan.steps) {
    const group = groups.find((item) => item.key === assetPatrolPlanStepGroupKey(step.kind));
    if (!group) {
      continue;
    }
    group.items.push({
      id: step.id,
      label: step.label,
      detail: [step.pageModelName, step.status, step.skipReason].filter(Boolean).join(" · "),
      status: step.status
    });
  }
  return groups.filter((group) => group.items.length > 0);
}

function assetPatrolPlanStepGroupKey(kind: string): AssetPatrolPlanGroup["key"] | undefined {
  if (kind === "page_match" || kind === "screenshot_region_match" || kind === "ocr_region_match") {
    return "page";
  }
  if (kind === "element_relocation" || kind === "content_scroll") {
    return "element";
  }
  if (kind === "transition_validation") {
    return "transition";
  }
  if (kind === "task_dry_run") {
    return "task";
  }
  return undefined;
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

export function assetPatrolRunProgressSummary(run: TestRun | null | undefined) {
  if (!run?.config.assetPatrol) {
    return undefined;
  }
  const latestStep = run.stepResults.at(-1);
  const metadata = latestStep?.metadata?.assetPatrol;
  const patrolMetadata = isAssetPatrolStepMetadata(metadata) ? metadata : undefined;
  const failed = run.stepResults.filter((step) => step.status === "failed").length;
  const skipped = run.stepResults.filter((step) => step.status === "skipped").length;
  const needsRepair = run.stepResults.filter((step) => {
    const item = step.metadata?.assetPatrol;
    return isAssetPatrolStepMetadata(item) && (item.status === "needs_repair" || item.skipReason === "runtime_relocation_required");
  }).length;
  return {
    packageName: run.config.assetPatrol.packageName,
    progressText: `${run.stepResults.length} 项`,
    latestCheck: patrolMetadata?.label ?? "-",
    latestKind: patrolMetadata?.kind ?? "-",
    pageName: patrolMetadata?.pageModelName ?? patrolMetadata?.startPage?.name ?? "-",
    failed,
    skipped,
    needsRepair
  };
}

export function assetDrivenRunProgressSummary(run: TestRun | null | undefined, packageName: string) {
  if (!run) {
    return undefined;
  }
  const assetPatrolSummary = assetPatrolRunProgressSummary(run);
  if (assetPatrolSummary) {
    return assetPatrolSummary;
  }
  const latestStep = run.stepResults.at(-1);
  const failed = run.stepResults.filter((step) => step.status === "failed").length;
  const skipped = run.stepResults.filter((step) => step.status === "skipped").length;
  return {
    packageName: packageName.trim() || "-",
    progressText: `${run.stepResults.length} 步`,
    latestCheck: latestStep ? `${latestStep.stepOrder}. ${latestStep.type}` : "等待执行结果",
    latestKind: run.config.runKind ?? "run",
    pageName: run.caseName,
    failed,
    skipped,
    needsRepair: failed
  };
}

export function assetDrivenExecutionProgressSummary(execution: AssetDrivenExecutionSession | null | undefined) {
  if (!execution) {
    return undefined;
  }
  const latestItem =
    execution.runningItem ??
    execution.items.find((item) => item.status === "failed" || item.status === "stopped") ??
    execution.items.filter((item) => item.status === "passed").at(-1) ??
    execution.items[0];
  return {
    packageName: execution.packageName,
    progressText: `${execution.completedEdges}/${execution.totalEdges}`,
    latestCheck: latestItem?.label ?? "等待执行",
    pageName: execution.startNodeName,
    failed: execution.failedEdges,
    skipped: execution.items.filter((item) => item.status === "skipped").length,
    needsRepair: execution.needsRepair
  };
}

export function assetPatrolPanelDisplayMode(input: { plan?: AssetPatrolPlan; currentRun?: TestRun; assetDrivenExecution?: AssetDrivenExecutionSession }): "run" | "plan" | "empty" {
  if (input.assetDrivenExecution) {
    return "run";
  }
  if (input.currentRun && isActiveRunStatus(input.currentRun)) {
    return "run";
  }
  if (input.plan) {
    return "plan";
  }
  if (input.currentRun) {
    return "run";
  }
  return "empty";
}

export function assetPatrolPlanRequiresBusinessSubmit(plan: AssetPatrolPlan | undefined): boolean {
  if (!plan || plan.status !== "ready") {
    return false;
  }
  return plan.steps.some((step) => step.kind === "task_dry_run" || step.skipReason === "business_submit_disabled");
}

export function shouldAutoSyncAssetPatrolRuntimeParams(input: {
  activeNavItem: AppNavItemId;
  packageName: string;
  lastSyncedPackageName?: string;
}): boolean {
  const packageName = input.packageName.trim();
  return input.activeNavItem === "assetPatrol" && Boolean(packageName) && packageName !== (input.lastSyncedPackageName ?? "").trim();
}

export function shouldRestoreAssetDrivenExecution(input: {
  activeNavItem: AppNavItemId;
  selectedSerial: string;
  packageName: string;
  assetDrivenExecutionId?: string;
}): boolean {
  return input.activeNavItem === "assetPatrol" && Boolean(input.selectedSerial) && Boolean(input.packageName.trim()) && !input.assetDrivenExecutionId;
}

export function canStartAssetDrivenTest(input: {
  selectedSerial: string;
  packageName: string;
  selectedDeviceBusy: boolean;
  busy: boolean;
  running: boolean;
}): boolean {
  return Boolean(input.selectedSerial && input.packageName.trim() && !input.selectedDeviceBusy && !input.busy && !input.running);
}

export function assetDrivenTestStartMessage(run: Pick<TestRun, "id">, queue?: { total?: number; remaining?: number }): string {
  const total = typeof queue?.total === "number" ? queue.total : undefined;
  const remaining = typeof queue?.remaining === "number" ? queue.remaining : undefined;
  if (total && total > 1) {
    return `已启动资产测试：${run.id}，本页面资产边 ${total} 条，剩余 ${Math.max(0, remaining ?? total - 1)} 条后台巡检`;
  }
  return `已启动资产测试：${run.id}`;
}

export function aiDiagnosisDraftFromSettings(settings: PublicAiDiagnosisSettings): AiDiagnosisSettingsDraft {
  return {
    enabled: settings.enabled,
    baseURL: settings.baseURL,
    apiKey: "",
    model: settings.model,
    timeoutMs: settings.timeoutMs || DEFAULT_AI_DIAGNOSIS_SETTINGS.timeoutMs
  };
}

export function aiDiagnosisSettingsRequestBody(draft: AiDiagnosisSettingsDraft): Record<string, unknown> {
  return {
    enabled: draft.enabled,
    baseURL: draft.baseURL.trim(),
    model: draft.model.trim(),
    timeoutMs: draft.timeoutMs,
    apiKey: draft.apiKey.trim() || undefined,
    clearApiKey: draft.clearApiKey === true
  };
}

export function App() {
  const [inputText, setInputText] = useState("");
  const [message, setMessage] = useState("准备连接设备");
  const [busy, setBusy] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [activeNavItem, setActiveNavItem] = useState<NavItemId>("recording");
  const [automationTab, setAutomationTab] = useState<AutomationTab>("steps");
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
  const [assetPatrolPackageName, setAssetPatrolPackageName] = useState(DEFAULT_ASSET_PATROL_PACKAGE_NAME);
  const [assetPatrolStartMode, setAssetPatrolStartMode] = useState<AssetPatrolStartMode>("current_state");
  const [assetPatrolPageScope, setAssetPatrolPageScope] = useState<AssetPatrolPageScope>("current_page");
  const [assetPatrolMaxDurationMinutes, setAssetPatrolMaxDurationMinutes] = useState(2);
  const [assetPatrolMaxTransitions, setAssetPatrolMaxTransitions] = useState(8);
  const [assetPatrolAllowRiskyActions, setAssetPatrolAllowRiskyActions] = useState(false);
  const [assetPatrolAllowBusinessSubmit, setAssetPatrolAllowBusinessSubmit] = useState(false);
  const [assetPatrolDangerousText, setAssetPatrolDangerousText] = useState(DEFAULT_STABILITY_DANGEROUS_TEXT);
  const [assetPatrolParameterProfiles, setAssetPatrolParameterProfiles] = useState<ParameterProfile[]>([]);
  const [assetPatrolParameterProfileId, setAssetPatrolParameterProfileId] = useState("");
  const [assetPatrolPlan, setAssetPatrolPlan] = useState<AssetPatrolPlan>();
  const [assetDrivenPanelRunId, setAssetDrivenPanelRunId] = useState("");
  const [assetDrivenExecutionId, setAssetDrivenExecutionId] = useState("");
  const [assetDrivenExecution, setAssetDrivenExecution] = useState<AssetDrivenExecutionSession>();
  const [aiDiagnosisSettings, setAiDiagnosisSettings] = useState<PublicAiDiagnosisSettings>(DEFAULT_AI_DIAGNOSIS_SETTINGS);
  const [aiDiagnosisDraft, setAiDiagnosisDraft] = useState<AiDiagnosisSettingsDraft>(aiDiagnosisDraftFromSettings(DEFAULT_AI_DIAGNOSIS_SETTINGS));
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
  const aiDiagnosisSettingsLoadedRef = useRef(false);

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
    refreshRuns,
    loadMoreRuns,
    startRun,
    startFlowRun,
    stopCurrentRun,
    pauseCurrentRun,
    resumeCurrentRun,
    stepCurrentRun
  } = useRunExecution({ selectedSerial, caseName, steps, setMessage });

  useEffect(() => {
    if (!assetDrivenExecutionId) {
      setAssetDrivenExecution(undefined);
      return;
    }
    let cancelled = false;
    const refreshExecution = async () => {
      const response = await fetch(`/api/asset-patrols/executions/${encodeURIComponent(assetDrivenExecutionId)}`);
      if (cancelled) {
        return;
      }
      if (!response.ok) {
        return;
      }
      const json = (await response.json().catch(() => ({}))) as { execution?: AssetDrivenExecutionSession };
      if (!cancelled && json.execution) {
        setAssetDrivenExecution(json.execution);
      }
    };
    void refreshExecution();
    const intervalMs = assetDrivenExecution?.status === "running" ? 1000 : 5000;
    const timer = window.setInterval(() => {
      void refreshExecution();
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assetDrivenExecutionId, assetDrivenExecution?.status]);

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

  async function loadAiDiagnosisSettings() {
    try {
      const json = await apiFetchJson<{ settings: PublicAiDiagnosisSettings }>("/api/settings/ai-diagnosis");
      setAiDiagnosisSettings(json.settings);
      setAiDiagnosisDraft(aiDiagnosisDraftFromSettings(json.settings));
      setMessage("已加载 AI 诊断配置");
    } catch (error) {
      aiDiagnosisSettingsLoadedRef.current = false;
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveAiDiagnosisSettings() {
    try {
      setBusy(true);
      const json = await apiFetchJson<{ settings: PublicAiDiagnosisSettings }>("/api/settings/ai-diagnosis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiDiagnosisSettingsRequestBody(aiDiagnosisDraft))
      });
      setAiDiagnosisSettings(json.settings);
      setAiDiagnosisDraft(aiDiagnosisDraftFromSettings(json.settings));
      setMessage("已保存 AI 诊断配置");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refreshStructuredFlows().catch(() => undefined);
    refreshRuntimeInterceptorRules().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeNavItem !== "assetPatrol" || !assetPatrolPackageName.trim()) {
      return;
    }
    const timer = window.setTimeout(() => {
      void syncAssetPatrolParameterProfiles({ silent: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeNavItem, assetPatrolPackageName]);

  useEffect(() => {
    if (!shouldRestoreAssetDrivenExecution({
      activeNavItem,
      selectedSerial,
      packageName: assetPatrolPackageName,
      assetDrivenExecutionId
    })) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void syncLatestAssetDrivenExecution({ silent: true, isCancelled: () => cancelled });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeNavItem, selectedSerial, assetPatrolPackageName, assetDrivenExecutionId]);

  useEffect(() => {
    if (activeNavItem !== "settings" || aiDiagnosisSettingsLoadedRef.current) {
      return;
    }
    aiDiagnosisSettingsLoadedRef.current = true;
    void loadAiDiagnosisSettings();
  }, [activeNavItem]);

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
        setMessage("已刷新页面信息，但本次动作缺少前后页面快照，暂未生成页面连接候选");
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
        throw new Error(json.error ?? "页面连接候选生成失败");
      }
      await identifyCurrentPageAsset();
      const edge = json.result.edge.edge;
      const messagePrefix = edge ? `已生成页面连接候选：${edge.name}` : "动作已执行，暂未生成页面连接候选";
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
    setRecording(false);
  }

  function openAssetRecording() {
    setActiveNavItem("assetRecording");
  }

  function openPageAssets() {
    setActiveNavItem("pageAssets");
  }

  function openAssetPatrol() {
    setActiveNavItem("assetPatrol");
  }

  function openAssetComposition() {
    setActiveNavItem("assetComposition");
  }

  function openFreeComposition() {
    setActiveNavItem("freeComposition");
  }

  function openParameterCenter() {
    setActiveNavItem("parameterCenter");
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
    setActiveNavItem("runs");
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

  async function requestAiPageDraft() {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const observation = assetRecordingPage.observation;
    if (!graphVersionId || !observation) {
      setMessage("请先执行“识别当前页”，再使用 AI 辅助识别");
      return;
    }
    setAssetRecordingAiIdentifying(true);
    try {
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/ai-page-draft`, {
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

  async function saveAssetPageElement(draft: AssetRecordingPageElementDraft): Promise<boolean> {
    const graphVersionId = assetRecordingPage.graphVersionId;
    const sourceNodeId = draft.sourceNodeId ?? assetRecordingPage.nodeId;
    if (!graphVersionId || !sourceNodeId) {
      setMessage("当前页面还没有保存为页面资产，请先保存页面后再录入可操作元素");
      return false;
    }
    const validationMessage = validateAssetPageElementDraftForSave(draft);
    if (validationMessage) {
      setMessage(validationMessage);
      return false;
    }
    try {
      setBusy(true);
      const validationBody = assetPageElementRequestBody(draft, {
        sourceNodeId,
        platformScope: selectedDevice?.platform ?? "android"
      });
      const validationResponse = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-elements/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validationBody,
          ...(selectedSerial ? { deviceSerial: selectedSerial } : {}),
          includeOcr: true
        })
      });
      const validationJson = (await validationResponse.json().catch(() => ({}))) as {
        quality?: AssetRecordingPageElementDraft["quality"];
        visualLocator?: Record<string, unknown>;
        error?: string;
      };
      if (!validationResponse.ok || !validationJson.quality) {
        throw new Error(validationJson.error ?? "可操作元素质量校验失败");
      }
      if (validationJson.quality.status === "fail") {
        throw new Error(validationJson.quality.warnings.find((warning) => warning.severity === "error")?.message ?? "可操作元素质量不满足保存要求");
      }
      const qualityCheckedDraft: AssetRecordingPageElementDraft = {
        ...draft,
        quality: validationJson.quality,
        ...(validationJson.visualLocator ? { visualLocator: validationJson.visualLocator } : {})
      };
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphVersionId)}/assets/page-elements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          assetPageElementRequestBody(qualityCheckedDraft, {
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
          [manualElementFromOperationDraft(qualityCheckedDraft, selectedDevice?.platform ?? "android", json.result?.element)],
          page.elements ?? []
        )
      }));
      setMessage(validationJson.quality.status === "needs_review" ? `已保存可操作元素：${draft.elementLabel}（建议复核定位质量）` : `已保存可操作元素：${draft.elementLabel}`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
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
        throw new Error(json.error ?? "发现页面连接失败");
      }
      setAssetRecordingGraphVersionId(graphVersionId);
      setAssetAutoExploreReport(json.report);
      const action = mode === "preview" ? "已生成页面连接候选" : "页面连接发现完成";
      setMessage(json.report.status === "blocked" ? json.report.message ?? "页面连接发现已阻断" : `${action}：${json.report.plan.steps.length} 步`);
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

  function updateAssetPatrolPackageName(packageName: string) {
    setAssetPatrolPackageName(packageName);
    setAssetPatrolDangerousText(loadStabilityDangerousTextForPackage(packageName));
    setAssetPatrolPlan(undefined);
    setAssetDrivenExecutionId("");
    setAssetDrivenExecution(undefined);
    setAssetPatrolParameterProfiles([]);
    setAssetPatrolParameterProfileId("");
  }

  function assetPatrolRequestPayload() {
    return assetPatrolRequestBody({
      selectedSerial,
      packageName: assetPatrolPackageName,
      startMode: assetPatrolStartMode,
      pageScope: assetPatrolPageScope,
      maxDurationMinutes: assetPatrolMaxDurationMinutes,
      maxTransitions: assetPatrolMaxTransitions,
      allowRiskyActions: assetPatrolAllowRiskyActions,
      allowBusinessSubmit: assetPatrolAllowBusinessSubmit,
      dangerousTextPatternsText: assetPatrolDangerousText,
      parameterProfileId: assetPatrolParameterProfileId
    });
  }

  async function syncAssetPatrolParameterProfiles(options: { silent?: boolean } = {}) {
    const packageName = assetPatrolPackageName.trim();
    if (!packageName) {
      if (!options.silent) {
        setMessage("请先填写目标包名");
      }
      return;
    }
    try {
      if (!options.silent) {
        setBusy(true);
      }
      const query = new URLSearchParams({ appId: packageName, platform: "android" });
      const json = await apiFetchJson<{ profiles?: ParameterProfile[] }>(`/api/asset-composition/parameter-profiles?${query.toString()}`);
      const profiles = (json.profiles ?? []).filter((profile) => profile.status === "active");
      setAssetPatrolParameterProfiles(profiles);
      setAssetPatrolParameterProfileId((current) => profiles.some((profile) => profile.id === current) ? current : profiles[0]?.id ?? "");
      if (!options.silent) {
        setMessage(profiles.length ? `已加载 ${profiles.length} 个执行组合` : "当前应用还没有可用执行组合");
      }
    } catch (error) {
      if (!options.silent) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (!options.silent) {
        setBusy(false);
      }
    }
  }

  async function syncLatestAssetDrivenExecution(options: { silent?: boolean; isCancelled?: () => boolean } = {}) {
    const packageName = assetPatrolPackageName.trim();
    if (!selectedSerial || !packageName) {
      return;
    }
    try {
      const query = new URLSearchParams({
        deviceSerial: selectedSerial,
        packageName
      });
      const response = await fetch(`/api/asset-patrols/executions?${query.toString()}`);
      if (options.isCancelled?.()) {
        return;
      }
      const json = (await response.json().catch(() => ({}))) as { execution?: AssetDrivenExecutionSession; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "同步资产测试状态失败");
      }
      if (options.isCancelled?.() || !json.execution) {
        return;
      }
      setAssetDrivenExecutionId(json.execution.id);
      setAssetDrivenExecution(json.execution);
      if (json.execution.runningItem?.runId) {
        setAssetDrivenPanelRunId(json.execution.runningItem.runId);
      }
      if (!options.silent) {
        setMessage(`已同步资产测试批次：${json.execution.id}`);
      }
    } catch (error) {
      if (!options.silent) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function startAssetDrivenTest() {
    if (!selectedSerial) {
      setMessage("请先选择设备");
      return;
    }
    if (!assetPatrolPackageName.trim()) {
      setMessage("请先填写目标包名");
      return;
    }
    if (selectedDeviceBusy) {
      setMessage(`当前设备正在执行：${activeRunForSelectedDevice?.id ?? ""}`);
      return;
    }
    if (assetDrivenExecution?.status === "running") {
      setMessage(`本轮资产测试正在执行：${assetDrivenExecution.id}`);
      return;
    }
    if (!assetPatrolAllowBusinessSubmit && assetPatrolPlanRequiresBusinessSubmit(assetPatrolPlan)) {
      setMessage("当前资产测试会执行页面任务，请先勾选“允许业务提交”后再开始资产测试。");
      return;
    }
    try {
      setBusy(true);
      saveStabilityDangerousTextForPackage(assetPatrolPackageName, assetPatrolDangerousText);
      const response = await fetch("/api/asset-patrols/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetPatrolRequestPayload())
      });
      const json = (await response.json().catch(() => ({}))) as {
        run?: TestRun;
        plan?: AssetPatrolPlan;
        error?: string;
        activeRunId?: string;
        assetDrivenExecution?: AssetDrivenExecutionSession;
        assetDrivenQueue?: { id?: string; total?: number; remaining?: number };
      };
      if (!response.ok || !json.run) {
        if (json.plan) {
          setAssetPatrolPlan(json.plan);
        }
        throw new Error(json.error ?? (json.activeRunId ? `设备正在执行：${json.activeRunId}` : "启动资产测试失败"));
      }
      setAssetDrivenPanelRunId(json.run.id);
      setAssetDrivenExecutionId(json.assetDrivenExecution?.id ?? json.assetDrivenQueue?.id ?? "");
      setAssetDrivenExecution(json.assetDrivenExecution);
      setAssetPatrolPlan(undefined);
      await refreshRuns();
      setMessage(assetDrivenTestStartMessage(json.run, json.assetDrivenQueue));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopAssetPatrol(targetId: string) {
    try {
      setBusy(true);
      const shouldStopExecution = targetId === assetDrivenExecution?.id || targetId === assetDrivenExecutionId;
      const response = await fetch(
        shouldStopExecution
          ? `/api/asset-patrols/executions/${encodeURIComponent(targetId)}/stop`
          : `/api/runs/${encodeURIComponent(targetId)}/stop`,
        { method: "POST" }
      );
      const json = (await response.json().catch(() => ({}))) as { run?: TestRun; execution?: AssetDrivenExecutionSession; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "停止资产驱动巡检失败");
      }
      if (shouldStopExecution) {
        if (json.execution) {
          setAssetDrivenExecution(json.execution);
          setAssetDrivenExecutionId(json.execution.id);
          const currentExecutionRunId = json.execution.runningItem?.runId ?? assetDrivenPanelRunId;
          if (currentExecutionRunId) {
            setCurrentRunId(currentExecutionRunId);
          }
        }
        await refreshRuns();
        setMessage(`已停止本轮资产测试：${targetId}`);
        return;
      }
      setCurrentRunId(targetId);
      await refreshRuns();
      setMessage(`已停止资产驱动巡检：${targetId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
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
            dangerousTextPatternsText: stabilityDangerousText
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

  const workspaceStyle: RecordingWorkspaceStyle = workspaceStyleForNav(activeNavItem, 0, assetRecordingPreviewWidth);
  const stabilityPackageOptions = knownStabilityPackages(cases, structuredFlows, runs);
  const assetPatrolPackageOptions = stabilityPackageOptions;
  const currentStabilityRun =
    (currentRun?.config.runKind === "stability_exploration" ? currentRun : undefined) ??
    runs.find((run) => run.config.runKind === "stability_exploration" && run.deviceSerial === selectedSerial && isActiveRunStatus(run)) ??
    runs.find((run) => run.config.runKind === "stability_exploration" && run.deviceSerial === selectedSerial);
  const stabilitySummary = stabilityRunProgressSummary(currentStabilityRun);
  const trackedAssetDrivenRun =
    (assetDrivenPanelRunId && currentRun?.id === assetDrivenPanelRunId ? currentRun : undefined) ??
    (assetDrivenPanelRunId ? runs.find((run) => run.id === assetDrivenPanelRunId) : undefined);
  const activeAssetDrivenGraphRun = assetDrivenPanelRunId
    ? runs.find((run) => run.config.runKind === "business_graph" && run.deviceSerial === selectedSerial && isActiveRunStatus(run))
    : undefined;
  const currentAssetPatrolRun =
    trackedAssetDrivenRun ??
    activeAssetDrivenGraphRun ??
    (currentRun?.config.runKind === "asset_patrol" ? currentRun : undefined) ??
    runs.find((run) => run.config.runKind === "asset_patrol" && run.deviceSerial === selectedSerial && isActiveRunStatus(run)) ??
    runs.find((run) => run.config.runKind === "asset_patrol" && run.deviceSerial === selectedSerial);
  const assetPatrolSummary = assetDrivenExecutionProgressSummary(assetDrivenExecution) ?? assetDrivenRunProgressSummary(currentAssetPatrolRun, assetPatrolPackageName);

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
          openAssetRecording={openAssetRecording}
          openPageAssets={openPageAssets}
          openAssetComposition={openAssetComposition}
          openFreeComposition={openFreeComposition}
          openParameterCenter={openParameterCenter}
          openAssetPatrol={openAssetPatrol}
          openStability={openStability}
          openRuns={openRuns}
          openSettings={openSettings}
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

        {activeNavItem === "recording" && (
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

        {activeNavItem === "assetComposition" && (
          <AssetCompositionPanel
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            defaultAppId={DEFAULT_ASSET_PATROL_PACKAGE_NAME}
            setMessage={setMessage}
          />
        )}

        {activeNavItem === "freeComposition" && (
          <FreeCompositionPanel
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            defaultAppId={DEFAULT_ASSET_PATROL_PACKAGE_NAME}
            setMessage={setMessage}
          />
        )}

        {activeNavItem === "parameterCenter" && (
          <AssetCompositionPanel
            mode="parameters"
            selectedSerial={selectedSerial}
            selectedDeviceBusy={selectedDeviceBusy}
            defaultAppId={DEFAULT_ASSET_PATROL_PACKAGE_NAME}
            setMessage={setMessage}
          />
        )}

        {activeNavItem === "assetPatrol" && (
          <AssetPatrolPanel
            devices={selectableDevices}
            selectedSerial={selectedSerial}
            selectedDevice={selectedDevice}
            selectedDeviceBusy={selectedDeviceBusy}
            packageName={assetPatrolPackageName}
            packageOptions={assetPatrolPackageOptions}
            startMode={assetPatrolStartMode}
            pageScope={assetPatrolPageScope}
            maxDurationMinutes={assetPatrolMaxDurationMinutes}
            maxTransitions={assetPatrolMaxTransitions}
            allowRiskyActions={assetPatrolAllowRiskyActions}
            allowBusinessSubmit={assetPatrolAllowBusinessSubmit}
            dangerousTextPatternsText={assetPatrolDangerousText}
            parameterProfiles={assetPatrolParameterProfiles}
            parameterProfileId={assetPatrolParameterProfileId}
            plan={assetPatrolPlan}
            assetDrivenExecution={assetDrivenExecution}
            currentRun={currentAssetPatrolRun}
            summary={assetPatrolSummary}
            busy={busy}
            onSelectDevice={(serial) => {
              const device = selectableDevices.find((item) => item.serial === serial);
              if (device) {
                selectDeviceAndCloseStream(device);
              }
            }}
            onPackageNameChange={updateAssetPatrolPackageName}
            onStartModeChange={setAssetPatrolStartMode}
            onPageScopeChange={setAssetPatrolPageScope}
            onMaxDurationMinutesChange={setAssetPatrolMaxDurationMinutes}
            onMaxTransitionsChange={setAssetPatrolMaxTransitions}
            onAllowRiskyActionsChange={setAssetPatrolAllowRiskyActions}
            onAllowBusinessSubmitChange={setAssetPatrolAllowBusinessSubmit}
            onDangerousTextPatternsChange={(value) => {
              setAssetPatrolDangerousText(value);
              saveStabilityDangerousTextForPackage(assetPatrolPackageName, value);
            }}
            onParameterProfileIdChange={setAssetPatrolParameterProfileId}
            onExecute={() => void startAssetDrivenTest()}
            onStop={(runId) => void stopAssetPatrol(runId)}
            onOpenRun={(runId) => {
              setCurrentRunId(runId);
              openRuns({ keepCurrentRun: true });
            }}
          />
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
            busy={busy}
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

        {activeNavItem === "runs" && <section className="module-page execution-module">{stepsPanel}</section>}

        {activeNavItem === "settings" && (
          <SettingsView
            aiSettings={aiDiagnosisSettings}
            aiDraft={aiDiagnosisDraft}
            busy={busy}
            onAiDraftChange={(patch) => setAiDiagnosisDraft((draft) => ({ ...draft, ...patch }))}
            onSaveAiSettings={() => void saveAiDiagnosisSettings()}
          />
        )}

      </section>
    </main>
  );
}

type SettingsViewProps = {
  aiSettings: PublicAiDiagnosisSettings;
  aiDraft: AiDiagnosisSettingsDraft;
  busy: boolean;
  onAiDraftChange: (patch: Partial<AiDiagnosisSettingsDraft>) => void;
  onSaveAiSettings: () => void;
};

function SettingsView({
  aiSettings,
  aiDraft,
  busy,
  onAiDraftChange,
  onSaveAiSettings
}: SettingsViewProps) {
  return (
    <section className="module-page settings-module">
      <AiDiagnosisSettingsPanel
        settings={aiSettings}
        draft={aiDraft}
        busy={busy}
        onDraftChange={onAiDraftChange}
        onSave={onSaveAiSettings}
      />
    </section>
  );
}

type AiDiagnosisSettingsPanelProps = {
  settings: PublicAiDiagnosisSettings;
  draft: AiDiagnosisSettingsDraft;
  busy: boolean;
  onDraftChange: (patch: Partial<AiDiagnosisSettingsDraft>) => void;
  onSave: () => void;
};

export function AiDiagnosisSettingsPanel({
  settings,
  draft,
  busy,
  onDraftChange,
  onSave
}: AiDiagnosisSettingsPanelProps) {
  const keyStatus = settings.baseURL.trim().toLowerCase().startsWith("codex://app-server")
    ? "Codex 本地入口，无需密钥"
    : settings.apiKeyConfigured
      ? "已保存密钥，留空保持不变"
      : "未保存密钥";
  return (
    <div className="panel settings-content-panel">
      <div className="panel-head">
        <div>
          <h2>AI 诊断</h2>
          <span className="settings-status-line">
            {settings.enabled ? "已启用" : "未启用"} · {keyStatus} · {settingsSourceLabel(settings.source)}
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
          启用失败后 AI 诊断
        </label>
        <label>
          接口地址
          <input value={draft.baseURL} onChange={(event) => onDraftChange({ baseURL: event.target.value })} placeholder="codex://app-server 或 https://api.example.com/v1" />
        </label>
        <label>
          模型名
          <input value={draft.model} onChange={(event) => onDraftChange({ model: event.target.value })} placeholder="gpt-5.4" />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={draft.apiKey}
            onChange={(event) => onDraftChange({ apiKey: event.target.value })}
            placeholder={settings.apiKeyConfigured ? "已配置，留空保持不变" : "HTTP 接口需要填写；Codex 可留空"}
          />
        </label>
        <label>
          超时 ms
          <input
            min={1000}
            max={120000}
            type="number"
            value={draft.timeoutMs}
            onChange={(event) => onDraftChange({ timeoutMs: clampNumberInput(event.target.value, 1000, 120000, DEFAULT_AI_DIAGNOSIS_SETTINGS.timeoutMs) })}
          />
        </label>
      </div>
    </div>
  );
}

function settingsSourceLabel(source: AiDiagnosisSettingsSource): string {
  if (source === "stored") {
    return "设置页";
  }
  if (source === "environment") {
    return "环境变量";
  }
  return "未配置";
}

type AssetPatrolPanelProps = {
  devices: DeviceInfo[];
  selectedSerial: string;
  selectedDevice?: DeviceInfo;
  selectedDeviceBusy: boolean;
  packageName: string;
  packageOptions: string[];
  startMode: AssetPatrolStartMode;
  pageScope: AssetPatrolPageScope;
  maxDurationMinutes: number;
  maxTransitions: number;
  allowRiskyActions: boolean;
  allowBusinessSubmit: boolean;
  dangerousTextPatternsText: string;
  parameterProfiles?: ParameterProfile[];
  parameterProfileId?: string;
  /** @deprecated Test-only compatibility for callers not yet migrated to parameter profiles. */
  runtimeParamsText?: string;
  /** @deprecated Test-only compatibility for callers not yet migrated to parameter profiles. */
  runtimeParamDefinitions?: AssetRuntimeParamDefinition[];
  plan?: AssetPatrolPlan;
  assetDrivenExecution?: AssetDrivenExecutionSession;
  currentRun?: TestRun;
  summary?: ReturnType<typeof assetDrivenExecutionProgressSummary> | ReturnType<typeof assetDrivenRunProgressSummary>;
  busy: boolean;
  onSelectDevice: (serial: string) => void;
  onPackageNameChange: (value: string) => void;
  onStartModeChange: (value: AssetPatrolStartMode) => void;
  onPageScopeChange: (value: AssetPatrolPageScope) => void;
  onMaxDurationMinutesChange: (value: number) => void;
  onMaxTransitionsChange: (value: number) => void;
  onAllowRiskyActionsChange: (value: boolean) => void;
  onAllowBusinessSubmitChange: (value: boolean) => void;
  onDangerousTextPatternsChange: (value: string) => void;
  onParameterProfileIdChange?: (value: string) => void;
  /** @deprecated Test-only compatibility for callers not yet migrated to parameter profiles. */
  onRuntimeParamsChange?: (value: string) => void;
  /** @deprecated Test-only compatibility for callers not yet migrated to parameter profiles. */
  onSyncRuntimeParams?: () => void;
  onExecute: () => void;
  onStop: (runId: string) => void;
  onOpenRun: (runId: string) => void;
};

export function AssetPatrolPanel({
  devices,
  selectedSerial,
  selectedDevice,
  selectedDeviceBusy,
  packageName,
  packageOptions,
  startMode,
  pageScope,
  maxDurationMinutes,
  maxTransitions,
  allowRiskyActions,
  allowBusinessSubmit,
  dangerousTextPatternsText,
  parameterProfiles = [],
  parameterProfileId = "",
  plan,
  assetDrivenExecution,
  currentRun,
  summary,
  busy,
  onSelectDevice,
  onPackageNameChange,
  onStartModeChange,
  onPageScopeChange,
  onMaxDurationMinutesChange,
  onMaxTransitionsChange,
  onAllowRiskyActionsChange,
  onAllowBusinessSubmitChange,
  onDangerousTextPatternsChange,
  onParameterProfileIdChange = () => undefined,
  onExecute,
  onStop,
  onOpenRun
}: AssetPatrolPanelProps) {
  const running = Boolean(assetDrivenExecution?.status === "running" || (currentRun && isActiveRunStatus(currentRun)));
  const stopTargetId = assetDrivenExecution?.status === "running" ? assetDrivenExecution.id : currentRun && isActiveRunStatus(currentRun) ? currentRun.id : "";
  const canUseDevice = canStartAssetDrivenTest({
    selectedSerial,
    packageName,
    selectedDeviceBusy,
    busy,
    running
  });
  const displayMode = assetPatrolPanelDisplayMode({ plan, currentRun, assetDrivenExecution });
  const selectedParameterProfile = parameterProfiles.find((profile) => profile.id === parameterProfileId);
  const assetDrivenTestNeedsBusinessSubmit = !allowBusinessSubmit && assetPatrolPlanRequiresBusinessSubmit(plan);
  const panelSummary = summary ?? assetDrivenExecutionProgressSummary(assetDrivenExecution) ?? assetDrivenRunProgressSummary(currentRun, packageName);
  const planGroups = assetPatrolPlanGroups(plan);

  return (
    <section className="module-page stability-module">
      <div className="panel module-head-panel">
        <div>
          <span className="module-eyebrow">资产驱动巡检</span>
          <h2>按 PageStateFlow 资产测试当前页面</h2>
        </div>
        <div className="module-stat-grid">
          <div>
            <strong>{assetDrivenExecution ? `${assetDrivenExecution.totalEdges}` : plan ? `${plan.steps.length}` : "0"}</strong>
            <span>计划检查</span>
          </div>
          <div>
            <strong>{assetDrivenExecution?.needsRepair ?? plan?.summary.needsRepair ?? panelSummary?.needsRepair ?? 0}</strong>
            <span>建议修复</span>
          </div>
          <div>
            <strong>{assetDrivenExecution?.status ?? currentRun?.status ?? "idle"}</strong>
            <span>运行状态</span>
          </div>
        </div>
      </div>

      <div className="stability-layout">
        <div className="panel stability-config-panel">
          <div className="panel-head">
            <h2>测试配置</h2>
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
              <input list="asset-patrol-package-options" value={packageName} onChange={(event) => onPackageNameChange(event.target.value)} placeholder="cn.eeo.classin" />
              <datalist id="asset-patrol-package-options">
                {packageOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </label>
            <label>
              起始方式
              <select value={startMode} onChange={(event) => onStartModeChange(event.target.value as AssetPatrolStartMode)}>
                <option value="current_state">当前页开始</option>
                <option value="launch_app">启动 App</option>
                <option value="restart_app">重启 App</option>
              </select>
            </label>
            <label>
              巡检范围
              <select value={pageScope} onChange={(event) => onPageScopeChange(event.target.value as AssetPatrolPageScope)}>
                {assetPatrolPageScopeOptions().map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              最大时长
              <input min={1} max={30} type="number" value={maxDurationMinutes} onChange={(event) => onMaxDurationMinutesChange(clampNumberInput(event.target.value, 1, 30, 2))} />
            </label>
            <label>
              最大边数
              <input min={0} max={200} type="number" value={maxTransitions} onChange={(event) => onMaxTransitionsChange(clampNumberInput(event.target.value, 0, 200, 8))} />
            </label>
          </div>

          <div className="stability-checkbox-grid">
            <label>
              <input type="checkbox" checked={allowRiskyActions} onChange={(event) => onAllowRiskyActionsChange(event.target.checked)} />
              允许危险动作
            </label>
            <label>
              <input type="checkbox" checked={allowBusinessSubmit} onChange={(event) => onAllowBusinessSubmitChange(event.target.checked)} />
              允许业务提交
            </label>
          </div>

          <label className="stability-danger-list">
            危险词
            <textarea value={dangerousTextPatternsText} onChange={(event) => onDangerousTextPatternsChange(event.target.value)} rows={5} />
          </label>

          <div className="stability-danger-list">
            <div className="runtime-param-header">
              <span>执行组合</span>
            </div>
            <label className="parameter-profile-picker">
              <select value={parameterProfileId} onChange={(event) => onParameterProfileIdChange(event.target.value)}>
                <option value="">不使用执行组合</option>
                {parameterProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}{profile.environment ? ` · ${profile.environment}` : ""} · v{profile.version}
                  </option>
                ))}
              </select>
            </label>
            <span className="runtime-param-hint">
              {selectedParameterProfile
                ? `本次执行使用「${selectedParameterProfile.name}」的冻结快照（已绑定 ${selectedParameterProfile.bindings?.length ?? 0} 个业务领域${Object.keys(selectedParameterProfile.values).length ? `，含 ${Object.keys(selectedParameterProfile.values).length} 项高级覆盖` : ""}）。在“参数中心 > 执行组合”中统一维护。`
                : "请在“参数中心 > 执行组合”维护并选择一套运行数据；缺少动态参数的能力会被跳过或进入诊断。"}
            </span>
          </div>

          <div className="action-row">
            <button className="icon-button primary" type="button" disabled={!canUseDevice} onClick={onExecute}>
              <PlayCircle size={16} />
              {ASSET_DRIVEN_TEST_ACTION_LABEL}
            </button>
            {running && stopTargetId ? (
              <button className="icon-button danger" type="button" disabled={busy} onClick={() => onStop(stopTargetId)}>
                <Square size={16} />
                停止
              </button>
            ) : null}
          </div>
          {assetDrivenTestNeedsBusinessSubmit ? (
            <div className="runtime-param-hint">当前计划包含页面任务；真实执行前需要勾选“允许业务提交”。</div>
          ) : null}
        </div>

        <div className="panel stability-status-panel">
          <div className="panel-head">
            <h2>{displayMode === "run" ? "执行结果" : "测试计划"}</h2>
            {displayMode === "run" && assetDrivenExecution ? (
              <span className={`run-status-mini ${assetDrivenExecution.status}`}>{assetDrivenExecution.status}</span>
            ) : displayMode === "run" && currentRun ? (
              <span className={`run-status-mini ${currentRun.status}`}>{currentRun.status}</span>
            ) : plan ? (
              <span className={`run-status-mini ${plan.status === "ready" ? "passed" : "failed"}`}>{plan.status}</span>
            ) : null}
          </div>
          {displayMode === "run" && assetDrivenExecution ? (
            <>
              <div className="stability-run-card">
                <strong>资产测试批次</strong>
                <span>{assetDrivenExecution.id}</span>
              </div>
              <div className="stability-facts">
                <div><span>当前页</span><strong>{assetDrivenExecution.startNodeName}</strong></div>
                <div><span>总边数</span><strong>{assetDrivenExecution.totalEdges}</strong></div>
                <div><span>已完成</span><strong>{assetDrivenExecution.completedEdges}/{assetDrivenExecution.totalEdges}</strong></div>
                <div><span>当前执行</span><strong>{assetDrivenExecution.runningItem?.label ?? "等待下一条边"}</strong></div>
                <div><span>待执行</span><strong>{assetDrivenExecution.pendingEdges}</strong></div>
                <div><span>失败</span><strong>{assetDrivenExecution.failedEdges}</strong></div>
              </div>
              <div className="stability-timeline">
                {assetDrivenExecution.items.map((item) => (
                  <div key={item.id} className={`stability-step ${assetDrivenExecutionItemClassName(item.status)}`}>
                    <strong>{item.order}. {item.label}</strong>
                    <span>
                      {item.fromPage} -&gt; {item.toPage} · {assetDrivenExecutionItemStatusLabel(item.status)}
                      {item.latestStep ? ` · ${item.latestStep}` : ""}
                      {item.runId ? ` · ${item.runId}` : ""}
                    </span>
                    {item.errorMessage ? <span>{item.errorMessage}</span> : null}
                  </div>
                ))}
              </div>
              <div className="action-row">
                <a className="report-link" href={`/api/asset-patrols/executions/${encodeURIComponent(assetDrivenExecution.id)}/report`} target="_blank" rel="noreferrer">
                  打开批次报告
                </a>
                {assetDrivenExecution.runningItem?.runId ? (
                  <button className="icon-button" type="button" onClick={() => onOpenRun(assetDrivenExecution.runningItem?.runId ?? "")}>
                    查看当前执行
                  </button>
                ) : null}
              </div>
            </>
          ) : displayMode === "plan" && plan ? (
            <>
              <div className="stability-facts">
                <div><span>当前页</span><strong>{plan.startPage?.name ?? "-"}</strong></div>
                <div><span>页面检查</span><strong>{plan.summary.pageChecks}</strong></div>
                <div><span>元素检查</span><strong>{plan.summary.elementChecks}</strong></div>
                <div><span>边检查</span><strong>{plan.summary.transitionChecks}</strong></div>
                <div><span>跳过</span><strong>{plan.summary.skipped}</strong></div>
                <div><span>建议修复</span><strong>{plan.summary.needsRepair}</strong></div>
              </div>
              {plan.issues.length ? (
                <div className="stability-timeline">
                  {plan.issues.map((issue) => (
                    <div key={`${issue.code}-${issue.message}`} className={`stability-step ${issue.severity === "error" ? "failed" : "skipped"}`}>
                      <strong>{issue.code}</strong>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {planGroups.length ? (
                <div className="asset-patrol-plan-groups">
                  {planGroups.map((group) => (
                    <div className="asset-patrol-plan-group" key={group.key}>
                      <div className="asset-patrol-plan-group-title">
                        <strong>{group.title}</strong>
                        <span>{group.items.length}</span>
                      </div>
                      <div className="stability-timeline">
                        {group.items.map((item) => (
                          <div key={item.id} className={`stability-step ${item.status === "ready" ? "passed" : item.status === "skipped" ? "skipped" : "failed"}`}>
                            <strong>{item.label}</strong>
                            <span>{item.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">当前计划没有可执行检查项</div>
              )}
            </>
          ) : displayMode === "run" && currentRun ? (
            <>
              <div className="stability-run-card">
                <strong>{currentRun.caseName}</strong>
                <span>{currentRun.id}</span>
              </div>
              {currentRun.config.runKind === "asset_patrol" ? <div className="stability-diagnostic-note">{ASSET_PATROL_DIAGNOSTIC_MODE_NOTICE}</div> : null}
              <div className="stability-facts">
                <div><span>设备</span><strong>{selectedDevice?.name || selectedSerial || currentRun.deviceSerial}</strong></div>
                <div><span>包名</span><strong>{panelSummary?.packageName ?? packageName}</strong></div>
                <div><span>页面</span><strong>{panelSummary?.pageName ?? currentRun.caseName}</strong></div>
                <div><span>最近执行</span><strong>{panelSummary?.latestCheck ?? "等待执行结果"}</strong></div>
                <div><span>失败</span><strong>{panelSummary?.failed ?? 0}</strong></div>
                <div><span>建议修复</span><strong>{panelSummary?.needsRepair ?? 0}</strong></div>
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
            <div className="empty">选择设备和目标包后开始资产测试</div>
          )}
        </div>
      </div>
    </section>
  );
}

function assetDrivenExecutionItemClassName(status: AssetDrivenExecutionItem["status"]): string {
  if (status === "passed") {
    return "passed";
  }
  if (status === "failed" || status === "stopped") {
    return "failed";
  }
  if (status === "skipped") {
    return "skipped";
  }
  return "running";
}

function assetDrivenExecutionItemStatusLabel(status: AssetDrivenExecutionItem["status"]): string {
  if (status === "pending") {
    return "待执行";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "passed") {
    return "成功";
  }
  if (status === "skipped") {
    return "跳过";
  }
  if (status === "stopped") {
    return "已停止";
  }
  return "失败";
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
  busy: boolean;
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

function StabilityExplorerPanel({
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
  busy,
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
  const selectableDeviceCount = devices.filter(isControllableDevice).length;
  const onlineCount = devices.filter((device) => device.status === "online").length;
  const unavailableCount = devices.length - selectableDeviceCount;
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

function knownStabilityPackages(cases: TestCase[], flows: StructuredFlow[], runs: TestRun[]): string[] {
  const packages = new Set<string>();
  for (const testCase of cases) {
    if (testCase.targetApp?.androidPackageName) {
      packages.add(testCase.targetApp.androidPackageName);
    }
  }
  for (const flow of flows) {
    if (flow.targetApp.androidPackageName) {
      packages.add(flow.targetApp.androidPackageName);
    }
  }
  for (const run of runs) {
    if (run.config.startAppPackageName) {
      packages.add(run.config.startAppPackageName);
    }
    if (run.config.stabilityExploration?.packageName) {
      packages.add(run.config.stabilityExploration.packageName);
    }
    if (run.config.assetPatrol?.packageName) {
      packages.add(run.config.assetPatrol.packageName);
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

function isAssetPatrolStepMetadata(value: unknown): value is {
  kind?: string;
  label?: string;
  status?: string;
  skipReason?: string;
  pageModelName?: string;
  startPage?: { name?: string };
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
      elements: summarizeObservationElements(result.observation),
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
  const elements = value
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
      const quality = pageElementQualityMetadata(element.quality);
      const visualLocator = visualLocatorMetadata(element.visualLocator);
      const locatorKind = locatorKindMetadata(element.locatorKind);
      const dynamicMasks = dynamicMasksMetadata(element.dynamicMasks);
      const structuralLocator = recordMetadata(element.structuralLocator);
      const dynamicRegionId = stringMetadata(element, "dynamicRegionId");
      const itemTemplateId = stringMetadata(element, "itemTemplateId");
      const transitionKind = transitionKindMetadata(element.transitionKind);
      const parameterMapping = stringRecordMetadata(element.parameterMapping);
      return {
        ...(id ? { id } : {}),
        label,
        locator,
        ...(locatorKind ? { locatorKind } : {}),
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
        ...(quality ? { quality } : {}),
        ...(visualLocator ? { visualLocator } : {}),
        ...(dynamicMasks?.length ? { dynamicMasks } : {}),
        ...(structuralLocator ? { structuralLocator } : {}),
        ...(dynamicRegionId ? { dynamicRegionId } : {}),
        ...(itemTemplateId ? { itemTemplateId } : {}),
        ...(transitionKind ? { transitionKind } : {}),
        ...(parameterMapping ? { parameterMapping } : {}),
        ...(compoundSteps.length ? { compoundSteps } : {}),
        ...(scrollProfile ? { scrollProfile } : {})
      };
    })
    .filter((item): item is PageElement => Boolean(item));
  return dedupeManualOperationElements(elements);
}

function mergeOperationElements(
  manualElements: NonNullable<AssetRecordingCurrentPage["elements"]>,
  candidateElements: NonNullable<AssetRecordingCurrentPage["elements"]>
): NonNullable<AssetRecordingCurrentPage["elements"]> {
  const manualKeys = new Set(manualElements.map((element) => `${element.actionKind ?? element.action}:${element.locator}`));
  const manualIds = new Set(manualElements.map((element) => element.id).filter(Boolean));
  return dedupeManualOperationElements([
    ...manualElements,
    ...candidateElements.filter((element) => !manualKeys.has(`${element.actionKind ?? element.action}:${element.locator}`) && (!element.id || !manualIds.has(element.id)))
  ]);
}

function dedupeManualOperationElements(
  elements: NonNullable<AssetRecordingCurrentPage["elements"]>
): NonNullable<AssetRecordingCurrentPage["elements"]> {
  const result: NonNullable<AssetRecordingCurrentPage["elements"]> = [];
  for (const element of elements) {
    const duplicateIndex = result.findIndex((existing) => manualOperationElementsRepresentSameTarget(existing, element));
    if (duplicateIndex < 0) {
      result.push(element);
      continue;
    }
    const existing = result[duplicateIndex]!;
    if (manualOperationElementPriority(element) >= manualOperationElementPriority(existing)) {
      result[duplicateIndex] = element;
    }
  }
  return result;
}

function manualOperationElementsRepresentSameTarget(
  left: NonNullable<AssetRecordingCurrentPage["elements"]>[number],
  right: NonNullable<AssetRecordingCurrentPage["elements"]>[number]
): boolean {
  if (left.source !== "manual" || right.source !== "manual") {
    return false;
  }
  if (!left.label || !right.label || left.label !== right.label) {
    return false;
  }
  if ((left.actionKind ?? left.action) !== (right.actionKind ?? right.action)) {
    return false;
  }
  const leftCompound = left.compoundSteps?.length ? JSON.stringify(left.compoundSteps) : "";
  const rightCompound = right.compoundSteps?.length ? JSON.stringify(right.compoundSteps) : "";
  if (leftCompound !== rightCompound) {
    return false;
  }
  if (left.locator === right.locator) {
    return true;
  }
  return Boolean(left.region && right.region && rectsRepresentSameMarkedTarget(left.region, right.region));
}

function rectsRepresentSameMarkedTarget(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const minArea = Math.max(1, Math.min(left.width * left.height, right.width * right.height));
  return overlapArea / minArea >= 0.45 || rectCenterInside(left, right) || rectCenterInside(right, left);
}

function rectCenterInside(
  rect: { x: number; y: number; width: number; height: number },
  container: { x: number; y: number; width: number; height: number }
): boolean {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return centerX >= container.x && centerX <= container.x + container.width && centerY >= container.y && centerY <= container.y + container.height;
}

function manualOperationElementPriority(element: NonNullable<AssetRecordingCurrentPage["elements"]>[number]): number {
  let score = 0;
  if (element.visualLocator) {
    score += 8;
  }
  if (element.quality) {
    score += 4;
  }
  if (element.tapPointPercent) {
    score += 2;
  }
  if (element.region) {
    score += 1;
  }
  return score;
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
  const quality = pageElementQualityMetadata(persistedElement?.quality) ?? draft.quality;
  const visualLocator = visualLocatorMetadata(persistedElement?.visualLocator) ?? draft.visualLocator;
  const locatorKind = locatorKindMetadata(persistedElement?.locatorKind) ?? draft.locatorKind;
  const dynamicMasks = dynamicMasksMetadata(persistedElement?.dynamicMasks) ?? draft.dynamicMasks;
  const structuralLocator = recordMetadata(persistedElement?.structuralLocator) ?? draft.structuralLocator;
  const dynamicRegionId = stringMetadata(persistedElement, "dynamicRegionId") ?? stringMetadata(recordMetadata(draft.dynamicRegion), "id");
  const itemTemplateId = stringMetadata(persistedElement, "itemTemplateId") ?? stringMetadata(recordMetadata(draft.itemTemplate), "id");
  const transitionKind = transitionKindMetadata(persistedElement?.transitionKind) ?? draft.transitionKind;
  const parameterMapping = stringRecordMetadata(persistedElement?.parameterMapping) ?? draft.parameterMapping;
  return {
    ...(id ?? draft.elementId ? { id: id ?? draft.elementId } : {}),
    label: draft.elementLabel,
    locator: draft.locator,
    ...(locatorKind ? { locatorKind } : {}),
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
    ...(quality ? { quality } : {}),
    ...(visualLocator ? { visualLocator } : {}),
    ...(dynamicMasks?.length ? { dynamicMasks } : {}),
    ...(structuralLocator ? { structuralLocator } : {}),
    ...(dynamicRegionId ? { dynamicRegionId } : {}),
    ...(itemTemplateId ? { itemTemplateId } : {}),
    ...(transitionKind ? { transitionKind } : {}),
    ...(parameterMapping ? { parameterMapping } : {}),
    ...(draft.compoundSteps?.length ? { compoundSteps: draft.compoundSteps } : {}),
    ...(draft.scrollProfile ? { scrollProfile: draft.scrollProfile } : {})
  };
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

function isRegionTooSmallForPageElement(region: { width: number; height: number }): boolean {
  return region.width < 2 || region.height < 1.5 || region.width * region.height < 8;
}

function pageElementQualityMetadata(value: unknown): NonNullable<NonNullable<AssetRecordingCurrentPage["elements"]>[number]["quality"]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const status = input.status === "pass" || input.status === "needs_review" || input.status === "fail" ? input.status : undefined;
  const score = numberMetadata(input.score);
  if (!status || score === undefined) {
    return undefined;
  }
  return {
    status,
    score,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((item): item is any => Boolean(item) && typeof item === "object") : [],
    candidates: Array.isArray(input.candidates) ? input.candidates.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [],
    evidence: input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence) ? input.evidence as Record<string, unknown> : {}
  };
}

function recordMetadata(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function visualLocatorMetadata(value: unknown): Record<string, unknown> | undefined {
  return recordMetadata(value);
}

function locatorKindMetadata(value: unknown): AssetRecordingLocatorKind | undefined {
  return value === "text_locator" ||
    value === "visual_locator" ||
    value === "structural_locator" ||
    value === "collection_item_locator" ||
    value === "top_bar_icon_locator" ||
    value === "ocr_anchor_offset"
    ? value
    : undefined;
}

function transitionKindMetadata(value: unknown): "static" | "parameterized" | undefined {
  return value === "static" || value === "parameterized" ? value : undefined;
}

function dynamicMasksMetadata(value: unknown): AssetRecordingDynamicMask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const masks = value
    .map((item): AssetRecordingDynamicMask | undefined => {
      const input = recordMetadata(item);
      const kind = dynamicMaskKindMetadata(input?.kind);
      const region = rectMetadata(input?.region);
      if (!kind || !region) {
        return undefined;
      }
      const label = stringMetadata(input, "label");
      const reason = stringMetadata(input, "reason");
      return {
        kind,
        region,
        ...(label ? { label } : {}),
        ...(reason ? { reason } : {})
      };
    })
    .filter((item): item is AssetRecordingDynamicMask => Boolean(item));
  return masks.length ? masks : undefined;
}

function dynamicMaskKindMetadata(value: unknown): AssetRecordingDynamicMask["kind"] | undefined {
  return value === "avatar" ||
    value === "text" ||
    value === "image" ||
    value === "number" ||
    value === "custom"
    ? value
    : undefined;
}

function stringRecordMetadata(value: unknown): Record<string, string> | undefined {
  const input = recordMetadata(value);
  if (!input) {
    return undefined;
  }
  const entries = Object.entries(input)
    .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : ""] as const)
    .filter(([key, item]) => key.length > 0 && item.length > 0);
  return entries.length ? Object.fromEntries(entries) : undefined;
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

function coordinateSpaceMetadata(value: unknown): "screen" | "app_viewport" | "region" | "runtime" | undefined {
  return value === "screen" || value === "app_viewport" || value === "region" || value === "runtime" ? value : undefined;
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
  if (result.status === "blocked") {
    return result.message ?? result.blocker?.message ?? result.matcherDiagnostics?.pollution?.message ?? "当前页面识别被阻断";
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
