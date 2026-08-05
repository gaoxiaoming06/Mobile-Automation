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
