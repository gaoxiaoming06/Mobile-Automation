import { describe, expect, it } from "vitest";
import type { GeneratedDraft } from "./AiScriptFlowsPanel.js";
import {
  addDraftStep,
  duplicateDraftStep,
  moveDraftStep,
  removeDraftStep,
  setDraftLoopResetMode,
  updateDraftStep,
  updateDraftStepLocator
} from "./script-flow-orchestrator.js";

describe("script-flow orchestrator", () => {
  it("adds a reset step and can explicitly declare that no reset is needed", () => {
    const added = addDraftStep(baseDraft(), undefined, "tap", "reset");

    expect(added.draft.document.steps.at(-1)).toMatchObject({ role: "reset" });
    expect(added.draft.document.loop).toBeUndefined();

    const withoutReset = removeDraftStep(added.draft, added.stepKey);
    const closed = setDraftLoopResetMode(withoutReset, "none");
    expect(closed.document.loop).toEqual({ reset: "none" });
    expect(closed.sourceYaml).toContain('reset: "none"');
  });

  it("changes an executable action and edits its action-specific values", () => {
    const changed = updateDraftStep(baseDraft(), "0:tap-target", {
      action: "inputText",
      name: "填写课堂名称",
      value: "${classroomName}",
      role: "business"
    });

    expect(changed.status).toBe("trial_ready");
    expect(changed.verification).toBeUndefined();
    expect(changed.document.steps[0]).toMatchObject({
      id: "tap-target",
      name: "填写课堂名称",
      role: "business",
      inputText: {
        target: { control: "textField" },
        value: "${classroomName}",
        search: { mode: "auto" }
      }
    });
    expect(changed.sourceYaml).toContain("inputText:");
    expect(changed.sourceYaml).not.toContain("verification");
  });

  it("edits page, assertion, and swipe fields without changing the step id", () => {
    const pageStep = updateDraftStep(baseDraft(), "0:tap-target", {
      action: "assertPage",
      page: "classroom.create"
    });
    expect(pageStep.document.steps[0]).toEqual(expect.objectContaining({
      id: "tap-target",
      assertPage: "classroom.create"
    }));
    expect(pageStep.document.steps[0]).not.toHaveProperty("risk");

    const textStep = updateDraftStep(pageStep, "0:tap-target", {
      action: "assertText",
      value: "创建成功",
      match: "exact"
    });
    expect(textStep.document.steps[0]).toMatchObject({ assertText: { text: "创建成功", match: "exact" } });

    const swipeStep = updateDraftStep(textStep, "0:tap-target", {
      action: "swipe",
      direction: "down",
      distance: "0.6"
    });
    expect(swipeStep.document.steps[0]).toMatchObject({ swipe: { direction: "down", distance: 0.6 } });
  });

  it("drops stale internal risk metadata when the action type changes", () => {
    const draft = baseDraft();
    draft.document.steps[0] = {
      ...draft.document.steps[0],
      risk: "publish"
    };

    const updated = updateDraftStep(draft, "0:tap-target", {
      action: "assertPage",
      page: "classroom.create"
    });

    expect(updated.document.steps[0]).not.toHaveProperty("risk");
  });

  it("adds, duplicates, moves, and removes steps without duplicate ids", () => {
    const added = addDraftStep(baseDraft(), "0:tap-target", "assertText");
    expect(added.draft.document.steps).toHaveLength(2);
    expect(added.stepKey).toBe("1:assert-text-step");

    const duplicated = duplicateDraftStep(added.draft, added.stepKey);
    expect(duplicated.draft.document.steps.map((step) => step.id)).toEqual([
      "tap-target",
      "assert-text-step",
      "assert-text-step-copy"
    ]);

    const moved = moveDraftStep(duplicated.draft, duplicated.stepKey, "up");
    expect(moved.document.steps.map((step) => step.id)).toEqual([
      "tap-target",
      "assert-text-step-copy",
      "assert-text-step"
    ]);

    const removed = removeDraftStep(moved, "1:assert-text-step-copy");
    expect(removed.document.steps.map((step) => step.id)).toEqual(["tap-target", "assert-text-step"]);
  });

  it("keeps nested moves inside their parent block and refreshes copied child ids", () => {
    const draft = baseDraft();
    draft.document.steps = [{
      id: "repeat-fields",
      repeat: {
        times: 2,
        steps: [
          { id: "fill-first", inputText: { target: { text: "第一个" }, value: "1" } },
          { id: "fill-second", inputText: { target: { text: "第二个" }, value: "2" } }
        ]
      }
    }];

    const moved = moveDraftStep(draft, "0.1:fill-second", "up");
    expect(((moved.document.steps[0]!.repeat as { steps: Array<{ id: string }> }).steps).map((step) => step.id)).toEqual([
      "fill-second",
      "fill-first"
    ]);

    const duplicated = duplicateDraftStep(moved, "0:repeat-fields");
    const copied = duplicated.draft.document.steps[1] as {
      id: string;
      repeat: { steps: Array<{ id: string }> };
    };
    expect(copied.id).toBe("repeat-fields-copy");
    expect(copied.repeat.steps.map((step) => step.id)).toEqual(["fill-second-copy", "fill-first-copy"]);
  });

  it("updates locator fields while preserving action-specific values", () => {
    const draft = updateDraftStep(baseDraft(), "0:tap-target", {
      action: "inputText",
      value: "自动化课堂"
    });
    const updated = updateDraftStepLocator(draft, "0:tap-target", {
      targetKind: "control",
      targetValue: "textField",
      area: "content",
      scopeText: "课堂名称",
      ordinal: "1",
      searchMode: "auto",
      direction: "down",
      maxSwipes: "6",
      resetToTop: "true",
      container: "content"
    });

    expect(updated.document.steps[0]).toMatchObject({
      inputText: {
        target: { control: "textField", area: "content", scopeText: "课堂名称", ordinal: 1 },
        value: "自动化课堂",
        search: { mode: "auto", direction: "down", maxSwipes: 6, resetToTop: true, container: "content" }
      }
    });
  });

  it("keeps target edits valid when changing a text field locator to a switch", () => {
    const draft = updateDraftStep(baseDraft(), "0:tap-target", { action: "inputText" });

    const updated = updateDraftStepLocator(draft, "0:tap-target", {
      targetKind: "control",
      targetValue: "switch"
    });

    expect(updated.document.steps[0]).toMatchObject({
      inputText: {
        target: { control: "switch", area: "content", nearText: "待填写字段", checked: false }
      }
    });
  });
});

function baseDraft(): GeneratedDraft {
  return {
    status: "ready",
    sourceYaml: "stale",
    document: {
      version: 1,
      kind: "case",
      purpose: "business",
      testLevel: "component",
      name: "创建课堂",
      app: { id: "cn.eeo.classin", platform: "android" },
      parameters: {
        classroomName: { type: "string", label: "课堂名称" }
      },
      steps: [{
        id: "tap-target",
        name: "点击目标",
        tap: { target: { text: "创建课堂" }, search: { mode: "auto" } }
      }],
      tags: []
    },
    summary: "创建课堂",
    assumptions: [],
    verification: {
      status: "verified",
      sourceHash: "a".repeat(64),
      reasons: [],
      unresolvedStepIds: [],
      unresolvedOutcome: false
    },
    channel: "test",
    model: "test"
  };
}
