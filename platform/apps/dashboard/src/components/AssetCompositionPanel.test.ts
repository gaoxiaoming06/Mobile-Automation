import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AssetCompositionPanel,
  parameterProfileValuesFromText,
  parameterProfileValuesToText,
  type AssetCompositionInitialData
} from "./AssetCompositionPanel.js";

describe("AssetCompositionPanel", () => {
  it("renders parameter profiles, meta functions, and composite cases from asset references", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetCompositionPanel, {
      selectedSerial: "device-1",
      selectedDeviceBusy: false,
      defaultAppId: "cn.eeo.classin",
      setMessage: () => undefined,
      initialData: initialData()
    }));

    expect(markup).toContain("资产用例");
    expect(markup).toContain("执行组合");
    expect(markup).toContain("元功能");
    expect(markup).toContain("组合用例");
    expect(markup).toContain("在测试数据中维护");
    expect(markup).toContain("进入指定班级");
    expect(markup).toContain("指定班级创建课堂");
    expect(markup).not.toContain("从页面资产选择能力和任务");
    expect(markup).toContain("asset-composition-tabs");
  });

  it("round-trips typed parameter profile values", () => {
    const values = parameterProfileValuesFromText("className:string=班级四十二号\nduration:number=30\nrecordLive:boolean=true\nlessonName:template=自动化课堂-{{timestamp}}");

    expect(values).toEqual({
      className: { type: "string", value: "班级四十二号" },
      duration: { type: "number", value: 30 },
      recordLive: { type: "boolean", value: true },
      lessonName: { type: "template", value: "自动化课堂-{{timestamp}}" }
    });
    expect(parameterProfileValuesToText(values)).toContain("duration:number=30");
  });

  it("groups parameter profile fields by the page scenario instead of exposing a raw key=value editor", () => {
    const data = initialData();
    data.parameterManifest = {
      appId: "cn.eeo.classin",
      platform: "android",
      graphVersionId: "graph-version",
      groups: [{ key: "login", label: "登录", parameterKeys: ["phone", "password"] }],
      definitions: [
        { key: "phone", label: "手机号", type: "string", sensitive: false, scenarioKey: "login", scenarioLabel: "登录", usages: [] },
        { key: "password", label: "密码", type: "string", sensitive: true, scenarioKey: "login", scenarioLabel: "登录", usages: [] }
      ]
    };
    data.dataRecords = [{
      id: "record-login-a",
      appId: "cn.eeo.classin",
      platform: "android",
      domainKey: "login",
      name: "教师账号 A",
      values: { phone: { type: "string", value: "18743085313" }, password: { type: "string", value: "eeo123", sensitive: true } },
      status: "active",
      version: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    }];

    const markup = renderToStaticMarkup(React.createElement(AssetCompositionPanel, {
      selectedSerial: "device-1",
      selectedDeviceBusy: false,
      defaultAppId: "cn.eeo.classin",
      setMessage: () => undefined,
      initialData: data,
      mode: "parameters"
    }));

    expect(markup).toContain("登录");
    expect(markup).toContain("手机号");
    expect(markup).toContain("密码");
    expect(markup).not.toContain("className:string=班级四十二号");
  });

  it("keeps reusable data records separate from execution combinations", () => {
    const data = initialData();
    data.parameterManifest = {
      appId: "cn.eeo.classin",
      platform: "android",
      graphVersionId: "graph-version",
      groups: [{ key: "login_credentials", label: "登录账号", parameterKeys: ["phone", "password"] }],
      definitions: [
        { key: "phone", label: "手机号", type: "string", sensitive: false, scenarioKey: "login_credentials", scenarioLabel: "登录账号", usages: [] },
        { key: "password", label: "密码", type: "string", sensitive: true, scenarioKey: "login_credentials", scenarioLabel: "登录账号", usages: [] }
      ]
    };
    data.dataRecords = [{
      id: "record-login-a",
      appId: "cn.eeo.classin",
      platform: "android",
      domainKey: "login_credentials",
      name: "教师账号 A",
      values: { phone: { type: "string", value: "18743085313" }, password: { type: "string", value: "eeo123" } },
      status: "active",
      version: 1,
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z"
    }];

    const markup = renderToStaticMarkup(React.createElement(AssetCompositionPanel, {
      selectedSerial: "device-1",
      selectedDeviceBusy: false,
      defaultAppId: "cn.eeo.classin",
      setMessage: () => undefined,
      initialData: data,
      mode: "parameters"
    }));

    expect(markup).toContain("测试数据");
    expect(markup).toContain("数据记录");
    expect(markup).toContain("执行组合");
    expect(markup).toContain("教师账号 A");
    expect(markup).toContain("登录账号");
    expect(markup).not.toContain("元功能");
  });

  it("guides a new data record through selecting a business domain before editing fields", () => {
    const data = initialData();
    data.parameterManifest = {
      appId: "cn.eeo.classin",
      platform: "android",
      graphVersionId: "graph-version",
      groups: [
        { key: "login", label: "登录账号", parameterKeys: ["phone", "password"] },
        { key: "classroom", label: "新建课堂", parameterKeys: ["lessonName"] }
      ],
      definitions: [
        { key: "phone", label: "手机号", type: "string", sensitive: false, scenarioKey: "login", scenarioLabel: "登录账号", usages: [] },
        { key: "password", label: "密码", type: "string", sensitive: true, scenarioKey: "login", scenarioLabel: "登录账号", usages: [] },
        { key: "lessonName", label: "课堂名称", type: "string", sensitive: false, scenarioKey: "classroom", scenarioLabel: "新建课堂", usages: [] }
      ]
    };

    const markup = renderToStaticMarkup(React.createElement(AssetCompositionPanel, {
      selectedSerial: "device-1",
      selectedDeviceBusy: false,
      defaultAppId: "cn.eeo.classin",
      setMessage: () => undefined,
      initialData: data,
      mode: "parameters"
    }));

    expect(markup).toContain("新建测试数据");
    expect(markup).toContain("先选择业务领域");
    expect(markup).toContain("登录账号");
    expect(markup).toContain("新建课堂");
  });

  it("presents meta function inputs as structured variables instead of a raw declaration field", () => {
    const markup = renderToStaticMarkup(React.createElement(AssetCompositionPanel, {
      selectedSerial: "device-1",
      selectedDeviceBusy: false,
      defaultAppId: "cn.eeo.classin",
      setMessage: () => undefined,
      initialData: initialData()
    }));

    expect(markup).toContain("输入变量");
    expect(markup).toContain("添加变量");
    expect(markup).not.toContain("参数声明");
  });
});

function initialData(): AssetCompositionInitialData {
  const timestamp = "2026-07-12T00:00:00.000Z";
  return {
    catalog: {
      graphVersionId: "graph-version",
      pages: [
        { id: "page-home", name: "主页", elements: [{ id: "class-grid", label: "班级列表" }], transitions: [{ id: "transition-home-detail", elementId: "class-grid", targetPageModelId: "page-detail", targetPageName: "班级详情" }], tasks: [] },
        { id: "page-detail", name: "班级详情", elements: [], transitions: [], tasks: [] }
      ]
    },
    dataRecords: [],
    profiles: [{ id: "profile-1", appId: "cn.eeo.classin", platform: "android", name: "教师账号 A", values: {}, status: "active", version: 1, createdAt: timestamp, updatedAt: timestamp }],
    metaFunctions: [{ id: "meta-1", appId: "cn.eeo.classin", platform: "android", name: "进入指定班级", parameters: [], steps: [], status: "active", version: 1, createdAt: timestamp, updatedAt: timestamp }],
    cases: [{ id: "case-1", appId: "cn.eeo.classin", platform: "android", name: "指定班级创建课堂", runMode: "once", repeatCount: 1, stopOnFailure: true, steps: [], status: "active", version: 1, createdAt: timestamp, updatedAt: timestamp }]
  };
}
