---
kind: decision
description: "新对话的 worktree 在首次发送时创建：开启“新建工作树”时，所选分支是基础分支，worktree 从它的最新提交创建；首次发送失败时不留会话，并自动移除刚创建且未改动的 worktree，这是 ADR 0016“只由用户移除”的例外；不开工作树时，选择分支立即在主要文件夹切换，有未提交改动或进行中的工作时拒绝。修改新对话的 Git 配置、worktree 的创建时机或分支切换时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: feature
---

# 新对话的 worktree 在首次发送时从所选分支创建

## 上下文

[ADR 0016](0016-session-cwd-fixed-worktrees.md) 规定：worktree 从源 checkout 的当前提交创建，只由用户移除，移除时须干净且没有进行中的工作。2026-11-02 的双栏设计在会话还不存在时，就在归属栏提供“新建工作树”开关和分支选择，以及“创建并检出新分支…”。规格要求开关不立即创建工作树，所选分支作为项目工作或新工作树的基础配置。此前只有 worktree 菜单这一条入口会先创建会话，在发消息之前它显示为“未命名”；普通新会话在发送时才创建。同一设计还去掉了侧栏的 worktree 列表与移除入口。

用户于 2026-11-02 在双栏对话列表的需求澄清中逐条确认了下述决定。

## 决定

- **首次发送时创建。** 新对话在第一次发送被接受时，依次创建 worktree（如果开启了）、Session，再提交第一条消息。任一步失败都不留下 Session；刚创建的 worktree 没有新提交且干净时，连同分支一起移除，做法与子代理 worktree 的“没改动就移除”相同。这是 ADR 0016“worktree 只由用户移除”的唯一例外。打开欢迎页和修改配置都不写任何记录。
- **开启“新建工作树”时**，分支表示新 worktree 的基础分支，缺省为主要文件夹的当前分支。首次发送时从该分支的最新提交创建 worktree，仍不复制未提交的改动；主要文件夹不切换分支。交接的新 worktree 与子代理隔离仍从当前 HEAD 创建。
- **不开“新建工作树”时**，选择分支就立即在主要文件夹切换，不强制切换。有未提交的改动，或绑定这个目录的任一会话有进行中的 Run、子代理、运行中的后台任务或启用的定时任务时，拒绝切换并说明原因。“创建并检出新分支…”同样从当前 HEAD 创建并立即切换；分支已存在时报错，不重置。
- 开启“新建工作树”时，隐藏“创建并检出新分支…”。
- Git 仍由宿主以 argv 执行（ADR 0016），不提供模型可调用的 git 工具。

## 理由与备选方案

- **打开开关时就创建 worktree。** 用户放弃草稿时会留下需要清理的 worktree 和分支，也与规格“不立即创建”的要求冲突。
- **把检出推迟到首次发送。** 菜单显示的分支与工作目录实际所在的分支不一致，“创建并检出”名不副实。
- **worktree 只能从当前 HEAD 创建。** 不需要改动 ADR 0016，但要换基础分支，就得先在主 checkout 切换分支，影响所有使用这个目录的会话和用户的编辑器。
- **首次发送失败后保留 worktree。** 会积累没有会话使用的空 worktree 和分支；新界面没有 worktree 列表与移除入口，用户在 Coko 里无法清理。

## 后果与验证

- 在主要文件夹切换分支会影响所有使用这个目录的会话和用户的编辑器，所以忙碌检查沿用移除 worktree 的原因（run / agent / job / schedule）。
- 新界面没有 worktree 列表与移除入口，用户只能在 Coko 之外用 git 移除 worktree；Coko 启动恢复时把路径已不存在的 worktree 标为 removed，绑定的会话变为只读。
- implementation 变为 implemented 前需要验证：开启“新建工作树”首次发送后，worktree 与分支从所选分支的最新提交创建，主要文件夹仍在原分支；首次发送失败时没有 Session，未改动的 worktree 与分支被移除；选择分支立即切换，有未提交改动或会话忙碌时拒绝，原分支不变；创建并检出已存在的分支时报错，不重置。

## 实施记录

2026-11-03，新对话 worktree 入口与项目分支入口均已接入，当前契约见 [Worktree](../subsystems/worktrees.md#新对话首次发送)。首次发送时解析基础分支最新提交并创建绑定 Session，失败删除未接受的 Session，未改动的 worktree 及分支自动清理；基础分支未合并到主分支也可清理，删除引用时使用创建时提交作比较，发生后续引用变化时拒绝误删。Hook 已写入文件的 worktree 保留。

- 首次发送与回滚证据：[Sidecar 协议](../../tests/integration/sidecar-first-send-worktree.test.ts)、[浏览器开关、分支与草稿](../../apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx)、[真实 Electron 首次发送](../../apps/desktop/e2e/first-send-worktree.e2e.test.ts)。
- 项目主要文件夹立即切换、dirty / busy 拒绝、同名分支不重置的证据：[Sidecar 分支协议](../../tests/integration/sidecar-branches.test.ts)、[目录准入屏障](../../apps/server/src/application/branches.test.ts)、[真实 Electron 前缀与检出](../../apps/desktop/e2e/branches.e2e.test.ts)。

## 来源与后继

- 本页改变了 [ADR 0016](0016-session-cwd-fixed-worktrees.md) 中新对话入口的两点：可以选择基础分支，首次发送失败时自动移除未改动的 worktree。ADR 0016 的其他决定继续有效。
- 未改动即移除的机制见 [子代理](../subsystems/subagents.md#isolation-worktree)；git 进程登记见 [ADR 0012](0012-host-process-registry.md)；项目的主要文件夹见 [ADR 0020](0020-projects-organize-workspaces.md)。
