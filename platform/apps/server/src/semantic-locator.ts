import {
  type ActionStep,
  type ArtifactRef,
  type DeviceActionRequest,
  type DeviceActionResult,
  type SemanticDeviceActionRequest
} from "@mobile-automation/shared";
import type { OcrLayoutResult, OcrService, OcrTextBox } from "./ocr.js";
import {
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
};

type SemanticStepResolverDeps = {
  ocr: OcrService;
  performAction: (serial: string, action: DeviceActionRequest) => Promise<DeviceActionResult | void>;
  performSemanticAction?: (serial: string, action: SemanticDeviceActionRequest) => Promise<DeviceActionResult | void>;
  dumpUiHierarchy?: (serial: string) => Promise<string>;
  captureLocatorScreenshot: (runId: string, stepResultId: string, serial: string, stepId: string, attempt: number) => Promise<ScreenshotCapture>;
};

export class SemanticStepResolver {
  constructor(private readonly deps: SemanticStepResolverDeps) {}

  async resolveIfNeeded(input: {
    runId: string;
    stepResultId: string;
    step: ActionStep;
    serial: string;
    deviceSize?: { width: number; height: number };
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
    if (isTopBarIconLocator(input.step.params)) {
      return this.resolveTopBarIconTap(input);
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
    const region = readPercentRegion(input.step.params.region) ?? readGridCandidateSearchHintRegion(input.step.params);
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
        return gridOutcome;
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
            region
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
            region
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
        const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
          await this.deps.performAction(input.serial, scrollSwipeAction(direction, input.deviceSize));
          await sleep(intervalMs);
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
      const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
      const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
    if (anchorText && this.deps.ocr.locateText) {
      const screenshot = await captureLocatorScreenshot();
      const mode = tapTextMatchMode(params.mode);
      const layout = await this.deps.ocr.locateText({
        image: screenshot.png,
        mode
      });
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
    const selected = selectTopBarIconCandidate(candidates, {
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
      anchorXPercent: anchorPoint ? (anchorPoint.x / input.deviceSize.width) * 100 : undefined
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
          fallback: "candidate_center_disabled"
        }
      };
    }

    const point = currentVisual.selected.point;
    const action = { type: "tap", x: point.x, y: point.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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

    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
    await sleep(positiveNumberParam(input.step.params.checkboxVerifyDelayMs, 250));
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
    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, openerAction));
    await sleep(nonNegativeNumberParam(input.step.params.overlayOpenDelayMs, 350));

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
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, optionAction)) ?? actionResult;
    }
    await sleep(nonNegativeNumberParam(input.step.params.optionSelectDelayMs, 200));

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
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, confirmAction)) ?? actionResult;
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
      await this.deps.performAction(input.serial, scrollSwipeAction("up", input.deviceSize));
      revealSwipes += 1;
      if (revealSettings.intervalMs > 0) {
        await sleep(revealSettings.intervalMs);
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
    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
    const findAnchor = (layout: OcrLayoutResult): TextLocatorCandidate | undefined => findTextCandidate(layout, locator.anchorText, {
      mode: "contains",
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
        await this.deps.performAction(input.serial, scrollSwipeAction("up", input.deviceSize));
        restoreSwipes += 1;
        if (locator.revealIntervalMs > 0) {
          await sleep(locator.revealIntervalMs);
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
        await this.deps.performAction(input.serial, scrollSwipeAction("down", input.deviceSize));
        searchSwipes += 1;
        if (locator.revealIntervalMs > 0) {
          await sleep(locator.revealIntervalMs);
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

    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
    await sleep(nonNegativeNumberParam(input.step.params.toggleVerifyDelayMs, 250));
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
    let captureAttempt = 0;
    const locateOpener = async (): Promise<boolean> => {
      captureAttempt += 1;
      const attempt = captureAttempt;
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      const layout = await locateText({ image: screenshot.png, mode: "contains" });
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
        return true;
      }
      return false;
    };
    const currentViewAttempts = Math.max(1, Math.floor(positiveNumberParam(structuralLocator?.locatorReadAttempts, 2)));
    for (let attempt = 0; attempt < currentViewAttempts; attempt += 1) {
      if (await locateOpener()) {
        break;
      }
    }
    while (!opener && revealSettings && revealSwipes < revealSettings.maxSwipes) {
      await this.deps.performAction(input.serial, scrollSwipeAction("up", input.deviceSize));
      revealSwipes += 1;
      if (revealSettings.intervalMs > 0) {
        await sleep(revealSettings.intervalMs);
      }
      await locateOpener();
    }
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
    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: opener.x, y: opener.y }));
    await sleep(positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));

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
      await this.deps.performAction(input.serial, scrollSwipeAction(direction, input.deviceSize));
      swipes += 1;
      await sleep(intervalMs);
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
    actionResult = normalizeActionResult(await this.deps.performAction(input.serial, selectAction)) ?? actionResult;
    await sleep(positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));

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
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, confirmAction)) ?? actionResult;
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
    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: opener.x, y: opener.y }));
    await sleep(positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
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
          await sleep(intervalMs);
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
      actionResult = normalizeActionResult(await this.deps.performAction(
        input.serial,
        pickerColumnSwipeAction(50, direction, input.deviceSize)
      )) ?? actionResult;
      swipes += 1;
      if (intervalMs > 0) {
        await sleep(intervalMs);
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
    actionResult = normalizeActionResult(await this.deps.performAction(input.serial, confirmAction)) ?? actionResult;
    await sleep(positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));
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
    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: opener.x, y: opener.y }));
    await sleep(positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
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
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, shortcutAction)) ?? actionResult;
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
      for (let swipes = 0; swipes <= maxSwipes; swipes += 1) {
        const layout = await captureLayout();
        const candidates = column === "date"
          ? pickerDateCandidates(layout, centerXPercent)
          : pickerPlainNumberCandidates(layout, centerXPercent);
        const selectedCenterY = pickerSelectedCenterY(layout);
        const match = candidates
          .filter((candidate) => candidate.value === target)
          .sort((left, right) => Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY))[0];
        if (match && Math.abs(match.candidate.centerY - selectedCenterY) <= layout.height * 0.12) {
          selectedParts.push(String(target));
          return true;
        }
        if (swipes >= maxSwipes || !candidates.length) {
          return false;
        }
        const current = candidates
          .slice()
          .sort((left, right) => Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY))[0]!;
        const direction = column === "date"
          ? String(target) > String(current.value) ? "increase" : "decrease"
          : Number(target) > Number(current.value) ? "increase" : "decrease";
        actionResult = normalizeActionResult(await this.deps.performAction(
          input.serial,
          pickerColumnSwipeAction(centerXPercent, direction, input.deviceSize)
        )) ?? actionResult;
        totalSwipes += 1;
        if (intervalMs > 0) {
          await sleep(intervalMs);
        }
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
    actionResult = normalizeActionResult(await this.deps.performAction(input.serial, confirmAction)) ?? actionResult;
    await sleep(positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));
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
    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: opener.x, y: opener.y }));
    await sleep(positiveNumberParam(input.step.params.pickerOpenDelayMs, 350));
    const maxSwipes = Math.max(1, Math.floor(positiveNumberParam(input.step.params.pickerMaxSwipes, 16)));
    const intervalMs = nonNegativeNumberParam(input.step.params.pickerScrollIntervalMs, 250);
    let attempt = 0;
    let totalSwipes = 0;
    const selectedParts: string[] = [];

    const selectColumn = async (column: "hours" | "minutes", target: number): Promise<boolean> => {
      const unit = column === "hours" ? "小时" : "分钟";
      const centerXPercent = column === "hours" ? 25 : 75;
      for (let swipes = 0; swipes <= maxSwipes; swipes += 1) {
        attempt += 1;
        const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
        artifacts.push(screenshot.artifact);
        const layout = await this.deps.ocr.locateText!({ image: screenshot.png, mode: "contains" });
        const candidates = pickerColumnNumberCandidates(layout, unit, centerXPercent);
        const selectedCenterY = pickerSelectedCenterY(layout);
        const targetCandidate = candidates
          .filter((candidate) => candidate.value === target)
          .sort((left, right) => Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY))[0];
        if (targetCandidate && Math.abs(targetCandidate.candidate.centerY - selectedCenterY) <= layout.height * 0.12) {
          selectedParts.push(`${target}${unit}`);
          return true;
        }
        if (swipes >= maxSwipes || !candidates.length) {
          return false;
        }
        const current = candidates
          .slice()
          .sort((left, right) => Math.abs(left.candidate.centerY - selectedCenterY) - Math.abs(right.candidate.centerY - selectedCenterY))[0]!;
        const direction = target > current.value ? "increase" : "decrease";
        const action = pickerColumnSwipeAction(centerXPercent, direction, input.deviceSize);
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action)) ?? actionResult;
        totalSwipes += 1;
        if (intervalMs > 0) {
          await sleep(intervalMs);
        }
      }
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
          reason: "picker_value_not_found",
          pickerMode: "duration_hours_minutes",
          selectedValue,
          selectedParts,
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
    actionResult = normalizeActionResult(await this.deps.performAction(input.serial, confirmAction)) ?? actionResult;
    await sleep(positiveNumberParam(input.step.params.pickerConfirmDelayMs, 200));

    return {
      supported: true,
      resolved: true,
      action: confirmAction,
      actionResult,
      message: `Selected duration picker value "${selectedValue}".`,
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
      const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
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
        await this.deps.performAction(input.serial, reverseGridSearchSwipeAction(region, scrollProfile, input.deviceSize));
        await sleep(intervalMs);
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
        await this.deps.performAction(input.serial, gridSearchSwipeAction(region, scrollProfile, input.deviceSize));
        await sleep(intervalMs);
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
      await this.deps.performAction(input.serial, gridSearchSwipeAction(region, scrollProfile, input.deviceSize));
      await sleep(intervalMs);
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
    const expected = expectedTargets[0] ?? "";
    const mode = tapTextMatchMode(input.step.params.mode);
    const timeoutMs = positiveNumberParam(input.step.params.timeoutMs, 3000);
    const intervalMs = positiveNumberParam(input.step.params.intervalMs, 500);
    const started = Date.now();
    let attempt = 0;
    let latestLayout: OcrLayoutResult | undefined;
    let latestCandidate: TextLocatorCandidate | undefined;
    const artifacts: ArtifactRef[] = [];

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

    if (!this.deps.ocr.locateText) {
      return {
        supported: false,
        resolved: false,
        message: "OCR layout locator is unavailable.",
        artifacts,
        metadata: {
          type: "text",
          expected: expectedTargets,
          action: "unsupported",
          reason: "ocr_layout_unavailable"
        }
      };
    }

    while (Date.now() - started <= timeoutMs) {
      attempt += 1;
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, attempt);
      artifacts.push(screenshot.artifact);
      latestLayout = await this.deps.ocr.locateText({
        image: screenshot.png,
        lang: textParam(input.step.params.lang) || undefined,
        mode
      });
      latestCandidate = findTextCandidateFromTargets(latestLayout, expectedTargets, {
        mode,
        preferredPoint: recordedPoint(input.step, input.deviceSize)
      });
      if (latestCandidate) {
        const action = {
          type: "tap",
          x: scaleCoordinate(latestCandidate.centerX, latestLayout.width, input.deviceSize?.width),
          y: scaleCoordinate(latestCandidate.centerY, latestLayout.height, input.deviceSize?.height)
        } satisfies DeviceActionRequest;
        const actionResult = (await this.deps.performAction(input.serial, action)) ?? undefined;
        return {
          supported: true,
          resolved: true,
          action,
          actionResult,
          message: `Resolved text "${latestCandidate.text}" for "${expectedTargets.join(" / ")}" after ${attempt} OCR attempt(s).`,
          artifacts,
          metadata: {
            type: "text",
            expected: expectedTargets,
            actual: latestCandidate.text,
            action: "tap",
            attempts: attempt,
            locator: latestCandidate,
            evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
          }
        };
      }

      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        break;
      }
      await sleep(Math.min(intervalMs, timeoutMs - elapsed));
    }

    return {
      supported: true,
      resolved: false,
      message: `Text target "${expectedTargets.join(" / ")}" was not found.`,
      artifacts,
      metadata: {
        type: "text",
        expected: expectedTargets,
        actual: normalizeOcrText(latestLayout?.text ?? "") || "(empty OCR result)",
        action: "fail",
        attempts: attempt,
        candidateCount: latestLayout?.boxes.length ?? 0,
        nearestCandidate: latestCandidate,
        evidenceArtifactIds: artifacts.map((artifact) => artifact.id)
      }
    };
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
            ? normalizeActionResult(await this.deps.performSemanticAction(input.serial, semanticAction))
            : normalizeActionResult(await this.deps.performAction(input.serial, {
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
      await sleep(Math.min(intervalMs, timeoutMs - elapsed));
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
      let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: focus.point.x, y: focus.point.y }));
      const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
      if (focusDelayMs > 0) {
        await sleep(focusDelayMs);
      }
      if (input.step.params.clearFirst !== false) {
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "clear_text" })) ?? actionResult;
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
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "input_text", text })) ?? actionResult;
      const verification = await this.verifyInputText(input, text, {
        attempt: 1,
        semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
        percentRegion: inputVerificationRegion(region, focus, input.deviceSize),
        percentRegionSource: inputVerificationRegionSource(focus)
      });
      if (!verification.verified) {
        const keyEventRetry = await this.retrySensitiveInputWithKeyEvents(input, text, {
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
      actionResult = normalizeActionResult(await this.deps.performSemanticAction(input.serial, semanticAction));
    } else {
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, focusAction));
      const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
      if (focusDelayMs > 0) {
        await sleep(focusDelayMs);
      }
      if (input.step.params.clearFirst !== false) {
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "clear_text" })) ?? actionResult;
      }
      if (!clearOnly) {
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "input_text", text })) ?? actionResult;
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
      percentRegionSource: input.deviceSize ? "runtime_ui_candidate" : undefined
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
    if (!focus.point && revealSettings) {
      for (let swipes = 1; swipes <= revealSettings.maxSwipes; swipes += 1) {
        await this.deps.performAction(input.serial, scrollSwipeAction("up", input.deviceSize));
        if (revealSettings.intervalMs > 0) {
          await sleep(revealSettings.intervalMs);
        }
        focus = await this.resolveInputRegionFocusPoint(input, searchRegion);
        if (focus.point) {
          reveal = { strategy: "scroll_to_top", swipes };
          break;
        }
      }
    }
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
          ...(revealSettings ? { revealAttempted: { strategy: "scroll_to_top", swipes: revealSettings.maxSwipes } } : {}),
          ...pageTaskSemanticMetadata(input.step.params)
        }
      };
    }

    let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: focus.point.x, y: focus.point.y }));
    const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
    if (focusDelayMs > 0) {
      await sleep(focusDelayMs);
    }
    if (input.step.params.clearFirst !== false) {
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "clear_text" })) ?? actionResult;
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
          driverChannel: actionResult?.driverChannel
        }
      };
    }
    actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "input_text", text })) ?? actionResult;

    const verification = await this.verifyInputText(input, text, {
      attempt: 1,
      semanticArea,
      percentRegion: inputVerificationRegion(searchRegion, focus, input.deviceSize),
      percentRegionSource: inputVerificationRegionSource(focus)
    });
    if (!verification.verified) {
      const keyEventRetry = await this.retrySensitiveInputWithKeyEvents(input, text, {
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
          ...pageTaskSemanticMetadata(input.step.params),
          clearFirst: input.step.params.clearFirst !== false,
          sensitiveInput: isSensitiveInput(input.step.params),
          ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
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
        ...pageTaskSemanticMetadata(input.step.params),
        clearFirst: input.step.params.clearFirst !== false,
        inputVerified: verification.verified,
        sensitiveInput: isSensitiveInput(input.step.params),
        ...(verification.strategy ? { verificationStrategy: verification.strategy } : {}),
        ...(verification.percentRegionSource ? { verificationRegionSource: verification.percentRegionSource } : {}),
        ...(verification.candidate ? { verifiedBy: verification.candidate.text, verificationLocator: verification.candidate } : {}),
        evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
        driverChannel: actionResult?.driverChannel
      }
    };
  }

  private async retrySensitiveInputWithKeyEvents(
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
      !isSensitiveInput(input.step.params) ||
      input.step.params.secureKeyboardKeyEventRetry === false ||
      options.previousVerification.strategy !== "target_region_still_placeholder" ||
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
      retryActionResult = normalizeActionResult(await this.deps.performAction(input.serial, retryAction)) ?? options.previousActionResult;
    } catch {
      return undefined;
    }
      const retryVerification = await this.verifyInputText(input, text, {
        attempt: 2,
        semanticArea: options.semanticArea,
        percentRegion: inputVerificationRegion(options.region, options.focus, input.deviceSize),
        percentRegionSource: inputVerificationRegionSource(options.focus)
      });
    if (!retryVerification.verified) {
      return undefined;
    }
    return {
      supported: true,
      resolved: true,
      action: retryAction,
      actionResult: retryActionResult,
      message: "Focused sensitive input region and used Android keyevents after secure keyboard blocked text injection.",
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
        sensitiveInput: true,
        inputFallback: "secure_keyboard_keyevent_retry",
        initialVerificationStrategy: options.previousVerification.strategy,
        ...(retryVerification.strategy ? { verificationStrategy: retryVerification.strategy } : {}),
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
    }
  ): Promise<{
    verified: boolean;
    artifacts: ArtifactRef[];
    candidate?: TextLocatorCandidate;
    actual: string;
    strategy?: string;
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
      await sleep(delayMs);
    }
    const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, options.attempt);
    const mode = tapTextMatchMode(input.step.params.inputVerificationMode ?? "contains");
    const layout = await this.deps.ocr.locateText({
      image: screenshot.png,
      mode
    });
    const candidate = findTextCandidate(layout, text, {
      mode,
      semanticArea: options.semanticArea,
      percentRegion: options.percentRegion,
      deviceSize: input.deviceSize
    });
    const sensitiveResult = candidate ? undefined : verifySensitiveInputText(layout, text, {
      params: input.step.params,
      percentRegion: options.percentRegion,
      deviceSize: input.deviceSize
    });
    return {
      verified: Boolean(candidate) || sensitiveResult?.verified === true,
      artifacts: [screenshot.artifact],
      candidate,
      actual: normalizeOcrText(layout.text) || "(empty OCR result)",
      strategy: candidate ? "clear_text_target_region" : sensitiveResult?.strategy,
      percentRegionSource: options.percentRegionSource
    };
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
    resolvedBy: "ocr_text_semantic" | "ocr_relative_structure" | "ui_edit_text_structural" | "tap_point_percent" | "region_center" | "region_center_disabled";
    candidate?: TextLocatorCandidate;
    uiCandidate?: UiElementCandidate;
    artifacts: ArtifactRef[];
  }> {
    const tapPointPercent = readTapPointPercent(input.step.params.tapPointPercent);
    const fallbackPoint = regionPoint(region, input.deviceSize, tapPointPercent);
    const allowRegionFallback = input.step.params.allowRegionFallback === true;
    if (this.deps.ocr.locateText) {
      const screenshot = await this.deps.captureLocatorScreenshot(input.runId, input.stepResultId, input.serial, input.step.id, 0);
      const layout = await this.deps.ocr.locateText({
        image: screenshot.png,
        mode: "contains"
      });
      const candidate = findInputFocusCandidate(layout, region, input.deviceSize, input.step.params);
      if (candidate) {
        const point = textCandidateDevicePoint(candidate, layout, input.deviceSize);
        return {
          point,
          resolvedBy: isRelativeInputStructure(input.step.params) ? "ocr_relative_structure" : "ocr_text_semantic",
          candidate,
          artifacts: [screenshot.artifact]
        };
      }
      const uiCandidate = await this.resolveInputUiCandidate(input.serial, region, input.deviceSize, input.step.params);
      if (uiCandidate) {
        return {
          point: { x: uiCandidate.bounds.centerX, y: uiCandidate.bounds.centerY },
          resolvedBy: "ui_edit_text_structural",
          uiCandidate,
          artifacts: [screenshot.artifact]
        };
      }
      if (fallbackPoint && allowRegionFallback) {
        return {
          point: fallbackPoint,
          resolvedBy: tapPointPercent ? "tap_point_percent" : "region_center",
          artifacts: [screenshot.artifact]
        };
      }
      return {
        recordedCenter: fallbackPoint,
        resolvedBy: "region_center_disabled",
        artifacts: [screenshot.artifact]
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
        await this.deps.performSemanticAction(input.serial, semanticAction);
      } else {
        await this.deps.performAction(input.serial, swipe);
      }
      swipes += 1;
      await sleep(intervalMs);
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
      await sleep(Math.min(intervalMs, timeoutMs - elapsed));
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
  const expectedText = normalizeOcrText(expected);
  const mode = options.mode ?? "contains";
  const matches = layout.boxes
    .map((box) => toCandidate(box, options.preferredPoint))
    .filter((candidate) => candidate.text && matchTextExpectation(normalizeOcrText(candidate.text), expectedText, mode))
    .filter((candidate) => !options.semanticArea || options.semanticArea === "unknown" || textCandidateSemanticArea(candidate, layout, options.deviceSize) === options.semanticArea)
    .filter((candidate) => !options.percentRegion || candidateInsidePercentRegion(candidate, options.percentRegion, layout, options.deviceSize));
  if (!matches.length) {
    return undefined;
  }
  const rankedMatches =
    mode === "contains" ? matches.filter((candidate) => normalizeOcrText(candidate.text) === expectedText) : matches;
  const candidates = rankedMatches.length ? rankedMatches : matches;
  const maxDistance = options.maxDistance;
  return candidates
    .filter((candidate) => maxDistance === undefined || candidate.distanceToPoint === undefined || candidate.distanceToPoint <= maxDistance)
    .sort((left, right) => candidateScore(right) - candidateScore(left))[0];
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

function parseDurationPickerValue(value: string): { hours: number; minutes: number } | undefined {
  const compact = compactPickerText(value);
  if (/^\d+$/.test(compact)) {
    const totalMinutes = Number(compact);
    return Number.isFinite(totalMinutes) && totalMinutes >= 0
      ? { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
      : undefined;
  }
  const match = compact.match(/^(?:(\d+)小时)?(?:(\d+)分钟)?$/);
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
  const unitCandidates = candidates.filter((candidate) => compactPickerText(candidate.text) === unit);
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
  deviceSize?: { width: number; height: number }
): Extract<DeviceActionRequest, { type: "swipe" }> {
  const width = deviceSize?.width ?? 1080;
  const height = deviceSize?.height ?? 2400;
  const x = Math.round(width * centerXPercent / 100);
  const lowerY = Math.round(height * 0.9);
  const upperY = Math.round(height * 0.72);
  return direction === "increase"
    ? { type: "swipe", startX: x, startY: lowerY, endX: x, endY: upperY, durationMs: 350 }
    : { type: "swipe", startX: x, startY: upperY, endX: x, endY: lowerY, durationMs: 350 };
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
  const unitCandidates = candidates.filter((candidate) => compactPickerText(candidate.text).includes(target.unit));
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

function findRelativeInputFocusCandidate(
  layout: OcrLayoutResult,
  candidates: TextLocatorCandidate[],
  params: Record<string, unknown>
): TextLocatorCandidate | undefined {
  const structuralLocator = readRecord(params.structuralLocator);
  if (textParam(structuralLocator?.strategy).trim() !== "ocr_relative_input") {
    return undefined;
  }
  const relation = textParam(structuralLocator?.relation).trim();
  if (relation !== "nearest_text_above") {
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
  const maxGap = Math.max(80, layout.height * maxGapPercent / 100);
  return candidates
    .filter((candidate) => candidate !== anchor)
    .filter((candidate) => candidate.centerY < anchor.centerY)
    .map((candidate) => ({
      candidate,
      gap: anchor.y - (candidate.y + candidate.height),
      horizontalDistance: Math.abs(candidate.centerX - anchor.centerX)
    }))
    .filter((entry) => entry.gap >= 0 && entry.gap <= maxGap)
    .sort((left, right) =>
      left.gap - right.gap ||
      left.horizontalDistance - right.horizontalDistance ||
      candidateScore(right.candidate) - candidateScore(left.candidate)
    )[0]?.candidate;
}

function isRelativeInputStructure(params: Record<string, unknown>): boolean {
  const structuralLocator = readRecord(params.structuralLocator);
  return textParam(structuralLocator?.strategy).trim() === "ocr_relative_input";
}

function inputFocusTextTargets(params: Record<string, unknown>): string[] {
  const explicit = [
    textParam(params.inputFocusText),
    textParam(params.placeholderText),
    textParam(params.targetText),
    textParam(params.elementLabel),
    textParam(params.pageTaskStepLabel),
    textParam(params.label)
  ].map((value) => value.trim()).filter(Boolean);
  const valueParamKey = textParam(params.valueParamKey).toLowerCase();
  const labelText = explicit.join(" ").toLowerCase();
  const inferred = new Set<string>();
  if (valueParamKey.includes("password") || labelText.includes("密码") || labelText.includes("password")) {
    inferred.add("请输入密码");
    inferred.add("密码");
    inferred.add("password");
  }
  if (
    valueParamKey.includes("phone") ||
    valueParamKey.includes("mobile") ||
    labelText.includes("手机号") ||
    labelText.includes("邮箱") ||
    labelText.includes("phone") ||
    labelText.includes("mobile")
  ) {
    inferred.add("请输入手机号");
    inferred.add("手机号");
    inferred.add("邮箱");
    inferred.add("+86");
  }
  return Array.from(new Set([...explicit, ...inferred].map(normalizeOcrText).filter(Boolean)));
}

function inputFocusCandidateScore(candidate: TextLocatorCandidate, params: Record<string, unknown>): number {
  const text = normalizeOcrText(candidate.text);
  const targets = inputFocusTextTargets(params);
  const targetBonus = targets.some((target) => textMatchesLoosely(text, target)) ? 3 : 0;
  const placeholderBonus = isPromptLikeText(text) ? 1 : 0;
  const leftBias = Math.max(0, 1 - candidate.centerX / 2000) / 10;
  return candidateScore(candidate) + targetBonus + placeholderBonus + leftBias;
}

function verifySensitiveInputText(
  layout: OcrLayoutResult,
  text: string,
  options: {
    params: Record<string, unknown>;
    percentRegion?: { x: number; y: number; width: number; height: number };
    deviceSize?: { width: number; height: number };
  }
): { verified: boolean; strategy: string } | undefined {
  if (!isSensitiveInput(options.params) || !options.percentRegion) {
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
    return {
      verified: true,
      strategy: "sensitive_target_region_unreadable"
    };
  }
  if (targetCandidates.some((candidate) => isLikelySensitivePlaceholder(candidate.text, options.params))) {
    return {
      verified: false,
      strategy: "target_region_still_placeholder"
    };
  }
  return {
    verified: true,
    strategy: targetCandidates.some((candidate) => isMaskedInputText(candidate.text)) ? "masked_target_region" : "changed_target_region"
  };
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

function isLikelySensitivePlaceholder(text: string, params: Record<string, unknown>): boolean {
  const normalized = normalizeOcrText(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (inputFocusTextTargets(params).some((target) => textMatchesLoosely(normalized, target))) {
    return true;
  }
  return isPromptLikeText(normalized) && (normalized.includes("密码") || normalized.includes("password"));
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

function parsePickerNumberUnit(value: string): { number: string; unit: string } | undefined {
  const compact = compactPickerText(value);
  const match = compact.match(/^(\d+(?:\.\d+)?)(分钟|小时|天|月|年)$/);
  if (!match) {
    return undefined;
  }
  return {
    number: match[1] ?? "",
    unit: match[2] ?? ""
  };
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
      { x: 2, y: 1 }
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
    { x: 2, y: 1 }
  );
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
  return className.includes("edittext") || (candidate.focusable && candidate.enabled && (candidate.clickable || candidate.longClickable));
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
  const classBonus = candidate.className?.toLowerCase().includes("edittext") ? 3 : 0;
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
    textParam(structuralLocator?.strategy).trim() === "ocr_or_edittext_in_region";
}

function runtimeInputRevealSettings(
  params: Record<string, unknown>,
  semanticArea: VisualSemanticArea
): { maxSwipes: number; intervalMs: number } | undefined {
  if (semanticArea !== "content") {
    return undefined;
  }
  const structuralLocator = readRecord(params.structuralLocator);
  const strategy = textParam(structuralLocator?.revealStrategy ?? params.revealStrategy).trim();
  if (strategy !== "scroll_to_top") {
    return undefined;
  }
  return {
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

function isTopBarIconLocator(params: Record<string, unknown>): boolean {
  return textParam(params.locatorKind).trim() === "top_bar_icon_locator" || textParam(params.locator).trim().startsWith("top-bar-icon:");
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
    : findDarkVisualComponents(sample, pixelSearchRegion);
  const components = mergeNearbyTopBarIconComponents(rawComponents, sample)
    .map((component) => ({
      ...component,
      score: avatarContainerStrategy
        ? topBarAvatarComponentScore(component, input.candidate, sample, input.anchorXPercent)
        : topBarIconComponentScore(component, input.candidate, sample, {
            broadTrailingSearch: input.slot === "trailing"
          })
    }))
    .filter((component) => component.score >= 0.36);
  const selected = selectCurrentTopBarIconComponent(components, {
    slot: input.slot,
    orderFromRight: input.orderFromRight
  });
  const diagnostic = {
    reason: selected ? "current_visual_icon_selected" : "current_visual_icon_not_found",
    strategy: avatarContainerStrategy ? "avatar_container" : "dark_icon_shape",
    role: input.role || undefined,
    slot: input.slot,
    orderFromRight: input.orderFromRight,
    candidateRegion: input.candidate.region,
    searchRegion,
    componentCount: components.length,
    bestScore: selected ? roundPercent(selected.score) : undefined,
    selectedBounds: selected?.bounds
  };
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

function selectCurrentTopBarIconComponent(
  components: TopBarIconVisualComponent[],
  options: { slot: TopBarIconSlot; orderFromRight: number }
): TopBarIconVisualComponent | undefined {
  if (!components.length) {
    return undefined;
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

function findDarkVisualComponents(sample: ImageSample, rect: { x: number; y: number; width: number; height: number }): TopBarIconVisualComponent[] {
  const startX = Math.max(0, Math.floor(rect.x));
  const startY = Math.max(0, Math.floor(rect.y));
  const endX = Math.min(sample.width, Math.ceil(rect.x + rect.width));
  const endY = Math.min(sample.height, Math.ceil(rect.y + rect.height));
  if (startX >= endX || startY >= endY) {
    return [];
  }
  const visited = new Uint8Array(sample.width * sample.height);
  const components: TopBarIconVisualComponent[] = [];
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = y * sample.width + x;
      if (visited[index] || !isTopBarIconDarkPixel(sample.pixels[index])) {
        continue;
      }
      const component = floodFillDarkComponent(sample, { startX, startY, endX, endY }, x, y, visited);
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
    score: 0
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

function floodFillDarkComponent(
  sample: ImageSample,
  bounds: { startX: number; startY: number; endX: number; endY: number },
  startX: number,
  startY: number,
  visited: Uint8Array
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
    if (visited[index] || !isTopBarIconDarkPixel(sample.pixels[index])) {
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
    score: 0
  };
}

function isTopBarIconDarkPixel(value: number | undefined): boolean {
  return typeof value === "number" && value >= 0 && value <= 110;
}

function topBarIconComponentScore(
  component: TopBarIconVisualComponent,
  candidate: VisualImageRegionCandidate,
  sample: ImageSample,
  options: { broadTrailingSearch?: boolean } = {}
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
