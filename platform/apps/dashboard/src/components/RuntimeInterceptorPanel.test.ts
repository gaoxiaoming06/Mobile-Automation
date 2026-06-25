import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuntimeInterceptorPanel } from "./RuntimeInterceptorPanel.js";

describe("RuntimeInterceptorPanel", () => {
  it("renders current runtime blocker rules and the mark-current-page entry", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeInterceptorPanel, {
        selectedSerial: "android-serial",
        selectedDevice: {
          id: "device-1",
          serial: "android-serial",
          platform: "android",
          status: "online",
          capabilities: {
            preview: true,
            tap: true,
            longPress: true,
            swipe: true,
            back: true,
            home: true,
            recentApps: true,
            textInput: true,
            screenshot: true,
            launchApp: true,
            closeApp: true,
            recordVideo: true,
            metrics: { cpu: true, memory: true, fps: false, network: false, battery: true, temperature: false },
            events: { crash: true, anr: true, logs: true }
          },
          lastSeenAt: "2026-06-16T09:00:00.000Z"
        },
        rules: [
          {
            id: "rule-subject-picker",
            name: "选择学科临时页",
            enabled: true,
            platformScope: "android",
            appPackageName: "cn.eeo.classin",
            matchers: [{ type: "text", value: "选择学科" }],
            action: { type: "tap_text", text: "关闭" }
          }
        ],
        onMarkCurrentPage: async () => undefined,
        onDeleteRule: async () => undefined
      })
    );

    expect(markup).toContain("临时阻断页");
    expect(markup).toContain("标记当前页");
    expect(markup).toContain("选择学科临时页");
    expect(markup).toContain("看到 选择学科");
    expect(markup).toContain("点击文字 关闭");
  });
});
