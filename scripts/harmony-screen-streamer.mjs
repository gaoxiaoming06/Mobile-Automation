#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultBundleName = "com.mobileautomation.screenstream";
const abilityName = "EntryAbility";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.join(repoRoot, "platform/tools/harmony-screen-streamer");
const defaultDevEcoRoot = "/Applications/DevEco-Studio.app/Contents";
const toolchainsLib = path.join(defaultDevEcoRoot, "sdk/default/openharmony/toolchains/lib");
const signingRoot = path.join(projectRoot, "entry/build/mobile-automation-signing");
const buildProfilePath = path.join(projectRoot, "build-profile.json5");
const entryBuildProfilePath = path.join(projectRoot, "entry/build-profile.json5");
const classInOhosRoot = process.env.HARMONY_CLASSIN_OHOS_ROOT
  ?? "/Users/eeo/FlutterProject/flutter_classin/apps/classin/ohos";
const classInAutoVerifySigning = {
  mode: "classin-autoverify",
  bundleName: "cn.eeo.hos.classin.mobile.autoverify",
  productName: "autoverify",
  signingConfigName: "autoverifyDebug",
  profilePath: path.join(classInOhosRoot, "build-profile.json5")
};
const defaultSigning = {
  signTool: path.join(toolchainsLib, "hap-sign-tool.jar"),
  keystoreFile: path.join(toolchainsLib, "OpenHarmony.p12"),
  keystorePwd: "123456",
  appKeyAlias: "openharmony application release",
  appCaAlias: "openharmony application ca",
  appRootCaAlias: "openharmony application root ca",
  appCertIssuer: "C=CN,O=OpenHarmony,OU=OpenHarmony Team,CN=OpenHarmony Application CA",
  appCertSubject: "C=CN,O=OpenHarmony,OU=OpenHarmony Team,CN=OpenHarmony Application Release",
  profileKeyAlias: "openharmony application profile debug",
  profileCertFile: path.join(toolchainsLib, "OpenHarmonyProfileDebug.pem"),
  profileTemplateFile: path.join(toolchainsLib, "UnsgnedDebugProfileTemplate.json"),
  compatibleVersion: "24"
};

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) ?? "build";
const serial = valueAfter(args, "--serial") ?? process.env.HDC_SERIAL;
const requestedSigningMode = valueAfter(args, "--signing") ?? process.env.HARMONY_STREAM_SIGNING ?? "auto";
const signingMode = requestedSigningMode === "auto" && existsSync(classInAutoVerifySigning.profilePath)
  ? classInAutoVerifySigning.mode
  : requestedSigningMode;
const activeBundleName = process.env.HARMONY_STREAM_BUNDLE_NAME
  ?? (signingMode === classInAutoVerifySigning.mode ? classInAutoVerifySigning.bundleName : defaultBundleName);

if (!["build", "install", "start", "reinstall"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: node scripts/harmony-screen-streamer.mjs [build|install|start|reinstall] [--serial <device>] [--signing auto|classin-autoverify|openharmony-local|none]");
  process.exit(1);
}

const hdc = findExecutable("HDC", [
  path.join(defaultDevEcoRoot, "sdk/default/openharmony/toolchains/hdc"),
  "hdc"
]);
const ohpm = findExecutable("OHPM", [
  path.join(defaultDevEcoRoot, "tools/ohpm/bin/ohpm"),
  "ohpm"
]);
const hvigorw = findExecutable("HVIGORW", [
  path.join(defaultDevEcoRoot, "tools/hvigor/bin/hvigorw"),
  "hvigorw"
]);
const java = process.env.JAVA ?? "java";
const keytool = process.env.KEYTOOL ?? "keytool";

try {
  if (command === "build") {
    await build();
  } else if (command === "install") {
    await install();
  } else if (command === "start") {
    await start();
  } else if (command === "reinstall") {
    await install();
    await start();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function build() {
  run(ohpm, ["install"], { cwd: projectRoot });
  const buildStartedAt = Date.now();
  if (signingMode === classInAutoVerifySigning.mode) {
    return await withTemporaryClassInAutoVerifySigning(async () => {
      run(hvigorw, [
        "assembleHap",
        "--mode",
        "module",
        "-p",
        "module=entry",
        "-p",
        `product=${classInAutoVerifySigning.productName}`,
        "--no-daemon"
      ], { cwd: projectRoot });
      const hap = await findLatestHap({
        productName: classInAutoVerifySigning.productName,
        preferSigned: true,
        sinceMs: buildStartedAt
      });
      console.log(`Built AppGallery signed HAP: ${hap}`);
      return hap;
    });
  }

  run(hvigorw, ["assembleHap", "--mode", "module", "-p", "module=entry", "--no-daemon"], { cwd: projectRoot });
  const unsignedHap = await findLatestHap({ unsignedOnly: true });
  console.log(`Built unsigned HAP: ${unsignedHap}`);

  if (process.env.HARMONY_STREAM_SKIP_SIGN === "1" || signingMode === "none") {
    return unsignedHap;
  }

  const target = serial ?? tryDetectSingleDevice();
  const deviceUdid = process.env.HARMONY_DEVICE_UDID ?? (target ? getDeviceUdid(target) : undefined);
  if (!deviceUdid) {
    console.log("No Harmony device UDID available; returning the unsigned HAP. Connect one device or set HARMONY_DEVICE_UDID to sign.");
    return unsignedHap;
  }

  return await signHap(unsignedHap, deviceUdid);
}

async function install() {
  const target = serial ?? detectSingleDevice();
  const hap = await build();
  const output = capture(hdc, ["-t", target, "install", "-r", hap], { allowFailure: true });
  process.stdout.write(output);
  if (output && !output.endsWith("\n")) {
    process.stdout.write("\n");
  }
  const installFailure = detectHdcInstallFailure(output);
  if (installFailure) {
    throw new Error(`HAP install failed on ${target}: ${installFailure}`);
  }
  console.log(`Installed ${activeBundleName} on ${target}`);
  if (activeBundleName !== defaultBundleName) {
    console.log(`Start the device-agent with HARMONY_STREAM_BUNDLE_NAME=${activeBundleName}`);
  }
}

async function start() {
  const target = serial ?? detectSingleDevice();
  run(hdc, ["-t", target, "shell", "aa", "start", "-b", activeBundleName, "-a", abilityName], { cwd: projectRoot });
  console.log(`Started ${activeBundleName}/${abilityName} on ${target}`);
}

function run(executable, commandArgs, options) {
  console.log(`$ ${[executable, ...commandArgs].join(" ")}`);
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${executable} ${commandArgs.join(" ")}`);
  }
}

function capture(executable, commandArgs, options = {}) {
  return captureWithOptions(executable, commandArgs, options);
}

function captureWithOptions(executable, commandArgs, options) {
  const result = spawnSync(executable, commandArgs, {
    cwd: projectRoot,
    env: process.env,
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("");
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(output.trim() || `Command failed: ${executable} ${commandArgs.join(" ")}`);
  }
  return output;
}

function detectSingleDevice() {
  const targets = capture(hdc, ["list", "targets"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "[Empty]" && !line.includes("Empty"));
  if (targets.length === 1) {
    return targets[0].split(/\s+/)[0];
  }
  if (targets.length === 0) {
    throw new Error("No Harmony device detected by hdc. Connect a device or pass --serial.");
  }
  throw new Error(`Multiple Harmony devices detected: ${targets.join(", ")}. Pass --serial <device>.`);
}

function tryDetectSingleDevice() {
  try {
    return detectSingleDevice();
  } catch {
    return undefined;
  }
}

function getDeviceUdid(target) {
  const output = capture(hdc, ["-t", target, "shell", "bm", "get", "--udid"]);
  const match = output.match(/[0-9a-f]{64}/i);
  if (!match) {
    throw new Error(`Unable to read device UDID from bm output: ${output.trim()}`);
  }
  return match[0].toUpperCase();
}

async function signHap(unsignedHap, deviceUdid) {
  const signing = resolveSigningConfig();
  await mkdir(signingRoot, { recursive: true });

  const appCertFile = signing.appCertFile ?? generateAppCertChain(signing);

  const unsignedProfileFile = path.join(signingRoot, "mobile-automation-debug-profile.json");
  const signedProfileFile = path.join(signingRoot, "mobile-automation-debug-profile.p7b");
  const appCert = firstCertificate(await readFile(appCertFile, "utf8"));
  const profile = JSON.parse(await readFile(signing.profileTemplateFile, "utf8"));
  const nowSeconds = Math.floor(Date.now() / 1000);
  profile.uuid = randomUUID();
  profile["version-name"] = "1.0.0";
  profile["version-code"] = 1;
  profile.validity = {
    "not-before": nowSeconds - 3600,
    "not-after": nowSeconds + 366 * 24 * 60 * 60
  };
  profile["bundle-info"]["bundle-name"] = activeBundleName;
  profile["bundle-info"]["development-certificate"] = appCert;
  profile["debug-info"] = {
    "device-ids": [deviceUdid],
    "device-id-type": "udid"
  };
  await writeFile(unsignedProfileFile, `${JSON.stringify(profile, null, 2)}\n`);

  run(java, [
    "-jar",
    signing.signTool,
    "sign-profile",
    "-mode",
    "localSign",
    "-keyAlias",
    signing.profileKeyAlias,
    "-keyPwd",
    signing.keyPwd,
    "-profileCertFile",
    signing.profileCertFile,
    "-inFile",
    unsignedProfileFile,
    "-signAlg",
    "SHA256withECDSA",
    "-keystoreFile",
    signing.keystoreFile,
    "-keystorePwd",
    signing.keystorePwd,
    "-outFile",
    signedProfileFile
  ], { cwd: projectRoot });

  const signedHap = unsignedHap.replace(/-unsigned\.hap$/, "-signed.hap");
  run(java, [
    "-jar",
    signing.signTool,
    "sign-app",
    "-mode",
    "localSign",
    "-keyAlias",
    signing.appKeyAlias,
    "-keyPwd",
    signing.keyPwd,
    "-appCertFile",
    appCertFile,
    "-profileFile",
    signedProfileFile,
    "-inFile",
    unsignedHap,
    "-signAlg",
    "SHA256withECDSA",
    "-keystoreFile",
    signing.keystoreFile,
    "-keystorePwd",
    signing.keystorePwd,
    "-outFile",
    signedHap,
    "-compatibleVersion",
    signing.compatibleVersion,
    "-signCode",
    "1"
  ], { cwd: projectRoot });

  console.log(`Signed HAP: ${signedHap}`);
  return signedHap;
}

async function withTemporaryClassInAutoVerifySigning(buildAction) {
  const [rootText, entryText, classInText] = await Promise.all([
    readFile(buildProfilePath, "utf8"),
    readFile(entryBuildProfilePath, "utf8"),
    readFile(classInAutoVerifySigning.profilePath, "utf8")
  ]);

  const rootProfile = JSON.parse(rootText);
  const entryProfile = JSON.parse(entryText);
  const classInProfile = JSON.parse(classInText);
  const signingConfig = classInProfile.app.signingConfigs.find(
    (config) => config.name === classInAutoVerifySigning.signingConfigName
  );
  if (!signingConfig) {
    throw new Error(`Unable to find ${classInAutoVerifySigning.signingConfigName} in ${classInAutoVerifySigning.profilePath}`);
  }

  rootProfile.app.signingConfigs = [absolutizeSigningConfig(signingConfig, classInOhosRoot)];
  upsertByName(rootProfile.app.products, {
    name: classInAutoVerifySigning.productName,
    bundleName: classInAutoVerifySigning.bundleName,
    signingConfig: classInAutoVerifySigning.signingConfigName,
    compatibleSdkVersion: "6.1.1(24)",
    targetSdkVersion: "6.1.1(24)",
    runtimeOS: "HarmonyOS",
    buildOption: rootProfile.app.products[0]?.buildOption ?? {}
  });
  upsertByName(rootProfile.modules[0].targets, {
    name: classInAutoVerifySigning.productName,
    applyToProducts: [classInAutoVerifySigning.productName]
  });
  upsertByName(entryProfile.targets, {
    name: classInAutoVerifySigning.productName,
    runtimeOS: "HarmonyOS",
    output: {
      artifactName: "harmony_screen_streamer_autoverify"
    }
  });

  await Promise.all([
    writeFile(buildProfilePath, `${JSON.stringify(rootProfile, null, 2)}\n`),
    writeFile(entryBuildProfilePath, `${JSON.stringify(entryProfile, null, 2)}\n`)
  ]);
  try {
    return await buildAction();
  } finally {
    await Promise.all([
      writeFile(buildProfilePath, rootText),
      writeFile(entryBuildProfilePath, entryText)
    ]);
  }
}

function absolutizeSigningConfig(config, baseDir) {
  const material = { ...config.material };
  for (const key of ["storeFile", "profile", "certpath"]) {
    if (material[key]) {
      material[key] = path.resolve(baseDir, material[key]);
    }
  }
  return { ...config, material };
}

function upsertByName(values, nextValue) {
  const index = values.findIndex((value) => value.name === nextValue.name);
  if (index >= 0) {
    values[index] = nextValue;
  } else {
    values.push(nextValue);
  }
}

function resolveSigningConfig() {
  return {
    signTool: process.env.HARMONY_SIGN_TOOL ?? defaultSigning.signTool,
    keystoreFile: process.env.HARMONY_SIGN_KEYSTORE ?? defaultSigning.keystoreFile,
    keystorePwd: process.env.HARMONY_SIGN_KEYSTORE_PWD ?? defaultSigning.keystorePwd,
    keyPwd: process.env.HARMONY_SIGN_KEY_PWD ?? process.env.HARMONY_SIGN_KEYSTORE_PWD ?? defaultSigning.keystorePwd,
    appKeyAlias: process.env.HARMONY_SIGN_APP_ALIAS ?? defaultSigning.appKeyAlias,
    appCaAlias: process.env.HARMONY_SIGN_APP_CA_ALIAS ?? defaultSigning.appCaAlias,
    appRootCaAlias: process.env.HARMONY_SIGN_APP_ROOT_CA_ALIAS ?? defaultSigning.appRootCaAlias,
    appCertIssuer: process.env.HARMONY_SIGN_APP_CERT_ISSUER ?? defaultSigning.appCertIssuer,
    appCertSubject: process.env.HARMONY_SIGN_APP_CERT_SUBJECT ?? defaultSigning.appCertSubject,
    profileKeyAlias: process.env.HARMONY_SIGN_PROFILE_ALIAS ?? defaultSigning.profileKeyAlias,
    appCertFile: process.env.HARMONY_SIGN_APP_CERT,
    profileCertFile: process.env.HARMONY_SIGN_PROFILE_CERT ?? defaultSigning.profileCertFile,
    profileTemplateFile: process.env.HARMONY_SIGN_PROFILE_TEMPLATE ?? defaultSigning.profileTemplateFile,
    compatibleVersion: process.env.HARMONY_SIGN_COMPATIBLE_VERSION ?? defaultSigning.compatibleVersion
  };
}

function generateAppCertChain(signing) {
  const rootCaCertFile = path.join(signingRoot, "openharmony-application-root-ca.cer");
  const subCaCertFile = path.join(signingRoot, "openharmony-application-ca.cer");
  const appCertFile = path.join(signingRoot, "openharmony-application-release-chain.cer");

  exportCert(signing, signing.appRootCaAlias, rootCaCertFile);
  exportCert(signing, signing.appCaAlias, subCaCertFile);
  run(java, [
    "-jar",
    signing.signTool,
    "generate-app-cert",
    "-keyAlias",
    signing.appKeyAlias,
    "-keyPwd",
    signing.keyPwd,
    "-issuer",
    signing.appCertIssuer,
    "-issuerKeyAlias",
    signing.appCaAlias,
    "-issuerKeyPwd",
    signing.keyPwd,
    "-subject",
    signing.appCertSubject,
    "-validity",
    "3650",
    "-signAlg",
    "SHA256withECDSA",
    "-rootCaCertFile",
    rootCaCertFile,
    "-subCaCertFile",
    subCaCertFile,
    "-keystoreFile",
    signing.keystoreFile,
    "-keystorePwd",
    signing.keystorePwd,
    "-outForm",
    "certChain",
    "-outFile",
    appCertFile
  ], { cwd: projectRoot });
  return appCertFile;
}

function exportCert(signing, alias, file) {
  run(keytool, [
    "-exportcert",
    "-rfc",
    "-storetype",
    "PKCS12",
    "-keystore",
    signing.keystoreFile,
    "-storepass",
    signing.keystorePwd,
    "-alias",
    alias,
    "-file",
    file
  ], { cwd: projectRoot });
}

function firstCertificate(certChain) {
  const match = certChain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
  if (!match) {
    throw new Error("App certificate chain does not contain a PEM certificate.");
  }
  return `${match[0]}\n`;
}

function detectHdcInstallFailure(output) {
  const text = output.toLowerCase();
  const patterns = [
    "failed to install bundle",
    "error: failed",
    "install failed",
    "failure [",
    "error:"
  ];
  return patterns.find((pattern) => text.includes(pattern));
}

async function findLatestHap(options = {}) {
  const candidates = await collectHaps(path.join(projectRoot, "entry/build"));
  let filtered = options.unsignedOnly
    ? candidates.filter((candidate) => candidate.file.endsWith("-unsigned.hap"))
    : candidates;
  if (options.productName) {
    filtered = filtered.filter((candidate) => candidate.file.includes(`/${options.productName}/`)
      || path.basename(candidate.file).includes(options.productName));
  }
  if (options.sinceMs) {
    filtered = filtered.filter((candidate) => candidate.mtimeMs >= options.sinceMs - 1000);
  }
  if (options.preferSigned) {
    const signed = filtered.filter((candidate) => !candidate.file.endsWith("-unsigned.hap"));
    if (signed.length > 0) {
      filtered = signed;
    }
  }
  if (filtered.length === 0) {
    throw new Error("No .hap artifact found under platform/tools/harmony-screen-streamer/entry/build");
  }
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered[0].file;
}

async function collectHaps(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const haps = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      haps.push(...await collectHaps(file));
    } else if (entry.isFile() && entry.name.endsWith(".hap")) {
      const info = await stat(file);
      haps.push({ file, mtimeMs: info.mtimeMs });
    }
  }
  return haps;
}

function findExecutable(envName, candidates) {
  const envValue = process.env[envName];
  if (envValue) {
    return envValue;
  }
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  throw new Error(`Unable to find ${envName}. Set ${envName} to the executable path.`);
}

function valueAfter(values, name) {
  const index = values.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return values[index + 1];
}
