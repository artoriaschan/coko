# 07: 文件 Checkpoint 与内容寻址快照

**What to build:** packages/session 新入口 `@coko/session/blobs`（ADR 0006：sha256 分片目录、0700/0600、临时文件 + fsync + rename、10 MiB 上限）；agent checkpoint tracker：以每条已提交 user message 为锚点（含追加指令），write / edit 在锚点下首次修改某路径前备份原内容（不存在记 absent，超限记 untracked）并提交 `file_backup`，完成后提交 `file_change { afterHash }`；tracker 经 beforeToolCall 位于权限 hook 之后（被拒绝的调用不备份），通过 SessionService 的 `extensions` 工厂在 `runtime/layers.ts` 注册，不改 sessions.ts。server `adapters/checkpoints.ts` 把 blob 目录接到 `<dataDir>/blobs`。

**User stories:** 27（前置）, 31（bash 不追踪）

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/session/src/blobs/`（新）、`packages/session/package.json`（exports 加 `./blobs`）、`packages/session/README.md`、`packages/agent/src/checkpoints/`、`packages/agent/src/session-entries/checkpoints.ts`、`apps/server/src/adapters/checkpoints.ts`（新）、`apps/server/src/runtime/layers.ts`、`tests/integration/sidecar-checkpoints.test.ts`（新）、`docs/adr/0006-file-checkpoints-and-rewind.md`、`docs/adr/README.md`

- [x] session 测试：同一内容只存一份；写入中途失败不留下目标文件；权限 0600 / 0700
- [x] 集成测试：一次 Run 中对同一文件两次 edit → 只有一条 `file_backup`，blob 内容等于 Run 前的文件逐字节；新建文件的备份为 absent
- [x] 集成测试：第二条用户消息之后再 edit 同一文件 → 新锚点下新的 `file_backup`（内容为第一次 Run 之后的版本）
- [x] 集成测试：bash 修改的文件没有 `file_backup`；超过 10 MiB 的文件记 untracked、不写 blob
- [x] 集成测试：被拒绝审批的 write 不产生 `file_backup`
- [x] 秘密总闸追加：快照目录纳入扫描（写入内容不含凭据时无明文）
- [x] 不修改 `apps/server/src/application/sessions.ts`；ADR 0006 implementation 改为 partial

## Comments

**实施（m2/07-file-checkpoints）**

- 覆盖的验收：全部 7 项。session：`packages/session/src/blobs/blobs.test.ts`（去重、读回逐字节、0700/0600、来源中途出错与超限不留任何文件、引用校验）。集成：`tests/integration/sidecar-checkpoints.test.ts`（两次 edit 只有一条 file_backup 且 blob 等于 Run 前字节、新建文件 absent、第二条用户消息后的新锚点备份为第一次 Run 之后的版本、bash 不备份、>10 MiB 记 untracked 且 blobs 目录为空、被拒绝的 write 无 file_backup）。agent：`packages/agent/src/checkpoints/tracker.test.ts`（同上语义 + 快照失败时拦下调用、重建 tracker 后从历史恢复锚点）。秘密总闸追加快照步骤，扫描改为递归（含 `<dataDir>/blobs`）；临时在原文件里植入 Credential，确认总闸在 `blobs/9e/…` 处报出泄露，之后已撤回。未改 sessions.ts；ADR 0006 implementation → partial。
- 设计要点：tracker 经 SessionService 的 `extensions` 在 `runtime/layers.ts` 注册（hooks 位于权限 gate 之后；onEntry 观察条目）。锚点 = 最新已提交 user message 的 seq；创建时读该 Session 历史恢复锚点与已备份路径（retry / 重启后不会重复备份）。路径记录为真实绝对路径（经 realLocation）。快照或历史读取失败时拦下该次调用（文件不改），不让未备份的修改发生。file_change 在 afterToolCall 记录（调用出错但文件存在时同样记录当前摘要；文件不存在时不记）。目标是目录时记 untracked。
- pi 先对整批调用逐个执行 beforeToolCall 再执行：同批中后一个调用的 file_backup 可能排在前一个调用的 tool_exec 之前，备份内容仍是执行前的版本（集成测试断言了实际顺序）。
- 越界改动（最小）：`tests/integration/secrets-gate.test.ts`（brief 要求追加驱动步骤；另给 recordingClient 加 put、readDir 改为递归）；`tests/integration/sidecar-session.test.ts`（M1 断言精确的条目种类序列，write 前后新增 file_backup / file_change 两项）。
- 文档影响：`packages/session/README.md`（新入口与"快照存储"一节）、ADR 0006 与 `docs/adr/README.md`。`packages/agent/README.md` 第 9 行仍写"尚未实现：…Checkpoint"，不在本票写范围（agent README 归 04/05/06/08），建议更新时改为"Checkpoint 的备份已实现（`src/checkpoints/`），回退与分叉尚未实现"。未新增依赖，TECH_STACK 不变。
- 运行的命令：`pnpm run typecheck`（通过）、`pnpm run lint`（0 warnings / 0 errors）、`pnpm exec oxfmt --check`（通过）、`pnpm run check:docs`（82 个文件 0 问题）、`git merge main`（已是最新，main 3879bf9）后 `pnpm run test`：83 个文件、673 通过、1 跳过（settings E2E 的真实 DeepSeek 用例，无凭据）、0 失败；含 desktop-e2e 全部文件与 package-smoke。
- 未验证：真实模型（无凭据）；非 darwin 平台（本机 darwin，本票用例不依赖 Seatbelt）。