export type UiElementBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type UiElementCandidate = {
  nodeId: number;
  parentNodeId?: number;
  strategy: "android_uiautomator";
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  clickable: boolean;
  longClickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  depth: number;
  bounds: UiElementBounds;
  area: number;
  score: number;
  distanceToPoint?: number;
  selector: string;
};

export type UiElementLocator = {
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

type ParsedNode = Omit<UiElementCandidate, "score" | "distanceToPoint" | "selector">;

export function parseAndroidUiHierarchy(xml: string): UiElementCandidate[] {
  const nodes: UiElementCandidate[] = [];
  const tokenPattern = /<\/node\s*>|<node\b([^>]*?)(\/?)>/g;
  const nodeStack: number[] = [];
  let depth = 0;
  let nextNodeId = 1;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(xml)) !== null) {
    const token = match[0];
    if (token.startsWith("</node")) {
      nodeStack.pop();
      depth = Math.max(0, depth - 1);
      continue;
    }

    const nodeId = nextNodeId;
    nextNodeId += 1;
    const parsed = parseNode(match[1] ?? "", depth, nodeId, nodeStack.at(-1));
    if (parsed) {
      nodes.push({
        ...parsed,
        score: 0,
        selector: buildSelector(parsed)
      });
    }
    if (match[2] !== "/") {
      nodeStack.push(nodeId);
      depth += 1;
    }
  }

  return nodes;
}

export function findElementAtPoint(xml: string, point: { x: number; y: number }): UiElementCandidate | undefined {
  return findElementAtPointFromCandidates(parseAndroidUiHierarchy(xml), point);
}

export function findElementAtPointFromCandidates(candidates: UiElementCandidate[], point: { x: number; y: number }): UiElementCandidate | undefined {
  return rankCandidates(candidates, point)
    .filter((candidate) => containsPoint(candidate.bounds, point))
    .sort((left, right) => right.score - left.score)[0];
}

export function findElementByLocator(
  xml: string,
  locator: UiElementLocator,
  options: {
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
  } = {}
): UiElementCandidate | undefined {
  const sanitized = sanitizeLocator(locator);
  const candidates = rankCandidates(parseAndroidUiHierarchy(xml), options.preferredPoint)
    .filter((candidate) => locatorMatches(candidate, locator))
    .filter((candidate) => {
      if (options.maxDistance === undefined || candidate.distanceToPoint === undefined) {
        return true;
      }
      return candidate.distanceToPoint <= options.maxDistance;
    });
  if (sanitized.text && !sanitized.resourceId && !sanitized.contentDesc) {
    return findElementByTextLocator(rankCandidates(parseAndroidUiHierarchy(xml), options.preferredPoint), sanitized, options);
  }
  if (!candidates.length) {
    return undefined;
  }
  if (sanitized.occurrence) {
    return candidates.sort(compareVisualOrder)[sanitized.occurrence - 1];
  }
  return candidates.sort((left, right) => right.score - left.score)[0];
}

export function hierarchySize(candidates: UiElementCandidate[]): { width: number; height: number } | undefined {
  const right = Math.max(...candidates.map((candidate) => candidate.bounds.right), 0);
  const bottom = Math.max(...candidates.map((candidate) => candidate.bounds.bottom), 0);
  if (!right || !bottom) {
    return undefined;
  }
  return {
    width: right,
    height: bottom
  };
}

export function locatorFromCandidate(candidate: UiElementCandidate, candidates?: UiElementCandidate[]): UiElementLocator {
  const locator: UiElementLocator = {
    strategy: "android_uiautomator",
    packageName: candidate.packageName
  };
  if (candidate.resourceId) {
    return withOccurrence(
      {
      ...locator,
      resourceId: candidate.resourceId
      },
      candidate,
      candidates
    );
  }
  if (candidate.contentDesc) {
    return withOccurrence(
      {
      ...locator,
      contentDesc: candidate.contentDesc
      },
      candidate,
      candidates
    );
  }
  return withOccurrence(
    {
    ...locator,
    text: candidate.text
    },
    candidate,
    candidates
  );
}

export function selectorFromLocator(locator: UiElementLocator): string {
  const sanitized = sanitizeLocator(locator);
  const occurrence = sanitized.occurrence && sanitized.occurrence > 1 ? `#${sanitized.occurrence}` : "";
  if (sanitized.resourceId) {
    return `id=${sanitized.resourceId}${occurrence}`;
  }
  if (sanitized.contentDesc) {
    return `desc=${sanitized.contentDesc}${occurrence}`;
  }
  if (sanitized.text) {
    return `text=${sanitized.text}${occurrence}`;
  }
  return "android_uiautomator";
}

export function sanitizeLocator(locator: UiElementLocator): UiElementLocator {
  const result: UiElementLocator = {
    strategy: locator.strategy ?? "android_uiautomator"
  };
  for (const key of ["resourceId", "text", "contentDesc", "className", "packageName"] as const) {
    const value = locator[key]?.trim();
    if (value) {
      result[key] = value;
    }
  }
  if (locator.textMatchMode === "contains" || locator.textMatchMode === "equals") {
    result.textMatchMode = locator.textMatchMode;
  }
  if (Array.isArray(locator.excludeTexts)) {
    const excludeTexts = locator.excludeTexts.map((item) => item.trim()).filter(Boolean);
    if (excludeTexts.length > 0) {
      result.excludeTexts = excludeTexts;
    }
  }
  if (typeof locator.occurrence === "number" && Number.isFinite(locator.occurrence) && locator.occurrence >= 1) {
    result.occurrence = Math.floor(locator.occurrence);
  }
  if (locator.tapTarget === "self" || locator.tapTarget === "clickable_ancestor") {
    result.tapTarget = locator.tapTarget;
  }
  return result;
}

export function hasStableLocator(locator: UiElementLocator): boolean {
  return Boolean(locator.resourceId || locator.contentDesc || locator.text);
}

export function isRecordableElementCandidate(candidate: UiElementCandidate, viewportSize?: { width: number; height: number }): boolean {
  if (!hasStableLocator(locatorFromCandidate(candidate))) {
    return false;
  }
  const viewportArea = viewportSize ? viewportSize.width * viewportSize.height : 0;
  if (!viewportArea) {
    return true;
  }
  const areaRatio = candidate.area / viewportArea;
  if (areaRatio > 0.6) {
    return false;
  }
  if (areaRatio > 0.35 && !candidate.text && !candidate.contentDesc) {
    return false;
  }
  return true;
}

function parseNode(rawAttributes: string, depth: number, nodeId: number, parentNodeId?: number): ParsedNode | undefined {
  const attrs = parseAttributes(rawAttributes);
  const bounds = parseBounds(attrs.bounds ?? "");
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }

  return {
    nodeId,
    parentNodeId,
    strategy: "android_uiautomator",
    resourceId: blankToUndefined(attrs["resource-id"]),
    text: blankToUndefined(attrs.text),
    contentDesc: blankToUndefined(attrs["content-desc"]),
    className: blankToUndefined(attrs.class),
    packageName: blankToUndefined(attrs.package),
    clickable: attrs.clickable === "true",
    longClickable: attrs["long-clickable"] === "true",
    enabled: attrs.enabled !== "false",
    focusable: attrs.focusable === "true",
    scrollable: attrs.scrollable === "true",
    depth,
    bounds,
    area: bounds.width * bounds.height
  };
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function parseBounds(value: string): UiElementBounds | undefined {
  const match = value.match(/^\[(\d+),(\d+)]\[(\d+),(\d+)]$/);
  if (!match) {
    return undefined;
  }
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    return undefined;
  }
  const width = right - left;
  const height = bottom - top;
  return {
    left,
    top,
    right,
    bottom,
    width,
    height,
    centerX: Math.round(left + width / 2),
    centerY: Math.round(top + height / 2)
  };
}

function rankCandidates(candidates: UiElementCandidate[], point?: { x: number; y: number }): UiElementCandidate[] {
  return candidates.map((candidate) => {
    const distanceToPoint = point ? Math.round(distanceToRect(point, candidate.bounds)) : undefined;
    return {
      ...candidate,
      distanceToPoint,
      score: candidateScore(candidate, distanceToPoint)
    };
  });
}

function candidateScore(candidate: UiElementCandidate, distanceToPoint?: number): number {
  const interactableScore = candidate.clickable ? 4 : candidate.longClickable ? 3 : candidate.focusable ? 1 : 0;
  const enabledScore = candidate.enabled ? 1 : -2;
  const identityScore = (candidate.resourceId ? 2 : 0) + (candidate.contentDesc ? 1.4 : 0) + (candidate.text ? 1.2 : 0);
  const sizeScore = -Math.min(2, candidate.area / 500000);
  const depthScore = Math.min(1, candidate.depth / 20);
  const distanceScore = distanceToPoint === undefined ? 0 : -distanceToPoint / 1000;
  return interactableScore + enabledScore + identityScore + sizeScore + depthScore + distanceScore;
}

function locatorMatches(candidate: UiElementCandidate, locator: UiElementLocator): boolean {
  const sanitized = sanitizeLocator(locator);
  if (sanitized.strategy && sanitized.strategy !== "android_uiautomator") {
    return false;
  }
  if (sanitized.resourceId && candidate.resourceId !== sanitized.resourceId) {
    return false;
  }
  if (sanitized.contentDesc && candidate.contentDesc !== sanitized.contentDesc) {
    return false;
  }
  if (sanitized.text && !candidateTextMatches(candidate.text, sanitized)) {
    return false;
  }
  if (sanitized.className && candidate.className !== sanitized.className) {
    return false;
  }
  if (sanitized.packageName && candidate.packageName !== sanitized.packageName) {
    return false;
  }
  return hasStableLocator(sanitized);
}

function findElementByTextLocator(
  candidates: UiElementCandidate[],
  locator: UiElementLocator,
  options: {
    preferredPoint?: { x: number; y: number };
    maxDistance?: number;
  } = {}
): UiElementCandidate | undefined {
  const textCandidates = candidates
    .filter((candidate) => candidateTextMatches(candidate.text, locator))
    .filter((candidate) => {
      if (locator.packageName && candidate.packageName !== locator.packageName) {
        return false;
      }
      if (locator.className && candidate.className !== locator.className) {
        return false;
      }
      if (options.maxDistance === undefined || candidate.distanceToPoint === undefined) {
        return true;
      }
      return candidate.distanceToPoint <= options.maxDistance;
    })
    .sort(compareVisualOrder);

  const textCandidate = textCandidates[(locator.occurrence ?? 1) - 1];
  if (!textCandidate) {
    return undefined;
  }
  if (locator.tapTarget !== "self") {
    const clickableAncestor = findClickableAncestor(candidates, textCandidate);
    if (clickableAncestor) {
      return clickableAncestor;
    }
  }
  return textCandidate;
}

function findClickableAncestor(candidates: UiElementCandidate[], candidate: UiElementCandidate): UiElementCandidate | undefined {
  const byId = new Map(candidates.map((item) => [item.nodeId, item]));
  let currentParentId = candidate.parentNodeId;
  while (currentParentId !== undefined) {
    const parent = byId.get(currentParentId);
    if (!parent) {
      return undefined;
    }
    if (parent.enabled && parent.clickable) {
      return parent;
    }
    currentParentId = parent.parentNodeId;
  }
  return undefined;
}

function candidateTextMatches(actual: string | undefined, locator: UiElementLocator): boolean {
  const expected = normalizeText(locator.text);
  const normalizedActual = normalizeText(actual);
  if (!expected || !normalizedActual) {
    return false;
  }
  const excludes = locator.excludeTexts ?? [];
  if (excludes.some((exclude) => normalizedActual.includes(normalizeText(exclude)))) {
    return false;
  }
  if (locator.textMatchMode === "contains") {
    return normalizedActual.includes(expected);
  }
  return normalizedActual === expected;
}

function compareVisualOrder(left: UiElementCandidate, right: UiElementCandidate): number {
  return left.bounds.top - right.bounds.top || left.bounds.left - right.bounds.left || left.nodeId - right.nodeId;
}

function withOccurrence(locator: UiElementLocator, candidate: UiElementCandidate, candidates: UiElementCandidate[] | undefined): UiElementLocator {
  if (!candidates?.length) {
    return locator;
  }
  const sameLocatorCandidates = candidates.filter((item) => locatorMatches(item, locator)).sort(compareVisualOrder);
  if (sameLocatorCandidates.length <= 1) {
    return locator;
  }
  const index = sameLocatorCandidates.findIndex((item) => item.nodeId === candidate.nodeId);
  if (index < 0) {
    return locator;
  }
  return {
    ...locator,
    occurrence: index + 1
  };
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .replace(/[‐‑‒–—―－﹣−]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

function containsPoint(bounds: UiElementBounds, point: { x: number; y: number }): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function distanceToRect(point: { x: number; y: number }, bounds: UiElementBounds): number {
  const dx = Math.max(bounds.left - point.x, 0, point.x - bounds.right);
  const dy = Math.max(bounds.top - point.y, 0, point.y - bounds.bottom);
  return Math.hypot(dx, dy);
}

function buildSelector(candidate: ParsedNode): string {
  if (candidate.resourceId) {
    return `id=${candidate.resourceId}`;
  }
  if (candidate.contentDesc) {
    return `desc=${candidate.contentDesc}`;
  }
  if (candidate.text) {
    return `text=${candidate.text}`;
  }
  return candidate.className ? `class=${candidate.className}` : "android_uiautomator";
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
