import { describe, expect, it } from "vitest";
import { resolveServerHost } from "./server-network.js";

describe("server network binding", () => {
  it("binds to loopback unless an operator explicitly overrides the host", () => {
    expect(resolveServerHost({})).toBe("127.0.0.1");
    expect(resolveServerHost({ HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });
});
