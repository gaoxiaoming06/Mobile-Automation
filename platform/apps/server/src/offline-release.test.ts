import { describe, expect, it } from "vitest";

type OfflineReleaseModule = {
  releaseManifestFor: (input: {
    packageName: string;
    packageVersion: string;
    agentVersion: string;
  }) => unknown;
};

describe("offline release package", () => {
  it("describes the compiled runtime, Agent distribution, and OCR setup artifacts", async () => {
    const { releaseManifestFor } = await import(
      new URL("../../../../scripts/package-offline-release.mjs", import.meta.url).href
    ) as OfflineReleaseModule;

    expect(releaseManifestFor({
      packageName: "mobile-automation",
      packageVersion: "0.1.0",
      agentVersion: "0.1.1"
    })).toEqual({
      name: "mobile-automation",
      version: "0.1.0",
      agentVersion: "0.1.1",
      startCommand: "OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 node platform/apps/server/dist/index.mjs",
      buildArtifacts: [
        "platform/apps/server/dist",
        "platform/apps/dashboard/dist",
        "platform/apps/server/public/agent",
        "scripts/rapidocr-http-service.py",
        "scripts/setup-ocr.mjs",
        "scripts/ensure-lan-https-cert.mjs",
        "requirements-ocr.txt"
      ]
    });
  });
});
