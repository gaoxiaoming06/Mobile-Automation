import { describe, expect, it } from "vitest";
import { HarmonyActionExecutor } from "./harmony-actions.js";

describe("HarmonyActionExecutor", () => {
  it("maps tap to uitest click", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "";
      },
      sleep: async () => undefined
    });

    await executor.performAction("SERIAL", { type: "tap", x: 12, y: 34 });

    expect(calls).toEqual([["uitest", "uiInput", "click", "12", "34"]]);
  });

  it("maps swipe to uitest swipe", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "";
      },
      sleep: async () => undefined
    });

    await executor.performAction("SERIAL", {
      type: "swipe",
      startX: 1,
      startY: 2,
      endX: 30,
      endY: 40,
      durationMs: 500
    });

    expect(calls).toEqual([["uitest", "uiInput", "swipe", "1", "2", "30", "40", "500"]]);
  });

  it("maps launch app to aa start with ability when provided", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "start ability successfully.";
      },
      sleep: async () => undefined,
      abilityName: () => "EntryAbility"
    });

    await executor.performAction("SERIAL", { type: "launch_app", packageName: "com.eeo.classin.harmony" });

    expect(calls).toEqual([["aa", "start", "-a", "EntryAbility", "-b", "com.eeo.classin.harmony"]]);
  });

  it("discovers the launcher ability before starting a Harmony app", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        if (args[0] === "bm") {
          return `{
            "hapModuleInfos": [{
              "mainAbility": "EntryAbility",
              "mainElementName": "EntryAbility"
            }]
          }`;
        }
        return "start ability successfully.";
      },
      sleep: async () => undefined
    });

    await executor.performAction("SERIAL", { type: "launch_app", packageName: "cn.eeo.hos.classin.mobile" });

    expect(calls).toEqual([
      ["bm", "dump", "-n", "cn.eeo.hos.classin.mobile"],
      ["aa", "start", "-a", "EntryAbility", "-b", "cn.eeo.hos.classin.mobile"]
    ]);
  });

  it("treats failed aa start output as a launch failure", async () => {
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        if (args[0] === "bm") {
          return `{ "mainAbility": "EntryAbility" }`;
        }
        return "error: failed to start ability.\nError Code:10103101";
      },
      sleep: async () => undefined
    });

    await expect(
      executor.performAction("SERIAL", { type: "launch_app", packageName: "cn.eeo.hos.classin.mobile" })
    ).rejects.toThrow("failed to start ability");
  });

  it("waits briefly after a successful app launch", async () => {
    const sleeps: number[] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        if (args[0] === "bm") {
          return `{ "mainAbility": "EntryAbility" }`;
        }
        return "start ability successfully.";
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    await executor.performAction("SERIAL", { type: "launch_app", packageName: "cn.eeo.hos.classin.mobile" });

    expect(sleeps).toEqual([4500]);
  });

  it("clears data with bm clean", async () => {
    const calls: string[][] = [];
    const executor = new HarmonyActionExecutor({
      shell: async (_serial, args) => {
        calls.push(args);
        return "clean bundle data files successfully.";
      },
      sleep: async () => undefined
    });

    await executor.clearAppData("SERIAL", "com.eeo.classin.harmony");

    expect(calls).toEqual([["bm", "clean", "-d", "-n", "com.eeo.classin.harmony"]]);
  });
});
