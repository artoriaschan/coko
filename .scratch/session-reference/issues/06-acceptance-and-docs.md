# 06: 验收与文档收口

**What to build:** 两件事在真实应用里端到端可用并有证据：`/` 菜单的“插件”组，以及从 `@` 菜单选择会话、提交、模型拿到记录、时间线显示 chip 并能点回去。当前行为文档、术语表与本目录的规格状态与实际交付一致。

**User stories:** 全部（验收）。

**规格：** [spec.md](../spec.md) 的 Testing Decisions 与“文档与术语”。

**Blocked by:** 01、02、03、04、05

**Status:** ready-for-agent

Closed: true

- [x] Electron E2E（后台模式）一条：在一个会话中完成一轮对话；在同一 Project 的另一个会话中经 `@` 菜单选择它并提交；faux 的请求中含前一会话的文本；时间线显示会话 chip，点击后切换到前一会话
- [x] 现有的命令与 File Reference 的 E2E 继续通过；“插件”组在 Electron 中的显示有一条断言或一次静默 CDP 截图核对
- [x] 逐条对照规格的 User Stories，列出每条由哪张票的哪项检查覆盖；没有覆盖的写明原因
- [x] 逐条对照规格 Further Notes 中补充的决定，确认实现与之相符；实施中改变了的，回写规格并说明
- [x] 术语表的 Session Reference 词条与实现一致；File Reference、Command、Plugin 词条未被改动
- [x] 当前行为文档读回核对：上下文管理、命令、插件，以及涉及回退与分叉返回文本的正文；涉及的包 README
- [x] [文档导航](../../../docs/README.md) 中相关正文的摘要仍然准确，必要时更新
- [x] `pnpm run check:docs` 通过
- [x] 按 [测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告) 记录实际运行的检查与结果；写明未验证项：真实模型拿到会话记录后的使用效果、需要真实指针或原生层的交互
- [ ] 规格的 Spec status 更新为 delivered，并记下集成分支与验收依据（2026-11-23 取消勾选：规格没有经过 approved，且含未确认的关键内容，按文档体系应为 draft；见评论“代码评审修复”的 C4）
- [x] 规格 Out of Scope 中“另行验证”的 Worktree Session 候选搜索根问题没有被本次改动波及；若实施中顺带确认了现状，写进评论

## Comments

### 2026-11-21 验收（票 06，分支 `session-reference/06-acceptance`）

**做了什么。** 在集成分支 `feat/session-reference`（`f05a0a8e`，票 01–05 已合入）上补了三处测试，没有改产品代码：

- `apps/desktop/e2e/references-drafts.e2e.test.ts` 新增“@ 会话引用”一条：一个会话完成一轮；同一 Project 的新对话草稿里输入 `@`（文件组在前、会话组在后），继续打字按标题过滤到只剩那个会话，Enter 选中后草稿里是 `@标题` 的 chip；提交后 faux requestLog 中有 `@session:<id>` 原文、带标题的 `<session_reference>` 开标签与那次会话的 `[User]:`、`[Assistant]:` 文本；气泡显示 `@标题`，侧栏占位标题不含 id；点击会话 chip 后活动会话与时间线回到被引用的会话。
- `apps/desktop/e2e/plugins.e2e.test.ts` 在插件启用后断言 `/` 菜单：`/sample:greet`（Skill）与 `/sample:hello`（命令）都在“插件”组、不在其他组，组内按名字，分组顺序为内置、项目、用户、Skill、插件、MCP 的子序列。
- `tests/integration/sidecar-session-references.test.ts` 新增 Worktree Session 一条（票 02、03 列为未验证）：首次发送带 `newWorktree` 创建的 Worktree Session 引用同一 Project 的普通会话得到记录；普通会话引用这个 Worktree Session 同样得到记录。

**User Stories 对照。** “浏览器”指 Browser Mode 测试，“集成”指真实 Sidecar 集成测试，“E2E”指 Electron 后台模式；文件名省略公共前缀。

| # | 覆盖 | 备注 |
| --- | --- | --- |
| 1 | 票 01 浏览器 `command-menu`；票 06 E2E `plugins` | |
| 2 | 同上 | E2E 断言的是保序，夹具环境里出现哪些组由环境决定 |
| 3 | 票 01 浏览器；票 06 E2E（greet 在 hello 之前） | |
| 4 | 票 01 集成 `sidecar-plugins`（`/sample:hello World` 照常展开）、浏览器 | |
| 5 | 票 01 集成（`hello`、`greet` 的来源与取舍不变） | |
| 6 | 既有 E2E `plugins`（禁用后 `/sample:hello` 消失） | |
| 7 | 票 01 浏览器；既有 E2E `commands`（分组为内置、项目、用户） | |
| 8 | 票 01 集成 `sidecar-plugins` | |
| 9、10 | 票 04 浏览器 `file-menu`；票 06 E2E | |
| 11 | 票 04 浏览器 | |
| 12、13 | 票 04 浏览器；票 06 E2E | |
| 14 | 票 04 浏览器（条目显示时间，长标题截断而时间完整） | |
| 15、17 | 票 04 浏览器（去掉过滤后 3 例失败的变异核对） | |
| 16 | 没有菜单侧的专门用例 | 会话列表不含子 Session 是既有的存储契约（`packages/session` 的契约测试）；Sidecar 侧的拒绝由票 02 集成覆盖 |
| 18 | 票 04 浏览器（另一个 Project 不出现）；票 06 集成（Worktree Session 的范围） | Worktree Session 出现在菜单里没有专门用例：过滤只看 `projectId` |
| 19 | 票 04 浏览器；票 02 集成（独立对话的范围） | |
| 20 | 票 04 浏览器 `session-reference`；票 03 集成（首次发送）；票 06 E2E | E2E 的那条就是从新对话草稿选择并首次发送 |
| 21 | 票 04 浏览器；既有 E2E `references-drafts`（只有一个会话时 `@a.t` 的第一项仍是文件） | 有可引用的会话时打开时机有变，见规格“实施中的改变”第 5 条 |
| 22 | 既有 typeahead 浏览器测试继续通过 | chip 旁的输入法组合输入没有专门用例 |
| 23 | 票 04 浏览器 `session-reference-node`；票 06 E2E | |
| 24 | 票 04 浏览器 | |
| 25 | 票 04 浏览器（节点并存）；票 03 集成（混合额度） | |
| 26 | 票 04 浏览器（切换会话、同一 localStorage 下重新挂载） | 真实进程重启只有 File Reference 节点的 E2E，会话节点没有 |
| 27 | 票 04 浏览器 | |
| 28 | 票 02 集成；票 06 E2E | |
| 29 | 票 02 集成（引用方的条目序列只有一个 `model_request`） | |
| 30 | 票 02 集成 | |
| 31、32 | 票 02 集成与纯函数 `session.test` | |
| 33、34 | 票 02 集成 | |
| 35 | 票 03 集成 | 只测了工具执行期间，模型流式生成期间没有测 |
| 36 | 票 02 集成 `secrets-gate-session-references` | |
| 37 | 票 03 集成 | |
| 38 | 票 02 集成（开标签的 `title`）；票 06 E2E | |
| 39 | 票 02 集成与纯函数 | |
| 40 | 票 02 纯函数 | 没有集成用例同时含摘要与截断 |
| 41–43 | 票 03 集成与纯函数 `expand.test` | |
| 44、45 | 票 02 集成（去掉范围条件的变异核对） | |
| 46 | 票 02 集成（不存在的 id） | 没有用“先存在后删除”的会话测，两者走同一路径（读不到会话） |
| 47 | 票 02 集成 | chip 对归档会话不可点击，见规格“实施中的改变”第 4 条 |
| 48 | 票 02 纯函数 `parse.test`；File Reference 既有集成测试继续通过 | |
| 49–51 | 票 05 浏览器 `messages`；票 06 E2E | |
| 52、53 | 票 05 浏览器 | |
| 54 | 票 05 浏览器；票 06 E2E（气泡文本精确相等） | |
| 55、56 | 票 03 集成与纯函数 `rewind.test` | 回退或分叉后输入区的实际显示没有在真实应用中确认 |
| 57 | 票 03 集成与纯函数 `compaction.test` | 自动压缩与溢出压缩路径没有单独测 |
| 58 | 分叉：票 03 集成 | 交接不成立，见规格“实施中的改变”第 1 条 |
| 59 | 票 03 集成；票 06 E2E（侧栏占位标题） | |
| 60 | 票 03 集成 `headless` | `--session` 继续时的引用没有测 |
| 61 | 票 02、03 集成与票 06 E2E 都只经文本提交 | |
| 62 | 票 02 集成（日志行只有数量与状态，不含 id、标题与内容） | |

**Further Notes 中规格补充的 12 条决定。** 逐条对照实现与测试，全部相符：1（Sidecar 判定范围）、2（范围外附说明、不存在不产生块）、3（归档不进菜单但照常附上）、4（截断时摘要优先）、6（共用额度、File Reference 的说明文本不变）、7（开标签带标题）、10（标题）、11（摘要请求缩为一行）由票 02、03 的集成或纯函数测试覆盖；8（候选取自界面列表、20 个上限、显示时间）、9（标题快照）由票 04 的浏览器测试覆盖；5（宿主合成的输入原样进入记录）只有代码阅读与纯函数测试中“只去掉四类块”的用例，没有用定时任务或 Goal Round 的真实输入测；12（不写 ADR 与设计稿）照办。实施中改变了的 5 处与各票补上的决定已回写到规格 Further Notes 新增的小节，并在 Story 58、草稿节点与时间线 chip 的条文处就地注明。

**术语与文档读回。**

- `GLOSSARY.md`：相对 `main` 只新增 Session Reference 词条（4 行），文字与规格“文档与术语”一致；File Reference、Command、Plugin 词条没有改动。词条写“同一 Project 内”，实现另允许独立对话之间互相引用，细节在上下文管理正文。
- `docs/subsystems/context.md`、`commands.md`、`plugins.md`、`workbench.md`（首条消息的标题）、`handoff.md`（不需要改）、`docs/tech-stack/ui.md`、`apps/server/README.md` 读回与实现一致。`packages/agent`、`packages/protocol` 的 README 没有列到需要同步的粒度；`packages/ui`、`packages/i18n`、`apps/desktop` 没有 README。
- 本票补的三处：上下文管理写明轮次指示器的预览显示原文 `@session:<id>`，并在“验证”中补上 E2E 的会话引用用例与 Worktree Session 的集成用例；命令与插件的“验证”补上 Electron 中“插件”组的断言。
- `docs/README.md` 中上下文管理、命令、插件、交接与桌面工作台的摘要读回仍然准确，没有改。

**Worktree Session 的候选搜索根（规格 Out of Scope）。** 本分支没有改文件候选接口、`searchWorkspaceFiles`、`ContextScope.cwd` 的计算与 renderer 传给 `@` 菜单的 `fileWorkspaceId`（对照 `main` 的 diff 核对）；`ContextScope` 只新增了 `projectId`。问题本身没有验证，现状不变。

**实际运行的检查。** 都在本 worktree，产品代码与 `feat/session-reference`（`f05a0a8e`）相同。E2E 全部是后台模式（`COKO_E2E_BACKGROUND=1`，没有设 `COKO_E2E_VISIBLE`），经 Playwright 驱动真实 Electron 与真实 Sidecar。

2026-11-23（提交前，当前工作区，以这一组为准）：

- `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/references-drafts.e2e.test.ts apps/desktop/e2e/plugins.e2e.test.ts apps/desktop/e2e/commands.e2e.test.ts`：3 个文件 7 例，6 通过、1 失败。新增的会话引用用例与带“插件”组断言的插件用例通过，命令的 2 例通过。失败的是既有用例“主输入框的系统附件选择插入 Workspace 引用”（等待 `[data-file-reference="src/a.ts"]` 30 秒超时），在 `main` 上同样失败，见下文。
- `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts`：12 例通过（含新增的 Worktree Session 一条）。
- `pnpm run typecheck`、`pnpm run lint`：退出码 0。`pnpm run check:docs`：460 个文件 0 个问题。
- `pnpm exec oxfmt --check apps packages tests docs`：报 6 个文件（`process-timeline.css` 与 `docs/ui/*.html` 5 个），与 `main` 相同；本票改动的文件没有格式问题。
- `pnpm exec vitest run packages/protocol/src/entries.test.ts scripts/source-references.test.ts`：4 例中 2 失败，与 `main` 相同（见下文）。
- `pnpm exec vitest run --project desktop-renderer`，文件为 `features/conversation/` 下的 `file-tool-details`、`terminal-details`、`mode-picker` 与 `app/right-panel-shortcuts` 的浏览器测试：27 例中 9 失败（`file-tool-details` 5、`terminal-details` 4），其余通过。

2026-11-21（同一份产品代码与测试；之后只改了文档、规格与本票评论，没有重跑）：

- 第一批 E2E：`references-drafts`、`plugins`、`commands`、`skills`、`rewind`、`titles` 六个文件 13 例，11 通过、2 失败（上面那条附件选择用例，与 `skills.e2e` 的“用户文件逐字节不变”断言：`COKO_HOME` 下的 `data/` 文件进了摘要）。
- 第二批 E2E：`first-send`、`first-send-worktree`、`compaction`、`handoff`、`chat`、`attachments`、`mcp`、`session-archive` 八个文件 16 例，15 通过、1 失败（`compaction.e2e`：期望 `first reply`，实际 `first replyUsage unavailable<时间>`）。这三条失败在 `main` 上都以同一断言失败。
- 单元：`pnpm exec vitest run packages/agent/src/context packages/agent/src/checkpoints packages/agent/src/agents packages/agent/src/entries packages/agent/src/instructions/commands packages/agent/src/extensions/plugins packages/protocol packages/i18n apps/server/src scripts`：92 个文件 796 例，794 通过、2 失败（`entries.test.ts` 与 `source-references.test.ts`）。
- 集成：`sidecar-session-references`、`secrets-gate-session-references`、`sidecar-references`、`secrets-gate-references`、`sidecar-commands`、`sidecar-plugins`、`sidecar-skills`、`sidecar-rewind`、`sidecar-checkpoints`、`sidecar-compaction`、`secrets-gate-compaction`、`sidecar-first-send`、`sidecar-first-send-worktree`、`sidecar-titles`、`secrets-gate-titles`、`sidecar-state-update-fork`、`sidecar-handoff`、`sidecar-projects`、`headless`（过滤同时选中 `secrets-gate-headless`）：20 个文件 108 例通过。
- 浏览器：`pnpm exec vitest run --project ui-browser packages/ui/src/composer`：4 个文件 24 例通过。`pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/app apps/desktop/src/renderer/features/settings`：71 个文件 559 例，525 通过、34 失败，逐例对照见下文；票 01、04、05 新增的浏览器测试文件都在通过之列。
- 变异核对（三处新增测试写出时即通过）：让带 worktree 的会话落到范围之外，Worktree Session 集成用例失败；关掉 `references.ts` 传给展开的 `resolveSession`，E2E 的会话引用用例在“请求中有 `<session_reference` 开标签”处失败；让 `command-menu.tsx` 的 `groupOf` 始终按来源分组，`plugins.e2e` 在“插件”组的断言处失败。三处随后复原，复原后重跑通过（即 11-23 的那一组）。

**基线对照。** 基线是 `main`（`e125c08a`）的临时 detached worktree，用完已移除。

| 失败 | 本分支 | `main` | 结论 |
| --- | --- | --- | --- |
| `packages/protocol/src/entries.test.ts` 1 例（期望清单缺 `plan_phase`、`state_update`、`tool_load`） | 失败 | 失败 | 既有 |
| `scripts/source-references.test.ts` 1 例（5 处票号引用，都在 auto-review 的既有测试文件里） | 失败，清单相同 | 失败 | 既有；本分支没有新增任务材料引用 |
| 浏览器 `file-tool-details` 5 例、`terminal-details` 4 例 | 失败（两次） | 失败（两次） | 既有 |
| 浏览器 `features/settings` 下 24 例（`delete-provider` 4、`fetch-models` 9、`model-catalog` 5、`thinking-levels` 4，多为 20 秒超时；`plugins-section` 1、`sections` 1） | 失败 | 同样的 24 例失败 | 既有；本分支没有改这个目录 |
| 浏览器 `right-panel-shortcuts` 1 例（20 秒超时） | 全量时失败，单独运行通过 | 全量时通过，单独运行失败 | 不稳定，两边都出现 |
| 浏览器 `mode-picker` 1 例 | 两次都通过 | 全量时失败，单独运行通过 | 不稳定，只在 `main` 上见到 |
| `oxfmt --check` 6 个文件 | 相同 | 相同 | 既有 |
| E2E `references-drafts` 的附件选择用例 | 失败（四次） | 失败 | 既有 |
| E2E `skills.e2e`、`compaction.e2e` 各 1 例 | 失败 | 同一断言失败 | 既有 |

没有只在本分支上稳定出现的失败。既有失败都没有在本票处理。

**未验证。**

- 真实模型拿到会话记录后的使用效果：没有运行真实模型，也没有自动化评估。
- 需要真实指针或原生层的交互：后台模式下的输入都是合成事件，窗口不可见；真实指针的 hover、原生标题栏与红绿灯没有验证。没有做 Electron 中的截图目检，“插件”组、会话组与两种 chip 的外观只有票 04、05 在 Browser Mode 中的目检。
- 没有运行：全量 `pnpm run test`、上述 14 个之外的 E2E 文件、发布构建的产物 E2E、evals。
- “主输入框的系统附件选择插入引用”在 Electron 中没有通过的证据（该用例在 `main` 上就失败）。
- 对照表中标出的缺口：菜单侧的子代理过滤与 Worktree Session 出现在菜单（16、18）、chip 旁的输入法（22）、会话 chip 草稿的真实进程重启（26）、流式生成期间被引用（35）、摘要与截断同时出现的集成用例（40）、先存在后删除的会话（46）、回退或分叉后输入区的实际显示（55）、自动与溢出压缩路径（57）、`--session` 继续时的引用（60）。
- 归档会话的 chip 不可点击、宿主合成的输入原样进入记录、回退文本中附件块仍返回：都只有代码阅读。

**需要产品决定、本票没有改的。**

1. 交接出的新会话不保留已附上的记录（Story 58 的后一半）。
2. 归档会话的 chip 不可点击，尽管它的引用照常附上记录。
3. 轮次指示器的提示词预览仍显示 `@session:<id>` 原文。改起来要给 `navigationTurns` 传入“未命名”文案并改它的测试，规格只要求气泡，没有动。
4. 有会话标题匹配时，`@` 之后的 Enter 由“直接发送”变为“选中会话”。
5. Reviewer 把会话引用块当作用户授权分区的一部分（与 File Reference 相同的现状）。
6. 规格没有经过 approved 就标为 delivered：票要求如此，规格头部保留了“尚未经用户逐项确认”的说明。

**备注。** 时间线的会话 chip 与侧栏的会话行都带 `data-session-id`。现有 E2E 用 `[data-session-id]` 计数会话行的用例里时间线没有会话 chip，不受影响；以后在带会话引用的时间线上写这类断言时需要加 `[aria-current]` 或限定到侧栏。

**文档影响。** `docs/subsystems/context.md`（轮次指示器的预览、验证清单两处）、`docs/subsystems/commands.md` 与 `plugins.md`（验证清单）；规格的 Spec status、Story 58 与两处条文的就地注明、Further Notes 新增四个小节。术语表、导航摘要与包 README 没有改。

### 2026-11-23 代码评审修复（分支 `session-reference/07-review-fixes`）

对象是 `feat/session-reference`（`ce8bd6c6`）相对 `main` 的代码评审发现。本次没有单独的票，记录在这里；票保持 `Closed: true`。

**逐项处理。**

| 项 | 处理 | 证据 |
| --- | --- | --- |
| A1 自动审查的信任边界 | 审查输入把会话引用块缩为一行 `[session reference attached: <标题>]`（与压缩摘要请求相同的一行），被引用会话的记录不进入 `user_authorization`；不看块的位置，以该开标签开头的文本块一律缩掉。File Reference 块不变。基础提示的宿主块清单加上 `<session_reference>`，与 `<file_reference>` 并列 | `packages/agent/src/policy/review.test.ts` 新增 1 例，修复前失败（记录原样进入 `user_messages`）、修复后通过；`tests/integration/sidecar-auto-review.test.ts` 新增 1 例（真实 Sidecar），修复前失败（审查请求含被引用会话的助手正文）、修复后通过；`packages/agent/src/engine/system-message-rebuild.test.ts` 新增清单的字面断言 |
| A2 宿主通知以 `[User]:` 进入记录 | 后台任务完成通知、后台子代理结束通知、团队消息与 Hook 上下文不进入记录；定时任务提示词与 Goal Round 继续提示保留。过滤清单取自新的 `HOST_BLOCK_TAGS`（`packages/agent/src/entries/host-input.ts`），基础提示的清单由同一个数组生成，没有第二份。字符串形态的 user message 同样过滤（此前只过滤数组形态） | `packages/agent/src/context/references/session.test.ts` 新增 1 例，修复前失败（四种标记文本都在记录里）、修复后通过 |
| A3 Secret 替换顺序 | `expandFileReferences` 增加 `redact` 选项，在转义与截断之前作用：路径与标题在转义前，文件内容在按行与字节截断前，会话记录逐条在截断前，目录列表整体。Sidecar 传入 `redactSecretValues`；成品上原有的 `redactSecretsDeep` 保留为兜底 | `packages/agent/src/context/references/expand.test.ts` 新增 3 例（带 `& < >` 的标题与路径、截断切在明文中间的会话记录、被行数上限切开的跨行明文），修复前 3 例失败、修复后通过；`tests/integration/secrets-gate-session-references.test.ts` 新增 1 例（真实 Sidecar，登记值带 `&`，出现在被引用会话的标题与文件名里），修复前开标签为 `title="p&amp;ss…"` 与 `path="p&amp;ss…"`、修复后为 `[REDACTED:secret]` |
| A4 `session:` 开头的文件路径 | `formatFileReferenceToken` 加引号。评审指的是这一处，但 `@` 菜单实际用的是 `packages/ui` 的 `formatFileReference`（ui 不依赖 protocol，独立一份），两处都改了 | `packages/protocol/src/reference-tokens.test.ts` 与 `packages/ui/src/composer/file-reference-node.browser.test.tsx` 各新增 1 例，修复前失败、修复后通过 |
| A5 单条消息超限保留开头 | 改为保留结尾：说话方标记之后一行 `[Earlier part of this message omitted to fit the session reference limit]`，再接结尾；多字节字符不切半。改动约十行。摘要自身超限仍保留开头 | `session.test.ts` 的原用例改写，修复前失败、修复后通过；`expand.test.ts` 与 `tests/integration/sidecar-session-references.test.ts` 中断言原说明文本的两处同步更新 |
| B1 块的形状与 token 规则 | 放进 `@coko/protocol`，与 `fileReferencePath` 并列，没有动 entries 的纯模块清单、架构文档与导入守卫：`packages/protocol/src/files.ts` 新增 `formatSessionReferenceOpen` / `sessionReference`；`parse.ts` 及其测试移到 `packages/protocol/src/reference-tokens.ts`（`@coko/agent` 照常再导出，调用方不变），新增 `withSessionReferenceTitles`。展开、记录、回退（`rewind.ts`）、压缩摘要请求、审查输入与 renderer 的 `timeline.ts` 都用这一份识别；`timeline.ts` 自己的 token 正则与块正则删除。顺手：`SESSION_REFERENCE_NOTES` 移到 `expand.ts` 并改用 `FILE_REFERENCE_MAX_COUNT` / `FILE_REFERENCE_MESSAGE_BYTES`（留在 `session.ts` 会与 `expand.ts` 循环导入）；`expand.ts` 与 `session.ts` 的两份 `escapeAttribute` 删除，改用 protocol 的开标签函数；两处 `withSessionTitles` 的替换逻辑合并为 `withSessionReferenceTitles`，各留一个取标题的薄封装（renderer 从块取，Sidecar 从存储取） | 类型检查通过；agent、protocol、server 的单元测试与下列集成、浏览器测试 |
| C1 归档会话的 chip | `messages.browser.test.tsx` 新增 1 例：归档前可点、归档后停用且点击不切换会话 | 通过；把 `disabled={!listed}` 临时改为 `disabled={false}` 时该例失败，已还原 |
| C2 无界面用例的标题 | 标题改为“无界面会话不属于任何 Project，另一次无界面运行的文字记录附在这条消息上”；`context.md` 的范围一节写明无界面会话按独立对话处理，可引用所有不属于任何 Project 的根 Session（不限于同一 Workspace） | `tests/integration/headless.test.ts` 通过 |
| C3 术语表 | Session Reference 词条改为“指向另一个 Session……范围是同一 Project 内的其他 Session；不属于任何 Project 的 Session 之间可以互相引用”，其他词条没有动 | `pnpm run check:docs` |
| C4 规格状态 | `Spec status` 改回 draft，写明实现所在分支、票 01–06 关闭与待用户确认的条目；本票“Spec status 更新为 delivered”取消勾选 | 读回规格头部 |
| C5 文档与规格回写 | `docs/subsystems/context.md`（模块表、加引号、替换顺序、记录取舍、单条消息截断、无界面范围、自动审查输入、验证清单）、`docs/subsystems/permissions.md`（审查输入的 `user_authorization`、验证清单）、`docs/README.md` 与 `context.md` 的摘要；规格“实施中的改变”新增第 6–10 条，原文两处就地注明 | `pnpm run check:docs`：460 个文件 0 个问题 |

**实际运行的检查。** 都在本 worktree；E2E 没有运行。

- `pnpm run typecheck`：通过。`pnpm exec oxlint`：通过。`pnpm exec oxfmt --check`（本次改动的 26 个 ts / tsx 文件）：通过。`pnpm run check:docs`：0 个问题。
- `pnpm exec vitest run --project agent --project protocol --project server`：143 个文件 2028 例，2021 通过、7 失败。其中 6 例与集成分支相同：暂存本次改动后在同一 worktree（`ce8bd6c6`）重跑这几个文件，同样的 6 例失败（`engine/host-stop.test.ts` 2、`policy/approvals.test.ts` 1、`policy/gate-hooks.test.ts` 1、`instructions/shared/shared.test.ts` 1、`packages/protocol/src/entries.test.ts` 1）。第 7 例是 `apps/server/src/adapters/pty.test.ts` 的 1 例等待超时，只在这次三个项目并行时出现；单独重跑 3 例通过，基线上也通过，本次没有改 pty。
- `pnpm exec vitest run tests/integration/sidecar-session-references.test.ts tests/integration/headless.test.ts tests/integration/secrets-gate-session-references.test.ts tests/integration/secrets-gate-references.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-base-prompt.test.ts tests/integration/sidecar-auto-review.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-checkpoints.test.ts`：10 个文件 82 例全部通过（路径过滤同时选中了 `headless-auto-review.test.ts`）。之后新增自动审查的会话引用用例，`sidecar-auto-review.test.ts` 单独重跑 27 例通过。
- `pnpm exec vitest run tests/integration/sidecar-references.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-titles.test.ts tests/integration/secrets-gate-auto-review.test.ts tests/integration/secrets-gate-compaction.test.ts tests/integration/sidecar-subagents-auto-review.test.ts`：6 个文件 31 例全部通过。
- `pnpm exec vitest run apps/desktop/src/renderer/features/conversation packages/ui/src/composer`：57 个文件 438 例，429 通过、9 失败，都是上文基线对照中的既有失败（`file-tool-details` 5、`terminal-details` 4）。
- 没有新增失败。

**没做的项与原因。**

- 清单“不要改”一节的事项都没有动。
- `packages/ui` 的 `formatFileReference` 与 protocol 的 `formatFileReferenceToken` 仍是两份：ui 不依赖任何 `@coko/*` 包，为一个函数加依赖超出最小改动；A4 两份都改了。`formatFileReferenceToken` 目前没有产品代码调用，没有删。
- `host-input.ts` 的 `escapeAttribute`（多转义 `'`）与 protocol `files.ts` 的那份转义集不同，没有合并；`timeline.ts` 的 `unescapeAttribute` 仍用于定时任务与团队消息的属性。
- 回退的引用块清单没有加附件块（评审指出与记录的清单不一致）：附件块随回退文本返回是既有行为，规格 Further Notes 已写明不在范围。

**与规格的偏离、需要用户确认的。**

- A1 与 A2 收紧了规格的字面（“Reviewer 的输入沿用 File Reference 的做法”与补充决定第 5 条），见规格“实施中的改变”第 6、7 条。
- A1 之后会话的标题仍以一行进入 `user_authorization`。标题来自用户输入或标题模型，不是被引用会话的助手正文，但它仍是另一个会话的内容；是否连标题也不给 Reviewer 没有定。
- A2 按开头的标签识别宿主块，不核对前置条目：被引用会话里用户自己输入的、以宿主标签开头的文本，以及助手以这些标签开头的文字回复，都不进入记录。
- 压缩摘要请求对会话引用块的识别改用共用的开标签识别，不再要求闭合标签；对宿主生成的块没有差别。

**未验证。** Electron E2E 没有运行（本次没有改 E2E 覆盖的交互；`references-drafts.e2e` 的会话引用用例不断言被改动的文本）。真实模型与真实 Reviewer 拿到缩成一行的会话引用后的判断质量没有评估。A4 只验证了序列化函数与解析的往返，没有在真实 `@` 菜单里选中一个名为 `session:x` 的文件。
