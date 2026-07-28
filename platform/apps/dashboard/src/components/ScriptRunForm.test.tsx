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
        requiredRisks={["publish"]}
        confirmedRisks={[]}
        busy={false}
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRiskChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain("运行配置");
    expect(markup).toContain("班级");
    expect(markup).toContain("四十二号");
    expect(markup).toContain("可选参数");
    expect(markup).toContain("风险确认");
    expect(markup).not.toContain("key=value");
  });

  it("keeps the idle label when execution is disabled", () => {
    const markup = renderToStaticMarkup(
      <ScriptRunForm
        parameters={{}}
        values={{}}
        devices={[{ serial: "device-1", name: "YAL-AL10" }]}
        deviceSerial="device-1"
        requiredRisks={[]}
        confirmedRisks={[]}
        busy={false}
        disabled
        onValueChange={vi.fn()}
        onDeviceChange={vi.fn()}
        onRiskChange={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain("开始执行");
    expect(markup).not.toContain("启动中");
    expect(markup).toContain("disabled=\"\"");
  });
});
