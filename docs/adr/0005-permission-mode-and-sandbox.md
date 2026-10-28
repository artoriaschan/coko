---
kind: decision
description: "每个 Session 只有一个权限模式，同时决定免审批范围与命令的 Seatbelt 沙箱档位；审批与沙箱叠加，越出沙箱只能单次提权。修改权限模式、规则判定、沙箱或审批卡时回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# 权限模式同时决定审批范围与沙箱档位

## 上下文

M2 同时交付工具审批与 macOS Seatbelt 沙箱。两个参考项目的形状不同：claude-code 的权限模式（default、acceptEdits、plan、bypassPermissions 等）只决定是否询问，沙箱是另一项设置；deepseek-harness 把沙箱档位（read-only、workspace-write、danger-full-access）与审批策略（ask、never）做成两个独立设置，再用"权限预设"打包给用户，不匹配任何预设的组合显示为 custom。

两者都要求：拒绝规则优先、沙箱不可用时不得无沙箱运行、被沙箱拒绝后经用户批准才能放宽。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案，Agent 逻辑优先参考 pi 与 claude-code、桌面端参考 deepseek-harness；本决定于 2026-10-29 规划 M2 时按该指示采纳，未经用户逐条确认。

## 决定

- 每个 Session 有一个权限模式，取值 read-only、default、accept-edits、full-access；新 Session 使用设置中的默认模式（缺省 default）。模式切换记为 Session Entry，重启后由回放恢复。
- 模式同时决定免审批范围和命令的沙箱档位：

  | 模式 | 无需审批 | 命令的沙箱档位 |
  | --- | --- | --- |
  | read-only | Workspace 内读取 | read-only |
  | default | Workspace 内读取 | workspace-write |
  | accept-edits | Workspace 内读取；可写根内的文件写入 | workspace-write |
  | full-access | 除拒绝规则、询问规则与受保护路径外的全部调用 | danger-full-access |

- 判定顺序固定：拒绝规则 → 询问规则 → 受保护路径 → 越出沙箱档位的文件写入 → 模式放行 → 允许规则 → 询问。拒绝规则在任何模式下都生效；以后接入的 Hook 放行（M5）不能越过前四步。
- 审批与沙箱叠加：经审批或允许规则放行的 bash 仍在本模式的 Seatbelt 档位内运行。被沙箱拒绝的命令只能以更宽档位重试一次（Escalation），每次都要用户批准，且不能保存为规则。
- write、edit 在 Sidecar 进程内执行，无法套用 Seatbelt；它们的写入边界在权限判断中执行，使用与 Seatbelt 相同的可写根（workspace-write 下为 Workspace 与系统临时目录，read-only 下没有）。越出可写根的写入必须审批，该次批准即该次调用的提权，同样不能保存为"总是允许"。
- 沙箱只约束文件写入，不限制网络与读取；读取 Workspace 之外的文件由权限判断询问。sandbox-exec 不可用时，受限档位的命令以错误结束，不在无沙箱下运行；full-access 不受影响。

## 理由与备选方案

- **审批与沙箱两个独立设置。** 这是两个参考项目的底层形状。组合多，用户要同时理解两套概念；deepseek-harness 因此另加预设，并处理不属于任何预设的 custom 状态。单一模式只有四个可解释的档位。
- **沙箱档位内的命令免审批。** 这是 deepseek-harness workspace-write 预设的做法，提示更少；但沙箱不限制网络与读取，命令仍可能把 Workspace 内容发出去。本决定沿用 claude-code 默认询问 bash，用允许规则减少重复询问。
- **允许把提权保存为"总是允许"。** 会把一次性越界变成持久越界，审批记录也无法再说明每次越界的理由。

## 后果与验证

- 已批准的命令仍可能因沙箱失败，模型要读懂拒绝标记再请求提权；拒绝标记与提权提示的文本属于模型可见契约。
- workspace-write 下写用户目录缓存（例如 `~/.npm`）的命令会被拒绝，需要提权或切换模式。
- Plan 模式（M4）作为新的模式取值加入，沿用同一判定顺序。
- 实施进度（2026-10-29）：四种模式的判定与选择界面、判定顺序、受保护路径、越出可写根的写入询问、规则语法与 Session / Workspace / 全局作用域及其持久化、模式或规则变更后的重新判定（superseded）、审批请求与决定条目、回答路由与审批卡已实现，当前契约见 [权限判定与审批](../subsystems/permissions.md)。剩余：Seatbelt 沙箱、单次提权与 sandbox-exec 不可用时拒绝执行（模式目前只决定审批范围，命令尚未按档位受限）。
- implementation 变为 implemented 前需要：以 `ELECTRON_RUN_AS_NODE` 启动真实 Sidecar 的集成测试，覆盖 Seatbelt 拒绝与单次提权、sandbox-exec 不可用时拒绝执行；产物 smoke 中受限档位的命令无法写 Workspace 之外。四种模式的判定、规则作用域及重启后保留、重新判定的集成测试与模式选择的 Electron E2E 已具备（见 [权限判定与审批](../subsystems/permissions.md#验证)）。

## 来源与后继

- 参考实现：claude-code 社区还原版的 `src/utils/permissions`（判定流水线、权限模式、规则语法与作用域）；deepseek-harness 的 `packages/sandbox`（Seatbelt 档位、可写根、提权阶梯、拒绝标记）与 `packages/interaction/permission-presets`。本页已提炼所需结论。
- 能力归属见 [Agent 执行约定](../tech-stack/agent-runtime.md)；记录存储见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
