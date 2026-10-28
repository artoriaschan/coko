---
kind: technical-spec
description: "项目已选技术、精确版本、兼容性约束及专项技术规范入口。"
lifecycle: active
---

# Tech Stack

采用 `@earendil-works/pi-agent-core` 作为 Agent 执行核心，pi 相关依赖统一为 **1.4.0**。**tsdown 0.22.2** 构建 Electron main / preload、sidecar、Agent 与共享模块；**Vite 8.3.1** 构建 React 渲染进程；桌面开发、打包和发布入口统一使用 **Electron Forge 8.0.1**。

本文件维护项目已选技术及版本约束。依赖版本精确锁定，不使用 `^`、`~` 或 `latest`；升级时同步更新实际存在的 manifest、`pnpm-lock.yaml` 和本文件；项目尚未具备这些文件时，不声称已完成依赖锁定或安装验证。其余版本沿用既有选型，新引入或因兼容要求调整的版本在对应章节说明。

详细约定按 [技术规范导航](tech-stack/README.md) 分层维护。本文保存已选技术与版本，专项页保存项目级接入和结构约束；原有候选与待决项不因拆分而变成已批准决定。当前实现说明另按实际证据建立。

## 仓库与全局基线

| 用途 | 选型 |
| --- | --- |
| 包管理与 workspaces | pnpm 12.15.0，由根 `package.json` 的 `packageManager` 锁定；workspace 与安装设置在 `pnpm-workspace.yaml` |
| 语言 | TypeScript 6.0.3 |
| 构建工具宿主 | Node.js 24.15.0；pnpm、Forge CLI、tsdown、Vite 和 Vitest 使用 Node.js 执行 |
| 测试 | 统一使用 Vitest 5.0.3，覆盖 Agent、服务端、Electron main / preload 和 UI |
| 依赖锁定 | manifest 精确版本 + `pnpm-lock.yaml`；构建与验收使用 `pnpm install --frozen-lockfile` |

pnpm 负责依赖管理和脚本入口。产品运行时只有 Electron：main / preload 与 sidecar（Hono 服务和 Agent）都使用 Electron 41.0.3 内置的 Node.js 24.14.0，sidecar 以 `ELECTRON_RUN_AS_NODE=1` 运行；renderer 使用 Chromium。开发机的 Node.js 24.15.0 只运行工具链，与 Electron 内置版本分别管理。选择依据见 [ADR 0001](adr/0001-sidecar-on-electron-node.md)。

### 接入状态

下表之外的选型在对应切片实际使用时才写入 manifest，未写入前只是已选技术，不代表已安装或验证。截至 M1 仓库脚手架，manifest 与 `pnpm-lock.yaml` 已声明：

| 位置 | 已声明依赖 |
| --- | --- |
| 根 `package.json` | typescript、vite、vitest、@types/node、oxlint、oxfmt、husky、lint-staged、@commitlint/cli、@commitlint/config-conventional、mdast-util-from-markdown |
| apps/desktop | electron、vitest；renderer：react、react-dom、lucide-react、@coko/ui、@coko/i18n，开发依赖 vite、@vitejs/plugin-react、@tailwindcss/vite、@types/react、@types/react-dom、vitest-browser-react、@vitest/browser-playwright、playwright |
| packages/ui | radix-ui、class-variance-authority、clsx、tailwind-merge、tailwindcss、tw-animate-css、lucide-react、streamdown、@streamdown/code、@streamdown/math、@streamdown/mermaid、@streamdown/cjk、katex、sonner；peer react、react-dom；开发依赖 react、react-dom、@types/react、@types/react-dom、vite、@vitejs/plugin-react、@tailwindcss/vite、typescript（样式守卫解析 TSX）、vitest、vitest-browser-react、@vitest/browser-playwright、playwright |
| packages/i18n | vitest |
| apps/server 与其余 packages | vitest |

根脚本：`typecheck`（`tsc -b`）、`lint`（`oxlint`）、`format` / `format:check`（`oxfmt`）、`test`（`vitest run`，含 ui 的 Browser Mode 项目）、`check:docs`。husky 的 pre-commit 运行 lint-staged（oxfmt、oxlint），commit-msg 运行 commitlint。Browser Mode 使用 Playwright 的 Chromium，缺少时运行 `pnpm exec playwright install chromium`。Agent 宿主环境可能带 `ELECTRON_RUN_AS_NODE=1`，`pnpm install` 和启动 GUI Electron 前须清除。

## 仓库架构

仓库结构、模块职责与依赖、运行链路及构建与测试归属见 [项目架构约定](tech-stack/architecture.md)。

## Agent

| 用途 | 选型 |
| --- | --- |
| Agent 循环、工具执行、事件流、steering 与 follow-up | **@earendil-works/pi-agent-core 1.4.0** |
| 模型调用与 provider 适配 | **@earendil-works/pi-ai 1.4.0** |
| MCP 客户端 | **@earendil-works/pi-mcp 1.4.0** |
| pi 遥测契约 | **@earendil-works/pi-telemetry 1.4.0**；作为 pi-ai 的传递依赖对齐，业务直接使用时再显式声明 |
| 工具参数与协议 schema | typebox 1.3.27，与 pi-agent-core / pi-ai 对齐 |
| HTML → Markdown | turndown 7.2.4 + @joplin/turndown-plugin-gfm 1.0.68 |
| HTML 内容过滤 | @mixmark-io/domino 2.2.0；复用 turndown 的 DOM，在 GFM 转换前删除隐藏子树 |
| HTML 转换类型 | @types/turndown 5.0.6，仅 devDependency |
| 公网 HTTP 请求 | undici 8.11.2 |
| 文件修改与工具卡 diff | diff 8.0.4，支持 unified / split 展示 |
| glob 与内置 grep 的 gitignore 匹配 | ignore 7.0.8 |
| 桌面端 grep 二进制 | @vscode/ripgrep 1.18.0，仅 apps/desktop 依赖；macOS arm64 资源为 @vscode/ripgrep-darwin-arm64 1.18.0；sidecar 装配时覆盖内置 grep，见 [内置 ripgrep](tech-stack/desktop-delivery.md#内置-ripgrep) |
| 模型协议 | Chat Completions、Responses、Anthropic Messages |

Agent 与应用层的职责、框架能力分工、模块内部结构、生命周期、Goal 机制和能力落地顺序见 [Agent 执行约定](tech-stack/agent-runtime.md)。

### pi 版本约束

根 `pnpm-workspace.yaml` 使用以下 overrides，约束同名包的解析版本；各 workspace 仍须显式声明自己直接使用的依赖。

```yaml
overrides:
  '@earendil-works/pi-agent-core': 1.4.0
  '@earendil-works/pi-ai': 1.4.0
  '@earendil-works/pi-mcp': 1.4.0
  '@earendil-works/pi-telemetry': 1.4.0
  typebox: 1.3.27
```

统一为 1.4.0 的范围是实际使用的 pi 包；TypeBox 和其他第三方支撑库保留各自版本号。pi-agent-core 与 pi-ai 的 1.4.0 包均精确依赖 typebox 1.3.27。[pi-agent-core 包元数据](https://registry.npmjs.org/@earendil-works/pi-agent-core/1.4.0)、[pi-ai 包元数据](https://registry.npmjs.org/@earendil-works/pi-ai/1.4.0)

## 服务端

| 用途 | 选型 |
| --- | --- |
| 运行时 | Electron 41.0.3 内置 Node.js 24.14.0，由 main 以 `ELECTRON_RUN_AS_NODE=1` 启动 [Electron DEPS](https://github.com/electron/electron/blob/v41.0.3/DEPS) |
| HTTP | Hono 4.13.12 + @hono/node-server 2.1.5 |
| WebSocket | @hono/node-server 2.1.5 的 `upgradeWebSocket` + ws 8.22.0（`noServer` 模式）；@types/ws 8.18.2 仅 devDependency |
| 本地访问认证 | 应用自有实现，基于 `node:crypto`：启动令牌、HMAC 签名 cookie 与请求信任围栏，见 [ADR 0002](adr/0002-local-service-access-auth.md) |
| 输入校验 | typebox 1.3.27，与 Agent 及 UI 协议层共用 |
| 宿主运行编排 | Effect 4.0.2，仅在 server 内使用 ManagedRuntime、Layer 与 FiberMap；Agent 业务状态机位于 packages/agent |
| 设置、Session 与执行记录 | `node:sqlite`（Electron 内置 Node.js 提供）单库，由 packages/session 管理 schema、迁移与事务提交，见 [ADR 0003](adr/0003-settings-and-sessions-in-sqlite.md) |
| 宿主写者互斥 | 同一 SQLite 库内的宿主租约，配合 Electron 单实例锁 |
| 恢复任务 | packages/agent 定义状态机与恢复策略；session 保存记录；server 启动扫描并唤醒 |

@hono/node-server 2.1.5 的 peer 为 `hono ^4 || ^5.0.0-0`；其 WebSocket 支持需项目自行安装 ws 并传入 `WebSocketServer`。移除原选型的 Bun 1.4.2、@types/bun 1.4.2 和 @hono/bun 1.0.0。[@hono/node-server 包元数据](https://registry.npmjs.org/@hono/node-server/2.1.5)、[WebSocket 用法](https://github.com/honojs/node-server#websocket)

服务职责、持久化边界与访问认证见 [项目架构约定](tech-stack/architecture.md#服务装配与存储边界)。

## 桌面端

| 用途 | 选型 |
| --- | --- |
| 桌面壳 | Electron 41.0.3 |
| 开发、构建、打包与发布入口 | **@electron-forge/cli 8.0.1** |
| Forge 配置类型 | @electron-forge/shared-types 8.0.1，仅 devDependency |
| main / preload、sidecar、Agent 与共享模块构建 | **tsdown 0.22.2** |
| 构建集成 | Forge hooks 调用 tsdown 与 Vite API |
| renderer 构建器 | Vite 8.3.1 |
| React 构建插件 | @vitejs/plugin-react 6.1.2 |
| macOS DMG | @electron-forge/maker-dmg 8.0.1 |
| macOS ZIP | @electron-forge/maker-zip 8.0.1 |
| Fuses 集成 | @electron-forge/plugin-fuses 8.0.1；`RunAsNode` 保持开启以启动 sidecar，风险见 [ADR 0001](adr/0001-sidecar-on-electron-node.md) |
| Electron Fuses | **@electron/fuses 2.1.3** |
| 原生模块 ASAR 解包 | @electron-forge/plugin-auto-unpack-natives 8.0.1 |
| 自动更新 | Electron 内置 `autoUpdater`，随 Electron 41.0.3 锁定；发布端提供兼容的更新 feed |
| 原生依赖 | koffi 3.3.1 |

Forge 包统一为 8.0.1。`@electron/fuses` 从原清单的 2.0.0 调整为 2.1.3，以满足 Forge 8.0.1 的 Fuses 插件 peer 要求。[Forge CLI 包元数据](https://registry.npmjs.org/@electron-forge/cli/8.0.1)、[Fuses 插件包元数据](https://registry.npmjs.org/@electron-forge/plugin-fuses/8.0.1)

tsdown 沿用参考清单的 0.22.2，负责非 UI 模块的 TS/JS 构建；Vite 负责 renderer 的 React、HTML、Tailwind CSS、静态资源与开发热更新。移除 electron-builder 26.15.3 和 electron-updater 6.8.9，应用打包、签名、安装包生成与发布由 Forge 管理。

构建职责、Forge 构建边界与自动更新见 [桌面构建与交付约定](tech-stack/desktop-delivery.md)。

## 界面

| 用途 | 选型 |
| --- | --- |
| 框架 | React 19.3.0 + react-dom 19.3.0 |
| 类型 | @types/react 19.3.0 + @types/react-dom 19.2.3 |
| 样式 | Tailwind CSS 4.3.3 + @tailwindcss/vite 4.3.3 |
| 组件库 | shadcn/ui；通过 shadcn CLI 4.21.4 安装并维护组件源码 |
| Toast | sonner 2.0.8，经 shadcn/ui 的 Sonner 组件接入 |
| 消息输入编辑器 | lexical 0.52.0 |
| 编辑器 React 集成 | @lexical/react 0.52.0 |
| 输入内容 Markdown 转换 | @lexical/markdown 0.52.0 |
| 动效 | motion 14.1.0 + tw-animate-css 1.4.0 |
| 浮层 | @floating-ui/dom 1.8.0 |
| 组件底层原语 | radix-ui 1.7.0 |
| 变体 | class-variance-authority 0.7.1 |
| 类名工具 | clsx 2.1.1 + tailwind-merge 3.7.0，组成 `cn()` |
| 图标 | lucide-react 1.55.0 + @lobehub/icons 5.23.0 |
| Markdown 渲染 | **streamdown 2.7.1**，统一覆盖流式聊天和静态文档 |
| GFM 解析 | Streamdown 内置 remark-gfm 支持，实际解析版本由 pnpm-lock.yaml 固定 |
| 代码高亮 | @streamdown/code 2.0.0 + shiki 4.5.0 |
| 数学公式 | @streamdown/math 1.0.3 + katex 0.16.47 |
| 图表 | @streamdown/mermaid 1.0.3 + mermaid 11.17.2 |
| 中文解析适配 | @streamdown/cjk 1.0.4 |
| 虚拟列表 | @tanstack/react-virtual 3.14.14 |
| ANSI 展示 | anser 2.3.5 |
| Diff 展示 | diff 8.0.4 |
| 状态管理 | Zustand 5.0.15，使用 vanilla store |
| 可选状态辅助 | Immer 10.2.0，实际需要时再引入 |
| 国际化 | 自有运行时无关 i18n 模块：zh / en locale、字典组合、插值和时长格式化 |

shadcn CLI 4.21.4 的 new-york-v4 registry 组件从 `cn` 包导入类名工具并依赖 next-themes；Coko 不引入这两个包：生成后改为导入 `packages/ui` 自己的 `cn()`（clsx + tailwind-merge），Toast 主题由应用层传入。

Streamdown 及其插件分别使用上表的精确版本号。@streamdown/math 1.0.3 的 KaTeX 依赖范围为 0.16.x，@streamdown/mermaid 1.0.3 的 Mermaid 依赖范围为 11.x，因此将原选型的 KaTeX 0.19.1、Mermaid 12.2.0 分别调整为 0.16.47、11.17.2。根 `pnpm-workspace.yaml` 的 overrides 将 shiki、katex、mermaid 分别对齐到 4.5.0、0.16.47、11.17.2，其余传递依赖由 pnpm-lock.yaml 固定。[Streamdown 包元数据](https://registry.npmjs.org/streamdown/2.7.1)、[数学插件包元数据](https://registry.npmjs.org/@streamdown/math/1.0.3)、[Mermaid 插件包元数据](https://registry.npmjs.org/@streamdown/mermaid/1.0.3)

技术接入、设计系统、交互与布局、UI 状态与验收及 Markdown 渲染见 [界面约定](tech-stack/ui.md)，token、圆角、材质与样式守卫的具体档位见 [设计系统规格](tech-stack/ui-design-system.md)。

## 日志与诊断

| 用途 | 选型 |
| --- | --- |
| 统一日志 API | **@logtape/logtape 2.4.2**，用于 Electron main、sidecar 与 renderer |
| 文件写入与轮转 | **@logtape/file 2.4.2**，由 main 与 sidecar 的运行时适配层使用 |
| 敏感字段与文本脱敏 | **@logtape/redaction 2.4.2** |
| 生产日志格式 | JSONL，一条事件一行，保留结构化字段 |
| 开发环境输出 | LogTape Console sink，输出便于阅读的日志 |
| Agent 遥测契约 | 沿用 @earendil-works/pi-telemetry 1.4.0，通过应用适配层接入日志 |

进程分工与关联、文件轮转与脱敏见 [日志与诊断约定](tech-stack/observability.md)。

## 代码质量与测试工具

| 用途 | 选型 |
| --- | --- |
| Lint | Oxlint 1.86.0 |
| 格式化 | Oxfmt 0.71.0 |
| 提交前格式化 | lint-staged 17.5.1 |
| Git hooks | husky 9.1.7 |
| 提交信息规范 | @commitlint/cli 21.2.3 + @commitlint/config-conventional 21.2.3 |
| 死代码与未使用依赖检查 | knip 6.37.0 |
| 文档工具脚本的 Markdown 解析 | mdast-util-from-markdown 2.1.0，根 devDependency，仅用于文档工具脚本 |
| 类型检查 | `tsc -b` |
| 单元与集成测试框架 | vitest 5.0.3，所有 workspace 统一使用 |
| 浏览器组件测试 | @vitest/browser-playwright 5.0.3 + vitest-browser-react 2.3.0 |
| 浏览器与桌面自动化驱动 | playwright 1.64.0，由 Vitest 编排 |
| 构建侧 Node 类型 | @types/node 24.19.2 |

所有 workspace 显式声明实际使用的运行依赖。根 `pnpm-workspace.yaml` 设置 `autoInstallPeers: false`，必须显式安装所需 peer，包括 React、React DOM 和 @electron/fuses；避免因图标库未使用的 peer 自动引入 antd 与 @lobehub/ui。同一文件设置 `nodeLinker: hoisted` 和 `saveExact: true`；pnpm 12 默认 `strictDepBuilds`，未裁决的安装脚本会使安装失败，因此 `allowBuilds` 逐个裁决：放行 electron（postinstall 下载二进制），拒绝 koffi（预编译二进制由 optional 依赖提供）、protobufjs 与 @google/genai（脚本不影响运行）。`permissions` 对 @logtape/logtape 设置 `skills: false`，不把其附带的 Agent skills 链接进仓库。依据为 2026-10-28 的本机安装实测。

测试运行与编排、用例设计、隔离和执行报告见 [测试约定](tech-stack/testing.md)。
