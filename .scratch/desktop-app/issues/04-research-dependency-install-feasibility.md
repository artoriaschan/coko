# 技术栈依赖在本机的安装与运行可行性

Type: research
Label: wayfinder:research
Status: resolved
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

TECH_STACK 列出的精确版本（Electron 41.0.3、Forge 8.0.1、tsdown 0.22.2、pi 1.4.0、React 19.3.0、Tailwind 4.3.3、shadcn CLI 4.21.4、lexical 0.52.0、streamdown 2.7.1、Effect 4.0.2 等）能否经当前 Artifactory 安装？Electron 二进制能否下载？Electron 41.0.3 以 ELECTRON_RUN_AS_NODE 运行时 node:sqlite 是否可用？给出需要的环境变量或镜像设置。

## Answer

研究结论见 [依赖安装可行性研究](../research/dependency-install-feasibility.md)（临时目录实测，已删除）。要点：

- 26 个精确版本包都能经 Artifactory 解析，安装不需要关闭 TLS 校验。
- pnpm 12 默认 strictDepBuilds，需要 `allowBuilds: { electron: true, koffi: false, protobufjs: false, '@google/genai': false }`；配置后 install 与 `--frozen-lockfile` 均退出 0。koffi 使用预编译二进制，宿主 Node 与 Electron-as-Node 下都可加载。
- Electron 二进制可直接从 GitHub 下载；备用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`（实测校验通过）；公司镜像无 electron。
- `ELECTRON_RUN_AS_NODE=1` 下 Node 24.14.0、SQLite 3.51.2：`:memory:` 与文件库读写正常；两进程 WAL 下 BEGIN IMMEDIATE 互斥有效（timeout 0 立即 `database is locked`，timeout 5000 等待后获得）。每进程一次 ExperimentalWarning。
- @vscode/ripgrep 1.18.0 的二进制来自 optional 依赖（ripgrep 15.0.0），不访问 GitHub。
- Playwright Chromium 可安装并启动，`_electron.launch` 能拉起 Electron 41.0.3 窗口。**当前 Agent 宿主环境继承了 `ELECTRON_RUN_AS_NODE=1`**，启动 Electron / E2E 前必须 unset。
- pnpm 提示 @logtape/logtape 的 Agent skills 待审批，项目设为不安装。
- 未验证：FTS5 是否编译进 Electron 41 的 node:sqlite、Forge package/make、Fuses、tsdown/Vite 构建、Browser Mode、asar 原生模块。FTS5 在首个里程碑实测，不可用则按 ADR 0003 降级。

