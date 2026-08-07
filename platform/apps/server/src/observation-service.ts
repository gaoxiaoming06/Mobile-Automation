import { createId } from "@mobile-automation/shared";
import type { Observation, ObservationText, ObservationUiElement } from "@mobile-automation/graph-core";
import type { AutomationDeviceDriver, ObservedDeviceEvent } from "./device-driver.js";
import type { OcrService } from "./ocr.js";
import { hierarchySize, parseAndroidUiHierarchy, type UiElementCandidate } from "./ui-hierarchy-locator.js";

export type ObservationOptions = {
  includeScreenshot?: boolean;
  includeUiTree?: boolean;
  includeOcr?: boolean;
  lang?: string;
  recentEvents?: ObservedDeviceEvent[];
  screenshotOverride?: Buffer;
};

type ForegroundAppSnapshot = {
  packageName?: string;
  bundleId?: string;
  activityName?: string;
  abilityName?: string;
  componentName?: string;
};

export class ObservationService {
  constructor(
    private readonly driver: AutomationDeviceDriver,
    private readonly ocr: OcrService
  ) {}

  async collect(serial: string, options: ObservationOptions = {}): Promise<Observation> {
    const includeScreenshot = options.includeScreenshot ?? true;
    const includeUiTree = options.includeUiTree ?? true;
    const includeOcr = options.includeOcr ?? true;
    const capturedAt = new Date().toISOString();
    const device = await this.driver.getDeviceInfo(serial);
    const foregroundPromise: Promise<ForegroundAppSnapshot> = this.driver.getForegroundApp
      ? this.driver.getForegroundApp(serial).catch(() => ({}))
      : Promise.resolve({});
    const screenshotPromise = includeScreenshot
      ? Promise.resolve(options.screenshotOverride ?? this.driver.screenshot(serial))
      : Promise.resolve(undefined);
    const uiTreePromise = includeUiTree && this.driver.dumpUiHierarchy
      ? this.collectUiTree(serial)
      : Promise.resolve(emptyUiTree());
    const screenshot = await screenshotPromise;
    const ocrPromise = includeOcr && screenshot
      ? this.collectOcrTexts(screenshot, options.lang)
      : Promise.resolve([]);
    const [foreground, uiTree, ocrTexts] = await Promise.all([foregroundPromise, uiTreePromise, ocrPromise]);
    const { rawUiHierarchy, uiElements, uiTreeSize, uiHierarchyError } = uiTree;
    const screenshotSize = screenshot ? pngDimensions(screenshot) : undefined;
    const derivedSize = screenshotSize ?? device.resolution ?? uiTreeSize;

    return {
      id: createId("observation"),
      deviceSerial: serial,
      platform: device.platform,
      capturedAt,
      packageName: foreground.packageName,
      bundleId: foreground.bundleId,
      activityName: foreground.activityName ?? foreground.abilityName,
      componentName: foreground.componentName,
      resolution: derivedSize,
      orientation: device.orientation,
      screenshot: screenshot
        ? {
            sizeBytes: screenshot.byteLength,
            width: screenshotSize?.width ?? derivedSize?.width,
            height: screenshotSize?.height ?? derivedSize?.height
          }
        : undefined,
      uiElements,
      ocrTexts,
      events: options.recentEvents?.map((event) => ({
        type: event.type,
        severity: event.severity,
        summary: event.summary,
        occurredAt: event.occurredAt
      })),
      raw: {
        device_ready: true,
        foreground_package: foreground.packageName,
        foreground_bundle_id: foreground.bundleId,
        foreground_ability: foreground.abilityName,
        foreground_package_not: foreground.packageName === "cn.eeo.classin" ? "" : "cn.eeo.classin",
        device,
        uiHierarchyXml: rawUiHierarchy,
        uiHierarchyError,
        screenshotBase64: screenshot?.toString("base64")
      }
    };
  }

  private async collectUiTree(serial: string): Promise<{ rawUiHierarchy?: string; uiElements: ObservationUiElement[]; uiTreeSize?: { width: number; height: number }; uiHierarchyError?: string }> {
    if (!this.driver.dumpUiHierarchy) {
      return emptyUiTree();
    }
    const rawUiHierarchy = await this.driver.dumpUiHierarchy(serial).catch((error: unknown) => undefined);
    if (!rawUiHierarchy) {
      return {
        ...emptyUiTree(),
        uiHierarchyError: "uiautomator dump failed"
      };
    }
    const candidates = parseAndroidUiHierarchy(rawUiHierarchy);
    return {
      rawUiHierarchy,
      uiElements: candidates.map(toObservationUiElement),
      uiTreeSize: hierarchySize(candidates)
    };
  }

  private async collectOcrTexts(screenshot: Buffer, lang: string | undefined): Promise<ObservationText[]> {
    if (this.ocr.locateText) {
      const layout = await this.ocr.locateText({ image: screenshot, lang });
      return layout.boxes
        .filter((box) => box.text.trim())
        .map((box) => ({
          text: box.text,
          confidence: box.confidence,
          source: "ocr" as const,
          region: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          }
        }));
    }
    const result = await this.ocr.recognize({ image: screenshot, lang });
    return result.text.trim()
      ? [
          {
            text: result.text,
            source: "ocr"
          }
        ]
      : [];
  }
}

function emptyUiTree(): { rawUiHierarchy?: string; uiElements: ObservationUiElement[]; uiTreeSize?: { width: number; height: number }; uiHierarchyError?: string } {
  return {
    uiElements: []
  };
}

function pngDimensions(buffer: Buffer): { width: number; height: number } | undefined {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24 || !pngSignature.every((byte, index) => buffer[index] === byte)) {
    return undefined;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) {
    return undefined;
  }
  return { width, height };
}

function toObservationUiElement(candidate: UiElementCandidate): ObservationUiElement {
  return {
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
    focusable: candidate.focusable,
    scrollable: candidate.scrollable
  };
}
