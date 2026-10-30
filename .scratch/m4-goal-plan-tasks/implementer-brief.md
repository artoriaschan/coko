# M4 实施者须知

所有实施票共用。复制自 [M3 实施者须知](../m3-context-instructions/implementer-brief.md) 并改为 M4，另加入 [M3 复盘](../m3-context-instructions/retro.md) 中已采纳的规则。Lead 只通过上下文指针沟通，细节读文件。

## 完成报告（必须）

完成后回复 Lead，**第一行**只写：

```text
MERGE-READY m4/<票号-slug> <最终 commit>
```

这一行是 Lead 执行合入的触发词。之后再简短列出：worktree 路径、验收逐项结果、实际运行的命令与结果（数量）、未验证项、越出 Write scope 的改动。未完成或被阻塞时第一行写 `BLOCKED m4/<票号-slug> <原因>`，不要写 MERGE-READY。

## 与 Lead 的沟通

Lead 无法向后台子代理发送消息，你发出的询问不会得到回复，**不要等待回复**。需要越出 Write scope 的最小改动时：直接做，在票 Comments 写明文件与理由，完成报告中列出；Lead 合入时裁决。只有当改动会改变规格语义、ADR 决定或另一张进行中票的写范围时，才停下并以 BLOCKED 报告。

## 读取

1. [规格](spec.md)（尤其"共享装配点与所有者""权限类"与你的领域一节）、[设计树与采纳记录](grilling.md) 与你的票（`issues/NN-*.md`，含 `## Comments` 中 Lead 追加的"来自票 NN"说明）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime（Goal 机制、能力表）、testing；UI 票另读 ui.md 与 ui-design-system.md；GLOSSARY（M4 新增"目标与任务"一节）与相关 ADR（M4 重点：[0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)、[0007](../../docs/adr/0007-secrets-from-registered-entries.md)、[0010](../../docs/adr/0010-provider-one-shot-save.md)、[0011](../../docs/adr/0011-goal-state-as-session-entries.md)、[0012](../../docs/adr/0012-host-process-registry.md)）；当前行为见 [权限判定与审批](../../docs/subsystems/permissions.md)、[启动恢复](../../docs/subsystems/recovery.md)、[上下文管理](../../docs/subsystems/context.md)（压缩）、[MCP](../../docs/subsystems/mcp.md) 与各包 README。
3. 研究：`.scratch/desktop-app/research/` 下与你的票相关的部分——Plan、Todo、后台任务读 claude-code-agent-logic.md §3、§4、§12；dock、Plan chip、Goal 卡读 dsh-desktop-architecture.md §3.3；运行时接入点读 pi-agent-core-and-coding-agent.md §1.3。参考源码：pi /Users/chenzheng/Desktop/Work/open_sources/pi（读 v1.4.0 tag：`git -C <pi> show v1.4.0:<path>`，重点 `packages/agent/src/agent-loop.ts` 的 finishTurn 与 prepareRequest、`packages/coding-agent/src/core/tools/bash.ts` 的进程组），claude-code /Users/chenzheng/Desktop/Work/open_sources/claude-code（`packages/builtin-tools/src/tools/{EnterPlanModeTool,ExitPlanModeTool,TodoWriteTool,BashTool,TaskOutputTool,TaskStopTool}`、`src/tasks/LocalShellTask`），deepseek-harness /Users/chenzheng/Desktop/Work/open_sources/deepseek-harness（`packages/goal`、`packages/plan/plan-mode`、`packages/todo/tool-todo`、`packages/jobs`、`packages/terminal`、`packages/subprocess/subprocess-local`、`packages/client/{ui-goal,ui-plan,ui-jobs}`）。拷贝 pi 源码时保留 MIT 版权声明。

## Git 与 worktree

- 主仓库：/Users/chenzheng/Desktop/Work/person/coko（分支 main，Lead 负责合入）。
- 你的 worktree：/Users/chenzheng/Desktop/Work/person/coko-worktrees/<票号-slug>，分支 `m4/<票号-slug>`，从 main 当前 HEAD 创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b m4/<票号-slug> ../coko-worktrees/<票号-slug> main`
  若已存在则复用，先确认基于 main 最新提交（必要时 `git merge main`）。
- 只在你的 worktree 内修改；不要切换主仓库分支、不要合入 main、不要删除 worktree。
- Conventional Commits 提交到你的分支；完成前 `git merge main` 把 main 最新提交合进来并重新验证。命令链用 `set -e` 或逐步检查退出码，不要在失败后继续提交；提交命令保留 commitlint 的 ✖ 行，不要重定向到 `/dev/null`；不要用 `git worktree remove --force`。

## 环境

- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright 或 `pnpm install` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 子进程时设置它。
- pnpm 12.15.0 已缓存；若报 TLS 错误可临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只用于下载 pnpm 自身。
- 依赖精确版本，见 TECH_STACK。M4 的新依赖（`node-pty` 1.2.0-beta.15、`anser` 2.3.5）与 `allowBuilds` 只由票 02 写入 manifest 与 lockfile；其他票确需新增依赖时先在票 Comments 说明理由并以 BLOCKED 报告。
- 测试不要读写真实的 `~/.coko`、`~/.agents` 或家目录 git 配置：用 harness 的临时 `COKO_HOME`，需要全局 git excludes 时用临时 HOME。
- 无真实模型密钥：测试用 pi-ai 的 faux provider（脚本按顺序给出每轮回复；票 02 起可设 usage）。
- 清理 Vite 缓存只删明确路径（如 `node_modules/.vite`），不要按名字批量删除 `.vite` 目录。
- 涉及子进程与 SIGKILL 的测试只终止你自己启动的进程（按测试记录的 pid），不要用 `pkill`、`killall` 或按名字搜索。

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

## 规则

### 沿用 M1–M3

- **写范围。** 每张票头有 `**Write scope:**`。只修改其中列出的目录或文件；新增文件也要落在范围内。越界最小改动按"与 Lead 的沟通"处理。Lead 只并行派发写范围不重叠的票：{03, 07, 08}、{04, 07, 08}、{05, 06, 09}；01、02、10、11 串行。
- **共享装配点。** 见规格"共享装配点与所有者"。"只有 02 改"的文件在 02 之后不再改；按顺序列出的文件只在轮到你的票时改；dock、header-actions、右栏 tabs 三个注册表每票只把自己的一行改为可用。需要的新导出写在 Comments，由 Lead 合并时处理。
- **秘密不外泄总闸。** `tests/integration/secrets-gate*.test.ts` 必须保持通过；你的票引入新的输出通道（协议字段、条目、日志、Job 输出、system section）时，新增 `secrets-gate-<channel>.test.ts` 复用共享 harness，不改 harness 本身。
- **合入与评审（Lead 执行，供你预期）。** Lead 收到首行为 MERGE-READY 的报告后，在同一步完成"该票 diff 的轻量 Spec 评审 → 合入 → main 上复核 install、typecheck、lint、format:check、test、check:docs → 关票 → 清理 worktree"。你在 worktree 里的全绿不代表 main 上首次运行的结果。里程碑末再做两轴全量评审。
- **跨票约定。** 后继票依赖的约定（导出名、payload 字段、贡献接口用法）写进你的票 Comments 的"供后续票"一节；Lead 会转写到后继票的 Comments（"来自票 NN"）。
- **平台。** Seatbelt、PTY 与孤儿清理的用例只在 darwin 运行，其他平台用 `it.skipIf` 显式跳过并写明原因。MCP stdio 测试 Server 用仓库内的 node 脚本，不从网络安装。

### M3 复盘已采纳（新增）

- **两个机械检查必须保持通过。** `scripts/browser-deps.test.ts`：browser 源码中的深层导入（如 `radix-ui/internal`、`@lexical/react/LexicalTypeaheadMenuPlugin`）必须同时列在两份 browser 配置的 `optimizeDeps.include`，新增深层导入时同步两处，否则 main 上首次运行会因预构建重载失败。`scripts/source-references.test.ts`：apps、packages、tests 的源码与注释不得引用 `.scratch` 材料（"grilling B4""票 09""M4 规格"等）；写出结论，或链接 `docs/` 正文的锚点。
- **E2E 默认后台运行。** 桌面 E2E 与产物 smoke 默认 `COKO_E2E_BACKGROUND=1`（不激活、不显示 Dock、窗口透明），不要在用例或 harness 中关闭它；本地调试需要看窗口时设 `COKO_E2E_VISIBLE=1`，不要提交这个设置。
- **打包临时目录按检出区分。** `forge.config.ts` 的 `packagerConfig.tmpdir` 按检出路径生成，多个 worktree 同时打包不会互删文件；修改 forge 配置（票 05）时保留这一行为。
- **等待可观察状态，不要只读一次。** 异步渲染、进程退出、条目到达与 Job 状态都用轮询可观察条件或事件等待（Playwright 的 `expect.poll` / `toHaveText`、harness 的事件等待），不要在一次读取后立即断言，也不要用固定 sleep。高负载的并行 worktree 会暴露只读一次的断言。
- **新增读取根或注入点的票须附符号链接越界用例，并让秘密总闸扫描 requestLog。** M4 不新增读取根；新增的注入点（`<goal>`、`<goal_round>`、`<todo_list>`、`<plan_mode>`、`<approved_plan>`、Job 通知）各自的总闸用例必须扫描 faux requestLog。涉及文件路径的票（04、05）按票中验收提交符号链接用例；其余票在 Comments 写明为何不适用。
- **完成报告就是执行指令。** Lead 收到首行为 MERGE-READY 的报告后，回复的第一句是合入结果，不先回复"OK"；你的报告第一行必须严格是触发词。
- **长命令后台运行。** 全量测试与打包在你的 worktree 中用后台任务运行并等待其结束，单次前台命令可能超过执行上限被截断；看退出码（`test=0`），不要只看用例数，未处理错误也会使退出码为 1。
