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

导航历史只保存在 renderer 内存中，重启后为空。分类状态和新对话草稿的持久化由各自功能负责；本节不定义它们的数据格式。新对话未发送时没有 Workspace；目录与会话只在首次发送时创建。

## 新对话与首次发送

新对话显示已确认的 `brand/rukie-avatar.png` 形象、欢迎标题与说明，和已有会话共用同一主输入框。侧栏与对话分类的创建入口都打开同一份草稿并聚焦编辑区；没有任何 Workspace 时也可编辑、选择权限或模型。独立草稿不查询虚构目录的上下文，只显示不可用轨道；没有模型时仍经配置模型入口保留草稿。

[新对话 store](../../apps/desktop/src/renderer/stores/new-chat-store.ts) 独立保存草稿身份、模型、档位与权限；`ChatStore` 的既有选择动作转交此 store，不复制另一份状态。配置存为 `coko.new-chat.v1`，文字与 File Reference 的 EditorState 存为 `coko.draft.new-chat`。切换会话、内容页或重启后恢复；旧的 `coko.draft.workspace.*` 键不再读取，初始化时清除。已有会话草稿仍按 Session 保存。新草稿模型显示第一个供应商目录中的第一个模型，档位关闭。

`POST /api/chats/first-send` 接收草稿身份、文字、权限模式、模型与档位。服务端在用户可见目录根（默认 `~/Coko/chats`，可用绝对路径环境变量 `COKO_CHATS_ROOT` 覆盖）下独占创建日期加短随机后缀的目录，登记独立 Workspace，创建初始配置已经生效的会话，然后提交第一条消息。此路径不会自动创建项目。首条消息标题取去空白后的首行，按 Unicode 字符最多 20 个；只有 File Reference 时用附件文件名。

[首次发送服务](../../apps/server/src/application/first-send.ts) 对同一草稿共享进行中的请求，以草稿身份的 SHA-256 派生内部会话键；已经持久化的首条用户消息与 Run 身份是重启后重试的结果凭证，不新增 schema 版本或草稿映射表。HTTP 成功返回之前等待运行时已提交的用户消息事件，而不是同步 `run_start` 进度。重复提交不再启动 Run。目录、模型校验、Hook 拒绝或接受前失败时，删除本次新建会话、未被引用的 Workspace 与专属目录；首条消息接受后发生模型错误保留会话。清理不操作其他源目录。

renderer 提交期间禁止重复首次发送，失败时保留文字与配置并通过应用级 Toast 反馈；成功后清空提交的草稿并进入同一个会话，用户等待期间已打开其他会话时不抢回焦点。列表恢复仍由列表 store 管理，新欢迎页不会生成空会话。

验证：[Sidecar 首次发送](../../tests/integration/sidecar-first-send.test.ts)、[新对话 Browser Mode](../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx)、[真实 Electron 首次发送与重启](../../apps/desktop/e2e/first-send.e2e.test.ts)。

## 主输入区

`apps/desktop/src/renderer/features/conversation/composer.tsx` 组合共享 Lexical `ComposerEditor` 与底部工具栏。主输入框基准高 120px、内边距 12px、R28 与 soft elevation；编辑区独立滚动，底部工具栏高 32px。压缩进度另占一行，显示时输入框允许增高。

工具栏依次为附件、权限、仅计划模式出现的计划状态组、弹性间距、上下文环、模型与档位、发送。权限和模型分别有独立插槽；上下文环与模型选择保持其原接口。窄窗口中权限可仅显示图标，名称仍由 Tooltip 与可访问名称提供。

Run 中停止取代主发送位置，仍可暂停；有文字时另显示追加指令按钮，Enter 也提交追加指令。输入法组合期间不提交，Shift+Enter 换行。审批、确认、计划审阅接管时输入框保持挂载，草稿和选区保留。

## 模型与推理档位

模型按钮读取设置中的可用目录，显示当前模型与非关闭档位摘要。首次打开时显示当前模型详情：当前档位、模型图标与名称、推理档位滑条；详情采用共享菜单表面，基准宽 280px、高 112px。点击名称区域以按供应商分组的模型列表替换详情，选择后返回详情；两种内容始终复用一个浮层。列表的模型图标使用通用机器人图形，未知的自定义供应商品牌不猜测为特定品牌；选中勾号在行尾。

[共享滑条](../../packages/ui/src/components/thinking-slider.tsx) 只提供模型配置的有效档位。拖动时滑块连续跟手，详情与按钮摘要同步预览；释放时吸附并提交一次选择，保存失败由既有模型操作反馈并恢复已保存值。键盘 Tab 可从名称区域进入滑条，方向键、Home 与 End 选择有效节点；Escape 关闭后焦点返回按钮。切换到不支持当前档位的模型时采用关闭。

填充区域遮住已覆盖的刻度。粒子从右向左流动，七档数量依次为 0、3、6、10、15、21、28，单轮时长为停止、4、3、2.2、1.6、1.1、0.75 秒。已有粒子切档时保留相位，只改变播放速度；关闭菜单、不可见或页面隐藏、关闭档位以及减少动态效果会停止粒子，选择能力不受影响。

没有可用模型时仍显示“选择模型”，发送位置改为“配置模型”，打开模型服务设置并保留草稿。已被清空的会话模型不会自动代填，继续运行前显示重新选择提示。

## 文件附件

附件按钮经受控 preload 打开系统多文件选择，主进程校验发送者为应用主窗口主框架，重复打开共用一次对话框。粘贴和拖入的 `File` 通过 preload 的 `webUtils.getPathForFile` 获取路径，不把文件内容经 IPC 传输。

工作目录内的路径插入与 @ 菜单相同的 File Reference 节点，Workspace 外的文件插入绝对路径；不复制文件。引用随既有 EditorState 草稿保存。图片当前明确拒绝并显示原因；文件路径不可用或选择失败时保留原草稿。外部文件的读取仍由现有权限规则处理。

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
