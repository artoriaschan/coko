# 08: MCP 资源与提示模板

**What to build:** agent `extensions/mcp/`：Server 声明 resources 能力时注册 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource { server, uri }`（权限类 context-read，文本按 50KB 截断，blob 注明类型与大小，图片按内容块透传）；prompts 经 `request("prompts/list" | "prompts/get")` 封装：能力检查、cursor 分页与重复 cursor 检测（最多 1000 页）、结果按 schema 校验（不合格记诊断，不抛到 Run）、消息转文本（文本拼接、嵌入资源内联、图片注明省略）。server `context/mcp.ts` 向命令目录登记 `/mcp__<server>__<prompt>` 来源（位置参数按声明顺序映射，缺必填参数时 400 `bad-request` 并给出参数名），`prompts/list_changed` 与 `resources/list_changed` 时刷新。

**User stories:** 16

**Blocked by:** 07, 04

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `packages/agent/src/extensions/mcp/`、`apps/server/src/application/context/mcp.ts`、`packages/protocol/src/mcp.ts`、`tests/fixtures/mcp/`、`tests/integration/sidecar-mcp-resources-prompts.test.ts`（新）、`docs/subsystems/mcp.md`

- [x] agent 测试：分页合并、重复 cursor 停止并诊断、不合 schema 的 prompts/get 结果被拒绝、消息转文本
- [x] 集成测试：Server 没有 resources 能力时三个资源工具不注册；有时列表分页完整、读取文本与 blob 正确，各模式下都不出现审批，`read_mcp_resource` 的 deny 规则拒绝
- [x] 集成测试：`/mcp__srv__greet Alice` 提交 `command { source: mcp }` 与展开文本（来自测试 Server 的 prompts/get），缺必填参数 400；测试 Server 发出 list_changed 后 `GET /api/commands` 出现新提示模板
- [x] mcp.md 增加资源与提示模板；`pnpm run check:docs` 通过

## Comments

### 实施者报告（m3/08-mcp-resources-and-prompts，2026-10-29）

**覆盖的验收**

1. agent：`extensions/mcp/prompts.test.ts`（10，pi-mcp 内存传输）：分页合并（3 页，空字符串 cursor 结束）、重复 cursor 停止并诊断 `duplicate-cursor`（保留已取得的项）、1000 页上限 `page-limit`、不合 schema 的项跳过与整页停止（`invalid-result`）、没有 prompts 能力时不请求、`prompts/list_changed` 使 `listRevision` 前进；位置参数映射（引号、多出的词并入最后一个参数、缺必填参数给出名字）；不合 schema 的 `prompts/get` 结果以 `McpResultError` 拒绝（5 种形态）；消息转文本（文本拼接、嵌入的文本资源内联、图片、音频、二进制与资源链接注明）。`resources.test.ts`（4）：三个工具 effect read；全部 Server 全部分页、单页与 cursor、模板；读取文本按 2000 行与 50KB（单行）截断、blob 注明类型与大小、图片透传、不合 schema 的结果为错误。
2. 集成 `tests/integration/sidecar-mcp-resources-prompts.test.ts` 用例 1：只有不声明 resources 的 Server 时 `list_mcp_resources` 未注册（not found 错误结果）；加入声明 resources 的 Server 后：全部分页（测试 Server 日志中 cursor null → p2 → p3）、单页与 cursor、模板、文本、超长文本截断、PNG 透传、二进制注明 2.9KB、模板 URI 读取、对无资源 Server 读取的错误；default、read-only、accept-edits、full-access 下 0 个 approval_request；项目 `.coko/settings.json` 的 `permissions.deny: ["read_mcp_resource"]` 在 full-access 下拒绝读取（`Permission denied by rule read_mcp_resource.`），列表照常。
3. 用例 2：`GET /api/commands` 列出 `mcp__srv__greet`（argumentHint `<name> [tone]`）等；`/mcp__srv__greet Alice` → `permission_mode, run_start, command { name: mcp__srv__greet, args: Alice, source: mcp }, user, assistant, run_end`，user message 与 faux requestLog 只含 prompts/get 的展开文本（含内联的嵌入资源），测试 Server 收到 `{ name: greet, arguments: { name: Alice } }`；缺必填参数 400 `bad-request`（消息含 name，`details.missing = ['name']`）；不合 schema 400（`reason: invalid-result`）且诊断进入 `GET /api/mcp`；通知之前重复列目录不再请求 prompts/list，测试 Server 经 `add_prompt` 发出 `prompts/list_changed` 后目录出现 `mcp__srv__fresh`。
4. 新输出通道（提示模板展开文本进入 user message 条目）：`tests/integration/secrets-gate-mcp-prompts.test.ts`：登记 `MY_SERVICE_DSN`（非 sk- 形态），env 提示模板把值放进提示；条目中为 `[REDACTED:secret]`，WS 帧、HTTP 响应、库与 -wal、sidecar.jsonl、Sidecar stderr 中无明文。
5. `docs/subsystems/mcp.md` 增加"资源""提示模板"两节、结构入口、验证与尚未实现；`pnpm run check:docs` 110 个文件 0 问题。

**实际运行的命令与结果**（worktree，HEAD 已包含 main 8192ac7）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 警告 0 错误；`pnpm run format:check` 0；`pnpm run check:docs` 0 问题。
- `pnpm run test`：146 个文件通过，1073 通过、1 跳过（settings E2E 中已有的跳过），含 desktop E2E 15 个文件与 `package-smoke.e2e.test.ts` 2 个。

**负向确认**（逐个变异，跑对应测试后恢复）

- 去掉提示模板文本的按值脱敏 → `secrets-gate-mcp-prompts` 失败；去掉 `prompts/list_changed` 监听 → 用例 2 失败（目录中没有 fresh）；去掉 resources 能力检查 → 用例 1 失败（无资源时工具已注册）；资源工具不给 context-read → 用例 1 超时（出现审批）；去掉缺参数检查 → 用例 2 失败（202 ≠ 400）；去掉重复 cursor 检测 → agent 用例失败（1000 ≠ 2）。
- 先红：两个 agent 测试文件在模块存在之前失败。集成用例写在实现之后，以上变异作为替代证据。

**设计说明**

- `McpConnection` 新增 `request(method, params, options)`（未连接时拒绝）与 `listRevision('prompts' | 'resources')`（list_changed 与每次建立连接时前进）。pi-mcp 的 resources 方法不处理重复 cursor 诊断，资源与提示模板共用 `pagination.ts`，不调用 pi-mcp 的 `listResources`。
- `GET /api/commands` 与提交消息会先连接应当连接、状态为 idle 的 Server（与 Run 开始时相同），否则新 Workspace 第一个 Run 之前看不到也展开不了 MCP 提示模板。后果：打开输入区 / 菜单时可能启动 stdio Server（项目 Server 仍须批准）。
- 资源工具只在 Run 开始时有已连接 Server 声明 resources 时注册；调用时按池中当前连接查找。权限类 context-read 由宿主给出，`read_mcp_resource` 的 `permissionSubject` 为 uri。
- 规则文本 `read_mcp_resource` 在 Session / 全局规则接口仍会被 `unknown-tool` 拒绝（`#hostToolNames` 只含基础工具，贡献工具不在其中，memory_* 与 skill 同样）；项目 `.coko/settings.json` 不校验工具名，因此用例用项目规则。是否让规则接口接受贡献工具名请 Lead 裁决（不在本票写范围）。

**未验证项**

- 真实模型：无凭据，未运行。真实第三方 MCP Server 未连接。
- HTTP 测试 Server 没有服务端流：list_changed 只在 stdio 上验证；HTTP 上的资源与提示模板未专门测试（同一 `request()` 路径）。
- `resources/list_changed` 只使列表版本前进（资源列表不缓存，每次调用实时请求），没有集成用例。

**越出 Write scope 的改动**（请 Lead 裁决）

- `tests/integration/secrets-gate-mcp-prompts.test.ts`（新）：实施者须知要求新输出通道新增 `secrets-gate-<channel>.test.ts`。
- `packages/agent/THIRD_PARTY_NOTICES.md`：登记资源工具改编自 pi coding-agent、分页上限沿用 pi-mcp（两行）。
- `docs/README.md` 的 MCP 导航行与 `apps/server/README.md` 的 MCP 一条：mcp.md 标题改为"MCP Server 连接、工具、资源与提示模板"，同步链接文字与摘要（各一行）。
- 未改 `docs/subsystems/commands.md`：其来源表第 33 行"Skill、MCP …目前没有来源登记"已过时，票 05 也可能改这一行，请 Lead 合并时改为"MCP 提示模板见 mcp.md"。

### 供后续票

- 资源工具名常量：`LIST_MCP_RESOURCES_TOOL`、`LIST_MCP_RESOURCE_TEMPLATES_TOOL`、`READ_MCP_RESOURCE_TOOL`、`MCP_RESOURCE_TOOL_NAMES`（@coko/agent）。
- `McpManager.diagnostics(scope)`（上下文用量接口，票 10）现在含结果诊断（`invalid-result`、`duplicate-cursor`、`page-limit`），每个 Server 每类保留最近一次。
- 测试 Server：`MCP_FIXTURE_FEATURES=resources,prompts` 打开能力；未设置时行为与票 07 相同。
- 2026-10-29 lead：评审后合入 main（7068503）。合入后首次全量 test 所有用例通过，但 Vitest 报 1 个未处理错误（setTypeOfService EINVAL，来自 sidecar-supervisor.test.ts，与本票无关、票 01 基线已出现）：stop 在 cookie 交换请求进行中杀进程，undici 在已关闭 socket 上抛出无法捕获的错误。lead 在 m3/fix-supervisor-stop-race 先写失败测试（stop 发生在交换途中），再让 stop 先中止交换并等启动结束、start 被中断时返回 stopped，合入 main（5a96f85）。接受越界：secrets-gate-mcp-prompts.test.ts、THIRD_PARTY_NOTICES 2 行、docs/README 与 server README 各 1 行。接受行为变更：GET /api/commands 与提交消息前先连接空闲的 MCP Server。worktree 已清理。

Closed: true
