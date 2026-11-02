---
kind: evidence
description: "对话搜索浮层的 Browser、真实 Electron 会话身份及文档验收。"
lifecycle: active
---

# 对话搜索浮层验收

## 验证对象

- [实施票 22](../issues/22-conversation-search.md) 与 [规格](../spec.md) SEARCH-01～11、NAV-06、CHAT-12/14 的搜索部分。
- 基线：integration `411cb244`（含 08/09/10/16）；搜索分支 `codex/cw-22-search`，实现于 `9766d59` 后续提交。未推送。
- macOS、本机 Chromium Browser Mode、真实 Electron 41 + 本次 globalSetup 构建的真实 Sidecar。Browser 使用协议内存 fixture；Electron 通过真实 HTTP 创建两个既有会话，再从用户可见搜索入口打开目标。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `pnpm run test apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx` | 最近 10、全部标题包含匹配、trim/英文大小写、逐处高亮、去重、排序、归档排除、项目标签更新、正文/项目名不命中、完整长标题、内部滚动、IME 延后刷新与不确认、方向键与 Enter、关闭焦点恢复、右键与边缘避让、菜单重命名/置顶/归档/删除、删除取消与稳定身份、归档繁忙失败 | 最终 10 例 | 通过 |
| `pnpm run test apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx packages/i18n/src/index.test.ts packages/ui/src/guards/style-guard.test.ts apps/desktop/e2e/conversation-search.e2e.test.ts` | 工作台 sidebar/rail 入口、列表回归、双语字典、样式守卫、真实 Electron 既有 Session 身份 | 6 文件 96 例：其余 5 文件 86 例通过；搜索 9 通过/1 失败，因为 Chromium 将 `round` 规范化为 `superellipse(1)`，随后改为与既有列表测试一致的实际计算值，重跑搜索最终 10/10 | 最终有效证据全部通过；未把最初失败运行称作全绿 |
| Electron 用例 `search opens the identical existing pinned project Session without creating a conversation` | 多个会话中搜索目标并 Enter 打开；HTTP 读回 Session 列表、目标 id/projectId/pinnedAt；会话数量和数据未改变 | 1 例，包含于上行其余 86 例 | 通过 |
| `pnpm run typecheck` | 所有 workspace 类型 | 退出 0 | 通过 |
| `pnpm run check:docs` | Markdown 链接、元数据与引用方向 | 最终记录见票 Comments | 通过 |
| `pnpm exec oxlint apps/desktop/src/renderer/features/sidebar/conversation-search.tsx apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.tsx apps/desktop/src/renderer/features/sidebar/sidebar-rail.tsx apps/desktop/src/renderer/app/app.tsx apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/e2e/conversation-search.e2e.test.ts` | 受影响 TS/TSX | 退出 0 | 通过 |
| `git diff --check` | 空白与补丁 | 退出 0 | 通过 |

TDD 失败证据：组件不存在时首用例无法导入；重复高亮用例只得到首处 `mark`；归档菜单接入前两例找不到归档项；这些都在实现后通过。右键边缘用例发现 transformed DialogContent 内 fixed 锚点偏移，使用 portal 保持 viewport 坐标，同时保留 React 内层事件祖先，避免误关搜索与抢走 inline rename 焦点。

实际几何：1000×800 下浮层 640×432、内边距 12、R28；输入 H40；共享 SidebarListRow 为 H32/R8，Chromium 计算曲线为 `superellipse(1)`（圆弧）。390×300 下宽 358、最大高 268，菜单在 8px 窗口边缘内。light/dark 中文空状态、正常结果和删除叠层截图由用例生成至本地 `.vitest/cw22-search-*.png`；已读图核对共享遮罩、文字层级、标签和内部滚动。删除截图等待不透明度到 1 后保存，避免把入场动画当作材质。

样式例外仅登记 `conversation-search.tsx` 的 `role="listbox"`：已批准的共享 Dialog 模态搜索中，combobox 需要 listbox 语义而不需要第二份菜单表面。使用正式精确例外机制，不改变守卫规则与其他文件范围。

## 文档影响

| 正文变化 | 所属文档 | 消费者与动作 | 读回结果 |
| --- | --- | --- | --- |
| 从过渡侧栏标题过滤改为完整模态搜索 | `docs/subsystems/workbench.md` | 原地新增搜索节，当前导航摘要增加搜索；旧 M1 与 02 历史证据保留原意 | AGENTS → docs/README → workbench 搜索节可达，active 当前行为与代码/测试链接一致 |
| 搜索数据与操作共享既有会话身份 | 同上 | 当前正文独立说明列表来源、标题边界、菜单与导航；无正式文档依赖本任务材料 | 语义同步、归属、引用方向、生命周期、当前入口、历史保留均通过 |

## 结论与限制

票 22 的 Browser 与 Electron 验收均满足；搜索不调用新建会话，选择仅走 WorkbenchNavigation.openSession。结果及菜单保留 Session 身份，归档、项目关系更新直接来自共享 store。

本地已验证，不代表 CI、全仓测试、安装包签名或跨平台验证。搜索无真实模型调用，因此未运行真实模型 API；真实 Electron 证据使用真实 Sidecar、真实 HTTP 与本机窗口。当前材料仅在本地分支提交，无 push/PR。
