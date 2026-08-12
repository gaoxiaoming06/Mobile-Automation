import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "platform/apps/server/dist");
const outputFile = path.join(outputDir, "index.mjs");

await mkdir(outputDir, { recursive: true });
await build({
  entryPoints: [path.join(rootDir, "platform/apps/server/src/index.ts")],
  outfile: outputFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  banner: {
    js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);"
  }
});
await copyFile(
  path.join(rootDir, "platform/apps/server/src/vision-ocr.swift"),
  path.join(outputDir, "vision-ocr.swift")
);

console.log(`Built ${path.relative(rootDir, outputFile)}`);
