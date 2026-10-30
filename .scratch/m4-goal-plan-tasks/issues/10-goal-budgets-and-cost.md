# 10: Goal 预算与费用：五维预算、调用前检查、模型价格与 usage.cost

**What to build:** 见 [规格](../spec.md) "预算口径""检查点"与"模型价格与费用"：agent `goals/` 的预算派生（从条目计算五维、接受子 Session 条目的汇总函数）与检查；运行时 `beforeRequest` 检查 Token / 费用 / 时间并 `stopAfterBatch`、工具调用前检查调用数、Goal Round 开始前检查五维；未定价模型遇到 maxCost 时 blocked（cost-unpriced）；`compaction` v2 的 `usage`（摘要请求的 usage）；Model Catalog 的可选 `price`（protocol、server 校验、注册表写入 `model.cost`）；设置 `usage.currency`；设置 → 模型服务的价格输入与货币选择；faux 脚本可设 usage 以驱动测试。M4 结束时汇总 agent 与 server README。

**User stories:** 3, 16

**Blocked by:** 09

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/goals/`、`packages/agent/src/engine/`、`packages/agent/src/models/registry.ts`、`packages/agent/src/session-entries/{goals,context}.ts`、`packages/protocol/src/{goal,http,context-entries}.ts`、`apps/server/src/application/{goals,goal-driver,session-runs,providers}.ts`、`application/context/goal.ts`、`http/routes/goals.ts`、`apps/server/src/adapters/faux.ts`、`apps/desktop/src/renderer/features/settings/{model-catalog,models-section}.tsx` 与 `catalog-draft.ts`、`packages/i18n/src/dictionaries/domains/usage.ts`、`tests/integration/{sidecar-goal-budget,sidecar-model-price}.test.ts`（新）、`apps/desktop/src/renderer/**/model-price*.browser.test.tsx`（新）、`docs/subsystems/goal.md`、`docs/adr/0011-goal-state-as-session-entries.md`、`.scratch/model-service-settings/spec.md`（10.1 追加修订记录）、`packages/agent/README.md`、`apps/server/README.md`

- [x] agent 表驱动：五维派生（用户提交的 Run 计入 Token / 费用 / 时间 / 工具调用、不计轮次；paused 期间开始的 Run 不计；compaction.usage 计入）；子 Session 汇总函数；`compaction` v1 读回为 v2
- [x] 集成：每一维单独设上限各一例，达到后 Run 以 `paused` + `budget_exhausted` 结束、Goal 为 budget-exhausted 且 reason 写明维度；工具调用上限时超出的那次调用不执行（Workspace 文件逐字节不变）；调高上限后恢复继续
- [x] 集成：设 maxCost、模型未定价 → 不发出模型请求（requestLog 为空）、Goal blocked（cost-unpriced）；模型有价格时 assistant 条目的 usage.cost 与价格一致（手算期望值）
- [x] 集成 `sidecar-model-price`：`provider.save` 保存价格并读回；负数价格 400；没有价格的旧目录照常可用
- [x] Browser Mode：模型选项的价格输入（留空 = 未定价、负数报错）与货币选择；模型服务页其余交互与 MS 验收场景不受影响（已有测试通过）
- [x] 不适用项：不新增注入点（预算用量进入 `<goal>` 的部分由票 09 的总闸覆盖，本票在该用例中补用量字段的断言）
- [x] goal.md 补预算；ADR 0011 改为 implemented 并链接 09、10 的证据；模型服务 PRD 10.1 追加修订记录；agent 与 server README 汇总 M4；`check:docs` 通过

## Comments
- 2026-10-30 lead：来自票 09——exhaustedDimension 与 GoalUsageSnapshot 目前只有 rounds；GoalUsage 的可选字段；runEnded 中 budget_exhausted 与 cost_unpriced 的映射；详见票 09 Comments"供后续票"。来自票 05、09 的合并：sidecar-compaction 的自动压缩用例已把窗口改为 65k，本票若再增加系统提示或工具定义，先看该用例第三轮的断言。请核对 goal.md 是否写明票 09 的四项偏离（update_goal 注册时机、停止 Run 暂停 Goal、有序关闭记 user-stopped、goal-n 与 snake_case），缺则补。faux 的 $LAST_JOB_ID 占位保留（票 04）。
- 2026-10-30 implementer（m4/10-goal-budgets-and-cost）：
  - **覆盖的验收：** 全部 7 项。agent 表驱动 `packages/agent/src/goals/budget.test.ts`（15 例：五维派生、paused 期间不计、用户 Run 不计轮次、compaction.usage、进行中的 Run 计到 now、拦下的调用不计、子 Session 汇总、耗尽维度与消息、按完整用量判定恢复、`<goal>` 用量行）；`engine/compaction.test.ts` 增 1 例（compaction.usage、v1 读回为 v2）；`models/models.test.ts` 增 1 例（价格写入 model.cost、priced 判定、负数拒绝）。集成 `sidecar-goal-budget.test.ts`（7 例：tool-calls 两例含文件逐字节不变、tokens、cost（usage.cost 与手算 0.2 + 0.2 = 0.4 一致）、time、rounds 各自耗尽 → 调高 → 恢复 → 完成；未定价 + maxCost → blocked（cost-unpriced），Goal 没有模型请求）；`sidecar-model-price.test.ts`（1 例：保存与读回含重启、真实注册表路径下 usage.cost 与手算 0.85 一致、未定价为 0、负数 400、旧目录可用、去掉价格后不计费）。Browser `model-price.browser.test.tsx`（3 例）与 `catalog-draft.test.ts` 增 12 例；settings 目录下 13 个文件 116 例全部通过（MS 场景未受影响）。`secrets-gate-goal.test.ts` 补用量字段断言（HTTP usage 与 requestLog 中的 `<goal>` 用量行）。
  - **负向确认（变异，均已还原）：** 工具 hook 永不拦截 → sidecar-goal-budget 两例 tool-calls 失败；预算派生不计 compaction → budget.test 失败；注册表忽略 price → sidecar-model-price 失败。价格输入正则丢失反斜杠时 browser 用例确实失败（已修复）。
  - **实现要点：** 检查点三处——Goal Round 开始前（GoalDriver.advance：五维 + 未定价）、模型请求前（GoalService.beforeRequest：Token / 费用 / 时间 + 未定价，返回 stop）、工具调用前（GoalService.toolHooks：已提交 + 本 Run 已放行未提交的调用 ≥ max 时拦下并 stopAfterBatch，按 Session 串行）。只对 running 的 Goal 与属于它的 Run 检查（waiting-input 期间用户提交的 Run 计入用量但不被拦，避免用户被锁在会话外）。
  - **与规格的取舍（请 Lead 裁决）：** ①"已定价"= 目录中带 `price`（全 0 也算）；不经目录注册的 Provider（faux）按 cost 是否非零判定。全 0 价格的模型费用上限永不耗尽（goal.md 已知限制）。②Checkpoint 的 afterToolCall 前备份 hook 排在预算 hook 之前：被拦下的 write / edit 可能留下一份备份，Workspace 文件不变（已知限制）。③工具调用上限拦下的错误结果不计为调用（按结果文本前缀识别）；权限拒绝的调用照常计入。④`usage.currency` 不在 SettingsService 校验（通用键值），renderer 对非 CNY 值一律按 USD。⑤协议的 `ModelPrice` 不设 minimum：非法值由 sidecar 以 400 回答（控制通道会静默丢弃不合 schema 的消息，main 收不到回答）。
  - **越出 Write scope 的最小改动：** `packages/agent/src/index.ts`（导出 `ModelPrice` 类型）；`packages/agent/src/engine/compaction-driver.ts` 与 `session-entries/context.ts` 在范围内；`packages/agent/src/models/models.test.ts`（价格用例）；`tests/integration/secrets-gate-goal.test.ts`（用量断言，票中要求）；`apps/desktop/src/renderer/features/settings/catalog-draft.test.ts`（价格解析用例）；`docs/subsystems/context.md` 一行（compaction v2 的 usage 字段）。i18n 价格文案放在 usage 域（范围内），未改 providers 域。
  - **实际运行：** 见完成报告（全量 `pnpm run test` 含 desktop E2E 与 package-smoke）。单独运行：goals 2 文件 177 例、models 26 例、compaction 8 例、sidecar-goal / goal-restart / goal-budget / secrets-gate-goal / compaction 5 文件 20 例、sidecar-model-price 1 例、settings 13 文件 116 例；`tsc -b`、lint、format:check、check:docs（154 文件 0 问题）退出 0。
  - **不适用项：** 不新增注入点与读取根；预算只读已提交条目，不读文件，符号链接越界不适用。sidecar-compaction 的窗口断言未受影响（没有新增工具定义与 system section，只改了 `<goal>` 内的行）。
  - **未验证：** 真实模型（无凭据）；beforeRequest 的 cost_unpriced 分支只由 advance 路径的集成用例间接覆盖（Goal 为 running 而模型未定价时 advance 先拦下）；Electron E2E 的价格输入场景（规格把它放在 E2E，本票以 Browser Mode 验收）。
  - **文档影响：** goal.md 增"预算""模型价格"两节与验证、已知限制；ADR 0011 改为 implemented 并记证据；模型服务 PRD 10.1 增 M4 修订记录、第 9 节注明；context.md 一行；agent 与 server README 汇总 M4。导航无新行。
  - **供后续票（票 11）：** `GoalResponse.usage` 现带 `toolCalls`、`tokens`、`cost`、`durationMs`、`costUnpriced`（有 Goal 时总是给出）；耗尽 reason.code 取值 `rounds` / `tool-calls` / `tokens` / `cost` / `time` / `cost-unpriced`；货币 `USAGE_CURRENCY_SETTING`、`usageCurrencyOf`（@coko/protocol）；i18n `usage.unpriced`、`usage.currency.*`、`usage.price.*` 已加；assistant 条目的 `usage.cost` 已按价格计算，`compaction.usage` 可用于 Run 用量行；模型是否定价在 renderer 侧可由 Provider 目录的 `price` 是否存在判断（faux 无目录）。

