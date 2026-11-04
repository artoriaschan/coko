# 04: 移除标题栏的交接入口

**What to build:** 交接只能用 `/handoff <下一步目标>` 发起，目标为当前目录。交接完成后，照常自动切到目标 Session 并写入摘要草稿。目标没能创建时，弹出应用级 Toast，“重试”按失败记录中的下一步目标，对当前目录重新发起交接。交接对话框和标题栏按钮删除；只在窄窗口出现的“更多操作”收起菜单一并删除。

**规格场景:** [spec](../spec.md) 的 AC-09；对应 HEAD-05。

**设计依据:** 规格本身，包括其中关于“重试”的工程决定。

**文档影响:** handoff 当前行为说明中的入口、对话框与失败反馈；Subagent 与团队文档中“没有‘更多操作’菜单项”的说法。

**Blocked by:** 03 — 标题栏改为标题行与“对话”tab 行（两票修改同一份标题栏操作列表与相关测试）

**Status:** ready-for-agent

Closed: true

- [x] 标题栏和窄窗口菜单中都没有交接入口；交接对话框与标题栏按钮已删除；时间线中的交接行不变。
- [x] `/handoff` 成功后，如果用户仍在源 Session，就切到目标 Session 并写入摘要草稿，与现有行为一致。只有订阅完成之后到达的条目才触发切换，补发的历史不触发。
- [x] 目标没能创建时，每次失败弹出一次应用级 Toast；点“重试”后，按失败条目中的下一步目标对当前目录重新发起交接。旧对话框的“复制摘要”入口随之消失，这是 spec 中已记录的后果。
- [x] 交接完成与失败的处理常驻挂载在对话区，不依赖标题栏是否渲染，也不依赖窗口宽度。
- [x] 窄主区的收起机制（菜单项与菜单关闭后执行的回调）随交接一起移除；四个状态按钮在任何宽度下都不变。
- [x] 与交接对话框有关的测试随之删除，交接的效果另有测试覆盖；交接 E2E 改走 `/handoff`。原因记入 Comments。
- [x] 同步修改 handoff、Subagent 与团队的当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。删除窄窗口的“更多操作”菜单是为了给 05 的常驻“更多”按钮让位；本票不新增菜单。交接 store、`/handoff` 与服务端接口不变。

- 2026-11-04 实施完成（基线 `12705322`，分支 `codex/status-04`）：删除交接对话框、按钮、旧窄主区菜单与关闭回调；`HandoffEffects` 常驻对话区，沿用 handoff store 的订阅完成边界、完成后草稿与条件切换。失败按源 Session 与 Run 去重 Toast，重试使用失败条目的 instructions 和 `{ kind: current }`；已离开源会话时也可重试。store 对外契约、服务接口及时间线行为保留。
- TDD：真实 App 新用例先因仍存在 `open-handoff` 按钮而失败，再移除入口并挂载常驻效果后通过。旧交接对话框 5 项与窄菜单组件 4 项测试随删除的 UI 移除，App 的 390px 用例改为断言无旧入口及右栏按钮可达；新 App 用例覆盖实时完成、历史不切换/不 Toast、失败原因与按原目标重试、离开源会话后不抢回页面。
- 检查（当前工作树、macOS、本机 Node/Vitest + headless Chromium）：`pnpm run test apps/desktop/src/renderer/features/conversation/handoff.browser.test.tsx apps/desktop/src/renderer/stores/handoff-store.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx`：3 文件 44 测试通过，退出 0；`pnpm run test apps/desktop/e2e/handoff.e2e.test.ts`：1 文件 1 测试通过，退出 0，真实后台 Electron 与 Sidecar，经 `/handoff` 确认当前 cwd、未发送摘要草稿、时间线跳转及明暗对比度；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 检查 319 Markdown、0 问题，退出 0；8 个改动 TS/TSX 文件 `pnpm exec oxfmt` 与 `pnpm exec oxlint` 退出 0。
- 文档影响与读回：更新 `docs/subsystems/handoff.md` 的入口、常驻效果、失败重试、接口与 UI 目录差异；同步 `subagents.md`、`teams.md` 的任意宽度状态按钮与 `docs/README.md` 摘要。按 AGENTS → 文档导航 → 正文读回，来源、语义、引用方向、当前入口及历史保留均通过；正式文档不依赖本任务。历史规格/票保留当时对话框描述，不改写历史。
- 未验证：真实模型摘要质量、真实指针/原生层与 agent-browser 联合视觉检查；最后一项由 09 联合验收。未推送、未合并主分支、未发布。

- 合入集成分支 `d0db1a40`（01、03、07）后，仅 `conversation-pane.tsx` 的常驻效果/状态栏 import 冲突，保留双方。重新执行 `pnpm run typecheck`、`pnpm run check:docs`（319 文件 0 问题）均退出 0；`pnpm run test apps/desktop/src/renderer/features/conversation/handoff.browser.test.tsx apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx`：3 文件 42 测试通过，退出 0，覆盖联合挂载。
