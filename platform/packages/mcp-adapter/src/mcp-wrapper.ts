import { MobileAutomationMcpAdapter, type McpAdapterConfig } from "./index.js";

type JsonSchema = Record<string, unknown>;

export type MobileAutomationMcpToolName =
  | "list_apps"
  | "list_page_assets"
  | "get_page_asset"
  | "list_script_flows"
  | "get_script_flow"
  | "generate_script_flow"
  | "preview_script_flow"
  | "run_script_flow"
  | "get_run"
  | "get_report";

export type MobileAutomationMcpToolDefinition = {
  name: MobileAutomationMcpToolName;
  description: string;
  inputSchema: JsonSchema;
};

export type MobileAutomationMcpToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

const platformSchema = enumSchema(["android", "ios", "harmony", "flutter"]);

export const mobileAutomationMcpTools: MobileAutomationMcpToolDefinition[] = [
  { name: "list_apps", description: "List apps with recorded page assets.", inputSchema: objectSchema({}) },
  {
    name: "list_page_assets",
    description: "List recorded page identities and reusable public locators for an app.",
    inputSchema: objectSchema({ appId: stringSchema(), platform: platformSchema })
  },
  {
    name: "get_page_asset",
    description: "Get one recorded page identity by id, key, or name.",
    inputSchema: objectSchema({ appId: stringSchema(), page: stringSchema(), platform: platformSchema }, ["page"])
  },
  {
    name: "list_script_flows",
    description: "List ScriptFlow use cases that can be reviewed or reused.",
    inputSchema: objectSchema({ appId: stringSchema(), platform: platformSchema, status: enumSchema(["draft", "active", "archived"]) })
  },
  {
    name: "get_script_flow",
    description: "Get a ScriptFlow document and its YAML source.",
    inputSchema: objectSchema({ flowId: stringSchema() }, ["flowId"])
  },
  {
    name: "generate_script_flow",
    description: "Generate a ScriptFlow draft from natural language using recorded page identities and active reusable flows.",
    inputSchema: objectSchema({ prompt: stringSchema(), appId: stringSchema(), platform: platformSchema }, ["prompt", "appId", "platform"])
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
      parameters: objectSchema({}, [], true)
    }, ["flowId", "expectedVersion", "planDigest", "deviceSerial"])
  },
  { name: "get_run", description: "Get ScriptFlow run status and failure evidence.", inputSchema: objectSchema({ runId: stringSchema() }, ["runId"]) },
  { name: "get_report", description: "Get the HTML report URL for a ScriptFlow run.", inputSchema: objectSchema({ runId: stringSchema() }, ["runId"]) }
];

export function createMobileAutomationMcpToolHandlers(config: McpAdapterConfig = {}): Record<MobileAutomationMcpToolName, MobileAutomationMcpToolHandler> {
  const adapter = new MobileAutomationMcpAdapter(config);
  return {
    list_apps: () => adapter.listApps(),
    list_page_assets: (input) => adapter.listPageAssets({ appId: optionalString(input.appId), platform: optionalString(input.platform) }),
    get_page_asset: (input) => adapter.getPageAsset({ appId: optionalString(input.appId), page: requiredString(input.page, "page"), platform: optionalString(input.platform) }),
    list_script_flows: (input) => adapter.listScriptFlows({
      appId: optionalString(input.appId),
      platform: optionalString(input.platform),
      status: scriptFlowStatus(input.status)
    }),
    get_script_flow: (input) => adapter.getScriptFlow({ flowId: requiredString(input.flowId, "flowId") }),
    generate_script_flow: (input) => adapter.generateScriptFlow({
      prompt: requiredString(input.prompt, "prompt"),
      appId: requiredString(input.appId, "appId"),
      platform: requiredString(input.platform, "platform")
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
      parameters: scalarRecord(input.parameters)
    }),
    get_run: (input) => adapter.getRun({ runId: requiredString(input.runId, "runId") }),
    get_report: (input) => adapter.getReport({ runId: requiredString(input.runId, "runId") })
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

function scalarRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("parameters must be an object");
  const entries = Object.entries(value).filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean");
  if (entries.length !== Object.keys(value).length) throw new Error("parameters values must be scalar");
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}
