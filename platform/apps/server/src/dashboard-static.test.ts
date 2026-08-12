import express from "express";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardStaticHandlers } from "./dashboard-static.js";

describe("dashboard static hosting", () => {
  const tempDirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("prevents stale dashboard HTML and asset bundles from being cached", async () => {
    const dist = await mkdtemp(path.join(os.tmpdir(), "mobile-dashboard-dist-"));
    tempDirs.push(dist);
    await mkdir(path.join(dist, "assets"));
    await writeFile(path.join(dist, "index.html"), "<!doctype html><div id=\"root\"></div>");
    await writeFile(path.join(dist, "assets/index-test.js"), "console.log('new dashboard');");
    const app = express();
    app.use(...createDashboardStaticHandlers({
      dashboardDist: dist,
      dashboardIndex: path.join(dist, "index.html")
    }));
    const baseUrl = await listen(app, servers);

    const indexResponse = await fetch(`${baseUrl}/`);
    const assetResponse = await fetch(`${baseUrl}/assets/index-test.js`);

    expect(indexResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(assetResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
  });
});

async function listen(app: express.Express, servers: Server[]): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind to a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}
