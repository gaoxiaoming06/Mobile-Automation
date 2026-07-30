import type {
  ScriptFlowDocument,
  ScriptFlowPlatform,
  ScriptParameterDefinition,
  ScriptStep
} from "@mobile-automation/script-flow";
import type { ActionStep } from "@mobile-automation/shared";

export type PageNavigationSegmentSnapshot = {
  id: string;
  appId: string;
  platform: ScriptFlowPlatform;
  fromPage: string;
  toPage: string;
  flowId: string;
  flowVersion: number;
  flowName: string;
  parameters: Record<string, ScriptParameterDefinition>;
  stepIds: string[];
  steps: ScriptStep[];
};

export function derivePageNavigationSegments(input: {
  flowId: string;
  flowVersion: number;
  document: ScriptFlowDocument;
}): PageNavigationSegmentSnapshot[] {
  const result: PageNavigationSegmentSnapshot[] = [];
  let active: { fromPage: string; steps: ScriptStep[] } | undefined;

  for (const step of input.document.steps) {
    if (!isSafeNavigationAction(step)) {
      active = undefined;
      continue;
    }
    const onPage = normalizedPageReference(step.onPage);
    if (!active) {
      if (!onPage) continue;
      active = { fromPage: onPage, steps: [] };
    } else if (onPage && onPage !== active.fromPage) {
      active = { fromPage: onPage, steps: [] };
    }
    active.steps.push(step);
    const toPage = normalizedPageReference(step.expectPage);
    if (!toPage) continue;
    if (toPage !== active.fromPage) {
      const segmentNumber = result.length + 1;
      result.push({
        id: `navigation:${input.flowId}:${input.flowVersion}:${segmentNumber}`,
        appId: input.document.app.id,
        platform: input.document.app.platform,
        fromPage: active.fromPage,
        toPage,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        flowName: input.document.name,
        parameters: input.document.parameters,
        stepIds: active.steps.map((candidate) => candidate.id),
        steps: active.steps
      });
    }
    active = { fromPage: toPage, steps: [] };
  }

  return result;
}

function isSafeNavigationAction(step: ScriptStep): boolean {
  if (!("tap" in step || "swipe" in step || "scrollUntilVisible" in step)) {
    return false;
  }
  if (step.risk && step.risk !== "interaction") {
    return false;
  }
  return !/支付|付款|购买|删除|注销|移除|发布|提交|确认创建|pay|delete|publish|submit/i.test(stepSemanticText(step));
}

function stepSemanticText(step: ScriptStep): string {
  const target = "tap" in step
    ? step.tap.target
    : "selectText" in step
      ? step.selectText.target
      : undefined;
  return [step.name, target && "text" in target ? target.text : undefined].filter(Boolean).join(" ");
}

function normalizedPageReference(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export type PageNavigationEdge = {
  fromPageId: string;
  toPageId: string;
  flowId: string;
  flowName: string;
  segmentId: string;
  stepIds: string[];
  actions: ActionStep[];
};

export function findPageNavigationPath(
  edges: PageNavigationEdge[],
  fromPageId: string,
  toPageId: string
): PageNavigationEdge[] | undefined {
  if (fromPageId === toPageId) {
    return [];
  }
  const outgoing = new Map<string, PageNavigationEdge[]>();
  for (const edge of edges) {
    const candidates = outgoing.get(edge.fromPageId) ?? [];
    candidates.push(edge);
    outgoing.set(edge.fromPageId, candidates);
  }
  for (const candidates of outgoing.values()) {
    candidates.sort((left, right) => left.segmentId.localeCompare(right.segmentId));
  }
  const best = new Map<string, { cost: number; key: string }>([[fromPageId, { cost: 0, key: "" }]]);
  const queue: Array<{ pageId: string; path: PageNavigationEdge[]; cost: number; key: string }> = [
    { pageId: fromPageId, path: [], cost: 0, key: "" }
  ];
  while (queue.length) {
    queue.sort((left, right) => left.cost - right.cost || left.key.localeCompare(right.key));
    const current = queue.shift()!;
    const currentBest = best.get(current.pageId);
    if (!currentBest || current.cost !== currentBest.cost || current.key !== currentBest.key) continue;
    if (current.pageId === toPageId) return current.path;
    for (const edge of outgoing.get(current.pageId) ?? []) {
      const path = [...current.path, edge];
      const cost = current.cost + Math.max(1, edge.actions.length);
      const key = current.key ? `${current.key}>${edge.segmentId}` : edge.segmentId;
      const previous = best.get(edge.toPageId);
      if (previous && (previous.cost < cost || previous.cost === cost && previous.key <= key)) continue;
      best.set(edge.toPageId, { cost, key });
      queue.push({ pageId: edge.toPageId, path, cost, key });
    }
  }
  return undefined;
}

export function readPageNavigationEdges(value: unknown): PageNavigationEdge[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPageNavigationEdge);
}

function isPageNavigationEdge(value: unknown): value is PageNavigationEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const edge = value as Record<string, unknown>;
  return typeof edge.fromPageId === "string"
    && typeof edge.toPageId === "string"
    && typeof edge.flowId === "string"
    && typeof edge.flowName === "string"
    && typeof edge.segmentId === "string"
    && Array.isArray(edge.stepIds)
    && edge.stepIds.every((stepId) => typeof stepId === "string")
    && Array.isArray(edge.actions)
    && edge.actions.length > 0
    && edge.actions.every((action) => Boolean(action && typeof action === "object" && !Array.isArray(action)));
}
