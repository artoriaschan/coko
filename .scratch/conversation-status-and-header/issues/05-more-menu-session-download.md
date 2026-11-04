# 05: 常驻“更多”菜单与 Session 下载

**What to build:** 标题栏有一个常驻的“更多”按钮，归档 Session 和窄窗口下同样显示。点击后打开浮动菜单，只有一项“Session 下载”（英文 “Download session”）。选择它会把当前 Session 及其子 Session 保存为 `coko-session-<id>.jsonl`，内容与 Trace tab 的导出相同：经脱敏的导出 header，之后每行一条 Session Entry。同一 Session 同时只进行一次导出，失败时弹出 Toast。Trace 原有的导出不变。

**规格场景:** [spec](../spec.md) 的 AC-11、AC-12，以及 AC-07 中“更多”的部分；对应 HEAD-07、DL-01 至 DL-03。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** tracing 当前行为说明的下载入口；workbench 的标题栏。

**Blocked by:** 04 — 移除标题栏的交接入口（先删掉窄窗口的旧“更多操作”菜单，否则会出现两个“更多”）

**Status:** ready-for-agent

**Closed:** true

- [x] “更多”按钮位于右栏开关的左侧，归档 Session 和窄窗口下同样显示，有可访问名称与 Tooltip。菜单只有“Session 下载”一项，配下载图标。可以用键盘打开、选择，按 Escape 关闭，关闭后焦点回到按钮。
- [x] 选择“Session 下载”并保存后，得到 `coko-session-<Session id>.jsonl`。内容为导出 header 加本 Session 与子 Session 脱敏后的条目，与 Trace 导出一致。
- [x] 导出进行中不重复发起请求。失败时弹出应用级错误 Toast；成功反馈与 Trace 导出相同。
- [x] 取文本、生成 blob、触发下载、导出中去重以及成功与失败反馈，由 Trace 导出与 Session 下载共用，不复制第二份实现。Trace tab 的导出按钮、服务端接口和 `.ndjson` 文件名不变。
- [x] 真实 App 的 Browser Mode 测试覆盖菜单和下载触发。E2E 用 `will-download` 截获下载，检查文件名与内容。真实保存框是否弹出，只能在可见窗口或打包产物中确认；没有验证到时如实报告。
- [x] 同步修改 tracing 与 workbench 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。05 与 06 之间没有先后要求：“更多”始终位于右栏开关左侧。


### 2026-11-04 实施与验证

- 已完成常驻“更多”与单项“Session 下载”菜单；归档与 390px 可用，支持键盘选择、Escape 和焦点返回。`session-download.tsx` 将 Trace 与标题栏的同一 Session 请求锁、Blob 下载和 Toast 统一；Trace `.ndjson`、服务器接口及导出内容保持兼容。
- 真实 Electron 回归发现：刚经 preload 登记、尚未使用的 Secret 未进入明文缓存，旧 Trace 导出会漏脱敏。已在三种观测输出前解析全部登记值，解析失败则请求失败；新增 JSONL E2E 在修复前失败、修复后通过，覆盖用户原文中的登记 Secret、子 Session 与 Trace 导出一致性。读取并遵循 ADR 0007，明文不进入日志或新增持久化字段。
- TDD：新增真实 App 用例首先因缺少“More”按钮失败，再实现；归档 fixture 显式打开历史 Session，等待菜单退出动画之后验证焦点。现有 Trace E2E 的整篇 article 断言改为 `[data-slot="assistant-message-body"]` 的精确正文断言，因为既有底栏已包含用量和时间。
- `pnpm run test apps/desktop/src/renderer/features/conversation/session-menu.browser.test.tsx apps/desktop/src/renderer/features/right-panel/trace-tab.browser.test.tsx`：2 文件、7 测试通过，退出码 0（菜单、键盘、共享锁、错误 Toast、Trace 回归）。
- `pnpm run test apps/desktop/e2e/session-download.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts tests/integration/secrets-gate-trace.test.ts tests/integration/sidecar-trace.test.ts`：4 文件、5 测试通过，退出码 0；真实 Electron 在 globalSetup 本次构建后运行，will-download 写出 JSONL 和 NDJSON，文件包含两种 Session id、子 Session 结果和脱敏标记，登记值不出现，条目行一致。
- `pnpm run typecheck`：退出码 0。`pnpm run check:docs`：319 个 Markdown、0 问题，退出码 0。所改 TS/TSX 的 oxfmt、oxlint 通过。样式守卫初次执行 39/40：唯一失败是 03 继承的 `border-b-2` 下划线，06 已负责改为独立指示器，集成后复核；本票未增加样式违规。
- 文档影响：workbench 标题栏增加菜单、下载与共用去重语义；tracing 增加 JSONL 入口、未使用 Secret 的输出前解析保证及验证边界；docs/README 的 tracing 摘要同步。从 AGENTS → docs/README → 两篇正文读回，正式文档不依赖任务材料，生命周期与历史记录保留。
- 未验证：真实用户操作的原生保存框、真实指针/原生层、签名发布产物和真实模型；未运行全仓测试。保存对话框沿用 Electron 默认行为，测试用 will-download 指定路径不能证明原生框视觉。本地提交与集成状态随合并记录更新，不表示推送或发布。
