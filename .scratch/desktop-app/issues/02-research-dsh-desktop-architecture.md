# deepseek-harness 桌面端的进程、存储与 UI 结构

Type: research
Label: wayfinder:research
Status: resolved
Assignee: lead (research subagent)
Blocked by: none
Map: [Coko 桌面应用](../map.md)

## Question

deepseek-harness 的 apps/desktop、desktop-host、web 以及 packages/session、settings、storage、client、ui 设计系统如何组织？重点：host-process 启动与 IPC、协议代理与认证、设置与会话的存储方式（是否 SQLite、表结构、迁移）、renderer 的信息架构（侧栏、会话列表、聊天、工具卡、审批、计划、设置页）、设计 token 与组件。哪些可以按 coko 技术栈（Electron Forge + tsdown + Vite + React 19 + shadcn/ui + Tailwind 4）移植？

## Answer

研究结论见 [DSH 桌面端架构研究](../research/dsh-desktop-architecture.md)（只读源码与文档，未运行 DSH）。要点：

- 进程：main 以 ELECTRON_RUN_AS_NODE spawn host，stdio ipc，starting → ready；非法 IPC 消息即 SIGTERM；控制请求用 requestId + deadline；退出时 inspectQuit（2s）→ 确认 → shutdown → 10s SIGTERM → 5s SIGKILL。可直接移植。
- 认证：main 用 `redirect: 'manual'` 交换 cookie 并独占；自定义协议注入 cookie 转发 HTTP；WebSocket 由 renderer 直连 loopback 端口，main 在 onBeforeSendHeaders 只对主窗口改写 Origin / Cookie / sec-fetch-site。保持 ADR 0002 的更严约定（密钥不持久化、令牌一次性）。补充缺口：renderer 经 boot IPC 获得 WS 基址。
- 存储：DSH 会话为 JSONL、设置为 YAML、KV 为 JSON；SQLite 只有可选后端（WAL、STRICT、不迁移）与默认关闭的 FTS5 索引。设置与会话改存 SQLite 没有可照搬先例，迁移自行设计；可复用其打开序列与回滚失败隔离。
- IA：三栏（侧栏 264–420 默认 280，rail 56，<1024 自动收起；中栏 ≥400；右栏 45% / ≤70% / ≥300），顶部安全区 48px，聊天宽 clamp(680, 列宽×0.64, 920)；composer 上方依次 Todo → Goal → Queue；审批与提问卡接管 composer；Plan 用 chip + 右栏审阅；设置为 modal（Account / General / Models / Plugins / Agent presets）。
- 设计系统：颜色到 shadcn token 的明暗映射、字号阶梯、elevation、动效曲线、focus ring、macOS 窗口参数（hiddenInset、红绿灯位置、sidebar vibrancy）。
- renderer 代码不直接搬：DSH UI 由约 60 个插件包按 slot 拼装，样式为 CSS Modules，状态用自有 store + Immer；只移植信息架构、几何与交互规则。不移植 Cordis 插件 / slot 运行时、electron-builder / updater、DeepSeek 账号与强制更新。
- 待决：Toast 组件选型（未登记）、Electron 41 的 node:sqlite 是否带 FTS5、Lexical typeahead API。

