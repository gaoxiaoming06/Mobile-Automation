import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("server-agent architecture boundaries", () => {
  it("keeps the server entrypoint out of local device control modules", async () => {
    const source = await readSource("index.ts");

    expect(source).not.toContain("./mobile-driver.js");
    expect(source).not.toContain("./scrcpy-stream.js");
  });

  it("keeps the server-agent driver independent from the local MobileDriver implementation", async () => {
    const source = await readSource("server-agent-driver.ts");

    expect(source).not.toContain("./mobile-driver.js");
  });
});

async function readSource(fileName: string): Promise<string> {
  return readFile(new URL(fileName, import.meta.url), "utf8");
}
