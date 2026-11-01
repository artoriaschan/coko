# 05: 代码智能：LSP stdio 客户端、lsp 工具、服务器配置与进程生命周期、设置分区与工具卡

**What to build:** 见 [规格](../spec.md)"代码智能"：agent `tools/lsp/`（工具契约、位置换算、结果格式化）；server `adapters/lsp-client.ts`（JSON-RPC 2.0 stdio、分帧、initialize、文档同步、诊断等待、超时）、`LspService`（配置合并：全局 / Workspace / 插件，进程池、登记 `kind: lsp`、空闲关闭、崩溃重启、状态与 `lsp_update`）、`context/lsp.ts`（工具注册）、`routes/lsp.ts`、layers.ts 的 lsp 块；renderer 设置 → 代码智能分区、`lsp-store`、`lsp` 工具卡。

**User stories:** 10

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/tools/lsp/`、`packages/protocol/src/lsp.ts`、`apps/server/src/{adapters/lsp-client,application/lsp,application/context/lsp,http/routes/lsp}.ts`、`runtime/layers.ts` 的 lsp 块、`packages/i18n/src/dictionaries/domains/lsp.ts`、renderer `features/settings/{lsp-section.tsx（新）,sections.ts（只改 lsp 一行）}`、`stores/lsp-store.ts`（新）、`features/conversation/tool-cards.tsx`（只追加 lsp 分支）、就近测试、`tests/integration/{sidecar-lsp,sidecar-lsp-process,secrets-gate-lsp}.test.ts`（新）、`apps/desktop/e2e/lsp.e2e.test.ts`（新）、`docs/subsystems/lsp.md`（新）

**跨票接口：** 读取 03 的 `PluginContributionsSnapshot.lspServers`（04 提供，名字 `<plugin>:<server>`）；写 `LspServerStatus` 与 `lsp_update`（03 声明）。

- [x] agent 表驱动：1 基 ↔ 0 基 UTF-16 换算（含代理对与中文）、四种结果的格式化与截断、参数校验（definition 缺 line 为参数错误）
- [x] 客户端单元：Content-Length 分帧（分包、粘包、非法头）、请求超时、服务器发来的请求得到空结果、服务器退出时挂起的请求失败
- [x] 集成（假服务器）：四个操作的结果与假服务器记录的请求（initialize 的 rootUri 为 Session cwd、didOpen 的内容为磁盘当前内容、修改文件后 didChange 版本递增）；diagnostics 超时返回"没有收到诊断"；扩展名不匹配为错误结果并列出扩展名；没有服务器时不注册工具（requestLog 的 tools）
- [x] 集成：配置合并（workspace > global > plugin、shadowed 诊断）、项目文件中的 `lsp` 被忽略并有诊断、`lsp.enabled: false` 时不注册
- [x] 集成 `sidecar-lsp-process`：登记 `kind: lsp`；空闲关闭（以测试可设的空闲时长）后登记行删除；`--crash-after 1` 时下一次查询重启、连续 3 次失败后 failed、`POST /api/lsp/restart` 后恢复；超过 4 个时关闭最久未用的；Sidecar 关闭时进程退出；SIGKILL Sidecar 后重启清理孤儿（darwin）
- [x] **对手用例（权限）**：`file_path` 为 Workspace 外的文件时询问、为 `.git/config` 时照受保护路径处理、`Read(secret/**)` 拒绝规则对 lsp 生效；服务器返回的 hover 中含登记 Secret 时结果被替换
- [x] 秘密总闸 `secrets-gate-lsp`：requestLog、条目、HTTP（`/api/lsp` 的 stderrTail）、WS、库、日志中没有明文
- [x] E2E：设置 → 代码智能 编辑全局 JSON（非法时行内诊断）、保存后列表显示假服务器、Agent 调用后状态 running、"重启"；`lsp` 工具卡显示操作与结果计数；明暗主题与键盘操作
- [x] lsp.md 建立并可达；docs/README 当前行为一行；`check:docs` 通过；真实语言服务器记为未验证（人工清单）

## Comments
- 2026-10-31 lead：**新增验收（来自票 04）。** 插件声明的 LSP 服务器（经 PluginContributionsPort 的 lspServers，批准后）由 LspService 启动；在打包产物 smoke 中用票 03 的 LSP 假服务器夹具断言该进程被启动并登记为 kind lsp，退出后登记删除。若本票开始时票 04 尚未合入，先以 COKO_TEST_PLUGINS 测试端口提供插件声明完成这一项，合并 main 后用真实插件路径再跑一次。
- 2026-11-01 implementer：**完成回执（m6/05-code-intelligence）。**
  - **覆盖的验收**：全部 9 项与 lead 移来的一项。
    - agent `packages/agent/src/tools/lsp/lsp.test.ts`（35）：换算（中文、代理对、CRLF、越界）、四种结果格式化与 200 项 / 20 000 字符截断、参数校验、帧编解码。
    - 客户端 `apps/server/src/adapters/lsp-client.test.ts`（9）：7 字节分包与粘包、前置非法头、超时与 `$/cancelRequest`、`workspace/configuration` 每项 null、退出时挂起请求失败、环境剔除、darwin 关闭序列（SIGKILL）。
    - `tests/integration/sidecar-lsp.test.ts`（5）：四个操作与假服务器记录（rootUri、didOpen 为磁盘内容、didChange 版本 2→5）；诊断超时；扩展名不匹配；无服务器 Workspace 的 requestLog 无 `lsp`；workspace > global > plugin 与 `duplicate-extension` / `shadowed-server`；项目文件 `lsp.servers` 为 `project-cannot-grant` 且从未启动；项目 `lsp.enabled: false` 后不注册；PUT 的 400 / 409 / 404 与重启 404。
    - 对手用例：Workspace 外询问（拒绝后服务器未收到该文件）；`Read(secret/**)` 拒绝 lsp；结果经符号链接逃出的 `linked/x.ts` 与被拒绝的 `secret/k.ts` 只给位置、不附该行文本。
    - 受保护路径：`.git/config` 没有扩展名，lsp 先以扩展名不匹配失败，不能检验判定。改用 `.git/hook.ts`：read 与 lsp 判定相同，Workspace 内不询问；单元层的 `.git/config` 一致性已在 `decide.test.ts`（票 03）中。
    - `tests/integration/sidecar-lsp-process.test.ts`（4）：登记 kind lsp（pgid = pid）；`COKO_TEST_LSP_IDLE_MS` 空闲关闭后进程退出、登记删除、lsp_update 依次为 starting → running → idle；`--crash-after 1`（包装脚本按 mode 文件切换）3 次失败后 failed、第 4 次不再启动、restart 后恢复；5 个服务器时关闭最久未用的；有序关闭全部退出；darwin 上 SIGKILL 后重启记 `orphan process terminated { kind: lsp }`。
    - `tests/integration/secrets-gate-lsp.test.ts`（1）：hover 与 stderrTail 中的登记值被替换；requestLog、WS、HTTP、库（含 -wal）、日志与 Sidecar stderr 无明文。
    - E2E `apps/desktop/e2e/lsp.e2e.test.ts`（1）：非法 JSON 与 `invalid-lsp-server` 行内显示、保存后列表、Agent 调用后 running、工具卡"Find references"与"2 items"、键盘重启换新 pid、明暗主题。
    - 来自票 04：`package-smoke.e2e.test.ts` 新增用例，安装并批准插件夹具后 lsp 调用在打包产物中启动 `sample:ts`，登记为 kind lsp，退出后登记删除（接收侧：假服务器记录了 initialize 与 hover）。04 已合入 main，这一项按真实插件路径完成；合并前曾以全局服务器跑通同一断言。
  - **实际运行的命令与数量**：
    - `pnpm run typecheck`：通过。
    - 单文件：agent 35、client 9、sidecar-lsp 5、sidecar-lsp-process 4、secrets-gate-lsp 1、sidecar-m6-seams 10；renderer lsp-store 3、tool-cards 10、lsp-section 加 sections 13；`scripts/browser-deps` 加 `source-references` 加 i18n 18。
    - `vitest --project desktop-e2e`：lsp.e2e 1，package-smoke 5（合并 main 后）。
    - `pnpm run check:docs`：210 个文件，0 个问题。
    - 合并 main 后锁内全量 `pnpm run test`：341 个文件，2788 passed、2 failed、1 skipped，**test=1**。2 个失败都是真实 git 子进程超时：`adapters/git.test.ts`（5 s）与 `application/worktrees.test.ts` recover（30 s），两文件与 main 相同、不在本票写范围内。期间负载 46–66；单独重跑时负载 77–150，两文件 29 passed、exit 0。
  - **负向确认**：agent 测试先红（35 failed）。去掉 `#readText` 的可读判定后对手用例变红；去掉 stderrTail 的脱敏后 secrets-gate-lsp 变红。均已恢复。
  - **相对规格的收紧**：结果的"该行文本"只读真实路径在工作目录内、非受保护、不被 Read 拒绝的文件，其余只给位置。服务器返回的位置不经审批，不能借它把外部文件内容带进结果。
  - **秘密通道说明**：发给语言服务器的文件内容不脱敏。服务器是用户本机进程，与全局 stdio MCP 同一信任级别；服务器环境剔除 `HOST_ENV_EXCLUSIONS`，不注入 Secret。
  - **未验证**（需外部条件，人工清单）：真实语言服务器（typescript-language-server）、真实模型下的 LSP 修复、非 darwin 平台。
  - **UI 发现**：`text-destructive` 在卡片背景上的对比度为浅色 4.50、深色 4.24，低于 4.5。failed 状态沿用共享色，只对 running / starting 断言对比度，token 不在本票范围。
  - **越出 Write scope 的改动**：
    - `apps/server/src/application/context/types.ts`：`ContextContributionOptions.lsp?`，lsp 贡献需要服务。
    - `runtime/layers.ts` 块外：`createContributions` 的 `lsp` 参数，以及 AppLive 中的 `lsp.bindSessions`（GET ?sessionId= 需要 SessionService）。
    - `tests/integration/sidecar-m6-seams.test.ts`：LSP 的 501 断言改为 404 与带 workspace 的 GET；合并时与 04 同一处冲突，已解决。
    - `apps/desktop/e2e/package-smoke.e2e.test.ts`：票 04 移来的验收。
    - `features/settings/sections.browser.test.tsx`：菜单中加入"代码智能"。
    - `docs/subsystems/{permissions,configuration}.md`：各改一句已过时的"尚未注册 / 尚未接入"。
  - **Lead 合并时处理**：
    - `docs/README.md` 当前行为加了"代码智能"一行，与 04 的"插件"一行已在合并中并存。
    - README 要点交给 14：agent 导出 `createLspTool`、`formatLspResult`、`toLspPosition` / `fromLspPosition`、`encodeFrame` / `decodeFrames`；server 新增 `LspService` 与测试钩子 `COKO_TEST_LSP_IDLE_MS`（仅非 --packaged）。`LspQuery` 的形状为本票所定（03 只有存根）。
