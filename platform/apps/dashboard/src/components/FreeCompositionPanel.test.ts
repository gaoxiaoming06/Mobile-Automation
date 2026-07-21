import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  FreeCompositionPanel,
  freeCompositionReplyProfileId,
  freeCompositionReplyRuntimeOverrides
} from "./FreeCompositionPanel.js";

describe("FreeCompositionPanel", () => {
  it("renders the natural-language plan flow with candidate, profile, and execution controls", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [
            {
              id: "free_composition_1",
              appId: "cn.eeo.classin",
              platform: "android",
              prompt: "测试登录，循环 3 次",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
              status: "awaiting_selection",
              resolution: {
                status: "ready",
                message: "已找到可复用流程。",
                intent: {
                  prompt: "测试登录，循环 3 次",
                  runMode: "repeat_n",
                  repeatCount: 3,
                  riskTerms: []
                },
                candidates: [
                  {
                    id: "case_login",
                    kind: "composite_case",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "登录巡检",
                    parameterKeys: ["phone"],
                    score: 100,
                    matchedTerms: ["登录"]
                  }
                ]
              }
            }
          ],
          profiles: [
            {
              id: "profile_teacher",
              appId: "cn.eeo.classin",
              platform: "android",
              name: "教师账号",
              values: {},
              status: "active",
              version: 1,
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z"
            }
          ]
        }
      })
    );

    expect(markup).toContain("AI资产用例");
    expect(markup).toContain("刷新AI资产用例");
    expect(markup).not.toContain("自由组合");
    expect(markup).toContain("测试登录，循环 3 次");
    expect(markup).toContain("登录巡检");
    expect(markup).toContain("教师账号");
    expect(markup).toContain("生成计划");
  });

  it("renders free composition as a two-pane workbench with a compact result stack", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [
            {
              id: "free_composition_layout",
              appId: "cn.eeo.classin",
              platform: "android",
              prompt: "从主页跳转到成长 循环5次",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
              status: "passed",
              resolution: {
                status: "ready",
                message: "已找到可执行候选。请选择候选并确认参数后生成执行计划。",
                intent: {
                  prompt: "从主页跳转到成长 循环5次",
                  runMode: "repeat_n",
                  repeatCount: 5,
                  riskTerms: []
                },
                candidates: [
                  {
                    id: "transition-home-growth",
                    kind: "page_transition",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "主页 / 打开成长 → 成长",
                    parameterKeys: [],
                    score: 120,
                    matchedTerms: ["主页", "成长"]
                  }
                ]
              },
              selectedCandidateId: "transition-home-growth",
              plan: {
                status: "ready",
                runtimeParams: {},
                requiredParameters: [],
                steps: [
                  { id: "step-reach", metaFunctionName: "主页 / 打开成长 → 成长", kind: "reach_page", targetPageModelId: "page-growth" },
                  { id: "step-invoke", metaFunctionName: "主页 / 打开成长 → 成长", kind: "invoke_capability", targetPageModelId: "page-growth" }
                ],
                issues: []
              },
              execution: {
                id: "execution-layout",
                status: "passed",
                totalItems: 10,
                completedItems: 10,
                failedItems: 0,
                items: [
                  { id: "item-reach", metaFunctionName: "主页 / 打开成长 → 成长", kind: "reach_page", status: "passed" },
                  { id: "item-invoke", metaFunctionName: "主页 / 打开成长 → 成长", kind: "invoke_capability", status: "passed" }
                ]
              }
            }
          ],
          profiles: []
        }
      })
    );

    expect(markup).toContain("free-composition-workbench");
    expect(markup).toContain("free-composition-conversation-panel");
    expect(markup).toContain("free-composition-execution-panel");
    expect(markup).toContain("free-composition-result-stack");
    expect(markup).toContain("free-composition-session-feed");
  });

  it("uses AI asset case naming in the empty session state", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [],
          profiles: []
        }
      })
    );

    expect(markup).toContain("AI资产用例");
    expect(markup).toContain("暂无AI资产用例会话");
    expect(markup).not.toContain("暂无自由组合会话");
  });

  it("renders parameter confirmation as a conversation instead of a parameter-source form", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [
            {
              id: "free_composition_2",
              appId: "cn.eeo.classin",
              platform: "android",
              prompt: "切换登录账号为12133333302",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
              status: "awaiting_selection",
              resolution: {
                status: "ready",
                message: "已找到可执行候选。",
                intent: {
                  prompt: "切换登录账号为12133333302",
                  runMode: "once",
                  repeatCount: 1,
                  riskTerms: [],
                  runtimeOverrides: { phone: "12133333302" }
                },
                candidates: [
                  {
                    id: "page_task:page-login:login-task-account-password",
                    kind: "page_task",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "登录 / 账号密码登录",
                    parameterKeys: ["phone", "password"],
                    score: 100,
                    matchedTerms: ["登录"]
                  }
                ]
              }
            }
          ],
          profiles: [
            {
              id: "profile_teacher",
              appId: "cn.eeo.classin",
              platform: "android",
              name: "教师组合测试参数",
              values: {},
              status: "active",
              version: 1,
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z"
            }
          ]
        }
      })
    );

    expect(markup).toContain("我已识别 phone=12133333302");
    expect(markup).toContain("还需要 password");
    expect(markup).toContain("直接回复 password 的值");
    expect(markup).toContain("phone");
    expect(markup).toContain("12133333302");
    expect(markup).toContain("password");
    expect(markup).not.toContain("参数来源");
    expect(markup).not.toContain("已有参数集");
    expect(markup).not.toContain("新输入");
  });

  it("renders missing parameters as a follow-up question instead of a blocked plan", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [
            {
              id: "free_composition_3",
              appId: "cn.eeo.classin",
              platform: "android",
              prompt: "切换登录账号为12133333302",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
              status: "awaiting_parameters",
              resolution: {
                status: "ready",
                message: "已找到可执行候选。",
                intent: {
                  prompt: "切换登录账号为12133333302",
                  runMode: "once",
                  repeatCount: 1,
                  riskTerms: [],
                  runtimeOverrides: { phone: "12133333302" }
                },
                candidates: [
                  {
                    id: "page_task:page-login:login-task-account-password",
                    kind: "page_task",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "登录 / 账号密码登录",
                    parameterKeys: ["phone", "password"],
                    score: 100,
                    matchedTerms: ["登录"]
                  }
                ]
              },
              plan: {
                status: "needs_parameters",
                runtimeParams: { phone: "12133333302" },
                requiredParameters: ["password", "phone"],
                steps: [],
                issues: [
                  {
                    code: "MISSING_REQUIRED_PARAMETER",
                    message: "页面任务 账号密码登录 缺少必需参数 password。",
                    assetId: "password"
                  }
                ]
              }
            }
          ],
          profiles: []
        }
      })
    );

    expect(markup).toContain("等待补参数");
    expect(markup).toContain("还需要 password");
    expect(markup).toContain("直接回复 password 的值");
    expect(markup).toContain("password");
    expect(markup).not.toContain("预检未通过");
  });

  it("maps a short reply to the single missing runtime parameter", () => {
    expect(freeCompositionReplyRuntimeOverrides("eeo123", ["password"])).toEqual({
      password: "eeo123"
    });
  });

  it("extracts explicit key-value pairs from a parameter reply", () => {
    expect(freeCompositionReplyRuntimeOverrides("phone=12133333302 password=eeo123", ["phone", "password"])).toEqual({
      phone: "12133333302",
      password: "eeo123"
    });
  });

  it("matches a parameter-profile reply by profile name", () => {
    expect(freeCompositionReplyProfileId("使用参数集：教师账号", [
      {
        id: "profile_teacher",
        appId: "cn.eeo.classin",
        platform: "android",
        name: "教师账号",
        values: {},
        status: "active",
        version: 1,
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z"
      }
    ])).toBe("profile_teacher");
  });

  it("labels an auto-generated multi-step flow as the execution flow", () => {
    const markup = renderToStaticMarkup(
      React.createElement(FreeCompositionPanel, {
        selectedSerial: "device-1",
        selectedDeviceBusy: false,
        defaultAppId: "cn.eeo.classin",
        setMessage: vi.fn(),
        initialData: {
          sessions: [
            {
              id: "free_composition_4",
              appId: "cn.eeo.classin",
              platform: "android",
              prompt: "先登录账号18743085313 然后从主页跳转到班级四十二号的班级详情",
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
              status: "awaiting_confirmation",
              resolution: {
                status: "ready",
                message: "已按需求生成临时执行流程。",
                intent: {
                  prompt: "先登录账号18743085313 然后从主页跳转到班级四十二号的班级详情",
                  runMode: "once",
                  repeatCount: 1,
                  riskTerms: [],
                  runtimeOverrides: { phone: "18743085313", className: "班级四十二号" }
                },
                candidates: [
                  {
                    id: "generated_flow:page_task:page-login:login-task-account-password>meta-enter-class",
                    kind: "generated_flow",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "登录 / 账号密码登录 → 进入指定班级",
                    parameterKeys: ["className", "password", "phone"],
                    score: 200,
                    matchedTerms: ["登录", "班级"],
                    composedCandidateIds: ["page_task:page-login:login-task-account-password", "meta-enter-class"]
                  },
                  {
                    id: "page_task:page-login:login-task-account-password",
                    kind: "page_task",
                    appId: "cn.eeo.classin",
                    platform: "android",
                    name: "登录 / 账号密码登录",
                    parameterKeys: ["password", "phone"],
                    score: 100,
                    matchedTerms: ["登录"]
                  }
                ]
              },
              selectedCandidateId: "generated_flow:page_task:page-login:login-task-account-password>meta-enter-class",
              plan: {
                status: "ready",
                runtimeParams: { phone: "18743085313", password: "secret", className: "班级四十二号" },
                requiredParameters: ["className", "password", "phone"],
                steps: [
                  { id: "step-login", metaFunctionName: "登录 / 账号密码登录", kind: "run_page_task", targetPageModelId: "page-login", pageTaskId: "login-task-account-password" },
                  { id: "step-enter", metaFunctionName: "进入指定班级", kind: "verify_page", targetPageModelId: "page-class-detail" }
                ],
                issues: []
              }
            }
          ],
          profiles: []
        }
      })
    );

    expect(markup).toContain("执行流程");
    expect(markup).toContain("生成流程 · 登录 / 账号密码登录 → 进入指定班级");
    expect(markup).not.toContain("候选流程");
  });
});
