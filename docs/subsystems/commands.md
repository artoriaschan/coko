---
kind: reference
description: "当前的 Command 契约：提示模板的发现位置与命名、frontmatter、参数占位符、同名优先级与诊断、commands.* 开关、command 条目、GET /api/commands、/ 命令菜单与时间线的命令 chip。修改命令的加载、展开、目录接口或输入区菜单前查阅。"
lifecycle: active
---

# 命令

本文说明 Coko 当前如何发现、列出与展开 [Command](../../GLOSSARY.md)：用户在输入区开头输入 `/name 参数`，Sidecar 把它展开为一段提示（或一个内置动作），时间线把这条消息显示为命令名与参数。用户编写的模板保存为文件的理由见 [ADR 0009](../adr/0009-user-authored-resources-as-files.md)；开关的合并见 [分层配置](configuration.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/instructions/commands/args.ts` | `parseCommandArgs`、`substituteArgs`、`parseCommandInvocation` |
| `packages/agent/src/instructions/commands/loader.ts` | `createCommandTemplateLoader`：发现模板、解析 frontmatter、诊断（按 mtime 缓存） |
| `packages/agent/src/instructions/commands/registry.ts` | `createCommandRegistry`：同名取舍、遮蔽诊断、启停 |
| `packages/agent/src/instructions/commands/builtin.ts` | 内置命令列表（目前为空） |
| `packages/protocol/src/commands.ts` | `CommandInfo`、`CommandListResponse`、`commandPaths`；条目 payload `CommandPayload` 在 `context-entries.ts` |
| `apps/server/src/application/context/commands.ts` | 命令贡献：命令目录与 `expandInput`；Skill 与 MCP 提示模板经 `commandSources` 登记的 `SourcedCommand` |
| `apps/server/src/http/routes/commands.ts` | `GET /api/commands` |
| `packages/ui/src/composer/composer-typeahead.tsx` | `ComposerTypeahead`：输入区 typeahead（键盘、输入法、定位） |
| `apps/desktop/src/renderer/features/conversation/command-menu.tsx`、`stores/commands-store.ts` | / 命令菜单与命令目录 store |
| `apps/desktop/src/renderer/features/conversation/timeline.ts`、`timeline-view.tsx` | 命令消息的 chip |

## 来源、命名与优先级

| 来源 | 位置 | 说明 |
| --- | --- | --- |
| 内置 | `BUILTIN_COMMANDS` | 展开为动作（`actions[name]`），只在该动作已由某个上下文贡献接入时列出；目前没有内置命令（`/compact` 随压缩接入） |
| 项目 | `<Workspace>/.coko/commands/**/*.md` | 提示模板 |
| 用户 | `COKO_HOME/commands/**/*.md`（缺省 `~/.coko`） | 提示模板 |
| Skill、MCP | 对应上下文贡献的 `commandSources` | 由来源展开；Skill 见 [Skills](skills.md#索引与调用) |

- 名字为相对路径去掉 `.md`，子目录以 `:` 连接（`git/commit.md` → `/git:commit`）。每段只能含字母、数字、`.`、`_`、`-` 且不以 `.` 开头；以 `.` 开头的目录与 `node_modules` 不进入，目录深度上限 8。
- 同名时按 内置 > 项目 > 用户 > Skill > MCP 取一个，被遮蔽的记诊断 `shadowed`。遮蔽只看来源顺序：停用的命令仍占用其名字。
- 每次展开与每次 `GET /api/commands` 都重新列目录；文件未变（mtime 与大小）时复用上次的解析结果。新建或修改的模板在下一次提交时生效。

## 模板格式

frontmatter 只认两个键，其余键（`model`、`allowed-tools` 等）忽略：

| 键 | 缺省 |
| --- | --- |
| `description` | 正文首个非空行，超过 60 个字符截断并加 `...` |
| `argument-hint` | 无 |

正文中的参数占位符（参照 pi coding-agent v1.4.0）：

| 占位符 | 含义 |
| --- | --- |
| `$1`、`$2`… | 第 N 个参数，缺失为空 |
| `$@`、`$ARGUMENTS` | 全部参数以空格连接 |
| `${N:-默认}`、`${@:-默认}` | 缺失或为空时取默认值 |
| `${@:N}`、`${@:N:L}` | 从第 N 个起（L 个） |

参数按 bash 习惯切分：空白分隔，单引号或双引号内保留空白。只替换模板本身，参数与默认值中的占位符不再展开。模板没有任何占位符且调用带参数时，末尾追加一行 `ARGUMENTS: <原始参数文本>`。

## 诊断

读取失败或格式错误只产生诊断 `{ source: 'commands', path, code, message }`，不阻止 Run：

| code | 何时 | 结果 |
| --- | --- | --- |
| `invalid-frontmatter` | frontmatter 不是合法的 YAML 映射 | 不加载该文件 |
| `invalid-value` | `description` 或 `argument-hint` 不是字符串 | 忽略该键 |
| `invalid-name` | 路径中有不合法的名字段 | 不加载该文件 |
| `empty-template` | 去掉 frontmatter 后正文为空 | 不加载该文件 |
| `read-failed` | 文件或目录无法读取 | 不加载 |
| `shadowed` | 被更高优先级的同名命令遮蔽 | 不进入目录 |

## 展开与条目

- 提交的文本（以及 Run 进行中的追加指令）先经上下文装配展开，命令排在 File Reference 之前。只有第一个字符是 `/`、名字之后是空白或结尾时才识别为调用；`/usr/bin` 这类路径、未知名字与停用的命令原样作为普通消息，不产生 command 条目。
- 模板与来源命令：先提交 `command { name, args, source }`，再提交展开后的 user message，二者都在 `run_start` 之后、同一 Run 中；追加指令时 command 条目紧接在其 user message 之前。发给模型的只有展开后的文本。
- 内置命令：展开为动作，SessionService 调用 `actions[name]`；Run 进行中提交时 409 `run-in-progress`，作为追加指令时 400 `bad-request`。
- 来源命令的展开函数抛出的 AppError 原样作为提交的错误响应（例如缺少必填参数时 400）。

## 开关

`commands.enabled`（缺省 true）与 `commands.disabled`（名字列表，只能在全局设置中写）作用于项目、用户模板与 MCP 提示模板；内置命令总是启用，Skill 命令由 `skills.*` 控制。停用的命令仍出现在目录中（`enabled: false`），不出现在 / 菜单，提交时不展开。

## 协议

`GET /api/commands?sessionId=…` 或 `?workspaceId=…` → `{ commands: CommandInfo[], diagnostics }`。`CommandInfo = { name, description, argumentHint?, source, path?, enabled }`，按来源顺序、再按名字排序。两个参数都缺时 400，Session 或 Workspace 不存在时 404。

## 界面

- **/ 命令菜单**：草稿第一个字符为 `/` 时出现，查询为 `/` 之后、光标之前的非空白文本；前缀匹配在前、包含匹配在后，按来源分组，每项显示 `/name`、argument-hint 与描述。没有匹配时不出现，Enter 照常发送。焦点留在编辑区（`aria-activedescendant` 指向选中项）；↑↓ 循环移动，Enter / Tab 插入 `/name `（不发送），Esc 关闭且草稿不变，关闭后同一 token 继续输入不再弹出，删掉 token 后重新输入 `/` 再弹出；输入法组合期间不打开、组合中的 Enter 不确认。菜单经 Radix Popper 定位在编辑区上方，放不下时翻到下方，不越出窗口，可用指针选择。目录在切换会话或草稿与编辑区获得焦点时刷新。
- **命令 chip**：由命令展开的用户消息显示为图标、`/name` 与参数，展开后显示"展开后的提示"全文。从这条消息回退时放回输入区的是原始调用 `/name 参数`。

## 验证

- `packages/agent/src/instructions/commands/args.test.ts`、`commands.test.ts`：占位符、引号参数、不递归、追加 ARGUMENTS 行、调用识别；发现、命名空间、frontmatter 与诊断、mtime 缓存；优先级、遮蔽与启停。
- `apps/server/src/application/context/commands.test.ts`：内置命令的动作路径（409、steer 400）与 Skill 来源命令的展开与条目。
- `tests/integration/sidecar-commands.test.ts`：真实 Sidecar 上的条目顺序与 faux requestLog、未知命令、追加指令展开、`commands.disabled` / `commands.enabled`、`GET /api/commands`。
- `packages/ui/src/composer/composer-typeahead.browser.test.tsx`：typeahead 的键盘、Esc、输入法（Chromium CDP 组合）、指针与定位。
- `apps/desktop/e2e/commands.e2e.test.ts`：Electron 中的分组菜单与 argument-hint、键盘与指针选择、命令 chip 展开全文。

## 延伸阅读

- [ADR 0009](../adr/0009-user-authored-resources-as-files.md)：为什么用户编写的命令是文件。
- [分层配置](configuration.md)：`commands.*` 开关的合并与项目文件中的限制。
