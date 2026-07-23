export function parseRuntimeParams(value: string | undefined): Record<string, string> | undefined {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return undefined;
  }
  const entries = normalized
    .split(/[\n,，;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      if (separator < 0) {
        return undefined;
      }
      const key = item.slice(0, separator).trim();
      const paramValue = item.slice(separator + 1).trim();
      return key && paramValue ? [key, paramValue] as const : undefined;
    })
    .filter((item): item is readonly [string, string] => Boolean(item));
  if (entries.length) {
    return Object.fromEntries(entries);
  }
  return { className: normalized };
}
