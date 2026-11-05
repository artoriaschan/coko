# 05: 目录预算降级与增量公告

**What to build:** MCP 工具很多时，目录在预算内尽量写全：先统一缩短说明（最短 24 字），仍超出时从最长的组开始降为只列名称，再降为只列 Server 与工具数。预算取 5000 token 与上下文窗口 2.5% 中的较小值；token 按中日韩字符 1 个、其余字符 chars/4 估算。第一个 Run 送完整目录，之后的 Run 只送 Added/Removed；压缩或回退移除了前一条目录之后，下一个 Run 重发完整目录；目录不变不送。Run 进行中重连成功的 Server，它的工具在下一个 Run 才进入目录，并可以搜索。

**规格场景:** [spec](../spec.md) 的 AC-06、AC-07、AC-08；对应 TS-11、12、13。

**设计依据:** [design.md](../design.md) 第 5 节“目录 State Update”与第 9 节的 token 估算；[ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md)。

**文档影响:** [上下文管理](../../../docs/subsystems/context.md) 的 State Update 说明补充目录的增量与重发规则。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] AC-06：完整渲染超出预算时按上述顺序降级；说明不少于 24 字；任何一级都不含 schema。预算与 token 估算按上述规则计算，单测覆盖每一级降级的边界。
- [x] AC-07：两个 Run 之间新增一个 Server、移除另一个，下一个 Run 只送达 Added 与 Removed；手动压缩之后，以及回退到压缩之前之后，下一个 Run 各重发完整目录；目录不变的 Run 不送。已公告的名单从有效上下文判断，不另存。
- [x] AC-08：Run 开始时某 Server 连接失败，Run 进行中手动重连成功，本 Run 搜不到它的工具；下一个 Run 的目录包含这些工具，可以搜索加载。
- [x] 目录读取或渲染失败时记 warn，本次不发送，Run 继续。
- [x] 场景经真实 Sidecar（faux 脚本）验证，降级与增量渲染另有纯函数单测；模型可见文本的变化同步到会话回放或快照。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系，并采用目录预算的 token 估算：中日韩字符按 1 token，其余按 chars/4。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：目录渲染拆入 `packages/agent/src/tools/tool-search/catalog.ts`，按当前模型窗口快照计算 min(5000, window × 2.5%)，中日韩脚本字符 1 token、其他字符 chars/4。统一从 60 字缩短到 24 字，再将最长组降为名称和 Server/数量；删除组也参与数量降级，所有级别均不含 schema。
- 公告名单仍只从有效上下文中配对的 `state_update` 派生；正文使用上次值计算 Added/Removed。按 approved TS-12 / AC-07 的较强要求，对话回退或有效压缩之后，即使更早公告仍在保留历史中，也重发完整目录；从已有 rewind / compaction 的 seq 判断，无可变重置标志。纯文件回退不写 rewind，因此不重置目录。
- TDD：增量测试先红（仍输出全量），接线后回退场景再红（旧公告仍存在导致跳过），补边界派生后通过。说明预算、最长组名称/数量降级与仅删除目录均观察先红后绿。已独立维护 `tests/fixtures/tool-search/catalog-delta.txt`，真实 Sidecar 核对逐字输出。
- 真实 Sidecar 3/3：两个 Run 之间换 Server 只发送 Added/Removed、后续不变不送；手动压缩后与回退到压缩之前（更早公告仍存活）各重发全量；失败 Server 在写入审批期间重连，本 Run 搜索仍报未知，下一 Run 目录新增并搜索、实际调用成功；100 个中文描述工具的模型可见目录经预算缩短且不暴露 schema。渲染异常通过公开 ContextAssembly 接缝注入失败，返回 undefined、不拒绝 Run hook，原有 warn guard 保留；未给 Sidecar 增加故障专用开关。
- 验证：`rtk pnpm run test packages/agent/src/tools/tool-search/catalog.test.ts packages/agent/src/tools/tool-search/tool-search.test.ts packages/agent/src/entries/state-updates.test.ts apps/server/src/application/context/state-updates.test.ts tests/integration/sidecar-tool-search-catalog.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-compaction.test.ts`：7 文件 47/47；`rtk pnpm run typecheck`、定向 oxfmt / oxlint、`rtk pnpm run check:docs`（396 个 Markdown，0 问题）、`rtk git diff --check` 均通过。
- 文档：更新上下文管理与 MCP 当前正文，搜索旧“名单变化发送完整目录”结论并同步两处；AGENTS → docs/README → 正文读回，路径、语义、归属、引用方向、生命周期、入口可达和历史保留均通过，无新增目录或 ADR 状态晋升。真实 Provider、Electron 指针/原生层、构建产物与 CI 未验证；本票未改变这些入口。
