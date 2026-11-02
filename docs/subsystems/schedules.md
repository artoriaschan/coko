---
kind: reference
description: "当前的定时任务（Schedule）契约：四种规则与 cron 语法、时区与夏令时、下次时间与对齐、定时器与 30 秒复查、到期的准入与跳过原因、记录后开始 Run（至多一次）、挂起与只补最近一次、<scheduled_task> 输入、授权限制、四个工具与权限类、HTTP 接口与 schedule_update 进度、桌面通知与通知设置、界面（标题栏按钮、Schedules tab、设置分区、投递行）、测试时钟与已知限制。修改定时任务的规则、投递、准入、工具、接口、通知或界面前查阅。"
lifecycle: active
---

# 定时任务

本文说明 Coko 当前如何让 Agent（或用户）设定一次性、固定间隔或 cron 定时任务，到期时在原 Session 中开始一个 Run，以及应用关闭或睡眠后如何补跑。决定与备选方案见 [ADR 0015](../adr/0015-schedules-at-most-once-latest-catch-up.md)；权限类见 [权限判定与审批](permissions.md)；Goal 的授权与预算见 [Goal](goal.md)。界面见下文 [界面](#界面)。

## 结构入口

| 位置 | 职责 |
| --- | --- |
| `packages/agent/src/tasks/schedules/cron.ts` | `parseCron`、`nextCronTime`、`isValidTimeZone`：五段 cron 与按 IANA 时区的下次时间 |
| `packages/agent/src/tasks/schedules/rules.ts` | `validateRule`、`nextOccurrence`、`catchUp`、`parseAt` 与上限常量 |
| `packages/agent/src/tasks/schedules/tools.ts` | 四个工具、`SchedulesPort`、`schedulesAllowed`（授权）、`scheduledTaskText`（`<scheduled_task>`） |
| `packages/agent/src/session-entries/schedules.ts`、`packages/protocol/src/schedules.ts` | `schedule_fire` v1；`ScheduleRule`、`Schedule`、请求体、`schedulePaths`、`ScheduleUpdate` 进度 |
| `packages/session` 的 `schedules` 仓库 | 表 `schedules`；`recordFire` 在一个事务中更新任务并追加 `schedule_fire` |
| `apps/server/src/application/schedules.ts` | `ScheduleService`：增删改、定时器与复查、准入、投递、挂起、通知 |
| `apps/server/src/application/context/schedules.ts` | 上下文贡献：四个工具与 `onRunEnd` |
| `apps/server/src/http/routes/schedules.ts` | HTTP 接口 |
| `apps/server/src/adapters/clock.ts`、`http/routes/test-clock.ts` | `ClockPort`：系统时钟与测试时钟 |
| `apps/server/src/application/notifications.ts`、`apps/desktop/src/main/notifications.ts` | `NotificationService`（设置与 `notify` 控制消息）；main 的显示、点击打开会话与测试构建日志 |
| `packages/agent/src/entries/index.ts` | 经 `@coko/agent/entries` 导出 `upcomingOccurrences`、`validateRule` 等纯函数：renderer 的表单校验与预览与 Sidecar 同一实现 |
| renderer `stores/schedules-store.ts` | 按会话与全部会话的列表、增删改（按已知 revision，冲突时读回）、`schedule_update` 合并 |
| renderer `features/conversation/{schedules-button,schedule-fire-row}.tsx`、`features/right-panel/schedules-tab.tsx` | 标题栏按钮与共用的文案函数、时间线投递行、右栏 Schedules tab（列表、表单、历史、行操作） |
| renderer `features/settings/{schedules,notifications}-section.tsx` | 设置 → 定时任务（全部会话）与设置 → 通知 |

## 规则

| kind | 字段 | 含义 |
| --- | --- | --- |
| `after` | `seconds`（≥ 1） | 创建后若干秒执行一次 |
| `at` | `at` | RFC 3339 带偏移（`Z` 或 `±hh:mm`）的时刻执行一次，须在将来；不带偏移的本地时刻不接受 |
| `every` | `seconds`（≥ 60） | 按创建时刻对齐的固定间隔：创建时刻 + k × 间隔 |
| `cron` | `expression`、`timeZone` | 五段 Vixie cron，按 `timeZone` 的本地时刻 |

- **cron 语法。** 分 0–59、时 0–23、日 1–31、月 1–12、周 0–7（0 与 7 为周日）；每段为 `*`、值、`a-b`、`*/n`、`a-b/n` 或它们的逗号列表，段之间任意空白（保存时归一为单个空格）。只接受数字：名字（`MON`）、`?`、`L`、`W`、`#`、`@daily` 与六段表达式都拒绝；单个值不能带步长（`5/10`）。在任何年份都不存在的日期（周为 `*` 时的 2 月 30 日）拒绝。
- **日与周。** 两段都不是 `*` 时任一匹配即可（`0 0 13 * 5` 为每月 13 日或每个周五）；只有一段不是 `*` 时只按那一段。只有恰为 `*` 的段算作不限。
- **时区。** IANA 名（`Area/Location`，可多段）或 `UTC`；偏移写法（`+08:00`）与缩写（`EST`）拒绝。夏令时开始时不存在的本地时刻跳过（`America/New_York` 2026-03-08 的 02:30 不执行，下一次为次日 02:30）；结束时重复的本地时刻只取较早的一次（01:30 只在 EDT 的那一次执行）。下次时间在本地日历上搜索 8 年（覆盖 2 月 29 日）。
- **存储。** `next_at` 与 `last_occurrence` 为 UTC 毫秒；时间都取 `ClockPort`。每个 Session 至多 20 个 active 任务（第 21 个 400）；title ≤ 120、prompt ≤ 8 000 字符，入库前按值替换登记的 Secret。

## 定时器与投递

- **定时器。** `ClockPort.setTimer` 指向最早的 `next_at`（挂起的任务不计），另每 30 秒复查一次；任何增删改之后重排。启动恢复之后开始，有序关闭时最先停止（停止 HTTP 之后、中断 Run 之前），之后不再投递。扫描串行：同一时刻到期的任务按 `next_at` 与创建顺序处理。
- **补跑。** 到期时从 `next_at` 起到此刻的全部发生次只投递最近一次，其余计入 `missed`；下一次为严格晚于此刻的发生时刻（间隔任务保持原对齐）。启动扫描、睡眠唤醒与挂起都走这一步。cron 的逐个计数以 10 000 封顶。
- **准入**（按顺序）：Session 未归档（`session-archived`）→ 有效配置 `schedules.enabled`（项目设置可关闭）→ 不是子 Session（`child-session`）→ 绑定的 worktree 未移除（`worktree-removed`）→ 工作目录存在（`workspace-missing`）→ Session 有模型或有默认模型（`model-not-configured`）→ Session 的 Goal 非终态、不是 paused 且没有维度耗尽（`budget`；用量取 GoalService，与 Goal 预算同一口径，含子 Session）。不通过时 `recordFire` 记下 `schedule_fire { status: skipped, reason }`，重复任务照常计算下一次，一次性任务 inactive。
- **至多一次。** 准入通过后先 `recordFire`（一个事务：`last_occurrence`、新的 `next_at`、一次性任务的 inactive 与 `schedule_fire { status: started, missed? }`），再以 `trigger: schedule`、`run_start.schedule { scheduleId, occurrence }` 开始 Run。两步之间崩溃时该发生次视为已投递，重启后不重投。Run 没能开始（例如同时有用户提交）时追加 `schedule_fire { status: skipped, reason: start-failed }`。
- **挂起。** Session 有 Run 进行中时不记录、不投递，任务挂起；该 Run 的 `run_end` 之后（排在其他领域的 Run 结束处理之后）重新判定一次。挂起期间再次到期的合并为这一次（`missed` 计数）。挂起只在内存中；挂起期间重启时任务仍到期，启动扫描照常投递一次。
- **输入。** `<scheduled_task schedule-id="…" title="…" occurrence="ISO">prompt</scheduled_task>`：prompt 原文，不经命令与 File Reference 展开（`/goal resume` 不展开为动作）；属性值转义 `& " < >`；各领域的待送达内容（例如后台任务通知）照常合并在前。

## 授权

- `trigger: schedule` 的 Run 没有用户授权（`runAuthority` 为 none）：`create_goal`、`update_goal` 的编辑、暂停与恢复为错误结果；不恢复 paused 的 Goal。
- `schedule_create` 与 `schedule_update` 在定时任务触发的 Run 与子 Session 中为错误结果 `schedule-not-allowed: …`。判定只看宿主写入的最后一个未结束的 `run_start`：用户在普通消息中写 `<scheduled_task …>` 不使该 Run 成为定时任务触发（`trigger` 仍为 submit）。
- 定时任务的 Run 在 Session 当前的权限模式下运行，询问照常等待审批。

## 工具

| 工具 | 权限类 | 说明 |
| --- | --- | --- |
| `schedule_create { title, prompt, after_seconds \| at \| every_seconds \| cron + time_zone }` | automation（规则组名 `Schedule`，只有 full-access 放行） | 恰好一个规则；`time_zone` 只与 `cron` 一起且必须给出 |
| `schedule_list` | context-read | 每行 `<id> [<status>] <title> — <规则>; next <ISO>` |
| `schedule_update { id, title?, prompt?, <规则>?, status?: active \| paused }` | automation | 新规则替换旧规则 |
| `schedule_delete { id }` | session-state | |

只作用于本 Session 的任务（其他 Session 的 id 为错误结果）。能力开关 `schedules.enabled` 关闭时不注册。拒绝与询问规则照常生效：`Schedule` 的拒绝规则在 full-access 下同样拒绝。

## 修改与恢复

- 恢复（paused / inactive → active）或改规则后重算下一次：间隔恢复时沿用原对齐、改规则时以此刻为新对齐点；cron 为此刻之后的下一次（暂停期间错过的不补）；`at` 须在将来；`after` 仍在将来时保留，否则从此刻重新计时。没有将来发生次的 active 为 400。
- 恢复同样受每 Session 20 个 active 的上限。

## HTTP

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/schedules?sessionId=` | `Schedule[]`（按创建顺序；省略 sessionId 为全部会话；Session 不存在 404） |
| `POST /api/sessions/:id/schedules { title, prompt, rule }` | 201 `Schedule`；规则不合或超过上限 400；子 Session 409 `child-session` |
| `PATCH /api/schedules/:id { revision, title?, prompt?, rule?, status? }` | `Schedule`；revision 不一致 409 `revision-conflict` |
| `DELETE /api/schedules/:id` | 204；不存在 404 |

`Schedule` 为 `id`、`sessionId`、`title`、`prompt`、`rule`、`status`、`nextAt?`、`lastOccurrence?`、`lastFire? { status, reason?, runId? }`、`revision`；`lastFire` 取该任务最近的 `schedule_fire`，started 时 `runId` 来自带同一 `schedule` 的 `run_start`。新建、修改与每次记录后经 WebSocket 推送 progress `schedule_update`（快照，`runId` 为空串，不使客户端进入运行中）；删除不推送，客户端重读列表。

## 通知

`NotificationService.notify({ kind, sessionId, title, body })` 读取设置键 `notifications`（`{ enabled, scheduleRunEnded, approvalWaiting, agentFinished }`，缺省全开；不合 schema 时取缺省），按值脱敏后经控制通道发 `notify` 给 main；被设置关闭时只记日志 `notification not sent: disabled in settings`。本页的发出方：

- `schedule-run-ended`：`trigger: schedule` 的 Run 结束；title 为任务标题，body 为 `Scheduled task run <finished | paused | aborted | error>`。
- `approval-waiting`：`trigger: schedule` 的 Run 提交 `approval_request`；body 为 `A scheduled task is waiting for approval`。

main 在主窗口聚焦且可见时不显示；否则显示 Electron `Notification`，点击时聚焦窗口并经 preload 的 `onOpenSession` 打开该会话，显示期间保留引用直到点击或关闭。测试构建不显示，只记日志 `notification shown`。

## 界面

- **标题栏按钮。** 会话有定时任务时标题栏显示"定时任务"按钮（与后台任务按钮相同的规则，390 px 下标题栏不溢出），徽标为 active 任务数（没有时不显示）；点击打开右栏的 Schedules tab。新建的入口是右栏的 Schedules tab（始终可见）。
- **Schedules tab。** 会话的任务按创建顺序列出：状态点与状态名、标题、规则的本地化描述（after、at、every、cron）、下次时间与时区（cron 用规则的时区，其余用本机时区；暂停与已结束为"没有下次执行"）、最近结果（已开始，或已跳过与原因）。每行有暂停 / 恢复（已结束的任务没有，经编辑改规则后重新启用）、编辑与删除（确认框）。选中项（缺省为最后一个）下方为投递历史：该任务的 `schedule_fire` 条目，新的在前，含跳过原因与合并的错过次数。列表在打开会话与 `schedule_fire` 条目数变化时重读，其间由 `schedule_update` 进度更新；删除不推送，由本窗口从列表去掉（已不存在的 404 视为已删除）。
- **新建与编辑。** 对话框：标题、指令、类型（一次：本机时区的日期时间，保存为 UTC 的 RFC 3339；间隔：整数分钟；cron：表达式与时区下拉，缺省本机时区，选项为本机时区、UTC 与运行时支持的 IANA 名）。cron 与间隔实时显示接下来 3 次。校验与预览用 `@coko/agent/entries` 的 `upcomingOccurrences`（与 Sidecar 的 `validateRule` 同一实现）：间隔小于 1 分钟、非整数分钟、一次性时刻在过去、cron 或时区非法时行内报错且不发请求；cron 与时区在输入时校验，其余在提交时。编辑只发送用户改过的字段（与对话框打开时的值比较），没改规则时不发 `rule`（不重新对齐）；revision 冲突时对话框内提示、保留输入并读回，再次保存以新的 revision 发送。超过每会话 20 个 active 时显示上限。
- **行操作的冲突。** 暂停与恢复按已知 revision 发送；409 `revision-conflict` 时提示并读回该会话（与全部会话）的列表，不重试。
- **时间线。** `schedule_fire` 为紧凑行：开始执行或已跳过（原因）、任务标题、计划时刻与合并的错过次数。标题取会话的任务列表，找不到时取该 Run 输入中 `<scheduled_task>` 的 `title`，都没有时为"已删除的定时任务"。定时任务触发的 Run 以这一行开头：它的输入（该 Run 第一条 user message 的 `<scheduled_task>` 包装）不显示为用户气泡，之后的回复与工具照常显示。只认 `trigger: schedule` 的 Run 的第一条输入，用户输入的同样文本照常显示。
- **设置 → 定时任务**（环境分类）。全部会话的任务按会话分组（组标题为会话标题），每项可"打开会话"（返回应用、切到该会话并打开右栏的 Schedules tab）、暂停 / 恢复与删除；新建与编辑在会话的 tab 中。
- **设置 → 通知**（个人分类）。总开关与三类开关（定时任务结束、等待审批、后台子代理结束），读写设置键 `notifications`（按已知 revision，冲突时读回并提示）；总开关关闭时三类开关不可改。已存值不合 schema 时按缺省（全开）显示，与 Sidecar 一致。

## 测试时钟

测试构建且未 `--packaged` 时，`COKO_TEST_CLOCK=1` 使 `ClockPort` 为可控时钟并挂载 `POST /api/test/clock { advanceMs } | { setMs }`（到期的计时器按到期顺序触发）；`COKO_TEST_CLOCK_START=<UTC 毫秒>` 给出起点（重启测试的启动扫描）。`COKO_TEST_HOLD_SCHEDULE_FIRE=1` 使投递在 `recordFire` 之后、开始 Run 之前挂起（强杀测试）。打包的发布构建忽略这些变量。

## 限制

- 只在应用运行时投递；应用关闭期间到期的任务在下次启动时只补最近一次。
- 睡眠唤醒由 30 秒复查覆盖，未在真实睡眠中验证。
- 挂起只在内存中，不跨重启。
- 系统通知的标题与正文由 Sidecar 生成，为英文（任务标题原样）；应用内界面已本地化。

## 验证

- `packages/agent/src/tasks/schedules/schedules.test.ts`：cron 每段语法与拒绝项、日 / 周的任一匹配、`Asia/Shanghai` 与 `America/New_York` 的下次时间（夏令时跳过与重复取较早）、时区校验、every 的对齐、at 必须在将来、补跑只取最近一次并计 missed（含封顶）、工具参数与授权（伪造的 `<scheduled_task>` 不改变判定）。
- `tests/integration/sidecar-schedules.test.ts`：四种规则到期的 `trigger: schedule` Run 与 requestLog 中的 `<scheduled_task>`、一次性任务 inactive、`lastFire` 与进度；暂停与恢复；挂起与只投递一次；准入跳过原因（session-archived、disabled、workspace-missing、budget、model-not-configured），包括归档后从外部恢复启用的任务仍只记录跳过、不请求模型；对手用例（定时 Run 中 `schedule_create` 与 `create_goal` 为错误结果、`/goal resume` 不恢复 Goal、伪造的标签不改变 trigger、read-only 与 plan 询问、full-access 放行、`Schedule` 拒绝规则）；HTTP；`notify` 与设置关闭。
- `tests/integration/sidecar-schedules-restart.test.ts`：停机跨越 5 个发生次后只投递 1 次且 `missed: 4`；`recordFire` 之后 SIGKILL，重启后不重投。
- `tests/integration/secrets-gate-schedules.test.ts`、`secrets-gate-notifications.test.ts`：title 与 prompt 中登记的 Secret 不出现在表行、条目、HTTP、WebSocket、requestLog、`notify` 控制消息与日志中。
- `apps/desktop/src/main/notifications.test.ts`：前台不显示、不在前台显示、点击打开会话、测试构建只记 `notification shown`。
- `packages/agent/src/entries/entries.test.ts`：`upcomingOccurrences` 的四种规则、`Asia/Shanghai` 与 `America/New_York`（夏令时结束日取较早的一次）、非法输入抛 `ScheduleRuleError`；导入守卫逐一核对 entries/ 之外登记的纯模块。
- `apps/desktop/src/renderer/stores/schedules-store.test.ts`：列表的过期响应丢弃、`schedule_update` 合并（较旧 revision 不覆盖）、冲突读回、删除的 404。
- `apps/desktop/src/renderer/features/right-panel/schedules-tab.browser.test.tsx`、`features/settings/schedules-notifications.browser.test.tsx`：规则描述、下次时间与时区、状态与最近结果（中英文）；表单的行内校验、cron 的接下来 3 次与时区下拉；暂停 / 恢复 / 删除与冲突读回；编辑只发改动字段；投递历史与投递行；明暗主题对比度、390 px 与键盘；设置的全部会话列表、跳转与通知开关。
- `apps/desktop/e2e/schedules.e2e.test.ts`：真实 Electron 与测试时钟上新建 cron 任务、下次时间、到期后的 Run、投递行与历史、暂停后不投递；设置跳转；关闭"定时任务结束"时没有 `notification shown`，开启时有。

## 延伸阅读

- [ADR 0015](../adr/0015-schedules-at-most-once-latest-catch-up.md)：至多一次与只补最近一次的决定。
- [Goal](goal.md)：Run 授权与预算。
- [权限判定与审批](permissions.md)：automation 权限类。
- [上下文管理](context.md#定时任务的-scheduled_task-输入)：`<scheduled_task>` 在模型上下文中的位置。
