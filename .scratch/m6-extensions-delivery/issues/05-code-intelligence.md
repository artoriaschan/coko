# 05: 代码智能：LSP stdio 客户端、lsp 工具、服务器配置与进程生命周期、设置分区与工具卡

**What to build:** 见 [规格](../spec.md)"代码智能"：agent `tools/lsp/`（工具契约、位置换算、结果格式化）；server `adapters/lsp-client.ts`（JSON-RPC 2.0 stdio、分帧、initialize、文档同步、诊断等待、超时）、`LspService`（配置合并：全局 / Workspace / 插件，进程池、登记 `kind: lsp`、空闲关闭、崩溃重启、状态与 `lsp_update`）、`context/lsp.ts`（工具注册）、`routes/lsp.ts`、layers.ts 的 lsp 块；renderer 设置 → 代码智能分区、`lsp-store`、`lsp` 工具卡。

**User stories:** 10

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tools/lsp/`、`packages/protocol/src/lsp.ts`、`apps/server/src/{adapters/lsp-client,application/lsp,application/context/lsp,http/routes/lsp}.ts`、`runtime/layers.ts` 的 lsp 块、`packages/i18n/src/dictionaries/domains/lsp.ts`、renderer `features/settings/{lsp-section.tsx（新）,sections.ts（只改 lsp 一行）}`、`stores/lsp-store.ts`（新）、`features/conversation/tool-cards.tsx`（只追加 lsp 分支）、就近测试、`tests/integration/{sidecar-lsp,sidecar-lsp-process,secrets-gate-lsp}.test.ts`（新）、`apps/desktop/e2e/lsp.e2e.test.ts`（新）、`docs/subsystems/lsp.md`（新）

**跨票接口：** 读取 03 的 `PluginContributionsSnapshot.lspServers`（04 提供，名字 `<plugin>:<server>`）；写 `LspServerStatus` 与 `lsp_update`（03 声明）。

- [ ] agent 表驱动：1 基 ↔ 0 基 UTF-16 换算（含代理对与中文）、四种结果的格式化与截断、参数校验（definition 缺 line 为参数错误）
- [ ] 客户端单元：Content-Length 分帧（分包、粘包、非法头）、请求超时、服务器发来的请求得到空结果、服务器退出时挂起的请求失败
- [ ] 集成（假服务器）：四个操作的结果与假服务器记录的请求（initialize 的 rootUri 为 Session cwd、didOpen 的内容为磁盘当前内容、修改文件后 didChange 版本递增）；diagnostics 超时返回"没有收到诊断"；扩展名不匹配为错误结果并列出扩展名；没有服务器时不注册工具（requestLog 的 tools）
- [ ] 集成：配置合并（workspace > global > plugin、shadowed 诊断）、项目文件中的 `lsp` 被忽略并有诊断、`lsp.enabled: false` 时不注册
- [ ] 集成 `sidecar-lsp-process`：登记 `kind: lsp`；空闲关闭（以测试可设的空闲时长）后登记行删除；`--crash-after 1` 时下一次查询重启、连续 3 次失败后 failed、`POST /api/lsp/restart` 后恢复；超过 4 个时关闭最久未用的；Sidecar 关闭时进程退出；SIGKILL Sidecar 后重启清理孤儿（darwin）
- [ ] **对手用例（权限）**：`file_path` 为 Workspace 外的文件时询问、为 `.git/config` 时照受保护路径处理、`Read(secret/**)` 拒绝规则对 lsp 生效；服务器返回的 hover 中含登记 Secret 时结果被替换
- [ ] 秘密总闸 `secrets-gate-lsp`：requestLog、条目、HTTP（`/api/lsp` 的 stderrTail）、WS、库、日志中没有明文
- [ ] E2E：设置 → 代码智能 编辑全局 JSON（非法时行内诊断）、保存后列表显示假服务器、Agent 调用后状态 running、"重启"；`lsp` 工具卡显示操作与结果计数；明暗主题与键盘操作
- [ ] lsp.md 建立并可达；docs/README 当前行为一行；`check:docs` 通过；真实语言服务器记为未验证（人工清单）

## Comments
