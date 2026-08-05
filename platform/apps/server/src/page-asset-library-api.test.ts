import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { BusinessGraph, BusinessGraphVersion } from "@mobile-automation/graph-core";
import { registerPageAssetLibraryRoutes, type PageAssetLibraryApiStorage } from "./page-asset-library-api.js";
import type { CreatePageAssetLibraryInput } from "./storage.js";

describe("Page asset library API", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("creates a product-scoped library and its first active version", async () => {
    const context = await apiContext(servers);

    const response = await post(context.baseUrl, "/api/page-assets", {
      appId: "cn.eeo.classin",
      name: "ClassIn 页面资产",
      platform: "android",
      targetIdentifier: "cn.eeo.classin"
    });

    expect(response.status).toBe(201);
    expect(context.storage.createdInputs).toEqual([{
      appId: "cn.eeo.classin",
      name: "ClassIn 页面资产",
      targetApp: {
        productId: "cn.eeo.classin",
        productName: "ClassIn 页面资产",
        profiles: [{
          id: "android:cn.eeo.classin",
          platform: "android",
          displayName: "ClassIn 页面资产 Android",
          androidPackageName: "cn.eeo.classin",
          isPrimary: true
        }]
      }
    }]);
    expect(response.body).toEqual({
      library: expect.objectContaining({
        appId: "cn.eeo.classin",
        activeVersion: expect.objectContaining({ id: "version-1", status: "active", version: 1 })
      })
    });
  });

  it("creates a HarmonyOS product-scoped library with the runtime bundle in the target profile", async () => {
    const context = await apiContext(servers);

    const response = await post(context.baseUrl, "/api/page-assets", {
      appId: "classin",
      name: "ClassIn 页面资产",
      platform: "harmony",
      targetIdentifier: "com.eeo.classin.harmony"
    });

    expect(response.status).toBe(201);
    expect(context.storage.createdInputs).toEqual([{
      appId: "classin",
      name: "ClassIn 页面资产",
      targetApp: {
        productId: "classin",
        productName: "ClassIn 页面资产",
        profiles: [{
          id: "harmony:com.eeo.classin.harmony",
          platform: "harmony",
          displayName: "ClassIn 页面资产 HarmonyOS",
          harmonyBundleName: "com.eeo.classin.harmony",
          isPrimary: true
        }]
      }
    }]);
  });

  it("rejects duplicate target apps and unknown request fields", async () => {
    const context = await apiContext(servers);
    await post(context.baseUrl, "/api/page-assets", {
      appId: "cn.eeo.classin",
      name: "ClassIn 页面资产",
      platform: "android",
      targetIdentifier: "cn.eeo.classin"
    });

    expect(await post(context.baseUrl, "/api/page-assets", {
      appId: "classin-copy",
      name: "重复资产库",
      platform: "android",
      targetIdentifier: "cn.eeo.classin"
    })).toEqual({ status: 409, body: { error: "该 App 已有页面资产库" } });

    expect(await post(context.baseUrl, "/api/page-assets", {
      appId: "cn.eeo.other",
      name: "Other",
      platform: "android",
      targetIdentifier: "cn.eeo.other",
      status: "active"
    })).toEqual({ status: 400, body: { error: "Unknown request field: status" } });
  });
});

async function apiContext(servers: Server[]): Promise<{ baseUrl: string; storage: MemoryPageAssetLibraryStorage }> {
  const storage = new MemoryPageAssetLibraryStorage();
  const app = express();
  app.use(express.json());
  registerPageAssetLibraryRoutes(app, { storage });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address unavailable");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, storage };
}

class MemoryPageAssetLibraryStorage implements PageAssetLibraryApiStorage {
  readonly createdInputs: CreatePageAssetLibraryInput[] = [];
  private readonly libraries: BusinessGraph[] = [];

  listBusinessGraphs(): BusinessGraph[] {
    return this.libraries;
  }

  createPageAssetLibrary(input: CreatePageAssetLibraryInput): BusinessGraph {
    this.createdInputs.push(input);
    const library: BusinessGraph = {
      id: `graph-${this.libraries.length + 1}`,
      appId: input.appId,
      name: input.name,
      targetApp: input.targetApp,
      platformScope: "mobile-both",
      status: "active",
      activeVersionId: "version-1",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    };
    this.libraries.push(library);
    return library;
  }

  getBusinessGraphVersionSummary(id: string): Pick<BusinessGraphVersion, "id" | "graphId" | "version" | "status" | "createdAt"> | undefined {
    return id === "version-1"
      ? { id, graphId: "graph-1", version: 1, status: "active", createdAt: "2026-07-28T00:00:00.000Z" }
      : undefined;
  }
}

async function post(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
