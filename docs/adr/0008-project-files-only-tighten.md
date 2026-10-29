---
kind: decision
description: "Workspace 内的项目文件（.coko/settings.json、.mcp.json、指令、Skills、命令）只能收紧或补充上下文，不能授予权限或开启全局已关闭的能力；项目 MCP Server 须按配置摘要逐个批准。修改项目级配置的合并、MCP 项目 Server 的加载或 Skills 的 allowed-tools 处理时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 项目文件只能收紧，不能授予

## 上下文

M3 读取 Workspace 内的多类文件：项目设置覆盖、MCP Server 配置、AGENTS.md 等指令文件、Skills 与自定义命令。Workspace 常是克隆来的仓库，内容不一定由用户本人编写。参考项目的做法不同：claude-code 的项目 `settings.json` 可以写 allow 规则，项目 `.mcp.json` 中的 Server 须经用户批准；skill 与命令的 `allowed-tools` 在调用期间临时放行。pi 只在项目受信任时读取项目级 MCP 配置。

[ADR 0003](0003-settings-and-sessions-in-sqlite.md) 已规定项目级配置从仓库文件读取、作为只读覆盖；[ADR 0005](0005-permission-mode-and-sandbox.md) 规定指令和扩展文件的声明不能提升宿主授予的权限。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案；本决定于 2026-10-29 规划 M3 时按该指示采纳，未经用户逐条确认。

## 决定

- **项目设置只收紧。** `<Workspace>/.coko/settings.json` 可以关闭全局已开启的能力（有效值为全局与项目的"与"），可以追加拒绝与询问规则（作为 project 作用域参与判定），可以追加要禁用的 Skill 名。其中的允许规则、默认模式以及开启能力的值被忽略，并给出 `project-cannot-grant` 诊断。
- **项目 MCP Server 逐个批准。** `<Workspace>/.mcp.json` 中的 Server 在用户批准前不启动。批准按 Workspace 与 Server 名保存配置摘要；命令、参数、地址、环境或请求头改变后摘要不同，须重新批准。与全局同名的项目 Server 被忽略并给出诊断，全局定义优先。
- **指令、Skills 与命令只提供上下文。** 它们的内容进入模型上下文，不改变权限判定；Skill 与命令 frontmatter 中的 `allowed-tools` 只在界面中展示，不放行任何调用。
- **注册 Workspace 即同意读取。** 指令、Skills 与命令文件无需额外信任确认即可加载；会启动进程或连接网络的配置（MCP Server）另须批准。

## 理由与备选方案

- **项目设置可以写允许规则（claude-code）。** 团队可以共享免审批配置；但克隆一个仓库就可能让 `Bash(*)` 免审批，与"审批是用户的决定"相冲突。团队需要的放行由用户在 Workspace 作用域保存。
- **整个项目先做信任确认（pi）。** 一次确认后项目文件可以做任何事，粒度太粗，也不能发现之后被修改的 MCP 命令。
- **临时授予 `allowed-tools`。** agentskills.io 规范把它标为实验字段，各实现语义不一；授予后 Skill 的作者实际上决定了权限。

## 后果与验证

- 依赖项目级 allow 规则的团队配置在 Coko 中不生效，须由每个用户保存到 Workspace 作用域；设置界面要显示被忽略的项及原因。
- implementation 变为 implemented 前需要：经协议的集成测试覆盖项目设置中的 allow 规则与开启能力不生效且有诊断、项目 deny 规则在 full-access 下生效、项目关闭的能力不被全局值打开；未批准的项目 MCP Server 不启动、批准后改动命令须重新批准、同名项目 Server 被忽略；Skill 的 `allowed-tools` 不放行调用。

**实施证据（2026-10-29，项目设置）。** 项目设置一条已落地，行为见 [分层配置](../subsystems/configuration.md)：`tests/integration/sidecar-config.test.ts` 经协议覆盖项目设置中的 allow 规则、默认模式与开启能力不生效且有 `project-cannot-grant` 诊断，项目关闭的能力不被全局值打开（全局关闭时项目的 true 也不打开），项目 deny 规则在 full-access 下生效且优先于全局允许规则，项目 allow 规则不放行；`packages/agent/src/config/merge.test.ts` 覆盖合并与诊断。Skill `allowed-tools` 的证据由之后的实施补充，因此 implementation 为 partial。

**实施证据（2026-10-29，项目 MCP Server）。** 行为见 [MCP Server 连接与工具](../subsystems/mcp.md#配置)。`tests/integration/sidecar-mcp.test.ts` 经协议覆盖：未批准的项目 Server 在 Run 之后仍未启动（测试 Server 写入的启动标记文件不存在），界面数据给出完整 command 与 args；按摘要批准后启动；改动 args 后摘要变化、回到 pending-approval、已启动的进程退出，用旧摘要批准返回 409；与全局同名的项目 Server 被忽略并给出 `shadowed-by-global` 诊断（其启动标记文件不存在），全局定义照常启动。`packages/agent/src/extensions/mcp/config.test.ts` 覆盖摘要不受键顺序影响、改命令、参数、环境、地址或请求头时变化。`apps/desktop/e2e/mcp.e2e.test.ts` 覆盖批准对话框显示完整命令与参数。

**实施证据（2026-10-29，Skill 的 allowed-tools）。** 行为见 [Skills](../subsystems/skills.md#权限)。`tests/integration/sidecar-skills.test.ts` 经协议覆盖：项目 Skill `pdf` 声明 `allowed-tools: Bash(*)`，default 模式下 bash 运行其脚本仍产生 approval_request；`GET /api/skills` 原样列出 `allowedTools: ['Bash(*)']`；项目设置 `permissions.deny: ['Skill(notes)']` 在 full-access 下拒绝调用。`apps/desktop/e2e/skills.e2e.test.ts` 覆盖设置分区显示声明的工具并注明只展示、不授予。命令 frontmatter 的 `allowed-tools` 被忽略（[命令](../subsystems/commands.md#模板格式)），同样不放行。三条证据齐备，implementation 为 implemented。

**实施证据（2026-10-29，M3 评审修复：经符号链接越出 Workspace 与 Server 名）。** "注册 Workspace 即同意读取"只覆盖真实路径在 Workspace（指令为仓库根）之内的文件：仓库内指向外部的符号链接不能把外部文件带进上下文，也不能把外部目录变成免审批的读取根。行为见 [指令文件](../subsystems/instructions.md#发现与顺序)、[Skills](../subsystems/skills.md#位置与优先级) 与 [MCP Server](../subsystems/mcp.md#配置)。`packages/agent/src/instructions/rules/rules.test.ts` 覆盖目录链与嵌套加载的 `AGENTS.md` 指向外部时跳过并诊断 `file-outside-boundary`、Read 拒绝规则覆盖的指令文件与 @import 不加载、`.env` 与受保护路径不作为 @import 目标；`packages/agent/src/instructions/skills/skills.test.ts` 与 `tests/integration/sidecar-skills.test.ts` 覆盖项目 Skill 经链接指向外部时不加载、诊断 `skill-outside-workspace`、读取外部文件仍产生 approval_request；`packages/agent/src/extensions/mcp/config.test.ts` 覆盖项目 Server 与全局只差大小写或 `-` / `_` 时被忽略（规则 `mcp__github` 不会匹配项目 Server `GitHub` 的工具）；`tests/integration/sidecar-mcp.test.ts` 与 `apps/desktop/e2e/mcp.e2e.test.ts` 覆盖批准时显示 env 的完整键值。

## 来源与后继

- 参考实现：claude-code 社区还原版 `src/services/mcp/utils.ts`（项目 Server 批准）、`src/tools/SkillTool`（allowed-tools）；pi v1.4.0 `packages/coding-agent/src/extensions/mcp/config.ts`。本页已提炼所需结论。
- 判定顺序见 [ADR 0005](0005-permission-mode-and-sandbox.md)；存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
