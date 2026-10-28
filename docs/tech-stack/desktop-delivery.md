---
kind: technical-spec
description: "Electron Forge 构建、sidecar 进程与打包及 macOS 更新链路的技术约定。"
lifecycle: active
---

# 桌面构建与交付约定

项目级技术约定，不代表已有实现或已验证结果；候选、可选和待决项沿用原标注，适用范围与变更规则见 [专项导航](README.md)。

构建集成通过 Forge hooks 调用 tsdown 与 Vite API，统一管理构建顺序、开发服务器、监听任务和输出目录。[Forge hooks](https://www.electronforge.io/config/hooks)

### 构建职责

| 范围 | 工具与产物 |
| --- | --- |
| Electron main | tsdown，输出 `dist/electron/main.cjs`，由 Electron 执行 |
| Electron preload | tsdown，输出 `dist/electron/preload.cjs`，由 Electron 加载 |
| sidecar 与 Agent | tsdown，target 为 Electron 内置 Node.js 24.14.0，输出到 `dist/sidecar/`，包含 ESM 服务入口及所需 chunks，以 `ELECTRON_RUN_AS_NODE=1` 执行 |
| 非 UI 共享模块 | tsdown，按 workspace 输出到各自的 `dist/`；ui 源码由 renderer 的 Vite 构建消费 |
| React renderer | Vite + React / Tailwind 插件，输出 HTML、JS、CSS 与静态资源到 `dist/renderer/` |
| 应用与安装包 | Electron Forge + DMG / ZIP Makers |

main / preload 与 sidecar 都按 Electron 内置 Node.js 设置 target；sidecar 以纯 Node 模式运行，不导入 `electron`；运行时无关的共享模块不得引入 Electron 或 Node 宿主专属模块。tsdown 的 sidecar 构建只生成服务代码，安装包不携带独立运行时。[tsdown 平台配置](https://tsdown.dev/options/platform)

### Forge 构建边界

统一由 `forge.config.ts` 配置插件、Makers、资源、签名、公证和 hooks。桌面 workspace 的 scripts 使用：

```json
{
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "publish": "electron-forge publish"
  }
}
```

使用 pnpm 调用这些 scripts，Forge CLI、tsdown 和 Vite 由开发机 Node.js 执行。`package.json` 的 `main` 指向 `dist/electron/main.cjs`，preload 路径指向 `dist/electron/preload.cjs`。main / preload 在同一 tsdown 构建批次中生成；Electron、sidecar 和 renderer 使用独立输出目录，各构建任务只清理自己的目录。

开发时通过 Forge 的 `preStart` hook 接入 tsdown 首次构建和 watch，并通过 Vite API 启动 renderer 开发服务器；首次构建成功且开发服务器就绪后再启动 Electron。开发 URL 通过显式约定的环境变量传给 main；生产环境加载 `dist/renderer/index.html`，renderer 的 Vite `base` 配置为 `./`，确保本地资源路径正确。

开发接线负责在 main / preload 重建后重启 Electron、在 sidecar 重建后重启服务，并在开发会话退出时清理 watcher 和子进程。该逻辑接入 Forge 的开发生命周期，Electron 启动与安装包流程继续由 Forge 管理。

Agent 与 Hono 服务运行在独立的 sidecar 进程中。Electron main 用 `child_process.spawn` 以 `ELECTRON_RUN_AS_NODE=1` 启动 `process.execPath`，stdio 含 `ipc` 通道；sidecar 经 IPC 报告 starting、ready（携带端口与启动令牌）、fatal 和 shutdown-complete。main 负责就绪检测和分级退出：先发 IPC 关闭请求，宽限期后依次 SIGTERM、SIGKILL，并等待进程实际退出。`node:sqlite` 等宿主模块仅在 sidecar 的运行时适配层中导入。访问认证见 [项目架构约定](architecture.md#本地服务访问认证)。

这种启动方式要求 Forge Fuses 配置保持 `RunAsNode` 开启；风险与重新评估条件见 [ADR 0001](../adr/0001-sidecar-on-electron-node.md)。

打包时通过 Forge 的 `prePackage` hook 调用 tsdown，按依赖顺序构建共享模块、sidecar / Agent 和 main / preload，并通过 Vite API 构建 renderer；所有构建成功后进入应用打包阶段。应用文件包含 `dist/electron/`、`dist/renderer/` 和所需生产依赖。`packagerConfig.extraResource` 携带 sidecar 入口及 chunks、所需运行依赖和 ripgrep 等资源。

打包时保留实际的生产依赖。pnpm 使用 `nodeLinker: hoisted` 安装布局，避免 Forge 在收集依赖时遗漏链接包；仍须通过安装包运行验收确认 workspace 代码、原生模块与资源已完整收集。`electron`、Node 内置模块（含 `node:sqlite`）和 koffi 等原生模块在对应 tsdown 构建中保留为 external。sidecar 与 main 共用 Electron 的 Node ABI，原生模块统一由 Forge 的原生模块处理和 ASAR 解包配置处理。[Forge 依赖收集说明](https://www.electronforge.io/cli)

### 内置 ripgrep

ripgrep 只由桌面应用分发，packages/agent 不依赖它。apps/desktop 依赖 @vscode/ripgrep：开发时使用该包解析的可执行路径，打包时经 `extraResource` 携带对应平台的二进制，main 启动 sidecar 时把实际路径作为启动参数传入。apps/server 不导入 ripgrep 包，收到路径后在 adapters 中构造基于 ripgrep 的 grep 实现，并在装配时覆盖内置 grep，遵守 [工具扩展与覆盖](agent-runtime.md#工具扩展与覆盖) 的契约。

传入的路径缺失或不可执行时，sidecar 报告 fatal 并退出，不静默回退到内置实现，以免掩盖打包缺陷；未传入路径（例如脱离桌面单独运行 sidecar）时使用内置 grep。安装包 smoke 需确认 sidecar 实际使用的是随包 ripgrep。

### 自动更新

macOS 使用已签名、公证的应用和 ZIP 更新产物，DMG 用于首次安装。自动更新的客户端使用 Electron `autoUpdater`，服务端提供与其兼容的更新 feed；Forge 负责生成和发布更新所需产物。仅生成 DMG/ZIP 不等于更新链路已经可用。[Forge 自动更新说明](https://www.electronforge.io/advanced/auto-update)

保留原清单的首发范围：本地 macOS arm64 构建。Windows、Linux 的 Makers 与更新策略在扩展平台时另行选定；发布目的地确定后，再加入精确锁定为 8.0.1 的对应 Forge Publisher。
