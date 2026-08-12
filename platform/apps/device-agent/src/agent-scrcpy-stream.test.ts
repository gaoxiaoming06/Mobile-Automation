import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveScrcpyServerPath } from "./agent-scrcpy-stream.js";

describe("agent scrcpy server resolution", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("finds the bundled scrcpy server from the managed agent home when cwd is unrelated", async () => {
    const agentHome = await mkdtemp(path.join(os.tmpdir(), "mobile-agent-home-"));
    tempDirs.push(agentHome);
    const serverPath = path.join(agentHome, "scrcpy-server-v3.3.3");
    await writeFile(serverPath, "scrcpy server");

    await expect(resolveScrcpyServerPath({
      env: { MOBILE_AUTOMATION_AGENT_HOME: agentHome },
      cwd: os.homedir()
    })).resolves.toBe(serverPath);
  });
});
