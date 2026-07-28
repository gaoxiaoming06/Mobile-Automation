import { pathToFileURL } from "node:url";

type CliCommand = "devices" | "flows" | "runs" | "run-flow" | "status" | "report" | "help";

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
    if (arg === "--") continue;
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
  const serverUrl = stringOption(options.server) ?? env.AUTOTEST_SERVER_URL ?? defaultServerUrl;
  return { command: (positional[0] ?? "help") as CliCommand, serverUrl: serverUrl.replace(/\/+$/, ""), options };
}

export function buildRequest(parsed: ParsedCli): CliRequest {
  if (parsed.command === "devices") return { method: "GET", path: "/api/devices" };
  if (parsed.command === "flows") {
    return { method: "GET", path: `/api/script-flows${queryString({ appId: stringOption(parsed.options.app), platform: stringOption(parsed.options.platform), status: stringOption(parsed.options.status) })}` };
  }
  if (parsed.command === "runs") {
    return { method: "GET", path: `/api/runs?limit=${encodeURIComponent(stringOption(parsed.options.limit) ?? "10")}` };
  }
  if (parsed.command === "status" || parsed.command === "report") {
    return { method: "GET", path: `/api/runs/${encodeURIComponent(requiredOption(parsed.options.run, "--run"))}` };
  }
  if (parsed.command === "run-flow") {
    const flowId = requiredOption(parsed.options.flow, "--flow");
    return {
      method: "POST",
      path: `/api/script-flows/${encodeURIComponent(flowId)}/runs`,
      body: compactObject({
        deviceSerial: requiredOption(parsed.options.device, "--device"),
        parameters: jsonObjectOption(parsed.options.params, "--params"),
        confirmedRisks: csvOption(parsed.options.confirmRisk),
        mode: stringOption(parsed.options.mode),
        repeatCount: numberOption(parsed.options.repeat),
        stepIntervalMs: numberOption(parsed.options.interval)
      })
    };
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
    body: request.body ? JSON.stringify(request.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    deps.write(formatError(response.status, payload));
    return 1;
  }
  deps.write(formatResponse(parsed.command, payload, parsed.serverUrl));
  return 0;
}

export function formatResponse(command: CliCommand, payload: unknown, serverUrl: string): string {
  if (command === "devices") {
    return readArray(payload, "devices").map((device) => `${String(device.serial ?? device.id)}\t${String(device.platform ?? "-")}\t${String(device.status ?? "-")}\t${String(device.name ?? "")}`).join("\n");
  }
  if (command === "flows") {
    return readArray(payload, "flows").map((flow) => `${String(flow.id)}\t${String(flow.status)}\t${String(flow.platform)}\t${String(flow.name)}`).join("\n");
  }
  if (command === "runs") {
    return readArray(payload, "runs").map((run) => `${String(run.id)}\t${String(run.status)}\t${String(run.caseName)}\t${String(run.deviceSerial)}`).join("\n");
  }
  const run = readObject(payload, "run");
  if (command === "run-flow") return `Started ${String(run.id)} (${String(run.status)})`;
  if (command === "status") return [`Run ${String(run.id)}`, `status=${String(run.status)}`, `flow=${String(readObject(run.sourceSnapshot).flowName ?? run.caseName ?? "-")}`, `device=${String(run.deviceSerial)}`].join("\n");
  if (command === "report") return run.reportHtmlPath ? `${serverUrl}/api/reports/${encodeURIComponent(String(run.id))}/html` : "Report is not ready";
  return JSON.stringify(payload, null, 2);
}

function helpText(): string {
  return [
    "移动自动化 ScriptFlow CLI",
    "",
    "Usage:",
    "  pnpm cli -- devices",
    "  pnpm cli -- flows [--app cn.eeo.classin] [--platform android]",
    "  pnpm cli -- run-flow --flow <flowId> --device <serial> [--params '{\"className\":\"班级四十二号\"}']",
    "  pnpm cli -- runs --limit 20",
    "  pnpm cli -- status --run <runId>",
    "  pnpm cli -- report --run <runId>",
    "",
    "Options:",
    "  --server <url>  Defaults to AUTOTEST_SERVER_URL or http://localhost:4010"
  ].join("\n");
}

function stringOption(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredOption(value: string | boolean | undefined, name: string): string {
  const option = stringOption(value);
  if (!option) throw new Error(`${name} is required`);
  return option;
}

function numberOption(value: string | boolean | undefined): number | undefined {
  const raw = stringOption(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function jsonObjectOption(value: string | boolean | undefined, name: string): Record<string, unknown> | undefined {
  const raw = stringOption(value);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

function csvOption(value: string | boolean | undefined): string[] | undefined {
  const raw = stringOption(value);
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : undefined;
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.size ? `?${params.toString()}` : "";
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function readArray(payload: unknown, key: string): Array<Record<string, unknown>> {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function readObject(payload: unknown, key?: string): Record<string, unknown> {
  const value = key && payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : payload;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatError(status: number, payload: unknown): string {
  const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : JSON.stringify(payload);
  return `HTTP ${status}: ${message}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), { fetch, write: (text) => process.stdout.write(`${text}\n`) }).then((code) => {
    process.exitCode = code;
  });
}
