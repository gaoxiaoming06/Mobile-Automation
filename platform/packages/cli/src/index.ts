import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

type CliCommand =
  | "devices"
  | "cases"
  | "runs"
  | "run"
  | "graph-nodes"
  | "graph-quality"
  | "graph-run"
  | "graph-status"
  | "graph-report"
  | "status"
  | "report"
  | "help";

type CliRequest = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
};

type ParsedCli = {
  command: CliCommand;
  serverUrl: string;
  options: Record<string, string | boolean>;
};

const defaultServerUrl = "http://localhost:4010";

export function parseCliArgs(argv: string[], env: Record<string, string | undefined> = process.env): ParsedCli {
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }

  const command = (positional[0] ?? "help") as CliCommand;
  const server = stringOption(options.server) ?? env.AUTOTEST_SERVER_URL ?? defaultServerUrl;
  return {
    command,
    serverUrl: server.replace(/\/+$/, ""),
    options
  };
}

export function buildRequest(parsed: ParsedCli): CliRequest {
  if (parsed.command === "devices") {
    return { method: "GET", path: "/api/devices" };
  }
  if (parsed.command === "cases") {
    return { method: "GET", path: "/api/cases" };
  }
  if (parsed.command === "runs") {
    const limit = stringOption(parsed.options.limit) ?? "10";
    return { method: "GET", path: `/api/runs?limit=${encodeURIComponent(limit)}` };
  }
  if (parsed.command === "status") {
    const runId = requiredOption(parsed.options.run, "--run");
    return { method: "GET", path: `/api/runs/${encodeURIComponent(runId)}` };
  }
  if (parsed.command === "graph-status") {
    const runId = requiredOption(parsed.options.run, "--run");
    return { method: "GET", path: `/api/graph-runs/${encodeURIComponent(runId)}` };
  }
  if (parsed.command === "graph-report") {
    const runId = requiredOption(parsed.options.run, "--run");
    return { method: "GET", path: `/api/graph-runs/${encodeURIComponent(runId)}` };
  }
  if (parsed.command === "report") {
    const runId = requiredOption(parsed.options.run, "--run");
    return { method: "GET", path: `/api/runs/${encodeURIComponent(runId)}` };
  }
  if (parsed.command === "run") {
    const deviceSerial = requiredOption(parsed.options.device, "--device");
    const caseId = requiredOption(parsed.options.case, "--case");
    return {
      method: "POST",
      path: "/api/runs",
      body: {
        deviceSerial,
        caseId,
        mode: stringOption(parsed.options.mode),
        repeatCount: numberOption(parsed.options.repeat),
        stepIntervalMs: numberOption(parsed.options.interval),
        startStrategy: stringOption(parsed.options.startStrategy),
        startAppPackageName: stringOption(parsed.options.package),
        startSetupScope: stringOption(parsed.options.startScope),
        androidAppMonitor: buildAndroidAppMonitorOption(parsed.options)
      }
    };
  }
  if (parsed.command === "graph-run") {
    const deviceSerial = requiredOption(parsed.options.device, "--device");
    const graphVersionId = stringOption(parsed.options.graphVersion);
    const graphId = stringOption(parsed.options.graph);
    const targetNodeId = stringOption(parsed.options.targetNode);
    const targetKey = stringOption(parsed.options.targetKey);
    const targetName = stringOption(parsed.options.targetName);
    const overlayPath = stringOption(parsed.options.overlay);
    const overlayJson = stringOption(parsed.options.overlayJson);
    if (!graphVersionId && !graphId) {
      throw new Error("--graphVersion or --graph is required");
    }
    if (!targetNodeId && !targetKey && !targetName) {
      throw new Error("--targetNode, --targetKey, or --targetName is required");
    }
    return {
      method: "POST",
      path: "/api/graph-runs",
      body: {
        deviceSerial,
        graphVersionId,
        graphId,
        targetNodeId,
        target: targetKey || targetName ? { key: targetKey, name: targetName } : undefined,
        startNodeId: stringOption(parsed.options.startNode),
        platform: stringOption(parsed.options.platform),
        strategy: stringOption(parsed.options.strategy),
        startStrategy: stringOption(parsed.options.startStrategy),
        overlay: overlayJson ? JSON.parse(overlayJson) : overlayPath ? readJsonFile(overlayPath) : undefined,
        androidAppMonitor: buildAndroidAppMonitorOption(parsed.options)
      }
    };
  }
  if (parsed.command === "graph-nodes") {
    const graphId = stringOption(parsed.options.graph);
    return { method: "GET", path: graphId ? `/api/graphs?graphId=${encodeURIComponent(graphId)}` : "/api/graphs" };
  }
  if (parsed.command === "graph-quality") {
    const graphVersionId = requiredOption(parsed.options.graphVersion, "--graphVersion");
    const limit = stringOption(parsed.options.limit);
    return { method: "GET", path: `/api/graphs/${encodeURIComponent(graphVersionId)}/quality${limit ? `?limit=${encodeURIComponent(limit)}` : ""}` };
  }
  return { method: "GET", path: "/help" };
}

export async function runCli(argv: string[], deps: { fetch: typeof fetch; write: (text: string) => void; env?: Record<string, string | undefined> }): Promise<number> {
  const parsed = parseCliArgs(argv, deps.env);
  if (parsed.command === "help") {
    deps.write(helpText());
    return 0;
  }

  const request = buildRequest(parsed);
  const response = await deps.fetch(`${parsed.serverUrl}${request.path}`, {
    method: request.method,
    headers: request.body ? { "Content-Type": "application/json" } : undefined,
    body: request.body ? JSON.stringify(removeUndefinedValues(request.body)) : undefined
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    deps.write(formatError(response.status, payload));
    return 1;
  }
  deps.write(formatResponse(parsed.command, payload, parsed.serverUrl));
  return 0;
}

export function formatResponse(command: CliCommand, payload: unknown, serverUrl: string): string {
  if (command === "devices") {
    const devices = readArray(payload, "devices");
    return devices.map((device) => `${String(device.serial ?? device.id)}\t${String(device.platform ?? "-")}\t${String(device.status ?? "-")}\t${String(device.name ?? "")}`).join("\n");
  }
  if (command === "cases") {
    const cases = readArray(payload, "cases");
    return cases.map((item) => `${String(item.id)}\t${String(item.name)}\t${String((item.steps as unknown[] | undefined)?.length ?? 0)} steps`).join("\n");
  }
  if (command === "runs") {
    const runs = readArray(payload, "runs");
    return runs.map((run) => `${String(run.id)}\t${String(run.status)}\t${String(run.caseName)}\t${String(run.deviceSerial)}`).join("\n");
  }
  if (command === "run") {
    const run = readObject(payload, "run");
    return `Started ${String(run.id)} (${String(run.status)})`;
  }
  if (command === "graph-run") {
    const run = readObject(payload, "run");
    const result = readObject(payload, "nodeTestResult");
    const reportUrl = optionalAbsoluteUrl(serverUrl, result.reportUrl);
    if (Object.keys(result).length) {
      return [
        `Started graph run ${String(result.runId ?? run.id)} (${String(result.status ?? run.status)})`,
        `target=${String(result.targetNodeName ?? result.targetNodeId ?? "-")}`,
        `routeSteps=${String((result.route as unknown[] | undefined)?.length ?? 0)}`,
        `report=${reportUrl ?? "-"}`,
        `routePlan=${String(readScalar(payload, "routePlanId") ?? "-")}`,
        `executionPlan=${String(readScalar(payload, "executionPlanId") ?? "-")}`
      ].join("\n");
    }
    return [
      `Started graph run ${String(run.id)} (${String(run.status)})`,
      `routePlan=${String(readScalar(payload, "routePlanId") ?? "-")}`,
      `executionPlan=${String(readScalar(payload, "executionPlanId") ?? "-")}`,
      `targetNode=${String(readScalar(payload, "targetNodeId") ?? "-")}`
    ].join("\n");
  }
  if (command === "graph-status") {
    const result = readObject(payload, "nodeTestResult");
    if (Object.keys(result).length) {
      const failedAt = typeof result.failedAt === "object" && result.failedAt !== null ? (result.failedAt as Record<string, unknown>) : undefined;
      const evidence = typeof result.evidence === "object" && result.evidence !== null ? (result.evidence as Record<string, unknown>) : {};
      const failureArtifacts = Array.isArray(evidence.failureArtifacts) ? evidence.failureArtifacts : [];
      return [
        `Graph run ${String(result.runId ?? "-")}`,
        `status=${String(result.status ?? "-")}`,
        `target=${String(result.targetNodeName ?? result.targetNodeId ?? "-")}`,
        `failedAt=${failedAt ? `${String(failedAt.phase ?? "-")}:${String(failedAt.code ?? "-")}` : "-"}`,
        `report=${optionalAbsoluteUrl(serverUrl, result.reportUrl) ?? "-"}`,
        `failureEvidence=${failureArtifacts.length}`
      ].join("\n");
    }
    const graphRun = readObject(payload, "graphRun");
    const failedAt = typeof graphRun.failedAt === "object" && graphRun.failedAt !== null ? (graphRun.failedAt as Record<string, unknown>) : undefined;
    return [
      `Graph run ${String(graphRun.id)}`,
      `status=${String(graphRun.status)}`,
      `target=${String(graphRun.targetNodeName ?? graphRun.targetNodeId ?? "-")}`,
      `failedAt=${failedAt ? `${String(failedAt.phase ?? "-")}:${String(failedAt.code ?? "-")}` : "-"}`,
      `report=${typeof graphRun.reportUrl === "string" ? `${serverUrl}${graphRun.reportUrl}` : "-"}`
    ].join("\n");
  }
  if (command === "graph-report") {
    const graphRun = readObject(payload, "graphRun");
    return typeof graphRun.reportUrl === "string" ? `${serverUrl}${graphRun.reportUrl}` : "Graph report is not ready";
  }
  if (command === "graph-nodes") {
    return formatGraphNodes(payload);
  }
  if (command === "graph-quality") {
    return formatGraphQuality(payload);
  }
  if (command === "status") {
    const run = readObject(payload, "run");
    return [`Run ${String(run.id)}`, `status=${String(run.status)}`, `case=${String(run.caseName)}`, `device=${String(run.deviceSerial)}`].join("\n");
  }
  if (command === "report") {
    const run = readObject(payload, "run");
    const path = typeof run.reportHtmlPath === "string" ? run.reportHtmlPath : "";
    return path ? `${serverUrl}/artifacts/${path}` : "Report is not ready";
  }
  return JSON.stringify(payload, null, 2);
}

function helpText(): string {
  return [
    "自动化测试平台 CLI",
    "",
    "Usage:",
    "  pnpm cli -- devices",
    "  pnpm cli -- cases",
    "  pnpm cli -- runs --limit 20",
    "  pnpm cli -- run --device <serial> --case <caseId> [--mode once|repeat_n|loop_until_stop] [--repeat 3]",
    "  pnpm cli -- run --device <serial> --case <caseId> --android-app-monitor --monitor-package cn.eeo.classin",
    "  pnpm cli -- graph-run --device <serial> --graph <graphId> --targetKey <nodeKey>",
    "  pnpm cli -- graph-run --device <serial> --graphVersion <versionId> --targetNode <nodeId> [--overlay overlay.json]",
    "  pnpm cli -- graph-run --device <serial> --graph <graphId> --targetKey <nodeKey> [--overlayJson '{...}']",
    "  pnpm cli -- graph-nodes [--graph <graphId>]",
    "  pnpm cli -- graph-quality --graphVersion <versionId> [--limit 120]",
    "  pnpm cli -- graph-status --run <runId>",
    "  pnpm cli -- graph-report --run <runId>",
    "  pnpm cli -- status --run <runId>",
    "  pnpm cli -- report --run <runId>",
    "",
    "Options:",
    "  --server <url>  Defaults to AUTOTEST_SERVER_URL or http://localhost:4010",
    "  --android-app-monitor  Enable Android app sidecar monitoring for run/graph-run",
    "  --monitor-package <package>  Package to monitor; run falls back to --package",
    "  --monitor-main-only  Monitor only the main process",
    "  --monitor-cpu-threshold <percent>  Enable CPU threshold with 5000ms sustain / 30000ms cooldown",
    "  --monitor-memory-threshold <mb>  Enable PSS threshold with 5000ms sustain / 30000ms cooldown",
    "  --monitor-heap-dump  Enable heap dump capture for supported incidents"
  ].join("\n");
}

function formatError(status: number, payload: unknown): string {
  const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : JSON.stringify(payload);
  return `HTTP ${status}: ${message}`;
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberOption(value: string | boolean | undefined): number | undefined {
  const raw = stringOption(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildAndroidAppMonitorOption(options: Record<string, string | boolean>): Record<string, unknown> | undefined {
  if (options["android-app-monitor"] !== true) {
    return undefined;
  }
  const packageName = stringOption(options["monitor-package"]) ?? stringOption(options.package) ?? stringOption(options.startAppPackageName);
  if (!packageName) {
    throw new Error("--monitor-package or --package is required when --android-app-monitor is enabled");
  }
  const cpuThreshold = numberOption(options["monitor-cpu-threshold"]);
  const memoryThreshold = numberOption(options["monitor-memory-threshold"]);
  return {
    enabled: true,
    packageName,
    includeSubprocesses: options["monitor-main-only"] === true ? false : true,
    ...(options["monitor-heap-dump"] === true ? { enableHeapDump: true } : {}),
    ...(cpuThreshold || memoryThreshold
      ? {
          thresholds: {
            ...(cpuThreshold ? { cpuPercent: enabledThreshold(cpuThreshold) } : {}),
            ...(memoryThreshold ? { pssMb: enabledThreshold(memoryThreshold) } : {})
          }
        }
      : {})
  };
}

function enabledThreshold(value: number): Record<string, number | boolean> {
  return { enabled: true, value, sustainMs: 5000, cooldownMs: 30000 };
}

function requiredOption(value: string | boolean | undefined, name: string): string {
  const option = stringOption(value);
  if (!option) {
    throw new Error(`${name} is required`);
  }
  return option;
}

function removeUndefinedValues(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readArray(payload: unknown, key: string): Array<Record<string, unknown>> {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function readObject(payload: unknown, key: string): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) {
    return {};
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readScalar(payload: unknown, key: string): string | number | boolean | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function optionalAbsoluteUrl(serverUrl: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return `${serverUrl}${value.startsWith("/") ? "" : "/"}${value}`;
}

function formatGraphNodes(payload: unknown): string {
  const graphs = readArray(payload, "graphs");
  const rows = graphs
    .flatMap((graph) => {
      const activeVersion = typeof graph.activeVersion === "object" && graph.activeVersion !== null ? graph.activeVersion as Record<string, unknown> : {};
      const nodes = Array.isArray(activeVersion.nodes) ? activeVersion.nodes as Array<Record<string, unknown>> : [];
      return nodes.map((node) =>
        [
          String(graph.id ?? "-"),
          String(activeVersion.id ?? "-"),
          String(node.id ?? "-"),
          String(node.key ?? "-"),
          String(node.name ?? "-"),
          String(node.nodeType ?? "-")
        ].join("\t")
      );
    });
  return rows.join("\n");
}

function formatGraphQuality(payload: unknown): string {
  const quality = readObject(payload, "quality");
  const graphVersionId = String(quality.graphVersionId ?? "-");
  const analyzedRunCount = String(quality.analyzedRunCount ?? 0);
  const nodes = Array.isArray(quality.nodes) ? (quality.nodes as Array<Record<string, unknown>>) : [];
  const edges = Array.isArray(quality.edges) ? (quality.edges as Array<Record<string, unknown>>) : [];
  const nodeLines = nodes
    .slice(0, 10)
    .map((node) =>
      [
        "node",
        String(node.nodeId ?? "-"),
        String(node.nodeName ?? "-"),
        `${formatRate(node.passRate)} pass`,
        `${String(node.runCount ?? 0)} runs`,
        node.latestReportUrl ? String(node.latestReportUrl) : "-"
      ].join("\t")
    );
  const edgeLines = edges
    .slice(0, 10)
    .map((edge) =>
      [
        "edge",
        String(edge.edgeKey ?? edge.edgeId ?? "-"),
        `${String(edge.fromNodeName ?? "-")} -> ${String(edge.toNodeName ?? "-")}`,
        `${formatRate(edge.passRate)} pass`,
        `${String(edge.runCount ?? 0)} runs`,
        edge.latestFailureMessage ? String(edge.latestFailureMessage) : "-"
      ].join("\t")
    );
  return [`graphVersion=${graphVersionId}`, `analyzedRuns=${analyzedRunCount}`, ...nodeLines, ...edgeLines].join("\n");
}

function formatRate(value: unknown): string {
  const number = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `${Math.round(number * 100)}%`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), {
    fetch,
    write: (text) => {
      process.stdout.write(`${text}\n`);
    }
  }).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
