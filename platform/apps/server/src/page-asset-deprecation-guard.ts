export const PAGE_ASSET_DEPRECATION_CONFIRMATION = "deprecate-page-asset";

export type PageAssetDeprecationConfirmation =
  | { ok: true }
  | { ok: false; error: string };

export function pageAssetDeprecationConfirmation(input: Record<string, unknown>): PageAssetDeprecationConfirmation {
  return input.confirm === PAGE_ASSET_DEPRECATION_CONFIRMATION
    ? { ok: true }
    : { ok: false, error: "停用页面资产需要显式确认。" };
}
