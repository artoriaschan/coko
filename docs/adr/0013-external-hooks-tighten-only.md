---
kind: decision
description: "外部 Hook 只支持 command 型；PreToolUse 与 PermissionRequest 的 allow 与允许规则同位，不能越过拒绝规则、询问规则、受保护路径与越出可写根，也不能免掉提权与计划审阅；项目 Hook 逐条批准且只能收紧；超时与失败视为没有决定。修改 Hook 的事件、配置、决定组合或项目 Hook 的处理时回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# 外部 Hook 只能收紧判定，allow 不越过规则

## 上下文

M5 接入用户配置的外部 Hook：在工具调用、提交、Run 结束、压缩等时刻运行用户的命令，命令可以阻断、追加上下文或给出权限决定。参考实现 claude-code（社区还原版）有 27 个事件与 command、prompt、http、agent 四种 Hook；同一事件的 Hook 并行执行，决定按 deny > ask > allow 聚合，Hook 的 allow 只免掉对话框、拒绝与询问规则仍生效；项目 `settings.json` 中的 Hook 与全局 Hook 一样直接运行。

Coko 已有的约束：[ADR 0005](0005-permission-mode-and-sandbox.md) 的判定顺序（拒绝规则 → 询问规则 → 受保护路径 → 越出可写根 → 模式放行 → 允许规则 → 询问），并预告"以后接入的 Hook 放行不能越过前四步"；[ADR 0008](0008-project-files-only-tighten.md) 规定项目文件只能收紧，会启动进程的项目配置须逐个批准。Hook 会在无人值守的 Goal Round 与定时任务中运行。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M5 时按该指示采纳，未经用户逐条确认。

## 决定

- **只有 command 型。** Hook 是 `bash -c` 运行的命令，stdin 收到一行 JSON，exit 2 表示阻断，exit 0 时 stdout 可以是 JSON 决定。prompt、http、agent 型不支持：前两者在无人值守时额外花费模型费用且不受 Goal 预算约束，http 型是新的外发通道。事件为按 Coko 生命周期裁剪后的子集，名字与输入输出字段沿用 claude-code，便于复用配置。
- **allow 与允许规则同位。** PreToolUse 的决定与判定合并：Hook 的 deny 优先于一切；判定为拒绝时拒绝；判定的询问来自询问规则、受保护路径或越出可写根，或调用需要提权与计划审阅时，仍然询问；之后 Hook 的 ask 强制询问（没有建议规则）；Hook 的 allow 只能放行原本要在最后一步询问的调用，与一条允许规则等效。PermissionRequest 的 allow 同样只解决最后一步的询问。Hook 不能改写工具参数。
- **项目 Hook 逐条批准、只收紧。** Workspace 内 `.coko/settings.json` 的 Hook 在用户按摘要（事件、matcher、条件、命令、超时）批准前不运行，改动后须重新批准。项目 Hook 的 allow 被忽略；项目文件不能关闭全局 Hook。全局 Hook 保存在应用设置中（[ADR 0003](0003-settings-and-sessions-in-sqlite.md)）。
- **失败视为没有决定。** 超时（缺省 60 秒）、非 0 非 2 的退出与无法解析的输出都按"Hook 没有给出决定"处理并记录，Run 继续。

## 理由与备选方案

- **Hook 的 allow 可以越过询问规则（把 Hook 当作最高权威）。** 一个打印 `{"permissionDecision":"allow"}` 的脚本就能让 `.git/hooks` 的写入与越出沙箱的命令免审批，审批不再是用户的决定。claude-code 同样只让 allow 免对话框。
- **项目 Hook 与全局 Hook 同等对待（claude-code）。** 克隆一个仓库就会在下一次工具调用时执行仓库作者的命令，这正是 ADR 0008 为项目 MCP Server 拒绝过的情形。
- **失败即拒绝（fail-closed）。** 一个写错的 Hook 会阻断全部工具调用，无人值守的 Goal 因此停在每一步；Hook 叠加在规则、模式与沙箱之上，规则仍完整生效，需要可靠拦截的场景应写拒绝规则。代价是 Hook 超时时它想拦下的调用会继续走正常判定。
- **支持 updatedInput。** 改写后的参数要重新判定，且让 Hook 成为绕过规则匹配的写入路径；没有已知需求。

## 后果与验证

- 依赖"Hook 自动批准一切"的 claude-code 配置在 Coko 中只能免掉最后一步的询问。Hook 在每次工具调用前多一次进程启动，没有匹配的事件不启动进程。
- implementation 变为 implemented 前需要：以真实 Sidecar 覆盖 Hook 的 deny 在 full-access 下生效、allow 不免掉询问规则 / 受保护路径 / 越出可写根 / 提权、ask 在 full-access 下询问、并行聚合 deny > ask > allow、exit 2 的阻断、超时与非法输出按无决定处理；未批准的项目 Hook 不运行、改命令后须重新批准、项目 Hook 的 allow 不生效、项目设置关不掉全局 Hook；工具输出伪造 Hook JSON 不改变决定；Hook 进程登记并在超时后被终止。

**实施证据（2026-10-31，工具事件）。** PreToolUse、PermissionRequest、PostToolUse 与 PostToolUseFailure 已落地，机制见 [外部 Hook](../subsystems/hooks.md)。`tests/integration/sidecar-hooks.test.ts` 以真实 Sidecar 与 Hook 夹具覆盖：Hook 的 deny（exit 2 与 JSON）在 full-access 下生效且 Run 继续；allow 不免掉询问规则、`.git/config` 写入、越出可写根、提权与 plan-exit（后两者只在 darwin）；ask 在 full-access 下询问且没有建议规则；两个各 sleep 1 秒的 Hook 并行（总耗时 < 1.8 秒）且 deny 胜过 allow；忽略 SIGTERM 的 Hook 超时后进程组在 timeout + 2 秒内消失、登记行删除、按无决定处理（darwin）；非 0 非 2 与非法 JSON 按无决定；未批准的项目 Hook 不运行、改命令后须重新批准、项目 Hook 的 allow 不生效、项目设置关不掉全局 Hook；bash 输出伪造的 Hook JSON 不改变下一次调用的判定。`secrets-gate-hooks.test.ts` 覆盖 Hook 的 stdin、`hook_run` 与追加的上下文中没有登记明文。生命周期事件（UserPromptSubmit、Stop、SubagentStart / SubagentStop、PreCompact、Notification）与设置分区尚未交付，因此 implementation 为 partial。

## 来源与后继

- 参考实现：claude-code 社区还原版 `src/utils/hooks.ts`、`src/schemas/hooks.ts`、`src/services/tools/toolHooks.ts`。本页已提炼所需结论。
- 判定顺序见 [ADR 0005](0005-permission-mode-and-sandbox.md)；项目文件见 [ADR 0008](0008-project-files-only-tighten.md)；Hook 进程登记见 [ADR 0012](0012-host-process-registry.md)。
