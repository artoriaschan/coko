# 06: 接口校验与设置分区按项目分组

**What to build:** 设置里的 Memory 分区和实际生效的范围一致。打开项目对话的设置时，分区显示“用户级”与“项目：<项目名>”两组，在项目组里添加、检索、编辑和删除的都是这个项目的项目记忆，添加的条目会出现在同项目其他对话的下一个 Run 中。打开独立对话的设置时只显示“用户级”一组，没有项目组和它的添加入口。服务端同时保证不会再产生挂在非项目文件夹上的项目记忆：新建 Workspace 作用域的条目时，目标必须是某个现存项目的主要文件夹，否则返回 400；读取、修改与删除已有条目不受限，用户仍可以清理遗留条目。

**规格场景:** [spec](../spec.md) 的 AC-25、AC-26、AC-27；实现决定“服务与接口”“界面”；用户故事 28。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的协议与界面两节；承载记忆接口说明的包 README 如有对应描述则同步。

**Blocked by:** 05 项目归属：Run 的项目记忆与工具作用域

**Status:** ready-for-agent

- [ ] AC-25：经接口向一个不是任何项目主要 Workspace 的 Workspace 创建 Workspace 作用域的条目，返回 400 且没有新增条目；向项目的主要 Workspace 创建返回 201。校验在服务层，工具端口与 HTTP 接口共用。
- [ ] 读取、修改正文与删除已有条目的接口对任何已存在的条目照常可用。
- [ ] AC-26：桌面应用中打开项目对话的设置，Memory 分区显示“用户级”与“项目：<项目名>”两组；在项目组添加的条目出现在同项目其他对话的下一个 Run 中；从别处移入该项目的对话看到同一个项目组。
- [ ] AC-27：打开独立对话的设置，Memory 分区只有“用户级”一组；没有会话时的提示沿用现状。
- [ ] 新对话草稿选择了项目时，分区按所选项目显示项目组。
- [ ] 检索框在两组下都按当前范围检索，结果仍按两组显示。
- [ ] 分组标题与相关文案经 zh / en 字典提供；先读[界面约定](../../../docs/tech-stack/ui.md)并沿用设置页已有的组件与样式。
- [ ] Browser Mode 测试覆盖有项目与无项目两种分组、添加入口与文案；明暗主题下文字可读。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19 实施：`MemoryService.create` 新建 Workspace 作用域的条目时要求目标是某个现存 Project 的 `primaryWorkspaceId`，否则 `bad-request`（HTTP 400，工具端口为工具错误）；`MemoryStore` 增加 `projects.list`。读取、改正文与删除不受限。设置的 Memory 分区按当前会话（草稿为所选项目）的 `projectId` 找到 Project，项目组标题为“项目：<项目名>”，列表、检索、添加、编辑与删除都带该 Project 的主要 Workspace；独立对话只有用户级一组且没有项目组的添加入口；没有会话且草稿没有选项目时沿用提示（文案改为“打开一个项目对话后可管理该项目的记忆”）。记忆开关读写的配置仍按活动 Workspace。字典 `memory.workspace` / `memory.noWorkspace` 改为 `memory.project` / `memory.noProject`，分区说明改为项目记忆的措辞。
- 检查：`sidecar-memory.test.ts` 的 `/api/memories` 用例加 AC-25（删除 w2 的项目后新建其 Workspace 条目 400、列表不变，已有条目仍可改；实现前先确认失败）；`memory-section.browser.test.tsx` 新增项目对话两组与项目组添加 / 检索请求、独立对话只有用户级且只有一个添加入口、选了项目的草稿与没有项目的草稿提示、zh 暗色与 en 亮色下分组标题的字典文案与对比度 ≥ 4.5（实现前 5 例失败）；`apps/desktop/e2e/memory.e2e.test.ts` 加项目组标题“Project: Example project”的断言，以 `COKO_E2E_BACKGROUND=1` 在真实 Electron 中通过（2 例）。运行：integration 的 sidecar-memory、sidecar-memory-projects、sidecar-memory-search、secrets-gate-memory(-search)、sidecar-delete-project、sidecar-worktrees、sidecar-subagents-permissions、headless（10 个文件 44 例通过；并行时 sidecar-delete-project 曾超时一次，单独与复跑均通过）；`apps/server/src/application/context` 与 `memory-store.test.ts` 单测通过；`pnpm typecheck`、`pnpm check:docs`、oxlint、oxfmt 通过。设置目录下其他 Browser Mode 文件（sections、plugins-section、delete-provider、thinking-levels、model-catalog、fetch-models）有与本票无关的失败（`window.coko?.onMenuClose`、右栏 tab 列表与 20 s 超时），未处理、未在基线上复核。
- 交互验证：分组、添加与检索在 Browser Mode（真实 Chromium）与后台模式 Electron E2E（经 CDP/Playwright，不抢前台）中验证；未用 agent-browser 另做手动会话。未验证：需要真实指针或原生层的交互（本票不涉及）；“在项目组添加的条目出现在同项目其他对话的下一个 Run 中”由服务端已有用例（sidecar-memory 同项目新 Session 的注入）与 E2E 的写入链路间接覆盖，没有单独的桌面端到端用例。
- 文档影响：`docs/subsystems/memory.md` 的条目与作用域（新建限制）、协议（POST 的 400）、界面（按项目归属分组）与验证；包 README 没有对应的创建规则描述，未改。

Closed: true
