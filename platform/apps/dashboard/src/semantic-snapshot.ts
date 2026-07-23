import type { DeviceActionRequest, SemanticElementLocator } from "@mobile-automation/shared";

export type AndroidUiElementLocator = SemanticElementLocator;

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

export type ElementSnapshotCandidate = {
  locator?: AndroidUiElementLocator;
  selector?: string;
  stable?: boolean;
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  clickable?: boolean;
  longClickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
  depth?: number;
  area?: number;
  score?: number;
  bounds: AndroidUiElementBounds;
};

export type ElementSnapshot = {
  capturedAt: string;
  width: number;
  height: number;
  candidates: ElementSnapshotCandidate[];
  candidateCount?: number;
};

export type TextSnapshotBox = {
  text: string;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextSnapshot = {
  capturedAt: string;
  width: number;
  height: number;
  text?: string;
  boxes: TextSnapshotBox[];
  candidateCount?: number;
};

export type SemanticSnapshots = {
  element?: ElementSnapshot;
  text?: TextSnapshot;
};

export type ElementLookupResponse = {
  stable?: boolean;
  locator?: ElementSnapshotCandidate["locator"];
  candidate?: {
    selector?: string;
    bounds?: AndroidUiElementBounds;
  };
};

export type DeviceSize = {
  width: number;
  height: number;
};

const elementSnapshotTtlMs = 2500;
const textSnapshotTtlMs = 6000;
const defaultTextMaxDistance = 140;

export function createTapAssetActionFromSnapshot(
  point: { x: number; y: number },
  deviceSize: DeviceSize,
  snapshots: SemanticSnapshots,
  now = Date.now()
): RecordableAction {
  const fallback: RecordableAction = { type: "tap", x: point.x, y: point.y };
  const element = findCachedElementAtPoint(point, deviceSize, snapshots.element, now);
  if (element?.locator) {
    return {
      type: "tap_on_element",
      locator: element.locator,
      selector: element.selector,
      bounds: element.bounds,
      x: point.x,
      y: point.y,
      timeoutMs: 3000,
      intervalMs: 500,
      maxDistance: 240
    };
  }

  const text = findCachedTextNearPoint(point, deviceSize, snapshots.text, now);
  if (text) {
    return {
      type: "tap_on_text",
      text: text.text,
      x: point.x,
      y: point.y,
      mode: "contains",
      timeoutMs: 3000,
      intervalMs: 500
    };
  }

  return fallback;
}

export function createTapAssetActionFromElementLookup(point: { x: number; y: number }, lookup: ElementLookupResponse | undefined): RecordableAction | undefined {
  if (!lookup?.stable || !lookup.locator) {
    return undefined;
  }
  return {
    type: "tap_on_element",
    locator: lookup.locator,
    selector: lookup.candidate?.selector,
    bounds: lookup.candidate?.bounds,
    x: point.x,
    y: point.y,
    timeoutMs: 3000,
    intervalMs: 500,
    maxDistance: 240
  };
}

export function findCachedElementAtPoint(
  point: { x: number; y: number },
  deviceSize: DeviceSize,
  snapshot: ElementSnapshot | undefined,
  now = Date.now()
): ElementSnapshotCandidate | undefined {
  if (!snapshot || !isFreshSnapshot(snapshot.capturedAt, elementSnapshotTtlMs, now) || !snapshot.width || !snapshot.height) {
    return undefined;
  }
  const scaledPoint = scalePoint(point, deviceSize, snapshot);
  return snapshot.candidates
    .filter((candidate) => candidate.stable !== false && candidate.locator && containsPoint(candidate.bounds, scaledPoint))
    .sort((left, right) => elementCandidateScore(right, scaledPoint) - elementCandidateScore(left, scaledPoint))[0];
}

export function findCachedTextNearPoint(
  point: { x: number; y: number },
  deviceSize: DeviceSize,
  snapshot: TextSnapshot | undefined,
  now = Date.now(),
  maxDistance = defaultTextMaxDistance
): TextSnapshotBox | undefined {
  if (!snapshot || !isFreshSnapshot(snapshot.capturedAt, textSnapshotTtlMs, now) || !snapshot.width || !snapshot.height) {
    return undefined;
  }
  const scaledPoint = scalePoint(point, deviceSize, snapshot);
  const distanceScale = Math.max(snapshot.width / deviceSize.width || 1, snapshot.height / deviceSize.height || 1);
  const scaledMaxDistance = maxDistance * distanceScale;
  return snapshot.boxes
    .map((box) => ({ box: { ...box, text: normalizeText(box.text) }, distance: distanceToRect(scaledPoint, box) }))
    .filter((entry) => entry.box.text && entry.distance <= scaledMaxDistance)
    .sort((left, right) => textCandidateScore(right.box, right.distance) - textCandidateScore(left.box, left.distance))[0]?.box;
}

function isFreshSnapshot(capturedAt: string, ttlMs: number, now: number): boolean {
  const capturedTime = Date.parse(capturedAt);
  if (!Number.isFinite(capturedTime)) {
    return false;
  }
  return capturedTime <= now + 1000 && now - capturedTime <= ttlMs;
}

function scalePoint(
  point: { x: number; y: number },
  sourceSize: DeviceSize,
  targetSize: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: scaleCoordinate(point.x, sourceSize.width, targetSize.width),
    y: scaleCoordinate(point.y, sourceSize.height, targetSize.height)
  };
}

function scaleCoordinate(value: number, sourceSize: number, targetSize: number): number {
  if (!sourceSize || !targetSize || sourceSize === targetSize) {
    return Math.round(value);
  }
  const ratio = targetSize / sourceSize;
  if (ratio >= 0.9 && ratio <= 1.1 && value >= 0 && value <= targetSize) {
    return Math.round(value);
  }
  return Math.round((value / sourceSize) * targetSize);
}

function containsPoint(bounds: AndroidUiElementBounds, point: { x: number; y: number }): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function elementCandidateScore(candidate: ElementSnapshotCandidate, point: { x: number; y: number }): number {
  const locatorScore = (candidate.locator?.resourceId ? 3 : 0) + (candidate.locator?.contentDesc ? 2 : 0) + (candidate.locator?.text ? 1.6 : 0);
  const interactableScore = candidate.clickable ? 4 : candidate.longClickable ? 3 : candidate.focusable ? 1 : 0;
  const enabledScore = candidate.enabled === false ? -3 : 1;
  const depthScore = Math.min(1.5, (candidate.depth ?? 0) / 10);
  const area = candidate.area ?? candidate.bounds.width * candidate.bounds.height;
  const sizeScore = -Math.min(3, area / 300000);
  const distanceScore = -distanceToRect(point, candidate.bounds) / 1000;
  return locatorScore + interactableScore + enabledScore + depthScore + sizeScore + distanceScore + (candidate.score ?? 0);
}

function textCandidateScore(box: TextSnapshotBox, distance: number): number {
  const confidence = box.confidence ?? 0.5;
  const areaScore = Math.min(1, (box.width * box.height) / 10000) / 10;
  return confidence + areaScore - distance / 1000;
}

function distanceToRect(point: { x: number; y: number }, rect: { x?: number; y?: number; width: number; height: number; left?: number; top?: number; right?: number; bottom?: number }): number {
  const left = rect.left ?? rect.x ?? 0;
  const top = rect.top ?? rect.y ?? 0;
  const right = rect.right ?? left + rect.width;
  const bottom = rect.bottom ?? top + rect.height;
  const dx = Math.max(left - point.x, 0, point.x - right);
  const dy = Math.max(top - point.y, 0, point.y - bottom);
  return Math.hypot(dx, dy);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
