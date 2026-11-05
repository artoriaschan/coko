---
kind: decision
description: "业务数据统一保存在跨平台 COKO_HOME，Electron userData 保持独立；独立对话默认根由 Documents 派生。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 主数据根独立于 Electron userData

## 上下文

原来的业务库位于 Electron userData/data，桌面和服务日志由 Electron 日志路径承载，用户级指令与 Skills 则在 ~/.coko；用户难以整体备份。用户于 2026-11-04 至 2026-11-05 确认 macOS 与 Windows 使用同一主数据根接口，独立会话生成的文件放在用户可见的 Documents/Coko；本轮不迁移旧库或旧会话目录。

## 决定

- 主根为 `COKO_HOME`，未设置或为空时使用 `join(homedir(), '.coko')`。Windows 同样使用用户家目录，不读取 APPDATA 或 LOCALAPPDATA。主根包含 `data/`、`skills/`、`plugins/` 等用户资源；业务库为 `data/coko.db`。
- desktop main 把 `data/` 与 `data/logs/` 传给 Sidecar。`desktop.jsonl` 和 `sidecar.jsonl` 统一写到主根的 `data/logs/`；Sidecar 的显式 `--data-dir` 和 `--log-dir` 仍可单独覆盖，省略日志参数时使用所选数据目录的 `logs/`。
- `COKO_USER_DATA_DIR` 只重定向 Electron userData（含单实例锁的身份）；Cache、Cookies、IndexedDB 和 Local Storage 继续使用 Electron 的位置。业务数据不从 userData 路径回退。
- desktop main 通过 `app.getPath('documents')` 取得操作系统实际 Documents 路径，传入 `<Documents>/Coko` 作为 Sidecar 的 `COKO_CHATS_ROOT`；显式环境覆盖优先。非桌面 Sidecar 的缺省值为 `~/Documents/Coko`。
- 旧 userData/data 与旧 ~/Coko/chats 保持原样。新主根没有旧库时从空库开始，不扫描、复制、移动或删除旧数据。

## 理由与备选方案

保留 Electron userData 作为业务根符合平台惯例，但无法提供用户要求的 macOS/Windows 同构路径与整体重定向。把 Electron 自己的存储一并搬到主根会改变缓存、浏览器会话和系统集成；用户确认只移动 Coko 业务数据，因此不采用。

## 后果与验证

用户可备份主根获得业务状态与已安装资源；独立会话文件仍需同时备份 Documents/Coko。同一业务主根仍由 SQLite 租约保证单写者，使用不同 userData 启动多个实例不会绕过该约束。路径跨机器移动后的绝对会话目录映射与旧数据迁移不在本轮范围。

实现入口是 `apps/desktop/src/main/index.ts` 与 `apps/server/src/config.ts`；测试 `apps/server/src/config.test.ts`、`tests/integration/sidecar-boot.test.ts` 和 `apps/desktop/e2e/data-root.e2e.test.ts` 覆盖默认与显式目录、日志落点、旧库不动、Electron userData 分离与 Documents 传递。Windows 仅审查同构 API 与路径构造，未在 Windows 实机运行。

## 来源与后继

用户于 2026-11-05 批准完整实施，确认范围为本页所述路径与无旧数据迁移。存储所有权继续遵循 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)；当前配置见 [分层配置](../subsystems/configuration.md#主数据根与启动路径)，日志约定见 [日志与诊断](../tech-stack/observability.md#文件轮转与脱敏)。
