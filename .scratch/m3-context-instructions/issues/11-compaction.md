# 11: 压缩：阈值、摘要、熔断、重建与 /compact

**What to build:** agent `context/compaction/`：每次模型请求前（运行时 `beforeRequest`）估算超过阈值时自动压缩；请求以上下文溢出失败时压缩一次再重试一次；切点保留最近 20 000（不拆 toolCall / toolResult，没有可摘要内容时不压缩）；摘要请求用 Session 当前模型、无工具、maxTokens 20 000、[grilling F3](../grilling.md#第-4-轮) 的结构，已有摘要时增量更新，`/compact <指示>` 追加要求；提交 `compaction` 条目（readFiles / modifiedFiles 从工具调用汇总、invokedSkills）；有效上下文由票 01 的 `modelContext` 计算；连续 3 次自动失败熔断（重启或成功的手动压缩复位）；`context.autoCompact`；progress `compaction_*`；压缩后清空嵌套指令的已加载集合。内置命令 `/compact` 接入：server `context/compaction.ts` 的 action 开始 trigger `compact` 的 Run。界面：时间线压缩分隔条（约节省 N tokens，可展开摘要，之前的消息仍可查看）、composer 上方"正在压缩上下文…"（可停止，停止不提交条目）、失败 Toast、熔断时上下文环旁的暂停标记。产物 smoke 增加：打包产物中 `COKO_HOME` 指令进入模型请求、stdio MCP 测试 Server 的工具可调用。

**User stories:** 21, 22, 23

**Blocked by:** 05, 08, 10

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/compaction/`、`packages/agent/src/engine/runtime.ts`、`packages/agent/src/entries/`（只限修正）、`packages/agent/src/instructions/commands/builtin.ts`、`packages/agent/src/instructions/rules/`（只限压缩后清空已加载集合的接口）、`apps/server/src/application/context/compaction.ts`、`apps/server/src/application/sessions.ts`（trigger compact 的 Run）、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`timeline-view.tsx`、`compaction-divider.tsx`（新）、`composer.tsx`、`context-ring.tsx`、`apps/desktop/src/renderer/stores/context-store.ts`、`packages/i18n/src/dictionaries/domains/compaction.ts`、`tests/integration/sidecar-compaction.test.ts`（新）、`apps/desktop/e2e/compaction.e2e.test.ts`（新）、`apps/desktop/e2e/package-smoke.e2e.test.ts`、`docs/subsystems/context.md`、`packages/agent/README.md`、`apps/server/README.md`

- [ ] agent 测试：切点表驱动（工具调用对不被拆开、只有最近内容时不压缩）、增量更新提示、熔断计数与复位
- [ ] 集成测试（faux 小窗口）：越过阈值后提交 `compaction { trigger: auto }`；摘要请求没有工具、含规定的节标题；下一次模型请求为合成摘要消息 + firstKeptSeq 及之后的消息；`/compact 只保留接口设计` 开始 trigger compact 的 Run，摘要请求含该指示；faux 返回溢出错误时压缩一次并重试一次成功
- [ ] 集成测试：摘要请求连续失败 3 次后不再自动压缩，`compaction_failed` 带 consecutiveFailures；压缩中 abort 不提交 compaction 条目；回退到压缩之前的消息后模型上下文恢复原历史；压缩后分叉的新 Session 上下文与原 Session 一致
- [ ] E2E：时间线出现分隔条并可展开摘要；压缩进行中显示状态行；熔断后环旁显示暂停标记
- [ ] 产物 smoke：打包产物中 `COKO_HOME/AGENTS.md` 出现在 faux requestLog；stdio MCP 测试 Server 的工具调用成功
- [ ] context.md、agent README、server README 同步；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 01——ContextContribution 尚无 beforeRequest 字段，压缩无法挂到该接入点。本票可修改 apps/server/src/application/context/types.ts、context/index.ts 与 sessions.ts 中接线 beforeRequest 的最小部分（超出原 Write scope，已授权）。另：package-smoke 尚未传入临时 COKO_HOME，由本票补上；服务端 action 与贡献工具路径目前只在空贡献下运行，本票与票 04 补集成用例。
- 2026-10-29 lead：来自票 03——产物 smoke 未设置 COKO_HOME，Sidecar 会读真实的 ~/.coko/AGENTS.md；本票补上临时 COKO_HOME（与票 01 的说明一致）。
- 2026-10-29 lead：来自票 07——产物 smoke 须证明 MCP stdio 在打包产物中可用（pi-mcp 与 cross-spawn 进入 sidecar bundle）：用测试 MCP Server 在 package-smoke 中完成一次工具调用。
- 2026-10-29 lead：来自票 10——contextBudget、compactionBuffer、estimateContextTokens、trimOldToolResults 等已从 @coko/agent 导出；apps/server/src/application/context/usage.ts 的 contextUsage 中 autoCompact.paused 固定为 false，由本票接上熔断；贡献的 transformMessages 已收到 scope；faux 脚本可设 contextWindow / maxTokens；上下文圆环选择器为 [data-context-ring]。E2E 默认后台运行（票 12），需要看窗口时设 COKO_E2E_VISIBLE=1。
