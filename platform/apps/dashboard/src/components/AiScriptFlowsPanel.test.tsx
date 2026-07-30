import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiScriptFlowsPanel } from "./AiScriptFlowsPanel.js";

describe("AiScriptFlowsPanel", () => {
  it("shows a generated draft without reading current device state", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 打开主页",
        document: {
          version: 1,
          kind: "case",
          name: "打开主页",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {},
          steps: [{ id: "launch", name: "启动 ClassIn", launchApp: { appId: "cn.eeo.classin" } }],
          tags: []
        },
        summary: "启动 App 并等待主页",
        assumptions: [],
        channel: "codex",
        model: "planner"
      }}
    />);

    expect(markup).toContain("AI 生成测试");
    expect(markup).toContain("用例");
    expect(markup).toContain("直接执行");
    expect(markup).toContain("保存到用例中心");
    expect(markup).toContain("执行逻辑");
    expect(markup).toContain("启动 ClassIn");
    expect(markup).toContain("启动 App 并等待主页");
    expect(markup).not.toContain("version: 1");
    expect(markup).not.toContain("进入脚本编辑器");
    expect(markup).not.toContain("识别当前设备页面");
    expect(markup).not.toContain("key=value");
  });

  it("uses natural language to revise an existing use case", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[]}
      selectedSerial=""
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      revision={{ flowId: "flow-login", version: 3, name: "教师登录" }}
    />);

    expect(markup).toContain("修改测试");
    expect(markup).toContain("教师登录");
    expect(markup).toContain("描述你想怎样修改这个测试");
    expect(markup).not.toContain("App ID");
  });

  it("prefills ephemeral parameter values returned with an AI draft", () => {
    const markup = renderToStaticMarkup(<AiScriptFlowsPanel
      defaultAppId="cn.eeo.classin"
      devices={[{ serial: "device-1", name: "YAL-AL10" }]}
      selectedSerial="device-1"
      setMessage={vi.fn()}
      onSaved={vi.fn()}
      onOpenRun={vi.fn()}
      initialDraft={{
        status: "ready",
        sourceYaml: "version: 1\nname: 教师登录",
        document: {
          version: 1,
          kind: "case",
          name: "教师登录",
          app: { id: "cn.eeo.classin", platform: "android" },
          parameters: {
            account: { type: "string", label: "手机号或邮箱", required: true, sensitive: true },
            password: { type: "string", label: "密码", required: true, sensitive: true }
          },
          steps: [],
          tags: []
        },
        parameterValues: { account: "demo-account", password: "demo-secret" },
        summary: "登录教师账号",
        assumptions: [],
        channel: "codex",
        model: "planner"
      } as never}
    />);

    expect(markup).toContain('value="demo-account"');
    expect(markup).toContain('value="demo-secret"');
  });
});
