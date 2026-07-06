import type { Platform } from "@mobile-automation/shared";
import { detectNode, type BusinessGraphVersion, type GraphTargetApp, type NodeMatchResult, type Observation, type RoutePlanIssue } from "@mobile-automation/graph-core";
import { matchCurrentPage, type PageMatcherBaselineReader } from "./page-matcher.js";

export type RoutePlanStartDetection = {
  source: "device_observation" | "request_start_node" | "default";
  startNodeId?: string;
  inTargetApp?: boolean;
  nodeMatch?: NodeMatchResult;
  observation?: Observation;
};

export type StartAppScope = "target_app" | "current_device";

export async function resolveRoutePlanStart(input: {
  graphVersion: BusinessGraphVersion;
  targetApp?: GraphTargetApp;
  platform: Platform;
  requestedStartNodeId?: string;
  observation?: Observation;
  baselineReader?: PageMatcherBaselineReader;
  startAppScope?: StartAppScope;
}): Promise<RoutePlanStartDetection> {
  if (input.observation) {
    const pageMatch = await matchCurrentPage({
      graphVersion: input.graphVersion,
      observation: input.observation,
      baselineReader: input.baselineReader
    });
    const nodeMatch =
      pageMatch.match.status === "matched"
        ? pageMatch.match
        : detectNode(pageMatch.observation, input.graphVersion, input.platform);
    const inTargetApp = isObservationInRouteScope(input.observation, input.targetApp, input.platform, input.startAppScope);
    return {
      source: "device_observation",
      startNodeId: nodeMatch.status === "matched" && inTargetApp ? nodeMatch.node?.id : undefined,
      inTargetApp,
      nodeMatch,
      observation: pageMatch.observation
    };
  }
  if (input.requestedStartNodeId) {
    return {
      source: "request_start_node",
      startNodeId: input.requestedStartNodeId
    };
  }
  return {
    source: "default"
  };
}

export function summarizeRoutePlanStartDetection(detection: RoutePlanStartDetection): Record<string, unknown> {
  return {
    source: detection.source,
    startNodeId: detection.startNodeId,
    inTargetApp: detection.inTargetApp,
    nodeMatch: detection.nodeMatch
      ? {
          status: detection.nodeMatch.status,
          score: detection.nodeMatch.score,
          node: detection.nodeMatch.node
            ? {
                id: detection.nodeMatch.node.id,
                key: detection.nodeMatch.node.key,
                name: detection.nodeMatch.node.name
              }
            : undefined,
          candidates: detection.nodeMatch.candidates.slice(0, 5).map((candidate) => ({
            node: {
              id: candidate.node.id,
              key: candidate.node.key,
              name: candidate.node.name
            },
            score: candidate.score,
            quality: candidate.quality
          }))
        }
      : undefined,
    observation: detection.observation
      ? {
          id: detection.observation.id,
          packageName: detection.observation.packageName,
          activityName: detection.observation.activityName,
          componentName: detection.observation.componentName,
          uiElementCount: detection.observation.uiElements.length,
          ocrTextCount: detection.observation.ocrTexts.length
        }
      : undefined
  };
}

export function routePreviewBlockingIssue(detection: RoutePlanStartDetection): RoutePlanIssue | undefined {
  if (detection.source !== "device_observation" || detection.startNodeId || detection.inTargetApp !== true) {
    return undefined;
  }
  return {
    code: "CURRENT_NODE_UNKNOWN",
    message: "当前设备在目标 App 内，但未识别到 active 业务节点；请先识别当前页面并治理草稿节点，或从可识别页面重新规划。",
    severity: "error"
  };
}

function isObservationInRouteScope(observation: Observation, targetApp: GraphTargetApp | undefined, platform: Platform, startAppScope: StartAppScope | undefined): boolean {
  if (startAppScope === "current_device") {
    return true;
  }
  if (platform === "android" && targetApp?.androidPackageName) {
    return observation.packageName === targetApp.androidPackageName;
  }
  if (platform === "ios" && targetApp?.iosBundleId) {
    return observation.bundleId === targetApp.iosBundleId;
  }
  return true;
}
