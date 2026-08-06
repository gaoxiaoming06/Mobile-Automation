# 通用表单字段语义定位

> 本会话最终结论：登录字段不扩展新 schema，直接复用现有 `control: textField + scopeText + ordinal`。

## 已确认方向

- 登录账号/密码字段走通用脚本语义，不再写 `target.text` 占位符。
- 运行时只保留通用 `scoped_text_field` 解析，不再有手机号、密码、厂商登录文案的特判。
- 输入后不再隐式执行 `hide_keyboard`。
- Harmony 不再把 `hide_keyboard` 映射成 `Back`。
- Planner 提示词明确要求登录/表单输入使用 `control: textField`。

## 已完成

- ScriptFlow `textField` 仍保持现有 `scopeText + ordinal` 合同。
- `semantic-locator` 删除了登录/账号/密码专用候选和验证分支。
- `scoped_text_field` 改为按行选择候选，更适合登录表单这类同列前缀场景。
- 相关测试、`pnpm -r typecheck` 和 server 健康检查都已通过。
