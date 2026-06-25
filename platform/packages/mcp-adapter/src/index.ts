import type { ArtifactRef, Platform, TestRun } from "@mobile-automation/shared";

export {
  assertNoSecretInMcpToolDefinitions,
  createMobileAutomationMcpToolHandlers,
  mobileAutomationMcpTools,
  type MobileAutomationMcpToolDefinition,
  type MobileAutomationMcpToolHandler,
  type MobileAutomationMcpToolName
} from "./mcp-wrapper.js";

export type McpAdapterConfig = {
  serverUrl?: string;
  fetch?: typeof fetch;
};

export type TargetNodeTestInput = {
  deviceSerial: string;
  graphId?: string;
  graphVersionId?: string;
  targetNodeId?: string;
  target?: {
    nodeId?: string;
    key?: string;
    name?: string;
    text?: string;
    intent?: string;
    tags?: string[];
    includeDraft?: boolean;
    maxCandidates?: number;
  };
  startNodeId?: string;
  platform?: Platform;
  strategy?: "shortest" | "most_stable" | "smoke" | "performance";
  startStrategy?: "keep_current" | "go_home" | "launch_app" | "restart_app" | "clear_data_and_launch";
  stopOnFailure?: boolean;
  overlay?: Record<string, unknown>;
};

export type GraphNodeSummary = {
  id: string;
  key: string;
  name: string;
  nodeType?: string;
  status?: string;
  platformScope?: string;
  tags?: string[];
};

export type GraphRunToolResult = {
  runId: string;
  status: string;
  active?: boolean;
  reportUrl?: string;
  targetNodeId?: string;
  targetNodeName?: string;
  route?: Array<Record<string, unknown>>;
  failedAt?: unknown;
  failureEvidence?: ArtifactRef[];
  evidence?: unknown;
  actual?: unknown;
};

export type GraphQualityToolResult = {
  graphVersionId: string;
  analyzedRunCount: number;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

const defaultServerUrl = "http://localhost:4010";

export class MobileAutomationMcpAdapter {
  private readonly serverUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: McpAdapterConfig = {}) {
    this.serverUrl = (config.serverUrl ?? defaultServerUrl).replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? fetch;
  }

  async listApps(): Promise<Array<{ appId: string; graphId: string; name: string; platformScope?: string; activeVersionId?: string }>> {
    const payload = await this.request<{ graphs?: Array<Record<string, unknown>> }>("GET", "/api/graphs");
    return (payload.graphs ?? []).map((graph) => ({
      appId: stringValue(graph.appId),
      graphId: stringValue(graph.id),
      name: stringValue(graph.name),
      platformScope: optionalString(graph.platformScope),
      activeVersionId: optionalString(graph.activeVersionId)
    })).filter((item) => item.appId && item.graphId);
  }

  async listGraphNodes(input: { graphId?: string; graphVersionId?: string; platform?: Platform } = {}): Promise<GraphNodeSummary[]> {
    const graphVersion = await this.resolveGraphVersion(input);
    return readArray(graphVersion.nodes).map((node) => toGraphNodeSummary(node)).filter((node) => node.id && node.key);
  }

  async getNodeDetail(input: { graphId?: string; graphVersionId?: string; nodeId?: string; key?: string; name?: string; platform?: Platform }): Promise<Record<string, unknown>> {
    const graphVersion = await this.resolveGraphVersion(input);
    const nodes = readArray(graphVersion.nodes);
    const node = nodes.find((item) => matchesNodeQuery(item, input));
    if (!node) {
      throw new Error("Business graph node not found");
    }
    const edges = readArray(graphVersion.edges).filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id);
    return {
      graphVersionId: stringValue(graphVersion.id),
      node,
      incomingEdges: edges.filter((edge) => edge.toNodeId === node.id),
      outgoingEdges: edges.filter((edge) => edge.fromNodeId === node.id)
    };
  }

  async triggerNodeTest(input: TargetNodeTestInput): Promise<GraphRunToolResult> {
    const payload = await this.request<Record<string, unknown>>("POST", "/api/graph-runs", compactObject(input));
    const result = readObject(payload.nodeTestResult);
    if (Object.keys(result).length) {
      return toGraphRunToolResult(this.serverUrl, result);
    }
    const run = readObject(payload.run);
    return {
      runId: stringValue(run.id),
      status: stringValue(run.status),
      active: booleanValue(payload.active),
      targetNodeId: optionalString(payload.targetNodeId),
      targetNodeName: readTargetName(payload.targetResolution),
      reportUrl: run.reportHtmlPath ? `${this.serverUrl}/artifacts/${String(run.reportHtmlPath)}` : undefined
    };
  }

  async getRunStatus(input: { runId: string }): Promise<GraphRunToolResult> {
    const payload = await this.request<Record<string, unknown>>("GET", `/api/graph-runs/${encodeURIComponent(input.runId)}`);
    const result = readObject(payload.nodeTestResult);
    if (Object.keys(result).length) {
      return toGraphRunToolResult(this.serverUrl, result);
    }
    const graphRun = readObject(payload.graphRun);
    return {
      runId: stringValue(graphRun.id),
      status: stringValue(graphRun.status),
      active: booleanValue(graphRun.active),
      reportUrl: absoluteUrl(this.serverUrl, optionalString(graphRun.reportUrl)),
      targetNodeId: optionalString(graphRun.targetNodeId),
      targetNodeName: optionalString(graphRun.targetNodeName),
      failedAt: graphRun.failedAt,
      failureEvidence: readArray(graphRun.failureEvidence) as ArtifactRef[]
    };
  }

  async getReport(input: { runId: string }): Promise<{ runId: string; reportUrl?: string; ready: boolean }> {
    const status = await this.getRunStatus(input);
    return {
      runId: status.runId,
      reportUrl: status.reportUrl,
      ready: Boolean(status.reportUrl)
    };
  }

  async getFailureEvidence(input: { runId: string }): Promise<{ runId: string; failedAt?: unknown; artifacts: ArtifactRef[] }> {
    const payload = await this.request<Record<string, unknown>>("GET", `/api/graph-runs/${encodeURIComponent(input.runId)}`);
    const graphRun = readObject(payload.graphRun);
    return {
      runId: stringValue(graphRun.id),
      failedAt: graphRun.failedAt,
      artifacts: readArray(graphRun.failureEvidence) as ArtifactRef[]
    };
  }

  async getGraphQuality(input: { graphVersionId: string; limit?: number }): Promise<GraphQualityToolResult> {
    const limit = Number.isFinite(input.limit) ? `?limit=${encodeURIComponent(String(input.limit))}` : "";
    const payload = await this.request<Record<string, unknown>>("GET", `/api/graphs/${encodeURIComponent(input.graphVersionId)}/quality${limit}`);
    const quality = readObject(payload.quality);
    return {
      graphVersionId: stringValue(quality.graphVersionId),
      analyzedRunCount: numberValue(quality.analyzedRunCount),
      nodes: readArray(quality.nodes),
      edges: readArray(quality.edges)
    };
  }

  private async resolveGraphVersion(input: { graphId?: string; graphVersionId?: string }): Promise<Record<string, unknown>> {
    if (input.graphVersionId) {
      const graphsPayload = await this.request<{ graphs?: Array<Record<string, unknown>> }>("GET", "/api/graphs");
      const versions = (graphsPayload.graphs ?? []).map((graph) => readObject(graph.activeVersion)).filter((version) => stringValue(version.id) === input.graphVersionId);
      if (versions[0]) {
        return versions[0];
      }
      throw new Error(`Active graph version not found: ${input.graphVersionId}`);
    }
    const graphsPayload = await this.request<{ graphs?: Array<Record<string, unknown>> }>("GET", "/api/graphs");
    const graph = (graphsPayload.graphs ?? []).find((item) => input.graphId ? item.id === input.graphId : Boolean(item.activeVersion));
    const version = readObject(graph?.activeVersion);
    if (!graph || !Object.keys(version).length) {
      throw new Error(input.graphId ? `Active graph not found: ${input.graphId}` : "No active business graph is available");
    }
    return version;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.serverUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return payload as T;
  }
}

export function createMobileAutomationMcpAdapter(config?: McpAdapterConfig): MobileAutomationMcpAdapter {
  return new MobileAutomationMcpAdapter(config);
}

function toGraphRunToolResult(serverUrl: string, result: Record<string, unknown>): GraphRunToolResult {
  const evidence = readObject(result.evidence);
  const route = readArray(result.route);
  const failureEvidence = readUrlArtifacts(evidence.failureArtifacts);
  return compactObject({
    runId: stringValue(result.runId),
    status: stringValue(result.status),
    active: booleanValue(result.active),
    reportUrl: absoluteUrl(serverUrl, optionalString(result.reportUrl)),
    targetNodeId: optionalString(result.targetNodeId),
    targetNodeName: optionalString(result.targetNodeName),
    route: route.length ? route : undefined,
    failedAt: result.failedAt,
    failureEvidence: failureEvidence.length ? failureEvidence : undefined,
    evidence: result.evidence,
    actual: result.actual
  }) as GraphRunToolResult;
}

function readUrlArtifacts(value: unknown): ArtifactRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((url, index) => ({
    id: `failure-${index + 1}`,
    type: "screenshot",
    name: url.split("/").pop() || url,
    path: url,
    url,
    createdAt: ""
  }));
}

function toGraphNodeSummary(node: Record<string, unknown>): GraphNodeSummary {
  return {
    id: stringValue(node.id),
    key: stringValue(node.key),
    name: stringValue(node.name),
    nodeType: optionalString(node.nodeType),
    status: optionalString(node.status),
    platformScope: optionalString(node.platformScope),
    tags: Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === "string") : undefined
  };
}

function matchesNodeQuery(node: Record<string, unknown>, query: { nodeId?: string; key?: string; name?: string }): boolean {
  if (query.nodeId && node.id !== query.nodeId) {
    return false;
  }
  if (query.key && node.key !== query.key) {
    return false;
  }
  if (query.name && node.name !== query.name) {
    return false;
  }
  return Boolean(query.nodeId || query.key || query.name);
}

function readTargetName(value: unknown): string | undefined {
  const resolution = readObject(value);
  const targetNode = readObject(resolution.targetNode);
  return optionalString(targetNode.name);
}

function absoluteUrl(serverUrl: string, pathOrUrl: string | undefined): string | undefined {
  if (!pathOrUrl) {
    return undefined;
  }
  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `${serverUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function readArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)) : [];
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text ? text : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
