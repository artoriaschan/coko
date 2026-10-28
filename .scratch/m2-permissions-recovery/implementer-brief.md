# M2 实施者须知

所有实施票共用。Lead 只通过上下文指针沟通，细节读文件。

## 读取

1. [规格](spec.md)（尤其"共享装配点与所有者"）、[设计树与采纳记录](grilling.md) 与你的票（`issues/NN-*.md`）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime、testing；UI 票另读 ui.md 与 ui-design-system.md；GLOSSARY 与相关 ADR（M2 重点：[0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)）。
3. 研究：`.scratch/desktop-app/research/` 下与你的票相关的文件（权限、Checkpoint、Resume 读 claude-code-agent-logic.md；审批卡与 composer 读 dsh-desktop-architecture.md；steering 与工具批次读 pi-agent-core-and-coding-agent.md）。DSH 沙箱源码：deepseek-harness `packages/sandbox`；claude-code 权限源码：`src/utils/permissions`。参考源码：pi /Users/chenzheng/Desktop/Work/open_sources/pi（读 v1.4.0 tag：`git -C <pi> show v1.4.0:<path>`），claude-code /Users/chenzheng/Desktop/Work/open_sources/claude-code，deepseek-harness /Users/chenzheng/Desktop/Work/open_sources/deepseek-harness。

## Git 与 worktree

- 主仓库：/Users/chenzheng/Desktop/Work/person/coko（分支 main，Lead 负责合入）。
- 你的 worktree：/Users/chenzheng/Desktop/Work/person/coko-worktrees/<票号-slug>，分支 `m2/<票号-slug>`，从 main 当前 HEAD 创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b m2/<票号-slug> ../coko-worktrees/<票号-slug> main`
  若已存在则复用，先确认基于 main 最新提交（必要时 `git merge main`）。
- 只在你的 worktree 内修改；不要切换主仓库分支、不要合入 main、不要删除 worktree。
- Conventional Commits 提交到你的分支；完成前 `git merge main` 把 main 最新提交合进来并重新验证。

## 环境

- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright 或 `pnpm install` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 子进程时设置它。
- pnpm 12.15.0 已缓存；若报 TLS 错误可临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只用于下载 pnpm 自身。
- 依赖精确版本，见 TECH_STACK；新增依赖须同步 TECH_STACK（技术栈未列出的，在票 Comments 说明理由并登记）。
- 无真实模型密钥：测试用 pi-ai 的 faux provider。

## 仓库约定（来自票 01）

- 共享包 exports 指向 `./src/index.ts`；消费方加 `"@coko/<pkg>": "workspace:*"` 并在 tsconfig references 引用该包。
- 每个 workspace 有自己的 vitest 配置，根配置按 glob 发现；ui 的 Browser Mode 文件名为 `*.browser.test.ts(x)`。根 `tests/` 需要时在根 vitest.config.ts 加一条项目。
- 合并提交信息也要符合 commitlint（如 `chore(merge): <branch>`），`merge:` 会被拒。
- oxfmt：无分号、单引号、printWidth 160。commitlint body 行长 ≤100。
- TECH_STACK 的"接入状态"表是并行票的共同编辑点：只增加自己的行，冲突由 Lead 合并时处理。

## 做法

- 调用 `tdd` skill，在规格"Testing Decisions"列出的接口上先写失败测试。
- 验证按 `coko-verify` skill；文档改动按 `coko-docs` skill（`pnpm run check:docs` 必须通过）。
- 实现若需要偏离规格或 ADR，停下并在票 Comments 写明，再向 Lead 报告，不静默改验收。
- 完成后在你的票文件中勾选已满足的验收项，在 `## Comments` 追加：覆盖的验收、实际运行的命令与结果（数量）、未验证项、文档影响。

## 报告

完成后回复 Lead：分支名、worktree 路径、最终 commit、验收逐项结果、未验证项。简短。
## M2 起的附加规则（来自 [M1 复盘](../m1-walking-skeleton/retro.md) 的已采纳项）

- **写范围。** 每张票头有 `**Write scope:**`。只修改其中列出的目录或文件；新增文件也要落在范围内。确需越界时先停下，在票 Comments 写明要改的文件与理由，向 Lead 报告，等裁决再改。Lead 只并行派发写范围不重叠的票。
- **共享装配点。** `packages/protocol/src/index.ts` 与 `packages/agent/src/index.ts` 只由票 01 修改（票 10 可改 agent index 的 models 导出行）；其余票只改票 01 建好的领域文件与 barrel。其余共享点（server `sessions.ts`、`http/app.ts`、`runtime/layers.ts`，renderer 对话区、i18n 字典、`tests/integration/sidecar-harness.ts` 等）的所有者见规格"共享装配点与所有者"；并行票只新增测试文件，不改共享 harness。
- **秘密不外泄总闸。** `tests/integration/secrets-gate.test.ts` 必须保持通过；你的票引入新的输出通道（协议字段、条目、日志、快照文件）时，在该文件追加一段驱动步骤。
- **合入与评审（Lead 执行，供你预期）。** 每张票合入前 Lead 只看该票 diff 做一次轻量 Spec 评审；收到你的完成报告后，Lead 在同一步完成"评审 diff → 合入 → main 上复核 install、typecheck、lint、format:check、test、check:docs → 关票 → 清理 worktree"。里程碑末再做两轴全量评审。
- **平台。** Seatbelt 用例只在 darwin 运行，其他平台用 `it.skipIf` 显式跳过并写明原因；沙箱测试不得因本机缺 sandbox-exec 而静默通过。
- **依赖。** M2 预计不新增依赖（Seatbelt 用系统 sandbox-exec，路径规则用已选的 ignore）；确需新增时先在票 Comments 说明并等 Lead 裁决。
