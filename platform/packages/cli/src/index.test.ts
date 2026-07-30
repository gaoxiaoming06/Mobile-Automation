import { describe, expect, it, vi } from "vitest";
import { buildRequest, formatResponse, parseCliArgs, runCli } from "./index.js";

describe("ScriptFlow CLI", () => {
  it("builds a typed ScriptFlow run request", () => {
    const parsed = parseCliArgs([
      "run-flow", "--server", "http://server/", "--flow", "flow-1", "--device", "device-1",
      "--version", "3", "--plan", "a".repeat(64), "--params", '{"className":"班级四十二号","repeat":2}', "--confirmStep", "publish-lesson,submit-form"
    ]);
    expect(parsed.serverUrl).toBe("http://server");
    expect(buildRequest(parsed)).toEqual({
      method: "POST",
      path: "/api/script-flows/flow-1/runs",
      body: {
        expectedVersion: 3,
        planDigest: "a".repeat(64),
        deviceSerial: "device-1",
        parameters: { className: "班级四十二号", repeat: 2 }
      }
    });
  });

  it("builds filtered flow and run queries", () => {
    expect(buildRequest(parseCliArgs(["flows", "--app", "cn.eeo.classin", "--platform", "android"]))).toEqual({
      method: "GET",
      path: "/api/script-flows?appId=cn.eeo.classin&platform=android"
    });
    expect(buildRequest(parseCliArgs(["status", "--run", "run-1"]))).toEqual({ method: "GET", path: "/api/runs/run-1" });
    expect(buildRequest(parseCliArgs(["preview-flow", "--flow", "flow-1", "--version", "3", "--params", '{"name":"张三"}']))).toEqual({
      method: "POST",
      path: "/api/script-flows/flow-1/preview",
      body: { expectedVersion: 3, parameters: { name: "张三" } }
    });
  });

  it("formats ScriptFlow results", () => {
    expect(formatResponse("flows", { flows: [{ id: "flow-1", version: 3, status: "active", platform: "android", name: "打开主页" }] }, "http://server")).toBe(
      "flow-1\tv3\tactive\tandroid\t打开主页"
    );
    expect(formatResponse("preview-flow", { planDigest: "a".repeat(64), plan: { steps: [], riskConfirmations: [] } }, "http://server")).toContain(`planDigest=${"a".repeat(64)}`);
    expect(formatResponse("run-flow", { run: { id: "run-1", status: "running" } }, "http://server")).toBe("Started run-1 (running)");
    expect(formatResponse("report", { run: { id: "run-1", reportHtmlPath: "runs/run-1/report.html" } }, "http://server")).toBe(
      "http://server/api/reports/run-1/html"
    );
  });

  it("runs list devices through fetch", async () => {
    const output: string[] = [];
    const fetchMock = vi.fn(async () => response({ devices: [{ serial: "device-1", platform: "android", status: "online", name: "Pixel" }] }));
    await expect(runCli(["devices"], { fetch: fetchMock as unknown as typeof fetch, write: (text) => output.push(text), env: { AUTOTEST_SERVER_URL: "http://server" } })).resolves.toBe(0);
    expect(output).toEqual(["device-1\tandroid\tonline\tPixel"]);
  });
});

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) } as Response;
}
