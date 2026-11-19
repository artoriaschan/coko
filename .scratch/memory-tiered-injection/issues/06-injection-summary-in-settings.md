# 06: 设置页的注入汇总

**What to build:** 用户能在设置里看到记忆是否已经超出预算。记忆接口的列表响应增加注入汇总：用户级一组、给出 Workspace 时另有该 Workspace 一组，每组三个数——以全文注入的条数、只注入摘要的条数、未注入的条数。计算与 Memory 段使用同一套分层，口径是“此刻以这个可见范围开始一个 Run 会怎样分层”。设置的 Memory 分区在每组标题下显示一行汇总；该组没有条目时不显示，搜索状态下不显示；不给每条单独打标记。汇总跟随分区现有的项目归属：项目对话与选了项目的草稿显示两组，独立对话只有用户级。

**规格场景:** [spec](../spec.md) 的 AC-27、AC-28、AC-29；实现决定“设置页的汇总”；用户故事 21、22。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的协议、界面与验证各节；承载记忆接口类型说明的包 README 如有对应描述则同步。

**Blocked by:** 03 摘要层

**Status:** ready-for-agent

**Closed:** true

- [x] AC-27：项目的可见条目超过正文层与摘要层预算时，以项目主要 Workspace 请求列表，响应含两组的全文、仅摘要、未注入条数；每组三者之和等于该组条数，且与同一时刻发起的 Run 的请求中各层的条数一致。
- [x] 不带 Workspace 请求时只有用户级一组的汇总，按“用户级可用满两层预算”计算。
- [x] AC-28：带 `query` 或 `scope` 请求时响应没有汇总。
- [x] AC-29：桌面应用中项目对话的设置里，“用户级”与“项目：<项目名>”两组各有一行汇总；独立对话只有用户级一组的汇总；没有条目的组不显示；输入搜索词后不显示，清空后恢复。
- [x] 添加、编辑或删除条目后汇总随列表更新。
- [x] 汇总文案经 zh / en 字典提供；先读[界面约定](../../../docs/tech-stack/ui.md)并沿用设置页已有的组件与样式。
- [x] Browser Mode 测试覆盖有无项目、有无条目、搜索状态与两种语言；明暗主题下文字可读。一条真实 Sidecar 用例确认接口的汇总与请求中的实际分层一致。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19：实施完成（`mem-tiered/t06`，提交 1d99c5c8）。
  - 协议：`MemoryListResponse` 增加可选 `injection: { user, workspace? }`，每组 `MemoryTierCounts { full, summary, omitted }`（`packages/protocol/src/memory.ts`）。
  - 服务端：`memoryInjection(entries, workspaceId)`（`apps/server/src/application/context/memory.ts`）对 `MemoryService.list(workspaceId)` 的结果调用 `@coko/agent` 的 `tierMemories`，与 Memory 段的输入（`service.list(scope.memoryWorkspaceId)`）同一可见范围、同一分层函数，按作用域计数；`GET /api/memories` 只在不带 `query` 与 `scope` 时返回。
  - 桌面：`memory-store` 保存列表响应的 `injection`（检索时为 null，增删改后随 reload 更新）；`MemoryGroup` 标题下一行 `text-ui-small text-muted-foreground`，该组没有条目或有搜索词时不显示；字典 `memory.injection`（zh / en）。
  - 检查（均在 worktree 中实际运行）：
    - `pnpm exec vitest run tests/integration/sidecar-memory-injection.test.ts`：先红（`project.injection` undefined）后绿，1 passed。覆盖 AC-27（两组计数与同一时刻项目 Session 请求中各作用域的条目块 / 摘要行数一致，未注入之和等于段末条数，每组三者之和为 44）、不带 workspaceId 只有用户级且与移出项目后独立对话的请求一致、AC-28（query 与 scope 各两种组合没有 `injection`）。
    - `pnpm exec vitest run apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx apps/desktop/src/renderer/stores/memory-store.test.ts`：新增 4 条先红后绿，2 files / 10 tests passed。覆盖两组汇总、添加后更新、搜索时隐藏与清空后恢复、独立对话只有用户级、没有条目的组不显示、zh/dark 与 en/light 下文案与对比度 ≥ 4.5。
    - `pnpm exec vitest run tests/integration/sidecar-memory tests/integration/secrets-gate-memory apps/server/src`：298 passed、1 failed——`sidecar-memory.test.ts` 的“每一级内用户来源在前…”在并行负载下 `read ECONNRESET`；单独运行该文件两次均 6 passed，且 stash 掉本票改动后在基线上同样失败（297 passed / 1 failed，同一错误），与本票无关。
    - `pnpm run typecheck` 通过；`oxlint` 与 `oxfmt --check` 对改动文件无问题；`pnpm run check:docs` 0 个问题。
  - 未验证：没有在真实 Electron 窗口中做视觉检查（按规格只要求 Browser Mode，未新增 Electron E2E）；`apps/desktop/e2e/memory.e2e.test.ts` 未运行。
  - 文档影响：`docs/subsystems/memory.md` 的协议（`injection` 字段与口径）、界面（每组一行汇总及显示条件）、验证（新集成用例与 Browser Mode 用例）各节及 frontmatter 摘要；`packages/protocol/README.md` 的 `memories` 路径说明；`apps/server/README.md` 的 Memory 检索条目。
