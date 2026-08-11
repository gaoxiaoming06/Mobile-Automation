import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "platform/apps/server/public/agent");
const outputFile = path.join(outputDir, "mobile-automation-agent.mjs");
const rootPackage = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(rootDir, "platform/apps/device-agent/src/index.ts")],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" }
});

const bundle = await readFile(outputFile);
const sha256 = crypto.createHash("sha256").update(bundle).digest("hex");
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
  version: rootPackage.version,
  file: "mobile-automation-agent.mjs",
  url: "/agent/mobile-automation-agent.mjs",
  sha256
}, null, 2)}\n`);

console.log(`Built ${path.relative(rootDir, outputFile)} (${bundle.length} bytes)`);
