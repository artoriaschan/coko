# 01: Run 开始时以 State Update 送达 Todo List

**What to build:** 搭起 State Update 的完整链路，先只接 Todo List。模型写过 Todo 之后，下一个 Run 开头的系统消息不再包含 `<todo_list>`，与上一个 Run 逐字相同；当前的待办表以 `<state_update name="todo_list">` 块放在该 Run 第一条 user message 的最前面，并存为 `state_update` 条目；时间线不显示它。值不变不再发送，待办全部完成时发送一次清空。见 [规格](../spec.md) 的“State Update 的内容”“是否送达”“何时送达”“条目”“渲染”“来源”“时间线”，以及 [设计](../design.md) 的“配对”与“Run 开始”。

**User stories:** 1、4、6、10（待办部分）、11、19、20、25、27、29（待办部分）、32

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 条目：新增 `state_update` payload v1 `{ name, value }`，agent 与 protocol 的 schema 编译期比对一致；renderer 收到新 kind 不报错
- [x] 配对（条目派生测试，表驱动）：一一配对；条目已提交、消息未提交时不配对；压缩切点去掉条目、保留消息时不配对；名称不符不配对；command 等条目插在中间时仍配对
- [x] 规划（纯函数测试）：首次送达；值不变不送；有值变为“无”时送一次清空；从未送达且为“无”时不送；比较的是替换已登记明文之后的值
- [x] Sidecar 集成测试（faux）：模型在 Run 1 写 Todo；Run 2 首次请求的 sections 与 Run 1 逐字相同、不含 todo；Run 2 第一条 user message 以 `<state_update name="todo_list">` 开头，前面是对应的 `state_update` 条目；Run 3 待办不变时不送；全部完成后的下一个 Run 送一次清空
- [x] 回退到最后一次 todo_write 之前后，下一个 Run 按当前状态重新送达
- [x] retry 与 trigger compact 的 Run 不送达；trigger goal、schedule、subagent 的 Run 中块排在宿主通知与输入之前
- [x] 待办中的已登记 Secret 在 user message、条目、推送与日志中都是标记
- [x] 用户输入中的 `<state_update …>` 文本不产生条目、不影响判定，时间线照常显示
- [x] 时间线：`state_update` 条目不成行；配对的块不进入用户气泡（时间线派生测试）
- [x] `HOST_INPUT_KINDS`：Goal 授权把前一条为 `state_update` 的 user message 视为宿主输入（表驱动）；Sidecar 的输入标记让脱离 Run 的提交等到 `state_update` 的 user message 提交之后
- [x] 读取领域状态或条目出错时记 warn、本次不送达、Run 照常进行
- [x] 确认会话诊断的类型筛选是否需要加入新 kind；确认旧版本应用读取含 `state_update` 的库的行为，结论写入兼容说明
- [x] 文档：Todo List 的注入节、上下文管理、protocol README 中 stream-json 的新 kind；`check:docs` 通过


Closed: true

## Comments

2026-11-05：已实现本票，基于 ec32dfc9。State Update 条目与协议镜像、浏览器安全配对/规划、RuntimeContext.stateUpdates、上下文 stateValues 贡献、Todo 的系统段移除、时间线隐藏、Goal 宿主授权与 Sidecar 输入标记已接通。配对跨 command，按同一 Run 的首条 user message 与开头块名称/顺序核对；规划只看回退/压缩后的有效配对。登记明文先替换再比较和渲染，读取失败记 warn、跳过本次更新。

TDD：新增配对/规划的 9 例先因缺少导出失败，再实现后通过。最终相关验证：`pnpm run test packages/agent/src/entries/state-updates.test.ts packages/agent/src/entries/entries.test.ts packages/agent/src/session-entries/session-entries.test.ts packages/agent/src/goals/goals.test.ts packages/agent/src/tasks/todo/todo.test.ts apps/server/src/application/context/state-updates.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts tests/integration/sidecar-todo.test.ts tests/integration/secrets-gate-todo.test.ts packages/protocol/src/readme.test.ts`：10 文件 282 例通过；公开运行时入口额外 `pnpm run test packages/agent/src/engine/state-updates.test.ts`：4 例覆盖 submit/goal/schedule/subagent 的 State Update → 通知 → 输入与条目顺序。真实 Sidecar 集成覆盖去重、清空、系统段稳定、手动压缩不送新状态、回退补发、retry 请求完全相同、用户伪造同名块和秘密总闸。原有两处条目顺序期待已落后于 model_request 先于 assistant 提交的现有行为，已据当前公开记录修正。

`pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run check:docs` 均退出 0；docs 检查 360 个 Markdown、0 问题。相关新 TS 文件 oxlint 通过。文档同步 Todo、context、Goal 顺序、agent/protocol README 与 docs 总入口；从 AGENTS → 导航 → 所属正文读回，引用方向、生命周期与归属保持不变。旧应用读取未登记 kind 会跳过并报告 invalid entry，不隔离库；消息仍保留，降级时间线可能显示包装块。诊断类型候选动态来自原始条目，不需枚举新 kind。

限制：真实 Provider、可见 Electron、构建产物与 CI 未运行；本票没有单独的 detached-commit 并发 barrier 用例，输入标记机制扩展使用同一 HOST_INPUT_KINDS；Goal waiting-input 与 continue 的状态消息场景由 02 的真实 Sidecar 验收覆盖；同 Run 压缩补发由 03 负责。触发 goal/schedule/subagent 的顺序由公开 runtime 入口验证，Sidecar 本票只以 submit 实际驱动，后续相应领域票继续验证子 Session 与 Goal。规格已确认的测试接缝沿用，不另要求用户批准。

合入 06 环境信息后保留 environment 第一段、ContextScope model/additionalFolders 与草稿模型默认值，移除 todo 旧段。新增公开 Runtime 用例的临时目录属性曾误写为 cwd，typecheck 捕获后改为 dir；下述合并后验证为最终依据。

合并后最终检查：上述 10 文件加 `packages/agent/src/engine/state-updates.test.ts` 与 `tests/integration/sidecar-environment.test.ts`，12 文件 288 例通过；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 为 360 文件 0 问题；`git diff --check` 退出 0。未运行真实模型、Electron UI、产物与 CI。
