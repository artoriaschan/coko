# 09: 重启、重试、压缩与断连后的已加载工具

**What to build:** 已加载的工具在重启、continue、retry，以及手动、自动、溢出三种压缩之后仍然可用，模型不必再搜索，恢复过程不重跑业务工具。工具所在 Server 断开时，断开期间的 Run 不提供该工具；重连后的 Run 自动提供，不需要重新搜索。工具的说明或 schema 在两个 Run 之间改变时，请求中使用新定义。

**规格场景:** [spec](../spec.md) 的 AC-09、AC-11；对应 TS-14、16。

**设计依据:** [design.md](../design.md) 第 6 节的生命周期表。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md) 补充已加载工具在恢复、压缩与断连下的行为。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] AC-09：会话已加载两个工具。重启 Sidecar 后 continue、对失败的请求 retry，以及分别触发手动、自动与溢出压缩之后，下一次请求都包含这两个工具的定义；重启后的请求仍以基础提示开头；恢复过程不重跑业务工具。
- [x] 已加载集合从有效条目重新派生，不经过压缩切点过滤。
- [x] AC-11：已加载工具 A 所在 Server 断开期间的 Run 不提供 A；下一个 Run 重连后自动提供 A，无需搜索；A 的说明与 schema 在两个 Run 之间改变后，请求中是新定义。
- [x] 场景经真实 Sidecar（faux 脚本）验证，先例为压缩与 MCP 的现有 Sidecar 测试。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。


- 2026-11-05 实施（基线 `2fca4205`）：本票的产品行为已由 03 的持久加载集合与 12 的压缩/重启工具声明修复满足；本票不另建状态或修改生产代码，补齐真实 Sidecar 的双工具生命周期验收，并更新 MCP 当前行为正文。
- AC-09：`sidecar-tool-search-lifecycle.test.ts` 先搜索加载 echo 与 env_sha，实际执行 echo 一次；失败请求 retry 后两者仍在模型请求中。随后在真实审批时暂停、SIGKILL Sidecar、重新连接并 continue；请求保留基础提示 section 和两个定义，原业务调用总数仍为一。continue 的前提遵循已有接口（已完成 Run 不允许 continue，须暂停或中断），未改变该契约。
- 手动、自动、溢出三种压缩分别经真实进程验证：加载条目的 seq 早于 `firstKeptSeq`，下一次模型请求仍含两个已加载定义，没有新增搜索或业务重跑。回归敏感性核对：暂时将 `loadedToolNames` 改为按 compacted 上下文派生，定向 manual compaction 场景因缺少 echo 定义而失败（退出 1）；随后恢复原实现并通过最终相关集。没有提交该临时变异。
- AC-11：真实 stdio Server 被 SIGKILL 后，failed 期间的 Run 不提供已加载工具与搜索；删除阻止启动的夹具标记并手动 reconnect 后，无需再次搜索，下一次请求自动带回两个工具，并使用新 description 与 schema。夹具新增可选 `MCP_FIXTURE_FAIL_IF`，与已有 MCP 夹具相同，用于确保自动重连不会使断连观察竞态化；所有模型、加载、持久化与 MCP 装配使用真实实现。
- 验证：`rtk pnpm run test tests/integration/sidecar-tool-search-lifecycle.test.ts tests/integration/sidecar-tool-search-keywords.test.ts tests/integration/sidecar-tool-search-catalog.test.ts tests/integration/sidecar-incremental-tools.test.ts packages/agent/src/entries/tool-loads.test.ts`：5 文件 28/28，退出 0。`rtk pnpm run typecheck`、定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 Markdown，0 问题）通过。原有纯函数工具加载测试也在上述集合中通过。
- 文档归属：原地补充 `docs/subsystems/mcp.md` 的工具搜索生命周期段落；搜索相关加载/恢复/压缩口径，既有上下文与 Provider 段落保持一致。按 AGENTS → docs/README → MCP 读回，导航路径、语义与正式文档引用方向通过；未新增目录或改变 ADR 批准/实施状态。
- 未验证：真实 Provider、Electron 窗口/原生指针、打包产物与 CI；faux 模型请求日志证明所观察的定义与基础提示，不代表真实缓存命中。本票仅本地提交，未推送。
