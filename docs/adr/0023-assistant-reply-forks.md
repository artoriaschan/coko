---
kind: decision
description: "Fork 支持成功助手回复的包含边界，保留旧用户之前边界、当前文件与源计量归属。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# Fork 以成功助手回复为包含边界，保留当前文件与来源事实

## 上下文

[ADR 0006](0006-file-checkpoints-and-rewind.md) 最初以用户消息之前为 Fork 边界，并将目标指令回填新 Session。用户于 2026-11-04 确认在成功助手回复底栏创建新对话分支：包含所选回复之前的有效上下文、打开空输入区、使用当前目录和文件。直接复用用户锚点会丢失所选回答并回填不相干草稿。本决定接续 ADR 0006 的 Fork 边界与界面入口；其 Checkpoint、文件追踪和 append-only 回退约束保持有效。

## 决定

- 请求显式区分 `assistant-inclusive` 与 `user-before`，省略时保持旧用户之前语义。助手入口只接受有效历史中成功结束 Run 的最后一条非空最终助手消息；忙碌、待审批、待结果确认、归档和已移除 Worktree 的只读限制由服务端检查。
- 先截取所选消息包含边界，再选择该时刻有效的压缩摘要与保留消息。后续摘要不进入更早分支；工具调用、结果和思考随有效模型消息保留。助手新分支输入为空，旧用户调用继续返回目标原始文本。
- 新 Session 继承源 Project、Workspace、Worktree、模型与推理档位；助手分支采用源当前权限状态，避免从早期回复绕过后来的收紧。共享当前目录及文件，不创建 Worktree、不恢复历史文件。
- 新条目的运行身份不继承。`fork_origin` 保存来源和复制消息的原提交时间、成功最终回复证明及来源计量事实；这些只读来源副本不产生新 Run 或新 model_request，不计入新 Session 新增消耗。旧记录无法证明原发送时刻时不显示复制时刻作为发送时间。
- [ADR 0003](0003-settings-and-sessions-in-sqlite.md) 的不可修改 Session Entry 不变。Checkpoint 仍以用户消息锚定，write/edit 首次修改前保存内容寻址备份，超过 10 MiB 不备份；bash 与外部副作用不追踪。回退以追加记录撤回有效上下文，支持仅对话／仅代码／两者，文件恢复保留预览、偏离和路径边界检查。

## 理由与备选方案

保留双边界契约让既有调用方无需迁移即可继续执行用户之前分叉。把所有 Fork 改成助手包含边界会静默改变旧 API；为新分支复制文件或创建历史 Worktree 则违背用户确认的当前文件语义。复制消息的来源证明让历史回复仍可追溯和再次分支，不把复制时间、旧费用或停留在 stop/length 的阶段消息误认为新的事实。

## 后果与验证

助手分支不能回滚代码，后续请求会使用当前文件。来源计量仅用于历史阅读，预算和 Session 累计继续按本 Session 的真实请求归属。协议集成必须核对下一次模型请求、压缩前后边界、原条目及文件不变、Worktree 目录和服务端限制；实际 App 与静默 Electron 验证自动打开、空输入、源草稿和键盘入口。

实现入口：[Fork 规划](../../packages/agent/src/agents/fork.ts)、[服务端前置条件](../../apps/server/src/application/checkpoints.ts)、[协议](../../packages/protocol/src/checkpoints.ts)。验证：[Sidecar 回退与分支](../../tests/integration/sidecar-rewind.test.ts)、[App 助手分支](../../apps/desktop/src/renderer/features/conversation/assistant-branch.browser.test.tsx)。上述场景及真实 Electron 的助手底栏用例已通过，旧用户边界协议与回退检查继续通过。

## 来源与后继

2026-11-04 用户确认上述助手包含边界与保留旧调用的需求。本决定接续 [ADR 0006](0006-file-checkpoints-and-rewind.md) 的 Fork 范围；文件追踪与回退的原理由保留在该历史记录，当前行为由[工作台](../subsystems/workbench.md)和[上下文管理](../subsystems/context.md)说明。
