#!/usr/bin/env python3
"""Small local HTTP wrapper for PaddleOCR.

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


HOST = os.environ.get("PADDLE_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("PADDLE_OCR_PORT", "8765"))
DEFAULT_LANG = os.environ.get("PADDLE_OCR_LANG", "ch")


class PaddleOcrRuntime:
    def __init__(self) -> None:
        self._ocr_by_lang: dict[str, Any] = {}

    def recognize(self, image_path: Path, lang: str) -> dict[str, Any]:
        paddle_lang = to_paddle_lang(lang)
        ocr = self._get_ocr(paddle_lang)
        if hasattr(ocr, "predict"):
            raw = ocr.predict(input=str(image_path))
            boxes = normalize_predict_result(raw)
        else:
            raw = ocr.ocr(str(image_path), cls=True)
            boxes = normalize_legacy_result(raw)
        return {
            "text": "\n".join(box["text"] for box in boxes if box.get("text")),
            "engine": "paddleocr",
            "lang": lang,
            "width": image_size(image_path)[0],
            "height": image_size(image_path)[1],
            "boxes": boxes,
        }

    def _get_ocr(self, paddle_lang: str) -> Any:
        if paddle_lang in self._ocr_by_lang:
            return self._ocr_by_lang[paddle_lang]
        from paddleocr import PaddleOCR

        try:
            ocr = PaddleOCR(lang=paddle_lang)
        except TypeError:
            ocr = PaddleOCR(use_angle_cls=True, lang=paddle_lang)
        self._ocr_by_lang[paddle_lang] = ocr
        return ocr


runtime = PaddleOcrRuntime()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/health":
            self.write_json({"ok": True, "service": "paddleocr-http-service"})
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
        if os.environ.get("PADDLE_OCR_LOG_REQUESTS") == "1":
            super().log_message(format, *args)

    def write_json(self, payload: dict[str, Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))


def to_paddle_lang(lang: str) -> str:
    normalized = lang.lower().replace("-", "_")
    if "chi" in normalized or "zh" in normalized:
        return "ch"
    if normalized.startswith("en") or normalized == "eng":
        return "en"
    return DEFAULT_LANG


def normalize_predict_result(raw: Any) -> list[dict[str, Any]]:
    items = raw if isinstance(raw, list) else [raw]
    boxes: list[dict[str, Any]] = []
    for item in items:
        data = result_to_dict(item)
        if isinstance(data, dict) and "res" in data and isinstance(data["res"], dict):
            data = data["res"]
        if not isinstance(data, dict):
            continue
        texts = data.get("rec_texts") or data.get("texts") or []
        scores = data.get("rec_scores") or data.get("scores") or []
        polys = data.get("rec_polys") or data.get("dt_polys") or data.get("rec_boxes") or data.get("boxes") or []
        for index, text in enumerate(texts):
            rect = points_to_rect(polys[index] if index < len(polys) else None)
            if not rect:
                continue
            boxes.append({
                "text": str(text),
                "confidence": number(scores[index]) if index < len(scores) else None,
                **rect,
            })
    return boxes


def result_to_dict(item: Any) -> Any:
    json_value = getattr(item, "json", None)
    if callable(json_value):
        try:
            return json_value()
        except TypeError:
            return item
    if json_value is not None:
        return json_value
    res_value = getattr(item, "res", None)
    if res_value is not None:
        return {"res": res_value}
    return item


def normalize_legacy_result(raw: Any) -> list[dict[str, Any]]:
    rows = raw[0] if isinstance(raw, list) and len(raw) == 1 and isinstance(raw[0], list) else raw
    boxes: list[dict[str, Any]] = []
    if not isinstance(rows, list):
        return boxes
    for item in rows:
        if not isinstance(item, list) or len(item) < 2:
            continue
        rect = points_to_rect(item[0])
        text_info = item[1]
        if not rect or not isinstance(text_info, (list, tuple)) or not text_info:
            continue
        boxes.append({
            "text": str(text_info[0]),
            "confidence": number(text_info[1]) if len(text_info) > 1 else None,
            **rect,
        })
    return boxes


def points_to_rect(points: Any) -> dict[str, float] | None:
    if hasattr(points, "tolist"):
        points = points.tolist()
    if not isinstance(points, (list, tuple)):
        return None
    flat_numbers = [number(point) for point in points]
    if len(flat_numbers) >= 4 and all(item is not None for item in flat_numbers[:4]):
        left, top, right, bottom = flat_numbers[:4]
        assert left is not None and top is not None and right is not None and bottom is not None
        return {
            "x": min(left, right),
            "y": min(top, bottom),
            "width": abs(right - left),
            "height": abs(bottom - top),
        }
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
    print(f"PaddleOCR HTTP service listening on http://{HOST}:{PORT}/ocr", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
