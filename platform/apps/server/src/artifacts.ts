import os from "node:os";
import path from "node:path";

const defaultDataRoot = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "mobile-automation");

export const dataRoot = path.resolve(process.env.DATA_DIR ?? defaultDataRoot);
export const artifactRoot = path.join(dataRoot, "artifacts");
export const artifactSendFileOptions = { dotfiles: "allow" as const };

export function artifactFilePath(relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Invalid artifact path: ${relativePath}`);
  }
  return path.join(artifactRoot, normalized);
}

export function artifactUrl(relativePath: string): string {
  return `/artifacts/${relativePath.split(path.sep).join("/")}`;
}

export function runArtifactPath(runId: string, kind: "screenshots" | "logs" | "reports" | "videos" | "metrics", fileName: string): string {
  return path.join("runs", runId, kind, fileName);
}
