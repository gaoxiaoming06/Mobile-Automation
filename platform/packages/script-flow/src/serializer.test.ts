import { describe, expect, it } from "vitest";
import { parseScriptFlow } from "./parser.js";
import { serializeScriptFlow } from "./serializer.js";

describe("serializeScriptFlow", () => {
  it("round trips a validated document", () => {
    const source = serializeScriptFlow({
      version: 1,
      kind: "case",
      name: "打开添加好友",
      app: { id: "classin" },
      start: { strategy: "launchApp" },
      parameters: {},
      steps: [{
        id: "open-add-friend",
        name: "打开添加好友",
        onPage: "classin.home",
        expectPage: "classin.friend.add",
        tap: { target: { text: "添加好友" } }
      }],
      tags: ["ai-generated"]
    });

    expect(parseScriptFlow(source)).toMatchObject({
      name: "打开添加好友",
      app: { id: "classin" },
      steps: [{ onPage: "classin.home", expectPage: "classin.friend.add" }]
    });
    expect(source).not.toContain("platform");
  });
});
