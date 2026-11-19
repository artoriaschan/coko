# 08: 评测用例：长期偏好被记住

**What to build:** 写入引导是否有效可以被衡量。新增一个 Eval Case：用户在对话中表达一条长期偏好（例如“以后都用 pnpm”），Run 结束后记忆里应出现对应的条目。现有判定只看文件、工具调用数与 Run 状态，本票为评测增加一种按外部事实判定的期望：Run 结束后经记忆接口读到的条目中，有一条正文匹配给定模式。faux 模式下用例通过；真实模式在没有 Provider 配置或凭据时记为 `skipped: no-credentials`，不阻塞交付。

**规格场景:** [spec](../spec.md) 的 AC-29；Testing Decisions 中的“评测”；Further Notes 中的“真实模型未验证”；用户故事 30。

**文档影响:** [追踪、审计、导出与评测](../../../docs/subsystems/tracing.md#评测) 的用例格式表增加新的期望字段；[测试约定](../../../docs/tech-stack/testing.md) 中列举评测判定依据处同步。

**Blocked by:** 03 Memory 段：声明、来源标注与写入引导；04 记忆操作不经审批

**Status:** ready-for-agent

- [ ] Eval Case 的期望支持“记忆中有一条正文匹配给定模式”，可限定作用域；判定只经记忆接口读取，不读库文件；不满足时给出一条原因。
- [ ] 期望字段的格式校验与判定由单元测试覆盖，包括匹配、不匹配与作用域不符。
- [ ] AC-29：新增用例在 faux 模式下通过；没有 `COKO_EVAL_PROVIDER_CONFIG` 或对应凭据时，报告中真实模式为 `skipped: no-credentials`。
- [ ] 用例在 default 模式下运行，不依赖任何允许规则。
- [ ] 具备凭据时运行真实模式并把结果单独报告；不具备时在 Comments 中明确记为未验证，不把 faux 通过表述为引导有效。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19：实施交付。
  - 期望：`case.json` 的 `expect.memory?: { content, scope? }`（`content` 为完整正文或 `"/正则/"`，与 `expect.files` 同规则）。运行器在 Run 结束后经 `GET /api/memories?workspaceId=…` 读取条目（用户级与该 Workspace），不读库文件；`judge.ts` 不满足时给一条原因（`memory: no entry matches …` / `memory: no user entry matches … (1 matching entry in workspace)`）。`loadCases` 用 typebox 校验 `expect.memory` 格式并检查正则可编译，格式错误时加载即失败。
  - 用例 `remembers-preference`：default 模式，提示“以后都用 pnpm”，faux 脚本调用 `memory_write`（scope `user`），期望用户级有一条匹配 `/pnpm/` 的条目、`package.json` 不变、工具调用不超过 3。不依赖允许规则与项目归属（只用 user 作用域）。
  - 检查：`pnpm exec vitest run --project evals judge.test.ts` 20 通过（新增匹配、完整正文、作用域匹配、不匹配、作用域不符与 6 个格式用例）；`pnpm run eval` 2 文件、31 通过、10 跳过（真实模式与门槛）；新用例 faux（v1 与 v2 候选）均通过；把期望临时改为 `/yarn/` 时该用例以 `memory: no user entry matches /yarn/` 失败，已恢复。报告 `real` 为 `{ skipped: 'no-credentials' }`，`promptGate` 为 `not-requested`。`pnpm run typecheck` 通过；`oxlint tests/evals` 无告警；`oxfmt` 已格式化改动文件。
  - 未验证：本机没有 `COKO_EVAL_PROVIDER_CONFIG` 与凭据，真实模式未运行。faux 通过只说明期望与判定链路可用，不说明写入引导对真实模型有效。
  - 文档影响：`docs/subsystems/tracing.md#评测` 用例格式表增加 `expect.memory?`，当前用例列表、判定依据与 faux 说明同步；`docs/tech-stack/testing.md` 评测判定依据增加“经记忆接口读到的条目”。

Closed: true
