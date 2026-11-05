# 08: 分叉与上下文用量

**What to build:** 从某条消息分叉出的新 Session，复制的 State Update 保持与其消息的配对；新 Session 的第一个 Run 按它自己的当前状态送达（例如分叉不复制 Todo，于是送达一次清空），取代复制来的旧值。上下文环把 State Update 计入 system；导出包含 `state_update` 条目。见 [规格](../spec.md) 的“分叉”与“上下文用量”，以及 [设计](../design.md)“消费者”。

**User stories:** 26、30、31

**Blocked by:** 01

**Status:** ready-for-agent

**Closed:** true

- [x] 助手回复分支与用户消息分叉各一例：复制的 `state_update` 与其 user message 按原顺序成对出现；配对消息没有被复制的 `state_update` 不复制
- [x] 新 Session 的第一个 Run 送达当前值（Todo 与 Goal 未复制时为清空）
- [x] 上下文用量接口：配对的块计入 system，用户输入中同名的文本计入 prompt
- [x] ndjson 导出与 stream-json 中有 `state_update` 条目
- [x] 文档：上下文管理的分叉与用量；`check:docs` 通过

## Comments

2026-11-05：在集成基线 `7b667126` 上实施，测试接缝沿用规格批准的公开派生、真实 Sidecar HTTP/WS、导出回放与 headless 接口。先在 `forkEntries` 接缝观察缺少配对 date 条目的失败，再实现仅复制保留消息的有效配对来源；压缩分叉的 `firstKeptSeq` 包含首条消息前的 State Update，后续去重仍识别它。新 Sidecar 用例覆盖助手包含与用户之前两种边界、排除目标输入前未配对的更新、源 Session 不变、领域 Goal/Todo 不复制、新 Run 一次清空两者且不重复日期。保留 07 的 Checkpoint/回退原文修复。

用量测试先观察宿主块错误落入 prompt，再按有效配对把字符归到 system；相同的用户伪造文本仍计入 prompt，压缩切点移除前置条目时不归到 system。真实用量接口通过显式零 usage 的 faux 回复验证估算分项，不把未知真实 usage 当作零。保留 09 的 `basePrompt` 可选参数与装配传参。ndjson 导出的 State Update 经 `loadExport` 往返后仍配对，headless stream-json 的新 kind 与 payload v1 经协议 schema 校验。

相关期待同步：分叉首 Run 不再额外重发 date，更新压缩与回退测试中的完整请求数组。headless 续聊夹具原来的 `match: one` 与环境 Timezone 文本碰撞，改用完整唯一请求标记，继续验证输出、库中原始输入及 Session 复用，没有修改生产匹配逻辑。

验证（macOS，Electron 内置 Node 的真实 Sidecar/headless，faux 模型；均退出 0）：

- `pnpm install --frozen-lockfile`。
- `pnpm run test packages/agent/src/agents/fork.test.ts packages/agent/src/checkpoints/rewind.test.ts apps/server/src/application/context/usage.test.ts tests/integration/sidecar-state-update-fork.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-trace.test.ts tests/integration/headless.test.ts --reporter=json --outputFile=/tmp/coko08-final-tests.json`：实际选中 10 个文件（headless 过滤同时选中 secrets-gate-headless），90 例通过、0 失败；临时报告仅用于本次检查，必要结论已保存在此。
- `pnpm run typecheck`；`pnpm run check:docs`（360 个 Markdown，0 问题）；对本票 10 个 TypeScript 文件的 `pnpm exec oxfmt`、`pnpm exec oxlint`；`git diff --check`。

文档影响与读回：上下文管理维护分叉来源、压缩 firstKeptSeq 与 system/prompt 分类；headless 维护结构化输出；agent/protocol README 与 docs 导航同步。搜索正式正文、`.agents/`、本功能任务中的 firstKeptSeq/分叉复制/system 待办消费者：现行正文已修订，已完成票与设计事实快照保留原历史，ADR 0024 的实施状态留 10 按真实验证门槛维护。AGENTS → docs/README → 当前正文读回，路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过，无新增目录或反向依赖。

未验证：真实 Provider、真实模型缓存、Electron 交互窗口、构建产物、打包与 CI；本票不替代 09/10 的真实门槛。
