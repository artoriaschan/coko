# 06: 环境 section

**What to build:** 模型在开头的系统消息中看到会话内不变的环境信息：Workspace 路径与 Project 的附加文件夹、是否 git 仓库、是否在 Worktree 中、平台、命令执行所用的 shell、OS 版本、当前模型与 Sidecar 所用的 IANA 时区；不含 git status 与日期。只有换模型时它才变化。见 [规格](../spec.md) 的“环境 section”与“system section 的组成与顺序”。

**User stories:** 14、15、16、17

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] requestLog：环境 section 紧接在基础提示之后，各项内容正确；普通 Workspace、Worktree Session 与非 git 目录各一例
- [x] 同一 Session 的多个 Run 环境 section 逐字相同；换模型后变化
- [x] `ContextScope` 带当前模型与附加文件夹；还没有 Session 的草稿上下文接口按缺省模型
- [x] 上下文用量的 system 分项包含环境 section
- [x] 文档：上下文管理（system 的组成与顺序）；`check:docs` 通过


**Closed:** true

## Comments

2026-11-05：实现完成。环境贡献位于 `apps/server/src/application/context/environment.ts`，在基础提示之后生成 `<environment>`；SessionRuns 与 ContextService 的作用域携带当前模型、根 Session 所属 Project 的附加文件夹。草稿使用缺省模型，工作目录遵守 Worktree 绑定；环境计入现有 system 用量。命令 shell 与执行端共用 `DEFAULT_COMMAND_SHELL`，不读取 git status 或日期。不增加环境缓存。

- 测试接缝沿用规格已批准的 Sidecar requestLog 与上下文用量 HTTP 接口。TDD 首次失败：新增环境场景读到原 system 用量 37，环境尚未计入；实现后通过。新增 2 例覆盖普通仓库、Worktree、非 git 目录、附加文件夹、时区/平台/shell/OS/模型、跨 Run 不随未跟踪文件变化、换模型、草稿缺省模型与 system 用量。更换模型用 loopback HTTP 模型服务，只替换外部模型边界。
- `rtk pnpm install --frozen-lockfile`：退出码 0。
- `rtk pnpm run test tests/integration/sidecar-environment.test.ts tests/integration/sidecar-instructions.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-context-seam.test.ts tests/integration/sidecar-m4-seams.test.ts tests/integration/sidecar-m5-seams.test.ts apps/server/src/application/context/usage.test.ts apps/server/src/application/session-cwd-scope.test.ts packages/agent/src/ports/local-exec.test.ts`：9 个文件、55 例通过，退出码 0。
- `rtk pnpm run test tests/integration/sidecar-environment.test.ts tests/integration/sidecar-context-seam.test.ts tests/integration/sidecar-m4-seams.test.ts tests/integration/sidecar-m5-seams.test.ts tests/integration/sidecar-skills.test.ts`：5 文件、23 例通过、4 例失败。4 例均在 sidecar-skills 中，是基线 ec32dfc9 同样存在的问题：3 例夹具期待 `/var` 而接口给出实际 `/private/var` 路径，1 例旧条目顺序遗漏 `model_request`。父代理在未改动基线独立运行该文件，确认 6 例中同样 4 失败。本票只同步了 skills 的环境 section 期待，未放宽这些断言。
- `rtk pnpm run typecheck`：退出码 0。修改的 TypeScript 经 `rtk pnpm exec oxfmt <修改文件>` 格式化与 `rtk pnpm exec oxlint <修改文件>` 检查。
- `rtk pnpm run check:docs`：360 个 Markdown，0 个问题，退出码 0。更新 context、memory、subagents 正文及总导航摘要；检索“指令 → Skills”“system sections 照常”等消费者，旧规格/讨论与 ADR 上下文保留历史事实。从 AGENTS → docs/README → context/memory/subagents 读回：语义、归属、引用方向、当前入口及历史保留均通过。后续票01移除todo时需同步本票新增的系统顺序中的todo。
- 未验证：真实 Provider、真实提示缓存与原生 Electron 窗口；本票执行的是 Electron 内置 Node 中的真实 Sidecar。未运行全仓测试与 CI。当前结果仅本地提交，不含推送或发布。
