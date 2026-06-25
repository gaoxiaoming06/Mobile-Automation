import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OcrInput = {
  image: Buffer;
  lang?: string;
  mode?: "contains" | "equals" | "not_contains";
};

export type OcrResult = {
  text: string;
  engine: string;
  lang: string;
};

export type OcrTextBox = {
  text: string;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrLayoutResult = OcrResult & {
  width: number;
  height: number;
  boxes: OcrTextBox[];
};

export interface OcrService {
  recognize(input: OcrInput): Promise<OcrResult>;
  locateText?(input: OcrInput): Promise<OcrLayoutResult>;
}

type OcrEnginePreference = "auto" | "rapid" | "paddle" | "tesseract" | "vision";

const defaultVisionScriptPath = fileURLToPath(new URL("./vision-ocr.swift", import.meta.url));
const defaultRapidOcrEndpoint = "http://127.0.0.1:8766/ocr";
const defaultPaddleOcrEndpoint = "http://127.0.0.1:8765/ocr";

export class TesseractOcrService implements OcrService {
  constructor(
    private readonly command = process.env.TESSERACT_CMD || "tesseract",
    private readonly defaultLang = process.env.OCR_LANG || "eng+chi_sim"
  ) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const lang = input.lang?.trim() || this.defaultLang;
    const text = await runTesseract(this.command, input.image, lang);
    return {
      text,
      engine: "tesseract",
      lang
    };
  }
}

export class MacVisionOcrService implements OcrService {
  constructor(
    private readonly command = process.env.SWIFT_CMD || "/usr/bin/swift",
    private readonly scriptPath = process.env.OCR_VISION_SCRIPT || defaultVisionScriptPath,
    private readonly defaultLang = process.env.OCR_LANG || "eng+chi_sim"
  ) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (process.platform !== "darwin") {
      throw new Error("macOS Vision OCR is only available on macOS");
    }
    const lang = input.lang?.trim() || this.defaultLang;
    const text = await runMacVisionOcr(this.command, this.scriptPath, input.image, lang);
    return {
      text,
      engine: "macos-vision",
      lang
    };
  }

  async locateText(input: OcrInput): Promise<OcrLayoutResult> {
    if (process.platform !== "darwin") {
      throw new Error("macOS Vision OCR is only available on macOS");
    }
    const lang = input.lang?.trim() || this.defaultLang;
    const raw = await runMacVisionOcr(this.command, this.scriptPath, input.image, lang, "json");
    const parsed = parseVisionOcrJson(raw);
    return {
      text: parsed.boxes.map((box) => box.text).join("\n"),
      engine: "macos-vision",
      lang,
      width: parsed.width,
      height: parsed.height,
      boxes: parsed.boxes
    };
  }
}

export class PaddleOcrService implements OcrService {
  constructor(
    private readonly endpoint = process.env.PADDLE_OCR_ENDPOINT || defaultPaddleOcrEndpoint,
    private readonly defaultLang = process.env.OCR_LANG || "eng+chi_sim",
    private readonly timeoutMs = positiveNumber(process.env.PADDLE_OCR_TIMEOUT_MS) ?? 15_000
  ) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const result = await this.request(input);
    return {
      text: result.text,
      engine: result.engine,
      lang: result.lang
    };
  }

  async locateText(input: OcrInput): Promise<OcrLayoutResult> {
    return this.request(input);
  }

  private async request(input: OcrInput): Promise<OcrLayoutResult> {
    const lang = input.lang?.trim() || this.defaultLang;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageBase64: input.image.toString("base64"),
          lang
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`PaddleOCR service responded ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const parsed = (await response.json()) as unknown;
      return parseHttpOcrResponse(parsed, lang, "paddleocr");
    } catch (error) {
      throw new Error(`PaddleOCR engine unavailable: ${errorToString(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class RapidOcrService implements OcrService {
  constructor(
    private readonly endpoint = process.env.RAPID_OCR_ENDPOINT || defaultRapidOcrEndpoint,
    private readonly defaultLang = process.env.OCR_LANG || "eng+chi_sim",
    private readonly timeoutMs = positiveNumber(process.env.RAPID_OCR_TIMEOUT_MS) ?? 15_000
  ) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const result = await this.request(input);
    return {
      text: result.text,
      engine: result.engine,
      lang: result.lang
    };
  }

  async locateText(input: OcrInput): Promise<OcrLayoutResult> {
    return this.request(input);
  }

  private async request(input: OcrInput): Promise<OcrLayoutResult> {
    const lang = input.lang?.trim() || this.defaultLang;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          imageBase64: input.image.toString("base64"),
          lang
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`RapidOCR service responded ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const parsed = (await response.json()) as unknown;
      return parseHttpOcrResponse(parsed, lang, "rapidocr");
    } catch (error) {
      throw new Error(`RapidOCR engine unavailable: ${errorToString(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class CompositeOcrService implements OcrService {
  constructor(private readonly services: OcrService[]) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    const errors: string[] = [];
    for (const service of this.services) {
      try {
        return await service.recognize(input);
      } catch (error) {
        errors.push(errorToString(error));
      }
    }
    throw new Error(errors.length ? `OCR engines unavailable: ${errors.join("; ")}` : "No OCR engines are configured");
  }

  async locateText(input: OcrInput): Promise<OcrLayoutResult> {
    const errors: string[] = [];
    for (const service of this.services) {
      if (!service.locateText) {
        continue;
      }
      try {
        return await service.locateText(input);
      } catch (error) {
        errors.push(errorToString(error));
      }
    }
    throw new Error(errors.length ? `OCR layout engines unavailable: ${errors.join("; ")}` : "No OCR layout engines are configured");
  }
}

export function createDefaultOcrService(env: NodeJS.ProcessEnv = process.env): OcrService {
  const engine = normalizeOcrEngine(env.OCR_ENGINE);
  if (engine === "rapid") {
    return new RapidOcrService(env.RAPID_OCR_ENDPOINT || defaultRapidOcrEndpoint, env.OCR_LANG || "eng+chi_sim", positiveNumber(env.RAPID_OCR_TIMEOUT_MS) ?? 15_000);
  }
  if (engine === "paddle") {
    return new PaddleOcrService(env.PADDLE_OCR_ENDPOINT || defaultPaddleOcrEndpoint, env.OCR_LANG || "eng+chi_sim", positiveNumber(env.PADDLE_OCR_TIMEOUT_MS) ?? 15_000);
  }
  if (engine === "tesseract") {
    return new TesseractOcrService(env.TESSERACT_CMD || "tesseract", env.OCR_LANG || "eng+chi_sim");
  }
  if (engine === "vision") {
    return new MacVisionOcrService(env.SWIFT_CMD || "/usr/bin/swift", env.OCR_VISION_SCRIPT || defaultVisionScriptPath, env.OCR_LANG || "eng+chi_sim");
  }
  return new CompositeOcrService([
    new RapidOcrService(env.RAPID_OCR_ENDPOINT || defaultRapidOcrEndpoint, env.OCR_LANG || "eng+chi_sim", positiveNumber(env.RAPID_OCR_TIMEOUT_MS) ?? 15_000),
    new PaddleOcrService(env.PADDLE_OCR_ENDPOINT || defaultPaddleOcrEndpoint, env.OCR_LANG || "eng+chi_sim", positiveNumber(env.PADDLE_OCR_TIMEOUT_MS) ?? 15_000),
    new TesseractOcrService(env.TESSERACT_CMD || "tesseract", env.OCR_LANG || "eng+chi_sim"),
    new MacVisionOcrService(env.SWIFT_CMD || "/usr/bin/swift", env.OCR_VISION_SCRIPT || defaultVisionScriptPath, env.OCR_LANG || "eng+chi_sim")
  ]);
}

function parseHttpOcrResponse(value: unknown, fallbackLang: string, defaultEngine: string): OcrLayoutResult {
  if (!value || typeof value !== "object") {
    throw new Error("OCR HTTP response must be a JSON object");
  }
  const input = value as Record<string, unknown>;
  const boxes = readHttpOcrBoxes(input.boxes);
  const text = stringField(input.text) ?? boxes.map((box) => box.text).filter(Boolean).join("\n");
  return {
    text,
    engine: stringField(input.engine) ?? defaultEngine,
    lang: stringField(input.lang) ?? fallbackLang,
    width: numberField(input.width),
    height: numberField(input.height),
    boxes
  };
}

function readHttpOcrBoxes(value: unknown): OcrTextBox[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const box = item as Record<string, unknown>;
      const text = stringField(box.text);
      const rect = readHttpOcrRect(box);
      if (!text || !rect) {
        return undefined;
      }
      const result: OcrTextBox = {
        text,
        ...rect
      };
      const confidence = optionalNumberField(box.confidence ?? box.score);
      if (confidence !== undefined) {
        result.confidence = confidence;
      }
      return result;
    })
    .filter((item): item is OcrTextBox => Boolean(item));
}

function readHttpOcrRect(box: Record<string, unknown>): Pick<OcrTextBox, "x" | "y" | "width" | "height"> | undefined {
  const x = optionalNumberField(box.x);
  const y = optionalNumberField(box.y);
  const width = optionalNumberField(box.width);
  const height = optionalNumberField(box.height);
  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    return { x, y, width, height };
  }
  const points = readHttpOcrPoints(box.points);
  if (points) {
    return pointsToRect(points);
  }
  return undefined;
}

function readHttpOcrPoints(value: unknown): Array<{ x: number; y: number }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const points = value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return undefined;
      }
      const x = optionalNumberField(point[0]);
      const y = optionalNumberField(point[1]);
      return x === undefined || y === undefined ? undefined : { x, y };
    })
    .filter((point): point is { x: number; y: number } => Boolean(point));
  return points.length ? points : undefined;
}

function pointsToRect(points: Array<{ x: number; y: number }>): Pick<OcrTextBox, "x" | "y" | "width" | "height"> {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function runTesseract(command: string, image: Buffer, lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["stdin", "stdout", "-l", lang, "--psm", "6"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`OCR engine unavailable: ${error.message}`));
    });
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(detail || `OCR engine exited with code ${code ?? "unknown"}`));
    });

    child.stdin.end(image);
  });
}

async function runMacVisionOcr(command: string, scriptPath: string, image: Buffer, lang: string, outputMode = "text"): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mobile-automation-ocr-"));
  const imagePath = path.join(tempDir, "screen.png");
  try {
    await writeFile(imagePath, image);
    return await runCommand(command, [scriptPath, imagePath, visionLanguageArgument(lang)], 15_000, {
      OCR_VISION_OUTPUT: outputMode
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCommand(command: string, args: string[], timeoutMs: number, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...env
      }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`OCR engine unavailable: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`OCR engine timed out after ${timeoutMs}ms`));
        return;
      }
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(detail || `OCR engine exited with code ${code ?? "unknown"}`));
    });
  });
}

function parseVisionOcrJson(raw: string): { width: number; height: number; boxes: OcrTextBox[] } {
  const parsed = JSON.parse(raw) as {
    width?: unknown;
    height?: unknown;
    boxes?: Array<Record<string, unknown>>;
  };
  return {
    width: numberField(parsed.width),
    height: numberField(parsed.height),
    boxes: Array.isArray(parsed.boxes)
      ? parsed.boxes.map((box) => ({
          text: typeof box.text === "string" ? box.text : "",
          confidence: typeof box.confidence === "number" ? box.confidence : undefined,
          x: numberField(box.x),
          y: numberField(box.y),
          width: numberField(box.width),
          height: numberField(box.height)
        }))
      : []
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = optionalNumberField(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function visionLanguageArgument(lang: string): string {
  return lang
    .split(/[+,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(toVisionLanguage)
    .filter(uniqueLanguage)
    .sort(visionLanguagePriority)
    .join(",");
}

function toVisionLanguage(lang: string): string {
  const normalized = lang.toLowerCase();
  if (normalized === "eng" || normalized === "en") {
    return "en-US";
  }
  if (normalized === "chi_sim" || normalized === "zh" || normalized === "zh_cn" || normalized === "zh-hans") {
    return "zh-Hans";
  }
  if (normalized === "chi_tra" || normalized === "zh_tw" || normalized === "zh-hant") {
    return "zh-Hant";
  }
  return lang;
}

function uniqueLanguage(language: string, index: number, languages: string[]): boolean {
  return languages.indexOf(language) === index;
}

function visionLanguagePriority(left: string, right: string): number {
  return languagePriority(left) - languagePriority(right);
}

function languagePriority(language: string): number {
  const normalized = language.toLowerCase();
  if (normalized.startsWith("zh-")) {
    return 0;
  }
  if (normalized.startsWith("en-")) {
    return 1;
  }
  return 2;
}

function normalizeOcrEngine(value: string | undefined): OcrEnginePreference {
  if (value === "rapid" || value === "paddle" || value === "tesseract" || value === "vision") {
    return value;
  }
  return "auto";
}

function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
