import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import zlib from "node:zlib";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(distDir, "mobile-automation-release");
const archivePath = path.join(distDir, "mobile-automation-release.tgz");

if (isMainModule()) {
  await packageOfflineRelease();
}

export function releaseManifestFor(input) {
  return {
    name: input.packageName,
    version: input.packageVersion,
    agentVersion: input.agentVersion,
    startCommand: "OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 node platform/apps/server/dist/index.mjs",
    buildArtifacts: [
      "platform/apps/server/dist",
      "platform/apps/dashboard/dist",
      "platform/apps/server/public/agent",
      "scripts/rapidocr-http-service.py",
      "scripts/setup-ocr.mjs",
      "scripts/ensure-lan-https-cert.mjs",
      "requirements-ocr.txt"
    ]
  };
}

async function packageOfflineRelease() {
  const rootPackage = await readJson(path.join(rootDir, "package.json"));
  const agentPackage = await readJson(path.join(rootDir, "platform/apps/device-agent/package.json"));

  await run("pnpm", ["build"], { cwd: rootDir });

  await rm(releaseDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  await mkdir(releaseDir, { recursive: true });

  for (const item of releaseManifestFor({
    packageName: String(rootPackage.name),
    packageVersion: String(rootPackage.version),
    agentVersion: String(agentPackage.version)
  }).buildArtifacts) {
    await copyIntoRelease(item);
  }
  await copyOptionalIntoRelease("vendor/ocr-wheels");
  await writeFile(
    path.join(releaseDir, "release-manifest.json"),
    `${JSON.stringify(releaseManifestFor({
      packageName: String(rootPackage.name),
      packageVersion: String(rootPackage.version),
      agentVersion: String(agentPackage.version)
    }), null, 2)}\n`
  );
  await writeFile(path.join(releaseDir, "README.deploy.md"), deployReadme());
  await createTarGz(releaseDir, archivePath);

  console.log(`Offline release directory: ${path.relative(rootDir, releaseDir)}`);
  console.log(`Offline release archive: ${path.relative(rootDir, archivePath)}`);
}

async function copyIntoRelease(relativePath) {
  await cp(path.join(rootDir, relativePath), path.join(releaseDir, relativePath), {
    recursive: true,
    force: true
  });
}

async function copyOptionalIntoRelease(relativePath) {
  try {
    await copyIntoRelease(relativePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function deployReadme() {
  return `# Mobile Automation Offline Release

## Start server

\`\`\`bash
node scripts/setup-ocr.mjs
OCR_ENGINE=rapid DATA_DIR=/var/lib/mobile-automation PORT=4010 node platform/apps/server/dist/index.mjs
\`\`\`

The dashboard is served by the server from \`platform/apps/dashboard/dist\`.
The Device Agent installer is served from \`platform/apps/server/public/agent\`.
If \`vendor/ocr-wheels\` exists in this release, \`node scripts/setup-ocr.mjs\` installs OCR packages from that local wheelhouse.
For direct LAN HTTPS without a reverse proxy, run \`node scripts/ensure-lan-https-cert.mjs\` first and set \`HTTPS=1\`, \`HTTPS_KEY\`, and \`HTTPS_CERT\`.
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

function createTarGz(sourceDir, outputFile) {
  return new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-cf", "-", "-C", path.dirname(sourceDir), path.basename(sourceDir)]);
    const gzip = zlib.createGzip();
    const output = createWriteStream(outputFile);
    tar.stdout.pipe(gzip).pipe(output);
    tar.stderr.on("data", (chunk) => process.stderr.write(chunk));
    tar.once("error", reject);
    gzip.once("error", reject);
    output.once("error", reject);
    output.once("finish", () => resolve());
    tar.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`tar failed with ${signal ?? code}`));
      }
    });
  });
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
