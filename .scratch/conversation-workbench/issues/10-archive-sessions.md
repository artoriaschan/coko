# 10: 归档与已归档对话

**What to build:** 会话菜单加入“归档”。归档后，会话从置顶、对话、项目列表与搜索中移出，同时取消置顶；记录、工作目录与绑定的 worktree 都保留，子智能体对话随它一起归档。会话有进行中的 Run、子代理、运行中的后台任务或启用的定时任务时不能归档，并说明是哪类工作。已归档会话拒绝新的 Run，包括定时任务触发的，后者按现有定时任务的跳过原因记录。设置中新增“已归档对话”分区，列出标题、所属项目和归档时间，可以打开、恢复或删除（删除复用 09 的确认与操作）。打开已归档的会话时只读，输入区换成“恢复后可继续”的提示。恢复后会话按项目归属回到原分类，不恢复置顶。重启时上次打开的会话已归档，则打开新对话。

- 行为依据：[规格](../spec.md) CHAT-16、第 14 节“归档被拒绝”、STATE-01 的已归档情形、17.2 会话操作。

**User stories:** 31、33（归档部分）

**Blocked by:** 08、09

**Status:** ready-for-agent

**Write scope:** apps/server 的归档、恢复与已归档列表，提交与定时任务触发对已归档会话的拒绝；packages/protocol；renderer 的菜单项、只读提示与设置分区（分区注册表新增一行）；i18n；projects.md 的归档一节；`docs/subsystems/schedules.md` 的跳过原因。

**跨票接口：** 拒绝归档使用 09 约定的 `session-busy`，reasons 可含 schedule；已归档会话被拒绝提交时使用本票定义的新错误码；会话列表默认不含已归档会话，22 的搜索因此不会出现它们。

- [ ] Sidecar 协议：归档后默认列表不含它、已归档列表含它，置顶时间被清空，子会话随之归档；有进行中的 Run、子代理、运行中的 Job 或启用的定时任务时返回 `session-busy` 且原因可区分；已归档会话的提交被拒绝，定时任务到点时被跳过并记录原因；恢复后回到原项目、不恢复置顶。
- [ ] Browser Mode：菜单项的位置；已归档会话只读、输入区显示提示；设置分区的列表与打开、恢复、删除；恢复后回到原分类（CW-60、CW-61）。
- [ ] Electron E2E：归档一个对话，从设置中打开（只读）并恢复，它回到原项目；归档当前对话后重启，打开的是新对话。
- [ ] 文档按 Write scope 更新；`check:docs` 通过。


## Comments

- 2026-11-03：按 tdd、coko-verify、coko-docs 与 incumbent UI 规范完成归档/恢复。原子仓库操作修改完整树并清空置顶；HTTP 默认只列未归档根，显式 `?archived=true` 列归档根。原始仓库根枚举不加过滤，保留 BranchService、worktree 与项目操作的占用检查。
- SessionLifecycle 屏障复用删除的统一准入，先检查 run/agent/job/schedule，再在 Schedule 锁内复查后提交；active Job 必须直接拒绝，不先等待其结束。初版 busy 用例超时暴露了错误顺序，已修正。所有 Run 来源及命令展开前的提交拒绝归档会话，错误 `session-archived`。Schema、agent payload 与 zh/en 定时跳过原因同步；外部恢复启用的归档 Schedule 到期只记 skipped，不请求模型。
- renderer 独立保存 archivedSessions，useCurrentSession 同时查询两份集合。当前归档会话保持只读且编辑器不卸载；Browser 验证文字、图片草稿在归档/设置跳转/恢复后仍存在。从设置直接打开归档不受普通历史可达性限制；前进后退和重启恢复仍只查普通列表。
- 设置分区支持标题、项目、本地化归档时间、打开/恢复/删除，删除复用 09 SessionDeleteDialog。加载失败重试、恢复失败留存、中文 busy 类别说明均有 Browser 覆盖。SessionArchiveMenuItem 对普通行与搜索复用同一入口和 Toast，保留菜单规定顺序。
- 并发：较旧普通/归档快照不能清除刷新期间新增归档或恢复的 DTO；归档前启动的列表、置顶、改名响应只更新其拥有的字段，不复活归档/置顶元数据。归档取消正在生成的标题并收尾，后续受控时钟推进也不能写入迟到标题或 title model_request。
- TDD red：`pnpm run test tests/integration/sidecar-archive-session.test.ts` 初始1例失败（archive404）；最小实现后1例通过。另 `pnpm run test apps/desktop/src/renderer/stores/chat-store-archive.test.ts` 的恢复期间旧列表用例先失败（恢复会话丢失），加入 mutation revision 保留后通过。没有为本票修改全量测试配置。
- 验证：`pnpm run test tests/integration/sidecar-archive-session.test.ts apps/server/src/application/session-archive.test.ts tests/integration/sidecar-schedules.test.ts tests/integration/sidecar-titles.test.ts packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts apps/desktop/src/renderer/features/settings/archived.browser.test.tsx apps/desktop/src/renderer/stores/chat-store-archive.test.ts apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx`：9文件139例通过。随后增加工作树与重启保留、归档根的分支占用回归，`pnpm run test tests/integration/sidecar-archive-session.test.ts tests/integration/sidecar-branches.test.ts`：2文件8例通过。
- 真实 Electron：`pnpm run test apps/desktop/e2e/session-archive.e2e.test.ts` 从当前源码构建1例通过，真实设置打开只读、恢复回原项目，再归档当前会话并重启进入新对话；文件内容保持。截图 `/tmp/coko-archive-readonly-e2e.png` 已查看。随后会合并最新集成分支并复核所影响检查。
- 文档：projects.md 原地补归档/恢复、DTO 分离和准入语义；schedules.md 同步跳过原因顺序与验证；docs/README 摘要同步。正式正文不依赖任务材料。菜单图标既有 Browser 断言由4项更新为5项，因为归档插入规定位置，几何断言不放宽。typecheck 已退出0，变更文件格式/lint 与 docs 最终结果待合并后追加。
