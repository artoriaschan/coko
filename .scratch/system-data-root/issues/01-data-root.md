# 01: 主数据根切换到 ~/.coko

**What to build:** 用户启动 Coko 后，业务数据统一落在 `~/.coko/data`（Windows 为 `C:\Users\<用户>\.coko\data`），桌面与 sidecar 日志落在 `~/.coko/data/logs`；Electron 的 userData、Cache、Cookies 保持平台默认位置。独立会话的默认根由桌面端解析的 Documents 目录派生为 `<Documents>/Coko`。`COKO_HOME` 可整体重定向主根，`COKO_USER_DATA_DIR` 只控制 Electron。旧库与旧 `~/Coko/chats` 保持原样，不做迁移。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] macOS 启动后 `coko.db` 位于 `~/.coko/data`，`~/Library/Application Support` 下不再产生新的 `data` 目录；Windows 对应路径为 `C:\Users\<用户>\.coko\data`。
- [x] `desktop.jsonl` 与 `sidecar.jsonl` 写入 `~/.coko/data/logs`，Electron 的 `app.getPath('logs')` 不再承载这两个文件。
- [x] `COKO_HOME` 重定向整个主根；设置 `COKO_USER_DATA_DIR` 只改变 Electron 数据，不改变 `~/.coko`。
- [x] 桌面 main 用 `app.getPath('documents')` 解析 Documents，并把 `<Documents>/Coko` 传给 sidecar；`COKO_CHATS_ROOT` 仍可显式覆盖。
- [x] 旧库与旧 `~/Coko/chats` 不被移动、复制或删除；新版本从新主根的空库开始。
- [x] 集成测试与桌面 e2e 使用临时 `COKO_HOME`，断言从旧的 `user-data/data` 改为 `<COKO_HOME>/data`，不保留旧路径回退。
- [x] 主数据根的决定记录为 ADR，并在所属配置文档中更新当前路径说明。


**Closed:** true

## Comments

2026-11-05：完成主根、业务库与日志路径切换。desktop main 从系统 Documents 解析会话根并传给 Sidecar；独立 Sidecar 可省略数据/日志参数，显式参数优先。`COKO_USER_DATA_DIR` 不再决定业务路径，也不设置桌面日志目录。测试 fixture 的库与日志断言、预置旧库路径一并跟随临时 COKO_HOME，保留所有真实用户数据隔离。

- TDD：先添加 `COKO_HOME 控制默认业务数据与日志` 用例，运行 `pnpm run test apps/server/src/config.test.ts -t 'COKO_HOME 控制'` 得到预期失败 `Missing --data-dir`；实现后 `pnpm run test apps/server/src/config.test.ts` 15/15 通过。
- `pnpm run test tests/integration/sidecar-boot.test.ts`：3/3 通过，真实 Electron Node 中启动 Sidecar，通过 HTTP 验证空库并核对临时主根中的库/日志及旧库逐字节保留。
- `pnpm run test apps/desktop/e2e/data-root.e2e.test.ts`：2/2 通过；后台真实 Electron 验证 COKO_HOME/data、两份日志、Electron userData 分离、旧库不动与 Documents/显式根传递；未在真实 Documents 写文件。
- `pnpm run test apps/desktop/e2e/package-smoke.e2e.test.ts -t '启动并完成一次 faux 对话'`：1/1 选中用例通过，5 项因过滤未运行；globalSetup 重建并打包当前产物，实际运行随包 Sidecar、grep、审批与日志路径。首次运行暴露旧断言把助手 footer 当正文，第二次暴露标题请求可能先于 Run；两处只修测试选择器/请求定位，最终原断言语义通过。
- `pnpm run typecheck` 通过。变更的 TypeScript 文件经过 oxfmt 与 oxlint。
- 文档影响：新增 [ADR 0025](../../../docs/adr/0025-system-data-root.md)，更新配置、日志约定、Headless/Server 参数和会话默认根说明；ADR 索引同步。`pnpm run check:docs` 检查 376 个 Markdown 文件、0 问题。从 AGENTS → docs/README → 配置/日志/ADR 入口读回，引用方向、归属、生命周期与状态通过；会话叶目录分层由后续 03 号票接续。
- macOS 实际运行；Windows 仅保留同构 homedir/join 路径代码并审查，不宣称实机通过。不涉及旧数据迁移、真实模型、Windows ACL 或原生文件管理器操作。
