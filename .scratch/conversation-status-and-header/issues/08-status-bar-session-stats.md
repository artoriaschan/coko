# 08: 状态栏的会话统计

**What to build:** 状态栏在 Token 胶囊左侧增加会话统计胶囊，显示 `{轮} 轮 {步} 步 · {tps} tok/s`。点击后打开会话统计卡，显示模型用时、工具调用用时、首 token 平均耗时（TTFT）和输出速度（TPS）。

**规格场景:** [spec](../spec.md) 的 AC-01 中会话统计的部分、AC-02、AC-05 中两张卡互斥的部分；对应 STAT-04、STAT-05。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** workbench 当前行为说明的状态栏。

**Blocked by:** 07 — 输入框底部状态栏与 Token 用量（状态栏的行、卡片交互与共用的字段渲染）

**Status:** ready-for-agent

**Closed:** true

- [x] 1 轮 = 本 Session 中至少发出过一次主循环模型请求的 Run：用户发送和 Goal Round 计入，单纯的 `/compact` 与交接摘要 Run 不计入。1 步 = 一次主循环模型请求，重试只计一次。
- [x] 没有输出速度时省略 `· {tps} tok/s`；步数为 0 时不显示胶囊；缺少请求记录的旧 Session 不补造统计。胶囊图标为仪表，14px、stroke 1。
- [x] 卡片的标题行：左侧为仪表图标加“会话统计”，右侧为 `{轮} 轮 {步} 步`。之后的行依次是：
  - 模型用时：主循环请求耗时之和。
  - 工具调用用时：从工具调用发出到拿到结果，包含审批等待，与 Trace 的工具耗时一致。
  - 首 token 平均（TTFT）。
  - 输出速度：输出 token 除以生成时间，生成时间 = 请求耗时减去 TTFT。

  值为 0 或未知的行不显示。
- [x] 耗时小于 60 秒显示为 `45.2秒`，否则显示为 `2分42秒`。速度不小于 10 时取整，小于 10 时保留 1 位小数。
- [x] 交互与 07 的 Token 卡一致；打开其中一张卡时，另一张关闭。
- [x] 统计与格式化写成纯函数，用单元测试覆盖：多个 Run、失败后重试、`/compact`、交接摘要、缺少 TTFT、值为 0。真实 App 的 Browser Mode 测试覆盖胶囊与卡片的读数和交互。
- [x] 同步修改 workbench 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。数据只从已加载的条目派生；“轮”和“步”使用 Coko 的 Run 与模型请求，不把参考实现的 turn 直接当作领域对象。

- 2026-11-04 实施完成：在 07 的行中加入仪表胶囊与统计卡，两枚胶囊共用截断测量、Tooltip、Popover、外点与 Escape 焦点恢复；受控单值状态保证互斥，可直接切换。统计只看已提交请求与工具消息，不接入流式增量。`model_request` 每次实际尝试都有不同 requestId，故请求去重之后按 `retries` 归并逻辑步数，模型用时仍保留失败尝试。TTFT 平均使用有记录的样本，TPS 只使用输出和正生成时间能配对的样本，不把缺失 TTFT 或未报告输出当零。
- TDD：首个纯函数用例先因模块不存在失败；真实 App 用例先因找不到“Session statistics”胶囊失败；未报告输出的对手用例先得 550 而期望 100，修复后通过。独立样例覆盖两轮三步、多次尝试、压缩/交接/标题排除、重复请求、工具结果去重与未完成调用、审批等待、缺失/零 TTFT、zh/en 时间与速度边界。
- 检查对象：基线 `d0db1a40` 加本票工作区。`pnpm run test apps/desktop/src/renderer/features/conversation/session-statistics.test.ts apps/desktop/src/renderer/features/conversation/session-status-bar.browser.test.tsx apps/desktop/src/renderer/features/conversation/assistant-footer.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：4 文件、66 例，65 通过、1 失败，退出 1；本票纯函数 5、真实 App 状态栏 9、既有助手底栏 12 共 26 例全部通过，样式守卫 39/40，唯一失败为前置 03 的 `conversation-pane.tsx:352 border-b-2`，已交集成流程由 06 修复。没有降低守卫或增加例外。
- `pnpm run typecheck`：退出 0。`pnpm run check:docs`：319 个 Markdown，0 问题，退出 0。五个改动 TS/TSX 文件的 `pnpm exec oxfmt ...` 与 `pnpm exec oxlint ...` 均退出 0。依赖按 `pnpm install --frozen-lockfile --offline` 安装，锁文件未改。
- 文档影响：在既有 workbench 状态栏章节补充统计范围、重试和时间样本规则、两卡互斥及测试入口；从 AGENTS → docs/README → workbench 读回，归属/导航/引用方向/历史保留均通过，未新增正式目录、未修改视觉稿。真实 Electron 组合、两主题与原生层检查由 09 统一进行，本票不把 Browser Mode 结果说成 Electron 验收。
