# 15: 联合验收与文档同步

**What to build:** 把各票的用户可见行为放在一起验收，并把当前行为文档同步到实现状态。确认没有配置 MCP 的用户一切照旧、Headless Run 与桌面行为一致，记录真实 provider 与原生层中未验证的部分。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-23 联合复核，重点为 AC-23；用户故事 1 至 35。

**设计依据:** [design.md](../design.md) 第 8 节的验证映射与第 9 节的 ADR 判断。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md)、[上下文管理](../../../docs/subsystems/context.md)、[分层配置](../../../docs/subsystems/configuration.md)、[子代理](../../../docs/subsystems/subagents.md)、ADR 0024 的 State Update 列举、承载 Provider 设置的当前文档，以及相关包 README 与条目载荷说明；需要时新增 ADR。

**Blocked by:** 04 关键词检索、查询语法与可见范围；05 目录预算降级与增量公告；06 MCP Server「始终加载」；07 全局开关的设置界面与项目收紧；08 乐观加载；09 重启、重试、压缩与断连后的已加载工具；10 回退、分叉与 Handoff 的加载边界；11 默认打开按需加载并迁移现有 MCP 测试；12 Provider 开关与 Messages、Responses 的原生写法；13 原生请求被拒时的开关提示；14 openai-completions 按 pi 目录使用原生写法

**Status:** ready-for-agent

- [ ] 跨票联合场景：新会话搜索并调用 MCP 工具；之后重启、压缩、回退与分叉，已加载的工具符合各自的边界；子代理不受影响；关闭全局开关或 Provider 开关后恢复原有行为。
- [ ] AC-23：中文与英文界面下，设置的 MCP 分区、MCP Server 编辑表单与 Provider 表单的标题、选项名与说明与 TS-27 一致；明暗主题与 390 CSS px 宽度下不重叠、不裁切。按 UI 调试约定静默验证，并说明哪些交互未在真实指针或原生层验证。
- [ ] 真实 provider：默认开启的线路用真实 Key 跑 AC-02 与 AC-18，结果单独报告；需要用户提供 Key，没有 Key、未运行或未通过的报告为未验证。
- [ ] 当前文档中“已连接 Server 的全部工具直接提供给模型”“用量计入全部 MCP 工具”等说法已改为实现后的行为；核对各票的文档改动一致，ADR 0024 的列举包含目录；判断“已加载集合从条目派生”与“按 Provider 的原生增量开关”是否提炼为 ADR。
- [ ] `pnpm run check:docs` 通过，并从 AGENTS.md、docs/README 到正文依次读回，核验链接与语义；正式文档不链接任务材料。
- [ ] 记录本地验证结果与未覆盖风险，区分已提交、已推送与未发布状态。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
