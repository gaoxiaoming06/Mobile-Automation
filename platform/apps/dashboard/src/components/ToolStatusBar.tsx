import type { ToolStatus } from "@mobile-automation/shared";

export function ToolStatusBar({ tools }: { tools: ToolStatus[] }) {
  if (!tools.length) {
    return null;
  }

  return (
    <div className="tool-status">
      {tools.map((tool) => (
        <span key={tool.name} className={tool.available ? "tool-ok" : "tool-missing"}>
          {tool.name}: {tool.available ? tool.version ?? "available" : "missing"}
        </span>
      ))}
    </div>
  );
}
