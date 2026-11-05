# 06: 环境 section

**What to build:** 模型在开头的系统消息中看到会话内不变的环境信息：Workspace 路径与 Project 的附加文件夹、是否 git 仓库、是否在 Worktree 中、平台、命令执行所用的 shell、OS 版本、当前模型与 Sidecar 所用的 IANA 时区；不含 git status 与日期。只有换模型时它才变化。见 [规格](../spec.md) 的“环境 section”与“system section 的组成与顺序”。

**User stories:** 14、15、16、17

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] requestLog：环境 section 紧接在基础提示之后，各项内容正确；普通 Workspace、Worktree Session 与非 git 目录各一例
- [ ] 同一 Session 的多个 Run 环境 section 逐字相同；换模型后变化
- [ ] `ContextScope` 带当前模型与附加文件夹；还没有 Session 的草稿上下文接口按缺省模型
- [ ] 上下文用量的 system 分项包含环境 section
- [ ] 文档：上下文管理（system 的组成与顺序）；`check:docs` 通过
