---
kind: decision
description: "sidecar 改由 Electron 内置 Node.js 以 ELECTRON_RUN_AS_NODE 运行，移除 Bun，并接受保持 RunAsNode fuse 开启的风险。重新评估进程模型或 fuse 配置时回看。"
status: accepted
implementation: partial
lifecycle: active
category: architecture
---

# sidecar 运行在 Electron 内置 Node.js，移除 Bun

## 上下文

原选型让 Bun 1.4.2 同时承担包管理、脚本入口和 sidecar 运行时，安装包另带 Bun 可执行文件。sidecar 用到的 Bun 专属能力只有 `bun:sqlite` 单写者互斥和 @hono/bun 的 WebSocket；代价是产品运行时多一套 JS 引擎，Bun 可执行文件需单独签名、公证和打包，而 pi 系列 1.4.0 包声明的运行环境是 `node >=22.19.0`，未承诺支持 Bun。

用户于 2026-10-28 参考 DeepSeek Harness 桌面端的做法确认本决定：Electron 主进程把自身可执行文件以 `ELECTRON_RUN_AS_NODE=1` 拉起为 Node 子进程，经 stdio 的 `ipc` 通道通信，退出时按 IPC 关闭请求、SIGTERM、SIGKILL 分级处理。

## 决定

- sidecar（Hono 服务与 Agent）运行在 Electron 41.0.3 内置的 Node.js 24.14.0 中，由 main 以 `child_process.spawn` + `ELECTRON_RUN_AS_NODE=1` 启动，使用 Node IPC；不使用 Electron `utilityProcess`。
- HTTP 与 WebSocket 改用 @hono/node-server 与 ws；单写者互斥改用 `node:sqlite`。
- 完全移除 Bun：包管理与脚本入口改为 pnpm 12.15.0，依赖锁定使用 `pnpm-lock.yaml`。
- Forge Fuses 配置保持 `RunAsNode` 开启。

精确版本见 [技术栈](../TECH_STACK.md)，进程与打包约定见 [桌面构建与交付约定](../tech-stack/desktop-delivery.md)。本决定不改变 sidecar 与 renderer 之间的 HTTP/WebSocket 协议边界。

## 理由与备选方案

- **utilityProcess。** 同样运行 Electron 内置 Node.js，且可以关闭 `RunAsNode` fuse；消息走 `parentPort` 而非 Node IPC。用户选择 spawn 方式，与参考实现保持一致，沿用标准 Node 子进程语义（`process.send`、`--inspect` 等命令行参数）。
- **保留 Bun 仅作包管理。** 改动最小，但仓库仍需维护两套工具链；用户选择完全移除。
- **写者互斥用排他锁文件，或待 spike 验证后再定。** 用户选择直接采用 `node:sqlite`。

## 后果与验证

- 产品运行时只剩 Electron；安装包不再携带独立运行时；sidecar 与 main 共用 Electron 的 Node ABI 和原生模块重建流程。
- 保持 `RunAsNode` 开启意味着本机任意进程都可以把已签名的应用当作 Node 解释器运行，并带上应用的签名身份。用户于 2026-10-28 确认接受这一安全代价。若之后的安全要求需要关闭该 fuse，应重新评估 `utilityProcess`。
- 用户于 2026-10-28 确认 `node:sqlite` 在 Electron 41.0.3 中可用。首个切片的 `ELECTRON_RUN_AS_NODE` 集成测试仍须覆盖打开数据库和写者互斥，作为本项目的实现证据；升级 Electron 时重新确认。
- implementation 变为 implemented 前需要：以 `ELECTRON_RUN_AS_NODE` 启动真实 sidecar 的集成测试，以及已签名安装包中 sidecar 启动与退出的产物 smoke。
- 当前为 partial：apps/server 的 sidecar 已在 Electron 41.0.3 内置 Node 中以 `ELECTRON_RUN_AS_NODE=1` 经集成测试验证启动、Node IPC 控制消息、打开数据库、写者互斥（第二个实例 fatal）与分级关闭，见 [apps/server](../../apps/server/README.md)；Electron main 的启动与安装包 smoke 尚未完成。

## 来源与后继

- [Electron 41.0.3 DEPS](https://github.com/electron/electron/blob/v41.0.3/DEPS)：内置 Node.js 版本为 v24.14.0。
- [Electron Fuses：runAsNode](https://github.com/electron/electron/blob/v41.0.3/docs/tutorial/fuses.md)。
- [Electron utilityProcess](https://github.com/electron/electron/blob/v41.0.3/docs/api/utility-process.md)。
- [@hono/node-server WebSocket 用法](https://github.com/honojs/node-server#websocket)。
- [pi-agent-core 1.4.0 包元数据](https://registry.npmjs.org/@earendil-works/pi-agent-core/1.4.0)：`engines.node >=22.19.0`。
- 参考实现：DeepSeek Harness 桌面端 `apps/desktop/src/host-process.ts` 与 `node-environment.ts`，本页已提炼所需结论。
