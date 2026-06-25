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
  locatorFromCandidate,
  sanitizeLocator,
  type UiElementCandidate,
  type UiElementLocator
} from "./ui-hierarchy-locator.js";

type VisualSemanticArea = "top" | "content" | "bottom" | "unknown";

type GridScrollProfile = {
  containerKind?: string;
  direction: "vertical" | "horizontal";
  columns: number;
  targetKind?: string;
  targetQuery?: string;
  candidateItemHeightPercent?: number;
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
    const region = readPercentRegion(input.step.params.region);
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
    const candidatePointPercent = candidateTapPointPercent(input.step.params, tapPointPercent);
    const center = regionPoint(region, input.deviceSize, candidatePointPercent ?? tapPointPercent);
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
    const action = { type: "tap", x: center.x, y: center.y } satisfies DeviceActionRequest;
    const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
    return {
      supported: true,
      resolved: true,
      action,
      actionResult,
      message: `Tapped manually marked image region at (${center.x}, ${center.y}).`,
      artifacts: [],
      metadata: {
        type: "image_region",
        action: "tap",
        ...pageTaskSemanticMetadata(input.step.params),
        region,
        semanticArea,
        ...(tapPointPercent ? { tapPointPercent } : {}),
        ...(typeof numberParam(input.step.params.candidateIndex) === "number" ? { candidateIndex: numberParam(input.step.params.candidateIndex) } : {}),
        ...(candidatePointPercent ? { candidatePointPercent } : {}),
        center,
        driverChannel: actionResult?.driverChannel
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
    const maxSwipes = Math.max(0, Math.floor(nonNegativeNumberParam(input.step.params.maxSearchSwipes, nonNegativeNumberParam(input.step.params.maxSwipes, 3))));
    const intervalMs = positiveNumberParam(input.step.params.searchIntervalMs, positiveNumberParam(input.step.params.intervalMs, 250));
    const mode = tapTextMatchMode(input.step.params.mode);
    const tryFindAndTap = async (
      attempt: number,
      relocatedBy: "ocr_text_in_grid" | "ocr_text_in_grid_after_scroll",
      search?: Record<string, unknown>
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
      const target = findTextCandidate(layout, targetQuery, {
        mode,
        deviceSize: input.deviceSize
      });
      if (!target || !candidateInsidePercentRegion(target, region, layout, input.deviceSize)) {
        return undefined;
      }
      const grid = candidateGridCell(target, region, layout, scrollProfile, input.deviceSize);
      const pointPercent = gridCandidateSafePointPercent(grid, scrollProfile);
      const center = regionPoint(region, input.deviceSize, pointPercent);
      if (!center) {
        return undefined;
      }
      const action = { type: "tap", x: center.x, y: center.y } satisfies DeviceActionRequest;
      const actionResult = normalizeActionResult(await this.deps.performAction(input.serial, action));
      return {
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
          center,
          ...(search ? { search } : {}),
          driverChannel: actionResult?.driverChannel
        }
      };
    };

    const directOutcome = await tryFindAndTap(1, "ocr_text_in_grid");
    if (directOutcome) {
      return directOutcome;
    }
    for (let swipes = 1; swipes <= maxSwipes; swipes += 1) {
      await this.deps.performAction(input.serial, gridSearchSwipeAction(region, scrollProfile, input.deviceSize));
      await sleep(intervalMs);
      const scrolledOutcome = await tryFindAndTap(swipes + 1, "ocr_text_in_grid_after_scroll", {
        direction: scrollProfile.direction,
        swipes,
        attempts: swipes + 1
      });
      if (scrolledOutcome) {
        return scrolledOutcome;
      }
    }
    return undefined;
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
    if (!text) {
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
    if (region) {
      const focusAction = regionPoint(region, input.deviceSize);
      if (!focusAction) {
        return {
          supported: true,
          resolved: false,
          message: "input_text_to_element requires device size to focus the manually marked image region.",
          artifacts: [],
          metadata: {
            type: "element_input",
            action: "fail",
            resolvedBy: "image_region",
            reason: "missing_device_size",
            region
          }
        };
      }
      let actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "tap", x: focusAction.x, y: focusAction.y }));
      const focusDelayMs = nonNegativeNumberParam(input.step.params.focusDelayMs, 120);
      if (focusDelayMs > 0) {
        await sleep(focusDelayMs);
      }
      if (input.step.params.clearFirst !== false) {
        actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "clear_text" })) ?? actionResult;
      }
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "input_text", text })) ?? actionResult;
      const verification = await this.verifyInputText(input, text, {
        attempt: 1,
        semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
        percentRegion: region
      });
      if (!verification.verified) {
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
            center: focusAction,
            semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
            ...pageTaskSemanticMetadata(input.step.params),
            clearFirst: input.step.params.clearFirst !== false,
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
          center: focusAction,
          semanticArea: readSemanticArea(input.step.params.semanticArea) ?? semanticAreaForPercentRegion(region),
          ...pageTaskSemanticMetadata(input.step.params),
          clearFirst: input.step.params.clearFirst !== false,
          inputVerified: verification.verified,
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
      actionResult = normalizeActionResult(await this.deps.performAction(input.serial, { type: "input_text", text })) ?? actionResult;
    }
    const verification = await this.verifyInputText(input, text, {
      attempt: located.attempts + 1
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
        ...(verification.candidate ? { verifiedBy: verification.candidate.text, verificationLocator: verification.candidate } : {}),
        evidenceArtifactIds: verification.artifacts.map((artifact) => artifact.id),
        driverChannel: actionResult?.driverChannel
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
    }
  ): Promise<{
    verified: boolean;
    artifacts: ArtifactRef[];
    candidate?: TextLocatorCandidate;
    actual: string;
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
    return {
      verified: Boolean(candidate),
      artifacts: [screenshot.artifact],
      candidate,
      actual: normalizeOcrText(layout.text) || "(empty OCR result)"
    };
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

function textParam(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  return sanitizeLocator({
    strategy: locator.strategy === "android_uiautomator" ? "android_uiautomator" : undefined,
    resourceId: textParam(locator.resourceId),
    text: textParam(locator.text),
    textMatchMode: locator.textMatchMode === "contains" || locator.textMatchMode === "equals" ? locator.textMatchMode : undefined,
    excludeTexts: arrayTextParam(locator.excludeTexts),
    occurrence: numberParam(locator.occurrence),
    tapTarget: locator.tapTarget === "self" || locator.tapTarget === "clickable_ancestor" ? locator.tapTarget : undefined,
    contentDesc: textParam(locator.contentDesc),
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

function readScrollProfile(value: unknown): GridScrollProfile {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    containerKind: textParam(input.containerKind),
    direction: input.direction === "horizontal" ? "horizontal" : "vertical",
    columns: Math.max(1, Math.floor(numberParam(input.columns) ?? 1)),
    targetKind: textParam(input.targetKind),
    targetQuery: textParam(input.targetQuery),
    candidateItemHeightPercent: percentNumber(input.candidateItemHeightPercent),
    clickSafePoint: readClickSafePoint(input.clickSafePoint),
    scrollStepPercent: percentNumber(input.scrollStepPercent) ?? 65
  };
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

function gridCandidateSafePointPercent(grid: { column: number; row: number }, scrollProfile: GridScrollProfile): { x: number; y: number } {
  const columns = Math.max(1, scrollProfile.columns);
  const itemHeight = scrollProfile.candidateItemHeightPercent ?? 100;
  const columnWidth = 100 / columns;
  return {
    x: roundPercent(grid.column * columnWidth + (columnWidth * scrollProfile.clickSafePoint.xPercent) / 100),
    y: roundPercent(grid.row * itemHeight + (itemHeight * scrollProfile.clickSafePoint.yPercent) / 100)
  };
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

function candidateTapPointPercent(params: Record<string, unknown>, tapPointPercent?: { x: number; y: number }): { x: number; y: number } | undefined {
  if (params.abilityType !== "grid_candidate" || !tapPointPercent) {
    return undefined;
  }
  const candidateIndex = Math.max(0, Math.floor(numberParam(params.candidateIndex) ?? 0));
  if (candidateIndex <= 0) {
    return tapPointPercent;
  }
  const scrollProfile = params.scrollProfile && typeof params.scrollProfile === "object" ? params.scrollProfile as Record<string, unknown> : {};
  const columns = Math.max(1, Math.floor(numberParam(scrollProfile.columns) ?? 1));
  const candidateHeight = percentNumber(scrollProfile.candidateItemHeightPercent) ?? 0;
  if (candidateHeight <= 0) {
    return tapPointPercent;
  }
  const columnWidth = 100 / columns;
  const column = candidateIndex % columns;
  const row = Math.floor(candidateIndex / columns);
  return {
    x: roundPercent(Math.min(100, Math.max(0, tapPointPercent.x + column * columnWidth))),
    y: roundPercent(Math.min(100, Math.max(0, tapPointPercent.y + row * candidateHeight)))
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
