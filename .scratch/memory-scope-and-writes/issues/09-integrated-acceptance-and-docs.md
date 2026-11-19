# 09: 联合验收与文档收尾

**What to build:** 把各票的用户可见行为放在同一份最终代码上验收：项目对话与独立对话各自看到正确的记忆，移动与删除项目后归属随之变化，记忆在任何模式下不经审批地写入并留下工具卡，用户手写的条目不被改动，子 Session 与 Headless Run 只读，预算分两级。核对各票的文档改动彼此一致，把 ADR 与规格的实施状态更新到实际情况，并如实记录真实模型与原生层中没有验证的部分。

**规格场景:** [spec](../spec.md) 的 AC-01 至 AC-29 联合复核，不替代前置票各自必需的测试；用户故事 1 至 30。

**文档影响:** [Memory](../../../docs/subsystems/memory.md)、[权限判定与审批](../../../docs/subsystems/permissions.md)、[Plan Mode](../../../docs/subsystems/plan-mode.md)、[项目与会话列表](../../../docs/subsystems/projects.md)、[无界面运行](../../../docs/subsystems/headless.md)、[子代理](../../../docs/subsystems/subagents.md)、[上下文管理](../../../docs/subsystems/context.md)、[追踪、审计、导出与评测](../../../docs/subsystems/tracing.md) 的最终一致性；[文档导航](../../../docs/README.md) 中 Memory 一行的摘要；01 新增的 ADR 与 [ADR 索引](../../../docs/adr/README.md) 的 implementation；本规格的状态。

**Blocked by:** 01 新增 ADR 与术语更新；02 工具层限制：保护用户手写条目，无界面运行只读；03 Memory 段：声明、来源标注与写入引导；04 记忆操作不经审批；05 项目归属：Run 的项目记忆与工具作用域；06 接口校验与设置分区按项目分组；07 注入预算分两级；08 评测用例：长期偏好被记住

**Status:** ready-for-agent

- [ ] 逐项确认每张前置票确实交付了所需的行为和契约；票已关闭或局部测试通过，不能当作整份规格已完成。
- [ ] 跨票联合场景：项目对话中模型不经审批记下一条项目级记忆 → 同项目的另一个对话下一个 Run 可见 → 把一个独立对话移入该项目后可见 → 用户在设置中修改该条目后模型不能再替换它 → 删除项目后原对话只剩用户级 → 用同一文件夹重建项目后项目记忆恢复。
- [ ] AC-01 至 AC-29 逐条给出对应的测试或实际操作证据；按[证据模板](../../../docs/templates/evidence.md)记录对象版本、精确命令、结果与限制。
- [ ] 桌面部分按 [UI 调试约定](../../../AGENTS.md)静默验证设置分区在项目对话与独立对话下的分组、明暗主题，以及无审批写入的工具卡；说明哪些交互在静默 CDP 中验证、哪些因需要真实指针或原生层而未验证。
- [ ] 真实模型：有凭据时运行 08 的真实模式并单独报告；没有凭据、未运行或未通过的报告为未验证。
- [ ] 当前行为文档中“Workspace 记忆只在其 Workspace 生效”“memory-write 在 default 与 read-only 询问”“自动提取尚未实现”以外的旧说法已改为实现后的行为；各票的文档改动彼此一致；[文档导航](../../../docs/README.md) 的摘要同步。
- [ ] 01 新增 ADR 的 implementation 按实际验证结果更新，未满足的条件写明；ADR 索引同步。规格的 status 与“来源、确认与实施状态”更新为实际交付状态。
- [ ] `pnpm run check:docs` 通过，并从 AGENTS.md、docs/README 到正文依次读回，核验链接与语义；正式文档不链接任务材料。
- [ ] 记录本地验证结果与未覆盖风险，区分已提交、已推送与未发布状态。

## Comments

- 2026-11-19：用户确认 9 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19：联合验收完成，证据见[联合证据](../evidence/acceptance.md)。
  - 前置票核对：01—08 均有交付与检查记录，行为在同一份代码上由下列批次复核。
  - 联合场景：`tests/integration/sidecar-memory-projects.test.ts` 新增一例（default 下不经审批写入项目记忆 → 同项目与移入的独立对话可见 → 用户编辑后模型替换为工具错误 → 删除项目只剩用户级 → 重建项目恢复）；首次即通过，临时去掉 `decide.ts` 中 memory-write 的模式放行后在审批处失败，已恢复。第一例中“记忆写入若仍需审批”的过时注释改为只允许 barrier 的文件写入审批。
  - 实际执行的检查：集成 14 文件 59 例、单元 10 文件 238 例、Memory 分区 Browser Mode 2 文件 8 例、`memory.e2e.test.ts` 2 例（首次打包阶段 `fetch failed`，重跑通过）、`pnpm run eval`（31 通过、10 跳过）、`pnpm run typecheck`、`pnpm run check:docs`、改动文件的 oxfmt / oxlint，全部通过。静默 CDP（`COKO_E2E_BACKGROUND=1`，独立数据目录，agent-browser 连接 9339）：项目对话 default 模式无审批卡、“Remembered”工具卡与详情正文；项目对话 Memory 分区两组、独立对话只有用户级，亮暗主题；结束时关闭会话与应用。
  - 基线对比：在 `9fe61757` 的独立 worktree 上运行 server + agent 全量、11 个集成文件与 6 个设置 Browser Mode 文件，失败集合（6 / 10 / 24 例）与集成分支逐条相同，都是既有失败，没有回归；`sidecar-delete-project` 两边都通过。基线 worktree 已移除。
  - 文档：ADR 0027 implementation → implemented（链接实现与测试，写明真实模型与原生层未验证），ADR 索引同步；规格 status → delivered 并更新实施状态；Memory 正文的 description 与验证段、文档导航的 Memory 摘要、projects 测试清单的措辞；其余 subsystems 页核对一致未改。
  - 未验证：AC-29 真实模式（无凭据，`skipped: no-credentials`）；真实指针与原生层；全量 `pnpm run test` 未运行。本地提交，未推送、未发布。
- 2026-11-19：代码审查修复（`git diff 9fe61757...HEAD` 的审查发现）。
  - ADR 0005、0020 中对 ADR 0027 的“尚未实施 / 实施前仍按本页”改为已实施，记忆的当前行为以 ADR 0027 为准。
  - 没有项目时 Memory 段的写入引导去掉“learn a fact about the project…”一句，与 `memory_write` 的无项目描述一致（`memory.test.ts` 改为断言无项目时整段不含 project，先确认失败）；Memory 正文的写入引导描述同步。
  - 草稿上下文按所选项目解析：桌面只为选了项目的草稿发 `workspaceId`（所选项目的主要 Workspace），主要文件夹在项目间唯一，反查即所选项目；独立草稿首次发送前没有 Workspace、不发请求，因此未改行为，在 `ContextService.scopeFor` 注明。
  - 设置分区“没有会话且未选项目”的提示在 `9fe61757` 上已存在（`memory.noWorkspace`，同一条件），属沿用而非新增，保留；文案改为项目措辞不变。
  - 重构：`useActiveProject` 供设置分区与 `useActiveWorkspaceId` 共用；`projectScope(project)` 供 `SessionRuns.scope` 与草稿 `scopeFor` 共用（附加文件夹与项目记忆 Workspace）；`createMemoryTools` 的 `project` 改为必填，去掉参数的 `as typeof` 断言；`MemoryRepository.update` 的 `source` 用 `Memory['source']`（`@coko/session` 没有 MemorySource，库内 source 一律为宿主约定的字符串）；`MemoryService` 的三态可见范围命名为 `MemoryReach` 并注释。
  - 检查：`pnpm typecheck`、`pnpm run check:docs`、改动文件 oxlint / oxfmt 通过；agent memory、decide 与 `apps/server/src/application/context` 单测 8 个文件 152 例通过；集成 sidecar-memory、sidecar-memory-projects、sidecar-memory-search、sidecar-context*、headless、sidecar-subagents-permissions 8 个文件 34 例通过；`memory-section.browser.test.tsx` 6 例通过；`pnpm run eval`（faux）31 例通过、10 例跳过。未运行全量测试与桌面 E2E。

Closed: true
