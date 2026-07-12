import {
  createId,
  nowIso,
  type ActionStep,
  type DeviceActionRequest,
  type FlowStateAnchor,
  type InstalledAppInfo,
  type Platform,
  type StepExpectation,
  type StepExpectationType,
  type StructuredFlow
} from "@mobile-automation/shared";

export const defaultCaseName = "录制用例";

export type AndroidUiElementLocator = {
  strategy?: "android_uiautomator";
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  occurrence?: number;
};

export type AndroidUiElementBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type RecordableAction =
  | DeviceActionRequest
  | {
      type: "tap_on_element";
      locator: AndroidUiElementLocator;
      selector?: string;
      bounds?: AndroidUiElementBounds;
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

export type RecordedStepOptions = {
  action: RecordableAction;
  order: number;
  deviceSize: {
    width: number;
    height: number;
  };
  id?: string;
  createdAt?: string;
  autoExpectations?: boolean;
};

export type RecordingObservationInput = {
  deviceSerial?: string;
  platform: Platform;
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
    source?: string;
  }>;
};

export type RecordingObservationSummary = {
  capturedAt: string;
  platform: Platform;
  deviceSerial?: string;
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  componentName?: string;
  resolution?: {
    width: number;
    height: number;
  };
  uiElementCount: number;
  ocrTextCount: number;
  resourceIds: string[];
  texts: string[];
  contentDescriptions: string[];
  classNames: string[];
  elementCandidates?: RecordingElementCandidate[];
  textCandidates?: RecordingTextCandidate[];
};

export type RecordingElementCandidate = {
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
};

export type RecordingTextCandidate = {
  text: string;
  confidence?: number;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  source?: string;
};

export type RecordingContext = {
  beforeObservation?: RecordingObservationSummary;
  afterObservation?: RecordingObservationSummary;
};

export function createRecordedStep(options: RecordedStepOptions): ActionStep {
  const createdAt = options.createdAt ?? nowIso();
  const expectations = options.autoExpectations === false ? [] : createAutomaticExpectations(options.action, createdAt);
  const preconditions = options.autoExpectations === false ? [] : createAutomaticPreconditions(options.action, createdAt);
  const base = {
    id: options.id ?? createId("step"),
    order: options.order,
    enabled: true,
    params: {},
    preconditions,
    expectations,
    createdAt
  };
  const { action, deviceSize } = options;

  if (action.type === "tap") {
    return {
      ...base,
      type: "tap",
      params: {},
      coordinate: {
        x: action.x,
        y: action.y,
        xRatio: action.x / deviceSize.width,
        yRatio: action.y / deviceSize.height,
        deviceWidth: deviceSize.width,
        deviceHeight: deviceSize.height
      }
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
      coordinate: {
        x: action.x,
        y: action.y,
        xRatio: action.x / deviceSize.width,
        yRatio: action.y / deviceSize.height,
        deviceWidth: deviceSize.width,
        deviceHeight: deviceSize.height
      }
    };
  }

  if (action.type === "tap_on_element") {
    return {
      ...base,
      type: "tap_on_element",
      title: `点击元素：${action.selector ?? describeElementLocator(action.locator)}`,
      params: {
        locator: action.locator,
        selector: action.selector ?? describeElementLocator(action.locator),
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
      coordinate: {
        x: action.x,
        y: action.y,
        xRatio: action.x / deviceSize.width,
        yRatio: action.y / deviceSize.height,
        deviceWidth: deviceSize.width,
        deviceHeight: deviceSize.height
      }
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
        startXRatio: action.startX / deviceSize.width,
        startYRatio: action.startY / deviceSize.height,
        endXRatio: action.endX / deviceSize.width,
        endYRatio: action.endY / deviceSize.height,
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
      coordinate: {
        x: action.x,
        y: action.y,
        xRatio: action.x / deviceSize.width,
        yRatio: action.y / deviceSize.height,
        deviceWidth: deviceSize.width,
        deviceHeight: deviceSize.height
      }
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
    params: actionToParams(action)
  };
}

export function renumberSteps(steps: ActionStep[]): ActionStep[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

export function mergeActionStepPatch(step: ActionStep, patch: Partial<ActionStep>): ActionStep {
  return {
    ...step,
    ...patch,
    params: patch.params ? { ...step.params, ...patch.params } : step.params,
    coordinate: patch.coordinate ?? step.coordinate,
    timing: patch.timing ?? step.timing,
    preconditions: patch.preconditions ?? step.preconditions,
    expectations: patch.expectations ?? step.expectations
  };
}

export function attachRecordingObservationsToActionStep(
  step: ActionStep,
  beforeObservation?: RecordingObservationInput,
  afterObservation?: RecordingObservationInput
): ActionStep {
  const existingContext = readRecordingContext(step.params.recordingContext);
  const context: RecordingContext = {
    ...existingContext,
    ...(beforeObservation ? { beforeObservation: summarizeRecordingObservation(beforeObservation) } : {}),
    ...(afterObservation ? { afterObservation: summarizeRecordingObservation(afterObservation) } : {})
  };
  if (!context.beforeObservation && !context.afterObservation) {
    return step;
  }
  const arrivalExpectations = afterObservation ? createArrivalExpectationsFromObservation(step, context.beforeObservation, afterObservation) : [];
  const nextExpectations = afterObservation ? mergeGeneratedArrivalExpectations(step.expectations ?? [], arrivalExpectations) : step.expectations;
  return mergeActionStepPatch(step, {
    params: {
      recordingContext: context
    },
    ...(nextExpectations !== step.expectations
      ? {
          expectations: nextExpectations
        }
      : {})
  });
}

export function summarizeRecordingObservation(observation: RecordingObservationInput): RecordingObservationSummary {
  return {
    capturedAt: observation.capturedAt,
    platform: observation.platform,
    deviceSerial: observation.deviceSerial,
    packageName: observation.packageName,
    bundleId: observation.bundleId,
    activityName: observation.activityName,
    componentName: observation.componentName,
    resolution: observation.resolution,
    uiElementCount: observation.uiElements.length,
    ocrTextCount: observation.ocrTexts.length,
    resourceIds: compactUnique(observation.uiElements.map((element) => element.resourceId), 8),
    texts: compactUnique([...observation.uiElements.map((element) => element.text), ...observation.ocrTexts.map((text) => text.text)], 10),
    contentDescriptions: compactUnique(observation.uiElements.map((element) => element.contentDesc ?? element.accessibilityId), 8),
    classNames: compactUnique(observation.uiElements.map((element) => element.className), 8),
    elementCandidates: observation.uiElements.map(compactElementCandidate).filter(hasElementCandidateSignal).slice(0, 12),
    textCandidates: observation.ocrTexts.map(compactTextCandidate).filter((candidate) => Boolean(candidate.text.trim())).slice(0, 12)
  };
}

export type StructuredFlowDraftOptions = {
  appId?: string;
  appName: string;
  platform: Platform;
  targetApp: StructuredFlow["targetApp"];
  appVersion: StructuredFlow["appVersion"];
  startStateName: string;
  endStateName: string;
  role?: string;
  steps: ActionStep[];
  createdAt?: string;
};

export function buildStructuredFlowDraft(options: StructuredFlowDraftOptions): StructuredFlow {
  const createdAt = options.createdAt ?? nowIso();
  const orderedSteps = renumberSteps(options.steps);
  const targetApp = normalizeTargetApp(options.platform, options.targetApp, orderedSteps);
  const appName = normalizeAppName(options.appName, targetApp);
  const startStateName = normalizeStateName(options.startStateName, orderedSteps[0]);
  const endStateName = normalizeStateName(options.endStateName, orderedSteps[orderedSteps.length - 1]);
  const startState = createFlowStateAnchor("state-start", startStateName, orderedSteps[0], createdAt, "beforeObservation");
  const endState = createFlowStateAnchor("state-end", endStateName, orderedSteps[orderedSteps.length - 1], createdAt, "afterObservation");
  const normalizedOptions = {
    ...options,
    appName,
    targetApp,
    startStateName,
    endStateName
  };
  return {
    id: "draft",
    name: defaultStructuredFlowName(normalizedOptions),
    description: undefined,
    appId: options.appId,
    appName,
    platform: options.platform,
    targetApp,
    appVersion: options.appVersion,
    startState,
    endState,
    role: options.role,
    startStrategy: "restart_app",
    tags: ["manual_recording"],
    status: "draft",
    version: 1,
    steps: orderedSteps.map((step, index) => ({
        id: `flow-step-${step.id}`,
        order: index + 1,
        title: step.title ?? actionStepTitle(step),
        enabled: step.enabled,
        beforeState: index === 0 ? startState : createFlowStateAnchor(`state-before-${step.id}`, actionStepTitle(step), step, createdAt, "beforeObservation"),
        action: {
          ...step,
          order: index + 1
        },
        afterExpectations: nonSystemExpectations(step),
        systemGuards: systemGuardExpectations(step, createdAt),
        timing: {
          transitionTimeoutMs: numberParam(step.params.timeoutMs, step.timing?.timeoutMs ?? 8000),
          pollIntervalMs: numberParam(step.params.intervalMs, 500),
          stableSampleCount: 2
        },
        source: {
          sourceType: "manual_recording",
          originalStepId: step.id,
          ...(readRecordingContext(step.params.recordingContext) ? { recordingContext: readRecordingContext(step.params.recordingContext) } : {})
        },
        artifacts: {
          ...(step.screenshotArtifactId ? { screenshotArtifactId: step.screenshotArtifactId } : {}),
          ...(readRecordingContext(step.params.recordingContext) ? { recordingContext: readRecordingContext(step.params.recordingContext) } : {})
        },
        createdAt: step.createdAt ?? createdAt
      })),
    createdAt,
    updatedAt: createdAt
  };
}

export function applyInstalledAppInfoToStructuredFlowDraft(flow: StructuredFlow, appInfo: InstalledAppInfo | undefined): StructuredFlow {
  if (!appInfo) {
    return flow;
  }
  const targetApp: StructuredFlow["targetApp"] =
    flow.platform === "android" && appInfo.packageName
      ? { ...flow.targetApp, androidPackageName: appInfo.packageName }
      : flow.platform === "ios" && appInfo.bundleId
        ? { ...flow.targetApp, iosBundleId: appInfo.bundleId }
        : flow.targetApp;
  const appVersion: StructuredFlow["appVersion"] = {
    ...flow.appVersion,
    displayVersion: appInfo.displayVersion || flow.appVersion.displayVersion,
    ...(appInfo.buildNumber ? { buildNumber: appInfo.buildNumber } : {}),
    ...(appInfo.versionCode ? { versionCode: appInfo.versionCode } : {})
  };
  const appName = normalizeAppName(flow.appName, targetApp);
  const name = defaultStructuredFlowName({
    appId: flow.appId,
    appName,
    platform: flow.platform,
    targetApp,
    appVersion,
    startStateName: flow.startState.name,
    endStateName: flow.endState.name,
    role: flow.role,
    steps: flow.steps.map((step) => step.action),
    createdAt: flow.createdAt
  });
  return {
    ...flow,
    appName,
    targetApp,
    appVersion,
    name
  };
}

export function createStepExpectation(
  type: StepExpectationType,
  options: {
    enabled?: boolean;
    params?: Record<string, unknown>;
    note?: string;
    createdAt?: string;
  } = {}
): StepExpectation {
  const now = options.createdAt ?? nowIso();
  return {
    id: createId("expectation"),
    type,
    enabled: options.enabled ?? true,
    title: expectationTitle(type),
    note: options.note,
    params: {
      ...defaultExpectationParams(type),
      ...(options.params ?? {})
    },
    createdAt: now
  };
}

export function createAutomaticExpectations(action: RecordableAction, createdAt = nowIso()): StepExpectation[] {
  if (action.type === "screenshot") {
    return [];
  }

  const expectations = [
    createStepExpectation("no_crash", {
      createdAt,
      note: "自动生成 P0：执行期间不应出现 Crash / ANR",
      params: autoParams("P0", true, "recording_health")
    }),
    createStepExpectation("app_alive", {
      createdAt,
      note: "自动生成 P0：动作后设备仍可响应",
      params: autoParams("P0", true, "recording_responsive")
    })
  ];

  if (shouldGenerateScreenChanged(action.type)) {
    const enabled = shouldEnableScreenChanged(action.type);
    expectations.push(
      createStepExpectation("screen_changed", {
        createdAt,
        enabled,
        note: enabled ? "自动生成 P1：该动作通常应带来画面变化" : "自动候选 P1：点击未必改变画面，确认后可启用",
        params: {
          ...autoParams("P1", enabled, "recording_visual_change"),
          comparedWith: "before_step"
        }
      })
    );
  }

  return expectations;
}

export function createAutomaticPreconditions(action: RecordableAction, createdAt = nowIso()): StepExpectation[] {
  if (action.type === "tap_on_element") {
    return createElementTapPreconditions(action, createdAt);
  }
  if (action.type !== "tap_on_text") {
    return [];
  }
  const text = action.text.trim();
  if (!text) {
    return [];
  }
  return [
    createStepExpectation("text", {
      createdAt,
      note: "自动生成前置条件：执行点击前应先看到录制时的目标文字",
      params: {
        ...autoParams("P0", true, "recording_precondition_text"),
        expected: text,
        mode: action.mode ?? "contains",
        lang: action.lang ?? "",
        timeoutMs: action.timeoutMs ?? 3000,
        intervalMs: action.intervalMs ?? 500
      }
    })
  ];
}

function createArrivalExpectationsFromObservation(
  step: ActionStep,
  beforeObservation: RecordingObservationSummary | undefined,
  afterObservation: RecordingObservationInput
): StepExpectation[] {
  if (!shouldGenerateArrivalExpectations(step.type)) {
    return [];
  }
  const anchor = selectArrivalAnchor(beforeObservation, afterObservation);
  if (!anchor) {
    return [];
  }
  const timeoutMs = numberParam(step.params.timeoutMs, step.timing?.timeoutMs ?? 8000);
  const intervalMs = numberParam(step.params.intervalMs, 500);
  const expectations: StepExpectation[] = [];
  if (anchor.text) {
    expectations.push(
      createStepExpectation("text", {
        createdAt: step.createdAt,
        note: "自动生成后置预期：动作后应到达录制时的目标页面",
        params: {
          ...autoParams("P0", true, "recording_arrival_text"),
          expected: anchor.text,
          mode: "contains",
          timeoutMs,
          intervalMs
        }
      })
    );
  }
  if (anchor.resourceId || anchor.contentDesc || anchor.className) {
    expectations.push(
      createStepExpectation("text", {
        createdAt: step.createdAt,
        note: "自动生成后置预期：动作后应到达录制时的目标页面",
        params: {
          ...autoParams("P0", true, "recording_arrival_element"),
          ...(anchor.resourceId ? { resourceId: anchor.resourceId } : {}),
          ...(anchor.contentDesc ? { contentDesc: anchor.contentDesc } : {}),
          ...(anchor.className ? { className: anchor.className } : {}),
          ...(anchor.text ? { expected: anchor.text } : {}),
          ...(anchor.packageName ? { packageName: anchor.packageName } : {}),
          mode: "exists",
          timeoutMs,
          intervalMs
        }
      })
    );
  }
  return expectations;
}

type ArrivalAnchor = {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
};

function selectArrivalAnchor(
  beforeObservation: RecordingObservationSummary | undefined,
  afterObservation: RecordingObservationInput
): ArrivalAnchor | undefined {
  const beforeTexts = new Set((beforeObservation?.texts ?? []).map(normalizeComparableText));
  const beforeResourceIds = new Set(beforeObservation?.resourceIds ?? []);
  const beforeContentDescriptions = new Set((beforeObservation?.contentDescriptions ?? []).map(normalizeComparableText));
  const candidates: Array<ArrivalAnchor & { score: number; index: number }> = [];

  afterObservation.uiElements.forEach((element, index) => {
    const text = cleanArrivalText(element.text);
    const contentDesc = cleanArrivalText(element.contentDesc ?? element.accessibilityId);
    const resourceId = element.resourceId?.trim();
    const className = element.className?.trim();
    if (isTransientArrivalElement(resourceId, text ?? contentDesc)) {
      return;
    }
    const hasNewText = Boolean(text && !beforeTexts.has(normalizeComparableText(text)));
    const hasNewResourceId = Boolean(resourceId && !beforeResourceIds.has(resourceId));
    const hasNewContentDesc = Boolean(contentDesc && !beforeContentDescriptions.has(normalizeComparableText(contentDesc)));
    if (!text && !contentDesc && !resourceId) {
      return;
    }
    let score = 0;
    if (hasNewText) {
      score += 8;
    }
    if (hasNewResourceId) {
      score += 5;
    }
    if (hasNewContentDesc) {
      score += 4;
    }
    if (text) {
      score += 3;
    }
    if (resourceId) {
      score += 2;
    }
    if (resourceId && /title|toolbar|header/i.test(resourceId)) {
      score += 4;
    }
    if (element.clickable) {
      score -= 5;
    }
    if (className && /TextView|Text/.test(className)) {
      score += 1;
    }
    candidates.push({
      text: text ?? contentDesc,
      resourceId,
      contentDesc,
      className,
      packageName: element.packageName,
      score,
      index
    });
  });

  afterObservation.ocrTexts.forEach((item, index) => {
    const text = cleanArrivalText(item.text);
    if (!text || beforeTexts.has(normalizeComparableText(text)) || isTransientArrivalText(text)) {
      return;
    }
    candidates.push({
      text,
      score: 10 + (item.confidence ?? 0) + (looksLikePageTitle(text) ? 4 : 0),
      index: afterObservation.uiElements.length + index
    });
  });

  const selected = candidates.sort((left, right) => right.score - left.score || left.index - right.index)[0];
  if (!selected || selected.score <= 0) {
    return undefined;
  }
  return {
    text: selected.text,
    resourceId: selected.resourceId,
    contentDesc: selected.contentDesc,
    className: selected.className,
    packageName: selected.packageName
  };
}

function shouldGenerateArrivalExpectations(type: ActionStep["type"]): boolean {
  return [
    "tap",
    "tap_on_text",
    "tap_on_element",
    "tap_on_image",
    "long_press",
    "swipe",
    "back",
    "home",
    "recent_apps",
    "launch_app",
    "close_app",
    "scroll_until_visible",
    "wait_until_state"
  ].includes(type);
}

function mergeGeneratedExpectations(existing: StepExpectation[], generated: StepExpectation[]): StepExpectation[] {
  const signatures = new Set(existing.map(expectationSignature));
  const merged = [...existing];
  for (const expectation of generated) {
    const signature = expectationSignature(expectation);
    if (signatures.has(signature)) {
      continue;
    }
    signatures.add(signature);
    merged.push(expectation);
  }
  return merged;
}

function mergeGeneratedArrivalExpectations(existing: StepExpectation[], generated: StepExpectation[]): StepExpectation[] {
  const withoutStaleArrival = existing.filter((expectation) => !isGeneratedArrivalExpectation(expectation));
  return mergeGeneratedExpectations(withoutStaleArrival, generated);
}

function isGeneratedArrivalExpectation(expectation: StepExpectation): boolean {
  const source = typeof expectation.params.source === "string" ? expectation.params.source : "";
  return source === "recording_arrival_text" || source === "recording_arrival_element";
}

function expectationSignature(expectation: StepExpectation): string {
  return [
    expectation.type,
    expectation.params.source,
    expectation.params.mode,
    expectation.params.expected,
    expectation.params.resourceId,
    expectation.params.contentDesc,
    expectation.params.className
  ].join("|");
}

function cleanArrivalText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text || text.length > 40) {
    return undefined;
  }
  if (/^(cpu|mem|fps|toolbox)\b/i.test(text)) {
    return undefined;
  }
  return text;
}

function isTransientArrivalElement(resourceId: string | undefined, text: string | undefined): boolean {
  if (resourceId && /status|state|tag|badge|label|time|date|count|num/i.test(resourceId)) {
    return true;
  }
  return isTransientArrivalText(text);
}

function isTransientArrivalText(value: string | undefined): boolean {
  const text = normalizeComparableText(value);
  if (!text) {
    return false;
  }
  return /^(已结束|已开始|未开始|进行中|直播中|回放|热门|推荐|全部|更多|NEW|new)$/.test(text);
}

function looksLikePageTitle(value: string): boolean {
  const text = normalizeComparableText(value);
  return text.length >= 2 && text.length <= 8 && !/[0-9]/.test(text);
}

function normalizeComparableText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim();
}

function createElementTapPreconditions(action: Extract<RecordableAction, { type: "tap_on_element" }>, createdAt: string): StepExpectation[] {
  const resourceId = action.locator.resourceId?.trim();
  const contentDesc = action.locator.contentDesc?.trim();
  const text = action.locator.text?.trim();
  if (!resourceId && !contentDesc && !text) {
    return [];
  }
  return [
    createStepExpectation("text", {
      createdAt,
      note: "自动生成前置条件：执行点击前应先看到录制时的目标元素",
      params: {
        ...autoParams("P0", true, "recording_precondition_element"),
        ...(resourceId ? { resourceId } : {}),
        ...(contentDesc ? { contentDesc } : {}),
        ...(text ? { expected: text } : {}),
        ...(action.locator.packageName ? { packageName: action.locator.packageName } : {}),
        ...(action.locator.occurrence ? { occurrence: action.locator.occurrence } : {}),
        mode: "exists",
        timeoutMs: action.timeoutMs ?? 3000,
        intervalMs: action.intervalMs ?? 500
      }
    })
  ];
}

function actionToParams(action: DeviceActionRequest): Record<string, unknown> {
  if (action.type === "input_text") {
    return { text: action.text };
  }
  if (action.type === "wait") {
    return { durationMs: action.durationMs };
  }
  if (action.type === "launch_app" || action.type === "close_app") {
    return { packageName: action.packageName };
  }
  return {};
}

function defaultExpectationParams(type: StepExpectationType): Record<string, unknown> {
  if (type === "metric_below") {
    return { metric: "cpuPercent", threshold: 80 };
  }
  if (type === "log_not_contains") {
    return { text: "FATAL EXCEPTION" };
  }
  if (type === "text") {
    return { expected: "", mode: "contains", lang: "" };
  }
  return {};
}

function expectationTitle(type: StepExpectationType): string {
  if (type === "no_crash") {
    return "无崩溃/ANR";
  }
  if (type === "app_alive") {
    return "应用仍可响应";
  }
  if (type === "screen_changed") {
    return "画面发生变化";
  }
  if (type === "metric_below") {
    return "指标低于阈值";
  }
  if (type === "log_not_contains") {
    return "日志不包含";
  }
  if (type === "image") {
    return "图像基准对比";
  }
  return "文字预期";
}

function autoParams(reliability: "P0" | "P1", defaultEnabled: boolean, source: string): Record<string, unknown> {
  return {
    autoGenerated: true,
    reliability,
    defaultEnabled,
    blocking: reliability === "P0",
    source
  };
}

function shouldGenerateScreenChanged(type: ActionStep["type"] | DeviceActionRequest["type"]): boolean {
  return [
    "tap",
    "tap_on_text",
    "tap_on_element",
    "tap_on_image",
    "input_text_to_element",
    "scroll_until_visible",
    "wait_until_state",
    "long_press",
    "swipe",
    "back",
    "home",
    "recent_apps",
    "input_text",
    "clear_text",
    "launch_app",
    "close_app"
  ].includes(type);
}

function shouldEnableScreenChanged(type: ActionStep["type"] | DeviceActionRequest["type"]): boolean {
  return ["scroll_until_visible", "wait_until_state", "swipe", "back", "home", "recent_apps", "input_text", "input_text_to_element", "clear_text", "launch_app", "close_app"].includes(type);
}

function defaultStructuredFlowName(options: StructuredFlowDraftOptions): string {
  const version = options.appVersion.buildNumber ? `${options.appVersion.displayVersion}(${options.appVersion.buildNumber})` : options.appVersion.displayVersion;
  return [options.appName, version, options.startStateName, options.endStateName].filter(Boolean).join("-");
}

function createFlowStateAnchor(
  id: string,
  name: string,
  step: ActionStep | undefined,
  createdAt: string,
  observationPhase: keyof RecordingContext = "beforeObservation"
): FlowStateAnchor {
  const observation = readRecordingContext(step?.params.recordingContext)?.[observationPhase];
  const matchers: FlowStateAnchor["matchers"] = observation ? stateMatchersFromObservationSummary(id, observation) : [];
  const resourceId = typeof step?.params.resourceId === "string" ? step.params.resourceId : undefined;
  const text = typeof step?.params.text === "string" ? step.params.text : undefined;
  if (resourceId && !hasMatcher(matchers, "resource_id", resourceId)) {
    matchers.push({
      id: `${id}-resource`,
      type: "resource_id",
      value: resourceId,
      weight: 0.8,
      critical: true,
      source: {
        sourceType: "manual_recording"
      }
    });
  }
  if (text && text !== name && !hasMatcher(matchers, "text", text)) {
    matchers.push({
      id: `${id}-text`,
      type: "text",
      value: text,
      weight: 0.4,
      source: {
        sourceType: "manual_recording"
      }
    });
  }
  return {
    id,
    name,
    matchers,
    expectations: [],
    metadata: {
      sourceType: "manual_recording",
      sourceStepId: step?.id,
      ...(observation ? { recordingObservation: observation } : {})
    }
  };
}

function normalizeTargetApp(platform: Platform, targetApp: StructuredFlow["targetApp"], steps: ActionStep[]): StructuredFlow["targetApp"] {
  if (platform === "android") {
    const explicit = normalizeKnownPackageName(targetApp.androidPackageName);
    return { androidPackageName: explicit ?? inferAndroidPackageName(steps) };
  }
  if (platform === "ios") {
    return { iosBundleId: normalizeKnownPackageName(targetApp.iosBundleId) };
  }
  return targetApp;
}

function normalizeAppName(appName: string, targetApp: StructuredFlow["targetApp"]): string {
  const trimmed = appName.trim();
  if (trimmed && trimmed !== "未命名应用") {
    return trimmed;
  }
  const targetAppName = targetApp.androidPackageName ?? targetApp.iosBundleId;
  return targetAppName ?? (trimmed || "未命名应用");
}

function normalizeStateName(name: string, step: ActionStep | undefined): string {
  const trimmed = name.trim();
  if (trimmed && trimmed !== "起点" && trimmed !== "终点") {
    return trimmed;
  }
  return step ? actionStepTitle(step) : trimmed;
}

function readRecordingContext(value: unknown): RecordingContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as RecordingContext;
  return {
    ...(isRecordingObservationSummary(input.beforeObservation) ? { beforeObservation: input.beforeObservation } : {}),
    ...(isRecordingObservationSummary(input.afterObservation) ? { afterObservation: input.afterObservation } : {})
  };
}

function isRecordingObservationSummary(value: unknown): value is RecordingObservationSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const input = value as Partial<RecordingObservationSummary>;
  return (
    (input.platform === "android" || input.platform === "ios") &&
    typeof input.capturedAt === "string" &&
    typeof input.uiElementCount === "number" &&
    typeof input.ocrTextCount === "number" &&
    Array.isArray(input.resourceIds) &&
    Array.isArray(input.texts) &&
    Array.isArray(input.contentDescriptions) &&
    Array.isArray(input.classNames)
  );
}

function compactElementCandidate(element: RecordingObservationInput["uiElements"][number]): RecordingElementCandidate {
  return {
    ...(element.resourceId ? { resourceId: element.resourceId } : {}),
    ...(element.accessibilityId ? { accessibilityId: element.accessibilityId } : {}),
    ...(element.text ? { text: element.text } : {}),
    ...(element.contentDesc ? { contentDesc: element.contentDesc } : {}),
    ...(element.className ? { className: element.className } : {}),
    ...(element.packageName ? { packageName: element.packageName } : {}),
    ...(element.bounds ? { bounds: element.bounds } : {}),
    ...(typeof element.enabled === "boolean" ? { enabled: element.enabled } : {}),
    ...(typeof element.visible === "boolean" ? { visible: element.visible } : {}),
    ...(typeof element.clickable === "boolean" ? { clickable: element.clickable } : {}),
    ...(typeof element.longClickable === "boolean" ? { longClickable: element.longClickable } : {}),
    ...(typeof element.focusable === "boolean" ? { focusable: element.focusable } : {})
  };
}

function hasElementCandidateSignal(candidate: RecordingElementCandidate): boolean {
  return Boolean(candidate.resourceId || candidate.accessibilityId || candidate.text || candidate.contentDesc || candidate.className);
}

function compactTextCandidate(text: RecordingObservationInput["ocrTexts"][number]): RecordingTextCandidate {
  return {
    text: text.text,
    ...(typeof text.confidence === "number" ? { confidence: text.confidence } : {}),
    ...(text.region ? { region: text.region } : {}),
    ...(text.source ? { source: text.source } : {})
  };
}

function stateMatchersFromObservationSummary(id: string, observation: RecordingObservationSummary): FlowStateAnchor["matchers"] {
  const matchers: FlowStateAnchor["matchers"] = [];
  if (observation.activityName) {
    matchers.push({
      id: `${id}-activity`,
      type: "activity",
      value: observation.activityName,
      weight: 0.95,
      critical: true,
      source: {
        sourceType: "manual_recording",
        sourceSignal: "recording_observation"
      }
    });
  }
  if (observation.packageName) {
    matchers.push({
      id: `${id}-package`,
      type: "package",
      value: observation.packageName,
      weight: 0.85,
      source: {
        sourceType: "manual_recording",
        sourceSignal: "recording_observation"
      }
    });
  }
  observation.resourceIds.slice(0, 3).forEach((resourceId, index) => {
    matchers.push({
      id: `${id}-resource-${index + 1}`,
      type: "resource_id",
      value: resourceId,
      weight: index === 0 ? 0.75 : 0.6,
      critical: !observation.activityName && index === 0,
      source: {
        sourceType: "manual_recording",
        sourceSignal: "recording_observation"
      }
    });
  });
  observation.texts.slice(0, 3).forEach((text, index) => {
    matchers.push({
      id: `${id}-text-${index + 1}`,
      type: "text",
      value: text,
      weight: index === 0 ? 0.45 : 0.35,
      source: {
        sourceType: "manual_recording",
        sourceSignal: "recording_observation"
      }
    });
  });
  return matchers;
}

function hasMatcher(matchers: FlowStateAnchor["matchers"], type: string, value: string): boolean {
  return matchers.some((matcher) => matcher.type === type && matcher.value === value);
}

function normalizeKnownPackageName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "unknown.android.package" || trimmed === "unknown.ios.bundle") {
    return undefined;
  }
  return trimmed;
}

function inferAndroidPackageName(steps: ActionStep[]): string | undefined {
  for (const step of steps) {
    const packageName = normalizeKnownPackageName(typeof step.params.packageName === "string" ? step.params.packageName : undefined);
    if (packageName) {
      return packageName;
    }
    const locator = step.params.locator;
    if (locator && typeof locator === "object" && "packageName" in locator) {
      const locatorPackage = normalizeKnownPackageName(typeof locator.packageName === "string" ? locator.packageName : undefined);
      if (locatorPackage) {
        return locatorPackage;
      }
    }
  }
  return undefined;
}

function nonSystemExpectations(step: ActionStep): StepExpectation[] {
  const expectations = (step.expectations ?? []).filter((expectation) => expectation.type !== "no_crash" && expectation.type !== "app_alive");
  if (expectations.length > 0) {
    return expectations;
  }
  const text = typeof step.params.text === "string" ? step.params.text.trim() : "";
  if (!text) {
    return [];
  }
  return [
    createStepExpectation("text", {
      createdAt: step.createdAt,
      params: {
        expected: text,
        mode: step.params.mode ?? "contains",
        timeoutMs: step.params.timeoutMs ?? 8000,
        intervalMs: step.params.intervalMs ?? 500,
        source: "structured_flow_auto_after_text"
      }
    })
  ];
}

function systemGuardExpectations(step: ActionStep, createdAt: string): StepExpectation[] {
  const existing = (step.expectations ?? []).filter((expectation) => expectation.type === "no_crash" || expectation.type === "app_alive");
  const hasNoCrash = existing.some((expectation) => expectation.type === "no_crash");
  const hasAppAlive = existing.some((expectation) => expectation.type === "app_alive");
  return [
    ...existing,
    ...(hasNoCrash ? [] : [createStepExpectation("no_crash", { createdAt, params: autoParams("P0", true, "structured_flow_guard") })]),
    ...(hasAppAlive ? [] : [createStepExpectation("app_alive", { createdAt, params: autoParams("P0", true, "structured_flow_guard") })])
  ];
}

function actionStepTitle(step: ActionStep): string {
  if (step.title?.trim()) {
    return step.title;
  }
  if (step.type === "tap_on_text" && typeof step.params.text === "string") {
    return `点击文字：${step.params.text}`;
  }
  if (step.type === "tap_on_element" && typeof step.params.selector === "string") {
    return `点击元素：${step.params.selector}`;
  }
  if (step.type === "input_text_to_element") {
    return "输入到元素";
  }
  if (step.type === "scroll_until_visible") {
    return "滚动直到可见";
  }
  if (step.type === "wait_until_state") {
    return "等待状态";
  }
  return step.type;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactUnique(values: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function describeElementLocator(locator: AndroidUiElementLocator): string {
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
