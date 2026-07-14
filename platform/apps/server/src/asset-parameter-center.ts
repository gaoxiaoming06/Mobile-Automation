import type { BusinessGraphVersion } from "@mobile-automation/graph-core";
import type { AssetParameterValueType, ParameterDataRecord, ParameterProfile } from "@mobile-automation/shared";
import { collectAssetRuntimeParamDefinitions, type AssetRuntimeParamDefinition, type AssetRuntimeParamUsage } from "./asset-patrol.js";

export type AssetParameterDefinition = {
  key: string;
  label: string;
  type: AssetParameterValueType;
  sensitive: boolean;
  scenarioKey: string;
  scenarioLabel: string;
  usages: AssetRuntimeParamUsage[];
};

export type AssetParameterGroup = {
  key: string;
  label: string;
  parameterKeys: string[];
};

export type AssetParameterManifest = {
  appId: string;
  platform: "android" | "ios";
  graphVersionId: string;
  definitions: AssetParameterDefinition[];
  groups: AssetParameterGroup[];
};

export type ParameterProfileRuntimeSnapshot = {
  runtimeParams: Record<string, string>;
  profile: {
    id: string;
    name: string;
    version: number;
  };
};

export type ParameterProfileRuntimeSnapshotInput = {
  profile: ParameterProfile;
  appId: string;
  platform: ParameterProfile["platform"];
  records?: ParameterDataRecord[];
  overrides?: Record<string, string>;
};

export function buildAssetParameterManifest(input: {
  appId: string;
  platform: "android" | "ios";
  graphVersion: BusinessGraphVersion;
}): AssetParameterManifest {
  const definitions = collectAssetRuntimeParamDefinitions(input.graphVersion)
    .map((definition) => toParameterDefinition(definition))
    .sort((left, right) => left.scenarioLabel.localeCompare(right.scenarioLabel, "zh-CN") || left.key.localeCompare(right.key));
  const groups = Array.from(
    definitions.reduce((result, definition) => {
      const group = result.get(definition.scenarioKey) ?? {
        key: definition.scenarioKey,
        label: definition.scenarioLabel,
        parameterKeys: []
      };
      group.parameterKeys.push(definition.key);
      result.set(definition.scenarioKey, group);
      return result;
    }, new Map<string, AssetParameterGroup>()).values()
  ).map((group) => ({ ...group, parameterKeys: [...group.parameterKeys].sort((left, right) => left.localeCompare(right, "zh-CN")) }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

  return {
    appId: input.appId,
    platform: input.platform,
    graphVersionId: input.graphVersion.id,
    definitions,
    groups
  };
}

export function parameterProfileRuntimeParams(profile: ParameterProfile, records: ParameterDataRecord[] = []): ParameterProfileRuntimeSnapshot {
  const recordValues = resolveBoundRecordValues(profile, records);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return {
    runtimeParams: Object.fromEntries(
      Object.entries({ ...recordValues, ...profile.values })
        .map(([key, value]) => {
          const rawValue = value.type === "template"
            ? String(value.value).replaceAll("{{timestamp}}", timestamp)
            : String(value.value);
          return [key.trim(), rawValue.trim()] as const;
        })
        .filter(([key, value]) => key.length > 0 && value.length > 0)
    ),
    profile: {
      id: profile.id,
      name: profile.name,
      version: profile.version
    }
  };
}

/**
 * Resolves one immutable execution snapshot. Callers may still pass explicit
 * overrides for API compatibility, but profile applicability is never optional.
 */
export function resolveParameterProfileRuntimeSnapshot(input: ParameterProfileRuntimeSnapshotInput): ParameterProfileRuntimeSnapshot {
  const profileAppId = input.profile.appId.trim();
  const requestedAppId = input.appId.trim();
  if (profileAppId !== requestedAppId || input.profile.platform !== input.platform) {
    throw new Error(`参数集“${input.profile.name}”不属于当前应用或平台。`);
  }
  if (input.profile.status !== "active") {
    throw new Error(`参数集“${input.profile.name}”已废弃，不能用于执行。`);
  }
  const snapshot = parameterProfileRuntimeParams(input.profile, input.records ?? []);
  const overrides = Object.fromEntries(
    Object.entries(input.overrides ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0)
  );
  return {
    ...snapshot,
    runtimeParams: {
      ...snapshot.runtimeParams,
      ...overrides
    }
  };
}

function resolveBoundRecordValues(profile: ParameterProfile, records: ParameterDataRecord[]): ParameterProfile["values"] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const values: ParameterProfile["values"] = {};
  const boundDomains = new Set<string>();

  for (const binding of profile.bindings ?? []) {
    const domainKey = binding.domainKey.trim();
    if (!domainKey || !binding.recordId.trim()) {
      throw new Error(`参数集“${profile.name}”包含无效的数据域绑定。`);
    }
    if (boundDomains.has(domainKey)) {
      throw new Error(`参数集“${profile.name}”为数据域“${domainKey}”选择了多条记录。`);
    }
    boundDomains.add(domainKey);

    const record = recordById.get(binding.recordId);
    if (!record) {
      throw new Error(`参数集“${profile.name}”引用的数据记录不存在：${binding.recordId}。`);
    }
    if (record.appId !== profile.appId || record.platform !== profile.platform) {
      throw new Error(`参数集“${profile.name}”引用的数据记录“${record.name}”不属于当前应用或平台。`);
    }
    if (record.status !== "active") {
      throw new Error(`参数集“${profile.name}”引用的数据记录“${record.name}”已废弃。`);
    }
    if (record.domainKey !== domainKey) {
      throw new Error(`参数集“${profile.name}”的数据域“${domainKey}”与记录“${record.name}”不匹配。`);
    }

    Object.assign(values, record.values);
  }

  return values;
}

function toParameterDefinition(definition: AssetRuntimeParamDefinition): AssetParameterDefinition {
  const primaryUsage = definition.usages[0];
  const dataDomain = parameterDataDomain(definition.key, definition.usages);
  return {
    key: definition.key,
    label: parameterLabel(definition.key, primaryUsage),
    type: parameterType(definition.key, definition.usages),
    sensitive: isSensitiveParameter(definition.key),
    scenarioKey: dataDomain.key,
    scenarioLabel: dataDomain.label,
    usages: definition.usages
  };
}

/**
 * Runtime parameters describe business data, not the page that happened to
 * collect a field. For example, the classroom-edit subpage belongs to the
 * same classroom draft as its parent creation flow.
 */
function parameterDataDomain(key: string, usages: AssetRuntimeParamUsage[]): { key: string; label: string } {
  const context = usages
    .map((usage) => `${usage.pageModelName} ${usage.taskName} ${usage.stepLabel ?? ""}`)
    .join(" ")
    .toLowerCase();
  const normalizedKey = key.trim().toLowerCase();

  if (/phone|mobile|password|credential|account|账号|密码|手机号/.test(normalizedKey) || /登录/.test(context)) {
    return { key: "login_credentials", label: "登录账号" };
  }
  if (normalizedKey === "classname" || /班级名称|班级列表|选择班级/.test(context)) {
    return { key: "class_target", label: "班级目标" };
  }
  if (/公开课/.test(context)) {
    return { key: "public_class_draft", label: "新建公开课" };
  }
  if (/新建课堂|编辑课堂信息|课堂信息/.test(context)) {
    return { key: "classroom_draft", label: "新建课堂" };
  }
  const primaryUsage = usages[0];
  if (primaryUsage) {
    return {
      key: `page:${primaryUsage.pageModelId}`,
      label: primaryUsage.pageModelName
    };
  }
  return { key: "shared", label: "通用参数" };
}

function parameterLabel(key: string, usage?: AssetRuntimeParamUsage): string {
  const labels: Record<string, string> = {
    phone: "手机号",
    password: "密码",
    className: "班级名称",
    lessonName: "课堂名称",
    duration: "课堂时长"
  };
  return labels[key] ?? usage?.stepLabel ?? key;
}

function parameterType(key: string, usages: AssetRuntimeParamUsage[]): AssetParameterValueType {
  if (usages.some((usage) => usage.binding === "desired_state" || /toggle|switch|checkbox|boolean/i.test(usage.fieldType ?? ""))) {
    return "boolean";
  }
  if (/duration|count|number|seat|limit|size|amount|time/i.test(key) || usages.some((usage) => /number|numeric|slider/i.test(usage.fieldType ?? ""))) {
    return "number";
  }
  return "string";
}

function isSensitiveParameter(key: string): boolean {
  return /pass(word)?|secret|token|credential|api.?key|auth/i.test(key);
}
