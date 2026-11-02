# 11: 新对话：独立对话的首次发送

**What to build:** 右侧新对话界面展示欢迎内容：brand 中已确认的形象资产、“今天我们来做些什么？”与画布中的说明；不展示四个快捷按钮与帮助图标。入口为侧栏“新对话”（替换 02 的过渡）与对话分类标题栏的“创建新对话”（编辑形状图标，清除此前的项目、分支与工作树选择）；入口打开后聚焦输入框，不自动发送。新对话只有一份草稿：从任何入口进入都是这一份，文字、文件引用、权限模式、模型与档位一同在本地保存，切到其他对话再切回或重启后仍在，首次发送成功后清空；默认模型为第一个供应商目录中的第一个模型，档位关闭。打开欢迎页与修改配置不写任何记录。首次发送是一个服务端操作：在专属目录根下创建专属目录（名称形如 `<日期>-<短 id>`，不覆盖已存在的目录），创建带权限模式与模型的 Session，写入第一条消息并启动 Run。第一条消息被接受时，标题设为它的第一行，去掉首尾空白，最多 20 个字符；只有文件引用时为“附件：”加文件名，多个文件名用“、”连接。任一步失败或被 UserPromptSubmit Hook 拒绝时，在返回前删除刚建的 Session 与专属目录，草稿与配置保留并明确反馈；同一草稿标识重复提交时返回已创建的 Session；提交进行中再次点击发送不起作用。成功后进入该会话，它出现在“对话”分类。独立对话草稿的上下文环只显示轨道。

- 行为依据：[规格](../spec.md) 8.1（独立对话的两行）、NEW-01 至 NEW-03、NEW-08、MODEL-12、STATE-01 的草稿部分、CHAT-18 的第一条消息标题、17.2 首次发送与专属目录根、17.4 界面本地状态；[ADR 0020](../../../docs/adr/0020-projects-organize-workspaces.md) 的专属目录。项目归属见 12，模型标题见 18，图片见 19，worktree 见 21。
- 现有按 Workspace 保存的草稿与草稿流程由本票替换；旧的 Workspace 草稿键不再读取并清除，在 Comments 说明。

**User stories:** 39、41、42、43、51

**Blocked by:** 01、02、03、06

**Status:** ready-for-agent

**Write scope:** apps/server 的首次发送操作、专属目录根（默认为 Coko 管理的用户可见目录，可由启动配置覆盖）、草稿标识去重与失败清理；packages/protocol 的首次发送请求与响应；renderer 的欢迎页、新对话草稿 store（替换 chat-store 中的草稿字段）、侧栏“新对话”与对话分类的创建入口；i18n；workbench.md 的新对话一节与 projects.md 的专属目录说明。

**跨票接口：** chat-store 现有的模型选择与权限模式入口保留签名，在新对话中写入新的草稿 store，03 与 05 不需要改调用方式。新对话草稿 store 由 12（归属）、19（图片引用）、20（分支）、21（新建工作树）扩展字段；首次发送请求由 12 加归属、19 加图片、21 加新建工作树与基础分支，本票只定义独立对话需要的字段。18 在本操作接受第一条消息后发出标题请求，以本票写入的标题为占位。

- [x] Sidecar 协议（专属目录根指向临时目录）：首次发送创建专属目录，Session 的工作目录是它，权限模式与模型与请求一致，第一条消息与 Run 存在，标题符合上述规则；创建步骤失败（例如专属目录根不可写）与 UserPromptSubmit Hook 拒绝时不留下 Session 与专属目录，Run 开始后的模型错误属于已有会话、会话保留；同一草稿标识重复提交只有一个 Session；目录名冲突时不覆盖已有目录。
- [x] Browser Mode：欢迎内容，没有快捷按钮、帮助与语音；入口聚焦输入框；对话分类入口清除项目、分支与工作树；切换会话后草稿仍在；提交中再次发送不起作用；失败后草稿与配置保留；独立草稿的上下文环只显示轨道（CW-25 的清除部分、CW-26、CW-41）。
- [x] Electron E2E：新建独立对话并发送，专属目录存在，会话出现在“对话”分类；修改模型与档位并输入文字后切走再回来，然后重启，修改与草稿都在，首次发送成功后清空（CW-62）。
- [x] 文档按 Write scope 更新；`check:docs` 通过。


**Closed: true**

## Comments

### 2026-11-03 实施与验证

基于集成分支 `daa2d0a` 实施。测试接口采用规格第 18 节已确认的 Sidecar 协议、renderer Browser Mode、真实 Electron 与 session 仓库契约，不另设内部调用顺序测试。

- 新增 `FirstSendService` 与 `POST /api/chats/first-send`。专属目录根缺省为 `~/Coko/chats`，`COKO_CHATS_ROOT` 覆盖必须为绝对路径；测试 harness 为每个实例设置临时目录。日期按宿主本地日期，`mkdtemp` 独占分配后缀，不覆盖既有目录。直接登记 Workspace 并显式 projectId: null，绕开登记目录自动创建项目的过渡入口。
- **幂等与迁移决定**：以草稿身份 SHA-256 派生内部 Session ID，存储 `NewSession.id` 只供宿主内部使用，HTTP 创建会话接口不接受自定义 ID。已经提交的首条用户消息和其 Run ID 就是重复请求的持久化结果；并发同草稿共享 pending Promise，重启后读回同一结果。本票没有新增 schema 版本或映射表，v10 迁移不变。
- 首次发送等待 runtime 已提交的 user message 事件，不把同步 run_start progress 当成成功；普通发送、Goal、schedule、子代理的默认返回时机不变。只有首次发送拒绝不产生 Run 的动作命令，避免先执行动作再回滚会话。
- 接受前的失败通过 SessionRepository.deleteSession 清理会话树记录，deleteWorkspaceIfUnused 只删除无引用登记，文件系统只回收本次新建目录；接受后的模型错误保留会话。新增仓库方法在 SQLite 与内存实现运行同一契约；后续 09 可复用 deleteSession，但忙碌判定仍由调用方负责。
- 新对话配置移到 ChatStore.newChat / useNewChat，保留 selectModel / setPermissionMode 的调用签名和 Promise 返回值。配置键 coko.new-chat.v1；EditorState 单键 coko.draft.new-chat，旧 coko.draft.workspace.* 不再读取并在初始化时清除。已有 Session 草稿键保持原样。上下文只有轨道，未发送时不虚构 Workspace，不请求项目目录命令。项目归属由 12 接入。
- 顶部和对话分类的创建入口都打开同一草稿并聚焦，分类入口使用编辑图标。欢迎图像使用已确认 brand/rukie-avatar.png，标题与说明来自画布 WNKBc/KXmr9；宽版 176px 角色与 216px 欢迎区，窄版按可用宽度重排，底部柔和过渡。实际查看了 390px 主区浅/深主题截图，图片、标题、输入区与操作可达且无横向溢出；Impeccable detector 返回 []。

TDD 与回归依据：首个 Sidecar 测试先因路由 404 失败；实现后通过并发与重启重复请求。Hook 拒绝测试先暴露残留会话，补齐仓库清理后通过。欢迎页测试先因没有欢迎标题失败，接入后通过。联合 app 测试暴露导航在列表 ready、默认目标尚未选中时提前初始化历史，改为等待目标或明确新草稿后通过。

验证命令（均在本票 worktree，源码测试使用当前代码）：

- `pnpm run test packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts apps/desktop/src/renderer/stores/chat-store-permissions.test.ts tests/integration/sidecar-first-send.test.ts apps/server/src/config.test.ts`：退出 0，6 文件 / 122 用例通过。覆盖初始配置、首条消息与 Run、首行/附件标题、并发和重启幂等、Hook/模型/目录失败清理、已存在文件不变、接受后模型错误保留、空消息和草稿身份校验、两种存储一致性、重复点击与失败配置保留。
- `pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：退出 0，6 文件 / 100 用例通过。
- `pnpm run test apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx`：退出 0，3 文件 / 21 用例通过，验证新草稿没有 Workspace 时设置消费者与计划状态仍可用。
- `pnpm run test apps/desktop/e2e/first-send.e2e.test.ts`：退出 0，真实 Electron / 本次构建产物 2 用例通过；模型、high 档位、权限与文字跨页面和重启恢复，首次发送创建专属目录、无 Project、清空草稿；Hook 拒绝时 Toast、草稿与目录清理，修正后重试只创建一个会话。
- 后续包含上述 first-send、sidebar-lists、workbench 与权限 store 的联合命令：前者 2、workbench 1、权限 store 6 通过；sidebar-lists 的 2 个旧标题断言失败。仅修正旧标题断言后 `pnpm run test apps/desktop/e2e/sidebar-lists.e2e.test.ts apps/desktop/src/renderer/stores/chat-store-permissions.test.ts` 退出 0，2 文件 / 9 用例通过（Electron 3，store 6）。因此真实 Electron 新对话、外壳、列表恢复共 6 场景有当前行为证据。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`（246 个 Markdown / 0 问题）、`git diff --check`：退出 0。

旧测试调整原因：chat-store 与 permissions 用例改为一次 firstSend，而非 renderer 先创建会话再切权限再提交；Browser fixture 实现新操作。agents-section 去掉被删除的 draftWorkspaceId 字段。app、sidebar-lists 及其他 E2E 的新会话标题断言统一采用当前字典“新对话 / New chat”，这是共享标题的机械消费者更新，未把所有这些旧 E2E 宣称为已运行。plan 模式菜单的焦点断言保留同一目标，改为等待可观察的焦点返回（Radix 菜单移除之后会延迟恢复焦点），不以菜单 DOM 消失代替焦点已恢复。实际失败与重跑范围如上。

文档影响：首次发送与单份草稿 → workbench.md；专属目录与清理 → projects.md；EditorState 键与作用域切换 → context.md；上层导航摘要 → docs/README.md。搜索 coko.draft.workspace / Workspace 草稿 / titleFromText 消费者，修正被本票推翻的当前说明；工作目录相关 API 的 Workspace 参数仍为其他调用方保留。按 AGENTS → docs/README → 三篇正文读回：权威、生命周期、引用方向与保留原有章节通过，无正式文档反向依赖任务材料。

未运行真实外部模型、发布构建 smoke 或 CI；faux 的真实 Electron/Sidecar 链路不代表外部模型验证。代码与证据仅本地提交，未推送。
