import { MobileAutomationMcpAdapter, type McpAdapterConfig, type ScriptFlowResponseMode } from "./index.js";

type JsonSchema = Record<string, unknown>;

export type MobileAutomationMcpToolName =
  | "get_script_flow_authoring_contract"
  | "list_devices"
  | "validate_device"
  | "list_apps"
  | "list_page_assets"
  | "get_page_asset"
  | "list_script_flows"
  | "get_script_flow"
  | "generate_script_flow"
  | "generate_script_flow_draft"
  | "validate_script_flow"
  | "preview_script_flow_draft"
  | "run_script_flow_draft"
  | "preview_script_flow"
  | "run_script_flow"
  | "wait_for_run"
  | "get_run"
  | "get_run_report"
  | "get_report"
  | "generate_and_run_script_flow"
  | "run_previous_script_flow"
  | "review_trial_outcome";

export type MobileAutomationMcpToolDefinition = {
  name: MobileAutomationMcpToolName;
  description: string;
  inputSchema: JsonSchema;
};

export type MobileAutomationMcpToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

const scriptPlatformSchema = enumSchema(["android", "ios", "harmony", "flutter", "mobile"]);
const devicePlatformSchema = enumSchema(["android", "ios", "harmony"]);
const responseModeSchema = enumSchema(["compact", "evidence", "full"]);

export const mobileAutomationMcpTools: MobileAutomationMcpToolDefinition[] = [
  {
    name: "get_script_flow_authoring_contract",
    description: "Return the ScriptFlow v1 authoring contract, including target types, script platforms, device platforms, and execution limits.",
    inputSchema: objectSchema({ scriptPlatform: scriptPlatformSchema, platform: scriptPlatformSchema })
  },
  {
    name: "list_devices",
    description: "List connected mobile devices. devicePlatform is the real execution platform: android, ios, or harmony.",
    inputSchema: objectSchema({ devicePlatform: devicePlatformSchema, platform: devicePlatformSchema, status: enumSchema(["online", "offline", "locked", "running", "error"]) })
  },
  {
    name: "validate_device",
    description: "Select or validate an online device before real execution. Returns a structured device error instead of running when no compatible device is available.",
    inputSchema: objectSchema({ devicePlatform: devicePlatformSchema, appId: stringSchema(), deviceSerial: stringSchema() })
  },
  { name: "list_apps", description: "List apps with recorded page assets.", inputSchema: objectSchema({}) },
  {
    name: "list_page_assets",
    description: "List recorded page identities and reusable public locators for an app.",
    inputSchema: objectSchema({ appId: stringSchema(), scriptPlatform: scriptPlatformSchema, platform: scriptPlatformSchema })
  },
  {
    name: "get_page_asset",
    description: "Get one recorded page identity by id, key, or name.",
    inputSchema: objectSchema({ appId: stringSchema(), page: stringSchema(), scriptPlatform: scriptPlatformSchema, platform: scriptPlatformSchema }, ["page"])
  },
  {
    name: "list_script_flows",
    description: "List ScriptFlow use cases that can be reviewed or reused.",
    inputSchema: objectSchema({ appId: stringSchema(), scriptPlatform: scriptPlatformSchema, platform: scriptPlatformSchema, status: enumSchema(["draft", "active", "archived"]) })
  },
  {
    name: "get_script_flow",
    description: "Get a ScriptFlow document and its YAML source.",
    inputSchema: objectSchema({ flowId: stringSchema() }, ["flowId"])
  },
  {
    name: "generate_script_flow",
    description: "Compatibility alias for generate_script_flow_draft. platform means scriptPlatform for this tool.",
    inputSchema: objectSchema({ prompt: stringSchema(), appId: stringSchema(), scriptPlatform: scriptPlatformSchema, platform: scriptPlatformSchema }, ["prompt", "appId"])
  },
  {
    name: "generate_script_flow_draft",
    description: "Generate a ScriptFlow draft from natural language and summarized external context. scriptPlatform is for assets/scripts, not device selection.",
    inputSchema: objectSchema({
      prompt: stringSchema(),
      goal: stringSchema(),
      appId: stringSchema(),
      scriptPlatform: scriptPlatformSchema,
      platform: scriptPlatformSchema,
      externalContext: objectSchema({}, [], true),
      screenAssist: objectSchema({ mode: enumSchema(["current"]), deviceSerial: stringSchema() }, ["mode", "deviceSerial"])
    }, ["appId"])
  },
  {
    name: "validate_script_flow",
    description: "Validate ScriptFlow v1 YAML without running it.",
    inputSchema: objectSchema({ sourceYaml: stringSchema() }, ["sourceYaml"])
  },
  {
    name: "preview_script_flow_draft",
    description: "Compile a draft ScriptFlow YAML into an immutable preview and plan digest.",
    inputSchema: objectSchema({ sourceYaml: stringSchema(), parameters: objectSchema({}, [], true) }, ["sourceYaml"])
  },
  {
    name: "run_script_flow_draft",
    description: "Run a draft ScriptFlow after device preflight. Requires devicePlatform or a deviceSerial that resolves to an online device.",
    inputSchema: objectSchema({
      sourceYaml: stringSchema(),
      planDigest: stringSchema(),
      appId: stringSchema(),
      devicePlatform: devicePlatformSchema,
      deviceSerial: stringSchema(),
      parameters: objectSchema({}, [], true),
      executionPurpose: enumSchema(["trial", "normal"])
    }, ["sourceYaml", "planDigest"])
  },
  {
    name: "preview_script_flow",
    description: "Compile a saved ScriptFlow into an immutable preview and return its plan digest.",
    inputSchema: objectSchema({
      flowId: stringSchema(),
      expectedVersion: integerSchema(),
      parameters: objectSchema({}, [], true)
    }, ["flowId", "expectedVersion"])
  },
  {
    name: "run_script_flow",
    description: "Run a saved ScriptFlow on a device with typed parameters.",
    inputSchema: objectSchema({
      flowId: stringSchema(),
      expectedVersion: integerSchema(),
      planDigest: stringSchema(),
      deviceSerial: stringSchema(),
      devicePlatform: devicePlatformSchema,
      parameters: objectSchema({}, [], true)
    }, ["flowId", "expectedVersion", "planDigest", "deviceSerial"])
  },
  {
    name: "wait_for_run",
    description: "Poll a run until it reaches a terminal status.",
    inputSchema: objectSchema({ runId: stringSchema(), timeoutMs: integerSchema(), pollIntervalMs: integerSchema() }, ["runId"])
  },
  { name: "get_run", description: "Get ScriptFlow run status and failure evidence.", inputSchema: objectSchema({ runId: stringSchema() }, ["runId"]) },
  {
    name: "get_run_report",
    description: "Get a ScriptFlow run report. responseMode controls payload size: compact returns status and final screenshot, evidence returns key proof, full returns all events and artifact URLs.",
    inputSchema: objectSchema({ runId: stringSchema(), responseMode: responseModeSchema }, ["runId"])
  },
  { name: "get_report", description: "Get the HTML report URL for a ScriptFlow run.", inputSchema: objectSchema({ runId: stringSchema() }, ["runId"]) }
  ,
  {
    name: "generate_and_run_script_flow",
    description: "One-call external AI validation job: device preflight, generate, preview, trial run, wait, and summarize report.",
    inputSchema: objectSchema({
      goal: stringSchema(),
      appId: stringSchema(),
      scriptPlatform: scriptPlatformSchema,
      devicePlatform: devicePlatformSchema,
      deviceSerial: stringSchema(),
      parameters: objectSchema({}, [], true),
      externalContext: objectSchema({}, [], true),
      screenAssist: objectSchema({ mode: enumSchema(["current"]), deviceSerial: stringSchema() }, ["mode", "deviceSerial"]),
      responseMode: responseModeSchema,
      timeoutMs: integerSchema(),
      pollIntervalMs: integerSchema()
    }, ["goal", "appId", "scriptPlatform", "devicePlatform"])
  },
  {
    name: "run_previous_script_flow",
    description: "Reuse the exact sourceYaml from a previous ScriptFlow run on another device. This does not regenerate the script; it previews the stored YAML, runs it, waits, and returns the report summary.",
    inputSchema: objectSchema({
      sourceRunId: stringSchema(),
      appId: stringSchema(),
      devicePlatform: devicePlatformSchema,
      platform: devicePlatformSchema,
      deviceSerial: stringSchema(),
      parameters: objectSchema({}, [], true),
      executionPurpose: enumSchema(["trial", "normal"]),
      responseMode: responseModeSchema,
      timeoutMs: integerSchema(),
      pollIntervalMs: integerSchema()
    }, ["sourceRunId"])
  },
  {
    name: "review_trial_outcome",
    description: "Record the caller's explicit review decision for a trial run outcome. Never call automatically just because a run passed.",
    inputSchema: objectSchema({ runId: stringSchema(), decision: enumSchema(["confirmed", "rejected"]) }, ["runId", "decision"])
  }
];

export function createMobileAutomationMcpToolHandlers(config: McpAdapterConfig = {}): Record<MobileAutomationMcpToolName, MobileAutomationMcpToolHandler> {
  const adapter = new MobileAutomationMcpAdapter(config);
  return {
    get_script_flow_authoring_contract: async (input) => adapter.getScriptFlowAuthoringContract({ scriptPlatform: scriptPlatform(input.scriptPlatform ?? input.platform) }),
    list_devices: (input) => adapter.listDevices({ devicePlatform: devicePlatform(input.devicePlatform ?? input.platform), status: deviceStatus(input.status) }),
    validate_device: (input) => adapter.validateDevice({
      devicePlatform: devicePlatform(input.devicePlatform ?? input.platform),
      appId: optionalString(input.appId),
      deviceSerial: optionalString(input.deviceSerial)
    }),
    list_apps: () => adapter.listApps(),
    list_page_assets: (input) => adapter.listPageAssets({ appId: optionalString(input.appId), platform: optionalString(input.scriptPlatform ?? input.platform) }),
    get_page_asset: (input) => adapter.getPageAsset({ appId: optionalString(input.appId), page: requiredString(input.page, "page"), platform: optionalString(input.scriptPlatform ?? input.platform) }),
    list_script_flows: (input) => adapter.listScriptFlows({
      appId: optionalString(input.appId),
      platform: optionalString(input.scriptPlatform ?? input.platform),
      status: scriptFlowStatus(input.status)
    }),
    get_script_flow: (input) => adapter.getScriptFlow({ flowId: requiredString(input.flowId, "flowId") }),
    generate_script_flow: (input) => adapter.generateScriptFlow({
      prompt: requiredString(input.prompt, "prompt"),
      appId: requiredString(input.appId, "appId"),
      scriptPlatform: scriptPlatform(input.scriptPlatform ?? input.platform)
    }),
    generate_script_flow_draft: (input) => adapter.generateScriptFlowDraft({
      prompt: optionalString(input.prompt),
      goal: optionalString(input.goal),
      appId: requiredString(input.appId, "appId"),
      scriptPlatform: scriptPlatform(input.scriptPlatform ?? input.platform),
      externalContext: objectRecord(input.externalContext),
      screenAssist: screenAssist(input.screenAssist)
    }),
    validate_script_flow: (input) => adapter.validateScriptFlow({ sourceYaml: requiredString(input.sourceYaml, "sourceYaml") }),
    preview_script_flow_draft: (input) => adapter.previewScriptFlowDraft({
      sourceYaml: requiredString(input.sourceYaml, "sourceYaml"),
      parameters: scalarRecord(input.parameters)
    }),
    run_script_flow_draft: (input) => adapter.runScriptFlowDraft({
      sourceYaml: requiredString(input.sourceYaml, "sourceYaml"),
      planDigest: requiredString(input.planDigest, "planDigest"),
      appId: optionalString(input.appId),
      devicePlatform: devicePlatform(input.devicePlatform ?? input.platform),
      deviceSerial: optionalString(input.deviceSerial),
      parameters: scalarRecord(input.parameters),
      executionPurpose: executionPurpose(input.executionPurpose)
    }),
    preview_script_flow: (input) => adapter.previewScriptFlow({
      flowId: requiredString(input.flowId, "flowId"),
      expectedVersion: positiveInteger(input.expectedVersion, "expectedVersion"),
      parameters: scalarRecord(input.parameters)
    }),
    run_script_flow: (input) => adapter.runScriptFlow({
      flowId: requiredString(input.flowId, "flowId"),
      expectedVersion: positiveInteger(input.expectedVersion, "expectedVersion"),
      planDigest: requiredString(input.planDigest, "planDigest"),
      deviceSerial: requiredString(input.deviceSerial, "deviceSerial"),
      devicePlatform: devicePlatform(input.devicePlatform ?? input.platform),
      parameters: scalarRecord(input.parameters)
    }),
    wait_for_run: (input) => adapter.waitForRun({
      runId: requiredString(input.runId, "runId"),
      timeoutMs: optionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      pollIntervalMs: optionalNonNegativeInteger(input.pollIntervalMs, "pollIntervalMs")
    }),
    get_run: (input) => adapter.getRun({ runId: requiredString(input.runId, "runId") }),
    get_run_report: (input) => adapter.getRunReport({
      runId: requiredString(input.runId, "runId"),
      responseMode: responseMode(input.responseMode)
    }),
    get_report: (input) => adapter.getReport({ runId: requiredString(input.runId, "runId") }),
    generate_and_run_script_flow: (input) => adapter.generateAndRunScriptFlow({
      goal: requiredString(input.goal, "goal"),
      appId: requiredString(input.appId, "appId"),
      scriptPlatform: requiredScriptPlatform(input.scriptPlatform ?? input.platform),
      devicePlatform: requiredDevicePlatform(input.devicePlatform),
      deviceSerial: optionalString(input.deviceSerial),
      parameters: scalarRecord(input.parameters),
      externalContext: objectRecord(input.externalContext),
      screenAssist: screenAssist(input.screenAssist),
      responseMode: responseMode(input.responseMode),
      timeoutMs: optionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      pollIntervalMs: optionalNonNegativeInteger(input.pollIntervalMs, "pollIntervalMs")
    }),
    run_previous_script_flow: (input) => adapter.runPreviousScriptFlow({
      sourceRunId: requiredString(input.sourceRunId, "sourceRunId"),
      appId: optionalString(input.appId),
      devicePlatform: devicePlatform(input.devicePlatform ?? input.platform),
      deviceSerial: optionalString(input.deviceSerial),
      parameters: scalarRecord(input.parameters),
      executionPurpose: executionPurpose(input.executionPurpose),
      responseMode: responseMode(input.responseMode),
      timeoutMs: optionalPositiveInteger(input.timeoutMs, "timeoutMs"),
      pollIntervalMs: optionalNonNegativeInteger(input.pollIntervalMs, "pollIntervalMs")
    }),
    review_trial_outcome: (input) => adapter.reviewTrialOutcome({
      runId: requiredString(input.runId, "runId"),
      decision: reviewDecision(input.decision)
    })
  };
}

export function assertNoSecretInMcpToolDefinitions(tools: MobileAutomationMcpToolDefinition[] = mobileAutomationMcpTools): void {
  const serialized = JSON.stringify(tools).toLowerCase();
  for (const forbidden of ["token", "secret", "password", "credential", "apikey", "api_key"]) {
    if (serialized.includes(forbidden)) throw new Error(`MCP tool definitions must not expose secret-like field: ${forbidden}`);
  }
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = [], additionalProperties = false): JsonSchema {
  return { type: "object", properties, required, additionalProperties };
}

function stringSchema(): JsonSchema {
  return { type: "string" };
}

function integerSchema(): JsonSchema {
  return { type: "integer", minimum: 1 };
}

function enumSchema(values: string[]): JsonSchema {
  return { type: "string", enum: values };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`);
  return value;
}

function scriptFlowStatus(value: unknown): "draft" | "active" | "archived" | undefined {
  return value === "draft" || value === "active" || value === "archived" ? value : undefined;
}

function deviceStatus(value: unknown): "online" | "offline" | "locked" | "running" | "error" | undefined {
  return value === "online" || value === "offline" || value === "locked" || value === "running" || value === "error" ? value : undefined;
}

function scriptPlatform(value: unknown): "android" | "ios" | "harmony" | "flutter" | "mobile" | undefined {
  return value === "android" || value === "ios" || value === "harmony" || value === "flutter" || value === "mobile" ? value : undefined;
}

function requiredScriptPlatform(value: unknown): "android" | "ios" | "harmony" | "flutter" | "mobile" {
  const platform = scriptPlatform(value);
  if (!platform) throw new Error("scriptPlatform is required");
  return platform;
}

function devicePlatform(value: unknown): "android" | "ios" | "harmony" | undefined {
  return value === "android" || value === "ios" || value === "harmony" ? value : undefined;
}

function requiredDevicePlatform(value: unknown): "android" | "ios" | "harmony" {
  const platform = devicePlatform(value);
  if (!platform) throw new Error("devicePlatform is required");
  return platform;
}

function executionPurpose(value: unknown): "trial" | "normal" | undefined {
  return value === "trial" || value === "normal" ? value : undefined;
}

function responseMode(value: unknown): ScriptFlowResponseMode | undefined {
  return value === "compact" || value === "evidence" || value === "full" ? value : undefined;
}

function reviewDecision(value: unknown): "confirmed" | "rejected" {
  if (value !== "confirmed" && value !== "rejected") throw new Error("decision must be confirmed or rejected");
  return value;
}

function scalarRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  const entries = Object.entries(value).filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
  if (entries.length !== Object.keys(value).length) throw new Error("parameters values must be scalar");
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

function objectRecord<T extends Record<string, unknown>>(value: unknown): T | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("value must be an object");
  return value as T;
}

function screenAssist(value: unknown): { mode: "current"; deviceSerial: string } | undefined {
  const record = objectRecord(value);
  if (!record) return undefined;
  if (record.mode !== "current") throw new Error("screenAssist.mode must be current");
  return { mode: "current", deviceSerial: requiredString(record.deviceSerial, "screenAssist.deviceSerial") };
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value, field);
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}
