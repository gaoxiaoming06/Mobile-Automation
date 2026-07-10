import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRapidOcrEndpoint = "http://127.0.0.1:8766/ocr";
const defaultStartupTimeoutMs = 30_000;
const defaultReadinessTimeoutMs = 5_000;
const smokeTestPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  const readiness = await checkRapidOcrReadiness(endpoint);
  if (readiness.ok) {
    console.log(`RapidOCR sidecar already available at ${healthUrl}`);
    return noopSidecar();
  }
  if (readiness.healthOk) {
    const message = `RapidOCR sidecar at ${healthUrl} failed OCR smoke test: ${readiness.error ?? "unknown error"}`;
    if (isRapidOcrRequired(env)) {
      throw new Error(message);
    }
    console.warn(message);
    return noopSidecar();
  }

  const scriptPath = env.RAPID_OCR_SCRIPT || defaultRapidOcrScriptPath();
  const python = resolveRapidOcrPythonPath(env);
  if (!python) {
    const message =
      "RapidOCR sidecar not started: .venv-paddleocr/bin/python is missing. Run `uv venv .venv-paddleocr --python 3.11 && uv pip install --python .venv-paddleocr/bin/python rapidocr onnxruntime pillow`, or set RAPID_OCR_PYTHON explicitly.";
    if (isRapidOcrRequired(env)) {
      throw new Error(message);
    }
    console.warn(message);
    return noopSidecar();
  }
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
    await waitForReadiness(endpoint, child, startupTimeoutMs);
    console.log(`RapidOCR sidecar started at ${healthUrl}`);
    return {
      started: true,
      stop: () => stopChild(child)
    };
  } catch (error) {
    await stopChild(child);
    const message = `RapidOCR sidecar failed to start: ${errorToString(error)}`;
    if (isRapidOcrRequired(env)) {
      throw new Error(message);
    }
    console.warn(message);
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

function isRapidOcrRequired(env: NodeJS.ProcessEnv): boolean {
  return (env.OCR_ENGINE || "auto").toLowerCase() === "rapid";
}

export function rapidOcrHealthUrl(endpoint: string): string {
  return endpoint.replace(/\/ocr\/?$/, "/health");
}

export function resolveRapidOcrPythonPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.RAPID_OCR_PYTHON) {
    return env.RAPID_OCR_PYTHON;
  }
  const localPython = path.join(projectRoot(), ".venv-paddleocr", "bin", "python");
  if (existsSync(localPython)) {
    return localPython;
  }
  return env.RAPID_OCR_ALLOW_SYSTEM_PYTHON === "1" ? "python3" : undefined;
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

type RapidOcrReadiness = {
  ok: boolean;
  healthOk: boolean;
  error?: string;
};

async function checkRapidOcrReadiness(endpoint: string, timeoutMs = defaultReadinessTimeoutMs): Promise<RapidOcrReadiness> {
  const healthUrl = rapidOcrHealthUrl(endpoint);
  const healthOk = await isHealthy(healthUrl);
  if (!healthOk) {
    return { ok: false, healthOk: false };
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageBase64: smokeTestPngBase64,
        lang: "eng+chi_sim"
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return { ok: false, healthOk: true, error: `HTTP ${response.status}: ${await response.text()}` };
    }
    const payload = (await response.json()) as { engine?: unknown; boxes?: unknown };
    if (payload.engine !== "rapidocr" || !Array.isArray(payload.boxes)) {
      return { ok: false, healthOk: true, error: "unexpected RapidOCR smoke response" };
    }
    return { ok: true, healthOk: true };
  } catch (error) {
    return { ok: false, healthOk: true, error: errorToString(error) };
  }
}

async function waitForReadiness(endpoint: string, child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`process exited with code ${child.exitCode}`);
    }
    if ((await checkRapidOcrReadiness(endpoint)).ok) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`readiness check timed out after ${timeoutMs}ms`);
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
