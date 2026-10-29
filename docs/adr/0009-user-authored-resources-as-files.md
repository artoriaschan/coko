---
kind: decision
description: "用户编写的指令、Skills 与自定义命令保存为 ~/.coko 与 Workspace 下的普通文件，应用设置与 Memory 仍在 SQLite；为什么两类用户数据存放方式不同。修改这些资源的位置、格式或编辑入口时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 用户编写的指令、Skills 与命令保存为文件

## 上下文

[ADR 0003](0003-settings-and-sessions-in-sqlite.md) 把全局与用户级设置放进 Sidecar 独占的 SQLite 库，项目级配置从仓库文件读取。M3 引入用户级的指令（AGENTS.md）、Skills（SKILL.md 目录）与自定义命令（Markdown 模板）。这些内容由用户用编辑器编写，常与其他 coding agent（claude-code 的 `~/.claude`、pi 的 `~/.pi/agent`、agentskills.io 的 `.agents/skills`）共用或互相复制。读者看到"设置在 SQLite、指令在家目录文件"时会问为什么不统一。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案；本决定于 2026-10-29 规划 M3 时按该指示采纳，未经用户逐条确认。

## 决定

- **用户级资源目录为 `~/.coko`。** 其中 `AGENTS.md`（缺失时读 `CLAUDE.md`）、`skills/<name>/SKILL.md`、`commands/**/*.md`；用户级 Skills 另读 `~/.agents/skills`。环境变量 `COKO_HOME` 可改变该目录（测试与多配置使用）。
- **项目级资源在 Workspace 内。** 指令文件沿目录链读取，Skills 读 `.coko/skills` 与 `.agents/skills`，命令读 `.coko/commands`。
- **应用拥有的状态仍在 SQLite。** 能力开关、MCP Server 的全局配置、Secret 密文、Memory 条目与权限规则由应用写入、经界面编辑，保存在库中。
- **Coko 不改写这些文件。** 设置界面列出、启停（启停状态存库）并报告诊断，编辑由用户在文件中完成；Agent 写入 `.coko` 与 `~/.coko` 属于受保护路径，须审批。

## 理由与备选方案

- **全部存进 SQLite，界面内编辑。** 与设置一致、可事务提交；但无法与其他 agent 共用同一份 Skill 或指令，用户也失去版本管理与熟悉的编辑器。
- **放在 Electron userData 目录。** 路径随平台与应用名变化，不便手工编辑，也与参考项目的家目录约定不一致。
- **Memory 也存为文件（claude-code 的 memdir）。** Memory 由模型频繁增删、需要按作用域查询与界面删除，属于应用状态；ADR 0003 已把 Memory 列入库内。

## 后果与验证

- 每次 Run 开始时重新读取这些文件（按修改时间缓存），修改后下一次 Run 生效；读取失败只产生诊断，不阻止 Run。
- 卸载应用不删除 `~/.coko`。
- implementation 变为 implemented 前需要：以临时 `COKO_HOME` 启动真实 Sidecar 的集成测试覆盖用户级指令、Skills 与命令被加载，修改文件后下一次 Run 读到新内容，界面启停状态在重启后保留且文件不被改写。

**实施证据（2026-10-29，M3 票 03、04、05）。** 行为见 [指令文件](../subsystems/instructions.md)、[命令](../subsystems/commands.md) 与 [Skills](../subsystems/skills.md)。以临时 `COKO_HOME` 启动真实 Sidecar：

- 指令：`tests/integration/sidecar-instructions.test.ts` 中用户级 `COKO_HOME/AGENTS.md` 与项目级指令进入模型请求，修改 Workspace 的指令文件后下一次 Run 读到新内容；子目录指令在触及时加载。
- 命令：`tests/integration/sidecar-commands.test.ts` 中用户级 `COKO_HOME/commands` 与项目级 `.coko/commands` 的模板被展开；`tests/integration/sidecar-skills.test.ts` 中修改用户级命令模板后下一次读取得到新描述（`instructions/commands/commands.test.ts` 覆盖 mtime 缓存）。
- Skills：`tests/integration/sidecar-skills.test.ts` 中四个位置（项目 `.coko` / `.agents`、`COKO_HOME/skills`、`COKO_HOME` 同级的 `.agents/skills`）的 Skill 被发现并进入索引、经 `skill` 工具与 `/<name>` 调用，修改 `SKILL.md` 后下一次读取得到新内容。
- 启停与文件：`apps/desktop/e2e/skills.e2e.test.ts` 在 Skills & Commands 分区停用一个 Skill，SIGKILL Sidecar 由 supervisor 重启后仍停用（状态在库中的 `config` 设置键），`COKO_HOME`、其同级 `.agents` 与 Workspace `.coko` / `.agents` 下的文件逐字节不变。

用户级 `.agents/skills` 取 `COKO_HOME` 的父目录（缺省即 `~/.agents`），使设置了 `COKO_HOME` 的进程不读真实家目录。implementation 为 implemented。

## 来源与后继

- 存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)；受保护路径见 [ADR 0005](0005-permission-mode-and-sandbox.md)。
- 参考：pi v1.4.0 `packages/coding-agent/src/core/resource-loader.ts`、`skills.ts`、`prompt-templates.ts`；claude-code 社区还原版 `src/utils/claudemd.ts`、`src/skills/loadSkillsDir.ts`；[Agent Skills 规范](https://agentskills.io/specification)。
