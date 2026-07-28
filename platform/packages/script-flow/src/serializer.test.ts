import { describe, expect, it } from "vitest";
import { parseScriptFlow } from "./parser.js";
import { serializeScriptFlow } from "./serializer.js";

describe("serializeScriptFlow", () => {
  it("round trips a validated document", () => {
    const source = serializeScriptFlow({
      version: 1,
      name: "打开添加好友",
      app: { id: "cn.eeo.classin", platform: "android" },
      start: { strategy: "launchApp" },
      parameters: {},
      steps: [{
        id: "open-add-friend",
        name: "打开添加好友",
        onPage: "classin.home",
        expectPage: "classin.friend.add",
        tap: { target: { ocrText: "添加好友" } }
      }],
      tags: ["ai-generated"]
    });

    expect(parseScriptFlow(source)).toMatchObject({
      name: "打开添加好友",
      steps: [{ onPage: "classin.home", expectPage: "classin.friend.add" }]
    });
  });
});
