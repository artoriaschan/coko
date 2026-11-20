# 06: 验收与文档收口

**What to build:** 两件事在真实应用里端到端可用并有证据：`/` 菜单的“插件”组，以及从 `@` 菜单选择会话、提交、模型拿到记录、时间线显示 chip 并能点回去。当前行为文档、术语表与本目录的规格状态与实际交付一致。

**User stories:** 全部（验收）。

**规格：** [spec.md](../spec.md) 的 Testing Decisions 与“文档与术语”。

**Blocked by:** 01、02、03、04、05

**Status:** ready-for-agent

- [ ] Electron E2E（后台模式）一条：在一个会话中完成一轮对话；在同一 Project 的另一个会话中经 `@` 菜单选择它并提交；faux 的请求中含前一会话的文本；时间线显示会话 chip，点击后切换到前一会话
- [ ] 现有的命令与 File Reference 的 E2E 继续通过；“插件”组在 Electron 中的显示有一条断言或一次静默 CDP 截图核对
- [ ] 逐条对照规格的 User Stories，列出每条由哪张票的哪项检查覆盖；没有覆盖的写明原因
- [ ] 逐条对照规格 Further Notes 中补充的决定，确认实现与之相符；实施中改变了的，回写规格并说明
- [ ] 术语表的 Session Reference 词条与实现一致；File Reference、Command、Plugin 词条未被改动
- [ ] 当前行为文档读回核对：上下文管理、命令、插件，以及涉及回退与分叉返回文本的正文；涉及的包 README
- [ ] [文档导航](../../../docs/README.md) 中相关正文的摘要仍然准确，必要时更新
- [ ] `pnpm run check:docs` 通过
- [ ] 按 [测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告) 记录实际运行的检查与结果；写明未验证项：真实模型拿到会话记录后的使用效果、需要真实指针或原生层的交互
- [ ] 规格的 Spec status 更新为 delivered，并记下集成分支与验收依据
- [ ] 规格 Out of Scope 中“另行验证”的 Worktree Session 候选搜索根问题没有被本次改动波及；若实施中顺带确认了现状，写进评论
