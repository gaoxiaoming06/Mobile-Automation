import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RootPackageJson = {
  scripts: Record<string, string>;
};

const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as RootPackageJson;

describe("development script contract", () => {
  const scripts = rootPackage.scripts;

  it("starts the full HTTPS source stack by default", () => {
    expect(scripts.dev).toBe("pnpm dev:https:local");
    expect(scripts["dev:https:local"]).toContain("ensure-lan-https-cert.mjs");
    expect(scripts["dev:https:local"]).toContain("HTTPS=1");
    expect(scripts["dev:https:local"]).toContain("@mobile-automation/device-agent dev");
    expect(scripts["dev:https:local"]).toContain("DEVICE_AGENT_SERVER_URL=https://127.0.0.1:4010");
  });

  it("keeps web-only and HTTP development modes explicit", () => {
    expect(scripts["dev:web"]).toBe("pnpm dev:web:https");
    expect(scripts["dev:web:https"]).toContain("ensure-lan-https-cert.mjs");
    expect(scripts["dev:web:https"]).not.toContain("@mobile-automation/device-agent dev");

    expect(scripts["dev:http:web"]).toContain("@mobile-automation/server dev");
    expect(scripts["dev:http:web"]).toContain("@mobile-automation/dashboard dev");
    expect(scripts["dev:http:web"]).not.toContain("@mobile-automation/device-agent dev");

    expect(scripts["dev:http:local"]).toContain("@mobile-automation/device-agent dev");
    expect(scripts["dev:http:local"]).toContain("DEVICE_AGENT_SERVER_URL=http://127.0.0.1:4010");
  });
});
