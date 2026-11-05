# 03: 独立会话目录与 work/outputs

**What to build:** 用户首次向没有项目的独立会话发送消息时，Coko 在 `<Documents>/Coko/<yyyy-MM-dd>/chat-<前 12 位>/` 下创建 `work/` 与 `outputs/`，把会话根登记为 Workspace，并把 Agent 的 cwd 设为 `work/`。独立会话的系统上下文说明中间产物写 `work/`、交付文件写 `outputs/`、不要在会话根其他位置创建文件。首次发送失败时回滚目录、Workspace 与会话记录。

**Blocked by:** 01 主数据根切换到 ~/.coko；02 Session 目录字段与目录名派生

**Status:** ready-for-agent

- [ ] 首次发送后磁盘上存在 `<Documents>/Coko/<本地日期>/chat-<短 id>/work` 与 `outputs`，日期目录按首次成功发送的日期固定。
- [ ] 该独立会话的 Workspace 根是会话根，Session DTO 的 `directory` 是会话根，cwd 是 `work/`。
- [ ] 同一草稿重发复用同一目录，不产生第二个目录；首次发送失败后不留下会话记录、Workspace 或目录。
- [ ] 独立会话的系统上下文只包含 `work/`、`outputs/` 的说明；项目会话不出现这段说明。
- [ ] 独立会话的 Workspace 名称固定为“独立对话 · yyyy-MM-dd”，不随会话标题变化，也不出现在项目列表。
- [ ] 集成测试用临时 `COKO_CHATS_ROOT` 验证目录结构、DTO、cwd 与失败回滚；桌面 e2e 验证新会话的目录路径与系统上下文。
