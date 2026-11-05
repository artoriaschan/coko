# 01: 主数据根切换到 ~/.coko

**What to build:** 用户启动 Coko 后，业务数据统一落在 `~/.coko/data`（Windows 为 `C:\Users\<用户>\.coko\data`），桌面与 sidecar 日志落在 `~/.coko/data/logs`；Electron 的 userData、Cache、Cookies 保持平台默认位置。独立会话的默认根由桌面端解析的 Documents 目录派生为 `<Documents>/Coko`。`COKO_HOME` 可整体重定向主根，`COKO_USER_DATA_DIR` 只控制 Electron。旧库与旧 `~/Coko/chats` 保持原样，不做迁移。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] macOS 启动后 `coko.db` 位于 `~/.coko/data`，`~/Library/Application Support` 下不再产生新的 `data` 目录；Windows 对应路径为 `C:\Users\<用户>\.coko\data`。
- [ ] `desktop.jsonl` 与 `sidecar.jsonl` 写入 `~/.coko/data/logs`，Electron 的 `app.getPath('logs')` 不再承载这两个文件。
- [ ] `COKO_HOME` 重定向整个主根；设置 `COKO_USER_DATA_DIR` 只改变 Electron 数据，不改变 `~/.coko`。
- [ ] 桌面 main 用 `app.getPath('documents')` 解析 Documents，并把 `<Documents>/Coko` 传给 sidecar；`COKO_CHATS_ROOT` 仍可显式覆盖。
- [ ] 旧库与旧 `~/Coko/chats` 不被移动、复制或删除；新版本从新主根的空库开始。
- [ ] 集成测试与桌面 e2e 使用临时 `COKO_HOME`，断言从旧的 `user-data/data` 改为 `<COKO_HOME>/data`，不保留旧路径回退。
- [ ] 主数据根的决定记录为 ADR，并在所属配置文档中更新当前路径说明。
