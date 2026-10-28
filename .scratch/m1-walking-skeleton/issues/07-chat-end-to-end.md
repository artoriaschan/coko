# 07: 对话闭环：Workspace、Session 列表、流式消息与工具卡

**What to build:** renderer 协议客户端与 Zustand store；登记 Workspace（目录选择）、侧栏 Session 列表、新建 Session、消息流（流式 Markdown、工具卡：bash、read、edit diff、write、grep/find/ls、未知工具通用卡）、composer（Lexical、Enter 发送、IME、停止）、错误与重试、重连补齐；打包 Sidecar 进桌面开发与生产路径。

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] Electron E2E（faux provider）：登记临时目录 → 新建 Session → 发送 → 看到流式回复与 write 工具卡 → 文件实际存在
- [ ] 停止按钮在 Run 中可用，停止后显示已停止
- [ ] 重启应用后 Session 列表、消息与工具卡仍在
- [ ] Browser Mode：IME 组合期间 Enter 不提交；未知工具数据通用展示

## Comments
- 2026-10-28 lead：票 05 / 06 合并后的遗留项并入本票：(1) 把 boot.platform 写到 document 的 `data-platform`，使 macOS 红绿灯 72px 避让生效，并在 Electron 中核对；(2) renderer 自行生成的连接失败说明（no-bridge、health、ws-timeout、renderer）进入 i18n 字典，技术详情保持原文；(3) renderer 主 chunk 约 1.5MB（mermaid、shiki），按需拆分为懒加载。

