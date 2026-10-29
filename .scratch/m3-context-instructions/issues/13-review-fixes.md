# 13: M3 评审修复

**What to build:** 修复 [Standards 评审](../review-standards.md)（S*/D*/J*）与 [Spec 评审](../review-spec.md)（F*/M*）中必须处理的项，可选项中成本低的一并处理，其余在两份评审末尾"处理结果"中逐项写理由。重叠：S1 = F4，S2 = F2，S3 = M2，J10 = F3。Lead 已在各票 Comments 接受的偏离不回退。

**User stories:** 15、21、23、26（修复其实现）

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12

**Status:** ready-for-agent

**Write scope:** 用户直接授权：两份评审涉及的全部源码、测试、文档与本票；共享装配点（`apps/server/src/application/context/{index,types}.ts`、`sessions.ts`、`session-runtimes.ts`、`runtime/layers.ts`、`packages/protocol/src/{control,mcp}.ts`、设置分区、i18n 领域文件、`packages/ui/src/index.ts`）按评审要求修改。

- [x] Secret 与脱敏：F1（工具结果进入运行时之前替换；assistant 文本、toolCall 参数与 compaction.summary 入库与推送前按值替换；总闸扫描 faux requestLog 与模型回显）、S4（File Reference 块）、M3（Credential 明文登记）
- [x] 路径边界：F2 = S2（指令文件真实路径边界）、F3（项目 Skill 在 Workspace 内）、F6（@import 与指令加载遵守 Read 拒绝规则，拒绝 .env 与受保护目标）、S5（唯一的 `pathContains(root, path)`）
- [x] 正确性：F4 = S1（分叉中 compaction 的位置、估算）、F5（MCP 名字与规则同一比较规则，mcp.md 说明）、F7（摘要输入上限）、F8（409 先于展开）、F9（写入 context.md，请 Lead 裁决）
- [x] M1：设置中的 mcp.enabled、context.autoCompact、context.trimOldToolResults、instructions.enabled、commands.enabled 开关；E2E 断言
- [x] 界面：S3 = M2（批准对话框显示 env 与 header 值）、D6（本地化错误，技术详情可展开）、D5（共享 Textarea）
- [x] 规范与文档：D1、D2（含 `scripts/source-references.test.ts`，违规样例先红后撤销）、D3、S6
- [x] 可选：D4、J3、J8、J9 已做；D7、J1、J2、J4–J7 写明理由未做
- [x] 两份评审末尾追加"处理结果"；ADR 0004、0006、0007、0008，docs/subsystems 的 instructions、skills、mcp、context、configuration，TECH_STACK 与 apps/server README 同步；`pnpm run check:docs` 通过
- [x] git merge main 后全量 `pnpm run test`（含 desktop E2E 与 package-smoke）退出码 0

## Comments

- 2026-10-29 实施者：完成。逐项处理与测试见两份评审末尾的"处理结果"（[Standards](../review-standards.md)、[Spec](../review-spec.md)）。

  **方案要点。** 登记明文的按值脱敏只有 `@coko/logging` 一个实现（`redactSecretValues`、新增 `redactSecretsDeep`、`createSecretStreamRedactor`），替换点集中在 `apps/server/src/application/secret-redaction.ts`：afterToolCall 链的最后一个 hook（工具结果进入运行时之前）、每次模型请求的 transformMessages、入库与推送（除用户消息外的全部 payload 与进度，assistant 增量按内容块缓冲）。Credential 明文以 `[REDACTED]` 登记为同一机制的来源。路径边界统一为 `pathContains(root, path)`（`policy/rules.ts`）；Read 拒绝规则对不经工具读入上下文的文件统一为 `contextReadDenial`（File Reference 与指令文件共用）。MCP 名字与规则同一比较规则 `serverNameKey`（小写、`-`=`_`）。能力开关为 `config-store.setSwitch` 与共享 `CapabilityToggle`（文案按开关名查表，样式守卫不允许字面 label）。

  **需要 Lead 裁决。** (1) F9：保留"历史中每个超过 60 分钟的间隔也是裁剪点"的实现，理由与代价写进 context.md#时间裁剪，是与规格的偏离。(2) F1 的一个后果：工具调用参数入库时也按值替换，`tool_exec` 的参数同样替换；崩溃恢复时工具的 `probeOutcome` 看到的是替换后的参数，含登记值的调用更可能落到"等待用户确认"。(3) 每次模型请求前按值替换整个上下文，含用户自己输入的登记值（入库的用户消息保持原样）：登记的 Secret 只给工具与 MCP 用，不发给模型。(4) 流式增量中可能是登记值开头的结尾留到下一个增量；消息结束时留下的部分不单独发出，由之后提交的完整条目取代。

  **命令与结果。** merge main（main 为 cd834f3，本分支已包含，无需合并提交）后：`pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0（0 warnings、0 errors）；`pnpm run format:check` 0；`pnpm run check:docs` 0（115 个文件，0 个问题）；`pnpm run test` 0：179 个文件通过，1273 passed、1 skipped（`settings.e2e.test.ts` 的真实 DeepSeek 凭据用例，没有 `DEEPSEEK_API_KEY`），desktop-e2e 20 个文件全部通过（含 package-smoke 2 例），耗时 257 s。日志中唯一的 Error 文本是 Browser Mode 输出到 stderr 的 `ResizeObserver loop completed with undelivered notifications`，不是 Vitest 报告的未处理错误。

  **之前两次全量的失败。** 第一次：样式守卫把 `label="config.capabilities…"` 判为写死的文案（5 处），改为组件内按开关名查表。第二次（机器负载 ~20）：`agent/src/index.test.ts` 与 `sidecar-supervisor.test.ts` 超时、package-smoke 在发送按钮恢复时读到流式显示的 Markdown 原文 `**notes.txt**`；三者单独运行均通过；package-smoke 的这一断言改为 `expect.poll`（等提交的条目渲染，原断言不变），第三次全量通过。

  **负向确认（先红或变异）。** 每项见评审"处理结果"的测试列。其中：F8 测试初写时漏解构 `expand`，"先红"是 ReferenceError，已改正并用旧 `submit` 重新确认为断言失败；D2 的机械检查在 `fork.ts` 临时加 `// grilling F6` 后失败、撤销后通过；D4 给 agent 的 `DiagnosticSource` 临时加值后 tsc 报 8 个错误。

  **未验证。** 真实模型（无凭据）；Windows / Linux；流式增量缓冲在真实 Provider 的分块下的表现（只由 faux 4000 tokens/s 与单元测试覆盖）；MCP HTTP Server 的 header 值在批准对话框中只经类型与单元路径覆盖，E2E 只断言 stdio 的 env。

  **越出原写范围的改动。** 用户直接授权本票修改共享装配点：`application/sessions.ts`、`session-runtimes.ts`、`runtime/layers.ts`、`context/{index,types}.ts`、`packages/protocol/src/{control,mcp}.ts`（`McpLaunchDetails` 的 `envNames` / `headerNames` 改为 `env` / `headers`，协议形状变化）、`packages/ui/src/index.ts`（导出 `Textarea`）、i18n 领域文件 config / mcp / skills、`packages/logging` 的导出、`packages/agent` 的导出（`pathContains` 取代 `isWithin`、`contextReadDenial`、`serverNameKey`、`InstructionDenial`）。D2 改动了 127 个文件的注释（只改注释，diff 中没有非注释行）。

  **文档影响。** TECH_STACK（yaml 行）、apps/server README、docs/subsystems 的 instructions、skills、mcp、context、configuration，ADR 0004、0006、0007、0008 的实施证据。导航行无需改动。
