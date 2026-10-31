# M6 实施者须知

所有实施票共用。复制自 [M5 实施者须知](../m5-agents-scheduler/implementer-brief.md) 并改为 M6，另加入 [M5 复盘](../m5-agents-scheduler/retro.md) 中已采纳的规则（见末节"M5 复盘已采纳"）。Lead 只通过上下文指针沟通，细节读文件。

## 全量测试锁

多个 worktree 的全量 `pnpm run test` 会互相重叠（"先等其他 vitest run 结束"只在开始前检查，开始后别人仍会进来），负载到 20–40 时真实进程与 Browser Mode 用例大面积超时。运行全量时必须用同一把锁：

```bash
until mkdir /tmp/coko-full-test.lock 2>/dev/null; do
  pid=$(cat /tmp/coko-full-test.lock/pid 2>/dev/null); [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null && rm -rf /tmp/coko-full-test.lock
  sleep 10
done
echo $$ > /tmp/coko-full-test.lock/pid; trap 'rm -rf /tmp/coko-full-test.lock' EXIT
pnpm run test
```

脚本中是 `echo $$`（两个 `$`，当前 shell 的 pid）。只跑单个或几个测试文件时不需要锁。发布构建 E2E（`COKO_RELEASE_E2E=1`）同样在锁内运行，它会打第二次包。

## 完成报告（必须）

完成后回复 Lead，**第一行**只写：

```text
MERGE-READY m6/<票号-slug> <最终 commit>
```

这一行是 Lead 执行合入的触发词。之后再简短列出：worktree 路径、验收逐项结果、实际运行的命令与结果（数量）、未验证项（需要真实凭据的写"未验证（需真实凭据）"）、越出 Write scope 的改动。未完成或被阻塞时第一行写 `BLOCKED m6/<票号-slug> <原因>`，不要写 MERGE-READY。

## 与 Lead 的沟通

Lead 无法向后台子代理发送消息，你发出的询问不会得到回复，**不要等待回复**。需要越出 Write scope 的最小改动时：直接做，在票 Comments 写明文件与理由，完成报告中列出；Lead 合入时裁决。只有当改动会改变规格语义、ADR 决定、"跨票接口"表中的形状或另一张进行中票的写范围时，才停下并以 BLOCKED 报告。

## 读取

1. [规格](spec.md)（尤其"跨票接口""共享装配点与所有者""权限类""人工验证清单"与你的领域一节）、[设计树与采纳记录](grilling.md)、[能力覆盖表](capability-coverage.md) 与你的票（`issues/NN-*.md`，含 `## Comments` 中 Lead 追加的"来自票 NN"说明）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime（能力表与生命周期）、desktop-delivery（票 10）、observability（票 07）、testing；UI 票另读 ui.md 与 ui-design-system.md；GLOSSARY（M6 新增"扩展与交付"一节与 Agent Team、Teammate、Team Task）与相关 ADR（M6 重点：[0017](../../docs/adr/0017-plugins-declarative-user-installed.md)、[0018](../../docs/adr/0018-agent-teams-in-root-session.md)、[0019](../../docs/adr/0019-headless-runs-deny-approvals.md)，以及 [0007](../../docs/adr/0007-secrets-from-registered-entries.md)、[0008](../../docs/adr/0008-project-files-only-tighten.md)、[0010](../../docs/adr/0010-provider-one-shot-save.md)、[0011](../../docs/adr/0011-goal-state-as-session-entries.md)、[0012](../../docs/adr/0012-host-process-registry.md)、[0013](../../docs/adr/0013-external-hooks-tighten-only.md)、[0014](../../docs/adr/0014-subagents-as-child-sessions.md)、[0016](../../docs/adr/0016-session-cwd-fixed-worktrees.md)）；当前行为见 `docs/subsystems/` 中与你的票相关的页（[外部 Hook](../../docs/subsystems/hooks.md)、[子代理](../../docs/subsystems/subagents.md)、[MCP](../../docs/subsystems/mcp.md)、[Memory](../../docs/subsystems/memory.md)、[权限判定与审批](../../docs/subsystems/permissions.md)、[启动恢复](../../docs/subsystems/recovery.md)、[Worktree](../../docs/subsystems/worktrees.md) 等）与各包 README。
3. 研究与参考源码：`.scratch/desktop-app/research/` 中与你的票相关的部分。pi /Users/chenzheng/Desktop/Work/open_sources/pi（读 v1.4.0 tag：`git -C <pi> show v1.4.0:<path>`，插件参考 `packages/coding-agent/docs/packages.md`，headless 参考 coding-agent 的 json 模式）；claude-code /Users/chenzheng/Desktop/Work/open_sources/claude-code（插件 `src/utils/plugins/{schemas,pluginLoader}.ts`；团队 `packages/builtin-tools/src/tools/{TeamCreateTool,SendMessageTool,TaskCreateTool,TaskUpdateTool,TaskListTool}` 与 `src/utils/hooks.ts` 的 TeammateIdle / TaskCreated / TaskCompleted；LSP `packages/builtin-tools/src/tools/LSPTool`）；deepseek-harness /Users/chenzheng/Desktop/Work/open_sources/deepseek-harness（`packages/experimental/agent-team` 与 `docs/subsystems/agent-team.md`、`packages/lsp/{lsp,lsp-stdio,tool-lsp}` 与 `docs/subsystems/lsp.md`、`docs/subsystems/browser-use.md` 与 `packages/experimental/browser-use-playwright-mcp`、`packages/extensions`、`packages/sdk`、`apps/desktop/src/update-coordinator.ts`、`packages/client/` 中的 ui-agent-team 与 ui-settings）。拷贝 pi 源码时保留 MIT 版权声明。

## Git 与 worktree

- 主仓库：/Users/chenzheng/Desktop/Work/person/coko（分支 main，Lead 负责合入）。
- 你的 worktree：/Users/chenzheng/Desktop/Work/person/coko-worktrees/<票号-slug>，分支 `m6/<票号-slug>`，从 main 当前 HEAD 创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b m6/<票号-slug> ../coko-worktrees/<票号-slug> main`
  若已存在则复用，先确认基于 main 最新提交（必要时 `git merge main`）。
- **只在你的 worktree 中写文件**：票文件、截图、报告与临时文件都写在 worktree 内，不写进主仓库检出；不要切换主仓库分支、不要合入 main、不要删除 worktree。
- Conventional Commits 提交到你的分支；**每完成一项（一个验收项或一个可独立验证的改动）就提交**，接续者可以从提交中盘点；完成前 `git merge main` 把 main 最新提交合进来并重新验证。命令链用 `set -e` 或逐步检查退出码，不要在失败后继续提交；提交命令保留 commitlint 的 ✖ 行，不要重定向到 `/dev/null`；不要用 `git worktree remove --force`。
- 测试中由 Coko 创建的 git worktree 与插件的 git 克隆（票 04、06）只在测试的临时仓库与临时 `COKO_HOME` 中进行，不要在本仓库或你的 worktree 上运行 Coko 的 worktree 或插件安装功能。

## 环境

- Agent 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright、`pnpm install` 或 `electron-forge make` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 或 headless 子进程时设置它。
- pnpm 12.15.0 已缓存；若报 TLS 错误可临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 只用于下载 pnpm 自身。
- 依赖精确版本，见 TECH_STACK。**M6 只有票 10 新增依赖**（`@electron-forge/maker-zip@8.0.1`、`@electron-forge/maker-dmg@8.0.1` 及其传递依赖的 allowBuilds 裁决）；Playwright MCP 经 npx 按需运行、不进 manifest；LSP 客户端、插件清单、任务板、trace 与 headless 都自研、不新增依赖。其他票确需新增时先在票 Comments 说明理由并以 BLOCKED 报告。
- 测试不要读写真实的 `~/.coko`、`~/.agents`、家目录 git 配置或真实的 `~/.coko/plugins`：用 harness 的临时 `COKO_HOME`；git 用 M5 票 02 的夹具（临时 HOME、`GIT_CONFIG_GLOBAL=/dev/null`、固定 author）。
- 无真实模型密钥：测试用 pi-ai 的 faux provider（脚本按顺序给出每轮回复，可设 usage；回复可带 `match`，并行子 Session 与 teammate 用它取各自的回复）。
- 无真实语言服务器与 Playwright MCP：用 `tests/fixtures/lsp/server.mjs` 与 `tests/fixtures/mcp/` 的测试 Server；不要从网络安装。
- 定时相关仍用测试时钟（`COKO_TEST_CLOCK=1`）；LSP 的空闲关闭用测试可设的时长，不等真实 10 分钟。
- 桌面通知在测试中不弹出：测试构建只记日志 `notification shown`，按日志断言。
- 清理 Vite 缓存只删明确路径（如 `node_modules/.vite`），不要按名字批量删除 `.vite` 目录；清理打包产物只删 `apps/desktop/out` 或 `out-release` 的明确路径。
- 涉及子进程与 SIGKILL 的测试只终止你自己启动的进程（按测试记录的 pid），不要用 `pkill`、`killall` 或按名字搜索。

## 仓库约定

- 共享包 exports 指向 `./src/index.ts`（agent 另有 `./entries`、`./testing`）；消费方加 `"@coko/<pkg>": "workspace:*"` 并在 tsconfig references 引用该包。
- 每个 workspace 有自己的 vitest 配置，根配置按 glob 发现；ui 的 Browser Mode 文件名为 `*.browser.test.ts(x)`。`desktop-release` 项目在未设 `COKO_RELEASE_E2E=1` 时选中 0 个文件，属于预期。
- 合并提交信息也要符合 commitlint（如 `chore(merge): <branch>`），`merge:` 会被拒。oxfmt：无分号、单引号、printWidth 160。commitlint body 行长 ≤ 100。
- TECH_STACK 的"接入状态"表与 `docs/README.md` 的"当前行为"导航是并行票的共同编辑点：只增加自己的一行，或把要加的行写进 Comments 由 Lead 合并。

## 做法

- 调用 `tdd` skill，在规格"Testing Decisions"列出的接口上先写失败测试。
- 验证按 `coko-verify` skill；文档改动按 `coko-docs` skill（`pnpm run check:docs` 必须通过）。
- 实现若需要偏离规格或 ADR，停下并在票 Comments 写明，以 BLOCKED 报告，不静默改验收。
- 完成后在你的票文件中勾选已满足的验收项，在 `## Comments` 追加：覆盖的验收、实际运行的命令与结果（数量）、负向确认（先红或变异）、未验证项、文档影响、需要 Lead 合并时处理的导航行、README 要点或导出。

## 规则

### 沿用 M1–M5

- **写范围。** 每张票头有 `**Write scope:**`。只修改其中列出的目录或文件；新增文件也要落在范围内。越界最小改动按"与 Lead 的沟通"处理。Lead 只并行派发写范围不重叠的票：{01, 02}；03 单独；{04, 05, 06, 07, 08, 09, 10, 11} 中任选（每次 3–4 张）；12 在 04 之后、13 在 06 之后，可与其余并行；14 最后。
- **共享装配点。** 见规格"共享装配点与所有者"。"只有 03 改"的文件在 03 之后不再改；按顺序列出的文件只在轮到你的票时改；`runtime/layers.ts` 只改 03 为你的领域放好的块（`// ── <domain>（票 NN）──` 注释之间）；设置分区、右栏 tabs、标题栏操作三个注册表每票只把自己的一行改为可用；`tool-cards.tsx` 只追加自己的分支。需要的新导出写在 Comments，由 Lead 合并时处理。
- **秘密不外泄总闸。** `tests/integration/secrets-gate*.test.ts` 必须保持通过；你的票引入新的输出通道（协议字段、条目、日志、Hook stdin、子 Session、插件、LSP 结果、export、headless stdout）时，新增 `secrets-gate-<channel>.test.ts` 复用共享 harness，不改 harness 本身，并扫描 faux requestLog。
- **两个机械检查必须保持通过。** `scripts/browser-deps.test.ts`（browser 源码的深层导入同时列在两份 browser 配置的 `optimizeDeps.include`）与 `scripts/source-references.test.ts`（apps、packages、tests 的源码与注释不得引用 `.scratch` 材料，如"grilling C4""票 06""M6 规格"；写出结论，或链接 `docs/` 正文的锚点）。
- **E2E 默认后台运行。** 桌面 E2E 与产物 smoke 默认 `COKO_E2E_BACKGROUND=1`，不要在用例或 harness 中关闭它；本地调试需要看窗口时设 `COKO_E2E_VISIBLE=1`，不要提交这个设置。发布构建忽略这个开关，所以 `desktop-release` 只在显式 `COKO_RELEASE_E2E=1` 时运行，用 `open -g -n` 启动以免抢焦点。
- **等待可观察状态，不要只读一次。** 异步渲染、进程退出、条目到达、teammate 与子代理的状态、LSP 进程状态、更新状态都用轮询可观察条件（`pollUntil`，01 提供）或事件等待，不要在一次读取后立即断言，也不要用固定 sleep。按键序列前等待编辑区或菜单的可观察状态；Radix 菜单点击前等 `[role=menu]` detached 且 body 的 pointer-events 恢复。
- **Browser Mode 共用页面。** 共用 setup（`apps/desktop/src/renderer/testing/browser-setup.ts`）快照并恢复 localStorage、卸载组件、断言没有 aria-hidden 残留；写 localStorage 的测试自行清理，`screen.unmount()` 要 await。
- **超时预算。** Browser Mode 的预算是项目级 `testTimeout` 20 秒（M5 复盘第 4 条），**不给单个用例或单个文件加长超时**；遇到超时先读失败的实际值，确认是否与已知的负载超时同一签名，同类按配置处理，不同类按缺陷诊断（M5 复盘第 5 条：真实缺陷可能藏在"负载超时"里）。启动真实进程的用例沿用 describe 级预算（M5 T1 的做法）。
- **完成报告就是执行指令。** Lead 收到首行为 MERGE-READY 的报告后，回复的第一句是合入结果，不先回复"OK"；你的报告第一行必须严格是触发词。
- **长命令后台运行。** 全量测试、打包与 make 在你的 worktree 中用后台任务运行并等待其结束；看退出码（`test=0`），不要只看用例数，未处理错误也会使退出码为 1。
- **失败先读实际值。** 修复只在全量下出现的失败前，先读失败断言的实际值与最近的写入者，再假设原因。
- **平台。** Seatbelt、PTY、孤儿清理、Hook / LSP 进程组、DMG 与 `hdiutil` 的用例只在 darwin 运行，其他平台用 `it.skipIf` 显式跳过并写明原因。MCP、Hook、LSP 与插件的测试夹具用仓库内的 node 脚本，不从网络安装。
- **对手用例。** 凡是预算、权限或沙箱判定的票（M6 中为 01、04、05、06、08、09、10、11），验收中固定有"对手用例"：由模型、命令输出、插件文件或外部服务构造的输入不能改变判定结果。每张票的具体用例写在票的验收中；你发现新的绕过路径时，补一条先红的用例并写进 Comments。
- **每完成一项就提交；只在 worktree 中写文件。** 见"Git 与 worktree"。Lead 合入前检查主仓库 `git status`，主仓库中出现你的文件视为越界。
- **新增读取根或注入点的票须附符号链接越界用例，并让秘密总闸扫描 requestLog。** M6 新增的读取根：插件安装目录 `~/.coko/plugins/<name>`（票 04：清单路径与符号链接逃出插件根时拒绝、复制时不跟随）；LSP 的 `file_path`（票 05：按 read 的可读根判定）。新增的注入点：插件的 Skills / 命令 / 子代理正文与 Hook 输出（04）、`lsp` 结果（05）、`<team>` section、`<team-message>` 与 teammate 空闲通知（06）、MCP 图像结果（09）、Memory 检索结果（11）。新的外发通道：插件 Hook 的 stdin（04）、LSP 服务器收到的文件内容（05，用户本机进程，在 Comments 写明）、export（07）、headless stdout（08）。其余票在 Comments 写明为何不适用。

### M5 复盘已采纳（新增）

- **新增宿主注入的消息种类，验收固定覆盖三处。** M5 中每加一种宿主注入的消息（job、agent、schedule、hook-context），授权与时间线判断都要同步，评审仍发现子代理通知让 Goal Round 获得用户权限。M6 的新种类：`team_message`、teammate 空闲时的 `agent_notification`、TeammateIdle 反馈（票 06），以及 headless 的拒绝文本（票 08，它是工具结果而不是 user message，在 Comments 写明依据）。这些票的验收必须同时覆盖：(1) **runAuthority**：消息正文写"create a goal"或 `/goal resume` 时不授予用户权限；(2) **Goal 的用户输入判断**：Run 结束时退回的宿主文本不算用户追加指令、不让 Goal 停住；(3) **时间线**：不显示原文包装，以条目确定的位置判断，用户自己输入的同样文本照常显示。宿主标签只在 `@coko/agent/entries` 的 `host-input.ts` 定义一次（03），不要在 server 或 renderer 手写标签。
- **跨进程的功能至少一条接收侧用例。** M5 的子代理桌面通知从未显示：单元测试直接调用 main 的处理函数，集成测试只看 Sidecar 发出的消息。M6 的跨进程功能：自动更新（main → renderer：关于页显示的状态）、插件的 MCP / LSP 进程（假服务器记录的请求）、LSP JSON-RPC（假服务器的记录与工具结果）、headless（打包产物的 stdout 与退出码）、发布构建（打包应用的实际行为）、子代理通知（desktop.jsonl）。每项至少一条用例在**接收的那一侧**观察结果；只断言发送方发出了消息不算。
- **可并行票之间的接口在开票时定死。** M5 票 11、12 的约定改了两次。M6 的跨票接口（条目形状、共享常量、端口、bridge 方法、layers.ts 的块）列在规格"跨票接口"表中，并已复制进相关两张票的"跨票接口"段。实施中**不要改这些形状**；确需修改时以 BLOCKED 报告，由 Lead 同时改两张票。
- **layers.ts 的占位先放好。** M5 的合并冲突集中在 layers.ts。M6 由 03 预建每个领域的装配块，04–11 只在自己的块中装配；块外的改动写进 Comments 由 Lead 合并。
- **需要真实凭据的验收不阻塞票。** 本机没有真实模型密钥、真实语言服务器、Playwright MCP 的网络环境与签名证书，也不验证非 darwin 平台。规格的"人工验证清单"列出这些项；票中对应的用例用 `it.skipIf`（条件写明所需的环境变量或可执行文件），Comments 与完成报告写"未验证（需真实凭据 / 外部条件）"，不因此 BLOCKED，也不用 faux 结果冒充真实验证。
