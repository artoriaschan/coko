# 10: 回退、分叉与 Handoff 的加载边界

**What to build:** 已加载的工具与对话的边界一致。回退到某次加载之前，那次加载一并撤销；从用户消息或助手回复分叉出的会话，只继承分叉点之前加载的工具，源会话压缩过也一样；Handoff 的新会话没有已加载的工具，按自己的需要重新发现。

**规格场景:** [spec](../spec.md) 的 AC-10；对应 TS-15。

**设计依据:** [design.md](../design.md) 第 6 节的生命周期表；[ADR 0006](../../../docs/adr/0006-file-checkpoints-and-rewind.md)、[ADR 0023](../../../docs/adr/0023-assistant-reply-forks.md)。

**文档影响:** 当前行为文档中说明回退与分叉复制哪些条目的段落，补充加载记录的选取规则；实施时核实所在页。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] AC-10：第 2 轮加载工具 A、第 4 轮加载工具 B，回退到第 3 轮之前后，B 不再加载，A 仍加载；纯文件回退不影响已加载集合。
- [x] 从第 3 轮的用户消息分叉、从第 3 轮的助手回复分叉、在压缩过的会话上分叉，新会话都只继承 A。分叉只复制目标边界之前的加载记录，不套用权限条目在助手回复分叉下复制全部的规则。
- [x] Handoff 的新会话没有已加载的工具。
- [x] 分叉时的记录选取有纯函数单测；场景经真实 Sidecar 验证，先例为回退与分叉时 State Update 的现有 Sidecar 测试。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：`forkEntries` 新增 `tool_load` 复制，并单独以目标前缀限制；助手包含边界仍继承源当前权限状态，后续加载不随权限一起复制。加载记录不经过压缩切点过滤，复制后的消息来源序号仍按包括加载条目的完整选择列表计算。Handoff 沿用仅复制权限的实现，不复制加载；对话/纯文件回退沿用现有条目规则，无需新增可变状态。
- TDD：`rtk pnpm run test packages/agent/src/agents/fork.test.ts` 先红（2 个新场景因缺少加载条目失败，原 19 例通过），修复后 21/21。纯函数场景覆盖两种边界、压缩前加载、助手分支当前权限与再次分叉的来源序号。
- 真实 Sidecar：`tests/integration/sidecar-tool-search-boundaries.test.ts` 2/2，分别使用已压缩与未压缩的源 Session；A 在边界之前加载、B 在之后加载。用户/助手及再次分叉的持久化条目与下一请求只有 A；压缩切点明确晚于 A 的加载。纯文件回退实际删除后续创建文件但下一请求保留 A+B；对话回退后只有 A；Handoff 的新 Session 没有加载记录，下一请求无 MCP schema。源条目在 Fork 前后逐项相等，协议无 invalid entry。预期工具名和持久化载荷独立写在测试中，没有刷新实际输出作为期望。
- 相关回归：`rtk pnpm run test packages/agent/src/agents/fork.test.ts packages/agent/src/agents/handoff.test.ts packages/agent/src/entries/tool-loads.test.ts tests/integration/sidecar-tool-search-boundaries.test.ts tests/integration/sidecar-state-update-fork.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-handoff.test.ts`：7 文件 58/58，通过。随后按 lint 规则整理断言位置，仅重跑失效的 fork 与 boundaries：2 文件 23/23，通过。
- 验证：`rtk pnpm run typecheck`、定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 个 Markdown，0 问题）通过。文档影响：当前分叉/回退语义归 `docs/subsystems/context.md`，MCP 生命周期、Handoff 继承表和工作台助手分支说明同步；源码 Handoff 注释澄清与 Fork 的差异。从 AGENTS → docs/README → 正文读回，正式文档不依赖任务材料，未改变 ADR 状态。
- 范围：未验证真实 Provider、Electron 原生层、构建产物或 CI。本票无需新增模型可见文字，实际模型请求的工具声明与保存条目为验收事实。
