---
kind: technical-spec
description: "项目已选模块职责、依赖方向、运行链路及服务装配约束。"
lifecycle: active
---

# 项目架构约定

项目级技术约定，不代表已有实现或已验证结果；候选、可选和待决项沿用原标注，适用范围与变更规则见 [专项导航](README.md)。

## 仓库架构

采用 pnpm workspaces monorepo，以应用入口和共享模块组织代码。初始拆分为两个应用、六个共享包，各模块在内部按功能组织目录。

```text
repo/
├── apps/
│   ├── desktop/                    # Electron 桌面应用与 renderer 入口
│   │   ├── src/
│   │   │   ├── main/               # 窗口、sidecar 生命周期、coko-app 协议代理、更新与原生能力
│   │   │   ├── preload/            # contextBridge 与受控 IPC
│   │   │   └── renderer/
│   │   │       ├── app/            # 路由、依赖装配、主题与 locale
│   │   │       ├── features/       # 聊天、会话、文档和设置功能
│   │   │       ├── stores/         # Zustand vanilla store
│   │   │       └── client/         # HTTP / WebSocket 客户端
│   │   ├── build/                  # Forge hooks、watch 与资源准备
│   │   ├── resources/              # 图标与打包静态资源
│   │   ├── forge.config.ts
│   │   ├── tsdown.config.ts        # main / preload 构建
│   │   └── vite.config.ts          # renderer 构建
│   └── server/                     # sidecar（Electron 内置 Node）与服务装配入口
│       ├── src/
│       │   ├── http/               # Hono 路由、访问认证、中间件、错误映射
│       │   ├── ws/                 # 连接、订阅、事件推送与重连
│       │   ├── application/        # 业务入口与 Agent 框架接口调用
│       │   ├── runtime/            # Effect Layer、资源释放、定时唤醒与后台资源
│       │   ├── adapters/           # 宿主工具实现（如 ripgrep grep）与宿主适配
│       │   └── index.ts            # 进程入口与依赖装配
│       └── tsdown.config.ts
├── packages/
│   ├── protocol/                   # TypeBox DTO、命令、事件、错误码
│   ├── agent/                      # Coding-agent 框架、状态机、策略与宿主接口
│   ├── session/                    # Session 与设置模型、Repository、SQLite 存储与回放
│   ├── ui/                         # shadcn/ui、Lexical、Streamdown 与设计 token
│   ├── logging/                    # LogTape 接口、字段约定与宿主 sinks
│   └── i18n/                       # locale、字典、插值与格式化
├── tests/
│   ├── integration/                # Vitest 启动真实 sidecar 验证协议与恢复
│   ├── e2e/                        # Vitest + Playwright 验证桌面行为
│   ├── evals/                      # Agent 任务回放与回归评测
│   └── fixtures/                   # Session、Markdown 与协议测试数据
├── scripts/                        # 本地仓库检查与验收任务
├── docs/                           # 技术栈、架构、协议与数据格式
├── package.json                    # packageManager: pnpm@12.15.0
├── pnpm-workspace.yaml             # packages: apps/*、packages/*；安装设置与 overrides
├── pnpm-lock.yaml
├── .node-version
├── tsconfig.base.json
├── tsconfig.json                   # project references
└── vitest.config.ts                # workspace 测试项目配置
```

### 模块职责与依赖

| 模块 | 职责与允许的依赖 |
| --- | --- |
| apps/desktop | main / preload 管理桌面能力，随安装包分发 ripgrep 并在启动 sidecar 时传入其路径；renderer 依赖 protocol、ui、logging、i18n，通过协议访问业务 |
| apps/server | 装配 agent、session、protocol、logging、i18n；负责 Hono、Effect、定时唤醒、资源管理、Node 宿主适配、本地访问认证，以及装配时注册或覆盖宿主工具 |
| packages/protocol | 定义可序列化请求、响应和事件；依赖 TypeBox，向两端提供 schema 与推导类型 |
| packages/agent | 统一实现执行机制、Goal / Plan / Task 状态机、扩展、权限与恢复策略；提供内置工具与[工具扩展/覆盖接口](agent-runtime.md#工具扩展与覆盖)，不依赖随安装包分发的二进制；依赖 session 接口和 logging，宿主能力、宿主工具与存储由 server 注入 |
| packages/session | 对外提供 Session、设置与 Memory 的 Repository 接口；内部处理 SQLite 打开、schema 迁移、事务提交、宿主租约、记录回放和损坏隔离 |
| packages/ui | 提供可复用组件、编辑器与 MarkdownRenderer；业务流程、网络请求和会话状态归 desktop renderer |
| packages/logging | 提供日志接口及独立的 console、file、IPC 适配入口，由各宿主装配 |
| packages/i18n | 提供纯 TypeScript 字典与格式化，供 UI、服务和错误展示复用 |

依赖从应用指向共享模块，业务共享模块不反向导入 apps。protocol 和 i18n 保持运行时无关；protocol 使用应用自己的 DTO，server 将 pi 消息和内部状态映射为协议事件。

session 的公共入口暴露模型和存储接口，SQLite 实现与内存实现通过独立入口提供，`node:sqlite` 只在 SQLite 入口导入。agent 通过注入的 Repository 使用存储；server 装配 SQLite 实现，测试可以装配内存实现。事务、迁移与租约的调用顺序封装在存储实现内，调用方只等待明确的提交结果。不复用 Pi SessionManager。

Goal、Task、授权和恢复等业务状态的含义与转换规则由 agent 定义，session 保存统一记录封装及其版本化 payload。业务 payload 的校验与迁移通过注册接口接入，由 server 装配；session 不反向导入 agent 实现。

logging 的文件 sink 通过独立导出入口由 main / server 引入。renderer 与 preload 只引入浏览器可用的接口或 IPC 适配；浏览器构建不会经公共聚合导出加载 node:fs、node:sqlite 或 Electron main 模块。

### 运行链路

renderer 通过 HTTP 提交命令、通过 WebSocket 订阅业务事件。server 校验 protocol schema，通过 application 入口调用 agent 框架及 session 查询接口，再输出可序列化的业务结果。执行、权限、Goal 和恢复策略集中在 agent；server 提供生命周期、唤醒和资源适配。协议事件携带关联标识和顺序信息，重连时由 server 根据持久化状态重新同步。

Electron main 以 `ELECTRON_RUN_AS_NODE=1` 启动自身可执行文件运行 sidecar，经 Node IPC 等待就绪。renderer 通过 `coko-app://` 协议加载，HTTP 与 WebSocket 由 main 代为附加认证凭据，preload 不暴露令牌或 cookie。窗口、原生对话框、更新和日志转发使用受控 IPC；业务会话与 Agent 执行通过服务协议处理。

### 本地服务访问认证

sidecar 的服务即使只监听 loopback 也强制认证，没有关闭开关；理由见 [ADR 0002](../adr/0002-local-service-access-auth.md)。

- **监听。** 只绑定 `127.0.0.1` 的端口 0，listening 后读取实际端口；拒绝 `0.0.0.0`、`::` 等通配地址。
- **启动令牌。** 每次启动生成 32 字节随机令牌，只通过启动 IPC 的 ready 事件交给 main，交换成功后作废。令牌不接受作为 Authorization 头。
- **会话 cookie。** main 用令牌调用交换入口；sidecar 以恒定时间比较校验，签发绑定监听 authority 的 HMAC 签名 cookie（`HttpOnly`、`SameSite=Strict`、`Path=/`）。签名密钥只在 sidecar 进程内存中，sidecar 重启后旧 cookie 全部失效，main 重新交换。
- **凭据归属。** cookie 只由 main 持有。`coko-app://` 请求由 main 转发给 sidecar 并注入 cookie，剥离响应中的 `set-cookie`；WebSocket 升级只对主窗口、目标 authority 和 `coko-app://app` 来源注入 cookie 与 Origin，其他来源取消。
- **逐请求校验。** 所有 API 路由与 WebSocket 升级先过信任围栏：`Host` 必须是 loopback 监听地址，带 `Origin` 时必须同源，`sec-fetch-site: cross-site` 直接拒绝，失败返回 403；通过后校验 cookie，失败返回 401。

### 构建与测试归属

非 UI 共享包通过 tsdown 输出到各自的 dist；ui 作为仓库内部源码包由 renderer 的 Vite 构建消费，React 保持 peer 依赖。TypeScript 类型检查统一使用 tsc -b，各 workspace 按依赖声明 project references。

apps/server 构建自身的 sidecar 产物。apps/desktop 的 Forge hooks 按依赖顺序调用共享包、server、main / preload 和 renderer 构建，并将应用产物收集到桌面 workspace 的 dist/electron、dist/renderer、dist/sidecar。sidecar 的运行依赖与原生资源按桌面打包章节的 extraResource 规则准备，不携带独立运行时。

单元测试与模块内集成测试就近放置，沿用 src 下的 *.test.ts / *.test.tsx；跨应用集成测试和桌面验收放在根 tests。所有测试由 Vitest 编排，Browser Mode 覆盖组件与交互，Playwright 驱动真实 Electron；涉及进程启动、访问认证、`node:sqlite` 或恢复的集成测试以 `ELECTRON_RUN_AS_NODE` 启动真实 sidecar。

## 服务装配与存储边界

设置、Session 与相关业务状态保存在 sidecar 独占的单个 SQLite 库，入库范围、提交、迁移、租约与损坏处理见 [ADR 0003](../adr/0003-settings-and-sessions-in-sqlite.md)。记录封装、schema 版本与事务边界由 session 定义；agent 定义业务状态恢复规则。不调用 pi-durable 的 JSONL 或 lease 实现。

Effect 管理服务生命周期、唤醒任务与宿主资源，agent 定义执行策略并调用 pi-agent-core 循环。server 通过协议向客户端输出业务事件，前端不直接持有 Agent 实例。
