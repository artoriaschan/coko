# 09: Memory：工具、注入与设置分区

**What to build:** agent `context/memory/`：工具 `memory_list { scope? }`（context-read）、`memory_write { content, scope, id? }` 与 `memory_delete { id }`（memory-write，规则组名 `Memory`），内容 ≤ 2000 字符；`<memory>` system section（用户级与当前 Workspace，updatedAt 倒序，12 000 字符，超出注明数量，每条带 id）。server `context/memory.ts` 用票 01 的 MemoryRepository，受 `memory.enabled` 控制（关闭时不注入、不注册工具）；`/api/memories` 系列路由。界面：Memory 分区（用户级与当前 Workspace 两组，查看、添加、编辑、删除），把注册表中 memory 占位改为可用；工具卡显示"已记住 / 已更新 / 已删除记忆"。

**User stories:** 24, 25

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/context/memory/`、`apps/server/src/application/context/memory.ts`、`apps/server/src/http/routes/memories.ts`、`packages/protocol/src/memory.ts`、`apps/desktop/src/renderer/features/settings/memory-section.tsx`、`apps/desktop/src/renderer/features/conversation/tool-cards.tsx`、`apps/desktop/src/renderer/stores/memory-store.ts`（新）、`packages/i18n/src/dictionaries/domains/memory.ts`、`tests/integration/sidecar-memory.test.ts`（新）、`tests/integration/secrets-gate-memory.test.ts`（新）、`apps/desktop/e2e/memory.e2e.test.ts`（新）、`docs/subsystems/memory.md`（新）、`docs/adr/0003-settings-and-sessions-in-sqlite.md`

- [x] agent 测试：注入顺序、预算截断与"另有 N 条"、超长内容为参数错误
- [x] 集成测试：Session A 中 `memory_write { scope: workspace }` 后，同 Workspace 的新 Session B 的 faux 系统提示含该条，另一 Workspace 的 Session 不含；user 级在两处都有；`memory_delete` 后不再注入；default 模式写入出现审批、accept-edits 免审批、`memory_list` 各模式免审批；`memory.enabled: false` 时工具不在请求中
- [x] 集成测试：`/api/memories` 增删改查与 Workspace 过滤；重启 Sidecar 后条目仍在
- [x] `secrets-gate-memory.test.ts`：Memory 通道（工具结果、HTTP 响应、库）不含已登记的 Credential 明文（驱动模型把回显的错误文本写入记忆）
- [x] E2E：Memory 分区列出模型写入的条目，删除与手动添加生效；工具卡显示记忆操作
- [x] memory.md 建立并可达（导航行写在 Comments）；ADR 0003 的 Memory 部分更新为已实现（FTS 仍未实现）；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：同意 #createRuntime 中预先设置贡献工具的修法（越出写范围，已授权），并已在票 05、07 记录为统一修法。

### 实施者报告（m3/09-memory，2026-10-29）

**覆盖的验收**

1. agent `context/memory/memory.test.ts`（12）：section 按 updatedAt 倒序、每条带 id 与作用域；条目块合计 > 12 000 时省略最旧的连续尾部并注明 `N more entries not shown; use memory_list to see them.`；最新一条即超预算时只给数量；正文中 `</entry>`、`</memory>` 转义；2001 字符经 pi `validateToolArguments` 为参数错误（2000 通过）；新建 / 按 id 替换 / 删除 / 列表；id 不存在、作用域不符、空正文为工具错误；权限类与审批对象。
2. `tests/integration/sidecar-memory.test.ts` 第 1 例：Session A（default）memory_list 免审批、memory_write 出现 approval_request（subject 为正文）；accept-edits 下 memory_write 免审批；超长为参数错误。同 Workspace 新 Session B 的 requestLog 中 `memory` section 含两条（新的在前），另一 Workspace 的 C 只有用户级；B 的第一个 Run 没有 system 条目。重启后 accept-edits 下 memory_delete 免审批，之后的 Session 不再注入该条；`PUT /api/config memory.enabled:false` 后新 Session 的请求中没有 `memory` section、没有 memory_* 工具（`read` 仍在，证明重放读到了工具集）。
3. 同文件第 2 例：`/api/memories` 的 POST（201、trim、source user）、Workspace 过滤、404（Workspace 不存在、跨 Workspace 的 PUT / DELETE、id 不存在）、400（作用域与 workspaceId 不一致、超长、空白、未知字段）、PUT 只改正文；重启后条目与次序仍在。
4. `tests/integration/secrets-gate-memory.test.ts`：模型服务回显 Credential → 模型把错误文本 memory_write → 用户把同一文本 POST / PUT；memory 工具结果（条目与 tool_end 帧）、全部 HTTP 响应体、memories 表行（node:sqlite 读回）、之后请求的 system sections、日志与 COKO_HOME 中都没有明文，保存的正文为 `[REDACTED]`。
5. `apps/desktop/e2e/memory.e2e.test.ts`：审批后 memory_write 工具卡显示"已记住"与正文；Memory 分区在"工作区"组列出模型写入的条目（Agent 记下），删除生效；"用户级"组手动添加、编辑生效；记忆开关关 / 开读回；关闭再打开设置后列表来自 Sidecar。另有 `tool-cards.browser.test.tsx` 新增 1 例（已记住 / 已更新记忆 / 已删除记忆、失败与等待时为动作名、中文）。
6. `docs/subsystems/memory.md` 新建；ADR 0003 的 Memory 部分改为已实现（FTS5 与检索仍未实现），并链接 memory.md（因此 check:docs 的可达性通过）；`pnpm run check:docs` 107 个文件 0 问题。

**实际运行的命令与结果**（worktree，已 `git merge main`（含票 03，合并提交 f31084d）后重新运行）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0；`pnpm run format:check` 0；`pnpm run check:docs` 0（108 文件）。
- `pnpm run test`：126 个文件通过，970 通过、1 跳过（settings E2E 中 M2 已有的跳过），含 desktop E2E 13 个文件与产物 smoke（`package-smoke.e2e.test.ts` 2 个）。合并 main 之前：123 文件、928 通过、1 跳过。
- 第一次全量有 12 个 M2 集成用例失败（见下"越界改动"第 1 条），修复后全量如上。

**负向确认**

- 去掉 `MemoryService` 中的 `redactText`（同时临时去掉 `[REDACTED]` 前置断言）→ 总闸报出 memory ws frame 0–3、http body 5/6/7/11、memories row 0/1、request 4 system sections 含 credential；撤销后通过。
- 去掉 `memory.enabled` 判断 → `sidecar-memory` 第 1 例在"关闭后没有 memory section"处失败；撤销后通过。
- agent 测试先红（12 例 `createMemoryTools is not a function`）后绿。

**越出 Write scope 的改动**（请 Lead 裁决）

1. `apps/server/src/application/sessions.ts`（01 → 11）：`#createRuntime` 在构造运行时之前 `runContext.tools.set(await this.#context.tools(scope))`。原因：运行时以构造时的工具组成开头的系统消息；贡献的工具只在 `#start` 才加入时，pi 把它们作为工具变化提交一条 `system` 条目（toolsAdded），默认开启的 Memory 使 M2 的 12 个按条目序列断言的集成用例失败。改后第一个 Run 不提交 system 条目，之后配置变化照常提交。05（skill）与 07（mcp__*）会遇到同一问题，可直接复用本改动。
2. `apps/server/src/application/context/types.ts`（01）：`ContextContributionOptions.memories?: MemoryStore` 与类型 `MemoryStore`；`apps/server/src/runtime/layers.ts`（01）：`createContributions({ cokoHome, memories: store })`。07 若也在 options 中加字段，两处为相邻行冲突。
3. `apps/desktop/src/renderer/features/settings/sections.ts`（01）：memory 分区 `available: true`；`sections.browser.test.tsx` 的断言相应改为只有 skills、mcp 不显示、导航含 memory。
4. 测试文件 `apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx` 新增 1 例。

**未验证项**

- 真实模型：无凭据，未运行。
- 脱敏按凭据形态（`redactText`：`sk-`、Bearer 等），不比对已登记 Credential / Secret 的值；不符合这些形态的密钥写入记忆不会被替换。按值脱敏需要 07 的已解密 Secret 集合，留给后续。
- 模型自己的 memory_write 调用参数（assistant 消息、tool_start 进度、审批对象）是模型输出原文，与其他工具相同，未纳入 Memory 通道的扫描。

**文档影响 / 需要 Lead 合并的行**

- `docs/README.md`"当前行为"增一行：`- [Memory](subsystems/memory.md)：记忆工具与权限类、每个 Run 注入的 <memory> section 与预算、开关、/api/memories 与设置分区。`
- TECH_STACK 接入状态表如需逐票一行：`M3 票 09 | Memory：工具、注入、/api/memories、设置分区`（未改）。
- `apps/server/README.md` 与 `packages/agent/README.md` 归其他票，未改；如需提及 Memory，可链接 `docs/subsystems/memory.md`。

### 供后续票

- agent：`createMemoryTools(port) → { tool, permissionClass }[]`、`memorySection(entries)`（section 名 `memory`）、`MemoryPort`、`MemoryToolDetails { action, memory }`、`MEMORY_MAX_CHARS`、`MEMORY_SECTION_BUDGET`。
- server：`memoryContribution` 的 `report` 给出 `breakdown.memory`（section 字符数，关闭时 0），供票 10 的上下文用量接口。
- 协议：`MemoryEntry`、`MemoryListResponse`、`CreateMemoryRequest`、`UpdateMemoryRequest`、`memoryPaths`、`MEMORY_CONTENT_MAX`（protocol 的 `MemoryEntry` / `MemoryScope` 与 agent 同名，二者都导入时用别名）。
- 贡献的工具现在在运行时构造时进入开头的系统消息（sessions.ts 的 `#createRuntime`），新增的默认开启工具不再改变 M2 的条目序列。
