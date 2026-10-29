---
kind: reference
description: "当前的 Skill 契约：四个发现位置与优先级、SKILL.md 的校验与诊断、<available_skills> 索引与预算、skill 工具与权限、Skill 目录作为额外读取根、/<skill-name> 展开、skills.* 开关、GET /api/skills 与 Skills & Commands 分区。修改 Skill 的加载、调用、权限或设置分区前查阅。"
lifecycle: active
---

# Skills

本文说明 Coko 当前如何发现、列出与调用 [Skill](../../GLOSSARY.md)：Sidecar 在每个 Run 开始时发现 Skill，把可由模型调用的 Skill 列进系统提示；模型经 `skill` 工具加载一个 Skill，用户以 `/<name> 参数` 显式调用。Skill 是文件的理由见 [ADR 0009](../adr/0009-user-authored-resources-as-files.md)；`allowed-tools` 不放行调用的理由见 [ADR 0008](../adr/0008-project-files-only-tighten.md)；开关的合并见 [分层配置](configuration.md)；`/<name>` 进入命令目录的方式见 [命令](commands.md)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/instructions/skills/types.ts` | `Skill`、`skillLocations`（四个位置） |
| `packages/agent/src/instructions/skills/parse.ts` | `parseSkillFile`：frontmatter 校验 |
| `packages/agent/src/instructions/skills/loader.ts` | `createSkillLoader`：发现、去重、遮蔽、按 mtime 缓存；`content` 读正文与文件清单 |
| `packages/agent/src/instructions/skills/section.ts` | `skillsSection`：`<available_skills>` 与预算 |
| `packages/agent/src/instructions/skills/tool.ts` | `createSkillTool`、`expandSkillInvocation`、`formatSkillBlock` |
| `packages/agent/src/policy/decide.ts` | 规则名 `Skill` 的别名 |
| `packages/protocol/src/skills.ts` | `SkillInfo`、`SkillListResponse`、`skillPaths` |
| `apps/server/src/application/context/skills.ts` | Skills 贡献：system section、工具、读取根、命令来源、上下文报告、列表 |
| `apps/server/src/http/routes/skills.ts` | `GET /api/skills` |
| `apps/desktop/src/renderer/features/settings/skills-section.tsx`、`stores/skills-store.ts` | Skills & Commands 设置分区 |

## 位置与优先级

| 顺序 | 位置 | scope |
| --- | --- | --- |
| 1 | `<Workspace>/.coko/skills` | project |
| 2 | `<Workspace>/.agents/skills` | project |
| 3 | `COKO_HOME/skills`（缺省 `~/.coko/skills`） | user |
| 4 | `COKO_HOME` 同级的 `.agents/skills`（缺省即 `~/.agents/skills`） | user |

- 第 4 个位置取 `COKO_HOME` 的父目录而不是 `os.homedir()`：缺省时两者相同；设置了 `COKO_HOME` 时（测试与多配置），用户级资源全部跟随它，不读真实家目录。
- 每个位置之下，含 `SKILL.md` 的目录是一个 Skill 根，不再向下；不含时继续向下找（最多 8 层），跳过 `.` 开头的目录与 `node_modules`。位置目录本身不是 Skill 根。
- 按 `SKILL.md` 的真实路径去重：指向同一目录的符号链接只算一次，不记诊断。
- 同名时排在前面的位置优先，被遮蔽的记诊断 `shadowed`。
- 每个 Run 开始时与每次 `GET /api/skills` 都重新列目录；`SKILL.md` 未变（mtime 与大小）时复用上次的解析结果。新建或修改的 Skill 在下一次 Run 生效。

## SKILL.md 格式

按 [Agent Skills 规范](https://agentskills.io/specification) 校验 frontmatter；不合规的 Skill 不加载，记一条诊断（第一个不合规项）：

| 键 | 要求 | 不合规时的 code |
| --- | --- | --- |
| `name` | 必填；1–64 个 `[a-z0-9-]`，首尾不为连字符，无连续连字符 | `invalid-name` |
| `name` | 等于所在目录名 | `name-mismatch` |
| `description` | 必填，非空 | `missing-description` |
| `description` | 不超过 1024 个字符 | `description-too-long` |
| `compatibility` | 可选；字符串，不超过 500 个字符 | `invalid-value` |
| `metadata` | 可选；字符串到字符串的映射 | `invalid-value` |
| `license` | 可选；字符串 | `invalid-value` |
| `allowed-tools` | 可选；空格分隔的字符串或字符串列表。只记录与展示，不放行任何调用 | `invalid-value` |
| `disable-model-invocation` | 可选；布尔。true 时不进索引、`skill` 工具不调用，只能由用户以 `/<name>` 调用 | `invalid-value` |
| `argument-hint` | 可选；字符串，在 / 菜单中显示 | `invalid-value` |

其余键忽略。另有 `invalid-frontmatter`（frontmatter 不是合法的 YAML 映射）、`read-failed`（文件或目录无法读取）与 `shadowed`。诊断形状为 `{ source: 'skills', path, code, message }`，不阻止 Run。

## 索引与调用

- **`<available_skills>`**：名为 `skills` 的 system section，位于指令之后、Memory 之前。每项 `<skill>` 含 `<name>`、`<description>` 与 `<location>`（`SKILL.md` 的绝对路径），按优先级与发现顺序排列，文本经 XML 转义。只列启用且未声明 `disable-model-invocation` 的 Skill；没有可列的时不注入。合计不超过 8000 个字符：放不下时前面的完整列出，其余只列名字并注明数量（`N more skills listed by name only: …`）；名字也放不下时列出放得下的名字并注明其余的数量。
- **`skill` 工具**：参数 `{ name, args? }`。只在本次 Run 至少有一个可由模型调用的 Skill 时注册（否则工具清单与 M2 相同）。返回 `<skill name location>` 块：`Base directory for this skill: <dir>`、去掉 frontmatter 的正文、`<skill_files>` 中的文件清单（相对基目录，不含 `SKILL.md` 与 `.` 开头的项，最多 50 项，超出时注明截断）；给了 args 时末尾追加 `ARGUMENTS: <args>`。`details = { name, path, baseDir, files, filesTruncated }`。未知、停用或 `disable-model-invocation` 的名字作为工具错误返回，错误中列出可用的名字。
- **`/<skill-name> 参数`**：Skills 贡献向命令目录登记每个已发现的 Skill（来源 `skill`，停用的 `enabled: false`）。调用时提交 `command { name, args, source: 'skill' }`，再提交展开后的 user message：同一个 `<skill …>` 块，参数原样附在其后（空一行）。`disable-model-invocation` 的 Skill 也能这样调用。同名时项目与用户模板优先于 Skill（见 [命令](commands.md#来源命名与优先级)）。`SKILL.md` 在展开时已不能读取或不再合规时，提交以 400 `bad-request` 失败。

## 权限

| 项 | 行为 |
| --- | --- |
| `skill` 工具 | 权限类 context-read：四种模式都不审批 |
| 规则 | 规则名 `Skill`（`skill` 归一为 `Skill`，工具尚未注册时也接受），内容为 Skill 名：`Skill(pdf)` 可 deny 或 ask；项目设置的 `permissions.deny` 同样生效 |
| 读取根 | 启用的 Skill 的基目录作为额外读取根：其下的 read、grep、find、ls 与 Workspace 内读取同样处理（不报 `outside-workspace`） |
| 脚本 | bash 运行 Skill 目录内的脚本照常判定（default 下审批）；`allowed-tools: Bash(*)` 不改变判定 |
| 写入 | Skill 目录不是可写根；`~/.coko` 与 `.coko` 下的写入另属受保护路径 |

判定顺序与读取根的实现见 [权限判定与审批](permissions.md)。

## 开关

`skills.enabled`（缺省 true）与 `skills.disabled`（名字列表；项目设置可追加，与全局取并集）。停用的 Skill 不进索引，`skill` 工具不调用，其目录不是读取根，`/<name>` 原样作为普通消息；`skills.enabled` 为 false 时不注入索引、不注册工具。停用不影响发现：`GET /api/skills` 与命令目录照常列出（`enabled: false`）。`commands.*` 不作用于 Skill。

## 协议

`GET /api/skills?workspaceId=…` → `{ skills: SkillInfo[], diagnostics }`。`SkillInfo = { name, description, path, scope, enabled, allowedTools, disableModelInvocation }`，按优先级与发现顺序。缺 workspaceId 时 400，Workspace 不存在时 404。启停经 `PUT /api/config` 修改全局的 `skills.enabled` 与 `skills.disabled`。

## 界面

设置的 Skills & Commands 分区读取当前会话或草稿所在的 Workspace（没有时提示打开一个会话）：

- "使用 Skills"开关（全局 `skills.enabled`；项目设置关闭时注明）。
- Skills 列表：名字、来源（项目 / 用户）、描述、`SKILL.md` 路径、声明的工具（注明只展示、不授予）、只能显式调用的提示与启停勾选。勾选写全局 `skills.disabled`；被项目设置停用的注明来源。
- 命令列表：项目、用户模板与 MCP 提示模板（内置命令总是启用，Skill 命令随 Skill），勾选写全局 `commands.disabled`。
- 问题：Skill 与命令的诊断（按 code 本地化标题，显示文件路径与原始说明）。

保存时先读取全局配置与 revision，只改相应的键后整体提交。界面不改写任何 Skill 或命令文件。

## 验证

- `packages/agent/src/instructions/skills/skills.test.ts`：四个位置与优先级、遮蔽、Skill 根不再向下、跳过 `.` 目录与 `node_modules`、符号链接去重；各类不合规的诊断；可选字段；read-failed；mtime 缓存；索引格式、转义、预算的两级截断；工具输出、文件清单截断、未知名字、`disable-model-invocation`；`/<name>` 展开。
- `packages/agent/src/policy/decide.test.ts`：`Skill` 规则名与按内容的 deny / ask。
- `tests/integration/sidecar-skills.test.ts`：真实 Sidecar（临时 `COKO_HOME` 与其同级的 `.agents`）。四种模式下 `skill` 都不审批且结果含正文、基目录与文件清单；faux requestLog 中的索引；Workspace 之外的 Skill 参考文件读取不审批、bash 运行脚本审批（含 `allowed-tools: Bash(*)`）；项目设置与 Workspace 规则中的 `Skill(name)` deny；`/pdf 参数` 的 command 条目与展开；`skills.disabled`（全局与项目追加）与 `skills.enabled=false`；`GET /api/skills`、诊断、命令目录中的 Skill 来源、修改 `SKILL.md` 后读到新内容。
- `apps/desktop/e2e/skills.e2e.test.ts`：Electron 中的 Skills & Commands 分区（来源、路径、声明的工具、诊断），停用一个 Skill 后重启 Sidecar 仍停用，用户文件逐字节不变。

## 延伸阅读

- [ADR 0008](../adr/0008-project-files-only-tighten.md)：项目文件与 `allowed-tools` 不授予权限。
- [ADR 0009](../adr/0009-user-authored-resources-as-files.md)：为什么 Skill 是文件。
- [命令](commands.md)：命令目录、同名优先级与 `command` 条目。
