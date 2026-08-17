import {
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type DeviceActionResult,
  type SemanticDeviceActionRequest
} from "@mobile-automation/shared";
import type { OcrLayoutResult, OcrService, OcrTextBox } from "./ocr.js";
import {
  isProbablyProtectedScreenshot,
  matchTextExpectation,
  normalizeOcrText,
  positiveNumberParam,
  textExpectationMode,
  type ScreenshotCapture
} from "./step-expectations.js";
import {
  findElementByLocator,
  hasStableLocator,
  hierarchySize,
  locatorFromCandidate,
  parseAndroidUiHierarchy,
  sanitizeLocator,
  type UiElementCandidate,
  type UiElementLocator
} from "./ui-hierarchy-locator.js";
import { createVisualLocatorTemplate, imageSampleNativeBestEffort, locateVisualTemplateInScreenshot, type ImageSample } from "./page-matcher.js";
import type { RuntimeInterceptorRunOutcome } from "./runtime-interceptor.js";

type VisualSemanticArea = "top" | "content" | "bottom" | "unknown";

type GridScrollProfile = {
  containerKind?: string;
  direction: "vertical" | "horizontal";
  columns: number;
  targetKind?: string;
  targetQuery?: string;
  candidateItemHeightPercent?: number;
  maxSearchSwipes?: number;
  maxScrollAttempts?: number;
  maxSwipes?: number;
  clickSafePoint: {
    xPercent: number;
    yPercent: number;
  };
  scrollStepPercent: number;
};

export type TextLocatorCandidate = {
  text: string;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  distanceToPoint?: number;
};

export type SemanticResolutionOutcome = {
  supported: boolean;
  resolved: boolean;
  action?: DeviceActionRequest;
  actionResult?: DeviceActionResult;
  message: string;
  artifacts: ArtifactRef[];
  metadata: Record<string, unknown>;
  runtimeInterceptorOutcome?: RuntimeInterceptorRunOutcome;
};

type PickerColumnValue = string | number;

type PickerColumnCandidate<T extends PickerColumnValue> = {
  value: T;
  candidate: TextLocatorCandidate;
};

type WheelPickerColumnResult<T extends PickerColumnValue> = {
  selected: boolean;
  selectedPart?: string;
  actionResult?: DeviceActionResult;
  swipes: number;
  failureReason?: "picker_value_not_found" | "picker_no_progress";
  stalledAt?: string;
};

type UiHierarchyTextResolution = {
  action: Extract<DeviceActionRequest, { type: "tap" }>;
  actual: string;
  textCandidate: UiElementCandidate;
  actionableCandidate?: UiElementCandidate;
  tapPointSource: "ui_text_center" | "ui_clickable_ancestor";
  matchStrategy: "ui_hierarchy_equals" | "ui_hierarchy_contains";
  candidateCount: number;
  visibilityFilteredCandidateCount?: number;
  visibilityOriginalCandidateCount?: number;
};

type UiHierarchyIconResolution = {
  action: Extract<DeviceActionRequest, { type: "tap" }>;
  candidate: UiElementCandidate;
  resolvedLocator: UiElementLocator;
  score: number;
  semanticEvidence: number;
  matchReason: "semantic_accessibility" | "semantic_identity";
  candidateCount: number;
};

type SemanticStepResolverDeps = {
  ocr: OcrService;
  performAction: (serial: string, action: DeviceActionRequest) => Promise<DeviceActionResult | void>;
  performSemanticAction?: (serial: string, action: SemanticDeviceActionRequest) => Promise<DeviceActionResult | void>;
  dumpUiHierarchy?: (serial: string) => Promise<string>;
  handleRuntimeInterceptors?: (input: {
    serial: string;
    deviceSize?: { width: number; height: number };
  }) => Promise<RuntimeInterceptorRunOutcome>;
  captureLocatorScreenshot: (runId: string, stepResultId: string, serial: string, stepId: string, attempt: number) => Promise<ScreenshotCapture>;
};

export class SemanticStepResolver {
  constructor(private readonly deps: SemanticStepResolverDeps) {}

  private async performAction(
    input: { serial: string; signal?: AbortSignal },
    action: DeviceActionRequest
  ): Promise<DeviceActionResult | void> {
    throwIfResolutionStopped(input.signal);
    const result = await this.deps.performAction(input.serial, action);
    throwIfResolutionStopped(input.signal);
    return result;
  }

  private async performSemanticAction(
    input: { serial: string; signal?: AbortSignal },
    action: SemanticDeviceActionRequest
  ): Promise<DeviceActionResult | void> {
    throwIfResolutionStopped(input.signal);
    const result = await this.deps.performSemanticAction?.(input.serial, action);
    throwIfResolutionStopped(input.signal);
    return result;
  }

  private async wait(input: { serial: string; signal?: AbortSignal }, ms: number): Promise<void> {
    const signal = input.signal;
    throwIfResolutionStopped(signal);
    if (!signal) {
      await sleep(ms);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(runnerStoppedError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
    });
  }

  async resolveIfNeeded(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
    signal?: AbortSignal;
  }): Promise<SemanticResolutionOutcome | undefined> {
    if (input.step.type === "tap_on_text") {
      return this.resolveTapOnText(input);
    }
    if (input.step.type === "tap_on_element") {
      return this.resolveTapOnElement(input);
    }
    if (input.step.type === "input_text_to_element") {
      return this.resolveInputTextToElement(input);
    }
    if (input.step.type === "scroll_until_visible") {
      return this.resolveScrollUntilVisible(input);
    }
    if (input.step.type === "wait_until_state") {
      return this.resolveWaitUntilState(input);
    }
    if (input.step.type === "tap_on_image") {
      return this.resolveTapOnImageRegion(input);
    }
    return undefined;
  }

  private async resolveTapOnImageRegion(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    if (isVisualQueryLocator(input.step.params)) {
      return this.resolveVisualQueryTap(input);
    }
    if (isSemanticIconLocator(input.step.params)) {
      return this.resolveSemanticIconTap(input);
    }
    if (isOcrAnchorOffsetLocator(input.step.params)) {
      return this.resolveOcrAnchorOffsetTap(input);
    }
    if (input.step.params.fieldType === "toggle_set" && isTrailingSwitchLocator(input.step.params)) {
      return this.resolveTrailingSwitchSet(input);
    }
    if (input.step.params.fieldType === "picker_select" && isRuntimeTapStructuralLocator(input.step.params)) {
      return this.resolveRuntimeStructuralPicker(input);
    }
    if (input.step.params.fieldType === "subpage_edit" && isRuntimeOptionSelectionLocator(input.step.params)) {
      return this.resolveRuntimeOptionSelection(input);
    }
    const recordedRegion = readPercentRegion(input.step.params.region);
    const searchHintRegion = readGridCandidateSearchHintRegion(input.step.params);
    const semanticCollectionRegion = readGridCandidateSemanticRegion(input.step.params);
    const region = recordedRegion ?? searchHintRegion ?? semanticCollectionRegion;
    const regionSource = recordedRegion
      ? "recorded_region"
      : searchHintRegion
        ? "search_hint"
        : semanticCollectionRegion
          ? "semantic_content"
          : undefined;
    if (!region && isRuntimeTapStructuralLocator(input.step.params)) {
      return this.resolveRuntimeStructuralTap(input);
    }
    if (!region) {
      return {
        supported: true,
        resolved: false,
        message: "tap_on_image requires params.region from a manually marked screenshot area.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "missing_region"
        }
      };
    }
    const semanticArea = readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region);
    const tapPointPercent = readTapPointPercent(input.step.params.tapPointPercent);
    const center = regionPoint(region, input.deviceSize, tapPointPercent);
    if (!center) {
      return {
        supported: true,
        resolved: false,
        message: "tap_on_image requires device size to convert the marked region.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "missing_device_size",
          region
        }
      };
    }
    if (input.step.params.abilityType === "grid_candidate") {
      const gridOutcome = await this.tryResolveGridCandidateByOcr(input, region);
      if (gridOutcome) {
        return {
          ...gridOutcome,
          metadata: {
            ...gridOutcome.metadata,
            ...(regionSource ? { regionSource } : {})
          }
        };
      }
      if (gridCandidateRequiresTargetQuery(input.step.params)) {
        const scrollProfile = readScrollProfile(input.step.params.scrollProfile);
        return {
          supported: true,
          resolved: false,
          message: `Grid candidate target "${scrollProfile.targetQuery}" was not found inside the marked list region.`,
          artifacts: [],
          metadata: {
            type: "image_region",
            action: "fail",
            abilityType: "grid_candidate",
            reason: "target_not_found",
            targetQuery: scrollProfile.targetQuery,
            region,
            ...(regionSource ? { regionSource } : {})
          }
        };
      }
      if (gridCandidateMissingSemanticTarget(input.step.params)) {
        const scrollProfile = readScrollProfile(input.step.params.scrollProfile);
        return {
          supported: true,
          resolved: false,
          message: "Legacy grid candidate index assets are deprecated. Record a list region with an OCR/parameter target instead.",
          artifacts: [],
          metadata: {
            type: "image_region",
            action: "fail",
            abilityType: "grid_candidate",
            reason: "deprecated_grid_candidate_without_target",
            targetKind: scrollProfile.targetKind,
            region,
            ...(regionSource ? { regionSource } : {})
          }
        };
      }
    }
    if (input.step.params.fieldType === "picker_select") {
      return this.resolvePickerSelectFromImageRegion(input, region, semanticArea, center);
    }
    if (input.step.params.fieldType === "toggle_set") {
      const toggleOutcome = await this.resolveToggleSetFromImageRegion(input, region, semanticArea, center);
      if (toggleOutcome) {
        return toggleOutcome;
      }
    }
    const structuralCheckboxOutcome = await this.resolveLeadingCheckboxNearText(input, region, semanticArea);
    if (structuralCheckboxOutcome) {
      return structuralCheckboxOutcome;
    }
    const targetText = imageRegionTargetText(input.step.params, semanticArea);
    if (targetText && input.step.params.abilityType !== "grid_candidate" && this.deps.ocr.locateText) {
      const mode = tapTextMatchMode(input.step.params.mode);
      const artifacts: ArtifactRef[] = [];
      const tryRelocateByOcr = async (
        attempt: number,
        relocatedBy: "ocr_text" | "ocr_text_after_reveal",
        reveal?: Record<string, unknown>
      ): Promise<SemanticResolutionOutcome | undefined> => {
        const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
        artifacts.push(screenshot.artifact);
        const layout = await this.deps.ocr.locateText?.({
          image: screenshot.png,
          mode
        });
        if (!layout) {
          return undefined;
        }
        const relocated = findTextCandidate(layout, targetText, {
          mode,
          semanticArea,
          deviceSize: input.deviceSize
        });
        if (!relocated) {
          return undefined;
        }
        const action = {
          type: "tap",
          x: scaleCoordinate(relocated.centerX, layout.width, input.deviceSize?.width),
          y: scaleCoordinate(relocated.centerY, layout.height, input.deviceSize?.height)
        } satisfies DeviceActionRequest;
        const actionResult = normalizeActionResult(await this.performAction(input, action));
        return {
          supported: true,
          resolved: true,
          action,
          actionResult,
          message: `Relocated manually marked image region by OCR text "${relocated.text}".`,
          artifacts,
          metadata: {
            type: "image_region",
            action: "tap",
            ...pageTaskSemanticMetadata(input.step.params),
            region,
            targetText,
            actual: relocated.text,
            relocatedBy,
            semanticArea,
            locator: relocated,
            center: action,
            ...(reveal ? { reveal } : {}),
            driverChannel: actionResult?.driverChannel
          }
        };
      };
      const directOutcome = await tryRelocateByOcr(1, "ocr_text");
      if (directOutcome) {
        return directOutcome;
      }
      if (shouldRevealAfterScroll(input.step.params, semanticArea)) {
        const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.revealMaxSwipes, 2)));
        const intervalMs = positiveNumberParam(input.step.params.revealIntervalMs, 250);
        const direction = scrollDirectionParam(input.step.params.revealDirection) ?? "up";
        for (let swipes = 1; swipes <= maxSwipes; swipes += 1) {
          await this.performAction(input, scrollSwipeAction(direction, input.deviceSize));
          await this.wait(input, intervalMs);
          const revealedOutcome = await tryRelocateByOcr(swipes + 1, "ocr_text_after_reveal", {
            direction,
            swipes,
            attempts: swipes + 1
          });
          if (revealedOutcome) {
            return revealedOutcome;
          }
        }
      }
    }
    const templateResolution = await this.resolveVisualTemplateRegion(input, region, semanticArea);
    if (templateResolution?.selected?.point) {
      const action = { type: "tap", x: templateResolution.selected.point.x, y: templateResolution.selected.point.y } satisfies DeviceActionRequest;
      const actionResult = normalizeActionResult(await this.performAction(input, action));
      return {
        supported: true,
        resolved: true,
        action,
        actionResult,
        message: `Relocated manually marked image region by recorded visual template.`,
        artifacts: templateResolution.artifacts,
        metadata: {
          type: "image_region",
          action: "tap",
          ...pageTaskSemanticMetadata(input.step.params),
          region,
          semanticArea,
          relocatedBy: "template_search",
          visualTemplate: templateResolution.selected.template,
          visualRelocation: templateResolution.diagnostic,
          center: action,
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    const visualResolution = resolveVisualImageRegionCandidate(input.step.params.visualLocator, {
      semanticArea,
      deviceSize: input.deviceSize
    });
    if (visualResolution.selected?.point) {
      const action = { type: "tap", x: visualResolution.selected.point.x, y: visualResolution.selected.point.y } satisfies DeviceActionRequest;
      const actionResult = normalizeActionResult(await this.performAction(input, action));
      return {
        supported: true,
        resolved: true,
        action,
        actionResult,
        message: `Relocated manually marked image region by visual candidate "${visualResolution.selected.candidate.label}".`,
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "tap",
          ...pageTaskSemanticMetadata(input.step.params),
          region,
          semanticArea,
          relocatedBy: "visual_candidate",
          visualCandidate: visualResolution.selected.candidate,
          visualRelocation: visualResolution.diagnostic,
          center: action,
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    return {
      supported: true,
      resolved: false,
      message: "Image region could not be relocated by OCR, visual template, or visual candidates.",
      artifacts: templateResolution?.artifacts ?? [],
      metadata: {
        type: "image_region",
        action: "fail",
        ...pageTaskSemanticMetadata(input.step.params),
        region,
        semanticArea,
        ...(tapPointPercent ? { tapPointPercent } : {}),
        ...(typeof numberParam(input.step.params.candidateIndex) === "number" ? { candidateIndex: numberParam(input.step.params.candidateIndex) } : {}),
        recordedCenter: center,
        fallback: "region_center_disabled",
        reason: "runtime_relocation_required",
        ...(visualResolution.diagnostic || templateResolution?.diagnostic
          ? { visualRelocation: visualResolution.diagnostic ?? templateResolution?.diagnostic }
          : {})
      }
    };
  }

  private async resolveOcrAnchorOffsetTap(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const anchorText = textParam(params.anchorText ?? params.targetText ?? params.text).trim();
    const semanticArea = readSemanticArea(params.semanticArea) ?? "unknown";
    if (!anchorText) {
      return {
        supported: true,
        resolved: false,
        message: "ocr_anchor_offset requires anchorText or targetText.",
        artifacts: [],
        metadata: {
          type: "ocr_anchor_offset",
          action: "fail",
          reason: "missing_anchor_text"
        }
      };
    }
    if (!input.deviceSize) {
      return {
        supported: true,
        resolved: false,
        message: "ocr_anchor_offset requires device size.",
        artifacts: [],
        metadata: {
          type: "ocr_anchor_offset",
          action: "fail",
          reason: "missing_device_size",
          anchorText
        }
      };
    }
    if (!this.deps.ocr.locateText) {
      return {
        supported: true,
        resolved: false,
        message: "ocr_anchor_offset requires OCR layout support.",
        artifacts: [],
        metadata: {
          type: "ocr_anchor_offset",
          action: "fail",
          reason: "ocr_layout_unavailable",
          anchorText
        }
      };
    }

    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    const mode = tapTextMatchMode(params.mode);
    const layout = await this.deps.ocr.locateText({
      image: screenshot.png,
      mode
    });
    const anchor = layout
      ? findTextCandidate(layout, anchorText, {
          mode,
          semanticArea,
          deviceSize: input.deviceSize
        })
      : undefined;
    if (!layout || !anchor) {
      return {
        supported: true,
        resolved: false,
        message: `OCR anchor "${anchorText}" was not found.`,
        artifacts: [screenshot.artifact],
        metadata: {
          type: "ocr_anchor_offset",
          action: "fail",
          reason: "anchor_not_found",
          anchorText,
          actual: layout?.text ?? ""
        }
      };
    }

    const offset = readSignedPercentPoint(params.anchorOffsetPercent ?? params.ocrAnchorOffsetPercent);
    const anchorPoint = textCandidateDevicePoint(anchor, layout, input.deviceSize);
    const point = clampDevicePoint(
      {
        x: anchorPoint.x + Math.round((input.deviceSize.width * offset.x) / 100),
        y: anchorPoint.y + Math.round((input.deviceSize.height * offset.y) / 100)
      },
      input.deviceSize
    );
    const action = { type: "tap", x: point.x, y: point.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Relocated by OCR anchor "${anchor.text}" with offset.`,
      artifacts: [screenshot.artifact],
      metadata: {
        type: "ocr_anchor_offset",
        action: "tap",
        anchorText,
        actual: anchor.text,
        relocatedBy: "ocr_anchor_offset",
        semanticArea,
        anchor,
        anchorPoint,
        offsetPercent: offset,
        center: action,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveTopBarIconTap(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const role = topBarIconRole(params);
    const slot = readTopBarSlot(params.slot) ?? (role === "avatar" ? "leading" : "trailing");
    const orderFromRight = Math.max(1, Math.floor(numberParam(params.orderFromRight) ?? 1));
    const anchorText = textParam(params.anchorText ?? params.targetText ?? params.text).trim();
    const semanticArea = readSemanticArea(params.semanticArea) ?? "top";
    if (!input.deviceSize) {
      return {
        supported: true,
        resolved: false,
        message: "top_bar_icon_locator requires device size.",
        artifacts: [],
        metadata: {
          type: "top_bar_icon_locator",
          action: "fail",
          reason: "missing_device_size",
          role,
          slot,
          orderFromRight
        }
      };
    }

    const artifacts: ArtifactRef[] = [];
    let locatorScreenshot: ScreenshotCapture | undefined;
    const captureLocatorScreenshot = async (): Promise<ScreenshotCapture> => {
      if (!locatorScreenshot) {
        locatorScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
        artifacts.push(locatorScreenshot.artifact);
      }
      return locatorScreenshot;
    };
    let anchor: TextLocatorCandidate | undefined;
    let anchorPoint: { x: number; y: number } | undefined;
    let actualText = "";
    let locatorLayout: OcrLayoutResult | undefined;
    const locateScreenshotText = async (mode: "contains" | "equals" | "not_contains" = "contains"): Promise<OcrLayoutResult | undefined> => {
      if (!this.deps.ocr.locateText) {
        return undefined;
      }
      if (!locatorLayout) {
        const screenshot = await captureLocatorScreenshot();
        locatorLayout = await this.deps.ocr.locateText({
          image: screenshot.png,
          mode
        });
      }
      return locatorLayout;
    };
    if (anchorText && this.deps.ocr.locateText) {
      const mode = tapTextMatchMode(params.mode);
      const layout = await locateScreenshotText(mode);
      if (!layout) {
        return {
          supported: true,
          resolved: false,
          message: "top_bar_icon_locator requires OCR layout support for anchor text.",
          artifacts,
          metadata: {
            type: "top_bar_icon_locator",
            action: "fail",
            reason: "ocr_layout_unavailable",
            role,
            slot,
            orderFromRight,
            anchorText,
            semanticArea
          }
        };
      }
      actualText = layout.text;
      anchor = findTextCandidate(layout, anchorText, {
        mode,
        semanticArea,
        deviceSize: input.deviceSize
      });
      if (anchor) {
        anchorPoint = textCandidateDevicePoint(anchor, layout, input.deviceSize);
      }
    }

    const visualLocator = readRecord(params.visualLocator);
    const candidates = readVisualImageRegionCandidates(visualLocator?.candidates);
    const recordedCandidateUsed = candidates.length > 0;
    const candidatePool = recordedCandidateUsed
      ? candidates
      : [genericTopBarIconSearchCandidate({ role, slot, semanticArea })];
    const selected = selectTopBarIconCandidate(candidatePool, {
      role,
      slot,
      orderFromRight,
      semanticArea,
      anchorXPercent: anchorPoint ? (anchorPoint.x / input.deviceSize.width) * 100 : undefined
    });
    if (!selected.candidate) {
      return {
        supported: true,
        resolved: false,
        message: `Top bar icon "${role || slot}" could not be relocated.`,
        artifacts,
        metadata: {
          type: "top_bar_icon_locator",
          action: "fail",
          reason: selected.reason ?? "candidate_not_found",
          role,
          slot,
          orderFromRight,
          anchorText,
          actual: normalizeOcrText(actualText) || undefined,
          anchor,
          anchorPoint,
          semanticArea,
          visualRelocation: selected.diagnostic,
          fallback: "candidate_center_disabled"
        }
      };
    }

    const screenshot = await captureLocatorScreenshot();
    const currentVisual = await locateCurrentTopBarIconInScreenshot({
      screenshot: screenshot.png,
      candidate: selected.candidate,
      role,
      slot,
      orderFromRight,
      semanticArea,
      deviceSize: input.deviceSize,
      anchorXPercent: anchorPoint ? (anchorPoint.x / input.deviceSize.width) * 100 : undefined,
      ocrLayout: locatorLayout ?? await locateScreenshotText().catch(() => undefined)
    });
    if (!currentVisual.selected) {
      return {
        supported: true,
        resolved: false,
        message: `Top bar icon "${role || slot}" could not be visually relocated in the current screenshot.`,
        artifacts,
        metadata: {
          type: "top_bar_icon_locator",
          action: "fail",
          reason: "current_visual_icon_not_found",
          role,
          slot,
          orderFromRight,
          anchorText,
          actual: anchor?.text ?? (normalizeOcrText(actualText) || undefined),
          anchor,
          anchorPoint,
          semanticArea,
        visualCandidate: selected.candidate,
        visualRelocation: selected.diagnostic,
        currentVisual: currentVisual.diagnostic,
        recordedCandidateUsed,
        fallback: "candidate_center_disabled"
        }
      };
    }

    const point = currentVisual.selected.point;
    const action = { type: "tap", x: point.x, y: point.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Resolved top bar ${slot} icon${role ? ` "${role}"` : ""} in current screenshot.`,
      artifacts,
      metadata: {
        type: "top_bar_icon_locator",
        action: "tap",
        ...pageTaskSemanticMetadata(params),
        role,
        slot,
        orderFromRight,
        anchorText,
        actual: anchor?.text,
        relocatedBy: "top_bar_current_visual",
        semanticArea,
        anchor,
        anchorPoint,
        visualCandidate: selected.candidate,
        visualRelocation: selected.diagnostic,
        currentVisual: currentVisual.diagnostic,
        recordedCandidateUsed,
        currentVisualRegion: currentVisual.selected.region,
        center: action,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveVisualQueryTap(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const visualKind = textParam(params.visualKind).trim().toLowerCase();
    const visualQuery = textParam(params.visualQuery).trim();
    const semanticArea = readSemanticArea(params.semanticArea) ?? "unknown";
    if (visualKind !== "icon") {
      return visualQueryFailure({
        visualKind,
        visualQuery,
        semanticArea,
        reason: "visual_grounding_unavailable",
        message: `Visual ${visualKind || "target"} queries require a visual grounding backend.`
      });
    }
    const role = visualIconRoleFromQuery(visualQuery);
    if (!role) {
      return visualQueryFailure({
        visualKind,
        visualQuery,
        semanticArea,
        reason: "visual_grounding_unavailable",
        message: `Visual icon query "${visualQuery || "unknown"}" is not covered by current standard icon recognition.`
      });
    }
    const iconStep: ActionStep = {
      ...input.step,
      params: {
        ...params,
        locatorKind: "semantic_icon_locator",
        role
      }
    };
    const outcome = await this.resolveSemanticIconTap({ ...input, step: iconStep });
    return {
      ...outcome,
      metadata: {
        ...outcome.metadata,
        type: "visual_query_locator",
        visualKind,
        visualQuery,
        role,
        semanticArea
      }
    };
  }

  private async resolveSemanticIconTap(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const semanticArea = readSemanticArea(params.semanticArea) ?? "unknown";
    const role = topBarIconRole(params).trim().toLowerCase();
    const slot = readTopBarSlot(params.slot) ?? "trailing";
    const verticalSlot = readSemanticIconVerticalSlot(params.verticalSlot ?? params.vertical);
    const hierarchyResolution = await this.resolveSemanticIconFromUiHierarchy(input, {
      role,
      semanticArea,
      slot,
      verticalSlot
    });
    if (hierarchyResolution) {
      const actionResult = normalizeActionResult(await this.performAction(input, hierarchyResolution.action));
      return {
        supported: true,
        resolved: true,
        action: hierarchyResolution.action,
        actionResult,
        message: `Resolved semantic icon "${role || slot}" from UI hierarchy.`,
        artifacts: [],
        metadata: {
          type: "semantic_icon_locator",
          action: "tap",
          ...pageTaskSemanticMetadata(params),
          role,
          slot,
          verticalSlot,
          semanticArea,
          relocatedBy: "ui_hierarchy_icon",
          recordedCandidateUsed: false,
          center: hierarchyResolution.action,
          hierarchy: {
            candidate: hierarchyResolution.candidate,
            resolvedLocator: hierarchyResolution.resolvedLocator,
            score: roundPercent(hierarchyResolution.score),
            semanticEvidence: roundPercent(hierarchyResolution.semanticEvidence),
            matchReason: hierarchyResolution.matchReason,
            candidateCount: hierarchyResolution.candidateCount
          },
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    if (semanticArea === "top") {
      const topBarOutcome = await this.resolveTopBarIconTap(input);
      const locatorKind = textParam(params.locatorKind).trim();
      const canFallbackToVisible = locatorKind === "semantic_icon_locator" && isKnownTopBarIconRole(role);
      if (topBarOutcome.resolved || !canFallbackToVisible) {
        return topBarOutcome;
      }
      return this.resolveVisibleSemanticIconTap(input, semanticArea);
    }
    if (semanticArea === "content" && role === "add") {
      return this.resolveContentIconTap(input, semanticArea);
    }
    return this.resolveVisibleSemanticIconTap(input, semanticArea);
  }

  private async resolveSemanticIconFromUiHierarchy(
    input: {
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    options: {
      role: string;
      semanticArea: VisualSemanticArea;
      slot: TopBarIconSlot;
      verticalSlot?: SemanticIconVerticalSlot;
    }
  ): Promise<UiHierarchyIconResolution | undefined> {
    if (!this.deps.dumpUiHierarchy || !options.role || !input.deviceSize) {
      return undefined;
    }
    let candidates: UiElementCandidate[];
    try {
      candidates = parseAndroidUiHierarchy(await this.deps.dumpUiHierarchy(input.serial));
    } catch {
      return undefined;
    }
    if (!candidates.length) {
      return undefined;
    }

    const scored = candidates
      .map((candidate) => {
        const score = semanticIconUiCandidateScore(candidate, {
          role: options.role,
          semanticArea: options.semanticArea,
          slot: options.slot,
          verticalSlot: options.verticalSlot,
          deviceSize: input.deviceSize!
        });
        return { candidate, ...score };
      })
      .filter((item) => item.score >= 7 && item.semanticEvidence >= 4)
      .sort((left, right) =>
        right.score - left.score ||
        right.semanticEvidence - left.semanticEvidence ||
        semanticIconVerticalSortValue(right.candidate, options.verticalSlot, input.deviceSize!)
          - semanticIconVerticalSortValue(left.candidate, options.verticalSlot, input.deviceSize!) ||
        (options.slot === "trailing"
          ? right.candidate.bounds.centerX - left.candidate.bounds.centerX
          : left.candidate.bounds.centerX - right.candidate.bounds.centerX)
      );
    const selected = scored[0];
    if (!selected) {
      return undefined;
    }

    return {
      action: {
        type: "tap",
        x: selected.candidate.bounds.centerX,
        y: selected.candidate.bounds.centerY
      },
      candidate: selected.candidate,
      resolvedLocator: locatorFromCandidate(selected.candidate, candidates),
      score: selected.score,
      semanticEvidence: selected.semanticEvidence,
      matchReason: selected.matchReason,
      candidateCount: candidates.length
    };
  }

  private async resolveVisibleSemanticIconTap(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    semanticArea: VisualSemanticArea
  ): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const role = topBarIconRole(params).trim().toLowerCase();
    const explicitSlot = readTopBarSlot(params.slot);
    const slot = explicitSlot ?? "trailing";
    const verticalSlot = readSemanticIconVerticalSlot(params.verticalSlot ?? params.vertical);
    const orderFromRight = Math.max(1, Math.floor(numberParam(params.orderFromRight) ?? 1));
    const anchorText = textParam(params.anchorText ?? params.targetText ?? params.text).trim();
    if (!input.deviceSize) {
      return semanticIconFailure(role, slot, semanticArea, "missing_device_size", "Semantic icon target requires device size.");
    }

    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    let locatorLayout: OcrLayoutResult | undefined;
    const locateScreenshotText = async (mode: "contains" | "equals" | "not_contains" = "contains"): Promise<OcrLayoutResult | undefined> => {
      if (!this.deps.ocr.locateText) {
        return undefined;
      }
      if (!locatorLayout) {
        locatorLayout = await this.deps.ocr.locateText({
          image: screenshot.png,
          mode
        });
      }
      return locatorLayout;
    };
    let anchor: TextLocatorCandidate | undefined;
    let anchorPoint: { x: number; y: number } | undefined;
    if (anchorText && this.deps.ocr.locateText) {
      const mode = tapTextMatchMode(params.mode);
      const layout = await locateScreenshotText(mode);
      anchor = layout ? findTextCandidate(layout, anchorText, {
        mode,
        semanticArea: semanticArea === "unknown" ? undefined : semanticArea,
        deviceSize: input.deviceSize
      }) : undefined;
      if (anchor && layout) {
        anchorPoint = textCandidateDevicePoint(anchor, layout, input.deviceSize);
      }
    }

    const currentVisual = await locateCurrentVisibleSemanticIconInScreenshot({
      screenshot: screenshot.png,
      role,
      semanticArea,
      slot: explicitSlot,
      verticalSlot,
      orderFromRight,
      anchorPoint,
      deviceSize: input.deviceSize,
      ocrLayout: locatorLayout ?? await locateScreenshotText().catch(() => undefined)
    });
    if (!currentVisual.selected) {
      return {
        supported: true,
        resolved: false,
        message: currentVisual.message ?? `Semantic icon "${role || slot}" could not be visually located in the current screenshot.`,
        artifacts: [screenshot.artifact],
        metadata: {
          type: "semantic_icon_locator",
          action: "fail",
          reason: currentVisual.reason,
          role,
          slot,
          verticalSlot,
          orderFromRight,
          anchorText,
          anchor,
          anchorPoint,
          semanticArea,
          currentVisual: currentVisual.diagnostic,
          recordedCandidateUsed: false
        }
      };
    }

    const action = { type: "tap", x: currentVisual.selected.point.x, y: currentVisual.selected.point.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Resolved visible icon${role ? ` "${role}"` : ""} in current screenshot.`,
      artifacts: [screenshot.artifact],
      metadata: {
        type: "semantic_icon_locator",
        action: "tap",
        ...pageTaskSemanticMetadata(params),
        role,
        slot,
        verticalSlot,
        orderFromRight,
        anchorText,
        anchor,
        anchorPoint,
        relocatedBy: "visible_icon_current_visual",
        semanticArea,
        currentVisual: currentVisual.diagnostic,
        currentVisualRegion: currentVisual.selected.region,
        center: action,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveContentIconTap(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    semanticArea: VisualSemanticArea
  ): Promise<SemanticResolutionOutcome> {
    const params = input.step.params ?? {};
    const role = topBarIconRole(params).trim().toLowerCase();
    const slot = readTopBarSlot(params.slot) ?? "trailing";
    const verticalSlot = readSemanticIconVerticalSlot(params.verticalSlot ?? params.vertical);
    if (!input.deviceSize) {
      return semanticIconFailure(role, slot, semanticArea, "missing_device_size", "Semantic icon target requires device size.");
    }
    if (semanticArea !== "content" || role !== "add") {
      return semanticIconFailure(role, slot, semanticArea, "unsupported_icon", `Semantic icon "${role}" is not supported in ${semanticArea}.`);
    }

    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    const ocrLayout = this.deps.ocr.locateText
      ? await this.deps.ocr.locateText({ image: screenshot.png, mode: "contains" }).catch(() => undefined)
      : undefined;
    const currentVisual = await locateCurrentContentAddIconInScreenshot({
      screenshot: screenshot.png,
      slot,
      verticalSlot,
      deviceSize: input.deviceSize,
      ocrLayout
    });
    if (!currentVisual.selected) {
      return {
        supported: true,
        resolved: false,
        message: "Standard floating add icon could not be visually located in the current screenshot.",
        artifacts: [screenshot.artifact],
        metadata: {
          type: "semantic_icon_locator",
          action: "fail",
          reason: "current_visual_icon_not_found",
          role,
          slot,
          verticalSlot,
          semanticArea,
          currentVisual: currentVisual.diagnostic,
          recordedCandidateUsed: false
        }
      };
    }

    const action = { type: "tap", x: currentVisual.selected.point.x, y: currentVisual.selected.point.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: "Resolved the standard floating add icon in the current screenshot.",
      artifacts: [screenshot.artifact],
      metadata: {
        type: "semantic_icon_locator",
        action: "tap",
        ...pageTaskSemanticMetadata(params),
        role,
        slot,
        verticalSlot,
        semanticArea,
        relocatedBy: "content_current_visual",
        currentVisual: currentVisual.diagnostic,
        recordedCandidateUsed: false,
        currentVisualRegion: currentVisual.selected.region,
        center: action,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveLeadingCheckboxNearText(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea
  ): Promise<SemanticResolutionOutcome | undefined> {
    const locator = readLeadingCheckboxNearTextLocator(input.step.params.structuralLocator);
    if (!locator) {
      return undefined;
    }
    if (!this.deps.ocr.locateText) {
      return {
        supported: true,
        resolved: false,
        message: "Checkbox structural locator requires OCR text layout.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "ocr_layout_unavailable",
          region,
          structuralLocator: locator
        }
      };
    }

    const artifacts: ArtifactRef[] = [];
    const before = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    artifacts.push(before.artifact);
    const layout = await this.deps.ocr.locateText({
      image: before.png,
      mode: "contains"
    });
    const anchor = findTextCandidate(layout, locator.anchorText, {
      mode: "contains",
      semanticArea,
      deviceSize: input.deviceSize
    });
    if (!anchor) {
      return {
        supported: true,
        resolved: false,
        message: `Checkbox anchor text "${locator.anchorText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "checkbox_anchor_not_found",
          region,
          structuralLocator: locator,
          semanticArea,
          actual: normalizeOcrText(layout.text) || "(empty OCR result)"
        }
      };
    }

    const anchorLeftX = scaleCoordinate(anchor.x, layout.width, input.deviceSize?.width);
    const anchorHeight = scaleCoordinate(anchor.height, layout.height, input.deviceSize?.height);
    const anchorCenter = textCandidateDevicePoint(anchor, layout, input.deviceSize);
    const checkboxOffset = Math.max(24, Math.min(56, anchorHeight * 0.65));
    const action = {
      type: "tap",
      x: Math.max(1, Math.round(anchorLeftX - checkboxOffset)),
      y: anchorCenter.y
    } satisfies DeviceActionRequest;
    const checkboxRegion = checkboxPercentRegion(action, input.deviceSize);
    const beforeTemplate = checkboxRegion
      ? await createVisualLocatorTemplate({
          screenshot: before.png,
          percentRegion: checkboxRegion,
          resolution: input.deviceSize,
          sampleSize: 16
        })
      : undefined;
    const beforeState = beforeTemplate ? checkboxVisualStateFromTemplate(beforeTemplate.pixels) : undefined;
    if (beforeState?.checked) {
      return {
        supported: true,
        resolved: true,
        message: `Checkbox near "${locator.anchorText}" is already checked.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "skip",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "checkbox_already_checked",
          region,
          semanticArea,
          relocatedBy: "near_text_checkbox",
          structuralLocator: locator,
          anchor,
          center: action,
          verification: {
            strategy: "checkbox_visual_state",
            state: "checked",
            score: beforeState.score,
            darkRatio: beforeState.darkRatio,
            meanDarkness: beforeState.meanDarkness,
            region: checkboxRegion
          }
        }
      };
    }

    const actionResult = normalizeActionResult(await this.performAction(input, action));
    await this.wait(input, positiveNumberParam(input.step.params.checkboxVerifyDelayMs, 250));
    const after = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 2);
    artifacts.push(after.artifact);
    const afterTemplate = beforeTemplate && checkboxRegion
      ? await createVisualLocatorTemplate({
          screenshot: after.png,
          percentRegion: checkboxRegion,
          resolution: input.deviceSize,
          sampleSize: 16
        })
      : undefined;
    const visualDifference = beforeTemplate && afterTemplate ? visualTemplateMeanDifference(beforeTemplate.pixels, afterTemplate.pixels) : undefined;
    const afterState = afterTemplate ? checkboxVisualStateFromTemplate(afterTemplate.pixels) : undefined;
    if (afterState && !afterState.checked) {
      return {
        supported: true,
        resolved: false,
        action,
        actionResult,
        message: `Checkbox near "${locator.anchorText}" is not checked after tap.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "checkbox_not_checked_after_tap",
          region,
          semanticArea,
          structuralLocator: locator,
          anchor,
          center: action,
          verification: {
            strategy: "checkbox_visual_state",
            beforeState,
            afterState,
            visualDifference,
            region: checkboxRegion
          },
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    if (visualDifference !== undefined && visualDifference <= 0.01) {
      return {
        supported: true,
        resolved: false,
        action,
        actionResult,
        message: `Checkbox near "${locator.anchorText}" did not visually change after tap.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "checkbox_visual_state_unchanged",
          region,
          semanticArea,
          structuralLocator: locator,
          anchor,
          center: action,
          verification: {
            strategy: "checkbox_region_visual_change",
            visualDifference,
            minDifference: 0.01,
            region: checkboxRegion
          },
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Resolved leading checkbox by OCR anchor text "${locator.anchorText}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "tap",
        ...pageTaskSemanticMetadata(input.step.params),
        region,
        semanticArea,
        relocatedBy: "near_text_checkbox",
        structuralLocator: locator,
        anchor,
        center: action,
        verification: {
          strategy: afterState ? "checkbox_visual_state" : beforeTemplate && checkboxRegion ? "checkbox_region_visual_change" : "not_available",
          beforeState,
          afterState,
          visualDifference,
          minDifference: 0.01,
          region: checkboxRegion
        },
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveRuntimeOptionSelection(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const structuralLocator = readRecord(input.step.params.structuralLocator);
    const targetText = runtimeStructuralTargetText(input.step.params);
    const selectedValue = textParam(input.step.params.selectedValue ?? input.step.params.text).trim();
    const confirmText = textParam(structuralLocator?.confirmText ?? input.step.params.confirmText).trim();
    const semanticArea = readSemanticArea(input.step.params.semanticArea) ?? "content";
    if (!targetText || !selectedValue || !this.deps.ocr.locateText || !input.deviceSize) {
      return {
        supported: true,
        resolved: false,
        message: "Runtime option selection requires opener text, selected value, OCR, and device size.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "invalid_runtime_option_selection",
          targetText,
          selectedValue,
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const artifacts: ArtifactRef[] = [];
    const openerScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    artifacts.push(openerScreenshot.artifact);
    const openerLayout = await this.deps.ocr.locateText({ image: openerScreenshot.png, mode: "contains" });
    const opener = findTextCandidate(openerLayout, targetText, {
      mode: "contains",
      semanticArea,
      deviceSize: input.deviceSize
    });
    if (!opener) {
      return {
        supported: true,
        resolved: false,
        message: `Runtime option opener "${targetText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "runtime_target_text_not_found",
          targetText,
          selectedValue,
          actual: normalizeOcrText(openerLayout.text) || "(empty OCR result)",
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const openerAction = {
      type: "tap",
      x: scaleCoordinate(opener.centerX, openerLayout.width, input.deviceSize.width),
      y: scaleCoordinate(opener.centerY, openerLayout.height, input.deviceSize.height)
    } satisfies DeviceActionRequest;
    let actionResult = normalizeActionResult(await this.performAction(input, openerAction));
    await this.wait(input, nonNegativeNumberParam(input.step.params.overlayOpenDelayMs, 350));

    const optionScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 2);
    artifacts.push(optionScreenshot.artifact);
    const optionLayout = await this.deps.ocr.locateText({ image: optionScreenshot.png, mode: "contains" });
    const option = findTextCandidate(optionLayout, selectedValue, {
      mode: textParam(structuralLocator?.optionMatchMode).trim() === "contains" ? "contains" : "equals",
      deviceSize: input.deviceSize
    });
    if (!option) {
      return {
        supported: true,
        resolved: false,
        message: `Runtime option "${selectedValue}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "runtime_option_not_found",
          targetText,
          selectedValue,
          actual: normalizeOcrText(optionLayout.text) || "(empty OCR result)",
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const optionRole = textParam(structuralLocator?.optionRole).trim();
    let optionState = "selected";
    let optionAction = {
      type: "tap",
      x: scaleCoordinate(option.centerX, optionLayout.width, input.deviceSize.width),
      y: scaleCoordinate(option.centerY, optionLayout.height, input.deviceSize.height)
    } satisfies DeviceActionRequest;
    let shouldTapOption = true;
    if (optionRole === "checkbox") {
      optionAction = {
        type: "tap",
        x: Math.round(input.deviceSize.width * (percentNumber(structuralLocator?.optionCheckboxXPercent) ?? 8) / 100),
        y: scaleCoordinate(option.centerY, optionLayout.height, input.deviceSize.height)
      };
      const checkboxRegion = checkboxPercentRegion(optionAction, input.deviceSize);
      const checkboxTemplate = checkboxRegion
        ? await createVisualLocatorTemplate({
            screenshot: optionScreenshot.png,
            percentRegion: checkboxRegion,
            resolution: input.deviceSize,
            sampleSize: 16
          })
        : undefined;
      const checkboxState = checkboxTemplate ? checkboxVisualStateFromTemplate(checkboxTemplate.pixels) : undefined;
      shouldTapOption = checkboxState?.checked !== true;
      optionState = shouldTapOption ? "checked" : "already_checked";
    }
    if (shouldTapOption) {
      actionResult = normalizeActionResult(await this.performAction(input, optionAction)) ?? actionResult;
    }
    await this.wait(input, nonNegativeNumberParam(input.step.params.optionSelectDelayMs, 200));

    let confirmCandidate: TextLocatorCandidate | undefined;
    let confirmAction: DeviceActionRequest | undefined;
    if (confirmText) {
      const confirmScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 3);
      artifacts.push(confirmScreenshot.artifact);
      const confirmLayout = await this.deps.ocr.locateText({ image: confirmScreenshot.png, mode: "contains" });
      confirmCandidate = findTextCandidate(confirmLayout, confirmText, {
        mode: "equals",
        deviceSize: input.deviceSize
      });
      if (!confirmCandidate) {
        return {
          supported: true,
          resolved: false,
          message: `Runtime option confirmation "${confirmText}" was not found.`,
          artifacts,
          metadata: {
            type: "image_region",
            action: "fail",
            reason: "runtime_option_confirm_not_found",
            targetText,
            selectedValue,
            confirmText,
            ...pageTaskSemanticMetadata(input.step.params)
          }
        };
      }
      confirmAction = {
        type: "tap",
        x: scaleCoordinate(confirmCandidate.centerX, confirmLayout.width, input.deviceSize.width),
        y: scaleCoordinate(confirmCandidate.centerY, confirmLayout.height, input.deviceSize.height)
      } satisfies DeviceActionRequest;
      actionResult = normalizeActionResult(await this.performAction(input, confirmAction)) ?? actionResult;
    }
    return {
      supported: true,
      resolved: true,
      action: confirmAction ?? optionAction,
      actionResult,
      message: `Selected runtime option "${option.text}"${confirmText ? " and confirmed it" : ""}.`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "subpage_edit",
        ...pageTaskSemanticMetadata(input.step.params),
        targetText,
        selectedValue,
        selectedBy: "ocr_option",
        optionState,
        selectedLocator: option,
        ...(confirmCandidate ? { confirmedBy: confirmCandidate.text, confirmCenter: confirmAction } : {}),
        semanticArea,
        structuralLocator,
        opener: openerAction,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveRuntimeStructuralTap(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const semanticArea = readSemanticArea(input.step.params.semanticArea) ?? "content";
    const checkboxLocator = readLeadingCheckboxNearTextLocator(input.step.params.structuralLocator);
    if (checkboxLocator) {
      const outcome = await this.resolveLeadingCheckboxNearText(input, defaultRuntimeSearchRegion(semanticArea), semanticArea);
      return outcome ?? {
        supported: true,
        resolved: false,
        message: "Runtime checkbox locator could not be resolved.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "runtime_checkbox_locator_unresolved",
          semanticArea,
          structuralLocator: checkboxLocator,
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const targetText = runtimeStructuralTargetText(input.step.params);
    if (!targetText) {
      return {
        supported: true,
        resolved: false,
        message: "Runtime structural tap requires targetText or structuralLocator.text.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "missing_runtime_target_text",
          semanticArea,
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    if (!this.deps.ocr.locateText) {
      return {
        supported: true,
        resolved: false,
        message: "Runtime structural tap requires OCR text layout.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "ocr_layout_unavailable",
          targetText,
          semanticArea,
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const mode = tapTextMatchMode(input.step.params.mode);
    const artifacts: ArtifactRef[] = [];
    const revealSettings = runtimeInputRevealSettings(input.step.params, semanticArea);
    let layout: OcrLayoutResult | undefined;
    let candidate: TextLocatorCandidate | undefined;
    let revealSwipes = 0;
    for (let attempt = 1; attempt <= (revealSettings?.maxSwipes ?? 0) + 1; attempt += 1) {
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      layout = await this.deps.ocr.locateText({ image: screenshot.png, mode });
      candidate = findTextCandidate(layout, targetText, {
        mode,
        semanticArea,
        deviceSize: input.deviceSize
      });
      if (candidate || !revealSettings || revealSwipes >= revealSettings.maxSwipes) {
        break;
      }
      await this.performAction(input, scrollSwipeAction("up", input.deviceSize));
      revealSwipes += 1;
      if (revealSettings.intervalMs > 0) {
        await this.wait(input, revealSettings.intervalMs);
      }
    }
    if (!candidate) {
      return {
        supported: true,
        resolved: false,
        message: `Runtime structural tap target "${targetText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          reason: "runtime_target_text_not_found",
          targetText,
          actual: normalizeOcrText(layout?.text ?? "") || "(empty OCR result)",
          semanticArea,
          ...(revealSettings ? { revealAttempted: { strategy: "scroll_to_top", swipes: revealSwipes } } : {}),
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }
    const action = {
      type: "tap",
      x: scaleCoordinate(candidate.centerX, layout!.width, input.deviceSize?.width),
      y: scaleCoordinate(candidate.centerY, layout!.height, input.deviceSize?.height)
    } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Relocated runtime structural target by OCR text "${candidate.text}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "tap",
        ...pageTaskSemanticMetadata(input.step.params),
        targetText,
        actual: candidate.text,
        relocatedBy: revealSwipes ? "runtime_ocr_text_after_reveal" : "runtime_ocr_text",
        semanticArea,
        structuralLocator: readRecord(input.step.params.structuralLocator),
        center: action,
        ...(revealSettings ? { reveal: { strategy: "scroll_to_top", swipes: revealSwipes } } : {}),
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveVisualTemplateRegion(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea
  ): Promise<{
    selected?: {
      point: { x: number; y: number };
      template: Record<string, unknown>;
    };
    diagnostic?: Record<string, unknown>;
    artifacts: ArtifactRef[];
  } | undefined> {
    const visualLocator = readRecord(input.step.params.visualLocator);
    if (!visualLocator?.template) {
      return undefined;
    }
    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 1);
    const result = await locateVisualTemplateInScreenshot({
      screenshot: screenshot.png,
      template: visualLocator.template,
      percentRegion: region,
      resolution: input.deviceSize,
      minSimilarity: numberParam(visualLocator.minTemplateSimilarity) ?? numberParam(visualLocator.minSimilarity)
    });
    const point = result.selected ? regionPoint(result.selected.region, input.deviceSize) : undefined;
    return {
      selected: point && result.selected
        ? {
            point,
            template: {
              hash: result.diagnostic.templateHash,
              similarity: result.selected.similarity,
              region: result.selected.region,
              semanticArea
            }
          }
        : undefined,
      diagnostic: result.diagnostic,
      artifacts: [screenshot.artifact]
    };
  }

  private async resolveTrailingSwitchSet(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const locator = readTrailingSwitchLocator(input.step.params);
    const desiredState = normalizeToggleState(input.step.params.desiredState);
    const locateText = this.deps.ocr.locateText?.bind(this.deps.ocr);
    if (!locator || !desiredState || !locateText || !input.deviceSize) {
      return {
        supported: true,
        resolved: false,
        message: "Trailing switch requires OCR, device size, anchor text, and desired state.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "invalid_trailing_switch_locator"
        }
      };
    }

    const artifacts: ArtifactRef[] = [];
    let captureAttempt = 0;
    const captureLayout = async (): Promise<{ screenshot: ScreenshotCapture; layout: OcrLayoutResult }> => {
      captureAttempt += 1;
      const screenshot = await this.deps.captureLocatorScreenshot(
        input.runId,
        input.stepResultId,
        input.serial,
        input.step.id,
        captureAttempt
      );
      artifacts.push(screenshot.artifact);
      const layout = await locateText({ image: screenshot.png, mode: "contains" });
      return { screenshot, layout };
    };
    const findAnchor = (layout: OcrLayoutResult): TextLocatorCandidate | undefined => findTrailingSwitchAnchorCandidate(layout, locator.anchorText, {
      semanticArea: readSemanticArea(input.step.params.semanticArea) ?? "content",
      deviceSize: input.deviceSize
    });
    let current = await captureLayout();
    let anchor = findAnchor(current.layout);
    let restoreSwipes = 0;
    let searchSwipes = 0;
    if (!anchor && locator.revealStrategy === "search_content") {
      let previousSignature = ocrLayoutViewportSignature(current.layout);
      for (let index = 0; index < locator.restoreMaxSwipes && !anchor; index += 1) {
        await this.performAction(input, scrollSwipeAction("up", input.deviceSize));
        restoreSwipes += 1;
        if (locator.revealIntervalMs > 0) {
          await this.wait(input, locator.revealIntervalMs);
        }
        current = await captureLayout();
        anchor = findAnchor(current.layout);
        const signature = ocrLayoutViewportSignature(current.layout);
        if (anchor || signature === previousSignature) {
          break;
        }
        previousSignature = signature;
      }
      previousSignature = ocrLayoutViewportSignature(current.layout);
      for (let index = 0; index < locator.searchMaxSwipes && !anchor; index += 1) {
        await this.performAction(input, scrollSwipeAction("down", input.deviceSize));
        searchSwipes += 1;
        if (locator.revealIntervalMs > 0) {
          await this.wait(input, locator.revealIntervalMs);
        }
        current = await captureLayout();
        anchor = findAnchor(current.layout);
        const signature = ocrLayoutViewportSignature(current.layout);
        if (anchor || signature === previousSignature) {
          break;
        }
        previousSignature = signature;
      }
    }
    if (!anchor) {
      return {
        supported: true,
        resolved: false,
        message: `Trailing switch anchor "${locator.anchorText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "switch_anchor_not_found",
          structuralLocator: locator,
          actual: normalizeOcrText(current.layout.text) || "(empty OCR result)",
          ...(locator.revealStrategy === "search_content"
            ? { reveal: { strategy: "search_content", restoreSwipes, searchSwipes } }
            : {})
        }
      };
    }

    const anchorPoint = textCandidateDevicePoint(anchor, current.layout, input.deviceSize);
    const action = {
      type: "tap",
      x: Math.round(input.deviceSize.width * locator.controlCenterXPercent / 100),
      y: anchorPoint.y
    } satisfies DeviceActionRequest;
    const controlRegion = {
      x: Math.max(0, locator.controlCenterXPercent - locator.controlWidthPercent / 2),
      y: Math.max(0, (action.y / input.deviceSize.height) * 100 - locator.controlHeightPercent / 2),
      width: locator.controlWidthPercent,
      height: locator.controlHeightPercent
    };
    const beforeTemplate = await createVisualLocatorTemplate({
      screenshot: current.screenshot.png,
      percentRegion: controlRegion,
      resolution: input.deviceSize,
      sampleSize: 20
    });
    const currentState = beforeTemplate ? trailingSwitchStateFromTemplate(beforeTemplate) : "unknown";
    if (currentState === desiredState) {
      return {
        supported: true,
        resolved: true,
        message: `Switch near "${locator.anchorText}" is already ${desiredState}.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "toggle_set",
          ...pageTaskSemanticMetadata(input.step.params),
          relocatedBy: restoreSwipes || searchSwipes ? "ocr_trailing_switch_after_content_search" : "ocr_trailing_switch",
          structuralLocator: locator,
          anchor,
          center: action,
          controlRegion,
          currentState,
          desiredState,
          verifiedState: currentState,
          changed: false,
          ...(locator.revealStrategy === "search_content"
            ? { reveal: { strategy: "search_content", restoreSwipes, searchSwipes } }
            : {})
        }
      };
    }
    if (currentState === "unknown" && desiredState === "off") {
      return {
        supported: true,
        resolved: true,
        message: "Switch state is unknown; skipped off request to avoid enabling it.",
        artifacts,
        metadata: {
          type: "image_region",
          action: "toggle_set",
          ...pageTaskSemanticMetadata(input.step.params),
          relocatedBy: restoreSwipes || searchSwipes ? "ocr_trailing_switch_after_content_search" : "ocr_trailing_switch",
          structuralLocator: locator,
          anchor,
          center: action,
          controlRegion,
          currentState,
          desiredState,
          verifiedState: "unknown",
          changed: false,
          reason: "safe_skip_unknown_state",
          ...(locator.revealStrategy === "search_content"
            ? { reveal: { strategy: "search_content", restoreSwipes, searchSwipes } }
            : {})
        }
      };
    }

    const actionResult = normalizeActionResult(await this.performAction(input, action));
    await this.wait(input, nonNegativeNumberParam(input.step.params.toggleVerifyDelayMs, 250));
    captureAttempt += 1;
    const after = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, captureAttempt);
    artifacts.push(after.artifact);
    const afterTemplate = await createVisualLocatorTemplate({
      screenshot: after.png,
      percentRegion: controlRegion,
      resolution: input.deviceSize,
      sampleSize: 20
    });
    const verifiedState = afterTemplate ? trailingSwitchStateFromTemplate(afterTemplate) : "unknown";
    if (verifiedState !== desiredState) {
      return {
        supported: true,
        resolved: false,
        action,
        actionResult,
        message: `Switch near "${locator.anchorText}" did not reach ${desiredState}.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "toggle_state_not_verified",
          relocatedBy: restoreSwipes || searchSwipes ? "ocr_trailing_switch_after_content_search" : "ocr_trailing_switch",
          structuralLocator: locator,
          anchor,
          center: action,
          controlRegion,
          currentState,
          desiredState,
          verifiedState,
          driverChannel: actionResult?.driverChannel,
          ...(locator.revealStrategy === "search_content"
            ? { reveal: { strategy: "search_content", restoreSwipes, searchSwipes } }
            : {})
        }
      };
    }
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Set switch near "${locator.anchorText}" to ${desiredState}.`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "toggle_set",
        ...pageTaskSemanticMetadata(input.step.params),
        relocatedBy: restoreSwipes || searchSwipes ? "ocr_trailing_switch_after_content_search" : "ocr_trailing_switch",
        structuralLocator: locator,
        anchor,
        center: action,
        controlRegion,
        currentState,
        desiredState,
        verifiedState,
        changed: true,
        driverChannel: actionResult?.driverChannel,
        ...(locator.revealStrategy === "search_content"
          ? { reveal: { strategy: "search_content", restoreSwipes, searchSwipes } }
          : {})
      }
    };
  }

  private async resolveRuntimeStructuralPicker(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const structuralLocator = readRecord(input.step.params.structuralLocator);
    const targetText = runtimeStructuralTargetText(input.step.params);
    const semanticArea = readSemanticArea(input.step.params.semanticArea) ?? "content";
    const selectedValue = textParam(input.step.params.selectedValue ?? input.step.params.text).trim();
    const locateText = this.deps.ocr.locateText?.bind(this.deps.ocr);
    if (!targetText || !selectedValue || !locateText || !input.deviceSize) {
      return {
        supported: true,
        resolved: false,
        message: "Runtime structural picker requires OCR target text, selected value, and device size.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "invalid_runtime_picker_locator"
        }
      };
    }
    const artifacts: ArtifactRef[] = [];
    const revealSettings = runtimeInputRevealSettings(input.step.params, semanticArea);
    let opener: { x: number; y: number } | undefined;
    let openerRelocatedBy = "runtime_ocr_text";
    let revealSwipes = 0;
    let resetSwipes = 0;
    let scanSwipes = 0;
    let reachedBoundary = false;
    let previousSignature: string | undefined;
    let captureAttempt = 0;
    const locateOpener = async (): Promise<{ found: boolean; signature: string }> => {
      captureAttempt += 1;
      const attempt = captureAttempt;
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      const layout = await locateText({ image: screenshot.png, mode: "contains" });
      const signature = textSearchLayoutSignature(layout, semanticArea, input.deviceSize);
      let candidate = findTextCandidate(layout, targetText, {
        mode: "contains",
        semanticArea,
        deviceSize: input.deviceSize
      });
      const allowsBottomContent = structuralLocator?.allowBottomContent === true && semanticArea === "content";
      if (!candidate && allowsBottomContent) {
        candidate = findTextCandidate(layout, targetText, {
          mode: "contains",
          semanticArea: "bottom",
          deviceSize: input.deviceSize
        });
      }
      if (candidate) {
        opener = textCandidateDevicePoint(candidate, layout, input.deviceSize);
        openerRelocatedBy = allowsBottomContent && textCandidateSemanticArea(candidate, layout, input.deviceSize) === "bottom"
          ? (revealSwipes ? "runtime_ocr_text_bottom_content_after_reveal" : "runtime_ocr_text_bottom_content")
          : (revealSwipes ? "runtime_ocr_text_after_reveal" : "runtime_ocr_text");
        return { found: true, signature };
      }
      return { found: false, signature };
    };
    const currentViewAttempts = revealSettings?.strategy === "bounded_search"
      ? 1
      : Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.locatorReadAttempts, 2)));
    for (let attempt = 0; attempt < currentViewAttempts; attempt += 1) {
      const located = await locateOpener();
      previousSignature = located.signature;
      if (located.found) {
        break;
      }
    }
    if (!opener && revealSettings?.strategy === "bounded_search") {
      if (revealSettings.resetToTop && revealSettings.direction !== "up") {
        for (let swipe = 0; swipe < revealSettings.maxSwipes; swipe += 1) {
          await this.performAction(input, scrollSwipeAction("up", input.deviceSize));
          resetSwipes += 1;
          if (revealSettings.intervalMs > 0) {
            await this.wait(input, revealSettings.intervalMs);
          }
          const located = await locateOpener();
          if (located.found) break;
          if (previousSignature && located.signature === previousSignature) {
            reachedBoundary = true;
            break;
          }
          previousSignature = located.signature;
        }
      }
      if (!opener) {
        reachedBoundary = false;
        const direction = revealSettings.direction === "up" ? "up" : "down";
        for (let swipe = 0; swipe < revealSettings.maxSwipes; swipe += 1) {
          await this.performAction(input, scrollSwipeAction(direction, input.deviceSize));
          scanSwipes += 1;
          if (revealSettings.intervalMs > 0) {
            await this.wait(input, revealSettings.intervalMs);
          }
          const located = await locateOpener();
          if (located.found) break;
          if (previousSignature && located.signature === previousSignature) {
            reachedBoundary = true;
            break;
          }
          previousSignature = located.signature;
        }
      }
      if (opener) {
        openerRelocatedBy = "runtime_ocr_text_after_search";
      }
    } else {
      while (!opener && revealSettings && revealSwipes < revealSettings.maxSwipes) {
        await this.performAction(input, scrollSwipeAction("up", input.deviceSize));
        revealSwipes += 1;
        if (revealSettings.intervalMs > 0) {
          await this.wait(input, revealSettings.intervalMs);
        }
        await locateOpener();
      }
    }
    const searchMetadata = revealSettings?.strategy === "bounded_search"
      ? {
          search: {
            mode: revealSettings.mode,
            direction: revealSettings.direction,
            resetToTop: revealSettings.resetToTop,
            maxSwipes: revealSettings.maxSwipes,
            resetSwipes,
            scanSwipes,
            reachedBoundary
          }
        }
      : {};
    if (!opener) {
      return {
        supported: true,
        resolved: false,
        message: `Runtime picker row "${targetText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "runtime_target_text_not_found",
          targetText,
          revealSwipes,
          ...searchMetadata,
          structuralLocator
        }
      };
    }
    const pickerMode = textParam(structuralLocator?.pickerMode).trim();
    const outcome = pickerMode === "duration_hours_minutes"
      ? await this.resolveDurationHoursMinutesPicker(input, defaultRuntimeSearchRegion(semanticArea), semanticArea, opener, selectedValue)
      : pickerMode === "date_time"
        ? await this.resolveDateTimePicker(input, defaultRuntimeSearchRegion(semanticArea), semanticArea, opener, selectedValue)
        : await this.resolvePickerSelectFromImageRegion(input, defaultRuntimeSearchRegion(semanticArea), semanticArea, opener);
    return {
      ...outcome,
      artifacts: [...artifacts, ...outcome.artifacts],
      metadata: {
        ...outcome.metadata,
        openerRelocatedBy,
        targetText,
        revealSwipes,
        ...searchMetadata,
        structuralLocator
      }
    };
  }

  private async resolveToggleSetFromImageRegion(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea,
    center: { x: number; y: number }
  ): Promise<SemanticResolutionOutcome | undefined> {
    const desiredState = normalizeToggleState(input.step.params.desiredState);
    if (!desiredState) {
      return undefined;
    }
    const currentState = normalizeToggleState(input.step.params.currentState);
    if (currentState && currentState === desiredState) {
      return {
        supported: true,
        resolved: true,
        message: `Switch is already ${desiredState}.`,
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "toggle_set",
          ...pageTaskSemanticMetadata(input.step.params),
          region,
          semanticArea,
          center,
          desiredState,
          currentState,
          changed: false
        }
      };
    }
    if (!currentState && desiredState === "off") {
      return {
        supported: true,
        resolved: true,
        message: "Switch current state is unknown; skipped off request to avoid turning it on.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "toggle_set",
          ...pageTaskSemanticMetadata(input.step.params),
          region,
          semanticArea,
          center,
          desiredState,
          currentState: "unknown",
          changed: false,
          reason: "safe_skip_unknown_state"
        }
      };
    }
    const action = { type: "tap", x: center.x, y: center.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.performAction(input, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Tapped switch to set ${desiredState}.`,
      artifacts: [],
      metadata: {
        type: "image_region",
        action: "toggle_set",
        ...pageTaskSemanticMetadata(input.step.params),
        region,
        semanticArea,
        center,
        desiredState,
        ...(currentState ? { currentState } : {}),
        changed: true,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolvePickerSelectFromImageRegion(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea,
    opener: { x: number; y: number }
  ): Promise<SemanticResolutionOutcome> {
    const selectedValue = textParam(input.step.params.selectedValue ?? input.step.params.text).trim();
    if (!selectedValue) {
      return {
        supported: true,
        resolved: false,
        message: "picker_select requires params.selectedValue.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "missing_selected_value",
          region
        }
      };
    }
    if (!this.deps.ocr.locateText) {
      return {
        supported: false,
        resolved: false,
        message: "OCR layout locator is unavailable.",
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "unsupported",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "ocr_layout_unavailable",
          region
        }
      };
    }

    const structuralLocator = readRecord(input.step.params.structuralLocator);
    if (textParam(structuralLocator?.pickerMode).trim() === "duration_hours_minutes") {
      return this.resolveDurationHoursMinutesPicker(input, region, semanticArea, opener, selectedValue);
    }
    if (textParam(structuralLocator?.pickerMode).trim() === "single_wheel") {
      return this.resolveSingleWheelPicker(input, region, semanticArea, opener, selectedValue);
    }

    const artifacts: ArtifactRef[] = [];
    let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: opener.x, y: opener.y }));
    await this.wait(input, positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));

    const mode = tapTextMatchMode(input.step.params.mode);
    const maxSwipes = Math.max(0, Math.floor(nonNegativeNumberParam(input.step.params.pickerMaxSwipes, 3)));
    const intervalMs = positiveNumberParam(input.step.params.pickerScrollIntervalMs, 250);
    const direction = scrollDirectionParam(input.step.params.pickerScrollDirection) ?? "up";
    let selectedCandidate: TextLocatorCandidate | undefined;
    let selectedLayout: OcrLayoutResult | undefined;
    let selectedAttempt = 0;
    let swipes = 0;
    for (let attempt = 1; attempt <= maxSwipes + 1; attempt += 1) {
      selectedAttempt = attempt;
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      selectedLayout = await this.deps.ocr.locateText({
        image: screenshot.png,
        mode
      });
      selectedCandidate = findPickerValueCandidate(selectedLayout, selectedValue, {
        mode,
        deviceSize: input.deviceSize
      });
      if (selectedCandidate) {
        break;
      }
      if (swipes >= maxSwipes) {
        break;
      }
      await this.performAction(input, scrollSwipeAction(direction, input.deviceSize));
      swipes += 1;
      await this.wait(input, intervalMs);
    }

    if (!selectedCandidate || !selectedLayout) {
      return {
        supported: true,
        resolved: false,
        message: `Picker value "${selectedValue}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_value_not_found",
          selectedValue,
          attempts: selectedAttempt,
          swipes,
          region,
          actual: normalizeOcrText(selectedLayout?.text ?? "") || "(empty OCR result)"
        }
      };
    }

    const selectAction = {
      type: "tap",
      x: scaleCoordinate(selectedCandidate.centerX, selectedLayout.width, input.deviceSize?.width),
      y: scaleCoordinate(selectedCandidate.centerY, selectedLayout.height, input.deviceSize?.height)
    } satisfies DeviceActionRequest;
    actionResult = normalizeActionResult(await this.performAction(input, selectAction)) ?? actionResult;
    await this.wait(input, positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));

    const confirmText = textParam(input.step.params.confirmText).trim() || "确定";
    let confirmCandidate: TextLocatorCandidate | undefined;
    let confirmAction: DeviceActionRequest | undefined;
    if (confirmText) {
      const confirmScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, selectedAttempt + 1);
      artifacts.push(confirmScreenshot.artifact);
      const confirmLayout = await this.deps.ocr.locateText({
        image: confirmScreenshot.png,
        mode: "contains"
      });
      confirmCandidate = findTextCandidate(confirmLayout, confirmText, {
        mode: "contains",
        deviceSize: input.deviceSize
      });
      if (confirmCandidate) {
        confirmAction = {
          type: "tap",
          x: scaleCoordinate(confirmCandidate.centerX, confirmLayout.width, input.deviceSize?.width),
          y: scaleCoordinate(confirmCandidate.centerY, confirmLayout.height, input.deviceSize?.height)
        } satisfies DeviceActionRequest;
        actionResult = normalizeActionResult(await this.performAction(input, confirmAction)) ?? actionResult;
      }
    }

    return {
      supported: true,
      resolved: true,
      action: selectAction,
      actionResult,
      message: `Selected picker value "${selectedCandidate.text}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "picker_select",
        ...pageTaskSemanticMetadata(input.step.params),
        region,
        semanticArea,
        opener,
        selectedValue,
        actual: selectedCandidate.text,
        selectedLocator: selectedCandidate,
        selectedCenter: selectAction,
        attempts: selectedAttempt,
        swipes,
        ...(confirmText ? { confirmText } : {}),
        ...(confirmCandidate ? { confirmedBy: confirmCandidate.text, confirmCenter: confirmAction } : {}),
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveSingleWheelPicker(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea,
    opener: { x: number; y: number },
    selectedValue: string
  ): Promise<SemanticResolutionOutcome> {
    const artifacts: ArtifactRef[] = [];
    let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: opener.x, y: opener.y }));
    await this.wait(input, positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
    const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.pickerMaxSwipes, 16)));
    const intervalMs = nonNegativeNumberParam(input.step.params.pickerScrollIntervalMs, 250);
    const maxReadAttempts = Math.max(1, Math.floor(positiveNumberParam(input.step.params.pickerReadAttempts, 2)));
    let attempt = 0;
    let swipes = 0;
    let pickerReadRetries = 0;
    let selectedCandidate: TextLocatorCandidate | undefined;
    for (let index = 0; index <= maxSwipes; index += 1) {
      let layout: OcrLayoutResult | undefined;
      let candidates: TextLocatorCandidate[] = [];
      for (let readAttempt = 0; readAttempt < maxReadAttempts; readAttempt += 1) {
        attempt += 1;
        const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
        artifacts.push(screenshot.artifact);
        const capturedLayout = await this.deps.ocr.locateText!({ image: screenshot.png, mode: "contains" });
        layout = capturedLayout;
        candidates = capturedLayout.boxes
          .map((box) => toCandidate(box))
          .filter((candidate) => candidate.centerY >= capturedLayout.height * 0.55);
        if (candidates.length || readAttempt + 1 >= maxReadAttempts) {
          break;
        }
        pickerReadRetries += 1;
        if (intervalMs > 0) {
          await this.wait(input, intervalMs);
        }
      }
      if (!layout) {
        continue;
      }
      const selectedCenterY = pickerSelectedCenterY(layout);
      const target = candidates
        .filter((candidate) => compactPickerText(candidate.text) === compactPickerText(selectedValue))
        .sort((left, right) => Math.abs(left.centerY - selectedCenterY) - Math.abs(right.centerY - selectedCenterY))[0];
      if (target && Math.abs(target.centerY - selectedCenterY) <= layout.height * 0.12) {
        selectedCandidate = target;
        break;
      }
      if (index >= maxSwipes || !candidates.length) {
        break;
      }
      const current = candidates
        .slice()
        .sort((left, right) => Math.abs(left.centerY - selectedCenterY) - Math.abs(right.centerY - selectedCenterY))[0]!;
      const targetNumber = pickerComparableNumber(selectedValue);
      const currentNumber = pickerComparableNumber(current.text);
      const direction = target
        ? target.centerY > selectedCenterY ? "increase" : "decrease"
        : targetNumber !== undefined && currentNumber !== undefined && targetNumber < currentNumber
          ? "decrease"
          : "increase";
      actionResult = normalizeActionResult(await this.performAction(
        input,
        pickerColumnSwipeAction(50, direction, input.deviceSize)
      )) ?? actionResult;
      swipes += 1;
      if (intervalMs > 0) {
        await this.wait(input, intervalMs);
      }
    }
    if (!selectedCandidate) {
      return {
        supported: true,
        resolved: false,
        message: `Single-wheel picker value "${selectedValue}" was not found on the selection line.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_value_not_found",
          pickerMode: "single_wheel",
          selectedValue,
          swipes,
          pickerReadRetries,
          region
        }
      };
    }
    attempt += 1;
    const confirmScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
    artifacts.push(confirmScreenshot.artifact);
    const confirmLayout = await this.deps.ocr.locateText!({ image: confirmScreenshot.png, mode: "contains" });
    const confirmText = textParam(input.step.params.confirmText).trim() || "确定";
    const confirmCandidate = findTextCandidate(confirmLayout, confirmText, { mode: "contains", deviceSize: input.deviceSize });
    if (!confirmCandidate) {
      return {
        supported: true,
        resolved: false,
        message: `Picker confirmation "${confirmText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_confirm_not_found",
          pickerMode: "single_wheel",
          selectedValue
        }
      };
    }
    const confirmAction = {
      type: "tap",
      x: scaleCoordinate(confirmCandidate.centerX, confirmLayout.width, input.deviceSize?.width),
      y: scaleCoordinate(confirmCandidate.centerY, confirmLayout.height, input.deviceSize?.height)
    } satisfies DeviceActionRequest;
    actionResult = normalizeActionResult(await this.performAction(input, confirmAction)) ?? actionResult;
    await this.wait(input, positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));
    return {
      supported: true,
      resolved: true,
      action: confirmAction,
      actionResult,
      message: `Selected single-wheel picker value "${selectedValue}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "picker_select",
        ...pageTaskSemanticMetadata(input.step.params),
        pickerMode: "single_wheel",
        selectedValue,
        selectedBy: "wheel_center",
        selectedLocator: selectedCandidate,
        confirmedBy: confirmCandidate.text,
        swipes,
        pickerReadRetries,
        region,
        semanticArea,
        opener,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveDateTimePicker(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea,
    opener: { x: number; y: number },
    selectedValue: string
  ): Promise<SemanticResolutionOutcome> {
    const dateTime = parseDateTimePickerValue(selectedValue);
    if (!dateTime) {
      return {
        supported: true,
        resolved: false,
        message: `Date-time picker value "${selectedValue}" is invalid.`,
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "invalid_date_time_picker_value",
          pickerMode: "date_time",
          selectedValue,
          acceptedFormats: ["current", "YYYY-MM-DD HH:mm"]
        }
      };
    }

    const artifacts: ArtifactRef[] = [];
    let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: opener.x, y: opener.y }));
    await this.wait(input, positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
    let attempt = 0;
    const captureLayout = async (): Promise<OcrLayoutResult> => {
      attempt += 1;
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      return this.deps.ocr.locateText!({ image: screenshot.png, mode: "contains" });
    };

    if (dateTime === "current") {
      const layout = await captureLayout();
      const shortcut = findTextCandidate(layout, "选择当前时间", {
        mode: "contains",
        deviceSize: input.deviceSize
      });
      if (!shortcut) {
        return {
          supported: true,
          resolved: false,
          message: "Current-time shortcut was not found in the date-time picker.",
          artifacts,
          metadata: {
            type: "image_region",
            action: "fail",
            ...pageTaskSemanticMetadata(input.step.params),
            reason: "current_time_shortcut_not_found",
            pickerMode: "date_time",
            selectedValue,
            actual: normalizeOcrText(layout.text) || "(empty OCR result)"
          }
        };
      }
      const shortcutAction = {
        type: "tap",
        x: scaleCoordinate(shortcut.centerX, layout.width, input.deviceSize?.width),
        y: scaleCoordinate(shortcut.centerY, layout.height, input.deviceSize?.height)
      } satisfies DeviceActionRequest;
      actionResult = normalizeActionResult(await this.performAction(input, shortcutAction)) ?? actionResult;
      return {
        supported: true,
        resolved: true,
        action: shortcutAction,
        actionResult,
        message: "Selected the current time shortcut.",
        artifacts,
        metadata: {
          type: "image_region",
          action: "picker_select",
          ...pageTaskSemanticMetadata(input.step.params),
          pickerMode: "date_time",
          selectedValue,
          selectedBy: "current_time_shortcut",
          selectedLocator: shortcut,
          semanticArea,
          region,
          opener,
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.pickerMaxSwipes, 24)));
    const intervalMs = nonNegativeNumberParam(input.step.params.pickerScrollIntervalMs, 250);
    let totalSwipes = 0;
    const selectedParts: string[] = [];
    const selectColumn = async (
      column: "date" | "hours" | "minutes",
      target: string | number,
      centerXPercent: number
    ): Promise<boolean> => {
      const result = await selectWheelPickerColumn<string | number>({
        target,
        centerXPercent,
        maxSwipes,
        intervalMs,
        deviceSize: input.deviceSize,
        captureLayout,
        readCandidates: (layout, columnCenterXPercent) => column === "date"
          ? pickerDateCandidates(layout, columnCenterXPercent)
          : pickerPlainNumberCandidates(layout, columnCenterXPercent),
        compare: (expected, current) => column === "date"
          ? String(expected).localeCompare(String(current))
          : Number(expected) - Number(current),
        formatSelectedPart: (value) => String(value),
        performAction: async (action) => normalizeActionResult(await this.performAction(input, action)),
        wait: (ms) => this.wait(input, ms)
      });
      actionResult = result.actionResult ?? actionResult;
      totalSwipes += result.swipes;
      if (result.selected && result.selectedPart) {
        selectedParts.push(result.selectedPart);
        return true;
      }
      return false;
    };

    const dateSelected = await selectColumn("date", dateTime.date, 27);
    const hoursSelected = dateSelected && await selectColumn("hours", dateTime.hours, 69);
    const minutesSelected = hoursSelected && await selectColumn("minutes", dateTime.minutes, 89);
    if (!dateSelected || !hoursSelected || !minutesSelected) {
      return {
        supported: true,
        resolved: false,
        message: `Date-time picker value "${selectedValue}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_value_not_found",
          pickerMode: "date_time",
          selectedValue,
          selectedParts,
          attempts: attempt,
          swipes: totalSwipes,
          region
        }
      };
    }

    const confirmText = textParam(input.step.params.confirmText).trim() || "确定";
    const confirmLayout = await captureLayout();
    const confirmCandidate = findTextCandidate(confirmLayout, confirmText, {
      mode: "contains",
      deviceSize: input.deviceSize
    });
    if (!confirmCandidate) {
      return {
        supported: true,
        resolved: false,
        message: `Picker confirmation "${confirmText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_confirm_not_found",
          pickerMode: "date_time",
          selectedValue,
          selectedParts
        }
      };
    }
    const confirmAction = {
      type: "tap",
      x: scaleCoordinate(confirmCandidate.centerX, confirmLayout.width, input.deviceSize?.width),
      y: scaleCoordinate(confirmCandidate.centerY, confirmLayout.height, input.deviceSize?.height)
    } satisfies DeviceActionRequest;
    actionResult = normalizeActionResult(await this.performAction(input, confirmAction)) ?? actionResult;
    await this.wait(input, positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));
    return {
      supported: true,
      resolved: true,
      action: confirmAction,
      actionResult,
      message: `Selected date and time "${selectedValue}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "picker_select",
        ...pageTaskSemanticMetadata(input.step.params),
        pickerMode: "date_time",
        selectedValue,
        selectedParts,
        swipes: totalSwipes,
        confirmedBy: confirmCandidate.text,
        semanticArea,
        region,
        opener,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveDurationHoursMinutesPicker(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number },
    semanticArea: VisualSemanticArea,
    opener: { x: number; y: number },
    selectedValue: string
  ): Promise<SemanticResolutionOutcome> {
    const duration = parseDurationPickerValue(selectedValue);
    if (!duration) {
      return {
        supported: true,
        resolved: false,
        message: `Duration picker value "${selectedValue}" is invalid.`,
        artifacts: [],
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "invalid_duration_picker_value",
          selectedValue,
          region
        }
      };
    }

    const artifacts: ArtifactRef[] = [];
    let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: opener.x, y: opener.y }));
    await this.wait(input, positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
    const expectedSelectedValue = formatDurationPickerValue(duration);
    const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.pickerMaxSwipes, 16)));
    const intervalMs = nonNegativeNumberParam(input.step.params.pickerScrollIntervalMs, 250);
    let attempt = 0;
    let totalSwipes = 0;
    const selectedParts: string[] = [];
    let failureReason = "picker_value_not_found";
    let stalledAt: string | undefined;

    const selectColumn = async (column: "hours" | "minutes", target: number): Promise<boolean> => {
      const unit = column === "hours" ? "小时" : "分钟";
      const centerXPercent = column === "hours" ? 25 : 75;
      const result = await selectWheelPickerColumn<number>({
        target,
        centerXPercent,
        maxSwipes,
        intervalMs,
        deviceSize: input.deviceSize,
        captureLayout: async () => {
          attempt += 1;
          const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
          artifacts.push(screenshot.artifact);
          return this.deps.ocr.locateText!({ image: screenshot.png, mode: "contains" });
        },
        readCandidates: (layout, columnCenterXPercent) => pickerColumnNumberCandidates(layout, unit, columnCenterXPercent),
        compare: (expected, current) => expected - current,
        formatSelectedPart: (value) => `${value}${unit}`,
        performAction: async (action) => normalizeActionResult(await this.performAction(input, action)),
        wait: (ms) => this.wait(input, ms),
        detectNoProgress: true
      });
      actionResult = result.actionResult ?? actionResult;
      totalSwipes += result.swipes;
      if (result.selected && result.selectedPart) {
        selectedParts.push(result.selectedPart);
        return true;
      }
      failureReason = result.failureReason ?? failureReason;
      stalledAt = result.stalledAt;
      return false;
    };

    const hoursSelected = await selectColumn("hours", duration.hours);
    const minutesSelected = hoursSelected && await selectColumn("minutes", duration.minutes);
    if (!hoursSelected || !minutesSelected) {
      return {
        supported: true,
        resolved: false,
        message: `Duration picker value "${selectedValue}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: failureReason,
          pickerMode: "duration_hours_minutes",
          selectedValue,
          selectedParts,
          ...(stalledAt ? { stalledAt } : {}),
          attempts: attempt,
          swipes: totalSwipes,
          region
        }
      };
    }

    const confirmText = textParam(input.step.params.confirmText).trim() || "确定";
    attempt += 1;
    const confirmScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
    artifacts.push(confirmScreenshot.artifact);
    const confirmLayout = await this.deps.ocr.locateText!({ image: confirmScreenshot.png, mode: "contains" });
    const confirmCandidate = findTextCandidate(confirmLayout, confirmText, {
      mode: "contains",
      deviceSize: input.deviceSize
    });
    if (!confirmCandidate) {
      return {
        supported: true,
        resolved: false,
        message: `Picker confirmation "${confirmText}" was not found.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          ...pageTaskSemanticMetadata(input.step.params),
          reason: "picker_confirm_not_found",
          pickerMode: "duration_hours_minutes",
          selectedValue,
          selectedParts,
          region
        }
      };
    }
    const confirmAction = {
      type: "tap",
      x: scaleCoordinate(confirmCandidate.centerX, confirmLayout.width, input.deviceSize?.width),
      y: scaleCoordinate(confirmCandidate.centerY, confirmLayout.height, input.deviceSize?.height)
    } satisfies DeviceActionRequest;
    actionResult = normalizeActionResult(await this.performAction(input, confirmAction)) ?? actionResult;
    await this.wait(input, positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));

    let verifiedSelectedValue: string | undefined;
    if (input.step.params.verifySelectedValue === true) {
      attempt += 1;
      const verificationScreenshot = await this.deps.captureLocatorScreenshot(
        input.runId,
        input.stepResultId,
        input.serial,
        input.step.id,
        attempt
      );
      artifacts.push(verificationScreenshot.artifact);
      const verificationLayout = await this.deps.ocr.locateText!({ image: verificationScreenshot.png, mode: "contains" });
      const targetText = textParam(input.step.params.targetText).trim();
      const actualValue = findDurationFieldValue(verificationLayout, targetText);
      if (actualValue !== expectedSelectedValue) {
        return {
          supported: true,
          resolved: false,
          action: confirmAction,
          actionResult,
          message: `Duration picker applied "${actualValue ?? "unknown"}" instead of "${expectedSelectedValue}".`,
          artifacts,
          metadata: {
            type: "image_region",
            action: "fail",
            ...pageTaskSemanticMetadata(input.step.params),
            reason: "picker_value_not_applied",
            pickerMode: "duration_hours_minutes",
            selectedValue,
            normalizedSelectedValue: expectedSelectedValue,
            actualValue,
            selectedParts,
            attempts: attempt,
            swipes: totalSwipes,
            region
          }
        };
      }
      verifiedSelectedValue = actualValue;
    }

    return {
      supported: true,
      resolved: true,
      action: confirmAction,
      actionResult,
      message: `Selected duration picker value "${expectedSelectedValue}".`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "picker_select",
        ...pageTaskSemanticMetadata(input.step.params),
        pickerMode: "duration_hours_minutes",
        region,
        semanticArea,
        opener,
        selectedValue,
        normalizedSelectedValue: expectedSelectedValue,
        ...(verifiedSelectedValue ? { verifiedSelectedValue } : {}),
        selectedParts,
        attempts: attempt,
        swipes: totalSwipes,
        confirmedBy: confirmCandidate.text,
        confirmCenter: confirmAction,
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async tryResolveGridCandidateByOcr(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number }
  ): Promise<SemanticResolutionOutcome | undefined> {
    const scrollProfile = readScrollProfile(input.step.params.scrollProfile);
    const targetQuery = textParam(scrollProfile.targetQuery).trim();
    if (!targetQuery || scrollProfile.targetKind === "nth_item" || !this.deps.ocr.locateText) {
      return undefined;
    }
    const artifacts: ArtifactRef[] = [];
    const maxSwipes = maxGridSearchSwipes(input.step.params, scrollProfile);
    const intervalMs = positiveNumberParam(input.step.params.searchIntervalMs, positiveNumberParam(input.step.params.intervalMs, 250));
    const mode = tapTextMatchMode(input.step.params.mode);
    const tryFindAndTap = async (
      attempt: number,
      relocatedBy: "ocr_text_in_grid" | "ocr_text_in_grid_after_scroll",
      search?: Record<string, unknown>
    ): Promise<{ outcome?: SemanticResolutionOutcome; signature?: string }> => {
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      const layout = await this.deps.ocr.locateText?.({
        image: screenshot.png,
        mode
      });
      if (!layout) {
        return {};
      }
      const signature = gridSearchLayoutSignature(layout, region, input.deviceSize);
      const target = findTextCandidate(layout, targetQuery, {
        mode,
        deviceSize: input.deviceSize
      });
      if (!target || !candidateInsidePercentRegion(target, region, layout, input.deviceSize)) {
        return { signature };
      }
      const grid = candidateGridCell(target, region, layout, scrollProfile, input.deviceSize);
      const center = textCandidateDevicePoint(target, layout, input.deviceSize);
      const pointPercent = candidatePercentPoint(target, layout, input.deviceSize);
      if (!center) {
        return { signature };
      }
      const action = { type: "tap", x: center.x, y: center.y } satisfies DeviceActionRequest;
      const actionResult = normalizeActionResult(await this.performAction(input, action));
      return {
        signature,
        outcome: {
          supported: true,
          resolved: true,
          action,
          actionResult,
          message: `Resolved grid candidate "${target.text}" by OCR inside the marked list region.`,
          artifacts,
          metadata: {
            type: "image_region",
            action: "tap",
            abilityType: "grid_candidate",
            region,
            targetQuery,
            actual: target.text,
            relocatedBy,
            locator: target,
            candidateGrid: grid,
            candidatePointPercent: pointPercent,
            clickSource: "ocr_matched_item",
            center,
            ...(search ? { search } : {}),
            driverChannel: actionResult?.driverChannel
          }
        }
      };
    };

    const directProbe = await tryFindAndTap(1, "ocr_text_in_grid", {
      strategy: gridSearchStrategy(input.step.params, scrollProfile),
      phase: "current",
      attempts: 1
    });
    if (directProbe.outcome) {
      return directProbe.outcome;
    }
    const strategy = gridSearchStrategy(input.step.params, scrollProfile);
    if (strategy === "current_then_top_down") {
      let attempt = 1;
      let resetSwipes = 0;
      let scanSwipes = 0;
      let reachedTop = false;
      let reachedBottom = false;
      let previousSignature = directProbe.signature;
      for (resetSwipes = 1; resetSwipes <= maxSwipes; resetSwipes += 1) {
        await this.performAction(input, reverseGridSearchSwipeAction(region, scrollProfile, input.deviceSize));
        await this.wait(input, intervalMs);
        attempt += 1;
        const resetProbe = await tryFindAndTap(attempt, "ocr_text_in_grid_after_scroll", {
          strategy,
          phase: "reset_to_top",
          direction: "reverse",
          maxSwipes,
          resetSwipes,
          attempts: attempt
        });
        if (resetProbe.outcome) {
          return resetProbe.outcome;
        }
        if (previousSignature && resetProbe.signature && previousSignature === resetProbe.signature) {
          reachedTop = true;
          previousSignature = resetProbe.signature;
          break;
        }
        previousSignature = resetProbe.signature ?? previousSignature;
      }
      for (scanSwipes = 1; scanSwipes <= maxSwipes; scanSwipes += 1) {
        await this.performAction(input, gridSearchSwipeAction(region, scrollProfile, input.deviceSize));
        await this.wait(input, intervalMs);
        attempt += 1;
        const scrolledProbe = await tryFindAndTap(attempt, "ocr_text_in_grid_after_scroll", {
          strategy,
          phase: "scan_down",
          direction: scrollProfile.direction,
          maxSwipes,
          resetSwipes,
          swipes: scanSwipes,
          attempts: attempt
        });
        if (scrolledProbe.outcome) {
          return scrolledProbe.outcome;
        }
        if (previousSignature && scrolledProbe.signature && previousSignature === scrolledProbe.signature) {
          reachedBottom = true;
          previousSignature = scrolledProbe.signature;
          break;
        }
        previousSignature = scrolledProbe.signature ?? previousSignature;
      }
      return {
        supported: true,
        resolved: false,
        message: `Grid candidate target "${targetQuery}" was not found inside the marked list region.`,
        artifacts,
        metadata: {
          type: "image_region",
          action: "fail",
          abilityType: "grid_candidate",
          reason: "target_not_found",
          targetQuery,
          region,
          search: {
            strategy,
            direction: scrollProfile.direction,
            maxSwipes,
            resetSwipes,
            swipes: scanSwipes,
            attempts: attempt,
            reachedTop,
            reachedBottom
          }
        }
      };
    }

    let previousSignature = directProbe.signature;
    let swipes = 0;
    let reachedBoundary = false;
    for (swipes = 1; swipes <= maxSwipes; swipes += 1) {
      await this.performAction(input, gridSearchSwipeAction(region, scrollProfile, input.deviceSize));
      await this.wait(input, intervalMs);
      const scrolledProbe = await tryFindAndTap(swipes + 1, "ocr_text_in_grid_after_scroll", {
        strategy,
        phase: "scan",
        direction: scrollProfile.direction,
        maxSwipes,
        swipes,
        attempts: swipes + 1
      });
      if (scrolledProbe.outcome) {
        return scrolledProbe.outcome;
      }
      if (previousSignature && scrolledProbe.signature && previousSignature === scrolledProbe.signature) {
        reachedBoundary = true;
        break;
      }
      previousSignature = scrolledProbe.signature ?? previousSignature;
    }
    return {
      supported: true,
      resolved: false,
      message: `Grid candidate target "${targetQuery}" was not found inside the marked list region.`,
      artifacts,
      metadata: {
        type: "image_region",
        action: "fail",
        abilityType: "grid_candidate",
        reason: "target_not_found",
        targetQuery,
        region,
        search: {
          strategy,
          direction: scrollProfile.direction,
          maxSwipes,
          swipes,
          attempts: swipes + 1,
          reachedBoundary
        }
      }
    };
  }

  private async resolveTapOnText(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const expectedTargets = tapTextTargets(input.step.params);
    const semanticMatch = input.step.params.mode === "semantic";
    const fallbackSemanticQuery = textParam(input.step.params.fallbackSemanticQuery).trim();
    const mode = tapTextMatchMode(input.step.params.mode);
    const exactFirst = !semanticMatch && mode === "contains";
    const timeoutMs = positiveNumberParam(input.step.params.timeoutMs, 3000);
    const intervalMs = positiveNumberParam(input.step.params.intervalMs, 500);
    const searchMode = readTextSearchMode(input.step.params.searchMode);
    const searchDirection = readTextSearchDirection(input.step.params.searchDirection);
    const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.maxSwipes, 6)));
    const semanticArea = readSemanticArea(input.step.params.semanticArea);
    const resetToTop = searchMode !== "visibleOnly" && input.step.params.resetToTop !== false && searchDirection !== "up";
    const currentViewportSettleTimeoutMs = Math.max(
      0,
      Math.min(timeoutMs, nonNegativeNumberParam(input.step.params.currentViewportSettleTimeoutMs, searchMode === "visibleOnly" ? timeoutMs : 2000))
    );
    const currentViewportSettleMaxAttempts = Math.max(1, Math.floor(positiveNumberParam(input.step.params.currentViewportSettleMaxAttempts, 4)));
    let attempt = 0;
    let latestLayout: OcrLayoutResult | undefined;
    let latestCandidate: TextLocatorCandidate | undefined;
    let resetSwipes = 0;
    let scanSwipes = 0;
    let reachedBoundary = false;
    let latestAmbiguous = false;
    let latestCandidateCount = 0;
    let latestMatchStrategy: string = semanticMatch ? "semantic" : mode;
    let latestVisibleText = "";
    const artifacts: ArtifactRef[] = [];
    const runtimeInterceptorRecords: RuntimeInterceptorRunOutcome["records"] = [];
    const runtimeInterceptorWarnings: string[] = [];
    let latestBlockedByRuntimeInterceptor = false;

    type TextViewportTraceContext = {
      phase: "visible" | "current" | "settle" | "current_ocr" | "pre_scroll" | "reset" | "scan" | "ocr_fallback";
      direction?: "up" | "down";
      scrollIndex?: number;
    };
    type TextViewportInspection = {
      layout?: OcrLayoutResult;
      hierarchyXml?: string;
      uiCandidate?: UiHierarchyTextResolution;
      candidate?: TextLocatorCandidate;
      ambiguous: boolean;
      canScrollPastAmbiguous: boolean;
      intercepted: boolean;
      signature: string;
    };
    const searchAttemptTrace: Array<Record<string, unknown>> = [];

    const searchMetadata = (): Record<string, unknown> => ({
      mode: searchMode,
      direction: searchDirection,
      resetToTop,
      maxSwipes,
      resetSwipes,
      scanSwipes,
      reachedBoundary,
      ...(searchAttemptTrace.length ? { attemptTrace: searchAttemptTrace } : {})
    });

    const recordSearchAttempt = (context: TextViewportTraceContext, current: TextViewportInspection): void => {
      if (searchAttemptTrace.length >= 40) {
        return;
      }
      const source = current.intercepted
        ? "runtime_interceptor"
        : current.layout && current.hierarchyXml
          ? "ui_hierarchy_ocr"
          : current.hierarchyXml
            ? "ui_hierarchy"
            : current.layout
              ? "ocr"
              : "none";
      searchAttemptTrace.push({
        attempt,
        phase: context.phase,
        ...(context.direction ? { direction: context.direction } : {}),
        ...(context.scrollIndex !== undefined ? { scrollIndex: context.scrollIndex } : {}),
        source,
        signature: compactSearchSignature(current.signature),
        candidateCount: latestCandidateCount,
        ambiguous: current.ambiguous,
        found: Boolean(current.uiCandidate || current.candidate),
        intercepted: current.intercepted
      });
    };

    const attachRuntimeInterceptors = (outcome: SemanticResolutionOutcome): SemanticResolutionOutcome => {
      if (!runtimeInterceptorRecords.length && !runtimeInterceptorWarnings.length) {
        return outcome;
      }
      return {
        ...outcome,
        runtimeInterceptorOutcome: {
          records: runtimeInterceptorRecords,
          ...(runtimeInterceptorWarnings.length ? { warning: runtimeInterceptorWarnings.join("; ") } : {})
        }
      };
    };

    const handleLocatorRuntimeInterceptors = async (): Promise<boolean> => {
      if (!this.deps.handleRuntimeInterceptors) {
        latestBlockedByRuntimeInterceptor = false;
        return false;
      }
      const outcome = await this.deps.handleRuntimeInterceptors({
        serial: input.serial,
        deviceSize: input.deviceSize
      });
      runtimeInterceptorRecords.push(...outcome.records);
      if (outcome.warning) {
        runtimeInterceptorWarnings.push(outcome.warning);
      }
      latestBlockedByRuntimeInterceptor = outcome.records.length > 0;
      return latestBlockedByRuntimeInterceptor;
    };

    if (!expectedTargets.length) {
      return {
        supported: true,
        resolved: false,
        message: "tap_on_text requires params.text.",
        artifacts,
        metadata: {
          type: "text",
          expected: "",
          action: "fail",
          reason: "missing_text"
        }
      };
    }

    const locateText = this.deps.ocr.locateText?.bind(this.deps.ocr);
    if (!this.deps.dumpUiHierarchy && !locateText) {
      return {
        supported: false,
        resolved: false,
        message: "No text locator is available.",
        artifacts,
        metadata: {
          type: "text",
          expected: expectedTargets,
          action: "unsupported",
          reason: "text_locator_unavailable"
        }
      };
    }

    const inspectViewport = async (options: { allowOcrFallback?: boolean } = {}): Promise<TextViewportInspection> => {
      attempt += 1;
      latestCandidate = undefined;
      latestAmbiguous = false;
      latestCandidateCount = 0;
      if (await handleLocatorRuntimeInterceptors()) {
        return {
          ambiguous: false,
          canScrollPastAmbiguous: false,
          intercepted: true,
          signature: `runtime-interceptor:${runtimeInterceptorRecords.length}:${attempt}`
        };
      }
      let hierarchyXml: string | undefined;
      let hierarchySignature = "";
      if (this.deps.dumpUiHierarchy && !semanticMatch) {
        try {
          hierarchyXml = await this.deps.dumpUiHierarchy(input.serial);
          const hierarchySelection = findUiHierarchyTextSelection(hierarchyXml, expectedTargets, {
            mode,
            exactFirst,
            preferredPoint: recordedPoint(input.step, input.deviceSize),
            semanticArea,
            deviceSize: input.deviceSize
          });
          hierarchySignature = hierarchySelection.signature;
          latestVisibleText = hierarchySignature;
          latestAmbiguous = hierarchySelection.ambiguous;
          latestCandidateCount = hierarchySelection.candidateCount;
          if (hierarchySelection.candidate || hierarchySelection.ambiguous) {
            if (hierarchySelection.candidate) {
              latestMatchStrategy = hierarchySelection.candidate.matchStrategy;
              latestAmbiguous = false;
              latestCandidateCount = hierarchySelection.candidateCount;
              return {
                hierarchyXml,
                uiCandidate: hierarchySelection.candidate,
                ambiguous: false,
                canScrollPastAmbiguous: hierarchySelection.canScrollPastAmbiguous,
                intercepted: false,
                signature: hierarchySignature
              };
            }
            if (hierarchySelection.ambiguous && locateText) {
              const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
              artifacts.push(screenshot.artifact);
              latestLayout = await locateText({
                image: screenshot.png,
                lang: textParam(input.step.params.lang) || undefined,
                mode
              });
              latestVisibleText = normalizeOcrText(latestLayout.text);
              const visibleHierarchyCandidates = filterUiHierarchyTextCandidatesByOcr(
                hierarchySelection.candidates,
                latestLayout,
                expectedTargets,
                mode,
                input.deviceSize
              );
              if (visibleHierarchyCandidates.length === 1) {
                const uiCandidate = {
                  ...visibleHierarchyCandidates[0]!,
                  candidateCount: hierarchySelection.candidateCount,
                  visibilityFilteredCandidateCount: visibleHierarchyCandidates.length,
                  visibilityOriginalCandidateCount: hierarchySelection.candidateCount
                };
                latestMatchStrategy = uiCandidate.matchStrategy;
                latestAmbiguous = false;
                latestCandidateCount = visibleHierarchyCandidates.length;
                return {
                  layout: latestLayout,
                  hierarchyXml,
                  uiCandidate,
                  ambiguous: false,
                  canScrollPastAmbiguous: false,
                  intercepted: false,
                  signature: textSearchLayoutSignature(latestLayout, semanticArea, input.deviceSize)
                };
              }
              if (visibleHierarchyCandidates.length > 1) {
                latestMatchStrategy = visibleHierarchyCandidates[0]?.matchStrategy ?? latestMatchStrategy;
                latestAmbiguous = true;
                latestCandidateCount = visibleHierarchyCandidates.length;
                return {
                  layout: latestLayout,
                  hierarchyXml,
                  ambiguous: true,
                  canScrollPastAmbiguous: false,
                  intercepted: false,
                  signature: textSearchLayoutSignature(latestLayout, semanticArea, input.deviceSize)
                };
              }
            }
            return {
              hierarchyXml,
              ambiguous: hierarchySelection.ambiguous,
              canScrollPastAmbiguous: hierarchySelection.canScrollPastAmbiguous,
              intercepted: false,
              signature: hierarchySignature
            };
          }
        } catch {
          hierarchyXml = undefined;
        }
      }

      if (hierarchyXml && options.allowOcrFallback === false) {
        latestCandidate = undefined;
        latestAmbiguous = false;
        latestCandidateCount = 0;
        return {
          hierarchyXml,
          ambiguous: false,
          canScrollPastAmbiguous: false,
          intercepted: false,
          signature: hierarchySignature
        };
      }

      if (!locateText) {
        latestCandidate = undefined;
        latestAmbiguous = false;
        latestCandidateCount = 0;
        return {
          hierarchyXml,
          ambiguous: false,
          canScrollPastAmbiguous: false,
          intercepted: false,
          signature: hierarchySignature
        };
      }

      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      latestLayout = await locateText({
        image: screenshot.png,
        lang: textParam(input.step.params.lang) || undefined,
        mode
      });
      latestVisibleText = normalizeOcrText(latestLayout.text);
      if (semanticMatch) {
        latestCandidate = findSemanticTextCandidate(latestLayout, expectedTargets[0] ?? "", {
            preferredPoint: recordedPoint(input.step, input.deviceSize),
            semanticArea,
            deviceSize: input.deviceSize
          });
        latestAmbiguous = false;
        latestCandidateCount = latestCandidate ? 1 : 0;
      } else if (exactFirst) {
        const exactSelection = findTextCandidateSelectionFromTargets(latestLayout, expectedTargets, {
            mode: "equals",
            preferredPoint: recordedPoint(input.step, input.deviceSize),
            semanticArea,
            deviceSize: input.deviceSize
          });
        if (exactSelection.candidate || exactSelection.ambiguous) {
          latestCandidate = exactSelection.candidate;
          latestAmbiguous = exactSelection.ambiguous;
          latestCandidateCount = exactSelection.candidateCount;
          latestMatchStrategy = "equals";
          return {
            layout: latestLayout,
            candidate: latestCandidate,
            ambiguous: latestAmbiguous,
            canScrollPastAmbiguous: false,
            intercepted: false,
            signature: textSearchLayoutSignature(latestLayout, semanticArea, input.deviceSize)
          };
        }
        const selection = findTextCandidateSelectionFromTargets(latestLayout, expectedTargets, {
            mode,
            preferredPoint: recordedPoint(input.step, input.deviceSize),
            semanticArea,
            deviceSize: input.deviceSize
          });
        latestCandidate = selection.candidate;
        latestAmbiguous = selection.ambiguous;
        latestCandidateCount = selection.candidateCount;
        latestMatchStrategy = mode;
      } else {
        const selection = findTextCandidateSelectionFromTargets(latestLayout, expectedTargets, {
            mode,
            preferredPoint: recordedPoint(input.step, input.deviceSize),
            semanticArea,
            deviceSize: input.deviceSize
          });
        latestCandidate = selection.candidate;
        latestAmbiguous = selection.ambiguous;
        latestCandidateCount = selection.candidateCount;
        latestMatchStrategy = mode;
      }
      if (semanticMatch) {
        latestMatchStrategy = "semantic";
      }
      if (!latestCandidate && !latestAmbiguous && fallbackSemanticQuery) {
        latestCandidate = findSemanticTextCandidate(latestLayout, fallbackSemanticQuery, {
          preferredPoint: recordedPoint(input.step, input.deviceSize),
          semanticArea,
          deviceSize: input.deviceSize
        });
        if (latestCandidate) {
          latestCandidateCount = 1;
          latestMatchStrategy = "semantic_fallback";
        }
      }
      return {
        layout: latestLayout,
        hierarchyXml,
        candidate: latestCandidate,
        ambiguous: latestAmbiguous,
        canScrollPastAmbiguous: exactFirst && latestAmbiguous,
        intercepted: false,
        signature: textSearchLayoutSignature(latestLayout, semanticArea, input.deviceSize)
      };
    };

    const inspectActionableViewport = async (
      options: { allowOcrFallback?: boolean } = {},
      context: TextViewportTraceContext = { phase: "current" }
    ): Promise<TextViewportInspection> => {
      const started = Date.now();
      let current = await inspectViewport(options);
      recordSearchAttempt(context, current);
      while (current.intercepted && Date.now() - started <= timeoutMs) {
        const elapsed = Date.now() - started;
        if (elapsed >= timeoutMs) {
          break;
        }
        await this.wait(input, Math.min(intervalMs, timeoutMs - elapsed));
        current = await inspectViewport(options);
        recordSearchAttempt(context, current);
      }
      return current;
    };

    const tapUiCandidate = async (candidate: UiHierarchyTextResolution): Promise<SemanticResolutionOutcome> => {
      const actionResult = (await this.performAction(input, candidate.action)) ?? undefined;
      return attachRuntimeInterceptors({
        supported: true,
        resolved: true,
        action: candidate.action,
        actionResult,
        message: `Resolved UI text "${candidate.actual}" for "${expectedTargets.join(" / ")}" after ${attempt} viewport attempt(s).`,
        artifacts,
        metadata: {
          type: "text",
          expected: expectedTargets,
          actual: candidate.actual,
          action: "tap",
          matchStrategy: candidate.matchStrategy,
          attempts: attempt,
          locator: candidate.textCandidate,
          tapPointSource: candidate.tapPointSource,
          uiCandidate: candidate.tapPointSource === "ui_clickable_ancestor" && candidate.actionableCandidate
            ? candidate.actionableCandidate
            : candidate.textCandidate,
          uiTextCandidate: candidate.textCandidate,
          ...(candidate.actionableCandidate ? { uiActionableCandidate: candidate.actionableCandidate } : {}),
          candidateCount: candidate.candidateCount,
          ...(candidate.visibilityFilteredCandidateCount !== undefined ? {
            visibilityFilteredCandidateCount: candidate.visibilityFilteredCandidateCount,
            visibilityOriginalCandidateCount: candidate.visibilityOriginalCandidateCount
          } : {}),
          search: searchMetadata(),
          evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
        }
      });
    };

    const tapCandidate = async (candidate: TextLocatorCandidate, layout: OcrLayoutResult, hierarchyXml?: string): Promise<SemanticResolutionOutcome> => {
      const ocrAction = {
        type: "tap",
        x: scaleCoordinate(candidate.centerX, layout.width, input.deviceSize?.width),
        y: scaleCoordinate(candidate.centerY, layout.height, input.deviceSize?.height)
      } satisfies DeviceActionRequest;
      const hierarchyTap = await this.resolveTextTapClickableContainer(input, candidate, mode, ocrAction, hierarchyXml);
      const action = hierarchyTap?.action ?? ocrAction;
      const actionResult = (await this.performAction(input, action)) ?? undefined;
      return attachRuntimeInterceptors({
        supported: true,
        resolved: true,
        action,
        actionResult,
        message: `Resolved text "${candidate.text}" for "${expectedTargets.join(" / ")}" after ${attempt} OCR attempt(s).`,
        artifacts,
        metadata: {
          type: "text",
          expected: expectedTargets,
          actual: candidate.text,
          action: "tap",
          matchStrategy: latestMatchStrategy,
          attempts: attempt,
          locator: candidate,
          ...(hierarchyTap ? {
            tapPointSource: "ui_clickable_ancestor",
            uiCandidate: hierarchyTap.candidate
          } : { tapPointSource: "ocr_text_center" }),
          search: searchMetadata(),
          evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
        }
      });
    };

    const resolvedViewportOutcome = async (current: TextViewportInspection): Promise<SemanticResolutionOutcome | undefined> => {
      if (current.uiCandidate) {
        return tapUiCandidate(current.uiCandidate);
      }
      if (current.candidate && current.layout) {
        return tapCandidate(current.candidate, current.layout, current.hierarchyXml);
      }
      if (current.ambiguous && !current.canScrollPastAmbiguous) {
        return textTargetFailure();
      }
      return undefined;
    };

    const isResolvedOrBlockingAmbiguous = (current: TextViewportInspection): boolean => {
      return Boolean(current.uiCandidate || current.candidate || current.ambiguous && !current.canScrollPastAmbiguous);
    };

    const inspectCurrentViewportUntilSettled = async (options: { allowOcrFallback?: boolean }): Promise<TextViewportInspection> => {
      // After app launch a first miss can be just a still-rendering viewport, not proof that scrolling is needed.
      const started = Date.now();
      let current = await inspectActionableViewport(options, { phase: "current" });
      if (isResolvedOrBlockingAmbiguous(current)) {
        return current;
      }
      let previousSignature = current.signature;
      let stableSamples = stableSearchSignature(current.signature) ? 1 : 0;
      let inspected = 1;
      while (inspected < currentViewportSettleMaxAttempts && Date.now() - started < currentViewportSettleTimeoutMs) {
        const elapsed = Date.now() - started;
        const remaining = currentViewportSettleTimeoutMs - elapsed;
        if (remaining <= 0) {
          break;
        }
        await this.wait(input, Math.min(intervalMs, remaining));
        current = await inspectActionableViewport(options, { phase: "settle" });
        inspected += 1;
        if (isResolvedOrBlockingAmbiguous(current)) {
          return current;
        }
        if (stableSearchSignature(current.signature) && current.signature === previousSignature) {
          stableSamples += 1;
        } else {
          stableSamples = stableSearchSignature(current.signature) ? 1 : 0;
        }
        previousSignature = current.signature;
        if (stableSamples >= 2) {
          break;
        }
      }
      return current;
    };

    if (searchMode === "visibleOnly") {
      const started = Date.now();
      while (Date.now() - started <= timeoutMs) {
        const current = await inspectActionableViewport({}, { phase: "visible" });
        if (current.intercepted) {
          const elapsed = Date.now() - started;
          if (elapsed >= timeoutMs) {
            break;
          }
          await this.wait(input, Math.min(intervalMs, timeoutMs - elapsed));
          continue;
        }
        if (current.uiCandidate) {
          return tapUiCandidate(current.uiCandidate);
        }
        if (current.candidate && current.layout) {
          return tapCandidate(current.candidate, current.layout, current.hierarchyXml);
        }
        if (current.ambiguous && !current.canScrollPastAmbiguous) {
          break;
        }

        const elapsed = Date.now() - started;
        if (elapsed >= timeoutMs) {
          break;
        }
        await this.wait(input, Math.min(intervalMs, timeoutMs - elapsed));
      }
    } else {
      const allowOcrFallback = searchMode !== "scroll";
      const useHierarchyFastSearch = Boolean(this.deps.dumpUiHierarchy && !semanticMatch && searchMode === "auto");
      const fastSearchOptions = { allowOcrFallback: useHierarchyFastSearch ? false : allowOcrFallback };
      let current = await inspectCurrentViewportUntilSettled(fastSearchOptions);
      const initialOutcome = await resolvedViewportOutcome(current);
      if (initialOutcome) return initialOutcome;

      if (useHierarchyFastSearch && allowOcrFallback && !stableSearchSignature(current.signature)) {
        const fallback = await inspectActionableViewport({ allowOcrFallback: true }, { phase: "current_ocr" });
        const fallbackOutcome = await resolvedViewportOutcome(fallback);
        if (fallbackOutcome) return fallbackOutcome;
        current = fallback;
      }

      let previousSignature = current.signature;

      const scanViewports = async (
        direction: "up" | "down",
        options: { allowOcrFallback?: boolean },
        counter: "reset" | "scan"
      ): Promise<{ current: TextViewportInspection; outcome?: SemanticResolutionOutcome }> => {
        for (let swipe = 0; swipe < maxSwipes; swipe += 1) {
          // Re-check before swiping so a target that appeared during the wait is not scrolled away.
          const preScroll = await inspectActionableViewport(options, { phase: "pre_scroll", direction, scrollIndex: swipe + 1 });
          const preScrollOutcome = await resolvedViewportOutcome(preScroll);
          if (preScrollOutcome) return { current: preScroll, outcome: preScrollOutcome };
          if (preScroll.signature) {
            previousSignature = preScroll.signature;
          }

          await this.performAction(input, scrollSwipeAction(direction, input.deviceSize));
          if (counter === "reset") resetSwipes += 1;
          else scanSwipes += 1;
          await this.wait(input, intervalMs);
          current = await inspectActionableViewport(options, { phase: counter, direction, scrollIndex: swipe + 1 });
          const outcome = await resolvedViewportOutcome(current);
          if (outcome) return { current, outcome };
          if (current.signature === previousSignature) {
            reachedBoundary = true;
            break;
          }
          previousSignature = current.signature;
        }
        return { current };
      };

      const direction = searchDirection === "up" ? "up" : "down";
      if (resetToTop) {
        const reset = await scanViewports("up", fastSearchOptions, "reset");
        if (reset.outcome) return reset.outcome;
        current = reset.current;
      }

      reachedBoundary = false;
      const scanned = await scanViewports(direction, fastSearchOptions, "scan");
      if (scanned.outcome) return scanned.outcome;
      current = scanned.current;

      if (useHierarchyFastSearch && allowOcrFallback) {
        const fallbackOptions = { allowOcrFallback: true };
        const fallback = await inspectActionableViewport(fallbackOptions, { phase: "ocr_fallback" });
        const fallbackOutcome = await resolvedViewportOutcome(fallback);
        if (fallbackOutcome) return fallbackOutcome;
        current = fallback;
        previousSignature = current.signature;
        if (resetToTop) {
          reachedBoundary = false;
          const reset = await scanViewports("up", fallbackOptions, "reset");
          if (reset.outcome) return reset.outcome;
          current = reset.current;
        }
        reachedBoundary = false;
        previousSignature = current.signature;
        const scanned = await scanViewports(direction, fallbackOptions, "scan");
        if (scanned.outcome) return scanned.outcome;
        current = scanned.current;
      }
    }

    return textTargetFailure();

    function textTargetFailure(): SemanticResolutionOutcome {
      const reason = latestBlockedByRuntimeInterceptor ? "blocked_by_runtime_interceptor" : latestAmbiguous ? "ambiguous_target" : "target_not_found";
      return attachRuntimeInterceptors({
        supported: true,
        resolved: false,
        message: latestAmbiguous
          ? `Text target "${expectedTargets.join(" / ")}" matched multiple visible candidates.`
          : `Text target "${expectedTargets.join(" / ")}" was not found.`,
        artifacts,
        metadata: {
          type: "text",
          expected: expectedTargets,
          actual: latestVisibleText || normalizeOcrText(latestLayout?.text ?? "") || "(empty text result)",
          action: "fail",
          reason,
          attempts: attempt,
          candidateCount: latestCandidateCount || latestLayout?.boxes.length || 0,
          nearestCandidate: latestCandidate,
          ...(fallbackSemanticQuery ? { fallbackSemanticQuery } : {}),
          search: searchMetadata(),
          evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
        }
      });
    }
  }

  private async resolveTextTapClickableContainer(
    input: {
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    candidate: TextLocatorCandidate,
    mode: "contains" | "equals",
    ocrAction: Extract<DeviceActionRequest, { type: "tap" }>,
    hierarchyXml?: string
  ): Promise<{ action: Extract<DeviceActionRequest, { type: "tap" }>; candidate: UiElementCandidate } | undefined> {
    if (!this.deps.dumpUiHierarchy) return undefined;
    const targetTexts = [...new Set([candidate.text, ...tapTextTargets(input.step.params)].map((item) => item.trim()).filter(Boolean))];
    if (!targetTexts.length) return undefined;

    let xml = hierarchyXml;
    try {
      xml ??= await this.deps.dumpUiHierarchy(input.serial);
    } catch {
      return undefined;
    }

    for (const text of targetTexts) {
      const uiCandidate = findElementByLocator(xml, {
        text,
        textMatchMode: mode,
        tapTarget: "clickable_ancestor"
      }, {
        preferredPoint: ocrAction,
        maxDistance: 180
      });
      if (!uiCandidate || !isReasonableClickableTextContainer(uiCandidate, ocrAction, input.deviceSize)) {
        continue;
      }
      return {
        action: {
          type: "tap",
          x: uiCandidate.bounds.centerX,
          y: uiCandidate.bounds.centerY
        },
        candidate: uiCandidate
      };
    }
    return undefined;
  }

  private async resolveTapOnElement(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const locator = readElementLocator(input.step.params);
    const preferredPoint = recordedPoint(input.step, input.deviceSize);
    if (!hasStableLocator(locator)) {
      return {
        supported: true,
        resolved: false,
        message: "tap_on_element requires resourceId, contentDesc, or text locator.",
        artifacts: [],
        metadata: {
          type: "element",
          action: "fail",
          reason: "missing_stable_locator",
          locator
        }
      };
    }

    if (!this.deps.dumpUiHierarchy) {
      return {
        supported: false,
        resolved: false,
        message: "Android UI hierarchy locator is unavailable.",
        artifacts: [],
        metadata: {
          type: "element",
          action: "unsupported",
          reason: "ui_hierarchy_unavailable",
          locator
        }
      };
    }

    const timeoutMs = positiveNumberParam(input.step.params.timeoutMs, 3000);
    const intervalMs = positiveNumberParam(input.step.params.intervalMs, 500);
    const started = Date.now();
    let attempt = 0;
    let latestCandidate: UiElementCandidate | undefined;
    let latestError: string | undefined;
    const maxDistance = locator.resourceId || locator.contentDesc ? undefined : positiveNumberParam(input.step.params.maxDistance, 240);

    while (Date.now() - started <= timeoutMs) {
      attempt += 1;
      try {
        const xml = await this.deps.dumpUiHierarchy(input.serial);
        latestCandidate = findElementByLocator(xml, locator, {
          preferredPoint,
          maxDistance
        });
        if (latestCandidate) {
          const semanticAction: SemanticDeviceActionRequest = {
            type: "tap_on_element",
            locator,
            fallbackTap: {
              x: latestCandidate.bounds.centerX,
              y: latestCandidate.bounds.centerY
            }
          };
          const actionResult = this.deps.performSemanticAction
            ? normalizeActionResult(await this.performSemanticAction(input, semanticAction))
            : normalizeActionResult(await this.performAction(input, {
              type: "tap",
              x: latestCandidate.bounds.centerX,
              y: latestCandidate.bounds.centerY
            }));
          return {
            supported: true,
            resolved: true,
            action: this.deps.performSemanticAction ? undefined : semanticAction.fallbackTap ? { type: "tap", x: semanticAction.fallbackTap.x, y: semanticAction.fallbackTap.y } : undefined,
            actionResult,
            message: `Resolved element ${latestCandidate.selector} after ${attempt} UI hierarchy attempt(s).`,
            artifacts: [],
            metadata: {
              type: "element",
              action: "tap",
              attempts: attempt,
              locator,
              resolvedLocator: locatorFromCandidate(latestCandidate),
              candidate: latestCandidate,
              driverChannel: actionResult?.driverChannel
            }
          };
        }
      } catch (error) {
        latestError = errorToString(error);
      }

      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        break;
      }
      await this.wait(input, Math.min(intervalMs, timeoutMs - elapsed));
    }

    return {
      supported: true,
      resolved: false,
      message: `Element target ${describeElementLocator(locator)} was not found.`,
      artifacts: [],
      metadata: {
        type: "element",
        action: "fail",
        attempts: attempt,
        locator,
        nearestCandidate: latestCandidate,
        reason: latestError ?? "target_not_found"
      }
    };
  }

  private async resolveInputTextToElement(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const text = textParam(input.step.params.text);
    const clearOnly = input.step.params.clearOnly === true;
    if (!text && !clearOnly) {
      return {
        supported: true,
        resolved: false,
        message: "input_text_to_element requires params.text.",
        artifacts: [],
        metadata: {
          type: "element_input",
          action: "fail",
          reason: "missing_text"
        }
      };
    }

    const region = readPercentRegion(input.step.params.region);
    if (!region && isRuntimeInputStructuralLocator(input.step.params)) {
      return this.resolveRuntimeStructuralInput(input, text);
    }
    if (region) {
      const focus = await this.resolveInputRegionFocusPoint(input, region);
      if (!focus.point) {
        return {
          supported: true,
          resolved: false,
          message: "Input region could not be relocated by OCR, visual template, or structural evidence.",
          artifacts: focus.artifacts,
          metadata: {
            type: "element_input",
            action: "fail",
            resolvedBy: "image_region",
            reason: "runtime_relocation_required",
            fallback: "region_center_disabled",
            region,
            ...(focus.recordedCenter ? { recordedCenter: focus.recordedCenter } : {}),
            focusResolvedBy: focus.resolvedBy,
            semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
            ...pageTaskSemanticMetadata(input.step.params)
          }
        };
      }
      let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: focus.point.x, y: focus.point.y }));
      const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
      if (focusDelayMs > 0) {
        await this.wait(input, focusDelayMs);
      }
      if (input.step.params.clearFirst !== false) {
        actionResult = normalizeActionResult(await this.performAction(input, { type: "clear_text" })) ?? actionResult;
      }
      if (clearOnly) {
        return {
          supported: true,
          resolved: true,
          action: { type: "clear_text" },
          actionResult,
          message: "Focused manually marked input region and cleared text.",
          artifacts: focus.artifacts,
          metadata: {
            type: "element_input",
            action: "clear_text",
            resolvedBy: "image_region",
            clearOnly: true,
            region,
            center: focus.point,
            focusResolvedBy: focus.resolvedBy,
            driverChannel: actionResult?.driverChannel
          }
        };
      }
      actionResult = normalizeActionResult(await this.performAction(input, { type: "input_text", text })) ?? actionResult;
      const allowUnreadableAfterInput = shouldAllowUnreadableTargetRegionAfterInput(focus, input.step.params);
      const verification = await this.verifyInputText(input, text, {
        attempt: 1,
        semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
        percentRegion: inputVerificationRegion(region, focus, input.deviceSize),
        percentRegionSource: inputVerificationRegionSource(focus),
        uiCandidate: focus.uiCandidate,
        allowUnreadableTargetRegion: allowUnreadableAfterInput,
        unreadableTargetRegionStrategy: allowUnreadableAfterInput ? "target_region_unreadable_after_input" : undefined
      });
      if (!verification.verified) {
        const keyEventRetry = await this.retryInputWithKeyEvents(input, text, {
          region,
          focus,
          previousActionResult: actionResult,
          previousVerification: verification,
          semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region)
        });
        if (keyEventRetry) {
          return keyEventRetry;
        }
        return {
          supported: true,
          resolved: false,
          action: { type: "input_text", text },
          actionResult,
          message: `Input text "${text}" was not verified by OCR after typing.`,
          artifacts: verification.artifacts,
          metadata: {
            type: "element_input",
            action: "fail",
            resolvedBy: "image_region",
            reason: "input_text_not_verified",
            textLength: text.length,
            expected: text,
            actual: verification.actual,
            region,
            center: focus.point,
            focusResolvedBy: focus.resolvedBy,
            ...(focus.candidate ? { focusLocator: focus.candidate } : {}),
            ...(focus.artifacts.length ? { focusEvidenceArtifactIds: focus.artifacts.map((artifact) => artifact.id) } : {}),
            semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
            ...pageTaskSemanticMetadata(input.step.params),
            clearFirst: input.step.params.clearFirst !== false,
            sensitiveInput: isSensitiveInput(input.step.params),
            ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
            ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
            ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
            ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
            evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
            driverChannel: actionResult?.driverChannel
          }
        };
      }
      return {
        supported: true,
        resolved: true,
        action: { type: "input_text", text },
        actionResult,
        message: "Focused manually marked image region and input text.",
        artifacts: verification.artifacts,
        metadata: {
          type: "element_input",
          action: "input_text",
          resolvedBy: "image_region",
          textLength: text.length,
          region,
          center: focus.point,
          focusResolvedBy: focus.resolvedBy,
          ...(focus.candidate ? { focusLocator: focus.candidate } : {}),
          ...(focus.artifacts.length ? { focusEvidenceArtifactIds: focus.artifacts.map((artifact) => artifact.id) } : {}),
          semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
          ...pageTaskSemanticMetadata(input.step.params),
          clearFirst: input.step.params.clearFirst !== false,
          inputVerified: verification.verified,
          sensitiveInput: isSensitiveInput(input.step.params),
          ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
          ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
          ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
          ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
          ...(verification.candidate ? { verifiedBy: verification.candidate.text, verificationLocator: verification.candidate } : {}),
          evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    const located = await this.waitForElement(input, "input_text_to_element");
    if (!located.outcome.resolved || !located.candidate) {
      return {
        ...located.outcome,
        metadata: {
          ...located.outcome.metadata,
          type: "element_input"
        }
      };
    }

    const focusAction = {
      type: "tap",
      x: located.candidate.bounds.centerX,
      y: located.candidate.bounds.centerY
    } satisfies DeviceActionRequest;
    const semanticAction: SemanticDeviceActionRequest = {
      type: "input_text_to_element",
      locator: located.locator,
      text,
      clearFirst: input.step.params.clearFirst !== false,
      fallbackTap: {
        x: located.candidate.bounds.centerX,
        y: located.candidate.bounds.centerY
      }
    };
    let actionResult: DeviceActionResult | undefined;
    if (this.deps.performSemanticAction) {
      actionResult = normalizeActionResult(await this.performSemanticAction(input, semanticAction));
    } else {
      actionResult = normalizeActionResult(await this.performAction(input, focusAction));
      const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
      if (focusDelayMs > 0) {
        await this.wait(input, focusDelayMs);
      }
      if (input.step.params.clearFirst !== false) {
        actionResult = normalizeActionResult(await this.performAction(input, { type: "clear_text" })) ?? actionResult;
      }
      if (!clearOnly) {
        actionResult = normalizeActionResult(await this.performAction(input, { type: "input_text", text })) ?? actionResult;
      }
    }
    if (clearOnly) {
      return {
        supported: true,
        resolved: true,
        action: { type: "clear_text" },
        actionResult,
        message: `Focused ${located.candidate.selector} and cleared text.`,
        artifacts: [],
        metadata: {
          type: "element_input",
          action: "clear_text",
          attempts: located.attempts,
          locator: located.locator,
          resolvedLocator: locatorFromCandidate(located.candidate),
          candidate: located.candidate,
          clearOnly: true,
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    const verification = await this.verifyInputText(input, text, {
      attempt: located.attempts + 1,
      percentRegion: inputVerificationRegionFromUiCandidate(located.candidate, input.deviceSize),
      percentRegionSource: input.deviceSize ? "runtime_ui_candidate" : undefined,
      uiCandidate: located.candidate
    });
    if (!verification.verified) {
      return {
        supported: true,
        resolved: false,
        action: this.deps.performSemanticAction ? undefined : { type: "input_text", text },
        actionResult,
        message: `Input text "${text}" was not verified by OCR after typing.`,
        artifacts: verification.artifacts,
        metadata: {
          type: "element_input",
          action: "fail",
          reason: "input_text_not_verified",
          attempts: located.attempts,
          textLength: text.length,
          expected: text,
          actual: verification.actual,
          locator: located.locator,
          resolvedLocator: locatorFromCandidate(located.candidate),
          candidate: located.candidate,
          clearFirst: input.step.params.clearFirst !== false,
          ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
          ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
          ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
          evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    return {
      supported: true,
      resolved: true,
      action: this.deps.performSemanticAction ? undefined : { type: "input_text", text },
      actionResult,
      message: `Focused ${located.candidate.selector} and input text after ${located.attempts} UI hierarchy attempt(s).`,
      artifacts: verification.artifacts,
      metadata: {
        type: "element_input",
        action: "input_text",
        attempts: located.attempts,
        textLength: text.length,
        locator: located.locator,
        resolvedLocator: locatorFromCandidate(located.candidate),
        candidate: located.candidate,
        clearFirst: input.step.params.clearFirst !== false,
        inputVerified: verification.verified,
        ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
        ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
        ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
        ...(verification.candidate ? { verifiedBy: verification.candidate.text, verificationLocator: verification.candidate } : {}),
        evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async resolveRuntimeStructuralInput(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    text: string
  ): Promise<SemanticResolutionOutcome> {
    const clearOnly = input.step.params.clearOnly === true;
    const semanticArea = readSemanticArea(input.step.params.semanticArea) ?? "content";
    const searchRegion = defaultRuntimeSearchRegion(semanticArea);
    let focus = await this.resolveInputRegionFocusPoint(input, searchRegion);
    let reveal: { strategy: "scroll_to_top"; swipes: number } | undefined;
    const revealSettings = runtimeInputRevealSettings(input.step.params, semanticArea);
    let resetSwipes = 0;
    let scanSwipes = 0;
    let reachedBoundary = false;
    let previousSignature = focus.signature;
    const inspectAfterSwipe = async (): Promise<void> => {
      focus = await this.resolveInputRegionFocusPoint(input, searchRegion);
    };
    const reachedSameViewport = (): boolean => {
      if (!focus.signature || !previousSignature) {
        previousSignature = focus.signature ?? previousSignature;
        return false;
      }
      const same = focus.signature === previousSignature;
      previousSignature = focus.signature;
      return same;
    };
    if (!focus.point && revealSettings) {
      if (revealSettings.strategy === "bounded_search" && revealSettings.resetToTop && revealSettings.direction !== "up") {
        for (let swipe = 0; swipe < revealSettings.maxSwipes; swipe += 1) {
          await this.performAction(input, scrollSwipeAction("up", input.deviceSize));
          resetSwipes += 1;
          if (revealSettings.intervalMs > 0) {
            await this.wait(input, revealSettings.intervalMs);
          }
          await inspectAfterSwipe();
          if (focus.point) {
            break;
          }
          if (reachedSameViewport()) {
            reachedBoundary = true;
            break;
          }
        }
      }
      if (!focus.point) {
        reachedBoundary = false;
        const direction = revealSettings.strategy === "scroll_to_top" || revealSettings.direction === "up" ? "up" : "down";
        for (let swipe = 0; swipe < revealSettings.maxSwipes; swipe += 1) {
          await this.performAction(input, scrollSwipeAction(direction, input.deviceSize));
          scanSwipes += 1;
          if (revealSettings.intervalMs > 0) {
            await this.wait(input, revealSettings.intervalMs);
          }
          await inspectAfterSwipe();
          if (focus.point) {
            if (revealSettings.strategy === "scroll_to_top") {
              reveal = { strategy: "scroll_to_top", swipes: scanSwipes };
            }
            break;
          }
          if (reachedSameViewport()) {
            reachedBoundary = true;
            break;
          }
        }
      }
    }
    const searchMetadata = revealSettings?.strategy === "bounded_search"
      ? {
          search: {
            mode: revealSettings.mode,
            direction: revealSettings.direction,
            resetToTop: revealSettings.resetToTop,
            maxSwipes: revealSettings.maxSwipes,
            resetSwipes,
            scanSwipes,
            reachedBoundary
          }
        }
      : {};
    if (!focus.point) {
      return {
        supported: true,
        resolved: false,
        message: "Runtime structural input target could not be relocated by OCR or structural evidence.",
        artifacts: focus.artifacts,
        metadata: {
          type: "element_input",
          action: "fail",
          resolvedBy: "runtime_structural_locator",
          reason: "runtime_relocation_required",
          fallback: "region_center_disabled",
          searchRegion,
          ...(focus.recordedCenter ? { recordedCenter: focus.recordedCenter } : {}),
          focusResolvedBy: focus.resolvedBy,
          semanticArea,
          ...(revealSettings?.strategy === "scroll_to_top"
            ? { revealAttempted: { strategy: "scroll_to_top", swipes: revealSettings.maxSwipes } }
            : {}),
          ...searchMetadata,
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }

    let actionResult = normalizeActionResult(await this.performAction(input, { type: "tap", x: focus.point.x, y: focus.point.y }));
    const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
    if (focusDelayMs > 0) {
      await this.wait(input, focusDelayMs);
    }
    if (input.step.params.clearFirst !== false) {
      actionResult = normalizeActionResult(await this.performAction(input, { type: "clear_text" })) ?? actionResult;
    }
    if (clearOnly) {
      return {
        supported: true,
        resolved: true,
        action: { type: "clear_text" },
        actionResult,
        message: "Focused runtime structural input target and cleared text.",
        artifacts: focus.artifacts,
        metadata: {
          type: "element_input",
          action: "clear_text",
          resolvedBy: "runtime_structural_locator",
          clearOnly: true,
          searchRegion,
          center: focus.point,
          focusResolvedBy: focus.resolvedBy,
          ...(focus.candidate ? { focusLocator: focus.candidate } : {}),
          ...(focus.uiCandidate ? { focusUiCandidate: focus.uiCandidate } : {}),
          semanticArea,
          ...(reveal ? { reveal } : {}),
          ...searchMetadata,
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    actionResult = normalizeActionResult(await this.performAction(input, { type: "input_text", text })) ?? actionResult;
    const allowUnreadableAfterInput = shouldAllowUnreadableTargetRegionAfterInput(focus, input.step.params);
    const verification = await this.verifyInputText(input, text, {
      attempt: 1,
      semanticArea,
      percentRegion: inputVerificationRegion(searchRegion, focus, input.deviceSize),
      percentRegionSource: inputVerificationRegionSource(focus),
      uiCandidate: focus.uiCandidate,
      allowUnreadableTargetRegion: allowUnreadableAfterInput,
      unreadableTargetRegionStrategy: allowUnreadableAfterInput ? "target_region_unreadable_after_input" : undefined
    });
    if (!verification.verified) {
      const keyEventRetry = await this.retryInputWithKeyEvents(input, text, {
        region: searchRegion,
        focus,
        previousActionResult: actionResult,
        previousVerification: verification,
        semanticArea
      });
      if (keyEventRetry) {
        return keyEventRetry;
      }
      return {
        supported: true,
        resolved: false,
        action: { type: "input_text", text },
        actionResult,
        message: `Input text "${text}" was not verified by OCR after typing.`,
        artifacts: verification.artifacts,
        metadata: {
          type: "element_input",
          action: "fail",
          resolvedBy: "runtime_structural_locator",
          reason: "input_text_not_verified",
          textLength: text.length,
          expected: text,
          actual: verification.actual,
          searchRegion,
          center: focus.point,
          focusResolvedBy: focus.resolvedBy,
          ...(focus.candidate ? { focusLocator: focus.candidate } : {}),
          ...(focus.uiCandidate ? { focusUiCandidate: focus.uiCandidate } : {}),
          ...(focus.artifacts.length ? { focusEvidenceArtifactIds: focus.artifacts.map((artifact) => artifact.id) } : {}),
          semanticArea,
          ...(reveal ? { reveal } : {}),
          ...searchMetadata,
          ...pageTaskSemanticMetadata(input.step.params),
          clearFirst: input.step.params.clearFirst !== false,
          sensitiveInput: isSensitiveInput(input.step.params),
          ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
          ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
          ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
          ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
          evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
          driverChannel: actionResult?.driverChannel
        }
      };
    }

    return {
      supported: true,
      resolved: true,
      action: { type: "input_text", text },
      actionResult,
      message: "Focused runtime structural input target and input text.",
      artifacts: verification.artifacts,
      metadata: {
        type: "element_input",
        action: "input_text",
        resolvedBy: "runtime_structural_locator",
        textLength: text.length,
        searchRegion,
        center: focus.point,
        focusResolvedBy: focus.resolvedBy,
        ...(focus.candidate ? { focusLocator: focus.candidate } : {}),
        ...(focus.uiCandidate ? { focusUiCandidate: focus.uiCandidate } : {}),
        ...(focus.artifacts.length ? { focusEvidenceArtifactIds: focus.artifacts.map((artifact) => artifact.id) } : {}),
        semanticArea,
        ...(reveal ? { reveal } : {}),
        ...searchMetadata,
        ...pageTaskSemanticMetadata(input.step.params),
        clearFirst: input.step.params.clearFirst !== false,
        inputVerified: verification.verified,
        sensitiveInput: isSensitiveInput(input.step.params),
        ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
        ...(verification.recovery ? { verificationRecovery: verification.recovery } : {}),
        ...(verification.recoveryAction ? { verificationRecoveryAction: verification.recoveryAction } : {}),
        ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
        ...(verification.candidate ? { verifiedBy: verification.candidate.text, verificationLocator: verification.candidate } : {}),
        evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async retryInputWithKeyEvents(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    text: string,
    options: {
      region: { x: number; y: number; width: number; height: number };
      focus: {
        point?: { x: number; y: number };
        resolvedBy: string;
        candidate?: TextLocatorCandidate;
        uiCandidate?: UiElementCandidate;
        artifacts: ArtifactRef[];
      };
      previousActionResult?: DeviceActionResult;
      previousVerification: {
        verified: boolean;
        artifacts: ArtifactRef[];
        candidate?: TextLocatorCandidate;
        actual: string;
        strategy?: string;
        skippedReason?: string;
      };
      semanticArea: VisualSemanticArea;
    }
  ): Promise<SemanticResolutionOutcome | undefined> {
    if (
      input.step.params.secureKeyboardKeyEventRetry === false ||
      options.previousVerification.strategy !== "target_region_still_placeholder" ||
      !isRetryableInputFocusResolver(options.focus.resolvedBy) ||
      !canInputTextWithKeyEvents(text)
    ) {
      return undefined;
    }

    const retryAction = {
      type: "input_keyevents",
      text,
      intervalMs: nonNegativeNumberParam(input.step.params.secureKeyboardKeyEventIntervalMs, 45)
    } satisfies DeviceActionRequest;
    let retryActionResult: DeviceActionResult | undefined;
    try {
      retryActionResult = normalizeActionResult(await this.performAction(input, retryAction)) ?? options.previousActionResult;
    } catch {
      return undefined;
    }
      const retryVerification = await this.verifyInputText(input, text, {
        attempt: 2,
        semanticArea: options.semanticArea,
        percentRegion: inputVerificationRegion(options.region, options.focus, input.deviceSize),
        percentRegionSource: inputVerificationRegionSource(options.focus),
        uiCandidate: options.focus.uiCandidate,
        allowUnreadableTargetRegion: true,
        unreadableTargetRegionStrategy: "target_region_unreadable_after_keyevent_retry"
      });
    if (!retryVerification.verified) {
      return undefined;
    }
    return {
      supported: true,
      resolved: true,
      action: retryAction,
      actionResult: retryActionResult,
      message: "Focused input region and used Android keyevents after text injection did not update the target region.",
      artifacts: [...options.previousVerification.artifacts, ...retryVerification.artifacts],
      metadata: {
        type: "element_input",
        action: "input_text",
        resolvedBy: "image_region",
        textLength: text.length,
        region: options.region,
        ...(options.focus.point ? { center: options.focus.point } : {}),
        focusResolvedBy: options.focus.resolvedBy,
        ...(options.focus.candidate ? { focusLocator: options.focus.candidate } : {}),
        ...(options.focus.artifacts.length ? { focusEvidenceArtifactIds: options.focus.artifacts.map((artifact) => artifact.id) } : {}),
        semanticArea: options.semanticArea,
        ...pageTaskSemanticMetadata(input.step.params),
        clearFirst: input.step.params.clearFirst !== false,
        inputVerified: retryVerification.verified,
        sensitiveInput: isSensitiveInput(input.step.params),
        inputFallback: "keyevent_retry",
        initialVerificationStrategy: options.previousVerification.strategy,
        ...(retryVerification.strategy ? { verificationStrategy: retryVerification.strategy } : {}),
        ...(retryVerification.recovery ? { verificationRecovery: retryVerification.recovery } : {}),
        ...(retryVerification.recoveryAction ? { verificationRecoveryAction: retryVerification.recoveryAction } : {}),
        ...(retryVerification.percentRegionSource ? { verificationRegionSource: retryVerification.percentRegionSource } : {}),
        ...(retryVerification.candidate ? { verifiedBy: retryVerification.candidate.text, verificationLocator: retryVerification.candidate } : {}),
        evidenceArtifactIds: [
          ...options.previousVerification.artifacts.map((artifact) => artifact.id),
          ...retryVerification.artifacts.map((artifact) => artifact.id)
        ],
        driverChannel: retryActionResult?.driverChannel
      }
    };
  }

  private async verifyInputText(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    text: string,
    options: {
      attempt: number;
      semanticArea?: VisualSemanticArea;
      percentRegion?: { x: number; y: number; width: number; height: number };
      percentRegionSource?: "recorded_region" | "runtime_focus_candidate" | "runtime_ui_candidate";
      uiCandidate?: UiElementCandidate;
      allowUnreadableTargetRegion?: boolean;
      unreadableTargetRegionStrategy?: string;
    }
  ): Promise<{
    verified: boolean;
    artifacts: ArtifactRef[];
    candidate?: TextLocatorCandidate;
    actual: string;
    strategy?: string;
    recovery?: string;
    recoveryAction?: "hide_keyboard" | "back";
    percentRegionSource?: "recorded_region" | "runtime_focus_candidate" | "runtime_ui_candidate";
    skippedReason?: string;
  }> {
    if (input.step.params.verifyInputText === false) {
      return {
        verified: true,
        artifacts: [],
        actual: "",
        skippedReason: "disabled"
      };
    }
    if (!this.deps.ocr.locateText) {
      return {
        verified: true,
        artifacts: [],
        actual: "",
        skippedReason: "ocr_layout_unavailable"
      };
    }
    const delayMs = nonNegativeNumberParam(input.step.params.inputVerificationDelayMs, 350);
    if (delayMs > 0) {
      await this.wait(input, delayMs);
    }
    const uiVerification = await this.verifyInputTextFromUiHierarchy(input.serial, text, options.uiCandidate, input.step.params);
    if (uiVerification?.verified) {
      return {
        verified: true,
        artifacts: [],
        actual: uiVerification.actual,
        strategy: uiVerification.strategy,
        percentRegionSource: options.percentRegionSource
      };
    }
    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, options.attempt);
    const mode = tapTextMatchMode(input.step.params.inputVerificationMode ?? "equals");
    let layout = await this.deps.ocr.locateText({
      image: screenshot.png,
      mode
    });
    const artifacts = [screenshot.artifact];
    let recovery: string | undefined;
    let recoveryAction: "hide_keyboard" | "back" | undefined;
    const protectedScreenshot = isProbablyProtectedScreenshot(screenshot.png);
    if ((isEmptyOcrLayout(layout) || protectedScreenshot) && input.step.params.inputVerificationKeyboardRecovery !== false) {
      recoveryAction = await this.dismissKeyboardForInputVerification(input);
      if (recoveryAction) {
        const settleMs = nonNegativeNumberParam(input.step.params.inputVerificationRecoveryDelayMs, 300);
        if (settleMs > 0) {
          await this.wait(input, settleMs);
        }
        const retryScreenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, options.attempt + 1);
        artifacts.push(retryScreenshot.artifact);
        layout = await this.deps.ocr.locateText({
          image: retryScreenshot.png,
          mode
        });
        recovery = protectedScreenshot
          ? "keyboard_dismissed_after_protected_screenshot"
          : "keyboard_dismissed_after_empty_ocr";
      }
    }
    const candidate = findTextCandidate(layout, text, {
      mode,
      semanticArea: options.semanticArea,
      percentRegion: options.percentRegion,
      deviceSize: input.deviceSize
    });
    const identityResult = candidate ? undefined : findInputIdentityCandidate(layout, text, {
      semanticArea: options.semanticArea,
      percentRegion: options.percentRegion,
      deviceSize: input.deviceSize
    });
    const verifiedCandidate = candidate ?? identityResult?.candidate;
    const targetRegionResult = verifiedCandidate ? undefined : verifyInputTargetRegion(layout, text, {
      params: input.step.params,
      percentRegion: options.percentRegion,
      deviceSize: input.deviceSize,
      allowUnreadableTargetRegion: options.allowUnreadableTargetRegion,
      unreadableTargetRegionStrategy: options.unreadableTargetRegionStrategy
    });
    return {
      verified: Boolean(verifiedCandidate) || targetRegionResult?.verified === true,
      artifacts,
      candidate: verifiedCandidate,
      actual: normalizeOcrText(layout.text) || "(empty OCR result)",
      strategy: candidate ? "clear_text_target_region" : identityResult?.strategy ?? targetRegionResult?.strategy,
      recovery,
      recoveryAction,
      percentRegionSource: options.percentRegionSource
    };
  }

  private async verifyInputTextFromUiHierarchy(
    serial: string,
    text: string,
    sourceCandidate: UiElementCandidate | undefined,
    params: Record<string, unknown>
  ): Promise<{ verified: boolean; actual: string; strategy: string } | undefined> {
    if (!sourceCandidate || !this.deps.dumpUiHierarchy) {
      return undefined;
    }
    let candidates: UiElementCandidate[];
    try {
      candidates = parseAndroidUiHierarchy(await this.deps.dumpUiHierarchy(serial));
    } catch {
      return undefined;
    }
    const updatedCandidate = findUpdatedInputUiCandidate(
      sourceCandidate,
      candidates.filter(isInputUiElementCandidate)
    );
    if (!updatedCandidate) {
      return undefined;
    }
    const values = inputUiCandidateTextValues(updatedCandidate);
    if (!values.length) {
      return undefined;
    }
    const expected = normalizeOcrText(text);
    const mode = tapTextMatchMode(params.inputVerificationMode ?? "equals");
    const matched = values.some((value) => matchTextExpectation(value, expected, mode));
    return {
      verified: matched,
      actual: values.join(" "),
      strategy: matched ? "ui_text_input_value" : "ui_text_input_value_mismatch"
    };
  }

  private async dismissKeyboardForInputVerification(
    input: { serial: string; signal?: AbortSignal }
  ): Promise<"hide_keyboard" | "back" | undefined> {
    try {
      await this.performAction(input, { type: "hide_keyboard" });
      return "hide_keyboard";
    } catch {
      // Harmony currently does not expose a separate hide-keyboard action; Back dismisses the keyboard.
    }
    try {
      await this.performAction(input, { type: "back" });
      return "back";
    } catch {
      return undefined;
    }
  }

  private async resolveInputRegionFocusPoint(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    region: { x: number; y: number; width: number; height: number }
  ): Promise<{
    point?: { x: number; y: number };
    recordedCenter?: { x: number; y: number };
    resolvedBy: "ocr_text_semantic" | "ocr_relative_structure" | "scoped_text_field" | "ui_edit_text_structural" | "tap_point_percent" | "region_center" | "region_center_disabled";
    candidate?: TextLocatorCandidate;
    uiCandidate?: UiElementCandidate;
    artifacts: ArtifactRef[];
    signature?: string;
  }> {
    const tapPointPercent = readTapPointPercent(input.step.params.tapPointPercent);
    const fallbackPoint = regionPoint(region, input.deviceSize, tapPointPercent);
    const allowRegionFallback = input.step.params.allowRegionFallback === true;
    if (shouldPreferInputUiCandidate(input.step.params)) {
      const uiCandidate = await this.resolveInputUiCandidate(input.serial, region, input.deviceSize, input.step.params);
      if (uiCandidate) {
        return {
          point: { x: uiCandidate.bounds.centerX, y: uiCandidate.bounds.centerY },
          resolvedBy: "ui_edit_text_structural",
          uiCandidate,
          artifacts: []
        };
      }
    }
    if (this.deps.ocr.locateText) {
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 0);
      const layout = await this.deps.ocr.locateText({
        image: screenshot.png,
        mode: "contains"
      });
      const signature = textSearchLayoutSignature(layout, undefined, input.deviceSize);
      const candidate = findInputFocusCandidate(layout, region, input.deviceSize, input.step.params);
      if (candidate) {
        const point = textCandidateDevicePoint(candidate, layout, input.deviceSize);
        return {
          point,
          resolvedBy: isRelativeInputStructure(input.step.params)
            ? "ocr_relative_structure"
            : isScopedTextFieldStructure(input.step.params)
              ? "scoped_text_field"
              : "ocr_text_semantic",
          candidate,
          artifacts: [screenshot.artifact],
          signature
        };
      }
      const uiCandidate = shouldPreferInputUiCandidate(input.step.params)
        ? undefined
        : await this.resolveInputUiCandidate(input.serial, region, input.deviceSize, input.step.params);
      if (uiCandidate) {
        return {
          point: { x: uiCandidate.bounds.centerX, y: uiCandidate.bounds.centerY },
          resolvedBy: "ui_edit_text_structural",
          uiCandidate,
          artifacts: [screenshot.artifact],
          signature
        };
      }
      if (fallbackPoint && allowRegionFallback) {
        return {
          point: fallbackPoint,
          resolvedBy: tapPointPercent ? "tap_point_percent" : "region_center",
          artifacts: [screenshot.artifact],
          signature
        };
      }
      return {
        recordedCenter: fallbackPoint,
        resolvedBy: "region_center_disabled",
        artifacts: [screenshot.artifact],
        signature
      };
    }
    const uiCandidate = await this.resolveInputUiCandidate(input.serial, region, input.deviceSize, input.step.params);
    if (uiCandidate) {
      return {
        point: { x: uiCandidate.bounds.centerX, y: uiCandidate.bounds.centerY },
        resolvedBy: "ui_edit_text_structural",
        uiCandidate,
        artifacts: []
      };
    }
    if (!allowRegionFallback) {
      return {
        recordedCenter: fallbackPoint,
        resolvedBy: "region_center_disabled",
        artifacts: []
      };
    }
    return {
      point: fallbackPoint,
      resolvedBy: tapPointPercent ? "tap_point_percent" : "region_center",
      artifacts: []
    };
  }

  private async resolveInputUiCandidate(
    serial: string,
    _region: { x: number; y: number; width: number; height: number },
    deviceSize: { width: number; height: number } | undefined,
    params: Record<string, unknown>
  ): Promise<UiElementCandidate | undefined> {
    if (!this.deps.dumpUiHierarchy) {
      return undefined;
    }
    const xml = await this.deps.dumpUiHierarchy(serial);
    const candidates = parseAndroidUiHierarchy(xml);
    if (!(deviceSize ?? hierarchySize(candidates))) {
      return undefined;
    }
    const targets = inputFocusTextTargets(params);
    const inputCandidates = candidates
      .filter((candidate) => candidate.enabled)
      .filter(isInputUiElementCandidate);
    const ranked = inputCandidates
      .map((candidate) => ({
        candidate,
        score: inputUiCandidateScore(candidate, candidates, inputCandidates, targets, params)
      }))
      .filter((entry) => entry.score.semanticEvidence > 0)
      .sort((left, right) => right.score.total - left.score.total);
    return ranked[0]?.candidate;
  }

  private async resolveScrollUntilVisible(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const maxSwipes = Math.max(0, Math.floor(positiveNumberParam(input.step.params.maxSwipes, 5)));
    const intervalMs = positiveNumberParam(input.step.params.intervalMs, 300);
    let swipes = 0;

    for (let attempt = 1; attempt <= maxSwipes + 1; attempt += 1) {
      const located = await this.tryFindElement(input);
      if (located.outcome && !located.outcome.supported) {
        return located.outcome;
      }
      if (located.candidate) {
        return {
          supported: true,
          resolved: true,
          message: `Target ${located.candidate.selector} is visible after ${attempt} visibility attempt(s) and ${swipes} swipe(s).`,
          artifacts: [],
          metadata: {
            type: "scroll",
            action: "visible",
            attempts: attempt,
            swipes,
            locator: located.locator,
            resolvedLocator: locatorFromCandidate(located.candidate),
            candidate: located.candidate
          }
        };
      }
      if (swipes >= maxSwipes) {
        break;
      }
      const swipe = scrollSwipeAction(input.step.params.direction, input.deviceSize);
      const semanticAction: SemanticDeviceActionRequest = {
        type: "scroll_until_visible",
        locator: located.locator,
        direction: scrollDirectionParam(input.step.params.direction),
        maxSwipes,
        intervalMs,
        fallbackSwipe: swipe
      };
      if (this.deps.performSemanticAction) {
        await this.performSemanticAction(input, semanticAction);
      } else {
        await this.performAction(input, swipe);
      }
      swipes += 1;
      await this.wait(input, intervalMs);
    }

    const locator = readElementLocator(input.step.params);
    return {
      supported: true,
      resolved: false,
      message: `Element target ${describeElementLocator(locator)} was not visible after ${swipes} swipe(s).`,
      artifacts: [],
      metadata: {
        type: "scroll",
        action: "fail",
        reason: "target_not_visible",
        swipes,
        locator
      }
    };
  }

  private async resolveWaitUntilState(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<SemanticResolutionOutcome> {
    const located = await this.waitForElement(input, "wait_until_state");
    if (!located.outcome.resolved || !located.candidate) {
      return {
        ...located.outcome,
        metadata: {
          ...located.outcome.metadata,
          type: "state_wait"
        }
      };
    }
    return {
      supported: true,
      resolved: true,
      message: `State target ${located.candidate.selector} matched after ${located.attempts} UI hierarchy attempt(s).`,
      artifacts: [],
      metadata: {
        type: "state_wait",
        action: "matched",
        attempts: located.attempts,
        locator: located.locator,
        resolvedLocator: locatorFromCandidate(located.candidate),
        candidate: located.candidate
      }
    };
  }

  private async waitForElement(
    input: {
      runId: string;
      stepResultId: string;
      step: ActionStep;
      serial: string;
      deviceSize?: { width: number; height: number };
    },
    actionName: string
  ): Promise<{
    outcome: SemanticResolutionOutcome;
    locator: UiElementLocator;
    candidate?: UiElementCandidate;
    attempts: number;
  }> {
    const locator = readElementLocator(input.step.params);
    if (!hasStableLocator(locator)) {
      return {
        locator,
        attempts: 0,
        outcome: {
          supported: true,
          resolved: false,
          message: `${actionName} requires resourceId, contentDesc, or text locator.`,
          artifacts: [],
          metadata: {
            type: "element",
            action: "fail",
            reason: "missing_stable_locator",
            locator
          }
        }
      };
    }
    if (!this.deps.dumpUiHierarchy) {
      return {
        locator,
        attempts: 0,
        outcome: {
          supported: false,
          resolved: false,
          message: "Android UI hierarchy locator is unavailable.",
          artifacts: [],
          metadata: {
            type: "element",
            action: "unsupported",
            reason: "ui_hierarchy_unavailable",
            locator
          }
        }
      };
    }

    const timeoutMs = positiveNumberParam(input.step.params.timeoutMs, 3000);
    const intervalMs = positiveNumberParam(input.step.params.intervalMs, 500);
    const started = Date.now();
    let attempts = 0;
    let latestCandidate: UiElementCandidate | undefined;
    let latestError: string | undefined;
    const preferredPoint = recordedPoint(input.step, input.deviceSize);
    const maxDistance = locator.resourceId || locator.contentDesc ? undefined : positiveNumberParam(input.step.params.maxDistance, 240);

    while (Date.now() - started <= timeoutMs) {
      attempts += 1;
      try {
        const xml = await this.deps.dumpUiHierarchy(input.serial);
        latestCandidate = findElementByLocator(xml, locator, {
          preferredPoint,
          maxDistance
        });
        if (latestCandidate) {
          return {
            locator,
            candidate: latestCandidate,
            attempts,
            outcome: {
              supported: true,
              resolved: true,
              message: `Element target ${describeElementLocator(locator)} was found.`,
              artifacts: [],
              metadata: {
                type: "element",
                action: "found",
                attempts,
                locator,
                resolvedLocator: locatorFromCandidate(latestCandidate),
                candidate: latestCandidate
              }
            }
          };
        }
      } catch (error) {
        latestError = errorToString(error);
      }

      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        break;
      }
      await this.wait(input, Math.min(intervalMs, timeoutMs - elapsed));
    }

    return {
      locator,
      attempts,
      outcome: {
        supported: true,
        resolved: false,
        message: `Element target ${describeElementLocator(locator)} was not found.`,
        artifacts: [],
        metadata: {
          type: "element",
          action: "fail",
          attempts,
          locator,
          nearestCandidate: latestCandidate,
          reason: latestError ?? "target_not_found"
        }
      }
    };
  }

  private async tryFindElement(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
  }): Promise<{
    locator: UiElementLocator;
    candidate?: UiElementCandidate;
    outcome?: SemanticResolutionOutcome;
  }> {
    const locator = readElementLocator(input.step.params);
    if (!hasStableLocator(locator)) {
      return {
        locator,
        outcome: {
          supported: true,
          resolved: false,
          message: "scroll_until_visible requires resourceId, contentDesc, or text locator.",
          artifacts: [],
          metadata: {
            type: "scroll",
            action: "fail",
            reason: "missing_stable_locator",
            locator
          }
        }
      };
    }
    if (!this.deps.dumpUiHierarchy) {
      return {
        locator,
        outcome: {
          supported: false,
          resolved: false,
          message: "Android UI hierarchy locator is unavailable.",
          artifacts: [],
          metadata: {
            type: "scroll",
            action: "unsupported",
            reason: "ui_hierarchy_unavailable",
            locator
          }
        }
      };
    }
    const preferredPoint = recordedPoint(input.step, input.deviceSize);
    const maxDistance = locator.resourceId || locator.contentDesc ? undefined : positiveNumberParam(input.step.params.maxDistance, 240);
    const xml = await this.deps.dumpUiHierarchy(input.serial);
    return {
      locator,
      candidate: findElementByLocator(xml, locator, {
        preferredPoint,
        maxDistance
      })
    };
  }
}

function findUiHierarchyTextSelection(
  xml: string,
  expectedTargets: string[],
  options: {
    mode: "contains" | "equals";
    exactFirst: boolean;
    preferredPoint?: { x: number; y: number };
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  }
): {
  candidate?: UiHierarchyTextResolution;
  candidates: UiHierarchyTextResolution[];
  ambiguous: boolean;
  canScrollPastAmbiguous: boolean;
  candidateCount: number;
  signature: string;
} {
  const candidates = parseAndroidUiHierarchy(xml);
  const deviceSize = options.deviceSize ?? hierarchySize(candidates);
  const signature = uiHierarchyTextSignature(candidates, options.semanticArea, deviceSize);
  if (!expectedTargets.length) {
    return { ambiguous: false, canScrollPastAmbiguous: false, candidateCount: 0, candidates: [], signature };
  }

  if (options.exactFirst) {
    const exactSelection = selectUiHierarchyTextCandidate(candidates, expectedTargets, {
      mode: "equals",
      preferredPoint: options.preferredPoint,
      semanticArea: options.semanticArea,
      deviceSize
    });
    if (exactSelection.candidate || exactSelection.ambiguous) {
      const annotated = annotateUiHierarchyTextSelection(exactSelection, "ui_hierarchy_equals");
      return {
        ...annotated,
        canScrollPastAmbiguous: false,
        signature
      };
    }
    const containsSelection = selectUiHierarchyTextCandidate(candidates, expectedTargets, {
      mode: "contains",
      preferredPoint: options.preferredPoint,
      semanticArea: options.semanticArea,
      deviceSize
    });
    const annotated = annotateUiHierarchyTextSelection(containsSelection, "ui_hierarchy_contains");
    return {
      ...annotated,
      canScrollPastAmbiguous: annotated.ambiguous,
      signature
    };
  }

  const selection = selectUiHierarchyTextCandidate(candidates, expectedTargets, {
    mode: options.mode,
    preferredPoint: options.preferredPoint,
    semanticArea: options.semanticArea,
    deviceSize
  });
  const annotated = annotateUiHierarchyTextSelection(
    selection,
    options.mode === "equals" ? "ui_hierarchy_equals" : "ui_hierarchy_contains"
  );
  return {
    ...annotated,
    canScrollPastAmbiguous: false,
    signature
  };
}

function annotateUiHierarchyTextSelection(
  selection: {
    candidate?: UiHierarchyTextResolution;
    candidates: UiHierarchyTextResolution[];
    ambiguous: boolean;
    candidateCount: number;
  },
  matchStrategy: "ui_hierarchy_equals" | "ui_hierarchy_contains"
): {
  candidate?: UiHierarchyTextResolution;
  candidates: UiHierarchyTextResolution[];
  ambiguous: boolean;
  candidateCount: number;
} {
  const annotate = (candidate: UiHierarchyTextResolution): UiHierarchyTextResolution => ({
    ...candidate,
    matchStrategy,
    candidateCount: selection.candidateCount
  });
  return {
    ...selection,
    candidate: selection.candidate ? annotate(selection.candidate) : undefined,
    candidates: selection.candidates.map(annotate)
  };
}

function selectUiHierarchyTextCandidate(
  candidates: UiElementCandidate[],
  expectedTargets: string[],
  options: {
    mode: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  }
): {
  candidate?: UiHierarchyTextResolution;
  candidates: UiHierarchyTextResolution[];
  ambiguous: boolean;
  candidateCount: number;
} {
  const normalizedTargets = expectedTargets.map((target) => normalizeOcrText(target)).filter(Boolean);
  if (!normalizedTargets.length) {
    return { ambiguous: false, candidateCount: 0, candidates: [] };
  }
  const matches = candidates
    .filter((candidate) => candidate.text)
    .filter((candidate) => uiHierarchyTextMatches(candidate.text ?? "", normalizedTargets, options.mode))
    .filter((candidate) => uiCandidateMatchesSemanticArea(candidate, options.semanticArea, options.deviceSize))
    .map((candidate) => buildUiHierarchyTextResolution(candidate, candidates, options))
    .sort(compareUiHierarchyTextResolution);

  if (matches.length <= 1) {
    return { candidate: matches[0], ambiguous: false, candidateCount: matches.length, candidates: matches };
  }

  const hasMeaningfulPoint = Boolean(options.preferredPoint && options.preferredPoint.x > 0 && options.preferredPoint.y > 0);
  if (hasMeaningfulPoint) {
    const [best, second] = matches;
    const bestDistance = uiCandidateDistanceToPoint(best.textCandidate, options.preferredPoint) ?? Number.POSITIVE_INFINITY;
    const secondDistance = uiCandidateDistanceToPoint(second.textCandidate, options.preferredPoint) ?? Number.POSITIVE_INFINITY;
    if (secondDistance - bestDistance >= 48) {
      return { candidate: best, ambiguous: false, candidateCount: matches.length, candidates: matches };
    }
  }

  return { ambiguous: true, candidateCount: matches.length, candidates: matches };
}

function buildUiHierarchyTextResolution(
  textCandidate: UiElementCandidate,
  candidates: UiElementCandidate[],
  options: {
    preferredPoint?: { x: number; y: number };
    deviceSize?: { width: number; height: number };
  }
): UiHierarchyTextResolution {
  const textPoint = {
    x: textCandidate.bounds.centerX,
    y: textCandidate.bounds.centerY
  };
  const actionableCandidate = findUiActionableTextCandidate(candidates, textCandidate, options.deviceSize);
  const shouldUseActionableCenter = Boolean(
    actionableCandidate &&
    actionableCandidate.nodeId !== textCandidate.nodeId &&
    shouldTapUiClickableAncestorCenter(candidates, textCandidate, actionableCandidate, textPoint, options.deviceSize)
  );
  const action = shouldUseActionableCenter && actionableCandidate
    ? {
      type: "tap" as const,
      x: actionableCandidate.bounds.centerX,
      y: actionableCandidate.bounds.centerY
    }
    : {
      type: "tap" as const,
      x: textPoint.x,
      y: textPoint.y
    };
  return {
    action,
    actual: textCandidate.text ?? "",
    textCandidate: {
      ...textCandidate,
      distanceToPoint: uiCandidateDistanceToPoint(textCandidate, options.preferredPoint)
    },
    actionableCandidate,
    tapPointSource: shouldUseActionableCenter ? "ui_clickable_ancestor" : "ui_text_center",
    matchStrategy: "ui_hierarchy_contains",
    candidateCount: 1
  };
}

function uiHierarchyTextMatches(actual: string, normalizedTargets: string[], mode: "contains" | "equals"): boolean {
  const normalizedActual = normalizeOcrText(actual);
  if (!normalizedActual) {
    return false;
  }
  const lineTexts = mode === "equals" ? normalizedTextLines(actual) : [];
  return normalizedTargets.some((target) => {
    if (mode === "contains") {
      return matchTextExpectation(normalizedActual, target, "contains");
    }
    return normalizedActual === target || lineTexts.includes(target);
  });
}

function normalizedTextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => normalizeOcrText(line))
    .filter(Boolean);
}

function uiCandidateMatchesSemanticArea(
  candidate: UiElementCandidate,
  semanticArea: VisualSemanticArea | undefined,
  deviceSize: { width: number; height: number } | undefined
): boolean {
  if (!semanticArea || semanticArea === "unknown") {
    return true;
  }
  return uiCandidateSemanticArea(candidate, deviceSize) === semanticArea;
}

function uiHierarchyTextSignature(
  candidates: UiElementCandidate[],
  semanticArea: VisualSemanticArea | undefined,
  deviceSize: { width: number; height: number } | undefined
): string {
  return candidates
    .filter((candidate) => candidate.text)
    .filter((candidate) => uiCandidateMatchesSemanticArea(candidate, semanticArea, deviceSize))
    .map((candidate) => normalizeOcrText(candidate.text ?? ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

function uiCandidateSemanticArea(
  candidate: UiElementCandidate,
  deviceSize: { width: number; height: number } | undefined
): VisualSemanticArea {
  const height = deviceSize?.height;
  if (!height) {
    return "unknown";
  }
  const centerY = (candidate.bounds.centerY / height) * 100;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function findUiActionableTextCandidate(
  candidates: UiElementCandidate[],
  candidate: UiElementCandidate,
  deviceSize?: { width: number; height: number }
): UiElementCandidate | undefined {
  if (candidate.enabled && candidate.clickable) {
    return candidate;
  }
  const byId = new Map(candidates.map((item) => [item.nodeId, item]));
  let currentParentId = candidate.parentNodeId;
  const textPoint = {
    x: candidate.bounds.centerX,
    y: candidate.bounds.centerY
  };
  while (currentParentId !== undefined) {
    const parent = byId.get(currentParentId);
    if (!parent) {
      return undefined;
    }
    if (parent.enabled && parent.clickable && isReasonableClickableTextContainer(parent, textPoint, deviceSize)) {
      return parent;
    }
    currentParentId = parent.parentNodeId;
  }
  return undefined;
}

function shouldTapUiClickableAncestorCenter(
  candidates: UiElementCandidate[],
  textCandidate: UiElementCandidate,
  actionableCandidate: UiElementCandidate,
  textPoint: { x: number; y: number },
  deviceSize?: { width: number; height: number }
): boolean {
  if (!isReasonableClickableTextContainer(actionableCandidate, textPoint, deviceSize)) {
    return false;
  }
  const textArea = Math.max(1, textCandidate.area);
  const areaRatio = actionableCandidate.area / textArea;
  const descendantTextCount = countUiTextDescendants(candidates, actionableCandidate);
  return descendantTextCount <= 1 && areaRatio >= 4;
}

function countUiTextDescendants(candidates: UiElementCandidate[], ancestor: UiElementCandidate): number {
  const byId = new Map(candidates.map((item) => [item.nodeId, item]));
  return candidates.filter((candidate) => {
    if (!candidate.text || candidate.nodeId === ancestor.nodeId) {
      return false;
    }
    let parentId = candidate.parentNodeId;
    while (parentId !== undefined) {
      if (parentId === ancestor.nodeId) {
        return true;
      }
      parentId = byId.get(parentId)?.parentNodeId;
    }
    return false;
  }).length;
}

function compareUiHierarchyTextResolution(left: UiHierarchyTextResolution, right: UiHierarchyTextResolution): number {
  const leftActionable = left.actionableCandidate ? 0 : 1;
  const rightActionable = right.actionableCandidate ? 0 : 1;
  if (leftActionable !== rightActionable) {
    return leftActionable - rightActionable;
  }
  const leftDistance = left.textCandidate.distanceToPoint ?? Number.POSITIVE_INFINITY;
  const rightDistance = right.textCandidate.distanceToPoint ?? Number.POSITIVE_INFINITY;
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  return left.textCandidate.bounds.top - right.textCandidate.bounds.top ||
    left.textCandidate.bounds.left - right.textCandidate.bounds.left ||
    left.textCandidate.nodeId - right.textCandidate.nodeId;
}

function uiCandidateDistanceToPoint(candidate: UiElementCandidate, point?: { x: number; y: number }): number | undefined {
  if (!point) {
    return undefined;
  }
  const dx = Math.max(candidate.bounds.left - point.x, 0, point.x - candidate.bounds.right);
  const dy = Math.max(candidate.bounds.top - point.y, 0, point.y - candidate.bounds.bottom);
  return Math.round(Math.hypot(dx, dy));
}

export function findTextCandidate(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    mode?: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    percentRegion?: { x: number; y: number; width: number; height: number };
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  return findTextCandidates(layout, expected, options)[0];
}

function findTrailingSwitchAnchorCandidate(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  const direct = findTextCandidate(layout, expected, {
    mode: "contains",
    semanticArea: options.semanticArea,
    deviceSize: options.deviceSize
  });
  if (direct) return direct;

  const expectedKey = normalizeOcrConfusableKey(expected);
  if (!expectedKey) return undefined;
  return layout.boxes
    .map((box) => toCandidate(box))
    .filter((candidate) => {
      const actualKey = normalizeOcrConfusableKey(candidate.text);
      return Boolean(actualKey && (actualKey.includes(expectedKey) || expectedKey.includes(actualKey)));
    })
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea)
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
}

function normalizeOcrConfusableKey(value: string): string {
  return normalizeOcrText(value)
    .toLowerCase()
    .replace(/[il1|]/g, "i")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function findTextCandidates(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    mode?: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    percentRegion?: { x: number; y: number; width: number; height: number };
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate[] {
  const expectedText = normalizeOcrText(expected);
  const mode = options.mode ?? "contains";
  const allCandidates = layout.boxes.map((box) => toCandidate(box, options.preferredPoint));
  const textMatches = allCandidates
    .filter((candidate) => candidate.text && matchTextCandidateExpectation(normalizeOcrText(candidate.text), expectedText, mode));
  const scopedMatches = textMatches
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea)
    .filter((candidate) => !options.percentRegion || candidateInsidePercentRegion(candidate, options.percentRegion, layout, options.deviceSize));
  const matches = scopedMatches.length || options.semanticArea !== "content" || options.percentRegion
    ? scopedMatches
    : textMatches.filter((candidate) => isLikelyFloatingMenuTextCandidate(candidate, allCandidates, layout, options.deviceSize));
  if (!matches.length) {
    return [];
  }
  const rankedMatches =
    mode === "contains" ? matches.filter((candidate) => normalizeOcrText(candidate.text) === expectedText) : matches;
  const candidates = rankedMatches.length ? rankedMatches : matches;
  const maxDistance = options.maxDistance;
  return candidates
    .filter((candidate) => maxDistance === undefined || candidate.distanceToPoint === undefined || candidate.distanceToPoint <= maxDistance)
    .sort((left, right) => candidateScore(right) - candidateScore(left));
}

function matchTextCandidateExpectation(actual: string, expected: string, mode: "contains" | "equals"): boolean {
  if (mode !== "equals") {
    return matchTextExpectation(actual, expected, mode);
  }
  return actual === expected || hasLeadingDecorativeOcrPrefix(actual, expected);
}

function hasLeadingDecorativeOcrPrefix(actual: string, expected: string): boolean {
  if (!actual || !expected || actual === expected || !actual.endsWith(expected)) {
    return false;
  }
  const prefix = actual.slice(0, actual.length - expected.length);
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return false;
  }
  if (/\s$/.test(prefix) && isCompactOcrDecorationToken(trimmedPrefix)) {
    return true;
  }
  return isShortSymbolPrefix(trimmedPrefix) || isShortAttachedOcrDecorationPrefix(trimmedPrefix);
}

function isCompactOcrDecorationToken(value: string): boolean {
  if (/\s/u.test(value)) {
    return false;
  }
  const chars = Array.from(value);
  return chars.length === 1 || isShortSymbolPrefix(value);
}

function isShortSymbolPrefix(value: string): boolean {
  return /^[^\p{L}\p{N}\s]+$/u.test(value) && Array.from(value).length <= 2;
}

function isShortAttachedOcrDecorationPrefix(value: string): boolean {
  const chars = Array.from(value);
  return chars.length <= 2 && !/\s/u.test(value) && chars.some((char) => /[^\p{L}\p{N}]/u.test(char));
}

function filterUiHierarchyTextCandidatesByOcr(
  candidates: UiHierarchyTextResolution[],
  layout: OcrLayoutResult,
  expectedTargets: string[],
  mode: "contains" | "equals",
  deviceSize?: { width: number; height: number }
): UiHierarchyTextResolution[] {
  if (!candidates.length || !layout.boxes.length) {
    return [];
  }
  const ocrCandidates = layout.boxes.map((box) => toCandidate(box));
  return candidates.filter((candidate) =>
    ocrCandidates.some((ocrCandidate) =>
      ocrTextConfirmsUiHierarchyCandidate(ocrCandidate.text, candidate.actual, expectedTargets, mode) &&
      ocrCandidateOverlapsUiTextCandidate(ocrCandidate, candidate.textCandidate, layout, deviceSize)
    )
  );
}

function ocrTextConfirmsUiHierarchyCandidate(
  ocrText: string,
  uiText: string,
  expectedTargets: string[],
  mode: "contains" | "equals"
): boolean {
  const normalizedOcr = normalizeOcrText(ocrText);
  const normalizedUi = normalizeOcrText(uiText);
  const normalizedTargets = expectedTargets.map((target) => normalizeOcrText(target)).filter(Boolean);
  if (!normalizedOcr || !normalizedUi) {
    return false;
  }
  if (mode === "equals") {
    return normalizedOcr === normalizedUi || normalizedTargets.some((target) => normalizedOcr === target);
  }
  return normalizedTargets.some((target) => matchTextExpectation(normalizedOcr, target, "contains"))
    || matchTextExpectation(normalizedOcr, normalizedUi, "contains")
    || matchTextExpectation(normalizedUi, normalizedOcr, "contains");
}

function ocrCandidateOverlapsUiTextCandidate(
  ocrCandidate: TextLocatorCandidate,
  uiCandidate: UiElementCandidate,
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): boolean {
  const uiRect = scaleUiBoundsToOcrLayout(uiCandidate.bounds, layout, deviceSize);
  const ocrRect = {
    x: ocrCandidate.x,
    y: ocrCandidate.y,
    width: ocrCandidate.width,
    height: ocrCandidate.height
  };
  const margin = Math.max(12, Math.min(36, Math.round(Math.max(ocrCandidate.height, uiRect.height) * 0.35)));
  const expandedUiRect = expandRect(uiRect, margin);
  if (rectIntersectionArea(expandedUiRect, ocrRect) > 0) {
    return true;
  }
  return pointInsideRect({ x: ocrCandidate.centerX, y: ocrCandidate.centerY }, expandedUiRect);
}

function scaleUiBoundsToOcrLayout(
  bounds: UiElementCandidate["bounds"],
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const sourceWidth = deviceSize?.width || layout.width;
  const sourceHeight = deviceSize?.height || layout.height;
  const scaleX = sourceWidth > 0 ? layout.width / sourceWidth : 1;
  const scaleY = sourceHeight > 0 ? layout.height / sourceHeight : 1;
  return {
    x: bounds.left * scaleX,
    y: bounds.top * scaleY,
    width: bounds.width * scaleX,
    height: bounds.height * scaleY
  };
}

function isLikelyFloatingMenuTextCandidate(
  candidate: TextLocatorCandidate,
  candidates: TextLocatorCandidate[],
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): boolean {
  const height = deviceSize?.height ?? layout.height;
  if (!height) {
    return false;
  }
  const centerYPercent = (candidate.centerY / height) * 100;
  if (centerYPercent <= 10 || centerYPercent > 18) {
    return false;
  }
  const columnTolerance = Math.max(80, candidate.width * 1.5);
  const verticalWindow = Math.max(240, candidate.height * 8);
  const sameColumnNeighbors = candidates.filter((other) =>
    other !== candidate &&
    Math.abs(other.centerX - candidate.centerX) <= columnTolerance &&
    Math.abs(other.centerY - candidate.centerY) <= verticalWindow
  );
  return sameColumnNeighbors.length >= 2;
}

function findSemanticTextCandidate(
  layout: OcrLayoutResult,
  query: string,
  options: {
    preferredPoint?: { x: number; y: number };
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  const normalizedQuery = normalizeSemanticText(query);
  if (!normalizedQuery) return undefined;
  const ranked = layout.boxes
    .map((box) => toCandidate(box, options.preferredPoint))
    .filter((candidate) => candidate.text)
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea)
    .map((candidate) => ({ candidate, score: semanticTextScore(normalizedQuery, normalizeSemanticText(candidate.text)) }))
    .filter((entry) => entry.score >= 0.72)
    .sort((left, right) => right.score - left.score || candidateScore(right.candidate) - candidateScore(left.candidate));
  const best = ranked[0];
  if (!best) return undefined;
  const second = ranked[1];
  if (best.score < 0.999 && second && best.score - second.score < 0.12) return undefined;
  return best.candidate;
}

function normalizeSemanticText(value: string): string {
  let normalized = normalizeOcrText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  for (const phrase of ["请", "找到", "查找", "寻找", "然后", "并且", "点击", "点开", "打开", "进入", "前往", "跳转到", "跳转", "选择", "选中", "对应的", "对应", "入口", "按钮", "图标", "页面", "界面"]) {
    normalized = normalized.replaceAll(phrase, "");
  }
  return normalized.replace(/的/g, "");
}

function semanticTextScore(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  if (query === candidate) return 1;
  if (query.includes(candidate) || candidate.includes(query)) {
    return 0.82 + 0.15 * (Math.min(query.length, candidate.length) / Math.max(query.length, candidate.length));
  }
  const queryBigrams = characterBigrams(query);
  const candidateBigrams = characterBigrams(candidate);
  if (!queryBigrams.size || !candidateBigrams.size) return 0;
  const overlap = [...queryBigrams].filter((item) => candidateBigrams.has(item)).length;
  return (2 * overlap) / (queryBigrams.size + candidateBigrams.size);
}

function characterBigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function findPickerValueCandidate(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    mode?: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  const exact = findTextCandidate(layout, expected, options);
  if (exact) {
    return exact;
  }
  const expectedCompact = compactPickerText(expected);
  if (!expectedCompact) {
    return undefined;
  }
  const mode = options.mode ?? "contains";
  const matches = layout.boxes
    .map((box) => toCandidate(box, options.preferredPoint))
    .filter((candidate) => {
      const actualCompact = compactPickerText(candidate.text);
      if (!actualCompact) {
        return false;
      }
      return mode === "equals" ? actualCompact === expectedCompact : actualCompact.includes(expectedCompact);
    })
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea);
  const maxDistance = options.maxDistance;
  const compactMatch = matches
    .filter((candidate) => maxDistance === undefined || candidate.distanceToPoint === undefined || candidate.distanceToPoint <= maxDistance)
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
  return compactMatch ?? findSplitPickerValueCandidate(layout, expected, options);
}

async function selectWheelPickerColumn<T extends PickerColumnValue>(input: {
  target: T;
  centerXPercent: number;
  maxSwipes: number;
  intervalMs: number;
  deviceSize?: { width: number; height: number };
  captureLayout: () => Promise<OcrLayoutResult>;
  readCandidates: (layout: OcrLayoutResult, centerXPercent: number) => Array<PickerColumnCandidate<T>>;
  compare: (target: T, current: T) => number;
  formatSelectedPart: (value: T) => string;
  performAction: (action: DeviceActionRequest) => Promise<DeviceActionResult | undefined>;
  wait: (ms: number) => Promise<void>;
  detectNoProgress?: boolean;
}): Promise<WheelPickerColumnResult<T>> {
  let previousCenterValue: T | undefined;
  let repeatedCenterCount = 0;
  let actionResult: DeviceActionResult | undefined;
  let swipes = 0;
  for (let attempt = 0; attempt <= input.maxSwipes; attempt += 1) {
    const layout = await input.captureLayout();
    const candidates = input.readCandidates(layout, input.centerXPercent);
    const selectedCenterY = pickerSelectedCenterY(layout);
    const current = candidates
      .slice()
      .sort((left, right) => Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY))[0];
    if (current && pickerColumnValueEquals(current.value, input.target)) {
      return {
        selected: true,
        selectedPart: input.formatSelectedPart(current.value),
        actionResult,
        swipes
      };
    }
    if (attempt >= input.maxSwipes || !candidates.length || !current) {
      return {
        selected: false,
        actionResult,
        swipes,
        failureReason: "picker_value_not_found"
      };
    }

    if (input.detectNoProgress) {
      if (previousCenterValue !== undefined && pickerColumnValueEquals(previousCenterValue, current.value)) {
        repeatedCenterCount += 1;
      } else {
        repeatedCenterCount = 0;
      }
      previousCenterValue = current.value;
      if (repeatedCenterCount >= 2) {
        return {
          selected: false,
          actionResult,
          swipes,
          failureReason: "picker_no_progress",
          stalledAt: input.formatSelectedPart(current.value)
        };
      }
    }

    const visibleTarget = candidates
      .filter((candidate) => pickerColumnValueEquals(candidate.value, input.target))
      .sort((left, right) =>
        Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY)
      )[0];
    if (visibleTarget) {
      const action = {
        type: "tap",
        x: scaleCoordinate(visibleTarget.candidate.centerX, layout.width, input.deviceSize?.width),
        y: scaleCoordinate(visibleTarget.candidate.centerY, layout.height, input.deviceSize?.height)
      } satisfies DeviceActionRequest;
      actionResult = await input.performAction(action) ?? actionResult;
      if (input.intervalMs > 0) {
        await input.wait(input.intervalMs);
      }
      continue;
    }

    const direction = input.compare(input.target, current.value) > 0 ? "increase" : "decrease";
    const action = pickerColumnSwipeAction(input.centerXPercent, direction, input.deviceSize, {
      layout,
      centerY: selectedCenterY,
      rowSpacing: pickerColumnRowSpacing(candidates, layout.height),
      rows: pickerColumnMovementRows(candidates, current.value, input.target)
    });
    actionResult = await input.performAction(action) ?? actionResult;
    swipes += 1;
    if (input.intervalMs > 0) {
      await input.wait(input.intervalMs);
    }
  }
  return {
    selected: false,
    actionResult,
    swipes,
    failureReason: "picker_value_not_found"
  };
}

function pickerColumnValueEquals(left: PickerColumnValue, right: PickerColumnValue): boolean {
  return String(left) === String(right);
}

function parseDurationPickerValue(value: string): { hours: number; minutes: number } | undefined {
  const compact = compactPickerText(value);
  if (/^\d+$/.test(compact)) {
    const totalMinutes = Number(compact);
    return Number.isFinite(totalMinutes) && totalMinutes >= 0
      ? { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
      : undefined;
  }
  const match = compact.match(/^(?:(\d+)(?:小时|时))?(?:(\d+)(?:分钟|分))?$/);
  if (!match || (!match[1] && !match[2])) {
    return undefined;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || minutes < 0 || minutes >= 60) {
    return undefined;
  }
  return { hours, minutes };
}

function formatDurationPickerValue(value: { hours: number; minutes: number }): string {
  return `${value.hours}小时${value.minutes}分钟`;
}

function parseDateTimePickerValue(value: string): "current" | { date: string; hours: number; minutes: number } | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "current" || normalized === "now" || normalized === "当前时间") {
    return "current";
  }
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, rawHours, rawMinutes] = match;
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), hours, minutes);
  const date = new Date(timestamp);
  if (
    !Number.isInteger(hours) || hours < 0 || hours > 23 ||
    !Number.isInteger(minutes) || minutes < 0 || minutes > 59 || minutes % 5 !== 0 ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return undefined;
  }
  return { date: `${year}-${month}-${day}`, hours, minutes };
}

function pickerDateCandidates(
  layout: OcrLayoutResult,
  centerXPercent: number
): Array<{ value: string; candidate: TextLocatorCandidate }> {
  const centerX = layout.width * centerXPercent / 100;
  const maxDistance = layout.width * 0.32;
  return layout.boxes
    .map((box) => toCandidate(box))
    .map((candidate) => {
      const compact = normalizeOcrText(candidate.text).replace(/\s+/g, "");
      const match = compact.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
      return {
        candidate,
        value: match
          ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`
          : ""
      };
    })
    .filter((entry) => Boolean(entry.value) && Math.abs(entry.candidate.centerX - centerX) <= maxDistance);
}

function pickerPlainNumberCandidates(
  layout: OcrLayoutResult,
  centerXPercent: number
): Array<{ value: number; candidate: TextLocatorCandidate }> {
  const centerX = layout.width * centerXPercent / 100;
  const maxDistance = layout.width * 0.13;
  return layout.boxes
    .map((box) => toCandidate(box))
    .map((candidate) => ({ candidate, text: normalizeOcrText(candidate.text).replace(/\s+/g, "") }))
    .filter((entry) => /^\d{1,2}$/.test(entry.text) && Math.abs(entry.candidate.centerX - centerX) <= maxDistance)
    .map((entry) => ({ value: Number(entry.text), candidate: entry.candidate }));
}

function pickerSelectedCenterY(layout: OcrLayoutResult): number {
  const headerBottom = layout.boxes
    .filter((box) => {
      const text = compactPickerText(box.text);
      return text === "确定" || text === "取消";
    })
    .map((box) => box.y + box.height)
    .filter((bottom) => bottom >= layout.height * 0.5 && bottom <= layout.height * 0.9)
    .sort((left, right) => right - left)[0];
  if (headerBottom !== undefined) {
    return headerBottom + (layout.height - headerBottom) / 2;
  }
  return layout.height * 0.75;
}

function pickerComparableNumber(value: string): number | undefined {
  const matches = compactPickerText(value).match(/\d+/g);
  const number = matches?.length ? Number(matches.at(-1)) : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function pickerColumnNumberCandidates(
  layout: OcrLayoutResult,
  unit: "小时" | "分钟",
  centerXPercent: number
): Array<{ value: number; candidate: TextLocatorCandidate }> {
  const centerX = layout.width * centerXPercent / 100;
  const maxDistance = layout.width * 0.28;
  const candidates = layout.boxes.map((box) => toCandidate(box));
  const direct = candidates
    .map((candidate) => ({ candidate, parsed: parsePickerNumberUnit(candidate.text) }))
    .filter((entry) => entry.parsed?.unit === unit && Math.abs(entry.candidate.centerX - centerX) <= maxDistance)
    .map((entry) => ({ value: Number(entry.parsed!.number), candidate: entry.candidate }))
    .filter((entry) => Number.isFinite(entry.value));
  const unitCandidates = candidates.filter((candidate) => normalizePickerNumberUnit(compactPickerText(candidate.text)) === unit);
  const split = candidates
    .map((candidate) => ({ candidate, compact: compactPickerText(candidate.text) }))
    .filter((entry) => /^\d+(?:\.\d+)?$/.test(entry.compact) && Math.abs(entry.candidate.centerX - centerX) <= maxDistance)
    .flatMap((entry) => {
      const unitCandidate = unitCandidates
        .filter((candidate) => samePickerRow(entry.candidate, candidate))
        .sort((left, right) => Math.abs(left.centerX - entry.candidate.centerX) - Math.abs(right.centerX - entry.candidate.centerX))[0];
      if (!unitCandidate) {
        return [];
      }
      const x1 = Math.min(entry.candidate.x, unitCandidate.x);
      const y1 = Math.min(entry.candidate.y, unitCandidate.y);
      const x2 = Math.max(entry.candidate.x + entry.candidate.width, unitCandidate.x + unitCandidate.width);
      const y2 = Math.max(entry.candidate.y + entry.candidate.height, unitCandidate.y + unitCandidate.height);
      return [{
        value: Number(entry.compact),
        candidate: {
          text: `${entry.candidate.text} ${unitCandidate.text}`,
          confidence: Math.min(entry.candidate.confidence ?? 0.5, unitCandidate.confidence ?? 0.5),
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          centerX: Math.round((entry.candidate.centerX + unitCandidate.centerX) / 2),
          centerY: Math.round((entry.candidate.centerY + unitCandidate.centerY) / 2)
        }
      }];
    })
    .filter((entry) => Number.isFinite(entry.value));
  return [...new Map([...direct, ...split].map((entry) => [`${entry.value}:${Math.round(entry.candidate.centerY / 8)}`, entry])).values()];
}

function pickerColumnSwipeAction(
  centerXPercent: number,
  direction: "increase" | "decrease",
  deviceSize?: { width: number; height: number },
  geometry?: {
    layout: Pick<OcrLayoutResult, "width" | "height">;
    centerY: number;
    rowSpacing: number;
    rows: number;
  }
): Extract<DeviceActionRequest, { type: "swipe" }> {
  const width = deviceSize?.width ?? 1080;
  const height = deviceSize?.height ?? 2400;
  const x = geometry
    ? scaleCoordinate(geometry.layout.width * centerXPercent / 100, geometry.layout.width, width)
    : Math.round(width * centerXPercent / 100);
  const gestureDistance = geometry
    ? Math.min(
        geometry.layout.height * 0.14,
        Math.max(geometry.layout.height * 0.035, geometry.rowSpacing * geometry.rows)
      )
    : height * 0.18;
  const lowerY = geometry
    ? scaleCoordinate(geometry.centerY + gestureDistance / 2, geometry.layout.height, height)
    : Math.round(height * 0.9);
  const upperY = geometry
    ? scaleCoordinate(geometry.centerY - gestureDistance / 2, geometry.layout.height, height)
    : Math.round(height * 0.72);
  const durationMs = geometry ? Math.min(320, 180 + geometry.rows * 35) : 350;
  return direction === "increase"
      ? { type: "swipe", startX: x, startY: lowerY, endX: x, endY: upperY, durationMs }
      : { type: "swipe", startX: x, startY: upperY, endX: x, endY: lowerY, durationMs };
}

function pickerColumnRowSpacing(
  candidates: Array<PickerColumnCandidate<PickerColumnValue>>,
  layoutHeight: number
): number {
  const centerYs = [...new Set(candidates.map((entry) => Math.round(entry.candidate.centerY)))].sort((left, right) => left - right);
  const distances = centerYs
    .slice(1)
    .map((centerY, index) => centerY - centerYs[index]!)
    .filter((distance) => distance >= layoutHeight * 0.025 && distance <= layoutHeight * 0.12)
    .sort((left, right) => left - right);
  return distances[Math.floor(distances.length / 2)] ?? layoutHeight * 0.045;
}

function pickerColumnMovementRows(
  candidates: Array<PickerColumnCandidate<PickerColumnValue>>,
  current: PickerColumnValue,
  target: PickerColumnValue
): number {
  if (typeof current !== "number" || typeof target !== "number") {
    return 1;
  }
  const values = [...new Set(candidates.map((entry) => entry.value))]
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  const increments = values
    .slice(1)
    .map((value, index) => value - values[index]!)
    .filter((increment) => increment > 0)
    .sort((left, right) => left - right);
  const valueStep = increments[0] ?? 1;
  return Math.max(1, Math.min(3, Math.ceil(Math.abs(target - current) / valueStep)));
}

function findDurationFieldValue(layout: OcrLayoutResult, targetText: string): string | undefined {
  const anchor = targetText ? findTextCandidate(layout, targetText, { mode: "contains" }) : undefined;
  const directCandidates = layout.boxes.flatMap((box) => {
    const compactBox = compactPickerText(box.text);
    if (!/(小时|时)/u.test(compactBox) || !/(分钟|分)/u.test(compactBox)) return [];
    const parsed = parseDurationPickerValue(box.text);
    if (!parsed) return [];
    return [{
      value: formatDurationPickerValue(parsed),
      centerY: box.y + box.height / 2
    }];
  });
  if (anchor && directCandidates.length) {
    const nearest = directCandidates
      .slice()
      .sort((left, right) => Math.abs(left.centerY - anchor.centerY) - Math.abs(right.centerY - anchor.centerY))[0];
    if (nearest && Math.abs(nearest.centerY - anchor.centerY) <= layout.height * 0.08) return nearest.value;
  }
  if (directCandidates.length === 1) return directCandidates[0]!.value;

  const compact = compactPickerText(layout.text);
  const matches = [...compact.matchAll(/(\d+)(?:小时|时)(\d+)(?:分钟|分)/gu)]
    .map((match) => `${Number(match[1])}小时${Number(match[2])}分钟`);
  return [...new Set(matches)].length === 1 ? matches[0] : undefined;
}

function findSplitPickerValueCandidate(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  const target = parsePickerNumberUnit(expected);
  if (!target) {
    return undefined;
  }
  const candidates = layout.boxes.map((box) => toCandidate(box, options.preferredPoint));
  const unitCandidates = candidates.filter((candidate) => {
    const text = compactPickerText(candidate.text);
    return text.includes(target.unit) || (target.unit === "分钟" && text.includes("分")) || (target.unit === "小时" && text.includes("时"));
  });
  const numberCandidates = candidates.filter((candidate) => compactPickerText(candidate.text) === target.number);
  const combined = numberCandidates
    .map((numberCandidate) => {
      const unit = unitCandidates
        .filter((unitCandidate) => samePickerRow(numberCandidate, unitCandidate) && Math.abs(unitCandidate.centerX - numberCandidate.centerX) < layout.width * 0.3)
        .sort((left, right) => Math.abs(left.centerX - numberCandidate.centerX) - Math.abs(right.centerX - numberCandidate.centerX))[0];
      if (!unit) {
        return undefined;
      }
      const x1 = Math.min(numberCandidate.x, unit.x);
      const y1 = Math.min(numberCandidate.y, unit.y);
      const x2 = Math.max(numberCandidate.x + numberCandidate.width, unit.x + unit.width);
      const y2 = Math.max(numberCandidate.y + numberCandidate.height, unit.y + unit.height);
      const candidate: TextLocatorCandidate = {
        text: `${numberCandidate.text} ${unit.text}`,
        confidence: Math.min(numberCandidate.confidence ?? 0.5, unit.confidence ?? 0.5),
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        centerX: Math.round((numberCandidate.centerX + unit.centerX) / 2),
        centerY: Math.round((numberCandidate.centerY + unit.centerY) / 2),
        distanceToPoint: options.preferredPoint ? Math.round(Math.hypot((numberCandidate.centerX + unit.centerX) / 2 - options.preferredPoint.x, (numberCandidate.centerY + unit.centerY) / 2 - options.preferredPoint.y)) : undefined
      };
      return candidate;
    })
    .filter((candidate): candidate is TextLocatorCandidate => Boolean(candidate))
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea);
  const maxDistance = options.maxDistance;
  return combined
    .filter((candidate) => maxDistance === undefined || candidate.distanceToPoint === undefined || candidate.distanceToPoint <= maxDistance)
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
}

function findTextCandidateFromTargets(
  layout: OcrLayoutResult,
  expectedTargets: string[],
  options: {
    mode?: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): TextLocatorCandidate | undefined {
  return expectedTargets
    .map((target) => findTextCandidate(layout, target, options))
    .filter((candidate): candidate is TextLocatorCandidate => Boolean(candidate))
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
}

function findTextCandidateSelectionFromTargets(
  layout: OcrLayoutResult,
  expectedTargets: string[],
  options: {
    mode?: "contains" | "equals";
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
    semanticArea?: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  } = {}
): { candidate?: TextLocatorCandidate; ambiguous: boolean; candidateCount: number } {
  const candidates = expectedTargets
    .flatMap((target) => findTextCandidates(layout, target, options))
    .filter((candidate, index, all) => all.findIndex((item) =>
      item.centerX === candidate.centerX && item.centerY === candidate.centerY && item.text === candidate.text
    ) === index)
    .sort((left, right) => candidateScore(right) - candidateScore(left));
  if (candidates.length <= 1) {
    return { candidate: candidates[0], ambiguous: false, candidateCount: candidates.length };
  }
  const preferredPoint = options.preferredPoint;
  const hasMeaningfulPoint = Boolean(preferredPoint && preferredPoint.x > 0 && preferredPoint.y > 0);
  if (hasMeaningfulPoint) {
    const [best, second] = candidates;
    const bestDistance = best?.distanceToPoint ?? Number.POSITIVE_INFINITY;
    const secondDistance = second?.distanceToPoint ?? Number.POSITIVE_INFINITY;
    if (best && secondDistance - bestDistance >= 48) {
      return { candidate: best, ambiguous: false, candidateCount: candidates.length };
    }
  }
  return { ambiguous: true, candidateCount: candidates.length };
}

function isReasonableClickableTextContainer(
  candidate: UiElementCandidate,
  point: { x: number; y: number },
  deviceSize?: { width: number; height: number }
): boolean {
  if (!candidate.enabled || !candidate.clickable) return false;
  if (!pointInsideUiBounds(candidate, point)) return false;
  if (!deviceSize) return true;
  const viewportArea = deviceSize.width * deviceSize.height;
  if (!viewportArea) return true;
  const areaRatio = candidate.area / viewportArea;
  if (areaRatio > 0.45) return false;
  if (candidate.bounds.width > deviceSize.width * 0.98 && candidate.bounds.height > deviceSize.height * 0.5) return false;
  return true;
}

function pointInsideUiBounds(candidate: UiElementCandidate, point: { x: number; y: number }): boolean {
  return point.x >= candidate.bounds.left
    && point.x <= candidate.bounds.right
    && point.y >= candidate.bounds.top
    && point.y <= candidate.bounds.bottom;
}

export function findNearestTextCandidate(
  layout: OcrLayoutResult,
  point: { x: number; y: number },
  maxDistance = 120
): TextLocatorCandidate | undefined {
  return layout.boxes
    .map((box) => toCandidate(box, point))
    .filter((candidate) => candidate.text && (candidate.distanceToPoint ?? Number.POSITIVE_INFINITY) <= maxDistance)
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
}

function findInputFocusCandidate(
  layout: OcrLayoutResult,
  _region: { x: number; y: number; width: number; height: number },
  _deviceSize: { width: number; height: number } | undefined,
  params: Record<string, unknown>
): TextLocatorCandidate | undefined {
  const targets = inputFocusTextTargets(params);
  const candidates = layout.boxes
    .map((box) => toCandidate(box))
    .filter((candidate) => candidate.text);
  if (!candidates.length) {
    return undefined;
  }
  const scopedCandidate = findScopedTextFieldFocusCandidate(layout, candidates, params);
  if (scopedCandidate) {
    return scopedCandidate;
  }
  if (targets.length) {
    const targeted = candidates.filter((candidate) => targets.some((target) => textMatchesLoosely(candidate.text, target)));
    const directCandidate = targeted
      .slice()
      .sort((left, right) => inputFocusCandidateScore(right, params) - inputFocusCandidateScore(left, params))[0];
    if (directCandidate) {
      return directCandidate;
    }
  }
  return findRelativeInputFocusCandidate(layout, candidates, params);
}

function findScopedTextFieldFocusCandidate(
  layout: OcrLayoutResult,
  candidates: TextLocatorCandidate[],
  params: Record<string, unknown>
): TextLocatorCandidate | undefined {
  const structuralLocator = readRecord(params.structuralLocator);
  if (textParam(structuralLocator?.strategy).trim() !== "scoped_text_field") {
    return undefined;
  }
  const scopeText = textParam(structuralLocator?.scopeText ?? params.scopeText).trim();
  const ordinal = Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.ordinal, 1)));
  if (!scopeText) {
    return undefined;
  }
  const scope = candidates
    .filter((candidate) => textMatchesLoosely(candidate.text, scopeText))
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
  if (!scope) {
    return undefined;
  }
  const maxGapPercent = positiveNumberParam(structuralLocator?.maxVerticalGapPercent, 24);
  const maxGap = Math.max(160, layout.height * maxGapPercent / 100);
  const stableNonInputTexts = new Set([
    normalizeOcrText(scopeText),
    "修改",
    "编辑",
    "教师",
    "老师",
    "课堂时长",
    "开始时间",
    "结束时间"
  ].filter(Boolean));
  const entries = candidates
    .filter((candidate) => candidate !== scope)
    .filter((candidate) => candidate.centerY >= scope.centerY)
    .map((candidate) => ({
      candidate,
      verticalGap: candidate.y - (scope.y + scope.height),
      horizontalBias: Math.abs(candidate.centerX - scope.centerX)
    }))
    .filter((entry) => entry.verticalGap >= 0 && entry.verticalGap <= maxGap)
    .filter((entry) => !stableNonInputTexts.has(normalizeOcrText(entry.candidate.text)));
  const rows = groupScopedTextFieldRows(entries);
  const row = rows[ordinal - 1];
  if (!row) {
    return undefined;
  }
  return row.entries.reduce<{ entry: { candidate: TextLocatorCandidate; verticalGap: number; horizontalBias: number }; score: number } | undefined>(
    (best, entry) => {
      const score = scopedTextFieldRowCandidateScore(entry.candidate, entry.horizontalBias);
      if (!best || score > best.score || (score === best.score && entry.candidate.x < best.entry.candidate.x)) {
        return { entry, score };
      }
      return best;
    },
    undefined
  )?.entry.candidate;
}

function groupScopedTextFieldRows<T extends { candidate: TextLocatorCandidate }>(entries: T[]): Array<{ entries: T[] }> {
  const rows: Array<{ entries: T[] }> = [];
  for (const entry of entries.slice().sort((left, right) =>
    left.candidate.y - right.candidate.y || left.candidate.x - right.candidate.x
  )) {
    const row = rows.find((candidateRow) =>
      candidateRow.entries.some((rowEntry) => sameScopedTextFieldRow(rowEntry.candidate, entry.candidate))
    );
    if (row) {
      row.entries.push(entry);
    } else {
      rows.push({ entries: [entry] });
    }
  }
  return rows.sort((left, right) =>
    Math.min(...left.entries.map((entry) => entry.candidate.y)) - Math.min(...right.entries.map((entry) => entry.candidate.y)) ||
    Math.min(...left.entries.map((entry) => entry.candidate.x)) - Math.min(...right.entries.map((entry) => entry.candidate.x))
  );
}

function sameScopedTextFieldRow(left: TextLocatorCandidate, right: TextLocatorCandidate): boolean {
  const overlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  return overlap / minHeight >= 0.45 || Math.abs(left.centerY - right.centerY) <= Math.max(left.height, right.height);
}

function scopedTextFieldRowCandidateScore(candidate: TextLocatorCandidate, horizontalBias: number): number {
  const compact = normalizeOcrText(candidate.text).replace(/\s+/g, "");
  const widthScore = Math.min(candidate.width, 500) / 100;
  const promptScore = isPromptLikeText(candidate.text) ? 1 : 0;
  const lengthScore = Math.min(compact.length, 24) / 20;
  const shortNumericPrefixPenalty = /^\+?\d{1,4}$/.test(compact) ? 1.5 : 0;
  const confidenceScore = (candidate.confidence ?? 0) / 10;
  const horizontalPenalty = Math.min(horizontalBias, 400) / 1000;
  return widthScore + promptScore + lengthScore + confidenceScore - shortNumericPrefixPenalty - horizontalPenalty;
}

function findRelativeInputFocusCandidate(
  layout: OcrLayoutResult,
  candidates: TextLocatorCandidate[],
  params: Record<string, unknown>
): TextLocatorCandidate | undefined {
  const structuralLocator = readRecord(params.structuralLocator);
  if (textParam(structuralLocator?.strategy).trim() !== "ocr_relative_input") {
    return undefined;
  }
  const relation = relativeInputRelation(textParam(structuralLocator?.relation).trim());
  if (!relation) {
    return undefined;
  }
  const anchorText = textParam(structuralLocator?.anchorText ?? params.anchorText).trim();
  if (!anchorText) {
    return undefined;
  }
  const anchors = candidates
    .filter((candidate) => textMatchesLoosely(candidate.text, anchorText))
    .sort((left, right) => candidateScore(right) - candidateScore(left));
  const anchor = anchors[0];
  if (!anchor) {
    return undefined;
  }
  const maxGapPercent = positiveNumberParam(structuralLocator?.maxVerticalGapPercent, 18);
  const maxGap = relativeInputMaxGap(layout, relation, maxGapPercent);
  return candidates
    .filter((candidate) => candidate !== anchor)
    .map((candidate) => relativeInputCandidateEntry(candidate, anchor, relation))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .filter((entry) => entry.gap >= 0 && entry.gap <= maxGap && entry.crossAxisDistance <= entry.crossAxisLimit)
    .sort((left, right) =>
      left.gap - right.gap ||
      left.crossAxisDistance - right.crossAxisDistance ||
      candidateScore(right.candidate) - candidateScore(left.candidate)
    )[0]?.candidate;
}

type RelativeInputRelation = "nearest_text_above" | "nearest_text_below" | "nearest_text_left" | "nearest_text_right";

function relativeInputRelation(value: string): RelativeInputRelation | undefined {
  if (value === "nearest_text_above" || value === "nearest_text_below" || value === "nearest_text_left" || value === "nearest_text_right") {
    return value;
  }
  return undefined;
}

function relativeInputMaxGap(layout: OcrLayoutResult, relation: RelativeInputRelation, maxGapPercent: number): number {
  const axisSize = relation === "nearest_text_left" || relation === "nearest_text_right" ? layout.width : layout.height;
  return Math.max(80, axisSize * maxGapPercent / 100);
}

function relativeInputCandidateEntry(
  candidate: TextLocatorCandidate,
  anchor: TextLocatorCandidate,
  relation: RelativeInputRelation
): { candidate: TextLocatorCandidate; gap: number; crossAxisDistance: number; crossAxisLimit: number } | undefined {
  if (relation === "nearest_text_above") {
    return candidate.centerY < anchor.centerY
      ? {
          candidate,
          gap: anchor.y - (candidate.y + candidate.height),
          crossAxisDistance: Math.abs(candidate.centerX - anchor.centerX),
          crossAxisLimit: Number.POSITIVE_INFINITY
        }
      : undefined;
  }
  if (relation === "nearest_text_below") {
    return candidate.centerY > anchor.centerY
      ? {
          candidate,
          gap: candidate.y - (anchor.y + anchor.height),
          crossAxisDistance: Math.abs(candidate.centerX - anchor.centerX),
          crossAxisLimit: Number.POSITIVE_INFINITY
        }
      : undefined;
  }
  const sameRowLimit = Math.max(anchor.height, candidate.height, 80);
  if (relation === "nearest_text_left") {
    return candidate.centerX < anchor.centerX
      ? {
          candidate,
          gap: anchor.x - (candidate.x + candidate.width),
          crossAxisDistance: Math.abs(candidate.centerY - anchor.centerY),
          crossAxisLimit: sameRowLimit
        }
      : undefined;
  }
  return candidate.centerX > anchor.centerX
    ? {
        candidate,
        gap: candidate.x - (anchor.x + anchor.width),
        crossAxisDistance: Math.abs(candidate.centerY - anchor.centerY),
        crossAxisLimit: sameRowLimit
      }
    : undefined;
}

function isRelativeInputStructure(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(structuralLocator?.strategy).trim() === "ocr_relative_input";
}

function isScopedTextFieldStructure(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(structuralLocator?.strategy).trim() === "scoped_text_field";
}

function findInputIdentityCandidate(
  layout: OcrLayoutResult,
  expected: string,
  options: {
    semanticArea?: VisualSemanticArea;
    percentRegion?: { x: number; y: number; width: number; height: number };
    deviceSize?: { width: number; height: number };
  }
): { candidate: TextLocatorCandidate; strategy: string } | undefined {
  const expectedDigits = numericIdentityDigits(expected);
  if (!expectedDigits || !options.percentRegion) {
    return undefined;
  }
  const candidate = layout.boxes
    .map((box) => toCandidate(box))
    .filter((item) => item.text && candidateInsidePercentRegion(item, options.percentRegion!, layout, options.deviceSize))
    .filter((item) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(item, layout, options.deviceSize) === options.semanticArea)
    .filter((item) => numericIdentityCandidateMatches(item.text, expectedDigits))
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
  return candidate ? { candidate, strategy: "input_identity_target_region" } : undefined;
}

function numericIdentityCandidateMatches(actual: string, expectedDigits: string): boolean {
  const actualDigits = numericIdentityDigits(actual);
  if (!actualDigits) {
    return false;
  }
  return actualDigits === expectedDigits || actualDigits === `86${expectedDigits}` || actualDigits === `0086${expectedDigits}`;
}

function numericIdentityDigits(value: string): string | undefined {
  const normalized = toAsciiDigits(normalizeOcrText(value));
  if (!/^[+\d\s().-]+$/.test(normalized)) {
    return undefined;
  }
  const digits = normalized.replace(/\D+/g, "");
  return digits.length >= 6 && digits.length <= 18 ? digits : undefined;
}

function toAsciiDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
}

function inputFocusTextTargets(params: Record<string, unknown>): string[] {
  return Array.from(new Set([
    textParam(params.inputFocusText),
    textParam(params.placeholderText),
    textParam(params.targetText),
    textParam(params.elementLabel),
    textParam(params.pageTaskStepLabel),
    textParam(params.label)
  ].map((value) => normalizeOcrText(value).trim()).filter(Boolean)));
}

function inputFocusCandidateScore(candidate: TextLocatorCandidate, params: Record<string, unknown>): number {
  const text = normalizeOcrText(candidate.text);
  const targets = inputFocusTextTargets(params);
  const targetBonus = targets.some((target) => textMatchesLoosely(text, target)) ? 3 : 0;
  const placeholderBonus = isPromptLikeText(text) ? 1 : 0;
  const leftBias = Math.max(0, 1 - candidate.centerX / 2000) / 10;
  return candidateScore(candidate) + targetBonus + placeholderBonus + leftBias;
}

function verifyInputTargetRegion(
  layout: OcrLayoutResult,
  text: string,
  options: {
    params: Record<string, unknown>;
    percentRegion?: { x: number; y: number; width: number; height: number };
    deviceSize?: { width: number; height: number };
    allowUnreadableTargetRegion?: boolean;
    unreadableTargetRegionStrategy?: string;
  }
): { verified: boolean; strategy: string } | undefined {
  if (!options.percentRegion) {
    return undefined;
  }
  const mode = tapTextMatchMode(options.params.inputVerificationMode ?? "contains");
  const expectedText = normalizeOcrText(text);
  const candidates = layout.boxes.map((box) => toCandidate(box));
  const expectedOutsideTarget = candidates.some((candidate) =>
    candidate.text &&
    matchTextExpectation(normalizeOcrText(candidate.text), expectedText, mode) &&
    !candidateInsidePercentRegion(candidate, options.percentRegion!, layout, options.deviceSize)
  );
  if (expectedOutsideTarget) {
    return {
      verified: false,
      strategy: "clear_text_outside_target_region"
    };
  }
  const targetCandidates = candidates.filter((candidate) =>
    candidate.text && candidateInsidePercentRegion(candidate, options.percentRegion!, layout, options.deviceSize)
  );
  if (!targetCandidates.length) {
    return (options.allowUnreadableTargetRegion === true || isSensitiveInput(options.params))
      ? {
          verified: true,
          strategy: options.unreadableTargetRegionStrategy ?? "sensitive_target_region_unreadable"
        }
      : undefined;
  }
  if (targetCandidates.some((candidate) => isLikelyInputPlaceholder(candidate.text, options.params))) {
    return {
      verified: false,
      strategy: "target_region_still_placeholder"
    };
  }
  if (targetCandidates.some((candidate) => isMaskedInputText(candidate.text))) {
    return {
      verified: true,
      strategy: "masked_target_region"
    };
  }
  if (!isSensitiveInput(options.params)) {
    return undefined;
  }
  return {
    verified: true,
    strategy: "changed_target_region"
  };
}

function isEmptyOcrLayout(layout: OcrLayoutResult): boolean {
  return !normalizeOcrText(layout.text) && layout.boxes.length === 0;
}

function isSensitiveInput(params: Record<string, unknown>): boolean {
  if (params.sensitiveInput === true) {
    return true;
  }
  const values = [
    textParam(params.valueParamKey),
    textParam(params.fieldType),
    textParam(params.elementLabel),
    textParam(params.pageTaskStepLabel),
    textParam(params.targetText),
    textParam(params.label)
  ].join(" ").toLowerCase();
  return values.includes("password") || values.includes("passwd") || values.includes("pwd") || values.includes("密码");
}

function isLikelyInputPlaceholder(text: string, params: Record<string, unknown>): boolean {
  const normalized = normalizeOcrText(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (inputFocusTextTargets(params).some((target) => textMatchesLoosely(normalized, target))) {
    return true;
  }
  return isPromptLikeText(normalized);
}

function isPromptLikeText(text: string): boolean {
  const normalized = normalizeOcrText(text).toLowerCase();
  return normalized.includes("请输入") || normalized.includes("pleaseenter") || normalized.includes("input") || normalized.includes("enter");
}

function isMaskedInputText(text: string): boolean {
  const normalized = normalizeOcrText(text);
  return normalized.length > 0 && /^[•●*·]+$/.test(normalized);
}

function textMatchesLoosely(actual: string, expected: string): boolean {
  const actualText = normalizeOcrText(actual).toLowerCase();
  const expectedText = normalizeOcrText(expected).toLowerCase();
  return Boolean(actualText && expectedText && (actualText.includes(expectedText) || expectedText.includes(actualText)));
}

function toCandidate(box: OcrTextBox, point?: { x: number; y: number }): TextLocatorCandidate {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return {
    text: normalizeOcrText(box.text),
    confidence: box.confidence,
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    centerX: Math.round(centerX),
    centerY: Math.round(centerY),
    distanceToPoint: point ? Math.round(distanceToRect(point, box)) : undefined
  };
}

function candidateScore(candidate: TextLocatorCandidate): number {
  const confidence = candidate.confidence ?? 0.5;
  const distanceScore = candidate.distanceToPoint === undefined ? 0 : -candidate.distanceToPoint / 1000;
  const sizeScore = Math.min(1, (candidate.width * candidate.height) / 10000) / 10;
  return confidence + distanceScore + sizeScore;
}

function compactPickerText(value: string): string {
  return normalizeOcrText(value).replace(/\s+/g, "");
}

function parsePickerNumberUnit(value: string): { number: string; unit: "小时" | "分钟" | "天" | "月" | "年" } | undefined {
  const compact = compactPickerText(value);
  const match = compact.match(/^(\d+(?:\.\d+)?)(分钟|分|小时|时|天|月|年)$/);
  if (!match) {
    return undefined;
  }
  const unit = normalizePickerNumberUnit(match[2] ?? "");
  if (!unit) {
    return undefined;
  }
  return {
    number: match[1] ?? "",
    unit
  };
}

function normalizePickerNumberUnit(unit: string): "小时" | "分钟" | "天" | "月" | "年" | undefined {
  if (unit === "小时" || unit === "时") return "小时";
  if (unit === "分钟" || unit === "分") return "分钟";
  if (unit === "天" || unit === "月" || unit === "年") return unit;
  return undefined;
}

function samePickerRow(left: TextLocatorCandidate, right: TextLocatorCandidate): boolean {
  const overlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  const minHeight = Math.max(1, Math.min(left.height, right.height));
  return overlap / minHeight >= 0.45 || Math.abs(left.centerY - right.centerY) <= Math.max(left.height, right.height);
}

function distanceToRect(point: { x: number; y: number }, box: OcrTextBox): number {
  const dx = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const dy = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

function recordedPoint(step: ActionStep, deviceSize?: { width: number; height: number }): { x: number; y: number } | undefined {
  if (typeof step.coordinate?.x === "number" && typeof step.coordinate?.y === "number") {
    return {
      x: step.coordinate.x,
      y: step.coordinate.y
    };
  }
  if (
    typeof step.coordinate?.xRatio === "number" &&
    typeof step.coordinate?.yRatio === "number" &&
    typeof deviceSize?.width === "number" &&
    typeof deviceSize.height === "number"
  ) {
    return {
      x: step.coordinate.xRatio * deviceSize.width,
      y: step.coordinate.yRatio * deviceSize.height
    };
  }
  return undefined;
}

function scaleCoordinate(value: number, sourceSize: number, targetSize: number | undefined): number {
  if (!targetSize || !sourceSize || sourceSize === targetSize) {
    return Math.round(value);
  }
  return Math.round((value / sourceSize) * targetSize);
}

function textCandidateDevicePoint(
  candidate: TextLocatorCandidate,
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: scaleCoordinate(candidate.centerX, layout.width, deviceSize?.width),
    y: scaleCoordinate(candidate.centerY, layout.height, deviceSize?.height)
  };
}

function textParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function canInputTextWithKeyEvents(text: string): boolean {
  return /^[0-9a-zA-Z .,\n-]+$/.test(text);
}

function isRetryableInputFocusResolver(resolvedBy: string): boolean {
  return resolvedBy === "ocr_text_semantic" ||
    resolvedBy === "ocr_relative_structure" ||
    resolvedBy === "scoped_text_field" ||
    resolvedBy === "ui_edit_text_structural";
}

function shouldAllowUnreadableTargetRegionAfterInput(
  focus: {
    resolvedBy: string;
    candidate?: TextLocatorCandidate;
  },
  params: Record<string, unknown>
): boolean {
  return isRetryableInputFocusResolver(focus.resolvedBy) &&
    Boolean(focus.candidate && isLikelyInputPlaceholder(focus.candidate.text, params));
}

function pageTaskSemanticMetadata(params: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const fieldType = textParam(params.fieldType).trim();
  if (fieldType) {
    metadata.fieldType = fieldType;
  }
  const selectedValue = textParam(params.selectedValue).trim();
  if (selectedValue) {
    metadata.selectedValue = selectedValue;
  }
  const desiredState = textParam(params.desiredState).trim();
  if (desiredState) {
    metadata.desiredState = desiredState;
  }
  const valueParamKey = textParam(params.valueParamKey).trim();
  if (valueParamKey) {
    metadata.valueParamKey = valueParamKey;
  }
  const desiredStateParamKey = textParam(params.desiredStateParamKey).trim();
  if (desiredStateParamKey) {
    metadata.desiredStateParamKey = desiredStateParamKey;
  }
  if (params.subpageEdit === true) {
    metadata.subpageEdit = true;
  }
  return metadata;
}

function imageRegionTargetText(params: Record<string, unknown>, semanticArea: VisualSemanticArea): string {
  const explicitTarget = textParam(params.targetText ?? params.text).trim();
  if (explicitTarget) {
    return explicitTarget;
  }
  return shouldRevealAfterScroll(params, semanticArea) ? textParam(params.elementLabel ?? params.label).trim() : "";
}

function arrayTextParam(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.map((item) => textParam(item).trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function numberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tapTextTargets(params: Record<string, unknown>): string[] {
  const primary = textParam(params.text ?? params.expected).trim();
  const alternatives = Array.isArray(params.textAlternatives)
    ? params.textAlternatives.map((item) => textParam(item).trim()).filter(Boolean)
    : [];
  return Array.from(new Set([primary, ...alternatives].filter(Boolean)));
}

function tapTextMatchMode(value: unknown): "contains" | "equals" {
  return textExpectationMode(value) === "equals" ? "equals" : "contains";
}

function readTextSearchMode(value: unknown): "auto" | "visibleOnly" | "scroll" {
  return value === "auto" || value === "scroll" ? value : "visibleOnly";
}

function readTextSearchDirection(value: unknown): "up" | "down" | "both" {
  return value === "up" || value === "both" ? value : "down";
}

function textSearchLayoutSignature(
  layout: OcrLayoutResult,
  semanticArea: VisualSemanticArea | undefined,
  deviceSize: { width: number; height: number } | undefined
): string {
  return layout.boxes
    .map((box) => toCandidate(box))
    .filter((candidate) => !semanticArea || semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, deviceSize) === semanticArea)
    .map((candidate) => normalizeOcrText(candidate.text))
    .filter(Boolean)
    .sort()
    .join("|");
}

function stableSearchSignature(signature: string): boolean {
  return signature.trim().length > 0 && !signature.startsWith("runtime-interceptor:");
}

function compactSearchSignature(signature: string): string {
  return signature.length <= 240 ? signature : `${signature.slice(0, 240)}...`;
}

function normalizeToggleState(value: unknown): "on" | "off" | undefined {
  const text = textParam(value).trim().toLowerCase();
  if (["on", "true", "1", "yes", "enabled", "checked", "open", "开启", "打开", "选中"].includes(text)) {
    return "on";
  }
  if (["off", "false", "0", "no", "disabled", "unchecked", "close", "关闭", "关", "未选中"].includes(text)) {
    return "off";
  }
  return undefined;
}

function readElementLocator(params: Record<string, unknown>): UiElementLocator {
  const locator = typeof params.locator === "object" && params.locator !== null ? (params.locator as Record<string, unknown>) : params;
  const contentDesc = textParam(locator.contentDesc ?? locator.accessibilityId ?? locator.contentDescription);
  return sanitizeLocator({
    strategy: locator.strategy === "android_uiautomator" ? "android_uiautomator" : undefined,
    resourceId: textParam(locator.resourceId),
    text: textParam(locator.text),
    textMatchMode: locator.textMatchMode === "contains" || locator.textMatchMode === "equals" ? locator.textMatchMode : undefined,
    excludeTexts: arrayTextParam(locator.excludeTexts),
    occurrence: numberParam(locator.occurrence),
    tapTarget: locator.tapTarget === "self" || locator.tapTarget === "clickable_ancestor" ? locator.tapTarget : undefined,
    contentDesc,
    className: textParam(locator.className),
    packageName: textParam(locator.packageName)
  });
}

function describeElementLocator(locator: UiElementLocator): string {
  if (locator.resourceId) {
    return `id=${locator.resourceId}`;
  }
  if (locator.contentDesc) {
    return `desc=${locator.contentDesc}`;
  }
  if (locator.text) {
    return `text=${locator.text}`;
  }
  return "android_uiautomator";
}

function scrollDirectionParam(value: unknown): "up" | "down" | "left" | "right" | undefined {
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : undefined;
}

function scrollSwipeAction(
  direction: unknown,
  deviceSize?: { width: number; height: number }
): Extract<DeviceActionRequest, { type: "swipe" }> {
  const width = deviceSize?.width ?? 1080;
  const height = deviceSize?.height ?? 2400;
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2);
  const startY = Math.round(height * 0.75);
  const endY = Math.round(height * 0.25);
  const startX = Math.round(width * 0.75);
  const endX = Math.round(width * 0.25);
  if (direction === "up") {
    return { type: "swipe", startX: centerX, startY: endY, endX: centerX, endY: startY, durationMs: 450 };
  }
  if (direction === "left") {
    return { type: "swipe", startX, startY: centerY, endX, endY: centerY, durationMs: 450 };
  }
  if (direction === "right") {
    return { type: "swipe", startX: endX, startY: centerY, endX: startX, endY: centerY, durationMs: 450 };
  }
  return { type: "swipe", startX: centerX, startY, endX: centerX, endY, durationMs: 450 };
}

function gridSearchSwipeAction(
  region: { x: number; y: number; width: number; height: number },
  scrollProfile: GridScrollProfile,
  deviceSize?: { width: number; height: number }
): Extract<DeviceActionRequest, { type: "swipe" }> {
  const width = deviceSize?.width ?? 1080;
  const height = deviceSize?.height ?? 2400;
  const left = (region.x / 100) * width;
  const top = (region.y / 100) * height;
  const regionWidth = (region.width / 100) * width;
  const regionHeight = (region.height / 100) * height;
  const centerX = Math.round(left + regionWidth / 2);
  const centerY = Math.round(top + regionHeight / 2);
  const step = (scrollProfile.scrollStepPercent / 100) * (scrollProfile.direction === "horizontal" ? regionWidth : regionHeight);
  if (scrollProfile.direction === "horizontal") {
    return {
      type: "swipe",
      startX: Math.round(centerX + step / 2),
      startY: centerY,
      endX: Math.round(centerX - step / 2),
      endY: centerY,
      durationMs: 450
    };
  }
  return {
    type: "swipe",
    startX: centerX,
    startY: Math.round(centerY + step / 2),
    endX: centerX,
    endY: Math.round(centerY - step / 2),
    durationMs: 450
  };
}

function reverseGridSearchSwipeAction(
  region: { x: number; y: number; width: number; height: number },
  scrollProfile: GridScrollProfile,
  deviceSize?: { width: number; height: number }
): Extract<DeviceActionRequest, { type: "swipe" }> {
  const action = gridSearchSwipeAction(region, scrollProfile, deviceSize);
  return {
    ...action,
    startX: action.endX,
    startY: action.endY,
    endX: action.startX,
    endY: action.startY
  };
}

function readPercentRegion(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = numberParam(input.x);
  const y = numberParam(input.y);
  const width = numberParam(input.width);
  const height = numberParam(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
}

function readGridCandidateSearchHintRegion(params: Record<string, unknown>): { x: number; y: number; width: number; height: number } | undefined {
  if (params.abilityType !== "grid_candidate") {
    return undefined;
  }
  const structuralLocator = readRecord(params.structuralLocator);
  return readPercentRegion(structuralLocator?.searchHintRegion ?? params.searchHintRegion);
}

function readGridCandidateSemanticRegion(params: Record<string, unknown>): { x: number; y: number; width: number; height: number } | undefined {
  if (!gridCandidateRequiresTargetQuery(params)) return undefined;
  const semanticArea = readSemanticArea(params.semanticArea) ?? "content";
  if (semanticArea === "top") return { x: 0, y: 0, width: 100, height: 14 };
  if (semanticArea === "bottom") return { x: 0, y: 88, width: 100, height: 12 };
  if (semanticArea === "unknown") return { x: 0, y: 0, width: 100, height: 100 };
  return { x: 0, y: 14, width: 100, height: 74 };
}

function readScrollProfile(value: unknown): GridScrollProfile {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    containerKind: textParam(input.containerKind),
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    columns: Math.max(1, Math.floor(numberParam(input.columns) ?? 1)),
    targetKind: textParam(input.targetKind),
    targetQuery: textParam(input.targetQuery),
    candidateItemHeightPercent: percentNumber(input.candidateItemHeightPercent),
    maxSearchSwipes: optionalNonNegativeNumberParam(input.maxSearchSwipes),
    maxScrollAttempts: optionalNonNegativeNumberParam(input.maxScrollAttempts),
    maxSwipes: optionalNonNegativeNumberParam(input.maxSwipes),
    clickSafePoint: readClickSafePoint(input.clickSafePoint),
    scrollStepPercent: percentNumber(input.scrollStepPercent) ?? 65
  };
}

function maxGridSearchSwipes(params: Record<string, unknown>, scrollProfile: GridScrollProfile): number {
  const configured =
    optionalNonNegativeNumberParam(params.maxSearchSwipes) ??
    optionalNonNegativeNumberParam(params.maxScrollAttempts) ??
    optionalNonNegativeNumberParam(params.maxSwipes) ??
    scrollProfile.maxSearchSwipes ??
    scrollProfile.maxScrollAttempts ??
    scrollProfile.maxSwipes;
  if (configured !== undefined) {
    return Math.max(0, Math.floor(configured));
  }
  return 20;
}

function gridSearchStrategy(params: Record<string, unknown>, scrollProfile: GridScrollProfile): "current_then_top_down" | "current_then_direction" {
  const raw = textParam(params.searchStrategy ?? params.gridSearchStrategy).trim();
  if (raw === "current_then_direction") {
    return "current_then_direction";
  }
  return scrollProfile.direction === "vertical" ? "current_then_top_down" : "current_then_direction";
}

function readClickSafePoint(value: unknown): GridScrollProfile["clickSafePoint"] {
  if (!value || typeof value !== "object") {
    return { xPercent: 50, yPercent: 28 };
  }
  const input = value as Record<string, unknown>;
  return {
    xPercent: percentNumber(input.xPercent) ?? 50,
    yPercent: percentNumber(input.yPercent) ?? 28
  };
}

function candidateInsidePercentRegion(
  candidate: TextLocatorCandidate,
  region: { x: number; y: number; width: number; height: number },
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): boolean {
  const point = candidatePercentPoint(candidate, layout, deviceSize);
  return point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height;
}

function gridSearchLayoutSignature(
  layout: OcrLayoutResult,
  region: { x: number; y: number; width: number; height: number },
  deviceSize?: { width: number; height: number }
): string {
  const width = deviceSize?.width ?? layout.width;
  const height = deviceSize?.height ?? layout.height;
  const parts = layout.boxes
    .map((box) => {
      const centerX = scaleCoordinate(box.x + box.width / 2, layout.width, width);
      const centerY = scaleCoordinate(box.y + box.height / 2, layout.height, height);
      const percentX = width ? (centerX / width) * 100 : 0;
      const percentY = height ? (centerY / height) * 100 : 0;
      return {
        text: normalizeOcrText(box.text),
        x: Math.round(percentX / 2) * 2,
        y: Math.round(percentY / 2) * 2,
        inside: percentX >= region.x && percentX <= region.x + region.width && percentY >= region.y && percentY <= region.y + region.height
      };
    })
    .filter((item) => item.inside && item.text)
    .map((item) => `${item.text}@${item.x},${item.y}`)
    .sort();
  return parts.length ? parts.join("|") : normalizeOcrText(layout.text).slice(0, 240);
}

function inputVerificationRegion(
  recordedRegion: { x: number; y: number; width: number; height: number },
  focus: {
    candidate?: TextLocatorCandidate;
    uiCandidate?: UiElementCandidate;
  },
  deviceSize?: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  if (focus.candidate && deviceSize) {
    return paddedPercentRegion(
      {
        x: (focus.candidate.x / deviceSize.width) * 100,
        y: (focus.candidate.y / deviceSize.height) * 100,
        width: (focus.candidate.width / deviceSize.width) * 100,
        height: (focus.candidate.height / deviceSize.height) * 100
      },
      { x: 4, y: 2 }
    );
  }
  if (focus.uiCandidate && deviceSize) {
    return paddedPercentRegion(
      {
        x: (focus.uiCandidate.bounds.left / deviceSize.width) * 100,
        y: (focus.uiCandidate.bounds.top / deviceSize.height) * 100,
        width: (focus.uiCandidate.bounds.width / deviceSize.width) * 100,
        height: (focus.uiCandidate.bounds.height / deviceSize.height) * 100
      },
      inputUiCandidateVerificationPadding(focus.uiCandidate, deviceSize)
    );
  }
  return recordedRegion;
}

function inputVerificationRegionSource(focus: {
  candidate?: TextLocatorCandidate;
  uiCandidate?: UiElementCandidate;
}): "recorded_region" | "runtime_focus_candidate" | "runtime_ui_candidate" {
  if (focus.candidate) {
    return "runtime_focus_candidate";
  }
  if (focus.uiCandidate) {
    return "runtime_ui_candidate";
  }
  return "recorded_region";
}

function inputVerificationRegionFromUiCandidate(
  candidate: UiElementCandidate,
  deviceSize?: { width: number; height: number }
): { x: number; y: number; width: number; height: number } | undefined {
  if (!deviceSize) {
    return undefined;
  }
  return paddedPercentRegion(
    {
      x: (candidate.bounds.left / deviceSize.width) * 100,
      y: (candidate.bounds.top / deviceSize.height) * 100,
      width: (candidate.bounds.width / deviceSize.width) * 100,
      height: (candidate.bounds.height / deviceSize.height) * 100
    },
    inputUiCandidateVerificationPadding(candidate, deviceSize)
  );
}

function inputUiCandidateVerificationPadding(
  candidate: UiElementCandidate,
  deviceSize: { width: number; height: number }
): { x: number; y: number } {
  const widthPercent = deviceSize.width ? (candidate.bounds.width / deviceSize.width) * 100 : 0;
  const heightPercent = deviceSize.height ? (candidate.bounds.height / deviceSize.height) * 100 : 0;
  return {
    x: Math.min(8, Math.max(3, widthPercent * 0.08)),
    y: Math.min(8, Math.max(4, heightPercent))
  };
}

function paddedPercentRegion(
  region: { x: number; y: number; width: number; height: number },
  padding: { x: number; y: number }
): { x: number; y: number; width: number; height: number } {
  const left = Math.max(0, region.x - padding.x);
  const top = Math.max(0, region.y - padding.y);
  const right = Math.min(100, region.x + region.width + padding.x);
  const bottom = Math.min(100, region.y + region.height + padding.y);
  return {
    x: roundPercent(left),
    y: roundPercent(top),
    width: roundPercent(Math.max(0.01, right - left)),
    height: roundPercent(Math.max(0.01, bottom - top))
  };
}

function isInputUiElementCandidate(candidate: UiElementCandidate): boolean {
  const className = candidate.className?.toLowerCase() ?? "";
  return isTextInputUiClass(className);
}

function findUpdatedInputUiCandidate(
  sourceCandidate: UiElementCandidate,
  candidates: UiElementCandidate[]
): UiElementCandidate | undefined {
  return candidates
    .map((candidate) => ({
      candidate,
      score: updatedInputUiCandidateScore(sourceCandidate, candidate),
      distance: uiCandidateCenterDistance(sourceCandidate, candidate)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.distance - right.distance)[0]?.candidate;
}

function updatedInputUiCandidateScore(sourceCandidate: UiElementCandidate, candidate: UiElementCandidate): number {
  const sameResource = Boolean(sourceCandidate.resourceId && candidate.resourceId === sourceCandidate.resourceId);
  const samePackage = !sourceCandidate.packageName || !candidate.packageName || candidate.packageName === sourceCandidate.packageName;
  const sameClass = Boolean(sourceCandidate.className && candidate.className === sourceCandidate.className);
  const overlapRatio = uiCandidateBoundsOverlapRatio(sourceCandidate, candidate);
  const distance = uiCandidateCenterDistance(sourceCandidate, candidate);
  const closeDistance = Math.max(48, Math.min(sourceCandidate.bounds.width, sourceCandidate.bounds.height));
  if (sameResource && samePackage) {
    return 100 + (sameClass ? 10 : 0) + overlapRatio * 20 - Math.min(distance / 1000, 1);
  }
  if (sameClass && (overlapRatio >= 0.45 || distance <= closeDistance)) {
    return 40 + overlapRatio * 20 - Math.min(distance / 1000, 1);
  }
  return 0;
}

function inputUiCandidateTextValues(candidate: UiElementCandidate): string[] {
  return Array.from(new Set([
    textParam(candidate.text),
    textParam(candidate.contentDesc)
  ].map((value) => normalizeOcrText(value).trim()).filter(Boolean)));
}

function uiCandidateBoundsOverlapRatio(left: UiElementCandidate, right: UiElementCandidate): number {
  const leftRect = uiCandidateRect(left);
  const rightRect = uiCandidateRect(right);
  const overlap = rectIntersectionArea(leftRect, rightRect);
  const minArea = Math.min(leftRect.width * leftRect.height, rightRect.width * rightRect.height);
  return minArea > 0 ? overlap / minArea : 0;
}

function uiCandidateRect(candidate: UiElementCandidate): { x: number; y: number; width: number; height: number } {
  return {
    x: candidate.bounds.left,
    y: candidate.bounds.top,
    width: candidate.bounds.width,
    height: candidate.bounds.height
  };
}

function uiCandidateCenterDistance(left: UiElementCandidate, right: UiElementCandidate): number {
  return Math.hypot(left.bounds.centerX - right.bounds.centerX, left.bounds.centerY - right.bounds.centerY);
}

function inputUiCandidateScore(
  candidate: UiElementCandidate,
  allCandidates: UiElementCandidate[],
  inputCandidates: UiElementCandidate[],
  targets: string[],
  params: Record<string, unknown>
): { total: number; semanticEvidence: number } {
  const text = normalizeOcrText(candidate.text ?? candidate.contentDesc ?? "");
  const targetBonus = targets.some((target) => textMatchesLoosely(text, target)) ? 4 : 0;
  const nearbyTargetBonus = inputNearbyTargetScore(candidate, allCandidates, targets);
  const orderBonus = inputOrderEvidenceScore(candidate, inputCandidates, params);
  const classBonus = isTextInputUiClass(candidate.className?.toLowerCase() ?? "") ? 3 : 0;
  const focusBonus = candidate.focusable ? 1 : 0;
  const clickBonus = candidate.clickable || candidate.longClickable ? 0.5 : 0;
  const areaPenalty = Math.min(candidate.area / 1_000_000, 1);
  const semanticEvidence = targetBonus + nearbyTargetBonus + orderBonus;
  return {
    total: classBonus + focusBonus + clickBonus + semanticEvidence - areaPenalty,
    semanticEvidence
  };
}

function inputNearbyTargetScore(candidate: UiElementCandidate, allCandidates: UiElementCandidate[], targets: string[]): number {
  if (!targets.length) {
    return 0;
  }
  const targetCandidates = allCandidates.filter((item) => {
    if (item.nodeId === candidate.nodeId) {
      return false;
    }
    const text = normalizeOcrText(item.text ?? item.contentDesc ?? "");
    return text && targets.some((target) => textMatchesLoosely(text, target));
  });
  if (!targetCandidates.length) {
    return 0;
  }
  const best = targetCandidates
    .map((target) => inputNearbyTargetRelationScore(candidate, target))
    .sort((left, right) => right - left)[0] ?? 0;
  return best;
}

function inputNearbyTargetRelationScore(input: UiElementCandidate, target: UiElementCandidate): number {
  const margin = Math.max(24, Math.round(input.bounds.height * 0.35));
  const expanded = {
    left: input.bounds.left - margin,
    top: input.bounds.top - margin,
    right: input.bounds.right + margin,
    bottom: input.bounds.bottom + margin
  };
  if (
    target.bounds.centerX >= expanded.left &&
    target.bounds.centerX <= expanded.right &&
    target.bounds.centerY >= expanded.top &&
    target.bounds.centerY <= expanded.bottom
  ) {
    return 4;
  }
  const sameRow = Math.abs(target.bounds.centerY - input.bounds.centerY) <= Math.max(input.bounds.height, target.bounds.height);
  const nearLeft = target.bounds.right <= input.bounds.left && input.bounds.left - target.bounds.right <= Math.max(input.bounds.width * 0.4, 180);
  if (sameRow && nearLeft) {
    return 2.5;
  }
  const verticalGap = Math.max(0, Math.max(input.bounds.top, target.bounds.top) - Math.min(input.bounds.bottom, target.bounds.bottom));
  const horizontalOverlap = Math.max(0, Math.min(input.bounds.right, target.bounds.right) - Math.max(input.bounds.left, target.bounds.left));
  if (verticalGap <= Math.max(48, input.bounds.height * 0.5) && horizontalOverlap >= Math.min(input.bounds.width, target.bounds.width) * 0.35) {
    return 2;
  }
  return 0;
}

function inputOrderEvidenceScore(
  candidate: UiElementCandidate,
  inputCandidates: UiElementCandidate[],
  params: Record<string, unknown>
): number {
  const orderHint = inputOrderHint(params);
  if (orderHint === undefined) {
    return 0;
  }
  const ordered = inputCandidates
    .slice()
    .sort((left, right) => left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left);
  const index = ordered.findIndex((item) => item.nodeId === candidate.nodeId);
  return index === orderHint ? 2.5 : 0;
}

function inputOrderHint(params: Record<string, unknown>): number | undefined {
  const structuralLocator = readRecord(params.structuralLocator);
  const structuralOrdinal = structuralTextFieldOrderHint(structuralLocator);
  if (structuralOrdinal !== undefined) {
    return structuralOrdinal;
  }
  const valueParamKey = textParam(params.valueParamKey).toLowerCase();
  const labelText = [
    textParam(params.inputFocusText),
    textParam(params.placeholderText),
    textParam(params.targetText),
    textParam(params.elementLabel),
    textParam(params.pageTaskStepLabel),
    textParam(params.label)
  ].join(" ").toLowerCase();
  if (valueParamKey.includes("password") || labelText.includes("密码") || labelText.includes("password")) {
    return 1;
  }
  if (
    valueParamKey.includes("phone") ||
    valueParamKey.includes("mobile") ||
    labelText.includes("手机号") ||
    labelText.includes("邮箱") ||
    labelText.includes("phone") ||
    labelText.includes("mobile")
  ) {
    return 0;
  }
  return undefined;
}

function structuralTextFieldOrderHint(structuralLocator: Record<string, unknown> | undefined): number | undefined {
  const strategy = textParam(structuralLocator?.strategy).trim();
  const ordinal = numberParam(structuralLocator?.ordinal);
  if (strategy !== "scoped_text_field" || ordinal === undefined || ordinal < 1) {
    return undefined;
  }
  return Math.max(0, Math.floor(ordinal) - 1);
}

function shouldPreferInputUiCandidate(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  const strategy = textParam(structuralLocator?.strategy).trim();
  return textParam(params.locatorKind).trim() === "structural_locator" &&
    (
      strategy === "scoped_text_field" ||
      strategy === "ocr_or_edittext" ||
      strategy === "ocr_or_edittext_in_region" ||
      strategy === "ocr_relative_input"
    );
}

function isTextInputUiClass(className: string): boolean {
  const normalized = className.toLowerCase().replace(/[\s._-]+/g, "");
  if (!normalized) return false;
  return normalized.includes("edittext") ||
    normalized.includes("textinput") ||
    normalized.includes("textarea") ||
    normalized.includes("searchinput") ||
    normalized.includes("searchfield") ||
    normalized.includes("securetextfield") ||
    normalized.includes("editabletext") ||
    normalized.includes("basictextfield") ||
    normalized.includes("xcuitextfield") ||
    normalized.includes("xcuisecuretextfield") ||
    normalized.includes("xcuitextview") ||
    normalized.includes("textfield") && !normalized.includes("textfieldcontainer");
}

function candidateGridCell(
  candidate: TextLocatorCandidate,
  region: { x: number; y: number; width: number; height: number },
  layout: OcrLayoutResult,
  scrollProfile: GridScrollProfile,
  deviceSize?: { width: number; height: number }
): { column: number; row: number } {
  const point = candidatePercentPoint(candidate, layout, deviceSize);
  const relativeX = Math.max(0, Math.min(100, ((point.x - region.x) / region.width) * 100));
  const relativeY = Math.max(0, Math.min(100, ((point.y - region.y) / region.height) * 100));
  const columns = Math.max(1, scrollProfile.columns);
  const column = Math.max(0, Math.min(columns - 1, Math.floor(relativeX / (100 / columns))));
  const itemHeight = scrollProfile.candidateItemHeightPercent ?? 100;
  const row = Math.max(0, Math.floor(relativeY / itemHeight));
  return { column, row };
}

function candidatePercentPoint(candidate: TextLocatorCandidate, layout: OcrLayoutResult, deviceSize?: { width: number; height: number }): { x: number; y: number } {
  const width = deviceSize?.width ?? layout.width;
  const height = deviceSize?.height ?? layout.height;
  const x = scaleCoordinate(candidate.centerX, layout.width, width);
  const y = scaleCoordinate(candidate.centerY, layout.height, height);
  return {
    x: width ? (x / width) * 100 : 0,
    y: height ? (y / height) * 100 : 0
  };
}

function readSemanticArea(value: unknown): VisualSemanticArea | undefined {
  return value === "top" ||
    value === "content" ||
    value === "bottom" ||
    value === "unknown"
    ? value
    : undefined;
}

function semanticAreaForPercentRegion(region: { x: number; y: number; width: number; height: number }): VisualSemanticArea {
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function textCandidateSemanticArea(
  candidate: TextLocatorCandidate,
  layout: OcrLayoutResult,
  deviceSize?: { width: number; height: number }
): VisualSemanticArea {
  const width = deviceSize?.width ?? layout.width;
  const height = deviceSize?.height ?? layout.height;
  if (!width || !height) {
    return "unknown";
  }
  const centerY = (candidate.centerY / height) * 100;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function shouldRevealAfterScroll(params: Record<string, unknown>, semanticArea: VisualSemanticArea): boolean {
  if (semanticArea !== "content") {
    return false;
  }
  return params.availability === "after_scroll" || params.revealStrategy === "scroll_to_top" || params.revealOnMissing === true;
}

function gridCandidateRequiresTargetQuery(params: Record<string, unknown>): boolean {
  if (params.abilityType !== "grid_candidate") {
    return false;
  }
  const scrollProfile = readScrollProfile(params.scrollProfile);
  return Boolean(scrollProfile.targetQuery && scrollProfile.targetKind !== "nth_item");
}

function gridCandidateMissingSemanticTarget(params: Record<string, unknown>): boolean {
  if (params.abilityType !== "grid_candidate") {
    return false;
  }
  const scrollProfile = readScrollProfile(params.scrollProfile);
  return !scrollProfile.targetQuery || scrollProfile.targetKind === "nth_item";
}

function regionPoint(
  region: { x: number; y: number; width: number; height: number },
  deviceSize?: { width: number; height: number },
  pointPercent?: { x: number; y: number }
): { x: number; y: number } | undefined {
  if (!deviceSize?.width || !deviceSize.height) {
    return undefined;
  }
  const point = pointPercent ?? { x: 50, y: 50 };
  return {
    x: Math.round(((region.x + (region.width * point.x) / 100) / 100) * deviceSize.width),
    y: Math.round(((region.y + (region.height * point.y) / 100) / 100) * deviceSize.height)
  };
}

function checkboxPercentRegion(
  point: { x: number; y: number },
  deviceSize?: { width: number; height: number }
): { x: number; y: number; width: number; height: number } | undefined {
  if (!deviceSize?.width || !deviceSize.height) {
    return undefined;
  }
  const widthPercent = 6;
  const heightPercent = 4;
  const centerX = (point.x / deviceSize.width) * 100;
  const centerY = (point.y / deviceSize.height) * 100;
  return {
    x: Math.max(0, centerX - widthPercent / 2),
    y: Math.max(0, centerY - heightPercent / 2),
    width: Math.min(widthPercent, 100 - Math.max(0, centerX - widthPercent / 2)),
    height: Math.min(heightPercent, 100 - Math.max(0, centerY - heightPercent / 2))
  };
}

function visualTemplateMeanDifference(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) {
    return 0;
  }
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0)) / 255;
  }
  return total / length;
}

function checkboxVisualStateFromTemplate(pixels: number[]): {
  checked: boolean;
  score: number;
  darkRatio: number;
  meanDarkness: number;
} {
  if (!pixels.length) {
    return {
      checked: false,
      score: 0,
      darkRatio: 0,
      meanDarkness: 0
    };
  }
  let darkPixels = 0;
  let darknessTotal = 0;
  for (const pixel of pixels) {
    const normalized = Math.max(0, Math.min(255, pixel));
    const darkness = (255 - normalized) / 255;
    darknessTotal += darkness;
    if (normalized <= 120) {
      darkPixels += 1;
    }
  }
  const darkRatio = darkPixels / pixels.length;
  const meanDarkness = darknessTotal / pixels.length;
  const score = Math.max(darkRatio, meanDarkness * 0.8);
  return {
    checked: darkRatio >= 0.035 || meanDarkness >= 0.055,
    score,
    darkRatio,
    meanDarkness
  };
}

function readLeadingCheckboxNearTextLocator(value: unknown): { strategy: "near_text"; role: "checkbox"; anchorText: string; clickTarget: "leading_checkbox" } | undefined {
  const input = readRecord(value);
  if (!input) {
    return undefined;
  }
  const strategy = textParam(input.strategy).trim();
  const role = textParam(input.role).trim();
  const clickTarget = textParam(input.clickTarget).trim();
  const anchorText = textParam(input.anchorText).trim();
  if (strategy !== "near_text" || role !== "checkbox" || clickTarget !== "leading_checkbox" || !anchorText) {
    return undefined;
  }
  return {
    strategy,
    role,
    anchorText,
    clickTarget
  };
}

function isRuntimeInputStructuralLocator(params: Record<string, unknown>): boolean {
  const locatorKind = textParam(params.locatorKind).trim();
  const locator = textParam(params.locator).trim();
  const structuralLocator = readRecord(params.structuralLocator);
  return locatorKind === "structural_locator" ||
    locator.startsWith("runtime-locator:") ||
    textParam(structuralLocator?.strategy).trim() === "ocr_or_edittext" ||
    textParam(structuralLocator?.strategy).trim() === "ocr_or_edittext_in_region" ||
    textParam(structuralLocator?.strategy).trim() === "scoped_text_field";
}

function runtimeInputRevealSettings(
  params: Record<string, unknown>,
  semanticArea: VisualSemanticArea
): {
  strategy: "bounded_search" | "scroll_to_top";
  mode: "auto" | "scroll";
  direction: "up" | "down" | "both";
  resetToTop: boolean;
  maxSwipes: number;
  intervalMs: number;
} | undefined {
  if (semanticArea !== "content") {
    return undefined;
  }
  const structuralLocator = readRecord(params.structuralLocator);
  const searchMode = readTextSearchMode(params.searchMode);
  if (searchMode === "auto" || searchMode === "scroll") {
    const direction = readTextSearchDirection(params.searchDirection);
    return {
      strategy: "bounded_search",
      mode: searchMode,
      direction,
      resetToTop: params.resetToTop !== false && direction !== "up",
      maxSwipes: Math.max(1, Math.floor(positiveNumberParam(params.maxSwipes, 6))),
      intervalMs: nonNegativeNumberParam(params.intervalMs, 250)
    };
  }
  const strategy = textParam(structuralLocator?.revealStrategy ?? params.revealStrategy).trim();
  if (strategy !== "scroll_to_top") {
    return undefined;
  }
  return {
    strategy: "scroll_to_top",
    mode: "scroll",
    direction: "up",
    resetToTop: false,
    maxSwipes: Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.revealMaxSwipes ?? params.revealMaxSwipes, 3))),
    intervalMs: nonNegativeNumberParam(structuralLocator?.revealIntervalMs ?? params.revealIntervalMs, 250)
  };
}

function isRuntimeTapStructuralLocator(params: Record<string, unknown>): boolean {
  const locatorKind = textParam(params.locatorKind).trim();
  const locator = textParam(params.locator).trim();
  return locatorKind === "structural_locator" || locator.startsWith("runtime-locator:");
}

function isRuntimeOptionSelectionLocator(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(structuralLocator?.selectionMode).trim() === "ocr_option_confirm";
}

function isTrailingSwitchLocator(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(structuralLocator?.strategy).trim() === "ocr_trailing_switch";
}

function readTrailingSwitchLocator(params: Record<string, unknown>): {
  strategy: "ocr_trailing_switch";
  anchorText: string;
  revealStrategy?: "search_content";
  restoreMaxSwipes: number;
  searchMaxSwipes: number;
  revealIntervalMs: number;
  controlCenterXPercent: number;
  controlWidthPercent: number;
  controlHeightPercent: number;
} | undefined {
  const structuralLocator = readRecord(params.structuralLocator);
  if (textParam(structuralLocator?.strategy).trim() !== "ocr_trailing_switch") {
    return undefined;
  }
  const anchorText = textParam(structuralLocator?.anchorText ?? params.targetText).trim();
  if (!anchorText) {
    return undefined;
  }
  return {
    strategy: "ocr_trailing_switch",
    anchorText,
    ...(textParam(structuralLocator?.revealStrategy).trim() === "search_content"
      ? { revealStrategy: "search_content" as const }
      : {}),
    restoreMaxSwipes: Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.restoreMaxSwipes, 4))),
    searchMaxSwipes: Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.searchMaxSwipes, 8))),
    revealIntervalMs: nonNegativeNumberParam(structuralLocator?.revealIntervalMs, 250),
    controlCenterXPercent: percentNumber(structuralLocator?.controlCenterXPercent) ?? 84,
    controlWidthPercent: Math.max(8, percentNumber(structuralLocator?.controlWidthPercent) ?? 16),
    controlHeightPercent: Math.max(4, percentNumber(structuralLocator?.controlHeightPercent) ?? 6)
  };
}

function ocrLayoutViewportSignature(layout: OcrLayoutResult): string {
  const boxes = layout.boxes
    .map((box) => [
      normalizeOcrText(box.text),
      Math.round(box.x / 20),
      Math.round(box.y / 20),
      Math.round(box.width / 20),
      Math.round(box.height / 20)
    ].join(":"))
    .sort();
  return `${normalizeOcrText(layout.text)}|${boxes.join("|")}`;
}

function trailingSwitchStateFromTemplate(template: { width: number; height: number; pixels: number[] }): "on" | "off" | "unknown" {
  const leftStart = 0;
  const leftEnd = Math.max(1, Math.floor(template.width * 0.45));
  const rightStart = Math.min(template.width - 1, Math.ceil(template.width * 0.55));
  const rightEnd = template.width;
  const halfMean = (start: number, end: number): number => {
    let total = 0;
    let count = 0;
    for (let y = 0; y < template.height; y += 1) {
      for (let x = start; x < end; x += 1) {
        total += template.pixels[y * template.width + x] ?? 255;
        count += 1;
      }
    }
    return count ? total / count : 255;
  };
  const leftMean = halfMean(leftStart, leftEnd);
  const rightMean = halfMean(rightStart, rightEnd);
  const difference = leftMean - rightMean;
  if (Math.abs(difference) < 4) {
    return "unknown";
  }
  return difference > 0 ? "off" : "on";
}

function runtimeStructuralTargetText(params: Record<string, unknown>): string {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(params.targetText ?? params.text ?? structuralLocator?.text ?? structuralLocator?.anchorText).trim();
}

function defaultRuntimeSearchRegion(semanticArea: VisualSemanticArea): { x: number; y: number; width: number; height: number } {
  if (semanticArea === "top") {
    return { x: 0, y: 0, width: 100, height: 22 };
  }
  if (semanticArea === "bottom") {
    return { x: 0, y: 78, width: 100, height: 22 };
  }
  return { x: 0, y: 14, width: 100, height: 74 };
}

type VisualImageRegionCandidate = {
  source?: string;
  label: string;
  role?: string;
  score: number;
  region: { x: number; y: number; width: number; height: number };
  semanticArea: VisualSemanticArea;
};

type TopBarIconSlot = "leading" | "trailing";
type SemanticIconVerticalSlot = "top" | "center" | "bottom";

function isVisualQueryLocator(params: Record<string, unknown>): boolean {
  return textParam(params.locatorKind).trim() === "visual_query_locator";
}

function isSemanticIconLocator(params: Record<string, unknown>): boolean {
  const locatorKind = textParam(params.locatorKind).trim();
  return locatorKind === "top_bar_icon_locator" || locatorKind === "semantic_icon_locator" || textParam(params.locator).trim().startsWith("top-bar-icon:");
}

function visualQueryFailure(input: {
  visualKind: string;
  visualQuery: string;
  semanticArea: VisualSemanticArea;
  reason: string;
  message: string;
}): SemanticResolutionOutcome {
  return {
    supported: true,
    resolved: false,
    message: input.message,
    artifacts: [],
    metadata: {
      type: "visual_query_locator",
      action: "fail",
      reason: input.reason,
      visualKind: input.visualKind || undefined,
      visualQuery: input.visualQuery || undefined,
      semanticArea: input.semanticArea
    }
  };
}

function semanticIconFailure(
  role: string,
  slot: TopBarIconSlot,
  semanticArea: VisualSemanticArea,
  reason: string,
  message: string
): SemanticResolutionOutcome {
  return {
    supported: true,
    resolved: false,
    message,
    artifacts: [],
    metadata: {
      type: "semantic_icon_locator",
      action: "fail",
      reason,
      role,
      slot,
      semanticArea
    }
  };
}

function genericTopBarIconSearchCandidate(input: {
  role: string;
  slot: TopBarIconSlot;
  semanticArea: VisualSemanticArea;
}): VisualImageRegionCandidate {
  return {
    source: "runtime_semantic_icon",
    label: input.role || `${input.slot} icon`,
    role: input.role || undefined,
    score: 1,
    semanticArea: input.semanticArea,
    region: input.slot === "trailing"
      ? { x: 90, y: 7, width: 4, height: 4 }
      : { x: 5, y: 7, width: 4, height: 4 }
  };
}

function topBarIconRole(params: Record<string, unknown>): string {
  const explicitRole = textParam(params.role).trim();
  if (explicitRole) {
    return explicitRole;
  }
  const locator = textParam(params.locator).trim();
  return locator.startsWith("top-bar-icon:") ? locator.replace(/^top-bar-icon:\s*/, "").trim() : "";
}

function readTopBarSlot(value: unknown): TopBarIconSlot | undefined {
  return value === "leading" || value === "trailing" ? value : undefined;
}

function readSemanticIconVerticalSlot(value: unknown): SemanticIconVerticalSlot | undefined {
  return value === "top" || value === "center" || value === "bottom" ? value : undefined;
}

function semanticIconUiCandidateScore(
  candidate: UiElementCandidate,
  input: {
    role: string;
    semanticArea: VisualSemanticArea;
    slot: TopBarIconSlot;
    verticalSlot?: SemanticIconVerticalSlot;
    deviceSize: { width: number; height: number };
  }
): { score: number; semanticEvidence: number; matchReason: UiHierarchyIconResolution["matchReason"] } {
  const semanticEvidence = semanticIconUiEvidenceScore(candidate, input.role);
  const enabledScore = candidate.enabled ? 1 : -4;
  const interactivityScore = candidate.clickable ? 2.5 : candidate.longClickable ? 2 : candidate.focusable ? 1 : 0;
  const areaScore = semanticIconAreaScore(candidate, input.semanticArea, input.deviceSize);
  const slotScore = semanticIconSlotScore(candidate, input.slot, input.deviceSize);
  const verticalSlotScore = semanticIconVerticalSlotScore(candidate, input.verticalSlot, input.deviceSize);
  const sizeScore = semanticIconUiSizeScore(candidate, input.deviceSize);
  return {
    score: semanticEvidence + enabledScore + interactivityScore + areaScore + slotScore + verticalSlotScore + sizeScore,
    semanticEvidence,
    matchReason: semanticEvidence >= 5 ? "semantic_accessibility" : "semantic_identity"
  };
}

function semanticIconUiEvidenceScore(candidate: UiElementCandidate, role: string): number {
  const aliases = semanticIconRoleAliases(role);
  if (!aliases.length) {
    return 0;
  }
  const textLike = compactUiIdentity(candidate.text);
  const accessibilityLike = compactUiIdentity(candidate.contentDesc);
  const resourceLike = compactUiIdentity(candidate.resourceId);
  const textScore = aliases.some((alias) => textLike.includes(alias) || accessibilityLike.includes(alias)) ? 5 : 0;
  const resourceScore = aliases.some((alias) => resourceLike.includes(alias)) ? 4 : 0;
  return Math.max(textScore, resourceScore);
}

function semanticIconRoleAliases(role: string): string[] {
  const normalized = compactVisualQuery(normalizeSemanticIconRole(role));
  const aliases = VISUAL_QUERY_ICON_ROLE_ALIASES
    .filter((entry) => normalizeSemanticIconRole(entry.role) === normalizeSemanticIconRole(role))
    .flatMap((entry) => entry.aliases)
    .map(compactVisualQuery)
    .filter(Boolean);
  return [...new Set([normalized, ...aliases].filter(Boolean))];
}

function compactUiIdentity(value: string | undefined): string {
  return compactVisualQuery(value ?? "");
}

function semanticIconAreaScore(
  candidate: UiElementCandidate,
  semanticArea: VisualSemanticArea,
  deviceSize: { width: number; height: number }
): number {
  if (semanticArea === "unknown") {
    return 0;
  }
  const yPercent = (candidate.bounds.centerY / deviceSize.height) * 100;
  if (semanticArea === "top") {
    return yPercent <= 22 ? 2 : -4;
  }
  if (semanticArea === "bottom") {
    return yPercent >= 74 ? 2 : -3;
  }
  return yPercent >= 12 && yPercent <= 94 ? 2 : -4;
}

function semanticIconSlotScore(
  candidate: UiElementCandidate,
  slot: TopBarIconSlot,
  deviceSize: { width: number; height: number }
): number {
  const xPercent = (candidate.bounds.centerX / deviceSize.width) * 100;
  if (slot === "trailing") {
    return xPercent >= 55 ? 1.5 : -1;
  }
  return xPercent <= 45 ? 1.5 : -1;
}

function semanticIconVerticalSlotScore(
  candidate: UiElementCandidate,
  verticalSlot: SemanticIconVerticalSlot | undefined,
  deviceSize: { width: number; height: number }
): number {
  if (!verticalSlot) return 0;
  const yPercent = (candidate.bounds.centerY / deviceSize.height) * 100;
  if (verticalSlot === "top") {
    return yPercent <= 35 ? 1.4 : -1;
  }
  if (verticalSlot === "bottom") {
    return yPercent >= 60 ? 1.4 : -1;
  }
  return yPercent >= 30 && yPercent <= 70 ? 1.2 : -0.8;
}

function semanticIconVerticalSortValue(
  candidate: UiElementCandidate,
  verticalSlot: SemanticIconVerticalSlot | undefined,
  deviceSize: { width: number; height: number }
): number {
  if (!verticalSlot) return 0;
  const yPosition = candidate.bounds.centerY / Math.max(1, deviceSize.height);
  if (verticalSlot === "top") return 1 - yPosition;
  if (verticalSlot === "bottom") return yPosition;
  return 1 - Math.min(1, Math.abs(yPosition - 0.5) * 2);
}

function semanticIconUiSizeScore(candidate: UiElementCandidate, deviceSize: { width: number; height: number }): number {
  const viewportArea = Math.max(1, deviceSize.width * deviceSize.height);
  const areaRatio = candidate.area / viewportArea;
  if (areaRatio > 0.25) {
    return -4;
  }
  if (areaRatio > 0.1) {
    return -1;
  }
  if (areaRatio >= 0.0008 && areaRatio <= 0.04) {
    return 0.8;
  }
  return 0;
}

function selectTopBarIconCandidate(
  candidates: VisualImageRegionCandidate[],
  options: {
    role: string;
    slot: TopBarIconSlot;
    orderFromRight: number;
    semanticArea: VisualSemanticArea;
    anchorXPercent?: number;
  }
): {
  candidate?: VisualImageRegionCandidate;
  reason?: string;
  diagnostic: Record<string, unknown>;
} {
  const scoped = candidates.filter((candidate) =>
    options.semanticArea === "unknown" ||
    candidate.semanticArea === "unknown" ||
    candidate.semanticArea === options.semanticArea
  );
  const areaPool = scoped.length ? scoped : candidates;
  const slotPool = areaPool.filter((candidate) => candidateMatchesTopBarSlot(candidate, options.slot, options.anchorXPercent));
  const pool = slotPool.length ? slotPool : areaPool;
  const role = options.role.trim().toLowerCase();
  const ordered = pool
    .slice()
    .sort((left, right) => candidateCenterX(right) - candidateCenterX(left) || right.score - left.score);
  const orderedCandidate = options.slot === "trailing" ? ordered[options.orderFromRight - 1] : undefined;
  const roleCandidates = role
    ? pool
      .filter((candidate) => textParam(candidate.role).trim().toLowerCase() === role)
      .sort((left, right) => right.score - left.score || Math.abs(candidateCenterX(left) - (options.anchorXPercent ?? 50)) - Math.abs(candidateCenterX(right) - (options.anchorXPercent ?? 50)))
    : [];
  const selected =
    orderedCandidate && (!role || textParam(orderedCandidate.role).trim().toLowerCase() === role)
      ? orderedCandidate
      : roleCandidates[0] ?? (options.slot === "leading" ? ordered.at(-1) : orderedCandidate ?? ordered[0]);
  return {
    candidate: selected,
    reason: selected ? "candidate_selected" : "no_candidates",
    diagnostic: {
      reason: selected ? "candidate_selected" : "no_candidates",
      candidateCount: candidates.length,
      scopedCandidateCount: scoped.length,
      slotCandidateCount: slotPool.length,
      role: role || undefined,
      slot: options.slot,
      orderFromRight: options.orderFromRight,
      anchorXPercent: options.anchorXPercent,
      selectedLabel: selected?.label,
      selectedRole: selected?.role,
      selectedRegion: selected?.region
    }
  };
}

function candidateMatchesTopBarSlot(candidate: VisualImageRegionCandidate, slot: TopBarIconSlot, anchorXPercent: number | undefined): boolean {
  const centerX = candidateCenterX(candidate);
  if (slot === "leading") {
    return anchorXPercent === undefined ? centerX <= 35 : centerX < anchorXPercent;
  }
  return anchorXPercent === undefined ? centerX >= 50 : centerX > anchorXPercent;
}

function candidateCenterX(candidate: VisualImageRegionCandidate): number {
  return candidate.region.x + candidate.region.width / 2;
}

type TopBarIconVisualComponent = {
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  darkPixelCount: number;
  score: number;
  polarity?: "dark" | "light";
  roleScore?: number;
  roleMargin?: number;
  competingRole?: string;
  competingRoleScore?: number;
};

type VisibleSemanticIconCandidate = {
  point: { x: number; y: number };
  region: { x: number; y: number; width: number; height: number };
  bounds: { x: number; y: number; width: number; height: number };
  score: number;
  roleScore: number;
  roleMargin: number;
  competingRole?: string;
  competingRoleScore?: number;
  polarity?: "dark" | "light";
  semanticArea: VisualSemanticArea;
};

async function locateCurrentTopBarIconInScreenshot(input: {
  screenshot: Buffer;
  candidate: VisualImageRegionCandidate;
  role: string;
  slot: TopBarIconSlot;
  orderFromRight: number;
  semanticArea: VisualSemanticArea;
  deviceSize: { width: number; height: number };
  anchorXPercent?: number;
  ocrLayout?: OcrLayoutResult;
}): Promise<{
  selected?: {
    point: { x: number; y: number };
    region: { x: number; y: number; width: number; height: number };
  };
  diagnostic: Record<string, unknown>;
}> {
  const sample = await imageSampleNativeBestEffort(input.screenshot);
  if (!sample) {
    return {
      diagnostic: {
        reason: "image_sample_unavailable",
        candidateRegion: input.candidate.region
      }
    };
  }
  const searchRegion = topBarIconSearchRegion(input.candidate, {
    role: input.role,
    slot: input.slot,
    semanticArea: input.semanticArea,
    anchorXPercent: input.anchorXPercent
  });
  const pixelSearchRegion = percentRegionToSampleRect(searchRegion, sample);
  if (!pixelSearchRegion) {
    return {
      diagnostic: {
        reason: "invalid_search_region",
        candidateRegion: input.candidate.region,
        searchRegion
      }
    };
  }
  const avatarContainerStrategy = input.role.trim().toLowerCase() === "avatar" && input.slot === "leading";
  const rawComponents = avatarContainerStrategy
    ? findAvatarVisualComponents(sample, pixelSearchRegion)
    : findTopBarVisualComponents(sample, pixelSearchRegion);
  const mergedRawComponents = mergeNearbyTopBarIconComponents(rawComponents, sample);
  const textFiltered = excludeOcrTextOverlappingComponents(mergedRawComponents, input.ocrLayout, sample);
  const normalizedRole = input.role.trim().toLowerCase();
  const roleAware = isKnownTopBarIconRole(normalizedRole);
  const components = textFiltered.components
    .map((component) => {
      const roleScores = avatarContainerStrategy || !roleAware ? undefined : semanticIconRoleScores(component, sample);
      const roleScore = avatarContainerStrategy ? undefined : roleScores?.get(normalizedRole) ?? topBarIconRoleShapeScore(component, sample, normalizedRole);
      const competing = roleScores ? strongestCompetingSemanticIconRole(roleScores, normalizedRole) : undefined;
      return {
        ...component,
        roleScore,
        roleMargin: roleScore === undefined ? undefined : roleScore - (competing?.score ?? 0),
        competingRole: competing?.role,
        competingRoleScore: competing?.score,
        score: avatarContainerStrategy
          ? topBarAvatarComponentScore(component, input.candidate, sample, input.anchorXPercent)
          : topBarIconComponentScore(component, input.candidate, sample, {
              broadTrailingSearch: input.slot === "trailing",
              roleScore
            })
      };
    })
    .filter((component) => component.score >= 0.36 && (!roleAware || ((component.roleScore ?? 0) >= 0.38 && (component.roleMargin ?? 0) >= 0.04)));
  const selected = selectCurrentTopBarIconComponent(components, {
    role: normalizedRole,
    slot: input.slot,
    orderFromRight: input.orderFromRight
  });
  const titleFallback = selected ? undefined : avatarContainerStrategy
    ? locateLeadingAvatarByTopTitle(input.ocrLayout, sample, input.deviceSize)
    : undefined;
  const diagnostic = {
    reason: selected ? "current_visual_icon_selected" : "current_visual_icon_not_found",
    strategy: avatarContainerStrategy ? "avatar_container" : "contrast_icon_shape",
    role: input.role || undefined,
    slot: input.slot,
    orderFromRight: input.orderFromRight,
    candidateRegion: input.candidate.region,
    searchRegion,
    rawComponentCount: mergedRawComponents.length,
    ocrTextExcludedComponentCount: textFiltered.excludedCount,
    componentCount: components.length,
    bestScore: selected ? roundPercent(selected.score) : undefined,
    roleScore: selected?.roleScore === undefined ? undefined : roundPercent(selected.roleScore),
    roleMargin: selected?.roleMargin === undefined ? undefined : roundPercent(selected.roleMargin),
    competingRole: selected?.competingRole,
    competingRoleScore: selected?.competingRoleScore === undefined ? undefined : roundPercent(selected.competingRoleScore),
    polarity: selected?.polarity,
    selectedBounds: selected?.bounds,
    titleFallback: titleFallback?.diagnostic
  };
  if (titleFallback) {
    return {
      selected: {
        point: titleFallback.point,
        region: titleFallback.region
      },
      diagnostic: {
        ...diagnostic,
        reason: "current_visual_icon_selected_by_title_relation",
        fallbackStrategy: "top_title_leading_avatar",
        selectedBounds: titleFallback.sampleBounds
      }
    };
  }
  if (!selected) {
    return { diagnostic };
  }
  const point = {
    x: scaleCoordinate(selected.center.x, sample.width, input.deviceSize.width),
    y: scaleCoordinate(selected.center.y, sample.height, input.deviceSize.height)
  };
  return {
    selected: {
      point,
      region: sampleRectToPercent(selected.bounds, sample)
    },
    diagnostic
  };
}

async function locateCurrentContentAddIconInScreenshot(input: {
  screenshot: Buffer;
  slot: TopBarIconSlot;
  verticalSlot?: SemanticIconVerticalSlot;
  deviceSize: { width: number; height: number };
  ocrLayout?: OcrLayoutResult;
}): Promise<{
  selected?: {
    point: { x: number; y: number };
    region: { x: number; y: number; width: number; height: number };
  };
  diagnostic: Record<string, unknown>;
}> {
  const sample = await imageSampleNativeBestEffort(input.screenshot);
  if (!sample) {
    return { diagnostic: { reason: "image_sample_unavailable" } };
  }
  const searchRegion = contentAddIconSearchRegion(input.slot, input.verticalSlot);
  const pixelSearchRegion = percentRegionToSampleRect(searchRegion, sample);
  if (!pixelSearchRegion) {
    return { diagnostic: { reason: "invalid_search_region", searchRegion } };
  }
  const rawComponents = findContentAddIconComponents(sample, pixelSearchRegion);
  const ocrOverlap = ocrTextOverlapDiagnostics(rawComponents, input.ocrLayout, sample);
  const candidates = rawComponents
    .map((component) => ({
      ...component,
      score: contentAddIconScore(component, sample, input.slot, input.verticalSlot)
    }))
    .filter((component) => component.score >= 0.58)
    .sort((left, right) => right.score - left.score || (
      input.slot === "trailing" ? right.center.x - left.center.x : left.center.x - right.center.x
    ));
  const selected = candidates[0];
  const diagnostic = {
    reason: selected ? "current_visual_icon_selected" : "current_visual_icon_not_found",
    strategy: "floating_add_shape",
    slot: input.slot,
    verticalSlot: input.verticalSlot,
    searchRegion,
    rawComponentCount: rawComponents.length,
    ocrTextOverlappingComponentCount: ocrOverlap.overlappingCount,
    componentCount: candidates.length,
    bestScore: selected ? roundPercent(selected.score) : undefined,
    selectedBounds: selected?.bounds
  };
  if (!selected) {
    return { diagnostic };
  }
  return {
    selected: {
      point: {
        x: scaleCoordinate(selected.center.x, sample.width, input.deviceSize.width),
        y: scaleCoordinate(selected.center.y, sample.height, input.deviceSize.height)
      },
      region: sampleRectToPercent(selected.bounds, sample)
    },
    diagnostic
  };
}

async function locateCurrentVisibleSemanticIconInScreenshot(input: {
  screenshot: Buffer;
  role: string;
  semanticArea: VisualSemanticArea;
  slot?: TopBarIconSlot;
  verticalSlot?: SemanticIconVerticalSlot;
  orderFromRight: number;
  anchorPoint?: { x: number; y: number };
  deviceSize: { width: number; height: number };
  ocrLayout?: OcrLayoutResult;
}): Promise<{
  selected?: {
    point: { x: number; y: number };
    region: { x: number; y: number; width: number; height: number };
  };
  reason: string;
  message?: string;
  diagnostic: Record<string, unknown>;
}> {
  const sample = await imageSampleNativeBestEffort(input.screenshot);
  if (!sample) {
    return {
      reason: "image_sample_unavailable",
      diagnostic: { reason: "image_sample_unavailable" }
    };
  }
  const role = normalizeSemanticIconRole(input.role.trim().toLowerCase());
  if (!isKnownTopBarIconRole(role)) {
    return {
      reason: "unsupported_icon_role",
      message: `Semantic icon "${input.role}" is not supported by visual role recognition yet.`,
      diagnostic: {
        reason: "unsupported_icon_role",
        role: input.role || undefined,
        normalizedRole: role || undefined
      }
    };
  }

  const globalRegion = { x: 0, y: 0, width: 100, height: 100 };
  const primaryRegion = visibleSemanticIconPrimarySearchRegion(input.semanticArea, input.anchorPoint, input.deviceSize);
  const phases: Array<{
    phase: "primary" | "fallback_global" | "global";
    region: { x: number; y: number; width: number; height: number };
  }> = primaryRegion
    ? [
        { phase: "primary", region: primaryRegion },
        ...(percentRegionsEqual(primaryRegion, globalRegion) ? [] : [{ phase: "fallback_global" as const, region: globalRegion }])
      ]
    : [{ phase: "global", region: globalRegion }];

  const diagnostics: Array<Record<string, unknown>> = [];
  for (const phase of phases) {
    const phaseCandidates = findVisibleSemanticIconCandidates(sample, phase.region, role, input.deviceSize, input.ocrLayout);
    const candidates = phaseCandidates.candidates;
    const selected = selectVisibleSemanticIconCandidate(candidates, {
      slot: input.slot,
      verticalSlot: input.verticalSlot,
      orderFromRight: input.orderFromRight,
      anchorPoint: input.anchorPoint
    });
    const diagnostic = {
      reason: selected.reason,
      phase: phase.phase,
      strategy: "semantic_icon_shape",
      role: input.role || undefined,
      normalizedRole: role,
      semanticArea: input.semanticArea,
      verticalSlot: input.verticalSlot,
      searchRegion: phase.region,
      rawComponentCount: phaseCandidates.rawComponentCount,
      ocrTextExcludedComponentCount: phaseCandidates.excludedCount,
      candidateCount: candidates.length,
      rejectedBest: phaseCandidates.rejectedBest
        ? {
            score: roundPercent(phaseCandidates.rejectedBest.score),
            roleScore: roundPercent(phaseCandidates.rejectedBest.roleScore),
            roleMargin: roundPercent(phaseCandidates.rejectedBest.roleMargin),
            competingRole: phaseCandidates.rejectedBest.competingRole,
            competingRoleScore: phaseCandidates.rejectedBest.competingRoleScore === undefined ? undefined : roundPercent(phaseCandidates.rejectedBest.competingRoleScore),
            bounds: phaseCandidates.rejectedBest.bounds
          }
        : undefined,
      selectedRegion: selected.candidate?.region,
      bestScore: selected.candidate ? roundPercent(selected.candidate.score) : undefined,
      roleScore: selected.candidate ? roundPercent(selected.candidate.roleScore) : undefined,
      roleMargin: selected.candidate ? roundPercent(selected.candidate.roleMargin) : undefined,
      competingRole: selected.candidate?.competingRole,
      competingRoleScore: selected.candidate?.competingRoleScore === undefined ? undefined : roundPercent(selected.candidate.competingRoleScore),
      polarity: selected.candidate?.polarity
    };
    diagnostics.push(diagnostic);
    if (selected.candidate) {
      return {
        selected: {
          point: selected.candidate.point,
          region: selected.candidate.region
        },
        reason: selected.reason,
        diagnostic
      };
    }
    if (selected.reason === "ambiguous_icon_candidates") {
      return {
        reason: selected.reason,
        message: ambiguousSemanticIconMessage(input.role, candidates.length, input.semanticArea),
        diagnostic
      };
    }
  }

  return {
    reason: "current_visual_icon_not_found",
    diagnostic: {
      reason: "current_visual_icon_not_found",
      role: input.role || undefined,
      normalizedRole: role,
      semanticArea: input.semanticArea,
      verticalSlot: input.verticalSlot,
      phases: diagnostics
    }
  };
}

function visibleSemanticIconPrimarySearchRegion(
  semanticArea: VisualSemanticArea,
  anchorPoint: { x: number; y: number } | undefined,
  deviceSize: { width: number; height: number }
): { x: number; y: number; width: number; height: number } | undefined {
  if (anchorPoint) {
    const centerY = deviceSize.height ? (anchorPoint.y / deviceSize.height) * 100 : 50;
    return clampPercentRegion({
      x: 0,
      y: centerY - 8,
      width: 100,
      height: 16
    });
  }
  if (semanticArea === "unknown") {
    return undefined;
  }
  return defaultRuntimeSearchRegion(semanticArea);
}

function findVisibleSemanticIconCandidates(
  sample: ImageSample,
  region: { x: number; y: number; width: number; height: number },
  role: string,
  deviceSize: { width: number; height: number },
  ocrLayout?: OcrLayoutResult
): {
  candidates: VisibleSemanticIconCandidate[];
  rawComponentCount: number;
  excludedCount: number;
  rejectedBest?: {
    score: number;
    roleScore: number;
    roleMargin: number;
    competingRole?: string;
    competingRoleScore?: number;
    bounds: { x: number; y: number; width: number; height: number };
  };
} {
  const pixelSearchRegion = percentRegionToSampleRect(region, sample);
  if (!pixelSearchRegion) {
    return { candidates: [], rawComponentCount: 0, excludedCount: 0 };
  }
  const rawComponents = mergeNearbyTopBarIconComponents(findTopBarVisualComponents(sample, pixelSearchRegion), sample);
  const textFiltered = excludeOcrTextOverlappingComponents(rawComponents, ocrLayout, sample);
  const scoredComponents = textFiltered.components
    .map((component) => {
      const roleScores = semanticIconRoleScores(component, sample);
      const roleScore = roleScores.get(role) ?? 0;
      const competing = strongestCompetingSemanticIconRole(roleScores, role);
      const geometryScore = visibleSemanticIconGeometryScore(component, sample);
      const roleSpecificBonus = semanticIconRoleSpecificVisualBonus(component, sample, role);
      const score = roleScore * 0.82 + geometryScore * 0.18 + Math.min(roleSpecificBonus, 0.12);
      const componentRegion = sampleRectToPercent(component.bounds, sample);
      return {
        point: {
          x: scaleCoordinate(component.center.x, sample.width, deviceSize.width),
          y: scaleCoordinate(component.center.y, sample.height, deviceSize.height)
        },
        region: componentRegion,
        bounds: component.bounds,
        score,
        roleScore,
        roleMargin: roleScore + roleSpecificBonus - competing.score,
        competingRole: competing.role,
        competingRoleScore: competing.score,
        polarity: component.polarity,
        semanticArea: semanticAreaForPercentRegion(componentRegion)
      };
    });
  const candidates = scoredComponents
    .filter((candidate) => candidate.roleScore >= 0.64 && candidate.score >= 0.64 && candidate.roleMargin >= 0.08)
    .sort((left, right) => right.score - left.score || right.roleScore - left.roleScore);
  const rejectedBest = scoredComponents
    .slice()
    .sort((left, right) => right.score - left.score || right.roleScore - left.roleScore)[0];
  return {
    candidates,
    rawComponentCount: rawComponents.length,
    excludedCount: textFiltered.excludedCount,
    rejectedBest: rejectedBest
      ? {
          score: rejectedBest.score,
          roleScore: rejectedBest.roleScore,
          roleMargin: rejectedBest.roleMargin,
          competingRole: rejectedBest.competingRole,
          competingRoleScore: rejectedBest.competingRoleScore,
          bounds: rejectedBest.bounds
        }
      : undefined
  };
}

function selectVisibleSemanticIconCandidate(
  candidates: VisibleSemanticIconCandidate[],
  options: {
    slot?: TopBarIconSlot;
    verticalSlot?: SemanticIconVerticalSlot;
    orderFromRight: number;
    anchorPoint?: { x: number; y: number };
  }
): { candidate?: VisibleSemanticIconCandidate; reason: string } {
  if (candidates.length === 0) {
    return { reason: "current_visual_icon_not_found" };
  }
  if (candidates.length === 1) {
    return { candidate: candidates[0], reason: "current_visual_icon_selected" };
  }
  if (options.verticalSlot) {
    const ordered = candidates
      .slice()
      .sort((left, right) =>
        visibleSemanticIconPlacementScore(right, options) - visibleSemanticIconPlacementScore(left, options) ||
        right.score - left.score
      );
    return {
      candidate: ordered[0],
      reason: "current_visual_icon_selected_by_position"
    };
  }
  if (options.slot) {
    const ordered = candidates
      .slice()
      .sort((left, right) => options.slot === "trailing" ? right.point.x - left.point.x : left.point.x - right.point.x);
    return {
      candidate: ordered[Math.max(0, options.orderFromRight - 1)] ?? ordered[0],
      reason: "current_visual_icon_selected_by_position"
    };
  }
  if (options.anchorPoint) {
    const ordered = candidates
      .slice()
      .sort((left, right) => distanceToPoint(left.point, options.anchorPoint!) - distanceToPoint(right.point, options.anchorPoint!));
    const [first, second] = ordered;
    if (first && second && distanceToPoint(first.point, options.anchorPoint) + 48 < distanceToPoint(second.point, options.anchorPoint)) {
      return { candidate: first, reason: "current_visual_icon_selected_by_anchor" };
    }
  }
  return { reason: "ambiguous_icon_candidates" };
}

function visibleSemanticIconPlacementScore(
  candidate: VisibleSemanticIconCandidate,
  options: { slot?: TopBarIconSlot; verticalSlot?: SemanticIconVerticalSlot }
): number {
  const horizontalPosition = (candidate.region.x + candidate.region.width / 2) / 100;
  const verticalPosition = (candidate.region.y + candidate.region.height / 2) / 100;
  const horizontalScore = options.slot === "trailing"
    ? horizontalPosition
    : options.slot === "leading"
      ? 1 - horizontalPosition
      : 0.5;
  const verticalScore = options.verticalSlot === "top"
    ? 1 - verticalPosition
    : options.verticalSlot === "bottom"
      ? verticalPosition
      : options.verticalSlot === "center"
        ? 1 - Math.min(1, Math.abs(verticalPosition - 0.5) * 2)
        : 0.5;
  return horizontalScore * 0.45 + verticalScore * 0.55;
}

function visibleSemanticIconGeometryScore(component: TopBarIconVisualComponent, sample: ImageSample): number {
  const aspectRatio = component.bounds.width / Math.max(1, component.bounds.height);
  const aspectScore = Math.max(0, 1 - Math.abs(1 - aspectRatio) / 1.4);
  const iconSize = Math.max(component.bounds.width, component.bounds.height);
  const baseSize = Math.min(sample.width, sample.height);
  const minExpectedSize = Math.max(14, baseSize * 0.012);
  const maxExpectedSize = Math.max(42, baseSize * 0.095);
  const sizeScore = iconSize >= minExpectedSize && iconSize <= maxExpectedSize
    ? 1
    : Math.max(0, 1 - Math.min(Math.abs(iconSize - minExpectedSize), Math.abs(iconSize - maxExpectedSize)) / Math.max(1, baseSize * 0.08));
  const density = component.darkPixelCount / Math.max(1, component.bounds.width * component.bounds.height);
  const densityScore = density >= 0.025 && density <= 0.72 ? 1 : 0.3;
  return aspectScore * 0.34 + sizeScore * 0.33 + densityScore * 0.33;
}

function semanticIconRoleSpecificVisualBonus(component: TopBarIconVisualComponent, sample: ImageSample, role: string): number {
  if (normalizeSemanticIconRole(role) === "report") {
    return reportIconFrameScore(component, sample) * 0.22;
  }
  return 0;
}

function reportIconFrameScore(component: TopBarIconVisualComponent, sample: ImageSample): number {
  const { bounds } = component;
  const isForeground = component.polarity === "light" ? isTopBarIconLightPixel : isTopBarIconDarkPixel;
  const leftX = Math.round(bounds.x + bounds.width * 0.08);
  const rightX = Math.round(bounds.x + bounds.width * 0.92);
  const topY = Math.round(bounds.y + bounds.height * 0.18);
  const bottomY = Math.round(bounds.y + bounds.height * 0.88);
  const leftCoverage = verticalLineCoverage(sample, isForeground, leftX, topY, bottomY);
  const rightCoverage = verticalLineCoverage(sample, isForeground, rightX, topY, bottomY);
  const topCoverage = horizontalLineCoverage(sample, isForeground, topY, leftX, rightX);
  const bottomCoverage = horizontalLineCoverage(sample, isForeground, bottomY, leftX, rightX);
  const frameScore = (leftCoverage + rightCoverage + topCoverage + bottomCoverage) / 4;
  const aspect = bounds.width / Math.max(1, bounds.height);
  const aspectScore = aspect >= 0.55 && aspect <= 1.2 ? 1 : 0.4;
  return frameScore * 0.82 + aspectScore * 0.18;
}

function verticalLineCoverage(
  sample: ImageSample,
  isForeground: (value: number | undefined) => boolean,
  x: number,
  startY: number,
  endY: number
): number {
  let foreground = 0;
  let total = 0;
  const clampedX = Math.max(0, Math.min(sample.width - 1, x));
  for (let y = Math.max(0, startY); y <= Math.min(sample.height - 1, endY); y += 1) {
    total += 1;
    if (isForeground(sample.pixels[y * sample.width + clampedX])) {
      foreground += 1;
    }
  }
  return total ? foreground / total : 0;
}

function horizontalLineCoverage(
  sample: ImageSample,
  isForeground: (value: number | undefined) => boolean,
  y: number,
  startX: number,
  endX: number
): number {
  let foreground = 0;
  let total = 0;
  const clampedY = Math.max(0, Math.min(sample.height - 1, y));
  for (let x = Math.max(0, startX); x <= Math.min(sample.width - 1, endX); x += 1) {
    total += 1;
    if (isForeground(sample.pixels[clampedY * sample.width + x])) {
      foreground += 1;
    }
  }
  return total ? foreground / total : 0;
}

function ambiguousSemanticIconMessage(role: string, candidateCount: number, semanticArea: VisualSemanticArea): string {
  const areaText = semanticAreaDisplayName(semanticArea);
  const countText = candidateCount > 0 ? `${candidateCount} 个` : "多个";
  return `${areaText}找到 ${countText}${semanticIconDisplayName(role)}图标，无法判断要点击哪一个；请补充位置（例如右上角、底部、或某段文字附近）后重试。`;
}

function semanticAreaDisplayName(area: VisualSemanticArea): string {
  if (area === "top") return "顶部区域";
  if (area === "bottom") return "底部区域";
  if (area === "content") return "内容区域";
  return "当前屏幕";
}

function semanticIconDisplayName(role: string): string {
  switch (normalizeSemanticIconRole(role)) {
    case "add":
      return "加号";
    case "search":
      return "搜索";
    case "back":
      return "返回";
    case "close":
      return "关闭";
    case "share":
      return "分享";
    case "more":
      return "更多";
    case "menu":
      return "菜单";
    case "filter":
      return "筛选";
    case "sort":
      return "排序";
    case "emoji":
      return "表情";
    case "mic":
      return "麦克风";
    case "arrowup":
      return "上箭头";
    case "keyboard":
      return "键盘";
    case "image":
      return "图片";
    case "camera":
      return "相机";
    case "file":
      return "文件";
    case "card":
      return "卡片";
    case "arrow":
    case "chevron":
      return "箭头";
    default: {
      const trimmed = role.trim();
      return trimmed ? `${trimmed} ` : "";
    }
  }
}

function distanceToPoint(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function percentRegionsEqual(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function findContentAddIconComponents(
  sample: ImageSample,
  rect: { x: number; y: number; width: number; height: number }
): TopBarIconVisualComponent[] {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(sample.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(sample.height, Math.ceil(rect.y + rect.height));
  const visited = new Uint8Array(sample.width * sample.height);
  const components: TopBarIconVisualComponent[] = [];
  const baseSize = Math.min(sample.width, sample.height);
  const minSize = Math.max(24, Math.round(baseSize * 0.035));
  const maxSize = Math.max(120, Math.round(baseSize * 0.2));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = y * sample.width + x;
      if (visited[index] || !isTopBarIconDarkPixel(sample.pixels[index])) {
        continue;
      }
      const component = floodFillTopBarIconComponent(
        sample,
        { startX, startY, endX, endY },
        x,
        y,
        visited,
        isTopBarIconDarkPixel,
        "dark"
      );
      if (!component) {
        continue;
      }
      const { width, height } = component.bounds;
      const aspect = width / Math.max(1, height);
      const density = component.darkPixelCount / Math.max(1, width * height);
      if (width < minSize || height < minSize || width > maxSize || height > maxSize || aspect < 0.68 || aspect > 1.32 || density < 0.36) {
        continue;
      }
      components.push(component);
    }
  }
  return components;
}

function contentAddIconSearchRegion(
  slot: TopBarIconSlot,
  verticalSlot: SemanticIconVerticalSlot | undefined
): { x: number; y: number; width: number; height: number } {
  const horizontal = slot === "trailing"
    ? { x: 55, width: 45 }
    : { x: 0, width: 45 };
  if (verticalSlot === "top") return { ...horizontal, y: 14, height: 43 };
  if (verticalSlot === "center") return { ...horizontal, y: 25, height: 55 };
  if (verticalSlot === "bottom") return { ...horizontal, y: 42, height: 55 };
  return { ...horizontal, y: 14, height: 75 };
}

function contentAddIconScore(
  component: TopBarIconVisualComponent,
  sample: ImageSample,
  slot: TopBarIconSlot,
  verticalSlot: SemanticIconVerticalSlot | undefined
): number {
  const { width, height } = component.bounds;
  const baseSize = Math.min(sample.width, sample.height);
  const sizeRatio = Math.min(width, height) / Math.max(1, baseSize);
  const sizeScore = 1 - Math.min(1, Math.abs(sizeRatio - 0.13) / 0.1);
  const aspectScore = 1 - Math.min(1, Math.abs(width / Math.max(1, height) - 1) / 0.32);
  const density = component.darkPixelCount / Math.max(1, width * height);
  const densityScore = Math.max(0, Math.min(1, (density - 0.36) / 0.35));
  const horizontalPosition = component.center.x / Math.max(1, sample.width);
  const positionScore = slot === "trailing" ? horizontalPosition : 1 - horizontalPosition;
  const verticalPosition = component.center.y / Math.max(1, sample.height);
  const verticalScore = contentAddIconVerticalScore(verticalPosition, verticalSlot);
  const plusScore = centeredLightCrossScore(component, sample);
  return 0.29 * plusScore + 0.22 * aspectScore + 0.18 * densityScore + 0.13 * sizeScore + 0.09 * positionScore + 0.09 * verticalScore;
}

function contentAddIconVerticalScore(
  verticalPosition: number,
  verticalSlot: SemanticIconVerticalSlot | undefined
): number {
  if (verticalSlot === "top") return 1 - verticalPosition;
  if (verticalSlot === "bottom") return verticalPosition;
  if (verticalSlot === "center") return 1 - Math.min(1, Math.abs(verticalPosition - 0.5) * 2);
  return 0.5;
}

function centeredLightCrossScore(component: TopBarIconVisualComponent, sample: ImageSample): number {
  const radius = Math.max(4, Math.round(Math.min(component.bounds.width, component.bounds.height) * 0.24));
  const stroke = Math.max(1, Math.round(radius * 0.16));
  let light = 0;
  let sampled = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    for (let thickness = -stroke; thickness <= stroke; thickness += 1) {
      const points = [
        { x: component.center.x + offset, y: component.center.y + thickness },
        { x: component.center.x + thickness, y: component.center.y + offset }
      ];
      for (const point of points) {
        if (point.x < 0 || point.x >= sample.width || point.y < 0 || point.y >= sample.height) {
          continue;
        }
        sampled += 1;
        if ((sample.pixels[point.y * sample.width + point.x] ?? 0) >= 180) {
          light += 1;
        }
      }
    }
  }
  return sampled ? light / sampled : 0;
}

function selectCurrentTopBarIconComponent(
  components: TopBarIconVisualComponent[],
  options: { role: string; slot: TopBarIconSlot; orderFromRight: number }
): TopBarIconVisualComponent | undefined {
  if (!components.length) {
    return undefined;
  }
  if (isKnownTopBarIconRole(options.role)) {
    return components.slice().sort((left, right) =>
      (right.roleScore ?? 0) - (left.roleScore ?? 0) || right.score - left.score
    )[0];
  }
  if (options.role === "avatar") {
    return components.slice().sort((left, right) => right.score - left.score)[0];
  }
  const byVisualOrder = components
    .slice()
    .sort((left, right) => options.slot === "trailing" ? right.center.x - left.center.x : left.center.x - right.center.x);
  const ordered = options.slot === "trailing" ? byVisualOrder[options.orderFromRight - 1] : byVisualOrder[0];
  return ordered ?? components.slice().sort((left, right) => right.score - left.score)[0];
}

function topBarIconSearchRegion(
  candidate: VisualImageRegionCandidate,
  options: {
    role: string;
    slot: TopBarIconSlot;
    semanticArea: VisualSemanticArea;
    anchorXPercent?: number;
  }
): { x: number; y: number; width: number; height: number } {
  const centerX = candidate.region.x + candidate.region.width / 2;
  const centerY = candidate.region.y + candidate.region.height / 2;
  if (options.slot === "trailing") {
    const height = Math.min(11, Math.max(candidate.region.height * 4.2, 8.5));
    const topLimit = options.semanticArea === "top" ? 4.6 : 0;
    const bottomLimit = options.semanticArea === "top" ? 16 : 100;
    const anchorStart = options.anchorXPercent !== undefined ? options.anchorXPercent + 5 : undefined;
    const candidateStart = centerX - Math.max(18, candidate.region.width * 5);
    const x = Math.max(0, Math.min(98, anchorStart ?? candidateStart, candidateStart));
    const y = Math.max(topLimit, Math.min(bottomLimit - height, centerY - height / 2));
    return clampPercentRegion({
      x,
      y,
      width: Math.max(0, 98 - x),
      height
    });
  }
  if (options.role.trim().toLowerCase() === "avatar" && options.slot === "leading") {
    const height = Math.min(15, Math.max(candidate.region.height * 4.2, 10));
    const topLimit = options.semanticArea === "top" ? 2.5 : 0;
    const bottomLimit = options.semanticArea === "top" ? 17.5 : 100;
    const width = Math.min(28, Math.max(18, options.anchorXPercent ?? 20));
    const y = Math.max(topLimit, Math.min(bottomLimit - height, centerY - height / 2));
    return clampPercentRegion({ x: 0, y, width, height });
  }
  const minWidth = 11;
  const minHeight = 7.5;
  const width = Math.min(16, Math.max(candidate.region.width * 2.6, minWidth));
  const height = Math.min(14, Math.max(candidate.region.height * 3.6, minHeight));
  const topLimit = options.semanticArea === "top" ? 2.5 : 0;
  const bottomLimit = options.semanticArea === "top" ? 16 : 100;
  let x = centerX - width / 2;
  if (options.slot === "leading" && options.anchorXPercent !== undefined) {
    x = Math.min(x, options.anchorXPercent - width - 1);
  }
  const y = Math.max(topLimit, Math.min(bottomLimit - height, centerY - height / 2));
  return clampPercentRegion({
    x,
    y,
    width,
    height
  });
}

function findTopBarVisualComponents(sample: ImageSample, rect: { x: number; y: number; width: number; height: number }): TopBarIconVisualComponent[] {
  return [
    ...findTopBarVisualComponentsByPolarity(sample, rect, "dark"),
    ...findTopBarVisualComponentsByPolarity(sample, rect, "light")
  ];
}

function findTopBarVisualComponentsByPolarity(
  sample: ImageSample,
  rect: { x: number; y: number; width: number; height: number },
  polarity: "dark" | "light"
): TopBarIconVisualComponent[] {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(sample.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(sample.height, Math.ceil(rect.y + rect.height));
  if (startX >= endX || startY >= endY) {
    return [];
  }
  const visited = new Uint8Array(sample.width * sample.height);
  const components: TopBarIconVisualComponent[] = [];
  const isForeground = polarity === "dark" ? isTopBarIconDarkPixel : isTopBarIconLightPixel;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = y * sample.width + x;
      if (visited[index] || !isForeground(sample.pixels[index])) {
        continue;
      }
      const component = floodFillTopBarIconComponent(
        sample,
        { startX, startY, endX, endY },
        x,
        y,
        visited,
        isForeground,
        polarity
      );
      if (!component || component.darkPixelCount < 18) {
        continue;
      }
      const minSize = Math.max(8, Math.round(Math.min(sample.width, sample.height) * 0.006));
      const maxSize = Math.max(36, Math.round(Math.min(sample.width, sample.height) * 0.075));
      if (component.bounds.width < minSize || component.bounds.height < minSize || component.bounds.width > maxSize || component.bounds.height > maxSize) {
        continue;
      }
      components.push(component);
    }
  }
  return components;
}

function findAvatarVisualComponents(sample: ImageSample, rect: { x: number; y: number; width: number; height: number }): TopBarIconVisualComponent[] {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(sample.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(sample.height, Math.ceil(rect.y + rect.height));
  if (startX >= endX || startY >= endY) {
    return [];
  }
  const values: number[] = [];
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const value = sample.pixels[y * sample.width + x];
      if (typeof value === "number" && value >= 0) {
        values.push(value);
      }
    }
  }
  values.sort((left, right) => left - right);
  const background = values[Math.max(0, Math.min(values.length - 1, Math.floor(values.length * 0.9)))] ?? 255;
  const foregroundThreshold = Math.min(248, background - 8);
  const isForeground = (value: number | undefined) => typeof value === "number" && value >= 0 && value <= foregroundThreshold;
  const visited = new Uint8Array(sample.width * sample.height);
  const components: TopBarIconVisualComponent[] = [];
  const minSize = Math.max(18, Math.round(Math.min(sample.width, sample.height) * 0.03));
  const maxSize = Math.max(72, Math.round(Math.min(sample.width, sample.height) * 0.14));
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = y * sample.width + x;
      if (visited[index] || !isForeground(sample.pixels[index])) {
        continue;
      }
      const component = floodFillAvatarComponent(sample, { startX, startY, endX, endY }, x, y, visited, isForeground);
      if (!component) {
        continue;
      }
      const aspectRatio = component.bounds.width / Math.max(1, component.bounds.height);
      const density = component.darkPixelCount / Math.max(1, component.bounds.width * component.bounds.height);
      if (
        component.bounds.width < minSize ||
        component.bounds.height < minSize ||
        component.bounds.width > maxSize ||
        component.bounds.height > maxSize ||
        aspectRatio < 0.68 ||
        aspectRatio > 1.32 ||
        density < 0.28
      ) {
        continue;
      }
      components.push(component);
    }
  }
  return components;
}

function floodFillAvatarComponent(
  sample: ImageSample,
  bounds: { startX: number; startY: number; endX: number; endY: number },
  startX: number,
  startY: number,
  visited: Uint8Array,
  isForeground: (value: number | undefined) => boolean
): TopBarIconVisualComponent | undefined {
  const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let pixelCount = 0;
  while (stack.length) {
    const point = stack.pop()!;
    if (point.x < bounds.startX || point.x >= bounds.endX || point.y < bounds.startY || point.y >= bounds.endY) {
      continue;
    }
    const index = point.y * sample.width + point.x;
    if (visited[index] || !isForeground(sample.pixels[index])) {
      continue;
    }
    visited[index] = 1;
    pixelCount += 1;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    stack.push(
      { x: point.x - 1, y: point.y },
      { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 },
      { x: point.x, y: point.y + 1 }
    );
  }
  if (!pixelCount) {
    return undefined;
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return {
    bounds: { x: minX, y: minY, width, height },
    center: { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) },
    darkPixelCount: pixelCount,
    score: 0
  };
}

function mergeNearbyTopBarIconComponents(components: TopBarIconVisualComponent[], sample: ImageSample): TopBarIconVisualComponent[] {
  const maxGap = Math.max(6, Math.round(Math.min(sample.width, sample.height) * 0.018));
  const maxMergedSize = Math.max(36, Math.round(Math.min(sample.width, sample.height) * 0.09));
  const remaining = components.slice().sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y);
  const merged: TopBarIconVisualComponent[] = [];
  while (remaining.length) {
    let current = remaining.shift()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index]!;
        if (current.polarity !== candidate.polarity) {
          continue;
        }
        if (!componentsShouldMerge(current.bounds, candidate.bounds, maxGap, maxMergedSize)) {
          continue;
        }
        current = mergeTopBarIconComponents(current, candidate);
        remaining.splice(index, 1);
        changed = true;
        break;
      }
    }
    merged.push(current);
  }
  return merged;
}

function excludeOcrTextOverlappingComponents<T extends { bounds: { x: number; y: number; width: number; height: number }; center: { x: number; y: number } }>(
  components: T[],
  layout: OcrLayoutResult | undefined,
  sample: ImageSample
): { components: T[]; excludedCount: number } {
  const textRects = ocrTextRectsInSample(layout, sample);
  if (!textRects.length || !components.length) {
    return { components, excludedCount: 0 };
  }
  const kept: T[] = [];
  let excludedCount = 0;
  for (const component of components) {
    if (componentOverlapsOcrText(component, textRects)) {
      excludedCount += 1;
    } else {
      kept.push(component);
    }
  }
  return { components: kept, excludedCount };
}

function ocrTextOverlapDiagnostics<T extends { bounds: { x: number; y: number; width: number; height: number }; center: { x: number; y: number } }>(
  components: T[],
  layout: OcrLayoutResult | undefined,
  sample: ImageSample
): { overlappingCount: number } {
  const textRects = ocrTextRectsInSample(layout, sample);
  if (!textRects.length || !components.length) {
    return { overlappingCount: 0 };
  }
  return {
    overlappingCount: components.filter((component) => componentOverlapsOcrText(component, textRects)).length
  };
}

function locateLeadingAvatarByTopTitle(
  layout: OcrLayoutResult | undefined,
  sample: ImageSample,
  deviceSize: { width: number; height: number }
): {
  point: { x: number; y: number };
  region: { x: number; y: number; width: number; height: number };
  sampleBounds: { x: number; y: number; width: number; height: number };
  diagnostic: Record<string, unknown>;
} | undefined {
  const title = findTopBarTitleCandidate(layout, sample);
  if (!title) {
    return undefined;
  }
  const titleRect = ocrBoxToSampleRect(title, layout!, sample);
  const diameter = Math.max(36, Math.min(92, titleRect.height * 1.08));
  const center = {
    x: Math.max(diameter / 2, titleRect.x - titleRect.height),
    y: titleRect.y + titleRect.height / 2
  };
  const sampleBounds = {
    x: center.x - diameter / 2,
    y: center.y - diameter / 2,
    width: diameter,
    height: diameter
  };
  const point = {
    x: scaleCoordinate(center.x, sample.width, deviceSize.width),
    y: scaleCoordinate(center.y, sample.height, deviceSize.height)
  };
  return {
    point,
    region: sampleRectToPercent(sampleBounds, sample),
    sampleBounds,
    diagnostic: {
      titleText: normalizeOcrText(title.text),
      titleBounds: titleRect,
      inferredBounds: sampleBounds,
      inferredPoint: point
    }
  };
}

function findTopBarTitleCandidate(layout: OcrLayoutResult | undefined, sample: ImageSample): OcrTextBox | undefined {
  if (!layout?.boxes.length || layout.width <= 0 || layout.height <= 0) {
    return undefined;
  }
  const scaleX = sample.width / layout.width;
  const scaleY = sample.height / layout.height;
  return layout.boxes
    .filter((box) => normalizeOcrText(box.text).length > 0)
    .map((box) => {
      const rect = ocrBoxToSampleRect(box, layout, sample);
      const centerYPercent = ((rect.y + rect.height / 2) / sample.height) * 100;
      const centerXPercent = ((rect.x + rect.width / 2) / sample.width) * 100;
      const height = box.height * scaleY;
      const area = box.width * scaleX * height;
      const leftBias = Math.max(0, 1 - centerXPercent / 45);
      const score = height * 3 + Math.min(area / 1200, 120) + leftBias * 40;
      return { box, centerYPercent, centerXPercent, height, score };
    })
    .filter((item) => item.centerYPercent >= 4 && item.centerYPercent <= 12.8)
    .filter((item) => item.centerXPercent >= 8 && item.centerXPercent <= 48)
    .filter((item) => item.height >= Math.max(24, sample.height * 0.014))
    .sort((left, right) => right.score - left.score)[0]?.box;
}

function ocrBoxToSampleRect(box: OcrTextBox, layout: OcrLayoutResult, sample: ImageSample): { x: number; y: number; width: number; height: number } {
  const scaleX = sample.width / layout.width;
  const scaleY = sample.height / layout.height;
  return {
    x: box.x * scaleX,
    y: box.y * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY
  };
}

function componentOverlapsOcrText(
  component: { bounds: { x: number; y: number; width: number; height: number }; center: { x: number; y: number } },
  textRects: Array<{ x: number; y: number; width: number; height: number }>
): boolean {
  const componentArea = Math.max(1, component.bounds.width * component.bounds.height);
  return textRects.some((rect) => {
    const overlapArea = rectIntersectionArea(component.bounds, rect);
    if (overlapArea <= 0) {
      return false;
    }
    const overlapRatio = overlapArea / componentArea;
    if (overlapRatio >= 0.32) {
      return true;
    }
    return overlapRatio >= 0.12 && pointInsideRect(component.center, expandRect(rect, 2));
  });
}

function ocrTextRectsInSample(layout: OcrLayoutResult | undefined, sample: ImageSample): Array<{ x: number; y: number; width: number; height: number }> {
  if (!layout?.boxes.length || layout.width <= 0 || layout.height <= 0) {
    return [];
  }
  const scaleX = sample.width / layout.width;
  const scaleY = sample.height / layout.height;
  return layout.boxes
    .filter((box) => normalizeOcrText(box.text).length > 0)
    .map((box) => ({
      x: box.x * scaleX,
      y: box.y * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rectIntersectionArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function pointInsideRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function expandRect(rect: { x: number; y: number; width: number; height: number }, amount: number): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

function componentsShouldMerge(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  maxGap: number,
  maxMergedSize: number
): boolean {
  const horizontalGap = Math.max(0, Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width));
  const verticalGap = Math.max(0, Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height));
  const merged = unionRect(left, right);
  return horizontalGap <= maxGap &&
    verticalGap <= maxGap &&
    merged.width <= maxMergedSize &&
    merged.height <= maxMergedSize;
}

function mergeTopBarIconComponents(left: TopBarIconVisualComponent, right: TopBarIconVisualComponent): TopBarIconVisualComponent {
  const bounds = unionRect(left.bounds, right.bounds);
  return {
    bounds,
    center: {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2)
    },
    darkPixelCount: left.darkPixelCount + right.darkPixelCount,
    score: 0,
    polarity: left.polarity
  };
}

function unionRect(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: rightEdge - x,
    height: bottomEdge - y
  };
}

function floodFillTopBarIconComponent(
  sample: ImageSample,
  bounds: { startX: number; startY: number; endX: number; endY: number },
  startX: number,
  startY: number,
  visited: Uint8Array,
  isForeground: (value: number | undefined) => boolean,
  polarity: "dark" | "light"
): TopBarIconVisualComponent | undefined {
  const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let darkPixelCount = 0;
  while (stack.length) {
    const point = stack.pop()!;
    if (point.x < bounds.startX || point.x >= bounds.endX || point.y < bounds.startY || point.y >= bounds.endY) {
      continue;
    }
    const index = point.y * sample.width + point.x;
    if (visited[index] || !isForeground(sample.pixels[index])) {
      continue;
    }
    visited[index] = 1;
    darkPixelCount += 1;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    stack.push(
      { x: point.x - 1, y: point.y },
      { x: point.x + 1, y: point.y },
      { x: point.x, y: point.y - 1 },
      { x: point.x, y: point.y + 1 }
    );
  }
  if (!darkPixelCount) {
    return undefined;
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return {
    bounds: { x: minX, y: minY, width, height },
    center: {
      x: Math.round(minX + width / 2),
      y: Math.round(minY + height / 2)
    },
    darkPixelCount,
    score: 0,
    polarity
  };
}

function isTopBarIconDarkPixel(value: number | undefined): boolean {
  return typeof value === "number" && value >= 0 && value <= 110;
}

function isTopBarIconLightPixel(value: number | undefined): boolean {
  return typeof value === "number" && value >= 205;
}

const KNOWN_TOP_BAR_ICON_ROLE_LIST = ["add", "arrow", "arrowup", "back", "camera", "card", "chevron", "close", "emoji", "file", "filter", "image", "keyboard", "menu", "mic", "more", "report", "search", "share", "sort"] as const;
const KNOWN_TOP_BAR_ICON_ROLES = new Set<string>(KNOWN_TOP_BAR_ICON_ROLE_LIST);

const VISUAL_QUERY_ICON_ROLE_ALIASES: ReadonlyArray<{ role: string; aliases: readonly string[] }> = [
  { role: "search", aliases: ["搜索", "查找", "检索", "放大镜", "search", "magnifier", "magnifyingglass"] },
  { role: "add", aliases: ["添加", "新增", "新建", "加号", "附件", "更多面板", "plus", "add", "attach", "attachment"] },
  { role: "back", aliases: ["返回", "后退", "左箭头", "back", "arrowleft", "leftarrow"] },
  { role: "close", aliases: ["关闭", "叉号", "close", "xicon", "xbutton"] },
  { role: "share", aliases: ["分享", "share"] },
  { role: "more", aliases: ["更多", "三点", "省略号", "more", "overflow", "ellipsis"] },
  { role: "menu", aliases: ["菜单", "menu", "hamburger"] },
  { role: "filter", aliases: ["筛选", "过滤", "filter"] },
  { role: "sort", aliases: ["排序", "上下箭头", "升序", "降序", "sort"] },
  { role: "report", aliases: ["报告", "课堂报告", "剪贴板", "看板", "report", "clipboard", "lessonreport", "lesson_report"] },
  { role: "emoji", aliases: ["表情", "表情符号", "笑脸", "emoji", "emoticon", "emojicon", "emotion", "face", "smile"] },
  { role: "mic", aliases: ["语音", "麦克风", "话筒", "录音", "mic", "microphone", "voice", "audio", "record"] },
  { role: "arrowup", aliases: ["上箭头", "向上箭头", "发送", "提交", "arrowup", "uparrow", "arrowupward", "send", "submit"] },
  { role: "keyboard", aliases: ["键盘", "输入法", "keyboard", "ime"] },
  { role: "image", aliases: ["图片", "照片", "相册", "图册", "image", "photo", "picture", "gallery", "album"] },
  { role: "camera", aliases: ["相机", "拍照", "camera"] },
  { role: "file", aliases: ["文件", "文档", "folder", "file", "document"] },
  { role: "card", aliases: ["名片", "卡片", "card", "contactcard", "profilecard"] },
  { role: "chevron", aliases: ["箭头", "右箭头", "展开", "进入", "chevron", "arrow", "arrowright", "rightarrow"] }
];

function visualIconRoleFromQuery(query: string): string | undefined {
  const normalized = compactVisualQuery(query);
  if (!normalized) {
    return undefined;
  }
  if (isKnownTopBarIconRole(normalized)) {
    return normalizeSemanticIconRole(normalized);
  }
  return VISUAL_QUERY_ICON_ROLE_ALIASES.find((entry) =>
    entry.aliases.some((alias) => {
      const normalizedAlias = compactVisualQuery(alias);
      return Boolean(normalizedAlias && normalized.includes(normalizedAlias));
    })
  )?.role;
}

function compactVisualQuery(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isKnownTopBarIconRole(role: string): boolean {
  return KNOWN_TOP_BAR_ICON_ROLES.has(normalizeSemanticIconRole(role));
}

function normalizeSemanticIconRole(role: string): string {
  const normalized = compactVisualQuery(role);
  if (normalized === "left" || normalized === "right") {
    return "chevron";
  }
  if (normalized === "plus" || normalized === "attach" || normalized === "attachment") {
    return "add";
  }
  if (normalized === "send" || normalized === "submit" || normalized === "uparrow" || normalized === "arrowupward") {
    return "arrowup";
  }
  if (normalized === "voice" || normalized === "audio" || normalized === "microphone" || normalized === "record") {
    return "mic";
  }
  if (normalized === "face" || normalized === "smile" || normalized === "emoticon" || normalized === "emojicon" || normalized === "emotion" || normalized === "emojipicker") {
    return "emoji";
  }
  if (normalized === "photo" || normalized === "picture" || normalized === "gallery" || normalized === "album") {
    return "image";
  }
  if (normalized === "document" || normalized === "folder") {
    return "file";
  }
  if (normalized === "contactcard" || normalized === "profilecard") {
    return "card";
  }
  return normalized;
}

function semanticIconRoleScores(component: TopBarIconVisualComponent, sample: ImageSample): Map<string, number> {
  const scores = new Map<string, number>();
  for (const role of KNOWN_TOP_BAR_ICON_ROLE_LIST) {
    scores.set(role, topBarIconRoleShapeScore(component, sample, role) ?? 0);
  }
  return scores;
}

function strongestCompetingSemanticIconRole(scores: Map<string, number>, targetRole: string): { role?: string; score: number } {
  const target = normalizeSemanticIconRole(targetRole);
  let strongest: { role?: string; score: number } = { score: 0 };
  for (const [role, score] of scores) {
    if (semanticIconRolesEquivalent(role, target)) {
      continue;
    }
    if (score > strongest.score) {
      strongest = { role, score };
    }
  }
  return strongest;
}

function semanticIconRolesEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeSemanticIconRole(left);
  const normalizedRight = normalizeSemanticIconRole(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const directional = new Set(["arrow", "back", "chevron"]);
  return directional.has(normalizedLeft) && directional.has(normalizedRight);
}

function topBarIconRoleShapeScore(component: TopBarIconVisualComponent, sample: ImageSample, role: string): number | undefined {
  const normalizedRole = normalizeSemanticIconRole(role);
  if (!isKnownTopBarIconRole(normalizedRole) || !component.polarity) {
    return undefined;
  }
  const observed = normalizedComponentMask(component, sample);
  if (observed.length < 8) {
    return 0;
  }
  const templates = topBarIconRoleTemplates(normalizedRole);
  if (!templates.length) {
    return undefined;
  }
  return Math.max(...templates.map((template) => binaryShapeSimilarity(observed, template)));
}

function normalizedComponentMask(component: TopBarIconVisualComponent, sample: ImageSample): Array<{ x: number; y: number }> {
  const canvasSize = 32;
  const contentSize = 26;
  const largestSide = Math.max(component.bounds.width, component.bounds.height, 1);
  const offsetX = (canvasSize - (component.bounds.width / largestSide) * contentSize) / 2;
  const offsetY = (canvasSize - (component.bounds.height / largestSide) * contentSize) / 2;
  const mask = new Uint8Array(canvasSize * canvasSize);
  const isForeground = component.polarity === "light" ? isTopBarIconLightPixel : isTopBarIconDarkPixel;
  const endX = Math.min(sample.width, component.bounds.x + component.bounds.width);
  const endY = Math.min(sample.height, component.bounds.y + component.bounds.height);
  for (let y = Math.max(0, component.bounds.y); y < endY; y += 1) {
    for (let x = Math.max(0, component.bounds.x); x < endX; x += 1) {
      if (!isForeground(sample.pixels[y * sample.width + x])) {
        continue;
      }
      const normalizedX = Math.max(0, Math.min(canvasSize - 1, Math.round(offsetX + ((x - component.bounds.x) / largestSide) * contentSize)));
      const normalizedY = Math.max(0, Math.min(canvasSize - 1, Math.round(offsetY + ((y - component.bounds.y) / largestSide) * contentSize)));
      mask[normalizedY * canvasSize + normalizedX] = 1;
    }
  }
  return maskPoints(mask, canvasSize);
}

function topBarIconRoleTemplates(role: string): Array<Array<{ x: number; y: number }>> {
  const create = (draw: (mask: Uint8Array) => void): Array<{ x: number; y: number }> => {
    const mask = new Uint8Array(32 * 32);
    draw(mask);
    return maskPoints(mask, 32);
  };
  switch (role) {
    case "back":
      return [create((mask) => {
        drawMaskLine(mask, 32, 20, 4, 8, 16, 2);
        drawMaskLine(mask, 32, 8, 16, 20, 28, 2);
      })];
    case "arrow":
    case "chevron":
      return [
        create((mask) => {
          drawMaskLine(mask, 32, 20, 4, 8, 16, 2);
          drawMaskLine(mask, 32, 8, 16, 20, 28, 2);
        }),
        create((mask) => {
          drawMaskLine(mask, 32, 12, 4, 24, 16, 2);
          drawMaskLine(mask, 32, 24, 16, 12, 28, 2);
        })
      ];
    case "share":
      return [create((mask) => {
        drawMaskLine(mask, 32, 5, 13, 5, 28, 2);
        drawMaskLine(mask, 32, 5, 28, 27, 28, 2);
        drawMaskLine(mask, 32, 27, 28, 27, 13, 2);
        drawMaskLine(mask, 32, 16, 20, 16, 3, 2);
        drawMaskLine(mask, 32, 16, 3, 9, 10, 2);
        drawMaskLine(mask, 32, 16, 3, 23, 10, 2);
      })];
    case "report":
      return [create((mask) => {
        drawMaskLine(mask, 32, 8, 9, 8, 29, 2);
        drawMaskLine(mask, 32, 8, 29, 24, 29, 2);
        drawMaskLine(mask, 32, 24, 29, 24, 9, 2);
        drawMaskLine(mask, 32, 8, 9, 24, 9, 2);
        drawMaskLine(mask, 32, 12, 4, 20, 4, 2);
        drawMaskLine(mask, 32, 12, 4, 12, 11, 2);
        drawMaskLine(mask, 32, 20, 4, 20, 11, 2);
        drawMaskLine(mask, 32, 12, 16, 21, 16, 1);
        drawMaskLine(mask, 32, 12, 22, 21, 22, 1);
      })];
    case "search":
      return [create((mask) => {
        drawMaskCircle(mask, 32, 13, 13, 8, 2);
        drawMaskLine(mask, 32, 19, 19, 28, 28, 2);
      })];
    case "add":
      return [
        create((mask) => {
          drawMaskCircle(mask, 32, 16, 16, 12, 2);
          drawMaskLine(mask, 32, 9, 16, 23, 16, 2);
          drawMaskLine(mask, 32, 16, 9, 16, 23, 2);
        }),
        create((mask) => {
          drawMaskLine(mask, 32, 5, 16, 27, 16, 2);
          drawMaskLine(mask, 32, 16, 5, 16, 27, 2);
        })
      ];
    case "arrowup":
      return [create((mask) => {
        drawMaskLine(mask, 32, 16, 5, 16, 27, 2);
        drawMaskLine(mask, 32, 16, 5, 7, 14, 2);
        drawMaskLine(mask, 32, 16, 5, 25, 14, 2);
      })];
    case "emoji":
      return [create((mask) => {
        drawMaskCircle(mask, 32, 16, 16, 12, 2);
        drawMaskDot(mask, 32, 12, 13, 2);
        drawMaskDot(mask, 32, 20, 13, 2);
        drawMaskArc(mask, 32, 16, 17, 7, 30, 150, 2);
      })];
    case "mic":
      return [create((mask) => {
        drawMaskRoundedRect(mask, 32, 11, 4, 10, 17, 4, 2);
        drawMaskLine(mask, 32, 8, 14, 8, 18, 2);
        drawMaskLine(mask, 32, 24, 14, 24, 18, 2);
        drawMaskArc(mask, 32, 16, 17, 8, 0, 180, 2);
        drawMaskLine(mask, 32, 16, 24, 16, 29, 2);
        drawMaskLine(mask, 32, 10, 29, 22, 29, 2);
      })];
    case "keyboard":
      return [create((mask) => {
        drawMaskRect(mask, 32, 5, 9, 22, 15, 2);
        for (const y of [14, 19]) {
          for (const x of [10, 15, 20]) {
            drawMaskDot(mask, 32, x, y, 1);
          }
        }
      })];
    case "image":
      return [create((mask) => {
        drawMaskRect(mask, 32, 5, 8, 22, 17, 2);
        drawMaskDot(mask, 32, 21, 13, 2);
        drawMaskLine(mask, 32, 7, 24, 14, 17, 2);
        drawMaskLine(mask, 32, 14, 17, 19, 22, 2);
        drawMaskLine(mask, 32, 19, 22, 24, 16, 2);
      })];
    case "camera":
      return [create((mask) => {
        drawMaskRect(mask, 32, 5, 10, 22, 16, 2);
        drawMaskLine(mask, 32, 11, 10, 13, 6, 2);
        drawMaskLine(mask, 32, 13, 6, 20, 6, 2);
        drawMaskLine(mask, 32, 20, 6, 22, 10, 2);
        drawMaskCircle(mask, 32, 16, 18, 5, 2);
      })];
    case "file":
      return [create((mask) => {
        drawMaskLine(mask, 32, 9, 5, 20, 5, 2);
        drawMaskLine(mask, 32, 20, 5, 25, 10, 2);
        drawMaskLine(mask, 32, 25, 10, 25, 28, 2);
        drawMaskLine(mask, 32, 25, 28, 9, 28, 2);
        drawMaskLine(mask, 32, 9, 28, 9, 5, 2);
        drawMaskLine(mask, 32, 20, 5, 20, 11, 2);
        drawMaskLine(mask, 32, 20, 11, 25, 11, 2);
      })];
    case "card":
      return [create((mask) => {
        drawMaskRect(mask, 32, 5, 9, 22, 15, 2);
        drawMaskCircle(mask, 32, 12, 17, 3, 1);
        drawMaskLine(mask, 32, 18, 15, 24, 15, 1);
        drawMaskLine(mask, 32, 18, 20, 24, 20, 1);
      })];
    case "close":
      return [create((mask) => {
        drawMaskLine(mask, 32, 6, 6, 26, 26, 2);
        drawMaskLine(mask, 32, 26, 6, 6, 26, 2);
      })];
    case "menu":
      return [create((mask) => {
        drawMaskLine(mask, 32, 4, 8, 28, 8, 2);
        drawMaskLine(mask, 32, 4, 16, 28, 16, 2);
        drawMaskLine(mask, 32, 4, 24, 28, 24, 2);
      })];
    case "filter":
      return [create((mask) => {
        drawMaskLine(mask, 32, 5, 7, 27, 7, 2);
        drawMaskLine(mask, 32, 27, 7, 18, 18, 2);
        drawMaskLine(mask, 32, 18, 18, 18, 26, 2);
        drawMaskLine(mask, 32, 18, 26, 14, 28, 2);
        drawMaskLine(mask, 32, 14, 28, 14, 18, 2);
        drawMaskLine(mask, 32, 14, 18, 5, 7, 2);
      })];
    case "sort":
      return [
        create((mask) => {
          drawMaskLine(mask, 32, 5, 8, 27, 8, 2);
          drawMaskLine(mask, 32, 8, 16, 24, 16, 2);
          drawMaskLine(mask, 32, 11, 24, 21, 24, 2);
        }),
        create((mask) => {
          drawMaskLine(mask, 32, 11, 8, 21, 8, 2);
          drawMaskLine(mask, 32, 8, 16, 24, 16, 2);
          drawMaskLine(mask, 32, 5, 24, 27, 24, 2);
        })
      ];
    case "more":
      return [
        create((mask) => {
          drawMaskDot(mask, 32, 7, 16, 3);
          drawMaskDot(mask, 32, 16, 16, 3);
          drawMaskDot(mask, 32, 25, 16, 3);
        }),
        create((mask) => {
          drawMaskDot(mask, 32, 16, 7, 3);
          drawMaskDot(mask, 32, 16, 16, 3);
          drawMaskDot(mask, 32, 16, 25, 3);
        })
      ];
    default:
      return [];
  }
}

function maskPoints(mask: Uint8Array, width: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      points.push({ x: index % width, y: Math.floor(index / width) });
    }
  }
  return points;
}

function drawMaskLine(
  mask: Uint8Array,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x1 + ((x2 - x1) * step) / steps);
    const y = Math.round(y1 + ((y2 - y1) * step) / steps);
    drawMaskDot(mask, width, x, y, radius);
  }
}

function drawMaskCircle(mask: Uint8Array, width: number, centerX: number, centerY: number, radius: number, thickness: number): void {
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(Math.hypot(x - centerX, y - centerY) - radius) <= thickness) {
        mask[y * width + x] = 1;
      }
    }
  }
}

function drawMaskArc(
  mask: Uint8Array,
  width: number,
  centerX: number,
  centerY: number,
  radius: number,
  startDegrees: number,
  endDegrees: number,
  thickness: number
): void {
  const start = (Math.PI * startDegrees) / 180;
  const end = (Math.PI * endDegrees) / 180;
  const steps = Math.max(8, Math.ceil(radius * Math.abs(end - start)));
  for (let step = 0; step <= steps; step += 1) {
    const angle = start + ((end - start) * step) / steps;
    drawMaskDot(mask, width, Math.round(centerX + Math.cos(angle) * radius), Math.round(centerY + Math.sin(angle) * radius), thickness);
  }
}

function drawMaskRect(mask: Uint8Array, width: number, x: number, y: number, rectWidth: number, rectHeight: number, thickness: number): void {
  drawMaskLine(mask, width, x, y, x + rectWidth, y, thickness);
  drawMaskLine(mask, width, x + rectWidth, y, x + rectWidth, y + rectHeight, thickness);
  drawMaskLine(mask, width, x + rectWidth, y + rectHeight, x, y + rectHeight, thickness);
  drawMaskLine(mask, width, x, y + rectHeight, x, y, thickness);
}

function drawMaskRoundedRect(mask: Uint8Array, width: number, x: number, y: number, rectWidth: number, rectHeight: number, radius: number, thickness: number): void {
  drawMaskLine(mask, width, x + radius, y, x + rectWidth - radius, y, thickness);
  drawMaskLine(mask, width, x + radius, y + rectHeight, x + rectWidth - radius, y + rectHeight, thickness);
  drawMaskLine(mask, width, x, y + radius, x, y + rectHeight - radius, thickness);
  drawMaskLine(mask, width, x + rectWidth, y + radius, x + rectWidth, y + rectHeight - radius, thickness);
  drawMaskArc(mask, width, x + radius, y + radius, radius, 180, 270, thickness);
  drawMaskArc(mask, width, x + rectWidth - radius, y + radius, radius, 270, 360, thickness);
  drawMaskArc(mask, width, x + rectWidth - radius, y + rectHeight - radius, radius, 0, 90, thickness);
  drawMaskArc(mask, width, x + radius, y + rectHeight - radius, radius, 90, 180, thickness);
}

function drawMaskDot(mask: Uint8Array, width: number, centerX: number, centerY: number, radius: number): void {
  for (let y = Math.max(0, centerY - radius); y <= Math.min(width - 1, centerY + radius); y += 1) {
    for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x += 1) {
      if (Math.hypot(x - centerX, y - centerY) <= radius) {
        mask[y * width + x] = 1;
      }
    }
  }
}

function binaryShapeSimilarity(observed: Array<{ x: number; y: number }>, template: Array<{ x: number; y: number }>): number {
  if (!observed.length || !template.length) {
    return 0;
  }
  const directed = (from: Array<{ x: number; y: number }>, to: Array<{ x: number; y: number }>): number => {
    let total = 0;
    for (const point of from) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of to) {
        const distanceSquared = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
        nearest = Math.min(nearest, distanceSquared);
      }
      total += Math.max(0, 1 - Math.sqrt(nearest) / 5);
    }
    return total / from.length;
  };
  return directed(observed, template) * 0.5 + directed(template, observed) * 0.5;
}

function topBarIconComponentScore(
  component: TopBarIconVisualComponent,
  candidate: VisualImageRegionCandidate,
  sample: ImageSample,
  options: { broadTrailingSearch?: boolean; roleScore?: number } = {}
): number {
  const candidateCenter = {
    x: ((candidate.region.x + candidate.region.width / 2) / 100) * sample.width,
    y: ((candidate.region.y + candidate.region.height / 2) / 100) * sample.height
  };
  const distance = Math.hypot(component.center.x - candidateCenter.x, component.center.y - candidateCenter.y);
  const distanceLimit = Math.max(1, Math.min(sample.width, sample.height) * 0.08);
  const distanceScore = Math.max(0, 1 - distance / distanceLimit);
  const aspectRatio = component.bounds.width / Math.max(1, component.bounds.height);
  const aspectScore = Math.max(0, 1 - Math.abs(1 - aspectRatio));
  const iconSize = Math.max(component.bounds.width, component.bounds.height);
  const targetSize = Math.max(24, Math.min(sample.width, sample.height) * 0.026);
  const sizeScore = Math.max(0, 1 - Math.abs(iconSize - targetSize) / targetSize);
  const density = component.darkPixelCount / Math.max(1, component.bounds.width * component.bounds.height);
  const densityScore = density >= 0.06 && density <= 0.65 ? 1 : 0.35;
  if (options.roleScore !== undefined) {
    const geometryScore = options.broadTrailingSearch
      ? distanceScore * 0.15 + aspectScore * 0.25 + sizeScore * 0.25 + densityScore * 0.35
      : distanceScore * 0.42 + aspectScore * 0.18 + sizeScore * 0.22 + densityScore * 0.18;
    return options.roleScore * 0.72 + geometryScore * 0.28;
  }
  if (options.broadTrailingSearch) {
    return distanceScore * 0.2 + aspectScore * 0.22 + sizeScore * 0.22 + densityScore * 0.36;
  }
  return distanceScore * 0.58 + aspectScore * 0.14 + sizeScore * 0.16 + densityScore * 0.12;
}

function topBarAvatarComponentScore(
  component: TopBarIconVisualComponent,
  candidate: VisualImageRegionCandidate,
  sample: ImageSample,
  anchorXPercent: number | undefined
): number {
  const candidateCenter = {
    x: ((candidate.region.x + candidate.region.width / 2) / 100) * sample.width,
    y: ((candidate.region.y + candidate.region.height / 2) / 100) * sample.height
  };
  const distance = Math.hypot(component.center.x - candidateCenter.x, component.center.y - candidateCenter.y);
  const distanceLimit = Math.max(1, Math.min(sample.width, sample.height) * 0.14);
  const distanceScore = Math.max(0, 1 - distance / distanceLimit);
  const aspectRatio = component.bounds.width / Math.max(1, component.bounds.height);
  const aspectScore = Math.max(0, 1 - Math.abs(1 - aspectRatio) / 0.45);
  const sizePercent = (Math.max(component.bounds.width, component.bounds.height) / Math.min(sample.width, sample.height)) * 100;
  const sizeScore = Math.max(0, 1 - Math.abs(sizePercent - 8) / 7);
  const density = component.darkPixelCount / Math.max(1, component.bounds.width * component.bounds.height);
  const densityScore = density >= 0.28 && density <= 0.95 ? 1 : 0.4;
  const componentCenterPercent = (component.center.x / sample.width) * 100;
  const leadingScore = anchorXPercent === undefined || componentCenterPercent < anchorXPercent ? 1 : 0;
  return distanceScore * 0.15 + aspectScore * 0.3 + sizeScore * 0.25 + densityScore * 0.25 + leadingScore * 0.05;
}

function percentRegionToSampleRect(region: { x: number; y: number; width: number; height: number }, sample: ImageSample): { x: number; y: number; width: number; height: number } | undefined {
  if (!sample.width || !sample.height || region.width <= 0 || region.height <= 0) {
    return undefined;
  }
  return {
    x: (region.x / 100) * sample.width,
    y: (region.y / 100) * sample.height,
    width: (region.width / 100) * sample.width,
    height: (region.height / 100) * sample.height
  };
}

function sampleRectToPercent(region: { x: number; y: number; width: number; height: number }, sample: ImageSample): { x: number; y: number; width: number; height: number } {
  return {
    x: roundPercent((region.x / sample.width) * 100),
    y: roundPercent((region.y / sample.height) * 100),
    width: roundPercent((region.width / sample.width) * 100),
    height: roundPercent((region.height / sample.height) * 100)
  };
}

function clampPercentRegion(region: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(100, region.x));
  const y = Math.max(0, Math.min(100, region.y));
  return {
    x: roundPercent(x),
    y: roundPercent(y),
    width: roundPercent(Math.max(0, Math.min(region.width, 100 - x))),
    height: roundPercent(Math.max(0, Math.min(region.height, 100 - y)))
  };
}

function resolveVisualImageRegionCandidate(
  value: unknown,
  options: {
    semanticArea: VisualSemanticArea;
    deviceSize?: { width: number; height: number };
  }
): {
  selected?: {
    candidate: VisualImageRegionCandidate;
    point: { x: number; y: number };
  };
  diagnostic?: Record<string, unknown>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const minScore = Math.max(0, Math.min(1, numberParam(input.minScore) ?? 0.72));
  const targetRole = textParam(input.targetRole).trim().toLowerCase();
  const candidates = readVisualImageRegionCandidates(input.candidates);
  if (!candidates.length) {
    return {
      diagnostic: {
        reason: "no_candidates",
        minScore,
        candidateCount: 0
      }
    };
  }
  const scoped = candidates.filter((candidate) => options.semanticArea === "unknown" || candidate.semanticArea === "unknown" || candidate.semanticArea === options.semanticArea);
  const pool = scoped.length ? scoped : candidates;
  const ranked = pool
    .map((candidate) => ({
      candidate,
      effectiveScore: visualCandidateEffectiveScore(candidate, {
        targetRole,
        semanticArea: options.semanticArea
      })
    }))
    .sort((left, right) => right.effectiveScore - left.effectiveScore);
  const best = ranked[0];
  if (!best) {
    return {
      diagnostic: {
        reason: "no_candidates",
        minScore,
        candidateCount: candidates.length
      }
    };
  }
  const point = regionPoint(best.candidate.region, options.deviceSize);
  const diagnostic = {
    reason: best.candidate.score >= minScore && point ? "candidate_selected" : best.candidate.score < minScore ? "candidate_below_threshold" : "missing_device_size",
    minScore,
    candidateCount: candidates.length,
    scopedCandidateCount: scoped.length,
    bestScore: best.candidate.score,
    bestEffectiveScore: roundPercent(best.effectiveScore),
    targetRole: targetRole || undefined
  };
  if (best.candidate.score < minScore || !point) {
    return { diagnostic };
  }
  return {
    selected: {
      candidate: best.candidate,
      point
    },
    diagnostic
  };
}

function readVisualImageRegionCandidates(value: unknown): VisualImageRegionCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item): VisualImageRegionCandidate | undefined => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return undefined;
      }
      const input = item as Record<string, unknown>;
      const region = readPercentRegion(input.region);
      const score = numberParam(input.score);
      if (!region || score === undefined) {
        return undefined;
      }
      return {
        source: textParam(input.source).trim() || undefined,
        label: textParam(input.label).trim() || textParam(input.text).trim() || textParam(input.role).trim() || "visual_candidate",
        role: textParam(input.role).trim() || undefined,
        score: Math.max(0, Math.min(1, score)),
        region,
        semanticArea: readSemanticArea(input.semanticArea) ?? semanticAreaForPercentRegion(region)
      };
    })
    .filter((candidate): candidate is VisualImageRegionCandidate => Boolean(candidate));
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function visualCandidateEffectiveScore(
  candidate: VisualImageRegionCandidate,
  options: {
    targetRole: string;
    semanticArea: VisualSemanticArea;
  }
): number {
  const roleBonus = options.targetRole && candidate.role?.toLowerCase() === options.targetRole ? 0.16 : 0;
  const areaBonus = options.semanticArea !== "unknown" && candidate.semanticArea === options.semanticArea ? 0.08 : 0;
  return candidate.score + roleBonus + areaBonus;
}

function isOcrAnchorOffsetLocator(params: Record<string, unknown>): boolean {
  return textParam(params.locatorKind).trim() === "ocr_anchor_offset" || textParam(params.locator).trim().startsWith("ocr-anchor:");
}

function readSignedPercentPoint(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { x: 0, y: 0 };
  }
  const input = value as Record<string, unknown>;
  return {
    x: signedPercentNumber(input.x) ?? 0,
    y: signedPercentNumber(input.y) ?? 0
  };
}

function signedPercentNumber(value: unknown): number | undefined {
  const numberValue = numberParam(value);
  if (numberValue === undefined) {
    return undefined;
  }
  return Math.max(-100, Math.min(100, numberValue));
}

function clampDevicePoint(point: { x: number; y: number }, deviceSize: { width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(deviceSize.width, Math.round(point.x))),
    y: Math.max(0, Math.min(deviceSize.height, Math.round(point.y)))
  };
}

function readTapPointPercent(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const x = percentNumber(input.x);
  const y = percentNumber(input.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

function percentNumber(value: unknown): number | undefined {
  const numberValue = numberParam(value);
  if (numberValue === undefined) {
    return undefined;
  }
  return Math.max(0, Math.min(100, numberValue));
}

function nonNegativeNumberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function optionalNonNegativeNumberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeActionResult(result: DeviceActionResult | void): DeviceActionResult | undefined {
  return result ?? undefined;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function runnerStoppedError(): Error {
  const error = new Error("Run stopped by user");
  error.name = "RunnerStoppedError";
  return error;
}

function throwIfResolutionStopped(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw runnerStoppedError();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
