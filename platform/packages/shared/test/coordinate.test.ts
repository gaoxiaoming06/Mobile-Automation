import { describe, expect, it } from "vitest";
import { viewportPointToDevicePoint } from "../src/index.js";

describe("viewportPointToDevicePoint", () => {
  it("maps a centered click without letterbox", () => {
    const point = viewportPointToDevicePoint(
      { x: 50, y: 100 },
      { left: 0, top: 0, width: 100, height: 200 },
      { width: 100, height: 200 },
      { width: 1080, height: 2160 }
    );

    expect(point.x).toBe(540);
    expect(point.y).toBe(1080);
  });

  it("removes horizontal letterbox offset", () => {
    const point = viewportPointToDevicePoint(
      { x: 100, y: 50 },
      { left: 0, top: 0, width: 200, height: 100 },
      { width: 100, height: 100 },
      { width: 1000, height: 1000 }
    );

    expect(point.x).toBe(500);
    expect(point.y).toBe(500);
  });
});
