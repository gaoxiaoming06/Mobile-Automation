export type Platform = "android" | "ios";

export * from "./public-execution-failure.js";

export type DeviceStatus = "online" | "offline" | "locked" | "running" | "error";

export type DeviceCapabilities = {
  preview: boolean;
  tap: boolean;
  longPress: boolean;
  swipe: boolean;
  back: boolean;
  home: boolean;
  recentApps: boolean;
  textInput: boolean;
  screenshot: boolean;
  launchApp: boolean;
  closeApp: boolean;
  recordVideo: boolean;
  metrics: {
    cpu: boolean;
    memory: boolean;
    fps: boolean;
    network: boolean;
    battery: boolean;
    temperature: boolean;
  };
  events: {
    crash: boolean;
    anr: boolean;
    logs: boolean;
  };
};

export type DeviceInfo = {
  id: string;
  serial: string;
  platform: Platform;
  name?: string;
  model?: string;
  manufacturer?: string;
  osVersion?: string;
  resolution?: {
    width: number;
    height: number;
  };
  orientation?: "portrait" | "landscape";
  status: DeviceStatus;
  capabilities: DeviceCapabilities;
  lastSeenAt: string;
};

export type ActionType =
  | "tap"
  | "long_press"
  | "swipe"
  | "back"
  | "home"
  | "recent_apps"
  | "input_text"
  | "input_keyevents"
  | "clear_text"
  | "wait"
  | "screenshot"
  | "launch_app"
  | "close_app"
  | "tap_if_text"
  | "tap_on_text"
  | "tap_on_element"
  | "tap_on_image"
  | "input_text_to_element"
  | "scroll_until_visible"
  | "reach_page"
  | "wait_until_state";

export type StepExpectationType =
  | "text"
  | "image"
  | "app_alive"
  | "no_crash"
  | "screen_changed"
  | "metric_below"
  | "log_not_contains"
  | "state_is"
  | "performance_not_regressed";

export type StepExpectation = {
  id: string;
  type: StepExpectationType;
  enabled: boolean;
  title?: string;
  note?: string;
  params: Record<string, unknown>;
  createdAt: string;
};

export type StepExpectationResultStatus = "passed" | "failed" | "unsupported" | "pending_review";

export type StepExpectationResult = {
  id: string;
  expectationId: string;
  type: StepExpectationType;
  status: StepExpectationResultStatus;
  blocking?: boolean;
  expected: string;
  actual: string;
  reason?: string;
  evidenceArtifactIds: string[];
  checkedAt: string;
};

export function isSystemGuardExpectationType(type: StepExpectationType): boolean {
  return type === "no_crash" || type === "app_alive";
}

export function shouldDisplayExpectationResult(result: StepExpectationResult): boolean {
  return !isSystemGuardExpectationType(result.type) || result.status !== "passed";
}

export type ActionStep = {
  id: string;
  order: number;
  type: ActionType;
  enabled: boolean;
  title?: string;
  note?: string;
  params: Record<string, unknown>;
  timing?: {
    delayBeforeMs?: number;
    timeoutMs?: number;
    recordedAt?: string;
    elapsedFromPreviousMs?: number;
  };
  coordinate?: {
    x?: number;
    y?: number;
    xRatio?: number;
    yRatio?: number;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    startXRatio?: number;
    startYRatio?: number;
    endXRatio?: number;
    endYRatio?: number;
    deviceWidth?: number;
    deviceHeight?: number;
    orientation?: "portrait" | "landscape";
  };
  screenshotArtifactId?: string;
  preconditions?: StepExpectation[];
  expectations?: StepExpectation[];
  createdAt: string;
};

export type RuntimeFlow = {
  id: string;
  name: string;
  description?: string;
  platformScope: Platform | "mobile-both";
  targetApp?: {
    androidPackageName?: string;
    iosBundleId?: string;
  };
  tags: string[];
  version: number;
  steps: ActionStep[];
  createdAt: string;
  updatedAt: string;
};

export type RunMode = "once" | "repeat_n" | "loop_until_stop";

export type FlowStartStrategy = "keep_current" | "go_home" | "launch_app" | "restart_app" | "clear_data_and_launch";

export type FlowStartSetupScope = "before_run" | "before_each_iteration";


export type InstalledAppInfo = {
  packageName?: string;
  bundleId?: string;
  displayVersion: string;
  buildNumber?: string;
  versionCode?: string;
  firstInstallTime?: string;
  lastUpdateTime?: string;
};


export type ScriptFlowPlatform = "android" | "ios" | "harmony" | "flutter";

export type ScriptFlowStatus = "draft" | "active" | "archived";

export type ScriptFlowVerificationStatus = "verified" | "needs_trial" | "blocked";

export type ScriptFlowVerificationAssessment = {
  status: ScriptFlowVerificationStatus;
  sourceHash: string;
  reasons: string[];
  unresolvedStepIds: string[];
  unresolvedOutcome: boolean;
};

export type ScriptFlowExecutionPurpose = "trial" | "normal";

export type FlowVerificationStatus = "provisional" | "verified" | "invalidated";

export type FlowVerification = {
  id: string;
  flowId?: string;
  flowVersion?: number;
  sourceHash: string;
  appId: string;
  platform: ScriptFlowPlatform;
  appVersion?: string;
  runId: string;
  status: FlowVerificationStatus;
  coverage: {
    totalSteps: number;
    verifiedSteps: number;
    interactionAssetIds: string[];
    pageAssetIds: string[];
    humanConfirmedOutcome: boolean;
  };
  createdAt: string;
};

export type LearningSessionStatus = "analyzing" | "needs_outcome_review" | "ready" | "accepted" | "rejected" | "invalid";
export type LearningOutcomeStatus = "verified" | "human_confirmed" | "rejected" | "unverified";

export type LearningSummary = {
  pageCandidates: number;
  interactionCandidates: number;
  navigationCandidates: number;
  testCandidates: number;
  issues: string[];
};

export type LearningSession = {
  id: string;
  runId: string;
  appId: string;
  platform: ScriptFlowPlatform;
  sourceHash: string;
  executionPassed: boolean;
  outcomeStatus: LearningOutcomeStatus;
  status: LearningSessionStatus;
  summary: LearningSummary;
  createdAt: string;
  updatedAt: string;
};

export type LearningCandidateStatus = "detected" | "validated" | "needs_review" | "accepted" | "rejected" | "superseded";

export type LearningCandidate = {
  id: string;
  sessionId: string;
  kind: "page" | "interaction" | "navigation" | "test";
  stableKey?: string;
  sourceStepId?: string;
  confidence: number;
  status: LearningCandidateStatus;
  payload: Record<string, unknown>;
  evidenceArtifactIds: string[];
  validationIssues: string[];
  createdAt: string;
  updatedAt: string;
};

export type LearningAggregateStatus =
  | "collecting"
  | "awaiting_ai"
  | "ready"
  | "active"
  | "rejected"
  | "analysis_failed"
  | "degraded";

export type LearningAggregate = {
  id: string;
  appId: string;
  platform: ScriptFlowPlatform;
  kind: "page" | "interaction" | "navigation";
  stableKey: string;
  representativeCandidateId: string;
  status: LearningAggregateStatus;
  successfulRunCount: number;
  distinctEvidenceCount: number;
  analysisRequired: boolean;
  analysis?: Record<string, unknown>;
  assetId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type LearningObservation = {
  id: string;
  aggregateId: string;
  sessionId: string;
  candidateId: string;
  runId: string;
  evidenceFingerprint: string;
  evidenceArtifactIds: string[];
  createdAt: string;
};

export type InteractionAsset = {
  id: string;
  key: string;
  appId: string;
  platformScope: ScriptFlowPlatform | "mobile-both";
  owner: { kind: "page" | "component" | "overlay"; key: string };
  name: string;
  aliases: string[];
  supportedActions: Array<"tap" | "inputText" | "clearText" | "selectText">;
  semanticContract: {
    text?: string;
    semantic?: string;
    icon?: string;
    control?: string;
    area?: string;
    position?: string;
    nearText?: string;
  };
  locatorVariants: Array<{
    platform: ScriptFlowPlatform;
    appVersionRange?: string;
    strategy: string;
    descriptor: Record<string, unknown>;
    confidence: number;
  }>;
  status: "draft" | "active" | "degraded" | "deprecated" | "rejected";
  version: number;
  provenance: { runIds: string[]; stepIds: string[]; artifactIds: string[] };
  createdAt: string;
  updatedAt: string;
};

export type NavigationEntry = {
  id: string;
  key: string;
  appId: string;
  platformScope: ScriptFlowPlatform | "mobile-both";
  from: { kind: "page"; key: string } | { kind: "session"; key: "authenticated" | "unauthenticated"; role?: string };
  toPage: string;
  name: string;
  action: {
    kind: "tap";
    target: {
      text?: string;
      semantic?: string;
      icon?: string;
      control?: string;
      area?: string;
      position?: string;
      nearText?: string;
      match?: string;
    };
    search?: {
      mode?: "auto" | "visibleOnly" | "scroll";
      direction?: "up" | "down";
      maxSwipes?: number;
    };
  };
  confidence: number;
  status: "draft" | "active" | "deprecated" | "rejected";
  version: number;
  provenance: { runIds: string[]; stepIds: string[]; artifactIds: string[] };
  createdAt: string;
  updatedAt: string;
};

export type ScriptFlow = {
  id: string;
  appId: string;
  platform: ScriptFlowPlatform;
  name: string;
  description?: string;
  sourceYaml: string;
  parsed: Record<string, unknown>;
  status: ScriptFlowStatus;
  version: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type TemporaryTest = {
  id: string;
  appId: string;
  platform: ScriptFlowPlatform;
  kind: "case" | "scenario";
  purpose: "navigation" | "fixture" | "business" | "recovery";
  testLevel?: "probe" | "component" | "business_smoke" | "full_regression";
  name: string;
  prompt: string;
  sourceYaml: string;
  parsed: Record<string, unknown>;
  parameterValues: Record<string, string | number | boolean>;
  lastRunId: string;
  lastRunStatus?: TestRun["status"];
  runCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ScriptFlowVersion = {
  id: string;
  flowId: string;
  version: number;
  sourceYaml: string;
  parsed: Record<string, unknown>;
  createdAt: string;
};


export type AndroidAppMonitorThreshold = {
  enabled: boolean;
  value: number;
  sustainMs: number;
  cooldownMs: number;
};

export type AndroidAppMonitorConfig = {
  enabled: boolean;
  packageName: string;
  includeSubprocesses?: boolean;
  processFilters?: string[];
  cpuIntervalMs?: number;
  memoryIntervalMs?: number;
  lifecycleIntervalMs?: number;
  enableHeapDump?: boolean;
  thresholds?: {
    cpuPercent?: AndroidAppMonitorThreshold;
    pssMb?: AndroidAppMonitorThreshold;
  };
};

export type NormalizedAndroidAppMonitorConfig = Required<
  Omit<AndroidAppMonitorConfig, "processFilters" | "thresholds">
> & {
  processFilters: string[];
  thresholds: {
    cpuPercent?: AndroidAppMonitorThreshold;
    pssMb?: AndroidAppMonitorThreshold;
  };
};

export function normalizeAndroidAppMonitorConfig(config: AndroidAppMonitorConfig): NormalizedAndroidAppMonitorConfig {
  const thresholds = config.thresholds ?? {};

  return {
    enabled: config.enabled,
    packageName: config.packageName,
    includeSubprocesses: config.includeSubprocesses ?? true,
    processFilters: [...(config.processFilters ?? [])],
    cpuIntervalMs: config.cpuIntervalMs ?? 1000,
    memoryIntervalMs: config.memoryIntervalMs ?? 5000,
    lifecycleIntervalMs: config.lifecycleIntervalMs ?? 2000,
    enableHeapDump: config.enableHeapDump ?? false,
    thresholds: {
      ...(thresholds.cpuPercent ? { cpuPercent: { ...thresholds.cpuPercent } } : {}),
      ...(thresholds.pssMb ? { pssMb: { ...thresholds.pssMb } } : {})
    }
  };
}

export type AndroidProcessInfo = {
  pid: number;
  processName: string;
  packageName: string;
  isMainProcess: boolean;
  discoveredAt: string;
};

export type AndroidProcessMetricSample = {
  sampledAt: string;
  pid: number;
  processName: string;
  cpuPercent?: number;
  pssKb?: number;
  rssKb?: number;
  raw?: Record<string, unknown>;
};

export type AndroidProcessLifecycleEvent = {
  occurredAt: string;
  type: "process_started" | "process_exited" | "process_restarted";
  pid?: number;
  previousPid?: number;
  processName: string;
};

export type AndroidAppMonitorIncident = {
  id: string;
  type: "cpu_threshold" | "memory_threshold" | "java_crash" | "native_crash" | "anr" | "process_death" | "watcher_error";
  severity: "info" | "warning" | "error";
  occurredAt: string;
  processName?: string;
  pid?: number;
  summary: string;
  detail?: string;
  artifactIds: string[];
  metadata?: Record<string, unknown>;
};

export type AndroidAppMonitorSummary = {
  packageName: string;
  startedAt: string;
  endedAt?: string;
  processes: AndroidProcessInfo[];
  sampleCounts: {
    cpu: number;
    memory: number;
    lifecycle: number;
  };
  incidents: AndroidAppMonitorIncident[];
  artifacts: {
    cpuCsvArtifactId?: string;
    memoryCsvArtifactId?: string;
    lifecycleCsvArtifactId?: string;
    summaryJsonArtifactId?: string;
  };
};

export type RunConfig = {
  deviceSerial: string;
  runKind?: "case" | "script_flow" | "stability_exploration";
  mode: RunMode;
  repeatCount: number;
  stepIntervalMs: number;
  stopOnFailure: boolean;
  recordVideo: boolean;
  keepVideoOnSuccess: boolean;
  pauseAfterEachStep?: boolean;
  startStrategy?: FlowStartStrategy;
  startAppPackageName?: string;
  startSetupScope?: FlowStartSetupScope;
  executionProfile?: "full" | "fast_visual";
  androidAppMonitor?: AndroidAppMonitorConfig;
  stabilityExploration?: {
    packageName: string;
    strategy: "conservative" | "balanced" | "aggressive";
    startMode: "launch_app" | "current_state" | "restart_app";
    seed: string;
    maxDurationMs: number;
    maxActions: number;
    allowedActions: Array<"tap" | "swipe" | "back" | "wait">;
    appExitPolicy: "back_to_app" | "restart_app" | "stop";
    backtrackStrategy: "none" | "shallow" | "depth_first";
    maxDepth: number;
    dangerousTextPatterns: string[];
    stopOnCrash: boolean;
    stopOnAnr: boolean;
    stopOnBlackScreen: boolean;
    stopOnUnknownPageStuck: boolean;
  };
};

export type RunStatus = "pending" | "running" | "paused" | "passed" | "failed" | "stopped" | "timeout" | "device_lost";

export type ArtifactType = "screenshot" | "log" | "metrics" | "report_json" | "report_html" | "video";

export type ArtifactRef = {
  id: string;
  runId?: string;
  stepResultId?: string;
  type: ArtifactType;
  name: string;
  path: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: string;
  deletedAt?: string;
};

export type MetricSample = {
  id: string;
  runId: string;
  stepResultId?: string;
  deviceSerial: string;
  sampledAt: string;
  cpuPercent?: number;
  memoryUsedKb?: number;
  memoryTotalKb?: number;
  batteryLevel?: number;
  batteryTemperatureC?: number;
  raw?: Record<string, unknown>;
};

export type DeviceEvent = {
  id: string;
  runId: string;
  stepResultId?: string;
  deviceSerial: string;
  type:
    | "crash"
    | "anr"
    | "command_failed"
    | "device_lost"
    | "preview_lost"
    | "runner_error"
    | "video_unavailable"
    | "start_state_failed"
    | "app_exit"
    | "black_screen"
    | "unknown_page_stuck"
    | "stability_exploration"
    | "native_crash"
    | "process_death"
    | "performance_threshold"
    | "android_app_monitor"
    | "interaction_asset_degraded";
  severity: "info" | "warning" | "error";
  occurredAt: string;
  summary: string;
  detail?: string;
  artifactIds: string[];
};

export type StepResult = {
  id: string;
  runId: string;
  iterationIndex: number;
  stepId: string;
  stepOrder: number;
  type: ActionType;
  status: "pending" | "running" | "passed" | "failed" | "skipped" | "timeout";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  afterScreenshotId?: string;
  artifacts: ArtifactRef[];
  expectationResults?: StepExpectationResult[];
  metadata?: Record<string, unknown>;
};

export type TestRun = {
  id: string;
  caseName: string;
  deviceSerial: string;
  status: RunStatus;
  config: RunConfig;
  steps: ActionStep[];
  stepResults: StepResult[];
  metrics: MetricSample[];
  events: DeviceEvent[];
  artifacts: ArtifactRef[];
  sourceSnapshot?: {
    kind: "script_flow";
    flowId: string;
    version: number;
    planDigest: string;
    executionPurpose?: ScriptFlowExecutionPurpose;
    sourceHash?: string;
    verificationAssessment?: ScriptFlowVerificationAssessment;
    interactionAssets?: Array<{
      stepId: string;
      assetId: string;
      key: string;
      version: number;
    }>;
    dependencies: Array<{
      flowId: string;
      version: number;
      sourceHash: string;
      sourceYaml: string;
      parsed: Record<string, unknown>;
    }>;
    sourceYaml?: string;
    parsed: Record<string, unknown>;
  };
  startedAt: string;
  endedAt?: string;
  reportHtmlPath?: string;
};

export type AndroidAppMonitorDisplaySummary = {
  packageName: string;
  processCount: number;
  cpuSamples: number;
  memorySamples: number;
  lifecycleSamples: number;
  incidentCount: number;
  severity: DeviceEvent["severity"];
};

export function androidAppMonitorDisplaySummaryFromRun(run: Pick<TestRun, "events">): AndroidAppMonitorDisplaySummary | undefined {
  const event = [...run.events].reverse().find((candidate) => candidate.type === "android_app_monitor");
  if (!event) {
    return undefined;
  }
  const detail = objectRecordFromJson(event.detail);
  const sampleCounts = objectRecord(detail?.sampleCounts);
  const processes = Array.isArray(detail?.processes) ? detail.processes : [];
  const incidents = detail?.incidents;
  return {
    packageName: stringFromUnknown(detail?.packageName) || "-",
    processCount: processes.length,
    cpuSamples: numberFromUnknown(sampleCounts?.cpu) ?? 0,
    memorySamples: numberFromUnknown(sampleCounts?.memory) ?? 0,
    lifecycleSamples: numberFromUnknown(sampleCounts?.lifecycle) ?? 0,
    incidentCount: Array.isArray(incidents) ? incidents.length : numberFromUnknown(incidents) ?? 0,
    severity: event.severity
  };
}

export function androidAppMonitorDisplaySummaryForRuns(runs: Array<Pick<TestRun, "events">>): AndroidAppMonitorDisplaySummary | undefined {
  const summaries = runs.map(androidAppMonitorDisplaySummaryFromRun).filter((summary): summary is AndroidAppMonitorDisplaySummary => Boolean(summary));
  if (!summaries.length) {
    return undefined;
  }
  const severity = summaries.some((summary) => summary.severity === "error")
    ? "error"
    : summaries.some((summary) => summary.severity === "warning" || summary.incidentCount > 0)
      ? "warning"
      : "info";
  return {
    packageName: summaries[0]?.packageName ?? "-",
    processCount: summaries.reduce((sum, summary) => sum + summary.processCount, 0),
    cpuSamples: summaries.reduce((sum, summary) => sum + summary.cpuSamples, 0),
    memorySamples: summaries.reduce((sum, summary) => sum + summary.memorySamples, 0),
    lifecycleSamples: summaries.reduce((sum, summary) => sum + summary.lifecycleSamples, 0),
    incidentCount: summaries.reduce((sum, summary) => sum + summary.incidentCount, 0),
    severity
  };
}

function objectRecordFromJson(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) {
    return undefined;
  }
  try {
    return objectRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type ToolStatus = {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
};

export type DeviceActionRequest =
  | { type: "tap"; x: number; y: number }
  | { type: "long_press"; x: number; y: number; durationMs?: number }
  | { type: "swipe"; startX: number; startY: number; endX: number; endY: number; durationMs?: number }
  | { type: "hide_keyboard" }
  | { type: "back" }
  | { type: "home" }
  | { type: "recent_apps" }
  | { type: "input_text"; text: string }
  | { type: "input_keyevents"; text: string; intervalMs?: number }
  | { type: "clear_text" }
  | { type: "wait"; durationMs: number }
  | { type: "screenshot" }
  | { type: "launch_app"; packageName: string }
  | { type: "close_app"; packageName: string };

export type DriverChannel = "adb_input" | "uiautomator2" | "appium" | "scrcpy_control" | "mock";

export type SemanticElementLocator = {
  strategy?: "android_uiautomator";
  resourceId?: string;
  text?: string;
  textMatchMode?: "equals" | "contains";
  excludeTexts?: string[];
  occurrence?: number;
  tapTarget?: "self" | "clickable_ancestor";
  contentDesc?: string;
  className?: string;
  packageName?: string;
};

export type SemanticDeviceActionRequest =
  | {
      type: "tap_on_element";
      locator: SemanticElementLocator;
      fallbackTap?: {
        x: number;
        y: number;
      };
    }
  | {
      type: "input_text_to_element";
      locator: SemanticElementLocator;
      text: string;
      clearFirst?: boolean;
      fallbackTap?: {
        x: number;
        y: number;
      };
    }
  | {
      type: "scroll_until_visible";
      locator: SemanticElementLocator;
      direction?: "up" | "down" | "left" | "right";
      maxSwipes?: number;
      intervalMs?: number;
      fallbackSwipe?: Extract<DeviceActionRequest, { type: "swipe" }>;
    };

export type DeviceActionResult = {
  driverChannel: DriverChannel;
  fallbackReason?: string;
  details?: Record<string, unknown>;
};

export type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const randomId =
    typeof cryptoApi?.randomUUID === "function"
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomId}`;
}

export function defaultAndroidCapabilities(): DeviceCapabilities {
  return {
    preview: true,
    tap: true,
    longPress: true,
    swipe: true,
    back: true,
    home: true,
    recentApps: true,
    textInput: true,
    screenshot: true,
    launchApp: true,
    closeApp: true,
    recordVideo: false,
    metrics: {
      cpu: true,
      memory: true,
      fps: false,
      network: false,
      battery: true,
      temperature: false
    },
    events: {
      crash: true,
      anr: true,
      logs: true
    }
  };
}

export function defaultIosCapabilities(options: { screenshot?: boolean; control?: boolean; recordVideo?: boolean } = {}): DeviceCapabilities {
  const control = options.control ?? false;
  return {
    preview: options.screenshot ?? true,
    tap: control,
    longPress: control,
    swipe: control,
    back: false,
    home: control,
    recentApps: false,
    textInput: control,
    screenshot: options.screenshot ?? true,
    launchApp: control,
    closeApp: control,
    recordVideo: options.recordVideo ?? false,
    metrics: {
      cpu: false,
      memory: false,
      fps: false,
      network: false,
      battery: true,
      temperature: false
    },
    events: {
      crash: false,
      anr: false,
      logs: false
    }
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function viewportPointToDevicePoint(
  point: { x: number; y: number },
  viewport: ViewportRect,
  image: ImageSize,
  device: ImageSize
): { x: number; y: number; xRatio: number; yRatio: number } {
  const imageAspect = image.width / image.height;
  const viewportAspect = viewport.width / viewport.height;
  let renderedWidth = viewport.width;
  let renderedHeight = viewport.height;
  let offsetX = 0;
  let offsetY = 0;

  if (viewportAspect > imageAspect) {
    renderedWidth = viewport.height * imageAspect;
    offsetX = (viewport.width - renderedWidth) / 2;
  } else {
    renderedHeight = viewport.width / imageAspect;
    offsetY = (viewport.height - renderedHeight) / 2;
  }

  const localX = clamp(point.x - viewport.left - offsetX, 0, renderedWidth);
  const localY = clamp(point.y - viewport.top - offsetY, 0, renderedHeight);
  const xRatio = renderedWidth === 0 ? 0 : localX / renderedWidth;
  const yRatio = renderedHeight === 0 ? 0 : localY / renderedHeight;

  return {
    x: Math.round(xRatio * device.width),
    y: Math.round(yRatio * device.height),
    xRatio,
    yRatio
  };
}

export function stepToAction(step: ActionStep, deviceSize?: ImageSize): DeviceActionRequest {
  const params = step.params;
  if (step.type === "tap") {
    const x = readCoordinate(step.coordinate?.x, step.coordinate?.xRatio, deviceSize?.width);
    const y = readCoordinate(step.coordinate?.y, step.coordinate?.yRatio, deviceSize?.height);
    return { type: "tap", x, y };
  }
  if (step.type === "long_press") {
    const x = readCoordinate(step.coordinate?.x, step.coordinate?.xRatio, deviceSize?.width);
    const y = readCoordinate(step.coordinate?.y, step.coordinate?.yRatio, deviceSize?.height);
    return { type: "long_press", x, y, durationMs: numberParam(params.durationMs, 800) };
  }
  if (step.type === "swipe") {
    const startX = readCoordinate(step.coordinate?.startX, step.coordinate?.startXRatio, deviceSize?.width);
    const startY = readCoordinate(step.coordinate?.startY, step.coordinate?.startYRatio, deviceSize?.height);
    const endX = readCoordinate(step.coordinate?.endX, step.coordinate?.endXRatio, deviceSize?.width);
    const endY = readCoordinate(step.coordinate?.endY, step.coordinate?.endYRatio, deviceSize?.height);
    return { type: "swipe", startX, startY, endX, endY, durationMs: numberParam(params.durationMs, 450) };
  }
  if (step.type === "input_text") {
    return { type: "input_text", text: stringParam(params.text) };
  }
  if (step.type === "wait") {
    return { type: "wait", durationMs: numberParam(params.durationMs, 1000) };
  }
  if (step.type === "launch_app") {
    return { type: "launch_app", packageName: stringParam(params.packageName) };
  }
  if (step.type === "close_app") {
    return { type: "close_app", packageName: stringParam(params.packageName) };
  }
  if (step.type === "back" || step.type === "home" || step.type === "recent_apps" || step.type === "clear_text" || step.type === "screenshot") {
    return { type: step.type };
  }
  throw new Error(`Unsupported direct action step: ${step.type}`);
}

function readCoordinate(value: number | undefined, ratio: number | undefined, size: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof ratio === "number" && typeof size === "number") {
    return Math.round(ratio * size);
  }
  throw new Error("Step coordinate is missing");
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}
