# 05: 常驻“更多”菜单与 Session 下载

**What to build:** 标题栏有一个常驻的“更多”按钮，归档 Session 和窄窗口下同样显示。点击后打开浮动菜单，只有一项“Session 下载”（英文 “Download session”）。选择它会把当前 Session 及其子 Session 保存为 `coko-session-<id>.jsonl`，内容与 Trace tab 的导出相同：经脱敏的导出 header，之后每行一条 Session Entry。同一 Session 同时只进行一次导出，失败时弹出 Toast。Trace 原有的导出不变。

**规格场景:** [spec](../spec.md) 的 AC-11、AC-12，以及 AC-07 中“更多”的部分；对应 HEAD-07、DL-01 至 DL-03。

**设计依据:** 规格本身，没有单独的设计。

**文档影响:** tracing 当前行为说明的下载入口；workbench 的标题栏。

**Blocked by:** 04 — 移除标题栏的交接入口（先删掉窄窗口的旧“更多操作”菜单，否则会出现两个“更多”）

**Status:** ready-for-agent

- [ ] “更多”按钮位于右栏开关的左侧，归档 Session 和窄窗口下同样显示，有可访问名称与 Tooltip。菜单只有“Session 下载”一项，配下载图标。可以用键盘打开、选择，按 Escape 关闭，关闭后焦点回到按钮。
- [ ] 选择“Session 下载”并保存后，得到 `coko-session-<Session id>.jsonl`。内容为导出 header 加本 Session 与子 Session 脱敏后的条目，与 Trace 导出一致。
- [ ] 导出进行中不重复发起请求。失败时弹出应用级错误 Toast；成功反馈与 Trace 导出相同。
- [ ] 取文本、生成 blob、触发下载、导出中去重以及成功与失败反馈，由 Trace 导出与 Session 下载共用，不复制第二份实现。Trace tab 的导出按钮、服务端接口和 `.ndjson` 文件名不变。
- [ ] 真实 App 的 Browser Mode 测试覆盖菜单和下载触发。E2E 用 `will-download` 截获下载，检查文件名与内容。真实保存框是否弹出，只能在可见窗口或打包产物中确认；没有验证到时如实报告。
- [ ] 同步修改 tracing 与 workbench 当前行为说明。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-04：用户回复“确认”，确认 9 票及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。05 与 06 之间没有先后要求：“更多”始终位于右栏开关左侧。
