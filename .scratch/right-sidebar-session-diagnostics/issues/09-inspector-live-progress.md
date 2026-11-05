# 09: 诊断页的实时增量子行

**What to build:**

- **显示位置。** 诊断页打开期间收到的、属于 Run 的进度，显示为该 Run 组末尾“实时进度”行下的子行，按到达顺序排列。
- **分组。** `assistant_delta` 按内容块分组；`tool_start`、`tool_update`、`tool_end` 按 toolCallId 分组。生成中的组展开。收起的思考块显示拼接后的思考文本，收起的工具参数块显示拼接后的参数片段，长度都沿用摘要的上限。
- **提交之后。** 对应的条目提交后，已经匹配的增量转到该条目下并收起；没有匹配上的增量留在“实时进度”行下。
- **时间列。** 增量子行没有时间戳，时间列留空。
- **保留与清空。** 在同一 Session 内切换 tab 时保留；切换 Session、关闭诊断页或重新加载后清空。
- **不显示的进度。** 诊断页打开之前收到的增量、历史 Run 的增量，以及不属于 Run 的进度，都不显示。
- **数据来源。** 复用 chat-store 现有的 progress 订阅，chat-store 不需要改动。

**规格场景:** [spec](../spec.md) 的 AC-20；对应 INS-13，以及 INS-03 中“实时增量行的时间列留空”。

**设计依据:** [design](../design.md) “关键路径与接口”中的“诊断页的实时增量”：订阅与过滤、分组与转交规则、模型的生命周期。“来源与约束”中“progress 先于对应条目到达”的假设，由本票核对。

**文档影响:** 会话数据诊断当前行为说明中的实时增量。

**Blocked by:** 07 — 诊断页的原始数据

**Status:** ready-for-agent

**Closed:** true

- [x] 核对“同一 WebSocket 上 progress 先于对应条目到达”这个假设，结论和依据记入 Comments。不成立时，按实际的到达顺序调整转交规则，并同步更新 design。
- [ ] 运行一个 faux Run，依次输出思考、正文并调用工具：生成过程中按 INS-13 分组显示子行；条目提交后，增量转到对应条目下并收起；没有匹配上的增量留在“实时进度”行下。（AC-20）
- [x] 切换到另一个 Session 再切回来，子行已经清空；在同一 Session 内切换 tab 再切回来，子行仍在；不属于 Run 的进度不出现。
- [ ] 分组与转交规则有纯函数单测。真实 App 的 Browser Mode 用 fixture 回放进度。真实 Electron E2E 用真实 Sidecar 运行 faux Run 来验证。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

### 2026-11-05 实施与顺序证据

- 独立 worktree `/tmp/coko-right-sidebar-agents/ticket-09`、分支 `codex/right-sidebar-09`，从集成 `f3a8db9d` 开始，最终快进合并集成 `1496184b`。本票没有使用、复用或派生其他代理；没有修改 chat-store、协议或服务端，也没有新增取数请求。
- 原“同一 WS 上 progress 总先于对应条目”假设不成立：`packages/agent/src/engine/runtime.ts` 的 run_start 先发进度再 await commit；助手 delta 在 message_end 提交前，工具事件在 toolResult message_end 提交前；但 run_end 是 await commit 之后才发进度。`compaction-driver.ts` 也是先 await commit(compaction)，随后发 compaction_end。已安装 `@earendil-works/pi-agent-core@1.4.0/dist/agent.js` 的 emit 会逐个 `await listener(event, signal)`，agent-loop 的 message_end / tool 执行路径也 await emit；因此助手下一条消息窗口可以按提交边界分开。SessionRuntimes.publisher 先 await appendEntries 再 hub.publishEntry，WS connection 在 backlog 期间缓冲实时消息，不提供进度优先保证。设计已按双向到达更新，纯模型覆盖结束帧晚到。
- `progress-model.ts` 在诊断生命周期内保存原始帧；助手按 Run + 内容块归组，工具按 Run + toolCallId 归组。每次新 Entry 提交时转交待匹配进度，迟到的 Run/工具/压缩结束帧查已提交对应条目；重试、上下文用量和未匹配帧留在实时进度中。转交后收起，Run 组头自身保持展开，run_start 帧独立成收起的 `progress/run_start` 子组。
- UTF-16 offset 控制拼接位置；重复与一致重叠不复制，缺前缀／间隙／冲突不拼出假预览；原始帧不删。收起的思考与工具参数摘要最多 240 字符；所有实时行不填时间戳。
- `DiagnosticProgressProvider` 放在 App、右栏视口之外，同步订阅真实 chat 和布局 store；采集条件只看当前 Session 且诊断 tab 存在。同一 Session 内换 tab、切换展示形式或收起右栏都保留；切 Session、关 tab、关开发者开关或重载清空。只收新 progress 回调，不从 chat 的 live 正文补造打开前或历史 Run 的帧。

### TDD、验证与明确边界

- 第一条公开模型 tracer 先因缺少 progress-model 模块失败，完成实现后通过。另一个独立 red→green 发现 run_start 转交会把整个 Run 收起（实际 closed，对预期 open），改为独立收起的起始进度子组后通过。真实 App Browser Mode fixture 回放使用真实 store／投影／表格，没有替换产品内部协作者。
- `rtk pnpm install --frozen-lockfile` 退出 0，依赖独立安装，未把其他 worktree 的 node_modules 软链接过来。
- `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics/progress-model.test.ts apps/desktop/src/renderer/features/session-diagnostics/raw-model.test.ts apps/desktop/src/renderer/features/session-diagnostics/raw-data.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/live-progress.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/developer.browser.test.tsx packages/i18n/src/domains.test.ts`：实际选中 5 文件、17 项，全通过，0 跳过，退出 0。命令中 developer 路径不存在，未将它算作验证；随后用正确路径 `rtk pnpm run test apps/desktop/src/renderer/features/settings/developer.browser.test.tsx` 实际执行 1 文件、11 项，全通过，0 跳过，退出 0。合计 6 文件、28 项。
- 6 项纯模型覆盖交错块、重复与重叠／UTF-16 偏移、缺前缀、assistant 提交边界、Run 隔离、工具及 Run 迟到结束帧、连续压缩、历史／脱离 Run 进度过滤与 run_start 不误收起 Run。真实 App 回放覆盖分组、思考／参数折叠预览、提交后收起、空 UTC 列、打开前帧不回放、脱离 Run 排除、隐藏 tab 和收起右栏继续采集、切 Session／关 tab 清空与无新订阅。
- `rtk pnpm run typecheck` 退出 0。定向 `rtk pnpm run lint --` 检查本票 8 个 TS/TSX 文件最终退出 0（首次发现未使用类型导入，移除后复核）；同范围 `rtk pnpm run format --` 退出 0。`rtk git diff --check` 通过。
- `rtk pnpm run check:docs`：344 Markdown、0 问题，退出 0；最终更新票据后再次核对。
- 新增 `apps/desktop/e2e/diagnostic-progress.e2e.test.ts`：真实 Electron + Sidecar + Pi 流，先创建并选中 Session、打开诊断，再提交 Run，faux delayMs 与测试时钟在模型边界建立屏障，真实 bash 用文件屏障保持工具输出可观察；检查生成中的思考／工具帧、转交、迟到 run_end、重载清空。按本次集成安排，实际 Electron／打包及 agent-browser 执行集中给 12；本票没有运行这些入口，两个含实际 faux/Electron 执行的验收框保持未勾选，关闭本票表示实现与已分配局部验证完成，不冒充 AC-20 桌面验收通过。未验证真实模型、原生鼠标／标题栏或签名发布。
- 没有依赖旧进度缓存的现存测试需要迁移；已扩大到 07 原始数据与 06 开发者场景，均通过。筛选、对话分组、引用定位仍由 08／10／11 负责。

### 文档影响与读回

| 变化 | 正文 | 动作 |
| --- | --- | --- |
| Run 实时行、匹配、offset 与内存生命周期 | `docs/subsystems/session-diagnostics.md` | 新增当前契约、实现和测试入口 |
| 诊断正文新增内容 | `docs/README.md` | 同步入口摘要 |
| 进度／条目真实顺序和转交 | `design.md` | 替换错误假设，记录双向匹配、订阅归属与 Run 组头例外 |

搜索 `progress 先于`、`先发出 Run`、`实时增量`、`实时进度` 覆盖 docs、.agents 与本任务目录：规格保持已确认产品语义；已关闭 07 的未实现后续票说明保留当时历史；本票与 design 更新实际结论。正式正文没有反向引用具体任务材料。按 AGENTS → docs/README → 当前诊断正文读回：职责、状态／适用范围、入口、引用方向、行为一致与历史保留均通过；没有新目录、归档或替代链。实际交付为本地已提交，未推送。
