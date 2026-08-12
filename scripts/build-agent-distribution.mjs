import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { normalizeAgentBundleShebang } from "./agent-bundle-shebang.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(rootDir, "platform/apps/server/public/agent");
const agentOutputFile = path.join(outputDir, "mobile-automation-agent.cjs");
const rootPackage = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));

await mkdir(outputDir, { recursive: true });
await buildBundle(path.join(rootDir, "platform/apps/device-agent/src/index.ts"), agentOutputFile);

const agentBundle = await normalizeBundle(agentOutputFile);
const sha256 = sha256Text(agentBundle);
await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({
  version: rootPackage.version,
  file: "mobile-automation-agent.cjs",
  url: "/agent/mobile-automation-agent.cjs",
  sha256
}, null, 2)}\n`);

console.log(`Built ${path.relative(rootDir, agentOutputFile)} (${agentBundle.length} bytes)`);

async function buildBundle(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    sourcemap: false
  });
}

async function normalizeBundle(filePath) {
  const bundle = normalizeAgentBundleShebang(await readFile(filePath, "utf8"));
  await writeFile(filePath, bundle);
  return bundle;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
