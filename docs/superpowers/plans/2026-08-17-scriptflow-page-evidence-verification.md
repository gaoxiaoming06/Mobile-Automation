# ScriptFlow 页面断言证据化后续优化

> **状态：** Follow-up，暂不立即实现。后续实现时必须先补测试再改代码。

## 背景

资产库与执行器的直接依赖已经拆除后，`screenRef` 仍然保留在 ScriptFlow 中，用于表达页面语义、报告展示和脚本可读性。但当前 `waitForPage` / `assertPage` 仍主要只携带 `screenRef`，缺少可由执行器在实时页面上验证的证据。

这会导致一个语义落差：脚本看起来声明了“等待/确认某页面”，但运行时如果没有明确的页面文字、控件或状态证据，执行器无法真正证明当前页面就是该 `screenRef` 对应页面。

## 当前问题

1. `waitForPage` / `assertPage` 可以只包含 `screenRef`。
2. `ScriptFlowRunner` 目前会把 `waitForPage` / `assertPage` 编译成零时长 `wait`，没有附带真实 expectation。
3. `script-flow-verification` 仍会把 `outcome.screenRef`、`after.screenRef`、裸 `waitForPage` / `assertPage` 当成结果判据。
4. 用例中心 UI 中的“页面标识”容易让用户误以为已经存在运行时页面校验。
5. AI 后续仍可能生成裸 `assertPage: { screenRef: ... }`，使新脚本继续混入不可执行的页面断言。

## 风险

- 页面跳转失败时，脚本可能没有在页面断言处失败，而是继续执行后续步骤。
- 最后一步如果只有裸页面断言，报告可能呈现为成功，但业务结果没有被真实验证。
- 失败定位会后移，表现为后续控件找不到，而不是明确提示“目标页面未到达”。
- 旧脚本里保留的 `screenRef` 会被误读为可执行验证依据。

## 目标方向

保留 `screenRef`，但把它降级为逻辑页面名和报告元数据；真正的页面校验必须依赖脚本内显式证据。

建议把页面合同扩展为：

```yaml
waitForPage:
  screenRef: classin.teacher.classes
  evidence:
    - text: "班级"
      match: contains
    - target:
        icon: add
        area: topBar
        position: trailing
```

或：

```yaml
assertPage:
  screenRef: classin.teacher.lesson.create
  evidence:
    - text: "课堂时长"
    - text: "课堂信息"
```

## 后续改动范围

1. 扩展 `platform/packages/script-flow/src/types.ts` 中的 `ScriptScreenContract`，支持页面 evidence。
2. 更新 `platform/packages/script-flow/src/parser.ts` 和 `compiler.ts`，解析并编译 evidence。
3. 更新 `platform/apps/server/src/script-flow-runner.ts`，把页面 evidence 编译成真实 expectation。
4. 更新 `platform/apps/server/src/script-flow-verification.ts`，只有带 evidence 的页面断言才算结果判据。
5. 更新 `platform/apps/server/src/script-flow-ai-planner.ts`，禁止生成裸 `assertPage` / `waitForPage` 作为校验。
6. 更新用例中心 UI，让页面断言编辑“页面标识 + 可见证据”，而不是只编辑页面标识。
7. 迁移现有用例中心脚本：保留 `screenRef`，为关键页面断言补充可见文字或控件证据；无法确定证据的脚本需用户补充。

## 生成原则

- 不要求每个普通动作后都追加断言。
- 页面跳转、弹窗打开、登录、退出、保存、发布、开关状态修改等关键状态变化，应尽量有可观察结果。
- 后续步骤的目标定位可以作为上一动作的隐式校验，但最后一步必须尽量有显式结果校验。
- 裸 `screenRef` 不再视为可执行校验。

