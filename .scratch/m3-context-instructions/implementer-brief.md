# M3 实施者须知

所有实施票共用。Lead 只通过上下文指针沟通，细节读文件。

## 完成报告（必须）

完成后回复 Lead，**第一行**只写：

```text
MERGE-READY m3/<票号-slug> <最终 commit>
```

这一行是 Lead 执行合入的触发词（[M2 复盘](../m2-permissions-recovery/retro.md) 第 1 条）。之后再简短列出：worktree 路径、验收逐项结果、实际运行的命令与结果（数量）、未验证项、越出 Write scope 的改动。未完成或被阻塞时第一行写 `BLOCKED m3/<票号-slug> <原因>`，不要写 MERGE-READY。

## 与 Lead 的沟通

Lead 无法向后台子代理发送消息，你发出的询问不会得到回复，**不要等待回复**。需要越出 Write scope 的最小改动时：直接做，在票 Comments 写明文件与理由，完成报告中列出；Lead 合入时裁决。只有当改动会改变规格语义、ADR 决定或另一张进行中票的写范围时，才停下并以 BLOCKED 报告。

## 读取

1. [规格](spec.md)（尤其"共享装配点与所有者"与"权限类"）、[设计树与采纳记录](grilling.md) 与你的票（`issues/NN-*.md`，含 `## Comments` 中 Lead 追加的"来自票 NN"说明）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime、testing；UI 票另读 ui.md 与 ui-design-system.md；GLOSSARY 与相关 ADR（M3 重点：[0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[0004](../../docs/adr/0004-model-credentials-safe-storage.md)、[0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)、[0007](../../docs/adr/0007-secrets-from-registered-entries.md)、[0008](../../docs/adr/0008-project-files-only-tighten.md)、[0009](../../docs/adr/0009-user-authored-resources-as-files.md)）；当前行为见 [权限判定与审批](../../docs/subsystems/permissions.md)、[启动恢复](../../docs/subsystems/recovery.md) 与各包 README。
3. 研究：`.scratch/desktop-app/research/` 下与你的票相关的部分——指令、Skills、命令、压缩、MCP 读 pi-agent-core-and-coding-agent.md §3、§4.2–4.6、§4.8 与 claude-code-agent-logic.md §6、§7、§9–§11；typeahead、设置分区与上下文环读 dsh-desktop-architecture.md §3.3。参考源码：pi /Users/chenzheng/Desktop/Work/open_sources/pi（读 v1.4.0 tag：`git -C <pi> show v1.4.0:<path>`，重点 `packages/coding-agent/src/core/{resource-loader,skills,prompt-templates,mcp-servers}.ts`、`core/compaction/`、`extensions/mcp/`、`utils/frontmatter.ts`，以及 `packages/mcp/src`），claude-code /Users/chenzheng/Desktop/Work/open_sources/claude-code（`src/utils/claudemd.ts`、`src/skills/`、`src/services/compact/`、`src/services/mcp/`），deepseek-harness /Users/chenzheng/Desktop/Work/open_sources/deepseek-harness（`packages/client/ui-input-trigger`、`ui-reference`、`ui-commands`、`ui-skill`）。拷贝 pi 源码时保留 MIT 版权声明。

## Git 与 worktree

- 主仓库：/Users/chenzheng/Desktop/Work/person/coko（分支 main，Lead 负责合入）。
- 你的 worktree：/Users/chenzheng/Desktop/Work/person/coko-worktrees/<票号-slug>，分支 `m3/<票号-slug>`，从 main 当前 HEAD 创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b m3/<票号-slug> ../coko-worktrees/<票号-slug> main`
  若已存在则复用，先确认基于 main 最新提交（必要时 `git merge main`）。
- 只在你的 worktree 内修改；不要切换主仓库分支、不要合入 main、不要删除 worktree。
- Conventional Commits 提交到你的分支；完成前 `git merge main` 把 main 最新提交合进来并重新验证。命令链用 `set -e` 或逐步检查退出码，不要在失败后继续提交；不要用 `git worktree remove --force`。

## 环境

- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright 或 `pnpm install` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 子进程时设置它。
- pnpm 12.15.0 已缓存；若报 TLS 错误可临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只用于下载 pnpm 自身。
- 依赖精确版本，见 TECH_STACK。M3 的新依赖（`@earendil-works/pi-mcp` 1.4.0、`yaml` 2.9.0）只由票 01 写入 manifest 与 lockfile；其他票确需新增依赖时先在票 Comments 说明理由并以 BLOCKED 报告。
- 测试不要读写真实的 `~/.coko`、`~/.agents` 或家目录 git 配置：用 harness 的临时 `COKO_HOME`，需要全局 git excludes 时用临时 HOME。
- 无真实模型密钥：测试用 pi-ai 的 faux provider。
- 清理 Vite 缓存只删明确路径（如 `node_modules/.vite`），不要按名字批量删除 `.vite` 目录。新增深层导入（如 `radix-ui/internal`、`@lexical/react/LexicalTypeaheadMenuPlugin`）时同步加入对应 browser 配置的 `optimizeDeps.include`，否则 main 上首次运行可能因预构建缓存重载而失败。

## 仓库约定

- 共享包 exports 指向 `./src/index.ts`（agent 另有 `./entries`、`./testing`）；消费方加 `"@coko/<pkg>": "workspace:*"` 并在 tsconfig references 引用该包。
- 每个 workspace 有自己的 vitest 配置，根配置按 glob 发现；ui 的 Browser Mode 文件名为 `*.browser.test.ts(x)`。
- 合并提交信息也要符合 commitlint（如 `chore(merge): <branch>`），`merge:` 会被拒。oxfmt：无分号、单引号、printWidth 160。commitlint body 行长 ≤ 100。
- TECH_STACK 的"接入状态"表与 `docs/README.md` 的"当前行为"导航是并行票的共同编辑点：只增加自己的一行，或把要加的行写进 Comments 由 Lead 合并。

## 做法

- 调用 `tdd` skill，在规格"Testing Decisions"列出的接口上先写失败测试。
- 验证按 `coko-verify` skill；文档改动按 `coko-docs` skill（`pnpm run check:docs` 必须通过）。
- 实现若需要偏离规格或 ADR，停下并在票 Comments 写明，以 BLOCKED 报告，不静默改验收。
- 完成后在你的票文件中勾选已满足的验收项，在 `## Comments` 追加：覆盖的验收、实际运行的命令与结果（数量）、负向确认（先红或变异）、未验证项、文档影响、需要 Lead 合并时处理的导航行或导出。

## 规则（来自 M1、M2 复盘的已采纳项）

- **写范围。** 每张票头有 `**Write scope:**`。只修改其中列出的目录或文件；新增文件也要落在范围内。越界最小改动按"与 Lead 的沟通"处理。Lead 只并行派发写范围不重叠的票：{03, 04, 07, 09}、{05, 06, 08}、{05, 08, 10}；01、02、11 串行。
- **共享装配点。** `packages/protocol/src/index.ts`、`entries.ts`、`ws.ts`、`runs.ts`，`packages/agent/src/index.ts`、`package.json`、`engine/types.ts`、`session-entries/index.ts`、`policy/decide.ts`、`tools/registry.ts`，`packages/session/src/sqlite/schema.ts`，`pnpm-lock.yaml`，i18n 字典聚合文件，server `http/app.ts`、`runtime/layers.ts`、`application/context/index.ts`，renderer `stores/chat-store.ts`、设置分区注册表，main / preload / bridge，以及测试 harness 只由规格中写明的所有者修改。其余票只改票 01 建好的领域文件、子目录 barrel、`application/context/<domain>.ts`、`http/routes/<domain>.ts` 与 `dictionaries/domains/<domain>.ts`。需要的新导出写在 Comments，由 Lead 合并时处理。
- **秘密不外泄总闸。** `tests/integration/secrets-gate*.test.ts` 必须保持通过；你的票引入新的输出通道（协议字段、条目、日志、MCP 诊断、Memory）时，新增 `secrets-gate-<channel>.test.ts` 复用共享 harness，不改 harness 本身。
- **合入与评审（Lead 执行，供你预期）。** Lead 收到首行为 MERGE-READY 的报告后，在同一步完成"该票 diff 的轻量 Spec 评审 → 合入 → main 上复核 install、typecheck、lint、format:check、test、check:docs → 关票 → 清理 worktree"。你在 worktree 里的全绿不代表 main 上首次运行的结果，Lead 会在 main 复核。里程碑末再做两轴全量评审。
- **跨票约定。** 后继票依赖的约定（导出名、payload 字段、贡献接口用法）写进你的票 Comments 的"供后续票"一节；Lead 会转写到后继票的 Comments（"来自票 NN"）。
- **平台。** Seatbelt 相关用例只在 darwin 运行，其他平台用 `it.skipIf` 显式跳过并写明原因。MCP stdio 测试 Server 用仓库内的 node 脚本，不从网络安装。
