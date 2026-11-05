# 02: 上下文用量与模型请求共用一份工具清单

**What to build:** 上下文环“工具”一项计入的工具，与下一次模型请求实际带的工具定义来自同一处计算：根会话计入它实际拿到的工具，工具受限的子会话只计它能用的工具。现在用量统计直接累加基础工具与全部贡献的工具（包括全部已连接 MCP 工具），不经过运行时用来限定子会话工具的过滤，两处各算各的。本票只统一口径，不引入按需加载；之后 03 号票只需在这一处加入按需过滤。

**规格场景:** [spec](../spec.md) 的 AC-22 中子会话的部分；对应 TS-26。

**设计依据:** [design.md](../design.md) 第 2 节代码事实表与第 4 节模块表中用量的一行。

**文档影响:** [上下文管理](../../../docs/subsystems/context.md) 中上下文用量的工具口径改为“实际提供给模型的工具”。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] 根会话：用量接口返回的工具一项，等于下一次模型请求所带工具定义按现有 chars/4 规则的估算；用本地伪造的模型服务记录请求体核对。
- [x] 工具受限的子代理会话：用量只计它允许使用的工具，与它自己的请求体一致。
- [x] 历史中已提交的工具声明按它们在请求中的实际出现方式计入，不与请求级工具列表重复计算；核对结果与现状不一致时，在本票修正并记录依据。
- [x] 核实自动压缩的准入估算是否计入工具定义：计入时同样只计实际提供的工具；不计入时在 Comments 记录依据，不在本票新增。
- [x] 断言旧口径的现有测试随行为修改，并在 Comments 说明理由；不放宽其余断言。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：`providedTools` 统一基础工具优先、同名去重与 `filterTools` 过滤；运行时构造、每个 Run 与 Run 内刷新、上下文用量均使用该清单。用量查询复用 Run 的完整 Session scope，保留 parentSessionId 与子代理定义，因此受限子会话只计允许的工具。
- TDD：先复现历史声明重复计数（期望 21，实际 42）；真实 Sidecar + 本地 OpenAI-compatible HTTP 服务先复现根会话 4448/4038 与子会话 4038/162 的差异，再验证请求体与用量一致。模型服务返回固定输出且不报告 usage，避免按历史 usage 比例分配掩盖定义估算；根会话通过关闭再开启 Memory 产生真实的已提交工具声明，验证不会重复计数。
- 自动压缩确实计入工具定义：此前初始 system 的 toolsAdded 与历史增减声明参与估算，已移除定义仍能错误触发压缩。新增回归先观察原代码在实际约 20k 消息上提交了 tokensBefore=35057 的 compaction，再修正为无可信 usage 时只计当前工具清单一次；压缩后估算继续忽略被摘要前的 usage。可信 usage 仍沿用既有口径，不从模型已报告的总量中猜测扣除。
- 现有测试语义：未放宽断言。更新 agent 压缩测试的空工具 fixture 为真实 `createToolRegistry`，新增真实请求核对与工具移除回归；既有上下文、MCP、子代理与压缩断言保持。
- 验证：`rtk pnpm run test apps/server/src/application/context/usage.test.ts apps/server/src/application/context/mcp.test.ts tests/integration/sidecar-tool-accounting.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-subagents.test.ts packages/agent/src/engine/compaction.test.ts` 选中 7 文件 49 用例；首轮 48 通过、1 个压缩后估算回归失败，已定位并修正。修正后 `rtk pnpm run test packages/agent/src/engine/compaction.test.ts tests/integration/sidecar-compaction.test.ts` 2 文件 21 用例全部通过，其余此前通过的代码未改变。`rtk pnpm run typecheck`、所改 TS 文件的 `rtk pnpm exec oxlint ...` 均退出 0。未运行全仓测试、真实 Provider、桌面 Electron 交互、打包或 CI。
- 文档影响：工具计量与自动压缩估算变化 → `docs/subsystems/context.md` 估算、触发与验证章节 → 原地更新，正式导航与锚点仍有效。消费者搜索覆盖 docs、.scratch、.agents；已批准规格、研究与设计中的旧实现基线保留其当时语义。AGENTS → docs/README → context 正文读回通过，归属、状态、引用方向与历史保留无缺口。`rtk pnpm run check:docs` 检查 396 个 Markdown 文件，0 个问题，退出 0。
- 集成：本票提交后已合入 `codex/tool-search` 的 01 号修复（`e95cd0f6`），无代码冲突；合并后 `rtk pnpm run test apps/server/src/application/context/usage.test.ts tests/integration/sidecar-tool-accounting.test.ts packages/agent/src/engine/compaction.test.ts` 选中 3 文件 28 用例全部通过（退出 0），`rtk pnpm run typecheck`、`rtk pnpm run check:docs`（396 个 Markdown、0 问题）与 `rtk git diff --check` 均退出 0。01 号票已记录 `engine/context-seam.test.ts` 的两个既有 RunInput 顺序断言失败，本票未重跑或修正，不将局部通过表述为全仓通过。
