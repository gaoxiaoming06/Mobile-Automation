import { readFileSync } from "node:fs";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const https = resolveHttpsOptions(process.env, process.cwd());
const apiTarget = https ? "https://localhost:4010" : "http://localhost:4010";

export default defineConfig({
  plugins: [react()],
  server: {
    ...(https ? { https } : {}),
    proxy: {
      "/api": {
        target: apiTarget,
        ws: true,
        secure: false
      },
      "/artifacts": {
        target: apiTarget,
        secure: false
      }
    }
  }
});

function resolveHttpsOptions(env: Record<string, string | undefined>, cwd: string): HttpsServerOptions | undefined {
  if (!isTruthy(env.HTTPS)) {
    return undefined;
  }
  const keyPath = resolvePath(env.HTTPS_KEY, ".cert/mobile-automation-lan-key.pem", cwd);
  const certPath = resolvePath(env.HTTPS_CERT, ".cert/mobile-automation-lan-cert.pem", cwd);
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath)
  };
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function resolvePath(value: string | undefined, fallback: string, cwd: string): string {
  const selected = value?.trim() || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(cwd, selected);
}
