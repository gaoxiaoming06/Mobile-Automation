import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanAndroidSource } from "./index.js";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("AndroidSourceScanner", () => {
  it("scans manifest, navigation, layout, strings, and Kotlin navigation hints into draft graph candidates", async () => {
    const repo = await createAndroidFixture();

    const result = await scanAndroidSource({
      appId: "classin-android",
      repoPath: repo,
      platform: "android"
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        manifestFiles: 1,
        navigationFiles: 1,
        layoutFiles: 1,
        stringFiles: 1,
        sourceFiles: 1
      })
    );
    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "activity:com.demo.MainActivity",
          nodeType: "root",
          status: "draft",
          matchers: expect.arrayContaining([
            expect.objectContaining({ type: "package", value: "com.demo" }),
            expect.objectContaining({ type: "activity", value: "com.demo.MainActivity" })
          ])
        }),
        expect.objectContaining({
          key: "fragment:com.demo.HomeFragment",
          matchers: expect.arrayContaining([
            expect.objectContaining({ type: "fragment", value: "com.demo.HomeFragment" }),
            expect.objectContaining({ type: "text", value: "首页" })
          ])
        }),
        expect.objectContaining({
          key: "layout:fragment_home",
          matchers: expect.arrayContaining([
            expect.objectContaining({ type: "resource_id", value: "joinClass" }),
            expect.objectContaining({ type: "text", value: "进入课堂" })
          ])
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "nav:fragment:com.demo.HomeFragment->detailsFragment:openDetails",
          fromNodeKey: "fragment:com.demo.HomeFragment",
          toNodeKey: "navigation:detailsFragment",
          status: "draft"
        }),
        expect.objectContaining({
          key: expect.stringContaining("source_nav_controller"),
          toNodeKey: "route:homework/create"
        }),
        expect.objectContaining({
          key: "layout-click:fragment_home:joinClass",
          actionPolicies: expect.arrayContaining([
            expect.objectContaining({
              action: expect.objectContaining({
                type: "tap_on_element",
                params: {
                  locator: {
                    strategy: "android_uiautomator",
                    resourceId: "joinClass"
                  }
                }
              })
            })
          ])
        })
      ])
    );
    expect(result.nodes.every((node) => node.source.sourceType === "source_scan" && node.source.filePath)).toBe(true);
    expect(result.edges.every((edge) => edge.source.sourceType === "source_scan" && edge.source.filePath)).toBe(true);
  });

  it("returns a warning for unsupported platforms without scanning", async () => {
    const result = await scanAndroidSource({
      appId: "ios-app",
      repoPath: "/missing",
      platform: "ios"
    });

    expect(result.nodes).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_PLATFORM"
      })
    ]);
  });
});

async function createAndroidFixture(): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "source-scanner-"));
  await writeFixture("app/src/main/AndroidManifest.xml", manifest());
  await writeFixture("app/src/main/res/values/strings.xml", strings());
  await writeFixture("app/src/main/res/navigation/main_nav.xml", navigation());
  await writeFixture("app/src/main/res/layout/fragment_home.xml", layout());
  await writeFixture("app/src/main/java/com/demo/HomeFragment.kt", kotlinSource());
  return tempRoot;
}

async function writeFixture(relativePath: string, content: string): Promise<void> {
  if (!tempRoot) {
    throw new Error("tempRoot is missing");
  }
  const absolutePath = path.join(tempRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

function manifest(): string {
  return `
<manifest package="com.demo">
  <application android:label="@string/app_name">
    <activity android:name=".MainActivity" android:label="@string/home_title">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
      <intent-filter>
        <data android:scheme="demo" android:host="home" android:path="/open" />
      </intent-filter>
    </activity>
  </application>
</manifest>`;
}

function strings(): string {
  return `
<resources>
  <string name="app_name">Demo</string>
  <string name="home_title">首页</string>
  <string name="join_class">进入课堂</string>
</resources>`;
}

function navigation(): string {
  return `
<navigation>
  <fragment
    android:id="@+id/homeFragment"
    android:name="com.demo.HomeFragment"
    android:label="@string/home_title">
    <action
      android:id="@+id/openDetails"
      app:destination="@id/detailsFragment" />
  </fragment>
  <fragment android:id="@+id/detailsFragment" android:name="com.demo.DetailsFragment" android:label="详情" />
</navigation>`;
}

function layout(): string {
  return `
<LinearLayout>
  <Button
    android:id="@+id/joinClass"
    android:text="@string/join_class"
    android:contentDescription="@string/join_class"
    android:clickable="true" />
</LinearLayout>`;
}

function kotlinSource(): string {
  return `
package com.demo

class HomeFragment {
  fun bind() {
    button.setOnClickListener {
      navController.navigate("homework/create")
    }
  }
}`;
}
