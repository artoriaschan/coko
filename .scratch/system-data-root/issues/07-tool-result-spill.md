# 07: 超长工具结果落盘

**What to build:** 工具结果被截断时，完整正文写入 `~/.coko/data/tool-results/<sessionId>/<toolCallId>.txt`，返回给模型的文本末尾附上该路径。单文件上限 32 MB，超过时只写前 32 MB 并在文件末尾与返回文本中标注 `[truncated]`。当前会话的该目录加入只读根，Agent 可以直接读取；未截断的结果不写盘。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [x] 产生超长输出并被截断的工具调用结束后，`data/tool-results/<sessionId>/<toolCallId>.txt` 存在并包含完整正文。
- [x] 返回给模型的工具结果文本包含该文件的绝对路径，模型可以继续读取完整内容。
- [x] 未被截断的结果不产生落盘文件。
- [x] 超过 32 MB 的结果只写入前 32 MB，文件末尾和返回文本都标注 `[truncated]`。
- [x] Agent 读取当前会话的落盘文件不需要审批；读取其他会话的落盘文件被拒绝或按越界处理。
- [x] 集成测试覆盖截断落盘、未截断不落盘、上限与跨会话读取限制。


Closed: true

## Comments

2026-11-05：实现 Session 级工具结果存储，Sidecar 将实际 Session 的 data/tool-results 目录传入 AgentRuntime；调度器剥离瞬态原文字段并在返回模型前保存。bash 超过显示限制后直接有界流写目标文件，其余 read、grep（含真实 ripgrep）、find、ls、MCP 工具/资源、Memory、Job、LSP 与子代理结果在格式化截断边界保留原文。文件名编码调用 id，32 MiB 限制包含末尾标记，UTF-8 完整字符前缀保留；正常结果不写文件。查询自身 limit 保持原语义，Job 已从环形缓冲丢弃的数据仍由既有 jobs 日志与丢弃提示处理。当前实际 Session 的结果目录只增加读取根，不授予其他 Session 目录或额外写入权限。

TDD 证据：新增真实 Sidecar 用例先因 long-output.txt 不存在失败，接入直接流写后通过；巨大 read 与 grep/find/ls 的落盘先 ENOENT，接入原文传播后通过；MCP 工具 b1.txt、资源 big.txt 先 ENOENT，接入后通过。流式 Unicode/精确 32 MiB 边界先因文件超过上限失败，改为保留完整解码字符和有界尾缓冲后通过。

检查：

- `pnpm run test tests/integration/sidecar-tool-results.test.ts`：5 项（完整 bash/普通结果无文件、巨大 read 与安全文件名、当前 Session 免审批且跨 Session 审批、grep/find/ls、流式 Unicode 与恰好上限）。
- 聚焦回归集共 13 文件/200 项：`sidecar-tool-results.test.ts`、`sidecar-mcp.test.ts`、`sidecar-mcp-resources-prompts.test.ts`、`packages/agent/src/tools/builtin/{bash,file-tools}.test.ts`、`tools/scheduler.test.ts`、`extensions/mcp/{results,resources}.test.ts`、`tools/lsp/lsp.test.ts`、`context/memory/memory.test.ts`、`tasks/jobs/jobs.test.ts`、`agents/definitions.test.ts`、`apps/server/src/adapters/ripgrep.test.ts`；初次 197 通过、3 既有失败。过滤既有失败后的最终结果见下方集成读回。
- `pnpm run typecheck` 退出 0；`pnpm run check:docs`：377 Markdown、0 问题。
- 未运行真实模型、Electron 或 Windows 实机；本票没有 renderer 或进程入口变更。文件与模型可见路径经真实 Sidecar 与后续 faux 模型请求日志确认。

已在未含 07 改动的 `/tmp/coko-sdr-02`（cd832716）复现相同 3 项既有失败，按主代理要求留待联合验收统一维护：

1. `packages/agent/src/tools/scheduler.test.ts`：`side-effect 调用的 tool_exec 在 execute 开始前已提交，幂等键经执行上下文交给工具；read 调用不提交`；旧顺序把 model_request 放在 assistant 后，实际在前。
2. 同文件：`tool_exec 提交失败：execute 未被调用，同批其余调用也不执行，Run 以 commit_failed 结束`；同一旧顺序预期。
3. `tests/integration/sidecar-mcp-resources-prompts.test.ts`：`/mcp__srv__greet Alice 提交 command 与展开文本；缺必填参数 400；结果不合 schema 400 并诊断；list_changed 后目录出现新模板`；旧预期遗漏 state_update 且 model_request 次序过时。

基线复现精确命令：`pnpm run test packages/agent/src/tools/scheduler.test.ts tests/integration/sidecar-mcp-resources-prompts.test.ts -t 'side-effect 调用|tool_exec 提交失败|/mcp__srv__greet'`，2 文件、3 失败、6 过滤。未修改这些旧断言。

文档影响：当前执行正文新增工具结果落盘契约并从 docs 导航可达，Agent 包说明新增宿主选项与原文传播契约；从 AGENTS → docs/README → execution 和包 README 读回，引用方向、语义、生命周期均无缺口。07 不维护 MCP 目录等其他票的事实。
