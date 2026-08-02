import { describe, expect, it } from "vitest";
import {
  findElementAtPoint,
  findElementAtPointFromCandidates,
  findElementByLocator,
  hasStableLocator,
  isRecordableElementCandidate,
  locatorFromCandidate,
  parseAndroidUiHierarchy,
  selectorFromLocator
} from "./ui-hierarchy-locator.js";

const hierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="com.demo:id/root" class="android.view.ViewGroup" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
      <node index="0" text="进入课堂" resource-id="com.demo:id/join_class" class="android.widget.Button" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[120,200][360,280]" />
      <node index="1" text="" resource-id="" class="android.widget.ImageButton" package="com.demo" content-desc="更多" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[900,180][1010,290]" />
    </node>
  </node>
</hierarchy>`;

describe("Android UI hierarchy locator", () => {
  it("parses uiautomator nodes and bounds", () => {
    const nodes = parseAndroidUiHierarchy(hierarchy);

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "com.demo:id/join_class",
          text: "进入课堂",
          clickable: true,
          bounds: expect.objectContaining({
            left: 120,
            top: 200,
            right: 360,
            bottom: 280,
            centerX: 240,
            centerY: 240
          })
        })
      ])
    );
  });

  it("finds the smallest stable clickable element at a recorded point", () => {
    const candidate = findElementAtPoint(hierarchy, { x: 220, y: 240 });

    expect(candidate).toEqual(
      expect.objectContaining({
        selector: "id=com.demo:id/join_class",
        resourceId: "com.demo:id/join_class",
        text: "进入课堂"
      })
    );
    const locator = locatorFromCandidate(candidate!);
    expect(locator).toEqual({
      strategy: "android_uiautomator",
      packageName: "com.demo",
      resourceId: "com.demo:id/join_class"
    });
    expect(hasStableLocator(locator)).toBe(true);
  });

  it("resolves the current element by the recorded locator", () => {
    const candidate = findElementByLocator(hierarchy, {
      strategy: "android_uiautomator",
      resourceId: "com.demo:id/join_class",
      packageName: "com.demo"
    });

    expect(candidate?.bounds.centerX).toBe(240);
    expect(candidate?.bounds.centerY).toBe(240);
  });

  it("resolves Compose text nodes to their clickable ancestor", () => {
    const composeHierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2218]">
    <node index="0" text="" resource-id="" class="android.view.View" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="true" bounds="[36,721][1044,2099]">
      <node index="0" text="" resource-id="" class="android.view.View" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[54,721][522,1264]">
        <node index="3" text="班级四十一号!" resource-id="" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[95,1014][481,1072]" />
      </node>
    </node>
  </node>
</hierarchy>`;

    const candidate = findElementByLocator(composeHierarchy, {
      strategy: "android_uiautomator",
      text: "班级",
      textMatchMode: "contains",
      excludeTexts: ["创建班级", "全部班级"],
      occurrence: 1,
      tapTarget: "clickable_ancestor",
      packageName: "cn.eeo.classin"
    });

    expect(candidate).toEqual(
      expect.objectContaining({
        clickable: true,
        bounds: expect.objectContaining({
          left: 54,
          top: 721,
          centerX: 288,
          centerY: 993
        })
      })
    );
  });

  it("matches text locators across spaced and full-width hyphens", () => {
    const classHierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2218]">
    <node index="0" text="" resource-id="cn.eeo.classin:id/card" class="android.view.ViewGroup" package="cn.eeo.classin" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[54,500][1044,680]">
      <node index="0" text="班级四十二号 － 22" resource-id="cn.eeo.classin:id/title" class="android.widget.TextView" package="cn.eeo.classin" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[120,530][520,585]" />
    </node>
  </node>
</hierarchy>`;

    const candidate = findElementByLocator(classHierarchy, {
      strategy: "android_uiautomator",
      text: "班级四十二号-22",
      textMatchMode: "contains",
      tapTarget: "clickable_ancestor",
      packageName: "cn.eeo.classin"
    });

    expect(candidate).toEqual(expect.objectContaining({
      resourceId: "cn.eeo.classin:id/card",
      clickable: true
    }));
  });

  it("adds occurrence to locators when identical content descriptions appear multiple times", () => {
    const repeatedHierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="" class="android.widget.ImageView" package="com.demo" content-desc="course Photo" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[100,500][400,800]" />
    <node index="1" text="" resource-id="" class="android.widget.ImageView" package="com.demo" content-desc="course Photo" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[500,500][800,800]" />
  </node>
</hierarchy>`;
    const candidates = parseAndroidUiHierarchy(repeatedHierarchy);
    const second = findElementAtPointFromCandidates(candidates, { x: 650, y: 650 });

    expect(locatorFromCandidate(second!, candidates)).toEqual({
      strategy: "android_uiautomator",
      packageName: "com.demo",
      contentDesc: "course Photo",
      occurrence: 2
    });
    expect(findElementByLocator(repeatedHierarchy, locatorFromCandidate(second!, candidates))?.bounds.centerX).toBe(650);
  });

  it("labels repeated locators with visual occurrence suffixes", () => {
    expect(
      selectorFromLocator({
        strategy: "android_uiautomator",
        packageName: "com.demo",
        contentDesc: "course Photo",
        occurrence: 2
      })
    ).toBe("desc=course Photo#2");
  });

  it("resolves repeated resource ids by visual occurrence", () => {
    const repeatedHierarchy = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo" content-desc="" clickable="false" enabled="true" focusable="false" long-clickable="false" scrollable="false" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="com.demo:id/class_card" class="android.view.View" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[100,500][400,800]" />
    <node index="1" text="" resource-id="com.demo:id/class_card" class="android.view.View" package="com.demo" content-desc="" clickable="true" enabled="true" focusable="true" long-clickable="false" scrollable="false" bounds="[500,500][800,800]" />
  </node>
</hierarchy>`;

    const candidate = findElementByLocator(repeatedHierarchy, {
      strategy: "android_uiautomator",
      packageName: "com.demo",
      resourceId: "com.demo:id/class_card",
      occurrence: 2
    });

    expect(candidate?.bounds.centerX).toBe(650);
  });

  it("filters oversized root containers from recording-time element candidates", () => {
    const nodes = parseAndroidUiHierarchy(hierarchy);
    const recordable = nodes.filter((candidate) => isRecordableElementCandidate(candidate, { width: 1080, height: 2400 }));

    expect(recordable.some((candidate) => candidate.resourceId === "com.demo:id/root")).toBe(false);
    expect(findElementAtPointFromCandidates(recordable, { x: 40, y: 40 })).toBeUndefined();
    expect(findElementAtPointFromCandidates(recordable, { x: 220, y: 240 })?.resourceId).toBe("com.demo:id/join_class");
  });
});
