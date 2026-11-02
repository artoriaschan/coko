---
kind: reference
description: "桌面工作台的外壳、导航与输入区当前行为。"
lifecycle: active
---

# 桌面工作台

本文说明桌面工作台外壳、内容区导航与主输入区。会话数据与执行状态由对应的 store 和 Sidecar 持有；窗口内的导航历史不持久化。

## 外壳与导航

[App](../../apps/desktop/src/renderer/app/app.tsx) 组合左侧导航与列表、右侧内容及可选的右面板。[AppFrame](../../packages/ui/src/app-frame/app-frame.tsx) 负责侧栏伸缩、窄窗口 rail 与抽屉、拖动分隔条以及四角裁剪，圆角使用共享的 R28 主面板档位。

侧栏顶部安全区依次放置收起侧栏、后退、前进按钮；macOS 为原生窗口控制按钮预留空间。下面三项导航为新对话、插件和定时任务，高度均为 32px。新对话右侧的搜索按钮只打开标题过滤，不创建会话；完整的搜索浮层尚未接入。列表在中间独立滚动，底部用户区固定为 46px，使用脱敏的本地用户与 22px 圆形头像；点击用户入口打开整页设置。

[导航 store](../../apps/desktop/src/renderer/app/workbench-navigation.ts) 保存当前窗口中的内容区位置：会话、新对话、插件或定时任务。新位置清空前进历史，连续访问同一位置不重复记录；后退和前进跳过当前列表中已经不存在的会话，因此删除或归档后的会话不会重新打开。首次列表加载不制造一次额外的历史访问。外部入口打开会话也更新内容区位置。

插件与定时任务在内容区复用已有设置分区，侧栏保持可见；切换内容页会隐藏对话区并保留其实例。设置页覆盖整个工作台，但不卸载它，也不进入内容区历史；关闭设置后回到原位置，草稿、列表与滚动状态保留。设置页与对话区各自维持原有的焦点恢复和键盘行为。

导航历史只保存在 renderer 内存中，重启后为空。分类状态和新对话草稿的持久化由各自功能负责；本节不定义它们的数据格式。独立新对话未发送时没有 Workspace；专属目录与会话只在首次发送时创建。项目草稿引用已有的主要 Workspace。

## 新对话与首次发送

新对话显示已确认的 `brand/rukie-avatar.png` 形象、欢迎标题与说明，和已有会话共用同一主输入框。侧栏与对话分类的创建入口都打开同一份草稿并聚焦编辑区；没有任何 Workspace 时也可编辑、选择权限或模型。独立草稿不查询虚构目录的上下文，只显示不可用轨道；没有模型时仍经配置模型入口保留草稿。

[新对话 store](../../apps/desktop/src/renderer/stores/new-chat-store.ts) 独立保存草稿身份、归属与 Git 配置、模型、档位、权限与图片引用；`ChatStore` 的既有选择动作转交此 store，不复制另一份状态。配置存为 `coko.new-chat.v1`，文字与 File Reference 的 EditorState 存为 `coko.draft.new-chat`。切换会话、内容页或重启后恢复；旧的 `coko.draft.workspace.*` 键不再读取，初始化时清除。已有会话草稿仍按 Session 保存。新草稿模型显示第一个供应商目录中的第一个模型，档位关闭。

`POST /api/chats/first-send` 接收草稿身份、文字、图片、权限模式、模型与档位，以及可选的 `projectId`。选择项目时使用发送当时项目的主要 Workspace 并保存归属，不创建专属目录；项目不存在时拒绝。独立发送时，服务端在用户可见目录根（默认 `~/Coko/chats`，可用绝对路径环境变量 `COKO_CHATS_ROOT` 覆盖）下独占创建日期加短随机后缀的目录，登记独立 Workspace，创建初始配置已经生效的会话，然后提交第一条消息。此路径不会自动创建项目。首条消息标题取去空白后的首行，按 Unicode 字符最多 20 个；只有 File Reference 或图片时用“附件：”加文件名，多个文件名用“、”连接。

[首次发送服务](../../apps/server/src/application/first-send.ts) 对同一草稿共享进行中的请求，以草稿身份的 SHA-256 派生内部会话键；已经持久化的首条用户消息与 Run 身份是重启后重试的结果凭证，不新增 schema 版本或草稿映射表。HTTP 成功返回之前等待运行时已提交的用户消息事件，而不是同步 `run_start` 进度。重复提交不再启动 Run。目录、模型校验、Hook 拒绝或接受前失败时，删除本次新建会话、未被引用的 Workspace 与专属目录；首条消息接受后发生模型错误保留会话。清理不操作其他源目录。

renderer 提交期间禁止重复首次发送，失败时保留文字与配置并通过应用级 Toast 反馈；成功后清空提交的草稿并进入同一个会话，用户等待期间已打开其他会话时不抢回焦点。列表恢复仍由列表 store 管理，新欢迎页不会生成空会话。

验证：[Sidecar 首次发送](../../tests/integration/sidecar-first-send.test.ts)、[新对话 Browser Mode](../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx)、[真实 Electron 首次发送与重启](../../apps/desktop/e2e/first-send.e2e.test.ts)。

## 首条消息的标题

首条用户消息持久化后，[标题服务](../../apps/server/src/application/session-titles.ts)在 Run 之外使用会话当前模型发一次请求。系统提示要求按用户语言概括意图、约 12 个字符；用户原始文字与附件文件名作为 JSON 数据传入，不展开 File Reference，不发送图片内容，不传工具，推理关闭。入请求之前替换登记的 Secret 值。结果取首行、去引号和首尾标点，按 Unicode 字符最多 20 个。

15 秒截止时间使用 Sidecar 时钟。停止 Run 不取消标题；失败、空结果与超时保留首条消息生成的标题。SQLite 与内存存储都以原占位标题作为原子条件更新，生成期间手动改名不会被覆盖。提交后的 `session_title` WebSocket 消息通知所有连接，使列表及已打开的详情卡片同步。删除会话先禁止新写入，再取消并收尾标题请求；不会向已删除的会话追加迟到条目。退出 Sidecar 同样取消标题工作。交接、分叉、子代理和同草稿重复提交不启动标题请求。

标题请求写为 `purpose: title`、`runId: null` 的 `model_request`，会话费用增加一次该请求的用量与总费用；Run 费用及普通回复的汇总口径不变。日志只记录耗时、用量与结果状态，不记录生成标题或消息正文。追踪的 Session 合计与 Run 列表的区别见[追踪](tracing.md#追踪)。

验证：[标题协议与失败路径](../../tests/integration/sidecar-titles.test.ts)、[标题秘密总闸](../../tests/integration/secrets-gate-titles.test.ts)、[列表与详情 Browser Mode](../../apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx)、[费用 Browser Mode](../../apps/desktop/src/renderer/features/conversation/session-cost.browser.test.tsx)、[真实 Electron 标题更新](../../apps/desktop/e2e/titles.e2e.test.ts)。

## 新对话归属栏

[归属栏](../../apps/desktop/src/renderer/features/conversation/destination-bar.tsx) 只在欢迎页主输入框顶部显示；已有 Session 没有此入口。独立状态使用统一聊天气泡、“对话”和箭头；选中项目后显示文件夹与项目名。按钮高 28px，前导图标 14px、箭头 12px，名称沿用 13/20 与下内边距 2px 的光学居中容器。hover 或键盘焦点时，在原文件夹槽显示关闭按钮，名称起点保持不变；关闭只清除归属。

项目菜单通过共享 DropdownMenu 在归属栏上方 6px 打开，提供按项目名搜索、列表、当前勾选与“不在项目中工作”。同名项目在名称后以弱化文字附带主要文件夹目录名；唯一名称不附带目录名，搜索只匹配项目名。菜单使用共享窗口边缘避让；键盘可从搜索框向下进入项目列表，Escape 关闭。新建项目菜单项由项目创建能力接入。

归属、分支与新建工作树配置同样保存在唯一新对话草稿中；换项目、关闭或选择“不在项目中工作”清除分支与工作树配置，文字、附件、模型与权限继续保留。侧栏项目行的新对话图标进入这份草稿、预选项目并聚焦输入区，不展开或折叠项目，也不创建 Session；独立创建入口清除项目与 Git 配置；从历史后退、前进返回新对话时保留现有配置。项目草稿的命令、File Reference 与上下文环使用主要 Workspace；独立草稿继续不查询未确定目录。

首次发送的项目归属由服务端解析，失败时只回滚本次新会话，保留既有 Workspace、项目和源文件。并发或重复草稿身份沿用首次发送去重；接受后的 Session 工作目录固定，归属栏不能修改它。

验证：[归属 Browser Mode](../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx)、[项目首次发送协议](../../tests/integration/sidecar-first-send.test.ts)、[真实 Electron 项目入口、草稿重启与主要目录写入](../../apps/desktop/e2e/destination.e2e.test.ts)。

## 主输入区

`apps/desktop/src/renderer/features/conversation/composer.tsx` 组合共享 Lexical `ComposerEditor` 与底部工具栏。主输入框基准高 120px、内边距 12px、R28 与 soft elevation；编辑区独立滚动，底部工具栏高 32px。压缩进度与图片缩略图各占一行，显示时输入框允许增高。

工具栏依次为附件、权限、仅计划模式出现的计划状态组、弹性间距、上下文环、模型与档位、发送。权限和模型分别有独立插槽；上下文环与模型选择保持其原接口。窄窗口中权限可仅显示图标，名称仍由 Tooltip 与可访问名称提供。

Run 中停止取代主发送位置，仍可暂停；有文字时另显示追加指令按钮，Enter 也提交追加指令。输入法组合期间不提交，Shift+Enter 换行。审批、确认、计划审阅接管时输入框保持挂载，草稿和选区保留。

## 模型与推理档位

模型按钮读取设置中的可用目录，显示当前模型与非关闭档位摘要。首次打开时显示当前模型详情：当前档位、模型图标与名称、推理档位滑条；详情采用共享菜单表面，基准宽 280px、高 112px。点击名称区域以按供应商分组的模型列表替换详情，选择后返回详情；两种内容始终复用一个浮层。列表的模型图标使用通用机器人图形，未知的自定义供应商品牌不猜测为特定品牌；选中勾号在行尾。

[共享滑条](../../packages/ui/src/components/thinking-slider.tsx) 只提供模型配置的有效档位。拖动时滑块连续跟手，详情与按钮摘要同步预览；释放时吸附并提交一次选择，保存失败由既有模型操作反馈并恢复已保存值。键盘 Tab 可从名称区域进入滑条，方向键、Home 与 End 选择有效节点；Escape 关闭后焦点返回按钮。切换到不支持当前档位的模型时采用关闭。

填充区域遮住已覆盖的刻度。粒子从右向左流动，七档数量依次为 0、3、6、10、15、21、28，单轮时长为停止、4、3、2.2、1.6、1.1、0.75 秒。已有粒子切档时保留相位，只改变播放速度；关闭菜单、不可见或页面隐藏、关闭档位以及减少动态效果会停止粒子，选择能力不受影响。

没有可用模型时仍显示“选择模型”，发送位置改为“配置模型”，打开模型服务设置并保留草稿。已被清空的会话模型不会自动代填，继续运行前显示重新选择提示。

## 文件附件

附件按钮经受控 preload 打开系统多文件选择，主进程校验发送者为应用主窗口主框架，重复打开共用一次对话框。非图片文件仍只传路径：工作目录内插入与 @ 菜单相同的 File Reference 节点，Workspace 外插入绝对路径，不复制内容；外部文件读取继续由现有权限规则处理。粘贴和拖入非图片的 `File` 通过 `webUtils.getPathForFile` 获取路径。

图片支持 PNG、JPEG、GIF 与 WebP。当前模型的输入类型含 `image` 时，选择、粘贴和拖入都能添加；否则立即说明原因。选择的图片经受控 `readPickedImage` IPC 读取，主进程只读取本窗口已经选择的路径，限制读取字节数；粘贴或拖入的图片直接读取浏览器 `File`，无需磁盘路径。单张上限为 read 工具相同的 4.5 × 1024 × 1024 字节，不缩放。图片缩略图带可访问名称与移除按钮；没有文字但有图片时允许发送。

[图片草稿存储](../../apps/desktop/src/renderer/stores/image-drafts.ts) 将图片 bytes 存入 IndexedDB `coko.image-drafts`，文字 EditorState 不嵌入图片。新对话配置的 `imageRefs` 与已有 Session 草稿的 `.images` 键只保存不透明引用；切换会话、重新挂载及重启后从 IndexedDB 恢复。发送失败或切换到不支持图片的模型时保留文字、图片与配置，发送明确拒绝；成功接受后删除本次发送的引用及 IndexedDB 图片。当前 Run 进行中时，图片保留到运行结束后发送，追加指令仍只传文字并明确反馈等待原因。

首次发送和已有会话的提交协议均接收 `images`，文字可为空。Sidecar 在用户消息与 Run 产生前重新检查解析后模型的图片能力、base64、签名与 read 图片大小上限，不信任 renderer。图片作为 `{ type: 'image', data, mimeType }` 内容块持久化并交给 Agent，普通文字、文件引用与 Hook 上下文保持原顺序。时间线只为 raster MIME 与合法 base64 渲染图片，不嵌入 SVG 或外部 HTML。带图片的动作命令拒绝发送，避免无声丢弃图片。

验证：[图片 Sidecar 协议](../../tests/integration/sidecar-images.test.ts)、[附件 Browser Mode](../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx)、[真实 Electron 图片选择、提交与重启](../../apps/desktop/e2e/images.e2e.test.ts)。

## 验证入口

- [工作台浏览器测试](../../apps/desktop/src/renderer/app/app.browser.test.tsx)：导航项几何、历史、无效会话跳过、设置返回、草稿保留及四角裁剪。
- [AppFrame 浏览器测试](../../packages/ui/src/app-frame/app-frame.browser.test.tsx)：侧栏宽度、窄窗口抽屉及右面板让位。
- [工作台 Electron E2E](../../apps/desktop/e2e/workbench.e2e.test.ts)：真实 Sidecar 中两个会话与插件、定时任务之间的前进后退，以及设置返回后的草稿和列表。

- [模型选择 Browser Mode](../../apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx)：互斥菜单、拖动预览、键盘与粒子生命周期。
- [模型选择 Electron E2E](../../apps/desktop/e2e/model-picker.e2e.test.ts)：更换供应商和档位后读回 Sidecar。
- [输入区 Browser Mode](../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx)：布局、文件选择/粘贴/拖入、运行控制与草稿。
- [文件与草稿 Electron E2E](../../apps/desktop/e2e/references-drafts.e2e.test.ts)：原生文件选择到持久化引用与模型请求。
- [权限判定与审批](permissions.md#界面)、[计划模式](plan-mode.md#界面)：权限选择与计划胶囊。
- [上下文管理](context.md)、[会话模型协议](../../packages/protocol/src/http.ts)：上下文统计与模型选择接口。

## 延伸阅读

- [界面约定](../tech-stack/ui.md)与[设计系统规格](../tech-stack/ui-design-system.md)：共享组件、布局与交互规则。
- [插件](plugins.md)与[定时任务](schedules.md)：所复用分区的业务行为。
