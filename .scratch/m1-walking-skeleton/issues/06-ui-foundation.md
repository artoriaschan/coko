# 06: 界面基础：设计 token、组件与三栏骨架

**What to build:** packages/ui：按 [界面约定](../../../docs/tech-stack/ui.md) 与 [设计系统规格](../../../docs/tech-stack/ui-design-system.md) 落地 token、Tailwind 4 主题、`cn()`、所需 shadcn 组件、MarkdownRenderer（Streamdown + 插件）、Sonner Toast（登记版本）；packages/i18n 的 zh / en 字典；renderer 三栏布局（侧栏、中栏、右栏、rail、窄窗口收起）与主题 / locale 切换，使用静态数据。几何沿用 [信息架构决定](../../desktop-app/issues/08-grill-desktop-information-architecture.md)。

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Browser Mode 测试：明暗主题、侧栏宽度范围与 <1024 自动收起、390px 中栏无整页横向滚动
- [x] MarkdownRenderer 渲染代码、表格、数学与 mermaid
- [x] 所有文案来自 i18n 字典，切换语言即时生效
- [x] 样式守卫（若已接入）通过；没有字面量颜色

## Comments

### 2026-10-28 实施回执（m1/06-ui-foundation）

覆盖验收：四项全部满足。

- packages/ui：`src/styles/theme.css`（色板 → 语义 token → `@theme`；清空默认 color / radius / shadow 命名空间；六档圆角、`text-ui-*` 七档、`shadow-panel/prominent/soft` 含 0.5px elevation 描边、superellipse、`rounded-round`、`border-hairline` 系列、菜单材质、滚动条、焦点环、拖拽区、Markdown 排版）；`cn()`（extendTailwindMerge 登记项目类）；shadcn CLI 4.21.4 生成的 button、tooltip、dropdown-menu、separator、sonner 按设计系统改写；`MarkdownRenderer`（Streamdown + code/math/mermaid/cjk，控件文案由调用方传入）；`AppFrame`（侧栏 264–420 默认 280、rail 56、帧宽 <1024 自动收起且以抽屉展开、右栏 45%/≤70%/≥300 及让位规则）；样式守卫。
- packages/i18n：类型化 zh/en 字典（en 由 `Dictionary` 类型约束同构）、`createTranslator`（`{name}` 插值）、`resolveLocale`。
- renderer（`apps/desktop/src/renderer`，按 architecture.md 分 `app/`、`features/`）：静态数据的三栏骨架、按工作区分组的会话列表（每组 5 行，Show more +5）、rail、消息流、composer 外壳、右栏、外观菜单（主题 / 语言）、Toast。
- Sonner 2.0.8 已登记到 TECH_STACK。

运行的命令与结果（合入 main 46a00ec 后）：

- `pnpm install --frozen-lockfile`：退出 0。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run format:check`、`pnpm run check:docs`（59 个文件 0 问题）：全部退出 0。
- `pnpm run test`：26 个文件、200 个用例通过。其中本票：i18n 10、ui 45（cn 4、样式守卫 40、入口 1）、ui-browser 17（AppFrame 13、MarkdownRenderer 3、原有冒烟 1）、desktop-renderer 8。
- 样式守卫按测试约定临时向 renderer 的真实文件注入违规样例：color、radius、round-curve、material、menu、hover、scrollbar、drag-region、copy 九条规则都因预期原因失败，撤销后恢复通过。
- `pnpm --filter @coko/desktop build:renderer`：构建成功。主 chunk 约 1.5 MB（mermaid / shiki），尚未做拆分。
- 视觉检查：Vite 开发服务器加 Playwright，在 1280px 与 390px 宽度下截取明暗两种主题，并截取深色主题下打开外观菜单的状态，人工核对对齐、材质与溢出。

未验证：

- Electron 实机（红绿灯避让 `--frame-leading-clearance: 72px`、vibrancy、`-webkit-app-region` 拖拽区实效），留给票 05 与 07 的 E2E。
- hover、pressed 状态只做了截图层面的检查，没有逐一断言。
- 主题与语言在重启后的持久化（属于票 08）。

偏离与说明：

- shadcn CLI 4.21.4 的 new-york-v4 registry 从 npm 包 `cn` 导入类名工具，并依赖 next-themes。生成后改为导入本包的 `cn()`，移除这两个依赖，已写入 TECH_STACK。
- Vite 配置放在 `apps/desktop/src/renderer/vite.config.ts`；architecture.md 的目标结构把它放在 `apps/desktop/vite.config.ts`。为避免与票 05 冲突，本票没有移动它。票 05 接线时可以移到根目录，或者直接复用。
- 范围外的最小改动：`apps/desktop/package.json`（依赖与 `dev:renderer`、`build:renderer` 脚本）、`apps/desktop/tsconfig.json`（排除 `src/renderer`）、新增 `apps/desktop/vitest.browser.config.ts`、根 `tsconfig.json` 引用 renderer 项目、`.gitignore` 忽略 `.vitest/`、`pnpm-lock.yaml`。

文档影响：TECH_STACK（接入状态、Toast 行、shadcn `cn` 说明）；ui-design-system.md（主题样式表位置、字号档位、发丝线工具类、样式守卫改为已接入）；ui.md（去掉"计划接入"）。
- 2026-10-28 lead：与票 05 的冲突由合并子代理在本分支解决（b242a5a），随后合入 main（62b9858）。main 上复核：install、typecheck、lint、format:check 退出 0；test 32 文件 256 用例通过；check:docs 0 问题。接受 renderer 依赖全部作为 desktop devDependencies（由 Vite / tsdown 打入产物）。worktree 已清理。

Closed: true
