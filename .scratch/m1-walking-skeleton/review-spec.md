# M1 行走骨架：规格轴评审（review-spec）

- 范围：`git diff 72b8b80...HEAD`（排除 pnpm-lock.yaml、.scratch），对照 [spec.md](spec.md)、issues/01–09 及其 Comments、ADR 0001–0004。
- 方法：按风险排序阅读（认证与凭据 → 持久化与顺序 → 进程生命周期 → 信任边界的协议校验 → UI），其余抽样。所有结论都经代码确认；需要运行的地方已注明命令。
- 严重度：**hard** 表示与规格或 ADR 原文冲突，或缺少规格明文要求的功能；**judgement** 表示需要解释或权衡（实现可能可以接受，但建议修正或在规格中记录）。
- 已被 Lead 接受的偏离不重复报告：credential.store 带 requestId/hint、credential.store.result、密文 base64；inspect-quit.result 与 /api 路由；read 图片不缩放；bash 不受统一 10 分钟超时约束；composer 纯文本、草稿只在内存；E2E 放在 apps/desktop/e2e；COKO_FAUX_SCRIPT / COKO_USER_DATA_DIR 在产物中保留（M6 再关）；主题没有"跟随系统"；真实模型对话未验证；对话框打开时 Toast 动作无法用键盘到达。

## 运行过的验证

- `unset ELECTRON_RUN_AS_NODE; pnpm exec vitest run tests/integration/sidecar-auth.test.ts`：12/12 通过（ADR 0002 的 401/403、WebSocket 升级、重启后旧 cookie 被拒）。
- 在仓库外（/tmp）用仓库内的 hono 4.13.12 跑了一个探针：`POST /api/auth/%65xchange` 命中 `/api/auth/exchange` 的处理函数（200），`/api/auth/exchange/` 返回 404。见 F5。
- 没有运行 Electron E2E 和完整的 `pnpm run test`（每次都会打包，耗时较长）。各票回执中记录的 Lead 复核结果没有重新验证。

---

## (a) 缺失或部分实现的需求

### F1 [hard] 用户故事 4："失败时看到可理解的错误与诊断入口"：诊断入口缺失；崩溃后应用停在无法恢复的状态

- 规格：spec.md:20 用户故事 4；spec.md:78 "Sidecar 生命周期（spawn、ready、fatal 提示…）"；ADR 0002:37 "sidecar 重启后旧 cookie 失效；main 必须在重新交换完成后再恢复转发"。
- 现状：
  - apps/desktop/src/main/index.ts:70-83 的错误对话框只有"退出 / 关闭"两个按钮，`detail` 显示原始英文技术信息 `message (code)`；文案为"Sidecar 启动失败"（apps/desktop/src/main/messages.ts:16-17），对普通用户来说是行话。
  - sidecar 的 stderr 尾部（`SidecarStartError.diagnostic`，sidecar-process.ts:48 的注释写着"只用于诊断入口"）只写到 `console.error`（index.ts:114）。打包后用户看不到，desktop.jsonl 里也没有。
  - renderer 的失败覆盖层（apps/desktop/src/renderer/features/connection/connection-status.tsx:38-48）只显示消息和错误码，没有"打开日志 / 复制诊断信息"等入口。
  - sidecar ready 之后意外退出时（index.ts:92-97），main 只把 endpoint 清空并弹框。renderer 的 WebSocket 按退避无限重连（renderer/client/connection.ts:85-95），状态一直是 `disconnected`，不会进入 failed。用户点"关闭"后，应用停在永远"已断开"、所有 HTTP 返回 503 的状态。M1 既没有重启 sidecar 并重新交换 cookie，也没有把这一情况作为终态失败告诉 renderer。票 05 把它列为未验证项（05:44），但 Lead 没有明确接受。
- 修复：
  1. 错误对话框增加"打开日志文件夹"按钮，调用 `shell.openPath(app.getPath('logs'))`；`detail` 先给出本地化的一句说明，技术信息放在后面。
  2. `diagnostic` 经 `redactText` 后写入 desktop.jsonl（`log.error('sidecar diagnostic', { stderrTail })`），不要只写 console。
  3. preload 增加只读的"打开日志"调用（主框架校验与现有 IPC 一致），renderer 失败覆盖层提供这一按钮。
  4. ready 后意外退出时，经 IPC 事件通知 renderer 进入 `failed`（code `sidecar-exited`）并停止重连。或者实现 ADR 0002:37 的重启 + 重新交换。二者选一并写进规格。
  5. E2E：在 fatal 用例中断言对话框按钮存在、desktop.jsonl 含脱敏后的 stderr 尾部；新增"ready 后 kill sidecar → renderer 显示 failed"用例。

### F2 [hard] 用户故事 22："键盘可以完成新建、发送、停止和关闭弹窗"：新建没有快捷键，停止只在 composer 聚焦时可用

- 规格：spec.md:38 用户故事 22。
- 现状：全局按键处理只有 ⌘,（apps/desktop/src/renderer/app/app.tsx:41-49）。grep `metaKey|ctrlKey|accelerator|Menu.` 在 apps/desktop/src 中没有别的结果，Electron 默认菜单里也没有新建会话。票 07 的"未验证项"（07-chat-end-to-end.md:50）写明"新建会话的全局快捷键未做"，Lead 的裁决（:62）没有涉及这一条，所以它不算已接受的偏离。停止只经 ComposerEditor 的 `onEscape` 触发（packages/ui/src/composer/composer-editor.tsx:158），焦点离开编辑区后 Escape 无效。按钮虽然可以 Tab 到达，但这与"键盘可以完成"的意图不符。
- 修复：在 app.tsx 的同一个 keydown 处理中加入 ⌘N / Ctrl+N（跳过 `isComposing`），没有 Workspace 时调用 `onAddWorkspace`，否则调用 `startDraft()` 并聚焦 composer。运行中且没有打开对话框时，全局 Escape 调用 `stop()`。在 app.browser.test.tsx 中补充这两条快捷键的断言。

### F3 [judgement] spec.md:57 要求 progress 带"Run 状态"，实际只有 run_start；run_end 提交失败时客户端会一直显示运行中

- 规格：spec.md:57 "progress（临时：文本增量、工具执行进度、Run 状态，带 runId）"；用户故事 13、14。
- 现状：协议的 ProgressEvent（packages/protocol/src/ws.ts:28-62）没有 Run 结束或状态事件，Run 结束只能从已提交的 `run_end` 条目得知。packages/agent/src/engine/runtime.ts:188 在 `commitError` 时跳过 `run_end` 提交，此时服务端 `isRunning` 已是 false，但没有任何消息通知客户端。renderer 只在 `run_end` 条目或重新订阅时清除 `running`（renderer/stores/chat-store.ts:281、:266-272），composer 会停在"停止"按钮上，重试按钮也不会出现，直到 WebSocket 重连。存储失败（租约丢失、磁盘满）正是这条路径。
- 修复：在 apps/server/src/application/sessions.ts:166-169 的 `run.then` 两个分支中都发布 `progress { type: 'run_state', status, error? }`（或 `run_finished`）。renderer 收到后清除 `running`/`live`，并在没有 run_end 条目时显示简短错误。在 sidecar-session 集成测试中注入 commit 失败（例如让 appendEntries 抛错）并断言客户端收到这一事件。

### F4 [judgement] 用户故事 21 / Testing Decisions"窄窗口"：E2E 只断言几何，没有断言"主要操作仍可达"

- 规格：spec.md:37 用户故事 21；spec.md:90 E2E 覆盖"窄窗口"。
- 现状：apps/desktop/e2e/chat.e2e.test.ts:169-192 在 800px 下断言 `data-sidebar=rail`、标题避开红绿灯 88px、按钮位于安全区之下，但没有点击 rail 中的新建、添加 Workspace、设置，也没有在窄窗口中发送消息。实现上 rail 包含这些按钮（renderer/features/sidebar/sidebar-rail.tsx:17-33），Browser Mode 也覆盖了 <1024 自动收起，所以这里是覆盖缺口，不是功能缺陷。
- 修复：在同一个用例中继续点击 rail 的"新建会话"，断言 composer 可用，再点击设置按钮，断言对话框打开；必要时把窗口设为 520px 最小宽度再发送一次。

---

## (b) 范围蔓延

### F6 [judgement] 侧栏与 rail 的"搜索"按钮无行为
- 位置：renderer/features/sidebar/sidebar.tsx:58-61、sidebar-rail.tsx:24-26。
- 依据：spec.md:80 列出的 M1 renderer 内容不含搜索；票 07 的未验证项（:50）注明"仍无行为"，Lead 没有裁决。可以点击但没有任何反应的控件违背用户故事 21 "主要操作仍可达"的预期，也会被读屏当作可用操作。
- 修复：M1 移除这两个按钮（或设为 `disabled` 并加 tooltip"即将推出"），随 M3 的搜索一起交付。

### F7 [judgement] 规格未列出的协议面
- `GET /api/provider-presets`、`GET /api/models`（apps/server/src/http/app.ts:139-140，packages/protocol/src/api.ts:14-17）：spec.md:56 的路由清单中没有，但用户故事 16、18 需要它们。票 08 回执写了这两个路由，Lead 合入时没有单独裁决。建议在 spec.md:56 补记，不必删除。
- WebSocket `unsubscribe`（packages/protocol/src/ws.ts:15-17、apps/server/src/ws/connection.ts:34）：spec.md:57 只有 subscribe；renderer 从不发送（grep `unsubscribe` 在 renderer 中没有结果）。保留它的成本很低，但应当在规格中记录或删除。
- `COKO_CREDENTIAL_<PROVIDER_ID>` 环境变量（apps/server/src/adapters/credentials.ts:86-100）：spec.md:75 和 ADR 0004 只说"从环境变量读取"，这是合理的扩展，记录在 apps/server README 即可。
- `setSessionTitle`、`clearCredential`（packages/session/src/sqlite/repositories.ts:165-172、:347-355）没有协议入口，属于提前实现的仓库方法。目前没有危害，留给后续票使用。

---

## (c) 看起来已实现但可能有误

### F5 [judgement，安全] 代理对令牌交换入口的 404 拦截可以被百分号编码绕过（Hono 侧已验证）
- 依据：票 05 验收"代理对令牌交换入口返回 404"（05-desktop-shell.md:21）；ADR 0002:24 "renderer 不接触令牌与 cookie"。
- 现状：apps/desktop/src/main/app-protocol.ts:84 以原始 `url.pathname` 做 `Set.has` 精确比较；sidecar 的 Hono 在匹配路由前对路径做 `decodeURI`（node_modules/hono/dist/utils/url.js:94）。探针结果：`POST /api/auth/%65xchange` 命中 exchange 处理函数。如果 Chromium 把 `%65` 原样交给 protocol handler，renderer 就能带着 main 注入的 cookie 访问交换入口。我没有验证 Chromium 是否会先把它规范化为 `e`。实际影响有限：令牌只能使用一次，main 已经先用掉，所以攻击只会得到 401。但"main-only 路由"的边界并不成立，后续新增的 main-only 路由会继承这个问题。
- 修复：在 `forwardToSidecar` 中先 `decodeURI(url.pathname)` 再判断（解码失败返回 400），或者对 `/api/auth/` 前缀整体返回 404。在 app-protocol.test.ts 中加入 `%65xchange` 用例。可选的纵深防御：sidecar 对已带有效 cookie 的请求拒绝交换。

### F8 [judgement] 用户故事 14 的"重试"会在对话记录中追加一条重复的用户消息
- 规格：spec.md:30 用户故事 14 "可重试"。
- 现状：重试调用 `submit(sessionId, text)`（renderer/stores/chat-store.ts:233-237），服务端 `runtime.run(text)` 会再提交一个 user 条目。pi-ai 的 transform-messages 会跳过出错的 assistant 消息（node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:172-178），所以模型看到的上下文中，同一条用户请求连续出现两次。E2E 把这一行为固定了下来：chat.e2e.test.ts:166 断言有 2 条"你"的消息。历史中也会保留两条相同的用户消息。
- 修复（二选一，写入规格）：(1) 新增 `POST /api/sessions/:id/retry`，runtime 用 `agent.continue()` 从最后一条用户消息续跑，不追加新的 user 条目，界面把新回复接在原消息下；(2) 保留现状，但在规格 / ui 约定中写明"重试等于重新发送"，并在 timeline 中把重复的用户消息折叠显示。

### F9 [judgement] SQLite 打开序列在获取租约之前就可能隔离（改名）数据库
- 规格：ADR 0003:26 "sidecar 在库内以事务获取宿主租约。打开时执行完整性快速检查，失败则隔离原文件"；spec.md:62。
- 现状：packages/session/src/sqlite/open.ts:55 的 `checkIntegrity`（失败时改名，:138-151）在 `acquireLease`（:70）之前执行。Electron 单实例锁只覆盖同一 userData 的桌面进程，不覆盖独立运行的 sidecar（spec.md:75）或测试进程。如果第二个进程打开一个正被持有的库，并且 quick_check 报告问题（例如读到被截断的 WAL），它会把正在使用的库文件移走，而不是报 `lease-held`。
- 修复：先只读查询 `host_lease`（表可能不存在时跳过）。持有者存活且心跳未超时时，直接报 `lease-held`，不做 quick_check 和隔离；否则维持现有顺序。在 sqlite.test.ts 中加入"持有者存活 + 损坏 → lease-held，文件未被改名"的用例。

---

## 已核对且符合规格的要点（不再展开）

- ADR 0002：32 字节令牌，一次性交换；HMAC cookie 绑定 authority，HttpOnly + SameSite=Strict；信任围栏（403）先于 cookie（401），WebSocket 升级同样经过中间件；代理剥离 set-cookie，替换 Origin、Cookie、Sec-Fetch-Site；非主窗口的升级被取消（apps/server/src/http/auth.ts、app.ts:58-89、apps/desktop/src/main/websocket-headers.ts）。集成测试 12/12 通过。
- ADR 0004：只在 main 中加解密，safeStorage 不可用时返回 `encryption-unavailable`，不回退明文；hint 由 main 计算；库中只有密文；模型错误文本入库前脱敏（apps/desktop/src/main/credentials.ts、apps/server/src/application/sessions.ts:52-60）。
- ADR 0003 / spec.md:62：0600 文件、WAL、synchronous=FULL、外键、busy timeout、STRICT 表、逐步迁移且与 user_version 同事务、有数据时先 VACUUM INTO 备份、版本过高拒绝、租约与写入时的租约校验。
- 生命周期：分级退出 shutdown → 10s → SIGTERM → 5s → SIGKILL（apps/desktop/src/main/sidecar-process.ts:19-25）；inspect-quit 2s 确认；关闭时先中断 Run 并提交 run_end，再关闭存储（apps/server/src/runtime/layers.ts:97-119、:176-188）。
- 订阅：先挂监听并缓冲，再补发 afterSeq 之后的条目，最后冲刷缓冲，按 seq 去重（apps/server/src/ws/connection.ts:47-76）。
- agent：message_end 的提交被 await，提交后才执行工具；注册表对未声明的重名报错，override 要求契约不变；截断为 2000 行 / 50KB；grep 使用纯 JS + ignore；ripgrep 运行同一组契约测试；模型按 provider 子路径导入。
- preload 只暴露 boot、pickDirectory、setCredential、log；IPC 校验主窗口主框架与 coko-app 来源。
- Fuses：RunAsNode 开，NodeOptions 和 CLI inspect 关，asar 完整性校验开；extraResource 包含 sidecar 与 ripgrep。
- spec.md:52：E2E 的 globalSetup 和 harness 显式删除 ELECTRON_RUN_AS_NODE；`electron-forge start` 依赖 Forge 自身的删除行为（@electron-forge/core dist/api/start.js:204），forge.config.ts:39 有注释说明。

## 未阅读或只抽样的部分

- 未读：packages/ui 的 theme.css、各 shadcn 组件、app-frame 实现、style-guard 及其测试；packages/i18n 的字典正文；packages/agent 内置工具的细节（bash.ts、edit-diff.ts、read.ts、find/ls/glob/walk、output-accumulator、truncate 的算法、local-exec 的进程组 kill）；packages/logging/file.ts（轮转）；apps/desktop/build/build.ts；renderer 的 settings-dialog、general-section、timeline-view、markdown.tsx；占位 sidecar 与 tests 的 fixture；scripts/check-docs 与 docs/ 的改动。
- 只抽样：各单元测试、Browser Mode 测试、E2E 正文（只读了用例名和 chat、harness、global-setup 的部分内容）；tests/integration 只运行了 sidecar-auth。
- 未运行：完整的 `pnpm run test`、desktop-e2e、package smoke。F5 中 Chromium 对 `%65` 的规范化行为没有在 Electron 中验证。

---

## 处理结果

2026-10-29，分支 `m1/10-review-fixes`（票 [10](issues/10-review-fixes.md)）。"先红"表示修复前已观察到用例按预期原因失败。

| 编号 | 处理 | 测试 |
| --- | --- | --- |
| F1 | 已修复，采用"重启 + 重新交换"：新增 `SidecarSupervisor`（apps/desktop/src/main/sidecar-supervisor.ts）。ready 之后意外退出时重启 sidecar、重新交换 cookie，期间代理返回 503；preload 新增 `onSidecarState` 事件，renderer 显示"重启中"，完成后连向新地址并以 afterSeq 补齐。一次故障最多连续重启 3 次，用尽后进入 failed（renderer 停止重连，覆盖层标题为"多次重启失败"），并弹出一次错误对话框。首次启动失败不重启。对话框增加"打开日志文件夹"，detail 先给本地化说明、后给技术信息。renderer 失败覆盖层也提供同一入口（preload 新增 `openLogs`，主框架校验与其他 IPC 一致）。sidecar 的 stderr 尾部经 `redactText` 写入 desktop.jsonl（`sidecar diagnostic { stderrTail }`）。规格写入 desktop-delivery.md 与 ADR 0002 | sidecar-supervisor.test.ts 4 例（先红）：重启并换新 cookie 后能通过新 sidecar 认证、连续失败进入 failed 且 spawn 次数为 1 + 上限、启动失败不重启、stop 打断重启。desktop-shell.e2e：fatal 对话框含"打开日志文件夹"且选择后 `shell.openPath(logs)`，覆盖层按钮同样打开，desktop.jsonl 中 stderr 的 `sk-…` 已脱敏；真实 sidecar 被 SIGKILL 后经 restarting 回到 connected、pid 改变、数据仍在、能完成一次对话，日志有 exited / restarting / restarted；重启连续失败时 renderer 停在 failed、对话框只弹一次、共 spawn 4 次且全部退出 |
| F2 | 已修复：app.tsx 的全局 keydown 加入 ⌘N / Ctrl+N（跳过 isComposing；没有 Workspace 时走添加 Workspace，否则开始草稿并聚焦 composer）。Run 进行中时 Escape 在任意焦点下都能停止，但事件已被处理（`defaultPrevented`：composer、Radix 对话框或菜单），或页面上有 dialog / menu 时不停止，此时 Escape 只关闭对话框 | app.browser.test.tsx"键盘"3 例（先红）：⌘N 聚焦输入区、输入区之外的 Escape 停止、对话框打开时 Escape 只关对话框且下一次 Escape 才停止。chat.e2e 在真实 Electron 中验证 Escape 与 Meta+N |
| F3 | 已修复：agent 每个 Run 的最后一个事件是 `progress run_end { status, error? }`，在 run_end 条目提交后发出，提交失败时也发出；protocol 增加该事件，server 脱敏 error.message。renderer 收到后结束运行中状态；没有对应 run_end 条目时显示只由进度得知的结束状态（错误不提供重试） | runtime.test.ts（先红）：run_end 提交失败仍发出 progress；sidecar-session.test.ts：bash 用 sqlite3 夺走租约后，客户端收到 `run_end … commit_failed`、没有 run_end 条目；chat-store.test.ts 2 例（先红） |
| F4 | 不修复：judgement 覆盖缺口。本次 Browser Mode 新增了 rail 搜索按钮展开抽屉的用例，窄窗口下的发送仍未在 E2E 中断言 | — |
| F5 | 已修复：protocol 新增 `normalizeRoutePath` / `isMainOnlyPath`（反复解码至多 3 次、合并重复斜杠、去掉末尾斜杠、转小写，解码失败视为命中）。代理先按规范化路径分流，无法解码时返回 400，`/api/auth` 前缀一律 404；sidecar 增加中间件，交换入口只接受原样路径、POST、不带 cookie（renderer 经代理的请求总带 main 注入的 cookie），其余形态 404 且不消耗令牌 | app-protocol.test.ts 10 种编码变体 + 无法解码（先红），断言不到达 sidecar；sidecar-auth.test.ts 5 种变体与带 cookie 的交换（先红），断言令牌仍可用 |
| F6 | 已修复（按标题过滤，不隐藏按钮）：侧栏的搜索按钮切换为搜索框，按标题过滤会话、不区分大小写，没有命中的工作区隐藏，无结果时说明，Escape 清除并关闭；rail 的搜索按钮展开侧栏（窄窗口下为抽屉）并聚焦搜索框。抽屉打开时若内容已经聚焦，就不再抢焦点（app-frame） | app.browser.test.tsx"侧栏搜索"2 例（先红）；ui-browser 的 app-frame 用例回归通过 |
| F7 | 已修复：apps/server README 与 spec 的协议一节登记 provider-presets、models、WS unsubscribe、`COKO_CREDENTIAL_<PROVIDER_ID>`，以及本次新增的 retry 路由与 run_end progress | check:docs 0 问题 |
| F8 | 已修复，采用方案 (1)：新增 `POST /api/sessions/:id/retry`，runtime 的 `retry()` 去掉末尾出错的 assistant 消息（入库记录保留），再 `agent.continue()` 重新执行上一轮，不追加用户条目；上一轮没有以模型错误结束时 409 `nothing-to-retry`。renderer 的重试改为调用该接口，timeline 的 `retryText` 改为 `retryable`。票 07 Comments 已说明行为变更 | runtime.test.ts 2 例（先红）：模型上下文中用户请求只出现一次、从已提交条目恢复后也能重试；sidecar-session.test.ts：条目序列为 user, assistant, run_end, assistant, run_end；chat-store.test.ts（先红）；chat.e2e 断言改为只有 1 条"你" |
| F9 | 已修复，同 review-standards A6 | 同 A6 |
