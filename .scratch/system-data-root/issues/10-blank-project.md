# 10: 新建空白项目

**What to build:** 用户在侧栏新建空白项目，输入名称后 Coko 在 `<Documents>/Coko/projects/<名称>` 创建目录，注册 Project 与 Workspace，并打开一个以该项目为归属的新会话。名称去掉首尾空白、路径分隔符和前导点，空名称回退为“新项目”，重名追加 `-2`、`-3`。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [x] 侧栏的“新建项目”流程提供“空白项目”入口，输入名称后目录出现在 `Documents/Coko/projects/` 下并自动打开新会话。
- [x] 名称中的路径分隔符与前导点被去掉，首尾空白被裁剪；空名称创建名为“新项目”的目录。
- [x] 同名目录已存在时追加 `-2`、`-3`，不覆盖已有目录。
- [x] 创建成功后 Project 列表出现该项目，新会话的归属与主要 Workspace 正确；创建失败时不留下半成品项目或目录。
- [x] 现有的“添加已有文件夹”创建项目流程不回归。
- [x] 桌面 e2e 覆盖空白项目创建、重名、名称清洗与新会话发送。


Closed: true

## Comments

### 2026-11-05 实施与验证

- 在独立 worktree 和分支 `codex/system-data-root-10` 实施。覆盖规格故事 26–28 与设计中的空白项目路径；不改变项目权限、已有 Session cwd 或既有文件夹创建语义。
- `CreateProjectRequest` 在现有名称/目录格式外增加 `{ mode: "blank", name }`。ProjectService 从配置的 chatsRoot 分配 `projects/<名称>`，移除分隔符、前导点和首尾空白，空名采用“新项目”；通过非递归 mkdir 原子分配冲突后缀。沿用 50 字符项目名称上限，追加后缀时按字符收短原名。失败清理只针对本次空目录与未被引用的 Workspace，不递归删除用户文件。
- 创建表单增加“新建空白项目”/“添加已有文件夹”切换；表单继续由应用层提交并沿用各入口 onComplete，新项目预选后进入新对话。空白模式允许空名；提交错误保留草稿。
- TDD：真实 Sidecar 初始返回 400（缺少空白请求格式）→ 实现后通过；浏览器初始找不到空白入口 → 接入后通过；50 字符重名初始 400 → 后缀收短后通过；点与空白混合前缀初始返回 `.nested` → 清洗后返回 `nested`。测试均通过公开 HTTP、真实磁盘或浏览器 UI 判定。
- `rtk pnpm run test tests/integration/sidecar-blank-project.test.ts tests/integration/sidecar-create-project.test.ts tests/integration/sidecar-edit-project.test.ts tests/integration/sidecar-projects.test.ts apps/server/src/application/projects.test.ts apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：退出 0，7 文件 52 项通过，无过滤。覆盖名称清洗、空名、并发重名、已有内容保留、重启、项目首次发送固定 cwd、目录失败不留记录、已有文件夹创建编辑回归及样式守卫。
- `rtk pnpm run test apps/desktop/e2e/create-project.e2e.test.ts`：退出 0，1 文件 2 项通过。测试构建的真实后台 Electron 覆盖已有目录创建、空白项目从侧栏进入、清洗与重名、新对话归属和发送；未激活前台。后续清洗修正增加点/空白混合边界，原 E2E 输入由 Sidecar 最终源码再次覆盖。
- Browser Mode 6 项通过，新增空白模式的失败重试、空名提交、切回文件夹流程，以及亮/暗主题 390px 窄窗无横向溢出；截图在本地忽略目录 `.vitest/blank-project-{light,dark}-narrow.png`。既有创建/编辑几何与交互测试继续通过。
- `rtk pnpm run typecheck`：退出 0。改动 TS/TSX 的 oxfmt 与 oxlint：退出 0。
- 文档影响：当前创建/API/冲突/回滚事实归 `docs/subsystems/projects.md`，总导航摘要同步 `docs/README.md`；无新类别、无新 ADR。`rtk pnpm run check:docs`：退出 0，378 个 Markdown，0 问题。按 AGENTS → 文档导航 → 项目正文读回；路径与引用、语义、归属、引用方向、生命周期、入口、新会话读入、历史保留均通过。
- 本地验证未覆盖 Windows 实机、真实模型、真实鼠标/原生目录选择层或签名发布；无真实用户 ~/.coko/Documents 写入，未推送、未发布。合并最新集成基线后的检查见下条。

- 最终同步：实施提交 `c9db95fc` 后，将集成分支 `bbde17a9` 合入为 `eeca3eea`，无冲突，保留附件/MCP 的协议、装配与字典变化。合并后 `rtk pnpm run test tests/integration/sidecar-blank-project.test.ts apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx` 退出 0（2 文件 8 项全通过）；`rtk pnpm run typecheck` 与 `rtk pnpm run check:docs` 均退出 0（378 文件、0 问题）。明暗窄窗截图已实际读图核对，文字、按钮和边界完整，无横向溢出。
