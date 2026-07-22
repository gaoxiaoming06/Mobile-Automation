import type { AndroidAppMonitorConfig, AndroidAppMonitorThreshold } from "@mobile-automation/shared";

export function readAndroidAppMonitorConfig(value: unknown): AndroidAppMonitorConfig | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("androidAppMonitor must be an object");
  }
  const input = value as Record<string, unknown>;
  const enabled = input.enabled === true;
  const packageName = stringOrUndefined(input.packageName);
  if (enabled && !packageName) {
    throw new Error("androidAppMonitor.packageName is required when enabled");
  }

  const processFilters = Array.isArray(input.processFilters)
    ? input.processFilters.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : undefined;
  const thresholds = readThresholds(input.thresholds);
  return {
    enabled,
    ...(packageName ? { packageName } : { packageName: "" }),
    includeSubprocesses: typeof input.includeSubprocesses === "boolean" ? input.includeSubprocesses : true,
    ...(processFilters?.length ? { processFilters } : {}),
    ...positiveNumberProperty("cpuIntervalMs", input.cpuIntervalMs),
    ...positiveNumberProperty("memoryIntervalMs", input.memoryIntervalMs),
    ...positiveNumberProperty("lifecycleIntervalMs", input.lifecycleIntervalMs),
    ...(typeof input.enableHeapDump === "boolean" ? { enableHeapDump: input.enableHeapDump } : {}),
    ...(thresholds ? { thresholds } : {})
  };
}

function readThresholds(value: unknown): AndroidAppMonitorConfig["thresholds"] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("androidAppMonitor.thresholds must be an object");
  }
  const input = value as Record<string, unknown>;
  const cpuPercent = readThreshold(input.cpuPercent, "cpuPercent");
  const pssMb = readThreshold(input.pssMb, "pssMb");
  return cpuPercent || pssMb
    ? {
        ...(cpuPercent ? { cpuPercent } : {}),
        ...(pssMb ? { pssMb } : {})
      }
    : undefined;
}

function readThreshold(value: unknown, name: string): AndroidAppMonitorThreshold | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`androidAppMonitor.thresholds.${name} must be an object`);
  }
  const input = value as Record<string, unknown>;
  const thresholdValue = positiveNumber(input.value);
  if (thresholdValue === undefined) {
    return undefined;
  }
  return {
    enabled: input.enabled === true,
    value: thresholdValue,
    sustainMs: positiveNumber(input.sustainMs) ?? 5000,
    cooldownMs: positiveNumber(input.cooldownMs) ?? 30000
  };
}

function positiveNumberProperty(key: string, value: unknown): Record<string, number> {
  const parsed = positiveNumber(value);
  return parsed === undefined ? {} : { [key]: parsed };
}

function positiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
