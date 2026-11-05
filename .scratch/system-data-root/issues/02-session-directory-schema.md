# 02: Session 目录字段与目录名派生

**What to build:** 数据库与协议能记录每个独立会话的实际目录与 cwd；旧版本创建的会话仍然可以打开。目录名由会话 id 确定性派生（`chat-<前 12 位>`），同一天冲突时回退为完整 id，日期按本地日期计算。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 迁移把库升级到新版本，新增会话目录与 cwd 两个字段；升级后的旧库可以正常打开，旧独立会话的两个字段为空，cwd 继续回退到 Workspace 路径。
- [x] Session 协议 DTO 暴露 `directory`（可为空）；项目会话与子会话按现有规则返回。
- [x] 新建或更新会话时可以写入目录与 cwd，并在读取时原样返回。
- [x] 目录名派生是确定性的：同一会话 id 总是得到 `chat-<前 12 位>`；同一天该目录已存在时回退为完整 id；不同日期使用本地日期字符串。
- [x] 迁移测试覆盖旧库升级、旧会话读取与字段为空时的回退；现有会话读取测试不回归。

Closed: true

## Comments

- 2026-11-05：SQLite v12 前向迁移新增 nullable `sessions.directory` / `sessions.cwd`，旧行保持 NULL；内存与 SQLite Repository 同步支持创建、读取和 `setSessionDirectory`，目录更新不改最后记录时间。Session DTO 返回 directory，并优先使用已保存 cwd；NULL 继续通过 Workspace/worktree 派生。未指定字段的项目/子会话沿用旧规则。
- 目录派生接口位于 `apps/server/src/application/session-directory.ts`：`sessionDateDirectory(Date)` 使用本地年月日；`sessionDirectoryName(sessionId, shortNameExists)` 默认 `chat-<前12位>`，冲突返回完整 sessionId。磁盘分配、跨发送幂等由 03 号票接入。
- TDD：v12 迁移用例先因目标版本仍为 11 失败；仓库契约先因缺失字段失败；显式 cwd 用例先因回退到 Workspace 失败；命名/日期用例先因函数不存在失败，实施后全部通过。Sidecar 新断言首次发现 macOS `/var` 与登记后 `/private/var` 的路径差异，改为断言 Session cwd 等于协议返回的 Workspace.path，符合现有 canonical Workspace 契约。
- 验证（本票提交前）：`pnpm install --frozen-lockfile` 退出 0；`pnpm run test apps/server/src/application/session-directory.test.ts packages/session/src/sqlite/migrate-v12.test.ts packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts apps/server/src/application/session-cwd-scope.test.ts apps/server/src/application/worktrees.test.ts`：6 文件、119 测试通过；`pnpm run test tests/integration/sidecar-session.test.ts`：真实 Sidecar，1 文件、9 测试通过；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 检查 375 个 Markdown、0 问题。
- 文档影响：字段由类型、协议及本票记录；整体目录行为和 ADR 0016 的正式文档同步归 13 号票。无 renderer 或 Electron 原生层改动；未验证 Windows 实机、真实模型、发布产物与 CI。
