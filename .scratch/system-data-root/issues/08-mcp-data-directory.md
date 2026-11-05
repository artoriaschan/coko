# 08: MCP 运行时数据目录

**What to build:** 每个 MCP Server 获得稳定的运行时数据目录 `~/.coko/data/mcp/<serverName>/`。启动 stdio Server 时注入环境变量 `COKO_MCP_DATA_DIR`；配置没有指定 `cwd` 时把该目录作为 cwd，配置显式指定 `cwd` 时不覆盖。该目录按 Server 保留，不随会话删除。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [x] 启用一个 stdio MCP Server 后，`data/mcp/<serverName>/` 自动创建，Server 进程能读到 `COKO_MCP_DATA_DIR`。
- [x] 配置未指定 `cwd` 时，Server 的 cwd 是该数据目录；配置指定了 `cwd` 时保持配置值。
- [x] HTTP 类型的 Server 不因缺少 cwd 而失败，目录仍按需创建。
- [x] 删除会话不会删除 `data/mcp/` 下的内容；卸载 Server 后目录保留。
- [x] 集成测试用现有 MCP fixture 验证环境变量与 cwd；现有 MCP 连接与工具调用测试不回归。


Closed: true

## Comments

2026-11-05：McpManager 在连接前创建所选 data 目录下的 `mcp/<serverName>`，按已校验的名字编码为单级目录；插件命名空间沿用已校验的 `plugin-<plugin>-<server>`。传输收到宿主解析的实际绝对数据目录；stdio 在过滤 Sidecar 环境、合并配置 env 后注入 `COKO_MCP_DATA_DIR`，同名父环境或配置值不能覆盖。缺省 cwd 使用该目录，显式相对 cwd 仍相对会话原 cwd，显式绝对 cwd 保持原行为。HTTP 传输不依赖 cwd。配置发现、协议 roots 和连接池仍由 Workspace / 会话 cwd 决定；数据目录按名字共享并保留。

TDD：真实 Sidecar 新用例首先失败，fixture 观察到 cwd 是 Workspace、数据环境变量是配置伪值；接入数据根分配与可信注入后通过。随后通过真实 fixture 验证显式相对 / 绝对 cwd、HTTP、非法路径名称拒绝，磁盘状态在删除 Session、移除 Server、重启和重建同名 Server 后保留。全部测试使用临时 COKO_HOME 与数据目录。

验证（实施 worktree，待汇入最新集成 tip）：

- `pnpm install --frozen-lockfile`：退出 0。
- `pnpm run test tests/integration/sidecar-mcp-data-directory.test.ts tests/integration/sidecar-mcp.test.ts apps/server/src/application/context/mcp.test.ts apps/server/src/application/session-cwd-scope.test.ts`：4 文件、11 项通过（含真实 Sidecar）；退出 0。
- `pnpm run test tests/integration/sidecar-mcp-auth.test.ts tests/integration/sidecar-mcp-presets.test.ts tests/integration/secrets-gate-mcp.test.ts`：3 文件、4 项通过、1 项真实 Playwright MCP 用例按原开关跳过；退出 0。
- `pnpm run typecheck`：退出 0。
- `pnpm run check:docs`：377 Markdown、0 问题；退出 0。

文档归属：当前 MCP 正文原地更新默认 cwd、可信环境变量、目录生命周期和池化作用域，docs 导航同步摘要。搜索 `缺省为 Workspace`、`stdio 的工作目录`、`MCP.*cwd` 与 `cwd.*MCP`，当前有效行为正文命中归 MCP 正文；已有规格描述已符合新行为，无需改写。AGENTS → docs/README → MCP 正文读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、入口、新会话读入、历史保留均通过，无新增文档目录。

未验证：Windows 实机、真实 Playwright MCP / 外部 HTTP 服务；本票无 renderer、Electron 入口或构建配置变化，不运行桌面产物 E2E。保存与提交状态见后续集成读回；未推送或发布。

集成读回：实施提交 `5d4d7449`，无冲突合入最新集成 tip `d16be237`（本票分支合并提交 `7e7b6648`）。再次运行上述首组 4 文件检查，11 项全部通过；`pnpm run typecheck` 退出 0；`pnpm run check:docs` 检查 378 Markdown、0 问题。提交前 changed-file oxfmt、oxlint 均通过。工作区干净后交新 merger 汇入；未推送或发布。
