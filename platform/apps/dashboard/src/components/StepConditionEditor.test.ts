import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ActionStep } from "@mobile-automation/shared";
import { describe, expect, it, vi } from "vitest";
import { StepConditionEditor } from "./StepConditionEditor";

describe("StepConditionEditor", () => {
  it("renders condition fields for tap_if_text steps", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StepConditionEditor, {
        step: {
          id: "step-1",
          order: 1,
          type: "tap_if_text",
          enabled: true,
          coordinate: { x: 12, y: 34 },
          params: {
            text: "允许",
            mode: "contains",
            timeoutMs: 3000,
            intervalMs: 500
          },
          createdAt: "2026-06-04T00:00:00.000Z"
        } satisfies ActionStep,
        update: vi.fn()
      })
    );

    expect(markup).toContain("触发文字");
    expect(markup).toContain("允许");
    expect(markup).toContain("点击 X");
    expect(markup).toContain("点击 Y");
    expect(markup).toContain("等待 ms");
    expect(markup).toContain("轮询 ms");
  });

  it("does not render for normal tap steps", () => {
    const markup = renderToStaticMarkup(
      React.createElement(StepConditionEditor, {
        step: {
          id: "step-1",
          order: 1,
          type: "tap",
          enabled: true,
          coordinate: { x: 12, y: 34 },
          params: {},
          createdAt: "2026-06-04T00:00:00.000Z"
        } satisfies ActionStep,
        update: vi.fn()
      })
    );

    expect(markup).toBe("");
  });
});
