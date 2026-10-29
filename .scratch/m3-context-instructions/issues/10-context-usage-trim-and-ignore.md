# 10: 上下文用量、时间裁剪与 gitignore 对齐

**What to build:** agent `context/usage/`：估算（最后一次 assistant usage + 其后 chars/4；分项 chars/4）、阈值与预警（[规格](../spec.md#预算与数值)，压缩票 11 复用）、时间裁剪（60 分钟、保留 5 个、> 2KB 替换，经 `transformMessages`，`context.trimOldToolResults`，时钟可注入）。server `context/usage.ts` 汇总各贡献的 `report()`，`GET /api/sessions/:id/context` 与 `GET /api/workspaces/:id/context`。packages/ui HoverCard（radix-ui）与上下文环组件；composer 底栏挂载环（`context_usage` progress 与 run_end 后刷新；预警线 warning、阈值 destructive），点击打开 HoverCard（分项、指令文件、诊断）。gitignore 对齐（Carry-over，M1 票 09）：内置 walk / grep / find 与 @ 文件搜索另读 `.git/info/exclude` 与全局 excludes（`core.excludesFile`，未设时 `$XDG_CONFIG_HOME/git/ignore` / `~/.config/git/ignore`；只读 `~/.gitconfig` 与 `$XDG_CONFIG_HOME/git/config`，不跟随 include）；grep 契约套件增加用例，内置与 ripgrep 都跑；server README 的 ripgrep 差异说明改写。faux 脚本可设 contextWindow / maxTokens。

**User stories:** 18, 19, 20

**Blocked by:** 03, 06

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/usage/`、`packages/agent/src/tools/builtin/walk.ts`、`glob.ts`、`grep.ts`、`find.ts`、`packages/agent/src/testing/grep-contract.ts`、`apps/server/src/adapters/ripgrep.ts`、`apps/server/src/adapters/ripgrep.test.ts`、`apps/server/src/adapters/faux.ts`、`apps/server/src/application/context/usage.ts`、`apps/server/src/http/routes/context.ts`、`packages/protocol/src/context.ts`、`packages/ui/src/components/hover-card.tsx`（新）、`packages/ui/src/context-ring/`（新）、`packages/ui/src/index.ts`、`apps/desktop/src/renderer/features/conversation/composer.tsx`、`apps/desktop/src/renderer/features/conversation/context-ring.tsx`（新）、`apps/desktop/src/renderer/stores/context-store.ts`（新）、`packages/i18n/src/dictionaries/domains/context.ts`、`tests/integration/sidecar-context.test.ts`（新）、`apps/desktop/e2e/context.e2e.test.ts`（新）、`docs/subsystems/context.md`、`apps/server/README.md`

- [ ] agent 测试：估算（有 / 无 usage）、阈值公式在 128k、400k、1M 窗口下的值、时间裁剪（注入时钟：59 分钟不裁、61 分钟裁、最近 5 个保留、条目不变）
- [ ] 集成测试：`GET …/context` 的 breakdown 含 system、instructions、skills、memory、tools、messages，instructions 列出已加载文件与截断、诊断出现；一次 Run 后 tokens 等于 faux usage 加估算；`context_usage` progress 在 assistant 条目之后
- [ ] 契约测试：`.git/info/exclude` 与临时 HOME 下 `core.excludesFile` 指定的文件、XDG 缺省文件中忽略的路径，内置 grep / find 与 ripgrep grep 都不列出；没有这些文件时结果与之前一致
- [ ] E2E：底栏显示百分比；faux 设小窗口使用量越过预警线后环为 warning 色；点击打开 HoverCard 看到分项与指令文件，Esc 关闭且焦点回到环；390px 宽度下不挤压模型与模式选择
- [ ] context.md 增加用量、裁剪与忽略规则；server README 的 ripgrep 说明改为"两种实现读取同样的忽略来源"；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 03——已加载指令文件与诊断的形状目前由 ContextReport 承载，packages/protocol/src/instructions.ts 未改；本票如需在协议中声明，在 protocol 的 instructions 领域文件中定义并从 ContextReport 引用。
- 2026-10-29 lead：来自票 08 与 05——Session、全局与 Workspace 规则接口用 SessionService.#hostToolNames() 校验工具名，只覆盖基础工具，贡献工具（memory_*、read_mcp_resource、list_mcp_resources 等）写规则时被拒为 unknown-tool（票 05 只为 skill 加了别名）。本票顺带修复：规则校验接受当前已注册的贡献工具名与 mcp__ 前缀（越出写范围，已授权：apps/server/src/application/sessions.ts 的 #hostToolNames 与 permissions 校验），并用集成测试覆盖 PUT /api/permissions 写入 Memory 与 MCP 资源工具的拒绝规则后生效。
