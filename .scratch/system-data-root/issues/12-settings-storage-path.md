# 12: 设置存储路径

**What to build:** 设置界面增加只读的存储区域，显示主数据根 `~/.coko`（或 `COKO_HOME` 指向的实际路径）与独立会话根 `<Documents>/Coko` 的实际路径，并提供“打开目录”按钮。路径不能在这里修改。

**Blocked by:** 01 主数据根切换到 ~/.coko；10 新建空白项目

**Status:** ready-for-agent

- [x] 设置界面能看到主数据根与独立会话根的实际绝对路径，`COKO_HOME` 覆盖时显示覆盖后的路径。
- [x] “打开目录”按钮能打开对应目录；目录不存在时给出明确提示而不崩溃。
- [x] 界面不提供修改路径的输入框；说明路径由环境变量控制。
- [x] 浏览器测试覆盖路径展示与打开按钮调用；桌面 e2e 覆盖设置分区的实际文本。


Closed: true

## Comments

### 2026-11-05 实施与验证

- 独立 worktree `/tmp/coko-sdr-12`、分支 `codex/system-data-root-12` 基于集成 `59491b38`。覆盖规格故事 33–34 与设计中的只读存储展示；不修改 Electron userData、主根选择或原生文件系统接口。
- `StoragePathsResponse` 与 `GET /api/storage` 返回本次启动配置的 `{ home, chatsRoot }`。来源为 runtime 装配的只读 Application 数据，不保存在偏好设置中。设置 → 常规新增存储卡，显示完整可选择路径和环境变量说明；只读无输入框。目录打开经现有 `window.coko.openDirectory`，失败显示路径与可重试错误；路径读取失败可重试，卸载后忽略迟到响应。
- TDD：真实 Sidecar 请求起初 404，接入后返回实际覆盖路径；Browser 起初无路径元素，接入后能打开对应目录；打开失败起初无错误，接入后显示并允许重试；读取失败起初无可操作错误，接入后可重试恢复。没有新增未确认测试接缝。
- `rtk pnpm run test tests/integration/sidecar-storage-paths.test.ts apps/desktop/src/renderer/features/settings/storage-card.browser.test.tsx apps/desktop/src/renderer/features/settings/developer.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts packages/ui/src/guards/style-guard.test.ts`：退出 0，6 文件 71 项通过，无过滤。包含实际运行路径、只读接口、与可编辑设置隔离、路径展示/正确打开回调、读取和打开失败重试，以及 390px 的中英文长路径换行、明暗主题和键盘调用。
- `rtk pnpm run test apps/desktop/e2e/storage-paths.e2e.test.ts`：退出 0，1 文件 1 项通过。使用本次 package globalSetup 构建的真实后台 Electron 与真实 Sidecar，验证 COKO_HOME、COKO_CHATS_ROOT 实际文本、无路径输入框及不存在目录的原生 bridge 失败反馈。没有激活窗口；未实际打开 Finder 或外部应用。
- `rtk pnpm run typecheck`：退出 0；改动的 12 个 TS/TSX 文件执行 `rtk pnpm run format <改动文件>`、`rtk pnpm run lint <改动文件>`，均退出 0。`rtk git diff --check` 退出 0。
- 文档事实归 `docs/subsystems/configuration.md` 的主数据根、协议与界面章节；`docs/README.md` 和 `docs/subsystems/workbench.md` 同步导航/消费者，无新类别或 ADR。`rtk pnpm run check:docs` 退出 0（378 个 Markdown、0 问题）。按 AGENTS → 导航 → 配置正文读回：路径引用、语义、归属权威、引用方向、生命周期、入口、新会话读入与历史保留均通过。
- 实际浏览器输出已检查：新卡复用 SettingsCard，长路径换行且无横向溢出；读取失败与打开失败画面均读图核对。Windows 实机、真实模型、真实指针和成功打开原生目录未验证；本票未推送、未发布。

### 扩展检查中的已证明基线失败（交给 13 联合验收处理）

- 扩展命令：`rtk pnpm run test tests/integration/sidecar-storage-paths.test.ts tests/integration/sidecar-config.test.ts apps/desktop/src/renderer/features/settings/storage-card.browser.test.tsx apps/desktop/src/renderer/features/settings/developer.browser.test.tsx apps/desktop/src/renderer/features/settings/sections.browser.test.tsx apps/desktop/src/renderer/features/settings/settings-page.browser.test.tsx packages/i18n/src/index.test.ts packages/ui/src/guards/style-guard.test.ts`，退出 1：8 文件 79 项通过、9 项失败。未为这些失败修改产品或旧测试。
- 基线复现：在未含本票的 `/tmp/coko-sdr-09`（`d350ab9e`，树与集成 `59491b38` 一致）运行 `rtk pnpm run test tests/integration/sidecar-config.test.ts apps/desktop/src/renderer/features/settings/sections.browser.test.tsx apps/desktop/src/renderer/features/settings/settings-page.browser.test.tsx`，退出 1：3 文件 12 项通过、同样 9 项失败。均非本票新增回归。
- `tests/integration/sidecar-config.test.ts` 两个标题：`返回有效值、全局值、revision 与项目诊断；项目只收紧；过期 revision 409；通用设置接口不能写 config；改文件后下一次 GET 读到新值`；`项目 deny 规则在 full-access 下拒绝调用（改文件后下一个 Run 生效），项目 allow 规则不放行；全局、Workspace 与 Session 规则照常`。期望 `/var/...`、实际规范化 `/private/var/...`。
- `apps/desktop/src/renderer/features/settings/sections.browser.test.tsx` 五个标题：`菜单按个人、环境、插件、模型分组，关于不属于任何分类且在最后；未交付的外观不出现`；`zh：设置菜单按分类显示标题与菜单项，关于在最底部且无分类标题`；同标题的 `en：` 参数；`键盘按菜单顺序在菜单项间移动，焦点环可见，Enter 打开分区`；`M5 的注册表行都已交付：设置菜单中有子代理并可打开；右栏 tab 与标题栏操作含子代理`。前四个遗漏已有 archived 导航，最后一个仍期待已移除的 cost/handoff 标题操作。
- `apps/desktop/src/renderer/features/settings/settings-page.browser.test.tsx` 两个标题：`外壳几何与源稿画面 01 一致：导航 240px、安全区 48px、返回行 H36、搜索框 H32/R12、菜单项 H32/R12、详情最宽 800px 居中`（期望 left 440、两边基线与本票均实际 438，应检查滚动区域 clientWidth，不能盲目放宽容差）；`可访问性：设置是带标题的 region，Tab 依次经过返回、搜索与菜单项；焦点环可见`（期待第三项 memory，实际已有 archived）。

### 2026-11-05 合入 Artifacts 后的联合检查

- 合入集成 `443e161a` 时，Application 顶部导入与中英文字典各有新增块冲突；保留 ArtifactService / StoragePathsResponse、artifacts / storage 两侧声明。runtime、HTTP 路由与导航自动合并，无行为取舍。
- `rtk pnpm run typecheck`：退出 0。`rtk pnpm run test tests/integration/sidecar-storage-paths.test.ts tests/integration/sidecar-artifacts.test.ts apps/desktop/src/renderer/features/settings/storage-card.browser.test.tsx apps/desktop/src/renderer/features/right-panel/artifacts-tab.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts`：退出 0，6 文件 26 项通过，无过滤。三处解决冲突的源码格式与 lint 检查通过。
