import express from "express";
import { access } from "node:fs/promises";

export type DashboardStaticOptions = {
  dashboardDist: string;
  dashboardIndex: string;
};

export function createDashboardStaticHandlers(options: DashboardStaticOptions): express.RequestHandler[] {
  return [
    express.static(options.dashboardDist, {
      fallthrough: true,
      setHeaders: setDashboardNoCacheHeaders
    }),
    async (req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/artifacts")) {
        next();
        return;
      }
      const exists = await access(options.dashboardIndex)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        next();
        return;
      }
      setDashboardNoCacheHeaders(res);
      res.sendFile(options.dashboardIndex);
    }
  ];
}

function setDashboardNoCacheHeaders(res: express.Response): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");
}
