import { describe, expect, it } from "vitest";
import { harmonyDumpLayoutToUiHierarchyXml, parseForegroundBundle, parseLaunchAbility, parsePngSize } from "./harmony-parsers.js";

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

  it("prefers the foreground mission when background missions appear earlier", () => {
    const output = `
      User ID #100
        current mission lists:{
          Mission ID #52  mission name #[#com.tencent.wework.hmos:phone:EntryAbility]
            AbilityRecord ID #4307
              app name [com.tencent.wework.hmos]
              main name [EntryAbility]
              bundle name [com.tencent.wework.hmos]
              ability type [PAGE]
              state #BACKGROUND
              app state #BACKGROUND
          Mission ID #47  mission name #[#cn.eeo.hos.classin.mobile:entry:EntryAbility]
            AbilityRecord ID #5133
              app name [cn.eeo.hos.classin.mobile]
              main name [EntryAbility]
              bundle name [cn.eeo.hos.classin.mobile]
              ability type [PAGE]
              state #FOREGROUND
              app state #FOREGROUND
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

  it("converts Harmony dumpLayout TextInput nodes to a UI hierarchy", () => {
    const dumpLayout = JSON.stringify({
      attributes: { bounds: "[0,0][1256,2760]", type: "" },
      children: [
        {
          attributes: {
            bundleName: "cn.eeo.hos.classin.mobile",
            bounds: "[0,122][1256,2760]",
            clickable: "false",
            enabled: "true",
            type: "root"
          },
          children: [
            {
              attributes: {
                bounds: "[327,766][1118,866]",
                clickable: "true",
                enabled: "true",
                hint: "请输入手机号/邮箱",
                type: "TextInput"
              }
            },
            {
              attributes: {
                bounds: "[137,993][1118,1091]",
                clickable: "true",
                enabled: "true",
                hint: "请输入密码",
                type: "TextInput"
              }
            }
          ]
        }
      ]
    });

    const xml = harmonyDumpLayoutToUiHierarchyXml(dumpLayout);

    expect(xml).toContain("<hierarchy");
    expect(xml).toContain('package="cn.eeo.hos.classin.mobile"');
    expect(xml).toContain('class="harmony.widget.TextInput"');
    expect(xml).toContain('content-desc="请输入手机号/邮箱"');
    expect(xml).toContain('content-desc="请输入密码"');
    expect(xml).toContain('focusable="true"');
    expect(xml).toContain('bounds="[137,993][1118,1091]"');
  });
});
