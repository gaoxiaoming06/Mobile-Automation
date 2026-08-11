import type { ToolStatus } from "@mobile-automation/shared";

export function ToolStatusBar({ tools }: { tools: ToolStatus[] }) {
  if (!tools.length) {
    return null;
  }

  return (
    <div className="tool-status">
      {tools.map((tool) => (
        <span
          key={tool.name}
          className={tool.available ? "tool-ok" : "tool-missing"}
          title={`${tool.name}: ${tool.available ? tool.version ?? "available" : "missing"}`}
        >
          {shortToolName(tool.name)}: {tool.available ? shortToolVersion(tool.version) : "missing"}
        </span>
      ))}
    </div>
  );
}

function shortToolName(name: string): string {
  const parts = name.split(":").filter(Boolean);
  return parts.at(-1) ?? name;
}

function shortToolVersion(version: string | undefined): string {
  if (!version) {
    return "available";
  }
  return version.split(/\s+/)[0] ?? version;
}
