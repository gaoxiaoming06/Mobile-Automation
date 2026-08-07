import { describe, expect, it } from "vitest";
import { resolveServerHost, resolveServerNetworkConfig } from "./server-network.js";

describe("server network binding", () => {
  it("binds to loopback unless an operator explicitly overrides the host", () => {
    expect(resolveServerHost({})).toBe("127.0.0.1");
    expect(resolveServerHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("keeps plain HTTP as the default protocol", () => {
    expect(resolveServerNetworkConfig({}, "/repo")).toEqual({
      host: "127.0.0.1",
      protocol: "http"
    });
  });

  it("enables HTTPS with generated certificate defaults", () => {
    expect(resolveServerNetworkConfig({ HOST: "0.0.0.0", HTTPS: "1" }, "/repo")).toEqual({
      host: "0.0.0.0",
      protocol: "https",
      https: {
        keyPath: "/repo/.cert/mobile-automation-lan-key.pem",
        certPath: "/repo/.cert/mobile-automation-lan-cert.pem"
      }
    });
  });

  it("uses explicitly configured HTTPS certificate paths", () => {
    expect(resolveServerNetworkConfig({
      HTTPS: "true",
      HTTPS_KEY: "certs/key.pem",
      HTTPS_CERT: "/shared/cert.pem"
    }, "/repo")).toEqual({
      host: "127.0.0.1",
      protocol: "https",
      https: {
        keyPath: "/repo/certs/key.pem",
        certPath: "/shared/cert.pem"
      }
    });
  });
});
