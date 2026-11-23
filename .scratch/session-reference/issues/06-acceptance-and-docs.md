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
- [x] 规格的 Spec status 更新为 delivered，并记下集成分支与验收依据
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
