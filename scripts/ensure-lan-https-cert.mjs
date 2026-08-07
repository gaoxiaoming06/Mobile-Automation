#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certDir = path.join(repoRoot, ".cert");
const keyPath = path.join(certDir, "mobile-automation-lan-key.pem");
const certPath = path.join(certDir, "mobile-automation-lan-cert.pem");
const hostMarkerPath = path.join(certDir, "mobile-automation-lan-host.txt");
const lanHost = process.env.LAN_HOST?.trim() || firstLanIpv4() || "127.0.0.1";

mkdirSync(certDir, { recursive: true });

if (shouldReuseCertificate()) {
  console.log(`LAN HTTPS certificate already exists for ${lanHost}`);
  console.log(`HTTPS_KEY=${path.relative(repoRoot, keyPath)}`);
  console.log(`HTTPS_CERT=${path.relative(repoRoot, certPath)}`);
  process.exit(0);
}

for (const filePath of [keyPath, certPath, hostMarkerPath]) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

const subjectAltNames = [`DNS:localhost`, `IP:127.0.0.1`, sanForHost(lanHost)];
const result = spawnSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-days",
  "365",
  "-subj",
  `/CN=${lanHost}`,
  "-addext",
  `subjectAltName=${subjectAltNames.join(",")}`
], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  console.error("Failed to create LAN HTTPS certificate. Please make sure openssl is installed.");
  process.exit(result.status ?? 1);
}

writeFileSync(hostMarkerPath, `${lanHost}\n`);
console.log(`Created LAN HTTPS certificate for ${lanHost}`);
console.log(`HTTPS_KEY=${path.relative(repoRoot, keyPath)}`);
console.log(`HTTPS_CERT=${path.relative(repoRoot, certPath)}`);

function shouldReuseCertificate() {
  if (!existsSync(keyPath) || !existsSync(certPath) || !existsSync(hostMarkerPath)) {
    return false;
  }
  return readFileSync(hostMarkerPath, "utf8").trim() === lanHost;
}

function firstLanIpv4() {
  const candidates = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
  return candidates.find((address) => /^10\./.test(address))
    ?? candidates.find((address) => /^192\.168\./.test(address))
    ?? candidates.find((address) => /^172\.(1[6-9]|2\d|3[01])\./.test(address))
    ?? candidates[0];
}

function sanForHost(host) {
  return isIpv4(host) ? `IP:${host}` : `DNS:${host}`;
}

function isIpv4(host) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
}
