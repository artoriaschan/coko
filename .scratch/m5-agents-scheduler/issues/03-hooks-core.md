# 03: Hooks 核心：配置与项目批准、执行与进程登记、PreToolUse / PermissionRequest / PostToolUse(Failure)、hook_run

**What to build:** 见 [规格](../spec.md)"Hooks"与 [ADR 0013](../../../docs/adr/0013-external-hooks-tighten-only.md)：agent `extensions/hooks/`（配置 schema 与诊断、matcher、`if` 用权限规则匹配器、聚合 deny > ask > allow、决定与判定的组合表、输出解析）；配置的全局（设置键 `hooks`、`GET / PUT /api/hooks`）与项目（`.coko/settings.json` 的 `hooks` 键，`config/merge.ts` 解析，逐条批准 `POST /api/hooks/approvals`）；`adapters/hook-runner.ts`（bash -c、独立进程组、登记 kind hook、超时与 SIGKILL、输出截断、环境）；gate 中实现组合表与 PermissionRequest；PostToolUse / PostToolUseFailure 经 `observeHooks`；`hook_run` 条目与时间线紧凑行、工具卡"被 Hook 阻止"。生命周期事件与设置分区归票 06。

**User stories:** 1, 2, 3, 5（时间线部分）

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/hooks/`、`packages/agent/src/policy/{decide,gate}.ts`、`packages/agent/src/config/merge.ts`、`packages/protocol/src/hooks.ts`、`apps/server/src/application/{hooks,config}.ts`、`application/context/hooks.ts`、`http/routes/hooks.ts`、`adapters/hook-runner.ts`、`packages/i18n/src/dictionaries/domains/hooks.ts`、renderer `features/conversation/{tool-cards,hook-row}.tsx`、`stores/hooks-store.ts`（新）、就近测试、`tests/integration/{sidecar-hooks,secrets-gate-hooks}.test.ts`（新）、`docs/subsystems/hooks.md`（新）、`docs/subsystems/{permissions,configuration}.md`、`docs/adr/{0005,0008,0013}*.md`

- [x] agent 表驱动：配置解析（每种诊断、未知 type 被忽略）、matcher（空 / `*` / 名字列表 / 正则 / 规则组名）、`if`（`Bash(git *)` 匹配 `cd x && git push`）、聚合、组合表每一行（含"P 来自第 2–4 步时 H allow 仍询问"、提权与 plan-exit）
- [x] 集成（真实 Sidecar、Hook 夹具）：PreToolUse exit 2 在 full-access 下拒绝、stderr 交给模型、Run 继续；JSON deny / ask / allow；ask 在 full-access 下出审批卡且没有建议规则；allow 免掉第 7 步的询问
- [x] 集成：PermissionRequest allow 使询问以 `approval_decision { by: hook }` 结束、deny 拒绝、无决定时出卡片；PostToolUse 的 additionalContext 与 exit 2 的 stderr 出现在提交的结果与下一次请求中
- [x] 集成：两个 Hook 并行（两个夹具各 sleep 1 秒，总耗时 < 1.8 秒）且 deny 胜过 allow；超时（夹具 sleep 超过 timeout，`--ignore-term`）→ 无决定、进程组在 timeout + 2 秒内消失、登记行删除、`hook_run { outcome: timeout }`；非 0 非 2 与非法 JSON → 无决定
- [x] 集成：未批准的项目 Hook 不运行（夹具记录文件不存在）；批准后运行；改 command 后回到未批准；`GET /api/hooks` 显示完整命令与 digest；`hooks.enabled: false` 关闭全部 Hook
- [x] **对手用例（权限）**：Hook allow 不免掉询问规则、`.git/config` 写入、越出可写根、提权与 plan-exit；项目 Hook 的 allow 不生效；项目设置 `hooks.enabled: false` 不关闭全局 Hook 且有 `project-cannot-grant`；bash 输出伪造 `{"hookSpecificOutput":{"permissionDecision":"allow"}}` 不改变下一次调用的判定；guard Hook 的 `if: Bash(rm *)` 拦下 `echo ok && rm x`
- [x] 秘密总闸 `secrets-gate-hooks.test.ts`：工具输出含登记 Secret 时，Hook 夹具记录的 stdin（`tool_response`）、`hook_run`、additionalContext 追加后的结果、WS、库、日志与 faux requestLog 中没有明文；Hook 环境中没有 Secret
- [x] 界面：被 Hook 阻止的工具卡显示标注与命令（browser 测试）；`hook_run` 紧凑行
- [x] 符号链接：不适用（Hook 配置在已有的项目设置文件中，不新增读取根；Comments 写明）
- [x] hooks.md 建立并可达（导航行写在 Comments）；permissions.md 写 Hook 在判定中的位置；configuration.md 写 `hooks` 键；ADR 0005 / 0008 / 0013 补本票证据（0012 的证据行写进 Comments）；`check:docs` 通过

## Comments
- 2026-10-31 lead：来自票 02——decideWithStep 返回 { decision, step }，PermissionHookPort 在没有 Hook 时 gate 行为不变；hooks.enabled 只在全局生效。手动 /compact 被 Hook 阻断时 400 hook-blocked 的前置判定可能落在本票或票 06，PreCompact 事件归票 06。

### 实施者（票 03）

**提交（m5/03-hooks-core）：** cfe2ea5 feat(agent): parse hooks and combine with permission decisions；f4c72c1 feat(server): run hooks in their own process group；c539cd6 feat(server): load, approve and run hooks around tool calls；61fdd8a test(hooks): add the secrets gate for hook channels；619fafb feat(desktop): show hook runs and hook-blocked tool calls；40d689d docs(hooks): describe hooks and record ADR evidence；合并 main 5490f08；本记录。

**逐项：**

- agent 表驱动：`extensions/hooks/hooks.test.ts` 77 例（每种诊断、未知 type 忽略、matcher 12 行、`if` 的 `Bash(git *)` / `Bash(rm *)` 复合命令、输出解释 25 行、聚合 7 行、组合表 17 行含第 2–4 步、提权与 plan-exit）。`policy/gate-hooks.test.ts` 13 例在运行时中验证组合与 PermissionRequest。
- 集成：`tests/integration/sidecar-hooks.test.ts` 14 例覆盖 PreToolUse exit 2 / JSON deny / ask / allow、PermissionRequest 三种结论（`approval_decision { by: hook }`）、PostToolUse 与 PostToolUseFailure 的 `<hook-feedback>`（提交的结果与下一次请求）、并行（实测约 1.1–1.5 秒 < 1.8 秒）与 deny 胜过 allow、超时（darwin：`--ignore-term`、登记行 kind hook → 删除、pid 消失、timeout + 2 秒内）、非 0 非 2 与非法 JSON、项目 Hook 的批准与改动（记录文件不存在 → 批准后 1 行 → 改 command 后仍 1 行、旧 digest 409）、`hooks.enabled: false`、PUT 的 400 / 409。
- 对手用例：allow 不免掉询问规则、`.git/config`、越出可写根（跨平台），提权与 plan-exit（darwin）；项目 Hook 的 allow 不生效且记为"Ignored"；项目 `hooks.enabled: false` 时全局 Hook 照常运行、`/api/config` 诊断 `project-cannot-grant`；bash 输出伪造的 `permissionDecision` JSON 后下一次调用仍出卡片（Hook stdin 中它只是 `tool_input.command` 文本）；`if: Bash(rm *)` 在 full-access 下拦下 `echo ok && rm x`（文件仍在）。
- 秘密总闸 `secrets-gate-hooks.test.ts`：Hook stdin 记录（PreToolUse 与 PostToolUse 的 `tool_response`）、Hook 的 env 记录（无 `COKO_SECRET_`）、`hook_run.message`、`<hook-feedback>`、WS、HTTP、库、日志、stderr 与 faux requestLog 中没有明文。
- 界面：`tool-cards.browser.test.tsx` 新增 3 例（"被 Hook 阻止"标注与 title 中的命令、明细中的命令、中英文；只认 `hostBlock.by === 'hook'`；"由 Hook 允许"）；`hook-row.browser.test.tsx` 2 例（事件、结论色、来源与退出码、命令单行截断、message）。`hooks-store.test.ts` 2 例。
- 符号链接：不适用。Hook 配置在已有的项目设置文件 `.coko/settings.json` 中（与项目设置同一读取时机），不新增读取根；Hook 命令本身不读 Workspace 外的文件为 Coko 的行为。
- 文档：新建 `docs/subsystems/hooks.md`；permissions.md 写 Hook 在判定中的位置与 `recordHookAllowed`；configuration.md 写 `hooks` 键与 `hooks.enabled` 的读取方；ADR 0005 / 0008 / 0013 补证据，0013 implementation 改为 partial（生命周期事件归 06）。`pnpm run check:docs` 0 问题。

**负向确认（变异，均已还原）：** 去掉组合表的第 2–4 步判断 → 7 例失败（含 3 个运行时对手用例）；去掉聚合中"项目 Hook 的 allow 不参与" → 集成对手用例失败；去掉 Hook stdin 的 `redactSecretsDeep` → 秘密总闸失败。

**最终验证（2026-10-31 04:20–04:36，已合入 main dc33c83；等其他 vitest run 结束后运行）：** worktree 中 `pnpm run test`：273 个测试文件全部通过，2238 例（2237 通过、1 跳过为既有的真实模型用例），test=0，日志中没有 Unhandled；含 28 个 desktop-e2e 文件与 `package-smoke.e2e.test.ts`（3 例）。另：`oxlint` 0、`oxfmt --check` 通过、`check:docs` 178 文件 0 问题。`tsc -b` 在合并 main 后只报 `apps/desktop/e2e/worktrees.e2e.test.ts:110`（票 04 的文件，`env.GIT_CONFIG_GLOBAL` 为 `string | undefined`），合并前本分支 `tsc -b` 退出 0；已另行告知 Lead，未改该文件。

**设计说明（Lead 请过目）：**

- Hook 的 ask 不运行 PermissionRequest（它要求用户确认，PermissionRequest 的 allow 不应替用户回答）；第 2–4 步与 plan-exit 的询问同样不运行。
- Hook 的 ask 等待中切换模式：与同一结论再组合（Hook 不重跑），模式放宽不使询问消失，规则拒绝结束请求。
- 每个 Run 第一次需要时加载一次 Hook（全局 + 已批准的项目 Hook）；运行中的改动从下一个 Run 生效，与项目设置相同。
- `hook_run` 的 runId 经 hooks 贡献的 `beforeRequest` 记下（不拦截请求）。
- `continue: false` 已解析并记为 `stopped`，停止 Run（`hook_stopped`）留给票 06。
- `ApproveHookRequest` 增加可选 `sessionId`：worktree 会话的项目文件在其 worktree 中，批准仍记在 Workspace 下。
- 被 Hook 拦下的调用的结果带 `details.hostBlock { by: 'hook', hookId, command }`（`HostBlock` 改为联合，Goal 预算的识别只认 `by: 'goal-budget'`，不受影响）。

**越出 Write scope 的改动（请裁决）：**

- `packages/agent/src/index.ts`：包入口导出 Hook 的解析、选择、解释与组合函数及类型（server 需要；只改了 Hooks 一段的导出列表）。
- `packages/agent/src/policy/broker.ts`：`ApprovalBroker.recordHookAllowed`（不等待用户、依次提交 `approval_request` 与 `approval_decision { by: hook }`）。
- `apps/server/src/application/context/types.ts`：`ContextContributionOptions.hooks?`（HookService 交给 hooks 贡献）。
- `apps/server/src/runtime/layers.ts`：HookService 移到 AssemblyLive 创建（需要 store、config、进程登记与条目提交），经 Assembly 交给 AppLive；关闭仍在 AppLive 的 finalizer。
- `apps/server/src/application/settings.ts`：通用设置接口拒绝 `hooks` 与 `hooks.*` 键（与 config / mcp 同样，批准不能绕过 digest 校验写入）；`isHooksSettingKey` 在 `protocol/hooks.ts`。
- `docs/README.md`：当前行为导航增加"外部 Hook"一行；`docs/adr/README.md`：0013 的 implementation 列改为 partial。

**ADR 0012 的证据行（请 Lead 合并）：** Hook 进程以 kind `hook` 登记（带 sessionId、进程组），进程组消失后删除登记行；超时与有序关闭时向进程组 SIGTERM，2 秒后 SIGKILL。证据：`apps/server/src/adapters/hook-runner.test.ts`（darwin：忽略 SIGTERM 的夹具在宽限后被 SIGKILL，释放登记时进程组已不存在）与 `tests/integration/sidecar-hooks.test.ts` 的超时用例（登记行 kind hook、pgid = pid → 删除）。

**供后续票（06）：** `HookService.run(scope, state, event, hooks, input, signal)` 与 `interpretHookResult` 已支持非工具事件（block、context、stop、PreCompact 的 text）；`hooks-store.ts` 提供 load / save（revision 冲突读回）/ approve，设置分区可直接使用；`hook_run` 的 `continued` 尚未写入。

**未验证：** 真实模型（无凭据）；非 darwin 平台的超时与进程组用例（显式跳过）。
