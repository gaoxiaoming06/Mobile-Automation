import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "3.3.3";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultServerPath = path.join(repoRoot, "platform/tools/scrcpy-server-v3.3.3");

const candidates = [
  process.env.SCRCPY_SERVER_PATH
    ? {
        label: "SCRCPY_SERVER_PATH",
        path: process.env.SCRCPY_SERVER_PATH
      }
    : undefined,
  {
    label: "platform/tools",
    path: defaultServerPath
  },
  {
    label: "Homebrew Apple Silicon",
    path: `/opt/homebrew/Cellar/scrcpy/${version}/share/scrcpy/scrcpy-server`
  },
  {
    label: "Homebrew Intel",
    path: `/usr/local/Cellar/scrcpy/${version}/share/scrcpy/scrcpy-server`
  }
].filter(Boolean);

for (const candidate of candidates) {
  const info = await stat(candidate.path).catch(() => undefined);
  if (info?.isFile()) {
    console.log(`scrcpy-server ${version}: ok`);
    console.log(`source: ${candidate.label}`);
    console.log(`path: ${candidate.path}`);
    process.exit(0);
  }
}

console.error(`scrcpy-server ${version}: missing`);
console.error("");
console.error("Expected one of:");
for (const candidate of candidates) {
  console.error(`- ${candidate.label}: ${candidate.path}`);
}
console.error("");
console.error("Fix options:");
console.error("- Put scrcpy-server v3.3.3 at platform/tools/scrcpy-server-v3.3.3");
console.error("- Or set SCRCPY_SERVER_PATH to an existing scrcpy-server v3.3.3 file");
console.error("- Or install scrcpy v3.3.3 and rerun pnpm check:tools");
process.exit(1);
