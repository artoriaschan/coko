# 10: 缓存验收并完成 ADR 0024

**What to build:** 在真实 Provider 上确认改动让 Todo 或 Goal 变化之后的 Run 继续命中提示缓存，并把 ADR 0024 与当前行为文档更新为实施后的状态。见 [规格](../spec.md) Testing Decisions 中的“缓存验收”，以及 [ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md) 的“implementation 变为 implemented 前需要”。

**User stories:** 5（并以真实 Provider 验证 1–4）

**Blocked by:** 02、03、04、05、06、07、08、09

**Status:** ready-for-agent

- [ ] 基线为 01 合入之前的提交；在真实 Provider 上运行同一段多 Run 会话（含 Todo 写入与 Goal 推进，各 Run 在缓存有效期内连续发出），经追踪接口读取各 Run 首次请求的 cacheRead
- [ ] 改动后不低于基线同一位置，且至少一个 Todo 或 Goal 变化之后的 Run 在基线上未命中、在改动后命中；结果写入证据
- [x] ADR 0024 的 implementation 改为 implemented 并链接实现与验证证据，ADR 索引同步；缺少凭据或任一验证未完成时为 partial，写明未验证项
- [x] 从入口读回上下文管理、Todo List、Goal、Agent Teams、`@coko/agent` 与 protocol 的 README、headless 文档，与实现一致；`check:docs` 通过


Closed: true

## Comments

2026-11-05：按规格的无凭据分支收尾。用户已明确选择“按规格记录未验证，继续实现”，本票没有查找或读取密钥，也没有向真实 Provider 发起请求。上面真实 `cacheRead` 对照与命中门槛保持未勾选，不以 faux 的系统消息稳定性代替实测。默认提示仍为 v1，v2 只供显式评测；ADR 0024 与索引同步为 accepted / partial，真实提示门槛及缓存验收补齐前不升级为 implemented。

[交付证据](../evidence/delivery.md)保存基线 `ec32dfc9`、实施集成 `148c99bc`、各票可复用验证、当前缺口与文档读回回执。正式 ADR 已独立提炼本次无凭据授权、当前实施范围、Sidecar/faux 证据与补验准则，只链接源码、测试及正式文档，不依赖任务材料。

独立从 AGENTS → docs/README → 上下文、Todo、Goal、Agent Teams、子代理、agent/protocol README 与 headless 读回，核对来源配对、continue/压缩/分叉、system 用量、旧版本兼容与默认提示版本。补正文遗漏：File Reference 展开原文的相对顺序与 Run 级 State Update 前置分开说明；子代理首条 user message 明确状态块先于 prompt。规格和设计仍保留 approved，不把真实门槛未完成的整份规格改成 delivered。没有生产代码变更。

检查命令与最终合并核验见下方补记；全分支 Standards/Spec 评审由父代理在本票合入后执行，本票不提前宣称评审通过。真实模型、连续 user 消息的真实协议兼容性、缓存、Electron 窗口/真实指针、产物、CI、推送与发布均未由本票验证。

文档收尾检查：`rtk pnpm install --frozen-lockfile` 退出 0、lockfile 无改动；`rtk pnpm run check:docs` 检查 361 个 Markdown，0 问题、退出 0；`rtk git diff --check` 退出 0。本票仅 Markdown 变更，按测试约定不重复运行有效的源代码测试或类型检查。正文与 ADR 索引从正式入口可达，旧“not-started”只保留于明确的历史 grilling 事实；没有移动/归档资料或改变产品决定。
