import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rapidOcrHealthUrl, resolveRapidOcrPythonPath, shouldAutoStartRapidOcrSidecar } from "./ocr-sidecar.js";

describe("OCR sidecar", () => {
  it("auto-starts RapidOCR for auto and rapid engines on the default local endpoint", () => {
    expect(shouldAutoStartRapidOcrSidecar({})).toBe(true);
    expect(shouldAutoStartRapidOcrSidecar({ OCR_ENGINE: "auto" })).toBe(true);
    expect(shouldAutoStartRapidOcrSidecar({ OCR_ENGINE: "rapid" })).toBe(true);
  });

  it("does not auto-start RapidOCR when another engine is forced", () => {
    expect(shouldAutoStartRapidOcrSidecar({ OCR_ENGINE: "vision" })).toBe(false);
    expect(shouldAutoStartRapidOcrSidecar({ OCR_ENGINE: "paddle" })).toBe(false);
  });

  it("can be disabled explicitly", () => {
    expect(shouldAutoStartRapidOcrSidecar({ OCR_SIDECAR_ENABLED: "0" })).toBe(false);
    expect(shouldAutoStartRapidOcrSidecar({ RAPID_OCR_AUTOSTART: "0" })).toBe(false);
  });

  it("does not auto-start for custom remote endpoints", () => {
    expect(shouldAutoStartRapidOcrSidecar({ RAPID_OCR_ENDPOINT: "http://10.0.0.2:8766/ocr" })).toBe(false);
  });

  it("derives the health URL from the OCR endpoint", () => {
    expect(rapidOcrHealthUrl("http://127.0.0.1:8766/ocr")).toBe("http://127.0.0.1:8766/health");
    expect(rapidOcrHealthUrl("http://127.0.0.1:8766/ocr/")).toBe("http://127.0.0.1:8766/health");
  });

  it("resolves the virtualenv Python path for the target platform", () => {
    const root = path.join(os.tmpdir(), `mobile-automation-ocr-${process.pid}-${Date.now()}`);
    const windowsPython = path.join(root, ".venv-paddleocr", "Scripts", "python.exe");
    mkdirSync(path.dirname(windowsPython), { recursive: true });
    writeFileSync(windowsPython, "");

    try {
      expect(existsSync(windowsPython)).toBe(true);
      expect(resolveRapidOcrPythonPath({}, "win32", root)).toBe(windowsPython);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
