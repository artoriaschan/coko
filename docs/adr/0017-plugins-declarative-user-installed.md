---
kind: decision
description: "插件只声明 Skills、命令、子代理定义、Hook、MCP 与 LSP Server，不在 Sidecar 中执行插件代码；只有用户级安装，文件复制到 ~/.coko/plugins；按清单与可执行声明的 digest 批准，批准后插件的 Hook、MCP 与 LSP 与全局配置同级。修改插件的来源、清单、批准或贡献的加载时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 插件只声明资源，用户级安装，按可执行声明批准

## 上下文

[Agent 执行约定](../tech-stack/agent-runtime.md) 的 Plugins 一行要求扩展清单、兼容检查、能力注册、启用与禁用，由 server 负责下载、安装、更新与卸载。参考项目的做法不同：pi 的 package 可以带进程内运行的 TypeScript 扩展，项目级 package 须先信任整个项目；claude-code 的插件只声明 commands、agents、skills、hooks、MCP 与 LSP Server，并有市场与自动更新。Coko 已有的约束：项目文件只能收紧、会启动进程的项目配置逐个批准（[ADR 0008](0008-project-files-only-tighten.md)）；项目 Hook 只收紧（[ADR 0013](0013-external-hooks-tighten-only.md)）；用户编写的资源为文件、应用状态在 SQLite（[ADR 0009](0009-user-authored-resources-as-files.md)）；Secret 只来自登记条目，项目文件不能引用（[ADR 0007](0007-secrets-from-registered-entries.md)）。

需要长期记录的取舍：插件能不能带代码；装在哪里、谁能装；批准什么、批准后有多大权力。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M6 时按该指示采纳，未经用户逐条确认。

## 决定

- **只声明，不执行插件代码。** 插件可以提供 Skills、命令、子代理定义、Hook、MCP Server 与 LSP Server；会执行的只有 Hook 命令与 MCP / LSP 进程，它们沿用现有的进程登记、超时、环境剔除与秘密脱敏。Sidecar 不加载插件中的 JavaScript / TypeScript 模块。
- **只有用户级安装，复制到 `~/.coko/plugins/<name>`。** 来源为本机目录或 git URL（宿主 git 浅克隆）；安装与更新复制一份快照，源目录之后的改动不生效。复制时拒绝逃出插件根的符号链接，并限制文件数与体积。安装记录（来源、版本、commit、digest、已批准的 digest、启用状态）存 SQLite。没有项目级插件、市场与 npm 来源。
- **按可执行声明的 digest 批准。** 安装或更新后，在用户按完整内容（每个 Hook 的事件、matcher 与命令，每个 MCP / LSP Server 的命令、参数、地址与环境键）批准之前，插件的任何资源都不加载；digest 覆盖清单与这些声明，变化后须重新批准。
- **批准后与全局配置同级。** 插件的 MCP 与 LSP Server 不再逐个批准；插件 Hook 与全局 Hook 同等对待，其 allow 参与聚合，仍按 ADR 0013 越不过拒绝规则、询问规则、受保护路径与越出可写根，也不能免掉提权与计划审阅。插件不能声明权限规则、默认模式或能力开关，其 MCP Server 不能引用 Secret。资源以插件名作命名空间，不覆盖用户与项目的同名资源。
- **清单。** `.coko-plugin/plugin.json`，缺失时读 claude-code 的 `.claude-plugin/plugin.json` 并忽略不支持的字段；`engines.coko` 不满足当前版本时不加载。

## 理由与备选方案

- **进程内扩展（pi）。** 能力最强，但插件代码与 Sidecar 同一进程，可以绕过权限判定、命令沙箱与秘密脱敏，读取库中的密文与内存中的凭据；Coko 的所有安全约束都建立在"Agent 的动作经同一接入链"之上。
- **原地引用插件目录（不复制）。** 开发插件时方便，但源目录的任何改动立即生效，批准的 digest 不再对应实际运行的内容。需要迭代时用"更新"重新复制。
- **项目级插件（pi 的项目 package、claude-code 的项目插件设置）。** 克隆的仓库就能声明要安装与运行的插件，与 ADR 0008 拒绝过的情形相同；项目需要的资源已有 `.coko/skills`、`.coko/commands`、`.coko/agents` 与项目 MCP。
- **插件 Hook 也只收紧（与项目 Hook 相同）。** 更保守，但插件是用户主动安装、批准时已看到完整命令的用户级资源，与用户自己写进全局设置的 Hook 等效；只收紧会让"自动批准某类调用"的插件在 Coko 中没有用处。
- **每个插件 MCP Server 单独批准。** 与项目 MCP 一致，但安装时已经按完整命令批准过同一批声明，再批准一次只增加点击，没有增加信息。

## 后果与验证

- 依赖进程内扩展的 pi package 与依赖市场、用户配置项（`userConfig`）的 claude-code 插件不能在 Coko 中使用；只声明资源的 claude-code 插件可以直接安装。
- 卸载会删除 `~/.coko/plugins/<name>`；删除前确认真实路径在 plugins 根下。
- implementation 变为 implemented 前需要：真实 Sidecar 集成测试覆盖目录与 git 来源的安装、未批准时不加载任何资源（Hook 不运行、MCP / LSP 进程不启动、Skill 不在索引中）、批准后各类资源可用且以插件名作命名空间、更新改动 Hook 命令后回到待批准、插件 Hook 的 allow 越不过询问规则与受保护路径、清单路径或符号链接逃出插件根时拒绝、插件 MCP 引用 Secret 时不加载、`engines.coko` 不满足时不加载、卸载停止其进程并删除目录；界面中批准对话框显示完整命令。

## 实施记录

- 2026-11-01，插件核心（服务端）：清单与诊断、目录与 git（`file://` / `https://` 浅克隆）来源的安装与复制（拒绝逃出插件根的符号链接，≤ 5 000 文件、≤ 50 MB）、按 digest 批准、启用 / 禁用 / 更新 / 卸载（删除前确认真实路径在插件根下）、`PluginContributionsPort` 的快照与变更通知以及 `/api/plugins` 已实现，当前行为见 [插件](../subsystems/plugins.md)。证据：`tests/integration/sidecar-plugins.test.ts`（未批准时 Skill 不在索引、Hook 不运行、MCP 与语言服务器进程不启动；批准后带插件名可用；更新改动 Hook 命令后回到待批准；卸载停止进程并删除目录）、`sidecar-plugins-trust.test.ts`（插件 Hook 的 allow 越不过询问规则、`.git/config` 与越出可写根；路径与符号链接逃出插件根；MCP 引用 Secret；`engines.coko` 不满足）、`secrets-gate-plugins.test.ts`、`packages/agent/src/extensions/plugins/{manifest,copy}.test.ts`、`apps/server/src/application/plugins.test.ts`、`apps/desktop/e2e/package-smoke.e2e.test.ts`（打包应用中插件的 MCP Server 被启动）。插件的语言服务器只进入贡献快照与批准内容，进程由代码智能启动；界面中的批准对话框尚未交付，implementation 为 partial。
- 2026-11-01，插件界面：设置 → 插件分区（文件夹与 git 安装、状态、来源与 commit、贡献计数、诊断、启用开关、更新、卸载确认）与批准对话框（每条 Hook 的事件、matcher 与完整命令，每个 MCP / 语言服务器的命令、参数、地址与环境变量的键，资源名字；只有点"批准"才批准，内容变化时提示并换成最新内容）已交付，当前行为见 [插件](../subsystems/plugins.md#界面)。证据：`apps/desktop/e2e/plugins.e2e.test.ts`（真实 Electron 与 Sidecar：安装 → 待批准 → 对话框中的完整 Hook 命令 → 批准 → `/` 菜单出现 `sample:hello`，禁用后消失；更新改动 Hook 命令后回到待批准；卸载）、`apps/desktop/src/renderer/features/settings/plugins-section.browser.test.tsx`、`apps/desktop/src/renderer/stores/plugins-store.test.ts`。implementation 改为 implemented。
- 实施中补齐的一处：`/<skill>` 与 `/<command>` 展开时文件正文先按值替换登记的 Secret 再进入 user message 条目（此前只有发给模型的请求被脱敏），插件与用户自己的文件都适用。

- 2026-11-05，安装路径相对主数据根：用户确认整体移动 `COKO_HOME` 后新安装的插件仍可使用。新记录保存 `plugins/<name>`，在读取、更新和卸载时基于当前主根解析；新相对记录的摘要覆盖根目录替换前的完整可执行声明，使根移动不改变批准状态。旧绝对记录保留原路径及展开后摘要，不为摘要格式变化自动授予批准；真实声明变化仍须重新批准。验证见 `tests/integration/sidecar-plugins.test.ts` 的整体移动与旧记录兼容用例，以及 `manifest.test.ts` 的可移动摘要敏感范围；当前规则见[插件](../subsystems/plugins.md#digest-与批准)。

## 来源与后继

- 参考实现：claude-code 社区还原版 `src/utils/plugins/schemas.ts`、`pluginLoader.ts`；pi v1.4.0 `packages/coding-agent/docs/packages.md`。本页已提炼所需结论。
- 相关决定：[ADR 0007](0007-secrets-from-registered-entries.md)、[ADR 0008](0008-project-files-only-tighten.md)、[ADR 0009](0009-user-authored-resources-as-files.md)、[ADR 0013](0013-external-hooks-tighten-only.md)。
