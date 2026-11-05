---
kind: decision
description: "托管独立会话以会话根读取，以 work/outputs 写入；读取、写入和 Agent cwd 不再使用同一个根。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 托管独立会话分离读取根、写根与 cwd

## 上下文

用户于 2026-11-04 至 2026-11-05 确认独立会话的 `work/` 保存中间文件、`outputs/` 保存交付文件，并于 2026-11-05 授权实施。Workspace 登记会话根、Agent cwd 固定为 `work/`，见 [ADR 0016](0016-session-cwd-fixed-worktrees.md)。继续把整根当可写范围，会允许 Agent 在两层目录之外留下文件；只把 cwd 当权限根，又会让 `outputs/` 的读取和文件工具失去正常权限。

## 决定

对保存了 `directory` 且当前不属于项目的托管独立会话，Run 开始时冻结三个范围：会话根是权限读取根，`work/` 是 cwd，真实路径位于会话根内的 `work/` 与 `outputs/` 是显式写根。指向根外或根自身的链接不成为写根。该显式集合替代 workspace-write 的默认 Workspace 与临时目录集合，避免会话根本身位于 `/tmp` 时被临时目录授权重新放开。

文件工具与 Seatbelt 共用写根推导。default 仍询问文件写入，accept-edits 在写根内免审批；根其他位置按越出可写根询问，只能批准本次，不能保存允许规则。read-only / plan 没有写根：文件工具沿用现有单次审批机制，拒绝则不执行；已批准的命令仍在只读 Seatbelt 下，写入被内核拒绝。full-access 与明确批准的命令提权保留 [ADR 0005](0005-permission-mode-and-sandbox.md) 的更宽档位语义。受保护路径、拒绝规则和执行前真实路径复核保持不变。

项目会话、隔离 worktree 与没有 `directory` 的旧会话继续使用既有根集合与系统临时目录。相同目录的子会话、分叉和交接保留绑定；按当前项目归属决定是否使用托管写根。Checkpoint 的备份路径仍由 cwd 解析成真实绝对路径；回退预览以显式写根判断目录外提示，因此 `outputs/` 不会因处于 cwd 的同级而误报，原有文件一致性复核不变。

## 理由与备选方案

保留整根可写更简单，但不能落实用户选择的中间文件和交付文件分层。将整个会话根作为 cwd 也会使工具默认写入根。分离三个范围能同时保留相对路径便利、交付目录访问和根目录的默认只读性，代价是宿主必须明确提供写根。

## 后果与验证

本决定局部替代 ADR 0005 中“workspace-write 的写根总是 Workspace 与系统临时目录”的表述，其他权限决定继续有效。需要临时文件的独立会话命令应写入 `work/`；越界仍可走既有审批或提权。未增加 Windows/Linux 沙箱，也未改变 full-access 的含义。

[真实 Sidecar 用例](../../tests/integration/sidecar-standalone-write-roots.test.ts)验证 work/outputs 的 write/edit、会话根读取、越界单次批准和拒绝、链接拒绝、outputs checkpoint/rewind，以及 darwin 上位于 `/tmp` 的目录仍受 Seatbelt 限制和 read-only 命令拒绝写入。项目根、旧模式与提权的回归由[项目权限](../../tests/integration/sidecar-project-permissions.test.ts)和[沙箱用例](../../tests/integration/sidecar-sandbox.test.ts)覆盖。Windows 实机未验证。

## 来源与后继

本页提炼用户的分层与授权确认，不依赖任务材料。当前契约见[权限与写根](../subsystems/permissions.md#每个-run-的-workspace-根)；固定 cwd 见[ADR 0016](0016-session-cwd-fixed-worktrees.md)。
