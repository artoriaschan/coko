# M5 实施者须知

所有实施票共用。复制自 [M4 实施者须知](../m4-goal-plan-tasks/implementer-brief.md) 并改为 M5，另加入 [M4 复盘](../m4-goal-plan-tasks/retro.md) 中已采纳的规则（见末节）。Lead 只通过上下文指针沟通，细节读文件。

## 全量测试锁

**全量测试锁（2026-10-31 起）。** 多个 worktree 的全量 `pnpm run test` 会互相重叠（"先等其他 vitest run 结束"只在开始前检查，开始后别人仍会进来），负载到 20–40 时真实进程与 Browser Mode 用例大面积超时。运行全量时用同一把锁：

```bash
until mkdir /tmp/coko-full-test.lock 2>/dev/null; do
  pid=$(cat /tmp/coko-full-test.lock/pid 2>/dev/null); [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && rm -rf /tmp/coko-full-test.lock
  sleep 10
done
echo $ > /tmp/coko-full-test.lock/pid; trap 'rm -rf /tmp/coko-full-test.lock' EXIT
pnpm run test
```

只跑单个或几个测试文件时不需要锁。

## 同一台机器上的全量测试

多个 worktree 共用一台机器。两个全量 `pnpm run test` 同时运行时负载会到 15 以上，启动真实 sidecar / Electron 或冷启动转译的用例会超时。运行全量前先等其他 `vitest run` 结束：

```bash
while ps -ax -o command | grep -E "node .*vitest run" | grep -v grep >/dev/null; do sleep 5; done
```

只跑单个测试文件时不需要等待。

## 完成报告（必须）

完成后回复 Lead，**第一行**只写：

```text
MERGE-READY m5/<票号-slug> <最终 commit>
```

这一行是 Lead 执行合入的触发词。之后再简短列出：worktree 路径、验收逐项结果、实际运行的命令与结果（数量）、未验证项、越出 Write scope 的改动。未完成或被阻塞时第一行写 `BLOCKED m5/<票号-slug> <原因>`，不要写 MERGE-READY。

## 与 Lead 的沟通

Lead 无法向后台子代理发送消息，你发出的询问不会得到回复，**不要等待回复**。需要越出 Write scope 的最小改动时：直接做，在票 Comments 写明文件与理由，完成报告中列出；Lead 合入时裁决。只有当改动会改变规格语义、ADR 决定或另一张进行中票的写范围时，才停下并以 BLOCKED 报告。

## 读取

1. [规格](spec.md)（尤其"共享装配点与所有者""权限类"与你的领域一节）、[设计树与采纳记录](grilling.md) 与你的票（`issues/NN-*.md`，含 `## Comments` 中 Lead 追加的"来自票 NN"说明）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime（能力表与生命周期）、testing；UI 票另读 ui.md 与 ui-design-system.md；GLOSSARY（M5 新增"多代理与调度"一节）与相关 ADR（M5 重点：[0013](../../docs/adr/0013-external-hooks-tighten-only.md)、[0014](../../docs/adr/0014-subagents-as-child-sessions.md)、[0015](../../docs/adr/0015-schedules-at-most-once-latest-catch-up.md)、[0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)，以及 [0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[0005](../../docs/adr/0005-permission-mode-and-sandbox.md)、[0008](../../docs/adr/0008-project-files-only-tighten.md)、[0009](../../docs/adr/0009-user-authored-resources-as-files.md)、[0011](../../docs/adr/0011-goal-state-as-session-entries.md)、[0012](../../docs/adr/0012-host-process-registry.md)）；当前行为见 [权限判定与审批](../../docs/subsystems/permissions.md)、[分层配置](../../docs/subsystems/configuration.md)、[Goal](../../docs/subsystems/goal.md)、[后台任务](../../docs/subsystems/jobs.md)、[命令执行与子进程登记](../../docs/subsystems/execution.md)、[启动恢复](../../docs/subsystems/recovery.md)、[上下文管理](../../docs/subsystems/context.md) 与各包 README。
3. 研究：`.scratch/desktop-app/research/` 下与你的票相关的部分——Hooks 读 claude-code-agent-logic.md §1.4、§2；子代理读 §5；Fork / Handoff 读 §13；界面读 dsh-desktop-architecture.md。参考源码：pi /Users/chenzheng/Desktop/Work/open_sources/pi（读 v1.4.0 tag：`git -C <pi> show v1.4.0:<path>`，重点 `packages/coding-agent/examples/extensions/{subagent,handoff.ts}`），claude-code /Users/chenzheng/Desktop/Work/open_sources/claude-code（`src/utils/hooks.ts`、`src/schemas/hooks.ts`、`src/services/tools/toolHooks.ts`、`packages/builtin-tools/src/tools/{AgentTool,EnterWorktreeTool,ScheduleCronTool}`、`src/utils/{worktree,cronTasks}.ts`），deepseek-harness /Users/chenzheng/Desktop/Work/open_sources/deepseek-harness（`packages/subagent`、`packages/schedule/schedule` 与 `docs/subsystems/{subagent,schedule}.md`、`packages/workspace`、`packages/experimental/worktree`、`packages/client/{ui-subagent,ui-schedule,ui-workspace,ui-settings-subagent}`）。拷贝 pi 源码时保留 MIT 版权声明。

## Git 与 worktree

- 主仓库：/Users/chenzheng/Desktop/Work/person/coko（分支 main，Lead 负责合入）。
- 你的 worktree：/Users/chenzheng/Desktop/Work/person/coko-worktrees/<票号-slug>，分支 `m5/<票号-slug>`，从 main 当前 HEAD 创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b m5/<票号-slug> ../coko-worktrees/<票号-slug> main`
  若已存在则复用，先确认基于 main 最新提交（必要时 `git merge main`）。
- **只在你的 worktree 中写文件**（M4 复盘）：票文件、截图与临时文件都写在 worktree 内，不写进主仓库检出；不要切换主仓库分支、不要合入 main、不要删除 worktree。
- Conventional Commits 提交到你的分支；**每完成一项（一个验收项或一个可独立验证的改动）就提交**（M4 复盘），接续者可以从提交中盘点；完成前 `git merge main` 把 main 最新提交合进来并重新验证。命令链用 `set -e` 或逐步检查退出码，不要在失败后继续提交；提交命令保留 commitlint 的 ✖ 行，不要重定向到 `/dev/null`；不要用 `git worktree remove --force`。
- 测试中由 Coko 创建的 git worktree（票 04、07、10）只在测试的临时仓库中创建，不要在本仓库或你的 worktree 上运行 Coko 的 worktree 功能。

## 环境

- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright 或 `pnpm install` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 子进程时设置它。
- pnpm 12.15.0 已缓存；若报 TLS 错误可临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只用于下载 pnpm 自身。
- 依赖精确版本，见 TECH_STACK。**M5 不新增依赖**（cron 自研、通知用 Electron 内置 `Notification`、git 用系统可执行文件）；确需新增时先在票 Comments 说明理由并以 BLOCKED 报告。
- 测试不要读写真实的 `~/.coko`、`~/.agents` 或家目录 git 配置：用 harness 的临时 `COKO_HOME`；git 用票 02 的夹具（临时 HOME、`GIT_CONFIG_GLOBAL=/dev/null`、固定 author）。
- 无真实模型密钥：测试用 pi-ai 的 faux provider（脚本按顺序给出每轮回复，可设 usage；票 02 起回复可带 `match`，并行子 Session 用它取各自的回复）。
- 定时任务的测试用票 02 的测试时钟（`COKO_TEST_CLOCK=1` 与 `advanceClock`），不等真实时间、不改系统时区；时区相关用例在代码中显式传 IANA 名。
- 桌面通知在测试中不弹出：测试构建只记日志 `notification shown`，按日志断言。
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

### 沿用 M1–M4

- **写范围。** 每张票头有 `**Write scope:**`。只修改其中列出的目录或文件；新增文件也要落在范围内。越界最小改动按"与 Lead 的沟通"处理。Lead 只并行派发写范围不重叠的票：{03, 04, 05}、{06, 07, 09, 10}、{08, 09, 10}；01、02 串行。
- **共享装配点。** 见规格"共享装配点与所有者"。"只有 02 改"的文件在 02 之后不再改；按顺序列出的文件只在轮到你的票时改；header-actions、右栏 tabs、设置分区三个注册表每票只把自己的一行改为可用。需要的新导出写在 Comments，由 Lead 合并时处理。
- **秘密不外泄总闸。** `tests/integration/secrets-gate*.test.ts` 必须保持通过；你的票引入新的输出通道（协议字段、条目、日志、Hook stdin、通知、system section、子 Session）时，新增 `secrets-gate-<channel>.test.ts` 复用共享 harness，不改 harness 本身。
- **两个机械检查必须保持通过。** `scripts/browser-deps.test.ts`（browser 源码的深层导入同时列在两份 browser 配置的 `optimizeDeps.include`）与 `scripts/source-references.test.ts`（apps、packages、tests 的源码与注释不得引用 `.scratch` 材料，如"grilling C5""票 07""M5 规格"；写出结论，或链接 `docs/` 正文的锚点）。
- **E2E 默认后台运行。** 桌面 E2E 与产物 smoke 默认 `COKO_E2E_BACKGROUND=1`，不要在用例或 harness 中关闭它；本地调试需要看窗口时设 `COKO_E2E_VISIBLE=1`，不要提交这个设置。
- **等待可观察状态，不要只读一次。** 异步渲染、进程退出、条目到达、子代理与定时任务的状态都用轮询可观察条件或事件等待，不要在一次读取后立即断言，也不要用固定 sleep。按键序列前等待编辑区或菜单的可观察状态；Radix 菜单点击前等 `[role=menu]` detached 且 body 的 pointer-events 恢复。
- **Browser Mode 共用页面。** 共用 setup（`apps/desktop/src/renderer/testing/browser-setup.ts`）快照并恢复 localStorage、卸载组件、断言没有 aria-hidden 残留；写 localStorage 的测试自行清理，`screen.unmount()` 要 await。
- **完成报告就是执行指令。** Lead 收到首行为 MERGE-READY 的报告后，回复的第一句是合入结果，不先回复"OK"；你的报告第一行必须严格是触发词。
- **长命令后台运行。** 全量测试与打包在你的 worktree 中用后台任务运行并等待其结束；看退出码（`test=0`），不要只看用例数，未处理错误也会使退出码为 1。
- **失败先读实际值。** 修复只在全量下出现的失败前，先读失败断言的实际值与最近的写入者，再假设原因（M4 复盘）。
- **平台。** Seatbelt、PTY、孤儿清理与 Hook 进程组的用例只在 darwin 运行，其他平台用 `it.skipIf` 显式跳过并写明原因。MCP 与 Hook 的测试夹具用仓库内的 node 脚本，不从网络安装。

### M4 复盘已采纳（新增）

- **对手用例。** 凡是预算、权限或沙箱判定的票（M5 中为 01、03、04、05、06、07、10），验收中固定有"对手用例"：由模型或命令输出构造的输入不能改变判定结果。每张票的具体用例写在票的验收中；你发现新的绕过路径时，补一条先红的用例并写进 Comments。
- **每完成一项就提交。** 见"Git 与 worktree"。中途失败时，接续者从你的提交与票 Comments 盘点，不重做已提交的项。
- **只在 worktree 中写文件。** 见"Git 与 worktree"。Lead 合入前检查主仓库 `git status`，主仓库中出现你的文件视为越界。
- **新增读取根或注入点的票须附符号链接越界用例，并让秘密总闸扫描 requestLog。** M5 新增的读取根与工作目录：`.coko/agents`（票 07：指向 Workspace 外的定义不加载）、`.coko-worktrees`（票 04：符号链接时拒绝创建；worktree 会话读取主 checkout 须审批）。新增的注入点：`<subagent>`、子代理首条消息与 `<agent-result>` / `<agent-notification>`（07）、`<scheduled_task>`（05）、Hook 的 additionalContext 与 stderr（03、06）、Handoff 摘要（10）；对应的 `secrets-gate-*.test.ts` 必须扫描 faux requestLog。新的外发通道：Hook 的 stdin（03 的总闸扫描夹具记录的 stdin 文件）、`notify` 控制消息（05）。其余票在 Comments 写明为何不适用。