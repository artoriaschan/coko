---
kind: reference
description: "当前的插件契约（服务端）：清单位置、字段与诊断，资源路径与符号链接检查，${COKO_PLUGIN_ROOT} 替换，engines.coko，目录与 git 来源的安装与复制上限，digest 与批准，状态派生，启用 / 禁用 / 更新 / 卸载，贡献的命名空间与加载时机，/api/plugins 接口，以及与项目资源的区别。修改插件的安装、批准、贡献或接口前查阅。"
lifecycle: active
---

# 插件

本文说明 Coko 当前如何安装、批准和加载 [Plugin](../../GLOSSARY.md)：插件是用户安装的一组资源（Skills、命令、子代理定义、Hook、MCP Server 与语言服务器声明），复制到 `<COKO_HOME>/plugins/<name>`，按会执行的声明整体批准后才加载。只声明、不执行插件代码、只有用户级安装与按 digest 批准的理由见 [ADR 0017](../adr/0017-plugins-declarative-user-installed.md)。本页只覆盖服务端；设置中的插件分区与批准对话框尚未接入。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/extensions/plugins/manifest.ts` | `loadPlugin`：清单解析与诊断、资源路径检查、根目录替换、`engines.coko`、可执行声明的展开与 digest |
| `packages/agent/src/extensions/plugins/contributions.ts` | `listPluginContributions`：Skills、命令、子代理定义的 `<plugin>:<name>` 名字列表 |
| `packages/agent/src/extensions/plugins/copy.ts` | `copyPluginTree`：复制、符号链接检查、文件数与体积上限 |
| `packages/agent/src/extensions/plugins/types.ts` | `PluginContributionsSnapshot`、`PluginContributionsPort`、命名函数 |
| `packages/protocol/src/plugins.ts` | `PluginInfo`、`PluginExecutables`、请求体、`pluginPaths` |
| `apps/server/src/application/plugins.ts` | `PluginService`：安装、批准、启停、更新、卸载与贡献快照 |
| `apps/server/src/adapters/git.ts` | `gitClone`：宿主 git 的浅克隆 |
| `apps/server/src/http/routes/plugins.ts` | `/api/plugins` 路由 |
| `packages/session` 的 `plugins` 表 | 安装记录：来源、ref、commit、版本、安装目录、digest、已批准的 digest、启用状态 |

## 清单

清单为 `<root>/.coko-plugin/plugin.json`，缺失时读 claude-code 的 `<root>/.claude-plugin/plugin.json`。字段：

| 字段 | 含义 |
| --- | --- |
| `name` | 必填，`[a-z][a-z0-9-]{0,47}`；不合规为 `invalid-name` |
| `version` | 必填，`x.y.z`（可带预发布与构建标记） |
| `description`、`author` | 展示用 |
| `engines.coko` | 只支持 `>=x.y.z`，与 `--app-version` 比较（源码运行时版本为 `0.0.0`，视为满足）；不满足或其他写法为 `incompatible-engine`，清单仍有效 |
| `skills`、`commands`、`agents` | 目录路径或路径数组；省略时使用存在的同名目录 |
| `hooks`、`mcpServers`、`lspServers` | JSON 文件路径、路径数组或内联对象；省略时读 `hooks/hooks.json`、`.mcp.json`、`.lsp.json`（存在时）。外层的 `hooks` / `mcpServers` / `lspServers` 键可有可无；多个 Hook 声明按顺序合并同一事件的组 |

`$schema`、`homepage`、`repository`、`license`、`keywords` 接受并忽略；其他字段（包括 claude-code 的 `userConfig`、`channels`、`outputStyles`、`settings`）为 `unsupported-field`，不使清单无效。

诊断（source 均为 `plugin`）：`invalid-manifest`（清单不可读、不是 JSON 对象、字段类型错误、引用的声明文件不是 JSON）、`invalid-name`、`unsupported-field`、`incompatible-engine`、`missing-path`（显式声明的路径不存在或类型不对）、`path-outside-plugin`、`invalid-server`（Server 声明不是对象，或语言服务器缺 `command`）。Hook 配置的诊断与 [外部 Hook](hooks.md) 相同。

**路径检查。** 每个资源路径按插件根解析：字面路径或经符号链接的真实路径逃出插件根时为 `path-outside-plugin`，该项不加载，其余照常。Skills、命令与子代理目录中指向插件根外的单个条目同样不列出。

**根目录替换。** `${COKO_PLUGIN_ROOT}` 与 `${CLAUDE_PLUGIN_ROOT}` 在 Hook 的 `command`、MCP 的 `command` / `args` / `env` 的值 / `url`、语言服务器的 `command` / `args` / `env` 的值中替换为安装目录，其他位置不替换。

## 安装

`POST /api/plugins { source }`，来源两种：

- `{ kind: 'dir', path }`：本机目录，须为绝对路径。
- `{ kind: 'git', url, ref? }`：只接受 `https://` 与 `file://`，不接受内嵌凭据；`url` 末尾的 `#<ref>` 与 `ref` 等效。宿主 git 执行 `clone --depth 1 --quiet [--branch <ref>]`，只允许 https 与 file 传输，不初始化子模块，记录克隆后 HEAD 的 commit。

安装过程依次执行（同一时间只处理一个安装、更新、启停、批准或卸载）：取来源到 `<COKO_HOME>/plugins/.staging-*` 暂存目录 → 复制（不复制 `.git`；根内的符号链接按相对路径重建，不跟随；指向根外的符号链接使安装失败；≤ 5 000 个文件、≤ 50 MB）→ 以最终安装目录校验清单并计算 digest → 改名为 `<COKO_HOME>/plugins/<name>` → 写记录（状态 `needs-approval`）。暂存目录在结束时删除，Sidecar 启动时也清理残留的暂存目录。安装是一份快照：源目录之后的改动不生效，需要时用更新重新复制。

| 结果 | 响应 |
| --- | --- |
| 成功 | 201 `PluginInfo` |
| 路径不是绝对路径、git 地址不合规 | 400 `bad-request` |
| 目录不存在、克隆失败 | 400 `plugin-source-unreachable` |
| 清单无效、符号链接逃出插件根 | 400 `plugin-invalid`，`details.diagnostics` |
| 超过文件数或体积上限 | 400 `plugin-too-large` |
| 同名插件已安装 | 409 `plugin-exists` |

## digest 与批准

digest 为 SHA-256，输入是规范化 JSON（键排序，数组保持顺序）：清单的 `name`、`version`、`engines`，以及替换根目录之后的 Hook、MCP 与语言服务器声明。Skills、命令与子代理定义的正文不在其中，改正文不需要重新批准；安装目录不同则替换结果不同，digest 也不同。digest 每次从安装目录现读，安装目录被改动（例如 Hook 命令）时 digest 随之变化。

`GET /api/plugins` 的每项带：

- `executables`：`hooks: [{ event, matcher?, command }]`、`mcpServers: [{ name, command?, args?, url?, envKeys }]`、`lspServers: [{ name, command, args?, extensions }]`。命令是替换后的完整命令；环境变量只给键。
- `contributions`：`skills`、`commands`、`agents` 的 `<plugin>:<name>` 名字列表。
- `diagnostics`、`source { kind, location, ref?, commit? }`、`digest`、`approvedDigest?`。

`POST /api/plugins/:name/approve { digest }`：与当前 digest 不同时 409 `digest-mismatch`（`details.digest` 为当前值），清单无效时 400 `plugin-invalid`；成功后记录 `approved_digest = digest` 并启用。

状态按顺序派生：清单无效或清单名与记录不符为 `invalid`；`engines.coko` 不满足为 `incompatible`（批准后也不加载）；`approved_digest` 与当前 digest 不同为 `needs-approval`；否则按启用状态为 `enabled` 或 `disabled`。

## 生命周期

- **启用与禁用。** `PATCH /api/plugins/:name { enabled }` → 200 `PluginInfo`。
- **更新。** `POST /api/plugins/:name/update` 按记录的来源（与 ref）重新取，校验后替换安装目录；源中声明的插件名变了为 400 `plugin-invalid`。git 来源更新 commit。digest 变化时回到 `needs-approval`，旧的声明不再加载，直到按新 digest 批准；用旧 digest 批准为 409。
- **卸载。** `DELETE /api/plugins/:name` → 204：先把该插件移出快照并通知订阅者，等待 MCP 关闭其连接与进程，再删除安装目录与记录。未安装为 404 `plugin-not-found`。
- **路径安全。** 卸载与更新前确认记录中的安装目录在 `<COKO_HOME>/plugins` 之下（字面路径与真实路径都检查）；不在其下时 403 `forbidden`，不删除也不替换。
- **总开关。** 全局配置 `plugins.enabled`（缺省 true；项目文件写它为 `project-cannot-grant`）为 false 时，所有插件都不加载，已连接的插件 MCP Server 被关闭。

启用、禁用、批准、更新与卸载之后，`PluginContributionsPort.onChange` 的订阅者收到通知；MCP 据此 reconcile，关闭不再提供的 Server。

## 贡献

只有 `enabled` 状态的插件经 `PluginContributionsPort.snapshot()` 提供贡献；上下文装配在每个 Run 开始时读一次快照，命令目录、Skills 与 MCP 视图在读取时取值。

| 资源 | 加载方式 | 名字 |
| --- | --- | --- |
| Skills | 插件的 Skill 目录作为额外的发现位置；Skill 目录加入 skill 工具的读取根（与 `~/.coko/skills` 相同） | `<plugin>:<name>` |
| 命令 | 插件的命令目录，source 为 `user` | `<plugin>:<name>`（子目录为 `<plugin>:<dir>:<name>`） |
| 子代理定义 | 插件的定义目录 | `<plugin>:<name>` |
| Hook | 与全局 Hook 同级，source 为 `plugin`：allow 参与聚合，仍越不过拒绝规则、询问规则、受保护路径与越出可写根（[ADR 0013](../adr/0013-external-hooks-tighten-only.md)）；deny 在任何模式下生效 | `hookId` 为 `plugin:<plugin>:<event>:…` |
| MCP Server | 并入全局一级，不经项目批准；任意字符串含 `${` 的 Server 不加载（诊断 `plugin-secret-reference`） | `plugin-<plugin>-<server>` |
| 语言服务器 | 只在快照的 `lspServers` 中提供，由代码智能读取 | `<plugin>:<server>` |

插件资源不覆盖用户与项目的同名资源：用户的 `greet` Skill 与插件的 `sample:greet` 同时可用。`/<plugin>:<skill>` 与 `/<plugin>:<command>` 展开时，文件正文先替换已登记 Secret 的明文再进入 user message 条目，用户写的参数原样保留（[ADR 0007](../adr/0007-secrets-from-registered-entries.md)）。

## 与项目资源的区别

| | 插件 | 项目资源（`<Workspace>/.coko/` 与项目 MCP、项目 Hook） |
| --- | --- | --- |
| 谁放进来 | 用户安装，复制到 `<COKO_HOME>/plugins` | 随仓库出现 |
| 批准 | 按全部可执行声明的 digest 整体批准一次；声明变化后重新批准 | 项目 MCP 与项目 Hook 逐个批准（[ADR 0008](../adr/0008-project-files-only-tighten.md)） |
| Hook 的 allow | 与全局 Hook 同级，参与聚合 | 只收紧，allow 被忽略 |
| MCP | 全局一级，不能引用 Secret | 项目一级 |
| 名字 | 带插件名前缀，不覆盖同名资源 | 原名，按优先级遮蔽用户资源 |

插件不能声明权限规则、默认权限模式或能力开关，也没有项目级插件、市场、npm 来源与自动更新。

## 协议

路径见 `pluginPaths`：`GET /api/plugins` → `PluginInfo[]`；`POST /api/plugins`；`PATCH` 与 `DELETE /api/plugins/:name`；`POST /api/plugins/:name/approve`；`POST /api/plugins/:name/update`。日志：`plugin installed`、`plugin approved`、`plugin enabled` / `plugin disabled`、`plugin updated`（带 `digestChanged`）、`plugin uninstalled`、`plugin clone failed`、`plugin path outside the plugins directory refused`。

## 验证

- `packages/agent/src/extensions/plugins/manifest.test.ts`：两种清单位置、每种诊断、路径数组与缺省目录、符号链接与 `../` 逃出插件根、根目录替换、`engines.coko`、digest 不受键顺序与 Skill 正文影响而随 Hook 命令、MCP 参数与 env、LSP 命令、version、engines 与安装目录变化、贡献名字。
- `packages/agent/src/extensions/plugins/copy.test.ts`：复制与可执行位、不复制 `.git`、根内符号链接重建、超过上限不写文件。
- `apps/server/src/application/plugins.test.ts`：安装快照、待批准不提供贡献、安装目录改动后回到待批准、错误码、`incompatible`、卸载先通知再删除、记录路径在插件根外时卸载与更新被拒。
- `tests/integration/sidecar-plugins.test.ts`：真实 Sidecar。目录来源安装后待批准、批准前 Skill 不在索引、Hook 不运行、MCP 与语言服务器进程不启动；批准后各类资源带插件名可用，用户的同名资源照常；禁用、卸载与 `plugins.enabled: false` 后 MCP 进程退出；`file://` 夹具仓库的 commit、`#tag`、更新后重新批准与旧 digest 409。
- `tests/integration/sidecar-plugins-trust.test.ts`：插件 Hook 的 allow 越不过询问规则、`.git/config` 写入与越出可写根；deny 在 full-access 下生效；符号链接与清单路径逃出插件根；MCP 引用 Secret；`engines.coko` 不满足；超过体积上限。
- `tests/integration/secrets-gate-plugins.test.ts`：插件 Skill、命令与子代理定义的正文和插件 Hook 输出含登记 Secret 时，requestLog、条目、WS、HTTP、库、日志与 Hook 的 stdin 中没有明文。
- `apps/desktop/e2e/package-smoke.e2e.test.ts`：打包应用中从仓库夹具目录安装、批准后插件的 MCP Server 被启动，语言服务器列在 `executables` 中。

## 延伸阅读

- [ADR 0017](../adr/0017-plugins-declarative-user-installed.md)：插件只声明资源、用户级安装与按 digest 批准的取舍。
- [外部 Hook](hooks.md)：Hook 配置、聚合与判定的组合。
- [MCP Server](mcp.md)：插件 Server 并入全局一级之后的连接与工具。
- [Skills](skills.md)、[命令](commands.md)、[子代理](subagents.md)：插件根上的发现与 `<plugin>:<name>` 登记。
