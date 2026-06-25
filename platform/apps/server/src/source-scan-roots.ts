import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export type SourceScanRoot = {
  label: string;
  path: string;
};

export type SourceScanDirectory = {
  name: string;
  path: string;
};

export type PickSourceScanDirectoryResult = {
  path?: string;
  cancelled?: boolean;
};

const defaultRootCandidates = [path.join(os.homedir(), "StudioProject_classin"), path.join(os.homedir(), "StudioProjects"), path.join(os.homedir(), "Downloads/test")];
const execFileAsync = promisify(execFile);

export async function listSourceScanRoots(env: NodeJS.ProcessEnv = process.env): Promise<SourceScanRoot[]> {
  const configured = splitConfiguredRoots(env.SOURCE_SCAN_ROOTS);
  const roots = configured.length ? configured : defaultRootCandidates;
  const uniqueRoots = Array.from(new Set(roots.map((item) => path.resolve(item))));
  const existing: SourceScanRoot[] = [];
  for (const root of uniqueRoots) {
    if (await isAccessibleDirectory(root)) {
      existing.push({
        label: root === os.homedir() ? "Home" : path.basename(root) || root,
        path: root
      });
    }
  }
  return existing;
}

export async function listSourceScanDirectories(parentPath: string, env: NodeJS.ProcessEnv = process.env): Promise<SourceScanDirectory[]> {
  const parent = path.resolve(parentPath);
  const roots = await listSourceScanRoots(env);
  if (!isPathUnderAnyRoot(parent, roots.map((root) => root.path))) {
    throw new Error("Directory is outside configured source scan roots");
  }
  const entries = await readdir(parent, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !shouldHideDirectory(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: path.join(parent, entry.name)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return directories;
}

export async function pickSourceScanDirectory(initialPath?: string): Promise<PickSourceScanDirectoryResult> {
  if (process.platform !== "darwin") {
    throw new Error("Native directory picker is currently supported on macOS only.");
  }
  const defaultPath = await resolvePickerDefaultPath(initialPath);
  const script = `
on run argv
  set promptText to item 1 of argv
  set initialPath to item 2 of argv
  try
    if initialPath is not "" then
      set chosenFolder to choose folder with prompt promptText default location (POSIX file initialPath)
    else
      set chosenFolder to choose folder with prompt promptText
    end if
    return POSIX path of chosenFolder
  on error number -128
    return "__CANCELLED__"
  end try
end run`;
  const { stdout } = await execFileAsync("osascript", ["-e", script, "选择源码目录", defaultPath], { timeout: 120000 });
  const selectedPath = stdout.trim();
  if (!selectedPath || selectedPath === "__CANCELLED__") {
    return { cancelled: true };
  }
  return { path: path.resolve(selectedPath) };
}

function splitConfiguredRoots(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function isAccessibleDirectory(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath);
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

async function resolvePickerDefaultPath(initialPath: string | undefined): Promise<string> {
  if (initialPath?.trim() && (await isAccessibleDirectory(initialPath.trim()))) {
    return path.resolve(initialPath.trim());
  }
  const roots = await listSourceScanRoots();
  return roots[0]?.path ?? os.homedir();
}

function isPathUnderAnyRoot(targetPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return targetPath === resolvedRoot || !path.relative(resolvedRoot, targetPath).startsWith("..");
  });
}

function shouldHideDirectory(name: string): boolean {
  return name.startsWith(".") || name === "build" || name === "node_modules" || name === "dist";
}
