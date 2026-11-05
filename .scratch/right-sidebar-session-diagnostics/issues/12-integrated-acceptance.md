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

- [ ] 本功能相关的 E2E 与 Browser Mode 测试在集成后的代码上通过。精确的命令、范围和结果记入 Comments，E2E 与 agent-browser 的结果分开报告。
- [ ] agent-browser 静默检查覆盖：tab 条几何、全屏时与红绿灯和拖拽区的关系、悬停、明暗主题。需要真实指针或原生层而没能验证的项，写明原因。
- [ ] 390 CSS px 及以上宽度、zh/en 下，没有意外的裁剪、重叠或整页横向滚动，键盘路径完整；tab 条、分隔条与表格有正确的语义和可访问名称。（AC-29）
- [ ] 打包产物中有第三方声明，内容包含版权行和完整的许可文本。（AC-30）
- [ ] AC-01—AC-30 逐项核对，结论记入 spec，并相应更新 spec 的状态与实施状态。
- [ ] 受影响的当前行为说明从入口读回，`pnpm run check:docs` 通过；实际执行的检查记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
