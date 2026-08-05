import type { ArtifactRef, DeviceInfo, DeviceStatus, ScriptFlow, TestRun } from "@mobile-automation/shared";
import { isDevicePlatform, scriptFlowAuthoringContract, type DevicePlatform, type ScriptFlowAuthoringContract, type ScriptPlatform } from "./script-flow-contract.js";

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

export type DevicePreflightErrorCode =
  | "DEVICE_NOT_CONNECTED"
  | "DEVICE_OFFLINE"
  | "DEVICE_PLATFORM_MISMATCH"
  | "DEVICE_SELECTION_REQUIRED"
  | "PLATFORM_NOT_SUPPORTED_BY_RUNTIME";

export type DevicePreflightFailure = {
  ok: false;
  error: {
    code: DevicePreflightErrorCode;
    message: string;
    devicePlatform?: DevicePlatform;
    appId?: string;
    requestedDeviceSerial?: string;
    availableDevices: DeviceInfo[];
  };
};

export type DevicePreflightSuccess = {
  ok: true;
  selectedDevice: DeviceInfo;
};

export type DevicePreflightResult = DevicePreflightSuccess | DevicePreflightFailure;

export type ScriptFlowPreviewResult = {
  planDigest: string;
  plan: Record<string, unknown>;
  dependencies: Array<{ flowId: string; version: number; sourceHash: string }>;
};

export type ScriptFlowExternalContext = {
  source: "code" | "directory" | "classin-code" | "manual";
  summary: string;
  implementationStack?: "android-native" | "ios-native" | "harmony-native" | "flutter" | "compose" | "swiftui" | "arkui" | "unknown";
  relevantFiles?: string[];
  candidateSteps?: string[];
  constraints?: string[];
};

export type ScriptFlowResponseMode = "compact" | "evidence" | "full";

export type ScriptFlowReportResult = Omit<ScriptFlowRunResult, "failureEvidence"> & {
  responseMode: ScriptFlowResponseMode;
  finalScreenshotUrl?: string;
  failure?: unknown;
  events?: TestRun["events"];
  artifactUrls?: string[];
  failureEvidence?: ArtifactRef[];
  outcomeReviewRequired: boolean;
  nextAction?: "caller_review_required";
};

export type PreviousScriptFlowRunResult = ScriptFlowReportResult & {
  sourceRunId: string;
  sourcePlanDigest?: string;
  planDigest: string;
};

const defaultServerUrl = "http://127.0.0.1:4010";
const terminalRunStatuses = new Set<TestRun["status"]>(["passed", "failed", "stopped", "timeout", "device_lost"]);
const requiredExecutionCapabilities = ["screenshot", "tap", "launchApp"] as const;

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

  getScriptFlowAuthoringContract(_input: { scriptPlatform?: ScriptPlatform; platform?: ScriptPlatform } = {}): ScriptFlowAuthoringContract {
    return scriptFlowAuthoringContract();
  }

  async listDevices(input: { devicePlatform?: DevicePlatform; platform?: DevicePlatform; status?: DeviceStatus } = {}): Promise<DeviceInfo[]> {
    const payload = await this.request<{ devices?: DeviceInfo[] }>("GET", "/api/devices");
    const devicePlatform = input.devicePlatform ?? input.platform;
    return (payload.devices ?? []).filter((device) =>
      (!devicePlatform || device.platform === devicePlatform)
      && (!input.status || device.status === input.status)
    );
  }

  async validateDevice(input: { devicePlatform?: DevicePlatform; appId?: string; deviceSerial?: string }): Promise<DevicePreflightResult> {
    const devicePlatform = input.devicePlatform;
    const devices = await this.listDevices();
    if (devicePlatform !== undefined && !isDevicePlatform(devicePlatform)) {
      return deviceFailure("PLATFORM_NOT_SUPPORTED_BY_RUNTIME", {
        message: `${String(devicePlatform)} is not a connectable device platform.`,
        appId: input.appId,
        requestedDeviceSerial: input.deviceSerial,
        availableDevices: devices
      });
    }

    if (input.deviceSerial) {
      const selected = devices.find((device) => device.serial === input.deviceSerial || device.id === input.deviceSerial);
      if (!selected) {
        return deviceFailure("DEVICE_NOT_CONNECTED", {
          message: `未发现设备 ${input.deviceSerial}，请连接设备后重试。`,
          devicePlatform,
          appId: input.appId,
          requestedDeviceSerial: input.deviceSerial,
          availableDevices: devices
        });
      }
      if (devicePlatform && selected.platform !== devicePlatform) {
        return deviceFailure("DEVICE_PLATFORM_MISMATCH", {
          message: `设备 ${input.deviceSerial} 是 ${selected.platform}，不是请求的 ${devicePlatform}。`,
          devicePlatform,
          appId: input.appId,
          requestedDeviceSerial: input.deviceSerial,
          availableDevices: [selected]
        });
      }
      if (selected.status !== "online") {
        return deviceFailure("DEVICE_OFFLINE", {
          message: `设备 ${input.deviceSerial} 当前状态为 ${selected.status}，请连接并解锁后重试。`,
          devicePlatform: selected.platform,
          appId: input.appId,
          requestedDeviceSerial: input.deviceSerial,
          availableDevices: [selected]
        });
      }
      const capabilityFailure = executionCapabilityFailure(selected, input.appId, input.deviceSerial);
      return capabilityFailure ?? { ok: true, selectedDevice: selected };
    }

    if (!devicePlatform) {
      return deviceFailure("DEVICE_SELECTION_REQUIRED", {
        message: "未指定 devicePlatform 或 deviceSerial，无法选择执行设备。",
        appId: input.appId,
        availableDevices: devices
      });
    }
    const compatible = devices.filter((device) => device.platform === devicePlatform);
    const online = compatible.filter((device) => device.status === "online");
    if (online.length === 0) {
      return deviceFailure("DEVICE_NOT_CONNECTED", {
        message: `未发现可用于 ${devicePlatform} 的在线设备，请连接设备后重试。`,
        devicePlatform,
        appId: input.appId,
        availableDevices: compatible
      });
    }
    if (online.length > 1) {
      return deviceFailure("DEVICE_SELECTION_REQUIRED", {
        message: `发现 ${online.length} 台可用于 ${devicePlatform} 的在线设备，请指定 deviceSerial。`,
        devicePlatform,
        appId: input.appId,
        availableDevices: online
      });
    }
    const selected = online[0]!;
    const capabilityFailure = executionCapabilityFailure(selected, input.appId);
    return capabilityFailure ?? { ok: true, selectedDevice: selected };
  }

  async generateScriptFlow(input: {
    prompt?: string;
    goal?: string;
    appId: string;
    platform?: ScriptPlatform;
    scriptPlatform?: ScriptPlatform;
    externalContext?: ScriptFlowExternalContext;
    screenAssist?: { mode: "current"; deviceSerial: string };
    flowId?: string;
    expectedVersion?: number;
  }): Promise<unknown | DevicePreflightFailure> {
    const prompt = input.prompt ?? input.goal;
    if (!prompt) throw new Error("prompt is required");
    if (input.screenAssist) {
      const validation = await this.validateDevice({ appId: input.appId, deviceSerial: input.screenAssist.deviceSerial });
      if (!validation.ok) return validation;
    }
    const scriptPlatform = input.scriptPlatform ?? input.platform;
    const payload = await this.request<Record<string, unknown>>(
      "POST",
      "/api/script-flow-drafts/generate",
      compactObject({
        prompt,
        appId: input.appId,
        ...(scriptPlatform ? { platform: scriptPlatform } : {}),
        externalContext: input.externalContext,
        screenAssist: input.screenAssist,
        flowId: input.flowId,
        expectedVersion: input.expectedVersion
      })
    );
    return payload.draft;
  }

  async generateScriptFlowDraft(input: Parameters<MobileAutomationMcpAdapter["generateScriptFlow"]>[0]): Promise<unknown> {
    return this.generateScriptFlow(input);
  }

  async validateScriptFlow(input: { sourceYaml: string }): Promise<unknown> {
    return this.request("POST", "/api/script-flows/validate", { sourceYaml: input.sourceYaml });
  }

  async previewScriptFlowDraft(input: {
    sourceYaml: string;
    parameters?: Record<string, string | number | boolean>;
  }): Promise<ScriptFlowPreviewResult> {
    return this.request<ScriptFlowPreviewResult>(
      "POST",
      "/api/script-flow-drafts/preview",
      compactObject({ sourceYaml: input.sourceYaml, parameters: input.parameters })
    );
  }

  async runScriptFlowDraft(input: {
    sourceYaml: string;
    planDigest: string;
    appId?: string;
    devicePlatform?: DevicePlatform;
    deviceSerial?: string;
    parameters?: Record<string, string | number | boolean>;
    executionPurpose?: "trial" | "normal";
  }): Promise<ScriptFlowRunResult | DevicePreflightFailure> {
    const validation = await this.validateDevice({ devicePlatform: input.devicePlatform, appId: input.appId, deviceSerial: input.deviceSerial });
    if (!validation.ok) return validation;
    return this.startScriptFlowDraftRun({
      sourceYaml: input.sourceYaml,
      planDigest: input.planDigest,
      deviceSerial: validation.selectedDevice.serial,
      parameters: input.parameters,
      executionPurpose: input.executionPurpose
    });
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
    devicePlatform?: DevicePlatform;
    parameters?: Record<string, string | number | boolean>;
  }): Promise<ScriptFlowRunResult | DevicePreflightFailure> {
    const validation = await this.validateDevice({ devicePlatform: input.devicePlatform, deviceSerial: input.deviceSerial });
    if (!validation.ok) return validation;
    const payload = await this.request<{ run: TestRun }>(
      "POST",
      `/api/script-flows/${encodeURIComponent(input.flowId)}/runs`,
      compactObject({ expectedVersion: input.expectedVersion, planDigest: input.planDigest, deviceSerial: validation.selectedDevice.serial, parameters: input.parameters })
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

  async waitForRun(input: { runId: string; timeoutMs?: number; pollIntervalMs?: number }): Promise<ScriptFlowRunResult> {
    const timeoutMs = input.timeoutMs ?? 120_000;
    const pollIntervalMs = input.pollIntervalMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const run = await this.getRun({ runId: input.runId });
      if (terminalRunStatuses.has(run.status)) return run;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for run ${input.runId}`);
      if (pollIntervalMs > 0) await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    }
  }

  async getRunReport(input: { runId: string; responseMode?: ScriptFlowResponseMode }): Promise<ScriptFlowReportResult> {
    const payload = await this.request<{ run: TestRun; failure?: unknown }>("GET", `/api/script-flow-runs/${encodeURIComponent(input.runId)}`);
    const learning = await this.optionalRequest<{ session?: { status?: string } }>("GET", `/api/trial-runs/${encodeURIComponent(input.runId)}/learning-summary`);
    const base = runResult(this.serverUrl, payload.run);
    const outcomeReviewRequired = learning?.session?.status === "needs_outcome_review";
    const responseMode = input.responseMode ?? "evidence";
    const screenshots = screenshotArtifacts(payload.run);
    const finalScreenshotUrl = screenshots.at(-1)?.url;
    const shared = {
      runId: base.runId,
      status: base.status,
      reportUrl: base.reportUrl,
      failedSteps: base.failedSteps,
      ...(finalScreenshotUrl ? { finalScreenshotUrl } : {}),
      outcomeReviewRequired,
      ...(outcomeReviewRequired ? { nextAction: "caller_review_required" as const } : {})
    };
    if (responseMode === "compact") {
      return {
        ...shared,
        responseMode
      };
    }
    if (responseMode === "full") {
      return {
        ...shared,
        responseMode,
        failure: payload.failure,
        events: payload.run.events ?? [],
        artifactUrls: artifactUrls(payload.run.artifacts ?? []),
        failureEvidence: base.failureEvidence
      };
    }
    return {
      ...shared,
      responseMode,
      failure: payload.failure,
      events: abnormalEvents(payload.run),
      artifactUrls: evidenceArtifactUrls(payload.run)
    };
  }

  async generateAndRunScriptFlow(input: {
    goal: string;
    appId: string;
    scriptPlatform: ScriptPlatform;
    devicePlatform: DevicePlatform;
    deviceSerial?: string;
    parameters?: Record<string, string | number | boolean>;
    externalContext?: ScriptFlowExternalContext;
    screenAssist?: { mode: "current"; deviceSerial: string };
    responseMode?: ScriptFlowResponseMode;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<unknown> {
    const validation = await this.validateDevice({ devicePlatform: input.devicePlatform, appId: input.appId, deviceSerial: input.deviceSerial });
    if (!validation.ok) return validation;
    const draft = await this.generateScriptFlow({
      prompt: input.goal,
      appId: input.appId,
      scriptPlatform: input.scriptPlatform,
      externalContext: input.externalContext,
      screenAssist: input.screenAssist
    }) as Record<string, unknown>;
    if (draft.status === "needs_clarification") return draft;
    const sourceYaml = stringValue(draft.sourceYaml);
    if (!sourceYaml) throw new Error("Generated draft did not include sourceYaml");
    const preview = await this.previewScriptFlowDraft({ sourceYaml, parameters: input.parameters });
    const run = await this.startScriptFlowDraftRun({
      sourceYaml,
      planDigest: preview.planDigest,
      deviceSerial: validation.selectedDevice.serial,
      parameters: input.parameters,
      executionPurpose: "trial"
    });
    await this.waitForRun({ runId: run.runId, timeoutMs: input.timeoutMs, pollIntervalMs: input.pollIntervalMs });
    return this.getRunReport({ runId: run.runId, responseMode: input.responseMode });
  }

  async runPreviousScriptFlow(input: {
    sourceRunId: string;
    appId?: string;
    devicePlatform?: DevicePlatform;
    deviceSerial?: string;
    parameters?: Record<string, string | number | boolean>;
    executionPurpose?: "trial" | "normal";
    responseMode?: ScriptFlowResponseMode;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<PreviousScriptFlowRunResult | DevicePreflightFailure> {
    const sourcePayload = await this.request<{ run: TestRun }>("GET", `/api/runs/${encodeURIComponent(input.sourceRunId)}`);
    const sourceSnapshot = sourcePayload.run.sourceSnapshot;
    if (sourceSnapshot?.kind !== "script_flow") {
      throw new Error(`Run ${input.sourceRunId} is not a ScriptFlow run`);
    }
    const sourceYaml = sourceSnapshot.sourceYaml;
    if (!sourceYaml) {
      throw new Error(`Run ${input.sourceRunId} does not include reusable sourceYaml`);
    }
    const appId = input.appId ?? parsedScriptFlowAppId(sourceSnapshot.parsed);
    const preview = await this.previewScriptFlowDraft({ sourceYaml, parameters: input.parameters });
    const validation = await this.validateDevice({ devicePlatform: input.devicePlatform, appId, deviceSerial: input.deviceSerial });
    if (!validation.ok) return validation;
    const run = await this.startScriptFlowDraftRun({
      sourceYaml,
      planDigest: preview.planDigest,
      deviceSerial: validation.selectedDevice.serial,
      parameters: input.parameters,
      executionPurpose: input.executionPurpose
    });
    await this.waitForRun({ runId: run.runId, timeoutMs: input.timeoutMs, pollIntervalMs: input.pollIntervalMs });
    const report = await this.getRunReport({ runId: run.runId, responseMode: input.responseMode });
    return {
      ...report,
      sourceRunId: input.sourceRunId,
      sourcePlanDigest: sourceSnapshot.planDigest,
      planDigest: preview.planDigest
    };
  }

  async reviewTrialOutcome(input: { runId: string; decision: "confirmed" | "rejected" }): Promise<unknown> {
    return this.request("POST", `/api/trial-runs/${encodeURIComponent(input.runId)}/outcome-review`, { decision: input.decision });
  }

  private async listLibraries(): Promise<Array<Record<string, unknown>>> {
    const payload = await this.request<{ libraries: Array<Record<string, unknown>> }>("GET", "/api/page-assets");
    return payload.libraries;
  }

  private async startScriptFlowDraftRun(input: {
    sourceYaml: string;
    planDigest: string;
    deviceSerial: string;
    parameters?: Record<string, string | number | boolean>;
    executionPurpose?: "trial" | "normal";
  }): Promise<ScriptFlowRunResult> {
    const purpose = input.executionPurpose ?? "trial";
    const path = purpose === "normal" ? "/api/script-flow-drafts/runs" : "/api/script-flow-drafts/trial-runs";
    const payload = await this.request<{ run: TestRun }>(
      "POST",
      path,
      compactObject({ sourceYaml: input.sourceYaml, planDigest: input.planDigest, deviceSerial: input.deviceSerial, parameters: input.parameters })
    );
    return runResult(this.serverUrl, payload.run);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw new Error(`Failed to reach Mobile Automation REST at ${url}: ${networkErrorMessage(error)}`);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : response.statusText;
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    return payload as T;
  }

  private async optionalRequest<T>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T | undefined> {
    try {
      return await this.request<T>(method, path, body);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("HTTP 404:")) return undefined;
      throw error;
    }
  }
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    return [error.message, causeMessage].filter(Boolean).join("; ");
  }
  return String(error);
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
    failedSteps: (run.stepResults ?? []).filter((step) => step.status === "failed" || step.status === "timeout").map((step) => ({ stepId: step.stepId, message: step.errorMessage })),
    failureEvidence: (run.artifacts ?? []).filter((artifact) => artifact.type === "screenshot" && !artifact.deletedAt)
  };
}

function screenshotArtifacts(run: TestRun): ArtifactRef[] {
  return (run.artifacts ?? []).filter((artifact) => artifact.type === "screenshot" && !artifact.deletedAt && Boolean(artifact.url));
}

function artifactUrls(artifacts: ArtifactRef[]): string[] {
  return uniqueStrings(artifacts.map((artifact) => artifact.url).filter((url): url is string => typeof url === "string" && url.length > 0));
}

function abnormalEvents(run: TestRun): TestRun["events"] {
  return (run.events ?? []).filter((event) => event.severity !== "info");
}

function evidenceArtifactUrls(run: TestRun): string[] {
  const artifacts = run.artifacts ?? [];
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const evidence: ArtifactRef[] = [];
  for (const step of run.stepResults ?? []) {
    if (step.status !== "failed" && step.status !== "timeout") continue;
    for (const artifact of step.artifacts ?? []) evidence.push(artifact);
    if (step.afterScreenshotId) {
      const artifact = byId.get(step.afterScreenshotId);
      if (artifact) evidence.push(artifact);
    }
  }
  for (const event of abnormalEvents(run)) {
    for (const artifactId of event.artifactIds ?? []) {
      const artifact = byId.get(artifactId);
      if (artifact) evidence.push(artifact);
    }
  }
  const finalScreenshot = screenshotArtifacts(run).at(-1);
  if (finalScreenshot) evidence.push(finalScreenshot);
  return artifactUrls(evidence);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function deviceFailure(code: DevicePreflightErrorCode, input: {
  message: string;
  devicePlatform?: DevicePlatform;
  appId?: string;
  requestedDeviceSerial?: string;
  availableDevices: DeviceInfo[];
}): DevicePreflightFailure {
  return {
    ok: false,
    error: {
      code,
      message: input.message,
      ...(input.devicePlatform ? { devicePlatform: input.devicePlatform } : {}),
      ...(input.appId ? { appId: input.appId } : {}),
      ...(input.requestedDeviceSerial ? { requestedDeviceSerial: input.requestedDeviceSerial } : {}),
      availableDevices: input.availableDevices
    }
  };
}

function executionCapabilityFailure(device: DeviceInfo, appId?: string, requestedDeviceSerial?: string): DevicePreflightFailure | undefined {
  const missing = requiredExecutionCapabilities.filter((capability) => device.capabilities[capability] !== true);
  if (missing.length === 0) return undefined;
  return deviceFailure("PLATFORM_NOT_SUPPORTED_BY_RUNTIME", {
    message: `设备 ${device.serial} 缺少执行能力：${missing.join(", ")}。`,
    devicePlatform: device.platform,
    appId,
    requestedDeviceSerial,
    availableDevices: [device]
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function parsedScriptFlowAppId(parsed: Record<string, unknown> | undefined): string | undefined {
  const app = readObject(parsed?.app);
  return optionalString(app.id);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
