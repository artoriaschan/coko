# 05: Artifact 接口与右栏 tab

**What to build:** 独立会话的右栏新增 Artifacts tab，实时列出 `outputs/` 下的文件树。用户可以看文件名、相对路径和大小，用默认应用打开文件、在 Finder 中显示、复制路径。文件被覆盖或删除后列表立即反映；隐藏文件与指向 `outputs/` 外的符号链接不显示。项目会话与旧会话不显示该 tab。

**Blocked by:** 03 独立会话目录与 work/outputs

**Status:** ready-for-agent

- [x] 独立会话的右栏可以打开 `artifacts` tab，空 `outputs/` 显示明确的空态。
- [x] 列表包含子目录中的普通文件，显示相对路径；点击文件可以用默认应用打开，支持在 Finder 中显示与复制路径。
- [x] `outputs/` 下新增、覆盖或删除文件后，重新打开或刷新 tab 能看到变化，不保留历史版本或“已删除”占位。
- [x] 以 `.` 开头的隐藏文件、指向 `outputs/` 外的符号链接不出现在列表；越界链接不会被跟随。
- [x] 项目会话、没有 `directory` 的旧会话不显示 Artifacts tab。
- [x] Artifact 列表通过 sidecar 的 HTTP 接口读取，renderer 不直接访问文件系统；集成测试覆盖过滤与实时变化，浏览器测试覆盖 tab 的空态与文件操作。


Closed: true

## Comments

2026-11-05 — 05 号票实施完成。独立 worktree 基于集成分支创建；本票采用规格 Testing Decisions 已确认的真实 Sidecar、Browser Mode 与桌面 E2E 接缝。

- 真实 Sidecar 首条清单用例先因接口 404 失败，接入 ArtifactService/HTTP 后通过。磁盘树是唯一来源；覆盖空态、子目录、覆盖/删除实时读回、隐藏项、越界文件/目录链接、`outputs/` 根被替换、项目/旧会话不可用，以及普通 POSIX 文件名。目录大小为 0，mtime 使用文件系统实际读回值。
- 文件操作先调用 resolve 接口重新核对相对路径、真实根与链接，再交给原生 bridge 或剪贴板；原生 revealFile 与已有 openFile 复用同类受控边界。renderer 不导入文件系统。
- Artifacts 在挂载期间串行轮询并支持刷新；切换会话/卸载会中止请求与清理计时器。Browser Mode 验证空态、文件树、三种操作、实时删除、错误时保留清单和刷新重试，以及 300px 长文件名无横向溢出。项目归属变化后过滤已打开页面并显示有效后备页。
- `rtk pnpm run test tests/integration/sidecar-artifacts.test.ts apps/desktop/src/renderer/features/right-panel/artifacts-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.test.ts apps/desktop/src/main/open-directory.test.ts packages/ui/src/guards/style-guard.test.ts`：6 文件、65 项通过，退出 0；随后新增 POSIX 文件名断言的精确 Sidecar 文件重跑 2 项通过，退出 0。
- `rtk pnpm run test apps/desktop/e2e/artifacts.e2e.test.ts`：1 文件、1 项通过，退出 0。globalSetup 构建并打包当前源码，后台 Electron 验证新文件出现、删除消失、打开/显示 bridge、移入 Project 后隐藏入口与已有页面。保留真实 Sidecar/preload/main，只在 shell 的打开/显示边界记录参数；未启动外部文件应用或占用前台。
- `rtk pnpm run typecheck` 退出 0；变更 TypeScript 文件的 `oxfmt` 与 `oxlint` 退出 0；`rtk git diff --check` 退出 0；`rtk pnpm run check:docs`：378 Markdown、0 问题，退出 0。
- 文档影响：当前 Artifact 行为、HTTP 与原生边界归 `docs/subsystems/workbench.md`，导航摘要与旧的固定六页描述同步。已从 AGENTS → docs/README → 工作台正文读回；链接、语义、归属、引用方向、生命周期、导航和历史保留均通过，无新增目录或 ADR。
- 已检查后台 Electron 明暗主题实际截图；未验证 Windows 实机、真实模型、原生 Finder 前台交互或启动外部文件应用。此票不修改模型行为、不推送、不发布。

集成读回：实施提交 `ffb573c`；合入最新集成基线 `59491b38`（含空白项目、插件迁移）。仅 `docs/README.md` 导航的相邻摘要冲突，已同时保留 Artifacts 与空白项目说明；源码无冲突。合并后 `rtk pnpm run test tests/integration/sidecar-artifacts.test.ts tests/integration/sidecar-blank-project.test.ts apps/desktop/src/renderer/features/right-panel/artifacts-tab.browser.test.tsx`：3 文件、8 项通过，退出 0；`rtk pnpm run typecheck` 退出 0；`rtk pnpm run check:docs`：378 Markdown、0 问题。首次实施提交仅因消息正文行长被 commitlint 拒绝，换为带实际换行的消息文件后成功，代码未受影响。
