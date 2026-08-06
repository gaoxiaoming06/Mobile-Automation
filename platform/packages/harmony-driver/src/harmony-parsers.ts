export function parseHdcTargets(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = line.toLowerCase();
      return !normalized.includes("empty") && !normalized.startsWith("list of devices");
    })
    .flatMap((line) => {
      const [serial, state] = line.split(/\s+/);
      if (!serial) {
        return [];
      }
      if (state && state !== "device") {
        return [];
      }
      return [serial];
    })
    .filter(Boolean);
}

export function parseForegroundBundle(output: string): { bundleId?: string; abilityName?: string } {
  const foregroundBlock = foregroundAbilityBlock(output);
  if (foregroundBlock) {
    const bundleId = firstMatch(foregroundBlock, [
      /\bbundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
      /\bbundle\s*[:=]\s*([A-Za-z0-9_.-]+)/,
      /\bBundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
      /\bbundle name\s*\[([A-Za-z0-9_.-]+)\]/i
    ]);
    const abilityName = firstMatch(foregroundBlock, [
      /\babilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
      /\bAbilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
      /\bmain name\s*\[([A-Za-z0-9_.-]+)\]/i
    ]);
    if (bundleId || abilityName) {
      return { bundleId, abilityName };
    }
  }

  const bundleId = firstMatch(output, [
    /\bbundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bbundle\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bBundleName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bbundle name\s*\[([A-Za-z0-9_.-]+)\]/i
  ]);
  const abilityName = firstMatch(output, [
    /\babilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bAbilityName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bmain name\s*\[([A-Za-z0-9_.-]+)\]/i
  ]);
  return { bundleId, abilityName };
}

function foregroundAbilityBlock(output: string): string | undefined {
  const blocks = output.split(/(?=\n\s*(?:Mission ID|AbilityRecord ID)\s+#\d+)/);
  return blocks.find((block) => /(?:^|\n)\s*(?:state|app state)\s*#FOREGROUND\b/i.test(block));
}

export function parseLaunchAbility(output: string): string | undefined {
  return firstMatch(output, [
    /"mainAbility"\s*:\s*"([^"]+)"/,
    /"mainElementName"\s*:\s*"([^"]+)"/,
    /\bmainAbility\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bmainElementName\s*[:=]\s*([A-Za-z0-9_.-]+)/
  ]);
}

export function parseBundleVersion(output: string): string | undefined {
  return firstMatch(output, [
    /\bversionName\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bappVersion\s*[:=]\s*([A-Za-z0-9_.-]+)/,
    /\bversion\s*[:=]\s*([A-Za-z0-9_.-]+)/
  ]);
}

export function harmonyDumpLayoutToUiHierarchyXml(input: string): string {
  const root = parseHarmonyLayoutJson(input);
  const children = serializeHarmonyNode(root, {
    depth: 0,
    siblingIndex: 0,
    inheritedBundleName: undefined
  });
  return [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    "<hierarchy rotation=\"0\">",
    children,
    "</hierarchy>"
  ].filter(Boolean).join("\n");
}

export function parsePngSize(png: Uint8Array): { width: number; height: number } | undefined {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 24 || !pngSignature.every((byte, index) => png[index] === byte)) {
    return undefined;
  }
  return {
    width: readUint32Be(png, 16),
    height: readUint32Be(png, 20)
  };
}

type HarmonyLayoutNode = {
  attributes: Record<string, string>;
  children: HarmonyLayoutNode[];
};

function parseHarmonyLayoutJson(input: string): HarmonyLayoutNode {
  return toHarmonyLayoutNode(JSON.parse(input) as unknown);
}

function toHarmonyLayoutNode(value: unknown): HarmonyLayoutNode {
  const record = isRecord(value) ? value : {};
  const attributes = isRecord(record.attributes)
    ? Object.fromEntries(
      Object.entries(record.attributes).map(([key, item]) => [
        key,
        typeof item === "string" ? item : item === undefined || item === null ? "" : String(item)
      ])
    )
    : {};
  const children = Array.isArray(record.children)
    ? record.children.map((child) => toHarmonyLayoutNode(child))
    : [];
  return { attributes, children };
}

function serializeHarmonyNode(
  node: HarmonyLayoutNode,
  options: {
    depth: number;
    siblingIndex: number;
    inheritedBundleName?: string;
  }
): string {
  const attrs = node.attributes;
  const bundleName = blankToUndefined(attrs.bundleName) ?? options.inheritedBundleName;
  const childXml = node.children
    .map((child, index) => serializeHarmonyNode(child, {
      depth: options.depth + 1,
      siblingIndex: index,
      inheritedBundleName: bundleName
    }))
    .filter(Boolean)
    .join("\n");
  const bounds = blankToUndefined(attrs.bounds);
  if (!bounds) {
    return childXml;
  }
  const xmlAttributes = {
    index: String(options.siblingIndex),
    text: blankToUndefined(attrs.text) ?? blankToUndefined(attrs.originalText) ?? "",
    "resource-id": stableHarmonyResourceId(attrs) ?? "",
    class: harmonyClassName(attrs.type),
    package: bundleName ?? "",
    "content-desc": blankToUndefined(attrs.description) ?? blankToUndefined(attrs.hint) ?? stableHarmonyAccessibilityId(attrs) ?? "",
    clickable: booleanAttr(attrs.clickable, false),
    enabled: booleanAttr(attrs.enabled, true),
    focusable: booleanAttr(attrs.focusable, isHarmonyFocusableType(attrs.type)),
    "long-clickable": booleanAttr(attrs.longClickable ?? attrs["long-clickable"], false),
    scrollable: booleanAttr(attrs.scrollable, false),
    bounds
  };
  const indent = "  ".repeat(options.depth + 1);
  const start = `${indent}<node ${Object.entries(xmlAttributes).map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ")}`;
  if (!childXml) {
    return `${start} />`;
  }
  return `${start}>\n${childXml}\n${indent}</node>`;
}

function harmonyClassName(type: string | undefined): string {
  const normalized = blankToUndefined(type)?.replace(/[^\w.$-]/g, "_") ?? "View";
  return `harmony.widget.${normalized}`;
}

function stableHarmonyResourceId(attrs: Record<string, string>): string | undefined {
  return [attrs.id, attrs.key]
    .map((value) => blankToUndefined(value))
    .find((value): value is string => Boolean(value));
}

function stableHarmonyAccessibilityId(attrs: Record<string, string>): string | undefined {
  const value = blankToUndefined(attrs.accessibilityId);
  if (!value || /^\d+$/.test(value)) {
    return undefined;
  }
  return value;
}

function isHarmonyFocusableType(type: string | undefined): boolean {
  const normalized = blankToUndefined(type)?.toLowerCase() ?? "";
  return normalized.includes("textinput") ||
    normalized.includes("textarea") ||
    normalized.includes("searchinput") ||
    normalized === "search";
}

function booleanAttr(value: string | undefined, fallback: boolean): string {
  if (value === "true" || value === "false") {
    return value;
  }
  return fallback ? "true" : "false";
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function firstMatch(output: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
