# 03: 独立会话目录与 work/outputs

**What to build:** 用户首次向没有项目的独立会话发送消息时，Coko 在 `<Documents>/Coko/<yyyy-MM-dd>/chat-<前 12 位>/` 下创建 `work/` 与 `outputs/`，把会话根登记为 Workspace，并把 Agent 的 cwd 设为 `work/`。独立会话的系统上下文说明中间产物写 `work/`、交付文件写 `outputs/`、不要在会话根其他位置创建文件。首次发送失败时回滚目录、Workspace 与会话记录。

**Blocked by:** 01 主数据根切换到 ~/.coko；02 Session 目录字段与目录名派生

**Status:** ready-for-agent

- [x] 首次发送后磁盘上存在 `<Documents>/Coko/<本地日期>/chat-<短 id>/work` 与 `outputs`，日期目录按首次成功发送的日期固定。
- [x] 该独立会话的 Workspace 根是会话根，Session DTO 的 `directory` 是会话根，cwd 是 `work/`。
- [x] 同一草稿重发复用同一目录，不产生第二个目录；首次发送失败后不留下会话记录、Workspace 或目录。
- [x] 独立会话的系统上下文只包含 `work/`、`outputs/` 的说明；项目会话不出现这段说明。
- [x] 独立会话的 Workspace 名称固定为“独立对话 · yyyy-MM-dd”，不随会话标题变化，也不出现在项目列表。
- [x] 集成测试用临时 `COKO_CHATS_ROOT` 验证目录结构、DTO、cwd 与失败回滚；桌面 e2e 验证新会话的目录路径与系统上下文。


**Closed:** true

## Comments

2026-11-05：完成目录按本地日期分层、确定性短名与冲突回退、work/outputs 创建、Workspace 根与固定名称、Session directory/cwd、独立系统指令、首次发送幂等与失败回滚。相同绑定的分叉、当前目录交接和非隔离子代理继承实际根与 cwd；隔离 worktree 保持既有解析。会话根在每个 Run 中仍作为权限根；细化 work/outputs 写根由 04 号票承担。

采用规格已批准的真实 Sidecar HTTP、磁盘事实和桌面 E2E 接缝执行 TDD：首次目录测试先因旧目录只有日期前缀失败；指令测试先因缺少 standalone-directory section 失败；继续绑定测试先观察到子 Session 的 cwd 回退会话根且 directory=null，修复后转绿。占用短名与完整名不会被认领或覆盖；标题更改和重启重试保留实际目录。

验证（本票工作树）：

- `rtk pnpm run test tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-first-send-worktree.test.ts tests/integration/sidecar-environment.test.ts tests/integration/sidecar-handoff.test.ts tests/integration/sidecar-subagents.test.ts tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-project-permissions.test.ts -t '^(?!更换模型).*'`：退出 0，7 文件、50 通过、1 项按名称过滤。
- `rtk pnpm run test apps/desktop/e2e/first-send.e2e.test.ts`：退出 0，1 文件、2 通过；globalSetup 构建本次 Electron 产物，后台模式验证草稿恢复、实际 date/chat/work/outputs 路径、系统上下文与 Hook 拒绝后重试。
- `rtk pnpm run typecheck`：退出 0。
- `rtk pnpm exec oxfmt apps/desktop/e2e/first-send.e2e.test.ts apps/server/src/application/checkpoints.ts apps/server/src/application/context/environment.ts apps/server/src/application/context/types.ts apps/server/src/application/first-send.ts apps/server/src/application/handoff.ts apps/server/src/application/session-runs.ts apps/server/src/application/subagents.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-project-permissions.test.ts` 与 `rtk pnpm exec oxlint apps/desktop/e2e/first-send.e2e.test.ts apps/server/src/application/checkpoints.ts apps/server/src/application/context/environment.ts apps/server/src/application/context/types.ts apps/server/src/application/first-send.ts apps/server/src/application/handoff.ts apps/server/src/application/session-runs.ts apps/server/src/application/subagents.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-project-permissions.test.ts`：退出 0；精确文件清单由本提交 diff 给出。
- `rtk pnpm run check:docs`：退出 0，377 个 Markdown、0 问题。

扩大回归首次选择上述 7 文件前的 6 文件组合时，项目权限用例仍在会话根寻找 cwd.txt；已改为 Session.cwd 下查找，符合新的 work/ 契约。另一个环境用量用例 `更换模型后下一次请求的环境只改变 Model；草稿按缺省模型计算` 在未修改的集成基线 `9c14717e` 上通过精确命令 `rtk pnpm run test tests/integration/sidecar-environment.test.ts -t '更换模型'` 复现同样的失败（第 145 行，expected 110 / actual 134，退出 1）；当前系统用量包含已有 paired State Update 字符而旧预期只计算基础提示与环境。本票不改该基线问题，留给联合验收处理；上面的最终回归明确过滤该 1 项，不将其描述为全文件无条件通过。

文档影响：原地同步 ADR 0016 与 projects、workbench、context、worktrees 的当前目录/cwd/指令说明。搜索“日期加随机 / 日期加短随机 / 日期前缀”后仅规格问题背景保留历史描述。从 AGENTS → docs/README → 正文读回：引用、归属、批准/实施状态、历史保留与入口语义通过；不新增导航类别，不产生正式文档到任务材料的依赖。

未验证：真实模型、Windows 实机、原生文件选择和需要真实指针/前台的操作；本票桌面证据来自静默 Electron/CDP。未推送、未发布。
