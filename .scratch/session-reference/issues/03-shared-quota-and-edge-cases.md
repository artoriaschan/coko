# 03: 共用额度、其余入口与引用块的善后

**What to build:** 一条消息里混用文件引用与多个会话引用时，它们共用 10 个与 200KB 的额度，超出的各有一行说明。追加指令、首次发送与无界面运行里的会话引用同样生效；引用一个正在运行的会话不被阻塞。回退或分叉到带引用的消息时，回到输入区的只有用户当时输入的文本；带引用的消息被压缩时，摘要请求里不含被引用会话的记录。

**User stories:** 25、35、37、41–43、55–60。

**规格：** [spec.md](../spec.md) 的“上限”中共用额度的部分、“展开”的入口、“已对 File Reference 块做特殊处理的位置”。

**Blocked by:** 02

**Status:** ready-for-agent

Closed: true

- [x] 文件引用与会话引用按在文本中出现的顺序共用每条消息 10 个的上限；第 11 个及之后的会话引用附一行说明
- [x] 两者共用合计 200KB 的额度；接近上限的那个会话引用按剩余额度截断，额度用尽后的会话引用附一行说明
- [x] 范围之外的说明块计入数量上限，不计入字节额度
- [x] File Reference 已有的说明文本与其现有测试不变
- [x] 同一个会话在一条消息里只附一次
- [x] Run 进行中的追加指令、首次发送、无界面运行的提示词中的会话引用按同样的规则展开；首次发送按新建 Session 所属的 Project 判定范围
- [x] 被引用会话正在运行时，提交不等待，块中只有已提交的条目
- [x] 先在真实 Sidecar 上确认现状：回退与分叉到带 File Reference 的消息时返回文本是否含引用块（规格的 Further Notes 记有纯函数层面的探针结果），把确认结果写进本票评论
- [x] 回退与分叉返回的文本不含 File Reference 与 Session Reference 的块，只含用户当时输入的文本；命令消息仍返回原始调用
- [x] 回到输入区的 `@session:<id>` 再次提交仍然展开
- [x] 压缩摘要请求的对话序列化把会话引用块缩为一行，写明被引用会话的标题
- [x] 首条消息的自动标题与由消息文本派生的标题中，`@session:<id>` 以被引用会话的标题显示
- [x] 逐一核对其他对 File Reference 块做特殊处理或从用户消息提取文本的位置（如 Reviewer 的输入、分叉与交接复制的消息），在本票评论中列出核对过的位置与各自的处理
- [x] 分叉或交接出的新会话保留消息中已附上的记录
- [x] 集成测试（真实 Sidecar）：文件与会话混合超过 10 个、合计超过 200KB；追加指令与首次发送中的引用；被引用会话运行中；回退与分叉到带两种引用的消息；带会话引用的消息进入压缩时摘要请求中没有记录正文
- [x] 当前行为文档同步：上下文管理（共用额度、入口）、命令或 Checkpoint 相关正文中关于返回文本的说明
- [x] 记录实际运行的检查与未验证项

## Comments

### 2026-11-21 实施完成（票 03）

- 真实 Sidecar 上的现状确认（修改之前，`tests/integration/sidecar-session-references.test.ts` 的“回退与分叉到带两种引用的消息”用例先红，并临时打印返回值）：
  - `GET /api/sessions/:id/checkpoints` 的 `text`、`POST …/fork` 与 `POST …/rewind` 的 `text` 都是原文之后接整个引用块。例：`"再看 @session:<id> 和 @src/a.ts\n<session_reference id=… title=\"方案\">\n[User]: A-MESSAGE\n\n[Assistant]: A-REPLY\n</session_reference>\n<file_reference path=\"src/a.ts\">\nFILE-MARK\n\n</file_reference>"`。File Reference 与 Session Reference 的块同样返回，规格 Further Notes 的探针结果在真实 Sidecar 上成立。
  - 由命令展开的消息在修改之前就返回原始调用（`/explain @session:<id>`），不含块。
  - renderer 的 `chat-store.ts` 把返回的 `text` 直接作为回到输入区的草稿（代码阅读，没有在真实应用中操作确认）。
- 落点：
  - 回退、分叉与 Checkpoint 列表的文本：`packages/agent/src/checkpoints/rewind.ts` 的 `userMessageText`。第一个文本块是用户输入的文本，其后以 `<file_reference path="` 或 `<session_reference id="` 开头的文本块不返回；用户自己输入的同样开头的文本（位于第一个文本块）保留。`planRewind`、`forkEntries` 与 `SessionCheckpoints.list` 都经它取文本，一处修改。
  - 压缩摘要请求：`packages/agent/src/context/compaction/prompt.ts` 把 `<session_reference>` 块缩为 `[session reference attached: <标题>]`（标题还原属性转义）。
  - 标题：`apps/server/src/application/first-send.ts` 新增 `withSessionTitles`，把 `@session:<id>` 换成 `@<被引用会话的标题>`（会话不存在时保留原文）；`firstMessageTitle` 的首行与 `SessionTitles.start` 发给模型的 `text` 用换过的文本，文件引用与 `filenames` 仍按原文解析。
  - 剩余额度不足：`packages/agent/src/context/references/expand.ts`，见下一条。
- 票 02 留下的定夺——剩余额度不足 200 字节时：完整记录放得下的照常附上；放不下（记录会被截断）且剩余额度小于截断说明行的预留（`NOTICE_RESERVE`，200 字节）时，附 `[Not attached: references in this message exceed 200KB in total.]`，状态记 `skipped`。原先这种情况会附一个只有 `[N earlier messages omitted …]` 的块，并可能略超额度；现在附上的内容合计不超过 200KB。剩余额度不少于 200 字节时仍按剩余额度截断（可能只留下最近一条消息的开头）。
- 已落地、本票只补测试确认的行为：10 个的数量上限与说明、200KB 的合计额度与按剩余截断、说明块计入数量不计字节、同一会话只附一次、追加指令 / 首次发送 / 无界面运行的展开、首次发送按新建 Session 的 Project 判定、被引用会话运行中只取已提交条目、分叉复制的消息保留块。为确认这些新增用例有效，临时关闭 `references.ts` 传给展开的 `resolveSession` 后，新增的 6 条集成用例（`headless.test.ts` 1 条、`sidecar-session-references.test.ts` 5 条）全部失败，随后复原；“说明块不占字节额度”的纯函数用例另做了一次临时破坏（让说明块扣减额度）确认失败后复原。
- 逐一核对的位置（除标注“已测”的以外均为代码阅读）：
  - 回退、分叉返回的文本与 Checkpoint 列表（`rewind.ts`、`agents/fork.ts`、`checkpoints.ts`）：本票修改，两种块都不返回。已测。
  - 分叉复制的消息（`agents/fork.ts` 的 `forkEntries`）：`message` 条目的 payload 原样复制，块保留，不重新读取被引用会话。已测。未改。
  - 交接（`agents/handoff.ts`、`application/handoff.ts`）：目标 Session 只复制权限条目，不复制任何消息（File Reference 的块同样不复制）；摘要请求使用源会话的有效上下文，其中的引用块原样在（已测）。目标标题取 `/handoff` 指令的首行，指令不经引用展开，其中的 `@session:<id>` 不换成标题。未改。
  - 压缩摘要请求的序列化（`compaction/prompt.ts`）：本票修改。已测（纯函数与真实 Sidecar 的 `/compact`）。自动压缩与溢出压缩共用同一序列化，没有单独测试。
  - 首条消息的占位标题与标题请求（`first-send.ts`、`session-titles.ts`）：本票修改。已测。
  - 被引用会话的记录序列化（`references/session.ts`）：票 02 已去掉两种引用块、附件块与 State Update。未改。
  - Reviewer 的输入（`policy/review.ts` 的 `messageText`）：只去掉配对的 State Update、末尾的 Hook 上下文与宿主通知块；File Reference 的块作为用户消息文本的一部分进入 `user_authorization`（受单项上限截断）。会话引用块按规格“沿用各自对 File Reference 块的做法”同样进入，未改。这意味着被引用会话中助手的文字会出现在 Reviewer 视为用户授权的分区里，与文件内容出现在那里是同一个现状，建议另行评估。
  - 未送达的追加指令退回输入区（`run_end.undeliveredSteering`）：取 `RunInput.text`（用户输入的文本），不含块。未改。
  - UserPromptSubmit Hook（`session-runs.ts` 的 `beforeSubmit`）：收到的是用户输入的原文，不含块。未改。
  - 上下文用量（`application/context/usage.ts`）：引用块随 user message 计入 `prompt`，两种块相同。未改。
  - Goal 的输入判定（`goals.ts`、`goals/state.ts`）、附件复制（`attachments.ts`）、Checkpoint 锚点（`checkpoints/tracker.ts`）、压缩后的 State Update 补发（`compaction/plan.ts`）：只看角色、配对的 State Update 或附件块，不读引用块的文本。未改。
  - 基础系统提示列举宿主块的句子（`engine/system-message.ts`）：没有 `<session_reference>`，沿用票 02 的决定。未改。
  - 时间线（renderer）：票 05。
- 与规格的偏离或需要留意的地方：
  - “分叉或交接出的新会话保留消息中已附上的记录”：分叉成立；交接出的新会话按既有设计没有任何复制的消息，记录只经摘要请求进入交接摘要。本票没有改变交接的设计。
  - 回退与分叉的返回文本只去掉两种引用块。附件块（`<coko_attachment>…`）是同一条 user message 中的文本块，按 `userMessageText` 的实现仍会随文本返回（代码阅读，未在真实 Sidecar 上确认）；票的范围只有两种引用块，未处理。
  - 标题用 `@<标题>`（与时间线气泡的显示一致）。只含一个会话引用的首条消息，占位标题就是 `@<标题>`，不走 File Reference 的“附件：…”形式。范围之外但存在的会话（另一个 Project、子代理）同样以其标题显示：说明块本身已带标题。
  - 回到输入区后再次提交附上的是再次提交那一刻的记录，不是原来那一份。
- 实际运行（均在本 worktree，2026-11-21）：
  - `pnpm exec vitest run packages/agent/src/context/references/expand.test.ts`：新增“共用合计 200KB”用例先红（最后一个会话为 `attached`、只有省略说明）后绿；最终 20 通过。
  - `pnpm exec vitest run packages/agent/src/checkpoints/rewind.test.ts`：新增用例先红（返回文本含两种块）后绿；20 通过。
  - `pnpm exec vitest run packages/agent/src/context/compaction/compaction.test.ts`：新增用例先红后绿；18 通过。
  - `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts -t "引用块的善后"`：先红（见上文现状）后绿；`-t "进入压缩"` 在临时去掉 `prompt.ts` 的分支时失败，复原后通过；`-t "其余展开入口"` 的首次发送用例先红（标题请求中的文本为 `@session:<id>`）后绿。
  - `pnpm exec vitest run packages/agent/src/context packages/agent/src/checkpoints packages/agent/src/agents apps/server/src/application/context`：20 个文件、300 通过。
  - `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts tests/integration/secrets-gate-session-references.test.ts tests/integration/sidecar-references.test.ts tests/integration/secrets-gate-references.test.ts tests/integration/sidecar-commands.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-checkpoints.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/secrets-gate-compaction.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-first-send-worktree.test.ts tests/integration/sidecar-titles.test.ts tests/integration/secrets-gate-titles.test.ts tests/integration/sidecar-state-update-fork.test.ts tests/integration/sidecar-handoff.test.ts tests/integration/headless.test.ts tests/integration/secrets-gate-headless.test.ts`：17 个文件、95 通过。File Reference 的现有用例与说明文本没有改动。
  - `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（460 个文件，0 个问题）通过。`pnpm exec oxfmt --check apps packages tests docs` 报 6 个文件（`process-timeline.css` 与 `docs/ui/*.html`），暂存本票改动后结果相同，与本票无关；本票改动的文件已格式化。
  - 合并 `feat/session-reference`（已含票 04、05）之后：`docs/subsystems/context.md` 的摘要行有一处冲突，两侧的表述合并保留。重跑 `pnpm run check:docs`、`pnpm run typecheck`、`pnpm run lint` 通过；上面的单元测试命令 20 个文件、300 通过；`pnpm exec vitest run tests/integration/sidecar-session-references.test.ts tests/integration/secrets-gate-session-references.test.ts tests/integration/sidecar-references.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-checkpoints.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-titles.test.ts tests/integration/sidecar-handoff.test.ts tests/integration/headless.test.ts`：11 个文件（`headless.test.ts` 的过滤同时选中 `secrets-gate-headless.test.ts`）、81 通过。合并进来的 renderer 改动的 Browser Mode 测试没有重跑。
- 未验证：
  - 没有运行全量测试、`apps/server/src` 的其余单元测试、Browser Mode 测试与 Electron E2E。回退或分叉后输入区的实际显示没有在真实应用中确认。
  - 被引用会话运行中只测了工具执行期间（助手消息已提交、工具结果未提交）；模型流式生成期间没有测试。
  - 无界面运行只测了新会话引用同一 Workspace 的另一次运行；`--session` 继续时的引用没有测试。
  - 首次发送带 `newWorktree` 时的范围、Worktree Session 作为被引用方没有测试。
  - 自动压缩与溢出压缩路径上的摘要请求没有单独测试。
  - 真实模型拿到会话记录后的使用效果没有评估。
- 文档：`docs/subsystems/context.md`（展开入口、剩余额度不足时的说明、新增“回退、分叉、压缩与标题”小节、摘要请求的缩写、测试清单与摘要）、`docs/subsystems/commands.md`（返回文本不含引用块）、`docs/subsystems/workbench.md`（首条消息的标题）、`docs/README.md` 的导航摘要。
