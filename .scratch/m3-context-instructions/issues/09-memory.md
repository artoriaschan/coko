# 09: Memory：工具、注入与设置分区

**What to build:** agent `context/memory/`：工具 `memory_list { scope? }`（context-read）、`memory_write { content, scope, id? }` 与 `memory_delete { id }`（memory-write，规则组名 `Memory`），内容 ≤ 2000 字符；`<memory>` system section（用户级与当前 Workspace，updatedAt 倒序，12 000 字符，超出注明数量，每条带 id）。server `context/memory.ts` 用票 01 的 MemoryRepository，受 `memory.enabled` 控制（关闭时不注入、不注册工具）；`/api/memories` 系列路由。界面：Memory 分区（用户级与当前 Workspace 两组，查看、添加、编辑、删除），把注册表中 memory 占位改为可用；工具卡显示"已记住 / 已更新 / 已删除记忆"。

**User stories:** 24, 25

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/memory/`、`apps/server/src/application/context/memory.ts`、`apps/server/src/http/routes/memories.ts`、`packages/protocol/src/memory.ts`、`apps/desktop/src/renderer/features/settings/memory-section.tsx`、`apps/desktop/src/renderer/features/conversation/tool-cards.tsx`、`apps/desktop/src/renderer/stores/memory-store.ts`（新）、`packages/i18n/src/dictionaries/domains/memory.ts`、`tests/integration/sidecar-memory.test.ts`（新）、`tests/integration/secrets-gate-memory.test.ts`（新）、`apps/desktop/e2e/memory.e2e.test.ts`（新）、`docs/subsystems/memory.md`（新）、`docs/adr/0003-settings-and-sessions-in-sqlite.md`

- [ ] agent 测试：注入顺序、预算截断与"另有 N 条"、超长内容为参数错误
- [ ] 集成测试：Session A 中 `memory_write { scope: workspace }` 后，同 Workspace 的新 Session B 的 faux 系统提示含该条，另一 Workspace 的 Session 不含；user 级在两处都有；`memory_delete` 后不再注入；default 模式写入出现审批、accept-edits 免审批、`memory_list` 各模式免审批；`memory.enabled: false` 时工具不在请求中
- [ ] 集成测试：`/api/memories` 增删改查与 Workspace 过滤；重启 Sidecar 后条目仍在
- [ ] `secrets-gate-memory.test.ts`：Memory 通道（工具结果、HTTP 响应、库）不含已登记的 Credential 明文（驱动模型把回显的错误文本写入记忆）
- [ ] E2E：Memory 分区列出模型写入的条目，删除与手动添加生效；工具卡显示记忆操作
- [ ] memory.md 建立并可达（导航行写在 Comments）；ADR 0003 的 Memory 部分更新为已实现（FTS 仍未实现）；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：同意 #createRuntime 中预先设置贡献工具的修法（越出写范围，已授权），并已在票 05、07 记录为统一修法。
