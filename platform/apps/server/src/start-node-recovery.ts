import { detectNode, planRoute, type BusinessGraphVersion, type GraphTargetApp, type NodeMatchResult, type Observation, type RouteStrategy } from "@mobile-automation/graph-core";
import type { DeviceActionRequest, Platform } from "@mobile-automation/shared";
import { matchCurrentPage, type PageMatcherBaselineReader } from "./page-matcher.js";

export const MAX_START_BACK_RECOVERY_ATTEMPTS = 3;
const START_BACK_RECOVERY_STABILIZATION_ATTEMPTS = 5;
const START_BACK_RECOVERY_STABILIZATION_INTERVAL_MS = 300;

export type RuntimeStartStateReason =
  | "matched_graph_node"
  | "outside_target_app"
  | "unknown_app_state"
  | "multiple_candidates"
  | "low_confidence_graph_state"
  | "login_required"
  | "blocking_state";

export type RuntimeStartState = {
  nodeId?: string;
  match?: NodeMatchResult;
  observation?: Observation;
  inTargetApp: boolean;
  reason: RuntimeStartStateReason;
};

export type StartNodeRecoveryRecord = {
  status: "recovered" | "failed";
  fromNodeId: string;
  fromNodeName?: string;
  recoveredNodeId?: string;
  recoveredNodeName?: string;
  targetNodeId: string;
  attempts: Array<Record<string, unknown>>;
};

export type StartNodeResolution = {
  startNodeId?: string;
  recovery?: StartNodeRecoveryRecord;
};

export type StartNodeObservationCollector = () => Promise<Observation>;
export type StartNodeActionPerformer = (action: DeviceActionRequest) => Promise<unknown>;

export async function resolveReachableStartNode(input: {
  graphVersion: BusinessGraphVersion;
  appId: string;
  targetApp?: GraphTargetApp;
  platform: Platform;
  targetNodeId: string;
  strategy?: RouteStrategy;
  collectObservation: StartNodeObservationCollector;
  performAction: StartNodeActionPerformer;
  baselineReader?: PageMatcherBaselineReader;
}): Promise<StartNodeResolution> {
  try {
    const initialState = await detectRuntimeStartState(input);
    const initialNodeId = initialState.nodeId;
    if (!initialNodeId) {
      return { startNodeId: !initialState.inTargetApp ? rootNodeId(input.graphVersion, input.platform) : undefined };
    }
    if (canReachTarget(input, initialNodeId)) {
      return { startNodeId: initialNodeId };
    }
    if (!canBackRecoverStartState(input.graphVersion, initialState, input.platform)) {
      return { startNodeId: initialNodeId };
    }
    const attempts: Array<Record<string, unknown>> = [];
    let latestRecoverableNodeId = initialNodeId;
    let latestRecoverableNodeName = initialState.match?.node?.name;
    for (let attempt = 1; attempt <= MAX_START_BACK_RECOVERY_ATTEMPTS; attempt += 1) {
      await input.performAction({ type: "back" });
      const nextState = await waitForRecognizedStateAfterBack(input);
      attempts.push({
        attempt,
        nodeId: nextState.nodeId,
        nodeName: nextState.match?.node?.name,
        reason: nextState.reason,
        inTargetApp: nextState.inTargetApp
      });
      if (!nextState.nodeId) {
        break;
      }
      if (canReachTarget(input, nextState.nodeId)) {
        return {
          startNodeId: nextState.nodeId,
          recovery: {
            status: "recovered",
            fromNodeId: initialNodeId,
            fromNodeName: initialState.match?.node?.name,
            recoveredNodeId: nextState.nodeId,
            recoveredNodeName: nextState.match?.node?.name,
            targetNodeId: input.targetNodeId,
            attempts
          }
        };
      }
      if (!canBackRecoverStartState(input.graphVersion, nextState, input.platform)) {
        latestRecoverableNodeId = nextState.nodeId;
        latestRecoverableNodeName = nextState.match?.node?.name;
        break;
      }
      latestRecoverableNodeId = nextState.nodeId;
      latestRecoverableNodeName = nextState.match?.node?.name;
    }
    return {
      startNodeId: latestRecoverableNodeId,
      recovery: {
        status: "failed",
        fromNodeId: initialNodeId,
        fromNodeName: initialState.match?.node?.name,
        recoveredNodeId: latestRecoverableNodeId,
        recoveredNodeName: latestRecoverableNodeName,
        targetNodeId: input.targetNodeId,
        attempts
      }
    };
  } catch {
    return { startNodeId: rootNodeId(input.graphVersion, input.platform) };
  }
}

async function waitForRecognizedStateAfterBack(input: Parameters<typeof detectRuntimeStartState>[0]): Promise<RuntimeStartState> {
  let latest = await detectRuntimeStartState(input);
  for (let attempt = 1; attempt < START_BACK_RECOVERY_STABILIZATION_ATTEMPTS; attempt += 1) {
    if (latest.nodeId || !latest.inTargetApp) {
      return latest;
    }
    await sleep(START_BACK_RECOVERY_STABILIZATION_INTERVAL_MS);
    latest = await detectRuntimeStartState(input);
  }
  return latest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function detectRuntimeStartState(input: {
  graphVersion: BusinessGraphVersion;
  targetApp?: GraphTargetApp;
  platform: Platform;
  collectObservation: StartNodeObservationCollector;
  baselineReader?: PageMatcherBaselineReader;
}): Promise<RuntimeStartState> {
  const observation = await input.collectObservation();
  const pageMatch = await matchCurrentPage({
    graphVersion: input.graphVersion,
    observation,
    baselineReader: input.baselineReader
  });
  const match = pageMatch.match.status === "matched" ? pageMatch.match : detectNode(pageMatch.observation, input.graphVersion, input.platform);
  const inTargetApp = isObservationInTargetApp(observation, input.targetApp, input.platform);
  const nodeId = match.status === "matched" && inTargetApp ? match.node?.id : undefined;
  return {
    nodeId,
    match,
    observation: pageMatch.observation,
    inTargetApp,
    reason: classifyRuntimeStartState({ match, inTargetApp })
  };
}

export function classifyRuntimeStartState(input: { match: NodeMatchResult; inTargetApp: boolean }): RuntimeStartStateReason {
  if (!input.inTargetApp) {
    return "outside_target_app";
  }
  if (input.match.status === "matched") {
    if (isBlockingStateNode(input.match.node)) {
      return "blocking_state";
    }
    if (isLoginRequiredNode(input.match.node)) {
      return "login_required";
    }
    return "matched_graph_node";
  }
  if (input.match.status === "multiple_candidates") {
    return "multiple_candidates";
  }
  const hasLowConfidenceCandidate = input.match.candidates.some((candidate) => candidate.score >= input.match.threshold && candidate.quality.status === "low_confidence");
  return hasLowConfidenceCandidate ? "low_confidence_graph_state" : "unknown_app_state";
}

export function isObservationInTargetApp(observation: Observation, targetApp: GraphTargetApp | undefined, platform: Platform): boolean {
  if (platform === "android" && targetApp?.androidPackageName) {
    return observation.packageName === targetApp.androidPackageName;
  }
  if (platform === "ios" && targetApp?.iosBundleId) {
    return observation.bundleId === targetApp.iosBundleId;
  }
  return true;
}

export function rootNodeId(graphVersion: BusinessGraphVersion, platform: Platform): string | undefined {
  return graphVersion.nodes.find((node) => node.status === "active" && node.nodeType === "root" && (node.platformScope === "mobile-both" || node.platformScope === platform))?.id;
}

export function shouldRecordMatchedStartState(reason: RuntimeStartStateReason): boolean {
  return reason === "login_required" || reason === "blocking_state";
}

function canReachTarget(
  input: {
    graphVersion: BusinessGraphVersion;
    appId: string;
    targetApp?: GraphTargetApp;
    platform: Platform;
    targetNodeId: string;
    strategy?: RouteStrategy;
  },
  startNodeId: string
): boolean {
  const routePlan = planRoute({
    graphVersion: input.graphVersion,
    appId: input.appId,
    targetApp: input.targetApp,
    targetNodeId: input.targetNodeId,
    startNodeId,
    platform: input.platform,
    strategy: input.strategy
  });
  return !routePlan.unresolvedIssues.some((issue) => issue.severity === "error");
}

function canBackRecoverStartState(graphVersion: BusinessGraphVersion, state: RuntimeStartState, platform: Platform): boolean {
  return (
    state.inTargetApp &&
    state.reason === "matched_graph_node" &&
    Boolean(state.nodeId) &&
    !isRootNode(graphVersion, state.nodeId, platform) &&
    !isNonRecoverableNode(state.match?.node)
  );
}

function isRootNode(graphVersion: BusinessGraphVersion, nodeId: string | undefined, platform: Platform): boolean {
  if (!nodeId) {
    return false;
  }
  return rootNodeId(graphVersion, platform) === nodeId;
}

function isNonRecoverableNode(node: NodeMatchResult["node"]): boolean {
  if (hasAnyNodeTag(node, ["start:no_back_recovery", "route:no_back_recovery", "no_back_recovery", "root", "home", "bottom-tab"])) {
    return true;
  }
  const nodeKey = node?.key.trim().toLowerCase();
  const nodeName = node?.name.trim().toLowerCase();
  return isHomeTabLikeNode(nodeKey, nodeName);
}

function isHomeTabLikeNode(nodeKey: string | undefined, nodeName: string | undefined): boolean {
  if (nodeKey === "home" || nodeKey === "homepage" || nodeName === "主页" || nodeName === "首页") {
    return true;
  }
  const tabNames = new Set(["消息", "待办", "课程表", "空间", "控件", "成长"]);
  if (nodeName && tabNames.has(nodeName)) {
    return true;
  }
  return Boolean(nodeKey && /\.(message|todo|schedule|space|growth)$/.test(nodeKey));
}

function isLoginRequiredNode(node: NodeMatchResult["node"]): boolean {
  return hasAnyNodeTag(node, ["auth:login_required", "login_required", "requires_login", "unauthenticated"]);
}

function isBlockingStateNode(node: NodeMatchResult["node"]): boolean {
  return hasAnyNodeTag(node, ["runtime:blocking", "blocking_state", "blocking", "blocker"]);
}

function hasAnyNodeTag(node: NodeMatchResult["node"], tags: string[]): boolean {
  if (!node) {
    return false;
  }
  const normalized = new Set(node.tags.map((tag) => tag.trim().toLowerCase()));
  return tags.some((tag) => normalized.has(tag));
}
