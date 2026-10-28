# 03: Agent 运行时与内置工具

**What to build:** packages/agent 封装 pi Agent：models（pi-ai 三协议、CredentialStore 端口、可重试错误）、tools（注册表、显式覆盖、内置 read/write/edit/bash/grep/find/ls、截断、超时与取消）、engine（run / abort / subscribe，message_end 可等待提交，工具结果按调用顺序，progress 与 entry 区分）、最小 Hook 调度点、ports（执行接口）。参考 [pi 研究](../../desktop-app/research/pi-agent-core-and-coding-agent.md)。

**Blocked by:** 01

**Status:** ready-for-agent

- [x] faux provider + 临时 Workspace：模型调用 write 后文件内容正确，read / edit / ls / find / grep / bash 结果与 schema 一致
- [x] 并行工具调用的持久化顺序等于模型调用顺序
- [x] abort 后 Run 以取消结束，bash 子进程已退出
- [x] 未声明覆盖的重名注册报错；声明覆盖后生效实现被替换且契约不变
- [x] 内置 grep 契约测试可被宿主实现复用（导出契约测试套件）
- [x] pi-ai 流错误转为 Run 错误条目，可重试错误按策略重试

## Comments

### 2026-10-28 实施（分支 m1/03-agent-engine-tools）

覆盖的验收（测试位于 packages/agent/src）：

- write 及六个工具的结果与 schema：`engine/runtime.test.ts` 的“内置工具闭环”用 faux 模型 + 临时 Workspace 依次调用 write、read/ls/find/grep/bash（并行一批）、edit；断言文件内容、旁路文件逐字节不变、每个 toolResult 文本，read / bash 的 structuredContent 通过 `Value.Check` 对照 outputSchema。各工具细节另见 `tools/builtin/*.test.ts`。
- 并行顺序：两个宿主工具，先调用的后完成；toolResult 条目按调用顺序，progress 的 tool_end 按完成顺序。另测 message_end 提交完成后工具才开始（commit 改成不 await 时该测试失败，已验证）。
- abort：bash 启动后台 sleep，abort 后 Run 为 `aborted`，run_end 已提交，shell 与子进程均已退出（把进程组 kill 改成只 kill 单进程时该测试失败，已验证）。另测流式中 abort 与运行中再次 run。
- 重名注册与覆盖：`tools/registry.test.ts`；运行时内声明覆盖的宿主 grep 生效见 runtime.test.ts。
- grep 契约套件：`@coko/agent/testing` 导出 `describeGrepContract({ name, createTool })`（16 项）；内置 grep 在 `tools/builtin/grep.test.ts` 运行它。ticket 09 用 `createGrepTool({ cwd, searcher })` 提供 ripgrep searcher 并以 `override: true` 注册，即可复用同一格式化与契约。
- 流错误与重试：503 先失败后成功（失败尝试不进入条目、发 retry progress）、重试耗尽、不可重试错误、已输出内容后出错不重试；结果为 run_end `{ status: 'error', error: { code: 'model_error' } }`。三协议与 CredentialStore 在 `models/models.test.ts` 经 loopback 假服务器验证端点路径与密钥头。

实现说明与供下游票使用的接口：

- `createAgentRuntime({ models, model, cwd, commit, tools?, exec?, messages?, hooks?, retry?, timeouts? })` → `run(text)` / `abort()` / `subscribe()` / `setModel()`。`commit(entry)` 被 await，作为持久化屏障；`subscribe` 的 `entry` 在提交后发出，`progress`（assistant_delta、tool_start/update/end、retry、run_start）不持久化。恢复 Session 时把 message 条目的 message 传回 `messages`。
- `createModelRegistry({ credentials, providers })`：kind 为 deepseek / openai / anthropic / openai-compatible，分别映射 Chat Completions / Responses / Anthropic Messages / Chat Completions；只从注入的 CredentialStore 取密钥，不读环境变量；不发送 pi 归属头。
- grep 契约中两点与 pi 默认 rg 参数不同，ripgrep 实现需对齐：.gitignore 在非 git 目录也生效（rg 需 `--no-require-git`），始终排除 `.git`（rg `--hidden` 下需 `--glob '!.git'`）；结果按路径排序（rg `--sort path`）；glob 相对搜索目录（rg 以搜索目录为 cwd、路径参数为 `.`）。
- read 不做图片缩放（pi 用 photon wasm，未选型）：≤4.5MB 的 png/jpeg/gif/webp 原样附加，否则只返回说明文本。
- bash 声明 `timeoutMs: 0`，不受统一默认超时（10 分钟）约束，自身 `timeout` 参数仍生效；子进程环境去掉 `ELECTRON_RUN_AS_NODE`。
- 移植自 pi coding-agent 1.4.0 的代码文件头有说明，MIT 声明在 `packages/agent/THIRD_PARTY_NOTICES.md`。

实际运行的命令与结果（worktree，合入 main 之前）：

- `pnpm install --frozen-lockfile`：通过。
- `pnpm run typecheck`、`pnpm run lint`（0 warnings / 0 errors）、`pnpm run format:check`：通过。
- `pnpm run test`：17 个文件、94 个用例通过；`packages/agent` 内 `vitest run` 再连续运行 3 次，每次 68 个通过。
- `pnpm run check:docs`：58 个文件、0 个问题。

未验证：真实模型 API（无密钥）；在 Electron 内置 Node（`ELECTRON_RUN_AS_NODE`）下运行 agent 测试；按子路径导入后的打包体积。

文档影响：TECH_STACK“接入状态”新增 packages/agent 一行；无其他正式文档改动。