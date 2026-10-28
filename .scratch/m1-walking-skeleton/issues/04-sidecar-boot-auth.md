# 04: Sidecar 启动、认证与 Session 协议

**What to build:** apps/server：进程入口（IPC 与独立运行两种模式）、127.0.0.1 端口 0、启动令牌与 cookie 交换、信任围栏、Hono 路由与 WebSocket（subscribe / entry / progress）、application 层把协议映射到 agent 与 session、Effect 资源管理与分级关闭、LogTape 文件日志与脱敏（packages/logging）。测试用 faux provider 由环境变量开启。

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] Vitest 以 `ELECTRON_RUN_AS_NODE=1` 启动真实 Sidecar 并收到 ready
- [ ] ADR 0002 列出的 401 / 403 场景全部通过，含 WebSocket 升级与 Sidecar 重启后旧 cookie 被拒
- [ ] 登记 Workspace → 新建 Session → 提交消息：WebSocket 收到 progress 与 entry，Agent 写入的文件存在
- [ ] 停止 Run 后收到取消条目；重启 Sidecar 后 Session 条目完整读回；afterSeq 重连补齐缺失条目
- [ ] 日志文件中不出现令牌、cookie 与密钥

## Comments
