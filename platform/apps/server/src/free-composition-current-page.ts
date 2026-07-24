import {
  type BusinessGraphVersion,
  type NodeMatchCandidate,
  type NodeMatchResult,
  type Observation
} from "@mobile-automation/graph-core";
import type { Platform } from "@mobile-automation/shared";
import type { ResolveFreeCompositionInput } from "./free-composition.js";
import { matchCurrentPage, type PageMatcherBaselineReader } from "./page-matcher.js";

export async function resolveFreeCompositionCurrentPage(
  graphVersion: BusinessGraphVersion,
  appId: string,
  platform: Platform,
  observation: Observation,
  baselineReader?: PageMatcherBaselineReader
): Promise<ResolveFreeCompositionInput["currentPage"]> {
  if (observation.platform !== platform || !observationMatchesFreeCompositionApp(observation, appId, platform)) {
    return undefined;
  }
  const result = await matchCurrentPage({
    graphVersion,
    observation,
    baselineReader,
    prefilterByForegroundTitle: true
  });
  return freeCompositionCurrentPageFromMatch(result.match, result.observation);
}

export function freeCompositionCurrentPageDetectionFailure(
  observation: Observation,
  appId: string,
  platform: Platform
): ResolveFreeCompositionInput["currentPageDetectionFailure"] | undefined {
  const expectedAppId = appId.trim();
  if (!expectedAppId) {
    return undefined;
  }
  const actualAppId = appIdFromObservation(observation, platform);
  if (observation.platform !== platform || (actualAppId && actualAppId !== expectedAppId)) {
    return {
      reason: "outside_app",
      expectedAppId,
      actualAppId
    };
  }
  return undefined;
}

export function freeCompositionCurrentPageFromMatch(
  match: NodeMatchResult,
  observation?: Observation
): ResolveFreeCompositionInput["currentPage"] {
  if (match.status === "matched" && match.node) {
    return {
      pageModelId: match.node.id,
      pageModelName: match.node.name
    };
  }
  const fallback = bestFallbackCurrentPageCandidate(match, observation);
  return fallback
    ? {
        pageModelId: fallback.node.id,
        pageModelName: fallback.node.name
      }
    : undefined;
}

function bestFallbackCurrentPageCandidate(match: NodeMatchResult, observation: Observation | undefined): NodeMatchCandidate | undefined {
  const scored = match.candidates
    .map((candidate) => ({
      candidate,
      titleScore: observation ? titleTextScoreForNode(candidate.node.name, observation) : 0,
      strongSignals: candidate.quality.matchedStrongSignals,
      weakSignals: candidate.quality.matchedWeakSignals,
      score: candidate.score
    }))
    .map((item) => ({
      ...item,
      fallbackScore:
        item.titleScore * 1000 +
        item.strongSignals * 80 +
        item.weakSignals * 8 +
        item.score * 100
    }))
    .filter((item) => item.titleScore > 0)
    .sort((left, right) =>
      right.fallbackScore - left.fallbackScore ||
      right.titleScore - left.titleScore ||
      right.strongSignals - left.strongSignals ||
      right.score - left.score ||
      left.candidate.node.name.localeCompare(right.candidate.node.name, "zh-CN")
    );
  const top = scored[0];
  if (!top) {
    return undefined;
  }
  const second = scored[1];
  if (second && top.fallbackScore - second.fallbackScore < 25) {
    return undefined;
  }
  return top.candidate;
}

function titleTextScoreForNode(nodeName: string, observation: Observation): number {
  const normalizedNodeName = normalize(nodeName);
  if (!normalizedNodeName) {
    return 0;
  }
  const foregroundTitle = foregroundPageTitleText(observation);
  if (foregroundTitle && !textMatchesNodeName(foregroundTitle, normalizedNodeName)) {
    return 0;
  }
  const texts = foregroundTitle ? [foregroundTitle] : prominentObservationTexts(observation);
  return texts.reduce((best, text) => {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      return best;
    }
    if (normalizedText === normalizedNodeName) {
      return Math.max(best, 3);
    }
    if (normalizedText.includes(normalizedNodeName)) {
      return Math.max(best, 2);
    }
    if (normalizedNodeName.includes(normalizedText) && normalizedText.length >= 2) {
      return Math.max(best, 1);
    }
    return best;
  }, 0);
}

function foregroundPageTitleText(observation: Observation): string | undefined {
  return prominentObservationTextCandidates(observation)
    .filter((candidate) => isLikelyForegroundPageTitle(candidate.text))
    .sort((left, right) => left.centerY - right.centerY || left.order - right.order)[0]?.text;
}

function prominentObservationTextCandidates(observation: Observation): Array<{ text: string; centerY: number; order: number }> {
  const height = observation.resolution?.height;
  const candidates: Array<{ text: string; centerY: number; order: number }> = [];
  let order = 0;
  const push = (text: string | undefined, bounds: { y: number; height: number } | undefined): void => {
    const normalized = text?.trim();
    order += 1;
    if (!normalized || !isProminent(bounds, height)) {
      return;
    }
    candidates.push({
      text: normalized,
      centerY: bounds ? bounds.y + bounds.height / 2 : 0,
      order
    });
  };
  for (const element of observation.uiElements) {
    if (element.visible === false) {
      continue;
    }
    push(element.text, element.bounds);
  }
  for (const text of observation.ocrTexts) {
    push(text.text, text.region);
  }
  return candidates;
}

function prominentObservationTexts(observation: Observation): string[] {
  const height = observation.resolution?.height;
  const uiTexts = observation.uiElements
    .filter((element) => element.visible !== false && isProminent(element.bounds, height))
    .flatMap((element) => [element.text, element.contentDesc]);
  const ocrTexts = observation.ocrTexts
    .filter((text) => isProminent(text.region, height))
    .map((text) => text.text);
  return [...new Set([...uiTexts, ...ocrTexts].map((text) => text?.trim()).filter((text): text is string => Boolean(text)))];
}

function isProminent(bounds: { y: number; height: number } | undefined, screenHeight?: number): boolean {
  return !screenHeight || !bounds || bounds.y + bounds.height / 2 <= screenHeight * 0.45;
}

function isLikelyForegroundPageTitle(text: string): boolean {
  const normalized = text.replace(/\s+/g, "").trim();
  if (!normalized || normalized.length > 16 || !/[\u4e00-\u9fa5]/.test(normalized)) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (/\d/.test(normalized) && /小时|分钟|今天|明天|昨天|开始|出勤|上课/.test(normalized)) {
    return false;
  }
  return true;
}

function textMatchesNodeName(text: string, normalizedNodeName: string): boolean {
  const normalizedText = normalize(text);
  return (
    normalizedText === normalizedNodeName ||
    normalizedText.includes(normalizedNodeName) ||
    (normalizedNodeName.includes(normalizedText) && normalizedText.length >= 2)
  );
}

function observationMatchesFreeCompositionApp(observation: Observation, appId: string, platform: Platform): boolean {
  const expectedAppId = appId.trim();
  if (!expectedAppId) {
    return true;
  }
  const actualAppId = appIdFromObservation(observation, platform);
  return !actualAppId || actualAppId === expectedAppId;
}

function appIdFromObservation(observation: Observation, platform: Platform): string | undefined {
  return platform === "ios"
    ? observation.bundleId?.trim() || observation.packageName?.trim()
    : observation.packageName?.trim();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
