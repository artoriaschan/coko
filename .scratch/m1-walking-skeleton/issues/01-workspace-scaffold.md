# 01: 仓库脚手架与质量入口

**What to build:** 按 [规格](../spec.md) 的"Workspaces 与构建"建立 pnpm workspaces：apps/desktop、apps/server、packages/protocol、agent、session、ui、logging、i18n 的 package.json、tsconfig（project references）、源码入口与一个冒烟测试；根 vitest projects、oxlint、oxfmt、husky + lint-staged + commitlint；pnpm-workspace.yaml 的 allowBuilds 与 skills 策略；按 TECH_STACK 精确版本声明当前需要的依赖（含 electron）。同步 architecture.md 中"共享包以源码导出"的约定与 TECH_STACK 中实际接入状态。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `pnpm install --frozen-lockfile` 退出 0，Electron 二进制可用
- [ ] `pnpm run typecheck`、`pnpm run lint`、`pnpm run test`、`pnpm run check:docs` 全部退出 0，test 实际执行 ≥1 个用例/包
- [ ] 提交信息不符合 conventional 时 commit 被拒（临时违规样例验证后撤销）
- [ ] architecture.md 与 TECH_STACK 已同步

## Comments
