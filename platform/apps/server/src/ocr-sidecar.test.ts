import { describe, expect, it } from "vitest";
import { rapidOcrHealthUrl, shouldAutoStartRapidOcrSidecar } from "./ocr-sidecar.js";

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
});
