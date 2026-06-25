#!/usr/bin/env python3
"""Small local HTTP wrapper for RapidOCR.

The Node server talks to this process through:

POST /ocr
{
  "imageBase64": "...",
  "lang": "chi_sim"
}

The response is normalized to the Mobile-Automation OCR contract.
"""

from __future__ import annotations

import base64
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


HOST = os.environ.get("RAPID_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("RAPID_OCR_PORT", "8766"))
DEFAULT_LANG = os.environ.get("RAPID_OCR_LANG", "eng+chi_sim")


class RapidOcrRuntime:
    def __init__(self) -> None:
        self._ocr: Any | None = None

    def recognize(self, image_path: Path, lang: str) -> dict[str, Any]:
        ocr = self._get_ocr()
        result = ocr(str(image_path))
        boxes = normalize_result(result)
        width, height = image_size(image_path)
        return {
            "text": "\n".join(box["text"] for box in boxes if box.get("text")),
            "engine": "rapidocr",
            "lang": lang,
            "width": width,
            "height": height,
            "boxes": boxes,
        }

    def _get_ocr(self) -> Any:
        if self._ocr is not None:
            return self._ocr
        from rapidocr import RapidOCR

        self._ocr = RapidOCR()
        return self._ocr


runtime = RapidOcrRuntime()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json({"ok": True, "service": "rapidocr-http-service"})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/ocr":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            image_base64 = payload.get("imageBase64")
            if not isinstance(image_base64, str) or not image_base64:
                self.send_error(400, "imageBase64 is required")
                return
            lang = str(payload.get("lang") or DEFAULT_LANG)
            image_bytes = base64.b64decode(image_base64)
            with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as image_file:
                image_file.write(image_bytes)
                image_file.flush()
                result = runtime.recognize(Path(image_file.name), lang)
            self.write_json(result)
        except Exception as error:  # noqa: BLE001 - service boundary should return details.
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(error)}, ensure_ascii=False).encode("utf-8"))

    def log_message(self, format: str, *args: Any) -> None:
        if os.environ.get("RAPID_OCR_LOG_REQUESTS") == "1":
            super().log_message(format, *args)

    def write_json(self, payload: dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def normalize_result(result: Any) -> list[dict[str, Any]]:
    txts = list(getattr(result, "txts", None) or [])
    scores = list(getattr(result, "scores", None) or [])
    raw_boxes = getattr(result, "boxes", None)
    if raw_boxes is None and isinstance(result, (list, tuple)) and result:
        return normalize_legacy_rows(result)
    boxes: list[dict[str, Any]] = []
    for index, text in enumerate(txts):
        rect = points_to_rect(raw_boxes[index] if index < len(raw_boxes) else None)
        if not rect:
            continue
        item: dict[str, Any] = {
            "text": str(text),
            **rect,
        }
        confidence = number(scores[index]) if index < len(scores) else None
        if confidence is not None:
            item["confidence"] = confidence
        boxes.append(item)
    return boxes


def normalize_legacy_rows(rows: Any) -> list[dict[str, Any]]:
    boxes: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        rect = points_to_rect(item[0])
        text_info = item[1]
        if not rect or not isinstance(text_info, (list, tuple)) or not text_info:
            continue
        box: dict[str, Any] = {
            "text": str(text_info[0]),
            **rect,
        }
        confidence = number(text_info[1]) if len(text_info) > 1 else None
        if confidence is not None:
            box["confidence"] = confidence
        boxes.append(box)
    return boxes


def points_to_rect(points: Any) -> dict[str, float] | None:
    if hasattr(points, "tolist"):
        points = points.tolist()
    if not isinstance(points, (list, tuple)):
        return None
    parsed: list[tuple[float, float]] = []
    for point in points:
        if hasattr(point, "tolist"):
            point = point.tolist()
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        x = number(point[0])
        y = number(point[1])
        if x is None or y is None:
            continue
        parsed.append((x, y))
    if not parsed:
        return None
    xs = [point[0] for point in parsed]
    ys = [point[1] for point in parsed]
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def image_size(image_path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(image_path) as image:
            return image.size
    except Exception:
        return 0, 0


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"RapidOCR HTTP service listening on http://{HOST}:{PORT}/ocr", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
