import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRapidOcrEndpoint = "http://127.0.0.1:8766/ocr";
const defaultStartupTimeoutMs = 30_000;

export type OcrSidecarHandle = {
  started: boolean;
  stop(): Promise<void>;
};

export async function ensureRapidOcrSidecar(env: NodeJS.ProcessEnv = process.env): Promise<OcrSidecarHandle> {
  if (!shouldAutoStartRapidOcrSidecar(env)) {
    return noopSidecar();
  }

  const endpoint = env.RAPID_OCR_ENDPOINT || defaultRapidOcrEndpoint;
  const healthUrl = rapidOcrHealthUrl(endpoint);
  if (await isHealthy(healthUrl)) {
    console.log(`RapidOCR sidecar already available at ${healthUrl}`);
    return noopSidecar();
  }

  const scriptPath = env.RAPID_OCR_SCRIPT || defaultRapidOcrScriptPath();
  const python = env.RAPID_OCR_PYTHON || defaultRapidOcrPythonPath();
  const child = spawn(python, [scriptPath], {
    cwd: projectRoot(),
    env: {
      ...process.env,
      ...env
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.end();

  child.stdout.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) {
      console.log(`[rapidocr] ${message}`);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const message = chunk.toString("utf8").trim();
    if (message) {
      console.warn(`[rapidocr] ${message}`);
    }
  });

  const startupTimeoutMs = positiveNumber(env.RAPID_OCR_STARTUP_TIMEOUT_MS) ?? defaultStartupTimeoutMs;
  try {
    await waitForHealth(healthUrl, child, startupTimeoutMs);
    console.log(`RapidOCR sidecar started at ${healthUrl}`);
    return {
      started: true,
      stop: () => stopChild(child)
    };
  } catch (error) {
    await stopChild(child);
    console.warn(`RapidOCR sidecar failed to start: ${errorToString(error)}`);
    return noopSidecar();
  }
}

export function shouldAutoStartRapidOcrSidecar(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OCR_SIDECAR_ENABLED === "0" || env.RAPID_OCR_AUTOSTART === "0") {
    return false;
  }
  const engine = (env.OCR_ENGINE || "auto").toLowerCase();
  if (engine !== "auto" && engine !== "rapid") {
    return false;
  }
  const endpoint = env.RAPID_OCR_ENDPOINT || defaultRapidOcrEndpoint;
  return isLocalRapidOcrEndpoint(endpoint);
}

export function rapidOcrHealthUrl(endpoint: string): string {
  return endpoint.replace(/\/ocr\/?$/, "/health");
}

function defaultRapidOcrPythonPath(): string {
  const localPython = path.join(projectRoot(), ".venv-paddleocr", "bin", "python");
  return existsSync(localPython) ? localPython : "python3";
}

function defaultRapidOcrScriptPath(): string {
  return path.join(projectRoot(), "scripts", "rapidocr-http-service.py");
}

function projectRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../../../..");
}

function isLocalRapidOcrEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port === "8766";
  } catch {
    return false;
  }
}

async function isHealthy(healthUrl: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(healthUrl: string, child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`process exited with code ${child.exitCode}`);
    }
    if (await isHealthy(healthUrl)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`health check timed out after ${timeoutMs}ms`);
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function noopSidecar(): OcrSidecarHandle {
  return {
    started: false,
    async stop() {}
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : typeof value === "number" ? value : undefined;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
