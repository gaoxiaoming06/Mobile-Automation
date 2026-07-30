import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";

const CODEX_PROVIDER_BASE_URL = "codex://app-server";
const CODEX_PROCESS_START_TIMEOUT_MS = 15_000;
const CODEX_CLEANUP_TIMEOUT_MS = 8_000;

export type AiClientConfig = {
  baseURL: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
};

export type AiClientFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type AiJsonRequest = {
  developerInstructions: string;
  userContent: string;
  imagePngBase64?: string;
  effort?: "low" | "medium" | "high";
};

export type AiJsonResult = {
  content: string;
  visionUsed: boolean;
};

export function isCodexAppServerProvider(baseURL?: string): boolean {
  return baseURL?.trim().toLowerCase() === CODEX_PROVIDER_BASE_URL;
}

export function resolveCodexExecutable(options: {
  configuredPath?: string;
  platform?: NodeJS.Platform;
  fileExists?: (candidate: string) => boolean;
  homeDirectory?: string;
} = {}): string {
  const configuredPath = options.configuredPath?.trim() || process.env.CODEX_CLI_PATH?.trim();
  if (configuredPath) return configuredPath;
  if ((options.platform ?? process.platform) !== "darwin") return "codex";
  const fileExists = options.fileExists ?? existsSync;
  const homeDirectory = options.homeDirectory ?? homedir();
  const bundledCandidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(homeDirectory, "Applications/ChatGPT.app/Contents/Resources/codex"),
    path.join(homeDirectory, "Applications/Codex.app/Contents/Resources/codex")
  ];
  return bundledCandidates.find(fileExists) ?? "codex";
}

export async function runAiJsonRequest(config: AiClientConfig, request: AiJsonRequest, fetchImpl: AiClientFetch = fetch): Promise<AiJsonResult> {
  if (isCodexAppServerProvider(config.baseURL)) {
    return runCodexJsonTurn(config, request);
  }
  return runOpenAiCompatibleJsonRequest(config, request, fetchImpl);
}

async function runOpenAiCompatibleJsonRequest(config: AiClientConfig, request: AiJsonRequest, fetchImpl: AiClientFetch): Promise<AiJsonResult> {
  if (!config.apiKey?.trim()) {
    throw new Error("OpenAI-compatible AI request requires an API key.");
  }
  const attemptWithImage = Boolean(request.imagePngBase64);
  try {
    const content = await postOpenAiChatCompletion(config, request, attemptWithImage, fetchImpl);
    return { content, visionUsed: attemptWithImage };
  } catch (error) {
    if (!attemptWithImage) {
      throw error;
    }
    const content = await postOpenAiChatCompletion(config, request, false, fetchImpl);
    return { content, visionUsed: false };
  }
}

async function postOpenAiChatCompletion(config: AiClientConfig, request: AiJsonRequest, withImage: boolean, fetchImpl: AiClientFetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const userContent = withImage && request.imagePngBase64
      ? [
          { type: "text", text: request.userContent },
          { type: "image_url", image_url: { url: `data:image/png;base64,${request.imagePngBase64}` } }
        ]
      : request.userContent;
    const response = await fetchImpl(`${config.baseURL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: request.developerInstructions
          },
          {
            role: "user",
            content: userContent
          }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`AI request failed: HTTP ${response.status} ${await response.text().catch(() => "")}`.trim());
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI response did not include text content.");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function runCodexJsonTurn(config: AiClientConfig, request: AiJsonRequest): Promise<AiJsonResult> {
  if (!request.imagePngBase64) {
    const content = await runCodexTurnOnce(config, request, undefined);
    return { content, visionUsed: false };
  }
  const imageDir = await mkdtemp(path.join(tmpdir(), "ai-client-image-"));
  const imagePath = path.join(imageDir, "evidence.png");
  try {
    await writeFile(imagePath, Buffer.from(request.imagePngBase64, "base64"));
    try {
      const content = await runCodexTurnOnce(config, request, imagePath);
      return { content, visionUsed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/localimage|invalid|unknown/i.test(message)) {
        throw error;
      }
      const content = await runCodexTurnOnce(config, request, undefined);
      return { content, visionUsed: false };
    }
  } finally {
    await rm(imageDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runCodexTurnOnce(config: AiClientConfig, request: AiJsonRequest, imagePath: string | undefined): Promise<string> {
  const connection = await createCodexConnection();
  const deadlineAt = Date.now() + config.timeoutMs;
  let threadId: string | undefined;
  let turnId: string | undefined;
  try {
    const threadStartResponse = asRecord(
      await codexRequest(connection, "thread/start", {
        model: config.model,
        cwd: process.cwd(),
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
        developerInstructions: request.developerInstructions
      }, deadlineAt)
    );
    threadId = stringFromRecord(asRecord(threadStartResponse.thread), "id");
    if (!threadId) {
      throw new Error("thread/start did not return a thread id");
    }

    const input: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: request.userContent,
        text_elements: []
      }
    ];
    if (imagePath) {
      input.push({ type: "localImage", path: imagePath });
    }
    const turnStartResponse = asRecord(
      await codexRequest(connection, "turn/start", {
        threadId,
        input,
        effort: request.effort ?? "low"
      }, deadlineAt)
    );
    turnId = stringFromRecord(asRecord(turnStartResponse.turn), "id");
    if (!turnId) {
      throw new Error("turn/start did not return a turn id");
    }

    let accumulatedText = "";
    let latestErrorMessage: string | undefined;
    while (true) {
      const message = await codexNextMessage(connection, deadlineAt);
      if (isCodexResponseMessage(message)) {
        continue;
      }
      if (isCodexRequestMessage(message)) {
        await codexRespondToServerRequest(connection, message);
        continue;
      }

      const method = stringFromRecord(message, "method");
      const params = asRecord(message.params);
      if (method === "error") {
        latestErrorMessage = stringFromRecord(asRecord(params.error), "message") ?? stringFromRecord(params, "message");
        continue;
      }
      if (method === "item/agentMessage/delta" && params.threadId === threadId && params.turnId === turnId) {
        accumulatedText += stringFromRecord(params, "delta") ?? "";
        continue;
      }
      if (
        method === "item/completed" &&
        params.threadId === threadId &&
        params.turnId === turnId &&
        asRecord(params.item).type === "agentMessage" &&
        !accumulatedText
      ) {
        accumulatedText = stringFromRecord(asRecord(params.item), "text") ?? "";
        continue;
      }
      if (method === "turn/completed" && params.threadId === threadId && asRecord(params.turn).id === turnId) {
        const status = stringFromRecord(asRecord(params.turn), "status");
        const turnError = stringFromRecord(asRecord(asRecord(params.turn).error), "message");
        if (status !== "completed") {
          throw new Error(turnError ?? latestErrorMessage ?? `codex turn finished with status "${status ?? "unknown"}"`);
        }
        return accumulatedText;
      }
    }
  } finally {
    if (threadId) {
      await codexRequest(connection, "thread/unsubscribe", { threadId }, Date.now() + CODEX_CLEANUP_TIMEOUT_MS).catch(() => undefined);
    }
    closeCodexConnection(connection);
  }
}

type CodexJsonRpcMessage = Record<string, unknown>;

type CodexConnection = {
  child: ChildProcessWithoutNullStreams;
  lineReader: Interface;
  lineBuffer: string[];
  pendingMessages: CodexJsonRpcMessage[];
  nextRequestId: number;
  closed: boolean;
  lastExitCode: number | null;
  processErrorMessage?: string;
  stderrBuffer: string;
};

async function createCodexConnection(): Promise<CodexConnection> {
  const executable = resolveCodexExecutable();
  const child = spawn(executable, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
  const connection: CodexConnection = {
    child,
    lineReader: createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }),
    lineBuffer: [],
    pendingMessages: [],
    nextRequestId: 1,
    closed: false,
    lastExitCode: null,
    stderrBuffer: ""
  };
  connection.lineReader.on("line", (line) => connection.lineBuffer.push(line));
  child.stderr.on("data", (chunk: Buffer | string) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    connection.stderrBuffer = `${connection.stderrBuffer}${text}`.slice(-8192);
  });
  child.on("exit", (code) => {
    connection.closed = true;
    connection.lastExitCode = code;
  });
  child.on("error", (error) => {
    connection.closed = true;
    connection.processErrorMessage = error.message;
  });

  child.unref?.();
  unrefNodeHandle(child.stdin);
  unrefNodeHandle(child.stdout);
  unrefNodeHandle(child.stderr);

  const deadlineAt = Date.now() + CODEX_PROCESS_START_TIMEOUT_MS;
  await waitForCodexProcessStart(child, executable, deadlineAt);
  await codexRequest(connection, "initialize", {
    clientInfo: {
      name: "mobile_automation_ai_client",
      title: "Mobile Automation AI Client",
      version: "1.0.0"
    },
    capabilities: {
      experimentalApi: false
    }
  }, deadlineAt);
  await codexSendMessage(connection, { method: "initialized" });
  return connection;
}

async function waitForCodexProcessStart(
  child: ChildProcessWithoutNullStreams,
  executable: string,
  deadlineAt: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out starting Codex executable: ${executable}`));
    }, Math.max(1, deadlineAt - Date.now()));
    const onSpawn = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(new Error(`Failed to start Codex executable ${executable}: ${error.message}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("spawn", onSpawn);
      child.off("error", onError);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

async function codexRequest(connection: CodexConnection, method: string, params: unknown, deadlineAt: number): Promise<unknown> {
  const id = connection.nextRequestId++;
  await codexSendMessage(connection, { id, method, params });
  while (true) {
    const message = await codexNextMessage(connection, deadlineAt, false);
    if (isCodexResponseMessage(message) && message.id === id) {
      if (message.error) {
        throw new Error(`codex app-server ${method} failed: ${stringFromRecord(asRecord(message.error), "message") ?? "unknown error"}`);
      }
      return message.result ?? {};
    }
    if (isCodexRequestMessage(message)) {
      await codexRespondToServerRequest(connection, message);
      continue;
    }
    connection.pendingMessages.push(message);
  }
}

async function codexRespondToServerRequest(connection: CodexConnection, request: CodexJsonRpcMessage): Promise<void> {
  const method = stringFromRecord(request, "method");
  const id = request.id;
  let result: unknown;
  if (method === "item/commandExecution/requestApproval") {
    result = { decision: "decline" };
  } else if (method === "item/fileChange/requestApproval") {
    result = { decision: "decline" };
  } else if (method === "mcpServer/elicitation/request") {
    result = { action: "cancel", content: null };
  } else if (method === "item/tool/requestUserInput") {
    result = { answers: [] };
  } else {
    await codexSendMessage(connection, {
      id,
      error: {
        code: -32601,
        message: `unsupported server request: ${method ?? "unknown"}`
      }
    });
    return;
  }
  await codexSendMessage(connection, { id, result });
}

async function codexNextMessage(connection: CodexConnection, deadlineAt: number, includePending = true): Promise<CodexJsonRpcMessage> {
  if (includePending && connection.pendingMessages.length) {
    return connection.pendingMessages.shift() as CodexJsonRpcMessage;
  }
  while (true) {
    if (Date.now() > deadlineAt) {
      throw new Error("codex app-server request timed out");
    }
    if (connection.lineBuffer.length) {
      const line = connection.lineBuffer.shift()?.trim();
      if (!line) {
        continue;
      }
      try {
        return JSON.parse(line) as CodexJsonRpcMessage;
      } catch {
        continue;
      }
    }
    if (connection.closed) {
      throw codexClosedConnectionError(connection);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function codexSendMessage(connection: CodexConnection, payload: Record<string, unknown>): Promise<void> {
  if (connection.closed) {
    throw codexClosedConnectionError(connection);
  }
  await new Promise<void>((resolve, reject) => {
    connection.child.stdin.write(`${JSON.stringify(payload)}\n`, (error: Error | null | undefined) => {
      if (error) {
        reject(new Error(`failed writing to codex app-server stdin: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}

function closeCodexConnection(connection: CodexConnection): void {
  try {
    connection.lineReader.close();
  } catch {
    // Best effort cleanup.
  }
  connection.child.stdin.end();
  connection.child.kill();
}

function unrefNodeHandle(handle: unknown): void {
  const candidate = handle as { unref?: () => void };
  candidate.unref?.();
}

function isCodexRequestMessage(message: CodexJsonRpcMessage): boolean {
  return typeof message.method === "string" && message.id !== undefined && message.result === undefined && message.error === undefined;
}

function isCodexResponseMessage(message: CodexJsonRpcMessage): boolean {
  return message.id !== undefined && (message.result !== undefined || message.error !== undefined) && typeof message.method !== "string";
}

function codexClosedConnectionError(connection: CodexConnection): Error {
  const stderr = connection.stderrBuffer.trim();
  if (connection.processErrorMessage) {
    return new Error(stderr ? `codex app-server process error: ${connection.processErrorMessage}. stderr=${stderr}` : `codex app-server process error: ${connection.processErrorMessage}`);
  }
  return new Error(stderr ? `codex app-server connection closed (exitCode=${connection.lastExitCode}). stderr=${stderr}` : `codex app-server connection closed (exitCode=${connection.lastExitCode})`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
