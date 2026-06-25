import { nowIso, type DeviceEvent, type InstalledAppInfo } from "@mobile-automation/shared";

export type AndroidDeviceLine = {
  serial: string;
  state: string;
  details: string;
};

export type AndroidObservedDeviceEvent = Pick<DeviceEvent, "type" | "severity" | "summary"> & {
  occurredAt?: string;
  detail?: string;
};

export type AndroidForegroundApp = {
  componentName?: string;
  packageName?: string;
  activityName?: string;
};

export function parseDeviceLine(line: string): AndroidDeviceLine | null {
  const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
  if (!match) {
    return null;
  }
  return {
    serial: match[1],
    state: match[2],
    details: match[3] ?? ""
  };
}

export function parseWmSize(output: string): { width: number; height: number } | undefined {
  const match = output.match(/(\d+)x(\d+)/);
  if (!match) {
    return undefined;
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

export function escapeInputText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/\s/g, "%s")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

export function escapeShellSingleQuoted(text: string): string {
  return text.replace(/'/g, "'\\''");
}

export function parseProcStat(output: string): { idle: number; total: number } | undefined {
  const line = output.split(/\r?\n/).find((item) => item.startsWith("cpu "));
  if (!line) {
    return undefined;
  }
  const values = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

export function parseMeminfo(output: string): { totalKb?: number; usedKb?: number; raw: Record<string, number> } {
  const raw: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) {
      raw[match[1]] = Number(match[2]);
    }
  }
  const totalKb = raw.MemTotal;
  const availableKb = raw.MemAvailable;
  return {
    totalKb,
    usedKb: typeof totalKb === "number" && typeof availableKb === "number" ? totalKb - availableKb : undefined,
    raw
  };
}

export function parseBattery(output: string): { level?: number; temperatureC?: number; raw: Record<string, number> } {
  const raw: Record<string, number> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([\w\s]+):\s*(-?\d+)/);
    if (match) {
      raw[match[1].trim()] = Number(match[2]);
    }
  }
  return {
    level: raw.level,
    temperatureC: typeof raw.temperature === "number" ? raw.temperature / 10 : undefined,
    raw
  };
}

export function formatLogcatSince(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return [
    `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  ].join(" ");
}

export function parseAndroidLogEvent(line: string, recentLines: string[]): AndroidObservedDeviceEvent | undefined {
  if (line.includes("FATAL EXCEPTION")) {
    return {
      type: "crash",
      severity: "error",
      occurredAt: nowIso(),
      summary: "Android crash detected",
      detail: recentLines.slice(-30).join("\n")
    };
  }
  const anrMatch = line.match(/\bANR in\s+([^\s]+)/);
  if (anrMatch) {
    return {
      type: "anr",
      severity: "error",
      occurredAt: nowIso(),
      summary: `Android ANR detected${anrMatch[1] ? `: ${anrMatch[1]}` : ""}`,
      detail: recentLines.slice(-40).join("\n")
    };
  }
  if (/Exception occurred while executing|(?:^|\s)(?:adb|am|pm|cmd):?\s+(?:Command failed|Failure)|cmd: Failure/i.test(line)) {
    return {
      type: "command_failed",
      severity: "warning",
      occurredAt: nowIso(),
      summary: "Android command failure detected",
      detail: recentLines.slice(-20).join("\n")
    };
  }
  return undefined;
}

export function assertAmStartSucceeded(output: string): void {
  if (/^(Error:|Exception:)|unable to resolve|not found|does not exist/i.test(output.trim())) {
    throw new Error(output.trim());
  }
}

export function pickLauncherComponent(output: string, packageName: string): string | undefined {
  const components = parseLauncherComponents(output, packageName);
  return components.find((component) => !isDebugLauncherComponent(component)) ?? components[0];
}

export function parseFocusedComponent(output: string): string | undefined {
  const focusLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /mCurrentFocus|mFocusedApp|topResumedActivity|mResumedActivity|ResumedActivity|mLastResumedActivity/i.test(line));
  if (!focusLine) {
    return undefined;
  }
  const component = focusLine.match(/\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)(?:\s|}|$)/)?.[1];
  return component;
}

export function parseForegroundApp(output: string): AndroidForegroundApp {
  const componentName = parseFocusedComponent(output);
  if (!componentName) {
    return {};
  }
  return foregroundAppFromComponent(componentName);
}

export function parsePackageInfo(output: string, packageName: string): InstalledAppInfo | undefined {
  if (/Unable to find package|not found|Unknown package/i.test(output)) {
    return undefined;
  }
  const versionName = output.match(/^\s*versionName=([^\r\n]+)/m)?.[1]?.trim();
  const versionCode = output.match(/^\s*versionCode=([^\s\r\n]+)/m)?.[1]?.trim();
  const firstInstallTime = output.match(/^\s*firstInstallTime=([^\r\n]+)/m)?.[1]?.trim();
  const lastUpdateTime = output.match(/^\s*lastUpdateTime=([^\r\n]+)/m)?.[1]?.trim();
  if (!versionName && !versionCode && !firstInstallTime && !lastUpdateTime) {
    return undefined;
  }
  return {
    packageName,
    displayVersion: versionName || "unknown",
    ...(versionCode ? { versionCode } : {}),
    ...(firstInstallTime ? { firstInstallTime } : {}),
    ...(lastUpdateTime ? { lastUpdateTime } : {})
  };
}

export function isForegroundComponentForPackage(component: string | undefined, packageName: string): boolean {
  return !!component && isComponentForPackage(component, packageName) && !isDebugLauncherComponent(component);
}

export function isPmClearSuccess(output: string): boolean {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .some((line) => line === "success" || line.endsWith(" success"));
}

function parseLauncherComponents(output: string, packageName: string): string[] {
  const components: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const component = parseLauncherComponentLine(rawLine, packageName);
    if (component && !components.includes(component)) {
      components.push(component);
    }
  }
  return components;
}

function parseLauncherComponentLine(rawLine: string, packageName: string): string | undefined {
  const line = rawLine.trim();
  if (!line || line.startsWith("priority=")) {
    return undefined;
  }
  const componentMatch = line.match(new RegExp(`(?:^|\\s)(${escapeRegExp(packageName)}/[^\\s]+)`));
  const component = componentMatch?.[1] ?? (line.startsWith(`${packageName}/`) ? line : undefined);
  if (!component || !isComponentForPackage(component, packageName)) {
    return undefined;
  }
  return component;
}

function isComponentForPackage(component: string, packageName: string): boolean {
  if (!component.includes("/")) {
    return false;
  }
  const componentPackage = component.split("/")[0];
  return componentPackage === packageName;
}

function foregroundAppFromComponent(componentName: string): AndroidForegroundApp {
  const [packageName, rawActivityName] = componentName.split("/");
  if (!packageName || !rawActivityName) {
    return {
      componentName
    };
  }
  return {
    componentName,
    packageName,
    activityName: rawActivityName.startsWith(".") ? `${packageName}${rawActivityName}` : rawActivityName
  };
}

function isDebugLauncherComponent(component: string): boolean {
  return /(?:blockcanary|leakcanary|plumber|debug|devtools)/i.test(component);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
