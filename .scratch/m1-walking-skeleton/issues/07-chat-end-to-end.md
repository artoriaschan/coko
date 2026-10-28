# 07: 对话闭环：Workspace、Session 列表、流式消息与工具卡

**What to build:** renderer 协议客户端与 Zustand store；登记 Workspace（目录选择）、侧栏 Session 列表、新建 Session、消息流（流式 Markdown、工具卡：bash、read、edit diff、write、grep/find/ls、未知工具通用卡）、composer（Lexical、Enter 发送、IME、停止）、错误与重试、重连补齐；打包 Sidecar 进桌面开发与生产路径。

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [x] Electron E2E（faux provider）：登记临时目录 → 新建 Session → 发送 → 看到流式回复与 write 工具卡 → 文件实际存在
- [x] 停止按钮在 Run 中可用，停止后显示已停止
- [x] 重启应用后 Session 列表、消息与工具卡仍在
- [x] Browser Mode：IME 组合期间 Enter 不提交；未知工具数据通用展示

## Comments
- 2026-10-28 lead：票 05 / 06 合并后的遗留项并入本票：(1) 把 boot.platform 写到 document 的 `data-platform`，使 macOS 红绿灯 72px 避让生效，并在 Electron 中核对；(2) renderer 自行生成的连接失败说明（no-bridge、health、ws-timeout、renderer）进入 i18n 字典，技术详情保持原文；(3) renderer 主 chunk 约 1.5MB（mermaid、shiki），按需拆分为懒加载。
- 2026-10-28 lead：票 04 合并后补充：桌面 E2E 改用真实 Sidecar（faux 由 COKO_FAUX_SCRIPT 开启），与 main 的协议代理和 WebSocket 头注入联调；占位 sidecar 只保留在确有必要的壳层测试中。
- 2026-10-28 implementer（分支 m1/07-chat-end-to-end）：

**覆盖的验收**

- 对话闭环：`apps/desktop/e2e/chat.e2e.test.ts` 用真实 Electron + 真实 Sidecar 构建产物（`dist/sidecar/index.mjs`，faux 由 COKO_FAUX_SCRIPT 开启）。登记临时目录 → 新会话 → Enter 发送 → MutationObserver 记录到至少 2 个递增的部分文本 → write 工具卡 done → 读回 `notes/hello.txt` 内容逐字一致。
- 停止：bash `sleep 30` 运行中停止按钮可用，点击后 10 秒内显示"已停止"，发送按钮恢复，工具卡不再是 running。
- 重启：同一 userData 关闭再启动（不再提供 faux 脚本），自动打开最近会话，用户消息、两段助手文本与 write 工具卡从 SQLite 读回。
- Browser Mode：`packages/ui/src/composer/composer-editor.browser.test.tsx` 覆盖 Enter / Shift+Enter / 空白 / IME 两种事件顺序（Chrome：compositionend 前带 isComposing；Safari：compositionend 后 keyCode 229）/ 失败保留输入 / Escape。去掉 keyCode 229 守卫后 Safari 顺序用例失败，已确认能捕获回归。`tool-cards.browser.test.tsx` 覆盖未知工具通用展示（工具名为摘要，参数与结果 JSON 原样）、edit diff 语义色、bash 实时输出。
- 错误与重试（E2E）：模型错误显示简短错误与原文，重试后成功，只有最后一个 Run 的错误提供重试。
- 遗留项 (1)：connect 在 boot 后写 `document.documentElement.dataset.platform`；E2E 在 Electron 中读回 `darwin`，800px 宽 rail 状态下标题左缘 88px（= rail 56 + 16 + (72 − 56)），rail 按钮在 48px 顶部安全区之下。
- 遗留项 (2)：no-bridge、health、ws-timeout、renderer 的说明进入 zh/en 字典（`connection.reasons.*`），技术详情与错误码保持原文。
- 遗留项 (3)：MarkdownRenderer 改为 `@coko/ui/markdown` 子路径并由 renderer `React.lazy` 加载，Streamdown、Shiki、Mermaid、KaTeX 移出主 chunk。主 chunk 现为 993 KB（gzip 293 KB），主要是 react-dom、typebox（renderer 在信任边界校验响应）与 lexical；markdown-renderer 懒加载 chunk 1.1 MB，Shiki 语言与 Mermaid 子图另成 chunk。
- 票 04 补充：桌面壳 E2E 默认改用真实 Sidecar（窗口加载、health 与已认证 WebSocket（收到 not-found 协议应答）、退出后进程消失、目录选择、单实例、窗口参数）；占位 sidecar 只保留在需要观测令牌 / cookie、非主窗口升级、活动 Run 数与 fatal 注入的 4 个用例。

**实现要点**

- renderer：`client/api.ts`（HTTP + schema 校验）、`client/connection.ts`（WebSocket 断线按 500/1000/2000/5000ms 退避重连，重开时通知重新订阅）、`stores/chat-store.ts`（Zustand vanilla store：打开过的会话保持订阅，重连以各自 lastSeq 补齐；中途订阅或重连时暂停接收文本增量，直到下一条 assistant 条目提交，避免显示缺头文本）、`features/conversation/timeline.ts`（由条目与临时状态派生显示项的纯函数，toolCall 与 toolResult 按 toolCallId 配对）。
- 新会话在首条消息提交时创建，标题取首行，避免空会话；先确认订阅再提交，首个 Run 的进度不丢。
- 发送时先乐观标记运行中再请求：Run 可能在 202 返回前结束（run_end 先到），之前的实现会把会话改回运行中并隐藏重试按钮。E2E 发现后已补 store 回归用例（先红后绿）。
- packages/ui 新增 ComposerEditor（Lexical 纯文本）、ToolCard / ToolOutput / DiffBlock；工具专属展示按工具名静态分发，留在 desktop feature。
- apps/server 未改动。

**实际运行的命令与结果**

- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（60 个文件 0 问题）：均退出 0。
- `pnpm run test`：43 个文件 327 个用例全部通过，含 desktop-e2e（chat 5、desktop-shell 10）、desktop-renderer（app 10、tool-cards 4）、ui-browser composer 7、desktop chat-store 5、integration 27。
- 另在 Electron 中截图检查浅色、深色与 520px 窄窗口下的消息流、bash / edit / write / 未知工具卡与 composer：无溢出，终端输出在卡片内横向滚动。

**未验证项**

- 真实输入法：只用合成的 composition / keydown 事件，未在 Electron 中用真实中文输入法操作。
- 真实断线重连：只由 store 单元测试覆盖（假 stream）；Electron 中 WebSocket 中断后的自动重连未实测。
- `electron-forge package` 产物上的启动与对话（票 09）；真实模型（无凭据）；非 macOS。
- 侧栏"搜索"按钮仍无行为；新建会话的全局快捷键未做（停止支持 Escape）。

**与规格 / 约定的差异**

- ui.md 规定草稿保存 Lexical EditorState JSON、Markdown 导入导出用 @lexical/markdown。M1 composer 为纯文本，草稿只随编辑器挂载保留在内存，未持久化，未引入 @lexical/markdown。
- 对话 E2E 放在 `apps/desktop/e2e`，未放根 `tests/e2e`：与壳层 E2E 共用一次 globalSetup 构建，避免两个项目并发构建同一 dist 目录。

**文档影响**

- `docs/TECH_STACK.md` 接入状态：renderer 行加 zustand；packages/ui 行加 lexical、@lexical/react（可选 peer yjs 只供协作插件，不安装）。
- `docs/tech-stack/ui.md` Markdown 渲染：MarkdownRenderer 经 `@coko/ui/markdown` 子路径导出、按需懒加载。
- `apps/server/README.md`：dist/sidecar 产物的启动已由桌面 E2E 验证（开发路径），打包产物尚未验证。
- 2026-10-28 lead：评审后合入 main（df4b97e）。main 上复核：install、typecheck、lint、format:check 退出 0；test 43 文件 327 用例通过（含两组 desktop E2E 共 15 例）；check:docs 0 问题。裁决：composer 纯文本、草稿仅在内存——M1 接受，EditorState JSON 草稿持久化与 @lexical/markdown 随 M3 的 @ / / typeahead 交付；E2E 留在 apps/desktop/e2e 以共用一次构建——接受，跨应用的 sidecar 集成测试仍在根 tests/integration。worktree 已清理。

Closed: true
