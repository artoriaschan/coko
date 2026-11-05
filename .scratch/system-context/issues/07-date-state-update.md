# 07: 日期改为 State Update

**What to build:** 模型在 Session 的第一个 Run 收到今天的日期与星期，跨过午夜后的下一个 Run 收到新日期；同一天不再重复。日期按 Sidecar 的时钟与环境中的时区计算，子 Session 同样收到。见 [规格](../spec.md) 的“State Update 的内容”与“何时送达”。

**User stories:** 12、29（日期部分）

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Sidecar 集成测试（测试时钟）：首个 Run 送达 date；同一天的后续 Run 不送；跨过午夜后的下一个 Run 送达新日期
- [x] Run 进行中跨过午夜不在中途送达
- [x] 与 todo_list 同时送达时 date 在前
- [x] 子代理与 teammate 的子 Session 的第一个 Run 收到 date
- [x] 文档：上下文管理；`check:docs` 通过


Closed: true

## Comments

2026-11-05：已实现并验证。本票接缝沿用规格已批准的真实 Sidecar HTTP/WS + faux requestLog，时钟经现有测试 ClockPort 控制；不使用模型回复关键词代替状态证据。

- `date` 贡献生成 `{ date: "YYYY-MM-DD", weekday: "Thursday" }`；Sidecar 装配把与定时任务相同的 ClockPort 传入上下文贡献。日期按环境 section 同一 IANA 时区计算，草稿不贡献日期。
- TDD 首个日期集成用例先因首 Run 没有 date 条目失败，接线后通过。新增三个 Sidecar 场景验证 Asia/Shanghai 本地午夜、英文星期、同日去重、date 在 todo_list 前、system 稳定；审批屏障保证 Run 进行中跨午夜后工具结果请求仍用旧日期，下一 Run 才更新；一次性子代理与 teammate 首个 Run 均收到自己的日期且没有根 Goal。
- 日期使此前未覆盖的消费者缺陷可见：Checkpoint 文本和回退/分叉返回的输入原先拼接了宿主块。通过 `pairedStateUpdates` 去掉有来源的块，纯状态消息不作为 Checkpoint；用户伪造的同名文本原样保留。`planRewind` 公开接缝先红后绿，并在真实 Sidecar 压缩场景断言列表只返回原文，不包含纯状态补发。
- 直接受影响的精确条目/消息期待已逐项更新，保留完整数组和原有行为断言。协议测试使用独立固定测试日期夹具，避免依赖机器当天日期。没有通过过滤 State Update 或放宽断言消除差异。分叉尚未复制 `state_update` 的配对由后续 08 完成，本票分叉期待准确记录当前首 Run 会重发日期；08 合入后需按配对复制结果同步。

验证（均退出 0，除下述已说明的红灯/基线）：

| 命令 / 范围 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 依赖安装通过，lockfile 未改 |
| `pnpm run test tests/integration/sidecar-date-state-updates.test.ts tests/integration/sidecar-todo.test.ts tests/integration/secrets-gate-todo.test.ts tests/integration/sidecar-compaction.test.ts` | 4 文件 15 例通过 |
| 扩展协议回归：session、run-control、rewind、commands、references、instructions、memory、schedules、subagents、teams、concurrency、recovery、m4-seams、m5-seams、m6-seams | 15 文件 99 例；分组修复后每例均有通过证据。初轮 32 失败，其中父代理在无 date 的集成基线 `22796edf` 复现 17 失败；既有 model_request 顺序期待、commands 夹具 /var 实路径、06 环境 section 与 04 Goal 快照期待在直接改动文件中最小同步，没有改变对应生产语义 |
| `pnpm run test tests/integration/sidecar-commands.test.ts tests/integration/sidecar-m5-seams.test.ts tests/integration/sidecar-m6-seams.test.ts tests/integration/sidecar-compaction.test.ts packages/agent/src/checkpoints/rewind.test.ts` | 最后修复组 5 文件 52 例通过，包含回退公开接缝 19 例 |
| 合入集成 `56884834` 后：`pnpm run test tests/integration/sidecar-date-state-updates.test.ts tests/integration/sidecar-state-update-continue.test.ts tests/integration/sidecar-base-prompt.test.ts tests/integration/sidecar-goal.test.ts tests/integration/sidecar-compaction.test.ts packages/agent/src/checkpoints/rewind.test.ts` | 6 文件 48 例通过；保留纯状态 continue 不唤醒 Goal，以及旧默认基础提示与候选版本选择 |
| `pnpm run typecheck` | 合并后通过 |
| 受影响 TypeScript 的 `pnpm exec oxfmt` / `pnpm exec oxlint` | 通过 |
| `pnpm run check:docs` / `git diff --check` | 通过；文档检查数量见最终输出 |

文档影响与读回：更新 `docs/subsystems/context.md` 的日期值、送达顺序、时区/时钟、子 Session、Checkpoint 来源处理及结构入口；同步 `docs/README.md` 摘要。搜索了正式正文、任务与 skills 中“当天日期 / 当前日期 / date State Update / Todo List、Goal 进度与”消费者：规格与 ADR 保留目标和已批准状态，已有完成票保留历史证据，08 的分叉配对留在其职责。AGENTS → 文档导航 → 上下文正文读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入和历史保留均通过，无新增反向依赖。

未验证：真实 Provider / 提示缓存、Electron 窗口交互、打包产物与 CI。本票只证明真实 Sidecar、可控模型和测试时钟下的链路；用户已确认缺少真实凭据时按规格记录未验证继续。


2026-11-05 集成补验：新增首轮日期也影响 `sidecar-skills.test.ts` 的 Skill 命令路径。父代理在原始 `ec32dfc9` 与日期集成 `7b667126` 各观察 6 例中的 4 个失败；独立修补工作区再次复现。三个断言依赖 `/var` 临时路径的字面值，但应用保存的是 `realpath` 后的 Workspace 路径；夹具改为通过 `fs.realpath` 读取临时根的真实路径。命令场景使用已有固定日期夹具，并完整断言两轮的条目顺序、首轮 date payload、日期块先于 Skill 展开正文、次轮同日不重发和实际模型请求。保留索引、权限与文件内容断言，没有过滤 State Update 或改动生产代码。

补验：`pnpm install --frozen-lockfile`、`pnpm run test tests/integration/sidecar-skills.test.ts`（1 文件 6 例通过）、`pnpm run typecheck`、该文件 `oxfmt --check` / `oxlint` 均退出 0。后续合并复核结果见下。

已无冲突合入包含票 08 的集成 `148c99bc`；合并后重跑上述 Skills 文件 6 例、类型检查、文档检查（360 个 Markdown、0 问题）均退出 0。补验未运行真实 Provider、Electron 窗口或打包产物；未推送。

2026-11-05 全分支评审修复：Standards 与 Spec 两个新的只读代理在 `ec32dfc9...43de0ccf` 独立确认同一处 P2。日期或 Goal 状态块前置后，时间线隐藏了这些块，但定时输入仍按原始 `index === 0` 识别，导致 `<scheduled_task>` 包装进入用户气泡，投递行未提取标题和原始指令。新增公开 `buildTimeline` 场景先因多出的气泡失败；改为按首个非配对 State Update 块识别定时输入后通过，并强化普通 submit 带宿主日期前缀时用户伪造同名标签仍可见的对手用例。来源仍由定时 Run 与首条输入判定，不靠标签自行授权。

修复后 `pnpm run test apps/desktop/src/renderer/features/conversation/timeline.test.ts` 实际选中 1 文件 17 例，全部通过。类型、文档与格式检查结果见最终补记；最终集成复核由父代理执行。本次没有运行真实模型、浏览器/Electron 窗口或打包产物，不改变默认 v1 与 ADR partial。

最终补记：`pnpm run typecheck`、两个受影响 TypeScript 文件的 `pnpm exec oxfmt --check` / `pnpm exec oxlint`、`pnpm run check:docs`（361 文件、0 问题）、`git diff --check` 均退出 0。从 AGENTS → 文档导航 → 定时任务时间线正文读回，现有隐藏输入契约与修复一致；本次只更新任务证据，无新增正式文档或反向引用。
