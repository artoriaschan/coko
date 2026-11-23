# 02: 提交 `@session:<id>` 时附上会话的文字记录

**What to build:** 用户提交的文本里写有 `@session:<id>`（此时还没有菜单，手写即可），且它指向同一 Project 的另一个根 Session 时，模型在这条消息里同时看到那次会话的文字记录：用户说过的话与助手的文字回复，压缩过的以摘要打头。范围之外的会话只得到一行说明，不存在的会话不影响提交。本票交付单个引用的完整路径；多个引用的额度、其余入口与边角在 03。

**User stories:** 28–36、38–40、44–48、62。

**规格：** [spec.md](../spec.md) 的“Session Reference 的语法”“展开”“上限”中单个引用的部分、“范围与失效”。

**Blocked by:** None（可立即开始）

**Status:** ready-for-agent

Closed: true

- [x] 术语表新增 Session Reference 词条，文字按规格的“文档与术语”
- [x] `@session:<id>` 按 File Reference 的词首规则与结尾标点规则识别；`@session:` 前缀的 token 不再作为文件路径解析，其他 `@` token 的解析不变
- [x] 展开与 File Reference 在同一步骤，位于命令展开之后；引用在同一条 user message 中追加一个 `<session_reference id="…" title="…">` 文本块，原文在块之前；没有新的条目 kind 与条目版本
- [x] 记录取被引用会话的有效上下文：被回退的消息不出现；有有效 Compaction 时以摘要打头，摘要之前的消息不出现
- [x] 用户消息只取用户提交的文本：State Update、File Reference 与 Session Reference 的块、附件块、图片不进入记录
- [x] 由命令展开的用户消息以原始调用 `/name 参数` 出现，判定方式与回退恢复原始调用相同
- [x] 助手消息只取文字回复；思考、工具调用、工具结果不进入记录
- [x] 记录中的 `@session:<id>` 与 `@path` 不再展开
- [x] 单个引用不超过 50KB：超出时保留摘要与最近的消息，从摘要之后最早的消息开始省略并注明条数；摘要自身放不下时截断并注明
- [x] 没有可附内容的会话，块中写明没有消息
- [x] 范围由 Sidecar 在展开时判定：同一 Project 的根 Session（含 Worktree Session 与已归档的）附上记录；当前会话不属于任何 Project 时，范围为其他不属于任何 Project 的根 Session
- [x] 另一个 Project 的会话、当前会话自己、子代理的会话：各附一行 `[Not attached: …]` 说明，块中没有对方的任何内容
- [x] id 不存在或会话已删除：不产生块，文本原样保留，提交照常被接受
- [x] 块在生成时替换已登记的 Secret 与 Credential 明文；用户输入的原文不变
- [x] 引用日志含会话引用的数量、各状态的数量与截断数，不含 id、标题与内容
- [x] 纯函数测试：token 的解析规则；记录序列化对各类消息的取舍；截断时摘要保留、省略条数正确
- [x] 集成测试（真实 Sidecar，faux 请求明细日志）：两轮对话的会话被引用后，请求中有其用户文本与助手文字，没有工具调用与工具结果中的标记文本；压缩过、回退过、命令消息、超过 50KB、三种范围之外、不存在的 id 各一条
- [x] Secret 的集成测试沿用现有 secrets gate 的写法，断言块中没有登记明文
- [x] File Reference 的现有集成测试继续通过，其说明文本不变
- [x] 当前行为文档同步：上下文管理新增 Session Reference 的语法、展开、单个上限与范围
- [x] 记录实际运行的检查与未验证项

## Comments

### 2026-11-21 实施完成（票 02）

- 落点：
  - 解析：`packages/agent/src/context/references/parse.ts` 的 `parseSessionReferences`；`parseFileReferences` 跳过未加引号、以 `session:` 开头的 token。
  - 记录序列化与截断：`packages/agent/src/context/references/session.ts` 的 `sessionTranscript`、`sessionReferenceBlock`、`SESSION_REFERENCE_NOTES`。
  - 展开：`packages/agent/src/context/references/expand.ts` 的 `expandFileReferences` 在同一个循环里按出现顺序处理两类 token，会话经 `resolveSession` 回调取得；结果另有 `sessionReferences`（状态与截断，供日志）。
  - 范围判定与条目读取：`apps/server/src/application/context/references.ts` 的 `resolveSession`。`ContextScope` 新增 `projectId`（`session-project.ts` 的 `projectScope` 给出，草稿作用域同样带上），`ContextContributionOptions` 新增 `sessions`（`layers.ts` 传 `store.sessions`）。
  - 命令消息的原始调用：从 `rewindTarget` 抽出 `commandInvocation`（`packages/agent/src/checkpoints/rewind.ts`），回退与记录序列化共用。
- 规格没有写明、由本票定下的文本（都在 `session.ts`，已写入上下文管理文档）：
  - 摘要行 `[Summary of the earlier conversation]: <摘要>`；空会话 `[No messages in this session.]`。
  - 省略 `[N earlier messages omitted to fit the session reference limit]`；摘要截断 `[Summary truncated to fit the session reference limit]`；最近一条消息自身超限时截断其开头并附 `[Message truncated to fit the session reference limit]`。
  - 范围外 `[Not attached: the session does not belong to the current project.]`、`[Not attached: this session cannot be referenced.]`；超限 `[Not attached: at most 10 references per message.]`、`[Not attached: references in this message exceed 200KB in total.]`。
  - 50KB 指记录正文连同说明行（不含开闭标签）；截断时为说明行预留 200 字节。
- 与规格的偏离或需要后续票留意的地方：
  - 共用额度已随统一循环落地：会话引用与文件引用共用 10 个的数量与 200KB 的合计额度，接近合计上限的会话引用按剩余额度截断。本票只为数量上限写了一条纯函数测试；合计额度没有测试，也没有集成测试，属于票 03。剩余额度小于 200 字节时记录只剩说明行，可能略超剩余额度，票 03 决定是否改为直接附超限说明。
  - 加引号的 `@"session:x"` 仍按路径解析（规格只说 `@session:` 前缀的 token）。
  - `parseFileReferences` 不再返回 `@session:` token，首条消息标题（`first-send.ts`）与标题请求的文件名列表（`session-titles.ts`）因此不再把它当作附件名，标题中保留原文 `@session:<id>`；以被引用会话的标题显示属于票 03。
  - 追加指令、首次发送与无界面运行共用同一个 `expandInput`，会话引用在这些入口上已经会展开，但本票没有为它们写测试（票 03）。
  - 记录按规格 Further Notes 5 只去掉 State Update、两种引用块、附件块与图片；`<hook-context>`、`<job-notification>` 等宿主块所在的 user message 按原样进入记录。
  - 基础系统提示中列举宿主块的句子（`packages/agent/src/engine/system-message.ts`）没有加入 `<session_reference>`：规格未要求，改动会影响每次请求的系统提示。
  - 时间线尚未处理 `<session_reference>` 块（票 05）：在那之前，带会话引用的用户消息会把块显示在气泡正文里。
- 实际运行（均在本 worktree，2026-11-21）：
  - `pnpm exec vitest run packages/agent/src/context/references/parse.test.ts`：先红（8 失败）后绿（28 通过）。
  - `pnpm exec vitest run packages/agent/src/context/references/session.test.ts`：先红（14 失败）后绿（14 通过）。
  - `pnpm exec vitest run packages/agent/src/context/references/expand.test.ts`：先红（5 失败）后绿（18 通过）。
  - `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts`：第一条用例先红（没有会话块）后绿；最终 6 通过。范围判定与 Secret 替换各做了一次临时破坏（去掉 `resolveSession` 中的范围条件、去掉 `redactSecretsDeep`），对应用例失败，随后复原。
  - `pnpm exec vitest run packages/agent/src/context packages/agent/src/checkpoints packages/agent/src/entries packages/agent/src/agents apps/server/src`：72 个文件中 70 通过、2 失败（604 通过、2 失败）。失败的是 `apps/server/src/adapters/git.test.ts` 与 `apps/server/src/application/branches.test.ts` 各一条，耗时为 5 秒与 20 秒；`pnpm exec vitest run apps/server/src/adapters/git.test.ts apps/server/src/application/branches.test.ts` 单独运行 5 通过。失败时其他 worktree 也在跑测试，按超时推断为负载所致，没有进一步定位；两个文件与本票改动无关。
  - `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts tests/integration/secrets-gate-session-references.test.ts tests/integration/sidecar-references.test.ts tests/integration/secrets-gate-references.test.ts tests/integration/sidecar-commands.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-checkpoints.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-titles.test.ts tests/integration/secrets-gate-titles.test.ts tests/integration/sidecar-projects.test.ts`：12 个文件、60 通过。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（460 个文件，0 个问题）通过；改动文件经 `oxfmt` 格式化。
- 未验证：
  - Worktree Session 作为被引用方没有测试；范围判定只看根 Session 的 `projectId` 与 `parentSessionId`，没有 worktree 分支。
  - 没有可附内容的会话只有纯函数测试，没有集成测试。
  - 被引用会话正在运行、多引用的合计额度、追加指令、首次发送、无界面运行（票 03）。
  - 没有运行全量测试、Browser Mode 测试与 Electron E2E；真实模型拿到会话记录后的使用效果没有评估。
- 文档：`GLOSSARY.md` 新增 Session Reference；`docs/subsystems/context.md` 新增“Session Reference”一节（语法、展开、上限、范围、日志）并同步结构入口、摘要与 File Reference 两处表述；`docs/README.md` 的导航摘要与 `apps/server/README.md` 的输入展开顺序同步。
