import os from "node:os";
import path from "node:path";

export function ensureMobileToolPath(
  env: NodeJS.ProcessEnv = process.env,
  options: { homeDir?: string; platform?: NodeJS.Platform } = {}
): void {
  const delimiter = path.delimiter;
  const current = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const candidates = [
    env.ANDROID_HOME ? path.join(env.ANDROID_HOME, "platform-tools") : undefined,
    env.ANDROID_SDK_ROOT ? path.join(env.ANDROID_SDK_ROOT, "platform-tools") : undefined,
    ...platformMobileToolPaths(platform, homeDir)
  ];
  env.PATH = uniquePathEntries([...current, ...candidates]).join(delimiter);
}

function platformMobileToolPaths(platform: NodeJS.Platform, homeDir: string): Array<string | undefined> {
  if (platform === "darwin") {
    return [
      path.join(homeDir, "Library/Android/sdk/platform-tools"),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains"
    ];
  }
  if (platform === "win32") {
    return [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android/Sdk/platform-tools") : undefined
    ];
  }
  return [
    path.join(homeDir, "Android/Sdk/platform-tools"),
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ];
}

function uniquePathEntries(entries: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    result.push(entry);
  }
  return result;
}
