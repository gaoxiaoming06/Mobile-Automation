import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = path.join(rootDir, ".venv-paddleocr");
const requirementsFile = path.join(rootDir, "requirements-ocr.txt");
const wheelDir = path.join(rootDir, "vendor/ocr-wheels");
const venvPython = path.join(venvDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const hasUv = commandExists("uv");
const wheelArgs = existsSync(wheelDir) ? ["--no-index", "--find-links", wheelDir] : [];

if (existsSync(venvPython)) {
  installRequirements();
} else if (hasUv) {
  run("uv", ["venv", ".venv-paddleocr", "--python", "3.11"], { cwd: rootDir });
  installRequirements();
} else {
  run("python3", ["-m", "venv", ".venv-paddleocr"], { cwd: rootDir });
  installRequirements();
}

console.log(`RapidOCR runtime ready at ${path.relative(rootDir, venvPython)}`);

function commandExists(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function installRequirements() {
  if (hasUv) {
    run("uv", ["pip", "install", "--python", venvPython, ...wheelArgs, "-r", requirementsFile], { cwd: rootDir });
    return;
  }
  run(venvPython, ["-m", "ensurepip", "--upgrade"]);
  run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(venvPython, ["-m", "pip", "install", ...wheelArgs, "-r", requirementsFile]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}
