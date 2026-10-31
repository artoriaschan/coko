---
kind: decision
description: "无界面运行（headless）中的审批不等待，在 PermissionRequest Hook 之后自动拒绝并让 Run 继续或按选项失败；Provider 的连接信息与 Model Catalog 由启动配置写入，密钥只读环境变量。修改无界面运行的审批、Provider 来源或退出码时回看。"
status: accepted
implementation: not-started
lifecycle: active
category: feature
---

# 无界面运行的审批自动拒绝，Provider 来自启动配置

## 上下文

[Agent 执行约定](../tech-stack/agent-runtime.md) 的 SDK / Headless / Protocol 一行要求无界面的库调用、结构化结果与事件订阅。Sidecar 已能脱离桌面独立运行，但两条既有决定假设有界面：[ADR 0014](0014-subagents-as-child-sessions.md) 规定子代理的审批等待用户、不自动拒绝；[ADR 0010](0010-provider-one-shot-save.md) 规定 Provider 只能由 main 经控制消息保存，独立运行的 Sidecar 不能创建 Provider。参考项目：claude-code 的 `-p` 模式遇到需要审批的调用直接拒绝，模型看到拒绝原因；pi 的 json 模式同样不交互。

用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-31 规划 M6 时按该指示采纳，未经用户逐条确认。

## 决定

- **审批自动拒绝。** headless 入口中，判定为询问的调用先运行 PermissionRequest Hook；没有 Hook 给出决定时立即拒绝，结果文本说明"没有审批者"与放宽方式（更宽的权限模式或允许规则），授权决定记为来自 headless。缺省 Run 继续；选项 `--on-approval fail` 时拒绝后停止 Run，进程以专门的退出码结束。
- **Provider 来自启动配置。** headless 入口接受一个 Provider 配置文件（连接信息与 Model Catalog，不含密钥），启动时在一个事务中新建或更新；密钥只读 `COKO_CREDENTIAL_<PROVIDER_ID>`，不入库。这是 ADR 0010"一次提交、一条路径"之外、只在无界面运行中存在的第二条路径。
- **GUI 不受影响。** 桌面应用中的子代理与定时任务的审批照常等待（ADR 0014）。

## 理由与备选方案

- **等待审批（与 GUI 相同）。** 无人回答时进程一直挂起，CI 与脚本只能靠外部超时杀掉，留下被中断的 Run；拒绝让模型有机会换一种做法，结果也能在输出中看到。
- **headless 中自动批准。** 等于在没有人的地方授予权限，违背"审批是用户的决定"（[ADR 0005](0005-permission-mode-and-sandbox.md)）；需要免审批时由调用者显式给出更宽的模式或允许规则。
- **headless 也只经 main 保存 Provider。** 没有 main 就没有 safeStorage 与控制 IPC，无界面运行将完全不能配置模型；密钥仍不入库，只是连接信息有了第二个写入口。

## 后果与验证

- 依赖审批的任务在 headless 中会做不成，调用者须预先给出权限模式或规则；同一个库可以被 GUI 与 headless 先后打开（租约互斥，不能同时）。
- implementation 变为 implemented 前需要：以打包产物或源码入口运行 headless 的集成测试覆盖：default 模式下的写入被拒绝且结果文本说明原因、授权决定来自 headless、PermissionRequest Hook 可以代答、`--on-approval fail` 的退出码、配置文件中的 Provider 在一个事务中写入且库中没有密钥、`COKO_CREDENTIAL_<ID>` 缺失时为明确的错误。

## 来源与后继

- 参考实现：claude-code 社区还原版的 print 模式；pi v1.4.0 `packages/coding-agent` 的 json 模式。本页已提炼所需结论。
- 被细化的决定：[ADR 0010](0010-provider-one-shot-save.md)（独立运行的 Provider）、[ADR 0014](0014-subagents-as-child-sessions.md)（审批等待只适用于有界面时）。
