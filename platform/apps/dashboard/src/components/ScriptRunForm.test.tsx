import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScriptRunForm } from "./ScriptRunForm.js";

describe("ScriptRunForm", () => {
  it("renders typed required and optional parameters without key=value input", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{
          className: { type: "string", label: "班级", required: true, control: "select", options: [{ label: "四十二号", value: "班级四十二号" }] },
          duration: { type: "number", label: "时长", default: 30, advanced: true },
          publish: { type: "boolean", label: "发布", default: false, control: "toggle" }
        }}
        values={{ className: "班级四十二号", duration: 30, publish: false }}
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        deviceSerial="device-1"
        busy={false}
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain("运行配置");
    expect(markup).toContain("班级");
    expect(markup).toContain("四十二号");
    expect(markup).toContain("可选参数");
    expect(markup).toContain("单次执行");
    expect(markup).toContain("循环业务与验证");
    expect(markup).toContain("循环整个用例");
    expect(markup).not.toContain("风险确认");
    expect(markup).not.toContain("key=value");
  });

  it("keeps the idle label when execution is disabled", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{}}
        values={{}}
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        deviceSerial="device-1"
        busy={false}
        disabled
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain("开始执行");
    expect(markup).not.toContain("启动中");
    expect(markup).toContain("disabled=\"\"");
  });

  it("renders single, body-loop, and whole-case execution modes", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{}}
        values={{}}
        devices={[{ serial: "device-1" }]}
        deviceSerial="device-1"
        busy={false}
        executionMode="loop_body"
        onExecutionModeChange={vi.fn()}
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain("单次执行");
    expect(markup).toContain("循环业务与验证");
    expect(markup).toContain("循环整个用例");
    expect(markup).toContain("aria-pressed=\"true\"");
  });

  it("disables business looping until the reset contract is configured", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{}}
        values={{}}
        devices={[{ serial: "device-1" }]}
        deviceSerial="device-1"
        busy={false}
        executionMode="loop_body"
        loopBodyAvailable={false}
        loopBodyUnavailableReason="请先配置每轮复位步骤"
        onExecutionModeChange={vi.fn()}
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>循环业务与验证<\/button>/);
    expect(markup).toContain("请先配置每轮复位步骤");
    expect(markup).toMatch(/script-run-button[^>]*disabled=""/);
  });

  it("offers a stop command while a continuous run is active", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{}}
        values={{}}
        devices={[{ serial: "device-1" }]}
        deviceSerial="device-1"
        busy={false}
        executionMode="loop_all"
        active
        currentIteration={4}
        onExecutionModeChange={vi.fn()}
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRun={vi.fn()}
        onStop={vi.fn()}
      />
    );

    expect(markup).toContain("第 4 轮");
    expect(markup).toContain("停止循环");
    expect(markup).not.toContain(">开始执行<");
  });
});
