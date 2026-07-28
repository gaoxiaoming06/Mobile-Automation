export function resolveServerHost(env: Record<string, string | undefined> = process.env): string {
  return env.HOST?.trim() || "127.0.0.1";
}
