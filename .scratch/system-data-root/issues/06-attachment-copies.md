# 06: 附件副本

**What to build:** 用户粘贴或拖入的附件在发送时复制到 `~/.coko/data/attachments/<sessionId>/`，消息引用副本而不是原路径。原文件之后被移动或删除，历史消息仍能回看附件。图片保持 4.5 MB 上限，普通文件上限 32 MB，超限在输入区报错。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [x] 发送带图片或普通文件的消息后，附件出现在 `data/attachments/<sessionId>/`，文件名带可读的原名与唯一前缀。
- [x] 发送后移动或删除原文件，重新打开会话仍能查看附件内容。
- [x] 图片超过 4.5 MB、普通文件超过 32 MB 时在输入区报错，消息不发送，不产生半截副本。
- [x] 发送前图片草稿仍在 IndexedDB；发送成功后草稿引用被清理，未发送的草稿不写入 `data/attachments`。
- [x] 复制失败时不发送消息，并保留可重试的草稿状态。
- [x] 集成测试覆盖复制、原文件删除后的回看与超限报错；删除会话后的附件清理在 11 号票验证。

**Closed:** true

## Comments

2026-11-05 完成。实现提交 `4658b7b7`；已在独立 worktree `/tmp/coko-sdr-06` 合入集成分支的 03 号票，保留其目录分配、cwd 和回滚。

- 使用 `tdd`，已确认接缝沿用规格 Testing Decisions。真实 Sidecar 的普通文件首次发送测试先以 400 失败，加入显式 `files` 协议和复制装配后通过；Browser Mode 的普通附件草稿测试先因仍为路径文字失败，再以结构化附件通过。图片 `images` 请求保持兼容。
- `AttachmentStore` 在提交前复制图片与普通文件到 `data/attachments/<sessionId>/<uuid>-<原名>`，流式限制普通文件 32 MiB，图片独立限制 4.5 MiB；只清理本次真正创建的文件。复制失败、超限、缺失源文件和开始 Run 失败不提交消息并回滚本次副本。消息通过文本块保存副本路径，图片内联块继续保留；当前会话副本目录为额外只读根。
- 文件和图片草稿在 IndexedDB 恢复，成功发送后清理本次引用，失败保留；原生文件选择和粘贴/拖入先检查上限。时间线附件标签打开副本，失败显示提示；主进程 `openFile` 仅接受已有绝对文件。`openFile` bridge 可供 05 号票复用。
- `pnpm run test tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-images.test.ts apps/desktop/src/main/open-directory.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/client/api.test.ts`：实际选中 5 文件、55 项通过（仓库没有独立 api.test.ts，HTTP 转发经真实 Sidecar/Electron 覆盖）。
- `pnpm run test apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx`：3 文件、37 项通过；历史标签打开失败反馈增补后重跑 composer/messages：2 文件、26 项通过。
- `pnpm run test apps/desktop/e2e/attachments.e2e.test.ts apps/desktop/e2e/images.e2e.test.ts`：真实后台 Electron 2 文件、2 项通过，含原生选择限额、发送前重启、未发送不落盘、发送后删除原文件、历史副本跨重启与图片草稿清理。
- `pnpm run test apps/desktop/e2e/first-send-worktree.e2e.test.ts`：1 项通过，验证主检出与 worktree 同名文件分别复制。旧测试在选择 full-access 后遗漏现有风险确认，发送前 textbox 被 Dialog 遮蔽；补齐真实确认动作，产品权限行为不变。
- 合入 03 后 `pnpm run test tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-images.test.ts tests/integration/sidecar-first-send.test.ts`：3 文件、15 项通过。`pnpm run typecheck` 通过；改动 TS/TSX 的 oxfmt、oxlint 通过。
- 文档按 `coko-docs` 同步工作台附件正文与 Worktree 的旧“按 cwd 分类附件”说明。搜索 `.agents/`、`docs/` 和本功能任务材料的旧路径插入/不复制表述，活动正文已改为副本语义；从 AGENTS → docs/README → 正文读回，链接、语义、归属、引用方向、生命周期与历史保留通过。`pnpm run check:docs`：377 Markdown、0 问题。
- 未调用真实模型；未在 Windows 实机验证；原生默认应用打开成功用注入 shell 的窄边界测试，Electron 验证缺失路径的拒绝；未实际启动外部文件应用或占用用户前台。删除后的附件清理由 11 号票完成。仅本地提交，未推送、未发布。

补充：合入 07 号票时只在 SessionRuns 的 import 区冲突；保留工具结果目录与附件目录的独立只读根，3 文件、12 项联合 Sidecar 用例通过，typecheck / check:docs 通过。额外发现普通文件在分支历史中继承了源副本路径；真实 assistant-inclusive 分支测试先因新会话没有副本而失败。现在分支复制受管附件并重写标记，源会话删除后分支副本保持可读；复制/提交失败回滚新会话与本次副本。handoff 只生成摘要草稿，子代理只接收派发 prompt，均不复制用户消息历史，无同样的所有权转移。

分支补充验证：`pnpm run test tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-worktrees.test.ts`：3 文件、28 项通过，含失败分支没有新 Session 或部分副本，源 Session 和文件不变。

最终集成基线：已合入 `d16be237`（01/02/03/04/07）。`pnpm run test tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-tool-results.test.ts tests/integration/sidecar-standalone-write-roots.test.ts`：3 文件、18 项通过，附件/工具结果只读根与独立会话写根同时生效；`pnpm run typecheck` 通过；`pnpm run check:docs`：378 Markdown、0 问题。分支附件修复提交 `65026b4`。
