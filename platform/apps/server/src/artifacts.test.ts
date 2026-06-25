import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactFilePath, artifactRoot, artifactSendFileOptions } from "./artifacts.js";

describe("artifact path helpers", () => {
  it("allows sending artifacts from hidden OS data directories", () => {
    expect(artifactSendFileOptions).toEqual({ dotfiles: "allow" });
  });

  it("resolves relative artifact paths under the artifact root", () => {
    expect(artifactFilePath("runs/run-1/reports/report.html")).toBe(path.join(artifactRoot, "runs", "run-1", "reports", "report.html"));
  });

  it("rejects path traversal", () => {
    expect(() => artifactFilePath("../outside/report.html")).toThrow("Invalid artifact path");
  });
});
