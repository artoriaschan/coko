# deepseek-harness 桌面端的进程、存储与 UI 结构

研究票：[02](../issues/02-research-dsh-desktop-architecture.md)。源码基线：deepseek-harness `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`（2026-10-28）。只读取了源码与仓库内文档，没有运行 DSH。

路径简写：`DSH/` = `/Users/chenzheng/Desktop/Work/open_sources/deepseek-harness/`，`PKG/` = `DSH/packages/`，`CLI/` = `DSH/packages/client/`。

## 结论摘要

1. 进程模型与 Coko [ADR 0001](../../../docs/adr/0001-sidecar-on-electron-node.md) 一致：main 以 `ELECTRON_RUN_AS_NODE=1` spawn 自身可执行文件，经 Node IPC（`stdio[3]='ipc'`）收 `starting → ready{url}`；退出分四级：`shutdown` 消息 10s → SIGTERM 5s → SIGKILL 5s → 抛错。退出前先经 IPC 询问是否有活动任务，2s 超时按“有任务”处理并弹确认框。整套逻辑可以直接移植到 Coko main。
2. 认证：Host 只把带 launch token 的 URL 交给 main；main 用 `fetch(redirect:'manual')` 换取 303 + `Set-Cookie`，cookie 只留在 main。HTTP 经 `protocol.handle('dsh-app')` 转发并注入 cookie；WebSocket 不走自定义协议，renderer 直连 `ws://127.0.0.1:<port>`，由 `webRequest.onBeforeSendHeaders` 只对主窗口改写 `origin/cookie/sec-fetch-site`。这与 Coko [ADR 0002](../../../docs/adr/0002-local-service-access-auth.md) 基本吻合，差异是 DSH 的签名密钥持久化在 `$DSH_HOME/.credentials.yaml`，cookie 有效期 30 天；Coko 规定密钥只存在于 sidecar 内存，这一点保持 Coko 约定。
3. 存储：DSH 没有把会话或设置放进 SQLite。会话使用 append-only JSONL（默认 zstd 帧），每个格式版本一个不可变 generation 文件，写入流程为 temp+fsync+`link()` 发布+目录 fsync，写者互斥靠 flock；设置写回 Cordis profile YAML patch，用 revision 做乐观并发；KV 默认使用 JSON 文件原子替换。
4. DSH 中的 SQLite 只有两处：可选的 KV 后端 `storage-sqlite`（`node:sqlite` `DatabaseSync`、WAL、STRICT、`user_version=1`、不迁移，版本不符直接拒绝），以及派生的 FTS5 会话搜索索引（默认 `openAt: never`）。issue 05 想要“设置与会话进 SQLite”，在 DSH 中找不到可以照搬的先例，需要自行设计；可复用的是它的打开序列、事务和 rollback 失败隔离写法。
5. Renderer 是插件化 Web 应用：`apps/web` 只是入口，UI 分散在约 60 个 `packages/client/ui-*` 插件里，通过具名 slot 组合；样式用 CSS Modules + `--dsw-*` 变量，状态用自有 observable store + Immer，没有用 Tailwind、shadcn 或 Zustand。可以移植的是信息架构、几何与交互规则，组件代码不能直接搬。
6. 信息架构骨架：三栏 AppFrame。侧栏 264–420px，默认 280px，收起后保留 56px rail，视口 <1024px 时自动收起；中栏最小 400px；右栏首开 45%，最大 70%，最小 300px。Composer 上方 dock 依次是 Todo → Goal → Queue；审批卡和用户提问卡会临时接管 composer；Plan 用 chip 加右栏审阅；设置是 modal，左侧导航按 order 排列：Account(-10)/General(0)/Models(10)/Plugins(15)/Agent presets(20)。
7. Coko 设计系统规格已覆盖圆角、发丝线、材质与菜单规则。缺口在于：颜色的实际数值（DSH 的主按钮是近黑色，蓝色只用于 link、focus 和业务状态）、字号阶梯（11/12/13/14/16/20/24，Markdown 正文 14/24 并可调）、elevation 阴影精确值、动效时长 0.1/0.2/0.3s 加 `cubic-bezier(0.4,0,0.2,1)`、2px focus ring、布局几何与 macOS 窗口参数。§4 给出这些数值。
8. 需要决定的移植点：① WebSocket 端口要由 preload 的 boot IPC 交给 renderer，DSH 用 `streamBaseUrl` 实现；② DSH 的 flock 依赖原生 addon，Coko 改用 `node:sqlite` 写者互斥（已有约定）；③ Toast 组件选型，shadcn 当前推荐 Sonner，但 Coko 技术栈未登记；④ Tailwind 中 `--shadow-*` 引用可重绑的描边色时，必须写在 `@theme inline` 里。
9. 不移植：Cordis 插件、slot 运行时、HMR 插件图、electron-builder/electron-updater、DeepSeek 账号与 Platform view、强制更新与 policy 登录。
10. 未验证：DSH 实际运行行为，以及 Electron 41 内置 `node:sqlite` 是否启用 FTS5。

## 1. 桌面进程：main / host-process / node-environment / web-document

### 1.1 文件职责

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `DSH/apps/desktop/src/main.ts` | 1458 | 协议注册、窗口、BackendController 装配、IPC、WS 头注入、退出编排 |
| `DSH/apps/desktop/src/host-process.ts` | 382 | `DesktopHostProcess`：spawn、IPC 事件校验、控制请求、分级 stop |
| `DSH/apps/desktop/src/node-environment.ts` | 18 | `desktopNodeEnvironment()`：设置 `ELECTRON_RUN_AS_NODE=1`，并可选把私有 node 启动器放到 PATH 前 |
| `DSH/apps/desktop/src/web-document.ts` | 93 | `serveWebDocument` / `authenticateWebHost` / `forwardWebRequest` |
| `DSH/apps/desktop/src/backend-controller.ts` | 157 | 与窗口无关的 starting/ready/error 状态机，串行化重试 |
| `DSH/apps/desktop/src/quit-confirmation.ts` | 96 | 退出前询问任务，弹原生确认框 |
| `DSH/apps/desktop/src/ipc.ts` / `preload-app.ts` | 111 / 119 | IPC 通道常量、来源断言、contextBridge API |
| `DSH/apps/desktop-host/src/index.ts` | 158 | sidecar 入口：启动 Web 应用、上报 ready、处理控制消息与 shutdown |

### 1.2 Sidecar 启动

```ts
// DSH/apps/desktop/src/host-process.ts:209-224
spawn(process.execPath /* Electron */, ['--expose-internals', ...inspect, entry, runtimeDir, projectDir, primaryRuntime, ...pnpm], {
  cwd: projectDir,
  env: desktopNodeEnvironment(node, undefined, env), // { ...env, ELECTRON_RUN_AS_NODE: '1' }  node-environment.ts:12-17
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
```

- stderr 保留在 64 KiB 环形缓冲里，只在 `close` 时拼进错误信息；stdout 透传到 main 的 stdout（`host-process.ts:61,226-228,261-268`）。
- 开发态可通过 `DSH_DESKTOP_HOST_INSPECT_PORT` 加上 `--inspect=127.0.0.1:<port>`（`main.ts:223-231`）。
- Host 以 `--host 127.0.0.1 --port 0` 启动，用实际端口拼出 ready URL（`DSH/apps/desktop-host/src/index.ts:36,142-143`）。

### 1.3 IPC 协议（Node IPC，结构化克隆）

| 方向 | `type` | 载荷 | 来源 |
| --- | --- | --- | --- |
| host→main | `starting` | `runId: uuid` | `host-process.ts:28-31`；`desktop-host/src/index.ts:24` |
| host→main | `ready` | `url`（带 `?token=`）、`injections` | `host-process.ts:10-14,247`；`index.ts:142-143` |
| host→main | `fatal` | `message`、`diagnostic`（完整 inspect） | `host-process.ts:16-21`；`index.ts:146-157` |
| host→main | `shutdown-complete` | 无 | `index.ts:66` |
| host→main | `update-tasks` / `quit-inspection` / `file-drag-resource` | `requestId` + 结果或 `error` | `host-process.ts:36-47` |
| main→host | `shutdown` | 无 | `host-process.ts:352` |
| main→host | `quit-inspection` / `update-tasks{action}` / `file-drag-resource{address}` / `file-drag-cancel` | `requestId` | `host-process.ts:308-339` |

- 每条消息先经过 `isDesktopHostEvent()` 手写类型守卫（`host-process.ts:64-111`）。校验不通过就 `fail()` 并对子进程发 SIGTERM（`:241-245`），即把非法消息视为 Host 已不可信。
- 控制请求使用自增 `requestId`，用 `Map` 关联响应，每个请求有独立 deadline，可以用 AbortSignal 取消（`:308-339`）。Host 回答失败时也给出保守值，例如 `activeTasks: true`（`index.ts:108-112`）。
- 首个意外失败只上报一次；`fail()` 同时 reject ready 和所有挂起的控制请求（`:369-381`）。

### 1.4 就绪与 renderer 启动握手

1. `DesktopBackendController.start(prepare)`：并发调用共享同一次 attempt；`stop()` 可以取消正在进行的 prepare 或 spawn；ready 之后子进程失败转成 `error` 状态并清理（`backend-controller.ts:60-148`）。
2. main 收到 ready 后先 `authenticateWebHost(url)` 拿到 cookie，再保存 `hostUrl` 与 `injections`（`main.ts:529-534`）。
3. `serveWebDocument` 在 index.html 的 `<head>` 里注入 `globalThis.__DSH_BOOT_READY__ = Promise.withResolvers()`（`web-document.ts:10,31-32`）。
4. preload 暴露 `dshDesktopBoot.ready()`，对应 `ipcMain.handle(DESKTOP_IPC.boot)`：先 `await startup`，再返回 `{ injections, streamBaseUrl: new URL(hostUrl).origin }`（`preload-app.ts:97-100`；`main.ts:785-790`）。
5. renderer 把 `streamBaseUrl` 写入 `__DSH_TRANSPORT__`，WebSocket 据此直连 Host；启动失败经 `dshDesktopBoot.failed()` 回报 main（`DSH/apps/web/src/main.ts:11-39`；`CLI/connection/src/client/index.ts:273`）。

Coko 没有插件 injections，boot IPC 只需返回 `streamBaseUrl`（或端口）。Coko 架构约定里尚未写明“renderer 如何得知 WS 端口”，这个机制可以照搬。

### 1.5 分级退出

| 阶段 | 行为 | 来源 |
| --- | --- | --- |
| `before-quit` | 默认 `preventDefault()`；安装更新流程和会话结束（powerMonitor `shutdown`）跳过确认 | `main.ts:1342,1366-1388` |
| 确认 | `DesktopQuitConfirmation.confirm()`：Host 未就绪时直接退出；通过 IPC 调 `inspectQuit()`，**2s** 截止（`QUIT_INSPECTION_DEADLINE_MS`），超时或出错按 `'unknown'` 处理，文案选“有活动任务”；有任务或定时任务时弹原生 MessageBox（退出/取消）；重复请求合并为同一次决定 | `quit-confirmation.ts:15-95`；`host-process.ts:59,289-293` |
| `finishQuit` | 隐藏窗口，dispose 托盘、更新等资源；`backend.close()` 与日志 drain(500ms) 并行，完成后再调用 `app.quit()` | `main.ts:1343-1365` |
| `host.stop()` | 发 `shutdown` → 等 **10s** → SIGTERM → 等 **5s** → SIGKILL → 等 **5s** → 抛错；`requireGraceful` 时非 0 退出码或未 ack 抛 `DesktopHostUncleanExitError`（用于更新交接） | `host-process.ts:347-367` |
| Host 侧 | `stop()`：abort 在途读取 → `application.shutdown(0)` → 发 `shutdown-complete` → `disconnect` → `process.exit()`；父进程断开（`disconnect`）同样触发 stop | `desktop-host/src/index.ts:60-71,129` |

Coko 映射：Host 侧的 `application.shutdown` 对应 server 的 Effect `ManagedRuntime.dispose()`；“有活动任务”的查询对应 agent 的 Run/Goal/Job 状态。

### 1.6 自定义协议、cookie 与 WebSocket 头注入

```ts
// main.ts:184-194（app ready 之前）
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])
```

| 请求 | 处理 | 来源 |
| --- | --- | --- |
| `dsh-app://shell/*` | 从 app bundle 读壳自有页面（欢迎页、更新对话框） | `main.ts:764-765` |
| `dsh-app://app/`、`/index.html`、`/assets/*`、favicon、manifest | `serveWebDocument`：只允许 GET/HEAD，`resolve` 后必须位于 root 内（否则 403），index 注入 BOOT 脚本 | `main.ts:766-770`；`web-document.ts:18-36` |
| `dsh-app://app/<其他>` | Host 未就绪时 503；否则 `forwardWebRequest` | `main.ts:771-775` |
| 其他 host | 404 | `main.ts:776` |

- `authenticateWebHost(url)`：`fetch(url, {redirect:'manual'})`，要求返回 303 且带 `set-cookie`，只取 `name=value` 部分（`web-document.ts:43-50`）。
- `forwardWebRequest`：`Origin` 存在且不是 `dsh-app://app` 时返回 403；删除 `host/origin/cookie/sec-fetch-site` 后注入 cookie，用 `duplex:'half'` 流式转发并透传 `signal`；响应中剥离 `set-cookie` 和 hop-by-hop 头（`web-document.ts:58-93`）。
- WebSocket：`session.defaultSession.webRequest.onBeforeSendHeaders({urls:['ws://127.0.0.1/*','wss://127.0.0.1/*']})`。只处理主窗口的 `webContentsId`，host 和协议必须与 Host 一致；`origin` 不是 `dsh-app://app` 时 `cancel:true`；通过时改写为 `origin: <host origin>, cookie, 'sec-fetch-site': 'same-origin'`（`main.ts:810-821`）。
- Host 侧信任围栏：`Host` 必须是 loopback 或 bind IP；带 `Origin` 时必须同 authority；`sec-fetch-site: cross-site` 返回 403；之后校验 cookie，失败返回 401。launch token 只在 `GET /` 生效，拒绝 Authorization 头（`CLI/connection/README.md:41-47`；`CLI/connection/src/browser-auth.ts:244-305`）。
- cookie：`dsh-auth-<sha256(authority)>`，内容为 `v1.<payload>.<HMAC-SHA256>`，payload 是 `{authority, issuedAt, expiresAt}`；属性 `HttpOnly; SameSite=Strict; Path=/`（`browser-auth.ts:116-149,263-288`）。

与 Coko ADR 0002 的差异：

| 项 | DSH | Coko 约定 | 建议 |
| --- | --- | --- | --- |
| 签名密钥 | 持久化在 credentials 文件，跨重启复用（`browser-auth.ts:182-199`；README:43） | 只存在于 sidecar 内存，重启后全部失效 | 保持 Coko |
| cookie 有效期 | 默认 30 天 | 未定，随进程失效 | 保持 Coko，可不设 Max-Age |
| launch token | 每进程一个，可多次兑换 | 兑换成功后作废 | 保持 Coko，按 ADR 一次性 |
| 交换方式 | `GET /?token=` → 303 | 交换入口未定 | 采用 DSH 的 303 + `redirect:'manual'` |

### 1.7 窗口与 preload 安全面

- `BrowserWindow`：`nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true`；`setWindowOpenHandler` 只允许用 `shell.openExternal` 打开 http/https 链接，一律 `deny`（`main.ts:258-294`）。
- macOS：`titleBarStyle:'hiddenInset', trafficLightPosition:{x:16,y:18}, vibrancy:'sidebar', visualEffectState:'active', backgroundColor:'#00000000'`；窗口 1280×820，最小 520×600；最小化或隐藏时的 chrome 回退色为暗 `#1b1b1c`、亮 `#f9fafb`（`main.ts:240-242,259-280`）。
- `assertDesktopSender(event, ['app'])` 校验 `senderFrame.url` 的协议和 hostname；部分通道还要求是主窗口的 mainFrame（`ipc.ts:104-111`；`main.ts:792-797,823-828`）。
- preload 只在 `location.protocol==='dsh-app:' && hostname==='app'` 时暴露产品 API，iframe 拿不到（`preload-app.ts:73,112`）。

### 1.8 移植判断（进程层）

| 机制 | 判断 | 说明 |
| --- | --- | --- |
| spawn 参数与环境、stdio ipc、stderr 环形缓冲 | 直接移植 | 改为 Coko 的 sidecar 入口与 ripgrep 路径参数 |
| IPC 事件守卫 | 改写后移植 | 用 typebox 定义 discriminated union 并 `Value.Check`，替代手写守卫 |
| `DesktopBackendController` | 直接移植 | 纯 TS，不依赖 Effect，适合放在 main |
| 分级 stop 与退出确认 | 直接移植 | 10/5/5s 与 2s 截止可沿用，文案走 i18n |
| `protocol.handle` + forward + WS 头注入 | 直接移植 | scheme 改为 `coko-app`；按 ADR 0002 让 token 一次性、密钥只在内存 |
| BOOT 注入 + `boot` IPC | 简化后移植 | 只返回 `streamBaseUrl` |
| electron-builder / electron-updater（`DSH/apps/desktop/package.json` dependencies、`electron-builder.config.mjs`） | 不移植 | Coko 使用 Forge 与内置 `autoUpdater` |
| Platform view、强制更新、policy 登录、file-drag、office runtime、pnpm 包管理 | 不移植（首期） | DSH 产品专属 |

## 2. 设置与会话存储

### 2.1 总览

| 数据 | 介质 | 写入模型 | 来源 |
| --- | --- | --- | --- |
| 会话事件 | JSONL，默认 zstd 帧 | append + fsync，单写者 flock，显式 `flush` 为持久化屏障 | `PKG/session/session-persistence-jsonl/src/index.ts:62-69,1264-1463` |
| 设置 | Cordis profile `cordis.patch.yml` | `configEditor.edit()`；revision 不符时抛 `SettingsConflictError` | `PKG/settings/settings/src/index.ts:223-395`；`README.md:12,35` |
| Workspace、Schedule、projection cache 等 KV | storage-domain → backend `json` | 每个 domain 一条写链：先等后端持久化，再改内存，再发事件 | `PKG/bundle/base/cordis.patch.yml:175-200`；`PKG/storage/storage-domain/src/domain.ts:1-11` |
| KV（可选） | SQLite `storage-sqlite` | 单语句 upsert；批量或需要盖版本戳时用 `BEGIN IMMEDIATE` | `PKG/storage/storage-sqlite/src/*` |
| 会话全文搜索（派生） | SQLite FTS5 `session-query-sqlite` | 可重建索引；base 配置 `path: ':memory:', openAt: never` | `PKG/bundle/base/cordis.patch.yml:149-161`；`PKG/session-query/session-query-sqlite/src/schema.ts:103-169` |
| 浏览器 cookie 签名密钥 | `$DSH_HOME/.credentials.yaml` | credentials provider `modifyRecord` | `CLI/connection/README.md:43` |

### 2.2 会话 JSONL

- 布局：`<root>/<projectKey(cwd)|_no-cwd>/<encodeSegment(id)>/<generation 文件名>[.zstd]`。v0 文件名只有后缀，之后每个版本带 `vN`（`format.ts:42-60,254-305`）。
- 首次写（materialize）：逐级 `mkdir 0o700` 并 fsync 父目录；`open(tmp,'wx',0o600)` 写入后 fsync；`link(tmp, final)` 发布（用 link 而不用 rename，以免覆盖已有日志）；再 fsync 会话目录，最后尽力删除 tmp（`index.ts:1264-1371`）。zstd 模式下第一帧只含 header 这一行（`:77-81,1374-1394`）。
- 追加：`open(path,'a')` → 记录 `stat().size` → `writeFile` → `sync()`；写入或 sync 失败时 `truncate(before)` 再 sync，避免重试后出现重复 seq（`index.ts:1408-1451`）。
- 崩溃尾修复：`truncate(offset)` 加 fsync（`:1453-1463`）。读取时绝不返回撕裂的尾部（`PKG/session/session-persistence/src/handle.ts:73-83`）。
- 写者互斥：`session.lock` 上的非阻塞 `flock(2)`（原生 addon `@deepseek-ai/node-addon-system/flock`），Windows 用命名信号量；加锁后校验 inode，不设过期，持有进程退出时由内核释放（`lease.ts:1-28,34`）。
- API：

```ts
// PKG/session/session-persistence/src/handle.ts:59-116
interface SessionHandle extends AsyncDisposable {
  readonly id; readonly header; readonly inheritedEventCount; readonly access: 'read' | 'write'
  read(offset?: number, length?: number, o?: { signal? }): Promise<{ eventState; events }>
  append(events: readonly SessionEvent[], o?): Promise<void>  // 首个 seq 必须等于 next-seq；不保证持久化
  flush(o?): Promise<void>                                     // 唯一的持久化屏障
  close(): Promise<void>                                       // 幂等，不可取消
}
```

- 提交时机：`session-checkpoint-policy` 在模型请求前、顶层工具产生外部副作用前、下一个 agent step 开始前调用 `ctx.sessions.flush`，失败时阻止执行（fail-closed）；中断的工具调用恢复为“结果未知”，不自动重跑（`PKG/session/session-checkpoint-policy/README.md` Summary；`src/index.ts:35,72,80`）。
- 迁移：`defineSessionFormatMigration` 只允许相邻版本（`to === from + 1`），按 v0→v1→…→v4 链式执行（`PKG/session/session-format/src/chain.ts:24-30`；目录 `session-format-v*-to-v*`）；结果发布为新的不可变 generation 文件（`generation.ts:1-8`）。

### 2.3 设置

- `SettingsForms`（`static inject = ['configEditor','profileContext']`）为每个 profile entry 维护 `revision`，原始文本变化时 +1；`update(ns, patch, expectedRevision)` 不一致时抛 `SettingsConflictError(ns, expected, actual)`（`PKG/settings/settings/src/index.ts:45-59,223-317,348-395`）。
- 只有声明为 `.volatile()` 的字段可被表单编辑；secret 字段只回传“存在”标记（`README.md:12,47-49`；`src/redact.ts`）。
- 浏览器侧 `ui-settings` 提供按 namespace 的读写、`mutate` 原子操作列表、带 revision 的 staged 编辑，冲突时保留草稿（`CLI/ui-settings/README.md` “Configuration forms”）。
- 移植判断：Cordis/YAML 机制不移植；revision 冲突语义、secret 只回传存在标记、staged 保存这三条可以写进 Coko 的设置协议。

### 2.4 storage-domain 与 SQLite 后端

```ts
// PKG/storage/storage-domain/src/spec.ts:35-72
interface DomainSpec { name; version; layout?: 'single'|'per-record'; compatibleVersions?: number[];
  invalidRecords?: 'backup-and-skip'; global?: { schema: ZodType; initial }; tables: Record<string, { valueSchema }> }
// 示例：workspace v2 = global{initialized, workspaceIds[], archivedSessionIds[], pinnedSessionIds[], pendingMutation?}
//      + tables.workspaces{path, title, sessionIds[], createdAt, updatedAt}  PKG/workspace/workspace/src/spec.ts:24-84
```

- `pendingMutation` 是两步写入的恢复标记：先持久化标记，再写 record 和 order，启动时据此区分“操作被中断”与“介质损坏”（`workspace/src/spec.ts:35-43`）。
- JSON 后端：`open(tmp,'wx',0o600)` → 写入 → fsync → `rename` → fsync 父目录。每个单元只有一个写者，last-write-wins（`PKG/storage/storage-json/src/atomic.ts:1-57`）。
- SQLite 后端：

```sql
-- PKG/storage/storage-sqlite/src/schema.ts:76-118 / index.ts:116-124
PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;        -- 可选 delete/truncate/persist；禁止 memory/off
-- PRAGMA user_version：0 → 建表后最后再打 1；其他值抛 version-mismatch（不做迁移）
CREATE TABLE IF NOT EXISTS units (name TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS unit_globals (unit TEXT PRIMARY KEY REFERENCES units(name), value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS "u_<unit>_<table>" (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;  -- value 为 JSON
```

- 文件与目录分别以 `0o600` / `0o700` 预先创建（`schema.ts:42-74`）；名称先用 `UNIT_NAME_RE` 校验，再插入 DDL（`index.ts:83-90`）。
- 写入：`INSERT … ON CONFLICT(key) DO UPDATE`。批量删除或需要首次盖版本戳时用 `BEGIN IMMEDIATE … COMMIT`；`ROLLBACK` 本身失败时整个后端进入 `unknown-state`，此后所有操作 reject，必须关闭重开（`unit.ts:146-176`；`index.ts:51-56`）。
- 同步的 `DatabaseSync` 调用包装成 Promise，同步 throw 转为 reject（`unit.ts:190-199`）。
- FTS 索引：`persisted_sessions`（STRICT）+ `persisted_docs USING fts5(text, session_id UNINDEXED, seq UNINDEXED, type UNINDEXED, time UNINDEXED, surface UNINDEXED, codepoint_length UNINDEXED, tokenize='unicode61')`，另有 `temp.live_*` 镜像正在运行的会话；`PRAGMA application_id` 标识数据库身份（`session-query-sqlite/src/schema.ts:103-169`）。

### 2.5 移植判断（存储）

| 机制 | 判断 | 说明 |
| --- | --- | --- |
| JSONL 的 tmp + fsync + link 发布、追加失败时 truncate 回滚、尾部修复 | 直接移植 | 符合 Coko 现有 JSONL 约定 |
| flock 租约 | 替换 | 改用 Coko 已选的 `node:sqlite` 单写者互斥，不引入原生 addon |
| `append`/`flush` 分离与 checkpoint 时机 | 直接移植语义 | 放入 Coko `SessionRepository`，“提交屏障”定义为 flush |
| 相邻版本迁移链 + 不可变 generation | 直接移植 | 对应 session 的“存储格式迁移” |
| storage-sqlite 打开序列（权限、WAL、`user_version` 最后打、STRICT、`BEGIN IMMEDIATE`、rollback 失败隔离） | 作为 issue 05 的起点 | DSH 不做迁移；Coko 若把会话放进 SQLite，需要补迁移表与逐版本迁移 |
| KV-of-JSON 表结构 | 不适合会话 | 无法按 seq 或类型查询，也没有列约束；会话进 SQLite 时要设计专用的 sessions/events 表 |
| storage-domain（zod）声明式 domain | 改写 | 换成 typebox；“先持久化、再改内存、再发事件”的写链可以沿用 |
| FTS5 搜索 | 可选 | 先确认 Electron 41 的 `node:sqlite` 是否编译了 FTS5（未验证） |

## 3. Renderer 信息架构

### 3.1 组织方式

- `DSH/apps/web/src/main.ts:1-40`：引入品牌字体后创建 `AppWebEntry`，桌面态先等待 boot 握手。
- UI 是约 60 个 Cordis 客户端插件（`DSH/packages/client/ui-*`），按 `ctx.slots.register({ name, id?, order?, key? }, Component)` 注入具名 slot（例如 `CLI/ui-settings-general/src/client/index.ts:249-256`）。
- 状态：`dsh-client-store`，与 React 无关的 observable 加 Immer；React hook 由 ui-renderer 提供（`CLI/store/README.md` Summary）。
- 传输：`ctx.connection` RPC 走 HTTP，`openWebSocket(path)` 走 `streamBaseUrl`（`CLI/connection/src/client/index.ts:169,273`）。
- 对 Coko 的映射：slot 改为 feature 内的固定组合；store 换成 Zustand vanilla + `useSyncExternalStore`；CSS Modules 换成 Tailwind 工具类。

### 3.2 三栏 AppFrame 几何

| 参数 | 值 | 来源 |
| --- | --- | --- |
| 侧栏宽 | 264–420px，默认 280px；收起后 rail 56px；视口 <1024px 自动收起；打开右栏时收起手动展开的侧栏 | `CLI/ui-layout/README.md:30`；`src/client/columns.ts:11-29` |
| 中栏最小 | 400px | `columns.ts:11` |
| 右栏 | 首开 45% 视口，之后记住像素值，上限 70%，最小 300px；空间不足时先缩到 300，再通知占用者关闭，最后才压缩中栏 | README:30；`columns.ts:25-57` |
| grid 写法 | `${sidebar}px minmax(${CENTER_MIN}px,1fr) minmax(0px,${rightMax}px)`，列宽过渡 0.3s，拖动时不加过渡 | `AppFrame.tsx:266`；`AppFrame.module.css:16-19` |
| 顶部安全区 | `--dsh-frame-top-clearance: 48px`；浮层额外 +20px；全屏时浮层 inset 降为 20px；对话框至少保留 24px 视口边距 | README:39-43；`AppFrame.module.css:89-107` |
| macOS 收起侧栏 | 隐藏整列（不保留 rail），在红绿灯旁挂 `shell.leading`（重新打开、新会话），并发布 `--dsh-frame-leading-clearance` | README:39；`AppFrame.module.css:179-188` |
| 拖拽区 | 每个 chrome 行自行标记 `data-window-drag`，空白处可拖，控件可点 | README:39 |
| 聊天宽度轴 | `clamp(680px, 列宽×0.64, 920px)`；composer 卡片宽度 = 该值 +32px，两侧 16px | `CLI/ui-conversation/src/client/skeleton/ConversationRoot.module.css:452-462` |
| 底部 / 覆盖 slot | `shell.bottom` 横跨三栏，高度由内容决定；`shell.overlay` 覆盖整个 frame | README:34 |

### 3.3 区域与内容

| 区域 | 内容与关键规则 | 来源 |
| --- | --- | --- |
| 侧栏顶 | 品牌行（Web/Windows 上点击即新建会话）；New Session 目标 Workspace 的优先级：显式指定 > 当前会话所属 > 最近活跃；快捷键灰字在 hover 或 focus 时显示 | `CLI/ui-sidebar/README.md:28-34` |
| 侧栏全局面板 | `sidebar.panellist`（Plugins、Automation 等），条目带 `id/order/label` | 同上 “Global panel entries” |
| 项目/工作区与会话列表 | Workspace 分组或平铺；每组默认显示 5 行，运行中、子会话运行中、等待用户、未读完成或当前打开的会话会抬高显示上限（只看前 50 行），“Show more” 每次 +5；置顶会话排在最前；排序可选 Last updated（最近 prompt/steer 时间）或 Manual；支持重命名、分叉、归档、删除 Workspace；无标题显示“未命名” | `CLI/ui-workspace/README.md:28-40` |
| 侧栏底 | Settings 入口；断线时显示黄色 Disconnected/Reconnecting，恢复后绿色 Connected 2s；重连至少显示 800ms | `CLI/ui-settings-general/README.md:30` |
| 新会话 hero | Workspace 选择器（同名时显示最短可区分路径）、Agent preset | `ui-workspace` README:28；slot `conversation.hero.*` |
| 会话头 | 标题、lineage（子代理）、View tabs（Chat/Trajectory，单个 tab 88px，放不下进 More）、动作区（Open in App、Jobs、Schedule、右栏开关） | `CLI/ui-conversation/README.md` “Shell and standard props” |
| 聊天流 | Session 事件经 assembler 变成 Conversation Node；reasoning 与已完成 turn 的过程可折叠（Verbose 模式保留）；turn footer 显示 token 用量；本地提交立即显示，权威记录到达后整体替换 | `CLI/ui-chat/README.md` Summary/目录 |
| 工具卡 | 按 wire tool 名注册 view（`tool.call.toolview`）；调用树含子调用；read/write/edit 显示可打开的路径与 `NKB`；命令非 0 退出时显示红点胶囊；未知工具显示 `Tool call · <name>` | `CLI/ui-tool/README.md:26-45` |
| 输出原语 | `TerminalBlock/ReadBlock/DiffBlock/SearchBlock/WebBlock` | `CLI/ui-primitives/README.md:80` |
| Turn 尾 | 改动文件卡（行数统计，点击打开 review tab）、交付文件卡、Plan 卡 | `CLI/ui-deliverables/README.md` Summary；`ui-plan` README:35 |
| Composer dock | `conversation.input.dock` 列表：Todo（order 0）→ Goal → Queue，均为 panel elevation | `CLI/ui-conversation/src/client/skeleton/TodoPanel.tsx:116-117`；`CLI/ui-goal/README.md:28` |
| 审批卡 | 接管 composer；按钮为 reject / allow / 可选 always-allow（有 always-allow 时它是主按钮）；焦点在详情区时 Enter 只授权本次，Esc 拒绝；同一请求只能回答一次 | `CLI/ui-approval/README.md` |
| 用户提问卡 | 接管 composer；分页；推荐项预选；倒计时在聚焦时暂停；可跳过 | `CLI/ui-user-questions/README.md` Summary/Use |
| Plan | `/plan` 或 `+` 菜单进入；composer 出现蓝色 Plan chip，hover 变成 × 用于退出；提交的计划自动在右栏打开一次，由审阅按钮决定是否开始实施 | `CLI/ui-plan/README.md:26-40` |
| Goal | dock 卡片：armed 时可暂停，其他状态可恢复；支持编辑（InlineEditor）和清除；`/goal` 显示为右对齐的“指令输入”气泡 | `CLI/ui-goal/README.md:26-34` |
| Composer 底栏 | `+` 菜单（File、Plan、命令）、权限预设、Plan chip、模型选择（provider 分组，可下钻 reasoning effort，最宽 360px，空间不足时只显示图标）、上下文环形百分比 | `CLI/ui-model-selection/README.md:28-34`；`ui-conversation` README “Shell…”；`InputBar.module.css:318-368` |
| `@` / `/` | 光标处触发分组菜单：命令、文件、会话；焦点留在编辑器，`aria-activedescendant` 高亮，Tab 下钻或确认，Esc 或 Shift+Tab 离开且不改动草稿；被关闭后同一 token 不再弹出 | `CLI/ui-input-trigger/README.md:26-38`；`ui-reference`；`ui-commands` |
| 右栏 | 每个会话一个 dock 面（ui-dockkit 分屏 tabs）：文件树、文档预览、终端、浏览器（桌面版用 `<webview>`）、Plan、Trajectory | `CLI/ui-sidebar-right`、`ui-dockkit`、`ui-sidebar-*` README |
| 设置 | Modal，左侧导航来自 `settings.section`：Account(-10，仅登录后)、General(0)、Models(10)、Plugins(15，子 tab：Agent loop/Shell/Subagent/Web search/Plugin list)、Agent presets(20)；`SettingsForm` 先暂存修改，点保存才写入；<768px 时全屏 | `CLI/ui-settings-account/src/client/index.ts:341-343`；`ui-settings-general/src/client/index.ts:249-256`；`ui-settings-models/src/client/index.ts:137-141`；`ui-settings-plugins/src/client/index.ts:77-81`；`ui-agent-preset/src/client/index.ts:284-288`；`ui-settings-general` README:30-32 |

### 3.4 移植判断（IA）

| 项 | 判断 | 说明 |
| --- | --- | --- |
| 三栏宽度规则、安全区、拖拽区、聊天宽度轴 | 直接移植 | 用 CSS grid + Zustand layout store，数值照搬 |
| Workspace 分组与显示上限规则 | 直接移植 | 依赖的“运行中 / 等待用户 / 未读”状态需由协议提供 |
| 工具卡按工具名分发 | 改写 | 用静态 `Record<toolName, Component>` 加通用回退，数据由协议事件与持久化结果派生（符合 Coko ui.md） |
| composer 接管（审批、提问）与 dock 顺序 | 直接移植 | 作为 Coko composer 的固定区域 |
| `@`/`/` 菜单 | 改写 | 在 Lexical 0.52 上实现 typeahead（具体插件 API 未核对） |
| 设置 modal 与分区 | 改写 | 分区按 Coko 能力调整，例如 Models、General、权限、MCP、Skills |
| slot/插件化 UI、HMR、Plugin market、Trajectory、dockkit、内嵌浏览器 | 不移植（首期） | Coko 暂无插件运行时需求 |

## 4. 设计系统：位置与 Coko 缺口

### 4.1 文件位置

| 内容 | 位置 |
| --- | --- |
| 原始色板 `--dsw-static-*`、语义 `--dsw-alias-*`、`--dsw-specific-*`、菜单材质 | `CLI/ui-theme/src/styles/design-platform.css:4-430` |
| 字体栈、动效、`--dsw-radius-*` | `CLI/ui-theme/src/styles/base.css:6-34` |
| 阴影、elevation、菜单模糊、字号阶梯 | `CLI/ui-theme/src/styles/gradient-shadow-text.css:1-275` |
| focus ring / 滚动条 / superellipse / 品牌字体 | `focus.css` / `scrollbar.css` / `corner-shape.css` / `brand-font.css`（Montserrat 300/400/500，OFL） |
| 组件库 | `CLI/ui-primitives/src/*`（目录见 `README.md:43-86`） |
| 规则文档 | `DSH/docs/web-styling.md`、`DSH/docs/ui-radius.md` |
| 主题切换 | `body[data-ds-dark-theme]`（Coko 用 `.dark`） |

Coko `ui-design-system.md` 已覆盖圆角档位、superellipse/round、嵌套圆角、0.5px 发丝线、elevation 与菜单材质规则、遮罩、hover 规则。以下只补数值。

### 4.2 颜色：DSH 实际取值 → shadcn 语义 token 建议

DSH 中性色以 “bluish” 为主：主按钮是近黑或近白，蓝色（deepseek-500 `rgb(65,118,230)`）只用于 link、focus 和业务状态（`design-platform.css:176-420`）。

| Coko 语义 token（建议） | DSH alias | 亮 | 暗 |
| --- | --- | --- | --- |
| `--background` | `bg-base` | `#ffffff` | `rgb(21,21,23)` |
| `--card` / `--card-fill` | `bg-layer-2`（设置卡填充） | `#ffffff` | `rgb(44,44,46)` |
| `--popover`（实色） | `bg-layer-1` | `#ffffff` | `rgb(35,35,36)` |
| `--foreground` | `label-primary` | `rgb(15,17,21)` | `rgb(249,250,251)` |
| `--muted-foreground` | `label-secondary` / `label-tertiary` | `rgb(97,102,107)` / `rgb(129,133,140)` | `rgb(207,211,214)` / `rgb(173,178,184)` |
| 说明文字 | `label-caption` | `rgb(173,178,184)` | `rgb(129,133,140)` |
| `--primary` / hover | `button-primary-fill/hover` | `rgb(15,17,21)` / `rgb(67,69,74)` | `rgb(249,250,251)` / `rgb(235,238,242)` |
| `--primary-foreground` | `label-primary-foreground` | `#ffffff` | `rgb(15,17,21)` |
| `--accent`（hover 底） | `interactive-bg-hover` / `-active` | `rgba(38,49,72,.06)` / `.10` | `rgba(255,255,255,.08)` / `.14` |
| `--link` / `--ring` | `link` / `state-business-primary` | `rgb(65,118,230)` | `rgb(122,170,255)` |
| `--destructive` | `state-error-primary` | `rgb(236,19,19)` | `rgb(242,90,90)` |
| success / warn / done | `state-*-primary` | `rgb(34,197,94)` / `rgb(245,158,11)` / `rgb(124,58,237)` | 同 / 同 / `rgb(167,139,250)` |
| `--border` 档 | `border-l1…l4` | `rgba(0,0,0,.04/.10/.12/.16)` | `rgba(255,255,255,.06/.12/.16/.20)` |
| `--card-stroke` / `--elevation-stroke` | `border-l4`（菜单在暗色下用 l3） | 同上 | 同上 |
| `--sidebar` | `specific-sidebar-fill` | `rgb(249,250,251)` | `rgb(27,27,28)` |
| `--sidebar-accent`（选中） | `sidebar-nav-item-active` | `rgb(235,238,242)` | `rgb(67,69,74)` |
| 用户气泡 | `specific-bubble` | `rgb(237,243,254)` | `rgb(44,44,46)` |
| `--menu-fill` | `menu-surface-fill`；macOS 无 backing 时用 `specific-menu` | `rgba(248,249,250,.58)`；mac `.94` | `rgba(67,69,74,.45)`；mac `rgba(48,49,54,.94)` |
| `--overlay` | `bg-mask-1` | `rgba(0,0,0,.24)` | `rgba(0,0,0,.5)` |
| tooltip / toast 底 | `tooltip-bg` / `toast-bg` | `rgb(44,44,46)` / `rgb(53,54,56)` | `rgb(67,69,74)` / `rgb(67,69,74)` |
| 代码块底 / 行内代码 | `markdown-code-block` / `inline-code` | `rgb(249,250,251)` / `rgb(250,250,250)` | `rgb(27,27,28)` / `rgb(41,41,41)` |
| diff 增 / 删（行底） | `file-diff-added-bg` / `-deleted-bg` | `rgb(230,244,231)` / `rgb(252,230,226)` | `rgb(31,49,36)` / `rgb(60,31,27)` |
| skeleton | `bg-skeleton` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.08)` |

### 4.3 字号阶梯（补 Coko `text-ui-*`）

| 建议名 | DSH 变量 | size/line-height | 字重 |
| --- | --- | --- | --- |
| `text-ui-caption` | `font-xxxs-11` | 11/14 | 400·500 |
| `text-ui-small` | `font-xxs-12` | 12/18 | 400·500 |
| `text-ui-body`（行与明细） | `font-xs-13` | 13/20 | 400·500 |
| `text-ui-body-lg` | `font-s-14` | 14/22 | 400·500 |
| `text-ui-title` | `font-base-16` / `m-18`（实际 16/28） | 16/24 | 400·500 |
| `text-ui-heading` | `font-l-20` | 20/28 | 500 |
| `text-ui-display` | `font-xl-24` | 24/32 | 600（Coko 限 500） |

- Markdown：正文默认 14/24，用户可调 10–22px；h1/h2/h3 为 21/30、19/28、18/26（700），h4 为 14/24（600）；表格 13/22；small 12/20；代码块默认 11/19，可调 10–16，行内代码 12/19（`gradient-shadow-text.css:51-183`）。h 级字重由 MarkdownRenderer 自行管理，符合 Coko 的例外条款。
- 字体栈：正文 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', …`；代码 `'SF Mono','JetBrains Mono','Fira Code',Consolas,…,'PingFang SC','Microsoft YaHei'`，刻意不以 `monospace` 结尾，避免 Windows CJK 回退到宋体（`base.css:1-13`）。Coko ui.md 已定 Noto Sans SC / JetBrains Mono 本机优先，保持 Coko 约定，只借鉴“代码栈以 CJK 字体收尾”这一条。

### 4.4 Elevation、动效、焦点（精确值）

```css
/* gradient-shadow-text.css:17-40；在 body, body * 上逐元素声明，以便组件重绑描边色 */
--elevation-stroke:   0 0 0 0.5px var(--elevation-stroke-color);           /* 默认 border-l4 */
--shadow-panel:       var(--elevation-stroke), 0 3px 8px 0 rgb(0 0 0/.03), 0 0 16px 0 rgb(0 0 0/.02);
--shadow-prominent:   var(--elevation-stroke), 0 3px 8px 0 rgb(0 0 0/.04), 0 0 20px 0 rgb(0 0 0/.05);
--shadow-soft:        var(--elevation-stroke), 0 4px 16px 0 rgb(0 0 0/.03), 0 0 24px 0 rgb(0 0 0/.03); /* composer */
--menu-backdrop-filter: blur(40px) saturate(150%);   --mask-blur: none;
/* base.css:14-17 */
--ease-in-out: cubic-bezier(0.4,0,0.2,1); --duration-fast: .1s; --duration: .2s; --duration-slow: .3s;
/* focus.css:2-21 */
--focus-ring-width: 2px; outline-color: var(--ring);  /* 指针操作时非可编辑元素隐藏 ring */
```

- Tailwind 4 注意：`@theme` 中的 `--shadow-*` 如果引用 `var(--elevation-stroke-color)`，要写在 `@theme inline`，否则变量在 `:root` 就已解析，组件局部重绑不会生效。[Tailwind theme：引用其他变量](https://tailwindcss.com/docs/theme#referencing-other-variables)
- 其他固定动效：列表移动 200ms，进出淡入淡出 100ms（`AnimatedRows`）；Shimmer 延迟 300ms、扫过 1s、停 500ms（`TextShimmer`）（`CLI/ui-primitives/README.md:61-63`）。

### 4.5 组件对照（DSH ui-primitives → Coko shadcn/ui）

| DSH | Coko 对应 | 备注 |
| --- | --- | --- |
| `Button`（primary/ghost/outline/toolbar） | shadcn Button + 新增 `toolbar` variant | outline 用内嵌发丝线 |
| `Switch` 36×20 | Switch | 关闭态 thumb 用 `switch-thumb` token |
| `SegmentedControl` / `SegmentedTabs` / `Pill` / `Tag` | ToggleGroup / Tabs / Toggle / Badge | 几何见 Coko 嵌套表 |
| `Menu` / `MenuSurface` / `MenuGroup` | DropdownMenu、ContextMenu、Command | 粘性分组标题使用 `menu-group-header-fill` |
| `Modal` / `RiskConfirmation` | Dialog / AlertDialog + Checkbox | |
| `Tooltip` / `HoverCard` / `HoverCardGroup` | Tooltip / HoverCard | 分组共享首次停留时间需自行实现 |
| `Toast`（顶部居中，`holdMs`） | 待定 | shadcn 推荐 Sonner，Coko TECH_STACK 未登记 |
| `StateDot`（10px；ongoing 14px 旋转） | 自建 | done 绿、warning 琥珀、error 红、idle 灰 |
| `DisclosureRow` 24px / `InlineEditor`（最多 6 行） / `PathLabel` | 自建 | 工具行、Goal、路径显示 |
| `TerminalBlock` / `ReadBlock` / `DiffBlock` / `SearchBlock` / `WebBlock` / `CodeBlock` | 自建，配合 anser、diff、Streamdown code | 工具卡的核心 |
| `SettingsForm` / `SettingsFormModel` | 自建 | 暂存后保存，冲突时保留草稿 |

## 5. 对后续票的输入

- issue 05（SQLite 存储）：DSH 选择 JSONL 加派生 SQLite 索引，没有“会话以 SQLite 为权威存储”的先例。可借鉴 §2.4 的打开序列、事务和失败隔离，以及 §2.2 的 flush 屏障与 checkpoint 时机。迁移要自行实现，因为 DSH 遇到 `user_version` 不符直接拒绝。
- issue 08（信息架构）：§3.2 与 §3.3 可作为 IA 草案的骨架，需要逐项取舍首期是否纳入右栏、Trajectory、Plugins。
- 架构文档缺口：renderer 获取 WS 端口的 boot IPC（§1.4）、退出时的任务询问与分级超时（§1.5）。确认后应提炼进 `docs/tech-stack/architecture.md`，正式文档不链接本文件。
