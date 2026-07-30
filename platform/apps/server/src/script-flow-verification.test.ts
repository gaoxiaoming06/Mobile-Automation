import { describe, expect, it } from "vitest";
import type { ScriptFlowDocument } from "@mobile-automation/script-flow";
import {
  assessScriptFlowVerification,
  scriptFlowSourceHash
} from "./script-flow-verification.js";

describe("ScriptFlow verification assessment", () => {
  it("requires a trial for a new executable flow while recognizing its result oracle", () => {
    const sourceYaml = "version: 1\nname: 打开添加好友";
    const document = flow([
      { id: "launch", launchApp: { appId: "cn.eeo.classin" } },
      {
        id: "open-add-friend",
        onPage: "classin.home",
        tap: { target: { text: "添加好友" } },
        expectPage: "classin.friend.add"
      }
    ], { page: "classin.friend.add" });

    expect(assessScriptFlowVerification({ document, sourceYaml })).toEqual({
      status: "needs_trial",
      sourceHash: scriptFlowSourceHash(sourceYaml),
      reasons: ["当前脚本版本尚未通过试运行"],
      unresolvedStepIds: ["launch", "open-add-friend"],
      unresolvedOutcome: false
    });
  });

  it("marks the exact verified source version as directly executable", () => {
    const sourceYaml = "version: 1\nname: 已验证流程";
    const sourceHash = scriptFlowSourceHash(sourceYaml);

    expect(assessScriptFlowVerification({
      document: flow([{ id: "verify-home", assertPage: "classin.home" }], { page: "classin.home" }),
      sourceYaml,
      verifiedSourceHashes: [sourceHash]
    })).toEqual({
      status: "verified",
      sourceHash,
      reasons: [],
      unresolvedStepIds: [],
      unresolvedOutcome: false
    });
  });

  it("blocks a draft when deterministic validation reports a hard reason", () => {
    const assessment = assessScriptFlowVerification({
      document: flow([{ id: "tap-unknown", tap: { target: { semantic: "未知入口" } } }]),
      sourceYaml: "version: 1\nname: 不完整流程",
      blockedReasons: ["缺少可验证的结果条件"]
    });

    expect(assessment).toMatchObject({
      status: "blocked",
      reasons: ["缺少可验证的结果条件"],
      unresolvedStepIds: ["tap-unknown"],
      unresolvedOutcome: true
    });
  });

  it("does not treat session metadata or a non-final assertion as the business outcome", () => {
    const sessionOnly = assessScriptFlowVerification({
      document: flow([{ id: "tap-login", tap: { target: { text: "登录" } } }], { session: "authenticated" }),
      sourceYaml: "version: 1\nname: session only"
    });
    const intermediateAssertion = assessScriptFlowVerification({
      document: flow([
        { id: "verify-home", assertPage: "classin.home" },
        { id: "open-settings", tap: { target: { text: "设置" } } }
      ]),
      sourceYaml: "version: 1\nname: intermediate assertion"
    });

    expect(sessionOnly.unresolvedOutcome).toBe(true);
    expect(intermediateAssertion.unresolvedOutcome).toBe(true);
  });
});

function flow(
  steps: ScriptFlowDocument["steps"],
  outcome?: ScriptFlowDocument["outcome"]
): ScriptFlowDocument {
  return {
    version: 1,
    kind: "case",
    name: "测试流程",
    app: { id: "cn.eeo.classin", platform: "android" },
    parameters: {},
    ...(outcome ? { outcome } : {}),
    steps,
    tags: []
  };
}
