---
kind: reference
description: "当前的分层能力配置契约：默认 ← 全局设置键 config ← 项目 .coko/settings.json（只收紧）、项目文件的读取时机与诊断代码、GET / PUT /api/config、项目 deny / ask 规则的 project 作用域、设置界面的项目设置行与能力开关。修改能力开关、项目设置的合并或诊断、配置接口或相关界面前查阅。"
lifecycle: active
---

# 分层配置

本文说明 Coko 当前如何得到每个 Run 的有效能力配置：默认值、用户在设置中保存的全局值与 Workspace 内的项目设置文件三层合并，项目文件只能收紧。长期决定见 [ADR 0008](../adr/0008-project-files-only-tighten.md)（项目文件只收紧）与 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)（应用状态在 SQLite、项目配置为只读覆盖）。各能力开关由对应的上下文贡献读取；本页只描述配置本身。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/config/schema.ts` | 配置 schema 与默认值 `defaultCapabilityConfig()`、设置键 `CONFIG_SETTING_KEY` |
| `packages/agent/src/config/merge.ts` | `parseProjectSettings(text, path, { isRule? })` → 生效的项目值、规则文本与诊断；`mergeCapabilityConfig(global, project?)` → 有效值 |
| `packages/protocol/src/config.ts` | `ConfigResponse`、`UpdateConfigRequest`、`ResourceDiagnostic`、`configPaths`、`isConfigSettingKey`、`PROJECT_SETTINGS_PATH` |
| `apps/server/src/application/config.ts` | `ConfigService`：全局值的读写、项目文件按 mtime 读取、`effective(workspacePath?)`、项目 Hook 的原值 `projectHooks(cwd)`；两份 schema 的编译期比对 |
| `apps/server/src/application/permissions.ts` | `PermissionService` 经 `ProjectRuleSource`（由 `ConfigService` 实现）取项目规则，见 [权限判定与审批](permissions.md#作用域与持久化) |
| `apps/server/src/http/routes/config.ts` | `GET / PUT /api/config` |
| `apps/desktop/src/renderer/stores/config-store.ts` | renderer 的配置 store（读取 `GET /api/config`） |
| `apps/desktop/src/renderer/features/settings/general-section.tsx` | General 分区的项目设置行与"上下文"组的能力开关 |
| `apps/desktop/src/renderer/features/settings/capability-toggle.tsx`、`stores/config-store.ts` | 能力开关组件与 `setSwitch`（读取后整体替换全局值） |

## 配置项与合并

| 键 | 默认 | 项目文件中 |
| --- | --- | --- |
| `instructions.enabled`、`skills.enabled`、`commands.enabled`、`mcp.enabled`、`memory.enabled` | true | 只有 false 生效 |
| `context.autoCompact`、`context.trimOldToolResults` | true | 只有 false 生效 |
| `agents.enabled`、`schedules.enabled`（M5） | true | 只有 false 生效 |
| `lsp.enabled`、`teams.enabled`（M6） | true | 只有 false 生效；项目文件中 `lsp` 的其他键（例如 `lsp.servers`）以 `project-cannot-grant` 忽略：语言服务器只在全局与 Workspace 设置中配置 |
| `plugins.enabled`（M6） | true | 只能在全局设置：项目文件中的 `plugins` 键不论取值都以 `project-cannot-grant` 忽略；关闭后所有插件的贡献为空 |
| `hooks.enabled`（M5） | true | 只能在全局设置：项目文件中的 `hooks.enabled` 不论取值都以 `project-cannot-grant` 忽略，关不掉全局 Hook；关闭后全局与项目 Hook 都不运行 |
| `hooks`（M5，项目 Hook） | — | 项目 Hook 的配置：`parseProjectSettings` 原样交出（去掉 `enabled`，`ProjectSettings.hooks`），由 Hook 的加载解析与诊断、逐条批准后才运行，见 [外部 Hook](hooks.md#配置)；不是对象时 `invalid-value`。能力配置不对其中的事件键报诊断 |
| `skills.disabled` | [] | 追加（与全局取并集） |
| `commands.disabled` | [] | 不接受（`unknown-key`） |
| `permissions.deny`、`permissions.ask` | — | 规则文本数组，作为 project 作用域参与判定 |
| `permissions.allow`、`permissions.defaultMode` | — | 忽略（`project-cannot-grant`） |

`hooks.enabled` 由 [外部 Hook](hooks.md) 读取；`agents.enabled` 由 [子代理](subagents.md) 读取（关闭时不注册 agent 工具，派发被拒绝）；`schedules.enabled` 由 [定时任务](schedules.md) 读取（关闭时不注册 schedule 工具，到期的任务按 disabled 跳过）。`hooks.enabled` 的开关在设置 → Hooks 分区，其余两个在设置界面中还没有开关。`plugins.enabled` 由上下文装配与 MCP 读取（为 false 时插件消费 seam 的快照为空）；`lsp.enabled` 由 [代码智能](lsp.md) 读取（为 false 时不注册 lsp 工具），开关在设置 → 代码智能分区；`teams.enabled` 由 [Agent Teams](teams.md) 读取（为 false 时不注册 send_message 与 task_* 工具，带 `name` 的 agent 调用被拒绝）。全局 Hook 配置不在设置键 `config` 中，而在设置键 `hooks`（经 `/api/hooks` 修改）。

有效值 = 默认 ← 全局 ← 项目：全局的开关替换默认值，项目的开关与之取"与"；禁用列表取并集。全局值保存在设置键 `config`，形状为每个分区的部分键（省略的取默认）；读入时不合 schema 按空处理并记 warn `capability config ignored`。`config` 及其下的键只能经 `/api/config` 修改，通用设置接口 400。

## 项目设置文件

位置为 `<Workspace>/.coko/settings.json`（`.coko` 是受保护路径，Agent 写入须审批）。读取时机：每个 Run 开始时（上下文装配取有效配置）、`GET /api/config?workspaceId` 与 `GET /api/permissions?workspaceId` 时；文件未变（mtime 与大小相同）时复用上次的解析结果。Run 进行中改动文件，到下一个 Run 才生效。

读取失败或格式问题只产生诊断 `{ source: 'config', path, code, message }`，不阻止 Run，其余键照常生效：

| code | 何时 | 结果 |
| --- | --- | --- |
| `invalid-json` | JSON 解析失败 | 整个文件被忽略 |
| `invalid-value` | 顶层不是对象；分区不是对象；开关不是布尔值；列表不是非空字符串数组；单条规则不是合法的规则文本 | 顶层问题时整个文件被忽略，否则只忽略该键或该条规则 |
| `unknown-key` | 不认识的键（含项目中的 `commands.disabled`） | 忽略该键 |
| `project-cannot-grant` | 值为 true 的开关、`permissions.allow`、`permissions.defaultMode`、`plugins` 键、`lsp` 中 `enabled` 以外的键 | 忽略该键 |
| `read-failed` | 文件存在但无法读取 | 按空文件处理，记 warn `project settings unreadable` |

规则文本按 `parsePermissionRule` 的语法校验（`Tool` 或 `Tool(content)`）；工具名在判定与显示时归一为规范名（`bash` → `Bash`），不检查是否为已注册的工具。

## 协议

- `GET /api/config?workspaceId=…` → `{ effective, global, globalRevision, project? }`。`globalRevision` 未保存过为 0。给出 workspaceId 时 `effective` 含该项目文件，`project = { path, exists, values, diagnostics }`：`values` 只有生效的项（关闭的开关、追加的 `skills.disabled`、有规则时的 `permissions: { deny, ask }`），被忽略的项只出现在 `diagnostics` 中；文件不存在时 `exists: false`。Workspace 不存在 404。
- `PUT /api/config { values, expectedRevision, workspaceId? }`：整体替换全局值，返回同形的响应。值不合 schema 400；revision 不一致 409 `revision-conflict`。
- 设置界面的能力开关经 `GET /api/config` 读取全局值与 revision，再以 `PUT /api/config` 整体替换（只改一个键，其他全局键原样带回），完成后重新读取。

## 界面

- **General 分区的项目设置行**：当前会话（或草稿）所在 Workspace 的项目文件路径、"未创建" / "没有问题" / 诊断数；诊断数是一个按钮，展开后按 code 显示本地化标题与原始说明。没有 Workspace 时提示先打开会话。
- **能力开关**：每个开关写全局值；有效值被项目设置关闭时注明"已被项目设置关闭"。General 分区的"上下文"组：`instructions.enabled`、`context.autoCompact`、`context.trimOldToolResults`；MCP 分区顶部：`mcp.enabled`；Skills & Commands 分区：`skills.enabled`、`commands.enabled`；Memory 分区：`memory.enabled`。共用组件 `features/settings/capability-toggle.tsx` 与 `stores/config-store.ts` 的 `setSwitch`（Skills 与 Memory 的开关各有自己的 store，行为相同）。
- **Permissions 分区的项目规则**：只读列表，标出来源文件，没有删除入口与输入框，见 [权限判定与审批](permissions.md#界面)。

## 验证

- `packages/agent/src/config/merge.test.ts`：合并（默认 / 全局 / 项目、项目 true 不打开全局 false、列表并集）与诊断（`project-cannot-grant`、`unknown-key`、`invalid-value` 且其余键照常、`invalid-json` 整文件忽略）。
- `tests/integration/sidecar-config.test.ts`：真实 Sidecar 上的 `GET / PUT /api/config`、409、通用设置接口 400、改文件后下一次 GET 与下一个 Run 读到新值、项目 deny 在 full-access 下拒绝、项目 allow 不放行。
- `apps/desktop/e2e/config.e2e.test.ts`：General 分区的路径与诊断、Permissions 分区的只读项目规则；能力开关（指令、自动压缩、时间裁剪、MCP、命令）写入全局配置、其他全局键带回、关闭再打开后读回、被项目关闭的项注明。`apps/desktop/src/renderer/stores/config-store.test.ts`：`setSwitch` 的整体替换与 revision。

## 延伸阅读

- [ADR 0008](../adr/0008-project-files-only-tighten.md)：为什么项目文件只能收紧。
- [权限判定与审批](permissions.md)：project 作用域在判定中的位置。
