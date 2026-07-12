export type Platform = "android" | "ios";

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

export type TestCase = {
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

export type FlowStateMatcher = {
  id: string;
  type: string;
  value: string;
  weight: number;
  threshold?: number;
  critical?: boolean;
  params?: Record<string, unknown>;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  platform?: Platform | "mobile-both";
  source?: Record<string, unknown>;
};

export type FlowStateAnchor = {
  id: string;
  name: string;
  matchers: FlowStateMatcher[];
  expectations?: StepExpectation[];
  screenshotAnchor?: {
    artifactId: string;
    threshold: number;
    region?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  metadata?: Record<string, unknown>;
};

export type RuleStateMatcher = FlowStateMatcher;

export type RuleStateAnchor = FlowStateAnchor;

export type TestRuleStepSourceType =
  | "structured_flow"
  | "business_graph"
  | "manual_recording"
  | "manual_edit"
  | "imported"
  | "ai_overlay";

export type TestRuleStep = {
  id: string;
  order: number;
  title: string;
  enabled: boolean;
  beforeState: RuleStateAnchor;
  action: ActionStep;
  afterExpectations: StepExpectation[];
  systemGuards: StepExpectation[];
  timing?: {
    transitionTimeoutMs?: number;
    pollIntervalMs?: number;
    stableSampleCount?: number;
  };
  source?: Record<string, unknown> & {
    sourceType?: TestRuleStepSourceType;
    sourceId?: string;
  };
  artifacts?: Record<string, unknown>;
  createdAt: string;
};

export type StructuredFlowStatus = "draft" | "active" | "deprecated";

export type StructuredFlowStartStrategy = FlowStartStrategy | "install_build_and_launch";

export type StructuredFlowAppVersion = {
  displayVersion: string;
  buildNumber?: string;
  versionCode?: string;
  compatibleRange?: string;
};

export type InstalledAppInfo = {
  packageName?: string;
  bundleId?: string;
  displayVersion: string;
  buildNumber?: string;
  versionCode?: string;
  firstInstallTime?: string;
  lastUpdateTime?: string;
};

export type StructuredFlowStep = TestRuleStep;

export type StructuredFlow = {
  id: string;
  name: string;
  description?: string;
  appId?: string;
  appName: string;
  platform: Platform;
  targetApp: {
    androidPackageName?: string;
    iosBundleId?: string;
  };
  appVersion: StructuredFlowAppVersion;
  startState: FlowStateAnchor;
  endState: FlowStateAnchor;
  role?: string;
  startStrategy: StructuredFlowStartStrategy;
  tags: string[];
  status: StructuredFlowStatus;
  version: number;
  steps: StructuredFlowStep[];
  createdAt: string;
  updatedAt: string;
};

export type RunConfig = {
  caseId?: string;
  deviceSerial: string;
  runKind?: "case" | "structured_flow" | "business_graph" | "stability_exploration" | "asset_patrol";
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
  assetPatrol?: {
    packageName: string;
    graphVersionId?: string;
    startMode: "current_state" | "launch_app" | "restart_app";
    pageScope: "current_page" | "reachable_pages" | "tagged_pages" | "all_active_pages";
    maxDurationMs: number;
    maxTransitions: number;
    allowRiskyActions: boolean;
    allowBusinessSubmit: boolean;
    dangerousTextPatterns: string[];
    runtimeParams: Record<string, string>;
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
    | "asset_patrol"
    | "ai_diagnosis";
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
  caseId?: string;
  caseName: string;
  deviceSerial: string;
  status: RunStatus;
  config: RunConfig;
  steps: ActionStep[];
  stepResults: StepResult[];
  metrics: MetricSample[];
  events: DeviceEvent[];
  artifacts: ArtifactRef[];
  startedAt: string;
  endedAt?: string;
  reportHtmlPath?: string;
};

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
