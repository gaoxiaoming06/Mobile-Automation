import { MobileAutomationMcpAdapter, type McpAdapterConfig, type TargetNodeTestInput } from "./index.js";

type JsonSchema = Record<string, unknown>;

export type MobileAutomationMcpToolName =
  | "list_apps"
  | "list_graph_nodes"
  | "get_node_detail"
  | "trigger_node_test"
  | "get_run_status"
  | "get_report"
  | "get_failure_evidence"
  | "get_graph_quality";

export type MobileAutomationMcpToolDefinition = {
  name: MobileAutomationMcpToolName;
  description: string;
  inputSchema: JsonSchema;
};

export type MobileAutomationMcpToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export const mobileAutomationMcpTools: MobileAutomationMcpToolDefinition[] = [
  {
    name: "list_apps",
    description: "List apps that have active business graphs in the automation test platform.",
    inputSchema: objectSchema({})
  },
  {
    name: "list_graph_nodes",
    description: "List business graph nodes for an app graph or graph version.",
    inputSchema: objectSchema({
      graphId: stringSchema(),
      graphVersionId: stringSchema(),
      platform: enumSchema(["android", "ios"])
    })
  },
  {
    name: "get_node_detail",
    description: "Get a business graph node with incoming and outgoing edges.",
    inputSchema: objectSchema({
      graphId: stringSchema(),
      graphVersionId: stringSchema(),
      nodeId: stringSchema(),
      key: stringSchema(),
      name: stringSchema(),
      platform: enumSchema(["android", "ios"])
    })
  },
  {
    name: "trigger_node_test",
    description: "Trigger a target-node test through the platform REST API. It reuses device locks, videos, screenshots, metrics, and reports.",
    inputSchema: objectSchema(
      {
        deviceSerial: stringSchema(),
        graphId: stringSchema(),
        graphVersionId: stringSchema(),
        targetNodeId: stringSchema(),
        target: objectSchema({
          nodeId: stringSchema(),
          key: stringSchema(),
          name: stringSchema(),
          text: stringSchema(),
          intent: stringSchema(),
          tags: arraySchema(stringSchema()),
          includeDraft: booleanSchema(),
          maxCandidates: numberSchema()
        }),
        startNodeId: stringSchema(),
        platform: enumSchema(["android", "ios"]),
        strategy: enumSchema(["shortest", "most_stable", "smoke", "performance"]),
        startStrategy: enumSchema(["keep_current", "go_home", "launch_app", "restart_app", "clear_data_and_launch"]),
        stopOnFailure: booleanSchema(),
        overlay: objectSchema({}, [], true)
      },
      ["deviceSerial"]
    )
  },
  {
    name: "get_run_status",
    description: "Get structured NodeTestResult status for a graph run.",
    inputSchema: objectSchema({ runId: stringSchema() }, ["runId"])
  },
  {
    name: "get_report",
    description: "Get the HTML report URL for a graph run.",
    inputSchema: objectSchema({ runId: stringSchema() }, ["runId"])
  },
  {
    name: "get_failure_evidence",
    description: "Get failure evidence artifacts for a graph run.",
    inputSchema: objectSchema({ runId: stringSchema() }, ["runId"])
  },
  {
    name: "get_graph_quality",
    description: "Get recent node and edge quality statistics for a graph version.",
    inputSchema: objectSchema({ graphVersionId: stringSchema(), limit: numberSchema() }, ["graphVersionId"])
  }
];

export function createMobileAutomationMcpToolHandlers(config: McpAdapterConfig = {}): Record<MobileAutomationMcpToolName, MobileAutomationMcpToolHandler> {
  const adapter = new MobileAutomationMcpAdapter(config);
  return {
    list_apps: () => adapter.listApps(),
    list_graph_nodes: (input) => adapter.listGraphNodes(readRecord(input)),
    get_node_detail: (input) => adapter.getNodeDetail(readRecord(input)),
    trigger_node_test: (input) => adapter.triggerNodeTest(readRecord(input) as TargetNodeTestInput),
    get_run_status: (input) => adapter.getRunStatus({ runId: requiredString(input.runId, "runId") }),
    get_report: (input) => adapter.getReport({ runId: requiredString(input.runId, "runId") }),
    get_failure_evidence: (input) => adapter.getFailureEvidence({ runId: requiredString(input.runId, "runId") }),
    get_graph_quality: (input) => adapter.getGraphQuality({ graphVersionId: requiredString(input.graphVersionId, "graphVersionId"), limit: optionalNumber(input.limit) })
  };
}

export function assertNoSecretInMcpToolDefinitions(tools: MobileAutomationMcpToolDefinition[] = mobileAutomationMcpTools): void {
  const serialized = JSON.stringify(tools).toLowerCase();
  for (const forbidden of ["token", "secret", "password", "credential", "apikey", "api_key"]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`MCP tool definitions must not expose secret-like field: ${forbidden}`);
    }
  }
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = [], additionalProperties = false): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties
  };
}

function stringSchema(): JsonSchema {
  return { type: "string" };
}

function numberSchema(): JsonSchema {
  return { type: "number" };
}

function booleanSchema(): JsonSchema {
  return { type: "boolean" };
}

function arraySchema(items: JsonSchema): JsonSchema {
  return { type: "array", items };
}

function enumSchema(values: string[]): JsonSchema {
  return { type: "string", enum: values };
}

function readRecord(input: Record<string, unknown>): Record<string, any> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
