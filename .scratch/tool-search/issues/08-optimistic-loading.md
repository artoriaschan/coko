# 08: 乐观加载

**What to build:** 模型直接调用目录中尚未加载的工具时，这次调用失败，结果提示“已加载，请直接重试”，并写入来源为乐观加载的加载记录；从下一次请求起该工具可用，再次调用成功。名称不在目录中时，照常返回原有的未找到错误，不加载任何工具。工具结果已提交、加载记录尚未写入时崩溃，恢复后没有这次加载；模型再直接调用时由乐观加载补上，恢复过程不重跑业务工具。

**规格场景:** [spec](../spec.md) 的 AC-12；对应 TS-17。

**设计依据:** [design.md](../design.md) 第 5 节“加载”与第 6 节“失败”；第 6 节“实施时需确认”的第 3 项在本票处理。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md) 补充乐观加载的行为。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] AC-12：目录中有未加载的工具 C，模型直接调用 C，结果为“已加载，请直接重试”，下一次请求包含 C，再次调用成功；直接调用一个不在目录中的名称，返回原有的未找到错误，不写加载记录。
- [x] 乐观加载与 `tool_search` 的加载使用同一种条目，来源标为乐观加载，在对应工具结果提交后写入；写入失败时 Run 以 commit_failed 停止。
- [x] 核实在提交前改写结果文字是否可行。不可行时不要自行换做法：设计稿给出的替代做法是在下一轮衔接时补一条宿主提示，它与 AC-12 的写法不同，需先经用户确认。
- [x] 工具结果已提交、加载记录未写入时中断 Sidecar：恢复后没有这次加载；再直接调用时由乐观加载补上；恢复不重跑业务工具。故障切点通过公开 Runtime 提交端口验证，未从 Sidecar 注入，边界见 Comments。
- [x] 场景经真实 Sidecar（faux 脚本）验证；模型可见文本的变化同步到会话回放或快照。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：Runtime 在 `message_end` 用实际执行集合判断工具缺席，宿主 `takeToolLoad` 仅能为当前冻结目录授权乐观加载；同一 toolResult 对象在提交前改为「工具已加载，请直接重试。」，仍保留 `isError: true`，随后提交来源为 `optimistic` 的独立加载条目。已有工具的权限拒绝和业务错误不走此路径，未知名称保持原错误，不自动重放业务调用。
- TDD 沿用规格确认的 Sidecar/faux 与公开 Runtime 提交端口接缝。`sidecar-tool-search-optimistic.test.ts` 最初 2/2 因仍返回 `Tool mcp__demo__echo not found`、缺少加载记录而失败，接入后 2/2 通过；断言真实 MCP stdio 调用、条目顺序及下一次 faux 请求中已改写的结果和新增定义。独立维护的模型可见期望为 `tests/fixtures/tool-search/optimistic-result.txt`。第二例确认被拒绝的重试不执行、不生成第二个加载，也不被改写为乐观加载。
- 精确的「结果提交后、加载提交前」中断通过公开 AgentRuntime `commit` 端口拒绝 `tool_load` 验证：结果已保存但无加载，Run 以 `commit_failed` 结束且仅发出一次请求；用已保存消息重建后工具仍未加载，模型再次直接调用可补上加载，业务处理只在其后明确重试时执行一次。现有 Sidecar 没有提交故障注入入口，因此未声称在真实 Sidecar 上命中这个微小崩溃切点；正常乐观加载与权限链使用真实 Sidecar。未新增产品测试环境变量或不确定的 SIGKILL 竞态。
- 初始相关集 `rtk pnpm run test packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/engine/tool-loading.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-tool-search-optimistic.test.ts`：5 文件 48/48。合入最新集成分支 `6ab2944b` 后补验 `rtk pnpm run test packages/agent/src/engine/tool-loading.test.ts packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts tests/integration/sidecar-tool-search-optimistic.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-incremental-tools.test.ts packages/protocol/src/readme.test.ts`：7 文件 65/65，包括原生传输与压缩回归。
- `rtk pnpm run typecheck`、定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 个 Markdown，0 问题）与 `rtk git diff --check` 均通过。文档归属为 MCP 当前行为正文和协议 README（明确乐观加载结果仍为错误）；已从 AGENTS → docs/README → 正文读回，链接、归属和摘要未失效，正式文档不依赖任务材料。既有历史票和研究保持原时点结论。
- 实现提交 `72822185`；工作保存于本地分支 `codex/tool-search-08`，未推送。真实 Provider、Electron 原生交互、产物及 CI 未验证；两条既有 `context-seam.test.ts` 顺序断言基线失败沿用 01 票证据，不在本票改动。
