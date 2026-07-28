import type express from "express";
import type { BusinessGraph, BusinessGraphVersion, GraphTargetProfile } from "@mobile-automation/graph-core";
import type { CreatePageAssetLibraryInput, Storage } from "./storage.js";

export type PageAssetLibraryApiStorage = Pick<
  Storage,
  "listBusinessGraphs" | "createPageAssetLibrary" | "getBusinessGraphVersionSummary"
>;

type SupportedPlatform = "android" | "ios";

export function registerPageAssetLibraryRoutes(
  app: express.Application,
  deps: { storage: PageAssetLibraryApiStorage }
): void {
  app.get("/api/page-assets", (req, res) => {
    try {
      const graphId = typeof req.query.graphId === "string" ? req.query.graphId.trim() : "";
      const libraries = deps.storage.listBusinessGraphs().filter((graph) => !graphId || graph.id === graphId);
      res.json({ libraries: libraries.map((graph) => libraryResponse(graph, deps.storage)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/page-assets", (req, res) => {
    try {
      const input = readCreateInput(req.body);
      if (deps.storage.listBusinessGraphs().some((library) => libraryOwnsTarget(library, input.platform, input.targetIdentifier))) {
        res.status(409).json({ error: "该 App 已有页面资产库" });
        return;
      }
      const library = deps.storage.createPageAssetLibrary(pageAssetLibraryInput(input));
      res.status(201).json({ library: libraryResponse(library, deps.storage) });
    } catch (error) {
      sendError(res, error);
    }
  });
}

function readCreateInput(body: unknown): {
  appId: string;
  name: string;
  platform: SupportedPlatform;
  targetIdentifier: string;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Request body must be an object");
  }
  const record = body as Record<string, unknown>;
  for (const field of Object.keys(record)) {
    if (!["appId", "name", "platform", "targetIdentifier"].includes(field)) {
      throw new RequestError(`Unknown request field: ${field}`);
    }
  }
  const appId = requiredString(record.appId, "appId");
  const name = requiredString(record.name, "name");
  const platform = record.platform;
  if (platform !== "android" && platform !== "ios") {
    throw new RequestError("platform must be android or ios");
  }
  const targetIdentifier = requiredString(record.targetIdentifier, "targetIdentifier");
  return { appId, name, platform, targetIdentifier };
}

function pageAssetLibraryInput(input: ReturnType<typeof readCreateInput>): CreatePageAssetLibraryInput {
  return {
    appId: input.appId,
    name: input.name,
    targetApp: {
      productId: input.appId,
      productName: input.name,
      profiles: [targetProfile(input)]
    }
  };
}

function targetProfile(input: ReturnType<typeof readCreateInput>): GraphTargetProfile {
  return {
    id: `${input.platform}:${input.targetIdentifier}`,
    platform: input.platform,
    displayName: `${input.name} ${input.platform === "android" ? "Android" : "iOS"}`,
    ...(input.platform === "android"
      ? { androidPackageName: input.targetIdentifier }
      : { iosBundleId: input.targetIdentifier }),
    isPrimary: true
  };
}

function libraryOwnsTarget(library: BusinessGraph, platform: SupportedPlatform, targetIdentifier: string): boolean {
  return (library.targetApp?.profiles ?? []).some((profile) => {
    if (profile.platform !== platform) {
      return false;
    }
    const identifier = platform === "android" ? profile.androidPackageName : profile.iosBundleId;
    return normalize(identifier) === normalize(targetIdentifier);
  });
}

function libraryResponse(graph: BusinessGraph, storage: PageAssetLibraryApiStorage): BusinessGraph & {
  activeVersion?: Pick<BusinessGraphVersion, "id" | "graphId" | "version" | "status" | "createdAt">;
} {
  return {
    ...graph,
    activeVersion: graph.activeVersionId ? storage.getBusinessGraphVersionSummary(graph.activeVersionId) : undefined
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RequestError(`${field} is required`);
  }
  return value.trim();
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function sendError(res: express.Response, error: unknown): void {
  if (error instanceof RequestError) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
}

class RequestError extends Error {}
