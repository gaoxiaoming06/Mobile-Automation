import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiScriptFlowsPanel } from "./AiScriptFlowsPanel.js";

describe("AiScriptFlowsPanel", () => {
  it("shows a generated draft without reading current device state", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      setMessage={vi.fn()}
      onUseDraft={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 打开主页",
        document: { name: "打开主页", steps: [{ id: "launch" }] },
        summary: "启动 App 并等待主页",
        assumptions: [],
        channel: "codex",
        model: "planner"
      }}
    />);

    expect(markup).toContain("AI 生成用例");
    expect(markup).toContain("进入脚本编辑器");
    expect(markup).toContain("启动 App 并等待主页");
    expect(markup).not.toContain("识别当前设备页面");
    expect(markup).not.toContain("key=value");
  });
});
