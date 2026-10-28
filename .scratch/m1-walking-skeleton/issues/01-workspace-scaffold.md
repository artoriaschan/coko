# 01: 仓库脚手架与质量入口

**What to build:** 按 [规格](../spec.md) 的"Workspaces 与构建"建立 pnpm workspaces：apps/desktop、apps/server、packages/protocol、agent、session、ui、logging、i18n 的 package.json、tsconfig（project references）、源码入口与一个冒烟测试；根 vitest projects、oxlint、oxfmt、husky + lint-staged + commitlint；pnpm-workspace.yaml 的 allowBuilds 与 skills 策略；按 TECH_STACK 精确版本声明当前需要的依赖（含 electron）。同步 architecture.md 中"共享包以源码导出"的约定与 TECH_STACK 中实际接入状态。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] `pnpm install --frozen-lockfile` 退出 0，Electron 二进制可用
- [x] `pnpm run typecheck`、`pnpm run lint`、`pnpm run test`、`pnpm run check:docs` 全部退出 0，test 实际执行 ≥1 个用例/包
- [x] 提交信息不符合 conventional 时 commit 被拒（临时违规样例验证后撤销）
- [x] architecture.md 与 TECH_STACK 已同步

## Comments

### 2026-10-28 实施回执（m1/01-workspace-scaffold）

覆盖验收：四项全部满足。

- 结构：8 个 workspace（@coko/desktop、@coko/server、@coko/protocol、agent、session、ui、logging、i18n）。共享包 `exports` → `./src/index.ts`；各自 composite tsconfig（只输出声明到被忽略的 `.tsbuild/`），根 tsconfig 引用全部；每个 workspace 有 `vitest.config.ts`，根 `vitest.config.ts` 按 `apps/*/vitest{,.*}.config.ts`、`packages/*/vitest{,.*}.config.ts` 发现项目，另含 scripts 内联项目。ui 另有 `vitest.browser.config.ts`（Browser Mode，Playwright Chromium，headless，`*.browser.test.ts`）。
- 后续票扩展方式：消费方加 `"@coko/<pkg>": "workspace:*"` 并在 tsconfig `references` 引用该包；新增测试项目只加 workspace 内配置文件，无需改根配置。已用临时样例验证该模式（安装、tsc -b 报出跨包类型错误、Vitest 跨包导入），样例已撤销。
- 依赖：根 typescript、vite、vitest、@types/node、oxlint 1.86.0、oxfmt 0.71.0、husky 9.1.7、lint-staged 17.5.1、@commitlint/cli 与 config-conventional 21.2.3、mdast-util-from-markdown；desktop 声明 electron 41.0.3；ui 声明 @vitest/browser-playwright 5.0.3、playwright 1.64.0；各 workspace 声明 vitest。`allowBuilds` 四条与 `permissions['@logtape/logtape'].skills: false` 已写入。
- 运行命令与结果（unset ELECTRON_RUN_AS_NODE，删除 node_modules 后）：`pnpm install --frozen-lockfile` 0；Electron.app 存在且 desktop 冒烟以 ELECTRON_RUN_AS_NODE 运行报告 electron 41.0.3 / node 24.14.0；`pnpm run typecheck` 0；`pnpm run lint` 0（31 文件）；`pnpm run format:check` 0；`pnpm run check:docs` 0（58 文件，0 问题）；`pnpm run test` 0，10 文件 27 用例（8 个 workspace 各 1，ui-browser 1，scripts 18）。
- 守卫反证：提交信息 `bad message without type` 被 commit-msg 钩子拒绝（type-empty、subject-empty）；临时 `debugger` 使 lint 退出 1；临时跨包类型错误使 typecheck 退出 2；样例均已撤销。
- 未验证：Electron GUI 启动、tsdown/Forge 构建与产物（不在本票）；CI 未接入。Browser Mode 依赖本机已缓存的 chromium_headless_shell-1248，新机器需 `pnpm exec playwright install chromium`。
- 文档影响：architecture.md（共享包源码导出、workspace:* + references、.tsbuild、浏览器测试命名与 Vitest 项目发现）、desktop-delivery.md（共享模块不单独构建）、TECH_STACK（接入状态表、根脚本、allowBuilds/permissions 依据）。oxfmt 首次格式化了 scripts/check-docs*.ts 与 tsconfig.base.json，仅换行变化。
- 注意：husky 在共享的 .git/config 写入 `core.hooksPath=.husky/_`（各 worktree 共用，相对路径），main 在合入前该目录不存在，Git 跳过钩子，无影响。
