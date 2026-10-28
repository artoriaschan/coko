# 07: 文件 Checkpoint 与内容寻址快照

**What to build:** packages/session 新入口 `@coko/session/blobs`（ADR 0006：sha256 分片目录、0700/0600、临时文件 + fsync + rename、10 MiB 上限）；agent checkpoint tracker：以每条已提交 user message 为锚点（含追加指令），write / edit 在锚点下首次修改某路径前备份原内容（不存在记 absent，超限记 untracked）并提交 `file_backup`，完成后提交 `file_change { afterHash }`；tracker 经 beforeToolCall 位于权限 hook 之后（被拒绝的调用不备份），通过 SessionService 的 `extensions` 工厂在 `runtime/layers.ts` 注册，不改 sessions.ts。server `adapters/checkpoints.ts` 把 blob 目录接到 `<dataDir>/blobs`。

**User stories:** 27（前置）, 31（bash 不追踪）

**Blocked by:** 05

**Status:** ready-for-agent

**Write scope:** `packages/session/src/blobs/`（新）、`packages/session/package.json`（exports 加 `./blobs`）、`packages/session/README.md`、`packages/agent/src/checkpoints/`、`packages/agent/src/session-entries/checkpoints.ts`、`apps/server/src/adapters/checkpoints.ts`（新）、`apps/server/src/runtime/layers.ts`、`tests/integration/sidecar-checkpoints.test.ts`（新）、`docs/adr/0006-file-checkpoints-and-rewind.md`、`docs/adr/README.md`

- [ ] session 测试：同一内容只存一份；写入中途失败不留下目标文件；权限 0600 / 0700
- [ ] 集成测试：一次 Run 中对同一文件两次 edit → 只有一条 `file_backup`，blob 内容等于 Run 前的文件逐字节；新建文件的备份为 absent
- [ ] 集成测试：第二条用户消息之后再 edit 同一文件 → 新锚点下新的 `file_backup`（内容为第一次 Run 之后的版本）
- [ ] 集成测试：bash 修改的文件没有 `file_backup`；超过 10 MiB 的文件记 untracked、不写 blob
- [ ] 集成测试：被拒绝审批的 write 不产生 `file_backup`
- [ ] 秘密总闸追加：快照目录纳入扫描（写入内容不含凭据时无明文）
- [ ] 不修改 `apps/server/src/application/sessions.ts`；ADR 0006 implementation 改为 partial

## Comments
