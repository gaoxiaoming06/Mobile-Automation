import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScriptFlow } from "@mobile-automation/shared";
import { ScriptFlowsPanel, buildScriptRunRequest, isScriptFlowDirty } from "./ScriptFlowsPanel.js";

describe("ScriptFlowsPanel", () => {
  it("renders a script library, YAML editor, validation preview, and typed run controls", () => {
    const markup = renderToStaticMarkup(
      <ScriptFlowsPanel
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        selectedSerial="device-1"
        initialFlows={[flow()]}
        setMessage={vi.fn()}
        onOpenRun={vi.fn()}
      />
    );

    expect(markup).toContain("脚本用例");
    expect(markup).toContain("创建课堂但不发布");
    expect(markup).toContain("ScriptFlow YAML");
    expect(markup).toContain("校验");
    expect(markup).toContain("运行配置");
    expect(markup).not.toContain("PageTask");
    expect(markup).not.toContain("连接边");
    expect(markup).not.toContain("key=value");
  });

  it("treats source and status changes as unsaved execution state", () => {
    const saved = flow();

    expect(isScriptFlowDirty(saved, saved.sourceYaml, saved.status)).toBe(false);
    expect(isScriptFlowDirty(saved, `${saved.sourceYaml}\n# changed`, saved.status)).toBe(true);
    expect(isScriptFlowDirty(saved, saved.sourceYaml, "archived")).toBe(true);
    expect(isScriptFlowDirty(undefined, saved.sourceYaml, saved.status)).toBe(true);
  });

  it("binds execution to the exact preview digest", () => {
    expect(buildScriptRunRequest({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" },
      confirmedRiskSteps: ["open-class"]
    })).toEqual({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" },
      confirmedRiskSteps: ["open-class"]
    });
  });
});

function flow(): ScriptFlow {
  return {
    id: "flow-1",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "创建课堂但不发布",
    sourceYaml: "version: 1\nname: 创建课堂但不发布\napp: { id: cn.eeo.classin, platform: android }\nsteps:\n  - id: verify\n    assertPage: classin.lesson.create\n",
    parsed: {
      version: 1,
      name: "创建课堂但不发布",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: { lessonName: { type: "string", label: "课堂名称", required: true } },
      steps: [{ id: "verify", assertPage: "classin.lesson.create" }],
      tags: []
    },
    status: "active",
    version: 1,
    tags: [],
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };
}
