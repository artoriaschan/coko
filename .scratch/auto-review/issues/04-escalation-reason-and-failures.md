# 04: 转交理由与审查失败

**What to build:** Reviewer 没有放行时，用户在审批卡上看到它的理由；审查没能完成时，用户看到“自动审查未完成”及原因，调用不会未经判断就执行。覆盖的失败为超时、请求报错、输出无效、没有可用模型。预算与内容过长两种原因分别在 06 与 05 接入，本票定义它们的代码与文案。

**User stories:** 22、38–41。

**Blocked by:** 03

**Status:** ready-for-agent

Closed: true

- [x] 审批请求条目按设计稿升版，新增可选的审查信息：转交时带 Reviewer 的理由，失败时带失败原因的代码；旧版本读取正常
- [x] 审查信息只出现在经过 Reviewer 的请求上；其他询问的审批请求没有它
- [x] 理由按设计稿的上限截断，入库与推送前替换已登记的 Secret 明文
- [x] 审查超过超时时长：取消请求，出现带超时代码的待审批请求，调用未执行
- [x] 审查请求报错、输出不是合法的结构化结果、缺字段或取值不合法：出现带相应代码的待审批请求
- [x] Session 没有可用模型：不发审查请求，出现带相应代码的待审批请求
- [x] 失败不重试
- [x] 失败的审查请求照常记为 purpose `review` 的模型请求（带错误代码）
- [x] 审批卡在请求带审查信息时显示 Reviewer 的理由，或“自动审查未完成”及按代码本地化的原因；键盘、焦点、“总是允许”与拒绝交互不变
- [x] 审查理由不出现在发给主模型的任何请求中（集成测试以标记文本断言）
- [x] 集成测试用测试时钟覆盖超时，用 faux 覆盖报错与非结构化输出
- [x] gate 的运行时级测试覆盖迟到的审查结果在超时之后到达时不生效
- [x] renderer 的 Browser Mode 测试覆盖转交理由与各失败原因的显示
- [x] 中英文文案齐全

## Comments

### 2026-11-20 实施完成（实施代理，基于 feat/auto-review 32c2e00f）

交付：
- `approval_request` 升 v2（agent `session-entries/permissions.ts` 与 protocol DTO），新增 `reviewFailureCodeSchema`、`approvalReviewSchema`；v1 恒等迁移。gate 的 `ReviewFailureCode` 改为条目类型的别名。
- gate：`askTool` 增加可选 `review`，只放进第一次提交的请求；转交为 `{ outcome: 'escalated', reason }`，失败（含端口抛错按 request-failed）为 `{ outcome: 'failed', code }`。其他询问不带 review。
- `SessionReviews`：先对原始输出替换 Secret 再解析、截断，解析后的理由再替换一次（偏离设计稿“先截断后替换”的顺序：避免跨截断点的 Secret 留下前半段，结果仍不超过 300 字符）。
- 审批卡：请求带 review 时明细加一行 `approval.reviewEscalated` + 理由，或 `approval.reviewFailed` + `approval.reviewFailures.<code>`；中英文文案齐全。
- 失败的审查请求记为 purpose review 的 model_request：报错为 `errorCode: model_error`（运行时既有代码），超时为 `timeout`；无法识别的输出 stopReason 为 stop，不带 errorCode（请求本身没有出错）。
- no-model 在真实 Sidecar 中难以构造（Run 进行中必然有模型），以 `SessionReviews` 单测覆盖（模型不可用、子 Session 的根已清空模型），gate 测试覆盖 no-model 出卡。

实际运行：
- `pnpm exec vitest run packages/agent packages/protocol packages/i18n apps/server/src/application`：1864 通过、6 失败，失败均为已知基线（host-stop ×2、能力默认值、approvals、gate-hooks、protocol entries kind 列表）。
- `pnpm exec vitest run --project desktop-renderer apps/desktop/src/renderer/features/conversation`：344 通过、11 失败；file-tool-details ×5、terminal-details ×4 为已知基线；integrated-detail、reading-position 各 1 条在负载下失败，单独复跑 26/26 通过。
- `pnpm exec vitest run --project desktop-renderer .../approval-panel.browser.test.tsx`：10/10 通过（另以临时截图核对了中文转交行的排版，未提交）。
- `pnpm exec vitest run tests/integration/sidecar-auto-review.test.ts tests/integration/sidecar-permissions.test.ts`（真实 Sidecar，darwin）：20/20 通过。
- `pnpm typecheck`：通过。`pnpm lint`：通过。
- 未验证：真实模型的理由内容与语言；真实 Electron 中的审批卡（只在 Browser Mode 中验证）。

### 关闭（2026-11-20）

已合入集成分支 `feat/auto-review`（最终 HEAD c8633a1d，含两轴代码评审的修复）。
