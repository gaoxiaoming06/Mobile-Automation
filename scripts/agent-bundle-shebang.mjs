export function normalizeAgentBundleShebang(bundle) {
  let body = bundle;
  while (body.startsWith("#!")) {
    const newlineIndex = body.indexOf("\n");
    body = newlineIndex === -1 ? "" : body.slice(newlineIndex + 1);
  }
  return `#!/usr/bin/env node\n${body}`;
}
