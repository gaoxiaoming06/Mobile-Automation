import { describe, expect, it } from "vitest";
import { parseForegroundBundle, parseLaunchAbility, parsePngSize } from "./harmony-parsers.js";

describe("Harmony parsers", () => {
  it("parses foreground bundle and ability from aa dump text", () => {
    const output = `
      current mission lists:{
        Mission ID #160  mission name #[#cn.eeo.hos.classin.mobile:entry:EntryAbility]
          AbilityRecord ID #1807
            app name [cn.eeo.hos.classin.mobile]
            main name [EntryAbility]
            bundle name [cn.eeo.hos.classin.mobile]
            state #FOREGROUND
      }
    `;

    expect(parseForegroundBundle(output)).toEqual({
      bundleId: "cn.eeo.hos.classin.mobile",
      abilityName: "EntryAbility"
    });
  });

  it("parses launch ability from bundle dump json", () => {
    const output = `{
      "hapModuleInfos": [{
        "mainAbility": "EntryAbility",
        "mainElementName": "EntryAbility"
      }]
    }`;

    expect(parseLaunchAbility(output)).toBe("EntryAbility");
  });

  it("parses PNG dimensions from the image header", () => {
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=",
      "base64"
    );

    expect(parsePngSize(onePixelPng)).toEqual({ width: 1, height: 1 });
  });
});
