#!/usr/bin/env tsx

import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { MobileAutomationMcpAdapter, type McpAdapterConfig } from "./index.js";
import {
  createMobileAutomationMcpToolHandlers,
  mobileAutomationMcpTools,
  type MobileAutomationMcpToolHandler
} from "./mcp-wrapper.js";

const serverName = "mobile-automation";
const serverVersion = "0.1.0";
const authoringContractResourceUri = "scriptflow://v1/authoring-contract";

export type MobileAutomationMcpServer = {
  name: typeof serverName;
  tools: typeof mobileAutomationMcpTools;
  sdkServer: Server;
  connectStdio: () => Promise<void>;
};

export function createMobileAutomationMcpServer(config: McpAdapterConfig = {}): MobileAutomationMcpServer {
  const resolvedConfig = {
    ...config,
    serverUrl: config.serverUrl ?? process.env.MOBILE_AUTOMATION_SERVER_URL
  };
  const adapter = new MobileAutomationMcpAdapter(resolvedConfig);
  const handlers = createMobileAutomationMcpToolHandlers(resolvedConfig);
  const sdkServer = new Server(
    { name: serverName, version: serverVersion },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        "Use this server to generate, validate, preview, run, and report ScriptFlow v1 mobile automation tests.",
        "Read scriptflow://v1/authoring-contract before authoring YAML.",
        "Use scriptPlatform for script/assets and devicePlatform for the real connected device."
      ].join("\n")
    }
  );

  sdkServer.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => ({
    tools: mobileAutomationMcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"]
    }))
  }));

  sdkServer.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    const handler = (handlers as Partial<Record<string, MobileAutomationMcpToolHandler>>)[name];
    if (!handler) {
      return errorToolResult(`Unknown mobile automation tool: ${name}`);
    }
    try {
      const result = await handler(request.params.arguments ?? {});
      return jsonToolResult(result);
    } catch (error) {
      return errorToolResult(error instanceof Error ? error.message : String(error));
    }
  });

  sdkServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: authoringContractResourceUri,
      name: "ScriptFlow v1 authoring contract",
      description: "Supported ScriptFlow target types, actions, platform fields, and execution constraints.",
      mimeType: "application/json"
    }]
  }));

  sdkServer.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    if (request.params.uri !== authoringContractResourceUri) {
      throw new Error(`Unknown mobile automation resource: ${request.params.uri}`);
    }
    return {
      contents: [{
        uri: authoringContractResourceUri,
        mimeType: "application/json",
        text: JSON.stringify(adapter.getScriptFlowAuthoringContract(), null, 2)
      }]
    };
  });

  return {
    name: serverName,
    tools: mobileAutomationMcpTools,
    sdkServer,
    connectStdio: async () => {
      await sdkServer.connect(new StdioServerTransport());
    }
  };
}

function jsonToolResult(result: unknown): CallToolResult {
  const text = JSON.stringify(result, null, 2);
  return isRecord(result)
    ? { content: [{ type: "text", text }], structuredContent: result }
    : { content: [{ type: "text", text }] };
}

function errorToolResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMobileAutomationMcpServer().connectStdio().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
