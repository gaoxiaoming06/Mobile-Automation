import type { ArtifactRef, ScriptFlow, TestRun } from "@mobile-automation/shared";

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

export type PageAssetApp = {
  appId: string;
  name: string;
  platformScope?: string;
  activeVersionId?: string;
};

export type PageAssetSummary = {
  id: string;
  key: string;
  name: string;
  platformScope?: string;
  identityTexts: string[];
  elementCount: number;
};

export type ScriptFlowRunResult = {
  runId: string;
  status: TestRun["status"];
  reportUrl?: string;
  failedSteps: Array<{ stepId: string; message?: string }>;
  failureEvidence: ArtifactRef[];
};

export type ScriptFlowPreviewResult = {
  planDigest: string;
  plan: Record<string, unknown>;
  dependencies: Array<{ flowId: string; version: number; sourceHash: string }>;
};

const defaultServerUrl = "http://localhost:4010";

export class MobileAutomationMcpAdapter {
  private readonly serverUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: McpAdapterConfig = {}) {
    this.serverUrl = (config.serverUrl ?? defaultServerUrl).replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? fetch;
  }

  async listApps(): Promise<PageAssetApp[]> {
    const libraries = await this.listLibraries();
    return libraries.map((library) => ({
      appId: stringValue(library.appId),
      name: stringValue(library.name),
      platformScope: optionalString(library.platformScope),
      activeVersionId: optionalString(readObject(library.activeVersion).id)
    })).filter((app) => app.appId && app.activeVersionId);
  }

  async listPageAssets(input: { appId?: string; platform?: string } = {}): Promise<PageAssetSummary[]> {
    const libraries = (await this.listLibraries()).filter((library) => {
      if (input.appId && library.appId !== input.appId) return false;
      const scope = optionalString(library.platformScope);
      return !input.platform || !scope || scope === "mobile-both" || scope === input.platform;
    });
    const summaries = await Promise.all(libraries.map(async (library) => {
      const versionId = optionalString(readObject(library.activeVersion).id);
      if (!versionId) return [];
      const payload = await this.request<Record<string, unknown>>("GET", `/api/page-assets/${encodeURIComponent(versionId)}/assets`);
      return readArray(readObject(payload.assets).pageAssets).map(toPageAssetSummary);
    }));
    return summaries.flat();
  }

  async getPageAsset(input: { appId?: string; page: string; platform?: string }): Promise<PageAssetSummary> {
    const assets = await this.listPageAssets(input);
    const page = assets.find((asset) => asset.id === input.page || asset.key === input.page || asset.name === input.page);
    if (!page) throw new Error(`Page asset not found: ${input.page}`);
    return page;
  }

  async listScriptFlows(input: { appId?: string; platform?: string; status?: ScriptFlow["status"] } = {}): Promise<ScriptFlow[]> {
    const query = queryString(input);
    const payload = await this.request<{ flows?: ScriptFlow[] }>("GET", `/api/script-flows${query}`);
    return payload.flows ?? [];
  }

  async getScriptFlow(input: { flowId: string }): Promise<ScriptFlow> {
    const payload = await this.request<{ flow: ScriptFlow }>("GET", `/api/script-flows/${encodeURIComponent(input.flowId)}`);
    return payload.flow;
  }

  async generateScriptFlow(input: { prompt: string; appId: string; platform: string }): Promise<unknown> {
    const payload = await this.request<Record<string, unknown>>("POST", "/api/script-flow-drafts/generate", input);
    return payload.draft;
  }

  async previewScriptFlow(input: {
    flowId: string;
    expectedVersion: number;
    parameters?: Record<string, string | number | boolean>;
  }): Promise<ScriptFlowPreviewResult> {
    return this.request<ScriptFlowPreviewResult>(
      "POST",
      `/api/script-flows/${encodeURIComponent(input.flowId)}/preview`,
      compactObject({ expectedVersion: input.expectedVersion, parameters: input.parameters })
    );
  }

  async runScriptFlow(input: {
    flowId: string;
    expectedVersion: number;
    planDigest: string;
    deviceSerial: string;
    parameters?: Record<string, string | number | boolean>;
    confirmedRiskSteps?: string[];
  }): Promise<ScriptFlowRunResult> {
    const payload = await this.request<{ run: TestRun }>(
      "POST",
      `/api/script-flows/${encodeURIComponent(input.flowId)}/runs`,
      compactObject({ expectedVersion: input.expectedVersion, planDigest: input.planDigest, deviceSerial: input.deviceSerial, parameters: input.parameters, confirmedRiskSteps: input.confirmedRiskSteps })
    );
    return runResult(this.serverUrl, payload.run);
  }

  async getRun(input: { runId: string }): Promise<ScriptFlowRunResult> {
    const payload = await this.request<{ run: TestRun }>("GET", `/api/runs/${encodeURIComponent(input.runId)}`);
    if (payload.run.sourceSnapshot?.kind !== "script_flow") throw new Error("Run is not a ScriptFlow run");
    return runResult(this.serverUrl, payload.run);
  }

  async getReport(input: { runId: string }): Promise<{ runId: string; reportUrl?: string; ready: boolean }> {
    const run = await this.getRun(input);
    return { runId: run.runId, reportUrl: run.reportUrl, ready: Boolean(run.reportUrl) };
  }

  private async listLibraries(): Promise<Array<Record<string, unknown>>> {
    const payload = await this.request<{ libraries: Array<Record<string, unknown>> }>("GET", "/api/page-assets");
    return payload.libraries;
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

function toPageAssetSummary(value: Record<string, unknown>): PageAssetSummary {
  return {
    id: stringValue(value.id),
    key: stringValue(value.key),
    name: stringValue(value.name),
    platformScope: optionalString(value.platformScope),
    identityTexts: stringArray(value.identityTexts),
    elementCount: numberValue(value.elementCount)
  };
}

function runResult(serverUrl: string, run: TestRun): ScriptFlowRunResult {
  return {
    runId: run.id,
    status: run.status,
    reportUrl: run.reportHtmlPath ? `${serverUrl}/api/reports/${encodeURIComponent(run.id)}/html` : undefined,
    failedSteps: run.stepResults.filter((step) => step.status === "failed" || step.status === "timeout").map((step) => ({ stepId: step.stepId, message: step.errorMessage })),
    failureEvidence: run.artifacts.filter((artifact) => artifact.type === "screenshot" && !artifact.deletedAt)
  };
}

function queryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function readArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value).trim() || undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
