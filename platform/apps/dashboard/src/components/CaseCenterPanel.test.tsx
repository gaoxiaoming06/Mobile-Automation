import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ScriptFlow } from "@mobile-automation/shared";
import { CaseCenterPanel, buildCaseRunRequest } from "./CaseCenterPanel.js";

describe("CaseCenterPanel", () => {
  it("shows reusable use cases and readable execution logic without exposing scripts", () => {
    const markup = renderToStaticMarkup(
      <CaseCenterPanel
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        selectedSerial="device-1"
        initialFlows={[flow(), scenario()]}
        setMessage={vi.fn()}
        onOpenRun={vi.fn()}
        onModifyCase={vi.fn()}
        onCreateCase={vi.fn()}
      />
    );

    expect(markup).toContain("用例中心");
    expect(markup).toContain("用例");
    expect(markup).toContain("场景");
    expect(markup).toContain("创建课堂但不发布");
    expect(markup).toContain("执行逻辑");
    expect(markup).toContain("确认已进入新建课堂页");
    expect(markup).toContain("修改测试");
    expect(markup).toContain("AI 创建测试");
    expect(markup).toContain("沉淀可复用的用例与场景");
    expect(markup).toContain("运行配置");
    expect(markup).not.toContain("风险确认");
    expect(markup).not.toContain("ScriptFlow YAML");
    expect(markup).not.toContain("脚本编辑器");
    expect(markup).not.toContain("校验脚本");
  });

  it("binds execution to the selected use case version and preview digest", () => {
    expect(buildCaseRunRequest({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" }
    })).toEqual({
      expectedVersion: 3,
      planDigest: "a".repeat(64),
      deviceSerial: "device-1",
      parameters: { className: "班级四十二号" }
    });
  });
});

function flow(): ScriptFlow {
  return {
    id: "flow-1",
    appId: "cn.eeo.classin",
    platform: "android",
    name: "创建课堂但不发布",
    description: "进入指定班级并填写新课堂信息，不执行发布。",
    sourceYaml: "internal script content",
    parsed: {
      version: 1,
      kind: "case",
      name: "创建课堂但不发布",
      description: "进入指定班级并填写新课堂信息，不执行发布。",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: { lessonName: { type: "string", label: "课堂名称", required: true } },
      steps: [{ id: "verify", name: "确认已进入新建课堂页", assertPage: "classin.lesson.create" }],
      tags: ["课堂"]
    },
    status: "active",
    version: 1,
    tags: ["课堂"],
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z"
  };
}

function scenario(): ScriptFlow {
  const value = flow();
  return {
    ...value,
    id: "scenario-1",
    name: "登录后创建课堂",
    parsed: { ...value.parsed, kind: "scenario", name: "登录后创建课堂" }
  };
}
