import { readFile } from "node:fs/promises";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import path from "node:path";

export type ServerProtocol = "http" | "https";

export type ServerNetworkConfig = {
  host: string;
  protocol: ServerProtocol;
  https?: {
    keyPath: string;
    certPath: string;
  };
};

const defaultHttpsKeyPath = ".cert/mobile-automation-lan-key.pem";
const defaultHttpsCertPath = ".cert/mobile-automation-lan-cert.pem";
const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

export function resolveServerHost(env: Record<string, string | undefined> = process.env): string {
  return env.HOST?.trim() || "127.0.0.1";
}

export function resolveServerNetworkConfig(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd()
): ServerNetworkConfig {
  const host = resolveServerHost(env);
  const httpsEnabled = truthyEnvValues.has((env.HTTPS ?? "").trim().toLowerCase());
  if (!httpsEnabled) {
    return {
      host,
      protocol: "http"
    };
  }
  return {
    host,
    protocol: "https",
    https: {
      keyPath: resolvePath(env.HTTPS_KEY, defaultHttpsKeyPath, cwd),
      certPath: resolvePath(env.HTTPS_CERT, defaultHttpsCertPath, cwd)
    }
  };
}

export async function loadHttpsServerOptions(config: ServerNetworkConfig): Promise<HttpsServerOptions | undefined> {
  if (!config.https) {
    return undefined;
  }
  const [key, cert] = await Promise.all([
    readFile(config.https.keyPath),
    readFile(config.https.certPath)
  ]);
  return { key, cert };
}

export function serverListenUrl(config: ServerNetworkConfig, port: number): string {
  return `${config.protocol}://${config.host}:${port}`;
}

function resolvePath(value: string | undefined, fallback: string, cwd: string): string {
  const selected = value?.trim() || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(cwd, selected);
}
