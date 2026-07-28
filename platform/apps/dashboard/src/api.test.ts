import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetchJson } from "./api.js";

describe("apiFetchJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves structured validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "ScriptFlow 校验失败",
      issues: [{ path: "$.steps[0].tap", message: "缺少 target" }]
    }), { status: 400, headers: { "content-type": "application/json" } })));

    const error = await apiFetchJson("/api/script-flows/validate").catch((reason) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: "ScriptFlow 校验失败",
      status: 400,
      payload: { issues: [{ path: "$.steps[0].tap", message: "缺少 target" }] }
    });
  });
});
