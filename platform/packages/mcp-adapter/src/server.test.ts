import { describe, expect, it } from "vitest";
import { createMobileAutomationMcpServer } from "./server.js";

describe("mobile automation MCP stdio server", () => {
  it("exports a server factory with the full tool registry", () => {
    const server = createMobileAutomationMcpServer({ serverUrl: "http://server.test" });

    expect(server).toEqual(expect.objectContaining({
      name: "mobile-automation",
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "generate_script_flow_draft" }),
        expect.objectContaining({ name: "preview_script_flow_draft" }),
        expect.objectContaining({ name: "run_script_flow_draft" }),
        expect.objectContaining({ name: "validate_device" }),
        expect.objectContaining({ name: "generate_and_run_script_flow" }),
        expect.objectContaining({ name: "run_previous_script_flow" })
      ])
    }));
    expect(server.connectStdio).toBeTypeOf("function");
  });
});
