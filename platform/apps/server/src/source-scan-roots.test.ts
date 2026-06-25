import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listSourceScanDirectories, listSourceScanRoots } from "./source-scan-roots.js";

let tempRoot = "";

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  }
});

describe("source scan roots", () => {
  it("lists configured existing source roots", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "source-roots-"));
    const missing = path.join(tempRoot, "missing");

    const roots = await listSourceScanRoots({
      SOURCE_SCAN_ROOTS: `${tempRoot},${missing}`
    } as NodeJS.ProcessEnv);

    expect(roots).toEqual([{ label: path.basename(tempRoot), path: tempRoot }]);
  });

  it("lists child directories only inside configured roots", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "source-roots-"));
    await mkdir(path.join(tempRoot, "app"));
    await mkdir(path.join(tempRoot, "build"));
    await mkdir(path.join(tempRoot, ".git"));

    const directories = await listSourceScanDirectories(tempRoot, {
      SOURCE_SCAN_ROOTS: tempRoot
    } as NodeJS.ProcessEnv);

    expect(directories).toEqual([{ name: "app", path: path.join(tempRoot, "app") }]);
    await expect(listSourceScanDirectories(os.tmpdir(), { SOURCE_SCAN_ROOTS: tempRoot } as NodeJS.ProcessEnv)).rejects.toThrow(
      "outside configured source scan roots"
    );
  });
});
