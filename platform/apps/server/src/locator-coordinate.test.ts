import { describe, expect, it } from "vitest";
import { scaleLocatorCoordinate } from "./locator-coordinate.js";

describe("locator coordinate scaling", () => {
  it("keeps screen coordinates when UI hierarchy only trims system bars", () => {
    expect(scaleLocatorCoordinate(1929, 2340, 2218)).toBe(1929);
  });

  it("scales coordinates when source and target are truly different sizes", () => {
    expect(scaleLocatorCoordinate(150, 1000, 500)).toBe(75);
  });
});
