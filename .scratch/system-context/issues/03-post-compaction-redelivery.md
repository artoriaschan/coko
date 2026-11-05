# 03: Run 内压缩之后补发 State Update

**What to build:** 长 Run 中自动压缩把写过的待办摘要掉之后，模型在下一次请求里立即重新看到当前的待办；溢出恢复同样补发。摘要请求里的 State Update 缩为一行。见 [规格](../spec.md)“何时送达”中的压缩之后与“摘要请求”，以及 [设计](../design.md)“Run 内压缩之后”。

**User stories:** 24

**Blocked by:** 01

**Status:** ready-for-agent

**Closed:** true

- [x] Sidecar 集成测试（faux 小窗口）：Run 内自动压缩后，compaction 条目之后依次是 `state_update` 条目与只含块的 user message；下一次请求以它结尾，被摘要掉的待办重新出现
- [x] 溢出恢复：压缩成功之后、继续之前同样补发
- [x] 摘要请求中配对的块为 `[state update: todo_list]`；用户输入中的同名文本照原文进入摘要请求
- [x] 手动 `/compact` 的 Run 不送达，之后的 Run 开头送达
- [x] 补发之后的请求失败时，retry 重放的上下文包含补发的消息，与原请求一致
- [x] 文档：上下文管理的压缩节（取代“压缩后的 `<todo_list>`”）；`check:docs` 通过

## Comments

2026-11-05 实施：以 `bf5a5e8d` 为起点，使用已批准的 Sidecar requestLog/Session Entry 与条目派生接缝。自动和溢出压缩重建上下文后、下一请求之前，运行时调用现有 `stateUpdates`，提交条目与只含块的 user message 并追加到本次请求；手动压缩不调用。摘要规划只替换有配对来源的块，不改持久消息或用户伪造文本。continue 的送达仍由票 02 负责。

- TDD：摘要缩写的聚焦用例先因 `HOST-TODO` 未缩写失败，再通过；Sidecar 自动补发先因 compaction 后直接出现 model_request、缺少 state_update/message:user 失败，再通过。早期大段助手文本夹具产生过多流式 delta，探索执行以 143 中止并确认测试 worker、Sidecar 已退出；最终夹具改为真实 read 工具读取独立临时文件，不依赖海量 delta。
- `rtk pnpm run test tests/integration/sidecar-compaction.test.ts tests/integration/secrets-gate-compaction.test.ts packages/agent/src/context/compaction/compaction.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/engine/state-updates.test.ts packages/agent/src/entries/state-updates.test.ts`：6 文件、51 例通过，退出 0。测试断言随后去掉条件 expect，重跑 `rtk pnpm run test tests/integration/sidecar-compaction.test.ts`：8 例通过，退出 0。
- Sidecar 新增 3 例：同 Run 自动补发与失败 retry 原样重放；overflow 补发；manual 不补发、下 Run 送达。条目与 requestLog 同时断言。新增条目派生例断言有来源块缩写、伪造标签不变及持久消息不被修改。
- 原 sidecar-compaction 的 auto 与 overflow 断言把 model_request 排在 assistant 之后。父代理在集成基线 `bf5a5e8d` 独立复现 5 例中同样 2 例失败；本票只将条目顺序与下标修正为已存在的“模型请求事实先于回复”行为，完整请求与压缩断言保留。
- `rtk pnpm run typecheck`、`rtk pnpm run check:docs`（360 个 Markdown、0 问题）、受影响 TypeScript 的 `rtk pnpm exec oxlint ...`、`rtk git diff --check`：通过。首次 lint 指出条件 expect，已按上述方式修正。
- 文档影响：State Update 的压缩后送达时机、摘要缩写、压缩后的 Todo List 与测试入口归 `docs/subsystems/context.md`，已原地同步。从 AGENTS → docs/README → 正文读回，路径/语义/归属/引用方向/生命周期/入口/新会话读入/历史保留均通过；无新增目录或正式文档到任务材料的反向依赖。
- 未验证：真实 Provider 的连续 user 消息兼容性、真实模型与缓存、Electron 窗口、打包产物、CI；本票通过证明真实 Sidecar 与 faux 模型链路，不将其表述为真实 Provider 验证。
