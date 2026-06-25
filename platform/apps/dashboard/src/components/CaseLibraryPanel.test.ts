import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredFlow } from "@mobile-automation/shared";
import { describe, expect, it } from "vitest";
import { CaseLibraryPanel } from "./CaseLibraryPanel.js";

const asyncNoop = async () => undefined;

describe("CaseLibraryPanel", () => {
  it("renders structured flows as the main reusable case library", () => {
    const markup = renderPanel({
      flows: [createFlow()],
      selectedFlowId: "flow-1",
      highlightedFlowId: "flow-1",
      selectedSerial: "android-serial",
      selectedDeviceBusy: false
    });

    expect(markup).toContain("结构化用例库");
    expect(markup).toContain("已保存用例");
    expect(markup).toContain("按 App、版本、起点和终点管理可复用流程");
    expect(markup).toContain("ClassIn-5.0.8-首页-新建课堂页");
    expect(markup).toContain("3 步");
    expect(markup).toContain("ClassIn");
    expect(markup).toContain("5.0.8");
    expect(markup).toContain("首页 → 新建课堂页");
    expect(markup).toContain("case-row active recently-saved");
    expect(markup).toContain("编辑");
    expect(markup).toContain("执行");
  });

  it("filters structured flows by search text", () => {
    const markup = renderPanel({
      flows: [createFlow(), createFlow({ id: "flow-2", name: "登录冒烟", appName: "Demo", startState: flowState("登录页"), endState: flowState("首页") })],
      searchText: "新建课堂"
    });

    expect(markup).toContain("ClassIn-5.0.8-首页-新建课堂页");
    expect(markup).not.toContain("登录冒烟");
  });

  it("disables execution when no device is selected or the selected device is busy", () => {
    const noDeviceMarkup = renderPanel({
      flows: [createFlow()],
      selectedSerial: "",
      selectedDeviceBusy: false
    });
    const busyMarkup = renderPanel({
      flows: [createFlow()],
      selectedSerial: "android-serial",
      selectedDeviceBusy: true
    });

    expect(noDeviceMarkup).toContain("disabled=\"\"");
    expect(busyMarkup).toContain("当前设备正在执行任务");
    expect(busyMarkup).toContain("disabled=\"\"");
  });

  it("lets users choose a flow stop step before execution", () => {
    const markup = renderPanel({
      flows: [createFlow()],
      selectedSerial: "android-serial",
      selectedDeviceBusy: false
    });

    expect(markup).toContain("执行范围");
    expect(markup).toContain("完整执行");
    expect(markup).toContain("执行到：步骤 1");
    expect(markup).toContain("执行到：步骤 2");
    expect(markup).toContain("执行到：步骤 3");
  });

  it("shows selected flow details and structured step rules", () => {
    const markup = renderPanel({
      flows: [createFlow()],
      selectedFlowId: "flow-1",
      selectedSerial: "android-serial",
      selectedDeviceBusy: false
    });

    expect(markup).toContain("用例详情");
    expect(markup).toContain("ClassIn · android · 5.0.8");
    expect(markup).toContain("cn.eeo.classin");
    expect(markup).toContain("99856");
    expect(markup).toContain("restart_app");
    expect(markup).toContain("起点：首页");
    expect(markup).toContain("终点：新建课堂页");
    expect(markup).toContain("步骤详情");
    expect(markup).toContain("前置状态");
    expect(markup).toContain("before-1");
    expect(markup).toContain("执行动作");
    expect(markup).toContain("tap_on_element");
    expect(markup).toContain("后置预期");
    expect(markup).toContain("看到 步骤 1 完成");
    expect(markup).toContain("系统守护");
    expect(markup).toContain("无崩溃");
    expect(markup).toContain("最近结果：暂无");
  });

  it("renders semantic action details for input, scroll, and wait steps", () => {
    const markup = renderPanel({
      flows: [
        createFlow({
          steps: [
            flowStep("input", 1, {
              type: "input_text_to_element",
              params: {
                text: "hello",
                locator: { resourceId: "cn.eeo.classin:id/search" }
              }
            }),
            flowStep("scroll", 2, {
              type: "scroll_until_visible",
              params: {
                direction: "down",
                maxSwipes: 4,
                locator: { text: "新建课堂" }
              }
            }),
            flowStep("wait", 3, {
              type: "wait_until_state",
              params: {
                timeoutMs: 5000,
                locator: { resourceId: "cn.eeo.classin:id/ready" }
              }
            })
          ]
        })
      ],
      selectedFlowId: "flow-1",
      selectedSerial: "android-serial"
    });

    expect(markup).toContain("输入到元素");
    expect(markup).toContain("resourceId=cn.eeo.classin:id/search");
    expect(markup).toContain("滚动直到可见");
    expect(markup).toContain("direction=down");
    expect(markup).toContain("maxSwipes=4");
    expect(markup).toContain("等待状态");
    expect(markup).toContain("timeoutMs=5000");
  });

  it("renders editable text expectations in the selected flow detail", () => {
    const markup = renderPanel({
      flows: [createFlow()],
      selectedFlowId: "flow-1",
      selectedSerial: "android-serial",
      selectedDeviceBusy: false
    });

    expect(markup).toContain("编辑前置条件");
    expect(markup).toContain("aria-label=\"步骤 1 前置文字条件\"");
    expect(markup).toContain("value=\"before-1\"");
    expect(markup).toContain("编辑后置预期");
    expect(markup).toContain("保存预期");
    expect(markup).toContain("临时运行");
    expect(markup).toContain("仅本次运行，不保存到用例");
    expect(markup).toContain("aria-label=\"步骤 1 文字预期\"");
    expect(markup).toContain("value=\"步骤 1 完成\"");
  });

  it("shows a compact empty state before cases are saved", () => {
    const markup = renderPanel({ flows: [] });

    expect(markup).toContain("暂无结构化用例");
  });
});

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof CaseLibraryPanel>> = {}
): string {
  return renderToStaticMarkup(
    React.createElement(CaseLibraryPanel, {
      flows: [],
      searchText: "",
      selectedFlowId: "",
      highlightedFlowId: "",
      selectedSerial: "",
      selectedDeviceBusy: false,
      onSearchTextChange: () => undefined,
      onEditFlow: asyncNoop,
      onStartFlowRun: asyncNoop,
      onDeleteFlow: asyncNoop,
      ...overrides
    })
  );
}

function createFlow(overrides: Partial<StructuredFlow> = {}): StructuredFlow {
  return {
    id: "flow-1",
    name: "ClassIn-5.0.8-首页-新建课堂页",
    appName: "ClassIn",
    platform: "android",
    targetApp: { androidPackageName: "cn.eeo.classin" },
    appVersion: { displayVersion: "5.0.8", buildNumber: "99856" },
    startState: flowState("首页"),
    endState: flowState("新建课堂页"),
    startStrategy: "restart_app",
    tags: [],
    status: "active",
    version: 2,
    steps: [
      flowStep("step-1", 1),
      flowStep("step-2", 2),
      flowStep("step-3", 3)
    ],
    createdAt: "2026-06-09T01:02:03.000Z",
    updatedAt: "2026-06-09T08:09:10.000Z",
    ...overrides
  };
}

function flowState(name: string): StructuredFlow["startState"] {
  return {
    id: `state-${name}`,
    name,
    matchers: [{ id: `matcher-${name}`, type: "text", value: name, weight: 1 }],
    expectations: [expectation(`expect-${name}`, "text", { expected: name })]
  };
}

function flowStep(
  id: string,
  order: number,
  actionOverrides: Partial<StructuredFlow["steps"][number]["action"]> = {}
): StructuredFlow["steps"][number] {
  return {
    id,
    order,
    title: `步骤 ${order}`,
    enabled: true,
    beforeState: flowState(`before-${order}`),
    action: {
      id: `${id}-action`,
      order,
      type: "tap_on_element",
      enabled: true,
      params: {},
      createdAt: "2026-06-09T01:02:03.000Z",
      ...actionOverrides
    },
    afterExpectations: [expectation(`after-${id}`, "text", { expected: `步骤 ${order} 完成` })],
    systemGuards: [expectation(`guard-${id}`, "no_crash", {})],
    createdAt: "2026-06-09T01:02:03.000Z"
  };
}

function expectation(
  id: string,
  type: StructuredFlow["steps"][number]["afterExpectations"][number]["type"],
  params: Record<string, unknown>
): StructuredFlow["steps"][number]["afterExpectations"][number] {
  return {
    id,
    type,
    enabled: true,
    params,
    createdAt: "2026-06-09T01:02:03.000Z"
  };
}
