# 03: 按需加载最小闭环：目录、按确切名称加载与加载记录

**What to build:** 「按需加载 MCP 工具」打开时，根会话第一次模型请求不带任何 MCP 工具的定义，只有常驻工具与 `tool_search`；Run 开头送达按 Server 分组的完整目录。模型用 `select:` 按确切名称加载工具后，结果列出名称、Server、说明与 schema，并注明已加载；从下一次请求起带上这些工具的真实定义，模型按真实名称调用，MCP Server 实际执行，调用卡照常显示工具名。加载记录作为单独的条目，在对应的工具结果提交后写入；写入失败时 Run 以 commit_failed 停止。子代理与 Teammate 照常直接拿到允许范围内的全部工具。目录为空时不注册 `tool_search`，也不发目录。本票的开关默认关闭，由测试显式打开，11 号票改为默认打开；关键词检索、目录预算、增量公告与设置界面由后续票完成。

**规格场景:** [spec](../spec.md) 的 AC-01、AC-02（以 `select:` 加载）、AC-15、AC-16，以及 AC-22 的根会话部分；对应 TS-01、03、05、07 的 select 部分、10、11 中不含降级的部分、12 中首次完整目录的部分、13、19、20、26。

**设计依据:** [design.md](../design.md) 第 4 至 6 节；[ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md)（目录以 State Update 送达）、[ADR 0014](../../../docs/adr/0014-subagents-as-child-sessions.md)。复刻基准见[程小帮研究](../research/chengxiaobang.md)第三节。

**文档影响:** 协议包 README 补充新条目与新 State Update 名；[上下文管理](../../../docs/subsystems/context.md) 与 ADR 0024 的 State Update 列举加入目录；[MCP](../../../docs/subsystems/mcp.md) 说明开关打开时的工具提供方式。默认值改变后的同步由 11 号票完成。

**Blocked by:** 01 运行时重建后保留基础提示；02 上下文用量与模型请求共用一份工具清单

**Status:** ready-for-agent

**Closed:** true

- [x] 全局能力配置新增「按需加载 MCP 工具」的布尔键，本票默认 false；关闭时现有行为与测试不变。
- [x] 打开后，根会话第一次请求不带 MCP 工具的定义，只有常驻工具与 `tool_search`（AC-01）。Run 开头送达目录 State Update：按 Server 分组，每个工具一行“名称: 首句说明”，说明超过 60 字截断，不含 schema；排在现有各类 State Update 之后。目录不变的 Run 不重复送达；目录变化时本票重发完整目录，只送增减由 05 号票实现。
- [x] 目录与 `tool_search` 使用同一份 Run 开始时的 MCP 快照，只含当时已连接的 Server；目录为空时不注册 `tool_search`，也不发目录。
- [x] `tool_search` 的参数为 `query` 与 `limit`（默认 5，最多 20），权限类为 context-read，调用卡沿用通用工具卡；描述照搬程小帮 v1.10.1，只替换名称并去掉“内置桌面工具”。`select:名称[,名称]` 按确切名称加载，不受 limit 限制；选中常驻工具时列为已可用，名称未知时列为未知；结果 JSON 的字段照搬程小帮。非 `select:` 查询与 schema 预算由 04 号票实现，在此之前非 `select:` 查询按零命中返回，不报错。
- [x] 加载记录为单独的宿主条目（工具名、来源与工具调用 ID），在对应工具结果提交后写入，同时进入 agent 与 protocol 两份 schema 并通过对照测试；工具结果的文本与 details 不算加载记录。
- [x] 提供给模型的工具为常驻工具，加上已加载名单与当前目录的交集，再加 `tool_search`；每两轮之间重新派生并替换执行集合，registry 仍保留全部可用工具。搜索后下一次请求带上已加载工具的定义，按真实名称调用时 MCP Server 实际收到调用，权限规则、审批与 Hook 照常生效（AC-02）。
- [x] 加载记录的提交被注入失败时，Run 以 commit_failed 结束，不发出包含该工具的请求（AC-16）。
- [x] 派发 general 子代理与 Teammate：子会话的请求包含允许范围内的全部工具，包括父会话未加载的 MCP 工具，没有 `tool_search` 与目录（AC-15）。
- [x] 用量接口的工具一项只计实际提供给模型的工具，目录计入其 State Update（AC-22 的根会话部分）。
- [x] Headless Run 在同一配置下行为相同。
- [x] 测试以真实 Sidecar 加 MCP stdio fixture 为主：AC-01 用本地伪造的模型服务记录请求体，其余用 faux 脚本；目录渲染与已加载集合的派生另有纯函数单测。为模型可见的变化建立一段不需要密钥的会话回放或输出快照，期望内容独立维护；后续票改变模型可见文本时同步更新。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；工具装配与条目载荷是共享接口，验证范围扩大到受影响的模块。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：新增 `mcp.toolSearch`（本票默认 false）、Run 冻结目录与 `tool_search select:`、宿主可信 `tool_load` 通道、两份 schema、只应用回退的加载集合派生，以及独立于完整 registry 的模型/执行工具选择。State Update 顺序最后为 `on_demand_tools`；资源 Host Tool、子代理与 Teammate 均常驻。
- TDD 接缝沿用规格已确认的 Testing Decisions：纯 select/目录模块先红（不存在模块）后绿 2/2；Sidecar 的加载记录顺序、实际 MCP 调用、目录去重、general/Teammate、首次真实 HTTP 请求与用量、Headless、空目录共 6/6。独立维护的模型可见输出为 `tests/fixtures/tool-search/exact-result.json`，由真实 Sidecar 的搜索结果核对。
- AC-16 的故障注入通过公开 AgentRuntime 的 commit 端口与 faux 模型：结果已提交、加载写入拒绝后为 commit_failed，仅发出一次请求；另验证任意工具伪造文字/details 不会生成加载。该故障未从真实 Sidecar 注入（现有 Sidecar 没有提交失败注入入口）；正常持久化、执行、子会话与 Headless 均经真实进程。
- 验证命令：`rtk pnpm run test tests/integration/sidecar-config.test.ts apps/server/src/application/entry-payloads.test.ts packages/agent/src/engine/system-message-rebuild.test.ts packages/agent/src/engine/runtime.test.ts packages/agent/src/engine/compaction.test.ts apps/server/src/application/context/usage.test.ts packages/agent/src/entries/state-updates.test.ts packages/agent/src/entries/entries.test.ts packages/agent/src/config/merge.test.ts`：9 文件 121/121；`rtk pnpm run test tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-tool-accounting.test.ts tests/integration/sidecar-subagents.test.ts tests/integration/sidecar-teams.test.ts`：4 文件 21/21。
- 另外有效通过：`packages/agent/src/engine/tool-loading.test.ts` 2/2、`packages/agent/src/tools/tool-search/tool-search.test.ts` 2/2、`packages/agent/src/entries/tool-loads.test.ts` 1/1；`tests/integration/sidecar-mcp.test.ts`、`packages/protocol/src/readme.test.ts`、`apps/desktop/src/renderer/stores/config-store.test.ts` 在首次 10 文件集内通过。首次该组唯一失败为 sidecar-config 的完整默认值期望缺新增字段，已同步为 false 并在后续 121 例中通过；未削弱旧断言。
- 类型检查 `rtk pnpm run typecheck`、定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 个 Markdown，0 问题）及 `rtk git diff --check` 通过。正式文档更新 MCP、上下文、配置、协议 README 与 ADR 0024 的目录列举；从 AGENTS → docs/README → 正文读回，活动引用正常，正式正文不依赖任务材料，ADR 的 partial 不升级。
- 关键词/BM25、schema 预算、目录预算与增量、alwaysLoad、设置 UI、乐观加载、生命周期完整场景和原生传输按后续票实现，不将本票临时行为作为最终规格变更。真实 Provider、Electron 窗口/原生层、产物与 CI 未验证；01 已记录的两个原有 context-seam 顺序断言失败未改动。

- 提交前补验：`rtk pnpm run test tests/integration/sidecar-tool-search.test.ts apps/server/src/application/context/usage.test.ts`：2 文件 19/19；`rtk pnpm run test apps/server/src/application/context/mcp.test.ts apps/server/src/application/context/state-updates.test.ts packages/agent/src/engine/tool-loading.test.ts packages/agent/src/tools/tool-search/tool-search.test.ts packages/agent/src/entries/tool-loads.test.ts`：5 文件 9/9；补齐现有 MCP/State Update 组合边界。最新类型检查通过。

- 2026-11-05 联合验收补充：15 号票已用真实 Sidecar 临时 SQLite 触发器补齐 AC-16 的 `tool_load` 提交失败，确认结果已提交、无加载/下一请求、WS commit_failed；详见[联合证据](../evidence/acceptance.md)。上面的 Runtime-only 记录保留其当时验证范围。
