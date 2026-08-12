import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

type AgentBundleShebangModule = {
  normalizeAgentBundleShebang: (bundle: string) => string;
};

describe("agent bundle shebang", () => {
  it("keeps only one node shebang at the first line", async () => {
    const { normalizeAgentBundleShebang } = await import(
      new URL("../../../../scripts/agent-bundle-shebang.mjs", import.meta.url).href
    ) as AgentBundleShebangModule;

    expect(normalizeAgentBundleShebang("#!/usr/bin/env tsx\n#!/usr/bin/env node\nvar agent = true;\n")).toBe(
      "#!/usr/bin/env node\nvar agent = true;\n"
    );
    expect(normalizeAgentBundleShebang("var agent = true;\n")).toBe(
      "#!/usr/bin/env node\nvar agent = true;\n"
    );
  });

  it("does not use import.meta.url in the distributed agent runtime", async () => {
    const scrcpyStreamSource = await readFile(
      new URL("../../device-agent/src/agent-scrcpy-stream.ts", import.meta.url),
      "utf8"
    );

    expect(scrcpyStreamSource).not.toContain("import.meta.url");
  });
});
