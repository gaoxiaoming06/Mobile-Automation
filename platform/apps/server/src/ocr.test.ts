import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  CompositeOcrService,
  PaddleOcrService,
  RapidOcrService,
  createDefaultOcrService,
  visionLanguageArgument,
  type OcrInput,
  type OcrResult,
  type OcrService
} from "./ocr.js";

describe("OCR service selection", () => {
  it("falls back to the next OCR engine when the first one is unavailable", async () => {
    const service = new CompositeOcrService([new ThrowingOcrService("missing tesseract"), new StaticOcrService("课程已开始", "macos-vision")]);

    const result = await service.recognize({ image: Buffer.from("png") });

    expect(result).toEqual({
      text: "课程已开始",
      engine: "macos-vision",
      lang: "test"
    });
  });

  it("keeps the failed engine details when every OCR engine is unavailable", async () => {
    const service = new CompositeOcrService([new ThrowingOcrService("missing tesseract"), new ThrowingOcrService("vision failed")]);

    await expect(service.recognize({ image: Buffer.from("png") })).rejects.toThrow(
      "OCR engines unavailable: missing tesseract; vision failed"
    );
  });

  it("uses automatic OCR engine selection by default", () => {
    const service = createDefaultOcrService({});

    expect(service).toBeInstanceOf(CompositeOcrService);
  });

  it("uses PaddleOCR when explicitly configured", () => {
    const service = createDefaultOcrService({
      OCR_ENGINE: "paddle",
      PADDLE_OCR_ENDPOINT: "http://127.0.0.1:8765/ocr"
    });

    expect(service).toBeInstanceOf(PaddleOcrService);
  });

  it("uses RapidOCR when explicitly configured", () => {
    const service = createDefaultOcrService({
      OCR_ENGINE: "rapid",
      RAPID_OCR_ENDPOINT: "http://127.0.0.1:8766/ocr"
    });

    expect(service).toBeInstanceOf(RapidOcrService);
  });

  it("normalizes PaddleOCR HTTP text and layout responses", async () => {
    const image = Buffer.from("png");
    await withPaddleOcrServer(
      (payload) => {
        expect(payload).toEqual({
          imageBase64: image.toString("base64"),
          lang: "chi_sim"
        });
        return {
          text: "主页\n消息",
          engine: "paddleocr",
          lang: "chi_sim",
          width: 1080,
          height: 2400,
          boxes: [
            { text: "主页", confidence: 0.98, x: 100, y: 80, width: 120, height: 42 },
            { text: "消息", confidence: 0.95, x: 480, y: 2200, width: 80, height: 36 }
          ]
        };
      },
      async (endpoint) => {
        const service = new PaddleOcrService(endpoint, "eng+chi_sim", 1000);

        await expect(service.recognize({ image, lang: "chi_sim" })).resolves.toEqual({
          text: "主页\n消息",
          engine: "paddleocr",
          lang: "chi_sim"
        });
        await expect(service.locateText?.({ image, lang: "chi_sim" })).resolves.toEqual({
          text: "主页\n消息",
          engine: "paddleocr",
          lang: "chi_sim",
          width: 1080,
          height: 2400,
          boxes: [
            { text: "主页", confidence: 0.98, x: 100, y: 80, width: 120, height: 42 },
            { text: "消息", confidence: 0.95, x: 480, y: 2200, width: 80, height: 36 }
          ]
        });
      }
    );
  });

  it("normalizes RapidOCR HTTP text and layout responses", async () => {
    const image = Buffer.from("png");
    await withOcrHttpServer(
      (payload) => {
        expect(payload).toEqual({
          imageBase64: image.toString("base64"),
          lang: "chi_sim"
        });
        return {
          text: "主页\n消息",
          engine: "rapidocr",
          lang: "chi_sim",
          width: 1080,
          height: 2400,
          boxes: [
            { text: "主页", confidence: 0.99, points: [[100, 80], [220, 80], [220, 122], [100, 122]] },
            { text: "消息", confidence: 0.96, x: 480, y: 2200, width: 80, height: 36 }
          ]
        };
      },
      async (endpoint) => {
        const service = new RapidOcrService(endpoint, "eng+chi_sim", 1000);

        await expect(service.recognize({ image, lang: "chi_sim" })).resolves.toEqual({
          text: "主页\n消息",
          engine: "rapidocr",
          lang: "chi_sim"
        });
        await expect(service.locateText?.({ image, lang: "chi_sim" })).resolves.toEqual({
          text: "主页\n消息",
          engine: "rapidocr",
          lang: "chi_sim",
          width: 1080,
          height: 2400,
          boxes: [
            { text: "主页", confidence: 0.99, x: 100, y: 80, width: 120, height: 42 },
            { text: "消息", confidence: 0.96, x: 480, y: 2200, width: 80, height: 36 }
          ]
        });
      }
    );
  });

  it("prioritizes Chinese for macOS Vision language recognition", () => {
    expect(visionLanguageArgument("eng+chi_sim")).toBe("zh-Hans,en-US");
    expect(visionLanguageArgument("en-US,zh-Hans")).toBe("zh-Hans,en-US");
  });
});

async function withPaddleOcrServer(
  responseForPayload: (payload: Record<string, unknown>) => Record<string, unknown>,
  run: (endpoint: string) => Promise<void>
): Promise<void> {
  return withOcrHttpServer(responseForPayload, run);
}

async function withOcrHttpServer(
  responseForPayload: (payload: Record<string, unknown>) => Record<string, unknown>,
  run: (endpoint: string) => Promise<void>
): Promise<void> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/ocr") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const payload = JSON.parse(await readRequestBody(req)) as Record<string, unknown>;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(responseForPayload(payload)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind PaddleOCR test server");
  }
  try {
    await run(`http://127.0.0.1:${address.port}/ocr`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      })
    );
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

class StaticOcrService implements OcrService {
  constructor(
    private readonly text: string,
    private readonly engine: string
  ) {}

  async recognize(input: OcrInput): Promise<OcrResult> {
    return {
      text: this.text,
      engine: this.engine,
      lang: input.lang ?? "test"
    };
  }
}

class ThrowingOcrService implements OcrService {
  constructor(private readonly message: string) {}

  async recognize(_input: OcrInput): Promise<OcrResult> {
    throw new Error(this.message);
  }
}
