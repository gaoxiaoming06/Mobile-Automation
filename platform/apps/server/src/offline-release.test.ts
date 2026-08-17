import { describe, expect, it } from "vitest";

type OfflineReleaseModule = {
  packageManagerCommandFor: (input: {
    npmExecPath?: string;
    nodeExecPath: string;
    platform: NodeJS.Platform;
    packageManager: string;
  }) => { command: string; args: string[] };
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

  it("runs pnpm directly when npm_execpath points to pnpm's native binary", async () => {
    const { packageManagerCommandFor } = await import(
      new URL("../../../../scripts/package-offline-release.mjs", import.meta.url).href
    ) as OfflineReleaseModule;

    expect(packageManagerCommandFor({
      npmExecPath: "/root/.local/share/pnpm/store/v11/links/@pnpm/exe/9.15.4/pnpm",
      nodeExecPath: "/root/.nvm/versions/node/v24.19.0/bin/node",
      platform: "linux",
      packageManager: "pnpm"
    })).toEqual({
      command: "pnpm",
      args: ["build"]
    });
  });
});
