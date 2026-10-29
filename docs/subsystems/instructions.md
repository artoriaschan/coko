---
kind: reference
description: "当前的指令文件（AGENTS.md / CLAUDE.md）契约：用户级与仓库根到 Workspace 的发现顺序、@import 的形式与边界、预算与截断、<instructions> system section 与嵌套指令块的格式、按需加载的触发与去重、诊断代码与日志。修改指令的加载、注入格式、嵌套加载或相关诊断前查阅。"
lifecycle: active
---

# 指令文件

本文说明 Coko 当前如何把用户与项目的指令文件（[Instruction File](../../GLOSSARY.md)）交给模型：每个 Run 开始时读取用户级与仓库根到 Workspace 的指令组成一个 system section，Workspace 子目录的指令在 Agent 第一次触及该目录时追加到工具结果。指令以普通文件保存、由用户编辑，见 [ADR 0009](../adr/0009-user-authored-resources-as-files.md)。能力开关 `instructions.enabled` 见 [分层配置](configuration.md)。路径条件规则、`CLAUDE.local.md` / `AGENTS.override.md` 与企业策略文件不支持。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/instructions/rules/discover.ts` | 仓库根、目录链、每个目录选哪个文件 |
| `packages/agent/src/instructions/rules/imports.ts` | @import 记号的识别与解析、文本扩展名表 |
| `packages/agent/src/instructions/rules/loader.ts` | `createInstructionLoader({ files, homeDir })`：`load({ cwd, cokoHome })`（Run 开始时）与 `nested({ cwd, cokoHome, targetDir, loaded })`（按需）；预算常量 |
| `packages/agent/src/instructions/rules/section.ts` | `formatInstructionsSection`、`formatInstructionFile`、前导语 |
| `packages/agent/src/instructions/rules/nested.ts` | `nestedInstructionsHook`：afterToolCall hook，按需加载并追加到 toolResult |
| `apps/server/src/application/context/instructions.ts` | 上下文贡献：`systemSections`、`hooks`、`report`，受 `instructions.enabled` 控制 |
| `packages/protocol/src/files.ts` | `nestedInstructionPath(text)`：renderer 识别嵌套指令块 |

文件访问经只读端口（`instructions/shared` 的 `ReadOnlyFiles` 加 `realpath`），mtime 缓存与其他加载器共用。

## 发现与顺序

| 作用域 | 位置 | 何时加载 |
| --- | --- | --- |
| `user` | `COKO_HOME`（缺省 `~/.coko`）下的指令文件 | Run 开始时 |
| `project` | 仓库根到 Workspace 根，每层一个 | Run 开始时 |
| `nested` | Workspace 根之下的子目录，每层一个 | Agent 第一次触及该目录时 |

- **每个目录取一个文件：** `AGENTS.md`，不存在时 `CLAUDE.md`；文件名大小写不敏感。空文件不进入上下文。
- **仓库根：** 从 Workspace 向上最近的含 `.git`（目录，或 worktree 的文件）的祖先。遇到家目录或其祖先时停止，家目录本身不算仓库根。不在仓库内时只读 Workspace 根。
- **顺序：** 用户级 → 仓库根 → … → Workspace 根 → 嵌套，越靠后越优先（前导语告诉模型这一点）。同一个文件（按真实路径）只加载一次。
- **重读：** 每个 Run 开始时重新解析，文件未变（mtime 与大小相同）时复用上次结果。Run 进行中的修改到下一个 Run 生效。

## @import

指令文件中的 `@path` 把另一个文件引入上下文，被引入的文件排在引入它的文件之前，作用域与引入者相同。

- **形式：** `@./rel`、`@../rel`、`@~/x`（家目录）、`@/abs`、`@rel/path` 或 `@name.ext`（裸路径须含 `/` 或扩展名）。`@` 前须是行首或空白，因此邮件地址不算；`#` 之后的锚点与末尾标点被去掉；`\ ` 表示空格。
- **不展开的位置：** 围栏代码块（`````` 或 `~~~`）、行内代码、HTML 注释。缩进代码块不识别（与列表续行难以区分），其中的 `@path` 会被展开。
- **限制：** 只接受文本扩展名（md、txt、json、yaml、toml、常见源码等，表见 `imports.ts`）；没有扩展名的文件不展开。最多 5 层；按真实路径防环。
- **边界：** 目标（词法路径与真实路径）都须在仓库根（不在仓库内时为 Workspace）或 `COKO_HOME` 之内；之外的不展开，不弹审批。

## 预算

- 单文件 40 000 字符：超出部分丢弃，文末加一行 `[truncated: …]` 说明，并记 `file-truncated`。被丢弃部分中的 @import 不展开。
- Run 开始时的合计 120 000 字符：超出时从最前面（最远、优先级最低）整文件丢弃，每个记 `budget-exceeded`。嵌套加载只受单文件限制。

## 注入格式

Run 开始时的指令是名为 `instructions` 的 system section（位于基础提示之后，见 [@coko/agent](../../packages/agent/README.md)），没有任何文件时省略：

```text
<instructions>
<前导语：这些指令覆盖默认行为；冲突时越靠后的越优先>

<instruction_file path="/abs/AGENTS.md" scope="user|project">
…
</instruction_file>
</instructions>
```

`path` 是绝对路径，按 XML 属性转义（`& " < >`）。

## 嵌套指令的按需加载

- **触发：** `read`、`write`、`edit` 取目标文件所在目录；`grep`、`find`、`ls` 取目标目录（目标是文件时取其所在目录，没有 `path` 时为 Workspace 根）。调用出错、被拒绝或目标不在 Workspace 根之下时不加载。
- **内容：** Workspace 根之下、到目标目录为止的目录链上尚未进入上下文的指令（含其 @import，边界与限制同上），按远到近各成一个文本块，追加在该次 toolResult 的内容末尾。块以 `<instruction_file path="…" scope="nested">` 开头，随工具结果一起提交为条目，回放与重新订阅看到的内容相同；timeline 用 `nestedInstructionPath` 识别。
- **去重：** "已进入上下文"从当前模型上下文中 toolResult 的嵌套块派生，因此同一会话再次触及不重复，Sidecar 重启后也不重复；回退或压缩移除这些块后，下次触及时重新加载。同一条 assistant 消息的并行调用依次计算，只有一个附加。

## 诊断与日志

读取失败或格式问题只产生诊断 `{ source: 'instructions', path, code, message }`（`path` 为出问题的文件），不阻止 Run：

| code | 何时 |
| --- | --- |
| `read-failed` | 指令文件或目录无法读取 |
| `file-truncated` | 单文件超过 40 000 字符 |
| `budget-exceeded` | 合计超过 120 000 字符，该文件被丢弃 |
| `import-outside-boundary` | @import 的目标在仓库根与 `COKO_HOME` 之外（含经符号链接越出） |
| `import-not-found` | @import 的目标不存在或不是文件 |
| `import-not-text` | @import 的目标不是文本扩展名 |
| `import-cycle` | @import 指回引入链上的文件 |
| `import-depth-exceeded` | @import 超过 5 层 |

- 贡献的 `report(scope)` 返回 `{ breakdown: { instructions }, instructions: { path, scope, chars, truncated }[], diagnostics }`，供上下文用量接口使用；关闭时为空。
- 日志：每个 Run 开始时 info `instructions loaded { workspaceId, sessionId, files, chars, diagnostics }`；按需加载时 info `nested instructions loaded { workspaceId, sessionId, files, diagnostics }`。只记路径与诊断代码，不记文件内容。

## 验证

- `packages/agent/src/instructions/rules/rules.test.ts`：发现顺序、AGENTS.md 优先、没有 `.git`、不越过家目录、符号链接去重、mtime；@import 各形式、代码块与注释、环、5 层、缺失、非文本、越界（含符号链接）；预算；section 格式；嵌套 hook 的触发、顺序、去重与并行。
- `apps/server/src/application/context/instructions.test.ts`：`report()` 的文件与诊断；`instructions.enabled: false` 时没有 section 与 hook。
- `tests/integration/sidecar-instructions.test.ts`：真实 Sidecar（临时 `COKO_HOME`）的 faux requestLog 中 section 的内容与顺序、改文件后下一个 Run、项目设置关闭后不注入、日志；read 子目录后 toolResult 附加嵌套块、再次触及不重复、重新订阅读回一致。

## 延伸阅读

- [ADR 0009](../adr/0009-user-authored-resources-as-files.md)：为什么指令是文件而不在库中。
- [分层配置](configuration.md)：`instructions.enabled` 与项目设置文件。
