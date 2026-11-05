# 12: 集成验收

**What to build:** 对整个功能做集成验收，包括：

- 在集成后的代码上，运行本功能涉及的真实 Electron E2E：迁移后的 6 个右栏 E2E，以及保存与恢复、Mod+W、开发者开关和实时增量的 E2E。
- 运行真实 App 的 Browser Mode 测试。
- 用 agent-browser 静默检查：tab 条的实际几何，全屏时与红绿灯和拖拽区的关系，真实悬停，以及明暗主题。
- 在 390 CSS px 及以上宽度和 zh/en 下，检查右栏、引导页与诊断页。
- 确认安装包中有第三方声明。
- 逐项核对 spec 的 AC-01—AC-30，更新 spec 的实施状态与证据。

**规格场景:** [spec](../spec.md) 的 AC-29；复查 AC-01—AC-30。

**设计依据:** spec 的 Testing Decisions；[design](../design.md) 的“验证与实施顺序”。

**文档影响:** spec 的实施状态与证据；本功能影响的当前行为说明，从入口读回核对。

**Blocked by:** 01—11（全部前置票）

**Status:** ready-for-agent

**Closed:** true

- [x] 本功能相关的 E2E 与 Browser Mode 测试在集成后的代码上通过。精确的命令、范围和结果记入 Comments，E2E 与 agent-browser 的结果分开报告。
- [x] agent-browser 静默检查覆盖：tab 条几何、全屏时与红绿灯和拖拽区的关系、悬停、明暗主题。需要真实指针或原生层而没能验证的项，写明原因。
- [x] 390 CSS px 及以上宽度、zh/en 下，没有意外的裁剪、重叠或整页横向滚动，键盘路径完整；tab 条、分隔条与表格有正确的语义和可访问名称。（AC-29）
- [x] 打包产物中有第三方声明，内容包含版权行和完整的许可文本。（AC-30）
- [x] AC-01—AC-30 逐项核对，结论记入 spec，并相应更新 spec 的状态与实施状态。
- [x] 受影响的当前行为说明从入口读回，`pnpm run check:docs` 通过；实际执行的检查记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

### 2026-11-05 提前 Electron 回归修复（不关闭本票）

- 基线 `19578a20` 的 schedules / subagents / trace 窄窗口断言改为等待实际全屏面板边界；terminal-details 以文件屏障同步不可回放的首段进度，并将正文定位与消息页脚分开。没有修改产品代码，诊断及原始失败信号见 [第 03 票补验](03-width-narrow-fullscreen.md#2026-11-05-原生-e2e-提前补验)。
- 独立 worktree 最终执行 `rtk pnpm run test --project desktop-e2e apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts`：4 文件、5 项通过、0 跳过，退出 0，45.67s。类型与相关 lint 通过。保留第 12 票的最终集成验收，不将提前批次冒充 AC-01—30 已完成。

- 后续合入第 07 票 `f3a8db9d`（无冲突）后，同一四文件 Electron 命令再次通过：4 文件、5 项、0 跳过，退出 0，47.89s；冻结依赖安装、类型检查、文档检查（344 文件、0 问题）均退出 0。第 08—11 票后的最终整体证据仍由本票核对。


### 2026-11-05 集成验收完成

精确命令、实际范围、初始失败、重验理由、截图与限制见 [最终执行证据](../evidence/integrated-acceptance.md)；AC-01—30 逐行映射见 [spec](../spec.md#2026-11-05-交付与逐项验收)。E1 13文件17项通过，E2 当前源码3文件3项通过；B1 46文件459项通过；原始诊断表头红绿后7项通过；其余直接消费者和字典/守卫6文件76项通过。全部通过批次0跳过。原生和 Browser Mode、手动 CDP 分开报告，没有全仓或CI通过结论。静默命名会话及自有 Forge/Electron/Sidecar 已关闭、端口9222释放，无 watch/package 重叠。

补齐原生定位断言并迁移旧入口/几何与 bridge 桩；英文序号表头使用共享 Tooltip 补全文入口。原生真实指针、红绿灯命中、窗口拖拽无法由后台透明且忽略鼠标的窗口验证；CSS安全区与CDP几何不算原生命中。未运行真实模型、签名/公证或ZIP/DMG发布验收。当前行为文档从 AGENTS → docs/README →正文读回，语义同步、权威归属、引用方向、状态、入口与历史保留通过；正式文档未链接scratch。仅本地分支提交，不推送或改main。

最终机械检查：`rtk pnpm run check:docs` 退出0，345个Markdown、0问题；`rtk pnpm run typecheck`、六个变动TS/TSX的oxlint与oxfmt、`rtk git diff --check`均退出0。文档读回结果及未验证项见上文与证据。
