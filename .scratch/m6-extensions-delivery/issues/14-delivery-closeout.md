# 14: 交付收尾：README 汇总、能力覆盖证据、发布构建 E2E 复跑、人工验证清单

**What to build:** M6 的收尾，不新增功能：(1) `packages/agent/README.md` 与 `apps/server/README.md` 汇总 04–13 写在 Comments 中的要点；(2) [capability-coverage.md](../capability-coverage.md) 每一行的"证据"列填入实际测试文件与 subsystem 页，确认没有"未开始"或"部分"行；(3) 在 main 上运行 `COKO_RELEASE_E2E=1` 的 `desktop-release` 与全量测试（锁内）；(4) 把规格的"人工验证清单"复制为 `.scratch/m6-extensions-delivery/manual-verification.md`，每项留"结果 / 日期 / 执行者"空栏；(5) ADR 索引与 docs/README 导航的最终核对。

**User stories:** 19, 20

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

**Write scope:** `packages/agent/README.md`、`apps/server/README.md`、`packages/session/README.md`（如需）、`docs/README.md`（只修正导航）、`docs/adr/README.md`（只核对）、`docs/TECH_STACK.md` 的接入状态表（只核对 M6 行）、`.scratch/m6-extensions-delivery/{capability-coverage.md,manual-verification.md（新）}`（在 worktree 中修改，随分支合入）

- [ ] 两个 README 的 M6 内容齐全（每个新服务、路由、工具、条目、启动参数与 headless 入口），与代码一致（逐条核对，Comments 列出来源票）
- [ ] capability-coverage.md 每行都有"已交付"与证据；agent-runtime.md 能力表 35 行与桌面交付三项全部覆盖
- [ ] main 上 `COKO_RELEASE_E2E=1 pnpm vitest run --project desktop-release` 通过（结果与 codesign 输出写进 Comments）；全量 `pnpm run test`（全量测试锁内）退出 0，报告文件数、用例数与重叠数
- [ ] manual-verification.md 建立；ADR 0017、0018、0019 为 implemented，0003 为 implemented；`check:docs` 通过

## Comments
- 2026-10-31 lead：发布构建 E2E 复跑时确认插件声明的 LSP 服务器被启动（票 04 移给票 05 的验收）。

- 2026-11-01 lead（来自票 04）：以下几处仍写着插件"未接入"或"只有 COKO_TEST_PLUGINS"，合入时已过时：`docs/subsystems/hooks.md:45`、`docs/subsystems/mcp.md:36`（票 09 先改，未改则由本票修正）、`apps/server/README.md:62`（PluginService 与 routes/plugins.ts 已实现，不再是空存根或 501）。
