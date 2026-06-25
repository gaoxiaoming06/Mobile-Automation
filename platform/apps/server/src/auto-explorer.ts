import type { BusinessGraphVersion, BusinessNode, Observation, Rect, VisualSemanticArea } from "@mobile-automation/graph-core";
import { createId, type DeviceActionRequest } from "@mobile-automation/shared";

export type AutoExploreVersion = "v1" | "v2";
export type AutoExploreCandidateSource = "manual_element" | "ocr_text";
export type AutoExploreRiskLevel = "safe" | "dangerous";
export type AutoExploreCandidateStatus = "ready" | "skipped";
export type AutoExploreResultType =
  | "existing_page"
  | "new_page_candidate"
  | "local_state_change"
  | "no_change"
  | "dangerous_skipped"
  | "failed";

export type AutoExploreCandidate = {
  id: string;
  sourceNodeId: string;
  sourceNodeName: string;
  label: string;
  actionKind: "tap" | "scroll" | "long_press" | "input";
  locator: string;
  region?: Rect;
  semanticArea: VisualSemanticArea;
  coordinateSpace: "screen" | "app_viewport" | "region";
  source: AutoExploreCandidateSource;
  riskLevel: AutoExploreRiskLevel;
  status: AutoExploreCandidateStatus;
  skipReason?: string;
  targetNodeId?: string;
  targetNodeName?: string;
  outcomeType?: string;
};

export type AutoExplorePlanStep = {
  id: string;
  depth: number;
  sourceNodeId: string;
  sourceNodeName: string;
  candidateId: string;
  candidateLabel: string;
  targetNodeId?: string;
  targetNodeName?: string;
};

export type AutoExplorePlan = {
  version: AutoExploreVersion;
  maxDepth: number;
  maxActions: number;
  steps: AutoExplorePlanStep[];
};

export type AutoExploreCandidateResult = {
  candidateId?: string;
  candidateLabel?: string;
  status: "passed" | "skipped" | "failed";
  resultType: AutoExploreResultType;
  targetNodeId?: string;
  targetNodeName?: string;
  message?: string;
};

export type AutoExploreReport = {
  status: "ready" | "blocked";
  version: AutoExploreVersion;
  sourceNodeId?: string;
  sourceNodeName?: string;
  blockReason?: "source_not_found" | "source_not_confirmed";
  message?: string;
  candidates: AutoExploreCandidate[];
  plan: AutoExplorePlan;
  results: AutoExploreCandidateResult[];
};

type ManualPageAbilityElement = {
  id?: string;
  label?: string;
  targetText?: string;
  locator?: string;
  semanticArea?: VisualSemanticArea;
  coordinateSpace?: "screen" | "app_viewport" | "region";
  actionKind?: "tap" | "scroll" | "long_press" | "input";
  availability?: "visible" | "after_scroll" | "conditional";
  outcomeType?: string;
  targetNodeId?: string;
  targetLabel?: string;
};

export function createAutoExploreReport(input: {
  graphVersion: BusinessGraphVersion;
  sourceNodeId: string;
  observation: Observation;
  maxDepth?: number;
  maxCandidates?: number;
  maxActions?: number;
}): AutoExploreReport {
  const sourceNode = input.graphVersion.nodes.find((node) => node.id === input.sourceNodeId);
  const maxDepth = clampInteger(input.maxDepth, 1, 1, 3);
  const maxActions = clampInteger(input.maxActions, input.maxCandidates ?? 8, 1, 30);
  if (!sourceNode) {
    return blockedReport("source_not_found", maxDepth, maxActions, "当前页面没有匹配到可探索的页面资产。");
  }
  if (!isConfirmedPageAsset(sourceNode)) {
    return blockedReport("source_not_confirmed", maxDepth, maxActions, "自动探索只针对已确认保存的页面资产生成候选。");
  }

  const candidates = generateExplorationCandidates({
    node: sourceNode,
    observation: input.observation,
    graphVersion: input.graphVersion,
    maxCandidates: input.maxCandidates
  });
  const candidatesByNode = new Map<string, AutoExploreCandidate[]>([[sourceNode.id, candidates]]);
  if (maxDepth > 1) {
    for (const candidate of candidates) {
      if (candidate.status !== "ready" || !candidate.targetNodeId || candidatesByNode.has(candidate.targetNodeId)) {
        continue;
      }
      const targetNode = input.graphVersion.nodes.find((node) => node.id === candidate.targetNodeId);
      if (targetNode) {
        candidatesByNode.set(
          targetNode.id,
          generateExplorationCandidates({
            node: targetNode,
            observation: input.observation,
            graphVersion: input.graphVersion,
            maxCandidates: input.maxCandidates
          })
        );
      }
    }
  }

  return {
    status: "ready",
    version: maxDepth > 1 ? "v2" : "v1",
    sourceNodeId: sourceNode.id,
    sourceNodeName: sourceNode.name,
    candidates,
    plan: planExploration({
      graphVersion: input.graphVersion,
      startNodeId: sourceNode.id,
      candidatesByNode,
      maxDepth,
      maxActions
    }),
    results: []
  };
}

export function generateExplorationCandidates(input: {
  node: BusinessNode;
  observation: Observation;
  graphVersion?: BusinessGraphVersion;
  maxCandidates?: number;
}): AutoExploreCandidate[] {
  const limit = clampInteger(input.maxCandidates, 12, 1, 30);
  const manualCandidates = readManualElements(input.node).flatMap((element) => manualElementCandidate(input.node, element, input.graphVersion) ?? []);
  const existingKeys = new Set(manualCandidates.map(candidateKey));
  const ocrCandidates = input.observation.ocrTexts
    .flatMap((text) => ocrTextCandidate(input.node, text, input.observation) ?? [])
    .filter((candidate) => {
      const key = candidateKey(candidate);
      if (existingKeys.has(key)) {
        return false;
      }
      existingKeys.add(key);
      return true;
    });
  return [...manualCandidates, ...ocrCandidates].slice(0, limit);
}

export function planExploration(input: {
  graphVersion: BusinessGraphVersion;
  startNodeId: string;
  candidatesByNode: Map<string, AutoExploreCandidate[]>;
  maxDepth?: number;
  maxActions?: number;
}): AutoExplorePlan {
  const maxDepth = clampInteger(input.maxDepth, 1, 1, 3);
  const maxActions = clampInteger(input.maxActions, 12, 1, 50);
  const version: AutoExploreVersion = maxDepth > 1 ? "v2" : "v1";
  const steps: AutoExplorePlanStep[] = [];
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: input.startNodeId, depth: 1 }];
  const visitedDepth = new Map<string, number>();

  while (queue.length && steps.length < maxActions) {
    const current = queue.shift()!;
    if (current.depth > maxDepth) {
      continue;
    }
    const previousDepth = visitedDepth.get(current.nodeId);
    if (previousDepth !== undefined && previousDepth <= current.depth) {
      continue;
    }
    visitedDepth.set(current.nodeId, current.depth);
    const candidates = input.candidatesByNode.get(current.nodeId) ?? [];
    for (const candidate of candidates) {
      if (steps.length >= maxActions) {
        break;
      }
      if (candidate.status !== "ready") {
        continue;
      }
      steps.push({
        id: `explore_step_${steps.length + 1}`,
        depth: current.depth,
        sourceNodeId: candidate.sourceNodeId,
        sourceNodeName: candidate.sourceNodeName,
        candidateId: candidate.id,
        candidateLabel: candidate.label,
        targetNodeId: candidate.targetNodeId,
        targetNodeName: candidate.targetNodeName
      });
      if (candidate.targetNodeId && current.depth < maxDepth) {
        queue.push({ nodeId: candidate.targetNodeId, depth: current.depth + 1 });
      }
    }
  }

  return {
    version,
    maxDepth,
    maxActions,
    steps
  };
}

export function classifyExplorationResult(input: {
  sourceNodeId: string;
  beforeObservation: Observation;
  afterObservation: Observation;
  afterMatch?: {
    status: "matched" | "multiple_candidates" | "unknown";
    node?: BusinessNode;
  };
}): AutoExploreCandidateResult {
  const matchedNode = input.afterMatch?.status === "matched" ? input.afterMatch.node : undefined;
  if (matchedNode && matchedNode.id !== input.sourceNodeId && isConfirmedPageAsset(matchedNode)) {
    return {
      status: "passed",
      resultType: "existing_page",
      targetNodeId: matchedNode.id,
      targetNodeName: matchedNode.name,
      message: `到达已保存页面：${matchedNode.name}`
    };
  }
  if (!matchedNode) {
    return {
      status: "passed",
      resultType: "new_page_candidate",
      message: "执行后未匹配到已保存页面，可作为新页面候选人工确认。"
    };
  }
  const beforeText = observationTextSignature(input.beforeObservation);
  const afterText = observationTextSignature(input.afterObservation);
  if (beforeText !== afterText) {
    return {
      status: "passed",
      resultType: "local_state_change",
      targetNodeId: matchedNode.id,
      targetNodeName: matchedNode.name,
      message: "仍在当前页面资产内，但 OCR/UI 文本发生变化。"
    };
  }
  return {
    status: "passed",
    resultType: "no_change",
    targetNodeId: matchedNode.id,
    targetNodeName: matchedNode.name,
    message: "执行后未观察到明显页面变化。"
  };
}

export function pixelRectToPercent(region: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    return undefined;
  }
  const isAlreadyPercent = region.x <= 100 && region.y <= 100 && region.width <= 100 && region.height <= 100;
  if (isAlreadyPercent) {
    return roundRect(region);
  }
  return roundRect({
    x: (region.x / resolution.width) * 100,
    y: (region.y / resolution.height) * 100,
    width: (region.width / resolution.width) * 100,
    height: (region.height / resolution.height) * 100
  });
}

export function regionCenterPixels(region: Rect, resolution: Observation["resolution"]): { x: number; y: number } | undefined {
  if (!resolution?.width || !resolution.height) {
    return undefined;
  }
  const percent = region.x <= 100 && region.y <= 100 && region.width <= 100 && region.height <= 100 ? region : pixelRectToPercent(region, resolution);
  if (!percent) {
    return undefined;
  }
  return {
    x: Math.round(((percent.x + percent.width / 2) / 100) * resolution.width),
    y: Math.round(((percent.y + percent.height / 2) / 100) * resolution.height)
  };
}

export function candidateActionForObservation(candidate: AutoExploreCandidate, observation: Observation): DeviceActionRequest | undefined {
  if (candidate.status !== "ready" || !candidate.region) {
    return undefined;
  }
  if (candidate.actionKind === "long_press") {
    const center = regionCenterPixels(candidate.region, observation.resolution);
    return center ? { type: "long_press", x: center.x, y: center.y, durationMs: 600 } : undefined;
  }
  if (candidate.actionKind === "scroll") {
    const bounds = percentRegionToPixels(candidate.region, observation.resolution);
    if (!bounds) {
      return undefined;
    }
    const centerX = Math.round(bounds.x + bounds.width / 2);
    return {
      type: "swipe",
      startX: centerX,
      startY: Math.round(bounds.y + bounds.height * 0.9),
      endX: centerX,
      endY: Math.round(bounds.y + bounds.height * 0.2),
      durationMs: 360
    };
  }
  const center = regionCenterPixels(candidate.region, observation.resolution);
  if (!center) {
    return undefined;
  }
  return { type: "tap", x: center.x, y: center.y };
}

function manualElementCandidate(node: BusinessNode, element: ManualPageAbilityElement, graphVersion?: BusinessGraphVersion): AutoExploreCandidate | undefined {
  if (!element.locator) {
    return undefined;
  }
  const region = imageRegionFromLocator(element.locator);
  const label = element.label ?? element.targetText ?? element.locator;
  const targetNode = element.targetNodeId ? graphVersion?.nodes.find((item) => item.id === element.targetNodeId) : undefined;
  return withRisk({
    id: element.id ?? createId("explore_candidate"),
    sourceNodeId: node.id,
    sourceNodeName: node.name,
    label,
    actionKind: element.actionKind ?? "tap",
    locator: element.locator,
    region,
    semanticArea: element.semanticArea ?? semanticAreaForRegion(region) ?? "unknown",
    coordinateSpace: element.coordinateSpace ?? (element.locator.startsWith("image-region:") ? "screen" : "app_viewport"),
    source: "manual_element",
    riskLevel: "safe",
    status: "ready",
    targetNodeId: element.targetNodeId,
    targetNodeName: targetNode?.name ?? element.targetLabel,
    outcomeType: element.outcomeType
  });
}

function ocrTextCandidate(node: BusinessNode, text: Observation["ocrTexts"][number], observation: Observation): AutoExploreCandidate | undefined {
  const label = text.text.trim();
  if (!label || !text.region) {
    return undefined;
  }
  const region = pixelRectToPercent(text.region, observation.resolution);
  if (!region || region.width < 1 || region.height < 1) {
    return undefined;
  }
  return withRisk({
    id: `ocr_${stableId(label)}_${Math.round(region.x * 10)}_${Math.round(region.y * 10)}`,
    sourceNodeId: node.id,
    sourceNodeName: node.name,
    label,
    actionKind: "tap",
    locator: imageRegionLocator(region),
    region,
    semanticArea: text.semanticArea ?? semanticAreaForRegion(region),
    coordinateSpace: "screen",
    source: "ocr_text",
    riskLevel: "safe",
    status: "ready",
    outcomeType: "unknown"
  });
}

function withRisk(candidate: AutoExploreCandidate): AutoExploreCandidate {
  if (!isDangerousLabel(candidate.label)) {
    return candidate;
  }
  return {
    ...candidate,
    riskLevel: "dangerous",
    status: "skipped",
    skipReason: "dangerous_label"
  };
}

function isDangerousLabel(label: string): boolean {
  const normalized = label.replace(/\s+/g, "").toLowerCase();
  return [
    "退出",
    "退出登录",
    "注销",
    "删除",
    "移除",
    "解绑",
    "清空",
    "重置",
    "支付",
    "购买",
    "开通",
    "发布",
    "提交",
    "确定",
    "确认"
  ].some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function readManualElements(node: BusinessNode): ManualPageAbilityElement[] {
  const elements = node.metadata?.assetRecordingManualElements;
  return Array.isArray(elements) ? elements.filter((item): item is ManualPageAbilityElement => Boolean(item) && typeof item === "object") : [];
}

function isConfirmedPageAsset(node: BusinessNode): boolean {
  return node.status === "active" && node.nodeType === "page" && (Boolean(node.metadata?.assetRecordingConfirmed) || node.tags.includes("page-asset") || node.tags.includes("asset-recording"));
}

function blockedReport(
  blockReason: NonNullable<AutoExploreReport["blockReason"]>,
  maxDepth: number,
  maxActions: number,
  message: string
): AutoExploreReport {
  return {
    status: "blocked",
    version: maxDepth > 1 ? "v2" : "v1",
    blockReason,
    message,
    candidates: [],
    plan: {
      version: maxDepth > 1 ? "v2" : "v1",
      maxDepth,
      maxActions,
      steps: []
    },
    results: []
  };
}

function imageRegionFromLocator(locator: string): Rect | undefined {
  const match = locator.match(/^image-region:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!match) {
    return undefined;
  }
  return roundRect({
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4])
  });
}

function percentRegionToPixels(region: Rect, resolution: Observation["resolution"]): Rect | undefined {
  if (!resolution?.width || !resolution.height) {
    return undefined;
  }
  return {
    x: (region.x / 100) * resolution.width,
    y: (region.y / 100) * resolution.height,
    width: (region.width / 100) * resolution.width,
    height: (region.height / 100) * resolution.height
  };
}

function imageRegionLocator(region: Rect): string {
  const rect = roundRect(region);
  return `image-region:${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function semanticAreaForRegion(region: Rect | undefined): VisualSemanticArea {
  if (!region) {
    return "unknown";
  }
  const centerY = region.y + region.height / 2;
  if (centerY <= 14) {
    return "top";
  }
  if (centerY >= 88) {
    return "bottom";
  }
  return "content";
}

function observationTextSignature(observation: Observation): string {
  return [...observation.ocrTexts.map((text) => text.text), ...observation.uiElements.map((element) => element.text ?? element.contentDesc ?? "")]
    .map((text) => text.trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function candidateKey(candidate: AutoExploreCandidate): string {
  return `${candidate.actionKind}:${candidate.locator}:${candidate.label}`;
}

function stableId(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "").slice(0, 24) || "text";
}

function roundRect(region: Rect): Rect {
  return {
    x: round(region.x),
    y: round(region.y),
    width: round(region.width),
    height: round(region.height)
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}
