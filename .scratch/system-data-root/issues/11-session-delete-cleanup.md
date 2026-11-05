# 11: 删除清理与归档

**What to build:** 删除独立会话时，只有当会话目录除 `work/`、`outputs/` 外没有其他内容，且这两个目录都为空，才删除目录，并删除没有其他会话引用的 Workspace 记录；否则保留目录，并在删除确认中显示保留路径。删除同时清理该会话的附件与工具结果目录，保留 MCP 数据。归档会话不删除任何文件。

**Blocked by:** 03 独立会话目录与 work/outputs；06 附件副本；07 超长工具结果落盘

**Status:** ready-for-agent

- [x] 删除一个只有空 `work/`、`outputs/` 的独立会话后，会话目录被删除，Workspace 记录被清理。
- [x] 删除一个有内容的会话后，目录与 Workspace 记录保留，确认框显示保留路径并允许复制。
- [x] 删除会话时 `data/attachments/<sessionId>/` 与 `data/tool-results/<sessionId>/` 被清理；`data/mcp/` 不受影响。
- [x] 归档会话不删除目录、附件或工具结果；恢复后内容完整。
- [x] 项目会话的删除不删除项目目录。
- [x] 集成测试覆盖空目录清理、非空保留、附件与工具结果清理、归档不删；桌面 e2e 覆盖确认框中的保留路径。


**Closed:** true

## Comments

### 2026-11-05 — 实施与接缝证据

- 独立 worktree `/tmp/coko-sdr-11`，基于集成分支 `41b4a20d`；同一票持续使用新建的 11 号实施代理，未复用其他代理。
- 删除预览由 `GET /api/sessions/:id/delete-preview` 提供当前保留路径；确认窗在预览失败时禁止提交并支持重试，保留路径完整显示、可复制，长路径和复制失败在明暗主题与 390×400 窗口内可操作。
- `SessionFiles` 在删除后重新检查磁盘，只用 `rmdir` 删除真正为空的会话根与 `work/outputs`，其他文件、隐藏文件、链接、共享 Session 绑定和项目文件夹都保留；清理成功后仅删除未被引用的 Workspace。会话与后代的附件和工具结果按各自编码后的身份清理，MCP 数据、项目/Worktree 文件保留；归档与恢复不执行磁盘清理。
- 联合生命周期补齐：分叉的工具结果此前保留源会话路径（真实 Sidecar 红测捕获）；现在在分叉提交前复制被历史引用的普通结果文件并重写路径，提交失败回滚副本。源会话删除、重启后，分叉可在自己的只读根内读取文件，无跨会话读权限扩张。
- 红 → 绿：新增空目录删除用例先因预览 API 404 失败，随后验证目录及 Workspace 清理通过；保留路径 Browser 用例先因缺少路径区域失败，加入真实预览/复制 UI 后通过；项目引用空目录用例捕获误删目录，再增加项目文件夹保护后通过。

实际检查（均从该 worktree 执行）：

| 命令 | 范围与结果 |
| --- | --- |
| `rtk pnpm run test tests/integration/sidecar-session-cleanup.test.ts tests/integration/sidecar-delete-session.test.ts tests/integration/sidecar-archive-session.test.ts tests/integration/sidecar-delete-project.test.ts tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-rewind.test.ts apps/desktop/src/renderer/stores/chat-store-delete.test.ts` | 7 文件、34 项通过；覆盖空/非空/隐藏/链接、预览后写入、共享与项目引用、归档恢复、分叉结果副本、删除 busy 与原有附件/回退 |
| `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/session-delete-dialog.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx` | 2 文件、27 项通过；新增路径复制、预览重试/禁用、复制错误、明暗主题及窄窗口；旧菜单几何与焦点回归 |
| `rtk pnpm run test apps/desktop/e2e/session-delete.e2e.test.ts` | 后台真实 Electron 1 文件、2 项通过；旧父子会话重启删除和新保留目录确认 |
| `rtk pnpm run test apps/desktop/src/renderer/features/sidebar/session-delete-dialog.browser.test.tsx tests/integration/sidecar-session-cleanup.test.ts tests/integration/sidecar-delete-session.test.ts` | 最后路径按钮布局及后代数据断言变更后，3 文件、12 项通过 |
| `rtk pnpm run test apps/desktop/e2e/session-delete.e2e.test.ts -t 'standalone deletion'` | 路径按钮布局变更后刷新产物，1 项通过，另 1 项按过滤器未运行 |
| `rtk pnpm run typecheck` | 通过；新测试 payload 明确收窄后无错误 |
| `rtk pnpm run check:docs` | 378 个 Markdown，0 问题 |
| `rtk pnpm exec oxfmt <改动 TS 文件>`、`rtk pnpm exec oxlint <改动 TS 文件>` | 16 个 TypeScript 文件格式化及 lint 通过 |

文档影响与读回：更新 [项目与会话](../../../docs/subsystems/projects.md#永久删除对话) 的预览、文件/Workspace 清理与归档边界；更新 [执行](../../../docs/subsystems/execution.md#工具结果落盘) 的分叉私有文件所有权，并同步总导航摘要。从 AGENTS → 文档导航 → 两处正文读回，路径与引用、语义、归属、引用方向、生命周期、入口和历史保留检查均通过；未新建正式文档类别。明暗主题截图保存在被忽略的 `.vitest/sdr11-delete-*.png`，已查看实际渲染；长路径可滚动，复制按钮在路径旁保持可见。

限制：Windows 只审查 Node 文件系统 API 与路径假设，未实机运行；未调用真实模型或前台原生窗口/真实指针；复制路径在 Browser Mode 替换剪贴板边界验证，Electron E2E 检查保留路径与按钮，不改用户剪贴板。SQLite 删除与文件系统清理不是跨系统事务，私有数据清理错误会向调用方报告，目录检查或 rmdir 竞态失败保留目录；未声称整仓测试或 CI 通过。仅本地提交，未推送/发布。


合入最终前置集成 `3d048250`（插件、Artifacts 与存储设置）后，仅 `docs/README.md` 相邻导航摘要发生冲突，按 resolving-merge-conflicts 保留两边语义；源码、协议与字典自动合并。合并工作区验证：

- `rtk pnpm run typecheck`：退出 0。
- `rtk pnpm run test tests/integration/sidecar-session-cleanup.test.ts tests/integration/sidecar-artifacts.test.ts tests/integration/sidecar-storage-paths.test.ts apps/desktop/src/renderer/features/sidebar/session-delete-dialog.browser.test.tsx apps/desktop/src/renderer/features/settings/storage-card.browser.test.tsx apps/desktop/src/renderer/features/right-panel/artifacts-tab.browser.test.tsx apps/server/src/application/session-delete.test.ts`：7 文件、22 项通过，未过滤。
- 另行 `rtk pnpm run test apps/server/src/application/session-delete.test.ts`：2 项通过（与联合检查有重叠，不累加为不同用例）。
- `rtk pnpm run check:docs`：378 个 Markdown，0 问题；从总导航同时读回 Artifact、存储和空目录清理摘要，均保留有效入口。
