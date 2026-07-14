import { describe, expect, it } from "vitest";
import type { BusinessGraphVersion, BusinessNode } from "@mobile-automation/graph-core";
import { nowIso, type ParameterProfile } from "@mobile-automation/shared";
import {
  buildAssetParameterManifest,
  parameterProfileRuntimeParams,
  resolveParameterProfileRuntimeSnapshot
} from "./asset-parameter-center.js";

describe("asset parameter center", () => {
  it("groups extracted runtime parameters by business data domain instead of page nodes", () => {
    const manifest = buildAssetParameterManifest({
      appId: "cn.eeo.classin",
      platform: "android",
      graphVersion: graphVersion()
    });

    expect(manifest.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "login_credentials", label: "登录账号", parameterKeys: expect.arrayContaining(["phone", "password"]) }),
      expect.objectContaining({ key: "class_target", label: "班级目标", parameterKeys: ["className"] }),
      expect.objectContaining({
        key: "classroom_draft",
        label: "新建课堂",
        parameterKeys: expect.arrayContaining(["duration", "lessonName", "recordClassroom", "student", "course"])
      })
    ]));
    expect(manifest.groups).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "编辑课堂信息" })
    ]));
    expect(manifest.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "phone", label: "手机号", type: "string", sensitive: false, scenarioLabel: "登录账号" }),
      expect.objectContaining({ key: "password", label: "密码", type: "string", sensitive: true, scenarioLabel: "登录账号" }),
      expect.objectContaining({ key: "className", label: "班级名称", type: "string", scenarioLabel: "班级目标" }),
      expect.objectContaining({ key: "duration", label: "课堂时长", type: "number", scenarioLabel: "新建课堂" }),
      expect.objectContaining({ key: "recordClassroom", label: "录制ClassIn教室", type: "boolean", scenarioLabel: "新建课堂" })
    ]));
  });

  it("creates a runtime snapshot from one selected parameter profile without exposing secret metadata", () => {
    const profile: ParameterProfile = {
      id: "profile-teacher",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师测试账号",
      values: {
        phone: { type: "string", value: "18743085313" },
        password: { type: "string", value: "eeo123", sensitive: true },
        duration: { type: "number", value: 30 },
        recordClassroom: { type: "boolean", value: true }
      },
      status: "active",
      version: 3,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    expect(parameterProfileRuntimeParams(profile)).toEqual({
      runtimeParams: {
        phone: "18743085313",
        password: "eeo123",
        duration: "30",
        recordClassroom: "true"
      },
      profile: {
        id: "profile-teacher",
        name: "教师测试账号",
        version: 3
      }
    });

    expect(resolveParameterProfileRuntimeSnapshot({
      profile,
      appId: "cn.eeo.classin",
      platform: "android",
      overrides: { lessonName: "临时课堂" }
    })).toEqual({
      runtimeParams: {
        phone: "18743085313",
        password: "eeo123",
        duration: "30",
        recordClassroom: "true",
        lessonName: "临时课堂"
      },
      profile: {
        id: "profile-teacher",
        name: "教师测试账号",
        version: 3
      }
    });
  });

  it("composes one execution snapshot from selected business-domain records", () => {
    const profile = {
      id: "profile-teacher-classroom",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师 A + 课堂草稿 A",
      values: {
        lessonName: { type: "string", value: "执行时覆盖的课堂" }
      },
      bindings: [
        { domainKey: "login_credentials", recordId: "login-teacher-a" },
        { domainKey: "classroom_draft", recordId: "classroom-draft-a" }
      ],
      status: "active",
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    } as ParameterProfile;
    const records = [
      {
        id: "login-teacher-a",
        appId: "cn.eeo.classin",
        platform: "android",
        domainKey: "login_credentials",
        name: "教师账号 A",
        values: {
          phone: { type: "string", value: "18743085313" },
          password: { type: "string", value: "eeo123", sensitive: true }
        },
        status: "active",
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso()
      },
      {
        id: "classroom-draft-a",
        appId: "cn.eeo.classin",
        platform: "android",
        domainKey: "classroom_draft",
        name: "课堂草稿 A",
        values: {
          lessonName: { type: "string", value: "自动化组合课堂" },
          duration: { type: "number", value: 30 }
        },
        status: "active",
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso()
      }
    ];

    expect(resolveParameterProfileRuntimeSnapshot({
      profile,
      appId: "cn.eeo.classin",
      platform: "android",
      records
    } as never)).toEqual({
      runtimeParams: {
        phone: "18743085313",
        password: "eeo123",
        lessonName: "执行时覆盖的课堂",
        duration: "30"
      },
      profile: {
        id: "profile-teacher-classroom",
        name: "教师 A + 课堂草稿 A",
        version: 1
      }
    });
  });

  it("rejects profiles that are deprecated or belong to another app/platform", () => {
    const profile: ParameterProfile = {
      id: "profile-teacher",
      appId: "cn.eeo.classin",
      platform: "android",
      name: "教师测试账号",
      values: {},
      status: "active",
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    expect(() => resolveParameterProfileRuntimeSnapshot({
      profile,
      appId: "com.example.other",
      platform: "android"
    })).toThrow("不属于当前应用");
    expect(() => resolveParameterProfileRuntimeSnapshot({
      profile: { ...profile, status: "deprecated" },
      appId: "cn.eeo.classin",
      platform: "android"
    })).toThrow("已废弃");
  });
});

function graphVersion(): BusinessGraphVersion {
  return {
    id: "graph-version",
    graphId: "graph",
    version: 1,
    status: "active",
    sourceSummary: [],
    createdAt: nowIso(),
    nodes: [
      pageNode("page-login", "登录", {
        assetRecordingPageTasks: [{
          id: "task-login",
          name: "账号密码登录",
          status: "active",
          steps: [
            { id: "phone", label: "手机号输入框", fieldType: "text_input", valueParamKey: "phone" },
            { id: "password", label: "密码输入框", fieldType: "text_input", valueParamKey: "password" }
          ]
        }]
      }),
      pageNode("page-home", "主页", {
        assetRecordingPageElements: [{
          id: "class-grid",
          label: "班级列表",
          elementKind: "collection",
          locator: "collection:class-grid",
          locatorKind: "collection_item_locator",
          collection: { kind: "vertical_grid", itemIdentity: { param: "className" } }
        }],
        assetRecordingPageTransitions: [{
          id: "home-open-class",
          elementId: "class-grid",
          action: "tap",
          outcomeType: "navigate",
          targetNodeId: "page-detail",
          params: { itemText: "{{className}}" }
        }]
      }),
      pageNode("page-detail", "班级详情", {}),
      pageNode("page-create", "新建课堂", {
        assetRecordingPageTasks: [{
          id: "task-create",
          name: "填写新建课堂表单",
          status: "active",
          steps: [
            { id: "lesson-name", label: "课堂名称", fieldType: "text_input", valueParamKey: "lessonName" },
            { id: "duration", label: "课堂时长", fieldType: "number_input", valueParamKey: "duration" },
            { id: "record", label: "录制ClassIn教室", fieldType: "toggle_set", desiredStateParamKey: "recordClassroom" }
          ]
        }]
      }),
      pageNode("page-edit-classroom", "编辑课堂信息", {
        assetRecordingPageTasks: [{
          id: "task-edit-classroom",
          name: "填写课堂信息",
          status: "active",
          steps: [
            { id: "student", label: "学生", fieldType: "text_input", valueParamKey: "student" },
            { id: "course", label: "课程", fieldType: "text_input", valueParamKey: "course" }
          ]
        }]
      })
    ],
    edges: []
  };
}

function pageNode(id: string, name: string, metadata: Record<string, unknown>): BusinessNode {
  return {
    id,
    graphVersionId: "graph-version",
    key: id,
    name,
    nodeType: "page",
    tags: ["page-asset"],
    status: "active",
    matchers: [],
    defaultExpectations: [],
    platformScope: "android",
    metadata: { assetRecordingConfirmed: true, ...metadata }
  };
}
