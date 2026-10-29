---
kind: decision
description: "Checkpoint 只追踪文件工具的改动，原内容存为内容寻址文件、引用记为 Session Entry；回退对话以追加记录实现，不删除条目。修改快照、回退或分叉时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# Checkpoint 只追踪文件工具，回退以追加记录实现

## 上下文

M2 要让用户把 Session 的对话、文件或两者退回到某条用户消息之前，并能从该处分叉。claude-code 的做法是：Edit、Write 在写入前备份文件，每条用户消息打一个快照，Rewind 可选只恢复代码、只恢复对话或两者；Bash 造成的改动不追踪。另一条常见路线是每条消息对整个工作目录做影子 git 快照。

[ADR 0003](0003-settings-and-sessions-in-sqlite.md) 规定 Session Entry append-only（表上有拒绝 UPDATE 的触发器），文件快照正文以内容寻址文件保存、库内只存引用。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案、Agent 逻辑优先参考 claude-code；本决定于 2026-10-29 规划 M2 时按该指示采纳，未经用户逐条确认。

## 决定

- **锚点。** 每条已提交的用户消息（包括 Run 中途送达的追加指令）是一个 Checkpoint 的锚点。
- **追踪范围。** write、edit 在某个锚点下第一次修改某路径之前，把该路径的原内容存入快照目录并提交引用它的 Session Entry；文件原先不存在时记为不存在。修改完成后记录新内容的摘要。bash 与外部进程造成的改动不追踪，界面明确说明。单个文件超过 10 MiB 时不备份，记为未追踪。
- **存储。** 快照正文按 SHA-256 存在用户数据目录下的独立目录（目录 0700、文件 0600，先写临时文件再改名），由 packages/session 提供；引用与元数据都是 Session Entry，不新增表。
- **回退对话。** 追加一条回退记录，指向目标用户消息；模型上下文与时间线不再包含从目标消息到回退记录之间的条目，原条目保留、可展开查看。目标消息的文本回到输入区。
- **回退代码。** 对目标锚点及其之后锚点追踪过的每个路径，恢复最早的一份备份，原先不存在的文件删除。执行前列出将恢复和删除的文件，并标出当前内容与最后一次记录不一致（Agent 之外改过）的文件。
- **分叉。** 复制目标用户消息之前的有效条目到新 Session，第一条记录来源；Workspace 文件不复制。
- **前置条件。** Run 进行中、等待审批或等待结果确认时，拒绝回退与分叉。

## 理由与备选方案

- **影子 git 快照。** 能覆盖 bash 的改动，但每条消息都要扫描整个 Workspace，大仓库的耗时与占用不可控，还会和用户自己的 git 状态（忽略规则、子模块、LFS）交织。
- **删除或截断条目来实现回退。** 违反 append-only 约束，也丢失被回退内容的审计记录。
- **独立的 checkpoint 表。** 可行，但分叉时还要另外复制表数据；用 Session Entry 保存，分叉与回放沿用同一机制。
- **限制快照数量。** claude-code 只保留 20 个。内容寻址已去重，占用主要来自真实改动；M2 不设上限，清理随 Session 删除实现。

## 后果与验证

- 回退不能撤销 bash 造成的文件变化，也不能撤销外部副作用。
- 快照目录持续增长，直到实现 Session 删除与快照清理。
- 回退本身不能再撤销；被回退的条目仍可查看。
- 已实现（implemented）。备份：packages/session 的 `@coko/session/blobs` 提供快照目录（见 [@coko/session](../../packages/session/README.md#快照存储)）；packages/agent 的 checkpoint tracker 经 `beforeToolCall` 位于权限 hook 之后，在锚点下首次修改前提交 `file_backup`，修改后提交 `file_change`；Sidecar 把快照目录接到 `<dataDir>/blobs`。回退与分叉：packages/agent 的 `effectiveEntries`（`src/entries/`，浏览器安全子路径 `@coko/agent/entries`，与 renderer 共用）、`planRewind`、`restoreFiles`（`src/checkpoints/rewind.ts`）与 `forkEntries`（`src/agents/fork.ts`），宿主端口 `SnapshotPort`、`RewindFiles` 在 `src/ports/checkpoints.ts`；Sidecar 的 `GET …/checkpoints`、`POST …/rewind`、`POST …/fork`（见 [apps/server](../../apps/server/README.md)），运行时按有效条目重建模型上下文；renderer 在用户消息上提供"回退到此处"与"从这里分叉"、确认对话框与时间线折叠。
- "Agent 之外改动"的判定：当前内容与该路径最后一次记录（最后一次 `file_change` 的摘要，之后没有时取备份的状态）比对。被中断的 Run 中 write / edit 执行数多于 `file_change` 数时（启动恢复补齐的结果不提交 `file_change`），该 Run 涉及的路径无从比对，不标记。代码回退本身不提交条目，回退后再次回退代码时这些路径可能被标为在 Agent 之外改过。
- 回退代码的写入边界（2026-10-29，M2 评审修复）：恢复与删除前逐个重新解析真实路径，与备份时记录的路径不同（父目录被替换为符号链接等）时不处理并列入 `skipped`，不跟随链接写到别处；写入经端口以临时文件 + rename 原子替换，进程中途退出不留半截文件。将恢复或删除的路径中位于 Workspace 之外或属于受保护路径的列入 `outside`，照常处理，确认对话框单独列出并显式警告。分叉的标题由界面按当前语言生成后传入，Sidecar 不写本地化文案。
- 证据：`tests/integration/sidecar-checkpoints.test.ts`（备份时机与内容、新建文件记为不存在、新锚点下重新备份、bash 不追踪、超限文件未追踪、被拒绝的调用不备份）；`tests/integration/sidecar-rewind.test.ts`（三种回退模式下的文件内容与模型请求、dry-run 不改文件、Agent 之外改动的标记、恢复补齐的结果不误报、分叉不影响原 Session、Run 进行中 409 `session-busy`、待确认 409 `confirmation-pending`、Workspace 外文件列入 outside、父目录被替换为链接时 skipped 且链接目标不变）；`apps/server/src/adapters/checkpoints.test.ts`（原子替换、保留权限、替换末尾的链接本身）；`tests/integration/secrets-gate.test.ts` 驱动回退与分叉通道；`packages/agent/src/checkpoints/rewind.test.ts`（有效上下文与叠加、计划与恢复的纯函数）；`apps/desktop/e2e/rewind.e2e.test.ts`（悬停与键盘入口、确认对话框的文件清单与 bash 说明、执行后输入区与折叠、分叉后打开新会话）。

## 来源与后继

- 参考实现：claude-code 社区还原版的 `src/utils/fileHistory.ts` 与 `/rewind` 命令。本页已提炼所需结论。
- 存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
