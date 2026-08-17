import { createHash } from "node:crypto";
import type {
  ExecutionProfileScreen,
  ExecutionProfileSnapshot,
  Platform
} from "@mobile-automation/shared";
import type { PageAssetCatalog } from "./page-asset-catalog.js";

export type { ExecutionProfileScreen, ExecutionProfileSnapshot } from "@mobile-automation/shared";

export type ExecutionProfileProvider = {
  createSnapshot(appId: string, platform: Platform): ExecutionProfileSnapshot;
};

export function createPageAssetExecutionProfileProvider(
  catalog: PageAssetCatalog
): ExecutionProfileProvider {
  return {
    createSnapshot(appId, platform) {
      const screens = catalog
        .listPages(appId, platform)
        .map((summary) => catalog.getPage(summary.id))
        .filter((page): page is NonNullable<ReturnType<PageAssetCatalog["getPage"]>> => Boolean(page))
        .map((page): ExecutionProfileScreen => ({
          screenRef: page.key,
          name: page.name,
          assetId: page.id,
          graphVersionId: page.graphVersionId,
          evidence: page.node.matchers.map((matcher) => ({ ...matcher }))
        }))
        .sort((left, right) => left.screenRef.localeCompare(right.screenRef));
      const graphVersionIds = [...new Set(screens.map((screen) => screen.graphVersionId))];
      const digest = sha256(JSON.stringify({
        appId,
        platform,
        screens
      }));
      return {
        id: `execution-profile:${appId}:${platform}:${graphVersionIds.join(",") || "empty"}`,
        appId,
        platform,
        version: 1,
        status: screens.length > 0 ? "verified" : "draft",
        digest,
        createdAt: new Date().toISOString(),
        screens
      };
    }
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
