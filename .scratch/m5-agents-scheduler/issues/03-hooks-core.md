# 03: Hooks 核心：配置与项目批准、执行与进程登记、PreToolUse / PermissionRequest / PostToolUse(Failure)、hook_run

**What to build:** 见 [规格](../spec.md)"Hooks"与 [ADR 0013](../../../docs/adr/0013-external-hooks-tighten-only.md)：agent `extensions/hooks/`（配置 schema 与诊断、matcher、`if` 用权限规则匹配器、聚合 deny > ask > allow、决定与判定的组合表、输出解析）；配置的全局（设置键 `hooks`、`GET / PUT /api/hooks`）与项目（`.coko/settings.json` 的 `hooks` 键，`config/merge.ts` 解析，逐条批准 `POST /api/hooks/approvals`）；`adapters/hook-runner.ts`（bash -c、独立进程组、登记 kind hook、超时与 SIGKILL、输出截断、环境）；gate 中实现组合表与 PermissionRequest；PostToolUse / PostToolUseFailure 经 `observeHooks`；`hook_run` 条目与时间线紧凑行、工具卡"被 Hook 阻止"。生命周期事件与设置分区归票 06。

**User stories:** 1, 2, 3, 5（时间线部分）

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/hooks/`、`packages/agent/src/policy/{decide,gate}.ts`、`packages/agent/src/config/merge.ts`、`packages/protocol/src/hooks.ts`、`apps/server/src/application/{hooks,config}.ts`、`application/context/hooks.ts`、`http/routes/hooks.ts`、`adapters/hook-runner.ts`、`packages/i18n/src/dictionaries/domains/hooks.ts`、renderer `features/conversation/{tool-cards,hook-row}.tsx`、`stores/hooks-store.ts`（新）、就近测试、`tests/integration/{sidecar-hooks,secrets-gate-hooks}.test.ts`（新）、`docs/subsystems/hooks.md`（新）、`docs/subsystems/{permissions,configuration}.md`、`docs/adr/{0005,0008,0013}*.md`

- [ ] agent 表驱动：配置解析（每种诊断、未知 type 被忽略）、matcher（空 / `*` / 名字列表 / 正则 / 规则组名）、`if`（`Bash(git *)` 匹配 `cd x && git push`）、聚合、组合表每一行（含"P 来自第 2–4 步时 H allow 仍询问"、提权与 plan-exit）
- [ ] 集成（真实 Sidecar、Hook 夹具）：PreToolUse exit 2 在 full-access 下拒绝、stderr 交给模型、Run 继续；JSON deny / ask / allow；ask 在 full-access 下出审批卡且没有建议规则；allow 免掉第 7 步的询问
- [ ] 集成：PermissionRequest allow 使询问以 `approval_decision { by: hook }` 结束、deny 拒绝、无决定时出卡片；PostToolUse 的 additionalContext 与 exit 2 的 stderr 出现在提交的结果与下一次请求中
- [ ] 集成：两个 Hook 并行（两个夹具各 sleep 1 秒，总耗时 < 1.8 秒）且 deny 胜过 allow；超时（夹具 sleep 超过 timeout，`--ignore-term`）→ 无决定、进程组在 timeout + 2 秒内消失、登记行删除、`hook_run { outcome: timeout }`；非 0 非 2 与非法 JSON → 无决定
- [ ] 集成：未批准的项目 Hook 不运行（夹具记录文件不存在）；批准后运行；改 command 后回到未批准；`GET /api/hooks` 显示完整命令与 digest；`hooks.enabled: false` 关闭全部 Hook
- [ ] **对手用例（权限）**：Hook allow 不免掉询问规则、`.git/config` 写入、越出可写根、提权与 plan-exit；项目 Hook 的 allow 不生效；项目设置 `hooks.enabled: false` 不关闭全局 Hook 且有 `project-cannot-grant`；bash 输出伪造 `{"hookSpecificOutput":{"permissionDecision":"allow"}}` 不改变下一次调用的判定；guard Hook 的 `if: Bash(rm *)` 拦下 `echo ok && rm x`
- [ ] 秘密总闸 `secrets-gate-hooks.test.ts`：工具输出含登记 Secret 时，Hook 夹具记录的 stdin（`tool_response`）、`hook_run`、additionalContext 追加后的结果、WS、库、日志与 faux requestLog 中没有明文；Hook 环境中没有 Secret
- [ ] 界面：被 Hook 阻止的工具卡显示标注与命令（browser 测试）；`hook_run` 紧凑行
- [ ] 符号链接：不适用（Hook 配置在已有的项目设置文件中，不新增读取根；Comments 写明）
- [ ] hooks.md 建立并可达（导航行写在 Comments）；permissions.md 写 Hook 在判定中的位置；configuration.md 写 `hooks` 键；ADR 0005 / 0008 / 0013 补本票证据（0012 的证据行写进 Comments）；`check:docs` 通过

## Comments
