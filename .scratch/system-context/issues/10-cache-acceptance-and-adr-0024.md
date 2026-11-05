# 10: 缓存验收并完成 ADR 0024

**What to build:** 在真实 Provider 上确认改动让 Todo 或 Goal 变化之后的 Run 继续命中提示缓存，并把 ADR 0024 与当前行为文档更新为实施后的状态。见 [规格](../spec.md) Testing Decisions 中的“缓存验收”，以及 [ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md) 的“implementation 变为 implemented 前需要”。

**User stories:** 5（并以真实 Provider 验证 1–4）

**Blocked by:** 02、03、04、05、06、07、08、09

**Status:** ready-for-agent

- [ ] 基线为 01 合入之前的提交；在真实 Provider 上运行同一段多 Run 会话（含 Todo 写入与 Goal 推进，各 Run 在缓存有效期内连续发出），经追踪接口读取各 Run 首次请求的 cacheRead
- [ ] 改动后不低于基线同一位置，且至少一个 Todo 或 Goal 变化之后的 Run 在基线上未命中、在改动后命中；结果写入证据
- [ ] ADR 0024 的 implementation 改为 implemented 并链接实现与验证证据，ADR 索引同步；缺少凭据或任一验证未完成时为 partial，写明未验证项
- [ ] 从入口读回上下文管理、Todo List、Goal、Agent Teams、`@coko/agent` 与 protocol 的 README、headless 文档，与实现一致；`check:docs` 通过
