---
kind: reference
description: "当前工作台的主输入框、工具栏与文件附件契约。"
lifecycle: active
---

# 工作台

本文描述当前桌面输入区的组合与交互。会话运行和审批沿用所属子系统契约。

## 主输入区

`apps/desktop/src/renderer/features/conversation/composer.tsx` 组合共享 Lexical `ComposerEditor` 与底部工具栏。主输入框基准高 120px、内边距 12px、R28 与 soft elevation；编辑区独立滚动，底部工具栏高 32px。压缩进度另占一行，显示时输入框允许增高。

工具栏依次为附件、权限、仅计划模式出现的计划状态组、弹性间距、上下文环、模型与档位、发送。权限和模型分别有独立插槽；上下文环与模型选择保持其原接口。窄窗口中权限可仅显示图标，名称仍由 Tooltip 与可访问名称提供。

Run 中停止取代主发送位置，仍可暂停；有文字时另显示追加指令按钮，Enter 也提交追加指令。输入法组合期间不提交，Shift+Enter 换行。审批、确认、计划审阅接管时输入框保持挂载，草稿和选区保留。

## 文件附件

附件按钮经受控 preload 打开系统多文件选择，主进程校验发送者为应用主窗口主框架，重复打开共用一次对话框。粘贴和拖入的 `File` 通过 preload 的 `webUtils.getPathForFile` 获取路径，不把文件内容经 IPC 传输。

工作目录内的路径插入与 @ 菜单相同的 File Reference 节点，Workspace 外的文件插入绝对路径；不复制文件。引用随既有 EditorState 草稿保存。图片当前明确拒绝并显示原因；文件路径不可用或选择失败时保留原草稿。外部文件的读取仍由现有权限规则处理。

## 验证与相关契约

- [输入区 Browser Mode](../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx)：布局、文件选择/粘贴/拖入、运行控制与草稿。
- [文件与草稿 Electron E2E](../../apps/desktop/e2e/references-drafts.e2e.test.ts)：原生文件选择到持久化引用与模型请求。
- [权限判定与审批](permissions.md#界面)、[计划模式](plan-mode.md#界面)：权限选择与计划胶囊。
- [上下文管理](context.md)、[会话模型协议](../../packages/protocol/src/http.ts)：上下文统计与模型选择接口。
