import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "3.3.3";
const expectedSha256 = "7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0";
const downloadUrl = `https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-v${version}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetPath = path.join(repoRoot, "platform/tools/scrcpy-server-v3.3.3");
const homebrewCandidates = [
  `/opt/homebrew/Cellar/scrcpy/${version}/share/scrcpy/scrcpy-server`,
  `/usr/local/Cellar/scrcpy/${version}/share/scrcpy/scrcpy-server`
];

await mkdir(path.dirname(targetPath), { recursive: true });

if (await isValidScrcpyServer(targetPath)) {
  console.log(`scrcpy-server ${version} already installed: ${targetPath}`);
  process.exit(0);
}

for (const candidate of homebrewCandidates) {
  if (await isValidScrcpyServer(candidate)) {
    await copyFile(candidate, targetPath);
    console.log(`Copied scrcpy-server ${version} from ${candidate}`);
    console.log(`Installed: ${targetPath}`);
    process.exit(0);
  }
}

console.log(`Downloading scrcpy-server ${version}...`);
const response = await fetch(downloadUrl);
if (!response.ok) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}

await writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
if (!(await isValidScrcpyServer(targetPath))) {
  throw new Error(`Downloaded file checksum mismatch: ${targetPath}`);
}

console.log(`Installed scrcpy-server ${version}: ${targetPath}`);

async function isValidScrcpyServer(filePath) {
  const info = await stat(filePath).catch(() => undefined);
  if (!info?.isFile()) {
    return false;
  }
  const actualSha256 = createHash("sha256").update(await readFile(filePath)).digest("hex");
  return actualSha256 === expectedSha256;
}
