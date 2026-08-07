import { describe, expect, it } from "vitest";
import { pageAssetDeprecationConfirmation } from "./page-asset-deprecation-guard.js";

describe("page asset deprecation guard", () => {
  it("rejects deprecation without the explicit confirmation token", () => {
    expect(pageAssetDeprecationConfirmation({})).toEqual({
      ok: false,
      error: "停用页面资产需要显式确认。"
    });
    expect(pageAssetDeprecationConfirmation({ confirm: "delete" })).toEqual({
      ok: false,
      error: "停用页面资产需要显式确认。"
    });
  });

  it("allows deprecation with the explicit confirmation token", () => {
    expect(pageAssetDeprecationConfirmation({ confirm: "deprecate-page-asset" })).toEqual({ ok: true });
  });
});
