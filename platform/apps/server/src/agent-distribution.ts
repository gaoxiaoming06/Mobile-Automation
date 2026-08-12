import type express from "express";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export const agentBundleFileName = "mobile-automation-agent.cjs";

export type AgentDistributionManifest = {
  version: string;
  file: string;
  url: string;
  sha256: string;
};

export type AgentDistributionRoutesOptions = {
  distributionDir: string;
  version?: string;
  sha256?: string;
};

export type AgentInstallScriptOptions = {
  defaultServerUrl: string;
};

export function registerAgentDistributionRoutes(app: express.Express, options: AgentDistributionRoutesOptions): void {
  app.get("/agent/manifest.json", async (_req, res) => {
    try {
      const sha256 = options.sha256 ?? await sha256File(path.join(options.distributionDir, agentBundleFileName));
      res.json(agentDistributionManifest({ version: options.version ?? "0.1.0", sha256 }));
    } catch (error) {
      sendAgentDistributionError(res, error);
    }
  });

  app.get("/agent/install.sh", (req, res) => {
    const defaultServerUrl = singleQueryValue(req.query.server) ?? requestOrigin(req);
    res.type("text/x-shellscript").send(buildAgentInstallScript({ defaultServerUrl }));
  });

  app.get("/agent/install.ps1", (req, res) => {
    const defaultServerUrl = singleQueryValue(req.query.server) ?? requestOrigin(req);
    res.type("text/plain").send(buildAgentPowerShellInstallScript({ defaultServerUrl }));
  });

  app.get(`/agent/${agentBundleFileName}`, (_req, res) => {
    res.sendFile(path.join(options.distributionDir, agentBundleFileName), (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ error: "Agent bundle has not been built. Run pnpm build:agent first." });
      }
    });
  });
}

export function agentDistributionManifest(input: { version: string; sha256: string }): AgentDistributionManifest {
  return {
    version: input.version,
    file: agentBundleFileName,
    url: `/agent/${agentBundleFileName}`,
    sha256: input.sha256
  };
}

export function buildAgentInstallScript(options: AgentInstallScriptOptions): string {
  const defaultServerUrl = shellDoubleQuoted(options.defaultServerUrl.replace(/\/+$/, ""));
  return `#!/usr/bin/env bash
set -euo pipefail

DEFAULT_SERVER_URL="${defaultServerUrl}"
SERVER_URL="$DEFAULT_SERVER_URL"
AGENT_ID="$(hostname)"
SHARED=0
PAIRING_CODE=""
INSECURE_TLS=0
AGENT_HOME="\${MOBILE_AUTOMATION_AGENT_HOME:-$HOME/.mobile-automation-agent}"
AGENT_FILE="$AGENT_HOME/${agentBundleFileName}"
VERSION_FILE="$AGENT_HOME/agent.version"
CONTROL_PORT="\${MOBILE_AUTOMATION_AGENT_CONTROL_PORT:-17611}"

usage() {
  cat <<'USAGE'
Usage: install.sh [--server <url>] [--agent-id <id>] (--shared | --pairing-code <code>) [--insecure-tls]
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      SERVER_URL="$2"
      shift 2
      ;;
    --server=*)
      SERVER_URL="\${1#--server=}"
      shift
      ;;
    --agent-id)
      AGENT_ID="$2"
      shift 2
      ;;
    --agent-id=*)
      AGENT_ID="\${1#--agent-id=}"
      shift
      ;;
    --shared)
      SHARED=1
      shift
      ;;
    --pairing-code)
      PAIRING_CODE="$2"
      shift 2
      ;;
    --pairing-code=*)
      PAIRING_CODE="\${1#--pairing-code=}"
      shift
      ;;
    --insecure-tls)
      INSECURE_TLS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

SERVER_URL="\${SERVER_URL%/}"
if [ "$SHARED" = "1" ] && [ -n "$PAIRING_CODE" ]; then
  echo "--shared and --pairing-code cannot be used together" >&2
  exit 2
fi
if [ "$SHARED" != "1" ] && [ -z "$PAIRING_CODE" ]; then
  echo "Choose --shared or provide --pairing-code <code>" >&2
  exit 2
fi
if ! command -v "\${NODE_BIN:-node}" >/dev/null 2>&1; then
  echo "Node.js is required. Set NODE_BIN=/path/to/node if needed." >&2
  exit 1
fi

NODE_CMD="\${NODE_BIN:-node}"
CURL_TLS_FLAG=""
if [ "$INSECURE_TLS" = "1" ]; then
  CURL_TLS_FLAG="-k"
  export NODE_TLS_REJECT_UNAUTHORIZED=0
fi

mkdir -p "$AGENT_HOME"

curl_fetch() {
  curl $CURL_TLS_FLAG -fsSL "$@"
}

MANIFEST_JSON="$(curl_fetch "$SERVER_URL/agent/manifest.json")"
VERSION="$("$NODE_CMD" -e 'const m=JSON.parse(process.argv[1]); process.stdout.write(String(m.version || ""));' "$MANIFEST_JSON")"
SHA256="$("$NODE_CMD" -e 'const m=JSON.parse(process.argv[1]); process.stdout.write(String(m.sha256 || ""));' "$MANIFEST_JSON")"
BUNDLE_URL="$("$NODE_CMD" -e 'const m=JSON.parse(process.argv[1]); const base=process.argv[2].replace(/\\/+$/, "") + "/"; process.stdout.write(new URL(m.url || "/agent/${agentBundleFileName}", base).toString());' "$MANIFEST_JSON" "$SERVER_URL")"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    echo "No sha256 tool found (shasum or sha256sum)." >&2
    exit 1
  fi
}

NEEDS_DOWNLOAD=1
if [ -f "$AGENT_FILE" ] && [ -f "$VERSION_FILE" ] && [ "$(cat "$VERSION_FILE")" = "$VERSION" ]; then
  if [ -z "$SHA256" ] || [ "$(sha256_of "$AGENT_FILE")" = "$SHA256" ]; then
    NEEDS_DOWNLOAD=0
  fi
fi

if [ "$NEEDS_DOWNLOAD" = "1" ]; then
  TMP_FILE="$AGENT_FILE.tmp"
  echo "Downloading Mobile Automation Agent $VERSION..."
  curl_fetch "$BUNDLE_URL" > "$TMP_FILE"
  if [ -n "$SHA256" ] && [ "$(sha256_of "$TMP_FILE")" != "$SHA256" ]; then
    rm -f "$TMP_FILE"
    echo "Downloaded Agent checksum mismatch." >&2
    exit 1
  fi
  mv "$TMP_FILE" "$AGENT_FILE"
  echo "$VERSION" > "$VERSION_FILE"
fi

AGENT_ENV=(
  "MOBILE_AUTOMATION_AGENT_HOME=$AGENT_HOME"
  "MOBILE_AUTOMATION_AGENT_FILE=$AGENT_FILE"
  "MOBILE_AUTOMATION_AGENT_CONTROL_PORT=$CONTROL_PORT"
  "DEVICE_AGENT_SERVER_URL=$SERVER_URL"
  "DEVICE_AGENT_ID=$AGENT_ID"
)
if [ "$SHARED" = "1" ]; then
  AGENT_ENV+=("DEVICE_AGENT_SHARED=1")
else
  AGENT_ENV+=("DEVICE_AGENT_PAIRING_CODE=$PAIRING_CODE")
fi
if [ "$INSECURE_TLS" = "1" ]; then
  AGENT_ENV+=("NODE_TLS_REJECT_UNAUTHORIZED=0")
fi

echo "Starting Mobile Automation Agent."
echo "Local control: http://127.0.0.1:$CONTROL_PORT"
echo "Server: $SERVER_URL"
exec env "\${AGENT_ENV[@]}" "$NODE_CMD" "$AGENT_FILE"
`;
}

export function buildAgentPowerShellInstallScript(options: AgentInstallScriptOptions): string {
  const defaultServerUrl = powerShellSingleQuoted(options.defaultServerUrl.replace(/\/+$/, ""));
  return `param(
  [string]$Server = '${defaultServerUrl}',
  [string]$AgentId = $env:COMPUTERNAME,
  [switch]$Shared,
  [string]$PairingCode = "",
  [switch]$InsecureTls
)

$ErrorActionPreference = "Stop"
$Server = $Server.TrimEnd("/")
if ($Shared -and $PairingCode) { throw "--Shared and --PairingCode cannot be used together" }
if (-not $Shared -and [string]::IsNullOrWhiteSpace($PairingCode)) { throw "Choose -Shared or provide -PairingCode <code>" }

$NodeCmd = if ($env:NODE_BIN) { $env:NODE_BIN } else { "node" }
if (-not (Get-Command $NodeCmd -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Set NODE_BIN to node.exe if needed."
}

$AgentHome = if ($env:MOBILE_AUTOMATION_AGENT_HOME) { $env:MOBILE_AUTOMATION_AGENT_HOME } else { Join-Path $HOME ".mobile-automation-agent" }
$AgentFile = Join-Path $AgentHome "${agentBundleFileName}"
$VersionFile = Join-Path $AgentHome "agent.version"
$ControlPort = if ($env:MOBILE_AUTOMATION_AGENT_CONTROL_PORT) { $env:MOBILE_AUTOMATION_AGENT_CONTROL_PORT } else { "17611" }
New-Item -ItemType Directory -Force -Path $AgentHome | Out-Null

$WebParams = @{}
if ($InsecureTls) { $WebParams.SkipCertificateCheck = $true }
$Manifest = Invoke-RestMethod @WebParams -Uri "$Server/agent/manifest.json"
$BundleUrl = [System.Uri]::new([System.Uri]::new("$Server/"), $Manifest.url).AbsoluteUri
$NeedsDownload = $true
if ((Test-Path $AgentFile) -and (Test-Path $VersionFile) -and ((Get-Content $VersionFile -Raw).Trim() -eq [string]$Manifest.version)) {
  $ExistingHash = (Get-FileHash -Algorithm SHA256 $AgentFile).Hash.ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace([string]$Manifest.sha256) -or $ExistingHash -eq ([string]$Manifest.sha256).ToLowerInvariant()) {
    $NeedsDownload = $false
  }
}

if ($NeedsDownload) {
  $TempFile = "$AgentFile.tmp"
  Write-Host "Downloading Mobile Automation Agent $($Manifest.version)..."
  Invoke-WebRequest @WebParams -UseBasicParsing -Uri $BundleUrl -OutFile $TempFile
  if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.sha256)) {
    $ActualHash = (Get-FileHash -Algorithm SHA256 $TempFile).Hash.ToLowerInvariant()
    if ($ActualHash -ne ([string]$Manifest.sha256).ToLowerInvariant()) {
      Remove-Item -Force $TempFile -ErrorAction SilentlyContinue
      throw "Downloaded Agent checksum mismatch."
    }
  }
  Move-Item -Force $TempFile $AgentFile
  Set-Content -Path $VersionFile -Value ([string]$Manifest.version)
}

$env:MOBILE_AUTOMATION_AGENT_HOME = $AgentHome
$env:MOBILE_AUTOMATION_AGENT_FILE = $AgentFile
$env:MOBILE_AUTOMATION_AGENT_CONTROL_PORT = $ControlPort
$env:DEVICE_AGENT_SERVER_URL = $Server
$env:DEVICE_AGENT_ID = $AgentId
$env:DEVICE_AGENT_SHARED = if ($Shared) { "1" } else { "" }
$env:DEVICE_AGENT_PAIRING_CODE = if ($Shared) { "" } else { $PairingCode }
if ($InsecureTls) { $env:NODE_TLS_REJECT_UNAUTHORIZED = "0" }

Write-Host "Starting Mobile Automation Agent."
Write-Host "Local control: http://127.0.0.1:$ControlPort"
Write-Host "Server: $Server"
& $NodeCmd $AgentFile
`;
}

async function sha256File(filePath: string): Promise<string> {
  return crypto.createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function requestOrigin(req: express.Request): string {
  const proto = singleHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol;
  const host = singleHeaderValue(req.headers["x-forwarded-host"]) ?? req.get("host") ?? "127.0.0.1:4010";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function singleQueryValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function singleHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() ? raw.trim().split(",")[0]?.trim() : undefined;
}

function shellDoubleQuoted(value: string): string {
  return value.replace(/["\\$`]/g, (char) => `\\${char}`);
}

function powerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function sendAgentDistributionError(res: express.Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(404).json({ error: message });
}
