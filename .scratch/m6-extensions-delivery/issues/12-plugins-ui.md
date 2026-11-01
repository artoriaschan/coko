# 12: 插件界面：设置 → 插件分区、安装、批准对话框、启用 / 更新 / 卸载

**What to build:** 见 [规格](../spec.md)"插件"与 [grilling B6](../grilling.md#第-4-轮)：renderer `plugins-store`（经 `requestJson`）、设置 → 插件分区（注册表 `plugins` 一行改为可用）：安装（目录选择经现有的目录选择 IPC，或 git URL 与可选 ref）、列表（名字、版本、来源与 commit、状态、贡献计数、诊断）、批准对话框（每条 Hook 的事件 / matcher / 完整命令，每个 MCP / LSP Server 的命令、参数、地址与 env 键；Skills / 命令 / 子代理的名字）、启用开关、更新（digest 变化时提示重新批准）、卸载（确认框）。参考 DSH `client/ui-settings` 的列表与 `ui-cordis` 的扩展详情。

**User stories:** 1, 2, 3（界面）

**Blocked by:** 04

**Status:** ready-for-agent

**Write scope:** renderer `features/settings/{plugins-section.tsx（新）,plugin-approval-dialog.tsx（新）,sections.ts（只改 plugins 一行）}`、`stores/plugins-store.ts`（新）、`packages/i18n/src/dictionaries/domains/plugins.ts`、就近测试、`apps/desktop/e2e/plugins.e2e.test.ts`（新）、`docs/subsystems/plugins.md`（界面一节）、`docs/adr/0017-plugins-declarative-user-installed.md`（改 implemented）、`docs/adr/README.md`（0017 一行）

**跨票接口：** 使用 04 的 `GET / POST / PATCH / DELETE /api/plugins` 与 `PluginView`，不改服务端。

- [x] Browser Mode：列表的五种状态与诊断；批准对话框显示全部命令（长命令换行、不截断）且只有"批准"后才发 approve；卸载确认；store 的错误体按 `ErrorResponse` 校验
- [x] E2E（真实 Electron 与 Sidecar）：从夹具目录安装 → 待批准 → 打开对话框看到 Hook 的完整命令 → 批准 → 启用；新会话的 `/` 命令菜单出现 `sample:hello`；禁用后消失；更新夹具副本的 Hook 命令后"更新"→ 回到待批准；卸载后列表为空；明暗主题对比度与键盘操作（Tab 到批准按钮、Esc 关闭对话框）
- [x] plugins.md 界面一节；ADR 0017 改 implemented（链接 04 与本票的证据），README 索引同步；docs/README 一行（若 04 未加）；`check:docs` 通过

## Comments

### 实施回执（票 12，2026-11-01）

**覆盖的验收**

- Browser Mode（`apps/desktop/src/renderer/features/settings/plugins-section.browser.test.tsx`，6 例）：五种状态、来源与 commit、贡献计数、诊断（按 code 本地化），明暗主题下状态文字对比度 ≥ 4.5；批准对话框显示全部 Hook / MCP / LSP 命令与资源名，长命令换行不截断（`scrollWidth ≤ clientWidth`），取消与 Esc 不发 approve，Tab 到"批准"（:focus-visible）后 Enter 才发 approve；409 digest-mismatch 时对话框不关闭、提示已变化并换成最新命令，用新 digest 再批准；开关 PATCH、更新回到待批准并提示、卸载确认（取消不发 DELETE）；文件夹（`window.coko.pickDirectory`）与 git + ref 安装、plugin-invalid 诊断行内显示、不合规错误体显示通用提示。
- store（`apps/desktop/src/renderer/stores/plugins-store.test.ts`，3 例）：六个接口经 `requestJson`，错误体按 `ErrorResponse` 校验（缺 message 的错误体与不符 `PluginInfo` 的 200 都为 `bad-response`），digest-mismatch 后读回。
- E2E（`apps/desktop/e2e/plugins.e2e.test.ts`，1 例）：夹具副本（占位替换）经目录选择安装 → 待批准 → 对话框中 Hook 完整命令 → Esc 不批准 → Tab + Enter 批准 → 启用；新会话 `/` 菜单出现 `/sample:hello`，禁用后消失；改副本 Hook 命令后"更新"回到待批准、对话框显示新命令；明暗主题对比度；卸载后列表为空、`<COKO_HOME>/plugins/sample` 被删除、`GET /api/plugins` 为 []。
- 文档：`docs/subsystems/plugins.md` 新增"界面"一节、结构入口与验证；ADR 0017 改 implemented 并补实施记录；`docs/adr/README.md` 0017 一行同步。

**实际运行的命令与结果**

- `pnpm exec vitest run apps/desktop/src/renderer/stores/plugins-store.test.ts`：3 passed（先红：模块不存在）。
- `pnpm exec vitest run --project desktop-renderer …/plugins-section.browser.test.tsx`：6 passed。
- `pnpm exec vitest run apps/desktop/src/renderer/features/settings/{sections,settings-page}.browser.test.tsx packages/i18n packages/ui/src/guards scripts/browser-deps.test.ts scripts/source-references.test.ts`：合并 main 前 77 个中 76 通过，样式守卫因 JSX 字符串属性中的文案键失败，改为传入已翻译文本后 40/40 通过。
- `pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/plugins.e2e.test.ts`：1 passed（单独运行，以及合并 main 后与 config、run-control 同跑共 6 passed）。
- `pnpm run typecheck`：0；`oxfmt --check` 与 `oxlint`（改动文件）：0；`pnpm run check:docs`：0（212 个文件，0 个问题）。
- 全量 `pnpm run test`（锁内后台，日志在本 worktree 的 `.scratch/m6-extensions-delivery/runs/`，未提交）：
  1. 合并 main 前（HEAD ee8b66c，开始时负载 49，期间 188）：test=1，2738 个中 1 failed：`packages/agent/src/tasks/schedules/schedules.test.ts` 中一例 5000 ms 超时（CPU 密集用例）；单独重跑 85/85 通过（该例 745 ms）。
  2. 合并 main 后（HEAD 6f0c0d9）：test=1，33 failed，全部在未改动的 integration / server / session / e2e 文件，日志中 18 处 `spawn … EAGAIN`；17 个非 E2E 文件单独重跑 135/135 通过，config、run-control、plugins 三个 E2E 文件重跑 6/6 通过。
  3. 再次全量（6f0c0d9，负载 18）：test=1，只跑完 1269 个用例，21 failed；342 处 EAGAIN、167 处 `Worker forks emitted error`。逐个文件重跑时，10 个文件中 9 个通过，`sidecar-worktrees.test.ts` 仍有 2 例失败，原因为 `spawn git EAGAIN`；之后连 pnpm 也无法启动（`ERR_PNPM_CLI_EXEC_SPAWN`）。
- **EAGAIN 的原因**：本机 uid 下有 2239 个孤儿进程 `/Users/chenzheng/.git-ai/bin/git-ai bg run`（ppid 1，约 22 小时），`kern.maxprocperuid` 为 2666，用户进程数到达 2666。PATH 中的 `git` 是 `~/.git-ai/bin/git` 包装。这些进程不是本票启动的，本票没有终止它们。本票改动只在 renderer、e2e、i18n 与 docs，server、agent、session 都不依赖 `@coko/i18n`。

**负向确认（变异）**：批准对话框的"取消"改为调用 approve 时，对话框用例与安装用例失败；命令改为 `truncate` 时失败（2045 > 319）；去掉"已变化"提示时 409 用例失败。store 测试先红。

**实现说明**

- `--destructive` 用于小号文字时对卡片背景的对比度为 4.50（浅色）与 4.24（深色），低于 4.5。因此不兼容与无效改为前景色文字，加破坏性颜色的图标（对比度 ≥ 3:1）。没有新增 token。
- 批准对话框记住打开时的 digest。之后读回的内容 digest 不同时显示"已变化"，"批准"总是发当前显示内容的 digest。初始焦点在"取消"。
- 目录选择：分区通过 `window.coko.pickDirectory` 调用现有 IPC，不改 preload 或 bridge。

**未验证**：真实 git 远程（https）安装经界面（E2E 只覆盖目录来源；git 表单由 Browser Mode 断言请求体）；非 darwin 平台；合并 main 后的全量没有干净通过（见上，受本机进程数上限阻碍）。

**越出写范围的改动**：`apps/desktop/src/renderer/features/settings/sections.browser.test.tsx`。plugins 分区变为可见，该测试原先断言插件分区不可见、菜单与 Tab 顺序不含 plugins，因此一并更新。合并 main 时与票 05 的 lsp 改动冲突，已合并为两者都可见，并更正文件头注释。

**需要 Lead 处理**：`docs/README.md` 第 46 行（票 04 加的插件一行）建议在末尾补"设置中的插件分区与批准对话框"，本票没有改它。没有新增导出。不新增读取根、注入点或外发通道：界面只调用票 04 的 `/api/plugins`，秘密总闸与符号链接用例不适用。

### Lead 合入（2026-11-01）

- 阻塞解除：git-ai 后台进程泄漏已修复（m6/fix-git-ai-leak，295cb69）。
- 裁决：越出写范围的 `sections.browser.test.tsx` 接受。"不兼容"与"无效"状态使用前景色文字加破坏性颜色图标，接受，与票 10 关于页的做法一致；共用 token 的对比度由票 14 复核。
- lead 在分支上复核（03d2751，负载最高 23，git-ai 后台进程始终 1 个）：`pnpm install --frozen-lockfile`、`typecheck`、`lint`、`format:check`、`check:docs` 退出 0；锁内全量 `test=0`，352 个文件、2843 例通过、4 例跳过。
- 之后又合并 main（含票 06），`docs/adr/README.md` 冲突：0017 取本票的 implemented，0018 取 main 的 partial（dea75d7）。合并后复核：静态检查全部退出 0；settings、stores、sidecar-plugins、sidecar-teams、seams、scripts 与 `plugins.e2e` 共 48 个文件 299 例通过。
- 以合并提交合入 main，树与分支相同，`typecheck` 退出 0。
- 留给票 14：`docs/README.md` 插件一行补"设置中的插件分区与批准对话框"。

Closed: true
