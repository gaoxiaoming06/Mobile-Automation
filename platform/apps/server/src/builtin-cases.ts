import type { ActionStep, StepExpectation } from "@mobile-automation/shared";
import type { Storage } from "./storage.js";

export const classInTeacherCreateLessonCaseName = "ClassIn 教师新建课堂流程";

type BuiltinCaseDefinition = {
  name: string;
  description: string;
  targetApp?: {
    androidPackageName?: string;
  };
  tags?: string[];
  steps: ActionStep[];
};

export function seedBuiltinCases(storage: Storage): { created: number; skipped: number; updated: number } {
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const definition of builtinCases()) {
    const existing = storage.findCaseByName(definition.name);
    if (existing) {
      if (shouldUpdateBuiltinCase(existing.steps, definition.steps)) {
        storage.updateCase(existing.id, definition);
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }
    storage.createCase(definition);
    created += 1;
  }

  return { created, skipped, updated };
}

export function builtinCases(): BuiltinCaseDefinition[] {
  return [
    {
      name: classInTeacherCreateLessonCaseName,
      description: [
        "内置业务流程：从 ClassIn 首页切到“我是教师”，进入教师班级列表第一个班级，点击右下角发布活动入口，选择“课堂”，进入“新建课堂”页。",
        "用例自带启动准备：执行前会关闭并启动 cn.eeo.classin，再进入业务路径。"
      ].join("\n"),
      targetApp: {
        androidPackageName: "cn.eeo.classin"
      },
      tags: ["builtin", "classin", "smoke", "teacher"],
      steps: classInTeacherCreateLessonSteps()
    }
  ];
}

function classInTeacherCreateLessonSteps(): ActionStep[] {
  return [
    appActionStep({
      id: "builtin_classin_teacher_lesson_001_close_app",
      order: 1,
      type: "close_app",
      title: "结束 ClassIn 进程",
      packageName: "cn.eeo.classin",
      note: "归一化起点：无论当前在桌面还是 App 次级页面，都先关闭目标 App。"
    }),
    appActionStep({
      id: "builtin_classin_teacher_lesson_002_launch_app",
      order: 2,
      type: "launch_app",
      title: "启动 ClassIn",
      packageName: "cn.eeo.classin",
      note: "归一化起点：启动后应进入已登录首页；未登录会在这里或下一步暴露为先行条件失败。",
      expectations: [
        textExpectation("builtin_classin_expect_home_teacher_tab", "我是", "已进入 ClassIn 首页", { timeoutMs: 15000, intervalMs: 800 }),
        ...systemGuards("builtin_classin_teacher_lesson_002_launch_app")
      ],
      delayBeforeMs: 800,
      timeoutMs: 15000
    }),
    tapOnElementStep({
      id: "builtin_classin_teacher_lesson_003_teacher_tab",
      order: 3,
      title: "切到我是教师",
      locator: {
        strategy: "android_uiautomator",
        text: "我是教师",
        textMatchMode: "equals",
        tapTarget: "clickable_ancestor",
        packageName: "cn.eeo.classin"
      },
      preconditions: [textExpectation("builtin_classin_pre_home_teacher_tab", "我是", "首页身份切换入口可见")],
      expectations: [
        textExpectation("builtin_classin_expect_teacher_classes", "我是", "教师班级列表显示"),
        ...systemGuards("builtin_classin_teacher_lesson_003_teacher_tab")
      ]
    }),
    tapOnElementStep({
      id: "builtin_classin_teacher_lesson_004_first_class",
      order: 4,
      title: "进入第一个班级",
      locator: {
        strategy: "android_uiautomator",
        text: "班级",
        textMatchMode: "contains",
        excludeTexts: ["创建班级", "全部班级"],
        occurrence: 1,
        tapTarget: "clickable_ancestor",
        packageName: "cn.eeo.classin"
      },
      preconditions: [textExpectation("builtin_classin_pre_teacher_classes", "我是", "教师班级列表可见")],
      expectations: [
        textExpectation("builtin_classin_expect_class_detail", "课节", "进入班级详情并显示课节页"),
        ...systemGuards("builtin_classin_teacher_lesson_004_first_class")
      ]
    }),
    tapOnElementStep({
      id: "builtin_classin_teacher_lesson_005_publish_entry",
      order: 5,
      title: "打开发布活动入口",
      locator: {
        strategy: "android_uiautomator",
        resourceId: "cn.eeo.classin:id/btn_add"
      },
      preconditions: [textExpectation("builtin_classin_pre_class_activity_list", "课节", "班级详情课节页可见")],
      expectations: [
        textExpectation("builtin_classin_expect_publish_activity", "发布活动", "进入发布活动类型选择页"),
        ...systemGuards("builtin_classin_teacher_lesson_005_publish_entry")
      ]
    }),
    tapOnElementStep({
      id: "builtin_classin_teacher_lesson_006_classroom",
      order: 6,
      title: "选择课堂",
      locator: {
        strategy: "android_uiautomator",
        text: "课堂",
        textMatchMode: "equals",
        occurrence: 1,
        tapTarget: "clickable_ancestor",
        packageName: "cn.eeo.classin"
      },
      preconditions: [textExpectation("builtin_classin_pre_publish_activity", "发布活动", "看到发布活动页")],
      expectations: [
        textExpectation("builtin_classin_expect_create_lesson_after_tap", "新建课堂", "进入新建课堂页"),
        ...systemGuards("builtin_classin_teacher_lesson_006_classroom")
      ]
    }),
    waitStep({
      id: "builtin_classin_teacher_lesson_007_wait_create_lesson",
      order: 7,
      title: "等待新建课堂页",
      durationMs: 1200,
      expectations: [
        textExpectation("builtin_classin_expect_create_lesson", "新建课堂", "进入新建课堂页"),
        ...systemGuards("builtin_classin_teacher_lesson_007_wait_create_lesson")
      ]
    })
  ];
}

function shouldUpdateBuiltinCase(existing: ActionStep[] | undefined, next: ActionStep[]): boolean {
  return builtinCaseSignature(existing ?? []) !== builtinCaseSignature(next);
}

function builtinCaseSignature(steps: ActionStep[]): string {
  return steps
    .map((step) =>
      JSON.stringify({
        id: step.id,
        type: step.type,
        params: step.params,
        coordinate: step.coordinate ?? null,
        preconditions: (step.preconditions ?? []).map(expectationSignature),
        expectations: (step.expectations ?? []).map(expectationSignature)
      })
    )
    .join("|");
}

function expectationSignature(expectation: StepExpectation): Record<string, unknown> {
  return {
    id: expectation.id,
    type: expectation.type,
    enabled: expectation.enabled,
    params: expectation.params
  };
}

function appActionStep(input: {
  id: string;
  order: number;
  type: "launch_app" | "close_app";
  title: string;
  packageName: string;
  note?: string;
  delayBeforeMs?: number;
  timeoutMs?: number;
  expectations?: StepExpectation[];
}): ActionStep {
  return {
    id: input.id,
    order: input.order,
    type: input.type,
    enabled: true,
    title: input.title,
    note: input.note,
    params: {
      packageName: input.packageName
    },
    timing: {
      delayBeforeMs: input.delayBeforeMs ?? 300,
      timeoutMs: input.timeoutMs ?? 5000
    },
    expectations: input.expectations ?? [],
    createdAt: builtinCreatedAt()
  };
}

function tapOnTextStep(input: {
  id: string;
  order: number;
  title: string;
  text: string;
  textAlternatives?: string[];
  mode?: "contains" | "equals";
  preconditions?: StepExpectation[];
  expectations?: StepExpectation[];
}): ActionStep {
  return {
    id: input.id,
    order: input.order,
    type: "tap_on_text",
    enabled: true,
    title: input.title,
    params: {
      text: input.text,
      textAlternatives: input.textAlternatives ?? [],
      mode: input.mode ?? "contains",
      lang: "chi_sim+eng",
      timeoutMs: 6000,
      intervalMs: 600
    },
    timing: {
      delayBeforeMs: 300,
      timeoutMs: 6000
    },
    preconditions: input.preconditions ?? [],
    expectations: input.expectations ?? [],
    createdAt: builtinCreatedAt()
  };
}

function tapOnElementStep(input: {
  id: string;
  order: number;
  title: string;
  note?: string;
  locator: Record<string, unknown>;
  preconditions?: StepExpectation[];
  expectations?: StepExpectation[];
}): ActionStep {
  return {
    id: input.id,
    order: input.order,
    type: "tap_on_element",
    enabled: true,
    title: input.title,
    note: input.note,
    params: {
      locator: input.locator,
      timeoutMs: 6000,
      intervalMs: 600
    },
    timing: {
      delayBeforeMs: 500,
      timeoutMs: 5000
    },
    preconditions: input.preconditions ?? [],
    expectations: input.expectations ?? [],
    createdAt: builtinCreatedAt()
  };
}

function waitStep(input: { id: string; order: number; title: string; durationMs: number; expectations?: StepExpectation[] }): ActionStep {
  return {
    id: input.id,
    order: input.order,
    type: "wait",
    enabled: true,
    title: input.title,
    params: {
      durationMs: input.durationMs
    },
    timing: {
      delayBeforeMs: 300,
      timeoutMs: input.durationMs + 5000
    },
    expectations: input.expectations ?? [],
    createdAt: builtinCreatedAt()
  };
}

function systemGuards(stepId: string): StepExpectation[] {
  return [systemGuard(stepId, "no_crash"), systemGuard(stepId, "app_alive")];
}

function systemGuard(stepId: string, type: "no_crash" | "app_alive"): StepExpectation {
  return {
    id: `${stepId}_${type}`,
    type,
    enabled: true,
    title: type === "no_crash" ? "无崩溃/ANR" : "应用仍可响应",
    params: {
      autoGenerated: true,
      reliability: "P0",
      blocking: true,
      source: "builtin_case"
    },
    createdAt: builtinCreatedAt()
  };
}

function textExpectation(id: string, expected: string, title: string, options: { timeoutMs?: number; intervalMs?: number } = {}): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    title,
    params: {
      expected,
      mode: "contains",
      lang: "chi_sim+eng",
      timeoutMs: options.timeoutMs ?? 6000,
      intervalMs: options.intervalMs ?? 600,
      blocking: true,
      source: "builtin_case"
    },
    createdAt: builtinCreatedAt()
  };
}

function elementExpectation(id: string, resourceId: string, title: string, options: { timeoutMs?: number; intervalMs?: number } = {}): StepExpectation {
  return {
    id,
    type: "text",
    enabled: true,
    title,
    params: {
      resourceId,
      mode: "exists",
      timeoutMs: options.timeoutMs ?? 6000,
      intervalMs: options.intervalMs ?? 600,
      blocking: true,
      source: "builtin_case"
    },
    createdAt: builtinCreatedAt()
  };
}

function builtinCreatedAt(): string {
  return "2026-06-11T00:00:00.000Z";
}
