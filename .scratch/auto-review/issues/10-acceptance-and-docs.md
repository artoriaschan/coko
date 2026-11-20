# 10: 集成验收与文档

**What to build:** 对照 [规格](../spec.md) 的全部用户故事做一次端到端验收，并把正式文档更新到与实现一致：当前行为文档描述五档模式与 Reviewer，术语表有 Auto Review 与 Reviewer，新 ADR 的实施状态改为已实施。交付说明如实区分已验证与未验证的部分。

**User stories:** 全部（验收）。

**Blocked by:** 04、05、06、07、08、09

**Status:** ready-for-agent

- [x] 一条 Electron E2E（后台模式）：选择“自动审查”，faux 先放行一条命令、再转交一条；工具卡出现放行标注，审批卡出现转交理由，用户允许后 Run 完成，磁盘上的结果符合预期
- [x] 逐条核对规格的 69 个用户故事，每条对应到已有的测试或本票补充的测试；缺口在本票补齐或在 Comments 中说明
- [ ] 打包产物 smoke 中的权限用例在五档下通过；若未运行，在交付说明中列为未运行
- [x] [权限判定与审批](../../../docs/subsystems/permissions.md) 更新：五档模式表、Reviewer 在判定中的位置与调用条件、两个审批条目的新字段、“自动审查中”推送、界面各处、验证清单
- [x] 外部 Hook、无界面运行、子代理、Goal（预算）、定时任务、追踪与审计的当前行为文档按实现更新
- [x] 桌面工作台与界面约定中涉及模式菜单、工具卡、审批卡的部分按实现更新
- [x] 术语表新增 Auto Review 与 Reviewer，注明“帮我批准”是 `accept-edits` 的界面名、不是 Auto Review 的同义词
- [x] 新 ADR 的实施状态改为已实施并补实施证据；ADR 0005 的后继说明与 [ADR 索引](../../../docs/adr/README.md) 同步
- [x] 相关包的 README 按实现更新
- [x] 正式文档不链接 `.scratch/` 中的具体材料
- [x] `pnpm run check:docs` 通过；从文档导航读回更新过的正文
- [x] 按 [测试执行与报告规则](../../../docs/tech-stack/testing.md#测试执行与结果报告) 报告：实际运行的命令、范围与结果，区分通过、失败、跳过与未运行；仅在 darwin 运行的 Seatbelt 用例如实标注
- [x] 交付说明把“真实模型的审查质量”（该放行的是否放行、该转交的是否转交、是否会被说服）列为未验证
- [x] 交付说明写明规格 Further Notes 中的三项已知局限
- [x] 规格的 Spec status 按文档生命周期更新为已交付，并补实施票与设计稿的链接

## Comments

**2026-11-20 用户故事核对（故事号 → 测试）。** 缩写：AR = `tests/integration/sidecar-auto-review.test.ts`，SUB = `sidecar-subagents-auto-review.test.ts`，
HL = `headless-auto-review.test.ts`，SEC = `secrets-gate-auto-review.test.ts`，PERM = `sidecar-permissions.test.ts`，GR = `packages/agent/src/policy/gate-review.test.ts`，
RV = `policy/review.test.ts`，DEC = `policy/decide.test.ts`，ENT = `session-entries/session-entries.test.ts`，SR = `apps/server/src/application/session-reviews.test.ts`，
MP / AP / TC / PS / PL = `apps/desktop/src/renderer/features/conversation/` 下 mode-picker / approval-panel / tool-cards / permission-states / plan 的 browser 测试，
E2E = `apps/desktop/e2e/permissions.e2e.test.ts`。

| 故事 | 测试 |
| --- | --- |
| 1–5 | MP“菜单四项……自动审查有自己的图标、普通档位颜色，选择不确认”“英文：名称与两项说明”；E2E“新对话选自动审查”（本票） |
| 6–7 | MP“Shift+Tab 循环 read-only → … → auto-review，从 full-access 回到 read-only”；E2E Shift+Tab 用例（基线失败，见下） |
| 8 | MP“设置页默认模式可选自动审查”；PERM“首次发送与默认模式设置接受 auto-review” |
| 9 | PL“标出执行权限……”（菜单四项含 auto-review）与五档 `it.each` |
| 10 | AR / GR“审查途中切到 default / full-access”；PERM“切到 auto-review 后读回……” |
| 11 | DEC“五种模式 × 工具类型”（accept-edits 不变）；PERM“旧数据”（v3 accept-edits 原样读回） |
| 12、21 | AR“放行”“转交”；E2E |
| 13 | AR“MCP 工具调用送审，请求带工具描述”；GR MCP 描述 |
| 14–15 | AR“Workspace 外的读取与带 Worktree 隔离的 Subagent 派发送审”（读凭据文件仍问用户属模型判断，未验证） |
| 16 | AR / HL Seatbelt 用例（darwin）；SUB“定义上限 auto-review……越界写入被拒绝” |
| 17–18 | AR“不送审：允许规则覆盖的命令、Workspace 内读取、可写根内编辑”；GR |
| 19 | TC“由自动审查允许”；E2E |
| 20 | PS“auto review in progress”；`stores/chat-store.test.ts`“自动审查中”；AR / GR review_start |
| 22 | AP“转交”；AR“转交”；E2E |
| 23 | AR“转交：出现带建议规则的待审批请求”；AP；E2E |
| 24–25 | RV“固定审查提示全文”（类别写入提示）；模型是否照做未验证 |
| 26 | AR“schedule_create 直接出审批请求”“定时任务触发的 Run” |
| 27 | RV 输出解析（只有 allow / escalate）；GR 转交与失败 |
| 28 | AR / GR 转交后无反馈与带反馈拒绝 |
| 29–34 | AR“对手用例：审查应答恒为放行”（拒绝、询问规则、`.git`、越出可写根、计划审阅）与 Seatbelt 用例（Escalation，darwin） |
| 35–36 | AR“Hook 先于 Reviewer”；HL Hook 用例；GR |
| 37 | AR“项目设置中的拒绝与询问规则照常收紧，且没有审查请求”（本票） |
| 38–39、41 | AR“审查超过 15 秒”“请求报错、非结构化文本、缺字段、取值不合法”；AP 失败原因 |
| 40 | SR“返回 no-model”；GR 六种代码；AP 文案（集成层无：faux 只有一个模型） |
| 42 | AR“待审调用放不下”；RV |
| 43–45 | AR“授权来源与抗注入”各例；RV；SUB 派发说明 |
| 46 | AR“理由……不出现在发给主模型的任何请求中” |
| 47 | SEC；AR 理由的 Secret 替换 |
| 48–51 | SUB 全部用例；`agents/definitions.test.ts` 五档取窄 |
| 52–53 | AR“Goal Round……”“定时任务触发的 Run” |
| 54–56 | AR“审查请求（含失败的）的用量计入 Goal……”（本票补断言 `request-failed` 与 `budget`）；SUB 用量 |
| 57 | AR / GR 审查途中切换模式与新增规则；SUB 根切 default |
| 58 | AR“切换到 auto-review 时已在等待的请求保持等待”（本票）；GR |
| 59 | GR“同一批的多个调用按顺序逐个审查”（集成层未单独断言） |
| 60 | AR / GR 停止；GR 暂停 |
| 61–63 | HL；`headless.test.ts`“--permission-mode auto-review 被接受” |
| 64 | PERM 两个 auto-review 入口用例 |
| 65 | AR 放行（`by: reviewer` 与理由）；ENT v4 |
| 66 | AR 放行（追踪 purpose review）与 Goal 用例（Run 请求序列） |
| 67 | `sidecar-hooks.test.ts`“auto-review 下 Hook 输入的 permission_mode” |
| 68 | ENT 各版本迁移；PERM“旧数据”（本票加入 approval_request v1 与 approval_decision v3） |
| 69 | PERM 分叉沿用 auto-review；`sidecar-handoff.test.ts` 交接沿用 |

缺口：24、25 与 14 中“读凭据文件仍问我”依赖真实模型判断，只验证了提示文本与链路；40 只有单元与 Browser Mode；59 只在 gate 运行时层断言。

**2026-11-20 交付说明。**

- 本票新增或补齐的测试：E2E“新对话选自动审查”（permissions.e2e）；AR 补 `request-failed` 与 `budget` 代码断言（先改成错误代码确认失败再恢复）、
  新增“项目设置中的拒绝与询问规则”（改弱询问规则后确认失败）与“切换到 auto-review 时已在等待的请求”；PERM“旧数据”加入旧版审批条目。
  E2E 与“已在等待”用例针对已有行为，没有构造回归做红灯。产品代码未改。
- 父视图不显示子 Session 的“自动审查中”：不补。规格只要求工具卡显示，推送带 Session 与工具调用标识；子 Session 的工具卡在子 Session 视图中显示该状态。已写入子代理与权限文档。
- 文档：permissions（五档、Reviewer 一节、条目、协议、界面、验证、尚未实现）、hooks、headless、subagents、goal、schedules、tracing、plan-mode、
  workbench、mcp / skills（四种模式措辞）、tech-stack/ui、GLOSSARY（Auto Review、Reviewer）、ADR 0029（implemented 与实施证据）、ADR 0005、ADR 索引、
  docs/README 摘要、`packages/agent` 与 `apps/server` README；规格 Spec status 为 delivered 并补设计稿与实施票链接。正式文档未链接 `.scratch/`。
- 运行的命令与结果：
  - `pnpm run check:docs`：通过（452 个文件，0 个问题）；从 docs/README → 权限判定与审批 → 自动审查一节读回。
  - `pnpm typecheck`：通过。`pnpm exec oxlint`：退出 0。`pnpm exec oxfmt --check` 本票改动的三个测试文件：通过。
  - 单元（agent / server / desktop / protocol / i18n 的 policy、session-entries、agents、planning、observability、session-reviews、
    session-permissions、headless、chat-store、new-chat-store、timeline、trajectory-record、protocol、i18n）：37 文件 627 例，624 通过、3 失败；
    失败为 `policy/approvals.test.ts`、`policy/gate-hooks.test.ts`、`protocol/src/entries.test.ts` 各一例，单独复跑仍失败，本票未改这些文件与产品代码，属已知基线失败。
  - Browser Mode（desktop-renderer：mode-picker、approval-panel、tool-cards、permission-states、plan）：5 文件 61 例通过。
  - 集成（sidecar-auto-review、sidecar-subagents-auto-review、secrets-gate-auto-review、headless-auto-review、headless、sidecar-permissions、
    sidecar-hooks、sidecar-handoff、sidecar-plan、sidecar-skills）：117 例通过（darwin，Seatbelt 用例实际运行；其他平台会跳过）。
    之后新增的两例与扩展的旧数据例单独运行通过。
  - E2E（desktop-e2e，`COKO_E2E_BACKGROUND` 由 harness 设置）：permissions.e2e 中新的自动审查用例通过；同文件的 Shift+Tab 与“总是允许”两例失败，
    原因是助手文本后多了页脚“Usage unavailable”，与已知基线相同（新用例改用 `filter({ hasText })` 避开）；Permissions 分区一例通过。
  - 打包产物 smoke（package-smoke.e2e）：未运行；其中没有五档的权限用例，本票未扩展。
- 仅在 darwin 运行：AR、HL、SUB 中的 Seatbelt 用例（审查放行的越界写入被拒、Escalation 不送审）。
- 未验证：真实模型的审查质量（该放行的是否放行、该转交的是否转交、是否会被说服）；真实 Provider 的审查请求；真实指针与原生层未涉及。
- 规格 Further Notes 的已知局限：沙箱只约束文件写入，审查放行的命令仍可读 Workspace 外文件并访问网络；Reviewer 只看命令行，看不到将执行的脚本内容
  （同一 Run 中先写后执行的写入参数可见，更早 Run 的不可见）；每次送审增加一次模型请求的延迟，允许规则可减少送审。
