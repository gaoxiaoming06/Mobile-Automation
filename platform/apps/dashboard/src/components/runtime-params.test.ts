import { describe, expect, it } from "vitest";
import { parseRuntimeParams } from "./runtime-params.js";

describe("parseRuntimeParams", () => {
  it("parses explicit key-value runtime params", () => {
    expect(parseRuntimeParams("className=班级四十一号, lessonName=数学课")).toEqual({
      className: "班级四十一号",
      lessonName: "数学课"
    });
  });

  it("treats free text as a className target", () => {
    expect(parseRuntimeParams("班级四十二号")).toEqual({
      className: "班级四十二号"
    });
  });

  it("ignores empty input", () => {
    expect(parseRuntimeParams(" ")).toBeUndefined();
  });
});
