import { createId, nowIso } from "@mobile-automation/shared";
import type { BusinessNode, NodeMatchResult, Observation, StateMatcher } from "@mobile-automation/graph-core";

export type RuntimeUnknownNodeCandidate = Omit<BusinessNode, "id">;

export function buildRuntimeUnknownNodeCandidate(graphVersionId: string, observation: Observation, match: NodeMatchResult | undefined): RuntimeUnknownNodeCandidate {
  const visibleTexts = uniqueStrings([
    ...observation.uiElements.map((element) => element.text),
    ...observation.ocrTexts.map((text) => text.text)
  ]).slice(0, 8);
  const resourceIds = uniqueStrings(observation.uiElements.map((element) => element.resourceId).filter(isMeaningfulResourceId)).slice(0, 5);
  const accessibilityIds = uniqueStrings(observation.uiElements.map((element) => element.accessibilityId).filter(isMeaningfulText)).slice(0, 5);
  const signatureParts = [
    observation.packageName,
    observation.activityName,
    ...visibleTexts.slice(0, 5),
    ...resourceIds.slice(0, 3),
    ...accessibilityIds.slice(0, 3)
  ].filter(isMeaningfulText);
  const key = `runtime.unknown.${stableHash(signatureParts.join("|") || observation.id || observation.capturedAt)}`;
  const primaryText = visibleTexts[0] ?? observation.activityName ?? observation.packageName ?? "未知页面";
  const matchers: StateMatcher[] = [
    observation.packageName ? runtimeMatcher("package", observation.packageName, 2, true, observation.platform) : undefined,
    observation.activityName ? runtimeMatcher("activity", observation.activityName, 3, true, observation.platform) : undefined,
    ...visibleTexts.slice(0, 4).map((text, index) => runtimeMatcher("text", text, index === 0 ? 2 : 1.5, index === 0, observation.platform)),
    ...resourceIds.slice(0, 3).map((resourceId) => runtimeMatcher("resource_id", resourceId, 2.5, true, observation.platform)),
    ...accessibilityIds.slice(0, 3).map((accessibilityId) => runtimeMatcher("accessibility_id", accessibilityId, 2, true, observation.platform))
  ].filter((matcher): matcher is StateMatcher => Boolean(matcher));
  return {
    graphVersionId,
    key,
    name: `运行期未知节点：${primaryText}`,
    nodeType: "page",
    tags: ["runtime-discovered", "needs-review"],
    status: "draft",
    matchers,
    defaultExpectations: [],
    platformScope: observation.platform,
    metadata: {
      source: "runtime_unknown_state",
      needsReview: true,
      observation: summarizeObservation(observation),
      visibleTexts,
      resourceIds,
      accessibilityIds,
      nearestKnownCandidates: summarizeNodeMatch(match)?.candidates ?? [],
      createdFrom: {
        type: "graph_run_bootstrap_failure",
        capturedAt: observation.capturedAt
      }
    }
  };
}

export function mergeRuntimeUnknownNodeMetadata(
  previous: Record<string, unknown> | undefined,
  latest: Record<string, unknown> | undefined,
  artifactId: string
): Record<string, unknown> {
  const previousArtifactIds = Array.isArray(previous?.artifactIds)
    ? previous.artifactIds.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const previousArtifactId = typeof previous?.artifactId === "string" && previous.artifactId.length > 0 ? previous.artifactId : undefined;
  const artifactIds = uniqueStrings([...previousArtifactIds, previousArtifactId, artifactId]).slice(-20);
  const previousObservationCount = typeof previous?.observationCount === "number" ? previous.observationCount : 1;
  return {
    ...(previous ?? {}),
    ...(latest ?? {}),
    artifactId,
    artifactIds,
    observationCount: previousObservationCount + 1,
    firstObservedAt: previous?.firstObservedAt ?? nowIso(),
    lastObservedAt: nowIso()
  };
}

export function summarizeObservation(observation: Observation): Record<string, unknown> {
  return {
    id: observation.id,
    capturedAt: observation.capturedAt,
    packageName: observation.packageName,
    activityName: observation.activityName,
    componentName: observation.componentName,
    screenshotArtifactId: observation.screenshot?.artifactId,
    uiElementCount: observation.uiElements.length,
    ocrTextCount: observation.ocrTexts.length
  };
}

function runtimeMatcher(type: StateMatcher["type"], value: string, weight: number, critical: boolean, platformScope: StateMatcher["platformScope"]): StateMatcher {
  return {
    id: createId("matcher"),
    type,
    value,
    weight,
    critical,
    platformScope,
    source: {
      sourceType: "exploration",
      confidence: critical ? 0.75 : 0.6
    }
  };
}

function summarizeNodeMatch(match: NodeMatchResult | undefined): Record<string, unknown> | undefined {
  if (!match) {
    return undefined;
  }
  return {
    status: match.status,
    nodeId: match.node?.id,
    nodeName: match.node?.name,
    score: match.score,
    candidates: match.candidates.slice(0, 5).map((candidate) => ({
      nodeId: candidate.node.id,
      nodeName: candidate.node.name,
      score: candidate.score,
      matchedWeight: candidate.matchedWeight,
      totalWeight: candidate.totalWeight,
      quality: candidate.quality,
      matcherResults: candidate.matcherResults.map((result) => ({
        matcherId: result.matcherId,
        type: result.type,
        expected: result.expected,
        actual: result.actual,
        weight: result.weight,
        matched: result.matched,
        score: result.score,
        reason: result.reason
      }))
    }))
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function isMeaningfulText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isMeaningfulResourceId(value: string | undefined): value is string {
  if (!isMeaningfulText(value)) {
    return false;
  }
  return value !== "android:id/content" && !value.endsWith(":id/action_bar_root") && !value.endsWith(":id/content_frame");
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
