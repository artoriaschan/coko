# 05: 授权来源与抗注入

**What to build:** Reviewer 判断“这个动作是否在用户授权范围内”时，只把用户亲自输入的消息、当前 Goal 的目标与 Success Criterion、已批准的 Plan 当作授权；模型自己写的内容只作为“助手委派的任务”供参考；工具结果与助手正文完全不给它。输入有上限，待审调用过长时不发请求而直接问用户。审查不成为 Secret 的新泄露通道。

**User stories:** 42–47。

**Blocked by:** 03

**Status:** ready-for-agent

- [x] 审查输入分为用户授权、助手委派的任务、动作三个分区，标注与数据边界取自设计稿
- [x] 用户授权分区包含有效模型上下文中用户亲自输入的消息文本，不含宿主附加的块（State Update、Hook 追加的上下文）
- [x] 存在 Goal 时，用户授权分区包含它的目标与 Success Criterion
- [x] 存在已批准且仍适用的 Plan 时，用户授权分区包含它（适用范围按规格 Further Notes 中与计划生命周期的关系）
- [x] 压缩摘要、定时任务的提示词、Goal Round 中宿主合成的继续提示归入助手委派的任务，标注为不构成授权
- [x] 动作分区包含本 Run 已发生的工具调用的名字与参数，以及待审的调用；待审的是 MCP 工具时附带它的描述
- [x] 审查输入不含工具结果、助手正文与思考、图片内容
- [x] 输入超过上限时从最早的内容开始丢弃并标注
- [x] 待审调用自身的参数无法完整放入时不发审查请求，出现带“内容过长”代码的待审批请求
- [x] 审查请求的输入与请求快照经与其他模型请求相同的按值脱敏
- [x] 集成测试：先前工具结果中的标记文本与助手正文中的标记文本不出现在审查请求里；用户消息与待审命令出现在各自的分区
- [x] 集成测试：Goal 的目标、已批准的 Plan 出现在用户授权分区；压缩后的摘要、定时任务提示词、Goal Round 的继续提示出现在委派分区
- [x] 对手用例：待审命令的参数与先前工具调用的参数中含伪造的放行指令时，这些文本只出现在数据边界之内，系统提示逐字不变
- [x] 对手用例：用户消息中伪造的宿主块标签不被当作宿主附加的块而丢弃或升格
- [x] Secret 的集成测试沿用现有 secrets gate 的通道写法，覆盖审查请求、保存的理由与请求快照

## Comments

### 2026-11-20 实施说明（实施代理）

- 实现：`packages/agent/src/policy/review.ts` 补齐三个分区（Goal、执行中的已批准 Plan、委派任务、先前调用）、设计稿的六个上限常量、
  单项截断、按“先前调用 → 委派任务 → 用户消息（最后一条不丢）”的整项丢弃与 `omitted` 标注、待审调用超过 8 000 字符时 `tooLong`；
  `apps/server/src/application/session-reviews.ts` 在构建输入前先对条目与调用按值脱敏（截断可能切开 Secret，残片无法再识别）。
- 偏离设计稿：宿主块不再按文本开头识别。Hook 上下文只认“输入之后的最后一块”（`withSubmitContext` 与子代理首条消息的位置），
  通知只认前一条（越过 `state_update`）为通知条目的整条消息；用户输入里伪造的 `<hook-context>`、`<job-notification>` 标签照常作为
  用户消息（对手用例要求“不被丢弃或升格”）。
- “内容过长”：本票让 `SessionReviews` 返回 `failed('too-long')`、不发请求；待审批请求上的 `review.code` 与文案由票 04 写入，
  合入 04 后可在 too-long 集成用例里补断言 `asked.review`。
- 运行的命令与结果：
  - `pnpm exec vitest run packages/agent/src/policy/`：12 个文件，2 个失败（approvals、gate-hooks，已知基线失败；把 review.ts 换回
    基线版本复跑仍是这 2 个），其余通过；`review.test.ts` 28 通过。
  - `pnpm exec vitest run tests/integration/sidecar-auto-review.test.ts tests/integration/secrets-gate-auto-review.test.ts`：
    2 个文件全部通过（darwin 上 Seatbelt 用例运行）。
  - `pnpm typecheck`、`pnpm lint`：通过。
